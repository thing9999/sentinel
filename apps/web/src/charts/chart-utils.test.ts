import { describe, expect, it } from "vitest";

import { formatTick, formatUnitValue, nearestIndex, niceMax, placeThresholdLabels, splitSegments, timeTicks } from "./chart-utils";
import { mergeRatePoints } from "../features/aws-cost/CostCharts";

describe("splitSegments (status.md 4.2 결측 끊기)", () => {
  it("값 null 이면 선을 끊는다", () => {
    const segs = splitSegments(
      [
        { t: 0, v: 1 },
        { t: 15, v: 2 },
        { t: 30, v: null },
        { t: 45, v: 3 },
        { t: 60, v: 4 },
      ],
      15,
    );
    expect(segs.map((s) => s.map((p) => p.v))).toEqual([[1, 2], [3, 4]]);
  });

  it("표본 간격이 수집 주기 × 2 를 넘으면 끊고, 2배 이하면 잇는다 (보간 없음)", () => {
    const segs = splitSegments(
      [
        { t: 0, v: 1 },
        { t: 30, v: 2 }, // 간격 30 = 2배 → 이음
        { t: 61, v: 3 }, // 간격 31 > 30 → 끊음
      ],
      15,
    );
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
  });
});

describe("축", () => {
  it("niceMax: 최대 × 1.1 을 1·2·2.5·5 × 10ⁿ 로 올림", () => {
    expect(niceMax(0.9)).toBe(1);
    expect(niceMax(1.1)).toBe(2);
    expect(niceMax(2.2)).toBe(2.5);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(845)).toBe(1000);
    expect(niceMax(0)).toBe(1);
  });

  it("1시간 범위는 10분 간격 눈금, HH:mm", () => {
    const end = new Date(2026, 8, 19, 14, 7, 0).getTime();
    const ticks = timeTicks(end - 3600_000, end, "1h");
    expect(ticks.length).toBe(6);
    expect(new Date(ticks[0]).getMinutes() % 10).toBe(0);
    expect(formatTick(ticks[0], "1h")).toMatch(/^\d{2}:\d0$/);
    expect(formatTick(new Date(2026, 8, 19).getTime(), "7d")).toBe("9/19");
  });

  it("임계선 라벨이 12px 이내로 겹치면 주의 라벨을 아래로", () => {
    expect(placeThresholdLabels([{ level: "warn", y: 50 }, { level: "crit", y: 60 }]).warn).toBe("below");
    expect(placeThresholdLabels([{ level: "warn", y: 50 }, { level: "crit", y: 80 }]).warn).toBe("above");
  });

  it("단위 표기 (status.md 4.6)", () => {
    expect(formatUnitValue(62.4, "percent")).toBe("62%");
    expect(formatUnitValue(62.4, "percent", true)).toBe("62.4%");
    expect(formatUnitValue(1250, "millicore")).toBe("1,250m");
    expect(formatUnitValue(1250, "millicore", true)).toBe("1,250m (1.25 cores)");
    expect(formatUnitValue(3.2 * 1024 ** 3, "bytes")).toBe("3.2 GiB");
    expect(formatUnitValue(1.1, "usdPerHour", true)).toBe("$1.10/h");
  });

  it("nearestIndex", () => {
    expect(nearestIndex([0, 10, 20], 14)).toBe(1);
    expect(nearestIndex([0, 10, 20], 16)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe("소모율 추이: REST + 스트림 표본", () => {
  const rest = [
    { t: "2026-09-19T05:00:00.000Z", usdPerHour: 1, status: "ok" as const },
    { t: "2026-09-19T05:05:00.000Z", usdPerHour: 1.1, status: "ok" as const },
  ];
  const live = [
    { t: "2026-09-19T05:05:00.000Z", usdPerHour: 9, status: "ok" as const },
    { t: "2026-09-19T05:10:00.000Z", usdPerHour: 1.2, status: "warning" as const },
  ];
  it("같은 해상도(5분)면 REST 마지막 이후 점만 붙인다", () => {
    expect(mergeRatePoints(rest, live, 300).map((p) => p.usdPerHour)).toEqual([1, 1.1, 1.2]);
  });
  it("30일·90일(구간 평균) 해상도에는 붙이지 않는다", () => {
    expect(mergeRatePoints(rest, live, 1800)).toBe(rest);
  });
});
