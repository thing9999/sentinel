import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DATA_SOURCE_MODE } from '../../common/data-source';
import {
  MockScenarioTargetProvider,
  type MockScenarioTarget,
} from '../../common/extension-points';
import { SourceRegistry } from '../../common/source-registry.service';
import type { DataSourceMode } from '../../config/env.validation';
import { podKey } from '../model';
import { ClusterStateService } from '../state/cluster-state.service';
import { ClusterStore } from '../state/cluster-store';
import { MetricsIngestor } from '../state/metrics-ingest.service';
import type { PodUsageSample, UsageSample } from '../state/metrics-store';
import {
  buildMockWorld,
  CLUSTER_SCENARIOS,
  podMemLimitOf,
  type ClusterScenario,
  type MockWorld,
} from './mock-world';

const TICK_MS = 15_000;
const BACKFILL_MIN = 60;

/**
 * mock 클러스터 시뮬레이터 (DATA_SOURCE=mock).
 * - 시나리오(ok/warning/critical 등)별 가짜 클러스터를 ClusterStore에 채운다.
 * - 15초마다 사용량이 조금씩 흔들리고, CrashLoop 파드는 가끔 재시작하며 이벤트 횟수가 늘어난다.
 * - 시작·시나리오 변경 시 최근 1시간 추이를 미리 채운다.
 */
@Injectable()
@MockScenarioTargetProvider()
export class MockClusterService
  implements MockScenarioTarget, OnModuleInit, OnModuleDestroy
{
  readonly group = 'cluster' as const;
  readonly scenarios: readonly string[] = CLUSTER_SCENARIOS;
  private scenario: ClusterScenario = 'mixed';
  private world: MockWorld | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private readonly logger = new Logger(MockClusterService.name);

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly store: ClusterStore,
    private readonly state: ClusterStateService,
    private readonly ingestor: MetricsIngestor,
    private readonly registry: SourceRegistry,
  ) {}

  onModuleInit(): void {
    if (this.mode !== 'mock') return;
    this.apply(this.scenario, false);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  currentScenario(): string {
    return this.scenario;
  }

  setScenario(name: string): void {
    if (!(CLUSTER_SCENARIOS as readonly string[]).includes(name)) {
      throw new Error(`unknown cluster scenario: ${name}`);
    }
    if (this.mode !== 'mock') return;
    this.scenario = name as ClusterScenario;
    this.apply(this.scenario, true);
  }

  private apply(s: ClusterScenario, resync: boolean): void {
    const now = Date.now();
    const w = buildMockWorld(s, now);
    this.world = w;
    this.tickCount = 0;
    const store = this.store;
    store.clearAll();
    this.state.resetTracking();
    this.ingestor.reset();
    store.info =
      s === 'no-cluster'
        ? { name: null, version: null, region: null }
        : { ...w.info };
    for (const n of w.namespaces) store.namespaces.add(n);
    for (const n of w.nodes) store.nodes.set(n.name, n);
    for (const x of w.workloads)
      store.workloads.set(`${x.kind}/${x.namespace}/${x.name}`, x);
    for (const p of w.pods) store.pods.set(podKey(p.namespace, p.name), p);
    for (const e of w.events) store.events.set(e.uid, e);
    for (const p of w.pvcs) store.pvcs.set(podKey(p.namespace, p.name), p);
    for (const x of w.services)
      store.services.set(podKey(x.namespace, x.name), x);
    for (const x of w.ingresses)
      store.ingresses.set(podKey(x.namespace, x.name), x);
    for (const x of w.pdbs) store.pdbs.set(podKey(x.namespace, x.name), x);
    for (const x of w.hpas) store.hpas.set(podKey(x.namespace, x.name), x);
    store.initialSyncDone = s !== 'no-cluster';
    store.lastSyncAt = new Date(now).toISOString();

    // 재시작·OOM 이력 (최근 1시간에 보이도록)
    for (const p of w.pods) {
      const key = podKey(p.namespace, p.name);
      const plan = w.podPlans.get(key);
      if (!plan) continue;
      if (plan.crashLoop) {
        const lim = podMemLimitOf(p);
        if (lim) plan.mem = lim * 0.973;
      }
      if (!plan.restartMinutesAgo?.length && !plan.oomMinutesAgo?.length)
        continue;
      const total = p.containers.reduce(
        (a, c) => a + (c.status?.restartCount ?? 0),
        0,
      );
      store.history.seed(key, {
        baselineAt: now - 2 * 3_600_000,
        currentTotal: total,
        restartAt: [...(plan.restartMinutesAgo ?? [])]
          .sort((a, b) => b - a)
          .map((m) => now - m * 60_000),
        oomAt: (plan.oomMinutesAgo ?? []).map((m) => now - m * 60_000),
      });
    }

    // 출처 상태
    const at = new Date(now).toISOString();
    if (s === 'no-cluster') {
      this.registry.update('kube', {
        state: 'not_configured',
        error: null,
        lastSuccessAt: null,
        lastAttemptAt: at,
      });
      this.registry.update('metrics', {
        state: 'not_configured',
        error: null,
        lastSuccessAt: null,
        lastAttemptAt: at,
      });
    } else if (s === 'kube-stale') {
      this.registry.update('kube', {
        state: 'stale',
        lastSuccessAt: new Date(now - 50_000).toISOString(),
        lastAttemptAt: at,
        error: {
          code: 'WATCH_DISCONNECTED',
          message: 'pods watch 연결 끊김, 재시작 중 (2회째)',
        },
      });
      this.registry.update('metrics', {
        state: 'mock',
        error: null,
        lastSuccessAt: at,
        lastAttemptAt: at,
      });
    } else {
      this.registry.update('kube', {
        state: 'mock',
        error: null,
        lastSuccessAt: at,
        lastAttemptAt: at,
      });
      this.registry.update('metrics', {
        state: 'mock',
        error: null,
        lastSuccessAt: at,
        lastAttemptAt: at,
      });
    }

    // 최근 1시간 추이 채우기
    if (s !== 'no-cluster') {
      for (let i = (BACKFILL_MIN * 60_000) / TICK_MS; i >= 0; i--) {
        this.collect(now - i * TICK_MS, i === 0);
      }
    }
    store.notify('all');
    this.logger.log(`mock 클러스터 시나리오: ${s}`);
    if (resync) this.state.requestResync();
  }

  private collect(at: number, emit = true): void {
    const w = this.world;
    if (!w) return;
    if (this.scenario === 'no-cluster') return;
    if (this.scenario === 'no-metrics') {
      this.ingestor.fail(
        {
          code: 'METRICS_API_UNAVAILABLE',
          message: 'metrics.k8s.io API 없음 (metrics-server 미설치)',
        },
        at,
        false,
        emit,
      );
      this.registry.update('metrics', {
        state: 'unavailable',
        lastAttemptAt: new Date(at).toISOString(),
        error: {
          code: 'METRICS_API_UNAVAILABLE',
          message: 'metrics.k8s.io API 없음 (metrics-server 미설치)',
        },
      });
      return;
    }
    const phase = at / 60_000;
    const nodes = new Map<string, UsageSample>();
    for (const n of this.store.nodes.values()) {
      const target = w.nodeUsage.get(n.name);
      if (!target) continue;
      const ready =
        n.conditions.find((c) => c.type === 'Ready')?.value === 'True';
      if (!ready) continue; // NotReady 노드는 metrics-server가 값을 못 준다
      const wave = Math.sin(phase / 7 + n.name.length) * 3;
      const cpuPct = clamp(target.cpuPct + wave + noise(2.5), 1, 99);
      const memPct = clamp(target.memPct + wave / 2 + noise(1.2), 1, 99);
      nodes.set(n.name, {
        cpuMillicores: (n.allocatable.cpuMillicores * cpuPct) / 100,
        memoryBytes: (n.allocatable.memoryBytes * memPct) / 100,
      });
    }
    const pods = new Map<string, PodUsageSample>();
    for (const p of this.store.pods.values()) {
      if (p.phase !== 'Running' || !p.nodeName || !nodes.has(p.nodeName))
        continue;
      const key = podKey(p.namespace, p.name);
      const plan = w.podPlans.get(key);
      if (!plan) continue;
      const cpu = Math.max(1, plan.cpu * (1 + noise(0.15)));
      const mem = Math.max(1024 * 1024, plan.mem * (1 + noise(0.012)));
      const containers = new Map<string, UsageSample>();
      const share = 1 / Math.max(1, p.containers.length);
      p.containers.forEach((c, i) => {
        const weight = p.containers.length > 1 ? (i === 0 ? 0.8 : 0.2) : share;
        containers.set(c.name, {
          cpuMillicores: cpu * weight,
          memoryBytes: mem * weight,
        });
      });
      pods.set(key, { cpuMillicores: cpu, memoryBytes: mem, containers });
    }
    this.ingestor.ingest(nodes, pods, at, emit);
    if (this.scenario !== 'kube-stale')
      this.registry.update('metrics', {
        state: 'mock',
        lastSuccessAt: new Date(at).toISOString(),
        lastAttemptAt: new Date(at).toISOString(),
        error: null,
      });
  }

  /** 15초마다: 흔들림, CrashLoop 재시작, 이벤트 반복 */
  private tick(): void {
    const w = this.world;
    if (!w) return;
    this.tickCount += 1;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    if (this.scenario !== 'kube-stale' && this.scenario !== 'no-cluster') {
      for (const p of this.store.pods.values()) {
        const plan = w.podPlans.get(podKey(p.namespace, p.name));
        if (!plan?.crashLoop) continue;
        // 약 5분에 한 번 재시작 (파드마다 위상을 다르게)
        if ((this.tickCount + p.name.length) % 20 !== 0) continue;
        const c = p.containers[0];
        if (!c.status) continue;
        c.status = {
          ...c.status,
          restartCount: c.status.restartCount + 1,
          lastTermination: {
            reason: c.status.lastTermination?.reason ?? 'Error',
            exitCode: c.status.lastTermination?.exitCode ?? 1,
            startedAt: new Date(now - 12_000).toISOString(),
            finishedAt: nowIso,
          },
        };
        this.store.pods.set(podKey(p.namespace, p.name), { ...p });
      }
      for (const e of this.store.events.values()) {
        if (e.reason === 'BackOff' || e.reason === 'Unhealthy') {
          this.store.events.set(e.uid, {
            ...e,
            count: e.count + 1,
            lastSeenAt: nowIso,
          });
        } else if (
          e.reason === 'FailedScheduling' &&
          this.tickCount % 4 === 0
        ) {
          this.store.events.set(e.uid, {
            ...e,
            count: e.count + 1,
            lastSeenAt: nowIso,
          });
        }
      }
      this.store.lastSyncAt = nowIso;
      this.registry.update('kube', {
        lastSuccessAt: nowIso,
        lastAttemptAt: nowIso,
      });
    }
    this.collect(now);
    this.store.notify('pods');
  }
}

function noise(scale: number): number {
  return (Math.random() * 2 - 1) * scale;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
