"use client";

/**
 * 개요 `/` (docs/design/cluster-status.md 2절). 데이터: overview 토픽(요약·카드·확인 항목·비용/어드바이저 요약),
 * metrics 토픽(클러스터 CPU·메모리 + 1시간 추이). Prometheus 가 있으면 6h/24h 는 REST series.
 */
import Link from "next/link";
import { useState } from "react";

import {
  Button,
  Card,
  ChartFrame,
  CostKindBadge,
  Drawer,
  ErrorState,
  formatBytes,
  formatCount,
  formatDurationTable,
  formatLatency,
  formatMillicores,
  formatPercent,
  formatRelative,
  formatTime,
  Grid,
  GridItem,
  Icon,
  MetricTile,
  MoneyValue,
  PageHeader,
  ReasonText,
  ResourceName,
  SegmentedControl,
  SeverityIcon,
  shortNodeName,
  Skeleton,
  StatusBadge,
  StatusCard,
  StatusIcon,
  SummaryStrip,
  SummaryStripItem,
  UsageBar,
  type StatusAltLabel,
  type StatusCardItem,
} from "@/components/ui";
import { SeriesTable, TimeSeriesChart } from "@/charts";

import { useApi } from "../common/hooks";
import type { StatusInfo } from "../common/types";
import { badgeProps, periodicStale, reasonTexts, STALE_AFTER_MS, type StaleMark } from "../stream/stale";
import { AREA_LABEL, apiStatus, hrefForRef } from "./selectors";
import { thresholdLines } from "./chart-helpers";
import styles from "./OverviewPage.module.css";
import { useClusterView } from "./shared";
import type { AreaProblem, AttentionItem, AttentionListResponse, ClusterMetricsBody, MetricsSeriesResponse, OverviewResponse, SeriesPoint } from "./types";

const TOPICS = ["overview", "metrics"] as const;

function problemItems(problems: AreaProblem[]): StatusCardItem[] {
  return problems.slice(0, 3).map((p) => ({
    label: p.ref.kind === "Node" ? shortNodeName(p.ref.name) : p.ref.namespace ? `${p.ref.namespace} / ${p.ref.name}` : p.ref.name,
    href: hrefForRef(p.ref),
    status: apiStatus(p.status),
    detail: p.reason,
    mono: true,
  }));
}

function counts(c: { critical: number; warning: number; ok: number }) {
  return [
    { status: "crit" as const, count: c.critical },
    { status: "warn" as const, count: c.warning },
    { status: "ok" as const, count: c.ok },
  ];
}

function markFor(stale: boolean, info: StatusInfo, fallbackAt?: string): StaleMark {
  return { stale, at: stale ? (fallbackAt ?? info.updatedAt ?? undefined) : undefined };
}

export function OverviewPage() {
  const { stream, now, watch } = useClusterView(TOPICS);
  const ov = stream.overview;
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (!ov) {
    return (
      <>
        <PageHeader title="개요" />
        <div className="page-stack">
          <SummaryStrip overall={{ status: "unknown", reason: [] }} state="loading" />
          <Grid columns={5} columnsMd={3}>
            {Array.from({ length: 5 }, (_, i) => (
              <StatusCard key={i} title="…" icon="server" status="unknown" primary="" state="loading" />
            ))}
          </Grid>
          <Card>
            <Skeleton lines={3} />
          </Card>
        </div>
      </>
    );
  }

  const a = ov.areas;
  const navStale = ov.nav.stale;
  const heartbeatAt = watch.at;
  const nodesMark = markFor(watch.stale || navStale.nodes, a.nodes.status, heartbeatAt);
  const wlMark = markFor(watch.stale || navStale.workloads, a.workloads.status, heartbeatAt);
  const podsMark = markFor(watch.stale || navStale.pods, a.pods.status, heartbeatAt);
  const evMark = markFor(watch.stale || navStale.events, a.events.status, heartbeatAt);
  const dbMark = periodicStale(stream, a.db.status.updatedAt, STALE_AFTER_MS.db, ["monitoredDb"], now);
  const dbStale = { stale: dbMark.stale || navStale.db, at: dbMark.at ?? a.db.status.updatedAt ?? undefined };
  const overall = badgeProps(ov.overall, watch.stale ? watch : undefined);

  const cardProps = (mark: StaleMark, info: StatusInfo) => {
    const b = badgeProps(info, mark);
    return { status: b.status === "stale" ? (b.previousStatus ?? "unknown") : b.status, staleAt: b.status === "stale" ? b.staleAt : undefined };
  };

  const clusterMeta = ov.cluster.connected
    ? [ov.cluster.name, ov.cluster.version, ov.cluster.region].filter(Boolean).join(" · ")
    : "클러스터 연결 없음";

  const dbHeadline = a.db.headline ? `${a.db.headline.label} ${headlineValue(a.db.headline.value, a.db.headline.unit)}` : "—";

  return (
    <>
      <PageHeader title="개요" />
      <div className="page-stack">
        <SummaryStrip
          overall={{ status: overall.status === "stale" ? (overall.previousStatus ?? "unknown") : overall.status, reason: reasonTexts(ov.overall) }}
          meta={clusterMeta}
          updatedAt={ov.overall.updatedAt}
          updatedStale={watch.stale}
        >
          <SummaryStripItem
            label="노드 Ready"
            value={`${formatCount(a.nodes.ready)}/${formatCount(a.nodes.total)}`}
            status={apiStatus(a.nodes.status.status) === "ok" ? undefined : apiStatus(a.nodes.status.status)}
            href="/cluster/nodes"
          />
          <SummaryStripItem label="파드" value={<CountTriple c={a.pods.counts} />} href="/cluster/pods" />
          <SummaryStripItem label="워크로드" value={<CountTriple c={a.workloads.counts} />} href="/cluster/workloads" />
          <SummaryStripItem label="Warning 15분" value={formatCount(a.events.warnings15m)} href="/cluster/events" />
          <SummaryStripItem label="DB" value={<StatusBadge {...badgeProps(a.db.status, dbStale)} size="md" />} href="/cluster/db" />
        </SummaryStrip>

        <Grid columns={5} columnsMd={3}>
          <StatusCard
            title="노드"
            icon="server"
            {...cardProps(nodesMark, a.nodes.status)}
            primary={`Ready ${formatCount(a.nodes.ready)}/${formatCount(a.nodes.total)}`}
            items={problemItems(a.nodes.problems)}
            reason={reasonTexts(a.nodes.status)}
            href={a.nodes.problems.length ? "/cluster/nodes?status=crit,warn" : "/cluster/nodes"}
          />
          <StatusCard
            title="워크로드"
            icon="boxes"
            {...cardProps(wlMark, a.workloads.status)}
            primary={`${formatCount(a.workloads.total)}개`}
            counts={counts(a.workloads.counts)}
            items={problemItems(a.workloads.problems)}
            reason={reasonTexts(a.workloads.status)}
            href={a.workloads.problems.length ? "/cluster/workloads?status=crit,warn" : "/cluster/workloads"}
          />
          <StatusCard
            title="파드"
            icon="box"
            {...cardProps(podsMark, a.pods.status)}
            primary={`${formatCount(a.pods.total)}개`}
            counts={counts(a.pods.counts)}
            items={problemItems(a.pods.problems)}
            reason={reasonTexts(a.pods.status)}
            href="/cluster/pods"
          />
          <StatusCard
            title="이벤트"
            icon="bell-ring"
            {...cardProps(evMark, a.events.status)}
            primary={`Warning ${formatCount(a.events.warnings15m)}건 (15분)`}
            items={problemItems(a.events.problems)}
            reason={reasonTexts(a.events.status)}
            href="/cluster/events"
          />
          <StatusCard
            title="DB"
            icon="database"
            {...cardProps(dbStale, a.db.status)}
            primary={dbHeadline}
            reason={reasonTexts(a.db.status)}
            href="/cluster/db"
          />
        </Grid>

        <AttentionSection ov={ov} now={now + stream.serverOffsetMs} onOpenAll={() => setDrawerOpen(true)} />

        <Grid>
          <GridItem span={6} spanMd={12}>
            <ClusterUsageCard kind="cpu" />
          </GridItem>
          <GridItem span={6} spanMd={12}>
            <ClusterUsageCard kind="memory" />
          </GridItem>
          <GridItem span={6} spanMd={12}>
            <CostSummaryTile ov={ov} />
          </GridItem>
          <GridItem span={6} spanMd={12}>
            <AdvisorSummaryTile ov={ov} />
          </GridItem>
        </Grid>
      </div>
      <AttentionDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} now={now + stream.serverOffsetMs} />
    </>
  );
}

/** DB 대표 지표 값 + 단위 (서버 unit 그대로 해석, 모르는 단위는 붙여 쓴다) */
export function headlineValue(value: number, unit: string): string {
  switch (unit) {
    case "percent":
      return formatPercent(value / 100);
    case "ms":
      return formatLatency(value);
    case "sec":
      return formatDurationTable(value * 1000);
    case "count":
      return `${formatCount(value)}건`;
    default:
      return unit ? `${formatCount(value)} ${unit}` : formatCount(value);
  }
}

function CountTriple({ c }: { c: { critical: number; warning: number; ok: number } }) {
  const parts = [
    { s: "crit" as const, n: c.critical },
    { s: "warn" as const, n: c.warning },
    { s: "ok" as const, n: c.ok },
  ];
  return (
    <span className="row" style={{ flexWrap: "nowrap" }}>
      {parts.map((p, i) => (
        <span key={p.s} className="row" style={p.n === 0 ? { color: "var(--color-text-disabled)" } : undefined}>
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          <StatusIcon status={p.s} size={12} title={p.s === "crit" ? "장애" : p.s === "warn" ? "주의" : "정상"} />
          {formatCount(p.n)}
        </span>
      ))}
    </span>
  );
}

function AttentionRows({ items, now }: { items: AttentionItem[]; now: number }) {
  return (
    <div role="list">
      {items.map((it) => (
        <Link
          key={`${it.area}-${it.ref.kind}-${it.ref.namespace ?? ""}-${it.ref.name}`}
          href={it.area === "db" ? "/cluster/db" : hrefForRef(it.ref)}
          className={styles.attentionRow}
          role="listitem"
        >
          <StatusBadge size="sm" status={apiStatus(it.status)} reason={it.reason.text} />
          <span className="text-caption">{AREA_LABEL[it.area] ?? it.area}</span>
          <ResourceName
            name={it.ref.name}
            namespace={it.ref.namespace ?? undefined}
            kind={it.ref.kind === "Node" ? "node" : it.ref.kind === "Pod" ? "pod" : "other"}
            copyable={false}
            maxWidth={360}
          />
          <ReasonText reasons={[it.reason.text]} status={apiStatus(it.reason.status)} />
          <span className="text-caption-tertiary text-end" suppressHydrationWarning>
            {it.statusChangedAt ? formatRelative(it.statusChangedAt, now) : ""}
          </span>
        </Link>
      ))}
    </div>
  );
}

function AttentionSection({ ov, now, onOpenAll }: { ov: OverviewResponse; now: number; onOpenAll: () => void }) {
  const items = ov.attention.items;
  if (items.length === 0) {
    return (
      <Card padding="md" as="section" aria-label="지금 확인할 항목">
        <p className="row" style={{ margin: 0 }}>
          <Icon name="circle-check" size={16} className="text-caption-tertiary" />
          <span className="text-caption">주의·장애 항목이 없습니다</span>
        </p>
      </Card>
    );
  }
  return (
    <Card padding="none" as="section" aria-labelledby="attention-title">
      <div className="row-between" style={{ padding: "var(--spacing-3) var(--spacing-4)" }}>
        <h2 id="attention-title" className="text-h3">
          지금 확인할 항목
        </h2>
        {ov.attention.total > items.length ? (
          <Button variant="ghost" size="sm" onClick={onOpenAll}>
            모두 보기 ({formatCount(ov.attention.total)})
          </Button>
        ) : null}
      </div>
      <AttentionRows items={items} now={now} />
    </Card>
  );
}

function AttentionDrawer({ open, onClose, now }: { open: boolean; onClose: () => void; now: number }) {
  const q = useApi<AttentionListResponse>(open ? "/cluster/attention" : null);
  return (
    <Drawer open={open} onClose={onClose} title="지금 확인할 항목" subtitle={q.data ? `${formatCount(q.data.total)}건` : undefined} size="md">
      {q.error ? (
        <ErrorState title="목록을 불러오지 못했습니다" onRetry={q.reload} size="sm" />
      ) : q.data ? (
        <AttentionRows items={q.data.items} now={now} />
      ) : (
        <Skeleton lines={8} />
      )}
    </Drawer>
  );
}

type UsageKind = "cpu" | "memory";

function usageValue(kind: UsageKind, m: ClusterMetricsBody, which: "usage" | "requests" | "limits"): string {
  if (kind === "cpu") {
    const v = which === "usage" ? m.cpu.usageMillicores : which === "requests" ? m.cpu.requestsMillicores : m.cpu.limitsMillicores;
    const p = which === "usage" ? m.cpu.usagePct : which === "requests" ? m.cpu.requestsPct : m.cpu.limitsPct;
    if (v === null || p === null) return "—";
    return `${formatMillicores(v)} / ${formatMillicores(m.cpu.allocatableMillicores)} (${formatPercent(p / 100)})`;
  }
  const v = which === "usage" ? m.memory.usageBytes : which === "requests" ? m.memory.requestsBytes : m.memory.limitsBytes;
  const p = which === "usage" ? m.memory.usagePct : which === "requests" ? m.memory.requestsPct : m.memory.limitsPct;
  if (v === null || p === null) return "—";
  return `${formatBytes(v)} / ${formatBytes(m.memory.allocatableBytes)} (${formatPercent(p / 100)})`;
}

function seriesFrom(points: SeriesPoint[], kind: UsageKind) {
  return points.map((p) => ({
    t: Date.parse(p.t),
    v: kind === "cpu" ? p.cpuPct : p.memoryPct,
    status: kind === "cpu" ? (p.cpuStatus ? apiStatus(p.cpuStatus) : null) : p.memoryStatus ? apiStatus(p.memoryStatus) : null,
  }));
}

function ClusterUsageCard({ kind }: { kind: UsageKind }) {
  const { stream, now } = useClusterView(TOPICS);
  const [range, setRange] = useState<"1h" | "6h" | "24h">("1h");
  const [asTable, setAsTable] = useState(false);
  const m = stream.metrics;
  const prom = m?.cluster.history.source === "prometheus";
  const remote = useApi<MetricsSeriesResponse>(prom && range !== "1h" ? "/cluster/metrics/series" : null, { target: "cluster", range });
  const title = kind === "cpu" ? "클러스터 CPU" : "클러스터 메모리";

  if (!m) {
    return <ChartFrame title={title} state="loading" height="md" />;
  }
  const body = m.cluster;
  const info = kind === "cpu" ? body.cpu.status : body.memory.status;
  const mark = periodicStale(stream, body.updatedAt, STALE_AFTER_MS.metrics, ["metrics"], now);
  const b = badgeProps(info, mark);
  const th = kind === "cpu" ? body.thresholds.cpu : body.thresholds.memory;
  const usagePct = kind === "cpu" ? body.cpu.usagePct : body.memory.usagePct;
  const points = range === "1h" || !prom ? m.clusterSeries.points : (remote.data?.points ?? []);
  const stepSec = range === "1h" || !prom ? m.clusterSeries.stepSec : (remote.data?.stepSec ?? 30);
  const series = [
    { id: kind, label: kind === "cpu" ? "CPU 사용률" : "메모리 사용률", color: kind === "cpu" ? "var(--color-chart-cpu)" : "var(--color-chart-memory)", points: seriesFrom(points, kind) },
  ];
  const lastPct = usagePct;
  const unavailableReason = body.unavailableReason?.message ?? "metrics-server 없음";
  const state = !body.available ? "unknown" : range !== "1h" && remote.loading ? "loading" : mark.stale ? "stale" : points.length === 0 ? "empty" : "ready";

  return (
    <ChartFrame
      title={title}
      badges={<StatusBadge {...b} size="md" />}
      subtitle={
        <div className="stack-sm">
          <ReasonText reasons={reasonTexts(info)} status={b.status} />
          {body.available ? (
            <div className="stack-sm">
              {(["usage", "requests", "limits"] as const).map((w) => {
                const pct = w === "usage" ? usagePct : kind === "cpu" ? (w === "requests" ? body.cpu.requestsPct : body.cpu.limitsPct) : w === "requests" ? body.memory.requestsPct : body.memory.limitsPct;
                return (
                  <div key={w} className="label-row">
                    <span className="text-caption">{w === "usage" ? "사용량" : w === "requests" ? "requests 합계" : "limits 합계"}</span>
                    {pct !== null ? (
                      <UsageBar
                        value={pct / 100}
                        status={w === "usage" ? (b.status === "stale" ? "stale" : apiStatus(info.status) === "unknown" ? "unknown" : apiStatus(info.status)) : "ok"}
                        warnAt={w === "usage" ? th.warnPct / 100 : undefined}
                        critAt={w === "usage" && th.critPct !== null ? th.critPct / 100 : undefined}
                        label={usageValue(kind, body, w)}
                        name={w === "usage" ? `${title} 사용률` : `${title} ${w}`}
                      />
                    ) : (
                      <span className="text-caption">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      }
      actions={
        prom ? (
          <SegmentedControl
            size="sm"
            label="기간"
            value={range}
            onChange={(v) => setRange(v as "1h" | "6h" | "24h")}
            options={[
              { value: "1h", label: "1시간" },
              { value: "6h", label: "6시간" },
              { value: "24h", label: "24시간" },
            ]}
          />
        ) : undefined
      }
      height="md"
      state={state}
      unknownReason={`알 수 없음 (${unavailableReason})`}
      unknownHint="EKS 애드온 metrics-server를 설치하면 표시됩니다"
      staleAt={mark.at}
      tableView={{ pressed: asTable, onToggle: () => setAsTable((v) => !v) }}
    >
      {asTable ? (
        <UsageTable points={points} kind={kind} />
      ) : (
        <TimeSeriesChart
          series={series}
          range={range}
          unit="percent"
          stepSec={stepSec}
          thresholds={thresholdLines(th)}
          end={now + stream.serverOffsetMs}
          ariaLabel={`${title} 사용률, 최근 ${range === "1h" ? "1시간" : range === "6h" ? "6시간" : "24시간"}, 현재 ${lastPct !== null ? formatPercent(lastPct / 100) : "알 수 없음"}`}
        />
      )}
    </ChartFrame>
  );
}

function UsageTable({ points, kind }: { points: SeriesPoint[]; kind: UsageKind }) {
  const rows = [...points].reverse().slice(0, 240);
  return (
    <SeriesTable
      caption={kind === "cpu" ? "CPU 사용률 표" : "메모리 사용률 표"}
      columns={["시각", "사용률"]}
      rows={rows.map((p) => {
        const v = kind === "cpu" ? p.cpuPct : p.memoryPct;
        return { key: p.t, cells: [formatTime(p.t, "time"), v === null ? "—" : formatPercent(v / 100, { digits: 1 })] };
      })}
    />
  );
}

function costBadgeLabel(info: StatusInfo): StatusAltLabel | undefined {
  if (info.status !== "critical") return undefined;
  const code = info.reasons[0]?.code ?? "";
  if (code.startsWith("BUDGET")) return "초과";
  if (code.startsWith("SPIKE")) return "급증";
  return undefined;
}

function CostSummaryTile({ ov }: { ov: OverviewResponse }) {
  const c = ov.cost;
  if (!c.available) {
    return <MetricTile label="비용" value={null} state="unknown" unknownReason={c.status.reasons[0]?.text} href="/cost" />;
  }
  return (
    <MetricTile
      label="비용"
      href="/cost"
      badge={<StatusBadge {...badgeProps(c.status)} label={costBadgeLabel(c.status)} size="md" />}
      value={
        c.rate ? (
          <span className="row">
            <MoneyValue amount={c.rate.amountUsd} kind="estimate" unit="hour" size="lg" asOf={c.rate.asOf} />
            <CostKindBadge kind="estimate" />
          </span>
        ) : (
          "—"
        )
      }
      lines={[
        c.monthToDate ? (
          <span key="mtd" className="row">
            이번 달 확정 <MoneyValue amount={c.monthToDate.amountUsd} kind="confirmed" unit="total" size="sm" asOf={c.monthToDate.asOf} />
            <CostKindBadge kind="confirmed" />
          </span>
        ) : (
          <span key="mtd">이번 달 확정 —</span>
        ),
        c.budgetStatus ? (
          <span key="budget" className="row">
            예산 <StatusBadge size="sm" status={apiStatus(c.budgetStatus)} label={c.budgetStatus === "critical" ? "초과" : undefined} />
          </span>
        ) : null,
      ].filter(Boolean)}
      status={apiStatus(c.status.status) === "crit" || apiStatus(c.status.status) === "warn" ? apiStatus(c.status.status) : undefined}
    />
  );
}

function precheckLabel(p: OverviewResponse["advisor"]["precheck"]): StatusAltLabel | undefined {
  if (p.status === "critical") return `높음 ${p.high}건`;
  if (p.status === "warning") return `중간 ${p.medium}건`;
  if (p.status === "ok") return "문제 없음";
  return undefined;
}

const BRIDGE_TEXT: Record<string, { status: "ok" | "warn" | "crit" | "unknown"; label: StatusAltLabel }> = {
  connected: { status: "ok", label: "연결됨" },
  login_required: { status: "warn", label: "로그인 필요" },
  usage_limit: { status: "warn", label: "사용량 한도" },
  unreachable: { status: "crit", label: "미실행" },
  unknown: { status: "unknown", label: "확인 중" },
};

function AdvisorSummaryTile({ ov }: { ov: OverviewResponse }) {
  const adv = ov.advisor;
  if (!adv.available) {
    return <MetricTile label="어드바이저" value={null} state="unknown" unknownReason="어드바이저 요약 없음" href="/advisor" />;
  }
  const p = adv.precheck;
  const bridge = BRIDGE_TEXT[adv.bridge] ?? BRIDGE_TEXT.unknown;
  return (
    <MetricTile
      label="어드바이저"
      href="/advisor"
      badge={<StatusBadge size="md" status={apiStatus(p.status)} label={precheckLabel(p)} />}
      value={
        <span className="row" aria-label={`사전 점검 높음 ${p.high} 중간 ${p.medium} 낮음 ${p.low}`}>
          <SeverityIcon severity="high" size={14} /> 높음 {formatCount(p.high)}
          <span aria-hidden="true">·</span>
          <SeverityIcon severity="medium" size={14} /> 중간 {formatCount(p.medium)}
          <span aria-hidden="true">·</span>
          <SeverityIcon severity="low" size={14} /> 낮음 {formatCount(p.low)}
        </span>
      }
      lines={[
        adv.lastRun ? (
          <span key="last" suppressHydrationWarning>
            마지막 분석 {adv.lastRun.finishedAt ? formatTime(adv.lastRun.finishedAt, "autoShort") : "진행 중"} · 제안 {formatCount(adv.lastRun.suggestionCount)}건
          </span>
        ) : (
          <span key="last">아직 분석을 실행하지 않았습니다</span>
        ),
        <span key="bridge" className="row">
          브리지 <StatusBadge size="sm" variant="dot" status={bridge.status} label={bridge.label} busy={adv.busy} />
        </span>,
      ]}
    />
  );
}

