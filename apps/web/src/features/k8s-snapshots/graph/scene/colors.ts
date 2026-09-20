/**
 * 3D 장면 색은 **CSS 변수에서 읽는다** (publisher 요청). 하드코딩하지 않아 테마 전환(라이트/다크)에 자동으로 맞는다.
 * three.js 가 필요 없는 순수 함수라 3D 청크 밖에 둔다.
 */
export const VIZ_LAYERS = ["storage", "workload", "service", "ingress", "aux"] as const;
export type VizColorLayer = (typeof VIZ_LAYERS)[number];

export interface VizColors {
  kind: Record<VizColorLayer, { fill: string; edge: string; onFill: string }>;
  sceneBg: string;
  fog: string;
  grid: string;
  plateFill: string;
  plateFillAlt: string;
  plateEdge: string;
  ghostEdge: string;
  ghostFill: string;
  edgeConfirmed: string;
  edgeEstimated: string;
  edgeHighlight: string;
  edgeDimmed: string;
  selectOutline: string;
  searchOutline: string;
  dimmed: number;
  ghostOpacity: number;
}

const FALLBACK = "#808080";

export function readVizColors(root?: HTMLElement | null): VizColors {
  const el = root ?? (typeof document !== "undefined" ? document.documentElement : null);
  const cs = el && typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  const v = (name: string, fallback = FALLBACK): string => {
    const raw = cs?.getPropertyValue(name)?.trim();
    return raw && raw.length > 0 ? raw : fallback;
  };
  const num = (name: string, fallback: number): number => {
    const raw = Number(cs?.getPropertyValue(name)?.trim());
    return Number.isFinite(raw) ? raw : fallback;
  };
  const kind = {} as VizColors["kind"];
  for (const l of VIZ_LAYERS) {
    kind[l] = {
      fill: v(`--color-viz-kind-${l}-fill`),
      edge: v(`--color-viz-kind-${l}-edge`),
      onFill: v(`--color-viz-kind-${l}-on-fill`),
    };
  }
  return {
    kind,
    sceneBg: v("--color-viz-scene-bg", "#ECEEF2"),
    fog: v("--color-viz-scene-fog", "#ECEEF2"),
    grid: v("--color-viz-scene-grid", "#E2E6EB"),
    plateFill: v("--color-viz-plate-fill", "#FDFDFE"),
    plateFillAlt: v("--color-viz-plate-fill-alt", "#F1F3F6"),
    plateEdge: v("--color-viz-plate-edge", "#D9DDE3"),
    ghostEdge: v("--color-viz-ghost-edge", "#8C95A1"),
    ghostFill: v("--color-viz-ghost-fill", "#EEF0F3"),
    edgeConfirmed: v("--color-viz-edge-confirmed", "#5B6573"),
    edgeEstimated: v("--color-viz-edge-estimated", "#8C95A1"),
    edgeHighlight: v("--color-viz-edge-highlight", "#2F6FED"),
    edgeDimmed: v("--color-viz-edge-dimmed", "#C9CFD8"),
    selectOutline: v("--color-viz-select-outline", "#2F6FED"),
    searchOutline: v("--color-viz-search-outline", "#2F6FED"),
    dimmed: num("--opacity-viz-dimmed", 0.25),
    ghostOpacity: num("--opacity-viz-ghost", 0.35),
  };
}

/** WebGL 을 쓸 수 있는가 (AC-3D03). 컨텍스트를 만들고 바로 버린다 */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return false;
    const lose = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}
