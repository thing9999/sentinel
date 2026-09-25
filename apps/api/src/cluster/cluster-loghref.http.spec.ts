/* eslint-disable @typescript-eslint/no-unsafe-member-access -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-return -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-argument -- 응답 JSON 검사 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { filter, firstValueFrom, timeout } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ApiExceptionFilter,
  validationExceptionFactory,
} from '../common/api-error';
import { CommonModule } from '../common/common.module';
import type { TopicEvent } from '../common/extension-points';
import { LogLinkPolicy } from '../common/log-link-policy.service';
import { validateEnv } from '../config/env.validation';
import { PrismaModule } from '../database/prisma.module';
import { ClusterTopicSource } from './cluster-topics';
import { ClusterModule } from './cluster.module';
import { ClusterStore } from './state/cluster-store';

/**
 * **SSE 값과 REST 값이 같다** (2026-09-25 결함 재발 방지).
 * `ControlPlaneComponent.logHref`가 REST(`GET /api/cluster/control-plane`)에만 채워지고
 * SSE(`cluster.snapshot`·`cluster.controlplane.updated`)에는 항상 null이었다.
 * 이제 링크는 **평가 단계**에서 채우므로 두 경로가 같은 객체를 쓴다 — 이 테스트가 그것을 고정한다.
 */

type Row = Record<string, any>;

async function boot(env: Record<string, string>) {
  process.env.DATA_SOURCE = 'mock';
  process.env.DATABASE_URL = '';
  delete process.env.LOGS_ENABLED;
  delete process.env.LOG_DENY_NAMESPACES;
  Object.assign(process.env, env);
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
    ],
  }).compile();
  const app = mod.createNestApplication<INestApplication<App>>();
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
  return app;
}

const get = async (app: INestApplication<App>, path: string) =>
  (await request(app.getHttpServer()).get(path).expect(200)).body;

const cpLinks = (body: Row) =>
  (body.components.items as Row[]).map((c) => [
    c.kind,
    c.nodeName,
    c.podKey,
    c.logHref,
  ]);

const byKey = (items: Row[], key = 'key') =>
  Object.fromEntries(items.map((x) => [x[key], x.logHref]));

describe('cluster logHref — SSE와 REST가 같은 값 (LOGS_ENABLED=true)', () => {
  let app: INestApplication<App>;
  let topic: ClusterTopicSource;

  beforeAll(async () => {
    app = await boot({ LOGS_ENABLED: 'true' });
    topic = app.get(ClusterTopicSource);
  });
  afterAll(async () => {
    await app.close();
  });

  it('cluster.snapshot의 컨트롤 플레인 logHref = GET /api/cluster/control-plane', async () => {
    const [snap] = await topic.snapshot();
    const rest = await get(app, '/api/cluster/control-plane');
    const sse = cpLinks((snap.data as Row).controlPlane);
    expect(sse).toEqual(cpLinks(rest));
    // 결함이 "둘 다 null"로 같아지는 것도 막는다: 링크가 실제로 있어야 한다
    const links = sse.map((r) => r[3] as string | null).filter(Boolean);
    expect(links.length).toBeGreaterThan(0);
    // 매트릭스 링크는 follow=1 (PM 결정 D3)
    for (const h of links) expect(h).toContain('follow=1');
  });

  it('cluster.controlplane.updated의 logHref = REST', async () => {
    await topic.snapshot(); // 비교 기준점
    const store = app.get(ClusterStore);
    const cp = [...store.pods.values()].find(
      (p) =>
        p.namespace === 'kube-system' && p.name.startsWith('kube-scheduler-'),
    )!;
    const waiting = {
      ...cp,
      containers: cp.containers.map((c) => ({
        ...c,
        status: {
          ready: false,
          restartCount: (c.status?.restartCount ?? 0) + 5,
          state: {
            type: 'waiting' as const,
            reason: 'CrashLoopBackOff',
            message: null,
            since: null,
          },
          lastTermination: c.status?.lastTermination ?? null,
        },
      })),
    };
    const next = firstValueFrom(
      topic.events$.pipe(
        filter((e: TopicEvent) => e.event === 'cluster.controlplane.updated'),
        timeout(5000),
      ),
    );
    store.upsertPod(waiting);
    const ev = await next;
    const rest = await get(app, '/api/cluster/control-plane');
    expect(cpLinks(ev.data as Row)).toEqual(cpLinks(rest));
    expect(
      cpLinks(ev.data as Row).filter((r) => r[3] !== null).length,
    ).toBeGreaterThan(0);
  });

  it('파드·이벤트·워크로드 logHref도 스냅샷과 REST가 같다 (진입점 2·4·5·7)', async () => {
    const [snap] = await topic.snapshot();
    const data = snap.data as Row;
    const pods = await get(app, '/api/cluster/pods?showCompleted=true');
    const events = await get(app, '/api/cluster/events');
    const workloads = await get(app, '/api/cluster/workloads');
    expect(byKey(data.pods)).toEqual(byKey(pods.items));
    expect(byKey(data.events)).toEqual(byKey(events.items));
    expect(byKey(data.workloads)).toEqual(byKey(workloads.items));

    // 파드: 모두 링크가 있고 follow=1
    for (const p of pods.items as Row[]) {
      expect(p.logHref).toBe(
        `/logs?namespace=${p.namespace}&pod=${p.name}&follow=1`,
      );
    }
    // 이벤트: 대상이 파드일 때만, follow 없이 at=lastSeenAt
    for (const e of events.items as Row[]) {
      if (e.involvedObject.kind === 'Pod') {
        const q = new URLSearchParams((e.logHref as string).split('?')[1]);
        expect(q.get('pod')).toBe(e.involvedObject.name);
        expect(q.get('at')).toBe(e.lastSeenAt);
        expect(q.has('follow')).toBe(false);
      } else {
        expect(e.logHref).toBeNull();
      }
    }
    expect(
      (events.items as Row[]).some((e) => e.involvedObject.kind === 'Pod'),
    ).toBe(true);
    // 워크로드: workload=<키> + follow=1
    for (const w of workloads.items as Row[]) {
      const q = new URLSearchParams((w.logHref as string).split('?')[1]);
      expect(q.get('workload')).toBe(w.key);
      expect(q.get('follow')).toBe('1');
    }
  });

  it('워크로드 상세의 소속 파드 행에도 같은 링크가 있다 (진입점 5)', async () => {
    const wl = (await get(app, '/api/cluster/workloads')).items[0] as Row;
    const detail = await get(
      app,
      `/api/cluster/workloads/${wl.kind}/${wl.namespace}/${wl.name}`,
    );
    expect(detail.workload.logHref).toBe(wl.logHref);
    for (const p of detail.pods as Row[])
      expect(p.logHref).toContain(`pod=${p.name}`);
  });

  it('mock logs=disabled(정책 값 전환) → 스냅샷을 다시 보내고 링크가 전부 사라진다', async () => {
    const policy = app.get(LogLinkPolicy);
    const resent = firstValueFrom(
      topic.events$.pipe(
        filter((e: TopicEvent) => e.event === 'cluster.snapshot'),
        timeout(5000),
      ),
    );
    policy.setMockDisabled(true);
    const snap = (await resent).data as Row;
    const all = [
      ...cpLinks(snap.controlPlane).map((r) => r[3]),
      ...(snap.pods as Row[]).map((p) => p.logHref),
      ...(snap.events as Row[]).map((e) => e.logHref),
      ...(snap.workloads as Row[]).map((w) => w.logHref),
    ];
    expect(all.every((h) => h === null)).toBe(true);
    const rest = await get(app, '/api/cluster/control-plane');
    expect(cpLinks(rest).every((r) => r[3] === null)).toBe(true);

    policy.setMockDisabled(false);
    const back = await get(app, '/api/cluster/control-plane');
    expect(cpLinks(back).some((r) => r[3] !== null)).toBe(true);
  });
});

describe('cluster logHref — LOGS_ENABLED=false / 차단 네임스페이스', () => {
  it('LOGS_ENABLED=false면 REST·SSE 모두 null', async () => {
    const app = await boot({ LOGS_ENABLED: 'false' });
    try {
      const [snap] = await app.get(ClusterTopicSource).snapshot();
      const data = snap.data as Row;
      const rest = await get(app, '/api/cluster/control-plane');
      expect(cpLinks(data.controlPlane)).toEqual(cpLinks(rest));
      expect(cpLinks(rest).every((r) => r[3] === null)).toBe(true);
      expect((data.pods as Row[]).every((p) => p.logHref === null)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('LOG_DENY_NAMESPACES=kube-system면 그 네임스페이스만 null (매트릭스 포함)', async () => {
    const app = await boot({
      LOGS_ENABLED: 'true',
      LOG_DENY_NAMESPACES: 'kube-system',
    });
    try {
      const [snap] = await app.get(ClusterTopicSource).snapshot();
      const data = snap.data as Row;
      expect(cpLinks(data.controlPlane).every((r) => r[3] === null)).toBe(true);
      for (const p of data.pods as Row[]) {
        if (p.namespace === 'kube-system') expect(p.logHref).toBeNull();
        else expect(p.logHref).not.toBeNull();
      }
    } finally {
      await app.close();
    }
  });
});
