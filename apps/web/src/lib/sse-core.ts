/**
 * SSE 구독의 순수 로직 (React·브라우저 API에 의존하지 않음 → 단위 테스트 대상).
 * 훅은 `./sse.ts`에 있다.
 */

export type ConnectionStatus = "connecting" | "open" | "disconnected";

export interface BackoffOptions {
  /** 첫 재시도 대기 시간. 기본 1000ms */
  baseMs?: number;
  /** 대기 시간 상한. 기본 30000ms */
  maxMs?: number;
  /** 배수. 기본 2 */
  factor?: number;
  /** 0~1. 계산된 지연에 ±jitter 비율의 무작위 편차를 준다. 기본 0.2 */
  jitter?: number;
}

export const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  baseMs: 1000,
  maxMs: 30_000,
  factor: 2,
  jitter: 0.2,
};

/**
 * 재연결 대기 시간(ms). attempt는 0부터 (0 = 첫 재시도).
 * delay = min(maxMs, baseMs * factor^attempt) 에 ±jitter 적용, 결과도 [0, maxMs] 범위로 제한.
 * random은 [0, 1) 값을 돌려주는 함수 (테스트에서 주입).
 */
export function computeBackoffDelay(
  attempt: number,
  options: BackoffOptions = {},
  random: () => number = Math.random,
): number {
  const { baseMs, maxMs, factor, jitter } = { ...DEFAULT_BACKOFF, ...options };
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const raw = Math.min(maxMs, baseMs * Math.pow(factor, safeAttempt));
  const j = Math.min(Math.max(jitter, 0), 1);
  // random() ∈ [0,1) → offset ∈ [-j, +j)
  const offset = (random() * 2 - 1) * j;
  const delay = raw * (1 + offset);
  return Math.round(Math.min(maxMs, Math.max(0, delay)));
}

export interface FrameScheduler {
  schedule(callback: () => void): unknown;
  cancel(handle: unknown): void;
}

/** requestAnimationFrame 기반 스케줄러. rAF가 없는 환경(서버, 테스트)에서는 setTimeout(16)으로 대체. */
export function createFrameScheduler(): FrameScheduler {
  if (typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function") {
    return {
      schedule: (cb) => requestAnimationFrame(() => cb()),
      cancel: (handle) => cancelAnimationFrame(handle as number),
    };
  }
  return {
    schedule: (cb) => setTimeout(cb, 16),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export interface Batcher<T> {
  /** 항목을 쌓고, 예약된 flush가 없으면 다음 프레임에 예약한다. */
  push(item: T): void;
  /** 예약을 취소하고 쌓인 항목을 즉시 내보낸다. 비어 있으면 아무것도 안 한다. */
  flush(): void;
  /** 예약을 취소하고 쌓인 항목을 버린다. */
  clear(): void;
  readonly size: number;
}

/** 이벤트가 몰려도 프레임당 한 번만 onFlush를 부르도록 묶는다. */
export function createBatcher<T>(onFlush: (items: T[]) => void, scheduler: FrameScheduler): Batcher<T> {
  let queue: T[] = [];
  let handle: unknown = null;

  const run = () => {
    handle = null;
    if (queue.length === 0) return;
    const items = queue;
    queue = [];
    onFlush(items);
  };

  return {
    push(item) {
      queue.push(item);
      if (handle === null) handle = scheduler.schedule(run);
    },
    flush() {
      if (handle !== null) {
        scheduler.cancel(handle);
      }
      run();
    },
    clear() {
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
      queue = [];
    },
    get size() {
      return queue.length;
    },
  };
}

/** 쌓인 이벤트 중 가장 최근 수신 시각. 비어 있으면 null. */
export function latestReceivedAt(items: ReadonlyArray<{ receivedAt: number }>): number | null {
  let latest: number | null = null;
  for (const item of items) {
    if (latest === null || item.receivedAt > latest) latest = item.receivedAt;
  }
  return latest;
}
