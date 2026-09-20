"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import styles from "./controls.module.css";

export interface CopyButtonProps {
  text: string;
  /** 기본 `복사` */
  label?: string;
  size?: "sm" | "md";
  /** false 면 아이콘만 (aria-label·툴팁은 label) */
  showLabel?: boolean;
  /** 복사 성공 알림 (선택) */
  onCopied?: () => void;
  className?: string;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 아래 대체 경로
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** components.md 4.3. 누르면 1500ms 동안 check 아이콘 + `복사됨`, aria-live=polite 로 한 번 알린다. */
export function CopyButton({ text, label = "복사", size = "md", showLabel = true, onCopied, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onClick = async () => {
    const ok = await writeClipboard(text);
    if (!ok) return;
    setCopied(true);
    onCopied?.();
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const visibleLabel = copied ? "복사됨" : label;
  const btn = (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        styles.copyButton,
        size === "sm" ? styles["copy-sm"] : styles["copy-md"],
        !showLabel && styles.copyIconOnly,
        className,
      )}
      aria-label={showLabel ? undefined : label}
    >
      <Icon name={copied ? "check" : "copy"} size={size === "sm" ? 14 : 16} />
      {showLabel ? <span>{visibleLabel}</span> : null}
      <span className="sr-only" aria-live="polite">
        {copied ? "복사됨" : ""}
      </span>
    </button>
  );
  return showLabel ? btn : <Tooltip content={visibleLabel}>{btn}</Tooltip>;
}
