/**
 * 앱 전체가 공유하는 SSE 연결 하나 (`GET /api/stream?topics=...`, docs/api/common.md 5절).
 *
 * - 토픽은 참조 카운트로 관리한다. 필요한 토픽이 늘면 새 토픽 집합으로 곧바로 다시 연결하고(스냅샷 재수신),
 *   줄어든 토픽은 LINGER_MS 뒤에 정리한다(페이지를 오갈 때 재연결이 잦지 않게).
 * - 끊김 감지: 마지막 수신(아무 이벤트) 후 WATCHDOG_MS(heartbeat 15초 × 2 + 여유 = 35초) 동안 조용하면 끊고 재연결.
 * - 재연결: 오류 시 EventSource 를 닫고 지수 백오프(3초 → 최대 30초)로 새로 연다(브라우저 기본 재연결 안 씀).
 *   `Last-Event-ID` 는 쓰지 않는다. 새 연결은 항상 stream.hello + 전체 스냅샷으로 시작한다.
 * - 탭이 HIDDEN_GRACE_MS 넘게 숨겨지면 연결을 닫고(서버 동시 연결 상한 20 보호), 보이면 즉시 다시 연다.
 * - 이벤트는 requestAnimationFrame 단위로 묶어 리듀서에 한 번에 반영한다.
 */
import { apiFetch, apiUrl } from "@/lib/api";
import { type Batcher, computeBackoffDelay, createBatcher, createFrameScheduler, type FrameScheduler } from "@/lib/sse-core";

import type { HealthResponse, StreamEnvelope, StreamTopic } from "../common/types";
import { applyBatch, initialStreamState, STREAM_EVENT_TYPES, type StreamEventInput, type StreamState } from "./reducer";

export const WATCHDOG_MS = 35_000;
export const LINGER_MS = 30_000;
export const HIDDEN_GRACE_MS = 15_000;
export const BACKOFF = { baseMs: 3000, maxMs: 30_000, factor: 2, jitter: 0.2 } as const;
/**
 * 항상 구독하는 토픽 (사이드바·상단바). `snapshot-menu`는 사이드바 "스냅샷" 메뉴 배지용
 * (docs/api/k8s-snapshot.md 12절: AWS·k8s 합산 값). `aws-snapshots`·`k8s-snapshots`는 해당 화면이 구독한다.
 */
export const BASE_TOPICS: readonly StreamTopic[] = ["overview", "snapshot-menu"];
/** 서버 스냅샷 순서와 같게 (common.md 5절) */
const TOPIC_ORDER: readonly StreamTopic[] = [
  "overview",
  "cluster",
  "metrics",
  "db",
  "cost",
  "advisor",
  "aws-snapshots",
  "k8s-snapshots",
  "snapshot-menu",
];

export type ConnectionPhase =
  /** 시작 전 */
  | "idle"
  /** EventSource 를 열고 stream.hello 를 기다리는 중 */
  | "connecting"
  /** stream.hello 받음 */
  | "open"
  /** 토픽 변경으로 의도적으로 다시 연결하는 중 (끊김 아님) */
  | "switching"
  /** 오류 후 다음 시도 대기 */
  | "waiting"
  /** 탭 숨김으로 닫음 */
  | "paused";

export interface ConnectionInfo {
  phase: ConnectionPhase;
  /** 한 번이라도 stream.hello 를 받았는지 */
  everOpened: boolean;
  /** 연속 실패 횟수 (open 되면 0) */
  attempt: number;
  /** 다음 재연결 예정 시각 (epoch ms) */
  nextRetryAt: number | null;
  /** 연결이 끊긴 시각 (open 이면 null). 배너 5초 지연 기준 */
  downSince: number | null;
  /** 끊김(5초 이상) 뒤 다시 연결된 시각 → `다시 연결됨` 칩 */
  reconnectedAt: number | null;
  /** 마지막 /api/health 결과: false 면 API 자체가 응답 없음 */
  apiReachable: boolean | null;
  /** 현재 연결의 토픽 */
  topics: StreamTopic[];
}

export interface StreamStore {
  stream: StreamState;
  connection: ConnectionInfo;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: MessageEvent<string>) => void): void;
  close(): void;
  onerror: ((ev: Event) => void) | null;
  onopen: ((ev: Event) => void) | null;
}

export interface StreamClientOptions {
  createEventSource?: (url: string) => EventSourceLike;
  checkHealth?: () => Promise<boolean>;
  scheduler?: FrameScheduler;
  now?: () => number;
  random?: () => number;
}

const initialConnection: ConnectionInfo = {
  phase: "idle",
  everOpened: false,
  attempt: 0,
  nextRetryAt: null,
  downSince: null,
  reconnectedAt: null,
  apiReachable: null,
  topics: [],
};

async function defaultCheckHealth(): Promise<boolean> {
  try {
    await apiFetch<HealthResponse>("/health", { timeoutMs: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function topicsKey(topics: readonly StreamTopic[]): string {
  return TOPIC_ORDER.filter((t) => topics.includes(t)).join(",");
}

export class StreamClient {
  private store: StreamStore = { stream: initialStreamState, connection: initialConnection };
  private listeners = new Set<() => void>();
  private refs = new Map<StreamTopic, number>();
  private source: EventSourceLike | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  private lingerTimer: ReturnType<typeof setTimeout> | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private batcher: Batcher<StreamEventInput>;
  private readonly opts: Required<Omit<StreamClientOptions, "scheduler">>;

  constructor(options: StreamClientOptions = {}) {
    this.opts = {
      createEventSource:
        options.createEventSource ?? ((url) => new EventSource(url, { withCredentials: false }) as unknown as EventSourceLike),
      checkHealth: options.checkHealth ?? defaultCheckHealth,
      now: options.now ?? (() => Date.now()),
      random: options.random ?? Math.random,
    };
    this.batcher = createBatcher<StreamEventInput>(
      (items) => this.update({ stream: applyBatch(this.store.stream, items) }),
      options.scheduler ?? createFrameScheduler(),
    );
  }

  // ---- 외부 저장소 (useSyncExternalStore) ----
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StreamStore => this.store;

  private update(patch: { stream?: StreamState; connection?: Partial<ConnectionInfo> }) {
    this.store = {
      stream: patch.stream ?? this.store.stream,
      connection: patch.connection ? { ...this.store.connection, ...patch.connection } : this.store.connection,
    };
    for (const l of this.listeners) l();
  }

  // ---- 토픽 ----
  /** 토픽을 구독한다. 돌려준 함수를 부르면 해제(참조 카운트). */
  retain(topics: readonly StreamTopic[]): () => void {
    for (const t of topics) this.refs.set(t, (this.refs.get(t) ?? 0) + 1);
    this.syncTopics();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const t of topics) {
        const n = (this.refs.get(t) ?? 0) - 1;
        if (n <= 0) this.refs.delete(t);
        else this.refs.set(t, n);
      }
      this.syncTopics();
    };
  }

  desiredTopics(): StreamTopic[] {
    const set = new Set<StreamTopic>([...BASE_TOPICS, ...this.refs.keys()]);
    return TOPIC_ORDER.filter((t) => set.has(t));
  }

  private syncTopics() {
    if (!this.started) return;
    const desired = this.desiredTopics();
    const active = this.store.connection.topics;
    const missing = desired.some((t) => !active.includes(t));
    if (missing) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = undefined;
      // 연결 중이 아니면(대기·숨김) 다음 연결 때 반영된다
      const phase = this.store.connection.phase;
      if (phase === "open" || phase === "connecting" || phase === "switching") {
        this.connect(desired, { intentional: phase === "open" || phase === "switching" });
      }
      return;
    }
    const extra = active.some((t) => !desired.includes(t));
    if (extra && !this.lingerTimer) {
      this.lingerTimer = setTimeout(() => {
        this.lingerTimer = undefined;
        const d = this.desiredTopics();
        const a = this.store.connection.topics;
        if (this.store.connection.phase === "open" && topicsKey(d) !== topicsKey(a)) this.connect(d, { intentional: true });
      }, LINGER_MS);
    } else if (!extra && this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = undefined;
    }
  }

  // ---- 수명 ----
  start() {
    if (this.started) return;
    this.started = true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibility);
      if (document.visibilityState === "hidden") {
        this.update({ connection: { phase: "paused" } });
        return;
      }
    }
    this.connect(this.desiredTopics(), { intentional: false });
  }

  stop() {
    this.started = false;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.closeSource();
    clearTimeout(this.retryTimer);
    clearTimeout(this.lingerTimer);
    clearTimeout(this.hiddenTimer);
    this.lingerTimer = undefined;
    this.batcher.clear();
  }

  /** 배너의 `지금 다시 연결` */
  reconnectNow() {
    if (!this.started) return;
    clearTimeout(this.retryTimer);
    this.update({ connection: { attempt: 0 } });
    this.connect(this.desiredTopics(), { intentional: false });
  }

  private onVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "hidden") {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = undefined;
        clearTimeout(this.retryTimer);
        this.closeSource();
        this.batcher.flush();
        this.update({ connection: { phase: "paused", nextRetryAt: null } });
      }, HIDDEN_GRACE_MS);
      // 숨김 중에는 재시도 대기(=health 폴링 포함)를 멈춘다
      if (this.store.connection.phase === "waiting") {
        clearTimeout(this.retryTimer);
        this.update({ connection: { phase: "paused", nextRetryAt: null } });
      }
    } else {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = undefined;
      if (this.store.connection.phase === "paused") {
        this.update({ connection: { attempt: 0, downSince: this.opts.now() } });
        this.connect(this.desiredTopics(), { intentional: false });
      }
    }
  };

  private closeSource() {
    clearTimeout(this.watchdogTimer);
    if (this.source) {
      this.source.onerror = null;
      this.source.onopen = null;
      this.source.close();
      this.source = null;
    }
  }

  private armWatchdog() {
    clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => this.fail(), WATCHDOG_MS);
  }

  private connect(topics: StreamTopic[], { intentional }: { intentional: boolean }) {
    clearTimeout(this.retryTimer);
    this.closeSource();
    this.batcher.flush();
    const url = apiUrl("/stream", { topics: topicsKey(topics) });
    const es = this.opts.createEventSource(url);
    this.source = es;
    this.update({
      connection: {
        phase: intentional ? "switching" : "connecting",
        topics,
        nextRetryAt: null,
      },
    });
    this.armWatchdog();

    es.onerror = () => {
      if (this.source !== es) return;
      this.fail();
    };
    const handler = (ev: MessageEvent<string>) => {
      if (this.source !== es) return;
      this.armWatchdog();
      let envelope: StreamEnvelope;
      try {
        envelope = JSON.parse(ev.data) as StreamEnvelope;
      } catch {
        return;
      }
      const receivedAt = this.opts.now();
      if (ev.type === "stream.hello") this.onHello(receivedAt);
      if (ev.type === "stream.closing") {
        // 서버 종료 예고: 일반 끊김처럼 재연결한다
        this.batcher.push({ type: ev.type, envelope, receivedAt });
        this.fail();
        return;
      }
      this.batcher.push({ type: ev.type, envelope, receivedAt });
    };
    for (const type of STREAM_EVENT_TYPES) es.addEventListener(type, handler);
  }

  private onHello(at: number) {
    const c = this.store.connection;
    const wasDownLong = c.downSince !== null && at - c.downSince >= 5000;
    this.update({
      connection: {
        phase: "open",
        everOpened: true,
        attempt: 0,
        nextRetryAt: null,
        downSince: null,
        apiReachable: true,
        reconnectedAt: wasDownLong && c.everOpened ? at : c.reconnectedAt,
      },
    });
    // hello 를 받은 뒤 토픽이 또 바뀌었으면 맞춘다
    this.syncTopics();
  }

  private fail() {
    this.closeSource();
    this.batcher.flush();
    if (!this.started) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.update({ connection: { phase: "paused", downSince: this.store.connection.downSince ?? this.opts.now() } });
      return;
    }
    const now = this.opts.now();
    const attempt = this.store.connection.attempt;
    const delay = computeBackoffDelay(attempt, BACKOFF, this.opts.random);
    this.update({
      connection: {
        phase: "waiting",
        attempt: attempt + 1,
        nextRetryAt: now + delay,
        downSince: this.store.connection.downSince ?? now,
      },
    });
    // 스트림이 끊겼을 때만 health 로 API 응답 여부를 확인한다(폴링 아님: 재시도마다 1회)
    void this.opts.checkHealth().then((ok) => {
      if (this.store.connection.phase !== "open") this.update({ connection: { apiReachable: ok } });
    });
    this.retryTimer = setTimeout(() => this.connect(this.desiredTopics(), { intentional: false }), delay);
  }
}
