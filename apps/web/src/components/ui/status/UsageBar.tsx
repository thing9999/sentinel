import type { ReactNode } from "react";

import { cx } from "../cx";
import { formatPercent } from "../format";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import type { Status } from "../types";
import { Chip } from "./Chip";
import styles from "./status.module.css";

export interface UsageBarProps {
  /** 사용률 0~1 (1 초과 가능: limits 오버커밋) */
  value: number;
  /** 채움 색 status.<key>.solid (stale 이면 stale.solid) */
  status: Status;
  /** 주의 표시선 위치(0~1) */
  warnAt?: number;
  /** 장애 표시선 위치(0~1) */
  critAt?: number;
  /** requests 비율 등 보조 값(0~1): 1px 세로선 + 툴팁 */
  secondary?: number;
  /** 보조 값 툴팁 문구 (기본 `requests 62%`) */
  secondaryLabel?: string;
  /** 오른쪽 문구 `62%` 또는 `1,250m / 2,000m` */
  label?: ReactNode;
  /** sm 4px(표 안) / md 8px */
  size?: "sm" | "md";
  /** px. 기본 100% */
  width?: number;
  /** 오른쪽 `근사치` 칩 */
  approximate?: boolean;
  /** 스크린리더 이름 (예: `CPU 사용률`) */
  name?: string;
  className?: string;
}

const pct = (v: number) => `${Math.min(Math.max(v, 0), 1) * 100}%`;

/**
 * components.md 2.6. 100% 초과는 채움을 100%로 자르고 끝에 틈 + chevrons-right `초과`.
 * 스크린리더에는 role=img + 요약 문구로 읽힌다.
 */
export function UsageBar({
  value,
  status,
  warnAt,
  critAt,
  secondary,
  secondaryLabel,
  label,
  size = "md",
  width,
  approximate = false,
  name = "사용률",
  className,
}: UsageBarProps) {
  const over = value > 1;
  const summary = [
    `${name} ${formatPercent(value)}`,
    over ? "100% 초과" : null,
    warnAt !== undefined ? `주의 기준 ${formatPercent(warnAt)}` : null,
    critAt !== undefined ? `장애 기준 ${formatPercent(critAt)}` : null,
    secondary !== undefined ? (secondaryLabel ?? `requests ${formatPercent(secondary)}`) : null,
    approximate ? "근사치" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <span
      className={cx(styles.usage, styles[`usage-${size}`], className)}
      style={width ? { width: `min(${width}px, 100%)` } : undefined}
    >
      <span className={styles.usageTrackWrap} role="img" aria-label={summary}>
        <span className={styles.usageTrack}>
          <span
            className={cx(styles.usageFill, styles[`solid-${status}`], over && styles.usageFillOver)}
            style={{ width: pct(value) }}
          />
        </span>
        {warnAt !== undefined ? (
          <span className={cx(styles.usageMark, styles.usageMarkWarn)} style={{ left: pct(warnAt) }} />
        ) : null}
        {critAt !== undefined ? (
          <span className={cx(styles.usageMark, styles.usageMarkCrit)} style={{ left: pct(critAt) }} />
        ) : null}
        {secondary !== undefined ? (
          <Tooltip
            className={styles.usageSecondaryAnchor}
            content={secondaryLabel ?? `requests ${formatPercent(secondary)}`}
          >
            <span className={styles.usageSecondary} style={{ left: pct(secondary) }} />
          </Tooltip>
        ) : null}
      </span>
      {over ? (
        <span className={styles.usageOver} title="100% 초과">
          <Icon name="chevrons-right" size={12} />
        </span>
      ) : null}
      {label !== undefined ? <span className={styles.usageLabel}>{label}</span> : null}
      {approximate ? <Chip label="근사치" icon="tilde" /> : null}
    </span>
  );
}
