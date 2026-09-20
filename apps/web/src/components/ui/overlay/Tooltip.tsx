"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "../cx";
import { placeFloating, type Side } from "../hooks";
import styles from "./overlay.module.css";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** 표시 지연(ms). 기본 400 (tokens motion.delay.tooltip) */
  delayMs?: number;
  side?: Side;
  /** px. 기본 320, 화면 폭 − 16px 을 넘지 않는다 */
  maxWidth?: number;
  /** 트리거가 포커스를 받을 수 없는 요소면 true 로 키보드 포커스를 허용한다 */
  focusable?: boolean;
  /** 내용 글꼴을 mono 로 (리소스 전체 이름) */
  mono?: boolean;
  disabled?: boolean;
  /** 감싸는 요소. 블록 내용이면 div */
  as?: "span" | "div";
  className?: string;
}

/**
 * components.md 5.1. hover·포커스 시 지연 후 표시, Esc·스크롤 시 닫힘.
 * position: fixed + 화면 안 보정으로 360px 화면에서도 가로 스크롤을 만들지 않는다.
 */
export function Tooltip({
  content,
  children,
  delayMs = 400,
  side = "top",
  maxWidth,
  focusable = false,
  mono = false,
  disabled = false,
  as = "span",
  className,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const show = () => {
    if (disabled || content === null || content === undefined || content === "") return;
    clear();
    timer.current = window.setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => () => clear(), []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const pos = placeFloating(r, { width: bubble.offsetWidth, height: bubble.offsetHeight }, side, "center", 8);
      bubble.style.top = `${pos.top}px`;
      bubble.style.left = `${pos.left}px`;
      bubble.style.visibility = "visible";
    };
    place();
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, side]);

  const Tag = as;
  return (
    <Tag
      ref={anchorRef as never}
      className={cx(styles.tooltipAnchor, className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          hide();
        }
      }}
      tabIndex={focusable && !disabled ? 0 : undefined}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open ? (
        <span
          ref={bubbleRef}
          id={id}
          role="tooltip"
          className={cx(styles.tooltip, mono && styles.tooltipMono)}
          style={maxWidth ? { maxWidth: `min(${maxWidth}px, calc(100vw - var(--spacing-4)))` } : undefined}
        >
          {content}
        </span>
      ) : null}
    </Tag>
  );
}
