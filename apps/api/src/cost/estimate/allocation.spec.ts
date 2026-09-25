import type { InventoryPod } from '../cluster-inventory.port';
import {
  awsSnapshot,
  instance,
  inventory,
  priceBook,
  quote,
} from '../test-helpers';
import {
  buildMockWorld,
  mockPriceBook,
  COST_SCENARIOS,
} from '../mock/mock-world';
import { computeAllocation, presentAllocation } from './allocation';
import { computeEstimate } from './estimator';

const GI = 1024 ** 3;
const pod = (
  p: Partial<InventoryPod> & { namespace: string; name: string },
): InventoryPod => ({
  nodeName: 'n1',
  phase: 'Running',
  cpuMillicores: null,
  memoryBytes: null,
  ...p,
});

function scenario() {
  const inv = inventory({
    nodes: [
      {
        name: 'n1',
        providerId: 'aws:///ap-northeast-2a/i-01',
        instanceType: 'm6i.large',
        capacityType: 'on_demand',
        zone: 'ap-northeast-2a',
        nodeGroup: 'g',
        role: 'worker',
        architecture: 'amd64',
        allocatable: { cpuMillicores: 2000, memoryBytes: 8 * GI },
      },
      {
        name: 'gpu',
        providerId: 'aws:///ap-northeast-2a/i-02',
        instanceType: 'g6e.xlarge',
        capacityType: 'on_demand',
        zone: 'ap-northeast-2a',
        nodeGroup: 'gpu',
        role: 'worker',
        architecture: 'amd64',
        allocatable: { cpuMillicores: 4000, memoryBytes: 32 * GI },
      },
    ],
    pods: [
      // CPU 50% + 메모리 25% → (0.5 + 0.25) / 2 = 37.5% of $0.1 = 0.0375
      pod({
        namespace: 'batch',
        name: 'a',
        cpuMillicores: 1000,
        memoryBytes: 2 * GI,
      }),
      // CPU 10% + 메모리 12.5% → 11.25% = 0.01125
      pod({
        namespace: 'prod',
        name: 'b',
        cpuMillicores: 200,
        memoryBytes: 1 * GI,
      }),
      pod({ namespace: 'prod', name: 'no-req' }),
      pod({
        namespace: 'batch',
        name: 'done',
        phase: 'Succeeded',
        cpuMillicores: 1000,
        memoryBytes: 4 * GI,
      }),
      pod({
        namespace: 'ml',
        name: 'on-gpu',
        nodeName: 'gpu',
        cpuMillicores: 3000,
        memoryBytes: 16 * GI,
      }),
      pod({
        namespace: 'kube-system',
        name: 'dns',
        cpuMillicores: 100,
        memoryBytes: 0.5 * GI,
      }),
    ],
    pvcs: [
      {
        namespace: 'data',
        name: 'pg',
        sizeBytes: null,
        storageClass: 'gp3',
        volumeHandle: 'vol-pvc',
      },
    ],
    loadBalancers: [
      {
        kind: 'Service',
        namespace: 'prod',
        name: 'web',
        hostnames: ['web.elb'],
      },
    ],
  });
  const aws = awsSnapshot({
    instances: [
      instance({
        instanceId: 'i-01',
        instanceType: 'm6i.large',
        rootVolumeIds: ['vol-root'],
        publicIpv4Count: 1,
      }),
      instance({ instanceId: 'i-02', instanceType: 'g6e.xlarge' }),
    ],
    volumes: [
      {
        volumeId: 'vol-root',
        volumeType: 'gp3',
        sizeGiB: 73,
        iops: 3000,
        throughputMibps: 125,
        zone: null,
        state: 'in-use',
        attachedInstanceIds: ['i-01'],
        pvcNamespace: null,
        pvcName: null,
        csiManaged: false,
      },
      {
        volumeId: 'vol-pvc',
        volumeType: 'gp3',
        sizeGiB: 146,
        iops: 3000,
        throughputMibps: 125,
        zone: null,
        state: 'in-use',
        attachedInstanceIds: ['i-01'],
        pvcNamespace: null,
        pvcName: null,
        csiManaged: true,
      },
    ],
    loadBalancers: [
      {
        name: 'web',
        dnsName: 'web.elb',
        lbType: 'nlb',
        tagRefs: [],
        clusterTags: [],
        healthyTargets: 1,
      },
      {
        name: 'shared',
        dnsName: 's.elb',
        lbType: 'alb',
        tagRefs: [],
        clusterTags: ['prod.k8s.example.com'],
        healthyTargets: 0,
      },
    ],
  });
  const est = computeEstimate({
    inventory: inv,
    aws,
    hoursPerMonth: 730,
    clusterName: 'prod.k8s.example.com',
    prices: priceBook({
      onDemand: { 'm6i.large': quote(0.1) }, // g6e는 단가 없음
      ebs: { gp3: { storage: quote(0.1), iops: null, throughput: null } },
      lb: { nlb: quote(0.02), alb: quote(0.03) },
      ipv4: quote(0.005),
    }),
  });
  return { inv, est };
}

describe('computeAllocation (네임스페이스 배분)', () => {
  it('노드 비용 = 시간당 × (CPU 비율 + 메모리 비율) ÷ 2, 나머지는 미할당', () => {
    const { inv, est } = scenario();
    const a = computeAllocation(est, inv, 730);
    const batch = a.rows.find((r) => r.namespace === 'batch')!;
    const prod = a.rows.find((r) => r.namespace === 'prod')!;
    expect(batch.breakdown.nodeUsdPerHour).toBeCloseTo(0.0375, 6);
    expect(prod.breakdown.nodeUsdPerHour).toBeCloseTo(0.01125, 6);
    // kube-system: (0.05 + 0.0625)/2 = 5.625% → 0.005625
    const unalloc = a.pinnedRows.find((p) => p.key === 'unallocated')!;
    expect(unalloc.usdPerHour).toBeCloseTo(
      0.1 - 0.0375 - 0.01125 - 0.005625,
      6,
    );
  });

  it('완료 파드 제외, requests 미설정 경고, 단가 없는 노드의 파드는 배분 없음', () => {
    const { inv, est } = scenario();
    const a = computeAllocation(est, inv, 730);
    const prod = a.rows.find((r) => r.namespace === 'prod')!;
    expect(prod.warnings).toEqual([
      { code: 'REQUESTS_MISSING', text: 'requests 미설정 파드 1개', count: 1 },
    ]);
    expect(a.rows.find((r) => r.namespace === 'ml')).toBeUndefined();
    const batch = a.rows.find((r) => r.namespace === 'batch')!;
    expect(batch.warnings).toEqual([]);
  });

  it('PVC → 네임스페이스, 루트 볼륨·컨트롤 플레인·IPv4 → 공용(클러스터)', () => {
    const { inv, est } = scenario();
    const a = computeAllocation(est, inv, 730);
    const data = a.rows.find((r) => r.namespace === 'data')!;
    expect(data.breakdown.storageUsdPerHour).toBeCloseTo((146 * 0.1) / 730, 6);
    const prod = a.rows.find((r) => r.namespace === 'prod')!;
    expect(prod.breakdown.lbUsdPerHour).toBeCloseTo(0.02, 6);
    const sc = a.pinnedRows.find((p) => p.key === 'shared_cluster')!;
    // 클러스터 태그가 있고 Service·Ingress에 귀속되지 않는 LB는 api_lb 후보 → 컨트롤 플레인
    expect(sc.breakdown.controlPlaneUsdPerHour).toBeCloseTo(0.03, 6);
    expect(sc.breakdown.ipv4UsdPerHour).toBeCloseTo(0.005, 6);
    expect(sc.breakdown.storageUsdPerHour).toBeCloseTo((73 * 0.1) / 730, 6);
    expect(a.pinnedRows.find((p) => p.key === 'shared')).toBeUndefined();
  });

  // AC-KOPS15: 마스터 노드 비용은 파드에 배분하지 않고 공용(클러스터) 행으로
  it('마스터 노드 비용은 파드에 배분하지 않고 shared_cluster로 간다', () => {
    const inv = inventory({
      nodes: [
        {
          name: 'w1',
          providerId: 'aws:///ap-northeast-2a/i-01',
          instanceType: 'm6i.large',
          capacityType: 'on_demand',
          zone: 'ap-northeast-2a',
          nodeGroup: 'nodes-ap-northeast-2a',
          role: 'worker',
          architecture: 'amd64',
          allocatable: { cpuMillicores: 2000, memoryBytes: 8 * GI },
        },
        {
          name: 'm1',
          providerId: 'aws:///ap-northeast-2a/i-02',
          instanceType: 't3.medium',
          capacityType: 'on_demand',
          zone: 'ap-northeast-2a',
          nodeGroup: 'control-plane-ap-northeast-2a',
          role: 'control_plane',
          architecture: 'amd64',
          allocatable: { cpuMillicores: 2000, memoryBytes: 4 * GI },
        },
      ],
      pods: [
        pod({
          namespace: 'prod',
          name: 'web',
          nodeName: 'w1',
          cpuMillicores: 1000,
          memoryBytes: 4 * GI,
        }),
        // 마스터 위 컨트롤 플레인 파드: requests가 커도 비용이 배분되지 않는다
        pod({
          namespace: 'kube-system',
          name: 'kube-apiserver-m1',
          nodeName: 'm1',
          cpuMillicores: 1000,
          memoryBytes: 2 * GI,
        }),
      ],
      pvcs: [],
      loadBalancers: [],
    });
    const est = computeEstimate({
      inventory: inv,
      aws: awsSnapshot({
        instances: [
          instance({ instanceId: 'i-01', instanceType: 'm6i.large' }),
          instance({ instanceId: 'i-02', instanceType: 't3.medium' }),
        ],
      }),
      hoursPerMonth: 730,
      clusterName: 'prod.k8s.example.com',
      prices: priceBook({
        onDemand: { 'm6i.large': quote(0.1), 't3.medium': quote(0.05) },
      }),
    });
    const a = computeAllocation(est, inv, 730);
    const sc = a.pinnedRows.find((p) => p.key === 'shared_cluster')!;
    // 마스터 $0.05 전액이 공용(클러스터)의 컨트롤 플레인 몫
    expect(sc.breakdown.controlPlaneUsdPerHour).toBeCloseTo(0.05, 6);
    expect(sc.breakdown.nodeUsdPerHour).toBe(0);
    // kube-system(마스터 위 파드)에는 노드 비용이 가지 않는다
    expect(a.rows.find((r) => r.namespace === 'kube-system')).toBeUndefined();
    const prod = a.rows.find((r) => r.namespace === 'prod')!;
    expect(prod.breakdown.nodeUsdPerHour).toBeCloseTo(0.05, 6); // (0.5+0.5)/2 × 0.1
    // 합계는 그대로 성립한다
    const rowsSum =
      a.rows.reduce((s, r) => s + r.usdPerHour, 0) +
      a.pinnedRows.reduce((s, r) => s + r.usdPerHour, 0);
    expect(Math.abs(rowsSum - est.total.usdPerHour)).toBeLessThan(0.01);
    expect(est.total.usdPerHour).toBeCloseTo(0.15, 6);
  });

  it('배분 합계(미할당·공용 포함) = 추정 합계 (±$0.01)', () => {
    const { inv, est } = scenario();
    const a = computeAllocation(est, inv, 730);
    const rowsSum =
      a.rows.reduce((s, r) => s + r.usdPerHour, 0) +
      a.pinnedRows.reduce((s, r) => s + r.usdPerHour, 0);
    expect(Math.abs(a.total.usdPerHour - est.total.usdPerHour)).toBeLessThan(
      0.01,
    );
    expect(Math.abs(rowsSum - est.total.usdPerHour)).toBeLessThan(0.01);
  });

  it.each(COST_SCENARIOS)(
    'mock 시나리오 %s에서도 배분 합계 = 추정 합계',
    (sc) => {
      const now = new Date('2026-09-19T05:06:00Z');
      const w = buildMockWorld(sc, now);
      const est = computeEstimate({
        inventory: w.inventory,
        aws: w.aws,
        prices: mockPriceBook(sc, w, now),
        hoursPerMonth: 730,
        clusterName: 'prod.k8s.example.com',
      });
      const a = computeAllocation(est, w.inventory, 730);
      const rowsSum =
        a.rows.reduce((s, r) => s + r.usdPerHour, 0) +
        a.pinnedRows.reduce((s, r) => s + r.usdPerHour, 0);
      expect(Math.abs(rowsSum - est.total.usdPerHour)).toBeLessThan(0.01);
    },
  );

  it('hideSystem: 시스템 행을 숨김 행으로 합쳐 합계 유지, 기본 정렬 usdPerHour desc', () => {
    const { inv, est } = scenario();
    const a = computeAllocation(est, inv, 730);
    const shown = presentAllocation(
      a,
      { hideSystem: true, sortField: 'usdPerHour', sortDir: 'desc' },
      730,
    );
    expect(shown.rows.some((r) => r.isSystem)).toBe(false);
    expect(shown.hiddenSystem?.usdPerHour).toBeCloseTo(0.005625, 6);
    const hours = shown.rows.map((r) => r.usdPerHour);
    expect([...hours].sort((x, y) => y - x)).toEqual(hours);
  });
});
