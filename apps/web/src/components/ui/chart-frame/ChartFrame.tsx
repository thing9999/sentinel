"use client";

import { useId, type ReactNode } from "react";

import { cx } from "../cx";
import { UnknownState } from "../feedback/EmptyState";
import { Skeleton } from "../feedback/Skeleton";
import type { TimeFormat } from "../format";
import { Card } from "../layout/Card";
import { Chip, StaleNotice } from "../status/Chip";
import type { IsoTime } from "../types";
import { ChartLegend, type ChartLegendItem } from "./ChartLegend";
import styles from "./chart-frame.module.css";

export type ChartHeight = "sparkline" | "sm" | "md" | "lg" | "xl";

export interface ChartFrameProps {
  /** 카드 제목 (h3) */
  title: string;
  /** 제목 옆 (StatusBadge, CostKindBadge) */
  badges?: ReactNode;
  /** 제목 아래 보조 (ReasonText 등) */
  subtitle?: ReactNode;
  /** 머리 오른쪽 (기간 SegmentedControl 등) */
  actions?: ReactNode;
  /** 범례 (시리즈 1개면 생략: 카드 제목이 대신) */
  legend?: ChartLegendItem[];
  /** 플롯 높이 토큰: sm 160 / md 240 / lg 280 / xl 320 */
  height?: ChartHeight;
  state?: "ready" | "loading" | "empty" | "unknown" | "stale";
  unknownReason?: string;
  unknownHint?: ReactNode;
  /** state=stale 이면 플롯 오른쪽 위 칩 */
  staleAt?: IsoTime;
  staleFormat?: TimeFormat;
  /** 관측 N분 칩 (플롯 왼쪽 위) */
  observedMinutes?: number;
  /** 추가 플롯 칩 (예: `기준 수집 중`) — 오른쪽 위 */
  plotChips?: ReactNode;
  /** 표 없음 문구, 기본 `표시할 데이터가 없습니다` */
  emptyText?: string;
  /** `표로 보기` 토글 (프론트가 표 대체 보기를 제공할 때) */
  tableView?: { pressed: boolean; onToggle: () => void };
  /** 차트 본체 (프론트 charts/). role="img" + aria-label 은 차트 쪽에서 준다 */
  children?: ReactNode;
  /** 카드 테두리 종류 (비용 추정 차트: estimate) */
  kind?: "default" | "estimate";
  /** 카드 없이 플롯 영역만 */
  bare?: boolean;
  className?: string;
}

/**
 * 차트를 감싸는 카드·범례 틀 (components.md 9절 공통 props 중 표시 부분).
 * 차트 그리기는 프론트(charts/) 담당. 로딩(스켈레톤), 빈 데이터, 알 수 없음(status.md 4.8), stale 칩, 관측 칩을 그린다.
 */
export function ChartFrame({
  title,
  badges,
  subtitle,
  actions,
  legend,
  height = "md",
  state = "ready",
  unknownReason,
  unknownHint,
  staleAt,
  staleFormat = "time",
  observedMinutes,
  plotChips,
  emptyText = "표시할 데이터가 없습니다",
  tableView,
  children,
  kind = "default",
  bare = false,
  className,
}: ChartFrameProps) {
  const headingId = useId();
  const showLegend = legend && legend.length > 1;

  const plot = (
    <div
      className={cx(styles.plot, styles[`h-${height}`])}
      aria-busy={state === "loading" || undefined}
    >
      {state === "loading" ? (
        <Skeleton width="100%" height="100%" radius="md" />
      ) : state === "unknown" ? (
        <UnknownState reason={unknownReason} hint={unknownHint} size="chart" />
      ) : (
        <>
          {children}
          {state === "empty" ? <p className={styles.emptyText}>{emptyText}</p> : null}
        </>
      )}
      {state !== "loading" && state !== "unknown" && observedMinutes !== undefined ? (
        <span className={styles.chipLeft}>
          <Chip label={`관측 ${observedMinutes}분`} icon="timer" />
        </span>
      ) : null}
      {state !== "loading" && state !== "unknown" && ((state === "stale" && staleAt) || plotChips) ? (
        <span className={styles.chipRight}>
          {plotChips}
          {state === "stale" && staleAt ? <StaleNotice staleAt={staleAt} format={staleFormat} /> : null}
        </span>
      ) : null}
    </div>
  );

  if (bare) return <div className={cx(styles.bare, className)}>{plot}</div>;

  return (
    <Card as="section" aria-labelledby={headingId} kind={kind} className={cx(styles.frame, className)}>
      <div className={styles.head}>
        <div className={styles.titleBlock}>
          <div className={styles.titleRow}>
            <h3 id={headingId} className={styles.title}>
              {title}
            </h3>
            {badges ? <span className={styles.badges}>{badges}</span> : null}
          </div>
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
        </div>
        <div className={styles.headRight}>
          {actions}
          {tableView ? (
            <button
              type="button"
              className={styles.tableToggle}
              aria-pressed={tableView.pressed}
              onClick={tableView.onToggle}
            >
              {tableView.pressed ? "차트로 보기" : "표로 보기"}
            </button>
          ) : null}
        </div>
      </div>
      {showLegend ? <ChartLegend items={legend} className={styles.legend} /> : null}
      {plot}
    </Card>
  );
}
