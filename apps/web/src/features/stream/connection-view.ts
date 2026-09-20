/**
 * 연결 상태 → 상단바 ConnectionIndicator / ConnectionBanner 표시 값 (docs/design/status.md 2.3). 순수 함수.
 */
import type { ConnectionStatus } from "@/components/ui";

import type { ConnectionInfo } from "./client";

export const BANNER_DELAY_MS = 5000;
export const RECONNECTED_CHIP_MS = 3000;

export interface ConnectionView {
  indicator: ConnectionStatus;
  showBanner: boolean;
  bannerMessage: string;
  retryCount: number;
  nextRetryInMs: number | null;
  justReconnected: boolean;
}

export function deriveConnectionView(conn: ConnectionInfo, now: number): ConnectionView {
  let indicator: ConnectionStatus;
  switch (conn.phase) {
    case "open":
    case "switching":
      indicator = "open";
      break;
    case "idle":
    case "connecting":
      indicator = conn.everOpened || conn.attempt > 0 ? "reconnecting" : "connecting";
      break;
    case "paused":
      indicator = "reconnecting";
      break;
    case "waiting":
      indicator = conn.apiReachable === false ? "apiDown" : "disconnected";
      break;
  }
  const down = conn.phase !== "open" && conn.phase !== "switching" && conn.phase !== "paused" && conn.phase !== "idle";
  const showBanner = down && conn.downSince !== null && now - conn.downSince >= BANNER_DELAY_MS;
  return {
    indicator,
    showBanner,
    bannerMessage: conn.apiReachable === false ? "API에 연결할 수 없습니다" : "연결 끊김",
    retryCount: conn.attempt,
    nextRetryInMs: conn.phase === "waiting" && conn.nextRetryAt !== null ? Math.max(0, conn.nextRetryAt - now) : null,
    justReconnected:
      indicator === "open" && conn.reconnectedAt !== null && now - conn.reconnectedAt < RECONNECTED_CHIP_MS,
  };
}
