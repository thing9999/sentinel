"use client";

import Link from "next/link";
import { Fragment } from "react";

import { cx } from "../cx";
import { Spinner } from "../feedback/Spinner";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { StatusIcon } from "../status/StatusIcon";
import { STATUS_LABEL, type Status } from "../types";
import styles from "./shell.module.css";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** 영역 상태 (ok 는 표시 안 함) */
  status?: Status;
  /** 스피너 (어드바이저 분석 중) */
  busy?: boolean;
  /** 그룹 라벨 (앞 항목과 다르면 그룹 머리를 그린다) */
  group?: string;
  /**
   * 숫자 배지 (components.md 12.1). 1 이상일 때만, 상태 아이콘 오른쪽 4px. 99 초과는 `99+`. 접힘 모드에서는 그리지 않는다.
   * 색은 status 를 따르고, status 가 없으면 중립색(아이콘 없이 숫자만).
   */
  count?: number;
  /**
   * 상태 문구 대체 (예: AWS 스냅샷 crit → `커밋 금지`, status.md 1.2).
   * 호출 측이 해당 상태일 때만 넘긴다. 스크린리더 `, 커밋 금지 2개`, 접힘 툴팁 `스냅샷 · 커밋 금지 3개`.
   */
  statusLabel?: string;
}

export interface SideNavProps {
  items: NavItem[];
  currentPath: string;
  /** 64px 모드 (1280px 미만 드로어에서는 항상 펼친 모습) */
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  /** 기본 `주요 메뉴` */
  label?: string;
  className?: string;
}

/** shell.md 3.1 기본 항목 */
export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "개요", icon: "layout-dashboard" },
  { href: "/cluster/nodes", label: "노드", icon: "server", group: "클러스터" },
  { href: "/cluster/workloads", label: "워크로드", icon: "boxes", group: "클러스터" },
  { href: "/cluster/pods", label: "파드", icon: "box", group: "클러스터" },
  { href: "/cluster/events", label: "이벤트", icon: "bell-ring", group: "클러스터" },
  { href: "/cluster/db", label: "데이터베이스", icon: "database", group: "클러스터" },
  { href: "/cost", label: "비용", icon: "circle-dollar-sign", group: "비용·개선" },
  { href: "/advisor", label: "어드바이저", icon: "lightbulb", group: "비용·개선" },
  // k8s-snapshot(2026-09-19): 라벨 `AWS 스냅샷` → `스냅샷` (shell.md 3.1 9번, components.md 15.1). AWS·k8s 합산 상태·숫자는 호출 측
  { href: "/snapshots", label: "스냅샷", icon: "archive", group: "로컬 파일" },
];

/** 숫자 배지 표시 문구: 99 초과는 `99+` */
export const formatNavCount = (n: number) => (n > 99 ? "99+" : n.toLocaleString("en-US"));

const isCurrent = (href: string, path: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

/**
 * components.md 1.3 / shell.md 3절. 상태는 아이콘 모양 + 스크린리더 문구로 알린다(접힘 점은 보조, 툴팁 필수).
 */
export function SideNav({ items, currentPath, collapsed, onToggleCollapsed, label = "주요 메뉴", className }: SideNavProps) {
  return (
    <nav
      aria-label={label}
      className={cx("app-nav", styles.nav, className)}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <ul className={styles.navList}>
        {items.map((it, i) => {
          const current = isCurrent(it.href, currentPath);
          const showGroup = it.group && it.group !== items[i - 1]?.group;
          const showStatus = Boolean(it.status && it.status !== "ok");
          const count = it.count !== undefined && it.count >= 1 ? it.count : null;
          const baseText = it.busy
            ? "분석 중"
            : showStatus
              ? (it.statusLabel ?? STATUS_LABEL[it.status as Status])
              : (it.statusLabel ?? null);
          const statusText =
            count !== null
              ? `${baseText ? `${baseText} ` : ""}${count.toLocaleString("en-US")}개`
              : baseText;
          const link = (
            <Link
              href={it.href}
              className={cx(styles.navItem, current && styles.navCurrent)}
              aria-current={current ? "page" : undefined}
            >
              <span className={styles.navIconWrap}>
                <Icon name={it.icon} size={20} className={styles.navIcon} />
                {it.status && it.status !== "ok" && !it.busy ? (
                  <span className={cx(styles.navDot, styles[`dot-${it.status}`])} aria-hidden="true" />
                ) : null}
              </span>
              <span className={styles.navLabel}>{it.label}</span>
              {statusText ? <span className="sr-only">, {statusText}</span> : null}
              <span className={styles.navStatus} aria-hidden="true">
                {it.busy ? (
                  <Spinner size={12} />
                ) : showStatus ? (
                  <StatusIcon status={it.status as Status} size={14} />
                ) : null}
                {count !== null ? (
                  <span
                    className={cx(styles.navCount, showStatus && styles[`count-${it.status}`])}
                    data-testid="nav-count"
                  >
                    {formatNavCount(count)}
                  </span>
                ) : null}
              </span>
            </Link>
          );
          return (
            <Fragment key={it.href}>
              {showGroup ? (
                <li className={styles.navGroup} role="presentation">
                  <span className={styles.navGroupLabel}>{it.group}</span>
                </li>
              ) : null}
              <li>
                {collapsed ? (
                  <Tooltip
                    content={statusText ? `${it.label} · ${statusText}` : it.label}
                    side="right"
                    className={styles.navTooltip}
                  >
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            </Fragment>
          );
        })}
      </ul>
      {onToggleCollapsed ? (
        <div className={styles.navFooter}>
          <button
            type="button"
            className={styles.navItem}
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "메뉴 펼치기" : undefined}
          >
            <span className={styles.navIconWrap}>
              <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={20} className={styles.navIcon} />
            </span>
            <span className={styles.navLabel}>메뉴 접기</span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}
