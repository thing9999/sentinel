// @vitest-environment jsdom
/** aws-snapshot-manager 프론트 통합 후 publisher 요청 4건 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ButtonLink } from "../controls/ButtonLink";
import { IconButton } from "../controls/IconButton";
import { Card } from "../layout/Card";
import { Chip } from "../status/Chip";

afterEach(() => cleanup());

describe("IconButton disabledReason", () => {
  it("aria-disabled + 사유 연결, 포커스 가능, 클릭 무시", () => {
    const onClick = vi.fn();
    render(<IconButton icon="trash-2" label="휴지통으로 이동" disabled disabledReason="스냅샷 폴더가 읽기 전용" onClick={onClick} />);
    const b = screen.getByRole("button", { name: "휴지통으로 이동" });
    expect(b.hasAttribute("disabled")).toBe(false);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    const desc = document.getElementById(b.getAttribute("aria-describedby")!)!;
    expect(desc.textContent).toBe("스냅샷 폴더가 읽기 전용");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("호출 측이 직접 넘긴 aria-disabled 는 그대로 유지(하위 호환)", () => {
    render(<IconButton icon="tag" label="라벨·메모 편집" aria-disabled />);
    expect(screen.getByRole("button").getAttribute("aria-disabled")).toBe("true");
  });

  it("사유 없이 disabled 만 주면 기존대로 네이티브 disabled", () => {
    render(<IconButton icon="x" label="닫기" disabled />);
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });
});

describe("ButtonLink", () => {
  it("버튼 모양 <a> + 개수 suffix", () => {
    render(
      <ButtonLink href="/snapshots/trash" icon="trash-2" suffix="3" suffixLabel="3개">
        휴지통
      </ButtonLink>,
    );
    const a = screen.getByRole("link");
    expect(a.getAttribute("href")).toBe("/snapshots/trash");
    expect(a.className).toMatch(/btn-ghost/);
    expect(a.textContent).toBe("휴지통33개");
    expect(a.querySelector("svg")).not.toBeNull();
  });
});

describe("Chip tooltip", () => {
  it("툴팁이 있으면 포커스로 열린다", () => {
    vi.useFakeTimers();
    const { container } = render(<Chip label="보기 전용" icon="lock" tooltip="이 파일은 import 대응표라 편집하지 않습니다." />);
    const anchor = container.firstElementChild as HTMLElement;
    expect(anchor.getAttribute("tabindex")).toBe("0");
    fireEvent.focus(anchor);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
    expect(screen.getByRole("tooltip").textContent).toContain("import 대응표");
  });

  it("툴팁이 없으면 기존 마크업 그대로", () => {
    const { container } = render(<Chip label="strict" />);
    expect(container.firstElementChild!.tagName).toBe("SPAN");
    expect(container.firstElementChild!.getAttribute("tabindex")).toBeNull();
  });
});

describe("Card editing", () => {
  it("편집 모드 클래스·data 속성", () => {
    const { container } = render(<Card editing>x</Card>);
    const el = container.firstElementChild!;
    expect(el.className).toMatch(/cardEditing/);
    expect(el.getAttribute("data-editing")).toBe("true");
  });
});
