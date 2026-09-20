import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDurationTable,
  formatDurationTimer,
  formatMillicores,
  formatMoney,
  formatMoneyRange,
  formatPercent,
  shortNodeName,
  splitForMiddleEllipsis,
} from "../format";

describe("formatMoney (status.md 3.2)", () => {
  it("시간당은 2자리 + /h, $0.01 미만은 <$0.01/h", () => {
    expect(formatMoney(1.1, "hour")).toBe("$1.10/h");
    expect(formatMoney(0.004, "hour")).toBe("<$0.01/h");
  });

  it("단가는 4자리", () => {
    expect(formatMoney(0.096, "unitPrice")).toBe("$0.0960/h");
    expect(formatMoney(0.0912, "gbMonth")).toBe("$0.0912/GB-월");
  });

  it("월·누적: $10 미만 2자리, $10 이상 0자리 + 천 단위 쉼표", () => {
    expect(formatMoney(4.38, "month")).toBe("$4.38/월");
    expect(formatMoney(845.4, "total")).toBe("$845");
    expect(formatMoney(1204, "total")).toBe("$1,204");
  });

  it("증감액은 부호 필수, 마이너스는 U+2212", () => {
    expect(formatMoney(0.48, "hour", { delta: true })).toBe("+$0.48/h");
    expect(formatMoney(-12, "total", { delta: true })).toBe("−$12");
  });

  it("단위 접미사 생략", () => {
    expect(formatMoney(23.41, "day", { showUnit: false })).toBe("$23.41");
  });

  it("범위는 en dash 앞뒤 공백", () => {
    expect(formatMoneyRange(790, 900)).toBe("$790 – $900");
  });
});

describe("formatPercent", () => {
  it("정수 %, 0 < 값 < 1% 이면 <1%", () => {
    expect(formatPercent(0.41)).toBe("41%");
    expect(formatPercent(0.004)).toBe("<1%");
    expect(formatPercent(0.77, { signed: true })).toBe("+77%");
    expect(formatPercent(-0.03, { signed: true })).toBe("−3%");
  });
});

describe("단위·시간", () => {
  it("CPU millicore", () => {
    expect(formatMillicores(1250)).toBe("1,250m");
    expect(formatMillicores(1250, true)).toBe("1,250m (1.25 cores)");
  });

  it("메모리 1024 기준", () => {
    expect(formatBytes(512 * 1024 * 1024)).toBe("512 MiB");
    expect(formatBytes(3.2 * 1024 ** 3)).toBe("3.2 GiB");
    expect(formatBytes(128 * 1024 ** 3)).toBe("128 GiB");
  });

  it("경과 시간은 큰 단위 2개까지", () => {
    expect(formatDurationTable(45_000)).toBe("45초");
    expect(formatDurationTable(252_000)).toBe("4분 12초");
    expect(formatDurationTable((2 * 3600 + 3 * 60) * 1000)).toBe("2시간 3분");
    expect(formatDurationTable((3 * 86400 + 4 * 3600) * 1000)).toBe("3일 4시간");
  });

  it("경과 타이머", () => {
    expect(formatDurationTimer(252_000)).toBe("4:12");
    expect(formatDurationTimer(3_852_000)).toBe("1:04:12");
  });
});

describe("리소스 이름", () => {
  it("가운데 말줄임은 끝 16자를 보존", () => {
    const { head, tail } = splitForMiddleEllipsis("api-server-deployment-7f9c8d6b5-x2kq9");
    expect(tail).toBe("-7f9c8d6b5-x2kq9");
    expect(head + tail).toBe("api-server-deployment-7f9c8d6b5-x2kq9");
  });

  it("짧은 이름은 자르지 않는다", () => {
    expect(splitForMiddleEllipsis("web-1")).toEqual({ head: "", tail: "web-1" });
  });

  it("노드 이름은 첫 . 앞만", () => {
    expect(shortNodeName("ip-10-0-12-34.ap-northeast-2.compute.internal")).toBe("ip-10-0-12-34");
  });
});
