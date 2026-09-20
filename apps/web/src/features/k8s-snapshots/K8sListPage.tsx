"use client";

/**
 * Kubernetes 스냅샷 목록 `/snapshots/k8s` (docs/design/k8s-snapshot.md 3절, 명세 5.2).
 * - 데이터: GET /api/k8s-snapshots?status=&drift=&cluster=&q=&sort= (URL 쿼리 = API 값, 3.3). 필터·정렬·개수(facets)는 서버.
 * - 갱신: `k8s-snapshots.snapshot`·`.changed`가 오면 다시 조회. `.drift`는 해당 행의 드리프트 배지만 바꾼다(13절).
 * - 파일 상태와 드리프트는 다른 열(두 축). 드리프트 열은 정렬하지 않는다(API 정렬 키 없음).
 * - 내보내기·적용 버튼은 없다(CLI 안내만).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Button,
  ButtonLink,
  Chip,
  DataTable,
  DriftStatus,
  EmptyState,
  ErrorState,
  FilterBar,
  formatCount,
  formatTime,
  Icon,
  IconButton,
  InlineAlert,
  MultiSelect,
  ReasonText,
  ScanCounts,
  SearchInput,
  Select,
  Spinner,
  StaleNotice,
  StatusBadge,
  SummaryStrip,
  SummaryStripItem,
  TableLinkCell,
  Tooltip,
  TwoLineCell,
  type Column,
} from "@/components/ui";

import { useBoolStore } from "../aws-snapshots/hooks";
import { blockReason, snapshotStatusLabel, snapshotTimeLabel } from "../aws-snapshots/model";
import { RowActionButton } from "../aws-snapshots/shared";
import { errorBody, useApi, useUrlQuery } from "../common/hooks";
import { SnapshotsHeader } from "../snapshot-menu/SnapshotsHeader";
import { badgeProps, reasonTexts } from "../stream/stale";
import { refreshK8sSnapshots } from "./api";
import { K8sNotesDialog, K8sTrashMoveDialog } from "./dialogs";
import { k8sCliGuideStore, useK8sSnapshotsView } from "./hooks";
import {
  apiSortValue,
  CLUSTER_KEYS,
  clusterFilterLabel,
  clusterLabel,
  clusterTooltip,
  DEFAULT_K8S_CLI,
  DRIFT_KEY_LABEL,
  DRIFT_KEYS,
  driftCellView,
  isSnapshotId,
  K8S_TRASH_HREF,
  k8sDetailHref,
  k8sSortParam,
  parseCsv,
  parseK8sSort,
  relationText,
  scopeCountsText,
  scopeRuleText,
  scopeRuleTooltip,
  signedDelta,
  STATUS_KEY_LABEL,
  STATUS_KEYS,
  type K8sSort,
} from "./model";
import { driftBadgeParts, K8sCliGuide, K8sSourceUnknown, K8sWriteBlockBanner, MockNotice, SnapshotTime } from "./shared";
import type { ClusterRelation, K8sListResponse, K8sSnapshotListItem } from "./types";

type DialogState = { kind: "notes" | "trash"; id: string } | null;

const STATUS_ICON = { critical: "octagon-x", warning: "triangle-alert", unknown: "circle-help", ok: "circle-check" } as const;
const DRIFT_ICON = { warning: "triangle-alert", unknown: "circle-help", ok: "circle-check", not_computed: "minus" } as const;

export function K8sListPage() {
  const router = useRouter();
  const q = useUrlQuery();
  const view = useK8sSnapshotsView();
  const [guideOpen, setGuideOpen] = useBoolStore(k8sCliGuideStore);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const statusFilter = parseCsv(q.get("status"), STATUS_KEYS);
  const driftFilter = parseCsv(q.get("drift"), DRIFT_KEYS);
  const clusterFilter = parseCsv(q.get("cluster"), CLUSTER_KEYS);
  const search = q.get("q") ?? "";
  const sort = parseK8sSort(q.get("sort"));
  const trashedParam = q.get("trashed");
  const trashed = trashedParam && isSnapshotId(trashedParam) ? trashedParam : null;

  const query = {
    status: statusFilter.length ? statusFilter.join(",") : undefined,
    drift: driftFilter.length ? driftFilter.join(",") : undefined,
    cluster: clusterFilter.length ? clusterFilter.join(",") : undefined,
    q: search.trim() ? search.trim().slice(0, 200) : undefined,
    sort: apiSortValue(sort),
  };
  const list = useApi<K8sListResponse>("/k8s-snapshots", query, view.seq);
  const summary = view.summary ?? list.data?.summary ?? null;
  const cli = list.data?.cli ?? DEFAULT_K8S_CLI;
  const dataSource = list.data?.dataSource ?? view.dataSource;
  const unknownSource = summary && (summary.root.state === "not_configured" || summary.root.state === "unavailable");
  const stale = view.mark;
  const facets = list.data?.facets;
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const dashboardName = summary?.dashboardCluster.name ?? summary?.dashboardCluster.context ?? null;

  const resetFilters = () => q.set({ status: null, drift: null, cluster: null, q: null });
  const isDefaultFilter = statusFilter.length === 0 && driftFilter.length === 0 && clusterFilter.length === 0 && !search;

  const doRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshK8sSnapshots();
      list.reload();
    } catch (e) {
      setRefreshError(errorBody(e)?.message ?? "다시 읽지 못했습니다");
    } finally {
      setRefreshing(false);
    }
  };

  const openRow = (it: K8sSnapshotListItem) => router.push(k8sDetailHref(it.id));
  const driftOf = (it: K8sSnapshotListItem) => view.driftFor(it.id) ?? it.drift;

  const columns: Column<K8sSnapshotListItem>[] = [
    {
      id: "status",
      header: "파일",
      width: 176,
      maxWidth: 176,
      sortable: true,
      render: (it) => {
        const b = badgeProps(it.status, stale);
        const reasons = reasonTexts(it.status);
        return (
          <TwoLineCell
            primary={<StatusBadge size="sm" {...b} label={snapshotStatusLabel(b.status)} reason={reasons[0]} srPrefix="" />}
            secondary={
              reasons.length > 0 ? (
                <Tooltip content={reasons.join(" · ")} maxWidth={360} as="div">
                  <span className="truncate" style={{ display: "block", maxWidth: 152 }}>
                    <ReasonText reasons={reasons} status={b.status} lines={1} />
                  </span>
                </Tooltip>
              ) : undefined
            }
          />
        );
      },
    },
    {
      id: "drift",
      header: "드리프트",
      width: 160,
      maxWidth: 160,
      render: (it) => {
        const parts = driftBadgeParts(driftOf(it), { kubeStale: view.kubeStale, srPrefix: "" });
        return (
          // 셀 전체가 드리프트 탭 링크 (행 이동을 막는다, 디자인 3.4)
          <TableLinkCell href={k8sDetailHref(it.id, { view: "drift" })}>
            <TwoLineCell
              primary={parts.primary}
              secondary={parts.secondary ? <span className="text-caption-tertiary truncate" style={{ display: "block", maxWidth: 144 }}>{parts.secondary}</span> : undefined}
            />
          </TableLinkCell>
        );
      },
    },
    {
      id: "snapshot",
      header: "스냅샷",
      minWidth: 168,
      maxWidth: 240,
      sortable: true,
      render: (it) => (
        <TwoLineCell
          strong
          primary={<SnapshotTime iso={it.snapshotAt} id={it.id} strong />}
          secondary={
            it.label || it.memo ? (
              <span className="row gap-1-5 min-w-0">
                {it.label ? (
                  <Tooltip content={it.label}>
                    <span className="truncate" style={{ display: "block", maxWidth: 200 }}>
                      {it.label}
                    </span>
                  </Tooltip>
                ) : null}
                {it.memo ? (
                  <Tooltip content={it.memo.slice(0, 200)} maxWidth={360}>
                    <span className="row" aria-label="메모 있음">
                      <Icon name="sticky-note" size={12} />
                    </span>
                  </Tooltip>
                ) : null}
              </span>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "cluster",
      header: "클러스터",
      width: 144,
      maxWidth: 144,
      render: (it) => (
        <TwoLineCell
          primary={
            <Tooltip content={clusterTooltip(it.cluster)} mono>
              <span className="text-mono truncate" style={{ display: "block", maxWidth: 128 }}>
                {clusterLabel(it.cluster)}
              </span>
            </Tooltip>
          }
          secondary={<RelationText relation={it.cluster?.relation ?? null} />}
        />
      ),
    },
    {
      id: "scope",
      header: "범위",
      width: 136,
      maxWidth: 136,
      hideBelow: 1280,
      render: (it) => (
        <TwoLineCell
          primary={<span className="tabular">{scopeCountsText(it.scope)}</span>}
          secondary={
            <Tooltip content={scopeRuleTooltip(it.scope)} maxWidth={360} as="div">
              <span className="truncate" style={{ display: "block", maxWidth: 120 }}>
                {scopeRuleText(it.scope)}
              </span>
            </Tooltip>
          }
        />
      ),
    },
    {
      id: "resources",
      header: "리소스",
      width: 96,
      align: "right",
      numeric: true,
      render: (it) => {
        const r = it.resources;
        const changed = r.changedSinceExport && r.atExport;
        return (
          <TwoLineCell
            primary={
              <span className="row row-end gap-1 tabular">
                {changed ? (
                  <Tooltip content={`내보내기 당시 ${formatCount(r.atExport!.total)}개`}>
                    <span className="row" aria-label={`내보내기 당시 ${formatCount(r.atExport!.total)}개`}>
                      <Icon name="pencil" size={12} />
                    </span>
                  </Tooltip>
                ) : null}
                {formatCount(r.current.total)}
              </span>
            }
            secondary={
              r.previous ? (
                <Tooltip content={`${r.previous.snapshotId} 대비`}>
                  <span className="text-caption-tertiary tabular">직전 {signedDelta(r.delta)}</span>
                </Tooltip>
              ) : (
                <span className="text-caption-tertiary">직전 -</span>
              )
            }
          />
        );
      },
    },
    {
      id: "scan",
      header: "현재 스캔",
      width: 96,
      render: (it) => (
        <ScanCounts
          errors={it.scan.errors}
          warnings={it.scan.warnings}
          layout="stacked"
          state={stale.stale ? "stale" : it.status.reasons.some((r) => r.code === "FILE_UNREADABLE") ? "unknown" : "ready"}
        />
      ),
    },
    {
      id: "modified",
      header: "마지막 수정",
      width: 112,
      hideBelow: 1280,
      render: (it) => (
        <TwoLineCell
          primary={
            it.lastModifiedAt ? (
              <Tooltip content={formatTime(it.lastModifiedAt, "auto")}>
                <span className="tabular" suppressHydrationWarning>
                  {snapshotTimeLabel(it.lastModifiedAt, "—")}
                </span>
              </Tooltip>
            ) : (
              "—"
            )
          }
          secondary={
            it.modifiedByDashboard ? (
              <span className="row gap-1">
                <Icon name="pencil" size={12} />
                대시보드에서 수정
              </span>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "actions",
      header: <span className="sr-only">동작</span>,
      width: 72,
      align: "center",
      render: (it) => (
        <span className="row gap-1">
          <RowActionButton
            icon="tag"
            label="라벨·메모 편집"
            disabledReason={blockReason(it.actions.editNotes)}
            onClick={() => setDialog({ kind: "notes", id: it.id })}
          />
          <RowActionButton
            icon="trash-2"
            label="휴지통으로 이동"
            disabledReason={blockReason(it.actions.delete)}
            onClick={() => setDialog({ kind: "trash", id: it.id })}
          />
        </span>
      ),
    },
  ];

  const trashCount = summary?.trashCount ?? 0;
  const header = (
    <SnapshotsHeader
      current="k8s"
      actions={
        unknownSource ? undefined : (
          <>
            <ButtonLink
              href={K8S_TRASH_HREF}
              icon="trash-2"
              suffix={trashCount > 0 ? formatCount(trashCount) : undefined}
              suffixLabel={trashCount > 0 ? `${formatCount(trashCount)}개` : undefined}
            >
              휴지통
            </ButtonLink>
            <Button variant="secondary" icon="terminal" aria-expanded={guideOpen} onClick={() => setGuideOpen(!guideOpen)}>
              <span className="row gap-1">
                새 스냅샷 만들기 안내
                <span className="row" style={{ transform: guideOpen ? "rotate(180deg)" : undefined }}>
                  <Icon name="chevron-down" size={12} />
                </span>
              </span>
            </Button>
          </>
        )
      }
    />
  );

  if (!list.data && !summary) {
    return (
      <>
        {header}
        <div className="page-stack">
          {list.error ? (
            <ErrorState size="lg" title="스냅샷 목록을 불러오지 못했습니다" description={list.error.message} onRetry={list.reload} retryLabel="다시 시도" />
          ) : (
            <>
              <SummaryStrip label="Kubernetes 스냅샷 요약" overall={{ status: "unknown", reason: [] }} state="loading" />
              <DataTable caption="Kubernetes 스냅샷 목록" density="comfortable" columns={columns} rows={[]} rowKey={(r) => r.id} state="loading" loadingRows={8} />
            </>
          )}
        </div>
      </>
    );
  }

  if (summary && unknownSource) {
    return (
      <>
        {header}
        <div className="page-stack">
          {dataSource === "mock" ? <MockNotice /> : null}
          <K8sSourceUnknown summary={summary} />
        </div>
      </>
    );
  }

  const overall = summary ? badgeProps(summary.status, stale) : { status: "unknown" as const };
  const overallReasons = summary ? reasonTexts(summary.status) : [];
  const empty = list.data !== undefined && total === 0;
  const tableState = list.error && !list.data ? "error" : !list.data ? "loading" : rows.length === 0 ? "filteredEmpty" : "ready";
  const latest = summary?.latestDrift ?? null;
  const latestBadge = latest ? (view.driftFor(latest.snapshotId) ?? latest.drift) : null;
  const latestView = latestBadge ? driftCellView(latestBadge, { kubeStale: view.kubeStale }) : null;

  return (
    <>
      {header}
      <div className="page-stack">
        {dataSource === "mock" ? <MockNotice /> : null}
        <K8sWriteBlockBanner writable={summary?.writable} />
        {trashed ? (
          <InlineAlert
            tone="ok"
            compact
            live
            title={`${trashed}을 휴지통으로 옮겼습니다.`}
            action={
              <span className="row gap-2">
                <Link href={K8S_TRASH_HREF} className="text-link">
                  휴지통 보기
                </Link>
                <Button variant="ghost" size="sm" onClick={() => q.set({ trashed: null })}>
                  닫기
                </Button>
              </span>
            }
          />
        ) : null}
        {notice ? (
          <InlineAlert
            tone="ok"
            compact
            live
            title={notice}
            action={
              <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
                닫기
              </Button>
            }
          />
        ) : null}
        {refreshError ? <InlineAlert tone="warn" compact title={`다시 읽기 실패: ${refreshError}`} /> : null}

        {summary ? (
          <SummaryStrip
            label="Kubernetes 스냅샷 요약"
            overall={{ status: overall.status, reason: overallReasons, label: snapshotStatusLabel(overall.status) }}
            updatedLabel="마지막 확인"
            updatedAt={summary.lastCheckedAt}
            updatedStale={stale.stale}
            updatedExtra={stale.stale && stale.at ? <StaleNotice staleAt={stale.at} /> : undefined}
            actions={
              refreshing ? (
                <Spinner size={16} label="다시 읽는 중" />
              ) : (
                <IconButton icon="refresh-cw" label="지금 다시 읽기" onClick={() => void doRefresh()} />
              )
            }
            meta={
              <span className="row gap-2 min-w-0" style={{ flexWrap: "wrap" }}>
                <Icon name="folder" size={14} />
                <Tooltip content={summary.root.displayPath ?? "—"} mono>
                  <span className="text-mono truncate" style={{ maxWidth: 160 }}>
                    {summary.root.displayPath ?? "—"}
                  </span>
                </Tooltip>
                <DashboardClusterText cluster={summary.dashboardCluster} />
                {summary.unrecognized.count > 0 ? (
                  <Tooltip
                    content={
                      <span className="stack-sm">
                        {summary.unrecognized.names.slice(0, 10).map((n) => (
                          <span key={n} className="text-mono">
                            {n}
                          </span>
                        ))}
                        {summary.unrecognized.count > 10 ? <span>외 {formatCount(summary.unrecognized.count - 10)}개</span> : null}
                      </span>
                    }
                  >
                    <span>
                      <Chip size="sm" icon="circle-help" label={`인식하지 못한 항목 ${formatCount(summary.unrecognized.count)}개`} />
                    </span>
                  </Tooltip>
                ) : null}
              </span>
            }
          >
            <SummaryStripItem label="전체" value={formatCount(summary.counts.total)} />
            <SummaryStripItem
              label="커밋 금지"
              value={formatCount(summary.counts.critical)}
              status={summary.counts.critical > 0 ? "crit" : undefined}
              href="/snapshots/k8s?status=critical"
            />
            <SummaryStripItem
              label="주의"
              value={formatCount(summary.counts.warning)}
              status={summary.counts.warning > 0 ? "warn" : undefined}
              href="/snapshots/k8s?status=warning"
            />
            <SummaryStripItem
              label="알 수 없음"
              value={formatCount(summary.counts.unknown)}
              status={summary.counts.unknown > 0 ? "unknown" : undefined}
              href="/snapshots/k8s?status=unknown"
            />
            <SummaryStripItem
              label="최신 드리프트"
              href={latest ? k8sDetailHref(latest.snapshotId, { view: "drift" }) : undefined}
              value={
                latest && latestView ? (
                  <Tooltip
                    content={`${latest.snapshotId} 기준${latestBadge?.computedAt ? ` · ${formatTime(latestBadge.computedAt, "autoShort")} 계산` : ""}`}
                  >
                    <span>
                      <DriftStatus
                        state={latestView.state}
                        count={latestView.count}
                        size="sm"
                        staleAt={latestView.staleAt}
                        previous={latestView.previous}
                        reason={latestView.srReason}
                        refreshing={latestView.refreshing}
                      />
                    </span>
                  </Tooltip>
                ) : (
                  <span className="text-caption-tertiary">—</span>
                )
              }
            />
          </SummaryStrip>
        ) : null}

        {guideOpen && !empty ? <K8sCliGuide cli={cli} /> : null}

        {empty ? (
          <div className="stack-lg">
            <EmptyState
              size="lg"
              icon="archive"
              title="아직 Kubernetes 스냅샷이 없습니다"
              description="대시보드는 스냅샷을 만들지 않습니다. 터미널에서 CLI로 내보내면 30초 안에 여기에 나타납니다."
            />
            <K8sCliGuide cli={cli} />
          </div>
        ) : (
          <>
            <FilterBar
              label="스냅샷 필터"
              resultText={list.data ? `스냅샷 ${formatCount(total)}개 중 ${formatCount(list.data.filteredTotal)}개 표시` : undefined}
              onReset={isDefaultFilter ? undefined : resetFilters}
            >
              <MultiSelect
                label="파일"
                width={184}
                value={statusFilter}
                onChange={(v) => q.set({ status: v.length ? v.join(",") : null })}
                options={STATUS_KEYS.map((k) => ({ value: k, label: STATUS_KEY_LABEL[k], count: facets?.status[k], icon: STATUS_ICON[k] }))}
              />
              <MultiSelect
                label="드리프트"
                width={184}
                value={driftFilter}
                onChange={(v) => q.set({ drift: v.length ? v.join(",") : null })}
                options={DRIFT_KEYS.map((k) => ({ value: k, label: DRIFT_KEY_LABEL[k], count: facets?.drift[k], icon: DRIFT_ICON[k] }))}
              />
              <Select
                label="클러스터"
                width={200}
                value={clusterFilter.length === 1 ? clusterFilter[0] : "all"}
                onChange={(v) => q.set({ cluster: v === "all" ? null : v })}
                options={[
                  { value: "all", label: "전체" },
                  ...CLUSTER_KEYS.map((k: ClusterRelation) => ({ value: k, label: clusterFilterLabel(k, dashboardName), count: facets?.cluster[k] })),
                ]}
              />
              <SearchInput
                value={search}
                onChange={(v) => q.set({ q: v || null })}
                placeholder="라벨·메모·ID·컨텍스트 검색"
                label="라벨·메모·ID·컨텍스트 검색"
                width={240}
              />
            </FilterBar>
            <DataTable
              caption="Kubernetes 스냅샷 목록"
              density="comfortable"
              columns={columns}
              rows={rows}
              rowKey={(it) => it.id}
              sort={sort}
              onSortChange={(s) => q.set({ sort: k8sSortParam(s as K8sSort | null) })}
              rowStatus={(it) => badgeProps(it.status).status}
              rowStale={() => stale.stale}
              onRowClick={openRow}
              state={tableState}
              filteredEmptyText="필터 조건에 맞는 스냅샷이 없습니다"
              onResetFilters={resetFilters}
              errorTitle="스냅샷 목록을 불러오지 못했습니다"
              onRetry={list.reload}
              virtualized={rows.length > 200}
              loadingRows={8}
            />
          </>
        )}
      </div>

      <K8sNotesDialog
        open={dialog?.kind === "notes"}
        snapshotId={dialog?.id ?? ""}
        limits={summary?.limits}
        onClose={() => setDialog(null)}
        onSaved={(res) => {
          setDialog(null);
          setNotice(`${res.snapshot.id}의 라벨·메모를 저장했습니다.`);
          list.reload();
        }}
      />
      <K8sTrashMoveDialog
        open={dialog?.kind === "trash"}
        snapshotId={dialog?.id ?? ""}
        onClose={() => setDialog(null)}
        onMoved={(res) => {
          setDialog(null);
          q.set({ trashed: res.trashItem.snapshotId });
          list.reload();
        }}
      />
    </>
  );
}

/** 클러스터 열 2줄 (디자인 3.4): same → 캡션, other → `link-2-off` + `다른 클러스터`, unknown → `circle-help` */
export function RelationText({ relation }: { relation: ClusterRelation | null }) {
  if (relation === "same") return <span className="text-caption-tertiary">{relationText("same")}</span>;
  if (relation === "other") {
    return (
      <span className="row gap-1 text-caption">
        <Icon name="link-2-off" size={12} />
        {relationText("other")}
      </span>
    );
  }
  return (
    <span className="row gap-1 text-caption-tertiary">
      <Icon name="circle-help" size={12} />
      {relationText("unknown")}
    </span>
  );
}

/** 요약 띠 둘째 줄: 대시보드 클러스터 (디자인 3.2) */
function DashboardClusterText({ cluster }: { cluster: K8sListResponse["summary"]["dashboardCluster"] }) {
  const disconnected = cluster.state === "not_configured" || cluster.state === "unavailable";
  const syncing = cluster.state === "syncing";
  const name = cluster.name ?? cluster.context;
  return (
    <span className="row gap-1 min-w-0">
      <Icon name="server" size={14} />
      <span className="text-caption-tertiary">대시보드 클러스터</span>
      {disconnected || syncing || !name ? (
        <span className="row gap-1 text-caption-tertiary">
          <Icon name="circle-help" size={12} />
          {disconnected ? "클러스터 연결 없음" : syncing ? "클러스터 동기화 중" : "확인 불가"}
        </span>
      ) : (
        <Tooltip content={[name, cluster.context ? `컨텍스트 ${cluster.context}` : null].filter(Boolean).join(" · ")} mono>
          <span className="text-mono truncate" style={{ maxWidth: 120 }}>
            {name}
            {cluster.id === null ? <span className="text-caption-tertiary"> (확인 불가)</span> : null}
          </span>
        </Tooltip>
      )}
    </span>
  );
}
