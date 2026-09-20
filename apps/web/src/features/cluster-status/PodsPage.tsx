"use client";

/** 파드 목록 `/cluster/pods` (docs/design/cluster-status.md 6절). 수백 행 → 가상 스크롤. cluster·metrics 토픽. */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Chip,
  DataTable,
  EmptyState,
  FilterBar,
  formatCount,
  MultiSelect,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Switch,
} from "@/components/ui";

import { useUrlQuery } from "../common/hooks";
import { useStableOrder } from "../common/useStableOrder";
import { badgeProps, reasonTexts } from "../stream/stale";
import { STATUS_SEGMENTS, statusSegmentValue } from "./NodesPage";
import {
  comparePodsDefault,
  countByStatus,
  includesQuery,
  matchesStatus,
  parseList,
  parseSort,
  parseStatusFilter,
  podHref,
  sortRows,
} from "./selectors";
import { clusterUnknownReason, podColumns, podSortAccessors, useClusterView } from "./shared";

const TOPICS = ["cluster", "metrics"] as const;
const VIRTUALIZE_OVER = 200;

export function PodsPage() {
  const router = useRouter();
  const q = useUrlQuery();
  const { stream, now, watch, cluster, metrics, clusterUnavailable } = useClusterView(TOPICS);
  const [hover, setHover] = useState(false);

  const statusFilter = parseStatusFilter(q.get("status"));
  const namespaces = parseList(q.get("namespace"));
  const hideSystem = q.get("hideSystem") === "true";
  const showCompleted = q.get("showCompleted") === "true";
  const node = q.get("node");
  const workload = q.get("workload");
  const search = q.get("q") ?? "";
  const sort = parseSort(q.get("sort"));

  const all = useMemo(() => (cluster ? Object.values(cluster.pods) : []), [cluster]);
  const nsFacet = useMemo(() => [...new Set(all.map((p) => p.namespace))].sort(), [all]);
  const visibleAll = all.filter((p) => showCompleted || !p.completed);

  const base = visibleAll.filter(
    (p) =>
      (namespaces.length === 0 || namespaces.includes(p.namespace)) &&
      (!hideSystem || !p.isSystemNamespace) &&
      (!node || p.nodeName === node) &&
      (!workload || p.owner?.workloadKey === workload) &&
      includesQuery(search, p.name, p.nodeName, p.owner?.name),
  );
  const counts = countByStatus(base, (p) => p.status);
  const filtered = base.filter((p) => matchesStatus(p.status, statusFilter));
  const sorted = sortRows(filtered, sort, podSortAccessors, comparePodsDefault);
  const stable = useStableOrder(sorted, (p) => p.key, hover);

  const obs = cluster?.restartObservation;
  const observedMinutes = obs && !obs.fullWindow ? Math.floor(obs.observedSec / 60) : null;
  const area = cluster?.areas.pods.status ?? stream.overview?.areas.pods.status;
  const state = clusterUnavailable
    ? "unknown"
    : !cluster
      ? "loading"
      : visibleAll.length === 0
        ? "empty"
        : filtered.length === 0
          ? "filteredEmpty"
          : "ready";
  const reset = () => q.set({ status: null, namespace: null, hideSystem: null, showCompleted: null, q: null, node: null, workload: null });
  const isDefault = !statusFilter.length && !namespaces.length && !hideSystem && !showCompleted && !search && !node && !workload;

  return (
    <>
      <PageHeader
        title="파드"
        status={area ? { ...badgeProps(area, watch), reason: reasonTexts(area) } : undefined}
        chips={
          <>
            {node ? <Chip label={`노드: ${node}`} mono onRemove={() => q.set({ node: null })} /> : null}
            {workload ? <Chip label={`워크로드: ${workload}`} mono onRemove={() => q.set({ workload: null })} /> : null}
          </>
        }
      />
      <div className="page-stack">
        <FilterBar
          label="파드 필터"
          resultText={cluster ? `파드 ${formatCount(visibleAll.length)}개 중 ${formatCount(filtered.length)}개 표시` : undefined}
          onReset={isDefault ? undefined : reset}
        >
          <SegmentedControl
            label="상태"
            value={statusSegmentValue(statusFilter)}
            onChange={(v) => q.set({ status: v === "all" ? null : v })}
            options={STATUS_SEGMENTS.map((s) => ({ ...s, count: counts[s.value as keyof typeof counts] }))}
          />
          <MultiSelect label="네임스페이스" value={namespaces} width={180} onChange={(v) => q.set({ namespace: v.join(",") })} options={nsFacet.map((n) => ({ value: n, label: n }))} />
          <Switch label="시스템 숨기기" checked={hideSystem} onChange={(v) => q.set({ hideSystem: v ? "true" : null })} />
          <Switch label="완료된 파드 보기" checked={showCompleted} onChange={(v) => q.set({ showCompleted: v ? "true" : null })} />
          <SearchInput value={search} onChange={(v) => q.set({ q: v })} placeholder="이름·노드·워크로드" label="파드 검색" />
        </FilterBar>
        {state === "empty" ? (
          <EmptyState size="lg" icon="box" title="파드가 없습니다" />
        ) : (
          <DataTable
            caption="파드 목록"
            columns={podColumns({ now, offsetMs: stream.serverOffsetMs, metrics, thresholds: cluster?.thresholds, watch, observedMinutes })}
            rows={stable.rows}
            rowKey={(p) => p.key}
            sort={sort}
            onSortChange={(s) => q.set({ sort: s ? `${s.columnId}:${s.dir}` : null })}
            virtualized={stable.rows.length > VIRTUALIZE_OVER}
            height={stable.rows.length > VIRTUALIZE_OVER ? 640 : "auto"}
            rowStatus={(p) => badgeProps(p.status).status}
            rowStale={() => watch.stale}
            onRowClick={(p) => router.push(podHref(p.namespace, p.name))}
            state={state}
            unknownReason={`알 수 없음 (${clusterUnknownReason(stream)})`}
            unknownHint="kubeconfig를 확인하세요"
            filteredEmptyText="필터 조건에 맞는 파드가 없습니다"
            onResetFilters={reset}
            pendingReorder={stable.pending || undefined}
            onApplyReorder={stable.apply}
            onHoverChange={setHover}
          />
        )}
      </div>
    </>
  );
}
