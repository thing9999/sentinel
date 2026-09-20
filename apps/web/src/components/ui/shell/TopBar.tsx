"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { Icon } from "../icons";
import { DataSourceBadge, type MockScenario, type ScenarioGroupId } from "./DataSourceBadge";
import styles from "./shell.module.css";

export interface TopBarProps {
  /** null 이면 `클러스터 연결 없음` */
  cluster: { name: string; version?: string; region?: string } | null;
  /** 클러스터 정보 자리 스켈레톤 200×14px */
  clusterLoading?: boolean;
  /** DataSourceBadge 로 전달 (null = 아직 모름 → 표시 없음) */
  dataSource: "mock" | "live" | null;
  /** mock 시나리오 (있으면 배지가 Popover 를 연다) */
  scenarios?: MockScenario[];
  /** 메서드 표기(bivariant): 기존 `(group: ScenarioGroup | ScenarioGroupKey, id)` 핸들러도 허용 */
  onScenarioChange?(group: ScenarioGroupId, id: string): void;
  /** `<ConnectionIndicator />` */
  connection: ReactNode;
  /** `<ThemeMenu />` */
  themeToggle?: ReactNode;
  /** 1280px 미만 메뉴 버튼 */
  onMenuClick?: () => void;
  /** 메뉴 드로어 열림 (aria-expanded) */
  menuOpen?: boolean;
  className?: string;
}

/**
 * components.md 1.2 / shell.md 2절. 높이 56px, sticky.
 * 좁은 화면(767px 이하)에서는 클러스터 정보를 숨기고, 479px 이하에서는 로고 문구·연결 시각을 숨겨 360px 폭에 맞춘다.
 */
export function TopBar({
  cluster,
  clusterLoading = false,
  dataSource,
  scenarios,
  onScenarioChange,
  connection,
  themeToggle,
  onMenuClick,
  menuOpen,
  className,
}: TopBarProps) {
  return (
    <header className={cx("app-header", styles.topBar, className)}>
      {onMenuClick ? (
        <IconButton
          icon="menu"
          label="메뉴 열기"
          size="md"
          className={styles.menuButton}
          onClick={onMenuClick}
          aria-expanded={menuOpen}
          showTooltip={false}
        />
      ) : null}
      <Link href="/" className={cx(styles.logo, onMenuClick && styles.logoWithMenu)} aria-label="Sentinel 개요">
        <Icon name="radar" size={24} className={styles.logoIcon} />
        <span className={styles.logoText}>Sentinel</span>
      </Link>
      <div className={styles.clusterInfo}>
        {clusterLoading ? (
          <Skeleton width={200} height={14} />
        ) : cluster ? (
          <span className={styles.clusterText}>
            {[cluster.name, cluster.version, cluster.region].filter(Boolean).join(" · ")}
          </span>
        ) : (
          <span className={styles.clusterNone}>
            <Icon name="circle-help" size={14} />
            클러스터 연결 없음
          </span>
        )}
      </div>
      <div className={styles.topRight}>
        {dataSource ? (
          <DataSourceBadge mode={dataSource} scenarios={scenarios} onScenarioChange={onScenarioChange} />
        ) : null}
        {connection}
        {themeToggle}
      </div>
    </header>
  );
}
