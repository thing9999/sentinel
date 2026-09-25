/**
 * 스트림에서 **시작 전 컨테이너를 기다렸다가 붙는다** (계약 6절 `LOG_CONTAINER_NOT_STARTED` "파드 watch로 자동 재시도",
 * PM 결정 2026-09-25). 연결을 닫지 않고, informer(ClusterStore) 변경을 보다가 컨테이너가 돌기 시작하면
 * `pods/log` follow를 연다. 유휴·최대 지속 상한은 그대로 적용된다.
 *
 * 실제 `LogStreamService`·`ClusterStore`에 쿠버네티스 follow만 대역으로 넣는다.
 */
import type { Response } from 'express';
import { ClusterStore } from '../cluster/state/cluster-store';
import type { RawPod } from '../cluster/model';
import { DirectLogError } from './direct-source';
import { LogStreamService } from './log-stream.service';

function pod(state: 'waiting' | 'running', restartCount = 0): RawPod {
  return {
    namespace: 'prod',
    name: 'api-1',
    uid: 'u1',
    phase: state === 'running' ? 'Running' : 'Pending',
    nodeName: 'node-a',
    labels: {},
    owner: null,
    createdAt: '2026-09-25T00:00:00.000Z',
    startTime: null,
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
          ready: state === 'running',
          restartCount,
          state:
            state === 'running'
              ? { type: 'running', reason: null, message: null, since: null }
              : {
                  type: 'waiting',
                  reason: 'ContainerCreating',
                  message: null,
                  since: null,
                },
          lastTermination: null,
        },
      },
    ],
    initContainers: [],
  } as unknown as RawPod;
}

function setup(opts: { idlePauseSec?: number; followError?: Error } = {}) {
  const store = new ClusterStore();
  store.upsertPod(pod('waiting'));
  const closeUpstream = jest.fn();
  const direct = {
    follow: jest.fn(() =>
      opts.followError
        ? Promise.reject(opts.followError)
        : Promise.resolve({ close: closeUpstream }),
    ),
  };
  const logs = {
    // 실제 LogsService의 판단과 같은 규칙: 상태 없음 또는 대기 + 재시작 0
    containerNeverStarted: (ns: string, name: string, container: string) => {
      const c = store.pods
        .get(`${ns}/${name}`)
        ?.containers.find((x) => x.name === container);
      if (!c) return false;
      if (!c.status) return true;
      return c.status.state?.type === 'waiting' && c.status.restartCount === 0;
    },
    mockContainerStarted: () => true,
    currentScenario: () => 'direct',
    defaultContainerOf: () => 'api',
    sourceInfo: () => ({ id: 'direct', label: '직접 조회', state: 'ok' }),
    capabilitiesOf: () => ({}),
  };
  const options = {
    dataSource: 'live',
    extraPatterns: [],
    limits: {
      maxStreams: 3,
      maxLinesPerSec: 2000,
      idlePauseSec: opts.idlePauseSec ?? 300,
      maxStreamMin: 30,
      maxLineBytes: 8192,
      maxBytes: 1024 * 1024,
    },
  };
  const svc = new LogStreamService(
    options as never,
    logs as never,
    direct as never,
    {} as never,
    store,
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
  const events = () =>
    writes.map(
      (w) =>
        JSON.parse(w.split('\ndata: ')[1]) as {
          event: string;
          payload: Record<string, unknown>;
        },
    );
  const open = async () => {
    const entry = svc.prepare(
      'direct',
      { namespace: 'prod', pod: 'api-1', container: 'api' },
      50,
    );
    await svc.attach(entry.id, res);
    return entry.id;
  };
  return { store, direct, svc, events, open, closeUpstream };
}

describe('log stream — 시작 전 컨테이너를 기다렸다가 붙는다', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: Date.now() });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('안내 후 연결을 유지하고, informer가 Running을 알리면 follow를 연다', async () => {
    const t = setup();
    const id = await t.open();
    const notice = t.events().find((e) => e.event === 'log.notice');
    expect(notice?.payload).toMatchObject({
      code: 'LOG_CONTAINER_NOT_STARTED',
      text: '컨테이너가 아직 시작되지 않았습니다. 시작되면 자동으로 표시됩니다.',
    });
    expect(t.direct.follow).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(t.direct.follow).not.toHaveBeenCalled();
    expect(t.events().some((e) => e.event === 'log.closing')).toBe(false);

    t.store.upsertPod(pod('running'));
    await jest.advanceTimersByTimeAsync(0);
    expect(t.direct.follow).toHaveBeenCalledTimes(1);
    expect(t.events().some((e) => e.event === 'log.closing')).toBe(false);
    t.svc.closeById(id);
  });

  it('신호를 놓쳐도 2초 재확인으로 붙는다', async () => {
    const t = setup();
    const id = await t.open();
    // changes$를 내지 않고 캐시만 바꾼다
    t.store.pods.set('prod/api-1', pod('running'));
    await jest.advanceTimersByTimeAsync(2_100);
    expect(t.direct.follow).toHaveBeenCalledTimes(1);
    t.svc.closeById(id);
  });

  it('기다리는 동안 파드가 사라지면 LOG_POD_NOT_FOUND로 닫는다', async () => {
    const t = setup();
    await t.open();
    t.store.deletePod('prod', 'api-1');
    await jest.advanceTimersByTimeAsync(0);
    const closing = t.events().find((e) => e.event === 'log.closing');
    expect(closing?.payload).toMatchObject({
      reason: 'source_error',
      code: 'LOG_POD_NOT_FOUND',
    });
    expect(t.direct.follow).not.toHaveBeenCalled();
  });

  it('유휴 일시정지 상한은 기다리는 중에도 그대로 — 멈추면 더 기다리지 않는다', async () => {
    const t = setup({ idlePauseSec: 20 });
    const id = await t.open();
    await jest.advanceTimersByTimeAsync(26_000);
    expect(t.events().some((e) => e.event === 'log.paused')).toBe(true);
    t.store.upsertPod(pod('running'));
    await jest.advanceTimersByTimeAsync(3_000);
    expect(t.direct.follow).not.toHaveBeenCalled();
    t.svc.closeById(id);
  });

  it('이미 돈 컨테이너에서 follow가 실패하면 기다리지 않고 안내 + 종료 (기존 동작)', async () => {
    const t = setup({
      followError: new DirectLogError(
        'LOG_KUBELET_UNREACHABLE',
        '노드에 연결할 수 없어 로그를 읽지 못했습니다.',
      ),
    });
    t.store.upsertPod(pod('running', 1));
    await t.open();
    const closing = t.events().find((e) => e.event === 'log.closing');
    expect(closing?.payload).toMatchObject({
      reason: 'source_error',
      code: 'LOG_KUBELET_UNREACHABLE',
    });
  });
});
