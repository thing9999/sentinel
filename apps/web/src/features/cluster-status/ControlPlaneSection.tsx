"use client";

/**
 * 노드 화면 위쪽 컨트롤 플레인 섹션 (docs/design/cluster-status.md 3.2).
 * 데이터: `cluster` 토픽의 `cluster.snapshot.controlPlane` + `cluster.controlplane.updated` (새 구독 없음).
 *
 * **화면은 상태를 계산하지 않는다.** 쿼럼·HA·AZ 편중·셀 상태·셀 문구·대표 사유·요약 숫자가 전부 서버 값이다.
 */
import { useRouter } from "next/navigation";

import {
  Chip,
  ComponentMatrix,
  DataTable,
  formatBytes,
  formatCount,
  formatMillicores,
  formatPercent,
  Icon,
  InlineAlert,
  ReasonText,
  ResourceName,
  Section,
  StatusBadge,
  Tooltip,
  UnknownState,
  UsageBar,
  type CellState,
  type Column,
  type ComponentMatrixCell,
  type ComponentMatrixColumn,
  type Status,
} from "@/components/ui";

import type { StaleMark } from "../stream/stale";
import { badgeProps } from "../stream/stale";
import { apiStatus, nodeHref, podHref, statusRank } from "./selectors";
import { elapsedText } from "./shared";
import type {
  ClusterThresholds,
  ControlPlaneBody,
  ControlPlaneCellState,
  ControlPlaneMasterItem,
} from "./types";

/** 앵커(`#control-plane`)로 올 때 상단바 56 + 배너 40만큼 띄운다 (디자인 3.2.0) */
export const CONTROL_PLANE_ANCHOR = "control-plane";
const SCROLL_MARGIN_TOP = 96;

/** 서버 7종 → `ComponentMatrix` 7종. 이름만 다르고 뜻은 같다(화면이 상태를 다시 판단하지 않는다) */
const CELL_STATE: Record<ControlPlaneCellState, CellState> = {
  ok: "ok",
  warning: "warn",
  critical: "crit",
  not_reporting: "notReporting",
  unknown: "unknown",
  missing: "missing",
  stale: "stale",
};

const QUORUM_TOOLTIP_FALLBACK =
  "쿼럼은 etcd 멤버 목록이 아니라 마스터 노드 수로 근사합니다. etcd 멤버 조회는 대시보드 권한 밖입니다.";

/** 한계 안내에서 빼고 쿼럼 툴팁으로 돌리는 note */
const QUORUM_NOTE = "CP_QUORUM_APPROX";

interface Props {
  cp: ControlPlaneBody | null | undefined;
  thresholds: ClusterThresholds["node"] | undefined;
  /** heartbeat stale (전 셀 stale 모습) */
  watch: StaleMark;
  now: number;
  offsetMs: number;
  /** 클러스터 스냅샷 자체가 아직 없음 */
  loading: boolean;
  metricsOff: boolean;
}

export function ControlPlaneSection({ cp, thresholds, watch, now, offsetMs, loading, metricsOff }: Props) {
  const router = useRouter();

  const badge = cp ? badgeProps(cp.status, watch) : undefined;
  const quorumNote = cp?.limits.notes.find((n) => n.code === QUORUM_NOTE)?.text ?? QUORUM_TOOLTIP_FALLBACK;
  const otherNotes = cp?.limits.notes.filter((n) => n.code !== QUORUM_NOTE) ?? [];

  const title = (
    <span className="row">
      {cp ? <StatusBadge size="md" {...badge!} /> : null}
      <Tooltip content={quorumNote}>
        <Icon name="circle-help" size={14} />
      </Tooltip>
    </span>
  );

  return (
    <div id={CONTROL_PLANE_ANCHOR} style={{ scrollMarginTop: SCROLL_MARGIN_TOP }}>
      <Section
        title="컨트롤 플레인"
        badges={title}
        actions={cp?.found ? <span className="text-caption-tertiary">{headCaption(cp)}</span> : undefined}
        meta={cp ? <ReasonText reasons={[cp.headline]} status={badge!.status} /> : undefined}
      >
        <div className="stack">
          {loading || !cp ? (
            <ComponentMatrix columns={[]} rows={[]} cells={[]} state="loading" caption="컨트롤 플레인 구성요소 상태" />
          ) : !cp.found ? (
            // 마스터 0대는 **오류가 아니다**. 워커 목록과 나머지 화면은 그대로 동작한다 (AC-KOPS17)
            <UnknownState
              size="sm"
              reason={cp.notFoundReason?.text ?? cp.headline}
              hint="node-role.kubernetes.io/control-plane 라벨이 있는 노드가 없습니다. 워커 목록과 나머지 화면은 그대로 동작합니다."
            />
          ) : (
            <>
              <SingleNodeChip cp={cp} />
              <WorkerPodAlert cp={cp} />
              <MasterTotals cp={cp} thresholds={thresholds} metricsOff={metricsOff} />
              <DataTable
                caption="마스터 노드"
                columns={masterColumns({ thresholds, watch, now, offsetMs, metricsOff, zoneWarn: cp.masters.zoneSpread === "single_zone" })}
                rows={cp.masters.items}
                rowKey={(m) => m.node.name}
                rowStatus={(m) => badgeProps(m.node.status).status}
                rowStale={() => watch.stale}
                onRowClick={(m) => router.push(nodeHref(m.node.name))}
                state="ready"
              />
              <Matrix
                cp={cp}
                staleAt={badge!.status === "stale" ? badge!.staleAt : undefined}
              />
              <Others cp={cp} />
            </>
          )}
          {/* 한계 안내는 접거나 닫을 수 없고, 마스터 0대여도 그대로 보인다 (AC-KOPS17·26) */}
          {otherNotes.length > 0 ? (
            <InlineAlert
              tone="info"
              title={
                <span className="stack-sm" style={{ gap: 2 }}>
                  {otherNotes.map((n) => (
                    <span key={n.code}>{n.text}</span>
                  ))}
                </span>
              }
            />
          ) : null}
        </div>
      </Section>
    </div>
  );
}

/** 섹션 머리 오른쪽 caption. 숫자는 전부 서버 값이다 */
function headCaption(cp: ControlPlaneBody): string {
  const zones = cp.masters.zones.length;
  return `마스터 ${formatCount(cp.masters.total)}대 · ${formatCount(zones)}개 AZ · 필수 구성요소 ${formatCount(cp.components.ready)}/${formatCount(cp.components.total)}`;
}

/** 마스터 1대인데 HA 판단을 껐을 때만 (디자인 3.2.0) */
function SingleNodeChip({ cp }: { cp: ControlPlaneBody }) {
  if (cp.masters.haStatus !== "single" || cp.masters.haExpected) return null;
  return (
    <span className="row">
      <Chip label="단일 구성 확인됨" icon="check" />
    </span>
  );
}

/**
 * 마스터에 워커 파드가 있을 때 한 줄 (PM 결정 Q6 — 그 구성의 정밀한 배분은 범위 밖).
 * `0`(없음)과 `null`(세지 못함)을 구분해 **둘 다 경고를 띄우지 않는다**.
 */
function WorkerPodAlert({ cp }: { cp: ControlPlaneBody }) {
  const total = cp.masters.items.reduce((n, m) => n + (m.workerPodCount ?? 0), 0);
  if (total <= 0) return null;
  return (
    <InlineAlert
      tone="warn"
      compact
      title={`컨트롤 플레인 노드에 워커 파드가 ${formatCount(total)}개 있습니다 — 용량·비용 배분에 반영되지 않습니다.`}
    />
  );
}

/** 마스터 합계 2행 (디자인 3.2.1). **상태 배지 없음** — 마스터 사용률 판단은 마스터 표에서 한다 */
function MasterTotals({
  cp,
  thresholds,
  metricsOff,
}: {
  cp: ControlPlaneBody;
  thresholds: ClusterThresholds["node"] | undefined;
  metricsOff: boolean;
}) {
  const t = cp.masters.totals;
  const off = metricsOff || !t.available;
  return (
    <div className="stack-sm" style={{ maxWidth: 560 }}>
      {(["cpu", "memory"] as const).map((k) => {
        const label = k === "cpu" ? "CPU 합계" : "메모리 합계";
        const th = k === "cpu" ? thresholds?.cpu : thresholds?.memory;
        const block = k === "cpu" ? t.cpu : t.memory;
        const pct = block?.usagePct ?? null;
        if (off || !block || pct === null) {
          return (
            <div key={k} className="label-row">
              <span className="text-caption">{label}</span>
              <span className="text-caption">— 알 수 없음 (metrics-server 없음)</span>
            </div>
          );
        }
        const value =
          k === "cpu" && t.cpu
            ? `${formatMillicores(t.cpu.usageMillicores ?? 0)} / ${formatMillicores(t.cpu.allocatableMillicores)} (${formatPercent(pct / 100)})`
            : t.memory
              ? `${formatBytes(t.memory.usageBytes ?? 0)} / ${formatBytes(t.memory.allocatableBytes)} (${formatPercent(pct / 100)})`
              : "—";
        return (
          <div key={k} className="label-row">
            <span className="text-caption">{label}</span>
            <UsageBar
              value={pct / 100}
              status="ok"
              warnAt={th ? th.warnPct / 100 : undefined}
              critAt={th?.critPct ? th.critPct / 100 : undefined}
              label={value}
              name={`마스터 ${label}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function masterColumns(o: {
  thresholds: ClusterThresholds["node"] | undefined;
  watch: StaleMark;
  now: number;
  offsetMs: number;
  metricsOff: boolean;
  zoneWarn: boolean;
}): Column<ControlPlaneMasterItem>[] {
  const th = o.thresholds;
  const usageCell = (m: ControlPlaneMasterItem, k: "cpu" | "memory") => {
    const u = m.node.usage;
    if (o.metricsOff || !u || !m.reporting) return "—";
    const pct = k === "cpu" ? u.cpuPct : u.memoryPct;
    const t = k === "cpu" ? th?.cpu : th?.memory;
    return (
      <UsageBar
        size="sm"
        value={pct / 100}
        status="ok"
        warnAt={t ? t.warnPct / 100 : undefined}
        critAt={t?.critPct ? t.critPct / 100 : undefined}
        label={formatPercent(pct / 100)}
        name={k === "cpu" ? "CPU 사용률" : "메모리 사용률"}
      />
    );
  };
  return [
    {
      id: "status",
      header: "상태",
      width: 112,
      render: (m) => <StatusBadge size="sm" {...badgeProps(m.node.status, o.watch)} reason={m.reasonText ?? undefined} />,
    },
    {
      id: "name",
      header: "이름",
      minWidth: 200,
      maxWidth: 280,
      render: (m) => (
        <span className="row">
          <ResourceName name={m.node.name} kind="node" maxWidth={200} />
          {m.node.capacityType === "spot" ? <Chip label="스팟" icon="zap" /> : null}
          {m.node.unschedulable ? <Chip label="스케줄 제외" icon="ban" /> : null}
        </span>
      ),
    },
    {
      id: "reason",
      header: "사유",
      minWidth: 200,
      // 서버 문장 그대로. 매트릭스 열 머리 툴팁(`columns[].reason`)과 같은 값이다
      render: (m) => (m.reasonText ? <ReasonText reasons={[m.reasonText]} status={badgeProps(m.node.status).status} /> : null),
    },
    { id: "nodeGroup", header: "InstanceGroup", width: 160, render: (m) => m.node.nodeGroup ?? "—" },
    { id: "instanceType", header: "인스턴스 타입", width: 112, render: (m) => <span className="text-mono">{m.node.instanceType ?? "—"}</span> },
    {
      id: "zone",
      header: o.zoneWarn ? <ZoneHeader /> : "AZ",
      width: 120,
      render: (m) => m.node.zone ?? "—",
    },
    { id: "cpu", header: "CPU", width: 140, render: (m) => usageCell(m, "cpu") },
    { id: "memory", header: "메모리", width: 140, render: (m) => usageCell(m, "memory") },
    {
      id: "components",
      header: "구성요소",
      width: 96,
      render: (m) => (
        <span className="row">
          {apiStatus(m.components.worst) === "ok" ? null : <StatusBadge size="sm" variant="dot" status={apiStatus(m.components.worst)} />}
          {formatCount(m.components.ready)}/{formatCount(m.components.total)}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: "경과",
      width: 72,
      numeric: true,
      render: (m) => <span suppressHydrationWarning>{elapsedText(m.node.createdAt, o.now, o.offsetMs)}</span>,
    },
  ];
}

function ZoneHeader() {
  return (
    <Tooltip content="마스터가 모두 같은 AZ에 있습니다">
      <span className="row">
        AZ
        <Icon name="triangle-alert" size={12} />
      </span>
    </Tooltip>
  );
}

/**
 * 구성요소 매트릭스. `components.columns`·`components.items`를 **그대로** 넘긴다.
 * 빈 칸은 서버가 `missing`으로 채우므로 화면이 칸을 만들지 않는다.
 */
function Matrix({ cp, staleAt }: { cp: ControlPlaneBody; staleAt?: string }) {
  const c = cp.components;
  // `columns`와 `masters.items`는 같은 순서·길이다(계약 3.3). 노드 상태·사양만 마스터 쪽에서 가져온다
  const byNode = new Map(cp.masters.items.map((m) => [m.node.name, m]));
  const columns: ComponentMatrixColumn[] = c.columns.map((col) => {
    const m = byNode.get(col.nodeName);
    const meta = [m?.node.zone, m?.node.instanceType].filter(Boolean).join(" · ");
    return {
      id: col.nodeName,
      name: col.nodeName,
      meta: meta || undefined,
      status: apiStatus(m?.node.status.status),
      notReporting: !col.reporting,
      // 마스터 표 `사유` 열과 같은 서버 문자열. 화면에서 문장을 새로 만들지 않는다
      reason: col.reason ?? undefined,
      href: nodeHref(col.nodeName),
    };
  });
  const cells: ComponentMatrixCell[] = c.items.map((it) => {
    const [ns, name] = (it.podKey ?? "").split("/");
    return {
      columnId: it.nodeName,
      rowId: it.kind,
      state: CELL_STATE[it.cellState],
      label: it.cellText,
      detail: it.cellDetail ?? undefined,
      href: it.clickable && ns && name ? podHref(ns, name) : undefined,
      /**
       * 로그 버튼 (logs.md 11.1·11.3). **서버 `logHref` 그대로** 쓴다(`follow=1`이 붙어 온다).
       * 2026-09-25 backend 가 SSE(`cluster.snapshot`·`cluster.controlplane.updated`)에도 REST 와 같은 값을
       * 채우게 고쳐서, 통합 1차에 두었던 `podKey` 폴백을 **지웠다** — 규칙이 서버와 화면 두 곳에 있으면
       * `LOG_DENY_NAMESPACES`가 한쪽만 먹는다(logs 계약 12절). `null`이면 버튼이 없다.
       * `missing` 셀에는 `ComponentMatrix`가 알아서 안 그리고, `notReporting`에는 **그린다**(조회가 성공할 수도 있다).
       */
      logHref: it.logHref ?? undefined,
      // 최소 셀 폭 140px에서 detail 이 말줄임된다 — **툴팁 없이 자르지 않는다**(디자이너 못박음)
      tooltip: it.cellTooltip ?? undefined,
    };
  });
  const counts = c.cellCounts;
  const summary: { state: Status; count: number }[] = [
    { state: "ok", count: counts.ok },
    { state: "warn", count: counts.warning },
    { state: "crit", count: counts.critical },
    // "알 수 없음"은 서버가 합친 값 하나만 쓴다(notReporting + unknown + missing, PM 결정)
    { state: "unknown", count: counts.unknownTotal },
  ];
  if (counts.stale > 0) summary.push({ state: "stale", count: counts.stale });

  return (
    <ComponentMatrix
      columns={columns}
      rows={c.requiredKinds.map((k) => ({ id: k, label: k }))}
      cells={cells}
      summary={summary}
      // `onSummaryClick`을 넘기지 않는다: 강조(2000ms 깜박임)는 ComponentMatrix 안에서 끝난다.
      // 필터·URL 반영처럼 **바깥에서 할 일**이 생길 때만 넘긴다.
      // 서버 stale(`status.stale`)과 heartbeat 끊김을 같은 자리에서 본다(badgeProps 가 합쳐 준다)
      staleAt={staleAt}
      // 서버 요약 문장을 스크린리더 표 제목에 함께 준다(화면은 숫자를 다시 세지 않는다)
      caption={`컨트롤 플레인 구성요소 상태 — ${c.summaryText}`}
    />
  );
}

/** 기타 구성요소 (필수 판정 제외). 0개면 섹션 자체를 숨긴다 */
function Others({ cp }: { cp: ControlPlaneBody }) {
  const rows = [...cp.others].sort(
    (a, b) => statusRank({ status: a.status, reasons: [], updatedAt: null, statusChangedAt: null, stale: false }) - statusRank({ status: b.status, reasons: [], updatedAt: null, statusChangedAt: null, stale: false }),
  );
  if (rows.length === 0) return null;
  return (
    <Section
      title={`기타 컨트롤 플레인 구성요소 ${formatCount(rows.length)}개`}
      headingLevel={3}
      collapsible
      defaultCollapsed
      badges={
        <Chip
          label="필수 판정 제외"
          icon="minus"
          tooltip="있어도 없어도 정상입니다. 컨트롤 플레인 상태 판단에 넣지 않습니다."
        />
      }
    >
      <DataTable
        caption="기타 컨트롤 플레인 구성요소"
        density="compact"
        columns={[
          { id: "name", header: "이름", minWidth: 240, render: (r) => <ResourceName name={r.name} kind="pod" maxWidth={280} /> },
          { id: "node", header: "마스터", width: 200, render: (r) => <ResourceName name={r.nodeName} kind="node" maxWidth={180} copyable={false} /> },
          { id: "status", header: "상태", width: 112, render: (r) => <StatusBadge size="sm" status={apiStatus(r.status)} /> },
          {
            id: "reason",
            header: "사유",
            minWidth: 160,
            render: (r) => (r.restarts1h > 0 ? <span className="text-caption">재시작 {formatCount(r.restarts1h)}회 (1시간)</span> : null),
          },
        ]}
        rows={rows}
        rowKey={(r) => `${r.nodeName}/${r.name}`}
        state="ready"
      />
    </Section>
  );
}
