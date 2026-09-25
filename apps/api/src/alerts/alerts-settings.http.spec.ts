/* eslint-disable @typescript-eslint/no-unsafe-member-access -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- 응답 JSON 검사 */

/* eslint-disable @typescript-eslint/no-unsafe-argument -- 응답 JSON 검사 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
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
import { OverviewService } from '../cluster/overview.service';
import { LogsModule } from '../logs/logs.module';
import { AlertDispatcher } from './alert-dispatcher.service';
import { AlertEngine } from './alert-engine.service';
import { AlertSettingsService } from './alert-settings.service';
import { AlertStore } from './alert-store.service';
import { AlertsMockScenarioTarget } from './alerts.extensions';
import { AlertsModule } from './alerts.module';
import {
  DISCORD_SENDER,
  type DiscordSendResult,
  type DiscordSenderPort,
} from './discord-sender';

/**
 * 설정 화면 통합 2차에서 올라온 서버 몫 (PM 결정 2026-09-25, 계약 2.5).
 * - `keys[].status`: 알림 엔진이 **이미 판단한 값** 그대로
 * - `discord.lastDispatch`: 실제로 밖으로 나간 시도(`sent`·`failed`)만, 테스트 발송 포함, `skipped_*` 제외
 * - `discord.circuitBreaker.resumeAt`·`discord.queue.nextRetryAt`: 서킷 재개 시각·다음 재시도 시각
 *
 * **밖으로 나가는 문은 가짜 발송기로 바꿔 끼운다** — 실제 디스코드로 요청이 나가지 않는다.
 */
type Row = Record<string, any>;

class FakeSender implements DiscordSenderPort {
  calls: string[] = [];
  next: DiscordSendResult = {
    ok: true,
    status: 204,
    retryAfter: null,
    detail: null,
  };
  send(_url: string, content: string): Promise<DiscordSendResult> {
    this.calls.push(content);
    return Promise.resolve(this.next);
  }
}

async function boot(env: Record<string, string | undefined>) {
  process.env.DATA_SOURCE = 'mock';
  process.env.DATABASE_URL = '';
  delete process.env.ALERTS_DISPATCH;
  delete process.env.ALERTS_DISCORD_WEBHOOK_URL;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const sender = new FakeSender();
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
      AlertsModule,
    ],
  })
    .overrideProvider(DISCORD_SENDER)
    .useValue(sender)
    .compile();
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
  return { app, sender };
}

const settingsOf = async (app: INestApplication<App>) =>
  (await request(app.getHttpServer()).get('/api/alerts/settings').expect(200))
    .body as Row;

const pendingRecord = {
  alertKey: 'area:pods' as const,
  kind: 'transition' as const,
  severity: 'critical' as const,
  fromStatus: 'ok' as const,
  toStatus: 'critical' as const,
  reasonCode: 'POD_WAITING_CRASHLOOP',
  reasonText: 'CrashLoopBackOff',
  targets: [],
  targetCount: 0,
  parentAlertId: null,
  suppressedKeys: [],
  context: null,
  flapping: false,
};

describe('alerts settings — live 발송 경로 (가짜 발송기)', () => {
  let app: INestApplication<App>;
  let sender: FakeSender;

  beforeAll(async () => {
    ({ app, sender } = await boot({
      // mock 데이터 + live 발송: 발송기까지 가는 경로를 태운다 (가짜 발송기라 밖으로 나가지 않는다)
      ALERTS_DISPATCH: 'live',
      ALERTS_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/fake',
    }));
  });
  afterAll(async () => {
    await app.close();
    delete process.env.ALERTS_DISPATCH;
    delete process.env.ALERTS_DISCORD_WEBHOOK_URL;
  });

  const insertPending = () =>
    app.get(AlertStore).insert('mock', {
      ...pendingRecord,
      occurredAt: Date.now(),
      deliveries: [
        {
          channel: 'discord',
          state: 'pending',
          label: '',
          at: null,
          attempts: 0,
          responseCode: null,
          detail: null,
          nextRetryAt: null,
        },
      ],
    });

  it('keys[].status = 알림 엔진이 판단한 현재 상태 (새 기준 없음)', async () => {
    await app.get(AlertEngine).tick();
    const s = await settingsOf(app);
    const ov = await app.get(OverviewService).overview();
    const byKey = Object.fromEntries((s.keys as Row[]).map((k) => [k.key, k]));
    expect(byKey['area:pods'].status).toBe(ov.areas.pods.status.status);
    expect(byKey['area:nodes'].status).toBe(ov.areas.nodes.status.status);
    expect(byKey['area:controlPlane'].status).toBe(
      ov.areas.controlPlane.status.status,
    );
    expect(byKey['area:cost'].status).toBe(ov.cost.status.status);
    for (const k of s.keys as Row[]) {
      expect(['ok', 'warning', 'critical', 'unknown']).toContain(k.status);
      expect(typeof k.statusSince).toBe('string');
    }
  });

  it('아무것도 나가지 않았으면 lastDispatch는 null', async () => {
    const s = await settingsOf(app);
    expect(s.discord.lastDispatch).toBeNull();
    expect(sender.calls).toHaveLength(0);
  });

  it('429도 "그 시도는 실패" → lastDispatch.state=failed(429), 배달은 대기로 남고 queue.nextRetryAt이 찬다', async () => {
    sender.next = {
      ok: false,
      status: 429,
      retryAfter: '30',
      detail: '디스코드 429 Too Many Requests',
    };
    await insertPending();
    await app.get(AlertDispatcher).drain();
    const s = await settingsOf(app);
    expect(s.discord.lastDispatch).toMatchObject({
      state: 'failed',
      responseCode: 429,
    });
    expect(s.discord.queue.pending).toBeGreaterThanOrEqual(1);
    expect(Date.parse(s.discord.queue.nextRetryAt)).toBeGreaterThan(
      Date.now() + 20_000,
    );
  });

  it('서킷이 열리면 circuitBreaker.resumeAt = 재개 시각, 대기열 다음 시도도 그보다 이르지 않다', async () => {
    const settings = app.get(AlertSettingsService);
    const real = await settings.discord();
    const spy = jest.spyOn(settings, 'discord').mockResolvedValue({
      ...real,
      failureCircuitCount: 1,
      minIntervalSec: 0,
      failureCooldownMin: 60,
    });
    try {
      sender.next = {
        ok: false,
        status: 503,
        retryAfter: null,
        detail: '디스코드 응답 503',
      };
      const before = Date.now();
      await insertPending();
      await app.get(AlertDispatcher).drain();
      const s = await settingsOf(app);
      const cb = s.discord.circuitBreaker;
      expect(cb.open).toBe(true);
      expect(cb.consecutiveFailures).toBeGreaterThanOrEqual(1);
      const resume = Date.parse(cb.resumeAt);
      expect(resume).toBeGreaterThanOrEqual(before + 60 * 60_000 - 1000);
      expect(resume).toBeLessThanOrEqual(Date.now() + 60 * 60_000 + 1000);
      expect(Date.parse(s.discord.queue.nextRetryAt)).toBeGreaterThanOrEqual(
        resume,
      );
      const notice = (s.notices as Row[]).find(
        (n) => n.code === 'ALERTS_DISCORD_CIRCUIT_OPEN',
      );
      expect(notice?.details.resumeAt).toBe(cb.resumeAt);
      expect(s.discord.lastDispatch).toMatchObject({
        state: 'failed',
        responseCode: 503,
      });

      // 테스트 발송(live) 성공 → lastDispatch가 갱신되고 서킷이 닫힌다
      sender.next = { ok: true, status: 204, retryAfter: null, detail: null };
      const r = await request(app.getHttpServer())
        .post('/api/alerts/test')
        .send({ confirm: true })
        .expect(200);
      expect(r.body.result.state).toBe('sent');
      expect(sender.calls.at(-1)).toContain('[테스트]');
      const after = await settingsOf(app);
      expect(after.discord.lastDispatch).toMatchObject({
        state: 'sent',
        responseCode: 204,
      });
      expect(Date.parse(after.discord.lastDispatch.at)).toBeGreaterThanOrEqual(
        Date.parse(r.body.result.at) - 1000,
      );
      expect(after.discord.circuitBreaker).toMatchObject({
        open: false,
        consecutiveFailures: 0,
        resumeAt: null,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('테스트 발송 실패도 lastDispatch를 갱신한다 (failed)', async () => {
    sender.next = {
      ok: false,
      status: 404,
      retryAfter: null,
      detail: '디스코드 응답 404 Unknown Webhook',
    };
    const r = await app.get(AlertDispatcher).sendTestNow('[테스트] x');
    expect(r.state).toBe('failed');
    const s = await settingsOf(app);
    expect(s.discord.lastDispatch).toMatchObject({
      state: 'failed',
      responseCode: 404,
    });
  });
});

describe('alerts settings — mock `webhook-failed`의 표시 전용 서킷 (PM 결정)', () => {
  it('설정 응답만 "열림 · 10건 · 약 1시간 뒤"이고 dispatcher의 실제 서킷은 닫혀 있다', async () => {
    const { app, sender } = await boot({ ALERTS_DISPATCH: undefined });
    try {
      const target = app.get(AlertsMockScenarioTarget);
      const dispatcher = app.get(AlertDispatcher);
      target.setScenario('webhook-failed');
      const before = Date.now();
      const s = await settingsOf(app);
      const cb = s.discord.circuitBreaker;
      expect(cb).toMatchObject({ open: true, consecutiveFailures: 10 });
      const resume = Date.parse(cb.resumeAt);
      expect(resume).toBeGreaterThan(before + 50 * 60_000);
      expect(resume).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
      expect(
        (s.notices as Row[]).find(
          (n) => n.code === 'ALERTS_DISCORD_CIRCUIT_OPEN',
        )?.details.resumeAt,
      ).toBe(cb.resumeAt);

      // **실제 발송 상태에 섞이지 않는다**: dispatcher에 물으면 닫힘, 실패 수 0
      expect(dispatcher.circuit).toMatchObject({
        open: false,
        consecutiveFailures: 0,
        resumeAt: null,
      });
      // 표시 값 때문에 발송기를 부르는 일도 없다
      await dispatcher.drain();
      expect(sender.calls).toHaveLength(0);
      expect(s.discord.lastDispatch).toBeNull();

      // 다른 시나리오로 바꾸면 표시 값이 사라진다
      target.setScenario('default');
      const back = await settingsOf(app);
      expect(back.discord.circuitBreaker.open).toBe(false);
      expect(
        (back.notices as Row[]).some(
          (n) => n.code === 'ALERTS_DISCORD_CIRCUIT_OPEN',
        ),
      ).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('발송이 실제로 나갈 수 있는 조합(ALERTS_DISPATCH=live)에서는 덮지 않는다', async () => {
    const { app } = await boot({
      ALERTS_DISPATCH: 'live',
      ALERTS_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/fake',
    });
    try {
      app.get(AlertsMockScenarioTarget).setScenario('webhook-failed');
      const s = await settingsOf(app);
      expect(s.discord.circuitBreaker.open).toBe(false);
    } finally {
      await app.close();
      delete process.env.ALERTS_DISPATCH;
      delete process.env.ALERTS_DISCORD_WEBHOOK_URL;
    }
  });
});

describe('alerts settings — mock 발송 (기본)', () => {
  it('테스트 발송은 skipped_mock이고 lastDispatch는 null로 남는다 · 발송기는 한 번도 불리지 않는다', async () => {
    const { app, sender } = await boot({
      ALERTS_DISPATCH: undefined,
      ALERTS_DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/fake',
    });
    try {
      const r = await request(app.getHttpServer())
        .post('/api/alerts/test')
        .send({ confirm: true })
        .expect(200);
      expect(r.body.result.state).toBe('skipped_mock');
      const s = await settingsOf(app);
      expect(s.discord.lastDispatch).toBeNull();
      expect(s.discord.circuitBreaker.resumeAt).toBeNull();
      expect(sender.calls).toHaveLength(0);
    } finally {
      await app.close();
      delete process.env.ALERTS_DISCORD_WEBHOOK_URL;
    }
  });
});
