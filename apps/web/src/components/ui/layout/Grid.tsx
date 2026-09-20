import type { CSSProperties, ReactNode } from "react";

import { cx } from "../cx";
import styles from "./layout.module.css";

type Cols = 1 | 2 | 3 | 4 | 5 | 6 | 12;

export interface GridProps {
  /** ≥1280px 열 수, 기본 12 (cluster-status 카드 5개는 5) */
  columns?: Cols;
  /** 1024~1279px 열 수 (기본 columns) */
  columnsMd?: Cols;
  /** 768~1023px 열 수 (기본 2, columns 가 12 면 12) */
  columnsSm?: Cols;
  /** 767px 이하 열 수 (기본 1) */
  columnsXs?: Cols;
  as?: "div" | "ul" | "section";
  children: ReactNode;
  className?: string;
}

/**
 * 12열 그리드(gutter 16px). 페이지 정적 레이아웃용.
 * 12열 모드에서는 GridItem 의 span 으로 폭을 정하고, 767px 이하에서는 모든 칸이 전체 폭이 된다.
 */
export function Grid({ columns = 12, columnsMd, columnsSm, columnsXs = 1, as = "div", children, className }: GridProps) {
  const Tag = as;
  const style = {
    "--cols": columns,
    "--cols-md": columnsMd ?? columns,
    "--cols-sm": columnsSm ?? (columns === 12 ? 12 : Math.min(columns, 2)),
    "--cols-xs": columnsXs,
  } as CSSProperties;
  return (
    <Tag className={cx(styles.grid, className)} style={style}>
      {children}
    </Tag>
  );
}

type Span = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface GridItemProps {
  /** ≥1280px, 기본 12 */
  span?: Span;
  /** 1024~1279px (기본 span) */
  spanMd?: Span;
  /** 768~1023px (기본 12) */
  spanSm?: Span;
  as?: "div" | "li" | "section";
  children: ReactNode;
  className?: string;
}

export function GridItem({ span = 12, spanMd, spanSm = 12, as = "div", children, className }: GridItemProps) {
  const Tag = as;
  const style = {
    "--span": span,
    "--span-md": spanMd ?? span,
    "--span-sm": spanSm,
  } as CSSProperties;
  return (
    <Tag className={cx(styles.gridItem, className)} style={style}>
      {children}
    </Tag>
  );
}
