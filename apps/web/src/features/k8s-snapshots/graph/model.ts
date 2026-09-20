/**
 * snapshot-3d 1단계 화면 도우미 (순수 함수, 테스트 대상).
 *
 * - 관계·드리프트·표식·층·순서는 **서버 값 그대로** 쓴다(계약 1.3, common.md 2.2).
 *   여기서 하는 것은 ① 필터(재조회 없이) ② 배치 좌표 계산(3D-D 4.1~4.3) ③ 표 행 만들기뿐이다.
 * - 배치는 오직 서버가 준 순서와 아래 규칙으로 정해진다. 난수·force layout 을 쓰지 않는다(AC-3D11).
 */
import { blockMarkerItems, NOTE_SPEC, type BlockMarkerSource, type BlockNote, type VizLayer } from "@/components/ui";

import type {
  GraphBlock,
  GraphData,
  GraphEdge,
  GraphMarkers,
  GraphNavigate,
  GraphNote,
  GraphPlate,
  VizLayerId,
} from "./types";

// ---------------------------------------------------------------- 쿼리 (query.ts)

export * from "./query";

// ---------------------------------------------------------------- 표식·표시 문구 → publisher 컴포넌트 값

/** `markers.drift.change` 중 `uncomparable`·`skipped` 는 DriftKind 가 아니라 `notComparable` 로 간다(4.8) */
export function markerSource(
  markers: GraphMarkers,
  opts: {
    ghost?: GraphBlock["ghost"];
    notes?: GraphNote[];
    hrefs?: { scan?: string; drift?: string };
    /**
     * 표시 문구를 어디까지 넣을지 (7.4).
     * `overlay` 블록 위 원 = 없음 / `panel` 선택 패널 ③ = 성질 문구만(관계 사유는 ④ InlineAlert 가 맡는다) /
     * `table` 관계 표 표식 열 = 전부
     */
    variant?: "overlay" | "panel" | "table";
  } = {},
): BlockMarkerSource {
  const d = markers.drift;
  const change = d?.change;
  const notComparable =
    change === "uncomparable" || change === "skipped"
      ? {
          reason: d?.reasonCode ?? undefined,
          text: d?.reasonText ?? (change === "skipped" ? "비교 못 함 (해석 실패·중복)" : "비교 불가"),
          kind: change,
        }
      : null;
  return {
    scan: markers.scan.level ? { level: markers.scan.level, count: markers.scan.count } : null,
    drift:
      change === "changed" || change === "deleted" || change === "added"
        ? { kind: change, fieldCount: d?.fieldCount }
        : null,
    notComparable,
    fileIssue: markers.fileIssue,
    helm: markers.helm,
    ghost: opts.ghost ? { reason: opts.ghost.reason, text: opts.ghost.text } : null,
    notes: noteItems(opts.notes ?? [], opts.variant ?? "table"),
    hrefs: opts.hrefs ?? null,
  };
}

/**
 * 표식 알약·표 표식 열 ⑤ 정보 자리에 오는 `notes` 코드 (7.4).
 * 파일 문제(`path_mismatch`·`duplicate`·`runtime_fields`·`multi_document`·`parse_failed`)는
 * `markers.fileIssue` 로 이미 한 번 나오므로 여기 넣지 않는다(같은 말이 두 번 나오지 않게).
 */
const TRAIT_NOTES = new Set(["custom_resource", "namespace_file_missing"]);
const RELATION_NOTES = new Set(["selector_missing", "no_target", "pvc_template_unmatched"]);

function noteItems(notes: GraphNote[], variant: "overlay" | "panel" | "table"): BlockNote[] {
  if (variant === "overlay") return [];
  const allow = variant === "panel" ? TRAIT_NOTES : new Set([...TRAIT_NOTES, ...RELATION_NOTES]);
  return notes.filter((n) => allow.has(n.code)) as BlockNote[];
}

/** 선택 패널 ④ InlineAlert 자리 — "관계를 그리지 못한 이유"만 (7.4) */
const ALERT_NOTES = new Set(["selector_missing", "no_target", "pvc_template_unmatched", "parse_failed"]);
export const alertNotes = (notes: GraphNote[]): GraphNote[] => notes.filter((n) => ALERT_NOTES.has(n.code));

/** 선택 패널 ③ 칩 자리 (7.4): 파일 문제 밖의 성질 문구 */
const CHIP_NOTES: Record<string, string> = {
  custom_resource: "사용자 지정 리소스",
  multi_document: "한 파일에 2개",
  path_mismatch: "경로 불일치",
  duplicate: "중복 정의",
  runtime_fields: "런타임 필드 남음",
};
export const chipNotes = (notes: GraphNote[]): { code: string; text: string; tooltip: string }[] =>
  notes.filter((n) => CHIP_NOTES[n.code]).map((n) => ({ code: n.code, text: CHIP_NOTES[n.code], tooltip: n.text }));

/**
 * 블록 보조 줄은 **한 줄**이다 (4.7). 우선순위:
 * ① 관계를 못 그린 사유 ② 해석 실패 ③ 유령 사유 ④ 사용자 지정 ⑤ 여러 문서
 */
const NOTE_LINE_ORDER = ["selector_missing", "no_target", "pvc_template_unmatched", "parse_failed"];
export function blockSubLine(block: GraphBlock): { text: string; rest: number; all: string[] } | null {
  const texts: string[] = [];
  for (const code of NOTE_LINE_ORDER) {
    const n = block.notes.find((x) => x.code === code);
    if (!n) continue;
    // 보조 줄은 짧은 문구, 전문(서버 `text`)은 툴팁·선택 패널 ④ 에 남는다 (7.4)
    const spec = NOTE_SPEC[n.code];
    texts.push(spec?.withCount && n.count ? spec.withCount(n.count).short : (spec?.short ?? n.text));
  }
  if (block.ghost) texts.push(block.ghost.text);
  const custom = block.notes.find((n) => n.code === "custom_resource");
  if (custom) texts.push(NOTE_SPEC.custom_resource?.short ?? custom.text);
  const multi = block.notes.find((n) => n.code === "multi_document");
  if (multi && block.file) texts.push(`(문서 ${block.file.documentIndex + 1}/${block.file.documentCount})`);
  if (texts.length === 0) return null;
  return { text: texts[0], rest: texts.length - 1, all: texts };
}

// ---------------------------------------------------------------- 필터 (재조회 없이 응답 안에서, AC-3D10)

export interface FilteredGraph {
  /** 그리는 블록 (서버 순서 유지) */
  blocks: GraphBlock[];
  blockIds: Set<string>;
  /** 그리는 관계선 (양 끝이 모두 보이고 규칙이 켜진 것) */
  edges: GraphEdge[];
  /** 블록 id → 들어오는/나가는 관계 (필터 적용 뒤) */
  byBlock: Map<string, { incoming: GraphEdge[]; outgoing: GraphEdge[] }>;
  ghosts: number;
  driftMarkers: number;
  scanMarkers: number;
}

const hasDriftMark = (m: GraphMarkers): boolean => {
  const c = m.drift?.change;
  return c === "changed" || c === "deleted" || c === "added";
};
const hasScanMark = (m: GraphMarkers): boolean => m.scan.level !== null;

/**
 * 적용 순서(4.4): ① 관계 필터로 유령 숨김 → ② 드리프트 겹쳐 보기 → ③ gns·gkind·gq·gmark → ④ 주변만 보기.
 * 판은 거르지 않는다(공간 기억 유지, 4.1.1).
 */
export function filterGraph(graph: GraphData, q: GraphQuery, selectedId: string | null): FilteredGraph {
  const rules = new Set<string>(activeRules(q));
  const driftOn = q.gdrift && graph.drift.usable;
  const ns = new Set(q.gns);
  const kinds = new Set(q.gkind);
  const marks = new Set(q.gmark);
  const needle = q.gq.trim().toLowerCase();

  const plateName = new Map(graph.plates.map((p) => [p.id, p.name ?? p.id]));

  const keep = (b: GraphBlock): boolean => {
    // ① 관계가 만든 유령: 그 규칙이 모두 꺼지면 숨긴다
    if (b.ghost && b.ghostFromRules && b.ghostFromRules.length > 0) {
      if (!b.ghostFromRules.some((r) => rules.has(r))) return false;
    }
    // ② 드리프트 "추가됨" 유령은 겹쳐 보기를 끄면 숨긴다
    if (b.ghost?.reason === "drift_added" && !driftOn) return false;
    // ③ 네임스페이스·종류·검색·표식
    if (ns.size > 0 && !ns.has(plateName.get(b.plateId) ?? b.plateId)) return false;
    if (kinds.size > 0 && !(b.kind && kinds.has(b.kind))) return false;
    if (needle && !(b.name ?? b.file?.path ?? "").toLowerCase().includes(needle)) return false;
    if (marks.size > 0) {
      const ok =
        (marks.has("drift") && driftOn && hasDriftMark(b.markers)) ||
        (marks.has("scan") && hasScanMark(b.markers)) ||
        (marks.has("ghost") && Boolean(b.ghost));
      if (!ok) return false;
    }
    return true;
  };

  let blocks = graph.blocks.filter(keep);
  let ids = new Set(blocks.map((b) => b.id));
  let edges = graph.edges.filter((e) => rules.has(e.rule) && ids.has(e.from) && ids.has(e.to));

  // ④ 주변만 보기: 선택 블록과 직접 연결된 것만 (한 단계)
  if (q.gfocus && selectedId && ids.has(selectedId)) {
    const near = new Set<string>([selectedId]);
    for (const e of edges) {
      if (e.from === selectedId) near.add(e.to);
      if (e.to === selectedId) near.add(e.from);
    }
    blocks = blocks.filter((b) => near.has(b.id));
    ids = new Set(blocks.map((b) => b.id));
    edges = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  }

  const byBlock = new Map<string, { incoming: GraphEdge[]; outgoing: GraphEdge[] }>();
  for (const b of blocks) byBlock.set(b.id, { incoming: [], outgoing: [] });
  for (const e of edges) {
    byBlock.get(e.to)?.incoming.push(e);
    byBlock.get(e.from)?.outgoing.push(e);
  }

  let ghosts = 0;
  let driftMarkers = 0;
  let scanMarkers = 0;
  for (const b of blocks) {
    if (b.ghost) ghosts += 1;
    if (driftOn && hasDriftMark(b.markers)) driftMarkers += 1;
    if (hasScanMark(b.markers)) scanMarkers += 1;
  }
  // 판 표식은 필터로 사라지지 않는다(4.1.1) — 개수에 항상 더한다
  for (const p of graph.plates) {
    if (driftOn && hasDriftMark(p.markers)) driftMarkers += 1;
    if (hasScanMark(p.markers)) scanMarkers += 1;
  }

  return { blocks, blockIds: ids, edges, byBlock, ghosts, driftMarkers, scanMarkers };
}

/** 검색 결과(카메라 이동 대상). 필터를 통과한 블록 중 이름 부분 일치 — 대소문자 무시 */
export function searchMatches(blocks: GraphBlock[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return blocks.filter((b) => (b.name ?? b.file?.path ?? "").toLowerCase().includes(needle)).map((b) => b.id);
}

// ---------------------------------------------------------------- 배치 (layout.ts)

import { STACK_LAYERS } from "./layout";
import { activeRules, type GraphQuery, type LabelDensity } from "./query";

export { computeLayout, STACK_LAYERS, U, type GraphLayout, type LayoutBlock, type LayoutPlate } from "./layout";

// ---------------------------------------------------------------- 이동 주소 (10.4, AC-3D32)

export type DetailPatch = Record<string, string | null>;

/** 선택 패널·표·판 알약이 쓰는 주소 조각. 주소 조립은 프론트가 한다(계약 4.1) */
export function navigatePatch(nav: GraphNavigate, tab: "files" | "drift" | "secrets"): DetailPatch | null {
  if (tab === "files") {
    if (!nav.file) return null;
    return { view: "files", file: nav.file, line: nav.line ? String(nav.line) : null, res: null };
  }
  if (tab === "drift") {
    if (!nav.resourceKey) return null;
    return { view: "drift", res: nav.resourceKey, file: null, line: null };
  }
  return { view: "secrets", file: null, line: null };
}

/** 두 번 클릭 · Enter 의 기본 이동 (계약 4.1 `navigate.primary`) */
export function primaryPatch(nav: GraphNavigate): DetailPatch | null {
  return nav.primary ? navigatePatch(nav, nav.primary) : null;
}

/** 현재 주소의 `g*` 를 유지한 채 탭만 바꾼 href */
export function detailHref(pathname: string, params: URLSearchParams, patch: DetailPatch): string {
  const next = new URLSearchParams(params.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// ---------------------------------------------------------------- 정보 줄·개수 문구 (6.4)

export function countText(
  drawnBlocks: number,
  drawnEdges: number,
  total: { blocks: number; edges: number },
  filtered: boolean,
): string {
  const n = (v: number) => v.toLocaleString("en-US");
  return filtered
    ? `블록 ${n(total.blocks)}개 중 ${n(drawnBlocks)}개 · 관계 ${n(drawnEdges)}개`
    : `블록 ${n(drawnBlocks)} · 관계 ${n(drawnEdges)}`;
}

export const countTooltip = (total: { blocks: number; ghosts: number; edges: number }): string =>
  `전체 블록 ${total.blocks.toLocaleString("en-US")}(유령 ${total.ghosts.toLocaleString("en-US")}) · 전체 관계 ${total.edges.toLocaleString("en-US")}`;

/** 표 위 요약 — 3D 정보 줄과 **같은 수치** (8.2, AC-3D04) */
export function tableSummaryText(
  f: { blocks: number; ghosts: number; edges: number; driftMarkers: number; scanMarkers: number },
  total: { blocks: number },
  filtered: boolean,
  droppedBlocks = 0,
): string {
  const n = (v: number) => v.toLocaleString("en-US");
  const head = filtered ? `블록 ${n(total.blocks)}개 중 ${n(f.blocks)}개` : `블록 ${n(f.blocks)}개`;
  const parts = [`${head}(유령 ${n(f.ghosts)})`, `관계 ${n(f.edges)}개`, `드리프트 표식 ${n(f.driftMarkers)}`, `스캔 표식 ${n(f.scanMarkers)}`];
  const text = parts.join(" · ");
  return droppedBlocks > 0 ? `${text} (${n(droppedBlocks)}개 제외)` : text;
}

/** `notices[]` 중 정보 줄 칩이 되는 것 (6.6). 표에 없는 code 는 문구 그대로 칩으로 */
const NOTICE_AT: Record<string, "hint" | "legend" | "state" | "plate" | "toolbar" | "chip"> = {
  RELATIONS_PARTIAL: "hint",
  SECRET_VALUES_NOT_INCLUDED: "legend",
  EXPORT_MAYBE_IN_PROGRESS: "state",
  NO_RESOURCES: "state",
  NAMESPACE_FILE_MISSING: "plate",
  UNPARSED_FILES: "plate",
  CUSTOM_RESOURCES_PRESENT: "chip",
  GRAPH_TRUNCATED: "chip",
  GROUPED_VIEW: "chip",
  DRIFT_NOT_OVERLAID: "toolbar",
};
export const noticeAt = (code: string): "hint" | "legend" | "state" | "plate" | "toolbar" | "chip" => NOTICE_AT[code] ?? "chip";

/** `PageDown`/`PageUp` 으로 판에 들어갈 때 읽을 문장 (publisher 요청 ②) */
export function plateAnnouncement(plate: GraphPlate): string {
  const parts: string[] = [`${plate.name ?? plate.id} 판`, `리소스 ${plate.resourceCount.toLocaleString("en-US")}개`];
  for (const m of blockMarkerItems(markerSource(plate.markers, { notes: plate.notes }))) parts.push(m.text);
  return parts.join(", ");
}

// ---------------------------------------------------------------- 관계 표 행 (8절)

export const layerOf = (l: VizLayerId): VizLayer => l;

export interface RowSpec {
  kind: "plate" | "layer" | "resource";
  id: string;
  plateId: string;
  layer?: VizLayerId;
  block?: GraphBlock;
  count: number;
}

/**
 * 표 행 뼈대: 판 → 층 → 리소스 (8.2 기본 정렬 = 3D 배치 순서).
 * - 표식이 있는 판은 자식이 0이어도 남긴다(4.1.1, publisher 요청 ③)
 * - `sort=markers` 면 **판 순서는 그대로** 두고 층 안에서만 표식 있는 것을 앞으로
 */
export function buildRowSpecs(
  graph: GraphData,
  visible: GraphBlock[],
  opts: { expanded: Set<string>; sort: "default" | "markers"; driftOn: boolean },
): RowSpec[] {
  const byPlate = new Map<string, Map<VizLayerId, GraphBlock[]>>();
  for (const b of visible) {
    let m = byPlate.get(b.plateId);
    if (!m) {
      m = new Map();
      byPlate.set(b.plateId, m);
    }
    const list = m.get(b.layer);
    if (list) list.push(b);
    else m.set(b.layer, [b]);
  }
  const layerOrder = [...STACK_LAYERS, "aux" as VizLayerId];
  const markScore = (b: GraphBlock) =>
    (hasScanMark(b.markers) ? 2 : 0) + (opts.driftOn && hasDriftMark(b.markers) ? 1 : 0);

  const rows: RowSpec[] = [];
  for (const p of graph.plates) {
    const layers = byPlate.get(p.id);
    const total = layers ? [...layers.values()].reduce((s, l) => s + l.length, 0) : 0;
    const plateHasMarker = hasScanMark(p.markers) || (opts.driftOn && hasDriftMark(p.markers)) || p.markers.helm || p.notes.length > 0 || p.markers.fileIssue !== null;
    if (total === 0 && !plateHasMarker) continue;
    rows.push({ kind: "plate", id: p.id, plateId: p.id, count: total });
    if (!opts.expanded.has(p.id) || total === 0) continue;
    for (const l of layerOrder) {
      const list = layers?.get(l);
      if (!list || list.length === 0) continue;
      const layerRowId = `${p.id}::${l}`;
      rows.push({ kind: "layer", id: layerRowId, plateId: p.id, layer: l, count: list.length });
      if (!opts.expanded.has(layerRowId)) continue;
      const ordered = opts.sort === "markers" ? [...list].sort((a, b) => markScore(b) - markScore(a)) : list;
      for (const b of ordered) rows.push({ kind: "resource", id: b.id, plateId: p.id, layer: l, block: b, count: 0 });
    }
  }
  return rows;
}

/** 기본 펼침: 리소스 150개 이하면 전부, 넘으면 판만 (8.2) */
export function defaultExpanded(graph: GraphData, blocks: GraphBlock[]): string[] {
  const ids = graph.plates.map((p) => p.id);
  if (blocks.length > 150) return ids;
  const seen = new Set<string>();
  for (const b of blocks) seen.add(`${b.plateId}::${b.layer}`);
  return [...ids, ...seen];
}

/** 라벨 밀도 기본값: 블록 150개 이하 `전체`, 넘으면 `선택·검색 결과만` (4.7) */
export const defaultLabelDensity = (blockCount: number): LabelDensity => (blockCount <= 150 ? "all" : "selected");
