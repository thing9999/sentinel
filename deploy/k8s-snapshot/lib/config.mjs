// 설정 읽기: CLI 플래그 > deploy/k8s-snapshot/.env > 프로세스 환경변수 (deploy/aws-snapshot 과 같은 규칙).
// .env 가 셸 환경변수보다 우선하는 이유: 셸의 KUBECONFIG·컨텍스트가 다른 클러스터를 가리켜도
// .env 에 적은 "내보내기 전용" 컨텍스트를 쓰게 하려는 것. (docs/api/k8s-snapshot.md 4.2)
import { parseArgs, parseEnv } from 'node:util';
import { CUSTOM_RESOURCE_RE, DEFAULT_KIND_IDS, KIND_CATALOG, resolveKind } from './kinds.mjs';
import { NAMESPACE_NAME_RE } from './layout.mjs';

export class ConfigError extends Error {}

export const DEFAULT_SYSTEM_NAMESPACES = ['kube-system', 'kube-public', 'kube-node-lease', 'amazon-cloudwatch'];

export const CLI_OPTIONS = {
  'dry-run': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  // --env-file 은 Node 자체 옵션과 이름이 겹쳐 --config 로 받는다 (aws-snapshot 과 같음)
  config: { type: 'string' },
  kubeconfig: { type: 'string' },
  context: { type: 'string' },
  namespaces: { type: 'string' },
  'exclude-namespaces': { type: 'string' },
  'system-namespaces': { type: 'string' },
  'optional-kinds': { type: 'string' },
  'custom-resources': { type: 'string' },
  'exclude-kinds': { type: 'string' },
  'include-helm': { type: 'boolean' },
  'no-include-helm': { type: 'boolean' },
  strict: { type: 'boolean' },
  'out-dir': { type: 'string' },
};

export function parseCli(argv) {
  try {
    return parseArgs({ args: argv, options: CLI_OPTIONS, allowPositionals: false, strict: true }).values;
  } catch (err) {
    throw new ConfigError(err.message);
  }
}

/** .env 텍스트 파싱. 값이 빈 문자열인 키는 "설정 안 함"으로 본다 */
export function parseEnvText(text) {
  if (!text) return {};
  const parsed = parseEnv(text);
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== ''));
}

function toBool(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new ConfigError(`${name}: 불리언 값이 아닙니다 (true/false)`);
}

const list = (v) =>
  v === undefined || v === null
    ? []
    : String(v)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

const CONTEXT_RE = /^[A-Za-z0-9_.:@/+=-]{1,253}$/;

/**
 * @param {{ flags: Record<string, any>, fileEnv: Record<string,string>, processEnv: Record<string,string|undefined> }} p
 */
export function resolveConfig({ flags, fileEnv, processEnv }) {
  const pick = (flag, envName) => {
    if (flags[flag] !== undefined) return flags[flag];
    if (fileEnv[envName] !== undefined) return fileEnv[envName];
    const e = processEnv[envName];
    return e === '' ? undefined : e;
  };

  const context = pick('context', 'KUBE_CONTEXT');
  if (!context) throw new ConfigError('컨텍스트가 없습니다. .env 의 KUBE_CONTEXT 또는 --context 를 지정하세요 (current-context 는 쓰지 않습니다)');
  if (!CONTEXT_RE.test(String(context))) throw new ConfigError('KUBE_CONTEXT 형식이 올바르지 않습니다');

  const include = list(pick('namespaces', 'SNAPSHOT_NAMESPACES'));
  const exclude = list(pick('exclude-namespaces', 'SNAPSHOT_EXCLUDE_NAMESPACES'));
  if (include.length && exclude.length)
    throw new ConfigError('네임스페이스 포함 목록과 제외 목록을 함께 쓸 수 없습니다 (SNAPSHOT_NAMESPACES / SNAPSHOT_EXCLUDE_NAMESPACES)');
  const sysRaw = pick('system-namespaces', 'SNAPSHOT_SYSTEM_NAMESPACES');
  const system = sysRaw === undefined ? [...DEFAULT_SYSTEM_NAMESPACES] : list(sysRaw);
  for (const ns of [...include, ...exclude, ...system]) {
    if (!NAMESPACE_NAME_RE.test(ns)) throw new ConfigError(`네임스페이스 이름 형식이 올바르지 않습니다: ${ns}`);
  }

  const optionalIds = [];
  for (const name of list(pick('optional-kinds', 'SNAPSHOT_OPTIONAL_KINDS'))) {
    const e = resolveKind(name);
    if (!e) throw new ConfigError(`모르는 종류 이름입니다: ${name}`);
    if (!DEFAULT_KIND_IDS.includes(e.id) && !optionalIds.includes(e.id)) optionalIds.push(e.id);
  }
  const excludedIds = [];
  for (const name of list(pick('exclude-kinds', 'SNAPSHOT_EXCLUDE_KINDS'))) {
    const e = resolveKind(name);
    if (!e) throw new ConfigError(`모르는 종류 이름입니다: ${name}`);
    if (!DEFAULT_KIND_IDS.includes(e.id)) throw new ConfigError(`기본 포함 종류가 아닙니다 (선택 종류는 SNAPSHOT_OPTIONAL_KINDS 로 켭니다): ${name}`);
    if (!excludedIds.includes(e.id)) excludedIds.push(e.id);
  }
  const custom = [];
  for (const name of list(pick('custom-resources', 'SNAPSHOT_CUSTOM_RESOURCES'))) {
    const n = name.toLowerCase();
    if (!CUSTOM_RESOURCE_RE.test(n)) throw new ConfigError(`사용자 지정 리소스는 plural.group 형식이어야 합니다: ${name}`);
    if (KIND_CATALOG.some((e) => e.id === n.split('.')[0] && e.group === n.slice(n.indexOf('.') + 1)))
      throw new ConfigError(`기본·선택 종류는 사용자 지정 리소스로 쓰지 않습니다: ${name}`);
    if (!custom.includes(n)) custom.push(n);
  }

  let includeHelm = toBool(pick('include-helm', 'SNAPSHOT_INCLUDE_HELM'), true, 'SNAPSHOT_INCLUDE_HELM');
  if (flags['no-include-helm']) includeHelm = false;

  return {
    kubeconfig: pick('kubeconfig', 'KUBECONFIG') ?? null,
    context: String(context),
    namespaces: {
      mode: include.length ? 'include' : exclude.length ? 'exclude' : 'all_except_system',
      include,
      exclude,
      system,
      systemIncluded: include.filter((ns) => system.includes(ns)),
    },
    kinds: {
      default: DEFAULT_KIND_IDS.filter((id) => !excludedIds.includes(id)),
      optional: optionalIds,
      custom,
      excluded: excludedIds,
    },
    includeHelm,
    strict: toBool(pick('strict', 'SNAPSHOT_STRICT'), false, 'SNAPSHOT_STRICT'),
    outDir: pick('out-dir', 'SNAPSHOT_OUT_DIR') ?? null,
    dryRun: Boolean(flags['dry-run']),
  };
}
