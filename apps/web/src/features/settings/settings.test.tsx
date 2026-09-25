// @vitest-environment jsdom
/**
 * `/settings → 알림` (P2). **되돌아오기 쉬운 결정**만 고정한다:
 * 웹훅 원문을 다시 그리지 않음 · PATCH 응답으로 바꿔 끼움(다시 GET 없음) · 잠금에는 환경 변수 이름 ·
 * 리소스 이름 안내 자리(테스트 발송 바로 위, 닫기 없음, 대화상자 밖) · `confirm: true` · 서버 쿨다운 · `skipped_*`는 빨간색 아님.
 */
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

import type { ConnectionInfo, StreamStore } from "../stream/client";
import { initialStreamState } from "../stream/reducer";
import { StreamProvider, type StreamStoreLike } from "../stream/StreamProvider";
import {
  TEXT,
  dispatchModeText,
  lastDispatchText,
  lockOf,
  readApiError,
  testBlockReason,
} from "./model";
import { SettingsPage } from "./SettingsPage";
import type { AlertSettingsResponse, TestPreviewResponse, TestSendResponse } from "./types";

configure({ asyncUtilTimeout: 3000 });

type Handler = (path: string, opts: { method?: string; body?: unknown }) => unknown;
const api = vi.hoisted(() => ({
  handler: null as null | Handler,
  calls: [] as { path: string; method: string; body: unknown }[],
}));

vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, opts?: { method?: string; body?: unknown }) => {
      api.calls.push({ path, method: opts?.method ?? "GET", body: opts?.body });
      if (!api.handler) throw new Error("handler 없음");
      return api.handler(path, opts ?? {});
    }),
  };
});

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

afterEach(() => {
  cleanup();
  api.handler = null;
  api.calls = [];
});

const URL_SECRET = "https://discord.com/api/webhooks/123456789012345678/TokenOnlyInTheInputQQQ1";

function settings(patch: Partial<AlertSettingsResponse> = {}, discord: Partial<AlertSettingsResponse["discord"]> = {}): AlertSettingsResponse {
  const base: AlertSettingsResponse = {
    dataSource: "mock",
    generatedAt: "2026-09-25T05:02:00.000Z",
    persistence: "database",
    dispatch: { mode: "mock", modeSource: "data_source", outbound: false },
    discord: {
      enabled: true,
      configured: false,
      hint: null,
      length: null,
      source: null,
      updatedAt: null,
      minSeverity: "critical",
      sendUnknown: true,
      publicBaseUrlConfigured: false,
      lastDispatch: null,
      circuitBreaker: { open: false, consecutiveFailures: 0, openedAt: null, resumeAt: null },
      queue: { pending: 0, nextRetryAt: null },
    },
    rules: { uiEditable: false },
    retention: { days: 90, maxRows: 2000, uiEditable: false },
    keys: [
      { key: "area:pods", label: "파드", enabled: true, editable: false },
      { key: "source:kube", label: "쿠버네티스 연결", enabled: true, editable: false },
    ],
    warmup: { active: false, endsAt: null },
    lockedByEnv: [],
    lockedByEnvDetail: [],
    notices: [
      { code: "ALERTS_DISCORD_NOT_CONFIGURED", level: "info", text: "디스코드 미설정 — 알림이 화면에만 쌓입니다." },
      { code: "ALERTS_TARGET_NAMES_PLAIN", level: "info", text: "알림 본문에 클러스터 리소스 이름이 포함됩니다." },
    ],
    updatedAt: null,
  };
  return { ...base, ...patch, discord: { ...base.discord, ...discord } };
}

const configured = (patch: Partial<AlertSettingsResponse> = {}) =>
  settings(
    { ...patch, notices: [] },
    { configured: true, hint: "…****QQQ1", length: 77, source: "db", updatedAt: "2026-09-25T05:02:00.000Z" },
  );

const preview: TestPreviewResponse = {
  dataSource: "mock",
  generatedAt: "2026-09-25T05:02:00.000Z",
  canSend: true,
  blocked: null,
  target: { hint: "…****QQQ1", length: 77 },
  dispatch: { mode: "mock", outbound: false },
  message: "[MOCK] [테스트] Sentinel 알림 설정 확인 메시지입니다. 실제 장애가 아닙니다.",
  cooldown: { active: false, retryAfterSec: 0, nextAvailableAt: null },
  warning: "디스코드 채널에 실제 메시지가 즉시 전송됩니다. 되돌릴 수 없습니다.",
};

const mockSent: TestSendResponse = {
  dataSource: "mock",
  generatedAt: "2026-09-25T05:02:10.000Z",
  alertId: "t1",
  result: { state: "skipped_mock", label: "보내지 않음 (mock)", at: "2026-09-25T05:02:10.000Z", responseCode: null, detail: null },
  message: "[MOCK] [테스트] Sentinel 알림 설정 확인 메시지입니다. 실제 장애가 아닙니다.\n시각: 2026-09-25T05:02:10Z",
  cooldown: { retryAfterSec: 60, nextAvailableAt: "2026-09-25T05:03:10.000Z" },
};

const httpError = (status: number, code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError("http", `API 오류 ${status}`, {
    url: "x",
    status,
    body: { statusCode: status, code, message, details, path: "/api/alerts", timestamp: "" },
  });

const idleConn: ConnectionInfo = {
  phase: "idle",
  everOpened: false,
  attempt: 0,
  nextRetryAt: null,
  downSince: null,
  reconnectedAt: null,
  apiReachable: null,
  topics: [],
};

function renderPage(ui: ReactNode = <SettingsPage />) {
  const snap: StreamStore = { stream: initialStreamState, connection: idleConn };
  const store: StreamStoreLike = { subscribe: () => () => {}, getSnapshot: () => snap, retain: () => () => {}, reconnectNow: vi.fn() };
  return render(<StreamProvider client={store}>{ui}</StreamProvider>);
}

const settingsGets = () => api.calls.filter((c) => c.path === "/alerts/settings" && c.method === "GET").length;
const posts = () => api.calls.filter((c) => c.path === "/alerts/test" && c.method === "POST");

describe("웹훅 주소 (SecretInput)", () => {
  it("저장 성공: PATCH 응답(전체 설정)으로 바꿔 끼우고 **다시 GET 하지 않는다**. 입력칸과 원문이 DOM 에서 사라진다", async () => {
    api.handler = (path, opts) => {
      if (path === "/alerts/settings" && (opts.method ?? "GET") === "GET") return settings();
      if (path === "/alerts/settings" && opts.method === "PATCH") return configured();
      throw new Error(path);
    };
    renderPage();
    const input = await screen.findByTestId("secret-input");
    fireEvent.change(input, { target: { value: URL_SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("…****QQQ1");

    const patch = api.calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ discord: { webhookUrl: URL_SECRET } });
    expect(settingsGets()).toBe(1);
    expect(screen.queryByTestId("secret-input")).toBeNull();
    expect(document.body.innerHTML).not.toContain("TokenOnlyInTheInput");
    expect(document.body.innerHTML).not.toContain("123456789012345678");
    expect(screen.getByText("저장됐습니다")).toBeTruthy();
    // 눈 아이콘·다시 보기 없음
    expect(screen.queryByRole("button", { name: /다시 보기|보기/ })).toBeNull();
  });

  it("400: 서버 사유 한 줄만 보이고 입력값을 되비추지 않는다", async () => {
    api.handler = (path, opts) => {
      if (opts.method === "PATCH") {
        throw httpError(400, "VALIDATION_FAILED", "웹훅 주소 형식이 올바르지 않습니다 (호스트가 허용 목록에 없습니다).", { reason: "HOST_NOT_ALLOWED" });
      }
      return settings();
    };
    renderPage();
    const input = await screen.findByTestId("secret-input");
    fireEvent.change(input, { target: { value: "https://evil.example.com/api/webhooks/1/EvilTokenZZ" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const err = await screen.findByText("웹훅 주소 형식이 올바르지 않습니다 (호스트가 허용 목록에 없습니다).");
    expect(err.textContent).not.toContain("evil");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("환경 변수 잠금: `SecretInput`에는 필드 이름(`webhookUrl`)이 아니라 **환경 변수 이름**이 간다", async () => {
    api.handler = () =>
      configured({
        lockedByEnv: ["webhookUrl"],
        lockedByEnvDetail: [{ field: "webhookUrl", envVar: "ALERTS_DISCORD_WEBHOOK_URL", text: "환경 변수 ALERTS_DISCORD_WEBHOOK_URL로 고정돼 있어…" }],
      });
    renderPage();
    await screen.findByText(/ALERTS_DISCORD_WEBHOOK_URL 환경 변수가 설정돼 있어/);
    expect(screen.queryByText(/webhookUrl 환경 변수/)).toBeNull();
    expect(screen.queryByTestId("secret-input")).toBeNull();
    expect(screen.queryByRole("button", { name: "바꾸기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "지우기" })).toBeNull();
    expect(screen.getAllByText(".env로 고정됨").length).toBeGreaterThan(0);
  });

  it("409(다른 곳에서 잠김): 사유를 보이고 설정을 다시 읽는다", async () => {
    let locked = false;
    api.handler = (path, opts) => {
      if (opts.method === "PATCH") {
        locked = true;
        throw httpError(409, "SETTING_LOCKED_BY_ENV", "환경 변수 ALERTS_DISCORD_WEBHOOK_URL로 고정돼 있어 화면에서 바꿀 수 없습니다.");
      }
      return locked
        ? configured({ lockedByEnv: ["webhookUrl"], lockedByEnvDetail: [{ field: "webhookUrl", envVar: "ALERTS_DISCORD_WEBHOOK_URL", text: "" }] })
        : settings();
    };
    renderPage();
    const input = await screen.findByTestId("secret-input");
    fireEvent.change(input, { target: { value: URL_SECRET } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("환경 변수 ALERTS_DISCORD_WEBHOOK_URL로 고정돼 있어 화면에서 바꿀 수 없습니다.");
    await waitFor(() => expect(settingsGets()).toBe(2));
    await screen.findByText(/ALERTS_DISCORD_WEBHOOK_URL 환경 변수가 설정돼 있어/);
    expect(document.body.innerHTML).not.toContain("TokenOnlyInTheInput");
  });
});

describe("리소스 이름 안내와 테스트 발송", () => {
  it("안내는 **테스트 발송 버튼 바로 위**, 닫기 없음, 확인 대화상자 안에는 없다", async () => {
    api.handler = (path) => (path === "/alerts/test/preview" ? preview : configured());
    renderPage();
    const title = await screen.findByText(/원문 그대로 들어갑니다/);
    const root = title.parentElement?.parentElement as HTMLElement;
    expect(within(root).queryByRole("button")).toBeNull();
    expect(within(root).getByText("i-0abc…")).toBeTruthy();
    const next = root.nextElementSibling as HTMLElement;
    expect(within(next).getByRole("button", { name: "테스트 발송" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "테스트 발송" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/\[테스트\]/);
    expect(within(dialog).queryByText(/원문 그대로 들어갑니다/)).toBeNull();
    expect(within(dialog).getByText("실제로 보내지 않음")).toBeTruthy();
  });

  it("취소하면 아무것도 보내지 않고, 보내기는 `confirm: true`. mock 결과는 빨간색이 아니다", async () => {
    api.handler = (path, opts) => {
      if (path === "/alerts/test/preview") return preview;
      if (path === "/alerts/test" && opts.method === "POST") return mockSent;
      return configured();
    };
    const { container } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "테스트 발송" }));
    let dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/\[테스트\]/);
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(posts()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "테스트 발송" }));
    dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/\[테스트\]/);
    fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));
    await screen.findByText("실제로 보내지 않았습니다 (mock)");
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toEqual({ confirm: true });
    expect(screen.getByText(/60초 후 다시 보낼 수 있습니다$/)).toBeTruthy();
    expect(container.querySelector('[class*="tone-crit"]')).toBeNull();
  });

  it("429: 쿨다운은 서버 `retryAfterSec`으로 맞춘다", async () => {
    api.handler = (path, opts) => {
      if (path === "/alerts/test/preview") return preview;
      if (path === "/alerts/test" && opts.method === "POST") {
        throw httpError(429, "ALERT_TEST_COOLDOWN", "테스트 발송은 42초 뒤에 다시 할 수 있습니다.", { retryAfterSec: 42 });
      }
      return configured();
    };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "테스트 발송" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/\[테스트\]/);
    fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));
    await within(dialog).findByText("테스트 발송은 42초 뒤에 다시 할 수 있습니다.");
    expect(within(dialog).getByRole("button", { name: /보내기/ }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await screen.findByText(/42초 후 다시 보낼 수 있습니다$/);
  });

  it("대시보드 DB 없음: 배너 + 저장 컨트롤 비활성(사유), PATCH 0건", async () => {
    api.handler = () => settings({ persistence: "memory" });
    renderPage();
    await screen.findByText(TEXT.dbDownBanner);
    const sw = screen.getByRole("switch", { name: "디스코드로 보내기" });
    expect(sw.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(sw);
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    // 우회(fieldset) 대신 SecretInput.disabled — 입력칸은 disabled, 저장은 aria-disabled + 사유(포커스 유지)
    expect((screen.getByTestId("secret-input") as HTMLInputElement).disabled).toBe(true);
    const save = screen.getByRole("button", { name: /^저장/ });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.getAttribute("aria-describedby")).toBeTruthy();
    // 저장된 주소가 없고 저장할 수도 없다 — "먼저 저장하세요"라고 하지 않는다
    expect(screen.getByRole("button", { name: /테스트 발송/ }).getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getAllByText(TEXT.dbDownNoWebhook).length).toBeGreaterThan(0);
    expect(screen.queryByText(TEXT.notConfigured)).toBeNull();
  });

  it("Card 2: 현재 상태는 서버 `keys[].status` 하나 — 8행 모두 배지(쿠버네티스 연결 포함), 평가 전이면 `—`", async () => {
    api.handler = () =>
      configured({
        keys: [
          { key: "area:pods", label: "파드", enabled: true, editable: false, status: "critical", statusSince: "2026-09-25T05:00:00.000Z" },
          { key: "source:kube", label: "쿠버네티스 연결", enabled: true, editable: false, status: "ok", statusSince: "2026-09-25T04:00:00.000Z" },
          { key: "area:cost", label: "비용", enabled: true, editable: false, status: null, statusSince: null },
        ],
      });
    renderPage();
    const card = (await screen.findByRole("heading", { name: "알림 대상" })).closest("section") as HTMLElement;
    const row = (label: string) => within(card).getByText(label).closest("div") as HTMLElement;
    expect(within(row("파드")).getByText("장애")).toBeTruthy();
    expect(within(row("쿠버네티스 연결")).getByText("정상")).toBeTruthy();
    expect(within(row("비용")).getByText("—")).toBeTruthy();
  });

  it("스위치 설명은 aria-describedby 로 이어지고, 테스트 발송 중에는 취소도 막힌다(Esc·바깥 포함)", async () => {
    let release: (v: unknown) => void = () => {};
    api.handler = (path, opts) => {
      if (path === "/alerts/test/preview") return preview;
      if (path === "/alerts/test" && opts.method === "POST") return new Promise((r) => (release = r));
      return configured();
    };
    renderPage();
    const sw = await screen.findByRole("switch", { name: "디스코드로 보내기" });
    const descId = sw.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(descId.split(" ")[0])?.textContent).toContain("화면 알림 센터에는 계속 쌓입니다");
    fireEvent.click(screen.getByRole("button", { name: "테스트 발송" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/\[테스트\]/);
    fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /취소/ }).getAttribute("aria-disabled")).toBe("true"));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeTruthy();
    release(mockSent);
    await screen.findByText("실제로 보내지 않았습니다 (mock)");
  });

  it("마지막 발송이 없으면 `마지막 발송 없음`(mock 에서는 테스트 뒤에도 그대로가 정상)", async () => {
    api.handler = () => configured();
    renderPage();
    expect(await screen.findByText("마지막 발송 없음")).toBeTruthy();
  });
});

describe("설정 화면 순수 함수", () => {
  it("잠금은 필드 이름으로 찾고 환경 변수 이름을 꺼낸다", () => {
    const s = settings({ lockedByEnv: ["webhookUrl"], lockedByEnvDetail: [{ field: "webhookUrl", envVar: "ALERTS_DISCORD_WEBHOOK_URL", text: "t" }] });
    expect(lockOf(s, "webhookUrl")?.envVar).toBe("ALERTS_DISCORD_WEBHOOK_URL");
    expect(lockOf(s, "dispatchMode")).toBeUndefined();
  });

  it("테스트 발송 비활성 사유: 미저장 → 꺼짐 → 쿨다운 순, DB 없음이면 저장을 권하지 않는다", () => {
    expect(testBlockReason(settings(), null)).toBe(TEXT.notConfigured);
    expect(testBlockReason(settings({ persistence: "memory" }), null)).toBe(TEXT.dbDownNoWebhook);
    expect(testBlockReason(configured(), null)).toBeNull();
    expect(testBlockReason(settings({}, { configured: true, enabled: false }), null)).toBe(TEXT.disabled);
    expect(testBlockReason(configured(), 58)).toBe("58초 후 다시 보낼 수 있습니다.");
    // DB 가 없어도 환경 변수로 들어온 주소는 보낼 수 있다(서버가 허용)
    expect(testBlockReason(configured({ persistence: "memory" }), null)).toBeNull();
  });

  it("마지막 발송 줄: 실패 사유는 서버 문구 그대로, `skipped_*`는 실패가 아니다", () => {
    expect(lastDispatchText(null)).toMatchObject({ text: "마지막 발송 없음", none: true });
    const failed = lastDispatchText({ at: "2026-09-25T05:02:00.000Z", state: "failed", responseCode: 429, detail: "429 Too Many Requests" });
    expect(failed.failed).toBe(true);
    expect(failed.text).toMatch(/· 실패 \(429 Too Many Requests\)$/);
    const skipped = lastDispatchText({ at: "2026-09-25T05:02:00.000Z", state: "skipped_mock", responseCode: null, detail: null });
    expect(skipped.failed).toBe(false);
    expect(lastDispatchText({ at: "2026-09-25T05:02:00.000Z", state: "sent", responseCode: 204, detail: null }).text).toMatch(/· 성공$/);
  });

  it("발송 모드 줄은 어느 설정 때문인지 쓴다", () => {
    expect(dispatchModeText(settings())).toBe("실제로 보내지 않음 (DATA_SOURCE=mock을 따름)");
    expect(dispatchModeText(settings({ dispatch: { mode: "mock", modeSource: "env", outbound: false } }))).toBe(
      "실제로 보내지 않음 (ALERTS_DISPATCH=mock)",
    );
  });

  it("429 본문에서 `retryAfterSec`을 꺼낸다", () => {
    const e = readApiError(httpError(429, "ALERT_TEST_COOLDOWN", "m", { retryAfterSec: 17 }));
    expect(e).toMatchObject({ status: 429, code: "ALERT_TEST_COOLDOWN", retryAfterSec: 17 });
    expect(readApiError(new Error("x")).code).toBeNull();
  });
});
