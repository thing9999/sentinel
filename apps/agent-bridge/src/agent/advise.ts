import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  classifyAssistantError,
  looksLikeLoginProblem,
  redactErrorText,
  resetsAtToIso,
  unsafeTools,
  type BridgeErrorCode,
} from './classify.js';
import { buildAdvisorOptions, MAX_TURNS_LIMIT } from './options.js';
import { ADVISOR_OUTPUT_SCHEMA } from './output-schema.js';
import type { QueryFn } from './ping.js';
import {
  buildSystemPrompt,
  buildUserMessage,
  type OutputMode,
} from './prompt.js';
import type { BridgeState } from './state.js';

/** 계약 B.3.3 NDJSON 줄 */
export type AdviseEvent =
  | { type: 'accepted'; runId: string; at: string; promptVersion: string }
  | {
      type: 'init';
      model: string | null;
      claudeCodeVersion: string | null;
      permissionMode: string | null;
      tools: string[];
      apiKeySource: string | null;
    }
  | {
      type: 'progress';
      phase: 'waiting_first_token' | 'receiving';
      receivedChars: number;
      lastReceivedAt: string | null;
    }
  | { type: 'ping'; at: string }
  | AdviseResultEvent
  | {
      type: 'error';
      code: BridgeErrorCode;
      message: string;
      retryAt?: string | null;
    };

export interface AdviseResultEvent {
  type: 'result';
  subtype: string;
  isError: boolean;
  structuredOutput: unknown;
  resultText: string | null;
  resultTruncated?: boolean;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  permissionDenials: number;
  errors: string[];
}

export interface AdviseLimits {
  timeoutMs: number;
  maxTurns: number;
  maxBudgetUsd: number;
}

export const DEFAULT_LIMITS: AdviseLimits = {
  timeoutMs: 600_000,
  maxTurns: MAX_TURNS_LIMIT,
  maxBudgetUsd: 2.0,
};
export const MAX_TIMEOUT_MS = 900_000;
export const RESULT_TEXT_MAX_BYTES = 262_144;

function clamp(v: unknown, min: number, max: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.min(max, Math.max(min, v));
}

/** 계약: timeoutMs ≤ 900,000, maxTurns 1~MAX_TURNS_LIMIT(5), maxBudgetUsd 0.1~10 */
export function clampLimits(raw: unknown): AdviseLimits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    timeoutMs: Math.floor(
      clamp(r.timeoutMs, 1_000, MAX_TIMEOUT_MS, DEFAULT_LIMITS.timeoutMs),
    ),
    maxTurns: Math.floor(
      clamp(r.maxTurns, 1, MAX_TURNS_LIMIT, DEFAULT_LIMITS.maxTurns),
    ),
    maxBudgetUsd: clamp(r.maxBudgetUsd, 0.1, 10, DEFAULT_LIMITS.maxBudgetUsd),
  };
}

/** UTF-8 바이트 기준으로 자른다 */
export function truncateUtf8(
  text: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return { text, truncated: false };
  // 잘린 멀티바이트 문자는 toString이 U+FFFD로 바꾸므로 제거
  const cut = buf.subarray(0, maxBytes).toString('utf8').replace(/�$/, '');
  return { text: cut, truncated: true };
}

export interface AdviseDeps {
  queryFn: QueryFn;
  state: BridgeState;
  model?: string;
  claudeCodePath?: string;
  outputMode?: OutputMode;
  systemPromptBase?: string;
  pingIntervalMs?: number;
  progressIntervalMs?: number;
  now?: () => number;
}

interface StreamDelta {
  type?: string;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    thinking?: string;
  };
}

function deltaChars(event: unknown): number {
  const e = event as StreamDelta;
  if (e?.type !== 'content_block_delta' || !e.delta) return 0;
  const d = e.delta;
  if (d.type === 'text_delta') return d.text?.length ?? 0;
  if (d.type === 'input_json_delta') return d.partial_json?.length ?? 0;
  if (d.type === 'thinking_delta') return d.thinking?.length ?? 0;
  return 0;
}

interface AssistantContentBlock {
  type?: string;
  text?: string;
}

/**
 * 분석 1회 실행. accepted 이후의 NDJSON 이벤트를 emit으로 내보내고, 마지막은 항상 result 또는 error.
 * - 반드시 buildAdvisorOptions()를 거쳐 query()를 호출한다(도구 없음).
 * - LLM 텍스트는 밖으로 내보내지 않는다(글자 수만). 단 구조화 출력이 없을 때 최종 결과 텍스트는 result.resultText로 api에 넘긴다(계약).
 * - signal: 외부 취소(취소 API, 클라이언트 연결 끊김).
 */
export async function runAdvise(
  input: { runId: string; snapshot: unknown; limits: AdviseLimits },
  deps: AdviseDeps,
  emit: (event: AdviseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const now = deps.now ?? Date.now;
  const outputMode = deps.outputMode ?? 'json_schema';
  const structured = outputMode === 'json_schema';
  const iso = () => new Date(now()).toISOString();

  const abortController = new AbortController();
  let abortReason: 'aborted' | 'timeout' | 'unsafe_configuration' | null = null;
  let finished = false;
  let lastEmitAt = now();
  const send = (e: AdviseEvent) => {
    if (finished) return;
    if (e.type === 'result' || e.type === 'error') finished = true;
    lastEmitAt = now();
    emit(e);
  };

  let interruptFn: (() => Promise<unknown>) | undefined;
  const stop = (reason: 'aborted' | 'timeout' | 'unsafe_configuration') => {
    abortReason ??= reason;
    if (interruptFn) void interruptFn().catch(() => undefined);
    abortController.abort();
  };
  const onExternalAbort = () => stop('aborted');
  if (signal.aborted) onExternalAbort();
  else signal.addEventListener('abort', onExternalAbort, { once: true });

  const timeoutTimer = setTimeout(
    () => stop('timeout'),
    input.limits.timeoutMs,
  );
  const pingEvery = deps.pingIntervalMs ?? 10_000;
  const pingTimer = setInterval(
    () => {
      if (now() - lastEmitAt >= pingEvery) send({ type: 'ping', at: iso() });
    },
    Math.max(50, Math.floor(pingEvery / 2)),
  );

  const progressEvery = deps.progressIntervalMs ?? 1_000;
  let receivedChars = 0;
  let lastReceivedAt: string | null = null;
  let lastProgressAt = 0;
  let phase: 'waiting_first_token' | 'receiving' = 'waiting_first_token';
  let pendingProgress = false;
  const flushProgress = (force = false) => {
    if (!pendingProgress && !force) return;
    if (!force && now() - lastProgressAt < progressEvery) return;
    lastProgressAt = now();
    pendingProgress = false;
    send({ type: 'progress', phase, receivedChars, lastReceivedAt });
  };

  let detected = null as {
    code: BridgeErrorCode;
    retryAt: string | null;
  } | null;
  let lastAssistantText = '';
  let resultEvent = null as AdviseResultEvent | null;
  let thrown: unknown = null;

  try {
    const q = deps.queryFn({
      prompt: buildUserMessage(input.snapshot),
      options: buildAdvisorOptions({
        systemPrompt: buildSystemPrompt(outputMode, deps.systemPromptBase),
        model: deps.model,
        maxTurns: input.limits.maxTurns,
        maxBudgetUsd: input.limits.maxBudgetUsd,
        includePartialMessages: true,
        outputFormat: structured
          ? { type: 'json_schema', schema: ADVISOR_OUTPUT_SCHEMA }
          : undefined,
        abortController,
        pathToClaudeCodeExecutable: deps.claudeCodePath,
      }),
    });
    if (typeof (q as { interrupt?: unknown }).interrupt === 'function') {
      interruptFn = () => q.interrupt();
    }
    if (abortReason) abortController.abort();

    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (abortReason) break;
      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init') {
            send({
              type: 'init',
              model: msg.model ?? null,
              claudeCodeVersion: msg.claude_code_version ?? null,
              permissionMode: msg.permissionMode ?? null,
              tools: [...(msg.tools ?? [])],
              apiKeySource: msg.apiKeySource ?? null,
            });
            // 안전 확인: 도구가 하나라도 있으면(구조화 출력 도구 제외) 즉시 중단
            if (unsafeTools(msg.tools ?? [], structured).length > 0) {
              stop('unsafe_configuration');
            } else {
              flushProgress(true);
            }
          }
          break;
        case 'stream_event': {
          const n = deltaChars(msg.event);
          if (n > 0) {
            receivedChars += n;
            lastReceivedAt = iso();
            pendingProgress = true;
            if (phase !== 'receiving') {
              phase = 'receiving';
              flushProgress(true);
            } else {
              flushProgress();
            }
          }
          break;
        }
        case 'assistant': {
          const code = classifyAssistantError(msg.error);
          if (code) {
            const prev: string | null = detected ? detected.retryAt : null;
            detected = { code, retryAt: code === 'usage_limit' ? prev : null };
          }
          const blocks = (msg.message?.content ??
            []) as AssistantContentBlock[];
          const text = blocks
            .filter((b) => b.type === 'text' && typeof b.text === 'string')
            .map((b) => b.text)
            .join('');
          if (text) lastAssistantText = text;
          break;
        }
        case 'auth_status':
          if (msg.error) detected = { code: 'login_required', retryAt: null };
          break;
        case 'rate_limit_event': {
          const info = msg.rate_limit_info;
          if (info?.status === 'rejected') {
            const retryAt = resetsAtToIso(info.resetsAt);
            deps.state.setUsageLimit(true, retryAt);
            detected = { code: 'usage_limit', retryAt };
          }
          break;
        }
        case 'result': {
          const success = msg.subtype === 'success';
          const structuredOutput = success
            ? (msg.structured_output ?? null)
            : null;
          let resultText: string | null = null;
          let resultTruncated = false;
          if (structuredOutput === null) {
            const raw = success ? msg.result : lastAssistantText;
            if (raw) {
              const t = truncateUtf8(raw, RESULT_TEXT_MAX_BYTES);
              resultText = t.text;
              resultTruncated = t.truncated;
            }
          }
          const errors = success ? [] : (msg.errors ?? []);
          resultEvent = {
            type: 'result',
            subtype: msg.subtype,
            isError: msg.is_error,
            structuredOutput,
            resultText,
            ...(resultTruncated ? { resultTruncated: true } : {}),
            durationMs: msg.duration_ms,
            durationApiMs: msg.duration_api_ms,
            numTurns: msg.num_turns,
            totalCostUsd: msg.total_cost_usd,
            stopReason: msg.stop_reason ?? null,
            usage: {
              inputTokens: msg.usage?.input_tokens ?? 0,
              outputTokens: msg.usage?.output_tokens ?? 0,
              cacheReadInputTokens: msg.usage?.cache_read_input_tokens ?? 0,
              cacheCreationInputTokens:
                msg.usage?.cache_creation_input_tokens ?? 0,
            },
            permissionDenials: msg.permission_denials?.length ?? 0,
            errors: errors.map((e) => redactErrorText(String(e))),
          };
          if (
            !detected &&
            msg.is_error &&
            (looksLikeLoginProblem(success ? msg.result : errors.join(' ')) ||
              looksLikeLoginProblem(lastAssistantText))
          ) {
            detected = { code: 'login_required', retryAt: null };
          }
          break;
        }
        default:
          break;
      }
    }
  } catch (err) {
    thrown = err;
  } finally {
    clearTimeout(timeoutTimer);
    clearInterval(pingTimer);
    signal.removeEventListener('abort', onExternalAbort);
  }

  // ---- 마지막 줄 결정 ----
  if (abortReason === 'unsafe_configuration') {
    send({
      type: 'error',
      code: 'unsafe_configuration',
      message: '안전 설정 이상: 세션에 도구가 활성화되어 분석을 중단했습니다.',
    });
    return;
  }
  if (abortReason === 'timeout') {
    send({
      type: 'error',
      code: 'timeout',
      message: `시간 제한(${Math.round(input.limits.timeoutMs / 1000)}초)을 넘겨 중단했습니다.`,
    });
    return;
  }
  if (abortReason === 'aborted') {
    send({ type: 'error', code: 'aborted', message: '분석이 취소됐습니다.' });
    return;
  }

  const result = resultEvent;
  const resultOk =
    result !== null && result.subtype === 'success' && !result.isError;
  if (resultOk) {
    deps.state.setAuth('ok', 'advise');
    if (!detected || detected.code !== 'usage_limit') {
      deps.state.setUsageLimit(false, null);
    }
    send(result);
    return;
  }

  if (detected?.code === 'login_required') {
    deps.state.setAuth('login_required', 'advise');
    send({
      type: 'error',
      code: 'login_required',
      message: 'Claude Code 로그인이 필요합니다.',
    });
    return;
  }
  if (detected?.code === 'usage_limit') {
    deps.state.setAuth('ok', 'advise');
    deps.state.setUsageLimit(true, detected.retryAt);
    send({
      type: 'error',
      code: 'usage_limit',
      message: 'Claude Code 사용량 한도에 도달했습니다.',
      retryAt: detected.retryAt,
    });
    return;
  }
  if (result) {
    // 오류 subtype(error_max_budget_usd 등)은 result로 넘기고 api가 사유를 매핑한다
    if (result.subtype !== 'error_during_execution' || result.numTurns > 0) {
      deps.state.setAuth('ok', 'advise');
    }
    send(result);
    return;
  }

  const message =
    thrown instanceof Error
      ? thrown.message
      : typeof thrown === 'string'
        ? thrown
        : '';
  if (
    thrown &&
    ((thrown as { code?: unknown }).code === 'ENOENT' ||
      /ENOENT|executable not found|spawn .* ENOENT/i.test(message))
  ) {
    send({
      type: 'error',
      code: 'claude_code_missing',
      message: 'Claude Code 실행 파일을 찾을 수 없습니다.',
    });
    return;
  }
  if (
    looksLikeLoginProblem(message) ||
    looksLikeLoginProblem(lastAssistantText)
  ) {
    deps.state.setAuth('login_required', 'advise');
    send({
      type: 'error',
      code: 'login_required',
      message: 'Claude Code 로그인이 필요합니다.',
    });
    return;
  }
  send({
    type: 'error',
    code: 'internal',
    message: message
      ? redactErrorText(message)
      : 'SDK가 result 메시지 없이 종료했습니다.',
  });
}
