// @vitest-environment jsdom
/**
 * k8s-snapshot 페이지 통합 (가짜 스트림 저장소 + 계약 예시 모양의 가짜 REST).
 * backend 구현 전이라 계약(docs/api/k8s-snapshot.md) 모양 픽스처로 요청 경로·메서드·본문·쿼리와 화면 흐름을 확인한다.
 */
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  driftBadge,
  driftResponse,
  K8S_TRASH,
  k8sCheck,
  k8sDetailResponse,
  k8sFileResponse,
  k8sListResponse,
  k8sSummary,
  LAST_RESULT_OK,
  menuPayload,
  MISMATCH,
  NOT_COMPUTED,
} from "../__fixtures__/k8s-snapshots";
import type { StreamEnvelope } from "../common/types";
import type { ConnectionInfo, StreamStore } from "../stream/client";
import { applyBatch, initialStreamState, type StreamState } from "../stream/reducer";
import { StreamProvider, type StreamStoreLike } from "../stream/StreamProvider";
import { K8sDetailPage } from "./K8sDetailPage";
import { K8sListPage } from "./K8sListPage";
import { K8sTrashPage } from "./K8sTrashPage";
import type { K8sSnapshotSummary } from "./types";

// 전체 실행에서 워커가 겹쳐도 긴 흐름이 기본 1초 제한에 걸리지 않게
configure({ asyncUtilTimeout: 3000 });

const push = vi.fn();
const replace = vi.fn();
let searchParams = new URLSearchParams();
let pathname = "/snapshots/k8s";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => pathname,
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

const ID = "20260918-230000";
const PG = "data/statefulsets/postgres.yaml";

function defaultHandler(c: Call): unknown {
  if (c.path === "/k8s-snapshots" && c.method === "GET") return k8sListResponse();
  if (c.path === "/k8s-snapshots/trash" && c.method === "GET") return K8S_TRASH;
  if (c.path === `/k8s-snapshots/${ID}` && c.method === "GET") return k8sDetailResponse();
  if (c.path === `/k8s-snapshots/${ID}/file` && c.method === "GET") return k8sFileResponse(String(c.query?.path));
  if (c.path === `/k8s-snapshots/${ID}/drift` && c.method === "GET") return driftResponse({ snapshotId: ID });
  if (c.path === "/k8s-snapshots/scan-rules") return { dataSource: "mock", generatedAt: "", profile: "k8s", allowMarker: "snapshot-scan: allow", scannableExtensions: [], rules: [] };
  if (c.path === "/snapshot-menu") return { dataSource: "mock", generatedAt: "", ...menuPayload() };
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
  pathname = "/snapshots/k8s";
  push.mockReset();
  replace.mockReset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let seq = 0;
function streamWith(summary: K8sSnapshotSummary | null, extra: { type: string; topic: string; payload: unknown }[] = []): StreamState {
  const now = Date.now();
  const events = [
    {
      type: "stream.hello",
      envelope: {
        seq: ++seq,
        topic: "stream" as StreamEnvelope["topic"],
        emittedAt: "",
        payload: { streamId: "s", dataSource: "mock", serverTime: new Date().toISOString(), heartbeatSec: 15, topics: ["overview", "snapshot-menu", "k8s-snapshots"], sources: [] },
      },
      receivedAt: now,
    },
    { type: "snapshot-menu.snapshot", envelope: { seq: ++seq, topic: "snapshot-menu" as const, emittedAt: "", payload: menuPayload() as never }, receivedAt: now },
  ];
  if (summary) {
    events.push({ type: "k8s-snapshots.snapshot", envelope: { seq: ++seq, topic: "k8s-snapshots" as never, emittedAt: "", payload: { revision: 1, summary } as never }, receivedAt: now });
  }
  for (const e of extra) events.push({ type: e.type, envelope: { seq: ++seq, topic: e.topic as never, emittedAt: "", payload: e.payload as never }, receivedAt: now });
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
  topics: ["overview", "snapshot-menu", "k8s-snapshots"],
};

function renderWith(ui: ReactNode, summary: K8sSnapshotSummary | null = k8sSummary(), extra: { type: string; topic: string; payload: unknown }[] = []) {
  const snap: StreamStore = { stream: streamWith(summary, extra), connection: openConn };
  const retain = vi.fn(() => () => {});
  const store: StreamStoreLike = { subscribe: () => () => {}, getSnapshot: () => snap, retain, reconnectNow: vi.fn() };
  const r = render(<StreamProvider client={store}>{ui}</StreamProvider>);
  return { ...r, retain };
}

// ---------------------------------------------------------------- 목록

describe("목록 /snapshots/k8s", () => {
  it("머리 `스냅샷` + AWS/Kubernetes 탭(현재 Kubernetes), 파일·드리프트 두 열, 내보내기·적용 버튼 없음 (AC-K16·K20)", async () => {
    const { retain } = renderWith(<K8sListPage />);
    await screen.findByText("EKS 1.34 업그레이드 전");
    expect(screen.getByRole("heading", { level: 1, name: "스냅샷" })).toBeTruthy();
    const tabs = screen.getByRole("navigation", { name: "스냅샷 종류" });
    const k8sTab = within(tabs).getByRole("link", { name: /Kubernetes/ });
    expect(k8sTab.getAttribute("aria-current")).toBe("page");
    expect(k8sTab.getAttribute("href")).toBe("/snapshots/k8s");
    expect(k8sTab.textContent).toContain("차이 3");
    expect(within(tabs).getByRole("link", { name: /AWS/ }).getAttribute("href")).toBe("/snapshots");
    // 토픽 구독
    expect(retain).toHaveBeenCalledWith(["k8s-snapshots"]);
    const table = screen.getByRole("table", { name: /Kubernetes 스냅샷 목록/ });
    const head = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(head.slice(0, 2)).toEqual(["파일", "드리프트"]);
    // 드리프트 셀: 차이 3건 + 2줄, 계산 안 함, 다른 클러스터, 지난 결과
    expect(within(table).getByText("차이 3건")).toBeTruthy();
    expect(within(table).getByText("변경 1 · 삭제 1 · 추가 1")).toBeTruthy();
    expect(within(table).getAllByText("계산 안 함").length).toBeGreaterThanOrEqual(2);
    expect(within(table).getAllByText("다른 클러스터").length).toBeGreaterThanOrEqual(2);
    expect(within(table).getByText(/^지난 결과 차이 없음 · /)).toBeTruthy();
    // 드리프트 셀은 드리프트 탭 링크
    const driftLink = within(table).getByText("차이 3건").closest("a")!;
    expect(driftLink.getAttribute("href")).toBe("/snapshots/k8s/20260919-061000?view=drift");
    expect(within(table).getByText("커밋 금지")).toBeTruthy();
    expect(within(table).getByText("비밀값 의심 1건 (k8s-env-literal)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /내보내기$|적용|커밋하기/ })).toBeNull();
    // 요청은 API 정렬 값 그대로
    const listCall = calls.find((c) => c.path === "/k8s-snapshots")!;
    expect(listCall.query).toMatchObject({ sort: "snapshotAt:desc" });
    // 요약 띠: 최신 드리프트 + 대시보드 클러스터
    expect(screen.getByText("최신 드리프트")).toBeTruthy();
    expect(screen.getByText("대시보드 클러스터")).toBeTruthy();
  });

  it("URL 필터 값 = API 값 (drift·cluster·status)", async () => {
    searchParams = new URLSearchParams("drift=warning,not_computed&cluster=same&status=critical&sort=status:desc");
    renderWith(<K8sListPage />);
    await screen.findByText("EKS 1.34 업그레이드 전");
    const c = calls.find((x) => x.path === "/k8s-snapshots")!;
    expect(c.query).toMatchObject({ drift: "warning,not_computed", cluster: "same", status: "critical", sort: "status:desc" });
  });

  it("`k8s-snapshots.drift` 이벤트가 오면 해당 행 배지만 바뀐다(목록 재조회 없이)", async () => {
    renderWith(<K8sListPage />, k8sSummary(), [
      { type: "k8s-snapshots.drift", topic: "k8s-snapshots", payload: { snapshotId: "20260919-020000", trigger: "requested", drift: driftBadge(), autoTargetId: "20260919-061000" } },
    ]);
    await screen.findByText("EKS 1.34 업그레이드 전");
    const table = screen.getByRole("table", { name: /Kubernetes 스냅샷 목록/ });
    expect(within(table).getAllByText("차이 3건")).toHaveLength(2);
  });

  it("0개면 빈 상태 + CLI 안내(서버 cli: 설정 이름·종료코드 0~4, 복사만) (명세 5.6)", async () => {
    handler = (c) => (c.path === "/k8s-snapshots" ? k8sListResponse({ items: [] }) : defaultHandler(c));
    renderWith(<K8sListPage />);
    await screen.findByText("아직 Kubernetes 스냅샷이 없습니다");
    expect(screen.getByText("npm run export --prefix deploy/k8s-snapshot")).toBeTruthy();
    expect(screen.getByText("KUBE_CONTEXT")).toBeTruthy();
    expect(screen.getByText("필수")).toBeTruthy();
    expect(screen.getByText("부분 성공 — 일부 종류를 읽지 못함 (metadata.kinds 확인)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^내보내기$|실행/ })).toBeNull();
  });

  it("설정 없음이면 예시 없이 UnknownState + k8s 경로 안내 (AC-K26)", async () => {
    const nc = k8sSummary({
      status: { status: "unknown", reasons: [{ code: "SOURCE_NOT_CONFIGURED", text: "스냅샷 폴더가 설정되지 않았습니다 (K8S_SNAPSHOT_DIR)", status: "unknown" }], updatedAt: null, statusChangedAt: null, stale: false },
      root: {
        configured: false,
        displayPath: null,
        state: "not_configured",
        setup: { envVar: "K8S_SNAPSHOT_DIR", dockerMount: "./deploy/k8s-snapshot/snapshots:/data/k8s-snapshots", localExample: "K8S_SNAPSHOT_DIR=../../deploy/k8s-snapshot/snapshots", reasonText: "스냅샷 폴더가 설정되지 않았습니다 (K8S_SNAPSHOT_DIR)" },
      },
    });
    handler = (c) => (c.path === "/k8s-snapshots" ? k8sListResponse({ items: [], summary: nc, dataSource: "live" }) : defaultHandler(c));
    renderWith(<K8sListPage />, nc);
    expect(await screen.findByText("알 수 없음 (스냅샷 폴더가 설정되지 않았습니다)")).toBeTruthy();
    expect(screen.getByText("K8S_SNAPSHOT_DIR=../../deploy/k8s-snapshot/snapshots")).toBeTruthy();
  });

  it("새로고침은 POST refresh {} (JSON)", async () => {
    handler = (c) => (c.path === "/k8s-snapshots/refresh" ? { dataSource: "mock", generatedAt: "", revision: 2, summary: k8sSummary(), cli: {} } : defaultHandler(c));
    renderWith(<K8sListPage />);
    await screen.findByText("EKS 1.34 업그레이드 전");
    fireEvent.click(screen.getByRole("button", { name: "지금 다시 읽기" }));
    await waitFor(() => expect(calls.some((c) => c.path === "/k8s-snapshots/refresh")).toBe(true));
    expect(calls.find((c) => c.path === "/k8s-snapshots/refresh")).toMatchObject({ method: "POST", body: {} });
  });
});

// ---------------------------------------------------------------- 상세·편집

describe("상세 /snapshots/k8s/[id]", () => {
  beforeEach(() => {
    pathname = `/snapshots/k8s/${ID}`;
  });

  it("탭 6개, 파일 상태 lg + 드리프트 줄, 오류가 있으면 스캔 보기 + 첫 발견 파일(path 쿼리)을 연다 (디자인 4·5.1)", async () => {
    renderWith(<K8sDetailPage id={ID} />);
    await screen.findByText("판단 사유");
    const tablist = screen.getByRole("tablist", { name: "스냅샷 상세" });
    expect(within(tablist).getAllByRole("tab").map((t) => t.textContent?.replace(/[0-9,]|발견|차이|건|저장 안 됨/g, "").trim())).toEqual([
      "파일",
      "드리프트",
      "D 보기",
      "리소스 수",
      "Secret 참조",
      "메타데이터",
    ]);
    expect(screen.getByText("대시보드는 커밋·적용하지 않습니다")).toBeTruthy();
    expect(screen.getByText(/복원 순서: 매니페스트 적용 → 빈 StatefulSet 기동 → 데이터 복원/)).toBeTruthy();
    expect(screen.getByText("Helm 관리 2개")).toBeTruthy();
    // 드리프트 줄: 계산 안 함 + 드리프트 계산 버튼
    expect(screen.getAllByText("계산 안 함").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "드리프트 계산" })).toBeTruthy();
    // 스캔 보기 + 첫 발견 파일
    expect(await screen.findByRole("textbox", { name: "postgres.yaml 내용" })).toBeTruthy();
    const fileCall = calls.find((c) => c.path === `/k8s-snapshots/${ID}/file`)!;
    expect(fileCall.query).toEqual({ path: PG });
    expect(screen.getByText("npm run scan --prefix deploy/k8s-snapshot -- snapshots/20260918-230000")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /내보내기$|적용|커밋하기/ })).toBeNull();
  });

  it("metadata.json 은 보기 전용: 편집 버튼 없음 (AC-K22)", async () => {
    searchParams = new URLSearchParams("file=metadata.json");
    renderWith(<K8sDetailPage id={ID} />);
    await screen.findByRole("textbox", { name: "metadata.json 내용" });
    expect(screen.getAllByText("보기 전용").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "편집" })).toBeNull();
  });

  it("목록에 없는 경로는 요청하지 않고 안내", async () => {
    searchParams = new URLSearchParams("file=../../etc/passwd");
    renderWith(<K8sDetailPage id={ID} />);
    expect(await screen.findByText("이 스냅샷에 없는 파일입니다.")).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith("/file"))).toBe(false);
  });

  it("편집 → 저장: check(path 쿼리) → 경로 불일치·비밀값 확인 창 → PUT confirm, 드리프트 재계산 안내 (AC-K22·K23·K37)", async () => {
    let putCall: Call | undefined;
    const content = "apiVersion: apps/v1\nkind: StatefulSet\nmetadata:\n  name: postgres-v2\n";
    handler = (c) => {
      if (c.path === `/k8s-snapshots/${ID}/file/check`) {
        return {
          dataSource: "mock",
          generatedAt: "",
          snapshotId: ID,
          path: PG,
          check: k8sCheck({
            findings: [{ file: PG, fileType: "resource", line: 41, rule: "k8s-env-literal", severity: "error", message: "환경 변수 리터럴 (ex****(16자))" }],
            errors: 1,
            identity: {
              expected: { apiGroup: "apps", kind: "StatefulSet", namespace: "data", name: "postgres" },
              actual: { apiGroup: "apps", apiVersion: "apps/v1", kind: "StatefulSet", namespace: "data", name: "postgres-v2" },
              matches: false,
            },
            confirmationsRequired: ["secret_errors", "identity_changed"],
          }),
        };
      }
      if (c.path === `/k8s-snapshots/${ID}/file` && c.method === "PUT") {
        putCall = c;
        return {
          dataSource: "mock",
          generatedAt: "",
          saved: true,
          snapshotId: ID,
          path: PG,
          version: `sha256:${"f".repeat(64)}`,
          modifiedAt: "",
          sizeBytes: 10,
          check: k8sCheck(),
          rescan: { before: { errors: 1, warnings: 0 }, after: { errors: 1, warnings: 0 } },
          snapshot: { ...k8sListResponse().items[2] },
          driftRecompute: "scheduled",
          revision: 18,
        };
      }
      return defaultHandler(c);
    };
    renderWith(<K8sDetailPage id={ID} />);
    await screen.findByRole("textbox", { name: "postgres.yaml 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    expect(await screen.findByText("이 스냅샷 원본을 직접 고칩니다")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: /postgres\.yaml 편집기/ }), { target: { value: content } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const dlg = await screen.findByRole("dialog", { name: "비밀값 의심 1건이 남아 있습니다" });
    expect(within(dlg).getByText("파일 경로와 리소스가 다릅니다")).toBeTruthy();
    expect(within(dlg).getByText("StatefulSet data/postgres-v2")).toBeTruthy();
    const check = calls.find((c) => c.path.endsWith("/file/check"))!;
    expect(check).toMatchObject({ method: "POST", query: { path: PG }, body: { content, baseVersion: `sha256:${"b".repeat(64)}` } });
    fireEvent.click(within(dlg).getByRole("button", { name: "커밋 금지 상태로 저장" }));
    await waitFor(() => expect(putCall).toBeDefined());
    expect(putCall).toMatchObject({ query: { path: PG }, body: { content, baseVersion: `sha256:${"b".repeat(64)}`, confirm: ["secret_errors", "identity_changed"] } });
    expect(await screen.findByText("드리프트를 다시 계산합니다 (30초 이내).")).toBeTruthy();
    expect(screen.getByText("재스캔: 오류 1 → 1, 경고 0 → 0")).toBeTruthy();
  });

  it("PUT 422 면 details.missing 을 합쳐 다시 묻고, 409 는 충돌 창(덮어쓰기 없음)", async () => {
    const need = await httpError(422, "SNAPSHOT_CONFIRMATION_REQUIRED", { missing: ["multi_document"], check: k8sCheck({ documents: 2, confirmationsRequired: ["multi_document"] }) });
    const conflict = await httpError(409, "SNAPSHOT_VERSION_CONFLICT", { path: PG });
    let puts = 0;
    handler = (c) => {
      if (c.path.endsWith("/file/check")) return { dataSource: "mock", generatedAt: "", snapshotId: ID, path: PG, check: k8sCheck() };
      if (c.path === `/k8s-snapshots/${ID}/file` && c.method === "PUT") {
        puts += 1;
        return puts === 1 ? need : conflict;
      }
      return defaultHandler(c);
    };
    renderWith(<K8sDetailPage id={ID} />);
    await screen.findByRole("textbox", { name: "postgres.yaml 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: /postgres\.yaml 편집기/ }), { target: { value: "a: 1\n---\nb: 2\n" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const dlg = await screen.findByRole("dialog", { name: "저장 전에 확인하세요" });
    expect(within(dlg).getByText("문서 2개가 들어 있습니다 (--- 구분)")).toBeTruthy();
    fireEvent.click(within(dlg).getByRole("button", { name: "저장" }));
    const cf = await screen.findByRole("dialog", { name: "다른 곳에서 파일이 바뀌었습니다" });
    expect(within(cf).queryByRole("button", { name: /덮어쓰기|강제/ })).toBeNull();
    const second = calls.filter((c) => c.method === "PUT")[1];
    expect((second.body as { confirm: string[] }).confirm).toEqual(["multi_document"]);
  });

  it("편집 중 다른 상세 탭으로 가도 편집 내용은 남고(확인 창 없음), 다른 파일을 열면 확인한다 (디자인 4.5)", async () => {
    renderWith(<K8sDetailPage id={ID} />);
    await screen.findByRole("textbox", { name: "postgres.yaml 내용" });
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: /postgres\.yaml 편집기/ }), { target: { value: "changed\n" } });
    fireEvent.click(screen.getByRole("tab", { name: /리소스 수/ }));
    expect(await screen.findByRole("heading", { name: "종류별" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "저장하지 않은 변경이 있습니다" })).toBeNull();
    // URL 은 replace 로 view 만 바뀐다
    expect(replace).toHaveBeenCalledWith(`/snapshots/k8s/${ID}?view=counts`, { scroll: false });
    fireEvent.click(screen.getByRole("tab", { name: /파일/ }));
    const ta = (await screen.findByRole("textbox", { name: /postgres\.yaml 편집기/ })) as HTMLTextAreaElement;
    expect(ta.value).toBe("changed\n");
    // 리소스 트리에서 다른 파일 → 확인
    fireEvent.click(screen.getByRole("radio", { name: /리소스/ }));
    const api = await screen.findByRole("treeitem", { name: /^api, Deployment/ });
    fireEvent.click(api);
    expect(await screen.findByRole("dialog", { name: "저장하지 않은 변경이 있습니다" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
    expect((screen.getByRole("textbox", { name: /postgres\.yaml 편집기/ }) as HTMLTextAreaElement).value).toBe("changed\n");
  });

  it("Secret 참조 탭: 이름·키 이름만, 참조 방식 문구 / 메타데이터 탭: 클러스터 ID 같음", async () => {
    searchParams = new URLSearchParams("view=secrets");
    renderWith(<K8sDetailPage id={ID} />);
    expect(await screen.findByText("복원 전에 이 Secret들을 별도 보관소에서 만들어야 합니다")).toBeTruthy();
    expect(screen.getByText("postgres-credentials")).toBeTruthy();
    expect(screen.getByText("POSTGRES_PASSWORD")).toBeTruthy();
    expect(screen.getByText("env 키 참조")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /메타데이터/ }));
    expect(await screen.findByText("대시보드가 연결된 클러스터와 같음")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "종류별 내보내기 결과" })).toBeTruthy();
  });

  it("올바르지 않은 ID 는 요청하지 않는다", () => {
    renderWith(<K8sDetailPage id="../../etc" />);
    expect(screen.getByText("올바른 스냅샷 ID가 아닙니다")).toBeTruthy();
    expect(calls.some((c) => c.path.includes("etc"))).toBe(false);
  });

  it("삭제: ID 입력 후 DELETE ?confirm=<id>, 폴더 요약, k8s 목록으로", async () => {
    handler = (c) =>
      c.method === "DELETE" && c.path === `/k8s-snapshots/${ID}`
        ? { dataSource: "mock", generatedAt: "", trashItem: { ...K8S_TRASH.items[0], snapshotId: ID }, summary: k8sSummary(), revision: 3 }
        : defaultHandler(c);
    renderWith(<K8sDetailPage id={ID} />);
    await screen.findByText("판단 사유");
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const dlg = await screen.findByRole("dialog", { name: "스냅샷을 휴지통으로 옮길까요?" });
    expect(within(dlg).getByText("폴더 안 파일 38개 · 1.4 MB")).toBeTruthy();
    fireEvent.change(within(dlg).getByRole("textbox"), { target: { value: ID } });
    fireEvent.click(within(dlg).getByRole("button", { name: "휴지통으로 이동" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/snapshots/k8s?trashed=${ID}`));
    expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ query: { confirm: ID }, body: undefined });
  });
});

// ---------------------------------------------------------------- 드리프트 탭

describe("상세 드리프트 탭 (?view=drift)", () => {
  beforeEach(() => {
    pathname = `/snapshots/k8s/${ID}`;
    searchParams = new URLSearchParams("view=drift");
  });

  it("요약·목록·필드 차이(가린 값·숨긴 차이 그룹)·명령(복사만), 추가됨에는 명령 없음, 삭제 명령 없음 (AC-K30·K31·K38·K39)", async () => {
    renderWith(<K8sDetailPage id={ID} />);
    expect(await screen.findByRole("region", { name: "드리프트 요약" })).toBeTruthy();
    expect(screen.getByText("대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요.")).toBeTruthy();
    expect(calls.find((c) => c.path === `/k8s-snapshots/${ID}/drift`)?.method).toBe("GET");
    // 첫 리소스(api, 변경됨) 선택
    expect(await screen.findByText("spec.template.spec.containers[api].image".replace(/\./g, ".") , { exact: false })).toBeTruthy();
    expect(screen.getByText("값 다름 (de****(5자))")).toBeTruthy();
    expect(screen.getByText(/숨긴 차이 2건/)).toBeTruthy();
    expect(screen.getByText("kubectl diff -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/deployments/api.yaml")).toBeTruthy();
    // 서버 counts.uncomparable 그대로 (칩 합계를 다시 세지 않는다)
    expect(screen.getByText("비교 불가 11개")).toBeTruthy();
    expect(document.body.textContent).not.toContain("kubectl delete");
    // 추가됨 선택
    fireEvent.click(screen.getByRole("treeitem", { name: /^payments/ }));
    expect(await screen.findByText("스냅샷에 없는 리소스입니다")).toBeTruthy();
    expect(screen.queryByText(/kubectl apply -f .*payments/)).toBeNull();
    expect(replace).toHaveBeenCalledWith(`/snapshots/k8s/${ID}?view=drift&res=apps%2FDeployment%2Fprod%2Fpayments`, { scroll: false });
  });

  it("계산 안 함 → `드리프트 계산` = POST {force:true}, 409 K8S_DRIFT_UNAVAILABLE 이면 배지를 다시 조회 (AC-K36)", async () => {
    let gets = 0;
    const unavailable = await httpError(409, "K8S_DRIFT_UNAVAILABLE", { reasonCode: "CLUSTER_SYNCING", reasonText: "클러스터 동기화 중" });
    handler = (c) => {
      if (c.path === `/k8s-snapshots/${ID}/drift` && c.method === "GET") {
        gets += 1;
        return driftResponse({ snapshotId: ID, drift: NOT_COMPUTED, resources: [], uncomparable: [] });
      }
      if (c.path === `/k8s-snapshots/${ID}/drift` && c.method === "POST") return unavailable;
      return defaultHandler(c);
    };
    renderWith(<K8sDetailPage id={ID} />);
    expect(await screen.findByText("이 스냅샷은 드리프트를 자동으로 계산하지 않습니다")).toBeTruthy();
    const before = gets;
    const btns = screen.getAllByRole("button", { name: "드리프트 계산" });
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path.endsWith("/drift"))).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/drift"))?.body).toEqual({ force: true });
    await waitFor(() => expect(gets).toBeGreaterThan(before));
  });

  it("지난 결과(전체 결과 있음) → `지난 결과 보기` → 점선 카드 + 안내, `다시 계산` (디자인 6.8)", async () => {
    handler = (c) =>
      c.path === `/k8s-snapshots/${ID}/drift` && c.method === "GET"
        ? driftResponse({ snapshotId: ID, drift: { ...LAST_RESULT_OK, lastResultStatus: "warning", counts: driftBadge().counts } })
        : defaultHandler(c);
    renderWith(<K8sDetailPage id={ID} />);
    expect(await screen.findByText(/^지난 계산 .* · 차이 3건$/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "지난 결과 보기" }));
    expect(await screen.findByText(/^지난 결과입니다/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "드리프트 요약" }).getAttribute("data-state")).toBe("lastResult");
  });

  it("다른 클러스터면 알 수 없음 + 계산 버튼 비활성 (AC-K35)", async () => {
    handler = (c) =>
      c.path === `/k8s-snapshots/${ID}/drift` && c.method === "GET"
        ? driftResponse({ snapshotId: ID, drift: MISMATCH, resources: [], snapshotCluster: { id: "x", context: "staging", name: "staging-eks", serverVersion: null } })
        : defaultHandler(c);
    const blocked = { allowed: false, reasonCode: "CLUSTER_MISMATCH", reasonText: "다른 클러스터의 스냅샷" };
    const base = k8sDetailResponse();
    handler = ((prev) => (c: Call) =>
      c.path === `/k8s-snapshots/${ID}` && c.method === "GET"
        ? { ...base, snapshot: { ...base.snapshot, drift: MISMATCH, actions: { ...base.snapshot.actions, computeDrift: blocked } } }
        : prev(c))(handler);
    renderWith(<K8sDetailPage id={ID} />);
    expect(await screen.findByText("알 수 없음 (다른 클러스터의 스냅샷)")).toBeTruthy();
    expect(screen.getByText("staging-eks")).toBeTruthy();
    const btn = screen.getAllByRole("button", { name: /^드리프트 계산/ }).find((b) => b.getAttribute("aria-disabled") === "true");
    expect(btn).toBeTruthy();
  });

  it("요청 계산(lease)이면 탭이 열린 동안 60초마다 POST {force:false}로 임대 갱신, 떠나면 멈춤 (계약 10.8)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    handler = (c) => {
      if (c.path === `/k8s-snapshots/${ID}/drift` && c.method === "GET") {
        return driftResponse({ snapshotId: ID, drift: driftBadge({ mode: "on_demand" }), lease: { expiresAt: "", renewAfterSec: 60 } });
      }
      if (c.path === `/k8s-snapshots/${ID}/drift` && c.method === "POST") {
        return driftResponse({ snapshotId: ID, generatedAt: new Date().toISOString(), drift: driftBadge({ mode: "on_demand" }), lease: { expiresAt: "", renewAfterSec: 60 } });
      }
      return defaultHandler(c);
    };
    const { unmount } = renderWith(<K8sDetailPage id={ID} />);
    expect(await screen.findByText("요청 계산 · 이 화면을 떠나면 최대 2분 뒤 갱신을 멈춥니다")).toBeTruthy();
    const posts = () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/drift"));
    expect(posts()).toHaveLength(0);
    // 임대 타이머가 걸린 뒤(effect 반영) 60초 진행
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].body).toEqual({ force: false });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(180_000);
    });
    expect(posts()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 휴지통

describe("휴지통 /snapshots/k8s/trash", () => {
  it("복원 POST restore {}, 같은 ID 면 거부 안내 / 클러스터 열", async () => {
    const exists = await httpError(409, "SNAPSHOT_ID_EXISTS");
    handler = (c) => (c.path.endsWith("/restore") ? exists : defaultHandler(c));
    renderWith(<K8sTrashPage />);
    await screen.findByText("옛 스냅샷");
    expect(screen.getByRole("link", { name: "Kubernetes 스냅샷" }).getAttribute("href")).toBe("/snapshots/k8s");
    expect(screen.getByText("30개 · 117 KB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "복원" }));
    const dlg = await screen.findByRole("dialog", { name: "스냅샷을 복원할까요?" });
    fireEvent.click(within(dlg).getByRole("button", { name: "복원" }));
    expect(await within(dlg).findByText("같은 ID의 스냅샷이 이미 있어 복원할 수 없습니다.")).toBeTruthy();
    expect(calls.find((x) => x.path.endsWith("/restore"))).toMatchObject({ method: "POST", body: {} });
  });
});
