"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "../cx";
import { placeFloating, type Align } from "../hooks";
import styles from "./overlay.module.css";

export interface PopoverTriggerProps {
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-controls": string;
  "aria-haspopup": "dialog";
}

export interface PopoverProps {
  /** 트리거 렌더 함수. 받은 props 를 버튼에 그대로 넘긴다. */
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode;
  /** 패널 이름(스크린리더) */
  label: string;
  /** px, 기본 280. 화면 폭 − 16px 을 넘지 않는다 */
  width?: number;
  /** `start`(기본) = 트리거 왼쪽 맞춤, `end` = 오른쪽 맞춤(범례, components.md 17.7) */
  align?: Align;
  /** 최대 높이. 넘치면 패널 안에서 스크롤한다. 기본 `min(480px, 100vh − 32px)` */
  maxHeight?: number | string;
  /** 제어 모드 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * components.md 5.2. 비모달 패널(role=dialog). 열리면 첫 포커스 요소로 이동,
 * Esc·바깥 클릭으로 닫히고 트리거로 포커스를 돌려준다.
 */
export function Popover({
  trigger,
  children,
  label,
  width = 280,
  align = "start",
  maxHeight,
  open: openProp,
  onOpenChange,
  className,
}: PopoverProps) {
  const id = useId();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
  const setOpenRef = useRef(setOpen);
  useLayoutEffect(() => {
    setOpenRef.current = setOpen;
  });

  const focusTrigger = () => {
    const el = anchorRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    el?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const place = () => {
      const pos = placeFloating(
        anchor.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        "bottom",
        align,
        4,
      );
      panel.style.top = `${pos.top}px`;
      panel.style.left = `${pos.left}px`;
      panel.style.visibility = "visible";
    };
    place();
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenRef.current(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cx(styles.popoverRoot, className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          focusTrigger();
        }
      }}
    >
      <span ref={anchorRef} className={styles.popoverAnchor}>
        {trigger({
          onClick: () => setOpen(!open),
          "aria-expanded": open,
          "aria-controls": id,
          "aria-haspopup": "dialog",
        })}
      </span>
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={styles.popover}
          style={{
            width: `min(${width}px, calc(100vw - var(--spacing-4)))`,
            maxHeight: typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
