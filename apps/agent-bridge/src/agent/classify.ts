/**
 * SDK 메시지 → 브리지 오류 코드 분류 (계약 B.6)
 */

export type BridgeErrorCode =
  | 'login_required'
  | 'usage_limit'
  | 'timeout'
  | 'aborted'
  | 'unsafe_configuration'
  | 'claude_code_missing'
  | 'internal';

const LOGIN_ERRORS = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'verification_required',
  'account_on_hold',
]);
const USAGE_ERRORS = new Set(['rate_limit', 'billing_error']);

export function classifyAssistantError(
  error: string | undefined,
): BridgeErrorCode | null {
  if (!error) return null;
  if (LOGIN_ERRORS.has(error)) return 'login_required';
  if (USAGE_ERRORS.has(error)) return 'usage_limit';
  return null;
}

const LOGIN_TEXT =
  /(not logged in|please run \/login|invalid api key|oauth token (has )?expired|authentication[_ ]failed|log in again)/i;

/** result.is_error 텍스트·오류 문자열에서 로그인 문제를 찾는다 (SDK가 오류 코드를 주지 않는 경우 대비) */
export function looksLikeLoginProblem(
  text: string | null | undefined,
): boolean {
  return Boolean(text && LOGIN_TEXT.test(text));
}

/** resetsAt은 초 단위 epoch (ms로 오면 그대로) → ISO */
export function resetsAtToIso(resetsAt: number | undefined): string | null {
  if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= 0) {
    return null;
  }
  const ms = resetsAt < 1e12 ? resetsAt * 1000 : resetsAt;
  return new Date(ms).toISOString();
}

/** 도구가 모두 꺼져 있어야 한다. 구조화 출력을 쓰면 SDK가 넣는 StructuredOutput 하나만 허용 */
export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput';

export function unsafeTools(
  tools: readonly string[],
  structuredOutput: boolean,
): string[] {
  return tools.filter(
    (t) => !(structuredOutput && t === STRUCTURED_OUTPUT_TOOL),
  );
}

/** 오류 문자열에서 비밀값처럼 보이는 부분을 가리고 길이를 자른다 (로그·NDJSON용) */
export function redactErrorText(text: string, max = 500): string {
  const out = text
    .replace(/\b(sk-ant-[A-Za-z0-9_-]+)/g, '[가림]')
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|authorization)(\s*[=:]\s*)(\S+)/gi,
      '$1$2[가림]',
    )
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '[가림]')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}
