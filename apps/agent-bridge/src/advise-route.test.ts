import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { QueryFn } from './agent/ping.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

const LOCAL = '127.0.0.1';
const RUN_ID = '7c1e2f40-9a3b-4d8e-b1c2-5f6a7b8c9d0e';
const SNAPSHOT = { schemaVersion: 1, meta: {} };

const INIT = {
  type: 'system',
  subtype: 'init',
  session_id: 's-1',
  model: 'claude-test',
  claude_code_version: '9.9.9',
  apiKeySource: 'none',
  permissionMode: 'dontAsk',
  tools: ['StructuredOutput'],
};
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '{"suggestions":[]}',
  structured_output: { suggestions: [] },
  duration_ms: 1200,
  duration_api_ms: 900,
  num_turns: 2,
  total_cost_usd: 0.05,
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 1 },
  modelUsage: {},
  permission_denials: [],
  errors: [],
  session_id: 's-1',
  uuid: 'u',
};

function fakeQuery(messages: unknown[], seen: Options[] = []): QueryFn {
  return (({ options }: { options?: Options }) => {
    if (options) seen.push(options);
    return (async function* () {
      await Promise.resolve();
      for (const m of messages) yield m as SDKMessage;
    })();
  }) as unknown as QueryFn;
}

/** abort 신호가 올 때까지 멈추는 가짜 query */
function hangingQuery(onAbort?: () => void): QueryFn {
  return (({ options }: { options?: Options }) =>
    (async function* () {
      yield INIT as unknown as SDKMessage;
      await new Promise<void>((resolve) => {
        const signal = options?.abortController?.signal;
        if (signal?.aborted) return resolve();
        signal?.addEventListener('abort', () => {
          onAbort?.();
          resolve();
        });
      });
      throw new Error('aborted');
    })()) as unknown as QueryFn;
}

const baseDeps = (queryFn: QueryFn) => ({
  queryFn,
  claudeCodeAvailable: () => true,
  systemPromptBase: 'SYSTEM',
});

function lines(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function listen(app: ReturnType<typeof buildServer>): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

const json = { 'content-type': 'application/json' };

describe('POST /v1/advise (NDJSON)', () => {
  it('accepted → init → progress → result, 안전 옵션 사용, 텍스트 미노출', async () => {
    const seen: Options[] = [];
    const app = buildServer(
      loadConfig({}),
      baseDeps(
        fakeQuery(
          [
            INIT,
            {
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'hello' },
              },
            },
            RESULT,
          ],
          seen,
        ),
      ),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/advise',
      remoteAddress: LOCAL,
      payload: {
        runId: RUN_ID,
        promptVersion: 'advisor-v2',
        snapshot: SNAPSHOT,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    const ls = lines(res.body);
    expect(ls.map((l) => l.type)).toEqual([
      'accepted',
      'init',
      'progress',
      'progress',
      'result',
    ]);
    expect(ls[0]).toMatchObject({ runId: RUN_ID, promptVersion: 'advisor-v2' });
    expect(ls[3]).toMatchObject({ phase: 'receiving', receivedChars: 5 });
    expect(ls[4]).toMatchObject({
      subtype: 'success',
      structuredOutput: { suggestions: [] },
      totalCostUsd: 0.05,
    });
    expect(res.body).not.toContain('hello');
    expect(seen[0]?.tools).toEqual([]);
    expect(seen[0]?.permissionMode).toBe('dontAsk');
    expect(seen[0]?.maxTurns).toBe(5);
    expect(seen[0]?.maxBudgetUsd).toBe(2);

    const health = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: LOCAL,
    });
    expect(health.json()).toMatchObject({
      status: 'ok',
      auth: { state: 'ok', source: 'advise' },
      usageLimit: { limited: false },
      busy: false,
      activeRunId: null,
      claudeCodeVersion: '9.9.9',
      promptVersion: 'advisor-v2',
    });
  });

  it('limits를 계약 상한으로 자른다', async () => {
    const seen: Options[] = [];
    const app = buildServer(
      loadConfig({}),
      baseDeps(fakeQuery([INIT, RESULT], seen)),
    );
    await app.inject({
      method: 'POST',
      url: '/v1/advise',
      remoteAddress: LOCAL,
      payload: {
        runId: RUN_ID,
        snapshot: SNAPSHOT,
        limits: { maxTurns: 50, maxBudgetUsd: 99, timeoutMs: 5_000 },
      },
    });
    expect(seen[0]?.maxTurns).toBe(5);
    expect(seen[0]?.maxBudgetUsd).toBe(10);
  });

  it('요청 검증: runId·promptVersion·schemaVersion', async () => {
    const app = buildServer(loadConfig({}), baseDeps(fakeQuery([])));
    const post = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/v1/advise',
        remoteAddress: LOCAL,
        payload,
      });
    const noId = await post({ snapshot: SNAPSHOT });
    expect(noId.statusCode).toBe(400);
    expect(noId.json()).toMatchObject({ code: 'invalid_request' });
    const v = await post({
      runId: RUN_ID,
      promptVersion: 'x',
      snapshot: SNAPSHOT,
    });
    expect(v.statusCode).toBe(400);
    expect(v.json()).toMatchObject({ code: 'unsupported_prompt_version' });
    const s = await post({ runId: RUN_ID, snapshot: { schemaVersion: 2 } });
    expect(s.statusCode).toBe(400);
  });

  it('1MB 초과 → 413 payload_too_large', async () => {
    const app = buildServer(loadConfig({}), baseDeps(fakeQuery([])));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/advise',
      remoteAddress: LOCAL,
      payload: {
        runId: RUN_ID,
        snapshot: { schemaVersion: 1, pad: 'x'.repeat(1_100_000) },
      },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'payload_too_large' });
  });

  it('실행 파일 없음 → 503 claude_code_missing', async () => {
    const app = buildServer(loadConfig({}), {
      ...baseDeps(fakeQuery([])),
      claudeCodeAvailable: () => false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/advise',
      remoteAddress: LOCAL,
      payload: { runId: RUN_ID, snapshot: SNAPSHOT },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'claude_code_missing' });
  });

  it('실행 중이면 409 busy, 취소하면 aborted로 끝난다', async () => {
    const app = buildServer(loadConfig({}), baseDeps(hangingQuery()));
    const base = await listen(app);
    try {
      const first = await fetch(`${base}/v1/advise`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ runId: RUN_ID, snapshot: SNAPSHOT }),
      });
      expect(first.status).toBe(200);

      const busy = await fetch(`${base}/v1/advise`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ runId: 'other', snapshot: SNAPSHOT }),
      });
      expect(busy.status).toBe(409);
      expect(await busy.json()).toMatchObject({
        code: 'busy',
        activeRunId: RUN_ID,
      });

      const health = await fetch(`${base}/health`);
      expect(await health.json()).toMatchObject({
        busy: true,
        activeRunId: RUN_ID,
      });

      const missing = await fetch(`${base}/v1/runs/nope/cancel`, {
        method: 'POST',
      });
      expect(missing.status).toBe(404);

      const cancel = await fetch(`${base}/v1/runs/${RUN_ID}/cancel`, {
        method: 'POST',
      });
      expect(cancel.status).toBe(202);
      const last = lines(await first.text()).at(-1);
      expect(last).toMatchObject({ type: 'error', code: 'aborted' });
    } finally {
      await app.close();
    }
  });

  it('클라이언트 연결이 끊기면 실행을 중단한다', async () => {
    let aborted = false;
    const app = buildServer(
      loadConfig({}),
      baseDeps(hangingQuery(() => (aborted = true))),
    );
    const base = await listen(app);
    try {
      const ac = new AbortController();
      const res = await fetch(`${base}/v1/advise`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ runId: RUN_ID, snapshot: SNAPSHOT }),
        signal: ac.signal,
      });
      const reader = res.body!.getReader();
      await reader.read();
      ac.abort();
      for (let i = 0; i < 100 && !aborted; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(aborted).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe('POST /v1/auth-check', () => {
  it('로그인 만료여도 200 + login_required', async () => {
    const app = buildServer(
      loadConfig({}),
      baseDeps(
        fakeQuery([
          { ...INIT, tools: [] },
          {
            type: 'assistant',
            error: 'authentication_failed',
            message: { content: [] },
          },
          { ...RESULT, is_error: true, result: 'Please run /login' },
        ]),
      ),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth-check',
      remoteAddress: LOCAL,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      auth: { state: 'login_required' },
      usageLimit: { limited: false },
      model: 'claude-test',
    });
    const health = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: LOCAL,
    });
    expect(health.json()).toMatchObject({
      auth: { state: 'login_required', source: 'auth_check' },
    });
  });

  it('실행 파일 없음 → 503', async () => {
    const app = buildServer(loadConfig({}), {
      ...baseDeps(fakeQuery([])),
      claudeCodeAvailable: () => false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth-check',
      remoteAddress: LOCAL,
    });
    expect(res.statusCode).toBe(503);
  });
});
