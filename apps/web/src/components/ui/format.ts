/**
 * 표시 전용 포맷 함수 (status.md 3.2 금액, 4.6 단위, 6절 시간).
 * 값 계산(합계·상태 판정)은 하지 않는다. 반올림은 표시 단계에서만.
 */

export const MINUS = "−"; // −
export const EN_DASH = "–"; // –
export const APPROX = "≈"; // ≈

export type MoneyUnit = "hour" | "day" | "month" | "total" | "unitPrice" | "gbMonth";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });

const NF0 = nf(0, 0);
const NF1 = nf(1, 1);
const NF2 = nf(2, 2);
const NF4 = nf(4, 4);

const UNIT_SUFFIX: Record<MoneyUnit, string> = {
  hour: "/h",
  day: "/일",
  month: "/월",
  total: "",
  unitPrice: "/h",
  gbMonth: "/GB-월",
};

export interface FormatMoneyOptions {
  /** 증감액: 부호 필수 (+ / −) */
  delta?: boolean;
  /** 단위 접미사 표시 (열 머리글에 단위가 있으면 false) */
  showUnit?: boolean;
}

/** 금액 본체(기호·접미사 제외)를 status.md 3.2 규칙으로 */
function moneyBody(abs: number, unit: MoneyUnit): string {
  switch (unit) {
    case "hour":
      if (abs > 0 && abs < 0.01) return "<$0.01";
      return `$${NF2.format(abs)}`;
    case "unitPrice":
    case "gbMonth":
      return `$${NF4.format(abs)}`;
    case "day":
      return `$${NF2.format(abs)}`;
    case "month":
    case "total":
      return abs < 10 ? `$${NF2.format(abs)}` : `$${NF0.format(Math.round(abs))}`;
  }
}

/**
 * 예) formatMoney(1.1, "hour") -> "$1.10/h", formatMoney(-12, "month", { delta: true }) -> "−$12/월"
 * 추정 기호(≈)는 붙이지 않는다(MoneyValue가 별도 색으로 붙인다).
 */
export function formatMoney(amount: number, unit: MoneyUnit, opts: FormatMoneyOptions = {}): string {
  const { delta = false, showUnit = true } = opts;
  const abs = Math.abs(amount);
  const body = moneyBody(abs, unit);
  // 반올림 후 0이면 부호 없음
  const isZero = body === "$0.00" || body === "$0" || body === "$0.0000";
  let sign = "";
  if (amount < 0 && !isZero) sign = MINUS;
  else if (delta && amount > 0 && !isZero) sign = "+";
  return `${sign}${body}${showUnit ? UNIT_SUFFIX[unit] : ""}`;
}

/** 범위: `$790 – $900` */
export function formatMoneyRange(low: number, high: number, unit: MoneyUnit = "total", showUnit = false): string {
  return `${formatMoney(low, unit, { showUnit: false })} ${EN_DASH} ${formatMoney(high, unit, { showUnit })}`;
}

/**
 * 비율(0~1) -> 정수 %. 0 < 값 < 1% 이면 `<1%`. signed 면 증감률(부호 필수).
 * digits=1 은 툴팁용.
 */
export function formatPercent(ratio: number, opts: { signed?: boolean; digits?: 0 | 1 } = {}): string {
  const { signed = false, digits = 0 } = opts;
  const pct = ratio * 100;
  const abs = Math.abs(pct);
  let body: string;
  if (abs > 0 && abs < 1 && digits === 0) body = "<1";
  else body = digits === 1 ? NF1.format(abs) : NF0.format(Math.round(abs));
  let sign = "";
  if (pct < 0 && body !== "0") sign = MINUS;
  else if (signed && pct > 0) sign = "+";
  return `${sign}${body}%`;
}

/** 개수: 천 단위 쉼표 */
export function formatCount(n: number): string {
  return NF0.format(n);
}

/** CPU millicore: `1,250m` (툴팁 withCores 면 `1,250m (1.25 cores)`) */
export function formatMillicores(m: number, withCores = false): string {
  const base = `${NF0.format(Math.round(m))}m`;
  if (withCores && m >= 1000) return `${base} (${NF2.format(m / 1000)} cores)`;
  return base;
}

/** 메모리·디스크(bytes): 1024 기준. `512 MiB`, `3.2 GiB`, `128 GiB` */
export function formatBytes(bytes: number): string {
  const mib = bytes / 1024 / 1024;
  if (mib < 1024) return `${NF0.format(Math.round(mib))} MiB`;
  const gib = mib / 1024;
  if (gib < 100) return `${NF1.format(gib)} GiB`;
  return `${NF0.format(Math.round(gib))} GiB`;
}

/** 응답 시간: `312 ms`, `1.4 s` */
export function formatLatency(ms: number): string {
  return ms < 1000 ? `${NF0.format(Math.round(ms))} ms` : `${NF1.format(ms / 1000)} s`;
}

/** 초당 비율: `12.4/s` */
export function formatRate(perSec: number): string {
  return `${NF1.format(perSec)}/s`;
}

/** 경과 시간(표): 가장 큰 단위 2개까지. `45초`, `4분 12초`, `2시간 3분`, `3일 4시간` */
export function formatDurationTable(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const units: Array<[number, string]> = [
    [Math.floor(total / 86400), "일"],
    [Math.floor((total % 86400) / 3600), "시간"],
    [Math.floor((total % 3600) / 60), "분"],
    [total % 60, "초"],
  ];
  const first = units.findIndex(([v]) => v > 0);
  if (first === -1) return "0초";
  const out = [`${units[first][0]}${units[first][1]}`];
  const next = units[first + 1];
  if (next && next[0] > 0) out.push(`${next[0]}${next[1]}`);
  return out.join(" ");
}

/** 경과 타이머: `4:12`, 1시간 이상 `1:04:12` */
export function formatDurationTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export type TimeFormat = "time" | "shortTime" | "auto" | "autoShort";

/**
 * status.md 6절. 브라우저 로컬 시간대, 24시간제.
 * - time: HH:mm:ss / shortTime: HH:mm
 * - auto: 오늘이면 HH:mm:ss, 올해면 `9월 18일 14:02`, 아니면 `2025년 9월 18일 14:02`
 * - autoShort: auto 와 같고 오늘이면 HH:mm (비용·어드바이저)
 */
export function formatTime(value: string | number | Date, format: TimeFormat = "auto", now?: number | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (format === "time") return hms;
  if (format === "shortTime") return hm;
  const n = now === undefined ? d : new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  if (sameDay) return format === "auto" ? hms : hm;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
  if (d.getFullYear() === n.getFullYear()) return md;
  return `${d.getFullYear()}년 ${md}`;
}

/** 날짜만: `9월 17일` */
export function formatMonthDay(value: string | number | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function tzLabel(d: Date): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Seoul") return "KST";
    const part = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
      .formatToParts(d)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? tz;
  } catch {
    return "";
  }
}

/** 툴팁용 전체 시각: `2026-09-19 14:02:10 (KST)` */
export function formatFullTime(value: string | number | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const tz = tzLabel(d);
  return tz ? `${date} ${time} (${tz})` : `${date} ${time}`;
}

/** 상대 시각(보조 문구 전용): `방금`, `3분 전`, `2시간 전`, `3일 전` */
export function formatRelative(value: string | number | Date, now: number | Date): string {
  const diff = new Date(now).getTime() - new Date(value).getTime();
  if (Number.isNaN(diff)) return "—";
  const s = Math.round(diff / 1000);
  if (s < 0) return "방금";
  if (s < 10) return "방금";
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/**
 * 가운데 말줄임용 분할 (status.md 5.3). 끝 keepTail 자를 보존한다.
 * 실제 말줄임은 CSS(앞부분 text-overflow)로 하므로 폭에 맞으면 잘리지 않는다.
 */
export function splitForMiddleEllipsis(name: string, keepTail = 16): { head: string; tail: string } {
  const chars = Array.from(name);
  if (chars.length <= keepTail) return { head: "", tail: name };
  return { head: chars.slice(0, chars.length - keepTail).join(""), tail: chars.slice(-keepTail).join("") };
}

/** 노드 이름 `ip-10-0-12-34.ap-northeast-2.compute.internal` -> `ip-10-0-12-34` */
export function shortNodeName(name: string): string {
  const i = name.indexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

/** 트랜잭션 ID 나이: `5.2억 (520,113,442)` */
export function formatXidAge(n: number): string {
  return `${NF1.format(n / 1e8)}억 (${NF0.format(n)})`;
}
