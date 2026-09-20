"use client";

/** 파드 상세 `/cluster/pods/[namespace]/[name]` (docs/design/cluster-status.md 7절). */
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
  formatTime,
  Grid,
  GridItem,
  Icon,
  KeyValueList,
  PageHeader,
  Section,
  Skeleton,
  StatusBadge,
  StatusIcon,
  UnknownState,
  UsageBar,
} from "@/components/ui";

import { errorBody, useApi } from "../common/hooks";
import { badgeProps, reasonTexts } from "../stream/stale";
import { nodeHref, podUsage, workloadFocusHref } from "./selectors";
import { elapsedText, EventsEmptyLine, eventColumns, useClusterView } from "./shared";
import type { ContainerDetail, PodDetailResponse, SeriesPoint } from "./types";
import { UsageCharts } from "./UsageCharts";

const TOPICS = ["cluster", "metrics"] as const;

function stateText(c: ContainerDetail): string {
  if (c.state.type === "waiting") return `대기: ${c.state.reason ?? "알 수 없음"}`;
  if (c.state.type === "terminated") return `종료: ${c.state.reason ?? "알 수 없음"}`;
  return "실행 중";
}

function amounts(a: { cpuMillicores: number | null; memoryBytes: number | null }) {
  return `${a.cpuMillicores !== null ? formatMillicores(a.cpuMillicores) : "—"} · ${a.memoryBytes !== null ? formatBytes(a.memoryBytes) : "—"}`;
}

export function PodDetailPage({ namespace, name }: { namespace: string; name: string }) {
  const router = useRouter();
  const { stream, now, watch, cluster, metrics } = useClusterView(TOPICS);
  const key = `${namespace}/${name}`;
  const live = cluster?.pods[key] ?? null;
  const q = useApi<PodDetailResponse>(
    `/cluster/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
    undefined,
    live ? `${live.status.statusChangedAt}|${live.restarts.total}|${live.containers.ready}` : null,
  );
  const err = errorBody(q.error);
  const crumbs = [{ label: "파드", href: "/cluster/pods" }, { label: namespace }];

  if (err?.code === "RESOURCE_NOT_FOUND" && !live) {
    const owner = (err.details?.resource as { owner?: { workloadKey?: string | null } } | undefined)?.owner?.workloadKey;
    return (
      <>
        <PageHeader title={`${namespace} / ${name}`} monoTitle breadcrumbs={crumbs} />
        <EmptyState
          size="lg"
          icon="box"
          title="파드를 찾을 수 없습니다"
          description="재생성되었으면 워크로드에서 새 파드를 찾으세요"
          action={
            owner ? (
              <Button variant="secondary" onClick={() => router.push(workloadFocusHref(owner))}>
                워크로드 보기
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => router.push("/cluster/pods")}>
                파드 목록으로
              </Button>
            )
          }
        />
      </>
    );
  }
  if (err?.code === "SOURCE_UNAVAILABLE" && !live) {
    return (
      <>
        <PageHeader title={`${namespace} / ${name}`} monoTitle breadcrumbs={crumbs} />
        <UnknownState size="lg" reason={err.message} hint="kubeconfig를 확인하세요" onRetry={q.reload} />
      </>
    );
  }

  const detail = q.data;
  const pod = live ?? detail?.pod ?? null;
  if (!pod) {
    return (
      <>
        <PageHeader title={`${namespace} / ${name}`} monoTitle breadcrumbs={crumbs} />
        <Card>
          <Skeleton lines={8} />
        </Card>
      </>
    );
  }

  const u = podUsage(pod, metrics);
  const memTh = cluster?.thresholds.pod.memoryLimit;
  const mp = metrics?.pods[key];
  const livePoint: SeriesPoint | null =
    mp && metrics?.collectedAt
      ? { t: metrics.collectedAt, cpuMillicores: mp.cpuMillicores, memoryBytes: mp.memoryBytes, cpuPct: mp.cpuRequestPct, memoryPct: mp.memoryLimitPct, cpuStatus: null, memoryStatus: null }
      : null;
  const events = cluster
    ? Object.values(cluster.events)
        .filter((e) => e.involvedObject.kind === "Pod" && e.involvedObject.namespace === namespace && e.involvedObject.name === name)
        .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
    : (detail?.events ?? []);
  const b = badgeProps(pod.status, watch);

  return (
    <>
      <PageHeader
        title={`${namespace} / ${name}`}
        monoTitle
        breadcrumbs={crumbs}
        status={{ ...b, reason: reasonTexts(pod.status) }}
        chips={
          <>
            <Chip label={pod.phase} />
            <Chip label={`QoS ${pod.qosClass}`} />
            <Chip label={`경과 ${elapsedText(pod.startedAt ?? pod.createdAt, now, stream.serverOffsetMs)}`} icon="timer" />
            {pod.terminatingSince ? <Chip label={`종료 중 ${elapsedText(pod.terminatingSince, now, stream.serverOffsetMs)}`} tone="warn" /> : null}
            {pod.isSystemNamespace ? <Chip label="시스템" icon="settings" /> : null}
          </>
        }
      />
      <div className="page-stack">
        <Grid>
          <GridItem span={8} spanMd={12}>
            <Section title="컨테이너" headingLevel={3}>
              {detail ? (
                <div className="stack">
                  {detail.containers.map((c) => {
                    const cb = badgeProps(c.status, watch);
                    return (
                      <Card key={c.name} as="article" aria-label={`컨테이너 ${c.name}`}>
                        <div className="stack-sm">
                          <div className="row">
                            <span className="text-mono text-strong">{c.name}</span>
                            {c.init ? <Chip label="init" /> : null}
                            <StatusBadge size="sm" {...cb} reason={c.status.reasons[0]?.text} />
                            <span className="text-caption">{stateText(c)}</span>
                          </div>
                          {c.state.message ? <p className="text-caption">{c.state.message}</p> : null}
                          <KeyValueList
                            columns={2}
                            items={[
                              { label: "준비", value: c.ready ? "예" : "아니오" },
                              { label: "재시작", value: `1h ${formatCount(c.restarts.last1h)} / 누적 ${formatCount(c.restarts.total)}` },
                              {
                                label: "마지막 종료",
                                value: c.lastTermination ? (
                                  <span className="row">
                                    {c.lastTermination.reason === "OOMKilled" ? <StatusIcon status="crit" size={12} /> : null}
                                    <span className="text-mono">{c.lastTermination.reason ?? "—"}</span>
                                    {c.lastTermination.exitCode !== null ? `(${c.lastTermination.exitCode})` : null}
                                    {c.lastTermination.finishedAt ? <span suppressHydrationWarning>· {formatTime(c.lastTermination.finishedAt, "auto")}</span> : null}
                                  </span>
                                ) : (
                                  "—"
                                ),
                              },
                              { label: "이미지", value: <span className="text-mono">{c.image}</span> },
                              { label: "CPU", value: `${c.usage ? formatMillicores(c.usage.cpuMillicores) : "—"} · requests ${c.requests.cpuMillicores !== null ? formatMillicores(c.requests.cpuMillicores) : "—"} · limits ${c.limits.cpuMillicores !== null ? formatMillicores(c.limits.cpuMillicores) : "—"}` },
                              {
                                label: "메모리",
                                value:
                                  c.usage && c.memoryLimitPct !== null && c.limits.memoryBytes !== null ? (
                                    <UsageBar
                                      value={c.memoryLimitPct / 100}
                                      status={cb.status === "stale" ? "stale" : c.status.reasons.some((r) => r.code.includes("MEMORY")) ? cb.status : "ok"}
                                      warnAt={memTh ? memTh.warnPct / 100 : undefined}
                                      critAt={memTh?.critPct ? memTh.critPct / 100 : undefined}
                                      label={`${formatBytes(c.usage.memoryBytes)} / ${formatBytes(c.limits.memoryBytes)} (${formatPercent(c.memoryLimitPct / 100)})`}
                                      name="메모리 limit 대비"
                                    />
                                  ) : c.usage ? (
                                    `${formatBytes(c.usage.memoryBytes)} · limit 없음`
                                  ) : (
                                    "—"
                                  ),
                              },
                              {
                                label: "probe",
                                value: [c.probes.readiness ? "readiness" : null, c.probes.liveness ? "liveness" : null, c.probes.startup ? "startup" : null].filter(Boolean).join(" · ") || "없음",
                              },
                            ]}
                          />
                        </div>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card>
                  <Skeleton lines={6} />
                </Card>
              )}
            </Section>
          </GridItem>
          <GridItem span={4} spanMd={12}>
            <Section title="정보" headingLevel={3}>
              <Card>
                <KeyValueList
                  items={[
                    { label: "네임스페이스", value: pod.namespace },
                    {
                      label: "소속 워크로드",
                      value: pod.owner ? (
                        pod.owner.workloadKey ? (
                          <Link href={workloadFocusHref(pod.owner.workloadKey)} className="text-link">
                            {pod.owner.kind} {pod.owner.name} <Icon name="chevron-right" size={12} />
                          </Link>
                        ) : (
                          `${pod.owner.kind} ${pod.owner.name}`
                        )
                      ) : (
                        "없음 (단독 파드)"
                      ),
                    },
                    {
                      label: "노드",
                      value: pod.nodeName ? (
                        <Link href={nodeHref(pod.nodeName)} className="text-link text-mono">
                          {pod.nodeName} <Icon name="chevron-right" size={12} />
                        </Link>
                      ) : (
                        "—"
                      ),
                    },
                    { label: "phase", value: pod.phase },
                    { label: "QoS", value: pod.qosClass },
                    { label: "시작", value: pod.startedAt ? <span suppressHydrationWarning>{formatTime(pod.startedAt, "auto")}</span> : "—" },
                    { label: "준비", value: `${pod.containers.ready}/${pod.containers.total}` },
                    { label: "CPU", value: u.usage ? `${formatMillicores(u.usage.cpuMillicores)} · requests ${amounts(pod.requests)}` : `— · requests ${amounts(pod.requests)}` },
                    { label: "limits", value: amounts(pod.limits) },
                    { label: "파드 IP", value: <span className="text-mono">{detail?.podIP ?? "—"}</span> },
                    { label: "ServiceAccount", value: detail?.serviceAccountName ?? "—" },
                  ]}
                />
              </Card>
            </Section>
          </GridItem>
        </Grid>

        <UsageCharts target="pod" name={name} namespace={namespace} stream={stream} now={now} livePoint={livePoint} height="sm" />

        <Section title="관련 Warning 이벤트">
          {events.length === 0 ? (
            <EventsEmptyLine />
          ) : (
            <DataTable caption="관련 Warning 이벤트" columns={eventColumns({ now })} rows={events} rowKey={(e) => e.key} />
          )}
        </Section>
      </div>
    </>
  );
}
