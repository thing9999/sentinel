"use client";

import { useId } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { Popover } from "../overlay/Popover";
import styles from "./shell.module.css";

export type ThemeChoice = "light" | "dark" | "system";

export interface ThemeMenuProps {
  value: ThemeChoice;
  /** 호출 측이 <html data-theme> 와 localStorage `sentinel.theme` 를 바꾼다 */
  onChange: (value: ThemeChoice) => void;
  className?: string;
}

const OPTIONS: { value: ThemeChoice; label: string; icon: IconName }[] = [
  { value: "light", label: "라이트", icon: "sun" },
  { value: "dark", label: "다크", icon: "moon" },
  { value: "system", label: "시스템", icon: "monitor" },
];

/** shell.md 2절 테마 토글: IconButton md + Popover 메뉴 3항목 */
export function ThemeMenu({ value, onChange, className }: ThemeMenuProps) {
  const name = useId();
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[2];
  return (
    <Popover
      label="테마 선택"
      width={180}
      align="end"
      className={className}
      trigger={(p) => (
        <button type="button" {...p} className={styles.themeButton} aria-label={`테마: ${current.label}`}>
          <Icon name={current.icon} size={16} />
        </button>
      )}
    >
      <fieldset className={styles.themeList}>
        <legend className="sr-only">테마</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className={cx(styles.themeItem, o.value === value && styles.themeItemOn)}>
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
            <Icon name={o.icon} size={16} />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>
    </Popover>
  );
}
