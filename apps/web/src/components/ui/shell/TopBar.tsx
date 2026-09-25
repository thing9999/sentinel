"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { Icon } from "../icons";
import { ResourceName } from "../table/ResourceName";
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
  // 툴팁 보조 줄(shell.md 2.1): `Kubernetes v1.31.2 · ap-northeast-2`
  const clusterMeta = cluster
    ? [cluster.version ? `Kubernetes ${cluster.version}` : null, cluster.region].filter(Boolean).join(" · ")
    : "";
  const clusterFullText = cluster
    ? [cluster.name, cluster.version, cluster.region].filter(Boolean).join(" · ")
    : "";
  // 좁은 화면에서 남는 circle-help 버튼의 aria-label 겸 툴팁: 버린 값을 모두 담는다
  const fallbackLabel = cluster ? `클러스터 ${clusterFullText}` : "클러스터 연결 없음";

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
        ) : (
          <>
            {cluster ? (
              <span className={styles.clusterText}>
                {/*
                  스크린리더는 한 문장으로 한 번만 읽는다. 폭이 좁아 리전·버전을 화면에서 접어도
                  여기에는 남으므로 값이 사라지지 않는다(shell.md 2.1 "버린 값은 툴팁에 남긴다"의 낭독판).
                */}
                <span className="sr-only">{clusterFullText}</span>
                <span className={styles.clusterVisual} aria-hidden="true">
                  <ResourceName
                    name={cluster.name}
                    kind="cluster"
                    className={styles.clusterName}
                    tooltipExtra={clusterMeta || undefined}
                  />
                  {cluster.version ? (
                    <span className={styles.clusterVersion}>{` · ${cluster.version}`}</span>
                  ) : null}
                  {cluster.region ? <span className={styles.clusterRegion}>{` · ${cluster.region}`}</span> : null}
                </span>
              </span>
            ) : (
              <span className={styles.clusterNone}>
                <Icon name="circle-help" size={14} />
                클러스터 연결 없음
              </span>
            )}
            {/*
              블록이 좁아(≤767px, 또는 가용 폭 160px 미만) 문구를 못 보일 때 남는 유일한 단서.
              shell.md 2.1 마지막 줄: 로고 오른쪽에 circle-help 14px 버튼만 남기고 툴팁에 세 값을 모두 넣는다.
            */}
            <span className={styles.clusterFallback}>
              <IconButton icon="circle-help" size="sm" label={fallbackLabel} />
            </span>
          </>
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
