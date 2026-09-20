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

export type CostCategory = 'ec2' | 'ebs' | 'lb' | 'ipv4' | 'eks';
export const COST_CATEGORIES: readonly CostCategory[] = [
  'ec2',
  'ebs',
  'lb',
  'ipv4',
  'eks',
];
export const CATEGORY_LABELS: Record<CostCategory, string> = {
  ec2: 'EC2 노드',
  ebs: 'EBS',
  lb: '로드밸런서',
  ipv4: '퍼블릭 IPv4',
  eks: 'EKS 컨트롤 플레인',
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
  /** 태그 eks:nodegroup-name / karpenter.sh/nodepool 등 (없으면 null) */
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

export interface AwsEksCluster {
  name: string;
  version: string | null;
}

export interface AwsResourceSnapshot {
  fetchedAt: Date;
  instances: AwsInstance[];
  volumes: AwsVolume[];
  loadBalancers: AwsLoadBalancer[];
  eks: AwsEksCluster | null;
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
  eks: { standard: PriceQuote | null; extended: PriceQuote | null };
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

export interface EksRow {
  key: string;
  clusterName: string;
  version: string | null;
  supportTier: 'standard' | 'extended';
  priced: boolean;
  unitPrice: { usdPerHour: number; source: 'pricing_api'; asOf: string } | null;
  usdPerHour: number | null;
  usdPerMonth: number | null;
  notes: Note[];
}

export interface CategoryRow {
  category: CostCategory;
  label: string;
  count: number;
  usdPerHour: number;
  usdPerMonth: number;
  sharePct: number;
  unpricedCount: number;
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
    eks: EksRow[];
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
  eksUsdPerHour?: number;
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
