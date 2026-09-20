/**
 * cluster-status API 항목 타입 (docs/api/cluster-status.md 1절).
 */
import type { Reason, Status, StatusInfo } from '../common/status';
import type { WorkloadKind } from './model';

export interface ResourceRef {
  kind: string;
  namespace: string | null;
  name: string;
}

export interface Thresholds {
  warnPct: number;
  critPct: number | null;
}

export interface NodeItem {
  name: string;
  status: StatusInfo;
  instanceType: string | null;
  zone: string | null;
  nodeGroup: string | null;
  capacityType: 'on_demand' | 'spot' | null;
  architecture: string | null;
  kubeletVersion: string;
  createdAt: string;
  ready: { value: 'True' | 'False' | 'Unknown'; since: string | null };
  unschedulable: boolean;
  pressure: {
    memory: boolean;
    disk: boolean;
    pid: boolean;
    networkUnavailable: boolean;
  };
  allocatable: { cpuMillicores: number; memoryBytes: number; pods: number };
  usage: {
    cpuMillicores: number;
    memoryBytes: number;
    cpuPct: number;
    memoryPct: number;
    updatedAt: string;
  } | null;
  requests: {
    cpuMillicores: number;
    memoryBytes: number;
    cpuPct: number;
    memoryPct: number;
  };
  limits: {
    cpuMillicores: number;
    memoryBytes: number;
    cpuPct: number;
    memoryPct: number;
  };
  pods: { count: number; max: number; pct: number };
}

export interface WorkloadItem {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  key: string;
  status: StatusInfo;
  isSystemNamespace: boolean;
  replicas: {
    desired: number | null;
    ready: number;
    updated: number | null;
    available: number | null;
  };
  stopped: boolean;
  rollout: {
    state: 'complete' | 'progressing' | 'failed' | 'unknown';
    reason: string | null;
  };
  images: string[];
  createdAt: string;
  lastRolloutAt: string | null;
  podCounts: { critical: number; warning: number; ok: number; unknown: number };
  hasPdb: boolean;
  hpa: {
    minReplicas: number | null;
    maxReplicas: number;
    currentReplicas: number | null;
  } | null;
  source: 'watch' | 'derived_from_pods';
}

export interface ResourceAmounts {
  cpuMillicores: number | null;
  memoryBytes: number | null;
}

export type PodOwnerKind =
  | 'Deployment'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'Job'
  | 'ReplicaSet'
  | 'Node'
  | 'Other';

export interface PodItem {
  namespace: string;
  name: string;
  key: string;
  status: StatusInfo;
  isSystemNamespace: boolean;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  terminatingSince: string | null;
  completed: boolean;
  owner: {
    kind: PodOwnerKind;
    name: string;
    workloadKey: string | null;
  } | null;
  nodeName: string | null;
  containers: { ready: number; total: number };
  restarts: { total: number; last1h: number; observedSec: number };
  waitingReason: string | null;
  lastTermination: {
    reason: string | null;
    exitCode: number | null;
    finishedAt: string | null;
  } | null;
  startedAt: string | null;
  createdAt: string;
  qosClass: 'Guaranteed' | 'Burstable' | 'BestEffort';
  usage: {
    cpuMillicores: number;
    memoryBytes: number;
    updatedAt: string;
  } | null;
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
  firstSeenAt: string;
  lastSeenAt: string;
  severe: boolean;
  sourceComponent: string | null;
}

export interface PvcItem {
  namespace: string;
  name: string;
  key: string;
  status: StatusInfo;
  phase: 'Pending' | 'Bound' | 'Lost';
  phaseSince: string | null;
  capacityBytes: number | null;
  requestedBytes: number | null;
  storageClass: string | null;
  volumeName: string | null;
  usage: {
    usedBytes: number;
    pct: number;
    source: 'prometheus' | 'db_size_approx';
    updatedAt: string;
  } | null;
  mountedBy: ResourceRef[];
  isDbVolume: boolean;
}

export interface ProblemItem {
  ref: ResourceRef;
  status: Status;
  reason: string;
}

export interface AreaCounts {
  critical: number;
  warning: number;
  ok: number;
  unknown: number;
}

export interface Areas {
  nodes: {
    status: StatusInfo;
    ready: number;
    total: number;
    problems: ProblemItem[];
  };
  workloads: {
    status: StatusInfo;
    total: number;
    counts: AreaCounts;
    problems: ProblemItem[];
  };
  pods: {
    status: StatusInfo;
    total: number;
    counts: AreaCounts;
    problems: ProblemItem[];
  };
  events: {
    status: StatusInfo;
    warnings15m: number;
    severe15m: number;
    problems: ProblemItem[];
  };
  db: {
    status: StatusInfo;
    configured: boolean;
    headline: { label: string; value: number | null; unit: string } | null;
  };
  metrics: { status: StatusInfo; available: boolean };
}

export type AttentionArea =
  'node' | 'workload' | 'pod' | 'event' | 'db' | 'pvc' | 'metrics';

export interface AttentionItem {
  area: AttentionArea;
  ref: ResourceRef;
  status: Status;
  reason: Reason;
  statusChangedAt: string | null;
}

export interface ClusterInfo {
  name: string | null;
  version: string | null;
  region: string | null;
  connected: boolean;
}

export interface MetricPoint {
  t: string;
  cpuMillicores: number | null;
  memoryBytes: number | null;
  cpuPct: number | null;
  memoryPct: number | null;
  cpuStatus: Status | null;
  memoryStatus: Status | null;
}

export interface ClusterMetricsBody {
  available: boolean;
  unavailableReason: { code: string; message: string } | null;
  updatedAt: string | null;
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
  history: {
    source: 'in_memory' | 'prometheus';
    maxRangeSec: number;
    stepSec: number;
    observedSec: number;
  };
}

/** DB 영역 요약 (db-health 모듈이 등록) */
export interface DbAreaSummary {
  status: StatusInfo;
  configured: boolean;
  headline: { label: string; value: number | null; unit: string } | null;
  /** "지금 확인할 항목"에 넣을 항목 (DB 지표별) */
  attention: AttentionItem[];
}

/**
 * db-health → cluster 역방향 제공자 (모듈 순환을 피하려고 등록 방식).
 */
export interface DbK8sView {
  atIso: string;
  workloadMap: Map<string, WorkloadItem>;
  pods: PodItem[];
  pvcs: PvcItem[];
}

export interface DbAreaProvider {
  /** 평가 도중 호출된다: 인자로 받은 쿠버네티스 항목만 쓰고 ClusterStateService를 다시 부르지 말 것 */
  areaSummary(k8s: DbK8sView): DbAreaSummary;
  /** DB 크기 + WAL 근사치 (PVC 사용량 근사) */
  approxDataDir(): { bytes: number; measuredAt: string } | null;
  /** 모니터링 대상 StatefulSet */
  target(): { namespace: string; statefulSet: string } | null;
}
