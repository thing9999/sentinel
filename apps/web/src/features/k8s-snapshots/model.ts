/**
 * k8s-snapshot 화면 도우미 (순수 함수, 테스트 대상).
 * 상태·사유·건수·분류·가림은 서버 값만 쓴다(명세 4.6, common.md 2.2). 여기서는 표시 모양만 만든다.
 */
import type { ReactNode } from "react";

import {
  formatCount,
  formatDriftBreakdown,
  formatDriftLastResult,
  MINUS,
  worstScanLevel,
  type CodeEditorMarker,
  type DriftKind,
  type DriftState,
  type ScanFinding,
  type Status,
  type TabItem,
  type TreeNode,
} from "@/components/ui";

import type {
  ClusterRelation,
  DriftBadge,
  DriftFacetKey,
  DriftResource,
  DriftResponse,
  K8sCli,
  K8sFileInfo,
  K8sScanFinding,
  K8sSnapshotCluster,
  K8sSnapshotDetailData,
  K8sSnapshotScope,
  KindDriftFlag,
  SecretVia,
  WriteAbility,
} from "./types";

export { isSnapshotId } from "../aws-snapshots/model";

export const K8S_LIST_HREF = "/snapshots/k8s";
export const K8S_TRASH_HREF = "/snapshots/k8s/trash";
export const k8sDetailHref = (id: string, query?: Record<string, string | null | undefined>): string => {
  const base = `${K8S_LIST_HREF}/${encodeURIComponent(id)}`;
  if (!query) return base;
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined && v !== "") p.set(k, v);
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
};

/** CLI 안내 기본 문구 (계약 6.2 `cli`. 응답이 오기 전·옛 응답에서만 쓴다) */
export const DEFAULT_K8S_CLI: K8sCli = {
  install: "npm install --prefix deploy/k8s-snapshot",
  configure: "deploy/k8s-snapshot/.env.example 을 .env 로 복사한 뒤 KUBE_CONTEXT 를 채우세요",
  dryRun: "npm run export:dry --prefix deploy/k8s-snapshot",
  export: "npm run export --prefix deploy/k8s-snapshot",
  scan: "npm run scan --prefix deploy/k8s-snapshot -- snapshots/<id>",
  readme: "deploy/k8s-snapshot/README.md",
  settings: [],
  exitCodes: [],
};

export const DEFAULT_DISPLAY_PATH = "deploy/k8s-snapshot/snapshots";

// ---------------------------------------------------------------- 드리프트 배지 (디자인 3.5·3.5.1·16절)

/** 목록 2줄·상세 chips 줄의 짧은 문구 (3.5.1). 표에 없는 코드는 서버 text */
export const DRIFT_REASON_SHORT: Record<string, string> = {
  CLUSTER_NOT_CONNECTED: "클러스터 연결 없음",
  CLUSTER_SYNCING: "클러스터 동기화 중",
  DASHBOARD_CLUSTER_UNKNOWN: "대시보드 클러스터 확인 불가",
  CLUSTER_MISMATCH: "다른 클러스터",
  CLUSTER_ID_MISSING: "클러스터 확인 불가",
  SNAPSHOT_FILES_PENDING: "파일 확인 전",
  NO_COMPARABLE_RESOURCES: "비교할 리소스 없음",
  DRIFT_RULES_UNAVAILABLE: "규칙을 불러올 수 없음",
  DRIFT_FAILED: "계산 실패",
};

/** 계산 버튼 비활성 사유 (`actions.computeDrift.reasonText`가 없을 때 대체, 3.5.1) */
export const DRIFT_BUTTON_REASON: Record<string, string> = {
  CLUSTER_NOT_CONNECTED: "클러스터 연결 없음",
  CLUSTER_SYNCING: "클러스터 동기화 중",
  DASHBOARD_CLUSTER_UNKNOWN: "대시보드가 연결된 클러스터를 확인할 수 없음",
  CLUSTER_MISMATCH: "다른 클러스터의 스냅샷",
  CLUSTER_ID_MISSING: "스냅샷의 클러스터를 확인할 수 없음",
  SNAPSHOT_FILES_PENDING: "스냅샷 파일 확인 전",
  NO_COMPARABLE_RESOURCES: "비교할 수 있는 리소스 없음",
  DRIFT_RULES_UNAVAILABLE: "드리프트 규칙을 불러올 수 없음",
};

export function driftCode(badge: DriftBadge | null | undefined): string | null {
  return badge?.status.reasons[0]?.code ?? null;
}

export const isNotComputed = (badge: DriftBadge | null | undefined) => driftCode(badge) === "DRIFT_NOT_COMPUTED";

/** 보이는 차이 건수 (추가+삭제+변경, 서버 counts) */
export function driftDiffCount(badge: DriftBadge | null | undefined): number {
  const c = badge?.counts;
  return c ? c.added + c.deleted + c.changed : 0;
}

export interface DriftCellView {
  state: DriftState;
  count?: number;
  /** 목록 2줄·chips 사유 (없으면 빈 문자열) */
  line2: string;
  /** 배지 스크린리더 사유 */
  srReason?: string;
  refreshing: boolean;
  staleAt?: string;
  previous?: { count?: number };
}

let warnedCritical = false;

/**
 * DriftBadge → DriftStatus (디자인 16절 매핑, 3.5 판단 순서): stale → DRIFT_NOT_COMPUTED → status.
 * pending = 이 화면이 보낸 계산 요청 응답 대기 → `계산 중`.
 */
export function driftCellView(badge: DriftBadge | null | undefined, opts: { pending?: boolean; now?: number | Date; kubeStale?: boolean } = {}): DriftCellView {
  if (opts.pending) return { state: "computing", line2: "", refreshing: false };
  if (!badge) return { state: "unknown", line2: "", refreshing: false };
  const code = driftCode(badge);
  const refreshing = Boolean(badge.computing);
  const count = driftDiffCount(badge);
  const breakdown = badge.counts ? formatDriftBreakdown(badge.counts) : "";
  if (badge.status.stale || (opts.kubeStale && badge.computed && code !== "DRIFT_NOT_COMPUTED")) {
    const prevCount = badge.status.status === "warning" ? count : 0;
    return {
      state: "stale",
      line2: breakdown,
      refreshing,
      staleAt: badge.computedAt ?? badge.status.updatedAt ?? undefined,
      previous: { count: prevCount },
    };
  }
  if (code === "DRIFT_NOT_COMPUTED") {
    let line2 = "";
    if (badge.mode === "last_result" && badge.computedAt && badge.lastResultStatus) {
      line2 = formatDriftLastResult(
        { state: badge.lastResultStatus === "warning" ? "changed" : "none", count, computedAt: badge.computedAt },
        opts.now,
      );
    }
    return { state: "notComputed", line2, refreshing };
  }
  const s = badge.status.status;
  if (s === "warning") return { state: "changed", count, line2: breakdown, srReason: breakdown, refreshing };
  if (s === "ok") return { state: "none", line2: "", refreshing };
  if (s === "critical" && !warnedCritical) {
    // 드리프트에는 critical 이 없다(status.md 10.1). 알 수 없음으로 그린다
    warnedCritical = true;
    console.warn("[k8s-snapshots] 드리프트 배지에 critical 이 왔습니다. unknown 으로 표시합니다.");
  }
  const text = badge.status.reasons[0]?.text ?? "";
  const short = (code && DRIFT_REASON_SHORT[code]) || text;
  return { state: "unknown", line2: short, srReason: short, refreshing };
}

/** 계산 버튼 비활성 사유 (가능하면 undefined) */
export function computeBlockReason(ability: { allowed: boolean; reasonCode: string | null; reasonText: string | null } | null | undefined): string | undefined {
  if (!ability || ability.allowed) return undefined;
  return ability.reasonText ?? (ability.reasonCode ? DRIFT_BUTTON_REASON[ability.reasonCode] : undefined) ?? "지금은 계산할 수 없습니다";
}

// ---------------------------------------------------------------- 목록 필터·정렬 (디자인 3.3, URL 값 = API 값)

export const STATUS_KEYS = ["critical", "warning", "unknown", "ok"] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];
export const STATUS_KEY_LABEL: Record<StatusKey, string> = { critical: "커밋 금지", warning: "주의", unknown: "알 수 없음", ok: "정상" };

export const DRIFT_KEYS: readonly DriftFacetKey[] = ["warning", "unknown", "ok", "not_computed"];
export const DRIFT_KEY_LABEL: Record<DriftFacetKey, string> = {
  warning: "차이 있음",
  unknown: "알 수 없음",
  ok: "차이 없음",
  not_computed: "계산 안 함",
};

export const CLUSTER_KEYS: readonly ClusterRelation[] = ["same", "other", "unknown"];

export function clusterFilterLabel(key: ClusterRelation, dashboardName?: string | null): string {
  if (key === "same") return dashboardName ? `연결된 클러스터 (${dashboardName})` : "연결된 클러스터";
  if (key === "other") return "다른 클러스터";
  return "확인할 수 없음";
}

/** 쉼표 목록 → 허용된 값만(순서는 허용 목록 순) */
export function parseCsv<T extends string>(v: string | null | undefined, allowed: readonly T[]): T[] {
  if (!v) return [];
  const set = new Set(v.split(",").map((s) => s.trim()));
  return allowed.filter((k) => set.has(k));
}

export type K8sSortColumn = "status" | "snapshot";
export interface K8sSort {
  columnId: K8sSortColumn;
  dir: "asc" | "desc";
}
export const DEFAULT_K8S_SORT: K8sSort = { columnId: "snapshot", dir: "desc" };

/** URL `sort` = API 값 (`snapshotAt:desc` | `snapshotAt:asc` | `status:desc` | `status:asc`) */
export function parseK8sSort(v: string | null | undefined): K8sSort {
  if (!v) return DEFAULT_K8S_SORT;
  const [col, dir] = v.split(":");
  if ((dir === "asc" || dir === "desc") && (col === "snapshotAt" || col === "status")) {
    return { columnId: col === "snapshotAt" ? "snapshot" : "status", dir };
  }
  return DEFAULT_K8S_SORT;
}

export function apiSortValue(s: K8sSort): string {
  return `${s.columnId === "snapshot" ? "snapshotAt" : "status"}:${s.dir}`;
}

/** URL 에 둘 값 (기본값이면 null) */
export function k8sSortParam(s: K8sSort | null): string | null {
  if (!s || (s.columnId === DEFAULT_K8S_SORT.columnId && s.dir === DEFAULT_K8S_SORT.dir)) return null;
  return apiSortValue(s);
}

// ---------------------------------------------------------------- 행 표시

export function clusterLabel(c: Pick<K8sSnapshotCluster, "name" | "context"> | null | undefined): string {
  if (!c) return "—";
  return c.name ?? c.context ?? "—";
}

export function clusterTooltip(c: K8sSnapshotCluster | null | undefined): string {
  if (!c) return "클러스터 정보 없음";
  return [c.name ? `이름 ${c.name}` : null, c.context ? `컨텍스트 ${c.context}` : null, c.serverVersion].filter(Boolean).join(" · ");
}

export function relationText(r: ClusterRelation | null | undefined): string {
  if (r === "same") return "연결된 클러스터";
  if (r === "other") return "다른 클러스터";
  return "확인할 수 없음";
}

export function scopeCountsText(scope: K8sSnapshotScope | null | undefined): string {
  if (!scope) return "—";
  return `네임스페이스 ${formatCount(scope.namespaces.length)} · 종류 ${formatCount(scope.kindCount)}`;
}

/** 범위 규칙 요약: `시스템 제외 전체` / `포함 app, data` / `제외 설정` (+ ` · 시스템 포함`) */
export function scopeRuleText(scope: K8sSnapshotScope | null | undefined, full = false): string {
  if (!scope) return "—";
  const list = (xs: string[]) => (full || xs.length <= 3 ? xs.join(", ") : `${xs.slice(0, 3).join(", ")} 외 ${xs.length - 3}개`);
  let base: string;
  if (scope.namespaceMode === "include") base = `포함 ${list(scope.namespaces)}`;
  else if (scope.namespaceMode === "exclude") {
    // 디자인 3.4: 제외 목록이 있으면 `제외 batch`, 없을 때만 `일부 제외 · 내보냄 …`
    const ex = scope.excludeNamespaces ?? [];
    base = ex.length > 0 ? `제외 ${list(ex)}` : `일부 제외 · 내보냄 ${list(scope.namespaces)}`;
  }
  else base = "시스템 제외 전체";
  return scope.systemIncluded.length > 0 ? `${base} · 시스템 포함` : base;
}

/** 범위 툴팁: 전체 문구. exclude 인데 제외 목록이 없으면 디자인 3.4 임시 문구 툴팁 */
export function scopeRuleTooltip(scope: K8sSnapshotScope | null | undefined): string {
  if (scope && scope.namespaceMode === "exclude" && (scope.excludeNamespaces ?? []).length === 0) {
    return `네임스페이스 제외 규칙 사용 · 내보낸 네임스페이스: ${scope.namespaces.join(", ")} (제외 목록은 상세 메타데이터 탭)`;
  }
  return scopeRuleText(scope, true);
}

/** `+5`, `−18`(U+2212), `0`, 없으면 `-` */
export function signedDelta(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  if (n === 0) return "0";
  return n > 0 ? `+${formatCount(n)}` : `${MINUS}${formatCount(Math.abs(n))}`;
}

export function writeBlockBannerK8s(w: WriteAbility | null | undefined): { title: string; description: string } | null {
  if (!w || w.allowed) return null;
  if (w.reasonCode === "READ_ONLY") {
    return {
      title: "스냅샷 폴더가 읽기 전용입니다",
      description: "목록과 내용은 볼 수 있지만 편집·라벨·삭제는 할 수 없습니다. 쓰려면 deploy/k8s-snapshot/snapshots 폴더를 쓰기 가능하게 마운트하세요.",
    };
  }
  if (w.reasonCode === "WRITE_DISABLED") {
    return { title: "쓰기 기능이 꺼져 있습니다", description: "설정에서 쓰기 기능을 꺼 두어 보기만 할 수 있습니다. (K8S_SNAPSHOT_WRITE_ENABLED)" };
  }
  return null;
}

/** 부분 내보내기 종류 결과 문구 */
export const KIND_RESULT_LABEL: Record<string, string> = { forbidden: "권한 없음", not_found: "API 없음", error: "오류", ok: "내보냄" };

export const KIND_DRIFT_TEXT: Record<KindDriftFlag, string> = {
  comparable: "비교함",
  not_in_rbac: "비교 불가",
  forbidden: "권한 거부",
  api_version_mismatch: "API 버전 다름",
};

export const KIND_DRIFT_TOOLTIP: Record<Exclude<KindDriftFlag, "comparable">, string> = {
  not_in_rbac: "드리프트 비교 불가 (대시보드 권한 밖)",
  forbidden: "드리프트 비교 불가 (권한 거부)",
  api_version_mismatch: "드리프트 비교 불가 (API 버전 다름)",
};

// ---------------------------------------------------------------- 파일·트리 (디자인 5.2)

export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const identityText = (r: { kind: string | null; namespace: string | null; name: string } | null | undefined) =>
  r ? `${r.kind ?? "?"} ${r.namespace ? `${r.namespace}/` : ""}${r.name}` : "—";

/** 파일 문제 표시 문구 (트리 `file-warning` 툴팁). 없으면 undefined */
export function fileIssueText(f: K8sFileInfo): string | undefined {
  const parts: string[] = [];
  if (f.parse === "yaml_error" || f.parse === "not_object" || f.parse === "empty" || f.parse === "too_large") parts.push("YAML 해석 실패");
  if (f.parse === "multi_document") parts.push("한 파일에 여러 리소스");
  if (!f.pathMatches && (f.fileType === "resource" || f.fileType === "namespace")) {
    parts.push(f.resource ? `경로와 내용 불일치 (내용: ${identityText(f.resource)})` : "경로와 내용 불일치");
  }
  if (f.duplicate) parts.push("중복 정의");
  if (f.runtimeFields.length > 0) parts.push(`런타임 필드 남음 (${f.runtimeFields.slice(0, 3).join(", ")})`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export type TreeFilter = "all" | "scan" | "issues" | "drift" | "helm";
export const TREE_FILTER_LABEL: Record<TreeFilter, string> = {
  all: "전체",
  scan: "스캔 발견 있음",
  issues: "파일 문제 있음",
  drift: "드리프트 차이 있음",
  helm: "Helm 관리",
};

export function matchesTreeFilter(f: K8sFileInfo, filter: TreeFilter): boolean {
  switch (filter) {
    case "scan":
      return f.findings.errors + f.findings.warnings > 0;
    case "issues":
      return fileIssueText(f) !== undefined;
    case "drift":
      return f.drift === "changed" || f.drift === "deleted";
    case "helm":
      return f.helmManaged;
    default:
      return true;
  }
}

function leafFor(f: K8sFileInfo | undefined, path: string, dirtyPath: string | null): TreeNode {
  const total = f ? f.findings.errors + f.findings.warnings : 0;
  const label = f?.resource?.name ?? basename(path).replace(/\.ya?ml$/, "");
  return {
    id: path,
    kind: "file",
    label: f?.fileType === "namespace" || f?.fileType === "metadata" || f?.fileType === "secret_refs" ? basename(path) : label,
    tooltip: path,
    markers: {
      scan: f && total > 0 ? { level: f.findings.errors > 0 ? "error" : "warn", count: total } : undefined,
      fileIssue: f ? fileIssueText(f) : undefined,
      drift: f && (f.drift === "changed" || f.drift === "deleted") ? { kind: f.drift } : undefined,
      helm: f?.helmManaged || undefined,
      dirty: dirtyPath === path || undefined,
    },
  };
}

export interface FileTreeResult {
  nodes: TreeNode[];
  /** 필터 전 리소스 파일 수 */
  resourceCount: number;
  namespaceCount: number;
  kindCount: number;
  /** 필터 적용 후 잎 수 */
  shown: number;
  counts: Record<TreeFilter, number>;
}

/**
 * 파일 탭 트리 (디자인 5.2): 스냅샷 파일 → 네임스페이스(서버 순서) → 클러스터 범위 → 예상 밖 파일.
 * 노드 순서는 서버 `tree` 그대로, 잎 정보는 `files[]`(경로 키). 트리는 다시 정렬하지 않는다.
 */
export function buildFileTree(
  d: Pick<K8sSnapshotDetailData, "files" | "tree" | "extraFiles">,
  opts: { filter?: TreeFilter; dirtyPath?: string | null; systemChip?: ReactNode } = {},
): FileTreeResult {
  const filter = opts.filter ?? "all";
  const dirty = opts.dirtyPath ?? null;
  const byPath = new Map(d.files.map((f) => [f.path, f]));
  const ok = (path: string) => {
    const f = byPath.get(path);
    return filter === "all" || (f !== undefined && matchesTreeFilter(f, filter));
  };
  const counts: Record<TreeFilter, number> = { all: 0, scan: 0, issues: 0, drift: 0, helm: 0 };
  for (const f of d.files) {
    counts.all += 1;
    for (const k of ["scan", "issues", "drift", "helm"] as const) if (matchesTreeFilter(f, k)) counts[k] += 1;
  }

  const nodes: TreeNode[] = [];
  const snapFiles = d.files.filter((f) => f.fileType === "metadata" || f.fileType === "secret_refs").filter((f) => ok(f.path));
  if (snapFiles.length > 0) {
    nodes.push({
      id: "g:snapshot-files",
      kind: "group",
      label: "스냅샷 파일",
      icon: "archive",
      defaultCollapsed: true,
      children: snapFiles.map((f) => leafFor(f, f.path, dirty)),
    });
  }

  let resourceCount = 0;
  let namespaceCount = 0;
  const kindSet = new Set<string>();
  const kindNode = (nsKey: string, k: K8sSnapshotDetailData["tree"][number]["kinds"][number]): TreeNode | null => {
    resourceCount += k.paths.length;
    kindSet.add(k.kindDir);
    const children = k.paths.filter(ok).map((p) => leafFor(byPath.get(p), p, dirty));
    if (children.length === 0) return null;
    return {
      id: `k:${nsKey}:${k.kindDir}`,
      kind: "resourceKind",
      label: k.kind,
      mono: k.kindDir.includes("."),
      count: k.count,
      markers: k.drift !== "comparable" ? { notComparable: KIND_DRIFT_TOOLTIP[k.drift] } : undefined,
      children,
    };
  };

  let clusterNode: TreeNode | null = null;
  for (const ns of d.tree) {
    if (ns.namespace === null) {
      const kinds = ns.kinds.map((k) => kindNode("_cluster", k)).filter((x): x is TreeNode => x !== null);
      if (kinds.length > 0) clusterNode = { id: "g:cluster", kind: "group", label: "클러스터 범위", icon: "globe", count: ns.count, children: kinds };
      continue;
    }
    namespaceCount += 1;
    if (ns.namespaceFile) resourceCount += 1;
    const children: TreeNode[] = [];
    if (ns.namespaceFile && ok(ns.namespaceFile)) children.push(leafFor(byPath.get(ns.namespaceFile), ns.namespaceFile, dirty));
    for (const k of ns.kinds) {
      const kn = kindNode(ns.namespace, k);
      if (kn) children.push(kn);
    }
    if (children.length === 0) continue;
    nodes.push({
      id: `ns:${ns.namespace}`,
      kind: "namespace",
      label: ns.namespace,
      mono: true,
      count: ns.count,
      chips: ns.system ? opts.systemChip : undefined,
      children,
    });
  }
  if (clusterNode) nodes.push(clusterNode);

  if (d.extraFiles.length > 0 && filter === "all") {
    nodes.push({
      id: "g:extra",
      kind: "group",
      label: "예상 밖 파일",
      icon: "file-question",
      iconTone: "warn",
      count: d.extraFiles.length,
      defaultCollapsed: true,
      children: d.extraFiles.map((e) => ({
        id: `x:${e.name}`,
        kind: "file" as const,
        label: e.name,
        tooltip: e.name,
        disabled: true,
        disabledReason: "대시보드는 이 파일을 열거나 고치지 않습니다",
      })),
    });
  }

  const shown = countFileLeaves(nodes);
  return { nodes, resourceCount, namespaceCount, kindCount: kindSet.size, shown, counts };
}

function countFileLeaves(nodes: TreeNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.id === "g:extra" || node.id === "g:snapshot-files") continue;
    if (!node.children || node.children.length === 0) n += node.kind === "file" ? 1 : 0;
    else n += countFileLeaves(node.children);
  }
  return n;
}

/** 파일 머리 경로 조각 `app / statefulsets / postgres.yaml` */
export const pathSegments = (path: string) => path.split("/");

/** 파일 머리 복사 값: 저장소 기준 경로 */
export function repoPath(displayPath: string | null | undefined, id: string, path: string): string {
  return `${displayPath ?? DEFAULT_DISPLAY_PATH}/${id}/${path}`;
}

// ---------------------------------------------------------------- 스캔 발견 (디자인 5.3)

export function k8sFindingId(f: K8sScanFinding, index: number): string {
  return `${f.file}:${f.line}:${f.rule}:${index}`;
}

/** 발견 → ScanFindingList 항목. 이동은 상세 `files[]`에 있는 파일만 */
export function toK8sScanFindings(findings: K8sScanFinding[], knownPaths: ReadonlySet<string>): ScanFinding[] {
  return findings.map((f, i) => {
    const navigable = knownPaths.has(f.file);
    let hint: string | undefined;
    if (!navigable) {
      if (f.fileType === "notes") hint = "라벨·메모 파일입니다. 라벨·메모 편집에서 고치세요";
      else hint = "대시보드에서 열 수 없는 파일입니다. 편집기로 여세요";
    } else if (f.fileType === "metadata" || f.fileType === "secret_refs") {
      hint = "CLI가 기록한 파일이라 대시보드에서 편집하지 않습니다. JSON은 주석을 달 수 없으니 값을 지우세요";
    }
    return {
      id: k8sFindingId(f, i),
      level: f.severity,
      file: f.file,
      line: f.line,
      ruleId: f.rule,
      description: f.message,
      navigable,
      hint,
    };
  });
}

export function markersForPath(findings: K8sScanFinding[], path: string): CodeEditorMarker[] {
  const byLine = new Map<number, CodeEditorMarker>();
  for (const f of findings) {
    if (f.file !== path) continue;
    const m = byLine.get(f.line) ?? { line: f.line, level: f.severity, items: [] };
    m.items.push({ ruleId: f.rule, description: f.message });
    if (f.severity === "error") m.level = "error";
    byLine.set(f.line, m);
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------- 상세 탭 (디자인 4.5)

export type DetailView = "files" | "drift" | "3d" | "counts" | "secrets" | "meta";
export const DETAIL_VIEWS: readonly DetailView[] = ["files", "drift", "3d", "counts", "secrets", "meta"];
export const parseView = (v: string | null | undefined): DetailView => (DETAIL_VIEWS as readonly string[]).includes(v ?? "") ? (v as DetailView) : "files";

export function detailTabs(d: K8sSnapshotDetailData, drift: DriftBadge | null, dirty: boolean): TabItem[] {
  const findings = d.scan.current.findings;
  const worst = worstScanLevel(findings.map((f) => f.severity));
  const files: TabItem = { id: "files", label: "파일", dirty };
  if (findings.length > 0) {
    files.count = findings.length;
    files.countLabel = "발견";
    files.status = worst?.status ?? "unknown";
  }
  const driftTab: TabItem = { id: "drift", label: "드리프트" };
  if (drift && drift.status.status === "warning" && !drift.status.stale && driftCode(drift) !== "DRIFT_NOT_COMPUTED") {
    const n = driftDiffCount(drift);
    if (n > 0) {
      driftTab.count = n;
      driftTab.countLabel = "차이";
    }
  }
  const secrets: TabItem = { id: "secrets", label: "Secret 참조" };
  if (d.secretRefs.state === "ok") secrets.count = d.secretRefs.count;
  const meta: TabItem = { id: "meta", label: "메타데이터" };
  const codes = new Set(d.status.reasons.map((r) => r.code));
  const metaStatus: Status | undefined = codes.has("METADATA_CORRUPT")
    ? "crit"
    : codes.has("METADATA_MISSING") || codes.has("METADATA_SCHEMA_MISMATCH") || codes.has("PARTIAL_EXPORT") || d.notices.some((n) => n.code === "MISSING_NAMESPACES")
      ? "warn"
      : undefined;
  if (metaStatus) meta.status = metaStatus;
  // 3D 보기: 숫자·상태 아이콘을 두지 않는다 (디자인 2.1 — 같은 숫자가 파일·드리프트 탭에 이미 있다)
  return [files, driftTab, { id: "3d", label: "3D 보기" }, { id: "counts", label: "리소스 수" }, secrets, meta];
}

// ---------------------------------------------------------------- 드리프트 탭 (디자인 6.4·6.3)

export type DriftListKind = "all" | "changed" | "deleted" | "added";
export const parseDriftKind = (v: string | null | undefined): DriftListKind =>
  v === "changed" || v === "deleted" || v === "added" ? v : "all";

export function hiddenCount(r: DriftResource): number {
  return r.counts.default + r.counts.managed;
}

/** 목록에 보일 리소스 (구분 필터 + 숨긴 차이 스위치). 서버 순서 유지 */
export function visibleDriftResources(resources: DriftResource[], kind: DriftListKind, showHidden: boolean): DriftResource[] {
  return resources.filter((r) => {
    if (r.change === "same") return showHidden && kind === "all";
    return kind === "all" || r.change === kind;
  });
}

const DRIFT_SECONDARY: Record<Exclude<DriftResource["change"], "same">, (r: DriftResource) => string> = {
  changed: (r) => `필드 ${formatCount(r.counts.changed)}`,
  deleted: () => "삭제됨",
  added: () => "추가됨",
};

/** 드리프트 리소스 목록 트리 (디자인 6.4): 네임스페이스 → 종류 → 리소스, 서버 순서 그대로 묶는다 */
export function buildDriftTree(resources: DriftResource[]): TreeNode[] {
  const nsOrder: string[] = [];
  const byNs = new Map<string, { kinds: string[]; byKind: Map<string, DriftResource[]> }>();
  for (const r of resources) {
    const ns = r.namespace ?? "";
    let g = byNs.get(ns);
    if (!g) {
      g = { kinds: [], byKind: new Map() };
      byNs.set(ns, g);
      nsOrder.push(ns);
    }
    let list = g.byKind.get(r.kind);
    if (!list) {
      list = [];
      g.byKind.set(r.kind, list);
      g.kinds.push(r.kind);
    }
    list.push(r);
  }
  return nsOrder.map((ns) => {
    const g = byNs.get(ns)!;
    return {
      id: `dns:${ns || "_cluster"}`,
      kind: ns ? ("namespace" as const) : ("group" as const),
      label: ns || "클러스터 범위",
      icon: ns ? undefined : ("globe" as const),
      mono: Boolean(ns),
      children: g.kinds.map((k) => ({
        id: `dk:${ns || "_cluster"}:${k}`,
        kind: "resourceKind" as const,
        label: k,
        children: g.byKind.get(k)!.map((r) => ({
          id: r.key,
          kind: "file" as const,
          label: r.name,
          tooltip: r.file ?? `${r.namespace ? `${r.namespace}/` : ""}${r.name}`,
          secondary: r.change === "same" ? undefined : DRIFT_SECONDARY[r.change](r),
          markers: {
            drift: { kind: r.change as DriftKind, detail: r.change === "changed" ? `필드 ${formatCount(r.counts.changed)}건` : undefined },
            hiddenOnly: r.change === "same" ? hiddenCount(r) : undefined,
            helm: r.helmManaged || undefined,
          },
        })),
      })),
    };
  });
}

/** 파일 문제로 비교 못 함 요약 (6.3 ⑤ⓐ): `파일 문제로 비교 못 함 3개 (해석 실패 2 · 중복 정의 1)` */
export function unparsableText(list: DriftResponse["unparsable"]): string | null {
  if (list.length === 0) return null;
  const c = { parse: 0, dup: 0, ns: 0, other: 0 };
  for (const u of list) {
    if (u.reason === "yaml_error" || u.reason === "too_large") c.parse += 1;
    else if (u.reason === "duplicate") c.dup += 1;
    else if (u.reason === "namespace_missing") c.ns += 1;
    else c.other += 1;
  }
  const parts = [
    c.parse ? `해석 실패 ${c.parse}` : "",
    c.dup ? `중복 정의 ${c.dup}` : "",
    c.ns ? `네임스페이스 없음 ${c.ns}` : "",
    c.other ? `그 밖 ${c.other}` : "",
  ].filter(Boolean);
  return `파일 문제로 비교 못 함 ${formatCount(list.length)}개 (${parts.join(" · ")})`;
}

/** `Deployment · apps/v1` (apiVersion 없으면 apiGroup, 코어는 core) */
export function kindVersionText(r: Pick<DriftResource, "kind" | "apiVersion" | "apiGroup">): string {
  return `${r.kind} · ${r.apiVersion ?? (r.apiGroup || "core")}`;
}

// ---------------------------------------------------------------- Secret 참조 (디자인 8절)

export const VIA_LABEL: Record<SecretVia, string> = {
  "env.valueFrom.secretKeyRef": "env 키 참조",
  "envFrom.secretRef": "envFrom",
  "volumes.secret": "볼륨",
  "volumes.projected.secret": "projected 볼륨",
  "volumes.csi.nodePublishSecretRef": "CSI 볼륨",
  imagePullSecrets: "이미지 pull",
  "serviceAccount.imagePullSecrets": "SA 이미지 pull",
  "ingress.tls": "Ingress TLS",
};

export const viaLabel = (via: string): { text: string; known: boolean } =>
  via in VIA_LABEL ? { text: VIA_LABEL[via as SecretVia], known: true } : { text: via, known: false };
