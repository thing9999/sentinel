// @vitest-environment jsdom
/** k8s-snapshot 프론트 통합 후 publisher 요청 4건 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnknownState } from "../feedback/EmptyState";
import { PageHeader } from "../shell/PageHeader";
import { TableLinkCell } from "../table/TableLinkCell";

afterEach(() => cleanup());

describe("PageHeader status.srPrefix", () => {
  it("srPrefix 를 배지에 전달", () => {
    render(<PageHeader title="x.yaml" status={{ status: "crit", label: "커밋 금지", srPrefix: "파일 상태: " }} />);
    expect(screen.getByText("파일 상태:", { exact: false }).textContent).toBe("파일 상태: ");
    expect(screen.queryByText("상태:", { exact: true })).toBeNull();
  });

  it("없으면 기존 `상태: ` (하위 호환)", () => {
    render(<PageHeader title="x" status={{ status: "warn" }} />);
    expect(screen.getByText("상태:", { exact: false }).textContent).toBe("상태: ");
  });
});

describe("PageHeader tabs / flushBottom", () => {
  it("tabs 슬롯은 header 안에 그리고 아래 여백 0 클래스", () => {
    const { container } = render(<PageHeader title="스냅샷" tabs={<nav aria-label="스냅샷 종류">탭</nav>} />);
    const header = container.querySelector("header")!;
    expect(header.contains(screen.getByRole("navigation", { name: "스냅샷 종류" }))).toBe(true);
    expect(header.className).toMatch(/pageHeaderFlush/);
  });

  it("flushBottom 만 줘도 여백 0, 둘 다 없으면 기존", () => {
    const { container, rerender } = render(<PageHeader title="a" flushBottom />);
    expect(container.querySelector("header")!.className).toMatch(/pageHeaderFlush/);
    rerender(<PageHeader title="a" />);
    expect(container.querySelector("header")!.className).not.toMatch(/pageHeaderFlush/);
  });
});

describe("UnknownState icon", () => {
  it("기본 circle-help, icon 으로 hourglass", () => {
    const { container, rerender } = render(<UnknownState reason="클러스터 동기화 중" size="lg" />);
    const first = container.querySelector("svg")!.outerHTML;
    rerender(<UnknownState reason="클러스터 동기화 중" size="lg" icon="hourglass" />);
    expect(container.querySelector("svg")!.outerHTML).not.toBe(first);
    expect(screen.getByText("알 수 없음 (클러스터 동기화 중)")).toBeTruthy();
  });

  it("headingLevel 전달", () => {
    render(<UnknownState title="알 수 없음" headingLevel={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "알 수 없음" })).toBeTruthy();
  });
});

describe("TableLinkCell", () => {
  it("링크 + 클릭·Enter 가 행으로 번지지 않음", () => {
    const onRow = vi.fn();
    render(
      <table>
        <tbody>
          <tr onClick={onRow} onKeyDown={onRow}>
            <td>
              <TableLinkCell href="/snapshots/k8s/a?view=drift">차이 3건</TableLinkCell>
            </td>
          </tr>
        </tbody>
      </table>,
    );
    const a = screen.getByRole("link", { name: "차이 3건" });
    expect(a.getAttribute("href")).toBe("/snapshots/k8s/a?view=drift");
    expect(a.className).toMatch(/cellLink/);
    fireEvent.keyDown(a, { key: "Enter" });
    fireEvent.click(a);
    expect(onRow).not.toHaveBeenCalled();
  });

  it("stopRowClick=false 면 전파", () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <TableLinkCell href="/x" stopRowClick={false}>
          x
        </TableLinkCell>
      </div>,
    );
    fireEvent.click(screen.getByRole("link"));
    expect(onRow).toHaveBeenCalled();
  });
});
