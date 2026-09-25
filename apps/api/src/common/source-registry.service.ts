import { Inject, Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { DataSourceMode } from '../config/env.validation';
import { DATA_SOURCE_MODE } from './data-source';

/** 데이터 출처 (docs/api/common.md 2.3) */
export type SourceId =
  | 'kube'
  | 'metrics'
  | 'prometheus'
  | 'monitoredDb'
  | 'awsResources'
  | 'pricing'
  | 'spotPrice'
  | 'costExplorer'
  | 'agentBridge'
  | 'dashboardDb'
  | 'snapshotStore'
  | 'k8sSnapshotStore'
  /** 외부 로그 스택 (logs L2). **비어 있는 것은 오류가 아니다** — `not_configured`는 degraded가 아니다 */
  | 'logBackend';

export const SOURCE_IDS: readonly SourceId[] = [
  'kube',
  'metrics',
  'prometheus',
  'monitoredDb',
  'awsResources',
  'pricing',
  'spotPrice',
  'costExplorer',
  'agentBridge',
  'dashboardDb',
  'snapshotStore',
  'k8sSnapshotStore',
  'logBackend',
];

export type SourceState =
  'ok' | 'syncing' | 'stale' | 'unavailable' | 'not_configured' | 'mock';

export interface SourceStatus {
  id: SourceId;
  state: SourceState;
  intervalSec: number | null;
  staleAfterSec: number | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  error: { code: string; message: string } | null;
}

/** 출처별 기본 갱신 주기 (초). staleAfterSec = × 3 */
const DEFAULT_INTERVAL: Record<SourceId, number | null> = {
  kube: 15,
  metrics: 15,
  prometheus: 15,
  monitoredDb: 15,
  awsResources: 300,
  pricing: 86400,
  spotPrice: 3600,
  costExplorer: 21600,
  agentBridge: 30,
  dashboardDb: null,
  snapshotStore: 10,
  k8sSnapshotStore: 10,
  // 로그 화면을 보고 있을 때만 확인한다 (어드바이저 브리지와 같은 성격)
  logBackend: 30,
};

/** ×3 규칙의 예외 (aws-snapshot-manager.md 14절: 스냅샷 폴더 stale 90초) */
const STALE_AFTER_OVERRIDE: Partial<Record<SourceId, number>> = {
  snapshotStore: 90,
  k8sSnapshotStore: 90,
};

export type SourcePatch = Partial<Omit<SourceStatus, 'id'>>;

/**
 * 출처 상태 저장소 (프로세스 전역).
 * - 모든 모듈이 자기 출처 상태를 `update()`로 올린다.
 * - 상태(state) 또는 오류가 바뀌면 `changes$`로 알린다 → 스트림이 `stream.source`로 보낸다.
 * - mock 모드에서는 초기 상태가 모두 `mock`.
 */
@Injectable()
export class SourceRegistry {
  private readonly sources = new Map<SourceId, SourceStatus>();
  private readonly changesSubject = new Subject<SourceStatus>();
  readonly changes$: Observable<SourceStatus> =
    this.changesSubject.asObservable();

  constructor(@Inject(DATA_SOURCE_MODE) readonly mode: DataSourceMode) {
    const now = new Date().toISOString();
    for (const id of SOURCE_IDS) {
      const interval = DEFAULT_INTERVAL[id];
      this.sources.set(id, {
        id,
        state: mode === 'mock' ? 'mock' : 'not_configured',
        intervalSec: interval,
        staleAfterSec:
          STALE_AFTER_OVERRIDE[id] ?? (interval === null ? null : interval * 3),
        lastSuccessAt: mode === 'mock' ? now : null,
        lastAttemptAt: mode === 'mock' ? now : null,
        error: null,
      });
    }
  }

  get(id: SourceId): SourceStatus {
    return { ...this.sources.get(id)! };
  }

  list(): SourceStatus[] {
    return SOURCE_IDS.map((id) => this.get(id));
  }

  /** 상태를 바꾼다. state·error가 바뀌면 변경 이벤트를 낸다. 바뀐 경우 true */
  update(id: SourceId, patch: SourcePatch): boolean {
    const cur = this.sources.get(id)!;
    const next: SourceStatus = { ...cur, ...patch, id };
    if (patch.intervalSec !== undefined && patch.staleAfterSec === undefined) {
      next.staleAfterSec =
        patch.intervalSec === null ? null : patch.intervalSec * 3;
    }
    this.sources.set(id, next);
    const changed =
      cur.state !== next.state ||
      (cur.error?.code ?? null) !== (next.error?.code ?? null) ||
      (cur.error?.message ?? null) !== (next.error?.message ?? null);
    if (changed) this.changesSubject.next({ ...next });
    return changed;
  }

  /** 성공 표시 (state ok, 오류 지움) */
  markSuccess(id: SourceId, at: string = new Date().toISOString()): boolean {
    const cur = this.sources.get(id)!;
    return this.update(id, {
      state: cur.state === 'mock' ? 'mock' : 'ok',
      lastSuccessAt: at,
      lastAttemptAt: at,
      error: null,
    });
  }

  /** 실패 표시. 이미 값이 있었으면 stale, 없었으면 unavailable */
  markFailure(
    id: SourceId,
    error: { code: string; message: string },
    opts: { state?: SourceState; at?: string } = {},
  ): boolean {
    const cur = this.sources.get(id)!;
    const at = opts.at ?? new Date().toISOString();
    const state =
      opts.state ?? (cur.lastSuccessAt !== null ? 'stale' : 'unavailable');
    return this.update(id, { state, lastAttemptAt: at, error });
  }

  isStale(id: SourceId): boolean {
    return this.sources.get(id)!.state === 'stale';
  }
}
