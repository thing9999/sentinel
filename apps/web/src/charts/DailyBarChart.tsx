"use client";

/**
 * 일별 확정 비용 막대 (components.md 9절 DailyBarChart, status.md 4.9(b)).
 * - 막대 cost.confirmed.solid, 최대 폭 24px, 막대 간 간격 = 밴드 폭 25%, 위 모서리 radius 2px.
 * - 미확정일: cost.unsettled.fill + 45° 빗금(cost.unsettled.hatch), X축 아래 `미확정`.
 * - 서비스별: 서버가 준 상위 7개 + 기타(`_other`, chart.seriesOther)를 쌓는다. 값은 서버 값 그대로.
 * - 급증일: 막대 위 4px 에 12px 상태 아이콘.
 * - 기준선(7일 평균): 1px 실선 chart.reference + 라벨(플롯 안 오른쪽 끝, 선 위. 좁은 폭에서 넘치지 않게).
 */
import { scaleBand, scaleLinear } from "d3-scale";
import { useId, useState, type ReactNode } from "react";

import { CostKindBadge, cx, formatMoney, StatusIcon, type Status } from "@/components/ui";

import { CHART_HEIGHT, CHART_MARGIN, type ChartHeightKey, formatDayLabel, niceMax, yTicks } from "./chart-utils";
import { ChartTooltip, type ChartTooltipRow } from "./ChartTooltip";
import styles from "./charts.module.css";
import { useElementWidth } from "./useElementWidth";

export interface DailyBar {
  date: string;
  total: number;
  unsettled: boolean;
  status?: Status | null;
  byService?: { service: string; usd: number }[];
}

export interface DailyService {
  id: string;
  label: string;
}

export interface DailyBarChartProps {
  days: DailyBar[];
  mode: "total" | "byService";
  /** 쌓는 순서(아래→위): 서버 chartTopServices 순서 + `_other` */
  services?: DailyService[];
  reference?: { value: number; label: string };
  height?: ChartHeightKey;
  ariaLabel: string;
  className?: string;
}

export const OTHER_SERVICE = "_other";

export function serviceColor(index: number, id: string): string {
  if (id === OTHER_SERVICE || index >= 7) return "var(--color-chart-series-other)";
  return `var(--color-chart-series-${index})`;
}

function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const shortDate = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}`;
};

export function DailyBarChart({
  days,
  mode,
  services = [],
  reference,
  height = "lg",
  ariaLabel,
  className,
}: DailyBarChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hatchId = `hatch-${uid}`;
  const h = CHART_HEIGHT[height];
  const m = CHART_MARGIN;
  const innerW = Math.max(10, width - m.left - m.right);
  const innerH = Math.max(10, h - m.top - m.bottom - 12); // 아래 `미확정` 줄 자리
  const [hover, setHover] = useState<number | null>(null);

  const maxV = Math.max(0, ...days.map((d) => d.total), reference?.value ?? 0);
  const top = niceMax(maxV);
  const x = scaleBand<string>()
    .domain(days.map((d) => d.date))
    .range([0, innerW])
    .paddingInner(0.25)
    .paddingOuter(0.125);
  const y = scaleLinear().domain([0, top]).range([innerH, 0]);
  const barW = Math.min(24, x.bandwidth());
  const labelEvery = Math.max(1, Math.ceil(36 / Math.max(1, x.step())));

  const bars: ReactNode[] = [];
  days.forEach((d, i) => {
    const bx = (x(d.date) ?? 0) + (x.bandwidth() - barW) / 2;
    const fill = d.unsettled ? "var(--color-cost-unsettled-fill)" : "var(--color-cost-confirmed-solid)";
    if (mode === "byService" && d.byService && d.byService.length > 0) {
      let acc = 0;
      const order = services.length ? services.map((s) => s.id) : d.byService.map((s) => s.service);
      const segs = order
        .map((id) => ({ id, usd: d.byService!.find((s) => s.service === id)?.usd ?? 0 }))
        .filter((s) => s.usd > 0);
      segs.forEach((s, si) => {
        const y0 = y(acc);
        acc += s.usd;
        const y1 = y(acc);
        const idx = services.findIndex((x2) => x2.id === s.id);
        const color = serviceColor(idx < 0 ? 7 : idx, s.id);
        const isTop = si === segs.length - 1;
        bars.push(
          <path
            key={`${d.date}-${s.id}`}
            d={isTop ? roundedTopRect(bx, y1, barW, y0 - y1, 2) : `M${bx},${y0}V${y1}H${bx + barW}V${y0}Z`}
            style={{ fill: color, opacity: d.unsettled ? 0.45 : 1 }}
          />,
        );
      });
      if (d.unsettled && acc > 0) {
        bars.push(
          <path key={`${d.date}-hatch`} d={roundedTopRect(bx, y(acc), barW, innerH - y(acc), 2)} fill={`url(#${hatchId})`} />,
        );
      }
    } else {
      const by = y(d.total);
      bars.push(<path key={d.date} d={roundedTopRect(bx, by, barW, innerH - by, 2)} style={{ fill }} />);
      if (d.unsettled) {
        bars.push(<path key={`${d.date}-hatch`} d={roundedTopRect(bx, by, barW, innerH - by, 2)} fill={`url(#${hatchId})`} />);
      }
    }
    if (hover === i) {
      bars.push(
        <rect
          key={`${d.date}-hl`}
          x={(x(d.date) ?? 0) - (x.step() - x.bandwidth()) / 2}
          y={0}
          width={x.step()}
          height={innerH}
          style={{ fill: "var(--color-bg-hover)", opacity: 0.4 }}
        />,
      );
    }
  });

  let tooltip: ReactNode = null;
  if (hover !== null && days[hover]) {
    const d = days[hover];
    const rows: ChartTooltipRow[] = [
      { label: "합계", color: "var(--color-cost-confirmed-solid)", value: formatMoney(d.total, "day"), status: d.status ?? undefined },
    ];
    if (mode === "byService" && d.byService) {
      const sorted = [...d.byService].sort((a, b) => b.usd - a.usd);
      for (const s of sorted) {
        const idx = services.findIndex((x2) => x2.id === s.service);
        rows.push({
          label: services[idx]?.label ?? (s.service === OTHER_SERVICE ? "기타" : s.service),
          color: serviceColor(idx < 0 ? 7 : idx, s.service),
          value: formatMoney(s.usd, "day"),
        });
      }
    }
    tooltip = (
      <ChartTooltip
        time={formatDayLabel(d.date)}
        note={d.unsettled ? "미확정 · 값이 늘어날 수 있음" : undefined}
        badge={<CostKindBadge kind="confirmed" />}
        rows={rows}
        x={m.left + (x(d.date) ?? 0) + x.bandwidth() / 2}
        y={m.top}
        width={width}
      />
    );
  }

  return (
    <div ref={ref} className={cx(styles.root, className)} role="img" aria-label={ariaLabel}>
      <svg className={styles.svg} width={width} height={h} aria-hidden="true">
        <defs>
          <pattern id={hatchId} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={4} style={{ stroke: "var(--color-cost-unsettled-hatch)" }} strokeWidth={1} />
          </pattern>
        </defs>
        <g transform={`translate(${m.left},${m.top})`}>
          {yTicks(top, 4).map((v) => (
            <g key={`y-${v}`}>
              <line className={styles.gridLine} x1={0} x2={innerW} y1={y(v)} y2={y(v)} />
              <text className={styles.axisLabel} x={-8} y={y(v)} dy="0.32em" textAnchor="end">
                {formatMoney(v, "total")}
              </text>
            </g>
          ))}
          {bars}
          <line className={styles.axisLine} x1={0} x2={innerW} y1={innerH} y2={innerH} />
          {days.map((d, i) =>
            i % labelEvery === 0 || i === days.length - 1 ? (
              <text
                key={`x-${d.date}`}
                className={styles.axisLabel}
                x={(x(d.date) ?? 0) + x.bandwidth() / 2}
                y={innerH + 16}
                textAnchor="middle"
              >
                {shortDate(d.date)}
              </text>
            ) : null,
          )}
          {reference ? (
            <line x1={0} x2={innerW} y1={y(reference.value)} y2={y(reference.value)} style={{ stroke: "var(--color-chart-reference)" }} strokeWidth={1} />
          ) : null}
          {days.map((d, i) => (
            <rect
              key={`hit-${d.date}`}
              x={(x(d.date) ?? 0) - (x.step() - x.bandwidth()) / 2}
              y={0}
              width={x.step()}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </g>
      </svg>
      <div className={styles.overlay} aria-hidden="true">
        {days.map((d) => {
          const cx0 = m.left + (x(d.date) ?? 0) + x.bandwidth() / 2;
          return (
            <span key={`o-${d.date}`}>
              {d.status === "warn" || d.status === "crit" ? (
                <span className={styles.barIcon} style={{ left: cx0, top: m.top + y(d.total) - 4 }}>
                  <StatusIcon status={d.status} size={12} />
                </span>
              ) : null}
              {d.unsettled ? (
                <span className={styles.unsettledLabel} style={{ left: cx0, top: m.top + innerH + 20 }}>
                  미확정
                </span>
              ) : null}
            </span>
          );
        })}
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
