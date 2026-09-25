/**
 * cluster-status API 항목 타입 (docs/api/cluster-status.md 1절).
 */
import type { Reason, Status, StatusInfo } from '../common/status';
import type { NodeRole, WorkloadKind } from './model';

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
  /** 워커 / 컨트롤 플레인(마스터). 모든 노드 응답에 항상 있다 (계약 1.1) */
  role: NodeRole;
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
  /**
   * 소속 파드 선택기가 붙은 로그 화면 링크 (진입점 5, docs/api/logs.md 11.4).
   * `LOGS_ENABLED=false`·차단 네임스페이스면 `null`. 규칙은 `logs/log-href.ts` 한 곳이다.
   */
  logHref: string | null;
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
  /**
   * 이 파드의 로그 화면 링크 (진입점 1·2·7, docs/api/logs.md 11.4). `follow=1`이 붙는다.
   * `LOGS_ENABLED=false`·차단 네임스페이스면 `null` — 화면은 링크·로그 섹션을 그리지 않는다.
   */
  logHref: string | null;
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
  /**
   * 대상 파드의 로그 화면 링크 (진입점 4, docs/api/logs.md 11.4). `at=<lastSeenAt>`이 붙고 `follow`는 없다.
   * 대상이 파드가 아니거나 `LOGS_ENABLED=false`·차단 네임스페이스면 `null`.
   * **파드가 이미 사라졌어도 링크는 준다** — 로그 화면이 사라진 파드 화면(S3)으로 정직하게 말한다.
   */
  logHref: string | null;
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

// --- 컨트롤 플레인 (계약 1.6 / 3.3) ---------------------------------------

/** 필수 구성요소 5종. 이 순서로 매트릭스 열(종류)을 만든다 */
export const CONTROL_PLANE_COMPONENT_KINDS = [
  'kube-apiserver',
  'kube-controller-manager',
  'kube-scheduler',
  'etcd-manager-main',
  'etcd-manager-events',
] as const;

export type ControlPlaneComponentKind =
  (typeof CONTROL_PLANE_COMPONENT_KINDS)[number];

export type ControlPlaneCellState =
  | 'ok'
  | 'warning'
  | 'critical'
  | 'not_reporting'
  | 'unknown'
  | 'missing'
  | 'stale';

export interface ControlPlaneComponent {
  kind: ControlPlaneComponentKind;
  nodeName: string;
  podKey: string | null;
  /**
   * 이 구성요소(미러 파드)의 로그 화면 링크 (docs/api/logs.md 11.3·11.4). `follow=1`이 붙는다.
   * 파드를 모르거나(`missing`) 로그 기능이 꺼져 있거나 네임스페이스가 차단되면 `null`.
   * **평가 단계에서 채운다** — REST(`GET /api/cluster/control-plane`)와 SSE(`cluster.snapshot`·
   * `cluster.controlplane.updated`)가 같은 객체를 쓰므로 값이 갈라지지 않는다.
   * **RBAC는 늘어나지 않는다** — 컨트롤 플레인도 같은 `pods/log` 경로로 읽는다.
   */
  logHref: string | null;
  cellState: ControlPlaneCellState;
  cellText: string;
  /** 짧은 보조 문구(잘려도 되는 것은 tooltip에 둔다). 정상이면 null */
  cellDetail: string | null;
  /** 잘리면 안 되는 전체 문장. 화면은 이것을 title/툴팁으로 붙인다 */
  cellTooltip: string | null;
  status: StatusInfo;
  ready: boolean | null;
  containers: { ready: number; total: number } | null;
  waitingReason: string | null;
  restarts: {
    last1h: number;
    last24h: number;
    total: number;
    observedSec: number;
  };
  lastTermination: {
    reason: string | null;
    exitCode: number | null;
    finishedAt: string | null;
  } | null;
  startedAt: string | null;
  lastReportedAt: string | null;
  clickable: boolean;
}

export interface ControlPlaneMasterItem {
  node: NodeItem;
  reporting: boolean;
  lastReportedAt: string | null;
  components: { ready: number; total: number; worst: Status };
  /** 0(없음)과 null(세지 못함)을 구분한다 */
  workerPodCount: number | null;
  reasonText: string | null;
}

export interface ControlPlaneBody {
  found: boolean;
  notFoundReason: { code: string; text: string } | null;
  status: StatusInfo;
  headline: string;
  masters: {
    ready: number;
    total: number;
    haExpected: boolean;
    haStatus: 'ok' | 'single' | 'even' | 'unknown';
    quorum: {
      state: 'ok' | 'at_risk' | 'lost' | 'unknown';
      requiredReady: number;
      readyMasters: number;
      basis: 'master_node_count';
    };
    zones: { zone: string; count: number }[];
    zoneSpread: 'spread' | 'single_zone' | 'unknown';
    totals: ControlPlaneMetricsBlock;
    items: ControlPlaneMasterItem[];
  };
  components: {
    requiredKinds: readonly ControlPlaneComponentKind[];
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
      /** 화면 요약의 "알 수 없음" = notReporting + unknown + missing (PM 결정) */
      unknownTotal: number;
    };
    summaryText: string;
    /** 매트릭스 열(마스터) 머리. `reason`은 마스터 표 사유 열과 같은 값 */
    columns: {
      nodeName: string;
      reporting: boolean;
      lastReportedAt: string | null;
      worst: Status;
      reason: string | null;
    }[];
    byKind: {
      kind: ControlPlaneComponentKind;
      ready: number;
      expected: number;
      status: Status;
    }[];
    items: ControlPlaneComponent[];
  };
  others: {
    name: string;
    nodeName: string;
    status: Status;
    ready: boolean;
    restarts1h: number;
  }[];
  thresholds: {
    restarts1h: { warn: number; crit: number };
    componentNotReadySec: number;
    masterNotReadySec: number;
  };
  limits: {
    etcdInternalMetrics: false;
    notes: { code: string; text: string }[];
  };
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
  controlPlane: {
    status: StatusInfo;
    found: boolean;
    masters: { ready: number; total: number };
    components: { ready: number; total: number };
    quorum: ControlPlaneBody['masters']['quorum'];
    haExpected: boolean;
    problems: ProblemItem[];
  };
}

export type AttentionArea =
  | 'node'
  | 'control_plane'
  | 'workload'
  | 'pod'
  | 'event'
  | 'db'
  | 'pvc'
  | 'metrics';

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

/** 마스터 합계 블록 (계약 7.2). 상태 배지 없이 숫자만 준다 */
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
  updatedAt: string | null;
  /** 합계 기준. 항상 worker 고정 (플랫폼 분기 없음) */
  scope: {
    basis: 'worker';
    workerNodeCount: number;
    controlPlaneNodeCount: number;
  };
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
  /** 마스터 노드만 합산한 블록 (cpu·memory와 더하지 않는다) */
  controlPlane: ControlPlaneMetricsBlock;
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
