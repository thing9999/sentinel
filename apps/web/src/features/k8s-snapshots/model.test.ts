import { describe, expect, it } from "vitest";

import {
  driftBadge,
  driftResponse,
  k8sDetailData,
  k8sSummary,
  LAST_RESULT_OK,
  menuPayload,
  MISMATCH,
  NOT_COMPUTED,
} from "../__fixtures__/k8s-snapshots";
import { toBadgeScenarios } from "../shell/mock-scenarios";
import { navItemsFromOverview, snapshotMenuNavPatch } from "../shell/nav";
import { snapshotTabItems } from "../snapshot-menu/SnapshotsHeader";
import { BASE_TOPICS } from "../stream/client";
import { applyBatch, initialStreamState } from "../stream/reducer";
import {
  apiSortValue,
  buildDriftTree,
  buildFileTree,
  computeBlockReason,
  detailTabs,
  driftCellView,
  fileIssueText,
  k8sDetailHref,
  k8sSortParam,
  parseCsv,
  parseK8sSort,
  scopeRuleText,
  signedDelta,
  toK8sScanFindings,
  unparsableText,
  visibleDriftResources,
  DRIFT_KEYS,
  STATUS_KEYS,
} from "./model";

describe("DriftBadge → DriftStatus 매핑 (디자인 16절, 3.5 판단 순서)", () => {
  it("warning → changed `차이 N건`(N = 추가+삭제+변경), 2줄 `변경 1 · 삭제 1 · 추가 1`", () => {
    const v = driftCellView(driftBadge());
    expect(v).toMatchObject({ state: "changed", count: 3, line2: "변경 1 · 삭제 1 · 추가 1", refreshing: false });
  });

  it("ok → none, unknown → unknown + 3.5.1 짧은 문구, critical 은 unknown 으로", () => {
    const ok = driftBadge({ status: { status: "ok", reasons: [{ code: "DRIFT_NO_DIFF", text: "차이 없음 (비교 42개)", status: "ok" }], updatedAt: null, statusChangedAt: null, stale: false } });
    expect(driftCellView(ok).state).toBe("none");
    expect(driftCellView(MISMATCH)).toMatchObject({ state: "unknown", line2: "다른 클러스터" });
    const other = { ...MISMATCH, status: { ...MISMATCH.status, reasons: [{ code: "NEW_CODE", text: "서버 문구", status: "unknown" as const }] } };
    expect(driftCellView(other).line2).toBe("서버 문구");
    const crit = { ...MISMATCH, status: { ...MISMATCH.status, status: "critical" as const } };
    expect(driftCellView(crit).state).toBe("unknown");
  });

  it("DRIFT_NOT_COMPUTED → 배지 아님(notComputed). last_result 면 `지난 결과 차이 없음 · 날짜`", () => {
    expect(driftCellView(NOT_COMPUTED)).toMatchObject({ state: "notComputed", line2: "" });
    const v = driftCellView(LAST_RESULT_OK, { now: new Date("2026-09-19T06:00:00Z") });
    expect(v.state).toBe("notComputed");
    expect(v.line2).toMatch(/^지난 결과 차이 없음 · /);
  });

  it("stale 이 가장 먼저, computing 은 값 유지 + 스피너, 요청 대기는 `계산 중`", () => {
    const stale = driftBadge({ status: { ...driftBadge().status, stale: true } });
    expect(driftCellView(stale)).toMatchObject({ state: "stale", previous: { count: 3 } });
    expect(driftCellView(driftBadge({ computing: true }))).toMatchObject({ state: "changed", refreshing: true });
    expect(driftCellView(driftBadge(), { pending: true }).state).toBe("computing");
    // kube 출처 stale 이면 계산된 배지를 stale 로(13절)
    expect(driftCellView(driftBadge(), { kubeStale: true }).state).toBe("stale");
  });

  it("계산 버튼 비활성 사유: 서버 reasonText → 없으면 3.5.1 대체 문구", () => {
    expect(computeBlockReason({ allowed: true, reasonCode: null, reasonText: null })).toBeUndefined();
    expect(computeBlockReason({ allowed: false, reasonCode: "CLUSTER_ID_MISSING", reasonText: null })).toBe("스냅샷의 클러스터를 확인할 수 없음");
    expect(computeBlockReason({ allowed: false, reasonCode: "X", reasonText: "서버" })).toBe("서버");
  });
});

describe("목록 URL 쿼리 = API 값 (디자인 3.3)", () => {
  it("허용 값만, 순서는 허용 목록 순", () => {
    expect(parseCsv("warning,foo,not_computed", DRIFT_KEYS)).toEqual(["warning", "not_computed"]);
    expect(parseCsv("crit,critical", STATUS_KEYS)).toEqual(["critical"]);
  });

  it("정렬 URL 값은 API 값, 기본(최신순)이면 URL 에서 뺀다", () => {
    expect(parseK8sSort(null)).toEqual({ columnId: "snapshot", dir: "desc" });
    expect(parseK8sSort("status:asc")).toEqual({ columnId: "status", dir: "asc" });
    expect(apiSortValue(parseK8sSort("snapshotAt:asc"))).toBe("snapshotAt:asc");
    expect(k8sSortParam({ columnId: "snapshot", dir: "desc" })).toBeNull();
    expect(k8sSortParam({ columnId: "status", dir: "desc" })).toBe("status:desc");
  });

  it("상세 주소는 /snapshots/k8s/<id> (AWS 경로와 분리, AC-K18)", () => {
    expect(k8sDetailHref("20260919-061000", { view: "drift", res: "apps/Deployment/prod/api" })).toBe(
      "/snapshots/k8s/20260919-061000?view=drift&res=apps%2FDeployment%2Fprod%2Fapi",
    );
  });

  it("범위·증감 문구", () => {
    expect(scopeRuleText(k8sDetailData().scope)).toBe("시스템 제외 전체");
    expect(scopeRuleText({ ...k8sDetailData().scope!, namespaceMode: "include", namespaces: ["app", "data"], systemIncluded: ["kube-system"] })).toBe(
      "포함 app, data · 시스템 포함",
    );
    const ex = { ...k8sDetailData().scope!, namespaceMode: "exclude" as const, namespaces: ["data", "prod"] };
    expect(scopeRuleText({ ...ex, excludeNamespaces: ["batch"] })).toBe("제외 batch");
    expect(scopeRuleText({ ...ex, excludeNamespaces: [] })).toBe("일부 제외 · 내보냄 data, prod");
    expect(signedDelta(-2)).toBe("−2");
    expect(signedDelta(null)).toBe("-");
  });
});

describe("파일 트리 (디자인 5.2)", () => {
  it("스냅샷 파일 → 네임스페이스(서버 순서) → 종류(서버 순서), 비교 불가 종류 표시", () => {
    const t = buildFileTree(k8sDetailData());
    expect(t.nodes.map((n) => n.id)).toEqual(["g:snapshot-files", "ns:data", "ns:prod"]);
    const data = t.nodes[1];
    expect(data.children?.map((c) => c.id)).toEqual(["data/namespace.yaml", "k:data:statefulsets", "k:data:configmaps"]);
    expect(data.children?.[2].markers?.notComparable).toBe("드리프트 비교 불가 (대시보드 권한 밖)");
    const pg = data.children?.[1].children?.[0];
    expect(pg).toMatchObject({ id: "data/statefulsets/postgres.yaml", label: "postgres", tooltip: "data/statefulsets/postgres.yaml" });
    expect(pg?.markers?.scan).toEqual({ level: "error", count: 1 });
    expect(t.resourceCount).toBe(5);
  });

  it("표시 필터: 스캔 발견 있음 / 드리프트 차이 있음", () => {
    const scan = buildFileTree(k8sDetailData(), { filter: "scan" });
    expect(scan.shown).toBe(1);
    expect(scan.counts).toMatchObject({ scan: 1, drift: 1 });
    const drift = buildFileTree(k8sDetailData(), { filter: "drift" });
    expect(drift.nodes.map((n) => n.id)).toEqual(["ns:prod"]);
  });

  it("예상 밖 파일은 열 수 없는 잎, 저장 안 됨 표시", () => {
    const t = buildFileTree(k8sDetailData({ extraFiles: [{ name: "prod/notes.txt", type: "file", sizeBytes: 120 }] }), {
      dirtyPath: "prod/deployments/api.yaml",
    });
    const extra = t.nodes.find((n) => n.id === "g:extra");
    expect(extra?.children?.[0]).toMatchObject({ disabled: true, label: "prod/notes.txt" });
    const api = t.nodes.find((n) => n.id === "ns:prod")?.children?.[1].children?.[0];
    expect(api?.markers?.dirty).toBe(true);
    expect(api?.markers?.drift).toEqual({ kind: "changed" });
  });

  it("파일 문제 문구", () => {
    const f = k8sDetailData().files[4];
    expect(fileIssueText({ ...f, parse: "yaml_error" })).toBe("YAML 해석 실패");
    expect(fileIssueText({ ...f, pathMatches: false })).toBe("경로와 내용 불일치 (내용: StatefulSet data/postgres)");
    expect(fileIssueText({ ...f, runtimeFields: ["status", "metadata.managedFields"] })).toBe("런타임 필드 남음 (status, metadata.managedFields)");
    expect(fileIssueText(f)).toBeUndefined();
  });

  it("발견: 상세 files 에 있는 경로만 이동 가능, notes 는 안내", () => {
    const d = k8sDetailData();
    const known = new Set(d.files.map((f) => f.path));
    const out = toK8sScanFindings(
      [...d.scan.current.findings, { file: "notes.json", fileType: "notes", line: 3, rule: "jwt", severity: "error", message: "x" }],
      known,
    );
    expect(out[0].navigable).toBe(true);
    expect(out[1]).toMatchObject({ navigable: false, hint: "라벨·메모 파일입니다. 라벨·메모 편집에서 고치세요" });
  });
});

describe("상세 탭 (디자인 4.5)", () => {
  it("파일: 발견 수·최악 등급·저장 안 됨 / 드리프트: 차이 건수(상태 아이콘 없음) / Secret 참조 수", () => {
    const tabs = detailTabs(k8sDetailData(), driftBadge(), true);
    expect(tabs.map((t) => t.id)).toEqual(["files", "drift", "3d", "counts", "secrets", "meta"]);
    // 3D 보기 탭에는 숫자·상태 아이콘이 없다 (snapshot-3d.md 2.1)
    expect(tabs[2]).toEqual({ id: "3d", label: "3D 보기" });
    expect(tabs[0]).toMatchObject({ count: 1, countLabel: "발견", status: "crit", dirty: true });
    expect(tabs[1]).toMatchObject({ count: 3, countLabel: "차이" });
    expect(tabs[1].status).toBeUndefined();
    expect(tabs[4].count).toBe(1);
    expect(detailTabs(k8sDetailData(), NOT_COMPUTED, false)[1].count).toBeUndefined();
  });
});

describe("드리프트 목록 (디자인 6.4)", () => {
  it("구분 필터, 숨긴 차이만 있는 same 은 스위치를 켤 때만, 서버 순서로 네임스페이스 → 종류", () => {
    const r = driftResponse().resources;
    const same = { ...r[0], key: "core/Service/prod/web", kind: "Service", name: "web", change: "same" as const, counts: { changed: 0, default: 2, managed: 0 } };
    const all = [...r, same];
    expect(visibleDriftResources(all, "all", false).map((x) => x.name)).toEqual(["api", "api-public", "payments"]);
    expect(visibleDriftResources(all, "all", true).map((x) => x.name)).toContain("web");
    expect(visibleDriftResources(all, "deleted", true).map((x) => x.name)).toEqual(["api-public"]);
    const tree = buildDriftTree(visibleDriftResources(all, "all", true));
    expect(tree).toHaveLength(1);
    expect(tree[0].children?.map((k) => k.label)).toEqual(["Deployment", "Ingress", "Service"]);
    const api = tree[0].children?.[0].children?.[0];
    expect(api).toMatchObject({ id: "apps/Deployment/prod/api", secondary: "필드 2" });
    const web = tree[0].children?.[2].children?.[0];
    expect(web?.markers?.hiddenOnly).toBe(2);
  });

  it("파일 문제로 비교 못 함 요약", () => {
    expect(unparsableText([])).toBeNull();
    expect(
      unparsableText([
        { path: "a", reason: "yaml_error" },
        { path: "b", reason: "too_large" },
        { path: "c", reason: "duplicate" },
      ]),
    ).toBe("파일 문제로 비교 못 함 3개 (해석 실패 2 · 중복 정의 1)");
  });
});

describe("사이드바 스냅샷 메뉴·탭 (계약 12절, AC-K16)", () => {
  it("메뉴: 서버 합산 상태·숫자, crit 는 `커밋 금지`, 드리프트는 넣지 않는다", () => {
    expect(snapshotMenuNavPatch(menuPayload().menu)).toEqual({ status: "crit", statusLabel: "커밋 금지", count: 3 });
    const items = navItemsFromOverview(null, false, menuPayload().menu);
    expect(items.find((i) => i.href === "/snapshots")).toMatchObject({ label: "스냅샷", status: "crit", count: 3 });
  });

  it("둘 다 설정 없음(showIcon false)이면 아이콘·숫자 없음, stale·끊김이면 stale", () => {
    const off = { ...menuPayload().menu, showIcon: false };
    expect(snapshotMenuNavPatch(off)).toEqual({ status: undefined, count: undefined, statusLabel: undefined });
    expect(snapshotMenuNavPatch(menuPayload().menu, true)).toEqual({ status: "stale", statusLabel: undefined, count: undefined });
    expect(snapshotMenuNavPatch({ ...menuPayload().menu, count: 0 }).count).toBeUndefined();
  });

  it("탭: 파일 상태 아이콘·커밋 금지 pill, k8s 는 최신 드리프트 `차이 N` 칩(DRIFT_DIFF 일 때만)", () => {
    const [aws, k8s] = snapshotTabItems(menuPayload().tabs);
    expect(aws).toMatchObject({ href: "/snapshots", label: "AWS", status: "crit", count: 2, statusLabel: "커밋 금지" });
    expect(k8s).toMatchObject({ href: "/snapshots/k8s", label: "Kubernetes", count: 1 });
    expect(k8s.srText).toBe("커밋 금지 1개, 드리프트 차이 3건");
    expect(k8s.trailing).toBeTruthy();
    const noDiff = menuPayload();
    noDiff.tabs.k8s.latestDrift = { snapshotId: "x", drift: LAST_RESULT_OK };
    expect(snapshotTabItems(noDiff.tabs)[1].trailing).toBeUndefined();
    // 설정 없음(included false)이면 아이콘·숫자 없음
    const excluded = menuPayload();
    excluded.tabs.aws = { ...excluded.tabs.aws, included: false };
    expect(snapshotTabItems(excluded.tabs)[0].status).toBeUndefined();
  });

  it("기본 구독 토픽은 overview + snapshot-menu (사이드바), aws/k8s 토픽은 화면이 구독", () => {
    expect(BASE_TOPICS).toEqual(["overview", "snapshot-menu"]);
  });
});

describe("MOCK 배지 그룹 (publisher 요청: ScenarioGroupId)", () => {
  it("k8s-snapshots 그룹도 캐스트 없이 넘긴다", () => {
    const s = toBadgeScenarios([
      { id: "k8s-snapshots", label: "Kubernetes 스냅샷", active: "default", options: [{ id: "no-drift", label: "드리프트 없음", description: "" }] },
    ]);
    expect(s).toEqual([{ id: "no-drift", label: "드리프트 없음", group: "k8s-snapshots", active: false }]);
  });
});

describe("스트림 리듀서 k8s-snapshots·snapshot-menu", () => {
  const ev = (type: string, topic: "k8s-snapshots" | "snapshot-menu", payload: unknown, seq: number) => ({
    type,
    envelope: { seq, topic, emittedAt: "", payload },
    receivedAt: 1,
  });

  it("changed 는 ID 카운터, drift 는 배지 교체(목록 재조회 키 seq 는 그대로), snapshot 은 배지를 비운다", () => {
    const summary = k8sSummary();
    let s = applyBatch(initialStreamState, [
      ev("k8s-snapshots.snapshot", "k8s-snapshots", { revision: 1, summary }, 1),
      ev("k8s-snapshots.changed", "k8s-snapshots", { revision: 2, changedIds: ["a"], removedIds: ["b"], trashChanged: true, summary }, 2),
      ev("k8s-snapshots.drift", "k8s-snapshots", { snapshotId: "a", trigger: "cluster_changed", drift: driftBadge(), autoTargetId: "a" }, 3),
    ]);
    expect(s.k8sSnapshots).toMatchObject({ seq: 2, resetSeq: 1, trashSeq: 2, autoTargetId: "a", driftEvents: 1 });
    expect(s.k8sSnapshots?.changed).toEqual({ a: 2 });
    expect(s.k8sSnapshots?.removed).toEqual({ b: 2 });
    expect(s.k8sSnapshots?.drift.a.status.status).toBe("warning");
    expect(s.k8sSnapshots?.driftSeq.a).toBe(1);
    s = applyBatch(s, [ev("k8s-snapshots.snapshot", "k8s-snapshots", { revision: 3, summary }, 4)]);
    expect(s.k8sSnapshots?.drift).toEqual({});
    expect(s.k8sSnapshots?.resetSeq).toBe(2);
  });

  it("snapshot-menu.snapshot/updated 는 메뉴·탭 값을 통째로 교체", () => {
    const s = applyBatch(initialStreamState, [
      ev("snapshot-menu.snapshot", "snapshot-menu", menuPayload(), 1),
      ev("snapshot-menu.updated", "snapshot-menu", menuPayload({ menu: { ...menuPayload().menu, count: 5 } }), 2),
    ]);
    expect(s.snapshotMenu?.menu.count).toBe(5);
    expect(s.snapshotAt["snapshot-menu"]).toBe(1);
  });
});
