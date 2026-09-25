// @vitest-environment jsdom
/**
 * 주요 페이지 렌더 (가짜 스트림 저장소 + 계약 예시 모양의 가짜 REST).
 */
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildFixtures } from "./__fixtures__/fixtures";
import { AdvisorPage } from "./architecture-advisor/AdvisorPage";
import { CostPage } from "./aws-cost/CostPage";
import { DbPage } from "./cluster-status/DbPage";
import { NodesPage } from "./cluster-status/NodesPage";
import { OverviewPage } from "./cluster-status/OverviewPage";
import { PodsPage } from "./cluster-status/PodsPage";
import { ShellClient } from "./shell/ShellClient";
import type { StreamEnvelope } from "./common/types";
import type { ConnectionInfo, StreamStore } from "./stream/client";
import { applyBatch, initialStreamState, type StreamState } from "./stream/reducer";
import { StreamProvider, type StreamStoreLike } from "./stream/StreamProvider";

// 안정화(flake): 페이지는 정적 import(테스트마다 동적 import·변환을 기다리지 않음), 비동기 대기 3초
configure({ asyncUtilTimeout: 3000 });

const NOW = Date.now();
const fx = buildFixtures(NOW);

// URL 쿼리를 테스트마다 바꿀 수 있게 홀더로 둔다 (노드 목록 `?role=`)
const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => nav.params,
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn(async (path: string, opts?: { query?: Record<string, unknown> }) => {
      const f = buildFixtures(Date.now());
      if (path === "/cost/rate-series") return f.rateSeries((opts?.query?.range as "7d") ?? "7d");
      if (path === "/advisor/prechecks") return f.prechecks;
      if (path === "/advisor/runs") return f.runs;
      if (path === `/advisor/runs/${f.failedRun.id}`) return { run: f.failedRun };
      if (path === "/mock/scenarios") return f.mockScenarios;
      if (path === "/cluster/metrics/series") return f.nodeSeries("x");
      throw new actual.ApiError("http", "not found", { url: path, status: 404, body: { statusCode: 404, code: "ROUTE_NOT_FOUND", message: "없음", path, timestamp: "" } });
    }),
  };
});

beforeAll(() => {
  // jsdom 에 없는 브라우저 API (차트·dialog)
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
  nav.params = new URLSearchParams();
  nav.push.mockClear();
  nav.replace.mockClear();
});

let seq = 0;
const ev = (type: string, payload: unknown, receivedAt = NOW) => ({
  type,
  envelope: { seq: ++seq, topic: type.split(".")[0] as StreamEnvelope["topic"], emittedAt: new Date(receivedAt).toISOString(), payload },
  receivedAt,
});

function streamState(patch: (s: StreamState) => StreamState = (s) => s): StreamState {
  return patch(
    applyBatch(initialStreamState, [
      ev("stream.hello", fx.hello),
      ev("overview.snapshot", fx.overview),
      ev("cluster.snapshot", fx.clusterSnapshot),
      ev("metrics.snapshot", fx.metricsSnapshot),
      ev("db.snapshot", fx.db),
      ev("cost.snapshot", fx.cost),
      ev("advisor.snapshot", fx.advisor),
    ]),
  );
}

const openConn: ConnectionInfo = {
  phase: "open",
  everOpened: true,
  attempt: 0,
  nextRetryAt: null,
  downSince: null,
  reconnectedAt: null,
  apiReachable: true,
  topics: ["overview", "cluster", "metrics", "db", "cost", "advisor"],
};

function fakeStore(stream: StreamState, connection: ConnectionInfo = openConn): StreamStoreLike {
  const snap: StreamStore = { stream, connection };
  return { subscribe: () => () => {}, getSnapshot: () => snap, retain: () => () => {}, reconnectNow: vi.fn() };
}

function renderWith(ui: ReactNode, store = fakeStore(streamState())) {
  return render(<StreamProvider client={store}>{ui}</StreamProvider>);
}

describe("개요 /", () => {
  it("요약 띠 전체 상태·판단 이유, 카드 5개, 지금 확인할 항목, 비용·어드바이저 요약", async () => {
    renderWith(<OverviewPage />);
    expect(screen.getByRole("heading", { level: 1, name: "개요" })).toBeTruthy();
    expect(screen.getAllByText("파드 prod / api-7f9c8d6b5-x2kq9 CrashLoopBackOff").length).toBeGreaterThan(0);
    for (const t of ["노드", "워크로드", "파드", "이벤트", "DB"]) expect(screen.getAllByRole("heading", { name: t }).length).toBeGreaterThan(0);
    expect(screen.getByText("Ready 5/6")).toBeTruthy();
    expect(screen.getByText("지금 확인할 항목")).toBeTruthy();
    expect(screen.getByText("CrashLoopBackOff · 최근 1시간 재시작 6회")).toBeTruthy();
    // 비용 요약: 추정은 ≈ + 추정 배지, 확정 배지
    expect(screen.getAllByText("추정").length).toBeGreaterThan(0);
    expect(screen.getAllByText("확정").length).toBeGreaterThan(0);
    expect(screen.getByText("$1.10/h")).toBeTruthy();
    // 어드바이저 요약: 사전 점검 요약 배지 문구
    expect(screen.getByText("높음 2건")).toBeTruthy();
    // 클러스터 CPU·메모리 카드와 임계선 라벨
    expect(screen.getByText("클러스터 CPU")).toBeTruthy();
    expect(screen.getAllByText("주의 75%").length).toBeGreaterThan(0);
  });

  it("요약 띠 노드 칸은 워커 기준이고 컨트롤 플레인은 부제로 따로 나온다 (AC-KOPS10)", async () => {
    renderWith(<OverviewPage />);
    // 마스터 3대를 더한 9/9 가 아니라 워커 기준 5/6
    expect(screen.getByText("노드 Ready (워커)")).toBeTruthy();
    expect(screen.getByText("5/6")).toBeTruthy();
    expect(screen.queryByText("8/9")).toBeNull();
    const sub = screen.getByRole("link", { name: /컨트롤 플레인 2\/3/ });
    expect(sub.getAttribute("href")).toBe("/cluster/nodes#control-plane");
  });

  it("개요 카드 6개 · 컨트롤 플레인이 맨 앞 (디자인 2.3)", async () => {
    renderWith(<OverviewPage />);
    for (const t of ["컨트롤 플레인", "노드", "워크로드", "파드", "이벤트", "DB"]) {
      expect(screen.getAllByRole("heading", { name: t }).length).toBeGreaterThan(0);
    }
    // 서버 값 그대로: 마스터 2/3 · 필수 구성요소 8/15
    expect(screen.getByText("마스터 2/3")).toBeTruthy();
    expect(screen.getByText("필수 구성요소 8/15")).toBeTruthy();
    expect(screen.getByText("컨트롤 플레인 보기").getAttribute("href")).toBe("/cluster/nodes#control-plane");
  });

  it("클러스터 CPU·메모리 카드에 `워커 기준` 칩 (합계에서 마스터가 빠진다, AC-KOPS12)", async () => {
    renderWith(<OverviewPage />);
    expect(screen.getAllByText("워커 기준").length).toBe(2);
  });

  it("요약 띠 클러스터 caption 은 FQDN 을 ResourceName kind=cluster 로 그린다 (shell.md 2.1)", async () => {
    const { container } = renderWith(<OverviewPage />);
    const meta = container.querySelector(".text-caption, [class*=stripMeta]");
    expect(meta?.textContent).toContain("prod.k8s.example.com");
    // 전체 이름은 스크린리더가 한 번 읽는다(가운데 말줄임이어도 값이 사라지지 않는다)
    expect(screen.getAllByText("prod.k8s.example.com").length).toBeGreaterThan(0);
  });

  it("heartbeat 가 45초 넘게 없으면 watch 기반 카드가 데이터 오래됨으로 바뀐다", async () => {
    renderWith(<OverviewPage />, fakeStore(streamState((s) => ({ ...s, lastHeartbeatAt: Date.now() - 60_000 }))));
    expect(screen.getAllByText(/데이터 오래됨/).length).toBeGreaterThan(0);
  });

  it("스냅샷 전에는 스켈레톤", async () => {
    const { container } = renderWith(<OverviewPage />, fakeStore(initialStreamState, { ...openConn, phase: "connecting", everOpened: false }));
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });
});

describe("노드 /cluster/nodes (kops-support)", () => {
  const rowNames = () =>
    within(screen.getByRole("table", { name: "노드 목록" }))
      .getAllByRole("row")
      .slice(1)
      .map((r) => r.textContent ?? "");

  it("기본은 워커만 그린다 — 마스터는 목록에 없다", async () => {
    renderWith(<NodesPage />);
    const names = rowNames();
    expect(names).toHaveLength(6);
    expect(names.some((t) => t.includes("i-0a1b2c3d4e5f67890"))).toBe(false);
    expect(screen.getByText("워커 6개 중 6개 표시")).toBeTruthy();
  });

  it("역할 칸 개수는 서버 role 로 나눈 값이고 화면이 더하지 않는다", async () => {
    renderWith(<NodesPage />);
    const roles = screen.getByRole("radiogroup", { name: "역할" });
    expect((within(roles).getByRole("radio", { name: /워커/ }) as HTMLInputElement).checked).toBe(true);
    expect(roles.textContent).toContain("워커");
    expect(roles.textContent).toContain("6");
    expect(roles.textContent).toContain("컨트롤 플레인");
    expect(roles.textContent).toContain("3");
    expect(roles.textContent).toContain("전체");
    expect(roles.textContent).toContain("9");
  });

  it("role=control_plane 이면 마스터만, 이름 칸에 컨트롤 플레인 칩", async () => {
    nav.params = new URLSearchParams("role=control_plane");
    renderWith(<NodesPage />);
    const names = rowNames();
    expect(names).toHaveLength(3);
    // kOps 노드 이름은 인스턴스 ID 형태다 (일반 클러스터 화면에서는 가명이 아니라 실제 이름)
    expect(names.every((t) => /i-0[0-9a-f]+/.test(t))).toBe(true);
    expect(screen.getAllByText("컨트롤 플레인").length).toBeGreaterThan(0);
    expect(screen.getByText("컨트롤 플레인 3개 중 3개 표시")).toBeTruthy();
  });

  it("role=all 이면 9대 전부", async () => {
    nav.params = new URLSearchParams("role=all");
    renderWith(<NodesPage />);
    expect(rowNames()).toHaveLength(9);
    expect(screen.getByText("노드 9개 중 9개 표시")).toBeTruthy();
  });

  it("모르는 role 값은 기본 워커로 떨어진다", async () => {
    nav.params = new URLSearchParams("role=master");
    renderWith(<NodesPage />);
    expect(rowNames()).toHaveLength(6);
  });

  it("컨트롤 플레인 섹션: 매트릭스 15칸을 서버 cellState 그대로 그린다 (빈 칸 없음)", async () => {
    const { container } = renderWith(<NodesPage />);
    const cells = container.querySelectorAll("[data-cell-state]");
    expect(cells).toHaveLength(15);
    const byState = (st: string) => container.querySelectorAll(`[data-cell-state="${st}"]`).length;
    // 서버가 확정한 값 그대로 — 화면이 조건을 조합하지 않는다
    expect(byState("ok")).toBe(8);
    expect(byState("crit")).toBe(1);
    expect(byState("missing")).toBe(1);
    // 마스터가 NotReady 면 파드가 Running 이어도 5칸 전부 노드 미보고 (AC-KOPS21)
    expect(byState("notReporting")).toBe(5);
  });

  it("매트릭스 로그 버튼은 **스트림으로 온 서버 `logHref` 그대로** — `podKey` 폴백 없음(logs 통합 3차)", async () => {
    const { container } = renderWith(<NodesPage />);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/logs"]')].map((a) => a.getAttribute("href"));
    const expected = fx.clusterSnapshot.controlPlane.components.items
      .filter((c) => c.logHref && c.cellState !== "missing")
      .map((c) => c.logHref);
    expect(expected.length).toBeGreaterThan(10);
    expect(links.sort()).toEqual([...expected].sort());
    // 서버가 링크를 주지 않으면 화면이 `podKey`로 만들지 않는다
    const noLinks = structuredClone(fx.clusterSnapshot);
    for (const c of noLinks.controlPlane.components.items) c.logHref = null;
    cleanup();
    const { container: c2 } = renderWith(
      <NodesPage />,
      fakeStore(streamState((st) => applyBatch(st, [ev("cluster.snapshot", noLinks)]))),
    );
    expect(c2.querySelectorAll('a[href^="/logs"]')).toHaveLength(0);
  });

  it("잘리는 셀 문구는 서버 cellTooltip 으로 전체를 준다 (툴팁 없이 자르지 않는다)", async () => {
    const { container } = renderWith(<NodesPage />);
    const crit = fx.controlPlane.components.items.find((i) => i.cellState === "critical")!;
    const cell = container.querySelector('[data-cell-state="crit"]')!;
    // 툴팁은 hover 후에 뜨므로 앵커에 마우스를 올려 확인한다
    fireEvent.mouseEnter(cell.closest("[class*=cellAnchor]")!);
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(crit.cellTooltip));
  });

  it("요약의 `알 수 없음`은 서버 unknownTotal 하나를 쓴다 (notReporting + missing + unknown)", async () => {
    renderWith(<NodesPage />);
    // 5(노드 미보고) + 1(없음) = 6. 화면이 따로 더하지 않는다
    expect(fx.controlPlane.components.cellCounts.unknownTotal).toBe(6);
    expect(screen.getByRole("button", { name: "알 수 없음 6, 해당 칸 강조" })).toBeTruthy();
  });

  it("열 머리 툴팁의 사유는 마스터 표 `사유` 열과 같은 서버 문자열이다", async () => {
    const { container } = renderWith(<NodesPage />);
    const reason = fx.controlPlane.components.columns[2].reason!;
    expect(reason).toBe(fx.controlPlane.masters.items[2].reasonText);
    // 열 머리 아이콘의 스크린리더 문구가 그 문장이다 (화면이 사유를 새로 만들지 않는다)
    const heads = Array.from(container.querySelectorAll("thead th"));
    const labels = heads.map((h) => h.querySelector("svg")?.getAttribute("aria-label")).filter(Boolean);
    expect(labels).toContain(`노드 주의 (${reason}) · 구성요소 알 수 없음 5`);
  });

  it("컨트롤 플레인 한계 안내 2줄은 접거나 닫을 수 없다 (AC-KOPS26)", async () => {
    renderWith(<NodesPage />);
    expect(screen.getByText(/apiserver가 모두 중단되면/)).toBeTruthy();
    expect(screen.getByText(/etcd 내부 지표/)).toBeTruthy();
  });

  it("노드그룹 필터 후보는 현재 역할 안의 값만 (워커에 control-plane-* 이 나오지 않는다)", async () => {
    renderWith(<NodesPage />);
    // 워커 표에는 control-plane-* InstanceGroup 이 없다 (위 컨트롤 플레인 섹션 표에는 있다)
    const table = screen.getByRole("table", { name: "노드 목록" });
    expect(table.textContent).not.toContain("control-plane-ap-northeast-2");
    expect(table.textContent).toContain("batch");
  });
});

describe("파드 /cluster/pods", () => {
  it("장애 먼저 정렬, 완료 파드 기본 숨김, 관측 N분 표시", async () => {
    renderWith(<PodsPage />);
    const table = screen.getByRole("table", { name: "파드 목록" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("api-7f9c8d6b5-x2kq9");
    expect(table.textContent).not.toContain("nightly-job-28471-abcde");
    expect(screen.getByText("재시작(관측 23분)")).toBeTruthy();
    expect(screen.getByText(/파드 \d+개 중 \d+개 표시/)).toBeTruthy();
  });

  it("행의 `로그`는 이름 칸의 **아이콘 링크**(`ResourceName.logHref`)이고 주소는 서버 `logHref` 그대로(`follow=1`) (진입점 2)", async () => {
    renderWith(<PodsPage />);
    const table = screen.getByRole("table", { name: "파드 목록" });
    const link = within(table).getByRole("link", { name: "api-7f9c8d6b5-x2kq9 로그 보기" });
    expect(link.getAttribute("href")).toBe("/logs?namespace=prod&pod=api-7f9c8d6b5-x2kq9&follow=1");
    expect(link.getAttribute("data-testid")).toBe("rn-log-link");
    // 글자 `로그` 버튼은 파드 표에 더 없다(designer "추가 4" E2)
    expect(within(table).queryByRole("link", { name: /^prod\/.* 로그 보기$/ })).toBeNull();
  });

  it("클러스터 연결 없음이면 표 대신 알 수 없음", async () => {
    renderWith(
      <PodsPage />,
      fakeStore(streamState((s) => ({ ...s, sources: { ...s.sources, kube: { ...s.sources.kube!, state: "not_configured" } } }))),
    );
    expect(screen.getAllByText(/알 수 없음/).length).toBeGreaterThan(0);
  });
});

describe("DB /cluster/db", () => {
  it("쿼리 원문 안내, 복제 해당 없음, 판단 이유", async () => {
    renderWith(<DbPage />);
    expect(screen.getByText("쿼리 원문은 수집·표시하지 않습니다.")).toBeTruthy();
    expect(screen.getAllByText("해당 없음").length).toBeGreaterThan(0);
    expect(screen.getAllByText("연결 82% (max 100)").length).toBeGreaterThan(0);
    // 세션 표에는 사용자·상태만, 쿼리 문자열 열 없음
    expect(screen.queryByText(/select|SELECT/)).toBeNull();
  });
});

describe("비용 /cost", () => {
  it("추정·확정·AWS 예측 구분, 반영 기준일 문구, 스팟 시세 실패·단가 없음 라벨, mock 새로고침 비활성 사유", async () => {
    renderWith(<CostPage />);
    expect(screen.getAllByText("추정").length).toBeGreaterThan(2);
    expect(screen.getAllByText("확정").length).toBeGreaterThan(1);
    expect(screen.getAllByText("AWS 예측").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/까지 반영 · 최대 24시간 지연/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/스팟 시세 조회 실패/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("단가 없음 · 합계 제외").length).toBeGreaterThan(0);
    expect(screen.getAllByText("MOCK 모드: AWS를 호출하지 않습니다").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /이 추정에 포함되지 않는 것/ }).length).toBeGreaterThan(0);
    // 합계 행은 서버 값 그대로 (1.104532 → $1.10)
    expect(screen.getAllByText(/1\.10/).length).toBeGreaterThan(0);
    // 급증 원인
    expect(screen.getByText("EC2 노드 +3대 (m6i.large 온디맨드)")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("시간당 소모율 추이")).toBeTruthy());
  });

  it("카테고리가 `컨트롤 플레인`이고 하위 종류 5가지가 그룹 안에 보인다 (AC-KOPS27·28)", async () => {
    renderWith(<CostPage />);
    expect(screen.getAllByText("컨트롤 플레인").length).toBeGreaterThan(0);
    expect(screen.queryByText("EKS 컨트롤 플레인")).toBeNull();
    // 컨트롤 플레인 그룹은 금액 1위와 별개로 기본 펼침
    for (const k of ["마스터 EC2", "etcd 볼륨", "마스터 루트 볼륨", "API 서버 LB"]) {
      expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    }
    // 마스터 3대 × etcd 볼륨 2개 = 6행
    expect(screen.getAllByText("etcd 볼륨")).toHaveLength(6);
  });

  it("api_lb 가 assumed 면 `추정` 라벨이 반드시 보인다 (확정 금액으로 오해하면 안 된다)", async () => {
    renderWith(<CostPage />);
    expect(screen.getAllByText("API 서버 LB로 추정 (1개)").length).toBeGreaterThan(0);
  });

  it("api_lb 후보가 0개여도 apiLb 는 있고, 정보 한 줄로 알린다 (오류가 아니다, AC-KOPS30)", async () => {
    const cats = fx.cost.estimate.categories.map((c) =>
      c.category === "controlPlane"
        ? { ...c, apiLb: { state: "not_found" as const, candidateCount: 0, text: "API 서버 LB를 찾지 못했습니다 — 내부 LB이거나 LB 없는 구성일 수 있습니다" } }
        : c,
    );
    const estimate = {
      ...fx.cost.estimate,
      categories: cats,
      resources: { ...fx.cost.estimate.resources, controlPlane: fx.cost.estimate.resources.controlPlane.filter((r) => r.kind !== "api_lb") },
    };
    renderWith(<CostPage />, fakeStore(streamState((s) => ({ ...s, cost: { ...s.cost!, estimate } }))));
    // 그룹 행 칩 + 그룹 맨 아래 정보 행 두 곳에서 알린다(스크롤과 무관하게 보이도록)
    expect(screen.getAllByText(/API 서버 LB를 찾지 못했습니다/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/API 서버 LB로 추정/)).toBeNull();
  });

  it("api_lb 후보가 2개 이상이면 warn 으로 알린다", async () => {
    const cats = fx.cost.estimate.categories.map((c) =>
      c.category === "controlPlane"
        ? { ...c, apiLb: { state: "ambiguous" as const, candidateCount: 2, text: "API 서버 LB 후보 2개 — 확인 필요" } }
        : c,
    );
    const estimate = { ...fx.cost.estimate, categories: cats };
    renderWith(<CostPage />, fakeStore(streamState((s) => ({ ...s, cost: { ...s.cost!, estimate } }))));
    expect(screen.getAllByText("API 서버 LB 후보 2개 — 확인 필요").length).toBeGreaterThan(0);
  });

  it("kOps 관리 요금 안내와 Route53·S3 제외 2줄 (화면 상수, 계약 3.1.1)", async () => {
    renderWith(<CostPage />);
    expect(screen.getAllByText(/kOps 클러스터에는 EKS 같은 컨트롤 플레인 관리 요금이 없습니다/).length).toBeGreaterThan(0);
  });

  it("Cost Explorer 사용 불가면 확정 영역만 알 수 없음, 추정 영역은 그대로", async () => {
    const ce = { ...fx.cost.actual, available: false, unavailable: { code: "CE_ACCESS_DENIED", message: "Cost Explorer 사용 불가: AccessDenied" } };
    renderWith(<CostPage />, fakeStore(streamState((s) => ({ ...s, cost: { ...s.cost!, actual: ce } }))));
    expect(screen.getAllByText(/Cost Explorer 사용 불가: AccessDenied/).length).toBeGreaterThan(0);
    expect(screen.getByText("리소스 내역", { selector: "caption" })).toBeTruthy();
  });

  it("예산 미설정이면 예산 타일을 그리지 않는다", async () => {
    const summary = { ...fx.cost.summary, budget: { ...fx.cost.summary.budget, configured: false, budgetUsd: null } };
    renderWith(<CostPage />, fakeStore(streamState((s) => ({ ...s, cost: { ...s.cost!, summary } }))));
    expect(screen.queryByText("예산", { selector: "span" })).toBeNull();
  });
});

describe("어드바이저 /advisor", () => {
  it("예시 분석 실행, 실패 사유(비용 상한 초과) 안내, 규칙/AI 구분, LLM 문자열은 텍스트로만", async () => {
    const { container } = renderWith(<AdvisorPage />);
    expect(screen.getAllByRole("button", { name: /예시 분석 실행/ }).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText("분석 실패 · 비용 상한 초과")).toBeTruthy());
    expect(screen.getByText("분석 비용이 상한 $2.00을 넘어 중단했습니다.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "사전 점검" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "최근 분석 결과" })).toBeTruthy();

    // 악성 문자열이 문자 그대로 보이고 요소로 해석되지 않는다
    const bad = fx.latestResult.suggestions![1].title;
    expect(screen.getByText(bad)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href="https://example.com"]')).toBeNull();

    // 근거 확인 불가 제안은 구분 머리 아래
    expect(screen.getByText(/근거를 확인할 수 없는 제안 \(1\)/)).toBeTruthy();
    // 1순위 카드는 펼쳐져 실행하지 않는다는 안내가 보인다. 적용·실행 버튼은 없다
    expect(screen.getAllByText(/대시보드는 실행하지 않습니다/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /적용|kubectl/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole("table", { name: "사전 점검 결과" })).toBeTruthy());
  });

  it("진행 중이면 진행 패널(단계·경과·수신 표시)과 취소, 원문 스트림 없음", async () => {
    const running = {
      ...fx.latestResult,
      id: "run-live",
      status: "running" as const,
      stage: "receiving" as const,
      suggestions: null,
      stages: fx.latestResult.stages.map((s, i) => (i === 3 ? { ...s, state: "active" as const, durationMs: null } : i > 3 ? { ...s, state: "pending" as const } : s)),
      receiving: { lastReceivedAt: new Date().toISOString(), receivedChars: 3214 },
    };
    renderWith(
      <AdvisorPage />,
      fakeStore(streamState((s) => ({ ...s, advisor: { ...s.advisor!, state: { ...s.advisor!.state, activeRun: running } } }))),
    );
    expect(screen.getByText("분석 진행 중", { selector: "h3" })).toBeTruthy();
    expect(screen.getByText("응답 수신 중")).toBeTruthy();
    expect(screen.getByText(/3,214자/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /취소/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("분석은 한 번에 1건만 실행됩니다").length).toBeGreaterThan(0);
  });
});

describe("셸", () => {
  it("MOCK 배지, 사이드바 상태, 5초 넘게 끊기면 배너(마지막 갱신·재시도 횟수)", async () => {
    const down: ConnectionInfo = { ...openConn, phase: "waiting", attempt: 3, downSince: Date.now() - 6000, nextRetryAt: Date.now() + 8000 };
    renderWith(
      <ShellClient>
        <p>본문</p>
      </ShellClient>,
      fakeStore(streamState(), down),
    );
    expect(screen.getAllByText(/MOCK/).length).toBeGreaterThan(0);
    expect(screen.getByText(/연결 끊김 - 마지막 갱신/)).toBeTruthy();
    expect(screen.getByText(/재연결 시도 중 \(3회째, 다음 시도 \d초 후\)/)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "주요 메뉴" }).textContent).toContain("노드");
    expect(screen.getByText("prod.k8s.example.com · v1.34.1 · ap-northeast-2")).toBeTruthy();
    expect(screen.getByText("본문")).toBeTruthy();
  });

  it("최초 연결 전 API 가 응답하지 않으면 페이지 전체 오류", async () => {
    renderWith(
      <ShellClient>
        <p>본문</p>
      </ShellClient>,
      fakeStore(initialStreamState, { ...openConn, phase: "waiting", everOpened: false, apiReachable: false, attempt: 1, downSince: Date.now() }),
    );
    expect(screen.getByText("API 서버에 연결할 수 없습니다")).toBeTruthy();
    expect(screen.queryByText("본문")).toBeNull();
  });
});
