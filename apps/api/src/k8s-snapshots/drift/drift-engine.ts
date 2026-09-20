/**
 * 드리프트 비교 (docs/api/k8s-snapshot.md 10.2~10.6). 순수 함수: 파일·클러스터를 부르지 않는다.
 * 표(정리 규칙·기본값·관리 필드·목록 키·수량·가림)는 CLI lib(rules.mjs)에서 온다.
 * 가림은 차이를 만드는 단계에서 적용한다 — 결과 객체에 가림 대상 원문이 남지 않는다 (AC-K38).
 */
import type {
  DefaultEntry,
  K8sRules,
  K8sScanner,
  ListKeyEntry,
  ManagedEntry,
  Obj,
} from '../k8s-libs';
import type { SnapDoc } from '../k8s-analyzer';
import { COMPARABLE_KINDS, type ComparableKind } from './comparable-kinds';

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export type Scalar = string | number | boolean | null;
export type DiffValue =
  | { kind: 'scalar'; value: Scalar }
  | { kind: 'list'; items: Scalar[] }
  | { kind: 'masked'; text: string; preview: string };

export interface FieldDiff {
  path: string;
  category: 'changed' | 'default' | 'managed';
  reason: string | null;
  managedRule: string | null;
  snapshot: DiffValue | null;
  cluster: DiffValue | null;
}

export interface DriftResource {
  key: string;
  apiGroup: string;
  apiVersion: string;
  kind: string;
  namespace: string | null;
  name: string;
  change: 'added' | 'deleted' | 'changed' | 'same';
  file: string | null;
  fileDocuments: number;
  helmManaged: boolean;
  counts: { changed: number; default: number; managed: number };
  fields: FieldDiff[];
  fieldsTruncated: boolean;
  summary: { images: string[]; replicas: number | null } | null;
  commands: { diff: string; apply: string } | null;
}

export interface DriftCounts {
  compared: number;
  same: number;
  added: number;
  deleted: number;
  changed: number;
  hidden: { default: number; managed: number };
  uncomparable: number;
  unparsable: number;
}

export type UncomparableReason =
  'NOT_IN_RBAC' | 'FORBIDDEN' | 'API_VERSION_MISMATCH';

export interface DriftResult {
  counts: DriftCounts;
  resources: DriftResource[];
  uncomparable: {
    apiGroup: string;
    kind: string;
    count: number;
    reason: UncomparableReason;
    text: string;
  }[];
  unparsable: { path: string; reason: string }[];
  addedCheck: 'checked' | 'skipped_scope_unknown';
  notices: { code: string; text: string }[];
  /** 드리프트 결과가 바뀌었는지 비교용 (상태·건수·리소스 키) */
  signature: string;
}

export interface DriftInput {
  snapshotId: string;
  docs: SnapDoc[];
  unparsable: { path: string; reason: string }[];
  metaRaw: Obj | null;
  rulesVersion: number | null;
  fileDocCount: Map<string, number>;
  /** kindId → 클러스터 객체 (원본 JSON, 읽기 전용) */
  cluster: Map<string, readonly unknown[]>;
  /** kindId → 권한 거부 */
  forbidden: Set<string>;
  displayRoot: string;
  maxFields: number;
}

// ---------------------------------------------------------------------------
// 경로 토큰·패턴
// ---------------------------------------------------------------------------

type Tok = { t: 'key'; k: string } | { t: 'item'; k: string };
type Pat =
  | { t: 'key'; k: string }
  | { t: 'anyKey' }
  | { t: 'item'; k: string | null }
  | { t: 'deep' };

const patternCache = new Map<string, Pat[]>();

export function parsePattern(p: string): Pat[] {
  const hit = patternCache.get(p);
  if (hit) return hit;
  const out: Pat[] = [];
  let i = 0;
  while (i < p.length) {
    if (p[i] === '.') {
      i++;
      continue;
    }
    if (p[i] === '[') {
      if (p[i + 1] === '"') {
        const end = p.indexOf('"]', i + 2);
        out.push({ t: 'key', k: p.slice(i + 2, end) });
        i = end + 2;
      } else {
        const end = p.indexOf(']', i);
        const inner = p.slice(i + 1, end);
        out.push({ t: 'item', k: inner === '' ? null : inner });
        i = end + 1;
      }
      continue;
    }
    let j = i;
    while (j < p.length && p[j] !== '.' && p[j] !== '[') j++;
    const seg = p.slice(i, j);
    if (seg === '**') out.push({ t: 'deep' });
    else if (seg === '*') out.push({ t: 'anyKey' });
    else out.push({ t: 'key', k: seg });
    i = j;
  }
  patternCache.set(p, out);
  return out;
}

export function matches(pattern: string, toks: Tok[]): boolean {
  const pat = parsePattern(pattern);
  const go = (pi: number, ti: number): boolean => {
    if (pi === pat.length) return ti === toks.length;
    const p = pat[pi];
    if (p.t === 'deep') {
      for (let k = ti; k <= toks.length; k++) if (go(pi + 1, k)) return true;
      return false;
    }
    if (ti >= toks.length) return false;
    const t = toks[ti];
    if (p.t === 'key' && t.t === 'key' && t.k === p.k)
      return go(pi + 1, ti + 1);
    if (p.t === 'anyKey' && t.t === 'key') return go(pi + 1, ti + 1);
    if (p.t === 'item' && t.t === 'item' && (p.k === null || p.k === t.k))
      return go(pi + 1, ti + 1);
    return false;
  };
  return go(0, 0);
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export function pathString(toks: Tok[]): string {
  let s = '';
  for (const t of toks) {
    if (t.t === 'item') s += `[${t.k}]`;
    else if (IDENT_RE.test(t.k)) s += s ? `.${t.k}` : t.k;
    else s += `[${JSON.stringify(t.k)}]`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// 값 도우미
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (Array.isArray(v) && v.length === 0) ||
  (isObj(v) && Object.keys(v).length === 0);
/** 스칼라를 문자열로 (객체는 JSON) */
const scalarText = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean' || v === null
      ? String(v)
      : JSON.stringify(v);
const isScalar = (v: unknown): v is Scalar =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v);

const SUFFIX: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};
/** 쿠버네티스 수량 → 숫자 (실패 null) */
export function parseQuantity(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m =
    /^([+-]?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+))?([a-zA-Z]{0,2})$/.exec(
      v.trim(),
    );
  if (!m) return null;
  const f = SUFFIX[m[3]];
  if (f === undefined) return null;
  return Number(m[1]) * (m[2] ? 10 ** Number(m[2]) : 1) * f;
}
const qEq = (a: unknown, b: unknown) => {
  const x = parseQuantity(a);
  const y = parseQuantity(b);
  if (x === null || y === null) return a === b;
  return Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * 1e-12;
};

function getByDotted(o: unknown, dotted: string): unknown {
  let cur = o;
  for (const k of dotted.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// 트리 비교 → 잎 차이
// ---------------------------------------------------------------------------

interface Leaf {
  toks: Tok[];
  a: unknown; // 스냅샷 (undefined = 없음)
  b: unknown; // 클러스터
  /** 순서가 의미 있는 목록의 "순서 다름" (값 = 이름 목록) */
  order?: boolean;
}

interface Ctx {
  kind: string;
  rules: K8sRules;
  leaves: Leaf[];
}

function listRuleFor(ctx: Ctx, toks: Tok[]): ListKeyEntry | null {
  for (const r of ctx.rules.LIST_KEYS) {
    if (r.kinds && !r.kinds.includes(ctx.kind)) continue;
    if (matches(r.path, toks)) return r;
  }
  return null;
}

function itemKey(rule: ListKeyEntry, item: unknown): string | null {
  if (!isObj(item)) return null;
  for (const cand of rule.keys) {
    const vals = cand.map((f) => {
      const v = getByDotted(item, f);
      if (v !== undefined && v !== null && v !== '') return v;
      return rule.defaults?.[f];
    });
    const present = cand.some((f) => {
      const v = getByDotted(item, f);
      return v !== undefined && v !== null && v !== '';
    });
    if (!present || vals.some((v) => v === undefined)) continue;
    return vals.map((v) => String(v)).join('/');
  }
  return null;
}

function flatten(ctx: Ctx, toks: Tok[], v: unknown, side: 'a' | 'b'): void {
  if (isEmpty(v)) return;
  if (isObj(v)) {
    for (const [k, x] of Object.entries(v))
      flatten(ctx, [...toks, { t: 'key', k }], x, side);
    return;
  }
  if (Array.isArray(v)) {
    if (v.every(isScalar)) {
      ctx.leaves.push({
        toks,
        a: side === 'a' ? v : undefined,
        b: side === 'b' ? v : undefined,
      });
      return;
    }
    const rule = listRuleFor(ctx, toks);
    v.forEach((item, i) => {
      const k = (rule && itemKey(rule, item)) ?? String(i);
      flatten(ctx, [...toks, { t: 'item', k }], item, side);
    });
    return;
  }
  ctx.leaves.push({
    toks,
    a: side === 'a' ? v : undefined,
    b: side === 'b' ? v : undefined,
  });
}

function walk(ctx: Ctx, toks: Tok[], a: unknown, b: unknown): void {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea && eb) return;
  if (ea) return flatten(ctx, toks, b, 'b');
  if (eb) return flatten(ctx, toks, a, 'a');
  if (isObj(a) && isObj(b)) {
    const keys = [
      ...Object.keys(a),
      ...Object.keys(b).filter((k) => !(k in a)),
    ];
    for (const k of keys) walk(ctx, [...toks, { t: 'key', k }], a[k], b[k]);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.every(isScalar) && b.every(isScalar)) {
      if (JSON.stringify(a) !== JSON.stringify(b))
        ctx.leaves.push({ toks, a, b });
      return;
    }
    const rule = listRuleFor(ctx, toks);
    const keyed = (arr: unknown[]) => {
      if (!rule) return null;
      const m = new Map<string, unknown>();
      for (const it of arr) {
        const k = itemKey(rule, it);
        if (k === null || m.has(k)) return null;
        m.set(k, it);
      }
      return m;
    };
    const ka = keyed(a);
    const kb = keyed(b);
    if (ka && kb) {
      const order = ctx.rules.ORDER_SENSITIVE_LISTS.some((p) =>
        matches(p, toks),
      );
      if (order) {
        const na = [...ka.keys()].filter((k) => kb.has(k));
        const nb = [...kb.keys()].filter((k) => ka.has(k));
        if (na.join('\u0000') !== nb.join('\u0000'))
          ctx.leaves.push({ toks, a: na, b: nb, order: true });
      }
      for (const k of [
        ...ka.keys(),
        ...[...kb.keys()].filter((x) => !ka.has(x)),
      ])
        walk(ctx, [...toks, { t: 'item', k }], ka.get(k), kb.get(k));
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++)
      walk(ctx, [...toks, { t: 'item', k: String(i) }], a[i], b[i]);
    return;
  }
  if (isObj(a) || Array.isArray(a) || isObj(b) || Array.isArray(b)) {
    // 모양이 다름: 양쪽을 따로 잎으로
    flatten(ctx, toks, a, 'a');
    flatten(ctx, toks, b, 'b');
    return;
  }
  // 스칼라
  if (a === b) return;
  if (ctx.rules.QUANTITY_PATHS.some((p) => matches(p, toks)) && qEq(a, b))
    return;
  ctx.leaves.push({ toks, a, b });
}

// ---------------------------------------------------------------------------
// 분류 (관리 필드 → 기본값 → 변경)
// ---------------------------------------------------------------------------

interface ClassifyCtx {
  kind: string;
  rules: K8sRules;
  snapObj: Obj;
  clusterObj: Obj;
  hpaTarget: boolean;
}

function valueAt(
  obj: Obj,
  toks: Tok[],
  rules: K8sRules,
  kind: string,
): unknown {
  let cur: unknown = obj;
  const walked: Tok[] = [];
  for (const t of toks) {
    if (t.t === 'key') {
      if (!isObj(cur)) return undefined;
      cur = cur[t.k];
    } else {
      if (!Array.isArray(cur)) return undefined;
      const rule = listRuleFor({ kind, rules, leaves: [] }, walked);
      const hit: unknown = cur.find((it, i) =>
        rule ? itemKey(rule, it) === t.k : String(i) === t.k,
      );
      cur = hit ?? (rule ? undefined : cur[Number(t.k)]);
    }
    walked.push(t);
  }
  return cur;
}

function imageDefaultPolicy(image: unknown): string | null {
  if (typeof image !== 'string') return null;
  if (image.includes('@')) return 'IfNotPresent';
  const last = image.split('/').pop() ?? '';
  const i = last.lastIndexOf(':');
  const tag = i >= 0 ? last.slice(i + 1) : '';
  return tag === '' || tag === 'latest' ? 'Always' : 'IfNotPresent';
}

function defaultMatches(d: DefaultEntry, leaf: Leaf, c: ClassifyCtx): boolean {
  const present = leaf.a === undefined ? leaf.b : leaf.a;
  const presentObj = leaf.a === undefined ? c.clusterObj : c.snapObj;
  const parent = leaf.toks.slice(0, -1);
  switch (d.when) {
    case 'imagePullPolicy':
      return (
        present ===
        imageDefaultPolicy(
          valueAt(
            presentObj,
            [...parent, { t: 'key', k: 'image' }],
            c.rules,
            c.kind,
          ),
        )
      );
    case 'sameAsServiceAccountName':
      return (
        present ===
        valueAt(
          presentObj,
          [...parent, { t: 'key', k: 'serviceAccountName' }],
          c.rules,
          c.kind,
        )
      );
    case 'targetPortEqualsPort':
      return (
        present ===
        valueAt(
          presentObj,
          [...parent, { t: 'key', k: 'port' }],
          c.rules,
          c.kind,
        )
      );
    case 'singleIpFamily':
      return Array.isArray(present) && present.length === 1;
    default:
      return JSON.stringify(present) === JSON.stringify(d.value);
  }
}

function managedMatches(m: ManagedEntry, leaf: Leaf, c: ClassifyCtx): boolean {
  switch (m.condition) {
    case 'hpaTarget':
      return c.hpaTarget;
    case 'always':
      return true;
    case 'clusterGreater': {
      const x = parseQuantity(leaf.a);
      const y = parseQuantity(leaf.b);
      return x !== null && y !== null && y > x;
    }
    case 'snapshotAbsent':
      return (
        leaf.a === undefined &&
        (m.clusterValue === undefined || leaf.b === m.clusterValue)
      );
    default:
      return false;
  }
}

/** "기본값 File", 조건부 기본값도 있는 쪽 값을 보인다 ("기본값 IfNotPresent") */
function renderDefault(_d: DefaultEntry, leaf: Leaf): string {
  const v = leaf.a === undefined ? leaf.b : leaf.a;
  return `기본값 ${Array.isArray(v) ? v.join(', ') : String(v)}`;
}

// ---------------------------------------------------------------------------
// 가림
// ---------------------------------------------------------------------------

function lastKey(toks: Tok[]): string {
  for (let i = toks.length - 1; i >= 0; i--)
    if (toks[i].t === 'key') return toks[i].k;
  return 'value';
}

function toDiffValue(
  v: unknown,
  masked: boolean,
  scanner: K8sScanner,
): DiffValue | null {
  if (v === undefined) return null;
  if (masked) {
    const text = Array.isArray(v)
      ? v.map((x) => scalarText(x)).join(' ')
      : scalarText(v);
    const preview = scanner.maskValue(text);
    return { kind: 'masked', text: `값 다름 (${preview})`, preview };
  }
  if (Array.isArray(v)) return { kind: 'list', items: v as Scalar[] };
  return { kind: 'scalar', value: v as Scalar };
}

function shouldMask(leaf: Leaf, rules: K8sRules, scanner: K8sScanner): boolean {
  if (rules.MASKED_PATHS.some((p) => matches(p, leaf.toks))) return true;
  const key = lastKey(leaf.toks);
  for (const v of [leaf.a, leaf.b]) {
    if (v === undefined || v === null) continue;
    const s = Array.isArray(v)
      ? v.map((x) => scalarText(x)).join(' ')
      : scalarText(v);
    // 스캐너 규칙에 걸리는 값이면 가린다 (어떤 규칙이든). 여러 줄 값은 줄마다
    const text = s.includes('\n')
      ? s
          .split('\n')
          .map((l) => `${key}: ${l}`)
          .join('\n')
      : `${key}: ${s}`;
    if (scanner.scanText(text, 'drift', { profile: 'k8s' }).length) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 리소스 비교
// ---------------------------------------------------------------------------

function stripIdentity(o: Obj): Obj {
  const c: Obj = { ...o };
  delete c.apiVersion;
  delete c.kind;
  if (isObj(c.metadata)) {
    const m = { ...c.metadata };
    delete m.name;
    delete m.namespace;
    c.metadata = m;
  }
  return c;
}

export function compareObjects(
  kind: string,
  snapshot: Obj,
  cluster: Obj,
  opt: {
    rules: K8sRules;
    scanner: K8sScanner;
    rulesVersion: number;
    hpaTarget: boolean;
    maxFields: number;
  },
): {
  fields: FieldDiff[];
  truncated: boolean;
  counts: DriftResource['counts'];
} {
  const { rules, scanner } = opt;
  const a = stripIdentity(
    rules.cleanObject(snapshot, { rulesVersion: opt.rulesVersion, kind }),
  );
  const b = stripIdentity(
    rules.cleanObject(cluster, { rulesVersion: opt.rulesVersion, kind }),
  );
  const ctx: Ctx = { kind, rules, leaves: [] };
  walk(ctx, [], a, b);
  const cctx: ClassifyCtx = {
    kind,
    rules,
    snapObj: a,
    clusterObj: b,
    hpaTarget: opt.hpaTarget,
  };
  const all: FieldDiff[] = [];
  for (const leaf of ctx.leaves) {
    let category: FieldDiff['category'] = 'changed';
    let why: string | null = leaf.order ? '순서 다름' : null;
    let rule: string | null = null;
    const m = leaf.order
      ? undefined
      : rules.MANAGED_FIELDS.find(
          (x) =>
            x.kinds.includes(kind) &&
            matches(x.path, leaf.toks) &&
            managedMatches(x, leaf, cctx),
        );
    if (m) {
      category = 'managed';
      why = m.reason;
      rule = m.id;
    } else if ((leaf.a === undefined) !== (leaf.b === undefined)) {
      const d = rules.DEFAULTS.find(
        (x) =>
          x.kinds.includes(kind) &&
          matches(x.path, leaf.toks) &&
          defaultMatches(x, leaf, cctx),
      );
      if (d) {
        category = 'default';
        why = renderDefault(d, leaf);
      }
    }
    const masked = !leaf.order && shouldMask(leaf, rules, scanner);
    all.push({
      path: pathString(leaf.toks),
      category,
      reason: why,
      managedRule: rule,
      snapshot: toDiffValue(leaf.a, masked, scanner),
      cluster: toDiffValue(leaf.b, masked, scanner),
    });
  }
  const counts = {
    changed: all.filter((f) => f.category === 'changed').length,
    default: all.filter((f) => f.category === 'default').length,
    managed: all.filter((f) => f.category === 'managed').length,
  };
  const order = { changed: 0, managed: 1, default: 2 } as const;
  const sorted = all
    .map((f, i) => ({ f, i }))
    .sort((x, y) => order[x.f.category] - order[y.f.category] || x.i - y.i)
    .map((x) => x.f);
  return {
    fields: sorted.slice(0, opt.maxFields),
    truncated: sorted.length > opt.maxFields,
    counts,
  };
}

function podSpecOf(o: Obj): Obj | null {
  const s = isObj(o.spec) ? o.spec : null;
  const t = s && isObj(s.template) ? s.template : null;
  return t && isObj(t.spec) ? t.spec : null;
}

function summaryOf(o: Obj): DriftResource['summary'] {
  const ps = podSpecOf(o);
  const images: string[] = [];
  if (ps)
    for (const list of ['initContainers', 'containers'])
      for (const c of Array.isArray(ps[list]) ? (ps[list] as unknown[]) : [])
        if (isObj(c) && typeof c.image === 'string') images.push(c.image);
  const spec = isObj(o.spec) ? o.spec : {};
  return {
    images,
    replicas: typeof spec.replicas === 'number' ? spec.replicas : null,
  };
}

// ---------------------------------------------------------------------------
// 스냅샷 전체
// ---------------------------------------------------------------------------

function inNamespaceScope(ns: string, meta: Obj): boolean {
  const scope = isObj(meta.scope) ? meta.scope : null;
  const n = scope && isObj(scope.namespaces) ? scope.namespaces : null;
  if (!n) return false;
  const arr = (v: unknown) =>
    Array.isArray(v) ? (v as unknown[]).map(String) : [];
  const mode = n.mode;
  if (mode === 'include') return arr(n.include).includes(ns);
  if (mode === 'exclude' || mode === 'all_except_system')
    return !arr(n.system).includes(ns) && !arr(n.exclude).includes(ns);
  return false;
}

const KIND_ORDER = COMPARABLE_KINDS.map((k) => k.kind);

export function computeDrift(
  input: DriftInput,
  libs: { rules: K8sRules; scanner: K8sScanner },
): DriftResult {
  const { rules, scanner } = libs;
  const rulesVersion = input.rulesVersion ?? rules.CLEANUP_RULES_VERSION;
  const notices: DriftResult['notices'] = [];
  if (!rules.RULESETS[rulesVersion])
    notices.push({
      code: 'CLEANUP_RULES_NEWER',
      text: `스냅샷 정리 규칙 버전 ${rulesVersion} 를 모름, 최신 규칙 ${rules.CLEANUP_RULES_VERSION} 로 비교`,
    });
  const rv = rules.RULESETS[rulesVersion]
    ? rulesVersion
    : rules.CLEANUP_RULES_VERSION;

  const byGK = new Map<string, ComparableKind>(
    COMPARABLE_KINDS.map((k) => [`${k.apiGroup}/${k.kind}`, k]),
  );
  const uncomp = new Map<string, DriftResult['uncomparable'][number]>();
  const addUncomp = (
    g: string,
    k: string,
    reasonCode: UncomparableReason,
    extra = '',
  ) => {
    const key = `${g}/${k}/${reasonCode}`;
    const text =
      reasonCode === 'NOT_IN_RBAC'
        ? '대시보드 권한 밖이라 비교하지 않음'
        : reasonCode === 'FORBIDDEN'
          ? '비교 불가 (권한 거부)'
          : `API 버전이 달라 비교하지 않음${extra}`;
    const e = uncomp.get(key) ?? {
      apiGroup: g,
      kind: k,
      count: 0,
      reason: reasonCode,
      text,
    };
    e.count++;
    uncomp.set(key, e);
  };

  // 스냅샷 쪽
  const snap = new Map<string, { doc: SnapDoc; ck: ComparableKind }>();
  for (const d of input.docs) {
    const ck = byGK.get(`${d.identity.apiGroup}/${d.identity.kind}`);
    if (!ck) {
      addUncomp(d.identity.apiGroup, d.identity.kind, 'NOT_IN_RBAC');
      continue;
    }
    if (input.forbidden.has(ck.id)) {
      addUncomp(ck.apiGroup, ck.kind, 'FORBIDDEN');
      continue;
    }
    if (d.identity.apiVersion !== ck.apiVersion) {
      addUncomp(
        ck.apiGroup,
        ck.kind,
        'API_VERSION_MISMATCH',
        ` (${d.identity.apiVersion})`,
      );
      continue;
    }
    snap.set(d.key, { doc: d, ck });
  }

  // 클러스터 쪽
  const clusterMap = new Map<string, { obj: Obj; ck: ComparableKind }>();
  for (const ck of COMPARABLE_KINDS) {
    if (input.forbidden.has(ck.id)) continue;
    for (const raw of input.cluster.get(ck.id) ?? []) {
      if (!isObj(raw) || !isObj(raw.metadata)) continue;
      const name = raw.metadata.name;
      if (typeof name !== 'string') continue;
      const ns =
        ck.namespaced && typeof raw.metadata.namespace === 'string'
          ? raw.metadata.namespace
          : null;
      const obj: Obj = { apiVersion: ck.apiVersion, kind: ck.kind, ...raw };
      const key = `${ck.apiGroup || 'core'}/${ck.kind}/${ns ?? '_cluster'}/${name}`;
      clusterMap.set(key, { obj, ck });
    }
  }

  // HPA 대상 (현재 클러스터)
  const hpaTargets = new Set<string>();
  for (const { obj, ck } of clusterMap.values()) {
    if (ck.kind !== 'HorizontalPodAutoscaler') continue;
    const spec = isObj(obj.spec) ? obj.spec : {};
    const ref = isObj(spec.scaleTargetRef) ? spec.scaleTargetRef : {};
    const ns = isObj(obj.metadata) ? obj.metadata.namespace : '';
    hpaTargets.add(`${String(ns)}/${String(ref.kind)}/${String(ref.name)}`);
  }

  const resources: DriftResource[] = [];
  let same = 0;
  let hiddenDefault = 0;
  let hiddenManaged = 0;
  const commandsFor = (file: string) => ({
    diff: `kubectl diff -f ${input.displayRoot}/${input.snapshotId}/${file}`,
    apply: `kubectl apply -f ${input.displayRoot}/${input.snapshotId}/${file}`,
  });

  for (const [key, { doc, ck }] of snap) {
    const base = {
      key,
      apiGroup: ck.apiGroup,
      apiVersion: doc.identity.apiVersion,
      kind: ck.kind,
      namespace: doc.identity.namespace,
      name: doc.identity.name,
      file: doc.path,
      fileDocuments: input.fileDocCount.get(doc.path) ?? 1,
      helmManaged: rules.isHelmManaged(doc.obj),
    };
    const c = clusterMap.get(key);
    if (!c) {
      resources.push({
        ...base,
        change: 'deleted',
        counts: { changed: 0, default: 0, managed: 0 },
        fields: [],
        fieldsTruncated: false,
        summary: summaryOf(doc.obj),
        commands: commandsFor(doc.path),
      });
      continue;
    }
    const cmp = compareObjects(ck.kind, doc.obj, c.obj, {
      rules,
      scanner,
      rulesVersion: rv,
      hpaTarget: hpaTargets.has(
        `${doc.identity.namespace}/${ck.kind}/${doc.identity.name}`,
      ),
      maxFields: input.maxFields,
    });
    hiddenDefault += cmp.counts.default;
    hiddenManaged += cmp.counts.managed;
    const change = cmp.counts.changed > 0 ? 'changed' : 'same';
    if (change === 'same') same++;
    if (change === 'changed' || cmp.counts.default + cmp.counts.managed > 0)
      resources.push({
        ...base,
        change,
        counts: cmp.counts,
        fields: cmp.fields,
        fieldsTruncated: cmp.truncated,
        summary: null,
        commands: commandsFor(doc.path),
      });
  }

  // 추가됨 (스냅샷 범위 안에서만)
  const meta = input.metaRaw;
  const scopeOk =
    meta !== null &&
    isObj(meta.scope) &&
    isObj(meta.scope.namespaces) &&
    isObj(meta.scope.kinds);
  let added = 0;
  const skipKeys = new Set([...input.docs.map((d) => d.key)]);
  if (scopeOk) {
    const scope = meta.scope as Obj;
    const kindsScope = scope.kinds as Obj;
    const listed = new Set(
      ['default', 'optional'].flatMap((k) =>
        Array.isArray(kindsScope[k])
          ? (kindsScope[k] as unknown[]).map(String)
          : [],
      ),
    );
    const kindsMeta = isObj(meta.kinds) ? meta.kinds : {};
    const includeHelm = scope.includeHelmManaged !== false;
    for (const [key, { obj, ck }] of clusterMap) {
      if (snap.has(key) || skipKeys.has(key)) continue;
      if (!listed.has(ck.id)) continue;
      const km = kindsMeta[ck.id];
      if (ck.id !== 'namespaces' && isObj(km) && km.result !== 'ok') continue;
      const md = isObj(obj.metadata) ? obj.metadata : {};
      const ns =
        ck.kind === 'Namespace'
          ? scalarText(md.name)
          : scalarText(md.namespace ?? '');
      if (!inNamespaceScope(ns, meta)) continue;
      if (rules.isAlwaysExcluded(obj) || rules.isAutoCreated(obj, ck.kind))
        continue;
      const helm = rules.isHelmManaged(obj);
      if (helm && !includeHelm) continue;
      added++;
      resources.push({
        key,
        apiGroup: ck.apiGroup,
        apiVersion: ck.apiVersion,
        kind: ck.kind,
        namespace: ck.kind === 'Namespace' ? null : ns,
        name: String(md.name),
        change: 'added',
        file: null,
        fileDocuments: 0,
        helmManaged: helm,
        counts: { changed: 0, default: 0, managed: 0 },
        fields: [],
        fieldsTruncated: false,
        summary: summaryOf(obj),
        commands: null,
      });
    }
  } else {
    notices.push({
      code: 'ADDED_NOT_CHECKED',
      text: '범위를 알 수 없어 추가된 리소스는 확인하지 않음',
    });
  }

  const kindRank = (k: string) => {
    const i = KIND_ORDER.indexOf(k);
    return i < 0 ? 99 : i;
  };
  resources.sort(
    (x, y) =>
      (x.namespace ?? '').localeCompare(y.namespace ?? '') ||
      kindRank(x.kind) - kindRank(y.kind) ||
      (x.name < y.name ? -1 : x.name > y.name ? 1 : 0),
  );
  const deleted = resources.filter((r) => r.change === 'deleted').length;
  const changed = resources.filter((r) => r.change === 'changed').length;
  const uncomparable = [...uncomp.values()].sort(
    (x, y) => y.count - x.count || x.kind.localeCompare(y.kind),
  );
  const counts: DriftCounts = {
    compared: snap.size + added,
    same,
    added,
    deleted,
    changed,
    hidden: { default: hiddenDefault, managed: hiddenManaged },
    uncomparable: uncomparable.reduce((a, u) => a + u.count, 0),
    unparsable: input.unparsable.length,
  };
  const signature = JSON.stringify([
    counts,
    resources.map((r) => [r.key, r.change, r.counts]),
  ]);
  return {
    counts,
    resources,
    uncomparable,
    unparsable: input.unparsable,
    addedCheck: scopeOk ? 'checked' : 'skipped_scope_unknown',
    notices,
    signature,
  };
}
