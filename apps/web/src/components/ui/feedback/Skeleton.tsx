import { cx } from "../cx";
import styles from "./feedback.module.css";

export interface SkeletonProps {
  /** px 숫자 또는 CSS 길이(`60%`). 기본 100% */
  width?: number | string;
  /** px 숫자 또는 CSS 길이. 기본 12px */
  height?: number | string;
  /** 기본 sm(4px) */
  radius?: "xs" | "sm" | "md" | "lg";
  /** 여러 줄 (마지막 줄은 60% 폭) */
  lines?: number;
  className?: string;
}

const len = (v: number | string | undefined, fallback: string) =>
  v === undefined ? fallback : typeof v === "number" ? `${v}px` : v;

/**
 * components.md 6.6. 배경 skeleton.base + shimmer 1500ms, 150ms 뒤에 나타난다(깜박임 방지).
 * 로딩 중임을 알리는 문구는 호출 측 영역에 aria-busy 로 준다(스켈레톤 자체는 aria-hidden).
 */
export function Skeleton({ width, height, radius = "sm", lines, className }: SkeletonProps) {
  const style = {
    width: len(width, "100%"),
    height: len(height, "var(--spacing-3)"),
    borderRadius: `var(--radius-${radius})`,
  };
  if (lines && lines > 1) {
    return (
      <span className={cx(styles.skeletonLines, className)} aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={styles.skeleton}
            style={{ ...style, width: i === lines - 1 ? "60%" : style.width }}
          />
        ))}
      </span>
    );
  }
  return <span className={cx(styles.skeleton, className)} style={style} aria-hidden="true" />;
}
