import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { formatTime, type TimeFormat } from "../format";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import type { IsoTime, Status } from "../types";
import styles from "./status.module.css";

/**
 * `mock` = 상단바 MOCK 배지와 같은 색(`mode.mock*`). 새 토큰이 아니다 (components.md 21.2).
 * "이건 mock이다"를 화면마다 같은 색으로 말하기 위한 tone 이다.
 */
export type ChipTone = "neutral" | "info" | "mock" | Status;

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
   * 제거 버튼의 접근 이름(기본 `<label> 제거`). 칩 문구가 값이라 "제거"가 어색할 때 준다 —
   * 예: 로그 `그 시각 14:02:05` 칩의 `x` = `그 시각 표시 해제`(logs.md 7.6 ②)
   */
  removeLabel?: string;
  /**
   * 있으면 `<button>` 으로 렌더한다 (components.md 21.2).
   * 로그의 `가림 N` 표식·알림 요약 줄의 심각도 칩처럼 **눌러서 여는** 칩만 쓴다.
   * 없으면 종전대로 `<span>`(누를 수 없는 라벨).
   */
  onClick?: () => void;
  /** 버튼 칩의 접근 이름 (없으면 `label`). 예 `가려진 값 2개, 규칙 보기` */
  ariaLabel?: string;
  /** 버튼 칩의 눌림 상태 (요약 줄 필터 칩) */
  pressed?: boolean;
  /**
   * hover·포커스 툴팁 (예: `보기 전용`·`strict`·`raw 데이터` 사유). 텍스트로만 렌더.
   * 링크 칩이 아니면 칩이 포커스를 받는다(키보드로도 읽힘).
   */
  tooltip?: ReactNode;
  /** `tooltip` 의 문자열 별칭 (components.md 21.2 `title`). 둘 다 오면 `tooltip` 이 이긴다 */
  title?: string;
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
  removeLabel,
  onClick,
  ariaLabel,
  pressed,
  tooltip,
  title,
  className,
}: ChipProps) {
  const cls = cx(
    styles.chip,
    styles[`chip-${size}`],
    styles[`chip-${tone}`],
    (dashed || tone === "stale") && styles.chipDashed,
    mono && styles.chipMono,
    href && styles.chipLink,
    onClick && styles.chipButton,
    className,
  );
  const inner = (
    <>
      {icon ? <Icon name={icon} size={12} className={styles.chipIcon} /> : null}
      <span className={styles.chipText}>{label}</span>
    </>
  );
  const tip = tooltip ?? title;
  const hasTip = tip !== undefined && tip !== null && tip !== "";
  if (href) {
    const link = (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
    return hasTip ? <Tooltip content={tip}>{link}</Tooltip> : link;
  }
  if (onClick) {
    // 누르는 칩은 버튼이다(키보드로 닿는다). hit 영역은 ::before 로 32px 까지 넓힌다
    const button = (
      <button
        type="button"
        className={cls}
        onClick={onClick}
        aria-label={ariaLabel}
        aria-pressed={pressed}
      >
        {inner}
      </button>
    );
    return hasTip ? (
      <Tooltip content={tip} className={styles.chipTipAnchor}>
        {button}
      </Tooltip>
    ) : (
      button
    );
  }
  const chip = (
    <span className={cls}>
      {inner}
      {onRemove ? (
        <button type="button" className={styles.chipRemove} aria-label={removeLabel ?? `${label} 제거`} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      ) : null}
    </span>
  );
  // 제거 버튼이 있으면 버튼이 포커스를 받으므로 래퍼는 포커스 가능하게 만들지 않는다
  return hasTip ? (
    <Tooltip content={tip} focusable={!onRemove} className={styles.chipTipAnchor}>
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
