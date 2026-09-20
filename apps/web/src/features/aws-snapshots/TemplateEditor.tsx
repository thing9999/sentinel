"use client";

/**
 * 상세 E. 템플릿 편집기 (docs/design/aws-snapshot-manager.md 5·6절, 명세 3.7).
 *
 * 편집 엔진: publisher 기본 `PlainCodeEngine`(라이브러리 없음)을 쓴다. 기본 엔진은 편집 중 줄 바꿈을 지원하지 않으므로
 * 편집 모드에서는 줄 바꿈 토글을 비활성으로 둔다(publisher 보고서 5절).
 *
 * 저장 흐름 (디자인 5.6, 계약 7.2·7.3)
 *   [저장] → POST …/check(`검사 중`) → 확인 사유(오류 남음·YAML 구문·리소스 감소)가 있으면 확인 창(6.2)
 *          → PUT …/files/:kind { content(LF), baseVersion, confirm }(`저장 중`)
 *   PUT 이 422 면 details.missing 을 confirm 에 넣어 다시 묻는다. 409 는 충돌 창(강제 덮어쓰기 없음).
 * 상태·리소스 수·스캔은 서버 값만 쓴다(저장 전 검사도 서버).
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type RefObject } from "react";

import {
  Button,
  Card,
  Chip,
  CODE_EDITOR_DEFAULT_HEIGHT,
  CodeEditor,
  CopyButton,
  Dialog,
  EmptyState,
  formatCount,
  IconButton,
  InlineAlert,
  MINUS,
  ScanFindingList,
  Tabs,
  tabIds,
  type AlertTone,
  type IconName,
  type ScanFinding,
} from "@/components/ui";
import { isApiError } from "@/lib/api";

import { errorBody, useApi } from "../common/hooks";
import { checkTemplate, saveTemplate } from "./api";
import { useLeaveGuard, useBoolStore, wrapStore } from "./hooks";
import {
  fileInfoParts,
  fileTabs,
  formatSize,
  indentUnitOf,
  isEditableKind,
  markersFor,
  notFoundKind,
  rescanText,
  saveResultView,
  toScanFindings,
  writeErrorText,
} from "./model";
import type {
  ConfirmKind,
  EditableKind,
  FileKind,
  FileResponse,
  ScanFindingApi,
  SnapshotDetailData,
  SnapshotSummary,
  TemplateCheck,
} from "./types";

type Phase = "editing" | "checking" | "saving";

interface EditSession {
  kind: EditableKind;
  baseVersion: string;
  original: string;
  value: string;
  phase: Phase;
  /** 저장이 409 로 거부됨 → 알림 슬롯에 고정 경고 */
  conflict: boolean;
}

interface Failure {
  tone: AlertTone;
  icon?: IconName;
  title: string;
  description?: string;
  retry: boolean;
}

interface SaveResult {
  kind: EditableKind;
  tone: "ok" | "warn" | "crit" | "info";
  title: string;
  rescan: string;
  warnings: ScanFindingApi[];
}

type PendingNav =
  | { type: "tab"; kind: FileKind }
  | { type: "finding"; finding: ScanFindingApi }
  | { type: "href"; href: string }
  | { type: "back" }
  | { type: "cancel" }
  | { type: "reload" };

interface ConfirmState {
  check: TemplateCheck;
  missing: ConfirmKind[];
  content: string;
}

const KIND_LABEL: Record<EditableKind, string> = { cloudformation: "CloudFormation", terraform: "Terraform" };

function firstNavigableKind(findings: ScanFindingApi[]): FileKind {
  const f = findings.find((x) => x.fileKind === "cloudformation" || x.fileKind === "terraform" || x.fileKind === "mapping");
  return (f?.fileKind as FileKind | undefined) ?? "cloudformation";
}

export interface EditorControllerOptions {
  id: string;
  detail: SnapshotDetailData;
  limits: SnapshotSummary["limits"] | undefined;
  /** 저장 뒤 상세·목록 다시 조회 */
  onSaved: () => void;
  /** 편집 중 스냅샷이 지워짐(상세 404) */
  gone: boolean;
  workRef: RefObject<HTMLDivElement | null>;
}

/** 편집기 상태 (상세 페이지가 스캔 패널·이탈 방지와 공유) */
export function useTemplateEditor({ id, detail, limits, onSaved, gone, workRef }: EditorControllerOptions) {
  const router = useRouter();
  const findings = detail.scan.current.findings;
  const [activeKind, setActiveKind] = useState<FileKind>(() => firstNavigableKind(findings));
  const [target, setTarget] = useState<{ line: number; key: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<EditSession | null>(null);
  const [pending, setPending] = useState<PendingNav | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [goneDismissed, setGoneDismissed] = useState(false);
  /** 편집 중 스냅샷 삭제: 상세 404(스트림 removedIds) 또는 저장 404 */
  const [goneForced, setGoneForced] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [saved, setSaved] = useState<{ kind: FileKind; version: string; content: string } | null>(null);
  const [announce, setAnnounce] = useState("");

  const fileInfo = detail.files.find((f) => f.kind === activeKind) ?? null;
  const exists = Boolean(fileInfo?.exists);
  const editingThis = session !== null && session.kind === activeKind;
  // 보기 모드: 상세의 파일 버전이 바뀌면 다시 받는다. 편집 중에는 고정(편집 내용을 덮어쓰지 않음)
  const fileKey = editingThis ? session.baseVersion : (fileInfo?.version ?? "");
  const file = useApi<FileResponse>(exists ? `/aws-snapshots/${encodeURIComponent(id)}/files/${activeKind}` : null, undefined, fileKey);
  const loaded = file.data && file.data.kind === activeKind ? file.data : null;

  // 외부 변경(보기 모드): 같은 파일의 버전이 바뀌면 `방금 바뀜` 5초 (자기 저장은 제외)
  const [seen, setSeen] = useState<{ kind: FileKind; version: string } | null>(null);
  const [flashVersion, setFlashVersion] = useState<string | null>(null);
  if (loaded && (seen?.kind !== activeKind || seen.version !== loaded.version)) {
    if (seen?.kind === activeKind && !editingThis && loaded.version !== saved?.version) setFlashVersion(loaded.version);
    setSeen({ kind: activeKind, version: loaded.version });
  }
  useEffect(() => {
    if (!flashVersion) return;
    const t = setTimeout(() => setFlashVersion(null), 5000);
    return () => clearTimeout(t);
  }, [flashVersion]);

  const dirty = session !== null && session.value !== session.original;
  const busy = session !== null && session.phase !== "editing";
  const externalChange = session !== null && !session.conflict && Boolean(fileInfo?.version) && fileInfo?.version !== session.baseVersion;

  // 저장 직후 새 내용이 오기 전에는 저장한 내용을 보여 준다(깜박임 방지). 새 버전을 받으면 해제
  if (saved && loaded && loaded.kind === saved.kind && loaded.version === saved.version) setSaved(null);
  const shownContent = editingThis ? session.value : saved && saved.kind === activeKind ? saved.content : (loaded?.content ?? "");

  const markers = useMemo(() => markersFor(findings, activeKind), [findings, activeKind]);
  const scanFindings = useMemo(() => toScanFindings(findings), [findings]);

  const scrollWork = () => workRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });

  const endSession = () => {
    setSession(null);
    setFailure(null);
    setConfirm(null);
    setConflictOpen(false);
  };

  const switchKind = (kind: FileKind) => {
    endSession();
    setSaved(null);
    setActiveKind(kind);
    setTarget(null);
  };

  const goToFinding = (f: ScanFindingApi, index?: number) => {
    const kind = f.fileKind;
    if (kind !== "cloudformation" && kind !== "terraform" && kind !== "mapping") return;
    if (index !== undefined) setSelectedId(`${f.file}:${f.line}:${f.rule}:${index}`);
    scrollWork();
    if (kind === activeKind) {
      setTarget((t) => ({ line: f.line, key: (t?.key ?? 0) + 1 }));
      return;
    }
    if (dirty) {
      setPending({ type: "finding", finding: f });
      return;
    }
    endSession();
    setActiveKind(kind);
    setTarget((t) => ({ line: f.line, key: (t?.key ?? 0) + 1 }));
  };

  const selectFinding = (sf: ScanFinding) => {
    const idx = scanFindings.findIndex((x) => x.id === sf.id);
    const f = findings[idx];
    if (f) goToFinding(f, idx);
  };

  const requestTab = (kind: FileKind) => {
    if (kind === activeKind) return;
    if (dirty) setPending({ type: "tab", kind });
    else switchKind(kind);
  };

  const startEdit = () => {
    if (!loaded || !isEditableKind(activeKind) || !loaded.editable.allowed) return;
    setResult(null);
    setFailure(null);
    setSession({ kind: activeKind, baseVersion: loaded.version, original: loaded.content, value: loaded.content, phase: "editing", conflict: false });
    scrollWork();
  };

  const requestCancel = () => {
    if (dirty) setPending({ type: "cancel" });
    else endSession();
  };

  const reloadLatest = () => {
    endSession();
    file.reload();
  };

  const requestReload = () => {
    if (dirty) setPending({ type: "reload" });
    else reloadLatest();
  };

  // 앱 안 링크·브라우저 뒤로 가로채기 (AC-31)
  const guard = useLeaveGuard(
    dirty,
    (attempt) => setPending(attempt.type === "href" ? { type: "href", href: attempt.href } : { type: "back" }),
    (href, { replace }) => (replace ? router.replace(href) : router.push(href)),
  );

  const confirmPending = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    switch (p.type) {
      case "tab":
        switchKind(p.kind);
        break;
      case "finding":
        endSession();
        setActiveKind(p.finding.fileKind as FileKind);
        setTarget((t) => ({ line: p.finding.line, key: (t?.key ?? 0) + 1 }));
        break;
      case "href":
        guard.leaveTo(p.href);
        endSession();
        break;
      case "back":
        guard.leaveBack();
        endSession();
        break;
      case "cancel":
        endSession();
        break;
      case "reload":
        reloadLatest();
        break;
    }
  };

  const setPhase = (phase: Phase, extra?: Partial<EditSession>) => setSession((s) => (s ? { ...s, phase, ...extra } : s));

  const handleError = (e: unknown) => {
    const body = errorBody(e);
    const status = isApiError(e) ? e.status : undefined;
    setPhase("editing");
    if (body?.code === "SNAPSHOT_VERSION_CONFLICT") {
      setPhase("editing", { conflict: true });
      setConflictOpen(true);
      return;
    }
    if (status === 404 && notFoundKind(body) !== "AwsSnapshotFile") {
      setGoneDismissed(false);
      setFailure({ tone: "crit", title: "스냅샷이 없습니다. 편집 내용은 저장되지 않았습니다.", retry: false });
      setGoneForced(true);
      return;
    }
    if (status === 404) {
      setFailure({ tone: "crit", title: "파일이 없어 저장하지 않았습니다. 편집 내용은 화면에 남아 있습니다.", retry: false });
      return;
    }
    if (body?.code === "SNAPSHOT_READ_ONLY" || body?.code === "SNAPSHOT_WRITE_DISABLED" || body?.code === "SNAPSHOT_FILE_NOT_EDITABLE") {
      const text = body.code === "SNAPSHOT_FILE_NOT_EDITABLE" ? body.message || "이 파일은 편집할 수 없습니다" : writeErrorText(body, "");
      setFailure({ tone: "neutral", icon: "lock", title: `저장할 수 없습니다: ${text}`, retry: false });
      return;
    }
    if (body?.code === "SNAPSHOT_EXPORT_IN_PROGRESS") {
      setFailure({ tone: "neutral", icon: "hourglass", title: "저장할 수 없습니다: 내보내기 진행 중일 수 있습니다", retry: false });
      return;
    }
    if (status === 413) {
      const max = formatSize(limits?.editMaxBytes ?? 5 * 1024 * 1024);
      setFailure({ tone: "warn", title: `편집한 내용이 편집 상한(${max})을 넘어 저장하지 않았습니다.`, retry: false });
      return;
    }
    if (isApiError(e) && (e.kind === "network" || e.kind === "timeout")) {
      setFailure({
        tone: "crit",
        title: "저장 요청을 보내지 못했습니다. 저장됐는지 확실하지 않으니 최신 내용을 확인하세요.",
        retry: true,
      });
      return;
    }
    const errno = (body?.details as { errno?: unknown } | undefined)?.errno;
    setFailure({
      tone: "crit",
      title: body?.code === "SNAPSHOT_WRITE_FAILED" ? "저장하지 못했습니다. 원래 파일은 바뀌지 않았습니다." : "저장하지 못했습니다.",
      description: [writeErrorText(body, isApiError(e) ? e.message : "알 수 없는 오류"), typeof errno === "string" ? `(${errno})` : ""].filter(Boolean).join(" "),
      retry: true,
    });
  };

  const goneOpen = session !== null && (gone || goneForced) && !goneDismissed;

  const put = async (s: EditSession, content: string, confirmKinds: ConfirmKind[]) => {
    setPhase("saving");
    try {
      const res = await saveTemplate(id, s.kind, content, s.baseVersion, confirmKinds);
      const view = res.saved ? saveResultView(res.snapshot.scan) : { tone: "info" as const, title: "변경 사항이 없어 저장하지 않았습니다" };
      setResult({
        kind: s.kind,
        tone: view.tone,
        title: view.title,
        rescan: rescanText(res.rescan.before, res.rescan.after),
        warnings: res.check.findings.filter((f) => f.severity === "warn"),
      });
      setSaved({ kind: s.kind, version: res.version, content });
      setSession(null);
      setFailure(null);
      setConfirm(null);
      setAnnounce(`${view.title}. ${rescanText(res.rescan.before, res.rescan.after)}`);
      file.reload();
      onSaved();
    } catch (e) {
      const body = errorBody(e);
      if (body?.code === "SNAPSHOT_CONFIRMATION_REQUIRED") {
        const d = (body.details ?? {}) as { missing?: ConfirmKind[]; check?: TemplateCheck };
        setPhase("editing");
        if (d.check) {
          const missing = Array.from(new Set([...confirmKinds, ...(d.missing ?? [])]));
          setConfirm({ check: d.check, missing, content });
          return;
        }
      }
      handleError(e);
    }
  };

  const save = async () => {
    const s = session;
    if (!s || !dirty || busy) return;
    const content = s.value;
    setFailure(null);
    setResult(null);
    setPhase("checking");
    try {
      const res = await checkTemplate(id, s.kind, content, s.baseVersion);
      const need = res.check.confirmationsRequired;
      if (need.length > 0) {
        setPhase("editing");
        setConfirm({ check: res.check, missing: need, content });
        return;
      }
      await put(s, content, []);
    } catch (e) {
      handleError(e);
    }
  };

  const confirmSave = () => {
    const c = confirm;
    const s = session;
    if (!c || !s) return;
    void put(s, c.content, c.missing);
  };

  return {
    id,
    detail,
    limits,
    activeKind,
    fileInfo,
    file,
    loaded,
    shownContent,
    markers,
    scanFindings,
    target,
    selectedId,
    session,
    dirty,
    busy,
    externalChange,
    flash: flashVersion !== null && loaded?.version === flashVersion,
    pending,
    confirm,
    conflictOpen,
    goneOpen,
    failure,
    result,
    announce,
    editingThis,
    // 동작
    selectFinding,
    goToFinding,
    requestTab,
    startEdit,
    requestCancel,
    requestReload,
    save: () => void save(),
    confirmSave,
    closeConfirm: () => setConfirm(null),
    confirmPending,
    closePending: () => setPending(null),
    closeConflict: () => setConflictOpen(false),
    conflictReload: () => {
      setConflictOpen(false);
      reloadLatest();
    },
    closeGone: () => {
      setGoneDismissed(true);
      guard.leaveTo("/snapshots");
      endSession();
    },
    dismissResult: () => setResult(null),
    change: (value: string) => setSession((s) => (s && s.phase === "editing" ? { ...s, value } : s)),
  };
}

export type TemplateEditorController = ReturnType<typeof useTemplateEditor>;

const PENDING_TEXT: Record<PendingNav["type"], string> = {
  tab: "이동하면 편집한 내용이 사라집니다.",
  finding: "이동하면 편집한 내용이 사라집니다.",
  href: "이동하면 편집한 내용이 사라집니다.",
  back: "이동하면 편집한 내용이 사라집니다.",
  cancel: "계속하면 편집한 내용이 사라집니다.",
  reload: "계속하면 편집한 내용이 사라집니다.",
};

/** E. 템플릿 편집기 카드: 탭 + 툴바 + 알림 슬롯 + 코드 영역, 확인 창 */
export function TemplateEditor({ ctl, height = CODE_EDITOR_DEFAULT_HEIGHT }: { ctl: TemplateEditorController; height?: string | number }) {
  const [wrapPref, setWrap] = useBoolStore(wrapStore);
  const { detail, activeKind, fileInfo, loaded, session, editingThis } = ctl;
  const allFindings = detail.scan.current.findings;
  const dirtyKind = session && ctl.dirty ? session.kind : null;
  const tabs = useMemo(() => fileTabs(detail.files, allFindings, dirtyKind), [detail.files, allFindings, dirtyKind]);
  const ids = tabIds("snapshot-files", activeKind);
  const exists = Boolean(fileInfo?.exists);
  const kindReadOnly = activeKind === "mapping";
  const editable = loaded?.editable ?? fileInfo?.editable;
  const canEdit = Boolean(editable?.allowed) && isEditableKind(activeKind);
  const tooLarge = editable?.reasonCode === "FILE_TOO_LARGE";
  const truncated = Boolean(loaded?.truncated ?? fileInfo?.viewTruncated);
  const mode = editingThis ? "edit" : "view";
  const editDisabledReason =
    editable?.reasonCode === "FILE_TOO_LARGE" && fileInfo?.sizeBytes
      ? `파일이 커서 대시보드에서 편집할 수 없음 (${formatSize(fileInfo.sizeBytes)}, 상한 ${formatSize(ctl.limits?.editMaxBytes ?? 5 * 1024 * 1024)})`
      : (editable?.reasonText ?? "편집할 수 없습니다");
  const infoParts = fileInfo && exists ? fileInfoParts(loaded ?? fileInfo) : [];
  const saveLabel = session?.phase === "checking" ? "검사 중" : "저장 중";

  const failure = ctl.failure;
  const result = ctl.result && ctl.result.kind === activeKind && !editingThis ? ctl.result : null;

  return (
    <Card padding="none" aria-label="템플릿" editing={editingThis}>
      <Tabs idBase="snapshot-files" label="템플릿 파일" items={tabs} value={activeKind} onChange={(k) => ctl.requestTab(k as FileKind)} />
      <div
        role="tabpanel"
        id={ids.panel}
        aria-labelledby={ids.tab}
        className="stack-sm"
        style={{ paddingBottom: 0 }}
      >
        {/* 툴바 48px (디자인 5.2) */}
        <div className="row-between gap-2" style={{ minHeight: 48, padding: "0 16px", borderBottom: "1px solid var(--color-border-subtle)", flexWrap: "wrap" }}>
          <span className="row gap-2 text-caption tabular" suppressHydrationWarning>
            {infoParts.length > 0 ? infoParts.join(" · ") : exists ? "" : "파일 없음"}
            {editingThis ? <Chip tone="info" size="sm" icon="pencil" label="편집 중" /> : null}
            {editingThis && ctl.dirty ? <Chip tone="info" size="sm" dashed label="저장하지 않은 변경" /> : null}
            {!editingThis && ctl.flash ? <Chip tone="info" size="sm" icon="refresh-cw" label="방금 바뀜" /> : null}
            {exists && (kindReadOnly || tooLarge || truncated) ? (
              <Chip
                tone="neutral"
                size="sm"
                icon="lock"
                label="보기 전용"
                tooltip={kindReadOnly ? "이 파일은 import 대응표라 대시보드에서 편집하지 않습니다. JSON에는 allow 주석을 달 수 없습니다." : undefined}
              />
            ) : null}
          </span>
          {exists ? (
            <span className="row gap-2">
              {editingThis ? <span className="text-caption-tertiary">Esc 후 Tab: 편집 영역 나가기</span> : null}
              <IconButton
                icon="wrap-text"
                size="sm"
                label="줄 바꿈"
                aria-pressed={!editingThis && wrapPref}
                disabled={editingThis}
                disabledReason="편집 중에는 줄 바꿈을 쓸 수 없습니다"
                onClick={() => {
                  if (!editingThis) setWrap(!wrapPref);
                }}
              />
              {editingThis ? (
                <>
                  <Button variant="ghost" size="sm" onClick={ctl.requestCancel} disabled={ctl.busy} disabledReason="저장 중">
                    편집 취소
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon="save"
                    onClick={ctl.save}
                    loading={ctl.busy}
                    disabled={!ctl.dirty}
                    disabledReason="변경 없음"
                    aria-label={ctl.busy ? saveLabel : "저장"}
                  >
                    {ctl.busy ? saveLabel : "저장"}
                  </Button>
                </>
              ) : kindReadOnly ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon="pencil"
                  onClick={ctl.startEdit}
                  disabled={!canEdit || !loaded || session !== null}
                  disabledReason={!canEdit ? editDisabledReason : session !== null ? "다른 파일을 편집 중입니다" : "불러오는 중"}
                >
                  편집
                </Button>
              )}
            </span>
          ) : null}
        </div>

        {/* 알림 슬롯 */}
        {editingThis || failure || result || (exists && (tooLarge || truncated)) ? (
          <div className="stack-sm" style={{ padding: "0 12px" }}>
            {editingThis ? (
              <InlineAlert
                tone="info"
                icon="file-pen"
                title="이 스냅샷 원본을 직접 고칩니다"
                description="비밀값 정리와 검토 주석(# snapshot-scan: allow) 용도로 쓰세요. 복원용 손질은 README 7.1대로 복사본에서 하세요."
              />
            ) : null}
            {editingThis && (session?.conflict || ctl.externalChange) ? (
              <InlineAlert
                tone="warn"
                live
                title={session?.conflict ? "저장할 수 없음: 파일이 다른 곳에서 바뀌었습니다" : "이 파일이 다른 곳에서 바뀌었습니다"}
                description={session?.conflict ? undefined : "지금 저장하면 충돌로 거부됩니다."}
                action={
                  <span className="row gap-2">
                    <CopyButton text={session?.value ?? ""} label="내 편집 복사" size="sm" showLabel />
                    <Button variant="ghost" size="sm" onClick={ctl.requestReload}>
                      최신 내용 불러오기
                    </Button>
                  </span>
                }
              />
            ) : null}
            {failure && editingThis ? (
              <div role={failure.tone === "crit" ? "alert" : undefined}>
                <InlineAlert
                  tone={failure.tone}
                  icon={failure.icon}
                  title={failure.title}
                  description={failure.description}
                  action={
                    <span className="row gap-2">
                      {failure.retry ? (
                        <Button variant="secondary" size="sm" onClick={ctl.save}>
                          다시 저장
                        </Button>
                      ) : null}
                      <CopyButton text={session?.value ?? ""} label="내 편집 복사" size="sm" showLabel />
                    </span>
                  }
                />
              </div>
            ) : null}
            {result ? (
              <InlineAlert
                tone={result.tone}
                live
                title={result.title}
                description={
                  <span className="stack-sm">
                    <span className="tabular">{result.rescan}</span>
                    {result.warnings.length > 0 ? (
                      <ScanFindingList
                        variant="compact"
                        label="저장 후 경고"
                        maxItems={5}
                        findings={toScanFindings(result.warnings)}
                        onSelect={(f) => {
                          const w = result.warnings.find((x) => x.line === f.line && x.rule === f.ruleId);
                          if (w) ctl.goToFinding(w);
                        }}
                      />
                    ) : null}
                  </span>
                }
                action={
                  <Button variant="ghost" size="sm" onClick={ctl.dismissResult}>
                    닫기
                  </Button>
                }
              />
            ) : null}
            {!editingThis && exists && tooLarge ? (
              <InlineAlert
                tone="info"
                compact
                title={`파일이 커서 대시보드에서 편집할 수 없습니다. 편집기로 여세요. (${formatSize(fileInfo?.sizeBytes)}, 편집 상한 ${formatSize(ctl.limits?.editMaxBytes ?? 5 * 1024 * 1024)})`}
              />
            ) : null}
            {!editingThis && exists && truncated ? (
              <InlineAlert tone="info" compact title={`파일이 커서 앞부분(${formatSize(ctl.limits?.viewMaxBytes ?? 20 * 1024 * 1024)})만 표시합니다.`} />
            ) : null}
          </div>
        ) : null}

        {/* 코드 영역 */}
        {!exists ? (
          <div style={{ padding: 16 }}>
            <EmptyState
              size="sm"
              icon="file-x"
              title={`${fileInfo?.name ?? activeKind} 파일이 없습니다`}
              description="내보내기가 중간에 멈췄거나 파일이 지워졌습니다. 대시보드에서 새 파일을 만들 수 없습니다."
            />
          </div>
        ) : ctl.file.error && !loaded ? (
          <div style={{ padding: 16 }}>
            <InlineAlert
              tone="crit"
              title="파일을 불러오지 못했습니다"
              description={writeErrorText(errorBody(ctl.file.error), ctl.file.error.message)}
              action={
                <Button variant="secondary" size="sm" onClick={ctl.file.reload}>
                  다시 시도
                </Button>
              }
            />
          </div>
        ) : (
          <CodeEditor
            value={ctl.shownContent}
            fileName={fileInfo?.name ?? activeKind}
            mode={mode}
            locked={ctl.busy}
            onChange={ctl.change}
            markers={ctl.markers}
            targetLine={loaded ? (ctl.target?.line ?? null) : null}
            targetKey={`${ctl.target?.key ?? 0}:${loaded?.version ?? "loading"}`}
            wrap={!editingThis && wrapPref}
            indentUnit={indentUnitOf(loaded?.indent ?? fileInfo?.indent)}
            onSaveShortcut={ctl.save}
            height={height}
            state={loaded ? "ready" : "loading"}
          />
        )}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {ctl.announce}
      </p>

      <EditorDialogs ctl={ctl} />
    </Card>
  );
}

function EditorDialogs({ ctl }: { ctl: TemplateEditorController }) {
  const [showWarnings, setShowWarnings] = useState(false);
  const c = ctl.confirm;
  const errors = c ? c.check.findings.filter((f) => f.severity === "error") : [];
  const warnings = c ? c.check.findings.filter((f) => f.severity === "warn") : [];
  const hasErrors = c ? c.missing.includes("secret_errors") && errors.length > 0 : false;
  const kind = ctl.session?.kind ?? "cloudformation";
  const before = c?.check.resources.before ?? null;
  const after = c?.check.resources.after ?? null;

  return (
    <>
      {/* 6.2 저장 전 확인 */}
      <Dialog
        open={c !== null}
        onClose={ctl.closeConfirm}
        size="md"
        tone={hasErrors ? "danger" : "default"}
        title={hasErrors ? `비밀값 의심 ${formatCount(errors.length)}건이 남아 있습니다` : "저장 전에 확인하세요"}
        description={
          hasErrors
            ? "이 파일은 커밋하면 안 됩니다. 그래도 저장할까요? 저장해도 스냅샷은 커밋 금지 상태로 남습니다."
            : "아래 내용을 확인한 뒤 저장하세요."
        }
        cancelLabel="계속 편집"
        confirmLabel={hasErrors ? "커밋 금지 상태로 저장" : "저장"}
        confirmLoading={ctl.session?.phase === "saving"}
        confirmLoadingLabel="저장 중"
        onConfirm={ctl.confirmSave}
      >
        {c ? (
          <div className="stack">
            {hasErrors ? (
              <ScanFindingList
                variant="compact"
                label="남은 비밀값 의심"
                maxHeight={200}
                findings={toScanFindings(errors)}
                onSelect={(f) => {
                  const hit = errors.find((x) => x.line === f.line && x.rule === f.ruleId);
                  ctl.closeConfirm();
                  if (hit) ctl.goToFinding(hit);
                }}
              />
            ) : null}
            {c.missing.includes("yaml_syntax")
              ? c.check.syntax.errors.map((se, i) => (
                  <InlineAlert key={`syn-${i}`} tone="warn" title={`YAML 구문 오류 (${formatCount(se.line)}번째 줄)`} description={se.message} />
                ))
              : null}
            {c.missing.includes("resource_decrease") && before !== null && after !== null ? (
              <InlineAlert
                tone="warn"
                title={`${KIND_LABEL[kind]} 리소스 ${formatCount(before)}개 → ${formatCount(after)}개 (${MINUS}${formatCount(before - after)})`}
                description="블록을 실수로 지우지 않았는지 확인하세요."
              />
            ) : null}
            {warnings.length > 0 ? (
              <div className="stack-sm">
                <Button variant="ghost" size="sm" icon="chevron-down" aria-expanded={showWarnings} onClick={() => setShowWarnings((v) => !v)}>
                  경고 {formatCount(warnings.length)}건 (저장을 막지 않음)
                </Button>
                {showWarnings ? <ScanFindingList variant="compact" label="경고" maxHeight={160} findings={toScanFindings(warnings)} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {/* 6.3 저장 충돌: 강제 덮어쓰기 없음 (AC-30) */}
      <Dialog
        open={ctl.conflictOpen}
        onClose={ctl.closeConflict}
        size="md"
        title="다른 곳에서 파일이 바뀌었습니다"
        description="편집을 시작한 뒤 이 파일이 다른 탭, 텍스트 편집기, git 등에서 바뀌어 저장하지 않았습니다. 덮어쓰기는 할 수 없습니다."
        cancelLabel="닫기"
      >
        <div className="stack-sm">
          <div className="stack-sm" style={{ padding: 12, border: "1px solid var(--color-border-subtle)", borderRadius: 6 }}>
            <p className="text-strong">내 편집 내용 복사</p>
            <p className="text-caption">클립보드에 복사한 뒤 최신 내용에 다시 반영하세요.</p>
            <span>
              <CopyButton text={ctl.session?.value ?? ""} label="내 편집 복사" size="md" showLabel />
            </span>
          </div>
          <div className="stack-sm" style={{ padding: 12, border: "1px solid var(--color-border-subtle)", borderRadius: 6 }}>
            <p className="text-strong">최신 내용 다시 불러오기</p>
            <p className="text-caption">내 편집은 버려집니다.</p>
            <span>
              <Button variant="danger" size="sm" onClick={ctl.conflictReload}>
                최신 내용 불러오기
              </Button>
            </span>
          </div>
        </div>
      </Dialog>

      {/* 6.4 저장하지 않은 변경 */}
      <Dialog
        open={ctl.pending !== null}
        onClose={ctl.closePending}
        size="sm"
        tone="danger"
        title="저장하지 않은 변경이 있습니다"
        description={ctl.pending ? PENDING_TEXT[ctl.pending.type] : undefined}
        cancelLabel="계속 편집"
        confirmLabel="변경 버리기"
        onConfirm={ctl.confirmPending}
      />

      {/* 6.5 스냅샷 없음(편집 중 삭제) */}
      <Dialog
        open={ctl.goneOpen}
        onClose={ctl.closeGone}
        size="sm"
        title="스냅샷이 없습니다"
        description="편집하는 동안 이 스냅샷이 휴지통으로 옮겨졌거나 지워졌습니다. 편집 내용은 저장되지 않았습니다."
        cancelLabel="목록으로"
      >
        <span>
          <CopyButton text={ctl.session?.value ?? ""} label="내 편집 복사" size="md" showLabel />
        </span>
      </Dialog>
    </>
  );
}
