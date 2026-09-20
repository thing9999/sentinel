// @vitest-environment jsdom
/** aws-snapshot-manager 퍼블리셔 작업: 새 컴포넌트 6종 + 기존 확장 7건 (components.md 11·12절) */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandLine as CommandLineFromAdvisor } from "../advisor/BridgeStatusBar";
import { TextArea, TextField } from "../controls/TextField";
import { Icon } from "../icons";
import { CommandLine } from "../layout/CommandLine";
import { CommandSteps } from "../layout/CommandSteps";
import { Tabs } from "../layout/Tabs";
import { Dialog } from "../overlay/Dialog";
import { TypeToConfirmDialog, matchesExpected } from "../overlay/TypeToConfirmDialog";
import { SideNav, formatNavCount } from "../shell/SideNav";
import { DataSourceBadge, SCENARIO_GROUPS } from "../shell/DataSourceBadge";
import { CodeEditor } from "../snapshot/CodeEditor";
import {
  buildDecorations,
  gutterNumberWidth,
  lineOffsets,
  scrollTopForLine,
  splitLines,
  targetAnnouncement,
  visibleRange,
  visualWidth,
} from "../snapshot/codeEditorModel";
import { ScanCounts } from "../snapshot/ScanCounts";
import { ScanFindingList, type ScanFinding } from "../snapshot/ScanFindingList";
import { SummaryStrip } from "../status/SummaryStrip";
import { DataTable, TwoLineCell } from "../table/DataTable";
import { KeyValueList } from "../table/KeyValueList";

afterEach(() => cleanup());

describe("codeEditorModel", () => {
  it("CRLF·CR·LF 모두 줄바꿈, 빈 문자열은 1줄", () => {
    expect(splitLines("a\r\nb\nc\rd")).toEqual(["a", "b", "c", "d"]);
    expect(splitLines("")).toEqual([""]);
    expect(splitLines("a\n")).toEqual(["a", ""]);
  });

  it("줄 번호 칸: 자릿수 × 8px, 최소 32px", () => {
    expect(gutterNumberWidth(9)).toBe(32);
    expect(gutterNumberWidth(12345)).toBe(40);
    expect(gutterNumberWidth(1_000_000)).toBe(56);
  });

  it("한글은 2칸으로 센다", () => {
    expect(visualWidth("ab")).toBe(2);
    expect(visualWidth("한글")).toBe(4);
  });

  it("한 줄에 여러 마커면 가장 나쁜 등급, 툴팁은 항목마다", () => {
    const d = buildDecorations(
      [
        { line: 3, level: "warn", items: [{ ruleId: "user-data", description: "UserData" }] },
        { line: 3, level: "error", items: [{ ruleId: "env-block", description: "환경 변수 블록" }] },
      ],
      5,
      null,
    );
    expect(d.get(3)!.level!.status).toBe("crit");
    expect(d.get(3)!.tooltip).toEqual(["경고 · user-data · UserData", "오류 · env-block · 환경 변수 블록"]);
    expect(d.get(5)!.target).toBe(true);
  });

  it("모르는 등급은 알 수 없음 + 콘솔 경고", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = buildDecorations([{ line: 1, level: "fatal", items: [] }], null, null);
    expect(d.get(1)!.level!.status).toBe("unknown");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("가상 렌더링 범위와 1/3 위치 스크롤", () => {
    const lines = Array.from({ length: 100_000 }, (_, i) => `line ${i}`);
    const off = lineOffsets(lines, null);
    expect(off[off.length - 1]).toBe(2_000_000);
    const r = visibleRange(off, 20 * 5000, 600, 10);
    expect(r.start).toBeLessThanOrEqual(5000);
    expect(r.end - r.start).toBeLessThan(100);
    expect(scrollTopForLine(off, 212, 600)).toBe(8 + 211 * 20 - 200);
  });

  it("이동 안내 문구", () => {
    expect(
      targetAnnouncement("terraform.tf", 212, [
        { line: 212, level: "error", items: [{ ruleId: "env-block", description: "x" }] },
      ]),
    ).toBe("terraform.tf 212번째 줄, 오류 env-block");
    expect(targetAnnouncement("a.yml", 1284, [])).toBe("a.yml 1,284번째 줄");
  });
});

describe("CodeEditor (11.1)", () => {
  const big = Array.from({ length: 20_000 }, (_, i) => `resource "x" "r${i}" {}`).join("\n");

  it("보이는 줄만 DOM 에 둔다 + 보기 모드 접근성", () => {
    const { container } = render(<CodeEditor value={big} fileName="terraform.tf" height={480} />);
    const rows = container.querySelectorAll("[data-line]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(200);
    const box = screen.getByRole("textbox", { name: "terraform.tf 내용" });
    expect(box.getAttribute("aria-readonly")).toBe("true");
    expect(box.getAttribute("tabindex")).toBe("0");
  });

  it("텍스트로만 렌더한다(HTML 해석 없음)", () => {
    const { container } = render(<CodeEditor value={"<b>bold</b>\n<script>x</script>"} fileName="a.yml" height={200} />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<b>bold</b>");
  });

  it("발견 줄: 줄 배경 클래스 + gutter 아이콘", () => {
    const { container } = render(
      <CodeEditor
        value={"a\nb\nc"}
        fileName="a.yml"
        height={200}
        markers={[{ line: 2, level: "error", items: [{ ruleId: "env-block", description: "d" }] }]}
        highlightLine={3}
      />,
    );
    const row2 = container.querySelector('[data-line="2"]')!;
    expect(row2.className).toMatch(/ceRow-crit/);
    expect(row2.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-line="3"]')!.className).toMatch(/ceRowHighlight/);
    expect(container.querySelector('[data-line="1"]')!.querySelector("svg")).toBeNull();
  });

  it("편집: 라벨에 줄 수, Tab 은 들여쓰기, Esc 다음 Tab 은 기본 동작, Ctrl+S 는 저장", () => {
    const onChange = vi.fn();
    const onSave = vi.fn();
    render(
      <CodeEditor
        value={"a\nb"}
        fileName="terraform.tf"
        mode="edit"
        height={200}
        onChange={onChange}
        onSaveShortcut={onSave}
      />,
    );
    const ta = screen.getByRole("textbox", { name: "terraform.tf 편집기, 2줄" }) as HTMLTextAreaElement;
    ta.setSelectionRange(0, 0);
    const tab = fireEvent.keyDown(ta, { key: "Tab" });
    expect(tab).toBe(false); // preventDefault
    expect(onChange).toHaveBeenLastCalledWith("  a\nb");

    fireEvent.keyDown(ta, { key: "Escape" });
    const tab2 = fireEvent.keyDown(ta, { key: "Tab" });
    expect(tab2).toBe(true); // 포커스 이동(기본 동작)

    const save = fireEvent.keyDown(ta, { key: "s", ctrlKey: true });
    expect(save).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("보기 모드에서는 Ctrl+S 를 가로채지 않는다", () => {
    const onSave = vi.fn();
    render(<CodeEditor value="a" fileName="a.yml" height={200} onSaveShortcut={onSave} />);
    const res = fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
    expect(res).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("locked 이면 입력 잠금(aria-readonly)", () => {
    render(<CodeEditor value="a" fileName="a.yml" mode="edit" locked height={200} onChange={() => {}} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.readOnly).toBe(true);
    expect(ta.getAttribute("aria-readonly")).toBe("true");
  });

  it("targetLine: 이동 대상 줄 강조 + 안내 문구", () => {
    const announce = vi.fn();
    const { container } = render(
      <CodeEditor
        value={"a\nb\nc"}
        fileName="terraform.tf"
        height={200}
        targetLine={2}
        markers={[{ line: 2, level: "warn", items: [{ ruleId: "user-data", description: "d" }] }]}
        onTargetAnnounce={announce}
      />,
    );
    expect(container.querySelector('[data-line="2"]')!.className).toMatch(/ceRowTarget/);
    expect(announce).toHaveBeenCalledWith("terraform.tf 2번째 줄, 경고 user-data");
  });

  it("loading: 스켈레톤 12줄", () => {
    const { container } = render(<CodeEditor value="" fileName="a.yml" state="loading" />);
    expect(container.querySelectorAll('[class*="editorSkeletonRow"]').length).toBe(12);
    expect(screen.getByRole("status", { name: "a.yml 불러오는 중" })).toBeTruthy();
  });

  it("엔진 교체: 렌더 함수에 장식·라벨이 전달된다", () => {
    const engine = vi.fn(() => <div data-testid="custom" />);
    render(
      <CodeEditor
        value={"a\nb"}
        fileName="x.tf"
        mode="edit"
        engine={engine}
        markers={[{ line: 1, level: "error", items: [] }]}
      />,
    );
    expect(screen.getByTestId("custom")).toBeTruthy();
    const props = (engine.mock.calls[0] as unknown[])[0] as { ariaLabel: string; lines: string[]; editable: boolean };
    expect(props.ariaLabel).toBe("x.tf 편집기, 2줄");
    expect(props.lines).toEqual(["a", "b"]);
    expect(props.editable).toBe(true);
  });
});

const FINDINGS: ScanFinding[] = [
  { id: "f1", level: "error", file: "terraform.tf", line: 212, ruleId: "env-block", description: "환경 변수 블록을 여는 줄", navigable: true },
  { id: "f2", level: "warn", file: "cloudformation.yml", line: 301, ruleId: "user-data", description: "UserData", navigable: true },
  {
    id: "f3",
    level: "error",
    file: "metadata.json",
    line: 4,
    ruleId: "account-id",
    description: "계정 ID",
    navigable: false,
    hint: "metadata.json은 대시보드에서 편집할 수 없습니다",
  },
];

describe("ScanFindingList (11.2)", () => {
  it("이동 가능 항목은 button, 비이동은 div + hint, aria-label·aria-current", () => {
    const onSelect = vi.fn();
    const { container } = render(<ScanFindingList findings={FINDINGS} selectedId="f1" onSelect={onSelect} />);
    expect(container.querySelector("ul")).not.toBeNull();
    const b = screen.getByRole("button", { name: "오류, terraform.tf 212번째 줄, env-block, 환경 변수 블록을 여는 줄" });
    expect(b.getAttribute("aria-current")).toBe("true");
    fireEvent.click(b);
    expect(onSelect).toHaveBeenCalledWith(FINDINGS[0]);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(container.textContent).toContain("metadata.json은 대시보드에서 편집할 수 없습니다");
    expect(container.textContent).toContain("terraform.tf:212");
  });

  it("maxItems 넘으면 `외 N건`, compact 도 등급을 스크린리더로 읽는다", () => {
    const { container } = render(<ScanFindingList findings={FINDINGS} variant="compact" maxItems={1} onSelect={() => {}} />);
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain("외 2건");
    expect(screen.getByRole("button").getAttribute("aria-label")).toMatch(/^오류, /);
  });
});

describe("ScanCounts (11.3)", () => {
  it("0 인 등급은 그리지 않고 스크린리더는 한 문장", () => {
    const { container } = render(<ScanCounts errors={2} warnings={0} />);
    expect(container.textContent).toContain("현재 스캔 오류 2건");
    expect(container.textContent).not.toContain("경고");
  });

  it("둘 다 0 이면 발견 없음(통과라는 말 없음), null 이면 스캔할 수 없음", () => {
    const { container, rerender } = render(<ScanCounts errors={0} warnings={0} />);
    expect(container.textContent).toContain("발견 없음");
    expect(container.textContent).not.toContain("통과");
    rerender(<ScanCounts errors={null} warnings={null} />);
    expect(container.textContent).toContain("스캔할 수 없음");
  });

  it("오류·경고 모두: `오류 2 · 경고 1`", () => {
    const { container } = render(<ScanCounts errors={2} warnings={1} size="md" />);
    expect(container.textContent).toContain("현재 스캔 오류 2건, 경고 1건");
    expect(container.textContent).toContain("·");
    expect(container.querySelectorAll("svg")).toHaveLength(2);
  });
});

describe("TextField / TextArea (11.4)", () => {
  it("상한을 넘는 입력은 받지 않고 onOverflow, 카운터 표시", () => {
    const onChange = vi.fn();
    const onOverflow = vi.fn();
    render(
      <TextField label="라벨" value="abc" onChange={onChange} maxLength={5} showCount onOverflow={onOverflow} />,
    );
    const input = screen.getByLabelText("라벨");
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onOverflow).toHaveBeenCalledWith(8);
    fireEvent.change(input, { target: { value: "abcd" } });
    expect(onChange).toHaveBeenCalledWith("abcd");
    expect(screen.getByText("3/5")).toBeTruthy();
  });

  it("error 는 aria-invalid + 설명 연결", () => {
    render(<TextArea label="메모" value="" onChange={() => {}} error="메모는 2000자까지 입력할 수 있습니다" />);
    const ta = screen.getByLabelText("메모");
    expect(ta.getAttribute("aria-invalid")).toBe("true");
    const desc = document.getElementById(ta.getAttribute("aria-describedby")!.split(" ")[0])!;
    expect(desc.textContent).toContain("2000자까지");
  });
});

describe("TypeToConfirmDialog (11.5)", () => {
  it("앞뒤 공백을 뺀 값이 정확히 같을 때만 확인, Enter 도 일치할 때만", () => {
    expect(matchesExpected(" 20260915-101010 ", "20260915-101010")).toBe(true);
    expect(matchesExpected("20260915-10101", "20260915-101010")).toBe(false);

    const onConfirm = vi.fn();
    render(
      <TypeToConfirmDialog
        open
        onClose={() => {}}
        title="스냅샷을 휴지통으로 옮길까요?"
        expected="20260915-101010"
        inputLabel="확인을 위해 스냅샷 ID 20260915-101010을 입력하세요"
        confirmLabel="휴지통으로 이동"
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByLabelText("확인을 위해 스냅샷 ID 20260915-101010을 입력하세요") as HTMLInputElement;
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(document.activeElement).toBe(input);
    const btn = screen.getByRole("button", { name: /휴지통으로 이동/ });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.textContent).toContain("스냅샷 ID를 입력하세요");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "20260915-101010 " } });
    // 비활성 사유 툴팁이 빠지며 버튼이 다시 그려지므로 다시 찾는다
    expect(screen.getByRole("button", { name: "휴지통으로 이동" }).getAttribute("aria-disabled")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("CommandSteps (11.6) / CommandLine 공용화", () => {
  it("번호 목록 + 명령은 텍스트로만, 명령 없는 단계는 text", () => {
    const { container } = render(
      <CommandSteps
        steps={[
          { id: "install", title: "설치", command: "npm install --prefix deploy/aws-snapshot" },
          { id: "env", title: "설정", text: "값을 채웁니다." },
        ]}
      />,
    );
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")!.textContent).toBe("npm install --prefix deploy/aws-snapshot");
    expect(container.textContent).toContain("값을 채웁니다.");
    expect(container.querySelector("a")).toBeNull();
  });

  it("advisor 경로의 CommandLine 은 같은 컴포넌트(re-export)", () => {
    expect(CommandLineFromAdvisor).toBe(CommandLine);
  });
});

describe("기존 확장 (12절)", () => {
  it("NavItem count·statusLabel: 스크린리더 `, 커밋 금지 2개`, 99+ , status 없으면 아이콘 없음", () => {
    expect(formatNavCount(120)).toBe("99+");
    const { container } = render(
      <SideNav
        currentPath="/"
        collapsed={false}
        items={[
          { href: "/snapshots", label: "AWS 스냅샷", icon: "archive", status: "crit", statusLabel: "커밋 금지", count: 2 },
          { href: "/b", label: "B", icon: "server", count: 3 },
          { href: "/c", label: "C", icon: "server" },
        ]}
      />,
    );
    const links = container.querySelectorAll("a");
    expect(links[0].textContent).toContain(", 커밋 금지 2개");
    expect(links[0].querySelector('[data-testid="nav-count"]')!.textContent).toBe("2");
    // status 없음: 상태 아이콘 없이 숫자만
    expect(links[1].querySelectorAll("svg")).toHaveLength(1); // 메뉴 아이콘만
    expect(links[1].textContent).toContain(", 3개");
    expect(links[2].querySelectorAll("svg")).toHaveLength(1);
    expect(links[2].querySelector('[data-testid="nav-count"]')).toBeNull();
  });

  it("SummaryStrip overall.label·updatedLabel·actions", () => {
    const { container } = render(
      <SummaryStrip
        overall={{ status: "crit", reason: ["커밋 금지 2개"], label: "커밋 금지" }}
        updatedLabel="마지막 확인"
        actions={<button type="button">새로고침</button>}
        label="스냅샷 요약"
      />,
    );
    expect(container.textContent).toContain("커밋 금지");
    expect(container.textContent).not.toContain("장애");
    expect(container.textContent).toContain("마지막 확인");
    expect(screen.getByRole("button", { name: "새로고침" })).toBeTruthy();
  });

  it("DataTable comfortable 56px + TwoLineCell", () => {
    const { container } = render(
      <DataTable
        caption="스냅샷"
        density="comfortable"
        rows={[{ id: "a" }]}
        rowKey={(r) => r.id}
        columns={[{ id: "c", header: "스냅샷", render: () => <TwoLineCell primary="9월 19일 12:15" secondary="라벨" strong /> }]}
      />,
    );
    const tr = container.querySelector("tbody tr") as HTMLElement;
    expect(tr.style.height).toBe("56px");
    expect(container.querySelector("table")!.className).toMatch(/comfortable/);
    expect(tr.textContent).toBe("9월 19일 12:15라벨");
  });

  it("TabItem dirty·suffix·mono·countLabel", () => {
    render(
      <Tabs
        idBase="t"
        label="템플릿 파일"
        value="tf"
        onChange={() => {}}
        items={[
          { id: "tf", label: "terraform.tf", mono: true, status: "crit", count: 1, countLabel: "발견", dirty: true },
          { id: "map", label: "logical-id-mapping.json", mono: true, suffix: "보기 전용" },
        ]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].textContent).toContain("terraform.tf");
    expect(tabs[0].textContent).toContain(", 발견 1건");
    expect(tabs[0].textContent).toContain(", 저장 안 됨");
    expect(tabs[1].textContent).toContain("보기 전용");
  });

  it("KeyValueList note: 아이콘 + 문구, 스크린리더 앞말", () => {
    const { container } = render(
      <KeyValueList items={[{ label: "리전", value: "ap-northeast-2", note: { tone: "warn", text: "폴더 이름과 다름" } }]} />,
    );
    expect(container.textContent).toContain("주의: 폴더 이름과 다름");
    expect(container.querySelector("dd svg")).not.toBeNull();
  });

  it("Dialog confirmDisabled·confirmDisabledReason·initialFocus", () => {
    const onConfirm = vi.fn();
    render(
      <Dialog
        open
        onClose={() => {}}
        title="라벨·메모 편집"
        confirmLabel="저장"
        onConfirm={onConfirm}
        confirmDisabled
        confirmDisabledReason="변경 없음"
        initialFocus="content"
      >
        <input aria-label="라벨" />
      </Dialog>,
    );
    const btn = screen.getByRole("button", { name: /저장/ });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("라벨"));
  });

  it("Dialog 기존 동작 유지: danger 는 취소에 포커스", () => {
    render(<Dialog open onClose={() => {}} title="삭제" tone="danger" confirmLabel="삭제" onConfirm={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "닫기" }));
  });

  it("DataSourceBadge: AWS 스냅샷 그룹은 advisor 뒤 (k8s-snapshot 이후 그 뒤에 Kubernetes 그룹)", () => {
    expect(SCENARIO_GROUPS.indexOf("snapshots")).toBe(SCENARIO_GROUPS.indexOf("advisor") + 1);
    const calls: string[] = [];
    render(
      <DataSourceBadge
        mode="mock"
        scenarios={[
          { id: "default", label: "예시 스냅샷 (기본)", group: "snapshots", active: true },
          { id: "empty", label: "스냅샷 0개", group: "snapshots", active: false },
          { id: "c", label: "클러스터 정상", group: "cluster", active: true },
        ]}
        onScenarioChange={(g, id) => calls.push(`${g}:${id}`)}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const legends = Array.from(document.querySelectorAll("legend")).map((l) => l.textContent);
    expect(legends).toEqual(["클러스터", "AWS 스냅샷"]);
    act(() => {
      fireEvent.click(screen.getByLabelText("스냅샷 0개"));
    });
    expect(calls).toEqual(["snapshots:empty"]);
  });

  it("새 아이콘 14개 등록", () => {
    const names = [
      "archive",
      "tag",
      "trash-2",
      "undo-2",
      "pencil",
      "save",
      "terminal",
      "folder",
      "file-x",
      "file-question",
      "file-pen",
      "sticky-note",
      "wrap-text",
      "lock",
    ] as const;
    const { container } = render(
      <>
        {names.map((n) => (
          <Icon key={n} name={n} />
        ))}
      </>,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(14);
  });
});
