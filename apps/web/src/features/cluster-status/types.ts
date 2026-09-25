/**
 * docs/api/cluster-status.md 1~8절 타입. 계약에 있는 필드만 둔다.
 */
import type { ApiStatusValue, DataSource, IsoTime, Reason, ResourceRef, StatusInfo, Thresholds } from "../common/types";

export interface NodeUsage {
  cpuMillicores: number;
  memoryBytes: number;
  cpuPct: number;
  memoryPct: number;
  updatedAt: IsoTime;
}

/** 노드 역할 (cluster-status.md 1.1, 2026-09-24 kops-support). kOps는 마스터도 사용자 소유 EC2라 같은 목록에 나온다 */
export type NodeRole = "worker" | "control_plane";

export interface NodeItem {
  name: string;
  status: StatusInfo;
  /** 서버가 노드 라벨로 판정한 값. 화면이 이름·라벨로 다시 추론하지 않는다 */
  role: NodeRole;
  instanceType: string | null;
  zone: string | null;
  nodeGroup: string | null;
  capacityType: "on_demand" | "spot" | null;
  architecture: string | null;
  kubeletVersion: string;
  createdAt: IsoTime;
  ready: { value: "True" | "False" | "Unknown"; since: IsoTime | null };
  unschedulable: boolean;
  pressure: { memory: boolean; disk: boolean; pid: boolean; networkUnavailable: boolean };
  allocatable: { cpuMillicores: number; memoryBytes: number; pods: number };
  usage: NodeUsage | null;
  requests: { cpuMillicores: number; memoryBytes: number; cpuPct: number; memoryPct: number };
  limits: { cpuMillicores: number; memoryBytes: number; cpuPct: number; memoryPct: number };
  pods: { count: number; max: number; pct: number };
}

export type WorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

export interface WorkloadItem {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  key: string;
  status: StatusInfo;
  isSystemNamespace: boolean;
  replicas: { desired: number | null; ready: number; updated: number | null; available: number | null };
  stopped: boolean;
  rollout: { state: "complete" | "progressing" | "failed" | "unknown"; reason: string | null };
  images: string[];
  createdAt: IsoTime;
  lastRolloutAt: IsoTime | null;
  podCounts: { critical: number; warning: number; ok: number; unknown: number };
  hasPdb: boolean;
  hpa: { minReplicas: number | null; maxReplicas: number; currentReplicas: number | null } | null;
  source: "watch" | "derived_from_pods";
  /**
   * 로그 화면 링크(계약 cluster-status 1.2 · logs 11.4). `/logs?namespace=…&workload=<key>&follow=1`.
   * **서버 규칙 한 곳이 만든 값을 그대로** 쓴다(화면이 파라미터를 덧붙이지 않는다). `null`이면 링크를 그리지 않는다
   */
  logHref: string | null;
}

export interface ResourceAmounts {
  cpuMillicores: number | null;
  memoryBytes: number | null;
}

export interface PodItem {
  namespace: string;
  name: string;
  key: string;
  status: StatusInfo;
  isSystemNamespace: boolean;
  phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
  terminatingSince: IsoTime | null;
  completed: boolean;
  owner: {
    kind: "Deployment" | "StatefulSet" | "DaemonSet" | "Job" | "ReplicaSet" | "Node" | "Other";
    name: string;
    workloadKey: string | null;
  } | null;
  nodeName: string | null;
  containers: { ready: number; total: number };
  restarts: { total: number; last1h: number; observedSec: number };
  waitingReason: string | null;
  lastTermination: { reason: string | null; exitCode: number | null; finishedAt: IsoTime | null } | null;
  startedAt: IsoTime | null;
  createdAt: IsoTime;
  qosClass: "Guaranteed" | "Burstable" | "BestEffort";
  usage: { cpuMillicores: number; memoryBytes: number; updatedAt: IsoTime } | null;
  requests: ResourceAmounts;
  limits: ResourceAmounts;
  memoryLimitPct: number | null;
  cpuRequestPct: number | null;
  /** 로그 화면 링크 `/logs?namespace=…&pod=…&follow=1` (logs 11.4). 서버 값 그대로, `null`이면 그리지 않는다 */
  logHref: string | null;
}

export interface EventItem {
  key: string;
  namespace: string | null;
  involvedObject: ResourceRef;
  reason: string;
  message: string;
  count: number;
  firstSeenAt: IsoTime;
  lastSeenAt: IsoTime;
  severe: boolean;
  sourceComponent: string | null;
  /** 대상이 파드일 때만 `/logs?namespace=…&pod=…&at=<lastSeenAt>` — "지난 시점"이라 `follow`가 없다(logs 11.4) */
  logHref: string | null;
}

export interface PvcItem {
  namespace: string;
  name: string;
  key: string;
  status: StatusInfo;
  phase: "Pending" | "Bound" | "Lost";
  phaseSince: IsoTime | null;
  capacityBytes: number | null;
  requestedBytes: number | null;
  storageClass: string | null;
  volumeName: string | null;
  usage: { usedBytes: number; pct: number; source: "prometheus" | "db_size_approx"; updatedAt: IsoTime } | null;
  mountedBy: ResourceRef[];
  isDbVolume: boolean;
}

export interface AreaProblem {
  ref: ResourceRef;
  status: ApiStatusValue;
  reason: string;
}

/** 필수 구성요소 5종. 이 순서로 매트릭스의 행을 만든다 (계약 1.6) */
export type ControlPlaneComponentKind =
  | "kube-apiserver"
  | "kube-controller-manager"
  | "kube-scheduler"
  | "etcd-manager-main"
  | "etcd-manager-events";

/** 매트릭스 한 칸의 상태. **서버가 확정한 값**이다. 화면은 조건을 조합하지 않는다 (계약 1.6) */
export type ControlPlaneCellState =
  | "ok"
  | "warning"
  | "critical"
  | "not_reporting"
  | "unknown"
  | "missing"
  | "stale";

export interface ControlPlaneComponent {
  kind: ControlPlaneComponentKind;
  nodeName: string;
  podKey: string | null;
  cellState: ControlPlaneCellState;
  cellText: string;
  cellDetail: string | null;
  /** 잘리면 안 되는 전체 문장. **툴팁 없이 자르지 않는다** (디자이너 못박음) */
  cellTooltip: string | null;
  status: StatusInfo;
  ready: boolean | null;
  containers: { ready: number; total: number } | null;
  waitingReason: string | null;
  restarts: { last1h: number; last24h: number; total: number; observedSec: number };
  lastTermination: { reason: string | null; exitCode: number | null; finishedAt: IsoTime | null } | null;
  startedAt: IsoTime | null;
  lastReportedAt: IsoTime | null;
  clickable: boolean;
  /**
   * 로그 화면 링크 (docs/api/logs.md 11.3·11.4). REST 와 SSE(`cluster.snapshot`·`cluster.controlplane.updated`)가
   * **같은 값**이다(2026-09-25 backend 결함 수정). 화면은 그대로 쓴다 — `podKey`로 만들던 폴백은 지웠다.
   * `podKey`가 없거나(`missing`) 로그 기능이 꺼져 있거나 차단된 네임스페이스면 `null`이다.
   */
  logHref: string | null;
}

export interface ControlPlaneMasterItem {
  node: NodeItem;
  reporting: boolean;
  lastReportedAt: IsoTime | null;
  components: { ready: number; total: number; worst: ApiStatusValue };
  /** `0`(없음)과 `null`(세지 못함)을 구분한다 */
  workerPodCount: number | null;
  reasonText: string | null;
}

/** 매트릭스 열 머리. `masters.items`와 같은 순서·길이 */
export interface ControlPlaneColumn {
  nodeName: string;
  reporting: boolean;
  lastReportedAt: IsoTime | null;
  worst: ApiStatusValue;
  /** 마스터 표의 `사유` 열과 **같은 서버 문자열**. 화면이 문장을 새로 만들지 않는다 */
  reason: string | null;
}

/** GET /api/cluster/control-plane = cluster.controlplane.updated payload (계약 3.3) */
export interface ControlPlaneBody {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  found: boolean;
  notFoundReason: { code: string; text: string } | null;
  status: StatusInfo;
  /** 섹션·카드에 그대로 쓰는 대표 사유 한 줄 (서버 문장) */
  headline: string;
  masters: {
    ready: number;
    total: number;
    haExpected: boolean;
    haStatus: "ok" | "single" | "even" | "unknown";
    quorum: {
      state: "ok" | "at_risk" | "lost" | "unknown";
      requiredReady: number;
      readyMasters: number;
      basis: "master_node_count";
    };
    zones: { zone: string; count: number }[];
    zoneSpread: "spread" | "single_zone" | "unknown";
    /** 마스터만 합산. `/metrics`의 `controlPlane`과 같은 값. **상태 배지 없음** */
    totals: {
      available: boolean;
      cpu: { allocatableMillicores: number; usageMillicores: number | null; usagePct: number | null; requestsMillicores: number; requestsPct: number } | null;
      memory: { allocatableBytes: number; usageBytes: number | null; usagePct: number | null; requestsBytes: number; requestsPct: number } | null;
    };
    items: ControlPlaneMasterItem[];
  };
  components: {
    requiredKinds: ControlPlaneComponentKind[];
    ready: number;
    total: number;
    cellCounts: {
      total: number;
      ok: number;
      warning: number;
      critical: number;
      notReporting: number;
      unknown: number;
      missing: number;
      stale: number;
      /** 요약의 "알 수 없음" = notReporting + unknown + missing (PM 결정). 화면이 다시 더하지 않는다 */
      unknownTotal: number;
    };
    summaryText: string;
    columns: ControlPlaneColumn[];
    byKind: { kind: ControlPlaneComponentKind; ready: number; expected: number; status: ApiStatusValue }[];
    /** 마스터 × 5종 **전체 칸**. 빈 칸이 없다 */
    items: ControlPlaneComponent[];
  };
  others: { name: string; nodeName: string; status: ApiStatusValue; ready: boolean; restarts1h: number }[];
  thresholds: { restarts1h: { warn: number; crit: number }; componentNotReadySec: number; masterNotReadySec: number };
  limits: { etcdInternalMetrics: boolean; notes: { code: string; text: string }[] };
}

/**
 * 컨트롤 플레인 영역 (cluster-status.md 2.1, 2026-09-24 kops-support).
 * 백엔드 P3 전에는 응답에 없으므로 optional 로 둔다 — 화면은 값이 있을 때만 그린다.
 */
export interface ControlPlaneArea {
  status: StatusInfo;
  found: boolean;
  masters: { ready: number; total: number };
  components: { ready: number; total: number };
  quorum: {
    state: "ok" | "at_risk" | "lost" | "unknown";
    requiredReady: number;
    readyMasters: number;
    basis: "master_node_count";
  };
  haExpected: boolean;
  problems: AreaProblem[];
}

export interface Areas {
  /** **워커 노드만**. `ready`/`total`에 마스터를 더하지 않는다 (AC-KOPS10) */
  nodes: { status: StatusInfo; ready: number; total: number; problems: AreaProblem[] };
  /** 백엔드 P3 전에는 없다 */
  controlPlane?: ControlPlaneArea;
  workloads: {
    status: StatusInfo;
    total: number;
    counts: { critical: number; warning: number; ok: number; unknown: number };
    problems: AreaProblem[];
  };
  pods: {
    status: StatusInfo;
    total: number;
    counts: { critical: number; warning: number; ok: number; unknown: number };
    problems: AreaProblem[];
  };
  events: { status: StatusInfo; warnings15m: number; severe15m: number; problems: AreaProblem[] };
  db: {
    status: StatusInfo;
    configured: boolean;
    headline: { label: string; value: number; unit: string } | null;
  };
  metrics: { status: StatusInfo; available: boolean };
}

export type AttentionArea = "node" | "control_plane" | "workload" | "pod" | "event" | "db" | "pvc" | "metrics";

export interface AttentionItem {
  area: AttentionArea;
  ref: ResourceRef;
  status: ApiStatusValue;
  reason: Reason;
  statusChangedAt: IsoTime | null;
}

export type NavKey = "overview" | "nodes" | "workloads" | "pods" | "events" | "db" | "cost" | "advisor";

export interface ClusterInfo {
  name: string | null;
  version: string | null;
  region: string | null;
  connected: boolean;
}

/** GET /api/overview = overview.snapshot / overview.updated payload */
export interface OverviewResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  cluster: ClusterInfo;
  overall: StatusInfo;
  areas: Areas;
  attention: { total: number; items: AttentionItem[] };
  nav: Record<NavKey, ApiStatusValue> & {
    advisorBusy: boolean;
    stale: Record<Exclude<NavKey, "overview">, boolean>;
  };
  cost: {
    status: StatusInfo;
    rate: { amountUsd: number; kind: "estimated" | "actual" | "forecast"; asOf: IsoTime } | null;
    monthToDate: { amountUsd: number; kind: "estimated" | "actual" | "forecast"; asOf: IsoTime } | null;
    budgetStatus: ApiStatusValue | null;
    available: boolean;
  };
  advisor: {
    precheck: { status: ApiStatusValue; high: number; medium: number; low: number; held: number };
    lastRun: { id: string; status: string; finishedAt: IsoTime | null; suggestionCount: number } | null;
    bridge: string;
    busy: boolean;
    available: boolean;
  };
}

export interface ClusterThresholds {
  node: {
    cpu: Thresholds;
    memory: Thresholds;
    requests: Thresholds;
    pods: Thresholds;
  };
  pod: { memoryLimit: Thresholds; restarts1h: { warn: number; crit: number } };
  pvc: { usage: Thresholds };
}

/** cluster.snapshot payload (8.2) */
export interface ClusterSnapshot {
  sync: { initialSyncDone: boolean; lastSyncAt: IsoTime | null };
  cluster: ClusterInfo;
  areas: Areas;
  restartObservation: { observedSec: number; fullWindow: boolean };
  thresholds: ClusterThresholds;
  /** 워커·마스터 **전부**. 화면이 `role`로 나눈다 (계약 8.2) */
  nodes: NodeItem[];
  /** `GET /api/cluster/control-plane` 응답에서 dataSource·generatedAt 을 뺀 것 */
  controlPlane: ControlPlaneBody;
  workloads: WorkloadItem[];
  pods: PodItem[];
  events: EventItem[];
  pvcs: PvcItem[];
}

/** 마스터만 합산한 블록 (cluster-status.md 7.2). `cpu`·`memory`와 **더하지 않는다** */
export interface ControlPlaneMetricsBlock {
  available: boolean;
  nodeCount: number;
  cpu: {
    allocatableMillicores: number;
    usageMillicores: number | null;
    usagePct: number | null;
    requestsMillicores: number;
    requestsPct: number;
    limitsMillicores: number;
    limitsPct: number;
  } | null;
  memory: {
    allocatableBytes: number;
    usageBytes: number | null;
    usagePct: number | null;
    requestsBytes: number;
    requestsPct: number;
    limitsBytes: number;
    limitsPct: number;
  } | null;
}

export interface ClusterMetricsBody {
  available: boolean;
  unavailableReason: { code: string; message: string } | null;
  updatedAt: IsoTime | null;
  /** 합계 기준. 항상 `worker` (AC-KOPS12). 화면은 "무엇의 합계인지" 문구에만 쓴다 */
  scope: { basis: "worker"; workerNodeCount: number; controlPlaneNodeCount: number };
  cpu: {
    status: StatusInfo;
    allocatableMillicores: number;
    usageMillicores: number | null;
    usagePct: number | null;
    requestsMillicores: number;
    requestsPct: number;
    limitsMillicores: number;
    limitsPct: number;
  };
  memory: {
    status: StatusInfo;
    allocatableBytes: number;
    usageBytes: number | null;
    usagePct: number | null;
    requestsBytes: number;
    requestsPct: number;
    limitsBytes: number;
    limitsPct: number;
  };
  controlPlane: ControlPlaneMetricsBlock;
  thresholds: { cpu: Thresholds; memory: Thresholds };
  history: { source: "in_memory" | "prometheus"; maxRangeSec: number; stepSec: number; observedSec: number };
}

export interface SeriesPoint {
  t: IsoTime;
  cpuMillicores: number | null;
  memoryBytes: number | null;
  cpuPct: number | null;
  memoryPct: number | null;
  cpuStatus: ApiStatusValue | null;
  memoryStatus: ApiStatusValue | null;
}

export interface NodeUsagePoint {
  name: string;
  cpuMillicores: number;
  memoryBytes: number;
  cpuPct: number;
  memoryPct: number;
}

export interface PodUsagePoint {
  key: string;
  cpuMillicores: number;
  memoryBytes: number;
  memoryLimitPct: number | null;
  cpuRequestPct: number | null;
}

/** metrics.snapshot payload (8.3) */
export interface MetricsSnapshot {
  cluster: ClusterMetricsBody;
  clusterSeries: { stepSec: number; source: string; observedSince: IsoTime | null; points: SeriesPoint[] };
  nodes: NodeUsagePoint[];
  pods: PodUsagePoint[];
}

/** metrics.updated payload (8.3) */
export interface MetricsUpdated {
  collectedAt: IsoTime;
  available: boolean;
  unavailableReason: { code: string; message: string } | null;
  cluster: Pick<ClusterMetricsBody, "cpu" | "memory" | "updatedAt">;
  clusterPoint: SeriesPoint | null;
  nodes: NodeUsagePoint[];
  pods: PodUsagePoint[];
}

/** GET /api/cluster/metrics/series */
export interface MetricsSeriesResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  target: ResourceRef;
  /** `target=cluster`일 때만 온다. 값은 항상 `{ basis: "worker" }` (AC-KOPS13) */
  scope?: { basis: "worker" };
  range: "1h" | "6h" | "24h";
  source: "in_memory" | "prometheus";
  stepSec: number;
  observedSince: IsoTime | null;
  available: boolean;
  unavailableReason: { code: string; message: string } | null;
  thresholds: { cpu: Thresholds; memory: Thresholds };
  denominators: { cpuMillicores: number | null; memoryBytes: number | null; memoryBasis: "allocatable" | "limit" };
  points: SeriesPoint[];
}

export interface NodeCondition {
  type: string;
  value: "True" | "False" | "Unknown" | null;
  since: IsoTime | null;
  reason: string | null;
  message: string | null;
  status: ApiStatusValue;
}

export interface NodeDetailResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  node: NodeItem;
  conditions: NodeCondition[];
  capacity: { cpuMillicores: number; memoryBytes: number; pods: number };
  pods: PodItem[];
  events: EventItem[];
  thresholds: ClusterThresholds["node"];
}

export interface WorkloadDetailResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  workload: WorkloadItem;
  conditions: { type: string; value: string | null; reason: string | null; message: string | null; since: IsoTime | null }[];
  pods: PodItem[];
  events: EventItem[];
}

export interface ContainerDetail {
  name: string;
  init: boolean;
  image: string;
  status: StatusInfo;
  ready: boolean;
  state: { type: "running" | "waiting" | "terminated"; reason: string | null; message: string | null; since: IsoTime | null };
  restarts: { total: number; last1h: number };
  lastTermination: { reason: string | null; exitCode: number | null; startedAt: IsoTime | null; finishedAt: IsoTime | null } | null;
  requests: ResourceAmounts;
  limits: ResourceAmounts;
  usage: { cpuMillicores: number; memoryBytes: number } | null;
  memoryLimitPct: number | null;
  probes: { readiness: boolean; liveness: boolean; startup: boolean };
}

export interface PodDetailResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  pod: PodItem;
  podIP: string | null;
  serviceAccountName: string | null;
  containers: ContainerDetail[];
  events: EventItem[];
}

export interface DbCheck {
  id: string;
  status: StatusInfo;
  value: number | null;
  unit: string;
  applicable: boolean;
  held: boolean;
  sustained: boolean;
  thresholds: { warn: number | null; crit: number | null };
}

export interface DbSession {
  pid: number;
  user: string | null;
  database: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  backendAgeSec: number | null;
  xactAgeSec: number | null;
  queryAgeSec: number | null;
  stateAgeSec: number | null;
}

export interface DbHealth {
  vendor: string;
  collectedAt: IsoTime;
  intervalSec: number;
  reachable: boolean;
  responseMs: number | null;
  error: string | null;
  server: { version: string; versionNum: number; role: string; uptimeSec: number } | null;
  connections: {
    total: number;
    max: number;
    usagePct: number;
    byState: { active: number; idle: number; idleInTransaction: number; idleInTransactionAborted: number; other: number };
    waitingOnLock: number;
  } | null;
  longRunning: {
    activeOverWarn: number;
    activeOverCrit: number;
    idleInTxOverWarn: number;
    idleInTxOverCrit: number;
    maxActiveSec: number | null;
    maxIdleInTxSec: number | null;
  } | null;
  sessions: DbSession[];
  locks: { waitingTotal: number; waitingOverThreshold: number; maxWaitSec: number; items: unknown[] } | null;
  throughput: {
    intervalSec: number;
    commitsPerSec: number | null;
    rollbacksPerSec: number | null;
    cacheHitPct: number | null;
    blocksInInterval: number | null;
    deadlocksDelta: number | null;
  } | null;
  xid: { maxAge: number; database: string | null; maxMultixactAge: number | null } | null;
  sizes: {
    measuredAt: IsoTime;
    databases: { name: string; bytes: number }[];
    totalBytes: number;
    walBytes: number | null;
    approxDataDirBytes: number | null;
  } | null;
  replication: {
    role: string;
    standbys: unknown[];
    slots: unknown[];
    standbyReplayDelaySec: number | null;
    walReceiverStatus: string | null;
  } | null;
  checks: DbCheck[];
}

/** GET /api/cluster/db = db.snapshot / db.updated payload */
export interface DbResponse {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  configured: boolean;
  target: { namespace: string; statefulSet: string; vendor: string } | null;
  status: StatusInfo;
  kubernetes: {
    status: StatusInfo;
    statefulSet: WorkloadItem | null;
    pods: PodItem[];
    pvcs: PvcItem[];
  } | null;
  health: DbHealth | null;
  pvcUsage: { pct: number; usedBytes: number; capacityBytes: number; source: "prometheus" | "db_size_approx" } | null;
}

export interface AttentionListResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  total: number;
  filteredTotal: number;
  offset: number;
  limit: number | null;
  items: AttentionItem[];
}
