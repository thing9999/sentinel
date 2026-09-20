"use client";

/**
 * 라벨·메모 편집 / 휴지통으로 이동 확인 창 (디자인 6.1·6.6). 목록·상세 공용.
 * 필요한 버전(notes.version)·파일 목록은 상세 응답에서 받는다(목록 행에는 없다).
 */
import { useState, type ReactNode } from "react";

import {
  Button,
  Chip,
  CopyButton,
  Dialog,
  formatCount,
  Icon,
  InlineAlert,
  KeyValueList,
  Skeleton,
  StatusBadge,
  TextArea,
  TextField,
  TypeToConfirmDialog,
} from "@/components/ui";
import { apiFetch, isApiError } from "@/lib/api";

import { errorBody, useApi } from "../common/hooks";
import { badgeProps } from "../stream/stale";
import { moveToTrash, saveNotes } from "./api";
import { folderRows, formatSize, notesSecretText, snapshotStatusLabel, validationFields, writeErrorText, type FolderRow } from "./model";
import { SnapshotTime } from "./shared";
import type { DeleteResponse, DetailResponse, NotesResponse, SnapshotDetailData, SnapshotSummary } from "./types";

const DEFAULT_LIMITS = { labelMaxLength: 60, memoMaxLength: 2000 };

/** 상세가 없으면(목록에서 연 경우) 열려 있는 동안만 불러온다 */
function useDetailFor(open: boolean, id: string, given: SnapshotDetailData | undefined) {
  const q = useApi<DetailResponse>(open && !given ? `/aws-snapshots/${encodeURIComponent(id)}` : null);
  return { detail: given ?? q.data?.snapshot, error: given ? null : q.error };
}

// ---------------------------------------------------------------- 라벨·메모 (6.1)

export interface NotesDialogProps {
  open: boolean;
  snapshotId: string;
  detail?: SnapshotDetailData;
  limits?: SnapshotSummary["limits"];
  onClose: () => void;
  onSaved: (res: NotesResponse) => void;
}

export function NotesDialog(props: NotesDialogProps) {
  const { open, snapshotId, detail: given, onClose } = props;
  const { detail, error } = useDetailFor(open, snapshotId, given);
  if (!open) return null;
  if (!detail) {
    return (
      <Dialog open onClose={onClose} title="라벨·메모 편집" size="md" cancelLabel="취소">
        {error ? (
          <InlineAlert tone="crit" title="스냅샷 정보를 불러오지 못했습니다" description={writeErrorText(errorBody(error), error.message)} />
        ) : (
          <Skeleton lines={4} />
        )}
      </Dialog>
    );
  }
  return <NotesForm key={`${snapshotId}:${detail.notes.version}`} {...props} detail={detail} />;
}

function NotesForm({ snapshotId, detail, limits, onClose, onSaved }: NotesDialogProps & { detail: SnapshotDetailData }) {
  const labelMax = limits?.labelMaxLength ?? DEFAULT_LIMITS.labelMaxLength;
  const memoMax = limits?.memoMaxLength ?? DEFAULT_LIMITS.memoMaxLength;
  const [base, setBase] = useState({ label: detail.notes.label ?? "", memo: detail.notes.memo ?? "", version: detail.notes.version });
  const [label, setLabel] = useState(base.label);
  const [memo, setMemo] = useState(base.memo);
  const [labelError, setLabelError] = useState<string | undefined>();
  const [memoError, setMemoError] = useState<string | undefined>();
  const [secret, setSecret] = useState<{ text: string; fields: string[] } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);

  const changed = label !== base.label || memo !== base.memo;

  const clearErrors = () => {
    setSecret(null);
    setFailure(null);
  };

  const submit = async () => {
    if (!changed || saving) return;
    setSaving(true);
    clearErrors();
    try {
      const res = await saveNotes(snapshotId, label, memo, base.version);
      onSaved(res);
    } catch (e) {
      const body = errorBody(e);
      if (body?.code === "SNAPSHOT_NOTES_SECRET_DETECTED") {
        setSecret(notesSecretText(body));
      } else if (body?.code === "SNAPSHOT_VERSION_CONFLICT") {
        setConflict(true);
      } else if (body?.code === "VALIDATION_FAILED") {
        const fields = validationFields(body);
        if (fields.includes("label")) setLabelError(`라벨을 저장할 수 없습니다: ${body.message}`);
        if (fields.includes("memo")) setMemoError(`메모를 저장할 수 없습니다: ${body.message}`);
        if (!fields.includes("label") && !fields.includes("memo")) setFailure(body.message);
      } else {
        const net = isApiError(e) && (e.kind === "network" || e.kind === "timeout");
        setFailure(net ? "저장 요청을 보내지 못했습니다. 저장됐는지 확실하지 않으니 최신 내용을 확인하세요." : writeErrorText(body, "저장하지 못했습니다"));
      }
    } finally {
      setSaving(false);
    }
  };

  const reloadLatest = async () => {
    setReloading(true);
    try {
      const res = await apiFetch<DetailResponse>(`/aws-snapshots/${encodeURIComponent(snapshotId)}`);
      const n = res.snapshot.notes;
      const next = { label: n.label ?? "", memo: n.memo ?? "", version: n.version };
      setBase(next);
      setLabel(next.label);
      setMemo(next.memo);
      setConflict(false);
      setLabelError(undefined);
      setMemoError(undefined);
      clearErrors();
    } catch (e) {
      setFailure(writeErrorText(errorBody(e), "최신 내용을 불러오지 못했습니다"));
    } finally {
      setReloading(false);
    }
  };

  const secretLabel = secret?.fields.includes("label") ?? false;
  const secretMemo = secret?.fields.includes("memo") ?? false;

  return (
    <Dialog
      open
      onClose={onClose}
      title="라벨·메모 편집"
      size="md"
      description="스냅샷 폴더 안 라벨·메모 파일에 저장합니다. git에 스냅샷과 함께 커밋될 수 있으니 비밀값을 적지 마세요."
      confirmLabel="저장"
      confirmLoading={saving}
      confirmLoadingLabel="저장 중"
      confirmDisabled={!changed}
      confirmDisabledReason="변경 없음"
      cancelLabel="취소"
      initialFocus="content"
      onConfirm={() => void submit()}
    >
      <div className="stack">
        {secret ? (
          <InlineAlert tone="crit" live title="비밀값으로 보이는 내용이 있어 저장하지 않았습니다" description={secret.text} />
        ) : null}
        {conflict ? (
          <InlineAlert
            tone="warn"
            live
            title="다른 곳에서 라벨·메모가 바뀌었습니다"
            description="강제로 덮어쓸 수 없습니다. 내 입력을 복사한 뒤 최신 내용을 불러오세요."
            action={
              <span className="row">
                <CopyButton text={`${label}\n\n${memo}`} label="내 입력 복사" size="sm" showLabel />
                <Button variant="ghost" size="sm" loading={reloading} onClick={() => void reloadLatest()}>
                  최신 내용 불러오기
                </Button>
              </span>
            }
          />
        ) : null}
        {failure ? <InlineAlert tone="crit" live title={failure} /> : null}
        <TextField
          label="라벨"
          value={label}
          onChange={(v) => {
            setLabel(v);
            setLabelError(undefined);
            if (secretLabel) setSecret(null);
          }}
          maxLength={labelMax}
          showCount
          onOverflow={() => setLabelError(`라벨은 ${labelMax}자까지 입력할 수 있습니다`)}
          error={labelError}
          invalid={secretLabel}
          placeholder="예: EKS 1.30 업그레이드 전"
          autoComplete="off"
          data-autofocus
        />
        <TextArea
          label="메모"
          value={memo}
          onChange={(v) => {
            setMemo(v);
            setMemoError(undefined);
            if (secretMemo) setSecret(null);
          }}
          maxLength={memoMax}
          showCount
          onOverflow={() => setMemoError(`메모는 ${formatCount(memoMax)}자까지 입력할 수 있습니다`)}
          error={memoError}
          invalid={secretMemo}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- 휴지통으로 이동 (6.6)

const MARK_CHIP: Record<NonNullable<FolderRow["mark"]>, ReactNode> = {
  missing: <Chip tone="crit" size="sm" icon="file-x" label="없음" />,
  unexpected: <Chip tone="warn" size="sm" icon="file-question" label="예상 밖" />,
  raw: <Chip tone="crit" size="sm" icon="file-warning" label="raw 데이터" tooltip="비밀값 포함 가능. git 제외 경로로 옮기세요" />,
  notes: <Chip tone="neutral" size="sm" icon="tag" label="라벨·메모" />,
  directory: null,
};

export function markChip(mark: FolderRow["mark"]): ReactNode {
  return mark ? MARK_CHIP[mark] : null;
}

/** 폴더 안 파일 목록 (없는 파일 제외) — 휴지통 이동·영구 삭제 창 */
export function FileListBlock({ rows }: { rows: { key: string; name: string; sizeBytes: number | null; mark?: FolderRow["mark"] }[] }) {
  return (
    <div className="stack-sm">
      <p className="text-caption text-strong">폴더 안 파일 {formatCount(rows.length)}개</p>
      <ul className="list-plain" style={{ maxHeight: 160, overflowY: "auto" }}>
        {rows.map((r) => (
          <li key={r.key} className="row gap-2" style={{ minHeight: 20 }}>
            <span className="text-mono truncate">{r.name}</span>
            {r.sizeBytes !== null ? <span className="text-caption-tertiary tabular">{formatSize(r.sizeBytes)}</span> : null}
            {markChip(r.mark ?? null)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface TrashMoveDialogProps {
  open: boolean;
  snapshotId: string;
  detail?: SnapshotDetailData;
  onClose: () => void;
  onMoved: (res: DeleteResponse) => void;
}

export function TrashMoveDialog({ open, snapshotId, detail: given, onClose, onMoved }: TrashMoveDialogProps) {
  const { detail, error: loadError } = useDetailFor(open, snapshotId, given);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await moveToTrash(snapshotId);
      onMoved(res);
    } catch (e) {
      const body = errorBody(e);
      setError(
        body?.code === "SNAPSHOT_EXPORT_IN_PROGRESS"
          ? "내보내기 진행 중일 수 있어 옮길 수 없습니다"
          : body?.code === "RESOURCE_NOT_FOUND"
            ? "스냅샷이 이미 없습니다. 목록을 새로 고치세요."
            : writeErrorText(body, isApiError(e) ? e.message : "휴지통으로 옮기지 못했습니다"),
      );
    } finally {
      setLoading(false);
    }
  };

  const rows = detail ? folderRows(detail).filter((r) => r.mark !== "missing") : [];
  const rawSaved = Boolean(detail?.metadata.fields?.rawData?.saved);
  const b = detail ? badgeProps(detail.status) : null;

  return (
    <TypeToConfirmDialog
      open={open}
      onClose={close}
      title="스냅샷을 휴지통으로 옮길까요?"
      expected={snapshotId}
      inputLabel={
        <>
          확인을 위해 스냅샷 ID <code className="text-mono">{snapshotId}</code>을 입력하세요
        </>
      }
      confirmLabel="휴지통으로 이동"
      confirmLoadingLabel="옮기는 중"
      loading={loading}
      error={error ?? (loadError ? "스냅샷 정보를 불러오지 못했습니다" : undefined)}
      onConfirm={() => void confirm()}
    >
      {detail && b ? (
        <div className="stack">
          <KeyValueList
            columns={1}
            labelWidth={96}
            items={[
              {
                label: "시각",
                value: (
                  <span className="row gap-2">
                    <SnapshotTime iso={detail.snapshotAt} id={detail.id} />
                    <span className="text-mono text-caption-tertiary">{detail.id}</span>
                  </span>
                ),
              },
              { label: "라벨", value: detail.label ?? "—" },
              { label: "상태", value: <StatusBadge size="sm" {...b} label={snapshotStatusLabel(b.status)} /> },
            ]}
          />
          <FileListBlock rows={rows} />
          <InlineAlert tone="info" title="휴지통에서 복원하거나 영구 삭제할 수 있습니다. 대시보드는 휴지통을 자동으로 비우지 않습니다." />
          <ul className="list-plain stack-sm text-caption">
            <li className="row row-start gap-1-5">
              <Icon name="info" size={12} />
              <span>이 폴더가 git에 커밋돼 있었다면 삭제가 git 변경으로 남습니다. 커밋은 대시보드가 하지 않습니다.</span>
            </li>
            {rawSaved ? (
              <li className="row row-start gap-1-5">
                <Icon name="info" size={12} />
                <span>
                  <span className="text-mono">.raw/{detail.id}/</span>의 raw 데이터는 옮기지 않습니다. 직접 지우세요.
                </span>
              </li>
            ) : null}
          </ul>
        </div>
      ) : loadError ? null : (
        <Skeleton lines={4} />
      )}
    </TypeToConfirmDialog>
  );
}
