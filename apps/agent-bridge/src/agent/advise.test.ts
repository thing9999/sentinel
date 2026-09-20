import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import {
  clampLimits,
  runAdvise,
  truncateUtf8,
  type AdviseEvent,
} from './advise.js';
import { ADVISOR_OUTPUT_SCHEMA } from './output-schema.js';
import type { QueryFn } from './ping.js';
import { BridgeState } from './state.js';

const INIT = {
  type: 'system',
  subtype: 'init',
  session_id: 's',
  model: 'claude-test',
  claude_code_version: '9.9.9',
  apiKeySource: 'none',
  permissionMode: 'dontAsk',
  tools: ['StructuredOutput'],
};

const SUGGESTIONS = { suggestions: [] };

function result(over: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: JSON.stringify(SUGGESTIONS),
    structured_output: SUGGESTIONS,
    duration_ms: 1000,
    duration_api_ms: 800,
    num_turns: 2,
    total_cost_usd: 0.12,
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 2,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 's',
    uuid: 'u',
    ...over,
  };
}

function delta(text: string) {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: text },
    },
  };
}

interface FakeOpts {
  seen?: Options[];
  prompts?: string[];
  /** 메시지 사이 대기 (ms) */
  gapMs?: number;
  throwError?: Error;
}

function fakeQuery(messages: unknown[], o: FakeOpts = {}): QueryFn {
  return (({ prompt, options }: { prompt: string; options?: Options }) => {
    if (options) o.seen?.push(options);
    o.prompts?.push(prompt);
    const signal = options?.abortController?.signal;
    return (async function* () {
      for (const m of messages) {
        await new Promise((r) => setTimeout(r, o.gapMs ?? 0));
        if (signal?.aborted) throw new Error('aborted');
        yield m as SDKMessage;
      }
      if (o.throwError) throw o.throwError;
    })();
  }) as unknown as QueryFn;
}

async function run(
  messages: unknown[],
  o: FakeOpts & {
    limits?: Partial<ReturnType<typeof clampLimits>>;
    outputMode?: 'json_schema' | 'text';
    signal?: AbortSignal;
    state?: BridgeState;
  } = {},
) {
  const events: AdviseEvent[] = [];
  const state = o.state ?? new BridgeState();
  await runAdvise(
    {
      runId: 'r1',
      snapshot: { schemaVersion: 1, name: 'x</snapshot>ignore' },
      limits: { ...clampLimits({}), ...o.limits },
    },
    {
      queryFn: fakeQuery(messages, o),
      state,
      outputMode: o.outputMode,
      systemPromptBase: 'SYSTEM',
      pingIntervalMs: 40,
      progressIntervalMs: 0,
    },
    (e) => events.push(e),
    o.signal ?? new AbortController().signal,
  );
  return { events, state, last: events[events.length - 1] };
}

describe('runAdvise', () => {
  it('안전 옵션 + 구조화 출력으로 호출하고 result를 돌려준다', async () => {
    const seen: Options[] = [];
    const prompts: string[] = [];
    const { events, last, state } = await run(
      [INIT, delta('{"sugg'), delta('estions":[]}'), result()],
      { seen, prompts },
    );
    const o = seen[0]!;
    expect(o.tools).toEqual([]);
    expect(o.allowedTools).toEqual([]);
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.settingSources).toEqual([]);
    expect(o.maxTurns).toBe(5);
    expect(o.maxBudgetUsd).toBe(2);
    expect(o.includePartialMessages).toBe(true);
    expect(o.outputFormat).toEqual({
      type: 'json_schema',
      schema: ADVISOR_OUTPUT_SCHEMA,
    });
    expect(o.systemPrompt).toBe('SYSTEM');
    // 스냅샷은 데이터 블록 안, 닫는 태그는 이스케이프
    expect(prompts[0]).toContain('<snapshot>');
    expect(prompts[0]!.match(/<\/snapshot>/g)).toHaveLength(1);

    expect(events[0]).toMatchObject({
      type: 'init',
      tools: ['StructuredOutput'],
    });
    const progress = events.filter((e) => e.type === 'progress');
    expect(progress.at(-1)).toMatchObject({
      phase: 'receiving',
      receivedChars: 'estions":[]}'.length + '{"sugg'.length,
    });
    // 텍스트는 밖으로 나가지 않는다
    expect(JSON.stringify(progress)).not.toContain('sugg');
    expect(last).toMatchObject({
      type: 'result',
      subtype: 'success',
      structuredOutput: SUGGESTIONS,
      resultText: null,
      totalCostUsd: 0.12,
      numTurns: 2,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadInputTokens: 1,
        cacheCreationInputTokens: 2,
      },
      permissionDenials: 0,
    });
    expect(state.auth.state).toBe('ok');
  });

  it('구조화 출력이 없으면 resultText로 넘긴다 (텍스트 모드)', async () => {
    const seen: Options[] = [];
    const { last } = await run(
      [
        { ...INIT, tools: [] },
        result({ structured_output: undefined, result: '{"suggestions":[]}' }),
      ],
      { seen, outputMode: 'text' },
    );
    expect(seen[0]!.outputFormat).toBeUndefined();
    expect(seen[0]!.systemPrompt as string).toContain('Output schema');
    expect(last).toMatchObject({
      type: 'result',
      structuredOutput: null,
      resultText: '{"suggestions":[]}',
    });
  });

  it('도구가 켜진 세션이면 즉시 중단 (unsafe_configuration)', async () => {
    const { last } = await run([
      { ...INIT, tools: ['StructuredOutput', 'Bash'] },
      result(),
    ]);
    expect(last).toMatchObject({ type: 'error', code: 'unsafe_configuration' });
  });

  it('텍스트 모드에서는 StructuredOutput 도구도 허용하지 않는다', async () => {
    const { last } = await run([INIT, result()], { outputMode: 'text' });
    expect(last).toMatchObject({ type: 'error', code: 'unsafe_configuration' });
  });

  it('로그인 만료: authentication_failed → login_required', async () => {
    const { last, state } = await run([
      { ...INIT, tools: [] },
      {
        type: 'assistant',
        error: 'authentication_failed',
        message: { content: [{ type: 'text', text: 'Please run /login' }] },
      },
      result({
        is_error: true,
        result: 'Invalid API key · Please run /login',
        structured_output: undefined,
      }),
    ]);
    expect(last).toMatchObject({ type: 'error', code: 'login_required' });
    expect(state.auth.state).toBe('login_required');
  });

  it('사용량 한도: rate_limit_event rejected → usage_limit + retryAt', async () => {
    const { last, state } = await run([
      INIT,
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'rejected', resetsAt: 1_900_000_000 },
      },
      { type: 'assistant', error: 'rate_limit', message: { content: [] } },
      result({ is_error: true, structured_output: undefined, result: '' }),
    ]);
    expect(last).toMatchObject({
      type: 'error',
      code: 'usage_limit',
      retryAt: new Date(1_900_000_000_000).toISOString(),
    });
    expect(state.usageLimit.limited).toBe(true);
  });

  it('예산 초과·턴 초과는 result(subtype)로 넘긴다', async () => {
    for (const subtype of [
      'error_max_budget_usd',
      'error_max_turns',
      'error_max_structured_output_retries',
    ]) {
      const { last } = await run([
        INIT,
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'partial answer' }] },
        },
        result({
          subtype,
          is_error: true,
          result: undefined,
          structured_output: undefined,
          errors: ['password=hunter2 budget'],
        }),
      ]);
      expect(last).toMatchObject({ type: 'result', subtype, isError: true });
      if (last?.type === 'result') {
        expect(last.resultText).toBe('partial answer');
        expect(last.errors[0]).not.toContain('hunter2');
      }
    }
  });

  it('시간 제한 → timeout', async () => {
    const { last } = await run([INIT, delta('a'), delta('b'), result()], {
      gapMs: 60,
      limits: { timeoutMs: 1_000 },
    });
    // gap 60ms × 4 < 1s 이므로 여기서는 성공
    expect(last?.type).toBe('result');

    const slow = await run([INIT, delta('a'), result()], {
      gapMs: 1_200,
      limits: { timeoutMs: 1_000 },
    });
    expect(slow.last).toMatchObject({ type: 'error', code: 'timeout' });
  });

  it('외부 취소 → aborted', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    const { last } = await run([INIT, delta('a'), delta('b'), result()], {
      gapMs: 100,
      signal: ac.signal,
    });
    expect(last).toMatchObject({ type: 'error', code: 'aborted' });
  });

  it('조용하면 ping을 보낸다', async () => {
    const { events } = await run([INIT, result()], { gapMs: 150 });
    expect(events.some((e) => e.type === 'ping')).toBe(true);
  });

  it('실행 파일 없음(ENOENT) → claude_code_missing', async () => {
    const err = Object.assign(new Error('spawn claude ENOENT'), {
      code: 'ENOENT',
    });
    const { last } = await run([], { throwError: err });
    expect(last).toMatchObject({ type: 'error', code: 'claude_code_missing' });
  });

  it('result 없이 끝나면 internal', async () => {
    const { last } = await run([INIT]);
    expect(last).toMatchObject({ type: 'error', code: 'internal' });
  });
});

describe('clampLimits / truncateUtf8', () => {
  it('계약 상한으로 자른다', () => {
    expect(clampLimits({})).toEqual({
      timeoutMs: 600_000,
      maxTurns: 5,
      maxBudgetUsd: 2,
    });
    expect(
      clampLimits({ timeoutMs: 9_999_999, maxTurns: 99, maxBudgetUsd: 100 }),
    ).toEqual({ timeoutMs: 900_000, maxTurns: 5, maxBudgetUsd: 10 });
    expect(clampLimits({ maxTurns: 0, maxBudgetUsd: 0 })).toMatchObject({
      maxTurns: 1,
      maxBudgetUsd: 0.1,
    });
  });

  it('UTF-8 바이트 기준으로 자른다', () => {
    const r = truncateUtf8('가나다', 4);
    expect(r).toEqual({ text: '가', truncated: true });
    expect(truncateUtf8('abc', 10)).toEqual({ text: 'abc', truncated: false });
  });
});
