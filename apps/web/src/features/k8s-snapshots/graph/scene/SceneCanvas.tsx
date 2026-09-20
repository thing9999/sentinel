"use client";

/**
 * 3D 캔버스 (three.js). **3D 보기를 처음 열 때만 내려받는 청크**의 진입점이다(AC-3D01·02).
 *
 * - 캔버스는 탭 정지점 **한 개**이고 `role="application"` 이다(11.1·11.2). 라벨·표식은 2D HTML 오버레이.
 * - 카메라 키(방향키·`+`/`-`·`0`·`1`·`2`·`3`)는 여기서 처리하고, 블록 이동·이동·표 전환 같은
 *   화면 뜻이 있는 키는 `onCommand` 로 올려 보낸다(페이지가 안다).
 * - k8s 전용 문구를 담지 않는다(2단계 AWS 에서 같은 틀을 쓴다, 디자인 15절).
 */
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from "react";

import type { GraphLayout } from "../layout";
import type { GraphBlock, GraphEdge, GraphPlate } from "../types";
import { readVizColors } from "./colors";
import { GraphScene, type CameraViewpoint, type LabelStep } from "./engine";
import styles from "./scene.module.css";
import { shapeStats, shapesOutsideEnvelope, type VizShape } from "./shapes";

export type SceneCommand =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "nextPlate"
  | "prevPlate"
  | "activate"
  | "clear"
  | "focus"
  | "table"
  | "help";

export interface SceneCanvasHandle {
  reset(): void;
  fitCheck(): { dx: number; dy: number; inside: boolean; offscreen: boolean } | null;
  zoomToFitAll(): void;
  viewpoint(v: CameraViewpoint): void;
  zoomIn(): void;
  zoomOut(): void;
  focusBlock(id: string): void;
  frameStats(): { median: number; p95: number; samples: number };
}

export interface SceneCanvasProps {
  layout: GraphLayout;
  plates: GraphPlate[];
  blocks: GraphBlock[];
  edges: GraphEdge[];
  /** 블록 id → 모양(4.11). 퍼블리셔 `kindShape()` 의 결과를 그대로 넘긴다 */
  shapes?: Record<string, VizShape>;
  /** 같은 값이면 배치를 다시 만들지 않는다(`graph.version` + 필터 지문) */
  buildKey: string;
  /** 카메라를 유지해야 하는가(표식만 바뀐 갱신) */
  keepCamera: boolean;
  selectedId: string | null;
  neighborIds: string[];
  searchIds: string[];
  /** 4.7.1 ① 점수(스캔 오류 700 · 그 밖 표식 600 · 나머지 0)와 상자 내용 */
  labels: { id: string; score: number; markers: number; hasName: boolean }[];
  renderBlockLabel: (id: string, step: LabelStep) => ReactNode;
  renderPlateLabel: (id: string, density: 0 | 1 | 2 | 3) => ReactNode;
  reducedMotion?: boolean;
  lowDetail?: boolean;
  /** 2D 오버레이(범례·카메라 오버레이·정보 줄)가 덮는 여백 px — 장면을 이 안쪽에 맞춘다 */
  insets?: { left: number; right: number; top: number; bottom: number };
  ariaLabel: string;
  ariaDescription: string;
  onSelect: (id: string | null) => void;
  onActivate: (id: string) => void;
  onHover?: (id: string | null) => void;
  onCommand: (cmd: SceneCommand) => void;
  onContextLost: () => void;
  onLowPerformance: () => void;
  /** 4.7.1 ④ 숨긴 이름·표식 수 → 정보 줄 칩 */
  onLabelOverflow?: (v: { names: number; markers: number }) => void;
  /** 4.9-2 `d_read` 상한에 걸려 장면 일부가 화면 밖 */
  onOffscreen?: (v: boolean) => void;
}

const ROTATE_STEP = (5 * Math.PI) / 180;

export const SceneCanvas = forwardRef<SceneCanvasHandle, SceneCanvasProps>(function SceneCanvas(props, ref) {
  const {
    layout,
    plates,
    blocks,
    edges,
    shapes,
    buildKey,
    keepCamera,
    selectedId,
    neighborIds,
    searchIds,
    labels,
    renderBlockLabel,
    renderPlateLabel,
    reducedMotion = false,
    lowDetail = false,
    insets,
    ariaLabel,
    ariaDescription,
    onSelect,
    onActivate,
    onHover,
    onCommand,
    onContextLost,
    onLowPerformance,
    onLabelOverflow,
    onOffscreen,
  } = props;

  const descId = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const [ready, setReady] = useState(false);
  const [density, setDensity] = useState<Record<string, 0 | 1 | 2 | 3>>({});
  const [steps, setSteps] = useState<Record<string, LabelStep>>({});

  // 콜백은 ref 로 흘려 엔진을 다시 만들지 않는다
  const cbRef = useRef({ onSelect, onActivate, onHover, onContextLost, onLowPerformance, onLabelOverflow, onOffscreen });
  cbRef.current = { onSelect, onActivate, onHover, onContextLost, onLowPerformance, onLabelOverflow, onOffscreen };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new GraphScene(canvas, readVizColors(canvas), {
      onSelect: (id) => cbRef.current.onSelect(id),
      onActivate: (id) => cbRef.current.onActivate(id),
      onHover: (id) => cbRef.current.onHover?.(id),
      onContextLost: () => cbRef.current.onContextLost(),
      onLowPerformance: () => cbRef.current.onLowPerformance(),
      onPlateDensity: (d) => setDensity(d),
      onLabelLayout: (l) => {
        setSteps(l.steps);
        cbRef.current.onLabelOverflow?.({ names: l.hiddenNames, markers: l.hiddenMarkers });
      },
      onOffscreen: (v) => cbRef.current.onOffscreen?.(v),
    });
    sceneRef.current = scene;
    // 측정용 훅(4.9-3 자가 점검·4.7.1 수용 기준·성능). 화면 동작에는 쓰지 않는다
    (window as unknown as { __sentinel3d?: unknown }).__sentinel3d = {
      fitCheck: () => scene.fitCheck(),
      labelStats: () => scene.labelStats(),
      frameStats: () => scene.frameStats(),
      // 4.11 확인용: 드로콜·층×모양 조합·모양별 삼각형 수·봉투 이탈 점검
      renderStats: () => scene.renderStats(),
      shapeStats: () => shapeStats(),
      shapeCheck: () => shapesOutsideEnvelope(),
    };
    scene.resize();
    setReady(true);
    const host = hostRef.current;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => scene.resize()) : null;
    if (host && ro) ro.observe(host);
    // 탭이 숨겨지면 그리지 않는다(AC-3D17). 다시 보이면 한 번 그린다
    const onVisible = () => {
      if (document.visibilityState !== "hidden") scene.invalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      ro?.disconnect();
      delete (window as unknown as { __sentinel3d?: unknown }).__sentinel3d;
      sceneRef.current = null;
      setReady(false);
      scene.dispose();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion, ready]);

  useEffect(() => {
    sceneRef.current?.setLowDetail(lowDetail);
  }, [lowDetail, ready]);

  // 배치는 buildKey 가 바뀔 때만 다시 만든다(같은 입력 같은 배치, AC-3D11)
  useEffect(() => {
    if (insets) sceneRef.current?.setInsets(insets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets?.left, insets?.right, insets?.top, insets?.bottom, ready]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (insets) scene.setInsets(insets);
    scene.clearOverlays();
    scene.setData({ layout, plates, blocks, edges, shapes }, keepCamera);
    // layout·plates·blocks·edges 는 buildKey 로 대표한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey, ready]);

  useEffect(() => {
    sceneRef.current?.setSelection(selectedId, neighborIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, neighborIds.join(","), ready]);

  useEffect(() => {
    sceneRef.current?.setSearch(searchIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchIds.join(","), ready]);

  useImperativeHandle(
    ref,
    (): SceneCanvasHandle => ({
      reset: () => sceneRef.current?.resetCamera(),
      fitCheck: () => sceneRef.current?.fitCheck() ?? null,
      zoomToFitAll: () => sceneRef.current?.zoomToFitAll(),
      viewpoint: (v) => sceneRef.current?.setViewpoint(v),
      zoomIn: () => sceneRef.current?.zoom(1 / 1.12),
      zoomOut: () => sceneRef.current?.zoom(1.12),
      focusBlock: (id) => sceneRef.current?.focusBlock(id),
      frameStats: () => sceneRef.current?.frameStats() ?? { median: 0, p95: 0, samples: 0 },
    }),
    [],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const shift = e.shiftKey;
      const pan = (x: number, y: number) => scene.pan(x, y);
      switch (e.key) {
        case "ArrowUp":
          if (shift) pan(0, 40);
          else scene.rotate(0, ROTATE_STEP);
          break;
        case "ArrowDown":
          if (shift) pan(0, -40);
          else scene.rotate(0, -ROTATE_STEP);
          break;
        case "ArrowLeft":
          if (shift) pan(-40, 0);
          else scene.rotate(-ROTATE_STEP, 0);
          break;
        case "ArrowRight":
          if (shift) pan(40, 0);
          else scene.rotate(ROTATE_STEP, 0);
          break;
        case "+":
        case "=":
          scene.zoom(1 / 1.12);
          break;
        case "-":
        case "_":
          scene.zoom(1.12);
          break;
        case "0":
          scene.resetCamera();
          break;
        case "1":
          scene.setViewpoint("top");
          break;
        case "2":
          scene.setViewpoint("iso");
          break;
        case "3":
          scene.setViewpoint("front");
          break;
        case "]":
          onCommand("next");
          break;
        case "[":
          onCommand("prev");
          break;
        case "Home":
          onCommand("first");
          break;
        case "End":
          onCommand("last");
          break;
        case "PageDown":
          onCommand("nextPlate");
          break;
        case "PageUp":
          onCommand("prevPlate");
          break;
        case "Enter":
          onCommand("activate");
          break;
        case "Escape":
          onCommand("clear");
          break;
        case "f":
        case "F":
          onCommand("focus");
          break;
        case "t":
        case "T":
          onCommand("table");
          break;
        case "?":
          onCommand("help");
          break;
        default:
          return;
      }
      e.preventDefault();
    },
    [onCommand],
  );

  const overlayRef = useCallback(
    (id: string, kind: "block" | "plate", meta?: { score: number; markers: number; hasName: boolean }) =>
      (el: HTMLDivElement | null) => {
        sceneRef.current?.registerOverlay(id, el, kind, meta ?? {});
      },
    [],
  );

  /** 카메라 초기화 등으로 다시 맞춘 뒤 자가 점검(4.9-3)을 읽는다 — 테스트·개발 확인용 */
  const fitCheck = useCallback(() => sceneRef.current?.fitCheck() ?? null, []);
  void fitCheck;

  return (
    <div className={styles.host} ref={hostRef}>
      <div
        className={styles.app}
        role="application"
        aria-roledescription="3D 구성도"
        aria-label={ariaLabel}
        aria-describedby={descId}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
      <p id={descId} className="sr-only">
        {ariaDescription}
      </p>
      <div className={styles.overlay} aria-hidden="true">
        {ready
          ? plates.map((p) => (
              <div key={`plate:${p.id}`} className={styles.item} ref={overlayRef(p.id, "plate")}>
                {renderPlateLabel(p.id, density[p.id] ?? 0)}
              </div>
            ))
          : null}
        {ready
          ? labels.map((l) => (
              <div key={`block:${l.id}`} className={styles.item} ref={overlayRef(l.id, "block", l)}>
                {renderBlockLabel(l.id, steps[l.id] ?? 0)}
              </div>
            ))
          : null}
      </div>
    </div>
  );
});

export default SceneCanvas;
