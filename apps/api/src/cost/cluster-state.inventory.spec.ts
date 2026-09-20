import { Subject } from 'rxjs';
import type { ClusterStateService } from '../cluster/state/cluster-state.service';
import type { ClusterInventorySnapshot } from './cluster-inventory.port';
import {
  ClusterStateInventoryAdapter,
  inventoryFingerprint,
} from './cluster-state.inventory';

function inv(
  nodes: string[],
  podCpu = 100,
  state: ClusterInventorySnapshot['state'] = 'ok',
): ClusterInventorySnapshot {
  return {
    state,
    updatedAt: null,
    nodes: nodes.map((name) => ({
      name,
      providerId: null,
      instanceType: 'm6i.large',
      capacityType: 'on_demand',
      zone: 'ap-northeast-2a',
      nodeGroup: 'g',
      architecture: 'amd64',
      allocatable: { cpuMillicores: 1930, memoryBytes: 1 },
    })),
    pods: [
      {
        namespace: 'a',
        name: 'p',
        nodeName: nodes[0] ?? null,
        phase: 'Running',
        cpuMillicores: podCpu,
        memoryBytes: null,
      },
    ],
    pvcs: [],
    loadBalancers: [],
  };
}

describe('ClusterStateInventoryAdapter', () => {
  it('snapshot()은 inventorySnapshot()을 그대로, backedByCluster = true', () => {
    const snap = inv(['n1']);
    const state = {
      changes$: new Subject<void>(),
      inventorySnapshot: () => snap,
    } as unknown as ClusterStateService;
    const a = new ClusterStateInventoryAdapter(state);
    expect(a.snapshot()).toBe(snap);
    expect(a.backedByCluster).toBe(true);
  });

  it('changes$는 노드·PVC·LB·상태가 바뀔 때만 울린다 (15초 재평가·파드 변화는 무시)', () => {
    const changes = new Subject<void>();
    let current = inv(['n1']);
    const state = {
      changes$: changes,
      inventorySnapshot: () => current,
    } as unknown as ClusterStateService;
    const a = new ClusterStateInventoryAdapter(state);
    let count = 0;
    const sub = a.changes$.subscribe(() => (count += 1));
    changes.next(); // 같은 인벤토리
    current = inv(['n1'], 500); // 파드 requests만 변경
    changes.next();
    expect(count).toBe(0);
    current = inv(['n1', 'n2']); // 노드 추가
    changes.next();
    changes.next();
    expect(count).toBe(1);
    current = inv(['n1', 'n2'], 100, 'stale');
    changes.next();
    expect(count).toBe(2);
    sub.unsubscribe();
  });

  it('지문은 순서와 무관', () => {
    expect(inventoryFingerprint(inv(['a', 'b']))).toBe(
      inventoryFingerprint(inv(['b', 'a'])),
    );
  });
});
