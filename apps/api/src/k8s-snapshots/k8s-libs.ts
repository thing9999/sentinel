import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * CLI 라이브러리 불러오기 (docs/api/k8s-snapshot.md 2절).
 * - 스캐너: deploy/aws-snapshot/lib/scan.mjs (규칙 한 벌, profile 'k8s')
 * - 규칙: deploy/k8s-snapshot/lib/{kinds,layout,rules}.mjs (정리·제외·드리프트 표)
 * 규칙 사본을 두지 않는다. 불러오기 실패면 출처 unavailable.
 */

export interface CliFinding {
  file: string;
  line: number;
  rule: string;
  severity: 'error' | 'warn';
  message: string;
}

export interface K8sScanner {
  scanText(
    text: string,
    file?: string,
    opts?: { profile?: 'aws' | 'k8s' },
  ): CliFinding[];
  summarize(
    findings: CliFinding[],
    opts?: { strict?: boolean },
  ): { errors: number; warnings: number; strict: boolean; passed: boolean };
  maskValue(value: string): string;
  listRules(opts?: {
    profile?: 'aws' | 'k8s';
  }): { id: string; severity: 'error' | 'warn'; description: string }[];
  allowMarker: string;
  scannableExtensions: readonly string[];
}

export interface KindEntry {
  id: string;
  kind: string;
  singular: string;
  group: string;
  version: string;
  apiVersion: string;
  namespaced: boolean;
  tier: 'default' | 'optional' | 'custom';
  dashboardComparable: boolean;
}

export interface PathClass {
  type: 'metadata' | 'secret_refs' | 'notes' | 'namespace' | 'resource';
  namespace: string | null;
  kindDir: string | null;
  name: string | null;
}

export interface DefaultEntry {
  kinds: string[];
  path: string;
  value?: unknown;
  when?:
    | 'imagePullPolicy'
    | 'sameAsServiceAccountName'
    | 'singleIpFamily'
    | 'targetPortEqualsPort';
}

export interface ManagedEntry {
  id: string;
  kinds: string[];
  path: string;
  condition: 'hpaTarget' | 'always' | 'clusterGreater' | 'snapshotAbsent';
  clusterValue?: unknown;
  reason: string;
}

export interface ListKeyEntry {
  kinds?: string[];
  path: string;
  keys: string[][];
  defaults?: Record<string, unknown>;
}

export type Obj = Record<string, unknown>;

export interface K8sRules {
  KIND_CATALOG: readonly KindEntry[];
  kindById(id: string): KindEntry | null;
  kindByGroupKind(group: string, kind: string): KindEntry | null;
  splitApiVersion(v: unknown): { group: string; version: string };
  classifyPath(rel: string): PathClass | null;
  isRequestablePath(rel: string): boolean;
  resourcePath(r: {
    namespace: string | null;
    kindDir: string;
    name: string;
    isNamespace?: boolean;
  }): string;
  PATH_RULES: Record<string, string>;
  CLEANUP_RULES_VERSION: number;
  RULESETS: Record<number, { version: number; summary: readonly string[] }>;
  cleanObject(
    obj: unknown,
    opts?: { rulesVersion?: number; kind?: string },
  ): Obj;
  findRuntimeFields(obj: unknown): string[];
  isAlwaysExcluded(obj: unknown): boolean;
  isAutoCreated(obj: unknown, kind?: string): string | null;
  isHelmManaged(obj: unknown): boolean;
  orderKeys(obj: Obj): Obj;
  DEFAULTS: readonly DefaultEntry[];
  MANAGED_FIELDS: readonly ManagedEntry[];
  LIST_KEYS: readonly ListKeyEntry[];
  ORDER_SENSITIVE_LISTS: readonly string[];
  QUANTITY_PATHS: readonly string[];
  MASKED_PATHS: readonly string[];
}

export class LibLoadError extends Error {
  constructor(
    readonly code: 'SCANNER_UNAVAILABLE' | 'K8S_RULES_UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

export function defaultK8sLibDir(cwd: string = process.cwd()): string {
  return resolve(cwd, '../../deploy/k8s-snapshot/lib');
}
export function defaultScanLibDir(cwd: string = process.cwd()): string {
  return resolve(cwd, '../../deploy/aws-snapshot/lib');
}

async function importModule(
  dir: string,
  file: string,
  code: LibLoadError['code'],
  need: string[],
): Promise<Record<string, unknown>> {
  const p = resolve(dir, file);
  if (!existsSync(p))
    throw new LibLoadError(code, `lib 파일이 없습니다: ${file}`);
  const mod = (await import(pathToFileURL(p).href)) as Record<string, unknown>;
  const missing = need.filter((k) => mod[k] === undefined);
  if (missing.length)
    throw new LibLoadError(code, `${file} export 없음: ${missing.join(', ')}`);
  return mod;
}

export async function loadK8sLibs(
  scanLibDir: string,
  k8sLibDir: string,
): Promise<{ scanner: K8sScanner; rules: K8sRules }> {
  const scan = await importModule(
    scanLibDir,
    'scan.mjs',
    'SCANNER_UNAVAILABLE',
    [
      'scanText',
      'summarize',
      'ALLOW_MARKER',
      'SCANNABLE_EXTENSIONS',
      'maskValue',
      'listRules',
    ],
  );
  // 프로필을 지원하는 스캐너인지 (k8s 규칙이 목록에 있어야 한다)
  const rulesList = (scan.listRules as K8sScanner['listRules'])({
    profile: 'k8s',
  });
  if (!rulesList.some((r) => r.id === 'k8s-env-literal'))
    throw new LibLoadError(
      'SCANNER_UNAVAILABLE',
      'scan.mjs 가 k8s 프로필을 지원하지 않습니다',
    );
  const kinds = await importModule(
    k8sLibDir,
    'kinds.mjs',
    'K8S_RULES_UNAVAILABLE',
    ['KIND_CATALOG', 'kindById', 'kindByGroupKind', 'splitApiVersion'],
  );
  const layout = await importModule(
    k8sLibDir,
    'layout.mjs',
    'K8S_RULES_UNAVAILABLE',
    ['PATH_RULES', 'classifyPath', 'isRequestablePath', 'resourcePath'],
  );
  const rules = await importModule(
    k8sLibDir,
    'rules.mjs',
    'K8S_RULES_UNAVAILABLE',
    [
      'CLEANUP_RULES_VERSION',
      'RULESETS',
      'cleanObject',
      'findRuntimeFields',
      'isAlwaysExcluded',
      'isAutoCreated',
      'isHelmManaged',
      'orderKeys',
      'DEFAULTS',
      'MANAGED_FIELDS',
      'LIST_KEYS',
      'ORDER_SENSITIVE_LISTS',
      'QUANTITY_PATHS',
      'MASKED_PATHS',
    ],
  );
  return {
    scanner: {
      scanText: scan.scanText as K8sScanner['scanText'],
      summarize: scan.summarize as K8sScanner['summarize'],
      maskValue: scan.maskValue as K8sScanner['maskValue'],
      listRules: scan.listRules as K8sScanner['listRules'],
      allowMarker: scan.ALLOW_MARKER as string,
      scannableExtensions: scan.SCANNABLE_EXTENSIONS as string[],
    },
    rules: { ...kinds, ...layout, ...rules } as unknown as K8sRules,
  };
}
