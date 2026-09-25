/**
 * aws-snapshot-manager 화면 도우미 (순수 함수, 테스트 대상).
 * 상태·스캔·리소스 수는 서버 값을 그대로 쓰고 다시 계산하지 않는다(명세 3.3, common.md 2.2).
 * 여기서는 표시 문구·필터·정렬·편집기 입력 모양만 만든다.
 */
import {
  formatCount,
  formatFullTime,
  MINUS,
  statusFromApi,
  STATUS_ORDER,
  worstScanLevel,
  type CodeEditorMarker,
  type ScanFinding,
  type Status,
  type StatusAltLabel,
  type TabItem,
} from "@/components/ui";

import type { ApiErrorBody } from "../common/types";
import type {
  CliGuideText,
  EditableKind,
  ExtraFile,
  FileKind,
  ResourceCounts,
  ScanFindingApi,
  SnapshotDetailData,
  SnapshotFileInfo,
  SnapshotListItem,
  SnapshotScope,
  SnapshotSummary,
  WriteAbility,
} from "./types";

/** 스냅샷 ID 형식 (계약 1.1). 형식이 아니면 요청하지 않는다. */
export const SNAPSHOT_ID_RE = /^\d{8}-\d{6}$/;
export const isSnapshotId = (v: string): boolean => SNAPSHOT_ID_RE.test(v);

export const EDITABLE_KINDS: readonly EditableKind[] = ["cloudformation", "terraform"];
export const isEditableKind = (k: string): k is EditableKind => k === "cloudformation" || k === "terraform";

/** 편집기 탭 (명세 3.2 E: 템플릿 2개 + 매핑 보기 전용). metadata 는 메타데이터 섹션 원문 보기로 */
export const TAB_KINDS: readonly FileKind[] = ["cloudformation", "terraform", "mapping"];

export const FILE_NAME: Record<FileKind, string> = {
  cloudformation: "cloudformation.yml",
  terraform: "terraform.tf",
  mapping: "logical-id-mapping.json",
  metadata: "metadata.json",
};

/** CLI 안내 기본 문구 (계약 6.2 `cli`와 같은 값. 목록 응답이 오기 전 상세 화면에서만 쓴다) */
export const DEFAULT_CLI: CliGuideText = {
  install: "npm install --prefix deploy/aws-snapshot",
  configure: "deploy/aws-snapshot/.env.example 을 .env 로 복사한 뒤 값을 채우세요",
  dryRun: "npm run export:dry --prefix deploy/aws-snapshot",
  export: "npm run export --prefix deploy/aws-snapshot",
  scan: "npm run scan --prefix deploy/aws-snapshot -- snapshots/<id>",
  readme: "deploy/aws-snapshot/README.md",
};

export function scanCommandFor(cli: CliGuideText, id: string): string {
  return cli.scan.replace("<id>", id);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 스냅샷 시각 (status.md 9.4): 로컬 시각, 오늘이어도 날짜를 붙인다. `9월 19일 12:15`, 올해가 아니면 `2025년 9월 18일 12:15`.
 * snapshotAt 이 없으면(달력에 없는 날짜) ID 를 그대로.
 */
export function snapshotTimeLabel(iso: string | null | undefined, fallback: string, now: number | Date = Date.now()): string {
  if (!iso) return fallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

/** 시각 툴팁 두 줄: `2026-09-19 12:15:00 (KST)` / `UTC 폴더 이름 20260919-031500` */
export function snapshotTimeTooltip(iso: string | null | undefined, id: string): [string, string] {
  return [iso ? formatFullTime(iso) : "시각을 해석할 수 없음", `UTC 폴더 이름 ${id}`];
}

/** 상태 → 배지 문구 대체: crit 만 `커밋 금지` (status.md 9.1) */
export function snapshotStatusLabel(status: Status | undefined): StatusAltLabel | undefined {
  return status === "crit" ? "커밋 금지" : undefined;
}

/** 목록 필터 상태 키 (URL `?status=crit,warn`) */
export const STATUS_FILTER_KEYS = ["crit", "warn", "unknown", "ok"] as const;
export type StatusFilterKey = (typeof STATUS_FILTER_KEYS)[number];
export const STATUS_FILTER_LABEL: Record<StatusFilterKey, string> = {
  crit: "커밋 금지",
  warn: "주의",
  unknown: "알 수 없음",
  ok: "정상",
};

export function parseStatusParam(v: string | null | undefined): StatusFilterKey[] {
  if (!v) return [];
  const set = new Set(v.split(",").map((s) => s.trim()));
  return STATUS_FILTER_KEYS.filter((k) => set.has(k));
}

export function parseListParam(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ListFilters {
  status: StatusFilterKey[];
  regions: string[];
  q: string;
}

/** 라벨·메모 부분 일치, 대소문자 무시 (명세 3.1). 계약 6.2 `q`처럼 ID 부분 일치도 포함 */
export function matchesQuery(item: Pick<SnapshotListItem, "id" | "label" | "memo">, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [item.label, item.memo, item.id].some((v) => v !== null && v.toLocaleLowerCase().includes(needle));
}

export function filterItems(items: SnapshotListItem[], f: ListFilters): SnapshotListItem[] {
  return items.filter(
    (it) =>
      (f.status.length === 0 || f.status.includes(statusFromApi(it.status.status) as StatusFilterKey)) &&
      (f.regions.length === 0 || (it.region !== null && f.regions.includes(it.region))) &&
      matchesQuery(it, f.q),
  );
}

export type ListSortColumn = "status" | "snapshot";
export interface ListSort {
  columnId: ListSortColumn;
  dir: "asc" | "desc";
}
/** 기본: 스냅샷 시각 최신순 */
export const DEFAULT_SORT: ListSort = { columnId: "snapshot", dir: "desc" };

export function parseSortParam(v: string | null | undefined): ListSort {
  if (!v) return DEFAULT_SORT;
  const [col, dir] = v.split(":");
  if ((col === "status" || col === "snapshot") && (dir === "asc" || dir === "desc")) return { columnId: col, dir };
  return DEFAULT_SORT;
}

export function sortParam(s: ListSort | null): string | null {
  if (!s || (s.columnId === DEFAULT_SORT.columnId && s.dir === DEFAULT_SORT.dir)) return null;
  return `${s.columnId}:${s.dir}`;
}

/** 폴더 이름(UTC)은 사전순 = 시각순 */
const byIdDesc = (a: SnapshotListItem, b: SnapshotListItem) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * 정렬 (디자인 3.4): 상태 = 나쁜 순(crit → warn → unknown → stale → ok) 다음 최신순, 시각 = 최신순(기본).
 * stale 은 배지 표시일 뿐 정렬은 서버 상태로 한다.
 */
export function sortItems(items: SnapshotListItem[], sort: ListSort): SnapshotListItem[] {
  const rank = (it: SnapshotListItem) => STATUS_ORDER.indexOf(statusFromApi(it.status.status));
  const out = [...items];
  if (sort.columnId === "status") {
    out.sort((a, b) => {
      const d = rank(a) - rank(b);
      if (d !== 0) return sort.dir === "desc" ? d : -d;
      return byIdDesc(a, b);
    });
  } else {
    out.sort((a, b) => (sort.dir === "desc" ? byIdDesc(a, b) : -byIdDesc(a, b)));
  }
  return out;
}

/** 상태별 개수 (필터 옵션용. 표시만, 판단 아님) */
export function countByStatusKey(items: SnapshotListItem[]): Record<StatusFilterKey, number> {
  const out: Record<StatusFilterKey, number> = { crit: 0, warn: 0, unknown: 0, ok: 0 };
  for (const it of items) out[statusFromApi(it.status.status) as StatusFilterKey] += 1;
  return out;
}

export function countByRegion(items: SnapshotListItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) if (it.region) out[it.region] = (out[it.region] ?? 0) + 1;
  return out;
}

/** 서비스 목록 줄임: 앞 3개 + `외 N개` */
export function shortList(list: string[], keep = 3): string {
  if (list.length <= keep) return list.join(", ");
  return `${list.slice(0, keep).join(", ")} 외 ${list.length - keep}개`;
}

/** 범위 요약 (명세 3.1): `필터 prod.k8s.example.com · 제외 SecretsManager, SSM, Lambda` / `필터 없음 · 포함 EKS, EC2, VPC 외 2개` */
export function scopeSummary(scope: SnapshotScope | null, full = false): string {
  if (!scope) return "—";
  const parts: string[] = [];
  if (scope.searchFilter) parts.push(`필터 ${scope.searchFilter}`);
  if (scope.regexFilter) parts.push(`정규식 ${scope.regexFilter}`);
  if (!scope.searchFilter && !scope.regexFilter) parts.push("필터 없음");
  if (scope.services && scope.services.list.length > 0) {
    const verb = scope.services.mode === "include" ? "포함" : "제외";
    parts.push(`${verb} ${full ? scope.services.list.join(", ") : shortList(scope.services.list)}`);
  }
  return parts.join(" · ");
}

const numOrDash = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatCount(n));

/** `42 / 40` (CFN / TF), 없으면 `—` */
export function countsPair(c: ResourceCounts | null | undefined): string {
  if (!c) return "— / —";
  return `${numOrDash(c.cloudformation)} / ${numOrDash(c.terraform)}`;
}

/** 부호 있는 증감: `+5`, `−18`(U+2212), `0` */
export function signed(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "0";
  return n > 0 ? `+${formatCount(n)}` : `${MINUS}${formatCount(Math.abs(n))}`;
}

/** 직전 대비 (디자인 3.4): 이전 스냅샷 없으면 `-` */
export function deltaPair(delta: ResourceCounts | null | undefined): string {
  if (!delta) return "-";
  return `${signed(delta.cloudformation)} / ${signed(delta.terraform)}`;
}

/** 파일 크기 (1024 기준): `512 B`, `48.2 KB`, `7.4 MB` */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${formatCount(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const s = v >= 100 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "");
  return `${s} ${units[i]}`;
}

export const EOL_LABEL: Record<string, string> = { lf: "LF", crlf: "CRLF", mixed: "LF/CRLF 섞임", none: "줄바꿈 없음" };

/** 편집기 들여쓰기 단위 (계약 6.3 `indent`, 모르면 공백 2칸) */
export function indentUnitOf(indent: SnapshotFileInfo["indent"] | undefined): string {
  if (!indent) return "  ";
  if (indent.style === "tabs") return "\t";
  return " ".repeat(indent.size ?? 2);
}

/** 발견 → ScanFindingList 항목. 이동은 편집기 탭이 있는 파일만(템플릿 2개 + 매핑) */
export function toScanFindings(findings: ScanFindingApi[]): ScanFinding[] {
  return findings.map((f, i) => {
    const navigable = f.fileKind === "cloudformation" || f.fileKind === "terraform" || f.fileKind === "mapping";
    let hint: string | undefined;
    if (!navigable) {
      if (f.fileKind === "metadata") hint = "metadata.json은 대시보드에서 편집할 수 없습니다. JSON은 주석을 달 수 없으니 값을 지우세요";
      else if (f.fileKind === "notes") hint = "라벨·메모 파일입니다. 라벨·메모 편집에서 고치세요";
      else hint = "대시보드에서 열 수 없는 파일입니다. 편집기로 여세요";
    }
    return {
      id: findingId(f, i),
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

export function findingId(f: ScanFindingApi, index: number): string {
  return `${f.file}:${f.line}:${f.rule}:${index}`;
}

/** 편집기 여백 표시 (마지막 저장 기준 줄 번호) */
export function markersFor(findings: ScanFindingApi[], kind: FileKind): CodeEditorMarker[] {
  const byLine = new Map<number, CodeEditorMarker>();
  for (const f of findings) {
    if (f.fileKind !== kind) continue;
    const m = byLine.get(f.line) ?? { line: f.line, level: f.severity, items: [] };
    m.items.push({ ruleId: f.rule, description: f.message });
    if (f.severity === "error") m.level = "error";
    byLine.set(f.line, m);
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

/** 파일 탭 (디자인 5.2): 발견 최악 등급 아이콘 + 개수, 파일 없음, 보기 전용, 저장 안 됨 */
export function fileTabs(files: SnapshotFileInfo[], findings: ScanFindingApi[], dirtyKind: FileKind | null): TabItem[] {
  return TAB_KINDS.map((kind) => {
    const file = files.find((f) => f.kind === kind);
    const own = findings.filter((f) => f.fileKind === kind);
    const worst = worstScanLevel(own.map((f) => f.severity));
    const missing = !file || !file.exists;
    const item: TabItem = {
      id: kind,
      label: file?.name ?? FILE_NAME[kind],
      mono: true,
      dirty: dirtyKind === kind,
    };
    if (own.length > 0) {
      item.count = own.length;
      item.countLabel = "발견";
      item.status = worst?.status ?? "unknown";
    }
    if (missing) {
      item.suffix = "파일 없음";
      item.suffixIcon = "file-x";
      item.suffixTone = "crit";
    } else if (kind === "mapping") {
      item.suffix = "보기 전용";
    }
    return item;
  });
}

/** 툴바 파일 정보: `1,284줄 · 48.2 KB · 수정 9월 19일 12:40 · LF · UTF-8` */
export function fileInfoParts(
  file: Pick<SnapshotFileInfo, "lineCount" | "sizeBytes" | "modifiedAt" | "eol" | "encoding">,
  now: number | Date = Date.now(),
): string[] {
  const parts: string[] = [];
  if (file.lineCount !== null && file.lineCount !== undefined) parts.push(`${formatCount(file.lineCount)}줄`);
  if (file.sizeBytes !== null && file.sizeBytes !== undefined) parts.push(formatSize(file.sizeBytes));
  if (file.modifiedAt) parts.push(`수정 ${snapshotTimeLabel(file.modifiedAt, "—", now)}`);
  if (file.eol) parts.push(EOL_LABEL[file.eol] ?? file.eol);
  if (file.encoding) parts.push(file.encoding === "utf-8" ? "UTF-8" : "인코딩 알 수 없음");
  return parts;
}

/** 재스캔 문구 (디자인 5.6): `재스캔: 오류 2 → 0, 경고 1 → 0` */
export function rescanText(before: { errors: number; warnings: number }, after: { errors: number; warnings: number }): string {
  return `재스캔: 오류 ${formatCount(before.errors)} → ${formatCount(after.errors)}, 경고 ${formatCount(before.warnings)} → ${formatCount(after.warnings)}`;
}

/** 저장 결과 알림 (디자인 5.6 표). 저장 후 스냅샷 현재 스캔 기준 */
export function saveResultView(scan: { errors: number; warnings: number; strict: boolean }): { tone: "ok" | "warn" | "crit"; title: string } {
  if (scan.errors > 0) {
    return { tone: "crit", title: `저장했습니다 · 비밀값 의심 ${formatCount(scan.errors)}건이 남아 커밋 금지 상태입니다` };
  }
  if (scan.warnings > 0 && scan.strict) {
    return { tone: "crit", title: `저장했습니다 · strict 스냅샷이라 경고 ${formatCount(scan.warnings)}건도 커밋 금지입니다` };
  }
  if (scan.warnings > 0) return { tone: "warn", title: `저장했습니다 · 검토할 경고 ${formatCount(scan.warnings)}건` };
  return { tone: "ok", title: "저장했습니다" };
}

/** 내보내기 당시 대비 (디자인 4.5) */
export function atExportCompareText(
  atExport: { errors: number; warnings: number } | null,
  current: { errors: number; warnings: number },
): string {
  if (!atExport) return "내보내기 당시 기록 없음";
  if (atExport.errors === current.errors && atExport.warnings === current.warnings) return "내보내기 당시와 같음";
  return `내보내기 당시 오류 ${formatCount(atExport.errors)} · 경고 ${formatCount(atExport.warnings)} → 지금 오류 ${formatCount(current.errors)} · 경고 ${formatCount(current.warnings)}`;
}

/** raw 데이터 파일 이름 (명세 3.3: `raw-data.json`, `*.raw.json`). 표시 칩 구분용 */
export const isRawDataName = (name: string): boolean => name === "raw-data.json" || name.endsWith(".raw.json");

export interface FolderRow {
  key: string;
  name: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
  mark: "missing" | "unexpected" | "raw" | "notes" | "directory" | null;
  type: ExtraFile["type"] | "file";
}

/** 폴더 내용 표 (디자인 4.8): 알려진 파일 → 라벨·메모 파일 → raw → 예상 밖(이름순) */
export function folderRows(d: Pick<SnapshotDetailData, "files" | "extraFiles" | "notes">): FolderRow[] {
  const known: FolderRow[] = d.files.map((f) => ({
    key: `k:${f.kind}`,
    name: f.name,
    sizeBytes: f.exists ? f.sizeBytes : null,
    modifiedAt: f.exists ? f.modifiedAt : null,
    // 필수 템플릿이 없으면 `없음`, 매핑·메타가 없어도 없음으로 보인다(주의 사유와 연결)
    mark: f.exists ? null : "missing",
    type: "file",
  }));
  const notes: FolderRow[] = d.notes.fileExists
    ? [{ key: "k:notes", name: "notes.json", sizeBytes: null, modifiedAt: d.notes.updatedAt, mark: "notes", type: "file" }]
    : [];
  const extras = [...d.extraFiles].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const raw = extras.filter((e) => isRawDataName(e.name));
  const other = extras.filter((e) => !isRawDataName(e.name));
  const toRow = (e: ExtraFile, mark: FolderRow["mark"]): FolderRow => ({
    key: `x:${e.name}`,
    name: e.type === "directory" ? `${e.name}/` : e.name,
    sizeBytes: e.sizeBytes,
    modifiedAt: null,
    mark,
    type: e.type,
  });
  return [...known, ...notes, ...raw.map((e) => toRow(e, "raw")), ...other.map((e) => toRow(e, "unexpected"))];
}

/** 쓰기 불가 Banner (디자인 3.5). 루트 단위 사유만: 읽기 전용·쓰기 꺼짐 */
export function writeBlockBanner(w: WriteAbility | null | undefined): { title: string; description: string } | null {
  if (!w || w.allowed) return null;
  if (w.reasonCode === "READ_ONLY") {
    return {
      title: "스냅샷 폴더가 읽기 전용입니다",
      description: "목록과 내용은 볼 수 있지만 편집·라벨·삭제는 할 수 없습니다. 쓰려면 스냅샷 폴더를 쓰기 가능하게 마운트하세요.",
    };
  }
  if (w.reasonCode === "WRITE_DISABLED") {
    return {
      title: "쓰기 기능이 꺼져 있습니다",
      description: "설정에서 쓰기 기능을 꺼 두어 보기만 할 수 있습니다. (AWS_SNAPSHOT_WRITE_ENABLED)",
    };
  }
  return null;
}

/** 쓰기 불가 사유 문구 (서버 문구 우선) */
export function blockReason(w: WriteAbility | null | undefined, fallback = "지금은 할 수 없습니다"): string | undefined {
  if (!w || w.allowed) return undefined;
  return w.reasonText ?? fallback;
}

/**
 * 출처를 쓸 수 없음 (목록 대신 UnknownState, 디자인 3.7). UnknownState 제목은 `알 수 없음 (reason)`,
 * detail 은 서버 문구(경로·errno 포함)를 그대로.
 */
export function sourceUnknownView(summary: SnapshotSummary | null | undefined): { reason: string; detail: string | undefined } | null {
  if (!summary) return null;
  const state = summary.root.state;
  const detail = summary.root.setup?.reasonText ?? summary.status.reasons[0]?.text;
  if (state === "not_configured") return { reason: "스냅샷 폴더가 설정되지 않았습니다", detail };
  if (state === "unavailable") {
    const text = detail ?? "";
    const reason = text.includes("읽을 수 없")
      ? "스냅샷 폴더를 읽을 수 없습니다"
      : text.includes("스캐너")
        ? "스캐너를 불러올 수 없습니다"
        : "스냅샷 폴더를 찾을 수 없습니다";
    return { reason, detail };
  }
  return null;
}

/** 스냅샷 쓰기 API 오류 → 화면 문구 (값 원문 없음. 서버 message 는 원문을 담지 않는다: 계약 1.4) */
export function writeErrorText(body: ApiErrorBody | null, fallback: string): string {
  if (!body) return fallback;
  switch (body.code) {
    case "SNAPSHOT_READ_ONLY":
      return "스냅샷 폴더가 읽기 전용입니다";
    case "SNAPSHOT_WRITE_DISABLED":
      return "쓰기 기능이 꺼져 있습니다";
    case "SNAPSHOT_EXPORT_IN_PROGRESS":
      return "내보내기 진행 중일 수 있어 바꿀 수 없습니다";
    case "SNAPSHOT_ID_EXISTS":
      return "같은 ID의 스냅샷이 이미 있습니다";
    case "ORIGIN_NOT_ALLOWED":
      return "허용되지 않은 출처에서 보낸 요청이라 거부됐습니다 (CORS_ORIGIN 설정 확인)";
    case "SOURCE_UNAVAILABLE":
      return body.message || "스냅샷 폴더를 쓸 수 없습니다";
    default:
      return body.message || fallback;
  }
}

/** 오류 응답 `details.resource.kind` */
export function notFoundKind(body: ApiErrorBody | null): string | null {
  const r = body?.details?.resource as { kind?: unknown } | undefined;
  return typeof r?.kind === "string" ? r.kind : null;
}

/** 422 SNAPSHOT_NOTES_SECRET_DETECTED → `규칙: url-credentials (메모)` */
export function notesSecretText(body: ApiErrorBody | null): { text: string; fields: string[] } {
  const d = (body?.details ?? {}) as { fields?: unknown; rules?: unknown };
  const fields = Array.isArray(d.fields) ? d.fields.filter((x): x is string => typeof x === "string") : [];
  const rules = Array.isArray(d.rules) ? d.rules.filter((x): x is string => typeof x === "string") : [];
  const fieldText = fields.map((f) => (f === "label" ? "라벨" : f === "memo" ? "메모" : f)).join(", ");
  return { text: `규칙: ${rules.join(", ") || "알 수 없음"}${fieldText ? ` (${fieldText})` : ""}`, fields };
}

/** 400 VALIDATION_FAILED → 필드 이름 목록 (값은 계약상 오지 않음) */
export function validationFields(body: ApiErrorBody | null): string[] {
  const fs = (body?.details as { fields?: unknown } | undefined)?.fields;
  if (!Array.isArray(fs)) return [];
  return fs.map((f) => (f && typeof f === "object" ? (f as { field?: unknown }).field : null)).filter((x): x is string => typeof x === "string");
}
