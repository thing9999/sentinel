/**
 * AC-ALERT33: API가 시작할 때 발송 대기(`pending`)로 남아 있던 기록은 **`skipped_restart`로 정리하고
 * 다시 보내지 않는다** — 오래된 알림이 뒤늦게 채널에 뜨는 것을 막는다.
 * (`alert-store.service.ts` `markPendingAsRestart`, `alert-dispatcher.service.ts` 시작 훅)
 *
 * DB 경로는 PGlite 대신 **저장소 대역**(Prisma `alertDelivery`의 `updateMany`·`findMany`만 흉내 내는 표)으로
 * 확인한다. 확인하는 것은 "정리 질의가 무엇을 바꾸는가"와 "발송 큐 질의가 그것을 다시 집지 않는가"의 짝이다.
 */
import { AlertDispatcher } from './alert-dispatcher.service';
import { AlertStore } from './alert-store.service';
import type { DispatchRecord } from './alerts.types';
import type { DiscordSendResult, DiscordSenderPort } from './discord-sender';

const pending = (): DispatchRecord => ({
  channel: 'discord',
  state: 'pending',
  label: '',
  at: null,
  attempts: 1,
  responseCode: 503,
  detail: null,
  nextRetryAt: new Date(Date.now() - 1000).toISOString(),
});

const input = (deliveries: DispatchRecord[]) => ({
  alertKey: 'area:pods' as const,
  kind: 'transition' as const,
  severity: 'critical' as const,
  fromStatus: 'ok' as const,
  toStatus: 'critical' as const,
  reasonCode: 'POD_WAITING_CRASHLOOP',
  reasonText: 'CrashLoopBackOff',
  targets: [],
  targetCount: 0,
  occurredAt: Date.now() - 60_000,
  parentAlertId: null,
  suppressedKeys: [],
  context: null,
  flapping: false,
  deliveries,
});

describe('markPendingAsRestart — 메모리 경로', () => {
  it('시작 시 pending이던 기록이 skipped_restart가 되고 큐에서 빠진다 (다른 dataSource는 그대로)', async () => {
    const store = new AlertStore({ isConnected: false } as never);
    const live = await store.insert('live', input([pending()]));
    const mock = await store.insert('mock', input([pending()]));
    expect(await store.dueDeliveries('live', Date.now())).toHaveLength(1);

    const n = await store.markPendingAsRestart('live');
    expect(n).toBe(1);
    const after = await store.byId(live.id);
    expect(after?.deliveries[0]).toMatchObject({
      state: 'skipped_restart',
      nextRetryAt: null,
    });
    expect(await store.dueDeliveries('live', Date.now())).toHaveLength(0);
    // live 이력만 정리한다
    expect((await store.byId(mock.id))?.deliveries[0].state).toBe('pending');
  });
});

describe('markPendingAsRestart — DB 경로 (저장소 대역)', () => {
  interface Row {
    alertId: string;
    status: string;
    attempts: number;
    nextAttemptAt: Date | null;
    createdAt: Date;
    dataSource: 'mock' | 'live';
  }
  const table: Row[] = [
    {
      alertId: 'a-live-pending',
      status: 'pending',
      attempts: 1,
      nextAttemptAt: null,
      createdAt: new Date(),
      dataSource: 'live',
    },
    {
      alertId: 'a-live-sent',
      status: 'sent',
      attempts: 1,
      nextAttemptAt: null,
      createdAt: new Date(),
      dataSource: 'live',
    },
    {
      alertId: 'a-mock-pending',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      createdAt: new Date(),
      dataSource: 'mock',
    },
  ];
  type Where = {
    status?: string;
    alert?: { dataSource?: string };
    OR?: { nextAttemptAt: null | { lte: Date } }[];
  };
  const match = (r: Row, w: Where) =>
    (w.status === undefined || r.status === w.status) &&
    (w.alert?.dataSource === undefined ||
      r.dataSource === w.alert.dataSource) &&
    (!w.OR ||
      w.OR.some((o) =>
        o.nextAttemptAt === null
          ? r.nextAttemptAt === null
          : r.nextAttemptAt !== null && r.nextAttemptAt <= o.nextAttemptAt.lte,
      ));
  const updateMany = jest.fn(
    ({
      where,
      data,
    }: {
      where: Where;
      data: { status: string; nextAttemptAt: null };
    }) => {
      let count = 0;
      for (const r of table) {
        if (!match(r, where)) continue;
        r.status = data.status;
        r.nextAttemptAt = data.nextAttemptAt;
        count += 1;
      }
      return Promise.resolve({ count });
    },
  );
  const findMany = jest.fn(({ where }: { where: Where }) =>
    Promise.resolve(table.filter((r) => match(r, where))),
  );
  const prisma = { isConnected: true, alertDelivery: { updateMany, findMany } };

  it('정리 질의는 해당 dataSource의 pending만 skipped_restart로 바꾸고, 발송 큐는 그것을 다시 집지 않는다', async () => {
    const store = new AlertStore(prisma as never);
    expect(
      (await store.dueDeliveries('live', Date.now())).map((d) => d.alertId),
    ).toEqual(['a-live-pending']);

    const n = await store.markPendingAsRestart('live');
    expect(n).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { status: 'pending', alert: { dataSource: 'live' } },
      data: { status: 'skipped_restart', nextAttemptAt: null },
    });
    expect(table.find((r) => r.alertId === 'a-live-pending')?.status).toBe(
      'skipped_restart',
    );
    expect(table.find((r) => r.alertId === 'a-live-sent')?.status).toBe('sent');
    expect(table.find((r) => r.alertId === 'a-mock-pending')?.status).toBe(
      'pending',
    );
    expect(await store.dueDeliveries('live', Date.now())).toEqual([]);
  });
});

describe('AlertDispatcher 시작 훅 — 다시 보내지 않는다 (발송기 호출 0건)', () => {
  class CountingSender implements DiscordSenderPort {
    calls = 0;
    send(): Promise<DiscordSendResult> {
      this.calls += 1;
      return Promise.resolve({
        ok: true,
        status: 204,
        retryAfter: null,
        detail: null,
      });
    }
  }
  const settings = {
    dispatchMode: () => ({ mode: 'live', modeSource: 'env' }),
    discord: () =>
      Promise.resolve({
        enabled: true,
        minSeverity: 'critical',
        sendUnknown: true,
        minIntervalSec: 0,
        backoffSec: [5, 30, 120],
        failureCircuitCount: 10,
        failureCooldownMin: 60,
        testCooldownSec: 60,
        allowedHosts: ['discord.com'],
      }),
  };
  const cluster = { clusterInfo: () => ({ name: 'test-cluster' }) };
  const config = { get: () => undefined };
  const prisma = { isConnected: false };
  const ENV = 'ALERTS_DISCORD_WEBHOOK_URL';
  const saved = process.env[ENV];

  beforeAll(() => {
    process.env[ENV] = 'https://discord.com/api/webhooks/1/fake-for-test';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('시작 때 pending → skipped_restart, 큐를 돌려도 발송기 0회 (대조: 시작 뒤에 생긴 pending은 보낸다)', async () => {
    const store = new AlertStore(prisma as never);
    const leftover = await store.insert('live', input([pending()]));
    const sender = new CountingSender();
    const dispatcher = new AlertDispatcher(
      'live',
      store,
      settings as never,
      cluster as never,
      prisma as never,
      config as never,
      sender,
    );
    try {
      dispatcher.onApplicationBootstrap();
      for (let i = 0; i < 50; i += 1) {
        if ((await store.byId(leftover.id))?.deliveries[0].state !== 'pending')
          break;
        await new Promise((r) => setTimeout(r, 5));
      }
      expect((await store.byId(leftover.id))?.deliveries[0].state).toBe(
        'skipped_restart',
      );
      await dispatcher.drain();
      expect(sender.calls).toBe(0);

      // 대조군: 큐가 실제로 보낼 수 있는 상태임을 보인다 (그래서 위의 0회는 정리 덕분이다)
      const fresh = await store.insert('live', input([pending()]));
      await dispatcher.drain();
      expect(sender.calls).toBe(1);
      expect((await store.byId(fresh.id))?.deliveries[0].state).toBe('sent');
      expect((await store.byId(leftover.id))?.deliveries[0].state).toBe(
        'skipped_restart',
      );
    } finally {
      dispatcher.onModuleDestroy();
    }
  });
});
