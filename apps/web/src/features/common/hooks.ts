"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { apiFetch, apiUrl, isApiError, type ApiError, type QueryValue } from "@/lib/api";

import type { ApiErrorBody } from "./types";

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

interface Result<T> {
  key: string;
  baseKey: string;
  nonce: number;
  data?: T;
  error?: ApiError;
}

/**
 * REST 조회 (브라우저 → NEXT_PUBLIC_API_URL). path 가 null 이면 부르지 않는다.
 * 같은 키로 다시 부르는 동안에는 이전 데이터를 유지한다.
 */
export function useApi<T>(
  path: string | null,
  query?: Record<string, QueryValue>,
  /** 값이 바뀌면 다시 조회한다(요청에는 보내지 않음). 예: 스트림 행의 statusChangedAt */
  refreshKey?: string | number | null,
): ApiState<T> {
  const baseKey = path ? apiUrl(path, query) : null;
  const key = baseKey ? `${baseKey}#${refreshKey ?? ""}` : null;
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);

  useEffect(() => {
    if (!key || !path || !baseKey) return;
    const ac = new AbortController();
    apiFetch<T>(path, { query, signal: ac.signal })
      .then((data) => setResult({ key, baseKey, nonce, data }))
      .catch((e: unknown) => {
        if (isApiError(e) && e.kind === "aborted") return;
        setResult({ key, baseKey, nonce, error: isApiError(e) ? e : undefined });
      });
    return () => ac.abort();
    // query 는 key 에 포함된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const sameKey = result !== null && result.key === key;
  // 같은 요청(refreshKey 만 다름)이면 다시 받는 동안 이전 데이터를 유지한다
  const sameBase = result !== null && result.baseKey === baseKey;
  return {
    data: sameBase ? result.data : undefined,
    error: sameKey && result.nonce === nonce ? (result.error ?? null) : null,
    loading: key !== null && (!sameKey || result.nonce !== nonce),
    reload,
  };
}

/** ApiError 본문이 계약의 에러 형식이면 돌려준다 */
export function errorBody(e: unknown): ApiErrorBody | null {
  if (!isApiError(e) || e.kind !== "http") return null;
  const b = e.body as Partial<ApiErrorBody> | undefined;
  return b && typeof b === "object" && typeof b.code === "string" ? (b as ApiErrorBody) : null;
}

/** 목록 필터·정렬을 URL 쿼리에 둔다 (cluster-status.md 0절, status.md 5.2) */
export function useUrlQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = useCallback((name: string) => params.get(name), [params]);
  const set = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { get, set, params };
}

/** 미디어 쿼리 일치 여부 (SSR·jsdom 에 matchMedia 가 없으면 fallback) */
export function useMediaQuery(query: string, fallback = true): boolean {
  const [match, setMatch] = useState(fallback);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** 문서가 보이는지 (탭 숨김이면 폴링을 멈춘다) */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}
