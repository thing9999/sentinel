/**
 * 하이드레이션 결함(alerts/frontend.md R2)의 재발 방지.
 *
 * 서버 렌더(`renderToString`)는 `useSyncExternalStore`의 **세 번째 인자**를 쓴다. 이 값이 살아 있는 스트림 값이면
 * 하이드레이션 중에도 같은 값을 보게 되어, 스냅샷이 먼저 도착한 `<Suspense>` 안 페이지(`/cluster/pods` 등)가
 * 서버 HTML(빈 표)과 달라진다. 그래서 서버 스냅샷은 **언제나 빈 초기값**이어야 한다.
 */
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { StreamEnvelope } from "../common/types";
import { SERVER_STREAM_SNAPSHOT, type StreamStore } from "./client";
import { applyBatch, initialStreamState } from "./reducer";
import { StreamProvider, useStreamStore, type StreamStoreLike } from "./StreamProvider";

function Probe() {
  const { stream, connection } = useStreamStore();
  return <p>{`${stream.alerts.loaded ? "live" : "empty"}:${stream.alerts.badge.unreadCount}:${connection.phase}`}</p>;
}

const live: StreamStore = {
  stream: applyBatch(initialStreamState, [
    {
      type: "alerts.snapshot",
      envelope: {
        seq: 1,
        topic: "alerts",
        emittedAt: "2026-09-25T05:00:00.000Z",
        payload: {
          badge: { unreadCount: 7, worstSeverity: "critical", updatedAt: "2026-09-25T05:00:00.000Z" },
          watch: null,
          dispatch: null,
          persistence: "memory",
          warmup: null,
          notices: [],
        },
      } as unknown as StreamEnvelope,
      receivedAt: 0,
    },
  ]),
  connection: { ...SERVER_STREAM_SNAPSHOT.connection, phase: "open", everOpened: true },
};

describe("useStreamStore 서버 스냅샷", () => {
  it("저장소에 살아 있는 값이 있어도 서버 렌더는 빈 초기값을 그린다", () => {
    expect(live.stream.alerts.badge.unreadCount).toBe(7);
    const store: StreamStoreLike = {
      subscribe: () => () => {},
      getSnapshot: () => live,
      retain: () => () => {},
      reconnectNow: vi.fn(),
    };
    const html = renderToString(
      <StreamProvider client={store}>
        <Probe />
      </StreamProvider>,
    );
    expect(html).toContain("empty:0:idle");
    expect(html).not.toContain("live:7");
  });

  it("서버 스냅샷은 매번 같은 참조다(아니면 React 가 무한 렌더 경고를 낸다)", () => {
    expect(SERVER_STREAM_SNAPSHOT.stream).toBe(initialStreamState);
    expect(Object.isFrozen(SERVER_STREAM_SNAPSHOT)).toBe(true);
  });
});
