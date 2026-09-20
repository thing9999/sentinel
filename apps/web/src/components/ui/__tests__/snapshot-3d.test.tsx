// @vitest-environment jsdom
/** snapshot-3d 1단계 퍼블리셔 작업: 새 컴포넌트(components.md 16절) + 기존 확장(17절) */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "../controls/SegmentedControl";
import { Switch } from "../controls/Switch";
import { Banner, InlineAlert } from "../feedback/Banner";
import { Icon } from "../icons";
import { Tabs } from "../layout/Tabs";
import { Popover } from "../overlay/Popover";
import { DataTable, type Column } from "../table/DataTable";
import { BlockDetailPanel } from "../viz/BlockDetailPanel";
import { MultiSelect } from "../controls/Select";
import { KindIcon, KIND_ICON, KIND_SHAPE, kindIconName, kindShape, plateIconName, type VizShape } from "../viz/KindIcon";
import { ShapeSwatch, SHAPE_PATH } from "../viz/ShapeSwatch";
import { BlockMarkers } from "../viz/BlockMarkers";
import { CameraControls } from "../viz/CameraControls";
import { CertaintyChip } from "../viz/CertaintyChip";
import { RelationItem, RelationList, type RelationItemProps } from "../viz/RelationItem";
import { RelationTable, type RelationGroupRow, type RelationTableRow } from "../viz/RelationTable";
import { PlateLabel } from "../viz/PlateLabel";
import { Scene3DFrame, SCENE_TEXT } from "../viz/Scene3DFrame";
import { SceneInfoBar } from "../viz/SceneInfoBar";
import { SceneLegend, DEFAULT_LEGEND_SHAPES, SHAPE_SECTION_TITLE } from "../viz/SceneLegend";
import { SceneSearchNav, SceneToolbar } from "../viz/SceneToolbar";
import {
  blockMarkerItems,
  blockSelectionAnnouncement,
  LEGEND_NOTES,
  NOTE_SPEC,
  PLATE_MARKER_NOTE,
  VIZ_LAYER_ORDER,
} from "../viz/viz";

afterEach(() => cleanup());

// ───────────────────────── 토큰·아이콘 ─────────────────────────
describe("토큰·아이콘 (tokens.json, components.md 13절)", () => {
  it("3D 아이콘 9개를 등록했다(판 표식 shapes 포함)", () => {
    const names = [
      "table-2",
      "zoom-in",
      "zoom-out",
      "maximize",
      "circle-dashed",
      "unlink",
      "chevron-up",
      "waypoints",
      "shapes",
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

  it("tokens.css 에 viz 색·불투명도 변수가 라이트·다크 모두 있다", () => {
    // vitest 실행 위치(apps/web 또는 저장소 루트)에 상관없이 찾는다
    const rel = "src/styles/tokens.css";
    const path = existsSync(join(process.cwd(), rel)) ? join(process.cwd(), rel) : join(process.cwd(), "apps/web", rel);
    const css = readFileSync(path, "utf8");
    for (const layer of VIZ_LAYER_ORDER) {
      expect(css).toContain(`--color-viz-kind-${layer}-fill`);
      expect(css).toContain(`--color-viz-kind-${layer}-edge`);
    }
    expect(css).toContain("--color-viz-scene-bg");
    expect(css).toContain("--color-viz-ghost-edge");
    expect(css).toContain("--opacity-viz-dimmed: 0.25;");
    expect(css).toContain("--opacity-viz-ghost: 0.35;");
    // 다크에도 같은 키가 있다(라이트 + [data-theme=dark] + prefers-color-scheme)
    expect((css.match(/--color-viz-kind-workload-fill/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

// ───────────────────────── 표식 ─────────────────────────
describe("BlockMarkers (16.9 / status.md 11.1)", () => {
  it("표식 순서가 스캔 → 드리프트 → 비교 불가 → 파일 문제 → Helm → 유령 으로 고정된다", () => {
    const items = blockMarkerItems({
      ghost: { reason: "not_in_snapshot" },
      helm: true,
      fileIssue: { code: "path_mismatch", text: "경로 불일치" },
      notComparable: { reason: "NOT_IN_RBAC", text: "비교 불가 (대시보드 권한 밖)" },
      drift: { kind: "changed", fieldCount: 2 },
      scan: { level: "error", count: 1 },
    });
    expect(items.map((i) => i.key)).toEqual([
      "scan",
      "drift",
      "notComparable",
      "fileIssue",
      "helm",
      "ghost",
    ]);
    expect(items[1].text).toBe("변경됨 · 필드 2건");
    expect(items[0].tone).toBe("crit");
    // 드리프트는 중립색만 쓴다(빨강·초록 금지)
    expect(items[1].tone).toBe("secondary");
  });

  it("드리프트 `same` 과 스캔 0건은 표식이 없고, Secret 유령은 circle-dashed 하나만 쓴다", () => {
    expect(blockMarkerItems({ drift: { kind: "same" }, scan: { level: "warn", count: 0 } })).toHaveLength(0);
    const secret = blockMarkerItems({ ghost: { reason: "secret" } });
    // 4.10에서 `key-round` 가 Secret 의 **종류 아이콘**이 되어 표식에서는 뺐다(4.4, 2026-09-20)
    expect(secret.map((i) => i.icon)).toEqual(["circle-dashed"]);
    expect(secret[0].text).toContain("Secret — 이름만, 값 없음");
  });

  it("overlay 는 3개까지 그리고 나머지는 +N, 스크린리더는 전체를 한 번 읽는다", () => {
    const { container } = render(
      <BlockMarkers
        variant="overlay"
        scan={{ level: "error", count: 1 }}
        drift={{ kind: "deleted" }}
        fileIssue={{ text: "중복 정의" }}
        helm
        ghost={{ reason: "not_in_snapshot" }}
      />,
    );
    expect(screen.getByText("+2")).toBeTruthy();
    expect(container.querySelector(".sr-only")?.textContent).toContain("Helm 관리");
    expect(container.querySelector(".sr-only")?.textContent).toContain("스캔 오류 1건");
  });

  it("inline 은 짧은 문구를 보이고 전체 문구를 스크린리더에 남긴다", () => {
    render(<BlockMarkers variant="inline" drift={{ kind: "changed", fieldCount: 2 }} />);
    expect(screen.getByText("변경 2")).toBeTruthy();
    expect(screen.getByText("변경됨 · 필드 2건")).toBeTruthy();
  });
});

// ───────────────────────── 확실성 ─────────────────────────
describe("CertaintyChip (16.10 / status.md 11.2)", () => {
  it("확정·추정을 문구로 구분하고 선택 참조를 덧붙인다", () => {
    const { rerender } = render(<CertaintyChip certainty="confirmed" />);
    expect(screen.getByText("확정")).toBeTruthy();
    rerender(<CertaintyChip certainty="estimated" optional />);
    expect(screen.getByText("추정")).toBeTruthy();
    expect(screen.getByText("선택 참조")).toBeTruthy();
  });
});

// ───────────────────────── 관계 ─────────────────────────
const relation = (over: Partial<RelationItemProps> = {}): RelationItemProps => ({
  direction: "in",
  peer: { id: "core/Service/prod/api", layer: "service", kind: "Service", name: "api" },
  evidence: "셀렉터",
  ruleLabel: "Service → 워크로드(K2)",
  certainty: "estimated",
  ...over,
});

describe("RelationItem / RelationList (16.7)", () => {
  it("항목 전체가 버튼 하나이고(중첩 버튼 없음) 누르면 상대 블록을 고른다", () => {
    const onSelect = vi.fn();
    render(<RelationItem {...relation({ onSelect })} />);
    const btn = screen.getByRole("button");
    expect(btn.querySelectorAll("button")).toHaveLength(0);
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("core/Service/prod/api");
    expect(btn.textContent).toContain("셀렉터");
    expect(btn.textContent).toContain("추정");
  });

  it("유령 상대는 `유령` 문구가 함께 보인다", () => {
    render(<RelationItem {...relation({ peer: { layer: "storage", kind: "Secret", name: "pg", ghost: true } })} />);
    expect(screen.getAllByText("유령").length).toBeGreaterThan(0);
  });

  it("관계 8개까지 보이고 나머지는 `더 보기 (N개)`", () => {
    const items = Array.from({ length: 11 }, (_, i) =>
      relation({ peer: { id: `p${i}`, layer: "workload", kind: "Deployment", name: `api-${i}` } }),
    );
    render(<RelationList title="들어오는 관계" items={items} />);
    expect(screen.getAllByRole("button", { name: /들어오는 관계/ })).toHaveLength(8);
    expect(screen.getByText("더 보기 (3개)")).toBeTruthy();
  });

  it("관계가 없으면 `없음`", () => {
    render(<RelationList title="나가는 관계" items={[]} />);
    expect(screen.getByText("없음")).toBeTruthy();
  });
});

// ───────────────────────── 선택 패널 ─────────────────────────
describe("BlockDetailPanel (16.6 / snapshot-3d.md 7.2)", () => {
  it("선택이 없으면 빈 상태를 보인다", () => {
    render(<BlockDetailPanel block={null} />);
    expect(screen.getByText("블록을 고르세요")).toBeTruthy();
  });

  it("종류·이름·파일·표식·관계와 이동 버튼을 그린다", () => {
    render(
      <BlockDetailPanel
        block={{
          id: "apps/Deployment/prod/api",
          layer: "workload",
          kind: "Deployment",
          apiVersion: "apps/v1",
          name: "api",
          namespace: "prod",
          file: "prod/deployments/api.yaml",
        }}
        markers={{ drift: { kind: "changed", fieldCount: 2 }, scan: { level: "error", count: 1 } }}
        notes={[{ code: "selector_missing", text: "셀렉터가 없습니다 (수동 Endpoints·ExternalName)." }]}
        incoming={[relation()]}
        outgoing={[]}
        actions={{
          file: { href: "?view=files&file=prod/deployments/api.yaml&line=41" },
          drift: { href: "?view=drift&res=apps/Deployment/prod/api" },
        }}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText("Deployment")).toBeTruthy();
    expect(screen.getByText("apps/v1")).toBeTruthy();
    expect(screen.getByText("네임스페이스 prod")).toBeTruthy();
    expect(screen.getByText("prod/deployments/api.yaml")).toBeTruthy();
    expect(screen.getByText("변경 2")).toBeTruthy();
    expect(screen.getByText("셀렉터가 없습니다 (수동 Endpoints·ExternalName).")).toBeTruthy();
    expect(screen.getByRole("link", { name: /파일에서 보기/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /드리프트에서 보기/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "선택 해제 (Esc)" })).toBeTruthy();
    // 관계 제목은 개수와 함께
    expect(screen.getByText("들어오는 관계")).toBeTruthy();
  });

  it("유령 블록은 파일 버튼이 사유와 함께 비활성이다", () => {
    render(
      <BlockDetailPanel
        block={{
          id: "apps/Deployment/prod/payments",
          layer: "workload",
          kind: "Deployment",
          name: "payments",
          namespace: "prod",
          file: null,
          fileNote: "추가됨 — 클러스터에만 있습니다",
          ghost: { reason: "drift_added" },
        }}
        markers={{ drift: { kind: "added" }, ghost: { reason: "drift_added" } }}
        actions={{
          file: { disabledReason: "이 리소스는 스냅샷에 파일이 없습니다" },
          drift: { href: "?view=drift&res=apps/Deployment/prod/payments" },
        }}
      />,
    );
    const fileBtn = screen.getByRole("button", { name: /파일에서 보기/ });
    expect(fileBtn.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/파일 없음/)).toBeTruthy();
  });

  it("값(env·셀렉터 원문)을 그리는 자리가 없다: 넘긴 문구만 보인다", () => {
    const { container } = render(
      <BlockDetailPanel
        block={{ id: "x", layer: "storage", kind: "ConfigMap", name: "api-config", namespace: "prod", file: "a.yaml" }}
      />,
    );
    expect(container.textContent).not.toContain("env");
    expect(container.textContent).not.toContain("=");
  });
});

// ───────────────────────── 장면 틀 ─────────────────────────
describe("Scene3DFrame (16.1 / snapshot-3d.md 9절)", () => {
  it("ready 면 캔버스와 오버레이, 건너뛰기 링크를 그린다", () => {
    render(
      <Scene3DFrame
        state="ready"
        skipLinkHref="?view=3d&gview=table"
        canvasSlot={<div data-testid="canvas" />}
        infoBar={<div data-testid="info" />}
        legend={<div data-testid="legend" />}
        cameraControls={<div data-testid="camera" />}
        liveMessage="Deployment api, prod 네임스페이스"
      />,
    );
    expect(screen.getByTestId("canvas")).toBeTruthy();
    expect(screen.getByTestId("info")).toBeTruthy();
    expect(screen.getByTestId("camera")).toBeTruthy();
    // 6.5: 범례 슬롯은 없앴다 — 넘겨도 캔버스에 그리지 않는다(기존 호출을 깨지 않으려고 받기만 한다)
    expect(screen.queryByTestId("legend")).toBeNull();
    const link = screen.getByRole("link", { name: SCENE_TEXT.showTable });
    expect(link.getAttribute("href")).toBe("?view=3d&gview=table");
  });

  it("선택 결과만 aria-live polite 로 읽는다", () => {
    const { container } = render(<Scene3DFrame state="ready" liveMessage="Deployment api, 들어오는 관계 2개" />);
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("들어오는 관계 2개");
  });

  it("WebGL 없음이면 표로 열고 안내를 얹는다", () => {
    render(<Scene3DFrame state="unsupported" tableSlot={<div data-testid="table" />} />);
    expect(screen.getByTestId("table")).toBeTruthy();
    expect(screen.getByText("이 브라우저에서 3D를 쓸 수 없어 표로 보여 줍니다")).toBeTruthy();
  });

  it("청크 실패는 `다시 시도`, 컨텍스트 손실은 `3D 다시 켜기`", () => {
    const onRetry = vi.fn();
    const onReenable = vi.fn();
    const { rerender } = render(
      <Scene3DFrame state="chunkFailed" tableSlot={<div />} onRetry={onRetry} onReenable={onReenable} />,
    );
    fireEvent.click(screen.getByRole("button", { name: SCENE_TEXT.retry }));
    expect(onRetry).toHaveBeenCalled();
    rerender(<Scene3DFrame state="contextLost" tableSlot={<div />} onRetry={onRetry} onReenable={onReenable} />);
    fireEvent.click(screen.getByRole("button", { name: SCENE_TEXT.reenable }));
    expect(onReenable).toHaveBeenCalled();
  });

  it("3D 청크를 받는 중에는 문구와 [표로 보기]를 보인다", () => {
    const onShowTable = vi.fn();
    render(<Scene3DFrame state="loadingChunk" onShowTable={onShowTable} />);
    expect(screen.getByText(SCENE_TEXT.chunk)).toBeTruthy();
    expect(screen.getByText(SCENE_TEXT.chunkNote)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: SCENE_TEXT.showTable }));
    expect(onShowTable).toHaveBeenCalled();
  });

  it("장면 만드는 중에는 블록 수를 함께 보인다", () => {
    render(<Scene3DFrame state="building" buildingCount={1240} />);
    expect(screen.getByText("장면을 그리는 중입니다 (블록 1,240개)")).toBeTruthy();
  });

  it("리소스 0개 빈 상태와 필터 결과 0개는 다르다(필터 0개는 캔버스를 지우지 않는다)", () => {
    const { rerender } = render(<Scene3DFrame state="empty" />);
    expect(screen.getByText(SCENE_TEXT.emptyTitle)).toBeTruthy();
    const onReset = vi.fn();
    rerender(
      <Scene3DFrame state="filteredEmpty" canvasSlot={<div data-testid="canvas" />} onResetFilters={onReset} />,
    );
    expect(screen.getByTestId("canvas")).toBeTruthy();
    expect(screen.getByText(SCENE_TEXT.filteredEmpty)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: SCENE_TEXT.resetFilters }));
    expect(onReset).toHaveBeenCalled();
  });

  it("stale 은 장면을 지우지 않고 카드만 점선으로 표시한다", () => {
    const { container } = render(<Scene3DFrame state="stale" canvasSlot={<div data-testid="canvas" />} />);
    expect(screen.getByTestId("canvas")).toBeTruthy();
    expect(container.querySelector("section")?.className).toMatch(/stale/i);
  });

  it("데이터 오류인데 장면이 남아 있으면 지우지 않고 알림만 얹는다", () => {
    render(
      <Scene3DFrame
        state="error"
        keepScene
        canvasSlot={<div data-testid="canvas" />}
        errorTitle="구성을 다시 읽지 못했습니다. 15:12 기준 내용을 보여 줍니다."
      />,
    );
    expect(screen.getByTestId("canvas")).toBeTruthy();
    expect(screen.getByText(/15:12 기준 내용을 보여 줍니다/)).toBeTruthy();
  });

  it("알 수 없음(스냅샷 파일 확인 전)은 예시로 바꾸지 않고 사유를 보인다", () => {
    render(<Scene3DFrame state="unknown" unknownTitle="스냅샷 파일 확인 전" unknownReason="내보내기가 진행 중일 수 있습니다." unknownIcon="hourglass" />);
    expect(screen.getByText(/스냅샷 파일 확인 전/)).toBeTruthy();
  });
});

// ───────────────────────── 도구 막대·카메라·범례·정보 줄 ─────────────────────────
describe("SceneToolbar / CameraControls / SceneLegend / SceneInfoBar (16.2~16.5)", () => {
  it("도구 막대 A·B 는 이름 있는 그룹이고 결과 수를 오른쪽에 둔다", () => {
    render(
      <>
        <SceneToolbar row="a" countText="블록 128 · 관계 164">
          <button type="button">3D</button>
        </SceneToolbar>
        <SceneToolbar row="b" />
      </>,
    );
    expect(screen.getByRole("group", { name: "보기·필터 도구" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "표시 옵션" })).toBeTruthy();
    expect(screen.getByText("블록 128 · 관계 164")).toBeTruthy();
  });

  it("검색 결과 이동은 결과가 없으면 사유와 함께 비활성", () => {
    render(<SceneSearchNav index={0} total={0} onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByText("0/0")).toBeTruthy();
    expect(screen.getByRole("button", { name: "이전 결과" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("카메라 오버레이는 시점 3칸 + 버튼 3개(단축키 라벨)", () => {
    const onReset = vi.fn();
    render(
      <CameraControls view="iso" onView={() => {}} onReset={onReset} onZoomIn={() => {}} onZoomOut={() => {}} />,
    );
    const group = screen.getByRole("radiogroup", { name: "시점" });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "카메라 초기화 (0)" }));
    expect(onReset).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "확대 (+)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "축소 (−)" })).toBeTruthy();
  });

  it("범례는 층 5줄 + 확정·추정 + `블록 색은 층, 모양은 종류` 문구를 항상 보인다", () => {
    const onClose = vi.fn();
    render(<SceneLegend onClose={onClose} />);
    expect(screen.getByText("워크로드")).toBeTruthy();
    expect(screen.getByText("저장·설정")).toBeTruthy();
    expect(screen.getByText("확정")).toBeTruthy();
    expect(screen.getByText("추정")).toBeTruthy();
    for (const note of LEGEND_NOTES) expect(screen.getByText(note)).toBeTruthy();
    // 팝오버는 닫는 것이지 접는 것이 아니다(6.5) — 머리 오른쪽은 `x` 닫기다
    expect(screen.queryByRole("button", { name: "범례 접기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("옛 `collapsed` 를 넘겨도 범례를 접지 않는다 (하위 호환: 받기만 하고 무시)", () => {
    render(<SceneLegend collapsed onCollapsedChange={() => {}} />);
    expect(screen.getByText(LEGEND_NOTES[0])).toBeTruthy();
    expect(screen.queryByRole("button", { name: "범례" })).toBeNull();
  });

  it("정보 줄은 live 영역이 아니고 칩·stale·안내를 순서대로 둔다", () => {
    const { container } = render(
      <SceneInfoBar
        items={[
          { id: "counts", text: "블록 128 · 관계 164" },
          { id: "drift", icon: "square-dot", text: "차이 3건 · 15:12 계산" },
          { id: "outside", icon: "octagon-x", tone: "crit", text: "리소스 밖 발견 1건" },
        ]}
        staleAt="2026-09-19T06:12:10.000Z"
      />,
    );
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(screen.getByText("블록 128 · 관계 164")).toBeTruthy();
    expect(screen.getByText("차이 3건 · 15:12 계산")).toBeTruthy();
    expect(screen.getByRole("img", { name: "이 보기 안내" })).toBeTruthy();
  });
});

// ───────────────────────── 관계 표 ─────────────────────────
const tableRows: RelationTableRow[] = [
  {
    id: "ns/prod",
    type: "group",
    groupKind: "plate",
    depth: 0,
    label: "prod",
    count: 42,
    location: "prod/namespace.yaml",
    markers: { drift: { kind: "changed", fieldCount: 1 }, scan: { level: "warn", count: 2 } },
    actions: { file: { href: "?view=files&file=prod/namespace.yaml" }, drift: { href: "?view=drift&res=ns" } },
  },
  {
    id: "ns/prod/workload",
    type: "group",
    groupKind: "layer",
    depth: 1,
    label: "워크로드",
    count: 12,
    layer: "workload",
  },
  {
    id: "apps/Deployment/prod/api",
    type: "resource",
    depth: 2,
    layer: "workload",
    kind: "Deployment",
    name: "api",
    location: "prod",
    markers: { drift: { kind: "changed", fieldCount: 2 }, scan: { level: "warn", count: 1 } },
    incoming: 2,
    outgoing: 3,
    actions: { file: { href: "?view=files&file=prod/deployments/api.yaml" } },
    relations: { incoming: [relation()], outgoing: [] },
  },
];

describe("RelationTable (16.8 / snapshot-3d.md 8절)", () => {
  it("트리 들여쓰기·aria-level 과 표식·관계 수·동작 열을 그린다", () => {
    const { container } = render(
      <RelationTable rows={tableRows} expandedIds={["ns/prod", "ns/prod/workload"]} selectedId={null} />,
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows[0].getAttribute("aria-level")).toBe("1");
    expect(rows[0].getAttribute("aria-expanded")).toBe("true");
    expect(rows[2].getAttribute("style")).toContain("--row-indent: 32px");
    expect(screen.getAllByText("prod").length).toBeGreaterThan(0);
    expect(screen.getByText("변경 2")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /파일/ }).length).toBeGreaterThan(0);
    // 위치·들어옴·나감 열
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("행을 누르면 선택되고 관계 목록이 펼쳐진다", () => {
    const onSelectRow = vi.fn();
    render(<RelationTable rows={tableRows} expandedIds={["ns/prod", "ns/prod/workload"]} onSelectRow={onSelectRow} />);
    fireEvent.click(screen.getByText("Deployment"));
    expect(onSelectRow).toHaveBeenCalled();
    expect(screen.getByText("들어오는 관계")).toBeTruthy();
  });

  it("정렬은 `표식` 열에만 있다", () => {
    render(<RelationTable rows={tableRows} onSortChange={() => {}} />);
    const headers = screen.getAllByRole("columnheader");
    const sortable = headers.filter((h) => h.querySelector("button"));
    expect(sortable).toHaveLength(1);
    expect(sortable[0].textContent).toContain("표식");
  });

  it("빈 결과는 필터 초기화를 함께 보인다", () => {
    const onReset = vi.fn();
    render(<RelationTable rows={[]} state="filteredEmpty" onResetFilters={onReset} />);
    expect(screen.getByText("조건에 맞는 리소스가 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(onReset).toHaveBeenCalled();
  });
});

// ───────────────────────── 기존 확장 (17절) ─────────────────────────
interface Row {
  id: string;
  name: string;
  depth: number;
}
const cols: Column<Row>[] = [{ id: "name", header: "이름", render: (r) => r.name }];

describe("기존 확장 (components.md 17절)", () => {
  it("DataTable rowIndent 는 숫자·함수를 모두 받고 rowAria 를 행에 붙인다", () => {
    const rows: Row[] = [
      { id: "a", name: "a", depth: 0 },
      { id: "b", name: "b", depth: 2 },
    ];
    const { container } = render(
      <DataTable<Row>
        caption="들여쓰기"
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        rowIndent={(r) => r.depth}
        rowAria={(r) => ({ level: r.depth + 1 })}
      />,
    );
    const tr = container.querySelectorAll("tbody tr");
    expect(tr[0].getAttribute("style")).not.toContain("--row-indent");
    expect(tr[1].getAttribute("style")).toContain("--row-indent: 32px");
    expect(tr[1].getAttribute("aria-level")).toBe("3");
  });

  it("Tabs 가 6개 탭(3D 보기 포함)을 담고 화살표 키로 이동한다", () => {
    const items = [
      { id: "files", label: "파일" },
      { id: "drift", label: "드리프트", count: 3 },
      { id: "3d", label: "3D 보기" },
      { id: "counts", label: "리소스 수" },
      { id: "secrets", label: "Secret 참조", count: 7 },
      { id: "meta", label: "메타데이터" },
    ];
    const onChange = vi.fn();
    render(<Tabs items={items} value="3d" onChange={onChange} idBase="k8s" label="스냅샷 상세" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    const current = screen.getByRole("tab", { name: "3D 보기" });
    expect(current.getAttribute("aria-selected")).toBe("true");
    // 3D 탭에는 숫자·상태 아이콘이 없다
    expect(current.querySelector("svg")).toBeNull();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("counts");
  });

  it("SegmentedControl 은 아이콘·세로 배치·비활성 사유를 받는다", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="보기"
        value="table"
        onChange={onChange}
        size="sm"
        orientation="vertical"
        options={[
          { value: "3d", label: "3D", icon: "box", disabledReason: "이 브라우저에서 3D를 쓸 수 없습니다" },
          { value: "table", label: "표", icon: "table-2" },
        ]}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "보기" });
    expect(group.getAttribute("aria-orientation")).toBe("vertical");
    const threeD = screen.getByRole("radio", { name: /3D/ });
    expect(threeD.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(threeD);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Switch 는 사유가 있으면 포커스를 남긴 채 비활성이다", () => {
    const onChange = vi.fn();
    render(
      <Switch
        checked
        onChange={onChange}
        label="드리프트 겹쳐 보기"
        disabled
        disabledReason="드리프트 결과가 없습니다 (클러스터 연결 없음)"
      />,
    );
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-disabled")).toBe("true");
    expect(sw.hasAttribute("disabled")).toBe(false);
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("드리프트 결과가 없습니다 (클러스터 연결 없음)")).toBeTruthy();
  });
});

// ───────────────────────── 판 표식 (2026-09-20 보탬) ─────────────────────────
describe("판 표식 · PlateLabel (16.9 plate / 16.11, status.md 11.5)", () => {
  it("notes 는 표식 뒤 ⑤ 정보 자리에 오고 모르는 code 도 버리지 않는다", () => {
    const items = blockMarkerItems({
      scan: { level: "warn", count: 2 },
      notes: [
        { code: "custom_resource", text: "사용자 지정 리소스입니다" },
        { code: "made_up_code", text: "서버가 보낸 새 문구" },
      ],
    });
    expect(items.map((i) => i.key)).toEqual(["scan", "note:custom_resource", "note:made_up_code"]);
    expect(items[1].icon).toBe("shapes");
    expect(items[1].short).toBe("사용자 지정");
    expect(items[1].plate).toBe("사용자 지정 리소스");
    expect(items[2].short).toBe("서버가 보낸 새 문구");
  });

  it("판 알약 문구는 블록 문구와 같은 뜻을 쓴다", () => {
    const [drift] = blockMarkerItems({ drift: { kind: "changed", fieldCount: 1 } });
    expect(drift.plate).toBe("변경 · 필드 1건");
    expect(drift.text).toBe("변경됨 · 필드 1건");
    const [skipped] = blockMarkerItems({ notComparable: { kind: "skipped", text: "비교 못 함 (해석 실패)" } });
    expect(skipped.icon).toBe("file-warning");
    expect(skipped.short).toBe("비교 못 함");
  });

  it("hrefs 가 있으면 그 표식만 링크가 된다", () => {
    render(
      <BlockMarkers
        variant="inline"
        scan={{ level: "error", count: 1 }}
        helm
        hrefs={{ scan: "?view=files&file=prod/namespace.yaml&line=3" }}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("?view=files&file=prod/namespace.yaml&line=3");
    expect(screen.getByText("Helm").closest("a")).toBeNull();
  });

  it("plate 알약은 축소해도 표식이 하나는 남는다", () => {
    const markers = {
      scan: { level: "error" as const, count: 1 },
      drift: { kind: "changed" as const, fieldCount: 2 },
      helm: true,
    };
    const { container, rerender } = render(<BlockMarkers variant="plate" density={0} {...markers} />);
    expect(screen.getByText("오류 1")).toBeTruthy();
    expect(screen.getByText("변경 · 필드 2건")).toBeTruthy();
    rerender(<BlockMarkers variant="plate" density={1} {...markers} />);
    expect(screen.queryByText("오류 1")).toBeNull();
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(3);
    rerender(<BlockMarkers variant="plate" density={2} {...markers} />);
    expect(screen.getByText("3")).toBeTruthy();
    rerender(<BlockMarkers variant="plate" density={3} {...markers} />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector(".sr-only")?.textContent).toContain("Helm 관리");
  });

  it("PlateLabel 은 단계별로 줄을 줄이고 캔버스 탭 정지점을 만들지 않는다", () => {
    const onName = vi.fn();
    const { rerender } = render(
      <PlateLabel name="prod" system resourceCount={11} ghostCount={5} density={0} onNameClick={onName} />,
    );
    expect(screen.getByText("리소스 11 · 유령 5")).toBeTruthy();
    expect(screen.getByText("시스템")).toBeTruthy();
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(btn);
    expect(onName).toHaveBeenCalled();
    rerender(<PlateLabel name="prod" resourceCount={11} density={2} />);
    expect(screen.queryByText(/리소스 11/)).toBeNull();
  });

  it("클러스터 범위·해석 실패·유령 판은 문구가 다르다", () => {
    const { rerender } = render(<PlateLabel name="_cluster" kind="cluster" />);
    expect(screen.getAllByText("클러스터 범위").length).toBeGreaterThan(0);
    rerender(<PlateLabel name="unparsed" kind="unparsed" />);
    expect(screen.getAllByText("해석 실패").length).toBeGreaterThan(0);
    rerender(<PlateLabel name="payments" kind="ghost" density={0} />);
    expect(screen.getByText("스냅샷에 없음")).toBeTruthy();
  });

  it("범례에 원·알약 구분 줄이 있다", () => {
    render(<SceneLegend />);
    expect(screen.getByText(PLATE_MARKER_NOTE)).toBeTruthy();
  });

  it("Scene3DFrame 은 알림을 세로로 최대 2개만 쌓는다", () => {
    render(
      <Scene3DFrame
        state="ready"
        canvasSlot={<div />}
        notice={[<p key="a">잘림</p>, <p key="b">구성 변경</p>, <p key="c">저사양</p>]}
      />,
    );
    expect(screen.getByText("잘림")).toBeTruthy();
    expect(screen.getByText("구성 변경")).toBeTruthy();
    expect(screen.queryByText("저사양")).toBeNull();
  });
});

describe("관계 표 판 그룹 행 (16.8 / snapshot-3d.md 8.3)", () => {
  it("판 행만 위치·표식·동작을 채우고 관계 수는 해당 없음", () => {
    render(<RelationTable rows={tableRows} expandedIds={["ns/prod", "ns/prod/workload"]} />);
    expect(screen.getByText("prod/namespace.yaml")).toBeTruthy();
    expect(screen.getByText("변경 1")).toBeTruthy();
    expect(screen.getAllByLabelText("해당 없음")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /파일/ }).length).toBeGreaterThan(0);
  });

  it("판 행은 이름 버튼으로만 펼치고 선택되지 않는다", () => {
    const onExpanded = vi.fn();
    const onSelectRow = vi.fn();
    render(
      <RelationTable
        rows={tableRows}
        expandedIds={["ns/prod", "ns/prod/workload"]}
        onExpandedChange={onExpanded}
        onSelectRow={onSelectRow}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /prod/ }));
    expect(onExpanded).toHaveBeenCalledWith(["ns/prod/workload"]);
    expect(onSelectRow).not.toHaveBeenCalled();
  });

  it("자식이 0인 판 행은 표식이 있으면 남고 펼침이 비활성이다", () => {
    const rows: RelationTableRow[] = [
      { ...(tableRows[0] as RelationGroupRow), count: 0, emptyHint: "표시할 리소스 없음" },
    ];
    render(<RelationTable rows={rows} />);
    expect(screen.getByText("표시할 리소스 없음")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-disabled")).toBe("true");
  });
});

// ───────────────────────── 접근성 문장 ─────────────────────────
describe("blockSelectionAnnouncement (snapshot-3d.md 7.1)", () => {
  it("선택 결과를 한 문장으로 만든다", () => {
    expect(
      blockSelectionAnnouncement({
        kind: "Deployment",
        name: "api",
        namespace: "prod",
        markers: { drift: { kind: "changed", fieldCount: 2 } },
        incoming: 2,
        outgoing: 3,
      }),
    ).toBe("Deployment api, prod 네임스페이스, 변경됨 · 필드 2건, 들어오는 관계 2개, 나가는 관계 3개");
  });

  it("클러스터 범위 리소스는 네임스페이스 대신 `클러스터 범위`", () => {
    expect(blockSelectionAnnouncement({ kind: "ClusterRole", name: "view" })).toContain("클러스터 범위");
  });
});

// ───────────────────────── 프론트 요청 3건 (2026-09-20 보완) ─────────────────────────
describe("관계를 못 그린 사유 notes (snapshot-3d.md 7.4)", () => {
  it("세 코드 모두 `unlink` 아이콘이다", () => {
    for (const code of ["selector_missing", "no_target", "pvc_template_unmatched"]) {
      expect(NOTE_SPEC[code].icon).toBe("unlink");
    }
  });

  it("표식 문구는 짧게, 서버 문구는 툴팁·스크린리더 자리에 그대로 남는다", () => {
    const items = blockMarkerItems({
      notes: [{ code: "selector_missing", text: "셀렉터 없음(수동 Endpoints·ExternalName)" }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].icon).toBe("unlink");
    expect(items[0].short).toBe("셀렉터 없음");
    expect(items[0].text).toBe("셀렉터 없음(수동 Endpoints·ExternalName)");
  });

  it("`pvc_template_unmatched` 는 count 를 문구 안에 넣는다", () => {
    const [item] = blockMarkerItems({
      notes: [{ code: "pvc_template_unmatched", text: "PVC 템플릿 2개(스냅샷에 PVC 없음)", count: 2 }],
    });
    expect(item.short).toBe("맞는 PVC 없음 (템플릿 2)");
    expect(item.plate).toBe("PVC 템플릿 2개 — 맞는 PVC 없음");
  });

  it("등록되지 않은 code 는 여전히 서버 문구 그대로 보인다", () => {
    const [item] = blockMarkerItems({ notes: [{ code: "brand_new", text: "새 문구" }] });
    expect(item.icon).toBe("info");
    expect(item.short).toBe("새 문구");
  });

  it("표식 열에 세 사유가 아이콘 + 문구로 보인다", () => {
    render(<BlockMarkers variant="inline" notes={[{ code: "no_target", text: "대상 없음" }]} />);
    expect(screen.getByText("대상 없음")).toBeTruthy();
  });
});

describe("InlineAlert 닫기 (components.md 6.2 / snapshot-3d.md 9.5·9.9)", () => {
  it("`closable` + `onClose` 로 닫기 버튼이 생긴다", () => {
    const onClose = vi.fn();
    render(<InlineAlert tone="warn" title="구성이 너무 커서 일부만 그립니다" closable onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "이 안내 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("닫기 버튼은 `action` 뒤 마지막 자리다", () => {
    const { container } = render(
      <InlineAlert
        tone="neutral"
        compact
        title="3D가 느립니다. 표로 보기를 권합니다."
        action={<button type="button">표로 보기</button>}
        closable
        onClose={() => {}}
        closeLabel="저사양 안내 닫기"
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent?.trim() || b.getAttribute("aria-label"))).toEqual([
      "표로 보기",
      "저사양 안내 닫기",
    ]);
  });

  it("`onClose` 없이 `closable` 만 주면 그리지 않는다 (표 위 안내는 닫기 없음)", () => {
    const { container } = render(<InlineAlert tone="warn" title="구성이 너무 커서 일부만 그립니다" closable />);
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("그룹 행 개수 (snapshot-3d.md 8.3)", () => {
  it("필터가 없으면 개수 하나만 보인다", () => {
    render(<RelationTable rows={tableRows} />);
    expect(screen.getByText("(42)")).toBeTruthy();
  });

  it("`totalCount` 가 다르면 `보이는 수 / 전체` 두 값을 보인다", () => {
    const rows: RelationTableRow[] = [{ ...(tableRows[0] as RelationGroupRow), count: 3, totalCount: 11 }];
    render(<RelationTable rows={rows} />);
    expect(screen.getByText("(3 / 11)")).toBeTruthy();
    expect(screen.getByText("11개 중 3개 표시")).toBeTruthy();
  });

  it("두 값이 같으면 한 번만 보인다", () => {
    const rows: RelationTableRow[] = [{ ...(tableRows[0] as RelationGroupRow), count: 11, totalCount: 11 }];
    render(<RelationTable rows={rows} />);
    expect(screen.getByText("(11)")).toBeTruthy();
    expect(screen.queryByText("(11 / 11)")).toBeNull();
  });

  it("필터로 자식이 0이 되어도 전체 수가 남는다", () => {
    const rows: RelationTableRow[] = [
      { ...(tableRows[0] as RelationGroupRow), count: 0, totalCount: 11, emptyHint: "표시할 리소스 없음" },
    ];
    render(<RelationTable rows={rows} />);
    expect(screen.getByText("(0 / 11)")).toBeTruthy();
    expect(screen.getByText("표시할 리소스 없음")).toBeTruthy();
  });
});

// ───────────── 2026-09-20 (4) 디자인 보완: KindIcon · 범례 팝오버 · 닫기 이름 통일 ─────────────
describe("KindIcon (components.md 16.12 / snapshot-3d.md 4.10)", () => {
  it("종류 → 아이콘 매핑이 4.10 표와 같다", () => {
    const table: [string, string][] = [
      ["Deployment", "boxes"],
      ["StatefulSet", "database"],
      ["DaemonSet", "grid-2x2"],
      ["CronJob", "timer"],
      ["Job", "briefcase"],
      ["ReplicaSet", "copy"],
      ["Pod", "box"],
      ["Service", "network"],
      ["Ingress", "door-open"],
      ["PersistentVolumeClaim", "hard-drive"],
      ["PersistentVolume", "hard-drive"],
      ["ConfigMap", "settings-2"],
      ["Secret", "key-round"],
      ["HorizontalPodAutoscaler", "trending-up"],
      ["PodDisruptionBudget", "life-buoy"],
      ["NetworkPolicy", "shield"],
      ["ServiceAccount", "user-round"],
      ["Role", "scroll-text"],
      ["ClusterRole", "scroll-text"],
      ["RoleBinding", "link"],
      ["ClusterRoleBinding", "link"],
      ["ResourceQuota", "gauge"],
      ["LimitRange", "ruler"],
      ["CustomResourceDefinition", "shapes"],
      ["Namespace", "folder"],
    ];
    for (const [kind, icon] of table) expect(kindIconName(kind)).toBe(icon);
    expect(Object.keys(KIND_ICON)).toHaveLength(table.length);
  });

  it("모르는 종류·빈 값은 `box`, `custom` 은 `shapes`, 판은 4줄 매핑을 쓴다", () => {
    expect(kindIconName("ResourceSlice")).toBe("box");
    expect(kindIconName(null)).toBe("box");
    expect(kindIconName("Deployment", true)).toBe("shapes");
    expect(plateIconName("namespace")).toBe("folder");
    expect(plateIconName("cluster")).toBe("globe");
    expect(plateIconName("unparsed")).toBe("file-warning");
    expect(plateIconName("ghost")).toBe("circle-dashed");
  });

  it("종류 아이콘은 표식 아이콘 9종과 글리프가 겹치지 않는다 (status.md 11.6)", () => {
    const markerIcons = [
      "octagon-x",
      "triangle-alert",
      "square-dot",
      "square-minus",
      "square-plus",
      "eye-off",
      "file-warning",
      "ship-wheel",
      "circle-dashed",
      "file-question",
    ];
    for (const icon of Object.values(KIND_ICON)) expect(markerIcons).not.toContain(icon);
  });

  it("언제나 장식이다 (aria-hidden, 종류 이름이 옆에 글자로 있다)", () => {
    const { container } = render(<KindIcon kind="Deployment" size={16} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("16");
  });

  it("등록한 lucide 아이콘 8개가 모두 그려진다", () => {
    const names = [
      "hard-drive",
      "network",
      "door-open",
      "grid-2x2",
      "briefcase",
      "user-round",
      "scroll-text",
      "link",
    ] as const;
    const { container } = render(
      <>
        {names.map((n) => (
          <Icon key={n} name={n} size={14} />
        ))}
      </>,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(names.length);
  });

  it("선택 패널·관계 표가 `kind` 만으로 아이콘을 고른다 (표를 복제하지 않는다)", () => {
    const { container } = render(
      <BlockDetailPanel
        block={{ id: "core/Service/prod/api", layer: "service", kind: "Service", name: "api", namespace: "prod" }}
      />,
    );
    expect(container.querySelector(".lucide-network")).toBeTruthy();
  });

  it("`custom` 리소스는 패널에서 shapes 를 쓴다", () => {
    const { container } = render(
      <BlockDetailPanel
        block={{ id: "x/Foo/prod/a", layer: "aux", kind: "Foo", custom: true, name: "a", namespace: "prod" }}
      />,
    );
    expect(container.querySelector(".lucide-shapes")).toBeTruthy();
  });
});

// ───────────────────────── 모양 9종 (4.11 · 16.12 `kindShape()` · 16.13 `ShapeSwatch`) ─────────────────────────
describe("종류 → 모양 매핑 (`kindShape()`, snapshot-3d.md 4.11.2)", () => {
  it("4.11.2 표 그대로다 (모양이 따로 있는 종류 11개)", () => {
    const table: [string, VizShape][] = [
      ["Deployment", "stack"],
      ["StatefulSet", "cylinder"],
      ["DaemonSet", "panel"],
      ["CronJob", "roof"],
      ["Job", "chamfer"],
      ["Service", "diamond"],
      ["Ingress", "gate"],
      ["PersistentVolumeClaim", "cylinder"],
      ["PersistentVolume", "cylinder"],
      ["ConfigMap", "panel"],
      ["Secret", "chamfer"],
    ];
    for (const [kind, shape] of table) expect(kindShape(kind)).toBe(shape);
    expect(Object.keys(KIND_SHAPE)).toHaveLength(table.length);
  });

  it("Pod·ReplicaSet·모르는 종류·빈 값은 기본형 `box` 다 (빈 자리를 두지 않는다)", () => {
    expect(kindShape("Pod")).toBe("box");
    expect(kindShape("ReplicaSet")).toBe("box");
    expect(kindShape("ResourceSlice")).toBe("box");
    expect(kindShape(null)).toBe("box");
    expect(kindShape(undefined)).toBe("box");
  });

  it("곁 층은 종류·custom 과 무관하게 `tile`, 곁이 아닌 층의 custom 은 `box` 다", () => {
    expect(kindShape("HorizontalPodAutoscaler", { layer: "aux" })).toBe("tile");
    expect(kindShape("Deployment", { layer: "aux" })).toBe("tile");
    expect(kindShape("Foo", { custom: true, layer: "aux" })).toBe("tile");
    expect(kindShape("Foo", { custom: true, layer: "workload" })).toBe("box");
    // 층을 주지 않아도 종류 매핑은 그대로다(층은 서버 값이라 없을 수 있다)
    expect(kindShape("Deployment", { layer: "workload" })).toBe("stack");
  });

  it("아이콘 매핑과 한 파일에 있고 서로 다른 축이다 (모양 9종 ⊂ 아이콘 20여 종)", () => {
    const shapes = new Set<VizShape>(Object.values(KIND_SHAPE));
    shapes.add("box");
    shapes.add("tile");
    expect(shapes.size).toBe(9);
    // 같은 층 안에서 갈려야 한다: 워크로드 5종이 모두 다른 모양
    const workload = ["Deployment", "StatefulSet", "DaemonSet", "CronJob", "Job"].map((k) => kindShape(k));
    expect(new Set(workload).size).toBe(5);
    // 저장·설정 층도 갈린다
    const storage = ["PersistentVolumeClaim", "ConfigMap", "Secret"].map((k) => kindShape(k));
    expect(new Set(storage).size).toBe(3);
  });
});

describe("모양 견본 (`ShapeSwatch`, components.md 16.13)", () => {
  const ALL_SHAPES: VizShape[] = [
    "box",
    "stack",
    "cylinder",
    "panel",
    "roof",
    "chamfer",
    "gate",
    "diamond",
    "tile",
  ];

  it("9종 모두 윤곽 + 윗면 경계선 1개를 그린다 (밝기 3단 없음)", () => {
    for (const shape of ALL_SHAPES) {
      const path = SHAPE_PATH[shape];
      expect(path.parts.length).toBeGreaterThan(0);
      expect(path.line).toBeTruthy();
    }
    // 겹 상자는 두 덩이, 아치 문은 다리 3 + 보 1 (뒤 조각의 가려진 선을 앞 조각의 면이 덮는다)
    expect(SHAPE_PATH.stack.parts).toHaveLength(2);
    expect(SHAPE_PATH.gate.parts).toHaveLength(4);
    // 박공 지붕만 윗면이 면이 아니라 능선이다
    expect(SHAPE_PATH.roof.top).toBeNull();
  });

  it("모든 점이 viewBox 16 안에 있다 (1px 윤곽이 잘리지 않게 사방 여백을 남긴다)", () => {
    for (const shape of ALL_SHAPES) {
      const path = SHAPE_PATH[shape];
      const ds = [...path.parts, path.top ?? "", path.line ?? ""].join(" ");
      const numbers = ds.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
      expect(numbers.length).toBeGreaterThan(0);
      for (const v of numbers) {
        expect(v).toBeGreaterThanOrEqual(0.6);
        expect(v).toBeLessThanOrEqual(15.4);
      }
    }
  });

  it("9종의 실루엣이 서로 다르다 (같은 path 가 없다)", () => {
    const seen = new Set(ALL_SHAPES.map((s) => SHAPE_PATH[s].parts.join("|")));
    expect(seen.size).toBe(ALL_SHAPES.length);
  });

  it("언제나 장식이다 (aria-hidden, 옆에 종류 문구가 글자로 있다)", () => {
    const { container } = render(<ShapeSwatch shape="stack" size={16} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 16 16");
  });

  it("`tone=\"layer\"` 일 때만 층 색을 쓴다 (기본은 중립)", () => {
    const { container: neutral } = render(<ShapeSwatch shape="box" />);
    expect(neutral.querySelector("svg")?.getAttribute("data-layer")).toBeNull();
    cleanup();
    const { container: layered } = render(<ShapeSwatch shape="box" size={14} tone="layer" layer="workload" />);
    const svg = layered.querySelector("svg");
    expect(svg?.getAttribute("data-layer")).toBe("workload");
    expect(svg?.getAttribute("width")).toBe("14");
  });
});

describe("범례 「모양 = 종류」 절 (6.5 · 16.5)", () => {
  it("층 5줄 바로 아래에 9항목이 고정 순서·고정 문구로 온다", () => {
    render(<SceneLegend />);
    const list = screen.getByRole("list", { name: SHAPE_SECTION_TITLE });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(9);
    expect(items.map((li) => li.textContent)).toEqual(DEFAULT_LEGEND_SHAPES.map((s) => s.label));
    expect(DEFAULT_LEGEND_SHAPES[0]).toEqual({ shape: "stack", label: "Deployment" });
    expect(DEFAULT_LEGEND_SHAPES[8]).toEqual({ shape: "tile", label: "곁 리소스 (HPA · PDB 외)" });
    // 층 5줄이 모양 절보다 앞이다(색 → 모양 순서로 읽힌다)
    const body = screen.getByLabelText("범례");
    expect(body.textContent?.indexOf("워크로드")).toBeLessThan(body.textContent?.indexOf(SHAPE_SECTION_TITLE) ?? -1);
  });

  it("맨 아래 문장이 모양까지 말한다 (모양도 상태가 아니다)", () => {
    render(<SceneLegend />);
    expect(screen.getByText("블록 색은 층, 모양은 종류를 뜻합니다. 상태가 아닙니다.")).toBeTruthy();
  });

  it("`shapes={[]}` 를 주면 모양 절을 그리지 않는다", () => {
    render(<SceneLegend shapes={[]} />);
    expect(screen.queryByText(SHAPE_SECTION_TITLE)).toBeNull();
    expect(screen.getByText("워크로드")).toBeTruthy();
  });
});

describe("종류 필터 옵션의 모양 견본 (6.1 · 16.2)", () => {
  it("`MultiSelect` 옵션이 라벨 앞에 견본을 둔다 (아이콘 자리를 대신한다)", () => {
    render(
      <MultiSelect
        label="종류"
        width={140}
        value={[]}
        onChange={() => {}}
        options={[
          {
            value: "Deployment",
            label: "Deployment",
            count: 12,
            adornment: <ShapeSwatch shape={kindShape("Deployment")} size={14} tone="layer" layer="workload" />,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "종류: 전체" }));
    const option = screen.getByRole("checkbox", { name: /Deployment/ });
    const row = option.closest("label");
    const svg = row?.querySelector("svg");
    expect(svg?.getAttribute("data-shape")).toBe("stack");
    expect(svg?.getAttribute("data-layer")).toBe("workload");
    // 견본은 장식이고 종류 이름·개수는 글자로 남는다
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(row?.textContent).toContain("Deployment");
    expect(row?.textContent).toContain("12");
  });
});

describe("관계 표 판 행 아이콘 (16.8 `plateKind`)", () => {
  it("`plateKind` 로 판 아이콘을 고른다", () => {
    const rows: RelationTableRow[] = [{ ...(tableRows[0] as RelationGroupRow), plateKind: "cluster" }];
    const { container } = render(<RelationTable rows={rows} />);
    expect(container.querySelector(".lucide-globe")).toBeTruthy();
  });

  it("`icon` 을 직접 주면 그것을 쓴다 (기존 호출 유지)", () => {
    const rows: RelationTableRow[] = [{ ...(tableRows[0] as RelationGroupRow), plateKind: "cluster", icon: "folder" }];
    const { container } = render(<RelationTable rows={rows} />);
    expect(container.querySelector(".lucide-folder")).toBeTruthy();
    expect(container.querySelector(".lucide-globe")).toBeNull();
  });
});

describe("Banner 닫기 이름 통일 (components.md 6.1 · 17.6)", () => {
  it("`closable`/`onClose` 로 닫는다", () => {
    const onClose = vi.fn();
    render(<Banner tone="warn" title="연결이 끊겼습니다" closable onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("옛 `dismissible`/`onDismiss` 도 그대로 동작한다 (deprecated, 사용처를 고치지 않는다)", () => {
    const onDismiss = vi.fn();
    render(<Banner tone="warn" title="연결이 끊겼습니다" dismissible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("닫기 짝이 맞지 않으면 버튼을 그리지 않는다", () => {
    const { container } = render(<Banner tone="info" title="안내" closable />);
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("Popover align·maxHeight (components.md 17.7)", () => {
  it("`maxHeight` 를 패널에 건다", () => {
    render(
      <Popover
        label="범례"
        width={280}
        align="end"
        maxHeight={520}
        trigger={(p) => (
          <button type="button" {...p}>
            범례
          </button>
        )}
      >
        <SceneLegend />
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "범례" }));
    const panel = screen.getByRole("dialog", { name: "범례" });
    expect(panel.style.maxHeight).toBe("520px");
    expect(panel.style.width).toContain("280px");
    expect(within(panel).getByText(LEGEND_NOTES[0])).toBeTruthy();
  });
});

describe("PlateLabel 이름 앞 아이콘 (snapshot-3d.md 4.1 · components.md 16.11)", () => {
  it("유령 판은 단계와 무관하게 circle-dashed 12px 을 보인다", () => {
    for (const density of [0, 1, 2, 3] as const) {
      const { container, unmount } = render(<PlateLabel name="payments" kind="ghost" density={density} />);
      const icon = container.querySelector(".lucide-circle-dashed");
      expect(icon).toBeTruthy();
      expect(icon?.getAttribute("width")).toBe("12");
      unmount();
    }
  });

  it("보통 네임스페이스에는 이름 앞 아이콘을 두지 않는다 (P2·P3 이름 폭 보호)", () => {
    const { container } = render(<PlateLabel name="prod" resourceCount={11} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("클러스터 범위·해석 실패는 14px 아이콘을 쓴다", () => {
    const { container, rerender } = render(<PlateLabel name="_cluster" kind="cluster" />);
    expect(container.querySelector(".lucide-globe")?.getAttribute("width")).toBe("14");
    rerender(<PlateLabel name="unparsed" kind="unparsed" />);
    expect(container.querySelector(".lucide-file-warning")?.getAttribute("width")).toBe("14");
  });
});

describe("정보 줄 동작 칩 · 9.4 알림 live (snapshot-3d.md 6.4·9.4, components.md 16.1·16.4)", () => {
  it("`onClick` 칩은 button, `href` 칩은 link, 둘 다 없으면 글자다", () => {
    const onClick = vi.fn();
    render(
      <SceneInfoBar
        hint=""
        items={[
          { id: "plain", text: "묶어 보기" },
          { id: "link", text: "라벨 3개 숨김", href: "?gview=table" },
          { id: "act", text: "일부가 화면 밖", icon: "maximize", onClick },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "라벨 3개 숨김" })).toBeTruthy();
    const button = screen.getByRole("button", { name: "일부가 화면 밖" });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "묶어 보기" })).toBeNull();
    expect(screen.queryByRole("link", { name: "묶어 보기" })).toBeNull();
    expect(screen.getByText("묶어 보기")).toBeTruthy();
  });

  it("`actionLabel` 은 접근 이름을 `<text> — <actionLabel>` 로 만든다 (버튼·링크 모두)", () => {
    render(
      <SceneInfoBar
        hint=""
        items={[
          { id: "a", text: "일부가 화면 밖", onClick: () => {}, actionLabel: "전체가 보이게 축소" },
          { id: "b", text: "표식 2개 숨김", href: "?gview=table", actionLabel: "표로 보기" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "일부가 화면 밖 — 전체가 보이게 축소" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "표식 2개 숨김 — 표로 보기" })).toBeTruthy();
  });

  it("`href` 와 `onClick` 을 함께 주면 `href` 를 무시하고 경고한다 (배타)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onClick = vi.fn();
    render(<SceneInfoBar hint="" items={[{ id: "both", text: "사용자 지정 3", href: "?x=1", onClick }]} />);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "사용자 지정 3" }));
    expect(onClick).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("9.4 알림 3종(청크 실패·컨텍스트 손실·데이터 오류)은 live 다", () => {
    for (const state of ["chunkFailed", "contextLost"] as const) {
      const { container, unmount } = render(<Scene3DFrame state={state} tableSlot={<div />} />);
      expect(container.querySelector('[role="status"]')).toBeTruthy();
      unmount();
    }
    const { container } = render(<Scene3DFrame state="error" keepScene canvasSlot={<div />} />);
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it("9.3 WebGL 없음 안내는 live 가 아니다 (탭을 여는 순간부터 있는 사실)", () => {
    const { container } = render(<Scene3DFrame state="unsupported" tableSlot={<div />} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(screen.getByText("이 브라우저에서 3D를 쓸 수 없어 표로 보여 줍니다")).toBeTruthy();
  });
});

describe("정보 줄 한 줄 고정 (snapshot-3d.md 6.4 · components.md 16.4)", () => {
  it("줄바꿈하지 않고, 줄어드는 것은 마지막 칩 하나다", () => {
    const { container } = render(
      <SceneInfoBar
        hint=""
        items={[
          { id: "counts", text: "블록 128 · 관계 164" },
          { id: "drift", icon: "square-dot", text: "차이 3건 · 15:12 계산" },
          { id: "more", text: "+2", tooltip: "일부가 화면 밖 · 라벨 3개 숨김" },
        ]}
      />,
    );
    const bar = screen.getByRole("group", { name: "보기 정보" });
    expect(bar.className).toContain("infoBar");
    const shrinkable = container.querySelectorAll('[class*="infoChipShrink"]');
    expect(shrinkable).toHaveLength(1);
    expect(shrinkable[0].textContent).toContain("+2");
  });

  it("프론트가 합친 `+N` 칩은 지금 시그니처로 그대로 그려진다 (툴팁에 전체 목록)", () => {
    render(
      <SceneInfoBar
        hint=""
        items={[
          { id: "counts", text: "블록 128 · 관계 164" },
          { id: "more", text: "+2", tooltip: "일부가 화면 밖 · 라벨 3개 숨김", actionLabel: "숨은 정보 보기", onClick: () => {} },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "+2 — 숨은 정보 보기" })).toBeTruthy();
  });
});

describe("도구 막대 결과 수 자리 (components.md 16.2 · snapshot-3d.md 6.1)", () => {
  it("결과 수는 본문·trailing 과 **같은 줄**(같은 부모)에 있고 지워지지 않는다", () => {
    const { container } = render(
      <SceneToolbar row="a" countText="블록 128개 중 12개 · 관계 24개" trailing={<button type="button">필터 초기화</button>}>
        <button type="button">3D</button>
      </SceneToolbar>,
    );
    const row = screen.getByRole("group", { name: "보기·필터 도구" });
    const main = container.querySelector('[class*="toolbarMain"]');
    const count = container.querySelector('[class*="toolbarCount"]');
    const trailing = container.querySelector('[class*="toolbarTrailing"]');
    expect(main?.parentElement).toBe(row);
    expect(count?.parentElement).toBe(row);
    expect(trailing?.parentElement).toBe(row);
    expect(count?.textContent).toBe("블록 128개 중 12개 · 관계 24개");
  });
});

describe("정보 줄 칩 잘림 회귀 (snapshot-3d.md 6.4)", () => {
  const vizCss = () => {
    const rel = "src/components/ui/viz/viz.module.css";
    const path = existsSync(join(process.cwd(), rel)) ? join(process.cwd(), rel) : join(process.cwd(), "apps/web", rel);
    return readFileSync(path, "utf8");
  };

  it("칩(툴팁 래퍼 포함)은 스스로 줄어들지 않는다 — 자리가 되면 전문 그대로", () => {
    const css = vizCss();
    // 툴팁 칩은 Tooltip 래퍼가 flex 항목이라 `.chip` 의 flex-shrink 가 닿지 않는다 → 직계 자식 전부를 막는다
    expect(css).toMatch(/\.infoBar > \*\s*\{\s*flex-shrink: 0;/);
    // 부모가 shrink-to-fit 이라 `min(480px, 100%)` 의 100%가 내용 최소 폭으로 잡혔다 → 고정 480px + max-content
    expect(css).toContain("max-width: 480px;");
    expect(css).not.toContain("max-width: min(480px, 100%)");
  });

  it("줄어들 수 있는 것은 마지막 칩 하나뿐이다(래퍼도 함께 지정)", () => {
    const css = vizCss();
    const rule = css.slice(css.indexOf(".infoBar > .infoChipShrink"));
    expect(rule).toContain(".infoBar > :has(> .infoChipShrink)");
    expect(rule.slice(0, rule.indexOf("}"))).toContain("flex-shrink: 1;");
    // 줄어드는 대상 자체가 하나뿐인지는 DOM 으로도 고정한다(아래 테스트)
  });

  it("칩이 4개여도 `infoChipShrink` 는 마지막 하나에만 붙는다", () => {
    const { container } = render(
      <SceneInfoBar
        hint=""
        mockBadge={<span>MOCK 데이터</span>}
        items={[
          { id: "counts", text: "블록 27 · 관계 31", tooltip: "전체 블록 33(유령 9) · 전체 관계 26" },
          { id: "drift", icon: "square-dot", text: "차이 3건 · 12:23 계산" },
          { id: "labels", text: "라벨 20개 숨김", href: "?gview=table" },
          { id: "offscreen", text: "일부가 화면 밖", onClick: () => {} },
        ]}
      />,
    );
    const shrinkable = container.querySelectorAll('[class*="infoChipShrink"]');
    expect(shrinkable).toHaveLength(1);
    expect(shrinkable[0].textContent).toContain("일부가 화면 밖");
    // 앞 칩 3개의 문구는 컴포넌트가 자르지 않는다(말줄임은 CSS 가 자리 없을 때만 한다)
    expect(screen.getByText("블록 27 · 관계 31")).toBeTruthy();
    expect(screen.getByText("차이 3건 · 12:23 계산")).toBeTruthy();
    expect(screen.getByText("라벨 20개 숨김")).toBeTruthy();
  });
});
