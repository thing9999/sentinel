import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { StatusIcon } from "../status/StatusIcon";
import { STATUS_LABEL, type Status } from "../types";
import styles from "./layout.module.css";

export interface LinkTabItem {
  href: string;
  label: string;
  /** 14px 상태 아이콘 (라벨 뒤). `ok`는 그리지 않는다 (k8s-snapshot.md 2.3: 파일 상태 전용) */
  status?: Status;
  /** 상태 문구 대체 (예: crit → `커밋 금지`). 스크린리더 문구에만 쓴다 */
  statusLabel?: string;
  /** 1 이상이면 숫자 pill (99 초과 `99+`) */
  count?: number;
  /** pill 색. 기본 crit */
  countTone?: Status;
  /**
   * 맨 뒤 장식 요소(드리프트 칩 등). 스크린리더에서 숨긴다(aria-hidden). 읽어야 할 내용은 srText 로 준다.
   */
  trailing?: ReactNode;
  /**
   * 스크린리더 보조 문구(라벨 뒤). 주면 상태·숫자로 만든 자동 문구를 대신한다.
   * 예: `커밋 금지 1개, 드리프트 차이 3건` → `Kubernetes, 커밋 금지 1개, 드리프트 차이 3건`
   */
  srText?: string;
}

export interface LinkTabsProps {
  items: LinkTabItem[];
  /** 일치하는 항목에 aria-current="page" */
  currentHref: string;
  /** `<nav aria-label>` (예 `스냅샷 종류`) */
  label: string;
  className?: string;
}

const formatCount = (n: number) => (n > 99 ? "99+" : n.toLocaleString("en-US"));

/** 자동 스크린리더 문구: `주의` / `커밋 금지 1개` / `2개` */
export function linkTabSrText(item: Pick<LinkTabItem, "status" | "statusLabel" | "count">): string {
  const showStatus = Boolean(item.status && item.status !== "ok");
  const base = showStatus ? (item.statusLabel ?? STATUS_LABEL[item.status as Status]) : "";
  const count = item.count !== undefined && item.count >= 1 ? `${item.count.toLocaleString("en-US")}개` : "";
  return [base, count].filter(Boolean).join(" ");
}

/**
 * components.md 14.1. 서로 다른 URL 로 가는 탭 모양 링크 목록(`<nav>` + `<a>`).
 * `role="tablist"`를 쓰지 않는다(링크라 Enter 가 페이지를 바꾼다). 화살표 키 이동 없음, Tab 으로 이동.
 * 좁은 화면에서는 목록 안에서만 가로 스크롤한다.
 */
export function LinkTabs({ items, currentHref, label, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cx(styles.linkTabs, className)}>
      <ul className={styles.linkTabList}>
        {items.map((it) => {
          const current = it.href === currentHref;
          const showStatus = Boolean(it.status && it.status !== "ok");
          const count = it.count !== undefined && it.count >= 1 ? it.count : null;
          const sr = it.srText ?? linkTabSrText(it);
          return (
            <li key={it.href} className={styles.linkTabLi}>
              <Link
                href={it.href}
                className={cx(styles.linkTab, current && styles.linkTabCurrent)}
                aria-current={current ? "page" : undefined}
              >
                <span className={styles.linkTabLabel}>{it.label}</span>
                {sr ? <span className="sr-only">, {sr}</span> : null}
                {showStatus ? <StatusIcon status={it.status as Status} size={14} /> : null}
                {count !== null ? (
                  <span
                    className={cx(styles.linkTabCount, styles[`linkTabCount-${it.countTone ?? "crit"}`])}
                    aria-hidden="true"
                    data-testid="link-tab-count"
                  >
                    {formatCount(count)}
                  </span>
                ) : null}
                {it.trailing ? (
                  <span className={styles.linkTabTrailing} aria-hidden="true">
                    {it.trailing}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
