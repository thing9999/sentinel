/**
 * aws-snapshot-manager 계약(docs/api/aws-snapshot-manager.md) 예시 모양의 가짜 응답. 테스트 전용.
 * 값은 mock API(12절 기본 예시)를 줄여 옮겼다. 비밀값은 누가 봐도 가짜인 것만.
 */
import type {
  DetailResponse,
  FileResponse,
  ListResponse,
  ScanFindingApi,
  SnapshotDetailData,
  SnapshotFileInfo,
  SnapshotListItem,
  SnapshotSummary,
  TemplateCheck,
  TrashResponse,
  WriteAbility,
} from "../aws-snapshots/types";
import type { StatusInfo } from "../common/types";

const OK: WriteAbility = { allowed: true, reasonCode: null, reasonText: null };
const T = "2026-09-19T05:02:05.000Z";

function st(status: StatusInfo["status"], reasons: [string, string, StatusInfo["status"]][] = []): StatusInfo {
  return { status, reasons: reasons.map(([code, text, s]) => ({ code, text, status: s })), updatedAt: T, statusChangedAt: T, stale: false };
}

export function snapshotSummary(patch: Partial<SnapshotSummary> = {}): SnapshotSummary {
  return {
    status: st("critical", [
      ["SNAPSHOTS_COMMIT_BLOCKED", "커밋 금지 스냅샷 2개", "critical"],
      ["SNAPSHOTS_NEED_REVIEW", "주의 스냅샷 1개", "warning"],
    ]),
    counts: { total: 4, critical: 2, warning: 1, unknown: 1, ok: 0 },
    unrecognized: { count: 1, names: ["old-backup"] },
    trashCount: 1,
    root: { configured: true, displayPath: "(예시 데이터)", state: "mock", setup: null },
    writable: OK,
    lastCheckedAt: T,
    limits: { editMaxBytes: 5242880, viewMaxBytes: 20971520, inProgressMinutes: 30, labelMaxLength: 60, memoMaxLength: 2000 },
    ...patch,
  };
}

function item(id: string, patch: Partial<SnapshotListItem>): SnapshotListItem {
  const y = id.slice(0, 4);
  const mo = id.slice(4, 6);
  const d = id.slice(6, 8);
  const h = id.slice(9, 11);
  const mi = id.slice(11, 13);
  const s = id.slice(13, 15);
  return {
    id,
    snapshotAt: `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`,
    status: st("ok"),
    label: null,
    memo: null,
    notesUpdatedAt: null,
    region: "ap-northeast-2",
    scope: { searchFilter: "prod.k8s.example.com", regexFilter: null, services: { mode: "exclude", list: ["SecretsManager", "SSM", "Lambda", "IAM"] } },
    resources: {
      current: { cloudformation: 42, terraform: 44 },
      atExport: { cloudformation: 42, terraform: 44 },
      changedSinceExport: false,
      previous: null,
      delta: null,
    },
    scan: { errors: 0, warnings: 0, strict: false, passed: true, rules: [] },
    lastModifiedAt: T,
    modifiedByDashboard: false,
    former2Version: "0.2.83",
    actions: { editTemplates: OK, editNotes: OK, delete: OK },
    exportInProgress: { active: false, metadataMissing: false, lastChangeAt: T, untilAt: null, thresholdMinutes: 30 },
    ...patch,
  };
}

export const SNAP_ITEMS: SnapshotListItem[] = [
  item("20260919-045500", {
    status: st("unknown", [["EXPORT_MAYBE_IN_PROGRESS", "내보내기 진행 중일 수 있음", "unknown"]]),
    region: null,
    scope: null,
    former2Version: null,
    exportInProgress: { active: true, metadataMissing: true, lastChangeAt: "2026-09-19T04:55:00.000Z", untilAt: "2026-09-19T05:25:00.000Z", thresholdMinutes: 30 },
    actions: {
      editTemplates: { allowed: false, reasonCode: "EXPORT_MAYBE_IN_PROGRESS", reasonText: "내보내기 진행 중일 수 있어 바꿀 수 없습니다" },
      editNotes: { allowed: false, reasonCode: "EXPORT_MAYBE_IN_PROGRESS", reasonText: "내보내기 진행 중일 수 있어 바꿀 수 없습니다" },
      delete: { allowed: false, reasonCode: "EXPORT_MAYBE_IN_PROGRESS", reasonText: "내보내기 진행 중일 수 있어 바꿀 수 없습니다" },
    },
  }),
  item("20260919-031500", {
    status: st("critical", [
      ["SCAN_SECRET_ERRORS", "비밀값 의심 2건 (env-block, url-credentials)", "critical"],
      ["SCAN_WARNINGS", "검토 필요 1건 (user-data)", "warning"],
    ]),
    resources: {
      current: { cloudformation: 42, terraform: 44 },
      atExport: { cloudformation: 42, terraform: 44 },
      changedSinceExport: false,
      previous: { snapshotId: "20260918-120000", counts: { cloudformation: 60, terraform: 62 } },
      delta: { cloudformation: -18, terraform: -18 },
    },
    scan: { errors: 2, warnings: 1, strict: false, passed: false, rules: ["env-block", "url-credentials", "user-data"] },
  }),
  item("20260918-120000", {
    status: st("warning", [["SCAN_WARNINGS", "검토 필요 1건 (user-data)", "warning"]]),
    region: "us-east-1",
    scan: { errors: 0, warnings: 1, strict: false, passed: true, rules: ["user-data"] },
  }),
  item("20260912-020000", {
    label: "kOps 1.31 업그레이드 전",
    memo: "노드그룹 m6i.large 3대 시점, 복원 기준",
    modifiedByDashboard: true,
    status: st("critical", [["TEMPLATE_MISSING", "terraform.tf 없음", "critical"]]),
  }),
];

const CLI = {
  install: "npm install --prefix deploy/aws-snapshot",
  configure: "deploy/aws-snapshot/.env.example 을 .env 로 복사한 뒤 값을 채우세요",
  dryRun: "npm run export:dry --prefix deploy/aws-snapshot",
  export: "npm run export --prefix deploy/aws-snapshot",
  scan: "npm run scan --prefix deploy/aws-snapshot -- snapshots/<id>",
  readme: "deploy/aws-snapshot/README.md",
};

export function listResponse(patch: Partial<ListResponse> = {}): ListResponse {
  return {
    dataSource: "mock",
    generatedAt: T,
    revision: 1,
    summary: snapshotSummary(),
    total: SNAP_ITEMS.length,
    filteredTotal: SNAP_ITEMS.length,
    offset: 0,
    limit: null,
    regions: ["ap-northeast-2", "us-east-1"],
    items: SNAP_ITEMS,
    cli: CLI,
    ...patch,
  };
}

const V_CFN = `sha256:${"a".repeat(64)}`;
const V_TF = `sha256:${"b".repeat(64)}`;

function fileInfo(kind: SnapshotFileInfo["kind"], name: string, patch: Partial<SnapshotFileInfo> = {}): SnapshotFileInfo {
  return {
    kind,
    name,
    exists: true,
    sizeBytes: 5792,
    lineCount: 255,
    modifiedAt: T,
    version: `sha256:${kind.charAt(0).repeat(64).replace(/[^a-f]/g, "c")}`,
    eol: "lf",
    bom: false,
    encoding: "utf-8",
    indent: { style: "spaces", size: 2 },
    editable: kind === "mapping" || kind === "metadata" ? { allowed: false, reasonCode: "FILE_KIND_READ_ONLY", reasonText: "이 파일은 보기 전용입니다" } : OK,
    viewTruncated: false,
    ...patch,
  };
}

export const FINDINGS: ScanFindingApi[] = [
  { file: "cloudformation.yml", fileKind: "cloudformation", line: 3, rule: "url-credentials", severity: "error", message: "URL 안에 사용자:비밀번호가 들어 있습니다 (연결 문자열)" },
  { file: "terraform.tf", fileKind: "terraform", line: 2, rule: "env-block", severity: "error", message: "환경 변수 블록입니다" },
  { file: "terraform.tf", fileKind: "terraform", line: 4, rule: "user-data", severity: "warn", message: "UserData(부트스트랩 스크립트)입니다" },
  { file: "metadata.json", fileKind: "metadata", line: 7, rule: "aws-account-id", severity: "warn", message: "계정 ID ********9012" },
];

export function detailData(patch: Partial<SnapshotDetailData> = {}): SnapshotDetailData {
  const base = SNAP_ITEMS[1];
  return {
    ...base,
    scan: {
      current: {
        summary: base.scan,
        scannedFiles: ["cloudformation.yml", "logical-id-mapping.json", "metadata.json", "terraform.tf"],
        findings: FINDINGS,
        scannedAt: T,
      },
      atExport: { errors: 3, warnings: 1, strict: false, passed: false, rules: ["env-block", "url-credentials", "user-data"] },
    },
    files: [
      fileInfo("cloudformation", "cloudformation.yml", { version: V_CFN }),
      fileInfo("terraform", "terraform.tf", { version: V_TF }),
      fileInfo("mapping", "logical-id-mapping.json"),
      fileInfo("metadata", "metadata.json"),
    ],
    extraFiles: [
      { name: "notes.txt", type: "file", sizeBytes: 38 },
      { name: "raw-data.json", type: "file", sizeBytes: 120 },
    ],
    metadata: {
      state: "ok",
      error: null,
      fields: {
        schemaVersion: 1,
        createdAt: "2026-09-19T03:16:09.412Z",
        snapshotId: base.id,
        snapshotIdTimezone: "UTC",
        region: "ap-northeast-2",
        profile: "snapshot-export",
        searchFilter: "prod.k8s.example.com",
        regexFilter: null,
        services: { mode: "exclude", list: ["SecretsManager", "SSM", "Lambda"] },
        allowSensitiveServices: false,
        includeDefaultResources: false,
        cfnDeletionPolicy: "Retain",
        former2: { version: "0.2.83", args: ["generate", "--output-cloudformation", "<snapshot>/cloudformation.yml"] },
        node: "v22.12.0",
        account: { masked: true, ids: ["********9012"], note: "템플릿 안의 ARN 에는 계정 ID 가 원문으로 남아 있습니다" },
        resources: { cloudformation: 42, terraform: 44 },
        rawData: { saved: true, location: ".raw/20260919-031500" },
        secretScan: { errors: 3, warnings: 1, strict: false, passed: false, rules: ["env-block", "url-credentials", "user-data"] },
      },
    },
    notes: { label: null, memo: null, updatedAt: null, version: `sha256:${"d".repeat(64)}`, fileExists: false },
    notices: [{ code: "RAW_DATA_ELSEWHERE", text: "raw 데이터는 .raw/ 에 있으며 이 화면에서 다루지 않습니다" }],
    ...patch,
  };
}

export function detailResponse(patch: Partial<SnapshotDetailData> = {}): DetailResponse {
  const snapshot = detailData(patch);
  return {
    dataSource: "mock",
    generatedAt: T,
    revision: 1,
    cli: { ...CLI, scan: CLI.scan.replace("<id>", snapshot.id) },
    snapshot,
  };
}

export const TF_CONTENT = 'resource "aws_db_instance" "main" {\n  environment { DB_PASSWORD = "example-password" }\n  engine = "postgres"\n  user_data = "echo hi"\n}\n';
export const CFN_CONTENT = "Resources:\n  Db:\n    Url: postgres://app:example-password@db.example.internal/app\n";

export function fileResponse(kind: "cloudformation" | "terraform" | "mapping", patch: Partial<FileResponse> = {}): FileResponse {
  const content = kind === "terraform" ? TF_CONTENT : kind === "cloudformation" ? CFN_CONTENT : "{\n  \"a\": 1\n}\n";
  return {
    dataSource: "mock",
    generatedAt: T,
    snapshotId: SNAP_ITEMS[1].id,
    kind,
    name: kind === "terraform" ? "terraform.tf" : kind === "cloudformation" ? "cloudformation.yml" : "logical-id-mapping.json",
    content,
    version: kind === "terraform" ? V_TF : kind === "cloudformation" ? V_CFN : `sha256:${"e".repeat(64)}`,
    sizeBytes: content.length,
    lineCount: content.split("\n").length - 1,
    eol: "lf",
    bom: false,
    encoding: "utf-8",
    indent: { style: "spaces", size: 2 },
    modifiedAt: T,
    truncated: false,
    returnedBytes: content.length,
    editable: kind === "mapping" ? { allowed: false, reasonCode: "FILE_KIND_READ_ONLY", reasonText: "이 파일은 보기 전용입니다" } : OK,
    findings: FINDINGS.filter((f) => f.fileKind === kind),
    resourceCount: kind === "mapping" ? null : 44,
    ...patch,
  };
}

export function templateCheck(patch: Partial<TemplateCheck> = {}): TemplateCheck {
  return {
    findings: [],
    errors: 0,
    warnings: 0,
    syntax: { checked: false, errors: [] },
    resources: { before: 44, after: 44 },
    unchanged: false,
    snapshotScanAfter: { errors: 1, warnings: 1, strict: false, passed: false, rules: ["url-credentials", "user-data"] },
    confirmationsRequired: [],
    ...patch,
  };
}

export const TRASH: TrashResponse = {
  dataSource: "mock",
  generatedAt: T,
  total: 1,
  filteredTotal: 1,
  offset: 0,
  limit: null,
  items: [
    {
      trashId: "20260901-000000__20260910T010203000Z",
      snapshotId: "20260901-000000",
      snapshotAt: "2026-09-01T00:00:00.000Z",
      deletedAt: "2026-09-10T01:02:03.000Z",
      label: "테스트 내보내기",
      region: "ap-northeast-2",
      files: ["cloudformation.yml", "logical-id-mapping.json", "metadata.json", "notes.json", "terraform.tf"],
      sizeBytes: 2748,
      restore: OK,
    },
  ],
};
