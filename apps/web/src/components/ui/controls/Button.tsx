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
  /**
   * 비활성 이유: 툴팁 + aria-describedby. **버튼 이름에는 들어가지 않는다**(이름은 `children` 만, 사유는 설명으로 한 번).
   * `disabled` 와 함께 줄 때만 쓰인다.
   */
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
    </button>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip content={disabledReason} className={cx(fullWidth && styles.fullWidth)}>
        {button}
        {/*
          * 사유는 **설명(aria-describedby)으로만** 읽힌다(2026-09-25 고침). 종전에는 이 문장이 버튼 **안**의 sr-only 라
          * 버튼 이름(`저장 대시보드 DB에…`)에도 들어가 스크린리더가 두 번 읽었다.
          * 버튼 밖에 두고 `hidden` 으로 숨긴다 — aria-describedby 가 직접 가리키는 숨은 요소의 글자는 설명 계산에 들어가고
          * (accname 규칙), 읽기 모드에서 따로 읽히는 떠돌이 문장도 되지 않는다.
          */}
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      </Tooltip>
    );
  }
  return button;
}
