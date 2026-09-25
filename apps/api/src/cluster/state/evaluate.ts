/**
 * 상태 판단 (docs/specs/cluster-status.md 3절) → API 항목 (docs/api/cluster-status.md 1절).
 * 입력은 메모리 캐시(ClusterStore·MetricsStore)뿐이고 외부 호출이 없다.
 */
import { redactSecrets, truncateText } from '../../database/health';
import type { SettingValue } from '../../database/settings-defaults';
import type { SourceState } from '../../common/source-registry.service';
import {
  formatDurationKo,
  reason,
  round1,
  statusFromReasons,
  statusRank,
  worstStatus,
  type Reason,
  type Status,
  type StatusChangeTracker,
  type StatusInfo,
} from '../../common/status';
import {
  podKey,
  selectorMatches,
  workloadKey,
  type RawContainer,
  type RawEvent,
  type RawNode,
  type RawPod,
  type RawPvc,
  type RawWorkload,
} from '../model';
import type {
  AreaCounts,
  Areas,
  AttentionItem,
  ClusterMetricsBody,
  ControlPlaneBody,
  ControlPlaneMetricsBlock,
  DbAreaProvider,
  EventItem,
  NodeItem,
  PodItem,
  PodOwnerKind,
  ProblemItem,
  PvcItem,
  ResourceRef,
  WorkloadItem,
} from '../types';
import {
  buildLogHref,
  buildPodKeyLogHref,
  type LogLinkPolicyValue,
} from '../../logs/log-href';
import { restartTotal, type ClusterStore } from './cluster-store';
import { evaluateControlPlane } from './control-plane';
import type { MetricsStore } from './metrics-store';

export type ClusterThresholds = SettingValue<'cluster.thresholds'>;

const HOUR_MS = 3_600_000;

export interface SourceView {
  state: SourceState;
  lastSuccessAt: string | null;
  /** 출처 오류 코드 (예: KUBE_AUTH_FAILED). 판단 이유 코드에 그대로 쓴다 */
  errorCode?: string | null;
}

export interface EvalInput {
  now: number;
  store: ClusterStore;
  metrics: MetricsStore;
  t: ClusterThresholds;
  systemNamespaces: ReadonlySet<string>;
  kube: SourceView;
  metricsSource: SourceView;
  tracker: StatusChangeTracker;
  db: DbAreaProvider | null;
  /** Prometheus kubelet_volume_stats_used_bytes (ns/name → bytes). 없으면 null */
  pvcUsageProm: { at: string; values: Map<string, number> } | null;
  clusterName: string | null;
  metricsIntervalSec: number;
  /** 마스터 대수(단일·짝수) 판단을 켜고 끄는 설정 (env CONTROL_PLANE_HA_EXPECTED) */
  controlPlaneHaExpected: boolean;
  /**
   * 로그 링크 가능 여부 (`LOGS_ENABLED`·`LOG_DENY_NAMESPACES` + mock `logs=disabled`).
   * **링크를 평가 단계에서 채운다** — REST와 SSE가 같은 항목 객체를 쓰므로 값이 갈라지지 않는다
   * (2026-09-25 결함: SSE의 `ControlPlaneComponent.logHref`만 항상 null이었다).
   * 생략하면 로그 링크를 주지 않는다(모든 `logHref: null`).
   */
  logLinks?: LogLinkPolicyValue;
}

const NO_LOG_LINKS: LogLinkPolicyValue = { enabled: false, denyNamespaces: [] };

export interface ClusterView {
  at: number;
  atIso: string;
  kubeState: SourceState;
  kubeStale: boolean;
  nodes: NodeItem[];
  nodeMap: Map<string, NodeItem>;
  workloads: WorkloadItem[];
  workloadMap: Map<string, WorkloadItem>;
  pods: PodItem[];
  podMap: Map<string, PodItem>;
  events: EventItem[];
  pvcs: PvcItem[];
  pvcMap: Map<string, PvcItem>;
  pvcUsageSource: 'prometheus' | 'db_size_approx' | 'none';
  metrics: ClusterMetricsBody;
  controlPlane: ControlPlaneBody;
  areas: Areas;
  overall: StatusInfo;
  attention: AttentionItem[];
  restartObservation: { observedSec: number; fullWindow: boolean };
  /** 파드 → 소속 워크로드 키 */
  podOwner: Map<string, string | null>;
}

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------

export function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

function pctOrNull(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return round1((part / whole) * 100);
}

export function shortNodeName(name: string): string {
  return name.split('.')[0];
}

export function cleanText(text: string, max: number): string {
  return truncateText(redactSecrets(text).replace(/\s+/g, ' ').trim(), max);
}

function levelByUpper(v: number, warn: number, crit: number | null): Status {
  if (crit !== null && v >= crit) return 'critical';
  if (v >= warn) return 'warning';
  return 'ok';
}

const SEVERE_IMMEDIATE = new Set([
  'FailedMount',
  'FailedAttachVolume',
  'Evicted',
  'OOMKilling',
  'NodeNotReady',
  'FailedCreatePodSandBox',
]);

/** 명세 3.5 심각 reason 규칙 */
export function isSevereEvent(e: RawEvent): boolean {
  if (SEVERE_IMMEDIATE.has(e.reason)) return true;
  const durSec = Math.max(
    0,
    (Date.parse(e.lastSeenAt) - Date.parse(e.firstSeenAt)) / 1000,
  );
  if (e.reason === 'FailedScheduling') return durSec >= 300;
  if (e.reason === 'BackOff') {
    // 집계된 이벤트는 개별 시각이 없으므로 평균 빈도로 "10분 안에 5회"를 근사한다
    if (e.count < 5) return false;
    return durSec <= 600 || (e.count * 600) / durSec >= 5;
  }
  return false;
}

const WAITING_CRITICAL: Record<string, string> = {
  CrashLoopBackOff: 'CRASHLOOP',
  ImagePullBackOff: 'IMAGE_PULL_BACKOFF',
  ErrImagePull: 'ERR_IMAGE_PULL',
  CreateContainerConfigError: 'CREATE_CONTAINER_CONFIG_ERROR',
  CreateContainerError: 'CREATE_CONTAINER_ERROR',
  InvalidImageName: 'INVALID_IMAGE_NAME',
};
const WAITING_CREATING = new Set(['ContainerCreating', 'PodInitializing']);

function sumAmounts(
  list: RawContainer[],
  field: 'requests' | 'limits',
): { cpuMillicores: number | null; memoryBytes: number | null } {
  if (list.length === 0) return { cpuMillicores: null, memoryBytes: null };
  let cpu: number | null = 0;
  let mem: number | null = 0;
  for (const c of list) {
    const a = c[field];
    cpu =
      cpu === null || a.cpuMillicores === null ? null : cpu + a.cpuMillicores;
    mem = mem === null || a.memoryBytes === null ? null : mem + a.memoryBytes;
  }
  return { cpuMillicores: cpu, memoryBytes: mem };
}

/** 스케줄러 관점 합계(값 없는 컨테이너는 0) */
function sumAmountsLoose(
  list: RawContainer[],
  field: 'requests' | 'limits',
): { cpu: number; mem: number } {
  let cpu = 0;
  let mem = 0;
  for (const c of list) {
    cpu += c[field].cpuMillicores ?? 0;
    mem += c[field].memoryBytes ?? 0;
  }
  return { cpu, mem };
}

export function isPodCompleted(p: RawPod): boolean {
  if (p.phase === 'Succeeded') return true;
  return p.phase === 'Failed' && p.owner?.kind === 'Job';
}

/** 파드 소속 워크로드 해석 (ReplicaSet → Deployment는 pod-template-hash로) */
export function resolveOwner(
  p: RawPod,
  workloads: Map<string, RawWorkload>,
): PodItem['owner'] {
  const o = p.owner;
  if (!o) return null;
  const ns = p.namespace;
  if (o.kind === 'ReplicaSet') {
    const hash = p.labels['pod-template-hash'];
    if (hash && o.name.endsWith(`-${hash}`)) {
      const dep = o.name.slice(0, -(hash.length + 1));
      const key = workloadKey('Deployment', ns, dep);
      if (workloads.has(key))
        return { kind: 'Deployment', name: dep, workloadKey: key };
    }
    return { kind: 'ReplicaSet', name: o.name, workloadKey: null };
  }
  if (o.kind === 'StatefulSet' || o.kind === 'DaemonSet') {
    const key = workloadKey(o.kind, ns, o.name);
    return {
      kind: o.kind,
      name: o.name,
      workloadKey: workloads.has(key) ? key : null,
    };
  }
  const kind: PodOwnerKind =
    o.kind === 'Job' ? 'Job' : o.kind === 'Node' ? 'Node' : 'Other';
  return { kind, name: o.name, workloadKey: null };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

export function evaluateCluster(input: EvalInput): ClusterView {
  const { now, store, metrics, t, tracker } = input;
  const atIso = new Date(now).toISOString();
  const kubeState = input.kube.state;
  const kubeStale = kubeState === 'stale';
  const kubeUpdatedAt =
    kubeState === 'ok' || kubeState === 'mock'
      ? atIso
      : input.kube.lastSuccessAt;
  const ms = metrics.state;
  const metricsOk =
    ms.available &&
    (input.metricsSource.state === 'ok' ||
      input.metricsSource.state === 'mock' ||
      input.metricsSource.state === 'stale');
  const metricsStale = input.metricsSource.state === 'stale';

  const mk = (
    key: string,
    reasons: Reason[],
    stale = kubeStale,
    updatedAt: string | null = kubeUpdatedAt,
    base: Status = 'ok',
  ): StatusInfo => {
    const r = statusFromReasons(reasons, base);
    return {
      status: r.status,
      reasons: r.reasons,
      updatedAt,
      statusChangedAt: tracker.track(key, r.status, atIso),
      stale,
    };
  };

  const eventWindowMs = t.eventWindowSec * 1000;

  // --- 이벤트 --------------------------------------------------------------
  const events: EventItem[] = [];
  const severeRecent = new Map<string, { reason: string; at: number }[]>();
  for (const e of store.events.values()) {
    const last = Date.parse(e.lastSeenAt);
    if (!Number.isFinite(last) || now - last > HOUR_MS) continue;
    const severe = isSevereEvent(e);
    events.push({
      key: e.uid,
      namespace: e.namespace,
      involvedObject: {
        kind: e.involved.kind,
        namespace: e.involved.namespace,
        name: e.involved.name,
      },
      reason: e.reason,
      message: cleanText(e.message, 1000),
      count: e.count,
      firstSeenAt: e.firstSeenAt,
      lastSeenAt: e.lastSeenAt,
      severe,
      sourceComponent: e.sourceComponent,
      // 진입점 4: 대상이 파드일 때만. 그 시각(lastSeenAt)을 보러 가는 링크다 (follow 없음)
      logHref:
        e.involved.kind === 'Pod' && e.involved.namespace
          ? buildLogHref(input.logLinks ?? NO_LOG_LINKS, {
              entry: 'event',
              namespace: e.involved.namespace,
              pod: e.involved.name,
              at: e.lastSeenAt,
            }).href
          : null,
    });
    if (severe && now - last <= eventWindowMs) {
      const k = `${e.involved.kind}/${e.involved.namespace ?? ''}/${e.involved.name}`;
      const arr = severeRecent.get(k) ?? [];
      arr.push({ reason: e.reason, at: last });
      severeRecent.set(k, arr);
    }
  }
  events.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  // --- 파드 ----------------------------------------------------------------
  const pods: PodItem[] = [];
  const podMap = new Map<string, PodItem>();
  const podOwner = new Map<string, string | null>();
  const apiUptimeSec = Math.floor((now - store.startedAt) / 1000);
  for (const p of store.pods.values()) {
    const key = podKey(p.namespace, p.name);
    const owner = resolveOwner(p, store.workloads);
    podOwner.set(key, owner?.workloadKey ?? null);
    store.history.observe(p, now, owner?.workloadKey ?? null);
    const item = evaluatePod(p, owner, input, mk, severeRecent, metricsOk);
    pods.push(item);
    podMap.set(key, item);
  }
  store.history.prune(now);

  // --- 노드 ----------------------------------------------------------------
  const podsByNode = new Map<string, RawPod[]>();
  for (const p of store.pods.values()) {
    if (!p.nodeName || isPodCompleted(p) || p.phase === 'Failed') continue;
    const arr = podsByNode.get(p.nodeName) ?? [];
    arr.push(p);
    podsByNode.set(p.nodeName, arr);
  }
  const nodes: NodeItem[] = [];
  const nodeMap = new Map<string, NodeItem>();
  for (const n of store.nodes.values()) {
    const item = evaluateNode(
      n,
      podsByNode.get(n.name) ?? [],
      input,
      mk,
      severeRecent,
      metricsOk,
    );
    nodes.push(item);
    nodeMap.set(n.name, item);
  }

  // --- 워크로드 --------------------------------------------------------------
  const podsByWorkload = new Map<string, PodItem[]>();
  const rawPodsByWorkload = new Map<string, RawPod[]>();
  for (const p of store.pods.values()) {
    const wk = podOwner.get(podKey(p.namespace, p.name));
    if (!wk) continue;
    const item = podMap.get(podKey(p.namespace, p.name))!;
    (podsByWorkload.get(wk) ?? podsByWorkload.set(wk, []).get(wk)!).push(item);
    (rawPodsByWorkload.get(wk) ?? rawPodsByWorkload.set(wk, []).get(wk)!).push(
      p,
    );
  }
  const workloads: WorkloadItem[] = [];
  const workloadMap = new Map<string, WorkloadItem>();
  for (const w of store.workloads.values()) {
    const key = workloadKey(w.kind, w.namespace, w.name);
    const item = evaluateWorkload(
      w,
      podsByWorkload.get(key) ?? [],
      rawPodsByWorkload.get(key) ?? [],
      input,
      mk,
    );
    workloads.push(item);
    workloadMap.set(key, item);
  }

  // --- PVC -----------------------------------------------------------------
  const dbTarget = input.db?.target() ?? null;
  const approx = input.db?.approxDataDir() ?? null;
  const dbPvcNames = new Set<string>();
  if (dbTarget) {
    const sts = store.workloads.get(
      workloadKey('StatefulSet', dbTarget.namespace, dbTarget.statefulSet),
    );
    for (const pvc of store.pvcs.values()) {
      if (pvc.namespace !== dbTarget.namespace) continue;
      const tpls = sts?.volumeClaimTemplates ?? [];
      if (
        tpls.some((tpl) =>
          new RegExp(
            `^${escapeRe(`${tpl}-${dbTarget.statefulSet}-`)}\\d+$`,
          ).test(pvc.name),
        )
      )
        dbPvcNames.add(podKey(pvc.namespace, pvc.name));
    }
    // 템플릿을 모르면 DB 파드가 마운트한 PVC로 판단
    for (const p of store.pods.values()) {
      if (
        podOwner.get(podKey(p.namespace, p.name)) ===
        workloadKey('StatefulSet', dbTarget.namespace, dbTarget.statefulSet)
      ) {
        for (const c of p.pvcClaims) dbPvcNames.add(podKey(p.namespace, c));
      }
    }
  }
  const mountedBy = new Map<string, ResourceRef[]>();
  for (const p of store.pods.values()) {
    if (isPodCompleted(p)) continue;
    for (const c of p.pvcClaims) {
      const k = podKey(p.namespace, c);
      const arr = mountedBy.get(k) ?? [];
      arr.push({ kind: 'Pod', namespace: p.namespace, name: p.name });
      mountedBy.set(k, arr);
    }
  }
  const pvcs: PvcItem[] = [];
  const pvcMap = new Map<string, PvcItem>();
  let anyApprox = false;
  for (const pvc of store.pvcs.values()) {
    const key = podKey(pvc.namespace, pvc.name);
    const isDb = dbPvcNames.has(key);
    const item = evaluatePvc(
      pvc,
      isDb,
      mountedBy.get(key) ?? [],
      input,
      mk,
      isDb ? approx : null,
    );
    if (item.usage?.source === 'db_size_approx') anyApprox = true;
    pvcs.push(item);
    pvcMap.set(key, item);
  }
  const pvcUsageSource = input.pvcUsageProm
    ? 'prometheus'
    : anyApprox
      ? 'db_size_approx'
      : 'none';

  // --- 클러스터 메트릭 -----------------------------------------------------------
  const metricsBody = evaluateClusterMetrics(
    input,
    store.nodes,
    podsByNode,
    metricsOk,
    metricsStale,
    mk,
  );

  // --- 영역 ------------------------------------------------------------------
  const sourceReason = kubeSourceReason(
    kubeState,
    store.initialSyncDone,
    input.kube.errorCode,
  );
  const activePods = pods.filter((p) => !p.completed);

  // --- 컨트롤 플레인 ------------------------------------------------------------
  const cp = evaluateControlPlane({
    now,
    atIso,
    store,
    rawNodes: store.nodes,
    nodes,
    podItems: pods,
    rawPods: store.pods,
    kubeStale,
    sourceReason,
    haExpected: input.controlPlaneHaExpected,
    podsUsable: sourceReason === null,
    metrics: metricsBody.controlPlane,
    logLinks: input.logLinks ?? NO_LOG_LINKS,
    mk,
  });

  // 노드 영역은 **워커만** 센다 (kops-support 3.1). 마스터는 컨트롤 플레인 영역에서 따로 본다
  const workerNodes = nodes.filter((n) => n.role === 'worker');
  const nodesReasons: Reason[] = [];
  if (sourceReason) nodesReasons.push(sourceReason);
  else {
    if (workerNodes.length === 0)
      nodesReasons.push(
        reason('CLUSTER_NO_WORKER_NODES', '워커 노드 없음', 'critical'),
      );
    else if (workerNodes.every((n) => n.ready.value !== 'True'))
      nodesReasons.push(
        reason(
          'CLUSTER_ALL_WORKERS_NOT_READY',
          '모든 워커 NotReady',
          'critical',
        ),
      );
    nodesReasons.push(
      ...itemReasons(workerNodes, (n) => shortNodeName(n.name)),
    );
  }
  const nodesArea: Areas['nodes'] = {
    status: mk('area:nodes', nodesReasons),
    ready: workerNodes.filter((n) => n.ready.value === 'True').length,
    total: workerNodes.length,
    problems: problems(workerNodes, (n) => ({
      kind: 'Node',
      namespace: null,
      name: n.name,
    })),
  };

  const wlReasons: Reason[] = sourceReason
    ? [sourceReason]
    : itemReasons(
        workloads.filter((w) => !w.stopped),
        (w) => `${w.namespace} / ${w.name}`,
      );
  const workloadsArea: Areas['workloads'] = {
    status: mk('area:workloads', wlReasons),
    total: workloads.length,
    counts: countStatuses(workloads),
    problems: problems(workloads, (w) => ({
      kind: w.kind,
      namespace: w.namespace,
      name: w.name,
    })),
  };

  const podReasons: Reason[] = sourceReason
    ? [sourceReason]
    : itemReasons(activePods, (p) => `${p.namespace} / ${p.name}`);
  const podsArea: Areas['pods'] = {
    status: mk('area:pods', podReasons),
    total: activePods.length,
    counts: countStatuses(activePods),
    problems: problems(activePods, (p) => ({
      kind: 'Pod',
      namespace: p.namespace,
      name: p.name,
    })),
  };

  const recentEvents = events.filter(
    (e) => now - Date.parse(e.lastSeenAt) <= eventWindowMs,
  );
  const severeEvents = recentEvents.filter((e) => e.severe);
  const evReasons: Reason[] = [];
  if (sourceReason) evReasons.push(sourceReason);
  else {
    if (severeEvents.length > 0) {
      const byReason = new Map<string, number>();
      for (const e of severeEvents)
        byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
      for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
        evReasons.push(
          reason(
            'EVENTS_SEVERE_RECENT',
            `심각 이벤트 ${r} ${n}건 (최근 ${Math.round(t.eventWindowSec / 60)}분)`,
            'critical',
          ),
        );
      }
    }
    if (recentEvents.length > 0)
      evReasons.push(
        reason(
          'EVENTS_WARNING_RECENT',
          `최근 ${Math.round(t.eventWindowSec / 60)}분 Warning ${recentEvents.length}건`,
          'warning',
        ),
      );
  }
  const eventProblems: ProblemItem[] = [...recentEvents]
    .sort(
      (a, b) =>
        Number(b.severe) - Number(a.severe) ||
        b.lastSeenAt.localeCompare(a.lastSeenAt),
    )
    .slice(0, 3)
    .map((e) => ({
      ref: e.involvedObject,
      status: e.severe ? 'critical' : 'warning',
      reason: `${e.reason} ×${e.count}`,
    }));
  const eventsArea: Areas['events'] = {
    status: mk('area:events', evReasons),
    warnings15m: recentEvents.length,
    severe15m: severeEvents.length,
    problems: eventProblems,
  };

  const dbSummary =
    input.db?.areaSummary({ atIso, workloadMap, pods, pvcs }) ?? null;
  const dbArea: Areas['db'] = dbSummary
    ? {
        status: dbSummary.status,
        configured: dbSummary.configured,
        headline: dbSummary.headline,
      }
    : {
        status: {
          status: 'unknown',
          reasons: [
            reason(
              'DB_NOT_CONFIGURED',
              '모니터링할 DB가 설정되지 않았습니다',
              'unknown',
            ),
          ],
          updatedAt: null,
          statusChangedAt: null,
          stale: false,
        },
        configured: false,
        headline: null,
      };

  const metricsArea: Areas['metrics'] = {
    status: mk(
      'area:metrics',
      [...metricsBody.cpu.status.reasons, ...metricsBody.memory.status.reasons],
      metricsStale,
      metricsBody.updatedAt,
      worstStatus([
        metricsBody.cpu.status.status,
        metricsBody.memory.status.status,
      ]),
    ),
    available: metricsBody.available,
  };

  const areas: Areas = {
    nodes: nodesArea,
    workloads: workloadsArea,
    pods: podsArea,
    events: eventsArea,
    db: dbArea,
    metrics: metricsArea,
    controlPlane: cp.area,
  };

  // --- 전체 ------------------------------------------------------------------
  const overallReasons: Reason[] = [];
  const areaLabel: [keyof Areas, string][] = [
    ['nodes', '노드'],
    ['controlPlane', ''],
    ['workloads', '워크로드'],
    ['pods', '파드'],
    ['events', ''],
    ['db', 'DB'],
    ['metrics', ''],
  ];
  for (const [k, label] of areaLabel) {
    for (const r of areas[k].status.reasons.slice(0, 2)) {
      if (r.status === 'ok') continue;
      overallReasons.push({
        ...r,
        text: label ? `${label} ${r.text}` : r.text,
      });
    }
  }
  const overall = mk(
    'overall',
    overallReasons,
    kubeStale,
    atIso,
    worstStatus(
      Object.values(areas).map((a: { status: StatusInfo }) => a.status.status),
    ),
  );
  overall.reasons = overall.reasons.slice(0, 5);

  // --- 지금 확인할 항목 ----------------------------------------------------------
  const attention: AttentionItem[] = [];
  const pushItems = <T extends { status: StatusInfo }>(
    area: AttentionItem['area'],
    list: T[],
    ref: (x: T) => ResourceRef,
  ) => {
    for (const x of list) {
      const s = x.status.status;
      if (s !== 'critical' && s !== 'warning') continue;
      const top =
        x.status.reasons.find((r) => r.status === s) ??
        x.status.reasons[0] ??
        reason('UNKNOWN', s, s);
      attention.push({
        area,
        ref: ref(x),
        status: s,
        reason: top,
        statusChangedAt: x.status.statusChangedAt,
      });
    }
  };
  pushItems('node', nodes, (n) => ({
    kind: 'Node',
    namespace: null,
    name: n.name,
  }));
  pushItems('workload', workloads, (w) => ({
    kind: w.kind,
    namespace: w.namespace,
    name: w.name,
  }));
  pushItems('pod', activePods, (p) => ({
    kind: 'Pod',
    namespace: p.namespace,
    name: p.name,
  }));
  pushItems('pvc', pvcs, (p) => ({
    kind: 'PersistentVolumeClaim',
    namespace: p.namespace,
    name: p.name,
  }));
  for (const e of severeEvents) {
    attention.push({
      area: 'event',
      ref: e.involvedObject,
      status: 'critical',
      reason: reason(
        'EVENTS_SEVERE_RECENT',
        `${e.reason} ×${e.count}`,
        'critical',
      ),
      statusChangedAt: e.firstSeenAt,
    });
  }
  for (const a of cp.attention) {
    attention.push({
      area: 'control_plane',
      ref: a.ref,
      status: a.status,
      reason: a.reason,
      statusChangedAt: cp.body.status.statusChangedAt,
    });
  }
  if (dbSummary) attention.push(...dbSummary.attention);
  for (const [k, label] of [
    ['cpu', 'CPU'],
    ['memory', '메모리'],
  ] as const) {
    const st = metricsBody[k].status;
    if (st.status === 'critical' || st.status === 'warning') {
      attention.push({
        area: 'metrics',
        ref: {
          kind: 'Cluster',
          namespace: null,
          name: input.clusterName ?? label,
        },
        status: st.status,
        reason: st.reasons[0] ?? reason('CLUSTER_USAGE', label, st.status),
        statusChangedAt: st.statusChangedAt,
      });
    }
  }
  attention.sort(
    (a, b) =>
      statusRank(b.status) - statusRank(a.status) ||
      (b.statusChangedAt ?? '').localeCompare(a.statusChangedAt ?? ''),
  );

  const observedSec = Math.min(3600, apiUptimeSec);
  return {
    at: now,
    atIso,
    kubeState,
    kubeStale,
    nodes,
    nodeMap,
    workloads,
    workloadMap,
    pods,
    podMap,
    events,
    pvcs,
    pvcMap,
    pvcUsageSource,
    metrics: metricsBody,
    controlPlane: cp.body,
    areas,
    overall,
    attention,
    restartObservation: { observedSec, fullWindow: apiUptimeSec >= 3600 },
    podOwner,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kubeSourceReason(
  state: SourceState,
  synced: boolean,
  errorCode?: string | null,
): Reason | null {
  switch (state) {
    case 'not_configured':
      return reason('SOURCE_NOT_CONFIGURED', '클러스터 연결 없음', 'unknown');
    case 'unavailable':
      // 인증 실패는 따로 알린다 (토큰 만료. mock으로 대체하지 않는다 — common.md 2.3)
      return errorCode === 'KUBE_AUTH_FAILED'
        ? reason(
            'KUBE_AUTH_FAILED',
            '인증 실패 — 토큰이 만료됐을 수 있습니다',
            'unknown',
          )
        : reason(
            'SOURCE_UNAVAILABLE',
            '알 수 없음 (클러스터 조회 실패)',
            'unknown',
          );
    case 'syncing':
      return synced
        ? null
        : reason('SOURCE_SYNCING', '최초 동기화 중', 'unknown');
    default:
      return null;
  }
}

function itemReasons<T extends { status: StatusInfo }>(
  list: T[],
  label: (x: T) => string,
): Reason[] {
  const bad = list
    .filter((x) => x.status.status !== 'ok')
    .sort(
      (a, b) =>
        statusRank(b.status.status) - statusRank(a.status.status) ||
        (b.status.statusChangedAt ?? '').localeCompare(
          a.status.statusChangedAt ?? '',
        ),
    )
    .slice(0, 3);
  return bad.map((x) => {
    const top =
      x.status.reasons.find((r) => r.status === x.status.status) ??
      x.status.reasons[0];
    return {
      code: top?.code ?? 'UNKNOWN',
      text: `${label(x)} ${top?.text ?? ''}`.trim(),
      status: x.status.status,
    };
  });
}

function problems<T extends { status: StatusInfo }>(
  list: T[],
  ref: (x: T) => ResourceRef,
): ProblemItem[] {
  return list
    .filter(
      (x) => x.status.status === 'critical' || x.status.status === 'warning',
    )
    .sort(
      (a, b) =>
        statusRank(b.status.status) - statusRank(a.status.status) ||
        (b.status.statusChangedAt ?? '').localeCompare(
          a.status.statusChangedAt ?? '',
        ),
    )
    .slice(0, 3)
    .map((x) => {
      const top =
        x.status.reasons.find((r) => r.status === x.status.status) ??
        x.status.reasons[0];
      return { ref: ref(x), status: x.status.status, reason: top?.text ?? '' };
    });
}

export function countStatuses(list: { status: StatusInfo }[]): AreaCounts {
  const c: AreaCounts = { critical: 0, warning: 0, ok: 0, unknown: 0 };
  for (const x of list) c[x.status.status] += 1;
  return c;
}

type Mk = (
  key: string,
  reasons: Reason[],
  stale?: boolean,
  updatedAt?: string | null,
  base?: Status,
) => StatusInfo;

// ---------------------------------------------------------------------------
// 파드
// ---------------------------------------------------------------------------

function worstWaiting(p: RawPod): string | null {
  const list = [...p.initContainers, ...p.containers];
  let found: string | null = null;
  for (const c of list) {
    const st = c.status?.state;
    if (st?.type !== 'waiting' || !st.reason) continue;
    if (WAITING_CRITICAL[st.reason]) return st.reason;
    found ??= st.reason;
  }
  return found;
}

function evaluatePod(
  p: RawPod,
  owner: PodItem['owner'],
  input: EvalInput,
  mk: Mk,
  severeRecent: Map<string, { reason: string; at: number }[]>,
  metricsOk: boolean,
): PodItem {
  const { now, t, store, metrics } = input;
  const key = podKey(p.namespace, p.name);
  const completed = isPodCompleted(p);
  const total = restartTotal(p);
  const r1h = store.history.restartsWithin(key, HOUR_MS, now, total);
  const observedSec = Math.min(3600, r1h.observedSec);
  const ooms1h = store.history.oomsWithin(key, HOUR_MS, now);
  const created = Date.parse(p.createdAt);
  const ageSec = Number.isFinite(created) ? (now - created) / 1000 : 0;
  const waiting = worstWaiting(p);
  const reasons: Reason[] = [];

  const restartText = (n: number) =>
    observedSec < 3600
      ? `최근 ${Math.max(1, Math.round(observedSec / 60))}분 재시작 ${n}회`
      : `최근 1시간 재시작 ${n}회`;

  if (p.phase === 'Pending') {
    const lv = levelByUpper(ageSec, t.podPendingWarnSec, t.podPendingCritSec);
    if (lv !== 'ok')
      reasons.push(
        reason('POD_PENDING', `Pending ${formatDurationKo(ageSec)}`, lv),
      );
  } else if (p.phase === 'Failed') {
    if (owner?.kind === 'Job')
      reasons.push(
        reason(
          'POD_JOB_FAILED',
          'Job 파드 Failed (재시도 설계일 수 있음)',
          'warning',
        ),
      );
    else
      reasons.push(
        reason(
          'POD_FAILED',
          p.statusReason ? `Failed (${p.statusReason})` : 'Failed',
          'critical',
        ),
      );
  } else if (p.phase === 'Unknown') {
    const since = p.conditions.find((c) => c.type === 'Ready')?.since;
    const dur = since ? (now - Date.parse(since)) / 1000 : ageSec;
    reasons.push(
      reason(
        'POD_UNKNOWN',
        `Unknown ${formatDurationKo(dur)}`,
        dur >= t.podUnknownCritSec ? 'critical' : 'warning',
      ),
    );
  }

  if (!completed && waiting) {
    const code = WAITING_CRITICAL[waiting];
    if (code) {
      reasons.push(
        reason(
          `POD_WAITING_${code}`,
          waiting === 'CrashLoopBackOff'
            ? `CrashLoopBackOff · ${restartText(r1h.count)}`
            : waiting,
          'critical',
        ),
      );
    } else if (WAITING_CREATING.has(waiting)) {
      const since = Date.parse(p.startTime ?? p.createdAt);
      const dur = Number.isFinite(since) ? (now - since) / 1000 : ageSec;
      if (dur >= t.podPendingWarnSec)
        reasons.push(
          reason(
            'POD_WAITING_CREATING',
            `${waiting} ${formatDurationKo(dur)}`,
            'warning',
          ),
        );
    }
  }

  if (p.phase === 'Running' && !p.deletionAt) {
    const notReady = p.containers.filter((c) => c.status && !c.status.ready);
    if (notReady.length > 0 && !(waiting && WAITING_CRITICAL[waiting])) {
      const ready = p.conditions.find((c) => c.type === 'Ready');
      const since =
        ready?.value === 'False' && ready.since ? Date.parse(ready.since) : NaN;
      const dur = Number.isFinite(since) ? (now - since) / 1000 : ageSec;
      if (dur >= t.podNotReadyWarnSec)
        reasons.push(
          reason(
            'POD_NOT_READY',
            `준비 안 된 컨테이너 ${notReady.length}개 (${formatDurationKo(dur)})`,
            'warning',
          ),
        );
    }
  }

  if (!completed && r1h.count > 0) {
    const lv = levelByUpper(
      r1h.count,
      t.podRestartsWarn1h,
      t.podRestartsCrit1h,
    );
    // CrashLoopBackOff 사유가 이미 재시작 횟수를 담고 있으면 중복하지 않는다
    if (lv !== 'ok' && waiting !== 'CrashLoopBackOff')
      reasons.push(reason('POD_RESTARTS_1H', restartText(r1h.count), lv));
  }

  if (!completed && ooms1h > 0)
    reasons.push(
      reason('POD_OOM_RECENT', `최근 1시간 OOMKilled ${ooms1h}회`, 'warning'),
    );

  if (p.deletionAt) {
    const dur = (now - Date.parse(p.deletionAt)) / 1000;
    if (dur >= t.podTerminatingWarnSec)
      reasons.push(
        reason(
          'POD_TERMINATING_LONG',
          `종료 중 ${formatDurationKo(dur)}`,
          'warning',
        ),
      );
  }

  const sev = severeRecent.get(`Pod/${p.namespace}/${p.name}`);
  if (sev && !completed) {
    const names = [...new Set(sev.map((s) => s.reason))].join(', ');
    reasons.push(
      reason(
        'POD_SEVERE_EVENT',
        `${names} (최근 ${Math.round(t.eventWindowSec / 60)}분)`,
        'warning',
      ),
    );
  }

  // 사용량
  const requests = sumAmounts(p.containers, 'requests');
  const limits = sumAmounts(p.containers, 'limits');
  const u = metricsOk ? metrics.state.pods.get(key) : undefined;
  const usage = u
    ? {
        cpuMillicores: Math.round(u.cpuMillicores),
        memoryBytes: Math.round(u.memoryBytes),
        updatedAt: metrics.state.collectedAt ?? new Date(now).toISOString(),
      }
    : null;
  const memoryLimitPct = usage
    ? pctOrNull(usage.memoryBytes, limits.memoryBytes)
    : null;
  const cpuRequestPct = usage
    ? pctOrNull(usage.cpuMillicores, requests.cpuMillicores)
    : null;
  const memSustained = metrics.sustained.get(`pod:mem:${key}`);
  if (
    !completed &&
    memoryLimitPct !== null &&
    (memSustained === 'warning' || memSustained === 'critical')
  ) {
    reasons.push(
      reason(
        'POD_MEMORY_LIMIT',
        `메모리 limit 대비 ${Math.round(memoryLimitPct)}%`,
        memSustained,
      ),
    );
  }

  const lastTerm = [...p.containers]
    .map((c) => c.status?.lastTermination)
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))[0];

  return {
    namespace: p.namespace,
    name: p.name,
    key,
    status: mk(`pod:${key}`, dedupeReasons(reasons)),
    isSystemNamespace: input.systemNamespaces.has(p.namespace),
    phase: p.phase,
    terminatingSince: p.deletionAt,
    completed,
    owner,
    nodeName: p.nodeName,
    containers: {
      ready: p.containers.filter((c) => c.status?.ready).length,
      total: p.containers.length,
    },
    restarts: { total, last1h: r1h.count, observedSec },
    waitingReason: waiting,
    lastTermination: lastTerm
      ? {
          reason: lastTerm.reason,
          exitCode: lastTerm.exitCode,
          finishedAt: lastTerm.finishedAt,
        }
      : null,
    startedAt: p.startTime,
    createdAt: p.createdAt,
    qosClass: p.qosClass,
    usage,
    requests,
    limits,
    memoryLimitPct,
    cpuRequestPct,
    // 진입점 1·2·7 (파드 상세·파드 목록 행·DB 파드). 규칙은 logs/log-href.ts 한 곳이다
    logHref: buildPodKeyLogHref(input.logLinks ?? NO_LOG_LINKS, 'pod', key),
  };
}

function dedupeReasons(rs: Reason[]): Reason[] {
  const seen = new Set<string>();
  return rs.filter((r) => {
    const k = `${r.code}|${r.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 노드
// ---------------------------------------------------------------------------

function condOf(n: RawNode, type: string) {
  return n.conditions.find((c) => c.type === type) ?? null;
}

function evaluateNode(
  n: RawNode,
  pods: RawPod[],
  input: EvalInput,
  mk: Mk,
  severeRecent: Map<string, { reason: string; at: number }[]>,
  metricsOk: boolean,
): NodeItem {
  const { now, t, metrics } = input;
  const reasons: Reason[] = [];
  const ready = condOf(n, 'Ready');
  const readyValue = ready?.value ?? 'Unknown';
  if (readyValue !== 'True') {
    const since = ready?.since ? Date.parse(ready.since) : NaN;
    const dur = Number.isFinite(since) ? (now - since) / 1000 : Infinity;
    reasons.push(
      reason(
        'NODE_NOT_READY',
        Number.isFinite(dur) ? `NotReady ${formatDurationKo(dur)}` : 'NotReady',
        dur >= t.nodeNotReadyCritSec ? 'critical' : 'warning',
      ),
    );
  }
  const mem = condOf(n, 'MemoryPressure')?.value === 'True';
  const disk = condOf(n, 'DiskPressure')?.value === 'True';
  const pid = condOf(n, 'PIDPressure')?.value === 'True';
  const net = condOf(n, 'NetworkUnavailable')?.value === 'True';
  if (mem)
    reasons.push(reason('NODE_MEMORY_PRESSURE', 'MemoryPressure', 'warning'));
  if (disk)
    reasons.push(reason('NODE_DISK_PRESSURE', 'DiskPressure', 'warning'));
  if (pid) reasons.push(reason('NODE_PID_PRESSURE', 'PIDPressure', 'warning'));
  if (net)
    reasons.push(
      reason('NODE_NETWORK_UNAVAILABLE', 'NetworkUnavailable', 'critical'),
    );
  if (n.unschedulable)
    reasons.push(reason('NODE_CORDONED', '스케줄 제외 (cordon)', 'warning'));

  const alloc = n.allocatable;
  let reqCpu = 0;
  let reqMem = 0;
  let limCpu = 0;
  let limMem = 0;
  for (const p of pods) {
    const r = sumAmountsLoose(p.containers, 'requests');
    const l = sumAmountsLoose(p.containers, 'limits');
    reqCpu += r.cpu;
    reqMem += r.mem;
    limCpu += l.cpu;
    limMem += l.mem;
  }
  const requests = {
    cpuMillicores: reqCpu,
    memoryBytes: reqMem,
    cpuPct: pct(reqCpu, alloc.cpuMillicores),
    memoryPct: pct(reqMem, alloc.memoryBytes),
  };
  const limits = {
    cpuMillicores: limCpu,
    memoryBytes: limMem,
    cpuPct: pct(limCpu, alloc.cpuMillicores),
    memoryPct: pct(limMem, alloc.memoryBytes),
  };
  const podCount = pods.length;
  const podsPct = pct(podCount, alloc.pods);

  const u = metricsOk ? metrics.state.nodes.get(n.name) : undefined;
  const usage = u
    ? {
        cpuMillicores: Math.round(u.cpuMillicores),
        memoryBytes: Math.round(u.memoryBytes),
        cpuPct: pct(u.cpuMillicores, alloc.cpuMillicores),
        memoryPct: pct(u.memoryBytes, alloc.memoryBytes),
        updatedAt: metrics.state.collectedAt ?? new Date(now).toISOString(),
      }
    : null;
  if (usage) {
    const cpuS = metrics.sustained.get(`node:cpu:${n.name}`);
    const memS = metrics.sustained.get(`node:mem:${n.name}`);
    if (cpuS === 'warning' || cpuS === 'critical')
      reasons.push(
        reason(
          'NODE_CPU_USAGE',
          `CPU ${Math.round(usage.cpuPct)}% (연속 ${t.sustainSamples}회)`,
          cpuS,
        ),
      );
    if (memS === 'warning' || memS === 'critical')
      reasons.push(
        reason(
          'NODE_MEMORY_USAGE',
          `메모리 ${Math.round(usage.memoryPct)}% (연속 ${t.sustainSamples}회)`,
          memS,
        ),
      );
  }
  if (requests.cpuPct >= t.nodeRequestsWarnPct)
    reasons.push(
      reason(
        'NODE_REQUESTS_HIGH',
        `CPU requests ${Math.round(requests.cpuPct)}% (스케줄 여유 부족)`,
        'warning',
      ),
    );
  if (requests.memoryPct >= t.nodeRequestsWarnPct)
    reasons.push(
      reason(
        'NODE_REQUESTS_HIGH',
        `메모리 requests ${Math.round(requests.memoryPct)}% (스케줄 여유 부족)`,
        'warning',
      ),
    );
  if (alloc.pods > 0) {
    const lv = levelByUpper(podsPct, t.nodePodsWarnPct, t.nodePodsCritPct);
    if (lv !== 'ok')
      reasons.push(
        reason('NODE_PODS_HIGH', `파드 ${podCount}/${alloc.pods}`, lv),
      );
  }
  const sev = severeRecent.get(`Node//${n.name}`);
  if (sev) {
    const names = [...new Set(sev.map((s) => s.reason))].join(', ');
    reasons.push(
      reason(
        'NODE_SEVERE_EVENT',
        `최근 ${Math.round(t.eventWindowSec / 60)}분 ${names} 이벤트`,
        'warning',
      ),
    );
  }

  return {
    name: n.name,
    status: mk(`node:${n.name}`, reasons),
    role: n.role,
    instanceType: n.instanceType,
    zone: n.zone,
    nodeGroup: n.nodeGroup,
    capacityType: n.capacityType,
    architecture: n.architecture,
    kubeletVersion: n.kubeletVersion,
    createdAt: n.createdAt,
    ready: { value: readyValue, since: ready?.since ?? null },
    unschedulable: n.unschedulable,
    pressure: { memory: mem, disk: disk, pid: pid, networkUnavailable: net },
    allocatable: { ...alloc },
    usage,
    requests,
    limits,
    pods: { count: podCount, max: alloc.pods, pct: podsPct },
  };
}

// ---------------------------------------------------------------------------
// 워크로드
// ---------------------------------------------------------------------------

function evaluateWorkload(
  w: RawWorkload,
  podItems: PodItem[],
  rawPods: RawPod[],
  input: EvalInput,
  mk: Mk,
): WorkloadItem {
  const { store } = input;
  const reasons: Reason[] = [];
  const desired = w.desired;
  const stopped = desired === 0;
  let rollout: WorkloadItem['rollout'] = { state: 'unknown', reason: null };
  let lastRolloutAt: string | null = null;

  if (w.kind === 'Deployment') {
    const prog = w.conditions.find((c) => c.type === 'Progressing');
    lastRolloutAt = prog?.lastUpdateAt ?? prog?.since ?? null;
    const genPending =
      w.generation !== null &&
      w.observedGeneration !== null &&
      w.observedGeneration < w.generation;
    if (prog?.reason === 'ProgressDeadlineExceeded') {
      rollout = { state: 'failed', reason: prog.reason };
    } else if (
      genPending ||
      (desired !== null && (w.updated ?? 0) < desired) ||
      (prog &&
        prog.value === 'True' &&
        prog.reason !== 'NewReplicaSetAvailable')
    ) {
      rollout = { state: 'progressing', reason: prog?.reason ?? null };
    } else {
      rollout = { state: 'complete', reason: prog?.reason ?? null };
    }
  } else {
    const pending =
      w.revisionPending ||
      (desired !== null && w.updated !== null && w.updated < desired);
    rollout = { state: pending ? 'progressing' : 'complete', reason: null };
    const times = rawPods
      .map((p) => Date.parse(p.createdAt))
      .filter((x) => Number.isFinite(x));
    lastRolloutAt = times.length
      ? new Date(Math.min(...times)).toISOString()
      : null;
  }

  if (stopped) {
    reasons.push(reason('WORKLOAD_STOPPED', '중지됨 (desired 0)', 'ok'));
  } else if (desired !== null) {
    if (w.ready === 0)
      reasons.push(
        reason('WORKLOAD_NO_READY', `ready 0/${desired}`, 'critical'),
      );
    else if (w.ready < desired)
      reasons.push(
        reason(
          'WORKLOAD_PARTIAL_READY',
          `ready ${w.ready}/${desired}`,
          'warning',
        ),
      );
    if (rollout.state === 'failed')
      reasons.push(
        reason(
          'WORKLOAD_ROLLOUT_FAILED',
          rollout.reason ?? 'ProgressDeadlineExceeded',
          'critical',
        ),
      );
    else if (rollout.state === 'progressing')
      reasons.push(
        reason('WORKLOAD_ROLLOUT_PROGRESSING', '롤아웃 진행 중', 'warning'),
      );
  }

  const active = podItems.filter((p) => !p.completed);
  const hpa = [...store.hpas.values()].find(
    (h) =>
      h.namespace === w.namespace &&
      h.target.kind === w.kind &&
      h.target.name === w.name,
  );
  const hasPdb = [...store.pdbs.values()].some(
    (p) =>
      p.namespace === w.namespace &&
      selectorMatches(p.selector, w.templateLabels),
  );
  const key = workloadKey(w.kind, w.namespace, w.name);
  return {
    kind: w.kind,
    namespace: w.namespace,
    name: w.name,
    key,
    status: mk(`workload:${key}`, reasons),
    isSystemNamespace: input.systemNamespaces.has(w.namespace),
    replicas: {
      desired,
      ready: w.ready,
      updated: w.updated,
      available: w.available,
    },
    stopped,
    rollout,
    images: w.containers.map((c) => c.image),
    createdAt: w.createdAt,
    lastRolloutAt,
    podCounts: countStatuses(active),
    hasPdb,
    hpa: hpa
      ? {
          minReplicas: hpa.minReplicas,
          maxReplicas: hpa.maxReplicas,
          currentReplicas: hpa.currentReplicas,
        }
      : null,
    source: 'watch',
    // 진입점 5: 소속 파드 선택기가 붙은 로그 화면 (logs.md 11.4)
    logHref: buildLogHref(input.logLinks ?? NO_LOG_LINKS, {
      entry: 'workload',
      namespace: w.namespace,
      workloadKey: key,
    }).href,
  };
}

// ---------------------------------------------------------------------------
// PVC
// ---------------------------------------------------------------------------

function evaluatePvc(
  pvc: RawPvc,
  isDb: boolean,
  mountedBy: ResourceRef[],
  input: EvalInput,
  mk: Mk,
  approx: { bytes: number; measuredAt: string } | null,
): PvcItem {
  const { now, t } = input;
  const key = podKey(pvc.namespace, pvc.name);
  const reasons: Reason[] = [];
  if (pvc.phase === 'Lost')
    reasons.push(reason('PVC_LOST', 'Lost', 'critical'));
  if (pvc.phase === 'Pending') {
    const dur = (now - Date.parse(pvc.createdAt)) / 1000;
    if (dur >= t.pvcPendingWarnSec)
      reasons.push(
        reason('PVC_PENDING', `Pending ${formatDurationKo(dur)}`, 'warning'),
      );
  }
  let usage: PvcItem['usage'] = null;
  const prom = input.pvcUsageProm?.values.get(key);
  if (prom !== undefined && pvc.capacityBytes) {
    usage = {
      usedBytes: Math.round(prom),
      pct: pct(prom, pvc.capacityBytes),
      source: 'prometheus',
      updatedAt: input.pvcUsageProm!.at,
    };
  } else if (isDb && approx && pvc.capacityBytes) {
    usage = {
      usedBytes: approx.bytes,
      pct: pct(approx.bytes, pvc.capacityBytes),
      source: 'db_size_approx',
      updatedAt: approx.measuredAt,
    };
  }
  if (usage) {
    const lv = levelByUpper(usage.pct, t.pvcUsageWarnPct, t.pvcUsageCritPct);
    if (lv !== 'ok')
      reasons.push(
        reason(
          'PVC_USAGE',
          `사용률 ${Math.round(usage.pct)}%${usage.source === 'db_size_approx' ? ' (근사치)' : ''}`,
          lv,
        ),
      );
  }
  return {
    namespace: pvc.namespace,
    name: pvc.name,
    key,
    status: mk(`pvc:${key}`, reasons),
    phase: pvc.phase,
    phaseSince: pvc.createdAt,
    capacityBytes: pvc.capacityBytes,
    requestedBytes: pvc.requestedBytes,
    storageClass: pvc.storageClass,
    volumeName: pvc.volumeName,
    usage,
    mountedBy,
    isDbVolume: isDb,
  };
}

// ---------------------------------------------------------------------------
// 클러스터 메트릭
// ---------------------------------------------------------------------------

function evaluateClusterMetrics(
  input: EvalInput,
  nodes: Map<string, RawNode>,
  podsByNode: Map<string, RawPod[]>,
  metricsOk: boolean,
  metricsStale: boolean,
  mk: Mk,
): ClusterMetricsBody {
  const { t, metrics } = input;
  // 클러스터 합계는 **워커만** (AC-KOPS12). 마스터는 controlPlane 블록으로 분리한다
  const acc = () => ({
    allocCpu: 0,
    allocMem: 0,
    useCpu: 0,
    useMem: 0,
    reqCpu: 0,
    reqMem: 0,
    limCpu: 0,
    limMem: 0,
    count: 0,
  });
  const worker = acc();
  const master = acc();
  for (const n of nodes.values()) {
    const a = n.role === 'control_plane' ? master : worker;
    a.count += 1;
    a.allocCpu += n.allocatable.cpuMillicores;
    a.allocMem += n.allocatable.memoryBytes;
    const u = metrics.state.nodes.get(n.name);
    if (u) {
      a.useCpu += u.cpuMillicores;
      a.useMem += u.memoryBytes;
    }
    for (const p of podsByNode.get(n.name) ?? []) {
      const r = sumAmountsLoose(p.containers, 'requests');
      const l = sumAmountsLoose(p.containers, 'limits');
      a.reqCpu += r.cpu;
      a.reqMem += r.mem;
      a.limCpu += l.cpu;
      a.limMem += l.mem;
    }
  }
  const { allocCpu, allocMem, useCpu, useMem, reqCpu, reqMem, limCpu, limMem } =
    worker;
  const updatedAt = metrics.state.collectedAt;
  const src = input.metricsSource.state;
  const unavailable: Reason | null =
    src === 'not_configured'
      ? reason('SOURCE_NOT_CONFIGURED', '클러스터 연결 없음', 'unknown')
      : !metricsOk
        ? reason(
            'SOURCE_UNAVAILABLE',
            metrics.state.unavailableReason?.code === 'METRICS_API_UNAVAILABLE'
              ? '알 수 없음 (metrics-server 없음)'
              : '알 수 없음 (메트릭 조회 실패)',
            'unknown',
          )
        : null;

  const usageStatus = (
    kind: 'cpu' | 'mem',
    usagePct: number | null,
  ): StatusInfo => {
    if (unavailable)
      return mk(`cluster:${kind}`, [unavailable], metricsStale, updatedAt);
    const s = metrics.sustained.get(`cluster:${kind}`) ?? 'ok';
    const rs: Reason[] = [];
    if ((s === 'warning' || s === 'critical') && usagePct !== null)
      rs.push(
        reason(
          kind === 'cpu' ? 'CLUSTER_CPU_USAGE' : 'CLUSTER_MEMORY_USAGE',
          `${kind === 'cpu' ? 'CPU' : '메모리'} 사용률 ${Math.round(usagePct)}% (연속 ${t.sustainSamples}회)`,
          s,
        ),
      );
    return mk(`cluster:${kind}`, rs, metricsStale, updatedAt);
  };
  const cpuUsagePct = metricsOk ? pct(useCpu, allocCpu) : null;
  const memUsagePct = metricsOk ? pct(useMem, allocMem) : null;
  const since = metrics.seriesSince;
  const controlPlane: ControlPlaneMetricsBlock =
    master.count === 0
      ? { available: false, nodeCount: 0, cpu: null, memory: null }
      : {
          available: true,
          nodeCount: master.count,
          cpu: {
            allocatableMillicores: master.allocCpu,
            usageMillicores: metricsOk ? Math.round(master.useCpu) : null,
            usagePct: metricsOk ? pct(master.useCpu, master.allocCpu) : null,
            requestsMillicores: master.reqCpu,
            requestsPct: pct(master.reqCpu, master.allocCpu),
            limitsMillicores: master.limCpu,
            limitsPct: pct(master.limCpu, master.allocCpu),
          },
          memory: {
            allocatableBytes: master.allocMem,
            usageBytes: metricsOk ? Math.round(master.useMem) : null,
            usagePct: metricsOk ? pct(master.useMem, master.allocMem) : null,
            requestsBytes: master.reqMem,
            requestsPct: pct(master.reqMem, master.allocMem),
            limitsBytes: master.limMem,
            limitsPct: pct(master.limMem, master.allocMem),
          },
        };
  return {
    available: metricsOk,
    unavailableReason: metricsOk
      ? null
      : (metrics.state.unavailableReason ??
        (src === 'not_configured'
          ? { code: 'SOURCE_NOT_CONFIGURED', message: '클러스터 연결 없음' }
          : { code: 'METRICS_NOT_COLLECTED', message: '아직 수집 전' })),
    updatedAt,
    scope: {
      basis: 'worker',
      workerNodeCount: worker.count,
      controlPlaneNodeCount: master.count,
    },
    cpu: {
      status: usageStatus('cpu', cpuUsagePct),
      allocatableMillicores: allocCpu,
      usageMillicores: metricsOk ? Math.round(useCpu) : null,
      usagePct: cpuUsagePct,
      requestsMillicores: reqCpu,
      requestsPct: pct(reqCpu, allocCpu),
      limitsMillicores: limCpu,
      limitsPct: pct(limCpu, allocCpu),
    },
    memory: {
      status: usageStatus('mem', memUsagePct),
      allocatableBytes: allocMem,
      usageBytes: metricsOk ? Math.round(useMem) : null,
      usagePct: memUsagePct,
      requestsBytes: reqMem,
      requestsPct: pct(reqMem, allocMem),
      limitsBytes: limMem,
      limitsPct: pct(limMem, allocMem),
    },
    controlPlane,
    thresholds: {
      cpu: { warnPct: t.nodeCpuWarnPct, critPct: t.nodeCpuCritPct },
      memory: { warnPct: t.nodeMemoryWarnPct, critPct: t.nodeMemoryCritPct },
    },
    history: {
      source: 'in_memory',
      maxRangeSec: 3600,
      stepSec: input.metricsIntervalSec,
      observedSec:
        since === null
          ? 0
          : Math.min(3600, Math.floor((input.now - since) / 1000)),
    },
  };
}

// ---------------------------------------------------------------------------
// 상세 (노드 조건, 파드 컨테이너, 워크로드 조건)
// ---------------------------------------------------------------------------

export function nodeConditions(n: RawNode, now: number, t: ClusterThresholds) {
  const types = [
    'Ready',
    'MemoryPressure',
    'DiskPressure',
    'PIDPressure',
    'NetworkUnavailable',
  ];
  return types.map((type) => {
    const c = condOf(n, type);
    let status: Status = 'ok';
    if (!c) status = 'ok';
    else if (type === 'Ready') {
      if (c.value !== 'True') {
        const dur = c.since ? (now - Date.parse(c.since)) / 1000 : Infinity;
        status = dur >= t.nodeNotReadyCritSec ? 'critical' : 'warning';
      }
    } else if (c.value === 'Unknown') status = 'unknown';
    else if (c.value === 'True')
      status = type === 'NetworkUnavailable' ? 'critical' : 'warning';
    return {
      type,
      value: c?.value ?? null,
      since: c?.since ?? null,
      reason: c?.reason ?? null,
      message: c?.message ? cleanText(c.message, 300) : null,
      status,
    };
  });
}

export function workloadConditions(w: RawWorkload) {
  return w.conditions.map((c) => ({
    type: c.type,
    value: c.value,
    reason: c.reason,
    message: c.message ? cleanText(c.message, 300) : null,
    since: c.since,
  }));
}

export interface ContainerDetail {
  name: string;
  init: boolean;
  image: string;
  status: StatusInfo;
  ready: boolean;
  state: {
    type: 'running' | 'waiting' | 'terminated';
    reason: string | null;
    message: string | null;
    since: string | null;
  } | null;
  restarts: { total: number; last1h: number };
  lastTermination: {
    reason: string | null;
    exitCode: number | null;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  requests: { cpuMillicores: number | null; memoryBytes: number | null };
  limits: { cpuMillicores: number | null; memoryBytes: number | null };
  usage: { cpuMillicores: number; memoryBytes: number } | null;
  memoryLimitPct: number | null;
  probes: { readiness: boolean; liveness: boolean; startup: boolean };
}

export function podContainers(
  p: RawPod,
  podItem: PodItem,
  input: Pick<EvalInput, 'now' | 't' | 'metrics' | 'tracker'> & {
    kubeStale: boolean;
    updatedAt: string | null;
  },
): ContainerDetail[] {
  const { t, metrics } = input;
  const atIso = new Date(input.now).toISOString();
  const u = metrics.state.pods.get(podItem.key);
  const podRestarts = podItem.restarts;
  const podTotal = podRestarts.total;
  const list = [
    ...p.initContainers.filter((c) => {
      const st = c.status?.state;
      if (!st) return false;
      if (st.type === 'waiting') return true;
      return st.type === 'terminated' && (st.exitCode ?? 0) !== 0;
    }),
    ...p.containers,
  ];
  const out = list.map((c): ContainerDetail => {
    const st = c.status?.state ?? null;
    const reasons: Reason[] = [];
    if (st?.type === 'waiting' && st.reason) {
      if (WAITING_CRITICAL[st.reason])
        reasons.push(
          reason(
            `CONTAINER_WAITING_${WAITING_CRITICAL[st.reason]}`,
            `대기: ${st.reason}`,
            'critical',
          ),
        );
      else
        reasons.push(
          reason('CONTAINER_WAITING', `대기: ${st.reason}`, 'warning'),
        );
    } else if (st?.type === 'terminated' && (st.exitCode ?? 0) !== 0) {
      reasons.push(
        reason(
          'CONTAINER_TERMINATED',
          `종료: ${st.reason ?? 'Error'} (exit ${st.exitCode ?? '?'})`,
          c.init ? 'critical' : 'warning',
        ),
      );
    } else if (
      !c.init &&
      c.status &&
      !c.status.ready &&
      p.phase === 'Running'
    ) {
      reasons.push(reason('CONTAINER_NOT_READY', '준비 안 됨', 'warning'));
    }
    const cu = u?.containers.get(c.name);
    const memPct =
      cu && c.limits.memoryBytes
        ? round1((cu.memoryBytes / c.limits.memoryBytes) * 100)
        : null;
    if (memPct !== null) {
      const lv = levelByUpper(
        memPct,
        t.podMemoryLimitWarnPct,
        t.podMemoryLimitCritPct,
      );
      if (lv !== 'ok')
        reasons.push(
          reason(
            'CONTAINER_MEMORY_LIMIT',
            `메모리 limit 대비 ${Math.round(memPct)}%`,
            lv,
          ),
        );
    }
    if (c.status?.lastTermination?.reason === 'OOMKilled')
      reasons.push(
        reason('CONTAINER_OOM', '마지막 종료: OOMKilled', 'warning'),
      );
    const r = statusFromReasons(reasons);
    const restartCount = c.status?.restartCount ?? 0;
    // 컨테이너별 1시간 증가분은 파드 합계를 비율로 나눈 근사 (단일 컨테이너면 정확)
    const last1h =
      podTotal > 0
        ? Math.round((podRestarts.last1h * restartCount) / podTotal)
        : 0;
    return {
      name: c.name,
      init: c.init,
      image: c.image,
      status: {
        status: r.status,
        reasons: r.reasons,
        updatedAt: input.updatedAt,
        statusChangedAt: input.tracker.track(
          `container:${podItem.key}/${c.name}`,
          r.status,
          atIso,
        ),
        stale: input.kubeStale,
      },
      ready: c.status?.ready ?? false,
      state: st
        ? {
            type: st.type,
            reason: st.reason,
            message: st.message ? cleanText(st.message, 300) : null,
            since: st.since,
          }
        : null,
      restarts: { total: restartCount, last1h },
      lastTermination: c.status?.lastTermination ?? null,
      requests: { ...c.requests },
      limits: { ...c.limits },
      usage: cu
        ? {
            cpuMillicores: Math.round(cu.cpuMillicores),
            memoryBytes: Math.round(cu.memoryBytes),
          }
        : null,
      memoryLimitPct: memPct,
      probes: { ...c.probes },
    };
  });
  return out.sort(
    (a, b) =>
      statusRank(b.status.status) - statusRank(a.status.status) ||
      a.name.localeCompare(b.name),
  );
}
