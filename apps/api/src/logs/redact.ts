/**
 * 로그 가림(마스킹) — docs/api/logs.md 3절.
 *
 * 원칙 (여기서 지킨다. 호출부의 조심성에 기대지 않는다):
 * - **가림은 서버에서만** 일어난다. 가려지지 않은 원문이 이 함수 밖으로 나가지 않는다 (P1).
 * - **끄는 설정이 없다.** `LOG_REDACT_EXTRA_PATTERNS`는 **추가만** 한다 (P2, AC-LOG09).
 * - **fail-closed**: 처리 중 예외가 나면 그 줄을 `redactFailed`로 바꾼다. 원문은 통과하지 않는다 (P7).
 * - **식별자는 가리지 않는다**: IP·EC2 인스턴스 ID(`i-0…`)·계정 ID·ARN. kOps에서 노드 이름이
 *   인스턴스 ID라 가리면 "어느 노드인지"를 알 수 없다. 로그는 어드바이저로 나가지 않는다.
 *
 * `sql_statement`는 **규칙 하나**이고 다른 규칙과 **함께** 돈다. 구현은 DBA가 만든
 * `createPgLogValueMasker()`를 쓴다 — **줄 전체에 `maskSqlLiterals()`를 돌리지 않는다**
 * (타임스탬프·PID가 `?`가 되고, 정작 `Key (email)=(a@b.com)`은 안 잡힌다. AC-LOG49).
 */
import { createPgLogValueMasker } from '../database/health/sanitize';
import type { LogRuleRef, LogSegment } from './logs.types';

export interface RedactionRule {
  id: string;
  label: string;
  confidence: 'high' | 'suspect';
}

/**
 * 규칙 목록이 **정본**이다. **개수를 숫자로 박지 않는다** — 앞으로 늘어난다
 * (docs/design/logs.md 7.3, `capabilities.redaction.rules`가 이 목록을 그대로 내보낸다).
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
  { id: 'aws_access_key', label: 'AWS 액세스 키', confidence: 'high' },
  { id: 'aws_secret_key', label: 'AWS 시크릿 키', confidence: 'high' },
  { id: 'bearer_token', label: 'Bearer 토큰', confidence: 'high' },
  { id: 'jwt', label: 'JWT · 서비스 계정 토큰', confidence: 'high' },
  { id: 'kv_secret', label: '비밀 키-값', confidence: 'high' },
  { id: 'conn_string', label: '접속 문자열 자격 증명', confidence: 'high' },
  { id: 'private_key_block', label: '개인 키 블록', confidence: 'high' },
  { id: 'vendor_token', label: '서비스 토큰', confidence: 'high' },
  { id: 'env_dump', label: '환경 변수 덤프', confidence: 'high' },
  { id: 'sql_statement', label: 'SQL 문·오류 설명의 값', confidence: 'high' },
  { id: 'long_opaque', label: '긴 불투명 문자열', confidence: 'suspect' },
  {
    id: 'extra',
    label: '추가 규칙 (LOG_REDACT_EXTRA_PATTERNS)',
    confidence: 'high',
  },
] as const;

const RULE_BY_ID = new Map(REDACTION_RULES.map((r) => [r.id, r]));

export function ruleRef(id: string): LogRuleRef {
  const r = RULE_BY_ID.get(id);
  return { id, label: r?.label ?? id };
}

/** 표기: `앞 2글자****(N자)`. 원문이 6자 미만이면 `****(N자)`. 원문이 아니다 */
export function maskNotation(value: string): string {
  const n = [...value].length;
  return n >= 6 ? `${value.slice(0, 2)}****(${n}자)` : `****(${n}자)`;
}

interface Match {
  start: number;
  end: number;
  ruleIds: string[];
  /** 치환 결과. `sql_statement`만 `?` 계열이고 나머지는 `maskNotation` */
  replacement: string | null;
}

/** 값 자리(group)만 가리는 규칙 정의. group 0이면 전체 */
interface ValueRule {
  id: string;
  re: RegExp;
  groups: number[];
}

const VALUE_RULES: ValueRule[] = [
  { id: 'aws_access_key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, groups: [0] },
  {
    id: 'aws_secret_key',
    re: /\b(?:aws_secret[a-z_]*|secret_access_key)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    groups: [1],
  },
  {
    id: 'bearer_token',
    re: /\b[Bb]earer\s+([A-Za-z0-9\-._~+/]{20,}={0,2})/g,
    groups: [1],
  },
  {
    id: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g,
    groups: [0],
  },
  {
    id: 'kv_secret',
    re: /\b(?:password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|client[-_]?secret)\b\s*[=:]\s*(?:"([^"]+)"|'([^']+)'|([^\s,;&"'()]+))/gi,
    groups: [1, 2, 3],
  },
  // **자격 증명만** 가리고 호스트·포트·DB 이름은 남긴다 (AC-LOG06)
  {
    id: 'conn_string',
    re: /\b[a-z][a-z0-9+.-]*:\/\/([^:/\s@]+:[^@\s]+)@/gi,
    groups: [1],
  },
  {
    id: 'vendor_token',
    re: /\b(?:sk-ant-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,})\b/g,
    groups: [0],
  },
  // 오탐이 있을 수 있다(커밋 해시·트레이스 ID). **그래도 기본으로 가리고** 등급으로 알린다
  {
    id: 'long_opaque',
    re: /\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/]{40,}={0,2})\b/g,
    groups: [0],
  },
];

/** 한 줄에 `KEY=VALUE` 3쌍 이상 + 민감어가 있으면 그 값들만 가린다 */
const ENV_PAIR_RE = /\b[A-Z_][A-Z0-9_]*=/g;
const ENV_SECRET_RE =
  /\b([A-Z_][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|KEY|PWD|PASS)[A-Z0-9_]*)=([^\s]+)/g;

function collect(line: string, rules: ValueRule[]): Match[] {
  const out: Match[] = [];
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(line)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex += 1;
        continue;
      }
      for (const g of rule.groups) {
        const value = m[g];
        if (value === undefined || value === '') continue;
        const start = g === 0 ? m.index : line.indexOf(value, m.index);
        if (start < 0) continue;
        out.push({
          start,
          end: start + value.length,
          ruleIds: [rule.id],
          replacement: maskNotation(value),
        });
      }
    }
  }
  return out;
}

function collectEnvDump(line: string): Match[] {
  ENV_PAIR_RE.lastIndex = 0;
  const pairs = line.match(ENV_PAIR_RE);
  if (!pairs || pairs.length < 3) return [];
  const out: Match[] = [];
  ENV_SECRET_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENV_SECRET_RE.exec(line)) !== null) {
    const value = m[2];
    const start = m.index + m[1].length + 1;
    out.push({
      start,
      end: start + value.length,
      ruleIds: ['env_dump'],
      replacement: maskNotation(value),
    });
  }
  return out;
}

function collectExtra(line: string, patterns: RegExp[]): Match[] {
  const out: Match[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1;
        continue;
      }
      out.push({
        start: m.index,
        end: m.index + m[0].length,
        ruleIds: ['extra'],
        replacement: maskNotation(m[0]),
      });
    }
  }
  return out;
}

/**
 * `sql_statement` — 가림 여부 판정은 **입력·출력 문자열 비교**로 한다 (계약 3.2.1).
 * 바뀐 구간을 앞뒤 공통 부분으로 찾아 한 조각으로 만든다.
 * 치환 결과는 `?` 계열 그대로이고 `앞 2글자****(N자)`를 쓰지 않는다.
 */
function sqlDiff(original: string, masked: string): Match | null {
  if (original === masked) return null;
  let head = 0;
  const min = Math.min(original.length, masked.length);
  while (head < min && original[head] === masked[head]) head += 1;
  let tail = 0;
  while (
    tail < min - head &&
    original[original.length - 1 - tail] === masked[masked.length - 1 - tail]
  ) {
    tail += 1;
  }
  const start = head;
  const end = original.length - tail;
  if (end <= start) return null;
  return {
    start,
    end,
    ruleIds: ['sql_statement'],
    replacement: masked.slice(head, masked.length - tail),
  };
}

function mergeOverlaps(list: Match[]): Match[] {
  if (list.length === 0) return [];
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Match[] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m.start < last.end) {
      last.end = Math.max(last.end, m.end);
      for (const id of m.ruleIds)
        if (!last.ruleIds.includes(id)) last.ruleIds.push(id);
      last.replacement = null; // 병합된 구간은 아래에서 원문 길이로 다시 만든다
    } else {
      out.push({ ...m, ruleIds: [...m.ruleIds] });
    }
  }
  return out;
}

export interface RedactedLine {
  segments: LogSegment[];
  /** 이 줄에서 가려진 조각 수 (하단 상태 줄 `가림 N건`) */
  maskedCount: number;
  failed: boolean;
}

export interface LineRedactor {
  (line: string): RedactedLine;
}

/**
 * 조회·스트림 **1건당 하나**를 만들어 **줄 순서대로** 쓴다.
 * (`createPgLogValueMasker()`가 여러 줄에 걸친 SQL 문장을 상태로 따라가기 때문이다.)
 */
export function createLineRedactor(
  extraPatterns: readonly string[] = [],
): LineRedactor {
  const pgMask = createPgLogValueMasker();
  const extras: RegExp[] = [];
  for (const p of extraPatterns) {
    try {
      extras.push(new RegExp(p, 'g'));
    } catch {
      // 잘못된 정규식은 무시한다 (기능을 멈추지 않는다). 패턴 원문을 로그에 찍지 않는다
    }
  }

  return (line: string): RedactedLine => {
    try {
      const sqlMasked = pgMask(line);
      const sql = sqlDiff(line, sqlMasked);
      const others = [
        ...collect(line, VALUE_RULES),
        ...collectEnvDump(line),
        ...collectExtra(line, extras),
      ];

      // sql 구간과 겹치는 다른 규칙은 그 구간에 흡수시킨다 (같은 자리를 두 번 가리지 않는다)
      let kept = others;
      const matches: Match[] = [];
      if (sql) {
        kept = [];
        for (const m of others) {
          if (m.start < sql.end && sql.start < m.end) {
            for (const id of m.ruleIds)
              if (!sql.ruleIds.includes(id)) sql.ruleIds.push(id);
          } else {
            kept.push(m);
          }
        }
        matches.push(sql);
      }
      matches.push(...mergeOverlaps(kept));
      matches.sort((a, b) => a.start - b.start);

      if (matches.length === 0) {
        return {
          segments: line.length ? [{ t: 'text', v: line }] : [],
          maskedCount: 0,
          failed: false,
        };
      }

      const segments: LogSegment[] = [];
      let cursor = 0;
      for (const m of matches) {
        if (m.start > cursor) {
          segments.push({ t: 'text', v: line.slice(cursor, m.start) });
        }
        const original = line.slice(m.start, m.end);
        const confidence = m.ruleIds.some(
          (id) => RULE_BY_ID.get(id)?.confidence === 'high',
        )
          ? 'high'
          : 'suspect';
        segments.push({
          t: 'masked',
          v: m.replacement ?? maskNotation(original),
          rules: m.ruleIds.map(ruleRef),
          confidence,
        });
        cursor = m.end;
      }
      if (cursor < line.length) {
        segments.push({ t: 'text', v: line.slice(cursor) });
      }
      return { segments, maskedCount: matches.length, failed: false };
    } catch {
      // fail-closed: 원문을 통과시키지 않는다 (AC-LOG10)
      return { segments: [], maskedCount: 0, failed: true };
    }
  };
}

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const PRIVATE_KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;

/**
 * 개인 키 블록을 **한 줄로 접는다** (계약 4절). 줄 단위 가림보다 **먼저** 돌려야
 * 블록 안쪽 base64가 조각조각 나가지 않는다.
 * 닫히지 않은 블록은 남은 줄 전체를 접는다 (fail-closed 방향).
 */
export function collapsePrivateKeyBlocks(lines: string[]): {
  lines: string[];
  collapsed: { index: number; count: number }[];
  /** 접은 뒤 줄 번호 → 원본 줄 번호. 여러 파드를 섞어 볼 때 파드·컨테이너를 잃지 않으려고 함께 돌려준다 */
  sourceIndex: number[];
} {
  const out: string[] = [];
  const collapsed: { index: number; count: number }[] = [];
  const sourceIndex: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!PRIVATE_KEY_BEGIN.test(lines[i])) {
      sourceIndex.push(i);
      out.push(lines[i]);
      continue;
    }
    let end = i;
    while (end < lines.length && !PRIVATE_KEY_END.test(lines[end])) end += 1;
    const count = Math.min(end, lines.length - 1) - i + 1;
    collapsed.push({ index: out.length, count });
    sourceIndex.push(i);
    out.push('');
    i = Math.min(end, lines.length - 1);
  }
  return { lines: out, collapsed, sourceIndex };
}

export function privateKeyLine(count: number): LogSegment[] {
  return [
    {
      t: 'masked',
      v: `[가림: 개인 키 블록 ${count}줄]`,
      rules: [ruleRef('private_key_block')],
      confidence: 'high',
    },
  ];
}
