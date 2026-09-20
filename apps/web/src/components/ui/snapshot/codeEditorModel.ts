/**
 * CodeEditor 표현 계층의 순수 계산(렌더링·편집 엔진과 무관). 테스트 가능하게 분리했다.
 * 편집 라이브러리(CodeMirror 등)를 꽂을 때도 줄 분할·줄 장식 규칙은 이 함수들을 그대로 쓴다.
 */
import type { ScanLevel } from "../types";
import { scanLevelSpec, type ScanLevelSpec } from "./scan";

/** 줄 높이(px): code 13/20 */
export const CODE_LINE_HEIGHT = 20;
/** 코드 영역 위아래 패딩(px) */
export const CODE_PAD_Y = 8;
/** 본문 왼쪽·오른쪽 패딩(px) */
export const CODE_PAD_LEFT = 12;
export const CODE_PAD_RIGHT = 16;
/** gutter: 표시 칸 20px + 줄 번호 칸(자릿수 × 8px, 최소 32px) + 오른쪽 패딩 8px */
export const GUTTER_MARK_W = 20;
export const GUTTER_NUM_MIN_W = 32;
export const GUTTER_DIGIT_W = 8;
export const GUTTER_PAD_RIGHT = 8;

export interface CodeEditorMarkerItem {
  ruleId: string;
  /** 서버가 가린 설명(원문 없음) */
  description: string;
}

export interface CodeEditorMarker {
  /** 1부터 */
  line: number;
  level: ScanLevel | (string & {});
  items: CodeEditorMarkerItem[];
}

/** 한 줄의 표시 장식 (엔진이 그린다) */
export interface LineDecoration {
  line: number;
  /** 발견 등급(한 줄에 여러 개면 가장 나쁜 것). 없으면 발견 없음 */
  level: ScanLevelSpec | null;
  /** gutter 아이콘 툴팁 줄들: `오류 · env-block · 환경 변수 블록을 여는 줄` */
  tooltip: string[];
  /** 이동 대상 줄: 본문 안쪽 3px accent 막대 + 줄 번호 captionStrong accent */
  target: boolean;
  /** 읽기 전용 강조(메타데이터 손상 위치): 배경 status.crit.bg */
  highlight: boolean;
}

/**
 * 줄 나누기. CRLF·CR·LF 모두 줄바꿈으로 본다(브라우저 textarea 가 CRLF/CR 을 LF 로 바꾸므로 줄 수가 1:1 로 유지된다).
 * 빈 문자열도 1줄.
 */
export function splitLines(value: string): string[] {
  return value.split(/\r\n|\r|\n/);
}

/** 줄 번호 칸 폭(px) */
export function gutterNumberWidth(lineCount: number): number {
  const digits = String(Math.max(1, lineCount)).length;
  return Math.max(GUTTER_NUM_MIN_W, digits * GUTTER_DIGIT_W);
}

/** gutter 전체 폭(px) */
export function gutterWidth(lineCount: number): number {
  return GUTTER_MARK_W + gutterNumberWidth(lineCount) + GUTTER_PAD_RIGHT;
}

/** 고정폭 글꼴 기준 표시 폭(칸). 한글·CJK·전각은 2칸, 탭은 2칸으로 본다(대략값: 가로 스크롤 폭·줄 바꿈 높이 추정용) */
export function visualWidth(line: string): number {
  let w = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 9) w += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      // 서로게이트 쌍(이모지 등): 2칸, 다음 코드 단위 건너뜀
      w += 2;
      i++;
    } else if (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)))
      w += 2;
    else w += 1;
  }
  return w;
}

/** 가장 긴 줄의 표시 폭(칸) */
export function maxVisualWidth(lines: string[]): number {
  let m = 0;
  for (const l of lines) {
    // 빠른 경로: 길이가 현재 최댓값의 절반 이하면 2칸 문자여도 넘을 수 없다
    if (l.length * 2 <= m) continue;
    const w = visualWidth(l);
    if (w > m) m = w;
  }
  return m;
}

/**
 * 줄마다 시작 위치(px, 코드 영역 위 패딩 제외) 누적 배열. length = lineCount + 1, 마지막 값이 전체 높이.
 * wrap 이 아니면 모든 줄 20px. wrap 이면 폭으로 줄 수를 추정한다(실제 렌더는 흐름 배치라 겹치지 않고 스크롤 막대만 근사).
 */
export function lineOffsets(lines: string[], wrapColumns: number | null): Float64Array {
  const n = lines.length;
  const out = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const rows = wrapColumns && wrapColumns > 0 ? Math.max(1, Math.ceil(visualWidth(lines[i]) / wrapColumns)) : 1;
    out[i + 1] = out[i] + rows * CODE_LINE_HEIGHT;
  }
  return out;
}

/** offsets 에서 y(px) 가 속한 줄 index(0부터) — 이진 탐색 */
export function indexAtOffset(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1;
  if (n <= 0 || y <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 보이는 줄 범위 [start, end) + 앞뒤 여유 */
export function visibleRange(
  offsets: Float64Array,
  scrollTop: number,
  viewportHeight: number,
  overscan = 20,
): { start: number; end: number } {
  const n = offsets.length - 1;
  const top = Math.max(0, scrollTop - CODE_PAD_Y);
  const first = indexAtOffset(offsets, top);
  const last = indexAtOffset(offsets, top + Math.max(viewportHeight, CODE_LINE_HEIGHT));
  return { start: Math.max(0, first - overscan), end: Math.min(n, last + 1 + overscan) };
}

/** 이동 대상 줄을 영역 위에서 1/3 위치에 두는 scrollTop */
export function scrollTopForLine(offsets: Float64Array, line: number, viewportHeight: number): number {
  const n = offsets.length - 1;
  const idx = Math.min(Math.max(1, line), Math.max(1, n)) - 1;
  return Math.max(0, CODE_PAD_Y + offsets[idx] - viewportHeight / 3);
}

/** markers·targetLine·highlightLine → 줄 번호별 장식 (한 줄에 여러 마커면 가장 나쁜 등급) */
export function buildDecorations(
  markers: CodeEditorMarker[],
  targetLine: number | null | undefined,
  highlightLine: number | null | undefined,
): Map<number, LineDecoration> {
  const map = new Map<number, LineDecoration>();
  const get = (line: number) => {
    let d = map.get(line);
    if (!d) {
      d = { line, level: null, tooltip: [], target: false, highlight: false };
      map.set(line, d);
    }
    return d;
  };
  for (const m of markers) {
    if (!Number.isFinite(m.line) || m.line < 1) continue;
    const d = get(m.line);
    const spec = scanLevelSpec(m.level);
    if (!d.level || spec.rank > d.level.rank) d.level = spec;
    for (const it of m.items) d.tooltip.push(`${spec.label} · ${it.ruleId} · ${it.description}`);
  }
  if (targetLine && targetLine >= 1) get(targetLine).target = true;
  if (highlightLine && highlightLine >= 1) get(highlightLine).highlight = true;
  return map;
}

/** 이동 후 live 영역 문구: `terraform.tf 212번째 줄, 오류 env-block` */
export function targetAnnouncement(fileName: string, line: number, markers: CodeEditorMarker[]): string {
  const here = markers.filter((m) => m.line === line);
  const parts = here.flatMap((m) => {
    const spec = scanLevelSpec(m.level);
    return m.items.map((it) => `${spec.label} ${it.ruleId}`);
  });
  return `${fileName} ${line.toLocaleString("en-US")}번째 줄${parts.length ? `, ${parts.join(", ")}` : ""}`;
}
