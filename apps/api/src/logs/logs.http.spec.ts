/* eslint-disable @typescript-eslint/no-unsafe-member-access -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-return -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-call -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- 응답 JSON 검사 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ApiExceptionFilter,
  validationExceptionFactory,
} from '../common/api-error';
import { CommonModule } from '../common/common.module';
import { validateEnv } from '../config/env.validation';
import { PrismaModule } from '../database/prisma.module';
import { ClusterModule } from '../cluster/cluster.module';
import { LogLinkService } from './log-link.service';
import { LogStreamService } from './log-stream.service';
import { LogsModule } from './logs.module';
import { LogsService } from './logs.service';

/**
 * logs 5b 후속 (2026-09-25): 그 시각으로 열기(`anchorAt`), 워크로드 합쳐보기, 대상 화면 보강,
 * 스트림 상한 문구, **전용 스트림 이벤트 mock 시나리오**(수십 초 안에 notice·paused·closing).
 */
type Row = Record<string, any>;

describe('logs (mock) — 5b 후속', () => {
  let app: INestApplication<App>;
  let logs: LogsService;
  let pod: Row; // 살아 있는 Deployment 파드 하나
  let deployment: Row;

  beforeAll(async () => {
    process.env.DATA_SOURCE = 'mock';
    process.env.DATABASE_URL = '';
    process.env.LOGS_ENABLED = 'true';
    delete process.env.LOG_DENY_NAMESPACES;
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnv,
        }),
        CommonModule,
        PrismaModule,
        ClusterModule,
        LogsModule,
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    logs = app.get(LogsService);

    const pods = (
      await request(app.getHttpServer()).get('/api/cluster/pods').expect(200)
    ).body.items as Row[];
    pod = pods.find(
      (p) => p.owner?.kind === 'Deployment' && p.owner.workloadKey,
    )!;
    const wls = (
      await request(app.getHttpServer())
        .get('/api/cluster/workloads')
        .expect(200)
    ).body.items as Row[];
    deployment = wls.find((w) => w.key === pod.owner.workloadKey)!;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    logs.setScenario('direct');
  });

  const query = (body: object) =>
    request(app.getHttpServer()).post('/api/logs/query').send(body);

  // --- 2.2.1 anchorAt -------------------------------------------------------

  it('anchorAt: 가져온 범위 안의 시각이면 anchor.state=found + 그 시각 이후 첫 줄', async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    const b = (
      await query({
        selector: { namespace: pod.namespace, pod: pod.name },
        anchorAt: at,
      }).expect(200)
    ).body;
    expect(b.anchor.state).toBe('found');
    const line = (b.lines as Row[]).find((l) => l.id === b.anchor.lineId)!;
    expect(Date.parse(line.at)).toBeGreaterThanOrEqual(Date.parse(at));
    // 서버가 그 시각을 덮는 기간을 골랐다 (direct: 그 시각 2분 앞부터)
    expect(Date.parse(b.range.from)).toBeLessThanOrEqual(
      Date.parse(at) - 119_000,
    );
    expect(
      (b.notices as Row[]).some((n) => String(n.code).startsWith('LOG_ANCHOR')),
    ).toBe(false);
  });

  it('anchorAt: 가져온 줄보다 앞이면 before_result + 이유 한 줄(줄 수를 늘리라)', async () => {
    const at = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const b = (
      await query({
        selector: { namespace: pod.namespace, pod: pod.name },
        anchorAt: at,
        limit: 200,
      }).expect(200)
    ).body;
    expect(b.anchor.state).toBe('before_result');
    expect(b.anchor.lineId).toBe(b.lines[0].id);
    const n = (b.notices as Row[]).find(
      (x) => x.code === 'LOG_ANCHOR_BEFORE_RESULT',
    )!;
    expect(n.text).toContain('200줄');
    expect(n.details.suggest).toBe('more_lines');
  });

  it('anchorAt 없으면 anchor는 null (기존 응답 모양 그대로)', async () => {
    const b = (
      await query({
        selector: { namespace: pod.namespace, pod: pod.name },
      }).expect(200)
    ).body;
    expect(b.anchor).toBeNull();
  });

  it('스트림에 anchorAt을 보내면 400 (따라가기와 함께 쓰지 않는다)', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/logs/streams')
      .send({
        selector: { namespace: pod.namespace, pod: pod.name },
        anchorAt: new Date().toISOString(),
      })
      .expect(400);
    expect(r.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(r.body.details)).toContain('anchorAt');
  });

  // --- alerts 2.2.1 알림 링크 -------------------------------------------------

  it('알림 링크: follow 없이 at=알림 시각, stackSearch는 스택 상태, logs=disabled면 링크 없음', () => {
    const link = app.get(LogLinkService);
    const ref = { kind: 'Pod', namespace: pod.namespace, name: pod.name };
    const at = '2026-09-25T14:02:05.000Z';
    const r = link.linkFor(ref, at);
    expect(r.href).toBe(
      `/logs?namespace=${pod.namespace}&pod=${pod.name}&at=${encodeURIComponent(at)}`,
    );
    expect(r.href).not.toContain('follow');
    expect(r.target?.stackSearch).toBe(false);

    logs.setScenario('stack');
    expect(link.linkFor(ref, at).target?.stackSearch).toBe(true);
    logs.setScenario('stack-down');
    // 연결 실패 중이면 사라진 파드를 찾을 수 없다 (targets의 stackSearch.available과 같은 판단)
    expect(link.linkFor(ref, at).target?.stackSearch).toBe(false);

    logs.setScenario('disabled');
    expect(link.linkFor(ref, at)).toMatchObject({
      href: null,
      target: { unavailableReason: 'logs_disabled' },
    });
  });

  // --- 1.4 워크로드 합쳐보기 ---------------------------------------------------

  it('stack: selector.workload를 서버가 소속 파드로 푼다 (네임스페이스 전체가 아니다)', async () => {
    logs.setScenario('stack');
    const b = (
      await query({
        source: 'stack',
        selector: {
          namespace: deployment.namespace,
          workload: { kind: deployment.kind, name: deployment.name },
        },
      }).expect(200)
    ).body;
    const resolved = b.selector.resolvedPods as string[];
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved).toContain(pod.name);
    // 줄마다 붙은 파드가 전부 소속 파드다
    for (const l of b.lines as Row[]) expect(resolved).toContain(l.prefix.pod);
  });

  it('스트림 hello.selector.resolvedPods = 조회 응답 selector.resolvedPods (같은 이름·같은 값, 결정 8)', async () => {
    logs.setScenario('stack');
    const q = (
      await query({
        source: 'stack',
        selector: {
          namespace: deployment.namespace,
          workload: { kind: deployment.kind, name: deployment.name },
        },
      }).expect(200)
    ).body;
    const svc = app.get(LogStreamService);
    const hello = async (sel: Row, source: 'stack' | 'direct') => {
      const entry = svc.prepare(source, sel as never, 20);
      const writes: string[] = [];
      const res = {
        status: () => res,
        setHeader: () => undefined,
        flushHeaders: () => undefined,
        socket: { setNoDelay: () => undefined },
        on: () => res,
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
        end: () => undefined,
      } as unknown as Response;
      await svc.attach(entry.id, res);
      svc.closeById(entry.id);
      const first = JSON.parse(writes[0].split('\ndata: ')[1]) as Row;
      expect(first.event).toBe('log.hello');
      return first.payload.selector as Row;
    };
    const h = await hello(
      {
        namespace: deployment.namespace,
        workload: { kind: deployment.kind, name: deployment.name },
      },
      'stack',
    );
    expect(h.resolvedPods).toEqual(q.selector.resolvedPods);
    expect(h.resolvedPods.length).toBeGreaterThan(0);
    // 기존 필드는 그대로 (같은 목록)
    expect(h.pods).toEqual(h.resolvedPods);

    // 워크로드를 풀지 않은 스트림은 조회 응답과 같이 null
    logs.setScenario('direct');
    const d = await hello(
      { namespace: pod.namespace, pod: pod.name },
      'direct',
    );
    expect(d.resolvedPods).toBeNull();
  });

  it('pods가 20개를 넘으면 400', async () => {
    logs.setScenario('stack');
    await query({
      source: 'stack',
      selector: {
        namespace: 'prod',
        pods: Array.from({ length: 21 }, (_, i) => `p-${i}`),
      },
    }).expect(400);
  });

  // --- 2.1.2 targets ------------------------------------------------------

  it('targets: 소속 워크로드 링크는 해석한 워크로드 키로 (ReplicaSet 이름이 아니다)', async () => {
    const b = (
      await request(app.getHttpServer())
        .get(`/api/logs/targets/${pod.namespace}/${pod.name}`)
        .expect(200)
    ).body;
    expect(b.links.workload).toBe(
      `/cluster/workloads?focus=${pod.owner.workloadKey}`,
    );
    expect(b.pod.isControlPlaneComponent).toBe(false);
  });

  it('targets: kube-system 미러 파드만 컨트롤 플레인 안내 + etcd 도움말(details.hint)', async () => {
    const cp = (
      await request(app.getHttpServer())
        .get('/api/cluster/control-plane')
        .expect(200)
    ).body.components.items.find((c: Row) => c.podKey) as Row;
    const [ns, name] = String(cp.podKey).split('/');
    const b = (
      await request(app.getHttpServer())
        .get(`/api/logs/targets/${ns}/${name}`)
        .expect(200)
    ).body;
    expect(b.pod.isControlPlaneComponent).toBe(true);
    const self = (b.notices as Row[]).find(
      (n) => n.code === 'LOG_APISERVER_SELF_DEPENDENCY',
    )!;
    expect(self.details.hint).toContain('etcd');
    // 스택이 없으면 둘째 문장을 붙이지 않는다
    expect(self.text).not.toContain('외부 로그 스택');

    logs.setScenario('stack');
    const withStack = (
      await request(app.getHttpServer())
        .get(`/api/logs/targets/${ns}/${name}`)
        .expect(200)
    ).body;
    expect(
      (withStack.notices as Row[]).find(
        (n) => n.code === 'LOG_APISERVER_SELF_DEPENDENCY',
      )?.text,
    ).toContain('외부 로그 스택이 있으면 그쪽에는 남아 있을 수 있습니다.');
  });

  // --- 스트림 ---------------------------------------------------------------

  it('상한 초과 문구: 펼쳐 둔 파드 상세 로그도 슬롯을 쓴다고 알려 준다 (PM 결정)', async () => {
    const svc = app.get(LogStreamService);
    const ids: string[] = [];
    try {
      for (let i = 0; i < svc.maxStreams; i += 1) {
        const r = await request(app.getHttpServer())
          .post('/api/logs/streams')
          .send({ selector: { namespace: pod.namespace, pod: pod.name } })
          .expect(201);
        ids.push(r.body.streamId);
      }
      const over = await request(app.getHttpServer())
        .post('/api/logs/streams')
        .send({ selector: { namespace: pod.namespace, pod: pod.name } })
        .expect(503);
      expect(over.body.code).toBe('LOG_STREAM_LIMIT_REACHED');
      expect(over.body.message).toBe(
        `로그 보기를 동시에 ${svc.maxStreams}개까지 열 수 있습니다. 다른 탭의 로그 화면이나 펼쳐 둔 파드 상세 로그를 닫아 주세요.`,
      );
    } finally {
      for (const id of ids) svc.closeById(id);
    }
  });

  describe('mock 스트림 시나리오 (가짜 시계)', () => {
    const open = async (scenario: string) => {
      logs.setScenario(scenario);
      const svc = app.get(LogStreamService);
      const entry = svc.prepare(
        'direct',
        { namespace: pod.namespace, pod: pod.name },
        20,
      );
      const writes: string[] = [];
      const res = {
        status: () => res,
        setHeader: () => undefined,
        flushHeaders: () => undefined,
        socket: { setNoDelay: () => undefined },
        on: () => res,
        write: (chunk: string) => {
          writes.push(chunk);
          return true;
        },
        end: () => undefined,
      } as unknown as Response;
      await svc.attach(entry.id, res);
      const events = () =>
        writes.map((w) => {
          const data = w.split('\ndata: ')[1];
          return JSON.parse(data) as {
            event: string;
            payload: Row;
          };
        });
      return { svc, id: entry.id, events };
    };

    beforeEach(() => {
      jest.useFakeTimers({ now: Date.now() });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('idle-pause: 20초 뒤 log.paused (연결은 유지)', async () => {
      const s = await open('idle-pause');
      jest.advanceTimersByTime(15_000);
      expect(s.events().some((e) => e.event === 'log.paused')).toBe(false);
      jest.advanceTimersByTime(6_000);
      const paused = s.events().find((e) => e.event === 'log.paused')!;
      expect(paused.payload.code).toBe('LOG_STREAM_IDLE_PAUSED');
      // design 7.4: touch(화면이 보일 때만 온다) 기준이므로 "조작이 없어"가 아니다
      expect(paused.payload.text).toBe(
        '이 화면이 20초 동안 보이지 않아 따라가기를 멈췄습니다.',
      );
      expect(paused.payload.resumable).toBe(true);
      expect(s.events().some((e) => e.event === 'log.closing')).toBe(false);
      s.svc.closeById(s.id);
    });

    it('max-duration: 30초 뒤 log.closing(max_duration)', async () => {
      const s = await open('max-duration');
      jest.advanceTimersByTime(31_000);
      const closing = s.events().find((e) => e.event === 'log.closing')!;
      expect(closing.payload.reason).toBe('max_duration');
      expect(closing.payload.code).toBe('LOG_STREAM_MAX_DURATION');
      expect(closing.payload.text).toBe('연결을 30초마다 끊습니다(서버 보호).');
      expect(closing.payload.resumable).toBe(true);
    });

    it('stream-notice: 10초 뒤 log.notice(LOG_DROPPED_LINES) + 생략 줄 — 실제 push·flush 경로', async () => {
      const s = await open('stream-notice');
      jest.advanceTimersByTime(9_000);
      expect(s.events().some((e) => e.event === 'log.notice')).toBe(false);
      jest.advanceTimersByTime(2_000);
      const notice = s.events().find((e) => e.event === 'log.notice')!;
      expect(notice.payload.code).toBe('LOG_DROPPED_LINES');
      const dropped = s
        .events()
        .filter((e) => e.event === 'log.lines')
        .flatMap((e) => e.payload.lines as Row[])
        .filter((l) => l.kind === 'dropped');
      expect(dropped.length).toBe(1);
      expect(dropped[0].droppedLines).toBeGreaterThan(0);
      s.svc.closeById(s.id);
    });

    it('container-starting: 안내 후 연결을 유지하고 30초 뒤 줄이 붙는다 (live와 같은 대기 경로)', async () => {
      const s = await open('container-starting');
      expect(
        s.events().find((e) => e.event === 'log.notice')?.payload,
      ).toMatchObject({
        code: 'LOG_CONTAINER_NOT_STARTED',
        text: '컨테이너가 아직 시작되지 않았습니다. 시작되면 자동으로 표시됩니다.',
      });
      await jest.advanceTimersByTimeAsync(25_000);
      expect(s.events().some((e) => e.event === 'log.lines')).toBe(false);
      expect(s.events().some((e) => e.event === 'log.closing')).toBe(false);
      await jest.advanceTimersByTimeAsync(8_000);
      const lines = s
        .events()
        .filter((e) => e.event === 'log.lines')
        .flatMap((e) => e.payload.lines as Row[]);
      expect(lines.length).toBeGreaterThan(0);
      expect(s.events().some((e) => e.event === 'log.closing')).toBe(false);
      s.svc.closeById(s.id);
    });

    it('kubelet-unreachable: 스트림은 live처럼 안내 + 종료(source_error)', async () => {
      const s = await open('kubelet-unreachable');
      expect(
        s.events().find((e) => e.event === 'log.closing')?.payload,
      ).toMatchObject({
        reason: 'source_error',
        code: 'LOG_KUBELET_UNREACHABLE',
      });
    });

    it('flood: 2만 줄이 수십 초 안에 차고, 생략 없이, 대량 흐름에서도 가림이 된다 (AC-LOG51)', async () => {
      const s = await open('flood');
      jest.advanceTimersByTime(14_000);
      const lines = s
        .events()
        .filter((e) => e.event === 'log.lines' && !e.payload.initial)
        .flatMap((e) => e.payload.lines as Row[]);
      expect(lines.length).toBeGreaterThanOrEqual(20_000);
      expect(lines.some((l) => l.kind === 'dropped')).toBe(false);
      const masked = lines.filter((l) =>
        (l.segments as Row[]).some((g) => g.t === 'masked'),
      );
      expect(masked.length).toBeGreaterThanOrEqual(Math.floor(20_000 / 40));
      const raw = JSON.stringify(s.events());
      expect(raw).not.toContain('s3cret-pw');
      expect(raw).not.toContain('hunter2');
      expect(raw).not.toMatch(/Bearer flood\d+token/);
      s.svc.closeById(s.id);
    });
  });
});
