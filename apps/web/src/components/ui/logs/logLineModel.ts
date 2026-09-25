/**
 * 로그 줄 모델 (components.md 20.5, status.md 13.3·13.4, logs.md 7절).
 * 순수 함수만 둔다 — 화면은 **서버가 준 값을 그리기만** 하고 로그 내용으로 상태를 만들지 않는다(13.1).
 */
import type { IsoTime } from "../types";

/** logs.md 3절. 출처는 서버가 고른다(화면이 자동 전환하지 않는다) */
export type LogSource = "direct" | "stack";

export type LogLineKind = "line" | "dropped" | "binary" | "redactFailed" | "ringTop" | "gap";

/**
 * 가림 규칙 참조. 계약(`docs/api/logs.md` 3절)은 `{ id, label }` 객체로 주고
 * `components.md` 20.5 표는 `string[]`으로 적었다 — **둘 다 받는다**(화면이 규칙을 만들지 않으므로
 * 어느 쪽이든 이름을 그대로 나열할 뿐이다). 규칙 개수·목록을 화면에 하드코딩하지 않는다(logs.md 7.3).
 */
export type LogRuleRef = { id: string; label: string; confidence?: "high" | "suspect" };

/** 서버가 가림 처리한 조각. 화면에 **원문이 오지 않는다** */
export type LogSegment =
  | { t: "text"; v: string }
  | { t: "masked"; v: string; rules: (string | LogRuleRef)[]; confidence: "high" | "suspect" };

export interface LogLine {
  /** 서버 값(재연결해도 중복되지 않는다) */
  id: string;
  kind: LogLineKind;
  /** 서버가 분리해 준 시각 */
  at?: IsoTime;
  prefix?: { pod: string; container: string };
  segments: LogSegment[];
  /** 끝에 `… (N바이트 생략)` */
  truncatedBytes?: number;
  /** kind: "dropped" */
  droppedLines?: number;
  /** kind: "binary" */
  bytes?: number;
}

/** 줄 높이 20px 고정(`code` 13/20). `wrap` 이면 20px × 줄 수 */
export const LOG_LINE_HEIGHT = 20;

/** 가림 gutter 폭 (status.md 13.3). 좁은 폭에서도 **없애지 않는다**(24px) */
export const LOG_GUTTER_WIDTH = 28;

/** 본문 줄이 아닌 안내 줄(전부 중립색, 상태색 금지 — status.md 13.1) */
export function isNoticeLine(kind: LogLineKind): boolean {
  return kind !== "line";
}

/**
 * **전체 폭 한 줄짜리** 특별한 줄인가(logs.md 7.2, 2026-09-25): 초당 상한 생략·링버퍼 위쪽·구간 없음.
 * 이 줄들의 문구는 줄 전체 폭이 아니라 **보이는 본문 영역 가운데**에 둔다(가로로 밀어도 사라지지 않게).
 * `binary`·`redactFailed` 는 **실제 한 줄을 대신하는** 줄이라 문구를 다른 줄처럼 본문 흐름 안에 둔다(배경만 전체 폭).
 */
export function isFullWidthNotice(kind: LogLineKind): boolean {
  return kind === "dropped" || kind === "ringTop" || kind === "gap";
}

/** 줄의 글자 전체 (가린 조각은 가린 표기 그대로. **원문은 화면에 없다**) */
export function lineText(line: LogLine): string {
  return line.segments.map((s) => s.v).join("");
}

/** 그 줄에서 가려진 조각 수 (gutter 표식·접근 이름) */
export function maskedCount(line: LogLine): number {
  return line.segments.reduce((n, s) => n + (s.t === "masked" ? 1 : 0), 0);
}

/** 가림 규칙 이름 (팝오버는 호출 측이 연다. **규칙 개수를 화면에 고정하지 않는다**, logs.md 7.3) */
export function maskedRules(line: LogLine): string[] {
  const out: string[] = [];
  for (const s of line.segments) {
    if (s.t !== "masked") continue;
    for (const r of s.rules) {
      const name = typeof r === "string" ? r : r.label;
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

const NOTICE_FALLBACK: Record<Exclude<LogLineKind, "line">, (line: LogLine) => string> = {
  // 서버 문구가 있으면 그것을 쓴다. 없을 때만 최소 문구로 — 화면이 시각·건수를 지어내지 않는다
  dropped: (l) =>
    l.droppedLines !== undefined
      ? `초당 상한으로 ${l.droppedLines.toLocaleString("en-US")}줄 생략됨`
      : "초당 상한으로 일부 줄이 생략됐습니다",
  binary: (l) =>
    l.bytes !== undefined ? `[바이너리 데이터 ${l.bytes.toLocaleString("en-US")}바이트]` : "[바이너리 데이터]",
  redactFailed: () => "[가림 처리 실패 — 줄 생략]",
  ringTop: () => "이전 줄은 화면에서 지워졌습니다",
  gap: () => "이 구간의 로그는 없습니다",
};

/** 안내 줄 문구. 서버 `segments` 가 있으면 그대로, 없으면 종류별 최소 문구 */
export function noticeText(line: LogLine): string {
  const text = lineText(line).trim();
  if (text) return text;
  if (line.kind === "line") return "";
  return NOTICE_FALLBACK[line.kind](line);
}

/** 긴 줄 잘림 꼬리 ` … (12,345바이트 생략)` */
export function truncatedTail(line: LogLine): string | null {
  if (line.truncatedBytes === undefined || line.truncatedBytes <= 0) return null;
  return ` … (${line.truncatedBytes.toLocaleString("en-US")}바이트 생략)`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 로그 시각. `14:02:10.412`(기본) / 좁은 폭은 `14:02:10`. tabular mono */
export function formatLogTime(at: string | number | Date, withMs = true): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return withMs ? `${hms}.${String(d.getMilliseconds()).padStart(3, "0")}` : hms;
}

// ───── 그 시각으로 열기 — 앵커 (logs.md 7.6, components.md 20.5 `anchor`, 계약 docs/api/logs.md 2.2.1) ─────

/** 계약 `anchor.state` 그대로 */
export type LogAnchorState = "found" | "before_result" | "after_result" | "none";

/** `LogLineList.anchor` prop (components.md 20.5) */
export interface LogListAnchor {
  /** 강조할 줄(서버 `anchor.lineId`). 화면은 시각을 비교하지 않는다 — 서버가 고른 줄만 쓴다 */
  lineId: string;
  /** 구분 줄 자리: 그 줄 위(`above`) / 아래(`below`) */
  placement: "above" | "below";
  /** 구분 줄 문구(`그 시각 14:02:05` …) */
  label: string;
  /** 구분 줄 툴팁 — 전체 시각(`2026-09-25 14:02:05 (KST)`, `formatFullTime`) */
  title?: string;
}

/** 구분 줄 높이. **로그 줄 높이와 같다**(가상 스크롤이 20px 단위로 셈한다). CSS `.anchorSeparator` 와 같은 값 */
export const LOG_ANCHOR_SEPARATOR_HEIGHT = LOG_LINE_HEIGHT;

/**
 * 구분 줄 문구에 넣는 시각(logs.md 7.6 "시각 표기"): 오늘이면 `14:02:05`, 아니면 `9월 24일 14:02:05`,
 * 해가 다르면 `2025년 9월 24일 14:02:05`. **초까지** 적는다(`formatTime("auto")`는 다른 날이면 분까지라 따로 둔다).
 * 화면 시간대로 적는다(서버 문구에는 시계를 넣지 않는다, 계약 2.2.1).
 */
export function logAnchorTimeText(at: string | number | Date, now: number | Date = Date.now()): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const n = new Date(now);
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return hms;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 ${hms}`;
  return d.getFullYear() === n.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

/**
 * 서버 `anchor { state, lineId }` → `LogLineList.anchor` (logs.md 7.6 표 그대로).
 *
 * | state | 구분 줄 자리 | 문구 |
 * |---|---|---|
 * | `found` | 앵커 줄 바로 위 | `그 시각 14:02:05` |
 * | `before_result` | 앵커 줄(= 가져온 첫 줄) 바로 위 = 목록 맨 위 | `그 시각 14:02:05의 줄은 이보다 앞이라 가져오지 못했습니다` |
 * | `after_result` | 앵커 줄(= 마지막 줄) 바로 **아래** = 목록 맨 아래 | `그 시각 14:02:05 이후 출력 없음` |
 * | `none` / `lineId` 없음 | 그리지 않는다(undefined) | - |
 *
 * `timeText` 는 `logAnchorTimeText(anchor.at)`, `title` 은 `formatFullTime(anchor.at)` 을 넘기면 된다.
 */
export function logListAnchor(
  anchor: { state: LogAnchorState; lineId: string | null } | null | undefined,
  timeText: string,
  title?: string,
): LogListAnchor | undefined {
  if (!anchor?.lineId) return undefined;
  switch (anchor.state) {
    case "found":
      return { lineId: anchor.lineId, placement: "above", label: `그 시각 ${timeText}`, title };
    case "before_result":
      return {
        lineId: anchor.lineId,
        placement: "above",
        label: `그 시각 ${timeText}의 줄은 이보다 앞이라 가져오지 못했습니다`,
        title,
      };
    case "after_result":
      return { lineId: anchor.lineId, placement: "below", label: `그 시각 ${timeText} 이후 출력 없음`, title };
    default:
      return undefined;
  }
}

/**
 * 첫 화면 스크롤 위치(`placement: "above"`): 구분 줄 **윗변**이 본문 높이의 **1/3 지점**(20px 단위 내림)에 오게 한다.
 * 위에 줄이 모자라면 0(맨 위) — `before_result`(첫 줄)는 자연히 0이 된다(logs.md 7.6 표).
 * 480px → 1/3 = 160px → 앞 8줄 · 뒤 15줄이 보인다.
 */
export function anchorScrollTop(separatorTop: number, viewportHeight: number): number {
  const third = Math.floor(viewportHeight / 3 / LOG_LINE_HEIGHT) * LOG_LINE_HEIGHT;
  return Math.max(0, separatorTop - third);
}

/** 파드·컨테이너 접두 (`stack` 합쳐보기) */
export function prefixText(line: LogLine): string | null {
  return line.prefix ? `${line.prefix.pod} · ${line.prefix.container}` : null;
}

/** 줄 시작 오프셋(prefix sum). 마지막 칸은 전체 높이다 (길이 = lines.length + 1) */
export function lineOffsets(heights: number[]): number[] {
  const out = new Array<number>(heights.length + 1);
  out[0] = 0;
  for (let i = 0; i < heights.length; i += 1) out[i + 1] = out[i] + heights[i];
  return out;
}

/** offsets 에서 y 픽셀이 속한 줄 번호 (이분 탐색) */
export function indexAtOffset(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 그릴 줄 범위 [start, end). 2만 줄에서도 화면 몫만 그린다 */
export function logVisibleRange(
  offsets: number[],
  scrollTop: number,
  viewport: number,
  overscan = 10,
): [number, number] {
  const total = offsets.length - 1;
  if (total <= 0) return [0, 0];
  const first = indexAtOffset(offsets, Math.max(0, scrollTop));
  const last = indexAtOffset(offsets, Math.max(0, scrollTop + viewport));
  return [Math.max(0, first - overscan), Math.min(total, last + overscan + 1)];
}

export interface FindMatch {
  start: number;
  end: number;
}

/**
 * 화면 안에서 찾기 (logs.md 6.3). **정규식이 아니라 글자 그대로** 찾는다(대소문자 무시).
 * 일치는 배경만 바꾼다 — 로그 본문에 상태색을 쓰지 않는다는 규칙의 예외를 만들지 않기 위해서다.
 */
export function findMatches(text: string, query: string): FindMatch[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: FindMatch[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    out.push({ start: i, end: i + needle.length });
    from = i + needle.length;
  }
  return out;
}

/** 텍스트를 일치·비일치 토막으로 자른다(렌더 전용) */
export function splitByMatches(text: string, query: string): { text: string; hit: boolean }[] {
  const ms = findMatches(text, query);
  if (ms.length === 0) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const m of ms) {
    if (m.start > at) out.push({ text: text.slice(at, m.start), hit: false });
    out.push({ text: text.slice(m.start, m.end), hit: true });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** 줄 하나의 스크린리더 문구 (색·배경 없이도 같은 사실이 읽힌다) */
export function logLineSrText(line: LogLine, withMs = true): string {
  const parts: string[] = [];
  if (line.at) parts.push(formatLogTime(line.at, withMs));
  const prefix = prefixText(line);
  if (prefix) parts.push(prefix);
  const masked = maskedCount(line);
  if (masked > 0) parts.push(`가려진 값 ${masked}개`);
  parts.push(isNoticeLine(line.kind) ? noticeText(line) : lineText(line));
  const tail = truncatedTail(line);
  if (tail) parts.push(tail.trim());
  return parts.join(", ");
}

/**
 * 닫을 수 없는 가림 경고 (logs.md 6.1, status.md 13.4, AC-LOG08).
 * 로그 본문이 보이는 **모든 자리**에 상시 표시한다. 접기·닫기·툴팁 안으로 숨기지 않는다.
 */
export const LOG_REDACTION_NOTICE =
  "비밀값 가림은 흔한 형태만 잡습니다. 완벽하지 않습니다 — 화면 공유·스크린샷 전에 직접 확인하세요.";

/** 가림 팝오버 맨 아래 한 줄. 원문 보기·복사 버튼·명령 상자를 두지 않는다(PM 결정 Q2·Q10) */
export const LOG_REDACTION_NO_RAW =
  "원문은 대시보드에서 볼 수 없습니다. 필요하면 터미널에서 kubectl logs로 확인하세요.";

/** 확신 등급 문구 (logs.md 7.3). `의심`은 오탐일 수 있다는 뜻이라 문구로 적는다 */
export const LOG_CONFIDENCE_LABEL: Record<"high" | "suspect", string> = {
  high: "높음",
  suspect: "의심",
};
