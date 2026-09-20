// @vitest-environment jsdom
/** k8s-snapshot 퍼블리셔 작업: 새 컴포넌트(components.md 14절) + 기존 확장(15절) */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NoExecuteNotice } from "../advisor/Labels";
import { Icon } from "../icons";
import { DiffValue, MaskedValue, differsOnlyByType, scalarText, scalarTypeLabel } from "../k8s/DiffValue";
import { formatDriftBreakdown, formatDriftCount, formatDriftLastResult } from "../k8s/drift";
import { DriftSummary, driftChangeText, hiddenSummaryText, notComparableChip } from "../k8s/DriftSummary";
import { DriftCountChip, DriftKindChip, DriftKindIcon, DriftStatus } from "../k8s/DriftStatus";
import { FIELDS_TRUNCATED_TEXT, FieldDiffTable, hiddenBreakdown, pathWithBreaks, type FieldDiffRow } from "../k8s/FieldDiffTable";
import { ResourceTree } from "../k8s/ResourceTree";
import {
  aggregateMarkers,
  defaultExpandedIds,
  filterTree,
  flattenVisible,
  treeRowSrText,
  treeVisibleRange,
  type TreeNode,
} from "../k8s/resourceTreeModel";
import { LinkTabs, linkTabSrText } from "../layout/LinkTabs";
import { DataSourceBadge, SCENARIO_GROUPS } from "../shell/DataSourceBadge";
import { DEFAULT_NAV_ITEMS, SideNav } from "../shell/SideNav";
import { ScanFindingList, splitFileLocation } from "../snapshot/ScanFindingList";
import { LabeledStatus } from "../status/LabeledStatus";
import { StatusBadge } from "../status/StatusBadge";

afterEach(() => cleanup());

// ───────────────────────── 기존 확장 (15절) ─────────────────────────
describe("기존 확장 (components.md 15절)", () => {
  it("아이콘 15개 등록 (13절)", () => {
    const names = [
      "git-compare",
      "square-plus",
      "square-minus",
      "square-dot",
      "eye-off",
      "ship-wheel",
      "link-2-off",
      "globe",
      "layers",
      "file-text",
      "chevrons-up-down",
      "chevrons-down-up",
      "settings-2",
      "bot",
      "git-branch",
    ] as const;
    const { container } = render(
      <>
        {names.map((n) => (
          <Icon key={n} name={n} size={12} />
        ))}
      </>,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(names.length);
  });

  it("SideNav 기본 항목 9번 라벨 `스냅샷`, 경로·아이콘·그룹 그대로", () => {
    const item = DEFAULT_NAV_ITEMS.find((i) => i.href === "/snapshots");
    expect(item).toMatchObject({ label: "스냅샷", icon: "archive", group: "로컬 파일" });
    render(
      <SideNav
        items={DEFAULT_NAV_ITEMS.map((i) =>
          i.href === "/snapshots" ? { ...i, status: "crit" as const, statusLabel: "커밋 금지", count: 3 } : i,
        )}
        currentPath="/snapshots/k8s/20260919-061000"
        collapsed={false}
      />,
    );
    const link = screen.getByRole("link", { name: "스냅샷, 커밋 금지 3개" });
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("DataSourceBadge: Kubernetes 스냅샷 그룹 하나(`k8s-snapshots`, 드리프트 시나리오 포함)가 AWS 스냅샷 뒤", () => {
    expect(SCENARIO_GROUPS.slice(0, 5)).toEqual(["cluster", "db", "cost", "advisor", "snapshots"]);
    expect(SCENARIO_GROUPS.slice(5)).toEqual(["k8s-snapshots"]);
    const calls: string[] = [];
    render(
      <DataSourceBadge
        mode="mock"
        scenarios={[
          { id: "k-default", label: "예시 스냅샷 (기본)", group: "k8s-snapshots", active: true },
          { id: "k-nodrift", label: "드리프트 없음", group: "k8s-snapshots", active: false },
          { id: "a-default", label: "AWS 예시", group: "snapshots", active: true },
        ]}
        onScenarioChange={(g, id) => calls.push(`${g}:${id}`)}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const legends = Array.from(document.querySelectorAll("legend")).map((l) => l.textContent);
    expect(legends).toEqual(["AWS 스냅샷", "Kubernetes 스냅샷"]);
    act(() => {
      fireEvent.click(screen.getByLabelText("드리프트 없음"));
    });
    expect(calls).toEqual(["k8s-snapshots:k-nodrift"]);
  });

  it("ScanFindingList truncateFile: 뒤쪽 `파일 이름:줄` 보존, 툴팁·스크린리더는 전체 경로", () => {
    expect(splitFileLocation("data/statefulsets/postgres.yaml:41")).toEqual({
      head: "data/statefulsets/",
      tail: "postgres.yaml:41",
    });
    expect(splitFileLocation("metadata.json:3")).toEqual({ head: "", tail: "metadata.json:3" });
    const f = {
      id: "1",
      level: "error",
      file: "data/statefulsets/postgres.yaml",
      line: 41,
      ruleId: "k8s-env-literal",
      description: "env value 리터럴",
      navigable: true,
    };
    const { container, rerender } = render(<ScanFindingList findings={[f]} onSelect={() => {}} truncateFile />);
    expect(container.textContent).toContain("data/statefulsets/");
    expect(container.textContent).toContain("postgres.yaml:41");
    expect(
      screen.getByRole("button", { name: "오류, data/statefulsets/postgres.yaml 41번째 줄, k8s-env-literal, env value 리터럴" }),
    ).toBeTruthy();
    const tail = Array.from(container.querySelectorAll("span")).find((s) => s.textContent === "postgres.yaml:41");
    expect(tail).toBeTruthy();
    // 기본 false: 기존 모양(한 덩어리)
    rerender(<ScanFindingList findings={[f]} onSelect={() => {}} />);
    const whole = Array.from(container.querySelectorAll("span")).find(
      (s) => s.textContent === "data/statefulsets/postgres.yaml:41",
    );
    expect(whole).toBeTruthy();
  });

  it("NoExecuteNotice text: 문구 대체, 없으면 기존 문구", () => {
    const { rerender, container } = render(<NoExecuteNotice />);
    expect(container.textContent).toBe("대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.");
    rerender(<NoExecuteNotice text="대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요." />);
    expect(container.textContent).toBe("대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요.");
  });

  it("StatusBadge srPrefix: 기본 `상태: ` 유지, 축 이름으로 바꿀 수 있다", () => {
    const { container, rerender } = render(<StatusBadge status="crit" label="커밋 금지" />);
    expect(container.textContent).toBe("상태: 커밋 금지");
    rerender(<StatusBadge status="crit" label="커밋 금지" srPrefix="파일 상태: " />);
    expect(container.textContent).toBe("파일 상태: 커밋 금지");
  });
});

// ───────────────────────── LinkTabs / LabeledStatus ─────────────────────────
describe("LinkTabs (14.1)", () => {
  it("링크 목록: 현재 항목 aria-current, 상태·숫자 스크린리더 문구, ok 아이콘 없음, 99+", () => {
    const { container } = render(
      <LinkTabs
        label="스냅샷 종류"
        currentHref="/snapshots/k8s"
        items={[
          { href: "/snapshots", label: "AWS", status: "warn" },
          {
            href: "/snapshots/k8s",
            label: "Kubernetes",
            status: "crit",
            statusLabel: "커밋 금지",
            count: 1,
            trailing: <DriftCountChip count={3} tooltip="최신 스냅샷 드리프트: 차이 3건" />,
            srText: "커밋 금지 1개, 드리프트 차이 3건",
          },
          { href: "/x", label: "X", status: "ok", count: 120 },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "스냅샷 종류" })).toBeTruthy();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    const k8s = screen.getByRole("link", { name: "Kubernetes, 커밋 금지 1개, 드리프트 차이 3건" });
    expect(k8s.getAttribute("aria-current")).toBe("page");
    const aws = screen.getByRole("link", { name: "AWS, 주의" });
    expect(aws.getAttribute("aria-current")).toBeNull();
    const x = screen.getByRole("link", { name: "X, 120개" });
    expect(x.querySelector("svg")).toBeNull();
    const pills = screen.getAllByTestId("link-tab-count").map((p) => p.textContent);
    expect(pills).toEqual(["1", "99+"]);
    // 드리프트 칩: 중립 `차이 3` (상태 색 없음, 장식)
    expect(k8s.textContent).toContain("차이 3");
    expect(k8s.querySelector("[data-status]")).toBeNull();
  });

  it("linkTabSrText", () => {
    expect(linkTabSrText({ status: "ok" })).toBe("");
    expect(linkTabSrText({ status: "unknown" })).toBe("알 수 없음");
    expect(linkTabSrText({ count: 2 })).toBe("2개");
  });

  it("DriftCountChip: 0 이하이면 그리지 않는다", () => {
    const { container } = render(<DriftCountChip count={0} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("LabeledStatus (14.2)", () => {
  it("보이는 라벨은 aria-hidden, 배지가 같은 말로 읽힌다 / 사유·meta·action", () => {
    const { container } = render(
      <LabeledStatus label="드리프트" reason="변경 2 · 삭제 1" meta="· 15:12 계산" action={<a href="?view=drift">드리프트 보기</a>}>
        <DriftStatus state="changed" count={3} />
      </LabeledStatus>,
    );
    const label = Array.from(container.querySelectorAll("[aria-hidden='true']")).find((e) => e.textContent === "드리프트");
    expect(label).toBeTruthy();
    expect(container.textContent).toContain("드리프트: 차이 3건");
    expect(container.textContent).toContain("변경 2 · 삭제 1");
    expect(container.textContent).toContain("· 15:12 계산");
    expect(screen.getByRole("link", { name: "드리프트 보기" })).toBeTruthy();
  });
});

// ───────────────────────── DriftStatus / Kind ─────────────────────────
describe("DriftStatus · DriftKindIcon · DriftKindChip (14.3)", () => {
  it("상태별 모양: changed warn `차이 N건`, none ok `차이 없음`, unknown, stale, 계산 안 함, 계산 중", () => {
    const { container, rerender } = render(<DriftStatus state="changed" count={3} reason="변경 2 · 삭제 1" />);
    expect(container.querySelector("[data-status='warn']")?.textContent).toBe("드리프트: 차이 3건, 변경 2 · 삭제 1");

    rerender(<DriftStatus state="none" />);
    expect(container.querySelector("[data-status='ok']")?.textContent).toBe("드리프트: 차이 없음");

    rerender(<DriftStatus state="unknown" reason="클러스터 연결 없음" />);
    expect(container.querySelector("[data-status='unknown']")?.textContent).toBe("드리프트: 알 수 없음, 클러스터 연결 없음");

    rerender(<DriftStatus state="stale" staleAt="2026-09-19T06:12:10Z" previous={{ count: 3 }} />);
    const stale = container.querySelector("[data-status='stale']");
    expect(stale?.textContent).toContain("데이터 오래됨 · ");
    expect(stale?.textContent).toContain("마지막 결과: 차이 3건");

    rerender(<DriftStatus state="notComputed" />);
    expect(container.querySelector("[data-status]")).toBeNull();
    expect(container.textContent).toBe("드리프트: 계산 안 함");

    rerender(<DriftStatus state="computing" />);
    expect(container.querySelector("[data-status]")).toBeNull();
    expect(container.textContent).toBe("드리프트: 계산 중");
  });

  it("refreshing: 배지(또는 계산 안 함) 뒤 스피너 `갱신 중`, 값은 그대로", () => {
    const { container, rerender } = render(<DriftStatus state="changed" count={3} refreshing />);
    expect(container.querySelector("[data-status='warn']")?.textContent).toBe("드리프트: 차이 3건");
    expect(screen.getByRole("img", { name: "갱신 중" })).toBeTruthy();
    rerender(<DriftStatus state="notComputed" refreshing />);
    expect(screen.getByRole("img", { name: "갱신 중" })).toBeTruthy();
    rerender(<DriftStatus state="changed" count={3} />);
    expect(screen.queryByRole("img", { name: "갱신 중" })).toBeNull();
    expect(container.querySelector("[data-refreshing]")).toBeNull();
  });

  it("srPrefix 를 비우면 앞말 없이 읽는다 (표 열 머리글이 `드리프트`일 때)", () => {
    const { container } = render(<DriftStatus state="none" srPrefix="" />);
    expect(container.textContent).toBe("차이 없음");
  });

  it("DriftKindIcon: 모양으로 구분, same 은 그리지 않는다, title=null 이면 장식", () => {
    const { container, rerender } = render(<DriftKindIcon kind="deleted" />);
    expect(screen.getByRole("img", { name: "삭제" })).toBeTruthy();
    rerender(<DriftKindIcon kind="same" />);
    expect(container.innerHTML).toBe("");
    rerender(<DriftKindIcon kind="added" title={null} />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("DriftKindChip: 문구 `변경됨`/`삭제됨`/`추가됨`/`같음`, href 면 링크, 상태 색 없음", () => {
    const { container, rerender } = render(<DriftKindChip kind="changed" size="md" />);
    expect(container.textContent).toBe("변경됨");
    expect(container.querySelector("[data-status]")).toBeNull();
    rerender(<DriftKindChip kind="same" />);
    expect(container.textContent).toBe("같음");
    expect(container.querySelector("svg")).toBeNull();
    rerender(<DriftKindChip kind="added" href="/snapshots/k8s/1?view=drift&res=a" tooltip="드리프트에서 보기" />);
    expect(screen.getByRole("link", { name: "추가됨, 드리프트에서 보기" }).getAttribute("href")).toBe(
      "/snapshots/k8s/1?view=drift&res=a",
    );
  });

  it("문구 도우미", () => {
    expect(formatDriftBreakdown({ changed: 2, deleted: 1, added: 0 })).toBe("변경 2 · 삭제 1");
    expect(formatDriftBreakdown({ added: 4 })).toBe("추가 4");
    expect(formatDriftBreakdown({})).toBe("");
    expect(formatDriftCount(0)).toBe("차이 없음");
    expect(formatDriftCount(1234)).toBe("차이 1,234건");
    const now = new Date(2026, 8, 19, 15, 0, 0);
    expect(formatDriftLastResult({ state: "changed", count: 3, computedAt: new Date(2026, 8, 18, 14, 2).toISOString() }, now)).toBe(
      "지난 결과 차이 3건 · 9월 18일 14:02",
    );
    expect(formatDriftLastResult({ state: "none", computedAt: new Date(2026, 8, 18, 14, 2).toISOString() }, now)).toBe(
      "지난 결과 차이 없음 · 9월 18일 14:02",
    );
  });
});

// ───────────────────────── DiffValue / MaskedValue ─────────────────────────
describe("DiffValue · MaskedValue (14.7·14.8)", () => {
  it("가린 값: 서버 text 만(preview 안 씀), sr `가린 값`, 복사 버튼 없음", () => {
    const { container } = render(<DiffValue value={{ kind: "masked", text: "값 다름 (ex****(16자))", preview: "ex" }} />);
    expect(container.textContent).toBe("가린 값, 값 다름 (ex****(16자))");
    expect(container.querySelector("[data-masked='true']")).toBeTruthy();
    expect(container.querySelector("button")).toBeNull();
    cleanup();
    const m = render(<MaskedValue text="값 다름" />);
    expect(m.container.textContent).toBe("가린 값, 값 다름");
  });

  it("null = `(없음)`, scalar 문자열은 따옴표 없이, 숫자·불리언·null 은 JSON 표기", () => {
    const { container, rerender } = render(<DiffValue value={null} />);
    expect(container.textContent).toBe("(없음)");
    rerender(<DiffValue value={{ kind: "scalar", value: "1Gi" }} />);
    expect(container.textContent).toBe("1Gi");
    rerender(<DiffValue value={{ kind: "scalar", value: 8080 }} />);
    expect(container.textContent).toBe("8080");
    rerender(<DiffValue value={{ kind: "scalar", value: true }} />);
    expect(container.textContent).toBe("true");
    rerender(<DiffValue value={{ kind: "scalar", value: null }} />);
    expect(container.textContent).toBe("null");
    expect(scalarText("a")).toBe("a");
  });

  it("scalar 여러 줄 `더 보기 (N줄)`", () => {
    const onExpand = vi.fn();
    const { container } = render(<DiffValue value={{ kind: "scalar", value: "a: 1\nb: 2\nc: 3\nd: 4\ne: 5" }} onExpand={onExpand} />);
    expect(container.textContent).toContain("a: 1\nb: 2\nc: 3");
    expect(container.textContent).not.toContain("d: 4");
    const btn = screen.getByRole("button", { name: "더 보기 (5줄)" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("list: 항목마다 한 줄 `- `, 넘치면 `더 보기 (N개)`", () => {
    const { container } = render(<DiffValue value={{ kind: "list", items: ["a", 1, "c", "d"] }} onExpand={() => {}} />);
    const bullets = Array.from(container.querySelectorAll("span[aria-hidden='true']")).filter((b) => b.textContent === "- ");
    expect(bullets.map((b) => b.parentElement?.textContent)).toEqual(["- a", "- 1", "- c"]);
    expect(screen.getByRole("button", { name: "더 보기 (4개)" })).toBeTruthy();
  });

  it("showType: 타입만 다를 때 `문자열`/`숫자`/`불리언`", () => {
    const a = { kind: "scalar" as const, value: "8080" };
    const b = { kind: "scalar" as const, value: 8080 };
    expect(differsOnlyByType(a, b)).toBe(true);
    expect(differsOnlyByType(a, { kind: "scalar", value: "8081" })).toBe(false);
    expect(differsOnlyByType(a, null)).toBe(false);
    const { container, rerender } = render(<DiffValue value={a} showType />);
    expect(container.textContent).toBe("8080, 문자열");
    rerender(<DiffValue value={b} showType />);
    expect(container.textContent).toBe("8080, 숫자");
    rerender(<DiffValue value={{ kind: "scalar", value: false }} showType />);
    expect(container.textContent).toBe("false, 불리언");
    expect(scalarTypeLabel(null)).toBeNull();
  });

  it("텍스트로만 렌더 (HTML 해석 안 함)", () => {
    const { container } = render(<DiffValue value={{ kind: "scalar", value: "<b>x</b>" }} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toBe("<b>x</b>");
  });
});

// ───────────────────────── FieldDiffTable ─────────────────────────
const DIFF_ROWS: FieldDiffRow[] = [
  {
    path: "spec.template.spec.containers[api].image",
    category: "changed",
    reason: null,
    snapshot: { kind: "scalar", value: "registry.example.com/api:1.8.2" },
    cluster: { kind: "scalar", value: "registry.example.com/api:1.9.0" },
  },
  {
    path: "spec.template.spec.containers[api].env[DB_PASSWORD].value",
    category: "changed",
    reason: null,
    snapshot: { kind: "masked", text: "값 다름 (ex****(16자))", preview: "ex" },
    cluster: { kind: "masked", text: "값 다름 (ab****(16자))", preview: "ab" },
  },
  {
    path: "spec.replicas",
    category: "managed",
    reason: "HPA가 관리",
    managedRule: "hpa-replicas",
    snapshot: { kind: "scalar", value: 2 },
    cluster: { kind: "scalar", value: 5 },
  },
  {
    path: "spec.template.spec.containers[api].terminationMessagePath",
    category: "default",
    reason: "기본값 /dev/termination-log",
    snapshot: null,
    cluster: { kind: "scalar", value: "/dev/termination-log" },
  },
];

describe("FieldDiffTable (14.6)", () => {
  it("경로 줄바꿈 위치: `.` 뒤, `[` 앞", () => {
    const { container } = render(<span>{pathWithBreaks("a.b[c].d")}</span>);
    expect(container.innerHTML).toBe("<span>a.<wbr>b<wbr>[c].<wbr>d</span>");
  });

  it("보이는 차이 → 숨긴 그룹 행(접힘) → 그룹 펼치면 숨긴 행(서버 순서), 분류 아래 reason", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <FieldDiffTable rows={DIFF_ROWS} caption="api 필드 차이" hiddenExpanded={open} onHiddenToggle={() => setOpen((v) => !v)} />;
    }
    render(<Harness />);
    const table = screen.getByRole("table", { name: "api 필드 차이" });
    expect(within(table).getByRole("rowheader", { name: "spec.template.spec.containers[api].image" })).toBeTruthy();
    expect(within(table).getAllByText("변경")).toHaveLength(2);
    expect(within(table).queryByText("HPA가 관리")).toBeNull();
    const group = screen.getByRole("button", { name: /숨긴 차이 2건/ });
    expect(group.textContent).toContain("(기본값 차이 1 · 관리 필드 1)");
    expect(group.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(within(table).getByText("HPA가 관리")).toBeTruthy();
    expect(within(table).getByText("관리 필드")).toBeTruthy();
    expect(within(table).getByText("기본값 차이")).toBeTruthy();
    const cats = Array.from(table.querySelectorAll("tr[data-category]")).map((r) => r.getAttribute("data-category"));
    expect(cats).toEqual(["changed", "changed", "managed", "default"]);
    expect(table.querySelector("td span[aria-hidden='true']")?.textContent).toBe("→");
  });

  it("showHidden 이면 숨긴 행을 펼친 상태로 (그룹 행은 버튼이 아님)", () => {
    render(<FieldDiffTable rows={DIFF_ROWS} caption="t" showHidden onHiddenToggle={() => {}} />);
    expect(screen.queryByRole("button", { name: /숨긴 차이/ })).toBeNull();
    expect(screen.getByText("HPA가 관리")).toBeTruthy();
  });

  it("숨긴 차이만 있으면 표 위 안내", () => {
    render(<FieldDiffTable rows={DIFF_ROWS.slice(2)} caption="t" hiddenExpanded onHiddenToggle={() => {}} />);
    expect(screen.getByText("이 리소스는 숨긴 차이만 있어 같음으로 셉니다.")).toBeTruthy();
    expect(hiddenBreakdown(DIFF_ROWS)).toBe("기본값 차이 1 · 관리 필드 1");
  });

  it("타입만 다른 값이면 두 셀 모두 타입 표시", () => {
    render(
      <FieldDiffTable
        caption="t"
        rows={[{ path: "spec.port", category: "changed", reason: null, snapshot: { kind: "scalar", value: "8080" }, cluster: { kind: "scalar", value: 8080 } }]}
      />,
    );
    expect(screen.getByText("문자열")).toBeTruthy();
    expect(screen.getByText("숫자")).toBeTruthy();
  });

  it("여러 줄·긴 목록 `더 보기` → 행 아래 확장 영역(두 값 전체)", () => {
    render(
      <FieldDiffTable
        caption="t"
        rows={[
          {
            path: "spec.args",
            category: "changed",
            reason: null,
            snapshot: { kind: "list", items: ["a", "b", "c", "d", "e"] },
            cluster: { kind: "list", items: ["a"] },
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "더 보기 (5개)" }));
    expect(screen.getByText("스냅샷 값", { selector: "span" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "접기" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("truncated: 표 끝 안내 행", () => {
    const { rerender } = render(<FieldDiffTable rows={DIFF_ROWS.slice(0, 1)} caption="t" />);
    expect(screen.queryByText(FIELDS_TRUNCATED_TEXT)).toBeNull();
    rerender(<FieldDiffTable rows={DIFF_ROWS.slice(0, 1)} caption="t" truncated />);
    expect(screen.getByText(FIELDS_TRUNCATED_TEXT)).toBeTruthy();
  });

  it("loading: 스켈레톤 6행 + aria-busy", () => {
    const { container } = render(<FieldDiffTable rows={[]} caption="t" state="loading" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(6);
  });
});

// ───────────────────────── DriftSummary ─────────────────────────
describe("DriftSummary (14.5)", () => {
  const base = {
    status: { state: "changed" as const, count: 3 },
    reason: ["변경 2 · 삭제 1"],
    target: { name: "prod-eks", context: "sentinel-prod" },
    mode: "auto" as const,
    counts: { changed: 2, deleted: 1, added: 0, same: 39, compared: 42 },
    hidden: { default: 12, managed: 1 },
    notComparable: [
      { kind: "ConfigMap", count: 8, reason: "NOT_IN_RBAC", text: "대시보드 RBAC에 없는 종류" },
      { kind: "Ingress", count: 3, reason: "FORBIDDEN", text: "읽기 거부 (403)" },
      { kind: "HorizontalPodAutoscaler", count: 1, reason: "API_VERSION_MISMATCH", text: "파일 autoscaling/v1" },
    ],
    totalUncomparable: 12,
  };

  it("상태 lg 배지·사유·비교 대상·모드 문구", () => {
    const { container } = render(<DriftSummary {...base} />);
    expect(screen.getByRole("region", { name: "드리프트 요약" })).toBeTruthy();
    expect(container.querySelector("[data-status='warn']")?.textContent).toBe("드리프트: 차이 3건");
    expect(container.textContent).toContain("변경 2 · 삭제 1");
    expect(container.textContent).toContain("비교 대상 prod-eks (sentinel-prod)");
    expect(container.textContent).toContain("자동 계산 · 클러스터 변경은 30초 안에 반영");
    expect(container.querySelector("section")?.getAttribute("data-status")).toBeNull();
    expect(screen.queryByRole("button", { name: "다시 계산" })).toBeNull();
  });

  it("개수 칸: 버튼 aria-pressed, 0 이면 아이콘 없음, `비교한 리소스`는 버튼 아님", () => {
    const onFilter = vi.fn();
    render(<DriftSummary {...base} activeFilter="deleted" onFilter={onFilter} />);
    const deleted = screen.getByRole("button", { name: /^삭제/ });
    expect(deleted.getAttribute("aria-pressed")).toBe("true");
    expect(deleted.querySelector("svg")).toBeTruthy();
    const added = screen.getByRole("button", { name: /^추가/ });
    expect(added.getAttribute("aria-pressed")).toBe("false");
    expect(added.querySelector("svg")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^같음/ }));
    expect(onFilter).toHaveBeenCalledWith("same");
    expect(screen.queryByRole("button", { name: /비교한 리소스/ })).toBeNull();
  });

  it("숨긴 차이 줄 + 스위치, 비교 불가 칩(사유별 모양), 총수는 totalUncomparable", () => {
    const onShow = vi.fn();
    const { container } = render(<DriftSummary {...base} onShowHiddenChange={onShow} />);
    expect(container.textContent).toContain("기본값 차이 12건 · 관리 필드 1건 숨김");
    fireEvent.click(screen.getByRole("switch"));
    expect(onShow).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain("비교 불가 12개");
    expect(container.textContent).toContain("대시보드 권한·버전 밖이라 비교하지 않습니다.");
    const list = screen.getByRole("list", { name: "비교 불가 종류" });
    expect(within(list).getByText("ConfigMap 8")).toBeTruthy();
    expect(within(list).getByText("Ingress 3 · 권한 거부")).toBeTruthy();
    expect(within(list).getByText("HorizontalPodAutoscaler 1 · API 버전 다름")).toBeTruthy();
  });

  it("notComparableChip: 사유별 점선·툴팁 줄", () => {
    expect(notComparableChip({ kind: "A", count: 1, reason: "NOT_IN_RBAC", text: "t" })).toEqual({
      label: "A 1",
      dashed: false,
      tooltip: ["t"],
    });
    const f = notComparableChip({ kind: "B", count: 2, reason: "FORBIDDEN", text: "403" });
    expect(f.dashed).toBe(true);
    expect(f.tooltip[0]).toBe("403");
    expect(f.tooltip[1]).toContain("deploy/rbac.yaml");
    const v = notComparableChip({ kind: "C", count: 3, reason: "API_VERSION_MISMATCH", text: "" });
    expect(v).toMatchObject({ label: "C 3 · API 버전 다름", dashed: true });
    expect(v.tooltip).toHaveLength(1);
    expect(notComparableChip({ kind: "D", count: 1, reason: "SOMETHING_NEW", text: "x" }).dashed).toBe(false);
  });

  it("비교 불가 칩 최대 개수 넘으면 `외 N종`", () => {
    render(<DriftSummary {...base} notComparableMax={1} />);
    expect(screen.getByText("외 2종")).toBeTruthy();
  });

  it("숨긴 차이 0 이면 줄 없음", () => {
    expect(hiddenSummaryText({ default: 0, managed: 0 })).toBe("");
    const { container } = render(<DriftSummary {...base} hidden={{ default: 0, managed: 0 }} />);
    expect(container.textContent).not.toContain("숨김");
  });

  it("값이 바뀌면 polite 로 한 번 알린다", () => {
    const { rerender } = render(<DriftSummary {...base} />);
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("");
    rerender(<DriftSummary {...base} status={{ state: "changed", count: 2 }} />);
    expect(screen.getByRole("status").textContent).toBe("드리프트 차이 3건에서 2건으로 바뀜");
    expect(driftChangeText("차이 2건", "차이 없음")).toBe("드리프트 차이 2건에서 차이 없음으로 바뀜");
  });

  it("on_demand: secondary `다시 계산`·문구, 갱신 중, loading, stale", () => {
    const onRecompute = vi.fn();
    const { container, rerender } = render(
      <DriftSummary {...base} mode="on_demand" refreshing onRecompute={onRecompute} computedAt="2026-09-19T06:12:04Z" />,
    );
    expect(container.textContent).toContain("갱신 중 · ");
    expect(container.textContent).toContain("요청 계산 · 이 화면을 떠나면 최대 2분 뒤 갱신을 멈춥니다");
    fireEvent.click(screen.getByRole("button", { name: "다시 계산" }));
    expect(onRecompute).toHaveBeenCalled();
    rerender(<DriftSummary {...base} state="loading" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    rerender(<DriftSummary {...base} state="stale" />);
    expect(container.querySelector("section")?.getAttribute("data-state")).toBe("stale");
  });

  it("last_result: 문구·primary `다시 계산`, state lastResult 는 배지 앞 `지난 결과`", () => {
    const { container } = render(<DriftSummary {...base} mode="last_result" state="lastResult" onRecompute={() => {}} />);
    expect(container.textContent).toContain("지난 결과 · 지금은 갱신하지 않습니다");
    expect(container.querySelector("section")?.getAttribute("data-state")).toBe("lastResult");
    const status = container.querySelector("[data-status='warn']");
    expect(status?.previousElementSibling?.textContent).toBe("지난 결과");
    expect(screen.getByRole("button", { name: "다시 계산" })).toBeTruthy();
  });
});

// ───────────────────────── ResourceTree ─────────────────────────
const TREE: TreeNode[] = [
  {
    id: "g:files",
    kind: "group",
    label: "스냅샷 파일",
    icon: "archive",
    defaultCollapsed: true,
    children: [{ id: "metadata.json", kind: "file", label: "metadata.json" }],
  },
  {
    id: "ns:app",
    kind: "namespace",
    label: "app",
    count: 3,
    children: [
      { id: "app/namespace.yaml", kind: "file", label: "namespace.yaml", tooltip: "app/namespace.yaml" },
      {
        id: "app/deployments",
        kind: "resourceKind",
        label: "Deployment",
        count: 2,
        children: [
          {
            id: "app/deployments/api.yaml",
            kind: "file",
            label: "api",
            tooltip: "app/deployments/api.yaml",
            markers: { scan: { level: "error", count: 1 }, drift: { kind: "changed", detail: "필드 2건" }, helm: true },
          },
          {
            id: "app/deployments/worker.yaml",
            kind: "file",
            label: "worker",
            tooltip: "app/deployments/worker.yaml",
            markers: { fileIssue: "YAML 해석 실패" },
          },
        ],
      },
    ],
  },
  {
    id: "g:unexpected",
    kind: "group",
    label: "예상 밖 파일",
    icon: "file-question",
    iconTone: "warn",
    defaultCollapsed: true,
    children: [
      { id: "u:notes.bak", kind: "file", label: "notes.bak", disabled: true, disabledReason: "대시보드는 이 파일을 열거나 고치지 않습니다" },
    ],
  },
];

describe("resourceTreeModel", () => {
  it("defaultExpandedIds: 150개 이하면 모두 펼침(접어 둘 그룹 제외), 초과면 최상위만", () => {
    expect(defaultExpandedIds(TREE)).toEqual(["ns:app", "app/deployments"]);
    expect(defaultExpandedIds(TREE, 1)).toEqual(["ns:app"]);
  });

  it("filterTree: 일치 잎과 조상만, 조상 id 반환 (경로 툴팁도 검색)", () => {
    const { nodes, ancestorIds } = filterTree(TREE, "DEPLOYMENTS/API");
    const rows = flattenVisible(nodes, ancestorIds);
    expect(rows.map((r) => r.node.id)).toEqual(["ns:app", "app/deployments", "app/deployments/api.yaml"]);
  });

  it("aggregateMarkers / 스크린리더 이름", () => {
    const agg = aggregateMarkers(TREE[1]);
    expect(agg).toEqual({ scan: { level: "error", count: 1 }, fileIssue: true, driftCount: 1 });
    const rows = flattenVisible(TREE, new Set(["ns:app", "app/deployments"]));
    const api = rows.find((r) => r.node.id === "app/deployments/api.yaml");
    expect(api && treeRowSrText(api)).toBe("api, Deployment, app 네임스페이스, 스캔 오류 1건, 드리프트 변경, 필드 2건, Helm 관리");
    expect(api?.level).toBe(3);
  });

  it("treeVisibleRange", () => {
    expect(treeVisibleRange(0, 280, 1000, 0)).toEqual([0, 10]);
    expect(treeVisibleRange(2800, 280, 1000, 2)).toEqual([98, 112]);
  });
});

describe("ResourceTree (14.4)", () => {
  function Harness(props: { onSelect?: (id: string) => void; query?: string }) {
    const [expanded, setExpanded] = useState<string[]>(defaultExpandedIds(TREE));
    const [sel, setSel] = useState<string | null>(null);
    return (
      <ResourceTree
        label="리소스"
        nodes={TREE}
        expandedIds={expanded}
        onExpandedChange={setExpanded}
        selectedId={sel}
        query={props.query}
        onSelect={(n) => {
          setSel(n.id);
          props.onSelect?.(n.id);
        }}
      />
    );
  }

  it("WAI-ARIA tree: level·setsize·posinset·expanded, 탭 정지점 하나", () => {
    render(<Harness />);
    const tree = screen.getByRole("tree", { name: "리소스" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((i) => i.getAttribute("data-id"))).toEqual([
      "g:files",
      "ns:app",
      "app/namespace.yaml",
      "app/deployments",
      "app/deployments/api.yaml",
      "app/deployments/worker.yaml",
      "g:unexpected",
    ]);
    expect(items[0].getAttribute("aria-expanded")).toBe("false");
    expect(items[1].getAttribute("aria-expanded")).toBe("true");
    expect(items[4].getAttribute("aria-level")).toBe("3");
    expect(items[4].getAttribute("aria-posinset")).toBe("1");
    expect(items[4].getAttribute("aria-setsize")).toBe("2");
    expect(items.filter((i) => i.tabIndex === 0)).toHaveLength(1);
    expect(items[0].tabIndex).toBe(0);
    // 접힌 네임스페이스가 아닌 펼친 상태라 집계 없음, 잎은 이름에 표시 포함
    expect(items[4].getAttribute("aria-label")).toContain("스캔 오류 1건");
  });

  it("키보드: ↓ ↑ → ← Home End Enter *", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const tree = screen.getByRole("tree");
    const focused = () => document.activeElement?.getAttribute("data-id");
    const key = (k: string) => fireEvent.keyDown(document.activeElement ?? tree, { key: k });

    (within(tree).getAllByRole("treeitem")[0] as HTMLElement).focus();
    key("ArrowDown");
    expect(focused()).toBe("ns:app");
    key("ArrowLeft"); // 펼침 → 접기
    expect(screen.getByRole("treeitem", { name: /^app 네임스페이스/ }).getAttribute("aria-expanded")).toBe("false");
    expect(within(tree).queryByRole("treeitem", { name: /^api,/ })).toBeNull();
    key("ArrowRight"); // 접힘 → 펼치기
    expect(within(tree).getByRole("treeitem", { name: /^api,/ })).toBeTruthy();
    key("ArrowRight"); // 펼침 → 첫 자식
    expect(focused()).toBe("app/namespace.yaml");
    key("ArrowLeft"); // 잎 → 부모
    expect(focused()).toBe("ns:app");
    key("End");
    expect(focused()).toBe("g:unexpected");
    key("Home");
    expect(focused()).toBe("g:files");
    key("*"); // 형제(최상위) 모두 펼침
    expect(within(tree).getByRole("treeitem", { name: /^metadata\.json/ })).toBeTruthy();
    expect(within(tree).getByRole("treeitem", { name: /^notes\.bak/ })).toBeTruthy();
    key("ArrowDown"); // metadata.json
    key("Enter");
    expect(onSelect).toHaveBeenCalledWith("metadata.json");
    expect(screen.getByRole("treeitem", { name: /^metadata\.json/ }).getAttribute("aria-selected")).toBe("true");
    key("ArrowUp");
    expect(focused()).toBe("g:files");
  });

  it("disabled 잎은 선택되지 않는다 (aria-disabled + 사유)", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const tree = screen.getByRole("tree");
    fireEvent.click(within(tree).getByRole("treeitem", { name: /^예상 밖 파일/ }));
    const bak = within(tree).getByRole("treeitem", { name: /^notes\.bak/ });
    expect(bak.getAttribute("aria-disabled")).toBe("true");
    expect(bak.getAttribute("aria-label")).toContain("대시보드는 이 파일을 열거나 고치지 않습니다");
    fireEvent.click(bak);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("검색: 일치 잎의 조상 자동 펼침, 0건이면 필터 빈 상태", () => {
    const { rerender } = render(<Harness query="worker" />);
    const ids = within(screen.getByRole("tree")).getAllByRole("treeitem").map((i) => i.getAttribute("data-id"));
    expect(ids).toEqual(["ns:app", "app/deployments", "app/deployments/worker.yaml"]);
    rerender(<Harness query="zzz" />);
    expect(screen.queryByRole("tree")).toBeNull();
    expect(screen.getByText("조건에 맞는 리소스가 없습니다")).toBeTruthy();
  });

  it("접힌 노드는 하위 표시를 집계해 보인다", () => {
    render(<ResourceTree label="t" nodes={TREE} expandedIds={[]} />);
    const ns = screen.getByRole("treeitem", { name: /^app 네임스페이스/ });
    expect(ns.getAttribute("aria-label")).toBe(
      "app 네임스페이스, 3개, 하위 스캔 오류 1건, 하위 파일 문제 있음, 드리프트 차이 1개",
    );
  });

  it("drift variant: 잎 아이콘 자리에 DriftKindIcon, 오른쪽 caption", () => {
    const nodes: TreeNode[] = [
      {
        id: "ns",
        kind: "namespace",
        label: "app",
        children: [
          {
            id: "k",
            kind: "resourceKind",
            label: "Ingress",
            children: [{ id: "r", kind: "file", label: "api-public", secondary: "삭제됨", markers: { drift: { kind: "deleted" } } }],
          },
        ],
      },
    ];
    render(<ResourceTree label="t" variant="drift" nodes={nodes} expandedIds={["ns", "k"]} />);
    const r = screen.getByRole("treeitem", { name: "api-public, Ingress, app 네임스페이스, 삭제, 삭제됨" });
    expect(r.textContent).toContain("삭제됨");
  });

  it("가상 렌더링: 1,000행이어도 보이는 행만 DOM 에 있다", () => {
    const many: TreeNode[] = [
      {
        id: "ns",
        kind: "namespace",
        label: "big",
        children: Array.from({ length: 1000 }, (_, i) => ({ id: `f${i}`, kind: "file" as const, label: `res-${i}` })),
      },
    ];
    render(<ResourceTree label="t" nodes={many} expandedIds={["ns"]} height={280} />);
    const items = screen.getAllByRole("treeitem");
    expect(items.length).toBeLessThan(40);
    const inner = screen.getByRole("tree") as HTMLElement;
    expect(inner.style.height).toBe(`${1001 * 28}px`);
  });

  it("loading: 스켈레톤 12행, aria-busy", () => {
    const { container } = render(<ResourceTree label="t" nodes={[]} state="loading" />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
