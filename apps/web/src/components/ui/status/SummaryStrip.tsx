"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { formatTime } from "../format";
import { STATUS_LABEL, type IsoTime, type Status, type StatusAltLabel } from "../types";
import { ReasonText } from "./ReasonText";
import { StatusBadge } from "./StatusBadge";
import { StatusIcon } from "./StatusIcon";
import styles from "./status.module.css";

export interface SummaryStripProps {
  /**
   * label: 왼쪽 배지 문구 대체(status.md 1.2 허용 문구, 예 스냅샷 crit `커밋 금지`). aria-live 문구도 이 값을 쓴다.
   * 호출 측이 해당 상태일 때만 넘긴다.
   */
  overall: { status: Status; reason: string[]; label?: StatusAltLabel };
  /** 클러스터 이름·버전·리전 */
  meta?: ReactNode;
  updatedAt?: IsoTime | null;
  /** 마지막 갱신이 stale 이면 valueText 색 */
  updatedStale?: boolean;
  /** 시각 라벨, 기본 `마지막 갱신` (스냅샷은 `마지막 확인`) */
  updatedLabel?: string;
  /** 시각 오른쪽 8px (예: 새로고침 IconButton md) */
  actions?: ReactNode;
  /** 시각 오른쪽 추가 내용 (예: updatedStale 일 때 StaleNotice) */
  updatedExtra?: ReactNode;
  /** SummaryStripItem 들 */
  children?: ReactNode;
  state?: "ready" | "loading";
  /** 제목(스크린리더) 기본 `클러스터 요약` */
  label?: string;
  highlight?: boolean;
  className?: string;
}

/**
 * components.md 2.5 / cluster-status.md 2.2. 높이 88px, 왼쪽 블록 320px.
 * 전체 상태가 바뀔 때만 aria-live=polite 로 `전체 상태 장애: <이유>` 를 읽는다(이유만 바뀌면 읽지 않음).
 */
export function SummaryStrip({
  overall,
  meta,
  updatedAt,
  updatedStale = false,
  updatedLabel = "마지막 갱신",
  actions,
  updatedExtra,
  children,
  state = "ready",
  label = "클러스터 요약",
  highlight,
  className,
}: SummaryStripProps) {
  const [prevStatus, setPrevStatus] = useState<Status | null>(state === "ready" ? overall.status : null);
  const [announcement, setAnnouncement] = useState("");
  if (state === "ready" && overall.status !== prevStatus) {
    setPrevStatus(overall.status);
    // 최초 표시 때는 읽지 않고, 바뀔 때만 읽는다
    if (prevStatus !== null) {
      setAnnouncement(
        `전체 상태 ${overall.label ?? STATUS_LABEL[overall.status]}${overall.reason[0] ? `: ${overall.reason[0]}` : ""}`,
      );
    }
  }

  if (state === "loading") {
    return (
      <section aria-label={label} aria-busy="true" className={cx(styles.strip, className)}>
        <div className={styles.stripOverall}>
          <Skeleton width={160} height={32} radius="md" />
          <Skeleton width="70%" height={12} />
        </div>
        <div className={styles.stripItems}>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className={styles.stripItem}>
              <Skeleton width={56} height={12} />
              <Skeleton width={72} height={20} />
            </div>
          ))}
        </div>
        <div className={styles.stripUpdated}>
          <Skeleton width={96} height={12} />
        </div>
      </section>
    );
  }

  return (
    <section aria-label={label} className={cx(styles.strip, className)}>
      <div className={styles.stripOverall}>
        <div className={styles.stripOverallRow}>
          <StatusBadge
            status={overall.status}
            size="lg"
            variant={overall.status === "ok" ? "subtle" : "solid"}
            label={overall.label}
            highlight={highlight}
          />
          <ReasonText reasons={overall.reason} status={overall.status} />
        </div>
        {meta ? <div className={styles.stripMeta}>{meta}</div> : null}
      </div>
      <div className={styles.stripItems}>{children}</div>
      <div className={cx(styles.stripUpdated, Boolean(actions || updatedExtra) && styles.stripUpdatedWide)}>
        <span className={styles.stripLabel}>{updatedLabel}</span>
        {actions || updatedExtra ? (
          <span className={styles.stripUpdatedRow}>
            <span className={cx(styles.stripUpdatedValue, updatedStale && styles.staleValue)} suppressHydrationWarning>
              {updatedAt ? formatTime(updatedAt, "time") : "—"}
            </span>
            {updatedExtra}
            {actions ? <span className={styles.stripActions}>{actions}</span> : null}
          </span>
        ) : (
          <span className={cx(styles.stripUpdatedValue, updatedStale && styles.staleValue)} suppressHydrationWarning>
            {updatedAt ? formatTime(updatedAt, "time") : "—"}
          </span>
        )}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}

export interface SummaryStripItemProps {
  label: string;
  value: ReactNode;
  /** 값 앞 16px 아이콘 */
  status?: Status;
  href?: string;
  className?: string;
}

/** SummaryStrip 안 칸. href 가 있으면 칸 전체가 링크. */
export function SummaryStripItem({ label, value, status, href, className }: SummaryStripItemProps) {
  const inner = (
    <>
      <span className={styles.stripLabel}>{label}</span>
      <span className={styles.stripValue}>
        {status ? <StatusIcon status={status} size={16} title={STATUS_LABEL[status]} /> : null}
        {value}
      </span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cx(styles.stripItem, styles.stripItemLink, className)}>
        {inner}
      </Link>
    );
  }
  return <div className={cx(styles.stripItem, className)}>{inner}</div>;
}
