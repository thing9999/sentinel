/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return -- 응답 JSON 모양을 검사하는 테스트 */
import { ApiException } from '../common/api-error';
import { buildMockWorld as buildClusterMockWorld } from '../cluster/mock/mock-world';
import {
  NotConfiguredClusterInventory,
  type ClusterInventoryPort,
  type ClusterInventorySnapshot,
} from './cluster-inventory.port';
import type { CostOptions } from './cost.options';
import { CostService } from './cost.service';
import { COST_SCENARIOS } from './mock/mock-world';
import { CostSettingsService } from './settings/cost-settings.service';
import { CostStore } from './store/cost-store';
import { FakeGateway, instance } from './test-helpers';

const NOW = new Date('2026-09-19T05:06:00Z');

/** cluster mock 세계를 ClusterStateService.inventorySnapshot()과 같은 모양으로 (연결된 포트 흉내) */
function clusterMockInventory(
  scenario: 'mixed' | 'no-cluster' = 'mixed',
): ClusterInventorySnapshot {
  const w = buildClusterMockWorld(scenario, NOW.getTime());
  if (scenario === 'no-cluster')
    return {
      state: 'not_configured',
      updatedAt: null,
      nodes: [],
      pods: [],
      pvcs: [],
      loadBalancers: [],
    };
  const sum = (xs: (number | null)[]) =>
    xs.some((x) => x !== null)
      ? xs.reduce<number>((a, x) => a + (x ?? 0), 0)
      : null;
  return {
    state: 'ok',
    updatedAt: NOW,
    kubernetesVersion: /^v?(\d+\.\d+)/.exec(w.info.version)?.[1] ?? null,
    nodes: w.nodes.map((n) => ({
      name: n.name,
      providerId: n.providerId,
      instanceType: n.instanceType,
      capacityType: n.capacityType,
      role: n.role,
      zone: n.zone,
      nodeGroup: n.nodeGroup,
      architecture: n.architecture,
      allocatable: {
        cpuMillicores: n.allocatable.cpuMillicores,
        memoryBytes: n.allocatable.memoryBytes,
      },
    })),
    pods: w.pods
      .filter((p) => p.phase !== 'Succeeded' && p.phase !== 'Failed')
      .map((p) => ({
        namespace: p.namespace,
        name: p.name,
        nodeName: p.nodeName,
        phase: p.phase,
        cpuMillicores: sum(p.containers.map((c) => c.requests.cpuMillicores)),
        memoryBytes: sum(p.containers.map((c) => c.requests.memoryBytes)),
      })),
    pvcs: w.pvcs.map((p) => ({
      namespace: p.namespace,
      name: p.name,
      sizeBytes: p.capacityBytes ?? p.requestedBytes,
      storageClass: p.storageClass,
      volumeHandle: null,
      phase: p.phase,
    })),
    loadBalancers: [
      ...w.services
        .filter((x) => x.type === 'LoadBalancer')
        .map((x) => ({
          kind: 'Service' as const,
          namespace: x.namespace,
          name: x.name,
          hostnames: [...x.lbHostnames],
        })),
      ...w.ingresses.map((x) => ({
        kind: 'Ingress' as const,
        namespace: x.namespace,
        name: x.name,
        hostnames: [...x.lbHostnames],
      })),
    ],
  };
}

function clusterPort(
  inv: () => ClusterInventorySnapshot,
): ClusterInventoryPort {
  return { backedByCluster: true, snapshot: inv };
}

function make(
  opts: Partial<CostOptions> = {},
  gw: FakeGateway | null = new FakeGateway(),
  inventory: ClusterInventoryPort = new NotConfiguredClusterInventory(),
) {
  const options: CostOptions = {
    dataSource: 'mock',
    awsRegion: null,
    awsProfile: null,
    clusterName: 'prod.k8s.example.com',
    env: {},
    timers: false,
    ...opts,
  };
  const store = new CostStore(null);
  const settings = new CostSettingsService(store, options);
  const svc = new CostService(
    options,
    store,
    settings,
    inventory,
    gw,
    null,
    () => NOW,
  );
  return { svc, store, settings, gw };
}

type Any = Record<string, any>;

describe('CostService mock 모드', () => {
  it('AWS를 한 번도 부르지 않고 모든 영역을 채운다', async () => {
    const { svc, gw } = make();
    await svc.start();
    const [
      summary,
      estimate,
      allocation,
      status,
      actual,
      refresh,
      series,
      settings,
    ] = (await Promise.all([
      svc.getSummary(),
      svc.getEstimate(),
      svc.getAllocation({}),
      svc.getStatus(),
      svc.getActual(),
      svc.getRefresh(),
      svc.getRateSeries('7d'),
      svc.getSettings(),
    ])) as Any[];
    await svc.advisorCostBlock();
    await svc.snapshotPayload();
    expect(gw!.total()).toBe(0);

    expect(summary.dataSource).toBe('mock');
    expect(summary.rate.hourly).toMatchObject({ kind: 'estimated' });
    expect(summary.monthToDate.amount).toMatchObject({ kind: 'actual' });
    expect(summary.monthEnd.forecast.amount).toMatchObject({
      kind: 'forecast',
    });
    expect(summary.monthEnd.estimated.amount.kind).toBe('estimated');
    expect(summary.status.status).toBe('ok');
    expect(estimate.available).toBe(true);
    expect(estimate.categories.map((c: Any) => c.category)).toEqual([
      'ec2',
      'ebs',
      'lb',
      'ipv4',
      'controlPlane',
    ]);
    expect(
      estimate.resources.ec2.some(
        (r: Any) => r.unitPrice?.source === 'spot_price_history',
      ),
    ).toBe(true);
    expect(allocation.available).toBe(true);
    expect(
      Math.abs(allocation.total.usdPerHour - estimate.total.usdPerHour),
    ).toBeLessThan(0.01);
    expect(status.thresholds.rate.warnRatio).toBe(1.3);
    expect(actual.available).toBe(true);
    expect(actual.services.top.length).toBeGreaterThan(0);
    expect(actual.daily.items.length).toBeGreaterThanOrEqual(28);
    expect(actual.forecast.available).toBe(true);
    expect(refresh.disabledReason).toBe('mock');
    expect(refresh.todayCalls).toBe(0);
    expect(series.points.length).toBeGreaterThan(1000);
    expect(series.baseline.state).toBe('ready');
    expect(settings.persistence).toBe('memory');
  });

  it('수동 새로고침은 409 LIVE_MODE_ONLY', async () => {
    const { svc } = make();
    await expect(svc.requestRefresh()).rejects.toMatchObject({
      code: 'LIVE_MODE_ONLY',
    });
  });

  const expectations: Record<
    string,
    (s: Any, e: Any, st: Any, a: Any, r: Any) => void
  > = {
    normal: (s) => expect(s.status.status).toBe('ok'),
    'budget-warning': (s) => {
      expect(s.budget.status.status).toBe('warning');
      expect(s.budget.status.reasons[0].code).toBe('BUDGET_FORECAST_OVER_WARN');
    },
    'budget-over': (s) => {
      expect(s.budget.status.status).toBe('critical');
      expect(s.status.status).toBe('critical');
    },
    'spike-warning': (s, _e, st) => {
      expect(s.spike.rate.status).toBe('warning');
      expect(st.spike.rate.causes[0].text).toBe(
        'EC2 노드 +3대 (m6i.xlarge 온디맨드)',
      );
    },
    'spike-critical': (s, _e, st) => {
      expect(s.spike.rate.status).toBe('critical');
      expect(st.spike.daily.status).toBe('critical');
      expect(st.spike.rate.causes.length).toBeGreaterThan(0);
    },
    'forecast-unavailable': (s) => {
      expect(s.monthEnd.forecast.available).toBe(false);
      expect(s.monthEnd.forecast.unavailable.code).toBe(
        'CE_FORECAST_UNAVAILABLE',
      );
      expect(s.budget.projectedBasis).toBe('estimated_month_end');
      expect(s.budget.status.reasons[0].text).toContain('추정 기준');
    },
    'ce-unavailable': (s, e, st, a) => {
      expect(a.available).toBe(false);
      expect(a.unavailable.code).toBe('CE_ACCESS_DENIED');
      expect(st.spike.daily.status).toBe('unknown');
      expect(e.available).toBe(true); // 실시간 추정은 영향 없음
    },
    'ce-limit-reached': (_s, _e, _st, _a, r) => {
      expect(r.limitReached).toBe(true);
      expect(r.disabledReason).toBe('daily_limit');
    },
    unpriced: (s, e) => {
      expect(e.unpricedCount).toBeGreaterThanOrEqual(2);
      expect(s.rate.warnings.unpricedCount).toBe(e.unpricedCount);
    },
    'spot-fallback': (_s, e) => {
      expect(e.spotPrice.fallbackCount).toBe(1);
      const row = e.resources.ec2.find((x: Any) => x.spotFallback);
      expect(row.unitPrice.source).toBe('on_demand_fallback');
    },
    'baseline-collecting': (s) => {
      expect(s.spike.rate.baselineState).toBe('collecting');
      expect(s.spike.rate.status).toBe('ok');
    },
    'no-budget': (s) => {
      expect(s.budget.configured).toBe(false);
      expect(s.budget.status).toBeNull();
    },
  };

  it.each(COST_SCENARIOS)('시나리오 %s 재현', async (name) => {
    const { svc, gw } = make();
    await svc.start();
    svc.setScenario(name);
    await new Promise((r) => setImmediate(r));
    const [s, e, st, a, r] = (await Promise.all([
      svc.getSummary(),
      svc.getEstimate(),
      svc.getStatus(),
      svc.getActual(),
      svc.getRefresh(),
    ])) as Any[];
    expectations[name](s, e, st, a, r);
    expect(svc.currentScenario()).toBe(name);
    expect(gw!.total()).toBe(0);
  });

  it.each(COST_SCENARIOS)(
    '클러스터 연결 포트(cluster mock 인벤토리)로도 시나리오 %s 재현',
    async (name) => {
      const inv = clusterMockInventory();
      const { svc, gw } = make(
        {},
        new FakeGateway(),
        clusterPort(() => inv),
      );
      await svc.start();
      svc.setScenario(name);
      await new Promise((r) => setImmediate(r));
      const [s, e, st, a, r] = (await Promise.all([
        svc.getSummary(),
        svc.getEstimate(),
        svc.getStatus(),
        svc.getActual(),
        svc.getRefresh(),
      ])) as Any[];
      expectations[name](s, e, st, a, r);
      expect(gw!.total()).toBe(0);
      // 클러스터 노드는 모두 비용 행에 있다 (워커는 ec2, 마스터는 controlPlane — AC-KOPS29)
      const costNodes = new Set<string>([
        ...(e.resources.ec2 as Any[]).map((x) => x.nodeName as string),
        ...(e.resources.controlPlane as Any[])
          .filter((x) => x.kind === 'master_ec2')
          .map((x) => x.nodeName as string),
      ]);
      for (const n of inv.nodes) expect(costNodes.has(n.name)).toBe(true);
      if (name === 'normal') expect(costNodes.size).toBe(inv.nodes.length);
      // 마스터가 ec2 카테고리에 중복으로 들어가지 않는다
      const masters = new Set(
        inv.nodes.filter((n) => n.role === 'control_plane').map((n) => n.name),
      );
      expect(
        (e.resources.ec2 as Any[]).some((x) =>
          masters.has(x.nodeName as string),
        ),
      ).toBe(false);
    },
  );

  it('클러스터 연결 포트: 노드가 EC2 인스턴스·루트 볼륨·PVC 볼륨과 대조된다', async () => {
    const inv = clusterMockInventory();
    const { svc } = make(
      {},
      new FakeGateway(),
      clusterPort(() => inv),
    );
    await svc.start();
    const e = (await svc.getEstimate()) as Any;
    expect(e.resources.ec2.every((x: Any) => x.instanceId !== null)).toBe(true);
    const ebs = e.resources.ebs as Any[];
    const workers = inv.nodes.filter((n) => n.role !== 'control_plane');
    // 워커 루트 볼륨은 ebs, 마스터 루트 볼륨은 controlPlane(master_root_ebs)
    expect(ebs.filter((x) => x.attachment.type === 'node_root')).toHaveLength(
      workers.length,
    );
    expect(
      (e.resources.controlPlane as Any[]).filter(
        (x) => x.kind === 'master_root_ebs',
      ),
    ).toHaveLength(inv.nodes.length - workers.length);
    const pvcRows = ebs.filter((x) => x.attachment.type === 'pvc');
    const bound = inv.pvcs.filter((p) => p.phase === 'Bound');
    expect(
      pvcRows
        .map((x) => `${x.attachment.namespace}/${x.attachment.name}`)
        .sort(),
    ).toEqual(bound.map((p) => `${p.namespace}/${p.name}`).sort());
    const al = (await svc.getAllocation({})) as Any;
    expect(al.available).toBe(true);
  });

  it('클러스터 연결 포트: 인벤토리를 쓸 수 없으면 추정은 유지, 배분만 unknown', async () => {
    let inv = clusterMockInventory();
    const { svc } = make(
      {},
      new FakeGateway(),
      clusterPort(() => inv),
    );
    await svc.start();
    inv = clusterMockInventory('no-cluster');
    svc.setScenario('normal');
    await new Promise((r) => setImmediate(r));
    const e = (await svc.getEstimate()) as Any;
    expect(e.available).toBe(true);
    expect(e.resources.ec2.length).toBeGreaterThan(0);
    const al = (await svc.getAllocation({})) as Any;
    expect(al.available).toBe(false);
    expect(al.unavailable.code).toBe('SOURCE_NOT_CONFIGURED');
  });

  // kOps 전환: 컨트롤 플레인 관리 요금 행이 사라지고 마스터 실비가 대신 잡힌다 (AC-KOPS27~29)
  it('마스터는 controlPlane 카테고리로 가고 ec2에 중복으로 잡히지 않는다', async () => {
    const inv = clusterMockInventory();
    const { svc } = make(
      {},
      new FakeGateway(),
      clusterPort(() => inv),
    );
    await svc.start();
    const e = (await svc.getEstimate()) as Any;
    const masters = inv.nodes.filter((n) => n.role === 'control_plane');
    expect(masters.length).toBeGreaterThan(0);
    const cpEc2 = (e.resources.controlPlane as Any[]).filter(
      (r) => r.kind === 'master_ec2',
    );
    expect(cpEc2).toHaveLength(masters.length);
    expect(
      (e.resources.ec2 as Any[]).some((r) =>
        masters.some((m) => m.name === r.nodeName),
      ),
    ).toBe(false);
    // 카테고리 합계 = 전체 추정 소모율
    const catSum = (e.categories as Any[]).reduce(
      (a, c) => a + (c.usdPerHour as number),
      0,
    );
    expect(Math.abs(catSum - (e.total.usdPerHour as number))).toBeLessThan(
      0.01,
    );
    const cp = (e.categories as Any[]).find(
      (c) => c.category === 'controlPlane',
    )!;
    expect(cp.label).toBe('컨트롤 플레인');
    expect(cp.apiLb).toBeDefined();
    expect(cp.byKind.map((k: Any) => k.kind)).toContain('master_ec2');
  });

  it('알 수 없는 시나리오는 400', () => {
    const { svc } = make();
    expect(() => svc.setScenario('nope')).toThrow(ApiException);
  });

  it('시나리오 전환 시 cost.snapshot을 보낸다', async () => {
    const { svc } = make();
    await svc.start();
    const events: string[] = [];
    svc.events$.subscribe((e) => events.push(e.event));
    svc.setScenario('spike-critical');
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toContain('cost.snapshot');
  });

  it('어드바이저 cost 블록 (B.2 스키마)', async () => {
    const { svc } = make();
    await svc.start();
    const b = (await svc.advisorCostBlock()) as Any;
    expect(b.currency).toBe('USD');
    expect(b.rate.byNodeGroup.length).toBeGreaterThan(0);
    expect(b.allocation.some((x: Any) => x.namespace === 'unallocated')).toBe(
      true,
    );
    const m6i = b.alternatives.find((x: Any) => x.instanceType === 'm6i.large');
    expect(m6i.graviton).toEqual({ type: 'm7g.large', usdPerHour: 0.0998 });
    expect(b.ebsGbMonth).toEqual({ gp2: 0.114, gp3: 0.0912 });
    // 원본 식별자(인스턴스 ID, 볼륨 ID, LB 이름)는 넣지 않는다
    const json = JSON.stringify(b);
    expect(json).not.toMatch(/i-0[0-9a-f]{8,}/);
    expect(json).not.toMatch(/vol-0/);
  });
});

describe('CostService live 모드', () => {
  it('AWS 설정이 없으면 mock으로 바꾸지 않고 unknown (AWS_NOT_CONFIGURED)', async () => {
    const { svc } = make({ dataSource: 'live' }, null);
    await svc.start();
    const s = (await svc.getSummary()) as Any;
    expect(s.dataSource).toBe('live');
    expect(s.rate.available).toBe(false);
    expect(s.rate.unavailable.code).toBe('AWS_NOT_CONFIGURED');
    expect(s.rate.hourly).toBeNull();
    expect(s.monthToDate.unavailable.code).toBe('AWS_NOT_CONFIGURED');
    expect(s.status.status).toBe('unknown');
    const r = (await svc.getRefresh()) as Any;
    expect(r.disabledReason).toBe('not_configured');
    await expect(svc.requestRefresh()).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
  });

  it('주기 작업 한 번 = 리소스 조회 + 단가, 이후 GET 반복은 AWS 호출 없음', async () => {
    const gw = new FakeGateway();
    gw.instances = [instance({ instanceId: 'i-1', instanceType: 'm6i.large' })];
    gw.products = (svc, f) =>
      svc === 'AmazonEC2' && f.instanceType
        ? [
            {
              attributes: {},
              onDemand: [{ unit: 'Hrs', usd: 0.118, description: '' }],
            },
          ]
        : svc === 'AmazonEKS'
          ? [
              {
                attributes: { usagetype: 'APN2-AmazonEKS-Hours:perCluster' },
                onDemand: [{ unit: 'Hrs', usd: 0.1, description: '' }],
              },
            ]
          : [];
    const { svc } = make(
      { dataSource: 'live', awsRegion: 'ap-northeast-2' },
      gw,
    );
    await svc.start();
    const e = (await svc.getEstimate()) as Any;
    expect(e.available).toBe(true);
    // 인벤토리 없음 → 태그 기반 인스턴스 1대만.
    // 마스터 판별은 노드 라벨에서 출발하므로 인벤토리가 없으면 컨트롤 플레인 행도 없다
    expect(e.total.usdPerHour).toBeCloseTo(0.118, 6);
    expect(e.resources.controlPlane).toHaveLength(0);
    const before = gw.total();
    for (let i = 0; i < 20; i += 1) {
      await svc.getSummary();
      await svc.getEstimate();
      await svc.getAllocation({ hideSystem: true });
      await svc.getActual();
      await svc.getStatus();
      await svc.getRefresh();
      await svc.snapshotPayload();
    }
    expect(gw.total()).toBe(before);
    const alloc = (await svc.getAllocation({})) as Any;
    expect(alloc.available).toBe(false);
    expect(alloc.unavailable.code).toBe('SOURCE_NOT_CONFIGURED');
  });

  // AC-KOPS32: AWS 호출 목록에 eks:*가 없다
  it('live 주기 작업이 AmazonEKS 단가를 조회하지 않는다', async () => {
    const gw = new FakeGateway();
    const asked: string[] = [];
    gw.products = (svc, f) => {
      asked.push(svc);
      return svc === 'AmazonEC2' && f.instanceType
        ? [
            {
              attributes: {},
              onDemand: [{ unit: 'Hrs', usd: 0.118, description: '' }],
            },
          ]
        : [];
    };
    const { svc } = make(
      { dataSource: 'live', awsRegion: 'ap-northeast-2' },
      gw,
      clusterPort(() => clusterMockInventory()),
    );
    await svc.start();
    await svc.getEstimate();
    expect(asked).not.toContain('AmazonEKS');
  });

  it('CE 상태: 새로고침 1회 최대 호출 수·예상 비용을 서버가 준다', async () => {
    const { svc } = make({ dataSource: 'live', awsRegion: 'ap-northeast-2' });
    await svc.start();
    const r = (await svc.getRefresh()) as Any;
    expect(r.callsPerRefresh).toBe(2);
    expect(r.maxCallsPerRefresh).toBe(4);
    expect(r.refreshEstimatedCostUsd).toBe(0.04);
    const m = make();
    await m.svc.start();
    const mr = (await m.svc.getRefresh()) as Any;
    expect(mr.refreshEstimatedCostUsd).toBe(0.04);
  });

  it('EC2 권한 없음 → AWS_ACCESS_DENIED, 상태 unknown', async () => {
    const gw = new FakeGateway();
    const err = new Error(
      'You are not authorized to perform this operation. (ec2:DescribeInstances)',
    );
    err.name = 'UnauthorizedOperation';
    gw.fail.describeInstances = err;
    const { svc } = make(
      { dataSource: 'live', awsRegion: 'ap-northeast-2' },
      gw,
    );
    await svc.start();
    const e = (await svc.getEstimate()) as Any;
    expect(e.available).toBe(false);
    expect(e.unavailable).toEqual({
      code: 'AWS_ACCESS_DENIED',
      message: '권한 없음: ec2:DescribeInstances',
    });
  });
});

describe('설정 PATCH', () => {
  it('대시보드 DB가 없으면 503 DASHBOARD_DB_UNAVAILABLE', async () => {
    const { svc } = make();
    await expect(
      svc.patchSettings({ budget: { monthlyBudgetUsd: 900 } }),
    ).rejects.toMatchObject({
      code: 'DASHBOARD_DB_UNAVAILABLE',
    });
  });

  it('환경 변수로 고정된 필드는 409 SETTING_LOCKED_BY_ENV', async () => {
    const { svc } = make({ env: { monthlyBudgetUsd: 800 } });
    await expect(
      svc.patchSettings({ budget: { monthlyBudgetUsd: 900 } }),
    ).rejects.toMatchObject({
      code: 'SETTING_LOCKED_BY_ENV',
      details: { fields: ['monthlyBudgetUsd'] },
    });
    const s = (await svc.getSettings()) as Any;
    expect(s.budget.lockedByEnv).toEqual(['monthlyBudgetUsd']);
    expect(s.budget.monthlyBudgetUsd).toBe(800);
  });

  it('warnPct < overPct 규칙은 합친 값 기준으로 400', async () => {
    const { svc } = make();
    await expect(
      svc.patchSettings({ budget: { warnPct: 150 } }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('CE 캐시 TTL은 env가 작아도 최소 1시간', async () => {
    const { svc } = make({ env: { ceCacheTtlSec: 60 } });
    const s = (await svc.getSettings()) as Any;
    expect(s.explorer.cacheTtlSec).toBe(3600);
    expect(s.explorer.lockedByEnv).toContain('cacheTtlSec');
  });
});
