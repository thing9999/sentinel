"use client";

import { useId } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import {
  CERTAINTY,
  GHOST_LABEL,
  LEGEND_NOTES,
  PLATE_MARKER_NOTE,
  VIZ_LAYER,
  VIZ_LAYER_ORDER,
  type VizLayer,
} from "./viz";
import { KindIcon, type VizShape } from "./KindIcon";
import { LayerSwatch } from "./LayerSwatch";
import { ShapeSwatch } from "./ShapeSwatch";
import styles from "./viz.module.css";

export interface SceneLegendLayer {
  layer: VizLayer;
  label: string;
  /** 대표 종류 caption (`Deployment 외`) */
  example: string;
  /** 대표 종류 아이콘 12px (`Deployment` → `boxes`). 없으면 아이콘을 그리지 않는다 */
  exampleKind?: string;
}

export interface SceneLegendShape {
  shape: VizShape;
  /** 그 모양을 쓰는 종류 문구 (`StatefulSet · PVC`) */
  label: string;
}

export interface SceneLegendMarker {
  icon: IconName;
  /** 툴팁·스크린리더 문구 */
  text: string;
  tone?: "crit" | "warn" | "secondary" | "tertiary";
}

export interface SceneLegendProps {
  /** 기본: 층 5줄(저장·설정 → 워크로드 → 서비스 → 진입 → 곁) */
  layers?: SceneLegendLayer[];
  /** 기본: 모양 9종(고정 순서·고정 문구). 빈 배열을 주면 「모양 = 종류」 절을 그리지 않는다 */
  shapes?: SceneLegendShape[];
  /** 기본: 스캔 2 + 드리프트 3 + 비교 불가 1 */
  markers?: SceneLegendMarker[];
  /** 유령 줄 문구, 기본 `스냅샷에 없음 · Secret` */
  ghostText?: string;
  /** 머리 오른쪽 `x`. 팝오버를 닫는다 */
  onClose?: () => void;
  /**
   * @deprecated 범례는 더 이상 접히지 않는다(캔버스 밖 Popover, snapshot-3d.md 6.5).
   * 기존 사용처가 깨지지 않게 받기만 하고 **무시한다**. 여는·닫는 것은 `Popover` 가 맡는다.
   */
  collapsed?: boolean;
  /** @deprecated 위와 같다. `onClose` 를 쓴다 */
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
}

export const DEFAULT_LEGEND_LAYERS: SceneLegendLayer[] = VIZ_LAYER_ORDER.map((l) => ({
  layer: l,
  label: VIZ_LAYER[l].label,
  example: VIZ_LAYER[l].example,
  exampleKind: VIZ_LAYER[l].exampleKind,
}));

/**
 * 「모양 = 종류」 9줄 (snapshot-3d.md 6.5 표 · 4.11.2). **순서·문구 고정**이다.
 * 범례는 모양을 읽는 **유일한 해설 자리**라 종류 문구를 서버 값으로 바꾸지 않는다.
 */
export const DEFAULT_LEGEND_SHAPES: SceneLegendShape[] = [
  { shape: "stack", label: "Deployment" },
  { shape: "cylinder", label: "StatefulSet · PVC" },
  { shape: "panel", label: "DaemonSet · ConfigMap" },
  { shape: "roof", label: "CronJob" },
  { shape: "chamfer", label: "Job · Secret" },
  { shape: "diamond", label: "Service" },
  { shape: "gate", label: "Ingress" },
  { shape: "box", label: "그 밖 · Pod" },
  { shape: "tile", label: "곁 리소스 (HPA · PDB 외)" },
];

export const SHAPE_SECTION_TITLE = "모양 = 종류";

export const DEFAULT_LEGEND_MARKERS: SceneLegendMarker[] = [
  { icon: "octagon-x", text: "스캔 오류", tone: "crit" },
  { icon: "triangle-alert", text: "스캔 경고", tone: "warn" },
  { icon: "square-dot", text: "변경됨", tone: "secondary" },
  { icon: "square-minus", text: "삭제됨", tone: "secondary" },
  { icon: "square-plus", text: "추가됨", tone: "secondary" },
  { icon: "eye-off", text: "비교 불가", tone: "tertiary" },
];

/**
 * components.md 16.5 / snapshot-3d.md 6.5. **도구 막대 B `범례` 버튼에 붙는 Popover 안 내용**(폭 280px).
 * 2026-09-20부터 캔버스 오버레이가 아니다 — 범례가 왼쪽 뒤 판을 가리고, 접힘 상태에 따라
 * 카메라 안전 영역(4.9)이 달라져 같은 스냅샷의 첫 화면이 매번 달라졌다.
 * 맨 아래 두 줄(`블록 색은 층, 모양은 종류를 뜻합니다. 상태가 아닙니다.`)은 **항상** 보인다
 * — 면 색·몸체 모양이 상태로 읽히는 것을 막는다(status.md 11.1).
 * 관계 표 보기에서도 **같은 버튼·같은 팝오버**를 쓴다(8.1).
 */
export function SceneLegend({
  layers = DEFAULT_LEGEND_LAYERS,
  shapes = DEFAULT_LEGEND_SHAPES,
  markers = DEFAULT_LEGEND_MARKERS,
  ghostText = "스냅샷에 없음 · Secret",
  onClose,
  className,
}: Readonly<SceneLegendProps>) {
  const shapeTitleId = useId();
  return (
    <section className={cx(styles.legend, className)} aria-label="범례">
      <div className={styles.legendHead}>
        <span className={styles.legendTitle}>범례</span>
        {onClose ? <IconButton icon="x" size="sm" label="닫기" onClick={onClose} /> : null}
      </div>

      <ul className={styles.legendList}>
        {layers.map((l) => (
          <li key={l.layer} className={styles.legendRow}>
            <LayerSwatch layer={l.layer} size={12} />
            <span>{l.label}</span>
            <span className={styles.legendExample}>
              {/* 대표 종류 아이콘 12px — 종류 해설 20여 줄은 넣지 않는다(16.5) */}
              {l.exampleKind ? <KindIcon kind={l.exampleKind} size={12} className={styles.legendExampleIcon} /> : null}
              {l.example}
            </span>
          </li>
        ))}
      </ul>

      {/* 「모양 = 종류」 — 층 5줄 **바로 아래**(색 → 모양 순서). 견본은 **중립색**이다:
          바로 위 5줄이 색을 말하므로 견본까지 색을 쓰면 "모양 × 색" 45칸으로 읽게 된다(6.5).
          층 색으로 채운 견본은 종류 필터 옵션에만 둔다(6.1) */}
      {shapes.length > 0 ? (
        <section className={styles.legendShapes}>
          <p className={styles.legendShapeTitle} id={shapeTitleId}>
            {SHAPE_SECTION_TITLE}
          </p>
          <ul className={styles.legendShapeGrid} aria-labelledby={shapeTitleId}>
            {shapes.map((s) => (
              <li key={s.shape} className={styles.legendShapeItem}>
                <ShapeSwatch shape={s.shape} size={16} />
                <span className={styles.legendShapeItemText}>{s.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul className={styles.legendList}>
        <li className={styles.legendRow}>
          <LayerSwatch ghost size={12} />
          <span>{GHOST_LABEL}</span>
          <span className={styles.legendExample}>{ghostText}</span>
        </li>
        <li className={styles.legendRow}>
          <span className={styles.edgeSample} aria-hidden="true" />
          <span>{CERTAINTY.confirmed.label}</span>
        </li>
        <li className={styles.legendRow}>
          <span className={cx(styles.edgeSample, styles.edgeSampleDashed)} aria-hidden="true" />
          <span>{CERTAINTY.estimated.label}</span>
        </li>
      </ul>

      <ul className={styles.legendMarkers} aria-label="표식">
        {markers.map((m) => (
          <li key={m.icon}>
            <Tooltip content={m.text} focusable>
              <span className={cx(styles.legendMarker, m.tone && styles[`tone-${m.tone}`])}>
                <Icon name={m.icon} size={14} title={m.text} />
              </span>
            </Tooltip>
          </li>
        ))}
      </ul>

      {/* 원 = 블록, 알약 = 판 (status.md 11.5). 같은 아이콘·색을 쓰므로 모양이 유일한 구분이다 */}
      <ul className={styles.legendList} aria-label="표식 모양">
        <li className={styles.legendRow}>
          <span className={styles.legendDotSample} aria-hidden="true">
            <Icon name="square-dot" size={12} />
          </span>
          <span className={styles.legendPillSample} aria-hidden="true">
            <Icon name="square-dot" size={12} />
            <span>변경 · 필드 1건</span>
          </span>
        </li>
        <li className={cx(styles.legendRow, styles.legendShapeNote)}>{PLATE_MARKER_NOTE}</li>
      </ul>

      <p className={styles.legendNote}>
        {LEGEND_NOTES.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </p>
    </section>
  );
}
