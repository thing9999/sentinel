import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { StaleNotice } from "../status/Chip";
import type { TimeFormat } from "../format";
import type { CostKind, IsoTime, Status } from "../types";
import styles from "./cost.module.css";

export interface MetricTileProps {
  /** caption-strong text.secondary */
  label: string;
  /** 보통 MoneyValue size="xl" 또는 숫자(metricLg) */
  value: ReactNode;
  /** estimate/llmEstimate: dashed estimate.border, forecast: solid forecast.border, confirmed/plain: border.subtle */
  kind?: CostKind | "plain";
  /** 오른쪽 위 (CostKindBadge 또는 StatusBadge) */
  badge?: ReactNode;
  /** 보조 줄(caption), 최대 3줄 */
  lines?: ReactNode[];
  /** 왼쪽 3px 막대 (warn/crit 만) */
  status?: Status;
  /** 경고 칩 등 */
  footer?: ReactNode;
  state?: "ready" | "loading" | "unknown" | "hidden";
  /** `알 수 없음 (Cost Explorer 사용 불가: AccessDenied)` 의 괄호 안 */
  unknownReason?: string;
  /** stale: 테두리 색 stale.border + `데이터 오래됨 · HH:mm 기준` 칩, 값 회색 */
  staleAt?: IsoTime;
  staleFormat?: TimeFormat;
  /** 타일 전체 링크 */
  href?: string;
  className?: string;
}

/**
 * components.md 3.3 KPI 타일(세 기능 공용). 높이 136px(보조 줄이 많으면 늘어남), 패딩 16px, radius 8px.
 */
export function MetricTile({
  label,
  value,
  kind = "plain",
  badge,
  lines,
  status,
  footer,
  state = "ready",
  unknownReason,
  staleAt,
  staleFormat = "shortTime",
  href,
  className,
}: MetricTileProps) {
  if (state === "hidden") return null;
  const stale = Boolean(staleAt) && state === "ready";
  const cls = cx(
    styles.tile,
    styles[`tile-${kind}`],
    (status === "warn" || status === "crit") && styles[`tileBar-${status}`],
    stale && styles.tileStale,
    href && styles.tileInteractive,
    className,
  );

  const body =
    state === "loading" ? (
      <>
        <div className={styles.tileHead}>
          <span className={styles.tileLabel}>{label}</span>
        </div>
        <span className="sr-only">불러오는 중</span>
        <Skeleton width={160} height={28} />
        <Skeleton lines={2} />
      </>
    ) : (
      <>
        <div className={styles.tileHead}>
          {href ? (
            <Link href={href} className={cx(styles.tileLabel, styles.tileLink)}>
              {label}
            </Link>
          ) : (
            <span className={styles.tileLabel}>{label}</span>
          )}
          <span className={styles.tileBadges}>
            {stale && staleAt ? <StaleNotice staleAt={staleAt} format={staleFormat} /> : null}
            {badge}
          </span>
        </div>
        <div className={styles.tileValue}>
          {state === "unknown" ? (
            <>
              <span className={styles.tileUnknownValue} aria-hidden="true">
                —
              </span>
              <span className={styles.tileUnknownReason}>
                알 수 없음{unknownReason ? ` (${unknownReason})` : ""}
              </span>
            </>
          ) : (
            value
          )}
        </div>
        {lines && lines.length > 0 && state !== "unknown" ? (
          <div className={styles.tileLines}>
            {lines.slice(0, 3).map((l, i) => (
              <div key={i} className={styles.tileLine}>
                {l}
              </div>
            ))}
          </div>
        ) : null}
        {footer ? <div className={styles.tileFooter}>{footer}</div> : null}
      </>
    );

  return (
    <div className={cls} aria-busy={state === "loading" || undefined}>
      {body}
    </div>
  );
}
