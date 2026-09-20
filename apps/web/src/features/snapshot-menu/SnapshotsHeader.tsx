"use client";

/**
 * 스냅샷 목록 머리 (docs/design/k8s-snapshot.md 2.3): h1 `스냅샷` + AWS / Kubernetes 탭(LinkTabs) + 탭 안내 줄.
 * 탭 배지(상태 아이콘·커밋 금지 숫자·드리프트 칩)는 서버 합산 값 `GET /api/snapshot-menu`·토픽 `snapshot-menu`(계약 12절)만 쓴다.
 * 탭 전환은 링크 이동이다(쿼리 없는 기본 경로). 탭은 목록 페이지 두 곳에만 둔다.
 */
import type { ReactNode } from "react";

import {
  DriftCountChip,
  formatDriftBreakdown,
  formatTime,
  LinkTabs,
  linkTabSrText,
  PageHeader,
  statusFromApi,
  type LinkTabItem,
  type Status,
} from "@/components/ui";

import { useApi } from "../common/hooks";
import { useStreamStore } from "../stream/StreamProvider";
import { driftCode, driftDiffCount } from "../k8s-snapshots/model";
import type { SnapshotMenuPayload, SnapshotMenuResponse, SnapshotMenuTab, SnapshotMenuTabs } from "./types";

export type SnapshotTabId = "aws" | "k8s";

export const SNAPSHOT_TAB_HREF: Record<SnapshotTabId, string> = { aws: "/snapshots", k8s: "/snapshots/k8s" };

export const TAB_CAPTION: Record<SnapshotTabId, string> = {
  aws: "deploy/aws-snapshot CLI로 내보낸 로컬 스냅샷입니다. 대시보드는 이 파일에만 쓰고 AWS·클러스터·git에는 쓰지 않습니다.",
  k8s: "deploy/k8s-snapshot CLI로 내보낸 로컬 스냅샷입니다. 대시보드는 이 파일에만 쓰고, 드리프트를 계산할 때 클러스터를 읽기만 합니다.",
};

/** 탭 배지: included=false(설정 없음)면 아이콘·숫자 없음, stale 이면 stale 아이콘, crit 는 `커밋 금지` */
function tabBadge(tab: SnapshotMenuTab | undefined): Pick<LinkTabItem, "status" | "statusLabel" | "count"> {
  if (!tab || !tab.included) return {};
  const base: Status = statusFromApi(tab.status.status);
  const status: Status = tab.status.stale ? "stale" : base;
  return {
    status,
    statusLabel: status === "crit" ? "커밋 금지" : undefined,
    count: status !== "stale" && tab.critical > 0 ? tab.critical : undefined,
  };
}

/** 탭 항목 (순수 함수, 테스트 대상) */
export function snapshotTabItems(tabs: SnapshotMenuTabs | null | undefined): LinkTabItem[] {
  const aws: LinkTabItem = { href: SNAPSHOT_TAB_HREF.aws, label: "AWS", ...tabBadge(tabs?.aws) };
  const k8s: LinkTabItem = { href: SNAPSHOT_TAB_HREF.k8s, label: "Kubernetes", ...tabBadge(tabs?.k8s) };
  const latest = tabs?.k8s.latestDrift?.drift;
  // 드리프트 칩은 `차이 N건`일 때만 (차이 없음·알 수 없음·계산 전이면 그리지 않는다). 상태 색 없음
  if (latest && driftCode(latest) === "DRIFT_DIFF" && !latest.status.stale) {
    const n = driftDiffCount(latest);
    if (n > 0) {
      const breakdown = latest.counts ? formatDriftBreakdown(latest.counts) : "";
      const at = latest.computedAt ? ` · ${formatTime(latest.computedAt, "autoShort")} 계산` : "";
      k8s.trailing = <DriftCountChip count={n} tooltip={`최신 스냅샷 드리프트: 차이 ${n}건${breakdown ? ` (${breakdown})` : ""}${at}`} />;
      k8s.srText = [linkTabSrText(k8s), `드리프트 차이 ${n}건`].filter(Boolean).join(", ");
    }
  }
  return [aws, k8s];
}

/** 메뉴·탭 합산 값: 스트림(기본 구독) → 없으면 REST 한 번 */
export function useSnapshotMenu(): SnapshotMenuPayload | null {
  const { stream } = useStreamStore();
  const fromStream = stream.snapshotMenu;
  const rest = useApi<SnapshotMenuResponse>(fromStream ? null : "/snapshot-menu");
  return fromStream ?? (rest.data ? { menu: rest.data.menu, tabs: rest.data.tabs } : null);
}

export function SnapshotsHeader({ current, actions }: { current: SnapshotTabId; actions?: ReactNode }) {
  const menu = useSnapshotMenu();
  const items = snapshotTabItems(menu?.tabs);
  return (
    <div className="stack-sm">
      {/* 탭 줄은 머리의 일부(아래 여백 0, 디자인 2.3) */}
      <PageHeader title="스냅샷" actions={actions} tabs={<LinkTabs label="스냅샷 종류" items={items} currentHref={SNAPSHOT_TAB_HREF[current]} />} />
      <p className="text-caption" style={{ marginTop: 12, marginBottom: 4 }}>
        {TAB_CAPTION[current]}
      </p>
    </div>
  );
}
