import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Metrics } from '@kubernetes/client-node';
import { DATA_SOURCE_MODE } from '../../common/data-source';
import { SourceRegistry } from '../../common/source-registry.service';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../../config/env.validation';
import { sanitizeErrorMessage } from '../../database/health';
import { podKey } from '../model';
import { ClusterStateService } from '../state/cluster-state.service';
import { MetricsIngestor } from '../state/metrics-ingest.service';
import type { PodUsageSample, UsageSample } from '../state/metrics-store';
import { KubeClientService } from './kube-watcher.service';
import { bytes, cpuMillicores } from './quantity';

/**
 * metrics.k8s.io (metrics-server) 주기 조회 → MetricsIngestor.
 * metrics-server가 없으면 에러를 내지 않고 출처를 unavailable로 두고 사용량 필드는 null.
 * + Prometheus가 설정돼 있으면 PVC 사용량(kubelet_volume_stats_used_bytes)을 60초마다 조회.
 */
@Injectable()
export class MetricsCollectorService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MetricsCollectorService.name);
  private timer: NodeJS.Timeout | null = null;
  private promTimer: NodeJS.Timeout | null = null;
  private running = false;
  private consecutiveFailures = 0;
  private readonly intervalSec: number;
  private readonly prometheusUrl: string | null;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly client: KubeClientService,
    private readonly ingestor: MetricsIngestor,
    private readonly registry: SourceRegistry,
    private readonly state: ClusterStateService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.intervalSec = config.get('METRICS_INTERVAL_SEC', { infer: true });
    this.prometheusUrl = config.get('PROMETHEUS_URL', { infer: true }) ?? null;
  }

  onApplicationBootstrap(): void {
    if (this.mode === 'mock') return;
    this.registry.update('metrics', { intervalSec: this.intervalSec });
    if (!this.prometheusUrl) {
      this.registry.update('prometheus', { state: 'not_configured' });
    } else {
      this.registry.update('prometheus', { state: 'syncing', intervalSec: 60 });
      void this.pollPrometheus();
      this.promTimer = setInterval(() => void this.pollPrometheus(), 60_000);
      this.promTimer.unref();
    }
    if (!this.client.configured) {
      this.registry.update('metrics', { state: 'not_configured' });
      return;
    }
    if (!this.client.kc) {
      this.registry.update('metrics', {
        state: 'unavailable',
        error: {
          code: 'KUBECONFIG_INVALID',
          message: 'kubeconfig를 읽을 수 없습니다',
        },
      });
      return;
    }
    this.registry.update('metrics', { state: 'syncing' });
    // informer 최초 목록이 채워질 시간을 조금 준다
    setTimeout(() => void this.poll(), 3_000).unref();
    this.timer = setInterval(() => void this.poll(), this.intervalSec * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.promTimer) clearInterval(this.promTimer);
  }

  private async poll(): Promise<void> {
    const kc = this.client.kc;
    if (!kc || this.running) return;
    this.running = true;
    const at = Date.now();
    const atIso = new Date(at).toISOString();
    try {
      const api = new Metrics(kc);
      const [nodeList, podList] = await Promise.all([
        api.getNodeMetrics(),
        api.getPodMetrics(),
      ]);
      const nodes = new Map<string, UsageSample>();
      for (const n of nodeList.items) {
        nodes.set(n.metadata.name, {
          cpuMillicores: cpuMillicores(n.usage.cpu) ?? 0,
          memoryBytes: bytes(n.usage.memory) ?? 0,
        });
      }
      const pods = new Map<string, PodUsageSample>();
      for (const p of podList.items) {
        const containers = new Map<string, UsageSample>();
        let cpu = 0;
        let mem = 0;
        for (const c of p.containers) {
          const cc = cpuMillicores(c.usage.cpu) ?? 0;
          const cm = bytes(c.usage.memory) ?? 0;
          cpu += cc;
          mem += cm;
          containers.set(c.name, { cpuMillicores: cc, memoryBytes: cm });
        }
        pods.set(podKey(p.metadata.namespace, p.metadata.name), {
          cpuMillicores: cpu,
          memoryBytes: mem,
          containers,
        });
      }
      this.ingestor.ingest(nodes, pods, at);
      this.consecutiveFailures = 0;
      this.registry.markSuccess('metrics', atIso);
    } catch (err) {
      this.consecutiveFailures += 1;
      const status = statusOf(err);
      const reason =
        status === 404 || status === 503
          ? {
              code: 'METRICS_API_UNAVAILABLE',
              message: 'metrics.k8s.io API 없음 (metrics-server 미설치)',
            }
          : status === 403
            ? {
                code: 'METRICS_FORBIDDEN',
                message: 'metrics.k8s.io 조회 권한 없음 (RBAC 확인)',
              }
            : {
                code: 'METRICS_FETCH_FAILED',
                message: `메트릭 조회 실패: ${sanitizeErrorMessage(err, 150)}`,
              };
      const had = this.registry.get('metrics').lastSuccessAt !== null;
      // 일시 실패(직전 값 있음, 연속 3회 미만)는 값을 유지하고 stale
      const keep =
        had && status !== 404 && status !== 403 && this.consecutiveFailures < 3;
      this.ingestor.fail(reason, at, keep);
      this.registry.markFailure('metrics', reason, {
        state: keep ? 'stale' : 'unavailable',
        at: atIso,
      });
      if (this.consecutiveFailures === 1)
        this.logger.warn(`${reason.code}: ${reason.message}`);
    } finally {
      this.running = false;
    }
  }

  private async pollPrometheus(): Promise<void> {
    const base = this.prometheusUrl;
    if (!base) return;
    const at = new Date().toISOString();
    try {
      const url = new URL('/api/v1/query', base);
      url.searchParams.set(
        'query',
        'max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes)',
      );
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        status: string;
        data?: {
          result?: {
            metric: Record<string, string>;
            value: [number, string];
          }[];
        };
      };
      if (body.status !== 'success') throw new Error('prometheus query failed');
      const values = new Map<string, number>();
      for (const r of body.data?.result ?? []) {
        const ns = r.metric.namespace;
        const name = r.metric.persistentvolumeclaim;
        const v = Number(r.value?.[1]);
        if (ns && name && Number.isFinite(v)) values.set(podKey(ns, name), v);
      }
      this.state.setPvcUsageFromPrometheus(
        values.size > 0 ? { at, values } : null,
      );
      this.registry.markSuccess('prometheus', at);
    } catch (err) {
      this.registry.markFailure(
        'prometheus',
        {
          code: 'PROMETHEUS_QUERY_FAILED',
          message: `Prometheus 조회 실패: ${sanitizeErrorMessage(err, 150)}`,
        },
        { at },
      );
    }
  }
}

function statusOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; statusCode?: unknown; message?: unknown };
  if (typeof e.code === 'number') return e.code;
  if (typeof e.statusCode === 'number') return e.statusCode;
  const m =
    typeof e.message === 'string' ? /\b(40[34]|503)\b/.exec(e.message) : null;
  return m ? Number(m[1]) : null;
}
