"use client";

/**
 * 앱 셸 (docs/design/shell.md, publisher 보고서 9.1). 상태를 가진 클라이언트 래퍼:
 * 테마, 내비 접힘·드로어, 전역 연결 상태(배너 5초 지연·재시도 카운트다운), MOCK 배지 시나리오.
 */
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import {
  AppShell,
  Banner,
  ConnectionBanner,
  ConnectionIndicator,
  ErrorState,
  SideNav,
  ThemeMenu,
  TopBar,
  type ScenarioGroupId,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";
import { getApiBaseUrl } from "@/lib/api";

import { deriveConnectionView } from "../stream/connection-view";
import { useStreamClient, useStreamStore } from "../stream/StreamProvider";
import { STALE_AFTER_MS, watchStale } from "../stream/stale";
import { toBadgeScenarios, useMockScenarios } from "./mock-scenarios";
import { navItemsFromOverview } from "./nav";
import { navStore, themeStore } from "./theme";

export function ShellClient({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const client = useStreamClient();
  const { stream, connection } = useStreamStore();
  const now = useNow(1000);
  const view = deriveConnectionView(connection, now);

  const theme = useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.getServer);
  const collapsed = useSyncExternalStore(navStore.subscribe, navStore.get, navStore.getServer);
  const [navOpenPath, setNavOpenPath] = useState<string | null>(null);
  // 페이지를 옮기면 드로어를 닫는다 (열린 경로가 현재 경로와 다르면 닫힌 것으로 본다)
  const navOpen = navOpenPath === pathname;

  const overview = stream.overview;
  const dataSource = stream.dataSource;
  const mock = useMockScenarios(dataSource === "mock");
  const scenarios = dataSource === "mock" ? toBadgeScenarios(mock.data?.groups) : undefined;

  const cluster = overview
    ? overview.cluster.connected && overview.cluster.name
      ? {
          name: overview.cluster.name,
          version: overview.cluster.version ?? undefined,
          region: overview.cluster.region ?? undefined,
        }
      : null
    : null;

  const lastEventIso = stream.lastEventAt ? new Date(stream.lastEventAt).toISOString() : null;
  // 스냅샷 메뉴는 kube 출처와 무관하다: heartbeat 무수신만 끊김으로 본다 (서버 stale 은 menu.status.stale)
  const heartbeatStale = stream.lastHeartbeatAt !== null && now - stream.lastHeartbeatAt > STALE_AFTER_MS.watch;
  const navItems = navItemsFromOverview(
    overview?.nav,
    watchStale(stream, now).stale && Boolean(overview),
    stream.snapshotMenu?.menu,
    heartbeatStale && Boolean(stream.snapshotMenu),
  );

  // 최초 연결이 한 번도 안 됐고 API 가 응답하지 않으면 페이지 전체 ErrorState (shell.md 5절)
  const apiDownFirst = !connection.everOpened && connection.apiReachable === false;

  // UI 미리보기(/dev/ui)는 자체 셸을 그리므로 앱 셸 없이 보여 준다
  if (pathname.startsWith("/dev/ui")) return <>{children}</>;

  return (
    <AppShell
      navOpen={navOpen}
      onNavClose={() => setNavOpenPath(null)}
      topBar={
        <TopBar
          cluster={cluster}
          clusterLoading={!overview && !apiDownFirst}
          dataSource={dataSource}
          scenarios={scenarios && scenarios.length > 0 ? scenarios : undefined}
          onScenarioChange={(group: ScenarioGroupId, id: string) => void mock.change(group, id)}
          connection={
            <ConnectionIndicator
              key={connection.reconnectedAt ?? 0}
              status={view.indicator}
              lastEventAt={lastEventIso}
              retryCount={view.retryCount}
              justReconnected={view.justReconnected}
            />
          }
          themeToggle={<ThemeMenu value={theme} onChange={(v) => themeStore.set(v)} />}
          onMenuClick={() => setNavOpenPath((p) => (p === pathname ? null : pathname))}
          menuOpen={navOpen}
        />
      }
      banner={
        view.showBanner ? (
          <ConnectionBanner
            lastEventAt={lastEventIso}
            retryCount={view.retryCount}
            nextRetryInMs={view.nextRetryInMs}
            message={view.bannerMessage}
            onRetryNow={() => client.reconnectNow()}
          />
        ) : null
      }
      nav={
        <SideNav
          items={navItems}
          currentPath={pathname}
          collapsed={collapsed}
          onToggleCollapsed={() => navStore.set(!collapsed)}
        />
      }
    >
      {mock.error ? (
        <Banner
          tone="warn"
          title="mock 시나리오 전환 실패"
          description={mock.error}
          dismissible
          onDismiss={mock.clearError}
        />
      ) : null}
      {apiDownFirst ? (
        <ErrorState
          size="lg"
          title="API 서버에 연결할 수 없습니다"
          detail="network"
          description={`${getApiBaseUrl()} 응답 없음 · 자동으로 다시 시도합니다`}
          onRetry={() => client.reconnectNow()}
          retryLabel="지금 다시 시도"
        />
      ) : (
        children
      )}
    </AppShell>
  );
}
