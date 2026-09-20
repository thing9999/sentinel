import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { PingAgentResult, QueryFn } from './agent/ping.js';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

function fakeQuery(messages: unknown[], seen: Options[] = []): QueryFn {
  return (({ options }: { options?: Options }) => {
    if (options) seen.push(options);
    return (async function* () {
      await Promise.resolve();
      for (const m of messages) yield m as SDKMessage;
    })();
  }) as unknown as QueryFn;
}

const INIT = {
  type: 'system',
  subtype: 'init',
  session_id: 's-1',
  model: 'claude-test',
  claude_code_version: '9.9.9',
  apiKeySource: 'none',
  permissionMode: 'dontAsk',
  tools: [],
};
const RESULT = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'OK',
  duration_ms: 1200,
  duration_api_ms: 900,
  num_turns: 1,
  total_cost_usd: 0.001,
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 1 },
  modelUsage: {},
  permission_denials: [],
  errors: [],
  session_id: 's-1',
  uuid: 'u',
};

const LOCAL = '127.0.0.1';
const DOCKER = '172.17.0.2';

describe('agent-bridge HTTP', () => {
  it('GET /health', async () => {
    const app = buildServer(loadConfig({}), { queryFn: fakeQuery([]) });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: LOCAL,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      status: string;
      sdkVersion: string;
      claudeCodeAvailable: boolean;
    }>();
    expect(body.status).toBe('ok');
    expect(body.sdkVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof body.claudeCodeAvailable).toBe('boolean');
  });

  it('POST /v1/ping-agent: 결과·세션·비용을 돌려주고 안전 옵션으로 호출한다', async () => {
    const seen: Options[] = [];
    const app = buildServer(loadConfig({}), {
      queryFn: fakeQuery([INIT, RESULT], seen),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ping-agent',
      remoteAddress: LOCAL,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<PingAgentResult>();
    expect(body.ok).toBe(true);
    expect(body.text).toBe('OK');
    expect(body.session.sessionId).toBe('s-1');
    expect(body.session.tools).toEqual([]);
    expect(body.result?.totalCostUsd).toBe(0.001);
    expect(seen[0]?.tools).toEqual([]);
    expect(seen[0]?.settingSources).toEqual([]);
    expect(seen[0]?.maxTurns).toBe(1);
  });

  it('result가 에러면 502', async () => {
    const app = buildServer(loadConfig({}), {
      queryFn: fakeQuery([
        {
          ...RESULT,
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['boom'],
        },
      ]),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/ping-agent',
      remoteAddress: LOCAL,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json<PingAgentResult>().result?.errors).toEqual(['boom']);
  });

  it('로컬 전용 모드: 루프백이 아니면 403', async () => {
    const app = buildServer(loadConfig({}), { queryFn: fakeQuery([]) });
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: DOCKER,
    });
    expect(res.statusCode).toBe(403);
  });

  it('토큰 모드: 헤더가 없거나 틀리면 401, 맞으면 200', async () => {
    const app = buildServer(loadConfig({ BRIDGE_TOKEN: 'secret' }), {
      queryFn: fakeQuery([]),
    });
    const none = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: DOCKER,
    });
    expect(none.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: DOCKER,
      headers: { 'x-bridge-token': 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'GET',
      url: '/health',
      remoteAddress: DOCKER,
      headers: { 'x-bridge-token': 'secret' },
    });
    expect(ok.statusCode).toBe(200);
  });
});
