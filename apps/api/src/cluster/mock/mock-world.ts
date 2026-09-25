/**
 * mock 클러스터 (DATA_SOURCE=mock). 시나리오별로 가짜 클러스터를 만든다 (docs/api/common.md 6.1).
 * 이름·값은 가상이다. 시간에 따른 흔들림은 MockClusterService가 준다.
 */
import type {
  NodeRole,
  RawContainer,
  RawEvent,
  RawHpa,
  RawIngress,
  RawNode,
  RawPdb,
  RawPod,
  RawPvc,
  RawService,
  RawWorkload,
  WorkloadKind,
} from '../model';

export const CLUSTER_SCENARIOS = [
  'mixed',
  'healthy',
  'warning',
  'critical',
  'no-metrics',
  'kube-stale',
  'no-cluster',
  'empty',
  // 토큰 만료 재현 (mock으로 대체되지 않는 것을 확인. common.md 2.3·AC-KOPS38)
  'kube-auth-failed',
  // 컨트롤 플레인 (AC-KOPS25)
  'cp-healthy',
  'cp-single',
  'cp-node-down',
  'cp-quorum-lost',
  'cp-component-crash',
  'cp-not-found',
] as const;

/** 컨트롤 플레인 시나리오 여부 */
export function isControlPlaneScenario(s: ClusterScenario): boolean {
  return s.startsWith('cp-');
}
export type ClusterScenario = (typeof CLUSTER_SCENARIOS)[number];

const GI = 1024 ** 3;
const MI = 1024 ** 2;

export interface MockPodPlan {
  /** 목표 사용량 (흔들림 중심값) */
  cpu: number;
  mem: number;
  /** CrashLoop: 틱마다 재시작 증가 확률 */
  crashLoop?: boolean;
  /** 과거 1시간 재시작 표본 (분 전) */
  restartMinutesAgo?: number[];
  oomMinutesAgo?: number[];
}

export interface MockWorld {
  info: { name: string; version: string; region: string };
  nodes: RawNode[];
  workloads: RawWorkload[];
  pods: RawPod[];
  events: RawEvent[];
  pvcs: RawPvc[];
  services: RawService[];
  ingresses: RawIngress[];
  pdbs: RawPdb[];
  hpas: RawHpa[];
  namespaces: string[];
  nodeUsage: Map<string, { cpuPct: number; memPct: number }>;
  podPlans: Map<string, MockPodPlan>;
}

/** 결정적 난수 (시나리오마다 같은 이름) */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface NodeSpec {
  name: string;
  group: string;
  type: string;
  zone: string;
  cap: 'on_demand' | 'spot';
  arch: string;
  cpu: number;
  memGi: number;
  pods: number;
  /** 없으면 worker */
  role?: NodeRole;
}

/**
 * 컨트롤 플레인(마스터) 노드. kOps에서는 마스터도 사용자 소유 EC2이고
 * `GET /api/v1/nodes`에 함께 나온다 (kops-support 1.2).
 * 워커와 섞어 세지 않는다 — 목록·개요·메트릭·비용 배분 모두 role로 나눈다.
 */
const CONTROL_PLANE_SPECS: NodeSpec[] = [
  {
    name: 'i-0a1b2c3d4e5f67890',
    group: 'control-plane-ap-northeast-2a',
    type: 't3.medium',
    zone: 'ap-northeast-2a',
    cap: 'on_demand',
    arch: 'amd64',
    cpu: 1930,
    memGi: 3.4,
    pods: 17,
    role: 'control_plane',
  },
  {
    name: 'i-0b2c3d4e5f6789012',
    group: 'control-plane-ap-northeast-2b',
    type: 't3.medium',
    zone: 'ap-northeast-2b',
    cap: 'on_demand',
    arch: 'amd64',
    cpu: 1930,
    memGi: 3.4,
    pods: 17,
    role: 'control_plane',
  },
  {
    name: 'i-0c3d4e5f6a7b8c9d0',
    group: 'control-plane-ap-northeast-2c',
    type: 't3.medium',
    zone: 'ap-northeast-2c',
    cap: 'on_demand',
    arch: 'amd64',
    cpu: 1930,
    memGi: 3.4,
    pods: 17,
    role: 'control_plane',
  },
];

const NODE_SPECS: NodeSpec[] = [
  {
    name: 'i-0d4e5f6a7b8c9d0e1',
    group: 'nodes-system',
    type: 'm6i.large',
    zone: 'ap-northeast-2a',
    cap: 'on_demand',
    arch: 'amd64',
    cpu: 1930,
    memGi: 7.2,
    pods: 29,
  },
  {
    name: 'i-0e5f6a7b8c9d0e1f2',
    group: 'nodes-system',
    type: 'm6i.large',
    zone: 'ap-northeast-2c',
    cap: 'on_demand',
    arch: 'amd64',
    cpu: 1930,
    memGi: 7.2,
    pods: 29,
  },
  {
    name: 'i-0f6a7b8c9d0e1f2a3',
    group: 'nodes-batch',
    type: 'm6i.large',
    zone: 'ap-northeast-2a',
    cap: 'on_demand',
    arch: 'amd64',
    cpu: 1930,
    memGi: 7.2,
    pods: 29,
  },
  {
    name: 'i-0a7b8c9d0e1f2a3b4',
    group: 'nodes-batch',
    type: 'm6i.large',
    zone: 'ap-northeast-2c',
    cap: 'spot',
    arch: 'amd64',
    cpu: 1930,
    memGi: 7.2,
    pods: 29,
  },
  {
    name: 'i-0b8c9d0e1f2a3b4c5',
    group: 'nodes-app-arm64',
    type: 'm7g.xlarge',
    zone: 'ap-northeast-2a',
    cap: 'spot',
    arch: 'arm64',
    cpu: 3920,
    memGi: 14.8,
    pods: 58,
  },
  {
    name: 'i-0c9d0e1f2a3b4c5d6',
    group: 'nodes-app-arm64',
    type: 'm7g.xlarge',
    zone: 'ap-northeast-2c',
    cap: 'on_demand',
    arch: 'arm64',
    cpu: 3920,
    memGi: 14.8,
    pods: 58,
  },
];

interface ContainerTpl {
  name: string;
  image: string;
  req: [number | null, number | null];
  lim: [number | null, number | null];
  probes?: boolean;
}

interface WorkloadSpec {
  kind: WorkloadKind;
  ns: string;
  name: string;
  replicas: number;
  containers: ContainerTpl[];
  group?: string[];
  /** 파드별 사용량 중심값 (cpu mcore, mem bytes) */
  cpu: number;
  mem: number;
  pvcTemplate?: string;
  hostNetwork?: boolean;
  privileged?: boolean;
}

const ECR = '123456789012.dkr.ecr.ap-northeast-2.amazonaws.com';

const WORKLOADS: WorkloadSpec[] = [
  {
    kind: 'Deployment',
    ns: 'kube-system',
    name: 'coredns',
    replicas: 2,
    group: ['nodes-system'],
    cpu: 8,
    mem: 22 * MI,
    containers: [
      {
        name: 'coredns',
        image: 'registry.k8s.io/coredns/coredns:v1.11.1',
        req: [100, 70 * MI],
        lim: [null, 170 * MI],
        probes: true,
      },
    ],
  },
  {
    kind: 'Deployment',
    ns: 'kube-system',
    name: 'metrics-server',
    replicas: 1,
    group: ['nodes-system'],
    cpu: 6,
    mem: 30 * MI,
    containers: [
      {
        name: 'metrics-server',
        image: 'registry.k8s.io/metrics-server/metrics-server:v0.7.1',
        req: [100, 200 * MI],
        lim: [null, null],
        probes: true,
      },
    ],
  },
  {
    kind: 'DaemonSet',
    ns: 'kube-system',
    name: 'cilium',
    replicas: 0,
    cpu: 4,
    mem: 45 * MI,
    hostNetwork: true,
    privileged: true,
    containers: [
      {
        name: 'cilium',
        image: 'quay.io/cilium/cilium:v1.16.3',
        req: [25, null],
        lim: [null, null],
        probes: true,
      },
    ],
  },
  {
    kind: 'DaemonSet',
    ns: 'kube-system',
    name: 'kube-proxy',
    replicas: 0,
    cpu: 2,
    mem: 18 * MI,
    hostNetwork: true,
    privileged: true,
    containers: [
      {
        name: 'kube-proxy',
        image: 'registry.k8s.io/kube-proxy:v1.34.1',
        req: [100, null],
        lim: [null, null],
      },
    ],
  },
  {
    kind: 'Deployment',
    ns: 'prod',
    name: 'api',
    replicas: 3,
    group: ['nodes-app-arm64', 'nodes-batch'],
    cpu: 120,
    mem: 380 * MI,
    containers: [
      {
        name: 'api',
        image: `${ECR}/api:1.4.2`,
        req: [250, 256 * MI],
        lim: [500, 512 * MI],
        probes: true,
      },
      {
        name: 'fluent-bit',
        image: 'fluent-bit:3.1',
        req: [50, 128 * MI],
        lim: [100, 128 * MI],
      },
    ],
  },
  {
    kind: 'Deployment',
    ns: 'prod',
    name: 'web',
    replicas: 2,
    group: ['nodes-app-arm64'],
    cpu: 60,
    mem: 180 * MI,
    containers: [
      {
        name: 'web',
        image: `${ECR}/web:2.8.0`,
        req: [200, 256 * MI],
        lim: [400, 512 * MI],
        probes: true,
      },
    ],
  },
  {
    kind: 'Deployment',
    ns: 'prod',
    name: 'worker',
    replicas: 2,
    group: ['nodes-app-arm64'],
    cpu: 300,
    mem: 600 * MI,
    containers: [
      {
        name: 'worker',
        image: `${ECR}/worker:1.4.2`,
        req: [500, 1024 * MI],
        lim: [1000, 1536 * MI],
        probes: false,
      },
    ],
  },
  {
    kind: 'Deployment',
    ns: 'prod',
    name: 'payments',
    replicas: 0,
    group: ['nodes-app-arm64'],
    cpu: 0,
    mem: 0,
    containers: [
      {
        name: 'payments',
        image: `${ECR}/payments:0.9.1`,
        req: [200, 256 * MI],
        lim: [400, 512 * MI],
        probes: true,
      },
    ],
  },
  {
    kind: 'StatefulSet',
    ns: 'data',
    name: 'postgres',
    replicas: 2,
    group: ['nodes-app-arm64'],
    cpu: 350,
    mem: 2.4 * GI,
    pvcTemplate: 'data',
    containers: [
      {
        name: 'postgres',
        image: 'postgres:16.4',
        req: [1000, 4 * GI],
        lim: [2000, 4 * GI],
        probes: true,
      },
    ],
  },
  {
    kind: 'StatefulSet',
    ns: 'data',
    name: 'redis',
    replicas: 1,
    group: ['nodes-app-arm64'],
    cpu: 40,
    mem: 300 * MI,
    pvcTemplate: 'data',
    containers: [
      {
        name: 'redis',
        image: 'redis:7.2',
        req: [100, 512 * MI],
        lim: [null, 1024 * MI],
        probes: true,
      },
    ],
  },
  {
    kind: 'Deployment',
    ns: 'batch',
    name: 'report-generator',
    replicas: 1,
    group: ['nodes-batch'],
    cpu: 200,
    mem: 700 * MI,
    containers: [
      {
        name: 'report',
        image: `${ECR}/report:latest`,
        req: [600, 1.5 * GI],
        lim: [2000, 4 * GI],
      },
    ],
  },
  {
    kind: 'Deployment',
    ns: 'monitoring',
    name: 'grafana',
    replicas: 1,
    group: ['nodes-system'],
    cpu: 30,
    mem: 200 * MI,
    containers: [
      {
        name: 'grafana',
        image: 'grafana/grafana:11.2.0',
        req: [100, 128 * MI],
        lim: [200, 256 * MI],
        probes: true,
      },
    ],
  },
];

const NAMESPACES = [
  'default',
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'prod',
  'data',
  'batch',
  'monitoring',
];

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).padStart(7, '0').slice(0, 10);
}

/** 32비트 FNV-1a를 16진수 8자리로 */
function hexHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function suffix(s: string, len: number): string {
  const alphabet = 'bcdfghjklmnpqrstvwxz2456789';
  let out = '';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  for (let i = 0; i < len; i++) {
    out += alphabet[h % alphabet.length];
    h = Math.floor(h / alphabet.length) + (i + 7) * 2654435761;
    h >>>= 0;
  }
  return out;
}

/** 마스터에 만들 필수 구성요소 (계약 1.6의 5종) */
const CONTROL_PLANE_MOCK_KINDS = [
  'kube-apiserver',
  'kube-controller-manager',
  'kube-scheduler',
  'etcd-manager-main',
  'etcd-manager-events',
] as const;

const CP_IMAGE: Record<string, string> = {
  'kube-apiserver': 'registry.k8s.io/kube-apiserver:v1.34.1',
  'kube-controller-manager': 'registry.k8s.io/kube-controller-manager:v1.34.1',
  'kube-scheduler': 'registry.k8s.io/kube-scheduler:v1.34.1',
  'etcd-manager-main':
    'registry.k8s.io/etcd-manager/etcd-manager-slim:v3.0.20241009',
  'etcd-manager-events':
    'registry.k8s.io/etcd-manager/etcd-manager-slim:v3.0.20241009',
  'kops-controller': 'registry.k8s.io/kops/kops-controller:1.34.0',
  'kube-apiserver-healthcheck':
    'registry.k8s.io/kops/kube-apiserver-healthcheck:1.34.0',
};

/** static pod 미러 파드 (워크로드 소속 없음, owner.kind = Node) */
function controlPlanePod(a: {
  kind: string;
  podName: string;
  nodeName: string;
  createdAt: number;
  started: string;
  crash: boolean;
  now: number;
}): RawPod {
  const req =
    a.kind === 'kube-apiserver'
      ? { cpuMillicores: 150, memoryBytes: 512 * MI }
      : { cpuMillicores: 50, memoryBytes: 64 * MI };
  const status = a.crash
    ? {
        ready: false,
        restartCount: 17,
        state: {
          type: 'waiting' as const,
          reason: 'CrashLoopBackOff',
          message: `back-off 5m0s restarting failed container=${a.kind} pod=${a.podName}_kube-system`,
          since: null,
        },
        lastTermination: {
          reason: 'Error',
          exitCode: 1,
          startedAt: iso(a.now - 40_000),
          finishedAt: iso(a.now - 20_000),
        },
      }
    : {
        ready: true,
        restartCount: 0,
        state: {
          type: 'running' as const,
          reason: null,
          message: null,
          since: a.started,
        },
        lastTermination: null,
      };
  return {
    namespace: 'kube-system',
    name: a.podName,
    uid: `uid-${hash(a.podName)}`,
    createdAt: iso(a.createdAt),
    labels: { k8s_app: a.kind, tier: 'control-plane' },
    phase: 'Running',
    statusReason: null,
    deletionAt: null,
    nodeName: a.nodeName,
    podIP: null,
    qosClass: 'Burstable',
    startTime: a.started,
    owner: { kind: 'Node', name: a.nodeName },
    conditions: [
      {
        type: 'PodScheduled',
        value: 'True',
        since: iso(a.createdAt),
        reason: null,
        message: null,
      },
      {
        type: 'Ready',
        value: a.crash ? 'False' : 'True',
        since: a.crash ? iso(a.now - 4 * 60_000) : a.started,
        reason: null,
        message: null,
      },
    ],
    containers: [
      {
        name: a.kind,
        init: false,
        image: CP_IMAGE[a.kind] ?? `registry.k8s.io/${a.kind}:v1.34.1`,
        requests: req,
        limits: { cpuMillicores: null, memoryBytes: null },
        probes: { readiness: true, liveness: true, startup: false },
        security: {
          privileged: false,
          allowPrivilegeEscalation: null,
          runAsNonRoot: null,
        },
        status,
      },
    ],
    initContainers: [],
    pvcClaims: [],
    security: {
      hostNetwork: true,
      hostPID: false,
      hostPath: true,
      serviceAccountName: 'default',
      automountToken: null,
      runAsNonRoot: null,
    },
  };
}

function mkNode(s: NodeSpec, created: number): RawNode {
  const since = iso(created + 60_000);
  return {
    name: s.name,
    createdAt: iso(created),
    instanceType: s.type,
    zone: s.zone,
    region: 'ap-northeast-2',
    nodeGroup: s.group,
    role: s.role ?? 'worker',
    capacityType: s.cap,
    architecture: s.arch,
    kubeletVersion: 'v1.34.1',
    // kOps(쿠버네티스 1.23+ / 외부 CCM)에서는 노드 이름이 곧 EC2 인스턴스 ID다 (명세 F10).
    // 인스턴스 ID 모양이 아니면 만들어 붙인다 (비용 모듈이 인스턴스와 대조한다)
    providerId: `aws:///${s.zone}/${
      /^i-[0-9a-f]+$/.test(s.name)
        ? s.name
        : `i-0${hexHash(s.name)}${hexHash(s.zone + s.name)}`
    }`,
    unschedulable: false,
    conditions: [
      {
        type: 'MemoryPressure',
        value: 'False',
        since,
        reason: 'KubeletHasSufficientMemory',
        message: null,
      },
      {
        type: 'DiskPressure',
        value: 'False',
        since,
        reason: 'KubeletHasNoDiskPressure',
        message: null,
      },
      {
        type: 'PIDPressure',
        value: 'False',
        since,
        reason: 'KubeletHasSufficientPID',
        message: null,
      },
      {
        type: 'Ready',
        value: 'True',
        since,
        reason: 'KubeletReady',
        message: 'kubelet is posting ready status',
      },
    ],
    allocatable: {
      cpuMillicores: s.cpu,
      memoryBytes: Math.round(s.memGi * GI),
      pods: s.pods,
    },
    capacity: {
      cpuMillicores: s.cpu === 1930 ? 2000 : 4000,
      memoryBytes: Math.round((s.memGi + 0.45) * GI),
      pods: s.pods,
    },
  };
}

function container(
  t: ContainerTpl,
  ready: boolean,
  started: string,
  spec: WorkloadSpec,
): RawContainer {
  return {
    name: t.name,
    image: t.image,
    init: false,
    requests: { cpuMillicores: t.req[0], memoryBytes: t.req[1] },
    limits: { cpuMillicores: t.lim[0], memoryBytes: t.lim[1] },
    probes: {
      readiness: Boolean(t.probes),
      liveness: Boolean(t.probes),
      startup: false,
    },
    security: {
      privileged: spec.privileged === true,
      allowPrivilegeEscalation: spec.privileged ? true : null,
      runAsNonRoot: spec.ns === 'prod' ? true : null,
    },
    status: {
      ready,
      restartCount: 0,
      state: { type: 'running', reason: null, message: null, since: started },
      lastTermination: null,
    },
  };
}

function qosOf(cs: RawContainer[]): RawPod['qosClass'] {
  const all = cs.every(
    (c) =>
      c.requests.cpuMillicores !== null &&
      c.requests.cpuMillicores === c.limits.cpuMillicores &&
      c.requests.memoryBytes !== null &&
      c.requests.memoryBytes === c.limits.memoryBytes,
  );
  if (all) return 'Guaranteed';
  const any = cs.some(
    (c) =>
      c.requests.cpuMillicores !== null ||
      c.requests.memoryBytes !== null ||
      c.limits.cpuMillicores !== null ||
      c.limits.memoryBytes !== null,
  );
  return any ? 'Burstable' : 'BestEffort';
}

export function buildMockWorld(
  scenario: ClusterScenario,
  now: number,
): MockWorld {
  const rand = seededRandom(20260919);
  const clusterCreated = now - 60 * 86_400_000;
  const world: MockWorld = {
    info: {
      name: 'prod.k8s.example.com',
      version: 'v1.34.1',
      region: 'ap-northeast-2',
    },
    nodes: [],
    workloads: [],
    pods: [],
    events: [],
    pvcs: [],
    services: [],
    ingresses: [],
    pdbs: [],
    hpas: [],
    namespaces: [...NAMESPACES],
    nodeUsage: new Map(),
    podPlans: new Map(),
  };
  // 인증 실패는 아무것도 조회할 수 없다 — 빈 세계 (mock 데이터로 채우지 않는다)
  if (scenario === 'no-cluster' || scenario === 'kube-auth-failed')
    return world;

  const mixedLike =
    scenario === 'mixed' ||
    scenario === 'no-metrics' ||
    scenario === 'kube-stale';
  const critical = scenario === 'critical';
  const warning = scenario === 'warning';

  // --- 노드 ---
  // 마스터 대수: cp-single은 1대, cp-not-found는 0대, 그 밖에는 3대 (AC-KOPS25)
  const cpSpecs =
    scenario === 'cp-not-found'
      ? []
      : scenario === 'cp-single'
        ? CONTROL_PLANE_SPECS.slice(0, 1)
        : CONTROL_PLANE_SPECS;
  const nodes =
    scenario === 'empty'
      ? []
      : [...cpSpecs, ...NODE_SPECS].map((s, i) =>
          mkNode(s, clusterCreated + i * 3_600_000 * 24 * (i + 1)),
        );
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const setReady = (
    name: string,
    value: 'False' | 'Unknown',
    agoMs: number,
  ) => {
    const n = byName.get(name);
    if (!n) return;
    const since = iso(now - agoMs);
    n.conditions = n.conditions.map((c) =>
      c.type === 'Ready'
        ? {
            ...c,
            value,
            since,
            reason:
              value === 'Unknown' ? 'NodeStatusUnknown' : 'KubeletNotReady',
            message:
              value === 'Unknown'
                ? 'Kubelet stopped posting node status.'
                : 'container runtime network not ready',
          }
        : value === 'Unknown'
          ? {
              ...c,
              value: 'Unknown',
              since,
              reason: 'NodeStatusUnknown',
              message: 'Kubelet stopped posting node status.',
            }
          : c,
    );
  };
  const n0 = NODE_SPECS[0].name;
  const nBatchA = NODE_SPECS[2].name;
  const nBatchC = NODE_SPECS[3].name;
  const nAppA = NODE_SPECS[4].name;
  const nAppC = NODE_SPECS[5].name;
  if (mixedLike) {
    setReady(nBatchA, 'Unknown', 3 * 60_000 + 10_000);
    byName.get(nBatchC)!.unschedulable = true;
  }
  if (warning) {
    byName.get(nBatchC)!.unschedulable = true;
  }
  if (critical) {
    setReady(nBatchA, 'Unknown', 9 * 60_000);
    setReady(nBatchC, 'False', 30_000);
    const n = byName.get(nAppC)!;
    n.conditions.push({
      type: 'NetworkUnavailable',
      value: 'True',
      since: iso(now - 5 * 60_000),
      reason: 'NoRouteCreated',
      message: 'Node network not configured',
    });
    n.conditions = n.conditions.map((c) =>
      c.type === 'MemoryPressure'
        ? {
            ...c,
            value: 'True',
            since: iso(now - 4 * 60_000),
            reason: 'KubeletHasInsufficientMemory',
            message: 'kubelet has insufficient memory available',
          }
        : c,
    );
  }
  // 마스터 NotReady 시나리오 (AC-KOPS20·21)
  const masterNames = cpSpecs.map((x) => x.name);
  if (scenario === 'cp-node-down' && masterNames[2])
    setReady(masterNames[2], 'Unknown', 4 * 60_000);
  if (scenario === 'cp-quorum-lost') {
    if (masterNames[1]) setReady(masterNames[1], 'Unknown', 6 * 60_000);
    if (masterNames[2]) setReady(masterNames[2], 'False', 2 * 60_000);
  }
  world.nodes = nodes;

  // 노드 사용률 중심값
  for (const n of nodes) {
    let cpu = 25 + rand() * 20;
    let mem = 35 + rand() * 20;
    if (n.name === nAppA) {
      if (mixedLike) {
        cpu = 74;
        mem = 62;
      }
      if (warning) {
        cpu = 80;
        mem = 78;
      }
      if (critical) {
        cpu = 95;
        mem = 92;
      }
    }
    if (critical && n.name === n0) mem = 91;
    world.nodeUsage.set(n.name, { cpuPct: cpu, memPct: mem });
  }

  // --- 워크로드·파드 ---
  const readyNodes = nodes.filter(
    (n) => n.conditions.find((c) => c.type === 'Ready')?.value === 'True',
  );
  const podsFor = (spec: WorkloadSpec): string[] => {
    const pool = nodes.filter(
      (n) => !spec.group || spec.group.includes(n.nodeGroup ?? ''),
    );
    const cands = pool.length ? pool : nodes;
    return cands.map((n) => n.name);
  };

  for (const spec of WORKLOADS) {
    const created = clusterCreated + Math.floor(rand() * 20) * 86_400_000;
    const tplLabels: Record<string, string> = {
      'app.kubernetes.io/name': spec.name,
      app: spec.name,
    };
    const isDs = spec.kind === 'DaemonSet';
    const targetNodes = isDs ? nodes.map((n) => n.name) : podsFor(spec);
    const replicas = isDs ? targetNodes.length : spec.replicas;
    const rsHash = suffix(`${spec.name}-rs`, 9);
    const pods: RawPod[] = [];
    for (let i = 0; i < replicas; i++) {
      const podName =
        spec.kind === 'StatefulSet'
          ? `${spec.name}-${i}`
          : spec.kind === 'Deployment'
            ? `${spec.name}-${rsHash}-${suffix(`${spec.name}${i}${scenario === 'healthy' ? 'h' : ''}`, 5)}`
            : `${spec.name}-${suffix(`${spec.name}${i}`, 5)}`;
      const nodeName =
        scenario === 'empty'
          ? null
          : (targetNodes[i % Math.max(1, targetNodes.length)] ?? null);
      const podCreated = now - (2 + Math.floor(rand() * 72)) * 3_600_000;
      const started = iso(podCreated + 2_000);
      const nodeReady = nodeName
        ? readyNodes.some((n) => n.name === nodeName)
        : false;
      const cs = spec.containers.map((c) =>
        container(c, nodeReady, started, spec),
      );
      const pod: RawPod = {
        namespace: spec.ns,
        name: podName,
        uid: `uid-${hash(podName)}`,
        createdAt: iso(podCreated),
        labels: {
          ...tplLabels,
          ...(spec.kind === 'Deployment'
            ? { 'pod-template-hash': rsHash }
            : {}),
        },
        phase: nodeName ? 'Running' : 'Pending',
        statusReason: null,
        deletionAt: null,
        nodeName,
        podIP: nodeName
          ? `10.0.${20 + (i % 5)}.${10 + Math.floor(rand() * 200)}`
          : null,
        qosClass: qosOf(cs),
        startTime: nodeName ? iso(podCreated + 1000) : null,
        owner:
          spec.kind === 'Deployment'
            ? { kind: 'ReplicaSet', name: `${spec.name}-${rsHash}` }
            : { kind: spec.kind, name: spec.name },
        conditions: [
          {
            type: 'PodScheduled',
            value: nodeName ? 'True' : 'False',
            since: iso(podCreated),
            reason: nodeName ? null : 'Unschedulable',
            message: null,
          },
          {
            type: 'Ready',
            value: nodeReady ? 'True' : 'False',
            since: iso(nodeReady ? podCreated + 5000 : now - 3 * 60_000),
            reason: null,
            message: null,
          },
        ],
        containers: nodeName ? cs : cs.map((c) => ({ ...c, status: null })),
        initContainers: [],
        pvcClaims: spec.pvcTemplate
          ? [`${spec.pvcTemplate}-${spec.name}-${i}`]
          : spec.name === 'grafana'
            ? ['grafana']
            : [],
        security: {
          hostNetwork: spec.hostNetwork === true,
          hostPID: false,
          hostPath: spec.kind === 'DaemonSet',
          serviceAccountName: spec.ns === 'prod' ? spec.name : 'default',
          automountToken: spec.ns === 'prod' ? false : null,
          runAsNonRoot: spec.ns === 'prod' ? true : null,
        },
      };
      pods.push(pod);
      world.podPlans.set(`${spec.ns}/${podName}`, {
        cpu: spec.cpu * (0.8 + rand() * 0.4),
        mem: spec.mem * (0.85 + rand() * 0.3),
      });
    }

    // 시나리오별 파드 상태
    const crashLoop = (
      p: RawPod,
      restarts: number,
      minutesAgo: number[],
      oom: boolean,
    ) => {
      const c = p.containers[0];
      const lastFinish = iso(now - 18_000);
      c.status = {
        ready: false,
        restartCount: restarts,
        state: {
          type: 'waiting',
          reason: 'CrashLoopBackOff',
          message: `back-off 5m0s restarting failed container=${c.name} pod=${p.name}_${p.namespace}`,
          since: null,
        },
        lastTermination: {
          reason: oom ? 'OOMKilled' : 'Error',
          exitCode: oom ? 137 : 1,
          startedAt: iso(now - 30_000),
          finishedAt: lastFinish,
        },
      };
      p.conditions = p.conditions.map((x) =>
        x.type === 'Ready'
          ? { ...x, value: 'False', since: iso(now - 4 * 60_000) }
          : x,
      );
      const plan = world.podPlans.get(`${p.namespace}/${p.name}`)!;
      plan.crashLoop = true;
      plan.restartMinutesAgo = minutesAgo;
      plan.oomMinutesAgo = oom ? [0.3] : [];
      plan.mem = (c.limits.memoryBytes ?? plan.mem) * 0.97;
    };

    if (spec.name === 'api' && (mixedLike || critical)) {
      pods.forEach((p) => crashLoop(p, 41, [52, 44, 35, 26, 15, 5], true));
    }
    if (spec.name === 'worker') {
      if (mixedLike || warning) {
        const p = pods[0];
        const c = p.containers[0];
        c.status!.restartCount = 2;
        c.status!.lastTermination = {
          reason: 'Error',
          exitCode: 1,
          startedAt: iso(now - 50 * 60_000),
          finishedAt: iso(now - 20 * 60_000),
        };
        world.podPlans.get(`${p.namespace}/${p.name}`)!.restartMinutesAgo = [
          48, 20,
        ];
        if (mixedLike) {
          c.status!.ready = false;
          p.conditions = p.conditions.map((x) =>
            x.type === 'Ready'
              ? { ...x, value: 'False', since: iso(now - 4 * 60_000) }
              : x,
          );
        }
      }
      if (critical)
        pods.forEach((p) => crashLoop(p, 12, [40, 20, 10, 2], false));
    }
    if (spec.name === 'report-generator' && (mixedLike || critical)) {
      const p = pods[0];
      p.phase = 'Pending';
      p.nodeName = null;
      p.podIP = null;
      p.startTime = null;
      p.createdAt = iso(now - 12 * 60_000);
      p.containers = p.containers.map((c) => ({ ...c, status: null }));
      p.conditions = [
        {
          type: 'PodScheduled',
          value: 'False',
          since: iso(now - 12 * 60_000),
          reason: 'Unschedulable',
          message: '0/6 nodes are available: 6 Insufficient cpu.',
        },
      ];
    }
    if (spec.name === 'grafana' && (mixedLike || warning || critical)) {
      const p = pods[0];
      const c = p.containers[0];
      c.status!.restartCount = 1;
      c.status!.lastTermination = {
        reason: 'OOMKilled',
        exitCode: 137,
        startedAt: iso(now - 40 * 60_000),
        finishedAt: iso(now - 25 * 60_000),
      };
      const plan = world.podPlans.get(`${p.namespace}/${p.name}`)!;
      plan.restartMinutesAgo = [25];
      plan.oomMinutesAgo = [25];
      plan.mem = 256 * MI * (critical ? 0.96 : 0.85);
    }
    if (spec.name === 'redis' && critical) {
      const p = pods[0];
      p.containers[0].status = {
        ready: false,
        restartCount: 0,
        state: {
          type: 'waiting',
          reason: 'ImagePullBackOff',
          message: 'Back-off pulling image "redis:7.2"',
          since: null,
        },
        lastTermination: null,
      };
    }

    const readyCount = pods.filter(
      (p) =>
        p.phase === 'Running' && p.containers.every((c) => c.status?.ready),
    ).length;
    const wl: RawWorkload = {
      kind: spec.kind,
      namespace: spec.ns,
      name: spec.name,
      createdAt: iso(created),
      desired: isDs ? replicas : spec.replicas,
      ready: readyCount,
      updated: isDs ? replicas : spec.replicas,
      available: readyCount,
      generation: 4,
      observedGeneration: 4,
      revisionPending: false,
      conditions:
        spec.kind === 'Deployment'
          ? [
              {
                type: 'Available',
                value:
                  readyCount >= Math.max(1, spec.replicas - 1)
                    ? 'True'
                    : 'False',
                since: iso(now - 3_600_000),
                reason:
                  readyCount > 0
                    ? 'MinimumReplicasAvailable'
                    : 'MinimumReplicasUnavailable',
                message:
                  readyCount > 0
                    ? 'Deployment has minimum availability.'
                    : 'Deployment does not have minimum availability.',
              },
              {
                type: 'Progressing',
                value: 'True',
                since: iso(created + 60_000),
                lastUpdateAt: iso(now - 26 * 3_600_000),
                reason: 'NewReplicaSetAvailable',
                message: `ReplicaSet "${spec.name}-${rsHash}" has successfully progressed.`,
              },
            ]
          : [],
      selector: { matchLabels: { app: spec.name }, matchExpressions: [] },
      templateLabels: tplLabels,
      containers: spec.containers.map((c) => {
        const x = container(c, true, iso(now), spec);
        return {
          name: x.name,
          image: x.image,
          requests: x.requests,
          limits: x.limits,
          probes: x.probes,
          security: x.security,
        };
      }),
      podSecurity: pods[0]?.security ?? {
        hostNetwork: false,
        hostPID: false,
        hostPath: false,
        serviceAccountName: 'default',
        automountToken: null,
        runAsNonRoot: null,
      },
      volumeClaimTemplates: spec.pvcTemplate ? [spec.pvcTemplate] : [],
    };
    if (spec.name === 'api' && (mixedLike || critical)) {
      wl.conditions = wl.conditions.map((c) =>
        c.type === 'Progressing'
          ? critical
            ? {
                ...c,
                value: 'False',
                reason: 'ProgressDeadlineExceeded',
                since: iso(now - 60_000),
                lastUpdateAt: iso(now - 60_000),
                message: `ReplicaSet "api-${rsHash}" has timed out progressing.`,
              }
            : {
                ...c,
                reason: 'ReplicaSetUpdated',
                since: iso(now - 4 * 60_000),
                lastUpdateAt: iso(now - 4 * 60_000),
                message: `ReplicaSet "api-${rsHash}" is progressing.`,
              }
          : c,
      );
    }
    world.workloads.push(wl);
    world.pods.push(...pods);
  }

  // --- 컨트롤 플레인 static pod (미러 파드) ---
  // kOps 마스터의 /etc/kubernetes/manifests 에 있는 static pod이 kube-system에 미러로 보인다 (F5).
  // 워크로드에 속하지 않으므로 owner.kind = 'Node'.
  for (const m of nodes.filter((n) => n.role === 'control_plane')) {
    const short = m.name.split('.')[0];
    for (const kind of CONTROL_PLANE_MOCK_KINDS) {
      // cp-component-crash: 한 마스터의 kube-scheduler만 CrashLoopBackOff (AC-KOPS22)
      const crash =
        scenario === 'cp-component-crash' &&
        kind === 'kube-scheduler' &&
        m.name === masterNames[1];
      // cp-component-crash에서는 다른 마스터의 etcd-manager-events 파드를 아예 빼 본다(missing 칸)
      const omit =
        scenario === 'cp-component-crash' &&
        kind === 'etcd-manager-events' &&
        m.name === masterNames[2];
      if (omit) continue;
      const podName = `${kind}-${short}`;
      const createdAt = clusterCreated + 3_600_000;
      const started = iso(createdAt + 4_000);
      world.pods.push(
        controlPlanePod({
          kind,
          podName,
          nodeName: m.name,
          createdAt,
          started,
          crash,
          now,
        }),
      );
      world.podPlans.set(`kube-system/${podName}`, {
        cpu: kind === 'kube-apiserver' ? 120 : 25,
        mem: (kind === 'kube-apiserver' ? 620 : 90) * MI,
        ...(crash
          ? { crashLoop: true, restartMinutesAgo: [48, 31, 17, 4] }
          : {}),
      });
    }
    // 기타 컨트롤 플레인 구성요소 (필수 판정에 넣지 않는다 — 명세 U5)
    for (const extra of ['kops-controller', 'kube-apiserver-healthcheck']) {
      const podName = `${extra}-${short}`;
      world.pods.push(
        controlPlanePod({
          kind: extra,
          podName,
          nodeName: m.name,
          createdAt: clusterCreated + 3_600_000,
          started: iso(clusterCreated + 3_604_000),
          crash: false,
          now,
        }),
      );
      world.podPlans.set(`kube-system/${podName}`, { cpu: 10, mem: 40 * MI });
    }
  }

  // Job 파드 (완료/실패)
  const jobPod = (
    name: string,
    job: string,
    phase: 'Succeeded' | 'Failed',
    agoMin: number,
  ): RawPod => ({
    namespace: 'batch',
    name,
    uid: `uid-${hash(name)}`,
    createdAt: iso(now - agoMin * 60_000),
    labels: { 'job-name': job },
    phase,
    statusReason: null,
    deletionAt: null,
    nodeName: scenario === 'empty' ? null : nBatchC,
    podIP: null,
    qosClass: 'Burstable',
    startTime: iso(now - agoMin * 60_000 + 2000),
    owner: { kind: 'Job', name: job },
    conditions: [
      {
        type: 'Ready',
        value: 'False',
        since: iso(now - (agoMin - 5) * 60_000),
        reason: 'PodCompleted',
        message: null,
      },
    ],
    containers: [
      {
        name: 'job',
        image: `${ECR}/etl:3.2.0`,
        init: false,
        requests: { cpuMillicores: 500, memoryBytes: 1024 * MI },
        limits: { cpuMillicores: 1000, memoryBytes: 2048 * MI },
        probes: { readiness: false, liveness: false, startup: false },
        security: {
          privileged: false,
          allowPrivilegeEscalation: null,
          runAsNonRoot: null,
        },
        status: {
          ready: false,
          restartCount: 0,
          state: {
            type: 'terminated',
            reason: phase === 'Succeeded' ? 'Completed' : 'Error',
            message: null,
            since: iso(now - (agoMin - 5) * 60_000),
            exitCode: phase === 'Succeeded' ? 0 : 1,
          },
          lastTermination: null,
        },
      },
    ],
    initContainers: [],
    pvcClaims: [],
    security: {
      hostNetwork: false,
      hostPID: false,
      hostPath: false,
      serviceAccountName: 'default',
      automountToken: null,
      runAsNonRoot: null,
    },
  });
  world.pods.push(
    jobPod(
      'nightly-etl-28571234-kx7qp',
      'nightly-etl-28571234',
      'Succeeded',
      180,
    ),
  );
  if (!(scenario === 'healthy'))
    world.pods.push(
      jobPod('cleanup-28571300-m2zrd', 'cleanup-28571300', 'Failed', 45),
    );

  // --- PVC ---
  const pvc = (
    ns: string,
    name: string,
    sizeGi: number,
    sc: string,
    phase: RawPvc['phase'],
    agoMs: number,
  ): RawPvc => ({
    namespace: ns,
    name,
    createdAt: iso(now - agoMs),
    phase,
    capacityBytes: phase === 'Bound' || phase === 'Lost' ? sizeGi * GI : null,
    requestedBytes: sizeGi * GI,
    storageClass: sc,
    volumeName:
      phase === 'Pending'
        ? null
        : `pvc-${hash(name)}-${hash(ns)}-4c2e-9d0a-7f5b1e2c3d4f`.slice(0, 40),
  });
  world.pvcs.push(
    pvc('data', 'data-postgres-0', 50, 'gp3', 'Bound', 50 * 86_400_000),
  );
  world.pvcs.push(
    pvc('data', 'data-postgres-1', 50, 'gp3', 'Bound', 50 * 86_400_000),
  );
  world.pvcs.push(
    pvc(
      'data',
      'data-redis-0',
      10,
      'gp3',
      critical ? 'Lost' : 'Bound',
      40 * 86_400_000,
    ),
  );
  world.pvcs.push(
    pvc('monitoring', 'grafana', 5, 'gp2', 'Bound', 30 * 86_400_000),
  );
  if (mixedLike || warning || critical)
    world.pvcs.push(
      pvc('batch', 'scratch', 100, 'gp3', 'Pending', 3 * 60_000 + 20_000),
    );

  // --- 서비스·인그레스·PDB·HPA ---
  world.services.push(
    {
      namespace: 'prod',
      name: 'api',
      type: 'LoadBalancer',
      createdAt: iso(clusterCreated),
      hasLoadBalancer: true,
      lbHostnames: [
        'k8s-prod-api-3f9a1c2b7d-0123456789abcdef.elb.ap-northeast-2.amazonaws.com',
      ],
      loadBalancerClass: 'service.k8s.aws/nlb',
      lbType: 'nlb',
    },
    {
      namespace: 'prod',
      name: 'web',
      type: 'ClusterIP',
      createdAt: iso(clusterCreated),
      hasLoadBalancer: false,
      lbHostnames: [],
      loadBalancerClass: null,
      lbType: null,
    },
    {
      namespace: 'data',
      name: 'postgres',
      type: 'ClusterIP',
      createdAt: iso(clusterCreated),
      hasLoadBalancer: false,
      lbHostnames: [],
      loadBalancerClass: null,
      lbType: null,
    },
    {
      namespace: 'monitoring',
      name: 'grafana',
      type: 'LoadBalancer',
      createdAt: iso(clusterCreated),
      hasLoadBalancer: true,
      lbHostnames: [
        'a1b2c3d4e5f60718293a4b5c6d7e8f90-1234567890.ap-northeast-2.elb.amazonaws.com',
      ],
      loadBalancerClass: null,
      lbType: 'clb',
    },
    {
      namespace: 'kube-system',
      name: 'kube-dns',
      type: 'ClusterIP',
      createdAt: iso(clusterCreated),
      hasLoadBalancer: false,
      lbHostnames: [],
      loadBalancerClass: null,
      lbType: null,
    },
  );
  world.ingresses.push({
    namespace: 'prod',
    name: 'web',
    createdAt: iso(clusterCreated),
    ingressClass: 'alb',
    hasLoadBalancer: true,
    lbHostnames: [
      'k8s-prod-web-5e6f7a8b9c-987654321.ap-northeast-2.elb.amazonaws.com',
    ],
    isAlb: true,
    albGroup: null,
  });
  world.pdbs.push({
    namespace: 'prod',
    name: 'web',
    selector: { matchLabels: { app: 'web' }, matchExpressions: [] },
  });
  world.pdbs.push({
    namespace: 'kube-system',
    name: 'coredns',
    selector: { matchLabels: { app: 'coredns' }, matchExpressions: [] },
  });
  world.hpas.push({
    namespace: 'prod',
    name: 'api',
    target: { kind: 'Deployment', name: 'api' },
    minReplicas: 3,
    maxReplicas: 10,
    currentReplicas: 3,
  });

  // --- 이벤트 ---
  const ev = (
    reasonName: string,
    kind: string,
    ns: string | null,
    name: string,
    message: string,
    count: number,
    firstAgoMs: number,
    lastAgoMs: number,
    component: string,
  ): RawEvent => ({
    uid: `ev-${hash(`${reasonName}${name}`)}-${hash(name + reasonName + 'x')}`,
    namespace: ns ?? 'default',
    involved: { kind, namespace: ns, name },
    reason: reasonName,
    message,
    count,
    firstSeenAt: iso(now - firstAgoMs),
    lastSeenAt: iso(now - lastAgoMs),
    sourceComponent: component,
  });
  const apiPods = world.pods.filter(
    (p) => p.namespace === 'prod' && p.name.startsWith('api-'),
  );
  const reportPod = world.pods.find((p) =>
    p.name.startsWith('report-generator-'),
  );
  const workerPod = world.pods.find((p) => p.name.startsWith('worker-'));
  if (mixedLike || critical) {
    for (const p of apiPods.slice(0, critical ? 3 : 2)) {
      world.events.push(
        ev(
          'BackOff',
          'Pod',
          'prod',
          p.name,
          `Back-off restarting failed container api in pod ${p.name}_prod(${p.uid})`,
          12,
          22 * 60_000,
          20_000,
          'kubelet',
        ),
      );
    }
    if (reportPod)
      world.events.push(
        ev(
          'FailedScheduling',
          'Pod',
          'batch',
          reportPod.name,
          '0/6 nodes are available: 1 node(s) had untolerated taint {node.kubernetes.io/unreachable: }, 5 Insufficient cpu. preemption: 0/6 nodes are available.',
          9,
          12 * 60_000,
          40_000,
          'default-scheduler',
        ),
      );
    world.events.push(
      ev(
        'NodeNotReady',
        'Node',
        null,
        nBatchA,
        `Node ${nBatchA} status is now: NodeNotReady`,
        1,
        3 * 60_000,
        3 * 60_000,
        'node-controller',
      ),
    );
  }
  if (workerPod && (mixedLike || warning))
    world.events.push(
      ev(
        'Unhealthy',
        'Pod',
        'prod',
        workerPod.name,
        'Readiness probe failed: HTTP probe failed with statuscode: 503',
        7,
        25 * 60_000,
        2 * 60_000,
        'kubelet',
      ),
    );
  if (mixedLike || warning || critical)
    world.events.push(
      ev(
        'ProvisioningFailed',
        'PersistentVolumeClaim',
        'batch',
        'scratch',
        'failed to provision volume with StorageClass "gp3": rpc error: code = ResourceExhausted',
        3,
        3 * 60_000,
        50_000,
        'ebs.csi.aws.com',
      ),
    );
  if (critical) {
    world.events.push(
      ev(
        'FailedMount',
        'Pod',
        'data',
        'redis-0',
        'MountVolume.SetUp failed for volume "pvc-..." : volume is lost',
        4,
        6 * 60_000,
        60_000,
        'kubelet',
      ),
    );
    world.events.push(
      ev(
        'OOMKilling',
        'Node',
        null,
        n0,
        'Memory cgroup out of memory: Killed process 4123 (grafana)',
        1,
        5 * 60_000,
        5 * 60_000,
        'kernel-monitor',
      ),
    );
  }
  // 오래된(1시간 초과) 이벤트는 넣지 않는다
  return world;
}

export function podMemLimitOf(p: RawPod): number | null {
  let s = 0;
  for (const c of p.containers) {
    if (c.limits.memoryBytes === null) return null;
    s += c.limits.memoryBytes;
  }
  return s;
}
