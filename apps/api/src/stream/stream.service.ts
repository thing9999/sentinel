import {
  BeforeApplicationShutdown,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { Subscription } from 'rxjs';
import { ApiException, validationFailed } from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { discoverProviders } from '../common/discovery';
import {
  TOPIC_SOURCE_METADATA,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import { SourceRegistry } from '../common/source-registry.service';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';

/** 알려진 토픽과 초기 스냅샷 순서 (docs/api/common.md 5.4) */
export const STREAM_TOPICS = [
  'overview',
  'cluster',
  'metrics',
  'db',
  'cost',
  'advisor',
  'aws-snapshots',
  'k8s-snapshots',
  'snapshot-menu',
] as const;
export type StreamTopic = (typeof STREAM_TOPICS)[number];

export const HEARTBEAT_SEC = 15;
const RETRY_MS = 3000;

interface Connection {
  id: string;
  res: Response;
  seq: number;
  topics: StreamTopic[];
  subs: Subscription[];
  heartbeat: NodeJS.Timeout | null;
  closed: boolean;
  /** 초기 스냅샷 전송 중 들어온 변경 이벤트 (토픽별) */
  pending: Map<string, TopicEvent[]> | null;
}

/**
 * 단일 SSE 스트림 `GET /api/stream?topics=...` (docs/api/common.md 5절).
 * - `@TopicSourceProvider()`가 붙은 provider를 DiscoveryService로 찾아 토픽별로 구독한다.
 * - 연결 직후: `retry: 3000` → `stream.hello` → 토픽별 `*.snapshot` → 변경 이벤트
 * - 15초마다 `stream.heartbeat`, 출처 상태 변화는 `stream.source`, 종료 시 `stream.closing`
 * - `id:` 필드는 보내지 않는다 (Last-Event-ID 미지원)
 */
@Injectable()
export class StreamService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(StreamService.name);
  private sources = new Map<string, TopicSource>();
  private readonly connections = new Set<Connection>();
  private readonly maxClients: number;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly registry: SourceRegistry,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxClients = config.get('SSE_MAX_CLIENTS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.discover();
  }

  /** TopicSource 목록을 다시 찾는다 (다른 모듈이 늦게 등록돼도 연결 시점에 반영) */
  private discover(): void {
    const found = discoverProviders<TopicSource>(
      this.discovery,
      this.reflector,
      TOPIC_SOURCE_METADATA,
    );
    const map = new Map<string, TopicSource>();
    for (const s of found) {
      if (map.has(s.topic)) {
        this.logger.warn(
          `토픽 ${s.topic} 제공자가 둘 이상입니다. 첫 번째만 씁니다.`,
        );
        continue;
      }
      map.set(s.topic, s);
    }
    this.sources = map;
    this.logger.log(
      `SSE 토픽 제공자: ${[...map.keys()].join(', ') || '(없음)'}`,
    );
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** topics 쿼리 파싱. 생략하면 전체. 알 수 없는 토픽이면 400 */
  parseTopics(raw: string | string[] | undefined): StreamTopic[] {
    if (raw === undefined || raw === '') return [...STREAM_TOPICS];
    const list = (Array.isArray(raw) ? raw.join(',') : raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = list.filter(
      (t) => !(STREAM_TOPICS as readonly string[]).includes(t),
    );
    if (unknown.length > 0) {
      throw validationFailed([
        {
          field: 'topics',
          value: raw,
          constraints: [
            `unknown topic(s): ${unknown.join(', ')}. allowed: ${STREAM_TOPICS.join(', ')}`,
          ],
        },
      ]);
    }
    // 계약 순서대로, 중복 제거
    return STREAM_TOPICS.filter((t) => list.includes(t));
  }

  async open(res: Response, topics: StreamTopic[]): Promise<void> {
    if (this.connections.size >= this.maxClients) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STREAM_LIMIT_REACHED',
        `SSE 동시 연결 상한(${this.maxClients})을 넘었습니다.`,
        { maxClients: this.maxClients },
      );
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);
    res.socket?.setKeepAlive(true);

    const conn: Connection = {
      id: randomUUID(),
      res,
      seq: 0,
      topics,
      subs: [],
      heartbeat: null,
      closed: false,
      pending: new Map(),
    };
    this.connections.add(conn);
    res.on('close', () => this.close(conn));

    res.write(`retry: ${RETRY_MS}\n\n`);
    this.send(conn, 'stream', 'stream.hello', {
      streamId: conn.id,
      dataSource: this.dataSource,
      serverTime: new Date().toISOString(),
      heartbeatSec: HEARTBEAT_SEC,
      topics,
      sources: this.registry.list(),
    });

    // 출처 상태 변화
    conn.subs.push(
      this.registry.changes$.subscribe((source) =>
        this.send(conn, 'stream', 'stream.source', { source }),
      ),
    );

    // 스냅샷 전에 구독을 먼저 걸고, 스냅샷 동안 온 변경은 모았다가 뒤에 보낸다
    const active = topics
      .map((t) => [t, this.sources.get(t)] as const)
      .filter((x): x is readonly [StreamTopic, TopicSource] => Boolean(x[1]));
    for (const [topic, src] of active) {
      conn.subs.push(
        src.events$.subscribe({
          next: (e) => {
            if (conn.pending) {
              const q = conn.pending.get(topic) ?? [];
              q.push(e);
              conn.pending.set(topic, q);
            } else {
              this.send(conn, topic, e.event, e.data);
            }
          },
          error: (err: unknown) =>
            this.logger.warn(
              `토픽 ${topic} 스트림 오류: ${err instanceof Error ? err.message : String(err)}`,
            ),
        }),
      );
    }

    for (const [topic, src] of active) {
      if (conn.closed) return;
      try {
        const events = await src.snapshot();
        for (const e of events) this.send(conn, topic, e.event, e.data);
      } catch (err) {
        this.logger.warn(
          `토픽 ${topic} 스냅샷 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // 이 토픽의 스냅샷 이후 모인 변경분
      const q = conn.pending?.get(topic) ?? [];
      conn.pending?.delete(topic);
      for (const e of q) this.send(conn, topic, e.event, e.data);
    }
    const rest = conn.pending;
    conn.pending = null;
    if (rest) {
      for (const [topic, q] of rest)
        for (const e of q) this.send(conn, topic, e.event, e.data);
    }

    conn.heartbeat = setInterval(() => {
      this.send(conn, 'stream', 'stream.heartbeat', {
        serverTime: new Date().toISOString(),
      });
    }, HEARTBEAT_SEC * 1000);
    conn.heartbeat.unref();
  }

  private send(
    conn: Connection,
    topic: string,
    event: string,
    payload: unknown,
  ): void {
    if (conn.closed) return;
    conn.seq += 1;
    const envelope = {
      seq: conn.seq,
      topic,
      emittedAt: new Date().toISOString(),
      payload,
    };
    // data는 한 줄 JSON (JSON.stringify는 줄바꿈을 이스케이프한다)
    conn.res.write(`event: ${event}\ndata: ${JSON.stringify(envelope)}\n\n`);
  }

  private close(conn: Connection): void {
    if (conn.closed) return;
    conn.closed = true;
    for (const s of conn.subs) s.unsubscribe();
    conn.subs = [];
    if (conn.heartbeat) clearInterval(conn.heartbeat);
    this.connections.delete(conn);
  }

  beforeApplicationShutdown(): void {
    for (const conn of [...this.connections]) {
      this.send(conn, 'stream', 'stream.closing', { reason: 'shutdown' });
      conn.res.end();
      this.close(conn);
    }
  }
}
