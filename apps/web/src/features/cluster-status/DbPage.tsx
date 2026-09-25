"use client";

/** DB 상세 `/cluster/db` (docs/design/cluster-status.md 9절). db·cluster 토픽. 쿼리 원문은 계약상 없다. */
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import {
  Card,
  Chip,
  DataTable,
  DistributionBar,
  formatBytes,
  formatCount,
  formatDurationTable,
  formatLatency,
  formatPercent,
  formatRate,
  formatXidAge,
  Grid,
  GridItem,
  InlineAlert,
  MetricTile,
  PageHeader,
  ReasonText,
  ResourceName,
  Section,
  StatusBadge,
  StatusIcon,
  UnknownState,
  UsageBar,
  type Column,
} from "@/components/ui";

import { badgeProps, periodicStale, reasonTexts, STALE_AFTER_MS, type StaleMark } from "../stream/stale";
import { podHref } from "./selectors";
import { RowBadge, useClusterView } from "./shared";
import type { DbCheck, DbSession, PodItem } from "./types";

const TOPICS = ["db", "cluster"] as const;
/** 세션 경과 아이콘 기준 (docs/design/cluster-status.md 9.1: 5분 이상 주의, 30분 이상 장애 아이콘) */
const SESSION_WARN_SEC = 5 * 60;
const SESSION_CRIT_SEC = 30 * 60;

function check(checks: DbCheck[] | undefined, id: string): DbCheck | undefined {
  return checks?.find((c) => c.id === id);
}

function CheckTile({
  label,
  c,
  mark,
  value,
  lines = [],
  footer,
}: {
  label: string;
  c: DbCheck | undefined;
  mark: StaleMark;
  value: ReactNode;
  lines?: ReactNode[];
  footer?: ReactNode;
}) {
  if (!c) return <MetricTile label={label} value="—" state="unknown" unknownReason="지표 없음" />;
  const b = badgeProps(c.status, mark);
  const unknown = c.value === null && c.status.status === "unknown";
  return (
    <MetricTile
      label={label}
      value={value}
      state={unknown ? "unknown" : "ready"}
      unknownReason={c.status.reasons[0]?.text}
      staleAt={b.status === "stale" ? b.staleAt : undefined}
      staleFormat="time"
      badge={c.applicable ? <StatusBadge size="sm" {...(b.status === "stale" ? { status: b.previousStatus ?? "unknown" } : b)} /> : <Chip label="해당 없음" icon="minus" />}
      lines={[<ReasonText key="r" reasons={reasonTexts(c.status)} status={b.status} />, ...lines]}
      footer={
        <>
          {c.held ? <Chip label="판단 보류" icon="hourglass" /> : null}
          {footer}
        </>
      }
      status={b.status === "warn" || b.status === "crit" ? b.status : undefined}
    />
  );
}

export function DbPage() {
  const router = useRouter();
  const { stream, now, watch } = useClusterView(TOPICS);
  const db = stream.db;

  if (!db) {
    return (
      <>
        <PageHeader title="데이터베이스" />
        <Grid columns={6} columnsMd={3}>
          {Array.from({ length: 6 }, (_, i) => (
            <MetricTile key={i} label="…" value="" state="loading" />
          ))}
        </Grid>
      </>
    );
  }

  if (!db.configured) {
    return (
      <>
        <PageHeader title="데이터베이스" status={{ ...badgeProps(db.status), reason: reasonTexts(db.status) }} />
        <UnknownState
          size="lg"
          title={db.status.reasons[0]?.text ?? "모니터링할 DB가 설정되지 않았습니다"}
          hint=".env의 DB 대상(네임스페이스/StatefulSet)과 모니터링 계정을 설정하세요"
        />
      </>
    );
  }

  const h = db.health;
  const mark = periodicStale(stream, h?.collectedAt ?? db.status.updatedAt, STALE_AFTER_MS.db, ["monitoredDb"], now);
  const checks = h?.checks;
  const top = badgeProps(db.status, mark);
  const conn = check(checks, "connection_usage");
  const connTh = conn?.thresholds;
  const sessions = [...(h?.sessions ?? [])].sort((a, b) => (b.queryAgeSec ?? b.stateAgeSec ?? 0) - (a.queryAgeSec ?? a.stateAgeSec ?? 0)).slice(0, 20);
  const k8s = db.kubernetes;
  const sts = k8s?.statefulSet ?? null;

  const sessionCols: Column<DbSession>[] = [
    { id: "user", header: "사용자", width: 120, render: (s) => s.user ?? "—" },
    { id: "db", header: "DB", width: 120, render: (s) => s.database ?? "—" },
    {
      id: "state",
      header: "상태",
      width: 140,
      render: (s) => (
        <span className="row">
          {s.state === "idle in transaction" ? <StatusIcon status="warn" size={12} /> : null}
          {s.state ?? "—"}
        </span>
      ),
    },
    {
      id: "age",
      header: "경과",
      width: 96,
      numeric: true,
      render: (s) => {
        const sec = s.queryAgeSec ?? s.stateAgeSec;
        if (sec === null) return "—";
        return (
          <span className="row">
            {sec >= SESSION_CRIT_SEC ? <StatusIcon status="crit" size={12} /> : sec >= SESSION_WARN_SEC ? <StatusIcon status="warn" size={12} /> : null}
            {formatDurationTable(sec * 1000)}
          </span>
        );
      },
    },
    { id: "wait", header: "대기 이벤트 유형", minWidth: 120, render: (s) => (s.waitEventType ? `${s.waitEventType}${s.waitEvent ? ` · ${s.waitEvent}` : ""}` : "—") },
  ];

  const podCols: Column<PodItem>[] = [
    { id: "status", header: "상태", width: 112, render: (p) => <RowBadge info={p.status} mark={watch} /> },
    {
      id: "name",
      header: "파드",
      minWidth: 160,
      // 진입점 7: DB 파드도 `PodItem`이라 서버 `logHref`를 그대로 쓴다(follow=1). 파드 표 4곳과 같은 아이콘 링크(21.10)
      render: (p) => <ResourceName name={p.name} kind="pod" maxWidth={220} logHref={p.logHref} />,
    },
    { id: "ready", header: "준비", width: 64, numeric: true, render: (p) => `${p.containers.ready}/${p.containers.total}` },
    { id: "restarts", header: "재시작(1h)", width: 88, numeric: true, render: (p) => formatCount(p.restarts.last1h) },
  ];

  const xid = check(checks, "xid_age");
  const dead = check(checks, "deadlocks");
  const repl = check(checks, "replication_lag");
  const totalBytes = h?.sizes?.totalBytes ?? 0;

  return (
    <>
      <PageHeader
        title="데이터베이스"
        status={{ ...top, reason: reasonTexts(db.status) }}
        subtitle={
          [
            h?.server ? `Postgres ${h.server.version}` : db.target?.vendor === "postgres" ? "Postgres" : db.target?.vendor,
            db.target ? `${db.target.namespace} / ${db.target.statefulSet} (StatefulSet)` : null,
            h?.server?.role ?? null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />
      <div className="page-stack">
        {h && !h.reachable && h.error ? <InlineAlert tone="crit" title="DB 접속 실패" description={h.error} /> : null}
        <Grid columns={6} columnsMd={3}>
          <CheckTile
            label="접속 응답"
            c={check(checks, "reachability")}
            mark={mark}
            value={h?.reachable === false ? "실패" : h?.responseMs !== null && h?.responseMs !== undefined ? formatLatency(h.responseMs) : "—"}
          />
          <CheckTile
            label="연결 사용률"
            c={conn}
            mark={mark}
            value={conn?.value !== null && conn?.value !== undefined ? formatPercent(conn.value / 100) : "—"}
            lines={
              h?.connections
                ? [
                    <UsageBar
                      key="u"
                      value={h.connections.usagePct / 100}
                      status={badgeProps(conn?.status, mark).status}
                      warnAt={connTh?.warn !== null && connTh?.warn !== undefined ? connTh.warn / 100 : undefined}
                      critAt={connTh?.crit !== null && connTh?.crit !== undefined ? connTh.crit / 100 : undefined}
                      label={`${formatCount(h.connections.total)} / ${formatCount(h.connections.max)}`}
                      name="연결 사용률"
                    />,
                  ]
                : []
            }
          />
          <CheckTile
            label="긴 쿼리(5분+)"
            c={check(checks, "long_running_queries")}
            mark={mark}
            value={h?.longRunning ? `${formatCount(h.longRunning.activeOverWarn)}건` : "—"}
            lines={h?.longRunning?.maxActiveSec ? [<span key="m">최장 {formatDurationTable(h.longRunning.maxActiveSec * 1000)}</span>] : []}
          />
          <CheckTile
            label="idle in tx(5분+)"
            c={check(checks, "idle_in_transaction")}
            mark={mark}
            value={h?.longRunning ? `${formatCount(h.longRunning.idleInTxOverWarn)}건` : "—"}
            lines={h?.longRunning?.maxIdleInTxSec ? [<span key="m">최장 {formatDurationTable(h.longRunning.maxIdleInTxSec * 1000)}</span>] : []}
          />
          <CheckTile
            label="잠금 대기(1분+)"
            c={check(checks, "lock_waits")}
            mark={mark}
            value={h?.locks ? `${formatCount(h.locks.waitingOverThreshold)}건` : "—"}
          />
          <CheckTile
            label="캐시 적중률"
            c={check(checks, "cache_hit_ratio")}
            mark={mark}
            value={h?.throughput?.cacheHitPct !== null && h?.throughput?.cacheHitPct !== undefined ? formatPercent(h.throughput.cacheHitPct / 100, { digits: 1 }) : "—"}
          />
        </Grid>

        <Grid>
          <GridItem span={6} spanMd={12}>
            <Section title="쿠버네티스" headingLevel={3} badges={k8s ? <StatusBadge size="md" {...badgeProps(k8s.status, watch)} /> : null}>
              <Card padding="none">
                <div className="stack-sm" style={{ padding: "var(--spacing-3) var(--spacing-4)" }}>
                  <ReasonText reasons={reasonTexts(k8s?.status)} status={badgeProps(k8s?.status).status} />
                  <span className="text-body">
                    StatefulSet ready {sts ? `${formatCount(sts.replicas.ready)}/${sts.replicas.desired ?? "?"}` : "—"}
                  </span>
                </div>
                <DataTable
                  caption="DB 파드"
                  density="compact"
                  columns={podCols}
                  rows={k8s?.pods ?? []}
                  rowKey={(p) => p.key}
                  rowStatus={(p) => badgeProps(p.status).status}
                  onRowClick={(p) => router.push(podHref(p.namespace, p.name))}
                  state={k8s?.pods.length ? "ready" : "empty"}
                  emptyProps={{ icon: "box", title: "DB 파드가 없습니다" }}
                />
              </Card>
            </Section>
          </GridItem>
          <GridItem span={6} spanMd={12}>
            <Section title="저장소·안정성" headingLevel={3}>
              <Card>
                <div className="stack">
                  {(k8s?.pvcs ?? []).map((pvc) => {
                    const usage = pvc.usage ?? (db.pvcUsage ? { usedBytes: db.pvcUsage.usedBytes, pct: db.pvcUsage.pct, source: db.pvcUsage.source } : null);
                    return (
                      <div key={pvc.key} className="stack-sm">
                        <div className="row">
                          <span className="text-caption">PVC</span>
                          <ResourceName name={pvc.name} kind="pvc" maxWidth={220} />
                          <Chip label={pvc.phase} />
                          <StatusBadge size="sm" {...badgeProps(pvc.status, watch)} />
                        </div>
                        {usage && pvc.capacityBytes !== null ? (
                          <UsageBar
                            value={usage.pct / 100}
                            status={badgeProps(pvc.status).status}
                            label={`${formatBytes(usage.usedBytes)} / ${formatBytes(pvc.capacityBytes)} (${formatPercent(usage.pct / 100)})`}
                            approximate={usage.source === "db_size_approx"}
                            name="PVC 사용률"
                          />
                        ) : (
                          <span className="text-caption">사용량 출처 없음</span>
                        )}
                      </div>
                    );
                  })}
                  <StabilityRow label="트랜잭션 ID 나이" c={xid} mark={mark} value={h?.xid ? formatXidAge(h.xid.maxAge) : "—"} />
                  <StabilityRow label="데드락(직전 대비)" c={dead} mark={mark} value={h?.throughput?.deadlocksDelta !== null && h?.throughput?.deadlocksDelta !== undefined ? formatCount(h.throughput.deadlocksDelta) : "—"} />
                  <StabilityRow
                    label="복제 지연"
                    c={repl}
                    mark={mark}
                    value={repl?.value !== null && repl?.value !== undefined ? `${formatCount(repl.value)}초` : ""}
                  />
                </div>
              </Card>
            </Section>
          </GridItem>
          <GridItem span={8} spanMd={12}>
            <Section title="세션" headingLevel={3}>
              <div className="stack-sm">
                <InlineAlert tone="info" compact title="쿼리 원문은 수집·표시하지 않습니다." />
                <DataTable
                  caption="가장 오래된 세션"
                  density="compact"
                  columns={sessionCols}
                  rows={sessions}
                  rowKey={(s) => String(s.pid)}
                  rowStale={() => mark.stale}
                  state={h ? (sessions.length ? "ready" : "empty") : "unknown"}
                  unknownReason="DB 접속 실패로 조회 불가"
                  emptyProps={{ icon: "database", title: "세션이 없습니다" }}
                />
              </div>
            </Section>
          </GridItem>
          <GridItem span={4} spanMd={12}>
            <Section title="상태별 세션" headingLevel={3}>
              <Card>
                {h?.connections ? (
                  <div className="stack-sm">
                    <DistributionBar
                      label="상태별 세션"
                      segments={[
                        { value: h.connections.byState.active, color: "var(--color-chart-series-0)", label: "active" },
                        { value: h.connections.byState.idle, color: "var(--color-chart-series-1)", label: "idle" },
                        { value: h.connections.byState.idleInTransaction, status: "warn", label: "idle in tx" },
                        { value: h.connections.byState.idleInTransactionAborted, status: "crit", label: "idle in tx (aborted)" },
                        { value: h.connections.byState.other, color: "var(--color-chart-series-other)", label: "기타" },
                      ]}
                    />
                    <span className="text-caption">
                      active {formatCount(h.connections.byState.active)} / idle {formatCount(h.connections.byState.idle)} / idle in tx{" "}
                      {formatCount(h.connections.byState.idleInTransaction)}
                    </span>
                    {h.throughput ? (
                      <span className="text-caption">
                        커밋 {h.throughput.commitsPerSec !== null ? formatRate(h.throughput.commitsPerSec) : "—"} · 롤백{" "}
                        {h.throughput.rollbacksPerSec !== null ? formatRate(h.throughput.rollbacksPerSec) : "—"}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-caption">—</span>
                )}
              </Card>
            </Section>
          </GridItem>
        </Grid>

        <Section title="DB별 크기">
          <DataTable
            caption="DB별 크기"
            columns={[
              { id: "name", header: "DB 이름", render: (d: { name: string; bytes: number }) => <span className="text-mono">{d.name}</span> },
              { id: "bytes", header: "크기", width: 120, numeric: true, render: (d) => formatBytes(d.bytes) },
              {
                id: "ratio",
                header: "비율",
                width: 200,
                render: (d) => (totalBytes > 0 ? <UsageBar size="sm" value={d.bytes / totalBytes} status="ok" label={formatPercent(d.bytes / totalBytes)} name="비율" /> : "—"),
              },
            ]}
            rows={[...(h?.sizes?.databases ?? [])].sort((a, b) => b.bytes - a.bytes)}
            rowKey={(d) => d.name}
            totalRow={h?.sizes ? { name: "합계", bytes: formatBytes(h.sizes.totalBytes) } : undefined}
            state={h?.sizes ? "ready" : "unknown"}
            unknownReason="DB 접속 실패로 조회 불가"
          />
        </Section>
      </div>
    </>
  );
}

function StabilityRow({ label, c, mark, value }: { label: string; c: DbCheck | undefined; mark: StaleMark; value: string }) {
  return (
    <div className="row-between">
      <span className="text-caption">{label}</span>
      <span className="row">
        {value ? <span className="tabular">{value}</span> : null}
        {c && !c.applicable ? (
          <>
            <Chip label="해당 없음" icon="minus" />
            <span className="text-caption">{c.status.reasons[0]?.text}</span>
          </>
        ) : c ? (
          <>
            <StatusBadge size="sm" {...badgeProps(c.status, mark)} />
            {c.held ? <Chip label="판단 보류" icon="hourglass" /> : null}
          </>
        ) : null}
      </span>
    </div>
  );
}
