import type { Observable } from 'rxjs';

/**
 * cost 모듈이 클러스터에서 필요로 하는 최소 정보 (포트).
 *
 * - 연결: `CostModule`이 `ClusterStateInventoryAdapter`(cluster-state.inventory.ts)로
 *   `ClusterStateService.inventorySnapshot()`·`changes$`를 이 포트에 잇는다 (live·mock 공통).
 * - mock: 포트가 클러스터에 연결돼 있으면(`backedByCluster`) cluster mock 인벤토리를 기준으로
 *   비용 mock 세계(AWS 리소스)를 만든다. 연결이 없으면(단위 테스트) cost 자체 mock 인벤토리를 쓴다.
 * - 쿠버네티스 원본 객체는 넘기지 않는다. 해석된 필드만.
 */
export const CLUSTER_INVENTORY_PORT = Symbol('CLUSTER_INVENTORY_PORT');

export type InventoryState =
  'ok' | 'syncing' | 'stale' | 'unavailable' | 'not_configured';

export interface InventoryNode {
  name: string;
  /** spec.providerID (`aws:///ap-northeast-2a/i-0123...`). 없으면 null */
  providerId: string | null;
  /** 레이블 node.kubernetes.io/instance-type */
  instanceType: string | null;
  /** eks.amazonaws.com/capacityType 또는 karpenter.sh/capacity-type 해석값 */
  capacityType: 'on_demand' | 'spot' | null;
  /** topology.kubernetes.io/zone */
  zone: string | null;
  /** eks.amazonaws.com/nodegroup 또는 karpenter.sh/nodepool 등 해석값 */
  nodeGroup: string | null;
  /** kubernetes.io/arch */
  architecture: string | null;
  /** status.allocatable (배분 비율의 분모) */
  allocatable: { cpuMillicores: number; memoryBytes: number };
}

export interface InventoryPod {
  namespace: string;
  name: string;
  /** 스케줄 전이면 null */
  nodeName: string | null;
  /** Running | Pending | Succeeded | Failed | Unknown */
  phase: string;
  /** 컨테이너 requests 합. 하나도 없으면 null */
  cpuMillicores: number | null;
  memoryBytes: number | null;
}

export interface InventoryPvc {
  namespace: string;
  name: string;
  /** status.capacity.storage (없으면 spec 요청값) */
  sizeBytes: number | null;
  storageClass: string | null;
  /** PV의 CSI volumeHandle(`vol-...`). RBAC에 persistentvolumes가 없으면 null (볼륨 태그로 대조) */
  volumeHandle: string | null;
  /** (선택) Pending | Bound | Lost. mock 세계가 실제 볼륨이 있는 PVC만 고를 때 쓴다 */
  phase?: string;
}

/** LoadBalancer 타입 Service와 Ingress의 status 호스트 이름 (ELB DNSName 대조용) */
export interface InventoryLbAttachment {
  kind: 'Service' | 'Ingress';
  namespace: string;
  name: string;
  hostnames: string[];
}

export interface ClusterInventorySnapshot {
  state: InventoryState;
  updatedAt: Date | null;
  /**
   * (선택) 쿠버네티스 API 서버 버전 `major.minor`(예: "1.34"). 모르면 null.
   * EKS 컨트롤 플레인 지원 등급(표준/확장)의 기준. live에서 eks:DescribeCluster 값이 있으면 그 값이 우선.
   */
  kubernetesVersion?: string | null;
  nodes: InventoryNode[];
  pods: InventoryPod[];
  pvcs: InventoryPvc[];
  loadBalancers: InventoryLbAttachment[];
}

export interface ClusterInventoryPort {
  /** 메모리 캐시에서 바로 돌려준다 (쿠버네티스 API 호출 없음) */
  snapshot(): ClusterInventorySnapshot;
  /** 노드·PVC·서비스·인그레스가 바뀌면 알림 (선택). cost는 10초 debounce 후 재계산 */
  readonly changes$?: Observable<void>;
  /**
   * (선택) true면 ClusterModule의 캐시(informer 또는 cluster mock)에 연결된 구현.
   * mock 모드에서 비용 mock 세계를 이 인벤토리로 만들지 판단한다.
   */
  readonly backedByCluster?: boolean;
}

/** live에서 어댑터가 아직 연결되지 않았을 때 쓰는 기본 구현 (클러스터 연결 없음) */
export class NotConfiguredClusterInventory implements ClusterInventoryPort {
  snapshot(): ClusterInventorySnapshot {
    return {
      state: 'not_configured',
      updatedAt: null,
      nodes: [],
      pods: [],
      pvcs: [],
      loadBalancers: [],
    };
  }
}

/** "v1.34.2-eks-abc" · "1.34" → "1.34". 형식이 다르면 null */
export function k8sMinorVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^v?(\d+)\.(\d+)/.exec(v.trim());
  return m ? `${m[1]}.${m[2]}` : null;
}

/** `aws:///ap-northeast-2a/i-0abc` → `i-0abc` */
export function instanceIdFromProviderId(
  providerId: string | null,
): string | null {
  if (!providerId) return null;
  const m = /\/(i-[0-9a-f]+)$/i.exec(providerId.trim());
  return m ? m[1] : null;
}
