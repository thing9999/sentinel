import {
  mockClusterContribution,
  mockCostContribution,
  mockDbSection,
} from '../mock/mock-fixtures';
import { sanitizeSnapshot } from '../snapshot/sanitize-snapshot';
import type { AdvisorSnapshotV1 } from '../snapshot/snapshot.types';
import {
  computePrechecks,
  isLatestTag,
  RULES,
  sortPrechecks,
} from './precheck-rules';

const NOW = new Date('2026-09-19T05:00:00.000Z');

function mockSnapshot(over: (s: AdvisorSnapshotV1) => void = () => undefined) {
  const c = mockClusterContribution();
  const cost = mockCostContribution(NOW);
  const { snapshot, pseudonyms } = sanitizeSnapshot({
    meta: {
      generatedAt: NOW.toISOString(),
      dataSource: 'mock',
      observationSec: c.observationSec,
    },
    cluster: c.cluster,
    nodeGroups: c.nodeGroups,
    nodes: c.nodes,
    workloads: c.workloads,
    storage: c.storage,
    loadBalancers: c.loadBalancers,
    unattachedVolumes: cost.unattachedVolumes,
    controlPlaneVolumes: cost.controlPlaneVolumes,
    events: c.events,
    db: mockDbSection(),
    cost: cost.cost,
  });
  over(snapshot);
  return { snapshot, pseudonyms };
}

const byId = <T extends { ruleId: string }>(items: T[]) =>
  new Map(items.map((i): [string, T] => [i.ruleId, i]));

describe('computePrechecks (규칙 기반, LLM 없음)', () => {
  const { snapshot, pseudonyms } = mockSnapshot();
  const r = computePrechecks(snapshot, { pseudonyms });
  const items = byId(r.items);

  it('명세 3.2 규칙이 mock 데이터에서 걸린다', () => {
    for (const id of [
      'R-REQ',
      'R-MEMLIM',
      'R-SINGLE',
      'R-PDB',
      'R-RESTART',
      'R-OOM',
      'R-PROBE',
      'R-LATEST',
      'R-OVERREQ',
      'R-NODEIDLE',
      'R-UNALLOC',
      'R-GP2',
      'R-EBSIDLE',
      'R-LBIDLE',
      'R-ONDEMAND',
      'R-GRAVITON',
      'R-PRIV',
      'R-ROOT',
      'R-HOST',
      'R-SA',
      'R-DB-SINGLE',
      'R-DB-PVC',
      'R-DB-CONN',
      'R-DB-RES',
    ]) {
      expect(items.has(id)).toBe(true);
    }
    // 걸리면 안 되는 것
    expect(items.has('R-EKSVER')).toBe(false);
    expect(items.has('R-DB-XID')).toBe(false);
    expect(items.has('R-DB-SPOT')).toBe(false);
  });

  it('심각도·카테고리 (A.4 매핑)', () => {
    expect(items.get('R-RESTART')).toMatchObject({
      severity: 'high',
      category: 'reliability',
      targetCount: 1,
    });
    expect(items.get('R-DB-PVC')).toMatchObject({
      severity: 'medium',
      category: 'database',
    });
    expect(items.get('R-HOST')).toMatchObject({
      severity: 'medium',
      category: 'security',
    });
    expect(items.get('R-GP2')).toMatchObject({
      severity: 'low',
      category: 'cost',
      source: 'rule',
    });
  });

  it('R-SINGLE은 DB StatefulSet을 제외한다 (R-DB-SINGLE이 다룸)', () => {
    const t = items.get('R-SINGLE')!.targets.map((x) => x.snapshotName);
    expect(t).toEqual(['prod/web']);
  });

  it('R-GP2 절감액: 서버 단가로 계산 (gp2−gp3) × GB', () => {
    const s = items.get('R-GP2')!.savings!;
    expect(s.source).toBe('server');
    expect(s.monthlyUsd).toBeCloseTo((0.114 - 0.0912) * 50, 2);
    expect(s.formula).toContain('$0.1140 − $0.0912');
    expect(items.get('R-GP2')!.targets[0]).toMatchObject({
      kind: 'PersistentVolumeClaim',
      namespace: 'data',
      name: 'data-postgres-0',
      snapshotName: 'data/data-postgres-0',
      inSnapshot: true,
      ref: {
        kind: 'PersistentVolumeClaim',
        namespace: 'data',
        name: 'data-postgres-0',
      },
    });
  });

  it('R-GRAVITON 절감액: (현재 − Graviton) × 730h × 대수', () => {
    const s = items.get('R-GRAVITON')!.savings!;
    const expected = (0.096 - 0.0816) * 730 * 4 + (0.192 - 0.1632) * 730 * 2;
    expect(s.monthlyUsd).toBeCloseTo(expected, 1);
    expect(s.formula).toContain('× 730h × 4대');
  });

  it('노드 대상은 실제 이름으로 복원, snapshotName은 가명', () => {
    const t = items.get('R-NODEIDLE')!.targets[0];
    expect(t.snapshotName).toMatch(/^batch-node-\d$/);
    expect(t.name).toMatch(/^ip-10-0-11-9\d/);
    expect(t.ref).toEqual({ kind: 'Node', namespace: null, name: t.name });
  });

  it('R-HOST는 시스템 네임스페이스를 포함해도 제외', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.workloads.push({
        ...x.workloads.find((w) => w.name === 'node-exporter')!,
        namespace: 'kube-system',
        name: 'aws-node',
      });
    });
    const all = byId(computePrechecks(s, { includeSystem: true }).items);
    expect(all.get('R-HOST')!.targets.map((t) => t.name)).toEqual([
      'node-exporter',
    ]);
  });

  it('관측 부족이면 R-OVERREQ·R-NODEIDLE 판단 보류', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.meta.observationSec.metrics = 1380;
    });
    const res = computePrechecks(s);
    const held = res.items.filter((i) => i.held);
    expect(held.map((i) => i.ruleId).sort()).toEqual([
      'R-NODEIDLE',
      'R-OVERREQ',
    ]);
    expect(held[0]).toMatchObject({
      severity: null,
      heldReason: '관측 23분 · 최소 60분 필요',
      observedSec: 1380,
      requiredSec: 3600,
    });
    expect(res.counts.held).toBe(2);
    // held는 맨 아래
    expect(res.items.slice(-2).every((i) => i.held)).toBe(true);
  });

  it('DB 기준: PVC 90% 이상 high, xid 5억 이상, 스팟', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.db = { ...x.db!, pvcUsagePct: 93, xidAge: 600_000_000, onSpot: true };
    });
    const m = byId(computePrechecks(s).items);
    expect(m.get('R-DB-PVC')?.severity).toBe('high');
    expect(m.get('R-DB-XID')?.severity).toBe('high');
    expect(m.get('R-DB-SPOT')?.severity).toBe('high');
    // kOps에는 확장 지원 단가가 없다 → 규칙 자체가 사라졌다 (AC-KOPS41)
    expect(m.get('R-EKSVER')).toBeUndefined();
    expect(Object.keys(RULES)).not.toContain('R-EKSVER');
  });

  // --- kops-support P5: 컨트롤 플레인 규칙 (AC-KOPS41~42) ---

  it('R-CP-HA: 마스터 1대면 높음 (설정과 무관하게 지적한다)', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.nodes = [x.nodes[0], { ...x.nodes[1], role: 'control_plane' }];
      x.cluster.controlPlaneCount = 1;
      x.cluster.controlPlane = {
        ...x.cluster.controlPlane!,
        haExpected: false, // 설정을 꺼도 어드바이저는 지적한다
      };
    });
    const m = byId(computePrechecks(s).items);
    expect(m.get('R-CP-HA')?.severity).toBe('high');
    expect(m.get('R-CP-HA')?.category).toBe('reliability');
  });

  it('R-CP-SPOT: 마스터가 스팟이면 높음', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.nodes = [
        { ...x.nodes[0], role: 'control_plane', capacityType: 'spot' },
        { ...x.nodes[1], role: 'control_plane' },
        { ...x.nodes[2], role: 'control_plane' },
        ...x.nodes.slice(3),
      ];
    });
    const m = byId(computePrechecks(s).items);
    expect(m.get('R-CP-SPOT')?.severity).toBe('high');
    expect(m.get('R-CP-SPOT')?.summary).toContain('1대');
  });

  it('R-CP-RESTART: 구성요소 24시간 5회 이상이면 높음', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.cluster.controlPlane = {
        ...x.cluster.controlPlane!,
        components: [
          {
            kind: 'kube-scheduler',
            readyCount: 2,
            expectedCount: 3,
            restarts24h: 7,
          },
        ],
      };
    });
    const m = byId(computePrechecks(s).items);
    expect(m.get('R-CP-RESTART')?.severity).toBe('high');
    expect(m.get('R-CP-RESTART')?.evidence[0].text).toContain('7회');
  });

  it('R-CP-RESTART: 5회 미만이면 걸리지 않는다', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.cluster.controlPlane = {
        ...x.cluster.controlPlane!,
        components: [
          {
            kind: 'kube-scheduler',
            readyCount: 3,
            expectedCount: 3,
            restarts24h: 4,
          },
        ],
      };
    });
    expect(byId(computePrechecks(s).items).get('R-CP-RESTART')).toBeUndefined();
  });

  it('R-GP2: etcd 볼륨이 대상에 들어가면 IOPS 주석이 붙는다 (전용 규칙 없음)', () => {
    const { snapshot: s } = mockSnapshot((x) => {
      x.controlPlaneVolumes = [
        {
          volumeRef: 'vol-90',
          kind: 'etcd',
          volumeType: 'gp2',
          capacityBytes: 20 * 1024 ** 3,
          usdPerMonth: 2.28,
        },
      ];
    });
    const m = byId(computePrechecks(s).items);
    const gp2 = m.get('R-GP2')!;
    expect(gp2.summary).toContain('etcd 볼륨 포함');
    expect(gp2.evidenceText).toContain('IOPS 민감');
    expect(gp2.evidence.some((e) => e.text.includes('etcd 볼륨'))).toBe(true);
    // etcd 전용 규칙을 만들지 않는다
    expect(Object.keys(RULES)).not.toContain('R-ETCD-VOL');
  });

  it('출처가 없으면 규칙을 돌리지 않고 unknown', () => {
    const res = computePrechecks(snapshot, {
      sources: { cluster: false, cost: false, db: false },
    });
    expect(res.items).toEqual([]);
    expect(res.sources).toEqual({
      cluster: 'unknown',
      cost: 'unknown',
      db: 'unknown',
    });
  });

  it('정렬: 심각도 → 대상 수 → ruleId, 매트릭스 합계', () => {
    const sevs = r.items.filter((i) => !i.held).map((i) => i.severity);
    const order = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < sevs.length; i++)
      expect(order[sevs[i]!]).toBeGreaterThanOrEqual(order[sevs[i - 1]!]);
    const total = Object.values(r.matrix).reduce(
      (a, m) => a + m.high + m.medium + m.low,
      0,
    );
    expect(total).toBe(r.counts.high + r.counts.medium + r.counts.low);
    expect(sortPrechecks([...r.items].reverse()).map((i) => i.id)).toEqual(
      r.items.map((i) => i.id),
    );
  });

  it('latest 태그 판별', () => {
    expect(isLatestTag('nginx')).toBe(true);
    expect(isLatestTag('nginx:latest')).toBe(true);
    expect(isLatestTag('localhost/app:1.0')).toBe(false);
    expect(isLatestTag('library/nginx:1.27')).toBe(false);
  });
});
