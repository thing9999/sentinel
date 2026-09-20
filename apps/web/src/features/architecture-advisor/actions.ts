"use client";

/**
 * 어드바이저 동작 (계약 A.3.2, A.6, A.7.2). 브라우저는 브리지를 직접 부르지 않는다(항상 API 경유).
 * - 분석 실행: 202(created: true) / 200(created: false, 진행 중 실행으로 연결) 모두 성공
 * - 취소: 202, 이미 끝났으면 409 RUN_NOT_ACTIVE (무시)
 * - 다시 확인: 429 BRIDGE_CHECK_COOLDOWN, 409 RUN_ACTIVE
 */
import { useCallback, useState } from "react";

import { apiFetch } from "@/lib/api";

import { errorBody } from "../common/hooks";
import type { BridgeStatus, CreateRunResponse, Run } from "./types";

export function runErrorText(e: unknown): string {
  const b = errorBody(e);
  if (!b) return "분석을 시작하지 못했습니다. API 연결을 확인하세요.";
  switch (b.code) {
    case "BRIDGE_NOT_READY":
      return `브리지가 준비되지 않았습니다. ${b.message}`;
    case "SNAPSHOT_UNAVAILABLE":
      return `스냅샷을 만들 수 없습니다. ${b.message}`;
    default:
      return b.message;
  }
}

export function recheckErrorText(e: unknown): string {
  const b = errorBody(e);
  if (!b) return "브리지 상태를 확인하지 못했습니다.";
  if (b.code === "BRIDGE_CHECK_COOLDOWN") {
    const sec = (b.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
    return sec ? `${sec}초 뒤에 다시 확인할 수 있습니다.` : b.message;
  }
  if (b.code === "RUN_ACTIVE") return "분석이 진행 중이라 인증 확인을 할 수 없습니다.";
  return b.message;
}

export function useAdvisorActions() {
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** POST 응답으로 받은 실행 (스트림 progress 가 오기 전 표시용) */
  const [started, setStarted] = useState<{ run: Run; created: boolean } | null>(null);
  const [bridgeOverride, setBridgeOverride] = useState<{ value: BridgeStatus; base: BridgeStatus | null } | null>(null);

  const start = useCallback(async (includeSystem: boolean) => {
    setStarting(true);
    setError(null);
    try {
      const res = await apiFetch<CreateRunResponse>("/advisor/runs", { method: "POST", body: { includeSystem } });
      if (res?.run) setStarted({ run: res.run, created: res.created });
    } catch (e) {
      setError(runErrorText(e));
    } finally {
      setStarting(false);
    }
  }, []);

  const cancel = useCallback(async (runId: string) => {
    setCancelling(true);
    setError(null);
    try {
      await apiFetch(`/advisor/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
    } catch (e) {
      const b = errorBody(e);
      if (b?.code !== "RUN_NOT_ACTIVE") setError(b?.message ?? "취소를 요청하지 못했습니다.");
      setCancelling(false);
      return false;
    }
    return true;
  }, []);

  /** base: 확인 시점의 스트림 브리지 상태. 스트림이 바뀔 때까지만 응답 값을 쓴다 */
  const recheck = useCallback(async (base: BridgeStatus | null) => {
    setRechecking(true);
    setError(null);
    try {
      const res = await apiFetch<{ bridge: BridgeStatus }>("/advisor/bridge/check", { method: "POST" });
      if (res?.bridge) setBridgeOverride({ value: res.bridge, base });
    } catch (e) {
      setError(recheckErrorText(e));
    } finally {
      setRechecking(false);
    }
  }, []);

  return {
    starting,
    cancelling,
    setCancelling,
    rechecking,
    error,
    clearError: () => setError(null),
    started,
    clearStarted: () => setStarted(null),
    bridgeOverride,
    clearBridgeOverride: () => setBridgeOverride(null),
    start,
    cancel,
    recheck,
  };
}
