"use client";

import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";

import { cx } from "../cx";
import { Spinner } from "../feedback/Spinner";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import type { Size } from "../types";
import styles from "./controls.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: ButtonVariant;
  size?: Size;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** 비활성 이유: 툴팁 + aria-describedby */
  disabledReason?: string;
  fullWidth?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * components.md 4.1.
 * 비활성은 aria-disabled 로 표시해 포커스·툴팁(비활성 이유)을 유지하고 클릭만 막는다.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  disabled = false,
  disabledReason,
  fullWidth = false,
  className,
  children,
  onClick,
  type = "button",
  ref,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const inactive = disabled || loading;
  const iconSize = size === "lg" ? 20 : 16;
  const describedBy = [rest["aria-describedby"], disabled && disabledReason ? reasonId : null]
    .filter(Boolean)
    .join(" ");

  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        styles.button,
        styles[`btn-${variant}`],
        styles[`btn-${size}`],
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
        loading && styles.loading,
        className,
      )}
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      aria-describedby={describedBy || undefined}
      onClick={(e) => {
        if (inactive) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {loading ? (
        <Spinner size={size === "lg" ? 20 : 16} className={styles.btnIcon} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} className={styles.btnIcon} />
      ) : null}
      {children !== undefined && children !== null ? <span className={styles.btnLabel}>{children}</span> : null}
      {disabled && disabledReason ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </button>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip content={disabledReason} className={cx(fullWidth && styles.fullWidth)}>
        {button}
      </Tooltip>
    );
  }
  return button;
}
