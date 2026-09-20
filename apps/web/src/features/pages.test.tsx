// @vitest-environment jsdom
/**
 * 주요 페이지 렌더 (가짜 스트림 저장소 + 계약 예시 모양의 가짜 REST).
 */
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildFixtures } from "./__fixtures__/fixtures";
import { AdvisorPage } from "./architecture-advisor/AdvisorPage";
import { CostPage } from "./aws-cost/CostPage";
import { DbPage } from "./cluster-status/DbPage";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
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
afterEach(() => cleanup());

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

  it("heartbeat 가 45초 넘게 없으면 watch 기반 카드가 데이터 오래됨으로 바뀐다", async () => {
    renderWith(<OverviewPage />, fakeStore(streamState((s) => ({ ...s, lastHeartbeatAt: Date.now() - 60_000 }))));
    expect(screen.getAllByText(/데이터 오래됨/).length).toBeGreaterThan(0);
  });

  it("스냅샷 전에는 스켈레톤", async () => {
    const { container } = renderWith(<OverviewPage />, fakeStore(initialStreamState, { ...openConn, phase: "connecting", everOpened: false }));
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
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
    expect(screen.getByText("prod-eks · v1.30.4 · ap-northeast-2")).toBeTruthy();
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
