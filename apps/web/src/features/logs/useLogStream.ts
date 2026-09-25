"use client";

/**
 * 로그 따라가기 전용 연결 (docs/api/logs.md 2.3·7절, 12절 "화면이 하지 않는 것").
 *
 * **공용 SSE(`/api/stream`)와 완전히 별개다.** 토픽도 봉투도 공유하지 않고 `?topics=logs`는 400이다.
 * 준비(POST) → SSE(GET) → touch/close 3단계이고, 상한(`LOG_MAX_STREAMS` 기본 3)은 서버가 **연결 전에** 센다.
 *
 * 지키는 것:
 * - `log.closing`이 오면 **`EventSource.close()`** — 자동 재연결하면 그 `streamId`는 이미 소비돼 404 루프가 된다.
 * - **화면을 떠나면 반드시 `POST …/close`** — 안 부르면 슬롯 3개가 샌다(탭이 살아 있는 동안 서버가 회수하지 못한다).
 *   언마운트에는 `fetch(keepalive)`, 탭이 닫히는 `pagehide`에는 `navigator.sendBeacon`을 쓴다(그래서 본문이 없다).
 * - `touch`는 **보이는 동안만** 60초마다 (탭이 숨으면 멈춘다 → 서버가 5분 뒤 `log.paused`).
 * - 줄은 **프레임당 한 번** 모아서 반영한다(서버 250ms 배치 + rAF). 링버퍼 2만 줄은 화면 책임이다.
 *
 * **연결이 닫히면 이유와 상관없이 "멈춤"(`halt`)으로 알린다**(PM 결정 "작은 것 4건" 1, 디자인 7.4):
 * `log.paused`(유휴) · `log.closing`(30분·종료·오류) · `onerror` · **링버퍼 멈춤**(Q13) · 시작 실패.
 * 이 훅은 연결을 정리하고(`log.paused`도 화면이 `close`를 불러 슬롯을 돌려준다) **받은 줄은 지우지 않는다.**
 * 스위치를 끄고 안내를 그리는 것은 호출 측(`onHalt`)이다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { createBatcher, createFrameScheduler } from "@/lib/sse-core";
import { apiFetch, apiUrl, getApiBaseUrl, isApiError } from "@/lib/api";

import type {
  LogClosingPayload,
  LogHelloPayload,
  LogLine,
  LogLinesPayload,
  LogNotice,
  LogPausedPayload,
  LogQueryRequest,
  LogStreamCreated,
  LogStreamEnvelope,
} from "./types";

/**
 * 링버퍼: 화면이 들고 있는 최대 줄 수 (logs.md 7.2·7.4). **서버가 모르는 화면 상수**다.
 * 멈춤 안내 문구의 "2만 줄"도 이 값에서 만든다(`ringLimitText`) — 숫자를 두 곳에 두지 않는다.
 */
export const RING_MAX_LINES = 20_000;
/** 살아 있음 신호 주기 (계약 2.3.3) */
export const TOUCH_INTERVAL_MS = 60_000;
/**
 * 시작 전 대기 안내 (계약 6·7절). 서버는 연결을 닫지 않고 컨테이너 시작을 기다렸다가 `log.lines`를 보내기 시작한다 —
 * 그 첫 `log.lines`가 "시작됐다"는 신호이므로 화면이 이 안내를 내린다(서버가 따로 내리라고 보내지 않는다. 디자인 7.4 "시작 전 대기").
 */
export const CONTAINER_NOT_STARTED = "LOG_CONTAINER_NOT_STARTED";

/** `20000` → `2만`, `15000` → `1.5만`, `5000` → `5,000` (한국어 문구용) */
export function ringLimitText(n: number = RING_MAX_LINES): string {
  if (n >= 10_000) {
    const man = n / 10_000;
    return `${Number.isInteger(man) ? man : man.toFixed(1)}만`;
  }
  return n.toLocaleString("en-US");
}

export type LogStreamPhase = "idle" | "starting" | "open" | "halted";

/**
 * 연결이 닫힌 이유 (디자인 7.4 "멈춤 안내"). 문구는 서버 `text` 그대로이고, **서버 코드가 없는 `ring`만** 화면이 만든다.
 * - `idle` 유휴(`log.paused`) · `max` 30분(`log.closing` `max_duration`) → info
 * - `closed` 서버 종료·출처 오류(`log.closing`) · `disconnect` 이벤트 없이 끊김(`onerror`) → warn
 * - `ring` 위로 올려 읽는 중 링버퍼가 참(Q13) → info, 2줄, live
 * - `failed` 연결을 열지 못함(503 상한·403·404) → warn. 열린 적이 없어 "멈춘" 것이 아니다
 */
export type LogHaltKind = "idle" | "max" | "closed" | "disconnect" | "ring" | "failed";

export interface LogHalt {
  kind: LogHaltKind;
  code: string | null;
  text: string;
  resumable: boolean;
  details?: Record<string, unknown>;
  /** `start(request, tag)`에 넘긴 값 그대로 — 어느 조회의 멈춤인지 호출 측이 가린다 */
  tag: string;
}

export interface LogStreamState {
  phase: LogStreamPhase;
  lines: LogLine[];
  /** 링버퍼로 버린 줄이 있으면 목록 맨 위에 안내 줄을 그린다 */
  trimmed: boolean;
  notices: LogNotice[];
  /** 서버가 세는 동시 스트림 수 (하단 상태 줄 `스트림 1/3`) */
  streams: { open: number; max: number } | null;
  /** 따라가기 연결 시작 시각 (하단 상태 줄 `14:02:10부터`) */
  startedAt: string | null;
  /** 가림 누적 건수 (서버 `stats.redactedCount` 합) */
  redactedCount: number;
  droppedLines: number;
}

const EMPTY: LogStreamState = {
  phase: "idle",
  lines: [],
  trimmed: false,
  notices: [],
  streams: null,
  startedAt: null,
  redactedCount: 0,
  droppedLines: 0,
};

type Incoming =
  | { kind: "lines"; payload: LogLinesPayload }
  | { kind: "notice"; payload: LogNotice }
  | { kind: "hello"; payload: LogHelloPayload };

/**
 * 새 줄을 붙인다. 링버퍼를 넘으면:
 * - `hold`(위로 올려 읽는 중)이면 **지우지 않고** 상한까지만 받고 멈춘다(`halted`) — 읽던 줄을 지키는 것이 D2의 목적이다(Q13)
 * - 아니면(맨 아래에서 자동 스크롤 중) 지금처럼 **위에서부터** 버린다
 */
export function appendRing(
  lines: LogLine[],
  added: LogLine[],
  hold: boolean,
  max: number = RING_MAX_LINES,
): { lines: LogLine[]; trimmed: boolean; halted: boolean } {
  if (added.length === 0) return { lines, trimmed: false, halted: false };
  const combined = lines.concat(added);
  if (combined.length <= max) return { lines: combined, trimmed: false, halted: false };
  if (hold) return { lines: combined.slice(0, max), trimmed: false, halted: true };
  return { lines: combined.slice(combined.length - max), trimmed: true, halted: false };
}

/** 슬롯을 돌려주는 유일한 경로. 본문이 없어서 `sendBeacon`으로도 보낼 수 있다(계약 2.3.4) */
function closeStream(streamId: string, viaBeacon: boolean): void {
  const url = apiUrl(`/logs/streams/${encodeURIComponent(streamId)}/close`);
  if (viaBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    navigator.sendBeacon(url);
    return;
  }
  // keepalive: 언마운트 직후에도 요청이 끝까지 간다
  void fetch(url, { method: "POST", keepalive: true }).catch(() => {
    /* 닫기 실패해도 화면에 오류를 띄우지 않는다. SSE 가 끊기면 서버가 회수한다 */
  });
}

/** `log.closing` → 멈춤 종류. 30분은 계획된 멈춤(info), 서버 종료·출처 오류는 예상 밖(warn) — 디자인 7.4 */
export function closingHaltKind(reason: LogClosingPayload["reason"]): LogHaltKind {
  if (reason === "max_duration") return "max";
  if (reason === "idle") return "idle";
  return "closed";
}

export interface UseLogStreamOptions {
  /**
   * 위로 올려 읽는 중인가(자동 스크롤이 멈춤). 이 동안 링버퍼가 차면 줄을 버리지 않고 **따라가기를 멈춘다**(Q13).
   * 맨 아래에서 자동 스크롤 중이면 `false` — 위에서부터 버린다.
   */
  hold: boolean;
  /** 연결이 닫혔다(사용자가 끈 경우 제외). 호출 측은 스위치를 끄고 닫을 수 없는 안내를 그린다 */
  onHalt: (halt: LogHalt) => void;
  /**
   * `log.hello` — stack 워크로드 합쳐보기면 서버가 푼 파드 목록(`selector.resolvedPods`)이 온다(계약 1.4·2.3.1).
   * 그 밖에는 `null`. 파드 선택기를 채우는 데 쓴다
   */
  onResolvedPods?: (pods: string[] | null) => void;
}

export interface UseLogStream {
  state: LogStreamState;
  /** 따라가기 시작 (이미 열려 있으면 먼저 닫는다). `tag`는 `onHalt`로 그대로 돌아온다 */
  start: (request: LogQueryRequest, tag: string) => void;
  /** 따라가기 끄기(사용자 조작) — **서버 연결을 실제로 끊는다**. 받은 줄은 그대로 둔다 */
  stop: () => void;
  /** 정지 조회 결과로 화면 줄을 채운다(따라가기 전 상태) */
  setLines: (lines: LogLine[], notices: LogNotice[], redactedCount: number, droppedLines: number) => void;
  clear: () => void;
}

export function useLogStream({ hold, onHalt, onResolvedPods }: UseLogStreamOptions): UseLogStream {
  const [state, setState] = useState<LogStreamState>(EMPTY);
  /** 배치·이벤트 처리기가 읽는 최신 상태. 부수 효과(연결 정리·멈춤 알림)를 setState 갱신 함수 밖에서 하려고 둔다 */
  const stateRef = useRef<LogStreamState>(EMPTY);
  const esRef = useRef<EventSource | null>(null);
  const idRef = useRef<string | null>(null);
  const tagRef = useRef<string>("");
  const touchRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const genRef = useRef(0);
  const holdRef = useRef(hold);
  const onHaltRef = useRef(onHalt);
  const onResolvedRef = useRef(onResolvedPods);
  useEffect(() => {
    holdRef.current = hold;
  }, [hold]);
  useEffect(() => {
    onHaltRef.current = onHalt;
    onResolvedRef.current = onResolvedPods;
  });

  const commit = useCallback((next: LogStreamState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** 연결만 정리한다(줄은 그대로). 슬롯을 돌려준다 */
  const closeConnection = useCallback((viaBeacon = false) => {
    clearInterval(touchRef.current);
    touchRef.current = undefined;
    if (esRef.current) {
      esRef.current.onerror = null;
      esRef.current.close();
      esRef.current = null;
    }
    if (idRef.current) {
      closeStream(idRef.current, viaBeacon);
      idRef.current = null;
    }
  }, []);

  const batcherRef = useRef<ReturnType<typeof createBatcher<Incoming>> | null>(null);

  /** 연결이 닫혔다 — 줄은 두고 멈춤으로 알린다. 한 번만(이미 멈췄으면 무시) */
  const halt = useCallback(
    (h: Omit<LogHalt, "tag">) => {
      if (stateRef.current.phase === "halted") return;
      genRef.current += 1; // 늦게 오는 이벤트·배치를 버린다
      batcherRef.current?.clear();
      closeConnection(false);
      commit({ ...stateRef.current, phase: "halted", streams: null });
      onHaltRef.current({ ...h, tag: tagRef.current });
    },
    [closeConnection, commit],
  );

  const apply = useCallback(
    (items: Incoming[]) => {
      const cur = stateRef.current;
      if (cur.phase === "halted") return;
      let { lines, trimmed, notices, streams, startedAt, redactedCount, droppedLines, phase } = cur;
      let added: LogLine[] = [];
      let resolved: string[] | null | undefined;
      for (const it of items) {
        if (it.kind === "hello") {
          phase = "open";
          streams = it.payload.streams ?? streams;
          startedAt = startedAt ?? it.payload.serverTime;
          // 조회 응답과 같은 이름(`selector.resolvedPods`)만 읽는다 — backend 5e 가 스트림에도 넣었다(PM 결정 8)
          resolved = it.payload.selector?.resolvedPods ?? null;
        } else if (it.kind === "lines") {
          if (it.payload.initial) {
            // 첫 배치는 화면을 교체한다(정지 조회 결과 위에 겹쳐 쌓지 않는다)
            lines = [];
            trimmed = false;
            added = [];
            redactedCount = 0;
            droppedLines = 0;
          }
          added = added.concat(it.payload.lines ?? []);
          redactedCount += it.payload.stats?.redactedCount ?? 0;
          droppedLines += it.payload.stats?.droppedLines ?? 0;
          // 줄이 오기 시작했다 = 컨테이너가 돌기 시작했다 → 시작 전 대기 안내를 내린다(빈 배치여도 붙은 것이다)
          notices = notices.filter((n) => n.code !== CONTAINER_NOT_STARTED);
        } else {
          notices = [...notices.filter((n) => n.code !== it.payload.code), it.payload];
        }
      }
      const ring = appendRing(lines, added, holdRef.current);
      commit({
        ...cur,
        phase,
        lines: ring.lines,
        trimmed: trimmed || ring.trimmed,
        notices,
        streams,
        startedAt,
        redactedCount,
        droppedLines,
      });
      if (resolved !== undefined) onResolvedRef.current?.(resolved);
      if (ring.halted) {
        // 링버퍼 멈춤에는 서버 코드가 없다 — 화면 상수라 판단도 문구도 화면 몫이다(PM "작은 것 4건" 3)
        halt({
          kind: "ring",
          code: null,
          text: "읽던 줄이 지워지지 않게 따라가기를 멈췄습니다.",
          resumable: true,
        });
      }
    },
    [commit, halt],
  );

  /** 배치기는 처음 쓸 때 만든다(렌더 중에 만들지 않는다 — 처리기가 ref 를 읽기 때문) */
  const getBatcher = useCallback(() => {
    if (batcherRef.current === null) {
      batcherRef.current = createBatcher<Incoming>((items) => apply(items), createFrameScheduler());
    }
    return batcherRef.current;
  }, [apply]);

  const stop = useCallback(() => {
    genRef.current += 1;
    batcherRef.current?.clear();
    closeConnection(false);
    const cur = stateRef.current;
    commit({ ...cur, phase: cur.phase === "halted" ? "halted" : "idle", streams: null, startedAt: null });
  }, [closeConnection, commit]);

  const start = useCallback(
    (request: LogQueryRequest, tag: string) => {
      genRef.current += 1;
      const gen = genRef.current;
      tagRef.current = tag;
      batcherRef.current?.clear();
      closeConnection(false);
      commit({ ...stateRef.current, phase: "starting", notices: [] });

      void apiFetch<LogStreamCreated>("/logs/streams", { method: "POST", body: request })
        .then((created) => {
          if (gen !== genRef.current) {
            // 그 사이 다시 시작·중지됐다 — 슬롯을 바로 돌려준다
            closeStream(created.streamId, false);
            return;
          }
          idRef.current = created.streamId;
          commit({ ...stateRef.current, streams: created.streams, notices: created.notices ?? [] });
          const es = new EventSource(`${getApiBaseUrl()}${created.url}`, { withCredentials: false });
          esRef.current = es;
          const parse = (ev: MessageEvent<string>): LogStreamEnvelope | null => {
            if (gen !== genRef.current) return null;
            try {
              return JSON.parse(ev.data) as LogStreamEnvelope;
            } catch {
              return null;
            }
          };
          const push = (kind: Incoming["kind"]) => (ev: MessageEvent<string>) => {
            const envelope = parse(ev);
            if (envelope) getBatcher().push({ kind, payload: envelope.payload } as Incoming);
          };
          es.addEventListener("log.hello", push("hello"));
          es.addEventListener("log.lines", push("lines"));
          es.addEventListener("log.notice", push("notice"));
          // 유휴: 서버는 연결을 열어 둔 채 슬롯을 쥔다 → 스위치가 꺼지므로 **화면이 `close`를 불러** 돌려준다(디자인 7.4)
          es.addEventListener("log.paused", (ev: MessageEvent<string>) => {
            const envelope = parse(ev);
            if (!envelope) return;
            batcherRef.current?.flush();
            const p = envelope.payload as LogPausedPayload;
            halt({ kind: "idle", code: p.code ?? null, text: p.text, resumable: p.resumable !== false });
          });
          // 계약 7절: 받으면 **닫는다**. 자동 재연결하지 않는다(그 streamId 는 이미 소비됐다)
          es.addEventListener("log.closing", (ev: MessageEvent<string>) => {
            const envelope = parse(ev);
            if (!envelope) return;
            batcherRef.current?.flush();
            const p = envelope.payload as LogClosingPayload;
            halt({ kind: closingHaltKind(p.reason), code: p.code ?? null, text: p.text, resumable: p.resumable });
          });
          es.addEventListener("log.heartbeat", () => {
            /* 살아 있음만 확인한다(화면 값 없음) */
          });
          es.onerror = () => {
            if (gen !== genRef.current) return;
            // 서버가 `retry:`를 보내지 않으므로 브라우저가 다시 열어도 404다 — 여기서 끝낸다
            batcherRef.current?.flush();
            halt({ kind: "disconnect", code: null, text: "로그 연결이 끊겼습니다.", resumable: true });
          };

          // 보이는 동안만 60초마다 (탭이 숨으면 멈춘다 — 서버가 유휴로 판단해 위쪽 연결을 끊는다)
          touchRef.current = setInterval(() => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
            const id = idRef.current;
            if (!id) return;
            void apiFetch(`/logs/streams/${encodeURIComponent(id)}/touch`, { method: "POST" }).catch(() => {
              /* 404 면 이미 끝난 스트림이다 — log.closing 이 화면을 정리한다 */
            });
          }, TOUCH_INTERVAL_MS);
        })
        .catch((e: unknown) => {
          if (gen !== genRef.current) return;
          const body =
            isApiError(e) && e.kind === "http"
              ? (e.body as { code?: string; message?: string; details?: Record<string, unknown> })
              : null;
          halt({
            kind: "failed",
            code: body?.code ?? "LOG_STREAM_FAILED",
            text: body?.message ?? "로그 따라가기를 시작하지 못했습니다.",
            resumable: true,
            details: body?.details,
          });
        });
    },
    [closeConnection, commit, halt, getBatcher],
  );

  const setLines = useCallback(
    (lines: LogLine[], notices: LogNotice[], redactedCount: number, droppedLines: number) => {
      const next = appendRing([], lines, false);
      commit({
        ...stateRef.current,
        phase: "idle",
        lines: next.lines,
        trimmed: next.trimmed,
        notices,
        redactedCount,
        droppedLines,
        startedAt: null,
      });
    },
    [commit],
  );

  const clear = useCallback(() => {
    genRef.current += 1;
    batcherRef.current?.clear();
    closeConnection(false);
    commit(EMPTY);
  }, [closeConnection, commit]);

  // 화면을 떠날 때 반드시 닫는다 (언마운트 + 탭 닫기·새로고침)
  useEffect(() => {
    const onPageHide = () => {
      if (idRef.current) closeStream(idRef.current, true);
      idRef.current = null;
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      genRef.current += 1;
      closeConnection(false);
    };
  }, [closeConnection]);

  return { state, start, stop, setLines, clear };
}
