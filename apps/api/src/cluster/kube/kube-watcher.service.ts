import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  KubeConfig,
  makeInformer,
  VersionApi,
  type CoreV1Event,
  type Informer,
  type ObjectCache,
  type KubernetesObject,
  type V1DaemonSet,
  type V1Deployment,
  type V1Ingress,
  type V1Namespace,
  type V1Node,
  type V1PersistentVolumeClaim,
  type V1Pod,
  type V1PodDisruptionBudget,
  type V1Service,
  type V1StatefulSet,
  type V2HorizontalPodAutoscaler,
} from '@kubernetes/client-node';
import {
  DATA_SOURCE_MODE,
  isKubeConfigured,
  resolveSourceMode,
} from '../../common/data-source';
import { SourceRegistry } from '../../common/source-registry.service';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../../config/env.validation';
import { Observable, Subject } from 'rxjs';
import { sanitizeErrorMessage } from '../../database/health';
import { ClusterStateService } from '../state/cluster-state.service';
import { ClusterStore } from '../state/cluster-store';
import {
  extractDaemonSet,
  extractDeployment,
  extractEvent,
  extractHpa,
  extractIngress,
  extractNode,
  extractPdb,
  extractPod,
  extractPvc,
  extractService,
  extractStatefulSet,
} from './extract';
import { makeRawLister } from './raw-list';

/** 드리프트 등이 읽는 informer 캐시 (원본 JSON, 읽기 전용. 절대 바꾸지 않는다) */
export interface InformerCacheView {
  /** 캐시 객체 전체. 목록 항목에는 apiVersion/kind 가 없을 수 있다 */
  list(): readonly KubernetesObject[];
  synced: boolean;
  forbidden: boolean;
  connected: boolean;
}

interface InformerState {
  name: string;
  /** 필수(노드·파드 등)가 끊기면 kube 출처 전체가 stale */
  required: boolean;
  informer: Informer<KubernetesObject> & ObjectCache<KubernetesObject>;
  connected: boolean;
  synced: boolean;
  failures: number;
  forbidden: boolean;
  restartTimer: NodeJS.Timeout | null;
}

/**
 * 쿠버네티스 연결 (읽기 전용: list/watch만). 클러스터 안에서는 loadFromCluster(), 로컬은 loadFromDefault().
 * live 모드 + 연결 설정이 있을 때만 동작한다.
 */
@Injectable()
export class KubeClientService {
  readonly kc: KubeConfig | null;
  readonly configured: boolean;
  readonly error: string | null;

  constructor(
    @Inject(DATA_SOURCE_MODE) mode: DataSourceMode,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.configured = isKubeConfigured({
      KUBECONFIG: config.get('KUBECONFIG', { infer: true }),
      KUBERNETES_SERVICE_HOST: process.env.KUBERNETES_SERVICE_HOST,
    });
    let kc: KubeConfig | null = null;
    let error: string | null = null;
    if (resolveSourceMode(mode, this.configured) === 'live') {
      try {
        kc = new KubeConfig();
        if (process.env.KUBERNETES_SERVICE_HOST) kc.loadFromCluster();
        else kc.loadFromDefault();
        if (!kc.getCurrentCluster()) {
          error = 'kubeconfig에 현재 클러스터가 없습니다';
          kc = null;
        }
      } catch (err) {
        error = sanitizeErrorMessage(err);
        kc = null;
      }
    }
    this.kc = kc;
    this.error = error;
  }

  /**
   * kubeconfig 현재 클러스터 이름 (kOps는 보통 FQDN: `prod.k8s.example.com`).
   * 표시 이름은 `K8S_CLUSTER_NAME`이 있으면 그 값이 우선한다.
   */
  clusterName(): string | null {
    return this.kc?.getCurrentCluster()?.name ?? null;
  }
}

const HEARTBEAT_MS = 15_000;

/**
 * informer(Watch)로 쿠버네티스 상태를 ClusterStore에 유지한다.
 * - 끊기면(ERROR) 해당 informer를 백오프(3초→최대 30초)로 재시작하고 kube 출처를 stale로 표시
 * - 모두 다시 연결되면 ok로 되돌리고 전체 스냅샷 재전송을 요청
 * - 권한 없음(403)인 선택 리소스(PDB·HPA·인그레스 등)는 kube 출처를 막지 않고 5분마다 다시 시도
 */
@Injectable()
export class KubeWatcherService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(KubeWatcherService.name);
  private readonly informers: InformerState[] = [];
  private heartbeat: NodeJS.Timeout | null = null;
  private stopped = false;
  private wasStale = false;
  private readonly objectChanges = new Subject<string>();
  /** informer 이름(예: deployments) — 객체 추가·수정·삭제 알림 */
  readonly objectChanges$: Observable<string> =
    this.objectChanges.asObservable();

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly client: KubeClientService,
    private readonly store: ClusterStore,
    private readonly state: ClusterStateService,
    private readonly registry: SourceRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if (this.mode === 'mock') return;
    const now = new Date().toISOString();
    if (!this.client.configured) {
      this.registry.update('kube', {
        state: 'not_configured',
        lastAttemptAt: now,
        error: null,
      });
      return;
    }
    const kc = this.client.kc;
    if (!kc) {
      this.registry.update('kube', {
        state: 'unavailable',
        lastAttemptAt: now,
        error: {
          code: 'KUBECONFIG_INVALID',
          message: this.client.error ?? 'kubeconfig를 읽을 수 없습니다',
        },
      });
      return;
    }
    this.registry.update('kube', {
      state: 'syncing',
      lastAttemptAt: now,
      error: null,
    });
    this.store.info = {
      name: this.client.clusterName(),
      version: null,
      // 리전은 노드 라벨(topology.kubernetes.io/region)에서 채운다 (ClusterStateService.clusterInfo)
      region: null,
    };
    void this.loadVersion(kc);
    this.setupInformers(kc);
    // 모든 informer를 병렬로 시작 (목록 → watch)
    void Promise.all(this.informers.map((s) => this.startInformer(s))).then(
      () => this.checkSynced(),
    );
    this.heartbeat = setInterval(() => this.onHeartbeat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const s of this.informers) {
      if (s.restartTimer) clearTimeout(s.restartTimer);
      await s.informer.stop().catch(() => undefined);
    }
  }

  private async loadVersion(kc: KubeConfig): Promise<void> {
    try {
      const v = await kc.makeApiClient(VersionApi).getCode();
      const m = /^v\d+\.\d+\.\d+/.exec(v.gitVersion ?? '');
      this.store.info = {
        ...this.store.info,
        version: m ? m[0] : (v.gitVersion ?? null),
      };
      this.store.notify('info');
    } catch (err) {
      this.logger.warn(`API 서버 버전 조회 실패: ${sanitizeErrorMessage(err)}`);
    }
  }

  private setupInformers(kc: KubeConfig): void {
    const store = this.store;

    /**
     * 목록은 원본 JSON 목록 함수(makeRawLister)로 받는다 — watch 이벤트와 같은 모양 (k8s-snapshot.md 10.1).
     * extract*() 는 시각을 Date/문자열 모두 받으므로 화면용 값은 같다.
     */
    const add = <T extends KubernetesObject>(
      name: string,
      required: boolean,
      path: string,
      upsert: (o: T) => void,
      remove: (o: T) => void,
    ) => {
      const informer = makeInformer<T>(kc, path, makeRawLister<T>(kc, path));
      const changed = () => this.objectChanges.next(name);
      informer.on('add', (o) => {
        upsert(o);
        changed();
      });
      informer.on('update', (o) => {
        upsert(o);
        changed();
      });
      informer.on('delete', (o) => {
        remove(o);
        changed();
      });
      const st: InformerState = {
        name,
        required,
        informer: informer,
        connected: false,
        synced: false,
        failures: 0,
        forbidden: false,
        restartTimer: null,
      };
      informer.on('error', (err: unknown) => this.onInformerError(st, err));
      informer.on('connect', () => {
        st.connected = true;
      });
      this.informers.push(st);
    };

    const ns = (o: KubernetesObject) => o.metadata?.namespace ?? '';
    const nm = (o: KubernetesObject) => o.metadata?.name ?? '';

    add<V1Node>(
      'nodes',
      true,
      '/api/v1/nodes',
      (o) => store.upsertNode(extractNode(o)),
      (o) => store.deleteNode(nm(o)),
    );
    add<V1Pod>(
      'pods',
      true,
      '/api/v1/pods',
      (o) => store.upsertPod(extractPod(o)),
      (o) => store.deletePod(ns(o), nm(o)),
    );
    add<CoreV1Event>(
      'events',
      true,
      '/api/v1/events',
      (o) => {
        const e = extractEvent(o);
        if (e) store.upsertEvent(e);
      },
      (o) => store.deleteEvent(o.metadata?.uid ?? `${ns(o)}/${nm(o)}`),
    );
    add<V1PersistentVolumeClaim>(
      'persistentvolumeclaims',
      true,
      '/api/v1/persistentvolumeclaims',
      (o) => store.upsertPvc(extractPvc(o)),
      (o) => store.deletePvc(ns(o), nm(o)),
    );
    add<V1Namespace>(
      'namespaces',
      false,
      '/api/v1/namespaces',
      (o) => store.upsertNamespace(nm(o)),
      (o) => store.deleteNamespace(nm(o)),
    );
    add<V1Service>(
      'services',
      false,
      '/api/v1/services',
      (o) => store.upsertKeyed('services', extractService(o)),
      (o) => store.deleteKeyed('services', ns(o), nm(o)),
    );
    add<V1Deployment>(
      'deployments',
      true,
      '/apis/apps/v1/deployments',
      (o) => store.upsertWorkload(extractDeployment(o)),
      (o) => store.deleteWorkload('Deployment', ns(o), nm(o)),
    );
    add<V1StatefulSet>(
      'statefulsets',
      true,
      '/apis/apps/v1/statefulsets',
      (o) => store.upsertWorkload(extractStatefulSet(o)),
      (o) => store.deleteWorkload('StatefulSet', ns(o), nm(o)),
    );
    add<V1DaemonSet>(
      'daemonsets',
      false,
      '/apis/apps/v1/daemonsets',
      (o) => store.upsertWorkload(extractDaemonSet(o)),
      (o) => store.deleteWorkload('DaemonSet', ns(o), nm(o)),
    );
    add<V1Ingress>(
      'ingresses',
      false,
      '/apis/networking.k8s.io/v1/ingresses',
      (o) => store.upsertKeyed('ingresses', extractIngress(o)),
      (o) => store.deleteKeyed('ingresses', ns(o), nm(o)),
    );
    add<V1PodDisruptionBudget>(
      'poddisruptionbudgets',
      false,
      '/apis/policy/v1/poddisruptionbudgets',
      (o) => store.upsertKeyed('pdbs', extractPdb(o)),
      (o) => store.deleteKeyed('pdbs', ns(o), nm(o)),
    );
    add<V2HorizontalPodAutoscaler>(
      'horizontalpodautoscalers',
      false,
      '/apis/autoscaling/v2/horizontalpodautoscalers',
      (o) => store.upsertKeyed('hpas', extractHpa(o)),
      (o) => store.deleteKeyed('hpas', ns(o), nm(o)),
    );
  }

  private async startInformer(s: InformerState): Promise<void> {
    if (this.stopped) return;
    const failuresBefore = s.failures;
    try {
      await s.informer.start();
    } catch (err) {
      this.onInformerError(s, err);
      return;
    }
    // start()는 목록 실패 시에도 ERROR 콜백 후 resolve될 수 있다
    if (s.failures === failuresBefore) {
      s.synced = true;
      s.connected = true;
      s.forbidden = false;
    }
  }

  private onInformerError(s: InformerState, err: unknown): void {
    if (this.stopped) return;
    s.connected = false;
    s.failures += 1;
    const status = statusCodeOf(err);
    s.forbidden = status === 403;
    const msg = sanitizeErrorMessage(err);
    this.logger.warn(`${s.name} watch 오류 (${s.failures}회째): ${msg}`);
    if (s.required || !s.forbidden) {
      if (s.required) {
        const hadData = this.store.initialSyncDone;
        this.registry.markFailure(
          'kube',
          {
            code: status === 403 ? 'KUBE_FORBIDDEN' : 'WATCH_DISCONNECTED',
            message:
              status === 403
                ? `${s.name} 조회 권한 없음 (RBAC 확인)`
                : `${s.name} watch 연결 끊김, 재시작 중 (${s.failures}회째)`,
          },
          { state: hadData ? 'stale' : 'unavailable' },
        );
        if (hadData) this.wasStale = true;
      }
    }
    const delay = s.forbidden
      ? 300_000
      : Math.min(30_000, 3_000 * 2 ** Math.min(4, s.failures - 1));
    if (s.restartTimer) clearTimeout(s.restartTimer);
    s.restartTimer = setTimeout(() => {
      s.restartTimer = null;
      void this.startInformer(s).then(() => this.checkSynced());
    }, delay);
    s.restartTimer.unref();
  }

  private checkSynced(): void {
    const required = this.informers.filter((s) => s.required);
    const ok = required.every((s) => s.synced && s.connected);
    if (!ok) return;
    const now = new Date().toISOString();
    const first = !this.store.initialSyncDone;
    this.store.initialSyncDone = true;
    this.store.lastSyncAt = now;
    this.registry.markSuccess('kube', now);
    if (first || this.wasStale) {
      this.wasStale = false;
      this.logger.log(
        first
          ? '쿠버네티스 최초 동기화 완료'
          : '쿠버네티스 watch 재연결 (재동기화)',
      );
      this.state.requestResync();
    }
  }

  private onHeartbeat(): void {
    const required = this.informers.filter((s) => s.required);
    if (required.every((s) => s.synced && s.connected)) {
      this.checkSynced();
    }
  }

  /** 드리프트용: informer 캐시 읽기 (이름: deployments, services …). 없으면 null */
  cacheOf(name: string): InformerCacheView | null {
    const s = this.informers.find((x) => x.name === name);
    if (!s) return null;
    return {
      list: () => s.informer.list(),
      synced: s.synced,
      forbidden: s.forbidden,
      connected: s.connected,
    };
  }

  /** health용: informer 상태 요약 */
  informerSummary(): {
    name: string;
    connected: boolean;
    forbidden: boolean;
  }[] {
    return this.informers.map((s) => ({
      name: s.name,
      connected: s.connected,
      forbidden: s.forbidden,
    }));
  }
}

function statusCodeOf(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: unknown; statusCode?: unknown; status?: unknown };
  for (const v of [e.code, e.statusCode, e.status]) {
    if (typeof v === 'number') return v;
  }
  return null;
}
