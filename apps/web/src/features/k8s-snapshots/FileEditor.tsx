"use client";

/**
 * 파일 탭 편집기 (docs/design/k8s-snapshot.md 5.4, ASM-D 5·6절, 명세 5.4).
 * AWS 템플릿 편집기(aws-snapshots/TemplateEditor)와 같은 흐름을 경로 기반으로 쓴다.
 *
 * 저장 흐름 (계약 7.2·7.3)
 *   [저장] → POST …/file/check?path=(`검사 중`) → 확인 사유(오류 남음·YAML 구문·경로 불일치·여러 문서)가 있으면 확인 창(10.1)
 *          → PUT …/file?path= { content(LF), baseVersion, confirm }(`저장 중`)
 *   PUT 이 422 면 details.missing 을 confirm 에 넣어 다시 묻는다. 409 는 충돌 창(강제 덮어쓰기 없음).
 * 파일은 서버가 준 `files[].path`만 연다. 상세 탭을 옮겨도 편집 세션은 이 컨트롤러(상세 페이지)에 남는다.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type RefObject } from "react";

import {
  Button,
  Card,
  Chip,
  CodeEditor,
  CopyButton,
  Dialog,
  DriftKindChip,
  EmptyState,
  formatCount,
  IconButton,
  InlineAlert,
  KeyValueList,
  ScanFindingList,
  type AlertTone,
  type IconName,
  type ScanFinding,
} from "@/components/ui";
import { isApiError } from "@/lib/api";

import { useBoolStore, useLeaveGuard, wrapStore } from "../aws-snapshots/hooks";
import { fileInfoParts, formatSize, indentUnitOf, notFoundKind, rescanText, saveResultView, writeErrorText } from "../aws-snapshots/model";
import { errorBody, useApi } from "../common/hooks";
import { checkK8sFile, filePath, saveK8sFile } from "./api";
import type { DetailQuery } from "./hooks";
import { k8sDetailHref, K8S_LIST_HREF, k8sFindingId, markersForPath, pathSegments, repoPath, toK8sScanFindings } from "./model";
import type {
  K8sConfirmKind,
  K8sFileCheck,
  K8sFileInfo,
  K8sFileResponse,
  K8sScanFinding,
  K8sSnapshotDetailData,
  K8sSnapshotSummary,
  ResourceIdentity,
} from "./types";

type Phase = "editing" | "checking" | "saving";

interface EditSession {
  path: string;
  baseVersion: string;
  original: string;
  value: string;
  phase: Phase;
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
  path: string;
  tone: "ok" | "warn" | "crit" | "info";
  title: string;
  rescan: string;
  drift: boolean;
  warnings: K8sScanFinding[];
}

type PendingNav =
  | { type: "file"; path: string; line: number | null }
  | { type: "href"; href: string }
  | { type: "back" }
  | { type: "cancel" }
  | { type: "reload" };

interface ConfirmState {
  check: K8sFileCheck;
  missing: K8sConfirmKind[];
  content: string;
}

const isEditableType = (f: K8sFileInfo | undefined | null) => f?.fileType === "resource" || f?.fileType === "namespace";

/** 기본으로 열 파일: 현재 스캔 오류가 있으면 첫 오류의 파일 (디자인 5.1) */
export function defaultOpenPath(detail: K8sSnapshotDetailData): { path: string | null; line: number | null } {
  const known = new Set(detail.files.map((f) => f.path));
  const first = detail.scan.current.findings.find((f) => f.severity === "error" && known.has(f.file));
  return first ? { path: first.file, line: first.line } : { path: null, line: null };
}

export interface K8sEditorOptions {
  id: string;
  detail: K8sSnapshotDetailData;
  summary: K8sSnapshotSummary | null;
  query: DetailQuery;
  patch: (p: Partial<DetailQuery>) => void;
  onSaved: () => void;
  /** 편집 중 스냅샷이 지워짐(상세 404·removedIds) */
  gone: boolean;
  workRef: RefObject<HTMLDivElement | null>;
}

export function useK8sFileEditor({ id, detail, summary, query, patch, onSaved, gone, workRef }: K8sEditorOptions) {
  const router = useRouter();
  const findings = detail.scan.current.findings;
  const knownPaths = useMemo(() => new Set(detail.files.map((f) => f.path)), [detail.files]);
  const [initial] = useState(() => (query.file ? { path: query.file, line: query.line } : defaultOpenPath(detail)));
  const [openPath, setOpenPath] = useState<string | null>(initial.path);
  const [target, setTarget] = useState<{ line: number; key: number } | null>(initial.line ? { line: initial.line, key: 1 } : null);
  const [seenUrlFile, setSeenUrlFile] = useState<string | null>(query.file);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<EditSession | null>(null);
  const [pending, setPending] = useState<PendingNav | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [goneDismissed, setGoneDismissed] = useState(false);
  const [goneForced, setGoneForced] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [saved, setSaved] = useState<{ path: string; version: string; content: string } | null>(null);
  const [announce, setAnnounce] = useState("");

  // 링크·뒤로 가기로 URL 의 `file` 이 바뀌면 그 파일을 연다 (없어진 경우는 지금 파일 유지: 다른 상세 탭 링크)
  if (query.file !== seenUrlFile) {
    setSeenUrlFile(query.file);
    if (query.file && query.file !== openPath) {
      setOpenPath(query.file);
      setTarget(query.line ? { line: query.line, key: (target?.key ?? 0) + 1 } : null);
    }
  }
  // 열린 파일이 바뀌면 이전 파일의 편집 세션은 끝난다 (확인은 이동 전에 받는다)
  if (session && session.path !== openPath) {
    setSession(null);
    setFailure(null);
    setConfirm(null);
    setConflictOpen(false);
  }

  const fileInfo = openPath ? (detail.files.find((f) => f.path === openPath) ?? null) : null;
  const missingPath = openPath !== null && !fileInfo;
  const exists = Boolean(fileInfo?.exists);
  const editingThis = session !== null && session.path === openPath;
  const fileKey = editingThis ? session.baseVersion : (fileInfo?.version ?? "");
  const file = useApi<K8sFileResponse>(exists && openPath ? filePath(id) : null, openPath ? { path: openPath } : undefined, fileKey);
  const loaded = file.data && file.data.path === openPath ? file.data : null;

  // 외부 변경(보기 모드): 같은 파일의 버전이 바뀌면 `방금 바뀜` 5초 (자기 저장 제외)
  const [seen, setSeen] = useState<{ path: string; version: string } | null>(null);
  const [flashVersion, setFlashVersion] = useState<string | null>(null);
  if (loaded && openPath && (seen?.path !== openPath || seen.version !== loaded.version)) {
    if (seen?.path === openPath && !editingThis && loaded.version !== saved?.version) setFlashVersion(loaded.version);
    setSeen({ path: openPath, version: loaded.version });
  }
  useEffect(() => {
    if (!flashVersion) return;
    const t = setTimeout(() => setFlashVersion(null), 5000);
    return () => clearTimeout(t);
  }, [flashVersion]);

  const dirty = session !== null && session.value !== session.original;
  const busy = session !== null && session.phase !== "editing";
  const externalChange = session !== null && !session.conflict && Boolean(fileInfo?.version) && fileInfo?.version !== session.baseVersion;

  if (saved && loaded && loaded.path === saved.path && loaded.version === saved.version) setSaved(null);
  const shownContent = editingThis ? session.value : saved && saved.path === openPath ? saved.content : (loaded?.content ?? "");

  const markers = useMemo(() => (openPath ? markersForPath(findings, openPath) : []), [findings, openPath]);
  const scanFindings = useMemo(() => toK8sScanFindings(findings, knownPaths), [findings, knownPaths]);

  const scrollWork = () => workRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });

  const endSession = () => {
    setSession(null);
    setFailure(null);
    setConfirm(null);
    setConflictOpen(false);
  };

  const doOpen = (path: string, line: number | null) => {
    endSession();
    setSaved(null);
    setOpenPath(path);
    setSeenUrlFile(path);
    setTarget((t) => (line ? { line, key: (t?.key ?? 0) + 1 } : null));
    patch({ view: "files", file: path, line });
  };

  /** 트리·발견·드리프트 `파일 보기`에서 파일 열기. 다른 파일에 저장 안 한 변경이 있으면 확인(ASM-D 6.4) */
  const requestOpen = (path: string, line: number | null = null) => {
    if (!knownPaths.has(path)) return;
    scrollWork();
    if (path === openPath) {
      if (line) setTarget((t) => ({ line, key: (t?.key ?? 0) + 1 }));
      if (query.view !== "files") patch({ view: "files" });
      return;
    }
    if (dirty) {
      setPending({ type: "file", path, line });
      return;
    }
    doOpen(path, line);
  };

  const selectFinding = (sf: ScanFinding) => {
    const idx = scanFindings.findIndex((x) => x.id === sf.id);
    const f = findings[idx];
    if (!f || !knownPaths.has(f.file)) return;
    setSelectedId(k8sFindingId(f, idx));
    requestOpen(f.file, f.line);
  };

  const startEdit = () => {
    if (!loaded || !openPath || !isEditableType(fileInfo) || !loaded.editable.allowed) return;
    setResult(null);
    setFailure(null);
    setSession({ path: openPath, baseVersion: loaded.version, original: loaded.content, value: loaded.content, phase: "editing", conflict: false });
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

  // 앱 안 링크·브라우저 뒤로 가로채기 (AC-K22 → ASM AC-31). 같은 상세 안에서 파일을 바꾸지 않는 링크(탭 전환)는 막지 않는다.
  const guard = useLeaveGuard(
    dirty,
    (attempt) => setPending(attempt.type === "href" ? { type: "href", href: attempt.href } : { type: "back" }),
    (href, { replace }) => (replace ? router.replace(href) : router.push(href)),
    (url) => {
      if (url.pathname !== window.location.pathname) return false;
      const f = url.searchParams.get("file");
      return f === null || f === openPath;
    },
  );

  const confirmPending = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    switch (p.type) {
      case "file":
        doOpen(p.path, p.line);
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
    if (status === 404 && notFoundKind(body) !== "K8sSnapshotFile") {
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
      const max = formatSize(summary?.limits.editMaxBytes ?? 5 * 1024 * 1024);
      setFailure({ tone: "warn", title: `편집한 내용이 편집 상한(${max})을 넘어 저장하지 않았습니다.`, retry: false });
      return;
    }
    if (isApiError(e) && (e.kind === "network" || e.kind === "timeout")) {
      setFailure({ tone: "crit", title: "저장 요청을 보내지 못했습니다. 저장됐는지 확실하지 않으니 최신 내용을 확인하세요.", retry: true });
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

  const put = async (s: EditSession, content: string, confirmKinds: K8sConfirmKind[]) => {
    setPhase("saving");
    try {
      const res = await saveK8sFile(id, s.path, content, s.baseVersion, confirmKinds);
      const view = res.saved ? saveResultView(res.snapshot.scan) : { tone: "info" as const, title: "변경 사항이 없어 저장하지 않았습니다" };
      const rescan = rescanText(res.rescan.before, res.rescan.after);
      const drift = res.saved && res.driftRecompute === "scheduled";
      setResult({ path: s.path, tone: view.tone, title: view.title, rescan, drift, warnings: res.check.findings.filter((f) => f.severity === "warn") });
      setSaved({ path: s.path, version: res.version, content });
      setSession(null);
      setFailure(null);
      setConfirm(null);
      setAnnounce(`${view.title}. ${rescan}${drift ? ". 드리프트를 다시 계산합니다" : ""}`);
      file.reload();
      onSaved();
    } catch (e) {
      const body = errorBody(e);
      if (body?.code === "SNAPSHOT_CONFIRMATION_REQUIRED") {
        const d = (body.details ?? {}) as { missing?: K8sConfirmKind[]; check?: K8sFileCheck };
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
      const res = await checkK8sFile(id, s.path, content, s.baseVersion);
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
    summary,
    openPath,
    fileInfo,
    missingPath,
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
    dirtyPath: session && dirty ? session.path : null,
    requestOpen,
    selectFinding,
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
      guard.leaveTo(K8S_LIST_HREF);
      endSession();
    },
    dismissResult: () => setResult(null),
    change: (value: string) => setSession((s) => (s && s.phase === "editing" ? { ...s, value } : s)),
  };
}

export type K8sEditorController = ReturnType<typeof useK8sFileEditor>;

const PENDING_TEXT: Record<PendingNav["type"], string> = {
  file: "이동하면 편집한 내용이 사라집니다.",
  href: "이동하면 편집한 내용이 사라집니다.",
  back: "이동하면 편집한 내용이 사라집니다.",
  cancel: "계속하면 편집한 내용이 사라집니다.",
  reload: "계속하면 편집한 내용이 사라집니다.",
};

const identityLine = (r: Pick<ResourceIdentity, "kind" | "namespace" | "name"> | { kind: string | null; namespace: string | null; name: string }) =>
  `${r.kind ?? "?"} ${r.namespace ? `${r.namespace}/` : ""}${r.name}`;

/** 알림 슬롯의 파일 문제 안내 (디자인 5.4 추가 상태 표) */
function fileProblemAlerts(f: K8sFileInfo): { tone: AlertTone; title: string; tooltip?: string }[] {
  const out: { tone: AlertTone; title: string; tooltip?: string }[] = [];
  const tail = "이 리소스는 드리프트 비교에서 빠집니다.";
  if (f.parse === "yaml_error") {
    const line = f.parseError?.line;
    out.push({ tone: "warn", title: `YAML로 읽을 수 없습니다${line ? ` (${formatCount(line)}번째 줄)` : ""}. ${tail}`, tooltip: f.parseError?.message });
  } else if (f.parse === "not_object") out.push({ tone: "warn", title: `최상위가 YAML 매핑이 아닙니다. ${tail}` });
  else if (f.parse === "empty") out.push({ tone: "warn", title: `빈 파일입니다. ${tail}` });
  else if (f.parse === "too_large") out.push({ tone: "warn", title: `파일이 커서 해석하지 않았습니다. ${tail}` });
  else if (f.parse === "multi_document") {
    const n = f.documents?.length ?? 2;
    out.push({ tone: "warn", title: `한 파일에 리소스 ${formatCount(n)}개가 들어 있습니다 (--- 구분). 드리프트는 문서마다 따로 비교합니다.` });
  }
  if (!f.pathMatches && f.expected && f.resource) {
    out.push({ tone: "warn", title: `파일 경로와 내용이 다릅니다: 경로 ${identityLine(f.expected)} · 내용 ${identityLine(f.resource)}` });
  } else if (!f.pathMatches && (f.fileType === "resource" || f.fileType === "namespace") && f.parse === "ok") {
    out.push({ tone: "warn", title: "파일 경로와 내용이 다릅니다" });
  }
  if (f.duplicate) {
    const other = f.duplicateOf?.[0];
    out.push({ tone: "warn", title: `같은 리소스가 다른 파일에도 있습니다${other ? `: ${other}` : ""}` });
  }
  if (f.runtimeFields.length > 0) {
    out.push({ tone: "info", title: `런타임 필드가 남아 있습니다 (${f.runtimeFields.slice(0, 5).join(", ")}). 다시 적용하기 전에 지우는 것이 좋습니다.` });
  }
  return out;
}

/** 파일 편집기 카드: 파일 머리 + 툴바 + 알림 슬롯 + 코드 영역 + 확인 창 (디자인 5.4) */
export function K8sFileEditor({ ctl, height }: { ctl: K8sEditorController; height: string | number }) {
  const [wrapPref, setWrap] = useBoolStore(wrapStore);
  const { fileInfo, loaded, session, editingThis, openPath, detail } = ctl;
  const exists = Boolean(fileInfo?.exists);
  const readOnlyKind = fileInfo?.fileType === "metadata" || fileInfo?.fileType === "secret_refs";
  const editable = loaded?.editable ?? fileInfo?.editable;
  const canEdit = Boolean(editable?.allowed) && isEditableType(fileInfo);
  const tooLarge = editable?.reasonCode === "FILE_TOO_LARGE";
  const truncated = Boolean(loaded?.truncated ?? fileInfo?.viewTruncated);
  const mode = editingThis ? "edit" : "view";
  const editDisabledReason =
    tooLarge && fileInfo?.sizeBytes
      ? `파일이 커서 대시보드에서 편집할 수 없음 (${formatSize(fileInfo.sizeBytes)}, 상한 ${formatSize(ctl.summary?.limits.editMaxBytes ?? 5 * 1024 * 1024)})`
      : (editable?.reasonText ?? "편집할 수 없습니다");
  const infoParts =
    fileInfo && exists
      ? fileInfoParts({
          lineCount: loaded?.lineCount ?? fileInfo.lineCount ?? null,
          sizeBytes: loaded?.sizeBytes ?? fileInfo.sizeBytes,
          modifiedAt: loaded?.modifiedAt ?? fileInfo.modifiedAt ?? null,
          eol: loaded?.eol ?? fileInfo.eol ?? null,
          encoding: loaded?.encoding ?? fileInfo.encoding ?? null,
        })
      : [];
  const saveLabel = session?.phase === "checking" ? "검사 중" : "저장 중";
  const failure = ctl.failure;
  const result = ctl.result && ctl.result.path === openPath && !editingThis ? ctl.result : null;
  const resource = loaded?.resource ?? fileInfo?.resource ?? null;
  const problems = fileInfo ? fileProblemAlerts(fileInfo) : [];

  // 파일을 고르지 않음 / 목록에 없는 경로
  if (!openPath || ctl.missingPath) {
    return (
      <Card padding="none" aria-label="파일 편집기" style={{ height: "100%" }}>
        <div style={{ padding: 16 }} className="stack">
          {ctl.missingPath ? <InlineAlert tone="neutral" compact title="이 스냅샷에 없는 파일입니다." /> : null}
          <EmptyState
            size="sm"
            icon="file-text"
            title="파일을 고르세요"
            description="왼쪽 리소스 목록에서 파일을 고르면 여기에서 보고 편집할 수 있습니다."
          />
        </div>
        <EditorDialogs ctl={ctl} />
      </Card>
    );
  }

  const segs = pathSegments(openPath);
  return (
    <Card padding="none" aria-label="파일 편집기" editing={editingThis}>
      {/* 파일 머리 40px (디자인 5.4) */}
      <div
        className="row-between gap-2"
        style={{ minHeight: 40, padding: "0 16px", borderBottom: "1px solid var(--color-border-subtle)", background: "var(--color-bg-surface)", flexWrap: "wrap" }}
      >
        <span className="row gap-1 min-w-0">
          <span className="text-mono truncate" title={openPath} style={{ fontSize: 12 }}>
            {segs.map((s, i) => (
              <span key={`${s}-${i}`}>
                {i > 0 ? <span className="text-caption-tertiary"> / </span> : null}
                {s}
              </span>
            ))}
          </span>
          <CopyButton text={repoPath(ctl.summary?.root.displayPath, ctl.id, openPath)} size="sm" label="경로 복사" />
          {ctl.dirty && editingThis ? (
            <span aria-label="저장 안 됨" role="img" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--color-accent-default)", display: "inline-block" }} />
          ) : null}
        </span>
        <span className="row gap-2" style={{ flexWrap: "wrap" }}>
          {resource ? (
            <span className="text-caption">
              {resource.kind} · {resource.namespace ? `${resource.namespace}/` : ""}
              {resource.name}
            </span>
          ) : null}
          {fileInfo?.helmManaged ? <Chip size="sm" icon="ship-wheel" label="Helm 관리" /> : null}
          {fileInfo && (fileInfo.drift === "changed" || fileInfo.drift === "deleted") && fileInfo.resourceKey ? (
            <DriftKindChip kind={fileInfo.drift} href={k8sDetailHref(ctl.id, { view: "drift", res: fileInfo.resourceKey })} tooltip="드리프트에서 보기" />
          ) : null}
          {readOnlyKind ? <Chip size="sm" icon="lock" label="보기 전용" tooltip="CLI가 기록한 파일이라 대시보드에서 편집하지 않습니다." /> : null}
        </span>
      </div>

      {/* 툴바 48px (ASM-D 5.2) */}
      <div className="row-between gap-2" style={{ minHeight: 48, padding: "0 16px", borderBottom: "1px solid var(--color-border-subtle)", flexWrap: "wrap" }}>
        <span className="row gap-2 text-caption tabular" suppressHydrationWarning>
          {infoParts.length > 0 ? infoParts.join(" · ") : exists ? "" : "파일 없음"}
          {editingThis ? <Chip tone="info" size="sm" icon="pencil" label="편집 중" /> : null}
          {editingThis && ctl.dirty ? <Chip tone="info" size="sm" dashed label="저장하지 않은 변경" /> : null}
          {!editingThis && ctl.flash ? <Chip tone="info" size="sm" icon="refresh-cw" label="방금 바뀜" /> : null}
          {exists && !readOnlyKind && (tooLarge || truncated) ? <Chip tone="neutral" size="sm" icon="lock" label="보기 전용" /> : null}
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
            ) : readOnlyKind ? null : (
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
      {editingThis || failure || result || problems.length > 0 || (exists && (tooLarge || truncated)) ? (
        <div className="stack-sm" style={{ padding: "8px 12px 0" }}>
          {editingThis ? (
            <InlineAlert
              tone="info"
              icon="file-pen"
              title="이 스냅샷 원본을 직접 고칩니다"
              description="비밀값 정리와 검토 주석(# snapshot-scan: allow), 드리프트 확인을 위한 맞춤에 쓰세요. 이 파일은 git에 커밋하는 스냅샷 원본입니다."
            />
          ) : null}
          {problems.map((p, i) => (
            <InlineAlert key={`p-${i}`} tone={p.tone} compact title={p.title} description={p.tooltip} />
          ))}
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
                  {result.drift ? <span>드리프트를 다시 계산합니다 (30초 이내).</span> : null}
                  {result.warnings.length > 0 ? (
                    <ScanFindingList
                      variant="compact"
                      label="저장 후 경고"
                      maxItems={5}
                      truncateFile
                      findings={toK8sScanFindings(result.warnings, new Set(detail.files.map((f) => f.path)))}
                      onSelect={(f) => ctl.requestOpen(f.file, f.line)}
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
              title={`파일이 커서 대시보드에서 편집할 수 없습니다. 편집기로 여세요. (${formatSize(fileInfo?.sizeBytes)}, 편집 상한 ${formatSize(ctl.summary?.limits.editMaxBytes ?? 5 * 1024 * 1024)})`}
            />
          ) : null}
          {!editingThis && exists && truncated ? (
            <InlineAlert tone="info" compact title={`파일이 커서 앞부분(${formatSize(ctl.summary?.limits.viewMaxBytes ?? 20 * 1024 * 1024)})만 표시합니다.`} />
          ) : null}
        </div>
      ) : null}

      {/* 코드 영역 */}
      {!exists ? (
        <div style={{ padding: 16 }}>
          <EmptyState size="sm" icon="file-x" title={`${openPath} 파일이 없습니다`} description="파일이 지워졌습니다. 대시보드에서 새 파일을 만들 수 없습니다." />
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
          fileName={openPath.slice(openPath.lastIndexOf("/") + 1)}
          mode={mode}
          locked={ctl.busy}
          onChange={ctl.change}
          markers={ctl.markers}
          targetLine={loaded ? (ctl.target?.line ?? null) : null}
          targetKey={`${ctl.target?.key ?? 0}:${loaded?.version ?? "loading"}`}
          wrap={!editingThis && wrapPref}
          indentUnit={indentUnitOf(loaded?.indent ?? fileInfo?.indent ?? null)}
          onSaveShortcut={ctl.save}
          height={height}
          state={loaded ? "ready" : "loading"}
        />
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {ctl.announce}
      </p>
      <EditorDialogs ctl={ctl} />
    </Card>
  );
}

function EditorDialogs({ ctl }: { ctl: K8sEditorController }) {
  const [showWarnings, setShowWarnings] = useState(false);
  const c = ctl.confirm;
  const known = useMemo(() => new Set(ctl.detail.files.map((f) => f.path)), [ctl.detail.files]);
  const errors = c ? c.check.findings.filter((f) => f.severity === "error") : [];
  const warnings = c ? c.check.findings.filter((f) => f.severity === "warn") : [];
  const hasErrors = c ? c.missing.includes("secret_errors") && errors.length > 0 : false;
  const identity = c?.check.identity;

  return (
    <>
      {/* 저장 전 확인 (ASM-D 6.2 + 10.1): ① 오류 → ② YAML 구문 → ⑥ 경로·내용 → ⑤ 여러 문서 → ④ 경고(접힘) */}
      <Dialog
        open={c !== null}
        onClose={ctl.closeConfirm}
        size="md"
        tone={hasErrors ? "danger" : "default"}
        title={hasErrors ? `비밀값 의심 ${formatCount(errors.length)}건이 남아 있습니다` : "저장 전에 확인하세요"}
        description={
          hasErrors ? "이 파일은 커밋하면 안 됩니다. 그래도 저장할까요? 저장해도 스냅샷은 커밋 금지 상태로 남습니다." : "아래 내용을 확인한 뒤 저장하세요."
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
                truncateFile
                findings={toK8sScanFindings(errors, known)}
                onSelect={(f) => {
                  ctl.closeConfirm();
                  if (f.line) ctl.requestOpen(f.file, f.line);
                }}
              />
            ) : null}
            {c.missing.includes("yaml_syntax")
              ? c.check.syntax.errors.map((se, i) => (
                  <InlineAlert key={`syn-${i}`} tone="warn" title={`YAML 구문 오류 (${formatCount(se.line)}번째 줄)`} description={se.message} />
                ))
              : null}
            {c.missing.includes("identity_changed") && identity ? (
              <InlineAlert
                tone="warn"
                title="파일 경로와 리소스가 다릅니다"
                description={
                  <span className="stack-sm">
                    <KeyValueList
                      columns={1}
                      labelWidth={72}
                      items={[
                        { label: "경로", value: <span className="text-mono">{identity.expected ? identityLine(identity.expected) : "—"}</span> },
                        { label: "내용", value: <span className="text-mono">{identity.actual ? identityLine(identity.actual) : "—"}</span> },
                      ]}
                    />
                    <span>저장하면 파일 상태가 주의가 되고, 드리프트는 파일 내용 기준으로 짝을 맞춥니다.</span>
                  </span>
                }
              />
            ) : null}
            {c.missing.includes("multi_document") ? (
              <InlineAlert
                tone="warn"
                title={`문서 ${formatCount(c.check.documents)}개가 들어 있습니다 (--- 구분)`}
                description="리소스 1개 = 파일 1개 규칙과 다릅니다. 저장하면 파일 상태가 주의가 되고, 드리프트는 문서마다 따로 비교합니다."
              />
            ) : null}
            {warnings.length > 0 ? (
              <div className="stack-sm">
                <Button variant="ghost" size="sm" icon="chevron-down" aria-expanded={showWarnings} onClick={() => setShowWarnings((v) => !v)}>
                  경고 {formatCount(warnings.length)}건 (저장을 막지 않음)
                </Button>
                {showWarnings ? <ScanFindingList variant="compact" label="경고" maxHeight={160} truncateFile findings={toK8sScanFindings(warnings, known)} /> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      {/* 저장 충돌: 강제 덮어쓰기 없음 */}
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

      {/* 저장하지 않은 변경 */}
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

      {/* 스냅샷 없음(편집 중 삭제) */}
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
