/**
 * 단일 SSE 스트림(`GET /api/stream?topics=`)의 화면 상태 리듀서. 순수 함수만 있다(테스트 대상).
 *
 * 규칙 (docs/api/common.md 5절, cluster-status.md 8절, aws-cost.md 7절, architecture-advisor.md A.8)
 * - `<topic>.snapshot`: 그 토픽 상태를 통째로 교체한다.
 * - `<topic>.<entity>.upsert`: 행 전체 교체 / `.delete`: 행 삭제.
 * - `<topic>.<entity>.updated`: 단일 객체 전체 교체.
 * - 재연결(`stream.hello`)해도 값은 지우지 않는다. 새 스냅샷이 오면 그때 교체한다.
 * - 화면에서 상태·금액·합계를 계산하지 않는다. 받은 값을 그대로 둔다.
 * - `aws-snapshots` 토픽은 요약과 "무엇이 바뀌었는지"만 온다(aws-snapshot-manager.md 11절).
 *   요약은 교체하고, 바뀐 ID·휴지통 변경은 카운터로 남겨 화면이 REST 로 다시 조회하게 한다.
 * - `k8s-snapshots` 토픽(k8s-snapshot.md 13절)도 같은 규칙 + `k8s-snapshots.drift`는 스냅샷별 드리프트 배지를 교체한다
 *   (필드 값 없음. 목록은 다시 조회하지 않고 이 배지로 행을 바꾼다).
 * - `snapshot-menu` 토픽(12절)은 사이드바·탭 배지용 합산 값을 통째로 교체한다.
 */
import type {
  AdvisorState,
  PrecheckItem,
  Run,
  RunSummary,
} from "../architecture-advisor/types";
import type { CostSnapshot, RateBaseline, RatePoint } from "../aws-cost/types";
import type { SnapshotsChangedEvent, SnapshotsSnapshotEvent, SnapshotSummary } from "../aws-snapshots/types";
import type {
  DriftBadge,
  K8sDriftEvent,
  K8sSnapshotsChangedEvent,
  K8sSnapshotsSnapshotEvent,
  K8sSnapshotSummary,
} from "../k8s-snapshots/types";
import type { AlertBadge, AlertNotice, AlertWatch, AlertsSnapshotPayload } from "../alerts/types";
import type { SnapshotMenuPayload } from "../snapshot-menu/types";
import type {
  ClusterSnapshot,
  ControlPlaneBody,
  DbResponse,
  EventItem,
  MetricsSnapshot,
  MetricsUpdated,
  NodeItem,
  NodeUsagePoint,
  OverviewResponse,
  PodItem,
  PodUsagePoint,
  PvcItem,
  SeriesPoint,
  WorkloadItem,
} from "../cluster-status/types";
import type {
  DataSource,
  IsoTime,
  SourceId,
  SourceStatus,
  StreamEnvelope,
  StreamHello,
  StreamTopic,
} from "../common/types";

export interface ClusterState extends Omit<ClusterSnapshot, "nodes" | "workloads" | "pods" | "events" | "pvcs"> {
  nodes: Record<string, NodeItem>;
  workloads: Record<string, WorkloadItem>;
  pods: Record<string, PodItem>;
  events: Record<string, EventItem>;
  pvcs: Record<string, PvcItem>;
}

export interface MetricsState {
  cluster: MetricsSnapshot["cluster"];
  clusterSeries: MetricsSnapshot["clusterSeries"];
  nodes: Record<string, NodeUsagePoint>;
  pods: Record<string, PodUsagePoint>;
  /** 마지막 metrics.updated 의 collectedAt (스냅샷이면 cluster.updatedAt) */
  collectedAt: IsoTime | null;
}

export interface CostRateState {
  /** 마지막 cost.snapshot 이후 cost.rate.sampled 로 받은 점 (REST rate-series 끝에 붙인다) */
  points: RatePoint[];
  baseline: RateBaseline | null;
}

export interface AdvisorStreamState {
  state: AdvisorState;
  /** advisor.precheck.updated 로 받은 includeSystem=false 기준 항목 (스냅샷에는 없음 → null) */
  precheckItems: PrecheckItem[] | null;
  /** 마지막으로 끝난 실행 (advisor.run.finished) */
  lastFinished: { run: Run; receivedAt: number } | null;
}

/**
 * `aws-snapshots` 토픽 상태. 한 프레임에 이벤트 여러 개가 묶여도 ID 변경을 잃지 않도록
 * 마지막 이벤트가 아니라 카운터(seq)로 남긴다. 화면은 관심 있는 카운터가 바뀌면 다시 조회한다.
 */
export interface SnapshotsStreamState {
  revision: number;
  summary: SnapshotSummary;
  /** 이 토픽 이벤트 수 (목록 재조회 키) */
  seq: number;
  /** `aws-snapshots.snapshot` 수 (연결·재연결·mock 시나리오 변경·reset → 모든 화면 재조회) */
  resetSeq: number;
  /** changedIds 에 들어온 ID → 그때의 seq */
  changed: Record<string, number>;
  /** removedIds 에 들어온 ID → 그때의 seq */
  removed: Record<string, number>;
  /** trashChanged 가 true 였던 마지막 seq */
  trashSeq: number;
}

/** `k8s-snapshots` 토픽 상태 (aws 와 같은 카운터 + 드리프트 배지) */
export interface K8sSnapshotsStreamState {
  revision: number;
  summary: K8sSnapshotSummary;
  /** `.snapshot`·`.changed` 수 (목록 재조회 키. 드리프트 이벤트는 세지 않는다) */
  seq: number;
  resetSeq: number;
  changed: Record<string, number>;
  removed: Record<string, number>;
  trashSeq: number;
  /** `k8s-snapshots.drift` 로 받은 배지 (스냅샷 ID → 배지). `.snapshot` 이 오면 비운다(REST 로 다시 받음) */
  drift: Record<string, DriftBadge>;
  /** 스냅샷 ID → 마지막 드리프트 이벤트 순번 (드리프트 탭 재조회 키) */
  driftSeq: Record<string, number>;
  /** 드리프트 이벤트 전체 순번 */
  driftEvents: number;
  /** 현재 자동 대상 (드리프트 이벤트가 오기 전에는 undefined) */
  autoTargetId: string | null | undefined;
}

/**
 * `alerts` 토픽 상태 (alerts.md 6절). **이력 목록을 들지 않는다.**
 *
 * `alerts.snapshot`에 목록이 없는 것만으로는 부족하다 — `alerts.created`/`updated`의 `alert` 객체를
 * 여기에 쌓으면 알림 화면을 보지 않는 탭도 이력을 메모리에 들게 된다(AC-ALERT37이 막으려는 것).
 * 그래서 **배지·감시·안내만** 두고 항목은 카운터(`seq`)로만 남긴다. `/alerts` 화면이 그 카운터를 보고
 * `GET /api/alerts`를 300ms debounce 로 다시 읽는다(계약 11절).
 */
export interface AlertsStreamState {
  badge: AlertBadge;
  watch: AlertWatch | null;
  dispatch: AlertsSnapshotPayload["dispatch"] | null;
  persistence: "database" | "memory" | null;
  warmup: AlertsSnapshotPayload["warmup"] | null;
  notices: AlertNotice[];
  /** `alerts.created`·`updated`·`read` 수 (목록 재조회 키). **항목 객체는 저장하지 않는다** */
  seq: number;
  /** `alerts.snapshot` 수 (연결·재연결·시나리오 변경 → 전체 재조회) */
  resetSeq: number;
  /** 배지를 한 번이라도 받았는지 (최초 로딩 중에는 배지 자리를 비운다) */
  loaded: boolean;
}

export interface StreamState {
  /** 현재 연결의 stream.hello (없으면 null) */
  hello: StreamHello | null;
  dataSource: DataSource | null;
  sources: Partial<Record<SourceId, SourceStatus>>;
  /** 서버 시각 - 클라이언트 시각 (ms). 경과 시간 보정용 */
  serverOffsetMs: number;
  /** 마지막으로 이벤트를 반영한 클라이언트 시각 (epoch ms) */
  lastEventAt: number | null;
  /** 마지막 stream.heartbeat 또는 stream.hello 수신 시각 (watch 기반 stale 기준) */
  lastHeartbeatAt: number | null;
  lastSeq: number;
  /** 토픽별 마지막 스냅샷 수신 시각 */
  snapshotAt: Partial<Record<StreamTopic, number>>;
  overview: OverviewResponse | null;
  cluster: ClusterState | null;
  metrics: MetricsState | null;
  db: DbResponse | null;
  cost: CostSnapshot | null;
  costRate: CostRateState;
  advisor: AdvisorStreamState | null;
  snapshots: SnapshotsStreamState | null;
  k8sSnapshots: K8sSnapshotsStreamState | null;
  /** `snapshot-menu` 토픽 (사이드바 "스냅샷" 메뉴·탭 배지) */
  snapshotMenu: SnapshotMenuPayload | null;
  /** `alerts` 토픽 (사이드바 배지·탭 제목). **목록 없음** */
  alerts: AlertsStreamState;
}

/** 배지 초기값. 연결이 끊겨도 **0으로 내리지 않으므로** 받기 전에는 `loaded: false`로 자리를 비운다 */
export const initialAlertsState: AlertsStreamState = {
  badge: { unreadCount: 0, worstSeverity: null, updatedAt: null },
  watch: null,
  dispatch: null,
  persistence: null,
  warmup: null,
  notices: [],
  seq: 0,
  resetSeq: 0,
  loaded: false,
};

export const initialStreamState: StreamState = {
  hello: null,
  dataSource: null,
  sources: {},
  serverOffsetMs: 0,
  lastEventAt: null,
  lastHeartbeatAt: null,
  lastSeq: 0,
  snapshotAt: {},
  overview: null,
  cluster: null,
  metrics: null,
  db: null,
  cost: null,
  costRate: { points: [], baseline: null },
  advisor: null,
  snapshots: null,
  k8sSnapshots: null,
  snapshotMenu: null,
  alerts: initialAlertsState,
};

export interface StreamEventInput {
  /** SSE `event:` 이름 */
  type: string;
  envelope: StreamEnvelope;
  /** 수신 시각 (epoch ms) */
  receivedAt: number;
}

/** 클러스터 추이 표본은 최근 maxRangeSec 만 둔다 (in_memory 1시간) */
const DEFAULT_SERIES_RANGE_SEC = 3600;
/** 소모율 표본은 최대 7일치(5분 간격 2016개)까지만 메모리에 둔다 */
const MAX_RATE_POINTS = 2100;

function toMap<T>(items: T[] | undefined | null, key: (item: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items ?? []) out[key(item)] = item;
  return out;
}

function withEntry<T>(map: Record<string, T>, key: string, value: T): Record<string, T> {
  return { ...map, [key]: value };
}

function withoutEntry<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

function parseTime(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function trimSeries(points: SeriesPoint[], maxRangeSec: number): SeriesPoint[] {
  if (points.length === 0) return points;
  const last = parseTime(points[points.length - 1].t);
  if (last === null) return points;
  const from = last - maxRangeSec * 1000;
  const firstKeep = points.findIndex((p) => {
    const t = parseTime(p.t);
    return t !== null && t >= from;
  });
  return firstKeep <= 0 ? points : points.slice(firstKeep);
}

function appendSeriesPoint(points: SeriesPoint[], point: SeriesPoint, maxRangeSec: number): SeriesPoint[] {
  const last = points[points.length - 1];
  if (last && last.t === point.t) return trimSeries([...points.slice(0, -1), point], maxRangeSec);
  return trimSeries([...points, point], maxRangeSec);
}

function runToSummary(run: Run): RunSummary {
  return {
    id: run.id,
    status: run.status,
    failureReason: run.failureReason,
    isExample: run.isExample,
    dataSource: run.dataSource,
    requestedAt: run.requestedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    counts: run.counts,
    snapshotSummary: run.snapshotSummary,
  };
}

function applyCluster(state: StreamState, type: string, payload: unknown): StreamState {
  if (type === "cluster.snapshot") {
    const p = payload as ClusterSnapshot;
    const cluster: ClusterState = {
      sync: p.sync,
      cluster: p.cluster,
      areas: p.areas,
      restartObservation: p.restartObservation,
      thresholds: p.thresholds,
      nodes: toMap(p.nodes, (n) => n.name),
      controlPlane: p.controlPlane,
      workloads: toMap(p.workloads, (w) => w.key),
      pods: toMap(p.pods, (x) => x.key),
      events: toMap(p.events, (e) => e.key),
      pvcs: toMap(p.pvcs, (x) => x.key),
    };
    return { ...state, cluster };
  }
  const c = state.cluster;
  // 스냅샷보다 변경분이 먼저 오지 않는다(계약). 혹시 오면 무시한다.
  if (!c) return state;
  switch (type) {
    case "cluster.summary.updated": {
      const p = payload as Pick<ClusterSnapshot, "areas" | "restartObservation" | "thresholds">;
      return {
        ...state,
        cluster: {
          ...c,
          areas: p.areas ?? c.areas,
          restartObservation: p.restartObservation ?? c.restartObservation,
          thresholds: p.thresholds ?? c.thresholds,
        },
      };
    }
    // 기존 `cluster` 토픽의 이벤트다(새 구독 없음). 단일 객체 **전체 교체** (계약 8.2)
    case "cluster.controlplane.updated": {
      return { ...state, cluster: { ...c, controlPlane: payload as ControlPlaneBody } };
    }
    case "cluster.node.upsert": {
      const item = (payload as { item: NodeItem }).item;
      return { ...state, cluster: { ...c, nodes: withEntry(c.nodes, item.name, item) } };
    }
    case "cluster.node.delete": {
      const { name } = payload as { name: string };
      return { ...state, cluster: { ...c, nodes: withoutEntry(c.nodes, name) } };
    }
    case "cluster.workload.upsert": {
      const item = (payload as { item: WorkloadItem }).item;
      return { ...state, cluster: { ...c, workloads: withEntry(c.workloads, item.key, item) } };
    }
    case "cluster.workload.delete": {
      const { key } = payload as { key: string };
      return { ...state, cluster: { ...c, workloads: withoutEntry(c.workloads, key) } };
    }
    case "cluster.pod.upsert": {
      const item = (payload as { item: PodItem }).item;
      return { ...state, cluster: { ...c, pods: withEntry(c.pods, item.key, item) } };
    }
    case "cluster.pod.delete": {
      const { key } = payload as { key: string };
      return { ...state, cluster: { ...c, pods: withoutEntry(c.pods, key) } };
    }
    case "cluster.event.upsert": {
      const item = (payload as { item: EventItem }).item;
      return { ...state, cluster: { ...c, events: withEntry(c.events, item.key, item) } };
    }
    case "cluster.event.delete": {
      const { key } = payload as { key: string };
      return { ...state, cluster: { ...c, events: withoutEntry(c.events, key) } };
    }
    case "cluster.pvc.upsert": {
      const item = (payload as { item: PvcItem }).item;
      return { ...state, cluster: { ...c, pvcs: withEntry(c.pvcs, item.key, item) } };
    }
    case "cluster.pvc.delete": {
      const { key } = payload as { key: string };
      return { ...state, cluster: { ...c, pvcs: withoutEntry(c.pvcs, key) } };
    }
    default:
      return state;
  }
}

function applyMetrics(state: StreamState, type: string, payload: unknown): StreamState {
  if (type === "metrics.snapshot") {
    const p = payload as MetricsSnapshot;
    return {
      ...state,
      metrics: {
        cluster: p.cluster,
        clusterSeries: p.clusterSeries,
        nodes: toMap(p.nodes, (n) => n.name),
        pods: toMap(p.pods, (x) => x.key),
        collectedAt: p.cluster?.updatedAt ?? null,
      },
    };
  }
  if (type === "metrics.updated") {
    const m = state.metrics;
    if (!m) return state;
    const p = payload as MetricsUpdated;
    const maxRange = m.cluster.history?.maxRangeSec ?? DEFAULT_SERIES_RANGE_SEC;
    return {
      ...state,
      metrics: {
        cluster: {
          ...m.cluster,
          available: p.available,
          unavailableReason: p.unavailableReason,
          cpu: p.cluster?.cpu ?? m.cluster.cpu,
          memory: p.cluster?.memory ?? m.cluster.memory,
          updatedAt: p.cluster?.updatedAt ?? m.cluster.updatedAt,
        },
        clusterSeries: p.clusterPoint
          ? { ...m.clusterSeries, points: appendSeriesPoint(m.clusterSeries.points, p.clusterPoint, maxRange) }
          : m.clusterSeries,
        // 15초마다 전체 목록이 온다 → 교체 (metrics-server 없음이면 빈 배열)
        nodes: toMap(p.nodes, (n) => n.name),
        pods: toMap(p.pods, (x) => x.key),
        collectedAt: p.collectedAt,
      },
    };
  }
  return state;
}

function applyCost(state: StreamState, type: string, payload: unknown): StreamState {
  if (type === "cost.snapshot") {
    return { ...state, cost: payload as CostSnapshot, costRate: { points: [], baseline: null } };
  }
  if (type === "cost.rate.sampled") {
    const p = payload as { point: RatePoint; baseline: RateBaseline };
    const prev = state.costRate.points;
    const points = prev.length && prev[prev.length - 1].t === p.point.t ? [...prev.slice(0, -1), p.point] : [...prev, p.point];
    return {
      ...state,
      costRate: { points: points.slice(-MAX_RATE_POINTS), baseline: p.baseline ?? state.costRate.baseline },
    };
  }
  const c = state.cost;
  if (!c) return state;
  const p = payload as Partial<CostSnapshot>;
  switch (type) {
    case "cost.estimate.updated":
      return {
        ...state,
        cost: { ...c, estimate: p.estimate ?? c.estimate, allocation: p.allocation ?? c.allocation, summary: p.summary ?? c.summary },
      };
    case "cost.actual.updated":
      return {
        ...state,
        cost: {
          ...c,
          actual: p.actual ?? c.actual,
          summary: p.summary ?? c.summary,
          refresh: p.actual?.refresh ?? c.refresh,
        },
      };
    case "cost.status.updated":
      return { ...state, cost: { ...c, status: p.status ?? c.status, summary: p.summary ?? c.summary } };
    case "cost.refresh.updated":
      return { ...state, cost: { ...c, refresh: p.refresh ?? c.refresh } };
    default:
      return state;
  }
}

function applyAdvisor(state: StreamState, type: string, payload: unknown, receivedAt: number): StreamState {
  if (type === "advisor.snapshot") {
    return {
      ...state,
      advisor: {
        state: payload as AdvisorState,
        precheckItems: state.advisor?.precheckItems ?? null,
        lastFinished: state.advisor?.lastFinished ?? null,
      },
    };
  }
  const a = state.advisor;
  if (!a) return state;
  switch (type) {
    case "advisor.bridge.updated": {
      const { bridge } = payload as { bridge: AdvisorState["bridge"] };
      return { ...state, advisor: { ...a, state: { ...a.state, bridge } } };
    }
    case "advisor.precheck.updated": {
      const p = payload as { precheck: AdvisorState["precheck"]; items: PrecheckItem[] };
      return { ...state, advisor: { ...a, state: { ...a.state, precheck: p.precheck }, precheckItems: p.items ?? null } };
    }
    case "advisor.run.progress": {
      const { run } = payload as { run: Run };
      const active = run.status === "queued" || run.status === "running";
      return {
        ...state,
        advisor: {
          ...a,
          state: { ...a.state, activeRun: active ? run : a.state.activeRun?.id === run.id ? null : a.state.activeRun },
        },
      };
    }
    case "advisor.run.finished": {
      const p = payload as { run: Run; history?: { total: number } };
      const run = p.run;
      return {
        ...state,
        advisor: {
          ...a,
          state: {
            ...a.state,
            activeRun: a.state.activeRun?.id === run.id ? null : a.state.activeRun,
            lastRun: runToSummary(run),
            latestResult: run.status === "succeeded" ? run : a.state.latestResult,
            history: p.history ? { ...a.state.history, total: p.history.total } : a.state.history,
          },
          lastFinished: { run, receivedAt },
        },
      };
    }
    default:
      return state;
  }
}

function applySnapshots(state: StreamState, type: string, payload: unknown): StreamState {
  const prev = state.snapshots;
  if (type === "aws-snapshots.snapshot") {
    const p = payload as SnapshotsSnapshotEvent;
    if (!p?.summary) return state;
    const seq = (prev?.seq ?? 0) + 1;
    return {
      ...state,
      snapshots: {
        revision: p.revision,
        summary: p.summary,
        seq,
        resetSeq: (prev?.resetSeq ?? 0) + 1,
        changed: prev?.changed ?? {},
        removed: prev?.removed ?? {},
        trashSeq: seq,
      },
    };
  }
  if (type === "aws-snapshots.changed") {
    const p = payload as SnapshotsChangedEvent;
    if (!p?.summary) return state;
    const seq = (prev?.seq ?? 0) + 1;
    const changed = { ...(prev?.changed ?? {}) };
    for (const id of p.changedIds ?? []) changed[id] = seq;
    const removed = { ...(prev?.removed ?? {}) };
    for (const id of p.removedIds ?? []) removed[id] = seq;
    return {
      ...state,
      snapshots: {
        revision: p.revision,
        summary: p.summary,
        seq,
        resetSeq: prev?.resetSeq ?? 0,
        changed,
        removed,
        trashSeq: p.trashChanged ? seq : (prev?.trashSeq ?? 0),
      },
    };
  }
  return state;
}

function applyK8sSnapshots(state: StreamState, type: string, payload: unknown): StreamState {
  const prev = state.k8sSnapshots;
  if (type === "k8s-snapshots.snapshot") {
    const p = payload as K8sSnapshotsSnapshotEvent;
    if (!p?.summary) return state;
    const seq = (prev?.seq ?? 0) + 1;
    return {
      ...state,
      k8sSnapshots: {
        revision: p.revision,
        summary: p.summary,
        seq,
        resetSeq: (prev?.resetSeq ?? 0) + 1,
        changed: prev?.changed ?? {},
        removed: prev?.removed ?? {},
        trashSeq: seq,
        // 연결·시나리오 변경·reset: 화면이 REST 로 다시 받으므로 이전 배지는 버린다
        drift: {},
        driftSeq: prev?.driftSeq ?? {},
        driftEvents: prev?.driftEvents ?? 0,
        autoTargetId: prev?.autoTargetId,
      },
    };
  }
  if (!prev) return state;
  if (type === "k8s-snapshots.changed") {
    const p = payload as K8sSnapshotsChangedEvent;
    if (!p?.summary) return state;
    const seq = prev.seq + 1;
    const changed = { ...prev.changed };
    for (const id of p.changedIds ?? []) changed[id] = seq;
    const removed = { ...prev.removed };
    for (const id of p.removedIds ?? []) removed[id] = seq;
    return {
      ...state,
      k8sSnapshots: {
        ...prev,
        revision: p.revision,
        summary: p.summary,
        seq,
        changed,
        removed,
        trashSeq: p.trashChanged ? seq : prev.trashSeq,
      },
    };
  }
  if (type === "k8s-snapshots.drift") {
    const p = payload as K8sDriftEvent;
    if (!p?.snapshotId || !p.drift) return state;
    const n = prev.driftEvents + 1;
    return {
      ...state,
      k8sSnapshots: {
        ...prev,
        drift: { ...prev.drift, [p.snapshotId]: p.drift },
        driftSeq: { ...prev.driftSeq, [p.snapshotId]: n },
        driftEvents: n,
        autoTargetId: p.autoTargetId ?? null,
      },
    };
  }
  return state;
}

function applySnapshotMenu(state: StreamState, type: string, payload: unknown): StreamState {
  if (type !== "snapshot-menu.snapshot" && type !== "snapshot-menu.updated") return state;
  const p = payload as SnapshotMenuPayload;
  if (!p?.menu || !p.tabs) return state;
  return { ...state, snapshotMenu: { menu: p.menu, tabs: p.tabs } };
}

function applyStreamEvent(state: StreamState, type: string, payload: unknown, receivedAt: number): StreamState {
  switch (type) {
    case "stream.hello": {
      const hello = payload as StreamHello;
      const serverTime = parseTime(hello.serverTime);
      return {
        ...state,
        hello,
        dataSource: hello.dataSource ?? state.dataSource,
        sources: toMap(hello.sources, (s) => s.id),
        serverOffsetMs: serverTime !== null ? serverTime - receivedAt : state.serverOffsetMs,
        lastHeartbeatAt: receivedAt,
        // 연결마다 seq 는 1부터 다시 시작한다
        lastSeq: 0,
      };
    }
    case "stream.heartbeat": {
      const serverTime = parseTime((payload as { serverTime?: string })?.serverTime);
      return {
        ...state,
        lastHeartbeatAt: receivedAt,
        serverOffsetMs: serverTime !== null ? serverTime - receivedAt : state.serverOffsetMs,
      };
    }
    case "stream.source": {
      const source = (payload as { source: SourceStatus }).source;
      if (!source?.id) return state;
      return { ...state, sources: { ...state.sources, [source.id]: source } };
    }
    default:
      // stream.closing 등: 상태 변화 없음 (연결 관리는 클라이언트)
      return state;
  }
}

/**
 * `alerts` 토픽 (계약 6절). **항목(`payload.alert`)을 읽지 않는다** — 배지만 꺼내고 카운터를 올린다.
 * 이 함수에 `alert`를 저장하는 코드를 넣으면 AC-ALERT37이 깨진다(안 보는 탭이 이력을 든다).
 */
function applyAlerts(state: StreamState, type: string, payload: unknown): StreamState {
  const a = state.alerts;
  if (type === "alerts.snapshot") {
    const p = payload as AlertsSnapshotPayload;
    return {
      ...state,
      alerts: {
        ...a,
        badge: p.badge ?? a.badge,
        watch: p.watch ?? a.watch,
        dispatch: p.dispatch ?? a.dispatch,
        persistence: p.persistence ?? a.persistence,
        warmup: p.warmup ?? a.warmup,
        notices: p.notices ?? [],
        resetSeq: a.resetSeq + 1,
        seq: a.seq + 1,
        loaded: true,
      },
    };
  }
  if (type === "alerts.created" || type === "alerts.updated" || type === "alerts.read") {
    const badge = (payload as { badge?: AlertBadge })?.badge;
    return {
      ...state,
      alerts: { ...a, badge: badge ?? a.badge, seq: a.seq + 1, loaded: a.loaded || Boolean(badge) },
    };
  }
  return state;
}

/** 이벤트 하나를 반영한다 */
export function applyEvent(state: StreamState, input: StreamEventInput): StreamState {
  const { type, envelope, receivedAt } = input;
  const payload = envelope?.payload;
  const topic = type.split(".")[0];
  let next: StreamState;
  switch (topic) {
    case "stream":
      next = applyStreamEvent(state, type, payload, receivedAt);
      break;
    case "overview":
      next = type === "overview.snapshot" || type === "overview.updated" ? { ...state, overview: payload as OverviewResponse } : state;
      if (next.overview && next.overview !== state.overview && next.overview.dataSource) {
        next = { ...next, dataSource: next.dataSource ?? next.overview.dataSource };
      }
      break;
    case "cluster":
      next = applyCluster(state, type, payload);
      break;
    case "metrics":
      next = applyMetrics(state, type, payload);
      break;
    case "db":
      next = type === "db.snapshot" || type === "db.updated" ? { ...state, db: payload as DbResponse } : state;
      break;
    case "cost":
      next = applyCost(state, type, payload);
      break;
    case "advisor":
      next = applyAdvisor(state, type, payload, receivedAt);
      break;
    case "aws-snapshots":
      next = applySnapshots(state, type, payload);
      break;
    case "k8s-snapshots":
      next = applyK8sSnapshots(state, type, payload);
      break;
    case "snapshot-menu":
      next = applySnapshotMenu(state, type, payload);
      break;
    case "alerts":
      next = applyAlerts(state, type, payload);
      break;
    default:
      next = state;
  }
  const isSnapshot = type.endsWith(".snapshot") && topic !== "stream";
  return {
    ...next,
    lastEventAt: receivedAt,
    lastSeq: typeof envelope?.seq === "number" ? envelope.seq : next.lastSeq,
    snapshotAt: isSnapshot ? { ...next.snapshotAt, [topic]: receivedAt } : next.snapshotAt,
  };
}

/** 한 프레임에 묶인 이벤트들을 순서대로 반영한다 (화면 갱신은 배치당 1회) */
export function applyBatch(state: StreamState, events: readonly StreamEventInput[]): StreamState {
  let next = state;
  for (const ev of events) next = applyEvent(next, ev);
  return next;
}

/** 계약에 정의된 모든 이벤트 이름 (EventSource addEventListener 대상) */
export const STREAM_EVENT_TYPES: readonly string[] = [
  "stream.hello",
  "stream.heartbeat",
  "stream.source",
  "stream.closing",
  "overview.snapshot",
  "overview.updated",
  "cluster.snapshot",
  "cluster.summary.updated",
  "cluster.controlplane.updated",
  "cluster.node.upsert",
  "cluster.node.delete",
  "cluster.workload.upsert",
  "cluster.workload.delete",
  "cluster.pod.upsert",
  "cluster.pod.delete",
  "cluster.event.upsert",
  "cluster.event.delete",
  "cluster.pvc.upsert",
  "cluster.pvc.delete",
  "metrics.snapshot",
  "metrics.updated",
  "db.snapshot",
  "db.updated",
  "cost.snapshot",
  "cost.estimate.updated",
  "cost.actual.updated",
  "cost.status.updated",
  "cost.refresh.updated",
  "cost.rate.sampled",
  "advisor.snapshot",
  "advisor.bridge.updated",
  "advisor.precheck.updated",
  "advisor.run.progress",
  "advisor.run.finished",
  "aws-snapshots.snapshot",
  "aws-snapshots.changed",
  "k8s-snapshots.snapshot",
  "k8s-snapshots.changed",
  "k8s-snapshots.drift",
  "snapshot-menu.snapshot",
  "snapshot-menu.updated",
  "alerts.snapshot",
  "alerts.created",
  "alerts.updated",
  "alerts.read",
];
