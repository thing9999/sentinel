import { extname } from 'node:path';
import type { Reason, Status } from '../common/status';
import { reason, statusFromReasons } from '../common/status';
import type { RawEntry, RawSnapshot } from './backend';
import type { CliFinding, SnapshotScanner } from './scanner-loader';
import {
  FILE_KINDS,
  FILE_NAME,
  FILE_ORDER,
  KIND_BY_NAME,
  KNOWN_FILES,
  NOTES_FILE,
  TMP_FILE_RE,
  snapshotIdToIso,
  type FileKind,
} from './snapshot.constants';
import {
  decodeLikeCli,
  sha256Version,
  textFacts,
  type Eol,
} from './text-utils';

export interface ScanFinding {
  file: string;
  fileKind: FileKind | 'notes' | null;
  line: number;
  rule: string;
  severity: 'error' | 'warn';
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

export interface FileFact {
  kind: FileKind;
  name: string;
  exists: boolean;
  sizeBytes: number | null;
  lineCount: number | null;
  modifiedAt: string | null;
  version: string | null;
  eol: Eol | null;
  bom: boolean | null;
  encoding: 'utf-8' | 'unknown' | null;
  indent: { style: 'spaces' | 'tabs'; size: number | null } | null;
  readError: string | null;
}

export interface NotesInfo {
  label: string | null;
  memo: string | null;
  updatedAt: string | null;
  version: string;
  fileExists: boolean;
  corrupt: boolean;
  /** 파일 바이트 버전 (쓰기 직전 확인용) */
  fileVersion: string | null;
  raw: Record<string, unknown> | null;
  templateEdits: Partial<
    Record<FileKind, { savedAt?: string; version?: string }>
  >;
}

export type MetadataState = 'ok' | 'missing' | 'corrupt' | 'schema_mismatch';

export interface Analysis {
  id: string;
  snapshotAt: string | null;
  analyzedAt: string;
  files: Record<FileKind, FileFact>;
  extraFiles: { name: string; type: string; sizeBytes: number | null }[];
  metadata: {
    state: MetadataState;
    error: string | null;
    fields: Record<string, unknown> | null;
  };
  notes: NotesInfo;
  scan: {
    summary: ScanSummary;
    scannedFiles: string[];
    findings: ScanFinding[];
    scannedAt: string;
  };
  atExportScan: ScanSummary | null;
  resources: { current: ResourceCounts; atExport: ResourceCounts | null };
  region: string | null;
  scope: {
    searchFilter: string | null;
    regexFilter: string | null;
    services: { mode: 'include' | 'exclude'; list: string[] } | null;
  } | null;
  former2Version: string | null;
  rawDataSaved: boolean;
  lastModifiedAt: string | null;
  lastChangeMs: number;
  inProgress: boolean;
  modifiedByDashboard: boolean;
  status: Status;
  reasons: Reason[];
  notices: { code: string; text: string }[];
}

export interface AnalyzeOptions {
  nowMs: number;
  inProgressMinutes: number;
}

const METADATA_FIELDS = [
  'schemaVersion',
  'createdAt',
  'snapshotId',
  'snapshotIdTimezone',
  'region',
  'profile',
  'searchFilter',
  'regexFilter',
  'services',
  'allowSensitiveServices',
  'includeDefaultResources',
  'cfnDeletionPolicy',
  'former2',
  'node',
  'account',
  'resources',
  'rawData',
  'secretScan',
];
const REQUIRED_METADATA = ['snapshotId', 'region', 'resources', 'secretScan'];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** JSON 오류 위치만 (내용 조각 없이) */
export function jsonErrorPosition(text: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : '';
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return `JSON 해석 실패 (줄 ${lc[1]}, 열 ${lc[2]})`;
  const pos = /position (\d+)/.exec(msg);
  if (pos) {
    const p = Math.min(Number(pos[1]), text.length);
    const before = text.slice(0, p);
    const line = before.split('\n').length;
    const col = p - before.lastIndexOf('\n');
    return `JSON 해석 실패 (줄 ${line}, 열 ${col})`;
  }
  return 'JSON 해석 실패';
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function notesVersion(label: string, memo: string): string {
  return sha256Version(JSON.stringify({ label, memo }));
}

export function parseNotes(bytes: Buffer | null): NotesInfo {
  const empty: NotesInfo = {
    label: null,
    memo: null,
    updatedAt: null,
    version: notesVersion('', ''),
    fileExists: false,
    corrupt: false,
    fileVersion: null,
    raw: null,
    templateEdits: {},
  };
  if (!bytes) return empty;
  const fileVersion = sha256Version(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(bytes.toString('utf8')));
  } catch {
    parsed = undefined;
  }
  if (
    !isObj(parsed) ||
    (parsed.label !== undefined && typeof parsed.label !== 'string') ||
    (parsed.memo !== undefined && typeof parsed.memo !== 'string')
  ) {
    return { ...empty, fileExists: true, corrupt: true, fileVersion };
  }
  const label = typeof parsed.label === 'string' ? parsed.label : '';
  const memo = typeof parsed.memo === 'string' ? parsed.memo : '';
  const edits: NotesInfo['templateEdits'] = {};
  if (isObj(parsed.templateEdits)) {
    for (const k of FILE_KINDS) {
      const e = parsed.templateEdits[k];
      if (isObj(e))
        edits[k] = {
          savedAt: str(e.savedAt) ?? undefined,
          version: str(e.version) ?? undefined,
        };
    }
  }
  return {
    label: label === '' ? null : label,
    memo: memo === '' ? null : memo,
    updatedAt: str(parsed.updatedAt),
    version: notesVersion(label, memo),
    fileExists: true,
    corrupt: false,
    fileVersion,
    raw: parsed,
    templateEdits: edits,
  };
}

function toFinding(f: CliFinding): ScanFinding {
  const top = !f.file.includes('/');
  const kind = top ? (KIND_BY_NAME[f.file] ?? null) : null;
  return {
    file: f.file,
    fileKind: kind,
    line: f.line,
    rule: f.rule,
    severity: f.severity,
    message: f.message,
  };
}

function fileRank(file: string): number {
  const i = FILE_ORDER.indexOf(file);
  return i >= 0 ? i : FILE_ORDER.length;
}

export function sortFindings(list: ScanFinding[]): ScanFinding[] {
  return [...list].sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
      fileRank(a.file) - fileRank(b.file) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
}

export function summarizeFindings(
  scanner: SnapshotScanner,
  findings: { severity: 'error' | 'warn'; rule: string }[],
  strict: boolean,
): ScanSummary {
  const s = scanner.summarize(findings as CliFinding[], { strict });
  return {
    errors: s.errors,
    warnings: s.warnings,
    strict,
    passed: s.passed,
    rules: [...new Set(findings.map((f) => f.rule))].sort(),
  };
}

/** 스냅샷 폴더 전체 스캔 (CLI scanPaths와 같은 파일 선택, 링크 제외) */
export function scanEntries(
  scanner: SnapshotScanner,
  entries: RawEntry[],
  override?: { path: string; text: string },
): { scannedFiles: string[]; findings: CliFinding[] } {
  const scannedFiles: string[] = [];
  const findings: CliFinding[] = [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const base = e.path.split('/').pop()!;
    // CLI와 같은 path.extname (".env" → "")
    if (!scanner.scannableExtensions.includes(extname(base).toLowerCase()))
      continue;
    if (TMP_FILE_RE.test(base)) continue;
    scannedFiles.push(e.path);
    let text: string | null = null;
    if (override && override.path === e.path) text = override.text;
    else if (e.content) text = decodeLikeCli(e.content);
    if (text !== null) findings.push(...scanner.scanText(text, e.path));
  }
  return { scannedFiles, findings };
}

function listNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} 외 ${names.length - max}개`;
}

const KIND_LABEL: Record<'cloudformation' | 'terraform', string> = {
  cloudformation: 'CloudFormation',
  terraform: 'Terraform',
};

export function analyzeSnapshot(
  raw: RawSnapshot,
  scanner: SnapshotScanner,
  opts: AnalyzeOptions,
): Analysis {
  const nowIso = new Date(opts.nowMs).toISOString();
  const byPath = new Map(raw.entries.map((e) => [e.path, e]));
  const reasons: Reason[] = [];
  const notices: { code: string; text: string }[] = [];
  const unreadable: string[] = [];

  // --- 파일 정보 ---
  const files = {} as Record<FileKind, FileFact>;
  for (const kind of FILE_KINDS) {
    const name = FILE_NAME[kind];
    const e = byPath.get(name);
    if (!e || e.type !== 'file') {
      files[kind] = {
        kind,
        name,
        exists: false,
        sizeBytes: null,
        lineCount: null,
        modifiedAt: null,
        version: null,
        eol: null,
        bom: null,
        encoding: null,
        indent: null,
        readError: null,
      };
      continue;
    }
    if (!e.content) {
      unreadable.push(`${name}: ${e.readError ?? 'EIO'}`);
      files[kind] = {
        kind,
        name,
        exists: true,
        sizeBytes: e.size,
        lineCount: null,
        modifiedAt: new Date(e.mtimeMs).toISOString(),
        version: null,
        eol: null,
        bom: null,
        encoding: null,
        indent: null,
        readError: e.readError ?? 'EIO',
      };
      continue;
    }
    const facts = textFacts(e.content);
    files[kind] = {
      kind,
      name,
      exists: true,
      sizeBytes: e.content.length,
      lineCount: facts.lineCount,
      modifiedAt: new Date(e.mtimeMs).toISOString(),
      version: sha256Version(e.content),
      eol: facts.eol,
      bom: facts.bom,
      encoding: facts.utf8 ? 'utf-8' : 'unknown',
      indent: facts.indent,
      readError: null,
    };
  }
  for (const e of raw.entries) {
    if (
      e.type === 'file' &&
      !e.content &&
      e.readError &&
      !KNOWN_FILES.has(e.path)
    )
      unreadable.push(`${e.path}: ${e.readError}`);
  }

  // --- 메타데이터 ---
  const metaEntry = byPath.get(FILE_NAME.metadata);
  let metaState: MetadataState = 'missing';
  let metaError: string | null = null;
  let meta: Json | null = null;
  if (metaEntry && metaEntry.type === 'file' && metaEntry.content) {
    const text = stripBom(metaEntry.content.toString('utf8'));
    try {
      const parsed: unknown = JSON.parse(text);
      if (isObj(parsed)) {
        meta = parsed;
        const missing = REQUIRED_METADATA.filter((k) => meta![k] === undefined);
        metaState =
          missing.length > 0 || parsed.schemaVersion !== 1
            ? 'schema_mismatch'
            : 'ok';
      } else {
        metaState = 'corrupt';
        metaError = 'JSON 해석 실패 (객체가 아님)';
      }
    } catch (err) {
      metaState = 'corrupt';
      metaError = jsonErrorPosition(text, err);
    }
  }
  const fields = meta
    ? Object.fromEntries(
        METADATA_FIELDS.filter((k) => meta[k] !== undefined).map((k) => [
          k,
          meta[k],
        ]),
      )
    : null;
  const secretScan = meta && isObj(meta.secretScan) ? meta.secretScan : null;
  const strict = secretScan?.strict === true;

  // --- 라벨·메모 ---
  const notesEntry = byPath.get(NOTES_FILE);
  const notes = parseNotes(
    notesEntry && notesEntry.type === 'file' ? notesEntry.content : null,
  );

  // --- 스캔 ---
  const { scannedFiles, findings: cli } = scanEntries(scanner, raw.entries);
  const findings = sortFindings(cli.map(toFinding));
  const summary = summarizeFindings(scanner, findings, strict);

  // --- 리소스 수 ---
  const textOf = (kind: FileKind): string | null => {
    const e = byPath.get(FILE_NAME[kind]);
    return e?.content ? decodeLikeCli(e.content) : null;
  };
  const cfnText = textOf('cloudformation');
  const tfText = textOf('terraform');
  const current: ResourceCounts = {
    cloudformation:
      cfnText === null ? null : scanner.countCloudFormationResources(cfnText),
    terraform: tfText === null ? null : scanner.countTerraformResources(tfText),
  };
  const res = meta && isObj(meta.resources) ? meta.resources : null;
  const atExport: ResourceCounts | null = res
    ? { cloudformation: num(res.cloudformation), terraform: num(res.terraform) }
    : null;

  // --- 시각 ---
  let lastChangeMs = raw.dirMtimeMs;
  let lastKnownMs = 0;
  for (const e of raw.entries) {
    lastChangeMs = Math.max(lastChangeMs, e.mtimeMs);
    if (KNOWN_FILES.has(e.path)) lastKnownMs = Math.max(lastKnownMs, e.mtimeMs);
  }

  // --- 예상 밖 항목 ---
  const top = raw.entries.filter(
    (e) => !e.path.includes('/') && !TMP_FILE_RE.test(e.path),
  );
  const extra = top.filter(
    (e) => !(KNOWN_FILES.has(e.path) && e.type === 'file'),
  );
  const links = raw.entries.filter((e) => e.type === 'symlink');

  // --- 판단 (계약 10.1) ---
  if (summary.errors > 0) {
    const rules = [
      ...new Set(
        findings.filter((f) => f.severity === 'error').map((f) => f.rule),
      ),
    ].sort();
    reasons.push(
      reason(
        'SCAN_SECRET_ERRORS',
        `비밀값 의심 ${summary.errors}건 (${listNames(rules)})`,
        'critical',
      ),
    );
  }
  if (metaState === 'corrupt')
    reasons.push(
      reason(
        'METADATA_CORRUPT',
        'metadata.json 손상 (JSON 해석 실패)',
        'critical',
      ),
    );
  const missingTemplates = (['cloudformation', 'terraform'] as const)
    .filter((k) => !files[k].exists)
    .map((k) => FILE_NAME[k]);
  if (missingTemplates.length)
    reasons.push(
      reason(
        'TEMPLATE_MISSING',
        `${missingTemplates.join(', ')} 없음`,
        'critical',
      ),
    );
  const rawFiles = raw.entries.filter((e) => {
    const base = e.path.split('/').pop()!;
    return (
      e.type === 'file' &&
      (base === 'raw-data.json' || base.endsWith('.raw.json'))
    );
  });
  if (rawFiles.length)
    reasons.push(
      reason(
        'RAW_DATA_PRESENT',
        'raw 데이터 파일이 스냅샷 폴더에 있음 (비밀값 포함 가능, git 제외 경로로 옮기세요)',
        'critical',
      ),
    );
  if (strict && summary.warnings > 0)
    reasons.push(
      reason(
        'STRICT_SCAN_WARNINGS',
        `strict 스냅샷: 경고 ${summary.warnings}건`,
        'critical',
      ),
    );
  if (!strict && summary.warnings > 0) {
    const rules = [
      ...new Set(
        findings.filter((f) => f.severity === 'warn').map((f) => f.rule),
      ),
    ].sort();
    reasons.push(
      reason(
        'SCAN_WARNINGS',
        `검토 필요 ${summary.warnings}건 (${listNames(rules)})`,
        'warning',
      ),
    );
  }
  let inProgress = false;
  if (metaState === 'missing') {
    const recent = opts.nowMs - lastChangeMs < opts.inProgressMinutes * 60_000;
    if (recent) {
      inProgress = true;
      reasons.push(
        reason(
          'EXPORT_MAYBE_IN_PROGRESS',
          '내보내기 진행 중일 수 있음',
          'unknown',
        ),
      );
    } else {
      reasons.push(reason('METADATA_MISSING', 'metadata.json 없음', 'warning'));
    }
  }
  if (metaState === 'schema_mismatch') {
    const v = meta?.schemaVersion;
    reasons.push(
      reason(
        'METADATA_SCHEMA_MISMATCH',
        v !== 1 && v !== undefined
          ? `메타데이터 형식이 다름 (schemaVersion ${JSON.stringify(v)})`
          : '메타데이터 형식이 다름 (필수 항목 없음)',
        'warning',
      ),
    );
  }
  if (meta && typeof meta.snapshotId === 'string' && meta.snapshotId !== raw.id)
    reasons.push(
      reason(
        'SNAPSHOT_ID_MISMATCH',
        '폴더 이름과 메타데이터 ID 불일치',
        'warning',
      ),
    );
  if (!files.mapping.exists)
    reasons.push(
      reason(
        'MAPPING_MISSING',
        'logical-id-mapping.json 없음 (import 대응표)',
        'warning',
      ),
    );
  for (const k of ['cloudformation', 'terraform'] as const) {
    if (current[k] === 0)
      reasons.push(
        reason('RESOURCES_ZERO', `${KIND_LABEL[k]} 리소스 0개`, 'warning'),
      );
  }
  if (meta?.allowSensitiveServices === true)
    reasons.push(
      reason(
        'SENSITIVE_SERVICES_ALLOWED',
        '민감 서비스 포함 설정으로 내보냄',
        'warning',
      ),
    );
  if (isObj(meta?.account) && meta.account.masked === false)
    reasons.push(
      reason('ACCOUNT_ID_UNMASKED', '메타데이터에 계정 ID 원문', 'warning'),
    );
  if (extra.length || links.length) {
    let text = extra.length
      ? `예상 밖 파일 ${extra.length}개 (${listNames(extra.map((e) => e.path))})`
      : '예상 밖 파일 0개';
    if (links.length) text += ` (링크 ${links.length}개, 따라가지 않음)`;
    reasons.push(reason('UNEXPECTED_FILES', text, 'warning'));
  }
  if (notes.corrupt)
    reasons.push(
      reason(
        'NOTES_CORRUPT',
        'notes.json 손상 (라벨·메모를 읽을 수 없음)',
        'warning',
      ),
    );
  if (unreadable.length)
    reasons.push(
      reason(
        'FILE_UNREADABLE',
        `파일을 읽을 수 없음 (${listNames(unreadable, 2)})`,
        'unknown',
      ),
    );
  // 내보내기 진행 중일 수 있으면 파일이 아직 덜 쓰였을 수 있다: 주의 사유(매핑 없음 등)는 빼고
  // 장애(비밀값 등)와 진행 중 사유만 남긴다 → 상태는 unknown (장애가 있으면 critical)
  const judged = statusFromReasons(
    inProgress
      ? reasons.filter((r) => r.status === 'critical' || r.status === 'unknown')
      : reasons,
  );

  // --- 정보 문구 ---
  if (meta) {
    if (!str(meta.searchFilter) && !str(meta.regexFilter))
      notices.push({
        code: 'FILTER_NONE',
        text: '필터 없음: 선택한 서비스의 리전 내 전체',
      });
    if (
      meta.cfnDeletionPolicy !== undefined &&
      meta.cfnDeletionPolicy !== 'Retain'
    )
      notices.push({
        code: 'DELETION_POLICY_NOT_RETAIN',
        text: `DeletionPolicy ${JSON.stringify(meta.cfnDeletionPolicy)}: README는 Retain 권장`,
      });
  }
  if (atExport) {
    const parts: string[] = [];
    for (const k of ['cloudformation', 'terraform'] as const) {
      if (
        atExport[k] !== null &&
        current[k] !== null &&
        atExport[k] !== current[k]
      )
        parts.push(`${KIND_LABEL[k]} ${atExport[k]} → ${current[k]}`);
    }
    if (parts.length)
      notices.push({
        code: 'RESOURCES_CHANGED_SINCE_EXPORT',
        text: `내보내기 후 변경됨: ${parts.join(', ')}`,
      });
  }
  const rawData = meta && isObj(meta.rawData) ? meta.rawData : null;
  if (rawData?.saved === true)
    notices.push({
      code: 'RAW_DATA_ELSEWHERE',
      text: 'raw 데이터는 .raw/ 에 있으며 이 화면에서 다루지 않습니다',
    });

  const services =
    meta && isObj(meta.services) && Array.isArray(meta.services.list)
      ? {
          mode:
            meta.services.mode === 'include'
              ? ('include' as const)
              : ('exclude' as const),
          list: meta.services.list.filter(
            (x): x is string => typeof x === 'string',
          ),
        }
      : null;
  const former2 = meta && isObj(meta.former2) ? meta.former2 : null;
  const modifiedByDashboard = (['cloudformation', 'terraform'] as const).some(
    (k) =>
      files[k].version !== null &&
      notes.templateEdits[k]?.version === files[k].version,
  );

  return {
    id: raw.id,
    snapshotAt: snapshotIdToIso(raw.id),
    analyzedAt: nowIso,
    files,
    extraFiles: extra.slice(0, 50).map((e) => ({
      name: e.path,
      type: e.type,
      sizeBytes: e.size,
    })),
    metadata: { state: metaState, error: metaError, fields },
    notes,
    scan: { summary, scannedFiles, findings, scannedAt: nowIso },
    atExportScan: secretScan
      ? {
          errors: num(secretScan.errors) ?? 0,
          warnings: num(secretScan.warnings) ?? 0,
          strict: secretScan.strict === true,
          passed: secretScan.passed === true,
          rules: Array.isArray(secretScan.rules)
            ? secretScan.rules.filter((x): x is string => typeof x === 'string')
            : [],
        }
      : null,
    resources: { current, atExport },
    region: meta ? str(meta.region) : null,
    scope: meta
      ? {
          searchFilter: str(meta.searchFilter),
          regexFilter: str(meta.regexFilter),
          services,
        }
      : null,
    former2Version: former2 ? str(former2.version) : null,
    rawDataSaved: rawData?.saved === true,
    lastModifiedAt:
      lastKnownMs > 0 ? new Date(lastKnownMs).toISOString() : null,
    lastChangeMs,
    inProgress,
    modifiedByDashboard,
    status: judged.status,
    reasons: judged.reasons,
    notices,
  };
}
