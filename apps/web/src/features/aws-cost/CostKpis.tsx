"use client";

/** KPI 타일 5개 (docs/design/aws-cost.md 2.3). 금액·비율은 서버 값 그대로. */
import {
  BudgetGauge,
  Chip,
  CostKindBadge,
  formatCount,
  formatMonthDay,
  formatPercent,
  formatTime,
  MetricTile,
  MoneyValue,
  projectedKindFromBasis,
  RangeValue,
  StatusBadge,
  StatusIcon,
  type StatusAltLabel,
} from "@/components/ui";

import type { StatusInfo } from "../common/types";
import { badgeProps, type StaleMark } from "../stream/stale";
import type { CostStatus, CostSummary } from "./types";

export function costAltLabel(info: StatusInfo | null | undefined, area: "budget" | "spike" | "overall"): StatusAltLabel | undefined {
  if (!info || info.status !== "critical") return undefined;
  if (area === "budget") return "초과";
  if (area === "spike") return "급증";
  const code = info.reasons[0]?.code ?? "";
  if (code.startsWith("BUDGET")) return "초과";
  if (code.startsWith("SPIKE")) return "급증";
  return undefined;
}

function chipsWithMore(chips: React.ReactNode[], max = 2) {
  if (chips.length <= max) return chips;
  return [...chips.slice(0, max), <Chip key="more" label={`외 ${chips.length - max}`} />];
}

export interface KpiProps {
  summary: CostSummary;
  status: CostStatus | null;
  estimateMark: StaleMark;
  actualMark: StaleMark;
  onUnpricedClick?: () => void;
}

export function RateTile({ summary, estimateMark }: KpiProps) {
  const r = summary.rate;
  if (!r.available || !r.hourly) {
    return <MetricTile label="추정 시간당 소모율" kind="estimate" value={null} state="unknown" unknownReason={r.unavailable?.message} badge={<CostKindBadge kind="estimate" />} />;
  }
  const w = r.warnings;
  const chips: React.ReactNode[] = [];
  if (w?.unpricedCount) chips.push(<Chip key="unpriced" tone="warn" icon="triangle-alert" label={`단가 없음 ${formatCount(w.unpricedCount)}개 제외`} />);
  if (w?.spotFallbackCount)
    chips.push(<Chip key="spot" tone="warn" icon="triangle-alert" label={`스팟 시세 조회 실패 ${formatCount(w.spotFallbackCount)}대 (온디맨드 기준 상한)`} />);
  if (w?.outOfClusterCount) chips.push(<Chip key="out" label={`클러스터 외 리소스 ${formatCount(w.outOfClusterCount)}개 (합계 제외)`} />);
  if (w?.priceCacheUsed) chips.push(<Chip key="cache" tone="warn" icon="triangle-alert" label="단가 캐시 사용" />);
  return (
    <MetricTile
      label="추정 시간당 소모율"
      kind="estimate"
      badge={<CostKindBadge kind="estimate" />}
      staleAt={estimateMark.stale ? estimateMark.at : undefined}
      value={<MoneyValue amount={r.hourly.amountUsd} kind="estimate" unit="hour" size="xl" asOf={r.hourly.asOf} stale={estimateMark.stale} />}
      lines={[
        <span key="d" className="row">
          {r.daily ? <MoneyValue amount={r.daily.amountUsd} kind="estimate" unit="day" size="sm" asOf={r.daily.asOf} /> : "—"}
          <span aria-hidden="true">·</span>
          {r.monthly ? <MoneyValue amount={r.monthly.amountUsd} kind="estimate" unit="month" size="sm" asOf={r.monthly.asOf} /> : "—"}
        </span>,
        <span key="t" suppressHydrationWarning>
          {formatTime(r.hourly.asOf, "autoShort")} 조회
        </span>,
      ]}
      footer={chips.length ? <span className="row">{chipsWithMore(chips)}</span> : undefined}
    />
  );
}

export function MonthToDateTile({ summary, actualMark }: KpiProps) {
  const m = summary.monthToDate;
  if (!m.available || !m.amount) {
    return <MetricTile label="이번 달 확정 누적" kind="confirmed" value={null} state="unknown" unknownReason={m.unavailable?.message} badge={<CostKindBadge kind="confirmed" />} />;
  }
  return (
    <MetricTile
      label="이번 달 확정 누적"
      kind="confirmed"
      badge={<CostKindBadge kind="confirmed" />}
      staleAt={actualMark.stale ? actualMark.at : undefined}
      value={<MoneyValue amount={m.amount.amountUsd} kind="confirmed" unit="total" size="xl" asOf={m.amount.asOf} stale={actualMark.stale} />}
      lines={[
        m.settledThrough ? (
          <span key="s" suppressHydrationWarning>
            {formatMonthDay(m.settledThrough)}까지 반영 · 최대 24시간 지연
          </span>
        ) : null,
        m.lastMonthSamePeriod ? (
          <span key="l" className="row">
            지난달 같은 기간 <MoneyValue amount={m.lastMonthSamePeriod.amountUsd} kind="confirmed" unit="total" size="sm" />
            {m.changePct !== null ? `(${formatPercent(m.changePct / 100, { signed: true })})` : null}
          </span>
        ) : null,
      ].filter(Boolean)}
      footer={
        m.scope === "account" ? (
          <Chip label="계정 전체 기준" icon="building-2" />
        ) : m.scope === "tag_filter" ? (
          <Chip label="태그 필터 기준" />
        ) : undefined
      }
    />
  );
}

export function MonthEndTile({ summary, actualMark, estimateMark }: KpiProps) {
  const f = summary.monthEnd.forecast;
  const e = summary.monthEnd.estimated;
  if (f.available && f.amount) {
    return (
      <MetricTile
        label="월말 예측"
        kind="forecast"
        badge={<CostKindBadge kind="forecast" />}
        staleAt={actualMark.stale ? actualMark.at : undefined}
        value={<MoneyValue amount={f.amount.amountUsd} kind="forecast" unit="total" size="xl" asOf={f.amount.asOf} stale={actualMark.stale} />}
        lines={[
          f.low && f.high ? (
            <RangeValue key="r" low={f.low.amountUsd} high={f.high.amountUsd} confidence={(f.confidencePct ?? 80) / 100} />
          ) : null,
          e?.amount ? (
            <span key="e" className="row">
              추정 월말 <MoneyValue amount={e.amount.amountUsd} kind="estimate" unit="total" size="sm" asOf={e.amount.asOf} />
              <CostKindBadge kind="estimate" />
            </span>
          ) : null,
        ].filter(Boolean)}
      />
    );
  }
  // AWS 예측 불가 → 추정 월말로 바꾼다 (aws-cost.md 2.3 타일 3 변형)
  return (
    <MetricTile
      label="월말 예측"
      kind="estimate"
      badge={<CostKindBadge kind="estimate" />}
      staleAt={estimateMark.stale ? estimateMark.at : undefined}
      state={e?.amount ? "ready" : "unknown"}
      unknownReason={f.unavailable?.message}
      value={e?.amount ? <MoneyValue amount={e.amount.amountUsd} kind="estimate" unit="total" size="xl" asOf={e.amount.asOf} /> : null}
      lines={[
        <Chip key="na" label={f.unavailable ? `AWS 예측 불가 (${f.unavailable.message})` : "AWS 예측 불가"} />,
        <span key="m">{e?.method === "elapsed_rate" ? "Cost Explorer 없음 · 경과 시간 기준 추정" : "확정 누적 + 추정 소모율 × 남은 시간"}</span>,
      ]}
    />
  );
}

export function BudgetTile({ summary }: KpiProps) {
  const b = summary.budget;
  if (!b.configured || b.budgetUsd === null) return <MetricTile label="예산" value={null} state="hidden" />;
  const projected =
    b.projectedBasis === "estimated_month_end" ? (summary.monthEnd.estimated?.amount?.amountUsd ?? null) : (summary.monthEnd.forecast.amount?.amountUsd ?? null);
  const range =
    b.projectedBasis === "aws_forecast" && summary.monthEnd.forecast.low && summary.monthEnd.forecast.high
      ? { low: summary.monthEnd.forecast.low.amountUsd, high: summary.monthEnd.forecast.high.amountUsd }
      : undefined;
  const bp = badgeProps(b.status);
  return (
    <MetricTile
      label="예산"
      kind="plain"
      badge={
        <span className="stack-sm" style={{ alignItems: "flex-end" }}>
          <StatusBadge size="md" {...bp} label={costAltLabel(b.status, "budget")} />
          {b.projectedBasis === "estimated_month_end" ? <span className="text-micro">추정 기준</span> : null}
        </span>
      }
      status={bp.status === "warn" || bp.status === "crit" ? bp.status : undefined}
      value={
        summary.monthToDate.amount === null ? (
          <span className="text-caption">확정 누적 없음 · {b.status?.reasons[0]?.text ?? ""}</span>
        ) : (
        <BudgetGauge
          budget={b.budgetUsd}
          confirmed={summary.monthToDate.amount.amountUsd}
          projected={projected}
          projectedKind={projectedKindFromBasis(b.projectedBasis ?? "aws_forecast")}
          projectedRange={range}
          warnRatio={(b.warnPct ?? 90) / 100}
          elapsedRatio={(b.monthElapsedPct ?? 0) / 100}
          elapsedLabel={b.daysElapsed !== null && b.daysInMonth !== null ? `${Math.ceil(b.daysElapsed)}/${b.daysInMonth}일` : ""}
        />
        )
      }
    />
  );
}

function SpikeLine({ label, kind, status, text }: { label: string; kind: "estimate" | "confirmed"; status: React.ReactNode; text: string }) {
  return (
    <span className="row">
      <span>{label}</span>
      <CostKindBadge kind={kind} />
      {status}
      <span>{text}</span>
    </span>
  );
}

export function SpikeTile({ summary, status }: KpiProps) {
  const s = summary.spike;
  const bp = badgeProps(s.status);
  const rateReason =
    status?.spike.rate.reasons[0]?.text ?? s.status.reasons.find((r) => r.code.startsWith("SPIKE_RATE") || r.code === "SPIKE_BASELINE_COLLECTING")?.text ?? "";
  const dailyReason = status?.spike.daily.reasons[0]?.text ?? s.status.reasons.find((r) => r.code.startsWith("SPIKE_DAILY") || r.code === "SPIKE_SERVICE")?.text ?? "";
  const rateStatus = badgeProps({ status: s.rate.status, reasons: [], updatedAt: null, statusChangedAt: null, stale: false }).status;
  const dailyStatus = badgeProps({ status: s.daily.status, reasons: [], updatedAt: null, statusChangedAt: null, stale: false }).status;
  return (
    <MetricTile
      label="급증"
      kind="plain"
      badge={<StatusBadge size="md" {...bp} label={costAltLabel(s.status, "spike")} />}
      status={bp.status === "warn" || bp.status === "crit" ? bp.status : undefined}
      value={
        <div className="stack-sm text-caption">
          {s.rate.baselineState === "collecting" ? (
            <SpikeLine
              label="실시간"
              kind="estimate"
              status={<Chip label="기준 수집 중" icon="hourglass" />}
              text={`기록 ${formatCount(s.rate.collectedHours)}시간 / ${formatCount(s.rate.requiredHours)}시간`}
            />
          ) : (
            <SpikeLine label="실시간" kind="estimate" status={<StatusIcon status={rateStatus} size={14} />} text={rateReason} />
          )}
          {s.daily.available ? (
            <SpikeLine label="일별" kind="confirmed" status={<StatusIcon status={dailyStatus} size={14} />} text={dailyReason || (s.daily.date ? `${formatMonthDay(s.daily.date)} 기준` : "")} />
          ) : (
            <SpikeLine label="일별" kind="confirmed" status={<StatusIcon status="unknown" size={14} />} text="알 수 없음 (Cost Explorer 사용 불가)" />
          )}
        </div>
      }
    />
  );
}
