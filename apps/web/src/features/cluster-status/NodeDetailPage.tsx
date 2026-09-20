"use client";

/** 노드 상세 `/cluster/nodes/[name]` (docs/design/cluster-status.md 4절). REST 상세 + cluster·metrics 토픽. */
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  formatBytes,
  formatCount,
  formatMillicores,
  formatPercent,
  Grid,
  GridItem,
  PageHeader,
  Section,
  shortNodeName,
  Skeleton,
  StatusIcon,
  UnknownState,
  UsageBar,
  type Column,
} from "@/components/ui";

import { errorBody, useApi } from "../common/hooks";
import { badgeProps, reasonTexts } from "../stream/stale";
import { apiStatus, comparePodsDefault, nodeUsage, podHref, reasonStatus } from "./selectors";
import { elapsedText, EventsEmptyLine, eventColumns, podColumns, useClusterView } from "./shared";
import type { NodeCondition, NodeDetailResponse, SeriesPoint } from "./types";
import { UsageCharts } from "./UsageCharts";

const TOPICS = ["cluster", "metrics"] as const;

export function NodeDetailPage({ name }: { name: string }) {
  const router = useRouter();
  const { stream, now, watch, cluster, metrics } = useClusterView(TOPICS);
  const live = cluster?.nodes[name] ?? null;
  // 스트림 행의 상태가 바뀌면 조건·용량을 다시 받는다
  const q = useApi<NodeDetailResponse>(`/cluster/nodes/${encodeURIComponent(name)}`, undefined, live?.status.statusChangedAt ?? null);
  const err = errorBody(q.error);

  if (err?.code === "RESOURCE_NOT_FOUND" && !live) {
    return (
      <>
        <PageHeader title={shortNodeName(name)} breadcrumbs={[{ label: "노드", href: "/cluster/nodes" }, { label: shortNodeName(name) }]} />
        <EmptyState
          size="lg"
          icon="server-crash"
          title="노드를 찾을 수 없습니다"
          description="삭제되었거나 이름이 바뀌었을 수 있습니다"
          action={
            <Button variant="secondary" onClick={() => router.push("/cluster/nodes")}>
              노드 목록으로
            </Button>
          }
        />
      </>
    );
  }
  if (err?.code === "SOURCE_UNAVAILABLE" && !live) {
    return (
      <>
        <PageHeader title={shortNodeName(name)} breadcrumbs={[{ label: "노드", href: "/cluster/nodes" }, { label: shortNodeName(name) }]} />
        <UnknownState size="lg" reason={err.message} hint="kubeconfig를 확인하세요" onRetry={q.reload} />
      </>
    );
  }

  const detail = q.data;
  const node = live ?? detail?.node ?? null;
  if (!node) {
    return (
      <>
        <PageHeader title={shortNodeName(name)} breadcrumbs={[{ label: "노드", href: "/cluster/nodes" }, { label: shortNodeName(name) }]} />
        <Card>
          <Skeleton lines={6} />
        </Card>
      </>
    );
  }

  const usage = nodeUsage(node, metrics);
  const th = detail?.thresholds ?? cluster?.thresholds.node;
  const m = metrics?.nodes[name];
  const livePoint: SeriesPoint | null =
    m && metrics?.collectedAt
      ? { t: metrics.collectedAt, cpuMillicores: m.cpuMillicores, memoryBytes: m.memoryBytes, cpuPct: m.cpuPct, memoryPct: m.memoryPct, cpuStatus: null, memoryStatus: null }
      : null;

  // 이 노드의 파드·관련 이벤트: 스트림 목록이 있으면 실시간 목록, 없으면 REST 응답
  const pods = cluster
    ? Object.values(cluster.pods).filter((p) => p.nodeName === name && !p.completed).sort(comparePodsDefault)
    : (detail?.pods ?? []);
  const podKeys = new Set(pods.map((p) => p.name));
  const events = cluster
    ? Object.values(cluster.events)
        .filter((e) => (e.involvedObject.kind === "Node" && e.involvedObject.name === name) || (e.involvedObject.kind === "Pod" && podKeys.has(e.involvedObject.name)))
        .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
    : (detail?.events ?? []);

  const conditions: (NodeCondition | { type: string; value: string; since: null; reason: null; message: null; status: "ok" | "warning"; schedulable: true })[] = [
    ...(detail?.conditions ?? []),
    {
      type: "스케줄 가능",
      value: node.unschedulable ? "아니오" : "예",
      since: null,
      reason: null,
      message: null,
      status: node.unschedulable ? "warning" : "ok",
      schedulable: true,
    },
  ];
  const condColumns: Column<(typeof conditions)[number]>[] = [
    { id: "type", header: "조건", render: (c) => c.type },
    { id: "value", header: "값", width: 88, render: (c) => <span className="text-mono">{c.value ?? "—"}</span> },
    { id: "status", header: <span className="sr-only">상태</span>, width: 32, render: (c) => <StatusIcon status={apiStatus(c.status)} size={16} title={c.reason ?? undefined} /> },
    {
      id: "since",
      header: "지속",
      width: 88,
      numeric: true,
      render: (c) => (c.since && apiStatus(c.status) !== "ok" ? <span suppressHydrationWarning>{elapsedText(c.since, now, stream.serverOffsetMs)}째</span> : ""),
    },
  ];

  const b = badgeProps(node.status, watch);
  const cpuStatus = reasonStatus(node.status, ["NODE_CPU_USAGE"]);
  const memStatus = reasonStatus(node.status, ["NODE_MEMORY_USAGE"]);
  const alloc = node.allocatable;

  return (
    <>
      <PageHeader
        title={node.name}
        monoTitle
        breadcrumbs={[{ label: "노드", href: "/cluster/nodes" }, { label: shortNodeName(node.name) }]}
        status={{ ...b, reason: reasonTexts(node.status) }}
        chips={
          <>
            {node.instanceType ? <Chip label={node.instanceType} mono /> : null}
            {node.capacityType ? <Chip label={node.capacityType === "spot" ? "스팟" : "온디맨드"} icon={node.capacityType === "spot" ? "zap" : undefined} /> : null}
            {node.zone ? <Chip label={node.zone} /> : null}
            {node.nodeGroup ? <Chip label={node.nodeGroup} /> : null}
            <Chip label={`kubelet ${node.kubeletVersion}`} mono />
            <Chip label={elapsedText(node.createdAt, now, stream.serverOffsetMs)} icon="timer" />
            {node.unschedulable ? <Chip label="스케줄 제외" icon="ban" /> : null}
          </>
        }
      />
      <div className="page-stack">
        <Grid>
          <GridItem span={4} spanMd={12}>
            <Card padding="none" as="section" aria-label="조건">
              <DataTable
                caption="노드 조건"
                density="compact"
                columns={condColumns}
                rows={conditions}
                rowKey={(c) => c.type}
                rowAccent={(c) => {
                  const s = apiStatus(c.status);
                  return s === "crit" ? "crit" : s === "warn" ? "warn" : undefined;
                }}
                state={detail ? "ready" : q.loading ? "loading" : "ready"}
                loadingRows={6}
              />
            </Card>
          </GridItem>
          <GridItem span={8} spanMd={12}>
            <Card as="section" aria-label="용량">
              <div className="stack">
                <div className="label-row">
                  <span className="text-caption">CPU 사용량</span>
                  {usage ? (
                    <UsageBar
                      value={usage.cpuPct / 100}
                      status={cpuStatus}
                      warnAt={th ? th.cpu.warnPct / 100 : undefined}
                      critAt={th?.cpu.critPct ? th.cpu.critPct / 100 : undefined}
                      label={`${formatMillicores(usage.cpuMillicores)} / ${formatMillicores(alloc.cpuMillicores)} (${formatPercent(usage.cpuPct / 100)})`}
                      name="CPU 사용률"
                    />
                  ) : (
                    <span className="text-caption">— (metrics-server 없음)</span>
                  )}
                </div>
                <div className="label-row">
                  <span className="text-caption">CPU requests</span>
                  <UsageBar
                    value={node.requests.cpuPct / 100}
                    status={reasonStatus(node.status, ["NODE_REQUESTS_HIGH"])}
                    warnAt={th ? th.requests.warnPct / 100 : undefined}
                    label={`${formatMillicores(node.requests.cpuMillicores)} / ${formatMillicores(alloc.cpuMillicores)} (${formatPercent(node.requests.cpuPct / 100)})`}
                    name="CPU requests"
                  />
                </div>
                <div className="label-row">
                  <span className="text-caption">메모리 사용량</span>
                  {usage ? (
                    <UsageBar
                      value={usage.memoryPct / 100}
                      status={memStatus}
                      warnAt={th ? th.memory.warnPct / 100 : undefined}
                      critAt={th?.memory.critPct ? th.memory.critPct / 100 : undefined}
                      label={`${formatBytes(usage.memoryBytes)} / ${formatBytes(alloc.memoryBytes)} (${formatPercent(usage.memoryPct / 100)})`}
                      name="메모리 사용률"
                    />
                  ) : (
                    <span className="text-caption">— (metrics-server 없음)</span>
                  )}
                </div>
                <div className="label-row">
                  <span className="text-caption">메모리 requests</span>
                  <UsageBar
                    value={node.requests.memoryPct / 100}
                    status="ok"
                    warnAt={th ? th.requests.warnPct / 100 : undefined}
                    label={`${formatBytes(node.requests.memoryBytes)} / ${formatBytes(alloc.memoryBytes)} (${formatPercent(node.requests.memoryPct / 100)})`}
                    name="메모리 requests"
                  />
                </div>
                <div className="label-row">
                  <span className="text-caption">파드</span>
                  <UsageBar
                    value={node.pods.pct / 100}
                    status={reasonStatus(node.status, ["NODE_PODS_HIGH"])}
                    warnAt={th ? th.pods.warnPct / 100 : undefined}
                    critAt={th?.pods.critPct ? th.pods.critPct / 100 : undefined}
                    label={`${formatCount(node.pods.count)} / ${formatCount(node.pods.max)}`}
                    name="파드 수"
                  />
                </div>
              </div>
            </Card>
          </GridItem>
        </Grid>

        <UsageCharts target="node" name={name} stream={stream} now={now} livePoint={livePoint} />

        <Section title="이 노드의 파드" meta={`${formatCount(pods.length)}개`}>
          <DataTable
            caption="이 노드의 파드"
            columns={podColumns({
              now,
              offsetMs: stream.serverOffsetMs,
              metrics,
              thresholds: cluster?.thresholds,
              watch,
              observedMinutes: null,
              hideNode: true,
            })}
            rows={pods}
            rowKey={(p) => p.key}
            rowStatus={(p) => badgeProps(p.status).status}
            onRowClick={(p) => router.push(podHref(p.namespace, p.name))}
            state={pods.length ? "ready" : "empty"}
            emptyProps={{ icon: "box", title: "이 노드에 파드가 없습니다" }}
          />
        </Section>

        <Section title="관련 Warning 이벤트">
          {events.length === 0 ? (
            <EventsEmptyLine />
          ) : (
            <DataTable caption="관련 Warning 이벤트" columns={eventColumns({ now })} rows={events} rowKey={(e) => e.key} />
          )}
        </Section>
        <p className="text-caption">
          <Link href="/cluster/nodes" className="text-link">
            노드 목록으로
          </Link>
        </p>
      </div>
    </>
  );
}
