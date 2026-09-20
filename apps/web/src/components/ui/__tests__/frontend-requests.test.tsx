// @vitest-environment jsdom
/** 프론트 통합(5a) 퍼블리셔 요청 반영분 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RunProgressPanel, type AdvisorRun } from "../advisor/RunProgressPanel";
import { RunResultAlert, formatLimitSec, withSubjectParticle } from "../advisor/RunResultAlert";
import { EvidenceText, SuggestionCard, type SuggestionEvidence } from "../advisor/SuggestionCard";
import { DataSourceBadge, SCENARIO_GROUPS } from "../shell/DataSourceBadge";

afterEach(() => cleanup());

describe("DataSourceBadge 시나리오 그룹", () => {
  it("cluster·db·cost·advisor 순서로 그룹을 보여 주고 db 선택을 알린다", () => {
    expect(SCENARIO_GROUPS).toEqual(["cluster", "db", "cost", "advisor", "snapshots", "k8s-snapshots"]);
    const calls: Array<[string, string]> = [];
    render(
      <DataSourceBadge
        mode="mock"
        scenarios={[
          { id: "advisor-ok", label: "어드바이저 정상", group: "advisor", active: true },
          { id: "db-ok", label: "DB 정상", group: "db", active: true },
          { id: "db-lag", label: "복제 지연", group: "db", active: false },
          { id: "cluster-ok", label: "클러스터 정상", group: "cluster", active: true },
        ]}
        onScenarioChange={(g, id) => calls.push([g, id])}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const legends = Array.from(document.querySelectorAll("legend")).map((l) => l.textContent);
    expect(legends).toEqual(["클러스터", "DB", "어드바이저"]);
    fireEvent.click(screen.getByLabelText("복제 지연"));
    expect(calls).toEqual([["db", "db-lag"]]);
  });
});

describe("어드바이저 한도 문구", () => {
  it("formatLimitSec: 초 → 문구, 잘못된 값은 기본값", () => {
    expect(formatLimitSec(600, 600)).toBe("10분");
    expect(formatLimitSec(90, 600)).toBe("1분 30초");
    expect(formatLimitSec(undefined, 600)).toBe("10분");
    expect(formatLimitSec(0, 300)).toBe("5분");
    expect(formatLimitSec(Number.NaN, 300)).toBe("5분");
    expect(withSubjectParticle("10분")).toBe("10분이");
    expect(withSubjectParticle("1분 30초")).toBe("1분 30초가");
  });

  it("RunResultAlert timeout: timeoutSec 을 제목·설명에 쓴다 (기본 10분)", () => {
    const { container, rerender } = render(<RunResultAlert reason="timeout" />);
    expect(container.textContent).toContain("분석 실패 · 시간 초과 (10분)");
    expect(container.textContent).toContain("브리지가 10분 안에 응답을 마치지 못했습니다.");
    rerender(<RunResultAlert reason="timeout" timeoutSec={900} />);
    expect(container.textContent).toContain("분석 실패 · 시간 초과 (15분)");
    expect(container.textContent).toContain("브리지가 15분 안에");
    expect(container.textContent).not.toContain("{limit}");
  });

  it("RunProgressPanel 지연 안내: slowAfterSec·timeoutSec (기본 5분·10분)", () => {
    const run: AdvisorRun = {
      id: "r1",
      startedAt: new Date(Date.now() - 400_000).toISOString(),
      stage: "receive",
      stages: [{ id: "receive", label: "응답 수신 중", state: "active" }],
      delayed: true,
      example: false,
    };
    const { container, rerender } = render(<RunProgressPanel run={run} onCancel={() => {}} />);
    expect(container.textContent).toContain("5분이 넘었습니다");
    expect(container.textContent).toContain("10분이 지나면 자동으로 실패 처리됩니다.");
    rerender(<RunProgressPanel run={run} onCancel={() => {}} timeoutSec={1200} slowAfterSec={90} />);
    expect(container.textContent).toContain("1분 30초가 넘었습니다");
    expect(container.textContent).toContain("20분이 지나면");
  });
});

describe("SuggestionCard 근거 값", () => {
  const strongs = (el: HTMLElement) => Array.from(el.querySelectorAll("strong")).map((s) => s.textContent);

  it("값이 문장에 있으면 그 자리만 굵게, 덧붙이지 않는다", () => {
    const { container } = render(<p>{EvidenceText({ text: "batch 노드 CPU 평균 18%", value: "18%" })}</p>);
    expect(container.textContent).toBe("batch 노드 CPU 평균 18%");
    expect(strongs(container)).toEqual(["18%"]);
  });

  it("값이 문장에 없으면 붙이지 않는다", () => {
    const { container } = render(<p>{EvidenceText({ text: "batch 노드가 대부분 쉬고 있다", value: "18%" })}</p>);
    expect(container.textContent).toBe("batch 노드가 대부분 쉬고 있다");
    expect(strongs(container)).toEqual([]);
  });

  it("값이 없거나 빈 문자열이면 문장만", () => {
    for (const value of [undefined, null, "", "  "]) {
      const { container } = render(<p>{EvidenceText({ text: "근거 문장", value })}</p>);
      expect(container.textContent).toBe("근거 문장");
      expect(strongs(container)).toEqual([]);
      cleanup();
    }
  });

  it("카드 안에서도 같은 규칙", () => {
    const evidence: SuggestionEvidence[] = [
      { text: "CPU 평균 18%", value: "18%", field: "nodes[batch].cpu.avg" },
      { text: "gp2 볼륨이 남아 있다", value: "3개" },
      { text: "값 없는 근거" },
    ];
    const { container } = render(
      <SuggestionCard
        priority={2}
        title="batch 노드그룹 축소"
        category="cost"
        severity="medium"
        targets={[]}
        evidence={evidence}
        linkedRules={[]}
        savings={null}
        steps={[]}
        risk={{ level: "low", reason: "야간 배치만 영향" }}
        expanded
        onToggle={() => {}}
      />,
    );
    const items = Array.from(container.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toContain("CPU 평균 18% (nodes[batch].cpu.avg)");
    expect(items).toContain("gp2 볼륨이 남아 있다");
    expect(items).toContain("값 없는 근거");
    expect(container.textContent).not.toContain("3개");
    expect(strongs(container)).toEqual(["18%"]);
  });
});
