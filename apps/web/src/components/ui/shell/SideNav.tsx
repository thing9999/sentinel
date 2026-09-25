"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

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
   * 숫자 배지 (components.md 12.1·21.1). 1 이상일 때만, 상태 아이콘 오른쪽 4px. 99 초과는 `99+`.
   * **`status` 없이 `count`만** 줄 수 있다(`알림`은 상태 점이 없다, shell.md 3.1).
   * 최초 로딩 중에는 넘기지 않는다(자리도 비운다). 연결이 끊겨도 **0으로 내리지 않는다**(shell.md 5절).
   */
  count?: number;
  /**
   * 배지 색 (components.md 21.1). 기본 `crit`. 알림은 **미확인 중 최악 심각도**를 넘긴다.
   * `status` 가 있는 항목에서 생략하면 종전처럼 `status` 색을 따른다.
   */
  countTone?: Status;
  /**
   * 배지의 스크린리더·접힘 툴팁 문구 (`안 읽음 3건`, 끊김이면 `안 읽음 3건 · 14:02:10 기준`).
   * 없으면 종전 규칙(`, 커밋 금지 2개`).
   */
  countLabel?: string;
  /**
   * 상태 문구 대체 (예: AWS 스냅샷 crit → `커밋 금지`, status.md 1.2).
   * 호출 측이 해당 상태일 때만 넘긴다. 스크린리더 `, 커밋 금지 2개`, 접힘 툴팁 `스냅샷 · 커밋 금지 3개`.
   */
  statusLabel?: string;
}

export interface SideNavProps {
  items: NavItem[];
  /**
   * 하단 고정 영역 항목 (shell.md 3.3). `설정` 하나가 첫 사용처다.
   * 목록이 스크롤돼도 **언제나 보인다**. 없으면 종전과 같다.
   */
  footerItems?: NavItem[];
  currentPath: string;
  /** 64px 모드 (1280px 미만 드로어에서는 항상 펼친 모습) */
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  /** 기본 `주요 메뉴` */
  label?: string;
  className?: string;
}

/** shell.md 3.1 기본 항목 (2026-09-25 `알림`·`로그` 추가로 11개) */
export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "개요", icon: "layout-dashboard" },
  // alerts(2026-09-25): 상태 점 없음(상태의 파생) + 안 읽은 개수 배지. shell.md 3.1
  { href: "/alerts", label: "알림", icon: "inbox" },
  { href: "/cluster/nodes", label: "노드", icon: "server", group: "클러스터" },
  { href: "/cluster/workloads", label: "워크로드", icon: "boxes", group: "클러스터" },
  { href: "/cluster/pods", label: "파드", icon: "box", group: "클러스터" },
  { href: "/cluster/events", label: "이벤트", icon: "bell-ring", group: "클러스터" },
  // logs(2026-09-25): 상태 점·배지 없음(로그 내용으로 상태를 판단하지 않는다, logs 명세 3.0)
  { href: "/logs", label: "로그", icon: "scroll-text", group: "클러스터" },
  { href: "/cluster/db", label: "데이터베이스", icon: "database", group: "클러스터" },
  { href: "/cost", label: "비용", icon: "circle-dollar-sign", group: "비용·개선" },
  { href: "/advisor", label: "어드바이저", icon: "lightbulb", group: "비용·개선" },
  // k8s-snapshot(2026-09-19): 라벨 `AWS 스냅샷` → `스냅샷` (shell.md 3.1 9번, components.md 15.1). AWS·k8s 합산 상태·숫자는 호출 측
  { href: "/snapshots", label: "스냅샷", icon: "archive", group: "로컬 파일" },
];

/**
 * 하단 고정 영역 기본 항목 (shell.md 3.3). `설정`은 어느 그룹에도 속하지 않는다 —
 * 그룹은 "무엇을 보는가"인데 설정은 "대시보드 자체"라서다. 상태 점·배지 없음.
 */
export const DEFAULT_NAV_FOOTER_ITEMS: NavItem[] = [
  { href: "/settings", label: "설정", icon: "settings" },
];

/** 숫자 배지 표시 문구: 99 초과는 `99+` */
export const formatNavCount = (n: number) => (n > 99 ? "99+" : n.toLocaleString("en-US"));

const isCurrent = (href: string, path: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

/** 항목의 스크린리더 문구(상태 + 배지). 접힘 툴팁도 같은 문구를 쓴다 */
export function navItemStatusText(it: NavItem): string | null {
  const showStatus = Boolean(it.status && it.status !== "ok");
  const baseText = it.busy
    ? "분석 중"
    : showStatus
      ? (it.statusLabel ?? STATUS_LABEL[it.status as Status])
      : (it.statusLabel ?? null);
  const count = it.count !== undefined && it.count >= 1 ? it.count : null;
  if (count === null) return baseText;
  // countLabel 이 있으면 배지 문구를 그대로 쓴다(`안 읽음 3건`). 없으면 종전 규칙(`커밋 금지 2개`)
  if (it.countLabel) return baseText ? `${baseText} · ${it.countLabel}` : it.countLabel;
  return `${baseText ? `${baseText} ` : ""}${count.toLocaleString("en-US")}개`;
}

/**
 * components.md 1.3·21.1 / shell.md 3절. 상태는 아이콘 모양 + 스크린리더 문구로 알린다(접힘 점은 보조, 툴팁 필수).
 *
 * 세로 3단(shell.md 3.3): **목록만 스크롤**하고 `설정`·`메뉴 접기`는 하단 고정이다.
 * 항목 12개면 펼침 613px·접힘 584px이라 1366×768 노트북(뷰포트 약 640px)에서 넘친다.
 */
export function SideNav({
  items,
  footerItems,
  currentPath,
  collapsed,
  onToggleCollapsed,
  label = "주요 메뉴",
  className,
}: SideNavProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 구분선은 **스크롤이 실제로 생길 때만** 그린다(항상 그으면 스크롤이 없는 화면에서 하단이 떠 보인다)
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setScrollable(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items.length, footerItems?.length, collapsed]);

  // 페이지를 열 때 현재 항목이 스크롤 영역 밖이면 한 번 맞춘다 (shell.md 3.3)
  const currentRef = useCallback((el: HTMLAnchorElement | null) => {
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ block: "nearest" });
  }, []);

  const renderItem = (it: NavItem) => {
    const current = isCurrent(it.href, currentPath);
    const showStatus = Boolean(it.status && it.status !== "ok");
    const count = it.count !== undefined && it.count >= 1 ? it.count : null;
    const statusText = navItemStatusText(it);
    // 배지 색: countTone > (상태가 있으면) 상태 > crit (components.md 21.1)
    const countTone: Status = it.countTone ?? (showStatus ? (it.status as Status) : "crit");
    const link = (
      <Link
        ref={current ? currentRef : undefined}
        href={it.href}
        className={cx(styles.navItem, current && styles.navCurrent)}
        aria-current={current ? "page" : undefined}
      >
        <span className={styles.navIconWrap}>
          <Icon name={it.icon} size={20} className={styles.navIcon} />
          {showStatus && !it.busy ? (
            <span className={cx(styles.navDot, styles[`dot-${it.status}`])} aria-hidden="true" />
          ) : null}
          {/*
           * 접힘(64px)의 숫자 배지 (shell.md 3.2, 2026-09-25): **상태 점이 없는 항목만.**
           * 알림은 점이 없어 배지가 유일한 신호다. 스냅샷은 점이 이미 "문제 있음"을 말하므로 종전대로 그리지 않는다.
           */}
          {count !== null && !showStatus && !it.busy ? (
            <span
              className={cx(styles.navDotCount, styles[`count-${countTone}`])}
              data-testid="nav-count-collapsed"
              aria-hidden="true"
            >
              {formatNavCount(count)}
            </span>
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
            <span className={cx(styles.navCount, styles[`count-${countTone}`])} data-testid="nav-count">
              {formatNavCount(count)}
            </span>
          ) : null}
        </span>
      </Link>
    );
    return collapsed ? (
      <Tooltip
        content={statusText ? `${it.label} · ${statusText}` : it.label}
        side="right"
        className={styles.navTooltip}
      >
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  return (
    <nav
      aria-label={label}
      className={cx("app-nav", styles.nav, className)}
      data-collapsed={collapsed ? "true" : "false"}
    >
      {/* 1단: 목록 영역만 스크롤한다 */}
      <div ref={scrollRef} className={styles.navScroll}>
        <ul className={styles.navList}>
          {items.map((it, i) => {
            const showGroup = it.group && it.group !== items[i - 1]?.group;
            return (
              <Fragment key={it.href}>
                {showGroup ? (
                  <li className={styles.navGroup} role="presentation">
                    <span className={styles.navGroupLabel}>{it.group}</span>
                  </li>
                ) : null}
                <li>{renderItem(it)}</li>
              </Fragment>
            );
          })}
        </ul>
      </div>

      {/* 2단 구분선 + 3단 하단 고정 영역 (스크롤과 무관하게 언제나 보인다) */}
      {footerItems?.length || onToggleCollapsed ? (
        <div className={styles.navFooter} data-scrollable={scrollable ? "true" : "false"}>
          {footerItems?.length ? (
            <ul className={styles.navList}>
              {footerItems.map((it) => (
                <li key={it.href}>{renderItem(it)}</li>
              ))}
            </ul>
          ) : null}
          {onToggleCollapsed ? (
            <button
              type="button"
              className={cx(styles.navItem, styles.navCollapseButton)}
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "메뉴 펼치기" : undefined}
            >
              <span className={styles.navIconWrap}>
                <Icon
                  name={collapsed ? "panel-left-open" : "panel-left-close"}
                  size={20}
                  className={styles.navIcon}
                />
              </span>
              <span className={styles.navLabel}>메뉴 접기</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
