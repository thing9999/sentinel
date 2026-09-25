"use client";

/**
 * 사이드바 `알림` 배지 + 브라우저 탭 제목 (alerts.md 2절·2.3, shell.md 2.2·3.2, AC-ALERT35).
 *
 * **여기가 배지의 유일한 출처다.** 값은 서버가 준 `badge` 세 개(`unreadCount`·`worstSeverity`·`updatedAt`)뿐이고
 * 화면이 목록을 세지 않는다(다른 탭에서 확인 처리하면 값이 달라진다).
 *
 * - 평소에는 `alerts` SSE 토픽(모든 페이지 구독)으로 갱신된다.
 * - **첫 로드·폴백**만 `GET /api/alerts/badge`를 한 번 부른다(계약 2.3: 스트림 없이 렌더하는 경우).
 * - **연결이 끊겨도 0으로 내리지 않는다.** 마지막 값을 그대로 두고 문구 끝에 `· HH:mm:ss 기준`을 붙인다(shell.md 5절).
 * - 값을 한 번도 못 받았으면 배지를 **그리지 않는다**(자리도 비운다 — 깜박임 방지).
 */
import { useEffect, useState } from "react";

import { formatNavCount, type NavItem, type Status } from "@/components/ui";
import { apiFetch } from "@/lib/api";

import type { AlertBadge, AlertBadgeResponse, AlertSeverity } from "./types";

export const ALERTS_HREF = "/alerts";

/** 심각도 → 배지 색. `resolved`는 배지에 세지 않으므로(계약 2.3) 오면 중립으로 떨어뜨린다 */
export function severityTone(severity: AlertSeverity | null): Status {
  switch (severity) {
    case "critical":
      return "crit";
    case "warning":
      return "warn";
    case "unknown":
      return "unknown";
    default:
      return "crit";
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function clockText(at: string | null): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * 사이드바 항목 패치. 배지 3개(`count`·`countTone`·`countLabel`)만 넘긴다 —
 * `알림`에는 **상태 점이 없다**(shell.md 3.1: 상태의 파생이라 같은 장애가 두 번 보인다).
 */
export function alertsNavPatch(badge: AlertBadge, loaded: boolean, streamDown = false): Partial<NavItem> {
  if (!loaded || badge.unreadCount < 1) return { count: undefined, countTone: undefined, countLabel: undefined };
  const base = `안 읽음 ${formatNavCount(badge.unreadCount)}건`;
  const at = streamDown ? clockText(badge.updatedAt) : null;
  return {
    count: badge.unreadCount,
    countTone: severityTone(badge.worstSeverity),
    countLabel: at ? `${base} · ${at} 기준` : base,
  };
}

/** 탭 제목 접두어 `(3) ` (shell.md 2.2). 배지와 **언제나 같은 값**이다 */
export const TAB_TITLE_PREFIX = /^\(\d{1,2}\+?\)\s/;

export function tabTitleWithCount(rawTitle: string, count: number): string {
  const base = rawTitle.replace(TAB_TITLE_PREFIX, "");
  return count >= 1 ? `(${formatNavCount(count)}) ${base}` : base;
}

/**
 * 브라우저 탭 제목에 개수를 붙인다. Next 가 라우트마다 `<title>`을 다시 쓰므로
 * `MutationObserver`로 제목이 바뀔 때마다 접두어를 다시 붙인다(라우트 이동 후에도 유지).
 * 0이면 접두어를 떼고, **연결이 끊겨도 마지막 값을 그대로 쓴다**(호출 측이 그런 값을 넘긴다).
 */
export function useTabTitleCount(count: number): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const head = document.head;
    if (!head) return;
    let applying = false;
    const apply = () => {
      if (applying) return;
      const next = tabTitleWithCount(document.title, count);
      if (next === document.title) return;
      applying = true;
      document.title = next;
      applying = false;
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(head, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      // 언마운트(테스트·미리보기)에서는 접두어를 남기지 않는다
      document.title = document.title.replace(TAB_TITLE_PREFIX, "");
    };
  }, [count]);
}

/**
 * 스트림이 아직 배지를 주지 않았을 때만 `GET /api/alerts/badge`를 한 번 부른다(계약 2.3 폴백).
 * 응답은 숫자·색·시각 3개뿐이라 **이력이 오지 않는다**.
 */
export function useBadgeFallback(enabled: boolean): AlertBadge | null {
  const [badge, setBadge] = useState<AlertBadge | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    apiFetch<AlertBadgeResponse>("/alerts/badge", { signal: ac.signal })
      .then((r) => setBadge({ unreadCount: r.unreadCount, worstSeverity: r.worstSeverity, updatedAt: r.updatedAt }))
      .catch(() => {
        /* 배지가 없으면 그리지 않는다 — 오류 배너를 띄우지 않는다 */
      });
    return () => ac.abort();
  }, [enabled]);
  return enabled ? badge : null;
}
