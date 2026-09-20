import { Subject } from 'rxjs';
import type { AwsSnapshotsService } from '../aws-snapshots/aws-snapshots.service';
import type { TopicEvent } from '../common/extension-points';
import type { Status } from '../common/status';
import type { K8sSnapshotsService } from '../k8s-snapshots/k8s-snapshots.service';
import { SnapshotMenuService } from './snapshot-menu.service';

/** 메뉴 합산 규칙 (docs/api/k8s-snapshot.md 12.1) */
function status(s: Status, stale = false) {
  return {
    status: s,
    reasons: [],
    updatedAt: null,
    statusChangedAt: null,
    stale,
  };
}

function make(
  aws: {
    state: string;
    status: Status;
    critical?: number;
    warning?: number;
    unknown?: number;
    stale?: boolean;
  },
  k8s: {
    state: string;
    status: Status;
    critical?: number;
    warning?: number;
    unknown?: number;
    stale?: boolean;
  },
) {
  const awsEvents = new Subject<TopicEvent>();
  const k8sEvents = new Subject<TopicEvent>();
  const a = {
    events$: awsEvents,
    whenReady: () => Promise.resolve(),
    buildSummary: () => ({
      root: { state: aws.state },
      status: status(aws.status, aws.stale),
      counts: {
        critical: aws.critical ?? 0,
        warning: aws.warning ?? 0,
        unknown: aws.unknown ?? 0,
      },
    }),
  };
  const k = {
    events$: k8sEvents,
    whenReady: () => Promise.resolve(),
    menuTab: () => ({
      included: k8s.state !== 'not_configured',
      sourceState: k8s.state,
      status: status(k8s.status, k8s.stale),
      critical: k8s.critical ?? 0,
      warning: k8s.warning ?? 0,
      unknown: k8s.unknown ?? 0,
      latestDrift: { snapshotId: 'x', drift: { status: status('warning') } },
    }),
  };
  const svc = new SnapshotMenuService(
    'live',
    a as unknown as AwsSnapshotsService,
    k as unknown as K8sSnapshotsService,
  );
  return { svc, awsEvents, k8sEvents };
}

describe('SnapshotMenuService', () => {
  it('둘 다 포함: 최악 상태, 커밋 금지 합계와 쪽별 수, 드리프트는 메뉴 상태에 없음', () => {
    const { svc } = make(
      { state: 'ok', status: 'critical', critical: 2, warning: 1 },
      { state: 'ok', status: 'warning', critical: 0, warning: 3 },
    );
    const m = svc.build();
    expect(m.menu.status.status).toBe('critical');
    expect(m.menu.count).toBe(2);
    expect(m.menu.showIcon).toBe(true);
    expect(m.menu.status.reasons.map((r) => r.text)).toEqual([
      '커밋 금지 스냅샷 2개 (AWS 2 · Kubernetes 0)',
      '주의 스냅샷 4개 (AWS 1 · Kubernetes 3)',
    ]);
    expect(JSON.stringify(m.menu)).not.toContain('drift');
    expect(m.tabs.k8s.latestDrift?.snapshotId).toBe('x');
  });

  it('설정 없는 쪽은 빼고, 둘 다 없으면 아이콘 없음', () => {
    const one = make(
      { state: 'not_configured', status: 'unknown' },
      { state: 'ok', status: 'ok' },
    ).svc.build();
    expect(one.tabs.aws.included).toBe(false);
    expect(one.menu.status.status).toBe('ok');
    expect(one.menu.status.reasons).toEqual([]);
    const none = make(
      { state: 'not_configured', status: 'unknown' },
      { state: 'not_configured', status: 'unknown' },
    ).svc.build();
    expect(none.menu.showIcon).toBe(false);
    expect(none.menu.status.reasons[0].code).toBe('SOURCE_NOT_CONFIGURED');
  });

  it('출처 문제는 쪽 이름을 붙이고, stale 은 하나라도 stale 이면 true', () => {
    const m = make(
      { state: 'unavailable', status: 'unknown' },
      { state: 'stale', status: 'ok', stale: true },
    ).svc.build();
    expect(m.menu.status.reasons.map((r) => r.text)).toEqual([
      'AWS 스냅샷 폴더를 찾을 수 없습니다',
      'Kubernetes 스냅샷 폴더 확인 실패, 마지막 결과 유지 중',
    ]);
    expect(m.menu.status.stale).toBe(true);
  });

  it('하위 요약 이벤트 → snapshot-menu.updated (바뀐 것만), *.snapshot → snapshot-menu.snapshot', async () => {
    const { svc, k8sEvents } = make(
      { state: 'ok', status: 'ok' },
      { state: 'ok', status: 'ok' },
    );
    const got: TopicEvent[] = [];
    svc.events$.subscribe((e) => got.push(e));
    await svc.snapshot();
    k8sEvents.next({ event: 'k8s-snapshots.changed', data: {} });
    svc.flushNow();
    expect(got).toEqual([]); // 내용이 같으면 보내지 않는다
    k8sEvents.next({ event: 'k8s-snapshots.snapshot', data: {} });
    svc.flushNow();
    expect(got.map((e) => e.event)).toEqual(['snapshot-menu.snapshot']);
    svc.onModuleDestroy();
  });
});
