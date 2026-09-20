import { Fragment } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import { SCAN_LEVEL } from "./scan";
import styles from "./snapshot.module.css";

export interface ScanCountsProps {
  errors: number | null;
  warnings: number | null;
  /** sm: 아이콘 12px + caption(오류는 captionStrong) / md: 아이콘 16px + metricSm 16/24 */
  size?: "sm" | "md";
  /** inline: `오류 2 · 경고 1` / stacked: 오류 줄 위, 경고 줄 아래(표 2줄 셀) */
  layout?: "inline" | "stacked";
  /** unknown: `스캔할 수 없음` / stale: 숫자 status.stale.valueText. 두 값이 모두 null 이어도 unknown */
  state?: "ready" | "unknown" | "stale";
  /** unknown 문구, 기본 `스캔할 수 없음` (예: `스캔할 수 없음 (파일을 읽을 수 없음)`) */
  unknownText?: string;
  /** 스크린리더 앞말, 기본 `현재 스캔` → `현재 스캔 오류 2건, 경고 1건` */
  srPrefix?: string;
  className?: string;
}

/**
 * components.md 11.3 / status.md 9.2. 0인 등급은 그리지 않고, 둘 다 0이면 `발견 없음`(`통과`라는 말은 쓰지 않는다).
 * 시각 요소는 aria-hidden, 스크린리더는 한 문장으로 읽는다.
 */
export function ScanCounts({
  errors,
  warnings,
  size = "sm",
  layout = "inline",
  state = "ready",
  unknownText = "스캔할 수 없음",
  srPrefix = "현재 스캔",
  className,
}: ScanCountsProps) {
  const iconSize = size === "md" ? 16 : 12;
  const rootClass = cx(
    styles.counts,
    styles[`counts-${size}`],
    layout === "stacked" && styles.countsStacked,
    state === "stale" && styles.countsStale,
    className,
  );
  const prefix = srPrefix ? `${srPrefix} ` : "";

  if (state === "unknown" || (errors === null && warnings === null)) {
    return (
      <span className={rootClass} data-state="unknown">
        <span className={cx(styles.countsPart, styles.countsNone)}>
          <Icon name="circle-help" size={iconSize} className={styles.fgUnknown} />
          <span className={styles.countsMuted}>{unknownText}</span>
        </span>
      </span>
    );
  }

  const e = errors ?? 0;
  const w = warnings ?? 0;
  if (e <= 0 && w <= 0) {
    return (
      <span className={rootClass} data-state="none">
        <span className="sr-only">{prefix}</span>
        <span className={cx(styles.countsPart, styles.countsNone)}>
          <Icon name="circle-check" size={iconSize} className={styles.fgOk} />
          <span className={styles.countsSecondary}>발견 없음</span>
        </span>
      </span>
    );
  }

  const parts = [
    e > 0 ? { spec: SCAN_LEVEL.error, n: e, cls: styles.fgCrit } : null,
    w > 0 ? { spec: SCAN_LEVEL.warn, n: w, cls: styles.fgWarn } : null,
  ].filter((p): p is NonNullable<typeof p> => p !== null);
  const sr = `${prefix}${parts.map((p) => `${p.spec.label} ${p.n.toLocaleString("en-US")}건`).join(", ")}`;

  return (
    <span className={rootClass} data-state={state}>
      <span className="sr-only">{sr}</span>
      {parts.map((p, i) => (
        <Fragment key={p.spec.key}>
          {i > 0 && layout === "inline" ? (
            <span className={styles.countsSep} aria-hidden="true">
              ·
            </span>
          ) : null}
          <span
            className={cx(styles.countsPart, p.cls, p.spec.key === "error" && styles.countsStrong)}
            aria-hidden="true"
          >
            <Icon name={p.spec.icon} size={iconSize} />
            <span>
              {p.spec.label} <span className={styles.countsNum}>{p.n.toLocaleString("en-US")}</span>
            </span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}
