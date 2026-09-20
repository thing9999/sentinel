import type { ReactNode } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import styles from "./table.module.css";

export interface KeyValueItem {
  label: string;
  value: ReactNode;
  /** 값 아래 보조 설명(caption) */
  hint?: string;
  /** 값 아래 4px 주의·정보 표시 (components.md 12.5): 아이콘 12px + 문구 text.secondary */
  note?: KeyValueNote;
}

export interface KeyValueNote {
  tone: "warn" | "info" | "crit";
  text: string;
}

const NOTE_ICON: Record<KeyValueNote["tone"], IconName> = {
  warn: "triangle-alert",
  info: "info",
  crit: "octagon-x",
};
/** 아이콘만으로 구분하지 않도록 스크린리더 앞말 */
const NOTE_SR: Record<KeyValueNote["tone"], string> = {
  warn: "주의: ",
  info: "참고: ",
  crit: "문제: ",
};

export interface KeyValueListProps {
  items: KeyValueItem[];
  /** 1 | 2열 (좁은 화면에서는 1열) */
  columns?: 1 | 2;
  /** px, 기본 120 */
  labelWidth?: number;
  className?: string;
}

/** components.md 7.3. 상세 화면 메타. <dl> 로 마크업, 행 높이 최소 32px. */
export function KeyValueList({ items, columns = 1, labelWidth = 120, className }: KeyValueListProps) {
  return (
    <dl
      className={cx(styles.kv, columns === 2 && styles.kv2, className)}
      style={{ ["--kv-label-w" as string]: `${labelWidth}px` }}
    >
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} className={styles.kvRow}>
          <dt className={styles.kvLabel}>{it.label}</dt>
          <dd className={styles.kvValue}>
            {it.value}
            {it.hint ? <span className={styles.kvHint}>{it.hint}</span> : null}
            {it.note ? (
              <span className={styles.kvNote} data-tone={it.note.tone}>
                <Icon name={NOTE_ICON[it.note.tone]} size={12} className={styles[`kvNote-${it.note.tone}`]} />
                <span>
                  <span className="sr-only">{NOTE_SR[it.note.tone]}</span>
                  {it.note.text}
                </span>
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
