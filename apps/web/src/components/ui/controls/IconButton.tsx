"use client";

import { useId, type ButtonHTMLAttributes, type Ref } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import type { Size } from "../types";
import styles from "./controls.module.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** 필수: aria-label + 툴팁 */
  label: string;
  /** sm 24 / md 32 / lg 40px (sm 도 hit 영역은 32px) */
  size?: Size;
  variant?: "ghost" | "secondary";
  /** 툴팁 표시 여부 (기본 true) */
  showTooltip?: boolean;
  /** 아이콘 회전(펼침 chevron 등) */
  rotate?: 0 | 90 | 180;
  /**
   * 비활성 사유 (aws-snapshot-manager.md 3.5). `disabled`와 함께 주면 네이티브 disabled 대신
   * aria-disabled(포커스 유지) + 툴팁 사유 + aria-describedby + text.disabled 색, 클릭 무시.
   * 사유 없이 `disabled`만 주면 기존대로 네이티브 disabled.
   */
  disabledReason?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** components.md 4.2 */
export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  showTooltip = true,
  rotate = 0,
  disabledReason,
  disabled,
  onClick,
  className,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  const reasonId = useId();
  const iconSize = size === "sm" ? 14 : size === "md" ? 16 : 20;
  const soft = Boolean(disabled && disabledReason);
  const describedBy = [rest["aria-describedby"], soft ? reasonId : null].filter(Boolean).join(" ") || undefined;
  const btn = (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      disabled={soft ? undefined : disabled}
      aria-disabled={soft ? true : rest["aria-disabled"]}
      aria-describedby={describedBy}
      onClick={(e) => {
        if (soft) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cx(styles.iconButton, styles[`ib-${size}`], styles[`ib-${variant}`], soft && styles.ibDisabled, className)}
    >
      <Icon
        name={icon}
        size={iconSize}
        className={cx(styles.ibIcon, rotate === 90 && styles.rot90, rotate === 180 && styles.rot180)}
      />
      {soft ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </button>
  );
  if (soft) return <Tooltip content={`${label} · ${disabledReason}`}>{btn}</Tooltip>;
  if (!showTooltip) return btn;
  return <Tooltip content={label}>{btn}</Tooltip>;
}
