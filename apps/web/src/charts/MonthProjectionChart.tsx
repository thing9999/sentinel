"use client";

/**
 * 이번 달 누적과 월말 예측 (components.md 9절 MonthProjectionChart, status.md 4.9(c)).
 * - 확정 누적: 2px 실선 cost.confirmed.solid (1일 ~ 반영 기준일)
 * - AWS 예측: 2px 점선 `4 4` cost.forecast.solid + 80% 구간 띠 cost.forecast.band, 말일 원 마커 + `AWS 예측 $845`
 * - 추정 월말: 말일 마름모 마커 + `추정 ≈ $830` (선 없음). AWS 예측이 없으면 반영 기준일~말일 점선 `6 3`
 * - 예산선 `8 4`, 90% 선 `2 3`, 오늘 세로선 `2 2`
 * 모든 값은 서버 값 그대로 그린다(누적·예측을 화면에서 계산하지 않음).
 */
import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import { useState, type ReactNode } from "react";

import { cx, formatMoney, formatPercent } from "@/components/ui";

import { CHART_HEIGHT, CHART_MARGIN, type ChartHeightKey, formatDayLabel, niceMax, yTicks } from "./chart-utils";
import { ChartTooltip, type ChartTooltipRow } from "./ChartTooltip";
import styles from "./charts.module.css";
import { useElementWidth } from "./useElementWidth";

export interface MonthProjectionChartProps {
  /** YYYY-MM-DD (UTC 날짜) */
  monthStart: string;
  daysInMonth: number;
  /** 확정 누적 (서버 monthCumulative) */
  confirmed: { date: string; usd: number }[];
  /** AWS 예측 누적 곡선 (서버 forecast.cumulative) + 말일 값 */
  forecast?: { points: { date: string; usd: number; lowUsd: number; highUsd: number }[]; monthEndUsd: number } | null;
  /** 추정 월말 (서버 monthEnd.estimated) */
  estimateEnd?: number | null;
  budget?: number | null;
  /** 주의 비율 (서버 warnPct / 100) */
  warnRatio?: number;
  /** 오늘 (YYYY-MM-DD) */
  today?: string | null;
  height?: ChartHeightKey;
  ariaLabel: string;
  className?: string;
}

const dayOf = (date: string) => Number(date.split("-")[2]);

export function MonthProjectionChart({
  monthStart,
  daysInMonth,
  confirmed,
  forecast,
  estimateEnd,
  budget,
  warnRatio = 0.9,
  today,
  height = "lg",
  ariaLabel,
  className,
}: MonthProjectionChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const h = CHART_HEIGHT[height];
  const m = CHART_MARGIN;
  const innerW = Math.max(10, width - m.left - m.right);
  const innerH = Math.max(10, h - m.top - m.bottom);
  const [hoverDay, setHoverDay] = useState<number | null>(null);

  const values = [
    ...confirmed.map((p) => p.usd),
    ...(forecast?.points.map((p) => p.highUsd) ?? []),
    forecast?.monthEndUsd ?? 0,
    estimateEnd ?? 0,
    budget ?? 0,
  ];
  const top = niceMax(Math.max(0, ...values));
  const x = scaleLinear().domain([1, daysInMonth]).range([0, innerW]);
  const y = scaleLinear().domain([0, top]).range([innerH, 0]);

  const conf = confirmed.map((p) => ({ d: dayOf(p.date), v: p.usd }));
  const last = conf[conf.length - 1];
  const lineGen = d3line<{ d: number; v: number }>()
    .x((p) => x(p.d))
    .y((p) => y(p.v));

  const fc = forecast?.points.map((p) => ({ d: dayOf(p.date), v: p.usd, lo: p.lowUsd, hi: p.highUsd })) ?? [];
  // 예측 선·띠는 마지막 확정 점에서 이어 그린다(값을 만들지 않고 두 서버 곡선을 잇기만 한다)
  const fcLine = last && fc.length ? [{ d: last.d, v: last.v }, ...fc] : fc;
  const band = d3area<{ d: number; lo: number; hi: number }>()
    .x((p) => x(p.d))
    .y0((p) => y(p.lo))
    .y1((p) => y(p.hi));
  const bandPts = last && fc.length ? [{ d: last.d, lo: last.v, hi: last.v }, ...fc] : fc;

  const endX = x(daysInMonth);
  const todayDay = today && today.slice(0, 7) === monthStart.slice(0, 7) ? dayOf(today) : null;
  const warnLine = budget ? budget * warnRatio : null;

  // 두 끝 라벨이 겹치면 추정 라벨을 아래로 내린다
  const fY = forecast ? y(forecast.monthEndUsd) : null;
  const eY = estimateEnd !== null && estimateEnd !== undefined ? y(estimateEnd) : null;
  const eBelow = fY !== null && eY !== null && Math.abs(fY - eY) < 16;

  let tooltip: ReactNode = null;
  if (hoverDay !== null) {
    const rows: ChartTooltipRow[] = [];
    const c = conf.find((p) => p.d === hoverDay);
    if (c) rows.push({ label: "확정 누적", color: "var(--color-cost-confirmed-solid)", value: formatMoney(c.v, "total") });
    const f = fc.find((p) => p.d === hoverDay);
    if (f) {
      rows.push({ label: "AWS 예측", color: "var(--color-cost-forecast-solid)", value: formatMoney(f.v, "total"), dashed: true });
      rows.push({
        label: "80% 구간",
        color: "var(--color-cost-forecast-band)",
        value: `${formatMoney(f.lo, "total")} – ${formatMoney(f.hi, "total")}`,
      });
    }
    if (hoverDay === daysInMonth && estimateEnd !== null && estimateEnd !== undefined) {
      rows.push({ label: "추정 월말", color: "var(--color-cost-estimate-solid)", value: `≈ ${formatMoney(estimateEnd, "total")}`, dashed: true });
    }
    if (rows.length) {
      const date = `${monthStart.slice(0, 8)}${String(hoverDay).padStart(2, "0")}`;
      tooltip = <ChartTooltip time={formatDayLabel(date)} rows={rows} x={m.left + x(hoverDay)} y={m.top} width={width} />;
    }
  }

  const diamond = (cx0: number, cy0: number, r: number) => `M${cx0},${cy0 - r}L${cx0 + r},${cy0}L${cx0},${cy0 + r}L${cx0 - r},${cy0}Z`;

  return (
    <div ref={ref} className={cx(styles.root, className)} role="img" aria-label={ariaLabel}>
      <svg className={styles.svg} width={width} height={h} aria-hidden="true">
        <g transform={`translate(${m.left},${m.top})`}>
          {yTicks(top, 4).map((v) => (
            <g key={`y-${v}`}>
              <line className={styles.gridLine} x1={0} x2={innerW} y1={y(v)} y2={y(v)} />
              <text className={styles.axisLabel} x={-8} y={y(v)} dy="0.32em" textAnchor="end">
                {formatMoney(v, "total")}
              </text>
            </g>
          ))}
          <line className={styles.axisLine} x1={0} x2={innerW} y1={innerH} y2={innerH} />
          {[1, 8, 15, 22, daysInMonth].map((d) => (
            <text key={`x-${d}`} className={styles.axisLabel} x={x(d)} y={innerH + 16} textAnchor="middle">
              {`${Number(monthStart.slice(5, 7))}/${d}`}
            </text>
          ))}
          {bandPts.length > 1 ? <path d={band(bandPts) ?? undefined} style={{ fill: "var(--color-cost-forecast-band)" }} /> : null}
          {budget ? (
            <line x1={0} x2={innerW} y1={y(budget)} y2={y(budget)} style={{ stroke: "var(--color-cost-budget-line)" }} strokeWidth={1.5} strokeDasharray="8 4" />
          ) : null}
          {warnLine ? (
            <line x1={0} x2={innerW} y1={y(warnLine)} y2={y(warnLine)} style={{ stroke: "var(--color-cost-budget-warn-line)" }} strokeWidth={1} strokeDasharray="2 3" />
          ) : null}
          {todayDay ? (
            <line x1={x(todayDay)} x2={x(todayDay)} y1={0} y2={innerH} style={{ stroke: "var(--color-chart-now-line)" }} strokeWidth={1} strokeDasharray="2 2" />
          ) : null}
          {conf.length > 1 ? (
            <path className={styles.series} d={lineGen(conf) ?? undefined} style={{ stroke: "var(--color-cost-confirmed-solid)" }} strokeWidth={2} />
          ) : null}
          {fcLine.length > 1 ? (
            <path className={styles.series} d={lineGen(fcLine) ?? undefined} style={{ stroke: "var(--color-cost-forecast-solid)" }} strokeWidth={2} strokeDasharray="4 4" />
          ) : null}
          {!forecast && last && estimateEnd !== null && estimateEnd !== undefined ? (
            <path
              className={styles.series}
              d={lineGen([{ d: last.d, v: last.v }, { d: daysInMonth, v: estimateEnd }]) ?? undefined}
              style={{ stroke: "var(--color-cost-estimate-solid)" }}
              strokeWidth={2}
              strokeDasharray="6 3"
            />
          ) : null}
          {forecast ? <circle cx={endX} cy={y(forecast.monthEndUsd)} r={5} style={{ fill: "var(--color-cost-forecast-solid)" }} /> : null}
          {eY !== null ? <path d={diamond(endX, eY, 5)} style={{ fill: "var(--color-cost-estimate-solid)" }} /> : null}
          {hoverDay !== null ? <line className={styles.crosshair} x1={x(hoverDay)} x2={x(hoverDay)} y1={0} y2={innerH} /> : null}
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const d = Math.round(x.invert(e.clientX - rect.left));
              setHoverDay(Math.min(daysInMonth, Math.max(1, d)));
            }}
            onMouseLeave={() => setHoverDay(null)}
          />
        </g>
      </svg>
      <div className={styles.overlay} aria-hidden="true">
        {todayDay ? (
          <span className={styles.nowLabel} style={{ left: m.left + x(todayDay), top: m.top }}>
            오늘
          </span>
        ) : null}
        {budget ? (
          <span className={cx(styles.lineLabel, styles.budgetLabel)} style={{ right: m.right, top: m.top + y(budget) }}>
            예산 {formatMoney(budget, "total")}
          </span>
        ) : null}
        {warnLine ? (
          <span
            className={cx(styles.lineLabel, styles.budgetWarnLabel, styles.lineLabelBelow)}
            style={{ right: m.right, top: m.top + y(warnLine) }}
          >
            {formatPercent(warnRatio)} {formatMoney(warnLine, "total")}
          </span>
        ) : null}
        {forecast && fY !== null ? (
          <span
            className={cx(styles.lineLabel, styles.forecastLabel)}
            style={{ left: m.left + endX - 8, top: m.top + fY - 6, transform: "translate(-100%, -100%)" }}
          >
            AWS 예측 {formatMoney(forecast.monthEndUsd, "total")}
          </span>
        ) : null}
        {eY !== null && estimateEnd !== null && estimateEnd !== undefined ? (
          <span
            className={cx(styles.lineLabel, styles.estimateLabel)}
            style={{
              left: m.left + endX - 8,
              top: m.top + eY + (eBelow ? 8 : -6),
              transform: eBelow ? "translate(-100%, 0)" : "translate(-100%, -100%)",
            }}
          >
            추정 ≈ {formatMoney(estimateEnd, "total")}
          </span>
        ) : null}
      </div>
      {tooltip}
    </div>
  );
}
