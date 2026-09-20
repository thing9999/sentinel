"use client";

/**
 * 스냅샷 상세 `/snapshots/[id]` (docs/design/aws-snapshot-manager.md 4절, 명세 3.2).
 * 섹션 순서: A 요약 → D 스캔 + E 템플릿(나란히) → C 리소스 수 + 폴더 내용 → B 메타데이터.
 * - 데이터: GET /api/aws-snapshots/:id. 스트림 `aws-snapshots.changed`의 changedIds/removedIds 에 이 ID 가 있거나
 *   `aws-snapshots.snapshot`(재연결·mock 시나리오 변경)이 오면 다시 조회한다(계약 11절).
 * - 편집 중 외부 변경은 편집 내용을 덮어쓰지 않고 알림만(계약 4절).
 * - 내보내기·적용·커밋 버튼은 없다(AC-07).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  Button,
  CopyButton,
  EmptyState,
  ErrorState,
  formatRelative,
  formatTime,
  Grid,
  GridItem,
  InlineAlert,
  PageHeader,
  Skeleton,
  UnknownState,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";
import { isApiError } from "@/lib/api";

import { errorBody, useApi } from "../common/hooks";
import { badgeProps, reasonTexts } from "../stream/stale";
import { FolderCard, MetadataSection, ResourcesCard, ScanPanel, SummaryCard } from "./DetailSections";
import { NotesDialog, TrashMoveDialog } from "./dialogs";
import { useFlash, useSnapshotsView } from "./hooks";
import { blockReason, DEFAULT_CLI, isSnapshotId, scanCommandFor, snapshotStatusLabel, snapshotTimeLabel } from "./model";
import { MockNotice, SourceUnknown, WriteBlockBanner } from "./shared";
import { TemplateEditor, useTemplateEditor } from "./TemplateEditor";
import type { DetailResponse, ExportProgress, SnapshotDetailData, SnapshotSummary } from "./types";

/** 진행 중 안내 (디자인 4.3): 서버 판단 근거 `exportInProgress`(계약 5절) 그대로 */
function inProgressText(p: ExportProgress, now: number): string {
  const since = p.lastChangeAt ? formatRelative(p.lastChangeAt, now) : "최근";
  const head = `${p.metadataMissing ? "metadata.json이 없고 " : ""}${since}에 폴더가 바뀌었습니다.`;
  const until = p.untilAt ? ` ${formatTime(p.untilAt, "autoShort", now)}까지(${p.thresholdMinutes}분 기준)` : "";
  return `${head} 편집과 삭제는 내보내기가 끝나거나${until} 기다리면 할 수 있습니다.`;
}

const BREADCRUMB_ROOT = { label: "AWS 스냅샷", href: "/snapshots" };

export function SnapshotDetailPage({ id }: { id: string }) {
  const valid = isSnapshotId(id);
  const view = useSnapshotsView();
  const refreshKey = `${view.resetSeq}:${view.changedSeq(id)}:${view.removedSeq(id)}`;
  const q = useApi<DetailResponse>(valid ? `/aws-snapshots/${encodeURIComponent(id)}` : null, undefined, refreshKey);
  // 편집 중 스냅샷이 지워져도(404) 편집 내용을 잃지 않게 마지막으로 받은 상세를 유지한다
  const [last, setLast] = useState<DetailResponse | null>(null);
  if (q.data && q.data !== last) setLast(q.data);
  const data = q.data ?? last;
  const status = isApiError(q.error) ? q.error.status : undefined;
  const body = errorBody(q.error);

  const header = (title: string) => <PageHeader title={title} breadcrumbs={[BREADCRUMB_ROOT, { label: id }]} />;

  if (!valid || body?.code === "VALIDATION_FAILED") {
    return (
      <>
        {header("스냅샷")}
        <EmptyState
          size="lg"
          icon="archive"
          title="올바른 스냅샷 ID가 아닙니다"
          description="스냅샷 ID는 YYYYMMDD-HHmmss 형식입니다."
          action={<LinkButton href="/snapshots" label="목록으로" />}
        />
      </>
    );
  }

  const unknownSource = view.summary && (view.summary.root.state === "not_configured" || view.summary.root.state === "unavailable");
  if (!data) {
    if (unknownSource && view.summary) {
      return (
        <>
          {header("스냅샷")}
          <SourceUnknown summary={view.summary} />
        </>
      );
    }
    if (q.error) {
      if (status === 404 || body?.code === "SNAPSHOT_PATH_REJECTED") return <NotFound id={id} />;
      if (body?.code === "SOURCE_UNAVAILABLE") {
        return (
          <>
            {header("스냅샷")}
            <UnknownState size="lg" reason={body.message || "스냅샷 폴더를 쓸 수 없습니다"} onRetry={q.reload} retryLabel="다시 시도" />
          </>
        );
      }
      return (
        <>
          {header("스냅샷")}
          <ErrorState size="lg" title="스냅샷을 불러오지 못했습니다" description={q.error.message} onRetry={q.reload} retryLabel="다시 시도" />
        </>
      );
    }
    return <DetailLoading id={id} />;
  }

  // 지워진 뒤 다시 복원되면(changedIds) 없음 표시를 풀어 준다
  const gone = status === 404 || view.removedSeq(id) > view.changedSeq(id);
  return (
    <DetailBody
      id={id}
      data={data}
      summary={view.summary}
      staleMark={view.mark}
      gone={gone}
      notFound={status === 404}
      reload={q.reload}
    />
  );
}

function LinkButton({ href, label, variant = "secondary" }: { href: string; label: string; variant?: "secondary" | "ghost" }) {
  const router = useRouter();
  return (
    <Button variant={variant} onClick={() => router.push(href)}>
      {label}
    </Button>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <>
      <PageHeader title="스냅샷" breadcrumbs={[BREADCRUMB_ROOT, { label: id }]} />
      <EmptyState
        size="lg"
        icon="archive"
        title="스냅샷을 찾을 수 없습니다"
        description="휴지통으로 옮겨졌거나 폴더가 바뀌었을 수 있습니다."
        action={
          <span className="row gap-2">
            <LinkButton href="/snapshots" label="목록으로" />
            <LinkButton href="/snapshots/trash" label="휴지통 보기" variant="ghost" />
          </span>
        }
      />
    </>
  );
}

function DetailLoading({ id }: { id: string }) {
  return (
    <>
      <PageHeader title="스냅샷" breadcrumbs={[BREADCRUMB_ROOT, { label: id }]} />
      <div className="page-stack" aria-busy="true">
        <Skeleton width={240} height={24} />
        <Skeleton height={160} radius="md" />
        <Grid>
          <GridItem span={4} spanMd={12}>
            <Skeleton lines={6} />
          </GridItem>
          <GridItem span={8} spanMd={12}>
            <Skeleton height={480} radius="md" />
          </GridItem>
        </Grid>
        <Skeleton height={200} radius="md" />
      </div>
    </>
  );
}

function DetailBody({
  id,
  data,
  summary,
  staleMark,
  gone,
  notFound,
  reload,
}: {
  id: string;
  data: DetailResponse;
  summary: SnapshotSummary | null;
  staleMark: { stale: boolean; at: string | undefined };
  gone: boolean;
  notFound: boolean;
  reload: () => void;
}) {
  const router = useRouter();
  const d: SnapshotDetailData = data.snapshot;
  const workRef = useRef<HTMLDivElement | null>(null);
  const [dialog, setDialog] = useState<"notes" | "trash" | null>(null);
  const [notesFlash, fireNotesFlash] = useFlash(1500);
  const now = useNow(30_000);
  const ctl = useTemplateEditor({ id, detail: d, limits: summary?.limits, onSaved: reload, gone, workRef });

  // 편집하지 않는 중에 지워졌으면 없음 화면
  if (notFound && !ctl.session) return <NotFound id={id} />;

  const b = badgeProps(d.status, staleMark);
  const reasons = reasonTexts(d.status);
  const metaBroken = d.metadata.state === "missing" || d.metadata.state === "corrupt";
  const progress = d.exportInProgress;
  const notesReason = blockReason(d.actions.editNotes);
  const deleteReason = blockReason(d.actions.delete);
  // 계약 6.3 `cli.scan`(ID 채워짐). 옛 응답이면 고정 문구에 ID 를 채운다
  const scanCommand = data.cli?.scan ?? scanCommandFor(DEFAULT_CLI, id);

  return (
    <>
      <PageHeader
        title={`${snapshotTimeLabel(d.snapshotAt, id)} 스냅샷`}
        breadcrumbs={[BREADCRUMB_ROOT, { label: id }]}
        status={{ ...b, reason: reasons, label: snapshotStatusLabel(b.status) }}
        subtitle={
          <span className="row gap-1-5" style={{ flexWrap: "wrap" }}>
            <span>ID</span>
            <span className="text-mono">{id}</span>
            <CopyButton text={id} size="sm" label="ID 복사" />
            <span aria-hidden>·</span>
            {metaBroken ? (
              <span>메타데이터 없음</span>
            ) : (
              <>
                <span className="text-mono">{d.region ?? "—"}</span>
                <span aria-hidden>·</span>
                <span>former2 {d.former2Version ?? "—"}</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" icon="tag" onClick={() => setDialog("notes")} disabled={Boolean(notesReason)} disabledReason={notesReason}>
              라벨·메모 편집
            </Button>
            <Button variant="danger" icon="trash-2" onClick={() => setDialog("trash")} disabled={Boolean(deleteReason)} disabledReason={deleteReason}>
              삭제
            </Button>
          </>
        }
      />
      <div className="page-stack">
        {data.dataSource === "mock" ? <MockNotice /> : null}
        <WriteBlockBanner writable={summary?.writable} />
        {progress?.active ? (
          <InlineAlert
            tone="neutral"
            icon="hourglass"
            title="내보내기가 진행 중일 수 있습니다"
            description={inProgressText(progress, now)}
          />
        ) : null}

        <SummaryCard detail={d} onEditNotes={() => setDialog("notes")} notesDisabledReason={notesReason} highlight={notesFlash} />

        <section aria-labelledby="snapshot-work-title" className="stack">
          <h2 id="snapshot-work-title" className="text-h3" style={{ fontSize: 18 }}>
            비밀값 스캔과 템플릿
          </h2>
          <div ref={workRef} style={{ scrollMarginTop: 72 }}>
            <Grid>
              <GridItem span={4} spanMd={12}>
                <ScanPanel
                  detail={d}
                  ctl={ctl}
                  scanCommand={scanCommand}
                  stale={staleMark.stale}
                  onEditNotes={notesReason ? undefined : () => setDialog("notes")}
                />
              </GridItem>
              <GridItem span={8} spanMd={12}>
                <TemplateEditor ctl={ctl} />
              </GridItem>
            </Grid>
          </div>
        </section>

        <Grid>
          <GridItem span={6} spanMd={12}>
            <ResourcesCard detail={d} />
          </GridItem>
          <GridItem span={6} spanMd={12}>
            <FolderCard detail={d} />
          </GridItem>
        </Grid>

        <MetadataSection id={id} detail={d} />
      </div>

      <NotesDialog
        open={dialog === "notes"}
        snapshotId={id}
        detail={d}
        limits={summary?.limits}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          fireNotesFlash();
          reload();
        }}
      />
      <TrashMoveDialog
        open={dialog === "trash"}
        snapshotId={id}
        detail={d}
        onClose={() => setDialog(null)}
        onMoved={() => {
          setDialog(null);
          router.push(`/snapshots?trashed=${encodeURIComponent(id)}`);
        }}
      />
    </>
  );
}
