/**
 * docs/api/k8s-snapshot.md 계약 타입. 계약에 없는 필드는 두지 않는다.
 * ASM 과 같다고 적힌 모양(WriteAbility, ScanSummary, ExportProgress, 노트, 루트 설정)은 aws-snapshots 타입을 그대로 쓴다.
 */
import type {
  Eol,
  ExportProgress,
  ScanSummary,
  SnapshotNotes,
  SnapshotNotice,
  SnapshotRootSetup,
  WriteAbility,
} from "../aws-snapshots/types";
import type { DataSource, IsoTime, ListMeta, SourceState, StatusInfo } from "../common/types";

export type { ExportProgress, ScanSummary, SnapshotNotes, WriteAbility };

/** 5절 */
export type K8sFileType = "resource" | "namespace" | "metadata" | "secret_refs" | "notes" | "other";
export type ScanSeverity = "error" | "warn";

export interface ResourceIdentity {
  /** 코어는 "" (화면 표시는 `core`) */
  apiGroup: string;
  apiVersion: string;
  kind: string;
  namespace: string | null;
  name: string;
}

export interface K8sScanFinding {
  file: string;
  fileType: K8sFileType;
  line: number;
  rule: string;
  severity: ScanSeverity;
  message: string;
}

export interface K8sResourceCounts {
  current: { total: number; files: number };
  atExport: { total: number } | null;
  changedSinceExport: boolean;
  previous: { snapshotId: string; total: number } | null;
  delta: number | null;
}

/** 11.3 사유 코드 (그 밖의 코드가 와도 서버 문구로 그린다) */
export type DriftReasonCode =
  | "DRIFT_NO_DIFF"
  | "DRIFT_DIFF"
  | "DRIFT_NOT_COMPUTED"
  | "CLUSTER_NOT_CONNECTED"
  | "CLUSTER_SYNCING"
  | "DASHBOARD_CLUSTER_UNKNOWN"
  | "CLUSTER_MISMATCH"
  | "CLUSTER_ID_MISSING"
  | "SNAPSHOT_FILES_PENDING"
  | "NO_COMPARABLE_RESOURCES"
  | "DRIFT_RULES_UNAVAILABLE"
  | "DRIFT_FAILED";

export interface DriftAbility {
  allowed: boolean;
  reasonCode: string | null;
  reasonText: string | null;
}

export interface K8sSnapshotActions {
  editFiles: WriteAbility;
  editNotes: WriteAbility;
  delete: WriteAbility;
  computeDrift: DriftAbility;
}

export type DriftMode = "auto" | "on_demand" | "last_result" | "none";

export interface DriftCountsApi {
  compared: number;
  same: number;
  added: number;
  deleted: number;
  changed: number;
  hidden: { default: number; managed: number };
  uncomparable: number;
  unparsable: number;
}

/** 목록·상세·SSE 의 드리프트 배지 (값 없음) */
export interface DriftBadge {
  /** status: ok | warning | unknown (critical 없음) */
  status: StatusInfo;
  mode: DriftMode;
  computing: boolean;
  computed: boolean;
  computedAt: IsoTime | null;
  lastResultStatus: "ok" | "warning" | null;
  counts: DriftCountsApi | null;
  resultAvailable: boolean;
}

export type ClusterRelation = "same" | "other" | "unknown";

export interface K8sSnapshotCluster {
  id: string | null;
  context: string | null;
  name: string | null;
  serverVersion: string | null;
  relation: ClusterRelation;
}

export type NamespaceMode = "all_except_system" | "include" | "exclude";

export interface K8sSnapshotScope {
  namespaceMode: NamespaceMode;
  namespaces: string[];
  missingNamespaces: string[];
  /** exclude 모드의 제외 목록 (그 밖 모드는 []). 2026-09-19 계약 추가 */
  excludeNamespaces: string[];
  systemIncluded: string[];
  kindCount: number;
  optionalKinds: string[];
  customResources: string[];
  includeHelmManaged: boolean;
}

export interface K8sSnapshotListItem {
  id: string;
  snapshotAt: IsoTime | null;
  status: StatusInfo;
  drift: DriftBadge;
  label: string | null;
  memo: string | null;
  notesUpdatedAt: IsoTime | null;
  cluster: K8sSnapshotCluster | null;
  scope: K8sSnapshotScope | null;
  resources: K8sResourceCounts;
  helmManaged: number | null;
  partialKinds: { id: string; result: "forbidden" | "not_found" | "error" }[];
  scan: ScanSummary;
  lastModifiedAt: IsoTime | null;
  modifiedByDashboard: boolean;
  cliVersion: string | null;
  actions: K8sSnapshotActions;
  exportInProgress: ExportProgress;
}

/** 6.1 */
export interface DashboardCluster {
  state: SourceState;
  id: string | null;
  name: string | null;
  context: string | null;
  serverVersion: string | null;
}

export interface K8sSnapshotSummary {
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
  dashboardCluster: DashboardCluster;
  latestDrift: { snapshotId: string; drift: DriftBadge } | null;
}

/** 6.2 `cli` (k8s 만 settings·exitCodes 가 있다) */
export interface K8sCli {
  install: string;
  configure: string;
  dryRun: string;
  export: string;
  scan: string;
  readme: string;
  settings: { name: string; required: boolean; text: string }[];
  exitCodes: { code: number; text: string }[];
}

export interface K8sSummaryResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  revision: number;
  summary: K8sSnapshotSummary;
  cli: K8sCli;
}

export type DriftFacetKey = "ok" | "warning" | "unknown" | "not_computed";

export interface K8sListResponse extends ListMeta {
  dataSource: DataSource;
  generatedAt: IsoTime;
  revision: number;
  summary: K8sSnapshotSummary;
  facets: {
    cluster: Record<ClusterRelation, number>;
    drift: Record<DriftFacetKey, number>;
    status: Record<"ok" | "warning" | "critical" | "unknown", number>;
  };
  items: K8sSnapshotListItem[];
  cli: K8sCli;
}

/** 6.3 */
export type K8sParse = "ok" | "yaml_error" | "multi_document" | "not_object" | "too_large" | "empty";
export type FileDriftMark = "same" | "changed" | "deleted" | "uncomparable" | "skipped";

export interface K8sFileInfo {
  path: string;
  fileType: K8sFileType;
  resource: ResourceIdentity | null;
  resourceKey?: string | null;
  documents?: ResourceIdentity[];
  expected: { apiGroup: string; kind: string | null; namespace: string | null; name: string } | null;
  parse: K8sParse;
  parseError?: { line: number; column: number; code: string; message: string } | null;
  pathMatches: boolean;
  duplicate: boolean;
  duplicateOf?: string[];
  runtimeFields: string[];
  helmManaged: boolean;
  comparable: boolean;
  findings: { errors: number; warnings: number };
  drift: FileDriftMark | null;
  exists: boolean;
  sizeBytes: number | null;
  lineCount?: number | null;
  modifiedAt?: IsoTime | null;
  version?: string | null;
  eol?: Eol | null;
  bom?: boolean | null;
  encoding?: "utf-8" | "unknown" | null;
  indent?: { style: "spaces" | "tabs"; size: 2 | 4 | 8 | null } | null;
  editable: WriteAbility;
  viewTruncated?: boolean;
}

export type KindDriftFlag = "comparable" | "not_in_rbac" | "forbidden" | "api_version_mismatch";

export interface K8sTreeNamespace {
  /** 클러스터 범위(`_cluster/`)는 null */
  namespace: string | null;
  system: boolean;
  namespaceFile: string | null;
  count: number;
  kinds: { kindDir: string; kind: string; count: number; drift: KindDriftFlag; paths: string[] }[];
}

export interface K8sCounts {
  total: {
    current: number;
    atExport: number | null;
    previous: number | null;
    delta: number | null;
    helmManaged: number | null;
    excludedByRule: number | null;
  };
  byKind: {
    kindDir: string;
    kind: string;
    custom: boolean;
    current: number;
    atExport: number | null;
    previous: number | null;
    delta: number | null;
    drift: KindDriftFlag;
  }[];
  /** 클러스터 범위(`_cluster/`)면 namespace null (계약 20절 13) */
  byNamespace: { namespace: string | null; system: boolean; current: number; atExport: number | null }[];
  excluded: { kindDir: string; kind: string; count: number; reason: "owned" | "auto_created" | "helm_excluded" | (string & {}); text: string }[];
}

export interface K8sFolder {
  fileCount: number;
  sizeBytes: number;
  topLevel: { name: string; type: "directory" | "file" | "symlink" | "other"; fileCount: number; unexpected?: boolean }[];
}

export interface K8sExtraFile {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  sizeBytes: number | null;
}

/** 3.2 metadata.json (대시보드가 보는 필드) */
export interface K8sMetadataFields {
  schemaVersion?: unknown;
  snapshotId?: string | null;
  snapshotIdTimezone?: string | null;
  createdAt?: string | null;
  tool?: { name?: string | null; version?: string | null; node?: string | null; client?: string | null } | null;
  cluster?: { id?: string | null; idSource?: string | null; context?: string | null; name?: string | null; serverVersion?: string | null } | null;
  scope?: {
    namespaces?: {
      mode?: NamespaceMode | null;
      include?: string[] | null;
      exclude?: string[] | null;
      system?: string[] | null;
      systemIncluded?: string[] | null;
    } | null;
    exported?: string[] | null;
    missing?: string[] | null;
    kinds?: { default?: string[] | null; optional?: string[] | null; custom?: string[] | null; excluded?: string[] | null } | null;
    includeHelmManaged?: boolean | null;
  } | null;
  kinds?: Record<
    string,
    {
      kind?: string | null;
      apiVersion?: string | null;
      namespaced?: boolean | null;
      result?: "ok" | "forbidden" | "not_found" | "error" | (string & {}) | null;
      exported?: number | null;
      excludedByRule?: number | null;
      forbiddenNamespaces?: string[] | null;
      message?: string | null;
    }
  > | null;
  resources?: { total?: number | null; helmManaged?: number | null } | null;
  cleanup?: { rulesVersion?: number | null; summary?: string[] | null } | null;
  secrets?: { mode?: string | null; read?: boolean | null; referenced?: number | null; file?: string | null } | null;
  secretScan?: (ScanSummary & { profile?: string }) | null;
}

export interface K8sMetadata {
  state: "ok" | "missing" | "corrupt" | "schema_mismatch";
  error: string | null;
  fields: K8sMetadataFields | null;
}

export type SecretVia =
  | "env.valueFrom.secretKeyRef"
  | "envFrom.secretRef"
  | "volumes.secret"
  | "volumes.projected.secret"
  | "volumes.csi.nodePublishSecretRef"
  | "imagePullSecrets"
  | "serviceAccount.imagePullSecrets"
  | "ingress.tls";

export interface SecretRef {
  namespace: string;
  secretName: string;
  keys: string[];
  optional: boolean;
  referencedBy: { kind: string; name: string; via: SecretVia | (string & {}); container: string | null }[];
}

export interface K8sSecretRefs {
  state: "ok" | "missing" | "corrupt" | "schema_mismatch";
  count: number;
  secrets: SecretRef[];
  /** secret-refs.json 의 note 그대로. 없거나 state 가 ok 가 아니면 null (계약 20절 12) */
  note: string | null;
}

export interface K8sDetailScan {
  current: {
    summary: ScanSummary;
    scannedFiles: string[];
    findings: K8sScanFinding[];
    scannedAt: IsoTime | null;
  };
  atExport: ScanSummary | null;
}

export type K8sSnapshotDetailData = Omit<K8sSnapshotListItem, "scan"> & {
  scan: K8sDetailScan;
  files: K8sFileInfo[];
  tree: K8sTreeNamespace[];
  counts: K8sCounts;
  folder: K8sFolder;
  extraFiles: K8sExtraFile[];
  metadata: K8sMetadata;
  secretRefs: K8sSecretRefs;
  notes: SnapshotNotes;
  notices: SnapshotNotice[];
};

export interface K8sDetailResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  revision: number;
  cli: K8sCli;
  snapshot: K8sSnapshotDetailData;
}

/** 6.4 */
export interface K8sFileResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  snapshotId: string;
  path: string;
  fileType: K8sFileType;
  resource: ResourceIdentity | null;
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
  findings: K8sScanFinding[];
  commands: { note: string; diff: string; apply: string } | null;
}

/** 6.5 */
export interface K8sScanRulesResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  profile?: string;
  allowMarker: string;
  scannableExtensions: string[];
  rules: { id: string; severity: ScanSeverity; description: string }[];
}

/** 6.6 */
export interface DriftRulesResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  rulesVersion: number;
  comparableKinds: { id: string; apiGroup: string; apiVersion: string; kind: string; rbacResource: string; informer: string }[];
  uncomparableNote: string;
  cleanup: string[];
  defaults: { kinds: string[]; path: string; value: unknown; note: string | null }[];
  managed: { id: string; kinds: string[]; path: string; reason: string; condition: string }[];
  masked: string[];
}

/** 7.1 */
export type K8sConfirmKind = "secret_errors" | "yaml_syntax" | "multi_document" | "identity_changed";

/** 7.2 */
export interface K8sFileCheck {
  findings: K8sScanFinding[];
  errors: number;
  warnings: number;
  syntax: { checked: boolean; errors: { line: number; column: number; code: string; message: string }[] };
  documents: number;
  identity: {
    expected: { apiGroup: string; kind: string | null; namespace: string | null; name: string } | null;
    actual: ResourceIdentity | null;
    matches: boolean | null;
  } | null;
  runtimeFields: string[];
  unchanged: boolean;
  snapshotScanAfter: ScanSummary;
  confirmationsRequired: K8sConfirmKind[];
}

export interface K8sCheckResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  snapshotId: string;
  path: string;
  check: K8sFileCheck;
}

/** 7.3 */
export interface K8sSaveResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  saved: boolean;
  snapshotId: string;
  path: string;
  version: string;
  modifiedAt: IsoTime;
  sizeBytes: number;
  check: K8sFileCheck;
  rescan: { before: { errors: number; warnings: number }; after: { errors: number; warnings: number } };
  snapshot: K8sSnapshotListItem;
  driftRecompute: "scheduled" | "none";
  revision: number;
}

/** 8절 */
export interface K8sNotesResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  notes: SnapshotNotes;
  snapshot: K8sSnapshotListItem;
  revision: number;
}

/** 9절 (ASM 9.2 에서 region → cluster, fileCount 추가) */
export interface K8sTrashItem {
  trashId: string;
  snapshotId: string;
  snapshotAt: IsoTime | null;
  deletedAt: IsoTime | null;
  label: string | null;
  cluster: { context: string | null; name: string | null } | null;
  files: string[];
  fileCount: number;
  sizeBytes: number | null;
  restore: WriteAbility;
}

export interface K8sTrashResponse extends ListMeta {
  dataSource: DataSource;
  generatedAt: IsoTime;
  items: K8sTrashItem[];
}

export interface K8sDeleteResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  trashItem: K8sTrashItem;
  summary: K8sSnapshotSummary;
  revision: number;
}

export interface K8sRestoreResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  snapshot: K8sSnapshotListItem;
  revision: number;
}

/** 10.9 */
export type DiffValueApi =
  | { kind: "scalar"; value: string | number | boolean | null }
  | { kind: "list"; items: (string | number | boolean | null)[] }
  | { kind: "masked"; text: string; preview: string };

export interface FieldDiff {
  path: string;
  category: "changed" | "default" | "managed";
  reason: string | null;
  managedRule?: string | null;
  snapshot: DiffValueApi | null;
  cluster: DiffValueApi | null;
}

export interface DriftResource {
  key: string;
  apiGroup: string;
  apiVersion?: string;
  kind: string;
  namespace: string | null;
  name: string;
  change: "added" | "deleted" | "changed" | "same";
  file: string | null;
  fileDocuments?: number;
  helmManaged: boolean;
  counts: { changed: number; default: number; managed: number };
  fields: FieldDiff[];
  fieldsTruncated: boolean;
  summary: { images: string[]; replicas: number | null } | null;
  commands: { diff: string; apply: string } | null;
}

export interface DriftResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  snapshotId: string;
  drift: DriftBadge;
  lease: { expiresAt: IsoTime; renewAfterSec: number } | null;
  target: { clusterId: string | null; context: string | null; name: string | null; serverVersion: string | null; sourceState: SourceState } | null;
  snapshotCluster: { id: string | null; context: string | null; name: string | null; serverVersion: string | null } | null;
  rulesVersion: number | null;
  addedCheck: "checked" | "skipped_scope_unknown" | null;
  uncomparable: { apiGroup: string; kind: string; count: number; reason: string; text: string }[];
  unparsable: { path: string; reason: "yaml_error" | "duplicate" | "namespace_missing" | "too_large" | (string & {}) }[];
  resources: DriftResource[];
  commandsNote: string | null;
  notices: SnapshotNotice[];
}

/** 13절 SSE payload */
export interface K8sSnapshotsSnapshotEvent {
  revision: number;
  summary: K8sSnapshotSummary;
}

export interface K8sSnapshotsChangedEvent {
  revision: number;
  changedIds: string[];
  removedIds: string[];
  trashChanged: boolean;
  summary: K8sSnapshotSummary;
}

export type DriftTrigger =
  | "cluster_changed"
  | "file_changed"
  | "periodic"
  | "requested"
  | "source_changed"
  | "target_changed"
  | "lease_expired";

export interface K8sDriftEvent {
  snapshotId: string;
  trigger: DriftTrigger | (string & {});
  drift: DriftBadge;
  autoTargetId: string | null;
}
