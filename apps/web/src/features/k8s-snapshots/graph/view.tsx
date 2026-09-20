"use client";

/**
 * 계약 값 → publisher 컴포넌트 props 로 옮기는 자리 (3D-D 7·8절).
 * 문구는 **서버 `text` 그대로** 쓰고 화면이 새로 만들지 않는다(6.6·7.4).
 */
import type {
  BlockDetailActions,
  BlockDetailBlock,
  RelationItemProps,
  RelationTableRow,
} from "@/components/ui";

import { alertNotes, detailHref, markerSource, navigatePatch, type RowSpec } from "./model";
import type { GraphBlock, GraphData, GraphEdge, GraphNavigate, GraphPlate } from "./types";

export interface HrefMaker {
  (patch: Record<string, string | null> | null): string | undefined;
}

export const makeHref =
  (pathname: string, params: URLSearchParams): HrefMaker =>
  (patch) =>
    patch ? detailHref(pathname, params, patch) : undefined;

/** 판 알약 클릭 이동 (4.1.1). `navigate.file` 이 없으면 스캔 링크를 주지 않는다(publisher 요청 ①) */
export function plateHrefs(plate: GraphPlate, href: HrefMaker): { scan?: string; drift?: string } {
  const out: { scan?: string; drift?: string } = {};
  if (plate.navigate.file) {
    const line = plate.markers.scan.firstLine ?? plate.fileLine ?? null;
    out.scan = href({ view: "files", file: plate.navigate.file, line: line ? String(line) : null, res: null });
  }
  if (plate.navigate.resourceKey) out.drift = href({ view: "drift", res: plate.navigate.resourceKey, file: null, line: null });
  return out;
}

const driftVisible = (b: GraphBlock, driftOn: boolean): boolean => {
  if (!driftOn) return false;
  const c = b.markers.drift?.change;
  return c === "changed" || c === "deleted" || c === "added";
};

/** 이동 버튼 (10.4) */
export function blockActions(block: GraphBlock, driftOn: boolean, href: HrefMaker): BlockDetailActions {
  const nav: GraphNavigate = block.navigate;
  const fileHref = href(navigatePatch(nav, "files"));
  const driftHref = driftVisible(block, driftOn) ? href(navigatePatch(nav, "drift")) : undefined;
  const secretsHref = block.ghost?.reason === "secret" ? href(navigatePatch(nav, "secrets")) : undefined;
  const actions: BlockDetailActions = {};
  if (fileHref) actions.file = { href: fileHref };
  else if (block.file) actions.file = { disabledReason: "이 리소스는 스냅샷에 파일이 없습니다" };
  if (driftHref) actions.drift = { href: driftHref };
  if (secretsHref) actions.secrets = { href: secretsHref };
  if (!actions.file && !actions.drift && !actions.secrets) actions.note = "스냅샷에 파일이 없어 이동할 곳이 없습니다";
  return actions;
}

export function detailBlock(block: GraphBlock): BlockDetailBlock {
  return {
    id: block.id,
    layer: block.layer,
    kind: block.kind ?? "해석 실패",
    custom: block.custom,
    apiVersion: block.apiVersion,
    name: block.name ?? block.file?.path ?? block.id,
    namespace: block.namespace,
    file: block.file?.path ?? null,
    fileNote: block.file ? undefined : (block.ghost?.text ?? undefined),
    documentIndex: block.file ? block.file.documentIndex + 1 : undefined,
    documentCount: block.file?.documentCount,
    ghost: block.ghost,
  };
}

export function relationItems(
  edges: GraphEdge[],
  direction: "in" | "out",
  blocks: Map<string, GraphBlock>,
  ruleLabel: (id: string) => string,
): RelationItemProps[] {
  return edges
    .map((e) => {
      const peerId = direction === "in" ? e.from : e.to;
      const peer = blocks.get(peerId);
      return {
        direction,
        peer: {
          id: peerId,
          layer: peer?.layer ?? "aux",
          kind: peer?.kind ?? "알 수 없음",
          name: peer?.name ?? peerId,
          ghost: Boolean(peer?.ghost),
          ghostText: peer?.ghost?.text,
        },
        evidence: e.evidence,
        ruleLabel: ruleLabel(e.rule),
        certainty: e.certainty,
        optional: e.optional,
      } satisfies RelationItemProps;
    });
}

export interface TableContext {
  graph: GraphData;
  blocks: Map<string, GraphBlock>;
  byBlock: Map<string, { incoming: GraphEdge[]; outgoing: GraphEdge[] }>;
  driftOn: boolean;
  href: HrefMaker;
  ruleLabel: (id: string) => string;
  /** 판별 **필터 전** 블록 수 — 필터 중이면 `(3 / 11)` 로 함께 보인다 */
  totalByPlate: Map<string, number>;
  /** 표식이 있는데 자식이 0인 판 (8.3) */
  emptyPlates: Set<string>;
}

/** 표 행 (8.2·8.3). 순서는 `buildRowSpecs` 가 정한다 = 3D 배치 순서 */
export function tableRows(specs: RowSpec[], ctx: TableContext): RelationTableRow[] {
  const plateById = new Map(ctx.graph.plates.map((p) => [p.id, p]));
  const layerLabel = new Map(ctx.graph.layers.map((l) => [l.id, l.label]));
  return specs.map((spec): RelationTableRow => {
    if (spec.kind === "plate") {
      const p = plateById.get(spec.plateId)!;
      const hrefs = plateHrefs(p, ctx.href);
      return {
        id: p.id,
        type: "group",
        groupKind: "plate",
        depth: 0,
        label: p.name ?? (p.kind === "cluster" ? "클러스터 범위" : p.kind === "unparsed" ? "해석 실패" : p.id),
        count: spec.count,
        plateKind: p.kind,
        location: p.file,
        markers: markerSource(ctx.driftOn ? p.markers : { ...p.markers, drift: null }, { notes: p.notes, hrefs, variant: "table" }),
        totalCount: ctx.totalByPlate.get(p.id) ?? spec.count,
        actions: {
          ...(hrefs.scan ? { file: { href: hrefs.scan } } : {}),
          ...(hrefs.drift && (ctx.driftOn || p.markers.drift?.change === "changed") ? { drift: { href: hrefs.drift } } : {}),
        },
        emptyHint: ctx.emptyPlates.has(p.id) ? "표시할 리소스 없음" : undefined,
      };
    }
    if (spec.kind === "layer") {
      return {
        id: spec.id,
        type: "group",
        groupKind: "layer",
        depth: 1,
        label: layerLabel.get(spec.layer!) ?? spec.layer!,
        count: spec.count,
        layer: spec.layer,
      };
    }
    const b = spec.block!;
    const deg = ctx.byBlock.get(b.id);
    return {
      id: b.id,
      type: "resource",
      depth: 2,
      layer: b.layer,
      kind: b.kind ?? "해석 실패",
      custom: b.custom,
      name: b.name ?? b.file?.path ?? b.id,
      location: b.namespace ?? (b.blockType === "unparsed" ? "해석 실패" : "클러스터 범위"),
      markers: markerSource(ctx.driftOn ? b.markers : { ...b.markers, drift: null }, {
        ghost: b.ghost,
        notes: b.notes,
        variant: "table",
      }),
      ghost: Boolean(b.ghost),
      incoming: deg?.incoming.length ?? 0,
      outgoing: deg?.outgoing.length ?? 0,
      actions: blockActions(b, ctx.driftOn, ctx.href),
      relations: {
        incoming: relationItems(deg?.incoming ?? [], "in", ctx.blocks, ctx.ruleLabel),
        outgoing: relationItems(deg?.outgoing ?? [], "out", ctx.blocks, ctx.ruleLabel),
      },
    };
  });
}

export const panelNotes = (block: GraphBlock) => alertNotes(block.notes).map((n) => ({ code: n.code, text: n.text }));
