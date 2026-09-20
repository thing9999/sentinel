/**
 * 브리지 결과 → 제안 목록 (결과 정리 단계, 순수 함수)
 * docs/api/architecture-advisor.md B.4 "api 결과 정리 규칙" 1~8
 * LLM 출력은 신뢰하지 않는다: 스키마 재검증, 대상·근거 대조, 절감액은 서버 값 우선.
 */
import { randomUUID } from 'node:crypto';
import {
  CATEGORIES,
  NO_EXECUTE_NOTICE,
  SEVERITIES,
  TARGET_KINDS,
  type Category,
  type Evidence,
  type PrecheckItem,
  type RunCounts,
  type Savings,
  type Severity,
  type Step,
  type Suggestion,
  type TargetKind,
  type TargetRef,
} from '../advisor.types';
import type { PseudonymMap } from '../snapshot/sanitize-snapshot';
import type { AdvisorSnapshotV1 } from '../snapshot/snapshot.types';

export const LIMITS = {
  title: 300,
  evidenceText: 500,
  stepText: 2000,
  code: 8000,
  riskReason: 300,
  verification: 1000,
  formula: 500,
  language: 20,
  name: 253,
  maxSuggestions: 30,
  maxTargets: 50,
  maxEvidence: 10,
  maxSteps: 15,
} as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** 제어 문자 제거(줄바꿈·탭은 유지) + 길이 제한. 내용은 바꾸지 않는다 */
export function cleanText(v: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return s.length > max ? s.slice(0, max) : s;
}

// ---------------------------------------------------------------------------
// 1. 파싱
// ---------------------------------------------------------------------------

/** 텍스트에서 첫 JSON 객체를 찾는다 (코드 펜스·앞뒤 문장 허용) */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // 계속
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) {
    try {
      return JSON.parse(fence[1]) as unknown;
    } catch {
      // 계속
    }
  }
  for (
    let start = trimmed.indexOf('{');
    start !== -1;
    start = trimmed.indexOf('{', start + 1)
  ) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1)) as unknown;
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

export function parseBridgeOutput(
  structuredOutput: unknown,
  resultText: string | null,
): unknown[] | null {
  const candidates: unknown[] = [];
  if (structuredOutput !== null && structuredOutput !== undefined) {
    candidates.push(structuredOutput);
  }
  if (resultText) candidates.push(extractJsonObject(resultText));
  for (const c of candidates) {
    if (isObj(c) && Array.isArray(c.suggestions)) {
      return c.suggestions as unknown[];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. 스키마 검증 (B.4 출력 스키마와 같은 규칙)
// ---------------------------------------------------------------------------

export interface RawSuggestion {
  title: string;
  category: Category;
  severity: Severity;
  priority: number;
  targets: { kind: string; namespace: string | null; name: string }[];
  evidence: {
    field: string | null;
    value: string | number | null;
    text: string;
  }[];
  precheckIds: string[];
  savings: { monthlyUsd: number; formula: string } | null;
  steps: Step[];
  risk: { level: Severity; reason: string };
  verification: string | null;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const nonEmpty = (v: unknown): v is string => isStr(v) && v.trim().length > 0;

export function validateSuggestion(v: unknown): RawSuggestion | null {
  if (!isObj(v)) return null;
  if (!nonEmpty(v.title)) return null;
  if (!CATEGORIES.includes(v.category as Category)) return null;
  if (!SEVERITIES.includes(v.severity as Severity)) return null;
  if (
    typeof v.priority !== 'number' ||
    !Number.isInteger(v.priority) ||
    v.priority < 1
  )
    return null;
  if (!Array.isArray(v.targets) || v.targets.length < 1) return null;
  if (!Array.isArray(v.evidence) || v.evidence.length < 1) return null;
  if (!Array.isArray(v.steps) || v.steps.length < 1) return null;
  if (
    !isObj(v.risk) ||
    !SEVERITIES.includes(v.risk.level as Severity) ||
    !isStr(v.risk.reason)
  ) {
    return null;
  }

  const targets: RawSuggestion['targets'] = [];
  for (const t of v.targets.slice(0, LIMITS.maxTargets)) {
    if (!isObj(t) || !nonEmpty(t.kind) || !nonEmpty(t.name)) return null;
    if (
      t.namespace !== undefined &&
      t.namespace !== null &&
      !isStr(t.namespace)
    )
      return null;
    targets.push({
      kind: cleanText(t.kind, 40),
      namespace:
        isStr(t.namespace) && t.namespace !== ''
          ? cleanText(t.namespace, LIMITS.name)
          : null,
      name: cleanText(t.name, LIMITS.name),
    });
  }
  const evidence: RawSuggestion['evidence'] = [];
  for (const e of v.evidence.slice(0, LIMITS.maxEvidence)) {
    if (!isObj(e) || !nonEmpty(e.text)) return null;
    const value =
      typeof e.value === 'number' && Number.isFinite(e.value)
        ? e.value
        : isStr(e.value)
          ? cleanText(e.value, LIMITS.evidenceText)
          : null;
    evidence.push({
      field: isStr(e.field) && e.field !== '' ? cleanText(e.field, 300) : null,
      value,
      text: cleanText(e.text, LIMITS.evidenceText),
    });
  }
  const steps: Step[] = [];
  for (const s of v.steps.slice(0, LIMITS.maxSteps)) {
    if (!isObj(s) || !nonEmpty(s.text)) return null;
    const code = nonEmpty(s.code) ? cleanText(s.code, LIMITS.code) : null;
    const language = nonEmpty(s.language)
      ? cleanText(s.language, LIMITS.language)
      : 'text';
    steps.push({
      text: cleanText(s.text, LIMITS.stepText),
      code: code ? { language, content: code } : null,
    });
  }
  let savings: RawSuggestion['savings'] = null;
  if (isObj(v.savings)) {
    const m = v.savings.monthlyUsd;
    if (
      typeof m === 'number' &&
      Number.isFinite(m) &&
      m >= 0 &&
      isStr(v.savings.formula)
    ) {
      savings = {
        monthlyUsd: m,
        formula: cleanText(v.savings.formula, LIMITS.formula),
      };
    }
  }
  const precheckIds = Array.isArray(v.precheckIds)
    ? [
        ...new Set(
          v.precheckIds.filter(
            (x): x is string => isStr(x) && /^R-[A-Z0-9-]+$/.test(x),
          ),
        ),
      ]
    : [];
  return {
    title: cleanText(v.title, LIMITS.title),
    category: v.category as Category,
    severity: v.severity as Severity,
    priority: v.priority,
    targets,
    evidence,
    precheckIds,
    savings,
    steps,
    risk: {
      level: v.risk.level as Severity,
      reason: cleanText(v.risk.reason, LIMITS.riskReason),
    },
    verification: nonEmpty(v.verification)
      ? cleanText(v.verification, LIMITS.verification)
      : null,
  };
}

// ---------------------------------------------------------------------------
// 3. 대상 대조
// ---------------------------------------------------------------------------

const SCREEN_KINDS = new Set([
  'Node',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'PersistentVolumeClaim',
]);

export function resolveTarget(
  t: { kind: string; namespace: string | null; name: string },
  snap: AdvisorSnapshotV1,
  pseudonyms: PseudonymMap,
): TargetRef {
  let kind: TargetKind = (TARGET_KINDS as readonly string[]).includes(t.kind)
    ? (t.kind as TargetKind)
    : 'Other';
  let namespace = t.namespace;
  let name = t.name;
  if (!namespace && name.includes('/') && kind !== 'Other') {
    const [ns, ...rest] = name.split('/');
    namespace = ns;
    name = rest.join('/');
  }
  const snapshotName = namespace ? `${namespace}/${name}` : name;
  const out = (
    inSnapshot: boolean,
    realName = name,
    realKind: TargetKind = kind,
  ): TargetRef => ({
    kind: realKind,
    namespace,
    name: realName,
    snapshotName,
    inSnapshot,
    ref:
      inSnapshot && SCREEN_KINDS.has(realKind)
        ? { kind: realKind, namespace, name: realName }
        : null,
  });

  switch (kind) {
    case 'Node': {
      const n = snap.nodes.find((x) => x.name === name);
      return n ? out(true, pseudonyms.nodes[name] ?? name) : out(false);
    }
    case 'NodeGroup':
      return out(snap.nodeGroups.some((g) => g.name === name));
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet': {
      const exact = snap.workloads.find(
        (w) => w.kind === kind && w.namespace === namespace && w.name === name,
      );
      if (exact) return out(true);
      const loose = snap.workloads.find(
        (w) => w.namespace === namespace && w.name === name,
      );
      if (loose) {
        kind = loose.kind;
        return out(true, name, loose.kind);
      }
      return out(false);
    }
    case 'Pod': {
      const owner = snap.workloads.find(
        (w) =>
          w.namespace === namespace &&
          (name === w.name || name.startsWith(`${w.name}-`)),
      );
      return out(Boolean(owner));
    }
    case 'PersistentVolumeClaim':
      return out(
        snap.storage.some((s) => s.namespace === namespace && s.name === name),
      );
    case 'LoadBalancer': {
      const lb = snap.loadBalancers.find((l) => l.ref === name);
      return lb
        ? out(true, pseudonyms.loadBalancers[name] ?? name)
        : out(false);
    }
    case 'Namespace': {
      const nsName = namespace ?? name;
      const known =
        snap.workloads.some((w) => w.namespace === nsName) ||
        snap.storage.some((s) => s.namespace === nsName) ||
        (snap.cost?.allocation.some((a) => a.namespace === nsName) ?? false);
      return out(known);
    }
    case 'Database':
      return out(snap.db !== null);
    case 'Cluster':
      return out(true);
    default: {
      if (/^vol-\d+$/.test(name)) {
        const known =
          snap.unattachedVolumes.some((v) => v.volumeRef === name) ||
          snap.storage.some((s) => s.volumeRef === name);
        return out(known, pseudonyms.volumes[name] ?? name, 'Other');
      }
      const known =
        snap.workloads.some((w) => w.name === name) ||
        snap.nodeGroups.some((g) => g.name === name) ||
        snap.storage.some((s) => s.name === name);
      return out(known, name, 'Other');
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 근거 확인: 스냅샷 경로를 따라가 값 비교
// ---------------------------------------------------------------------------

type Seg = { key: string } | { select: string };

export function parseFieldPath(path: string): Seg[] | null {
  const segs: Seg[] = [];
  let i = 0;
  let cur = '';
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      if (cur) segs.push({ key: cur });
      cur = '';
      i += 1;
    } else if (ch === '[') {
      if (cur) segs.push({ key: cur });
      cur = '';
      const end = path.indexOf(']', i);
      if (end === -1) return null;
      segs.push({ select: path.slice(i + 1, end) });
      i = end + 1;
    } else {
      cur += ch;
      i += 1;
    }
  }
  if (cur) segs.push({ key: cur });
  return segs.length > 0 ? segs : null;
}

const ID_KEYS = [
  'name',
  'ref',
  'volumeRef',
  'nodeGroup',
  'instanceType',
  'namespace',
  'category',
  'reason',
  'service',
  'ruleId',
  'type',
];

function matchesSelector(item: unknown, sel: string): boolean {
  if (!isObj(item)) return false;
  const ns = isStr(item.namespace) ? item.namespace : null;
  for (const k of ID_KEYS) {
    const v = item[k];
    if (!isStr(v)) continue;
    if (v === sel) return true;
    if (ns && `${ns}/${v}` === sel) return true;
  }
  return false;
}

/** 경로가 존재하면 { found: true, value } */
export function resolveField(
  snap: unknown,
  path: string,
): { found: boolean; value: unknown } {
  const segs = parseFieldPath(path);
  if (!segs) return { found: false, value: undefined };
  let cur: unknown = snap;
  for (const s of segs) {
    if ('key' in s) {
      if (!isObj(cur) || !(s.key in cur))
        return { found: false, value: undefined };
      cur = cur[s.key];
    } else {
      if (!Array.isArray(cur)) return { found: false, value: undefined };
      if (
        /^\d+$/.test(s.select) &&
        Number(s.select) < cur.length &&
        !cur.some((x) => matchesSelector(x, s.select))
      ) {
        cur = cur[Number(s.select)];
        continue;
      }
      const hit: unknown = (cur as unknown[]).find((x) =>
        matchesSelector(x, s.select),
      );
      if (hit === undefined) return { found: false, value: undefined };
      cur = hit;
    }
  }
  return { found: true, value: cur };
}

export function valuesMatch(
  claimed: string | number | null,
  actual: unknown,
): boolean {
  if (claimed === null) return actual === null;
  if (actual === null || actual === undefined || typeof actual === 'object')
    return false;
  const cn =
    typeof claimed === 'number'
      ? claimed
      : Number(String(claimed).replace(/[%,$\s]/g, ''));
  if (
    typeof actual === 'number' &&
    Number.isFinite(cn) &&
    String(claimed).trim() !== ''
  ) {
    if (actual === 0) return Math.abs(cn) < 1e-9;
    return Math.abs(cn - actual) <= Math.abs(actual) * 0.01;
  }
  const actualText =
    typeof actual === 'string' ||
    typeof actual === 'number' ||
    typeof actual === 'boolean'
      ? String(actual)
      : '';
  return (
    String(claimed).trim().toLowerCase() === actualText.trim().toLowerCase()
  );
}

export function verifyEvidence(
  e: { field: string | null; value: string | number | null; text: string },
  snap: AdvisorSnapshotV1,
): Evidence {
  if (!e.field) return { ...e, verified: false };
  const r = resolveField(snap, e.field);
  return { ...e, verified: r.found && valuesMatch(e.value, r.value) };
}

// ---------------------------------------------------------------------------
// 전체
// ---------------------------------------------------------------------------

export type FinalizeOutcome =
  | { ok: true; suggestions: Suggestion[]; counts: RunCounts }
  | { ok: false; reason: 'invalid_response'; dropped: number };

export interface FinalizeInput {
  structuredOutput: unknown;
  resultText: string | null;
  snapshot: AdvisorSnapshotV1;
  pseudonyms: PseudonymMap;
  prechecks: PrecheckItem[];
  idFactory?: () => string;
}

export function finalizeResult(input: FinalizeInput): FinalizeOutcome {
  const raw = parseBridgeOutput(input.structuredOutput, input.resultText);
  if (raw === null)
    return { ok: false, reason: 'invalid_response', dropped: 0 };

  let dropped = Math.max(0, raw.length - LIMITS.maxSuggestions);
  const valid: RawSuggestion[] = [];
  for (const r of raw.slice(0, LIMITS.maxSuggestions)) {
    const v = validateSuggestion(r);
    if (v) valid.push(v);
    else dropped += 1;
  }
  // 전부 형식 오류면 해석 불가로 본다 (원문 보관)
  if (valid.length === 0 && dropped > 0) {
    return { ok: false, reason: 'invalid_response', dropped };
  }

  // 6. 같은 사전 점검을 참조하는 제안 병합 (우선순위 높은 것으로)
  const byPriority = valid
    .map((v, idx) => ({ v, idx }))
    .sort((a, b) => a.v.priority - b.v.priority || a.idx - b.idx)
    .map((x) => x.v);
  const merged: RawSuggestion[] = [];
  for (const s of byPriority) {
    const host = merged.find((m) =>
      m.precheckIds.some((id) => s.precheckIds.includes(id)),
    );
    if (!host) {
      merged.push({
        ...s,
        targets: [...s.targets],
        evidence: [...s.evidence],
        precheckIds: [...s.precheckIds],
      });
      continue;
    }
    for (const t of s.targets) {
      if (
        !host.targets.some(
          (h) =>
            h.kind === t.kind &&
            h.namespace === t.namespace &&
            h.name === t.name,
        )
      ) {
        host.targets.push(t);
      }
    }
    for (const e of s.evidence) {
      if (host.evidence.length >= LIMITS.maxEvidence) break;
      if (!host.evidence.some((h) => h.field === e.field && h.text === e.text))
        host.evidence.push(e);
    }
    host.precheckIds = [...new Set([...host.precheckIds, ...s.precheckIds])];
    host.targets = host.targets.slice(0, LIMITS.maxTargets);
  }

  const precheckById = new Map(input.prechecks.map((p) => [p.ruleId, p]));
  const asOf = input.snapshot.cost?.asOf ?? input.snapshot.meta.generatedAt;
  const newId = input.idFactory ?? randomUUID;

  const built = merged.map((s, order) => {
    const targets = s.targets.map((t) =>
      resolveTarget(t, input.snapshot, input.pseudonyms),
    );
    const evidence = s.evidence.map((e) => verifyEvidence(e, input.snapshot));
    const precheckIds = s.precheckIds.filter((id) => precheckById.has(id));
    // 7. 절감액: 서버 계산 우선
    const serverSavings = precheckIds
      .map((id) => precheckById.get(id)?.savings)
      .filter((x): x is Savings => Boolean(x));
    let savings: Savings | null = null;
    if (serverSavings.length > 0) {
      const total =
        Math.round(serverSavings.reduce((a, b) => a + b.monthlyUsd, 0) * 100) /
        100;
      savings = {
        monthlyUsd: total,
        kind: 'estimated',
        asOf: serverSavings[0].asOf,
        formula: cleanText(
          serverSavings.map((x) => x.formula).join(' + '),
          LIMITS.formula,
        ),
        source: 'server',
      };
    } else if (s.savings && s.savings.formula.trim() !== '') {
      savings = {
        monthlyUsd: s.savings.monthlyUsd,
        kind: 'estimated',
        asOf,
        formula: s.savings.formula,
        source: 'llm',
      };
    }
    const unverified =
      targets.some((t) => !t.inSnapshot) || !evidence.some((e) => e.verified);
    return { s, order, targets, evidence, precheckIds, savings, unverified };
  });

  // 5·8. unverified는 맨 뒤, priority 1..N 재번호
  built.sort(
    (a, b) => Number(a.unverified) - Number(b.unverified) || a.order - b.order,
  );
  const suggestions: Suggestion[] = built.map((b, i) => ({
    id: newId(),
    priority: i + 1,
    title: b.s.title,
    category: b.s.category,
    severity: b.s.severity,
    targets: b.targets,
    evidence: b.evidence,
    precheckIds: b.precheckIds,
    savings: b.savings,
    steps: b.s.steps,
    noExecuteNotice: NO_EXECUTE_NOTICE,
    risk: b.s.risk,
    verification: b.s.verification,
    unverified: b.unverified,
    source: 'llm',
  }));
  return {
    ok: true,
    suggestions,
    counts: countSuggestions(suggestions, dropped),
  };
}

export function countSuggestions(
  list: Suggestion[],
  dropped: number,
): RunCounts {
  const c: RunCounts = {
    suggestions: list.length,
    high: 0,
    medium: 0,
    low: 0,
    dropped,
  };
  for (const s of list) c[s.severity] += 1;
  return c;
}
