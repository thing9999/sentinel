"use client";

/**
 * AWS 스냅샷 목록 `/snapshots` (docs/design/aws-snapshot-manager.md 3절, 명세 3.1).
 * - 머리: `스냅샷` + AWS / Kubernetes 탭 (docs/design/k8s-snapshot.md 2.3). 쿼리 없이 열면 AWS 탭(AC-K17).
 * - 데이터: GET /api/aws-snapshots (전체를 받아 브라우저에서 필터·정렬, 계약 6.2).
 * - 갱신: aws-snapshots 토픽 이벤트가 오면 다시 조회. 요약 띠는 스트림 요약으로 바로 교체(계약 11절).
 * - 상태·사유·개수는 서버 값만 쓴다. 내보내기·적용 버튼은 없다(U5·U6).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  Button,
  ButtonLink,
  Chip,
  DataTable,
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
  Spinner,
  StaleNotice,
  StatusBadge,
  SummaryStrip,
  SummaryStripItem,
  Tooltip,
  TwoLineCell,
  type Column,
} from "@/components/ui";

import { errorBody, useApi, useUrlQuery } from "../common/hooks";
import { SnapshotsHeader } from "../snapshot-menu/SnapshotsHeader";
import { badgeProps, reasonTexts } from "../stream/stale";
import { refreshSnapshots } from "./api";
import { NotesDialog, TrashMoveDialog } from "./dialogs";
import { cliGuideStore, useBoolStore, useSnapshotsView } from "./hooks";
import {
  blockReason,
  countByRegion,
  countByStatusKey,
  countsPair,
  DEFAULT_CLI,
  deltaPair,
  filterItems,
  isSnapshotId,
  parseListParam,
  parseSortParam,
  parseStatusParam,
  scopeSummary,
  snapshotStatusLabel,
  snapshotTimeLabel,
  sortItems,
  sortParam,
  STATUS_FILTER_KEYS,
  STATUS_FILTER_LABEL,
  type ListSort,
} from "./model";
import { CliGuide, MockNotice, RowActionButton, SnapshotTime, SourceUnknown, WriteBlockBanner } from "./shared";
import type { ListResponse, SnapshotListItem } from "./types";

type DialogState = { kind: "notes" | "trash"; id: string } | null;

export function SnapshotListPage() {
  const router = useRouter();
  const q = useUrlQuery();
  const view = useSnapshotsView();
  const list = useApi<ListResponse>("/aws-snapshots", undefined, view.seq);
  const summary = view.summary ?? list.data?.summary ?? null;
  const [guideOpen, setGuideOpen] = useBoolStore(cliGuideStore);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const statusFilter = parseStatusParam(q.get("status"));
  const regions = parseListParam(q.get("region"));
  const search = q.get("q") ?? "";
  const sort = parseSortParam(q.get("sort"));
  const trashedParam = q.get("trashed");
  const trashed = trashedParam && isSnapshotId(trashedParam) ? trashedParam : null;

  const all = useMemo(() => list.data?.items ?? [], [list.data]);
  const filtered = useMemo(() => filterItems(all, { status: statusFilter, regions, q: search }), [all, statusFilter, regions, search]);
  const rows = useMemo(() => sortItems(filtered, sort), [filtered, sort]);
  const statusCounts = useMemo(() => countByStatusKey(all), [all]);
  const regionCounts = useMemo(() => countByRegion(all), [all]);
  const regionOptions = list.data?.regions ?? Object.keys(regionCounts).sort();
  const cli = list.data?.cli ?? DEFAULT_CLI;
  const dataSource = list.data?.dataSource ?? view.dataSource;
  const writable = summary?.writable;
  const unknownSource = summary && (summary.root.state === "not_configured" || summary.root.state === "unavailable");
  const stale = view.mark;

  const resetFilters = () => q.set({ status: null, region: null, q: null });
  const isDefaultFilter = statusFilter.length === 0 && regions.length === 0 && !search;

  const doRefresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await refreshSnapshots();
      list.reload();
    } catch (e) {
      setRefreshError(errorBody(e)?.message ?? "다시 읽지 못했습니다");
    } finally {
      setRefreshing(false);
    }
  };

  const openRow = (it: SnapshotListItem) => router.push(`/snapshots/${it.id}`);

  const columns: Column<SnapshotListItem>[] = [
    {
      id: "status",
      header: "상태·사유",
      width: 208,
      maxWidth: 208,
      sortable: true,
      render: (it) => {
        const b = badgeProps(it.status, stale);
        const reasons = reasonTexts(it.status);
        return (
          <TwoLineCell
            primary={<StatusBadge size="sm" {...b} label={snapshotStatusLabel(b.status)} reason={reasons[0]} />}
            secondary={
              reasons.length > 0 ? (
                <Tooltip content={reasons.join(" · ")} maxWidth={360} as="div">
                  <span className="truncate" style={{ display: "block", maxWidth: 184 }}>
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
      id: "snapshot",
      header: "스냅샷",
      minWidth: 184,
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
      id: "region",
      header: "리전·범위",
      width: 176,
      maxWidth: 176,
      render: (it) => (
        <TwoLineCell
          primary={<span className="text-mono">{it.region ?? "—"}</span>}
          secondary={
            <Tooltip content={scopeSummary(it.scope, true)} maxWidth={360} as="div">
              {/* 범위 요약은 1줄 말줄임 (디자인 3.4), 열 폭 176px 안에서 */}
              <span className="truncate" style={{ display: "block", maxWidth: 160 }}>
                {scopeSummary(it.scope)}
              </span>
            </Tooltip>
          }
        />
      ),
    },
    {
      id: "resources",
      header: "리소스 (CFN / TF)",
      width: 112,
      align: "right",
      numeric: true,
      render: (it) => (
        <TwoLineCell
          primary={<span className="tabular">{countsPair(it.resources.current)}</span>}
          secondary={
            it.resources.changedSinceExport && it.resources.atExport ? (
              <span className="text-caption-tertiary tabular">당시 {countsPair(it.resources.atExport)}</span>
            ) : undefined
          }
        />
      ),
    },
    {
      id: "delta",
      header: "직전 대비",
      width: 80,
      align: "right",
      numeric: true,
      hideBelow: 1280,
      render: (it) =>
        it.resources.previous ? (
          <Tooltip content={`같은 리전의 이전 스냅샷 ${it.resources.previous.snapshotId} 대비`}>
            <span className="tabular">{deltaPair(it.resources.delta)}</span>
          </Tooltip>
        ) : (
          <span className="text-caption-tertiary">-</span>
        ),
    },
    {
      id: "scan",
      header: "현재 스캔",
      width: 104,
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
      width: 128,
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
      id: "former2",
      header: "former2",
      width: 80,
      hideBelow: 1280,
      render: (it) => <span className="text-mono">{it.former2Version ?? "—"}</span>,
    },
    {
      id: "actions",
      header: <span className="sr-only">동작</span>,
      width: 80,
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
  // 목록 머리: h1 `스냅샷` + AWS / Kubernetes 탭 (k8s-snapshot.md 2.3). 본문은 ASM-D 3.2~3.7 그대로
  const header = (
    <SnapshotsHeader
      current="aws"
      actions={
        unknownSource ? undefined : (
          <>
            <ButtonLink
              href="/snapshots/trash"
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

  // 최초 로딩
  if (!list.data && !summary) {
    return (
      <>
        {header}
        <div className="page-stack">
          {list.error ? (
            <ErrorState size="lg" title="스냅샷 목록을 불러오지 못했습니다" description={list.error.message} onRetry={list.reload} retryLabel="다시 시도" />
          ) : (
            <>
              <SummaryStrip label="스냅샷 요약" overall={{ status: "unknown", reason: [] }} state="loading" />
              <DataTable caption="스냅샷 목록" density="comfortable" columns={columns} rows={[]} rowKey={(r) => r.id} state="loading" loadingRows={8} />
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
          <SourceUnknown summary={summary} />
        </div>
      </>
    );
  }

  const overall = summary ? badgeProps(summary.status, stale) : { status: "unknown" as const };
  const overallReasons = summary ? reasonTexts(summary.status) : [];
  const empty = list.data !== undefined && all.length === 0;
  const tableState = list.error && !list.data ? "error" : !list.data ? "loading" : rows.length === 0 ? "filteredEmpty" : "ready";

  return (
    <>
      {header}
      <div className="page-stack">
        {dataSource === "mock" ? <MockNotice /> : null}
        <WriteBlockBanner writable={writable} />
        {trashed ? (
          <InlineAlert
            tone="ok"
            compact
            live
            title={`${trashed}을 휴지통으로 옮겼습니다.`}
            action={
              <span className="row gap-2">
                <Link href="/snapshots/trash" className="text-link">
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
            label="스냅샷 요약"
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
              <span className="row gap-2 min-w-0">
                <Icon name="folder" size={14} />
                <Tooltip content={summary.root.displayPath ?? "—"} mono>
                  <span className="text-mono truncate" style={{ maxWidth: 200 }}>
                    {summary.root.displayPath ?? "—"}
                  </span>
                </Tooltip>
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
              href="/snapshots?status=crit"
            />
            <SummaryStripItem
              label="주의"
              value={formatCount(summary.counts.warning)}
              status={summary.counts.warning > 0 ? "warn" : undefined}
              href="/snapshots?status=warn"
            />
            <SummaryStripItem
              label="알 수 없음"
              value={formatCount(summary.counts.unknown)}
              status={summary.counts.unknown > 0 ? "unknown" : undefined}
              href="/snapshots?status=unknown"
            />
          </SummaryStrip>
        ) : null}

        {guideOpen && !empty ? <CliGuide cli={cli} /> : null}

        {empty ? (
          <div className="stack-lg">
            <EmptyState
              size="lg"
              icon="archive"
              title="아직 스냅샷이 없습니다"
              description="대시보드는 스냅샷을 만들지 않습니다. 터미널에서 CLI로 내보내면 30초 안에 여기에 나타납니다."
            />
            <CliGuide cli={cli} />
          </div>
        ) : (
          <>
            <FilterBar
              label="스냅샷 필터"
              resultText={list.data ? `스냅샷 ${formatCount(all.length)}개 중 ${formatCount(rows.length)}개 표시` : undefined}
              onReset={isDefaultFilter ? undefined : resetFilters}
            >
              <MultiSelect
                label="상태"
                width={200}
                value={statusFilter}
                onChange={(v) => q.set({ status: v.length ? v.join(",") : null })}
                options={STATUS_FILTER_KEYS.map((k) => ({
                  value: k,
                  label: STATUS_FILTER_LABEL[k],
                  count: statusCounts[k],
                  icon: k === "crit" ? "octagon-x" : k === "warn" ? "triangle-alert" : k === "unknown" ? "circle-help" : "circle-check",
                }))}
              />
              <MultiSelect
                label="리전"
                width={200}
                value={regions}
                onChange={(v) => q.set({ region: v.length ? v.join(",") : null })}
                options={regionOptions.map((r) => ({ value: r, label: r, count: regionCounts[r] ?? 0 }))}
              />
              <SearchInput value={search} onChange={(v) => q.set({ q: v || null })} placeholder="라벨·메모 검색" label="라벨·메모 검색" width={280} />
            </FilterBar>
            <DataTable
              caption="스냅샷 목록"
              density="comfortable"
              columns={columns}
              rows={rows}
              rowKey={(it) => it.id}
              sort={sort}
              onSortChange={(s) => q.set({ sort: sortParam(s as ListSort | null) })}
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

      <NotesDialog
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
      <TrashMoveDialog
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
