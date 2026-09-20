/**
 * api → agent-bridge HTTP 클라이언트 (계약 B.3). 브라우저는 브리지를 부르지 않는다.
 * fetch는 주입 가능(테스트).
 */

export interface BridgeHealth {
  status: string;
  sdkVersion: string | null;
  claudeCodeAvailable: boolean;
  claudeCodeVersion: string | null;
  auth: {
    state: 'ok' | 'login_required' | 'unknown';
    checkedAt: string | null;
    source?: string | null;
  };
  usageLimit: {
    limited: boolean;
    retryAt: string | null;
    checkedAt?: string | null;
  };
  busy: boolean;
  activeRunId: string | null;
  promptVersion: string | null;
}

export interface BridgeAuthCheck {
  auth: {
    state: 'ok' | 'login_required' | 'unknown';
    checkedAt: string | null;
  };
  usageLimit: { limited: boolean; retryAt: string | null };
  model: string | null;
  durationMs: number;
  costUsd: number | null;
}

export type BridgeLine =
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
      phase: string;
      receivedChars: number;
      lastReceivedAt: string | null;
    }
  | { type: 'ping'; at: string }
  | BridgeResultLine
  | { type: 'error'; code: string; message: string; retryAt?: string | null };

export interface BridgeResultLine {
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

/** 연결 거부·시간 초과·스트림 끊김 */
export class BridgeUnreachableError extends Error {
  constructor(
    readonly kind: 'refused' | 'timeout' | 'idle' | 'disconnected' | 'other',
    message: string,
  ) {
    super(message);
    this.name = 'BridgeUnreachableError';
  }
}

/** 브리지가 HTTP 오류로 응답 (스트림 시작 전) */
export class BridgeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeHttpError';
  }
}

export type FetchFn = typeof fetch;

export interface BridgeClientOptions {
  baseUrl: string;
  token?: string;
  fetchFn?: FetchFn;
}

function describeFetchError(err: unknown): BridgeUnreachableError {
  if (err instanceof BridgeUnreachableError) return err;
  const e = err as {
    name?: string;
    message?: string;
    cause?: { code?: string };
  };
  const code = e?.cause?.code;
  if (code === 'ECONNREFUSED')
    return new BridgeUnreachableError('refused', '연결 거부');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new BridgeUnreachableError('refused', '호스트를 찾을 수 없음');
  }
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return new BridgeUnreachableError('timeout', '시간 초과');
  }
  return new BridgeUnreachableError('other', code ?? e?.message ?? '연결 실패');
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export class BridgeClient {
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: BridgeClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  get baseUrl(): string {
    return this.opts.baseUrl.replace(/\/+$/, '');
  }

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.opts.token) h['x-bridge-token'] = this.opts.token;
    if (json) h['content-type'] = 'application/json';
    return h;
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<{ status: number; body: unknown }> {
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, { ...init, signal });
    } catch (err) {
      throw describeFetchError(err);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  private static httpError(status: number, body: unknown): BridgeHttpError {
    const code =
      isObj(body) && typeof body.code === 'string' ? body.code : undefined;
    const message =
      isObj(body) && typeof body.message === 'string'
        ? body.message
        : `HTTP ${status}`;
    return new BridgeHttpError(status, code, message);
  }

  async health(timeoutMs = 3_000): Promise<BridgeHealth> {
    const { status, body } = await this.request(
      '/health',
      { method: 'GET', headers: this.headers() },
      timeoutMs,
    );
    if (status !== 200 || !isObj(body))
      throw BridgeClient.httpError(status, body);
    const auth = isObj(body.auth) ? body.auth : {};
    const usage = isObj(body.usageLimit) ? body.usageLimit : {};
    const authState =
      auth.state === 'ok' || auth.state === 'login_required'
        ? auth.state
        : 'unknown';
    return {
      status: typeof body.status === 'string' ? body.status : 'ok',
      sdkVersion: typeof body.sdkVersion === 'string' ? body.sdkVersion : null,
      claudeCodeAvailable: body.claudeCodeAvailable !== false,
      claudeCodeVersion:
        typeof body.claudeCodeVersion === 'string'
          ? body.claudeCodeVersion
          : null,
      auth: {
        state: authState,
        checkedAt: typeof auth.checkedAt === 'string' ? auth.checkedAt : null,
        source: typeof auth.source === 'string' ? auth.source : null,
      },
      usageLimit: {
        limited: usage.limited === true,
        retryAt: typeof usage.retryAt === 'string' ? usage.retryAt : null,
      },
      busy: body.busy === true,
      activeRunId:
        typeof body.activeRunId === 'string' ? body.activeRunId : null,
      promptVersion:
        typeof body.promptVersion === 'string' ? body.promptVersion : null,
    };
  }

  async authCheck(timeoutMs = 65_000): Promise<BridgeAuthCheck> {
    const { status, body } = await this.request(
      '/v1/auth-check',
      { method: 'POST', headers: this.headers() },
      timeoutMs,
    );
    if (status !== 200 || !isObj(body))
      throw BridgeClient.httpError(status, body);
    const auth = isObj(body.auth) ? body.auth : {};
    const usage = isObj(body.usageLimit) ? body.usageLimit : {};
    return {
      auth: {
        state:
          auth.state === 'ok' || auth.state === 'login_required'
            ? auth.state
            : 'unknown',
        checkedAt: typeof auth.checkedAt === 'string' ? auth.checkedAt : null,
      },
      usageLimit: {
        limited: usage.limited === true,
        retryAt: typeof usage.retryAt === 'string' ? usage.retryAt : null,
      },
      model: typeof body.model === 'string' ? body.model : null,
      durationMs: typeof body.durationMs === 'number' ? body.durationMs : 0,
      costUsd: typeof body.costUsd === 'number' ? body.costUsd : null,
    };
  }

  async cancel(runId: string, timeoutMs = 3_000): Promise<boolean> {
    try {
      const { status } = await this.request(
        `/v1/runs/${encodeURIComponent(runId)}/cancel`,
        { method: 'POST', headers: this.headers() },
        timeoutMs,
      );
      return status === 202;
    } catch {
      return false;
    }
  }

  /**
   * POST /v1/advise, NDJSON 줄마다 onLine. 마지막 줄(result/error)을 받거나 스트림이 끝나면 resolve.
   * - connectTimeoutMs: 응답 헤더까지 (연결 수립)
   * - idleTimeoutMs: 어떤 줄도 없이 지난 시간 (ping 포함) → BridgeUnreachableError('idle')
   * - signal: 취소·api 시간 제한
   */
  async advise(
    body: unknown,
    opts: {
      signal: AbortSignal;
      onLine: (line: BridgeLine) => void;
      connectTimeoutMs?: number;
      idleTimeoutMs?: number;
    },
  ): Promise<void> {
    const ac = new AbortController();
    let abortKind: 'connect' | 'idle' | 'external' | null = null;
    const onExternal = () => {
      abortKind ??= 'external';
      ac.abort();
    };
    if (opts.signal.aborted) onExternal();
    else opts.signal.addEventListener('abort', onExternal, { once: true });
    const connectTimer = setTimeout(() => {
      abortKind ??= 'connect';
      ac.abort();
    }, opts.connectTimeoutMs ?? 3_000);
    const idleMs = opts.idleTimeoutMs ?? 60_000;
    let idleTimer: NodeJS.Timeout | undefined;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        abortKind ??= 'idle';
        ac.abort();
      }, idleMs);
    };

    try {
      let res: Response;
      try {
        res = await this.fetchFn(`${this.baseUrl}/v1/advise`, {
          method: 'POST',
          headers: { ...this.headers(true), accept: 'application/x-ndjson' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch (err) {
        if (abortKind === 'connect')
          throw new BridgeUnreachableError('timeout', '연결 시간 초과');
        if (abortKind === 'external') throw err;
        throw describeFetchError(err);
      } finally {
        clearTimeout(connectTimer);
      }
      if (res.status !== 200 || !res.body) {
        let errBody: unknown = null;
        try {
          errBody = await res.json();
        } catch {
          errBody = null;
        }
        throw BridgeClient.httpError(res.status, errBody);
      }

      armIdle();
      const reader = res.body.getReader();
      // 중단(무응답·취소) 시 대기 중인 read()를 풀어 준다 (fetch 구현과 무관하게)
      const onAbort = () => void reader.cancel().catch(() => undefined);
      if (ac.signal.aborted) onAbort();
      else ac.signal.addEventListener('abort', onAbort, { once: true });
      const decoder = new TextDecoder();
      let buf = '';
      let ended = false;
      try {
        while (!ended) {
          const { value, done } = await reader.read();
          if (done) break;
          armIdle();
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf('\n')) !== -1) {
            const lineText = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!lineText) continue;
            let parsed: unknown;
            try {
              parsed = JSON.parse(lineText);
            } catch {
              continue;
            }
            if (!isObj(parsed) || typeof parsed.type !== 'string') continue;
            const line = parsed as BridgeLine;
            opts.onLine(line);
            if (line.type === 'result' || line.type === 'error') ended = true;
          }
        }
      } catch (err) {
        if (abortKind === 'idle') {
          throw new BridgeUnreachableError(
            'idle',
            '브리지 응답이 60초 동안 없음',
          );
        }
        if (abortKind === 'external') throw err;
        throw new BridgeUnreachableError(
          'disconnected',
          '스트림 도중 연결 끊김',
        );
      } finally {
        if (ended) await reader.cancel().catch(() => undefined);
      }
      if (!ended) {
        if (abortKind === 'external') {
          throw new BridgeUnreachableError('other', '요청이 중단됨');
        }
        if (abortKind === 'idle')
          throw new BridgeUnreachableError(
            'idle',
            '브리지 응답이 60초 동안 없음',
          );
        throw new BridgeUnreachableError(
          'disconnected',
          '결과 없이 스트림이 끝남',
        );
      }
    } finally {
      clearTimeout(connectTimer);
      if (idleTimer) clearTimeout(idleTimer);
      opts.signal.removeEventListener('abort', onExternal);
    }
  }
}
