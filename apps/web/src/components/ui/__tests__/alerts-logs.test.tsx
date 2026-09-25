// @vitest-environment jsdom
/**
 * alerts·logs·settings 퍼블리싱 확인 (components.md 20·21절, alerts.md, logs.md, settings.md, status.md 12·13절).
 *
 * 가장 중요한 것 셋:
 *  1. **가림 표식(gutter)이 sticky 라서 가로 스크롤해도 사라지지 않는가** (AC-LOG07)
 *  2. **상단바에 아무것도 추가되지 않았는가 / 알림 배지가 사이드바에만 있는가** (AC-ALERT36)
 *  3. **닫을 수 없어야 하는 문구에 닫기·접기가 없는가** (AC-LOG08, settings.md 3.5)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AlertsLogsPreview } from "../__preview__/AlertsLogsPreview";
import { AlertGapRow } from "../alerts/AlertGapRow";
import { AlertItem } from "../alerts/AlertItem";
import {
  ALERT_SEVERITY,
  DISPATCH_SPEC,
  alertChips,
  gapAriaLabel,
  isDispatchState,
  trimChips,
  type DispatchState,
} from "../alerts/alertModel";
import { ComponentMatrix, type ComponentMatrixCell } from "../cluster/ComponentMatrix";
import { Button } from "../controls/Button";
import { SearchInput } from "../controls/SearchInput";
import { SecretInput } from "../controls/SecretInput";
import { SegmentedControl } from "../controls/SegmentedControl";
import { Switch } from "../controls/Switch";
import { Dialog } from "../overlay/Dialog";
import { CollapsibleNotice } from "../feedback/CollapsibleNotice";
import { EmptyState } from "../feedback/EmptyState";
import { Icon } from "../icons";
import { MaskedValue } from "../k8s/DiffValue";
import { LogLineList } from "../logs/LogLineList";
import { RedactionNotice } from "../logs/RedactionNotice";
import {
  LOG_REDACTION_NOTICE,
  anchorScrollTop,
  logAnchorTimeText,
  logLineSrText,
  logListAnchor,
  logVisibleRange,
  lineOffsets,
  maskedCount,
  noticeText,
  splitByMatches,
  type LogLine,
} from "../logs/logLineModel";
import { Chip } from "../status/Chip";
import { DEFAULT_NAV_FOOTER_ITEMS, DEFAULT_NAV_ITEMS, SideNav } from "../shell/SideNav";
import { DataTable } from "../table/DataTable";
import { ResourceName } from "../table/ResourceName";

afterEach(() => cleanup());

/** 저장소 파일 읽기 — vitest 실행 위치(apps/web 또는 저장소 루트)에 상관없이 찾는다(snapshot-3d.test 와 같은 방식) */
function repoText(rel: string): string {
  const hit = [join(process.cwd(), rel), join(process.cwd(), "..", "..", rel)].find((p) => existsSync(p));
  if (!hit) throw new Error(`${rel} 을 찾지 못했다 (cwd: ${process.cwd()})`);
  return readFileSync(hit, "utf8");
}

/** 마크다운에서 `### <번호> …` 절 하나(다음 `###` 전까지) */
function mdSection(md: string, num: string): string {
  const sec = md.split(/^### /m).find((s) => s.startsWith(`${num} `));
  if (!sec) throw new Error(`### ${num} 절을 찾지 못했다`);
  return sec;
}

/** 계약 `docs/api/alerts.md` 1.4 의 `type DispatchState = 'a' | 'b' …;` 값 목록 */
function contractDispatchStates(): string[] {
  const code = mdSection(repoText("docs/api/alerts.md"), "1.4").replace(/\/\/.*$/gm, "");
  const m = /type DispatchState\s*=([\s\S]*?);/.exec(code);
  if (!m) throw new Error("계약 1.4 에서 `type DispatchState` 를 찾지 못했다");
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

/**
 * 디자인 `docs/design/status.md` 12.5 표(발송 칩 **정본**)의 행.
 * 한 행에 상태가 둘이면(`skipped_severity` / `skipped_unknown_off`) 문구도 ` / `로 둘이다.
 * 문구 칸의 `` `14:02:12` `` 같은 예시 값은 빼고, 상태 하나에 문구가 둘이면(`보내는 중 / 재시도 대기`) 앞 문구가 칩 문구다.
 */
function designDispatchRows(): Map<string, { tone: string; icon: string; label: string }> {
  const out = new Map<string, { tone: string; icon: string; label: string }>();
  for (const line of mdSection(repoText("docs/design/status.md"), "12.5").split("\n")) {
    if (!/^\|\s*`/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const states = [...cells[0].matchAll(/`([a-z_]+)`/g)].map((x) => x[1]);
    const labels = cells[3].split(" / ").map((s) => s.replace(/`[^`]*`/g, "").trim());
    states.forEach((state, i) =>
      out.set(state, {
        tone: cells[1].replace(/[*`]/g, "").trim(),
        icon: cells[2].replace(/`/g, "").trim(),
        label: labels.length === states.length ? labels[i] : labels[0],
      }),
    );
  }
  return out;
}

/** jsdom 은 레이아웃이 없다 — 스크롤 상자 치수를 흉내 낸다(scrollTop 은 0 ~ 최대값으로 잘린다) */
function fakeScrollBox(el: HTMLElement, dims: { scrollHeight: number; clientHeight: number }) {
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => dims.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => dims.clientHeight });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(v, dims.scrollHeight - dims.clientHeight));
    },
  });
}

/** 사용자 스크롤 1회(휠·`End`·스크롤바) = 위치를 바꾸고 scroll 이벤트 한 번 */
function userScroll(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

const T0 = "2026-09-25T05:02:05.000Z";
/** 오늘 14:02:05 — 시각 표기는 "오늘인가"에 따라 갈린다(status.md 6절) */
const TODAY_1402 = (() => {
  const d = new Date();
  d.setHours(14, 2, 5, 0);
  return d.toISOString();
})();

// ───────────────────────── 사이드바 (shell.md 3.1·3.2·3.3, components.md 21.1) ─────────────────────────
describe("SideNav 12항목 · 3단 flex (shell.md 3.3)", () => {
  it("기본 항목 11개 + 하단 고정 `설정` 1개 = 12개, `알림`·`로그` 자리와 아이콘", () => {
    expect(DEFAULT_NAV_ITEMS).toHaveLength(11);
    expect(DEFAULT_NAV_FOOTER_ITEMS).toHaveLength(1);
    expect(DEFAULT_NAV_ITEMS[1]).toMatchObject({ href: "/alerts", label: "알림", icon: "inbox" });
    // `로그`는 `이벤트` 다음, `데이터베이스` 앞 (클러스터 그룹)
    const hrefs = DEFAULT_NAV_ITEMS.map((i) => i.href);
    expect(hrefs.indexOf("/logs")).toBe(hrefs.indexOf("/cluster/events") + 1);
    expect(hrefs.indexOf("/cluster/db")).toBe(hrefs.indexOf("/logs") + 1);
    expect(DEFAULT_NAV_ITEMS.find((i) => i.href === "/logs")).toMatchObject({ group: "클러스터", icon: "scroll-text" });
    expect(DEFAULT_NAV_FOOTER_ITEMS[0]).toMatchObject({ href: "/settings", label: "설정", icon: "settings" });
    // 상태 점·배지는 기본값에 없다(서버 값을 호출 측이 넣는다)
    for (const it of [...DEFAULT_NAV_ITEMS, ...DEFAULT_NAV_FOOTER_ITEMS]) {
      expect(it.status).toBeUndefined();
      expect(it.count).toBeUndefined();
    }
  });

  it("`설정`·`메뉴 접기`는 스크롤 목록 **밖**(하단 고정)에 있다", () => {
    const { container } = render(
      <SideNav
        items={DEFAULT_NAV_ITEMS}
        footerItems={DEFAULT_NAV_FOOTER_ITEMS}
        currentPath="/"
        collapsed={false}
        onToggleCollapsed={() => undefined}
      />,
    );
    const nav = container.querySelector("nav")!;
    // 1단: 목록 영역 / 3단: 하단 고정 영역 — 두 덩이다
    expect(nav.children).toHaveLength(2);
    const [scrollArea, footer] = Array.from(nav.children);
    expect(within(scrollArea as HTMLElement).queryByRole("link", { name: "설정" })).toBeNull();
    expect(within(footer as HTMLElement).getByRole("link", { name: "설정" })).toBeTruthy();
    expect(within(footer as HTMLElement).getByRole("button", { name: "메뉴 접기" })).toBeTruthy();
  });

  it("`status` 없이 `count`만 · countTone · countLabel (components.md 21.1)", () => {
    const { container } = render(
      <SideNav
        currentPath="/"
        collapsed={false}
        items={[
          { href: "/alerts", label: "알림", icon: "inbox", count: 3, countTone: "crit", countLabel: "안 읽음 3건" },
          { href: "/snapshots", label: "스냅샷", icon: "archive", status: "crit", statusLabel: "커밋 금지", count: 2 },
        ]}
      />,
    );
    const links = container.querySelectorAll("a");
    // 알림: 상태 아이콘 없이 숫자만, 스크린리더 문구는 countLabel
    expect(links[0].textContent).toContain(", 안 읽음 3건");
    expect(links[0].querySelector('[data-testid="nav-count"]')!.textContent).toBe("3");
    expect(links[0].querySelectorAll("svg")).toHaveLength(1); // 메뉴 아이콘만(상태 아이콘 없음)
    // 스냅샷: 종전 문구 그대로 (회귀 방지)
    expect(links[1].textContent).toContain(", 커밋 금지 2개");
  });

  it("접힘(64px)에서 배지: **상태 점이 없는 항목만** 그린다 (shell.md 3.2)", () => {
    const { container } = render(
      <SideNav
        currentPath="/"
        collapsed
        items={[
          { href: "/alerts", label: "알림", icon: "inbox", count: 120, countLabel: "안 읽음 120건" },
          { href: "/snapshots", label: "스냅샷", icon: "archive", status: "crit", count: 2 },
        ]}
      />,
    );
    const links = container.querySelectorAll("a");
    const alertBadge = links[0].querySelector('[data-testid="nav-count-collapsed"]');
    expect(alertBadge!.textContent).toBe("99+");
    // 스냅샷은 점이 이미 "문제 있음"을 말한다 → 접힘 배지 없음
    expect(links[1].querySelector('[data-testid="nav-count-collapsed"]')).toBeNull();
  });
});

// ───────────────────────── AlertItem (components.md 20.1) ─────────────────────────
describe("AlertItem (alerts.md 4절)", () => {
  const base = {
    areaLabel: "파드",
    reason: "CrashLoopBackOff · 최근 1시간 재시작 6회",
    occurredAt: T0,
  } as const;

  it("접근 이름 `안 읽음, 장애, 파드, 사유, 시각` · 안 읽음 점은 별도 버튼(이동하지 않는다)", () => {
    const onMarkRead = vi.fn();
    render(
      <ul>
        <AlertItem
          {...base}
          occurredAt={TODAY_1402}
          severity="critical"
          read={false}
          onMarkRead={onMarkRead}
          href="/cluster/pods"
        />
      </ul>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-label")).toBe(
      "안 읽음, 장애, 파드, CrashLoopBackOff · 최근 1시간 재시작 6회, 14:02:05",
    );
    const dot = screen.getByRole("button", { name: "이 알림을 확인으로 표시" });
    fireEvent.click(dot);
    expect(onMarkRead).toHaveBeenCalledTimes(1);
    // 링크 안에 버튼이 들어가지 않는다(중첩 금지, alerts.md 9절)
    expect(link.querySelector("button")).toBeNull();

    // 오늘이 아닌 알림은 눈에 보이는 문구와 **같은 규칙**으로 읽힌다(`9월 18일 14:02`, status.md 6절)
    cleanup();
    render(
      <ul>
        <AlertItem {...base} occurredAt="2025-09-18T05:02:05.000Z" severity="warning" read href="/x" />
      </ul>,
    );
    expect(screen.getByRole("link").getAttribute("aria-label")).toMatch(/\d+월 \d+일 \d{2}:\d{2}$/);
  });

  it("심각도 문구: 확인 불가 ≠ 알 수 없음, 해제 ≠ 정상 (status.md 12.1)", () => {
    expect(ALERT_SEVERITY.unknown).toMatchObject({ status: "unknown", label: "확인 불가" });
    expect(ALERT_SEVERITY.resolved).toMatchObject({ status: "ok", label: "해제" });
    render(
      <ul>
        <AlertItem {...base} severity="resolved" read resolvedAt={T0} durationMs={17 * 60_000} />
      </ul>,
    );
    expect(screen.getByText("해제")).toBeTruthy();
    expect(screen.getByText(/지속 17분/)).toBeTruthy();
  });

  it("`로그` 링크는 **항상** 그린다(파드가 살아 있는지 추측하지 않는다) + `삭제됨` 칩", () => {
    render(
      <ul>
        <AlertItem {...base} severity="critical" read href="/x" logHref="/logs?pod=api" targetGone />
      </ul>,
    );
    expect(screen.getByRole("link", { name: /로그/ }).getAttribute("href")).toBe("/logs?pod=api");
    expect(screen.getByText("삭제됨")).toBeTruthy();
  });

  it("확장 영역은 `expanded` 일 때만 그린다(조작 버튼 없음)", () => {
    const { rerender } = render(
      <ul>
        <AlertItem {...base} severity="warning" read expandable expanded={false}>
          <p>발송 기록</p>
        </AlertItem>
      </ul>,
    );
    expect(screen.queryByText("발송 기록")).toBeNull();
    rerender(
      <ul>
        <AlertItem {...base} severity="warning" read expandable expanded>
          <p>발송 기록</p>
        </AlertItem>
      </ul>,
    );
    expect(screen.getByText("발송 기록")).toBeTruthy();
  });

  it("발송 상태 칩 문구·tone (status.md 12.5) — `failed` 만 상태색, `skipped_mock` 만 mock", () => {
    expect(DISPATCH_SPEC.failed).toMatchObject({ label: "발송 실패", tone: "crit", icon: "octagon-x" });
    expect(DISPATCH_SPEC.skipped_mock).toMatchObject({ label: "실제로 보내지 않음", tone: "mock" });
    for (const [state, spec] of Object.entries(DISPATCH_SPEC)) {
      if (state === "failed" || state === "skipped_mock") continue;
      expect(spec.tone).toBe("neutral");
    }
    render(
      <ul>
        <AlertItem {...base} severity="critical" read dispatch={[{ state: "sent", at: T0 }]} />
      </ul>,
    );
    expect(screen.getByText("보냄 14:02:05")).toBeTruthy();
  });

  it("2026-09-25 추가 2종: `제외(발생 안 보냄)`·`발송 멈춤(연속 실패)` — neutral, 문구 전체 (status.md 12.5)", () => {
    expect(DISPATCH_SPEC.skipped_no_pair).toEqual({ label: "제외(발생 안 보냄)", icon: "ban", tone: "neutral" });
    expect(DISPATCH_SPEC.skipped_circuit_open).toEqual({ label: "발송 멈춤(연속 실패)", icon: "pause", tone: "neutral" });
    // `failed`만 상태색이라는 규칙이 새 2종에도 성립한다(위 검사와 같은 뜻을 이름으로 한 번 더 고정)
    const colored = Object.entries(DISPATCH_SPEC)
      .filter(([, s]) => s.tone !== "neutral")
      .map(([k, s]) => `${k}:${s.tone}`);
    expect(colored.sort()).toEqual(["failed:crit", "skipped_mock:mock"]);

    const { container } = render(
      <ul>
        <AlertItem {...base} severity="resolved" read dispatch={[{ state: "skipped_no_pair" }]} />
        <AlertItem {...base} severity="warning" read dispatch={[{ state: "skipped_circuit_open" }]} />
      </ul>,
    );
    // 칩 문구는 말줄임하지 않는다 — DOM 에 문구 전체가 있다(폭에 따른 배치는 CSS·브라우저 실측)
    expect(screen.getByText("제외(발생 안 보냄)")).toBeTruthy();
    expect(screen.getByText("발송 멈춤(연속 실패)")).toBeTruthy();
    // neutral 칩이다 — 빨간색을 쓰지 않는다(AC-ALERT19)
    expect(container.querySelector('[class*="chip-crit"]')).toBeNull();
  });

  it("모르는 발송 상태는 칩을 그리지 않고 터지지도 않는다 (비슷한 칩으로 바꿔 그리지 않는다)", () => {
    expect(isDispatchState("skipped_no_pair")).toBe(true);
    expect(isDispatchState("skipped_someday")).toBe(false);
    expect(isDispatchState("toString")).toBe(false); // `in` 과 달리 상속 키에 속지 않는다
    render(
      <ul>
        <AlertItem
          {...base}
          severity="warning"
          read
          dispatch={[{ state: "skipped_someday" as DispatchState }, { state: "sent" }]}
        />
      </ul>,
    );
    expect(screen.getByText("보냄")).toBeTruthy();
    expect(screen.queryByText(/제외/)).toBeNull();
  });
});

// ───────────────────────── 발송 칩 12종 = 계약 = 디자인 정본 ─────────────────────────
describe("발송 칩 12종 — 계약 `docs/api/alerts.md` 1.4 · 디자인 `status.md` 12.5 와 같은가", () => {
  it("계약 1.4 의 `DispatchState` 가 `DISPATCH_SPEC` 에 **빠짐없이** 있다 (상태가 늘면 여기서 먼저 깨진다)", () => {
    const contract = contractDispatchStates();
    expect(contract.length).toBeGreaterThanOrEqual(12);
    const spec = Object.keys(DISPATCH_SPEC);
    // 계약에 있는데 칩 문구가 없는 상태 — 이게 생기면 status.md 12.5 에 문구를 먼저 정하고 DISPATCH_SPEC 에 넣는다
    expect(contract.filter((s) => !spec.includes(s)), "계약에만 있는 상태").toEqual([]);
    // 칩 표에만 있고 계약에서 사라진 상태
    expect(spec.filter((s) => !contract.includes(s)), "DISPATCH_SPEC 에만 있는 상태").toEqual([]);
  });

  it("`DISPATCH_SPEC` 이 정본 `status.md` 12.5 표를 그대로 옮겼다 (문구·아이콘·tone)", () => {
    const design = designDispatchRows();
    expect([...design.keys()].sort()).toEqual(Object.keys(DISPATCH_SPEC).sort());
    for (const [state, spec] of Object.entries(DISPATCH_SPEC)) {
      expect({ state, ...spec }).toEqual({ state, ...design.get(state) });
    }
  });
});

describe("보조 칩 (alerts.md 4.2)", () => {
  it("순서 고정: 반복 → 불안정 → 영향 영역 → 테스트 발송 → MOCK", () => {
    const chips = alertChips({ repeatCount: 4, flapping: true, suppressedAreas: 5, kind: "test", dataSource: "mock" });
    expect(chips.map((c) => c.id)).toEqual(["repeat", "flapping", "areas", "test", "mock"]);
  });

  it("넘치면 **오른쪽부터** 버리되 MOCK 표시는 마지막까지 남는다 (status.md 3.1)", () => {
    const chips = alertChips({ repeatCount: 4, flapping: true, suppressedAreas: 5, kind: "test", dataSource: "mock" });
    const { shown, hidden } = trimChips(chips, 4);
    expect(shown.map((c) => c.id)).toEqual(["repeat", "flapping", "areas", "mock"]);
    expect(hidden.map((c) => c.id)).toEqual(["test"]);
    // 칩이 아주 많아도 MOCK 은 남는다
    const { shown: s2 } = trimChips(chips, 1);
    expect(s2.map((c) => c.id)).toContain("mock");
  });
});

// ───────────────────────── AlertGapRow (components.md 20.2, status.md 12.4) ─────────────────────────
describe("AlertGapRow — 레이아웃·필터 사정으로 사라지지 않는 줄", () => {
  it("`<li>` + 전체 문구 aria-label", () => {
    const from = new Date(2026, 8, 25, 9, 12).toISOString();
    const to = new Date(2026, 8, 25, 9, 31).toISOString();
    render(
      <ul>
        <AlertGapRow from={from} to={to} minutes={19} />
      </ul>,
    );
    const li = screen.getByTestId("alert-gap-row");
    expect(li.tagName).toBe("LI");
    expect(li.getAttribute("aria-label")).toBe(
      "정지 구간 9시 12분부터 9시 31분까지 19분, 이 동안의 변화는 알림으로 잡히지 않았습니다",
    );
    expect(li.textContent).toContain("정지 구간 09:12 ~ 09:31 (19분)");
  });

  it("`to` 가 없으면 `지금`까지 · 기록이 없으면 다른 문구 (AC-ALERT10)", () => {
    expect(gapAriaLabel("2026-09-25T00:12:00.000Z", null, 19)).toContain("지금까지");
    render(
      <ul>
        <AlertGapRow from={T0} minutes={41} unknownPrevious />
      </ul>,
    );
    expect(screen.getByTestId("alert-gap-row").textContent).toContain(
      "이전 실행 기록 없음 — 이전에 무엇이 있었는지 알 수 없습니다",
    );
  });
});

// ───────────────────────── SecretInput (components.md 20.3) ─────────────────────────
describe("SecretInput — 원문을 다시 보여주지 않는다", () => {
  it("설정됨 + idle: 입력칸 없음, 가림 힌트·글자 수·저장 시각, `보기` 토글 없음 (AC-ALERT20)", () => {
    const { container } = render(
      <SecretInput
        label="웹훅 주소"
        configured
        hint="…****7f3a"
        length={119}
        updatedAt="2026-09-25T05:02:00.000Z"
        onEdit={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(container.querySelector("input")).toBeNull();
    expect(screen.getByText("…****7f3a")).toBeTruthy();
    expect(screen.getByText(/119자 · 9월 25일 14:02 저장/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "바꾸기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "지우기" })).toBeTruthy();
    // 눈 아이콘 토글(`보기`·`표시`)을 만들지 않는다
    for (const name of [/보기/, /표시/, /show/i]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("입력은 type=text + autocomplete=off + spellcheck=false (비밀번호 관리자에 잡히지 않게)", () => {
    render(<SecretInput label="웹훅 주소" configured={false} mode="editing" value="" onChange={() => undefined} />);
    const input = screen.getByTestId("secret-input") as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
  });

  it("오류 문구에 입력값 원문을 되비추지 않는다 (AC-ALERT21)", () => {
    const secret = "https://discord.com/api/webhooks/1234567890/SECRETTOKEN";
    const { container } = render(
      <SecretInput
        label="웹훅 주소"
        configured={false}
        mode="editing"
        value={secret}
        onChange={() => undefined}
        error="디스코드 웹훅 주소가 아닙니다 (https://discord.com/api/webhooks/… 형식)"
      />,
    );
    const texts = Array.from(container.querySelectorAll("span, p")).map((e) => e.textContent ?? "");
    expect(texts.some((t) => t.includes("SECRETTOKEN"))).toBe(false);
  });

  it("환경 변수로 잠기면 입력·버튼이 없고 이유가 보인다 (settings.md 5절)", () => {
    render(
      <SecretInput
        label="웹훅 주소"
        configured
        hint="…****7f3a"
        lockedByEnv="ALERTS_DISCORD_WEBHOOK_URL"
        onEdit={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "바꾸기" })).toBeNull();
    expect(screen.getByText(".env로 고정됨")).toBeTruthy();
    expect(screen.getByText(/ALERTS_DISCORD_WEBHOOK_URL 환경 변수가 설정돼 있어/)).toBeTruthy();
  });
});

// ───────────────────────── CollapsibleNotice · 닫을 수 없는 안내 ─────────────────────────
describe("CollapsibleNotice (components.md 20.4)", () => {
  it("접으면 한 줄 요약이 남고 **닫기(x)는 없다**", () => {
    render(
      <CollapsibleNotice
        summary="직접 조회 · 지난 로그·검색 없음"
        icon="info"
        label="직접 조회 한계 안내"
        lines={["줄1", "줄2", "줄3", "줄4"]}
      />,
    );
    expect(screen.getByText("줄4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "직접 조회 한계 안내 접기" }));
    expect(screen.queryByText("줄4")).toBeNull();
    // 접어도 요약은 남는다
    expect(screen.getByText("직접 조회 · 지난 로그·검색 없음")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /닫기$/ })).toBeNull();
  });

  it("상태를 저장하지 않는다(persistKey 없음) — localStorage 를 건드리지 않는다", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    render(<CollapsibleNotice summary="요약" lines={["줄1"]} />);
    fireEvent.click(screen.getByRole("button", { name: "안내 접기" }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("가림 경고는 닫을 수도 접을 수도 없다 (AC-LOG08)", () => {
  it("RedactionNotice: 고정 문구 + 버튼 0개", () => {
    const { container } = render(<RedactionNotice />);
    expect(screen.getByText(LOG_REDACTION_NOTICE)).toBeTruthy();
    expect(LOG_REDACTION_NOTICE).toContain("완벽하지 않습니다");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

// ───────────────────────── LogLineList (components.md 20.5) ─────────────────────────
const LINES: LogLine[] = [
  { id: "a", kind: "line", at: T0, segments: [{ t: "text", v: "INFO hello" }] },
  {
    id: "b",
    kind: "line",
    at: T0,
    segments: [
      { t: "text", v: "INFO postgres://" },
      { t: "masked", v: "ap****(12자)", rules: ["접속 문자열 자격 증명"], confidence: "high" },
      { t: "text", v: "@db:5432/app" },
    ],
  },
  { id: "c", kind: "dropped", droppedLines: 1204, segments: [] },
  { id: "d", kind: "redactFailed", segments: [] },
];

describe("LogLineList (logs.md 7절, status.md 13절)", () => {
  it("영역은 `role=log` + `aria-live=off` — 새 줄을 낭독하지 않는다", () => {
    const { container } = render(<LogLineList lines={LINES} caption="prod / api 로그" />);
    const log = container.querySelector('[role="log"]')!;
    expect(log.getAttribute("aria-live")).toBe("off");
    expect(log.getAttribute("aria-label")).toBe("prod / api 로그");
  });

  it("가림 표식 gutter 는 줄마다 있고 **버튼**이다(키보드로 닿는다)", () => {
    const onClick = vi.fn();
    render(<LogLineList lines={LINES} caption="c" onRedactionClick={onClick} />);
    const btn = screen.getByRole("button", { name: "가려진 값 1개, 규칙 보기" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].id).toBe("b");
    // 두 번째 인자는 팝오버를 붙일 앵커(=sticky gutter)
    expect((onClick.mock.calls[0][1] as HTMLElement).dataset.gutter).toBe("true");
  });

  it("가린 조각은 inline MaskedValue 로 그리고 **원문이 DOM 에 없다**", () => {
    const { container } = render(<LogLineList lines={LINES} caption="c" />);
    const masked = container.querySelector('[data-masked="true"]')!;
    expect(masked.getAttribute("data-variant")).toBe("inline");
    expect(masked.textContent).toContain("ap****(12자)");
    expect(container.textContent).not.toContain("password");
  });

  it("특별한 줄: 생략·가림 실패 문구 (전부 서버 값 우선)", () => {
    render(<LogLineList lines={LINES} caption="c" />);
    expect(screen.getByText("초당 상한으로 1,204줄 생략됨")).toBeTruthy();
    expect(screen.getByText("[가림 처리 실패 — 줄 생략]")).toBeTruthy();
  });

  it("2만 줄이어도 화면 몫만 그린다(가상 스크롤)", () => {
    const many: LogLine[] = Array.from({ length: 20000 }, (_, i) => ({
      id: `m${i}`,
      kind: "line" as const,
      segments: [{ t: "text" as const, v: `line ${i}` }],
    }));
    const { container } = render(<LogLineList lines={many} caption="c" height={200} />);
    const rows = container.querySelectorAll("[data-log-row]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(80);
  });

  it("브라우저 저장소에 아무것도 쓰지 않는다 (명세 3.3.4)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    render(<LogLineList lines={LINES} caption="c" follow pendingCount={3} onJumpToBottom={() => undefined} />);
    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    getItem.mockRestore();
  });

  it("`새 줄 N개` 버튼만 polite 로 알린다", () => {
    const onJump = vi.fn();
    const { container } = render(
      <LogLineList lines={LINES} caption="c" pendingCount={12} onJumpToBottom={onJump} />,
    );
    const live = container.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain("새 줄 12개");
    fireEvent.click(screen.getByRole("button", { name: /새 줄 12개/ }));
    expect(onJump).toHaveBeenCalled();
  });

  it("빈 결과는 오류가 아니다 — 한 줄 문구", () => {
    render(<LogLineList lines={[]} state="empty" caption="c" emptyText="가져온 구간에 로그가 없습니다." />);
    expect(screen.getByText("가져온 구간에 로그가 없습니다.")).toBeTruthy();
  });
});

// ───────────────────────── 자동 스크롤 · 맨 아래 닿음 (logs.md 7.4, components.md 20.5) ─────────────────────────
describe("LogLineList 스크롤 — 자동 스크롤만 바꾸고, 맨 아래에 닿으면 알리기만 한다 (logs.md 7.4)", () => {
  const box = () => ({ scrollHeight: 1000, clientHeight: 200 }); // 바닥 = scrollTop 800
  const logEl = (c: HTMLElement) => c.querySelector('[role="log"]') as HTMLElement;

  it("자동 스크롤이 꺼진 채 사용자가 끝에서 4px 안에 닿으면 `onReachBottom` 1회 — 바닥에서 더 스크롤해도 다시 부르지 않는다", () => {
    const onReach = vi.fn();
    const { container } = render(<LogLineList lines={LINES} caption="c" onReachBottom={onReach} />);
    const el = logEl(container);
    fakeScrollBox(el, box());
    userScroll(el, 500); // 끝에서 300px
    userScroll(el, 795); // 끝에서 5px — 아직 아니다
    expect(onReach).not.toHaveBeenCalled();
    userScroll(el, 796); // 끝에서 4px
    expect(onReach).toHaveBeenCalledTimes(1);
    userScroll(el, 800);
    userScroll(el, 798);
    expect(onReach).toHaveBeenCalledTimes(1);
  });

  it("새 줄이 붙어 내용만 길어질 때는 부르지 않는다 → 그 뒤 사용자가 다시 바닥에 닿으면 또 부른다", () => {
    const onReach = vi.fn();
    const dims = box();
    const { container, rerender } = render(<LogLineList lines={LINES} caption="c" onReachBottom={onReach} />);
    const el = logEl(container);
    fakeScrollBox(el, dims);
    userScroll(el, 800);
    expect(onReach).toHaveBeenCalledTimes(1);
    // 새 줄 2개(40px)가 붙는다 — scrollTop 은 그대로라 scroll 이벤트가 없다
    const more: LogLine[] = [...LINES, { id: "e", kind: "line", segments: [{ t: "text", v: "x" }] }, { id: "f", kind: "line", segments: [{ t: "text", v: "y" }] }];
    dims.scrollHeight = 1040;
    rerender(<LogLineList lines={more} caption="c" onReachBottom={onReach} />);
    expect(onReach).toHaveBeenCalledTimes(1);
    // `End` 한 번 = 이벤트 한 번으로 새 바닥에 닿는다
    userScroll(el, 840);
    expect(onReach).toHaveBeenCalledTimes(2);
    // 바닥을 벗어났다 돌아와도 부른다(호출 측이 N=0 으로 맞추는 것은 멱등이다)
    userScroll(el, 600);
    userScroll(el, 840);
    expect(onReach).toHaveBeenCalledTimes(3);
  });

  it("자동 스크롤 중(`follow`)에는 부르지 않는다 · 위로 20px 넘게 벗어나면 `onFollowBreak` 1회", () => {
    const onBreak = vi.fn();
    const onReach = vi.fn();
    const props = { caption: "c", follow: true, onFollowBreak: onBreak, onReachBottom: onReach };
    const { container, rerender } = render(<LogLineList lines={LINES} {...props} />);
    const el = logEl(container);
    fakeScrollBox(el, box());
    // 새 줄 → 컴포넌트가 바닥으로 옮긴다(코드 스크롤) → 그 이벤트는 사용자 스크롤이 아니다
    rerender(<LogLineList lines={[...LINES]} {...props} />);
    expect(el.scrollTop).toBe(800);
    fireEvent.scroll(el);
    userScroll(el, 790); // 끝에서 10px(1줄 안) — 아직 자동 스크롤 유지
    expect(onBreak).not.toHaveBeenCalled();
    userScroll(el, 700);
    userScroll(el, 600);
    expect(onBreak).toHaveBeenCalledTimes(1);
    expect(onReach).not.toHaveBeenCalled();
  });

  it("`새 줄 N개`로 옮긴 스크롤(코드 스크롤)에는 `onReachBottom` 을 부르지 않는다", () => {
    const onJump = vi.fn();
    const onReach = vi.fn();
    const { container } = render(
      <LogLineList lines={LINES} caption="c" pendingCount={5} onJumpToBottom={onJump} onReachBottom={onReach} />,
    );
    const el = logEl(container);
    fakeScrollBox(el, box());
    userScroll(el, 300);
    fireEvent.click(screen.getByRole("button", { name: /새 줄 5개/ }));
    expect(el.scrollTop).toBe(800);
    fireEvent.scroll(el); // 버튼이 옮긴 스크롤의 이벤트
    expect(onJump).toHaveBeenCalledTimes(1);
    expect(onReach).not.toHaveBeenCalled();
  });

  it("이미 바닥이면 코드 스크롤 표시를 남기지 않는다 — 조용한 파드에서 다음 사용자 스크롤을 삼키지 않는다", () => {
    // 회귀: 바닥에서 새 배치가 와도 위치가 안 바뀌면 scroll 이벤트가 없다. 그때 "코드 스크롤" 표시를 세워 두면
    // 사용자의 다음 스크롤 1회(PageUp 한 번)를 코드 스크롤로 잘못 알아 자동 스크롤이 풀리지 않았다.
    const onBreak = vi.fn();
    const props = { caption: "c", follow: true, onFollowBreak: onBreak };
    const { container, rerender } = render(<LogLineList lines={LINES} {...props} />);
    const el = logEl(container);
    fakeScrollBox(el, box());
    el.scrollTop = 800; // 이미 바닥
    rerender(<LogLineList lines={[...LINES]} {...props} />); // 새 배치(길이 그대로) — 옮길 것이 없다
    userScroll(el, 300); // PageUp 한 번
    expect(onBreak).toHaveBeenCalledTimes(1);
  });
});

describe("로그 모델 순수 함수", () => {
  it("offsets · visibleRange", () => {
    const offsets = lineOffsets([20, 20, 20, 20, 20]);
    expect(offsets).toEqual([0, 20, 40, 60, 80, 100]);
    expect(logVisibleRange(offsets, 0, 40, 0)).toEqual([0, 3]);
    expect(logVisibleRange(offsets, 40, 40, 0)).toEqual([2, 5]);
  });

  it("findMatches 는 정규식이 아니라 글자 그대로(대소문자 무시)", () => {
    expect(splitByMatches("ERROR error Error", "error").filter((p) => p.hit)).toHaveLength(3);
    expect(splitByMatches("a.b", ".").filter((p) => p.hit)).toHaveLength(1);
  });

  it("maskedCount · noticeText 기본 문구", () => {
    expect(maskedCount(LINES[1])).toBe(1);
    expect(noticeText({ id: "x", kind: "binary", bytes: 4096, segments: [] })).toBe("[바이너리 데이터 4,096바이트]");
    expect(noticeText({ id: "x", kind: "ringTop", segments: [{ t: "text", v: "서버 문구" }] })).toBe("서버 문구");
  });

  it("줄 낭독 문구에 가림 개수가 들어간다", () => {
    expect(logLineSrText(LINES[1])).toContain("가려진 값 1개");
  });
});

// ───────────────────────── 기존 컴포넌트 확장 (components.md 21절) ─────────────────────────
describe("Chip 확장 (21.2)", () => {
  it("`onClick` 이 있으면 button, 없으면 span", () => {
    const { container, rerender } = render(<Chip label="가림 3" icon="eye-off" />);
    expect(container.querySelector("button")).toBeNull();
    rerender(<Chip label="가림 3" icon="eye-off" onClick={() => undefined} ariaLabel="가려진 값 3개, 규칙 보기" />);
    expect(screen.getByRole("button", { name: "가려진 값 3개, 규칙 보기" })).toBeTruthy();
  });

  it("`mock` tone 은 mode.mock 색 클래스를 쓴다(새 토큰 아님)", () => {
    const { container } = render(<Chip label="실제로 보내지 않음" tone="mock" icon="flask-conical" />);
    expect(container.firstElementChild!.className).toContain("chip-mock");
  });
});

describe("SegmentedControl 확장 (21.3)", () => {
  it("비활성 칸을 목록에서 빼지 않고, 네이티브 disabled 를 쓰지 않는다(포커스 가능)", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="로그 출처"
        value="direct"
        onChange={onChange}
        options={[
          { value: "stack", label: "로그 스택", disabled: true, disabledReason: "외부 로그 스택이 설정돼 있지 않습니다 (LOG_BACKEND_URL)" },
          { value: "direct", label: "직접 조회" },
        ]}
      />,
    );
    const stack = screen.getByRole("radio", { name: /로그 스택/ }) as HTMLInputElement;
    expect(stack.disabled).toBe(false); // 포커스를 받을 수 있어야 사유를 읽는다
    expect(stack.getAttribute("aria-disabled")).toBe("true");
    // 사유는 툴팁뿐 아니라 접근 이름에도 들어간다
    expect(screen.getByRole("radio", { name: /LOG_BACKEND_URL/ })).toBeTruthy();
    fireEvent.click(stack);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("`disabledReason` 만 줘도 칸이 막힌다(정의된 동작) · 누를 수 있는 칸의 사유는 `tooltip` (21.3 주의)", () => {
    // 실제 결함: 로그 컨테이너 칩의 CrashLoopBackOff 를 disabledReason 으로 넘겨 그 컨테이너를 고를 수 없었다
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="컨테이너"
        value="api"
        onChange={onChange}
        options={[
          { value: "api", label: "api" },
          { value: "worker", label: "worker", tooltip: "CrashLoopBackOff" },
          { value: "sidecar", label: "sidecar", disabledReason: "사유만 줬다" },
        ]}
      />,
    );
    const worker = screen.getByRole("radio", { name: /worker/ });
    expect(worker.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(worker);
    expect(onChange).toHaveBeenCalledWith("worker");

    const sidecar = screen.getByRole("radio", { name: /sidecar/ });
    expect(sidecar.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(sidecar);
    expect(onChange).not.toHaveBeenCalledWith("sidecar");
  });
});

describe("AlertItem 좁은 폭 ④행 (alerts.md 8절) — CSS 규칙 회귀", () => {
  // 폭에 따른 줄바꿈은 jsdom 에서 잴 수 없다(실측은 보고서의 브라우저 확인). 여기서는 규칙이 사라지지 않았는지만 본다
  const narrow = () => {
    const css = repoText("apps/web/src/components/ui/alerts/alerts.module.css").replace(/\r\n/g, "\n");
    const start = css.indexOf("@media (max-width: 639px)");
    return css.slice(start, css.indexOf("\n}\n", start));
  };

  it("대상 칸 기준 128px — 그 아래로 줄 자리면 발송 칩·`로그` 묶음이 다음 줄로(오른쪽 정렬)", () => {
    const css = narrow();
    expect(css).toMatch(/\.row3\s*\{[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/\.targets\s*\{[^}]*flex: 1 1 128px;/);
    expect(css).toMatch(/\.row3Right\s*\{[^}]*margin-left: auto;/);
  });

  it("발송 칩은 줄어들지 않는다(말줄임 금지) — 묶음 안 항목 flex-shrink 0", () => {
    expect(narrow()).toMatch(/\.row3Right > \*\s*\{\s*flex-shrink: 0;/);
  });
});

describe("MaskedValue inline (21.4)", () => {
  it("inline 은 아이콘이 없고 box 는 있다. 둘 다 복사 버튼이 없다", () => {
    const inline = render(<MaskedValue text="ap****(12자)" variant="inline" />);
    expect(inline.container.querySelectorAll("svg")).toHaveLength(0);
    expect(inline.container.querySelectorAll("button")).toHaveLength(0);
    cleanup();
    const box = render(<MaskedValue text="ap****(12자)" />);
    expect(box.container.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(box.container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("ComponentMatrix logHref (21.5)", () => {
  const rows = [{ id: "r1", label: "kube-apiserver" }];
  const columns = [{ id: "c1", name: "i-0a1b", status: "ok" as const }];
  const cell = (over: Partial<ComponentMatrixCell>): ComponentMatrixCell => ({
    columnId: "c1",
    rowId: "r1",
    state: "ok",
    label: "Ready",
    ...over,
  });

  it("`missing` 에는 그리지 않고 `notReporting` 에는 그린다", () => {
    const view = render(
      <ComponentMatrix columns={columns} rows={rows} cells={[cell({ state: "missing", logHref: "/logs" })]} caption="c" />,
    );
    expect(view.queryByTestId("matrix-log-link")).toBeNull();
    cleanup();
    render(
      <ComponentMatrix
        columns={columns}
        rows={rows}
        cells={[cell({ state: "notReporting", label: "노드 미보고", logHref: "/logs?pod=x" })]}
        caption="c"
      />,
    );
    const link = screen.getByTestId("matrix-log-link");
    expect(link.getAttribute("aria-label")).toBe("kube-apiserver i-0a1b 로그 보기");
    expect(link.getAttribute("href")).toBe("/logs?pod=x");
  });

  it("셀 링크 안에 로그 링크를 넣지 않는다(중첩 금지)", () => {
    render(
      <ComponentMatrix
        columns={columns}
        rows={rows}
        cells={[cell({ href: "/cluster/pods/x", logHref: "/logs?pod=x" })]}
        caption="c"
      />,
    );
    const logLink = screen.getByTestId("matrix-log-link");
    expect(logLink.closest("a")).toBe(logLink);
  });
});

describe("EmptyState footer (21.6)", () => {
  it("설명과 **다른 무게**의 한 줄", () => {
    const { container } = render(
      <EmptyState
        icon="inbox"
        size="lg"
        title="최근 24시간 동안 알림이 없습니다"
        description="상태가 바뀌면 여기에 쌓입니다."
        footer="대시보드는 14:02:10까지 정상적으로 지켜보고 있습니다 · 감시 대상 8개"
      />,
    );
    const footer = screen.getByText(/감시 대상 8개/);
    expect(footer.className).toContain("emptyFooter");
    expect(container.textContent).toContain("상태가 바뀌면 여기에 쌓입니다.");
  });
});

describe("아이콘 (components.md 13절 2026-09-25 추가)", () => {
  it("inbox · send · repeat · activity · arrow-down-to-line", () => {
    const names = ["inbox", "send", "repeat", "activity", "arrow-down-to-line"] as const;
    const { container } = render(
      <>
        {names.map((n) => (
          <Icon key={n} name={n} size={16} />
        ))}
      </>,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(names.length);
  });
});

// ───────────────────────── 그 시각으로 열기 — 앵커 (logs.md 7.6, components.md 20.5) ─────────────────────────
const seqLines = (n: number, prefix = "x", text = (i: number) => (i % 10 === 0 ? `ERROR boom ${i}` : `INFO ok ${i}`)): LogLine[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, kind: "line" as const, segments: [{ t: "text" as const, v: text(i) }] }));

describe("앵커 모델 — 7.6 표 그대로", () => {
  it("state → 구분 줄 자리·문구 (found·before 는 위, after 는 아래, none·lineId 없음은 없음)", () => {
    expect(logListAnchor({ state: "found", lineId: "q:412" }, "14:02:05", "t")).toEqual({
      lineId: "q:412",
      placement: "above",
      label: "그 시각 14:02:05",
      title: "t",
    });
    expect(logListAnchor({ state: "before_result", lineId: "q:1" }, "14:02:05")).toMatchObject({
      placement: "above",
      label: "그 시각 14:02:05의 줄은 이보다 앞이라 가져오지 못했습니다",
    });
    expect(logListAnchor({ state: "after_result", lineId: "q:9" }, "14:02:05")).toMatchObject({
      placement: "below",
      label: "그 시각 14:02:05 이후 출력 없음",
    });
    expect(logListAnchor({ state: "none", lineId: null }, "14:02:05")).toBeUndefined();
    expect(logListAnchor({ state: "found", lineId: null }, "14:02:05")).toBeUndefined();
    expect(logListAnchor(null, "14:02:05")).toBeUndefined();
  });

  it("시각은 초까지: 오늘 `14:02:05`, 다른 날 `9월 24일 14:02:05`, 다른 해 `2025년 …`", () => {
    const now = new Date(2026, 8, 25, 18, 0);
    expect(logAnchorTimeText(new Date(2026, 8, 25, 14, 2, 5), now)).toBe("14:02:05");
    expect(logAnchorTimeText(new Date(2026, 8, 24, 14, 2, 5), now)).toBe("9월 24일 14:02:05");
    expect(logAnchorTimeText(new Date(2025, 8, 24, 14, 2, 5), now)).toBe("2025년 9월 24일 14:02:05");
  });

  it("첫 화면 1/3 지점(20px 단위 내림): 480px → 160px 위, 360px → 120px, 모자라면 0", () => {
    expect(anchorScrollTop(500, 480)).toBe(340);
    expect(anchorScrollTop(500, 360)).toBe(380);
    expect(anchorScrollTop(500, 465)).toBe(360); // 가로 스크롤바가 있으면 155 → 140
    expect(anchorScrollTop(60, 480)).toBe(0);
  });
});

describe("LogLineList anchor — 구분 줄 + 앵커 줄 + 첫 화면 스크롤 (컴포넌트가 직접)", () => {
  const logEl = (c: HTMLElement) => c.querySelector('[role="log"]') as HTMLElement;
  const lines60 = seqLines(60);

  it("found: 앵커 줄 **바로 위** 구분 줄, 앵커 줄 표시. 구분 줄은 로그 줄이 아니다", () => {
    const { container } = render(
      <LogLineList lines={lines60} caption="c" height={2000} anchor={{ lineId: "x25", placement: "above", label: "그 시각 14:02:05" }} />,
    );
    const sep = container.querySelector("[data-anchor-separator]") as HTMLElement;
    expect(sep.dataset.anchorSeparator).toBe("above");
    expect(sep.textContent).toBe("그 시각 14:02:05");
    expect(sep.hasAttribute("data-log-row")).toBe(false);
    expect((sep.nextElementSibling as HTMLElement).dataset.logRow).toBe("x25");
    expect(container.querySelectorAll('[data-anchor="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-anchor="true"]')!.className).toContain("rowAnchor");
    // 줄 수에 세지 않는다
    expect(container.querySelectorAll("[data-log-row]")).toHaveLength(60);
  });

  it("after_result: 마지막 줄 **바로 아래** · lineId 가 목록에 없으면 아무것도 그리지 않는다", () => {
    const { container, rerender } = render(
      <LogLineList lines={lines60} caption="c" height={2000} anchor={{ lineId: "x59", placement: "below", label: "이후 출력 없음" }} />,
    );
    const sep = container.querySelector("[data-anchor-separator]") as HTMLElement;
    expect((sep.previousElementSibling as HTMLElement).dataset.logRow).toBe("x59");
    rerender(<LogLineList lines={lines60} caption="c" height={2000} anchor={{ lineId: "nope", placement: "above", label: "x" }} />);
    expect(container.querySelector("[data-anchor-separator]")).toBeNull();
    expect(container.querySelector('[data-anchor="true"]')).toBeNull();
  });

  it("가상 스크롤: 구분 줄 20px 는 앵커가 화면 밖이어도 높이에 들어간다 (여백 div)", () => {
    // 높이 200 → 그리는 줄 0~22. 앵커 x40 은 밖이다
    const { container, rerender } = render(<LogLineList lines={lines60} caption="c" height={200} />);
    const spacers = () => [...logEl(container).querySelector('[class*="inner"]')!.children].filter((e) => !(e as HTMLElement).dataset.logRow);
    const bottomBefore = parseFloat((spacers().at(-1) as HTMLElement).style.height);
    rerender(<LogLineList lines={lines60} caption="c" height={200} anchor={{ lineId: "x40", placement: "above", label: "a" }} />);
    expect(container.querySelector("[data-anchor-separator]")).toBeNull(); // 그려지지는 않고
    const bottomAfter = parseFloat((spacers().at(-1) as HTMLElement).style.height);
    expect(bottomAfter - bottomBefore).toBe(20); // 높이에는 들어간다
  });

  it("첫 화면: 구분 줄 윗변을 1/3 지점에 → 같은 앵커로는 다시 끌고 가지 않는다 → lineId 가 바뀌면 다시", () => {
    const onReach = vi.fn();
    const { container, rerender } = render(<LogLineList lines={lines60} caption="c" onReachBottom={onReach} />);
    const el = logEl(container);
    fakeScrollBox(el, { scrollHeight: 60 * 20 + 20, clientHeight: 480 });
    const a25 = { lineId: "x25", placement: "above" as const, label: "a" };
    rerender(<LogLineList lines={lines60} caption="c" onReachBottom={onReach} anchor={a25} />);
    expect(el.scrollTop).toBe(25 * 20 - 160); // 340: 앞 8줄이 보인다
    fireEvent.scroll(el); // 코드 스크롤 — 알림 없음
    userScroll(el, 0);
    rerender(<LogLineList lines={[...lines60]} caption="c" onReachBottom={onReach} anchor={{ ...a25 }} />);
    expect(el.scrollTop).toBe(0); // 같은 앵커 — 사용자가 옮긴 자리를 지킨다
    rerender(<LogLineList lines={lines60} caption="c" onReachBottom={onReach} anchor={{ ...a25, lineId: "x30" }} />);
    expect(el.scrollTop).toBe(30 * 20 - 160);
    expect(onReach).not.toHaveBeenCalled();
  });

  it("before_result(첫 줄) → 0 · after_result(마지막 줄 아래) → 맨 아래 · follow 와 함께면 스크롤은 follow 몫", () => {
    const { container, rerender } = render(<LogLineList lines={lines60} caption="c" />);
    const el = logEl(container);
    fakeScrollBox(el, { scrollHeight: 60 * 20 + 20, clientHeight: 480 });
    userScroll(el, 300);
    rerender(<LogLineList lines={lines60} caption="c" anchor={{ lineId: "x0", placement: "above", label: "b" }} />);
    expect(el.scrollTop).toBe(0);
    rerender(<LogLineList lines={lines60} caption="c" anchor={{ lineId: "x59", placement: "below", label: "a" }} />);
    expect(el.scrollTop).toBe(60 * 20 + 20 - 480); // 맨 아래
    userScroll(el, 100);
    rerender(<LogLineList lines={lines60} caption="c" follow anchor={{ lineId: "x10", placement: "above", label: "f" }} />);
    expect(el.scrollTop).toBe(60 * 20 + 20 - 480); // follow 가 바닥으로(앵커 1/3 이 아니다)
  });
});

describe("LogLineList currentMatch — 찾은 줄로 컴포넌트가 직접 스크롤 (anchor 와 같은 방식)", () => {
  const logEl = (c: HTMLElement) => c.querySelector('[role="log"]') as HTMLElement;
  const lines60 = seqLines(60);

  it("보이지 않으면 가운데로 · 같은 일치로는 다시 옮기지 않음 · `seq` 를 늘리면 다시 · 이미 보이면 그대로", () => {
    const props = { lines: lines60, caption: "c", findQuery: "ERROR" };
    const { container, rerender } = render(<LogLineList {...props} />);
    const el = logEl(container);
    fakeScrollBox(el, { scrollHeight: 1200, clientHeight: 200 });
    rerender(<LogLineList {...props} currentMatch={{ lineId: "x40", index: 0 }} />);
    expect(el.scrollTop).toBe(800 - 100 + 10); // 줄 가운데가 본문 가운데
    fireEvent.scroll(el);
    userScroll(el, 0);
    rerender(<LogLineList {...props} lines={[...lines60]} currentMatch={{ lineId: "x40", index: 0 }} />);
    expect(el.scrollTop).toBe(0); // 새 줄·같은 일치 — 끌고 가지 않는다
    rerender(<LogLineList {...props} currentMatch={{ lineId: "x40", index: 0, seq: 1 }} />);
    expect(el.scrollTop).toBe(710); // 같은 일치로 다시(Enter 를 또 누름)
    fireEvent.scroll(el);
    userScroll(el, 750); // 보이는 범위 750~950 안에 x40(800~820)
    rerender(<LogLineList {...props} currentMatch={{ lineId: "x40", index: 0, seq: 2 }} />);
    expect(el.scrollTop).toBe(750); // 이미 다 보이면 움직이지 않는다
  });

  it("자동 스크롤 중에 찾은 줄로 가면 바닥을 벗어나므로 `onFollowBreak` 1회 — 스크롤 이벤트로는 알리지 않는다", () => {
    const onBreak = vi.fn();
    const props = { lines: lines60, caption: "c", findQuery: "ERROR", follow: true, onFollowBreak: onBreak };
    const { container, rerender } = render(<LogLineList {...props} />);
    const el = logEl(container);
    fakeScrollBox(el, { scrollHeight: 1200, clientHeight: 200 });
    el.scrollTop = 1000;
    rerender(<LogLineList {...props} currentMatch={{ lineId: "x10", index: 0 }} />);
    expect(el.scrollTop).toBe(200 - 100 + 10);
    expect(onBreak).toHaveBeenCalledTimes(1);
    fireEvent.scroll(el); // 코드 스크롤 이벤트 — 두 번 알리지 않는다
    expect(onBreak).toHaveBeenCalledTimes(1);
  });

  it("앵커 구분 줄이 있으면 그 20px 를 빼고 줄 위치를 잡는다", () => {
    const props = { lines: lines60, caption: "c", findQuery: "ERROR", anchor: { lineId: "x20", placement: "above" as const, label: "a" } };
    const { container, rerender } = render(<LogLineList {...props} />);
    const el = logEl(container);
    fakeScrollBox(el, { scrollHeight: 1220, clientHeight: 200 });
    rerender(<LogLineList {...props} lines={lines60} currentMatch={{ lineId: "x50", index: 0 }} />);
    // x50 칸 = 50*20 + 20(x20 위 구분 줄) = 1020 → 가운데: 1020 - 100 + 10
    expect(el.scrollTop).toBe(930);
  });
});

describe("기존 컴포넌트 확장 (2026-09-25 통합 2차 요청)", () => {
  it("Chip `removeLabel` — `그 시각` 칩의 `x` 이름 (logs.md 7.6 ②)", () => {
    const onRemove = vi.fn();
    render(<Chip label="그 시각 14:02:05" icon="history" onRemove={onRemove} removeLabel="그 시각 표시 해제" title="2026-09-25 14:02:05 (KST)" />);
    fireEvent.click(screen.getByRole("button", { name: "그 시각 표시 해제" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    cleanup();
    render(<Chip label="prod" onRemove={() => undefined} />);
    expect(screen.getByRole("button", { name: "prod 제거" })).toBeTruthy(); // 종전 기본값
  });

  it("SecretInput `disabled` + 사유: 값은 보이고, 버튼은 aria-disabled(포커스 유지)·사유 연결·눌리지 않는다", () => {
    const onEdit = vi.fn();
    const onClear = vi.fn();
    render(
      <SecretInput
        label="웹훅 주소"
        configured
        hint="…****7f3a"
        length={119}
        onEdit={onEdit}
        onClear={onClear}
        disabled
        disabledReason="대시보드 DB에 연결할 수 없어 저장할 수 없습니다."
      />,
    );
    expect(screen.getByText("…****7f3a")).toBeTruthy();
    // 이름은 버튼 문구만(사유는 설명으로만 — 2026-09-25 Button 이중 낭독 고침 뒤 정확한 이름으로 좁혔다)
    for (const name of ["바꾸기", "지우기"]) {
      const b = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(b.disabled).toBe(false);
      expect(b.getAttribute("aria-disabled")).toBe("true");
      const desc = b.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
      expect(desc.join(" ")).toContain("대시보드 DB에 연결할 수 없어");
      fireEvent.click(b);
    }
    expect(onEdit).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    cleanup();
    render(<SecretInput label="웹훅 주소" configured={false} mode="editing" value="" onChange={() => undefined} onSave={() => undefined} disabled />);
    expect((screen.getByTestId("secret-input") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "저장" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("Switch `aria-describedby` — 설명 문장을 잇고, 비활성 사유가 있으면 뒤에 붙인다", () => {
    render(
      <>
        <Switch checked onChange={() => undefined} label="디스코드로 보내기" aria-describedby="d1" />
        <p id="d1">끄면 화면에는 계속 쌓입니다.</p>
      </>,
    );
    expect(screen.getByRole("switch").getAttribute("aria-describedby")).toBe("d1");
    cleanup();
    render(<Switch checked onChange={() => undefined} label="x" disabled disabledReason="사유" aria-describedby="d1" />);
    const ids = screen.getByRole("switch").getAttribute("aria-describedby")!.split(" ");
    expect(ids[0]).toBe("d1");
    expect(ids).toHaveLength(2);
  });

  it("Dialog `cancelDisabled`: 취소는 aria-disabled 이고 눌러도·Esc 로도 닫히지 않는다", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog open onClose={onClose} title="테스트" confirmLabel="보내기" confirmLoading cancelLabel="취소" cancelDisabled cancelDisabledReason="보내는 중" />,
    );
    const cancel = screen.getByRole("button", { name: /취소/ });
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(cancel);
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Dialog open onClose={onClose} title="테스트" confirmLabel="보내기" cancelLabel="취소" />);
    fireEvent.click(screen.getByRole("button", { name: /취소/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("SearchInput `onKeyDown`: 입력칸 키를 받는다(지금 입력값 포함) · Esc 지우기는 그대로", () => {
    const seen: string[] = [];
    const onKey = vi.fn((e: React.KeyboardEvent<HTMLInputElement>) => {
      seen.push(`${e.shiftKey ? "Shift+" : ""}${e.key}:${e.currentTarget.value}`);
    });
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} onKeyDown={onKey} shortcut={false} debounceMs={0} />);
    const input = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "java" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(seen).toEqual(["Shift+Enter:java"]); // 치자마자 누른 Enter 에서도 지금 입력값을 읽는다
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe(""); // 지우기는 컴포넌트가 먼저 한다
    expect(onKey).toHaveBeenCalledTimes(2);
  });
});

// ───────────────────────── 3차 뒤 정리 (logs README "3차 뒤 정리 목록" 1·2) ─────────────────────────
describe("Button 비활성 사유는 설명으로만 읽힌다 (이중 낭독 고침)", () => {
  it("이름 = 버튼 문구, 설명 = 사유. 사유 요소는 버튼 밖 `hidden`", () => {
    render(
      <Button disabled disabledReason="먼저 저장하세요">
        보내기
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "보내기" }); // 이름에 사유가 섞이지 않는다
    expect(btn.textContent).toBe("보내기");
    const ids = btn.getAttribute("aria-describedby")!.split(" ");
    const reasonEl = document.getElementById(ids[ids.length - 1])!;
    expect(reasonEl.textContent).toBe("먼저 저장하세요");
    expect(reasonEl.hidden).toBe(true); // 읽기 모드에서 떠돌이 문장으로 한 번 더 읽히지 않는다
    expect(btn.contains(reasonEl)).toBe(false);
  });

  it("호출 측 aria-describedby 는 앞에, 사유는 뒤에 · 사유가 없으면 설명도 없다", () => {
    const { rerender } = render(
      <Button disabled disabledReason="사유" aria-describedby="own">
        저장
      </Button>,
    );
    expect(screen.getByRole("button", { name: "저장" }).getAttribute("aria-describedby")!.split(" ")[0]).toBe("own");
    rerender(<Button disabled>저장</Button>);
    expect(screen.getByRole("button", { name: "저장" }).getAttribute("aria-describedby")).toBeNull();
  });
});

describe("특별한 줄은 보이는 영역 가운데 (logs.md 7.2) — 앵커 구분 줄과 같은 방식", () => {
  it("전체 폭 한 줄짜리(생략·링버퍼 위쪽·구간 없음)만 본문을 sticky 상자에 넣는다. 한 줄을 대신하는 줄·보통 줄은 그대로", () => {
    const lines: LogLine[] = [
      ...LINES,
      { id: "r", kind: "ringTop", segments: [] },
      { id: "g", kind: "gap", segments: [] },
      { id: "bin", kind: "binary", bytes: 4096, segments: [] },
    ];
    const { container } = render(<LogLineList lines={lines} caption="c" height={2000} />);
    const bodyOf = (id: string) => container.querySelector(`[data-log-row="${id}"] [data-notice-body]`);
    // 보통 줄(a·b), 한 줄을 대신하는 줄(가림 처리 실패 d·바이너리 bin)은 본문 흐름 그대로(logs.md 7.2)
    for (const id of ["a", "b", "d", "bin"]) expect(bodyOf(id)).toBeNull();
    for (const id of ["c", "r", "g"]) {
      const body = bodyOf(id)!;
      expect(body).toBeTruthy();
      // gutter 는 상자 밖(행의 첫 칸) — sticky gutter 구조는 그대로
      expect((body.previousElementSibling as HTMLElement).dataset.gutter).toBe("true");
      expect(body.closest("[data-log-row]")!.className).toContain("rowBand");
    }
    expect(bodyOf("c")!.textContent).toContain("초당 상한으로 1,204줄 생략됨");
    // 가림 처리 실패 줄은 배경(warn)만 행 전체 폭 — 문구는 본문 흐름
    expect(container.querySelector('[data-log-row="d"]')!.className).toContain("rowRedactFailed");
  });

  it("CSS: 상자는 gutter 오른쪽에 sticky, 폭 = 보이는 폭 − gutter. 구분 줄도 같은 보이는 폭 변수를 쓴다", () => {
    const css = repoText("apps/web/src/components/ui/logs/logs.module.css").replace(/\r\n/g, "\n");
    const block = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
    expect(block(".noticeBody")).toContain("position: sticky;");
    expect(block(".noticeBody")).toContain("left: var(--log-gutter-w);");
    expect(block(".noticeBody")).toContain("width: calc(var(--log-view-w, 100%) - var(--log-gutter-w));");
    expect(block(".anchorSticky")).toContain("width: var(--log-view-w, 100%);");
    expect(block(".gutter")).toContain("width: var(--log-gutter-w);");
    // 구분 줄·특별한 줄 상자의 부모에 overflow 를 주면 sticky 가 풀린다
    expect(block(".anchorSeparator")).not.toMatch(/overflow/);
  });

  it("보이는 폭을 재면 스크롤 상자에 `--log-view-w` 를 넣는다(관측기가 있을 때)", () => {
    const original = globalThis.ResizeObserver;
    class FakeRO {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
      }
      observe() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver;
    const widthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700);
    try {
      const { container } = render(<LogLineList lines={LINES} caption="c" />);
      const el = container.querySelector('[role="log"]') as HTMLElement;
      expect(el.style.getPropertyValue("--log-view-w")).toBe("700px");
    } finally {
      widthSpy.mockRestore();
      globalThis.ResizeObserver = original;
    }
  });
});

describe("ResourceName `logHref` — 파드 표의 로그 (components.md 21.10)", () => {
  it("복사 버튼 **다음**에 아이콘 링크 · 주소는 받은 그대로 · 이름 `<표시 이름> 로그 보기`", () => {
    const href = "/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9&follow=1";
    const { container } = render(<ResourceName name="prod/api-7f9c8d6b5-x2kq9" kind="pod" logHref={href} />);
    const link = screen.getByRole("link", { name: "prod/api-7f9c8d6b5-x2kq9 로그 보기" });
    expect(link.getAttribute("href")).toBe(href); // 가공하지 않는다
    const actions = [...container.querySelectorAll('[class*="rnAction"]')];
    expect(actions).toHaveLength(2);
    expect(actions[0].querySelector("button")).toBeTruthy(); // 복사
    expect(actions[1].contains(link)).toBe(true); // 그다음 로그
  });

  it("`null`·없음이면 그리지 않고 자리도 비우지 않는다 · 노드는 표시 이름(짧은 이름)으로 읽는다", () => {
    const { container, rerender } = render(<ResourceName name="prod/db-0" kind="pod" logHref={null} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelectorAll('[class*="rnAction"]')).toHaveLength(1); // 복사만
    rerender(<ResourceName name="prod/db-0" kind="pod" />);
    expect(container.querySelectorAll('[class*="rnLog"]')).toHaveLength(0);
    rerender(<ResourceName name="ip-10-0-1-23.ap-northeast-2.compute.internal" kind="node" logHref="/logs?x=1" />);
    expect(screen.getByRole("link", { name: "ip-10-0-1-23 로그 보기" })).toBeTruthy();
  });

  it("표 행 안에서 눌러도 행 클릭(파드 상세)으로 번지지 않는다", () => {
    const onRowClick = vi.fn();
    const rows = [{ id: "a", name: "prod/api-1", logHref: "/logs?pod=api-1" }];
    render(
      <DataTable
        caption="파드"
        columns={[{ id: "name", header: "이름", render: (r: (typeof rows)[number]) => <ResourceName name={r.name} logHref={r.logHref} /> }]}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByRole("link", { name: "prod/api-1 로그 보기" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("CSS: 복사·로그가 한 규칙 — 평소 투명(자리 차지), 이름·행 hover·포커스(행 focus-visible 포함)에 보임, 터치는 항상", () => {
    const css = repoText("apps/web/src/components/ui/table/table.module.css").replace(/\r\n/g, "\n");
    const base = css.slice(css.indexOf(".rnAction {"), css.indexOf("}", css.indexOf(".rnAction {")));
    expect(base).toContain("opacity: 0;");
    expect(base).not.toMatch(/visibility|display: none/);
    for (const sel of [".rn:hover .rnAction", ".rn:focus-within .rnAction", ":global(tr:hover) .rnAction", ":global(tr:focus-within) .rnAction", ":global(tr:focus-visible) .rnAction"]) {
      expect(css).toContain(sel);
    }
    expect(css).toMatch(/@media \(hover: none\) \{\s*\.rnAction \{\s*opacity: 1;/);
  });
});

// ───────────────────────── 미리보기 전체 (AC-ALERT36) ─────────────────────────
describe("미리보기: 상단바에 아무것도 추가되지 않았다 (AC-ALERT36)", () => {
  it("알림 진입점은 사이드바 메뉴뿐이고 벨 아이콘·알림 패널이 없다", () => {
    render(<AlertsLogsPreview />);
    // 미리보기 안에 종 아이콘 버튼·알림 패널이 없다
    expect(screen.queryByRole("button", { name: /알림 열기|알림 보기|notification/i })).toBeNull();
    // 알림 항목은 목록으로 그린다(표 아님, status.md 12.3)
    expect(screen.getByTestId("alert-list").tagName).toBe("UL");
    // 정지 구간 줄은 목록 안에 있다
    expect(screen.getAllByTestId("alert-gap-row").length).toBe(2);
  });
});
