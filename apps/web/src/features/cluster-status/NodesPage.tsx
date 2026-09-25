"use client";

/** 노드 목록 `/cluster/nodes` (docs/design/cluster-status.md 3절). 데이터: cluster·metrics 토픽. */
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  ButtonLink,
  Chip,
  DataTable,
  EmptyState,
  FilterBar,
  formatCount,
  formatPercent,
  Icon,
  InlineAlert,
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
import { ControlPlaneSection, CONTROL_PLANE_ANCHOR } from "./ControlPlaneSection";
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
  parseRoleFilter,
  parseSort,
  parseStatusFilter,
  reasonStatus,
  sortRows,
  splitByRole,
  type NodeRoleFilter,
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

/** 역할 전환 (cluster-status.md 3.3.1). 기본 `worker` — "총 N대"가 개요·비용과 같은 뜻이 되게 한다 */
const ROLE_LABEL: Record<NodeRoleFilter, string> = { worker: "워커", control_plane: "컨트롤 플레인", all: "전체" };
/** 결과 문구용 명사 (`워커 6개 중 6개 표시`) */
const ROLE_NOUN: Record<NodeRoleFilter, string> = { worker: "워커", control_plane: "컨트롤 플레인", all: "노드" };

/** 디자인 3.3.3. **워커 0대**가 전체 장애 판단의 근거다(AC-KOPS14) — 마스터 대수와 섞지 않는다 */
const EMPTY_TITLE: Record<NodeRoleFilter, string> = {
  worker: "워커 노드가 없습니다",
  control_plane: "컨트롤 플레인 노드를 찾을 수 없습니다",
  all: "노드가 없습니다",
};
const EMPTY_DESCRIPTION: Record<NodeRoleFilter, string> = {
  worker:
    "워커 노드가 없거나 모두 NotReady이면 워크로드가 실행되지 않습니다. 컨트롤 플레인은 역할 필터에서 따로 확인하세요.",
  control_plane: "마스터 라벨이 붙은 노드가 없습니다. 컨트롤 플레인 상태는 개요 화면에서 확인하세요.",
  all: "클러스터에 Ready 노드가 없으면 모든 워크로드가 실행되지 않습니다.",
};
/** kOps InstanceGroup 안내 (명세 3.3 / D2) */
const NODE_GROUP_HELP =
  "kOps InstanceGroup 이름입니다(노드 라벨 kops.k8s.io/instancegroup). 목표 대수는 표시하지 않습니다 — 실제로 붙어 있는 노드만 셉니다.";

export function NodesPage() {
  const router = useRouter();
  const q = useUrlQuery();
  const { stream, now, watch, cluster, metrics, clusterUnavailable } = useClusterView(TOPICS);
  const [hover, setHover] = useState(false);

  const role = parseRoleFilter(q.get("role"));
  const statusFilter = parseStatusFilter(q.get("status"));
  const groups = parseList(q.get("nodeGroup"));
  const zones = parseList(q.get("zone"));
  const caps = parseList(q.get("capacityType"));
  const search = q.get("q") ?? "";
  const sort = parseSort(q.get("sort"));

  const everyNode = useMemo(() => (cluster ? Object.values(cluster.nodes) : []), [cluster]);
  /**
   * 역할 분류는 서버가 준 `NodeItem.role` 하나로만 한다(계약 8.2 — 스냅샷에 마스터가 함께 온다).
   * 역할 칸 개수는 같은 목록을 나눈 값이라 표에 그려지는 행 수와 항상 일치한다.
   */
  const byRole = useMemo(() => splitByRole(everyNode), [everyNode]);
  const all = byRole[role];
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
          {/* 역할 열을 따로 두지 않는다(디자인 3.3.2): 기본 필터가 워커라 열이 통째로 빈다 */}
          {role !== "worker" && n.role === "control_plane" ? <Chip label="컨트롤 플레인" icon="server-cog" /> : null}
          {n.unschedulable ? <Chip label="스케줄 제외" icon="ban" /> : null}
          {n.capacityType === "spot" ? <Chip label="스팟" icon="zap" /> : null}
        </span>
      ),
    },
    { id: "reason", header: "사유", minWidth: 200, render: (n) => <ReasonText reasons={reasonTexts(n.status)} status={badgeProps(n.status).status} /> },
    {
      id: "nodeGroup",
      header: (
        <Tooltip content={NODE_GROUP_HELP}>
          <span className="row">
            노드그룹
            <Icon name="circle-help" size={12} />
          </span>
        </Tooltip>
      ),
      width: 160,
      render: (n) => n.nodeGroup ?? "—",
    },
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

  /**
   * PageHeader 배지 = **워커 영역과 컨트롤 플레인 영역 중 최악**(디자인 3.1).
   * 그 합성은 서버가 이미 해 두었다(`nav.nodes`, 계약 2.1) — 화면은 값을 고르기만 하고 다시 계산하지 않는다.
   * 사유 문장도 그 값과 같은 영역의 서버 문장을 그대로 쓴다.
   */
  const workerArea = cluster?.areas.nodes.status ?? stream.overview?.areas.nodes.status;
  const cpArea = cluster?.areas.controlPlane?.status ?? stream.overview?.areas.controlPlane?.status;
  const navNodes = stream.overview?.nav.nodes;
  const area =
    navNodes === undefined
      ? workerArea
      : workerArea?.status === navNodes
        ? workerArea
        : (cpArea?.status === navNodes ? cpArea : workerArea);
  const areaStatus = area && navNodes ? { ...area, status: navNodes } : area;
  const state = clusterUnavailable ? "unknown" : !cluster ? "loading" : all.length === 0 ? "empty" : filtered.length === 0 ? "filteredEmpty" : "ready";
  const isDefault = statusFilter.length === 0 && !groups.length && !zones.length && !caps.length && !search;
  const sortState: SortState = sort;
  const resetFilters = () => q.set({ status: null, nodeGroup: null, zone: null, capacityType: null, q: null });
  // 역할을 바꾸면 그 역할에 없는 값이 남지 않도록 나머지 필터를 비운다(계약 3.1 facets)
  const changeRole = (v: string) =>
    q.set({ role: v === "worker" ? null : v, status: null, nodeGroup: null, zone: null, capacityType: null, q: null });
  const resultText = cluster ? `${ROLE_NOUN[role]} ${formatCount(all.length)}개 중 ${formatCount(filtered.length)}개 표시` : undefined;

  const cp = cluster?.controlPlane;
  const masterCount = cp?.found ? cp.masters.total : 0;

  return (
    <>
      <PageHeader title="노드" status={areaStatus ? { ...badgeProps(areaStatus, watch), reason: reasonTexts(areaStatus) } : undefined} />
      <div className="page-stack">
        <ControlPlaneSection
          cp={cp}
          thresholds={cluster?.thresholds.node}
          watch={watch}
          now={now}
          offsetMs={stream.serverOffsetMs}
          loading={!cluster && !clusterUnavailable}
          metricsOff={metricsOff}
        />
        <div className="row-between">
          <h2 className="text-h2">워커 노드</h2>
          {masterCount > 0 ? (
            <ButtonLink href={`#${CONTROL_PLANE_ANCHOR}`} variant="ghost" size="sm" icon="arrow-up">
              컨트롤 플레인 {formatCount(masterCount)}대 보기
            </ButtonLink>
          ) : null}
        </div>
        {role !== "worker" ? (
          <InlineAlert
            tone="info"
            compact
            title="컨트롤 플레인 상세(구성요소·쿼럼)는 위 섹션에 있습니다."
            action={
              <a href={`#${CONTROL_PLANE_ANCHOR}`} className="text-link">
                위로 가기
              </a>
            }
          />
        ) : null}
        <FilterBar
          label="노드 필터"
          resultText={resultText}
          onReset={isDefault ? undefined : resetFilters}
        >
          <SegmentedControl
            label="역할"
            value={role}
            onChange={changeRole}
            options={[
              { value: "worker", label: ROLE_LABEL.worker, count: byRole.worker.length },
              { value: "control_plane", label: ROLE_LABEL.control_plane, count: byRole.control_plane.length },
              { value: "all", label: ROLE_LABEL.all, count: byRole.all.length },
            ]}
          />
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
            title={EMPTY_TITLE[role]}
            description={EMPTY_DESCRIPTION[role]}
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
            onResetFilters={resetFilters}
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
