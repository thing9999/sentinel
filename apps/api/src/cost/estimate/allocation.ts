/**
 * 네임스페이스별 비용 배분 (순수 함수). 명세 aws-cost 3.2 규칙 1~7, 계약 3.2.
 *
 * 1. 노드 비용: 파드 몫 = 노드 시간당 × (CPU requests 비율 + 메모리 requests 비율) ÷ 2
 * 2. 나머지 = 미할당(유휴)
 * 3. requests 없는 파드는 0 배분 + 경고
 * 4. PVC 볼륨 → PVC 네임스페이스
 * 5. LB → 서비스·인그레스 네임스페이스 (식별 불가 → 공용)
 * 6. EKS·노드 루트 볼륨·퍼블릭 IPv4 → 공용(클러스터)
 * 7. 완료 파드(Succeeded/Failed) 제외
 * 단가 없는 리소스는 추정 합계에서 빠지므로 배분에서도 빠진다 (합계 일치).
 */
import type {
  ClusterInventorySnapshot,
  InventoryPod,
} from '../cluster-inventory.port';
import { r6 } from '../cost-util';
import type {
  AllocationBreakdown,
  AllocationComputation,
  AllocationRow,
  EstimateComputation,
  PinnedRow,
} from '../cost.types';

export const DEFAULT_SYSTEM_NAMESPACES = [
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'amazon-cloudwatch',
  'amazon-guardduty',
  'aws-observability',
  'karpenter',
];

export function isSystemNamespace(
  ns: string,
  list: readonly string[] = DEFAULT_SYSTEM_NAMESPACES,
): boolean {
  return list.includes(ns);
}

const COMPLETED = new Set(['Succeeded', 'Failed']);

interface Acc {
  node: number;
  storage: number;
  lb: number;
  eks: number;
  ipv4: number;
}
const zero = (): Acc => ({ node: 0, storage: 0, lb: 0, eks: 0, ipv4: 0 });
const accTotal = (a: Acc) => a.node + a.storage + a.lb + a.eks + a.ipv4;

export function podRequestsMissing(p: InventoryPod): boolean {
  return (
    (p.cpuMillicores === null || p.cpuMillicores === 0) &&
    (p.memoryBytes === null || p.memoryBytes === 0)
  );
}

export function computeAllocation(
  estimate: EstimateComputation,
  inventory: ClusterInventorySnapshot,
  hoursPerMonth: number,
  systemNamespaces: readonly string[] = DEFAULT_SYSTEM_NAMESPACES,
): AllocationComputation {
  const ns = new Map<string, Acc>();
  const nsAcc = (name: string): Acc => {
    let a = ns.get(name);
    if (!a) {
      a = zero();
      ns.set(name, a);
    }
    return a;
  };
  const unallocated = zero();
  const sharedCluster = zero();
  const shared = zero();

  const activePods = inventory.pods.filter((p) => !COMPLETED.has(p.phase));
  const podsByNode = new Map<string, InventoryPod[]>();
  for (const p of activePods) {
    if (!p.nodeName) continue;
    const list = podsByNode.get(p.nodeName) ?? [];
    list.push(p);
    podsByNode.set(p.nodeName, list);
  }
  const nodes = new Map(inventory.nodes.map((n) => [n.name, n]));

  // 1~3. 노드
  for (const row of estimate.resources.ec2) {
    if (row.usdPerHour === null) continue;
    const hourly = row.usdPerHour;
    const node = row.nodeName ? nodes.get(row.nodeName) : undefined;
    const alloc = node?.allocatable;
    if (!node || !alloc || alloc.cpuMillicores <= 0 || alloc.memoryBytes <= 0) {
      unallocated.node += hourly;
      continue;
    }
    const shares: { ns: string; usd: number }[] = [];
    for (const p of podsByNode.get(node.name) ?? []) {
      const cpuRatio = (p.cpuMillicores ?? 0) / alloc.cpuMillicores;
      const memRatio = (p.memoryBytes ?? 0) / alloc.memoryBytes;
      shares.push({
        ns: p.namespace,
        usd: (hourly * (cpuRatio + memRatio)) / 2,
      });
    }
    let assigned = shares.reduce((s, x) => s + x.usd, 0);
    // requests 합이 할당 가능량을 넘는 비정상 데이터면 노드 비용 안으로 비례 축소
    const scale = assigned > hourly && assigned > 0 ? hourly / assigned : 1;
    for (const s of shares) nsAcc(s.ns).node += s.usd * scale;
    assigned *= scale;
    unallocated.node += Math.max(0, hourly - assigned);
  }

  // 4·6. EBS
  for (const v of estimate.resources.ebs) {
    if (v.usdPerHour === null) continue;
    if (v.attachment.type === 'pvc' && v.attachment.namespace) {
      nsAcc(v.attachment.namespace).storage += v.usdPerHour;
    } else {
      sharedCluster.storage += v.usdPerHour;
    }
  }

  // 5. LB
  for (const l of estimate.resources.lb) {
    if (l.usdPerHour === null) continue;
    const namespaces = [...new Set(l.attachedTo.map((r) => r.namespace))];
    if (namespaces.length === 0) {
      shared.lb += l.usdPerHour;
      continue;
    }
    for (const n of namespaces) nsAcc(n).lb += l.usdPerHour / namespaces.length;
  }

  // 6. EKS·IPv4
  for (const e of estimate.resources.eks) {
    if (e.usdPerHour !== null) sharedCluster.eks += e.usdPerHour;
  }
  for (const i of estimate.resources.ipv4) {
    if (i.usdPerHour !== null) sharedCluster.ipv4 += i.usdPerHour;
  }

  // 3. requests 미설정 경고
  const missing = new Map<string, number>();
  for (const p of activePods) {
    if (podRequestsMissing(p)) {
      missing.set(p.namespace, (missing.get(p.namespace) ?? 0) + 1);
      nsAcc(p.namespace);
    }
  }

  const total =
    [...ns.values()].reduce((s, a) => s + accTotal(a), 0) +
    accTotal(unallocated) +
    accTotal(sharedCluster) +
    accTotal(shared);
  const share = (v: number) =>
    total > 0 ? Math.round((v / total) * 1000) / 10 : 0;

  const rows: AllocationRow[] = [...ns.entries()]
    .filter(([name, a]) => accTotal(a) > 0 || (missing.get(name) ?? 0) > 0)
    .map(([name, a]) => {
      const h = accTotal(a);
      const count = missing.get(name) ?? 0;
      return {
        namespace: name,
        isSystem: isSystemNamespace(name, systemNamespaces),
        usdPerHour: r6(h),
        usdPerMonth: r6(h * hoursPerMonth),
        sharePct: share(h),
        breakdown: {
          nodeUsdPerHour: r6(a.node),
          storageUsdPerHour: r6(a.storage),
          lbUsdPerHour: r6(a.lb),
        },
        warnings:
          count > 0
            ? [
                {
                  code: 'REQUESTS_MISSING',
                  text: `requests 미설정 파드 ${count}개`,
                  count,
                },
              ]
            : [],
      };
    });

  const pinned: PinnedRow[] = [];
  const pushPinned = (
    key: PinnedRow['key'],
    label: string,
    a: Acc,
    withShared: boolean,
  ) => {
    const h = accTotal(a);
    if (h <= 0) return;
    const breakdown: AllocationBreakdown = {
      nodeUsdPerHour: r6(a.node),
      storageUsdPerHour: r6(a.storage),
      lbUsdPerHour: r6(a.lb),
    };
    if (withShared) {
      breakdown.eksUsdPerHour = r6(a.eks);
      breakdown.ipv4UsdPerHour = r6(a.ipv4);
    }
    pinned.push({
      key,
      label,
      usdPerHour: r6(h),
      usdPerMonth: r6(h * hoursPerMonth),
      sharePct: share(h),
      breakdown,
    });
  };
  pushPinned('unallocated', '미할당(유휴)', unallocated, false);
  pushPinned('shared_cluster', '공용(클러스터)', sharedCluster, true);
  pushPinned('shared', '공용', shared, false);

  return {
    rows,
    pinnedRows: pinned,
    total: { usdPerHour: r6(total), usdPerMonth: r6(total * hoursPerMonth) },
    unallocatedPct: share(accTotal(unallocated)),
  };
}

export type AllocationSort = 'usdPerHour' | 'namespace' | 'sharePct';

/** 정렬·시스템 숨김 적용 (고정 행은 정렬과 무관하게 맨 아래) */
export function presentAllocation(
  a: AllocationComputation,
  opts: {
    hideSystem: boolean;
    sortField: AllocationSort;
    sortDir: 'asc' | 'desc';
  },
  hoursPerMonth: number,
): { rows: AllocationRow[]; hiddenSystem: PinnedRow | null } {
  let rows = [...a.rows];
  let hiddenSystem: PinnedRow | null = null;
  if (opts.hideSystem) {
    const sys = rows.filter((r) => r.isSystem);
    rows = rows.filter((r) => !r.isSystem);
    if (sys.length > 0) {
      const sum = (f: (r: AllocationRow) => number) =>
        sys.reduce((s, r) => s + f(r), 0);
      const h = sum((r) => r.usdPerHour);
      hiddenSystem = {
        key: 'hidden_system',
        label: '시스템 네임스페이스 (숨김)',
        usdPerHour: r6(h),
        usdPerMonth: r6(h * hoursPerMonth),
        sharePct: Math.round(sum((r) => r.sharePct) * 10) / 10,
        breakdown: {
          nodeUsdPerHour: r6(sum((r) => r.breakdown.nodeUsdPerHour)),
          storageUsdPerHour: r6(sum((r) => r.breakdown.storageUsdPerHour)),
          lbUsdPerHour: r6(sum((r) => r.breakdown.lbUsdPerHour)),
        },
      };
    }
  }
  const dir = opts.sortDir === 'asc' ? 1 : -1;
  rows.sort((x, y) => {
    if (opts.sortField === 'namespace')
      return dir * x.namespace.localeCompare(y.namespace);
    const f = opts.sortField;
    return dir * (x[f] - y[f]) || x.namespace.localeCompare(y.namespace);
  });
  return { rows, hiddenSystem };
}
