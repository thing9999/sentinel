import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../common/settings.service';
import { round1, SustainTracker, type Status } from '../../common/status';
import { podKey } from '../model';
import { ClusterStore } from './cluster-store';
import { isPodCompleted } from './evaluate';
import {
  MetricsStore,
  type PodUsageSample,
  type UsageSample,
} from './metrics-store';

function level(v: number, warn: number, crit: number): Status {
  if (v >= crit) return 'critical';
  if (v >= warn) return 'warning';
  return 'ok';
}

function pctOrNull(part: number, whole: number | null): number | null {
  return whole && whole > 0 ? round1((part / whole) * 100) : null;
}

/**
 * 사용량 표본 수집 결과를 MetricsStore에 반영한다 (live·mock 공용).
 * - 사용률 지표에 연속 N회 지속 조건 적용 (명세 3.0)
 * - 최근 1시간 추이 표본 추가 (클러스터·노드·파드)
 */
@Injectable()
export class MetricsIngestor {
  private readonly sustain = new SustainTracker(3);

  constructor(
    private readonly store: ClusterStore,
    private readonly metrics: MetricsStore,
    private readonly settings: SettingsService,
  ) {}

  ingest(
    nodes: Map<string, UsageSample>,
    pods: Map<string, PodUsageSample>,
    at: number,
    emit = true,
  ): void {
    const t = this.settings.peek('cluster.thresholds');
    this.sustain.setSamples(t.sustainSamples);
    const m = this.metrics;
    m.state = {
      available: true,
      unavailableReason: null,
      collectedAt: new Date(at).toISOString(),
      nodes,
      pods,
    };
    m.seriesSince ??= at;

    let allocCpu = 0;
    let allocMem = 0;
    let useCpu = 0;
    let useMem = 0;
    for (const n of this.store.nodes.values()) {
      allocCpu += n.allocatable.cpuMillicores;
      allocMem += n.allocatable.memoryBytes;
      const u = nodes.get(n.name);
      if (!u) {
        m.series.push(`node:${n.name}`, nullPoint(at));
        continue;
      }
      useCpu += u.cpuMillicores;
      useMem += u.memoryBytes;
      const cpuPct = pctOrNull(u.cpuMillicores, n.allocatable.cpuMillicores);
      const memPct = pctOrNull(u.memoryBytes, n.allocatable.memoryBytes);
      const cpuS =
        cpuPct === null
          ? 'ok'
          : this.sustain.apply(
              `node:cpu:${n.name}`,
              level(cpuPct, t.nodeCpuWarnPct, t.nodeCpuCritPct),
            );
      const memS =
        memPct === null
          ? 'ok'
          : this.sustain.apply(
              `node:mem:${n.name}`,
              level(memPct, t.nodeMemoryWarnPct, t.nodeMemoryCritPct),
            );
      m.sustained.set(`node:cpu:${n.name}`, cpuS);
      m.sustained.set(`node:mem:${n.name}`, memS);
      m.series.push(`node:${n.name}`, {
        t: at,
        cpuMillicores: Math.round(u.cpuMillicores),
        memoryBytes: Math.round(u.memoryBytes),
        cpuPct,
        memoryPct: memPct,
        cpuStatus:
          cpuPct === null
            ? null
            : level(cpuPct, t.nodeCpuWarnPct, t.nodeCpuCritPct),
        memoryStatus:
          memPct === null
            ? null
            : level(memPct, t.nodeMemoryWarnPct, t.nodeMemoryCritPct),
      });
    }

    for (const p of this.store.pods.values()) {
      if (isPodCompleted(p)) continue;
      const key = podKey(p.namespace, p.name);
      const u = pods.get(key);
      if (!u) continue;
      let limMem: number | null = 0;
      let reqCpu: number | null = 0;
      for (const c of p.containers) {
        limMem =
          limMem === null || c.limits.memoryBytes === null
            ? null
            : limMem + c.limits.memoryBytes;
        reqCpu =
          reqCpu === null || c.requests.cpuMillicores === null
            ? null
            : reqCpu + c.requests.cpuMillicores;
      }
      const memPct = pctOrNull(u.memoryBytes, limMem);
      const cpuPct = pctOrNull(u.cpuMillicores, reqCpu);
      const memS =
        memPct === null
          ? 'ok'
          : this.sustain.apply(
              `pod:mem:${key}`,
              level(memPct, t.podMemoryLimitWarnPct, t.podMemoryLimitCritPct),
            );
      m.sustained.set(`pod:mem:${key}`, memS);
      m.series.push(`pod:${key}`, {
        t: at,
        cpuMillicores: Math.round(u.cpuMillicores),
        memoryBytes: Math.round(u.memoryBytes),
        cpuPct,
        memoryPct: memPct,
        cpuStatus: null,
        memoryStatus:
          memPct === null
            ? null
            : level(memPct, t.podMemoryLimitWarnPct, t.podMemoryLimitCritPct),
      });
    }

    const cCpu = pctOrNull(useCpu, allocCpu);
    const cMem = pctOrNull(useMem, allocMem);
    m.sustained.set(
      'cluster:cpu',
      cCpu === null
        ? 'ok'
        : this.sustain.apply(
            'cluster:cpu',
            level(cCpu, t.nodeCpuWarnPct, t.nodeCpuCritPct),
          ),
    );
    m.sustained.set(
      'cluster:mem',
      cMem === null
        ? 'ok'
        : this.sustain.apply(
            'cluster:mem',
            level(cMem, t.nodeMemoryWarnPct, t.nodeMemoryCritPct),
          ),
    );
    m.series.push('cluster', {
      t: at,
      cpuMillicores: Math.round(useCpu),
      memoryBytes: Math.round(useMem),
      cpuPct: cCpu,
      memoryPct: cMem,
      cpuStatus:
        cCpu === null ? null : level(cCpu, t.nodeCpuWarnPct, t.nodeCpuCritPct),
      memoryStatus:
        cMem === null
          ? null
          : level(cMem, t.nodeMemoryWarnPct, t.nodeMemoryCritPct),
    });
    m.series.prune(at);
    if (emit) m.emitCollected();
  }

  /**
   * 수집 실패. keepValues=true면 직전 값을 유지(stale), 아니면 값을 비운다(unavailable).
   */
  fail(
    reason: { code: string; message: string },
    at: number,
    keepValues: boolean,
    emit = true,
  ): void {
    const m = this.metrics;
    if (!keepValues) {
      m.state = {
        available: false,
        unavailableReason: reason,
        collectedAt: m.state.collectedAt,
        nodes: new Map(),
        pods: new Map(),
      };
    }
    m.series.push('cluster', nullPoint(at));
    if (emit) m.emitCollected();
  }

  reset(): void {
    this.sustain.clear();
    this.metrics.reset();
  }
}

function nullPoint(at: number) {
  return {
    t: at,
    cpuMillicores: null,
    memoryBytes: null,
    cpuPct: null,
    memoryPct: null,
    cpuStatus: null,
    memoryStatus: null,
  };
}
