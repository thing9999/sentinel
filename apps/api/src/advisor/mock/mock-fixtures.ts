/**
 * mock 스냅샷 섹션과 예시 응답 (DATA_SOURCE=mock).
 * - 섹션 기여자(A: cluster·db, B: cost)가 없거나 실패하면 mock 모드에서만 이 값을 쓴다.
 * - 각 규칙 카테고리(비용·안정성·보안·DB)가 1건 이상 걸리도록 구성했다.
 * - 레이블 값 하나에 AWS 액세스 키 형식 문자열을 넣어 "가림 1건"을 보여준다(가짜 값).
 */
import type {
  ClusterContribution,
  CostContribution,
  SnapshotContainer,
  SnapshotDb,
  SnapshotWorkload,
} from '../snapshot/snapshot.types';

const GI = 1024 ** 3;
const MI = 1024 ** 2;

function container(
  p: Partial<SnapshotContainer> & { name: string; image: string },
): SnapshotContainer {
  return {
    requests: { cpuMillicores: 250, memoryBytes: 512 * MI },
    limits: { cpuMillicores: 1000, memoryBytes: 1 * GI },
    usage: {
      cpuAvgMillicores: 120,
      cpuMaxMillicores: 400,
      memoryAvgBytes: 300 * MI,
      memoryMaxBytes: 420 * MI,
    },
    probes: { readiness: true, liveness: true },
    security: {
      privileged: false,
      allowPrivilegeEscalation: false,
      runAsNonRoot: true,
    },
    ...p,
  };
}

function workload(
  p: Partial<SnapshotWorkload> &
    Pick<SnapshotWorkload, 'kind' | 'namespace' | 'name' | 'containers'>,
): SnapshotWorkload {
  return {
    desired: 2,
    ready: 2,
    nodeGroups: ['general'],
    podSecurity: {
      hostNetwork: false,
      hostPID: false,
      hostPath: false,
      defaultServiceAccount: false,
      automountToken: false,
    },
    hasPdb: true,
    hpa: null,
    restarts24h: 0,
    oom24h: 0,
    status: 'ok',
    labels: { 'app.kubernetes.io/name': p.name },
    ...p,
  };
}

export function mockClusterContribution(): ClusterContribution {
  const node = (
    name: string,
    nodeGroup: string,
    instanceType: string,
    zone: string,
    cpuReq: number,
    memReq: number,
    cpuAvg: number,
    pods: number,
    capacityType: 'on_demand' | 'spot' = 'on_demand',
  ) => ({
    name,
    nodeGroup,
    instanceType,
    architecture: 'amd64',
    capacityType,
    zone,
    allocatable: instanceType.endsWith('xlarge')
      ? { cpuMillicores: 3920, memoryBytes: 14 * GI, pods: 58 }
      : { cpuMillicores: 1930, memoryBytes: 7 * GI, pods: 29 },
    cpu: {
      currentPct: cpuAvg + 3,
      avgPct: cpuAvg,
      maxPct: cpuAvg + 22,
      requestsPct: cpuReq,
    },
    memory: {
      currentPct: memReq - 5,
      avgPct: memReq - 8,
      maxPct: memReq + 4,
      requestsPct: memReq,
    },
    podCount: pods,
    status: 'ok' as const,
    reasonCodes: [],
  });
  return {
    cluster: {
      platform: 'eks',
      version: '1.34',
      region: 'ap-northeast-2',
      supportTier: 'standard',
      nodeCount: 6,
      namespaceCount: 7,
    },
    observationSec: { metrics: 3600, restarts: 86_400 },
    nodeGroups: [
      {
        name: 'general',
        instanceTypes: [{ type: 'm6i.large', count: 4 }],
        architecture: 'amd64',
        capacityType: 'on_demand',
        zones: ['ap-northeast-2a', 'ap-northeast-2c'],
        nodeCount: 4,
        cpu: { avgPct: 41, maxPct: 77, requestsPct: 68 },
        memory: { avgPct: 55, maxPct: 71, requestsPct: 72 },
        statelessOnly: false,
        estimatedUsdPerMonth: 280.32,
      },
      {
        name: 'batch',
        instanceTypes: [{ type: 'm6i.xlarge', count: 2 }],
        architecture: 'amd64',
        capacityType: 'on_demand',
        zones: ['ap-northeast-2a'],
        nodeCount: 2,
        cpu: { avgPct: 18, maxPct: 41, requestsPct: 22 },
        memory: { avgPct: 21, maxPct: 35, requestsPct: 19 },
        statelessOnly: true,
        estimatedUsdPerMonth: 280.32,
      },
    ],
    nodes: [
      node(
        'ip-10-0-11-21.ap-northeast-2.compute.internal',
        'general',
        'm6i.large',
        'ap-northeast-2a',
        71,
        74,
        44,
        18,
      ),
      node(
        'ip-10-0-11-35.ap-northeast-2.compute.internal',
        'general',
        'm6i.large',
        'ap-northeast-2a',
        66,
        70,
        39,
        16,
      ),
      node(
        'ip-10-0-12-8.ap-northeast-2.compute.internal',
        'general',
        'm6i.large',
        'ap-northeast-2c',
        69,
        75,
        42,
        17,
      ),
      node(
        'ip-10-0-12-44.ap-northeast-2.compute.internal',
        'general',
        'm6i.large',
        'ap-northeast-2c',
        64,
        69,
        38,
        15,
      ),
      node(
        'ip-10-0-11-90.ap-northeast-2.compute.internal',
        'batch',
        'm6i.xlarge',
        'ap-northeast-2a',
        24,
        21,
        19,
        6,
      ),
      node(
        'ip-10-0-11-91.ap-northeast-2.compute.internal',
        'batch',
        'm6i.xlarge',
        'ap-northeast-2a',
        20,
        17,
        17,
        5,
      ),
    ],
    workloads: [
      workload({
        kind: 'Deployment',
        namespace: 'prod',
        name: 'api',
        desired: 3,
        ready: 3,
        hasPdb: false,
        hpa: { min: 3, max: 6 },
        containers: [
          container({
            name: 'api',
            image:
              '123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2',
          }),
        ],
        labels: {
          'app.kubernetes.io/name': 'api',
          // mock: 비밀값 검사 시연용 가짜 키 (스냅샷에서 "[가림]"으로 바뀐다)
          'app.kubernetes.io/version': 'AKIAIOSFODNN7EXAMPLE',
        },
      }),
      workload({
        kind: 'Deployment',
        namespace: 'prod',
        name: 'web',
        desired: 1,
        ready: 1,
        hasPdb: false,
        containers: [
          container({
            name: 'web',
            image: 'nginx:latest',
            requests: { cpuMillicores: null, memoryBytes: null },
            limits: { cpuMillicores: null, memoryBytes: null },
            probes: { readiness: true, liveness: false },
            security: {
              privileged: false,
              allowPrivilegeEscalation: null,
              runAsNonRoot: null,
            },
          }),
        ],
        podSecurity: {
          hostNetwork: false,
          hostPID: false,
          hostPath: false,
          defaultServiceAccount: true,
          automountToken: null,
        },
      }),
      workload({
        kind: 'Deployment',
        namespace: 'batch',
        name: 'report-worker',
        desired: 4,
        ready: 3,
        nodeGroups: ['batch'],
        hasPdb: false,
        restarts24h: 9,
        oom24h: 2,
        status: 'warning',
        containers: [
          container({
            name: 'worker',
            image: 'ghcr.io/example/report-worker:2.3.0',
            requests: { cpuMillicores: 1000, memoryBytes: 1 * GI },
            limits: { cpuMillicores: 2000, memoryBytes: 1 * GI },
            usage: {
              cpuAvgMillicores: 140,
              cpuMaxMillicores: 900,
              memoryAvgBytes: 880 * MI,
              memoryMaxBytes: 1 * GI,
            },
          }),
        ],
      }),
      workload({
        kind: 'StatefulSet',
        namespace: 'data',
        name: 'postgres',
        desired: 1,
        ready: 1,
        hasPdb: false,
        containers: [
          container({
            name: 'postgres',
            image: 'postgres:16.4',
            requests: { cpuMillicores: 500, memoryBytes: 2 * GI },
            limits: { cpuMillicores: null, memoryBytes: 4 * GI },
          }),
        ],
      }),
      workload({
        kind: 'DaemonSet',
        namespace: 'monitoring',
        name: 'node-exporter',
        desired: 6,
        ready: 6,
        nodeGroups: ['general', 'batch'],
        hasPdb: false,
        containers: [
          container({
            name: 'node-exporter',
            image: 'quay.io/prometheus/node-exporter:v1.8.2',
            requests: { cpuMillicores: 50, memoryBytes: 64 * MI },
            limits: { cpuMillicores: 200, memoryBytes: 128 * MI },
            security: {
              privileged: true,
              allowPrivilegeEscalation: true,
              runAsNonRoot: false,
            },
          }),
        ],
        podSecurity: {
          hostNetwork: true,
          hostPID: true,
          hostPath: true,
          defaultServiceAccount: false,
          automountToken: false,
        },
      }),
      workload({
        kind: 'Deployment',
        namespace: 'kube-system',
        name: 'coredns',
        desired: 2,
        ready: 2,
        containers: [
          container({
            name: 'coredns',
            image:
              '602401143452.dkr.ecr.ap-northeast-2.amazonaws.com/eks/coredns:v1.11.1',
          }),
        ],
      }),
    ],
    storage: [
      {
        namespace: 'data',
        name: 'data-postgres-0',
        capacityBytes: 50 * GI,
        volumeType: 'gp2',
        volumeRef: 'vol-0a1b2c3d4e5f60718',
        usagePct: 78.4,
        usageSource: 'db_size_approx',
        attached: true,
        usdPerMonth: 5.7,
      },
      {
        namespace: 'prod',
        name: 'uploads',
        capacityBytes: 100 * GI,
        volumeType: 'gp3',
        volumeRef: 'vol-0f9e8d7c6b5a40312',
        usagePct: null,
        usageSource: null,
        attached: true,
        usdPerMonth: 9.12,
      },
    ],
    loadBalancers: [
      {
        ref: 'k8s-prod-web-3f2a1b',
        type: 'alb',
        attachedTo: [{ kind: 'Ingress', namespace: 'prod', name: 'web' }],
        healthyTargets: 1,
        usdPerMonth: 22.27,
      },
      {
        ref: 'k8s-legacy-old-9c8d7e',
        type: 'nlb',
        attachedTo: [
          { kind: 'Service', namespace: 'legacy', name: 'old-gateway' },
        ],
        healthyTargets: 0,
        usdPerMonth: 18.25,
      },
    ],
    events: {
      byReason: [
        { reason: 'BackOff', kind: 'Pod', count: 14 },
        { reason: 'OOMKilling', kind: 'Node', count: 2 },
        { reason: 'Unhealthy', kind: 'Pod', count: 5 },
      ],
    },
  };
}

export function mockDbSection(): SnapshotDb {
  return {
    vendor: 'postgres',
    version: '16.4',
    replicas: 1,
    pvcUsagePct: 78.4,
    pvcUsageSource: 'db_size_approx',
    connections: { currentPct: 61, maxObservedPct: 82, max: 100 },
    longRunningQueries: { over5m: 3, over30m: 0 },
    cacheHitPct: 97.8,
    xidAge: 212_000_000,
    databases: [
      { name: 'app', bytes: 36 * GI },
      { name: 'postgres', bytes: 8 * MI },
    ],
    resources: { qosClass: 'Burstable', requestsSet: true, limitsSet: false },
    onSpot: false,
  };
}

export function mockCostContribution(now: Date): CostContribution {
  const asOf = new Date(now.getTime() - 5 * 60_000).toISOString();
  return {
    cost: {
      currency: 'USD',
      asOf,
      rate: {
        totalUsdPerHour: 1.1003,
        byCategory: [
          { category: 'ec2', usdPerHour: 0.768 },
          { category: 'ebs', usdPerHour: 0.0203 },
          { category: 'lb', usdPerHour: 0.0555 },
          { category: 'ipv4', usdPerHour: 0.0565 },
          { category: 'eks', usdPerHour: 0.1 },
        ],
        byNodeGroup: [
          { nodeGroup: 'general', usdPerHour: 0.384, usdPerMonth: 280.32 },
          { nodeGroup: 'batch', usdPerHour: 0.384, usdPerMonth: 280.32 },
        ],
        unpricedCount: 0,
      },
      allocation: [
        {
          namespace: 'prod',
          usdPerMonth: 238.1,
          sharePct: 29.6,
          requestsMissingPods: 1,
        },
        {
          namespace: 'batch',
          usdPerMonth: 121.4,
          sharePct: 15.1,
          requestsMissingPods: 0,
        },
        {
          namespace: 'data',
          usdPerMonth: 64.9,
          sharePct: 8.1,
          requestsMissingPods: 0,
        },
        {
          namespace: 'unallocated',
          usdPerMonth: 339.5,
          sharePct: 42.3,
          requestsMissingPods: 0,
        },
        {
          namespace: 'shared_cluster',
          usdPerMonth: 39.3,
          sharePct: 4.9,
          requestsMissingPods: 0,
        },
      ],
      actual: {
        monthToDateUsd: 512.44,
        settledThrough: now.toISOString().slice(0, 10),
        topServices: [
          { service: 'Amazon Elastic Compute Cloud - Compute', mtdUsd: 341.2 },
          { service: 'Amazon Elastic Kubernetes Service', mtdUsd: 43.2 },
        ],
        scope: 'account',
      },
      forecast: { monthEndUsd: 812.0, lowUsd: 780.0, highUsd: 845.0 },
      budget: { budgetUsd: 900, status: 'warning', projectedPct: 90.2 },
      alternatives: [
        {
          instanceType: 'm6i.large',
          currentUsdPerHour: 0.096,
          graviton: { type: 'm7g.large', usdPerHour: 0.0816 },
          smaller: { type: 'm6i.medium', usdPerHour: 0.048 },
          spot: { usdPerHour: 0.0389, zone: 'ap-northeast-2c' },
        },
        {
          instanceType: 'm6i.xlarge',
          currentUsdPerHour: 0.192,
          graviton: { type: 'm7g.xlarge', usdPerHour: 0.1632 },
          smaller: { type: 'm6i.large', usdPerHour: 0.096 },
          spot: { usdPerHour: 0.0771, zone: 'ap-northeast-2a' },
        },
      ],
      ebsGbMonth: { gp2: 0.114, gp3: 0.0912 },
    },
    unattachedVolumes: [
      {
        volumeRef: 'vol-0c0ffee0c0ffee001',
        volumeType: 'gp2',
        capacityBytes: 20 * GI,
        clusterTagged: true,
        usdPerMonth: 2.28,
      },
    ],
  };
}

/** 예시 응답의 LLM 출력 (브리지 결과 형식). 결과 정리 단계를 그대로 거친다 */
export function exampleLlmOutput(): { suggestions: unknown[] } {
  return {
    suggestions: [
      {
        title: 'batch 노드그룹을 Graviton(m7g.xlarge) 스팟 혼합으로 전환',
        category: 'cost',
        severity: 'high',
        priority: 1,
        targets: [{ kind: 'NodeGroup', namespace: null, name: 'batch' }],
        evidence: [
          {
            field: 'nodeGroups[batch].cpu.avgPct',
            value: 18,
            text: 'batch 노드그룹 CPU 사용률 평균 18%, 최대 41% (관측 60분)',
          },
          {
            field: 'cost.rate.byNodeGroup[batch].usdPerMonth',
            value: 280.32,
            text: '해당 노드그룹 추정 월 $280',
          },
        ],
        precheckIds: ['R-GRAVITON', 'R-ONDEMAND'],
        savings: {
          monthlyUsd: 42.05,
          formula: '($0.1920 − $0.1632)/h × 730h × 2대 = $42.05/월',
        },
        steps: [
          {
            text: '워크로드 이미지가 arm64를 지원하는지 확인합니다.',
            code: 'docker manifest inspect ghcr.io/example/report-worker:2.3.0 | grep architecture',
            language: 'bash',
          },
          {
            text: 'arm64 노드그룹을 새로 만들고 워크로드를 옮긴 뒤 기존 노드그룹을 줄입니다.',
            code: 'managedNodeGroups:\n  - name: batch-arm\n    instanceTypes: ["m7g.xlarge"]\n    spot: true',
            language: 'yaml',
          },
        ],
        risk: {
          level: 'medium',
          reason: 'arm64 이미지 필요, 스팟 회수 시 작업 재시작',
        },
        verification:
          '전환 후 비용 화면의 EC2 노드 시간당 소모율과 batch 파드 재시작 수를 확인합니다.',
      },
      {
        title: 'report-worker의 OOM·재시작 원인 해소 (메모리 limit 상향)',
        category: 'reliability',
        severity: 'high',
        priority: 2,
        targets: [
          { kind: 'Deployment', namespace: 'batch', name: 'report-worker' },
        ],
        evidence: [
          {
            field: 'workloads[batch/report-worker].oom24h',
            value: 2,
            text: '최근 24시간 OOMKilled 2회',
          },
          {
            field: 'workloads[batch/report-worker].restarts24h',
            value: 9,
            text: '최근 24시간 재시작 9회',
          },
        ],
        precheckIds: ['R-OOM', 'R-RESTART'],
        savings: null,
        steps: [
          {
            text: '메모리 최대 사용량이 limit(1GiB)에 닿는지 확인합니다.',
            code: 'kubectl top pod -n batch -l app.kubernetes.io/name=report-worker',
            language: 'bash',
          },
          {
            text: 'limit을 1.5GiB로 올리고 requests를 실제 평균에 맞춥니다.',
            code: 'resources:\n  requests: { cpu: 200m, memory: 1Gi }\n  limits: { memory: 1536Mi }',
            language: 'yaml',
          },
        ],
        risk: { level: 'low', reason: '노드 메모리 여유 확인 필요' },
        verification: '24시간 뒤 재시작·OOM 수가 0인지 확인합니다.',
      },
      {
        title: 'Postgres standby 추가와 PVC 확장 계획',
        category: 'database',
        severity: 'medium',
        priority: 3,
        targets: [
          { kind: 'StatefulSet', namespace: 'data', name: 'postgres' },
          {
            kind: 'PersistentVolumeClaim',
            namespace: 'data',
            name: 'data-postgres-0',
          },
        ],
        evidence: [
          {
            field: 'db.replicas',
            value: 1,
            text: '레플리카 1개 (standby 없음)',
          },
          {
            field: 'db.pvcUsagePct',
            value: 78.4,
            text: 'PVC 사용률 78.4% (DB 크기 기준 근사)',
          },
        ],
        precheckIds: ['R-DB-SINGLE', 'R-DB-PVC'],
        savings: null,
        steps: [
          {
            text: '스트리밍 복제 standby를 1개 추가하는 방식을 검토합니다 (오퍼레이터 또는 수동 구성).',
            code: null,
            language: null,
          },
          {
            text: 'PVC를 확장하기 전에 StorageClass의 allowVolumeExpansion을 확인합니다.',
            code: 'kubectl get storageclass -o custom-columns=NAME:.metadata.name,EXPAND:.allowVolumeExpansion',
            language: 'bash',
          },
        ],
        risk: { level: 'medium', reason: '복제 구성 중 부하 증가' },
        verification: 'DB 화면에서 standby 1개와 복제 지연을 확인합니다.',
      },
      {
        title: 'node-exporter 외 워크로드의 권한 상승 차단',
        category: 'security',
        severity: 'medium',
        priority: 4,
        targets: [{ kind: 'Deployment', namespace: 'prod', name: 'web' }],
        evidence: [
          {
            field: 'workloads[prod/web].containers[web].security.runAsNonRoot',
            value: null,
            text: 'prod/web runAsNonRoot 미설정',
          },
        ],
        precheckIds: ['R-PRIV', 'R-ROOT'],
        savings: null,
        steps: [
          {
            text: 'securityContext를 추가합니다.',
            code: 'securityContext:\n  runAsNonRoot: true\n  allowPrivilegeEscalation: false',
            language: 'yaml',
          },
        ],
        risk: {
          level: 'low',
          reason: '이미지가 root 사용자를 가정하면 기동 실패',
        },
        verification: '배포 후 파드가 Running인지 확인합니다.',
      },
      {
        title: 'payment-gateway 레플리카 증설',
        category: 'performance',
        severity: 'low',
        priority: 5,
        targets: [
          { kind: 'Deployment', namespace: 'prod', name: 'payment-gateway' },
        ],
        evidence: [
          {
            field: 'workloads[prod/payment-gateway].desired',
            value: 1,
            text: '레플리카 1개',
          },
        ],
        precheckIds: [],
        savings: null,
        steps: [{ text: 'HPA를 설정합니다.', code: null, language: null }],
        risk: { level: 'low', reason: '없음' },
        verification: null,
      },
    ],
  };
}

export const EXAMPLE_INVALID_RAW =
  '분석 결과입니다.\n\n1. batch 노드그룹 비용 절감 — Graviton 전환 권장\n2. report-worker 메모리 limit 상향\n\n(JSON 형식이 아닌 예시 응답: 응답 형식 오류 시나리오)';
