"use client";

/**
 * aws-snapshots 토픽 구독과 화면 공용 훅.
 * 스트림에는 요약과 "바뀐 ID"만 오고(계약 11절), 목록·상세·휴지통은 REST 로 다시 조회한다.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { sourcesStale, type StaleMark } from "../stream/stale";
import type { SnapshotSummary } from "./types";

export interface SnapshotsView {
  summary: SnapshotSummary | null;
  dataSource: "mock" | "live" | null;
  /** 모든 aws-snapshots 이벤트 수 */
  seq: number;
  /** 연결·시나리오 변경·reset 스냅샷 수 */
  resetSeq: number;
  changedSeq: (id: string) => number;
  removedSeq: (id: string) => number;
  trashSeq: number;
  /** 폴더 확인 90초 실패(서버 플래그) 또는 출처 stale */
  mark: StaleMark;
}

const AWS_TOPICS = ["aws-snapshots"] as const;

/**
 * AWS 스냅샷 화면이 떠 있는 동안 `aws-snapshots` 토픽을 구독한다.
 * (사이드바는 k8s-snapshot 이후 `snapshot-menu` 토픽으로 그리므로 이 토픽은 더 이상 기본 구독이 아니다)
 */
export function useSnapshotsView(fallbackSummary?: SnapshotSummary | null): SnapshotsView {
  useTopics(AWS_TOPICS);
  const { stream } = useStreamStore();
  const s = stream.snapshots;
  const summary = s?.summary ?? fallbackSummary ?? null;
  const stale = Boolean(summary?.status.stale) || sourcesStale(stream.sources, ["snapshotStore"]);
  const changed = s?.changed;
  const removed = s?.removed;
  const changedSeq = useCallback((id: string) => changed?.[id] ?? 0, [changed]);
  const removedSeq = useCallback((id: string) => removed?.[id] ?? 0, [removed]);
  return {
    summary,
    dataSource: stream.dataSource,
    seq: s?.seq ?? 0,
    resetSeq: s?.resetSeq ?? 0,
    changedSeq,
    removedSeq,
    trashSeq: s?.trashSeq ?? 0,
    mark: { stale, at: stale ? (summary?.lastCheckedAt ?? summary?.status.updatedAt ?? undefined) : undefined },
  };
}

type Listener = () => void;

/** localStorage 불리언 (SSR 은 기본값, 하이드레이션 후 저장값) */
export function createBoolStore(key: string, fallback: boolean) {
  const listeners = new Set<Listener>();
  const read = (): boolean => {
    try {
      const v = localStorage.getItem(key);
      return v === "true" ? true : v === "false" ? false : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: (): boolean => (typeof window === "undefined" ? fallback : read()),
    getServer: (): boolean => fallback,
    set(v: boolean) {
      try {
        localStorage.setItem(key, String(v));
      } catch {
        /* 저장 불가 — 화면에는 반영 */
      }
      for (const l of listeners) l();
    },
  };
}

/** 줄 바꿈 (디자인 5.2 `sentinel.snapshots.wrap`) */
export const wrapStore = createBoolStore("sentinel.snapshots.wrap", false);
/** 새 스냅샷 만들기 안내 펼침 (디자인 3.6 `sentinel.snapshots.cliGuide`) */
export const cliGuideStore = createBoolStore("sentinel.snapshots.cliGuide", false);

export function useBoolStore(store: ReturnType<typeof createBoolStore>): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  return [v, store.set];
}

/** 잠시 켰다가 끄는 표시 (예: `방금 바뀜` 5초, 새 행·라벨 강조 1.5초). fire 를 부를 때마다 다시 켠다 */
export function useFlash(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const fire = useCallback(() => {
    setOn(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, fire];
}

/** 이탈 방지 가드 history 항목 표시 (Next 내부 상태 __NA·트리는 Next 의 pushState 패치가 복사한다) */
export const HISTORY_GUARD_KEY = "sentinelSnapshotEditGuard";

const guardToken = (state: unknown): unknown =>
  typeof state === "object" && state !== null ? (state as Record<string, unknown>)[HISTORY_GUARD_KEY] : undefined;
let guardSeq = 0;

export interface LeaveGuard {
  /** 확인 후 앱 안 이동: 가드 항목을 새 페이지로 교체한다(뒤로 가면 이 페이지) */
  leaveTo: (href: string) => void;
  /** 확인 후 뒤로: 가드 항목과 현재 항목을 건너 이전 페이지로 */
  leaveBack: () => void;
}

/**
 * 저장하지 않은 변경 이탈 방지 (명세 3.7, 디자인 6.4, AC-31).
 * - 앱 안 링크(사이드바·브레드크럼·본문 링크): window 캡처 단계에서 클릭을 가로채 onAttempt({ type: "href" })를 부른다.
 * - 브라우저 뒤로/앞으로: 변경이 생기면 같은 URL 의 가드 항목을 history 에 하나 쌓는다(pushState).
 *   뒤로 가면(popstate) 가드를 다시 쌓아 화면·URL 을 그대로 두고 onAttempt({ type: "back" })를 부른다.
 *   `변경 버리기`면 leaveBack()이 가드와 현재 항목을 건너 이전 페이지로 간다.
 *   저장·편집 취소(active=false)면 가드 항목을 history.back()으로 치운다(이 popstate 는 무시).
 * - 탭 닫기·새로고침·주소 이동: 브라우저 기본 확인(beforeunload, 문구 지정 불가).
 * - 새 탭 열기(Ctrl/Cmd/Shift/가운데 버튼)·다른 사이트·같은 주소 링크는 막지 않는다.
 * - allowInPage(url)가 true 인 링크(같은 화면 안에서 쿼리만 바꾸고 편집을 잃지 않는 이동, 예: k8s 상세 탭 전환)는 막지 않는다.
 */
export function useLeaveGuard(
  active: boolean,
  onAttempt: (attempt: { type: "href"; href: string } | { type: "back" }) => void,
  navigate: (href: string, opts: { replace: boolean }) => void,
  allowInPage?: (url: URL) => boolean,
): LeaveGuard {
  const cb = useRef(onAttempt);
  const nav = useRef(navigate);
  const inPage = useRef(allowInPage);
  useEffect(() => {
    cb.current = onAttempt;
    nav.current = navigate;
    inPage.current = allowInPage;
  }, [onAttempt, navigate, allowInPage]);
  /** 가드 항목을 쌓았는지 */
  const pushed = useRef(false);
  /** 우리가 일으킨 popstate 를 무시 */
  const ignorePop = useRef(0);
  /** 확인 후 떠나는 중: 가드를 history.back()으로 치우지 않는다 */
  const leaving = useRef(false);
  /** 지금 쌓은 가드 항목의 표식 (다른 화면·이전 편집이 남긴 가드와 구분) */
  const token = useRef<string | null>(null);
  const onOwnGuard = () => token.current !== null && guardToken(window.history.state) === token.current;
  const pushGuard = () => {
    guardSeq += 1;
    token.current = `g${Date.now()}-${guardSeq}`;
    window.history.pushState({ [HISTORY_GUARD_KEY]: token.current }, "", window.location.href);
  };

  // 가드 항목 쌓기·치우기
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (active && !pushed.current) {
      pushGuard();
      pushed.current = true;
      leaving.current = false;
    } else if (!active && pushed.current) {
      pushed.current = false;
      if (leaving.current) {
        leaving.current = false;
      } else if (onOwnGuard()) {
        ignorePop.current += 1;
        window.history.back();
      }
    }
  }, [active]);

  useEffect(() => {
    const onPop = () => {
      if (ignorePop.current > 0) {
        ignorePop.current -= 1;
        return;
      }
      if (!pushed.current || leaving.current) return;
      if (onOwnGuard()) return; // 앞으로 가기로 가드에 돌아온 경우
      // 가드를 다시 쌓아 URL·화면을 그대로 두고 확인을 받는다
      pushGuard();
      cb.current({ type: "back" });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (inPage.current?.(url)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cb.current({ type: "href", href: `${url.pathname}${url.search}${url.hash}` });
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 일부 브라우저는 returnValue 가 있어야 확인 창을 띄운다
      e.returnValue = "";
    };
    window.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [active]);

  const leaveTo = useCallback((href: string) => {
    const onGuard = pushed.current && onOwnGuard();
    leaving.current = pushed.current;
    // 가드 항목 자리를 새 페이지로 바꾼다 → 뒤로 가면 편집하던 페이지(원래 항목)
    nav.current(href, { replace: onGuard });
  }, []);

  const leaveBack = useCallback(() => {
    const onGuard = pushed.current && onOwnGuard();
    leaving.current = pushed.current;
    ignorePop.current += 1;
    window.history.go(onGuard ? -2 : -1);
  }, []);

  return { leaveTo, leaveBack };
}
