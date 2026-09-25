import {
  failureMessage,
  mapBridgeErrorCode,
  mapBridgeHttpStatus,
  mapResultSubtype,
} from '../run/failure';
import {
  BridgeClient,
  BridgeHttpError,
  BridgeUnreachableError,
  type BridgeLine,
  type FetchFn,
} from './bridge-client';
import {
  BRIDGE_START_COMMAND,
  deriveBridgeStatus,
  MESSAGES,
  UNKNOWN_OBSERVATION,
  type BridgeObservation,
  type DeriveInput,
} from './bridge-status';
import type { BridgeHealth } from './bridge-client';

const NOW = new Date('2026-09-19T05:00:00.000Z');
const health = (over: Partial<BridgeHealth> = {}): BridgeHealth => ({
  status: 'ok',
  sdkVersion: '0.3.277',
  claudeCodeAvailable: true,
  claudeCodeVersion: '2.1.277',
  auth: { state: 'ok', checkedAt: NOW.toISOString() },
  usageLimit: { limited: false, retryAt: null },
  busy: false,
  activeRunId: null,
  promptVersion: 'advisor-v2',
  ...over,
});
const obs = (
  kind: BridgeObservation['kind'],
  h: BridgeHealth | null = null,
  detail: string | null = null,
): BridgeObservation => ({
  kind,
  health: h,
  detail,
  checkedAt: NOW.toISOString(),
});
const live = (o: BridgeObservation, over: Partial<DeriveInput> = {}) =>
  deriveBridgeStatus({
    dataSource: 'live',
    bridgeMode: 'live',
    scenario: null,
    usageRetryAt: null,
    observation: o,
    runActive: false,
    now: NOW,
    statusChangedAt: null,
    ...over,
  });

describe('deriveBridgeStatus (A.3.1 판정표)', () => {
  it('연결됨', () => {
    const s = live(obs('ok', health()));
    expect(s).toMatchObject({
      state: 'connected',
      canRun: true,
      disabledReason: null,
      exampleMode: false,
      message: MESSAGES.connected,
    });
    expect(s.status.status).toBe('ok');
    expect(s.sdkVersion).toBe('0.3.277');
  });

  it('연결 거부 → 미실행 + 실행 명령', () => {
    const s = live(obs('unreachable', null, '연결 거부'));
    expect(s).toMatchObject({
      state: 'unreachable',
      command: BRIDGE_START_COMMAND,
      canRun: false,
      disabledReason: 'bridge_unreachable',
    });
    expect(s.status.reasons[0]).toEqual({
      code: 'BRIDGE_UNREACHABLE',
      text: '브리지 미실행 (연결 거부)',
      status: 'critical',
    });
  });

  it('토큰 불일치·실행 파일 없음은 서버 메시지', () => {
    expect(live(obs('token_mismatch')).message).toBe(
      '브리지 토큰이 맞지 않습니다 (AGENT_BRIDGE_TOKEN 확인)',
    );
    expect(live(obs('token_mismatch')).status.reasons[0].code).toBe(
      'BRIDGE_TOKEN_MISMATCH',
    );
    expect(live(obs('claude_missing')).status.reasons[0].code).toBe(
      'BRIDGE_CLAUDE_MISSING',
    );
  });

  it('로그인 필요 → warning + claude 명령', () => {
    const s = live(
      obs('ok', health({ auth: { state: 'login_required', checkedAt: null } })),
    );
    expect(s).toMatchObject({
      state: 'login_required',
      command: 'claude',
      canRun: false,
      disabledReason: 'login_required',
    });
    expect(s.status.status).toBe('warning');
  });

  it('사용량 한도 (retryAt 전/후)', () => {
    const retryAt = new Date(NOW.getTime() + 3_600_000).toISOString();
    const s = live(
      obs('ok', health({ usageLimit: { limited: true, retryAt } })),
    );
    expect(s).toMatchObject({
      state: 'usage_limit',
      retryAt,
      disabledReason: 'usage_limit',
    });
    const past = live(
      obs(
        'ok',
        health({
          usageLimit: {
            limited: true,
            retryAt: new Date(NOW.getTime() - 1).toISOString(),
          },
        }),
      ),
    );
    expect(past.state).toBe('connected');
  });

  it('확인 전 unknown → checking, 실행 중 → run_in_progress', () => {
    expect(live(UNKNOWN_OBSERVATION)).toMatchObject({
      state: 'unknown',
      disabledReason: 'checking',
      canRun: false,
    });
    expect(live(obs('ok', health()), { runActive: true })).toMatchObject({
      disabledReason: 'run_in_progress',
      busy: true,
      canRun: false,
    });
  });

  it('mock + 브리지 호출 안 함 → 예시 모드 (버튼 활성)', () => {
    const s = live(UNKNOWN_OBSERVATION, {
      dataSource: 'mock',
      bridgeMode: 'mock',
      scenario: 'normal',
    });
    expect(s).toMatchObject({
      state: 'unreachable',
      exampleMode: true,
      canRun: true,
      message: MESSAGES.mockExample,
    });
  });

  it('mock + ADVISOR_BRIDGE=live: 연결되면 실제 분석, 없으면 예시', () => {
    expect(
      live(obs('ok', health()), { dataSource: 'mock', scenario: 'normal' }),
    ).toMatchObject({ state: 'connected', exampleMode: false, canRun: true });
    expect(
      live(obs('unreachable'), { dataSource: 'mock', scenario: 'normal' }),
    ).toMatchObject({ state: 'unreachable', exampleMode: true, canRun: true });
  });

  it('mock 시나리오: bridge-down/login-required/usage-limit은 버튼 비활성, 실패 시나리오는 예시', () => {
    const m = (scenario: DeriveInput['scenario']) =>
      live(UNKNOWN_OBSERVATION, {
        dataSource: 'mock',
        bridgeMode: 'mock',
        scenario,
        usageRetryAt: '2026-09-19T06:30:00.000Z',
      });
    expect(m('bridge-down')).toMatchObject({
      state: 'unreachable',
      canRun: false,
      exampleMode: false,
    });
    expect(m('login-required')).toMatchObject({
      state: 'login_required',
      canRun: false,
    });
    expect(m('usage-limit')).toMatchObject({
      state: 'usage_limit',
      retryAt: '2026-09-19T06:30:00.000Z',
      canRun: false,
    });
    for (const s of [
      'delayed',
      'timeout',
      'invalid-response',
      'budget-exceeded',
      'example',
    ] as const) {
      expect(m(s)).toMatchObject({ canRun: true, exampleMode: true });
    }
  });
});

describe('failure 매핑 (B.6)', () => {
  it('NDJSON error code', () => {
    expect(mapBridgeErrorCode('login_required').reason).toBe('login_required');
    expect(mapBridgeErrorCode('usage_limit', 'x', 'R')).toEqual({
      reason: 'usage_limit',
      retryAt: 'R',
    });
    expect(mapBridgeErrorCode('timeout').reason).toBe('timeout');
    expect(mapBridgeErrorCode('claude_code_missing').reason).toBe(
      'bridge_unavailable',
    );
    expect(mapBridgeErrorCode('unsafe_configuration')).toMatchObject({
      reason: 'other',
      logLevel: 'error',
    });
    expect(mapBridgeErrorCode('internal', 'boom').reason).toBe('other');
  });

  it('result subtype', () => {
    expect(mapResultSubtype('success', false)).toBeNull();
    expect(mapResultSubtype('success', true)).toBe('other');
    expect(mapResultSubtype('error_max_budget_usd', true)).toBe(
      'budget_exceeded',
    );
    expect(mapResultSubtype('error_max_turns', true)).toBe('invalid_response');
    expect(mapResultSubtype('error_max_structured_output_retries', true)).toBe(
      'invalid_response',
    );
    expect(mapResultSubtype('error_during_execution', true)).toBe('other');
  });

  it('HTTP 상태', () => {
    expect(mapBridgeHttpStatus(401).reason).toBe('bridge_unavailable');
    expect(mapBridgeHttpStatus(401).detail).toContain('AGENT_BRIDGE_TOKEN');
    expect(mapBridgeHttpStatus(409).reason).toBe('other');
    expect(mapBridgeHttpStatus(503, 'claude_code_missing').reason).toBe(
      'bridge_unavailable',
    );
  });

  it('사용자 문구 (A.9)', () => {
    expect(failureMessage('login_required')).toContain(
      '`claude`로 다시 로그인',
    );
    expect(failureMessage('timeout', { timeoutSec: 600 })).toBe(
      '브리지가 10분 안에 응답을 마치지 못했습니다.',
    );
    expect(failureMessage('budget_exceeded', { maxBudgetUsd: 2 })).toBe(
      '분석 비용이 상한 $2.00을 넘어 중단했습니다.',
    );
    expect(failureMessage('bridge_unavailable', { detail: '연결 거부' })).toBe(
      '어드바이저 브리지에 연결할 수 없습니다 (연결 거부).',
    );
    expect(
      failureMessage('other', { detail: 'password=hunter2 failed' }),
    ).not.toContain('hunter2');
  });
});

function ndjsonResponse(
  lines: unknown[],
  opts: { status?: number; delayMs?: number; end?: boolean } = {},
): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const l of lines) {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        // 줄을 두 조각으로 나눠 보내 줄 단위 파서 확인
        const text = `${JSON.stringify(l)}\n`;
        controller.enqueue(enc.encode(text.slice(0, 5)));
        controller.enqueue(enc.encode(text.slice(5)));
      }
      if (opts.end !== false) controller.close();
    },
  });
  return new Response(stream, {
    status: opts.status ?? 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

const asFetch = (fn: (url: string, init: RequestInit) => Response): FetchFn =>
  ((url: string, init: RequestInit) =>
    Promise.resolve().then(() => fn(url, init))) as unknown as FetchFn;

describe('BridgeClient', () => {
  it('advise: NDJSON 줄을 순서대로 넘기고 result에서 끝낸다, 토큰 헤더', async () => {
    let seenHeaders: Record<string, string> = {};
    const fetchFn = asFetch((_url: string, init: RequestInit) => {
      seenHeaders = init.headers as Record<string, string>;
      return ndjsonResponse([
        { type: 'accepted', runId: 'r', at: 'x', promptVersion: 'advisor-v2' },
        {
          type: 'progress',
          phase: 'receiving',
          receivedChars: 10,
          lastReceivedAt: 'x',
        },
        { type: 'result', subtype: 'success' },
      ]);
    });
    const c = new BridgeClient({
      baseUrl: 'http://b:3002/',
      token: 'tok',
      fetchFn,
    });
    const lines: BridgeLine[] = [];
    await c.advise(
      {},
      { signal: new AbortController().signal, onLine: (l) => lines.push(l) },
    );
    expect(lines.map((l) => l.type)).toEqual([
      'accepted',
      'progress',
      'result',
    ]);
    expect(seenHeaders['x-bridge-token']).toBe('tok');
  });

  it('advise: HTTP 오류 → BridgeHttpError(code)', async () => {
    const fetchFn = asFetch(
      () =>
        new Response(JSON.stringify({ code: 'busy', message: 'x' }), {
          status: 409,
        }),
    );
    const c = new BridgeClient({ baseUrl: 'http://b', fetchFn });
    await expect(
      c.advise(
        {},
        { signal: new AbortController().signal, onLine: () => undefined },
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'busy',
    });
  });

  it('advise: 결과 없이 끝나면 disconnected, 무응답이면 idle', async () => {
    const ended = new BridgeClient({
      baseUrl: 'http://b',
      fetchFn: asFetch(() => ndjsonResponse([{ type: 'ping', at: 'x' }])),
    });
    await expect(
      ended.advise(
        {},
        { signal: new AbortController().signal, onLine: () => undefined },
      ),
    ).rejects.toMatchObject({
      kind: 'disconnected',
    });
    const idle = new BridgeClient({
      baseUrl: 'http://b',
      fetchFn: asFetch((_u: string, init: RequestInit) => {
        const res = ndjsonResponse([{ type: 'ping', at: 'x' }], { end: false });
        init.signal?.addEventListener(
          'abort',
          () => void res.body?.cancel().catch(() => undefined),
        );
        return res;
      }),
    });
    const err = await idle
      .advise(
        {},
        {
          signal: new AbortController().signal,
          onLine: () => undefined,
          idleTimeoutMs: 100,
        },
      )
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeUnreachableError);
    expect((err as BridgeUnreachableError).kind).toBe('idle');
  });

  it('health: 연결 거부 → BridgeUnreachableError(refused), 401 → BridgeHttpError', async () => {
    const refused = new BridgeClient({
      baseUrl: 'http://b',
      fetchFn: asFetch(() => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: { code: 'ECONNREFUSED' },
        });
      }),
    });
    await expect(refused.health()).rejects.toMatchObject({ kind: 'refused' });
    const unauthorized = new BridgeClient({
      baseUrl: 'http://b',
      fetchFn: asFetch(
        () =>
          new Response(JSON.stringify({ code: 'unauthorized' }), {
            status: 401,
          }),
      ),
    });
    await expect(unauthorized.health()).rejects.toBeInstanceOf(BridgeHttpError);
  });

  it('health: 필드 정규화 (구버전 응답도 허용)', async () => {
    const c = new BridgeClient({
      baseUrl: 'http://b',
      fetchFn: asFetch(
        () =>
          new Response(
            JSON.stringify({
              status: 'ok',
              sdkVersion: '0.3.277',
              claudeCodeAvailable: true,
            }),
            { status: 200 },
          ),
      ),
    });
    const h = await c.health();
    expect(h).toMatchObject({
      auth: { state: 'unknown' },
      usageLimit: { limited: false },
      busy: false,
    });
  });
});
