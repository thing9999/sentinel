/**
 * live 조회(`POST /api/logs/query`)가 **계약 6절과 같은 모양**을 주는가, 그리고 **mock과 같은 모양**인가.
 * PM 원칙(2026-09-25): mock과 live가 같은 모양을 준다. 계약이 정본이다 — 화면은 mock을 보고 만들었다.
 *
 * - live 쪽은 실제 `LogsService`에 쿠버네티스 호출(`DirectLogSource.fetch`)·로그 스택 어댑터만 대역으로 넣는다.
 *   로그 스택은 **실제 `LokiAdapter`**를 로컬 HTTP 서버(임시 포트)에 붙여 연결 실패·401·400을 재현한다.
 * - mock 쪽은 같은 `LogsService`를 `mock`으로 만들고 **실제 `MockStackAdapter`**·mock 시나리오를 쓴다.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiException } from '../common/api-error';
import { ClusterStore } from '../cluster/state/cluster-store';
import type { RawPod } from '../cluster/model';
import type { LogBackendPort } from './backend/log-backend.port';
import { LokiAdapter } from './backend/loki.adapter';
import { MockStackAdapter } from './backend/mock-stack.adapter';
import { DirectLogError, mapError } from './direct-source';
import { LogsService } from './logs.service';
import type { LogScenario } from './mock/mock-logs';

type Body = Record<string, unknown>;
interface Notice {
  code: string;
  level: string;
  text: string;
  details?: Record<string, unknown>;
}

function rawPod(opts: {
  restartCount: number;
  state: { type: 'running' | 'waiting'; reason: string | null };
}): RawPod {
  return {
    namespace: 'prod',
    name: 'api-1',
    uid: 'u1',
    phase: opts.state.type === 'running' ? 'Running' : 'Pending',
    nodeName: 'node-a',
    labels: {},
    owner: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    startTime: '2026-09-25T00:00:00.000Z',
    deletionAt: null,
    qosClass: 'Burstable',
    pvcClaims: [],
    containers: [
      {
        name: 'api',
        init: false,
        image: 'api:1',
        requests: { cpuMillicores: null, memoryBytes: null },
        limits: { cpuMillicores: null, memoryBytes: null },
        status: {
          ready: opts.state.type === 'running',
          restartCount: opts.restartCount,
          state: { ...opts.state, message: null, since: null },
          lastTermination: null,
        },
      },
    ],
    initContainers: [],
  } as unknown as RawPod;
}

const RUNNING = rawPod({
  restartCount: 0,
  state: { type: 'running', reason: null },
});
const CREATING = rawPod({
  restartCount: 0,
  state: { type: 'waiting', reason: 'ContainerCreating' },
});

function makeService(opts: {
  mode?: 'live' | 'mock';
  pod?: RawPod;
  fetch?: () => Promise<never>;
  port?: LogBackendPort | null;
  scenario?: LogScenario;
}) {
  const store = new ClusterStore();
  store.pods.set('prod/api-1', opts.pod ?? RUNNING);
  const options = {
    enabled: true,
    denyNamespaces: [],
    denied: () => false,
    extraPatterns: [],
    dataSource: opts.mode ?? 'live',
    limits: {
      defaultLines: 500,
      maxLines: 5000,
      lineOptions: [200, 500, 2000, 5000],
      maxBytes: 5 * 1024 * 1024,
      maxLineBytes: 8192,
      maxStreams: 3,
      maxLinesPerSec: 2000,
      idlePauseSec: 300,
      maxStreamMin: 30,
    },
  };
  const direct = {
    available: true,
    fetch: jest.fn(opts.fetch ?? (() => Promise.reject(new Error('unused')))),
  };
  const port = opts.port ?? null;
  const backend = {
    bindScenario: () => undefined,
    get configured() {
      return port !== null;
    },
    get port() {
      return port;
    },
    currentState: () => (port ? 'ok' : 'not_configured'),
    retentionHours: null,
    maxRangeHours: 168,
    productLabel: port ? 'Loki' : null,
    reportFailure: jest.fn(),
    reportSuccess: jest.fn(),
  };
  const policy = { enabled: true, setMockDisabled: () => undefined };
  const svc = new LogsService(
    opts.mode ?? 'live',
    options as never,
    store,
    direct as never,
    backend as never,
    policy as never,
  );
  if (opts.scenario) svc.setScenario(opts.scenario);
  return { svc, direct, backend };
}

const directQuery = (previous: boolean) => ({
  selector: { namespace: 'prod', pod: 'api-1', container: 'api', previous },
});
const FROM = '2026-09-25T13:00:00.000Z';
const TO = '2026-09-25T14:00:00.000Z';
const stackQuery = {
  source: 'stack' as const,
  selector: { namespace: 'prod', pod: 'api-1' },
  range: { from: FROM, to: TO },
};

const noticesOf = (b: Body) => b.notices as Notice[];
const notice = (b: Body, code: string) =>
  noticesOf(b).find((n) => n.code === code);

/** 화면이 보는 모양: 줄 수·출처·안내(코드·등급·문구·details 키) */
const shape = (b: Body) => ({
  lines: (b.lines as unknown[]).length,
  source: (b.source as { id: string }).id,
  notices: noticesOf(b)
    .map((n) => ({
      code: n.code,
      level: n.level,
      text: n.text,
      detailKeys: Object.keys(n.details ?? {}).sort(),
    }))
    .sort((a, c) => a.code.localeCompare(c.code)),
});

describe('logs query (live) — 쿠버네티스 오류는 계약 6절대로 안내다 (AC-LOG15)', () => {
  it('이전 세대 없음 → 200 + LOG_PREVIOUS_NOT_AVAILABLE, LOG_EMPTY를 덧붙이지 않는다', async () => {
    const { svc, direct } = makeService({
      fetch: () =>
        Promise.reject(
          new DirectLogError(
            'LOG_PREVIOUS_NOT_AVAILABLE',
            '이전 세대 로그가 없습니다.',
          ),
        ),
    });
    const b = await svc.query(directQuery(true), 0);
    expect(direct.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ previous: true }),
    );
    expect(b.lines).toEqual([]);
    // 서버가 스위치를 되돌리지 않는다
    expect((b.selector as { previous: boolean }).previous).toBe(true);
    expect(notice(b, 'LOG_PREVIOUS_NOT_AVAILABLE')?.level).toBe('info');
    // 줄이 0개인 이유를 안내가 이미 말한다 — "조회 성공, 줄 0개"가 아니다
    expect(notice(b, 'LOG_EMPTY')).toBeUndefined();
  });

  it('previous가 아닌 400 + 캐시상 시작 전 → LOG_CONTAINER_NOT_STARTED (정지 조회 문구 — 약속하지 않고 따라가기를 권한다)', async () => {
    const { svc } = makeService({
      pod: CREATING,
      fetch: () =>
        Promise.reject(
          new DirectLogError(
            'LOG_UPSTREAM_ERROR',
            '로그를 가져오지 못했습니다.',
            { status: 400 },
          ),
        ),
    });
    const b = await svc.query(directQuery(false), 0);
    expect(notice(b, 'LOG_CONTAINER_NOT_STARTED')?.text).toBe(
      '컨테이너가 아직 시작되지 않았습니다. 따라가기를 켜 두면 시작될 때 자동으로 표시됩니다.',
    );
    expect(notice(b, 'LOG_PREVIOUS_NOT_AVAILABLE')).toBeUndefined();
    expect(notice(b, 'LOG_EMPTY')).toBeUndefined();
  });

  it('kubelet에 못 닿음(500 "dial tcp …") → 200 + LOG_KUBELET_UNREACHABLE + details.nodeName', async () => {
    const upstream = mapError(
      {
        code: 500,
        body: {
          message:
            'Get "https://10.0.1.5:10250/containerLogs/prod/api-1/api": dial tcp 10.0.1.5:10250: connect: connection refused',
        },
      },
      false,
    );
    expect(upstream.code).toBe('LOG_KUBELET_UNREACHABLE');
    const { svc } = makeService({ fetch: () => Promise.reject(upstream) });
    const b = await svc.query(directQuery(false), 0);
    expect(b.lines).toEqual([]);
    const n = notice(b, 'LOG_KUBELET_UNREACHABLE');
    expect(n?.level).toBe('warn');
    expect(n?.text).toBe('노드에 연결할 수 없어 로그를 읽지 못했습니다.');
    expect(n?.details?.nodeName).toBe('node-a');
  });

  it.each([
    'net/http: TLS handshake timeout',
    'error dialing backend: dial timeout',
  ])(
    'kubelet 판단 문구 추가(PM 결정): "%s" → LOG_KUBELET_UNREACHABLE',
    (msg) => {
      expect(mapError({ code: 500, body: { message: msg } }, false).code).toBe(
        'LOG_KUBELET_UNREACHABLE',
      );
    },
  );

  it('"context deadline exceeded"는 apiserver 자체 문제일 수 있어 LOG_UPSTREAM_ERROR로 둔다', () => {
    expect(
      mapError(
        { code: 500, body: { message: 'context deadline exceeded' } },
        false,
      ).code,
    ).toBe('LOG_UPSTREAM_ERROR');
  });

  it('클러스터 연결 없음 → 200 + LOG_SOURCE_NOT_CONFIGURED (mock 로그를 대신 보여주지 않는다)', async () => {
    const { svc } = makeService({
      fetch: () =>
        Promise.reject(
          new DirectLogError(
            'LOG_SOURCE_NOT_CONFIGURED',
            '클러스터 연결이 없습니다.',
          ),
        ),
    });
    const b = await svc.query(directQuery(false), 0);
    expect(b.lines).toEqual([]);
    expect(notice(b, 'LOG_SOURCE_NOT_CONFIGURED')?.level).toBe('warn');
    expect(notice(b, 'LOG_EMPTY')).toBeUndefined();
  });

  it('분류되지 않은 출처 오류(LOG_UPSTREAM_ERROR)는 오류(503 + details.status)로 남는다 — 계약 6절에 행이 있다', async () => {
    const { svc } = makeService({
      pod: rawPod({
        restartCount: 2,
        state: { type: 'running', reason: null },
      }),
      fetch: () =>
        Promise.reject(
          new DirectLogError(
            'LOG_UPSTREAM_ERROR',
            '로그를 가져오지 못했습니다.',
            { status: 400 },
          ),
        ),
    });
    const err = await svc.query(directQuery(false), 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiException);
    expect((err as ApiException).getStatus()).toBe(503);
    expect((err as ApiException).code).toBe('LOG_UPSTREAM_ERROR');
    expect((err as ApiException).details).toEqual({ status: 400 });
  });
});

describe('logs query (live Loki 어댑터) — 로그 스택 실패도 200 + notice, 자동 전환 없음', () => {
  let server: Server;
  let reply = { status: 200, body: '' };
  let port = 0;
  let closedPort = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(reply.status, { 'Content-Type': 'text/plain' });
      res.end(reply.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
    // 닫힌 포트(연결 거부)를 얻는다: 잠깐 열었다 닫는다
    const tmp = createServer();
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', () => r()));
    closedPort = (tmp.address() as AddressInfo).port;
    await new Promise<void>((r) => tmp.close(() => r()));
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const loki = (url: string) =>
    new LokiAdapter({
      url,
      tenant: null,
      token: 'SUPERSECRET-TOKEN',
      basicAuth: null,
      timeoutSec: 2,
      maxRangeHours: 168,
      retentionHours: null,
      labels: {
        namespace: 'namespace',
        pod: 'pod',
        container: 'container',
        node: 'node_name',
        stream: 'stream',
      },
    });
  const live = () => makeService({ port: loki(`http://127.0.0.1:${port}`) });
  const mock = (scenario: LogScenario) =>
    makeService({
      mode: 'mock',
      scenario,
      port: new MockStackAdapter(
        () => scenario,
        () => scenario === 'stack-down',
      ),
    });

  it('연결 실패 → LOG_BACKEND_UNAVAILABLE (fallbackSource: direct), source는 stack 그대로 · mock stack-down과 같은 모양', async () => {
    const l = makeService({ port: loki(`http://127.0.0.1:${closedPort}`) });
    const lb = await l.svc.query(stackQuery, 0);
    expect(notice(lb, 'LOG_BACKEND_UNAVAILABLE')?.details).toEqual({
      fallbackSource: 'direct',
    });
    // **자동으로 직접 조회로 내려가지 않는다** (AC-LOG42)
    expect((lb.source as { id: string }).id).toBe('stack');
    expect(l.direct.fetch).not.toHaveBeenCalled();
    expect(l.backend.reportFailure).toHaveBeenCalled();
    expect(notice(lb, 'LOG_EMPTY')).toBeUndefined();

    const mb = await mock('stack-down').svc.query(stackQuery, 0);
    expect(shape(lb)).toEqual(shape(mb));
  });

  it('인증 실패(401) → LOG_BACKEND_AUTH_FAILED, 토큰이 응답에 없다 · mock stack-auth-failed와 같은 모양', async () => {
    reply = { status: 401, body: 'unauthorized: token SUPERSECRET-TOKEN' };
    const l = live();
    const lb = await l.svc.query(stackQuery, 0);
    expect(notice(lb, 'LOG_BACKEND_AUTH_FAILED')?.details).toEqual({
      fallbackSource: 'direct',
    });
    expect(JSON.stringify(lb)).not.toContain('SUPERSECRET');
    const mb = await mock('stack-auth-failed').svc.query(stackQuery, 0);
    expect(shape(lb)).toEqual(shape(mb));
  });

  it('쿼리 거부(400) → LOG_BACKEND_QUERY_REJECTED + details.reason(가림 처리), 기간을 줄이지 않는다 · mock stack-rejected와 같은 모양', async () => {
    reply = {
      status: 400,
      body: 'max entries limit per query exceeded, limit > max_entries_limit (5000 > 1000) password=hunter2hunter2',
    };
    const lb = await live().svc.query(stackQuery, 0);
    const n = notice(lb, 'LOG_BACKEND_QUERY_REJECTED');
    expect(n?.level).toBe('warn');
    expect(String(n?.details?.reason)).toContain('max entries limit');
    expect(String(n?.details?.reason)).not.toContain('hunter2hunter2');
    // 요청한 기간 그대로 (AC-LOG43)
    expect(lb.range).toMatchObject({ from: FROM, to: TO });
    const mb = await mock('stack-rejected').svc.query(stackQuery, 0);
    expect(shape(lb)).toEqual(shape(mb));
  });
});

describe('logs query — mock과 live가 같은 모양 (쿠버네티스 코드별)', () => {
  it('LOG_PREVIOUS_NOT_AVAILABLE: mock(empty + previous) = live', async () => {
    const m = await makeService({ mode: 'mock', scenario: 'empty' }).svc.query(
      directQuery(true),
      0,
    );
    const l = await makeService({
      fetch: () =>
        Promise.reject(
          new DirectLogError(
            'LOG_PREVIOUS_NOT_AVAILABLE',
            '이전 세대 로그가 없습니다.',
          ),
        ),
    }).svc.query(directQuery(true), 0);
    expect(shape(m)).toEqual(shape(l));
  });

  it('LOG_CONTAINER_NOT_STARTED: mock(container-starting) = live(400 + 캐시 시작 전)', async () => {
    const m = await makeService({
      mode: 'mock',
      scenario: 'container-starting',
    }).svc.query(directQuery(false), 0);
    const l = await makeService({
      pod: CREATING,
      fetch: () =>
        Promise.reject(
          new DirectLogError(
            'LOG_UPSTREAM_ERROR',
            '로그를 가져오지 못했습니다.',
            { status: 400 },
          ),
        ),
    }).svc.query(directQuery(false), 0);
    expect(shape(m)).toEqual(shape(l));
    expect(shape(m).notices.map((n) => n.code)).toEqual([
      'LOG_CONTAINER_NOT_STARTED',
    ]);
  });

  it('LOG_KUBELET_UNREACHABLE: mock(kubelet-unreachable) = live(500 dial tcp)', async () => {
    const m = await makeService({
      mode: 'mock',
      scenario: 'kubelet-unreachable',
    }).svc.query(directQuery(false), 0);
    const l = await makeService({
      fetch: () =>
        Promise.reject(
          mapError(
            {
              code: 500,
              body: { message: 'dial tcp 10.0.1.5:10250: i/o timeout' },
            },
            false,
          ),
        ),
    }).svc.query(directQuery(false), 0);
    expect(shape(m)).toEqual(shape(l));
    expect(notice(m, 'LOG_KUBELET_UNREACHABLE')?.details).toEqual(
      notice(l, 'LOG_KUBELET_UNREACHABLE')?.details,
    );
  });
});
