/**
 * 배치 계산 (3D-D 4.1~4.3). **좌표는 서버가 주지 않는다** — 서버가 준 순서·소속으로 화면이 만든다(계약 16절).
 *
 * 이 파일은 UI 컴포넌트를 import 하지 않는다: 3D 청크(three.js)가 이 계산만 가져가고
 * 공용 UI 번들을 3D 청크로 끌고 들어오지 않게 하기 위해서다(AC-3D02 청크 크기).
 */
import type { GraphBlock, GraphData, VizLayerId } from "./types";

// ---------------------------------------------------------------- 배치 (3D-D 4.1~4.3). 좌표는 화면이 만든다

/**
 * 배치 상수 (4.0~4.3, 2026-09-20 designer 재조정).
 * 장면을 **덜 납작하게** 만들어 안전 영역의 두 축이 동시에 차도록 잡은 값이다
 * (판 3열 · 간격 8u · 여백 2u · **층 16u**).
 * 층 간격 16u 는 A~D 네 안을 같은 장면에서 실측해 고른 값이다(2026-09-20): 라벨이 블록을 전혀 덮지 않으면서
 * 이름이 가장 많이 보이고(7/27) 세로 채움도 가장 좋았다(`fillY` 0.786 → 0.866).
 * 격자 셀은 일부러 키우지 않는다: 셀을 키우면 판도 같은 비율로 커져 카메라가 멀어지므로 화면상 간격은 그대로다(4.1).
 */
export const U = {
  cell: 6,
  block: 4,
  blockHeight: 3,
  plateThickness: 0.5,
  layerGap: 16,
  plateMargin: 2,
  auxBand: 3,
  plateGap: 8,
  auxTile: { w: 6, d: 3, h: 0.75 },
  minPlate: 14,
  platesPerRow: 3,
} as const;

/** 층 순서(아래→위). `aux` 는 판 가장자리 띠라 높이를 갖지 않는다 */
export const STACK_LAYERS: VizLayerId[] = ["storage", "workload", "service", "ingress"];


export interface LayoutBlock {
  id: string;
  plateId: string;
  layer: VizLayerId;
  /** 블록 중심 */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  ghost: boolean;
}

export interface LayoutPlate {
  id: string;
  x: number;
  z: number;
  size: number;
  /** 판 앞 모서리 왼쪽 끝(라벨 앵커), 판 상면 */
  anchor: { x: number; y: number; z: number };
  /** 같은 줄에서 몇 번째인가 (라벨 가용 폭 A 계산용) */
  row: number;
  col: number;
  lastInRow: boolean;
}

export interface GraphLayout {
  plates: Map<string, LayoutPlate>;
  blocks: Map<string, LayoutBlock>;
  layerY: Partial<Record<VizLayerId, number>>;
  /** 그 스냅샷에 하나라도 있는 층만 (빈 층은 자리를 차지하지 않는다, 4.2) */
  presentLayers: VizLayerId[];
  center: { x: number; y: number; z: number };
  radius: number;
  diagonal: number;
}

const gridShape = (n: number) => {
  const cols = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(n))));
  const rows = Math.max(1, Math.ceil(n / cols));
  return { cols, rows };
};

/**
 * 같은 입력이면 같은 배치 (AC-3D11).
 * **전체 블록**(필터 전)으로 계산한다 — 필터는 숨기기만 하고 자리를 다시 잡지 않는다(4.3).
 */
export function computeLayout(graph: GraphData): GraphLayout {
  const byPlate = new Map<string, Map<VizLayerId, GraphBlock[]>>();
  for (const p of graph.plates) byPlate.set(p.id, new Map());
  for (const b of graph.blocks) {
    let m = byPlate.get(b.plateId);
    if (!m) {
      m = new Map();
      byPlate.set(b.plateId, m);
    }
    const list = m.get(b.layer);
    if (list) list.push(b);
    else m.set(b.layer, [b]);
  }

  const presentLayers = STACK_LAYERS.filter((l) => graph.blocks.some((b) => b.layer === l));
  const layerY: Partial<Record<VizLayerId, number>> = {};
  presentLayers.forEach((l, i) => {
    layerY[l] = i * U.layerGap;
  });
  if (graph.blocks.some((b) => b.layer === "aux")) layerY.aux = 0;

  // 판 크기: 층 격자의 폭·깊이 최댓값 + 여백·곁 띠, 곁 타일이 들어갈 둘레도 확보
  const sizes = new Map<string, number>();
  for (const [plateId, layers] of byPlate) {
    let maxDim = 0;
    for (const l of STACK_LAYERS) {
      const n = layers.get(l)?.length ?? 0;
      if (n === 0) continue;
      const { cols, rows } = gridShape(n);
      maxDim = Math.max(maxDim, cols * U.cell, rows * U.cell);
    }
    // 곁 띠는 **곁 리소스가 있는 판만** 차지한다 (4.1)
    const aux = layers.get("aux")?.length ?? 0;
    let size = Math.max(U.minPlate, maxDim + 2 * (U.plateMargin + (aux > 0 ? U.auxBand : 0)));
    while (aux > 0 && 4 * Math.floor((size - U.auxTile.w) / U.auxTile.w) < aux) size += U.auxTile.w;
    sizes.set(plateId, size);
  }
  const cell = Math.max(U.minPlate, ...sizes.values());

  // 판 줄 배치: 네임스페이스 판 4장씩, 특수 판(_cluster·_unparsed·유령)은 맨 뒤 줄부터
  const rowsOf: string[][] = [];
  let current: string[] = [];
  let specialStarted = false;
  for (const p of graph.plates) {
    const special = p.kind !== "namespace";
    if (special && !specialStarted && current.length > 0) {
      rowsOf.push(current);
      current = [];
    }
    if (special) specialStarted = true;
    current.push(p.id);
    if (current.length === U.platesPerRow) {
      rowsOf.push(current);
      current = [];
    }
  }
  if (current.length > 0) rowsOf.push(current);

  const step = cell + U.plateGap;
  const colCount = Math.max(1, ...rowsOf.map((r) => r.length));
  const gridW = colCount * cell + (colCount - 1) * U.plateGap;
  const gridD = rowsOf.length * cell + Math.max(0, rowsOf.length - 1) * U.plateGap;

  const plates = new Map<string, LayoutPlate>();
  const blocks = new Map<string, LayoutBlock>();

  rowsOf.forEach((row, r) => {
    row.forEach((plateId, c) => {
      const size = sizes.get(plateId) ?? cell;
      const x = c * step - gridW / 2 + cell / 2;
      // 줄 0 이 앞(+z), 뒤로 갈수록 -z
      const z = gridD / 2 - cell / 2 - r * step;
      plates.set(plateId, {
        id: plateId,
        x,
        z,
        size,
        anchor: { x: x - size / 2, y: 0, z: z + size / 2 },
        row: r,
        col: c,
        lastInRow: c === row.length - 1,
      });

      const layers = byPlate.get(plateId);
      if (!layers) return;
      for (const l of STACK_LAYERS) {
        const list = layers.get(l);
        if (!list || list.length === 0) continue;
        const { cols, rows } = gridShape(list.length);
        const y0 = layerY[l] ?? 0;
        list.forEach((b, i) => {
          const col = i % cols;
          const row2 = Math.floor(i / cols);
          blocks.set(b.id, {
            id: b.id,
            plateId,
            layer: l,
            x: x + (col - (cols - 1) / 2) * U.cell,
            y: y0 + U.blockHeight / 2,
            z: z + ((rows - 1) / 2 - row2) * U.cell,
            w: U.block,
            h: U.blockHeight,
            d: U.block,
            ghost: Boolean(b.ghost),
          });
        });
      }
      // 곁 타일: 판 가장자리 띠를 시계 방향(앞 → 오른쪽 → 뒤 → 왼쪽)으로
      const aux = layers.get("aux");
      if (aux && aux.length > 0) {
        const per = Math.max(1, Math.floor((size - U.auxTile.w) / U.auxTile.w));
        const inset = size / 2 - U.auxBand / 2;
        aux.forEach((b, i) => {
          const side = Math.floor(i / per) % 4;
          const k = i % per;
          const t = (k - (per - 1) / 2) * U.auxTile.w;
          const pos =
            side === 0
              ? { x: x + t, z: z + inset, w: U.auxTile.w, d: U.auxTile.d }
              : side === 1
                ? { x: x + inset, z: z - t, w: U.auxTile.d, d: U.auxTile.w }
                : side === 2
                  ? { x: x - t, z: z - inset, w: U.auxTile.w, d: U.auxTile.d }
                  : { x: x - inset, z: z + t, w: U.auxTile.d, d: U.auxTile.w };
          blocks.set(b.id, {
            id: b.id,
            plateId,
            layer: "aux",
            x: pos.x,
            y: U.auxTile.h / 2,
            z: pos.z,
            w: pos.w,
            h: U.auxTile.h,
            d: pos.d,
            ghost: Boolean(b.ghost),
          });
        });
      }
    });
  });

  const topY = presentLayers.length > 0 ? (presentLayers.length - 1) * U.layerGap + U.blockHeight : U.blockHeight;
  const center = { x: 0, y: topY / 2, z: 0 };
  const diagonal = Math.sqrt(gridW * gridW + gridD * gridD + topY * topY);
  return { plates, blocks, layerY, presentLayers, center, radius: diagonal / 2, diagonal };
}

