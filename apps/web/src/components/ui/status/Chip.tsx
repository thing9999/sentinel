import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { formatTime, type TimeFormat } from "../format";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import type { IsoTime, Status } from "../types";
import styles from "./status.module.css";

export type ChipTone = "neutral" | "info" | Status;

export interface ChipProps {
  label: string;
  /** 12px */
  icon?: IconName;
  tone?: ChipTone;
  /** sm 20 / md 24px */
  size?: "sm" | "md";
  /** stale·unverified 등 (tone=stale 이면 자동) */
  dashed?: boolean;
  /** 글자를 mono 로 (R-ID 등) */
  mono?: boolean;
  /** 링크 칩 */
  href?: string;
  /** 필터 칩 제거 버튼 `x` 12px */
  onRemove?: () => void;
  /**
   * hover·포커스 툴팁 (예: `보기 전용`·`strict`·`raw 데이터` 사유). 텍스트로만 렌더.
   * 링크 칩이 아니면 칩이 포커스를 받는다(키보드로도 읽힘).
   */
  tooltip?: ReactNode;
  className?: string;
}

/**
 * components.md 2.7 / status.md 1.3. 상태가 아닌 보조 라벨은 neutral(bg.surfaceSunken, text.secondary).
 * tone 에 상태를 주면 상태 색(예: `오래됨 N`, `단가 없음` warn).
 */
export function Chip({
  label,
  icon,
  tone = "neutral",
  size = "sm",
  dashed = false,
  mono = false,
  href,
  onRemove,
  tooltip,
  className,
}: ChipProps) {
  const cls = cx(
    styles.chip,
    styles[`chip-${size}`],
    styles[`chip-${tone}`],
    (dashed || tone === "stale") && styles.chipDashed,
    mono && styles.chipMono,
    href && styles.chipLink,
    className,
  );
  const inner = (
    <>
      {icon ? <Icon name={icon} size={12} className={styles.chipIcon} /> : null}
      <span className={styles.chipText}>{label}</span>
    </>
  );
  const hasTip = tooltip !== undefined && tooltip !== null && tooltip !== "";
  if (href) {
    const link = (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
    return hasTip ? <Tooltip content={tooltip}>{link}</Tooltip> : link;
  }
  const chip = (
    <span className={cls}>
      {inner}
      {onRemove ? (
        <button type="button" className={styles.chipRemove} aria-label={`${label} 제거`} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </span>
  );
  // 제거 버튼이 있으면 버튼이 포커스를 받으므로 래퍼는 포커스 가능하게 만들지 않는다
  return hasTip ? (
    <Tooltip content={tooltip} focusable={!onRemove} className={styles.chipTipAnchor}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

export interface StaleNoticeProps {
  staleAt: IsoTime;
  /** 기본 `데이터 오래됨` */
  label?: string;
  format?: TimeFormat;
  className?: string;
}

/** components.md 2.8. 차트·영역 오른쪽 위 칩 `데이터 오래됨 · 14:02:10 기준` (stale 색, 점선) */
export function StaleNotice({ staleAt, label = "데이터 오래됨", format = "time", className }: StaleNoticeProps) {
  return (
    <span className={cx(styles.chip, styles["chip-sm"], styles["chip-stale"], styles.chipDashed, className)}>
      <Icon name="clock-alert" size={12} className={styles.chipIcon} />
      <span className={styles.chipText} suppressHydrationWarning>
        {label} · {formatTime(staleAt, format)} 기준
      </span>
    </span>
  );
}
