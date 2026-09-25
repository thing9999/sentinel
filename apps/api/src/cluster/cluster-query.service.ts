import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ApiException,
  resourceNotFound,
  validationFailed,
} from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import {
  chain,
  cmpNum,
  cmpStr,
  paginate,
  parseRefParam,
  parseSort,
  type Comparator,
} from '../common/list-query';
import { SourceRegistry } from '../common/source-registry.service';
import {
  compareStatusDesc,
  StatusChangeTracker,
  type Status,
} from '../common/status';
import type { DataSourceMode } from '../config/env.validation';
import type {
  AttentionQueryDto,
  EventsQueryDto,
  NodesQueryDto,
  PodsQueryDto,
  PvcsQueryDto,
  SeriesQueryDto,
  WorkloadsQueryDto,
} from './dto';
import { podKey, workloadKey, type WorkloadKind } from './model';
import { ClusterStateService } from './state/cluster-state.service';
import {
  countStatuses,
  nodeConditions,
  podContainers,
  workloadConditions,
  type ClusterView,
} from './state/evaluate';
import type {
  EventItem,
  NodeItem,
  PodItem,
  PvcItem,
  WorkloadItem,
} from './types';

function lc(s: string | null | undefined): string {
  return (s ?? '').toLowerCase();
}

function uniqSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}

/**
 * REST 조회 (docs/api/cluster-status.md 2~7절). 캐시된 평가 결과만 읽는다.
 */
@Injectable()
export class ClusterQueryService {
  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly state: ClusterStateService,
    private readonly registry: SourceRegistry,
  ) {}

  private head(view: ClusterView) {
    return { dataSource: this.dataSource, generatedAt: view.atIso };
  }

  nodeThresholds() {
    const t = this.state.thresholds();
    return {
      cpu: { warnPct: t.nodeCpuWarnPct, critPct: t.nodeCpuCritPct },
      memory: { warnPct: t.nodeMemoryWarnPct, critPct: t.nodeMemoryCritPct },
      requests: { warnPct: t.nodeRequestsWarnPct, critPct: null },
      pods: { warnPct: t.nodePodsWarnPct, critPct: t.nodePodsCritPct },
    };
  }

  podThresholds() {
    const t = this.state.thresholds();
    return {
      memoryLimit: {
        warnPct: t.podMemoryLimitWarnPct,
        critPct: t.podMemoryLimitCritPct,
      },
      restarts1h: { warn: t.podRestartsWarn1h, crit: t.podRestartsCrit1h },
    };
  }

  pvcThresholds() {
    const t = this.state.thresholds();
    return {
      usage: { warnPct: t.pvcUsageWarnPct, critPct: t.pvcUsageCritPct },
    };
  }

  allThresholds() {
    return {
      node: this.nodeThresholds(),
      pod: this.podThresholds(),
      pvc: this.pvcThresholds(),
    };
  }

  /** 상세 조회에서 kube 출처를 판단할 수 없으면 503 */
  private assertKubeUsable(): void {
    const kube = this.registry.get('kube');
    const unusable =
      kube.state === 'not_configured' ||
      kube.state === 'unavailable' ||
      (kube.state === 'syncing' && !this.state.store.initialSyncDone);
    if (unusable) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SOURCE_UNAVAILABLE',
        kube.state === 'not_configured'
          ? '클러스터 연결이 설정되지 않았습니다.'
          : kube.state === 'syncing'
            ? '클러스터 최초 동기화 중입니다.'
            : '클러스터를 조회할 수 없습니다.',
        { source: kube },
        kube.state === 'syncing' ? 2 : undefined,
      );
    }
  }

  // --- 요약 ---------------------------------------------------------------------

  summary() {
    const v = this.state.getView();
    return {
      ...this.head(v),
      cluster: this.state.clusterInfo(),
      overall: v.overall,
      areas: v.areas,
      attention: { total: v.attention.length, items: v.attention.slice(0, 8) },
    };
  }

  attention(q: AttentionQueryDto) {
    const v = this.state.getView();
    const { meta, items } = paginate(v.attention.length, v.attention, q);
    return { ...this.head(v), ...meta, items };
  }

  // --- 노드 ---------------------------------------------------------------------

  nodes(q: NodesQueryDto) {
    const v = this.state.getView();
    // 기본 worker (계약 3.1). role은 items·total·counts·facets에 모두 적용하고,
    // roleCounts·facets.roles만 클러스터 전체 기준이다 (AC-KOPS11)
    const role = q.role ?? 'worker';
    const inRole =
      role === 'all' ? v.nodes : v.nodes.filter((n) => n.role === role);
    const base = inRole.filter(
      (n) =>
        (!q.nodeGroup || q.nodeGroup.includes(n.nodeGroup ?? '')) &&
        (!q.zone || q.zone.includes(n.zone ?? '')) &&
        (!q.capacityType ||
          (n.capacityType !== null &&
            q.capacityType.includes(n.capacityType))) &&
        (!q.q || lc(n.name).includes(lc(q.q))),
    );
    const filtered = base.filter(
      (n) => !q.status || q.status.includes(n.status.status),
    );
    filtered.sort(nodeComparator(q.sort));
    const { meta, items } = paginate(inRole.length, filtered, q);
    const workerCount = v.nodes.filter((n) => n.role === 'worker').length;
    return {
      ...this.head(v),
      role,
      ...meta,
      counts: { all: base.length, ...countStatuses(base) },
      roleCounts: {
        worker: workerCount,
        control_plane: v.nodes.length - workerCount,
        all: v.nodes.length,
      },
      facets: {
        nodeGroups: uniqSorted(inRole.map((n) => n.nodeGroup)),
        zones: uniqSorted(inRole.map((n) => n.zone)),
        capacityTypes: uniqSorted(inRole.map((n) => n.capacityType)),
        // 계약 3.1: 클러스터에 실제로 존재하는 역할 값 (worker 먼저)
        roles: (['worker', 'control_plane'] as const).filter((r) =>
          v.nodes.some((n) => n.role === r),
        ),
      },
      areaStatus:
        role === 'control_plane'
          ? v.areas.controlPlane.status
          : v.areas.nodes.status,
      thresholds: this.nodeThresholds(),
      metricsAvailable: v.metrics.available,
      items,
    };
  }

  /**
   * 컨트롤 플레인 상세 (계약 3.3). `cluster.controlplane.updated` payload와 같다.
   * **여기서 항목을 꾸미지 않는다** — `logHref`는 평가 단계에서 채워져 있고 SSE도 같은 객체를 보낸다.
   * (전에는 이 자리에서만 `logHref`를 채워 SSE 쪽이 항상 null이었다. 2026-09-25 수정)
   */
  controlPlane() {
    const v = this.state.getView();
    return { ...this.head(v), ...v.controlPlane };
  }

  node(name: string) {
    this.assertKubeUsable();
    const v = this.state.getView();
    const node = v.nodeMap.get(name);
    const raw = this.state.store.nodes.get(name);
    if (!node || !raw)
      throw resourceNotFound(
        { kind: 'Node', name },
        '노드를 찾을 수 없습니다.',
      );
    const pods = v.pods
      .filter((p) => p.nodeName === name && !p.completed)
      .sort(podComparator(undefined));
    const podNames = new Set(pods.map((p) => p.name));
    const events = v.events.filter(
      (e) =>
        (e.involvedObject.kind === 'Node' && e.involvedObject.name === name) ||
        (e.involvedObject.kind === 'Pod' &&
          podNames.has(e.involvedObject.name)),
    );
    return {
      ...this.head(v),
      node,
      conditions: nodeConditions(raw, v.at, this.state.thresholds()),
      capacity: { ...raw.capacity },
      pods,
      events,
      thresholds: this.nodeThresholds(),
    };
  }

  // --- 워크로드 -------------------------------------------------------------------

  workloads(q: WorkloadsQueryDto) {
    const v = this.state.getView();
    const base = v.workloads.filter(
      (w) =>
        (!q.kind || q.kind.includes(w.kind)) &&
        (!q.namespace || q.namespace.includes(w.namespace)) &&
        (!q.hideSystem || !w.isSystemNamespace) &&
        (!q.q ||
          lc(w.name).includes(lc(q.q)) ||
          w.images.some((i) => lc(i).includes(lc(q.q)))),
    );
    const filtered = base.filter(
      (w) => !q.status || q.status.includes(w.status.status),
    );
    filtered.sort(workloadComparator(q.sort));
    const { meta, items } = paginate(v.workloads.length, filtered, q);
    return {
      ...this.head(v),
      ...meta,
      counts: { all: base.length, ...countStatuses(base) },
      facets: {
        namespaces: uniqSorted(v.workloads.map((w) => w.namespace)),
        kinds: ['Deployment', 'StatefulSet', 'DaemonSet'],
      },
      areaStatus: v.areas.workloads.status,
      items,
    };
  }

  workload(kind: WorkloadKind, namespace: string, name: string) {
    this.assertKubeUsable();
    const v = this.state.getView();
    const key = workloadKey(kind, namespace, name);
    const item = v.workloadMap.get(key);
    const raw = this.state.store.workloads.get(key);
    if (!item || !raw)
      throw resourceNotFound(
        { kind, namespace, name },
        '워크로드를 찾을 수 없습니다.',
      );
    const pods = v.pods
      .filter((p) => p.owner?.workloadKey === key)
      .sort(podComparator(undefined));
    const podNames = new Set(pods.map((p) => p.name));
    const events = v.events.filter(
      (e) =>
        e.involvedObject.namespace === namespace &&
        ((e.involvedObject.kind === kind && e.involvedObject.name === name) ||
          (e.involvedObject.kind === 'Pod' &&
            podNames.has(e.involvedObject.name)) ||
          (e.involvedObject.kind === 'ReplicaSet' &&
            e.involvedObject.name.startsWith(`${name}-`))),
    );
    return {
      ...this.head(v),
      workload: item,
      conditions: workloadConditions(raw),
      pods,
      events,
    };
  }

  // --- 파드 -----------------------------------------------------------------------

  pods(q: PodsQueryDto) {
    const v = this.state.getView();
    const wl = q.workload ? parseRefParam('workload', q.workload) : undefined;
    const wlKey = wl ? workloadKey(wl.kind, wl.namespace ?? '', wl.name) : null;
    const base = v.pods.filter(
      (p) =>
        (q.showCompleted || !p.completed) &&
        (!q.namespace || q.namespace.includes(p.namespace)) &&
        (!q.hideSystem || !p.isSystemNamespace) &&
        (!q.node || p.nodeName === q.node) &&
        (!wlKey || p.owner?.workloadKey === wlKey) &&
        (!q.q ||
          lc(p.name).includes(lc(q.q)) ||
          lc(p.nodeName).includes(lc(q.q)) ||
          lc(p.owner?.name).includes(lc(q.q))),
    );
    const filtered = base.filter(
      (p) => !q.status || q.status.includes(p.status.status),
    );
    filtered.sort(podComparator(q.sort));
    const { meta, items } = paginate(v.pods.length, filtered, q);
    return {
      ...this.head(v),
      ...meta,
      counts: { all: base.length, ...countStatuses(base) },
      facets: { namespaces: uniqSorted(v.pods.map((p) => p.namespace)) },
      areaStatus: v.areas.pods.status,
      restartObservation: v.restartObservation,
      thresholds: this.podThresholds(),
      metricsAvailable: v.metrics.available,
      items,
    };
  }

  pod(namespace: string, name: string) {
    this.assertKubeUsable();
    const v = this.state.getView();
    const key = podKey(namespace, name);
    const item = v.podMap.get(key);
    const raw = this.state.store.pods.get(key);
    if (!item || !raw) {
      const owner = this.state.store.history.lastOwner(key);
      throw resourceNotFound(
        { kind: 'Pod', namespace, name, ...(owner ? { owner } : {}) },
        '파드를 찾을 수 없습니다.',
      );
    }
    const kube = this.registry.get('kube');
    return {
      ...this.head(v),
      pod: item,
      podIP: raw.podIP,
      serviceAccountName: raw.security.serviceAccountName,
      containers: podContainers(raw, item, {
        now: v.at,
        t: this.state.thresholds(),
        metrics: this.state.metrics,
        tracker: this.containerTracker,
        kubeStale: v.kubeStale,
        updatedAt: kube.state === 'stale' ? kube.lastSuccessAt : v.atIso,
      }),
      events: v.events.filter(
        (e) =>
          e.involvedObject.kind === 'Pod' &&
          e.involvedObject.namespace === namespace &&
          e.involvedObject.name === name,
      ),
    };
  }

  private readonly containerTracker = new StatusChangeTracker();

  // --- 이벤트 ---------------------------------------------------------------------

  events(q: EventsQueryDto) {
    const v = this.state.getView();
    const target = q.target ? parseRefParam('target', q.target) : undefined;
    const since = v.at - (q.sinceSec ?? 3600) * 1000;
    const all = v.events;
    const filtered = all.filter(
      (e) =>
        Date.parse(e.lastSeenAt) >= since &&
        (!q.severeOnly || e.severe) &&
        (!q.namespace || q.namespace.includes(e.namespace ?? '')) &&
        (!q.kind || q.kind.includes(e.involvedObject.kind)) &&
        (!q.reason || q.reason.includes(e.reason)) &&
        (!target ||
          (e.involvedObject.kind === target.kind &&
            (e.involvedObject.namespace ?? null) === target.namespace &&
            e.involvedObject.name === target.name)) &&
        (!q.q ||
          lc(e.involvedObject.name).includes(lc(q.q)) ||
          lc(e.reason).includes(lc(q.q)) ||
          lc(e.message).includes(lc(q.q))),
    );
    filtered.sort(eventComparator(q.sort));
    const { meta, items } = paginate(all.length, filtered, q);
    return {
      ...this.head(v),
      ...meta,
      retentionSec: 3600,
      areaStatus: v.areas.events.status,
      facets: {
        namespaces: uniqSorted(all.map((e) => e.namespace)),
        kinds: uniqSorted(all.map((e) => e.involvedObject.kind)),
        reasons: uniqSorted(all.map((e) => e.reason)),
      },
      items,
    };
  }

  // --- PVC ------------------------------------------------------------------------

  pvcs(q: PvcsQueryDto) {
    const v = this.state.getView();
    const filtered = v.pvcs.filter(
      (p) =>
        (!q.namespace || q.namespace.includes(p.namespace)) &&
        (!q.status || q.status.includes(p.status.status)) &&
        (!q.dbOnly || p.isDbVolume) &&
        (!q.q || lc(p.name).includes(lc(q.q))),
    );
    filtered.sort(pvcComparator(q.sort));
    const { meta, items } = paginate(v.pvcs.length, filtered, q);
    return {
      ...this.head(v),
      ...meta,
      usageSource: v.pvcUsageSource,
      thresholds: this.pvcThresholds(),
      items,
    };
  }

  // --- 메트릭 -----------------------------------------------------------------------

  metrics() {
    const v = this.state.getView();
    return { ...this.head(v), ...v.metrics };
  }

  series(q: SeriesQueryDto) {
    const range = q.range ?? '1h';
    if (range !== '1h') {
      throw validationFailed([
        {
          field: 'range',
          value: range,
          constraints: [
            'range must be 1h (history source is in_memory; 6h/24h need Prometheus)',
          ],
        },
      ]);
    }
    if (q.target !== 'cluster' && !q.name)
      throw validationFailed([
        {
          field: 'name',
          value: q.name,
          constraints: ['name is required for node/pod'],
        },
      ]);
    if (q.target === 'pod' && !q.namespace)
      throw validationFailed([
        {
          field: 'namespace',
          value: q.namespace,
          constraints: ['namespace is required for pod'],
        },
      ]);
    const v = this.state.getView();
    const m = this.state.metrics;
    const t = this.state.thresholds();
    let key = 'cluster';
    let target: { kind: string; namespace: string | null; name: string } = {
      kind: 'Cluster',
      namespace: null,
      name: this.state.clusterInfo().name ?? 'cluster',
    };
    let denominators: {
      cpuMillicores: number | null;
      memoryBytes: number | null;
      memoryBasis: 'allocatable' | 'limit';
    } = {
      cpuMillicores: v.metrics.cpu.allocatableMillicores,
      memoryBytes: v.metrics.memory.allocatableBytes,
      memoryBasis: 'allocatable',
    };
    let thresholds: {
      cpu: { warnPct: number; critPct: number | null };
      memory: { warnPct: number; critPct: number | null };
    } = {
      cpu: { warnPct: t.nodeCpuWarnPct, critPct: t.nodeCpuCritPct },
      memory: { warnPct: t.nodeMemoryWarnPct, critPct: t.nodeMemoryCritPct },
    };
    if (q.target === 'node') {
      key = `node:${q.name}`;
      const node = v.nodeMap.get(q.name!);
      if (!node && !m.series.has(key))
        throw resourceNotFound(
          { kind: 'Node', name: q.name },
          '노드를 찾을 수 없습니다.',
        );
      target = { kind: 'Node', namespace: null, name: q.name! };
      denominators = {
        cpuMillicores: node?.allocatable.cpuMillicores ?? null,
        memoryBytes: node?.allocatable.memoryBytes ?? null,
        memoryBasis: 'allocatable',
      };
    } else if (q.target === 'pod') {
      const pk = podKey(q.namespace!, q.name!);
      key = `pod:${pk}`;
      const pod = v.podMap.get(pk);
      if (!pod && !m.series.has(key))
        throw resourceNotFound(
          { kind: 'Pod', namespace: q.namespace, name: q.name },
          '파드를 찾을 수 없습니다.',
        );
      target = { kind: 'Pod', namespace: q.namespace!, name: q.name! };
      denominators = {
        cpuMillicores: pod?.requests.cpuMillicores ?? null,
        memoryBytes: pod?.limits.memoryBytes ?? null,
        memoryBasis: 'limit',
      };
      thresholds = {
        cpu: { warnPct: 100, critPct: null },
        memory: {
          warnPct: t.podMemoryLimitWarnPct,
          critPct: t.podMemoryLimitCritPct,
        },
      };
    }
    const points = m.series.get(key).map((p) => ({
      t: new Date(p.t).toISOString(),
      cpuMillicores: p.cpuMillicores,
      memoryBytes: p.memoryBytes,
      cpuPct: p.cpuPct,
      memoryPct: p.memoryPct,
      cpuStatus: p.cpuStatus,
      memoryStatus: p.memoryStatus,
    }));
    return {
      ...this.head(v),
      target,
      // target=cluster 합계는 워커 기준이다 (AC-KOPS13). node·pod에는 없다
      ...(q.target === 'cluster'
        ? { scope: { basis: 'worker' as const } }
        : {}),
      range,
      source: 'in_memory' as const,
      stepSec: this.state.metricsIntervalSec,
      observedSince: points[0]?.t ?? null,
      available: v.metrics.available,
      unavailableReason: v.metrics.unavailableReason,
      thresholds,
      denominators,
      points,
    };
  }
}

// ---------------------------------------------------------------------------
// 정렬
// ---------------------------------------------------------------------------

const byStatus = <T extends { status: { status: Status } }>(
  a: T,
  b: T,
): number => compareStatusDesc(a.status.status, b.status.status);

function nodeComparator(sort: string | undefined): Comparator<NodeItem> {
  const s = parseSort(sort);
  const dirMul = s?.dir === 'desc' ? -1 : 1;
  const byName: Comparator<NodeItem> = (a, b) => cmpStr(a.name, b.name);
  if (!s) return chain(byStatus, byName);
  switch (s.field) {
    case 'status':
      return chain((a, b) => dirMul * byStatus(a, b), byName);
    case 'name':
      return (a, b) => dirMul * cmpStr(a.name, b.name);
    case 'cpuPct':
      return chain(
        (a, b) => cmpNum(a.usage?.cpuPct, b.usage?.cpuPct, s.dir),
        byName,
      );
    case 'memoryPct':
      return chain(
        (a, b) => cmpNum(a.usage?.memoryPct, b.usage?.memoryPct, s.dir),
        byName,
      );
    case 'podsPct':
      return chain((a, b) => cmpNum(a.pods.pct, b.pods.pct, s.dir), byName);
    case 'createdAt':
      return chain((a, b) => dirMul * cmpStr(a.createdAt, b.createdAt), byName);
    default:
      return chain(byStatus, byName);
  }
}

function workloadComparator(
  sort: string | undefined,
): Comparator<WorkloadItem> {
  const s = parseSort(sort);
  const dirMul = s?.dir === 'desc' ? -1 : 1;
  const def: Comparator<WorkloadItem> = chain(
    byStatus,
    (a, b) => cmpStr(a.namespace, b.namespace),
    (a, b) => cmpStr(a.name, b.name),
  );
  if (!s) return def;
  switch (s.field) {
    case 'status':
      return chain((a, b) => dirMul * byStatus(a, b), def);
    case 'namespace':
      return chain((a, b) => dirMul * cmpStr(a.namespace, b.namespace), def);
    case 'name':
      return chain((a, b) => dirMul * cmpStr(a.name, b.name), def);
    case 'kind':
      return chain((a, b) => dirMul * cmpStr(a.kind, b.kind), def);
    case 'lastRolloutAt':
      return chain(
        (a, b) =>
          cmpNum(
            a.lastRolloutAt ? Date.parse(a.lastRolloutAt) : null,
            b.lastRolloutAt ? Date.parse(b.lastRolloutAt) : null,
            s.dir,
          ),
        def,
      );
    default:
      return def;
  }
}

function podComparator(sort: string | undefined): Comparator<PodItem> {
  const s = parseSort(sort);
  const dirMul = s?.dir === 'desc' ? -1 : 1;
  const def: Comparator<PodItem> = chain(
    byStatus,
    (a, b) => b.restarts.last1h - a.restarts.last1h,
    (a, b) => cmpStr(a.namespace, b.namespace),
    (a, b) => cmpStr(a.name, b.name),
  );
  if (!s) return def;
  switch (s.field) {
    case 'status':
      return chain((a, b) => dirMul * byStatus(a, b), def);
    case 'restarts1h':
      return chain(
        (a, b) => cmpNum(a.restarts.last1h, b.restarts.last1h, s.dir),
        def,
      );
    case 'restartsTotal':
      return chain(
        (a, b) => cmpNum(a.restarts.total, b.restarts.total, s.dir),
        def,
      );
    case 'namespace':
      return chain((a, b) => dirMul * cmpStr(a.namespace, b.namespace), def);
    case 'name':
      return chain((a, b) => dirMul * cmpStr(a.name, b.name), def);
    case 'cpu':
      return chain(
        (a, b) => cmpNum(a.usage?.cpuMillicores, b.usage?.cpuMillicores, s.dir),
        def,
      );
    case 'memory':
      return chain(
        (a, b) => cmpNum(a.usage?.memoryBytes, b.usage?.memoryBytes, s.dir),
        def,
      );
    case 'memoryLimitPct':
      return chain(
        (a, b) => cmpNum(a.memoryLimitPct, b.memoryLimitPct, s.dir),
        def,
      );
    case 'startedAt':
      return chain(
        (a, b) =>
          cmpNum(
            a.startedAt ? Date.parse(a.startedAt) : null,
            b.startedAt ? Date.parse(b.startedAt) : null,
            s.dir,
          ),
        def,
      );
    default:
      return def;
  }
}

function eventComparator(sort: string | undefined): Comparator<EventItem> {
  const s = parseSort(sort) ?? { field: 'lastSeenAt', dir: 'desc' as const };
  const dirMul = s.dir === 'desc' ? -1 : 1;
  const byLast: Comparator<EventItem> = (a, b) =>
    cmpStr(b.lastSeenAt, a.lastSeenAt);
  switch (s.field) {
    case 'count':
      return chain((a, b) => cmpNum(a.count, b.count, s.dir), byLast);
    case 'namespace':
      return chain((a, b) => dirMul * cmpStr(a.namespace, b.namespace), byLast);
    default:
      return (a, b) => dirMul * cmpStr(a.lastSeenAt, b.lastSeenAt);
  }
}

function pvcComparator(sort: string | undefined): Comparator<PvcItem> {
  const s = parseSort(sort);
  const dirMul = s?.dir === 'desc' ? -1 : 1;
  const def: Comparator<PvcItem> = chain(
    byStatus,
    (a, b) => cmpStr(a.namespace, b.namespace),
    (a, b) => cmpStr(a.name, b.name),
  );
  if (!s) return def;
  switch (s.field) {
    case 'status':
      return chain((a, b) => dirMul * byStatus(a, b), def);
    case 'namespace':
      return chain((a, b) => dirMul * cmpStr(a.namespace, b.namespace), def);
    case 'name':
      return chain((a, b) => dirMul * cmpStr(a.name, b.name), def);
    case 'usagePct':
      return chain((a, b) => cmpNum(a.usage?.pct, b.usage?.pct, s.dir), def);
    case 'capacity':
      return chain(
        (a, b) => cmpNum(a.capacityBytes, b.capacityBytes, s.dir),
        def,
      );
    default:
      return def;
  }
}
