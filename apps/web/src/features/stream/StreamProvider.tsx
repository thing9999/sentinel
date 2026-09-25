"use client";

/**
 * 앱 전체에서 SSE 연결 하나를 공유한다 (StreamClient). 페이지는 useTopics 로 필요한 토픽만 추가·해제한다.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { StreamTopic } from "../common/types";
import { SERVER_STREAM_SNAPSHOT, StreamClient, type StreamStore } from "./client";

/** 테스트·미리보기에서 가짜 저장소를 넣을 수 있게 최소 인터페이스만 쓴다 */
export interface StreamStoreLike {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StreamStore;
  retain(topics: readonly StreamTopic[]): () => void;
  reconnectNow(): void;
  start?(): void;
  stop?(): void;
}

const StreamContext = createContext<StreamStoreLike | null>(null);

export function StreamProvider({ children, client }: { children: ReactNode; client?: StreamStoreLike }) {
  const [store] = useState<StreamStoreLike>(() => client ?? new StreamClient());
  useEffect(() => {
    store.start?.();
    return () => store.stop?.();
  }, [store]);
  return <StreamContext.Provider value={store}>{children}</StreamContext.Provider>;
}

export function useStreamClient(): StreamStoreLike {
  const store = useContext(StreamContext);
  if (!store) throw new Error("StreamProvider 가 필요합니다");
  return store;
}

const getServerStreamSnapshot = (): StreamStore => SERVER_STREAM_SNAPSHOT;

/**
 * 스트림 상태 전체 (배치당 1회 갱신).
 *
 * 세 번째 인자(`getServerSnapshot`)는 **살아 있는 값이 아니라 빈 초기값**이다. 서버 렌더와 하이드레이션이 같은 값을 봐야
 * 한다 — 스트림 스냅샷이 하이드레이션보다 먼저 도착해도 서버 HTML 과 트리가 갈리지 않는다(`client.ts` 설명).
 * 그래서 화면마다 `useIsClient()`로 미뤄 그릴 필요가 없다.
 */
export function useStreamStore(): StreamStore {
  const store = useStreamClient();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerStreamSnapshot);
}

/** 이 컴포넌트가 떠 있는 동안 토픽을 구독한다 */
export function useTopics(topics: readonly StreamTopic[]): void {
  const store = useStreamClient();
  const key = [...topics].sort().join(",");
  useEffect(() => {
    const list = key ? (key.split(",") as StreamTopic[]) : [];
    return store.retain(list);
  }, [store, key]);
}
