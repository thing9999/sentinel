"use client";

import { useState } from "react";

import { cx } from "../cx";
import {
  formatDurationTable,
  formatDurationTimer,
  formatFullTime,
  formatRelative,
  formatTime,
  type TimeFormat,
} from "../format";
import { useNow } from "../hooks";
import { Tooltip } from "../overlay/Tooltip";
import type { IsoTime } from "../types";
import styles from "./layout.module.css";

export interface TimestampProps {
  value: IsoTime;
  /** time HH:mm:ss | shortTime HH:mm | auto(status.md 6절) | autoShort */
  format?: TimeFormat;
  /** 보조 `3분 전` 병기 (30초마다 갱신) */
  relative?: boolean;
  /** 상대 시각만 표시(절대 시각은 툴팁) — 보조 문구 자리에서만 */
  relativeOnly?: boolean;
  className?: string;
}

/** components.md 8.4. <time> + 툴팁 전체 시각 `2026-09-19 14:02:10 (KST)`, tabular. */
export function Timestamp({ value, format = "auto", relative = false, relativeOnly = false, className }: TimestampProps) {
  const now = useNow(relative || relativeOnly ? 30_000 : 0);
  const abs = formatTime(value, format, now);
  const rel = relative || relativeOnly ? formatRelative(value, now) : null;
  return (
    <Tooltip content={formatFullTime(value)} className={className}>
      <time dateTime={value} className={styles.time} suppressHydrationWarning>
        {relativeOnly ? rel : abs}
        {relative && !relativeOnly ? <span className={styles.timeRel}> · {rel}</span> : null}
      </time>
    </Tooltip>
  );
}

export interface DurationProps {
  ms: number;
  /** table `4분 12초` | timer `4:12` */
  style?: "table" | "timer";
  className?: string;
}

/** components.md 8.5 Duration */
export function Duration({ ms, style = "table", className }: DurationProps) {
  return (
    <span className={cx(styles.time, className)}>{style === "timer" ? formatDurationTimer(ms) : formatDurationTable(ms)}</span>
  );
}

export interface ElapsedTimerProps {
  startedAt: IsoTime;
  /** 서버 기준 현재 시각(시계 차이 보정) */
  serverNow?: IsoTime;
  /** 기본 1000 */
  tickMs?: number;
  /** false 면 멈춤 */
  running?: boolean;
  /** 앞 문구 (예: `경과`) */
  label?: string;
  className?: string;
}

/** components.md 8.5 ElapsedTimer. metricSm 16/24 tabular, role=timer(스크린리더 자동 알림 없음). */
export function ElapsedTimer({ startedAt, serverNow, tickMs = 1000, running = true, label, className }: ElapsedTimerProps) {
  const [skew] = useState(() => (serverNow ? Date.parse(serverNow) - Date.now() : 0));
  const now = useNow(running ? tickMs : 0);
  const elapsed = now + skew - Date.parse(startedAt);
  return (
    <span className={cx(styles.timer, className)} role="timer" suppressHydrationWarning>
      {label ? <span className={styles.timerLabel}>{label} </span> : null}
      {formatDurationTimer(Number.isNaN(elapsed) ? 0 : elapsed)}
    </span>
  );
}
