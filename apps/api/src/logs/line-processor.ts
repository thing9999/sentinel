/**
 * 줄 처리 — **서버가 끝낸다** (docs/api/logs.md 4절, AC-LOG18).
 * 화면에 `[31m` 같은 찌꺼기가 오면 서버 결함이다.
 *
 * 순서가 중요하다:
 *   ① 개인 키 블록 접기(여러 줄) → ② 시각 분리 → ③ ANSI·제어문자 정리 →
 *   ④ 바이너리 판정 → ⑤ 길이 자르기 → ⑥ **가림** → LogLine
 * 가림을 마지막에 두는 이유: ANSI 시퀀스가 값 중간에 끼어 있으면 규칙이 값을 못 알아본다.
 */
import { collapsePrivateKeyBlocks, privateKeyLine } from './redact';
import type { LineRedactor } from './redact';
import type { LogLine, LogStats } from './logs.types';

/** CSI·OSC를 포함한 ANSI 이스케이프 시퀀스 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const RFC3339_PREFIX =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s(.*)$/s;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/** 인쇄 불가 제어문자를 `·`(U+00B7)로 (탭은 남긴다) */
export function replaceControls(text: string): string {
  return text.replace(CONTROL_RE, '·');
}

/** `--timestamps=true`가 붙인 앞머리 시각을 분리한다 */
export function splitTimestamp(raw: string): {
  at: string | null;
  body: string;
} {
  const m = RFC3339_PREFIX.exec(raw);
  if (!m) return { at: null, body: raw };
  const d = new Date(m[1]);
  return {
    at: Number.isNaN(d.getTime()) ? null : d.toISOString(),
    body: m[2],
  };
}

/** 인쇄 불가 문자 비율이 이만큼 넘으면 바이너리로 본다 */
const BINARY_RATIO = 0.3;

export function looksBinary(text: string): boolean {
  if (text.length === 0) return false;
  let bad = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c === 9) continue;
    if (c < 32 || c === 127 || c === 0xfffd) bad += 1;
  }
  return bad / [...text].length >= BINARY_RATIO;
}

/** 바이트 기준으로 자른다 (멀티바이트 문자를 쪼개지 않는다) */
export function truncateBytes(
  text: string,
  maxBytes: number,
): { text: string; truncated: number } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.byteLength <= maxBytes) return { text, truncated: 0 };
  let cut = maxBytes;
  // UTF-8 연속 바이트(10xxxxxx) 중간에서 끊지 않는다
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return {
    text: buf.subarray(0, cut).toString('utf8'),
    truncated: buf.byteLength - cut,
  };
}

export interface ProcessOptions {
  idPrefix: string;
  startSeq: number;
  maxLineBytes: number;
  redact: LineRedactor;
  prefix?: { pod: string; container: string } | null;
  stream?: 'stdout' | 'stderr' | null;
  /**
   * 여러 파드를 섞어 볼 때 **줄마다** 붙는 파드·컨테이너 (원본 줄 번호 기준).
   * 하나의 파드만 볼 때는 비운다 — 화면이 같은 이름을 모든 줄에 그리지 않게.
   */
  prefixes?: ({ pod: string; container: string } | null)[] | null;
  /** 줄마다의 stdout/stderr (스택만 구분할 수 있다) */
  streams?: ('stdout' | 'stderr' | null)[] | null;
}

export interface ProcessResult {
  lines: LogLine[];
  stats: Omit<LogStats, 'requested'>;
  nextSeq: number;
}

export function emptyStats(): Omit<LogStats, 'requested'> {
  return {
    returned: 0,
    bytes: 0,
    redactedLines: 0,
    redactedCount: 0,
    truncatedLines: 0,
    droppedLines: 0,
    binaryLines: 0,
    redactFailedLines: 0,
  };
}

/**
 * 원본 줄 묶음 → `LogLine[]`.
 * **원문은 이 함수 밖으로 나가지 않는다** — 반환하는 것은 `segments[]`뿐이다.
 */
export function processLines(
  raw: string[],
  opts: ProcessOptions,
): ProcessResult {
  const stats = emptyStats();
  const collapsedInfo = collapsePrivateKeyBlocks(raw);
  const collapsedAt = new Map(
    collapsedInfo.collapsed.map((c) => [c.index, c.count]),
  );
  const lines: LogLine[] = [];
  let seq = opts.startSeq;

  collapsedInfo.lines.forEach((source, index) => {
    seq += 1;
    const id = `${opts.idPrefix}:${seq}`;
    const origin = collapsedInfo.sourceIndex[index] ?? index;
    const base = {
      id,
      at: null as string | null,
      prefix: opts.prefixes?.[origin] ?? opts.prefix ?? null,
      truncatedBytes: null as number | null,
      droppedLines: null as number | null,
      bytes: null as number | null,
      stream: opts.streams?.[origin] ?? opts.stream ?? null,
    };
    stats.bytes += Buffer.byteLength(source, 'utf8');

    const collapsed = collapsedAt.get(index);
    if (collapsed !== undefined) {
      stats.redactedLines += 1;
      stats.redactedCount += 1;
      lines.push({
        ...base,
        kind: 'line',
        segments: privateKeyLine(collapsed),
      });
      return;
    }

    const { at, body } = splitTimestamp(source);
    const cleanedRaw = replaceControls(stripAnsi(body));

    if (looksBinary(body)) {
      stats.binaryLines += 1;
      lines.push({
        ...base,
        at,
        kind: 'binary',
        segments: [],
        bytes: Buffer.byteLength(body, 'utf8'),
      });
      return;
    }

    const { text, truncated } = truncateBytes(cleanedRaw, opts.maxLineBytes);
    if (truncated > 0) stats.truncatedLines += 1;

    const red = opts.redact(text);
    if (red.failed) {
      stats.redactFailedLines += 1;
      lines.push({ ...base, at, kind: 'redactFailed', segments: [] });
      return;
    }
    if (red.maskedCount > 0) {
      stats.redactedLines += 1;
      stats.redactedCount += red.maskedCount;
    }
    lines.push({
      ...base,
      at,
      kind: 'line',
      segments: red.segments,
      truncatedBytes: truncated > 0 ? truncated : null,
    });
  });

  stats.returned = lines.length;
  return { lines, stats, nextSeq: seq };
}

/** 초당 상한으로 생략된 구간을 한 줄로 알린다 */
export function droppedLine(
  idPrefix: string,
  seq: number,
  count: number,
): LogLine {
  return {
    id: `${idPrefix}:${seq}`,
    kind: 'dropped',
    at: new Date().toISOString(),
    prefix: null,
    segments: [],
    truncatedBytes: null,
    droppedLines: count,
    bytes: null,
    stream: null,
  };
}
