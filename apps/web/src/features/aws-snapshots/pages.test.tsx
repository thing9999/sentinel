// @vitest-environment jsdom
/**
 * aws-snapshot-manager 페이지 통합 (가짜 스트림 저장소 + 계약 예시 모양의 가짜 REST).
 * 쓰기 요청의 메서드·본문(JSON, confirm, baseVersion)과 확인·충돌 흐름을 확인한다.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detailResponse,
  fileResponse,
  listResponse,
  snapshotSummary,
  templateCheck,
  TRASH,
} from "../__fixtures__/snapshots";
import type { StreamEnvelope } from "../common/types";
import type { ConnectionInfo, StreamStore } from "../stream/client";
import { applyBatch, initialStreamState, type StreamState } from "../stream/reducer";
import { StreamProvider, type StreamStoreLike } from "../stream/StreamProvider";
import { HISTORY_GUARD_KEY } from "./hooks";
import { SnapshotDetailPage } from "./SnapshotDetailPage";
import { SnapshotListPage } from "./SnapshotListPage";
import { TrashPage } from "./TrashPage";
import type { SnapshotSummary } from "./types";

// 안정화(flake): 페이지 모듈은 정적 import(테스트마다 동적 import·변환 대기 없음),
// 긴 저장 흐름의 findBy*/waitFor 는 전체 실행 부하에서도 1초 기본 제한에 걸리지 않게 3초로
configure({ asyncUtilTimeout: 3000 });

const CHANGED = "changed\n";
const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/snapshots",
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

interface Call {
  path: string;
  method: string;
  body?: unknown;
  query?: Record<string, unknown>;
}
const calls: Call[] = [];
type Handler = (c: Call) => unknown;
let handler: Handler = () => undefined;

vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, opts?: { method?: string; body?: unknown; query?: Record<string, unknown> }) => {
      const c: Call = { path, method: opts?.method ?? "GET", body: opts?.body, query: opts?.query };
      calls.push(c);
      const r = await handler(c);
      if (r instanceof Error) throw r;
      if (r === undefined) {
        throw new actual.ApiError("http", "not found", { url: path, status: 404, body: { statusCode: 404, code: "RESOURCE_NOT_FOUND", message: "없음", path, timestamp: "" } });
      }
      return r;
    }),
  };
});

async function httpError(status: number, code: string, details?: Record<string, unknown>, message = "오류") {
  const { ApiError } = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return new ApiError("http", message, { url: "x", status, body: { statusCode: status, code, message, details, path: "/", timestamp: "" } });
}

function defaultHandler(c: Call): unknown {
  if (c.path === "/aws-snapshots" && c.method === "GET") return listResponse();
  if (c.path === "/aws-snapshots/trash" && c.method === "GET") return TRASH;
  if (c.path === "/aws-snapshots/20260919-031500" && c.method === "GET") return detailResponse();
  if (c.path === "/aws-snapshots/20260919-031500/files/terraform" && c.method === "GET") return fileResponse("terraform");
  if (c.path === "/aws-snapshots/20260919-031500/files/cloudformation" && c.method === "GET") return fileResponse("cloudformation");
  if (c.path === "/aws-snapshots/20260919-031500/files/mapping" && c.method === "GET") return fileResponse("mapping");
  if (c.path === "/aws-snapshots/scan-rules") return { dataSource: "mock", generatedAt: "", allowMarker: "snapshot-scan: allow", scannableExtensions: [], rules: [] };
  return undefined;
}

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
beforeEach(() => {
  calls.length = 0;
  handler = defaultHandler;
  searchParams = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  localStorage.clear();
});
afterEach(() => cleanup());

let seq = 0;
function streamWith(summary: SnapshotSummary | null): StreamState {
  const events = [
    {
      type: "stream.hello",
      envelope: {
        seq: ++seq,
        topic: "stream" as StreamEnvelope["topic"],
        emittedAt: "",
        payload: { streamId: "s", dataSource: "mock", serverTime: new Date().toISOString(), heartbeatSec: 15, topics: ["overview", "aws-snapshots"], sources: [] },
      },
      receivedAt: Date.now(),
    },
  ];
  if (summary) {
    events.push({
      type: "aws-snapshots.snapshot",
      envelope: { seq: ++seq, topic: "aws-snapshots", emittedAt: "", payload: { revision: 1, summary } as never },
      receivedAt: Date.now(),
    });
  }
  return applyBatch(initialStreamState, events);
}

const openConn: ConnectionInfo = {
  phase: "open",
  everOpened: true,
  attempt: 0,
  nextRetryAt: null,
  downSince: null,
  reconnectedAt: null,
  apiReachable: true,
  topics: ["overview", "aws-snapshots"],
};

function renderWith(ui: ReactNode, summary: SnapshotSummary | null = snapshotSummary()) {
  const snap: StreamStore = { stream: streamWith(summary), connection: openConn };
  const store: StreamStoreLike = { subscribe: () => () => {}, getSnapshot: () => snap, retain: () => () => {}, reconnectNow: vi.fn() };
  return render(<StreamProvider client={store}>{ui}</StreamProvider>);
}

describe("목록 /snapshots", () => {
  it("요약 띠·행·MOCK 안내, crit 는 `커밋 금지`, 내보내기·적용 버튼 없음 (AC-01·05·07·21)", async () => {
    renderWith(<SnapshotListPage />);
    await screen.findByText("EKS 1.30 업그레이드 전");
    // k8s-snapshot 이후 목록 머리는 `스냅샷` + AWS / Kubernetes 탭(현재 AWS, AC-K17)
    expect(screen.getByRole("heading", { level: 1, name: "스냅샷" })).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "스냅샷 종류" });
    expect(within(tabs).getByRole("link", { name: /AWS/ }).getAttribute("aria-current")).toBe("page");
    expect(within(tabs).getByRole("link", { name: /Kubernetes/ }).getAttribute("href")).toBe("/snapshots/k8s");
    expect(screen.getByText(/MOCK: 예시 스냅샷입니다/)).toBeTruthy();
    const table = screen.getByRole("table", { name: /스냅샷 목록/ });
    expect(within(table).getAllByText("커밋 금지").length).toBeGreaterThanOrEqual(2);
    expect(within(table).getByText("비밀값 의심 2건 (env-block, url-credentials)")).toBeTruthy();
    expect(within(table).getByText("−18 / −18")).toBeTruthy();
    expect(within(table).getByText("대시보드에서 수정")).toBeTruthy();
    expect(screen.getByText("스냅샷 4개 중 4개 표시")).toBeTruthy();
    expect(screen.getByText("인식하지 못한 항목 1개")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /내보내기$|적용|커밋하기/ })).toBeNull();
    // 내보내기 진행 중 행은 동작 버튼 비활성 + 사유 (AC-39)
    const row = screen.getByText("내보내기 진행 중일 수 있음", { selector: "span" }).closest("tr")!;
    const disabled = within(row).getByRole("button", { name: "휴지통으로 이동" });
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    expect(disabled.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(disabled.getAttribute("aria-describedby")!.split(" ")[0])?.textContent).toContain("내보내기 진행 중일 수 있어");
  });

  it("URL 필터: 상태·라벨 검색 (AC-06)", async () => {
    searchParams = new URLSearchParams("status=warn");
    renderWith(<SnapshotListPage />);
    await screen.findByText("스냅샷 4개 중 1개 표시");
    cleanup();
    searchParams = new URLSearchParams("q=업그레이드");
    renderWith(<SnapshotListPage />);
    await screen.findByText("스냅샷 4개 중 1개 표시");
    expect(screen.getByText("EKS 1.30 업그레이드 전")).toBeTruthy();
  });

  it("스냅샷 0개면 빈 상태 + CLI 안내(복사, 실행 수단 없음) (AC-51)", async () => {
    handler = (c) => (c.path === "/aws-snapshots" ? listResponse({ items: [], total: 0, filteredTotal: 0 }) : defaultHandler(c));
    renderWith(<SnapshotListPage />, snapshotSummary({ counts: { total: 0, critical: 0, warning: 0, unknown: 0, ok: 0 } }));
    await screen.findByText("아직 스냅샷이 없습니다");
    expect(screen.getByText("npm run export --prefix deploy/aws-snapshot")).toBeTruthy();
    expect(screen.getByText("npm run scan --prefix deploy/aws-snapshot -- snapshots/<id>")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /복사/ }).length).toBeGreaterThanOrEqual(4);
  });

  it("설정 없음이면 예시 없이 UnknownState + 설정 안내 (AC-45)", async () => {
    const nc = snapshotSummary({
      status: { status: "unknown", reasons: [{ code: "SOURCE_NOT_CONFIGURED", text: "스냅샷 폴더가 설정되지 않았습니다 (AWS_SNAPSHOT_DIR)", status: "unknown" }], updatedAt: null, statusChangedAt: null, stale: false },
      counts: { total: 0, critical: 0, warning: 0, unknown: 0, ok: 0 },
      root: {
        configured: false,
        displayPath: null,
        state: "not_configured",
        setup: { envVar: "AWS_SNAPSHOT_DIR", dockerMount: "./deploy/aws-snapshot/snapshots:/data/aws-snapshots", localExample: "AWS_SNAPSHOT_DIR=../../deploy/aws-snapshot/snapshots", reasonText: "스냅샷 폴더가 설정되지 않았습니다 (AWS_SNAPSHOT_DIR)" },
      },
    });
    handler = (c) => (c.path === "/aws-snapshots" ? listResponse({ items: [], summary: nc, dataSource: "live" }) : defaultHandler(c));
    renderWith(<SnapshotListPage />, nc);
    expect(await screen.findByText("알 수 없음 (스냅샷 폴더가 설정되지 않았습니다)")).toBeTruthy();
    expect(screen.getByText("AWS_SNAPSHOT_DIR=../../deploy/aws-snapshot/snapshots")).toBeTruthy();
    expect(screen.queryByRole("table", { name: /스냅샷 목록/ })).toBeNull();
  });

  it("읽기 전용이면 Banner + 쓰기 버튼 비활성 사유 (AC-47)", async () => {
    const ro = { allowed: false, reasonCode: "READ_ONLY" as const, reasonText: "스냅샷 폴더가 읽기 전용입니다" };
    const items = listResponse().items.map((it) => ({ ...it, actions: { editTemplates: ro, editNotes: ro, delete: ro } }));
    handler = (c) => (c.path === "/aws-snapshots" ? listResponse({ items, summary: snapshotSummary({ writable: ro }) }) : defaultHandler(c));
    renderWith(<SnapshotListPage />, snapshotSummary({ writable: ro }));
    await screen.findByText("EKS 1.30 업그레이드 전");
    expect(screen.getAllByText("스냅샷 폴더가 읽기 전용입니다").length).toBeGreaterThan(0);
    const btns = screen.getAllByRole("button", { name: "라벨·메모 편집" });
    expect(btns.length).toBe(4);
    for (const b of btns) expect(b.getAttribute("aria-disabled")).toBe("true");
  });

  it("새로고침은 POST refresh 에 JSON 본문 {}", async () => {
    handler = (c) => (c.path === "/aws-snapshots/refresh" ? { dataSource: "mock", generatedAt: "", revision: 2, summary: snapshotSummary() } : defaultHandler(c));
    renderWith(<SnapshotListPage />);
    await screen.findByText("EKS 1.30 업그레이드 전");
    fireEvent.click(screen.getByRole("button", { name: "지금 다시 읽기" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/aws-snapshots/refresh")).toBe(true));
    const c = calls.find((x) => x.path === "/aws-snapshots/refresh")!;
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({});
  });

  it("라벨·메모 저장: baseVersion 포함, 비밀값 거부는 규칙 ID만 (AC-34·35)", async () => {
    const secret = await httpError(422, "SNAPSHOT_NOTES_SECRET_DETECTED", { fields: ["memo"], rules: ["url-credentials"] });
    handler = (c) => (c.path === "/aws-snapshots/20260919-031500/notes" ? secret : defaultHandler(c));
    renderWith(<SnapshotListPage />);
    await screen.findByText("EKS 1.30 업그레이드 전");
    const row = screen.getByText("비밀값 의심 2건 (env-block, url-credentials)").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "라벨·메모 편집" }));
    const memo = await screen.findByRole("textbox", { name: /메모/ });
    fireEvent.change(memo, { target: { value: "postgres://user:pass@host" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/notes"))).toBe(true));
    const c = calls.find((x) => x.path.endsWith("/notes"))!;
    expect(c.method).toBe("PUT");
    expect(c.body).toEqual({ label: "", memo: "postgres://user:pass@host", baseVersion: `sha256:${"d".repeat(64)}` });
    expect(await screen.findByText("비밀값으로 보이는 내용이 있어 저장하지 않았습니다")).toBeTruthy();
    expect(screen.getByText("규칙: url-credentials (메모)")).toBeTruthy();
  });
});

describe("상세 /snapshots/[id]", () => {
  it("A~E 영역, 판단 사유, 스캔 비교, 탭 3개, 내보내기·적용 버튼 없음 (AC-07·13·14)", async () => {
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByText("판단 사유");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/스냅샷$/);
    expect(screen.getAllByText("비밀값 의심 2건 (env-block, url-credentials)").length).toBeGreaterThan(0);
    expect(screen.getByText("내보내기 당시 오류 3 · 경고 1 → 지금 오류 2 · 경고 1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /cloudformation\.yml/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /terraform\.tf/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /logical-id-mapping\.json/ })).toBeTruthy();
    expect(screen.getByText("대시보드는 커밋·적용하지 않습니다")).toBeTruthy();
    expect(screen.getByText("npm run scan --prefix deploy/aws-snapshot -- snapshots/20260919-031500")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "리소스 수" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "폴더 내용" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "메타데이터" })).toBeTruthy();
    expect(within(screen.getByRole("table", { name: /폴더 내용/ })).getByText("raw 데이터")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /내보내기$|적용|커밋하기/ })).toBeNull();
    // 매핑 탭은 편집 버튼 없음 (AC-32)
    fireEvent.click(screen.getByRole("tab", { name: /logical-id-mapping\.json/ }));
    await screen.findByRole("textbox", { name: "logical-id-mapping.json 내용" });
    expect(screen.queryByRole("button", { name: "편집" })).toBeNull();
  });

  it("발견 항목을 누르면 그 파일 탭으로 이동 (AC-11)", async () => {
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByRole("textbox", { name: "cloudformation.yml 내용" });
    fireEvent.click(screen.getByRole("button", { name: /^오류, terraform\.tf 2번째 줄, env-block/ }));
    await screen.findByRole("textbox", { name: "terraform.tf 내용" });
    expect(screen.getByRole("tab", { name: /terraform\.tf/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("편집 → 저장: 검사에서 오류 남음 → 확인 창 → PUT confirm=[secret_errors], LF 본문·baseVersion (AC-22·23·33)", async () => {
    let putBody: unknown;
    handler = (c) => {
      if (c.path.endsWith("/files/terraform/check")) {
        return {
          dataSource: "mock",
          generatedAt: "",
          snapshotId: "20260919-031500",
          kind: "terraform",
          check: templateCheck({
            findings: [{ file: "terraform.tf", fileKind: "terraform", line: 2, rule: "env-block", severity: "error", message: "환경 변수 블록입니다" }],
            errors: 1,
            confirmationsRequired: ["secret_errors"],
          }),
        };
      }
      if (c.path.endsWith("/files/terraform") && c.method === "PUT") {
        putBody = c.body;
        return {
          dataSource: "mock",
          generatedAt: "",
          saved: true,
          snapshotId: "20260919-031500",
          kind: "terraform",
          version: `sha256:${"f".repeat(64)}`,
          modifiedAt: "",
          sizeBytes: 10,
          check: templateCheck(),
          rescan: { before: { errors: 2, warnings: 1 }, after: { errors: 1, warnings: 1 } },
          snapshot: { ...listResponse().items[1], scan: { errors: 1, warnings: 1, strict: false, passed: false, rules: [] } },
          revision: 5,
        };
      }
      return defaultHandler(c);
    };
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByRole("textbox", { name: "cloudformation.yml 내용" });
    fireEvent.click(screen.getByRole("tab", { name: /terraform\.tf/ }));
    await screen.findByRole("textbox", { name: "terraform.tf 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    expect(await screen.findByText("이 스냅샷 원본을 직접 고칩니다")).toBeTruthy();
    const ta = screen.getByRole("textbox", { name: /terraform\.tf 편집기/ });
    const next = 'resource "aws_db_instance" "main" {\n  password = var.db_password\n}\n';
    fireEvent.change(ta, { target: { value: next } });
    expect(screen.getByText("저장하지 않은 변경")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByText("비밀값 의심 1건이 남아 있습니다")).toBeTruthy();
    const check = calls.find((c) => c.path.endsWith("/check"))!;
    expect(check.method).toBe("POST");
    expect(check.body).toEqual({ content: next, baseVersion: `sha256:${"b".repeat(64)}` });
    // 확인 버튼은 check 응답이 그린다 → getBy* 로 즉시 찾지 않고 나타날 때까지 기다린다(경쟁 조건)
    fireEvent.click(await screen.findByRole("button", { name: "커밋 금지 상태로 저장" }));
    // PUT 결과가 화면에 반영될 때까지 **한 번만** 기다리고, 그 뒤에 기록한 본문을 본다
    // (putBody 폴링 + 화면 폴링 두 번을 기다리면 전체 실행 부하에서 앞의 것이 먼저 시간 초과된다)
    expect(await screen.findByText("재스캔: 오류 2 → 1, 경고 1 → 1")).toBeTruthy();
    expect(putBody).toEqual({ content: next, baseVersion: `sha256:${"b".repeat(64)}`, confirm: ["secret_errors"] });
    expect(screen.getAllByText(/비밀값 의심 1건이 남아 커밋 금지 상태입니다/).length).toBeGreaterThan(0);
  });

  it("저장 409 → 충돌 창: 복사·다시 불러오기만, 강제 덮어쓰기 없음 (AC-30)", async () => {
    const conflict = await httpError(409, "SNAPSHOT_VERSION_CONFLICT", { fileKind: "terraform" }, "다른 곳에서 파일이 바뀌었습니다");
    handler = (c) => {
      if (c.path.endsWith("/check")) return { dataSource: "mock", generatedAt: "", snapshotId: "x", kind: "terraform", check: templateCheck() };
      if (c.path.endsWith("/files/terraform") && c.method === "PUT") return conflict;
      return defaultHandler(c);
    };
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByRole("textbox", { name: "cloudformation.yml 내용" });
    fireEvent.click(screen.getByRole("tab", { name: /terraform\.tf/ }));
    await screen.findByRole("textbox", { name: "terraform.tf 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: /terraform\.tf 편집기/ }), { target: { value: "x\n" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const dlg = await screen.findByRole("dialog", { name: "다른 곳에서 파일이 바뀌었습니다" });
    expect(within(dlg).getByRole("button", { name: /내 편집 복사/ })).toBeTruthy();
    expect(within(dlg).getByRole("button", { name: "최신 내용 불러오기" })).toBeTruthy();
    expect(within(dlg).queryByRole("button", { name: /덮어쓰기|강제|저장/ })).toBeNull();
    // 422 없이 바로 PUT: confirm 없는 본문
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.body).toEqual({ content: "x\n", baseVersion: `sha256:${"b".repeat(64)}` });
  });

  it("저장하지 않은 변경이 있으면 탭 전환 시 확인 (AC-31)", async () => {
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByRole("textbox", { name: "cloudformation.yml 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: /cloudformation\.yml 편집기/ }), { target: { value: "changed\n" } });
    fireEvent.click(screen.getByRole("tab", { name: /terraform\.tf/ }));
    expect(await screen.findByRole("dialog", { name: "저장하지 않은 변경이 있습니다" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
    expect(screen.getByRole("tab", { name: /cloudformation\.yml/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("앱 안 링크 이동도 확인을 받는다 (AC-31)", async () => {
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByRole("textbox", { name: "cloudformation.yml 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: /cloudformation\.yml 편집기/ }), { target: { value: "changed\n" } });
    const link = screen.getByRole("link", { name: "AWS 스냅샷" });
    act(() => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(await screen.findByRole("dialog", { name: "저장하지 않은 변경이 있습니다" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
    // 가드 항목 자리를 목록으로 바꾼다(뒤로 가면 편집하던 페이지)
    expect(replace).toHaveBeenCalledWith("/snapshots");
  });

  it("브라우저 뒤로: 가드 재삽입 → 확인 창, 계속 편집이면 URL·내용 유지, 버리기면 이전 페이지로 (AC-31)", async () => {
    const startUrl = window.location.href;
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByRole("textbox", { name: "cloudformation.yml 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    const lenBefore = window.history.length;
    fireEvent.change(screen.getByRole("textbox", { name: /cloudformation\.yml 편집기/ }), { target: { value: CHANGED } });
    // 변경이 생기면 같은 URL 의 가드 항목을 쌓는다
    await waitFor(() => expect((window.history.state as Record<string, unknown> | null)?.[HISTORY_GUARD_KEY]).toBeTruthy());
    expect(window.history.length).toBe(lenBefore + 1);
    act(() => window.history.back());
    expect(await screen.findByRole("dialog", { name: "저장하지 않은 변경이 있습니다" })).toBeTruthy();
    // 가드가 다시 쌓여 URL 이 그대로다
    expect(window.location.href).toBe(startUrl);
    expect((window.history.state as Record<string, unknown> | null)?.[HISTORY_GUARD_KEY]).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
    expect((screen.getByRole("textbox", { name: /cloudformation\.yml 편집기/ }) as HTMLTextAreaElement).value).toBe(CHANGED);
    expect(window.location.href).toBe(startUrl);
    // 다시 뒤로 → 버리기: 가드와 현재 항목을 건너 이전 페이지로
    const go = vi.spyOn(window.history, "go");
    act(() => window.history.back());
    await screen.findByRole("dialog", { name: "저장하지 않은 변경이 있습니다" });
    fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
    expect(go).toHaveBeenCalledWith(-2);
    go.mockRestore();
  });

  it("편집 취소(변경 없음)·저장하면 가드 항목을 치운다", async () => {
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByRole("textbox", { name: "cloudformation.yml 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    const ta = screen.getByRole("textbox", { name: /cloudformation\.yml 편집기/ }) as HTMLTextAreaElement;
    const original = ta.value;
    fireEvent.change(ta, { target: { value: CHANGED } });
    await waitFor(() => expect((window.history.state as Record<string, unknown> | null)?.[HISTORY_GUARD_KEY]).toBeTruthy());
    const back = vi.spyOn(window.history, "back");
    fireEvent.change(ta, { target: { value: original } });
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    back.mockRestore();
  });

  it("올바르지 않은 ID 는 요청하지 않고 안내 (AC-40)", async () => {
    renderWith(<SnapshotDetailPage id="../../etc" />);
    expect(screen.getByText("올바른 스냅샷 ID가 아닙니다")).toBeTruthy();
    expect(calls.some((c) => c.path.includes("etc"))).toBe(false);
  });

  it("삭제: ID 입력 후 DELETE ?confirm=<id>, 목록으로 이동 (AC-37·38)", async () => {
    handler = (c) =>
      c.method === "DELETE" && c.path === "/aws-snapshots/20260919-031500"
        ? { dataSource: "mock", generatedAt: "", trashItem: TRASH.items[0], summary: snapshotSummary(), revision: 3 }
        : defaultHandler(c);
    renderWith(<SnapshotDetailPage id="20260919-031500" />);
    await screen.findByText("판단 사유");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const dlg = await screen.findByRole("dialog", { name: "스냅샷을 휴지통으로 옮길까요?" });
    expect(within(dlg).getByText(/git 변경으로 남습니다/)).toBeTruthy();
    expect(within(dlg).getByText(/raw 데이터는 옮기지 않습니다/)).toBeTruthy();
    const btn = within(dlg).getByRole("button", { name: /휴지통으로 이동/ });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "20260919-031500" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "휴지통으로 이동" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/snapshots?trashed=20260919-031500"));
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.query).toEqual({ confirm: "20260919-031500" });
    expect(del.body).toBeUndefined();
  });
});

describe("휴지통 /snapshots/trash", () => {
  it("복원: POST restore {} , 같은 ID 있으면 거부 안내 (AC-38)", async () => {
    const exists = await httpError(409, "SNAPSHOT_ID_EXISTS");
    handler = (c) => (c.path.endsWith("/restore") ? exists : defaultHandler(c));
    renderWith(<TrashPage />);
    await screen.findByText("테스트 내보내기");
    fireEvent.click(screen.getByRole("button", { name: "복원" }));
    const dlg = await screen.findByRole("dialog", { name: "스냅샷을 복원할까요?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "복원" }));
    expect(await within(dlg).findByText("같은 ID의 스냅샷이 이미 있어 복원할 수 없습니다.")).toBeTruthy();
    const c = calls.find((x) => x.path.endsWith("/restore"))!;
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({});
  });

  it("영구 삭제: ID 입력 확인 후 DELETE ?confirm=<snapshotId>", async () => {
    handler = (c) => (c.method === "DELETE" ? { dataSource: "mock", generatedAt: "", purged: true, trashId: "x", revision: 2 } : defaultHandler(c));
    renderWith(<TrashPage />);
    await screen.findByText("테스트 내보내기");
    fireEvent.click(screen.getByRole("button", { name: "영구 삭제" }));
    const dlg = await screen.findByRole("dialog", { name: "영구 삭제할까요?" });
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: "20260901-000000" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "영구 삭제" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.path).toBe("/aws-snapshots/trash/20260901-000000__20260910T010203000Z");
    expect(del.query).toEqual({ confirm: "20260901-000000" });
    expect(await screen.findByText("휴지통의 20260901-000000을 영구 삭제했습니다.")).toBeTruthy();
  });
});
