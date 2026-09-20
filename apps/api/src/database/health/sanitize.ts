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

/** URL 형식 접속 문자열의 비밀번호를 가린다. postgres://user:pw@host → postgres://user:***@host */
export function redactConnectionString(text: string): string {
  return text.replace(
    /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]*:)([^@\s]*)@/gi,
    `$1${MASK}@`,
  );
}

/**
 * 문자열 안의 비밀값 패턴을 가린다.
 * - URL 접속 문자열 비밀번호
 * - key=value / key: value 형태의 password, secret, token, api key, access key
 * - SQL의 PASSWORD '...'
 * - AWS 액세스 키 ID (AKIA/ASIA...)
 * - PEM 블록
 */
export function redactSecrets(text: string): string {
  let out = redactConnectionString(text);
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
