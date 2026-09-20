import { cx } from "../cx";
import { VIZ_LAYER, type VizLayer } from "./viz";
import styles from "./viz.module.css";

export interface LayerSwatchProps {
  /** 없으면 유령(점선 빈 사각) */
  layer?: VizLayer | null;
  /** px, 기본 10 (관계 항목 10 · 범례·패널 12) */
  size?: 10 | 12;
  /** 유령 블록 표시(면 없음 + 1.5px dashed) */
  ghost?: boolean;
  /**
   * 스크린리더 문구. 기본은 장식(aria-hidden): 층 이름이 옆 글자로 이미 읽히는 자리가 대부분이다.
   * 색만으로 뜻을 전하지 않으므로 사각형 자체는 보조 표시다(status.md 11.1).
   */
  srText?: string;
  className?: string;
}

/**
 * 층(= 종류) 색 사각. components.md 17.3 / snapshot-3d.md 5.2.
 * **면 색은 층을 뜻하고 상태가 아니다.** 상태·드리프트는 `BlockMarkers`로만 표시한다.
 */
export function LayerSwatch({ layer, size = 10, ghost = false, srText, className }: LayerSwatchProps) {
  const isGhost = ghost || !layer;
  return (
    <span
      className={cx(styles.swatch, isGhost && styles.swatchGhost, className)}
      data-layer={isGhost ? undefined : layer}
      style={{ width: size, height: size }}
      role={srText ? "img" : undefined}
      aria-label={srText ?? undefined}
      aria-hidden={srText ? undefined : true}
      title={srText ?? (layer && !isGhost ? VIZ_LAYER[layer].label : undefined)}
    />
  );
}
