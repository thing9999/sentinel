"use client";

/**
 * 휴지통 `/snapshots/trash` (docs/design/aws-snapshot-manager.md 7절·6.7·6.8, 명세 3.8 Q2).
 * - 데이터: GET /api/aws-snapshots/trash. `aws-snapshots.changed`(trashChanged)·`.snapshot` 이 오면 다시 조회.
 * - 휴지통 항목은 상태 판단·스캔을 하지 않는다. 자동 비우기 없음.
 */
import Link from "next/link";
import { useState } from "react";

import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  formatCount,
  InlineAlert,
  KeyValueList,
  PageHeader,
  Timestamp,
  TypeToConfirmDialog,
  type Column,
} from "@/components/ui";
import { isApiError } from "@/lib/api";

import { errorBody, useApi } from "../common/hooks";
import { purgeFromTrash, restoreFromTrash } from "./api";
import { FileListBlock } from "./dialogs";
import { useSnapshotsView } from "./hooks";
import { formatSize, isRawDataName, writeErrorText } from "./model";
import { MockNotice, SnapshotTime, SourceUnknown, WriteBlockBanner } from "./shared";
import type { TrashItem, TrashResponse } from "./types";

const BREADCRUMBS = [{ label: "AWS 스냅샷", href: "/snapshots" }, { label: "휴지통" }];

type Dlg = { kind: "restore" | "purge"; item: TrashItem } | null;

export function TrashPage() {
  const view = useSnapshotsView();
  const list = useApi<TrashResponse>("/aws-snapshots/trash", undefined, `${view.resetSeq}:${view.trashSeq}`);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; exists?: boolean } | null>(null);
  const [notice, setNotice] = useState<{ text: string; href?: string; linkLabel?: string } | null>(null);
  const summary = view.summary;
  const writable = summary?.writable;
  const writeBlocked = writable && !writable.allowed ? (writable.reasonText ?? "쓰기 불가") : undefined;
  const unknownSource = summary && (summary.root.state === "not_configured" || summary.root.state === "unavailable");

  const close = () => {
    setDlg(null);
    setError(null);
  };

  const restore = async (item: TrashItem) => {
    setBusy(true);
    setError(null);
    try {
      const res = await restoreFromTrash(item.trashId);
      close();
      setNotice({ text: `${res.snapshot.id}을 복원했습니다.`, href: `/snapshots/${res.snapshot.id}`, linkLabel: "스냅샷 보기" });
      list.reload();
    } catch (e) {
      const body = errorBody(e);
      if (body?.code === "SNAPSHOT_ID_EXISTS") setError({ text: "같은 ID의 스냅샷이 이미 있어 복원할 수 없습니다.", exists: true });
      else setError({ text: writeErrorText(body, isApiError(e) ? e.message : "복원하지 못했습니다") });
    } finally {
      setBusy(false);
    }
  };

  const purge = async (item: TrashItem) => {
    setBusy(true);
    setError(null);
    try {
      await purgeFromTrash(item.trashId, item.snapshotId);
      close();
      setNotice({ text: `휴지통의 ${item.snapshotId}을 영구 삭제했습니다.` });
      list.reload();
    } catch (e) {
      setError({ text: writeErrorText(errorBody(e), isApiError(e) ? e.message : "삭제하지 못했습니다") });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<TrashItem>[] = [
    {
      id: "snapshot",
      header: "스냅샷",
      width: 200,
      render: (it) => (
        <span className="row gap-1">
          <SnapshotTime iso={it.snapshotAt} id={it.snapshotId} />
          <span className="text-mono text-caption-tertiary">{it.snapshotId}</span>
        </span>
      ),
    },
    { id: "label", header: "라벨", minWidth: 200, render: (it) => <span className="truncate">{it.label ?? ""}</span> },
    { id: "region", header: "리전", width: 136, hideBelow: 1280, render: (it) => <span className="text-mono">{it.region ?? "—"}</span> },
    { id: "deletedAt", header: "휴지통으로 옮긴 시각", width: 152, render: (it) => (it.deletedAt ? <Timestamp value={it.deletedAt} format="auto" /> : "—") },
    {
      id: "files",
      header: "파일",
      width: 120,
      align: "right",
      numeric: true,
      render: (it) => `${formatCount(it.files.length)}개 · ${formatSize(it.sizeBytes)}`,
    },
    {
      id: "actions",
      header: <span className="sr-only">동작</span>,
      width: 232,
      render: (it) => {
        const restoreReason = writeBlocked ?? (it.restore.allowed ? undefined : (it.restore.reasonText ?? "복원할 수 없습니다"));
        return (
          <span className="row gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon="undo-2"
              disabled={Boolean(restoreReason)}
              disabledReason={restoreReason}
              onClick={() => setDlg({ kind: "restore", item: it })}
            >
              복원
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon="trash-2"
              disabled={Boolean(writeBlocked)}
              disabledReason={writeBlocked}
              onClick={() => setDlg({ kind: "purge", item: it })}
            >
              영구 삭제
            </Button>
          </span>
        );
      },
    },
  ];

  const header = (
    <PageHeader
      title="휴지통"
      breadcrumbs={BREADCRUMBS}
      subtitle="휴지통의 스냅샷은 git·CLI 스캔 대상이 아닙니다. 자동으로 비우지 않습니다."
    />
  );

  if (summary && unknownSource) {
    return (
      <>
        {header}
        <SourceUnknown summary={summary} />
      </>
    );
  }

  const items = list.data?.items ?? [];
  const state = list.error && !list.data ? "error" : !list.data ? "loading" : "ready";
  const item = dlg?.item;
  const fileRows = item
    ? item.files.map((n) => ({ key: n, name: n, sizeBytes: null, mark: isRawDataName(n) ? ("raw" as const) : n === "notes.json" ? ("notes" as const) : null }))
    : [];

  return (
    <>
      {header}
      <div className="page-stack">
        {list.data?.dataSource === "mock" ? <MockNotice /> : null}
        <WriteBlockBanner writable={writable} />
        {notice ? (
          <InlineAlert
            tone="ok"
            compact
            live
            title={notice.text}
            action={
              <span className="row gap-2">
                {notice.href ? (
                  <Link href={notice.href} className="text-link">
                    {notice.linkLabel}
                  </Link>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
                  닫기
                </Button>
              </span>
            }
          />
        ) : null}
        {list.data && items.length === 0 ? (
          <EmptyState
            size="lg"
            icon="trash-2"
            title="휴지통이 비어 있습니다"
            action={
              <Link href="/snapshots" className="text-link">
                목록으로
              </Link>
            }
          />
        ) : (
          <DataTable
            caption="휴지통 목록"
            columns={columns}
            rows={items}
            rowKey={(it) => it.trashId}
            state={state}
            errorTitle="휴지통 목록을 불러오지 못했습니다"
            onRetry={list.reload}
            loadingRows={5}
          />
        )}
      </div>

      <Dialog
        open={dlg?.kind === "restore"}
        onClose={close}
        size="sm"
        title="스냅샷을 복원할까요?"
        description={item ? `${item.snapshotId}을 스냅샷 목록으로 되돌립니다. 파일 내용·라벨·메모는 삭제 전과 같습니다.` : undefined}
        confirmLabel="복원"
        confirmLoading={busy}
        confirmLoadingLabel="복원 중"
        confirmDisabled={Boolean(error?.exists)}
        confirmDisabledReason="같은 ID의 스냅샷이 이미 있습니다"
        onConfirm={() => item && void restore(item)}
      >
        {error ? (
          <InlineAlert
            tone="crit"
            live
            title={error.text}
            description={error.exists && item ? `기존 ${item.snapshotId}을 먼저 휴지통으로 옮긴 뒤 다시 복원하세요.` : undefined}
            action={
              error.exists && item ? (
                <Link href={`/snapshots/${item.snapshotId}`} className="text-link">
                  기존 스냅샷 보기
                </Link>
              ) : undefined
            }
          />
        ) : null}
      </Dialog>

      <TypeToConfirmDialog
        open={dlg?.kind === "purge"}
        onClose={close}
        title="영구 삭제할까요?"
        description={item ? `휴지통의 ${item.snapshotId} 폴더를 지웁니다. 되돌릴 수 없습니다.` : undefined}
        expected={item?.snapshotId ?? ""}
        inputLabel={
          <>
            확인을 위해 스냅샷 ID <code className="text-mono">{item?.snapshotId}</code>을 입력하세요
          </>
        }
        confirmLabel="영구 삭제"
        confirmLoadingLabel="삭제 중"
        loading={busy}
        error={error?.text}
        onConfirm={() => item && void purge(item)}
      >
        {item ? (
          <div className="stack">
            <KeyValueList
              columns={1}
              labelWidth={96}
              items={[
                {
                  label: "시각",
                  value: (
                    <span className="row gap-2">
                      <SnapshotTime iso={item.snapshotAt} id={item.snapshotId} />
                      <span className="text-mono text-caption-tertiary">{item.snapshotId}</span>
                    </span>
                  ),
                },
                { label: "라벨", value: item.label ?? "—" },
                { label: "옮긴 시각", value: item.deletedAt ? <Timestamp value={item.deletedAt} format="auto" /> : "—" },
              ]}
            />
            <FileListBlock rows={fileRows} />
          </div>
        ) : null}
      </TypeToConfirmDialog>
    </>
  );
}
