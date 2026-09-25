/**
 * docs/api/aws-cost.md 타입. 계약에 있는 필드만 둔다.
 * 금액은 서버 값 그대로 쓰고 화면에서 더하거나 계산하지 않는다.
 */
import type { ControlPlaneCostKind, CostCategory } from "@/components/ui";

import type { ApiStatusValue, DataSource, IsoTime, Money, MoneyKind, Reason, ResourceRef, StatusInfo } from "../common/types";

/**
 * 2026-09-24 kops-support: 카테고리 `eks` → **`controlPlane`**.
 * 라벨·순서는 퍼블리셔가 관리하는 `@/components/ui`의 `COST_CATEGORY_*`·`CONTROL_PLANE_KIND_*` 한 곳만 쓴다.
 */
export type { ControlPlaneCostKind, CostCategory };

export interface Unavailable {
  code: string;
  message: string;
}

export interface SpikeRateSummary {
  status: ApiStatusValue;
  baselineState: "collecting" | "ready";
  collectedHours: number;
  requiredHours: number;
  currentUsdPerHour: number | null;
  medianUsdPerHour: number | null;
  deltaUsdPerHour: number | null;
  deltaPct: number | null;
}

export interface SpikeDailySummary {
  status: ApiStatusValue;
  available: boolean;
  date: string | null;
  usd: number | null;
  baselineAvgUsd: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
}

export interface BudgetBlock {
  configured: boolean;
  status: StatusInfo | null;
  budgetUsd: number | null;
  monthToDatePct: number | null;
  projectedPct: number | null;
  projectedBasis: "aws_forecast" | "estimated_month_end" | null;
  monthElapsedPct: number | null;
  daysElapsed: number | null;
  daysInMonth: number | null;
  warnPct: number | null;
  overPct: number | null;
}

export interface MonthEndEstimated {
  amount: Money | null;
  method: "actual_plus_rate" | "elapsed_rate";
  formula: string | null;
}

export interface CostSummary {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  status: StatusInfo;
  rate: {
    available: boolean;
    unavailable: Unavailable | null;
    hourly: Money | null;
    daily: Money | null;
    monthly: Money | null;
    warnings: { unpricedCount: number; spotFallbackCount: number; outOfClusterCount: number; priceCacheUsed: boolean } | null;
  };
  monthToDate: {
    available: boolean;
    unavailable: Unavailable | null;
    amount: Money | null;
    settledThrough: string | null;
    lastMonthSamePeriod: Money | null;
    changePct: number | null;
    scope: "account" | "tag_filter" | null;
    metric: string | null;
  };
  monthEnd: {
    forecast: {
      available: boolean;
      unavailable: Unavailable | null;
      amount: Money | null;
      low: Money | null;
      high: Money | null;
      confidencePct: number | null;
    };
    /** 계약은 객체지만 구현은 추정할 수 없을 때 null (docs/reports/aws-cost/backend.md 4단계 8절) */
    estimated: MonthEndEstimated | null;
  };
  budget: BudgetBlock;
  spike: {
    status: StatusInfo;
    rate: SpikeRateSummary;
    daily: SpikeDailySummary;
  };
}

export interface UnitPrice {
  usdPerHour?: number | null;
  usdPerGbMonth?: number | null;
  usdPerIopsMonth?: number | null;
  usdPerMibpsMonth?: number | null;
  source: "pricing_api" | "spot_price_history" | "on_demand_fallback";
  asOf: IsoTime;
  zone?: string | null;
}

export interface ResourceNote {
  code: string;
  text: string;
}

interface ResourceBase {
  key: string;
  priced: boolean;
  unitPrice: UnitPrice | null;
  usdPerHour: number | null;
  usdPerMonth: number | null;
  notes: ResourceNote[];
}

export interface Ec2Resource extends ResourceBase {
  nodeName: string;
  instanceId: string | null;
  nodeGroup: string | null;
  instanceType: string | null;
  capacityType: "on_demand" | "spot" | null;
  zone: string | null;
  architecture: string | null;
  spotFallback: boolean;
}

export interface EbsResource extends ResourceBase {
  volumeId: string;
  volumeType: string;
  sizeBytes: number;
  iops: number | null;
  throughputMibps: number | null;
  attachment: { type: "pvc" | "node_root" | "other"; namespace?: string | null; name?: string | null; nodeName?: string | null } | null;
}

export interface LbResource extends ResourceBase {
  name: string;
  lbType: "alb" | "nlb" | "clb";
  attachedTo: ResourceRef[];
  healthyTargets: number | null;
}

export interface Ipv4Resource extends ResourceBase {
  nodeName: string;
  count: number;
}

/**
 * `resources.controlPlane[]` (계약 3.1). **한 배열에 여러 종류가 섞여 있고 `kind`로 구분한다.**
 * 행 모양은 `kind`에 따라 ec2·ebs·lb·ipv4 행과 같으므로 선택 필드로 둔다.
 */
export interface ControlPlaneResource extends ResourceBase {
  kind: ControlPlaneCostKind;
  /** master_ec2 · etcd_ebs · master_root_ebs · master_ipv4 */
  nodeName?: string;
  /** master_ec2 */
  instanceId?: string | null;
  nodeGroup?: string | null;
  instanceType?: string | null;
  capacityType?: "on_demand" | "spot" | null;
  zone?: string | null;
  architecture?: string | null;
  spotFallback?: boolean;
  /** etcd_ebs · master_root_ebs */
  volumeId?: string;
  volumeType?: string;
  sizeBytes?: number;
  iops?: number | null;
  throughputMibps?: number | null;
  /** `main` | `events` | null (확실하지 않으면 null — 화면은 "etcd 볼륨"으로만 적는다) */
  etcdCluster?: "main" | "events" | null;
  /** api_lb */
  name?: string;
  lbType?: "alb" | "nlb" | "clb";
  attachedTo?: ResourceRef[];
  healthyTargets?: number | null;
  identification?: { confidence: "assumed" | "ambiguous"; matchedBy: string[]; candidateCount: number };
  /** master_ipv4 */
  count?: number;
}

/** `controlPlane` 카테고리에만 있는 API 서버 LB 식별 결과. **후보 0개여도 항상 있다**(AC-KOPS30) */
export interface ApiLbInfo {
  state: "assumed" | "ambiguous" | "not_found";
  candidateCount: number;
  /** 화면에 그대로 찍는 서버 문장 */
  text: string;
}

export interface CategoryRow {
  category: CostCategory;
  label: string;
  count: number;
  usdPerHour: number;
  usdPerMonth: number;
  sharePct: number;
  unpricedCount: number;
  /** `controlPlane` 카테고리에만. 순서 고정(ControlPlaneCostKind) */
  byKind?: { kind: ControlPlaneCostKind; label: string; count: number; usdPerHour: number; usdPerMonth: number; estimated?: boolean }[];
  /** `controlPlane` 카테고리에만 */
  apiLb?: ApiLbInfo;
  notes?: ResourceNote[];
}

export interface CostEstimate {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  available: boolean;
  unavailable: Unavailable | null;
  kind: MoneyKind;
  asOf: IsoTime | null;
  resourcesFetchedAt: IsoTime | null;
  intervalSec: number;
  total: { usdPerHour: number; usdPerDay: number; usdPerMonth: number } | null;
  categories: CategoryRow[];
  resources: {
    ec2: Ec2Resource[];
    ebs: EbsResource[];
    lb: LbResource[];
    ipv4: Ipv4Resource[];
    controlPlane: ControlPlaneResource[];
  };
  pricing: {
    source: string;
    fetchedAt: IsoTime | null;
    nextRefreshAt: IsoTime | null;
    cacheUsed: boolean;
    cacheFetchedAt: IsoTime | null;
  } | null;
  spotPrice: { fetchedAt: IsoTime | null; cacheTtlSec: number; fallbackCount: number } | null;
  unpricedCount: number;
  outOfCluster: { count: number; byCategory: Partial<Record<CostCategory, number>> } | null;
  hoursPerMonth: number;
  monthEnd: MonthEndEstimated | null;
  /** 계약 3.1: awsResources 출처 stale (mock 은 항상 false) */
  stale: boolean;
}

export interface AllocationBreakdown {
  nodeUsdPerHour: number;
  storageUsdPerHour: number;
  lbUsdPerHour: number;
  /** 2026-09-24 kops-support: 구 `eksUsdPerHour`. 마스터 EC2·etcd 볼륨·API LB·마스터 IPv4 (aws-cost.md 3.2) */
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

export interface AllocationPinnedRow {
  key: "unallocated" | "shared_cluster" | "shared" | "hidden_system" | string;
  label: string;
  usdPerHour: number;
  usdPerMonth: number;
  sharePct: number;
  breakdown: AllocationBreakdown;
}

export interface CostAllocation {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  available: boolean;
  unavailable: Unavailable | null;
  kind: MoneyKind;
  asOf: IsoTime | null;
  rows: AllocationRow[];
  pinnedRows: AllocationPinnedRow[];
  hiddenSystem: AllocationPinnedRow | null;
  total: { usdPerHour: number; usdPerMonth: number } | null;
  unallocatedPct: number | null;
  unallocatedWarnPct?: number;
  rulesVersion: number;
}

export interface RatePoint {
  t: IsoTime;
  usdPerHour: number;
  status: ApiStatusValue;
}

export interface RateBaseline {
  state: "collecting" | "ready";
  collectedHours: number;
  requiredHours: number;
  medianUsdPerHour: number | null;
  warnAtUsdPerHour: number | null;
  critAtUsdPerHour: number | null;
}

export type RateRange = "24h" | "7d" | "30d" | "90d";

export interface RateSeries {
  dataSource: DataSource;
  generatedAt: IsoTime;
  kind: MoneyKind;
  asOf: IsoTime | null;
  range: RateRange;
  stepSec: number;
  points: RatePoint[];
  baseline: RateBaseline;
  retentionDays: number;
  persistence?: "memory";
}

export interface SpikeCause {
  change: "added" | "changed" | "removed";
  category: CostCategory;
  key: string;
  text: string;
  deltaUsdPerHour: number;
}

export interface CostStatus {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  status: StatusInfo;
  budget: BudgetBlock;
  spike: {
    status: StatusInfo;
    rate: SpikeRateSummary & {
      reasons: Reason[];
      warnAtUsdPerHour: number | null;
      critAtUsdPerHour: number | null;
      kind: MoneyKind;
      asOf: IsoTime | null;
      causes: SpikeCause[];
      causesBaselineAt: IsoTime | null;
    };
    daily: SpikeDailySummary & {
      unavailable: Unavailable | null;
      reasons: Reason[];
      kind: MoneyKind;
      asOf: IsoTime | null;
      spikedServices: {
        service: string;
        displayName: string;
        status: ApiStatusValue;
        usd: number;
        baselineAvgUsd: number;
        deltaUsd: number;
        deltaPct: number;
      }[];
    };
  };
  thresholds: unknown;
}

export interface CeRefresh {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  state: "idle" | "refreshing";
  canRefresh: boolean;
  disabledReason: null | "cooldown" | "daily_limit" | "mock" | "in_progress" | "not_configured";
  lastFetchedAt: IsoTime | null;
  lastCallAt: IsoTime | null;
  lastManualAt: IsoTime | null;
  nextAvailableAt: IsoTime | null;
  nextScheduledAt: IsoTime | null;
  cacheTtlSec: number;
  cooldownSec: number;
  todayCalls: number;
  dailyLimit: number;
  limitReached: boolean;
  dayBoundary: string;
  dailyResetAt: IsoTime | null;
  callsPerRefresh: number;
  /** 새로고침 1회 최대 호출 수 (계약 5.2) */
  maxCallsPerRefresh: number;
  /** 새로고침 1회 최대 예상 비용 USD. 확인창에 그대로 표시 (null 이면 호출당 단가로 대체, 디자인 2.7) */
  refreshEstimatedCostUsd: number | null;
  callCostUsd: number;
  monthCalls: number;
  monthCallCost: Money | null;
  lastError: { code: string; message: string; at: IsoTime } | null;
}

export interface ServiceRow {
  service: string;
  displayName: string;
  mtdUsd: number;
  lastMonthSamePeriodUsd: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
  sharePct: number;
  spikeStatus: ApiStatusValue | null;
}

export interface DailyItem {
  date: string;
  totalUsd: number;
  unsettled: boolean;
  spikeStatus: ApiStatusValue | null;
  byService: { service: string; usd: number }[];
}

export interface CostActual {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  available: boolean;
  unavailable: Unavailable | null;
  kind: MoneyKind;
  asOf: IsoTime | null;
  metric: string | null;
  scope: "account" | "tag_filter" | null;
  tagFilter: { key: string; values: string[] } | null;
  settledThrough: string | null;
  delayNotice: string | null;
  month: { start: string; end: string; daysInMonth: number } | null;
  monthToDate: { amountUsd: number; lastMonthSamePeriodUsd: number | null; changeUsd: number | null; changePct: number | null } | null;
  lastMonthTotalUsd: number | null;
  services: {
    top: ServiceRow[];
    other: Omit<ServiceRow, "service" | "displayName" | "spikeStatus"> & { serviceCount: number };
    totalUsd: number;
  } | null;
  daily: { days: number; chartTopServices: string[]; items: DailyItem[]; baselineAvgUsd: number | null } | null;
  forecast: {
    available: boolean;
    unavailable: Unavailable | null;
    kind: MoneyKind;
    asOf: IsoTime | null;
    period: { start: string; end: string } | null;
    remainingUsd: number | null;
    monthEndUsd: number | null;
    lowUsd: number | null;
    highUsd: number | null;
    confidencePct: number | null;
    cumulative: { date: string; usd: number; lowUsd: number; highUsd: number }[];
  } | null;
  monthCumulative: { date: string; usd: number }[];
  refresh: CeRefresh | null;
  /** 계약 5.1: 항상 포함. 캐시 만료 후 새 조회 실패 → true + 실패 메시지 */
  stale: boolean;
  staleReason: string | null;
}

/** cost.snapshot payload (7절) */
export interface CostSnapshot {
  summary: CostSummary;
  estimate: CostEstimate;
  allocation: CostAllocation;
  actual: CostActual;
  status: CostStatus;
  refresh: CeRefresh;
}
