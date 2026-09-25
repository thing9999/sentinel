/**
 * 예산·급증 판단 (순수 함수). 명세 aws-cost 3.5·3.6·3.7, 계약 4절·8절.
 */
import { reason, type Reason, type Status } from '../../common/status';
import {
  addDays,
  daysInUtcMonth,
  koMonthDay,
  median,
  pct,
  r1,
  r2,
  r6,
  usd,
  usdPerHourText,
  utcDayStart,
  utcMonthStart,
  addUtcMonths,
  ymd,
} from '../cost-util';
import { CONTROL_PLANE_KIND_LABELS } from '../cost.types';
import type {
  CeDailyResult,
  RateBaseline,
  RateSample,
  SampleResource,
  SpikeCause,
  SpikedService,
} from '../cost.types';
import { serviceDisplayName } from '../explorer/service-names';

export interface RateSpikeSettings {
  baselineDays: number;
  minBaselineHours: number;
  /**
   * 기준선에 넣을 표본의 하한 시각(ISO8601 UTC). null이면 제한 없음(= 지금까지와 같은 동작).
   * 비용 정의가 바뀐 시점(EKS 관리 요금 → kOps 컨트롤 플레인 실비)을 넘겨
   * 옛 정의의 표본이 중앙값에 섞여 가짜 급증/급감이 나오는 것을 막는다 (DBA 결정 C).
   */
  baselineFrom?: string | null;
  warnRatio: number;
  warnAbsUsdPerHour: number;
  critRatio: number;
  critAbsUsdPerHour: number;
}

export interface DailySpikeSettings {
  baselineDays: number;
  warnRatio: number;
  warnAbsUsd: number;
  critRatio: number;
  critAbsUsd: number;
  serviceWarnAbsUsd: number;
}

export interface BudgetSettings {
  monthlyBudgetUsd: number | null;
  warnPct: number;
  overPct: number;
}

// ---------------------------------------------------------------------------
// A. 소모율 급증
// ---------------------------------------------------------------------------

/** 기준선 표본의 하한 시각 (baselineDays와 baselineFrom 중 **늦은** 쪽) */
export function baselineSince(now: Date, s: RateSpikeSettings): number {
  const byDays = now.getTime() - s.baselineDays * 86_400_000;
  const from = s.baselineFrom ? Date.parse(s.baselineFrom) : NaN;
  return Number.isFinite(from) ? Math.max(byDays, from) : byDays;
}

export function computeRateBaseline(
  samples: RateSample[],
  now: Date,
  s: RateSpikeSettings,
): RateBaseline {
  const since = baselineSince(now, s);
  const window = samples.filter(
    (x) =>
      x.sampledAt.getTime() >= since && x.sampledAt.getTime() <= now.getTime(),
  );
  const first = window.reduce<number | null>(
    (m, x) =>
      m === null || x.sampledAt.getTime() < m ? x.sampledAt.getTime() : m,
    null,
  );
  const collectedHours =
    first === null ? 0 : Math.floor((now.getTime() - first) / 3_600_000);
  const base: RateBaseline = {
    state: 'collecting',
    collectedHours,
    requiredHours: s.minBaselineHours,
    medianUsdPerHour: null,
    warnAtUsdPerHour: null,
    critAtUsdPerHour: null,
  };
  if (window.length === 0 || collectedHours < s.minBaselineHours) return base;
  const med = median(window.map((x) => x.totalUsdPerHour)) ?? 0;
  return {
    ...base,
    state: 'ready',
    medianUsdPerHour: r6(med),
    warnAtUsdPerHour: r6(
      Math.max(med * s.warnRatio, med + s.warnAbsUsdPerHour),
    ),
    critAtUsdPerHour: r6(
      Math.max(med * s.critRatio, med + s.critAbsUsdPerHour),
    ),
  };
}

export interface RateSpikeEvaluation {
  status: Status;
  reasons: Reason[];
  deltaUsdPerHour: number | null;
  deltaPct: number | null;
}

export function evaluateRateSpike(
  current: number | null,
  baseline: RateBaseline,
  baselineDays: number,
): RateSpikeEvaluation {
  if (baseline.state === 'collecting') {
    return {
      status: 'ok',
      reasons: [
        reason(
          'SPIKE_BASELINE_COLLECTING',
          `기준 수집 중 (기록 ${baseline.collectedHours}시간 / ${baseline.requiredHours}시간)`,
          'ok',
        ),
      ],
      deltaUsdPerHour: null,
      deltaPct: null,
    };
  }
  if (current === null || baseline.medianUsdPerHour === null) {
    return {
      status: 'unknown',
      reasons: [],
      deltaUsdPerHour: null,
      deltaPct: null,
    };
  }
  const med = baseline.medianUsdPerHour;
  const delta = current - med;
  const deltaPct = med > 0 ? r1((delta / med) * 100) : null;
  let status: Status = 'ok';
  if (
    baseline.critAtUsdPerHour !== null &&
    current >= baseline.critAtUsdPerHour
  )
    status = 'critical';
  else if (
    baseline.warnAtUsdPerHour !== null &&
    current >= baseline.warnAtUsdPerHour
  )
    status = 'warning';
  const reasons: Reason[] = [];
  if (status !== 'ok') {
    const pctText = deltaPct === null ? '' : `+${Math.round(deltaPct)}% `;
    reasons.push(
      reason(
        status === 'critical' ? 'SPIKE_RATE_CRITICAL' : 'SPIKE_RATE_WARNING',
        `${pctText}(+${usdPerHourText(delta).replace('/h', '')}/h) vs ${baselineDays}일 중앙값 ${usdPerHourText(med)}`,
        status,
      ),
    );
  }
  return { status, reasons, deltaUsdPerHour: r6(delta), deltaPct };
}

/** 기준 시점: 중앙값에 가장 가까운 표본 */
export function pickCausesBaseline<T extends RateSample>(
  samples: T[],
  medianUsd: number,
): T | null {
  let best: T | null = null;
  for (const s of samples) {
    if (
      best === null ||
      Math.abs(s.totalUsdPerHour - medianUsd) <
        Math.abs(best.totalUsdPerHour - medianUsd) ||
      (Math.abs(s.totalUsdPerHour - medianUsd) ===
        Math.abs(best.totalUsdPerHour - medianUsd) &&
        s.sampledAt > best.sampledAt)
    )
      best = s;
  }
  return best;
}

const OPTION_KO: Record<string, string> = {
  on_demand: '온디맨드',
  spot: '스팟',
};
const LB_KO: Record<string, string> = { alb: 'ALB', nlb: 'NLB', clb: 'CLB' };

/** 기준 시점 대비 새로 생긴·바뀐·없어진 리소스 (최대 10개, |Δ| 큰 순) */
export function computeSpikeCauses(
  current: SampleResource[],
  baseline: SampleResource[],
  limit = 10,
): SpikeCause[] {
  const before = new Map(baseline.map((r) => [r.key, r]));
  const after = new Map(current.map((r) => [r.key, r]));
  const causes: SpikeCause[] = [];

  // EC2 추가/삭제는 타입·구매 옵션별로 묶는다 ("EC2 노드 +3대 (m6i.large 온디맨드)")
  const ec2Groups = new Map<
    string,
    {
      change: 'added' | 'removed';
      keys: string[];
      delta: number;
      type: string;
      option: string;
    }
  >();
  const addGroup = (
    change: 'added' | 'removed',
    r: SampleResource,
    delta: number,
  ) => {
    const type = r.type ?? '?';
    const option = r.option ?? 'on_demand';
    const gk = `${change}|${type}|${option}`;
    const g = ec2Groups.get(gk) ?? { change, keys: [], delta: 0, type, option };
    g.keys.push(r.key);
    g.delta += delta;
    ec2Groups.set(gk, g);
  };

  for (const [key, r] of after) {
    const b = before.get(key);
    if (!b) {
      if (r.kind === 'ec2') addGroup('added', r, r.usdPerHour);
      else
        causes.push({
          change: 'added',
          category: r.kind,
          key,
          text: addedText(r),
          deltaUsdPerHour: r6(r.usdPerHour),
        });
      continue;
    }
    const delta = r.usdPerHour - b.usdPerHour;
    const changedShape =
      r.type !== b.type ||
      r.option !== b.option ||
      (r.sizeGiB ?? null) !== (b.sizeGiB ?? null);
    if (changedShape && Math.abs(delta) > 1e-6) {
      causes.push({
        change: 'changed',
        category: r.kind,
        key,
        text: changedText(b, r),
        deltaUsdPerHour: r6(delta),
      });
    }
  }
  for (const [key, b] of before) {
    if (after.has(key)) continue;
    if (b.kind === 'ec2') addGroup('removed', b, -b.usdPerHour);
    else
      causes.push({
        change: 'removed',
        category: b.kind,
        key,
        text: removedText(b),
        deltaUsdPerHour: r6(-b.usdPerHour),
      });
  }
  for (const g of ec2Groups.values()) {
    const n = g.keys.length;
    causes.push({
      change: g.change,
      category: 'ec2',
      key: g.keys[0],
      text: `EC2 노드 ${g.change === 'added' ? '+' : '-'}${n}대 (${g.type} ${OPTION_KO[g.option] ?? g.option})`,
      deltaUsdPerHour: r6(g.delta),
    });
  }
  return causes
    .sort((a, b) => Math.abs(b.deltaUsdPerHour) - Math.abs(a.deltaUsdPerHour))
    .slice(0, limit);
}

function addedText(r: SampleResource): string {
  switch (r.kind) {
    case 'ebs':
      return `EBS ${r.type ?? ''} ${r.sizeGiB ?? '?'} GiB 추가`.replace(
        /\s+/g,
        ' ',
      );
    case 'lb':
      return `로드밸런서 추가 (${LB_KO[r.type ?? ''] ?? r.type ?? '?'})`;
    case 'ipv4':
      return `퍼블릭 IPv4 +${r.type ?? '1'}개`;
    case 'controlPlane':
      return `${
        CONTROL_PLANE_KIND_LABELS[
          r.option as keyof typeof CONTROL_PLANE_KIND_LABELS
        ] ?? '컨트롤 플레인'
      } 추가`;
    default:
      return `${r.kind} 추가`;
  }
}

function removedText(r: SampleResource): string {
  switch (r.kind) {
    case 'ebs':
      return `EBS ${r.type ?? ''} ${r.sizeGiB ?? '?'} GiB 삭제`.replace(
        /\s+/g,
        ' ',
      );
    case 'lb':
      return `로드밸런서 삭제 (${LB_KO[r.type ?? ''] ?? r.type ?? '?'})`;
    case 'ipv4':
      return `퍼블릭 IPv4 -${r.type ?? '1'}개`;
    case 'controlPlane':
      return `${
        CONTROL_PLANE_KIND_LABELS[
          r.option as keyof typeof CONTROL_PLANE_KIND_LABELS
        ] ?? '컨트롤 플레인'
      } 삭제`;
    default:
      return `${r.kind} 삭제`;
  }
}

function changedText(b: SampleResource, a: SampleResource): string {
  switch (a.kind) {
    case 'ec2':
      if (a.type !== b.type)
        return `EC2 노드 인스턴스 타입 ${b.type ?? '?'} → ${a.type ?? '?'}`;
      return `EC2 노드 구매 옵션 ${OPTION_KO[b.option ?? ''] ?? b.option} → ${OPTION_KO[a.option ?? ''] ?? a.option}`;
    case 'ebs':
      if (a.type !== b.type)
        return `EBS ${b.type ?? '?'} → ${a.type ?? '?'} (${a.sizeGiB ?? '?'} GiB)`;
      return `EBS ${a.type ?? ''} ${b.sizeGiB ?? '?'} GiB → ${a.sizeGiB ?? '?'} GiB`;
    case 'lb':
      return `로드밸런서 종류 ${LB_KO[b.type ?? ''] ?? b.type} → ${LB_KO[a.type ?? ''] ?? a.type}`;
    case 'ipv4':
      return `퍼블릭 IPv4 ${b.type ?? '?'}개 → ${a.type ?? '?'}개`;
    case 'controlPlane': {
      const label =
        CONTROL_PLANE_KIND_LABELS[
          a.option as keyof typeof CONTROL_PLANE_KIND_LABELS
        ] ?? '컨트롤 플레인';
      if (a.type !== b.type)
        return `${label} ${b.type ?? '?'} → ${a.type ?? '?'}`;
      return `${label} ${b.sizeGiB ?? '?'} GiB → ${a.sizeGiB ?? '?'} GiB`;
    }
  }
}

// ---------------------------------------------------------------------------
// B. 일별 확정 비용 급증
// ---------------------------------------------------------------------------

export interface DailySpikeEvaluation {
  available: boolean;
  status: Status;
  reasons: Reason[];
  date: string | null;
  usd: number | null;
  baselineAvgUsd: number | null;
  deltaUsd: number | null;
  deltaPct: number | null;
  spikedServices: SpikedService[];
}

/** 완전히 반영된 최근 날: UTC 기준 그저께 */
export function settledDateFor(now: Date): string {
  return ymd(addDays(utcDayStart(now), -2));
}

function classify(
  value: number,
  avg: number,
  warnRatio: number,
  warnAbs: number,
  critRatio: number,
  critAbs: number,
): Status {
  const delta = value - avg;
  if (value >= avg * critRatio && delta >= critAbs) return 'critical';
  if (value >= avg * warnRatio && delta >= warnAbs) return 'warning';
  return 'ok';
}

export function evaluateDailySpike(
  data: CeDailyResult,
  now: Date,
  s: DailySpikeSettings,
): DailySpikeEvaluation {
  const settled = settledDateFor(now);
  const days = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const target = [...days].reverse().find((d) => d.date <= settled) ?? null;
  const empty: DailySpikeEvaluation = {
    available: false,
    status: 'unknown',
    reasons: [],
    date: null,
    usd: null,
    baselineAvgUsd: null,
    deltaUsd: null,
    deltaPct: null,
    spikedServices: [],
  };
  if (!target) return empty;
  const prev = days.filter((d) => d.date < target.date).slice(-s.baselineDays);
  if (prev.length === 0)
    return { ...empty, date: target.date, usd: r2(target.total) };
  const avg = prev.reduce((sum, d) => sum + d.total, 0) / prev.length;
  const delta = target.total - avg;
  const status = classify(
    target.total,
    avg,
    s.warnRatio,
    s.warnAbsUsd,
    s.critRatio,
    s.critAbsUsd,
  );

  const services = new Set<string>();
  for (const d of [target, ...prev])
    for (const k of Object.keys(d.byService)) services.add(k);
  const spiked: SpikedService[] = [];
  for (const svc of services) {
    const v = target.byService[svc] ?? 0;
    const a =
      prev.reduce((sum, d) => sum + (d.byService[svc] ?? 0), 0) / prev.length;
    const st = classify(
      v,
      a,
      s.warnRatio,
      s.serviceWarnAbsUsd,
      s.critRatio,
      s.critAbsUsd,
    );
    if (st === 'ok') continue;
    spiked.push({
      service: svc,
      displayName: serviceDisplayName(svc),
      status: st,
      usd: r2(v),
      baselineAvgUsd: r2(a),
      deltaUsd: r2(v - a),
      deltaPct: a > 0 ? r1(((v - a) / a) * 100) : null,
    });
  }
  spiked.sort((x, y) => y.deltaUsd - x.deltaUsd);

  const deltaPct = avg > 0 ? r1((delta / avg) * 100) : null;
  const reasons: Reason[] = [];
  if (status !== 'ok') {
    const pctText = deltaPct === null ? '' : ` (+${Math.round(deltaPct)}%)`;
    reasons.push(
      reason(
        status === 'critical' ? 'SPIKE_DAILY_CRITICAL' : 'SPIKE_DAILY_WARNING',
        `${koMonthDay(target.date)} ${usd(target.total)} vs ${s.baselineDays}일 평균 ${usd(avg)}${pctText}`,
        status,
      ),
    );
    if (spiked.length > 0) {
      const names = spiked
        .slice(0, 3)
        .map((x) => x.displayName)
        .join(', ');
      reasons.push(
        reason(
          'SPIKE_SERVICE',
          `급증한 서비스 ${spiked.length}개: ${names}`,
          spiked.some((x) => x.status === 'critical') ? 'critical' : 'warning',
        ),
      );
    }
  }
  return {
    available: true,
    status,
    reasons,
    date: target.date,
    usd: r2(target.total),
    baselineAvgUsd: r2(avg),
    deltaUsd: r2(delta),
    deltaPct,
    spikedServices: spiked,
  };
}

// ---------------------------------------------------------------------------
// 예산
// ---------------------------------------------------------------------------

export interface MonthProgress {
  monthElapsedPct: number;
  daysElapsed: number;
  daysInMonth: number;
  /** 이번 달 남은 시간 (지금부터 월말까지) */
  hoursRemaining: number;
  /** 오늘 0시(UTC)부터 월말까지 — 확정 누적(어제까지) + 추정에 씀 */
  hoursFromTodayStart: number;
  hoursInMonth: number;
}

export function monthProgress(now: Date): MonthProgress {
  const start = utcMonthStart(now);
  const end = addUtcMonths(now, 1);
  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();
  return {
    monthElapsedPct: r1((elapsed / total) * 100),
    daysElapsed: r2(elapsed / 86_400_000),
    daysInMonth: daysInUtcMonth(now),
    hoursRemaining: (end.getTime() - now.getTime()) / 3_600_000,
    hoursFromTodayStart:
      (end.getTime() - utcDayStart(now).getTime()) / 3_600_000,
    hoursInMonth: total / 3_600_000,
  };
}

export interface BudgetInput {
  settings: BudgetSettings;
  monthToDateUsd: number | null;
  forecastMonthEndUsd: number | null;
  estimatedMonthEndUsd: number | null;
  now: Date;
}

export interface BudgetEvaluation {
  configured: boolean;
  status: Status;
  reasons: Reason[];
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

/** 소수 1자리 퍼센트를 문장용 정수로 */
const pctInt = (p: number) => `${Math.round(p)}%`;

export function evaluateBudget(input: BudgetInput): BudgetEvaluation {
  const { settings: s, now } = input;
  const budget = s.monthlyBudgetUsd;
  if (budget === null || !(budget > 0)) {
    return {
      configured: false,
      status: 'ok',
      reasons: [],
      budgetUsd: null,
      monthToDatePct: null,
      projectedPct: null,
      projectedBasis: null,
      monthElapsedPct: null,
      daysElapsed: null,
      daysInMonth: null,
      warnPct: null,
      overPct: null,
    };
  }
  const mp = monthProgress(now);
  const mtdPct =
    input.monthToDateUsd === null ? null : pct(input.monthToDateUsd, budget);
  let projected: number | null = null;
  let basis: BudgetEvaluation['projectedBasis'] = null;
  if (input.forecastMonthEndUsd !== null) {
    projected = input.forecastMonthEndUsd;
    basis = 'aws_forecast';
  } else if (input.estimatedMonthEndUsd !== null) {
    projected = input.estimatedMonthEndUsd;
    basis = 'estimated_month_end';
  }
  const projectedPct = projected === null ? null : pct(projected, budget);

  const reasons: Reason[] = [];
  let status: Status = 'ok';
  if (
    input.monthToDateUsd !== null &&
    input.monthToDateUsd >= (budget * s.overPct) / 100
  ) {
    status = 'critical';
    reasons.push(
      reason(
        'BUDGET_OVER',
        `확정 누적 ${usd(input.monthToDateUsd)} (예산 ${usd(budget)}의 ${pctInt(mtdPct ?? 0)})`,
        'critical',
      ),
    );
  }
  if (projected !== null && projectedPct !== null) {
    if (projected >= (budget * s.warnPct) / 100) {
      if (status !== 'critical') status = 'warning';
      reasons.push(
        basis === 'aws_forecast'
          ? reason(
              'BUDGET_FORECAST_OVER_WARN',
              `월말 예측 ${usd(projected)} (예산 ${usd(budget)}의 ${pctInt(projectedPct)})`,
              'warning',
            )
          : reason(
              'BUDGET_ESTIMATE_OVER_WARN',
              `월말 추정 ≈ ${usd(projected)} (예산 ${usd(budget)}의 ${pctInt(projectedPct)}, 추정 기준)`,
              'warning',
            ),
      );
    }
  } else if (status === 'ok') {
    status = 'unknown';
    reasons.push(reason('BUDGET_UNKNOWN', '예측·추정 모두 없음', 'unknown'));
  }
  if (
    (status === 'warning' || status === 'critical') &&
    mtdPct !== null &&
    mtdPct - mp.monthElapsedPct >= 10
  ) {
    reasons.push(
      reason(
        'BUDGET_PACE_AHEAD',
        `누적 ${pctInt(mtdPct)}가 이번 달 경과 ${pctInt(mp.monthElapsedPct)}보다 앞섬`,
        status,
      ),
    );
  }
  return {
    configured: true,
    status,
    reasons,
    budgetUsd: budget,
    monthToDatePct: mtdPct,
    projectedPct,
    projectedBasis: basis,
    monthElapsedPct: mp.monthElapsedPct,
    daysElapsed: mp.daysElapsed,
    daysInMonth: mp.daysInMonth,
    warnPct: s.warnPct,
    overPct: s.overPct,
  };
}

/** 추정 월말 (명세 3.1): CE 있으면 확정 누적 + 소모율 × 남은 시간, 없으면 월 전체 시간 × 소모율 */
export function estimateMonthEnd(
  ratePerHour: number,
  monthToDateUsd: number | null,
  now: Date,
): {
  amountUsd: number;
  method: 'actual_plus_rate' | 'elapsed_rate';
  formula: string;
} {
  const mp = monthProgress(now);
  if (monthToDateUsd !== null) {
    const hours = mp.hoursFromTodayStart;
    return {
      amountUsd: r6(monthToDateUsd + ratePerHour * hours),
      method: 'actual_plus_rate',
      formula: `확정 누적 ${usd(monthToDateUsd)} + 추정 ${usdPerHourText(ratePerHour)} × 남은 ${Math.round(hours)}시간`,
    };
  }
  return {
    amountUsd: r6(ratePerHour * mp.hoursInMonth),
    method: 'elapsed_rate',
    formula: `추정 ${usdPerHourText(ratePerHour)} × 이번 달 ${Math.round(mp.hoursInMonth)}시간 (확정 비용 없음)`,
  };
}
