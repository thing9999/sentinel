"use client";

import { useRef, type ReactNode } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { StatusIcon } from "../status/StatusIcon";
import type { Status } from "../types";
import styles from "./layout.module.css";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  /** 12px 상태 아이콘 (라벨 앞) */
  status?: Status;
  /** 저장하지 않은 변경: 라벨 뒤 4px 에 8px 원 accent.default, sr `저장 안 됨` (components.md 12.4) */
  dirty?: boolean;
  /** 라벨 뒤 caption text.tertiary (`보기 전용`, `파일 없음`) */
  suffix?: string;
  /** suffix 앞 12px 아이콘 (예: 파일 없음 `file-x`, 색은 suffixTone) */
  suffixIcon?: IconName;
  /** suffixIcon 색. 기본 text.tertiary */
  suffixTone?: "crit" | "warn";
  /** 라벨 mono 12/20 (파일 이름) */
  mono?: boolean;
  /** 개수 뒤 스크린리더 보조 문구. 예 `발견` → `, 발견 1건` (없으면 숫자만 읽힘) */
  countLabel?: string;
}

/** 탭·패널 id 규칙 (TabPanel 과 짝) */
export const tabIds = (idBase: string, id: string) => ({
  tab: `${idBase}-tab-${id}`,
  panel: `${idBase}-panel-${id}`,
});

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** 탭·패널 id 접두어 (TabPanel 에 같은 값) */
  idBase: string;
  /** 탭 목록 이름(스크린리더) */
  label: string;
  className?: string;
}

/**
 * components.md 8.3. 높이 40px, 선택 탭 아래 2px accent. 화살표·Home·End 키로 이동(roving tabindex).
 * 좁으면 탭 목록 안에서 가로 스크롤.
 */
export function Tabs({ items, value, onChange, idBase, label, className }: TabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const focusTab = (index: number) => {
    const i = (index + items.length) % items.length;
    onChange(items[i].id);
    const btn = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i];
    btn?.focus();
  };
  const current = items.findIndex((t) => t.id === value);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cx(styles.tabs, className)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") focusTab(current + 1);
        else if (e.key === "ArrowLeft") focusTab(current - 1);
        else if (e.key === "Home") focusTab(0);
        else if (e.key === "End") focusTab(items.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {items.map((t) => {
        const selected = t.id === value;
        const ids = tabIds(idBase, t.id);
        return (
          <button
            key={t.id}
            id={ids.tab}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            className={cx(styles.tab, selected && styles.tabSelected)}
            onClick={() => onChange(t.id)}
          >
            {t.status ? <StatusIcon status={t.status} size={12} /> : null}
            <span className={cx(t.mono && styles.tabMono)}>{t.label}</span>
            {t.count !== undefined ? (
              t.countLabel ? (
                <>
                  <span className={styles.tabCount} aria-hidden="true">
                    {t.count.toLocaleString("en-US")}
                  </span>
                  <span className="sr-only">
                    , {t.countLabel} {t.count.toLocaleString("en-US")}건
                  </span>
                </>
              ) : (
                <span className={styles.tabCount}>{t.count.toLocaleString("en-US")}</span>
              )
            ) : null}
            {t.suffix ? (
              <span className={styles.tabSuffix}>
                {t.suffixIcon ? (
                  <Icon
                    name={t.suffixIcon}
                    size={12}
                    className={cx(t.suffixTone === "crit" && styles.fgCrit, t.suffixTone === "warn" && styles.fgWarn)}
                  />
                ) : null}
                <span className="sr-only">, </span>
                {t.suffix}
              </span>
            ) : null}
            {t.dirty ? (
              <>
                <span className={styles.tabDirty} aria-hidden="true" />
                <span className="sr-only">, 저장 안 됨</span>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  idBase: string;
  /** 이 패널의 탭 id */
  id: string;
  /** 현재 선택 탭 id */
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ idBase, id, value, children, className }: TabPanelProps) {
  const ids = tabIds(idBase, id);
  const selected = id === value;
  return (
    <div
      id={ids.panel}
      role="tabpanel"
      aria-labelledby={ids.tab}
      hidden={!selected}
      tabIndex={0}
      className={cx(styles.tabPanel, className)}
    >
      {selected ? children : null}
    </div>
  );
}
