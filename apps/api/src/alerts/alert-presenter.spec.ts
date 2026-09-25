import { presentItem, type PresentOptions } from './alert-presenter';
import type { AlertRecord } from './alerts.types';

/**
 * 알림 → 로그 **링크만** (alerts 계약 2.2.1). 알림 링크는 **그 시각(`at`)을 보러 가는** 링크다
 * (PM 결정 D3). 여기서는 presenter가 알림의 시각을 링크 규칙에 넘기는지만 본다 —
 * `follow`/`at`을 붙일지는 `logs/log-href.ts`가 정한다(`log-href.spec.ts`).
 */
describe('presentItem — logHref', () => {
  const occurredAt = Date.parse('2026-09-25T14:02:05.000Z');
  const rec: AlertRecord = {
    id: 'a1',
    dataSource: 'mock',
    alertKey: 'area:pods',
    kind: 'transition',
    severity: 'critical',
    fromStatus: 'ok',
    toStatus: 'critical',
    reasonCode: 'POD_WAITING_CRASHLOOP',
    reasonText: 'prod / api-1 CrashLoopBackOff',
    targets: [
      { kind: 'Deployment', namespace: 'prod', name: 'api' },
      { kind: 'Pod', namespace: 'prod', name: 'api-1' },
    ],
    targetCount: 2,
    occurredAt,
    lastEventAt: occurredAt,
    resolvedAt: null,
    closedAt: null,
    parentAlertId: null,
    repeatCount: 1,
    flapping: false,
    suppressedKeys: [],
    acknowledgedAt: null,
    context: null,
    createdAt: occurredAt,
    deliveries: [],
  };

  it('첫 번째 Pod 대상과 알림 시각(occurredAt)을 링크 규칙에 넘기고 결과를 그대로 싣는다', () => {
    const calls: { ref: unknown; at: string | null }[] = [];
    const opts: PresentOptions = {
      nowMs: occurredAt + 60_000,
      maxTargets: 3,
      dedupeWindowMin: 10,
      flapWindowMin: 30,
      logLink: (ref, at) => {
        calls.push({ ref, at });
        return { href: '/logs?x', target: null };
      },
    };
    const item = presentItem(rec, opts);
    expect(calls).toEqual([
      {
        ref: { kind: 'Pod', namespace: 'prod', name: 'api-1' },
        at: '2026-09-25T14:02:05.000Z',
      },
    ]);
    expect(item.logHref).toBe('/logs?x');
  });

  it('Pod 대상이 없으면 링크 규칙을 부르지 않고 not_a_pod', () => {
    const opts: PresentOptions = {
      nowMs: occurredAt,
      maxTargets: 3,
      dedupeWindowMin: 10,
      flapWindowMin: 30,
      logLink: () => {
        throw new Error('불리면 안 된다');
      },
    };
    const item = presentItem({ ...rec, targets: [rec.targets[0]] }, opts);
    expect(item.logHref).toBeNull();
    expect(item.logTarget?.unavailableReason).toBe('not_a_pod');
  });
});
