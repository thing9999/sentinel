import { describe, expect, it, vi } from "vitest";

import { buildFixtures } from "./__fixtures__/fixtures";
import { filterSuggestions, resultReason, runDisabledText, runSteps, suggestionToCard } from "./architecture-advisor/mapping";
import { comparePodsDefault, countByStatus, hrefForRef, nodeUsage, parseRoleFilter, parseSort, reasonStatus, sortRows, splitByRole } from "./cluster-status/selectors";
import { holdOrder } from "./common/useStableOrder";
import { toBadgeScenarios } from "./shell/mock-scenarios";
import { navItemsFromOverview } from "./shell/nav";
import type { MetricsState } from "./stream/reducer";
import { badgeProps, isTimeStale, watchStale } from "./stream/stale";
import { initialStreamState } from "./stream/reducer";

const NOW = Date.parse("2026-09-19T05:02:10.000Z");
const fx = buildFixtures(NOW);

describe("상태 매핑 (status.md 8.1)", () => {
  it("warning→warn, critical→crit, stale 이면 배지를 stale 로 교체하고 이전 상태·이유를 넘긴다", () => {
    const info = fx.clusterSnapshot.pods[0].status;
    expect(badgeProps(info).status).toBe("crit");
    const b = badgeProps(info, { stale: true, at: "2026-09-19T05:01:00.000Z" });
    expect(b).toMatchObject({ status: "stale", previousStatus: "crit", staleAt: "2026-09-19T05:01:00.000Z" });
    expect(b.previousReason).toBe("CrashLoopBackOff · 최근 1시간 재시작 6회");
    expect(badgeProps({ ...info, stale: true }).status).toBe("stale");
    expect(badgeProps(null).status).toBe("unknown");
  });

  it("화면 stale 타이머: updatedAt + 기준 경과, watch 는 heartbeat 45초", () => {
    expect(isTimeStale(new Date(NOW - 46_000).toISOString(), 45_000, NOW)).toBe(true);
    expect(isTimeStale(new Date(NOW - 44_000).toISOString(), 45_000, NOW)).toBe(false);
    const s = { ...initialStreamState, lastHeartbeatAt: NOW - 46_000 };
    expect(watchStale(s, NOW).stale).toBe(true);
    expect(watchStale({ ...s, lastHeartbeatAt: NOW - 10_000 }, NOW).stale).toBe(false);
    expect(watchStale({ ...s, lastHeartbeatAt: NOW, sources: { kube: { ...fx.hello.sources[0], state: "stale" } } }, NOW).stale).toBe(true);
  });

  it("사이드바: 서버 nav 상태 그대로, stale 플래그면 stale, 어드바이저 분석 중 스피너", () => {
    const items = navItemsFromOverview({ ...fx.overview.nav, advisorBusy: true, stale: { ...fx.overview.nav.stale, db: true } });
    const by = Object.fromEntries(items.map((i) => [i.href, i]));
    expect(by["/cluster/nodes"].status).toBe("crit");
    expect(by["/cluster/events"].status).toBe("warn");
    expect(by["/cluster/db"].status).toBe("stale");
    expect(by["/advisor"].busy).toBe(true);
  });
});

describe("cluster 선택자", () => {
  it("파드 기본 정렬: 상태 → 최근 1시간 재시작 내림차순 → 네임스페이스 → 이름", () => {
    const sorted = [...fx.clusterSnapshot.pods].sort(comparePodsDefault).map((p) => p.name);
    expect(sorted[0]).toBe("api-7f9c8d6b5-x2kq9"); // crit, 재시작 6
    expect(sorted[1]).toBe("api-7f9c8d6b5-b8zlm"); // crit, 재시작 4
    expect(sorted[2]).toBe("web-5d8f7c9b4-k2m4n"); // warn
  });

  it("열 정렬 순환 URL 값 파싱과 null 은 뒤로", () => {
    expect(parseSort("restarts1h:desc")).toEqual({ columnId: "restarts1h", dir: "desc" });
    expect(parseSort("bad")).toBeNull();
    const rows = [{ v: 2 }, { v: null }, { v: 5 }];
    expect(sortRows(rows, { columnId: "v", dir: "desc" }, { v: (r) => r.v }, () => 0).map((r) => r.v)).toEqual([5, 2, null]);
  });

  it("상태별 개수는 서버 판단 값을 세기만 한다", () => {
    expect(countByStatus(fx.clusterSnapshot.nodes, (n) => n.status)).toEqual({ all: 9, crit: 2, warn: 2, ok: 5, unknown: 0 });
  });

  it("역할 분류는 서버 role 만 본다 — 워커/마스터/전체 (AC-KOPS10~11)", () => {
    const byRole = splitByRole(fx.clusterSnapshot.nodes);
    expect(byRole.worker).toHaveLength(6);
    expect(byRole.control_plane).toHaveLength(3);
    expect(byRole.all).toHaveLength(9);
    // 전체 = 워커 + 마스터 (같은 목록을 나눈 값이라 화면이 따로 더하지 않는다)
    expect(byRole.all.length).toBe(byRole.worker.length + byRole.control_plane.length);
    expect(byRole.control_plane.every((n) => n.role === "control_plane")).toBe(true);
  });

  it("role 쿼리 기본값은 worker, 모르는 값도 worker (계약 3.1)", () => {
    expect(parseRoleFilter(null)).toBe("worker");
    expect(parseRoleFilter("worker")).toBe("worker");
    expect(parseRoleFilter("control_plane")).toBe("control_plane");
    expect(parseRoleFilter("all")).toBe("all");
    expect(parseRoleFilter("master")).toBe("worker");
  });

  it("클러스터 합계와 컨트롤 플레인 블록을 더하지 않는다 (AC-KOPS12)", () => {
    const m = fx.metricsSnapshot.cluster;
    expect(m.scope.basis).toBe("worker");
    expect(m.scope.workerNodeCount).toBe(6);
    expect(m.scope.controlPlaneNodeCount).toBe(3);
    // 워커 6대 × 1930m. 마스터 allocatable 이 섞여 있으면 이 값이 커진다
    expect(m.cpu.allocatableMillicores).toBe(6 * 1930);
    expect(m.controlPlane.nodeCount).toBe(3);
  });

  it("배분 breakdown 은 controlPlaneUsdPerHour 다 (구 eksUsdPerHour 없음)", () => {
    const shared = fx.cost.allocation.pinnedRows.find((r) => r.key === "shared_cluster");
    expect(shared?.breakdown.controlPlaneUsdPerHour).toBeGreaterThan(0);
    expect(Object.keys(shared?.breakdown ?? {})).not.toContain("eksUsdPerHour");
  });

  it("막대 색은 서버 이유 코드의 등급 (없으면 ok)", () => {
    expect(reasonStatus(fx.clusterSnapshot.pods[0].status, ["POD_MEMORY_LIMIT"])).toBe("crit");
    expect(reasonStatus(fx.clusterSnapshot.pods[3].status, ["POD_MEMORY_LIMIT"])).toBe("ok");
  });

  it("metrics.updated 사용량으로 표 셀을 덮어쓴다, metrics-server 없음이면 null", () => {
    const n = fx.clusterSnapshot.nodes[2];
    const m = {
      cluster: fx.metricsSnapshot.cluster,
      clusterSeries: fx.metricsSnapshot.clusterSeries,
      nodes: { [n.name]: { name: n.name, cpuMillicores: 1, memoryBytes: 2, cpuPct: 91, memoryPct: 4 } },
      pods: {},
      collectedAt: "2026-09-19T05:02:15.000Z",
    } satisfies MetricsState;
    expect(nodeUsage(n, m)?.cpuPct).toBe(91);
    expect(nodeUsage(n, { ...m, nodes: {}, cluster: { ...m.cluster, available: false } })).toBeNull();
    expect(nodeUsage(n, null)).toBe(n.usage);
  });

  it("리소스 링크", () => {
    expect(hrefForRef({ kind: "Pod", namespace: "prod", name: "a" })).toBe("/cluster/pods/prod/a");
    expect(hrefForRef({ kind: "Deployment", namespace: "prod", name: "api" })).toBe("/cluster/workloads?focus=Deployment%2Fprod%2Fapi");
  });

  it("실시간 재정렬 보류: 기존 순서를 유지하고 새 행은 뒤에, 바뀐 위치 수를 센다", () => {
    expect(holdOrder(["b", "a", "c"], ["a", "b"])).toEqual({ order: ["a", "b", "c"], changed: 2 });
    expect(holdOrder(["a", "b"], ["a", "b", "x"])).toEqual({ order: ["a", "b"], changed: 0 });
  });
});

describe("어드바이저 매핑", () => {
  it("제안 → 카드: 문자열은 그대로(HTML·마크다운 해석 없음), 스냅샷 없는 대상은 missing·링크 없음, database→db", () => {
    const [ok, bad] = fx.latestResult.suggestions!;
    const c1 = suggestionToCard(ok);
    expect(c1.category).toBe("cost");
    expect(c1.savings).toEqual({ monthly: 84.1, formula: "($0.0960 − $0.0768)/h × 730h × 6대 = $84.10/월", source: "server" });
    expect(c1.steps[0].code).toEqual({ language: "bash", code: "docker manifest inspect <image> | grep architecture" });
    expect(c1.evidence[0].value).toBe("18");

    const c2 = suggestionToCard(bad);
    expect(c2.title).toBe(bad.title);
    expect(c2.category).toBe("db");
    expect(c2.targets[0]).toMatchObject({ missing: true, href: undefined });
    expect(c2.unverified).toBe(true);
    expect(c2.savings?.source).toBe("llm");
  });

  it("단계: 5개 고정 순서, 완료 단계에 소요 시간", () => {
    const steps = runSteps(fx.latestResult);
    expect(steps.map((s) => s.label)).toEqual(["스냅샷 수집", "사전 점검", "분석 요청", "응답 수신 중", "결과 정리"]);
    expect(steps[0].detail).toBe("0:03");
  });

  it("필터: 카테고리·심각도·출처(사전 점검 연결/AI 단독)", () => {
    const list = fx.latestResult.suggestions!;
    expect(filterSuggestions(list, { categories: ["db"], severities: [], source: "all" })).toHaveLength(1);
    expect(filterSuggestions(list, { categories: [], severities: ["high"], source: "all" })).toHaveLength(1);
    expect(filterSuggestions(list, { categories: [], severities: [], source: "linked" }).map((s) => s.priority)).toEqual([1]);
    expect(filterSuggestions(list, { categories: [], severities: [], source: "llmOnly" }).map((s) => s.priority)).toEqual([2]);
  });

  it("분석 버튼 비활성 사유와 결과 사유 (취소는 status 로)", () => {
    const b = fx.advisor.bridge;
    expect(runDisabledText({ ...b, canRun: true }, null, (x) => x)).toBeUndefined();
    expect(runDisabledText({ ...b, canRun: false, disabledReason: "login_required" }, null, (x) => x)).toBe("Claude Code 로그인 필요");
    expect(runDisabledText({ ...b, canRun: false, disabledReason: "usage_limit", retryAt: "15:30" }, null, (x) => x)).toBe("사용량 한도 · 15:30 이후 가능");
    expect(runDisabledText(b, fx.latestResult, (x) => x)).toBe("분석은 한 번에 1건만 실행됩니다");
    expect(resultReason({ status: "cancelled", failureReason: null })).toBe("cancelled");
    expect(resultReason({ status: "failed", failureReason: "budget_exceeded" })).toBe("budget_exceeded");
  });
});

describe("mock 시나리오", () => {
  it("상단바 배지에는 cluster·db·cost·advisor 4그룹이 모두 나온다", () => {
    const s = toBadgeScenarios(fx.mockScenarios.groups);
    expect(new Set(s.map((x) => x.group))).toEqual(new Set(["cluster", "db", "cost", "advisor"]));
    expect(s.find((x) => x.id === "mixed")?.active).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn.mockRestore();
  });
});
