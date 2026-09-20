import type { CeDailyResult, RateSample } from '../cost.types';
import {
  computeRateBaseline,
  computeSpikeCauses,
  estimateMonthEnd,
  evaluateBudget,
  evaluateDailySpike,
  evaluateRateSpike,
} from './cost-status';

const RATE = {
  baselineDays: 7,
  minBaselineHours: 24,
  warnRatio: 1.3,
  warnAbsUsdPerHour: 0.5,
  critRatio: 2.0,
  critAbsUsdPerHour: 1.0,
};
const DAILY = {
  baselineDays: 7,
  warnRatio: 1.3,
  warnAbsUsd: 5,
  critRatio: 2.0,
  critAbsUsd: 10,
  serviceWarnAbsUsd: 5,
};
const NOW = new Date('2026-09-19T05:05:00Z');

function flat(value: number, hours: number): RateSample[] {
  const out: RateSample[] = [];
  for (
    let t = NOW.getTime() - hours * 3600_000;
    t < NOW.getTime();
    t += 300_000
  )
    out.push({ sampledAt: new Date(t), totalUsdPerHour: value });
  return out;
}

describe('급증 A: 소모율 (명세 5절 수용 기준)', () => {
  const judge = (median: number, current: number) => {
    const b = computeRateBaseline(flat(median, 168), NOW, RATE);
    return evaluateRateSpike(current, b, 7);
  };

  it('중앙값 $0.60, 현재 $0.85 → 정상 (+42%지만 +$0.25 < $0.50)', () => {
    expect(judge(0.6, 0.85).status).toBe('ok');
  });

  it('중앙값 $0.60, 현재 $1.20 → 주의 (+100%지만 +$0.60 < $1.00)', () => {
    const r = judge(0.6, 1.2);
    expect(r.status).toBe('warning');
    expect(r.reasons[0].code).toBe('SPIKE_RATE_WARNING');
    expect(r.reasons[0].text).toBe('+100% (+$0.60/h) vs 7일 중앙값 $0.60/h');
  });

  it('중앙값 $1.00, 현재 $2.10 → 급증', () => {
    expect(judge(1.0, 2.1).status).toBe('critical');
  });

  it('임계값 = 배수와 절대액 중 큰 값', () => {
    const b = computeRateBaseline(flat(0.62, 168), NOW, RATE);
    expect(b.state).toBe('ready');
    expect(b.medianUsdPerHour).toBe(0.62);
    expect(b.warnAtUsdPerHour).toBe(1.12);
    expect(b.critAtUsdPerHour).toBe(1.62);
    expect(b.collectedHours).toBe(168);
  });

  it('기록 24시간 미만 → 기준 수집 중 (ok + SPIKE_BASELINE_COLLECTING)', () => {
    const b = computeRateBaseline(flat(0.6, 14), NOW, RATE);
    expect(b.state).toBe('collecting');
    expect(b.medianUsdPerHour).toBeNull();
    const r = evaluateRateSpike(5, b, 7);
    expect(r.status).toBe('ok');
    expect(r.reasons[0]).toEqual({
      code: 'SPIKE_BASELINE_COLLECTING',
      text: '기준 수집 중 (기록 14시간 / 24시간)',
      status: 'ok',
    });
  });

  it('7일보다 오래된 표본은 중앙값에 쓰지 않는다', () => {
    const old = flat(10, 24 * 10).filter(
      (s) => s.sampledAt.getTime() < NOW.getTime() - 8 * 86_400_000,
    );
    const b = computeRateBaseline([...old, ...flat(1, 48)], NOW, RATE);
    expect(b.medianUsdPerHour).toBe(1);
  });
});

describe('급증 원인', () => {
  it('노드 추가는 타입·구매 옵션별로 묶고, 바뀐·없어진 리소스를 |Δ| 큰 순으로', () => {
    const before = [
      {
        kind: 'ec2' as const,
        key: 'node:a',
        type: 'm6i.large',
        option: 'on_demand',
        az: 'a',
        usdPerHour: 0.096,
      },
      {
        kind: 'ebs' as const,
        key: 'vol:v1',
        type: 'gp3',
        option: 'pvc',
        az: null,
        usdPerHour: 0.00625,
        sizeGiB: 50,
      },
      {
        kind: 'lb' as const,
        key: 'lb:old',
        type: 'alb',
        option: null,
        az: null,
        usdPerHour: 0.0252,
      },
    ];
    const after = [
      before[0],
      { ...before[1], usdPerHour: 0.025, sizeGiB: 200 },
      ...[1, 2, 3].map((i) => ({
        kind: 'ec2' as const,
        key: `node:n${i}`,
        type: 'm6i.large',
        option: 'on_demand',
        az: 'a',
        usdPerHour: 0.096,
      })),
    ];
    const causes = computeSpikeCauses(after, before);
    expect(causes[0]).toMatchObject({
      change: 'added',
      category: 'ec2',
      text: 'EC2 노드 +3대 (m6i.large 온디맨드)',
    });
    expect(causes[0].deltaUsdPerHour).toBeCloseTo(0.288, 6);
    expect(causes.find((c) => c.change === 'removed')?.text).toBe(
      '로드밸런서 삭제 (ALB)',
    );
    expect(causes.find((c) => c.change === 'changed')?.text).toBe(
      'EBS gp3 50 GiB → 200 GiB',
    );
  });
});

describe('예산 (명세 3.5)', () => {
  const settings = { monthlyBudgetUsd: 800, warnPct: 90, overPct: 100 };

  it('예산 $800, 월말 예측 $745 → 주의 (≥ 90%)', () => {
    const r = evaluateBudget({
      settings,
      monthToDateUsd: 400,
      forecastMonthEndUsd: 745,
      estimatedMonthEndUsd: 700,
      now: NOW,
    });
    expect(r.status).toBe('warning');
    expect(r.projectedBasis).toBe('aws_forecast');
    expect(r.reasons[0]).toEqual({
      code: 'BUDGET_FORECAST_OVER_WARN',
      text: '월말 예측 $745 (예산 $800의 93%)',
      status: 'warning',
    });
  });

  it('확정 누적 ≥ 예산 → 초과(critical)', () => {
    const r = evaluateBudget({
      settings,
      monthToDateUsd: 812,
      forecastMonthEndUsd: 1200,
      estimatedMonthEndUsd: null,
      now: NOW,
    });
    expect(r.status).toBe('critical');
    expect(r.reasons[0].code).toBe('BUDGET_OVER');
    expect(r.reasons[0].text).toBe('확정 누적 $812 (예산 $800의 102%)');
  });

  it('월말 예측 < 90% → 정상 (이유 없음)', () => {
    const r = evaluateBudget({
      settings,
      monthToDateUsd: 300,
      forecastMonthEndUsd: 700,
      estimatedMonthEndUsd: null,
      now: NOW,
    });
    expect(r.status).toBe('ok');
    expect(r.reasons).toEqual([]);
    expect(r.projectedPct).toBe(87.5);
  });

  it('AWS 예측 없음 → 추정 월말로 판단하고 "추정 기준" 표시', () => {
    const r = evaluateBudget({
      settings,
      monthToDateUsd: 400,
      forecastMonthEndUsd: null,
      estimatedMonthEndUsd: 830,
      now: NOW,
    });
    expect(r.status).toBe('warning');
    expect(r.projectedBasis).toBe('estimated_month_end');
    expect(r.reasons[0].code).toBe('BUDGET_ESTIMATE_OVER_WARN');
    expect(r.reasons[0].text).toContain('추정 기준');
  });

  it('예산 미설정 → configured false, 판단 숨김', () => {
    const r = evaluateBudget({
      settings: { ...settings, monthlyBudgetUsd: null },
      monthToDateUsd: 1e6,
      forecastMonthEndUsd: 1e6,
      estimatedMonthEndUsd: null,
      now: NOW,
    });
    expect(r.configured).toBe(false);
    expect(r.status).toBe('ok');
    expect(r.budgetUsd).toBeNull();
  });

  it('예측·추정 모두 없음 → unknown', () => {
    const r = evaluateBudget({
      settings,
      monthToDateUsd: null,
      forecastMonthEndUsd: null,
      estimatedMonthEndUsd: null,
      now: NOW,
    });
    expect(r.status).toBe('unknown');
    expect(r.reasons[0].code).toBe('BUDGET_UNKNOWN');
  });

  it('누적이 경과율보다 10%p 이상 앞서면 보조 이유', () => {
    const r = evaluateBudget({
      settings,
      monthToDateUsd: 640,
      forecastMonthEndUsd: 900,
      estimatedMonthEndUsd: null,
      now: NOW,
    });
    expect(r.reasons.map((x) => x.code)).toContain('BUDGET_PACE_AHEAD');
  });

  it('추정 월말: CE 있으면 확정 누적 + 소모율 × (오늘 0시~월말), 없으면 월 전체 시간', () => {
    const a = estimateMonthEnd(1, 500, NOW);
    // 9/19 00:00 ~ 10/01 00:00 = 12일 = 288시간
    expect(a.amountUsd).toBe(788);
    expect(a.method).toBe('actual_plus_rate');
    const b = estimateMonthEnd(1, null, NOW);
    expect(b.amountUsd).toBe(720);
    expect(b.method).toBe('elapsed_rate');
  });
});

describe('급증 B: 일별 확정', () => {
  function daily(
    values: number[],
    lastDate: string,
    svc: Record<string, number> = {},
  ): CeDailyResult {
    const end = new Date(`${lastDate}T00:00:00Z`).getTime();
    return {
      start: '2026-08-01',
      end: '2026-09-19',
      metric: 'UnblendedCost',
      days: values.map((v, i) => {
        const date = new Date(end - (values.length - 1 - i) * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const isTarget = i === values.length - 2;
        return {
          date,
          total: v,
          byService: {
            EC2: v - (isTarget ? (svc.extra ?? 0) : 0),
            ...(isTarget && svc.extra ? { 'EC2 - Other': svc.extra } : {}),
          },
        };
      }),
    };
  }

  it('완전히 반영된 날(그저께) vs 그 전 7일 평균: 주의', () => {
    // 그저께 = 2026-09-17
    const r = evaluateDailySpike(
      daily([20, 20, 20, 20, 20, 20, 20, 31.2, 5], '2026-09-18'),
      NOW,
      DAILY,
    );
    expect(r.date).toBe('2026-09-17');
    expect(r.baselineAvgUsd).toBe(20);
    expect(r.status).toBe('warning');
    expect(r.reasons[0].text).toBe('9월 17일 $31.20 vs 7일 평균 $20.00 (+56%)');
  });

  it('×2 이상 & +$10 이상 → 급증', () => {
    const r = evaluateDailySpike(
      daily([15, 15, 15, 15, 15, 15, 15, 31, 1], '2026-09-18'),
      NOW,
      DAILY,
    );
    expect(r.status).toBe('critical');
  });

  it('상대 증가율만 크고 절대액이 작으면 정상', () => {
    const r = evaluateDailySpike(
      daily([2, 2, 2, 2, 2, 2, 2, 5, 1], '2026-09-18'),
      NOW,
      DAILY,
    );
    expect(r.status).toBe('ok');
  });

  it('서비스별 급증 목록', () => {
    const r = evaluateDailySpike(
      daily([20, 20, 20, 20, 20, 20, 20, 32, 1], '2026-09-18', { extra: 12 }),
      NOW,
      DAILY,
    );
    expect(r.spikedServices.map((s) => s.service)).toContain('EC2 - Other');
  });
});
