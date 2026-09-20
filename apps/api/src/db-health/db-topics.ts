import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { merge, Observable, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import {
  AdvisorSnapshotContributorProvider,
  TopicSourceProvider,
  type AdvisorSnapshotContributor,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import { changeKey } from '../common/hash';
import { ClusterStateService } from '../cluster/state/cluster-state.service';
import { DbHealthService } from './db-health.service';

/**
 * 토픽 `db` (docs/api/cluster-status.md 8.4).
 * 수집마다(실패 포함) db.updated. DB StatefulSet·파드·PVC가 바뀌어도 db.updated (전체 교체).
 */
@Injectable()
@TopicSourceProvider()
export class DbTopicSource
  implements TopicSource, OnApplicationBootstrap, OnModuleDestroy
{
  readonly topic = 'db';
  private readonly subject = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.subject.asObservable();
  private kubeKey = '';
  private sub: Subscription | null = null;

  constructor(
    private readonly db: DbHealthService,
    private readonly cluster: ClusterStateService,
  ) {}

  onApplicationBootstrap(): void {
    this.sub = merge(this.db.changes$, this.cluster.view$, this.cluster.resync$)
      .pipe(debounceTime(300))
      .subscribe(() => this.emit());
  }

  onModuleDestroy(): void {
    this.sub?.unsubscribe();
  }

  private lastHealthAt: string | null = null;

  private emit(): void {
    const d = this.db.detail();
    const kk = changeKey({ k: d.kubernetes, s: d.status, c: d.configured });
    const collected = d.health?.collectedAt ?? null;
    // 수집이 새로 됐거나 쿠버네티스 쪽/상태가 바뀌었을 때만
    if (collected === this.lastHealthAt && kk === this.kubeKey) return;
    this.lastHealthAt = collected;
    this.kubeKey = kk;
    this.subject.next({ event: 'db.updated', data: d });
  }

  snapshot(): Promise<TopicEvent[]> {
    const d = this.db.detail();
    this.lastHealthAt = d.health?.collectedAt ?? null;
    this.kubeKey = changeKey({ k: d.kubernetes, s: d.status, c: d.configured });
    return Promise.resolve([{ event: 'db.snapshot', data: d }]);
  }
}

/**
 * 어드바이저 스냅샷의 DB 부분 (architecture-advisor.md B.2 `db`).
 * DB 사용자 이름·pid·standby/슬롯 이름·접속 오류·쿼리 원문은 넣지 않는다.
 */
@Injectable()
@AdvisorSnapshotContributorProvider()
export class DbAdvisorSnapshot implements AdvisorSnapshotContributor {
  readonly section = 'db' as const;

  constructor(
    private readonly db: DbHealthService,
    private readonly cluster: ClusterStateService,
  ) {}

  contribute(): Promise<unknown> {
    const d = this.db.detail();
    if (!d.configured || !d.target) return Promise.resolve(null);
    const s = this.db.currentSnapshot();
    const pods = d.kubernetes?.pods ?? [];
    const sts = d.kubernetes?.statefulSet ?? null;
    const nodes = new Map(this.cluster.listNodes().map((n) => [n.name, n]));
    const podNodes = pods
      .map((p) => (p.nodeName ? nodes.get(p.nodeName) : undefined))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    const onSpot =
      podNodes.length === 0
        ? null
        : podNodes.some((n) => n.capacityType === 'spot')
          ? true
          : podNodes.every((n) => n.capacityType !== null)
            ? false
            : null;
    const first = pods[0];
    const conn = s?.connections ?? null;
    return Promise.resolve({
      vendor: 'postgres',
      version: s?.server?.version ?? null,
      replicas: sts?.replicas.desired ?? null,
      pvcUsagePct: d.pvcUsage?.pct ?? null,
      pvcUsageSource: d.pvcUsage?.source ?? null,
      connections: {
        currentPct: conn?.usagePct ?? null,
        maxObservedPct: this.db.maxObservedConnectionPct(),
        max: conn?.max ?? null,
      },
      longRunningQueries: s?.longRunning
        ? {
            over5m: s.longRunning.activeOverWarn,
            over30m: s.longRunning.activeOverCrit,
          }
        : null,
      cacheHitPct: s?.throughput?.cacheHitPct ?? null,
      xidAge: s?.xid?.maxAge ?? null,
      databases: (s?.sizes?.databases ?? []).map((x) => ({
        name: x.name,
        bytes: x.bytes,
      })),
      resources: {
        qosClass: first?.qosClass ?? null,
        requestsSet:
          first !== undefined &&
          first.requests.cpuMillicores !== null &&
          first.requests.memoryBytes !== null,
        limitsSet:
          first !== undefined &&
          first.limits.cpuMillicores !== null &&
          first.limits.memoryBytes !== null,
      },
      onSpot,
    });
  }
}
