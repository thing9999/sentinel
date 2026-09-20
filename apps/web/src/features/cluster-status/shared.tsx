"use client";

/**
 * cluster-status 화면 공용: 스트림 구독 훅, 파드·이벤트 표 열, 클러스터 연결 상태.
 */
import Link from "next/link";

import {
  Chip,
  formatBytes,
  formatCount,
  formatDurationTable,
  formatMillicores,
  formatPercent,
  formatTime,
  Icon,
  ReasonText,
  ResourceName,
  StatusBadge,
  StatusIcon,
  Tooltip,
  UsageBar,
  type Column,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";

import type { StreamTopic } from "../common/types";
import type { MetricsState } from "../stream/reducer";
import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { badgeProps, reasonTexts, watchStale, type StaleMark } from "../stream/stale";
import { hrefForRef, nodeHref, podUsage, reasonStatus } from "./selectors";
import type { ClusterThresholds, EventItem, PodItem } from "./types";

export function useClusterView(topics: readonly StreamTopic[]) {
  useTopics(topics);
  const { stream, connection } = useStreamStore();
  const now = useNow(1000);
  const watch = watchStale(stream, now);
  const kube = stream.sources.kube;
  /** 클러스터 연결 없음·조회 실패: 목록 대신 UnknownState */
  const clusterUnavailable = kube?.state === "not_configured" || kube?.state === "unavailable";
  const syncing = kube?.state === "syncing" || (stream.cluster !== null && !stream.cluster.sync.initialSyncDone);
  return { stream, connection, now, watch, cluster: stream.cluster, metrics: stream.metrics, clusterUnavailable, syncing };
}

/** 클러스터 연결 없음 사유 (서버 문자열 우선) */
export function clusterUnknownReason(stream: ReturnType<typeof useStreamStore>["stream"]): string {
  const r = stream.cluster?.areas.nodes.status.reasons[0]?.text ?? stream.overview?.areas.nodes.status.reasons[0]?.text;
  return r ?? stream.sources.kube?.error?.message ?? "클러스터 연결 없음";
}

/** 경과 시간 (서버 시각 보정) */
export function elapsedText(since: string | null | undefined, now: number, offsetMs: number): string {
  if (!since) return "—";
  const t = Date.parse(since);
  if (Number.isNaN(t)) return "—";
  return formatDurationTable(now + offsetMs - t);
}

export function RowBadge({ info, mark }: { info: PodItem["status"]; mark?: StaleMark }) {
  const b = badgeProps(info, mark);
  return <StatusBadge size="sm" {...b} reason={info.reasons[0]?.text} />;
}

interface PodColumnOptions {
  now: number;
  offsetMs: number;
  metrics: MetricsState | null;
  thresholds: ClusterThresholds | null | undefined;
  watch: StaleMark;
  observedMinutes: number | null;
  hideNode?: boolean;
  compact?: boolean;
}

export function podColumns(o: PodColumnOptions): Column<PodItem>[] {
  const memTh = o.thresholds?.pod.memoryLimit;
  const rTh = o.thresholds?.pod.restarts1h;
  const metricsOff = o.metrics !== null && !o.metrics.cluster.available;
  const cols: Column<PodItem>[] = [
    { id: "status", header: "상태", width: 112, sortable: true, render: (p) => <RowBadge info={p.status} mark={o.watch} /> },
    {
      id: "name",
      header: "이름",
      minWidth: 240,
      maxWidth: 360,
      sortable: true,
      render: (p) => <ResourceName name={p.name} kind="pod" maxWidth={360} />,
    },
    {
      id: "namespace",
      header: "네임스페이스",
      width: 140,
      sortable: true,
      render: (p) => (
        <span className="row">
          <span>{p.namespace}</span>
          {p.isSystemNamespace ? <Chip label="시스템" icon="settings" /> : null}
        </span>
      ),
    },
    { id: "reason", header: "사유", minWidth: 200, render: (p) => <ReasonText reasons={reasonTexts(p.status)} status={badgeProps(p.status).status} /> },
    { id: "ready", header: "준비", width: 64, numeric: true, render: (p) => `${p.containers.ready}/${p.containers.total}` },
    {
      id: "restarts1h",
      header: o.observedMinutes !== null ? `재시작(관측 ${o.observedMinutes}분)` : "재시작(1h)",
      width: 96,
      numeric: true,
      sortable: true,
      render: (p) => (
        <span className="row">
          {rTh && p.restarts.last1h >= rTh.crit ? (
            <StatusIcon status="crit" size={12} title="장애 기준 이상" />
          ) : rTh && p.restarts.last1h >= rTh.warn ? (
            <StatusIcon status="warn" size={12} title="주의 기준 이상" />
          ) : null}
          {formatCount(p.restarts.last1h)}
        </span>
      ),
    },
    {
      id: "restartsTotal",
      header: "누적 재시작",
      width: 88,
      numeric: true,
      sortable: true,
      hideBelow: 1280,
      render: (p) => <span className="text-caption-tertiary">{formatCount(p.restarts.total)}</span>,
    },
    {
      id: "cpu",
      header: metricsOff ? <MetricsOffHeader label="CPU" /> : "CPU",
      width: 96,
      numeric: true,
      sortable: true,
      render: (p) => {
        const u = podUsage(p, o.metrics).usage;
        return u ? formatMillicores(u.cpuMillicores) : "—";
      },
    },
    {
      id: "memory",
      header: metricsOff ? <MetricsOffHeader label="메모리" /> : "메모리",
      width: 160,
      sortable: true,
      render: (p) => {
        const u = podUsage(p, o.metrics);
        if (!u.usage) return "—";
        return (
          <span className="stack-sm">
            <span className="tabular">{formatBytes(u.usage.memoryBytes)}</span>
            {u.memoryLimitPct !== null ? (
              <UsageBar
                size="sm"
                value={u.memoryLimitPct / 100}
                status={reasonStatus(p.status, ["POD_MEMORY_LIMIT"])}
                warnAt={memTh ? memTh.warnPct / 100 : undefined}
                critAt={memTh?.critPct ? memTh.critPct / 100 : undefined}
                label={formatPercent(u.memoryLimitPct / 100)}
                name="메모리 limit 대비"
              />
            ) : (
              <span className="text-caption-tertiary">limit 없음</span>
            )}
          </span>
        );
      },
    },
  ];
  if (!o.hideNode) {
    cols.push({
      id: "node",
      header: "노드",
      width: 160,
      render: (p) => (p.nodeName ? <ResourceName name={p.nodeName} kind="node" href={nodeHref(p.nodeName)} maxWidth={160} /> : "—"),
    });
  }
  cols.push({
    id: "startedAt",
    header: "경과",
    width: 72,
    numeric: true,
    sortable: true,
    hideBelow: 1280,
    render: (p) => <span suppressHydrationWarning>{elapsedText(p.startedAt ?? p.createdAt, o.now, o.offsetMs)}</span>,
  });
  return cols;
}

function MetricsOffHeader({ label }: { label: string }) {
  return (
    <Tooltip content="metrics-server 없음">
      <span className="row">
        {label}
        <Icon name="circle-help" size={12} />
      </span>
    </Tooltip>
  );
}

export const podSortAccessors: Record<string, (p: PodItem) => string | number | null> = {
  name: (p) => p.name,
  namespace: (p) => p.namespace,
  restarts1h: (p) => p.restarts.last1h,
  restartsTotal: (p) => p.restarts.total,
  cpu: (p) => p.usage?.cpuMillicores ?? null,
  memory: (p) => p.usage?.memoryBytes ?? null,
  startedAt: (p) => p.startedAt ?? p.createdAt,
};

export function eventColumns(o: { now: number }): Column<EventItem>[] {
  return [
    {
      id: "severe",
      header: <span className="sr-only">심각</span>,
      width: 40,
      align: "center",
      render: (e) =>
        e.severe ? <StatusIcon status="crit" size={16} title="심각 reason" /> : <StatusIcon status="warn" size={16} title="Warning" />,
    },
    {
      id: "lastSeenAt",
      header: "마지막 발생",
      width: 96,
      numeric: true,
      sortable: true,
      render: (e) => (
        <span suppressHydrationWarning title={e.lastSeenAt}>
          {formatTime(e.lastSeenAt, "auto", o.now)}
        </span>
      ),
    },
    { id: "namespace", header: "네임스페이스", width: 140, sortable: true, render: (e) => e.namespace ?? "—" },
    {
      id: "target",
      header: "대상",
      minWidth: 240,
      maxWidth: 320,
      render: (e) => (
        <span className="row">
          <span className="text-caption-tertiary">{e.involvedObject.kind}</span>
          <ResourceName
            name={e.involvedObject.name}
            kind={e.involvedObject.kind === "Node" ? "node" : e.involvedObject.kind === "Pod" ? "pod" : "other"}
            href={hrefForRef(e.involvedObject)}
            maxWidth={280}
          />
        </span>
      ),
    },
    { id: "reason", header: "reason", width: 160, render: (e) => <span className="text-mono">{e.reason}</span> },
    { id: "message", header: "message", minWidth: 280, render: (e) => <span>{e.message}</span> },
    { id: "count", header: "횟수", width: 64, numeric: true, sortable: true, render: (e) => `×${formatCount(e.count)}` },
  ];
}

export function EventsEmptyLine() {
  return <p className="text-caption">최근 1시간 Warning 이벤트 없음</p>;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-link">
      {label}
    </Link>
  );
}
