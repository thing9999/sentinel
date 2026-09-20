"use client";

import { useState, type ReactNode } from "react";

import { Button } from "../controls/Button";
import { Drawer } from "./Drawer";
import { Popover } from "./Popover";
import styles from "./overlay.module.css";

export interface HelpPopoverProps {
  /** 트리거 버튼 문구 (예: `계산 방법`) */
  label: string;
  title: string;
  content: ReactNode;
  /** popover 폭 400px | drawer md */
  mode?: "popover" | "drawer";
  className?: string;
}

/** components.md 5.5. 트리거는 ghost sm 버튼 + circle-help 아이콘. */
export function HelpPopover({ label, title, content, mode = "popover", className }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  if (mode === "drawer") {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          icon="circle-help"
          className={className}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          {label}
        </Button>
        <Drawer open={open} onClose={() => setOpen(false)} title={title} size="md">
          <div className={styles.helpBody}>{content}</div>
        </Drawer>
      </>
    );
  }
  return (
    <Popover
      label={title}
      width={400}
      className={className}
      open={open}
      onOpenChange={setOpen}
      trigger={(p) => (
        <Button variant="ghost" size="sm" icon="circle-help" {...p}>
          {label}
        </Button>
      )}
    >
      <h3 className={styles.helpTitle}>{title}</h3>
      <div className={styles.helpBody}>{content}</div>
    </Popover>
  );
}
