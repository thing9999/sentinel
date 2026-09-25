/**
 * aws-cost 도메인·응답 타입 (docs/api/aws-cost.md).
 * 응답 모양은 계약 그대로. 내부 도메인 타입은 AWS 원본을 정리한 최소 필드만 둔다.
 */
import type { Reason, Status, StatusInfo } from '../common/status';

export type DataSource = 'mock' | 'live';
export type MoneyKind = 'estimated' | 'actual' | 'forecast';
export interface Money {
  amountUsd: number;
  kind: MoneyKind;
  asOf: string;
}
export interface Unavailable {
  code: string;
  message: string;
}
export interface Note {
  code: string;
  text: string;
}

export type CostCategory = 'ec2' | 'ebs' | 'lb' | 'ipv4' | 'controlPlane';
/** 화면 순서 고정 (계약 1절). 서버가 항상 이 순서로 내려보낸다 */
export const COST_CATEGORIES: readonly CostCategory[] = [
  'ec2',
  'ebs',
  'lb',
  'ipv4',
  'controlPlane',
];
export const CATEGORY_LABELS: Record<CostCategory, string> = {
  ec2: 'EC2 노드',
  ebs: 'EBS',
  lb: '로드밸런서',
  ipv4: '퍼블릭 IPv4',
  controlPlane: '컨트롤 플레인',
};

/** `controlPlane` 내역의 하위 종류 (리소스 종류가 아니라 '역할' 축) */
export type ControlPlaneCostKind =
  'master_ec2' | 'etcd_ebs' | 'master_root_ebs' | 'api_lb' | 'master_ipv4';
export const CONTROL_PLANE_KINDS: readonly ControlPlaneCostKind[] = [
  'master_ec2',
  'etcd_ebs',
  'master_root_ebs',
  'api_lb',
  'master_ipv4',
];
export const CONTROL_PLANE_KIND_LABELS: Record<ControlPlaneCostKind, string> = {
  master_ec2: '마스터 EC2',
  etcd_ebs: 'etcd 볼륨',
  master_root_ebs: '마스터 루트 볼륨',
  api_lb: 'API 서버 LB',
  master_ipv4: '마스터 퍼블릭 IPv4',
};

export type LbType = 'alb' | 'nlb' | 'clb';

// ---------------------------------------------------------------------------
// AWS 리소스 (정리된 값)
// ---------------------------------------------------------------------------

export interface AwsInstance {
  instanceId: string;
  instanceType: string;
  zone: string | null;
  /** InstanceLifecycle이 spot이면 spot, 그 밖은 on_demand */
  lifecycle: 'spot' | 'on_demand';
  architecture: string | null;
  publicIpv4Count: number;
  rootVolumeIds: string[];
  /** 태그 kops.k8s.io/instancegroup (kOps InstanceGroup 이름. 없으면 null) */
  nodeGroupTag: string | null;
}

export interface AwsVolume {
  volumeId: string;
  volumeType: string;
  sizeGiB: number;
  iops: number | null;
  throughputMibps: number | null;
  zone: string | null;
  state: string;
  attachedInstanceIds: string[];
  /** EBS CSI 태그 kubernetes.io/created-for/pvc/{namespace,name} */
  pvcNamespace: string | null;
  pvcName: string | null;
  /** 태그 ebs.csi.aws.com/cluster 존재 */
  csiManaged: boolean;
}

export interface K8sRef {
  kind: 'Service' | 'Ingress';
  namespace: string;
  name: string;
}

export interface AwsLoadBalancer {
  name: string;
  dnsName: string;
  lbType: LbType;
  /** 태그(service.k8s.aws/stack, ingress.k8s.aws/stack, kubernetes.io/service-name)에서 해석한 대상 */
  tagRefs: K8sRef[];
  /** 태그 elbv2.k8s.aws/cluster 또는 kubernetes.io/cluster/<name> */
  clusterTags: string[];
  healthyTargets: number | null;
}

export interface AwsResourceSnapshot {
  fetchedAt: Date;
  instances: AwsInstance[];
  volumes: AwsVolume[];
  loadBalancers: AwsLoadBalancer[];
}

// ---------------------------------------------------------------------------
// 단가
// ---------------------------------------------------------------------------

export interface PriceQuote {
  usd: number;
  fetchedAt: string;
  /** 만료된 캐시 값을 대신 씀 (Pricing API 실패) */
  cacheUsed: boolean;
}

export interface SpotQuote {
  usd: number;
  fetchedAt: string;
  zone: string;
}

export interface EbsPrice {
  storage: PriceQuote | null;
  iops: PriceQuote | null;
  throughput: PriceQuote | null;
}

/** 추정 계산에 쓰는 단가표 (동기 조회용으로 미리 모은 것) */
export interface PriceBook {
  onDemand: Record<string, PriceQuote | null>;
  /** 키 `${type}|${zone}`. null = 스팟 시세 조회 실패 */
  spot: Record<string, SpotQuote | null>;
  ebs: Record<string, EbsPrice>;
  lb: Partial<Record<LbType, PriceQuote | null>>;
  ipv4: PriceQuote | null;
  meta: {
    fetchedAt: string | null;
    cacheUsed: boolean;
    cacheFetchedAt: string | null;
    /** Pricing API 조회가 모두 실패(캐시도 없음) */
    allFailed: boolean;
    spotFetchedAt: string | null;
  };
}

export function spotKey(type: string, zone: string): string {
  return `${type}|${zone}`;
}

// ---------------------------------------------------------------------------
// 추정 결과 (GET /api/cost/estimate)
// ---------------------------------------------------------------------------

export interface Ec2Row {
  key: string;
  nodeName: string | null;
  instanceId: string | null;
  nodeGroup: string | null;
  instanceType: string | null;
  capacityType: 'on_demand' | 'spot';
  zone: string | null;
  architecture: string | null;
  priced: boolean;
  unitPrice: {
    usdPerHour: number;
    source: 'pricing_api' | 'spot_price_history' | 'on_demand_fallback';
    asOf: string;
    zone: string | null;
  } | null;
  spotFallback: boolean;
  usdPerHour: number | null;
  usdPerMonth: number | null;
  notes: Note[];
}

export interface EbsRow {
  key: string;
  volumeId: string;
  volumeType: string;
  sizeBytes: number;
  iops: number | null;
  throughputMibps: number | null;
  attachment: {
    type: 'pvc' | 'node_root' | 'other';
    namespace: string | null;
    name: string | null;
    nodeName: string | null;
  };
  priced: boolean;
  unitPrice: {
    usdPerGbMonth: number;
    usdPerIopsMonth: number | null;
    usdPerMibpsMonth: number | null;
    source: 'pricing_api';
    asOf: string;
  } | null;
  usdPerHour: number | null;
  usdPerMonth: number | null;
  notes: Note[];
}

export interface LbRow {
  key: string;
  name: string;
  lbType: LbType;
  attachedTo: K8sRef[];
  healthyTargets: number | null;
  priced: boolean;
  unitPrice: { usdPerHour: number; source: 'pricing_api'; asOf: string } | null;
  usdPerHour: number | null;
  usdPerMonth: number | null;
  notes: Note[];
}

export interface Ipv4Row {
  key: string;
  nodeName: string | null;
  count: number;
  priced: boolean;
  unitPrice: { usdPerHour: number; source: 'pricing_api'; asOf: string } | null;
  usdPerHour: number | null;
  usdPerMonth: number | null;
  notes: Note[];
}

/**
 * 컨트롤 플레인 내역 한 줄 (계약 3.1 `resources.controlPlane[]`).
 * 한 배열에 여러 종류가 섞이고 `kind`로 구분한다. 모양은 kind에 따라 ec2·ebs·lb·ipv4 행과 같다.
 */
export interface ControlPlaneRow {
  key: string;
  kind: ControlPlaneCostKind;
  priced: boolean;
  usdPerHour: number | null;
  usdPerMonth: number | null;
  notes: Note[];
  // master_ec2
  nodeName?: string | null;
  instanceId?: string | null;
  nodeGroup?: string | null;
  instanceType?: string | null;
  capacityType?: 'on_demand' | 'spot';
  zone?: string | null;
  architecture?: string | null;
  spotFallback?: boolean;
  // etcd_ebs · master_root_ebs
  volumeId?: string;
  volumeType?: string;
  sizeBytes?: number;
  iops?: number | null;
  throughputMibps?: number | null;
  /** main | events | null(확실히 알 수 없음 — 볼륨 태그 규칙 확인 필요) */
  etcdCluster?: 'main' | 'events' | null;
  // api_lb
  name?: string;
  lbType?: LbType;
  attachedTo?: K8sRef[];
  healthyTargets?: number | null;
  identification?: {
    confidence: 'assumed' | 'ambiguous';
    matchedBy: string[];
    candidateCount: number;
  };
  // master_ipv4
  count?: number;
  unitPrice?:
    Ec2Row['unitPrice'] | EbsRow['unitPrice'] | LbRow['unitPrice'] | null;
}

export interface CategoryRow {
  category: CostCategory;
  label: string;
  count: number;
  usdPerHour: number;
  usdPerMonth: number;
  sharePct: number;
  unpricedCount: number;
  /** controlPlane 카테고리에만 (하위 종류 분해, 순서 고정) */
  byKind?: {
    kind: ControlPlaneCostKind;
    label: string;
    count: number;
    usdPerHour: number;
    usdPerMonth: number;
    /** api_lb 행에만 true (추정임을 화면이 알 수 있게) */
    estimated?: boolean;
  }[];
  /** controlPlane 카테고리에만. 후보가 0개여도 **항상 있다** (AC-KOPS30) */
  apiLb?: {
    state: 'assumed' | 'ambiguous' | 'not_found';
    candidateCount: number;
    text: string;
  };
  notes?: Note[];
}

export interface Totals {
  usdPerHour: number;
  usdPerDay: number;
  usdPerMonth: number;
}

/** 소모율 기록의 resources 한 줄 (DBA 2.2) */
export interface SampleResource {
  kind: CostCategory;
  key: string;
  type: string | null;
  option: string | null;
  az: string | null;
  usdPerHour: number;
  /** 원인 문장용 보조 값 (볼륨 GiB, 노드그룹 등) */
  sizeGiB?: number | null;
  label?: string | null;
}

export interface EstimateComputation {
  total: Totals;
  categories: CategoryRow[];
  resources: {
    ec2: Ec2Row[];
    ebs: EbsRow[];
    lb: LbRow[];
    ipv4: Ipv4Row[];
    controlPlane: ControlPlaneRow[];
  };
  unpricedCount: number;
  spotFallbackCount: number;
  outOfCluster: {
    count: number;
    byCategory: Partial<Record<CostCategory, number>>;
  };
  sampleResources: SampleResource[];
  nodeCount: number;
}

export interface MonthEndEstimate {
  amount: Money;
  method: 'actual_plus_rate' | 'elapsed_rate';
  formula: string;
}

export interface EstimateView {
  available: boolean;
  unavailable: Unavailable | null;
  kind: 'estimated';
  asOf: string | null;
  resourcesFetchedAt: string | null;
  intervalSec: number;
  total: Totals | null;
  categories: CategoryRow[];
  resources: EstimateComputation['resources'];
  pricing: {
    source: 'pricing_api' | 'mock';
    fetchedAt: string | null;
    nextRefreshAt: string | null;
    cacheUsed: boolean;
    cacheFetchedAt: string | null;
  };
  spotPrice: {
    fetchedAt: string | null;
    cacheTtlSec: number;
    fallbackCount: number;
  };
  unpricedCount: number;
  outOfCluster: EstimateComputation['outOfCluster'];
  hoursPerMonth: number;
  monthEnd: MonthEndEstimate | null;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// 배분
// ---------------------------------------------------------------------------

export interface AllocationBreakdown {
  nodeUsdPerHour: number;
  storageUsdPerHour: number;
  lbUsdPerHour: number;
  controlPlaneUsdPerHour?: number;
  ipv4UsdPerHour?: number;
}

export interface AllocationRow {
  namespace: string;
  isSystem: boolean;
  usdPerHour: number;
  usdPerMonth: number;
  sharePct: number;
  breakdown: AllocationBreakdown;
  warnings: { code: string; text: string; count: number }[];
}

export interface PinnedRow {
  key: 'unallocated' | 'shared_cluster' | 'shared' | 'hidden_system';
  label: string;
  usdPerHour: number;
  usdPerMonth: number;
  sharePct: number;
  breakdown: AllocationBreakdown;
}

export interface AllocationComputation {
  rows: AllocationRow[];
  pinnedRows: PinnedRow[];
  total: { usdPerHour: number; usdPerMonth: number };
  unallocatedPct: number;
}

// ---------------------------------------------------------------------------
// 소모율 기록
// ---------------------------------------------------------------------------

export interface RateSample {
  sampledAt: Date;
  totalUsdPerHour: number;
}

export interface RateBaseline {
  state: 'collecting' | 'ready';
  collectedHours: number;
  requiredHours: number;
  medianUsdPerHour: number | null;
  warnAtUsdPerHour: number | null;
  critAtUsdPerHour: number | null;
}

export interface SpikeCause {
  change: 'added' | 'changed' | 'removed';
  category: CostCategory;
  key: string;
  text: string;
  deltaUsdPerHour: number;
}

// ---------------------------------------------------------------------------
// Cost Explorer (정규화된 결과)
// ---------------------------------------------------------------------------

/** GetCostAndUsage(DAILY, GroupBy SERVICE) 정규화 결과 */
export interface CeDailyResult {
  /** 조회 기간 (UTC, end는 미포함) */
  start: string;
  end: string;
  metric: string;
  /** 날짜별 서비스 금액 */
  days: { date: string; total: number; byService: Record<string, number> }[];
}

/** GetCostForecast(DAILY, 80%) 정규화 결과 */
export interface CeForecastResult {
  start: string;
  end: string;
  totalUsd: number;
  days: {
    date: string;
    mean: number;
    low: number | null;
    high: number | null;
  }[];
}

export interface CeEntry<T> {
  status: 'ok' | 'error';
  result: T | null;
  fetchedAt: Date;
  expiresAt: Date;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CeData {
  daily: CeEntry<CeDailyResult> | null;
  forecast: CeEntry<CeForecastResult> | null;
}

export interface RefreshView {
  state: 'idle' | 'refreshing';
  canRefresh: boolean;
  disabledReason:
    | null
    | 'cooldown'
    | 'daily_limit'
    | 'mock'
    | 'in_progress'
    | 'not_configured';
  lastFetchedAt: string | null;
  lastCallAt: string | null;
  lastManualAt: string | null;
  nextAvailableAt: string | null;
  nextScheduledAt: string | null;
  cacheTtlSec: number;
  cooldownSec: number;
  todayCalls: number;
  dailyLimit: number;
  limitReached: boolean;
  dayBoundary: 'UTC';
  dailyResetAt: string;
  callsPerRefresh: number;
  /** 새로고침 1회의 최대 호출 수 (GetCostAndUsage 최대 페이지 + GetCostForecast 1) */
  maxCallsPerRefresh: number;
  /** 새로고침 1회 최대 예상 비용 = maxCallsPerRefresh × callCostUsd (확인창 표시용, 화면 계산 없음) */
  refreshEstimatedCostUsd: number;
  callCostUsd: number;
  monthCalls: number;
  monthCallCost: Money;
  lastError: { code: string; message: string; at: string } | null;
}

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

export interface BudgetView {
  configured: boolean;
  status: StatusInfo | null;
  budgetUsd: number | null;
  monthToDatePct: number | null;
  projectedPct: number | null;
  projectedBasis: 'aws_forecast' | 'estimated_month_end' | null;
  monthElapsedPct: number | null;
  daysElapsed: number | null;
  daysInMonth: number | null;
  warnPct: number | null;
  overPct: number | null;
}

export interface SpikeRateDetail {
  status: Status;
  reasons: Reason[];
  baselineState: 'collecting' | 'ready';
  collectedHours: number;
  requiredHours: number;
  currentUsdPerHour: number | null;
  medianUsdPerHour: number | null;
  deltaUsdPerHour: number | null;
  deltaPct: number | null;
  warnAtUsdPerHour: number | null;
  critAtUsdPerHour: number | null;
  kind: 'estimated';
  asOf: string | null;
  causes: SpikeCause[];
  causesBaselineAt: string | null;
}

export interface SpikedService {
  service: string;
  displayName: string;
  status: Status;
  usd: number;
  baselineAvgUsd: number;
  deltaUsd: number;
  deltaPct: number | null;
}

export interface SpikeDailyDetail {
  status: Status;
  available: boolean;
  unavailable: Unavailable | null;
  reasons: Reason[];
  date: string | null;
  usd: number | null;
  baselineAvgUsd: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
  kind: 'actual';
  asOf: string | null;
  spikedServices: SpikedService[];
}
