/**
 * mock 모드 데이터 (AWS 호출 0회). 시나리오별로 현실적인 가짜 인벤토리·AWS 리소스·단가·CE 결과·소모율 기록.
 * 계약 common.md 6.1 cost 시나리오.
 * 값은 날짜·시각에서 결정적으로 만든다 (같은 시각이면 같은 값, 시간이 지나면 조금씩 변함).
 *
 * 인벤토리 출처 두 가지:
 * - `buildMockWorld(scenario, now, base)`: base = cluster mock 인벤토리(ClusterStateService).
 *   노드·파드·PVC·LB는 base 그대로, AWS 리소스(EC2·EBS·ELB)는 base에서 만든다 → 클러스터 화면과 일치.
 *   비용 시나리오가 요구하는 가상 노드(spike-* 추가 노드, unpriced GPU 노드)만 비용 쪽에 덧붙인다.
 * - base 없음: 이 파일의 자체 인벤토리 (단위 테스트, 클러스터 연결이 없는 구성).
 */
import {
  instanceIdFromProviderId,
  k8sMinorVersion,
  type ClusterInventorySnapshot,
  type InventoryLbAttachment,
  type InventoryNode,
  type InventoryPod,
  type InventoryPvc,
} from '../cluster-inventory.port';
import { addDays, addUtcMonths, floorTo, utcDayStart, ymd } from '../cost-util';
import {
  spotKey,
  type AwsInstance,
  type AwsLoadBalancer,
  type AwsResourceSnapshot,
  type AwsVolume,
  type CeDailyResult,
  type CeForecastResult,
  type PriceBook,
  type PriceQuote,
  type RateSample,
  type Unavailable,
} from '../cost.types';

export const COST_SCENARIOS = [
  'normal',
  'budget-warning',
  'budget-over',
  'spike-warning',
  'spike-critical',
  'forecast-unavailable',
  'ce-unavailable',
  'ce-limit-reached',
  'unpriced',
  'spot-fallback',
  'baseline-collecting',
  'no-budget',
] as const;
export type CostScenario = (typeof COST_SCENARIOS)[number];
export const DEFAULT_COST_SCENARIO: CostScenario = 'normal';

export const COST_SCENARIO_OPTIONS: readonly {
  id: CostScenario;
  label: string;
  description: string;
}[] = [
  { id: 'normal', label: '정상 (기본)', description: '예산·급증 정상' },
  {
    id: 'budget-warning',
    label: '예산 주의',
    description: '월말 예측이 예산의 90% 이상',
  },
  {
    id: 'budget-over',
    label: '예산 초과',
    description: '확정 누적이 예산 이상',
  },
  {
    id: 'spike-warning',
    label: '급증 주의',
    description: '노드 3대 추가로 소모율 급증 주의 · 서비스 일별 급증',
  },
  {
    id: 'spike-critical',
    label: '급증',
    description: '노드 6대 추가로 소모율 급증 · 일별 확정 급증',
  },
  {
    id: 'forecast-unavailable',
    label: 'AWS 예측 불가',
    description: '추정 월말로 예산 판단 (추정 기준)',
  },
  {
    id: 'ce-unavailable',
    label: 'Cost Explorer 사용 불가',
    description: 'AccessDenied — 확정·예측 영역 알 수 없음',
  },
  {
    id: 'ce-limit-reached',
    label: 'CE 호출 한도 도달',
    description: '일일 호출 한도 도달 · 캐시 표시',
  },
  {
    id: 'unpriced',
    label: '단가 없음 포함',
    description: '단가를 찾지 못한 GPU 노드·CLB 포함',
  },
  {
    id: 'spot-fallback',
    label: '스팟 시세 실패',
    description: '스팟 시세 조회 실패 → 온디맨드 상한',
  },
  {
    id: 'baseline-collecting',
    label: '기준 수집 중',
    description: '소모율 기록 24시간 미만',
  },
  { id: 'no-budget', label: '예산 미설정', description: '예산 영역 숨김' },
];

export const MOCK_CLUSTER_NAME = 'prod-eks';
export const MOCK_REGION = 'ap-northeast-2';
const GI = 1024 ** 3;

// ---------------------------------------------------------------------------
// 결정적 난수
// ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

/** -1 ~ 1 */
function noise(seed: string): number {
  return hash(seed) * 2 - 1;
}

// ---------------------------------------------------------------------------
// 인벤토리 + AWS 리소스
// ---------------------------------------------------------------------------

interface NodeSpec {
  name: string;
  id: string;
  type: string;
  capacity: 'on_demand' | 'spot';
  zone: string;
  group: string;
  arch: string;
  cpu: number;
  memGi: number;
  publicIp: boolean;
}

const ALLOC: Record<string, { cpu: number; memGi: number }> = {
  'm6i.large': { cpu: 1930, memGi: 6.9 },
  'm6i.xlarge': { cpu: 3920, memGi: 14.5 },
  'c7i.xlarge': { cpu: 3920, memGi: 6.9 },
  'g6e.xlarge': { cpu: 3920, memGi: 29 },
};

function node(
  i: number,
  type: string,
  capacity: 'on_demand' | 'spot',
  zone: string,
  group: string,
  publicIp = false,
): NodeSpec {
  const ipB = 10 + Math.floor(i / 10);
  const name = `ip-10-0-${ipB}-${(i * 7) % 250}.${MOCK_REGION}.compute.internal`;
  const hex = (i * 2654435761).toString(16).padStart(8, '0').slice(-8);
  return {
    name,
    id: `i-0${hex}${hex.slice(0, 8)}`,
    type,
    capacity,
    zone: `${MOCK_REGION}${zone}`,
    group,
    arch: type.includes('g.') ? 'arm64' : 'amd64',
    cpu: ALLOC[type]?.cpu ?? 1930,
    memGi: ALLOC[type]?.memGi ?? 6.9,
    publicIp,
  };
}

function nodesFor(scenario: CostScenario): NodeSpec[] {
  const list: NodeSpec[] = [
    node(1, 'm6i.xlarge', 'on_demand', 'a', 'general'),
    node(2, 'm6i.xlarge', 'on_demand', 'b', 'general'),
    node(3, 'm6i.large', 'on_demand', 'a', 'batch'),
    node(4, 'm6i.large', 'spot', 'c', 'spot-workers', true),
    node(5, 'c7i.xlarge', 'spot', 'a', 'spot-workers', true),
  ];
  const extra =
    scenario === 'spike-warning' ? 3 : scenario === 'spike-critical' ? 6 : 0;
  for (let i = 0; i < extra; i += 1)
    list.push(
      node(60 + i, 'm6i.xlarge', 'on_demand', i % 2 === 0 ? 'a' : 'b', 'batch'),
    );
  if (scenario === 'unpriced')
    list.push(node(9, 'g6e.xlarge', 'on_demand', 'a', 'gpu'));
  return list;
}

interface PodSpec {
  ns: string;
  name: string;
  cpu: number | null;
  memMi: number | null;
}

/** 노드 순서대로 파드 배치 (requests 합이 할당 가능량 안) */
function podsFor(nodes: NodeSpec[]): InventoryPod[] {
  const byGroup = (g: string) => nodes.filter((n) => n.group === g);
  const pods: InventoryPod[] = [];
  const put = (n: NodeSpec | undefined, p: PodSpec, phase = 'Running') => {
    pods.push({
      namespace: p.ns,
      name: p.name,
      nodeName: n ? n.name : null,
      phase: n ? phase : 'Pending',
      cpuMillicores: p.cpu,
      memoryBytes: p.memMi === null ? null : Math.round(p.memMi * 1024 * 1024),
    });
  };
  const [g1, g2] = byGroup('general');
  const [b1, ...bExtra] = byGroup('batch');
  const [s1, s2] = byGroup('spot-workers');
  // prod
  put(g1, { ns: 'prod', name: 'api-7c9d8-abcde', cpu: 500, memMi: 1024 });
  put(g1, { ns: 'prod', name: 'api-7c9d8-fghij', cpu: 500, memMi: 1024 });
  put(g2, { ns: 'prod', name: 'api-7c9d8-klmno', cpu: 500, memMi: 1024 });
  put(g2, { ns: 'prod', name: 'web-5f6b7-pqrst', cpu: 250, memMi: 512 });
  put(g1, { ns: 'prod', name: 'web-5f6b7-uvwxy', cpu: 250, memMi: 512 });
  // data
  put(g2, { ns: 'data', name: 'postgres-0', cpu: 1000, memMi: 4096 });
  put(g1, { ns: 'data', name: 'pgbouncer-6d5c4-aaaaa', cpu: 100, memMi: 128 });
  put(g2, { ns: 'data', name: 'pgbouncer-6d5c4-bbbbb', cpu: 100, memMi: 128 });
  // monitoring
  put(g1, { ns: 'monitoring', name: 'prometheus-0', cpu: 500, memMi: 2048 });
  put(g2, {
    ns: 'monitoring',
    name: 'grafana-8b7a6-ccccc',
    cpu: 100,
    memMi: 256,
  });
  // batch
  put(b1, { ns: 'batch', name: 'worker-0', cpu: 800, memMi: 2048 });
  put(b1, { ns: 'batch', name: 'worker-1', cpu: null, memMi: null });
  put(s1, { ns: 'batch', name: 'worker-2', cpu: 800, memMi: 2048 });
  put(s2, { ns: 'batch', name: 'worker-3', cpu: 1500, memMi: 3072 });
  put(s2, { ns: 'batch', name: 'worker-4', cpu: null, memMi: null });
  put(
    s1,
    { ns: 'batch', name: 'report-28f1-done', cpu: 500, memMi: 1024 },
    'Succeeded',
  );
  bExtra.forEach((n, i) => {
    put(n, { ns: 'batch', name: `burst-${i}-a`, cpu: 1500, memMi: 6144 });
    put(n, { ns: 'batch', name: `burst-${i}-b`, cpu: 1500, memMi: 4096 });
  });
  for (const g of byGroup('gpu'))
    put(g, { ns: 'ml', name: 'trainer-0', cpu: 3000, memMi: 16384 });
  // default: requests 미설정
  put(g2, { ns: 'default', name: 'legacy-web-1', cpu: null, memMi: null });
  put(g1, { ns: 'default', name: 'legacy-web-2', cpu: null, memMi: null });
  // kube-system (데몬셋 + 애드온)
  nodes.forEach((n, i) => {
    put(n, { ns: 'kube-system', name: `aws-node-${i}`, cpu: 25, memMi: 64 });
    put(n, { ns: 'kube-system', name: `kube-proxy-${i}`, cpu: 100, memMi: 64 });
    put(n, {
      ns: 'kube-system',
      name: `ebs-csi-node-${i}`,
      cpu: 30,
      memMi: 120,
    });
  });
  put(g1, {
    ns: 'kube-system',
    name: 'coredns-5d7c-aaaaa',
    cpu: 100,
    memMi: 70,
  });
  put(g2, {
    ns: 'kube-system',
    name: 'coredns-5d7c-bbbbb',
    cpu: 100,
    memMi: 70,
  });
  return pods;
}

const PVCS: (InventoryPvc & {
  volumeId: string;
  type: string;
  sizeGiB: number;
  iops: number | null;
  tp: number | null;
  attach: number | null;
})[] = [
  {
    namespace: 'data',
    name: 'data-postgres-0',
    sizeBytes: 100 * GI,
    storageClass: 'gp3',
    volumeHandle: null,
    volumeId: 'vol-0a1b2c3d4e5f60001',
    type: 'gp3',
    sizeGiB: 100,
    iops: 3000,
    tp: 125,
    attach: 2,
  },
  {
    namespace: 'monitoring',
    name: 'prometheus-db-prometheus-0',
    sizeBytes: 50 * GI,
    storageClass: 'gp3',
    volumeHandle: null,
    volumeId: 'vol-0a1b2c3d4e5f60002',
    type: 'gp3',
    sizeGiB: 50,
    iops: 6000,
    tp: 250,
    attach: 1,
  },
  {
    namespace: 'batch',
    name: 'scratch-worker-0',
    sizeBytes: 200 * GI,
    storageClass: 'gp2',
    volumeHandle: null,
    volumeId: 'vol-0a1b2c3d4e5f60003',
    type: 'gp2',
    sizeGiB: 200,
    iops: 600,
    tp: null,
    attach: 3,
  },
  {
    namespace: 'prod',
    name: 'uploads',
    sizeBytes: 20 * GI,
    storageClass: 'gp3',
    volumeHandle: null,
    volumeId: 'vol-0a1b2c3d4e5f60004',
    type: 'gp3',
    sizeGiB: 20,
    iops: 3000,
    tp: 125,
    attach: null,
  },
];

const LB_ATTACH: InventoryLbAttachment[] = [
  {
    kind: 'Ingress',
    namespace: 'prod',
    name: 'api',
    hostnames: [
      'k8s-prod-api-3f2a1b-123456789.ap-northeast-2.elb.amazonaws.com',
    ],
  },
  {
    kind: 'Service',
    namespace: 'data',
    name: 'pgbouncer',
    hostnames: [
      'k8s-data-pgbouncer-9e8d7c-abcdef.elb.ap-northeast-2.amazonaws.com',
    ],
  },
  {
    kind: 'Service',
    namespace: 'default',
    name: 'legacy-web',
    hostnames: ['legacy-web-1234567890.ap-northeast-2.elb.amazonaws.com'],
  },
];

/** 다른 클러스터의 CSI 볼륨 (클러스터 외로 분류돼야 함) */
const OTHER_CLUSTER_VOLUMES: readonly AwsVolume[] = [
  {
    volumeId: 'vol-0other00000000001',
    volumeType: 'gp3',
    sizeGiB: 30,
    iops: 3000,
    throughputMibps: 125,
    zone: `${MOCK_REGION}a`,
    state: 'available',
    attachedInstanceIds: [],
    pvcNamespace: 'staging',
    pvcName: 'data-old-0',
    csiManaged: true,
  },
  {
    volumeId: 'vol-0other00000000002',
    volumeType: 'gp2',
    sizeGiB: 8,
    iops: 100,
    throughputMibps: null,
    zone: `${MOCK_REGION}b`,
    state: 'available',
    attachedInstanceIds: [],
    pvcNamespace: 'staging',
    pvcName: 'cache-0',
    csiManaged: true,
  },
];

/** 클러스터 태그만 있고 대상이 없는 NLB, 클러스터와 무관한 ALB */
const UNATTACHED_LBS: readonly AwsLoadBalancer[] = [
  {
    name: 'k8s-shared-edge-77aa11',
    dnsName: 'k8s-shared-edge-77aa11.elb.ap-northeast-2.amazonaws.com',
    lbType: 'nlb',
    tagRefs: [],
    clusterTags: [MOCK_CLUSTER_NAME],
    healthyTargets: 0,
  },
  {
    name: 'marketing-site-alb',
    dnsName: 'marketing-site-alb-42.ap-northeast-2.elb.amazonaws.com',
    lbType: 'alb',
    tagRefs: [],
    clusterTags: [],
    healthyTargets: 4,
  },
];

export interface MockWorld {
  inventory: ClusterInventorySnapshot;
  aws: AwsResourceSnapshot;
}

export function buildMockWorld(
  scenario: CostScenario,
  now: Date,
  base?: ClusterInventorySnapshot | null,
): MockWorld {
  if (base) return buildMockWorldFromCluster(scenario, now, base);
  const nodes = nodesFor(scenario);
  const invNodes: InventoryNode[] = nodes.map((n) => ({
    name: n.name,
    providerId: `aws:///${n.zone}/${n.id}`,
    instanceType: n.type,
    capacityType: n.capacity,
    zone: n.zone,
    nodeGroup: n.group,
    architecture: n.arch,
    allocatable: {
      cpuMillicores: n.cpu,
      memoryBytes: Math.round(n.memGi * GI),
    },
  }));
  const instances: AwsInstance[] = nodes.map((n, i) => ({
    instanceId: n.id,
    instanceType: n.type,
    zone: n.zone,
    lifecycle: n.capacity,
    architecture: n.arch,
    publicIpv4Count: n.publicIp ? 1 : 0,
    rootVolumeIds: [`vol-0root${String(i + 1).padStart(12, '0')}`],
    nodeGroupTag: n.group,
  }));
  const volumes: AwsVolume[] = [];
  nodes.forEach((n, i) =>
    volumes.push({
      volumeId: `vol-0root${String(i + 1).padStart(12, '0')}`,
      volumeType: 'gp3',
      sizeGiB: 20,
      iops: 3000,
      throughputMibps: 125,
      zone: n.zone,
      state: 'in-use',
      attachedInstanceIds: [n.id],
      pvcNamespace: null,
      pvcName: null,
      csiManaged: false,
    }),
  );
  for (const p of PVCS) {
    const attachNode = p.attach !== null ? nodes[p.attach - 1] : undefined;
    volumes.push({
      volumeId: p.volumeId,
      volumeType: p.type,
      sizeGiB: p.sizeGiB,
      iops: p.iops,
      throughputMibps: p.tp,
      zone: attachNode?.zone ?? `${MOCK_REGION}a`,
      state: attachNode ? 'in-use' : 'available',
      attachedInstanceIds: attachNode ? [attachNode.id] : [],
      pvcNamespace: p.namespace,
      pvcName: p.name,
      csiManaged: true,
    });
  }
  // 다른 클러스터의 CSI 볼륨 (클러스터 외)
  volumes.push(...OTHER_CLUSTER_VOLUMES.map((v) => ({ ...v })));
  const lbs: AwsLoadBalancer[] = [
    {
      name: 'k8s-prod-api-3f2a1b',
      dnsName: LB_ATTACH[0].hostnames[0],
      lbType: 'alb',
      tagRefs: [],
      clusterTags: [MOCK_CLUSTER_NAME],
      healthyTargets: 3,
    },
    {
      name: 'k8s-data-pgbouncer-9e8d7c',
      dnsName: LB_ATTACH[1].hostnames[0],
      lbType: 'nlb',
      tagRefs: [{ kind: 'Service', namespace: 'data', name: 'pgbouncer' }],
      clusterTags: [MOCK_CLUSTER_NAME],
      healthyTargets: 2,
    },
    ...UNATTACHED_LBS.map((l) => ({ ...l })),
  ];
  if (scenario === 'unpriced') {
    lbs.push({
      name: 'legacy-web',
      dnsName: LB_ATTACH[2].hostnames[0],
      lbType: 'clb',
      tagRefs: [],
      clusterTags: [],
      healthyTargets: 2,
    });
  }
  return {
    inventory: {
      state: 'ok',
      updatedAt: now,
      nodes: invNodes,
      pods: podsFor(nodes),
      pvcs: PVCS.map(({ namespace, name, sizeBytes, storageClass }) => ({
        namespace,
        name,
        sizeBytes,
        storageClass,
        volumeHandle: null,
      })),
      loadBalancers: LB_ATTACH,
    },
    aws: {
      fetchedAt: floorTo(now, 300),
      instances,
      volumes,
      loadBalancers: lbs,
      eks: { name: MOCK_CLUSTER_NAME, version: '1.34' },
    },
  };
}

// ---------------------------------------------------------------------------
// cluster mock 인벤토리 기준 세계
// ---------------------------------------------------------------------------

/** 32비트 FNV-1a를 16진수 8자리로 (결정적 ID용) */
function hex8(s: string): string {
  return Math.floor(hash(s) * 0xffffffff)
    .toString(16)
    .padStart(8, '0');
}

/** EC2 인스턴스 ID. providerID에서 못 뽑으면 노드 이름으로 결정적으로 만든다 */
function mockInstanceId(n: InventoryNode): string {
  return (
    instanceIdFromProviderId(n.providerId) ??
    `i-0${hex8(n.name)}${hex8(`${n.name}|id`)}`
  );
}

const EBS_TYPES = new Set(['gp3', 'gp2', 'io2', 'io1', 'st1', 'sc1']);

/** NLB DNS: `<name>-<id>.elb.<region>.amazonaws.com`, CLB/ALB: `<name>-<id>.<region>.elb.amazonaws.com` */
const NLB_HOST_RE = /\.elb\.[a-z0-9-]+\.amazonaws\.com$/i;

function lbNameFromHost(host: string): string {
  const label = host.split('.')[0] ?? host;
  const i = label.lastIndexOf('-');
  return i > 0 ? label.slice(0, i) : label;
}

/** 비용 시나리오가 요구하는 가상 노드 (클러스터 화면에는 없다) */
function scenarioExtraNodes(scenario: CostScenario): NodeSpec[] {
  const out: NodeSpec[] = [];
  const extra =
    scenario === 'spike-warning' ? 3 : scenario === 'spike-critical' ? 6 : 0;
  for (let i = 0; i < extra; i += 1)
    out.push(
      node(60 + i, 'm6i.xlarge', 'on_demand', i % 2 === 0 ? 'a' : 'b', 'batch'),
    );
  if (scenario === 'unpriced')
    out.push(node(9, 'g6e.xlarge', 'on_demand', 'a', 'gpu'));
  return out;
}

function scenarioExtraPods(extra: NodeSpec[]): InventoryPod[] {
  const pods: InventoryPod[] = [];
  const put = (
    n: NodeSpec,
    ns: string,
    name: string,
    cpu: number,
    memMi: number,
  ) =>
    pods.push({
      namespace: ns,
      name,
      nodeName: n.name,
      phase: 'Running',
      cpuMillicores: cpu,
      memoryBytes: Math.round(memMi * 1024 * 1024),
    });
  extra.forEach((n, i) => {
    if (n.group === 'gpu') put(n, 'ml', 'trainer-0', 3000, 16384);
    else {
      put(n, 'batch', `burst-${i}-a`, 1500, 6144);
      put(n, 'batch', `burst-${i}-b`, 1500, 4096);
    }
    put(n, 'kube-system', `aws-node-x${i}`, 25, 64);
    put(n, 'kube-system', `kube-proxy-x${i}`, 100, 64);
  });
  return pods;
}

/**
 * cluster mock 인벤토리(base)로 비용 mock 세계를 만든다.
 * - 인벤토리: base 노드·파드·PVC·LB 그대로 + 시나리오 가상 노드·파드
 * - EC2: 노드마다 1대 (스팟 노드는 퍼블릭 IPv4 1개), 루트 볼륨 gp3 20GiB
 * - EBS: Bound PVC마다 1개 (CSI 태그로 PVC 대조). Pending·Lost PVC는 볼륨 없음
 * - ELB: LoadBalancer 서비스·인그레스의 호스트 이름마다 1개. 인그레스 → ALB, `.elb.<region>.` → NLB, 그 밖 → CLB.
 *   live는 CLB를 조회하지 않으므로(SDK 없음) CLB는 `unpriced` 시나리오에서만 넣는다.
 * - 클러스터 밖 리소스(다른 클러스터 볼륨·마케팅 ALB)와 태그만 있는 NLB는 자체 세계와 같다.
 */
function buildMockWorldFromCluster(
  scenario: CostScenario,
  now: Date,
  base: ClusterInventorySnapshot,
): MockWorld {
  const extra = scenarioExtraNodes(scenario);
  const invNodes: InventoryNode[] = [
    ...base.nodes.map((n) => {
      const id = mockInstanceId(n);
      return {
        ...n,
        allocatable: { ...n.allocatable },
        providerId: instanceIdFromProviderId(n.providerId)
          ? n.providerId
          : `aws:///${n.zone ?? `${MOCK_REGION}a`}/${id}`,
      };
    }),
    ...extra.map((n): InventoryNode => ({
      name: n.name,
      providerId: `aws:///${n.zone}/${n.id}`,
      instanceType: n.type,
      capacityType: n.capacity,
      zone: n.zone,
      nodeGroup: n.group,
      architecture: n.arch,
      allocatable: {
        cpuMillicores: n.cpu,
        memoryBytes: Math.round(n.memGi * GI),
      },
    })),
  ];
  const pods: InventoryPod[] = [
    ...base.pods.map((p) => ({ ...p })),
    ...scenarioExtraPods(extra),
  ];

  const instances: AwsInstance[] = invNodes.map((n, i) => ({
    instanceId: mockInstanceId(n),
    instanceType: n.instanceType ?? 'unknown',
    zone: n.zone,
    lifecycle: n.capacityType === 'spot' ? 'spot' : 'on_demand',
    architecture: n.architecture,
    publicIpv4Count: n.capacityType === 'spot' ? 1 : 0,
    rootVolumeIds: [`vol-0root${String(i + 1).padStart(12, '0')}`],
    nodeGroupTag: n.nodeGroup,
  }));
  const instanceByNode = new Map(
    invNodes.map((n, i) => [n.name, instances[i]]),
  );

  const volumes: AwsVolume[] = instances.map((inst) => ({
    volumeId: inst.rootVolumeIds[0],
    volumeType: 'gp3',
    sizeGiB: 20,
    iops: 3000,
    throughputMibps: 125,
    zone: inst.zone,
    state: 'in-use',
    attachedInstanceIds: [inst.instanceId],
    pvcNamespace: null,
    pvcName: null,
    csiManaged: false,
  }));
  for (const p of base.pvcs) {
    if (p.phase === 'Pending' || p.phase === 'Lost' || !p.sizeBytes) continue;
    const type =
      p.storageClass && EBS_TYPES.has(p.storageClass) ? p.storageClass : 'gp3';
    const sizeGiB = Math.max(1, Math.ceil(p.sizeBytes / GI));
    // StatefulSet PVC(<claim>-<pod>) → 그 파드의 노드, 아니면 같은 네임스페이스 파드의 노드
    const owner =
      pods.find(
        (x) =>
          x.namespace === p.namespace &&
          x.nodeName &&
          p.name.endsWith(`-${x.name}`),
      ) ??
      pods.find(
        (x) =>
          x.namespace === p.namespace &&
          x.nodeName &&
          x.name.startsWith(p.name),
      );
    const inst = owner?.nodeName ? instanceByNode.get(owner.nodeName) : null;
    volumes.push({
      volumeId: `vol-0${hex8(`${p.namespace}/${p.name}`)}${hex8(`${p.name}|vol`)}`,
      volumeType: type,
      sizeGiB,
      iops:
        type === 'gp3'
          ? 3000
          : type === 'gp2'
            ? Math.min(16000, Math.max(100, sizeGiB * 3))
            : type.startsWith('io')
              ? 3000
              : null,
      throughputMibps: type === 'gp3' ? 125 : null,
      zone: inst?.zone ?? `${MOCK_REGION}a`,
      state: inst ? 'in-use' : 'available',
      attachedInstanceIds: inst ? [inst.instanceId] : [],
      pvcNamespace: p.namespace,
      pvcName: p.name,
      csiManaged: true,
    });
  }
  volumes.push(...OTHER_CLUSTER_VOLUMES.map((v) => ({ ...v })));

  const lbs: AwsLoadBalancer[] = [];
  const seen = new Set<string>();
  for (const a of base.loadBalancers) {
    for (const host of a.hostnames) {
      const key = host.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const lbType: AwsLoadBalancer['lbType'] =
        a.kind === 'Ingress' ? 'alb' : NLB_HOST_RE.test(host) ? 'nlb' : 'clb';
      if (lbType === 'clb' && scenario !== 'unpriced') continue;
      lbs.push({
        name: lbNameFromHost(host),
        dnsName: host,
        lbType,
        tagRefs:
          lbType === 'nlb'
            ? [{ kind: a.kind, namespace: a.namespace, name: a.name }]
            : [],
        clusterTags: lbType === 'clb' ? [] : [MOCK_CLUSTER_NAME],
        healthyTargets: 2,
      });
    }
  }
  lbs.push(...UNATTACHED_LBS.map((l) => ({ ...l })));

  return {
    inventory: {
      state: base.state,
      updatedAt: base.updatedAt ?? now,
      kubernetesVersion: base.kubernetesVersion ?? null,
      nodes: invNodes,
      pods,
      pvcs: base.pvcs.map((p) => ({ ...p })),
      loadBalancers: base.loadBalancers.map((l) => ({
        ...l,
        hostnames: [...l.hostnames],
      })),
    },
    aws: {
      fetchedAt: floorTo(now, 300),
      instances,
      volumes,
      loadBalancers: lbs,
      // EKS 지원 등급은 클러스터 버전 기준 (없으면 자체 세계와 같은 1.34)
      eks: {
        name: MOCK_CLUSTER_NAME,
        version: k8sMinorVersion(base.kubernetesVersion ?? null) ?? '1.34',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 단가
// ---------------------------------------------------------------------------

export const MOCK_ON_DEMAND: Record<string, number> = {
  'm6i.large': 0.118,
  'm6i.xlarge': 0.236,
  'm6i.2xlarge': 0.472,
  'm7g.large': 0.0998,
  'm7g.xlarge': 0.1996,
  'c7i.large': 0.1071,
  'c7i.xlarge': 0.2142,
  'c7g.xlarge': 0.1812,
  'c7g.large': 0.0906,
};
const MOCK_SPOT_BASE: Record<string, number> = {
  'm6i.large': 0.0395,
  'm6i.xlarge': 0.079,
  'c7i.xlarge': 0.0712,
  'c7i.large': 0.0356,
  'm7g.large': 0.0336,
  'm7g.xlarge': 0.0672,
};

/** 스팟 시세: 15분마다 조금씩 바뀐다 (±4%) */
export function mockSpotPrice(
  type: string,
  zone: string,
  now: Date,
): number | null {
  const base = MOCK_SPOT_BASE[type];
  if (base === undefined) return null;
  const slot = floorTo(now, 900).toISOString();
  return (
    Math.round(base * (1 + 0.04 * noise(`${type}|${zone}|${slot}`)) * 1e4) / 1e4
  );
}

export function mockPriceBook(
  scenario: CostScenario,
  world: MockWorld,
  now: Date,
): PriceBook {
  const pricingAt = floorTo(addDays(now, -0.25), 86400).toISOString();
  const spotAt = floorTo(now, 3600).toISOString();
  const q = (usd: number): PriceQuote => ({
    usd,
    fetchedAt: pricingAt,
    cacheUsed: false,
  });
  const onDemand: PriceBook['onDemand'] = {};
  for (const [k, v] of Object.entries(MOCK_ON_DEMAND)) onDemand[k] = q(v);
  const spot: PriceBook['spot'] = {};
  const failType =
    scenario === 'spot-fallback' ? spotFallbackType(world.inventory) : null;
  for (const n of world.inventory.nodes) {
    if (n.capacityType !== 'spot' || !n.instanceType || !n.zone) continue;
    const failed = failType !== null && n.instanceType === failType;
    const usd = failed ? null : mockSpotPrice(n.instanceType, n.zone, now);
    spot[spotKey(n.instanceType, n.zone)] =
      usd === null ? null : { usd, fetchedAt: spotAt, zone: n.zone };
  }
  return {
    onDemand,
    spot,
    ebs: {
      gp3: { storage: q(0.0912), iops: q(0.0057), throughput: q(0.0456) },
      gp2: { storage: q(0.114), iops: null, throughput: null },
      io2: { storage: q(0.1426), iops: q(0.0741), throughput: null },
    },
    lb: { alb: q(0.0225), nlb: q(0.0225) },
    ipv4: q(0.005),
    eks: { standard: q(0.1), extended: q(0.6) },
    meta: {
      fetchedAt: pricingAt,
      cacheUsed: false,
      cacheFetchedAt: null,
      allFailed: false,
      spotFetchedAt: spotAt,
    },
  };
}

/**
 * spot-fallback 시나리오에서 시세 조회가 실패하는 인스턴스 타입.
 * c7i.xlarge 스팟 노드가 있으면 그것(자체 인벤토리), 없으면 이름순 마지막 스팟 노드의 타입.
 */
function spotFallbackType(inv: ClusterInventorySnapshot): string | null {
  const spot = inv.nodes
    .filter((n) => n.capacityType === 'spot' && n.instanceType)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (spot.some((n) => n.instanceType === 'c7i.xlarge')) return 'c7i.xlarge';
  return spot.at(-1)?.instanceType ?? null;
}

// ---------------------------------------------------------------------------
// Cost Explorer
// ---------------------------------------------------------------------------

const SERVICE_BASE: [string, number][] = [
  ['Amazon Elastic Compute Cloud - Compute', 14.5],
  ['EC2 - Other', 3.2],
  ['Amazon Elastic Container Service for Kubernetes', 2.4],
  ['Amazon Elastic Load Balancing', 1.3],
  ['Amazon Virtual Private Cloud', 0.9],
  ['AmazonCloudWatch', 0.7],
  ['Amazon Simple Storage Service', 0.6],
  ['Amazon Elastic Container Registry', 0.15],
  ['AWS Cost Explorer', 0.12],
  ['AWS Key Management Service', 0.1],
  ['AWS Secrets Manager', 0.08],
  ['Amazon Route 53', 0.05],
  ['Amazon Simple Notification Service', 0.01],
];

/** CE 조회 시각: 가장 최근 6시간 경계 (자동 갱신처럼 보이게) */
export function mockCeFetchedAt(now: Date): Date {
  return floorTo(now, 6 * 3600);
}

export function mockCeDaily(scenario: CostScenario, now: Date): CeDailyResult {
  const today = utcDayStart(now);
  const from = addUtcMonths(now, -1);
  const settled = ymd(addDays(today, -2));
  const yesterday = ymd(addDays(today, -1));
  const days: CeDailyResult['days'] = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    const date = ymd(d);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.93 : 1;
    const lastMonth = d.getUTCMonth() !== today.getUTCMonth() ? 0.92 : 1;
    const byService: Record<string, number> = {};
    let total = 0;
    for (const [svc, base] of SERVICE_BASE) {
      let v = base * weekend * lastMonth * (1 + 0.08 * noise(`${svc}|${date}`));
      if (
        date === settled &&
        scenario === 'spike-critical' &&
        svc.endsWith('Compute')
      )
        v *= 3.5;
      if (
        date === settled &&
        scenario === 'spike-warning' &&
        svc === 'EC2 - Other'
      )
        v *= 3.5;
      if (date === yesterday) v *= 0.6; // 아직 채워지는 중
      v = Math.round(v * 1e4) / 1e4;
      byService[svc] = v;
      total += v;
    }
    days.push({ date, total, byService });
  }
  return { start: ymd(from), end: ymd(today), metric: 'UnblendedCost', days };
}

export function mockCeForecast(now: Date): CeForecastResult {
  const today = utcDayStart(now);
  const end = addUtcMonths(now, 1);
  const days: CeForecastResult['days'] = [];
  let total = 0;
  for (let d = today; d < end; d = addDays(d, 1)) {
    const date = ymd(d);
    const mean = 24.6 * (1 + 0.03 * noise(`fc|${date}`));
    const spread = 0.08 + 0.01 * days.length;
    days.push({
      date,
      mean: Math.round(mean * 100) / 100,
      low: Math.round(mean * (1 - spread) * 100) / 100,
      high: Math.round(mean * (1 + spread) * 100) / 100,
    });
    total += mean;
  }
  return {
    start: ymd(today),
    end: ymd(end),
    totalUsd: Math.round(total * 100) / 100,
    days,
  };
}

export function mockCeErrors(scenario: CostScenario): {
  daily: Unavailable | null;
  forecast: Unavailable | null;
} {
  if (scenario === 'ce-unavailable') {
    const u = {
      code: 'CE_ACCESS_DENIED',
      message: 'Cost Explorer 사용 불가: AccessDenied',
    };
    return { daily: u, forecast: u };
  }
  if (scenario === 'forecast-unavailable') {
    return {
      daily: null,
      forecast: {
        code: 'CE_FORECAST_UNAVAILABLE',
        message: 'AWS 예측 불가 (데이터 부족)',
      },
    };
  }
  return { daily: null, forecast: null };
}

/**
 * mock 예산: 시나리오가 재현되도록 현재 값에서 역산한다 (날짜와 무관하게 같은 판단).
 */
export function mockBudgetUsd(
  scenario: CostScenario,
  ctx: {
    monthToDateUsd: number | null;
    forecastMonthEndUsd: number | null;
    estimatedMonthEndUsd: number | null;
  },
): number | null {
  const round10 = (n: number) => Math.max(10, Math.round(n / 10) * 10);
  const projected = ctx.forecastMonthEndUsd ?? ctx.estimatedMonthEndUsd;
  switch (scenario) {
    case 'no-budget':
      return null;
    case 'budget-over':
      return ctx.monthToDateUsd !== null
        ? round10(ctx.monthToDateUsd * 0.95)
        : 100;
    case 'budget-warning':
    case 'forecast-unavailable':
      return projected !== null
        ? Math.max(
            round10(projected / 0.96),
            round10((ctx.monthToDateUsd ?? 0) * 1.2),
          )
        : 800;
    default:
      return projected !== null ? round10(projected / 0.7) : 1000;
  }
}

// ---------------------------------------------------------------------------
// 소모율 기록
// ---------------------------------------------------------------------------

/** 기준 수준 주변으로 흔들리는 5분 표본 (최근 90일, baseline-collecting은 14시간) */
export function mockRateHistory(
  scenario: CostScenario,
  baselineUsdPerHour: number,
  now: Date,
): RateSample[] {
  const end = floorTo(now, 300).getTime();
  const hours = scenario === 'baseline-collecting' ? 14 : 90 * 24;
  const out: RateSample[] = [];
  for (let t = end - hours * 3600_000; t < end; t += 300_000) {
    const d = new Date(t);
    const daily =
      Math.sin((2 * Math.PI * (t % 86_400_000)) / 86_400_000) * 0.025;
    const jitter = 0.01 * noise(`rate|${t}`);
    out.push({
      sampledAt: d,
      totalUsdPerHour:
        Math.round(baselineUsdPerHour * (1 + daily + jitter) * 1e6) / 1e6,
    });
  }
  return out;
}
