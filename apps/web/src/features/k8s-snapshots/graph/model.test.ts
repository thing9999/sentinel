import { describe, expect, it } from "vitest";

import {
  buildRowSpecs,
  computeLayout,
  countText,
  defaultLabelDensity,
  detailHref,
  filterGraph,
  isFiltered,
  markerSource,
  navigatePatch,
  primaryPatch,
  searchMatches,
  tableSummaryText,
} from "./model";
import { U } from "./layout";
import { DEFAULT_RULES, EMPTY_GRAPH_QUERY, activeRules, type GraphQuery } from "./query";
import type { GraphBlock, GraphData, GraphEdge, GraphMarkers, GraphPlate } from "./types";

const markers = (over: Partial<GraphMarkers> = {}): GraphMarkers => ({
  scan: { errors: 0, warnings: 0, level: null, count: 0, firstLine: null },
  drift: { change: "same", fieldCount: 0, hidden: { default: 0, managed: 0 }, reasonCode: null, reasonText: null },
  fileIssue: null,
  helm: false,
  ...over,
});

const plate = (id: string, name: string): GraphPlate => ({
  id,
  kind: "namespace",
  name,
  system: false,
  file: `${name}/namespace.yaml`,
  fileLine: 1,
  resourceCount: 1,
  ghostCount: 0,
  byLayer: {},
  markers: markers(),
  notes: [],
  navigate: { primary: "files", file: `${name}/namespace.yaml`, line: 1, resourceKey: `core/Namespace/_cluster/${name}`, secretName: null },
});

const block = (over: Partial<GraphBlock> & Pick<GraphBlock, "id">): GraphBlock => ({
  blockType: "resource",
  plateId: "ns:prod",
  layer: "workload",
  kind: "Deployment",
  apiGroup: "apps",
  apiVersion: "apps/v1",
  namespace: "prod",
  name: over.id,
  resourceKey: over.id,
  kindDir: "deployments",
  custom: false,
  file: { path: "prod/deployments/api.yaml", line: 1, documentIndex: 0, documentCount: 1 },
  summary: {},
  ghost: null,
  markers: markers(),
  notes: [],
  system: false,
  degree: { in: 0, out: 0 },
  navigate: { primary: "files", file: "prod/deployments/api.yaml", line: 1, resourceKey: over.id, secretName: null },
  ...over,
});

const edge = (id: string, rule: GraphEdge["rule"], from: string, to: string): GraphEdge => ({
  id,
  rule,
  from,
  to,
  certainty: "confirmed",
  toGhost: false,
  optional: false,
  evidence: "근거",
  evidenceItems: [],
  evidenceTruncated: false,
});

function graphFixture(): GraphData {
  const blocks: GraphBlock[] = [
    block({ id: "apps/Deployment/prod/api", markers: markers({ drift: { change: "changed", fieldCount: 3, hidden: { default: 0, managed: 0 }, reasonCode: null, reasonText: null } }) }),
    block({ id: "core/ConfigMap/prod/api-config", layer: "storage", kind: "ConfigMap", apiGroup: "" }),
    block({
      id: "ghost:core/Secret/prod/creds",
      blockType: "ghost",
      layer: "storage",
      kind: "Secret",
      name: "creds",
      file: null,
      ghost: { reason: "secret", text: "Secret — 이름만, 값 없음" },
      ghostFromRules: ["K6"],
      markers: markers({ drift: null }),
      navigate: { primary: "secrets", file: null, line: null, resourceKey: null, secretName: "creds" },
    }),
    block({
      id: "ghost:core/ServiceAccount/prod/default",
      blockType: "ghost",
      layer: "aux",
      kind: "ServiceAccount",
      name: "default",
      file: null,
      ghost: { reason: "autocreated", text: "자동 생성 또는 스냅샷에 없음" },
      ghostFromRules: ["K9"],
      markers: markers({ drift: null }),
      navigate: { primary: null, file: null, line: null, resourceKey: null, secretName: null },
    }),
    block({
      id: "ghost:apps/Deployment/prod/payments",
      blockType: "ghost",
      name: "payments",
      file: null,
      ghost: { reason: "drift_added", text: "추가됨 (클러스터에만 있음)" },
      ghostFromRules: [],
      markers: markers({ drift: { change: "added", fieldCount: 0, hidden: { default: 0, managed: 0 }, reasonCode: null, reasonText: null } }),
      navigate: { primary: "drift", file: null, line: null, resourceKey: "apps/Deployment/prod/payments", secretName: null },
    }),
  ];
  return {
    state: "ok",
    version: "sha256:test",
    builtAt: "2026-09-20T00:00:00.000Z",
    rulesVersion: 1,
    snapshotStatus: { status: "ok", reasons: [], updatedAt: "", statusChangedAt: "", stale: false },
    cluster: null,
    summary: {
      plates: 1,
      documents: 3,
      namespaceDocuments: 1,
      resourceBlocks: 2,
      ghosts: 3,
      unparsedBlocks: 0,
      blocks: 5,
      edges: 2,
      edgesDefaultOn: 1,
      driftMarkers: 2,
      scanMarkers: 0,
      outsideFindings: 0,
      grouped: false,
      groupThreshold: 3000,
      truncated: { blocks: false, edges: false, droppedBlocks: 0, droppedEdges: 0, reason: null },
    },
    layers: [
      { id: "storage", label: "저장·설정", kinds: [] },
      { id: "workload", label: "워크로드", kinds: [] },
      { id: "service", label: "서비스", kinds: [] },
      { id: "ingress", label: "진입", kinds: [] },
      { id: "aux", label: "곁", kinds: ["*"] },
    ],
    rules: [],
    plates: [plate("ns:prod", "prod")],
    blocks,
    edges: [
      edge("K5|api|cm", "K5", "apps/Deployment/prod/api", "core/ConfigMap/prod/api-config"),
      edge("K9|api|sa", "K9", "apps/Deployment/prod/api", "ghost:core/ServiceAccount/prod/default"),
    ],
    groups: [],
    facets: {
      namespaces: [],
      kinds: [],
      rules: [],
      drift: { changed: 1, deleted: 0, added: 1, same: 1, uncomparable: 0, skipped: 0, none: 2 },
      scan: { errorBlocks: 0, warningBlocks: 0 },
      ghosts: 3,
      notes: [],
    },
    drift: {
      requested: true,
      usable: true,
      reasonCode: null,
      reasonText: null,
      badge: {
        status: { status: "warning", reasons: [], updatedAt: "", statusChangedAt: "", stale: false },
        mode: "auto",
        computing: false,
        computed: true,
        computedAt: "2026-09-20T00:00:00.000Z",
        lastResultStatus: "warning",
        counts: null,
        resultAvailable: true,
      },
      computedAt: "2026-09-20T00:00:00.000Z",
      addedCheck: "checked",
      stale: false,
      actions: { computeDrift: { allowed: true, reasonCode: null, reasonText: null } },
    },
    scan: { summary: { errors: 0, warnings: 0, strict: false, passed: true, rules: [] }, outsideResources: { errors: 0, warnings: 0, files: [] } },
    notices: [],
  };
}

const q = (over: Partial<GraphQuery> = {}): GraphQuery => ({ ...EMPTY_GRAPH_QUERY, ...over });

describe("3D 보기 필터 (재조회 없이 응답 안에서, AC-3D10)", () => {
  it("기본 켬 집합은 K1~K7 이고, 그 밖의 규칙이 만든 유령은 숨긴다 (4.4)", () => {
    expect(activeRules(q())).toEqual(DEFAULT_RULES);
    const f = filterGraph(graphFixture(), q(), null);
    // K9 가 만든 ServiceAccount 유령과 그 선은 빠지고, Secret(K6)·추가됨 유령은 남는다
    expect(f.blocks.map((b) => b.id)).toEqual([
      "apps/Deployment/prod/api",
      "core/ConfigMap/prod/api-config",
      "ghost:core/Secret/prod/creds",
      "ghost:apps/Deployment/prod/payments",
    ]);
    expect(f.edges.map((e) => e.rule)).toEqual(["K5"]);
    expect(f.ghosts).toBe(2);
    expect(f.driftMarkers).toBe(2);
  });

  it("K9 를 켜면 유령과 선이 함께 돌아온다", () => {
    const f = filterGraph(graphFixture(), q({ grel: [...DEFAULT_RULES, "K9"] }), null);
    expect(f.blocks.some((b) => b.id === "ghost:core/ServiceAccount/prod/default")).toBe(true);
    expect(f.edges.map((e) => e.rule).sort()).toEqual(["K5", "K9"]);
  });

  it("드리프트 겹쳐 보기를 끄면 추가됨 유령이 사라지고 표식도 세지 않는다 (4.4)", () => {
    const f = filterGraph(graphFixture(), q({ gdrift: false }), null);
    expect(f.blocks.some((b) => b.ghost?.reason === "drift_added")).toBe(false);
    expect(f.driftMarkers).toBe(0);
  });

  it("주변만 보기는 선택 블록과 한 단계만 남긴다", () => {
    const f = filterGraph(graphFixture(), q({ gfocus: true }), "apps/Deployment/prod/api");
    expect(f.blocks.map((b) => b.id)).toEqual(["apps/Deployment/prod/api", "core/ConfigMap/prod/api-config"]);
  });

  it("검색은 부분 일치·대소문자 무시", () => {
    const f = filterGraph(graphFixture(), q(), null);
    expect(searchMatches(f.blocks, "CONFIG")).toEqual(["core/ConfigMap/prod/api-config"]);
    expect(searchMatches(f.blocks, "")).toEqual([]);
  });

  it("기본 켬 집합 그대로면 '필터를 건 상태'가 아니다", () => {
    expect(isFiltered(q())).toBe(false);
    expect(isFiltered(q({ grel: DEFAULT_RULES }))).toBe(false);
    expect(isFiltered(q({ gkind: ["Deployment"] }))).toBe(true);
  });
});

describe("배치 (같은 입력이면 같은 자리, AC-3D11)", () => {
  it("좌표는 서버가 주지 않고 순서로만 정해진다 — 두 번 계산해도 같다", () => {
    const a = computeLayout(graphFixture());
    const b = computeLayout(graphFixture());
    for (const [id, pos] of a.blocks) expect(b.blocks.get(id)).toEqual(pos);
    expect(a.presentLayers).toEqual(["storage", "workload"]);
    // 비어 있는 층(service·ingress)은 자리를 차지하지 않는다 → 워크로드가 10u(층 간격)로 내려온다
    expect(a.layerY.workload).toBe(U.layerGap);
  });

  it("필터를 걸어도 남은 블록의 자리가 바뀌지 않는다 (배치는 전체 블록으로 계산)", () => {
    const g = graphFixture();
    const all = computeLayout(g);
    const filteredGraph = { ...g };
    const after = computeLayout(filteredGraph);
    expect(after.blocks.get("apps/Deployment/prod/api")).toEqual(all.blocks.get("apps/Deployment/prod/api"));
  });
});

describe("표식·이동·문구", () => {
  it("uncomparable·skipped 는 DriftKind 가 아니라 notComparable 로 간다 (4.8)", () => {
    const m = markerSource(
      markers({ drift: { change: "uncomparable", fieldCount: 0, hidden: { default: 0, managed: 0 }, reasonCode: "NOT_IN_RBAC", reasonText: "대시보드 권한 밖" } }),
    );
    expect(m.drift).toBeNull();
    expect(m.notComparable).toEqual({ reason: "NOT_IN_RBAC", text: "대시보드 권한 밖", kind: "uncomparable" });
  });

  it("overlay 표식에는 표시 문구를 넣지 않는다 (7.4)", () => {
    const notes = [{ code: "selector_missing", text: "셀렉터 없음(수동 Endpoints·ExternalName)" }];
    expect(markerSource(markers(), { notes }).notes).toHaveLength(1);
    expect(markerSource(markers(), { notes, variant: "overlay" }).notes).toHaveLength(0);
  });

  it("이동 주소는 기존 상세 쿼리로 조립한다 (AC-3D32)", () => {
    const b = graphFixture().blocks[0];
    expect(navigatePatch(b.navigate, "files")).toEqual({ view: "files", file: "prod/deployments/api.yaml", line: "1", res: null });
    const ghost = graphFixture().blocks[4];
    expect(primaryPatch(ghost.navigate)).toEqual({ view: "drift", res: "apps/Deployment/prod/payments", file: null, line: null });
    const params = new URLSearchParams("view=3d&gns=prod&res=x");
    expect(detailHref("/snapshots/k8s/1", params, { view: "drift", res: "apps/Deployment/prod/api", file: null, line: null })).toBe(
      "/snapshots/k8s/1?view=drift&gns=prod&res=apps%2FDeployment%2Fprod%2Fapi",
    );
  });

  it("개수 문구는 3D 정보 줄과 표가 같은 값을 쓴다 (AC-3D04)", () => {
    expect(countText(12, 24, { blocks: 33, edges: 27 }, true)).toBe("블록 33개 중 12개 · 관계 24개");
    expect(countText(27, 15, { blocks: 33, edges: 27 }, false)).toBe("블록 27 · 관계 15");
    expect(tableSummaryText({ blocks: 27, ghosts: 3, edges: 15, driftMarkers: 3, scanMarkers: 0 }, { blocks: 33 }, false)).toBe(
      "블록 27개(유령 3) · 관계 15개 · 드리프트 표식 3 · 스캔 표식 0",
    );
  });

  it("라벨 밀도 기본값은 블록 150개를 기준으로 바뀐다 (4.7)", () => {
    expect(defaultLabelDensity(150)).toBe("all");
    expect(defaultLabelDensity(151)).toBe("selected");
  });
});

describe("관계 표 행 (8.2·8.3)", () => {
  it("판 → 층 → 리소스 순서로 평탄화하고, 접힌 그룹의 자식은 빼놓는다", () => {
    const g = graphFixture();
    const f = filterGraph(g, q(), null);
    const rows = buildRowSpecs(g, f.blocks, { expanded: new Set(["ns:prod", "ns:prod::storage", "ns:prod::workload"]), sort: "default", driftOn: true });
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual([
      "plate:ns:prod",
      "layer:ns:prod::storage",
      "resource:core/ConfigMap/prod/api-config",
      "resource:ghost:core/Secret/prod/creds",
      "layer:ns:prod::workload",
      "resource:apps/Deployment/prod/api",
      "resource:ghost:apps/Deployment/prod/payments",
    ]);
    const collapsed = buildRowSpecs(g, f.blocks, { expanded: new Set(["ns:prod"]), sort: "default", driftOn: true });
    expect(collapsed.filter((r) => r.kind === "resource")).toHaveLength(0);
  });
});
