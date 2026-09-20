import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { InlineAlert } from "../feedback/Banner";
import { Skeleton } from "../feedback/Skeleton";
import { formatCount } from "../format";
import { Icon, type IconName } from "../icons";
import { STATUS_LABEL, type IsoTime, type Status } from "../types";
import { Chip } from "./Chip";
import { ReasonText } from "./ReasonText";
import { StatusBadge } from "./StatusBadge";
import { StatusIcon } from "./StatusIcon";
import styles from "./status.module.css";

export interface StatusCardItem {
  label: string;
  href: string;
  status: Status;
  /** 사유 (서버 문자열) */
  detail?: string;
  /** 리소스 이름이면 true → mono */
  mono?: boolean;
}

export interface StatusCardProps {
  /** h3 */
  title: string;
  /** 20px */
  icon: IconName;
  status: Status;
  /** 대표 수치 (metricMd) 예 `Ready 5/6` */
  primary: ReactNode;
  /** `장애 2 · 주의 3 · 정상 51` */
  counts?: { status: Status; count: number }[];
  /** ReasonText (items 가 없을 때 2줄) */
  reason?: string[];
  /** 문제 항목 최대 3개 */
  items?: StatusCardItem[];
  /** 카드 전체 링크 (하단 `목록 보기 →` 가 카드 전체를 덮는다) */
  href?: string;
  /** 기본 `목록 보기` */
  footerLabel?: string;
  /** 있으면 stale 모습 (dashed 테두리, 배지 교체, 값 회색) */
  staleAt?: IsoTime;
  /** 하위 항목 중 stale 수 → `오래됨 N` 칩 */
  staleCount?: number;
  state?: "ready" | "loading" | "error";
  errorMessage?: string;
  /** 상태 악화 강조 */
  highlight?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * components.md 2.4 / cluster-status.md 2.3. 최소 높이 176px (counts 가 접히면 늘어남, 같은 행 카드는 같은 높이).
 * crit: 2px status.crit.border + 왼쪽 3px crit.solid + solid 배지. warn: 왼쪽 3px warn.solid.
 * 정상은 조용하게(문제 항목 자리를 비움).
 */
export function StatusCard({
  title,
  icon,
  status,
  primary,
  counts,
  reason,
  items,
  href,
  footerLabel = "목록 보기",
  staleAt,
  staleCount,
  state = "ready",
  errorMessage,
  highlight,
  headingLevel = 3,
  className,
}: StatusCardProps) {
  const H = `h${headingLevel}` as const;
  const stale = Boolean(staleAt) && state === "ready";

  if (state === "loading") {
    return (
      <div className={cx(styles.card, className)} aria-busy="true">
        <div className={styles.cardHead}>
          <Icon name={icon} size={20} className={styles.cardIcon} />
          <H className={styles.cardTitle}>{title}</H>
        </div>
        <span className="sr-only">불러오는 중</span>
        <div className={styles.cardSkeleton}>
          <Skeleton width="50%" height={20} />
          <Skeleton lines={3} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cx(
        styles.card,
        !stale && status === "crit" && styles.cardCrit,
        !stale && status === "warn" && styles.cardWarn,
        stale && styles.cardStale,
        href && styles.cardInteractive,
        className,
      )}
    >
      <div className={styles.cardHead}>
        <Icon name={icon} size={20} className={styles.cardIcon} />
        <H className={styles.cardTitle}>{title}</H>
        <span className={styles.cardBadges}>
          {staleCount ? <Chip label={`오래됨 ${staleCount}`} tone="stale" icon="clock-alert" /> : null}
          {state === "error" ? null : stale ? (
            <StatusBadge status="stale" staleAt={staleAt} previousStatus={status} highlight={highlight} />
          ) : (
            <StatusBadge status={status} variant={status === "crit" ? "solid" : "subtle"} highlight={highlight} />
          )}
        </span>
      </div>

      {state === "error" ? (
        <InlineAlert tone="neutral" icon="circle-help" title={errorMessage ?? "불러오지 못했습니다"} compact />
      ) : (
        <>
          <div className={styles.cardPrimaryRow}>
            <span className={cx(styles.cardPrimary, stale && styles.staleValue)}>{primary}</span>
            {counts && counts.length > 0 ? (
              <span className={styles.counts}>
                {counts.map((c, i) => (
                  <span key={c.status} className={cx(styles.countItem, c.count === 0 && styles.countZero)}>
                    {i > 0 ? <span aria-hidden="true"> · </span> : null}
                    <StatusIcon status={c.status} size={12} />
                    <span>
                      {STATUS_LABEL[c.status]} {formatCount(c.count)}
                    </span>
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          {items && items.length > 0 ? (
            <ul className={styles.cardItems}>
              {items.slice(0, 3).map((it) => (
                <li key={it.href + it.label} className={styles.cardItem}>
                  <StatusIcon status={it.status} size={12} title={STATUS_LABEL[it.status]} />
                  <Link href={it.href} className={cx(styles.cardItemLink, it.mono && "mono")}>
                    {it.label}
                  </Link>
                  {it.detail ? <span className={styles.cardItemDetail}>{it.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : reason && reason.length > 0 ? (
            <div className={styles.cardReason}>
              <ReasonText reasons={reason} status={status} lines={2} />
            </div>
          ) : null}
        </>
      )}

      {href ? (
        <Link href={href} className={styles.cardFooterLink}>
          {footerLabel}
          <span className="sr-only">: {title}</span>
          <span aria-hidden="true"> →</span>
        </Link>
      ) : null}
    </div>
  );
}
