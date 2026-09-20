/**
 * aws-snapshot-manager 상수 (docs/api/aws-snapshot-manager.md)
 */

/** 스냅샷 ID: 폴더 이름 YYYYMMDD-HHmmss (UTC) */
export const SNAPSHOT_ID_RE = /^\d{8}-\d{6}$/;
/** 휴지통 항목: <snapshotId>__<YYYYMMDDTHHmmssSSSZ> */
export const TRASH_ID_RE = /^(\d{8}-\d{6})__(\d{8}T\d{9}Z)$/;

export const TRASH_DIR = '.trash';
/** 루트에서 "인식하지 못한 항목"으로 세지 않는 이름 */
export const ROOT_IGNORED = new Set(['.gitkeep', TRASH_DIR]);

export const FILE_KINDS = [
  'cloudformation',
  'terraform',
  'mapping',
  'metadata',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const EDITABLE_KINDS: readonly FileKind[] = [
  'cloudformation',
  'terraform',
];

export const FILE_NAME: Record<FileKind, string> = {
  cloudformation: 'cloudformation.yml',
  terraform: 'terraform.tf',
  mapping: 'logical-id-mapping.json',
  metadata: 'metadata.json',
};
export const NOTES_FILE = 'notes.json';
export const KNOWN_FILES = new Set<string>([
  ...Object.values(FILE_NAME),
  NOTES_FILE,
]);
export const KIND_BY_NAME: Record<string, FileKind | 'notes'> = {
  'cloudformation.yml': 'cloudformation',
  'terraform.tf': 'terraform',
  'logical-id-mapping.json': 'mapping',
  'metadata.json': 'metadata',
  'notes.json': 'notes',
};
/** 발견 정렬용 파일 순서 (디자인 status.md 5.2) */
export const FILE_ORDER: string[] = [
  'cloudformation.yml',
  'terraform.tf',
  'logical-id-mapping.json',
  'metadata.json',
  'notes.json',
];

/** 원자적 쓰기 임시 파일: .<이름>.sentinel-tmp-<랜덤> */
export const TMP_FILE_RE = /^\..+\.sentinel-tmp-[0-9a-f]+$/;

export const CONFIRM_VALUES = [
  'secret_errors',
  'yaml_syntax',
  'resource_decrease',
] as const;
export type ConfirmValue = (typeof CONFIRM_VALUES)[number];

export const MOCK_SCENARIOS = [
  'default',
  'empty',
  'not-configured',
  'unavailable',
  'read-only',
  'write-disabled',
  'conflict-once',
] as const;
export type SnapshotMockScenario = (typeof MOCK_SCENARIOS)[number];

export const LABEL_MAX = 60;
export const MEMO_MAX = 2000;
export const VIEW_MIN_BYTES = 20 * 1024 * 1024;
export const STALE_AFTER_SEC = 90;

export const CLI_COMMANDS = {
  install: 'npm install --prefix deploy/aws-snapshot',
  configure:
    'deploy/aws-snapshot/.env.example 을 .env 로 복사한 뒤 값을 채우세요',
  dryRun: 'npm run export:dry --prefix deploy/aws-snapshot',
  export: 'npm run export --prefix deploy/aws-snapshot',
  scan: 'npm run scan --prefix deploy/aws-snapshot -- snapshots/<id>',
  readme: 'deploy/aws-snapshot/README.md',
};

export const SETUP_HINT = {
  envVar: 'AWS_SNAPSHOT_DIR',
  dockerMount: './deploy/aws-snapshot/snapshots:/data/aws-snapshots',
  localExample: 'AWS_SNAPSHOT_DIR=../../deploy/aws-snapshot/snapshots',
};

/** 폴더 이름 → UTC ISO. 달력에 없는 날짜면 null */
export function snapshotIdToIso(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(id);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const dt = new Date(t);
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d ||
    dt.getUTCHours() !== h ||
    dt.getUTCMinutes() !== mi ||
    dt.getUTCSeconds() !== s
  )
    return null;
  return dt.toISOString();
}

/** 2026-09-19T05:02:10.123Z → 20260919T050210123Z */
export function compactStamp(ms: number): string {
  const iso = new Date(ms).toISOString(); // 2026-09-19T05:02:10.123Z
  return iso.replace(/[-:.]/g, '');
}

/** 20260919T050210123Z → ISO */
export function compactStampToIso(stamp: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(stamp);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
