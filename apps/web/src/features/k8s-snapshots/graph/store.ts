"use client";

/**
 * 브라우저 저장소에만 두는 값 (AC-3D08: 서버 요청 없음).
 * `useSyncExternalStore` 라 서버 렌더와 어긋나지 않고 효과 안에서 setState 를 하지 않는다.
 */
import { useSyncExternalStore } from "react";

import { webglAvailable } from "./scene/colors";

type Listener = () => void;

export function createStringStore<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const listeners = new Set<Listener>();
  const read = (): T => {
    try {
      const v = localStorage.getItem(key);
      return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    get: (): T => (typeof window === "undefined" ? fallback : read()),
    getServer: (): T => fallback,
    set(v: T) {
      try {
        localStorage.setItem(key, v);
      } catch {
        /* 저장 못 해도 화면은 바뀐다 */
      }
      for (const l of listeners) l();
    },
  };
}

/** 사용자가 고른 보기 (3D-D 2.3 `sentinel.snapshots.k8s.view3d`) */
export const view3dStore = createStringStore<"3d" | "table">("sentinel.snapshots.k8s.view3d", "3d", ["3d", "table"]);

/**
 * 범례를 한 번이라도 열어 봤는가 (3D-D 2.3, 2026-09-20 변경).
 * 옛 키 `sentinel.snapshots.k8s.legend` 는 **읽지 않는다**(boolean 접힘 상태라 뜻이 다르다).
 */
export const legendSeenStore = createStringStore<"0" | "1">("sentinel.snapshots.k8s.legendSeen", "0", ["0", "1"]);

export function useStringStore<T extends string>(store: ReturnType<typeof createStringStore<T>>): [T, (v: T) => void] {
  const v = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  return [v, store.set];
}

// ---------------------------------------------------------------- WebGL 지원 여부

let webglCache: boolean | null = null;
const noop = () => () => {};
/** 컨텍스트를 한 번만 만들어 본다(호출마다 만들면 비싸다) */
const readWebgl = (): boolean => (webglCache ??= webglAvailable());

/** 서버에서는 "쓸 수 있다"로 보고, 클라이언트에서 실제 값으로 바뀐다(AC-3D03) */
export const useWebglSupported = (): boolean => useSyncExternalStore(noop, readWebgl, () => true);
