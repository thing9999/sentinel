import { describe, expect, it, vi } from "vitest";

import {
  type FrameScheduler,
  computeBackoffDelay,
  createBatcher,
  latestReceivedAt,
} from "./sse-core";

const noJitter = { jitter: 0 };

describe("computeBackoffDelay", () => {
  it("attempt마다 factor배로 늘어난다", () => {
    expect(computeBackoffDelay(0, noJitter)).toBe(1000);
    expect(computeBackoffDelay(1, noJitter)).toBe(2000);
    expect(computeBackoffDelay(2, noJitter)).toBe(4000);
    expect(computeBackoffDelay(3, { baseMs: 500, factor: 3, jitter: 0 })).toBe(13_500);
  });

  it("maxMs를 넘지 않는다 (큰 attempt에서도)", () => {
    expect(computeBackoffDelay(10, noJitter)).toBe(30_000);
    expect(computeBackoffDelay(10_000, noJitter)).toBe(30_000);
    expect(computeBackoffDelay(20, { jitter: 0.5 }, () => 0.999)).toBeLessThanOrEqual(30_000);
  });

  it("jitter는 ±비율 범위 안에서 적용된다", () => {
    expect(computeBackoffDelay(1, { jitter: 0.2 }, () => 0)).toBe(1600); // -20%
    expect(computeBackoffDelay(1, { jitter: 0.2 }, () => 0.5)).toBe(2000); // 0
    const high = computeBackoffDelay(1, { jitter: 0.2 }, () => 0.9999);
    expect(high).toBeGreaterThan(2000);
    expect(high).toBeLessThanOrEqual(2400);
  });

  it("음수·NaN attempt는 0으로 취급한다", () => {
    expect(computeBackoffDelay(-3, noJitter)).toBe(1000);
    expect(computeBackoffDelay(Number.NaN, noJitter)).toBe(1000);
  });
});

function manualScheduler() {
  const pending = new Map<number, () => void>();
  let nextId = 1;
  const scheduler: FrameScheduler = {
    schedule(cb) {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancel(handle) {
      pending.delete(handle as number);
    },
  };
  const tick = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((cb) => cb());
  };
  return { scheduler, tick, pendingCount: () => pending.size };
}

describe("createBatcher", () => {
  it("한 프레임 안의 이벤트를 한 번에 내보낸다", () => {
    const { scheduler, tick, pendingCount } = manualScheduler();
    const onFlush = vi.fn();
    const batcher = createBatcher<number>(onFlush, scheduler);

    batcher.push(1);
    batcher.push(2);
    batcher.push(3);
    expect(pendingCount()).toBe(1);
    expect(onFlush).not.toHaveBeenCalled();

    tick();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith([1, 2, 3]);
    expect(batcher.size).toBe(0);

    batcher.push(4);
    tick();
    expect(onFlush).toHaveBeenLastCalledWith([4]);
  });

  it("flush는 즉시 내보내고 예약을 취소한다", () => {
    const { scheduler, tick, pendingCount } = manualScheduler();
    const onFlush = vi.fn();
    const batcher = createBatcher<string>(onFlush, scheduler);

    batcher.push("a");
    batcher.flush();
    expect(onFlush).toHaveBeenCalledWith(["a"]);
    expect(pendingCount()).toBe(0);

    tick();
    batcher.flush();
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it("clear는 쌓인 항목을 버린다", () => {
    const { scheduler, tick } = manualScheduler();
    const onFlush = vi.fn();
    const batcher = createBatcher<string>(onFlush, scheduler);

    batcher.push("a");
    batcher.clear();
    tick();
    expect(onFlush).not.toHaveBeenCalled();
    expect(batcher.size).toBe(0);
  });
});

describe("latestReceivedAt", () => {
  it("가장 최근 시각을 돌려준다", () => {
    expect(latestReceivedAt([])).toBeNull();
    expect(latestReceivedAt([{ receivedAt: 5 }, { receivedAt: 9 }, { receivedAt: 7 }])).toBe(9);
  });
});
