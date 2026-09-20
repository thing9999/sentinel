import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import Fastify, { type FastifyInstance } from 'fastify';
import { clampLimits, runAdvise, type AdviseEvent } from './agent/advise.js';
import { applyAuthCheck } from './agent/auth-check.js';
import {
  PROMPT_VERSION,
  SUPPORTED_PROMPT_VERSIONS,
} from './agent/output-schema.js';
import { pingAgent, type QueryFn } from './agent/ping.js';
import { findClaudeCodeExecutable, getSdkVersion } from './agent/sdk-info.js';
import { BridgeState } from './agent/state.js';
import type { BridgeConfig } from './config.js';
import { createAuthHook } from './http/auth.js';

export interface ServerDeps {
  queryFn?: QueryFn;
  logger?: boolean;
  state?: BridgeState;
  /** 테스트용: Claude Code 실행 파일 존재 여부 */
  claudeCodeAvailable?: () => boolean;
  /** 테스트용: ping/progress 주기 */
  pingIntervalMs?: number;
  progressIntervalMs?: number;
  /** 테스트용 시스템 프롬프트 (파일 대신) */
  systemPromptBase?: string;
}

/** 요청 본문 최대 1MB (계약 B.1) */
export const BODY_LIMIT_BYTES = 1_048_576;
const AUTH_CHECK_TIMEOUT_MS = 60_000;

interface AdviseBody {
  runId?: unknown;
  promptVersion?: unknown;
  snapshot?: unknown;
  limits?: unknown;
}

function errorBody(code: string, message: string, extra: object = {}) {
  return { code, message, ...extra };
}

export function buildServer(
  config: BridgeConfig,
  deps: ServerDeps = {},
): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: BODY_LIMIT_BYTES,
  });
  const queryFn: QueryFn = deps.queryFn ?? query;
  const state = deps.state ?? new BridgeState();
  let claudeVersion: string | null = null;
  const claudeAvailable =
    deps.claudeCodeAvailable ??
    (() => Boolean(findClaudeCodeExecutable(config.claudeCodePath)));

  app.addHook('onRequest', createAuthHook(config.token));

  app.setErrorHandler(
    (
      err: { statusCode?: number; code?: string; message?: string },
      _req,
      reply,
    ) => {
      if (err.statusCode === 413 || err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        return reply
          .code(413)
          .send(errorBody('payload_too_large', '요청 본문이 1MB를 넘습니다.'));
      }
      if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        return reply
          .code(err.statusCode)
          .send(
            errorBody('invalid_request', err.message ?? '잘못된 요청입니다.'),
          );
      }
      app.log.error(err);
      return reply.code(500).send(errorBody('internal', '브리지 내부 오류'));
    },
  );

  // 계약 B.3.1: 가벼운 확인 (LLM 호출 없음)
  app.get('/health', () => {
    const usage = state.usageLimit;
    return {
      status: 'ok',
      sdkVersion: getSdkVersion(),
      claudeCodeAvailable: claudeAvailable(),
      claudeCodeVersion: claudeVersion,
      auth: { ...state.auth },
      usageLimit: usage,
      busy: state.busy,
      activeRunId: state.active?.kind === 'advise' ? state.active.runId : null,
      promptVersion: PROMPT_VERSION,
    };
  });

  // 계약 B.3.2: 인증 확인 (최소 쿼리)
  const authCheck = async (): Promise<{ status: number; body: unknown }> => {
    if (!claudeAvailable()) {
      return {
        status: 503,
        body: errorBody(
          'claude_code_missing',
          'Claude Code 실행 파일을 찾을 수 없습니다.',
        ),
      };
    }
    const runId = `auth-check-${randomUUID()}`;
    const job = {
      runId,
      kind: 'auth_check' as const,
      abortController: new AbortController(),
      startedAt: Date.now(),
    };
    if (!state.tryAcquire(job)) {
      return {
        status: 409,
        body: errorBody('busy', '다른 분석이 실행 중입니다.', {
          activeRunId: state.active?.runId ?? null,
        }),
      };
    }
    try {
      const ping = await pingAgent(queryFn, {
        model: config.model,
        claudeCodePath: config.claudeCodePath,
        timeoutMs: AUTH_CHECK_TIMEOUT_MS,
      });
      if (ping.session.claudeCodeVersion) {
        claudeVersion = ping.session.claudeCodeVersion;
      }
      return { status: 200, body: applyAuthCheck(ping, state) };
    } finally {
      state.release(runId);
    }
  };

  app.post('/v1/auth-check', async (_req, reply) => {
    const r = await authCheck();
    return reply.code(r.status).send(r.body);
  });

  // 뼈대 진단 경로 (유지): 결과·세션·비용 상세. 인증 상태도 함께 갱신한다.
  app.post('/v1/ping-agent', async (_req, reply) => {
    const job = {
      runId: `ping-${randomUUID()}`,
      kind: 'auth_check' as const,
      abortController: new AbortController(),
      startedAt: Date.now(),
    };
    if (!state.tryAcquire(job)) {
      return reply
        .code(409)
        .send(errorBody('busy', '다른 분석이 실행 중입니다.'));
    }
    try {
      const result = await pingAgent(queryFn, {
        model: config.model,
        claudeCodePath: config.claudeCodePath,
      });
      if (result.session.claudeCodeVersion) {
        claudeVersion = result.session.claudeCodeVersion;
      }
      applyAuthCheck(result, state);
      return reply.code(result.ok ? 200 : 502).send(result);
    } finally {
      state.release(job.runId);
    }
  });

  // 계약 B.3.3: 분석 (NDJSON 스트림)
  app.post<{ Body: AdviseBody }>('/v1/advise', async (req, reply) => {
    const body: AdviseBody = req.body ?? {};
    const runId = body.runId;
    if (typeof runId !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(runId)) {
      return reply
        .code(400)
        .send(errorBody('invalid_request', 'runId가 올바르지 않습니다.'));
    }
    const promptVersion = body.promptVersion ?? PROMPT_VERSION;
    if (
      typeof promptVersion !== 'string' ||
      !SUPPORTED_PROMPT_VERSIONS.includes(promptVersion)
    ) {
      return reply
        .code(400)
        .send(
          errorBody(
            'unsupported_prompt_version',
            `지원하지 않는 promptVersion: ${JSON.stringify(promptVersion)}`,
          ),
        );
    }
    const snapshot = body.snapshot as { schemaVersion?: unknown } | undefined;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.schemaVersion !== 1
    ) {
      return reply
        .code(400)
        .send(
          errorBody(
            'invalid_request',
            'snapshot.schemaVersion은 1이어야 합니다.',
          ),
        );
    }
    if (!claudeAvailable()) {
      return reply
        .code(503)
        .send(
          errorBody(
            'claude_code_missing',
            'Claude Code 실행 파일을 찾을 수 없습니다.',
          ),
        );
    }
    const abortController = new AbortController();
    const job = {
      runId,
      kind: 'advise' as const,
      abortController,
      startedAt: Date.now(),
    };
    if (!state.tryAcquire(job)) {
      return reply.code(409).send(
        errorBody('busy', '다른 분석이 실행 중입니다.', {
          activeRunId: state.active?.runId ?? null,
        }),
      );
    }

    const limits = clampLimits(body.limits);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    });
    let ended = false;
    const write = (e: AdviseEvent) => {
      if (ended || raw.destroyed) return;
      raw.write(`${JSON.stringify(e)}\n`);
    };
    // 클라이언트(api) 연결이 끊기면 분석을 중단한다 (api 재시작·타임아웃에도 작업이 남지 않게)
    raw.on('close', () => {
      if (!ended) abortController.abort();
    });

    write({
      type: 'accepted',
      runId,
      at: new Date().toISOString(),
      promptVersion,
    });
    try {
      await runAdvise(
        { runId, snapshot, limits },
        {
          queryFn,
          state,
          model: config.model,
          claudeCodePath: config.claudeCodePath,
          outputMode: config.outputMode,
          systemPromptBase: deps.systemPromptBase,
          pingIntervalMs: deps.pingIntervalMs,
          progressIntervalMs: deps.progressIntervalMs,
        },
        (e) => {
          if (e.type === 'init' && e.claudeCodeVersion) {
            claudeVersion = e.claudeCodeVersion;
          }
          if (e.type === 'result' || e.type === 'error') {
            app.log.info(
              {
                runId,
                type: e.type,
                ...(e.type === 'error'
                  ? { code: e.code, message: e.message }
                  : {
                      subtype: e.subtype,
                      totalCostUsd: e.totalCostUsd,
                      durationMs: e.durationMs,
                      numTurns: e.numTurns,
                    }),
              },
              'advise finished',
            );
          }
          write(e);
        },
        abortController.signal,
      );
    } catch (err) {
      app.log.error(err);
      write({ type: 'error', code: 'internal', message: '브리지 내부 오류' });
    } finally {
      state.release(runId);
      ended = true;
      if (!raw.destroyed) raw.end();
    }
  });

  // 계약 B.3.4: 취소
  app.post<{ Params: { runId: string } }>(
    '/v1/runs/:runId/cancel',
    async (req, reply) => {
      const active = state.active;
      if (
        !active ||
        active.kind !== 'advise' ||
        active.runId !== req.params.runId
      ) {
        return reply
          .code(404)
          .send(errorBody('not_found', '실행 중인 분석이 없습니다.'));
      }
      active.abortController.abort();
      return reply.code(202).send({ cancelled: true });
    },
  );

  return app;
}
