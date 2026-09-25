import { anchorNotice, locateAnchor } from './anchor';
import type { LogLine } from './logs.types';

/** 그 시각으로 열기 (docs/api/logs.md 2.2.1). 줄의 `at`·`id`만 본다 */
describe('locateAnchor', () => {
  const T0 = Date.parse('2026-09-25T14:00:00.000Z');
  const line = (id: string, offsetSec: number | null): LogLine => ({
    id,
    kind: 'line',
    at:
      offsetSec === null ? null : new Date(T0 + offsetSec * 1000).toISOString(),
    prefix: null,
    segments: [{ t: 'text', v: 'x' }],
    truncatedBytes: null,
    droppedLines: null,
    bytes: null,
    stream: null,
  });
  // 14:00:10, 14:00:20, 14:00:30, 14:00:40
  const lines = [line('a', 10), line('b', 20), line('c', 30), line('d', 40)];
  const base = {
    lines,
    rangeFromMs: T0,
    complete: false,
    generationStartMs: null,
  };

  it('가져온 범위 안이면 그 시각 이후 첫 줄 (found)', () => {
    expect(locateAnchor({ ...base, anchorMs: T0 + 25_000 })).toEqual({
      state: 'found',
      lineId: 'c',
      reason: null,
    });
  });

  it('정확히 첫 줄 시각이면 found', () => {
    expect(locateAnchor({ ...base, anchorMs: T0 + 10_000 }).state).toBe(
      'found',
    );
  });

  it('첫 줄보다 앞인데 줄 수 상한에 잘렸으면 before_result(cut)', () => {
    expect(locateAnchor({ ...base, anchorMs: T0 + 5_000 })).toEqual({
      state: 'before_result',
      lineId: 'a',
      reason: 'cut',
    });
  });

  it('첫 줄보다 앞이지만 기간 시작부터 빠짐없이 가져왔으면 조용했던 구간 → found(첫 줄)', () => {
    expect(
      locateAnchor({ ...base, complete: true, anchorMs: T0 + 5_000 }),
    ).toEqual({ state: 'found', lineId: 'a', reason: null });
  });

  it('현재 파일 전체(시작 없음)인데 첫 줄이 뒤면 before_result(file_start)', () => {
    expect(
      locateAnchor({
        ...base,
        rangeFromMs: null,
        complete: true,
        anchorMs: T0 + 5_000,
      }).reason,
    ).toBe('file_start');
  });

  it('고른 기간 밖이면 before_result(outside_range)', () => {
    expect(
      locateAnchor({ ...base, rangeFromMs: T0 + 8_000, anchorMs: T0 }).reason,
    ).toBe('outside_range');
  });

  it('지금 컨테이너가 시작되기 전 시각이면 before_result(earlier_generation)', () => {
    expect(
      locateAnchor({
        ...base,
        generationStartMs: T0 + 9_000,
        anchorMs: T0 + 1_000,
      }).reason,
    ).toBe('earlier_generation');
  });

  it('마지막 줄보다 뒤면 after_result(마지막 줄)', () => {
    expect(locateAnchor({ ...base, anchorMs: T0 + 90_000 })).toEqual({
      state: 'after_result',
      lineId: 'd',
      reason: null,
    });
  });

  it('시각이 있는 줄이 없으면 none', () => {
    expect(
      locateAnchor({ ...base, lines: [line('x', null)], anchorMs: T0 }),
    ).toEqual({ state: 'none', lineId: null, reason: null });
  });
});

describe('anchorNotice — 서버가 문장을 만든다', () => {
  const ctx = {
    at: '2026-09-25T14:00:00.000Z',
    source: 'direct' as const,
    appliedLines: 500,
    maxLines: 5000,
  };

  it('found·none은 안내가 없다', () => {
    expect(
      anchorNotice({ state: 'found', lineId: 'a', reason: null }, ctx),
    ).toBeNull();
    expect(
      anchorNotice({ state: 'none', lineId: null, reason: null }, ctx),
    ).toBeNull();
  });

  it('잘렸으면 줄 수를 늘리라고 한다 (suggest: more_lines)', () => {
    const n = anchorNotice(
      { state: 'before_result', lineId: 'a', reason: 'cut' },
      ctx,
    )!;
    expect(n.code).toBe('LOG_ANCHOR_BEFORE_RESULT');
    expect(n.text).toContain('500줄');
    expect(n.details).toMatchObject({ suggest: 'more_lines', reason: 'cut' });
  });

  it('상한까지 가져와도 못 닿으면 direct는 더 방법이 없다고 정직하게 말한다', () => {
    const n = anchorNotice(
      { state: 'before_result', lineId: 'a', reason: 'cut' },
      { ...ctx, appliedLines: 5000 },
    )!;
    expect(n.text).toContain('외부 로그 스택');
    expect(n.details).toMatchObject({ suggest: null });
  });

  it('이전 세대를 권한다 (suggest: previous)', () => {
    const n = anchorNotice(
      { state: 'before_result', lineId: 'a', reason: 'earlier_generation' },
      ctx,
    )!;
    expect(n.text).toContain('이전 세대');
    expect(n.details).toMatchObject({ suggest: 'previous' });
  });

  it('after_result는 LOG_ANCHOR_AFTER_RESULT', () => {
    expect(
      anchorNotice({ state: 'after_result', lineId: 'd', reason: null }, ctx)
        ?.code,
    ).toBe('LOG_ANCHOR_AFTER_RESULT');
  });
});
