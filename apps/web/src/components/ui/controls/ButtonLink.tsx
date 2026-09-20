import Link from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import type { Size } from "../types";
import type { ButtonVariant } from "./Button";
import styles from "./controls.module.css";

export interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children"> {
  href: string;
  /** 기본 ghost */
  variant?: ButtonVariant;
  /** 기본 md */
  size?: Size;
  icon?: IconName;
  children: ReactNode;
  /** 문구 뒤 caption text.tertiary (예: 휴지통 개수 `3`) */
  suffix?: ReactNode;
  /** suffix 스크린리더 문구 (예: `3개`). 없으면 suffix 그대로 읽힘 */
  suffixLabel?: string;
}

/**
 * 버튼 모양 링크 (페이지 이동은 <a>). aws-snapshot-manager.md 3.1 목록 헤더 `휴지통 3`(ghost md, trash-2).
 * Button 과 같은 크기·색 클래스를 쓴다. 비활성 상태는 없다(이동할 수 없으면 링크를 그리지 않는다).
 */
export function ButtonLink({
  href,
  variant = "ghost",
  size = "md",
  icon,
  children,
  suffix,
  suffixLabel,
  className,
  ...rest
}: ButtonLinkProps) {
  const iconSize = size === "lg" ? 20 : 16;
  const hasSuffix = suffix !== undefined && suffix !== null && suffix !== "";
  return (
    <Link
      {...rest}
      href={href}
      className={cx(styles.button, styles[`btn-${variant}`], styles[`btn-${size}`], styles.buttonLink, className)}
    >
      {icon ? <Icon name={icon} size={iconSize} className={styles.btnIcon} /> : null}
      <span className={styles.btnLabel}>{children}</span>
      {hasSuffix ? (
        suffixLabel ? (
          <>
            <span className={styles.buttonLinkSuffix} aria-hidden="true">
              {suffix}
            </span>
            <span className="sr-only">{suffixLabel}</span>
          </>
        ) : (
          <span className={styles.buttonLinkSuffix}>{suffix}</span>
        )
      ) : null}
    </Link>
  );
}
