/** cost 모듈 공통 계산 도우미 (순수 함수) */

export const HOURS_PER_MONTH_DEFAULT = 730;

/** 금액: 소수 6자리 */
export function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** 단가: 소수 10자리 */
export function r10(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0)
    return null;
  return r1((part / whole) * 100);
}

/**
 * 서버가 만든 문장 안의 금액 표기 (디자인 status.md 3.2 규칙 요약).
 * 100 이상은 정수 `$1,234`, 그 미만은 소수 2자리 `$31.20`.
 */
export function usd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 100) {
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

/** `$0.48/h` */
export function usdPerHourText(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}/h`;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------------------
// UTC 날짜
// ---------------------------------------------------------------------------

export function utcDayStart(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

export function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addUtcMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/** `YYYY-MM-DD` (UTC) */
export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function daysInUtcMonth(d: Date): number {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

/** 5분 등 경계로 내림 */
export function floorTo(d: Date, stepSec: number): Date {
  const step = stepSec * 1000;
  return new Date(Math.floor(d.getTime() / step) * step);
}

/** `9월 17일` */
export function koMonthDay(dateYmd: string): string {
  const d = parseYmd(dateYmd);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
}

/** 안정적인 해시용 JSON (키 정렬) */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && 'toNumber' in v) {
    const fn = v.toNumber;
    if (typeof fn === 'function') {
      const n = (fn as () => number).call(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}
