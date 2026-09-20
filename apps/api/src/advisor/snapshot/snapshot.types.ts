/**
 * 브리지 입력 스냅샷 `AdvisorSnapshotV1` (docs/api/architecture-advisor.md B.2)
 * 허용 목록 방식: 여기 정의된 필드만 스냅샷에 들어간다 (sanitize-snapshot.ts가 강제).
 */
import type { Status } from '../advisor.types';

export interface UsagePct {
  avgPct: number | null;
  maxPct: number | null;
  requestsPct: number;
}

export interface SnapshotNodeGroup {
  name: string;
  instanceTypes: { type: string; count: number }[];
  architecture: string | null;
  capacityType: 'on_demand' | 'spot' | 'mixed' | null;
  zones: string[];
  nodeCount: number;
  cpu: UsagePct;
  memory: UsagePct;
  statelessOnly: boolean;
  estimatedUsdPerMonth: number | null;
}

export interface SnapshotNode {
  name: string;
  nodeGroup: string | null;
  instanceType: string | null;
  architecture: string | null;
  capacityType: 'on_demand' | 'spot' | null;
  zone: string | null;
  allocatable: { cpuMillicores: number; memoryBytes: number; pods: number };
  cpu: UsagePct & { currentPct: number | null };
  memory: UsagePct & { currentPct: number | null };
  podCount: number;
  status: Status;
  reasonCodes: string[];
}

export interface SnapshotContainer {
  name: string;
  image: string;
  requests: { cpuMillicores: number | null; memoryBytes: number | null };
  limits: { cpuMillicores: number | null; memoryBytes: number | null };
  usage: {
    cpuAvgMillicores: number | null;
    cpuMaxMillicores: number | null;
    memoryAvgBytes: number | null;
    memoryMaxBytes: number | null;
  } | null;
  probes: { readiness: boolean; liveness: boolean };
  security: {
    privileged: boolean;
    allowPrivilegeEscalation: boolean | null;
    runAsNonRoot: boolean | null;
  };
}

export interface SnapshotWorkload {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
  namespace: string;
  name: string;
  desired: number | null;
  ready: number;
  nodeGroups: string[];
  containers: SnapshotContainer[];
  podSecurity: {
    hostNetwork: boolean;
    hostPID: boolean;
    hostPath: boolean;
    defaultServiceAccount: boolean;
    automountToken: boolean | null;
  };
  hasPdb: boolean;
  hpa: { min: number | null; max: number } | null;
  restarts24h: number;
  oom24h: number;
  status: Status;
  labels: Record<string, string>;
}

export interface SnapshotStorage {
  namespace: string;
  name: string;
  capacityBytes: number | null;
  volumeType: string | null;
  volumeRef: string | null;
  usagePct: number | null;
  usageSource: 'prometheus' | 'db_size_approx' | null;
  attached: boolean;
  usdPerMonth: number | null;
}

export interface SnapshotUnattachedVolume {
  volumeRef: string;
  volumeType: string;
  capacityBytes: number;
  clusterTagged: boolean;
  usdPerMonth: number | null;
}

export interface SnapshotLoadBalancer {
  ref: string;
  type: 'alb' | 'nlb' | 'clb';
  attachedTo: {
    kind: 'Service' | 'Ingress';
    namespace: string;
    name: string;
  }[];
  healthyTargets: number | null;
  usdPerMonth: number | null;
}

export interface SnapshotDb {
  vendor: 'postgres';
  version: string | null;
  replicas: number | null;
  pvcUsagePct: number | null;
  pvcUsageSource: 'prometheus' | 'db_size_approx' | null;
  connections: {
    currentPct: number | null;
    maxObservedPct: number | null;
    max: number | null;
  };
  longRunningQueries: { over5m: number; over30m: number } | null;
  cacheHitPct: number | null;
  xidAge: number | null;
  databases: { name: string; bytes: number }[];
  resources: {
    qosClass: string | null;
    requestsSet: boolean;
    limitsSet: boolean;
  };
  onSpot: boolean | null;
}

export interface SnapshotCost {
  currency: 'USD';
  asOf: string | null;
  rate: {
    totalUsdPerHour: number | null;
    byCategory: {
      category: 'ec2' | 'ebs' | 'lb' | 'ipv4' | 'eks';
      usdPerHour: number;
    }[];
    byNodeGroup: {
      nodeGroup: string;
      usdPerHour: number;
      usdPerMonth: number;
    }[];
    unpricedCount: number;
  };
  allocation: {
    namespace: string;
    usdPerMonth: number;
    sharePct: number;
    requestsMissingPods: number;
  }[];
  actual: {
    monthToDateUsd: number;
    settledThrough: string;
    topServices: { service: string; mtdUsd: number }[];
    scope: 'account' | 'tag_filter';
  } | null;
  forecast: { monthEndUsd: number; lowUsd: number; highUsd: number } | null;
  budget: {
    budgetUsd: number;
    status: Status;
    projectedPct: number | null;
  } | null;
  alternatives: {
    instanceType: string;
    currentUsdPerHour: number | null;
    graviton: { type: string; usdPerHour: number | null } | null;
    smaller: { type: string; usdPerHour: number | null } | null;
    spot: { usdPerHour: number | null; zone: string | null } | null;
  }[];
  ebsGbMonth: { gp2: number | null; gp3: number | null };
}

export interface SnapshotPrecheck {
  ruleId: string;
  category: string;
  severity: 'high' | 'medium' | 'low' | null;
  held: boolean;
  summary: string;
  targets: { kind: string; namespace: string | null; name: string }[];
  evidence: {
    field: string | null;
    value: string | number | null;
    text: string;
  }[];
  savings: { monthlyUsd: number; formula: string } | null;
}

export interface SnapshotCluster {
  platform: 'eks';
  version: string;
  region: string | null;
  supportTier: 'standard' | 'extended' | null;
  nodeCount: number;
  namespaceCount: number;
}

export interface AdvisorSnapshotV1 {
  schemaVersion: 1;
  meta: {
    generatedAt: string;
    dataSource: 'mock' | 'live';
    observationSec: { metrics: number; restarts: number };
    omitted: { workloads: number; nodes: number };
    redactedCount: number;
    systemNamespacesIncluded: boolean;
    pseudonyms: { nodes: number; volumes: number; loadBalancers: number };
  };
  cluster: SnapshotCluster;
  nodeGroups: SnapshotNodeGroup[];
  nodes: SnapshotNode[];
  workloads: SnapshotWorkload[];
  storage: SnapshotStorage[];
  unattachedVolumes: SnapshotUnattachedVolume[];
  loadBalancers: SnapshotLoadBalancer[];
  events: {
    windowSec: 3600;
    byReason: { reason: string; kind: string; count: number }[];
  };
  db: SnapshotDb | null;
  cost: SnapshotCost | null;
  prechecks: SnapshotPrecheck[];
}

/**
 * 섹션 기여자(AdvisorSnapshotContributor)가 돌려주는 값.
 * - cluster: 클러스터 관련 필드 (cluster, nodeGroups, nodes, workloads, storage, loadBalancers,
 *   unattachedVolumes, events, observationSec) — 없는 필드는 빈 값으로 채운다.
 * - db: `SnapshotDb` 그대로 또는 `{ db: SnapshotDb }`
 * - cost: `SnapshotCost` 그대로 또는 `{ cost, unattachedVolumes?, loadBalancers? }`
 * 모든 값은 원시 쿠버네티스/AWS 객체가 아니라 위 스키마로 이미 골라 담은 값이어야 한다.
 * (advisor는 허용 목록 필드만 다시 복사하므로 여분 필드는 버려진다)
 */
export interface ClusterContribution {
  cluster?: Partial<SnapshotCluster>;
  nodeGroups?: SnapshotNodeGroup[];
  nodes?: SnapshotNode[];
  workloads?: SnapshotWorkload[];
  storage?: SnapshotStorage[];
  loadBalancers?: SnapshotLoadBalancer[];
  unattachedVolumes?: SnapshotUnattachedVolume[];
  events?: { byReason: { reason: string; kind: string; count: number }[] };
  observationSec?: { metrics?: number; restarts?: number };
}

export interface CostContribution {
  cost?: SnapshotCost | null;
  unattachedVolumes?: SnapshotUnattachedVolume[];
  loadBalancers?: SnapshotLoadBalancer[];
}

export interface SnapshotSections {
  cluster: ClusterContribution | null;
  db: SnapshotDb | null;
  cost: CostContribution | null;
}
