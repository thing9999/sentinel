"use client";

/** 이벤트 `/cluster/events` (docs/design/cluster-status.md 8절). 최근 1시간 Warning. cluster 토픽. */
import { useMemo, useState } from "react";

import {
  DataTable,
  EmptyState,
  FilterBar,
  formatCount,
  formatTime,
  InlineAlert,
  MultiSelect,
  PageHeader,
  SearchInput,
  Switch,
} from "@/components/ui";

import { useUrlQuery } from "../common/hooks";
import { useStableOrder } from "../common/useStableOrder";
import { badgeProps, reasonTexts } from "../stream/stale";
import { compareEventsDefault, includesQuery, parseList, parseSort, sortRows } from "./selectors";
import { clusterUnknownReason, eventColumns, useClusterView } from "./shared";
import type { EventItem } from "./types";

const TOPICS = ["cluster"] as const;
const MESSAGE_PREVIEW = 160;

export function EventsPage() {
  const q = useUrlQuery();
  const { stream, now, watch, cluster, clusterUnavailable } = useClusterView(TOPICS);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [hover, setHover] = useState(false);

  const severeOnly = q.get("severeOnly") === "true";
  const namespaces = parseList(q.get("namespace"));
  const kinds = parseList(q.get("kind"));
  const reasons = parseList(q.get("reason"));
  const search = q.get("q") ?? "";
  const sort = parseSort(q.get("sort"));

  const all = useMemo(() => (cluster ? Object.values(cluster.events) : []), [cluster]);
  const facets = useMemo(
    () => ({
      ns: [...new Set(all.map((e) => e.namespace).filter((x): x is string => Boolean(x)))].sort(),
      kinds: [...new Set(all.map((e) => e.involvedObject.kind))].sort(),
      reasons: [...new Set(all.map((e) => e.reason))].sort(),
    }),
    [all],
  );
  const filtered = all.filter(
    (e) =>
      (!severeOnly || e.severe) &&
      (namespaces.length === 0 || (e.namespace !== null && namespaces.includes(e.namespace))) &&
      (kinds.length === 0 || kinds.includes(e.involvedObject.kind)) &&
      (reasons.length === 0 || reasons.includes(e.reason)) &&
      includesQuery(search, e.involvedObject.name, e.reason, e.message),
  );
  const sorted = sortRows(
    filtered,
    sort,
    { lastSeenAt: (e) => e.lastSeenAt, count: (e) => e.count, namespace: (e) => e.namespace },
    compareEventsDefault,
  );
  const stable = useStableOrder(sorted, (e) => e.key, hover || expanded.length > 0);

  const columns = eventColumns({ now }).map((c) =>
    c.id === "message"
      ? {
          ...c,
          render: (e: EventItem) => (
            <span title={e.message}>{e.message.length > MESSAGE_PREVIEW ? `${e.message.slice(0, MESSAGE_PREVIEW)}…` : e.message}</span>
          ),
        }
      : c,
  );

  const area = cluster?.areas.events.status ?? stream.overview?.areas.events.status;
  const state = clusterUnavailable ? "unknown" : !cluster ? "loading" : all.length === 0 ? "empty" : filtered.length === 0 ? "filteredEmpty" : "ready";
  const reset = () => q.set({ severeOnly: null, namespace: null, kind: null, reason: null, q: null });
  const isDefault = !severeOnly && !namespaces.length && !kinds.length && !reasons.length && !search;

  return (
    <>
      <PageHeader title="이벤트" status={area ? { ...badgeProps(area, watch), reason: reasonTexts(area) } : undefined} />
      <div className="page-stack">
        <InlineAlert tone="info" compact title="쿠버네티스는 이벤트를 1시간만 보관합니다." />
        <FilterBar
          label="이벤트 필터"
          resultText={cluster ? `이벤트 ${formatCount(all.length)}개 중 ${formatCount(filtered.length)}개 표시` : undefined}
          onReset={isDefault ? undefined : reset}
        >
          <Switch label="심각 reason만" checked={severeOnly} onChange={(v) => q.set({ severeOnly: v ? "true" : null })} />
          <MultiSelect label="네임스페이스" value={namespaces} onChange={(v) => q.set({ namespace: v.join(",") })} options={facets.ns.map((n) => ({ value: n, label: n }))} />
          <MultiSelect label="대상 종류" value={kinds} onChange={(v) => q.set({ kind: v.join(",") })} options={facets.kinds.map((k) => ({ value: k, label: k }))} />
          <MultiSelect label="reason" value={reasons} onChange={(v) => q.set({ reason: v.join(",") })} options={facets.reasons.map((r) => ({ value: r, label: r }))} />
          <SearchInput value={search} onChange={(v) => q.set({ q: v })} placeholder="대상·reason·message" label="이벤트 검색" />
        </FilterBar>
        {state === "empty" ? (
          <EmptyState size="lg" icon="circle-check" iconTone="ok" title="최근 1시간 Warning 이벤트가 없습니다" />
        ) : (
          <DataTable
            caption="Warning 이벤트"
            columns={columns}
            rows={stable.rows}
            rowKey={(e) => e.key}
            sort={sort}
            onSortChange={(s) => q.set({ sort: s ? `${s.columnId}:${s.dir}` : null })}
            rowAccent={(e) => (e.severe ? "crit" : undefined)}
            rowStale={() => watch.stale}
            expandable={{
              expandedKeys: expanded,
              onToggle: (k) => setExpanded((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k])),
              render: (e) => (
                <div className="stack-sm">
                  <p className="text-mono" style={{ margin: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                    {e.message}
                  </p>
                  <p className="text-caption" style={{ margin: 0 }} suppressHydrationWarning>
                    처음 {formatTime(e.firstSeenAt, "auto")} · {e.sourceComponent ?? "출처 없음"}
                  </p>
                </div>
              ),
            }}
            state={state}
            unknownReason={`알 수 없음 (${clusterUnknownReason(stream)})`}
            unknownHint="kubeconfig를 확인하세요"
            filteredEmptyText="필터 조건에 맞는 이벤트가 없습니다"
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
