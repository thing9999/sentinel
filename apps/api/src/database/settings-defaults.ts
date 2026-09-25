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
        // 기준선에 넣을 표본의 하한 시각(ISO8601 UTC). null이면 제한 없음(baselineDays 전체).
        // 비용 정의가 바뀐 시점(예: EKS 관리 요금 -> kOps 컨트롤 플레인 실비, 마이그레이션
        // 20260924120000_control_plane_cost_column)을 넘겨 옛 정의의 표본이 중앙값에 섞이지
        // 않게 한다. 전환 직후에는 기준선이 "수집 중"이 되고 minBaselineHours 뒤에 다시 판단한다.
        baselineFrom: null as string | null,
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
  alerts: {
    description:
      '알림 전이·억제·플래핑·워밍업 기준 (alerts 3.2). 화면에서 편집하지 않는다 — SQL/API로만',
    value: {
      /** 억제 창(분). 같은 키의 사건을 이 창 안에서는 기존 알림에 합친다 (3.2.2) */
      dedupeWindowMin: 15,
      /** 영향 객체가 새로 늘면 등급이 같아도 사건으로 친다 (3.2.2) */
      notifyOnNewTarget: true,
      /** 플래핑 창(분)과 전이 횟수 기준 (3.2.3) */
      flapWindowMin: 30,
      flapTransitions: 4,
      /** recent_transitions에 남길 최대 항목 수 (창 밖은 잘라낸다) */
      flapTransitionsMax: 50,
      /** 시작 후 알림을 만들지 않는 구간(초). 끝나면 요약 1건 (3.2.5) */
      warmupSec: 120,
      /** unknown이 이만큼 이어져야 "확인 불가" 알림을 만든다 (3.2.4) */
      unknownAfterMin: 5,
      /** kube 출처가 이만큼 stale이면 출처 억제에 들어간다 (3.2.4) */
      sourceSuppressAfterMin: 3,
      /** heartbeat 갱신 주기(초). 재시작 후 "정지 구간" 계산 (3.2.5) */
      heartbeatIntervalSec: 60,
      /** 대시보드 DB가 없을 때 메모리에 두는 알림 수 (3.7) */
      memoryFallbackMax: 200,
      /** 주기적 재알림(분). null = 끔. P3 (3.2.2, PM 결정 Q7) */
      repeatEveryMin: null as number | null,
      /** alert_key_states.last_notified_targets 상한 */
      lastNotifiedTargetsMax: 200,
    },
  },
  'alerts.discord': {
    description:
      '디스코드 발송 설정 (alerts 3.3.2·3.4.2). 웹훅 주소는 여기에 없다 — 별도 key alerts.discord.webhookUrl',
    value: {
      /** 끄면 디스코드로 보내지 않는다. 화면 알림 센터에는 계속 쌓인다 */
      enabled: true,
      /** 보낼 심각도 하한: critical = "장애만", warning = "주의부터" */
      minSeverity: 'critical' as 'critical' | 'warning',
      /** 확인 불가(unknown)는 심각도 순서와 별개 축이다 (3.2.4) */
      sendUnknown: true,
      /** 발송 속도 상한(초에 1건) */
      minIntervalSec: 2,
      /** 실패 재시도: 5초 → 30초 → 120초 후 포기 */
      backoffSec: [5, 30, 120] as readonly number[],
      /** 연속 실패가 이 수를 넘으면 발송을 failureCooldownMin 동안 멈춘다 */
      failureCircuitCount: 10,
      failureCooldownMin: 60,
      /** 테스트 발송 쿨다운(초) (3.5) */
      testCooldownSec: 60,
      /** 허용 호스트. 그 밖의 URL은 저장 단계에서 거부한다 (PM 결정 Q9, SSRF 방지) */
      allowedHosts: ['discord.com', 'discordapp.com'] as readonly string[],
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
      /** 알림 이력: 90일 또는 data_source별 2,000건 중 먼저 닿는 쪽 (PM 결정 Q12) */
      alertDays: 90,
      alertMaxRows: 2_000,
      /** 한 번에 지우는 행 수. 화면이 멎지 않게 잘게 나눈다 (docs/db/schema.md 3절) */
      alertPurgeBatchSize: 500,
    },
  },
} as const;

/**
 * **비밀값 설정 key** — 이 목록의 key는 `SETTING_DEFAULTS`에 **일부러 넣지 않았다.**
 * 그래서 `SettingsService.get()/peek()`으로는 타입 단계에서 읽을 수 없고, 읽기·쓰기는
 * `src/database/secret-settings.ts`의 전용 함수로만 한다 (docs/db/schema.md 2.12).
 * 설정을 목록으로 응답할 일이 생기면 반드시 `isSecretSettingKey()`로 걸러 낸다.
 */
export const SECRET_SETTING_KEYS = ['alerts.discord.webhookUrl'] as const;

export type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];

/** 이 key의 값은 어떤 API 응답·로그·SSE에도 실어서는 안 된다. */
export function isSecretSettingKey(key: string): key is SecretSettingKey {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key);
}

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
