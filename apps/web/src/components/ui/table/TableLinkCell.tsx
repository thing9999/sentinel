import Link from "next/link";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { cx } from "../cx";
import styles from "./table.module.css";

export interface TableLinkCellProps {
  /** 이동할 주소 (예: 상세 `?view=drift`) */
  href: string;
  /** 셀 내용 (예: `<TwoLineCell … />`) */
  children: ReactNode;
  /** 보이는 내용과 다른 접근 이름이 필요할 때 */
  "aria-label"?: string;
  /** 링크를 눌러도 행 클릭(onRowClick)으로 번지지 않게 막는다. 기본 true */
  stopRowClick?: boolean;
  className?: string;
}

/**
 * 표 셀 전체를 덮는 링크 (k8s-snapshot 디자인 3.4 드리프트 셀).
 * 셀 패딩까지 클릭 영역, hover 시 bg.hover 위에 밑줄 없는 링크 모양, 포커스 링은 셀 안쪽.
 * 행 클릭과 겹치지 않도록 클릭·Enter 를 행으로 전파하지 않는다.
 */
export function TableLinkCell({ href, children, stopRowClick = true, className, ...rest }: TableLinkCellProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (stopRowClick) e.stopPropagation();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (stopRowClick && e.key === "Enter") e.stopPropagation();
  };
  return (
    <Link href={href} className={cx(styles.cellLink, className)} onClick={onClick} onKeyDown={onKeyDown} aria-label={rest["aria-label"]}>
      {children}
    </Link>
  );
}
