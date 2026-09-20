import { cx } from "../cx";
import styles from "./feedback.module.css";

export interface SpinnerProps {
  size?: 12 | 16 | 20 | 40;
  /** accent(기본) | current(부모 글자색, 채운 배경 위) */
  tone?: "accent" | "current";
  /** 있으면 스크린리더가 읽는다. 없으면 장식 */
  label?: string;
  className?: string;
}

/** components.md 6.7. 선 2px, 800ms 회전. 움직임 줄이기면 멈춘다. */
export function Spinner({ size = 16, tone = "accent", label, className }: SpinnerProps) {
  return (
    <span
      className={cx(styles.spinner, tone === "current" && styles.spinnerCurrent, className)}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
