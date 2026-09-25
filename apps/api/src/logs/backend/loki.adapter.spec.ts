/**
 * Loki 어댑터 테스트 (AC-LOG43·44·46·47).
 *
 * 가장 중요한 것: **LogQL이 어댑터 밖으로 나가지 않는다.** 여기서는 어댑터가 실제로
 * 보내는 요청을 가로채 확인하고, 밖으로 나가는 값(`LogBackendEntry`)에는
 * 라벨 이름도 쿼리 문자열도 없다는 것을 검사한다.
 */
import { LokiAdapter, type LokiConfig } from './loki.adapter';
import { LogBackendError } from './log-backend.port';

const BASE: LokiConfig = {
  url: 'http://loki.monitoring.svc:3100',
  tenant: null,
  token: null,
  basicAuth: null,
  timeoutSec: 5,
  maxRangeHours: 168,
  retentionHours: 168,
  labels: {
    namespace: 'namespace',
    pod: 'pod',
    container: 'container',
    node: 'node_name',
    stream: 'stream',
  },
};

function lokiBody(values: [string, string][]): unknown {
  return {
    data: {
      result: [
        {
          stream: { pod: 'api-1', container: 'api', stream: 'stderr' },
          values,
        },
      ],
    },
  };
}

function mockFetch(
  impl: (url: string) => { status: number; body?: unknown; text?: string },
): jest.SpyInstance {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      const r = impl(url);
      return Promise.resolve({
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        headers: new Headers(),
        json: () => Promise.resolve(r.body ?? {}),
        text: () => Promise.resolve(r.text ?? ''),
      } as Response);
    });
}

afterEach(() => jest.restoreAllMocks());

describe('LogQL은 어댑터 안에만 있다 (AC-LOG47)', () => {
  it('셀렉터·검색어가 쿼리로 바뀌고, 결과에는 쿼리가 없다', async () => {
    let seen = '';
    const spy = mockFetch((url) => {
      seen = url;
      return {
        status: 200,
        body: lokiBody([['1758800000000000000', 'hello world']]),
      };
    });
    const a = new LokiAdapter(BASE);
    const entries = await a.query({
      selector: {
        namespace: 'prod',
        pods: ['api-1', 'api-2'],
        containers: ['api'],
        workload: null,
      },
      from: new Date('2026-09-25T13:00:00Z'),
      to: new Date('2026-09-25T14:00:00Z'),
      limit: 100,
      search: { text: 'timeout', caseSensitive: false },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const q = decodeURIComponent(new URL(seen).searchParams.get('query') ?? '');
    expect(q).toContain('namespace="prod"');
    expect(q).toContain('pod=~"api-1|api-2"');
    expect(q).toContain('container="api"');
    expect(q).toContain('timeout');
    // 밖으로 나가는 값에는 쿼리도 라벨 이름도 없다
    expect(JSON.stringify(entries)).not.toContain('namespace=');
    expect(JSON.stringify(entries)).not.toContain('|~');
    expect(entries[0]).toMatchObject({
      line: 'hello world',
      pod: 'api-1',
      container: 'api',
      stream: 'stderr',
    });
  });

  it('라벨 이름을 바꾸면 그 이름으로 조회한다 (AC-LOG46)', async () => {
    let seen = '';
    mockFetch((url) => {
      seen = url;
      return { status: 200, body: { data: { result: [] } } };
    });
    const a = new LokiAdapter({
      ...BASE,
      labels: { ...BASE.labels, namespace: 'k8s_ns', pod: 'k8s_pod' },
    });
    await a.query({
      selector: {
        namespace: 'prod',
        pods: ['api-1'],
        containers: [],
        workload: null,
      },
      from: new Date(),
      to: new Date(),
      limit: 10,
      search: null,
    });
    const q = decodeURIComponent(new URL(seen).searchParams.get('query') ?? '');
    expect(q).toContain('k8s_ns="prod"');
    expect(q).toContain('k8s_pod="api-1"');
    expect(q).not.toContain('namespace=');
  });

  it('셀렉터에 정규식 문자를 넣어 쿼리를 바꿀 수 없다', async () => {
    let seen = '';
    mockFetch((url) => {
      seen = url;
      return { status: 200, body: { data: { result: [] } } };
    });
    const a = new LokiAdapter(BASE);
    await a.query({
      selector: {
        namespace: 'prod"} |= "secret',
        pods: [],
        containers: [],
        workload: null,
      },
      from: new Date(),
      to: new Date(),
      limit: 10,
      search: null,
    });
    const q = decodeURIComponent(new URL(seen).searchParams.get('query') ?? '');
    // 위험한 문자가 지워져 **셀렉터를 빠져나가지 못한다** (DTO도 이미 막지만 여기서 한 번 더)
    expect(q).not.toContain('|=');
    expect(q.match(/"/g)?.length).toBe(2);
    expect(q.startsWith('{namespace="')).toBe(true);
    expect(q.endsWith('"}')).toBe(true);
  });
});

describe('오류 처리', () => {
  it('인증 실패 메시지에 **토큰이 들어가지 않는다** (AC-LOG44)', async () => {
    mockFetch(() => ({ status: 401, text: 'unauthorized token=SUPERSECRET' }));
    const a = new LokiAdapter({ ...BASE, token: 'SUPERSECRET' });
    await expect(
      a.query({
        selector: {
          namespace: 'prod',
          pods: ['a'],
          containers: [],
          workload: null,
        },
        from: new Date(),
        to: new Date(),
        limit: 1,
        search: null,
      }),
    ).rejects.toMatchObject({ code: 'LOG_BACKEND_AUTH_FAILED' });

    try {
      await a.ping();
    } catch (err) {
      const e = err as LogBackendError;
      expect(e.message).not.toContain('SUPERSECRET');
      expect(e.detail ?? '').not.toContain('SUPERSECRET');
    }
  });

  it('쿼리 거부는 스택이 준 사유를 **가림 처리해 그대로** 올린다 (AC-LOG43)', async () => {
    mockFetch(() => ({
      status: 400,
      text: 'max entries limit exceeded: 5000 > 1000',
    }));
    const a = new LokiAdapter(BASE);
    await expect(
      a.query({
        selector: {
          namespace: 'prod',
          pods: ['a'],
          containers: [],
          workload: null,
        },
        from: new Date(),
        to: new Date(),
        limit: 5000,
        search: null,
      }),
    ).rejects.toMatchObject({ code: 'LOG_BACKEND_QUERY_REJECTED' });
    try {
      await a.query({
        selector: {
          namespace: 'prod',
          pods: ['a'],
          containers: [],
          workload: null,
        },
        from: new Date(),
        to: new Date(),
        limit: 5000,
        search: null,
      });
    } catch (err) {
      // 서버가 조용히 기간·줄 수를 줄이지 않고 **사유를 그대로** 올린다
      expect((err as LogBackendError).detail).toContain(
        'max entries limit exceeded',
      );
    }
  });

  it('거부 사유에 섞인 비밀값은 가려진다', async () => {
    mockFetch(() => ({
      status: 400,
      text: 'bad request from postgres://user:hunter2hunter2@db:5432/app',
    }));
    const a = new LokiAdapter(BASE);
    try {
      await a.query({
        selector: {
          namespace: 'prod',
          pods: ['a'],
          containers: [],
          workload: null,
        },
        from: new Date(),
        to: new Date(),
        limit: 1,
        search: null,
      });
    } catch (err) {
      expect((err as LogBackendError).detail).not.toContain('hunter2hunter2');
    }
  });

  it('연결 실패는 주소를 메시지에 넣지 않는다', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:3100'));
    const a = new LokiAdapter(BASE);
    await expect(a.ping()).rejects.toMatchObject({
      code: 'LOG_BACKEND_UNAVAILABLE',
    });
    try {
      await a.ping();
    } catch (err) {
      expect((err as Error).message).not.toContain('10.0.0.5');
      expect((err as Error).message).not.toContain('loki.monitoring.svc');
    }
  });
});
