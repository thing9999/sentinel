/**
 * 대시보드 자체 DB 보존 정책 정리 (docs/db/schema.md 3절).
 * backend가 하루 1회(예: 매일 04:00) 또는 API 시작 시 `purgeExpiredData`를 호출한다.
 * 모두 인덱스를 타는 범위 삭제이며, 실행 중인 어드바이저 실행(active_lock 있음)은 지우지 않는다.
 */
import type { PrismaClient } from './generated/prisma/client';
import { SETTING_DEFAULTS } from './settings-defaults';

export type RetentionPolicy = (typeof SETTING_DEFAULTS)['retention']['value'];

export const DEFAULT_RETENTION: RetentionPolicy =
  SETTING_DEFAULTS.retention.value;

const DAY_MS = 86_400_000;

export interface RetentionCutoffs {
  costRateSampleBefore: Date;
  costExplorerCacheFetchedBefore: Date;
  costExplorerCallLogBefore: Date;
  priceCacheExpiredBefore: Date;
  advisorRunBefore: Date;
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
  };
}

export interface PurgeResult {
  costRateSamples: number;
  costExplorerCache: number;
  costExplorerCallLogs: number;
  priceCache: number;
  advisorRuns: number;
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

  return {
    costRateSamples: costRateSamples.count,
    costExplorerCache: costExplorerCache.count,
    costExplorerCallLogs: costExplorerCallLogs.count,
    priceCache: priceCache.count,
    advisorRuns: advisorRuns.count,
  };
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
