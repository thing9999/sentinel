import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFixtures } from "../__fixtures__/fixtures";
import { BACKOFF, LINGER_MS, StreamClient, WATCHDOG_MS, type EventSourceLike } from "./client";
import { deriveConnectionView } from "./connection-view";
import type { ConnectionInfo } from "./client";

class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  listeners = new Map<string, ((ev: MessageEvent<string>) => void)[]>();
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, l: (ev: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, payload: unknown, seq = 1) {
    const data = JSON.stringify({ seq, topic: type.split(".")[0], emittedAt: new Date().toISOString(), payload });
    for (const l of this.listeners.get(type) ?? []) l({ type, data } as MessageEvent<string>);
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}

const sync = { schedule: (cb: () => void) => (cb(), 0), cancel: () => {} };

function makeClient() {
  const health = vi.fn(async () => true);
  const client = new StreamClient({ createEventSource: (url) => new FakeES(url), checkHealth: health, scheduler: sync, random: () => 0.5 });
  return { client, health };
}

const topicsOf = (url: string) => decodeURIComponent(new URL(url).searchParams.get("topics") ?? "");

describe("StreamClient (단일 연결 공유)", () => {
  beforeEach(() => {
    FakeES.all = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("시작하면 기본 토픽(overview·snapshot-menu)으로 연결하고, hello 를 받으면 open", () => {
    const { client } = makeClient();
    client.start();
    expect(FakeES.all).toHaveLength(1);
    expect(topicsOf(FakeES.all[0].url)).toBe("overview,snapshot-menu");
    expect(client.getSnapshot().connection.phase).toBe("connecting");
    FakeES.all[0].emit("stream.hello", buildFixtures(Date.now()).hello);
    expect(client.getSnapshot().connection.phase).toBe("open");
    expect(client.getSnapshot().stream.dataSource).toBe("mock");
    client.stop();
  });

  it("페이지가 토픽을 추가하면 합친 토픽으로 즉시 다시 연결(의도적 전환은 끊김으로 보지 않음)", () => {
    const { client } = makeClient();
    client.start();
    FakeES.all[0].emit("stream.hello", buildFixtures(Date.now()).hello);
    const release = client.retain(["cluster", "metrics"]);
    expect(FakeES.all).toHaveLength(2);
    expect(FakeES.all[0].closed).toBe(true);
    expect(topicsOf(FakeES.all[1].url)).toBe("overview,cluster,metrics,snapshot-menu");
    expect(client.getSnapshot().connection.phase).toBe("switching");
    expect(deriveConnectionView(client.getSnapshot().connection, Date.now()).indicator).toBe("open");

    // 같은 토픽을 다른 컴포넌트가 또 구독해도 재연결하지 않는다
    FakeES.all[1].emit("stream.hello", buildFixtures(Date.now()).hello);
    const release2 = client.retain(["cluster"]);
    expect(FakeES.all).toHaveLength(2);

    // 해제는 LINGER_MS 뒤에 정리한다 (참조가 남아 있으면 cluster 유지)
    release();
    vi.advanceTimersByTime(LINGER_MS + 10);
    expect(FakeES.all).toHaveLength(3);
    expect(topicsOf(FakeES.all[2].url)).toBe("overview,cluster,snapshot-menu");
    release2();
    client.stop();
  });

  it("오류 시 백오프(3초부터) 후 재연결하고, 재시도마다 health 로 API 응답을 확인한다", async () => {
    const { client, health } = makeClient();
    client.start();
    FakeES.all[0].emit("stream.hello", buildFixtures(Date.now()).hello);
    FakeES.all[0].fail();
    const c = client.getSnapshot().connection;
    expect(c.phase).toBe("waiting");
    expect(c.attempt).toBe(1);
    expect(c.nextRetryAt! - Date.now()).toBe(BACKOFF.baseMs);
    expect(health).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(BACKOFF.baseMs);
    expect(FakeES.all).toHaveLength(2);
    expect(client.getSnapshot().connection.phase).toBe("connecting");
    // 두 번째 실패는 6초
    FakeES.all[1].fail();
    expect(client.getSnapshot().connection.nextRetryAt! - Date.now()).toBe(BACKOFF.baseMs * 2);
    client.stop();
  });

  it("35초 동안 아무 이벤트도 없으면(heartbeat 누락) 연결을 닫고 재연결한다", () => {
    const { client } = makeClient();
    client.start();
    FakeES.all[0].emit("stream.hello", buildFixtures(Date.now()).hello);
    vi.advanceTimersByTime(WATCHDOG_MS - 1000);
    FakeES.all[0].emit("stream.heartbeat", { serverTime: new Date().toISOString() });
    vi.advanceTimersByTime(WATCHDOG_MS - 1000);
    expect(client.getSnapshot().connection.phase).toBe("open");
    vi.advanceTimersByTime(2000);
    expect(FakeES.all[0].closed).toBe(true);
    expect(client.getSnapshot().connection.phase).toBe("waiting");
    client.stop();
  });

  it("5초 넘게 끊겼다가 다시 연결되면 reconnectedAt(다시 연결됨 칩)을 남긴다", () => {
    const { client } = makeClient();
    client.start();
    FakeES.all[0].emit("stream.hello", buildFixtures(Date.now()).hello);
    FakeES.all[0].fail();
    vi.advanceTimersByTime(BACKOFF.baseMs);
    FakeES.all[1].fail();
    vi.advanceTimersByTime(BACKOFF.baseMs * 2);
    FakeES.all[2].emit("stream.hello", buildFixtures(Date.now()).hello);
    const c = client.getSnapshot().connection;
    expect(c.phase).toBe("open");
    expect(c.downSince).toBeNull();
    expect(c.reconnectedAt).toBe(Date.now());
    client.stop();
  });

  it("지금 다시 연결은 대기 타이머를 버리고 바로 연결한다", () => {
    const { client } = makeClient();
    client.start();
    FakeES.all[0].fail();
    client.reconnectNow();
    expect(FakeES.all).toHaveLength(2);
    expect(client.getSnapshot().connection.attempt).toBe(0);
    client.stop();
  });
});

describe("deriveConnectionView (status.md 2.3)", () => {
  const base: ConnectionInfo = {
    phase: "open",
    everOpened: true,
    attempt: 0,
    nextRetryAt: null,
    downSince: null,
    reconnectedAt: null,
    apiReachable: true,
    topics: ["overview"],
  };
  const now = 1_000_000;

  it("최초 연결 중 / 재연결 중 / 연결 끊김 / API 연결 없음", () => {
    expect(deriveConnectionView({ ...base, phase: "connecting", everOpened: false }, now).indicator).toBe("connecting");
    expect(deriveConnectionView({ ...base, phase: "connecting", attempt: 2 }, now).indicator).toBe("reconnecting");
    expect(deriveConnectionView({ ...base, phase: "waiting", attempt: 2, apiReachable: true }, now).indicator).toBe("disconnected");
    expect(deriveConnectionView({ ...base, phase: "waiting", attempt: 2, apiReachable: false }, now).indicator).toBe("apiDown");
  });

  it("배너는 끊김이 5초 이상 지속될 때만, API 불가면 문구가 바뀐다, 카운트다운은 다음 시도까지 남은 시간", () => {
    const down = { ...base, phase: "waiting" as const, attempt: 3, downSince: now - 4999, nextRetryAt: now + 8000 };
    expect(deriveConnectionView(down, now).showBanner).toBe(false);
    const v = deriveConnectionView({ ...down, downSince: now - 5000 }, now);
    expect(v.showBanner).toBe(true);
    expect(v.bannerMessage).toBe("연결 끊김");
    expect(v.retryCount).toBe(3);
    expect(v.nextRetryInMs).toBe(8000);
    expect(deriveConnectionView({ ...down, downSince: now - 6000, apiReachable: false }, now).bannerMessage).toBe("API에 연결할 수 없습니다");
  });

  it("탭 숨김(paused)이나 의도적 토픽 전환 중에는 배너를 띄우지 않는다", () => {
    expect(deriveConnectionView({ ...base, phase: "paused", downSince: now - 60_000 }, now).showBanner).toBe(false);
    expect(deriveConnectionView({ ...base, phase: "switching" }, now).showBanner).toBe(false);
  });

  it("다시 연결됨 칩은 3초 동안만", () => {
    expect(deriveConnectionView({ ...base, reconnectedAt: now - 1000 }, now).justReconnected).toBe(true);
    expect(deriveConnectionView({ ...base, reconnectedAt: now - 3000 }, now).justReconnected).toBe(false);
  });
});
