import { defer, type Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type { ClusterStateService } from '../cluster/state/cluster-state.service';
import type {
  ClusterInventoryPort,
  ClusterInventorySnapshot,
} from './cluster-inventory.port';

/**
 * `ClusterStateService`(ClusterModule) → `ClusterInventoryPort` 어댑터.
 *
 * - snapshot(): `inventorySnapshot()`을 그대로 돌려준다 (메모리 캐시만, 쿠버네티스 API 호출 없음).
 * - changes$: ClusterStateService.changes$는 평가할 때마다(최대 500ms에 1회 + 15초마다) 울리므로,
 *   비용에 영향을 주는 부분(노드·PVC·LoadBalancer 호스트 이름)의 지문이 바뀔 때만 알린다.
 *   (파드만 바뀐 경우는 알리지 않는다 — 배분은 주기 갱신(기본 5분)에서 다시 계산)
 *   live에서 알림마다 AWS Describe* 호출이 일어나므로 15초 재평가를 그대로 넘기면 안 된다.
 */
export class ClusterStateInventoryAdapter implements ClusterInventoryPort {
  readonly backedByCluster = true;
  readonly changes$: Observable<void>;

  constructor(private readonly state: ClusterStateService) {
    // 구독 시점의 지문을 기준으로 삼는다 (구독자마다 따로)
    this.changes$ = defer(() => {
      let last = inventoryFingerprint(state.inventorySnapshot());
      return state.changes$.pipe(
        map(() => inventoryFingerprint(state.inventorySnapshot())),
        filter((fp) => {
          if (fp === last) return false;
          last = fp;
          return true;
        }),
        map((): void => undefined),
      );
    });
  }

  snapshot(): ClusterInventorySnapshot {
    return this.state.inventorySnapshot();
  }
}

/** 비용 추정에 영향을 주는 인벤토리 부분의 지문 (순서 무관) */
export function inventoryFingerprint(inv: ClusterInventorySnapshot): string {
  const nodes = inv.nodes
    .map(
      (n) =>
        `${n.name}|${n.providerId ?? ''}|${n.instanceType ?? ''}|${n.capacityType ?? ''}|${n.zone ?? ''}|${n.nodeGroup ?? ''}|${n.role}`,
    )
    .sort();
  const pvcs = inv.pvcs
    .map(
      (p) =>
        `${p.namespace}/${p.name}|${p.sizeBytes ?? ''}|${p.storageClass ?? ''}|${p.phase ?? ''}`,
    )
    .sort();
  const lbs = inv.loadBalancers
    .map(
      (l) =>
        `${l.kind}/${l.namespace}/${l.name}|${[...l.hostnames].sort().join(',')}`,
    )
    .sort();
  return JSON.stringify([
    inv.state,
    inv.kubernetesVersion ?? null,
    nodes,
    pvcs,
    lbs,
  ]);
}
