// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UiPreview } from "../__preview__/UiPreview";
import { RunResultAlert } from "../advisor/RunResultAlert";
import { SuggestionCard } from "../advisor/SuggestionCard";
import { CostKindBadge } from "../cost/CostKindBadge";
import { MetricTile } from "../cost/MetricTile";
import { MoneyValue } from "../cost/MoneyValue";
import { CodeBlock } from "../layout/CodeBlock";
import { ConnectionBanner, ConnectionIndicator } from "../shell/Connection";
import { DataSourceBadge } from "../shell/DataSourceBadge";
import { ReasonText } from "../status/ReasonText";
import { StatusBadge } from "../status/StatusBadge";

afterEach(() => cleanup());

const T0 = "2026-09-19T05:02:10.000Z";

describe("StatusBadge (status.md 1절)", () => {
  it("색 외에 아이콘과 문구를 함께 표시하고, 스크린리더에는 `상태: <문구>`로 읽힌다", () => {
    const { container } = render(<StatusBadge status="crit" reason="최근 1시간 재시작 6회" />);
    const badge = container.querySelector("[data-status='crit']")!;
    expect(badge.textContent).toBe("상태: 장애, 최근 1시간 재시작 6회");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("상태마다 다른 아이콘 모양을 쓴다", () => {
    const { container } = render(
      <>
        <StatusBadge status="ok" />
        <StatusBadge status="warn" />
        <StatusBadge status="crit" />
        <StatusBadge status="unknown" />
        <StatusBadge status="stale" />
      </>,
    );
    const icons = Array.from(container.querySelectorAll("svg")).map((s) => s.getAttribute("class"));
    expect(new Set(icons).size).toBe(5);
  });

  it("stale 은 `데이터 오래됨 · HH:mm:ss 기준`", () => {
    const { container } = render(<StatusBadge status="stale" staleAt={T0} previousStatus="crit" />);
    expect(container.textContent).toMatch(/데이터 오래됨 · \d{2}:\d{2}:\d{2} 기준/);
    expect(container.textContent).toContain("마지막 상태: 장애");
  });

  it("허용된 대체 문구와 dot 변형", () => {
    render(<StatusBadge status="crit" label="초과" variant="dot" />);
    expect(screen.getByText("초과")).toBeTruthy();
  });
});

describe("ReasonText", () => {
  it("첫 이유 + `외 N건`, 빈 목록이면 아무것도 그리지 않는다", () => {
    const { container, rerender } = render(<ReasonText reasons={["A 사유", "B 사유", "C 사유"]} status="crit" />);
    expect(container.textContent).toContain("A 사유");
    expect(container.textContent).toContain("외 2건");
    rerender(<ReasonText reasons={[]} status="ok" />);
    expect(container.textContent).toBe("");
  });
});

describe("금액 표시 (status.md 3절)", () => {
  it("추정은 ≈ 접두 + 스크린리더 `추정 약`", () => {
    const { container } = render(<MoneyValue amount={1.1} kind="estimate" unit="hour" />);
    expect(container.textContent).toContain("≈");
    expect(container.textContent).toContain("추정 약");
    expect(container.textContent).toContain("$1.10/h");
  });

  it("확정은 ≈ 없음", () => {
    const { container } = render(<MoneyValue amount={512} kind="confirmed" unit="total" settledThrough="9월 17일" />);
    expect(container.textContent).not.toContain("≈");
    expect(container.textContent).toContain("$512");
    expect(container.textContent).toContain("9월 17일까지 반영 · 최대 24시간 지연");
  });

  it("값이 없으면 `—` 와 알 수 없음", () => {
    const { container } = render(<MoneyValue amount={null} kind="confirmed" unit="total" unknownReason="AccessDenied" />);
    expect(container.textContent).toContain("—");
    expect(container.textContent).toContain("알 수 없음 (AccessDenied)");
  });

  it("증감액 부호와 예측 구간", () => {
    const { container } = render(
      <MoneyValue amount={845} kind="forecast" unit="total" range={{ low: 790, high: 900, confidence: 0.8 }} />,
    );
    expect(container.textContent).toContain("80% 구간 $790 – $900");
    render(<MoneyValue amount={-12} kind="confirmed" unit="total" delta />);
    expect(screen.getByText("−$12")).toBeTruthy();
  });

  it("추정 배지는 점선 테두리 클래스, 문구 `추정`", () => {
    render(<CostKindBadge kind="estimate" detail="서버 계산" />);
    expect(screen.getByText("추정 · 서버 계산")).toBeTruthy();
  });

  it("추정 타일은 dashed(estimate) 모양, unknown 이면 사유", () => {
    const { container } = render(
      <MetricTile label="Cost Explorer" state="unknown" unknownReason="Cost Explorer 사용 불가: AccessDenied" value={null} />,
    );
    expect(container.textContent).toContain("알 수 없음 (Cost Explorer 사용 불가: AccessDenied)");
    const { container: hidden } = render(<MetricTile label="예산" state="hidden" value={null} />);
    expect(hidden.innerHTML).toBe("");
  });
});

describe("연결 상태 (status.md 2.3)", () => {
  it("재연결 중은 횟수를 보이지만, 스크린리더 알림(role=status)에는 상태 문구만 넣는다", () => {
    render(<ConnectionIndicator status="reconnecting" retryCount={3} />);
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("재연결 중");
    expect(document.body.textContent).toContain("(3회째)");
  });

  it("API 불가와 연결 끊김을 구분한다", () => {
    const { rerender, container } = render(<ConnectionIndicator status="apiDown" />);
    expect(container.textContent).toContain("API 연결 없음");
    rerender(<ConnectionIndicator status="disconnected" />);
    expect(container.textContent).toContain("연결 끊김");
  });

  it("연결됨은 `실시간` + 마지막 수신 시각", () => {
    const { container } = render(<ConnectionIndicator status="open" lastEventAt={T0} justReconnected />);
    expect(container.textContent).toMatch(/실시간.*\d{2}:\d{2}:\d{2}/);
    expect(container.textContent).toContain("다시 연결됨");
  });

  it("끊김 배너: 마지막 갱신·재시도 횟수·다음 시도", () => {
    const { container } = render(<ConnectionBanner lastEventAt={T0} retryCount={3} nextRetryInMs={7200} onRetryNow={() => {}} />);
    expect(container.textContent).toMatch(/연결 끊김 - 마지막 갱신 \d{2}:\d{2}:\d{2}/);
    expect(container.textContent).toContain("재연결 시도 중 (3회째, 다음 시도 8초 후)");
    expect(screen.getByRole("button", { name: "지금 다시 연결" })).toBeTruthy();
  });

  it("MOCK 배지는 항상 보이고 live 는 LIVE 텍스트", () => {
    const { container, rerender } = render(<DataSourceBadge mode="mock" />);
    expect(container.textContent).toContain("MOCK");
    rerender(<DataSourceBadge mode="live" />);
    expect(container.textContent).toBe("LIVE");
  });
});

describe("LLM 출력은 텍스트로만 렌더한다", () => {
  const evil = '<img src=x onerror="alert(1)"><a href="https://evil.example">x</a>';
  const md = "**굵게** [링크](https://evil.example) https://evil.example";

  it("SuggestionCard: HTML·마크다운·URL 을 해석하지 않는다", () => {
    const { container } = render(
      <SuggestionCard
        priority={1}
        title={evil}
        category="cost"
        severity="high"
        targets={[{ name: evil, kind: "Deployment", missing: true }]}
        evidence={[{ text: `${md} 평균 18%`, value: "18%" }]}
        linkedRules={["R-GP2"]}
        savings={{ monthly: 84, formula: evil, source: "llm" }}
        steps={[{ text: md, code: { language: "bash", code: evil } }]}
        risk={{ level: "low", reason: evil }}
        verify={md}
        expanded
        onToggle={() => {}}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('a[href="https://evil.example"]')).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // 원문 그대로 텍스트로 보인다
    expect(container.textContent).toContain(evil);
    expect(container.textContent).toContain("**굵게** [링크](https://evil.example)");
    // 마크다운 굵게가 <strong>으로 바뀌지 않는다 (strong 은 서버 value 18% 강조 하나뿐)
    const strongs = Array.from(container.querySelectorAll("strong")).map((s) => s.textContent);
    expect(strongs).toEqual(["18%"]);
    // 실행·적용 버튼이 없다
    const buttons = within(container).getAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttons.some((t) => /실행|적용/.test(t))).toBe(false);
    expect(container.textContent).toContain("대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.");
  });

  it("CodeBlock: 코드 안의 태그를 해석하지 않는다", () => {
    const { container } = render(<CodeBlock code={evil} language="html" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("code")!.textContent).toBe(evil);
  });

  it("RunResultAlert: 원문 응답은 접힌 영역의 텍스트", () => {
    const { container } = render(<RunResultAlert reason="invalid_response" rawResponse={evil} />);
    expect(container.querySelector("details")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("details code")!.textContent).toBe(evil);
  });
});

describe("미리보기 스모크", () => {
  it("UiPreview 전체가 오류 없이 렌더된다", () => {
    const { container } = render(<UiPreview />);
    expect(container.querySelector(".app-shell")).not.toBeNull();
    expect(container.querySelector("main#main")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
