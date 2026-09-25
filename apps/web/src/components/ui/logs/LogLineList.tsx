"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { Button } from "../controls/Button";
import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { Icon } from "../icons";
import { MaskedValue } from "../k8s/DiffValue";
import { Tooltip } from "../overlay/Tooltip";
import { Chip } from "../status/Chip";
import styles from "./logs.module.css";
import {
  LOG_ANCHOR_SEPARATOR_HEIGHT,
  LOG_GUTTER_WIDTH,
  LOG_LINE_HEIGHT,
  anchorScrollTop,
  formatLogTime,
  isFullWidthNotice,
  isNoticeLine,
  lineOffsets,
  logVisibleRange,
  maskedCount,
  noticeText,
  prefixText,
  splitByMatches,
  truncatedTail,
  type LogLine,
  type LogListAnchor,
} from "./logLineModel";

export interface LogLineListProps {
  /** **호출 측이 링버퍼(2만 줄)를 관리한다.** 컴포넌트는 받은 배열을 그리기만 한다 */
  lines: LogLine[];
  /** 시각 열(104px, 좁은 폭 72px) */
  showTimestamp?: boolean;
  /** 줄 바꿈. false 면 **본문 영역 안에서만** 가로 스크롤(페이지는 스크롤하지 않는다) */
  wrap?: boolean;
  /** 파드·컨테이너 접두 열(200px, `stack` 합쳐보기) */
  showPrefix?: boolean;
  /**
   * **자동 스크롤**: true 면 새 줄에 맞춰 맨 아래로 붙는다.
   * prop 이름은 `follow` 지만 `따라가기` Switch(= 연결)와 **다른 값**이다. 호출 측은
   * `따라가기 켬 && 자동 스크롤 켬`을 넘긴다(logs.md 7.4, PM 결정 D2).
   */
  follow?: boolean;
  /**
   * 사용자가 위로 스크롤하면(끝에서 20px = 1줄 넘게 벗어나면) 1회 호출.
   * 호출 측은 **자동 스크롤만** 끈다 — `따라가기` Switch 와 연결은 그대로 둔다(D2).
   * 다시 맨 아래로 내려가도 자동 스크롤은 켜지지 않는다(`onJumpToBottom` 버튼으로만 다시 붙는다).
   * `currentMatch` 로 찾은 줄에 가느라 바닥을 벗어날 때도 1회 부른다(아래 `currentMatch`).
   */
  onFollowBreak?: () => void;
  /**
   * (2026-09-25 추가) 자동 스크롤이 꺼진 상태(`follow` false)에서 **사용자가 스크롤해** 끝에서 4px 이내에 닿으면 호출.
   * **알리기만 한다.** 호출 측은 `pendingCount` 를 0으로 되돌리고 **자동 스크롤은 켜지 않는다**(logs.md 7.4 —
   * 맨 아래에 닿는 것은 대개 마지막 줄을 읽다 생긴 일이지 "다시 따라가겠다"는 뜻이 아니다).
   * - 새 줄이 붙어 내용이 길어지는 것만으로는 부르지 않는다(사용자 스크롤일 때만).
   * - 코드가 옮긴 스크롤(자동 스크롤·`새 줄 N개`·`anchor`·`currentMatch`)에는 부르지 않는다.
   * - 바닥에 머문 채 스크롤이 더 와도 한 번만 부른다. 새 줄이 들어온 뒤 다시 바닥에 닿거나, 바닥을 벗어났다 돌아오면 또 부른다.
   * - `따라가기`가 꺼진 정지 조회에서도 조건이 같으면 부른다(무엇을 할지는 호출 측이 정한다).
   */
  onReachBottom?: () => void;
  /**
   * 1 이상이면 하단 가운데 떠 있는 `새 줄 N개` 버튼.
   * N = 자동 스크롤이 멈춘 뒤 들어와 **아직 화면 아래에 있는** 줄 수(호출 측이 센다).
   */
  pendingCount?: number;
  /** `새 줄 N개` 버튼. 컴포넌트가 맨 아래로 즉시 옮기고(부드러운 스크롤 없음), 호출 측은 자동 스크롤을 다시 켠다 */
  onJumpToBottom?: () => void;
  /** 화면 안에서 찾기: 일치 부분 배경 `status.warn.bg`(**글자색은 바꾸지 않는다**) */
  findQuery?: string;
  /**
   * 현재 일치 1건(1px `accent.default` 테두리, logs.md 6.3). `index` 는 그 줄 안에서 몇 번째 일치인가(0부터).
   *
   * **스크롤: 컴포넌트가 직접 한다**(`anchor` 와 같은 방식). 호출 측은 값만 바꾼다 — 본문 DOM 을 읽거나
   * `scrollTop` 을 만지지 않는다(가상 스크롤의 줄 위치는 컴포넌트만 정확히 안다).
   * - `lineId`·`index`·`seq` 중 하나가 **바뀔 때 한 번** 그 일치가 보이게 옮긴다. 이미 다 보이면 움직이지 않는다.
   *   세로는 그 줄을 본문 가운데로, 줄 바꿈이 꺼져 있으면 가로도 그 일치를 보이는 폭 가운데로 옮긴다.
   * - 즉시 이동(부드러운 스크롤 없음), 포커스는 옮기지 않는다. 새 줄이 와도 다시 끌고 가지 않는다.
   * - 자동 스크롤 중(`follow`)에 바닥을 벗어나게 되면 `onFollowBreak` 를 1회 부른다 — 호출 측이 자동 스크롤을 끄지 않으면
   *   다음 새 줄에 바닥으로 되돌아가 찾은 줄을 잃는다. 호출 측이 먼저 꺼 두어도 된다(두 번 불려도 같은 결과).
   * - `seq`: 같은 일치로 **다시** 옮기고 싶을 때 늘린다(일치가 1개뿐인데 `Enter` 를 또 누른 경우 등).
   */
  currentMatch?: { lineId: string; index: number; seq?: number };
  /**
   * (2026-09-25 추가) 그 시각으로 열기 — 앵커(logs.md 7.6, components.md 20.5). 서버 `anchor` 를 바꾸는 것은
   * `logListAnchor(anchor, logAnchorTimeText(anchor.at), formatFullTime(anchor.at))` 가 한다(7.6 표 그대로).
   * - `lineId` 줄의 배경을 `bg.selected` 로 칠하고, 그 줄 위(`above`)·아래(`below`)에 **구분 줄** 1개를 그린다
   *   (20px, `bg.surfaceSunken`, `history` + `label` micro 600). 구분 줄은 `lines` 에 넣지 않는 화면 요소다 —
   *   줄 수·찾기 대상이 아니고, 가상 스크롤 높이에는 20px 로 들어간다.
   * - **첫 화면 스크롤: 컴포넌트가 직접 한다**(`currentMatch` 와 같은 방식). `above` 면 구분 줄 윗변을 본문 높이 1/3
   *   (20px 단위 내림)에, 위에 줄이 모자라면 0 에, `below` 면 구분 줄 아랫변을 본문 아래 끝에 둔다(= 마지막 줄이면 맨 아래).
   *   `lineId`·`placement` 가 **바뀔 때 한 번**만 옮긴다(즉시, 포커스 이동 없음). 그 뒤 사용자 스크롤을 다시 끌고 가지 않는다.
   *   `anchor` 를 뗐다가 다시 주면 다시 옮긴다.
   * - `follow` 와 함께 쓰지 않는다(호출 측이 따라가기를 켜면 `anchor` 를 뗀다). 함께 오면 스크롤은 `follow` 가 맡고
   *   앵커는 표시만 한다.
   * - `lineId` 가 `lines` 에 없으면 아무것도 그리지 않는다(화면이 시각을 비교해 비슷한 줄을 고르지 않는다).
   */
  anchor?: LogListAnchor;
  /** 가림 gutter 버튼. Popover 는 호출 측이 연다 */
  onRedactionClick?: (line: LogLine, anchor: HTMLElement) => void;
  /** px. 파드 상세 `로그` 섹션 안 임베드는 480px(logs.md 9절) */
  height?: number | "auto";
  state?: "ready" | "loading" | "empty";
  /** 결과가 없을 때 한 줄(`LOG_EMPTY`는 오류가 아니다, status.md 13.5) */
  emptyText?: string;
  /** 스크린리더용 영역 이름(`prod / api-7f9c… 컨테이너 api 로그`) */
  caption: string;
  /** 시각에 밀리초를 붙인다(좁은 폭은 false → `14:02:10`) */
  showMillis?: boolean;
  className?: string;
}

const OVERSCAN = 12;
/** `onReachBottom` 판정: 끝에서 이 거리(px) 안쪽이면 "맨 아래에 닿음"(logs.md 7.4) */
const REACH_BOTTOM_PX = 4;

/**
 * **코드가 스크롤을 옮기는 유일한 길.** 자동 스크롤·`새 줄 N개`·`anchor`·`currentMatch` 가 모두 이것을 쓴다.
 * 값은 스크롤 가능 범위로 자르고, **실제로 움직일 때만** "코드가 옮긴 스크롤"로 표시한다.
 * 움직이지 않으면 scroll 이벤트가 오지 않아 표시가 남고, 그러면 그다음 **사용자** 스크롤 1회를 코드 스크롤로
 * 잘못 알아 삼킨다(`End` 키처럼 이벤트가 한 번뿐인 조작에서 `onReachBottom`·`onFollowBreak`를 놓친다).
 */
function moveScroll(el: HTMLElement, to: { top?: number; left?: number }, programmatic: { current: boolean }): boolean {
  const clamp = (v: number, max: number) => Math.min(Math.max(0, Math.round(v)), Math.max(0, max));
  const top = to.top === undefined ? null : clamp(to.top, el.scrollHeight - el.clientHeight);
  const left = to.left === undefined ? null : clamp(to.left, el.scrollWidth - el.clientWidth);
  const nextTop = top !== null && Math.abs(top - el.scrollTop) >= 1 ? top : null;
  const nextLeft = left !== null && Math.abs(left - el.scrollLeft) >= 1 ? left : null;
  if (nextTop === null && nextLeft === null) return false;
  programmatic.current = true;
  if (nextTop !== null) el.scrollTop = nextTop;
  if (nextLeft !== null) el.scrollLeft = nextLeft;
  return true;
}

const matchKeyOf = (m: LogLineListProps["currentMatch"]) =>
  m ? `${m.lineId}\u0000${m.index}\u0000${m.seq ?? 0}` : null;

/**
 * components.md 20.5 / logs.md 7절 / status.md 13.3.
 *
 * - **텍스트로만 렌더한다.** `dangerouslySetInnerHTML` 금지. ANSI·제어문자는 서버가 이미 지워서 온다.
 * - 가림 gutter 는 `position: sticky; left: 0` — **가로로 끝까지 스크롤해도 사라지지 않는다**(AC-LOG07).
 *   그래서 줄은 `width: max-content` 컨테이너 안 **정상 흐름**에 둔다. 줄 상자가 화면 폭만 하면
 *   가로로 스크롤했을 때 상자가 먼저 끝나 sticky 가 풀린다(planner 경고).
 * - 영역은 `role="log" aria-live="off"` — **새 줄을 낭독하지 않는다**(초당 수천 줄).
 * - **브라우저 저장소에 아무것도 쓰지 않는다**(명세 3.3.4). 이 파일에 `localStorage` 가 없어야 한다.
 * - **스크롤을 옮기는 규칙은 하나다**: 호출 측은 값(`follow`·`anchor`·`currentMatch`)만 주고, 옮기는 것은 컴포넌트다.
 *   컴포넌트는 알림(`onFollowBreak`·`onReachBottom`)만 돌려준다. 자동 스크롤을 켜고 끄는 결정은 호출 측이다.
 */
export function LogLineList({
  lines,
  showTimestamp = true,
  wrap = false,
  showPrefix = false,
  follow = false,
  onFollowBreak,
  onReachBottom,
  pendingCount = 0,
  onJumpToBottom,
  findQuery,
  currentMatch,
  anchor,
  onRedactionClick,
  height = 480,
  state = "ready",
  emptyText = "가져온 구간에 로그가 없습니다.",
  caption,
  showMillis = true,
  className,
}: LogLineListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(typeof height === "number" ? height : 480);
  // 보이는 폭 — 구분 줄 문구를 **보이는 폭의** 가운데에 두는 데 쓴다(가로 스크롤해도 문구가 화면 밖으로 가지 않게)
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  // 줄 바꿈이 켜졌을 때만 쓰는 측정 높이 캐시(줄 = 20px × 줄 수). 렌더에서 읽으므로 ref 가 아니라 state 다
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const programmatic = useRef(false);
  const brokeFollow = useRef(false);
  // 마지막으로 `onReachBottom` 을 알렸을 때의 `lines`. 같은 내용의 바닥에서는 두 번 알리지 않는다(null = 알릴 수 있음)
  const reachedFor = useRef<LogLine[] | null>(null);
  // 이미 스크롤로 옮겨 준 앵커·일치(키). 같은 키로는 두 번 옮기지 않는다 — 그 뒤 사용자 스크롤을 끌고 가지 않는다
  const anchorDoneFor = useRef<string | null>(null);
  const matchDoneFor = useRef<string | null>(null);
  // 세로로 옮긴 뒤 줄이 그려지면 가로로 맞출 일치(키)
  const matchLeftPending = useRef<string | null>(null);

  // 본문(스크롤 상자)이 그려져 있는가. 처음에 loading·empty 로 붙었다가 나중에 본문이 생겨도 크기를 다시 잰다
  const ready = state === "ready" && lines.length > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!ready || !el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      setViewport(el.clientHeight || 0);
      setViewportWidth(el.clientWidth || null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // ── 앵커(구분 줄)의 자리 ──
  const anchorLineId = anchor?.lineId;
  const anchorPlacement = anchor?.placement ?? "above";
  const anchorIndex = useMemo(
    () => (anchorLineId ? lines.findIndex((l) => l.id === anchorLineId) : -1),
    [anchorLineId, lines],
  );
  const anchorKey = anchorIndex >= 0 ? `${anchorLineId}\u0000${anchorPlacement}` : null;

  /*
   * 줄 높이 → 오프셋. 줄 바꿈이 꺼져 있으면 높이가 고정이라 측정 캐시를 쓰지 않는다(캐시가 남아 있어도 무시).
   * **구분 줄은 앵커 줄의 칸에 20px 로 더한다** — 칸 = [구분 줄 + 줄](above) 또는 [줄 + 구분 줄](below).
   * 그래서 위·아래 여백 div 가 구분 줄을 늘 포함해, 앵커 줄이 화면 밖에 있어도 스크롤 높이가 어긋나지 않는다.
   */
  const offsets = useMemo(() => {
    const hs = wrap
      ? lines.map((l) => heights.get(l.id) ?? LOG_LINE_HEIGHT)
      : new Array<number>(lines.length).fill(LOG_LINE_HEIGHT);
    if (anchorIndex >= 0) hs[anchorIndex] += LOG_ANCHOR_SEPARATOR_HEIGHT;
    return lineOffsets(hs);
  }, [lines, wrap, heights, anchorIndex]);

  const total = offsets[offsets.length - 1] ?? 0;
  const [start, end] = logVisibleRange(offsets, scrollTop, viewport, OVERSCAN);

  /** i 번째 줄 상자(구분 줄 제외)의 위·아래 — 내용 좌표 */
  const rowBox = useCallback(
    (i: number) => {
      const sepAbove = i === anchorIndex && anchorPlacement === "above" ? LOG_ANCHOR_SEPARATOR_HEIGHT : 0;
      const sepBelow = i === anchorIndex && anchorPlacement === "below" ? LOG_ANCHOR_SEPARATOR_HEIGHT : 0;
      return { top: offsets[i] + sepAbove, bottom: offsets[i + 1] - sepBelow };
    },
    [offsets, anchorIndex, anchorPlacement],
  );

  /*
   * 줄 바꿈일 때만: 그린 줄의 **실제 높이**를 ResizeObserver 로 받아 캐시를 고친다(줄 = 20px × 줄 수).
   * 측정값이 그대로면 state 를 바꾸지 않으므로 금방 멈춘다. 관측기가 없는 환경에서는 20px 추정으로 그린다.
   * 재는 것은 줄 상자(`[data-log-row]`)뿐이다 — 구분 줄은 20px 고정이라 재지 않는다.
   */
  useEffect(() => {
    if (!wrap) return;
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let next: Map<string, number> | null = null;
        for (const entry of entries) {
          const row = entry.target as HTMLElement;
          const id = row.dataset.logRow;
          if (!id) continue;
          const h = Math.max(LOG_LINE_HEIGHT, Math.round(row.offsetHeight));
          if (prev.get(id) !== h) {
            next = next ?? new Map(prev);
            next.set(id, h);
          }
        }
        return next ?? prev;
      });
    });
    el.querySelectorAll<HTMLElement>("[data-log-row]").forEach((row) => ro.observe(row));
    return () => ro.disconnect();
  }, [wrap, lines, start, end]);

  // 자동 스크롤: 새 줄이 오면 맨 아래에 붙인다(부드러운 스크롤 없음 — reduced-motion 과 같은 동작)
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (!el) return;
    moveScroll(el, { top: el.scrollHeight }, programmatic);
    brokeFollow.current = false;
  }, [follow, lines, total]);

  /*
   * 앵커 첫 화면(logs.md 7.6): 키가 바뀔 때 한 번. `above` = 구분 줄 윗변을 1/3 지점에(모자라면 0),
   * `below` = 구분 줄 아랫변을 본문 아래 끝에. 따라가는 중이면 스크롤은 `follow` 몫이다(표시만 한다).
   */
  useEffect(() => {
    if (!anchorKey) {
      anchorDoneFor.current = null;
      return;
    }
    if (follow || !ready || anchorDoneFor.current === anchorKey) return;
    const el = scrollRef.current;
    if (!el) return;
    anchorDoneFor.current = anchorKey;
    const top =
      anchorPlacement === "below"
        ? offsets[anchorIndex + 1] - el.clientHeight
        : anchorScrollTop(offsets[anchorIndex], el.clientHeight);
    moveScroll(el, { top }, programmatic);
  }, [anchorKey, anchorPlacement, anchorIndex, follow, ready, offsets]);

  // ── 현재 일치로 옮기기: 앵커와 같은 방식(키가 바뀔 때 한 번, 즉시, 컴포넌트가 직접) ──
  const matchKey = matchKeyOf(currentMatch);
  const matchLineId = currentMatch?.lineId;
  const matchIndex = useMemo(
    () => (matchLineId ? lines.findIndex((l) => l.id === matchLineId) : -1),
    [matchLineId, lines],
  );

  useEffect(() => {
    if (!matchKey || matchIndex < 0) {
      if (!matchKey) matchDoneFor.current = null;
      return;
    }
    if (!ready || matchDoneFor.current === matchKey) return;
    const el = scrollRef.current;
    if (!el) return;
    matchDoneFor.current = matchKey;
    matchLeftPending.current = matchKey;
    const box = rowBox(matchIndex);
    const visible = box.top >= el.scrollTop && box.bottom <= el.scrollTop + el.clientHeight;
    if (visible) return;
    const top = box.top - el.clientHeight / 2 + (box.bottom - box.top) / 2;
    moveScroll(el, { top }, programmatic);
    // 자동 스크롤 중에 바닥을 벗어났다 — 호출 측이 자동 스크롤을 끄게 한 번 알린다(끄지 않으면 새 줄에 끌려 내려간다)
    if (follow && !brokeFollow.current && el.scrollHeight - el.scrollTop - el.clientHeight > LOG_LINE_HEIGHT) {
      brokeFollow.current = true;
      onFollowBreak?.();
    }
  }, [matchKey, matchIndex, ready, rowBox, follow, onFollowBreak]);

  /*
   * 줄 바꿈이 꺼져 있으면 가로도 맞춘다: 세로로 옮긴 뒤 그 줄이 그려지면(`start`·`end` 가 바뀌면) 현재 일치(`mark`)를
   * 찾아, 보이는 폭(sticky gutter 오른쪽 ~ 오른쪽 끝) 밖이면 가운데로 옮긴다. 아직 안 그려졌으면 다음 렌더에서 다시 본다.
   */
  useEffect(() => {
    if (!matchKey || matchLeftPending.current !== matchKey) return;
    const el = scrollRef.current;
    if (!el) return;
    const mark = el.querySelector<HTMLElement>('mark[data-current="true"]');
    if (!mark) return;
    matchLeftPending.current = null;
    if (wrap) return;
    const box = el.getBoundingClientRect();
    const m = mark.getBoundingClientRect();
    const gutter = el.querySelector<HTMLElement>("[data-gutter]")?.getBoundingClientRect().width ?? LOG_GUTTER_WIDTH;
    const viewLeft = box.left + el.clientLeft + gutter;
    const viewRight = box.left + el.clientLeft + el.clientWidth;
    if (m.left >= viewLeft && m.right <= viewRight) return;
    const markCenter = m.left - (box.left + el.clientLeft) + el.scrollLeft + m.width / 2;
    moveScroll(el, { left: markCenter - gutter - (el.clientWidth - gutter) / 2 }, programmatic);
  }, [matchKey, start, end, wrap]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      setScrollTop(el.scrollTop);
      // 코드가 옮긴 스크롤(자동 스크롤·`새 줄 N개`·앵커·찾기)은 사용자 스크롤이 아니다
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (follow) {
        // 사용자가 위로 스크롤하면 **자동 스크롤만** 푼다(1회만 알린다). 스위치·연결은 호출 측이 그대로 둔다(D2)
        if (!brokeFollow.current && fromBottom > LOG_LINE_HEIGHT) {
          brokeFollow.current = true;
          onFollowBreak?.();
        }
        return;
      }
      /*
       * 자동 스크롤이 꺼진 채 사용자가 맨 아래에 닿음 → 알리기만 한다(logs.md 7.4).
       * 새 줄이 붙어 내용만 길어질 때는 scrollTop 이 그대로라 scroll 이벤트가 오지 않으므로 여기에 들어오지 않는다.
       */
      if (fromBottom <= REACH_BOTTOM_PX) {
        if (reachedFor.current !== lines) {
          reachedFor.current = lines;
          onReachBottom?.();
        }
      } else {
        reachedFor.current = null;
      }
    },
    [follow, lines, onFollowBreak, onReachBottom],
  );

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) moveScroll(el, { top: el.scrollHeight }, programmatic);
    brokeFollow.current = false;
    onJumpToBottom?.();
  };

  const heightCss = typeof height === "number" ? `${height}px` : undefined;
  const bodyClass = cx(styles.body, wrap ? styles.bodyWrap : styles.bodyNoWrap, className);

  if (state === "loading") {
    return (
      <div className={bodyClass} style={{ height: heightCss }} aria-busy="true">
        <span className="sr-only">{caption} 불러오는 중</span>
        <div className={styles.skeletonWrap} aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className={styles.skeletonRow}>
              <Skeleton height={12} width={`${45 + ((i * 13) % 50)}%`} radius="sm" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state === "empty" || lines.length === 0) {
    return (
      <div className={bodyClass} style={{ height: heightCss }} role="log" aria-live="off" aria-label={caption}>
        {/* LOG_EMPTY 는 오류가 아니다(status.md 13.5) — 본문 영역 안 한 줄 */}
        <p className={styles.emptyLine}>{emptyText}</p>
      </div>
    );
  }

  const separator =
    anchor && anchorIndex >= start && anchorIndex < end ? (
      <AnchorSeparator
        key="__anchor-separator__"
        label={anchor.label}
        title={anchor.title}
        placement={anchorPlacement}
      />
    ) : null;

  const rows = [];
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const isAnchor = i === anchorIndex;
    if (isAnchor && anchorPlacement === "above") rows.push(separator);
    rows.push(
      <LogRow
        key={line.id}
        line={line}
        wrap={wrap}
        showTimestamp={showTimestamp}
        showPrefix={showPrefix}
        showMillis={showMillis}
        findQuery={findQuery}
        currentIndex={currentMatch?.lineId === line.id ? currentMatch.index : undefined}
        anchored={isAnchor}
        onRedactionClick={onRedactionClick}
      />,
    );
    if (isAnchor && anchorPlacement === "below") rows.push(separator);
  }

  return (
    <div className={styles.bodyOuter}>
      <div
        ref={scrollRef}
        className={bodyClass}
        // `--log-view-w`: 보이는 폭 — 앵커 구분 줄·특별한 줄 문구를 보이는 영역 가운데에 두는 sticky 상자의 폭(logs.module.css)
        style={
          {
            height: heightCss,
            ...(viewportWidth ? { "--log-view-w": `${viewportWidth}px` } : {}),
          } as CSSProperties
        }
        onScroll={onScroll}
        role="log"
        aria-label={caption}
        /* 새 줄을 낭독하지 않는다. `새 줄 N개` 버튼과 하단 상태 줄만 polite (logs.md 13절) */
        aria-live="off"
        tabIndex={0}
      >
        {/*
          * 가상 스크롤은 **위·아래 여백 div** 로 만든다(줄을 absolute 로 띄우지 않는다).
          * 줄이 정상 흐름에 있어야 `.inner` 의 `max-content` 폭이 **가장 긴 줄** 폭이 되고,
          * 그래야 모든 줄 상자가 스크롤 폭 전체를 덮어 sticky gutter 가 끝까지 붙어 있는다.
          * 구분 줄도 같은 흐름 안의 20px 블록이다(오프셋에 20px 로 들어가 있다).
          */}
        <div className={styles.inner}>
          <div style={{ height: `${offsets[start]}px` }} aria-hidden="true" />
          {rows}
          <div style={{ height: `${Math.max(0, total - offsets[end])}px` }} aria-hidden="true" />
        </div>
      </div>
      {pendingCount > 0 ? (
        <div className={styles.pending} aria-live="polite">
          <Button variant="secondary" size="sm" icon="arrow-down-to-line" onClick={jumpToBottom}>
            새 줄 {pendingCount.toLocaleString("en-US")}개
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 앵커 구분 줄(logs.md 7.6 ①). **로그 줄이 아니다** — `data-log-row` 가 없고(높이를 재지 않는다), 찾기 대상도 아니다.
 * 문구는 로그 영역 안 텍스트라 읽는 순서대로 낭독된다(`aria-live` 는 영역 그대로 off).
 * 줄 바꿈이 꺼져 가로로 스크롤돼도 문구가 화면 밖으로 가지 않게, 문구 상자를 **보이는 폭만큼** sticky 로 붙인다.
 */
function AnchorSeparator({
  label,
  title,
  placement,
}: {
  label: string;
  title?: string;
  placement: "above" | "below";
}) {
  return (
    <div className={styles.anchorSeparator} data-anchor-separator={placement}>
      {/* 폭은 CSS `--log-view-w`(보이는 폭). 특별한 줄 본문과 같은 값을 쓴다 */}
      <span className={styles.anchorSticky}>
        <Tooltip content={title} className={styles.anchorLabel}>
          <Icon name="history" size={12} className={styles.anchorIcon} />
          <span className={styles.anchorText}>{label}</span>
        </Tooltip>
      </span>
    </div>
  );
}

interface LogRowProps {
  line: LogLine;
  wrap: boolean;
  showTimestamp: boolean;
  showPrefix: boolean;
  showMillis: boolean;
  findQuery?: string;
  currentIndex?: number;
  /** 앵커 줄(logs.md 7.6): 배경 `bg.selected`, hover 해도 그대로. 글자색·gutter 는 그대로 */
  anchored?: boolean;
  onRedactionClick?: (line: LogLine, anchor: HTMLElement) => void;
}

function LogRow({
  line,
  wrap,
  showTimestamp,
  showPrefix,
  showMillis,
  findQuery,
  currentIndex,
  anchored = false,
  onRedactionClick,
}: LogRowProps) {
  const masked = maskedCount(line);
  const notice = isNoticeLine(line.kind);
  // 전체 폭 한 줄짜리(생략·링버퍼 위쪽·구간 없음) — 문구를 보이는 본문 영역 가운데에(logs.md 7.2)
  const band = isFullWidthNotice(line.kind);
  const tail = truncatedTail(line);
  const gutterRef = useRef<HTMLSpanElement | null>(null);
  let hit = -1;

  const renderText = (text: string, key: string) => {
    if (!findQuery) return text;
    return splitByMatches(text, findQuery).map((part, i) => {
      if (!part.hit) return <span key={`${key}-${i}`}>{part.text}</span>;
      hit += 1;
      return (
        <mark
          key={`${key}-${i}`}
          className={cx(styles.hit, currentIndex === hit && styles.hitCurrent)}
          data-current={currentIndex === hit ? "true" : undefined}
        >
          {part.text}
        </mark>
      );
    });
  };

  const cells = (
    <>
      {showTimestamp ? (
        <span className={styles.time}>{line.at ? formatLogTime(line.at, showMillis) : ""}</span>
      ) : null}
      {showPrefix ? <span className={styles.prefix}>{prefixText(line) ?? ""}</span> : null}
      <span className={cx(styles.text, wrap && styles.textWrap)}>
        <span className="sr-only">{masked > 0 ? `가려진 값 ${masked}개, ` : ""}</span>
        {notice ? (
          <span className={styles.noticeText}>
            {line.kind === "redactFailed" ? <Icon name="triangle-alert" size={12} className={styles.noticeIcon} /> : null}
            <span className={styles.noticeLabel}>{noticeText(line)}</span>
          </span>
        ) : (
          line.segments.map((seg, i) =>
            seg.t === "masked" ? (
              <MaskedValue key={i} variant="inline" text={seg.v} />
            ) : (
              <span key={i}>{renderText(seg.v, String(i))}</span>
            ),
          )
        )}
        {tail ? <span className={styles.truncated}>{tail}</span> : null}
      </span>
    </>
  );

  return (
    <div
      className={cx(
        styles.row,
        notice && styles.rowNotice,
        band && styles.rowBand,
        anchored && styles.rowAnchor,
        line.kind === "redactFailed" && styles.rowRedactFailed,
      )}
      data-log-row={line.id}
      data-kind={line.kind}
      data-anchor={anchored ? "true" : undefined}
    >
      {/*
       * 가림 표식 gutter: `position: sticky; left: 0`.
       * 줄 바꿈을 끄고 가로로 끝까지 스크롤해도 **사라지지 않는다**(AC-LOG07).
       * 가려진 값이 있다는 사실이 스크롤 위치에 따라 보였다 안 보였다 하면 안 된다.
       */}
      <span className={styles.gutter} data-gutter="true" ref={gutterRef}>
        {masked > 0 ? (
          <Chip
            label={String(masked)}
            icon="eye-off"
            size="sm"
            ariaLabel={`가려진 값 ${masked}개, 규칙 보기`}
            className={styles.gutterChip}
            // 팝오버는 호출 측이 연다(컴포넌트는 앵커 요소만 넘긴다)
            onClick={onRedactionClick ? () => onRedactionClick(line, gutterRef.current as HTMLElement) : undefined}
          />
        ) : null}
      </span>
      {band ? (
        /*
         * 전체 폭 한 줄짜리 특별한 줄(logs.md 7.2): 시각·접두·문구를 **보이는 폭만큼의 sticky 상자**에 넣는다 —
         * 가로로 끝까지 스크롤해도 문구가 보이는 본문 영역 가운데에 남는다(앵커 구분 줄과 같은 방식).
         * 스크롤 0 에서는 종전과 같은 모양이다. `binary`·`redactFailed` 는 한 줄을 대신하는 줄이라 본문 흐름 그대로다.
         */
        <span className={styles.noticeBody} data-notice-body="true">
          {cells}
        </span>
      ) : (
        cells
      )}
    </div>
  );
}
