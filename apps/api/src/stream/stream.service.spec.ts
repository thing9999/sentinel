import { EventEmitter } from 'node:events';
import { Subject } from 'rxjs';
import type { TopicEvent, TopicSource } from '../common/extension-points';
import { SourceRegistry } from '../common/source-registry.service';
import { StreamService } from './stream.service';

class FakeRes extends EventEmitter {
  chunks: string[] = [];
  headers: Record<string, string> = {};
  statusCode = 0;
  status(c: number) {
    this.statusCode = c;
    return this;
  }
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  flushHeaders() {}
  write(s: string) {
    this.chunks.push(s);
    return true;
  }
  end() {
    this.emit('close');
  }
  get socket() {
    return null;
  }
}

function events(res: FakeRes): { event: string; seq: number; topic: string }[] {
  const out: { event: string; seq: number; topic: string }[] = [];
  for (const c of res.chunks) {
    const m = /^event: (.+)\ndata: (.+)\n\n$/.exec(c);
    if (!m) continue;
    const env = JSON.parse(m[2]) as { seq: number; topic: string };
    out.push({ event: m[1], seq: env.seq, topic: env.topic });
  }
  return out;
}

function makeService(sources: TopicSource[], maxClients = 20): StreamService {
  const registry = new SourceRegistry('mock');
  const discovery = {
    getProviders: () =>
      sources.map((s) => ({ instance: s, metatype: s.constructor })),
  };
  const reflector = { get: () => true };
  const config = { get: () => maxClients };
  const svc = new StreamService(
    'mock',
    discovery as never,
    reflector as never,
    registry,
    config as never,
  );
  svc.onApplicationBootstrap();
  return svc;
}

class Src implements TopicSource {
  readonly subject = new Subject<TopicEvent>();
  readonly events$ = this.subject.asObservable();
  constructor(
    readonly topic: string,
    private readonly during?: () => void,
  ) {}
  snapshot(): Promise<TopicEvent[]> {
    this.during?.();
    return Promise.resolve([{ event: `${this.topic}.snapshot`, data: {} }]);
  }
}

describe('StreamService', () => {
  it('topics 파싱: 생략하면 전체, 계약 순서로 정렬, 알 수 없으면 400', () => {
    const svc = makeService([]);
    expect(svc.parseTopics(undefined)).toEqual([
      'overview',
      'cluster',
      'metrics',
      'db',
      'cost',
      'advisor',
      'aws-snapshots',
      'k8s-snapshots',
      'snapshot-menu',
    ]);
    expect(svc.parseTopics('db,cluster')).toEqual(['cluster', 'db']);
    expect(() => svc.parseTopics('cluster,nope')).toThrow();
  });

  it('retry → hello → 토픽별 snapshot 순서, 스냅샷 중 변경은 뒤에', async () => {
    const cluster = new Src('cluster');
    const db = new Src('db', () =>
      cluster.subject.next({ event: 'cluster.pod.upsert', data: {} }),
    );
    const svc = makeService([db, cluster]);
    const res = new FakeRes();
    await svc.open(res as never, ['cluster', 'db']);
    expect(res.chunks[0]).toBe('retry: 3000\n\n');
    expect(res.headers['Content-Type']).toContain('text/event-stream');
    const ev = events(res);
    expect(ev.map((e) => e.event)).toEqual([
      'stream.hello',
      'cluster.snapshot',
      'db.snapshot',
      'cluster.pod.upsert',
    ]);
    expect(ev.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    // 이후 변경은 바로 전달, 연결 종료 후에는 구독 해제
    db.subject.next({ event: 'db.updated', data: {} });
    expect(events(res).at(-1)?.event).toBe('db.updated');
    res.end();
    db.subject.next({ event: 'db.updated', data: {} });
    expect(events(res)).toHaveLength(5);
    expect(svc.connectionCount).toBe(0);
  });

  it('동시 연결 상한을 넘으면 STREAM_LIMIT_REACHED', async () => {
    const svc = makeService([], 1);
    await svc.open(new FakeRes() as never, ['cluster']);
    await expect(
      svc.open(new FakeRes() as never, ['cluster']),
    ).rejects.toMatchObject({
      code: 'STREAM_LIMIT_REACHED',
    });
  });

  it('종료 시 stream.closing', async () => {
    const svc = makeService([]);
    const res = new FakeRes();
    await svc.open(res as never, ['cluster']);
    svc.beforeApplicationShutdown();
    expect(events(res).at(-1)?.event).toBe('stream.closing');
  });
});
