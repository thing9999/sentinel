"use client";

/**
 * 비용 표 (docs/design/aws-cost.md 2.5 b·c·d, 2.6, 2.7 c). 합계 행은 서버 값 그대로(행을 더하지 않음).
 */
import { useState } from "react";

import {
  Card,
  Chip,
  CostKindBadge,
  DataTable,
  DistributionBar,
  formatBytes,
  formatCount,
  formatMoney,
  formatPercent,
  formatTime,
  Icon,
  InlineAlert,
  MoneyValue,
  ResourceName,
  StatusBadge,
  Tooltip,
  type Column,
} from "@/components/ui";

import { apiStatus } from "../cluster-status/selectors";
import type {
  AllocationPinnedRow,
  AllocationRow,
  CostAllocation,
  CostActual,
  CostCategory,
  CostEstimate,
  CostStatus,
  Ec2Resource,
  EbsResource,
  EksResource,
  Ipv4Resource,
  LbResource,
  ServiceRow,
} from "./types";

export const CATEGORY_ORDER: CostCategory[] = ["ec2", "ebs", "lb", "ipv4", "eks"];
const CATEGORY_LABEL: Record<CostCategory, string> = { ec2: "EC2 노드", ebs: "EBS", lb: "로드밸런서", ipv4: "퍼블릭 IPv4", eks: "EKS 컨트롤 플레인" };
const catColor = (c: CostCategory) => `var(--color-chart-series-${CATEGORY_ORDER.indexOf(c)})`;

/** 금액 셀: 추정은 `≈`, 표 머리글에 단위·배지가 있으므로 단위 생략 */
function EstCell({ v, unit }: { v: number | null; unit: "hour" | "month" }) {
  return <MoneyValue amount={v} kind="estimate" unit={unit} size="sm" showUnit={false} unknownReason="단가 없음" />;
}

// ───────── (b) 카테고리 구성 ─────────
export function CategoryCard({ estimate }: { estimate: CostEstimate }) {
  const cats = CATEGORY_ORDER.map((c) => estimate.categories.find((x) => x.category === c)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  return (
    <Card kind="estimate" as="section" aria-label="카테고리 구성">
      <div className="stack">
        <div className="row">
          <h3 className="text-h3">카테고리 구성</h3>
          <CostKindBadge kind="estimate" />
        </div>
        <DistributionBar
          label="카테고리 구성비"
          segments={cats.map((c) => ({ value: c.sharePct, color: catColor(c.category), label: c.label, valueText: formatPercent(c.sharePct / 100) }))}
        />
        <ul className="list-plain">
          {cats.map((c) => (
            <li key={c.category} className="row-between" style={{ minHeight: 44 }}>
              <span className="row">
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: catColor(c.category), display: "inline-block" }} />
                <span className="text-body">{c.label}</span>
                {c.unpricedCount ? <Chip tone="warn" label={`단가 없음 ${formatCount(c.unpricedCount)}`} /> : null}
              </span>
              <span className="stack-sm" style={{ alignItems: "flex-end", gap: 0 }}>
                <MoneyValue amount={c.usdPerHour} kind="estimate" unit="hour" size="sm" asOf={estimate.asOf ?? undefined} />
                <span className="text-caption">
                  {formatPercent(c.sharePct / 100)} · ≈ {formatMoney(c.usdPerMonth, "month")}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {estimate.total ? (
          <div className="row-between">
            <span className="text-strong">합계</span>
            <MoneyValue amount={estimate.total.usdPerHour} kind="estimate" unit="hour" size="md" asOf={estimate.asOf ?? undefined} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

// ───────── (c) 급증 원인 ─────────
const CHANGE_LABEL = { added: "추가", changed: "변경", removed: "삭제" } as const;

export function SpikeCausesCard({ status }: { status: CostStatus }) {
  const r = status.spike.rate;
  const s = apiStatus(r.status);
  if (s !== "warn" && s !== "crit") return null;
  return (
    <Card as="section" status={s} aria-labelledby="spike-causes-title">
      <div className="stack" id="spike-causes">
        <div className="row">
          <h3 id="spike-causes-title" className="text-h3">
            급증 원인 · 기준 시점(7일 중앙값) 대비 바뀐 리소스
          </h3>
          <StatusBadge size="md" status={s} label={s === "crit" ? "급증" : undefined} />
        </div>
        {r.causesBaselineAt ? (
          <span className="text-caption" suppressHydrationWarning>
            기준 시점 {formatTime(r.causesBaselineAt, "autoShort")}
          </span>
        ) : null}
        {r.causes.length === 0 ? (
          <span className="text-caption">바뀐 리소스를 찾지 못했습니다</span>
        ) : (
          <ul className="list-plain">
            {r.causes.map((c) => (
              <li key={c.key} className="row-between" style={{ minHeight: 40 }}>
                <span className="row">
                  <Chip label={CHANGE_LABEL[c.change]} />
                  <span className="text-body">{c.text}</span>
                </span>
                <MoneyValue amount={c.deltaUsdPerHour} kind="estimate" unit="hour" size="sm" delta />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ───────── (d) 리소스 내역 ─────────
type ResRow =
  | { type: "group"; category: CostCategory; key: string }
  | { type: "ec2"; key: string; r: Ec2Resource }
  | { type: "ebs"; key: string; r: EbsResource }
  | { type: "lb"; key: string; r: LbResource }
  | { type: "ipv4"; key: string; r: Ipv4Resource }
  | { type: "eks"; key: string; r: EksResource };

type AnyRes = Ec2Resource | EbsResource | LbResource | Ipv4Resource | EksResource;

function byCost<T extends AnyRes>(list: T[]): T[] {
  // 시간당 비용 내림차순, 단가 없음은 카테고리 맨 아래 (status.md 5.2)
  return [...list].sort((a, b) => {
    if (a.priced !== b.priced) return a.priced ? -1 : 1;
    return (b.usdPerHour ?? 0) - (a.usdPerHour ?? 0);
  });
}

function UnitPriceCell({ row }: { row: Exclude<ResRow, { type: "group" }> }) {
  const r = row.r;
  if (!r.priced || !r.unitPrice) return <span>—</span>;
  const up = r.unitPrice;
  if (row.type === "ebs") return <span className="tabular">{formatMoney(up.usdPerGbMonth ?? 0, "gbMonth")}</span>;
  const price = <span className="tabular">{formatMoney(up.usdPerHour ?? 0, "unitPrice")}</span>;
  if (row.type === "ec2" && up.source === "spot_price_history") {
    return (
      <span className="stack-sm" style={{ gap: 0 }}>
        {price}
        <span className="text-micro" suppressHydrationWarning>
          스팟 시세 · {up.zone ?? "—"} · {formatTime(up.asOf, "shortTime")}
        </span>
      </span>
    );
  }
  return price;
}

function describe(row: Exclude<ResRow, { type: "group" }>): { name: React.ReactNode; type: React.ReactNode; detail: React.ReactNode } {
  switch (row.type) {
    case "ec2":
      return {
        name: <ResourceName name={row.r.nodeName} kind="node" maxWidth={220} />,
        type: <span className="text-mono">{row.r.instanceType ?? "—"}</span>,
        detail: (
          <span className="row">
            {row.r.capacityType === "spot" ? <Chip label="스팟" icon="zap" /> : row.r.capacityType === "on_demand" ? <Chip label="온디맨드" /> : null}
            <span className="text-caption">{row.r.zone ?? ""}</span>
          </span>
        ),
      };
    case "ebs": {
      const a = row.r.attachment;
      return {
        name: <ResourceName name={row.r.volumeId} kind="volume" maxWidth={220} />,
        type: (
          <span className="row">
            <span className="text-mono">{row.r.volumeType}</span>
            <span className="text-caption">{formatBytes(row.r.sizeBytes)}</span>
          </span>
        ),
        detail:
          a?.type === "pvc" ? (
            <span className="text-mono">
              PVC {a.namespace}/{a.name}
            </span>
          ) : a?.type === "node_root" ? (
            <span className="text-caption">노드 루트</span>
          ) : (
            <span className="text-caption">기타</span>
          ),
      };
    }
    case "lb":
      return {
        name: <ResourceName name={row.r.name} kind="other" maxWidth={220} />,
        type: <span className="text-mono">{row.r.lbType.toUpperCase()}</span>,
        detail: row.r.attachedTo.length ? (
          <span className="text-mono">{row.r.attachedTo.map((t) => `${t.namespace ?? ""}/${t.name}`).join(", ")}</span>
        ) : (
          <span className="text-caption">공용</span>
        ),
      };
    case "ipv4":
      return { name: <ResourceName name={row.r.nodeName} kind="node" maxWidth={220} />, type: <span className="text-caption">주소 {formatCount(row.r.count)}개</span>, detail: null };
    case "eks":
      return {
        name: <span className="text-mono">{row.r.clusterName}</span>,
        type: <span className="text-mono">{row.r.version}</span>,
        detail: row.r.supportTier === "extended" ? <Chip tone="warn" label="확장 지원" /> : <span className="text-caption">표준</span>,
      };
  }
}

export function ResourceTable({ estimate }: { estimate: CostEstimate }) {
  const cats = estimate.categories;
  const top = [...cats].sort((a, b) => b.usdPerHour - a.usdPerHour)[0]?.category;
  const [expanded, setExpanded] = useState<CostCategory[]>(() =>
    CATEGORY_ORDER.filter((c) => c === top || (cats.find((x) => x.category === c)?.unpricedCount ?? 0) > 0),
  );
  const rows: ResRow[] = [];
  for (const c of CATEGORY_ORDER) {
    const list = estimate.resources[c] as AnyRes[] | undefined;
    if (!list || (list.length === 0 && !cats.some((x) => x.category === c))) continue;
    rows.push({ type: "group", category: c, key: `group:${c}` });
    if (!expanded.includes(c)) continue;
    for (const r of byCost(list)) rows.push({ type: c, key: r.key, r } as ResRow);
  }

  const hourBadge = <CostKindBadge kind="estimate" />;
  const columns: Column<ResRow>[] = [
    { id: "name", header: "리소스", minWidth: 220, render: (row) => (row.type === "group" ? null : describe(row).name) },
    { id: "type", header: "유형", width: 140, render: (row) => (row.type === "group" ? null : describe(row).type) },
    { id: "detail", header: "구매 옵션·연결", minWidth: 160, render: (row) => (row.type === "group" ? null : describe(row).detail) },
    { id: "unit", header: "단가", width: 150, numeric: true, render: (row) => (row.type === "group" ? null : <UnitPriceCell row={row} />) },
    { id: "hour", header: "시간당", headerBadge: hourBadge, width: 150, numeric: true, render: (row) => (row.type === "group" ? null : <EstCell v={row.r.usdPerHour} unit="hour" />) },
    { id: "month", header: "월 환산", headerBadge: hourBadge, width: 150, numeric: true, render: (row) => (row.type === "group" ? null : <EstCell v={row.r.usdPerMonth} unit="month" />) },
    {
      id: "notes",
      header: "비고",
      minWidth: 160,
      render: (row) =>
        row.type === "group" ? null : (
          <span className="row">
            {row.r.notes.map((n) => (
              <Chip key={n.code} tone={n.code === "UNPRICED" || n.code === "SPOT_PRICE_FALLBACK" ? "warn" : "neutral"} label={n.text} />
            ))}
          </span>
        ),
    },
  ];

  return (
    <div className="stack-sm">
      <DataTable
        caption="리소스 내역"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        rowAccent={(r) => (r.type !== "group" && !r.r.priced ? "warn" : undefined)}
        groupRow={{
          is: (r) => r.type === "group",
          expanded: (r) => r.type === "group" && expanded.includes(r.category),
          onToggle: (r) => {
            if (r.type !== "group") return;
            setExpanded((cur) => (cur.includes(r.category) ? cur.filter((x) => x !== r.category) : [...cur, r.category]));
          },
          render: (r) => {
            if (r.type !== "group") return null;
            const c = cats.find((x) => x.category === r.category);
            return (
              <span className="row-between" style={{ flex: 1 }}>
                <span className="row">
                  <span className="text-strong">{c?.label ?? CATEGORY_LABEL[r.category]}</span>
                  <span className="text-caption">{formatCount(c?.count ?? 0)}개</span>
                </span>
                {c ? (
                  <span className="row">
                    <MoneyValue amount={c.usdPerHour} kind="estimate" unit="hour" size="sm" />
                    <span aria-hidden="true">·</span>
                    <MoneyValue amount={c.usdPerMonth} kind="estimate" unit="month" size="sm" />
                  </span>
                ) : null}
              </span>
            );
          },
        }}
        totalRow={
          estimate.total
            ? {
                name: (
                  <span className="row">
                    합계
                    {estimate.unpricedCount > 0 ? <Chip tone="warn" icon="triangle-alert" label={`일부 리소스 제외 (${formatCount(estimate.unpricedCount)}개)`} /> : null}
                  </span>
                ),
                hour: <EstCell v={estimate.total.usdPerHour} unit="hour" />,
                month: <EstCell v={estimate.total.usdPerMonth} unit="month" />,
              }
            : undefined
        }
      />
      <div className="stack-sm" style={{ gap: 2 }}>
        {estimate.pricing ? (
          <span className="text-caption-tertiary" suppressHydrationWarning>
            단가 출처: AWS Pricing API · {estimate.pricing.fetchedAt ? formatTime(estimate.pricing.fetchedAt, "autoShort") : "—"} 조회 (24시간 캐시)
            {estimate.pricing.cacheUsed && estimate.pricing.cacheFetchedAt ? ` · 단가 캐시 사용 (${formatTime(estimate.pricing.cacheFetchedAt, "autoShort")})` : ""}
          </span>
        ) : null}
        {estimate.spotPrice?.fetchedAt ? (
          <span className="text-caption-tertiary" suppressHydrationWarning>
            스팟 시세: EC2 스팟 가격 기록 · {formatTime(estimate.spotPrice.fetchedAt, "autoShort")} 조회 (1시간 캐시)
          </span>
        ) : null}
        {estimate.outOfCluster && estimate.outOfCluster.count > 0 ? (
          <span className="text-caption-tertiary">클러스터 외로 분류된 리소스 {formatCount(estimate.outOfCluster.count)}개는 합계에 넣지 않았습니다.</span>
        ) : null}
      </div>
    </div>
  );
}

// ───────── 네임스페이스 배분 ─────────
type AllocRowView = { key: string; name: string; isSystem: boolean; pinned: boolean; row: AllocationRow | AllocationPinnedRow; tooltip?: string };

const PINNED_TIP: Record<string, string> = {
  unallocated: "어떤 파드에도 배분되지 않은 노드 비용",
  shared_cluster: "EKS 컨트롤 플레인·노드 루트 볼륨·퍼블릭 IPv4",
  shared: "귀속할 수 없는 로드밸런서",
};

export function AllocationTable({ allocation }: { allocation: CostAllocation }) {
  const rows: AllocRowView[] = allocation.rows.map((r) => ({ key: `ns:${r.namespace}`, name: r.namespace, isSystem: r.isSystem, pinned: false, row: r }));
  const pinned: AllocRowView[] = [...allocation.pinnedRows, ...(allocation.hiddenSystem ? [allocation.hiddenSystem] : [])].map((r) => ({
    key: `pin:${r.key}`,
    name: r.label,
    isSystem: false,
    pinned: true,
    row: r,
    tooltip: PINNED_TIP[r.key],
  }));
  const warnPct = allocation.unallocatedWarnPct ?? 40;
  const badge = <CostKindBadge kind="estimate" />;
  const columns: Column<AllocRowView>[] = [
    {
      id: "ns",
      header: "네임스페이스",
      minWidth: 180,
      render: (v) => (
        <span className="row">
          {v.tooltip ? (
            <Tooltip content={v.tooltip}>
              <span className={v.pinned ? "text-caption" : undefined}>{v.name}</span>
            </Tooltip>
          ) : (
            <span className={v.pinned ? "text-caption" : undefined}>{v.name}</span>
          )}
          {v.isSystem ? <Chip label="시스템" icon="settings" /> : null}
        </span>
      ),
    },
    { id: "hour", header: "시간당", headerBadge: badge, width: 150, numeric: true, render: (v) => <EstCell v={v.row.usdPerHour} unit="hour" /> },
    { id: "month", header: "월 환산", headerBadge: badge, width: 150, numeric: true, render: (v) => <EstCell v={v.row.usdPerMonth} unit="month" /> },
    {
      id: "share",
      header: "비율",
      width: 160,
      render: (v) => (
        <span className="row" style={{ flexWrap: "nowrap" }}>
          <DistributionBar
            height={4}
            width={96}
            label="비율"
            segments={[
              { value: v.row.sharePct, color: "var(--color-cost-estimate-solid)", label: "비율", valueText: formatPercent(v.row.sharePct / 100) },
              { value: Math.max(0, 100 - v.row.sharePct), color: "var(--color-bg-surface-sunken)", label: "나머지", valueText: "" },
            ]}
          />
          <span className="tabular">{formatPercent(v.row.sharePct / 100)}</span>
          {"key" in v.row && v.row.key === "unallocated" && allocation.unallocatedPct !== null && allocation.unallocatedPct >= warnPct ? (
            <Chip tone="info" label="어드바이저 사전 점검 R-UNALLOC" href="/advisor" />
          ) : null}
        </span>
      ),
    },
    { id: "node", header: "노드", width: 96, numeric: true, render: (v) => <EstCell v={v.row.breakdown.nodeUsdPerHour} unit="hour" /> },
    { id: "storage", header: "스토리지", width: 96, numeric: true, render: (v) => <EstCell v={v.row.breakdown.storageUsdPerHour} unit="hour" /> },
    { id: "lb", header: "LB", width: 96, numeric: true, render: (v) => <EstCell v={v.row.breakdown.lbUsdPerHour} unit="hour" /> },
    {
      id: "warn",
      header: "경고",
      minWidth: 160,
      render: (v) =>
        "warnings" in v.row && v.row.warnings.length ? (
          <span className="row">
            {v.row.warnings.map((w) => (
              <Tooltip key={w.code} content="실제 사용량은 더 클 수 있습니다">
                <Chip tone="warn" label={w.text} />
              </Tooltip>
            ))}
          </span>
        ) : null,
    },
  ];
  return (
    <DataTable
      caption="네임스페이스별 추정 비용"
      columns={columns}
      rows={rows}
      rowKey={(v) => v.key}
      pinnedBottomRows={pinned}
      totalRow={
        allocation.total
          ? { ns: <span>합계</span>, hour: <EstCell v={allocation.total.usdPerHour} unit="hour" />, month: <EstCell v={allocation.total.usdPerMonth} unit="month" /> }
          : undefined
      }
      state={rows.length || pinned.length ? "ready" : "empty"}
      emptyProps={{ icon: "boxes", title: "배분할 파드가 없습니다" }}
    />
  );
}

// ───────── 서비스별 확정 ─────────
type SvcView = { key: string; name: string; original?: string; mtd: number; last: number | null; delta: number | null; deltaPct: number | null; share: number; spike: ServiceRow["spikeStatus"] };

export function ServicesTable({ actual, status }: { actual: CostActual; status: CostStatus | null }) {
  const s = actual.services;
  if (!s) return null;
  const rows: SvcView[] = s.top.map((r) => ({
    key: r.service,
    name: r.displayName,
    original: r.displayName !== r.service ? r.service : undefined,
    mtd: r.mtdUsd,
    last: r.lastMonthSamePeriodUsd,
    delta: r.deltaUsd,
    deltaPct: r.deltaPct,
    share: r.sharePct,
    spike: r.spikeStatus,
  }));
  const other: SvcView = {
    key: "_other",
    name: `기타 (${formatCount(s.other.serviceCount)}개 서비스)`,
    mtd: s.other.mtdUsd,
    last: s.other.lastMonthSamePeriodUsd,
    delta: s.other.deltaUsd,
    deltaPct: s.other.deltaPct,
    share: s.other.sharePct,
    spike: null,
  };
  const badge = <CostKindBadge kind="confirmed" />;
  const spiked = status?.spike.daily.spikedServices ?? [];
  const worstSpike = spiked.some((x) => x.status === "critical") ? "crit" : "warn";
  const columns: Column<SvcView>[] = [
    {
      id: "name",
      header: "서비스",
      minWidth: 220,
      render: (v) => (v.original ? <Tooltip content={v.original}><span>{v.name}</span></Tooltip> : <span>{v.name}</span>),
    },
    { id: "mtd", header: "이번 달 누적", headerBadge: badge, width: 160, numeric: true, render: (v) => <MoneyValue amount={v.mtd} kind="confirmed" unit="total" size="sm" /> },
    { id: "last", header: "지난달 같은 기간", headerBadge: badge, width: 190, numeric: true, render: (v) => <MoneyValue amount={v.last} kind="confirmed" unit="total" size="sm" /> },
    {
      id: "delta",
      header: "증감",
      width: 140,
      numeric: true,
      render: (v) =>
        v.delta === null ? (
          "—"
        ) : (
          <span className="row" style={{ justifyContent: "flex-end" }}>
            {v.delta > 0 ? <Icon name="arrow-up" size={12} /> : v.delta < 0 ? <Icon name="arrow-down" size={12} /> : null}
            {formatMoney(v.delta, "total", { delta: true })}
            {v.deltaPct !== null ? ` (${formatPercent(v.deltaPct / 100, { signed: true })})` : ""}
          </span>
        ),
    },
    {
      id: "spike",
      header: "급증",
      width: 96,
      render: (v) =>
        v.spike === "warning" || v.spike === "critical" ? <StatusBadge size="sm" status={apiStatus(v.spike)} label={v.spike === "critical" ? "급증" : undefined} /> : null,
    },
    {
      id: "share",
      header: "비율",
      width: 140,
      render: (v) => (
        <span className="row" style={{ flexWrap: "nowrap" }}>
          <DistributionBar
            height={4}
            width={80}
            label="비율"
            segments={[
              { value: v.share, color: "var(--color-cost-confirmed-solid)", label: "비율", valueText: formatPercent(v.share / 100) },
              { value: Math.max(0, 100 - v.share), color: "var(--color-bg-surface-sunken)", label: "나머지", valueText: "" },
            ]}
          />
          <span className="tabular">{formatPercent(v.share / 100)}</span>
        </span>
      ),
    },
  ];
  return (
    <div className="stack-sm">
      {spiked.length ? (
        <InlineAlert
          tone={worstSpike}
          compact
          title={status?.spike.daily.reasons.find((r) => r.code === "SPIKE_SERVICE")?.text ?? `급증한 서비스 ${formatCount(spiked.length)}개: ${spiked.map((x) => x.displayName).join(", ")}`}
        />
      ) : null}
      <DataTable
        caption="서비스별 확정 비용"
        columns={columns}
        rows={rows}
        rowKey={(v) => v.key}
        pinnedBottomRows={[other]}
        totalRow={{ name: <span>이번 달 확정 누적</span>, mtd: <MoneyValue amount={s.totalUsd} kind="confirmed" unit="total" size="sm" /> }}
      />
    </div>
  );
}
