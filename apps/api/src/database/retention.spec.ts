import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import {
  closeInterruptedAdvisorRuns,
  computeRetentionCutoffs,
  DEFAULT_RETENTION,
  purgeExpiredData,
} from './retention';

describe('computeRetentionCutoffs', () => {
  it('기본 정책: 소모율 90일, 어드바이저 90일', () => {
    const now = new Date('2026-09-19T00:00:00Z');
    const c = computeRetentionCutoffs(now);
    expect(c.costRateSampleBefore.toISOString()).toBe(
      '2026-06-21T00:00:00.000Z',
    );
    expect(c.advisorRunBefore.toISOString()).toBe('2026-06-21T00:00:00.000Z');
    expect(DEFAULT_RETENTION.advisorRunMaxCount).toBe(50);
  });
});

/**
 * 통합 테스트: 마이그레이션이 적용된 빈 DB가 있을 때만 실행한다.
 *   DB_IT_URL=postgresql://... npx jest src/database/retention.spec.ts
 * (데이터를 지우므로 운영 DB에 쓰지 말 것)
 */
const itUrl = process.env.DB_IT_URL;
const describeIt = itUrl ? describe : describe.skip;

describeIt('purgeExpiredData (DB_IT_URL)', () => {
  let prisma: PrismaClient;
  const now = new Date('2026-09-19T00:00:00Z');
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: itUrl }),
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('보존 기간·건수 초과분만 지우고 실행 중인 분석은 남긴다', async () => {
    await prisma.advisorRun.deleteMany({});
    await prisma.costRateSample.deleteMany({});

    await prisma.costRateSample.createMany({
      data: [91, 89].map((d) => ({
        dataSource: 'mock' as const,
        sampledAt: daysAgo(d),
        totalUsdPerHour: 1.23,
        nodeCount: 3,
        resources: [],
      })),
    });

    const base = {
      dataSource: 'mock' as const,
      snapshotHash: 'a'.repeat(64),
      snapshotSummary: {},
      snapshot: {},
      snapshotBytes: 2,
      precheckResults: [],
      precheckSummary: {},
    };
    // 55건 (1~55일 전) + 100일 전 실행 중 1건
    for (let i = 1; i <= 55; i++) {
      await prisma.advisorRun.create({
        data: {
          ...base,
          status: 'succeeded',
          requestedAt: daysAgo(i),
          suggestions: {
            create: [
              {
                priority: 1,
                title: 't',
                category: 'cost',
                severity: 'low',
                targets: [],
                evidence: [],
                steps: [{ text: 's', code: null }],
                riskLevel: 'low',
                riskReason: 'r',
              },
            ],
          },
        },
      });
    }
    await prisma.advisorRun.create({
      data: {
        ...base,
        status: 'running',
        activeLock: 'active',
        requestedAt: daysAgo(100),
      },
    });

    const res = await purgeExpiredData(prisma, now);
    expect(res.costRateSamples).toBe(1);
    // 최신 50건 밖: 실행 중 1건이 최신순 정렬에서 가장 뒤라 overflow는 5건 + 실행 중(제외)
    expect(res.advisorRuns).toBe(5);
    expect(await prisma.advisorRun.count()).toBe(51);
    expect(await prisma.advisorSuggestion.count()).toBe(50);

    const closed = await closeInterruptedAdvisorRuns(prisma, now);
    expect(closed).toBe(1);
    const run = await prisma.advisorRun.findFirst({
      where: { failureReason: 'interrupted' },
    });
    expect(run?.activeLock).toBeNull();
    expect(run?.status).toBe('failed');

    // 잠금이 풀렸으니 다음 purge에서 90일 지난 그 실행도 지워진다
    const res2 = await purgeExpiredData(prisma, now);
    expect(res2.advisorRuns).toBe(1);
  });
});
