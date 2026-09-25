/**
 * 스냅샷 정제 (허용 목록 복사 + 가명 + 비밀값 검사). 순수 함수.
 *
 * - 섹션 기여자가 준 값은 믿지 않는다: B.2 스키마에 있는 필드만 **골라 복사**한다.
 *   (환경 변수·command/args·어노테이션·표준 외 레이블·이벤트 message·DB 사용자 이름 등은
 *    스키마에 없으므로 복사되지 않는다)
 * - IP 형태 노드 이름 → `<nodeGroup>-node-<n>`, 볼륨 ID → `vol-<n>`, LB 이름/ARN → `lb-<n>` (매핑은 api 메모리에만)
 * - 이미지: 레지스트리 호스트·계정 ID·digest 제거
 * - 모든 문자열 값(이름 포함)에 비밀값 패턴 검사 → 걸리면 "[가림]" + 경로 기록
 * docs/api/architecture-advisor.md B.2 "항상 제외", 명세 3.3·3.4
 */
import { redactSecrets } from '../../database/health/sanitize';
import type { Status } from '../advisor.types';
import type {
  AdvisorSnapshotV1,
  SnapshotCluster,
  SnapshotContainer,
  SnapshotControlPlane,
  SnapshotControlPlaneVolume,
  SnapshotCost,
  SnapshotDb,
  SnapshotLoadBalancer,
  SnapshotNode,
  SnapshotNodeGroup,
  SnapshotPrecheck,
  SnapshotStorage,
  SnapshotUnattachedVolume,
  SnapshotWorkload,
} from './snapshot.types';

export const REDACTED = '[가림]';
export const ALLOWED_LABEL_KEYS: readonly string[] = [
  'app.kubernetes.io/name',
  'app.kubernetes.io/component',
  'app.kubernetes.io/part-of',
  'app.kubernetes.io/version',
  'app.kubernetes.io/managed-by',
];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const MAX_STR = 300;

function str(v: unknown, max = MAX_STR): string | null {
  if (typeof v !== 'string') return null;
  // 제어 문자 제거 + 길이 제한
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}
const strOr = (v: unknown, d = ''): string => str(v) ?? d;
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
const numOr = (v: unknown, d = 0): number => num(v) ?? d;
const bool = (v: unknown): boolean => v === true;
function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : null;
}
const STATUSES: readonly Status[] = ['ok', 'warning', 'critical', 'unknown'];
const status = (v: unknown): Status => oneOf(v, STATUSES) ?? 'unknown';

// ---------------------------------------------------------------------------
// 이미지·레이블
// ---------------------------------------------------------------------------

/** "저장소 이름:태그" 만 남긴다. 레지스트리 호스트(점·콜론 포함 또는 localhost)·digest 제거 */
export function cleanImage(image: unknown): string {
  let s = str(image, 500) ?? '';
  s = s.replace(/@sha256:[0-9a-f]+$/i, '');
  const parts = s.split('/');
  if (
    parts.length > 1 &&
    (parts[0].includes('.') ||
      parts[0].includes(':') ||
      parts[0] === 'localhost')
  ) {
    parts.shift();
  }
  // 남은 경로에 계정 ID(12자리)가 있으면 가린다
  return parts.join('/').replace(/\b\d{12}\b/g, REDACTED);
}

function pickLabels(v: unknown): Record<string, string> {
  const src = obj(v);
  const out: Record<string, string> = {};
  for (const key of ALLOWED_LABEL_KEYS) {
    const val = str(src[key], 63);
    if (val !== null) out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 가명
// ---------------------------------------------------------------------------

export interface PseudonymMap {
  /** 가명 → 실제 이름 */
  nodes: Record<string, string>;
  volumes: Record<string, string>;
  loadBalancers: Record<string, string>;
}

export const emptyPseudonyms = (): PseudonymMap => ({
  nodes: {},
  volumes: {},
  loadBalancers: {},
});

/**
 * 노드 이름 가명 대상 판정 (계약 B.2 "노드 이름 가명 처리" P1~P4, AC-KOPS44).
 * kOps는 노드 이름이 EC2 인스턴스 ID(`i-0abc…`)가 될 수 있다(명세 F10).
 * 인스턴스 ID는 "항상 제외" 대상이므로 **원문으로 나가면 안 된다.**
 */
const NODE_NAME_P1 = /^ip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}(\..*)?$/i;
const NODE_NAME_P2 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const NODE_NAME_P3 = /^i-[0-9a-f]{8}(?:[0-9a-f]{9})?$/i;
const IPV4 = /\b\d{1,3}(?:[.-]\d{1,3}){3}\b/;
/** P4: 문자열 안에 섞인 인스턴스 ID (부분 일치) */
const INSTANCE_ID_SRC = 'i-[0-9a-f]{8}(?:[0-9a-f]{9})?';
/** 문자열 안에 섞인 EC2 사설 DNS 이름 */
const IP_NAME_SRC = 'ip-\\d{1,3}-\\d{1,3}-\\d{1,3}-\\d{1,3}(?:\\.[a-z0-9.-]+)?';

/** 인스턴스 ID 형태(P3·P4)를 담고 있는가. 검증(0건 확인)에도 쓰는 패턴 */
export function hasInstanceId(text: string): boolean {
  return new RegExp(INSTANCE_ID_SRC, 'i').test(text);
}

/** 가명으로 바꿔야 하는 노드 이름인가 (P1~P4 중 하나라도 맞으면 true) */
export function needsNodePseudonym(name: string): boolean {
  return (
    NODE_NAME_P1.test(name) ||
    NODE_NAME_P2.test(name) ||
    NODE_NAME_P3.test(name) ||
    IPV4.test(name) ||
    hasInstanceId(name)
  );
}

/** @deprecated 구 이름. `needsNodePseudonym`을 쓴다 */
export function isIpLikeNodeName(name: string): boolean {
  return needsNodePseudonym(name);
}

class Pseudonymizer {
  private readonly reverse = {
    nodes: new Map<string, string>(),
    volumes: new Map<string, string>(),
    loadBalancers: new Map<string, string>(),
  };
  private readonly counters = new Map<string, number>();

  constructor(readonly map: PseudonymMap) {
    for (const k of ['nodes', 'volumes', 'loadBalancers'] as const) {
      for (const [alias, real] of Object.entries(map[k])) {
        this.reverse[k].set(real, alias);
      }
    }
  }

  private alias(
    kind: keyof PseudonymMap,
    real: string,
    make: (n: number) => string,
    counterKey: string,
  ): string {
    const existing = this.reverse[kind].get(real);
    if (existing) return existing;
    let n = this.counters.get(counterKey) ?? 0;
    let alias: string;
    do {
      n += 1;
      alias = make(n);
    } while (this.map[kind][alias] !== undefined);
    this.counters.set(counterKey, n);
    this.map[kind][alias] = real;
    this.reverse[kind].set(real, alias);
    return alias;
  }

  node(name: string, nodeGroup: string | null): string {
    if (!needsNodePseudonym(name)) return name;
    // 노드그룹을 모르면 `node-<n>`. "가명을 만들 수 없으니 원문" 같은 예외는 두지 않는다
    const group =
      nodeGroup && !needsNodePseudonym(nodeGroup) ? nodeGroup : null;
    return this.alias(
      'nodes',
      name,
      (n) => (group ? `${group}-node-${n}` : `node-${n}`),
      `node:${group ?? ''}`,
    );
  }

  /** 이미 가명이 있으면 그대로, 아니면 노드그룹 없이 새 가명 */
  nodeRef(name: string): string {
    const existing = this.reverse.nodes.get(name);
    if (existing) return existing;
    return this.node(name, null);
  }

  /**
   * 자유 문자열 안의 노드 이름을 가명으로 바꾼다 (P4 + 실제 이름 부분 일치).
   * 필드 단위 판정만으로는 `"i-0a1b… CPU 평균 8%"` 같은 문장으로 원문이 새 나간다.
   */
  maskText(text: string): string {
    let out = text;
    // 1) 이미 아는 실제 이름 → 가명 (긴 이름부터: 짧은 이름이 긴 이름의 앞부분일 수 있다)
    const reals = [...this.reverse.nodes.keys()].sort(
      (a, b) => b.length - a.length,
    );
    for (const real of reals) {
      if (!out.includes(real)) continue;
      out = out.split(real).join(this.reverse.nodes.get(real));
    }
    // 2) 남은 인스턴스 ID·EC2 사설 DNS 이름 → 새 가명 (노드그룹을 모르므로 node-<n>)
    for (const src of [INSTANCE_ID_SRC, IP_NAME_SRC]) {
      out = out.replace(new RegExp(src, 'gi'), (m) => this.nodeRef(m));
    }
    return out;
  }

  volume(ref: string | null): string | null {
    if (ref === null || ref === '') return null;
    if (/^vol-\d{1,6}$/.test(ref)) return ref;
    return this.alias('volumes', ref, (n) => `vol-${n}`, 'vol');
  }

  loadBalancer(ref: string): string {
    if (/^lb-\d{1,6}$/.test(ref)) return ref;
    return this.alias('loadBalancers', ref, (n) => `lb-${n}`, 'lb');
  }

  counts(): { nodes: number; volumes: number; loadBalancers: number } {
    return {
      nodes: Object.keys(this.map.nodes).length,
      volumes: Object.keys(this.map.volumes).length,
      loadBalancers: Object.keys(this.map.loadBalancers).length,
    };
  }
}

// ---------------------------------------------------------------------------
// 허용 목록 복사
// ---------------------------------------------------------------------------

function usage(v: unknown): SnapshotNodeGroup['cpu'] {
  const o = obj(v);
  return {
    avgPct: num(o.avgPct),
    maxPct: num(o.maxPct),
    requestsPct: numOr(o.requestsPct),
  };
}

export function copyCluster(
  v: unknown,
  counts: { worker: number; controlPlane: number },
): SnapshotCluster {
  const o = obj(v);
  return {
    platform: 'kops',
    version: strOr(o.version, 'unknown'),
    region: str(o.region),
    // 마스터를 섞어 세면 LLM이 "노드 9대인데 워커 requests가…"처럼 틀린 전제를 세운다
    workerCount: num(o.workerCount) ?? counts.worker,
    controlPlaneCount: num(o.controlPlaneCount) ?? counts.controlPlane,
    namespaceCount: numOr(o.namespaceCount),
    controlPlane: copyControlPlane(o.controlPlane),
  };
}

const CP_KINDS = [
  'kube-apiserver',
  'kube-controller-manager',
  'kube-scheduler',
  'etcd-manager-main',
  'etcd-manager-events',
] as const;

export function copyControlPlane(v: unknown): SnapshotControlPlane | null {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const m = obj(o.masters);
  return {
    masters: {
      readyCount: numOr(m.readyCount),
      instanceTypes: arr(m.instanceTypes).map((t) => ({
        type: strOr(obj(t).type, 'unknown'),
        count: numOr(obj(t).count),
      })),
      zones: arr(m.zones).map((z) => ({
        zone: strOr(obj(z).zone, 'unknown'),
        count: numOr(obj(z).count),
      })),
      capacityType: oneOf(m.capacityType, [
        'on_demand',
        'spot',
        'mixed',
      ] as const),
      cpu: usage(m.cpu),
      memory: usage(m.memory),
    },
    components: arr(o.components)
      .map((c) => {
        const x = obj(c);
        const kind = oneOf(x.kind, CP_KINDS);
        return kind === null
          ? null
          : {
              kind,
              readyCount: numOr(x.readyCount),
              expectedCount: numOr(x.expectedCount),
              restarts24h: numOr(x.restarts24h),
            };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null),
    quorumState:
      oneOf(o.quorumState, ['ok', 'at_risk', 'lost', 'unknown'] as const) ??
      'unknown',
    haExpected: bool(o.haExpected),
    notReporting: numOr(o.notReporting),
  };
}

export function copyNodeGroup(v: unknown): SnapshotNodeGroup {
  const o = obj(v);
  return {
    name: strOr(o.name, 'unknown'),
    instanceTypes: arr(o.instanceTypes).map((t) => ({
      type: strOr(obj(t).type, 'unknown'),
      count: numOr(obj(t).count),
    })),
    architecture: str(o.architecture),
    capacityType: oneOf(o.capacityType, [
      'on_demand',
      'spot',
      'mixed',
    ] as const),
    zones: arr(o.zones)
      .map((z) => str(z))
      .filter((z): z is string => z !== null),
    nodeCount: numOr(o.nodeCount),
    cpu: usage(o.cpu),
    memory: usage(o.memory),
    statelessOnly: bool(o.statelessOnly),
    estimatedUsdPerMonth: num(o.estimatedUsdPerMonth),
  };
}

function nodeUsage(v: unknown): SnapshotNode['cpu'] {
  const o = obj(v);
  return { ...usage(o), currentPct: num(o.currentPct) };
}

export function copyNode(v: unknown, p: Pseudonymizer): SnapshotNode {
  const o = obj(v);
  const nodeGroup = str(o.nodeGroup);
  const alloc = obj(o.allocatable);
  return {
    name: p.node(strOr(o.name, 'unknown'), nodeGroup),
    nodeGroup,
    role: o.role === 'control_plane' ? 'control_plane' : 'worker',
    instanceType: str(o.instanceType),
    architecture: str(o.architecture),
    capacityType: oneOf(o.capacityType, ['on_demand', 'spot'] as const),
    zone: str(o.zone),
    allocatable: {
      cpuMillicores: numOr(alloc.cpuMillicores),
      memoryBytes: numOr(alloc.memoryBytes),
      pods: numOr(alloc.pods),
    },
    cpu: nodeUsage(o.cpu),
    memory: nodeUsage(o.memory),
    podCount: numOr(o.podCount),
    status: status(o.status),
    reasonCodes: arr(o.reasonCodes)
      .map((c) => str(c, 64))
      .filter((c): c is string => c !== null && /^[A-Z0-9_]+$/.test(c)),
  };
}

function resources(v: unknown): SnapshotContainer['requests'] {
  const o = obj(v);
  return {
    cpuMillicores: num(o.cpuMillicores),
    memoryBytes: num(o.memoryBytes),
  };
}

export function copyContainer(v: unknown): SnapshotContainer {
  const o = obj(v);
  const u = o.usage === null || o.usage === undefined ? null : obj(o.usage);
  const probes = obj(o.probes);
  const sec = obj(o.security);
  return {
    name: strOr(o.name, 'unknown'),
    image: cleanImage(o.image),
    requests: resources(o.requests),
    limits: resources(o.limits),
    usage: u
      ? {
          cpuAvgMillicores: num(u.cpuAvgMillicores),
          cpuMaxMillicores: num(u.cpuMaxMillicores),
          memoryAvgBytes: num(u.memoryAvgBytes),
          memoryMaxBytes: num(u.memoryMaxBytes),
        }
      : null,
    probes: {
      readiness: bool(probes.readiness),
      liveness: bool(probes.liveness),
    },
    security: {
      privileged: bool(sec.privileged),
      allowPrivilegeEscalation: boolOrNull(sec.allowPrivilegeEscalation),
      runAsNonRoot: boolOrNull(sec.runAsNonRoot),
    },
  };
}

export function copyWorkload(v: unknown): SnapshotWorkload {
  const o = obj(v);
  const ps = obj(o.podSecurity);
  const hpa = o.hpa === null || o.hpa === undefined ? null : obj(o.hpa);
  return {
    kind:
      oneOf(o.kind, ['Deployment', 'StatefulSet', 'DaemonSet'] as const) ??
      'Deployment',
    namespace: strOr(o.namespace, 'default'),
    name: strOr(o.name, 'unknown'),
    desired: num(o.desired),
    ready: numOr(o.ready),
    nodeGroups: arr(o.nodeGroups)
      .map((g) => str(g))
      .filter((g): g is string => g !== null),
    containers: arr(o.containers).map(copyContainer),
    podSecurity: {
      hostNetwork: bool(ps.hostNetwork),
      hostPID: bool(ps.hostPID),
      hostPath: bool(ps.hostPath),
      defaultServiceAccount: bool(ps.defaultServiceAccount),
      automountToken: boolOrNull(ps.automountToken),
    },
    hasPdb: bool(o.hasPdb),
    hpa: hpa ? { min: num(hpa.min), max: numOr(hpa.max) } : null,
    restarts24h: numOr(o.restarts24h),
    oom24h: numOr(o.oom24h),
    status: status(o.status),
    labels: pickLabels(o.labels),
  };
}

export function copyStorage(v: unknown, p: Pseudonymizer): SnapshotStorage {
  const o = obj(v);
  return {
    namespace: strOr(o.namespace, 'default'),
    name: strOr(o.name, 'unknown'),
    capacityBytes: num(o.capacityBytes),
    volumeType: str(o.volumeType, 32),
    volumeRef: p.volume(str(o.volumeRef)),
    usagePct: num(o.usagePct),
    usageSource: oneOf(o.usageSource, [
      'prometheus',
      'db_size_approx',
    ] as const),
    attached: bool(o.attached),
    usdPerMonth: num(o.usdPerMonth),
  };
}

export function copyUnattached(
  v: unknown,
  p: Pseudonymizer,
): SnapshotUnattachedVolume {
  const o = obj(v);
  return {
    volumeRef: p.volume(str(o.volumeRef)) ?? p.volume('unknown') ?? 'vol-0',
    volumeType: strOr(o.volumeType, 'unknown'),
    capacityBytes: numOr(o.capacityBytes),
    clusterTagged: bool(o.clusterTagged),
    usdPerMonth: num(o.usdPerMonth),
  };
}

export function copyControlPlaneVolume(
  v: unknown,
  p: Pseudonymizer,
): SnapshotControlPlaneVolume {
  const o = obj(v);
  return {
    volumeRef: p.volume(str(o.volumeRef)) ?? 'vol-0',
    kind: oneOf(o.kind, ['etcd', 'master_root'] as const) ?? 'etcd',
    volumeType: strOr(o.volumeType, 'unknown'),
    capacityBytes: numOr(o.capacityBytes),
    usdPerMonth: num(o.usdPerMonth),
  };
}

export function copyLoadBalancer(
  v: unknown,
  p: Pseudonymizer,
): SnapshotLoadBalancer {
  const o = obj(v);
  return {
    ref: p.loadBalancer(strOr(o.ref, 'unknown')),
    type: oneOf(o.type, ['alb', 'nlb', 'clb'] as const) ?? 'alb',
    attachedTo: arr(o.attachedTo).map((a) => {
      const x = obj(a);
      return {
        kind: oneOf(x.kind, ['Service', 'Ingress'] as const) ?? 'Service',
        namespace: strOr(x.namespace, 'default'),
        name: strOr(x.name, 'unknown'),
      };
    }),
    healthyTargets: num(o.healthyTargets),
    usdPerMonth: num(o.usdPerMonth),
  };
}

/** DB 블록: DBA 보고서 9절 항목만 (사용자 이름·쿼리 원문·클라이언트 주소 등은 복사하지 않음) */
export function copyDb(v: unknown): SnapshotDb | null {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const c = obj(o.connections);
  const lrq =
    o.longRunningQueries === null || o.longRunningQueries === undefined
      ? null
      : obj(o.longRunningQueries);
  const r = obj(o.resources);
  return {
    vendor: 'postgres',
    version: str(o.version, 64),
    replicas: num(o.replicas),
    pvcUsagePct: num(o.pvcUsagePct),
    pvcUsageSource: oneOf(o.pvcUsageSource, [
      'prometheus',
      'db_size_approx',
    ] as const),
    connections: {
      currentPct: num(c.currentPct),
      maxObservedPct: num(c.maxObservedPct),
      max: num(c.max),
    },
    longRunningQueries: lrq
      ? { over5m: numOr(lrq.over5m), over30m: numOr(lrq.over30m) }
      : null,
    cacheHitPct: num(o.cacheHitPct),
    xidAge: num(o.xidAge),
    databases: arr(o.databases).map((d) => ({
      name: strOr(obj(d).name, 'unknown'),
      bytes: numOr(obj(d).bytes),
    })),
    resources: {
      qosClass: str(r.qosClass, 32),
      requestsSet: bool(r.requestsSet),
      limitsSet: bool(r.limitsSet),
    },
    onSpot: boolOrNull(o.onSpot),
  };
}

const COST_CATEGORIES = ['ec2', 'ebs', 'lb', 'ipv4', 'controlPlane'] as const;

export function copyCost(v: unknown): SnapshotCost | null {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const rate = obj(o.rate);
  const actual =
    o.actual === null || o.actual === undefined ? null : obj(o.actual);
  const forecast =
    o.forecast === null || o.forecast === undefined ? null : obj(o.forecast);
  const budget =
    o.budget === null || o.budget === undefined ? null : obj(o.budget);
  const ebs = obj(o.ebsGbMonth);
  const optPrice = (x: unknown) => {
    if (x === null || x === undefined) return null;
    const p = obj(x);
    return { type: strOr(p.type, 'unknown'), usdPerHour: num(p.usdPerHour) };
  };
  return {
    currency: 'USD',
    asOf: str(o.asOf, 40),
    rate: {
      totalUsdPerHour: num(rate.totalUsdPerHour),
      byCategory: arr(rate.byCategory)
        .map((c) => obj(c))
        .filter((c) => oneOf(c.category, COST_CATEGORIES) !== null)
        .map((c) => ({
          category: oneOf(c.category, COST_CATEGORIES) ?? 'ec2',
          usdPerHour: numOr(c.usdPerHour),
        })),
      byNodeGroup: arr(rate.byNodeGroup).map((g) => ({
        nodeGroup: strOr(obj(g).nodeGroup, 'unknown'),
        usdPerHour: numOr(obj(g).usdPerHour),
        usdPerMonth: numOr(obj(g).usdPerMonth),
      })),
      unpricedCount: numOr(rate.unpricedCount),
    },
    allocation: arr(o.allocation).map((a) => ({
      namespace: strOr(obj(a).namespace, 'unknown'),
      usdPerMonth: numOr(obj(a).usdPerMonth),
      sharePct: numOr(obj(a).sharePct),
      requestsMissingPods: numOr(obj(a).requestsMissingPods),
    })),
    actual: actual
      ? {
          monthToDateUsd: numOr(actual.monthToDateUsd),
          settledThrough: strOr(actual.settledThrough),
          topServices: arr(actual.topServices)
            .slice(0, 10)
            .map((s) => ({
              service: strOr(obj(s).service, 'unknown'),
              mtdUsd: numOr(obj(s).mtdUsd),
            })),
          scope:
            oneOf(actual.scope, ['account', 'tag_filter'] as const) ??
            'account',
        }
      : null,
    forecast: forecast
      ? {
          monthEndUsd: numOr(forecast.monthEndUsd),
          lowUsd: numOr(forecast.lowUsd),
          highUsd: numOr(forecast.highUsd),
        }
      : null,
    budget: budget
      ? {
          budgetUsd: numOr(budget.budgetUsd),
          status: status(budget.status),
          projectedPct: num(budget.projectedPct),
        }
      : null,
    alternatives: arr(o.alternatives).map((a) => {
      const x = obj(a);
      const spot = x.spot === null || x.spot === undefined ? null : obj(x.spot);
      return {
        instanceType: strOr(x.instanceType, 'unknown'),
        currentUsdPerHour: num(x.currentUsdPerHour),
        graviton: optPrice(x.graviton),
        smaller: optPrice(x.smaller),
        spot: spot
          ? { usdPerHour: num(spot.usdPerHour), zone: str(spot.zone) }
          : null,
      };
    }),
    ebsGbMonth: { gp2: num(ebs.gp2), gp3: num(ebs.gp3) },
  };
}

export function copyPrecheck(v: unknown, p: Pseudonymizer): SnapshotPrecheck {
  const o = obj(v);
  const savings =
    o.savings === null || o.savings === undefined ? null : obj(o.savings);
  return {
    ruleId: strOr(o.ruleId, 'R-UNKNOWN'),
    category: strOr(o.category, 'other'),
    severity: oneOf(o.severity, ['high', 'medium', 'low'] as const),
    held: bool(o.held),
    summary: strOr(o.summary),
    targets: arr(o.targets).map((t) => {
      const x = obj(t);
      const name = strOr(x.name, 'unknown');
      return {
        kind: strOr(x.kind, 'Other'),
        namespace: str(x.namespace),
        // 노드 대상은 가명으로 (nodes[]와 같은 가명이어야 한다)
        name: strOr(x.kind) === 'Node' ? p.nodeRef(name) : name,
      };
    }),
    evidence: arr(o.evidence).map((e) => {
      const x = obj(e);
      return {
        field: str(x.field),
        value:
          typeof x.value === 'number' && Number.isFinite(x.value)
            ? x.value
            : str(x.value),
        text: str(x.text, 500) ?? '',
      };
    }),
    savings: savings
      ? {
          monthlyUsd: numOr(savings.monthlyUsd),
          formula: strOr(savings.formula),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// 비밀값 검사
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /\b(AKIA|ASIA)[0-9A-Z]{16}\b/,
  /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\s*[=:]/i,
  /-----BEGIN [A-Z ]+-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\b[0-9a-fA-F]{32,}\b/,
  /arn:aws[a-z-]*:/i,
  /\b\d{12}\b/,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\bsk-ant-[A-Za-z0-9_-]+/,
  /[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:[^@\s]+@/i,
];

/** base64처럼 보이는 32자 이상 연속 문자열 (숫자·대문자·소문자가 섞인 경우만) */
function looksLikeBase64Blob(s: string): boolean {
  const m = s.match(/[A-Za-z0-9+/]{32,}={0,2}/g);
  return (
    m?.some((x) => /[0-9]/.test(x) && /[A-Z]/.test(x) && /[a-z]/.test(x)) ??
    false
  );
}

export function looksSecret(s: string): boolean {
  if (s === REDACTED) return false;
  if (SECRET_PATTERNS.some((re) => re.test(s))) return true;
  if (looksLikeBase64Blob(s)) return true;
  return redactSecrets(s) !== s;
}

interface ScanState {
  paths: string[];
}

function keyOf(item: Obj): string | null {
  const ns = typeof item.namespace === 'string' ? item.namespace : null;
  for (const k of [
    'name',
    'ref',
    'volumeRef',
    'ruleId',
    'nodeGroup',
    'instanceType',
    'reason',
    'service',
    'type',
  ]) {
    const v = item[k];
    if (typeof v === 'string') return ns ? `${ns}/${v}` : v;
  }
  return null;
}

function scan(
  value: unknown,
  path: string,
  st: ScanState,
  p: Pseudonymizer,
): unknown {
  if (typeof value === 'string') {
    if (looksSecret(value)) {
      st.paths.push(path);
      return REDACTED;
    }
    // 문자열 전체 스캔: evidence[].text·summary처럼 자유 문장에 섞인 노드 이름도 가명으로
    return p.maskText(value);
  }
  if (Array.isArray(value)) {
    // 경로 표시에 쓸 키는 가리기 전 값으로 만든다 (경로는 화면 "가린 필드"에만 쓰임, 값은 없음)
    return value.map((item, i) => {
      const k = item && typeof item === 'object' ? keyOf(item as Obj) : null;
      const label = k !== null && !looksSecret(k) ? k : String(i);
      return scan(item, `${path}[${label}]`, st, p);
    });
  }
  if (value && typeof value === 'object') {
    const out: Obj = {};
    for (const [k, v] of Object.entries(value as Obj)) {
      out[k] = scan(v, path ? `${path}.${k}` : k, st, p);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// 전체
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  snapshot: AdvisorSnapshotV1;
  redactedFields: string[];
  pseudonyms: PseudonymMap;
}

/**
 * 스냅샷 모양의 값(신뢰하지 않음)을 허용 목록으로 다시 만들고 가명·비밀값 검사를 적용한다.
 * 이미 정제된 스냅샷에 다시 적용해도 결과가 같다(멱등) — 보내기 직전 한 번 더 호출한다.
 */
export function sanitizeSnapshot(
  input: unknown,
  pseudonyms: PseudonymMap = emptyPseudonyms(),
): SanitizeResult {
  const o = obj(input);
  const meta = obj(o.meta);
  const p = new Pseudonymizer(pseudonyms);
  const nodes = arr(o.nodes).map((n) => copyNode(n, p));
  const storage = arr(o.storage).map((s) => copyStorage(s, p));
  const unattachedVolumes = arr(o.unattachedVolumes).map((u) =>
    copyUnattached(u, p),
  );
  const loadBalancers = arr(o.loadBalancers).map((l) => copyLoadBalancer(l, p));
  const events = obj(o.events);
  const obs = obj(meta.observationSec);
  const omitted = obj(meta.omitted);

  const draft: AdvisorSnapshotV1 = {
    schemaVersion: 1,
    meta: {
      generatedAt: strOr(meta.generatedAt, new Date(0).toISOString()),
      dataSource: oneOf(meta.dataSource, ['mock', 'live'] as const) ?? 'live',
      observationSec: {
        metrics: numOr(obs.metrics),
        restarts: numOr(obs.restarts),
      },
      omitted: {
        workloads: numOr(omitted.workloads),
        nodes: numOr(omitted.nodes),
      },
      redactedCount: 0,
      systemNamespacesIncluded: bool(meta.systemNamespacesIncluded),
      pseudonyms: p.counts(),
    },
    cluster: copyCluster(o.cluster, {
      worker: nodes.filter((n) => n.role === 'worker').length,
      controlPlane: nodes.filter((n) => n.role === 'control_plane').length,
    }),
    nodeGroups: arr(o.nodeGroups).map(copyNodeGroup),
    nodes,
    workloads: arr(o.workloads).map(copyWorkload),
    storage,
    unattachedVolumes,
    controlPlaneVolumes: arr(o.controlPlaneVolumes).map((v) =>
      copyControlPlaneVolume(v, p),
    ),
    loadBalancers,
    events: {
      windowSec: 3600,
      byReason: arr(events.byReason).map((e) => ({
        reason: strOr(obj(e).reason, 'Unknown'),
        kind: strOr(obj(e).kind, 'Other'),
        count: numOr(obj(e).count),
      })),
    },
    db: copyDb(o.db),
    cost: copyCost(o.cost),
    prechecks: arr(o.prechecks).map((x) => copyPrecheck(x, p)),
  };
  draft.meta.pseudonyms = p.counts();

  const st: ScanState = { paths: [] };
  const scanned = scan(draft, '', st, p) as AdvisorSnapshotV1;
  // 메타 값은 서버가 만든 것이므로 원래 값 유지 (스캔 대상에서 제외할 필요 없지만 보정)
  scanned.schemaVersion = 1;
  // 문자열 스캔에서 가명이 더 생겼을 수 있다
  scanned.meta.pseudonyms = p.counts();
  const previous = numOr(meta.redactedCount);
  scanned.meta.redactedCount = previous + st.paths.length;
  return { snapshot: scanned, redactedFields: st.paths, pseudonyms: p.map };
}
