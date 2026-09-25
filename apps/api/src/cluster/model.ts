/**
 * 클러스터 내부 모델 (정리된 값만). informer(live)와 mock이 같은 모양을 만든다.
 * - 쿠버네티스 원본 객체를 들고 있지 않는다: 환경 변수, command/args, 어노테이션, managedFields 없음.
 * - 레이블은 해석된 필드 + 매칭용(워크로드 템플릿·PDB selector)으로만 쓰고 응답에는 내보내지 않는다.
 */

export type ConditionValue = 'True' | 'False' | 'Unknown';

export interface RawCondition {
  type: string;
  value: ConditionValue | null;
  since: string | null;
  reason: string | null;
  message: string | null;
  lastUpdateAt?: string | null;
}

export interface ResourceAmountsRaw {
  cpuMillicores: number | null;
  memoryBytes: number | null;
}

export type NodeRole = 'worker' | 'control_plane';

export interface RawNode {
  name: string;
  createdAt: string;
  instanceType: string | null;
  zone: string | null;
  region: string | null;
  /** kOps InstanceGroup 이름 (라벨 kops.k8s.io/instancegroup) */
  nodeGroup: string | null;
  /** 라벨 node-role.kubernetes.io/control-plane (또는 구 …/master) 이 있으면 control_plane */
  role: NodeRole;
  capacityType: 'on_demand' | 'spot' | null;
  architecture: string | null;
  kubeletVersion: string;
  /** aws:///<zone>/<instance-id> — 응답에는 내보내지 않는다(비용 모듈 매칭용) */
  providerId: string | null;
  unschedulable: boolean;
  conditions: RawCondition[];
  allocatable: { cpuMillicores: number; memoryBytes: number; pods: number };
  capacity: { cpuMillicores: number; memoryBytes: number; pods: number };
}

export interface RawContainerSpec {
  name: string;
  image: string;
  requests: ResourceAmountsRaw;
  limits: ResourceAmountsRaw;
  probes: { readiness: boolean; liveness: boolean; startup: boolean };
  security: {
    privileged: boolean;
    allowPrivilegeEscalation: boolean | null;
    runAsNonRoot: boolean | null;
  };
}

export type ContainerStateType = 'running' | 'waiting' | 'terminated';

export interface RawContainerStatus {
  ready: boolean;
  restartCount: number;
  state: {
    type: ContainerStateType;
    reason: string | null;
    message: string | null;
    since: string | null;
    exitCode?: number | null;
  } | null;
  lastTermination: {
    reason: string | null;
    exitCode: number | null;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
}

export interface RawContainer extends RawContainerSpec {
  init: boolean;
  status: RawContainerStatus | null;
}

export interface PodSecurityRaw {
  hostNetwork: boolean;
  hostPID: boolean;
  hostPath: boolean;
  serviceAccountName: string | null;
  automountToken: boolean | null;
  runAsNonRoot: boolean | null;
}

export interface RawPod {
  namespace: string;
  name: string;
  uid: string;
  createdAt: string;
  /** 매칭용 레이블 (응답에 내보내지 않음) */
  labels: Record<string, string>;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  statusReason: string | null;
  deletionAt: string | null;
  nodeName: string | null;
  podIP: string | null;
  qosClass: 'Guaranteed' | 'Burstable' | 'BestEffort';
  startTime: string | null;
  owner: { kind: string; name: string } | null;
  conditions: RawCondition[];
  containers: RawContainer[];
  initContainers: RawContainer[];
  pvcClaims: string[];
  security: PodSecurityRaw;
}

export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet';
export const WORKLOAD_KINDS: readonly WorkloadKind[] = [
  'Deployment',
  'StatefulSet',
  'DaemonSet',
];

export interface RawWorkload {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  createdAt: string;
  desired: number | null;
  ready: number;
  updated: number | null;
  available: number | null;
  generation: number | null;
  observedGeneration: number | null;
  /** StatefulSet: currentRevision != updateRevision */
  revisionPending: boolean;
  conditions: RawCondition[];
  selector: LabelSelectorRaw | null;
  templateLabels: Record<string, string>;
  containers: RawContainerSpec[];
  podSecurity: PodSecurityRaw;
  /** StatefulSet volumeClaimTemplates 이름 */
  volumeClaimTemplates: string[];
}

export interface LabelSelectorRaw {
  matchLabels: Record<string, string>;
  matchExpressions: { key: string; operator: string; values: string[] }[];
}

export interface RawEvent {
  uid: string;
  namespace: string | null;
  involved: { kind: string; namespace: string | null; name: string };
  reason: string;
  message: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sourceComponent: string | null;
}

export interface RawPvc {
  namespace: string;
  name: string;
  createdAt: string;
  phase: 'Pending' | 'Bound' | 'Lost';
  capacityBytes: number | null;
  requestedBytes: number | null;
  storageClass: string | null;
  volumeName: string | null;
}

export interface RawService {
  namespace: string;
  name: string;
  type: string;
  createdAt: string;
  /** LoadBalancer 인그레스가 할당됐는지 */
  hasLoadBalancer: boolean;
  /** status.loadBalancer.ingress[].hostname (ELB DNS 이름, 비용 모듈 매칭용 — API 응답·어드바이저 스냅샷에는 내보내지 않음) */
  lbHostnames: string[];
  loadBalancerClass: string | null;
  /** LoadBalancer 타입일 때 AWS LB 종류 (loadBalancerClass·aws-load-balancer-type 어노테이션을 해석한 값만 보관) */
  lbType: 'nlb' | 'clb' | null;
}

export interface RawIngress {
  namespace: string;
  name: string;
  createdAt: string;
  ingressClass: string | null;
  hasLoadBalancer: boolean;
  /** status.loadBalancer.ingress[].hostname (내부 매칭용) */
  lbHostnames: string[];
  /** AWS Load Balancer Controller(ALB)가 처리하는 인그레스인지 (ingressClassName 또는 ingress.class 어노테이션 해석) */
  isAlb: boolean;
  /** alb.ingress.kubernetes.io/group.name (같은 그룹은 ALB 하나를 공유) */
  albGroup: string | null;
}

export interface RawPdb {
  namespace: string;
  name: string;
  selector: LabelSelectorRaw | null;
}

export interface RawHpa {
  namespace: string;
  name: string;
  target: { kind: string; name: string };
  minReplicas: number | null;
  maxReplicas: number;
  currentReplicas: number | null;
}

/** 쿠버네티스 리소스 종류 (store 키) */
export type KubeResource =
  | 'nodes'
  | 'pods'
  | 'workloads'
  | 'events'
  | 'pvcs'
  | 'services'
  | 'ingresses'
  | 'pdbs'
  | 'hpas'
  | 'namespaces';

export interface ClusterInfoRaw {
  name: string | null;
  version: string | null;
  region: string | null;
}

export function podKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

export function workloadKey(
  kind: string,
  namespace: string,
  name: string,
): string {
  return `${kind}/${namespace}/${name}`;
}

export function selectorMatches(
  selector: LabelSelectorRaw | null,
  labels: Record<string, string>,
): boolean {
  if (!selector) return false;
  const ml = Object.entries(selector.matchLabels);
  if (ml.length === 0 && selector.matchExpressions.length === 0) return true;
  for (const [k, v] of ml) if (labels[k] !== v) return false;
  for (const e of selector.matchExpressions) {
    const has = Object.prototype.hasOwnProperty.call(labels, e.key);
    const val = labels[e.key];
    switch (e.operator) {
      case 'In':
        if (!has || !e.values.includes(val)) return false;
        break;
      case 'NotIn':
        if (has && e.values.includes(val)) return false;
        break;
      case 'Exists':
        if (!has) return false;
        break;
      case 'DoesNotExist':
        if (has) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}
