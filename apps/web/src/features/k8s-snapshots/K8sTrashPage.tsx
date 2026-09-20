"use client";

/**
 * Kubernetes 휴지통 `/snapshots/k8s/trash` (docs/design/k8s-snapshot.md 10.3, ASM-D 7절).
 * - 데이터: GET /api/k8s-snapshots/trash. `k8s-snapshots.changed`(trashChanged)·`.snapshot`이 오면 다시 조회.
 * - 휴지통 항목은 상태 판단·스캔·드리프트를 하지 않는다. 자동 비우기 없음.
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

import { formatSize, writeErrorText } from "../aws-snapshots/model";
import { errorBody, useApi } from "../common/hooks";
import { purgeK8sFromTrash, restoreK8sFromTrash } from "./api";
import { useK8sSnapshotsView } from "./hooks";
import { clusterLabel, K8S_LIST_HREF, k8sDetailHref } from "./model";
import { K8sSourceUnknown, K8sWriteBlockBanner, MockNotice, SnapshotTime } from "./shared";
import type { K8sTrashItem, K8sTrashResponse } from "./types";

const BREADCRUMBS = [{ label: "Kubernetes 스냅샷", href: K8S_LIST_HREF }, { label: "휴지통" }];

type Dlg = { kind: "restore" | "purge"; item: K8sTrashItem } | null;

export function K8sTrashPage() {
  const view = useK8sSnapshotsView();
  const list = useApi<K8sTrashResponse>("/k8s-snapshots/trash", undefined, `${view.resetSeq}:${view.trashSeq}`);
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

  const restore = async (item: K8sTrashItem) => {
    setBusy(true);
    setError(null);
    try {
      const res = await restoreK8sFromTrash(item.trashId);
      close();
      setNotice({ text: `${res.snapshot.id}을 복원했습니다.`, href: k8sDetailHref(res.snapshot.id), linkLabel: "스냅샷 보기" });
      list.reload();
    } catch (e) {
      const body = errorBody(e);
      if (body?.code === "SNAPSHOT_ID_EXISTS") setError({ text: "같은 ID의 스냅샷이 이미 있어 복원할 수 없습니다.", exists: true });
      else setError({ text: writeErrorText(body, isApiError(e) ? e.message : "복원하지 못했습니다") });
    } finally {
      setBusy(false);
    }
  };

  const purge = async (item: K8sTrashItem) => {
    setBusy(true);
    setError(null);
    try {
      await purgeK8sFromTrash(item.trashId, item.snapshotId);
      close();
      setNotice({ text: `휴지통의 ${item.snapshotId}을 영구 삭제했습니다.` });
      list.reload();
    } catch (e) {
      setError({ text: writeErrorText(errorBody(e), isApiError(e) ? e.message : "삭제하지 못했습니다") });
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<K8sTrashItem>[] = [
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
    { id: "cluster", header: "클러스터", width: 136, hideBelow: 1280, render: (it) => <span className="text-mono">{clusterLabel(it.cluster)}</span> },
    { id: "deletedAt", header: "휴지통으로 옮긴 시각", width: 152, render: (it) => (it.deletedAt ? <Timestamp value={it.deletedAt} format="auto" /> : "—") },
    {
      id: "files",
      header: "파일",
      width: 120,
      align: "right",
      numeric: true,
      render: (it) => `${formatCount(it.fileCount)}개 · ${formatSize(it.sizeBytes)}`,
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
    <PageHeader title="휴지통" breadcrumbs={BREADCRUMBS} subtitle="휴지통의 스냅샷은 git·CLI 스캔 대상이 아닙니다. 자동으로 비우지 않습니다." />
  );

  if (summary && unknownSource) {
    return (
      <>
        {header}
        <K8sSourceUnknown summary={summary} />
      </>
    );
  }

  const items = list.data?.items ?? [];
  const state = list.error && !list.data ? "error" : !list.data ? "loading" : "ready";
  const item = dlg?.item;

  return (
    <>
      {header}
      <div className="page-stack">
        {list.data?.dataSource === "mock" ? <MockNotice /> : null}
        <K8sWriteBlockBanner writable={writable} />
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
              <Link href={K8S_LIST_HREF} className="text-link">
                목록으로
              </Link>
            }
          />
        ) : (
          <DataTable
            caption="Kubernetes 휴지통 목록"
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
                <Link href={k8sDetailHref(item.snapshotId)} className="text-link">
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
                { label: "클러스터", value: <span className="text-mono">{clusterLabel(item.cluster)}</span> },
                { label: "옮긴 시각", value: item.deletedAt ? <Timestamp value={item.deletedAt} format="auto" /> : "—" },
              ]}
            />
            <p className="text-caption text-strong">
              폴더 안 파일 {formatCount(item.fileCount)}개 · {formatSize(item.sizeBytes)}
            </p>
            <ul className="list-plain" style={{ maxHeight: 160, overflowY: "auto" }} aria-label="폴더 최상위 항목">
              {item.files.map((n) => (
                <li key={n} className="text-mono truncate" style={{ minHeight: 20 }}>
                  {n}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </TypeToConfirmDialog>
    </>
  );
}
