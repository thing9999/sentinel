// @vitest-environment jsdom
/**
 * kops-support 퍼블리싱 확인 (components.md 18·19절, cluster-status.md 3.2, status.md 2.5).
 * 가장 중요한 것: **"알 수 없음(보고 없음)"과 "데이터 오래됨"이 시각적으로 구분되는가.**
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ControlPlanePreview } from "../__preview__/ControlPlanePreview";
import { ComponentMatrix, columnTooltip } from "../cluster/ComponentMatrix";
import {
  COST_CATEGORY_LABEL,
  COST_CATEGORY_ORDER,
  CONTROL_PLANE_KIND_LABEL,
  CONTROL_PLANE_KIND_ORDER,
} from "../cost/costCategory";
import { Icon } from "../icons";
import { StatusCard } from "../status/StatusCard";
import { SummaryStrip, SummaryStripItem } from "../status/SummaryStrip";
import { ResourceName } from "../table/ResourceName";
import type { ComponentMatrixCell, ComponentMatrixColumn, ComponentMatrixRow } from "../cluster/ComponentMatrix";

afterEach(() => cleanup());

const T0 = "2026-09-19T05:02:10.000Z";

const ROWS: ComponentMatrixRow[] = [
  { id: "kube-apiserver", label: "kube-apiserver" },
  { id: "kube-controller-manager", label: "kube-controller-manager" },
  { id: "kube-scheduler", label: "kube-scheduler" },
  { id: "etcd-manager-main", label: "etcd-manager-main" },
  { id: "etcd-manager-events", label: "etcd-manager-events" },
];

const COLUMNS: ComponentMatrixColumn[] = [
  { id: "a", name: "i-0a1b2c3d4e5f6a7b8", meta: "ap-northeast-2a · t3.medium", status: "ok" },
  {
    id: "c",
    name: "i-0c3d4e5f6a7b8c9d0",
    meta: "ap-northeast-2c · t3.medium",
    status: "warn",
    notReporting: true,
    reason: "NotReady 4분",
  },
  { id: "d", name: "i-0e5f6a7b8c9d0e1f2", meta: "ap-northeast-2d · t3.medium", status: "ok" },
];

const cells = (): ComponentMatrixCell[] =>
  ROWS.flatMap((r) => [
    r.id === "kube-scheduler"
      ? {
          columnId: "a",
          rowId: r.id,
          state: "crit" as const,
          label: "장애",
          detail: "CrashLoopBackOff · 재시작 4회",
          href: "/cluster/pods/kube-system/kube-scheduler-i-0a1b",
        }
      : { columnId: "a", rowId: r.id, state: "ok" as const, label: "Ready", href: `/cluster/pods/kube-system/${r.id}-a` },
    {
      columnId: "c",
      rowId: r.id,
      state: "notReporting" as const,
      label: "노드 미보고",
      detail: "마지막 보고 04:58",
      href: `/cluster/pods/kube-system/${r.id}-c`,
    },
    { columnId: "d", rowId: r.id, state: "ok" as const, label: "Ready" },
  ]);

function renderMatrix(extra: Partial<React.ComponentProps<typeof ComponentMatrix>> = {}) {
  return render(
    <ComponentMatrix
      caption="컨트롤 플레인 구성요소 상태"
      columns={COLUMNS}
      rows={ROWS}
      cells={cells()}
      summary={[
        { state: "ok", count: 9 },
        { state: "warn", count: 0 },
        { state: "crit", count: 1 },
        { state: "unknown", count: 5 },
      ]}
      {...extra}
    />,
  );
}

const cellNodes = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("tbody [data-cell-state]"));

describe("ComponentMatrix — 마크업·접근성 (components.md 18.1)", () => {
  it("진짜 <table> 로 그리고 행·열 관계가 읽힌다", () => {
    const { container } = renderMatrix();
    const table = container.querySelector("table")!;
    expect(table).not.toBeNull();
    expect(table.querySelector("caption")!.textContent).toBe("컨트롤 플레인 구성요소 상태");

    const colHeads = Array.from(table.querySelectorAll("thead th"));
    expect(colHeads).toHaveLength(COLUMNS.length + 1); // 왼쪽 위 빈 칸 + 마스터 3
    expect(colHeads.every((th) => th.getAttribute("scope") === "col")).toBe(true);

    const rowHeads = Array.from(table.querySelectorAll("tbody th"));
    expect(rowHeads).toHaveLength(ROWS.length);
    expect(rowHeads.every((th) => th.getAttribute("scope") === "row")).toBe(true);
    expect(rowHeads[0].textContent).toContain("kube-apiserver");
  });

  it("셀은 `<구성요소>, <마스터>, <상태 문구>, <보조 문구>` 로 읽힌다", () => {
    const { container } = renderMatrix();
    const texts = Array.from(container.querySelectorAll("tbody .sr-only")).map((n) => n.textContent);
    expect(texts).toContain("kube-scheduler, i-0a1b2c3d4e5f6a7b8, 장애, CrashLoopBackOff · 재시작 4회");
    expect(texts).toContain("kube-apiserver, i-0c3d4e5f6a7b8c9d0, 노드 미보고, 마지막 보고 04:58");
  });

  it("칸을 화면이 만들지 않는다 — 셀이 없는 자리는 비운다", () => {
    const { container } = render(
      <ComponentMatrix caption="c" columns={COLUMNS} rows={ROWS} cells={[cells()[0]]} />,
    );
    expect(cellNodes(container)).toHaveLength(1);
  });
});

describe("ComponentMatrix — 보고 없음 vs 데이터 오래됨 (status.md 2.5)", () => {
  it("보고 없음만 빗금 + solid 테두리이고, 문구는 `마지막 보고 HH:mm`", () => {
    const { container } = renderMatrix();
    const nodes = cellNodes(container);
    const notReporting = nodes.filter((n) => n.className.includes("cellHatched"));
    expect(notReporting).toHaveLength(ROWS.length); // c 열 5칸
    for (const n of notReporting) {
      expect(n.dataset.cellState).toBe("notReporting");
      expect(n.className).toContain("cell-notReporting"); // 배경·테두리는 unknown 색(solid)
      expect(n.className).not.toContain("cell-stale");
      expect(n.textContent).toContain("노드 미보고");
      expect(n.textContent).toContain("마지막 보고 04:58");
    }
    // 보고 없음 셀 말고는 빗금이 없다
    expect(nodes.filter((n) => n.className.includes("cellHatched"))).toHaveLength(ROWS.length);
  });

  it("데이터 오래됨은 빗금 없이 dashed 테두리 + `HH:mm:ss 기준`", () => {
    const { container } = renderMatrix({ staleAt: T0 });
    const nodes = cellNodes(container);
    const okCell = nodes.find((n) => !n.className.includes("cellHatched"))!;
    expect(okCell.className).toContain("cell-stale");
    expect(okCell.className).not.toContain("cellHatched");
    expect(okCell.textContent).toContain("데이터 오래됨");
    expect(okCell.textContent).toMatch(/\d{2}:\d{2}:\d{2} 기준/);
    expect(okCell.textContent).not.toContain("마지막 보고");
  });

  it("stale 이 이겨도 보고 없음 표식(빗금)은 지우지 않는다", () => {
    const { container } = renderMatrix({ staleAt: T0 });
    const hatched = cellNodes(container).filter((n) => n.className.includes("cellHatched"));
    expect(hatched).toHaveLength(ROWS.length);
    // 배지는 stale 로 교체되지만 빗금이 남아 "마스터가 보고를 멈췄다"는 사실이 화면에 남는다
    expect(hatched.every((n) => n.className.includes("cell-stale"))).toBe(true);
  });

  it("두 표현은 클래스가 겹치지 않는다(흑백에서도 갈린다)", () => {
    const { container } = render(
      <ComponentMatrix
        caption="c"
        columns={[COLUMNS[0]]}
        rows={[ROWS[0], ROWS[1]]}
        cells={[
          { columnId: "a", rowId: ROWS[0].id, state: "notReporting", label: "노드 미보고", detail: "마지막 보고 04:58" },
          { columnId: "a", rowId: ROWS[1].id, state: "stale", label: "데이터 오래됨", detail: "14:02:10 기준" },
        ]}
      />,
    );
    const [a, b] = cellNodes(container).map((n) => n.className);
    expect(a).toContain("cellHatched");
    expect(a).toContain("cell-notReporting");
    expect(b).not.toContain("cellHatched");
    expect(b).toContain("cell-stale");
  });
});

describe("ComponentMatrix — crit 강조와 클릭 (cluster-status.md 3.2.3)", () => {
  it("crit 셀이 있는 행 머리·열 머리에 octagon-x 표식이 붙는다", () => {
    const { container } = renderMatrix();
    const schedulerHead = Array.from(container.querySelectorAll("tbody th")).find((th) =>
      th.textContent?.includes("kube-scheduler"),
    )!;
    expect(schedulerHead.querySelector("svg")!.getAttribute("class")).toMatch(/octagon-x|fg-crit/);

    const colHead = container.querySelectorAll("thead th")[1]; // a 열(장애 셀이 있는 마스터)
    expect(colHead.querySelector("svg")!.getAttribute("class")).toMatch(/octagon-x|fg-crit/);

    // 머리 아이콘은 축마다 하나뿐이다: 장애가 없는 행의 머리에는 octagon-x 가 붙지 않는다
    const otherHead = Array.from(container.querySelectorAll("tbody th")).find((th) =>
      th.textContent?.includes("etcd-manager-main"),
    )!;
    expect(otherHead.querySelectorAll("svg")).toHaveLength(1);
    expect(otherHead.querySelector("svg")!.getAttribute("class")).not.toMatch(/octagon-x|fg-crit/);
  });

  it("`노드 미보고`·`없음` 셀은 링크를 만들지 않는다", () => {
    const { container } = renderMatrix();
    const nodes = cellNodes(container);
    const notReporting = nodes.filter((n) => n.className.includes("cellHatched"));
    expect(notReporting.every((n) => n.tagName.toLowerCase() !== "a")).toBe(true);
    expect(notReporting.every((n) => n.getAttribute("aria-disabled") === "true")).toBe(true);
    // 정상 셀은 href 가 있으면 링크
    expect(nodes.some((n) => n.tagName.toLowerCase() === "a")).toBe(true);
  });

  it("한 줄 요약: 합계 + 0인 항목은 죽인 색, 숫자는 **핸들러 없이도** 강조 버튼", () => {
    const { container } = renderMatrix(); // onSummaryClick 을 주지 않는다
    expect(container.textContent).toContain("필수 15칸");
    const zero = screen.getByText("주의 0").parentElement!;
    expect(zero.className).toContain("matrixSummaryZero");
    expect(zero.tagName.toLowerCase()).toBe("span"); // 0은 강조할 칸이 없어 버튼이 아니다
    expect(screen.getByRole("button", { name: /장애 1/ })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(3); // 정상 9 · 장애 1 · 알 수 없음 5
  });

  it("요약 숫자를 누르면 그 상태 칸만 강조된다(강조는 컴포넌트 안에서 끝난다)", () => {
    const { container } = renderMatrix();
    fireEvent.click(screen.getByRole("button", { name: /장애 1/ }));
    const flashed = cellNodes(container).filter((n) => n.className.includes("cellFlash"));
    expect(flashed).toHaveLength(1);
    expect(flashed[0].dataset.cellState).toBe("crit");

    // `알 수 없음`은 보고 없음·없음 칸을 함께 가리킨다
    fireEvent.click(screen.getByRole("button", { name: /알 수 없음 5/ }));
    const unknownFlashed = cellNodes(container).filter((n) => n.className.includes("cellFlash"));
    expect(unknownFlashed).toHaveLength(ROWS.length);
    expect(unknownFlashed.every((n) => n.dataset.cellState === "notReporting")).toBe(true);
  });

  it("onSummaryClick 을 주면 강조에 더해 호출된다(선택 prop)", () => {
    const seen: string[] = [];
    renderMatrix({ onSummaryClick: (s) => seen.push(s) });
    fireEvent.click(screen.getByRole("button", { name: /장애 1/ }));
    expect(seen).toEqual(["crit"]);
  });
});

describe("ComponentMatrix — 열 수 1~6, 상태별", () => {
  it("열이 1개여도 5개여도 같은 컴포넌트로 그린다(--cols 로 폭만 바뀐다)", () => {
    for (const n of [1, 2, 3, 5, 6]) {
      const cols: ComponentMatrixColumn[] = Array.from({ length: n }, (_, i) => ({
        id: `m${i}`,
        name: `i-0000000000000000${i}`,
        status: "ok",
      }));
      const { container, unmount } = render(
        <ComponentMatrix
          caption="c"
          columns={cols}
          rows={ROWS}
          cells={cols.flatMap((c) => ROWS.map((r) => ({ columnId: c.id, rowId: r.id, state: "ok" as const, label: "Ready" })))}
        />,
      );
      const table = container.querySelector("table")!;
      expect(table.getAttribute("style")).toContain(`--matrix-cols: ${n}`);
      expect(container.querySelectorAll("tbody tr")).toHaveLength(ROWS.length);
      expect(cellNodes(container)).toHaveLength(n * ROWS.length);
      unmount();
    }
  });

  it("loading 은 스켈레톤, unknown 은 UnknownState + 서버 사유", () => {
    const { container: a } = render(
      <ComponentMatrix caption="c" columns={[]} rows={ROWS} cells={[]} state="loading" />,
    );
    expect(a.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(a.querySelector("table")).toBeNull();

    const { container: b } = render(
      <ComponentMatrix
        caption="c"
        columns={[]}
        rows={ROWS}
        cells={[]}
        state="unknown"
        unknownReason="컨트롤 플레인 노드를 찾을 수 없습니다"
      />,
    );
    expect(b.textContent).toContain("컨트롤 플레인 노드를 찾을 수 없습니다");
    expect(b.querySelector("table")).toBeNull();
  });

  it("실시간 갱신 영역이라 aria-live 를 두지 않는다(과도한 낭독 방지)", () => {
    const { container } = renderMatrix();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });
});

describe("StatusCard.primarySub (components.md 19.1)", () => {
  it("primary 아래 한 줄을 그린다", () => {
    render(
      <StatusCard title="컨트롤 플레인" icon="server-cog" status="ok" primary="마스터 3/3" primarySub="필수 구성요소 15/15" />,
    );
    expect(screen.getByText("필수 구성요소 15/15")).toBeTruthy();
  });

  it("counts 와 동시에 오면 primarySub 만 그린다", () => {
    render(
      <StatusCard
        title="컨트롤 플레인"
        icon="server-cog"
        status="ok"
        primary="마스터 3/3"
        primarySub="필수 구성요소 15/15"
        counts={[{ status: "ok", count: 13 }]}
      />,
    );
    expect(screen.getByText("필수 구성요소 15/15")).toBeTruthy();
    expect(screen.queryByText(/정상 13/)).toBeNull();
  });
});

describe("SummaryStripItem.sub / subHref (components.md 19.2)", () => {
  it("값과 부제가 각각 다른 곳으로 가고 링크가 겹치지 않는다", () => {
    const { container } = render(
      <SummaryStrip overall={{ status: "ok", reason: [] }} updatedAt={T0}>
        <SummaryStripItem
          label="노드 Ready (워커)"
          value="6/6"
          href="/cluster/nodes"
          sub="컨트롤 플레인 3/3"
          subHref="/cluster/nodes#control-plane"
        />
      </SummaryStrip>,
    );
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/cluster/nodes", "/cluster/nodes#control-plane"]);
    expect(links.some((a) => a.querySelector("a"))).toBe(false); // 링크 중첩 없음
    expect(screen.getByText("컨트롤 플레인 3/3")).toBeTruthy();
  });

  it("subHref 가 없으면 칸 전체가 한 링크", () => {
    const { container } = render(
      <SummaryStrip overall={{ status: "ok", reason: [] }} updatedAt={T0}>
        <SummaryStripItem label="노드" value="6/6" href="/cluster/nodes" sub="컨트롤 플레인 3/3" />
      </SummaryStrip>,
    );
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("ResourceName kind=\"cluster\" (components.md 19.3 / status.md 5.3)", () => {
  it("뒤 8자를 보존하고 앞 토막 끝에서 줄인다(= 가운데 말줄임, 앞 12자는 폭이 되는 한 남는다)", () => {
    const name = "prod-ap-northeast-2.platform.k8s.example.com";
    const { container } = render(<ResourceName name={name} kind="cluster" maxWidth={240} />);
    const visual = container.querySelector("[aria-hidden='true']")!;
    const parts = Array.from(visual.querySelectorAll("span")).map((s) => s.textContent ?? "");
    expect(parts).toHaveLength(2); // [앞 토막(줄어듦)][뒤 8자(고정)] — 세 토막이면 말줄임이 두 번 나온다
    expect(parts[0]).toBe(name.slice(0, -8));
    expect(parts[0].startsWith(name.slice(0, 12))).toBe(true); // 앞 12자가 앞 토막 맨 앞에 있다
    expect(parts[1]).toBe(name.slice(-8));
    expect(parts.join("")).toBe(name);
    // 스크린리더는 전체 이름을 한 번 읽는다
    expect(container.querySelector(".sr-only")!.textContent).toBe(name);
  });

  it("sans 글자 + 복사 버튼 없음", () => {
    const { container } = render(<ResourceName name="prod.k8s.example.com" kind="cluster" />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[class*='rnSans']")).not.toBeNull();
  });

  it("파드·노드 기본 규칙(끝 16자 보존, 복사 버튼)은 그대로다", () => {
    const { container } = render(<ResourceName name="api-server-deployment-7f9c8d6b5-x2kq9" kind="pod" />);
    const visual = container.querySelector("[aria-hidden='true']")!;
    const parts = Array.from(visual.querySelectorAll("span")).map((s) => s.textContent ?? "");
    expect(parts[parts.length - 1]).toBe("api-server-deployment-7f9c8d6b5-x2kq9".slice(-16));
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("keepTail 로 보존 글자 수를 조정할 수 있다", () => {
    const { container } = render(<ResourceName name="abcdefghijklmnopqrstuvwxyz" kind="cluster" keepTail={2} />);
    const visual = container.querySelector("[aria-hidden='true']")!;
    const parts = Array.from(visual.querySelectorAll("span")).map((s) => s.textContent ?? "");
    expect(parts[0]).toBe("abcdefghijklmnopqrstuvwx");
    expect(parts[parts.length - 1]).toBe("yz");
  });
});

describe("ComponentMatrix — 열 머리 툴팁 조립 (components.md 18.1)", () => {
  it("`노드 <상태>[ (<reason>)] · 구성요소 <최악>[ <칸 수>]` 로 만든다", () => {
    expect(columnTooltip({ status: "warn", reason: "NotReady 4분" }, { cellWorst: "unknown", worstCount: 5 })).toBe(
      "노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5",
    );
    expect(columnTooltip({ status: "ok" }, { cellWorst: "crit", worstCount: 1 })).toBe(
      "노드 정상 · 구성요소 장애 1",
    );
  });

  it("reason 이 없으면 괄호를 통째로 뺀다", () => {
    expect(columnTooltip({ status: "warn" }, { cellWorst: "warn", worstCount: 2 })).toBe(
      "노드 주의 · 구성요소 주의 2",
    );
  });

  it("구성요소가 전부 정상이면 칸 수를 붙이지 않는다(정상은 조용하게)", () => {
    expect(columnTooltip({ status: "ok" }, { cellWorst: "ok", worstCount: 5 })).toBe("노드 정상 · 구성요소 정상");
  });

  it("열 머리 아이콘의 스크린리더 문구가 그 문장이다 (아이콘은 ok 면 없다)", () => {
    const { container } = renderMatrix();
    const heads = Array.from(container.querySelectorAll("thead th"));
    // c 열: 노드 warn(NotReady 4분) + 셀 5칸 모두 보고 없음(= 알 수 없음)
    expect(heads[2].querySelector("svg")!.getAttribute("aria-label")).toBe(
      "노드 주의 (NotReady 4분) · 구성요소 알 수 없음 5",
    );
    // a 열: 노드 ok + 장애 셀 1칸
    expect(heads[1].querySelector("svg")!.getAttribute("aria-label")).toBe("노드 정상 · 구성요소 장애 1");
    // d 열: 노드 ok + 셀 전부 정상 → 아이콘 없음
    expect(heads[3].querySelector("svg")).toBeNull();
  });
});

describe("아이콘·라벨 (kops-support)", () => {
  it("server-cog 아이콘이 있다", () => {
    const { container } = render(<Icon name="server-cog" size={12} title="컨트롤 플레인" />);
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe("컨트롤 플레인");
  });

  it("비용 카테고리에서 eks 가 사라지고 controlPlane 이 마지막이다", () => {
    expect(COST_CATEGORY_ORDER).toEqual(["ec2", "ebs", "lb", "ipv4", "controlPlane"]);
    expect(COST_CATEGORY_LABEL.controlPlane).toBe("컨트롤 플레인");
    expect(Object.keys(COST_CATEGORY_LABEL)).not.toContain("eks");
    expect(CONTROL_PLANE_KIND_ORDER).toEqual([
      "master_ec2",
      "etcd_ebs",
      "master_root_ebs",
      "api_lb",
      "master_ipv4",
    ]);
    expect(CONTROL_PLANE_KIND_LABEL.api_lb).toBe("API 서버 LB");
  });
});

describe("미리보기", () => {
  it("ControlPlanePreview 전체가 오류 없이 렌더된다", () => {
    const { container } = render(<ControlPlanePreview />);
    expect(container.querySelectorAll("table").length).toBeGreaterThanOrEqual(4);
  });
});
