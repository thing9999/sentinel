/**
 * 대시보드 설정 기본값 (settings 테이블의 key별 값 모양).
 *
 * - 시드(`prisma/seed.ts`)가 이 값을 넣는다. 이미 있는 key는 덮어쓰지 않는다.
 * - 적용 우선순위(권장): 환경 변수(명시된 경우) > settings 테이블 > 이 파일의 기본값.
 *   예: COST_MONTHLY_BUDGET_USD가 있으면 cost.budget.monthlyBudgetUsd보다 우선.
 * - 값은 명세 기본값과 같다: docs/specs/cluster-status.md, aws-cost.md, architecture-advisor.md
 * - 설명: docs/db/schema.md "settings key 목록"
 */
import { DEFAULT_PG_THRESHOLDS } from './health/postgres/normalize';

export const SETTING_DEFAULTS = {
  'cluster.thresholds': {
    description: '클러스터 상태 판단 기준 (cluster-status 3.2~3.7)',
    value: {
      sustainSamples: 3,
      nodeNotReadyCritSec: 60,
      nodeCpuWarnPct: 70,
      nodeCpuCritPct: 90,
      nodeMemoryWarnPct: 75,
      nodeMemoryCritPct: 90,
      nodeRequestsWarnPct: 85,
      nodePodsWarnPct: 90,
      nodePodsCritPct: 100,
      podPendingWarnSec: 120,
      podPendingCritSec: 600,
      podNotReadyWarnSec: 120,
      podUnknownCritSec: 120,
      podRestartsWarn1h: 1,
      podRestartsCrit1h: 3,
      podMemoryLimitWarnPct: 80,
      podMemoryLimitCritPct: 95,
      podTerminatingWarnSec: 300,
      eventWindowSec: 900,
      pvcPendingWarnSec: 120,
      pvcUsageWarnPct: 75,
      pvcUsageCritPct: 90,
    },
  },
  'db.thresholds': {
    description:
      '모니터링 대상 DB 판단 기준 (cluster-status 3.7, docs/db/health.md)',
    value: { ...DEFAULT_PG_THRESHOLDS },
  },
  'cost.budget': {
    description:
      '월 예산 (USD). null이면 예산 표시·판단을 숨긴다. 환경 변수 COST_MONTHLY_BUDGET_USD가 우선',
    value: {
      monthlyBudgetUsd: null as number | null,
      warnPct: 90,
      overPct: 100,
    },
  },
  'cost.spike': {
    description: '비용 급증 기준 (aws-cost 3.6)',
    value: {
      rate: {
        baselineDays: 7,
        minBaselineHours: 24,
        warnRatio: 1.3,
        warnAbsUsdPerHour: 0.5,
        critRatio: 2.0,
        critAbsUsdPerHour: 1.0,
      },
      daily: {
        baselineDays: 7,
        warnRatio: 1.3,
        warnAbsUsd: 5,
        critRatio: 2.0,
        critAbsUsd: 10,
        serviceWarnAbsUsd: 5,
      },
    },
  },
  'cost.explorer': {
    description: 'Cost Explorer 캐시·호출 제한 (aws-cost 4절)',
    value: {
      metric: 'UnblendedCost' as 'UnblendedCost' | 'AmortizedCost',
      cacheTtlSec: 21600,
      manualRefreshCooldownSec: 3600,
      dailyCallLimit: 40,
      callCostUsd: 0.01,
      costAllocationTagFilter: null as { key: string; values: string[] } | null,
    },
  },
  'cost.estimation': {
    description: '실시간 추정 주기·캐시 (aws-cost 4절)',
    value: {
      resourceRefreshSec: 300,
      rateSampleIntervalSec: 300,
      pricingCacheTtlSec: 86400,
      spotPriceCacheTtlSec: 3600,
      hoursPerMonth: 730,
    },
  },
  'advisor.limits': {
    description:
      '어드바이저 시간 제한·스냅샷 크기·비용 상한 (architecture-advisor 0절, 3.3, API 계약 B.5)',
    value: {
      /** 지연 표시 기준(초). PM 결정 2026-09-19: 180 → 300 */
      slowAfterSec: 300,
      timeoutSec: 600,
      bridgeHealthIntervalSec: 30,
      bridgeHealthTimeoutSec: 3,
      maxWorkloads: 300,
      maxNodes: 100,
      staleResultDays: 7,
      /** 한 번 분석의 비용 상한(USD, SDK maxBudgetUsd). 초과 → failure_reason budget_exceeded */
      maxBudgetUsd: 2.0,
      /** SDK maxTurns (구조화 출력 재시도 여유). PM 결정 2026-09-19: 3 → 5 (브리지 상한 5) */
      maxTurns: 5,
    },
  },
  'advisor.prechecks': {
    description: '규칙 기반 사전 점검 기준 (architecture-advisor 3.2)',
    value: {
      restarts24h: 5,
      overRequestCpuPct: 20,
      nodeIdleRequestsPct: 30,
      unallocatedPct: 40,
      minObservationMin: 60,
      dbConnectionUsagePct: 70,
      dbXidAge: 500_000_000,
      dbPvcUsageWarnPct: 75,
      dbPvcUsageCritPct: 90,
    },
  },
  retention: {
    description: '데이터 보존 기간 (docs/db/schema.md 3절)',
    value: {
      costRateSampleDays: 90,
      costExplorerCacheDays: 35,
      costExplorerCallLogDays: 90,
      priceCacheExpiredGraceDays: 7,
      advisorRunDays: 90,
      advisorRunMaxCount: 50,
      advisorRawResponseMaxBytes: 262_144,
    },
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> =
  (typeof SETTING_DEFAULTS)[K]['value'];

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

/**
 * 저장된 값(부분)을 기본값 위에 얕게 덮어쓴다. 저장값이 객체가 아니면 기본값을 쓴다.
 * (중첩 객체는 key 단위로 통째로 교체된다 — cost.spike.rate 등)
 */
export function mergeSetting<K extends SettingKey>(
  key: K,
  stored: unknown,
): SettingValue<K> {
  const base = SETTING_DEFAULTS[key].value;
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return base;
  }
  return { ...base, ...(stored as Partial<SettingValue<K>>) };
}
