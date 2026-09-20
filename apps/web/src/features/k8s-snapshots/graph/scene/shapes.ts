/**
 * 블록 모양 9종의 지오메트리 (snapshot-3d.md **4.11**). 3D 청크 안에서만 쓴다(`scene/**`).
 *
 * - **봉투(envelope) 고정**: 모든 모양이 `4u(x) × 3u(y) × 4u(z)` 안에 들어가고, **상단 평면이 정확히 3u**,
 *   `(0, 3u, 0)`은 언제나 솔리드다(4.11.0). 이 셋을 어기면 장면 bbox 가 바뀌어 카메라·라벨 실측값이 전부 무효가 된다.
 * - 좌표는 **u 단위 그대로** 만든다(x·z ∈ [−2, 2], y ∈ [−1.5, 1.5] = 블록 중심 기준). 정규화 정육면체로 만들면
 *   비균등 스케일(4 × 3 × 4) 때문에 **법선이 찌그러져 밝기 양자화가 틀린다.** 엔진은 `w/4 · h/3 · d/4` 로만 스케일한다
 *   (곁 타일은 축에 나란한 상자라 비균등 스케일에도 법선이 그대로다).
 * - 밝기는 **정점 색으로 굽는다**(빛·그림자 계산 없음, 4.11.3): `t = n · l` 을 100 / 82 / 64% 세 값으로 **양자화**한다.
 *   보간·그라데이션을 쓰지 않는다(면 색 = 층이 흐려지지 않게).
 * - 윤곽선은 **인접 면 법선각 25° 이상**인 모서리만(`EdgesGeometry` thresholdAngle 25°). 16각 원통의 세로 모서리는
 *   22.5° 라 빠져 매끈한 원통이 된다(4.11.1).
 * - 모양 ↔ 종류 **매핑 표는 여기에 두지 않는다.** 퍼블리셔의 `kindShape()`(`components.md` 16.12)가 단일 출처다.
 */
import { BufferGeometry, EdgesGeometry, Float32BufferAttribute } from "three";

// **타입만** 가져온다(런타임 import 가 아니라 청크 경계에 영향이 없다). 값 매핑은 `kindShape()` 한 곳뿐이다
import type { VizShape } from "@/components/ui/viz/KindIcon";

import { U } from "../layout";

export type { VizShape };

export const VIZ_SHAPES: VizShape[] = ["box", "stack", "cylinder", "panel", "roof", "chamfer", "gate", "diamond", "tile"];

/** 고정 광원 (4.11.3). 방위 −78° · 고도 60°, 정규화됨 */
const LIGHT = { x: -0.49, y: 0.87, z: 0.1 } as const;

/** 면 밝기 3단 — 값은 100 / 82 / 64% 세 개뿐이다 (4.11.3) */
export function shadeForNormal(nx: number, ny: number, nz: number): number {
  const len = Math.hypot(nx, ny, nz) || 1;
  const t = (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / len;
  if (t >= 0.65) return 1;
  if (t >= 0.2) return 0.82;
  return 0.64;
}

const HW = U.block / 2; // 2u (x·z 반폭)
const TOP = U.blockHeight / 2; // +1.5u (= 3u 평면)
const BOT = -U.blockHeight / 2; // −1.5u (층 바닥)
/** 층 바닥 기준 높이(u) → 블록 중심 기준 y */
const yAt = (u: number) => u - U.blockHeight / 2;

type P3 = [number, number, number];

/** 삼각형을 모으면서 면 법선으로 밝기를 굽는다 */
class ShapeBuilder {
  readonly pos: number[] = [];
  readonly col: number[] = [];

  tri(a: P3, b: P3, c: P3) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const s = shadeForNormal(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(s, s, s);
    }
  }

  quad(a: P3, b: P3, c: P3, d: P3) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** 축에 나란한 상자. `skip` 으로 보이지 않는 면(다른 부분에 가린 면)을 뺀다 */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, skip: { top?: boolean; bottom?: boolean } = {}) {
    if (!skip.top) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (!skip.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
  }

  /** 사각 절두체: 아래 반폭 `a`(y0) → 위 반폭 `b`(y1) */
  frustum(a: number, y0: number, b: number, y1: number, caps: { top?: boolean; bottom?: boolean } = {}) {
    const ring = (h: number, y: number): P3[] => [
      [-h, y, h],
      [h, y, h],
      [h, y, -h],
      [-h, y, -h],
    ];
    const lo = ring(a, y0);
    const hi = ring(b, y1);
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      this.quad(lo[i], lo[j], hi[j], hi[i]);
    }
    if (caps.top) this.quad(hi[0], hi[1], hi[2], hi[3]);
    if (caps.bottom) this.quad(lo[3], lo[2], lo[1], lo[0]);
  }

  /** 정n각 기둥(세로). 각도를 **내림차순**으로 돌아야 옆면 법선이 바깥을 본다 */
  prism(sides: number, radius: number, y0: number, y1: number) {
    const ring = (y: number): P3[] => {
      const out: P3[] = [];
      for (let i = 0; i < sides; i += 1) {
        const t = (-2 * Math.PI * i) / sides;
        out.push([radius * Math.cos(t), y, radius * Math.sin(t)]);
      }
      return out;
    };
    const lo = ring(y0);
    const hi = ring(y1);
    for (let i = 0; i < sides; i += 1) {
      const j = (i + 1) % sides;
      this.quad(lo[i], lo[j], hi[j], hi[i]);
    }
    for (let i = 1; i < sides - 1; i += 1) this.tri(hi[0], hi[i], hi[i + 1]);
    for (let i = 1; i < sides - 1; i += 1) this.tri(lo[0], lo[i + 1], lo[i]);
  }
}

/**
 * 4.11.1 치수표 그대로. **봉투를 벗어나는 값을 쓰지 않는다.**
 * (치수는 층 바닥 기준 u. y 는 `yAt()` 로 블록 중심 기준으로 옮긴다)
 */
function buildShape(shape: VizShape): ShapeBuilder {
  const b = new ShapeBuilder();
  switch (shape) {
    case "stack": {
      // 아래 단 4 × 4 (y 0 → 0.9) · 위 단 2.4 × 2.4 (y 0.9 → 3.0)
      const ledge = yAt(0.9);
      b.box(-HW, HW, BOT, ledge, -HW, HW, { bottom: true });
      b.box(-1.2, 1.2, ledge, TOP, -1.2, 1.2, { bottom: true });
      break;
    }
    case "cylinder":
      // 지름 4u = 반지름 2u, 16각 근사. 세로 모서리(22.5°)는 윤곽에서 빠진다
      b.prism(16, HW, BOT, TOP);
      break;
    case "panel":
      // x 4u × z 1.2u. **판 면은 x축과 나란히 고정**(카메라를 돌려도 따라 돌지 않는다)
      b.box(-HW, HW, BOT, TOP, -0.6, 0.6);
      break;
    case "roof": {
      // 처마(x = ±2) 1.0u · **용마루 x = 0, z 전 구간** 3.0u (4.11.1 치수표 그대로)
      const eave = yAt(1.0);
      b.quad([-HW, BOT, -HW], [HW, BOT, -HW], [HW, BOT, HW], [-HW, BOT, HW]); // 밑면
      b.quad([HW, BOT, HW], [HW, BOT, -HW], [HW, eave, -HW], [HW, eave, HW]); // +x 벽
      b.quad([-HW, BOT, -HW], [-HW, BOT, HW], [-HW, eave, HW], [-HW, eave, -HW]); // −x 벽
      b.quad([HW, eave, HW], [HW, eave, -HW], [0, TOP, -HW], [0, TOP, HW]); // +x 사면
      b.quad([-HW, eave, -HW], [-HW, eave, HW], [0, TOP, HW], [0, TOP, -HW]); // −x 사면
      // 박공(z = ±2): 오각형 팬. 단면은 (x, y)
      const gable: [number, number][] = [
        [-HW, BOT],
        [HW, BOT],
        [HW, eave],
        [0, TOP],
        [-HW, eave],
      ];
      for (let i = 1; i < gable.length - 1; i += 1) {
        b.tri([gable[0][0], gable[0][1], HW], [gable[i][0], gable[i][1], HW], [gable[i + 1][0], gable[i + 1][1], HW]);
      }
      const back = [...gable].reverse();
      for (let i = 1; i < back.length - 1; i += 1) {
        b.tri([back[0][0], back[0][1], -HW], [back[i][0], back[i][1], -HW], [back[i + 1][0], back[i + 1][1], -HW]);
      }
      break;
    }
    case "chamfer": {
      // 수직 4 × 4 (y 0 → 1.6) → 사면으로 1.6 × 1.6 (y 3.0)
      const start = yAt(1.6);
      b.box(-HW, HW, BOT, start, -HW, HW, { top: true });
      b.frustum(HW, start, 0.8, TOP, { top: true });
      break;
    }
    case "gate": {
      // 다리 4개(1.2 × 1.2, y 0 → 1.6) + 상단 보 4 × 4 × 1.4. 구멍 1.6u 는 어느 방위에서도 보인다
      const beam = yAt(1.6);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const x0 = sx < 0 ? -HW : 0.8;
          const x1 = sx < 0 ? -0.8 : HW;
          const z0 = sz < 0 ? -HW : 0.8;
          const z1 = sz < 0 ? -0.8 : HW;
          b.box(x0, x1, BOT, beam, z0, z1, { top: true });
        }
      }
      // 보의 밑면(구멍 천장)은 64% 로 어둡게 읽힌다 — 지우지 않는다
      b.box(-HW, HW, beam, TOP, -HW, HW);
      break;
    }
    case "diamond": {
      // 밑면 2.0 → y 1.4 에서 4.0(최대 폭) → y 3.0 에서 1.6
      const waist = yAt(1.4);
      b.frustum(1, BOT, HW, waist, { bottom: true });
      b.frustum(HW, waist, 0.8, TOP, { top: true });
      break;
    }
    case "tile":
    case "box":
    default:
      b.box(-HW, HW, BOT, TOP, -HW, HW);
      break;
  }
  return b;
}

const geometryCache = new Map<VizShape, BufferGeometry>();
const edgeCache = new Map<VizShape, Float32Array>();

/** 모양 지오메트리(밝기를 정점 색으로 구운 것). **장면마다 한 번만** 만들고 인스턴싱으로 쓴다 */
export function shapeGeometry(shape: VizShape): BufferGeometry {
  const hit = geometryCache.get(shape);
  if (hit) return hit;
  const b = buildShape(shape);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(b.pos, 3));
  geo.setAttribute("color", new Float32BufferAttribute(b.col, 3));
  geo.computeBoundingSphere();
  geometryCache.set(shape, geo);
  return geo;
}

/** 모양별 윤곽 모서리(25° 이상). `[x0,y0,z0, x1,y1,z1, …]` u 단위 */
export function shapeEdgeTemplate(shape: VizShape): Float32Array {
  const hit = edgeCache.get(shape);
  if (hit) return hit;
  const edges = new EdgesGeometry(shapeGeometry(shape), 25);
  const attr = edges.getAttribute("position");
  const out = new Float32Array(attr.array as ArrayLike<number>);
  edges.dispose();
  edgeCache.set(shape, out);
  return out;
}

/**
 * 모양 윤곽을 세계 좌표로 옮겨 담는다. 스케일은 **봉투 대비 비율**이라 곁 타일(6 × 0.75 × 3)도 같은 함수로 처리된다.
 * `pad` 는 선택·검색 윤곽을 블록보다 살짝 밖에 그리기 위한 여유(u).
 */
export function pushShapeEdges(
  target: number[],
  shape: VizShape,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  pad = 0,
) {
  const tpl = shapeEdgeTemplate(shape);
  const sx = (w + 2 * pad) / U.block;
  const sy = (h + 2 * pad) / U.blockHeight;
  const sz = (d + 2 * pad) / U.block;
  for (let i = 0; i < tpl.length; i += 3) {
    target.push(x + tpl[i] * sx, y + tpl[i + 1] * sy, z + tpl[i + 2] * sz);
  }
}

/** 측정용(4.11.5 삼각형 상한 확인). 화면 동작에는 쓰지 않는다 */
export function shapeStats(): Record<string, { triangles: number; segments: number }> {
  const out: Record<string, { triangles: number; segments: number }> = {};
  for (const s of VIZ_SHAPES) {
    out[s] = {
      triangles: shapeGeometry(s).getAttribute("position").count / 3,
      segments: shapeEdgeTemplate(s).length / 6,
    };
  }
  return out;
}

/** 자가 점검: 봉투(4u × 3u × 4u)를 벗어난 정점이 있으면 모양 id 를 돌려준다 (4.11.0-1·3) */
export function shapesOutsideEnvelope(): string[] {
  const bad: string[] = [];
  for (const s of VIZ_SHAPES) {
    const attr = shapeGeometry(s).getAttribute("position");
    let solidTop = false;
    for (let i = 0; i < attr.count; i += 1) {
      const x = attr.getX(i);
      const y = attr.getY(i);
      const z = attr.getZ(i);
      if (Math.abs(x) > HW + 1e-6 || Math.abs(z) > HW + 1e-6 || y > TOP + 1e-6 || y < BOT - 1e-6) {
        bad.push(`${s}:envelope`);
        break;
      }
      if (y > TOP - 1e-6 && Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6) solidTop = true;
    }
    // 상단 평면이 3u 에 닿는지(라벨 앵커가 허공에 뜨지 않게, 4.11.0-2)
    let touchesTop = false;
    for (let i = 0; i < attr.count; i += 1) {
      if (attr.getY(i) > TOP - 1e-6) {
        touchesTop = true;
        break;
      }
    }
    if (!touchesTop) bad.push(`${s}:top`);
    // `roof`·`diamond`·`chamfer` 처럼 상단이 좁은 모양도 (0, 3u, 0) 은 솔리드여야 한다
    if (!solidTop && !topCenterInside(s)) bad.push(`${s}:center`);
  }
  return bad;
}

/**
 * 상단 평면 3u 에서 `(0, 3u, 0)` 이 솔리드인지 — 꼭짓점이 아니어도 되고, `roof` 처럼
 * **면이 아니라 능선**이어도 된다(4.11.1: 용마루 중심선이 3u).
 */
function topCenterInside(shape: VizShape): boolean {
  const attr = shapeGeometry(shape).getAttribute("position");
  for (let t = 0; t < attr.count; t += 3) {
    // ① 상단 평면에 놓인 모서리(능선)가 (0, ·, 0) 을 지나는가
    for (let e = 0; e < 3; e += 1) {
      const i = t + e;
      const j = t + ((e + 1) % 3);
      if (attr.getY(i) < TOP - 1e-6 || attr.getY(j) < TOP - 1e-6) continue;
      const ax = attr.getX(i);
      const az = attr.getZ(i);
      const dx = attr.getX(j) - ax;
      const dz = attr.getZ(j) - az;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-12) continue;
      if (Math.abs(dx * (0 - az) - dz * (0 - ax)) > 1e-6) continue;
      const s = ((0 - ax) * dx + (0 - az) * dz) / len2;
      if (s >= -1e-6 && s <= 1 + 1e-6) return true;
    }
    // ② 상단 면(삼각형) 안에 들어오는가
    const ys = [attr.getY(t), attr.getY(t + 1), attr.getY(t + 2)];
    if (ys.some((y) => y < TOP - 1e-6)) continue;
    const ax = attr.getX(t);
    const az = attr.getZ(t);
    const bx = attr.getX(t + 1);
    const bz = attr.getZ(t + 1);
    const cx = attr.getX(t + 2);
    const cz = attr.getZ(t + 2);
    const d1 = (0 - bx) * (az - bz) - (ax - bx) * (0 - bz);
    const d2 = (0 - cx) * (bz - cz) - (bx - cx) * (0 - cz);
    const d3 = (0 - ax) * (cz - az) - (cx - ax) * (0 - az);
    const neg = d1 < 1e-9 && d2 < 1e-9 && d3 < 1e-9;
    const pos = d1 > -1e-9 && d2 > -1e-9 && d3 > -1e-9;
    if (neg || pos) return true;
  }
  return false;
}

/** 자원 해제 (테마 전환·언마운트에서 캐시를 비운다) */
export function disposeShapeCache() {
  for (const g of geometryCache.values()) g.dispose();
  geometryCache.clear();
  edgeCache.clear();
}
