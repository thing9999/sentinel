import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import { AdvisorSettingsService, positiveOr } from './advisor-settings.service';

function service(
  env: Record<string, string>,
  rows: { key: string; value: unknown }[] | null,
) {
  const prisma = {
    isConnected: rows !== null,
    setting: { findMany: () => Promise.resolve(rows ?? []) },
  } as unknown as PrismaService;
  return new AdvisorSettingsService(new ConfigService(env), prisma);
}

describe('AdvisorSettingsService limits (PM 결정: maxTurns 5, 지연 300초)', () => {
  it('DB 없음: 기본값 5·300', async () => {
    const s = await service({}, null).get();
    expect(s.limits.maxTurns).toBe(5);
    expect(s.limits.slowAfterSec).toBe(300);
    expect(s.limits.timeoutSec).toBe(600);
    expect(s.limits.maxBudgetUsd).toBe(2);
  });

  it('settings 값을 그대로 따른다 (운영자가 넣은 3·180 포함)', async () => {
    const s = await service({}, [
      { key: 'advisor.limits', value: { maxTurns: 3, slowAfterSec: 180 } },
    ]).get();
    expect(s.limits.maxTurns).toBe(3);
    expect(s.limits.slowAfterSec).toBe(180);
  });

  it('운영자가 바꾼 값과 환경 변수는 따른다', async () => {
    const stored = await service({}, [
      { key: 'advisor.limits', value: { maxTurns: 4, slowAfterSec: 240 } },
    ]).get();
    expect(stored.limits).toMatchObject({ maxTurns: 4, slowAfterSec: 240 });
    const env = await service(
      { ADVISOR_SLOW_AFTER_SEC: '120', ADVISOR_MAX_TURNS: '2' },
      null,
    ).get();
    expect(env.limits).toMatchObject({ maxTurns: 2, slowAfterSec: 120 });
    // 우선순위: env > settings
    const both = await service({ ADVISOR_MAX_TURNS: '2' }, [
      { key: 'advisor.limits', value: { maxTurns: 4 } },
    ]).get();
    expect(both.limits.maxTurns).toBe(2);
  });

  it('positiveOr', () => {
    expect(positiveOr(undefined, 5)).toBe(5);
    expect(positiveOr(0, 5)).toBe(5);
    expect(positiveOr(3, 5)).toBe(3);
  });
});
