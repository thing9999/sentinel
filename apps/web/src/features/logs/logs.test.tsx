// @vitest-environment jsdom
/**
 * logs 통합 3차 — **되돌아오기 쉬운 결정**만 고정한다.
 * 링크는 서버 `logHref` 그대로 · 링버퍼 멈춤(읽던 줄을 지우지 않는다)과 그 문구의 숫자는 상수에서 ·
 * 연결이 닫히면 이유별 멈춤 종류 · 요청 셀렉터(direct 는 파드 하나, stack 은 워크로드·여러 파드) · 앵커 시각 표기.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LogLine } from "@/components/ui";

import { withContainer } from "./href";
import { LogLink } from "./LogLink";
import { buildSelector, haltTone, HaltNotice, LogViewer } from "./LogViewer";
import { PodLogsSection } from "./PodLogsSection";
import { appendRing, closingHaltKind, RING_MAX_LINES, ringLimitText } from "./useLogStream";

const api = vi.hoisted(() => ({ handler: (() => ({})) as (path: string) => unknown }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, apiFetch: vi.fn(async (path: string) => api.handler(path)) };
});

afterEach(() => {
  cleanup();
  api.handler = () => ({});
});

const mk = (n: number, from = 0): LogLine[] =>
  Array.from({ length: n }, (_, i) => ({ id: `l${from + i}`, kind: "line" as const, segments: [{ t: "text" as const, v: `line ${from + i}` }] }));

describe("링버퍼 (Q13, AC-LOG51)", () => {
  it("맨 아래에서 자동 스크롤 중이면 위에서부터 버린다(따라가기는 계속)", () => {
    const r = appendRing(mk(8), mk(5, 8), false, 10);
    expect(r.halted).toBe(false);
    expect(r.trimmed).toBe(true);
    expect(r.lines.map((l) => l.id)).toEqual(["l3", "l4", "l5", "l6", "l7", "l8", "l9", "l10", "l11", "l12"]);
  });

  it("위로 올려 읽는 중(hold)이면 **읽던 줄을 지우지 않고** 상한까지만 받고 멈춘다", () => {
    const r = appendRing(mk(8), mk(5, 8), true, 10);
    expect(r.halted).toBe(true);
    expect(r.trimmed).toBe(false);
    expect(r.lines[0].id).toBe("l0");
    expect(r.lines).toHaveLength(10);
  });

  it("상한 안이면 hold 여부와 관계없이 그대로 붙는다", () => {
    expect(appendRing(mk(3), mk(2, 3), true, 10)).toMatchObject({ halted: false, trimmed: false });
  });

  it("멈춤 안내의 `2만 줄`은 링버퍼 상수에서 만든다(문구와 상수가 갈라지지 않는다)", () => {
    expect(RING_MAX_LINES).toBe(20_000);
    expect(ringLimitText()).toBe("2만");
    expect(ringLimitText(15_000)).toBe("1.5만");
    expect(ringLimitText(5_000)).toBe("5,000");
    render(
      <HaltNotice
        halt={{ kind: "ring", code: null, text: "읽던 줄이 지워지지 않게 따라가기를 멈췄습니다.", resumable: true, tag: "k" }}
        onResume={() => {}}
      />,
    );
    expect(screen.getByText(`화면에 담을 수 있는 ${ringLimitText(RING_MAX_LINES)} 줄이 찼습니다.`, { exact: false })).toBeTruthy();
    // 닫을 수 없다 · `다시 시작`이 있다 · 사용자가 보고 있는 동안 생기므로 live
    expect(screen.queryByRole("button", { name: /닫기/ })).toBeNull();
    expect(screen.getByRole("button", { name: "다시 시작" })).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});

describe("연결이 닫히면 — 멈춤 종류와 톤 (디자인 7.4)", () => {
  it("30분·유휴는 계획된 멈춤(info), 서버 종료·출처 오류는 예상 밖(warn)", () => {
    expect(closingHaltKind("max_duration")).toBe("max");
    expect(closingHaltKind("idle")).toBe("idle");
    expect(closingHaltKind("source_error")).toBe("closed");
    expect(closingHaltKind("shutdown")).toBe("closed");
    expect(haltTone("idle")).toBe("info");
    expect(haltTone("max")).toBe("info");
    expect(haltTone("ring")).toBe("info");
    expect(haltTone("closed")).toBe("warn");
    expect(haltTone("disconnect")).toBe("warn");
    expect(haltTone("failed")).toBe("warn");
  });

  it("안내 문구는 서버 `text` 그대로이고 닫기 버튼이 없다", () => {
    render(
      <HaltNotice
        halt={{ kind: "idle", code: "LOG_STREAM_IDLE_PAUSED", text: "이 화면이 20초 동안 보이지 않아 따라가기를 멈췄습니다.", resumable: true, tag: "k" }}
        onResume={() => {}}
      />,
    );
    expect(screen.getByText("이 화면이 20초 동안 보이지 않아 따라가기를 멈췄습니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /닫기/ })).toBeNull();
  });
});

describe("요청 셀렉터 (계약 1.4)", () => {
  const wl = { key: "Deployment/prod/api", kind: "Deployment" as const, namespace: "prod", name: "api" };

  it("direct 는 언제나 파드 하나 — 워크로드·여러 파드를 보내지 않는다(보내면 400)", () => {
    expect(buildSelector({ namespace: "prod", pod: "api-1", workload: wl }, false, "api", false)).toEqual({
      namespace: "prod",
      pod: "api-1",
      container: "api",
      previous: false,
    });
    expect(buildSelector({ namespace: "prod", pod: null, workload: wl }, false, "api", false)).toBeNull();
  });

  it("stack: 파드를 따로 고르지 않은 워크로드는 서버가 푼다 / 여러 파드는 `pods`", () => {
    expect(buildSelector({ namespace: "prod", pod: null, workload: wl }, true, null, false)).toEqual({
      namespace: "prod",
      workload: { kind: "Deployment", name: "api" },
    });
    expect(buildSelector({ namespace: "prod", pod: null, pods: ["a", "b"] }, true, null, false)).toEqual({
      namespace: "prod",
      pods: ["a", "b"],
    });
  });
});

describe("파드 상세 `로그 화면에서 열기` — 서버 링크 + `container` 하나만 (PM 결정 4)", () => {
  it("container 만 붙이고 서버 파라미터(follow)는 그대로 둔다", () => {
    expect(withContainer("/logs?namespace=prod&pod=api-1&follow=1", "istio-proxy")).toBe(
      "/logs?namespace=prod&pod=api-1&follow=1&container=istio-proxy",
    );
    expect(withContainer("/logs?namespace=prod&pod=api-1&follow=1", null)).toBe("/logs?namespace=prod&pod=api-1&follow=1");
  });
});

describe("진입점 링크는 서버 `logHref` 그대로 (계약 11.4, AC-LOG50)", () => {
  it("파라미터를 덧붙이지 않고, `null`이면 그리지 않는다", () => {
    const href = "/logs?namespace=prod&pod=api-1&at=2026-09-25T14%3A02%3A05.000Z";
    const { container, rerender } = render(<LogLink href={href} label="api-1 로그 보기" />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe(href);
    rerender(<LogLink href={null} label="x" />);
    expect(container.querySelector("a")).toBeNull();
  });

  it("파드 상세 `로그` 섹션: 서버 링크가 없으면 섹션째 없고, 있으면 `로그 화면에서 열기`가 그 주소 그대로다", () => {
    const { container, rerender } = render(<PodLogsSection namespace="prod" name="api-1" logHref={null} />);
    expect(container.textContent).toBe("");
    const href = "/logs?namespace=prod&pod=api-1&follow=1";
    rerender(<PodLogsSection namespace="prod" name="api-1" logHref={href} />);
    expect(screen.getByRole("link", { name: /로그 화면에서 열기/ }).getAttribute("href")).toBe(href);
    // 접힌 줄에 "완벽하지 않다" 없는 안심 문장을 두지 않는다(디자인 9절)
    expect(container.textContent).not.toContain("가려서");
    expect(screen.getByRole("button", { name: "로그 보기" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("숫자가 하단 상태 줄에 있는 안내는 안내 줄로 그리지 않는다 (디자인 7.5, designer 추가 4 E3)", () => {
  it("`LOG_REDACTED`·`LOG_DROPPED_LINES`는 상태 줄 한 곳에만, 다른 안내는 그대로", async () => {
    const caps = {
      follow: true,
      serverSearch: false,
      searchScope: "fetched" as const,
      range: "current_file" as const,
      rangeOptions: [{ id: "15m", label: "최근 15분", sec: 900 }],
      previousGeneration: true,
      gonePods: false,
      multiPod: false,
      streamSplit: false,
      retentionHours: null,
      labels: { search: "화면 안에서 찾기", searchHint: "가져온 줄 안에서만 찾습니다." },
    };
    api.handler = (path) =>
      path === "/logs/query"
        ? {
            lines: mk(3),
            stats: { redactedCount: 3, droppedLines: 5 },
            selector: { namespace: "prod", pod: "api-1" },
            anchor: null,
            notices: [
              { code: "LOG_REDACTED", level: "info", text: "가림 3건" },
              { code: "LOG_DROPPED_LINES", level: "info", text: "초당 상한(2000줄)으로 5줄이 생략됐습니다." },
              { code: "LOG_NODE_NOT_REPORTING", level: "warn", text: "대상 노드가 NotReady 상태입니다." },
            ],
          }
        : {};
    render(
      <LogViewer
        capabilities={{
          dataSource: "mock",
          generatedAt: "2026-09-25T00:00:00.000Z",
          enabled: true,
          activeSource: "direct",
          autoSelect: null,
          sources: [
            { id: "direct", label: "직접 조회", productLabel: null, selectable: true, state: "ok", disabledReason: null, tooltip: null, chips: [], capabilities: caps, limitations: null },
          ],
          limits: { defaultLines: 500, maxLines: 5000, lineOptions: [500, 2000], maxBytes: 1, maxLineBytes: 1, maxStreams: 3, maxLinesPerSec: 2000, idlePauseSec: 300, maxStreamMin: 30 },
          streams: { open: 0, max: 3 },
          redaction: { alwaysOn: true, notice: "", rules: [], sourceNote: "" },
          denyNamespaces: [],
          notices: [],
        }}
        target={{ namespace: "prod", pod: "api-1" }}
        targets={undefined}
        targetsLoading={false}
        container="api"
        onContainerChange={() => {}}
        previous={false}
        onPreviousChange={() => {}}
        source="direct"
        onSourceChange={() => {}}
      />,
    );
    await screen.findByText("대상 노드가 NotReady 상태입니다.");
    await waitFor(() => expect(screen.getByText(/^3줄 · 가림 3건 · 초당 상한으로 5줄 생략/)).toBeTruthy());
    expect(screen.queryByText("가림 3건")).toBeNull();
    expect(screen.queryByText("초당 상한(2000줄)으로 5줄이 생략됐습니다.")).toBeNull();
  });
});

describe("live 경로 정리 뒤 안내 모양 (계약 6절 · 디자인 7.4 시작 전 대기 · 8.1 · 8.4)", () => {
  const caps = {
    follow: true,
    serverSearch: true,
    searchScope: "server" as const,
    range: "retention" as const,
    rangeOptions: [{ id: "15m", label: "최근 15분", sec: 900 }],
    previousGeneration: false,
    gonePods: true,
    multiPod: false,
    streamSplit: false,
    retentionHours: 72,
    labels: { search: "검색", searchHint: "" },
  };
  const capabilities = {
    dataSource: "mock" as const,
    generatedAt: "2026-09-25T00:00:00.000Z",
    enabled: true,
    activeSource: "stack" as const,
    autoSelect: null,
    sources: [
      { id: "stack" as const, label: "로그 스택", productLabel: "Loki", selectable: true, state: "unavailable" as const, disabledReason: null, tooltip: null, chips: [], capabilities: caps, limitations: null },
      { id: "direct" as const, label: "직접 조회", productLabel: null, selectable: true, state: "ok" as const, disabledReason: null, tooltip: null, chips: [], capabilities: { ...caps, serverSearch: false, labels: { search: "화면 안에서 찾기", searchHint: "" } }, limitations: null },
    ],
    limits: { defaultLines: 500, maxLines: 5000, lineOptions: [500, 2000], maxBytes: 1, maxLineBytes: 1, maxStreams: 3, maxLinesPerSec: 2000, idlePauseSec: 300, maxStreamMin: 30 },
    streams: { open: 0, max: 3 },
    redaction: { alwaysOn: true, notice: "", rules: [], sourceNote: "" },
    denyNamespaces: [],
    notices: [],
  };
  const query = (notices: unknown[]) => (path: string) =>
    path === "/logs/query" ? { lines: [], stats: { redactedCount: 0, droppedLines: 0 }, selector: { namespace: "prod", pod: "api-1" }, anchor: null, notices } : {};
  const view = (source: "stack" | "direct", onSourceChange: (s: string) => void = () => {}) => (
    <LogViewer
      capabilities={capabilities}
      target={{ namespace: "prod", pod: "api-1" }}
      targets={undefined}
      targetsLoading={false}
      container="api"
      onContainerChange={() => {}}
      previous={false}
      onPreviousChange={() => {}}
      source={source}
      onSourceChange={onSourceChange}
    />
  );

  it("스택 실패(200 + 줄 0 + `details.fallbackSource: 'direct'`)는 전환 버튼 + 무엇을 잃는지, 자동 전환 없음(AC-LOG42), 본문은 비운다", async () => {
    api.handler = query([{ code: "LOG_BACKEND_AUTH_FAILED", level: "warn", text: "로그 스택 인증에 실패했습니다.", details: { fallbackSource: "direct" } }]);
    const onSourceChange = vi.fn();
    render(view("stack", onSourceChange));
    await screen.findByText("로그 스택 인증에 실패했습니다.");
    const btn = screen.getByRole("button", { name: "직접 조회로 전환" });
    expect(screen.getByText(/직접 조회로 바꾸면/)).toBeTruthy();
    expect(onSourceChange).not.toHaveBeenCalled();
    btn.click();
    expect(onSourceChange).toHaveBeenCalledWith("direct");
    expect(screen.queryByText("이 컨테이너가 아직 아무것도 출력하지 않았습니다.")).toBeNull();
  });

  it("쿼리 거부는 warn 한 줄에 서버가 준 `details.reason`을 같이, 전환 버튼 없음", async () => {
    api.handler = query([{ code: "LOG_BACKEND_QUERY_REJECTED", level: "warn", text: "로그 스택이 요청을 거부했습니다.", details: { reason: "max entries limit per query exceeded" } }]);
    render(view("stack"));
    await screen.findByText("로그 스택이 요청을 거부했습니다. (max entries limit per query exceeded)");
    expect(screen.queryByRole("button", { name: /전환/ })).toBeNull();
  });

  it("`LOG_EMPTY`는 8.1 본문 한 줄만 — 안내 줄로 그리지 않는다 (PM 결정 RL14)", async () => {
    api.handler = query([{ code: "LOG_EMPTY", level: "info", text: "이 기간에 출력된 로그가 없습니다." }]);
    const { container } = render(view("direct"));
    const line = await screen.findByText("이 컨테이너가 아직 아무것도 출력하지 않았습니다.");
    expect(line.className).toContain("emptyLine");
    expect(screen.queryByText("이 기간에 출력된 로그가 없습니다.")).toBeNull();
    expect(container.querySelectorAll('[class*="inlineAlert"]')).toHaveLength(1); // 가림 경고뿐
  });

  it("정지 조회의 `LOG_CONTAINER_NOT_STARTED`는 본문 한 줄(서버 문구 그대로), 안내 줄·스피너·`다시 시작` 없음 (8.1)", async () => {
    const text = "컨테이너가 아직 시작되지 않았습니다. 따라가기를 켜 두면 시작될 때 자동으로 표시됩니다.";
    api.handler = query([{ code: "LOG_CONTAINER_NOT_STARTED", level: "info", text }]);
    const { container } = render(view("direct"));
    const line = await screen.findByText(text);
    expect(line.className).toContain("emptyLine");
    expect(container.querySelectorAll('[class*="inlineAlert"]')).toHaveLength(1); // 가림 경고뿐
    expect(screen.queryByRole("button", { name: /다시 시작/ })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
