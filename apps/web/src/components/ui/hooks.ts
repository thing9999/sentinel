"use client";

import { useEffect, useState } from "react";

/**
 * 표시용 현재 시각. intervalMs 마다 갱신(0 이면 갱신 안 함).
 * 서버/클라이언트 시각 차이로 인한 hydration 경고는 사용하는 쪽에서 suppressHydrationWarning 으로 막는다.
 */
export function useNow(intervalMs = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 위치 계산: 트리거 기준으로 fixed 좌표를 구하고 화면 안으로 밀어 넣는다(가로 스크롤 방지). */
export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export function placeFloating(
  anchor: DOMRect,
  floating: { width: number; height: number },
  side: Side,
  align: Align,
  offset: number,
): { top: number; left: number; side: Side } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  let s = side;
  // 공간이 없으면 반대편으로 뒤집기
  if (s === "top" && anchor.top - floating.height - offset < margin) s = "bottom";
  else if (s === "bottom" && anchor.bottom + floating.height + offset > vh - margin && anchor.top > floating.height)
    s = "top";
  else if (s === "left" && anchor.left - floating.width - offset < margin) s = "right";
  else if (s === "right" && anchor.right + floating.width + offset > vw - margin) s = "left";

  let top: number;
  let left: number;
  if (s === "top" || s === "bottom") {
    top = s === "top" ? anchor.top - floating.height - offset : anchor.bottom + offset;
    if (align === "start") left = anchor.left;
    else if (align === "end") left = anchor.right - floating.width;
    else left = anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    left = s === "left" ? anchor.left - floating.width - offset : anchor.right + offset;
    top = anchor.top + anchor.height / 2 - floating.height / 2;
  }
  left = Math.min(Math.max(margin, left), Math.max(margin, vw - floating.width - margin));
  top = Math.min(Math.max(margin, top), Math.max(margin, vh - floating.height - margin));
  return { top, left, side: s };
}
