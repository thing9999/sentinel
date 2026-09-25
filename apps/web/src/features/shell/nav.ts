/**
 * 사이드바 상태 점 (shell.md 3.1): GET /api/overview 의 `nav` → SideNav items.
 * 서버가 준 상태를 그대로 쓰고(계산 없음), `nav.stale.*` 이면 stale 로 교체한다.
 * "스냅샷"(`/snapshots`, AWS + Kubernetes)은 overview 가 아니라 `snapshot-menu` 토픽으로 그린다
 * (docs/api/k8s-snapshot.md 12절: 서버 합산, 드리프트 미반영, 클러스터 전체 상태와 분리).
 */
import { DEFAULT_NAV_ITEMS, statusFromApi, type NavItem } from "@/components/ui";

import { ALERTS_HREF, alertsNavPatch } from "../alerts/badge";
import type { AlertBadge } from "../alerts/types";
import type { NavKey, OverviewResponse } from "../cluster-status/types";
import type { SnapshotMenu } from "../snapshot-menu/types";

const HREF_TO_KEY: Record<string, NavKey> = {
  "/": "overview",
  "/cluster/nodes": "nodes",
  "/cluster/workloads": "workloads",
  "/cluster/pods": "pods",
  "/cluster/events": "events",
  "/cluster/db": "db",
  "/cost": "cost",
  "/advisor": "advisor",
};

export const SNAPSHOTS_HREF = "/snapshots";
export const LOGS_HREF = "/logs";

/**
 * 스냅샷 메뉴 (k8s-snapshot.md 2.1, 계약 12.1, AC-K16).
 * - 상태 = 서버 `menu.status`(AWS·k8s 파일 상태 중 최악). crit 일 때만 문구 `커밋 금지`.
 * - 숫자 = 서버 `menu.count`(양쪽 커밋 금지 수 합), 0 이면 없음. 화면이 더하지 않는다.
 * - `showIcon: false`(둘 다 설정 없음)면 아이콘·숫자를 그리지 않는다.
 * - 서버 stale 이거나 스트림이 끊겼으면 stale.
 */
export function snapshotMenuNavPatch(menu: SnapshotMenu | null | undefined, streamDown = false): Partial<NavItem> {
  if (!menu || !menu.showIcon) return { status: undefined, count: undefined, statusLabel: undefined };
  const base = statusFromApi(menu.status.status);
  const stale = menu.status.stale || streamDown;
  const count = menu.count > 0 ? menu.count : undefined;
  return {
    status: stale ? "stale" : base,
    statusLabel: !stale && base === "crit" ? "커밋 금지" : undefined,
    count: stale ? undefined : count,
  };
}

export interface AlertsNavInput {
  badge: AlertBadge;
  loaded: boolean;
  streamDown: boolean;
}

export function navItemsFromOverview(
  nav: OverviewResponse["nav"] | null | undefined,
  streamDown = false,
  snapshotMenu?: SnapshotMenu | null,
  snapshotsStreamDown = false,
  alerts?: AlertsNavInput,
  /** `GET /api/logs/capabilities`의 `enabled`. `false`면 `로그` 항목을 **감춘다**(logs.md 0절). 모르면 그대로 둔다 */
  logsEnabled?: boolean | null,
): NavItem[] {
  return DEFAULT_NAV_ITEMS.filter((item) => item.href !== LOGS_HREF || logsEnabled !== false).map((item) => {
    if (item.href === SNAPSHOTS_HREF) return { ...item, ...snapshotMenuNavPatch(snapshotMenu, snapshotsStreamDown) };
    // `알림`·`로그`는 상태 점이 없다(shell.md 3.1). 알림만 숫자 배지를 서버 값 그대로 붙인다
    if (item.href === ALERTS_HREF) {
      return alerts ? { ...item, ...alertsNavPatch(alerts.badge, alerts.loaded, alerts.streamDown) } : item;
    }
    if (!nav) return item;
    const key = HREF_TO_KEY[item.href];
    if (!key) return item;
    const apiStatus = nav[key];
    const stale = key !== "overview" && (nav.stale?.[key as Exclude<NavKey, "overview">] ?? false);
    return {
      ...item,
      status: stale || streamDown ? "stale" : statusFromApi(apiStatus),
      busy: key === "advisor" ? Boolean(nav.advisorBusy) : undefined,
    };
  });
}

/** 개요(`/`) 이외에 `/cluster` 는 개요로 이동한다(shell.md 3.1) */
export const CLUSTER_REDIRECT = "/";
