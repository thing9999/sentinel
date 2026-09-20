import { Injectable } from '@nestjs/common';
import {
  AdvisorSnapshotContributorProvider,
  type AdvisorSnapshotContributor,
} from '../common/extension-points';
import { round1 } from '../common/status';
import { eksSupportTier } from '../cost/estimate/eks-support';
import { podKey, workloadKey } from './model';
import { ClusterStateService } from './state/cluster-state.service';
import { restartTotal } from './state/cluster-store';
import { isPodCompleted } from './state/evaluate';

const DAY_MS = 86_400_000;
const STD_LABELS = [
  'app.kubernetes.io/name',
  'app.kubernetes.io/component',
  'app.kubernetes.io/part-of',
  'app.kubernetes.io/version',
  'app.kubernetes.io/managed-by',
];

/**
 * 이미지에서 레지스트리 호스트(계정 ID 포함)와 digest를 뺀다 (architecture-advisor B.2).
 * 예: 123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2 → api:1.4.2, nginx:1.27 → library/nginx:1.27
 */
export function stripImage(image: string): string {
  const noDigest = image.split('@')[0];
  const parts = noDigest.split('/');
  if (parts.length === 1) return `library/${noDigest}`; // Docker Hub 공식 이미지
  if (
    parts[0].includes('.') ||
    parts[0].includes(':') ||
    parts[0] === 'localhost'
  ) {
    parts.shift();
  }
  return parts.join('/');
}

function stats(values: (number | null)[]): {
  avg: number | null;
  max: number | null;
} {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length === 0) return { avg: null, max: null };
  return {
    avg: round1(v.reduce((a, b) => a + b, 0) / v.length),
    max: round1(Math.max(...v)),
  };
}

/**
 * 어드바이저 스냅샷의 클러스터 부분 (docs/api/architecture-advisor.md B.2 `AdvisorSnapshotV1`).
 * - 허용 목록 방식: 정리된 필드만. env·command/args·어노테이션 원문·secrets·IP 없음.
 * - 네임스페이스·워크로드·노드그룹·PVC·노드 이름은 원문 (IP 형태 노드 이름의 가명 처리·비밀값 검사·규모 제한은 어드바이저 모듈 몫).
 * - 비용 필드(estimatedUsdPerMonth, usdPerMonth, volumeRef)는 null — 비용 기여자(section 'cost')가 채운다.
 */
@Injectable()
@AdvisorSnapshotContributorProvider()
export class ClusterAdvisorSnapshot implements AdvisorSnapshotContributor {
  readonly section = 'cluster' as const;

  constructor(private readonly state: ClusterStateService) {}

  contribute(): Promise<unknown> {
    const v = this.state.getView();
    const store = this.state.store;
    const metrics = this.state.metrics;
    const now = v.at;
    const info = this.state.clusterInfo();
    const verMatch = /^v?(\d+\.\d+)/.exec(info.version ?? '');

    // 노드
    const nodeGroupOf = new Map<string, string | null>();
    const nodes = v.nodes.map((n) => {
      nodeGroupOf.set(n.name, n.nodeGroup);
      const series = metrics.series.get(`node:${n.name}`);
      const cpu = stats(series.map((p) => p.cpuPct));
      const mem = stats(series.map((p) => p.memoryPct));
      return {
        name: n.name,
        nodeGroup: n.nodeGroup,
        instanceType: n.instanceType,
        architecture: n.architecture,
        capacityType: n.capacityType,
        zone: n.zone,
        allocatable: { ...n.allocatable },
        cpu: {
          currentPct: n.usage?.cpuPct ?? null,
          avgPct: cpu.avg,
          maxPct: cpu.max,
          requestsPct: n.requests.cpuPct,
        },
        memory: {
          currentPct: n.usage?.memoryPct ?? null,
          avgPct: mem.avg,
          maxPct: mem.max,
          requestsPct: n.requests.memoryPct,
        },
        podCount: n.pods.count,
        status: n.status.status,
        reasonCodes: [...new Set(n.status.reasons.map((r) => r.code))],
      };
    });

    // 노드그룹
    const groups = new Map<string, typeof nodes>();
    for (const n of nodes) {
      const g = n.nodeGroup ?? '(none)';
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(n);
    }
    const activePods = [...store.pods.values()].filter(
      (p) => !isPodCompleted(p),
    );
    const nodeGroups = [...groups].map(([name, list]) => {
      const types = new Map<string, number>();
      for (const n of list)
        if (n.instanceType)
          types.set(n.instanceType, (types.get(n.instanceType) ?? 0) + 1);
      const caps = new Set(list.map((n) => n.capacityType));
      const nodeNames = new Set(list.map((n) => n.name));
      const groupPods = activePods.filter(
        (p) =>
          p.nodeName &&
          nodeNames.has(p.nodeName) &&
          p.owner?.kind !== 'DaemonSet',
      );
      const statelessOnly =
        groupPods.length > 0 &&
        groupPods.every(
          (p) =>
            v.podMap.get(podKey(p.namespace, p.name))?.owner?.kind ===
              'Deployment' && p.pvcClaims.length === 0,
        );
      const avg = (f: (n: (typeof nodes)[number]) => number | null) =>
        stats(list.map(f)).avg;
      const max = (f: (n: (typeof nodes)[number]) => number | null) =>
        stats(list.map(f)).max;
      return {
        name,
        instanceTypes: [...types].map(([type, count]) => ({ type, count })),
        architecture: list[0]?.architecture ?? null,
        capacityType:
          caps.size === 1
            ? ([...caps][0] ?? null)
            : caps.size > 1
              ? 'mixed'
              : null,
        zones: [
          ...new Set(list.map((n) => n.zone).filter(Boolean)),
        ] as string[],
        nodeCount: list.length,
        cpu: {
          avgPct: avg((n) => n.cpu.avgPct),
          maxPct: max((n) => n.cpu.maxPct),
          requestsPct: avg((n) => n.cpu.requestsPct) ?? 0,
        },
        memory: {
          avgPct: avg((n) => n.memory.avgPct),
          maxPct: max((n) => n.memory.maxPct),
          requestsPct: avg((n) => n.memory.requestsPct) ?? 0,
        },
        statelessOnly,
        estimatedUsdPerMonth: null,
      };
    });

    // 워크로드
    const workloads = v.workloads.map((w) => {
      const raw = store.workloads.get(workloadKey(w.kind, w.namespace, w.name));
      const pods = v.pods.filter(
        (p) => p.owner?.workloadKey === w.key && !p.completed,
      );
      let restarts24h = 0;
      let oom24h = 0;
      for (const p of pods) {
        const rp = store.pods.get(p.key);
        restarts24h += store.history.restartsWithin(
          p.key,
          DAY_MS,
          now,
          rp ? restartTotal(rp) : p.restarts.total,
        ).count;
        oom24h += store.history.oomsWithin(p.key, DAY_MS, now);
      }
      const podSeries = pods.map((p) => metrics.series.get(`pod:${p.key}`));
      const cpuVals = podSeries.flat().map((pt) => pt.cpuMillicores);
      const memVals = podSeries.flat().map((pt) => pt.memoryBytes);
      const cpuS = stats(cpuVals);
      const memS = stats(memVals);
      const containers = (raw?.containers ?? []).map((c, _i, arr) => {
        // 컨테이너별 표본이 없으므로 파드 합계를 현재 사용 비율로 나눈 근사
        let share = arr.length === 1 ? 1 : 0;
        if (arr.length > 1) {
          let tot = 0;
          let mine = 0;
          for (const p of pods) {
            const u = metrics.state.pods.get(p.key);
            if (!u) continue;
            for (const [name, cu] of u.containers) {
              tot += cu.cpuMillicores;
              if (name === c.name) mine += cu.cpuMillicores;
            }
          }
          share = tot > 0 ? mine / tot : 1 / arr.length;
        }
        const has = cpuS.avg !== null || memS.avg !== null;
        return {
          name: c.name,
          image: stripImage(c.image),
          requests: { ...c.requests },
          limits: { ...c.limits },
          usage: has
            ? {
                cpuAvgMillicores:
                  cpuS.avg === null ? null : Math.round(cpuS.avg * share),
                cpuMaxMillicores:
                  cpuS.max === null ? null : Math.round(cpuS.max * share),
                memoryAvgBytes:
                  memS.avg === null ? null : Math.round(memS.avg * share),
                memoryMaxBytes:
                  memS.max === null ? null : Math.round(memS.max * share),
              }
            : null,
          probes: {
            readiness: c.probes.readiness,
            liveness: c.probes.liveness,
          },
          security: { ...c.security },
        };
      });
      const sec = raw?.podSecurity;
      const labels: Record<string, string> = {};
      for (const k of STD_LABELS) {
        const val = raw?.templateLabels[k];
        if (val) labels[k] = val;
      }
      return {
        kind: w.kind,
        namespace: w.namespace,
        name: w.name,
        desired: w.replicas.desired,
        ready: w.replicas.ready,
        nodeGroups: [
          ...new Set(
            pods
              .map((p) => (p.nodeName ? nodeGroupOf.get(p.nodeName) : null))
              .filter((g): g is string => Boolean(g)),
          ),
        ],
        containers,
        podSecurity: {
          hostNetwork: sec?.hostNetwork ?? false,
          hostPID: sec?.hostPID ?? false,
          hostPath: sec?.hostPath ?? false,
          defaultServiceAccount:
            !sec?.serviceAccountName || sec.serviceAccountName === 'default',
          automountToken: sec?.automountToken ?? null,
        },
        hasPdb: w.hasPdb,
        hpa: w.hpa ? { min: w.hpa.minReplicas, max: w.hpa.maxReplicas } : null,
        restarts24h,
        oom24h,
        status: w.status.status,
        isSystemNamespace: w.isSystemNamespace,
        labels,
      };
    });

    // 스토리지
    const storage = v.pvcs.map((p) => ({
      namespace: p.namespace,
      name: p.name,
      capacityBytes: p.capacityBytes,
      volumeType: p.storageClass,
      volumeRef: null,
      usagePct: p.usage?.pct ?? null,
      usageSource: p.usage?.source ?? null,
      attached: p.mountedBy.length > 0,
      usdPerMonth: null,
      isDbVolume: p.isDbVolume,
    }));

    // 이벤트 (개수만, message 없음)
    const byReason = new Map<
      string,
      { reason: string; kind: string; count: number }
    >();
    for (const e of v.events) {
      const k = `${e.reason}|${e.involvedObject.kind}`;
      const cur = byReason.get(k) ?? {
        reason: e.reason,
        kind: e.involvedObject.kind,
        count: 0,
      };
      cur.count += e.count;
      byReason.set(k, cur);
    }

    // 로드밸런서 (쿠버네티스 쪽: LoadBalancer Service, ALB Ingress). 이름·ARN·DNS 대신 가명 lb-<n>.
    // 대상 상태·단가는 비용 기여자(section 'cost')가 같은 attachedTo로 채운다.
    const loadBalancers: {
      ref: string;
      type: 'alb' | 'nlb' | 'clb';
      attachedTo: {
        kind: 'Service' | 'Ingress';
        namespace: string;
        name: string;
      }[];
      healthyTargets: number | null;
      usdPerMonth: number | null;
    }[] = [];
    const lbRef = () => `lb-${loadBalancers.length + 1}`;
    for (const svc of [...store.services.values()]
      .filter((x) => x.type === 'LoadBalancer')
      .sort((a, b) =>
        `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`),
      )) {
      loadBalancers.push({
        ref: lbRef(),
        type: svc.lbType ?? 'clb',
        attachedTo: [
          { kind: 'Service', namespace: svc.namespace, name: svc.name },
        ],
        healthyTargets: null,
        usdPerMonth: null,
      });
    }
    const albGroups = new Map<string, (typeof loadBalancers)[number]>();
    for (const ing of [...store.ingresses.values()]
      .filter((x) => x.isAlb)
      .sort((a, b) =>
        `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`),
      )) {
      const att = {
        kind: 'Ingress' as const,
        namespace: ing.namespace,
        name: ing.name,
      };
      const grouped = ing.albGroup ? albGroups.get(ing.albGroup) : undefined;
      if (grouped) {
        grouped.attachedTo.push(att);
        continue;
      }
      const lb = {
        ref: lbRef(),
        type: 'alb' as const,
        attachedTo: [att],
        healthyTargets: null,
        usdPerMonth: null,
      };
      loadBalancers.push(lb);
      if (ing.albGroup) albGroups.set(ing.albGroup, lb);
    }

    const namespaces = store.namespaces.size
      ? store.namespaces.size
      : new Set(v.pods.map((p) => p.namespace)).size;

    return Promise.resolve({
      observationSec: {
        metrics: v.metrics.history.observedSec,
        restarts: v.restartObservation.observedSec,
      },
      systemNamespacesIncluded: true,
      cluster: {
        platform: 'eks',
        ...(verMatch ? { version: verMatch[1] } : {}),
        region: info.region,
        // EKS 지원 등급: 클러스터 버전 기준 (비용 추정과 같은 일정표). 버전을 모르면 null
        supportTier: verMatch ? eksSupportTier(verMatch[1], new Date()) : null,
        nodeCount: v.nodes.length,
        namespaceCount: namespaces,
      },
      nodeGroups,
      nodes,
      workloads,
      storage,
      events: {
        windowSec: 3600,
        byReason: [...byReason.values()].sort((a, b) => b.count - a.count),
      },
      loadBalancers,
      unattachedVolumes: [],
    });
  }
}
