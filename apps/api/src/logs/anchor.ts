/**
 * "그 시각으로 열기" (`anchorAt`, docs/api/logs.md 2.2.1).
 *
 * 알림·이벤트 링크의 `at`은 **그 시각을 보러 가는** 링크다(PM 결정 D3). 화면은 `at`을 받아
 * `POST /api/logs/query`에 `anchorAt`으로 넘기고, 서버가 ① 기간을 고르고 ② 그 시각의 줄을 찾고
 * ③ 못 찾았으면 **왜 못 찾았는지를 한 줄로** 말한다. 화면이 시각을 비교하거나 문구를 만들지 않는다.
 *
 * 순수 함수만 둔다(테스트 가능). 로그 본문을 읽지 않는다 — 줄의 `at`·`id`만 본다.
 */
import type { LogLine, LogNotice, LogSourceId } from './logs.types';

/** direct: 그 시각보다 이만큼 앞부터 가져온다 (앞 문맥) */
export const ANCHOR_LEAD_SEC = 120;
/** stack: 그 시각 앞뒤로 이만큼을 기간으로 잡는다 */
export const ANCHOR_WINDOW_SEC = 300;

export type LogAnchorState =
  'found' | 'before_result' | 'after_result' | 'none';

export type LogAnchorReason =
  | 'cut' //                줄 수 상한에 걸려 그 시각까지 닿지 않았다
  | 'outside_range' //      사용자가 고른 기간 밖이다
  | 'earlier_generation' // direct: 그 시각에는 지금 컨테이너가 시작 전이었다(재시작됨)
  | 'file_start'; //        direct `현재 파일 전체`: 파일 첫 줄이 그 시각보다 뒤다

export interface LogAnchor {
  /** 요청한 시각 (정규화한 ISO UTC) */
  at: string;
  state: LogAnchorState;
  /**
   * 화면이 스크롤해 표시할 줄.
   * found: 그 시각 이후 첫 줄 / before_result: 가져온 첫 줄 / after_result: 마지막 줄 / none: null
   */
  lineId: string | null;
}

export interface AnchorLocateInput {
  lines: readonly LogLine[];
  anchorMs: number;
  /** 조회 기간의 시작. `현재 파일 전체`처럼 시작이 없으면 null */
  rangeFromMs: number | null;
  /** 줄 수·바이트 상한에 걸리지 않고 기간 안의 줄을 **다** 가져왔는가 */
  complete: boolean;
  /** direct 현재 세대 컨테이너가 시작된 시각. 모르거나 이전 세대 조회면 null */
  generationStartMs: number | null;
}

export interface AnchorLocateResult {
  state: LogAnchorState;
  lineId: string | null;
  reason: LogAnchorReason | null;
}

export function locateAnchor(a: AnchorLocateInput): AnchorLocateResult {
  const stamped = a.lines.filter(
    (l): l is LogLine & { at: string } =>
      l.at !== null && Number.isFinite(Date.parse(l.at)),
  );
  if (stamped.length === 0)
    return { state: 'none', lineId: null, reason: null };
  const first = stamped[0];
  const last = stamped[stamped.length - 1];
  const before = (reason: LogAnchorReason): AnchorLocateResult => ({
    state: 'before_result',
    lineId: first.id,
    reason,
  });

  if (a.generationStartMs !== null && a.anchorMs < a.generationStartMs)
    return before('earlier_generation');
  if (a.rangeFromMs !== null && a.anchorMs < a.rangeFromMs)
    return before('outside_range');
  if (a.anchorMs > Date.parse(last.at))
    return { state: 'after_result', lineId: last.id, reason: null };

  const idx = stamped.findIndex((l) => Date.parse(l.at) >= a.anchorMs);
  // idx >= 0은 위의 after 검사로 보장된다
  if (idx > 0 || Date.parse(first.at) === a.anchorMs)
    return { state: 'found', lineId: stamped[idx].id, reason: null };
  // 첫 줄부터 그 시각 이후다: 그 앞이 "조용했던 것"인지 "못 가져온 것"인지를 가른다
  if (!a.complete) return before('cut');
  if (a.rangeFromMs === null) return before('file_start');
  // 기간 시작(그 시각보다 앞)부터 빠짐없이 가져왔는데 첫 줄이 그 시각 이후 = 그 사이 출력이 없었다
  return { state: 'found', lineId: first.id, reason: null };
}

/** 못 찾았을 때의 안내 한 줄. **화면은 코드 → 문구 매핑을 갖지 않는다** — 서버가 문장을 만든다 */
export function anchorNotice(
  result: AnchorLocateResult,
  ctx: {
    at: string;
    source: LogSourceId;
    appliedLines: number;
    maxLines: number;
  },
): LogNotice | null {
  if (result.state === 'after_result') {
    return {
      code: 'LOG_ANCHOR_AFTER_RESULT',
      level: 'info',
      text: '그 시각 이후로 출력된 줄이 없습니다. 그 시각 바로 앞 줄을 표시합니다.',
      details: { at: ctx.at, state: result.state, suggest: null },
    };
  }
  if (result.state !== 'before_result' || !result.reason) return null;
  let text: string;
  let suggest: 'more_lines' | 'range' | 'previous' | null;
  switch (result.reason) {
    case 'earlier_generation':
      text =
        "그 시각에는 지금 컨테이너가 아직 시작되기 전이었습니다(재시작됨). 재시작 직전 로그는 '이전 세대(1회 전)'에 있을 수 있습니다 — 직접 조회는 직전 1세대까지만 봅니다.";
      suggest = 'previous';
      break;
    case 'outside_range':
      text = '그 시각은 고른 기간 밖입니다. 기간을 넓혀 다시 조회하세요.';
      suggest = 'range';
      break;
    case 'file_start':
      text =
        '현재 로그 파일의 첫 줄이 그 시각보다 뒤입니다. 그 사이 출력이 없었거나, 로그 파일이 회전돼 직접 조회로는 볼 수 없습니다.';
      suggest = null;
      break;
    case 'cut':
    default:
      if (ctx.appliedLines >= ctx.maxLines) {
        text =
          ctx.source === 'stack'
            ? `줄 수 상한(${ctx.maxLines}줄)으로도 그 시각까지 닿지 않습니다. 기간을 좁혀 다시 조회하세요.`
            : `줄 수 상한(${ctx.maxLines}줄)으로도 그 시각까지 닿지 않습니다. 직접 조회는 더 앞을 가져올 수 없습니다 — 외부 로그 스택이 있으면 기간으로 좁혀 볼 수 있습니다.`;
        suggest = ctx.source === 'stack' ? 'range' : null;
      } else {
        text = `그 시각의 줄은 가져온 ${ctx.appliedLines}줄보다 앞에 있습니다. 줄 수를 늘려 다시 조회하세요.`;
        suggest = 'more_lines';
      }
  }
  return {
    code: 'LOG_ANCHOR_BEFORE_RESULT',
    level: 'info',
    text,
    details: {
      at: ctx.at,
      state: result.state,
      reason: result.reason,
      suggest,
    },
  };
}
