import { parseAllDocuments } from 'yaml';
import { jsonErrorPosition, parseNotes } from '../aws-snapshots/analyzer';
import type { RawEntry, RawSnapshot } from '../aws-snapshots/backend';
import {
  decodeLikeCli,
  sha256Version,
  textFacts,
  type Eol,
} from '../aws-snapshots/text-utils';
import {
  reason,
  statusFromReasons,
  type Reason,
  type Status,
} from '../common/status';
import type {
  CliFinding,
  K8sRules,
  K8sScanner,
  Obj,
  PathClass,
} from './k8s-libs';
import {
  DATA_NOT_INCLUDED_TEXT,
  METADATA_FILE,
  NOTES_FILE,
  SECRET_REFS_FILE,
  TMP_FILE_RE,
} from './k8s.constants';

export type K8sFileType =
  'resource' | 'namespace' | 'metadata' | 'secret_refs' | 'notes' | 'other';

export interface ResourceIdentity {
  apiGroup: string;
  apiVersion: string;
  kind: string;
  namespace: string | null;
  name: string;
}

export interface ExpectedIdentity {
  apiGroup: string;
  kind: string | null;
  namespace: string | null;
  name: string;
}

export type ParseState =
  'ok' | 'yaml_error' | 'multi_document' | 'not_object' | 'too_large' | 'empty';

export interface K8sScanFinding {
  file: string;
  fileType: K8sFileType;
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

export interface YamlError {
  line: number;
  column: number;
  code: string;
  message: string;
}

export interface SnapDoc {
  path: string;
  index: number;
  identity: ResourceIdentity;
  key: string;
  obj: Obj;
}

export interface K8sFileFact {
  path: string;
  fileType: K8sFileType;
  resource: ResourceIdentity | null;
  resourceKey: string | null;
  documents: ResourceIdentity[];
  /** documents 와 같은 순서의 문서 시작 줄(1부터, snapshot-3d 4.1). 응답에는 그래프에서만 쓴다 */
  docLines: number[];
  expected: ExpectedIdentity | null;
  parse: ParseState;
  parseError: YamlError | null;
  pathMatches: boolean;
  duplicate: boolean;
  duplicateOf: string[];
  runtimeFields: string[];
  helmManaged: boolean;
  findings: { errors: number; warnings: number };
  sizeBytes: number | null;
  lineCount: number | null;
  modifiedAt: string | null;
  version: string | null;
  eol: Eol | null;
  bom: boolean | null;
  encoding: 'utf-8' | 'unknown' | null;
  indent: { style: 'spaces' | 'tabs'; size: number | null } | null;
  readError: string | null;
  kindDir: string | null;
  namespaceDir: string | null;
}

export type MetadataState = 'ok' | 'missing' | 'corrupt' | 'schema_mismatch';

export interface K8sNotes {
  label: string | null;
  memo: string | null;
  updatedAt: string | null;
  version: string;
  fileExists: boolean;
  corrupt: boolean;
  fileVersion: string | null;
  raw: Record<string, unknown> | null;
  fileEdits: Record<string, { savedAt?: string; version?: string }>;
}

export interface SecretRefsView {
  state: 'ok' | 'missing' | 'corrupt' | 'schema_mismatch';
  count: number;
  secrets: unknown[];
  /** secret-refs.json 의 note (CLI 안내 문구). 없으면 null */
  note: string | null;
}

export interface K8sAnalysis {
  id: string;
  snapshotAt: string | null;
  analyzedAt: string;
  status: Status;
  reasons: Reason[];
  notices: { code: string; text: string }[];
  metadata: {
    state: MetadataState;
    error: string | null;
    fields: Obj | null;
  };
  metaRaw: Obj | null;
  cluster: {
    id: string | null;
    context: string | null;
    name: string | null;
    serverVersion: string | null;
  } | null;
  scope: {
    namespaceMode: 'all_except_system' | 'include' | 'exclude';
    namespaces: string[];
    missingNamespaces: string[];
    systemIncluded: string[];
    /** exclude 모드의 제외 목록 (scope.namespaces.exclude) */
    excludeNamespaces: string[];
    kindCount: number;
    optionalKinds: string[];
    customResources: string[];
    includeHelmManaged: boolean;
  } | null;
  cleanupVersion: number | null;
  files: K8sFileFact[];
  docs: SnapDoc[];
  unparsable: { path: string; reason: string }[];
  extraFiles: { name: string; type: string; sizeBytes: number | null }[];
  scan: {
    summary: ScanSummary;
    scannedFiles: string[];
    findings: K8sScanFinding[];
    scannedAt: string;
  };
  atExportScan: ScanSummary | null;
  notes: K8sNotes;
  secretRefs: SecretRefsView;
  resourcesTotal: number;
  atExportTotal: number | null;
  helmManaged: number;
  partialKinds: { id: string; result: 'forbidden' | 'not_found' | 'error' }[];
  lastModifiedAt: string | null;
  lastChangeMs: number;
  inProgress: boolean;
  modifiedByDashboard: boolean;
  cliVersion: string | null;
  folder: {
    fileCount: number;
    sizeBytes: number;
    topLevel: {
      name: string;
      type: string;
      fileCount: number;
      unexpected?: boolean;
    }[];
  };
  /** 파일 → 발견 (정렬 전 원본) */
  fileFindings: Map<string, K8sScanFinding[]>;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function snapshotIdToIso(id: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(id);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
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

export function fileTypeOf(c: PathClass | null): K8sFileType {
  if (!c) return 'other';
  return c.type;
}

export function resourceKeyOf(id: {
  apiGroup: string;
  kind: string;
  namespace: string | null;
  name: string;
}): string {
  return `${id.apiGroup || 'core'}/${id.kind}/${id.namespace ?? '_cluster'}/${id.name}`;
}

/** YAML 구문 오류 (파서 원문 메시지 없이 위치·코드만) */
export function yamlErrors(text: string): YamlError[] {
  const out: YamlError[] = [];
  try {
    for (const doc of parseAllDocuments(text, { prettyErrors: true })) {
      for (const e of doc.errors) {
        out.push({
          line: e.linePos?.[0]?.line ?? 0,
          column: e.linePos?.[0]?.col ?? 0,
          code: e.code,
          message: `YAML 구문 오류 (${e.code})`,
        });
        if (out.length >= 50) return out;
      }
    }
  } catch {
    out.push({
      line: 0,
      column: 0,
      code: 'PARSE_FAILED',
      message: 'YAML 구문 오류 (PARSE_FAILED)',
    });
  }
  return out;
}

/**
 * YAML 문서들을 JS 값으로. 빈 문서는 뺀다. 구문 오류면 errors.
 * `lines[i]` = 문서 i 의 시작 줄(1부터. 여러 문서 파일의 블록 이동용, snapshot-3d 4.1)
 */
export function parseYamlDocs(text: string): {
  docs: unknown[];
  lines: number[];
  errors: YamlError[];
} {
  const errors = yamlErrors(text);
  if (errors.length) return { docs: [], lines: [], errors };
  const docs: unknown[] = [];
  const lines: number[] = [];
  try {
    for (const d of parseAllDocuments(text)) {
      if (d.contents === null) continue;
      const v = d.toJS({ maxAliasCount: 100 }) as unknown;
      if (v === null || v === undefined) continue;
      docs.push(v);
      lines.push(lineAt(text, d.range?.[0] ?? 0));
    }
  } catch {
    return {
      docs: [],
      lines: [],
      errors: [
        {
          line: 0,
          column: 0,
          code: 'PARSE_FAILED',
          message: 'YAML 구문 오류 (PARSE_FAILED)',
        },
      ],
    };
  }
  return { docs, lines, errors: [] };
}

/** 오프셋 → 줄 번호(1부터) */
function lineAt(text: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function identityOf(
  rules: K8sRules,
  obj: unknown,
): ResourceIdentity | null {
  if (!isObj(obj)) return null;
  const kind = str(obj.kind);
  const apiVersion = str(obj.apiVersion);
  const meta = isObj(obj.metadata) ? obj.metadata : {};
  const name = str(meta.name);
  if (!kind || !apiVersion || !name) return null;
  const { group } = rules.splitApiVersion(apiVersion);
  const ns = kind === 'Namespace' ? null : str(meta.namespace);
  return { apiGroup: group, apiVersion, kind, namespace: ns, name };
}

export function expectedOf(
  rules: K8sRules,
  c: PathClass | null,
): ExpectedIdentity | null {
  if (!c || !c.name) return null;
  if (c.type === 'namespace')
    return { apiGroup: '', kind: 'Namespace', namespace: null, name: c.name };
  if (c.type !== 'resource' || !c.kindDir) return null;
  const known = rules.kindById(c.kindDir);
  if (known)
    return {
      apiGroup: known.group,
      kind: known.kind,
      namespace: known.namespaced ? c.namespace : null,
      name: c.name,
    };
  const dot = c.kindDir.indexOf('.');
  return {
    apiGroup: dot > 0 ? c.kindDir.slice(dot + 1) : '',
    kind: null,
    namespace: c.namespace,
    name: c.name,
  };
}

export function identityMatches(
  id: ResourceIdentity | null,
  exp: ExpectedIdentity | null,
): boolean {
  if (!id || !exp) return false;
  return (
    id.apiGroup === exp.apiGroup &&
    (exp.kind === null || id.kind === exp.kind) &&
    id.namespace === exp.namespace &&
    id.name === exp.name
  );
}

const FILE_ORDER = [METADATA_FILE, SECRET_REFS_FILE, NOTES_FILE];
const fileRank = (f: string) => {
  const i = FILE_ORDER.indexOf(f);
  return i >= 0 ? i : FILE_ORDER.length;
};

export function sortK8sFindings(list: K8sScanFinding[]): K8sScanFinding[] {
  return [...list].sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
      fileRank(a.file) - fileRank(b.file) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.line - b.line ||
      (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0),
  );
}

export function summarizeK8s(
  scanner: K8sScanner,
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

export function parseK8sNotes(bytes: Buffer | null): K8sNotes {
  const n = parseNotes(bytes);
  const fileEdits: K8sNotes['fileEdits'] = {};
  const raw = n.raw;
  if (raw && isObj(raw.fileEdits)) {
    for (const [p, e] of Object.entries(raw.fileEdits)) {
      if (isObj(e))
        fileEdits[p] = {
          savedAt: str(e.savedAt) ?? undefined,
          version: str(e.version) ?? undefined,
        };
    }
  }
  return {
    label: n.label,
    memo: n.memo,
    updatedAt: n.updatedAt,
    version: n.version,
    fileExists: n.fileExists,
    corrupt: n.corrupt,
    fileVersion: n.fileVersion,
    raw: n.raw,
    fileEdits,
  };
}

function listNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} 외 ${names.length - max}개`;
}

const REQUIRED_META = [
  'snapshotId',
  'cluster',
  'scope',
  'kinds',
  'resources',
  'secretScan',
];
const META_FIELDS = [
  'schemaVersion',
  'snapshotId',
  'snapshotIdTimezone',
  'createdAt',
  'tool',
  'cluster',
  'scope',
  'kinds',
  'resources',
  'cleanup',
  'secrets',
  'secretScan',
];

const NS_DIR_RE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const KIND_DIR_RE = /^[a-z0-9]+(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

function expectedEntry(e: RawEntry, rules: K8sRules): boolean {
  const parts = e.path.split('/');
  if (e.type === 'file') return rules.classifyPath(e.path) !== null;
  if (e.type !== 'directory') return false;
  if (parts.length === 1)
    return NS_DIR_RE.test(parts[0]) || parts[0] === '_cluster';
  if (parts.length === 2)
    return (
      (NS_DIR_RE.test(parts[0]) || parts[0] === '_cluster') &&
      KIND_DIR_RE.test(parts[1])
    );
  return false;
}

export interface AnalyzeOptions {
  nowMs: number;
  inProgressMinutes: number;
}

/**
 * 스냅샷 하나를 판단한다 (docs/api/k8s-snapshot.md 11.1). 파일 시스템·클러스터를 부르지 않는 순수 함수.
 */
export function analyzeK8sSnapshot(
  raw: RawSnapshot,
  libs: { scanner: K8sScanner; rules: K8sRules },
  opt: AnalyzeOptions,
): K8sAnalysis {
  const { scanner, rules } = libs;
  const nowIso = new Date(opt.nowMs).toISOString();
  const entries = raw.entries.filter(
    (e) => !TMP_FILE_RE.test(e.path.split('/').pop()!),
  );
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const lastChangeMs = Math.max(
    raw.dirMtimeMs,
    ...entries.map((e) => e.mtimeMs),
  );

  // ---------------- metadata
  const metaEntry = byPath.get(METADATA_FILE);
  let metaRaw: Json | null = null;
  let metaState: MetadataState = 'missing';
  let metaError: string | null = null;
  if (metaEntry && metaEntry.type === 'file' && metaEntry.content) {
    const t = decodeLikeCli(metaEntry.content).replace(/^\uFEFF/, '');
    try {
      const v: unknown = JSON.parse(t);
      if (!isObj(v)) {
        metaState = 'corrupt';
        metaError = 'JSON 해석 실패 (객체가 아님)';
      } else {
        metaRaw = v;
        const cl = isObj(v.cluster) ? v.cluster : null;
        const missing =
          REQUIRED_META.some((k) => v[k] === undefined) ||
          !cl ||
          typeof cl.id !== 'string' ||
          cl.id === '' ||
          !isObj(v.cleanup) ||
          num(v.cleanup.rulesVersion) === null;
        metaState = missing || v.schemaVersion !== 1 ? 'schema_mismatch' : 'ok';
      }
    } catch (err) {
      metaState = 'corrupt';
      metaError = jsonErrorPosition(t, err);
    }
  } else if (metaEntry) {
    metaState = metaEntry.readError ? 'corrupt' : 'missing';
    if (metaEntry.readError) metaError = `읽기 실패 (${metaEntry.readError})`;
  }
  const inProgress =
    metaState === 'missing' &&
    opt.nowMs - lastChangeMs < opt.inProgressMinutes * 60_000;

  const clusterRaw = metaRaw && isObj(metaRaw.cluster) ? metaRaw.cluster : null;
  const cluster = metaRaw
    ? {
        id: clusterRaw ? str(clusterRaw.id) : null,
        context: clusterRaw ? str(clusterRaw.context) : null,
        name: clusterRaw ? str(clusterRaw.name) : null,
        serverVersion: clusterRaw ? str(clusterRaw.serverVersion) : null,
      }
    : null;
  const scopeRaw = metaRaw && isObj(metaRaw.scope) ? metaRaw.scope : null;
  const nsRaw =
    scopeRaw && isObj(scopeRaw.namespaces) ? scopeRaw.namespaces : null;
  const kindsScope = scopeRaw && isObj(scopeRaw.kinds) ? scopeRaw.kinds : null;
  const NS_MODES = ['all_except_system', 'include', 'exclude'] as const;
  const modeRaw = str(nsRaw?.mode);
  const mode = NS_MODES.find((m) => m === modeRaw) ?? null;
  const scope: K8sAnalysis['scope'] =
    scopeRaw && nsRaw && mode
      ? {
          namespaceMode: mode,
          namespaces: strArr(scopeRaw.exported),
          missingNamespaces: strArr(scopeRaw.missing),
          systemIncluded: strArr(nsRaw.systemIncluded),
          excludeNamespaces: strArr(nsRaw.exclude),
          kindCount:
            strArr(kindsScope?.default).length +
            strArr(kindsScope?.optional).length +
            strArr(kindsScope?.custom).length,
          optionalKinds: strArr(kindsScope?.optional),
          customResources: strArr(kindsScope?.custom),
          includeHelmManaged: scopeRaw.includeHelmManaged !== false,
        }
      : null;
  const cleanupVersion =
    metaRaw && isObj(metaRaw.cleanup)
      ? num(metaRaw.cleanup.rulesVersion)
      : null;
  const secretScanRaw =
    metaRaw && isObj(metaRaw.secretScan) ? metaRaw.secretScan : null;
  const strict = secretScanRaw?.strict === true;
  const metaFields: Json | null = metaRaw
    ? Object.fromEntries(
        META_FIELDS.filter((k) => metaRaw[k] !== undefined).map((k) => [
          k,
          metaRaw[k],
        ]),
      )
    : null;

  // ---------------- 스캔 (CLI 와 같은 파일 선택)
  const scannedFiles: string[] = [];
  const rawFindings: CliFinding[] = [];
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const base = e.path.split('/').pop()!;
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
    if (!scanner.scannableExtensions.includes(ext)) continue;
    scannedFiles.push(e.path);
    if (e.content)
      rawFindings.push(
        ...scanner.scanText(decodeLikeCli(e.content), e.path, {
          profile: 'k8s',
        }),
      );
  }
  const findings = sortK8sFindings(
    rawFindings.map((f) => ({
      file: f.file,
      fileType: fileTypeOf(rules.classifyPath(f.file)),
      line: f.line,
      rule: f.rule,
      severity: f.severity,
      message: f.message,
    })),
  );
  const fileFindings = new Map<string, K8sScanFinding[]>();
  for (const f of findings) {
    const l = fileFindings.get(f.file) ?? [];
    l.push(f);
    fileFindings.set(f.file, l);
  }
  const scanSummary = summarizeK8s(scanner, findings, strict);

  // ---------------- notes
  const notesEntry = byPath.get(NOTES_FILE);
  const notes = parseK8sNotes(
    notesEntry && notesEntry.type === 'file'
      ? (notesEntry.content ?? null)
      : null,
  );

  // ---------------- 파일
  const files: K8sFileFact[] = [];
  const docs: SnapDoc[] = [];
  const unparsable: { path: string; reason: string }[] = [];
  const extraFiles: K8sAnalysis['extraFiles'] = [];
  let linkCount = 0;
  let modifiedByDashboard = false;
  let helmManaged = 0;
  const identityFiles = new Map<string, string[]>();

  for (const e of entries) {
    if (!expectedEntry(e, rules)) {
      if (e.type === 'symlink') linkCount++;
      // 예상 밖 폴더 안의 항목은 폴더 하나로만 센다
      const parent = e.path.split('/').slice(0, -1).join('/');
      const parentEntry = parent ? byPath.get(parent) : null;
      if (parentEntry && !expectedEntry(parentEntry, rules)) continue;
      extraFiles.push({ name: e.path, type: e.type, sizeBytes: e.size });
      continue;
    }
    if (e.type !== 'file') continue;
    const cls = rules.classifyPath(e.path);
    if (!cls || cls.type === 'notes') continue;
    const facts = e.content ? textFacts(e.content) : null;
    const version = e.content ? sha256Version(e.content) : null;
    const ff = fileFindings.get(e.path) ?? [];
    const fact: K8sFileFact = {
      path: e.path,
      fileType: cls.type,
      resource: null,
      resourceKey: null,
      documents: [],
      docLines: [],
      expected: expectedOf(rules, cls),
      parse: 'ok',
      parseError: null,
      pathMatches: true,
      duplicate: false,
      duplicateOf: [],
      runtimeFields: [],
      helmManaged: false,
      findings: {
        errors: ff.filter((x) => x.severity === 'error').length,
        warnings: ff.filter((x) => x.severity === 'warn').length,
      },
      sizeBytes: e.size,
      lineCount: facts?.lineCount ?? null,
      modifiedAt: new Date(e.mtimeMs).toISOString(),
      version,
      eol: facts?.eol ?? null,
      bom: facts?.bom ?? null,
      encoding: facts ? (facts.utf8 ? 'utf-8' : 'unknown') : null,
      indent: facts?.indent ?? null,
      readError: e.readError === 'TOO_LARGE' ? null : e.readError,
      kindDir: cls.kindDir,
      namespaceDir: cls.type === 'namespace' ? cls.name : cls.namespace,
    };
    if (version && notes.fileEdits[e.path]?.version === version)
      modifiedByDashboard = true;
    if (cls.type === 'resource' || cls.type === 'namespace') {
      if (e.readError === 'TOO_LARGE') {
        fact.parse = 'too_large';
        unparsable.push({ path: e.path, reason: 'too_large' });
      } else if (!e.content) {
        fact.parse = 'yaml_error';
        unparsable.push({ path: e.path, reason: 'yaml_error' });
      } else {
        const text = decodeLikeCli(e.content).replace(/^\uFEFF/, '');
        const parsed = parseYamlDocs(text);
        if (parsed.errors.length) {
          fact.parse = 'yaml_error';
          fact.parseError = parsed.errors[0];
          unparsable.push({ path: e.path, reason: 'yaml_error' });
        } else if (parsed.docs.length === 0) {
          fact.parse = 'empty';
          unparsable.push({ path: e.path, reason: 'yaml_error' });
        } else {
          if (parsed.docs.length > 1) fact.parse = 'multi_document';
          parsed.docs.forEach((d, i) => {
            const id = identityOf(rules, d);
            if (!id) {
              if (i === 0 && parsed.docs.length === 1)
                fact.parse = 'not_object';
              unparsable.push({ path: e.path, reason: 'yaml_error' });
              return;
            }
            fact.documents.push(id);
            fact.docLines.push(parsed.lines[i] ?? 1);
            const key = resourceKeyOf(id);
            const list = identityFiles.get(key) ?? [];
            list.push(e.path);
            identityFiles.set(key, list);
            if (rules.isHelmManaged(d)) fact.helmManaged = true;
            const rf = rules.findRuntimeFields(d);
            for (const r of rf)
              if (!fact.runtimeFields.includes(r)) fact.runtimeFields.push(r);
            const needsNs =
              id.kind !== 'Namespace' &&
              cls.namespace !== null &&
              id.namespace === null;
            if (needsNs) {
              unparsable.push({ path: e.path, reason: 'namespace_missing' });
              return;
            }
            docs.push({
              path: e.path,
              index: i,
              identity: id,
              key,
              obj: d as Obj,
            });
          });
          fact.runtimeFields = fact.runtimeFields.slice(0, 10);
          fact.resource = fact.documents[0] ?? null;
          fact.resourceKey = fact.resource
            ? resourceKeyOf(fact.resource)
            : null;
        }
      }
      fact.pathMatches =
        fact.parse === 'ok' || fact.parse === 'multi_document'
          ? identityMatches(fact.resource, fact.expected)
          : true;
      if (fact.helmManaged) helmManaged++;
    }
    files.push(fact);
  }
  // 중복 정의
  const dupKeys = new Set(
    [...identityFiles.entries()]
      .filter(([, l]) => l.length > 1)
      .map(([k]) => k),
  );
  for (const f of files) {
    const mine = f.documents
      .map((d) => resourceKeyOf(d))
      .filter((k) => dupKeys.has(k));
    if (mine.length) {
      f.duplicate = true;
      f.duplicateOf = [
        ...new Set(
          mine.flatMap((k) =>
            identityFiles.get(k)!.filter((p) => p !== f.path),
          ),
        ),
      ].sort();
    }
  }
  const cleanDocs = docs.filter((d) => {
    if (!dupKeys.has(d.key)) return true;
    unparsable.push({ path: d.path, reason: 'duplicate' });
    return false;
  });
  files.sort(
    (a, b) =>
      fileRank(a.path) - fileRank(b.path) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );

  // ---------------- secret-refs.json
  const refsEntry = byPath.get(SECRET_REFS_FILE);
  let secretRefs: SecretRefsView = {
    state: 'missing',
    count: 0,
    secrets: [],
    note: null,
  };
  if (refsEntry && refsEntry.type === 'file' && refsEntry.content) {
    try {
      const v: unknown = JSON.parse(
        decodeLikeCli(refsEntry.content).replace(/^\uFEFF/, ''),
      );
      if (isObj(v) && Array.isArray(v.secrets))
        secretRefs = {
          state: 'ok',
          count: v.secrets.length,
          secrets: v.secrets,
          note: str(v.note),
        };
      else
        secretRefs = {
          state: 'schema_mismatch',
          count: 0,
          secrets: [],
          note: null,
        };
    } catch {
      secretRefs = { state: 'corrupt', count: 0, secrets: [], note: null };
    }
  }

  // ---------------- 개수
  const resourceFiles = files.filter(
    (f) => f.fileType === 'resource' || f.fileType === 'namespace',
  );
  const resourcesTotal = resourceFiles.length;
  const resRaw = metaRaw && isObj(metaRaw.resources) ? metaRaw.resources : null;
  const atExportTotal = resRaw ? num(resRaw.total) : null;
  const kindsRaw = metaRaw && isObj(metaRaw.kinds) ? metaRaw.kinds : null;
  const partialKinds: K8sAnalysis['partialKinds'] = [];
  if (kindsRaw)
    for (const [id, r] of Object.entries(kindsRaw)) {
      const res = isObj(r) ? r.result : null;
      if (res === 'forbidden' || res === 'not_found' || res === 'error')
        partialKinds.push({ id, result: res });
    }

  // ---------------- 폴더 (삭제 확인 창)
  const fileEntries = entries.filter((e) => e.type === 'file');
  const top = new Map<
    string,
    { name: string; type: string; fileCount: number; unexpected?: boolean }
  >();
  for (const e of entries) {
    const first = e.path.split('/')[0];
    if (!top.has(first)) {
      const te = byPath.get(first)!;
      const t: {
        name: string;
        type: string;
        fileCount: number;
        unexpected?: boolean;
      } = {
        name: first,
        type: te?.type ?? 'directory',
        fileCount: 0,
      };
      if (te && !expectedEntry(te, rules) && first !== NOTES_FILE)
        t.unexpected = true;
      top.set(first, t);
    }
    if (e.type === 'file') top.get(first)!.fileCount++;
  }

  // ---------------- 상태 판단 (11.1)
  const reasons: Reason[] = [];
  const crit = (c: string, t: string) => reasons.push(reason(c, t, 'critical'));
  const warn = (c: string, t: string) => reasons.push(reason(c, t, 'warning'));
  if (scanSummary.errors > 0) {
    const errRules = [
      ...new Set(
        findings.filter((f) => f.severity === 'error').map((f) => f.rule),
      ),
    ].sort();
    crit(
      'SCAN_SECRET_ERRORS',
      `비밀값 의심 ${scanSummary.errors}건 (${listNames(errRules)})`,
    );
  }
  if (metaState === 'corrupt')
    crit(
      'METADATA_CORRUPT',
      `metadata.json 손상 (${metaError ?? 'JSON 해석 실패'})`,
    );
  if (strict && scanSummary.warnings > 0)
    crit(
      'STRICT_SCAN_WARNINGS',
      `strict 스냅샷: 경고 ${scanSummary.warnings}건`,
    );
  if (!strict && scanSummary.warnings > 0) {
    const wr = [
      ...new Set(
        findings.filter((f) => f.severity === 'warn').map((f) => f.rule),
      ),
    ].sort();
    warn(
      'SCAN_WARNINGS',
      `검토 필요 ${scanSummary.warnings}건 (${listNames(wr)})`,
    );
  }
  if (metaState === 'missing' && !inProgress)
    warn('METADATA_MISSING', 'metadata.json 없음');
  if (metaState === 'schema_mismatch') {
    const cl = metaRaw && isObj(metaRaw.cluster) ? metaRaw.cluster : null;
    const detail =
      metaRaw?.schemaVersion !== 1
        ? `schemaVersion ${JSON.stringify(metaRaw?.schemaVersion ?? '없음')}`
        : !cl || typeof cl.id !== 'string' || cl.id === ''
          ? 'cluster.id 없음'
          : '필수 항목 없음';
    warn('METADATA_SCHEMA_MISMATCH', `메타데이터 형식이 다름 (${detail})`);
  }
  if (metaRaw && str(metaRaw.snapshotId) && metaRaw.snapshotId !== raw.id)
    warn('SNAPSHOT_ID_MISMATCH', '폴더 이름과 메타데이터 ID 불일치');
  if (partialKinds.length) {
    const label = (r: string) =>
      r === 'forbidden' ? '권한 없음' : r === 'not_found' ? 'API 없음' : '오류';
    warn(
      'PARTIAL_EXPORT',
      `일부 종류를 읽지 못함 (${listNames(partialKinds.map((p) => `${p.id}: ${label(p.result)}`))})`,
    );
  }
  const parseFailed = resourceFiles.filter((f) =>
    ['yaml_error', 'not_object', 'empty', 'too_large'].includes(f.parse),
  );
  if (parseFailed.length) {
    const big = parseFailed.filter((f) => f.parse === 'too_large').length;
    warn(
      'YAML_PARSE_FAILED',
      `YAML 해석 실패 ${parseFailed.length}개${big ? ` (${big}개는 크기 초과)` : ''}`,
    );
  }
  const multi = resourceFiles.filter(
    (f) => f.parse === 'multi_document',
  ).length;
  if (multi) warn('MULTI_DOCUMENT_FILE', `한 파일에 여러 리소스 ${multi}개`);
  const mismatch = resourceFiles.filter((f) => !f.pathMatches).length;
  if (mismatch)
    warn('PATH_CONTENT_MISMATCH', `경로와 내용 불일치 ${mismatch}개`);
  const dupCount = dupKeys.size;
  if (dupCount) warn('DUPLICATE_RESOURCE', `중복 정의 ${dupCount}개`);
  const rt = resourceFiles.filter((f) => f.runtimeFields.length).length;
  if (rt) warn('RUNTIME_FIELDS_LEFT', `런타임 필드 남음 ${rt}개 파일`);
  if (resourcesTotal === 0) warn('RESOURCES_ZERO', '리소스 0개');
  if (extraFiles.length) {
    const names = extraFiles.map((x) => x.name);
    warn(
      'UNEXPECTED_FILES',
      `예상 밖 파일 ${extraFiles.length}개 (${listNames(names)})${linkCount ? ` (링크 ${linkCount}개, 따라가지 않음)` : ''}`,
    );
  }
  if (notes.corrupt)
    warn('NOTES_CORRUPT', 'notes.json 손상 (라벨·메모를 읽을 수 없음)');
  const unreadable = entries.filter(
    (e) => e.readError && e.readError !== 'TOO_LARGE',
  );
  if (unreadable.length)
    reasons.push(
      reason(
        'FILE_UNREADABLE',
        `파일을 읽을 수 없음 (${unreadable[0].path}: ${unreadable[0].readError})`,
        'unknown',
      ),
    );
  let finalReasons = reasons;
  if (inProgress) {
    finalReasons = reasons.filter((r) => r.status === 'critical');
    finalReasons.push(
      reason(
        'EXPORT_MAYBE_IN_PROGRESS',
        '내보내기 진행 중일 수 있음',
        'unknown',
      ),
    );
  }
  const judged = statusFromReasons(finalReasons);

  // ---------------- 정보 문구 (11.4)
  const notices: { code: string; text: string }[] = [
    { code: 'DATA_NOT_INCLUDED', text: DATA_NOT_INCLUDED_TEXT },
  ];
  if (helmManaged)
    notices.push({
      code: 'HELM_MANAGED',
      text: `Helm 관리 리소스 ${helmManaged}개 — Helm 으로 복원 권장`,
    });
  if (scope?.systemIncluded.length)
    notices.push({
      code: 'SYSTEM_NAMESPACES_INCLUDED',
      text: `시스템 네임스페이스 포함: ${scope.systemIncluded.join(', ')}`,
    });
  if (scope?.missingNamespaces.length)
    notices.push({
      code: 'MISSING_NAMESPACES',
      text: `내보낼 때 없던 네임스페이스: ${scope.missingNamespaces.join(', ')}`,
    });
  if (atExportTotal !== null && atExportTotal !== resourcesTotal)
    notices.push({
      code: 'RESOURCES_CHANGED_SINCE_EXPORT',
      text: `내보내기 후 변경됨: ${atExportTotal} → ${resourcesTotal}`,
    });
  if (secretRefs.state === 'missing')
    notices.push({
      code: 'SECRET_REFS_MISSING',
      text: 'secret-refs.json 없음 — 복원에 필요한 Secret 목록을 알 수 없음',
    });
  else if (secretRefs.state !== 'ok')
    notices.push({
      code: 'SECRET_REFS_CORRUPT',
      text: 'secret-refs.json 을 읽을 수 없음',
    });
  if (strict) notices.push({ code: 'STRICT_EXPORT', text: 'strict 로 내보냄' });

  const toolRaw = metaRaw && isObj(metaRaw.tool) ? metaRaw.tool : null;
  const atExportScan: ScanSummary | null = secretScanRaw
    ? {
        errors: num(secretScanRaw.errors) ?? 0,
        warnings: num(secretScanRaw.warnings) ?? 0,
        strict,
        passed: secretScanRaw.passed === true,
        rules: strArr(secretScanRaw.rules),
      }
    : null;

  return {
    id: raw.id,
    snapshotAt: snapshotIdToIso(raw.id),
    analyzedAt: nowIso,
    status: judged.status,
    reasons: judged.reasons,
    notices,
    metadata: { state: metaState, error: metaError, fields: metaFields },
    metaRaw,
    cluster,
    scope,
    cleanupVersion,
    files,
    docs: cleanDocs,
    unparsable,
    extraFiles: extraFiles.slice(0, 50),
    scan: { summary: scanSummary, scannedFiles, findings, scannedAt: nowIso },
    atExportScan,
    notes,
    secretRefs,
    resourcesTotal,
    atExportTotal,
    helmManaged,
    partialKinds,
    lastModifiedAt: fileEntries.length
      ? new Date(Math.max(...fileEntries.map((e) => e.mtimeMs))).toISOString()
      : null,
    lastChangeMs,
    inProgress,
    modifiedByDashboard,
    cliVersion: toolRaw ? str(toolRaw.version) : null,
    folder: {
      fileCount: fileEntries.length,
      sizeBytes: fileEntries.reduce((a, e) => a + (e.size ?? 0), 0),
      topLevel: [...top.values()].slice(0, 50),
    },
    fileFindings,
  };
}
