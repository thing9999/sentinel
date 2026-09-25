import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { defer, merge, Observable, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
  TopicSourceProvider,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import { changeKey } from '../common/hash';
import { ClusterQueryService } from './cluster-query.service';
import { OverviewService } from './overview.service';
import { ClusterStateService } from './state/cluster-state.service';
import { CONTROL_PLANE_VOLATILE_KEYS } from './state/control-plane';
import type { ClusterView } from './state/evaluate';
import { MetricsStore } from './state/metrics-store';

const NODE_OMIT = new Set(['usage']);
// observedSec는 관측 구간이 1초마다 늘어나므로 변경 감지에서 뺀다 (화면은 restartObservation으로 표시)
const POD_OMIT = new Set([
  'usage',
  'memoryLimitPct',
  'cpuRequestPct',
  'observedSec',
]);
const NONE = new Set<string>();
/** 컨트롤 플레인 변경 감지 제외 키 — 기준과 이유는 state/control-plane.ts 참고 */
const CP_OMIT = CONTROL_PLANE_VOLATILE_KEYS;

type Entity = 'node' | 'workload' | 'pod' | 'event' | 'pvc';

/**
 * 토픽 `cluster` (docs/api/cluster-status.md 8.2).
 * 평가 결과가 나올 때마다 이전에 보낸 행과 비교해 바뀐 행만 upsert/delete로 보낸다.
 * (평가 자체가 500ms 창으로 합쳐지므로 같은 객체의 연속 변경도 합쳐진다)
 */
@Injectable()
@TopicSourceProvider()
export class ClusterTopicSource
  implements TopicSource, OnApplicationBootstrap, OnModuleDestroy
{
  readonly topic = 'cluster';
  private readonly subject = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.subject.asObservable();
  private readonly sent: Record<Entity, Map<string, string>> = {
    node: new Map(),
    workload: new Map(),
    pod: new Map(),
    event: new Map(),
    pvc: new Map(),
  };
  private summaryKey = '';
  private controlPlaneKey = '';
  private subs: Subscription[] = [];

  constructor(
    private readonly state: ClusterStateService,
    private readonly query: ClusterQueryService,
  ) {}

  onApplicationBootstrap(): void {
    this.subs.push(this.state.view$.subscribe((v) => this.diff(v)));
    this.subs.push(
      this.state.resync$.subscribe(() => {
        const payload = this.snapshotPayload(this.state.getView());
        this.subject.next({ event: 'cluster.snapshot', data: payload });
      }),
    );
  }

  onModuleDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

  snapshot(): Promise<TopicEvent[]> {
    const v = this.state.getView();
    return Promise.resolve([
      { event: 'cluster.snapshot', data: this.snapshotPayload(v) },
    ]);
  }

  private snapshotPayload(v: ClusterView) {
    this.remember(v);
    const store = this.state.store;
    return {
      sync: {
        initialSyncDone: store.initialSyncDone,
        lastSyncAt: store.lastSyncAt,
      },
      cluster: this.state.clusterInfo(),
      areas: v.areas,
      restartObservation: v.restartObservation,
      thresholds: this.query.allThresholds(),
      nodes: v.nodes,
      workloads: v.workloads,
      pods: v.pods,
      events: v.events,
      pvcs: v.pvcs,
      controlPlane: v.controlPlane,
    };
  }

  /** 스냅샷을 보낸 상태를 비교 기준으로 */
  private remember(v: ClusterView): void {
    this.sent.node = new Map(
      v.nodes.map((x) => [x.name, changeKey(x, NODE_OMIT)]),
    );
    this.sent.workload = new Map(v.workloads.map((x) => [x.key, changeKey(x)]));
    this.sent.pod = new Map(v.pods.map((x) => [x.key, changeKey(x, POD_OMIT)]));
    this.sent.event = new Map(v.events.map((x) => [x.key, changeKey(x)]));
    this.sent.pvc = new Map(v.pvcs.map((x) => [x.key, changeKey(x)]));
    this.summaryKey = this.summaryChangeKey(v);
    this.controlPlaneKey = changeKey(v.controlPlane, CP_OMIT);
  }

  private summaryChangeKey(v: ClusterView): string {
    return changeKey({
      areas: v.areas,
      obs: Math.floor(v.restartObservation.observedSec / 60),
      full: v.restartObservation.fullWindow,
    });
  }

  private diff(v: ClusterView): void {
    const emit = (event: string, data: unknown) =>
      this.subject.next({ event, data });
    const run = <T>(
      entity: Entity,
      list: T[],
      keyOf: (x: T) => string,
      omit: ReadonlySet<string>,
      del: (key: string) => unknown,
    ) => {
      const prev = this.sent[entity];
      const next = new Map<string, string>();
      for (const item of list) {
        const k = keyOf(item);
        const h = changeKey(item, omit);
        next.set(k, h);
        if (prev.get(k) !== h) emit(`cluster.${entity}.upsert`, { item });
      }
      for (const k of prev.keys()) {
        if (!next.has(k)) emit(`cluster.${entity}.delete`, del(k));
      }
      this.sent[entity] = next;
    };
    run(
      'node',
      v.nodes,
      (x) => x.name,
      NODE_OMIT,
      (name) => ({ name }),
    );
    run(
      'workload',
      v.workloads,
      (x) => x.key,
      NONE,
      (key) => {
        const [kind, namespace, ...rest] = key.split('/');
        return { key, kind, namespace, name: rest.join('/') };
      },
    );
    run(
      'pod',
      v.pods,
      (x) => x.key,
      POD_OMIT,
      (key) => {
        const [namespace, ...rest] = key.split('/');
        return { key, namespace, name: rest.join('/') };
      },
    );
    run(
      'event',
      v.events,
      (x) => x.key,
      NONE,
      (key) => ({ key }),
    );
    run(
      'pvc',
      v.pvcs,
      (x) => x.key,
      NONE,
      (key) => {
        const [namespace, ...rest] = key.split('/');
        return { key, namespace, name: rest.join('/') };
      },
    );
    // 컨트롤 플레인은 단일 객체 전체 교체 (새 토픽을 만들지 않는다 — 계약 8.2)
    const ck = changeKey(v.controlPlane, CP_OMIT);
    if (ck !== this.controlPlaneKey) {
      this.controlPlaneKey = ck;
      emit('cluster.controlplane.updated', v.controlPlane);
    }
    const sk = this.summaryChangeKey(v);
    if (sk !== this.summaryKey) {
      this.summaryKey = sk;
      emit('cluster.summary.updated', {
        areas: v.areas,
        restartObservation: v.restartObservation,
        thresholds: this.query.allThresholds(),
      });
    }
  }
}

/**
 * 토픽 `metrics` (docs/api/cluster-status.md 8.3). 수집(성공·실패)마다 metrics.updated.
 */
@Injectable()
@TopicSourceProvider()
export class MetricsTopicSource
  implements TopicSource, OnApplicationBootstrap, OnModuleDestroy
{
  readonly topic = 'metrics';
  private readonly subject = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.subject.asObservable();
  private subs: Subscription[] = [];

  constructor(
    private readonly state: ClusterStateService,
    private readonly metrics: MetricsStore,
  ) {}

  onApplicationBootstrap(): void {
    this.subs.push(
      this.metrics.collected$.subscribe(() => {
        const v = this.state.recompute();
        this.subject.next({ event: 'metrics.updated', data: this.updated(v) });
      }),
      this.state.resync$.subscribe(() => {
        this.subject.next({
          event: 'metrics.snapshot',
          data: this.snapshotPayload(this.state.getView()),
        });
      }),
    );
  }

  onModuleDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

  snapshot(): Promise<TopicEvent[]> {
    return Promise.resolve([
      {
        event: 'metrics.snapshot',
        data: this.snapshotPayload(this.state.getView()),
      },
    ]);
  }

  private rows(v: ClusterView) {
    return {
      nodes: v.nodes
        .filter((n) => n.usage)
        .map((n) => ({
          name: n.name,
          cpuMillicores: n.usage!.cpuMillicores,
          memoryBytes: n.usage!.memoryBytes,
          cpuPct: n.usage!.cpuPct,
          memoryPct: n.usage!.memoryPct,
        })),
      pods: v.pods
        .filter((p) => p.usage)
        .map((p) => ({
          key: p.key,
          cpuMillicores: p.usage!.cpuMillicores,
          memoryBytes: p.usage!.memoryBytes,
          memoryLimitPct: p.memoryLimitPct,
          cpuRequestPct: p.cpuRequestPct,
        })),
    };
  }

  private snapshotPayload(v: ClusterView) {
    const points = this.metrics.series.get('cluster').map((p) => ({
      ...p,
      t: new Date(p.t).toISOString(),
    }));
    return {
      cluster: v.metrics,
      clusterSeries: {
        stepSec: this.state.metricsIntervalSec,
        source: 'in_memory',
        observedSince: points[0]?.t ?? null,
        points,
      },
      ...this.rows(v),
    };
  }

  private updated(v: ClusterView) {
    const series = this.metrics.series.get('cluster');
    const last = series[series.length - 1];
    const m = v.metrics;
    return {
      collectedAt: this.metrics.state.collectedAt ?? v.atIso,
      available: m.available,
      unavailableReason: m.unavailableReason,
      // 계약 8.3: 사용량만 바뀐 것은 이 토픽으로 보낸다.
      // 마스터 합계(= GET /api/cluster/metrics의 controlPlane)도 여기서 갱신한다
      cluster: {
        cpu: m.cpu,
        memory: m.memory,
        controlPlane: m.controlPlane,
        scope: m.scope,
        updatedAt: m.updatedAt,
      },
      clusterPoint: last
        ? { ...last, t: new Date(last.t).toISOString() }
        : null,
      ...(m.available ? this.rows(v) : { nodes: [], pods: [] }),
    };
  }
}

/**
 * 토픽 `overview` (docs/api/cluster-status.md 8.1). 바뀌면 1초 debounce 후 overview.updated(전체 교체).
 */
@Injectable()
@TopicSourceProvider()
export class OverviewTopicSource
  implements TopicSource, OnApplicationBootstrap, OnModuleDestroy
{
  readonly topic = 'overview';
  private readonly subject = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.subject.asObservable();
  private lastKey = '';
  private subs: Subscription[] = [];

  constructor(
    private readonly state: ClusterStateService,
    private readonly overview: OverviewService,
  ) {}

  onApplicationBootstrap(): void {
    this.subs.push(
      merge(
        this.state.view$,
        defer(() => this.overview.providerChanges$),
      )
        .pipe(debounceTime(1000))
        .subscribe(() => void this.maybeEmit()),
      this.state.resync$.subscribe(() => void this.emitSnapshot()),
    );
  }

  onModuleDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

  async snapshot(): Promise<TopicEvent[]> {
    const data = await this.overview.overview();
    this.lastKey = changeKey(data);
    return [{ event: 'overview.snapshot', data }];
  }

  private async emitSnapshot(): Promise<void> {
    const [e] = await this.snapshot();
    this.subject.next(e);
  }

  private async maybeEmit(): Promise<void> {
    const data = await this.overview.overview();
    const k = changeKey(data);
    if (k === this.lastKey) return;
    this.lastKey = k;
    this.subject.next({ event: 'overview.updated', data });
  }
}
