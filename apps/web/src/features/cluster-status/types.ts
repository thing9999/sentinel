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

export interface NodeItem {
  name: string;
  status: StatusInfo;
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

export interface Areas {
  nodes: { status: StatusInfo; ready: number; total: number; problems: AreaProblem[] };
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

export type AttentionArea = "node" | "workload" | "pod" | "event" | "db" | "pvc" | "metrics";

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
  nodes: NodeItem[];
  workloads: WorkloadItem[];
  pods: PodItem[];
  events: EventItem[];
  pvcs: PvcItem[];
}

export interface ClusterMetricsBody {
  available: boolean;
  unavailableReason: { code: string; message: string } | null;
  updatedAt: IsoTime | null;
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
