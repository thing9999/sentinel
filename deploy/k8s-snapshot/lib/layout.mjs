// 스냅샷 폴더의 경로·파일 이름 규칙 (docs/api/k8s-snapshot.md 1.1, 3.1).
// api 가 이 파일을 동적 import 한다 → Node 내장 모듈 외 import 금지 (계약 2.2).

export const SNAPSHOT_ID_RE = /^\d{8}-\d{6}$/;
export const METADATA_FILE = 'metadata.json';
export const SECRET_REFS_FILE = 'secret-refs.json';
export const NOTES_FILE = 'notes.json';
export const NAMESPACE_FILE = 'namespace.yaml';
export const CLUSTER_DIR = '_cluster';
export const TRASH_DIR = '.trash';
/** CLI 가 쓰는 중인 임시 폴더 */
export const PARTIAL_DIR_RE = /^\.(\d{8}-\d{6})\.partial$/;

const NS_SRC = '[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?';
const KIND_DIR_SRC = '[a-z0-9]+(?:\\.[a-z0-9](?:[-a-z0-9]*[a-z0-9])?)*';
const FILE_BASE_SRC = '(?:[a-z0-9-]|~[0-9A-F]{2})(?:[a-z0-9.-]|~[0-9A-F]{2}){0,249}';

export const NAMESPACE_NAME_RE = new RegExp(`^${NS_SRC}$`);
export const KIND_DIR_RE = new RegExp(`^${KIND_DIR_SRC}$`);

/** 정규식 원문 (계약 1.1 경로 규칙) */
export const PATH_RULES = Object.freeze({
  metadata: `^${METADATA_FILE.replace('.', '\\.')}$`,
  secretRefs: `^${SECRET_REFS_FILE.replace('.', '\\.')}$`,
  namespace: `^(${NS_SRC})/namespace\\.yaml$`,
  resource: `^(${NS_SRC}|${CLUSTER_DIR})/(${KIND_DIR_SRC})/(${FILE_BASE_SRC})\\.yaml$`,
});

const NAMESPACE_PATH_RE = new RegExp(PATH_RULES.namespace);
const RESOURCE_PATH_RE = new RegExp(PATH_RULES.resource);

const DNS_SUBDOMAIN_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 10 }, (_, i) => `com${i}`),
  ...Array.from({ length: 10 }, (_, i) => `lpt${i}`),
]);

const hex = (b) => `~${b.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * 쿠버네티스 이름 → 파일 이름 (확장자 없음). 계약 3.1.
 * DNS-1123 subdomain 이면 그대로, 아니면 [a-z0-9.-] 밖의 UTF-8 바이트를 ~XX 로.
 * Windows 예약 이름·점으로 시작하는 이름은 첫 글자를 ~XX 로.
 */
export function encodeFileName(name) {
  const s = String(name);
  let out;
  if (s.length <= 253 && DNS_SUBDOMAIN_RE.test(s)) out = s;
  else {
    out = '';
    for (const b of Buffer.from(s, 'utf8')) {
      const c = String.fromCharCode(b);
      out += /[a-z0-9.-]/.test(c) && b < 0x80 ? c : hex(b);
    }
  }
  const first = out.split('.')[0];
  if (WINDOWS_RESERVED.has(first) || out.startsWith('.')) out = hex(out.charCodeAt(0)) + out.slice(1);
  return out;
}

/** 파일 이름(확장자 없음) → 쿠버네티스 이름. 형식이 틀리면 null */
export function decodeFileName(base) {
  const s = String(base);
  if (!new RegExp(`^${FILE_BASE_SRC}$`).test(s) || s.includes('..')) return null;
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '~') {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(s.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * 리소스의 스냅샷 안 상대 경로.
 * @param {{ namespace: string|null, kindDir: string, name: string, isNamespace?: boolean }} r
 */
export function resourcePath(r) {
  if (r.isNamespace) return `${r.name}/${NAMESPACE_FILE}`;
  const dir = r.namespace ?? CLUSTER_DIR;
  return `${dir}/${r.kindDir}/${encodeFileName(r.name)}.yaml`;
}

/**
 * 상대 경로 분류. 경로 규칙에 맞지 않으면 null.
 * @returns {{ type: 'metadata'|'secret_refs'|'notes'|'namespace'|'resource', namespace: string|null, kindDir: string|null, name: string|null } | null}
 */
export function classifyPath(rel) {
  const p = String(rel ?? '');
  if (p === METADATA_FILE) return { type: 'metadata', namespace: null, kindDir: null, name: null };
  if (p === SECRET_REFS_FILE) return { type: 'secret_refs', namespace: null, kindDir: null, name: null };
  if (p === NOTES_FILE) return { type: 'notes', namespace: null, kindDir: null, name: null };
  let m = NAMESPACE_PATH_RE.exec(p);
  if (m) return { type: 'namespace', namespace: m[1], kindDir: 'namespaces', name: m[1] };
  m = RESOURCE_PATH_RE.exec(p);
  if (m) {
    const name = decodeFileName(m[3]);
    if (name === null) return null;
    return { type: 'resource', namespace: m[1] === CLUSTER_DIR ? null : m[1], kindDir: m[2], name };
  }
  return null;
}

/** 파일 엔드포인트가 받는 경로 (notes.json 제외) */
export function isRequestablePath(rel) {
  const c = classifyPath(rel);
  return c !== null && c.type !== 'notes';
}
