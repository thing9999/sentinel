"use client";

/**
 * 로그 뷰어 (docs/design/logs.md 2~8절). `/logs`와 파드 상세가 **같은 컴포넌트**를 쓴다(화면이 두 벌이 되지 않게).
 *
 * 화면이 하지 않는 것(계약 12절):
 * - 출처 이름으로 능력을 **추론하지 않는다** — `capabilities`·`chips`·`limitations`를 그대로 쓴다.
 * - 본문을 **파싱하지 않는다** — `segments[]`를 `LogLineList`에 그대로 넘긴다.
 * - 파드가 살아 있는지 **판단하지 않는다** — `pod.exists`·`deletedAt`가 서버 값이다.
 * - 출처를 **자동 전환하지 않는다** — `LOG_BACKEND_UNAVAILABLE`이어도 사용자가 눌러야 바뀐다.
 * - 안내 코드를 문구로 **번역하지 않는다** — `notice.text`를 그대로 쓴다(서버 코드가 없는 링버퍼 멈춤과, 화면 동작인
 *   `직접 조회로 전환` 버튼의 설명 한 줄만 예외).
 * - **시각을 비교하지 않는다** — `at`은 `anchorAt`으로 넘기고 서버의 `anchor`·`LOG_ANCHOR_*`만 쓴다(계약 2.2.1).
 * - 로그를 `localStorage`·URL에 넣지 않는다(찾기 입력값 포함).
 *
 * `따라가기` 스위치 = 연결, 자동 스크롤 = 화면 동작(디자인 7.4, PM 결정 D2). **연결이 닫히면 이유와 상관없이
 * 스위치는 꺼지고**, 받은 줄은 그대로 두며, 닫을 수 없는 멈춤 안내가 이유를 말한다(PM "작은 것 4건").
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import {
  Button,
  Chip,
  CollapsibleNotice,
  EmptyState,
  InlineAlert,
  LogLineList,
  RedactionNotice,
  SearchInput,
  SegmentedControl,
  Select,
  Switch,
  UnknownState,
  formatCount,
  formatFullTime,
  logAnchorTimeText,
  logListAnchor,
  type LogLine,
} from "@/components/ui";
import { apiFetch, isApiError } from "@/lib/api";

import { useMediaQuery } from "../common/hooks";

import { collectMatches, stepIndex } from "./find";
import type { WorkloadRef } from "./href";
import { RedactionRulesPopover, redactionTargetAt, type RedactionTarget } from "./RedactionRulesPopover";
import styles from "./logs.module.css";
import type {
  LogAnchor,
  LogCapabilitiesResponse,
  LogNotice,
  LogQueryRequest,
  LogQueryResponse,
  LogSelector,
  LogSourceId,
  LogTargetsResponse,
} from "./types";
import { CONTAINER_NOT_STARTED, ringLimitText, useLogStream, type LogHalt } from "./useLogStream";

/** 무엇을 보나. `direct`는 언제나 파드 하나, `stack`(합쳐보기 능력)은 여러 파드·워크로드도 된다(계약 1.4) */
export interface LogTarget {
  namespace: string | null;
  /** 단일 파드 */
  pod: string | null;
  /** stack 합쳐보기 — 사용자가 고른 파드(2개 이상) */
  pods?: string[] | null;
  /** stack 워크로드 합쳐보기 — **서버가** 소속 파드로 푼다(`selector.resolvedPods`) */
  workload?: WorkloadRef | null;
}

export interface LogViewerProps {
  capabilities: LogCapabilitiesResponse;
  target: LogTarget;
  targets: LogTargetsResponse | undefined;
  targetsLoading: boolean;
  container: string | null;
  onContainerChange: (container: string) => void;
  previous: boolean;
  onPreviousChange: (previous: boolean) => void;
  source: LogSourceId;
  onSourceChange: (source: LogSourceId) => void;
  followDefault?: boolean;
  onFollowChange?: (follow: boolean) => void;
  /** 링크의 `at`(알림·Warning 이벤트, 계약 2.2.1). 있으면 따라가기를 끈 채 `anchorAt`으로 정지 조회한다 */
  at?: string | null;
  /** `그 시각` 칩의 `x`, 또는 따라가기를 켰을 때 — URL 에서 `at`을 뗀다(디자인 7.6 ②·④) */
  onAtClear?: () => void;
  /** stack 이 실제로 합쳐 본 파드(`selector.resolvedPods`). 파드 선택기를 채운다 */
  onResolvedPods?: (pods: string[] | null) => void;
  /** `LOG_PODS_CLAMPED`의 `파드 고르기` — 파드 선택기로 포커스를 옮긴다(디자인 8.7) */
  onPickPods?: () => void;
  /**
   * 본문 높이. 파드 상세 임베드는 480px 고정(디자인 9절).
   * `"fill"`이면 **화면에 남은 높이, 최소 360px**(디자인 2절 `/logs`) — 위 영역은 스크롤 밖에 두고 본문만 스크롤한다.
   */
  height?: number | "fill";
  /** 파드가 정해져 있지 않을 때 그리는 안내 */
  placeholder?: string;
}

const NARROW_QUERY = "(max-width: 1023px)";
/** `/logs` 본문 최소 높이 (디자인 2절) */
const FILL_MIN_HEIGHT = 360;
/** 첫 측정 전 높이(종전 고정값). 측정은 다음 프레임에 바로 온다 */
const FILL_INITIAL_HEIGHT = 520;
/** 기간 Select 의 "서버가 고른 기간" 칸 (앵커 중, 사용자가 기간을 고르기 전 — 디자인 7.6 ②) */
const ANCHOR_RANGE = "__anchor__";
/** 멈춤 안내에 따로 자리를 잡는 코드 — 일반 안내 줄로 한 번 더 그리지 않는다 */
const ANCHOR_BEFORE = "LOG_ANCHOR_BEFORE_RESULT";
const ANCHOR_AFTER = "LOG_ANCHOR_AFTER_RESULT";
const PODS_CLAMPED = "LOG_PODS_CLAMPED";
const WORKLOAD_NO_PODS = "LOG_WORKLOAD_NO_PODS";
/**
 * 숫자가 **하단 상태 줄에 이미 있는** 안내 — 안내 줄로 다시 그리지 않는다(디자인 7.5, designer "추가 4" E3).
 * 따라가기 중에는 상태 줄 숫자가 늘고 조회 때 받은 안내 숫자는 멈춰 있어, 같은 화면에 다른 숫자 두 개가 된다.
 */
const COUNTED_IN_STATUS_LINE = ["LOG_REDACTED", "LOG_DROPPED_LINES"];
/**
 * 조회 성공·줄 0개(계약 6절 `LOG_EMPTY`) — 오류가 아니라 **본문 한 줄**만이다(디자인 8.1). 안내 줄로 한 번 더 그리지 않는다
 * (PM 결정 RL14, 2026-09-25 — 같은 말을 두 곳에서 하지 않는다. `COUNTED_IN_STATUS_LINE`과 같은 결).
 */
const LOG_EMPTY = "LOG_EMPTY";
/**
 * 출처 실패 안내의 `직접 조회로 전환` 아래 한 줄 — 전환은 능력이 줄어드는 선택이라 무엇을 잃는지 적는다(디자인 8.4).
 * 버튼을 그릴지는 서버 `details.fallbackSource`가 정한다(화면이 코드로 고르지 않는다).
 */
const FALLBACK_DESCRIPTION = "직접 조회로 바꾸면 지난 로그 검색과 기간 선택을 쓸 수 없습니다.";

/**
 * `/logs` 본문 높이 = 창 높이 − 본문 위쪽 위치 − 본문 아래(상태 줄·페이지 아래 여백), **최소 360px**(디자인 2절).
 * 위 영역(가림 경고·한계 블록·안내 줄)이 접히거나 늘면 본문 위치가 바뀌므로 뷰어와 문서 크기를 함께 지켜본다.
 * 값이 같으면 state 를 바꾸지 않아 측정이 금방 멈춘다.
 */
function useFillHeight(
  enabled: boolean,
  rootRef: RefObject<HTMLElement | null>,
  bodyRef: RefObject<HTMLElement | null>,
  afterRef: RefObject<HTMLElement | null>,
): number {
  const [height, setHeight] = useState(FILL_INITIAL_HEIGHT);
  useEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!enabled || !root || !body || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rect = body.getBoundingClientRect();
      const after = afterRef.current?.getBoundingClientRect();
      const below = after ? Math.max(0, after.bottom - rect.bottom) : 0;
      const main = body.closest("main");
      const pad = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const top = rect.top + window.scrollY;
      const next = Math.max(FILL_MIN_HEIGHT, Math.floor(window.innerHeight - top - below - pad));
      setHeight((prev) => (prev === next ? prev : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [enabled, rootRef, bodyRef, afterRef]);
  return height;
}

/** 멈춤 안내의 모양 (디자인 7.4 표). 계획된 멈춤은 info, 예상 밖 끊김·시작 실패는 warn */
export function haltTone(kind: LogHalt["kind"]): "info" | "warn" {
  return kind === "idle" || kind === "max" || kind === "ring" ? "info" : "warn";
}

/**
 * 요청 셀렉터 (계약 1.4). `direct`는 파드 하나만(`pods`·`workload`는 400).
 * stack: 워크로드를 골랐고 파드를 따로 고르지 않았으면 `workload` → 서버가 푼다. 여러 파드를 골랐으면 `pods`.
 */
export function buildSelector(
  target: LogTarget,
  multiPod: boolean,
  container: string | null,
  previous: boolean,
): LogSelector | null {
  const { namespace } = target;
  if (!namespace) return null;
  if (multiPod && target.pods && target.pods.length > 1) return { namespace, pods: target.pods };
  if (multiPod && target.workload && !target.pod) {
    return { namespace, workload: { kind: target.workload.kind, name: target.workload.name } };
  }
  if (!target.pod || !container) return null;
  return { namespace, pod: target.pod, container, previous };
}

export function LogViewer({
  capabilities,
  target,
  targets,
  targetsLoading,
  container,
  onContainerChange,
  previous,
  onPreviousChange,
  source,
  onSourceChange,
  followDefault = false,
  onFollowChange,
  at = null,
  onAtClear,
  onResolvedPods,
  onPickPods,
  height = 480,
  placeholder = "파드를 고르면 로그를 보여 줍니다.",
}: LogViewerProps) {
  const sourceInfo = capabilities.sources.find((s) => s.id === source) ?? null;
  const caps = sourceInfo?.capabilities ?? null;
  const limits = capabilities.limits;
  const multiPod = Boolean(caps?.multiPod);
  const multiView = multiPod && (Boolean(target.pods && target.pods.length > 1) || Boolean(target.workload && !target.pod));

  const rangeOptions = caps?.rangeOptions ?? [];
  /** 사용자가 고른 기간. `null`이면 **서버가 준 선택지**의 기본값을 쓴다(화면이 목록을 갖지 않는다) */
  const [rangeChoice, setRangeChoice] = useState<string | null>(null);
  const [lineLimit, setLineLimit] = useState<number>(limits.defaultLines);
  // `at`(그 시각)으로 열리면 따라가기를 끈 채 연다(D3·Q12). 링크에 `follow`와 `at`이 함께 오지 않는다
  const [follow, setFollow] = useState(followDefault && !at);
  /** `null`이면 폭을 따른다(좁은 폭 <1024px 은 기본 켬, 디자인 12절). 사용자가 만지면 그 값이 이긴다 */
  const [wrapChoice, setWrapChoice] = useState<boolean | null>(null);
  const [showTimestamp, setShowTimestamp] = useState(true);
  /** `seq`: 같은 일치로 **다시** 가려면 늘린다(일치가 1개뿐인데 `Enter`를 또 누른 경우) — 스크롤은 `LogLineList`가 한다 */
  const [findState, setFindState] = useState<{ query: string; index: number; seq: number }>({ query: "", index: 0, seq: 0 });
  const [redaction, setRedaction] = useState<RedactionTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** 사용자가 위로 스크롤한 시점의 줄 수. `null`이면 바닥에 붙어 있다(자동 스크롤 중) */
  const [scrollAnchor, setScrollAnchor] = useState<number | null>(null);
  const [queryResult, setQueryResult] = useState<{
    key: string;
    anchor?: LogAnchor | null;
    error?: { code: string; text: string };
  } | null>(null);
  /** 연결이 닫힌 이유(사용자가 끈 경우 제외). `tag` = 그때의 조회 키 */
  const [halt, setHalt] = useState<LogHalt | null>(null);
  /** 멈춘 뒤 받은 줄을 지킬 조회 키 — 이 키로는 정지 조회로 다시 읽어 오지 않는다(디자인 7.4 "받은 줄은 지우지 않는다") */
  const [keepKey, setKeepKey] = useState<string | null>(null);
  /** 앵커 안내의 바로가기 버튼으로 다시 조회했는가 — 그때만 새 안내를 낭독한다(디자인 7.6 ⑤) */
  const [anchorRetried, setAnchorRetried] = useState(false);

  const stream = useLogStream({
    // 위로 올려 읽는 중(자동 스크롤 멈춤)에 링버퍼가 차면 버리지 않고 멈춘다(Q13, AC-LOG51)
    hold: follow && scrollAnchor !== null,
    onHalt: (h) => {
      setHalt(h);
      setKeepKey(h.tag);
      // 스위치 = 연결 — 연결이 닫혔으니 끈다. 받은 줄과 `새 줄 N개`(받아 둔 줄 끝으로 가는 길)는 그대로 둔다
      setFollow(false);
      onFollowChange?.(false);
    },
    onResolvedPods: (pods) => onResolvedPods?.(pods),
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const rangeRef = useRef<HTMLSpanElement | null>(null);
  const fillHeight = useFillHeight(height === "fill", rootRef, bodyRef, statusRef);
  const bodyHeight = height === "fill" ? fillHeight : height;

  const narrow = useMediaQuery(NARROW_QUERY, false);
  const wrap = wrapChoice ?? narrow;
  const find = findState.query;

  const anchorOn = Boolean(at) && !follow;
  /** 앵커 중이고 사용자가 기간을 고르기 전이면 **`range`를 보내지 않는다** — 서버가 출처에 맞게 고른다(2.2.1-1) */
  const serverRange = anchorOn && rangeChoice === null;
  const defaultRangeId = rangeOptions.find((o) => o.id === "15m")?.id ?? rangeOptions[0]?.id ?? "";
  const rangeId = rangeOptions.some((o) => o.id === rangeChoice) ? (rangeChoice as string) : defaultRangeId;
  const range = rangeOptions.find((o) => o.id === rangeId) ?? null;
  const podGone = !multiView && targets?.pod.exists === false;
  const selector = buildSelector(target, multiPod, multiView ? null : container, previous);
  const ready = Boolean(selector && (range || serverRange) && capabilities.enabled && !podGone);

  // 값 계산이라 메모하지 않는다 — 실제 재조회 기준은 아래 `requestKey` **문자열**이다(객체 identity 가 아니다)
  const request: LogQueryRequest | null =
    selector && (range || serverRange)
      ? {
          source,
          selector,
          ...(serverRange || !range ? {} : { range: range.sec === null ? { whole: true } : { sinceSec: range.sec } }),
          limit: lineLimit,
          ...(anchorOn && at ? { anchorAt: at } : {}),
        }
      : null;

  const requestKey = request && ready ? `${reloadKey}|${JSON.stringify(request)}` : "";
  const setLines = stream.setLines;
  const startStream = stream.start;
  const stopStream = stream.stop;

  // 따라가기면 전용 스트림, 아니면 정지 조회. 자동 새로고침은 없다(사용자가 `새로고침`을 누른다)
  useEffect(() => {
    if (!requestKey) return;
    const req = JSON.parse(requestKey.slice(requestKey.indexOf("|") + 1)) as LogQueryRequest;
    if (follow) {
      // 스트림에 `anchorAt`을 보내면 400 — 따라가기와 앵커는 함께 쓰지 않는다(계약 2.3.1)
      const streamReq: LogQueryRequest = { ...req };
      delete streamReq.anchorAt;
      startStream(streamReq, requestKey);
      return () => stopStream();
    }
    // 연결이 닫혀 멈춘 조회: 받은 줄을 그대로 두고 다시 읽지 않는다
    if (keepKey === requestKey) return;
    stopStream();
    const ac = new AbortController();
    apiFetch<LogQueryResponse>("/logs/query", { method: "POST", body: req, signal: ac.signal })
      .then((r) => {
        setLines(r.lines, r.notices ?? [], r.stats?.redactedCount ?? 0, r.stats?.droppedLines ?? 0);
        setQueryResult({ key: requestKey, anchor: r.anchor ?? null });
        onResolvedPods?.(r.selector?.resolvedPods ?? null);
      })
      .catch((e: unknown) => {
        if (isApiError(e) && e.kind === "aborted") return;
        const body = isApiError(e) && e.kind === "http" ? (e.body as { code?: string; message?: string }) : null;
        setLines([], [], 0, 0);
        setQueryResult({
          key: requestKey,
          error: { code: body?.code ?? "LOG_QUERY_FAILED", text: body?.message ?? "로그를 불러오지 못했습니다." },
        });
      });
    return () => ac.abort();
    // onResolvedPods 는 부모의 setState 래퍼라 조회를 다시 일으키지 않게 뺐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, follow, keepKey, startStream, stopStream, setLines]);

  const queryLoading = Boolean(requestKey) && !follow && keepKey !== requestKey && queryResult?.key !== requestKey;
  const queryError = queryResult?.key === requestKey ? (queryResult.error ?? null) : null;
  /**
   * 서버가 지목한 "그 시각"의 줄(계약 2.2.1). **표시(구분 줄·강조·1/3 스크롤)는 `LogLineList.anchor`가 한다** —
   * publisher 가 만드는 중이라 prop 배선은 그 뒤에 한다(PM 지시). 데이터는 여기까지 준비돼 있다.
   */
  const anchor = anchorOn && queryResult?.key === requestKey ? (queryResult.anchor ?? null) : null;
  // 계약 2.2.1 → 컴포넌트 prop(디자인 7.6 표는 `logListAnchor`가 옮긴다). 시각은 `anchor.at`, 없으면 요청한 `at`
  const anchorAtText = anchor?.at ?? at;
  const listAnchor =
    anchor && anchorAtText ? logListAnchor(anchor, logAnchorTimeText(anchorAtText), formatFullTime(anchorAtText)) : undefined;
  const shownHalt = halt && halt.tag === requestKey ? halt : null;

  const lines = stream.state.lines;

  const displayLines: LogLine[] = useMemo(() => {
    if (!stream.state.trimmed) return lines;
    // 링버퍼 위쪽 표시는 **화면이 만드는 줄**이다(서버는 보내지 않는다, 계약 1.2)
    const top: LogLine = { id: "__ring_top__", kind: "ringTop", segments: [] };
    return [top, ...lines];
  }, [lines, stream.state.trimmed]);

  // 화면 안에서 찾기 — `serverSearch`가 false 인 출처에는 **검색을 보내지 않는다**(보내면 400)
  const matches = useMemo(() => collectMatches(displayLines, find), [displayLines, find]);

  const totalMatches = matches.length;
  const matchIndex = totalMatches > 0 ? findState.index % totalMatches : 0;
  const current = totalMatches > 0 ? { ...matches[matchIndex], seq: findState.seq } : undefined;

  /*
   * 찾은 줄로 옮기는 것(세로·가로)은 **`LogLineList`가 `currentMatch`로 직접** 한다(publisher 07:15, K1).
   * 통합 2차의 `revealLine`(본문 DOM 을 읽던 우회)과 "따라가기 중이면 자동 스크롤을 먼저 푸는" 우회는 지웠다 —
   * 컴포넌트가 바닥을 벗어나면 `onFollowBreak`를 부르고, 코드 스크롤 표시 누수는 06:50 에 고쳐졌다.
   */
  const stepMatch = (delta: number) => {
    if (totalMatches === 0) return;
    const next = stepIndex(matchIndex, delta, totalMatches);
    setFindState((f) => ({ ...f, index: next, seq: f.seq + 1 }));
  };

  /** 찾기 입력값은 `useState`에만 있다 — URL·저장소에 남기지 않는다(명세 3.3.4) */
  const setQuery = (q: string) => {
    if (q === find) return;
    setFindState((f) => ({ query: q, index: 0, seq: f.seq + 1 }));
  };

  /**
   * `Enter` = 다음 일치, `Shift+Enter` = 이전 일치(디자인 12절). 한글 조합 중의 `Enter`는 글자 확정이라 건드리지 않는다.
   * 입력은 200ms 늦게 반영되므로(디바운스) 치자마자 누른 `Enter`는 **지금 입력칸의 값**으로 첫 일치부터 찾는다.
   */
  const onFindKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const value = e.currentTarget.value;
    if (value !== find) {
      setQuery(value);
      return;
    }
    stepMatch(e.shiftKey ? -1 : 1);
  };

  const autoScroll = scrollAnchor === null;
  const pendingCount = scrollAnchor === null ? 0 : Math.max(0, lines.length - scrollAnchor);

  // 연결은 그대로 두고 **자동 스크롤만** 푼다(읽던 자리를 잃지 않게). 다시 붙는 것은 버튼으로만
  const onFollowBreak = () => setScrollAnchor((cur) => cur ?? lines.length);
  // 맨 아래에 **직접** 닿으면 N만 0으로 — 자동 스크롤은 켜지 않는다(디자인 7.4, publisher 06:50 `onReachBottom`)
  const onReachBottom = () => setScrollAnchor((cur) => (cur === null ? cur : lines.length));
  const jumpToBottom = () => setScrollAnchor(null);

  /**
   * 따라가기 켬 = 새 연결 + 맨 아래 + 자동 스크롤(`다시 시작`과 같다, PM "작은 것 4건" 2).
   * 앵커가 있으면 **푼다** — URL 에서 `at`을 떼고 스트림에는 `anchorAt`을 보내지 않는다(디자인 7.6 ④).
   */
  const startFollowing = () => {
    setHalt(null);
    setKeepKey(null);
    setScrollAnchor(null);
    setFollow(true);
    onFollowChange?.(true);
    if (at) onAtClear?.();
  };

  const setFollowSwitch = (v: boolean) => {
    if (v) {
      startFollowing();
      return;
    }
    // 사용자가 끔 — 서버가 연결을 닫고 정지 조회로 바뀐다(7.4)
    setHalt(null);
    setKeepKey(null);
    setFollow(false);
    setScrollAnchor(null);
    onFollowChange?.(false);
  };

  /** `다시 시작` / `다시 시도` */
  const resume = () => {
    startFollowing();
    setReloadKey((n) => n + 1);
  };

  /** 앵커 안내의 바로가기 — **조회를 한 번 더 할 뿐**(쓰기 없음), `anchorAt`은 그대로 보낸다(디자인 7.6 ③) */
  const nextLineOption = limits.lineOptions.find((n) => n > lineLimit) ?? null;
  const suggestAction = (n: LogNotice) => {
    const suggest = (n.details?.suggest as string | null | undefined) ?? null;
    if (suggest === "more_lines" && nextLineOption !== null) {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setAnchorRetried(true);
            setLineLimit(nextLineOption);
          }}
        >
          {`${formatCount(nextLineOption)}줄로 다시 조회`}
        </Button>
      );
    }
    if (suggest === "previous" && caps?.previousGeneration) {
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setAnchorRetried(true);
            onPreviousChange(true);
          }}
        >
          이전 세대로 다시 조회
        </Button>
      );
    }
    if (suggest === "range") {
      // 기간을 **대신 고르지 않는다** — 같은 `range`가 "넓혀라"일 때도 "좁혀라"일 때도 있다(디자인 7.6 ③)
      return (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const el = rangeRef.current?.querySelector("select");
            if (!el) return;
            el.focus();
            try {
              (el as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
            } catch {
              /* 포커스만으로도 키보드로 열 수 있다 */
            }
          }}
        >
          기간 고르기
        </Button>
      );
    }
    return undefined;
  };

  // ---- 그리기 ----------------------------------------------------------------

  if (!capabilities.enabled) {
    return (
      <UnknownState
        size="lg"
        title="로그 조회가 꺼져 있습니다"
        hint="LOGS_ENABLED=true로 켜세요. 클러스터 안에 배포한 경우 기본값이 false입니다 — 인증 없는 대시보드에서 로그는 같은 네트워크의 누구에게나 열립니다."
      />
    );
  }

  const containerOptions = multiView ? [] : (targets?.containers ?? []).filter((c) => !c.init);
  const initContainers = multiView ? [] : (targets?.containers ?? []).filter((c) => c.init);
  const allNotices: LogNotice[] = [...(multiView ? [] : (targets?.notices ?? [])), ...stream.state.notices];
  const anchorNotices = allNotices.filter((n) => n.code === ANCHOR_BEFORE || n.code === ANCHOR_AFTER);
  const clampedNotice = allNotices.find((n) => n.code === PODS_CLAMPED) ?? null;
  const noPodsNotice = allNotices.find((n) => n.code === WORKLOAD_NO_PODS) ?? null;
  const notStartedNotice = allNotices.find((n) => n.code === CONTAINER_NOT_STARTED) ?? null;
  /**
   * 시작 전 대기(디자인 7.4 "시작 전 대기 안내") — 연결이 **살아 있다**(서버가 기다린다). 멈춤 안내가 아니라 `다시 시작`이 없고
   * 스위치는 켜진 채다. 기다리는 중 유휴·30분에 걸리면 멈춤 안내로 **바뀐다**(같이 그리지 않는다).
   * 정지 조회에서는 8.1 본문 한 줄이다(서버 문구 그대로 — 자동 재조회를 약속하지 않는 문구가 온다).
   */
  const waitNotice = follow && !shownHalt ? notStartedNotice : null;
  const notStartedLine = !follow && !shownHalt ? notStartedNotice : null;
  const plainNotices = allNotices.filter(
    (n) =>
      ![ANCHOR_BEFORE, ANCHOR_AFTER, PODS_CLAMPED, WORKLOAD_NO_PODS, CONTAINER_NOT_STARTED, LOG_EMPTY, ...COUNTED_IN_STATUS_LINE].includes(
        n.code,
      ) &&
      // 같은 코드의 `log.notice` 뒤에 `log.closing`이 오면 멈춤 안내 하나만 (디자인 7.4)
      n.code !== shownHalt?.code,
  );
  /** 줄 0개의 이유를 조회·스트림 안내(warn)가 이미 말한다 → 본문을 비운다(디자인 8.4 "본문 영역은 비운다"). 대상 안내(노드 미보고)는 세지 않는다 */
  const failedEmpty = stream.state.notices.some((n) => n.level === "warn" || n.level === "error");
  const streamsInfo = stream.state.streams ?? capabilities.streams;
  const hasTarget = Boolean(target.namespace && (target.pod || (multiPod && (target.workload || target.pods?.length))));
  const caption = multiView
    ? `${target.namespace} / ${target.workload ? target.workload.name : `${target.pods?.length ?? 0}개 파드`} 합쳐 본 로그`
    : `${target.namespace} / ${target.pod}${container ? ` 컨테이너 ${container}` : ""} 로그`;
  const failedNoPods = shownHalt?.kind === "failed" && shownHalt.code === WORKLOAD_NO_PODS;
  const emptyText = failedNoPods
    ? shownHalt.text
    : noPodsNotice
      ? noPodsNotice.text
      : notStartedLine
        ? notStartedLine.text
        : waitNotice || failedEmpty
          ? ""
          : shownHalt?.kind === "failed"
            ? "로그 연결을 열지 못했습니다. 위 안내를 확인하세요."
            : "이 컨테이너가 아직 아무것도 출력하지 않았습니다.";

  return (
    <div className="stack-sm" ref={rootRef}>
      {/* 닫을 수 없는 가림 경고 — 로그 본문이 보이는 **모든 자리**에 (AC-LOG08) */}
      <RedactionNotice />

      {/* 출처 줄: 비활성 칸도 목록에 남기고 사유를 툴팁으로 (있는데 못 보는 것과 없는 것은 다르다) */}
      <div className={styles.sourceRow}>
        <SegmentedControl
          label="로그 출처"
          value={source}
          onChange={(v) => onSourceChange(v as LogSourceId)}
          options={capabilities.sources
            .slice()
            .reverse()
            .map((s) => ({
              value: s.id,
              label: s.productLabel ? `${s.label} (${s.productLabel})` : s.label,
              disabled: !s.selectable,
              disabledReason: s.disabledReason ?? s.tooltip ?? undefined,
            }))}
        />
        {(sourceInfo?.chips ?? []).map((c) => (
          <Chip key={c.id} size="sm" tone="neutral" label={c.label} />
        ))}
      </div>

      {/* 한계 블록: `direct`에만. 서버가 준 summary·lines 를 그대로 (접기만 있고 닫기는 없다) */}
      {sourceInfo?.limitations ? (
        <CollapsibleNotice
          tone="neutral"
          icon="info"
          label="직접 조회 한계"
          summary={sourceInfo.limitations.summary}
          lines={sourceInfo.limitations.lines.map((l) => (
            <span key={l.code}>
              {l.text}
              {l.hint ? <span className={styles.limitHint}>{` ${l.hint}`}</span> : null}
            </span>
          ))}
        />
      ) : null}

      {/* 대상 선택: 컨테이너 칩 (1개면 숨긴다) + init 그룹. 합쳐보기에서는 줄마다 파드·컨테이너가 붙는다 */}
      {containerOptions.length > 1 || initContainers.length > 0 ? (
        <div className={styles.targetRow}>
          {containerOptions.length > 1 ? (
            narrow || containerOptions.length > 5 ? (
              <Select
                label="컨테이너"
                width={220}
                value={container ?? ""}
                onChange={onContainerChange}
                options={containerOptions.map((c) => ({
                  value: c.name,
                  label: c.name,
                  count: c.restarts.total > 0 ? c.restarts.total : undefined,
                }))}
              />
            ) : (
              <SegmentedControl
                label="컨테이너"
                value={container ?? ""}
                onChange={onContainerChange}
                options={containerOptions.map((c) => ({
                  value: c.name,
                  label: c.name,
                  // `CrashLoopBackOff` 같은 사유는 **툴팁**이다(디자인 5절).
                  // `disabledReason`으로 주면 `SegmentedControl`이 그 칸을 **고를 수 없게** 만든다
                  tooltip: c.waitingReason ?? undefined,
                  count: c.restarts.total > 0 ? c.restarts.total : undefined,
                }))}
              />
            )
          ) : null}
          {initContainers.length > 0 ? (
            <>
              <Chip size="sm" tone="neutral" label="init" />
              <SegmentedControl
                label="init 컨테이너"
                value={initContainers.some((c) => c.name === container) ? (container ?? "") : ""}
                onChange={onContainerChange}
                options={initContainers.map((c) => ({ value: c.name, label: c.name }))}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {/* 조작 줄 (전부 조회 전용). 앵커가 켜져 있으면 `그 시각` 칩이 **맨 앞**이다(디자인 7.6 ②) */}
      <div className={styles.controlRow}>
        {anchorOn && at ? (
          <Chip
            size="sm"
            tone="neutral"
            icon="history"
            label={`그 시각 ${logAnchorTimeText(at)}`}
            title={formatFullTime(at)}
            onRemove={onAtClear}
            removeLabel="그 시각 표시 해제"
          />
        ) : null}
        {caps?.previousGeneration && !multiView ? (
          <Switch
            label="이전 세대(1회 전)"
            checked={previous}
            disabled={follow}
            disabledReason={follow ? "이전 세대는 따라가기를 쓸 수 없습니다 (끝난 로그입니다)" : undefined}
            onChange={onPreviousChange}
          />
        ) : null}
        <span ref={rangeRef} className={styles.rangeBox}>
          <Select
            label="기간"
            width={serverRange ? 200 : 160}
            value={serverRange ? ANCHOR_RANGE : rangeId}
            onChange={(v) => setRangeChoice(v === ANCHOR_RANGE ? null : v)}
            options={[
              // 앵커 중에는 서버가 기간을 골랐다 — 사용자가 고르기 전까지 `그 시각 기준`(디자인 7.6 ②)
              ...(anchorOn ? [{ value: ANCHOR_RANGE, label: "그 시각 기준" }] : []),
              ...rangeOptions.map((o) => ({ value: o.id, label: o.label })),
            ]}
          />
        </span>
        <Select
          label="줄 수"
          width={120}
          value={String(lineLimit)}
          onChange={(v) => setLineLimit(Number(v))}
          options={limits.lineOptions.map((n) => ({ value: String(n), label: formatCount(n) }))}
        />
        <Switch
          label="따라가기"
          checked={follow}
          disabled={!caps?.follow || previous}
          disabledReason={previous ? "이전 세대는 따라갈 수 없습니다" : undefined}
          onChange={setFollowSwitch}
        />
        <div className={styles.findBox}>
          <SearchInput
            label={caps?.labels.search ?? "화면 안에서 찾기"}
            placeholder={caps?.labels.search ?? "화면 안에서 찾기"}
            value={find}
            onChange={setQuery}
            onKeyDown={onFindKeyDown}
            width={240}
          />
          {find ? (
            <span className={styles.findNav} aria-live="polite">
              <span className={styles.findCount}>{`${totalMatches === 0 ? 0 : matchIndex + 1} / ${totalMatches}`}</span>
              <Button
                variant="ghost"
                size="sm"
                icon="chevron-up"
                aria-label="이전 일치 (Shift+Enter)"
                disabled={totalMatches === 0}
                onClick={() => stepMatch(-1)}
              />
              <Button
                variant="ghost"
                size="sm"
                icon="chevron-down"
                aria-label="다음 일치 (Enter)"
                disabled={totalMatches === 0}
                onClick={() => stepMatch(1)}
              />
            </span>
          ) : null}
        </div>
        <Switch label="시각" checked={showTimestamp} onChange={setShowTimestamp} />
        <Switch label="줄 바꿈" checked={wrap} onChange={setWrapChoice} />
        <Button
          variant="ghost"
          size="sm"
          icon="refresh-cw"
          disabled={!ready || follow}
          disabledReason={follow ? "따라가는 중에는 새로고침이 필요 없습니다" : undefined}
          onClick={() => {
            setKeepKey(null);
            setHalt(null);
            setReloadKey((n) => n + 1);
          }}
        >
          새로고침
        </Button>
      </div>

      {caps && caps.searchScope === "fetched" ? <p className={styles.findHint}>{caps.labels.searchHint}</p> : null}

      {/* 멈춤 안내 — 사용자가 끄지 않았는데 연결이 닫혔다. **닫을 수 없고**, 한 번에 하나만(디자인 7.4) */}
      {shownHalt && !failedNoPods ? <HaltNotice halt={shownHalt} onResume={resume} /> : null}

      {/* 시작 전 대기 — 연결이 살아 있다. info compact, 닫기·action 없음, 보고 있는 동안 나타나므로 live (디자인 7.4) */}
      {waitNotice ? <InlineAlert tone="info" compact live title={waitNotice.text} /> : null}

      {/* 그 시각을 못 찾았을 때 — 서버 문구 그대로 + 바로가기(디자인 7.6 ③). 오류가 아니다(경고색 없음·닫기 없음) */}
      {anchorNotices.map((n) =>
        n.code === ANCHOR_BEFORE ? (
          <InlineAlert key={n.code} tone="info" title={n.text} action={suggestAction(n)} live={anchorRetried} />
        ) : (
          <InlineAlert key={n.code} tone="info" compact title={n.text} live={anchorRetried} />
        ),
      )}

      {/* 합쳐보기 파드가 20개를 넘었다 — 결과가 전체가 아니라는 사실이라 닫기 없음(디자인 8.7) */}
      {clampedNotice ? (
        <InlineAlert
          tone="info"
          compact
          title={clampedNotice.text}
          action={
            onPickPods ? (
              <Button variant="ghost" size="sm" onClick={onPickPods}>
                파드 고르기
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {/* 안내: 코드 → 문구 매핑을 화면이 갖지 않는다. `notice.text` 그대로 */}
      {plainNotices.map((n) => {
        const tone = n.level === "error" || n.level === "warn" ? "warn" : "info";
        // 출처 실패(연결·인증) — 서버가 `details.fallbackSource: 'direct'`를 주면 전환 버튼. **자동 전환 없음**(AC-LOG42), 사용자가 누른다
        const fallback = n.details?.fallbackSource === "direct" ? capabilities.sources.find((s) => s.id === "direct") : undefined;
        if (fallback && fallback.selectable && source !== fallback.id) {
          return (
            <InlineAlert
              key={n.code}
              tone="warn"
              title={n.text}
              description={FALLBACK_DESCRIPTION}
              action={
                <Button variant="secondary" size="sm" onClick={() => onSourceChange(fallback.id)}>
                  {`${fallback.label}로 전환`}
                </Button>
              }
            />
          );
        }
        // 스택이 준 사유(`details.reason`, 서버가 가림 처리한 값)는 한 줄에 같이 — 화면이 조용히 범위를 줄이지 않는다(디자인 8.4)
        const reason = typeof n.details?.reason === "string" && n.details.reason ? n.details.reason : null;
        return <InlineAlert key={n.code} compact tone={tone} title={reason ? `${n.text} (${reason})` : n.text} />;
      })}
      {queryError ? <InlineAlert compact tone="warn" title={queryError.text} /> : null}

      {/* 본문 (`bodyRef`: 남은 높이 측정·찾은 줄로 스크롤) */}
      <div
        ref={bodyRef}
        className={styles.bodyBox}
        // 서버가 지목한 앵커(계약 2.2.1) — 검증용 표식. 화면은 이 값을 비교하지 않고 그대로 넘긴다
        data-anchor-state={anchor?.state}
        data-anchor-line={anchor?.lineId ?? undefined}
      >
        {!hasTarget ? (
          <EmptyState size="sm" icon="scroll-text" title={placeholder} />
        ) : podGone ? (
          <EmptyState
            size="lg"
            icon="file-question"
            title="이 파드는 더 이상 존재하지 않습니다"
            description={
              targets?.pod.deletedAt
                ? `삭제됨 ${new Date(targets.pod.deletedAt).toLocaleString("ko-KR")} · 쿠버네티스는 파드 객체가 사라지면 그 컨테이너 로그를 더 이상 제공하지 않습니다.`
                : "쿠버네티스는 파드 객체가 사라지면 그 컨테이너 로그를 더 이상 제공하지 않습니다."
            }
            footer={
              targets?.stackSearch?.available ? undefined : "외부 로그 스택이 있으면 사라진 파드의 로그도 볼 수 있습니다."
            }
          />
        ) : (
          <LogLineList
            lines={displayLines}
            showTimestamp={showTimestamp}
            showPrefix={multiView}
            showMillis={!narrow}
            wrap={wrap}
            follow={follow && autoScroll}
            onFollowBreak={onFollowBreak}
            onReachBottom={onReachBottom}
            pendingCount={pendingCount}
            onJumpToBottom={jumpToBottom}
            findQuery={find || undefined}
            currentMatch={current}
            // 그 시각의 줄: 구분 줄 + 강조 + 첫 화면 1/3 스크롤을 컴포넌트가 한다(디자인 7.6). 따라가기를 켜면 뗀다(④)
            anchor={listAnchor}
            onRedactionClick={(line, el) => setRedaction(redactionTargetAt(line, el))}
            height={bodyHeight}
            state={
              (targetsLoading && !multiView) || queryLoading ? "loading" : displayLines.length === 0 ? "empty" : "ready"
            }
            emptyText={emptyText}
            caption={caption}
          />
        )}
      </div>

      {/* 하단 상태 줄 (서버 값만 쓴다 — 화면이 세지 않는다) */}
      <p ref={statusRef} className={styles.statusLine} aria-live="polite">
        {`${formatCount(lines.length)}줄`}
        {stream.state.redactedCount > 0 ? ` · 가림 ${formatCount(stream.state.redactedCount)}건` : null}
        {stream.state.droppedLines > 0 ? ` · 초당 상한으로 ${formatCount(stream.state.droppedLines)}줄 생략` : null}
        {stream.state.startedAt ? ` · ${new Date(stream.state.startedAt).toLocaleTimeString("ko-KR")}부터` : null}
        {follow ? ` · 스트림 ${streamsInfo.open}/${streamsInfo.max}` : null}
      </p>

      <RedactionRulesPopover target={redaction} onClose={() => setRedaction(null)} />
    </div>
  );
}

/**
 * 멈춤 안내 (디자인 7.4 표). **`closable`을 주지 않는다** — 멈춰 있다는 사실이 사라지면 사용자는 로그가 조용해졌다고 읽는다.
 * 문구는 서버 `text` 그대로이고, 서버 코드가 없는 **링버퍼 멈춤만** 화면이 만든다. 그 "2만 줄"은 링버퍼 상수에서 온다.
 */
export function HaltNotice({ halt, onResume }: { halt: LogHalt; onResume: () => void }) {
  const tone = haltTone(halt.kind);
  const action = halt.resumable ? (
    <Button variant="secondary" size="sm" onClick={onResume}>
      {halt.kind === "failed" ? "다시 시도" : "다시 시작"}
    </Button>
  ) : undefined;
  if (halt.kind === "ring") {
    return (
      <InlineAlert
        tone="info"
        live
        title={halt.text}
        description={`화면에 담을 수 있는 ${ringLimitText()} 줄이 찼습니다. 다시 시작하면 지금 보이는 줄은 지워지고 맨 아래 새 줄부터 보입니다.`}
        action={action}
      />
    );
  }
  return <InlineAlert tone={tone} compact title={halt.text} action={action} />;
}
