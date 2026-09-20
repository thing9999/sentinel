import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import { ReasonText } from "../status/ReasonText";
import { StatusBadge } from "../status/StatusBadge";
import type { IsoTime, Status, StatusAltLabel } from "../types";
import styles from "./shell.module.css";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  /** h1 */
  title: string;
  /** 상세 화면 */
  breadcrumbs?: Breadcrumb[];
  /** 제목 옆 lg 배지 + 이유 */
  status?: {
    status: Status;
    reason?: string | string[];
    staleAt?: IsoTime;
    label?: StatusAltLabel;
    previousStatus?: Status;
    highlight?: boolean;
    /** 배지 앞 스크린리더 접두어 (StatusBadge `srPrefix`, 기본 `상태: `). 예: `파일 상태: ` */
    srPrefix?: string;
  };
  /** 보조 줄 (caption text.secondary) */
  subtitle?: ReactNode;
  /** 오른쪽 페이지 액션 */
  actions?: ReactNode;
  /** 제목 아래 보조 칩 */
  chips?: ReactNode;
  /** 제목을 mono 로 (리소스 이름) */
  monoTitle?: boolean;
  /**
   * 머리 아래에 붙는 탭 줄 슬롯 (예: `<LinkTabs … />`). 있으면 머리 아래 여백이 0이 되고
   * 탭 줄이 머리의 일부가 된다 (k8s-snapshot 디자인 2.3).
   */
  tabs?: ReactNode;
  /** 머리 아래 여백 24px → 0 (탭 줄을 머리 밖에 직접 붙일 때). `tabs`가 있으면 자동 */
  flushBottom?: boolean;
  className?: string;
}

/** components.md 1.7 / shell.md 4절. 최소 48px, 아래 여백 24px (`tabs`·`flushBottom`이면 0). */
export function PageHeader({
  title,
  breadcrumbs,
  status,
  subtitle,
  actions,
  chips,
  monoTitle,
  tabs,
  flushBottom,
  className,
}: PageHeaderProps) {
  const reasons = status?.reason === undefined ? [] : Array.isArray(status.reason) ? status.reason : [status.reason];
  return (
    <header className={cx(styles.pageHeader, (Boolean(tabs) || flushBottom) && styles.pageHeaderFlush, className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="현재 위치" className={styles.breadcrumbs}>
          <ol>
            {breadcrumbs.map((b, i) => (
              <li key={`${b.label}-${i}`}>
                {i > 0 ? <Icon name="chevron-right" size={12} className={styles.crumbSep} /> : null}
                {b.href ? <Link href={b.href}>{b.label}</Link> : <span aria-current="page">{b.label}</span>}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageHeaderMain}>
          <div className={styles.pageTitleRow}>
            <h1 className={cx(styles.pageTitle, monoTitle && styles.pageTitleMono)}>{title}</h1>
            {status ? (
              <span className={styles.pageStatus}>
                <StatusBadge
                  status={status.staleAt ? "stale" : status.status}
                  staleAt={status.staleAt}
                  previousStatus={status.staleAt ? status.status : status.previousStatus}
                  label={status.staleAt ? undefined : status.label}
                  size="lg"
                  highlight={status.highlight}
                  srPrefix={status.srPrefix}
                />
                <ReasonText reasons={reasons} status={status.status} />
              </span>
            ) : null}
          </div>
          {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
          {chips ? <div className={styles.pageChips}>{chips}</div> : null}
        </div>
        {actions ? <div className={styles.pageActions}>{actions}</div> : null}
      </div>
      {tabs ? <div className={styles.pageTabs}>{tabs}</div> : null}
    </header>
  );
}
