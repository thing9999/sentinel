"use client";

/**
 * 노드·파드 상세의 CPU·메모리 추이 (cluster-status.md 4·7절).
 * REST `GET /api/cluster/metrics/series` + 스트림 `metrics.updated` 값을 끝에 붙인다(계약 8.3).
 */
import { useState } from "react";

import { ChartFrame, formatBytes, formatMillicores, formatPercent, formatTime, Grid, GridItem } from "@/components/ui";
import { SeriesTable, TimeSeriesChart, type TimeSeriesPoint } from "@/charts";

import { errorBody, useApi } from "../common/hooks";
import { periodicStale, STALE_AFTER_MS } from "../stream/stale";
import type { StreamState } from "../stream/reducer";
import { thresholdLines } from "./chart-helpers";
import { apiStatus } from "./selectors";
import type { MetricsSeriesResponse, SeriesPoint } from "./types";

export function useAppendedSeries(base: SeriesPoint[] | undefined, live: SeriesPoint | null, maxRangeMs = 3600_000): SeriesPoint[] {
  const [state, setState] = useState<{ base: SeriesPoint[] | undefined; extra: SeriesPoint[] }>({ base, extra: [] });
  if (state.base !== base) {
    setState({ base, extra: [] });
  } else if (live) {
    const lastT = state.extra.length ? state.extra[state.extra.length - 1].t : base?.length ? base[base.length - 1].t : null;
    if (lastT === null || Date.parse(live.t) > Date.parse(lastT)) setState({ base, extra: [...state.extra, live] });
  }
  const all = [...(base ?? []), ...(state.base === base ? state.extra : [])];
  if (all.length === 0) return all;
  const end = Date.parse(all[all.length - 1].t);
  return all.filter((p) => Date.parse(p.t) >= end - maxRangeMs);
}

interface UsageChartsProps {
  target: "node" | "pod";
  name: string;
  namespace?: string;
  stream: StreamState;
  now: number;
  /** 스트림 metrics.updated 에서 만든 최신 표본 (없으면 null) */
  livePoint: SeriesPoint | null;
  height?: "sm" | "md";
}

export function UsageCharts({ target, name, namespace, stream, now, livePoint, height = "md" }: UsageChartsProps) {
  const q = useApi<MetricsSeriesResponse>("/cluster/metrics/series", {
    target,
    name,
    namespace: target === "pod" ? namespace : undefined,
    range: "1h",
  });
  const points = useAppendedSeries(q.data?.points, livePoint);
  const [tableCpu, setTableCpu] = useState(false);
  const [tableMem, setTableMem] = useState(false);

  const res = q.data;
  const notFound = errorBody(q.error)?.code === "RESOURCE_NOT_FOUND";
  const mark = periodicStale(stream, points.length ? points[points.length - 1].t : null, STALE_AFTER_MS.metrics, ["metrics"], now);
  const baseState = q.loading && !res ? "loading" : !res || notFound ? "empty" : !res.available ? "unknown" : points.length === 0 ? "empty" : mark.stale ? "stale" : "ready";
  const observedMin =
    res?.observedSince && Date.parse(res.observedSince) > now - 3600_000
      ? Math.max(0, Math.round((now + stream.serverOffsetMs - Date.parse(res.observedSince)) / 60000))
      : undefined;
  const memBasisLimit = res?.denominators.memoryBasis === "limit";
  const memPct = !(target === "pod" && res && res.denominators.memoryBytes === null);
  const cpuLabel = target === "pod" ? "CPU (requests 대비)" : "CPU 사용률";
  const memLabel = memPct ? (memBasisLimit ? "메모리 (limit 대비)" : "메모리 사용률") : "메모리 사용량";
  const stepSec = res?.stepSec ?? 15;
  const end = now + stream.serverOffsetMs;

  const cpuSeries = [
    {
      id: "cpu",
      label: cpuLabel,
      color: "var(--color-chart-cpu)",
      points: points.map<TimeSeriesPoint>((p) => ({ t: Date.parse(p.t), v: p.cpuPct, status: p.cpuStatus ? apiStatus(p.cpuStatus) : null })),
    },
  ];
  const memSeries = [
    {
      id: "memory",
      label: memLabel,
      color: "var(--color-chart-memory)",
      points: points.map<TimeSeriesPoint>((p) => ({
        t: Date.parse(p.t),
        v: memPct ? p.memoryPct : p.memoryBytes,
        status: p.memoryStatus ? apiStatus(p.memoryStatus) : null,
      })),
    },
  ];
  const byT = new Map(points.map((p) => [Date.parse(p.t), p] as const));
  const unknownReason = res?.unavailableReason?.message ? `알 수 없음 (${res.unavailableReason.message})` : "알 수 없음 (metrics-server 없음)";
  const lastCpu = points.length ? points[points.length - 1].cpuPct : null;
  const lastMem = points.length ? points[points.length - 1].memoryPct : null;

  return (
    <Grid>
      <GridItem span={6} spanMd={12}>
        <ChartFrame
          title="CPU 추이"
          height={height}
          state={baseState}
          unknownReason={unknownReason}
          staleAt={mark.at}
          observedMinutes={observedMin}
          tableView={{ pressed: tableCpu, onToggle: () => setTableCpu((v) => !v) }}
        >
          {tableCpu ? (
            <SeriesTable
              caption="CPU 추이 표"
              columns={["시각", "CPU", "비율"]}
              rows={[...points].reverse().map((p) => ({
                key: p.t,
                cells: [formatTime(p.t, "time"), p.cpuMillicores === null ? "—" : formatMillicores(p.cpuMillicores, true), p.cpuPct === null ? "—" : formatPercent(p.cpuPct / 100, { digits: 1 })],
              }))}
            />
          ) : (
            <TimeSeriesChart
              series={cpuSeries}
              range="1h"
              unit="percent"
              stepSec={stepSec}
              height={height}
              end={end}
              thresholds={thresholdLines(res?.thresholds.cpu)}
              ariaLabel={`${cpuLabel}, 최근 1시간, 현재 ${lastCpu !== null ? formatPercent(lastCpu / 100) : "알 수 없음"}`}
              formatTooltipValue={(_, pt) => {
                const raw = byT.get(pt.t);
                const m = raw?.cpuMillicores;
                return m !== null && m !== undefined && pt.v !== null ? `${formatMillicores(m, true)} (${formatPercent(pt.v / 100)})` : pt.v !== null ? formatPercent(pt.v / 100) : "—";
              }}
            />
          )}
        </ChartFrame>
      </GridItem>
      <GridItem span={6} spanMd={12}>
        <ChartFrame
          title="메모리 추이"
          height={height}
          state={baseState}
          unknownReason={unknownReason}
          staleAt={mark.at}
          observedMinutes={observedMin}
          tableView={{ pressed: tableMem, onToggle: () => setTableMem((v) => !v) }}
        >
          {tableMem ? (
            <SeriesTable
              caption="메모리 추이 표"
              columns={["시각", "메모리", "비율"]}
              rows={[...points].reverse().map((p) => ({
                key: p.t,
                cells: [formatTime(p.t, "time"), p.memoryBytes === null ? "—" : formatBytes(p.memoryBytes), p.memoryPct === null ? "—" : formatPercent(p.memoryPct / 100, { digits: 1 })],
              }))}
            />
          ) : (
            <TimeSeriesChart
              series={memSeries}
              range="1h"
              unit={memPct ? "percent" : "bytes"}
              stepSec={stepSec}
              height={height}
              end={end}
              thresholds={memPct ? thresholdLines(res?.thresholds.memory) : []}
              ariaLabel={`${memLabel}, 최근 1시간, 현재 ${lastMem !== null ? formatPercent(lastMem / 100) : "알 수 없음"}`}
              formatTooltipValue={(_, pt) => {
                const raw = byT.get(pt.t);
                const b = raw?.memoryBytes;
                if (!memPct) return b !== null && b !== undefined ? formatBytes(b) : "—";
                return b !== null && b !== undefined && pt.v !== null ? `${formatBytes(b)} (${formatPercent(pt.v / 100)})` : pt.v !== null ? formatPercent(pt.v / 100) : "—";
              }}
            />
          )}
        </ChartFrame>
      </GridItem>
    </Grid>
  );
}
