"use client";

import { useId, useState, type ReactNode } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import styles from "./layout.module.css";

export interface SectionProps {
  /** h2 */
  title: string;
  /** 제목 옆 배지 (CostKindBadge, SourceLabel, StatusBadge…) */
  badges?: ReactNode;
  /** 제목 아래 caption (조회 시각 등) */
  meta?: ReactNode;
  /** 제목 줄 오른쪽 (조회 시각·액션) */
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  /** estimate: 왼쪽 3px dashed 세로선(cost.estimate.border) + 내용 왼쪽 16px (aws-cost.md 2.4) */
  kind?: "default" | "estimate";
  headingLevel?: 2 | 3;
  /** 앵커 이동용 id */
  id?: string;
  className?: string;
}

/** components.md 8.1. 섹션 간 32px(page-stack), 제목-내용 12px. */
export function Section({
  title,
  badges,
  meta,
  actions,
  children,
  collapsible = false,
  defaultCollapsed = false,
  kind = "default",
  headingLevel = 2,
  id,
  className,
}: SectionProps) {
  const autoId = useId();
  const headingId = `${autoId}-h`;
  const contentId = `${autoId}-c`;
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const H = `h${headingLevel}` as const;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cx(styles.section, kind === "estimate" && styles.sectionEstimate, className)}
    >
      <div className={styles.sectionHead}>
        <div className={styles.sectionTitleRow}>
          <H id={headingId} className={cx(styles.sectionTitle, headingLevel === 3 && styles.sectionTitleSm)}>
            {collapsible ? (
              <button
                type="button"
                className={styles.sectionToggle}
                aria-expanded={!collapsed}
                aria-controls={contentId}
                onClick={() => setCollapsed((c) => !c)}
              >
                <Icon name="chevron-right" size={16} className={cx(styles.chevron, !collapsed && styles.chevronOpen)} />
                {title}
              </button>
            ) : (
              title
            )}
          </H>
          {badges ? <span className={styles.sectionBadges}>{badges}</span> : null}
        </div>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
        {meta ? <div className={styles.sectionMeta}>{meta}</div> : null}
      </div>
      <div id={contentId} className={styles.sectionBody} hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
