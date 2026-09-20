import type {
  Options,
  Query,
  SDKMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { buildAdvisorOptions } from './options.js';

export type QueryFn = (params: { prompt: string; options?: Options }) => Query;

export interface PingAgentResult {
  ok: boolean;
  /** SDK result 메시지의 result (성공 시 최종 텍스트) */
  text: string | null;
  /** 브리지에서 잰 전체 소요 시간 (프로세스 기동 포함) */
  elapsedMs: number;
  /** system/init 메시지에서 가져온 세션 정보 */
  session: {
    sessionId: string | null;
    model: string | null;
    claudeCodeVersion: string | null;
    apiKeySource: string | null;
    permissionMode: string | null;
    /** 세션에서 쓸 수 있는 도구 목록 (안전 설정 확인용: 비어 있어야 정상) */
    tools: string[];
  };
  /** SDK result 메시지 필드 */
  result: {
    subtype: SDKResultMessage['subtype'];
    isError: boolean;
    durationMs: number;
    durationApiMs: number;
    numTurns: number;
    totalCostUsd: number;
    stopReason: string | null;
    usage: SDKResultMessage['usage'];
    modelUsage: SDKResultMessage['modelUsage'];
    permissionDenials: number;
    errors: string[];
  } | null;
  /** 어시스턴트 메시지의 SDK 오류 코드 (authentication_failed, rate_limit 등) */
  assistantError: string | null;
  /** rate_limit_event status=rejected 수신 여부와 해제 시각(epoch 초) */
  rateLimit: { rejected: boolean; resetsAt: number | null };
  error?: string;
}

export const PING_PROMPT = 'Reply with OK';
const PING_SYSTEM_PROMPT =
  'You are a connectivity check for a monitoring dashboard. Reply with exactly: OK';

export async function pingAgent(
  queryFn: QueryFn,
  opts: { model?: string; timeoutMs?: number; claudeCodePath?: string } = {},
): Promise<PingAgentResult> {
  const started = Date.now();
  const abortController = new AbortController();
  const timer = setTimeout(
    () => abortController.abort(),
    opts.timeoutMs ?? 90_000,
  );

  const out: PingAgentResult = {
    ok: false,
    text: null,
    elapsedMs: 0,
    session: {
      sessionId: null,
      model: null,
      claudeCodeVersion: null,
      apiKeySource: null,
      permissionMode: null,
      tools: [],
    },
    result: null,
    assistantError: null,
    rateLimit: { rejected: false, resetsAt: null },
  };

  try {
    const q = queryFn({
      prompt: PING_PROMPT,
      options: buildAdvisorOptions({
        systemPrompt: PING_SYSTEM_PROMPT,
        model: opts.model,
        maxTurns: 1,
        effort: 'low',
        thinking: { type: 'disabled' },
        abortController,
        pathToClaudeCodeExecutable: opts.claudeCodePath,
      }),
    });

    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        out.session = {
          sessionId: msg.session_id,
          model: msg.model,
          claudeCodeVersion: msg.claude_code_version,
          apiKeySource: msg.apiKeySource,
          permissionMode: msg.permissionMode,
          tools: msg.tools,
        };
      } else if (msg.type === 'assistant') {
        if (msg.error) out.assistantError = msg.error;
      } else if (msg.type === 'auth_status') {
        if (msg.error) out.assistantError ??= 'authentication_failed';
      } else if (msg.type === 'rate_limit_event') {
        if (msg.rate_limit_info?.status === 'rejected') {
          out.rateLimit = {
            rejected: true,
            resetsAt: msg.rate_limit_info.resetsAt ?? null,
          };
        }
      } else if (msg.type === 'result') {
        out.result = {
          subtype: msg.subtype,
          isError: msg.is_error,
          durationMs: msg.duration_ms,
          durationApiMs: msg.duration_api_ms,
          numTurns: msg.num_turns,
          totalCostUsd: msg.total_cost_usd,
          stopReason: msg.stop_reason,
          usage: msg.usage,
          modelUsage: msg.modelUsage,
          permissionDenials: msg.permission_denials.length,
          errors: msg.subtype === 'success' ? [] : msg.errors,
        };
        if (msg.subtype === 'success') out.text = msg.result;
        out.session.sessionId ??= msg.session_id;
        out.ok = msg.subtype === 'success' && !msg.is_error;
      }
    }
    if (!out.result) out.error = 'SDK가 result 메시지 없이 종료했습니다.';
  } catch (err) {
    out.error = abortController.signal.aborted
      ? `시간 초과 (${opts.timeoutMs ?? 90_000}ms)`
      : err instanceof Error
        ? err.message
        : String(err);
  } finally {
    clearTimeout(timer);
    out.elapsedMs = Date.now() - started;
  }
  return out;
}
