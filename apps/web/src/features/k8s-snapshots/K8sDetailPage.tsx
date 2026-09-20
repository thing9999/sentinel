"use client";

/**
 * Kubernetes 스냅샷 상세 `/snapshots/k8s/[id]` (docs/design/k8s-snapshot.md 4절, 명세 5.3).
 * - 데이터: GET /api/k8s-snapshots/:id. `k8s-snapshots.changed`(이 ID)·`.snapshot`이 오면 다시 조회. 드리프트 배지는 `.drift`로 교체.
 * - 상세 탭 5개(`?view=files|drift|counts|secrets|meta`). 탭을 옮겨도 파일 탭의 편집 세션은 이 페이지에 남는다.
 * - 드리프트 요청 계산의 임대 갱신은 드리프트 탭이 열려 있을 때만(떠나면 멈춤).
 * - 같은 ID 가 AWS 쪽에 있어도 이 경로는 k8s 만 연다(AC-K18). 내보내기·적용·커밋 버튼 없음.
 */
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import {
  Button,
  Card,
  Chip,
  CopyButton,
  EmptyState,
  ErrorState,
  formatRelative,
  formatTime,
  Grid,
  GridItem,
  Icon,
  InlineAlert,
  LabeledStatus,
  PageHeader,
  Skeleton,
  StatusIcon,
  Tabs,
  tabIds,
  UnknownState,
  type IconName,
  type Status,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";
import { isApiError } from "@/lib/api";

import { blockReason, snapshotStatusLabel, snapshotTimeLabel } from "../aws-snapshots/model";
import { errorBody, useApi } from "../common/hooks";
import { badgeProps, reasonTexts } from "../stream/stale";
import { detailPath } from "./api";
import { K8sNotesDialog, K8sTrashMoveDialog } from "./dialogs";
import { DriftTab } from "./DriftTab";
import { useK8sFileEditor } from "./FileEditor";
import { GraphTabLazy } from "./graph/GraphTabLazy";
import { FilesTab } from "./FilesTab";
import { useDetailQuery, useDriftData, useK8sSnapshotsView, type K8sSnapshotsView } from "./hooks";
import { CountsTab, MetaTab, SecretsTab } from "./InfoTabs";
import { clusterLabel, computeBlockReason, DEFAULT_K8S_CLI, detailTabs, isSnapshotId, K8S_LIST_HREF, K8S_TRASH_HREF, type DetailView } from "./model";
import { driftBadgeParts, K8sSourceUnknown, K8sWriteBlockBanner, MockNotice } from "./shared";
import type { DriftBadge, ExportProgress, K8sDetailResponse, K8sSnapshotDetailData } from "./types";

const BREADCRUMB_ROOT = { label: "Kubernetes 스냅샷", href: K8S_LIST_HREF };

function inProgressText(p: ExportProgress, now: number): string {
  const since = p.lastChangeAt ? formatRelative(p.lastChangeAt, now) : "최근";
  const head = `${p.metadataMissing ? "metadata.json이 없고 " : ""}${since}에 폴더가 바뀌었습니다.`;
  const until = p.untilAt ? ` ${formatTime(p.untilAt, "autoShort", now)}까지(${p.thresholdMinutes}분 기준)` : "";
  return `${head} 편집과 삭제는 내보내기가 끝나거나${until} 기다리면 할 수 있습니다.`;
}

export function K8sDetailPage({ id }: { id: string }) {
  const valid = isSnapshotId(id);
  const view = useK8sSnapshotsView();
  const refreshKey = `${view.resetSeq}:${view.changedSeq(id)}:${view.removedSeq(id)}`;
  const q = useApi<K8sDetailResponse>(valid ? detailPath(id) : null, undefined, refreshKey);
  const [last, setLast] = useState<K8sDetailResponse | null>(null);
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
          action={<LinkButton href={K8S_LIST_HREF} label="목록으로" />}
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
          <K8sSourceUnknown summary={view.summary} />
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

  const gone = status === 404 || view.removedSeq(id) > view.changedSeq(id);
  return <DetailBody id={id} data={data} view={view} gone={gone} notFound={status === 404} reload={q.reload} />;
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
            <LinkButton href={K8S_LIST_HREF} label="목록으로" />
            <LinkButton href={K8S_TRASH_HREF} label="휴지통 보기" variant="ghost" />
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
        <Skeleton height={40} />
        <Grid>
          <GridItem span={4} spanMd={12}>
            <Skeleton lines={10} />
          </GridItem>
          <GridItem span={8} spanMd={12}>
            <Skeleton height={480} radius="md" />
          </GridItem>
        </Grid>
      </div>
    </>
  );
}

function DetailBody({
  id,
  data,
  view,
  gone,
  notFound,
  reload,
}: {
  id: string;
  data: K8sDetailResponse;
  view: K8sSnapshotsView;
  gone: boolean;
  notFound: boolean;
  reload: () => void;
}) {
  const router = useRouter();
  const d: K8sSnapshotDetailData = data.snapshot;
  const summary = view.summary;
  const workRef = useRef<HTMLDivElement | null>(null);
  const [dialog, setDialog] = useState<"notes" | "trash" | null>(null);
  const [viewLast, setViewLast] = useState(false);
  const now = useNow(30_000);
  const [query, patch] = useDetailQuery();
  const ctl = useK8sFileEditor({ id, detail: d, summary, query, patch, onSaved: reload, gone, workRef });
  const onUnavailable = useCallback(() => reload(), [reload]);
  const drift = useDriftData(id, query.view === "drift", view, onUnavailable);

  if (notFound && !ctl.session) return <NotFound id={id} />;

  // 드리프트 배지: (드리프트 탭이면) 탭 결과 > 스트림 `.drift` > 상세 응답
  const badge: DriftBadge = (query.view === "drift" ? drift.data?.drift : undefined) ?? view.driftFor(id) ?? d.drift;
  const b = badgeProps(d.status, view.mark);
  const reasons = reasonTexts(d.status);
  const metaBroken = d.metadata.state === "missing" || d.metadata.state === "corrupt";
  const progress = d.exportInProgress;
  const notesReason = blockReason(d.actions.editNotes);
  const deleteReason = blockReason(d.actions.delete);
  const scanCommand = data.cli?.scan ?? DEFAULT_K8S_CLI.scan.replace("<id>", id);
  const computeReason = computeBlockReason(d.actions.computeDrift);
  const tabs = detailTabs(d, badge, ctl.dirty);
  const ids = tabIds("k8s-detail", query.view);

  const setView = (v: DetailView) => {
    if (v !== "drift") setViewLast(false);
    patch({ view: v });
  };
  const startCompute = () => {
    setView("drift");
    drift.compute(true);
  };

  const parts = driftBadgeParts(badge, { pending: drift.pending, kubeStale: view.kubeStale, size: "md" });
  const notComputed = parts.view.state === "notComputed";
  const unknown = parts.view.state === "unknown";
  const driftMeta = badge.computedAt && !notComputed ? `· ${formatTime(badge.computedAt, "shortTime")} 계산` : undefined;
  const driftAction =
    query.view === "drift" ? undefined : notComputed ? (
      computeReason ? undefined : (
        <Button variant="ghost" size="sm" icon="git-compare" onClick={startCompute}>
          드리프트 계산
        </Button>
      )
    ) : unknown ? undefined : (
      <Button variant="ghost" size="sm" onClick={() => setView("drift")}>
        <span className="row gap-1">
          드리프트 보기
          <Icon name="chevron-right" size={12} />
        </span>
      </Button>
    );

  const chips = (
    <div className="stack-sm">
      <LabeledStatus label="드리프트" reason={parts.secondary || undefined} meta={driftMeta} action={driftAction}>
        {parts.primary}
      </LabeledStatus>
      <span className="row gap-1-5 text-caption" style={{ flexWrap: "wrap" }}>
        <span>ID</span>
        <span className="text-mono">{id}</span>
        <CopyButton text={id} size="sm" label="ID 복사" />
        <span aria-hidden>·</span>
        {metaBroken ? (
          <span>메타데이터 없음</span>
        ) : (
          <>
            <span className="text-mono">{clusterLabel(d.cluster)}</span>
            {d.cluster?.relation === "other" ? (
              <span className="row gap-1">
                <Icon name="link-2-off" size={12} />
                다른 클러스터
              </span>
            ) : null}
            {d.cluster?.context ? (
              <>
                <span aria-hidden>·</span>
                <span>컨텍스트</span>
                <span className="text-mono">{d.cluster.context}</span>
              </>
            ) : null}
            {d.cliVersion ? (
              <>
                <span aria-hidden>·</span>
                <span>k8s-snapshot {d.cliVersion}</span>
              </>
            ) : null}
          </>
        )}
      </span>
    </div>
  );

  return (
    <>
      <PageHeader
        title={`${snapshotTimeLabel(d.snapshotAt, id)} 스냅샷`}
        breadcrumbs={[BREADCRUMB_ROOT, { label: id }]}
        status={{ ...b, reason: reasons, label: snapshotStatusLabel(b.status), srPrefix: "파일 상태: " }}
        chips={chips}
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
        <K8sWriteBlockBanner writable={summary?.writable} />
        {progress?.active ? (
          <InlineAlert tone="neutral" icon="hourglass" title="내보내기가 진행 중일 수 있습니다" description={inProgressText(progress, now)} />
        ) : null}

        <SummaryCard detail={d} onEditNotes={() => setDialog("notes")} notesDisabledReason={notesReason} onSecrets={() => setView("secrets")} />

        <div ref={workRef} style={{ scrollMarginTop: 72 }} className="stack">
          <Tabs idBase="k8s-detail" label="스냅샷 상세" items={tabs} value={query.view} onChange={(v) => setView(v as DetailView)} />
          <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab}>
            {query.view === "files" ? (
              <FilesTab ctl={ctl} detail={d} scanCommand={scanCommand} stale={view.mark.stale} onEditNotes={notesReason ? undefined : () => setDialog("notes")} />
            ) : query.view === "drift" ? (
              <DriftTab
                drift={drift}
                ability={d.actions.computeDrift}
                kubeStale={view.kubeStale}
                query={query}
                patch={patch}
                onOpenFile={(p) => ctl.requestOpen(p)}
                viewLast={viewLast}
                setViewLast={setViewLast}
              />
            ) : query.view === "3d" ? (
              <GraphTabLazy id={id} query={query} patch={patch} stream={view} dataSource={data.dataSource} active />
            ) : query.view === "counts" ? (
              <CountsTab detail={d} />
            ) : query.view === "secrets" ? (
              <SecretsTab detail={d} onOpenFile={(p) => ctl.requestOpen(p)} />
            ) : (
              <MetaTab id={id} detail={d} />
            )}
          </div>
        </div>
      </div>

      <K8sNotesDialog
        open={dialog === "notes"}
        snapshotId={id}
        detail={d}
        limits={summary?.limits}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          reload();
        }}
      />
      <K8sTrashMoveDialog
        open={dialog === "trash"}
        snapshotId={id}
        detail={d}
        onClose={() => setDialog(null)}
        onMoved={() => {
          setDialog(null);
          router.push(`${K8S_LIST_HREF}?trashed=${encodeURIComponent(id)}`);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------- A. 요약 카드 (4.4)

const NOTICE_CHIP: Record<string, { label: (text: string) => string; icon?: IconName; tone?: "info" }> = {
  HELM_MANAGED: { label: () => "Helm 관리", icon: "ship-wheel" },
  SYSTEM_NAMESPACES_INCLUDED: { label: () => "시스템 네임스페이스 포함", icon: "settings" },
  STRICT_EXPORT: { label: () => "strict", icon: "lock" },
  MISSING_NAMESPACES: { label: () => "없던 네임스페이스", icon: "circle-help" },
  RESOURCES_CHANGED_SINCE_EXPORT: { label: () => "내보내기 후 변경됨", tone: "info" },
  SECRET_REFS_MISSING: { label: () => "Secret 목록 없음", icon: "key-round" },
  SECRET_REFS_CORRUPT: { label: () => "Secret 목록 없음", icon: "key-round" },
};

const FALLBACK_DATA_TEXT = "이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 데이터는 pg_dump 논리 백업 또는 EBS 볼륨 스냅샷으로 따로 보관하세요.";

function SummaryCard({
  detail,
  onEditNotes,
  notesDisabledReason,
  onSecrets,
}: {
  detail: K8sSnapshotDetailData;
  onEditNotes: () => void;
  notesDisabledReason?: string;
  onSecrets: () => void;
}) {
  const [memoOpen, setMemoOpen] = useState(false);
  const b = badgeProps(detail.status);
  const reasons = detail.status.reasons;
  const cardStatus = b.status === "crit" ? "crit" : b.status === "warn" ? "warn" : undefined;
  const memo = detail.notes.memo ?? detail.memo;
  const label = detail.notes.label ?? detail.label;
  const longMemo = Boolean(memo && (memo.split("\n").length > 6 || memo.length > 400));
  const dataText = detail.notices.find((n) => n.code === "DATA_NOT_INCLUDED")?.text;
  const chipNotices = detail.notices.filter((n) => n.code !== "DATA_NOT_INCLUDED" && n.code !== "CLEANUP_RULES_NEWER" && n.code !== "ADDED_NOT_CHECKED");

  const notes = (
    <section aria-label="라벨·메모" className="stack-sm">
      <div className="row-between">
        <h3 className="text-caption text-strong">라벨·메모</h3>
        {label || memo ? (
          <Button
            variant="ghost"
            size="sm"
            icon="pencil"
            aria-label="라벨·메모 편집"
            onClick={onEditNotes}
            disabled={Boolean(notesDisabledReason)}
            disabledReason={notesDisabledReason}
          >
            편집
          </Button>
        ) : null}
      </div>
      {label || memo ? (
        <>
          {label ? <p className="text-strong" style={{ overflowWrap: "anywhere" }}>{label}</p> : null}
          {memo ? (
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: memoOpen ? undefined : 120, overflow: memoOpen ? undefined : "hidden" }}>{memo}</p>
          ) : null}
          {longMemo ? (
            <span>
              <Button variant="ghost" size="sm" onClick={() => setMemoOpen((v) => !v)} aria-expanded={memoOpen}>
                {memoOpen ? "접기" : "더 보기"}
              </Button>
            </span>
          ) : null}
          {detail.notes.updatedAt ? (
            <p className="text-caption-tertiary" suppressHydrationWarning>
              {snapshotTimeLabel(detail.notes.updatedAt, "—")} 수정
            </p>
          ) : null}
        </>
      ) : (
        <div className="row gap-2">
          <span className="text-caption-tertiary">라벨·메모 없음</span>
          <Button variant="ghost" size="sm" icon="tag" onClick={onEditNotes} disabled={Boolean(notesDisabledReason)} disabledReason={notesDisabledReason}>
            라벨·메모 추가
          </Button>
        </div>
      )}
    </section>
  );

  return (
    <Card padding="lg" status={cardStatus} as="section" aria-label="요약">
      <div className="stack-lg">
        {reasons.length > 0 ? (
          <Grid>
            <GridItem span={7} spanMd={12}>
              <section aria-label="판단 사유" className="stack-sm">
                <h3 className="text-caption text-strong">판단 사유</h3>
                <ul className="list-plain stack-sm">
                  {reasons.map((r, i) => {
                    const st: Status = r.status === "critical" ? "crit" : r.status === "warning" ? "warn" : r.status === "ok" ? "ok" : "unknown";
                    return (
                      <li key={`${r.code}-${i}`} className="row row-start gap-2" style={{ minHeight: 28 }}>
                        <StatusIcon status={st} size={14} />
                        <span className={st === "crit" ? "text-strong" : undefined} style={st === "crit" ? { color: "var(--color-status-crit-fg)" } : undefined}>
                          {r.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </GridItem>
            <GridItem span={5} spanMd={12}>
              {notes}
            </GridItem>
          </Grid>
        ) : (
          notes
        )}
        {chipNotices.length > 0 ? (
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", minHeight: 28 }} aria-label="보조 정보">
            {chipNotices.map((n) => {
              const spec = NOTICE_CHIP[n.code];
              if (n.code === "SECRET_REFS_MISSING" || n.code === "SECRET_REFS_CORRUPT") {
                return (
                  <Button key={n.code} variant="ghost" size="sm" icon="key-round" onClick={onSecrets} title={n.text}>
                    Secret 목록 없음
                  </Button>
                );
              }
              if (n.code === "HELM_MANAGED" && detail.helmManaged !== null) {
                return <Chip key={n.code} size="sm" icon="ship-wheel" label={`Helm 관리 ${detail.helmManaged}개`} tooltip={n.text} />;
              }
              return spec ? (
                <Chip key={n.code} size="sm" icon={spec.icon} tone={spec.tone ?? "neutral"} label={spec.label(n.text)} tooltip={n.text} />
              ) : (
                <Chip key={n.code} size="sm" label={n.text.length > 40 ? `${n.text.slice(0, 40)}…` : n.text} tooltip={n.text} />
              );
            })}
          </div>
        ) : null}
        <div style={{ borderTop: "1px solid var(--color-border-subtle)", paddingTop: 16 }}>
          <InlineAlert
            tone="info"
            icon="hand"
            title="대시보드는 커밋·적용하지 않습니다"
            description={
              <span className="stack-sm">
                <span>커밋 전 터미널에서 git diff로 직접 확인하세요.</span>
                <span>적용(복원)은 kubectl diff로 확인한 뒤 kubectl apply로 직접 하세요 (deploy/k8s-snapshot/README.md).</span>
                <span>{dataText ? `${dataText} 복원 순서: 매니페스트 적용 → 빈 StatefulSet 기동 → 데이터 복원.` : FALLBACK_DATA_TEXT}</span>
              </span>
            }
          />
        </div>
      </div>
    </Card>
  );
}
