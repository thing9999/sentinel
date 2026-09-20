import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { Status } from '../../common/status';

export interface UsageSample {
  cpuMillicores: number;
  memoryBytes: number;
}

export interface PodUsageSample extends UsageSample {
  containers: Map<string, UsageSample>;
}

export interface SeriesPoint {
  t: number;
  cpuMillicores: number | null;
  memoryBytes: number | null;
  cpuPct: number | null;
  memoryPct: number | null;
  cpuStatus: Status | null;
  memoryStatus: Status | null;
}

/** 최근 1시간 표본 (15초 × 240) */
export class SeriesBuffer {
  private readonly map = new Map<string, SeriesPoint[]>();

  constructor(
    private readonly maxAgeMs: number = 3_600_000,
    private readonly maxPoints: number = 400,
  ) {}

  push(key: string, p: SeriesPoint): void {
    let arr = this.map.get(key);
    if (!arr) {
      arr = [];
      this.map.set(key, arr);
    }
    arr.push(p);
    const cutoff = p.t - this.maxAgeMs;
    while (arr.length > 0 && (arr[0].t < cutoff || arr.length > this.maxPoints))
      arr.shift();
  }

  get(key: string): SeriesPoint[] {
    return this.map.get(key) ?? [];
  }

  has(key: string): boolean {
    return (this.map.get(key)?.length ?? 0) > 0;
  }

  /** 최근 표본이 maxAge보다 오래된 키를 지운다 (삭제된 파드 등) */
  prune(now: number): void {
    for (const [k, arr] of this.map) {
      if (arr.length === 0 || arr[arr.length - 1].t < now - this.maxAgeMs)
        this.map.delete(k);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export interface MetricsState {
  available: boolean;
  unavailableReason: { code: string; message: string } | null;
  collectedAt: string | null;
  nodes: Map<string, UsageSample>;
  pods: Map<string, PodUsageSample>;
}

/**
 * metrics.k8s.io 사용량 캐시 + 지속 조건 적용 결과 + 최근 1시간 추이.
 * live는 MetricsCollector, mock은 시뮬레이터가 `ingest()`한다.
 */
@Injectable()
export class MetricsStore {
  state: MetricsState = {
    available: false,
    unavailableReason: null,
    collectedAt: null,
    nodes: new Map(),
    pods: new Map(),
  };
  /** 지속 조건(연속 3회) 적용 결과: key → 상태 (node:cpu:<name>, pod:mem:<ns/name>, cluster:cpu ...) */
  readonly sustained = new Map<string, Status>();
  readonly series = new SeriesBuffer();
  /** 추이 표본을 처음 쌓은 시각 */
  seriesSince: number | null = null;

  private readonly collectedSubject = new Subject<void>();
  /** 수집(성공·실패) 한 번마다 */
  readonly collected$: Observable<void> = this.collectedSubject.asObservable();

  emitCollected(): void {
    this.collectedSubject.next();
  }

  reset(): void {
    this.state = {
      available: false,
      unavailableReason: null,
      collectedAt: null,
      nodes: new Map(),
      pods: new Map(),
    };
    this.sustained.clear();
    this.series.clear();
    this.seriesSince = null;
  }
}
