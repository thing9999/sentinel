"use client";

/**
 * 사이드바 `로그` 항목을 그릴지 판단하는 **서버 값 하나** (`GET /api/logs/capabilities`의 `enabled`, 계약 2.1.1).
 *
 * 사이드바에는 서버 링크(`logHref`)가 없어서 이 값을 쓴다(계약 11.4 표 6번). **다른 진입점은 이 값을 쓰지 않는다** —
 * 파드·이벤트·워크로드·DB·컨트롤 플레인·알림은 전부 서버 `logHref`가 `null`인지로만 정한다(통합 3차에 파드 상세·
 * 컨트롤 플레인의 이 훅 사용을 지웠다). 그래서 `denyNamespaces`도 더 들고 있지 않다.
 * 여러 화면이 같은 값을 쓰므로 **모듈 수준에서 한 번만** 부르고 결과를 공유한다(로그 때문에 호출을 늘리지 않는다).
 */
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

import type { LogCapabilitiesResponse } from "./types";

let cached: { enabled: boolean } | null = null;
let inflight: Promise<{ enabled: boolean } | null> | null = null;
const listeners = new Set<() => void>();

function load() {
  if (cached || inflight) return;
  inflight = apiFetch<LogCapabilitiesResponse>("/logs/capabilities")
    .then((r) => {
      cached = { enabled: r.enabled };
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
      for (const l of listeners) l();
    });
}

export interface LogsAvailability {
  /** 아직 모르면 `null` — 그동안은 항목을 그대로 둔다(깜박임 방지) */
  enabled: boolean | null;
}

export function useLogsAvailability(): LogsAvailability {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    listeners.add(on);
    load();
    return () => {
      listeners.delete(on);
    };
  }, []);
  return { enabled: cached ? cached.enabled : null };
}
