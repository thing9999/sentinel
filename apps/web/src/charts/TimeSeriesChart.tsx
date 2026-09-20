"use client";

/**
 * 시계열 선 차트 (components.md 9절 TimeSeriesChart, status.md 4.1~4.7).
 * - 곡선 보간 없음(linear), 마커 없음, hover 시 해당 시각 점만 반지름 4px.
 * - 결측: 값 null 또는 표본 간격 > 수집 주기 × 2 이면 선을 끊는다.
 * - 임계선: 1px 점선 `4 4`, 오른쪽 여백에 아이콘 + 라벨. 영역 채우기 없음.
 * - 기준선(reference): 1px 실선 chart.reference.
 * - 선택 범위보다 데이터가 짧으면 X축은 전체 범위를 유지하고 앞쪽에 `수집 전`.
 */
import { scaleLinear } from "d3-scale";
import { line as d3line } from "d3-shape";
import { useMemo, useState, type ReactNode } from "react";

import { cx, Icon, type Status } from "@/components/ui";

import {
  CHART_HEIGHT,
  CHART_MARGIN,
  type ChartHeightKey,
  type ChartRange,
  type ChartUnit,
  formatTick,
  formatTooltipTime,
  formatUnitValue,
  nearestIndex,
  niceMax,
  placeThresholdLabels,
  RANGE_MS,
  splitSegments,
  timeTicks,
  yTicks,
} from "./chart-utils";
import { ChartTooltip, type ChartTooltipRow } from "./ChartTooltip";
import styles from "./charts.module.css";
import { useElementWidth } from "./useElementWidth";

export interface TimeSeriesPoint {
  t: number;
  v: number | null;
  /** 이 표본의 상태 (툴팁 아이콘) */
  status?: Status | null;
}

export interface TimeSeries {
  id: string;
  label: string;
  /** 토큰 CSS 변수 (`var(--color-chart-cpu)`) */
  color: string;
  points: TimeSeriesPoint[];
  /** SVG stroke-dasharray (추정 `6 3`) */
  dash?: string;
}

export interface ThresholdLine {
  level: "warn" | "crit";
  value: number;
  label: string;
}

export interface TimeSeriesChartProps {
  series: TimeSeries[];
  range: ChartRange;
  unit: ChartUnit;
  /** 수집 주기(초) — 결측 판단 */
  stepSec: number;
  height?: ChartHeightKey;
  /** X축 범위 끝 (기본: 마지막 표본 시각). 실시간 차트는 서버 시각 기준 현재를 넘긴다 */
  end?: number;
  thresholds?: ThresholdLine[];
  reference?: { value: number; label: string };
  /** 사용률은 100 고정 */
  yMax?: number;
  /** role=img 요약 */
  ariaLabel: string;
  /** 툴팁 배지 (비용) */
  tooltipBadge?: ReactNode;
  /** 툴팁 값 앞 기호 (추정 `≈ `) */
  valuePrefix?: string;
  /** 툴팁 값 문구를 바꾼다 (`1,250m (62%)`) */
  formatTooltipValue?: (series: TimeSeries, point: TimeSeriesPoint) => string;
  className?: string;
}

export function TimeSeriesChart({
  series,
  range,
  unit,
  stepSec,
  height = "md",
  end,
  thresholds = [],
  reference,
  yMax,
  ariaLabel,
  tooltipBadge,
  valuePrefix = "",
  formatTooltipValue,
  className,
}: TimeSeriesChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const h = CHART_HEIGHT[height];
  const m = CHART_MARGIN;
  const innerW = Math.max(10, width - m.left - m.right);
  const innerH = Math.max(10, h - m.top - m.bottom);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const lastT = useMemo(() => {
    let last = 0;
    for (const s of series) for (const p of s.points) if (p.t > last) last = p.t;
    return last;
  }, [series]);
  const x1 = end ?? lastT;
  const x0 = x1 - RANGE_MS[range];

  const maxV = useMemo(() => {
    let mx = 0;
    for (const s of series) for (const p of s.points) if (p.v !== null && p.t >= x0 && p.v > mx) mx = p.v;
    for (const th of thresholds) mx = Math.max(mx, th.value);
    if (reference) mx = Math.max(mx, reference.value);
    return mx;
  }, [series, thresholds, reference, x0]);

  const top = yMax ?? (unit === "percent" ? 100 : niceMax(maxV));
  const x = scaleLinear().domain([x0, x1]).range([0, innerW]);
  const y = scaleLinear().domain([0, top]).range([innerH, 0]);
  const ticksY = yTicks(top, 4);
  const ticksX = timeTicks(x0, x1, range);
  const strokeW = series.length >= 3 ? 1.5 : 2;
  const stepMs = stepSec * 1000;

  const lineGen = d3line<{ t: number; v: number }>()
    .x((p) => x(p.t))
    .y((p) => y(Math.min(p.v, top)));

  const firstT = useMemo(() => {
    let first = Infinity;
    for (const s of series) for (const p of s.points) if (p.v !== null && p.t < first) first = p.t;
    return first;
  }, [series]);
  const beforeDataW = Number.isFinite(firstT) && firstT > x0 ? x(Math.min(firstT, x1)) : 0;

  const allTs = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) for (const p of s.points) if (p.t >= x0) set.add(p.t);
    return [...set].sort((a, b) => a - b);
  }, [series, x0]);

  const labelPos = placeThresholdLabels(thresholds.map((t) => ({ level: t.level, y: y(t.value) })));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = x.invert(px);
    const i = nearestIndex(allTs, t);
    setHoverT(i >= 0 ? allTs[i] : null);
  };

  let tooltip: ReactNode = null;
  if (hoverT !== null) {
    const rows: (ChartTooltipRow & { raw: number })[] = [];
    for (const s of series) {
      const p = s.points.find((pt) => pt.t === hoverT);
      if (!p || p.v === null) continue;
      rows.push({
        label: s.label,
        color: s.color,
        dashed: Boolean(s.dash),
        value: formatTooltipValue ? formatTooltipValue(s, p) : `${valuePrefix}${formatUnitValue(p.v, unit, true)}`,
        status: p.status ?? undefined,
        raw: p.v,
      });
    }
    rows.sort((a, b) => b.raw - a.raw);
    if (rows.length) {
      tooltip = (
        <ChartTooltip
          time={formatTooltipTime(hoverT, range)}
          rows={rows}
          badge={tooltipBadge}
          x={m.left + x(hoverT)}
          y={m.top}
          width={width}
        />
      );
    }
  }

  return (
    <div ref={ref} className={cx(styles.root, className)} role="img" aria-label={ariaLabel}>
      <svg className={styles.svg} width={width} height={h} aria-hidden="true">
        <g transform={`translate(${m.left},${m.top})`}>
          {ticksY.map((v) => (
            <g key={`y-${v}`}>
              <line className={styles.gridLine} x1={0} x2={innerW} y1={y(v)} y2={y(v)} />
              <text className={styles.axisLabel} x={-8} y={y(v)} dy="0.32em" textAnchor="end">
                {formatUnitValue(v, unit)}
              </text>
            </g>
          ))}
          <line className={styles.axisLine} x1={0} x2={innerW} y1={innerH} y2={innerH} />
          {ticksX.map((t) => (
            <text key={`x-${t}`} className={styles.axisLabel} x={x(t)} y={innerH + 16} textAnchor="middle">
              {formatTick(t, range)}
            </text>
          ))}
          {thresholds.map((th) => (
            <line
              key={`th-${th.level}`}
              x1={0}
              x2={innerW}
              y1={y(th.value)}
              y2={y(th.value)}
              style={{ stroke: th.level === "crit" ? "var(--color-chart-threshold-crit)" : "var(--color-chart-threshold-warn)" }}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}
          {reference ? (
            <line
              x1={0}
              x2={innerW}
              y1={y(reference.value)}
              y2={y(reference.value)}
              style={{ stroke: "var(--color-chart-reference)" }}
              strokeWidth={1}
            />
          ) : null}
          {series.map((s) =>
            splitSegments(
              s.points.filter((p) => p.t >= x0 - stepMs * 2),
              stepMs,
            ).map((seg, i) =>
              seg.length === 1 ? (
                <circle key={`${s.id}-${i}`} cx={x(seg[0].t)} cy={y(Math.min(seg[0].v, top))} r={strokeW} style={{ fill: s.color }} />
              ) : (
                <path
                  key={`${s.id}-${i}`}
                  className={styles.series}
                  d={lineGen(seg) ?? undefined}
                  style={{ stroke: s.color }}
                  strokeWidth={strokeW}
                  strokeDasharray={s.dash}
                />
              ),
            ),
          )}
          {hoverT !== null ? (
            <>
              <line className={styles.crosshair} x1={x(hoverT)} x2={x(hoverT)} y1={0} y2={innerH} />
              {series.map((s) => {
                const p = s.points.find((pt) => pt.t === hoverT);
                if (!p || p.v === null) return null;
                return (
                  <circle
                    key={`hp-${s.id}`}
                    className={styles.hoverPoint}
                    cx={x(p.t)}
                    cy={y(Math.min(p.v, top))}
                    r={4}
                    style={{ fill: s.color }}
                  />
                );
              })}
            </>
          ) : null}
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHoverT(null)}
          />
        </g>
      </svg>
      <div className={styles.overlay} aria-hidden="true">
        {beforeDataW > 40 ? (
          <span className={styles.beforeData} style={{ left: m.left + beforeDataW / 2 }}>
            수집 전
          </span>
        ) : null}
        {thresholds.map((th) => (
          <span
            key={`lbl-${th.level}`}
            className={cx(
              styles.lineLabel,
              th.level === "crit" ? styles.critLabel : styles.warnLabel,
              labelPos[th.level] === "below" && styles.lineLabelBelow,
            )}
            style={{ right: m.right, top: m.top + y(th.value) }}
          >
            <Icon name={th.level === "crit" ? "octagon-x" : "triangle-alert"} size={10} />
            {th.label}
          </span>
        ))}
        {reference ? (
          <span className={cx(styles.lineLabel, styles.refLabel)} style={{ right: m.right, top: m.top + y(reference.value) }}>
            {reference.label}
          </span>
        ) : null}
      </div>
      {tooltip}
    </div>
  );
}
