import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { merge, Observable, Subject, Subscription } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { LogLinkPolicy } from '../../common/log-link-policy.service';
import { SettingsService } from '../../common/settings.service';
import {
  SourceRegistry,
  type SourceState,
} from '../../common/source-registry.service';
import { StatusChangeTracker } from '../../common/status';
import type { EnvironmentVariables } from '../../config/env.validation';
import { podKey, type NodeRole, type RawPod } from '../model';
import type { ClusterInfo, DbAreaProvider } from '../types';
import { ClusterStore } from './cluster-store';
import {
  evaluateCluster,
  isPodCompleted,
  type ClusterThresholds,
  type ClusterView,
} from './evaluate';
import { MetricsStore } from './metrics-store';

// ---------------------------------------------------------------------------
// 다른 모듈(비용·어드바이저)용 읽기 전용 타입 — 정리된 값만
// ---------------------------------------------------------------------------

export interface ClusterNodeInfo {
  name: string;
  instanceType: string | null;
  zone: string | null;
  region: string | null;
  nodeGroup: string | null;
  capacityType: 'on_demand' | 'spot' | null;
  architecture: string | null;
  /** spec.providerID (aws:///<zone>/i-...). 응답·스냅샷에 그대로 내보내지 말 것 */
  providerId: string | null;
  /** providerID에서 뽑은 EC2 인스턴스 ID (i-...). 없으면 null. 응답·스냅샷에 그대로 내보내지 말 것 */
  instanceId: string | null;
  createdAt: string;
  ready: boolean;
  unschedulable: boolean;
  allocatable: { cpuMillicores: number; memoryBytes: number; pods: number };
  capacity: { cpuMillicores: number; memoryBytes: number; pods: number };
  usage: { cpuMillicores: number; memoryBytes: number } | null;
}

export interface ClusterPodInfo {
  namespace: string;
  name: string;
  nodeName: string | null;
  phase: RawPod['phase'];
  /** Succeeded 또는 Job 소유 Failed */
  completed: boolean;
  isSystemNamespace: boolean;
  owner: { kind: string; name: string; workloadKey: string | null } | null;
  qosClass: RawPod['qosClass'];
  /** 컨테이너 합계. 하나라도 값이 없으면 null (init 제외) */
  requests: { cpuMillicores: number | null; memoryBytes: number | null };
  limits: { cpuMillicores: number | null; memoryBytes: number | null };
  containers: {
    name: string;
    requests: { cpuMillicores: number | null; memoryBytes: number | null };
    limits: { cpuMillicores: number | null; memoryBytes: number | null };
  }[];
  usage: { cpuMillicores: number; memoryBytes: number } | null;
  pvcClaims: string[];
  createdAt: string;
}

export interface ClusterPvcInfo {
  namespace: string;
  name: string;
  phase: 'Pending' | 'Bound' | 'Lost';
  capacityBytes: number | null;
  requestedBytes: number | null;
  storageClass: string | null;
  /** PV 이름 (EBS 볼륨 ID 매칭은 PV를 조회하지 않으므로 비용 모듈이 AWS 태그로) */
  volumeName: string | null;
  mountedByPods: string[];
  isDbVolume: boolean;
  usagePct: number | null;
  usageSource: 'prometheus' | 'db_size_approx' | null;
}

export interface ClusterServiceInfo {
  namespace: string;
  name: string;
  type: string;
  hasLoadBalancer: boolean;
  /** ELB DNS 이름 (비용 모듈 매칭용. API 응답·어드바이저 스냅샷에 내보내지 말 것) */
  lbHostnames: string[];
  loadBalancerClass: string | null;
}

export interface ClusterIngressInfo {
  namespace: string;
  name: string;
  ingressClass: string | null;
  hasLoadBalancer: boolean;
  lbHostnames: string[];
}

/** 비용 모듈 ClusterInventoryPort.snapshot()과 같은 모양 (src/cost/cluster-inventory.port.ts) */
export interface ClusterInventoryView {
  state: 'ok' | 'syncing' | 'stale' | 'unavailable' | 'not_configured';
  updatedAt: Date | null;
  /** API 서버 버전 major.minor ("1.34"). 모르면 null */
  kubernetesVersion: string | null;
  nodes: {
    name: string;
    providerId: string | null;
    instanceType: string | null;
    capacityType: 'on_demand' | 'spot' | null;
    zone: string | null;
    nodeGroup: string | null;
    role: NodeRole;
    architecture: string | null;
    allocatable: { cpuMillicores: number; memoryBytes: number };
  }[];
  pods: {
    namespace: string;
    name: string;
    nodeName: string | null;
    phase: string;
    cpuMillicores: number | null;
    memoryBytes: number | null;
  }[];
  pvcs: {
    namespace: string;
    name: string;
    sizeBytes: number | null;
    storageClass: string | null;
    volumeHandle: string | null;
    phase: 'Pending' | 'Bound' | 'Lost';
  }[];
  loadBalancers: {
    kind: 'Service' | 'Ingress';
    namespace: string;
    name: string;
    hostnames: string[];
  }[];
}

const INSTANCE_ID_RE = /\/(i-[0-9a-f]+)$/;

/**
 * 클러스터 상태의 단일 진입점.
 * - 캐시(ClusterStore·MetricsStore)를 평가해 화면용 항목(ClusterView)을 만든다.
 * - 변경(500ms 합침)·15초 재평가마다 `view$`로 새 평가 결과를 낸다.
 * - 비용·어드바이저 모듈이 쓰는 읽기 메서드를 제공한다 (ClusterModule에서 export).
 */
@Injectable()
export class ClusterStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClusterStateService.name);
  private readonly tracker = new StatusChangeTracker();
  private view: ClusterView | null = null;
  private dirty = true;
  private dbProvider: DbAreaProvider | null = null;
  private pvcUsageProm: { at: string; values: Map<string, number> } | null =
    null;
  private readonly viewSubject = new Subject<ClusterView>();
  /** 평가할 때마다 (최대 500ms에 한 번 + 15초마다) */
  readonly view$: Observable<ClusterView> = this.viewSubject.asObservable();
  private readonly resyncSubject = new Subject<void>();
  /** 전체 스냅샷을 다시 보내야 할 때 (mock 시나리오 변경, informer 재동기화) */
  readonly resync$: Observable<void> = this.resyncSubject.asObservable();
  /** 다른 모듈용: 클러스터 데이터가 바뀌었다는 신호 */
  readonly changes$: Observable<void> = this.view$.pipe(map(() => undefined));
  readonly systemNamespaces: ReadonlySet<string>;
  readonly metricsIntervalSec: number;
  private debounceTimer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private sub: Subscription | null = null;
  private logLinkSub: Subscription | null = null;
  private clusterNameOverride: string | null;
  /** env CONTROL_PLANE_HA_EXPECTED (기본 true) */
  readonly controlPlaneHaExpected: boolean;

  constructor(
    readonly store: ClusterStore,
    readonly metrics: MetricsStore,
    private readonly registry: SourceRegistry,
    private readonly settings: SettingsService,
    config: ConfigService<EnvironmentVariables, true>,
    private readonly logLinks: LogLinkPolicy,
  ) {
    this.systemNamespaces = new Set(
      config
        .get('SYSTEM_NAMESPACES', { infer: true })
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
    this.metricsIntervalSec = config.get('METRICS_INTERVAL_SEC', {
      infer: true,
    });
    this.clusterNameOverride =
      config.get('K8S_CLUSTER_NAME', { infer: true }) ?? null;
    this.controlPlaneHaExpected = config.get('CONTROL_PLANE_HA_EXPECTED', {
      infer: true,
    });
  }

  onModuleInit(): void {
    this.sub = merge(
      this.store.changes$.pipe(map(() => undefined)),
      this.metrics.collected$,
      this.registry.changes$.pipe(
        filter((s) =>
          ['kube', 'metrics', 'monitoredDb', 'prometheus'].includes(s.id),
        ),
        map(() => undefined),
      ),
    ).subscribe(() => this.schedule());
    // 로그 링크 가능 여부가 바뀌면(mock `logs=disabled` 전환) 링크를 다시 만들어 스냅샷을 다시 보낸다.
    // 행마다 upsert를 쏟는 것보다 스냅샷 한 번이 화면에 정직하다
    this.logLinkSub = this.logLinks.changes$.subscribe(() =>
      this.requestResync(),
    );
    this.tickTimer = setInterval(() => this.recompute(), 15_000);
    this.tickTimer.unref();
    void this.settings.get('cluster.thresholds').then(() => this.schedule());
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
    this.logLinkSub?.unsubscribe();
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  /** 변경을 500ms 창으로 합쳐 재평가 */
  schedule(): void {
    this.dirty = true;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.recompute();
    }, 500);
    this.debounceTimer.unref();
  }

  thresholds(): ClusterThresholds {
    return this.settings.peek('cluster.thresholds');
  }

  /** 최신 평가 결과. 변경이 있었거나 5초 넘게 지났으면 다시 평가 */
  getView(): ClusterView {
    if (!this.view || this.dirty || Date.now() - this.view.at > 5000) {
      return this.recompute();
    }
    return this.view;
  }

  recompute(): ClusterView {
    this.dirty = false;
    const kube = this.registry.get('kube');
    const metricsSrc = this.registry.get('metrics');
    try {
      this.view = evaluateCluster({
        now: Date.now(),
        store: this.store,
        metrics: this.metrics,
        t: this.thresholds(),
        systemNamespaces: this.systemNamespaces,
        kube: {
          state: kube.state,
          lastSuccessAt: kube.lastSuccessAt,
          errorCode: kube.error?.code ?? null,
        },
        metricsSource: {
          state: metricsSrc.state,
          lastSuccessAt: metricsSrc.lastSuccessAt,
        },
        tracker: this.tracker,
        db: this.dbProvider,
        pvcUsageProm: this.pvcUsageProm,
        clusterName: this.clusterInfo().name,
        metricsIntervalSec: this.metricsIntervalSec,
        controlPlaneHaExpected: this.controlPlaneHaExpected,
        // 링크는 평가 단계에서 채운다 — REST·SSE가 같은 항목을 쓴다 (logs.md 11.4)
        logLinks: this.logLinks.value(),
      });
    } catch (err) {
      this.logger.error(
        `클러스터 평가 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!this.view) throw err;
      return this.view;
    }
    this.viewSubject.next(this.view);
    return this.view;
  }

  // --- 협력 모듈 등록 -----------------------------------------------------------

  registerDbAreaProvider(p: DbAreaProvider): void {
    this.dbProvider = p;
    this.schedule();
  }

  setPvcUsageFromPrometheus(
    v: { at: string; values: Map<string, number> } | null,
  ): void {
    this.pvcUsageProm = v;
    this.schedule();
  }

  /** 평가를 즉시 다시 하고 구독자에게 전체 스냅샷 재전송을 요청 */
  requestResync(): void {
    this.recompute();
    this.resyncSubject.next();
  }

  resetTracking(): void {
    this.tracker.clear();
    this.dirty = true;
  }

  // --- 읽기 -----------------------------------------------------------------

  kubeState(): SourceState {
    return this.registry.get('kube').state;
  }

  clusterInfo(): ClusterInfo {
    const kube = this.registry.get('kube').state;
    const connected =
      kube === 'ok' ||
      kube === 'stale' ||
      (kube === 'mock' && this.store.info.name !== null) ||
      (kube === 'syncing' && this.store.initialSyncDone);
    let region = this.store.info.region;
    if (!region) {
      for (const n of this.store.nodes.values()) {
        if (n.region) {
          region = n.region;
          break;
        }
        if (n.zone) {
          region = n.zone.replace(/[a-z]$/, '');
          break;
        }
      }
    }
    return {
      name: connected
        ? (this.clusterNameOverride ?? this.store.info.name)
        : null,
      version: connected ? this.store.info.version : null,
      region: region ?? null,
      connected,
    };
  }

  /** 비용 모듈: 노드 목록 (인스턴스 타입·노드그룹·구매 옵션·할당 가능량) */
  listNodes(): ClusterNodeInfo[] {
    const ms = this.metrics.state;
    return [...this.store.nodes.values()].map((n) => {
      const ready = n.conditions.find((c) => c.type === 'Ready');
      const u = ms.available ? ms.nodes.get(n.name) : undefined;
      return {
        name: n.name,
        instanceType: n.instanceType,
        zone: n.zone,
        region: n.region,
        nodeGroup: n.nodeGroup,
        capacityType: n.capacityType,
        architecture: n.architecture,
        providerId: n.providerId,
        instanceId: n.providerId
          ? (INSTANCE_ID_RE.exec(n.providerId)?.[1] ?? null)
          : null,
        createdAt: n.createdAt,
        ready: ready?.value === 'True',
        unschedulable: n.unschedulable,
        allocatable: { ...n.allocatable },
        capacity: { ...n.capacity },
        usage: u
          ? {
              cpuMillicores: Math.round(u.cpuMillicores),
              memoryBytes: Math.round(u.memoryBytes),
            }
          : null,
      };
    });
  }

  /** 비용 모듈: 파드 requests/limits/사용량 (네임스페이스 배분용) */
  listPods(opts: { includeCompleted?: boolean } = {}): ClusterPodInfo[] {
    const view = this.getView();
    const ms = this.metrics.state;
    const out: ClusterPodInfo[] = [];
    for (const p of this.store.pods.values()) {
      const completed = isPodCompleted(p);
      if (completed && !opts.includeCompleted) continue;
      const key = podKey(p.namespace, p.name);
      const item = view.podMap.get(key);
      const u = ms.available ? ms.pods.get(key) : undefined;
      out.push({
        namespace: p.namespace,
        name: p.name,
        nodeName: p.nodeName,
        phase: p.phase,
        completed,
        isSystemNamespace: this.systemNamespaces.has(p.namespace),
        owner: item?.owner ?? null,
        qosClass: p.qosClass,
        requests: item?.requests ?? { cpuMillicores: null, memoryBytes: null },
        limits: item?.limits ?? { cpuMillicores: null, memoryBytes: null },
        containers: p.containers.map((c) => ({
          name: c.name,
          requests: { ...c.requests },
          limits: { ...c.limits },
        })),
        usage: u
          ? {
              cpuMillicores: Math.round(u.cpuMillicores),
              memoryBytes: Math.round(u.memoryBytes),
            }
          : null,
        pvcClaims: [...p.pvcClaims],
        createdAt: p.createdAt,
      });
    }
    return out;
  }

  listPvcs(): ClusterPvcInfo[] {
    return this.getView().pvcs.map((p) => ({
      namespace: p.namespace,
      name: p.name,
      phase: p.phase,
      capacityBytes: p.capacityBytes,
      requestedBytes: p.requestedBytes,
      storageClass: p.storageClass,
      volumeName: p.volumeName,
      mountedByPods: p.mountedBy.map((r) => r.name),
      isDbVolume: p.isDbVolume,
      usagePct: p.usage?.pct ?? null,
      usageSource: p.usage?.source ?? null,
    }));
  }

  listServices(): ClusterServiceInfo[] {
    return [...this.store.services.values()].map((s) => ({
      namespace: s.namespace,
      name: s.name,
      type: s.type,
      hasLoadBalancer: s.hasLoadBalancer,
      lbHostnames: [...s.lbHostnames],
      loadBalancerClass: s.loadBalancerClass,
    }));
  }

  listIngresses(): ClusterIngressInfo[] {
    return [...this.store.ingresses.values()].map((i) => ({
      namespace: i.namespace,
      name: i.name,
      ingressClass: i.ingressClass,
      hasLoadBalancer: i.hasLoadBalancer,
      lbHostnames: [...i.lbHostnames],
    }));
  }

  /**
   * 비용 모듈용 한 번에 읽기 (ClusterInventoryPort.snapshot()과 같은 모양, 메모리 캐시만).
   * 파드 cpu/memory는 컨테이너 requests 합(값 있는 것만, 하나도 없으면 null). 완료 파드 제외.
   */
  inventorySnapshot(): ClusterInventoryView {
    const src = this.registry.get('kube');
    const state: ClusterInventoryView['state'] =
      src.state === 'mock' ? 'ok' : src.state;
    const updated = src.lastSuccessAt ?? this.store.lastSyncAt;
    const pods = [...this.store.pods.values()]
      .filter((p) => !isPodCompleted(p))
      .map((p) => {
        let cpu: number | null = null;
        let mem: number | null = null;
        for (const c of p.containers) {
          if (c.requests.cpuMillicores !== null)
            cpu = (cpu ?? 0) + c.requests.cpuMillicores;
          if (c.requests.memoryBytes !== null)
            mem = (mem ?? 0) + c.requests.memoryBytes;
        }
        return {
          namespace: p.namespace,
          name: p.name,
          nodeName: p.nodeName,
          phase: p.phase,
          cpuMillicores: cpu,
          memoryBytes: mem,
        };
      });
    const ver = /^v?(\d+)\.(\d+)/.exec(this.store.info.version ?? '');
    return {
      state,
      updatedAt: updated ? new Date(updated) : null,
      kubernetesVersion: ver ? `${ver[1]}.${ver[2]}` : null,
      nodes: [...this.store.nodes.values()].map((n) => ({
        name: n.name,
        providerId: n.providerId,
        instanceType: n.instanceType,
        capacityType: n.capacityType,
        zone: n.zone,
        nodeGroup: n.nodeGroup,
        role: n.role,
        architecture: n.architecture,
        allocatable: {
          cpuMillicores: n.allocatable.cpuMillicores,
          memoryBytes: n.allocatable.memoryBytes,
        },
      })),
      pods,
      pvcs: [...this.store.pvcs.values()].map((p) => ({
        namespace: p.namespace,
        name: p.name,
        sizeBytes: p.capacityBytes ?? p.requestedBytes,
        storageClass: p.storageClass,
        // persistentvolumes 조회 권한이 없어 CSI volumeHandle은 모른다 (볼륨 태그로 대조)
        volumeHandle: null,
        phase: p.phase,
      })),
      loadBalancers: [
        ...[...this.store.services.values()]
          .filter((s) => s.type === 'LoadBalancer')
          .map((s) => ({
            kind: 'Service' as const,
            namespace: s.namespace,
            name: s.name,
            hostnames: [...s.lbHostnames],
          })),
        ...[...this.store.ingresses.values()].map((i) => ({
          kind: 'Ingress' as const,
          namespace: i.namespace,
          name: i.name,
          hostnames: [...i.lbHostnames],
        })),
      ],
    };
  }
}
