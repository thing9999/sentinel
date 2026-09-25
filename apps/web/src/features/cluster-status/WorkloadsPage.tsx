"use client";

/** 워크로드 목록 `/cluster/workloads` (`?focus=kind/ns/name`) — docs/design/cluster-status.md 5절. cluster 토픽. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  Chip,
  DataTable,
  DistributionBar,
  EmptyState,
  FilterBar,
  formatCount,
  formatRelative,
  KeyValueList,
  MultiSelect,
  PageHeader,
  ReasonText,
  ResourceName,
  SearchInput,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  StatusIcon,
  Switch,
  type Column,
} from "@/components/ui";

import { useApi, useUrlQuery } from "../common/hooks";
import { useStableOrder } from "../common/useStableOrder";
import { LogLink } from "../logs/LogLink";
import type { StreamState } from "../stream/reducer";
import { badgeProps, reasonTexts, type StaleMark } from "../stream/stale";
import { STATUS_SEGMENTS, statusSegmentValue } from "./NodesPage";
import {
  compareWorkloadsDefault,
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
import { clusterUnknownReason, podColumns, useClusterView } from "./shared";
import type { WorkloadDetailResponse, WorkloadItem } from "./types";

const TOPICS = ["cluster"] as const;
const KIND_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "Deployment", label: "Deployment" },
  { value: "StatefulSet", label: "StatefulSet" },
  { value: "DaemonSet", label: "DaemonSet" },
];

export function WorkloadsPage() {
  const q = useUrlQuery();
  const { stream, now, watch, cluster, clusterUnavailable } = useClusterView(TOPICS);
  const focus = q.get("focus");
  const [expanded, setExpanded] = useState<string[]>(() => (focus ? [focus] : []));
  const [hover, setHover] = useState(false);

  const statusFilter = parseStatusFilter(q.get("status"));
  const kind = q.get("kind") ?? "all";
  const namespaces = parseList(q.get("namespace"));
  const hideSystem = q.get("hideSystem") === "true";
  const search = q.get("q") ?? "";
  const sort = parseSort(q.get("sort"));

  const all = useMemo(() => (cluster ? Object.values(cluster.workloads) : []), [cluster]);
  const nsFacet = useMemo(() => [...new Set(all.map((w) => w.namespace))].sort(), [all]);
  const base = all.filter(
    (w) =>
      (kind === "all" || w.kind === kind) &&
      (namespaces.length === 0 || namespaces.includes(w.namespace)) &&
      (!hideSystem || !w.isSystemNamespace) &&
      includesQuery(search, w.name, ...w.images),
  );
  const counts = countByStatus(base, (w) => w.status);
  const filtered = base.filter((w) => matchesStatus(w.status, statusFilter));
  const sorted = sortRows(
    filtered,
    sort,
    { namespace: (w) => w.namespace, name: (w) => w.name, kind: (w) => w.kind, lastRolloutAt: (w) => w.lastRolloutAt },
    compareWorkloadsDefault,
  );
  const stable = useStableOrder(sorted, (w) => w.key, hover || expanded.length > 0);

  // ?focus= 로 들어오면 해당 행을 화면 가운데로
  useEffect(() => {
    if (!focus || !cluster) return;
    const el = document.querySelector('tr[aria-current="true"]');
    if (el && "scrollIntoView" in el) (el as HTMLElement).scrollIntoView({ block: "center" });
  }, [focus, cluster]);

  const columns: Column<WorkloadItem>[] = [
    { id: "status", header: "상태", width: 112, render: (w) => <RowBadgeW w={w} mark={watch} /> },
    { id: "kind", header: "종류", width: 112, sortable: true, render: (w) => <span className="text-caption">{w.kind}</span> },
    {
      id: "namespace",
      header: "네임스페이스",
      width: 140,
      sortable: true,
      render: (w) => (
        <span className="row">
          {w.namespace}
          {w.isSystemNamespace ? <Chip label="시스템" icon="settings" /> : null}
        </span>
      ),
    },
    {
      id: "name",
      header: "이름",
      minWidth: 200,
      maxWidth: 320,
      sortable: true,
      render: (w) => (
        <span className="row">
          <ResourceName name={w.name} kind="workload" maxWidth={240} />
          {w.stopped ? <Chip label="중지됨" icon="pause" /> : null}
        </span>
      ),
    },
    {
      id: "ready",
      header: "준비",
      width: 88,
      numeric: true,
      render: (w) => {
        const b = badgeProps(w.status);
        const mismatch = w.replicas.desired !== null && w.replicas.ready !== w.replicas.desired;
        return (
          <span className="row">
            {mismatch && b.status !== "ok" ? <StatusIcon status={b.status} size={12} /> : null}
            {formatCount(w.replicas.ready)}/{w.replicas.desired === null ? "?" : formatCount(w.replicas.desired)}
          </span>
        );
      },
    },
    {
      id: "updated",
      header: "업데이트",
      width: 72,
      numeric: true,
      render: (w) => (w.replicas.updated === null ? "—" : `${formatCount(w.replicas.updated)}/${w.replicas.desired === null ? "?" : formatCount(w.replicas.desired)}`),
    },
    { id: "reason", header: "사유", minWidth: 200, render: (w) => <ReasonText reasons={reasonTexts(w.status)} status={badgeProps(w.status).status} /> },
    {
      id: "pods",
      header: "파드 분포",
      width: 120,
      render: (w) => (
        <DistributionBar
          label="파드 상태 분포"
          segments={[
            { value: w.podCounts.critical, status: "crit", label: "장애" },
            { value: w.podCounts.warning, status: "warn", label: "주의" },
            { value: w.podCounts.ok, status: "ok", label: "정상" },
            { value: w.podCounts.unknown, status: "unknown", label: "알 수 없음" },
          ]}
        />
      ),
    },
    {
      id: "image",
      header: "이미지",
      width: 200,
      hideBelow: 1280,
      render: (w) =>
        w.images.length ? (
          <span className="row">
            <ResourceName name={w.images[0]} kind="other" maxWidth={160} copyable={false} />
            {w.images.length > 1 ? <span className="text-caption-tertiary">외 {w.images.length - 1}</span> : null}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "lastRolloutAt",
      header: "마지막 롤아웃",
      width: 96,
      sortable: true,
      hideBelow: 1280,
      render: (w) => <span suppressHydrationWarning>{w.lastRolloutAt ? formatRelative(w.lastRolloutAt, now + stream.serverOffsetMs) : "—"}</span>,
    },
  ];

  const area = cluster?.areas.workloads.status ?? stream.overview?.areas.workloads.status;
  const state = clusterUnavailable ? "unknown" : !cluster ? "loading" : all.length === 0 ? "empty" : filtered.length === 0 ? "filteredEmpty" : "ready";
  const reset = () => q.set({ status: null, kind: null, namespace: null, hideSystem: null, q: null, focus: null });
  const isDefault = !statusFilter.length && kind === "all" && !namespaces.length && !hideSystem && !search;

  return (
    <>
      <PageHeader title="워크로드" status={area ? { ...badgeProps(area, watch), reason: reasonTexts(area) } : undefined} />
      <div className="page-stack">
        <FilterBar
          label="워크로드 필터"
          resultText={cluster ? `워크로드 ${formatCount(all.length)}개 중 ${formatCount(filtered.length)}개 표시` : undefined}
          onReset={isDefault ? undefined : reset}
        >
          <SegmentedControl
            label="상태"
            value={statusSegmentValue(statusFilter)}
            onChange={(v) => q.set({ status: v === "all" ? null : v })}
            options={STATUS_SEGMENTS.map((s) => ({ ...s, count: counts[s.value as keyof typeof counts] }))}
          />
          <SegmentedControl label="종류" value={kind} onChange={(v) => q.set({ kind: v === "all" ? null : v })} options={KIND_OPTIONS} />
          <MultiSelect label="네임스페이스" value={namespaces} onChange={(v) => q.set({ namespace: v.join(",") })} options={nsFacet.map((n) => ({ value: n, label: n }))} />
          <Switch label="시스템 숨기기" checked={hideSystem} onChange={(v) => q.set({ hideSystem: v ? "true" : null })} />
          <SearchInput value={search} onChange={(v) => q.set({ q: v })} placeholder="이름·이미지 검색" label="워크로드 검색" />
        </FilterBar>
        {state === "empty" ? (
          <EmptyState size="lg" icon="boxes" title="워크로드가 없습니다" />
        ) : (
          <DataTable
            caption="워크로드 목록"
            columns={columns}
            rows={stable.rows}
            rowKey={(w) => w.key}
            sort={sort}
            onSortChange={(s) => q.set({ sort: s ? `${s.columnId}:${s.dir}` : null })}
            rowStatus={(w) => badgeProps(w.status).status}
            rowStale={() => watch.stale}
            selectedKey={focus}
            expandable={{
              expandedKeys: expanded,
              onToggle: (k) => setExpanded((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k])),
              render: (w) => <WorkloadExpanded w={w} stream={stream} now={now} watch={watch} />,
            }}
            state={state}
            unknownReason={`알 수 없음 (${clusterUnknownReason(stream)})`}
            unknownHint="kubeconfig를 확인하세요"
            filteredEmptyText="필터 조건에 맞는 워크로드가 없습니다"
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

function RowBadgeW({ w, mark }: { w: WorkloadItem; mark: StaleMark }) {
  const b = badgeProps(w.status, mark);
  return <StatusBadge size="sm" {...b} reason={w.status.reasons[0]?.text} />;
}

function WorkloadExpanded({ w, stream, now, watch }: { w: WorkloadItem; stream: StreamState; now: number; watch: StaleMark }) {
  const router = useRouter();
  const detail = useApi<WorkloadDetailResponse>(
    `/cluster/workloads/${encodeURIComponent(w.kind)}/${encodeURIComponent(w.namespace)}/${encodeURIComponent(w.name)}`,
    undefined,
    w.status.statusChangedAt,
  );
  const cluster = stream.cluster;
  const pods = cluster
    ? Object.values(cluster.pods)
        .filter((p) => p.owner?.workloadKey === w.key && !p.completed)
        .sort(comparePodsDefault)
    : (detail.data?.pods ?? []);
  return (
    <div className="stack">
      <DataTable
        caption={`${w.name} 소속 파드`}
        density="compact"
        columns={podColumns({ now, offsetMs: stream.serverOffsetMs, metrics: stream.metrics, thresholds: cluster?.thresholds, watch, observedMinutes: null })}
        rows={pods.slice(0, 10)}
        rowKey={(p) => p.key}
        rowStatus={(p) => badgeProps(p.status).status}
        onRowClick={(p) => router.push(podHref(p.namespace, p.name))}
        state={pods.length ? "ready" : "empty"}
        emptyProps={{ icon: "box", title: "소속 파드가 없습니다" }}
      />
      <span className="row">
        <Link href={`/cluster/pods?workload=${encodeURIComponent(w.key)}`} className="text-link">
          파드 목록에서 보기 ({formatCount(pods.length)})
        </Link>
        {/* 진입점 5: 소속 파드 선택기가 붙은 로그 화면. 서버 `logHref`(workload=…&follow=1) 그대로 */}
        <LogLink href={w.logHref} label={`${w.kind} ${w.namespace}/${w.name} 로그 보기`} />
      </span>
      {detail.data ? (
        detail.data.conditions.length ? (
          <KeyValueList
            items={detail.data.conditions.map((c) => ({
              label: c.type,
              value: `${c.value ?? "—"}${c.reason ? ` · ${c.reason}` : ""}`,
              hint: c.message ?? undefined,
            }))}
          />
        ) : null
      ) : detail.loading ? (
        <Skeleton lines={2} />
      ) : null}
    </div>
  );
}
