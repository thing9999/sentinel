/**
 * docs/api/k8s-snapshot.md 12절: 사이드바 "스냅샷" 메뉴와 AWS / Kubernetes 탭 배지.
 * 서버가 합산한다(화면은 다시 계산하지 않는다). 드리프트는 메뉴 상태에 들어가지 않는다(Q2).
 */
import type { DataSource, IsoTime, SourceState, StatusInfo } from "../common/types";
import type { DriftBadge } from "../k8s-snapshots/types";

export interface SnapshotMenu {
  status: StatusInfo;
  count: number;
  showIcon: boolean;
}

export interface SnapshotMenuTab {
  included: boolean;
  sourceState: SourceState;
  status: StatusInfo;
  critical: number;
}

export interface SnapshotMenuTabs {
  aws: SnapshotMenuTab;
  k8s: SnapshotMenuTab & { latestDrift: { snapshotId: string; drift: DriftBadge } | null };
}

/** `snapshot-menu.snapshot` / `.updated` payload (12.2) */
export interface SnapshotMenuPayload {
  menu: SnapshotMenu;
  tabs: SnapshotMenuTabs;
}

/** GET /api/snapshot-menu (12.1) */
export interface SnapshotMenuResponse extends SnapshotMenuPayload {
  dataSource: DataSource;
  generatedAt: IsoTime;
}
