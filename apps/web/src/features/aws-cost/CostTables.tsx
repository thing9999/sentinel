"use client";

/**
 * 비용 표 (docs/design/aws-cost.md 2.5 b·c·d, 2.6, 2.7 c). 합계 행은 서버 값 그대로(행을 더하지 않음).
 */
import { useState } from "react";

import {
  Card,
  Chip,
  CONTROL_PLANE_KIND_LABEL,
  CONTROL_PLANE_KIND_ORDER,
  COST_CATEGORY_LABEL,
  COST_CATEGORY_ORDER,
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
  shortNodeName,
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
  ControlPlaneResource,
  Ec2Resource,
  EbsResource,
  Ipv4Resource,
  LbResource,
  ServiceRow,
} from "./types";
import styles from "./CostTables.module.css";
import { API_LB_TOOLTIP, CONTROL_PLANE_CATEGORY_TOOLTIP } from "./help";

/** 라벨·순서는 퍼블리셔가 관리하는 `@/components/ui` 한 곳만 쓴다 (2026-09-24 kops-support) */
export const CATEGORY_ORDER = COST_CATEGORY_ORDER;
const catColor = (c: CostCategory) => `var(--color-chart-series-${CATEGORY_ORDER.indexOf(c)})`;

/** 컨트롤 플레인 하위 종류 칩 아이콘 (디자인 aws-cost.md 2.5(d)) */
const KIND_ICON = {
  master_ec2: "server-cog",
  etcd_ebs: "database",
  master_root_ebs: "hard-drive",
  api_lb: "network",
  master_ipv4: "globe",
} as const;

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
                {/* kOps에는 관리 요금이 없다는 설명 — 화면 상수(계약 3.1.1) */}
                {c.category === "controlPlane" ? (
                  <Tooltip content={CONTROL_PLANE_CATEGORY_TOOLTIP}>
                    <Icon name="circle-help" size={12} />
                  </Tooltip>
                ) : null}
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
  | { type: "controlPlane"; key: string; r: ControlPlaneResource }
  /** 후보 0개일 때 컨트롤 플레인 그룹 맨 아래 정보 행 (오류가 아니므로 warn 색을 쓰지 않는다) */
  | { type: "apiLbNote"; key: string; text: string };

type AnyRes = Ec2Resource | EbsResource | LbResource | Ipv4Resource | ControlPlaneResource;

function byCost<T extends AnyRes>(list: T[]): T[] {
  // 시간당 비용 내림차순, 단가 없음은 카테고리 맨 아래 (status.md 5.2)
  return [...list].sort((a, b) => {
    if (a.priced !== b.priced) return a.priced ? -1 : 1;
    return (b.usdPerHour ?? 0) - (a.usdPerHour ?? 0);
  });
}

/** 하위 종류 고정 순서 → 시간당 내림차순 (status.md 5.2). 순서 목록은 `@/components/ui` 한 곳 */
function byControlPlaneKind(list: ControlPlaneResource[]): ControlPlaneResource[] {
  return [...list].sort((a, b) => {
    const d = CONTROL_PLANE_KIND_ORDER.indexOf(a.kind) - CONTROL_PLANE_KIND_ORDER.indexOf(b.kind);
    if (d !== 0) return d;
    if (a.priced !== b.priced) return a.priced ? -1 : 1;
    return (b.usdPerHour ?? 0) - (a.usdPerHour ?? 0);
  });
}

type PlainRow = Exclude<ResRow, { type: "group" | "apiLbNote" }>;

/** 대상 열: 1줄 이름 + (있을 때만) 보조 줄. 보조 줄은 micro 11/14 1줄 말줄임 + 툴팁 */
function TargetCell({ row }: { row: PlainRow }) {
  const d = describe(row);
  if (!d.sub) return <>{d.name}</>;
  return (
    <span className="stack-sm" style={{ gap: 0, minWidth: 0 }}>
      {d.name}
      <span className={styles.targetSub}>{d.sub}</span>
    </span>
  );
}

/** 1280px 미만에서 `단가` 열이 숨으므로 시간당 셀 툴팁에 단가를 얹는다 */
function HourCell({ row }: { row: PlainRow }) {
  const cell = <EstCell v={row.r.usdPerHour} unit="hour" />;
  const unit = unitPriceText(row);
  if (!unit) return cell;
  return <Tooltip content={`단가 ${unit}`}>{cell}</Tooltip>;
}

function unitPriceText(row: PlainRow): string | null {
  const r = row.r;
  if (!r.priced || !r.unitPrice) return null;
  return r.unitPrice.usdPerGbMonth != null
    ? formatMoney(r.unitPrice.usdPerGbMonth, "gbMonth")
    : formatMoney(r.unitPrice.usdPerHour ?? 0, "unitPrice");
}

function UnitPriceCell({ row }: { row: Exclude<ResRow, { type: "group" | "apiLbNote" }> }) {
  const r = row.r;
  if (!r.priced || !r.unitPrice) return <span>—</span>;
  const up = r.unitPrice;
  // EBS 계열(컨트롤 플레인의 etcd·루트 볼륨 포함)은 GB-월 단가다. 시간당으로 찍으면 $0.0000 이 된다
  if (up.usdPerGbMonth != null) return <span className="tabular">{formatMoney(up.usdPerGbMonth, "gbMonth")}</span>;
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

/**
 * 행 설명. `sub`는 **대상 열의 보조 줄**이다 (디자인 2.5(d) 2026-09-24 (4) 개정).
 * 독립 `연결` 열을 없앴다 — 값이 있는 종류가 절반이 안 되는데 160px을 상시 차지했다(status.md 5.6 ①).
 */
function describe(row: Exclude<ResRow, { type: "group" | "apiLbNote" }>): { name: React.ReactNode; type: React.ReactNode; sub: React.ReactNode } {
  switch (row.type) {
    case "ec2":
      return {
        name: <ResourceName name={row.r.nodeName} kind="node" maxWidth={220} />,
        type: <span className="text-mono">{row.r.instanceType ?? "—"}</span>,
        sub: (
          <span className="row">
            {row.r.capacityType === "spot" ? <Chip label="스팟" icon="zap" /> : row.r.capacityType === "on_demand" ? <Chip label="온디맨드" /> : null}
            <span>{row.r.zone ?? ""}</span>
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
        sub:
          a?.type === "pvc" ? (
            <span className="text-mono">
              PVC {a.namespace}/{a.name}
            </span>
          ) : a?.type === "node_root" ? (
            <span>노드 루트</span>
          ) : (
            <span>기타</span>
          ),
      };
    }
    case "lb":
      return {
        name: <ResourceName name={row.r.name} kind="other" maxWidth={220} />,
        type: <span className="text-mono">{row.r.lbType.toUpperCase()}</span>,
        sub: row.r.attachedTo.length ? (
          <span className="text-mono">{row.r.attachedTo.map((t) => `${t.namespace ?? ""}/${t.name}`).join(", ")}</span>
        ) : (
          <span>공용</span>
        ),
      };
    case "ipv4":
      return { name: <ResourceName name={row.r.nodeName} kind="node" maxWidth={220} />, type: <span className="text-caption">주소 {formatCount(row.r.count)}개</span>, sub: null };
    case "controlPlane":
      return describeControlPlane(row.r);
  }
}

/**
 * 컨트롤 플레인 내역 행 (디자인 aws-cost.md 2.5(d)).
 * 카테고리가 리소스 종류가 아니라 **역할 축**이라 한 그룹 안에 EC2·EBS·LB·IPv4가 섞인다.
 */
function describeControlPlane(r: ControlPlaneResource): { name: React.ReactNode; type: React.ReactNode; sub: React.ReactNode } {
  const master = r.nodeName ? <ResourceName name={r.nodeName} kind="node" maxWidth={220} /> : null;
  switch (r.kind) {
    case "master_ec2":
      // 마스터 EC2·API LB·퍼블릭 IPv4는 연결이 없다 → 보조 줄을 그리지 않는다(행 40px 유지)
      return { name: master, type: <span className="text-mono">{r.instanceType ?? "—"}</span>, sub: null };
    case "etcd_ebs":
    case "master_root_ebs":
      return {
        name: <ResourceName name={r.volumeId ?? "—"} kind="volume" maxWidth={220} />,
        type: (
          <span className="row">
            <span className="text-mono">{r.volumeType}</span>
            <span className="text-caption">{r.sizeBytes ? formatBytes(r.sizeBytes) : ""}</span>
          </span>
        ),
        // etcdCluster 가 null 이면 "etcd 볼륨"으로만 적는다(추측해서 main/events 를 붙이지 않는다)
        sub: (
          <span>
            {r.nodeName ? shortNodeName(r.nodeName) : "—"}
            {r.kind === "master_root_ebs" ? " · 루트" : r.etcdCluster ? ` · ${r.etcdCluster}` : ""}
          </span>
        ),
      };
    case "api_lb":
      return {
        name: <ResourceName name={r.name ?? "—"} kind="other" maxWidth={220} />,
        type: <span className="text-mono">{(r.lbType ?? "nlb").toUpperCase()}</span>,
        sub: null,
      };
    case "master_ipv4":
      return { name: master, type: <span className="text-caption">주소 {formatCount(r.count ?? 0)}개</span>, sub: null };
  }
}

export function ResourceTable({ estimate }: { estimate: CostEstimate }) {
  const cats = estimate.categories;
  const top = [...cats].sort((a, b) => b.usdPerHour - a.usdPerHour)[0]?.category;
  // 컨트롤 플레인 그룹은 금액 1위 규칙과 별개로 **기본 펼침**이다 (디자인 2.5(d))
  const [expanded, setExpanded] = useState<CostCategory[]>(() =>
    CATEGORY_ORDER.filter((c) => c === top || c === "controlPlane" || (cats.find((x) => x.category === c)?.unpricedCount ?? 0) > 0),
  );
  const apiLb = cats.find((x) => x.category === "controlPlane")?.apiLb;
  const rows: ResRow[] = [];
  for (const c of CATEGORY_ORDER) {
    const list = estimate.resources[c] as AnyRes[] | undefined;
    if (!list || (list.length === 0 && !cats.some((x) => x.category === c))) continue;
    rows.push({ type: "group", category: c, key: `group:${c}` });
    if (!expanded.includes(c)) continue;
    if (c === "controlPlane") {
      // 하위 종류 순서 → 시간당 내림차순 (디자인 2.5(d))
      for (const r of byControlPlaneKind(list as ControlPlaneResource[])) rows.push({ type: c, key: r.key, r });
      const apiLb = cats.find((x) => x.category === "controlPlane")?.apiLb;
      // 후보 0개여도 apiLb 는 항상 있다 — "행이 없다"로 판단하지 않는다 (AC-KOPS30)
      if (apiLb?.state === "not_found") rows.push({ type: "apiLbNote", key: "cp:api-lb-note", text: apiLb.text });
      continue;
    }
    for (const r of byCost(list)) rows.push({ type: c, key: r.key, r } as ResRow);
  }

  const hourBadge = <CostKindBadge kind="estimate" />;
  const plain = (row: ResRow): row is Exclude<ResRow, { type: "group" | "apiLbNote" }> => row.type !== "group" && row.type !== "apiLbNote";
  const columns: Column<ResRow>[] = [
    {
      id: "kind",
      header: "종류",
      width: 140,
      render: (row) =>
        row.type === "controlPlane" ? (
          <Chip label={CONTROL_PLANE_KIND_LABEL[row.r.kind]} icon={KIND_ICON[row.r.kind]} />
        ) : row.type === "apiLbNote" ? (
          <span className="row text-caption">
            <Icon name="info" size={12} />
            {row.text}
          </span>
        ) : null,
    },
    // `종류` 열이 늘면서 1440px에서 표가 넘쳤다(실측 +161px) → 금액 열을 줄여 가로 스크롤을 없앤다.
    // `비고`의 "추정" 칩이 스크롤 뒤로 숨으면 안 되기 때문이다(계약 3.1.1).
    { id: "name", header: "대상", minWidth: 220, render: (row) => (plain(row) ? <TargetCell row={row} /> : null) },
    { id: "type", header: "사양", width: 128, render: (row) => (plain(row) ? describe(row).type : null) },
    // 1280px 미만에서는 숨기고 시간당 셀 툴팁으로 옮긴다 (디자인 2.5(d) / status.md 5.6 ②)
    { id: "unit", header: "단가", width: 112, numeric: true, hideBelow: 1280, render: (row) => (plain(row) ? <UnitPriceCell row={row} /> : null) },
    {
      id: "hour",
      header: "시간당",
      headerBadge: hourBadge,
      width: 120,
      numeric: true,
      render: (row) => (plain(row) ? <HourCell row={row} /> : null),
    },
    { id: "month", header: "월 환산", headerBadge: hourBadge, width: 120, numeric: true, render: (row) => (plain(row) ? <EstCell v={row.r.usdPerMonth} unit="month" /> : null) },
    {
      id: "notes",
      header: "비고",
      minWidth: 180,
      render: (row) =>
        plain(row) ? (
          <span className="row">
            {/* 추정 라벨은 **카테고리 `apiLb`**(항상 있다)에서 만든다. 행 notes 에만 기대지 않는다 — 확정 금액으로 오해하면 안 된다 */}
            {row.type === "controlPlane" && row.r.kind === "api_lb" && apiLb ? (
              <Chip
                tone={apiLb.state === "ambiguous" ? "warn" : "neutral"}
                icon={apiLb.state === "ambiguous" ? "triangle-alert" : "tilde"}
                label={apiLb.text}
                tooltip={API_LB_TOOLTIP}
              />
            ) : null}
            {row.r.notes
              .filter((n) => !n.code.startsWith("API_LB_"))
              .map((n) => (
                <Chip key={n.code} tone={n.code === "UNPRICED" || n.code === "SPOT_PRICE_FALLBACK" ? "warn" : "neutral"} label={n.text} />
              ))}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="stack-sm">
      <DataTable
        caption="리소스 내역"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        rowAccent={(r) =>
          plain(r) && (!r.r.priced || (r.type === "controlPlane" && r.r.kind === "api_lb" && apiLb?.state === "ambiguous"))
            ? "warn"
            : undefined
        }
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
                  <span className="text-strong">{c?.label ?? COST_CATEGORY_LABEL[r.category]}</span>
                  <span className="text-caption">{formatCount(c?.count ?? 0)}개</span>
                  {/*
                   * status.md 3.1: **추정·확인 필요 표시는 레이아웃 사정으로 사라지지 않는다.**
                   * 비고 열은 말줄임·열 폭에 흔들리지만 그룹 행은 늘 왼쪽에 있다 → 같은 칩을 병기한다.
                   */}
                  {c?.apiLb ? (
                    <Chip
                      tone={c.apiLb.state === "ambiguous" ? "warn" : "neutral"}
                      icon={c.apiLb.state === "ambiguous" ? "triangle-alert" : c.apiLb.state === "not_found" ? "info" : "tilde"}
                      label={c.apiLb.text}
                      tooltip={API_LB_TOOLTIP}
                    />
                  ) : null}
                  {/* 단가 없음: 서버 `unpricedCount` 그대로 (화면이 세지 않는다) */}
                  {c && c.unpricedCount > 0 ? (
                    <Chip tone="warn" label={`단가 없음 ${formatCount(c.unpricedCount)} · 합계 제외`} />
                  ) : null}
                  {/* 스팟 시세 실패: 서버 `spotPrice.fallbackCount`. 스팟은 EC2 노드에만 있다 */}
                  {r.category === "ec2" && (estimate.spotPrice?.fallbackCount ?? 0) > 0 ? (
                    <Chip
                      tone="warn"
                      label={`스팟 시세 조회 실패 ${formatCount(estimate.spotPrice!.fallbackCount)} (온디맨드 기준 상한)`}
                    />
                  ) : null}
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
  shared_cluster: "컨트롤 플레인 전체(마스터 EC2·etcd/루트 볼륨·API 서버 LB·마스터 퍼블릭 IPv4)와 워커 루트 볼륨·워커 퍼블릭 IPv4",
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
