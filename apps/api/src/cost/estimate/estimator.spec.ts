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
  capacityType: 'on_demand',
  zone: 'ap-northeast-2a',
  nodeGroup: 'general',
  architecture: 'amd64',
  allocatable: { cpuMillicores: 2000, memoryBytes: 8 * 1024 ** 3 },
  ...p,
});

const base = {
  hoursPerMonth: 730,
  eksSupportTier: 'standard' as const,
  clusterName: 'prod-eks',
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
            clusterTags: ['prod-eks'],
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
    expect(r.resources.lb.map((l) => l.name)).toEqual(['alb-1', 'nlb-shared']);
    expect(r.resources.lb[0].attachedTo).toEqual([
      { kind: 'Ingress', namespace: 'prod', name: 'api' },
    ]);
    expect(r.outOfCluster.byCategory.lb).toBe(1);
  });

  it('퍼블릭 IPv4·EKS 컨트롤 플레인(확장 지원 단가)', () => {
    const r = computeEstimate({
      ...base,
      eksSupportTier: 'extended',
      inventory: inventory({ nodes: [node('n1', 'i-01')] }),
      aws: awsSnapshot({
        instances: [
          instance({
            instanceId: 'i-01',
            instanceType: 'm6i.large',
            publicIpv4Count: 2,
          }),
        ],
        eks: { name: 'prod-eks', version: '1.28' },
      }),
      prices: priceBook({
        onDemand: { 'm6i.large': quote(0.1) },
        ipv4: quote(0.005),
        eks: { standard: quote(0.1), extended: quote(0.6) },
      }),
    });
    expect(r.resources.ipv4[0]).toMatchObject({ count: 2, usdPerHour: 0.01 });
    expect(r.resources.eks[0]).toMatchObject({
      supportTier: 'extended',
      usdPerHour: 0.6,
    });
    expect(r.total.usdPerHour).toBeCloseTo(0.71, 6);
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
