// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BridgeStatusBar } from "../advisor/BridgeStatusBar";
import { RunResultAlert } from "../advisor/RunResultAlert";
import {
  badgeFromApi,
  categoryFromApi,
  costKindFromApi,
  projectedKindFromBasis,
  runStatusBadge,
  statusFromApi,
} from "../api-map";

afterEach(() => cleanup());

describe("api-map (status.md 8절)", () => {
  it("상태: warning→warn, critical→crit, 모르는 값→unknown(경고)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(statusFromApi("warning")).toBe("warn");
    expect(statusFromApi("critical")).toBe("crit");
    expect(statusFromApi("weird")).toBe("unknown");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("stale 플래그면 배지 키를 stale 로 교체하고 원래 상태는 previousStatus", () => {
    expect(badgeFromApi({ status: "critical", stale: true, updatedAt: "2026-09-19T05:02:10Z" })).toEqual({
      status: "stale",
      previousStatus: "crit",
      staleAt: "2026-09-19T05:02:10Z",
    });
    expect(badgeFromApi({ status: "ok", stale: false })).toEqual({ status: "ok" });
  });

  it("금액 kind: estimated→estimate, actual→confirmed, 모르는 값→null", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(costKindFromApi("estimated")).toBe("estimate");
    expect(costKindFromApi("actual")).toBe("confirmed");
    expect(costKindFromApi("forecast")).toBe("forecast");
    expect(costKindFromApi("x")).toBeNull();
    spy.mockRestore();
    expect(projectedKindFromBasis("estimated_month_end")).toBe("estimate");
    expect(projectedKindFromBasis("aws_forecast")).toBe("forecast");
  });

  it("카테고리 database→db, 실행 상태 문구", () => {
    expect(categoryFromApi("database")).toBe("db");
    expect(runStatusBadge("running")).toEqual({ status: "unknown", label: "진행 중", busy: true });
    expect(runStatusBadge("succeeded").label).toBe("완료");
    expect(runStatusBadge("cancelled").label).toBe("취소됨");
  });
});

describe("어드바이저 컴포넌트는 API 값을 그대로 받는다", () => {
  it("BridgeStatusBar: login_required → 주의 `로그인 필요` + 기본 메시지", () => {
    const { container } = render(<BridgeStatusBar bridge="login_required" command="claude" />);
    expect(container.textContent).toContain("로그인 필요");
    expect(container.textContent).toContain("호스트의 Claude Code 로그인이 만료됐습니다.");
    expect(container.querySelector("[data-status='warn']")).not.toBeNull();
    expect(container.querySelector("code")!.textContent).toBe("claude");
  });

  it("BridgeStatusBar: unreachable + 서버 message 는 기본 문구 대신 서버 문구", () => {
    const { container } = render(
      <BridgeStatusBar bridge="unreachable" message="브리지 토큰이 맞지 않습니다 (AGENT_BRIDGE_TOKEN 확인)" />,
    );
    expect(container.querySelector("[data-status='crit']")!.textContent).toContain("미실행");
    expect(container.textContent).toContain("브리지 토큰이 맞지 않습니다");
    expect(container.textContent).not.toContain("어드바이저 브리지가 실행되고 있지 않습니다");
  });

  it("RunResultAlert budget_exceeded: 서버 문구 + 안내 2줄 + 보낼 데이터 보기·다시 분석", () => {
    const { container } = render(
      <RunResultAlert
        reason="budget_exceeded"
        message="분석 비용이 상한 $2.00을 넘어 중단했습니다."
        onOpenPreview={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(container.textContent).toContain("분석 실패 · 비용 상한 초과");
    expect(container.textContent).toContain("분석 비용이 상한 $2.00을 넘어 중단했습니다.");
    expect(container.textContent).toContain("보낼 데이터 크기를 확인하세요.");
    expect(container.textContent).toContain("advisor.limits.maxBudgetUsd");
    expect(screen.getByRole("button", { name: /보낼 데이터 보기/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /다시 분석/ })).toBeTruthy();
  });

  it("RunResultAlert interrupted / 모르는 값은 기타", () => {
    const { container, rerender } = render(<RunResultAlert reason="interrupted" />);
    expect(container.textContent).toContain("분석 실패 · 서버 재시작으로 중단");
    expect(container.textContent).toContain("API 서버가 재시작되어 분석이 중단됐습니다.");
    rerender(<RunResultAlert reason="something_new" message="서버 메시지" />);
    expect(container.textContent).toContain("분석 실패");
    expect(container.textContent).toContain("서버 메시지");
  });
});
