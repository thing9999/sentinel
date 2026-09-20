import type { CSSProperties, ReactNode } from "react";

import { cx } from "../cx";
import styles from "./layout.module.css";

export interface CardProps {
  /** sm 12 | md 16 | lg 20px */
  padding?: "none" | "sm" | "md" | "lg";
  /** hover 시 border.default + shadow sm */
  interactive?: boolean;
  /** estimate: dashed cost.estimate.border / stale: dashed status.stale.border / unverified: dashed status.warn.border */
  kind?: "default" | "estimate" | "stale" | "unverified";
  /** 왼쪽 3px 막대 (warn/crit 만) */
  status?: "warn" | "crit";
  /** 편집 모드 테두리: 2px accent.default (aws-snapshot-manager.md 5.3). 색만으로 알리지 않도록 호출 측이 `편집 중` 칩을 함께 둔다 */
  editing?: boolean;
  as?: "div" | "section" | "article" | "li";
  /** section/article 일 때 제목 id */
  "aria-labelledby"?: string;
  "aria-label"?: string;
  "aria-busy"?: boolean;
  style?: CSSProperties;
  children: ReactNode;
  className?: string;
}

/** components.md 8.2 / shell.md 6절. 배경 bg.surface, 1px border.subtle, radius 8px, shadow xs. */
export function Card({
  padding = "md",
  interactive = false,
  kind = "default",
  status,
  editing = false,
  as = "div",
  children,
  className,
  ...rest
}: CardProps) {
  const Tag = as;
  return (
    <Tag
      {...rest}
      data-editing={editing ? "true" : undefined}
      className={cx(
        styles.card,
        styles[`pad-${padding}`],
        interactive && styles.cardInteractive,
        kind !== "default" && styles[`card-${kind}`],
        status && styles[`cardBar-${status}`],
        editing && styles.cardEditing,
        className,
      )}
    >
      {children}
    </Tag>
  );
}
