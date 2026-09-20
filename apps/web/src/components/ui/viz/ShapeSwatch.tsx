/*
 * components.md 16.13 / snapshot-3d.md 4.11(모양 9종) · 6.5(범례 「모양 = 종류」) · 6.1(종류 필터 옵션).
 *
 * 3D 블록 모양의 **2D 실루엣 견본**. 쓰는 자리는 두 곳뿐이다(4.11.7):
 *   ① 범례의 「모양 = 종류」 절 — 16px · `tone="neutral"`(중립색: 바로 위 층 5줄이 이미 색을 말한다)
 *   ② 종류 필터 옵션 — 14px · `tone="layer"`(색 = 층, 모양 = 종류를 한 번에 보여 주는 자리)
 * 선택 패널·`RelationItem`·관계 표의 **층 색 사각(`LayerSwatch`)은 그대로 둔다** — 거기는 종류 이름이
 * 글자로 함께 있는 자리라 견본을 더하면 같은 말이 세 번 나오고, 작은 실루엣은 층 색을 흐린다.
 *
 * 그리는 법:
 *  - 실루엣은 **기본 시점(방위 −35°·고도 30°)에서 본 윤곽**이다. 장면에서 보는 각도와 같아야 대조가 된다.
 *  - 밝기 3단(100/82/64%)은 쓰지 않는다 — 14~16px에서 세 단은 뭉갠다. **윤곽 + 윗면 경계선 1개**만 그린다.
 *  - 치수(u)는 `snapshot-3d.md` 4.11.1 표가 원본이다. 여기서는 그 비율을 그대로 투영만 한다.
 *  - 언제나 장식(`aria-hidden`)이다 — 견본 옆에 종류 문구가 글자로 있다.
 */
import { cx } from "../cx";
import type { VizShape } from "./KindIcon";
import type { VizLayer } from "./viz";
import styles from "./viz.module.css";

/** u 단위 3D 점 `[x, y, z]`. 봉투는 4u(x) × 3u(y) × 4u(z), **바닥 중심이 원점**(4.11.1) */
type P3 = readonly [number, number, number];
/** viewBox 16×16 안의 화면 점. y 는 **아래로** 증가한다 */
type P2 = readonly [number, number];

/*
 * 기본 시점 정사영. 1u 당 화면 성분(4.0 투영 상수):
 *   x → 가로 +0.82 · 세로 −0.29(위)   z → 가로 +0.57 · 세로 +0.41(아래)   y → 세로 −0.87
 * 이 값이면 왼쪽 옆면이 −x, 오른쪽 옆면이 +z 로 장면과 같은 면이 보인다(4.11.3 밝기 표와 같은 배치).
 * 배율 2.6 은 4u 봉투(가로 5.56u · 세로 5.41u)가 viewBox 16 안에 사방 ~1 여백을 남기고 들어가는 값이다
 * (윤곽선이 1px 고정이라 여백이 반 픽셀보다 커야 잘리지 않는다).
 */
const SCALE = 2.6;
const EX: P2 = [0.82 * SCALE, -0.29 * SCALE];
const EZ: P2 = [0.57 * SCALE, 0.41 * SCALE];
const EY = -0.87 * SCALE;
/** 봉투가 viewBox 한가운데 오도록 잡은 원점(= 블록 바닥 중심) */
const ORIGIN: P2 = [8, 11.39];

function project([x, y, z]: P3): P2 {
  return [ORIGIN[0] + EX[0] * x + EZ[0] * z, ORIGIN[1] + EX[1] * x + EZ[1] * z + EY * y];
}

const crossZ = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const byX = (points: P2[]): P2[] => [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

/** 단조 사슬 한쪽. 화면 좌표(y 아래)에서 **왼 → 오 순서로 주면 위쪽**, 뒤집어 주면 아래쪽 사슬이다 */
function halfHull(points: P2[]): P2[] {
  const out: P2[] = [];
  for (const p of points) {
    while (out.length >= 2 && crossZ(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
    out.push(p);
  }
  return out;
}

/** 볼록 입체의 실루엣 = 꼭짓점 투영의 볼록 껍질. 모양 9종은 모두 볼록 조각으로만 이루어진다 */
function silhouette(points: readonly P3[]): P2[] {
  const pts = byX(points.map(project));
  const upper = halfHull(pts);
  const lower = halfHull([...pts].reverse());
  return [...upper.slice(0, -1), ...lower.slice(0, -1)];
}

/** 윗면이 옆면과 만나는 경계 = 윗면 꼭짓점의 **아래쪽** 사슬(열린 선 1개) */
function topEdge(face: readonly P3[]): P2[] {
  return halfHull([...byX(face.map(project))].reverse());
}

const round = (v: number) => Math.round(v * 100) / 100;
const points = (pts: P2[]) => pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join(" ");
const closed = (pts: P2[]) => `${points(pts)} Z`;

/** 높이 `y` 의 사각 면 4점(순환 순서) */
const rect = (x0: number, x1: number, z0: number, z1: number, y: number): P3[] => [
  [x0, y, z0],
  [x0, y, z1],
  [x1, y, z1],
  [x1, y, z0],
];

/** 곧은 기둥(아래 면 + 위 면) */
const prism = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): P3[] => [
  ...rect(x0, x1, z0, z1, y0),
  ...rect(x0, x1, z0, z1, y1),
];

/** 지름 4u 원통의 16각 근사(4.11.1 — 세로 모서리 22.5°는 윤곽선 문턱 25° 아래라 장면에서도 그리지 않는다) */
const ring = (y: number, r = 2, n = 16): P3[] =>
  Array.from({ length: n }, (_, i): P3 => {
    const t = (i / n) * Math.PI * 2;
    return [r * Math.cos(t), y, r * Math.sin(t)];
  });

interface ShapeGeometry {
  /** **뒤 → 앞** 순서로 칠한다. 면이 불투명이라 뒤 조각의 가려진 선이 덮인다(겹 상자·아치 문) */
  parts: P3[][];
  /** 윗면(옆면과 만나는 경계선을 여기서 뽑는다). `roof` 는 윗면이 면이 아니라 능선이라 null */
  top: P3[] | null;
  /** 용마루 — `roof` 전용 */
  ridge?: [P3, P3];
}

/** snapshot-3d.md 4.11.1 치수표 그대로. 봉투 4 × 3 × 4, 상단 평면은 언제나 y = 3 */
const SHAPE_GEOMETRY: Record<VizShape, ShapeGeometry> = {
  // 기본 상자: 4 × 4 수직, y 0 → 3
  box: { parts: [prism(-2, 2, -2, 2, 0, 3)], top: rect(-2, 2, -2, 2, 3) },
  // 겹 상자: 아래 단 4 × 4 × 0.9 + 위 단 2.4 × 2.4(중앙) y 0.9 → 3
  stack: {
    parts: [prism(-2, 2, -2, 2, 0, 0.9), prism(-1.2, 1.2, -1.2, 1.2, 0.9, 3)],
    top: rect(-1.2, 1.2, -1.2, 1.2, 3),
  },
  // 원통: 지름 4 수직
  cylinder: { parts: [[...ring(0), ...ring(3)]], top: ring(3) },
  // 얇은 판: x 4 × z 1.2, **판 면은 x축과 나란히 고정**
  panel: { parts: [prism(-2, 2, -0.6, 0.6, 0, 3)], top: rect(-2, 2, -0.6, 0.6, 3) },
  // 박공 지붕: 처마(x = ±2) 1.0u, 용마루(x = 0, z 전 구간) 3.0u
  roof: {
    parts: [[...rect(-2, 2, -2, 2, 0), ...rect(-2, 2, -2, 2, 1), [0, 3, -2], [0, 3, 2]]],
    top: null,
    ridge: [
      [0, 3, -2],
      [0, 3, 2],
    ],
  },
  // 머리 깎은 상자: 수직 y 0 → 1.6, 사면 1.6 → 3.0 에서 4 × 4 → 1.6 × 1.6
  chamfer: {
    parts: [[...rect(-2, 2, -2, 2, 0), ...rect(-2, 2, -2, 2, 1.6), ...rect(-0.8, 0.8, -0.8, 0.8, 3)]],
    top: rect(-0.8, 0.8, -0.8, 0.8, 3),
  },
  // 아치 문: 다리(1.2 × 1.2) y 0 → 1.6 + 상단 보 4 × 4 × 1.4.
  // 견본에서는 **앞 세 다리만** 그린다 — 네 번째(뒤) 다리는 구멍 너머로 보여 14px에서 구멍을 메운다.
  gate: {
    parts: [
      prism(-2, -0.8, -2, -0.8, 0, 1.6),
      prism(0.8, 2, 0.8, 2, 0, 1.6),
      prism(-2, -0.8, 0.8, 2, 0, 1.6),
      prism(-2, 2, -2, 2, 1.6, 3),
    ],
    top: rect(-2, 2, -2, 2, 3),
  },
  // 다이아몬드: 밑면 2.0 → y 1.4 에서 4.0(최대 폭) → y 3.0 에서 1.6
  diamond: {
    parts: [[...rect(-1, 1, -1, 1, 0), ...rect(-2, 2, -2, 2, 1.4), ...rect(-0.8, 0.8, -0.8, 0.8, 3)]],
    top: rect(-0.8, 0.8, -0.8, 0.8, 3),
  },
  // 곁 타일: 실제 6 × 3 × 0.75 를 **2/3 로 줄여** 다른 모양과 같은 폭 예산 안에 넣었다(비율은 그대로).
  // 납작함(높이 0.5u)이 이 모양의 전부다 — 곁 층은 모양을 나누지 않는다(4.11.2).
  tile: { parts: [prism(-2, 2, -1, 1, 0, 0.5)], top: rect(-2, 2, -1, 1, 0.5) },
};

interface ShapePath {
  parts: string[];
  /** 윗면(칠만 한다 — 뒤 조각의 가려진 선을 덮는다) */
  top: string | null;
  /** 윗면 경계선 1개(선만 그린다) */
  line: string | null;
}

/** 모양은 9종뿐이고 시점이 고정이라 path 는 모듈을 읽을 때 한 번만 만든다 */
export const SHAPE_PATH: Record<VizShape, ShapePath> = Object.fromEntries(
  (Object.keys(SHAPE_GEOMETRY) as VizShape[]).map((shape) => {
    const geo = SHAPE_GEOMETRY[shape];
    return [
      shape,
      {
        parts: geo.parts.map((part) => closed(silhouette(part))),
        top: geo.top ? closed(geo.top.map(project)) : null,
        line: geo.ridge ? points(geo.ridge.map(project)) : geo.top ? points(topEdge(geo.top)) : null,
      },
    ];
  }),
) as Record<VizShape, ShapePath>;

export interface ShapeSwatchProps {
  /** `kindShape()`(16.12)의 결과 */
  shape: VizShape;
  /** 14 = 종류 필터 옵션 / 16 = 범례(기본) */
  size?: 14 | 16;
  /** `neutral`(기본, 범례): 중립 면 + 윤곽. `layer`(종류 필터): 층 색으로 채운다 */
  tone?: "neutral" | "layer";
  /** `tone="layer"` 일 때만 쓴다. 없으면 중립으로 그린다 */
  layer?: VizLayer;
  className?: string;
}

/**
 * 모양 견본. **색은 층, 모양은 종류**다 — 견본도 상태를 뜻하지 않는다(status.md 11.1).
 * 옆 글자(종류 문구)가 뜻을 지므로 이 그림은 언제나 `aria-hidden` 이다.
 */
export function ShapeSwatch({ shape, size = 16, tone = "neutral", layer, className }: Readonly<ShapeSwatchProps>) {
  const path = SHAPE_PATH[shape];
  return (
    <svg
      className={cx(styles.shapeSwatch, className)}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      data-shape={shape}
      data-layer={tone === "layer" ? layer : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {path.parts.map((d) => (
        <path key={d} className={styles.shapeBody} d={d} />
      ))}
      {path.top ? <path className={styles.shapeTopFace} d={path.top} /> : null}
      {path.line ? <path className={styles.shapeTopLine} d={path.line} /> : null}
    </svg>
  );
}
