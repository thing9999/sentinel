import { cx } from "../cx";
import styles from "./chart-frame.module.css";

export interface ChartLegendItem {
  label: string;
  /** 토큰 CSS 변수로 넘긴다 (예: `var(--color-chart-cpu)`) */
  color: string;
  /** 점선 시리즈: 16×2px 점선 스와치 (추정·예측) */
  dashed?: boolean;
  /** 빗금 스와치 (미확정 막대) */
  hatched?: boolean;
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  className?: string;
}

/** status.md 4.3 범례: 높이 20px, 스와치 8×8(점선은 16×2), 간격 12px. 차트 위 오른쪽. */
export function ChartLegend({ items, className }: ChartLegendProps) {
  return (
    <ul className={cx(styles.legendList, className)} aria-label="범례">
      {items.map((it) => (
        <li key={it.label} className={styles.legendItem}>
          <span
            className={cx(styles.swatch, it.dashed && styles.swatchDashed, it.hatched && styles.swatchHatched)}
            style={{ ["--swatch" as string]: it.color }}
            aria-hidden="true"
          />
          <span>{it.label}</span>
        </li>
      ))}
    </ul>
  );
}
