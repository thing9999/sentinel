/**
 * AC-LOG15 실클러스터 경로: 쿠버네티스 `pods/log` 응답 → `LOG_PREVIOUS_NOT_AVAILABLE` (direct-source.ts `mapError`).
 *
 * **실제 `@kubernetes/client-node`의 `Log`를 그대로** 쓰고, API 서버만 로컬 HTTP 서버로 대신한다
 * (`extract-raw.spec.ts`와 같은 방식). 라이브러리가 오류를 어떤 모양으로 던지는지까지 확인하려는 것이다 —
 * client-node 2.0은 **500일 때만** 응답 본문(Status)을 읽고, 400 등은 본문 없이 코드만 준다.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { KubeConfig } from '@kubernetes/client-node';
import { DirectLogError, DirectLogSource, mapError } from './direct-source';

interface Reply {
  status: number;
  body: string;
}

describe('DirectLogSource — 쿠버네티스 오류 → 안내 코드 (AC-LOG15)', () => {
  let server: Server;
  let reply: Reply = { status: 200, body: '' };
  let lastQuery: URLSearchParams | null = null;
  let source: DirectLogSource;

  const status = (code: number, message: string): Reply => ({
    status: code,
    body: JSON.stringify({
      kind: 'Status',
      apiVersion: 'v1',
      status: 'Failure',
      message,
      reason: code === 400 ? 'BadRequest' : 'InternalError',
      code,
    }),
  });

  beforeAll(async () => {
    server = createServer((req, res) => {
      lastQuery = new URL(req.url ?? '/', 'http://x').searchParams;
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(reply.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as AddressInfo;
    const kc = new KubeConfig();
    kc.loadFromOptions({
      clusters: [
        { name: 'c', server: `http://127.0.0.1:${port}`, skipTLSVerify: true },
      ],
      users: [{ name: 'u', token: 'test-token' }],
      contexts: [{ name: 'ctx', cluster: 'c', user: 'u' }],
      currentContext: 'ctx',
    });
    source = new DirectLogSource({ kc } as never);
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const fetchWith = (previous: boolean) =>
    source.fetch({
      namespace: 'prod',
      pod: 'api-1',
      container: 'api',
      previous,
      tailLines: 10,
      sinceSeconds: null,
      maxBytes: 1024 * 1024,
      timeoutMs: 2000,
    });

  const codeOf = async (p: Promise<unknown>): Promise<DirectLogError> => {
    try {
      await p;
    } catch (err) {
      expect(err).toBeInstanceOf(DirectLogError);
      return err as DirectLogError;
    }
    throw new Error('오류가 나야 한다');
  };

  it('previous 요청에 400이 오면 LOG_PREVIOUS_NOT_AVAILABLE', async () => {
    reply = status(
      400,
      'previous terminated container "api" in pod "api-1" not found',
    );
    const err = await codeOf(fetchWith(true));
    expect(err.code).toBe('LOG_PREVIOUS_NOT_AVAILABLE');
    // 실제로 previous=true로 요청했다
    expect(lastQuery?.get('previous')).toBe('true');
  });

  it('"previous terminated container … not found" 메시지면 LOG_PREVIOUS_NOT_AVAILABLE (본문이 읽히는 500 경로)', async () => {
    reply = status(
      500,
      'previous terminated container "api" in pod "api-1" not found',
    );
    const err = await codeOf(fetchWith(false));
    expect(err.code).toBe('LOG_PREVIOUS_NOT_AVAILABLE');
  });

  it('previous가 아닌 요청의 400은 LOG_PREVIOUS_NOT_AVAILABLE이 되지 않는다', async () => {
    reply = status(
      400,
      'container "api" in pod "api-1" is waiting to start: ContainerCreating',
    );
    const err = await codeOf(fetchWith(false));
    expect(err.code).not.toBe('LOG_PREVIOUS_NOT_AVAILABLE');
    // client-node 2.0은 400 본문을 넘기지 않아 메시지로는 가를 수 없다 → 상태 코드를 details로 남긴다
    // (호출부가 informer 캐시로 "시작 전"을 판단한다 — logs.service.live.spec.ts)
    expect(err.code).toBe('LOG_UPSTREAM_ERROR');
    expect(err.details).toEqual({ status: 400 });
  });

  it('mapError: 메시지 규칙은 previous 여부와 무관하게 먼저 본다', () => {
    const e = mapError(
      {
        code: 400,
        body: {
          message: 'previous terminated container "api" in pod "p" not found',
        },
      },
      false,
    );
    expect(e.code).toBe('LOG_PREVIOUS_NOT_AVAILABLE');
    // 403·404는 previous여도 권한·파드 없음이 먼저다
    expect(mapError({ code: 404 }, true).code).toBe('LOG_POD_NOT_FOUND');
    expect(mapError({ code: 403 }, true).code).toBe('LOG_FORBIDDEN');
  });
});
