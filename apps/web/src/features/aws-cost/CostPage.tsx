"use client";

/**
 * 비용 `/cost` (docs/design/aws-cost.md 2절). 데이터: cost 토픽(cost.snapshot + 변경분), 소모율 추이는 REST.
 * 금액·합계·상태는 서버 값을 그대로 쓴다. 추정·확정·AWS 예측은 배지·기호·테두리로 구분한다.
 */
import { useState } from "react";

import {
  Banner,
  Button,
  Chip,
  CostKindBadge,
  formatCount,
  formatMonthDay,
  formatTime,
  Grid,
  GridItem,
  InlineAlert,
  KeyValueList,
  MetricTile,
  MoneyValue,
  PageHeader,
  Section,
  Skeleton,
  StatusBadge,
  UnknownState,
  type AlertTone,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";

import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { badgeProps, orServerStale, periodicStale, STALE_AFTER_MS } from "../stream/stale";
import { CeRefreshButton } from "./CeRefresh";
import { DailyCard, ProjectionCard, RateChartCard } from "./CostCharts";
import { BudgetTile, costAltLabel, MonthEndTile, MonthToDateTile, RateTile, SpikeTile } from "./CostKpis";
import { AllocationTable, CategoryCard, ResourceTable, ServicesTable, SpikeCausesCard } from "./CostTables";
import { CalcHelp, CONTROL_PLANE_NOTICE, NotIncludedHelp } from "./help";

const TOPICS = ["cost"] as const;

export function CostPage() {
  useTopics(TOPICS);
  const { stream } = useStreamStore();
  const now = useNow(1000);
  // CE 새로고침 오류(429 등)는 섹션 머리 아래에 (디자인 2.7)
  const [ceNotice, setCeNotice] = useState<string | null>(null);
  const cost = stream.cost;
  const serverNow = now + stream.serverOffsetMs;

  const header = (
    <PageHeader
      title="비용"
      actions={
        <>
          <CalcHelp />
          <NotIncludedHelp />
        </>
      }
    />
  );

  if (!cost) {
    return (
      <>
        {header}
        <div className="page-stack">
          <Grid columns={5} columnsMd={3}>
            {Array.from({ length: 5 }, (_, i) => (
              <MetricTile key={i} label="…" value="" state="loading" />
            ))}
          </Grid>
          <Skeleton height={280} />
        </div>
      </>
    );
  }

  const { summary, estimate, allocation, actual, status, refresh } = cost;
  const estimateMark = orServerStale(
    periodicStale(stream, estimate.asOf, STALE_AFTER_MS.costEstimate, ["awsResources", "pricing", "spotPrice"], now),
    estimate.stale,
    estimate.asOf,
  );
  const actualMark = orServerStale(periodicStale(stream, actual.asOf, STALE_AFTER_MS.costExplorer, ["costExplorer"], now), actual.stale, actual.asOf);
  const kpi = { summary, status, estimateMark, actualMark };
  const overall = badgeProps(summary.status);
  const bannerTone: AlertTone | null = overall.status === "warn" ? "warn" : overall.status === "crit" ? "crit" : overall.status === "unknown" ? "neutral" : null;
  const reasons = summary.status.reasons.map((r) => r.text);
  const budgetShown = summary.budget.configured;
  const spikeCause = status?.spike.rate && (status.spike.rate.status === "warning" || status.spike.rate.status === "critical");

  return (
    <>
      {header}
      <div className="page-stack">
        {bannerTone ? (
          <Banner
            tone={bannerTone}
            title={
              <span className="row">
                <StatusBadge size="md" {...overall} label={costAltLabel(summary.status, "overall")} />
                <span>
                  {reasons.slice(0, 2).join(" · ")}
                  {reasons.length > 2 ? ` 외 ${reasons.length - 2}건` : ""}
                </span>
              </span>
            }
            actions={
              spikeCause ? (
                <a href="#spike-causes" className="text-link">
                  원인 보기
                </a>
              ) : undefined
            }
          />
        ) : null}

        <Grid columns={budgetShown ? 5 : 4} columnsMd={3}>
          <RateTile {...kpi} />
          <MonthToDateTile {...kpi} />
          <MonthEndTile {...kpi} />
          {budgetShown ? <BudgetTile {...kpi} /> : null}
          <SpikeTile {...kpi} />
        </Grid>

        <Section
          title="실시간 추정"
          kind="estimate"
          badges={<CostKindBadge kind="estimate" />}
          actions={
            <span className="row">
              {estimate.asOf ? (
                <span className="text-caption-tertiary" suppressHydrationWarning>
                  {formatTime(estimate.asOf, "autoShort")} 조회 · {Math.round(estimate.intervalSec / 60)}분마다 갱신
                </span>
              ) : null}
              <NotIncludedHelp label="포함되지 않는 것" />
            </span>
          }
        >
          {/* kOps 전환 고정 안내 (계약 3.1.1 / AC-KOPS35). 서버 값이 아니라 화면 상수다 */}
          <InlineAlert tone="info" compact title={CONTROL_PLANE_NOTICE} />
          {!estimate.available ? (
            <UnknownState
              size="lg"
              reason={`알 수 없음 (${estimate.unavailable?.message ?? "추정 불가"})`}
              hint={estimate.unavailable?.code === "AWS_NOT_CONFIGURED" ? "AWS 읽기 전용 자격 증명을 설정하세요" : undefined}
            />
          ) : (
            <div className="stack-lg">
              <Grid>
                <GridItem span={8} spanMd={12}>
                  <RateChartCard live={stream.costRate} mark={estimateMark} now={serverNow} />
                </GridItem>
                <GridItem span={4} spanMd={12}>
                  <CategoryCard estimate={estimate} />
                </GridItem>
              </Grid>
              {status ? <SpikeCausesCard status={status} /> : null}
              <ResourceTable estimate={estimate} />
            </div>
          )}
        </Section>

        <Section title="네임스페이스별 추정 비용" kind="estimate" badges={<CostKindBadge kind="estimate" />} actions={<CalcHelp />}>
          {allocation.available ? (
            <AllocationTable allocation={allocation} />
          ) : (
            <UnknownState size="sm" reason={`알 수 없음 (${allocation.unavailable?.message ?? "배분 불가"})`} />
          )}
        </Section>

        <Section
          title="확정 비용 · Cost Explorer"
          badges={
            <>
              <CostKindBadge kind="confirmed" />
              {actual.scope === "account" ? (
                <Chip label="계정 전체 기준" icon="building-2" />
              ) : actual.tagFilter ? (
                <Chip label={`태그 필터: ${actual.tagFilter.key}`} />
              ) : null}
              {refresh.limitReached ? (
                <Chip tone="warn" label={`호출 한도 도달 · 캐시 표시 중${actual.asOf ? ` (${formatTime(actual.asOf, "autoShort")} 조회)` : ""}`} />
              ) : null}
              {actual.stale && actual.staleReason ? <Chip tone="stale" label={actual.staleReason} /> : null}
            </>
          }
          meta={
            actual.settledThrough ? (
              <span suppressHydrationWarning>
                {formatMonthDay(actual.settledThrough)}까지 반영 ({actual.delayNotice ?? "청구 데이터는 최대 24시간 지연"})
                {actual.metric ? ` · 지표 ${actual.metric}` : ""}
              </span>
            ) : undefined
          }
          actions={
            <span className="row" style={{ alignItems: "flex-start" }}>
              <span className="text-caption-tertiary" suppressHydrationWarning>
                마지막 조회 {refresh.lastFetchedAt ? formatTime(refresh.lastFetchedAt, "autoShort") : "—"}
                {refresh.nextScheduledAt ? ` · 다음 자동 조회 ${formatTime(refresh.nextScheduledAt, "autoShort")}` : ""}
              </span>
              <CeRefreshButton refresh={refresh} onNotice={setCeNotice} />
            </span>
          }
        >
          {ceNotice ? (
            <InlineAlert
              tone="warn"
              compact
              title={ceNotice}
              action={
                <Button variant="ghost" size="sm" onClick={() => setCeNotice(null)}>
                  닫기
                </Button>
              }
            />
          ) : null}
          {!actual.available ? (
            <UnknownState
              size="lg"
              reason={`알 수 없음 (${actual.unavailable?.message ?? "Cost Explorer 사용 불가"})`}
              hint="ce:GetCostAndUsage, ce:GetCostForecast 권한과 Cost Explorer 활성화를 확인하세요"
            />
          ) : (
            <div className="stack-lg">
              <Grid>
                <GridItem span={6} spanMd={12}>
                  <ProjectionCard actual={actual} summary={summary} mark={actualMark} now={serverNow} />
                </GridItem>
                <GridItem span={6} spanMd={12}>
                  <DailyCard actual={actual} mark={actualMark} />
                </GridItem>
              </Grid>
              <ServicesTable actual={actual} status={status} />
            </div>
          )}
        </Section>

        <Section title="데이터 출처·호출 정보" collapsible defaultCollapsed>
          <KeyValueList
            columns={2}
            labelWidth={160}
            items={[
              { label: "데이터 소스", value: stream.dataSource ?? "—" },
              {
                label: "단가 조회",
                value: estimate.pricing?.fetchedAt ? (
                  <span suppressHydrationWarning>
                    {formatTime(estimate.pricing.fetchedAt, "autoShort")}
                    {estimate.pricing.nextRefreshAt ? ` (다음 ${formatTime(estimate.pricing.nextRefreshAt, "autoShort")})` : ""}
                  </span>
                ) : (
                  "—"
                ),
              },
              { label: "스팟 시세 조회", value: estimate.spotPrice?.fetchedAt ? <span suppressHydrationWarning>{formatTime(estimate.spotPrice.fetchedAt, "autoShort")}</span> : "—" },
              {
                label: "리소스 목록 조회",
                value: estimate.resourcesFetchedAt ? (
                  <span suppressHydrationWarning>
                    {formatTime(estimate.resourcesFetchedAt, "autoShort")} ({Math.round(estimate.intervalSec / 60)}분 주기)
                  </span>
                ) : (
                  "—"
                ),
              },
              {
                label: "Cost Explorer 조회",
                value: (
                  <span suppressHydrationWarning>
                    마지막 {refresh.lastFetchedAt ? formatTime(refresh.lastFetchedAt, "autoShort") : "—"}, 다음 자동{" "}
                    {refresh.nextScheduledAt ? formatTime(refresh.nextScheduledAt, "autoShort") : "—"}
                  </span>
                ),
              },
              { label: "오늘 CE 호출", value: `${formatCount(refresh.todayCalls)} / ${formatCount(refresh.dailyLimit)}회` },
              {
                label: "이번 달 추정 CE 호출 비용",
                value: refresh.monthCallCost ? (
                  <span className="row">
                    <MoneyValue amount={refresh.monthCallCost.amountUsd} kind="estimate" unit="total" size="sm" asOf={refresh.monthCallCost.asOf} />
                    <CostKindBadge kind="estimate" />
                  </span>
                ) : (
                  "—"
                ),
              },
              { label: "지표 · 태그 필터", value: `${actual.metric ?? "—"} · ${actual.tagFilter ? `${actual.tagFilter.key}=${actual.tagFilter.values.join(",")}` : "없음"}` },
              { label: "한 달 환산", value: `${formatCount(estimate.hoursPerMonth)}시간` },
            ]}
          />
        </Section>
      </div>
    </>
  );
}
