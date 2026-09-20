/**
 * docs/api/aws-snapshot-manager.md 계약 타입. 계약에 없는 필드는 두지 않는다.
 */
import type { DataSource, IsoTime, ListMeta, SourceState, StatusInfo } from "../common/types";

export type FileKind = "cloudformation" | "terraform" | "mapping" | "metadata";
export type EditableKind = "cloudformation" | "terraform";
export type ScanSeverity = "error" | "warn";

/** 1.2 */
export type WriteBlockCode =
  | "WRITE_DISABLED"
  | "READ_ONLY"
  | "SOURCE_UNAVAILABLE"
  | "EXPORT_MAYBE_IN_PROGRESS"
  | "NOTES_CORRUPT"
  | "FILE_KIND_READ_ONLY"
  | "FILE_MISSING"
  | "FILE_UNREADABLE"
  | "FILE_TOO_LARGE"
  | "NOT_UTF8"
  | "MIXED_LINE_ENDINGS"
  | "SNAPSHOT_ID_EXISTS";

export interface WriteAbility {
  allowed: boolean;
  reasonCode: WriteBlockCode | null;
  reasonText: string | null;
}

/** 5절 */
export interface ScanFindingApi {
  file: string;
  fileKind: FileKind | "notes" | null;
  line: number;
  rule: string;
  severity: ScanSeverity;
  message: string;
}

export interface ScanSummary {
  errors: number;
  warnings: number;
  strict: boolean;
  passed: boolean;
  rules: string[];
}

export interface ResourceCounts {
  cloudformation: number | null;
  terraform: number | null;
}

export interface SnapshotResources {
  current: ResourceCounts;
  atExport: ResourceCounts | null;
  changedSinceExport: boolean;
  previous: { snapshotId: string; counts: ResourceCounts } | null;
  delta: ResourceCounts | null;
}

export interface SnapshotActions {
  editTemplates: WriteAbility;
  editNotes: WriteAbility;
  delete: WriteAbility;
}

export interface SnapshotScope {
  searchFilter: string | null;
  regexFilter: string | null;
  services: { mode: "include" | "exclude"; list: string[] } | null;
}

export interface SnapshotListItem {
  id: string;
  snapshotAt: IsoTime | null;
  status: StatusInfo;
  label: string | null;
  memo: string | null;
  notesUpdatedAt: IsoTime | null;
  region: string | null;
  scope: SnapshotScope | null;
  resources: SnapshotResources;
  scan: ScanSummary;
  lastModifiedAt: IsoTime | null;
  modifiedByDashboard: boolean;
  former2Version: string | null;
  actions: SnapshotActions;
  /** (계약 18절 추가) "내보내기 진행 중일 수 있음" 판단 근거 */
  exportInProgress: ExportProgress;
}

/** 5절 ExportProgress */
export interface ExportProgress {
  active: boolean;
  metadataMissing: boolean;
  lastChangeAt: IsoTime;
  untilAt: IsoTime | null;
  thresholdMinutes: number;
}

/** 6.1 */
export interface SnapshotRootSetup {
  envVar: string;
  dockerMount: string;
  localExample: string;
  reasonText: string;
}

export interface SnapshotSummary {
  status: StatusInfo;
  counts: { total: number; critical: number; warning: number; unknown: number; ok: number };
  unrecognized: { count: number; names: string[] };
  trashCount: number;
  root: {
    configured: boolean;
    displayPath: string | null;
    state: SourceState;
    setup: SnapshotRootSetup | null;
  };
  writable: WriteAbility;
  lastCheckedAt: IsoTime | null;
  limits: {
    editMaxBytes: number;
    viewMaxBytes: number;
    inProgressMinutes: number;
    labelMaxLength: number;
    memoMaxLength: number;
  };
}

export interface SummaryResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  revision: number;
  summary: SnapshotSummary;
  /** (계약 18절 추가) */
  cli: CliGuideText;
}

/** 6.2 */
export interface CliGuideText {
  install: string;
  configure: string;
  dryRun: string;
  export: string;
  scan: string;
  readme: string;
}

export interface ListResponse extends ListMeta {
  dataSource: DataSource;
  generatedAt: IsoTime;
  revision: number;
  summary: SnapshotSummary;
  regions: string[];
  items: SnapshotListItem[];
  cli: CliGuideText;
}

/** 6.3 */
export type Eol = "lf" | "crlf" | "mixed" | "none";

export interface SnapshotFileInfo {
  kind: FileKind;
  name: string;
  exists: boolean;
  sizeBytes: number | null;
  lineCount: number | null;
  modifiedAt: IsoTime | null;
  version: string | null;
  eol: Eol | null;
  bom: boolean | null;
  encoding: "utf-8" | "unknown" | null;
  indent: { style: "spaces" | "tabs"; size: 2 | 4 | 8 | null } | null;
  editable: WriteAbility;
  viewTruncated: boolean;
}

export interface ExtraFile {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  sizeBytes: number | null;
}

export interface MetadataFields {
  schemaVersion?: unknown;
  createdAt?: string | null;
  snapshotId?: string | null;
  snapshotIdTimezone?: string | null;
  region?: string | null;
  profile?: string | null;
  searchFilter?: string | null;
  regexFilter?: string | null;
  services?: { mode: "include" | "exclude"; list: string[] } | null;
  allowSensitiveServices?: boolean | null;
  includeDefaultResources?: boolean | null;
  cfnDeletionPolicy?: string | null;
  former2?: { version?: string | null; args?: string[] | null } | null;
  node?: string | null;
  account?: { masked?: boolean | null; ids?: string[] | null; note?: string | null } | null;
  resources?: ResourceCounts | null;
  rawData?: { saved?: boolean | null; location?: string | null } | null;
  secretScan?: ScanSummary | null;
}

export interface SnapshotMetadata {
  state: "ok" | "missing" | "corrupt" | "schema_mismatch";
  error: string | null;
  fields: MetadataFields | null;
}

export interface SnapshotNotes {
  label: string | null;
  memo: string | null;
  updatedAt: IsoTime | null;
  version: string;
  fileExists: boolean;
}

export interface SnapshotNotice {
  code: string;
  text: string;
}

export interface DetailScan {
  current: {
    summary: ScanSummary;
    scannedFiles: string[];
    findings: ScanFindingApi[];
    scannedAt: IsoTime | null;
  };
  atExport: ScanSummary | null;
}

/** 상세 응답의 snapshot: 목록 행 필드 + 상세 필드. `scan`만 모양이 다르다(상세는 current/atExport). */
export type SnapshotDetailData = Omit<SnapshotListItem, "scan"> & {
  scan: DetailScan;
  files: SnapshotFileInfo[];
  extraFiles: ExtraFile[];
  metadata: SnapshotMetadata;
  notes: SnapshotNotes;
  notices: SnapshotNotice[];
};

export interface DetailResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  revision: number;
  /** (계약 18절 추가) `scan`에 이 스냅샷 ID 가 채워져 있다 */
  cli: CliGuideText;
  snapshot: SnapshotDetailData;
}

/** 6.4 */
export interface FileResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  snapshotId: string;
  kind: FileKind;
  name: string;
  content: string;
  version: string;
  sizeBytes: number;
  lineCount: number;
  eol: Eol;
  bom: boolean;
  encoding: "utf-8" | "unknown";
  indent: { style: "spaces" | "tabs"; size: 2 | 4 | 8 | null } | null;
  modifiedAt: IsoTime;
  truncated: boolean;
  returnedBytes: number;
  editable: WriteAbility;
  findings: ScanFindingApi[];
  resourceCount: number | null;
}

/** 6.5 */
export interface ScanRulesResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  allowMarker: string;
  scannableExtensions: string[];
  rules: { id: string; severity: ScanSeverity; description: string }[];
}

/** 7.2 */
export type ConfirmKind = "secret_errors" | "yaml_syntax" | "resource_decrease";

export interface TemplateCheck {
  findings: ScanFindingApi[];
  errors: number;
  warnings: number;
  syntax: { checked: boolean; errors: { line: number; column: number; code: string; message: string }[] };
  resources: { before: number | null; after: number | null };
  unchanged: boolean;
  snapshotScanAfter: ScanSummary;
  confirmationsRequired: ConfirmKind[];
}

export interface CheckResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  snapshotId: string;
  kind: EditableKind;
  check: TemplateCheck;
}

/** 7.3 */
export interface SaveResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  saved: boolean;
  snapshotId: string;
  kind: EditableKind;
  version: string;
  modifiedAt: IsoTime;
  sizeBytes: number;
  check: TemplateCheck;
  rescan: { before: { errors: number; warnings: number }; after: { errors: number; warnings: number } };
  snapshot: SnapshotListItem;
  revision: number;
}

/** 8.1 */
export interface NotesResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  notes: SnapshotNotes;
  snapshot: SnapshotListItem;
  revision: number;
}

/** 9.2 */
export interface TrashItem {
  trashId: string;
  snapshotId: string;
  snapshotAt: IsoTime | null;
  deletedAt: IsoTime | null;
  label: string | null;
  region: string | null;
  files: string[];
  sizeBytes: number | null;
  restore: WriteAbility;
}

export interface TrashResponse extends ListMeta {
  dataSource: DataSource;
  generatedAt: IsoTime;
  items: TrashItem[];
}

/** 9.1 */
export interface DeleteResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  trashItem: TrashItem;
  summary: SnapshotSummary;
  revision: number;
}

/** 9.3 */
export interface RestoreResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  snapshot: SnapshotListItem;
  revision: number;
}

/** 11절 SSE payload */
export interface SnapshotsSnapshotEvent {
  revision: number;
  summary: SnapshotSummary;
}

export interface SnapshotsChangedEvent {
  revision: number;
  changedIds: string[];
  removedIds: string[];
  trashChanged: boolean;
  summary: SnapshotSummary;
}
