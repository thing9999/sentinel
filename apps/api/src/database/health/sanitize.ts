/**
 * 민감값 마스킹·잘라내기 헬퍼 (벤더 공통, 순수 함수).
 *
 * 원칙 (docs/db/health.md 6절):
 * - 기본 상태 조회 쿼리는 쿼리 원문(`pg_stat_activity.query`)을 **아예 가져오지 않는다**.
 *   아래 `sanitizeQueryText`는 원문을 다뤄야 하는 예외 상황(디버그 로그 등)을 위한 것이다.
 * - DB 접속 오류 메시지는 화면에 "판단 이유"로 나가므로 `sanitizeErrorMessage`를 거친다.
 */

export const DEFAULT_QUERY_TEXT_MAX = 120;
export const DEFAULT_ERROR_MESSAGE_MAX = 200;
export const MASK = '***';

/**
 * 디스코드 웹훅 URL. **URL 자체가 비밀값이다** — 경로에 토큰이 들어 있어서 주소를 아는 사람은
 * 누구나 그 채널에 글을 쓸 수 있다 (docs/specs/alerts.md 3.4.3).
 * 이 모듈은 의존성이 없는 잎(leaf) 모듈이라 패턴을 여기에 둔다.
 * `src/database/secret-settings.ts`가 이것을 가져다 쓴다 (반대로 하면 순환 import가 된다:
 * sanitize ← normalize ← settings-defaults ← secret-settings).
 */
export const DISCORD_WEBHOOK_URL_PATTERN =
  /https?:\/\/(?:[a-z0-9-]+\.)*discord(?:app)?\.com\/api\/webhooks\/\S*/gi;

/** 웹훅 주소는 일부만 남겨도 재사용될 수 있어 **통째로** 가린다. */
export const WEBHOOK_MASK = '[웹훅 주소 가림]';

/**
 * 문장 어디에 섞여 있어도 디스코드 웹훅 주소를 통째로 가린다.
 * (발송 실패 오류 메시지가 요청 URL을 그대로 되비추는 경우가 있다 — AC-ALERT13·20)
 */
export function redactDiscordWebhookUrls(text: string): string {
  // 전역 정규식이지만 String#replace는 시작·종료 시 lastIndex를 0으로 되돌리므로 반복 호출이 안전하다.
  return text.replace(DISCORD_WEBHOOK_URL_PATTERN, WEBHOOK_MASK);
}

/** 문자열을 최대 길이로 자른다. 잘렸으면 끝에 "…"를 붙인다. */
export function truncateText(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  if (max === 1) return '…';
  return `${text.slice(0, max - 1)}…`;
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

/**
 * SQL 문자열에서 리터럴과 주석을 가린다.
 * - '...' / E'...' / B'...' / X'...' / U&'...' / $tag$...$tag$ → ?
 * - 숫자 리터럴 → ? (위치 파라미터 $1 등은 유지)
 * - -- 주석, /* *\/ 주석 → 제거
 * - "식별자"는 유지
 * pg_stat_activity의 쿼리는 track_activity_query_size에서 잘려 있을 수 있으므로
 * 닫히지 않은 리터럴·주석은 끝까지 가린다.
 */
export function maskSqlLiterals(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- 주석
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2);
      i = end === -1 ? n : end;
      out += ' ';
      continue;
    }

    // /* */ 주석 (Postgres는 중첩 허용)
    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += ' ';
      continue;
    }

    // 따옴표 식별자: 그대로 복사
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2;
        } else if (sql[j] === '"') {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // 문자열 리터럴 (접두사 E/B/X/U& 처리)
    if (ch === "'") {
      let backslashEscapes = false;
      const prefixMatch = /(?:^|[^A-Za-z0-9_$])(E|e|B|b|X|x|U&|u&)$/.exec(out);
      if (prefixMatch) {
        const prefix = prefixMatch[1];
        backslashEscapes = prefix === 'E' || prefix === 'e';
        out = out.slice(0, out.length - prefix.length);
      }
      let j = i + 1;
      while (j < n) {
        if (backslashEscapes && sql[j] === '\\') {
          j += 2;
        } else if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
        } else if (sql[j] === "'") {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      out += '?';
      i = Math.min(j, n);
      continue;
    }

    // 달러 인용 $tag$...$tag$ (위치 파라미터 $1과 구분)
    if (ch === '$' && !isIdentChar(sql[i - 1])) {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? n : end + tag.length;
        out += '?';
        continue;
      }
      // $1 같은 위치 파라미터: 그대로 복사
      const paramMatch = /^\$\d+/.exec(sql.slice(i));
      if (paramMatch) {
        out += paramMatch[0];
        i += paramMatch[0].length;
        continue;
      }
    }

    // 숫자 리터럴 (식별자 일부가 아닌 경우)
    if (/[0-9]/.test(ch) && !isIdentChar(sql[i - 1])) {
      const numMatch =
        /^(?:0x[0-9A-Fa-f_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?)/.exec(
          sql.slice(i),
        );
      if (numMatch) {
        out += '?';
        i += numMatch[0].length;
        continue;
      }
    }

    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 쿼리 원문을 화면/로그에 내보낼 수 있는 형태로 만든다.
 * 리터럴·주석 가림 → 공백 정리 → 비밀 패턴 가림 → 최대 길이로 자르기.
 */
export function sanitizeQueryText(
  sql: string | null | undefined,
  max: number = DEFAULT_QUERY_TEXT_MAX,
): string | null {
  if (sql === null || sql === undefined) return null;
  const masked = maskSqlLiterals(sql).replace(/\s+/g, ' ').trim();
  return truncateText(redactSecrets(masked), max);
}

// ---------------------------------------------------------------------------
// Postgres **서버 로그 줄**의 값 가림 (logs 기능 `sql_statement` 규칙, AC-LOG49)
//
// `maskSqlLiterals`만으로는 부족하다는 것을 2026-09-24에 실측으로 확인했다:
//   - `DETAIL:  Key (email)=(a@b.com) already exists.` → **그대로 남는다.** SQL 문법이 아니라
//     따옴표도 숫자도 아니어서 리터럴 스캐너에 걸리지 않는다. 그런데 이 줄이 바로
//     "로그에 개인정보가 들어간다"의 대표 사례다.
//   - `DETAIL:  Failing row contains (1, alice, a@b.com, …)` → 숫자만 `?`가 되고 문자열은 남는다.
//   - 로그 줄 **전체**에 `maskSqlLiterals`를 돌리면 타임스탬프·PID까지 `?-?-? ?:?:? [?]`로 뭉개져
//     "무엇이 언제 실패했나"를 읽을 수 없다.
// 그래서 **값이 오는 자리만** 골라서 가리고 구조·테이블·컬럼·제약 이름은 남긴다.
// 리터럴 스캐너는 새로 만들지 않고 `maskSqlLiterals`를 그대로 재사용한다(규칙이 두 벌이 되지 않게).
// ---------------------------------------------------------------------------

/** 이 줄 뒤쪽이 SQL 문장이라는 표시. (non-global: `lastIndex` 부작용 없음) */
const PG_SQL_MARKER =
  /\b(STATEMENT|QUERY|statement|execute(?:\s+[^\s:]+)?)\s*:[ \t]*/;

/** 값이 큰따옴표로 오는 것이 확실한 오류 문구만. 식별자("테이블명")는 건드리지 않는다. */
const PG_QUOTED_VALUE_MESSAGES =
  /\b(invalid input syntax for type [\w ]+?|invalid input syntax for [\w ]+?|invalid input value for enum [^\s:]+|date\/time field value out of range|invalid value for parameter "[^"]*")\s*:\s*"[^"]*"/gi;

/**
 * SQL 문법이 아닌 자리에 값이 오는 Postgres 설명 줄을 가린다.
 * - `Key (email)=(a@b.com)` → `Key (email)=(?)`   ← **컬럼 이름은 남는다**
 * - `Failing row contains (1, alice, …)` → `Failing row contains (?)`
 * 값 목록을 쉼표로 쪼개지 않는 이유: 값 안에 쉼표가 들어갈 수 있어(`Doe, John`) 개수를 믿을 수 없다.
 * 그룹 전체를 `?` 하나로 바꾼다 — "어느 컬럼이 걸렸나"는 왼쪽 괄호에 그대로 남는다.
 */
export function maskPgDetailValues(text: string): string {
  let out = text.replace(/\b(Key\s*\([^)]*\)\s*=\s*)\([\s\S]*?\)/g, '$1(?)');
  // Failing row는 줄 끝의 `).`까지가 값이다. 탐욕적으로 잡아 통째로 가린다.
  out = out.replace(/\b(Failing row contains\s*)\([\s\S]*\)/g, '$1(?)');
  return out;
}

/**
 * Postgres 서버 로그 **한 줄**에서 값만 가린다 (통째로 지우지 않는다).
 * 로그 파이프라인이 줄 단위로 부른다. 여러 줄에 걸친 문장은 `createPgLogValueMasker()`를 쓴다.
 */
export function maskPgLogValues(line: string): string {
  let out = maskPgDetailValues(line);

  // `DETAIL:  parameters: $1 = 'a@b.com'` — 바인드 파라미터 값
  out = out.replace(
    /\b(parameters:[ \t]*)([\s\S]*)$/,
    (_m, head: string, rest: string) => head + maskSqlLiterals(rest),
  );

  // `STATEMENT:` / `QUERY:` / `LOG: statement:` / `execute <unnamed>:` 뒤는 SQL이다.
  // **마커 뒤쪽에만** 적용해 앞의 타임스탬프·PID·심각도를 지킨다.
  const marker = PG_SQL_MARKER.exec(out);
  if (marker) {
    const at = marker.index + marker[0].length;
    out = out.slice(0, at) + maskSqlLiterals(out.slice(at));
  }

  // `CONTEXT:  SQL statement "UPDATE … 'v'"` 안쪽도 SQL이다
  out = out.replace(
    /\b(SQL statement\s*")([\s\S]*?)(")/g,
    (_m, a: string, sql: string, b: string) => a + maskSqlLiterals(sql) + b,
  );

  // 값이 큰따옴표로 오는 알려진 오류 문구
  out = out.replace(PG_QUOTED_VALUE_MESSAGES, (m) =>
    m.replace(/"[^"]*"$/, '"?"'),
  );

  return out;
}

/**
 * 여러 줄에 걸친 문장까지 덮는 줄 단위 가림기.
 *
 * Postgres는 이어지는 줄을 **탭/공백으로 들여쓴다.** 직전 줄이 `STATEMENT:` 등으로 문장을
 * 열었으면 들여쓴 다음 줄을 그 문장의 조각으로 보고 리터럴을 가린다.
 * 문장을 열지 않은 상태에서는 들여쓴 줄을 건드리지 않는다(앱 스택 트레이스의 줄 번호를
 * `?`로 만들지 않기 위해서다).
 *
 * ```ts
 * const mask = createPgLogValueMasker();
 * for (const line of lines) out.push(mask(line));
 * ```
 */
export function createPgLogValueMasker(): (line: string) => string {
  let insideStatement = false;
  return (line: string): string => {
    const isContinuation = /^[ \t]/.test(line);
    if (isContinuation && insideStatement) return maskSqlLiterals(line);
    if (!isContinuation) insideStatement = false;
    const out = maskPgLogValues(line);
    if (PG_SQL_MARKER.test(line)) insideStatement = true;
    return out;
  };
}

/** URL 형식 접속 문자열의 비밀번호를 가린다. postgres://user:pw@host → postgres://user:***@host */
export function redactConnectionString(text: string): string {
  return text.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]*:)([^@\s]*)@/gi,
    `$1${MASK}@`,
  );
}

/**
 * 문자열 안의 비밀값 패턴을 가린다.
 * - **디스코드 웹훅 URL** (alerts 3.4.3 — 주소 자체가 비밀값)
 * - **Postgres 오류 설명의 값** (`Key (col)=(값)`, `Failing row contains (…)`)
 * - URL 접속 문자열 비밀번호
 * - key=value / key: value 형태의 password, secret, token, api key, access key
 * - SQL의 PASSWORD '...'
 * - AWS 액세스 키 ID (AKIA/ASIA...)
 * - PEM 블록
 */
export function redactSecrets(text: string): string {
  // 웹훅 주소를 가장 먼저 통째로 지운다. 뒤의 규칙이 URL을 부분적으로만 갉아먹어
  // 알아볼 수 있는 조각이 남는 일을 막는다.
  let out = redactDiscordWebhookUrls(text);
  // 제약 위반 오류가 값을 그대로 물고 오는 경우(드라이버 오류 메시지에 detail이 붙는 경우 등).
  // 컬럼 이름은 남으므로 "어느 컬럼이 걸렸나"는 그대로 보인다.
  out = maskPgDetailValues(out);
  out = redactConnectionString(out);
  out = out.replace(
    /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|secret[_-]?key)(\s*[=:]\s*)('[^']*'|"[^"]*"|[^\s,;&)]+)/gi,
    `$1$2${MASK}`,
  );
  out = out.replace(/\b(password\s+)('(?:[^']|'')*'?)/gi, `$1${MASK}`);
  out = out.replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, MASK);
  out = out.replace(
    /-----BEGIN [A-Z ]+-----[\s\S]*?(-----END [A-Z ]+-----|$)/g,
    MASK,
  );
  return out;
}

/**
 * DB 접속·조회 오류를 화면에 보여줄 한 줄로 만든다.
 * 접속 문자열·비밀번호를 가리고, 줄바꿈을 없애고, 최대 길이로 자른다.
 * Postgres 오류 코드(SQLSTATE)가 있으면 앞에 붙인다.
 */
export function sanitizeErrorMessage(
  err: unknown,
  max: number = DEFAULT_ERROR_MESSAGE_MAX,
): string {
  let message: string;
  let code: string | undefined;
  if (err instanceof Error) {
    message = err.message;
    const maybeCode = (err as { code?: unknown }).code;
    if (typeof maybeCode === 'string') code = maybeCode;
  } else if (typeof err === 'string') {
    message = err;
  } else {
    message = '알 수 없는 오류';
  }
  const cleaned = redactSecrets(message).replace(/\s+/g, ' ').trim();
  const withCode = code ? `[${code}] ${cleaned}` : cleaned;
  return truncateText(withCode || '알 수 없는 오류', max);
}
