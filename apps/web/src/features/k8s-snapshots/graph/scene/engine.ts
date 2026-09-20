/**
 * three.js 3D 장면 (snapshot-3d.md 4절). **이 파일과 three.js 는 3D 보기를 처음 열 때만 내려받는다**(AC-3D01·02).
 *
 * - 배치 좌표는 `model.ts computeLayout()`이 만든다(결정적. 난수·force layout 없음, AC-3D11).
 * - 색은 CSS 변수에서 읽어 테마 전환에 맞춘다(`colors.ts`).
 * - 라벨·표식은 3D 가 아니라 **2D HTML 오버레이**다. React 가 DOM 을 만들고 여기서는 위치만 옮긴다.
 * - 조작이 없으면 프레임을 요청하지 않는다(AC-3D17). 탭이 숨겨지면 멈춘다.
 */
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

import { STACK_LAYERS, U, type GraphLayout } from "../layout";
import type { GraphBlock, GraphEdge, GraphPlate, VizLayerId } from "../types";
import type { VizColors } from "./colors";
import { pushShapeEdges, shadeForNormal, shapeGeometry, type VizShape } from "./shapes";

const LAYERS: VizLayerId[] = [...STACK_LAYERS, "aux"];
const FOV = 35;
const DEG = Math.PI / 180;
const HOME = { azimuth: -35 * DEG, elevation: 30 * DEG };
const VIEWPOINTS = {
  top: { azimuth: 0, elevation: 90 * DEG },
  iso: HOME,
  front: { azimuth: 0, elevation: 12 * DEG },
} as const;
export type CameraViewpoint = keyof typeof VIEWPOINTS;

export interface SceneData {
  layout: GraphLayout;
  plates: GraphPlate[];
  blocks: GraphBlock[];
  edges: GraphEdge[];
  /**
   * 블록 id → 모양 (4.11). 값은 퍼블리셔 `kindShape()` 의 결과를 그대로 받는다 —
   * **엔진은 종류 → 모양 표를 갖지 않는다**(표가 두 벌이면 아이콘과 어긋난다).
   */
  shapes?: Record<string, VizShape>;
}

export interface SceneCallbacks {
  onHover?: (id: string | null) => void;
  onSelect?: (id: string | null) => void;
  onActivate?: (id: string) => void;
  onContextLost?: () => void;
  onLowPerformance?: () => void;
  onPlateDensity?: (density: Record<string, 0 | 1 | 2 | 3>) => void;
  /** 블록 라벨 축소 단계·숨김 (4.7.1). 250ms 마다, 값이 바뀔 때만 */
  onLabelLayout?: (layout: LabelLayout) => void;
  /** `d_read` 상한 때문에 장면 일부가 화면 밖 (4.9-2) */
  onOffscreen?: (offscreen: boolean) => void;
}

/** 4.7.1 결과: 블록별 축소 단계(B0~B4)와 숨긴 것 */
export type LabelStep = 0 | 1 | 2 | 3 | 4;

export interface LabelLayout {
  steps: Record<string, LabelStep>;
  hidden: string[];
  /** 이름 글자가 하나도 안 그려진 블록 수 (B4 + 완전 숨김) */
  hiddenNames: number;
  hiddenMarkers: number;
}

/** 층 × 모양 하나 = InstancedMesh 1개 + 윤곽 LineSegments 1개 (4.11.5) */
interface BlockGroup {
  layer: VizLayerId;
  shape: VizShape;
  ghost: boolean;
  mesh: InstancedMesh;
  ids: string[];
}

interface Overlay {
  el: HTMLElement;
  pos: Vector3;
  /** 판 라벨은 앵커 왼쪽 아래 기준 */
  anchor: "block" | "plate";
  plateId?: string;
  /** 4.7.1 ① 기본 점수: 스캔 오류 700 · 그 밖 표식 600 · 나머지 0 */
  score: number;
  /** 표식 개수(0이면 B3에서 아무것도 그리지 않는다) */
  markers: number;
  /** 이름을 그릴 수 있는가(라벨 밀도가 껐으면 false) */
  hasName: boolean;
}

/**
 * 4.7.1 ② 오버레이 상자 (2026-09-20 designer 재조정. 실제 도달 구간 24~60px 에 맞춘 5단계).
 * 폰트는 micro 11/14 고정이고 줄이는 것은 **폭뿐**이다. 이름은 언제나 한 줄.
 */
const LABEL_GAP: [number, number, number, number] = [72, 48, 28, 18];
const LABEL_BOX: Record<0 | 1 | 2 | 3 | 4, { w: number; h: number }> = {
  0: { w: 136, h: 56 },
  1: { w: 104, h: 42 },
  2: { w: 76, h: 42 },
  3: { w: 52, h: 42 },
  4: { w: 20, h: 20 },
};
/**
 * 4.7.1 ③ 자리 후보 **19개**. 단계를 내리기 **전에** 같은 단계에서 19자리를 다 시도한다.
 *   n(밀어 올림) ∈ {0, 8, 16, 24, 32, 40, 48}
 *   o(좌우 비켜가기) ∈ {0, −o_max, +o_max},  o_max = max(0, 상자폭/2 − 12)   (n = 0 은 o = 0 만)
 * 순서: n 오름차순 → 각 n 에서 `0 → −o_max → +o_max`. 1 + 6 × 3 = 19.
 */
const LIFT_STEPS = [0, 8, 16, 24, 32, 40, 48] as const;
const offsetMax = (boxWidth: number) => Math.max(0, boxWidth / 2 - 12);

/**
 * 판(슬래브)용 상자. BoxGeometry 면 순서(+X −X +Y −Y +Z −Z)에 맞춰 **블록과 같은 광원·같은 3단 양자화**로 밝기를 굽는다
 * (4.11.3 — 블록 모양은 `shapes.ts` 가 만든다).
 */
function shadedBox(w: number, h: number, d: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  const shades = [
    shadeForNormal(1, 0, 0),
    shadeForNormal(-1, 0, 0),
    shadeForNormal(0, 1, 0),
    shadeForNormal(0, -1, 0),
    shadeForNormal(0, 0, 1),
    shadeForNormal(0, 0, -1),
  ];
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let face = 0; face < 6; face += 1) {
    const s = shades[face];
    for (let i = 0; i < 4; i += 1) {
      const o = (face * 4 + i) * 3;
      colors[o] = s;
      colors[o + 1] = s;
      colors[o + 2] = s;
    }
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return g;
}

const BOX_EDGE_PAIRS: [number, number, number, number, number, number][] = (() => {
  const c: [number, number, number][] = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, -1, 1],
    [-1, -1, 1],
    [-1, 1, -1],
    [1, 1, -1],
    [1, 1, 1],
    [-1, 1, 1],
  ];
  const idx: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  return idx.map(([a, b]) => [...c[a], ...c[b]] as [number, number, number, number, number, number]);
})();

function boxEdges(target: number[], x: number, y: number, z: number, w: number, h: number, d: number, pad = 0) {
  const hx = w / 2 + pad;
  const hy = h / 2 + pad;
  const hz = d / 2 + pad;
  for (const e of BOX_EDGE_PAIRS) {
    target.push(x + e[0] * hx, y + e[1] * hy, z + e[2] * hz, x + e[3] * hx, y + e[4] * hy, z + e[5] * hz);
  }
}

export class GraphScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly cb: SceneCallbacks;

  private colors: VizColors;
  private data: SceneData | null = null;
  private readonly content = new Group();
  private readonly overlays = new Map<string, Overlay>();

  private target = new Vector3();
  private azimuth = HOME.azimuth;
  private elevation = HOME.elevation;
  private distance = 100;
  private minDistance = 12;
  private maxDistance = 1000;

  private frame = 0;
  private disposed = false;
  private hovered: string | null = null;
  private selected: string | null = null;
  private neighbors = new Set<string>();
  private search = new Set<string>();
  private reducedMotion = false;
  private lowDetail = false;
  private animation: { from: { t: Vector3; d: number }; to: { t: Vector3; d: number }; start: number } | null = null;

  /** 인스턴싱 단위 = **층 × 모양** (4.11.5). 실제 장면에 등장하는 조합만 만든다 */
  private blockGroups: BlockGroup[] = [];
  /** 히트 영역은 모양이 아니라 **봉투**다 (4.11.4). 화면에 그리지 않고 레이캐스트에만 쓴다 */
  private pickGroups: { ids: string[]; mesh: InstancedMesh }[] = [];
  private selectionLine: LineSegments | null = null;
  private searchLine: LineSegments | null = null;
  private hoverLine: LineSegments | null = null;
  private highlightLine: LineSegments | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  private readonly frameTimes: { t: number; dt: number }[] = [];
  private lowReported = false;
  private lastDensityAt = 0;
  private plateDensity: Record<string, 0 | 1 | 2 | 3> = {};

  constructor(canvas: HTMLCanvasElement, colors: VizColors, cb: SceneCallbacks = {}) {
    this.canvas = canvas;
    this.colors = colors;
    this.cb = cb;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 2));
    this.camera = new PerspectiveCamera(FOV, 1, 0.5, 5000);
    // 면 밝기를 지오메트리에 구웠으므로 빛·그림자를 쓰지 않는다(4.3) — 1,000 블록에서 비용이 크다
    this.scene.add(this.content);
    this.applyColors(colors);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  // ------------------------------------------------------------ 색·모션

  applyColors(colors: VizColors) {
    this.colors = colors;
    const bg = new Color(colors.sceneBg);
    this.scene.background = bg;
    this.scene.fog = new Fog(new Color(colors.fog).getHex(), 1, 2);
    this.renderer.setClearColor(bg, 1);
    if (this.data) this.build(this.data);
    else this.invalidate();
  }

  setReducedMotion(v: boolean) {
    this.reducedMotion = v;
  }

  setLowDetail(v: boolean) {
    if (this.lowDetail === v) return;
    this.lowDetail = v;
    this.updateFog();
    this.invalidate();
  }

  // ------------------------------------------------------------ 데이터

  setData(data: SceneData, keepCamera: boolean) {
    const first = this.data === null;
    this.data = data;
    this.build(data);
    if (first || !keepCamera) this.resetCamera(true);
    else this.updateDistanceLimits();
    this.invalidate();
  }

  private clearContent() {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.content.clear();
    this.blockGroups = [];
    for (const p of this.pickGroups) p.mesh.dispose();
    this.pickGroups = [];
    this.selectionLine = null;
    this.searchLine = null;
    this.hoverLine = null;
    this.highlightLine = null;
  }

  /** 블록 모양 (4.11). 모르면 기본형 `box` — 빈 자리를 두지 않는다 */
  private shapeOf(id: string): VizShape {
    return this.data?.shapes?.[id] ?? "box";
  }

  private track<T extends { dispose(): void }>(v: T): T {
    this.disposables.push(v);
    return v;
  }

  private build(data: SceneData) {
    this.clearContent();
    const { layout } = data;
    const dummy = new Object3D();

    // ── 판 + 격자
    const plateEdges: number[] = [];
    const gridLines: number[] = [];
    for (const p of data.plates) {
      const lp = layout.plates.get(p.id);
      if (!lp) continue;
      const alt = p.kind !== "namespace" || p.system;
      const geo = this.track(shadedBox(lp.size, U.plateThickness, lp.size));
      const mat = this.track(
        new MeshBasicMaterial({
          color: new Color(p.kind === "ghost" ? this.colors.ghostFill : alt ? this.colors.plateFillAlt : this.colors.plateFill),
          vertexColors: true,
          transparent: p.kind === "ghost",
          opacity: p.kind === "ghost" ? this.colors.ghostOpacity : 1,
        }),
      );
      const mesh = new Mesh(geo, mat);
      mesh.position.set(lp.x, -U.plateThickness / 2, lp.z);
      mesh.userData.plateId = p.id;
      this.content.add(mesh);
      boxEdges(plateEdges, lp.x, -U.plateThickness / 2, lp.z, lp.size, U.plateThickness, lp.size);
      const half = lp.size / 2;
      for (let o = -half; o <= half + 0.001; o += U.cell) {
        gridLines.push(lp.x + o, 0.02, lp.z - half, lp.x + o, 0.02, lp.z + half);
        gridLines.push(lp.x - half, 0.02, lp.z + o, lp.x + half, 0.02, lp.z + o);
      }
    }
    this.addLines(gridLines, this.colors.grid, 1, false);
    this.addLines(plateEdges, this.colors.plateEdge, 1, false);

    // ── 블록: 인스턴싱 단위는 **층 × 모양**이다 (4.11.5). 같은 조합끼리 모아 InstancedMesh 1개 + 합친 윤곽선 1개
    const combos = new Map<string, { layer: VizLayerId; shape: VizShape; ghost: boolean; list: GraphBlock[] }>();
    const byLayerAll = new Map<string, GraphBlock[]>();
    for (const b of data.blocks) {
      if (!layout.blocks.has(b.id)) continue;
      const ghost = Boolean(b.ghost);
      const shape = this.shapeOf(b.id);
      const key = `${ghost ? "ghost" : b.layer}|${shape}`;
      const combo = combos.get(key);
      if (combo) combo.list.push(b);
      else combos.set(key, { layer: b.layer, shape, ghost, list: [b] });
      // 히트 영역(봉투)은 층 단위로 묶는다 — 모양과 무관하다
      const pickKey = ghost ? "ghost" : b.layer;
      const pickList = byLayerAll.get(pickKey);
      if (pickList) pickList.push(b);
      else byLayerAll.set(pickKey, [b]);
    }

    // 층 순서대로(아래 → 위) 만들어 같은 입력이면 같은 순서가 되게 한다 (AC-3D11)
    const order = [...combos.entries()].sort((a, b) => {
      const ga = a[1].ghost ? 1 : 0;
      const gb = b[1].ghost ? 1 : 0;
      if (ga !== gb) return ga - gb;
      const la = LAYERS.indexOf(a[1].layer);
      const lb = LAYERS.indexOf(b[1].layer);
      if (la !== lb) return la - lb;
      return a[0] < b[0] ? -1 : 1;
    });

    for (const [, combo] of order) {
      const { layer, shape, ghost, list } = combo;
      const geo = shapeGeometry(shape); // 모양 지오메트리는 장면 밖에서 한 번만 만들어 공유한다
      const mat = this.track(
        ghost
          ? // 유령: 면은 아주 옅게, 종류는 **그 모양의 dashed 윤곽**이 말한다 (4.4 · 4.11.4)
            new MeshBasicMaterial({ color: new Color(this.colors.ghostFill), transparent: true, opacity: this.colors.ghostOpacity })
          : new MeshBasicMaterial({ vertexColors: true }),
      );
      const mesh = new InstancedMesh(geo, mat, list.length);
      mesh.frustumCulled = false;
      const ids: string[] = [];
      const outline: number[] = [];
      const base = ghost ? null : new Color(this.colors.kind[layer].fill);
      list.forEach((b, i) => {
        const lb = layout.blocks.get(b.id)!;
        dummy.position.set(lb.x, lb.y, lb.z);
        dummy.scale.set(lb.w / U.block, lb.h / U.blockHeight, lb.d / U.block);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (base) mesh.setColorAt(i, base);
        ids.push(b.id);
        pushShapeEdges(outline, shape, lb.x, lb.y, lb.z, lb.w, lb.h, lb.d);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.layer = ghost ? "ghost" : layer;
      this.content.add(mesh);
      this.disposables.push(mesh);
      this.blockGroups.push({ layer, shape, ghost, mesh, ids });
      if (ghost) this.addLines(outline, this.colors.ghostEdge, 1.5, true);
      else this.addLines(outline, this.colors.kind[layer].edge, 1, false);
    }

    // ── 히트 영역: 모양과 무관하게 **봉투 4u × 3u × 4u**(얇은 `panel` 도 같은 크기로 집힌다, 4.11.4).
    //    장면에 넣지 않고(그리지 않는다) 레이캐스트에만 쓴다 — 드로콜이 늘지 않는다.
    const pickGeo = this.track(new BoxGeometry(1, 1, 1));
    const pickMat = this.track(new MeshBasicMaterial());
    for (const [, list] of byLayerAll) {
      const mesh = new InstancedMesh(pickGeo, pickMat, list.length);
      const ids: string[] = [];
      list.forEach((b, i) => {
        const lb = layout.blocks.get(b.id)!;
        dummy.position.set(lb.x, lb.y, lb.z);
        dummy.scale.set(lb.w, lb.h, lb.d);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        ids.push(b.id);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.updateMatrixWorld(true);
      this.pickGroups.push({ ids, mesh });
    }

    // ── 관계선
    this.buildEdges(data);
    this.updateFog();
    this.refreshEmphasis();
  }

  private addLines(points: number[], color: string, width: number, dashed: boolean): LineSegments | null {
    if (points.length === 0) return null;
    const geo = this.track(new BufferGeometry());
    geo.setAttribute("position", new Float32BufferAttribute(points, 3));
    const mat = this.track(
      dashed
        ? new LineDashedMaterial({ color: new Color(color), dashSize: 0.9, gapSize: 0.45, linewidth: width })
        : new LineBasicMaterial({ color: new Color(color), linewidth: width }),
    );
    const line = new LineSegments(geo, mat);
    if (dashed) line.computeLineDistances();
    line.frustumCulled = false;
    this.content.add(line);
    return line;
  }

  /** 2차 베지어: 출발 = 근원 밑면 중심, 도착 = 대상 윗면 중심, 제어점 = 중점 + 위로 거리×0.18 (4.5) */
  private edgeCurve(from: string, to: string): Vector3[] | null {
    const layout = this.data?.layout;
    const a = layout?.blocks.get(from);
    const b = layout?.blocks.get(to);
    if (!a || !b) return null;
    const p0 = new Vector3(a.x, a.y - a.h / 2, a.z);
    const p2 = new Vector3(b.x, b.y + b.h / 2, b.z);
    const lift = p0.distanceTo(p2) * 0.18;
    const p1 = p0.clone().add(p2).multiplyScalar(0.5).setY(Math.max(p0.y, p2.y) + lift);
    const steps = this.lowDetail ? 6 : 12;
    const out: Vector3[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const u = 1 - t;
      out.push(
        new Vector3(
          u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
          u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
          u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
        ),
      );
    }
    return out;
  }

  private buildEdges(data: SceneData) {
    const confirmed: number[] = [];
    const estimated: number[] = [];
    const heads: { pos: Vector3; dir: Vector3 }[] = [];
    for (const e of data.edges) {
      const pts = this.edgeCurve(e.from, e.to);
      if (!pts) continue;
      const target = e.certainty === "confirmed" ? confirmed : estimated;
      for (let i = 0; i < pts.length - 1; i += 1) {
        target.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
      }
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      heads.push({ pos: last, dir: last.clone().sub(prev).normalize() });
    }
    this.addLines(confirmed, this.colors.edgeConfirmed, 1.5, false);
    this.addLines(estimated, this.colors.edgeEstimated, 1.5, true);

    if (heads.length > 0 && !this.lowDetail) {
      const geo = this.track(new ConeGeometry(0.5, 1.2, 4));
      const mat = this.track(new MeshBasicMaterial({ color: new Color(this.colors.edgeConfirmed) }));
      const mesh = new InstancedMesh(geo, mat, heads.length);
      mesh.frustumCulled = false;
      const q = new Quaternion();
      const up = new Vector3(0, 1, 0);
      const m = new Matrix4();
      heads.forEach((h, i) => {
        q.setFromUnitVectors(up, h.dir);
        m.compose(h.pos, q, new Vector3(1, 1, 1));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.content.add(mesh);
      this.disposables.push(mesh);
    }
  }

  /** 안개는 **카메라 거리 기준**이다(고정 대각선 배수면 멀어질 때 장면 전체가 안개에 잠긴다) */
  private updateFog() {
    const d = this.data?.layout.diagonal ?? 100;
    const end = this.lowDetail ? 0.8 : 1.1;
    const fog = this.scene.fog;
    const near = this.distance + d * 0.25;
    const far = this.distance + d * end;
    if (fog instanceof Fog) {
      fog.near = near;
      fog.far = far;
    } else {
      this.scene.fog = new Fog(new Color(this.colors.fog).getHex(), near, far);
    }
  }

  // ------------------------------------------------------------ 강조 (선택·hover·검색)

  setSelection(id: string | null, neighbors: string[]) {
    this.selected = id;
    this.neighbors = new Set(neighbors);
    this.refreshEmphasis();
    this.invalidate();
  }

  setSearch(ids: string[]) {
    this.search = new Set(ids);
    this.refreshEmphasis();
    this.invalidate();
  }

  private refreshEmphasis() {
    if (!this.data) return;
    const dim = this.selected !== null;
    const bg = new Color(this.colors.sceneBg);
    for (const group of this.blockGroups) {
      if (group.ghost) continue; // 유령은 면이 이미 0.35 라 흐림 혼합을 걸지 않는다
      const base = new Color(this.colors.kind[group.layer].fill);
      const faded = base.clone().lerp(bg, 1 - this.colors.dimmed);
      group.ids.forEach((id, i) => {
        const strong = !dim || id === this.selected || this.neighbors.has(id) || this.search.has(id);
        group.mesh.setColorAt(i, strong ? base : faded);
      });
      if (group.mesh.instanceColor) group.mesh.instanceColor.needsUpdate = true;
    }
    this.drawOutline("selection", this.selected ? [this.selected] : [], this.colors.selectOutline, false, 2);
    this.drawOutline("search", [...this.search].slice(0, 300), this.colors.searchOutline, true, 2);
    this.drawHoverOutline();
    this.drawHighlightEdges();
  }

  /** hover 윤곽 1.5px (4.11.4) — 선택과 **같은 모서리 집합**에 굵기·색만 다르게 */
  private drawHoverOutline() {
    const id = this.hovered && this.hovered !== this.selected ? [this.hovered] : [];
    this.drawOutline("hover", id, this.colors.selectOutline, false, 1.5);
  }

  private drawOutline(kind: "selection" | "search" | "hover", ids: string[], color: string, dashed: boolean, width: number) {
    const key = kind === "selection" ? "selectionLine" : kind === "search" ? "searchLine" : "hoverLine";
    const old = this[key];
    if (old) {
      this.content.remove(old);
      old.geometry.dispose();
      (old.material as LineBasicMaterial).dispose();
      this[key] = null;
    }
    if (ids.length === 0 || !this.data) return;
    const pts: number[] = [];
    for (const id of ids) {
      const lb = this.data.layout.blocks.get(id);
      // **모양을 따라가는** 윤곽이다 (4.11.4). 상태마다 다른 선을 만들지 않고 같은 모서리 집합을 쓴다
      if (lb) pushShapeEdges(pts, this.shapeOf(id), lb.x, lb.y, lb.z, lb.w, lb.h, lb.d, 0.12);
    }
    if (pts.length === 0) return;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const mat = dashed
      ? new LineDashedMaterial({ color: new Color(color), dashSize: 0.6, gapSize: 0.45, linewidth: width })
      : new LineBasicMaterial({ color: new Color(color), linewidth: width });
    const line = new LineSegments(geo, mat);
    if (dashed) line.computeLineDistances();
    line.frustumCulled = false;
    line.renderOrder = 2;
    this.content.add(line);
    this[key] = line;
  }

  private drawHighlightEdges() {
    if (this.highlightLine) {
      this.content.remove(this.highlightLine);
      this.highlightLine.geometry.dispose();
      (this.highlightLine.material as LineBasicMaterial).dispose();
      this.highlightLine = null;
    }
    if (!this.selected || !this.data) return;
    const pts: number[] = [];
    for (const e of this.data.edges) {
      if (e.from !== this.selected && e.to !== this.selected) continue;
      const curve = this.edgeCurve(e.from, e.to);
      if (!curve) continue;
      for (let i = 0; i < curve.length - 1; i += 1) {
        pts.push(curve[i].x, curve[i].y, curve[i].z, curve[i + 1].x, curve[i + 1].y, curve[i + 1].z);
      }
    }
    if (pts.length === 0) return;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    const line = new LineSegments(geo, new LineBasicMaterial({ color: new Color(this.colors.edgeHighlight), linewidth: 3 }));
    line.frustumCulled = false;
    line.renderOrder = 3;
    this.content.add(line);
    this.highlightLine = line;
  }

  // ------------------------------------------------------------ 카메라 (4.9)

  /** 2D 오버레이(범례·카메라·정보 줄)가 덮는 여백. 장면은 이 안쪽에 맞춘다 */
  setInsets(insets: { left: number; right: number; top: number; bottom: number }) {
    this.insets = insets;
  }

  private insets = { left: 12, right: 12, top: 12, bottom: 12 };

  /** `d_read` 상한에 걸려 장면 일부가 화면 밖인가 (4.9-2 → 정보 줄 칩 `일부가 화면 밖`) */
  private offscreen = false;

  resetCamera(instant = false) {
    this.azimuth = HOME.azimuth;
    this.elevation = HOME.elevation;
    this.updateDistanceLimits();
    const fit = this.fitCamera();
    this.homeDistanceValue = fit.distance;
    this.maxDistance = Math.max(this.maxDistance, fit.distance * 2);
    if (this.offscreen !== fit.offscreen) {
      this.offscreen = fit.offscreen;
      this.cb.onOffscreen?.(fit.offscreen);
    }
    this.moveTo(fit.target, fit.distance, instant);
  }

  private homeDistanceValue = 0;

  /** 정보 줄 `일부가 화면 밖` 칩 → **`d_read` 상한을 푼** 맞춤 거리로 한 번 축소한다 (4.9-2) */
  zoomToFitAll() {
    const bbox = this.sceneBounds();
    if (!bbox) return;
    const dist = this.fitAllDistance();
    if (dist <= 0) return;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const safe = this.safeArea();
    const keepT = this.target.clone();
    const keepD = this.distance;
    this.target.copy(bbox.center);
    this.distance = dist;
    for (let i = 0; i < 2; i += 1) {
      this.updateCamera();
      const r = this.projectBounds(bbox, w, h);
      if (!r.ok) break; // 보이는 모서리가 3개 미만이면 보정하지 않는다(4.9-2)
      this.pan(-(r.cx - (safe.left + safe.width / 2)), -(r.cy - (safe.top + safe.height / 2)));
    }
    const aimed = this.target.clone();
    this.target.copy(keepT);
    this.distance = keepD;
    this.moveTo(aimed, dist, this.reducedMotion);
  }

  private fitAllDistance(): number {
    const bbox = this.sceneBounds();
    if (!bbox) return 0;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const area = this.fitArea();
    const tanV = Math.tan((FOV * DEG) / 2);
    const tanY = tanV * (area.height / h);
    const tanX = tanV * (w / h) * (area.width / w);
    const ce = Math.cos(this.elevation);
    const toCamera = new Vector3(ce * Math.sin(this.azimuth), Math.sin(this.elevation), ce * Math.cos(this.azimuth));
    const forward = toCamera.clone().negate();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    const e = bbox.half;
    let dFit = 0;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const v = new Vector3(sx * e.x, sy * e.y, sz * e.z);
          const depth = -v.dot(forward);
          dFit = Math.max(dFit, Math.abs(v.dot(right)) / tanX + depth, Math.abs(v.dot(up)) / tanY + depth);
        }
    // `d_read` 상한을 쓰지 않는다 — 전부 담는 것이 목적이다
    return Math.min(this.maxDistance, dFit);
  }

  /**
   * 4.9 「기본 거리 맞춤」(2026-09-20 designer 재조정). "대각선 × 1.25"는 쓰지 않는다.
   *   d_fit  = max over 8 corners of max(|sx|/tanX + sz, |sy|/tanY + sz)   — 모서리별로 계산한다
   *   d_read = block × h / (2·tan(17.5°)·s_min)                            — 블록 한 변 읽기 하한
   *   d0     = clamp(min(d_fit × 1.06, d_read), 36u, 대각선 × 3)
   * 대상은 **bbox 3D 중심**이고, 투영 사각형의 중심을 안전 영역 중심에 맞춘다(**원근 그대로 2회 반복**).
   */
  private fitCamera(): { target: Vector3; distance: number; offscreen: boolean } {
    const d = this.data?.layout.diagonal ?? 80;
    const bbox = this.sceneBounds();
    const target = bbox ? bbox.center.clone() : this.homeTarget();
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (!bbox || w < 32 || h < 32) {
      return { target, distance: Math.min(this.maxDistance, Math.max(36, d)), offscreen: false };
    }

    const safe = this.safeArea();
    const area = this.fitArea();
    const tanV = Math.tan((FOV * DEG) / 2);
    const tanY = tanV * (area.height / h);
    const tanX = tanV * (w / h) * (area.width / w);
    const { right, up, forward } = this.homeAxes();

    // d_fit: 모서리마다 "이만큼은 떨어져야 안전 영역 안에 들어온다"를 구해 최댓값
    let dFit = 0;
    const e = bbox.half;
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const v = new Vector3(sx * e.x, sy * e.y, sz * e.z);
          const px = v.dot(right);
          const py = v.dot(up);
          const depth = -v.dot(forward); // 카메라 쪽으로 튀어나온 만큼
          dFit = Math.max(dFit, Math.abs(px) / tanX + depth, Math.abs(py) / tanY + depth);
        }

    // s_min: 블록 한 변이 화면에서 이만큼은 돼야 한다(좁은 캔버스 완화, 12절)
    const sMin = h >= 600 ? 16 : 13;
    const dRead = (U.block * h) / (2 * tanV * sMin);
    const offscreen = dFit > dRead + 0.5;
    const dMax = Math.max(36, Math.min(dRead, Math.max(d * 3, 36)));
    let d0 = Math.min(Math.max(dFit, 36), dMax);

    // **크기 조이기 + 가운데 맞추기 3회**: 투영 사각형 → k 로 거리 보정 → 중심 이동
    const keepT = this.target.clone();
    const keepD = this.distance;
    this.target.copy(target);
    this.distance = d0;
    for (let i = 0; i < 3; i += 1) {
      this.updateCamera();
      const r = this.projectBounds(bbox, w, h);
      // 보이는 모서리가 3개 미만이면 **직전 값을 그대로 둔다**(4.9-2). 폭주한 좌표로 보정하면 장면이 화면 밖으로 날아간다
      if (!r.ok) break;
      const k = Math.max((r.maxX - r.minX) / area.width, (r.maxY - r.minY) / area.height);
      if (Number.isFinite(k) && k > 0) {
        d0 = Math.min(Math.max(d0 * k, 36), dMax);
        this.distance = d0;
        this.updateCamera();
      }
      const r2 = this.projectBounds(bbox, w, h);
      if (!r2.ok) break;
      this.pan(-(r2.cx - (safe.left + safe.width / 2)), -(r2.cy - (safe.top + safe.height / 2)));
    }
    const fitted = this.target.clone();
    this.target.copy(keepT);
    this.distance = keepD;
    return { target: fitted, distance: d0, offscreen };
  }

  /**
   * 맞춤 영역: 안전 영역 네 변에서 **각 26px 안쪽**(4.9-2, 2026-09-20).
   * 라벨·표식이 블록보다 밖으로 삐져나오는 몫을 거리 배수(× 1.06) 대신 **여백**으로 준다.
   */
  private fitArea() {
    const safe = this.safeArea();
    return {
      left: safe.left + 26,
      top: safe.top + 26,
      width: Math.max(32, safe.width - 52),
      height: Math.max(32, safe.height - 52),
    };
  }

  /** 기본 시점(방위 −35°·고도 30°)의 카메라 축 */
  private homeAxes() {
    const ce = Math.cos(HOME.elevation);
    const toCamera = new Vector3(ce * Math.sin(HOME.azimuth), Math.sin(HOME.elevation), ce * Math.cos(HOME.azimuth));
    const forward = toCamera.clone().negate();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    return { right, up, forward };
  }

  /**
   * bbox 여덟 모서리를 **원근 그대로** 투영한 화면 사각형 (4.9-2).
   *
   * **유효 모서리만 센다 (4.9-3 「3-1) 유효 모서리」, 2026-09-20 designer)**: 카메라로부터의 깊이가
   * `max(near, 0.05 × d)` 이상인 모서리만 쓴다. 카메라 뒤·near 앞 모서리는 원근 나눗셈에서 부호가 뒤집혀
   * 좌표가 폭주하고(관측: 아주 큰 장면에서 `cx` 가 25만 px), 그 값으로 팬 보정을 하면 장면이 화면 밖으로 날아간다.
   * 아주 가까운 모서리(`< 0.05 × d`)도 투영이 발산하므로 같이 뺀다.
   * 남은 모서리 `m` 이 3개 미만이면 `ok = false` 로 알려 **크기 조이기·중심 맞추기를 건너뛰게** 한다(폭주 대신 안전한 실패).
   */
  private projectBounds(bbox: { center: Vector3; half: Vector3 }, w: number, h: number) {
    const v = new Vector3();
    const cam = new Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    // 유효 모서리 조건: 카메라로부터의 깊이 `d − sz_i ≥ max(near, 0.05 × d)` (4.9-3)
    const minDepth = Math.max(this.camera.near, 0.05 * this.distance);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          v.set(bbox.center.x + sx * bbox.half.x, bbox.center.y + sy * bbox.half.y, bbox.center.z + sz * bbox.half.z);
          cam.copy(v).applyMatrix4(this.camera.matrixWorldInverse);
          if (-cam.z < minDepth) continue; // 카메라 뒤·near 앞·너무 가까움 → 투영이 뒤집히거나 발산한다
          v.project(this.camera);
          const px = (v.x * 0.5 + 0.5) * w;
          const py = (-v.y * 0.5 + 0.5) * h;
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
          count += 1;
        }
    if (count === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, cx: w / 2, cy: h / 2, count, ok: false };
    }
    return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, count, ok: count >= 3 };
  }

  /** 안전 영역: 정보 줄(위)·카메라 오버레이(오른쪽)를 뺀 사각형 (4.9-1) */
  private safeArea() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const left = Math.min(this.insets.left, w / 4);
    const right = Math.min(this.insets.right, w / 3);
    const top = Math.min(this.insets.top, h / 3);
    const bottom = Math.min(this.insets.bottom, h / 4);
    return { left, top, width: Math.max(32, w - left - right), height: Math.max(32, h - top - bottom) };
  }

  /** 장면 바운딩 박스(판 + 블록 기하. 2D 라벨은 넣지 않는다) */
  private sceneBounds(): { center: Vector3; half: Vector3 } | null {
    const layout = this.data?.layout;
    if (!layout || layout.plates.size === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = 0;
    let maxY = 0;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of layout.plates.values()) {
      const hs = p.size / 2;
      minX = Math.min(minX, p.x - hs);
      maxX = Math.max(maxX, p.x + hs);
      minZ = Math.min(minZ, p.z - hs);
      maxZ = Math.max(maxZ, p.z + hs);
      minY = Math.min(minY, -U.plateThickness);
    }
    for (const b of layout.blocks.values()) {
      maxY = Math.max(maxY, b.y + b.h / 2);
      minY = Math.min(minY, b.y - b.h / 2);
    }
    if (!Number.isFinite(minX)) return null;
    return {
      center: new Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
      half: new Vector3((maxX - minX) / 2, Math.max(U.blockHeight / 2, (maxY - minY) / 2), (maxZ - minZ) / 2),
    };
  }

  /**
   * 자가 점검(4.9-3). `dx`·`dy` 는 안전 영역 중심과의 차이(±4px), `fit` 은 **맞춤 영역**을 채운 비율(목표 0.98~1.02),
   * `fillX`·`fillY` 는 안전 영역 기준 비율(기대 `fillX ≈ 0.92`).
   */
  fitCheck(): {
    dx: number;
    dy: number;
    fit: number;
    fillX: number;
    fillY: number;
    inside: boolean;
    offscreen: boolean;
    /** 유효 모서리 수(4.9-3). 기준 장면은 8이어야 한다 */
    m: number;
    /** `m < 3` 이라 크기 조이기·중심 맞추기를 건너뛴 상태. **true 면 `fit`·`fill`·`dx`·`dy` 를 기준 판정에서 제외한다** */
    skipped: boolean;
  } | null {
    const bbox = this.sceneBounds();
    if (!bbox) return null;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const safe = this.safeArea();
    const area = this.fitArea();
    this.updateCamera();
    const r = this.projectBounds(bbox, w, h);
    if (!r.ok) {
      return { dx: 0, dy: 0, fit: 0, fillX: 0, fillY: 0, inside: false, offscreen: this.offscreen, m: r.count, skipped: true };
    }
    return {
      m: r.count,
      skipped: false,
      dx: r.cx - (safe.left + safe.width / 2),
      dy: r.cy - (safe.top + safe.height / 2),
      fit: Math.max((r.maxX - r.minX) / area.width, (r.maxY - r.minY) / area.height),
      fillX: (r.maxX - r.minX) / safe.width,
      fillY: (r.maxY - r.minY) / safe.height,
      inside:
        r.minX >= safe.left - 1 &&
        r.maxX <= safe.left + safe.width + 1 &&
        r.minY >= safe.top - 1 &&
        r.maxY <= safe.top + safe.height + 1,
      offscreen: this.offscreen,
    };
  }

  setViewpoint(v: CameraViewpoint) {
    this.azimuth = VIEWPOINTS[v].azimuth;
    this.elevation = VIEWPOINTS[v].elevation;
    this.invalidate();
  }

  private homeTarget(): Vector3 {
    const c = this.data?.layout.center ?? { x: 0, y: 0, z: 0 };
    return new Vector3(c.x, c.y, c.z);
  }

  private updateDistanceLimits() {
    const d = this.data?.layout.diagonal ?? 80;
    this.minDistance = 12;
    this.maxDistance = Math.max(this.minDistance + 1, d * 3);
    this.distance = Math.min(Math.max(this.distance, this.minDistance), this.maxDistance);
  }

  rotate(dAzimuth: number, dElevation: number) {
    this.azimuth += dAzimuth;
    this.elevation = Math.min(90 * DEG, Math.max(2 * DEG, this.elevation + dElevation));
    this.invalidate();
  }

  pan(dxPx: number, dyPx: number) {
    const h = this.canvas.clientHeight || 1;
    const worldPerPx = (2 * this.distance * Math.tan((FOV * DEG) / 2)) / h;
    const right = new Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dxPx * worldPerPx).addScaledVector(up, dyPx * worldPerPx);
    this.invalidate();
  }

  zoom(factor: number) {
    this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * factor));
    this.invalidate();
  }

  /** 검색·선택으로 카메라를 옮긴다. 대상 블록이 **안전 영역 가운데**에 오고 거리는 `min(36u, 기본 거리)` (4.9) */
  focusBlock(id: string) {
    const lb = this.data?.layout.blocks.get(id);
    if (!lb) return;
    const dist = Math.min(this.homeDistanceValue || this.distance, 36);
    const point = new Vector3(lb.x, lb.y, lb.z);
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const safe = this.safeArea();
    const keepT = this.target.clone();
    const keepD = this.distance;
    this.target.copy(point);
    this.distance = dist;
    this.updateCamera();
    const v = new Vector3().copy(point).project(this.camera);
    this.pan(-((v.x * 0.5 + 0.5) * w - (safe.left + safe.width / 2)), -((-v.y * 0.5 + 0.5) * h - (safe.top + safe.height / 2)));
    const aimed = this.target.clone();
    this.target.copy(keepT);
    this.distance = keepD;
    this.moveTo(aimed, dist, this.reducedMotion);
  }

  private moveTo(target: Vector3, distance: number, instant: boolean) {
    if (instant || this.reducedMotion) {
      this.target.copy(target);
      this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, distance));
      this.animation = null;
      this.invalidate();
      return;
    }
    this.animation = {
      from: { t: this.target.clone(), d: this.distance },
      to: { t: target.clone(), d: Math.min(this.maxDistance, Math.max(this.minDistance, distance)) },
      start: performance.now(),
    };
    this.invalidate();
  }

  // ------------------------------------------------------------ 입력

  private dragging: { mode: "rotate" | "pan"; x: number; y: number; moved: boolean } | null = null;

  private readonly onContextMenu = (e: Event) => e.preventDefault();

  private readonly onPointerDown = (e: PointerEvent) => {
    this.canvas.focus();
    this.canvas.setPointerCapture(e.pointerId);
    const mode = e.button === 2 || e.shiftKey ? "pan" : "rotate";
    this.dragging = { mode, x: e.clientX, y: e.clientY, moved: false };
    const up = (ev: PointerEvent) => {
      this.canvas.removeEventListener("pointermove", move);
      this.canvas.removeEventListener("pointerup", up);
      const drag = this.dragging;
      this.dragging = null;
      if (drag && !drag.moved && ev.button !== 2) this.cb.onSelect?.(this.pick(ev));
    };
    const move = (ev: PointerEvent) => {
      const drag = this.dragging;
      if (!drag) return;
      const dx = ev.clientX - drag.x;
      const dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      if (drag.mode === "pan") this.pan(dx, dy);
      else this.rotate(-dx * 0.005, -dy * 0.005);
    };
    this.canvas.addEventListener("pointermove", move);
    this.canvas.addEventListener("pointerup", up);
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (this.dragging) return;
    const id = this.pick(e);
    if (id !== this.hovered) {
      this.hovered = id;
      this.drawHoverOutline();
      this.invalidate();
      this.cb.onHover?.(id);
    }
  };

  private readonly onPointerLeave = () => {
    if (this.hovered !== null) {
      this.hovered = null;
      this.drawHoverOutline();
      this.invalidate();
      this.cb.onHover?.(null);
    }
  };

  private readonly onDoubleClick = (e: MouseEvent) => {
    const id = this.pick(e);
    if (id) this.cb.onActivate?.(id);
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
  };

  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    this.cb.onContextLost?.();
  };

  private pick(e: { clientX: number; clientY: number }): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // 모양이 아니라 **봉투**를 집는다 (4.11.4). 봉투 메시는 화면에 없고 여기에서만 쓴다
    const hits = this.raycaster.intersectObjects(
      this.pickGroups.map((g) => g.mesh),
      false,
    );
    for (const hit of hits) {
      const i = hit.instanceId;
      if (i === undefined) continue;
      const group = this.pickGroups.find((g) => g.mesh === hit.object);
      if (group?.ids[i]) return group.ids[i];
    }
    return null;
  }

  // ------------------------------------------------------------ 2D 오버레이 (라벨·표식·판 라벨)

  registerOverlay(
    id: string,
    el: HTMLElement | null,
    kind: "block" | "plate",
    meta: { score?: number; markers?: number; hasName?: boolean } = {},
  ) {
    if (!el) {
      this.overlays.delete(id);
      return;
    }
    const layout = this.data?.layout;
    if (!layout) return;
    if (kind === "plate") {
      const lp = layout.plates.get(id);
      if (!lp) return;
      this.overlays.set(id, {
        el,
        pos: new Vector3(lp.anchor.x, lp.anchor.y, lp.anchor.z),
        anchor: "plate",
        plateId: id,
        score: Number.MAX_SAFE_INTEGER,
        markers: 0,
        hasName: true,
      });
    } else {
      const lb = layout.blocks.get(id);
      if (!lb) return;
      this.overlays.set(id, {
        el,
        pos: new Vector3(lb.x, lb.y + lb.h / 2, lb.z),
        anchor: "block",
        score: meta.score ?? 0,
        markers: meta.markers ?? 0,
        hasName: meta.hasName ?? true,
      });
    }
    this.invalidate();
  }

  clearOverlays() {
    this.overlays.clear();
  }

  /** 프레임마다: 투영 + 위치. 겹침 계산은 250ms 마다(4.7.1) */
  private updateOverlays() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const v = new Vector3();
    const screen = new Map<string, { x: number; y: number }>();
    const shown: { id: string; o: Overlay; x: number; y: number; depth: number }[] = [];
    for (const [id, o] of this.overlays) {
      v.copy(o.pos).project(this.camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      if (v.z > 1 || x < -200 || y < -200 || x > w + 200 || y > h + 200) {
        o.el.style.visibility = "hidden";
        continue;
      }
      shown.push({ id, o, x, y, depth: v.z });
      if (o.plateId) screen.set(o.plateId, { x, y });
    }
    this.layoutLabels(shown);
    for (const p of shown) {
      const hidden = p.o.anchor === "block" && this.hiddenLabels.has(p.id);
      p.o.el.style.visibility = hidden ? "hidden" : "visible";
      if (hidden) continue;
      if (p.o.anchor === "plate") {
        p.o.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - 8)}px) translateY(-100%)`;
      } else {
        const lift = this.labelLifts[p.id] ?? 0;
        const shift = this.labelShifts[p.id] ?? 0;
        p.o.el.style.transform = `translate(${Math.round(p.x + shift)}px, ${Math.round(p.y - 6 - lift)}px) translate(-50%, -100%)`;
        p.o.el.style.setProperty("--lift", `${lift}px`);
        p.o.el.style.setProperty("--shift", `${shift}px`);
        if (lift > 0) p.o.el.setAttribute("data-lift", "1");
        else p.o.el.removeAttribute("data-lift");
      }
    }
    this.updatePlateDensity(screen, w);
  }

  private hiddenLabels = new Set<string>();
  private labelSteps: Record<string, LabelStep> = {};
  /** 위로 밀어 올린 높이(px) — `n ≥ 8` 인 상자에만 1px 지시선을 그린다 */
  private labelLifts: Record<string, number> = {};
  /** 좌우로 비켜 간 거리(px) */
  private labelShifts: Record<string, number> = {};
  /** 조정용 자리 통계 (4.7.1 보고 항목) */
  private placement = { atAnchor: 0, lifted: 0, shifted: 0, downgraded: 0, blocked: [] as { id: string; gap: number; score: number }[] };
  private lastLabelAt = 0;

  /**
   * 4.7.1 블록 라벨 겹침: ① 우선순위 점수 → ② 축소 사다리 B0~B3(이웃 간격 g) → ③ 8×8px 격자 점유 → ④ 숨김.
   * 판 라벨이 먼저 점유하므로 블록 라벨이 언제나 진다. 난수 없음 — 같은 카메라면 같은 결과다.
   */
  private layoutLabels(shown: { id: string; o: Overlay; x: number; y: number; depth: number }[]) {
    const now = performance.now();
    if (now - this.lastLabelAt < 250) return;
    this.lastLabelAt = now;

    const blocks = shown.filter((p) => p.o.anchor === "block");
    const plates = shown.filter((p) => p.o.anchor === "plate");

    // ② 이웃 간격 g: 가장 가까운 다른 블록 앵커까지의 화면 거리 (96px 격자 해시로 근처만 본다)
    const CELL = 96;
    const hash = new Map<string, { x: number; y: number }[]>();
    for (const p of blocks) {
      const k = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
      const list = hash.get(k);
      if (list) list.push(p);
      else hash.set(k, [p]);
    }
    const gapOf = (p: { x: number; y: number }) => {
      let best = Infinity;
      const cx = Math.floor(p.x / CELL);
      const cy = Math.floor(p.y / CELL);
      for (let dx = -1; dx <= 1; dx += 1)
        for (let dy = -1; dy <= 1; dy += 1)
          for (const q of hash.get(`${cx + dx}:${cy + dy}`) ?? []) {
            if (q === p) continue;
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            if (d < best) best = d;
          }
      return best;
    };

    // hover 는 그 블록**과 이어진 이웃까지** B0 (4.7.1 ①)
    const hoverNear = new Set<string>();
    if (this.hovered && this.data) {
      hoverNear.add(this.hovered);
      for (const e of this.data.edges) {
        if (e.from === this.hovered) hoverNear.add(e.to);
        else if (e.to === this.hovered) hoverNear.add(e.from);
      }
    }

    // ① 점수
    const maxD = this.maxDistance || 1;
    const scored = blocks.map((p) => {
      let score = p.o.score;
      if (p.id === this.selected) score = 1000;
      else if (hoverNear.has(p.id)) score = 900;
      else if (this.search.has(p.id)) score = 800;
      else if (this.neighbors.has(p.id)) score = Math.max(score, 500);
      else if (score === 0) score = 400 * (1 - Math.min(1, this.distance / maxD));
      return { ...p, score, gap: gapOf(p) };
    });
    scored.sort((a, b) => b.score - a.score || a.depth - b.depth);

    // ③ 8×8px 격자 점유 — 판 라벨이 먼저, 그다음 **모든 블록의 몸체 사각형**(라벨이 블록을 덮지 않게)
    const taken = new Set<string>();
    const cells = (x: number, y: number, bw: number, bh: number, anchorBottom = true) => {
      const out: string[] = [];
      const x0 = Math.floor((x - bw / 2) / 8);
      const x1 = Math.ceil((x + bw / 2) / 8);
      const y0 = Math.floor((anchorBottom ? y - bh : y - bh / 2) / 8);
      const y1 = Math.ceil((anchorBottom ? y : y + bh / 2) / 8);
      for (let i = x0; i < x1; i += 1) for (let j = y0; j < y1; j += 1) out.push(`${i}:${j}`);
      return out;
    };
    /** 몸체 칸은 **그 블록 자신에게는** 막힌 칸이 아니다 */
    const bodyOwner = new Map<string, string>();
    const place = (x: number, y: number, bw: number, bh: number, selfId: string, ignoreLabels = false) => {
      const list = cells(x, y, bw, bh);
      for (const c of list) {
        if (!ignoreLabels && taken.has(c)) return false;
        // 블록 몸체는 **어떤 경우에도** 덮지 않는다(라벨이 블록을 가리면 종류 색·표식을 못 읽는다)
        const owner = bodyOwner.get(c);
        if (owner !== undefined && owner !== selfId) return false;
      }
      for (const c of list) taken.add(c);
      return true;
    };
    for (const p of plates) {
      const d = this.plateDensity[p.o.plateId ?? ""] ?? 0;
      const pw = d === 0 ? 200 : d === 1 ? 160 : d === 2 ? 84 : 64;
      for (const c of cells(p.x + pw / 2, p.y - 8, pw, 56)) taken.add(c);
    }
    // 블록 몸체: 앵커(윗면 중심)를 가운데로 한 변 `4u × px_per_u`
    const pxPerU = (this.canvas.clientHeight || 1) / (2 * this.distance * Math.tan((FOV * DEG) / 2));
    const bodySide = Math.max(6, U.block * pxPerU);
    for (const p of blocks) {
      for (const c of cells(p.x, p.y, bodySide, bodySide, false)) {
        bodyOwner.set(c, bodyOwner.has(c) ? "*" : p.id);
      }
    }

    const steps: Record<string, LabelStep> = {};
    const lifts: Record<string, number> = {};
    const shifts: Record<string, number> = {};
    const hidden = new Set<string>();
    let hiddenNames = 0;
    let hiddenMarkers = 0;
    // 조정용 통계(4.7.1 보고 항목 ④~⑥)
    let statAtAnchor = 0;
    let statLifted = 0;
    let statShifted = 0;
    let statDowngraded = 0;
    const statBlocked: { id: string; gap: number; score: number }[] = [];
    for (const p of scored) {
      if (!p.o.hasName && p.o.markers === 0) {
        hidden.add(p.id);
        continue;
      }
      // ② 사다리 시작 단계
      let step: LabelStep = 4;
      for (let i = 0; i < LABEL_GAP.length; i += 1) {
        if (p.gap >= LABEL_GAP[i]) {
          step = i as LabelStep;
          break;
        }
      }
      if (!p.o.hasName) step = 4;
      // 예외: 선택·hover(이웃 포함)·검색 결과는 B0, 표식 있는 블록은 최소 B2, 선택 이웃은 최소 B3
      if (p.score >= 800) step = 0;
      else if (p.o.hasName && p.o.score >= 600) step = Math.min(step, 2) as LabelStep;
      else if (p.o.hasName && p.score >= 500) step = Math.min(step, 3) as LabelStep;

      const startStep = step;
      let lift = 0;
      let shift = 0;
      let placed = false;
      while (!placed) {
        const box = LABEL_BOX[step];
        const bw = step === 4 ? Math.max(box.w, p.o.markers * 22) : box.w;
        const oMax = offsetMax(bw);
        // 같은 단계에서 자리 후보 19개를 모두 시도한 **뒤에** 단계를 내린다
        for (const n of LIFT_STEPS) {
          const offsets = n === 0 || oMax === 0 ? [0] : [0, -oMax, oMax];
          for (const o of offsets) {
            if (place(p.x + o, p.y - 6 - n, bw, box.h, p.id)) {
              lift = n;
              shift = o;
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
        if (placed) break;
        if (step === 4 || p.score >= 800) break;
        // **표식 있는 블록은 B2 밑으로 내려가지 않는다**(4.7.1 ②-1: 표식은 "봐야 할 것"이라 이름이 함께 보여야 한다).
        // 19자리가 다 막히면 그중 **부딪히는 칸이 가장 적은 자리**에 겹쳐서 그린다(밀어 올린 자리가 대개 이긴다).
        if (p.o.markers > 0 && step >= 2) {
          let best: { n: number; o: number; cost: number } | null = null;
          for (const n of LIFT_STEPS) {
            const oMax2 = offsetMax(bw);
            const offs = n === 0 || oMax2 === 0 ? [0] : [0, -oMax2, oMax2];
            for (const o of offs) {
              let cost = 0;
              for (const c of cells(p.x + o, p.y - 6 - n, bw, box.h)) {
                if (taken.has(c)) cost += 1;
                const owner = bodyOwner.get(c);
                if (owner !== undefined && owner !== p.id) cost += 3; // 블록을 가리는 쪽이 더 나쁘다
              }
              if (!best || cost < best.cost) best = { n, o, cost };
            }
          }
          if (best) {
            for (const c of cells(p.x + best.o, p.y - 6 - best.n, bw, box.h)) taken.add(c);
            lift = best.n;
            shift = best.o;
            placed = true;
            break;
          }
        }
        step = (step + 1) as LabelStep;
      }
      if (!placed && p.o.markers > 0) {
        // **표식은 지우지 않는다**(1절 정보 우선순위 2): 19자리가 다 막혀도 겹치더라도 그린다.
        // 이름만 잃는다 → `라벨 N개 숨김` 에는 센다.
        statBlocked.push({ id: p.id, gap: Math.round(p.gap), score: Math.round(p.score) });
        step = 4;
        placed = true;
      }
      if (!placed) {
        // ④ 숨김: 19자리가 다 막혔다. 점수가 낮은 쪽이 진다(정렬 순서가 곧 우선순위다)
        hidden.add(p.id);
        statBlocked.push({ id: p.id, gap: Math.round(p.gap), score: Math.round(p.score) });
        if (p.o.hasName) hiddenNames += 1;
        if (p.o.markers > 0) hiddenMarkers += 1;
        continue;
      }
      steps[p.id] = step;
      lifts[p.id] = lift;
      shifts[p.id] = shift;
      if (lift > 0) statLifted += 1;
      else statAtAnchor += 1;
      if (shift !== 0) statShifted += 1;
      if (step > startStep) statDowngraded += 1;
      // 이름 글자가 하나도 안 그려진 블록(B4)도 `라벨 N개 숨김` 에 센다
      if (step === 4 && p.o.hasName) hiddenNames += 1;
    }
    this.placement = {
      atAnchor: statAtAnchor,
      lifted: statLifted,
      shifted: statShifted,
      downgraded: statDowngraded,
      blocked: statBlocked,
    };

    const sameSteps =
      Object.keys(steps).length === Object.keys(this.labelSteps).length &&
      Object.entries(steps).every(([k, v]) => this.labelSteps[k] === v);
    const sameHidden = hidden.size === this.hiddenLabels.size && [...hidden].every((k) => this.hiddenLabels.has(k));
    this.hiddenLabels = hidden;
    this.labelLifts = lifts;
    this.labelShifts = shifts;
    if (!sameSteps || !sameHidden) {
      this.labelSteps = steps;
      this.cb.onLabelLayout?.({ steps, hidden: [...hidden], hiddenNames, hiddenMarkers });
    }
  }

  /** 측정용: 지금 이름 글자가 보이는 블록 수 / 후보 수 (수용 기준 확인) */
  labelStats(): {
    withName: number;
    total: number;
    hiddenNames: number;
    hiddenMarkers: number;
    placement: { atAnchor: number; lifted: number; shifted: number; downgraded: number; blocked: { id: string; gap: number; score: number }[] };
  } {
    let withName = 0;
    let total = 0;
    let hiddenNames = 0;
    let hiddenMarkers = 0;
    for (const [id, o] of this.overlays) {
      if (o.anchor !== "block") continue;
      total += 1;
      const step = this.labelSteps[id];
      const shown = !this.hiddenLabels.has(id) && step !== undefined && step <= 3;
      if (shown && o.hasName) withName += 1;
      else if (o.hasName) hiddenNames += 1;
      if (this.hiddenLabels.has(id) && o.markers > 0) hiddenMarkers += 1;
    }
    return { withName, total, hiddenNames, hiddenMarkers, placement: this.placement };
  }

  /** 판 라벨 가용 폭 A = 같은 줄 다음 판 앵커까지의 화면 거리 − 8px (4.1.1). 줄의 마지막 판은 200px */
  private updatePlateDensity(screen: Map<string, { x: number; y: number }>, width: number) {
    const now = performance.now();
    if (now - this.lastDensityAt < 250 || !this.data || !this.cb.onPlateDensity) return;
    this.lastDensityAt = now;
    const byRow = new Map<number, { id: string; x: number; col: number }[]>();
    for (const [id, pt] of screen) {
      const lp = this.data.layout.plates.get(id);
      if (!lp) continue;
      const list = byRow.get(lp.row);
      if (list) list.push({ id, x: pt.x, col: lp.col });
      else byRow.set(lp.row, [{ id, x: pt.x, col: lp.col }]);
    }
    const next: Record<string, 0 | 1 | 2 | 3> = {};
    for (const list of byRow.values()) {
      list.sort((a, b) => a.col - b.col);
      list.forEach((item, i) => {
        const nextItem = list[i + 1];
        const a = nextItem ? Math.abs(nextItem.x - item.x) - 8 : Math.min(200, Math.max(0, width - item.x - 8));
        next[item.id] = a >= 200 ? 0 : a >= 132 ? 1 : a >= 84 ? 2 : 3;
      });
    }
    const changed =
      Object.keys(next).length !== Object.keys(this.plateDensity).length ||
      Object.entries(next).some(([k, v]) => this.plateDensity[k] !== v);
    if (changed) {
      this.plateDensity = next;
      this.cb.onPlateDensity(next);
    }
  }

  // ------------------------------------------------------------ 렌더 루프 (조작이 있을 때만)

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate() {
    if (this.disposed || this.frame !== 0) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    this.frame = 0;
    if (this.disposed) return;
    let again = false;
    if (this.animation) {
      const t = Math.min(1, (now - this.animation.start) / 300);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.target.lerpVectors(this.animation.from.t, this.animation.to.t, e);
      this.distance = this.animation.from.d + (this.animation.to.d - this.animation.from.d) * e;
      if (t >= 1) this.animation = null;
      else again = true;
    }
    this.updateCamera();
    this.updateFog();
    this.updateLayerFade();
    this.renderer.render(this.scene, this.camera);
    this.updateOverlays();
    this.measure(now);
    if (again) this.invalidate();
  };

  private updateCamera() {
    const ce = Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + this.distance * ce * Math.sin(this.azimuth),
      this.target.y + this.distance * Math.sin(this.elevation),
      this.target.z + this.distance * ce * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** 위에서 보는 시점(고도 70° 이상)에서는 위쪽 층의 면을 옅게 해 아래층을 보이게 한다 (4.9) */
  private updateLayerFade() {
    const fade = this.elevation > 70 * DEG;
    for (const group of this.blockGroups) {
      if (group.ghost) continue; // 유령 면은 이미 반투명이다
      const mat = group.mesh.material as MeshBasicMaterial;
      const upper = group.layer !== "aux" && STACK_LAYERS.indexOf(group.layer) > 0;
      const wanted = fade && upper;
      if (mat.transparent !== wanted) {
        mat.transparent = wanted;
        mat.opacity = wanted ? 0.35 : 1;
        mat.needsUpdate = true;
      }
    }
  }

  /** 조작 중 5초 동안 중앙값 20fps 미만이면 알린다 (AC-3D07) */
  private lastFrameAt = 0;
  private measure(now: number) {
    if (this.lastFrameAt > 0) {
      const dt = now - this.lastFrameAt;
      if (dt < 500) this.frameTimes.push({ t: now, dt });
    }
    this.lastFrameAt = now;
    while (this.frameTimes.length > 0 && now - this.frameTimes[0].t > 5000) this.frameTimes.shift();
    if (this.lowReported || this.frameTimes.length < 60) return;
    const sorted = this.frameTimes.map((f) => f.dt).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > 50) {
      this.lowReported = true;
      this.cb.onLowPerformance?.();
    }
  }

  /** 측정용(4.11.5): 드로콜·삼각형 수와 **층 × 모양 조합** 목록. 화면 동작에는 쓰지 않는다 */
  renderStats(): { calls: number; triangles: number; groups: number; combos: string[] } {
    const info = this.renderer.info.render;
    return {
      calls: info.calls,
      triangles: info.triangles,
      groups: this.blockGroups.length,
      combos: this.blockGroups.map((g) => `${g.ghost ? "ghost" : g.layer}/${g.shape}×${g.ids.length}`),
    };
  }

  /** 측정용: 최근 5초 프레임 간격 중앙값(ms). 0 이면 표본 부족 */
  frameStats(): { median: number; p95: number; samples: number } {
    const sorted = this.frameTimes.map((f) => f.dt).sort((a, b) => a - b);
    if (sorted.length === 0) return { median: 0, p95: 0, samples: 0 };
    return {
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
      samples: sorted.length,
    };
  }

  dispose() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.clearOverlays();
    this.clearContent();
    this.renderer.dispose();
  }
}
