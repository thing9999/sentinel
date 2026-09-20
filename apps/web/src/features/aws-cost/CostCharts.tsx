"use client";

/**
 * 비용 차트 3종 (docs/design/status.md 4.9).
 * (a) 시간당 소모율 추이 — REST rate-series + 스트림 cost.rate.sampled 끝점 추가
 * (b) 일별 확정 비용 막대 (합계 | 서비스별)
 * (c) 이번 달 누적과 월말 예측
 */
import { useState } from "react";

import { ChartFrame, Chip, CostKindBadge, formatMoney, SegmentedControl } from "@/components/ui";
import { DailyBarChart, MonthProjectionChart, OTHER_SERVICE, TimeSeriesChart, type ChartRange } from "@/charts";

import { useApi } from "../common/hooks";
import { apiStatus } from "../cluster-status/selectors";
import type { CostRateState } from "../stream/reducer";
import type { StaleMark } from "../stream/stale";
import type { CostActual, CostSummary, RatePoint, RateRange, RateSeries } from "./types";

const RANGE_LABEL: Record<RateRange, string> = { "24h": "24시간", "7d": "7일", "30d": "30일", "90d": "90일" };
/** 스트림 표본(5분)은 같은 해상도(stepSec 300)일 때만 붙인다 */
const SAMPLE_STEP_SEC = 300;

export function mergeRatePoints(rest: RatePoint[], live: RatePoint[], restStepSec: number): RatePoint[] {
  if (restStepSec !== SAMPLE_STEP_SEC || live.length === 0) return rest;
  const last = rest.length ? Date.parse(rest[rest.length - 1].t) : -Infinity;
  return [...rest, ...live.filter((p) => Date.parse(p.t) > last)];
}

export function RateChartCard({ live, mark, now }: { live: CostRateState; mark: StaleMark; now: number }) {
  const [range, setRange] = useState<RateRange>("7d");
  const q = useApi<RateSeries>("/cost/rate-series", { range });
  const data = q.data;
  const points = data ? mergeRatePoints(data.points, live.points, data.stepSec) : [];
  const baseline = live.baseline ?? data?.baseline ?? null;
  const collecting = baseline?.state === "collecting";
  const median = baseline && !collecting ? baseline.medianUsdPerHour : null;
  const state = q.loading && !data ? "loading" : q.error && !data ? "unknown" : points.length === 0 ? "empty" : mark.stale ? "stale" : "ready";
  const last = points[points.length - 1];
  return (
    <ChartFrame
      title="시간당 소모율 추이"
      kind="estimate"
      badges={<CostKindBadge kind="estimate" />}
      height="lg"
      state={state}
      unknownReason="알 수 없음 (소모율 기록을 불러오지 못했습니다)"
      staleAt={mark.at}
      staleFormat="shortTime"
      plotChips={collecting ? <Chip label="기준 수집 중" icon="hourglass" /> : undefined}
      actions={
        <SegmentedControl
          size="sm"
          label="기간"
          value={range}
          onChange={(v) => setRange(v as RateRange)}
          options={(Object.keys(RANGE_LABEL) as RateRange[]).map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
        />
      }
      legend={[{ label: "추정 소모율", color: "var(--color-cost-estimate-solid)", dashed: true }]}
    >
      <TimeSeriesChart
        series={[
          {
            id: "rate",
            label: "추정 소모율",
            color: "var(--color-cost-estimate-solid)",
            dash: "6 3",
            points: points.map((p) => ({ t: Date.parse(p.t), v: p.usdPerHour, status: apiStatus(p.status) })),
          },
        ]}
        range={range as ChartRange}
        unit="usdPerHour"
        stepSec={data?.stepSec ?? SAMPLE_STEP_SEC}
        height="lg"
        end={now}
        valuePrefix="≈ "
        tooltipBadge={<CostKindBadge kind="estimate" />}
        reference={median !== null ? { value: median, label: `7일 중앙값 ${formatMoney(median, "hour")}` } : undefined}
        thresholds={
          baseline && !collecting
            ? [
                ...(baseline.warnAtUsdPerHour !== null ? [{ level: "warn" as const, value: baseline.warnAtUsdPerHour, label: `주의 ${formatMoney(baseline.warnAtUsdPerHour, "hour")}` }] : []),
                ...(baseline.critAtUsdPerHour !== null ? [{ level: "crit" as const, value: baseline.critAtUsdPerHour, label: `급증 ${formatMoney(baseline.critAtUsdPerHour, "hour")}` }] : []),
              ]
            : []
        }
        ariaLabel={`추정 시간당 소모율, 최근 ${RANGE_LABEL[range]}, 현재 ${last ? `약 ${formatMoney(last.usdPerHour, "hour")}` : "알 수 없음"}`}
      />
    </ChartFrame>
  );
}

export function ProjectionCard({ actual, summary, mark, now }: { actual: CostActual; summary: CostSummary; mark: StaleMark; now: number }) {
  const f = actual.forecast;
  const budget = summary.budget.configured ? summary.budget.budgetUsd : null;
  const today = new Date(now).toISOString().slice(0, 10);
  const est = summary.monthEnd.estimated?.amount?.amountUsd ?? null;
  const legend = [
    { label: "확정 누적", color: "var(--color-cost-confirmed-solid)" },
    ...(f?.available ? [{ label: "AWS 예측", color: "var(--color-cost-forecast-solid)", dashed: true }] : []),
    ...(est !== null ? [{ label: "추정 월말", color: "var(--color-cost-estimate-solid)", dashed: true }] : []),
  ];
  return (
    <ChartFrame
      title="이번 달 누적과 월말 예측"
      badges={
        <>
          <CostKindBadge kind="confirmed" />
          {f?.available ? <CostKindBadge kind="forecast" /> : <CostKindBadge kind="estimate" />}
        </>
      }
      height="lg"
      state={!actual.month ? "empty" : mark.stale ? "stale" : "ready"}
      staleAt={mark.at}
      staleFormat="shortTime"
      legend={legend}
    >
      {actual.month ? (
        <MonthProjectionChart
          monthStart={actual.month.start}
          daysInMonth={actual.month.daysInMonth}
          confirmed={actual.monthCumulative}
          forecast={f?.available && f.monthEndUsd !== null ? { points: f.cumulative, monthEndUsd: f.monthEndUsd } : null}
          estimateEnd={est}
          budget={budget}
          warnRatio={(summary.budget.warnPct ?? 90) / 100}
          today={today}
          ariaLabel={`이번 달 확정 누적${f?.monthEndUsd ? `, AWS 예측 월말 ${formatMoney(f.monthEndUsd, "total")}` : ""}${est !== null ? `, 추정 월말 약 ${formatMoney(est, "total")}` : ""}${budget ? `, 예산 ${formatMoney(budget, "total")}` : ""}`}
        />
      ) : null}
    </ChartFrame>
  );
}

export function DailyCard({ actual, mark }: { actual: CostActual; mark: StaleMark }) {
  const [mode, setMode] = useState<"total" | "byService">("total");
  const d = actual.daily;
  const labelOf = (id: string) =>
    id === OTHER_SERVICE ? "기타" : (actual.services?.top.find((s) => s.service === id)?.displayName ?? id);
  const services = d ? [...d.chartTopServices.map((id) => ({ id, label: labelOf(id) })), { id: OTHER_SERVICE, label: "기타" }] : [];
  const legend =
    mode === "byService"
      ? services.map((s, i) => ({ label: s.label, color: s.id === OTHER_SERVICE || i >= 7 ? "var(--color-chart-series-other)" : `var(--color-chart-series-${i})` }))
      : [
          { label: "확정", color: "var(--color-cost-confirmed-solid)" },
          { label: "미확정", color: "var(--color-cost-unsettled-hatch)", hatched: true },
        ];
  return (
    <ChartFrame
      title="일별 비용 최근 30일"
      badges={<CostKindBadge kind="confirmed" />}
      height="lg"
      state={!d || d.items.length === 0 ? "empty" : mark.stale ? "stale" : "ready"}
      staleAt={mark.at}
      staleFormat="shortTime"
      legend={legend}
      actions={
        <SegmentedControl
          size="sm"
          label="표시"
          value={mode}
          onChange={(v) => setMode(v as "total" | "byService")}
          options={[
            { value: "total", label: "합계" },
            { value: "byService", label: "서비스별" },
          ]}
        />
      }
    >
      {d ? (
        <DailyBarChart
          days={d.items.map((i) => ({
            date: i.date,
            total: i.totalUsd,
            unsettled: i.unsettled,
            status: i.spikeStatus ? apiStatus(i.spikeStatus) : null,
            byService: i.byService,
          }))}
          mode={mode}
          services={services}
          reference={d.baselineAvgUsd !== null ? { value: d.baselineAvgUsd, label: `7일 평균 ${formatMoney(d.baselineAvgUsd, "day", { showUnit: false })}` } : undefined}
          ariaLabel={`일별 확정 비용 최근 ${d.days}일`}
        />
      ) : null}
    </ChartFrame>
  );
}
