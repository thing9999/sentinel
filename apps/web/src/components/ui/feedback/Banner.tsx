"use client";

import type { ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import styles from "./feedback.module.css";

export type AlertTone = "info" | "warn" | "crit" | "neutral" | "stale" | "ok";

const DEFAULT_ICON: Record<AlertTone, IconName> = {
  info: "info",
  warn: "triangle-alert",
  crit: "octagon-x",
  neutral: "info",
  stale: "clock-alert",
  ok: "circle-check",
};

export interface BannerProps {
  tone: AlertTone;
  icon?: IconName;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * 닫기 버튼 표시 (`onClose` 필요). **2026-09-20 표준 이름**(components.md 6.1·6.2).
   * `Dialog`·`Drawer`·`Popover` 가 이미 `onClose` 를 쓰므로 한 낱말로 모은다.
   */
  closable?: boolean;
  onClose?: () => void;
  /** 닫기 버튼 접근 이름 (기본 `닫기`) */
  closeLabel?: string;
  /** @deprecated `closable` 을 쓴다. 기존 사용처를 위해 당분간 함께 받는다 (components.md 6.1) */
  dismissible?: boolean;
  /** @deprecated `onClose` 를 쓴다. */
  onDismiss?: () => void;
  /** 내용이 실시간으로 바뀌어 알려야 하면 true → role=status (기본 false: 과한 알림 방지) */
  live?: boolean;
  className?: string;
}

/**
 * components.md 6.1. 페이지 상단 전체 폭 안내. 왼쪽 3px 막대 + 아이콘 + 제목(색 외 신호).
 * tone `stale` 은 architecture-advisor.md 2.5 (결과가 현재 상태와 다를 수 있음).
 *
 * 닫기 prop 은 `closable`/`onClose`/`closeLabel` 이 표준이고, 옛 이름 `dismissible`/`onDismiss` 도
 * 당분간 함께 받는다(`closable ?? dismissible`). 새로 쓰는 곳은 옛 이름을 쓰지 않는다.
 */
export function Banner({
  tone,
  icon,
  title,
  description,
  actions,
  closable,
  onClose,
  closeLabel = "닫기",
  dismissible,
  onDismiss,
  live = false,
  className,
}: BannerProps) {
  // 하위 호환: 새 이름을 먼저 보고, 없으면 옛 이름(components.md 6.1 — 사용처는 고치지 않는다)
  const canClose = closable ?? dismissible ?? false;
  const close = onClose ?? onDismiss;
  return (
    <div className={cx(styles.banner, styles[`tone-${tone}`], className)} role={live ? "status" : undefined}>
      <Icon name={icon ?? DEFAULT_ICON[tone]} size={20} className={styles.alertIcon} />
      <div className={styles.alertText}>
        <div className={styles.bannerTitle}>{title}</div>
        {description ? <div className={styles.alertDesc}>{description}</div> : null}
      </div>
      {actions ? <div className={styles.alertActions}>{actions}</div> : null}
      {canClose && close ? (
        <IconButton icon="x" label={closeLabel} size="sm" onClick={close} className={styles.alertClose} />
      ) : null}
    </div>
  );
}

export interface InlineAlertProps {
  tone: AlertTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** 한 줄 32px */
  compact?: boolean;
  icon?: IconName;
  live?: boolean;
  /** 오른쪽 끝 닫기 버튼(`x` sm). `onClose` 와 함께 있어야 그려진다 (snapshot-3d.md 9.5·9.9) */
  closable?: boolean;
  onClose?: () => void;
  /** 닫기 버튼 접근 이름 (기본 `이 안내 닫기`) */
  closeLabel?: string;
  className?: string;
}

/**
 * components.md 6.2. 카드·섹션 안 안내.
 * 닫기는 `action` 에 버튼을 끼우지 말고 `closable`+`onClose` 를 쓴다 — 닫기가 늘 마지막 자리에 오고,
 * 접근 이름·간격이 `Banner` 와 같아진다. 다시 띄울지(한 번 닫으면 끝인지)는 호출 측이 정한다.
 */
export function InlineAlert({
  tone,
  title,
  description,
  action,
  compact = false,
  icon,
  live,
  closable = false,
  onClose,
  closeLabel = "이 안내 닫기",
  className,
}: InlineAlertProps) {
  return (
    <div
      className={cx(styles.inlineAlert, styles[`tone-${tone}`], compact && styles.inlineCompact, className)}
      role={live ? "status" : undefined}
    >
      <Icon name={icon ?? DEFAULT_ICON[tone]} size={16} className={styles.alertIcon} />
      <div className={styles.alertText}>
        <div className={styles.inlineTitle}>{title}</div>
        {description && !compact ? <div className={styles.alertDesc}>{description}</div> : null}
      </div>
      {action ? <div className={styles.alertActions}>{action}</div> : null}
      {closable && onClose ? (
        <IconButton icon="x" label={closeLabel} size="sm" onClick={onClose} className={styles.alertClose} />
      ) : null}
    </div>
  );
}
