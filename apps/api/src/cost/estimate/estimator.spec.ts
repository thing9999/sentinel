import type { InventoryNode } from '../cluster-inventory.port';
import { spotKey } from '../cost.types';
import {
  awsSnapshot,
  instance,
  inventory,
  priceBook,
  quote,
} from '../test-helpers';
import { computeEstimate, emptyPriceBook, priceNeedsOf } from './estimator';

const node = (
  name: string,
  id: string,
  p: Partial<InventoryNode> = {},
): InventoryNode => ({
  name,
  providerId: `aws:///ap-northeast-2a/${id}`,
  instanceType: 'm6i.large',
  role: 'worker',
  capacityType: 'on_demand',
  zone: 'ap-northeast-2a',
  nodeGroup: 'general',
  architecture: 'amd64',
  allocatable: { cpuMillicores: 2000, memoryBytes: 8 * 1024 ** 3 },
  ...p,
});

const base = {
  hoursPerMonth: 730,
  clusterName: 'prod.k8s.example.com',
};

describe('computeEstimate (단가 계산)', () => {
  it('온디맨드 노드 = 공시 단가, 월 = ×730, 일 = ×24', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({ nodes: [node('n1', 'i-01')] }),
      aws: awsSnapshot({
        instances: [
          instance({ instanceId: 'i-01', instanceType: 'm6i.large' }),
        ],
      }),
      prices: priceBook({ onDemand: { 'm6i.large': quote(0.096) } }),
    });
    const row = r.resources.ec2[0];
    expect(row.unitPrice?.source).toBe('pricing_api');
    expect(row.usdPerHour).toBe(0.096);
    expect(row.usdPerMonth).toBeCloseTo(70.08, 6);
    expect(r.total).toEqual({
      usdPerHour: 0.096,
      usdPerDay: 2.304,
      usdPerMonth: 70.08,
    });
  });

  it('스팟 노드는 해당 타입·AZ의 스팟 시세를 쓴다', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({
        nodes: [
          node('s1', 'i-02', { capacityType: 'spot', zone: 'ap-northeast-2c' }),
        ],
      }),
      aws: awsSnapshot({
        instances: [
          instance({
            instanceId: 'i-02',
            instanceType: 'm6i.large',
            lifecycle: 'spot',
            zone: 'ap-northeast-2c',
          }),
        ],
      }),
      prices: priceBook({
        onDemand: { 'm6i.large': quote(0.118) },
        spot: {
          [spotKey('m6i.large', 'ap-northeast-2c')]: {
            usd: 0.0342,
            fetchedAt: '2026-09-19T04:00:00.000Z',
            zone: 'ap-northeast-2c',
          },
        },
      }),
    });
    const row = r.resources.ec2[0];
    expect(row.capacityType).toBe('spot');
    expect(row.unitPrice).toEqual({
      usdPerHour: 0.0342,
      source: 'spot_price_history',
      asOf: '2026-09-19T04:00:00.000Z',
      zone: 'ap-northeast-2c',
    });
    expect(row.spotFallback).toBe(false);
  });

  it('스팟 시세 조회 실패 → 온디맨드 상한 + 플래그 + 노트', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({
        nodes: [node('s1', 'i-02', { capacityType: 'spot' })],
      }),
      aws: awsSnapshot({
        instances: [
          instance({
            instanceId: 'i-02',
            instanceType: 'c7i.xlarge',
            lifecycle: 'spot',
          }),
        ],
      }),
      prices: priceBook({
        onDemand: { 'c7i.xlarge': quote(0.2072) },
        spot: { [spotKey('c7i.xlarge', 'ap-northeast-2a')]: null },
      }),
    });
    const row = r.resources.ec2[0];
    expect(row.spotFallback).toBe(true);
    expect(row.unitPrice?.source).toBe('on_demand_fallback');
    expect(row.usdPerHour).toBe(0.2072);
    expect(row.notes.map((n) => n.code)).toContain('SPOT_PRICE_FALLBACK');
    expect(r.spotFallbackCount).toBe(1);
  });

  it('InstanceLifecycle(spot)이 노드 레이블보다 우선한다', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({
        nodes: [node('n', 'i-03', { capacityType: 'on_demand' })],
      }),
      aws: awsSnapshot({
        instances: [
          instance({
            instanceId: 'i-03',
            instanceType: 'm6i.large',
            lifecycle: 'spot',
          }),
        ],
      }),
      prices: priceBook({ onDemand: { 'm6i.large': quote(0.118) } }),
    });
    expect(r.resources.ec2[0].capacityType).toBe('spot');
  });

  it('단가 없는 리소스는 합계에서 빠지고 unpriced로 표시', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({
        nodes: [
          node('n1', 'i-01'),
          node('gpu', 'i-09', { instanceType: 'g6e.xlarge' }),
        ],
      }),
      aws: awsSnapshot({
        instances: [
          instance({ instanceId: 'i-01', instanceType: 'm6i.large' }),
          instance({ instanceId: 'i-09', instanceType: 'g6e.xlarge' }),
        ],
      }),
      prices: priceBook({ onDemand: { 'm6i.large': quote(0.1) } }),
    });
    const gpu = r.resources.ec2.find((x) => x.nodeName === 'gpu')!;
    expect(gpu.priced).toBe(false);
    expect(gpu.usdPerHour).toBeNull();
    expect(gpu.notes[0].code).toBe('UNPRICED');
    expect(r.unpricedCount).toBe(1);
    expect(r.total.usdPerHour).toBe(0.1);
    expect(r.categories.find((c) => c.category === 'ec2')?.unpricedCount).toBe(
      1,
    );
  });

  it('EBS gp3: 용량 + 3000 초과 IOPS + 125 초과 처리량, PVC·루트·클러스터 외 구분', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({
        nodes: [node('n1', 'i-01')],
        pvcs: [
          {
            namespace: 'data',
            name: 'pg-0',
            sizeBytes: null,
            storageClass: 'gp3',
            volumeHandle: null,
          },
        ],
      }),
      aws: awsSnapshot({
        instances: [
          instance({
            instanceId: 'i-01',
            instanceType: 'm6i.large',
            rootVolumeIds: ['vol-root'],
          }),
        ],
        volumes: [
          {
            volumeId: 'vol-root',
            volumeType: 'gp3',
            sizeGiB: 20,
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
            sizeGiB: 100,
            iops: 6000,
            throughputMibps: 250,
            zone: null,
            state: 'in-use',
            attachedInstanceIds: ['i-01'],
            pvcNamespace: 'data',
            pvcName: 'pg-0',
            csiManaged: true,
          },
          {
            volumeId: 'vol-other-cluster',
            volumeType: 'gp2',
            sizeGiB: 8,
            iops: 100,
            throughputMibps: null,
            zone: null,
            state: 'available',
            attachedInstanceIds: [],
            pvcNamespace: 'x',
            pvcName: 'y',
            csiManaged: true,
          },
        ],
      }),
      prices: priceBook({
        onDemand: { 'm6i.large': quote(0.1) },
        ebs: {
          gp3: {
            storage: quote(0.08),
            iops: quote(0.005),
            throughput: quote(0.04),
          },
        },
      }),
    });
    const root = r.resources.ebs.find((v) => v.volumeId === 'vol-root')!;
    const pvc = r.resources.ebs.find((v) => v.volumeId === 'vol-pvc')!;
    expect(root.attachment.type).toBe('node_root');
    expect(root.usdPerMonth).toBeCloseTo(1.6, 6);
    expect(pvc.attachment).toEqual({
      type: 'pvc',
      namespace: 'data',
      name: 'pg-0',
      nodeName: 'n1',
    });
    // 100 × 0.08 + 3000 × 0.005 + 125 × 0.04 = 8 + 15 + 5 = 28
    expect(pvc.usdPerMonth).toBeCloseTo(28, 6);
    expect(pvc.usdPerHour).toBeCloseTo(28 / 730, 6);
    expect(pvc.sizeBytes).toBe(100 * 1024 ** 3);
    expect(r.outOfCluster).toEqual({ count: 1, byCategory: { ebs: 1 } });
  });

  it('LB: DNS·태그로 클러스터 소속 판단, 나머지는 클러스터 외', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({
        loadBalancers: [
          {
            kind: 'Ingress',
            namespace: 'prod',
            name: 'api',
            hostnames: ['ALB-1.elb.amazonaws.com'],
          },
        ],
      }),
      aws: awsSnapshot({
        loadBalancers: [
          {
            name: 'alb-1',
            dnsName: 'alb-1.elb.amazonaws.com',
            lbType: 'alb',
            tagRefs: [],
            clusterTags: [],
            healthyTargets: 2,
          },
          {
            name: 'nlb-shared',
            dnsName: 'x',
            lbType: 'nlb',
            tagRefs: [],
            clusterTags: ['prod.k8s.example.com'],
            healthyTargets: 0,
          },
          {
            name: 'foreign',
            dnsName: 'y',
            lbType: 'alb',
            tagRefs: [],
            clusterTags: [],
            healthyTargets: 1,
          },
        ],
      }),
      prices: priceBook({ lb: { alb: quote(0.0252), nlb: quote(0.0252) } }),
    });
    // 클러스터 태그만 있고 Service·Ingress에 귀속되지 않는 LB는 API 서버 LB 후보다 (추정)
    expect(r.resources.lb.map((l) => l.name)).toEqual(['alb-1']);
    expect(r.resources.lb[0].attachedTo).toEqual([
      { kind: 'Ingress', namespace: 'prod', name: 'api' },
    ]);
    const apiLb = r.resources.controlPlane.filter((x) => x.kind === 'api_lb');
    expect(apiLb.map((x) => x.name)).toEqual(['nlb-shared']);
    expect(apiLb[0].identification).toMatchObject({
      confidence: 'assumed',
      candidateCount: 1,
    });
    expect(apiLb[0].notes.map((n) => n.code)).toContain('API_LB_ASSUMED');
    const cpCat = r.categories.find((c) => c.category === 'controlPlane')!;
    expect(cpCat.apiLb).toEqual({
      state: 'assumed',
      candidateCount: 1,
      text: 'API 서버 LB로 추정 (1개)',
    });
    expect(r.outOfCluster.byCategory.lb).toBe(1);
  });

  it('퍼블릭 IPv4 (kOps에는 컨트롤 플레인 관리 요금이 없다)', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({ nodes: [node('n1', 'i-01')] }),
      aws: awsSnapshot({
        instances: [
          instance({
            instanceId: 'i-01',
            instanceType: 'm6i.large',
            publicIpv4Count: 2,
          }),
        ],
      }),
      prices: priceBook({
        onDemand: { 'm6i.large': quote(0.1) },
        ipv4: quote(0.005),
      }),
    });
    expect(r.resources.ipv4[0]).toMatchObject({ count: 2, usdPerHour: 0.01 });
    expect(r.resources.controlPlane).toHaveLength(0);
    expect(r.total.usdPerHour).toBeCloseTo(0.11, 6);
    const shares = r.categories.reduce((s, c) => s + c.sharePct, 0);
    expect(Math.abs(shares - 100)).toBeLessThanOrEqual(0.3);
  });

  it('인벤토리가 없으면 AWS 인스턴스(태그 기반)로 노드를 만든다', () => {
    const r = computeEstimate({
      ...base,
      inventory: inventory({ state: 'not_configured' }),
      aws: awsSnapshot({
        instances: [instance({ instanceId: 'i-7', instanceType: 'm6i.large' })],
      }),
      prices: priceBook({ onDemand: { 'm6i.large': quote(0.1) } }),
    });
    expect(r.resources.ec2[0].key).toBe('instance:i-7');
    expect(r.total.usdPerHour).toBe(0.1);
  });

  it('priceNeedsOf: 필요한 단가 목록만 뽑는다', () => {
    const dry = computeEstimate({
      ...base,
      inventory: inventory({
        nodes: [
          node('s', 'i-1', { capacityType: 'spot', zone: 'ap-northeast-2c' }),
        ],
      }),
      aws: awsSnapshot({
        instances: [
          instance({
            instanceId: 'i-1',
            instanceType: 'm6i.large',
            zone: 'ap-northeast-2c',
            lifecycle: 'spot',
          }),
        ],
        volumes: [
          {
            volumeId: 'v',
            volumeType: 'gp3',
            sizeGiB: 10,
            iops: 4000,
            throughputMibps: 125,
            zone: null,
            state: 'in-use',
            attachedInstanceIds: ['i-1'],
            pvcNamespace: null,
            pvcName: null,
            csiManaged: false,
          },
        ],
      }),
      prices: emptyPriceBook(),
    });
    const needs = priceNeedsOf(dry);
    expect(needs.instanceTypes).toEqual(['m6i.large']);
    expect(needs.spot).toEqual([
      { type: 'm6i.large', zone: 'ap-northeast-2c' },
    ]);
    expect(needs.ebs).toEqual([
      { volumeType: 'gp3', iops: true, throughput: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// kops-support P4: 컨트롤 플레인 분류 (AC-KOPS27~30)
// ---------------------------------------------------------------------------

describe('컨트롤 플레인 카테고리', () => {
  const vol = (
    id: string,
    inst: string,
    p: Partial<{ sizeGiB: number; volumeType: string }> = {},
  ) => ({
    volumeId: id,
    volumeType: p.volumeType ?? 'gp3',
    sizeGiB: p.sizeGiB ?? 20,
    iops: 3000,
    throughputMibps: 125,
    zone: null,
    state: 'in-use',
    attachedInstanceIds: [inst],
    pvcNamespace: null,
    pvcName: null,
    csiManaged: false,
  });

  /** 마스터 3대(각 루트 1 + etcd main/events 2) + 워커 1대 */
  const world = () => {
    const nodes: InventoryNode[] = [
      node('w1', 'i-01'),
      ...[1, 2, 3].map((i) =>
        node(`m${i}`, `i-0${i}0`, {
          role: 'control_plane',
          instanceType: 't3.medium',
          nodeGroup: `control-plane-ap-northeast-2${'abc'[i - 1]}`,
        }),
      ),
    ];
    const instances = [
      instance({
        instanceId: 'i-01',
        instanceType: 'm6i.large',
        rootVolumeIds: ['vol-w1-root'],
      }),
      ...[1, 2, 3].map((i) =>
        instance({
          instanceId: `i-0${i}0`,
          instanceType: 't3.medium',
          rootVolumeIds: [`vol-m${i}-root`],
          publicIpv4Count: 1,
        }),
      ),
    ];
    const volumes = [
      vol('vol-w1-root', 'i-01', { sizeGiB: 50 }),
      ...[1, 2, 3].flatMap((i) => [
        vol(`vol-m${i}-root`, `i-0${i}0`),
        vol(`vol-m${i}-etcd-main`, `i-0${i}0`),
        vol(`vol-m${i}-etcd-events`, `i-0${i}0`),
      ]),
    ];
    return { nodes, instances, volumes };
  };

  const compute = (lbs: unknown[] = []) => {
    const w = world();
    return computeEstimate({
      ...base,
      clusterName: 'prod.k8s.example.com',
      inventory: inventory({ nodes: w.nodes }),
      aws: awsSnapshot({
        instances: w.instances,
        volumes: w.volumes,
        loadBalancers: lbs as never,
      }),
      prices: priceBook({
        onDemand: { 'm6i.large': quote(0.118), 't3.medium': quote(0.052) },
        ebs: { gp3: { storage: quote(0.0912), iops: null, throughput: null } },
        ipv4: quote(0.005),
        lb: { nlb: quote(0.0225), alb: quote(0.0225) },
      }),
    });
  };

  it('마스터 3대면 etcd 볼륨 6개 · 루트 3개 · IPv4 3개로 나뉜다 (AC-KOPS28)', () => {
    const r = compute();
    const byKind = (k: string) =>
      r.resources.controlPlane.filter((x) => x.kind === k);
    expect(byKind('master_ec2')).toHaveLength(3);
    expect(byKind('etcd_ebs')).toHaveLength(6);
    expect(byKind('master_root_ebs')).toHaveLength(3);
    expect(byKind('master_ipv4')).toHaveLength(3);
    // etcd main/events 구분은 아직 확인하지 못했다 → null
    expect(byKind('etcd_ebs').every((x) => x.etcdCluster === null)).toBe(true);
  });

  it('마스터 리소스가 ec2·ebs·ipv4에 중복으로 잡히지 않는다 (AC-KOPS29)', () => {
    const r = compute();
    expect(r.resources.ec2.map((x) => x.nodeName)).toEqual(['w1']);
    expect(r.resources.ipv4).toHaveLength(0);
    expect(r.resources.ebs.map((x) => x.volumeId)).toEqual(['vol-w1-root']);
    // 카테고리 합계 = 전체 추정 소모율
    const sum = r.categories.reduce((a, c) => a + c.usdPerHour, 0);
    expect(Math.abs(sum - r.total.usdPerHour)).toBeLessThan(0.01);
  });

  it('카테고리 순서가 고정이고 byKind 합계 = 카테고리 합계', () => {
    const r = compute();
    expect(r.categories.map((c) => c.category)).toEqual([
      'ec2',
      'ebs',
      'lb',
      'ipv4',
      'controlPlane',
    ]);
    const cp = r.categories.find((c) => c.category === 'controlPlane')!;
    expect(cp.label).toBe('컨트롤 플레인');
    const byKindSum = (cp.byKind ?? []).reduce((a, k) => a + k.usdPerHour, 0);
    expect(Math.abs(byKindSum - cp.usdPerHour)).toBeLessThan(0.000005);
    expect((cp.byKind ?? []).map((k) => k.kind)).toEqual([
      'master_ec2',
      'etcd_ebs',
      'master_root_ebs',
      'master_ipv4',
    ]);
    // 마스터 EC2 3 × $0.052
    expect(cp.byKind![0].usdPerHour).toBeCloseTo(0.156, 6);
  });

  it('api_lb 후보 0개면 행이 없고 apiLb.state = not_found (오류 아님)', () => {
    const cp = compute().categories.find((c) => c.category === 'controlPlane')!;
    expect(cp.apiLb).toMatchObject({ state: 'not_found', candidateCount: 0 });
    expect(cp.notes?.[0].code).toBe('API_LB_NOT_FOUND');
  });

  it('api_lb 후보 2개 이상이면 전부 넣고 ambiguous 경고 (금액은 합산)', () => {
    const lbs = [1, 2].map((i) => ({
      name: `api-lb-${i}`,
      dnsName: `x${i}`,
      lbType: 'nlb',
      tagRefs: [],
      clusterTags: ['prod.k8s.example.com'],
      healthyTargets: 3,
    }));
    const r = compute(lbs);
    const rows = r.resources.controlPlane.filter((x) => x.kind === 'api_lb');
    expect(rows).toHaveLength(2);
    expect(rows[0].identification).toMatchObject({
      confidence: 'ambiguous',
      candidateCount: 2,
    });
    expect(rows[0].notes.map((n) => n.code)).toContain('API_LB_AMBIGUOUS');
    const cp = r.categories.find((c) => c.category === 'controlPlane')!;
    expect(cp.apiLb).toMatchObject({ state: 'ambiguous', candidateCount: 2 });
    expect(r.resources.lb).toHaveLength(0);
    const sum = r.categories.reduce((a, c) => a + c.usdPerHour, 0);
    expect(Math.abs(sum - r.total.usdPerHour)).toBeLessThan(0.01);
  });

  it('컨트롤 플레인 리소스의 단가도 조회 목록에 들어간다', () => {
    const w = world();
    const dry = computeEstimate({
      ...base,
      clusterName: 'prod.k8s.example.com',
      inventory: inventory({ nodes: w.nodes }),
      aws: awsSnapshot({
        instances: w.instances,
        volumes: w.volumes,
        loadBalancers: [
          {
            name: 'api',
            dnsName: 'x',
            lbType: 'nlb',
            tagRefs: [],
            clusterTags: ['prod.k8s.example.com'],
            healthyTargets: 3,
          },
        ] as never,
      }),
      prices: emptyPriceBook(),
    });
    const needs = priceNeedsOf(dry);
    expect(needs.instanceTypes.sort()).toEqual(['m6i.large', 't3.medium']);
    expect(needs.lb).toContain('nlb');
    expect(needs.ipv4).toBe(true);
  });
});
