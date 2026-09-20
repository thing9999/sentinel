/**
 * 차트 공통 순수 함수 (docs/design/status.md 4절). 값 계산이 아니라 그리기용 변환만 한다.
 */
import { formatBytes, formatCount, formatMillicores, formatMoney, formatPercent } from "@/components/ui";

export type ChartUnit = "percent" | "millicore" | "bytes" | "usdPerHour" | "usd" | "count";
export type ChartRange = "1h" | "6h" | "24h" | "7d" | "30d" | "90d";

/** 4.1 크기·여백 */
export const CHART_HEIGHT = { sparkline: 32, sm: 160, md: 240, lg: 280, xl: 320 } as const;
export const CHART_MARGIN = { top: 12, right: 56, bottom: 28, left: 56 } as const;
export type ChartHeightKey = keyof typeof CHART_HEIGHT;

export const RANGE_MS: Record<ChartRange, number> = {
  "1h": 3600_000,
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 86400_000,
  "30d": 30 * 86400_000,
  "90d": 90 * 86400_000,
};

/**
 * 절대값 축 최대: 최대값 × 1.1 을 올림한 보기 좋은 수(1·2·2.5·5 × 10ⁿ). 0 이하면 1.
 */
export function niceMax(max: number): number {
  const target = max * 1.1;
  if (!Number.isFinite(target) || target <= 0) return 1;
  const exp = Math.floor(Math.log10(target));
  const base = Math.pow(10, exp);
  for (const m of [1, 2, 2.5, 5, 10]) {
    const v = m * base;
    if (v >= target - 1e-12) return Number(v.toPrecision(12));
  }
  return 10 * base;
}

/** Y축 눈금 (0 ~ max, 4~5개) */
export function yTicks(max: number, count = 4): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

export interface XY {
  t: number;
  v: number | null;
}

/**
 * 결측 구간 끊기 (4.2): 값이 null 이거나 이웃 표본 간격이 수집 주기 × 2 를 넘으면 선을 끊는다(보간 금지).
 * 결과는 이어 그릴 구간들의 목록.
 */
export function splitSegments(points: readonly XY[], stepMs: number): { t: number; v: number }[][] {
  const out: { t: number; v: number }[][] = [];
  let cur: { t: number; v: number }[] = [];
  let prevT: number | null = null;
  for (const p of points) {
    if (p.v === null || !Number.isFinite(p.v)) {
      if (cur.length) out.push(cur);
      cur = [];
      prevT = p.t;
      continue;
    }
    if (prevT !== null && cur.length && stepMs > 0 && p.t - prevT > stepMs * 2) {
      out.push(cur);
      cur = [];
    }
    cur.push({ t: p.t, v: p.v });
    prevT = p.t;
  }
  if (cur.length) out.push(cur);
  return out;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** X축 눈금 간격 (4.3) */
export function tickIntervalMs(range: ChartRange): number {
  switch (range) {
    case "1h":
      return 10 * 60_000;
    case "6h":
      return 3600_000;
    case "24h":
      return 3 * 3600_000;
    case "7d":
      return 86400_000;
    default:
      return 7 * 86400_000;
  }
}

/** 로컬 시각 기준으로 간격에 맞춘 눈금 */
export function timeTicks(start: number, end: number, range: ChartRange): number[] {
  const interval = tickIntervalMs(range);
  const ticks: number[] = [];
  const d = new Date(start);
  if (interval >= 86400_000) {
    d.setHours(0, 0, 0, 0);
  } else if (interval >= 3600_000) {
    d.setMinutes(0, 0, 0);
    const hStep = interval / 3600_000;
    d.setHours(Math.floor(d.getHours() / hStep) * hStep);
  } else {
    const mStep = interval / 60_000;
    d.setSeconds(0, 0);
    d.setMinutes(Math.floor(d.getMinutes() / mStep) * mStep);
  }
  let t = d.getTime();
  while (t < start) t += interval;
  // 일 단위 간격은 DST 에 흔들리지 않게 날짜로 더한다
  let guard = 0;
  while (t <= end && guard++ < 200) {
    ticks.push(t);
    if (interval >= 86400_000) {
      const n = new Date(t);
      n.setDate(n.getDate() + interval / 86400_000);
      t = n.getTime();
    } else {
      t += interval;
    }
  }
  return ticks;
}

/** X축 눈금 라벨 (4.3): 1h `HH:mm`, 24h `HH:mm`(자정은 `9/19`), 7일 이상 `9/19` */
export function formatTick(t: number, range: ChartRange): string {
  const d = new Date(t);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (range === "7d" || range === "30d" || range === "90d") return md;
  if (range !== "1h" && d.getHours() === 0 && d.getMinutes() === 0) return md;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** 툴팁 머리글 (4.5): 1h·24h `14:02:15`, 7일 이상 `9월 17일 (수) 14:00` */
export function formatTooltipTime(t: number, range: ChartRange): string {
  const d = new Date(t);
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  if (range === "1h" || range === "6h" || range === "24h") return hms;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAY[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 날짜(YYYY-MM-DD, UTC 날짜)를 `9월 17일 (수)` 로 */
export function formatDayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  return `${dt.getUTCMonth() + 1}월 ${dt.getUTCDate()}일 (${WEEKDAY[dt.getUTCDay()]})`;
}

/** 눈금·툴팁 값 표기 (4.6) */
export function formatUnitValue(v: number, unit: ChartUnit, forTooltip = false): string {
  switch (unit) {
    case "percent":
      return forTooltip ? formatPercent(v / 100, { digits: 1 }) : formatPercent(v / 100);
    case "millicore":
      return formatMillicores(v, forTooltip);
    case "bytes":
      return formatBytes(v);
    case "usdPerHour":
      return formatMoney(v, "hour", { showUnit: forTooltip });
    case "usd":
      return formatMoney(v, "total");
    case "count":
      return formatCount(v);
  }
}

/** 임계선 라벨이 12px 이내로 겹치면 주의 라벨을 선 아래로 내린다 (4.4) */
export function placeThresholdLabels(lines: { level: "warn" | "crit"; y: number }[]): Record<"warn" | "crit", "above" | "below"> {
  const warn = lines.find((l) => l.level === "warn");
  const crit = lines.find((l) => l.level === "crit");
  const out: Record<"warn" | "crit", "above" | "below"> = { warn: "above", crit: "above" };
  if (warn && crit && Math.abs(warn.y - crit.y) < 12) out.warn = "below";
  return out;
}

/** 가장 가까운 표본 인덱스 (정렬된 시각 배열) */
export function nearestIndex(ts: readonly number[], t: number): number {
  if (ts.length === 0) return -1;
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(ts[lo - 1] - t) <= Math.abs(ts[lo] - t)) return lo - 1;
  return lo;
}
