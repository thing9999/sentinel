/**
 * Cost Explorer 결과 정규화·화면용 요약 (순수 함수). 계약 aws-cost 5.1.
 */
import {
  addDays,
  addUtcMonths,
  daysInUtcMonth,
  parseYmd,
  r1,
  r2,
  utcDayStart,
  utcMonthStart,
  ymd,
} from '../cost-util';
import type {
  CeDailyResult,
  CeForecastResult,
  Unavailable,
} from '../cost.types';
import type { DailySpikeEvaluation } from '../status/cost-status';
import { settledDateFor } from '../status/cost-status';
import { serviceDisplayName } from './service-names';

export { serviceDisplayName };

/** GetCostAndUsage 한 페이지를 정리한 값 (게이트웨이가 만든다) */
export interface CauPage {
  days: { date: string; groups: { service: string; amount: number }[] }[];
  nextPageToken: string | null;
}

/** 여러 페이지를 날짜별로 합친다 (페이지가 그룹 중간에서 잘릴 수 있음) */
export function mergeCauPages(
  pages: CauPage[],
  meta: { start: string; end: string; metric: string },
): CeDailyResult {
  const byDate = new Map<string, Record<string, number>>();
  for (const p of pages) {
    for (const d of p.days) {
      const rec = byDate.get(d.date) ?? {};
      for (const g of d.groups) {
        rec[g.service] = (rec[g.service] ?? 0) + g.amount;
      }
      byDate.set(d.date, rec);
    }
  }
  const days = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, byService]) => {
      const clean: Record<string, number> = {};
      let total = 0;
      for (const [k, v] of Object.entries(byService)) {
        if (Math.abs(v) < 1e-9) continue;
        clean[k] = v;
        total += v;
      }
      return { date, total, byService: clean };
    });
  return { ...meta, days };
}

// ---------------------------------------------------------------------------
// 화면용 요약
// ---------------------------------------------------------------------------

export interface ActualSummary {
  settledThrough: string;
  month: { start: string; end: string; daysInMonth: number };
  monthToDate: {
    amountUsd: number;
    lastMonthSamePeriodUsd: number;
    changeUsd: number;
    changePct: number | null;
  };
  lastMonthTotalUsd: number | null;
  services: {
    top: {
      service: string;
      displayName: string;
      mtdUsd: number;
      lastMonthSamePeriodUsd: number;
      deltaUsd: number;
      deltaPct: number | null;
      sharePct: number;
      spikeStatus: 'warning' | 'critical' | null;
    }[];
    other: {
      serviceCount: number;
      mtdUsd: number;
      lastMonthSamePeriodUsd: number;
      deltaUsd: number;
      deltaPct: number | null;
      sharePct: number;
    } | null;
    totalUsd: number;
  };
  daily: {
    days: number;
    chartTopServices: string[];
    items: {
      date: string;
      totalUsd: number;
      unsettled: boolean;
      spikeStatus: 'warning' | 'critical' | null;
      byService: { service: string; usd: number }[];
    }[];
    baselineAvgUsd: number | null;
  };
  monthCumulative: { date: string; usd: number }[];
}

const deltaPctOf = (cur: number, prev: number): number | null =>
  prev > 0 ? r1(((cur - prev) / prev) * 100) : null;

export function summarizeActual(
  data: CeDailyResult,
  now: Date,
  spike: DailySpikeEvaluation | null,
): ActualSummary {
  const today = utcDayStart(now);
  const monthStart = utcMonthStart(now);
  const lastMonthStart = addUtcMonths(now, -1);
  const monthStartYmd = ymd(monthStart);
  const lastMonthStartYmd = ymd(lastMonthStart);
  const todayYmd = ymd(today);
  const settledThrough = settledDateFor(now);

  const days = data.days.filter((d) => d.date < todayYmd);
  const thisMonth = days.filter((d) => d.date >= monthStartYmd);
  const lastMonth = days.filter(
    (d) => d.date >= lastMonthStartYmd && d.date < monthStartYmd,
  );
  // 지난달 같은 기간: 이번 달에 반영된 마지막 날짜의 "일"까지
  const lastDayOfMonthCovered = thisMonth.length
    ? parseYmd(thisMonth[thisMonth.length - 1].date).getUTCDate()
    : 0;
  const lastMonthSame = lastMonth.filter(
    (d) => parseYmd(d.date).getUTCDate() <= lastDayOfMonthCovered,
  );

  const sum = (list: typeof days) => list.reduce((s, d) => s + d.total, 0);
  const mtd = sum(thisMonth);
  const lmSame = sum(lastMonthSame);

  // 서비스별
  const svcMtd = new Map<string, number>();
  const svcLm = new Map<string, number>();
  for (const d of thisMonth)
    for (const [k, v] of Object.entries(d.byService))
      svcMtd.set(k, (svcMtd.get(k) ?? 0) + v);
  for (const d of lastMonthSame)
    for (const [k, v] of Object.entries(d.byService))
      svcLm.set(k, (svcLm.get(k) ?? 0) + v);
  const spikeBySvc = new Map(
    (spike?.spikedServices ?? []).map((s) => [s.service, s.status]),
  );
  const allSvcs = [...new Set([...svcMtd.keys(), ...svcLm.keys()])].sort(
    (a, b) => (svcMtd.get(b) ?? 0) - (svcMtd.get(a) ?? 0),
  );
  const share = (v: number) => (mtd > 0 ? r1((v / mtd) * 100) : 0);
  const topSvcs = allSvcs.slice(0, 10);
  const rest = allSvcs.slice(10);
  const top = topSvcs.map((svc) => {
    const m = svcMtd.get(svc) ?? 0;
    const l = svcLm.get(svc) ?? 0;
    const st = spikeBySvc.get(svc);
    return {
      service: svc,
      displayName: serviceDisplayName(svc),
      mtdUsd: r2(m),
      lastMonthSamePeriodUsd: r2(l),
      deltaUsd: r2(m - l),
      deltaPct: deltaPctOf(m, l),
      sharePct: share(m),
      spikeStatus: st === 'warning' || st === 'critical' ? st : null,
    };
  });
  let other: ActualSummary['services']['other'] = null;
  if (rest.length > 0) {
    const m = rest.reduce((s, k) => s + (svcMtd.get(k) ?? 0), 0);
    const l = rest.reduce((s, k) => s + (svcLm.get(k) ?? 0), 0);
    other = {
      serviceCount: rest.length,
      mtdUsd: r2(m),
      lastMonthSamePeriodUsd: r2(l),
      deltaUsd: r2(m - l),
      deltaPct: deltaPctOf(m, l),
      sharePct: share(m),
    };
  }

  // 일별 최근 30일
  const from = ymd(addDays(today, -30));
  const recent = days.filter((d) => d.date >= from);
  const svc30 = new Map<string, number>();
  for (const d of recent)
    for (const [k, v] of Object.entries(d.byService))
      svc30.set(k, (svc30.get(k) ?? 0) + v);
  const chartTop = [...svc30.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([k]) => k);
  const spikeDaySt =
    spike && spike.status !== 'ok' && spike.status !== 'unknown'
      ? spike.status
      : null;
  const items = recent.map((d) => {
    const byService = chartTop
      .filter((k) => (d.byService[k] ?? 0) !== 0)
      .map((k) => ({ service: k, usd: r2(d.byService[k] ?? 0) }));
    const otherUsd = Object.entries(d.byService)
      .filter(([k]) => !chartTop.includes(k))
      .reduce((s, [, v]) => s + v, 0);
    if (Math.abs(otherUsd) >= 0.005)
      byService.push({ service: '_other', usd: r2(otherUsd) });
    return {
      date: d.date,
      totalUsd: r2(d.total),
      unsettled: d.date > settledThrough,
      spikeStatus: spikeDaySt && spike?.date === d.date ? spikeDaySt : null,
      byService,
    };
  });

  let run = 0;
  const monthCumulative = thisMonth.map((d) => {
    run += d.total;
    return { date: d.date, usd: r2(run) };
  });

  const monthEnd = addDays(addUtcMonths(now, 1), -1);
  return {
    settledThrough,
    month: {
      start: monthStartYmd,
      end: ymd(monthEnd),
      daysInMonth: daysInUtcMonth(now),
    },
    monthToDate: {
      amountUsd: r2(mtd),
      lastMonthSamePeriodUsd: r2(lmSame),
      changeUsd: r2(mtd - lmSame),
      changePct: deltaPctOf(mtd, lmSame),
    },
    lastMonthTotalUsd: lastMonth.length > 0 ? r2(sum(lastMonth)) : null,
    services: { top, other, totalUsd: r2(mtd) },
    daily: {
      days: items.length,
      chartTopServices: chartTop,
      items,
      baselineAvgUsd: spike?.baselineAvgUsd ?? null,
    },
    monthCumulative,
  };
}

export interface ForecastSummary {
  available: boolean;
  unavailable: Unavailable | null;
  period: { start: string; end: string } | null;
  remainingUsd: number | null;
  monthEndUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
  confidencePct: number;
  cumulative: {
    date: string;
    usd: number;
    lowUsd: number | null;
    highUsd: number | null;
  }[];
}

export function summarizeForecast(
  f: CeForecastResult,
  monthToDateUsd: number,
): ForecastSummary {
  const days = [...f.days].sort((a, b) => a.date.localeCompare(b.date));
  const hasBounds =
    days.length > 0 && days.every((d) => d.low !== null && d.high !== null);
  let mean = monthToDateUsd;
  let low = monthToDateUsd;
  let high = monthToDateUsd;
  const cumulative = days.map((d) => {
    mean += d.mean;
    low += d.low ?? 0;
    high += d.high ?? 0;
    return {
      date: d.date,
      usd: r2(mean),
      lowUsd: hasBounds ? r2(low) : null,
      highUsd: hasBounds ? r2(high) : null,
    };
  });
  const remaining = f.totalUsd;
  return {
    available: true,
    unavailable: null,
    period: { start: f.start, end: ymd(addDays(parseYmd(f.end), -1)) },
    remainingUsd: r2(remaining),
    monthEndUsd: r2(monthToDateUsd + remaining),
    lowUsd: hasBounds ? r2(low) : null,
    highUsd: hasBounds ? r2(high) : null,
    confidencePct: 80,
    cumulative,
  };
}
