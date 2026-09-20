/**
 * 블록 모양 9종의 **불변 점검** (snapshot-3d.md 4.11.0).
 * 여기가 깨지면 장면 bbox 가 달라져 카메라·라벨 실측값(`d0` 179u · `px_per_u` 5.45 · `fit` 1.00005 …)이 전부 무효가 된다.
 */
import { describe, expect, it } from "vitest";

import { U } from "../layout";
import { shapeEdgeTemplate, shapeGeometry, shapeStats, shapesOutsideEnvelope, VIZ_SHAPES } from "./shapes";

const HW = U.block / 2;
const TOP = U.blockHeight / 2;

/** 4.11.5 삼각형 상한 */
const TRIANGLE_BUDGET: Record<string, number> = {
  box: 12,
  stack: 20,
  cylinder: 64,
  panel: 12,
  roof: 20,
  chamfer: 28,
  gate: 60,
  diamond: 28,
  tile: 12,
};

describe("블록 모양 (4.11)", () => {
  it("9종이다 (8종 + 곁 타일)", () => {
    expect(VIZ_SHAPES).toHaveLength(9);
  });

  it("모두 봉투 4u × 3u × 4u 안에 있고 상단 평면이 3u, (0, 3u, 0)이 솔리드다", () => {
    expect(shapesOutsideEnvelope()).toEqual([]);
  });

  it.each(VIZ_SHAPES)("%s: 발자국·높이가 봉투를 넘지 않는다", (shape) => {
    const pos = shapeGeometry(shape).getAttribute("position");
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i += 1) {
      expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(HW + 1e-6);
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(HW + 1e-6);
      expect(pos.getY(i)).toBeLessThanOrEqual(TOP + 1e-6);
      maxY = Math.max(maxY, pos.getY(i));
    }
    expect(maxY).toBeCloseTo(TOP, 6);
  });

  it.each(VIZ_SHAPES)("%s: 밝기는 100 / 82 / 64% 세 값뿐이다 (그라데이션 없음)", (shape) => {
    const col = shapeGeometry(shape).getAttribute("color");
    const seen = new Set<number>();
    for (let i = 0; i < col.count; i += 1) seen.add(Number(col.getX(i).toFixed(4)));
    for (const v of seen) expect([1, 0.82, 0.64]).toContain(v);
  });

  it.each(VIZ_SHAPES)("%s: 삼각형이 상한 안이다", (shape) => {
    expect(shapeStats()[shape].triangles).toBeLessThanOrEqual(TRIANGLE_BUDGET[shape]);
  });

  it("고유 지오메트리 삼각형 합계가 256 이하다", () => {
    const stats = shapeStats();
    const total = VIZ_SHAPES.reduce((sum, s) => sum + stats[s].triangles, 0);
    expect(total).toBeLessThanOrEqual(256);
  });

  it("원통은 세로 모서리(22.5°)가 윤곽에 없다 — 위·아래 링만 남는다", () => {
    expect(shapeEdgeTemplate("cylinder").length / 6).toBe(32);
  });

  it("기본 상자의 윤곽은 12 모서리다", () => {
    expect(shapeEdgeTemplate("box").length / 6).toBe(12);
  });

  it("모양마다 윤곽 모서리 수가 다르다 (22px에서 갈리는 근거)", () => {
    const counts = VIZ_SHAPES.map((s) => shapeEdgeTemplate(s).length / 6);
    // `box` 와 `panel`·`tile` 은 같은 12 모서리(크기로 갈린다), 그 밖은 서로 다르다
    expect(new Set(counts).size).toBeGreaterThanOrEqual(6);
  });

  it("지오메트리를 다시 만들지 않는다 (인스턴싱 전제)", () => {
    expect(shapeGeometry("gate")).toBe(shapeGeometry("gate"));
  });
});
