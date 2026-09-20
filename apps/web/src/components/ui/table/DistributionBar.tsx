import { cx } from "../cx";
import { formatCount } from "../format";
import { Tooltip } from "../overlay/Tooltip";
import type { Status } from "../types";
import styles from "./table.module.css";

export interface DistributionSegment {
  value: number;
  /** 상태 색(status.<key>.solid) */
  status?: Status;
  /** 상태가 아닐 때 색. 토큰 CSS 변수로 넘긴다 (예: `var(--color-chart-series-0)`) */
  color?: string;
  label: string;
  /** 툴팁 값 문구 (기본: 천 단위 쉼표 숫자) */
  valueText?: string;
}

export interface DistributionBarProps {
  segments: DistributionSegment[];
  /** 4 | 8px */
  height?: 4 | 8;
  /** px, 기본 100% */
  width?: number;
  /** 스크린리더 이름 (예: `파드 상태 분포`) */
  label?: string;
  className?: string;
}

/** components.md 7.4. 세그먼트 사이 1px bg.surface 틈, 툴팁에 라벨·값. */
export function DistributionBar({ segments, height = 8, width, label = "분포", className }: DistributionBarProps) {
  const shown = segments.filter((s) => s.value > 0);
  const summary = `${label}: ${segments.map((s) => `${s.label} ${s.valueText ?? formatCount(s.value)}`).join(", ")}`;
  return (
    <span
      className={cx(styles.dist, height === 4 ? styles.dist4 : styles.dist8, className)}
      style={width ? { width: `min(${width}px, 100%)` } : undefined}
      role="img"
      aria-label={summary}
    >
      {shown.length === 0 ? <span className={styles.distEmpty} /> : null}
      {shown.map((s, i) => (
        <span key={`${s.label}-${i}`} className={styles.distSegWrap} style={{ flexGrow: s.value }}>
          <Tooltip content={`${s.label}: ${s.valueText ?? formatCount(s.value)}`} className={styles.distTip}>
            <span
              className={cx(styles.distSeg, s.status && styles[`distSeg-${s.status}`])}
              style={!s.status && s.color ? { background: s.color } : undefined}
            />
          </Tooltip>
        </span>
      ))}
    </span>
  );
}
