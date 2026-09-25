import { StatusChangeTracker } from '../../common/status';
import { SETTING_DEFAULTS } from '../../database/settings-defaults';
import type { RawNode, RawPod } from '../model';
import { ClusterStore } from './cluster-store';
import { changeKey } from '../../common/hash';
import { componentKindOf, CONTROL_PLANE_VOLATILE_KEYS } from './control-plane';
import { evaluateCluster, type EvalInput } from './evaluate';
import { MetricsStore } from './metrics-store';

const NOW = Date.parse('2026-09-24T05:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function node(
  name: string,
  ready: 'True' | 'False' | 'Unknown',
  opts: {
    role?: 'worker' | 'control_plane';
    zone?: string;
    sinceMs?: number;
  } = {},
): RawNode {
  return {
    name,
    createdAt: iso(86_400_000),
    instanceType: 't3.medium',
    zone: opts.zone ?? 'ap-northeast-2a',
    region: 'ap-northeast-2',
    nodeGroup: opts.role === 'control_plane' ? 'control-plane-a' : 'nodes-a',
    role: opts.role ?? 'worker',
    capacityType: 'on_demand',
    architecture: 'amd64',
    kubeletVersion: 'v1.34.1',
    providerId: `aws:///ap-northeast-2a/i-0${name}`,
    unschedulable: false,
    conditions: [
      {
        type: 'Ready',
        value: ready,
        since: iso(opts.sinceMs ?? 3_600_000),
        reason: null,
        message: null,
      },
    ],
    allocatable: { cpuMillicores: 2000, memoryBytes: 4e9, pods: 17 },
    capacity: { cpuMillicores: 2000, memoryBytes: 4e9, pods: 17 },
  };
}

function cpPod(
  kind: string,
  nodeName: string,
  opts: { waiting?: string; restarts?: number; ready?: boolean } = {},
): RawPod {
  const name = `${kind}-${nodeName}`;
  const ready = opts.ready ?? !opts.waiting;
  return {
    namespace: 'kube-system',
    name,
    uid: name,
    createdAt: iso(7_200_000),
    labels: { tier: 'control-plane' },
    phase: 'Running',
    statusReason: null,
    deletionAt: null,
    nodeName,
    podIP: null,
    qosClass: 'Burstable',
    startTime: iso(7_200_000),
    owner: { kind: 'Node', name: nodeName },
    conditions: [
      {
        type: 'Ready',
        value: ready ? 'True' : 'False',
        since: iso(3_600_000),
        reason: null,
        message: null,
      },
    ],
    containers: [
      {
        name: kind,
        init: false,
        image: `registry.k8s.io/${kind}:v1.34.1`,
        requests: { cpuMillicores: 100, memoryBytes: 1e8 },
        limits: { cpuMillicores: null, memoryBytes: null },
        probes: { readiness: true, liveness: true, startup: false },
        security: {
          privileged: false,
          allowPrivilegeEscalation: null,
          runAsNonRoot: null,
        },
        status: {
          ready,
          restartCount: opts.restarts ?? 0,
          state: opts.waiting
            ? {
                type: 'waiting',
                reason: opts.waiting,
                message: 'back-off',
                since: null,
              }
            : {
                type: 'running',
                reason: null,
                message: null,
                since: iso(3_600_000),
              },
          lastTermination: null,
        },
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

const KINDS = [
  'kube-apiserver',
  'kube-controller-manager',
  'kube-scheduler',
  'etcd-manager-main',
  'etcd-manager-events',
];

function storeWith(nodes: RawNode[], pods: RawPod[] = []): ClusterStore {
  const s = new ClusterStore();
  for (const n of nodes) s.nodes.set(n.name, n);
  for (const p of pods) s.pods.set(`${p.namespace}/${p.name}`, p);
  s.initialSyncDone = true;
  s.lastSyncAt = iso(0);
  return s;
}

function input(store: ClusterStore, haExpected = true): EvalInput {
  return {
    now: NOW,
    store,
    metrics: new MetricsStore(),
    t: SETTING_DEFAULTS['cluster.thresholds'].value,
    systemNamespaces: new Set(['kube-system']),
    kube: { state: 'ok', lastSuccessAt: iso(0) },
    metricsSource: { state: 'ok', lastSuccessAt: iso(0) },
    tracker: new StatusChangeTracker(),
    db: null,
    pvcUsageProm: null,
    clusterName: 'prod.k8s.example.com',
    metricsIntervalSec: 15,
    controlPlaneHaExpected: haExpected,
  };
}

/** 마스터 N대 + 각 마스터의 구성요소 5종 */
function world(masterCount: number, zones: string[] = ['a', 'b', 'c']) {
  const nodes = [node('w1', 'True')];
  const pods: RawPod[] = [];
  for (let i = 0; i < masterCount; i += 1) {
    const name = `m${i + 1}`;
    nodes.push(
      node(name, 'True', {
        role: 'control_plane',
        zone: `ap-northeast-2${zones[i % zones.length]}`,
      }),
    );
    for (const k of KINDS) pods.push(cpPod(k, name));
  }
  return { nodes, pods };
}

describe('componentKindOf', () => {
  it('필수 5종을 파드 이름에서 찾는다', () => {
    expect(componentKindOf('kube-apiserver-i-0abc')).toBe('kube-apiserver');
    expect(componentKindOf('etcd-manager-main-i-0abc')).toBe(
      'etcd-manager-main',
    );
    expect(componentKindOf('etcd-manager-events-i-0abc')).toBe(
      'etcd-manager-events',
    );
  });

  it('kube-apiserver-healthcheck는 구성요소가 아니다 (기타로 간다, 명세 U5)', () => {
    expect(componentKindOf('kube-apiserver-healthcheck-i-0abc')).toBeNull();
    expect(componentKindOf('kops-controller-abcde')).toBeNull();
    expect(componentKindOf('coredns-abcde')).toBeNull();
  });
});

describe('컨트롤 플레인 판단', () => {
  it('마스터 3대 모두 정상이면 ok · 매트릭스 15칸이 모두 ok', () => {
    const w = world(3);
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    const cp = v.controlPlane;
    expect(cp.found).toBe(true);
    expect(cp.status.status).toBe('ok');
    expect(cp.masters.ready).toBe(3);
    expect(cp.masters.haStatus).toBe('ok');
    expect(cp.masters.quorum).toMatchObject({ state: 'ok', requiredReady: 2 });
    expect(cp.masters.zoneSpread).toBe('spread');
    expect(cp.components.items).toHaveLength(15);
    expect(cp.components.cellCounts.ok).toBe(15);
    expect(cp.components.cellCounts.unknownTotal).toBe(0);
    expect(cp.headline).toBe('마스터 3/3 Ready · 구성요소 15/15');
    // 열 머리(매트릭스 columns)는 마스터 표의 사유와 같은 값
    expect(cp.components.columns.map((c) => c.nodeName)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
    expect(cp.components.columns.every((c) => c.reason === null)).toBe(true);
    expect(v.areas.controlPlane.status.status).toBe('ok');
  });

  // AC-KOPS21 — 이 단계의 핵심
  it('마스터 NotReady면 그 마스터의 5칸이 not_reporting (파드가 Running이어도)', () => {
    const w = world(3);
    w.nodes[3] = node('m3', 'Unknown', {
      role: 'control_plane',
      zone: 'ap-northeast-2c',
      sinceMs: 4 * 60_000,
    });
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    const cp = v.controlPlane;
    const m3 = cp.components.items.filter((c) => c.nodeName === 'm3');
    expect(m3).toHaveLength(5);
    expect(m3.every((c) => c.cellState === 'not_reporting')).toBe(true);
    expect(m3.every((c) => c.status.status === 'unknown')).toBe(true);
    expect(m3.every((c) => c.ready === null)).toBe(true);
    expect(m3.every((c) => c.clickable === false)).toBe(true);
    expect(m3[0].lastReportedAt).toBe(iso(4 * 60_000));
    expect(m3[0].cellDetail).toContain('마지막 보고');
    expect(m3[0].cellTooltip).toContain('kubelet');
    // 주의 + 쿼럼 위험
    expect(cp.status.status).toBe('warning');
    expect(cp.headline).toBe('마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실');
    expect(cp.masters.quorum.state).toBe('at_risk');
    expect(cp.components.cellCounts.notReporting).toBe(5);
    expect(cp.components.cellCounts.unknownTotal).toBe(5);
    expect(cp.masters.items[2].reporting).toBe(false);
    expect(cp.masters.items[2].reasonText).toBe('NotReady 4분');
    expect(cp.components.columns[2].reason).toBe('NotReady 4분');
  });

  it('마스터 2대 NotReady면 쿼럼 상실 · 장애', () => {
    const w = world(3);
    w.nodes[2] = node('m2', 'Unknown', { role: 'control_plane' });
    w.nodes[3] = node('m3', 'False', { role: 'control_plane' });
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    expect(v.controlPlane.status.status).toBe('critical');
    expect(v.controlPlane.masters.quorum.state).toBe('lost');
    expect(v.controlPlane.headline).toContain('쿼럼 상실');
  });

  it('마스터 1대: 기본은 주의, CONTROL_PLANE_HA_EXPECTED=false면 표시만', () => {
    const w = world(1, ['a']);
    const on = evaluateCluster(input(storeWith(w.nodes, w.pods), true));
    expect(on.controlPlane.status.status).toBe('warning');
    expect(on.controlPlane.headline).toBe('마스터 1대 (HA 아님)');
    expect(on.controlPlane.masters.haStatus).toBe('single');

    const off = evaluateCluster(input(storeWith(w.nodes, w.pods), false));
    expect(off.controlPlane.status.status).toBe('ok');
    expect(off.controlPlane.masters.haStatus).toBe('single');
    expect(off.controlPlane.masters.haExpected).toBe(false);
  });

  it('마스터 2대(짝수)·모두 같은 AZ면 주의', () => {
    const w = world(2, ['a']);
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    const codes = v.controlPlane.status.reasons.map((r) => r.code);
    expect(v.controlPlane.status.status).toBe('warning');
    expect(codes).toContain('CONTROL_PLANE_EVEN_MASTERS');
    expect(codes).toContain('CONTROL_PLANE_SINGLE_ZONE');
    expect(v.controlPlane.masters.zoneSpread).toBe('single_zone');
  });

  it('구성요소 CrashLoopBackOff는 장애, 재시작 1회는 주의', () => {
    const w = world(3);
    w.pods = w.pods.filter((p) => p.name !== 'kube-scheduler-m2');
    w.pods.push(
      cpPod('kube-scheduler', 'm2', {
        waiting: 'CrashLoopBackOff',
        restarts: 4,
      }),
    );
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    const cell = v.controlPlane.components.items.find(
      (c) => c.nodeName === 'm2' && c.kind === 'kube-scheduler',
    )!;
    expect(cell.cellState).toBe('critical');
    expect(cell.cellText).toBe('장애');
    expect(cell.cellDetail).toContain('CrashLoopBackOff');
    expect(cell.cellTooltip).not.toBeNull();
    expect(v.controlPlane.status.status).toBe('critical');
    expect(v.controlPlane.status.reasons[0].code).toBe(
      'CONTROL_PLANE_COMPONENT_WAITING',
    );
    expect(
      v.controlPlane.components.byKind.find((k) => k.kind === 'kube-scheduler'),
    ).toMatchObject({ ready: 2, expected: 3, status: 'critical' });
  });

  it('파드가 없는 칸은 missing으로 채운다 (빈 칸을 만들지 않는다)', () => {
    const w = world(3);
    w.pods = w.pods.filter((p) => p.name !== 'etcd-manager-events-m3');
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    const cp = v.controlPlane;
    expect(cp.components.items).toHaveLength(15);
    const cell = cp.components.items.find(
      (c) => c.nodeName === 'm3' && c.kind === 'etcd-manager-events',
    )!;
    expect(cell.cellState).toBe('missing');
    expect(cell.cellText).toBe('없음');
    expect(cell.clickable).toBe(false);
    expect(cp.components.cellCounts.missing).toBe(1);
    // 요약의 "알 수 없음"은 missing도 함께 센다 (PM 결정)
    expect(cp.components.cellCounts.unknownTotal).toBe(1);
    expect(cp.components.summaryText).toContain('알 수 없음 1');
  });

  it('kube-apiserver가 모든 마스터에서 Ready 아니면 장애(COMPONENT_DOWN)', () => {
    const w = world(3);
    w.pods = w.pods.filter((p) => !p.name.startsWith('kube-apiserver-'));
    for (const m of ['m1', 'm2', 'm3'])
      w.pods.push(cpPod('kube-apiserver', m, { ready: false }));
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    expect(v.controlPlane.status.status).toBe('critical');
    expect(
      v.controlPlane.status.reasons.some(
        (r) => r.code === 'CONTROL_PLANE_COMPONENT_DOWN',
      ),
    ).toBe(true);
  });

  // AC-KOPS17
  it('마스터 라벨 노드가 0대면 found:false + CONTROL_PLANE_NOT_FOUND (오류 아님)', () => {
    const v = evaluateCluster(input(storeWith([node('w1', 'True')])));
    const cp = v.controlPlane;
    expect(cp.found).toBe(false);
    expect(cp.notFoundReason?.code).toBe('CONTROL_PLANE_NOT_FOUND');
    expect(cp.status.status).toBe('unknown');
    expect(cp.masters.items).toEqual([]);
    expect(cp.components.items).toEqual([]);
    // 워커 집계는 정상 동작
    expect(v.areas.nodes.total).toBe(1);
    expect(v.areas.nodes.status.status).toBe('ok');
  });

  it('필수 5종이 아닌 마스터 kube-system 파드는 others로 가고 판정에 넣지 않는다', () => {
    const w = world(1, ['a']);
    w.pods.push(cpPod('kops-controller', 'm1', { ready: false }));
    w.pods.push(cpPod('kube-apiserver-healthcheck', 'm1', { ready: false }));
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods), false));
    expect(v.controlPlane.others.map((o) => o.name).sort()).toEqual([
      'kops-controller-m1',
      'kube-apiserver-healthcheck-m1',
    ]);
    expect(v.controlPlane.components.items).toHaveLength(5);
    expect(v.controlPlane.status.status).toBe('ok');
  });

  it('한계 안내 3줄과 etcd 내부 지표 없음을 항상 내려보낸다 (AC-KOPS26)', () => {
    const w = world(3);
    const v = evaluateCluster(input(storeWith(w.nodes, w.pods)));
    expect(v.controlPlane.limits.etcdInternalMetrics).toBe(false);
    expect(v.controlPlane.limits.notes.map((n) => n.code)).toEqual([
      'CP_APISERVER_SELF_DEPENDENCY',
      'CP_NO_ETCD_INTERNALS',
      'CP_QUORUM_APPROX',
    ]);
  });
});

// ---------------------------------------------------------------------------
// SSE 변경 감지: 의미 없는 재전송 회귀 방지
// (frontend 실측 — 아무 변화가 없는데 15초마다 2건, 18KB 프레임 = 8.6MB/시간/클라이언트)
// ---------------------------------------------------------------------------

describe('cluster.controlplane.updated 변경 감지', () => {
  const key = (v: ReturnType<typeof evaluateCluster>) =>
    changeKey(v.controlPlane, CONTROL_PLANE_VOLATILE_KEYS);

  /** 같은 세계를 시각만 달리해 두 번 평가한다 (평가 루프가 도는 상황) */
  const evalTwice = (
    mutate: (store: ClusterStore) => void = () => undefined,
  ) => {
    const w = world(3);
    const store = storeWith(w.nodes, w.pods);
    const first = evaluateCluster(input(store));
    mutate(store);
    const second = evaluateCluster({ ...input(store), now: NOW + 30_000 });
    return [key(first), key(second)] as const;
  };

  it('아무 변화가 없으면 키가 같다 (재전송 없음)', () => {
    const [a, b] = evalTwice();
    expect(b).toBe(a);
  });

  it('파생 시각·관측 창·사용량만 바뀌면 키가 같다 (A형·B형)', () => {
    const w = world(3);
    const store = storeWith(w.nodes, w.pods);
    const before = key(evaluateCluster(input(store)));
    // 사용량이 들어오고(노드 usage·masters.totals) 관측 창이 늘어난 상태
    const m = new MetricsStore();
    m.state = {
      available: true,
      unavailableReason: null,
      collectedAt: iso(0),
      nodes: new Map([
        ['m1', { cpuMillicores: 500, memoryBytes: 1e9 }],
        ['m2', { cpuMillicores: 600, memoryBytes: 1.1e9 }],
        ['m3', { cpuMillicores: 700, memoryBytes: 1.2e9 }],
      ]),
      pods: new Map(),
    };
    const after = key(
      evaluateCluster({
        ...input(store),
        now: NOW + 45_000,
        metrics: m,
        metricsSource: { state: 'ok', lastSuccessAt: iso(0) },
      }),
    );
    expect(after).toBe(before);
  });

  it('진짜 변화(구성요소 장애)는 키가 달라진다', () => {
    const w = world(3);
    const before = key(evaluateCluster(input(storeWith(w.nodes, w.pods))));
    const broken = [
      ...w.pods.filter((p) => p.name !== 'kube-scheduler-m2'),
      cpPod('kube-scheduler', 'm2', { waiting: 'CrashLoopBackOff' }),
    ];
    const after = key(evaluateCluster(input(storeWith(w.nodes, broken))));
    expect(after).not.toBe(before);
  });

  it('진짜 변화(마스터 NotReady)는 키가 달라진다', () => {
    const w = world(3);
    const before = key(evaluateCluster(input(storeWith(w.nodes, w.pods))));
    const nodes = [...w.nodes];
    nodes[3] = node('m3', 'Unknown', { role: 'control_plane' });
    const after = key(evaluateCluster(input(storeWith(nodes, w.pods))));
    expect(after).not.toBe(before);
  });

  it('마스터 allocatable이 바뀌면(totals를 빼도) 키가 달라진다', () => {
    const w = world(3);
    const before = key(evaluateCluster(input(storeWith(w.nodes, w.pods))));
    const nodes = w.nodes.map((n) =>
      n.name === 'm2'
        ? { ...n, allocatable: { ...n.allocatable, cpuMillicores: 4000 } }
        : n,
    );
    const after = key(evaluateCluster(input(storeWith(nodes, w.pods))));
    expect(after).not.toBe(before);
  });
});
