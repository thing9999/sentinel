import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, type Subscription } from 'rxjs';
import {
  KubeClientService,
  KubeWatcherService,
} from '../../cluster/kube/kube-watcher.service';
import { ClusterStore } from '../../cluster/state/cluster-store';
import { DATA_SOURCE_MODE } from '../../common/data-source';
import {
  SourceRegistry,
  type SourceState,
} from '../../common/source-registry.service';
import type { DataSourceMode } from '../../config/env.validation';
import { MOCK_CLUSTER_ID } from '../k8s.constants';
import { COMPARABLE_IDS, COMPARABLE_KINDS } from './comparable-kinds';
import { buildMockClusterObjects } from './mock-cluster-objects';

export interface ClusterSourceState {
  source: SourceState;
  /** kube-system Namespace uid. 모르면 null */
  clusterId: string | null;
  /** namespaces informer 권한 거부 (대시보드 클러스터 ID 를 알 수 없음) */
  namespacesForbidden: boolean;
  context: string | null;
  name: string | null;
  serverVersion: string | null;
  /** 비교 가능 종류 informer 가 모두 한 번 이상 동기화 (권한 거부 종류는 제외) */
  synced: boolean;
}

export type KindState = 'ok' | 'forbidden' | 'syncing';

/**
 * 드리프트의 클러스터 쪽 값 (docs/api/k8s-snapshot.md 10.1).
 * - live: 기존 informer 의 ListWatch 캐시를 읽기만 한다. informer·API 호출·RBAC 를 추가하지 않는다 (AC-K34)
 * - mock: cluster mock 인벤토리로 만든 원본 모양 객체 (14.3)
 * 돌려주는 객체는 캐시 그 자체이므로 절대 바꾸지 않는다 (드리프트 엔진은 cleanObject 로 복사본을 만든다).
 */
@Injectable()
export class ClusterObjectSource implements OnModuleDestroy {
  private readonly changes = new Subject<string>();
  /** 비교 가능 종류 ID 또는 'all' */
  readonly changes$: Observable<string> = this.changes.asObservable();
  private readonly subs: Subscription[] = [];
  private mockCache: Map<string, Record<string, unknown>[]> | null = null;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly registry: SourceRegistry,
    private readonly store: ClusterStore,
    private readonly watcher: KubeWatcherService,
    private readonly client: KubeClientService,
  ) {
    if (mode === 'mock') {
      const map: Record<string, string[]> = {
        workloads: ['deployments', 'statefulsets', 'daemonsets'],
        services: ['services'],
        ingresses: ['ingresses'],
        pvcs: ['persistentvolumeclaims'],
        pdbs: ['poddisruptionbudgets'],
        hpas: ['horizontalpodautoscalers'],
        namespaces: ['namespaces'],
      };
      this.subs.push(
        store.changes$.subscribe((c) => {
          if (c.resource === 'all') {
            this.mockCache = null;
            this.changes.next('all');
            return;
          }
          const ids = map[c.resource];
          if (!ids) return;
          this.mockCache = null;
          for (const id of ids) this.changes.next(id);
        }),
      );
    } else {
      this.subs.push(
        watcher.objectChanges$.subscribe((name) => {
          if (COMPARABLE_IDS.has(name)) this.changes.next(name);
        }),
      );
    }
    this.subs.push(
      registry.changes$.subscribe((s) => {
        if (s.id === 'kube') this.changes.next('source');
      }),
    );
  }

  onModuleDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

  state(): ClusterSourceState {
    const source = this.registry.get('kube').state;
    if (this.mode === 'mock') {
      const has = this.store.namespaces.has('kube-system');
      return {
        source,
        clusterId: has ? MOCK_CLUSTER_ID : null,
        namespacesForbidden: false,
        context: this.store.info.name,
        name: this.store.info.name,
        serverVersion: this.store.info.version,
        synced: this.store.initialSyncDone,
      };
    }
    const ns = this.watcher.cacheOf('namespaces');
    let clusterId: string | null = null;
    if (ns && ns.synced && !ns.forbidden) {
      const ks = ns.list().find((o) => o.metadata?.name === 'kube-system');
      clusterId =
        typeof ks?.metadata?.uid === 'string' ? ks.metadata.uid : null;
    }
    const synced = COMPARABLE_KINDS.every((k) => {
      const c = this.watcher.cacheOf(k.id);
      return !c || c.forbidden || c.synced;
    });
    const ctx = this.client.kc?.getCurrentContext() ?? null;
    return {
      source,
      clusterId,
      namespacesForbidden: ns?.forbidden ?? false,
      context: ctx ? (/cluster\/([^/]+)$/.exec(ctx)?.[1] ?? ctx) : null,
      name: this.client.clusterName(),
      serverVersion: this.store.info.version,
      synced,
    };
  }

  kindState(kindId: string): KindState {
    if (this.mode === 'mock') return 'ok';
    const c = this.watcher.cacheOf(kindId);
    if (!c) return 'forbidden';
    if (c.forbidden) return 'forbidden';
    return c.synced ? 'ok' : 'syncing';
  }

  /** 원본 JSON 목록 (읽기 전용) */
  list(kindId: string): readonly unknown[] {
    if (this.mode === 'mock') {
      this.mockCache ??= buildMockClusterObjects(
        {
          namespaces: [...this.store.namespaces],
          workloads: [...this.store.workloads.values()],
          services: [...this.store.services.values()],
          ingresses: [...this.store.ingresses.values()],
          pvcs: [...this.store.pvcs.values()],
          pdbs: [...this.store.pdbs.values()],
          hpas: [...this.store.hpas.values()],
        },
        MOCK_CLUSTER_ID,
      );
      return this.mockCache.get(kindId) ?? [];
    }
    const c = this.watcher.cacheOf(kindId);
    return c && !c.forbidden ? c.list() : [];
  }
}
