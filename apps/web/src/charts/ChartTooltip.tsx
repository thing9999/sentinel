"use client";

import type { ReactNode } from "react";

import { cx, StatusIcon, type Status } from "@/components/ui";

import styles from "./charts.module.css";

export interface ChartTooltipRow {
  label: string;
  /** 토큰 CSS 변수 문자열 */
  color: string;
  value: string;
  status?: Status;
  dashed?: boolean;
}

export interface ChartTooltipProps {
  time: string;
  rows: ChartTooltipRow[];
  /** 머리글 아래 배지 (`추정`/`확정`/`AWS 예측`) */
  badge?: ReactNode;
  /** 앵커 좌표 (차트 루트 기준 px) */
  x: number;
  y: number;
  /** 차트 폭 (플롯 경계에서 반대편으로 뒤집기) */
  width: number;
  /** 추가 머리글 문구 (`미확정 · 값이 늘어날 수 있음`) */
  note?: string;
}

const OFFSET = 12;
const MAX_ROWS = 10;

/** status.md 4.5 ChartTooltip. 값 큰 순은 호출 측이 정렬해서 넘긴다. */
export function ChartTooltip({ time, rows, badge, x, y, width, note }: ChartTooltipProps) {
  const flip = x > width / 2;
  const style = flip ? { right: width - x + OFFSET, top: Math.max(0, y) } : { left: x + OFFSET, top: Math.max(0, y) };
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className={styles.tooltip} style={style} role="presentation">
      <p className={styles.tooltipTime}>{time}</p>
      {note ? <p className={styles.tooltipTime}>{note}</p> : null}
      {badge ? <div className={styles.tooltipBadge}>{badge}</div> : null}
      <ul className={styles.tooltipRows}>
        {shown.map((r) => (
          <li key={r.label} className={styles.tooltipRow}>
            <span
              className={cx(styles.tooltipSwatch, r.dashed && styles.tooltipSwatchDashed)}
              style={{ ["--swatch" as string]: r.color }}
            />
            <span className={styles.tooltipName}>{r.label}</span>
            <span className={styles.tooltipValue}>
              {r.value}
              {r.status === "warn" || r.status === "crit" ? <StatusIcon status={r.status} size={12} /> : null}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > MAX_ROWS ? <p className={styles.tooltipMore}>외 {rows.length - MAX_ROWS}개</p> : null}
    </div>
  );
}
