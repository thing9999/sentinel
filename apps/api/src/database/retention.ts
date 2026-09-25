/**
 * 대시보드 자체 DB 보존 정책 정리 (docs/db/schema.md 3절).
 * backend가 하루 1회(예: 매일 04:00) 또는 API 시작 시 `purgeExpiredData`를 호출한다.
 * 모두 인덱스를 타는 범위 삭제이며, 실행 중인 어드바이저 실행(active_lock 있음)은 지우지 않는다.
 */
import type { PrismaClient } from './generated/prisma/client';
import { SETTING_DEFAULTS } from './settings-defaults';

/**
 * 보존 정책. `SETTING_DEFAULTS.retention.value`는 `as const`라 리터럴 타입(예: `2000`)이 되므로,
 * 호출자가 일부 값만 바꿔 넘길 수 있도록 number로 넓힌다(값은 전부 일(日)·건수·바이트 수).
 */
export type RetentionPolicy = {
  -readonly [
    K in keyof (typeof SETTING_DEFAULTS)['retention']['value']
  ]: number;
};

export const DEFAULT_RETENTION: RetentionPolicy =
  SETTING_DEFAULTS.retention.value;

const DAY_MS = 86_400_000;

export interface RetentionCutoffs {
  costRateSampleBefore: Date;
  costExplorerCacheFetchedBefore: Date;
  costExplorerCallLogBefore: Date;
  priceCacheExpiredBefore: Date;
  advisorRunBefore: Date;
  alertBefore: Date;
}

/** 순수 함수: 기준 시각에서 각 테이블의 삭제 기준 시각을 계산 */
export function computeRetentionCutoffs(
  now: Date,
  policy: RetentionPolicy = DEFAULT_RETENTION,
): RetentionCutoffs {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    costRateSampleBefore: ago(policy.costRateSampleDays),
    costExplorerCacheFetchedBefore: ago(policy.costExplorerCacheDays),
    costExplorerCallLogBefore: ago(policy.costExplorerCallLogDays),
    priceCacheExpiredBefore: ago(policy.priceCacheExpiredGraceDays),
    advisorRunBefore: ago(policy.advisorRunDays),
    alertBefore: ago(policy.alertDays),
  };
}

export interface PurgeResult {
  costRateSamples: number;
  costExplorerCache: number;
  costExplorerCallLogs: number;
  priceCache: number;
  advisorRuns: number;
  alerts: number;
}

/** 보존 기간이 지난 데이터를 지운다. 어드바이저는 "최근 N건 또는 N일" 중 먼저 닿는 쪽. */
export async function purgeExpiredData(
  prisma: PrismaClient,
  now: Date = new Date(),
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<PurgeResult> {
  const c = computeRetentionCutoffs(now, policy);

  const costRateSamples = await prisma.costRateSample.deleteMany({
    where: { sampledAt: { lt: c.costRateSampleBefore } },
  });
  const costExplorerCache = await prisma.costExplorerCache.deleteMany({
    where: { fetchedAt: { lt: c.costExplorerCacheFetchedBefore } },
  });
  const costExplorerCallLogs = await prisma.costExplorerCallLog.deleteMany({
    where: { calledAt: { lt: c.costExplorerCallLogBefore } },
  });
  const priceCache = await prisma.priceCache.deleteMany({
    where: { expiresAt: { lt: c.priceCacheExpiredBefore } },
  });

  // 어드바이저: 최신 N건 밖이거나 N일 지난 것 (실행 중 제외). 제안은 CASCADE로 함께 삭제.
  const overflow = await prisma.advisorRun.findMany({
    select: { id: true },
    orderBy: { requestedAt: 'desc' },
    skip: policy.advisorRunMaxCount,
  });
  const advisorRuns = await prisma.advisorRun.deleteMany({
    where: {
      activeLock: null,
      OR: [
        { requestedAt: { lt: c.advisorRunBefore } },
        { id: { in: overflow.map((r) => r.id) } },
      ],
    },
  });

  const alerts = await purgeAlerts(prisma, now, policy);

  return {
    costRateSamples: costRateSamples.count,
    costExplorerCache: costExplorerCache.count,
    costExplorerCallLogs: costExplorerCallLogs.count,
    priceCache: priceCache.count,
    advisorRuns: advisorRuns.count,
    alerts,
  };
}

/** 진행 중(닫히지 않은) 알림을 만드는 종류. 이 알림은 보관 기간이 지나도 지우지 않는다. */
const OPENABLE_ALERT_KINDS = ['transition', 'escalation', 'flapping'] as const;

/**
 * 알림 이력 정리 (alerts 3.7 "보관 기간", AC-ALERT18).
 *
 * - 90일(`alertDays`) 또는 **data_source별** 2,000건(`alertMaxRows`) 중 먼저 닿는 쪽.
 *   mock 알림이 live 이력을 밀어내지 않도록 건수 상한은 data_source마다 따로 센다.
 * - **`closed_at IS NULL`(진행 중)인 알림은 어느 기준으로도 지우지 않는다.** 지우면 나중에 오는
 *   해제 알림이 짝을 잃는다. (종결형 kind는 만들 때 closed_at을 채우므로 여기 걸리지 않는다)
 * - 발송 기록은 FK CASCADE로 함께 사라지고, 해제↔발생 연결은 SET NULL로 끊긴다(행은 남는다).
 *
 * **화면이 멎지 않게**: 한 번에 `alertPurgeBatchSize`(기본 500)행씩 나눠 지우고, 트랜잭션으로
 * 묶지 않는다. Postgres에서 읽기는 쓰기에 막히지 않으므로(MVCC) 배지·목록 질의는 정리 중에도
 * 그대로 응답한다. `TRUNCATE`는 ACCESS EXCLUSIVE 잠금이라 **쓰지 않는다**. `VACUUM FULL`도 없다.
 */
export async function purgeAlerts(
  prisma: PrismaClient,
  now: Date = new Date(),
  policy: RetentionPolicy = DEFAULT_RETENTION,
): Promise<number> {
  const before = computeRetentionCutoffs(now, policy).alertBefore;
  const batchSize = Math.max(1, policy.alertPurgeBatchSize);
  /** 진행 중이 아닌 것만 (= 닫힌 알림). kind 조건은 closed_at을 빠뜨린 행까지 잡는 안전장치 */
  const closed = {
    OR: [
      { closedAt: { not: null } },
      { kind: { notIn: [...OPENABLE_ALERT_KINDS] } },
    ],
  };

  // 한 번 호출에서 도는 배치 수 상한 (무한 루프 방지. 남은 것은 다음 주기에 지운다)
  const maxBatches = 200;
  let deleted = 0;

  const deleteBatch = async (ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const res = await prisma.alert.deleteMany({ where: { id: { in: ids } } });
    return res.count;
  };

  // 1) 기간 초과 (인덱스 범위: occurred_at)
  for (let i = 0; i < maxBatches; i += 1) {
    const batch = await prisma.alert.findMany({
      select: { id: true },
      where: { occurredAt: { lt: before }, ...closed },
      take: batchSize,
    });
    const count = await deleteBatch(batch.map((r) => r.id));
    deleted += count;
    if (count === 0) break;
  }

  // 2) 건수 초과 — data_source별로 최신 alertMaxRows건을 남기고 그 뒤를 지운다.
  //    (mock 알림이 live 이력을 밀어내지 않게 따로 센다)
  //    순위는 진행 중 알림까지 포함해서 매기고(= 실제 보관 건수가 상한에 맞는다), 그 중
  //    **닫힌 것만** 지운다. 진행 중 알림은 창에 남아 다음 회차에도 그대로 보존된다.
  for (const dataSource of ['mock', 'live'] as const) {
    for (let i = 0; i < maxBatches; i += 1) {
      const overflow = await prisma.alert.findMany({
        select: { id: true },
        where: { dataSource },
        orderBy: { occurredAt: 'desc' },
        skip: policy.alertMaxRows,
        take: batchSize,
      });
      if (overflow.length === 0) break;
      const res = await prisma.alert.deleteMany({
        where: { id: { in: overflow.map((r) => r.id) }, ...closed },
      });
      deleted += res.count;
      // 창이 통째로 "진행 중"이면 더 지울 것이 없다고 본다(진행 중 알림은 키 수만큼뿐이라
      // batchSize를 채울 수 없다). 남은 것이 있어도 다음 주기에 지워진다.
      if (res.count === 0) break;
    }
  }

  return deleted;
}

/**
 * API 시작 시 호출: 이전 프로세스에서 끝나지 못한 어드바이저 실행을 실패(interrupted)로 닫고 잠금을 푼다.
 * (분석은 API 프로세스 메모리에서 진행되므로 재시작하면 이어갈 수 없다)
 */
export async function closeInterruptedAdvisorRuns(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.advisorRun.updateMany({
    where: { activeLock: { not: null } },
    data: {
      status: 'failed',
      failureReason: 'interrupted',
      errorMessage: 'API가 재시작되어 분석이 중단되었습니다.',
      activeLock: null,
      finishedAt: now,
    },
  });
  return res.count;
}
