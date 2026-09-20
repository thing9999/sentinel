"use client";

/** 분석 이력 (architecture-advisor.md 2.7). 최근 10행 + 더 보기(10행씩), 보관 기준 caption. */
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Button,
  Chip,
  DataTable,
  formatCount,
  formatDurationTable,
  formatMoney,
  formatTime,
  RUN_REASON_LABEL,
  runStatusBadge,
  Section,
  SeverityIcon,
  StatusBadge,
  toRunFailReason,
  type Column,
} from "@/components/ui";

import { useApi } from "../common/hooks";
import type { RunSummary, RunsResponse } from "./types";

const PAGE = 10;
const MAX = 50;

export function historyColumns(): Column<RunSummary>[] {
  return [
    { id: "requestedAt", header: "시작", width: 140, render: (r) => <span suppressHydrationWarning>{formatTime(r.requestedAt, "autoShort")}</span> },
    {
      id: "status",
      header: "상태",
      width: 112,
      render: (r) => (
        <span className="row">
          <StatusBadge size="sm" {...runStatusBadge(r.status)} />
          {r.isExample ? <Chip label="예시" icon="flask-conical" /> : null}
        </span>
      ),
    },
    {
      id: "reason",
      header: "사유",
      width: 160,
      render: (r) => (r.status === "failed" ? RUN_REASON_LABEL[toRunFailReason(r.failureReason)] : r.status === "cancelled" ? RUN_REASON_LABEL.cancelled : ""),
    },
    { id: "duration", header: "소요", width: 80, numeric: true, render: (r) => (r.durationMs !== null ? formatDurationTable(r.durationMs) : "—") },
    {
      id: "counts",
      header: "제안",
      width: 160,
      render: (r) =>
        r.status === "succeeded" ? (
          <span className="row">
            <SeverityIcon severity="high" size={10} /> 높음 {formatCount(r.counts.high)}
            <span aria-hidden="true">·</span>
            <SeverityIcon severity="medium" size={10} /> 중간 {formatCount(r.counts.medium)}
            <span aria-hidden="true">·</span>
            <SeverityIcon severity="low" size={10} /> 낮음 {formatCount(r.counts.low)}
          </span>
        ) : (
          ""
        ),
    },
    {
      id: "snapshot",
      header: "스냅샷 요약",
      minWidth: 200,
      render: (r) =>
        r.snapshotSummary ? (
          <span>
            노드 {formatCount(r.snapshotSummary.nodeCount)} · 워크로드 {formatCount(r.snapshotSummary.workloadCount)}
            {r.snapshotSummary.estimatedMonthly ? ` · 추정 월 ≈ ${formatMoney(r.snapshotSummary.estimatedMonthly.amountUsd, "month")}` : ""}
          </span>
        ) : (
          "—"
        ),
    },
  ];
}

export function HistorySection({ refreshKey, retention }: { refreshKey: string; retention?: { maxCount: number; maxDays: number } }) {
  const router = useRouter();
  const [limit, setLimit] = useState(PAGE);
  const q = useApi<RunsResponse>("/advisor/runs", { limit }, refreshKey);
  const data = q.data;
  const ret = data?.retention ?? retention;
  return (
    <Section
      title="분석 이력"
      meta={ret ? `최근 ${formatCount(ret.maxCount)}건 또는 ${formatCount(ret.maxDays)}일까지 보관` : undefined}
    >
      <div className="stack-sm">
        <DataTable
          caption="분석 이력"
          columns={historyColumns()}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/advisor/runs/${encodeURIComponent(r.id)}`)}
          state={!data ? (q.error ? "error" : "loading") : data.items.length ? "ready" : "empty"}
          onRetry={q.reload}
          emptyProps={{ icon: "history", title: "아직 분석 이력이 없습니다" }}
          loadingRows={3}
        />
        {data && data.filteredTotal > data.items.length && limit < MAX ? (
          <Button variant="ghost" size="sm" onClick={() => setLimit((l) => Math.min(MAX, l + PAGE))} loading={q.loading}>
            더 보기
          </Button>
        ) : null}
      </div>
    </Section>
  );
}
