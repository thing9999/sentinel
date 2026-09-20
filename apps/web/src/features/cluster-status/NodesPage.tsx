"use client";

/** 노드 목록 `/cluster/nodes` (docs/design/cluster-status.md 3절). 데이터: cluster·metrics 토픽. */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Chip,
  DataTable,
  EmptyState,
  FilterBar,
  formatCount,
  formatPercent,
  Icon,
  MultiSelect,
  PageHeader,
  ReasonText,
  ResourceName,
  SearchInput,
  SegmentedControl,
  StatusIcon,
  Tooltip,
  UsageBar,
  type Column,
  type SortState,
} from "@/components/ui";

import { useUrlQuery } from "../common/hooks";
import { useStableOrder } from "../common/useStableOrder";
import { badgeProps, reasonTexts } from "../stream/stale";
import {
  compareNodesDefault,
  countByStatus,
  includesQuery,
  matchesStatus,
  nodeHref,
  nodeUsage,
  parseList,
  parseSort,
  parseStatusFilter,
  reasonStatus,
  sortRows,
} from "./selectors";
import { clusterUnknownReason, elapsedText, RowBadge, useClusterView } from "./shared";
import type { NodeItem } from "./types";

const TOPICS = ["cluster", "metrics"] as const;

export const STATUS_SEGMENTS = [
  { value: "all", label: "전체" },
  { value: "crit", label: "장애", status: "crit" as const },
  { value: "warn", label: "주의", status: "warn" as const },
  { value: "ok", label: "정상", status: "ok" as const },
  { value: "unknown", label: "알 수 없음", status: "unknown" as const },
];

export function statusSegmentValue(filter: string[]): string {
  if (filter.length === 0) return "all";
  if (filter.length === 1) return filter[0];
  return "";
}

const CAPACITY_LABEL: Record<string, string> = { on_demand: "온디맨드", spot: "스팟" };

export function NodesPage() {
  const router = useRouter();
  const q = useUrlQuery();
  const { stream, now, watch, cluster, metrics, clusterUnavailable } = useClusterView(TOPICS);
  const [hover, setHover] = useState(false);

  const statusFilter = parseStatusFilter(q.get("status"));
  const groups = parseList(q.get("nodeGroup"));
  const zones = parseList(q.get("zone"));
  const caps = parseList(q.get("capacityType"));
  const search = q.get("q") ?? "";
  const sort = parseSort(q.get("sort"));

  const all = useMemo(() => (cluster ? Object.values(cluster.nodes) : []), [cluster]);
  const facets = useMemo(() => {
    const g = new Set<string>();
    const z = new Set<string>();
    const c = new Set<string>();
    for (const n of all) {
      if (n.nodeGroup) g.add(n.nodeGroup);
      if (n.zone) z.add(n.zone);
      if (n.capacityType) c.add(n.capacityType);
    }
    return { groups: [...g].sort(), zones: [...z].sort(), caps: [...c].sort() };
  }, [all]);

  const base = all.filter(
    (n) =>
      (groups.length === 0 || (n.nodeGroup !== null && groups.includes(n.nodeGroup))) &&
      (zones.length === 0 || (n.zone !== null && zones.includes(n.zone))) &&
      (caps.length === 0 || (n.capacityType !== null && caps.includes(n.capacityType))) &&
      includesQuery(search, n.name),
  );
  const counts = countByStatus(base, (n) => n.status);
  const filtered = base.filter((n) => matchesStatus(n.status, statusFilter));
  const sorted = sortRows(
    filtered,
    sort,
    {
      status: (n) => n.name,
      name: (n) => n.name,
      cpuPct: (n) => nodeUsage(n, metrics)?.cpuPct ?? null,
      memoryPct: (n) => nodeUsage(n, metrics)?.memoryPct ?? null,
      podsPct: (n) => n.pods.pct,
      createdAt: (n) => n.createdAt,
    },
    compareNodesDefault,
  );
  const stable = useStableOrder(sorted, (n) => n.name, hover);

  const th = cluster?.thresholds.node;
  const metricsOff = metrics !== null && !metrics.cluster.available;
  const metricsHeader = (label: string) =>
    metricsOff ? (
      <Tooltip content="metrics-server 없음">
        <span className="row">
          {label}
          <Icon name="circle-help" size={12} />
        </span>
      </Tooltip>
    ) : (
      label
    );

  const columns: Column<NodeItem>[] = [
    { id: "status", header: "상태", width: 112, render: (n) => <RowBadge info={n.status} mark={watch} /> },
    {
      id: "name",
      header: "이름",
      minWidth: 200,
      maxWidth: 280,
      sortable: true,
      render: (n) => (
        <span className="row">
          <ResourceName name={n.name} kind="node" maxWidth={200} />
          {n.unschedulable ? <Chip label="스케줄 제외" icon="ban" /> : null}
          {n.capacityType === "spot" ? <Chip label="스팟" icon="zap" /> : null}
        </span>
      ),
    },
    { id: "reason", header: "사유", minWidth: 200, render: (n) => <ReasonText reasons={reasonTexts(n.status)} status={badgeProps(n.status).status} /> },
    { id: "nodeGroup", header: "노드그룹", width: 140, render: (n) => n.nodeGroup ?? "—" },
    { id: "instanceType", header: "인스턴스 타입", width: 112, render: (n) => <span className="text-mono">{n.instanceType ?? "—"}</span> },
    { id: "zone", header: "AZ", width: 120, hideBelow: 1280, render: (n) => n.zone ?? "—" },
    {
      id: "cpuPct",
      header: metricsHeader("CPU"),
      width: 140,
      sortable: true,
      render: (n) => {
        const u = nodeUsage(n, metrics);
        if (!u) return "—";
        return (
          <UsageBar
            size="sm"
            value={u.cpuPct / 100}
            status={reasonStatus(n.status, ["NODE_CPU_USAGE"])}
            warnAt={th ? th.cpu.warnPct / 100 : undefined}
            critAt={th?.cpu.critPct ? th.cpu.critPct / 100 : undefined}
            label={formatPercent(u.cpuPct / 100)}
            name="CPU 사용률"
          />
        );
      },
    },
    {
      id: "memoryPct",
      header: metricsHeader("메모리"),
      width: 140,
      sortable: true,
      render: (n) => {
        const u = nodeUsage(n, metrics);
        if (!u) return "—";
        return (
          <UsageBar
            size="sm"
            value={u.memoryPct / 100}
            status={reasonStatus(n.status, ["NODE_MEMORY_USAGE"])}
            warnAt={th ? th.memory.warnPct / 100 : undefined}
            critAt={th?.memory.critPct ? th.memory.critPct / 100 : undefined}
            label={formatPercent(u.memoryPct / 100)}
            name="메모리 사용률"
          />
        );
      },
    },
    {
      id: "requests",
      header: "requests",
      width: 120,
      render: (n) => {
        const warnAt = th?.requests.warnPct;
        return (
          <span className="row text-caption">
            {warnAt !== undefined && n.requests.cpuPct >= warnAt ? <StatusIcon status="warn" size={12} /> : null}
            CPU {formatPercent(n.requests.cpuPct / 100)} · Mem {formatPercent(n.requests.memoryPct / 100)}
          </span>
        );
      },
    },
    { id: "podsPct", header: "파드", width: 80, numeric: true, sortable: true, render: (n) => `${formatCount(n.pods.count)}/${formatCount(n.pods.max)}` },
    {
      id: "createdAt",
      header: "경과",
      width: 72,
      numeric: true,
      sortable: true,
      hideBelow: 1280,
      render: (n) => <span suppressHydrationWarning>{elapsedText(n.createdAt, now, stream.serverOffsetMs)}</span>,
    },
  ];

  const area = cluster?.areas.nodes.status ?? stream.overview?.areas.nodes.status;
  const state = clusterUnavailable ? "unknown" : !cluster ? "loading" : all.length === 0 ? "empty" : filtered.length === 0 ? "filteredEmpty" : "ready";
  const isDefault = statusFilter.length === 0 && !groups.length && !zones.length && !caps.length && !search;
  const sortState: SortState = sort;

  return (
    <>
      <PageHeader title="노드" status={area ? { ...badgeProps(area, watch), reason: reasonTexts(area) } : undefined} />
      <div className="page-stack">
        <FilterBar
          label="노드 필터"
          resultText={cluster ? `노드 ${formatCount(all.length)}개 중 ${formatCount(filtered.length)}개 표시` : undefined}
          onReset={isDefault ? undefined : () => q.set({ status: null, nodeGroup: null, zone: null, capacityType: null, q: null })}
        >
          <SegmentedControl
            label="상태"
            value={statusSegmentValue(statusFilter)}
            onChange={(v) => q.set({ status: v === "all" ? null : v })}
            options={STATUS_SEGMENTS.map((s) => ({ ...s, count: counts[s.value as keyof typeof counts] }))}
          />
          <MultiSelect label="노드그룹" value={groups} onChange={(v) => q.set({ nodeGroup: v.join(",") })} options={facets.groups.map((g) => ({ value: g, label: g }))} />
          <MultiSelect label="AZ" value={zones} onChange={(v) => q.set({ zone: v.join(",") })} options={facets.zones.map((z) => ({ value: z, label: z }))} />
          <MultiSelect
            label="구매 옵션"
            value={caps}
            onChange={(v) => q.set({ capacityType: v.join(",") })}
            options={facets.caps.map((c) => ({ value: c, label: CAPACITY_LABEL[c] ?? c }))}
          />
          <SearchInput value={search} onChange={(v) => q.set({ q: v })} placeholder="노드 이름 검색" label="노드 검색" />
        </FilterBar>
        {state === "empty" ? (
          <EmptyState
            size="lg"
            icon="server-crash"
            title="노드가 없습니다"
            description="클러스터에 Ready 노드가 없으면 모든 워크로드가 실행되지 않습니다."
          />
        ) : (
          <DataTable
            caption="노드 목록"
            columns={columns}
            rows={stable.rows}
            rowKey={(n) => n.name}
            sort={sortState}
            onSortChange={(s) => q.set({ sort: s ? `${s.columnId}:${s.dir}` : null })}
            rowStatus={(n) => badgeProps(n.status).status}
            rowStale={() => watch.stale}
            onRowClick={(n) => router.push(nodeHref(n.name))}
            state={state}
            unknownReason={`알 수 없음 (${cluster ? clusterUnknownReason(stream) : "클러스터 연결 없음"})`}
            unknownHint="kubeconfig를 확인하세요"
            onResetFilters={() => q.set({ status: null, nodeGroup: null, zone: null, capacityType: null, q: null })}
            filteredEmptyText="필터 조건에 맞는 노드가 없습니다"
            pendingReorder={stable.pending || undefined}
            onApplyReorder={stable.apply}
            onHoverChange={setHover}
            loadingRows={6}
          />
        )}
      </div>
    </>
  );
}
