import { StatusChangeTracker } from '../../common/status';
import { SETTING_DEFAULTS } from '../../database/settings-defaults';
import type { RawEvent, RawNode, RawPod, RawWorkload } from '../model';
import { ClusterStore } from './cluster-store';
import { evaluateCluster, isSevereEvent, type EvalInput } from './evaluate';
import { MetricsIngestor } from './metrics-ingest.service';
import { MetricsStore } from './metrics-store';

const NOW = Date.parse('2026-09-19T05:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function node(
  name: string,
  ready: 'True' | 'False' | 'Unknown',
  sinceAgoMs = 3_600_000,
): RawNode {
  return {
    name,
    createdAt: iso(86_400_000),
    instanceType: 'm6i.large',
    zone: 'ap-northeast-2a',
    region: 'ap-northeast-2',
    nodeGroup: 'app',
    capacityType: 'on_demand',
    architecture: 'amd64',
    kubeletVersion: 'v1.30.2',
    providerId: 'aws:///ap-northeast-2a/i-0abc123',
    unschedulable: false,
    conditions: [
      {
        type: 'Ready',
        value: ready,
        since: iso(sinceAgoMs),
        reason: null,
        message: null,
      },
    ],
    allocatable: { cpuMillicores: 2000, memoryBytes: 8e9, pods: 29 },
    capacity: { cpuMillicores: 2000, memoryBytes: 8e9, pods: 29 },
  };
}

function pod(
  name: string,
  opts: Partial<RawPod> & { waiting?: string; restarts?: number } = {},
): RawPod {
  const { waiting, restarts, ...rest } = opts;
  return {
    namespace: 'prod',
    name,
    uid: name,
    createdAt: iso(7_200_000),
    labels: { 'pod-template-hash': 'abc12' },
    phase: 'Running',
    statusReason: null,
    deletionAt: null,
    nodeName: 'n1',
    podIP: '10.0.0.1',
    qosClass: 'Burstable',
    startTime: iso(7_200_000),
    owner: { kind: 'ReplicaSet', name: 'api-abc12' },
    conditions: [
      {
        type: 'Ready',
        value: waiting ? 'False' : 'True',
        since: iso(600_000),
        reason: null,
        message: null,
      },
    ],
    containers: [
      {
        name: 'api',
        image: 'api:1',
        init: false,
        requests: { cpuMillicores: 100, memoryBytes: 100e6 },
        limits: { cpuMillicores: 200, memoryBytes: 200e6 },
        probes: { readiness: true, liveness: true, startup: false },
        security: {
          privileged: false,
          allowPrivilegeEscalation: null,
          runAsNonRoot: null,
        },
        status: {
          ready: !waiting,
          restartCount: restarts ?? 0,
          state: waiting
            ? { type: 'waiting', reason: waiting, message: null, since: null }
            : {
                type: 'running',
                reason: null,
                message: null,
                since: iso(600_000),
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
    ...rest,
  };
}

function deployment(desired: number, ready: number): RawWorkload {
  return {
    kind: 'Deployment',
    namespace: 'prod',
    name: 'api',
    createdAt: iso(86_400_000),
    desired,
    ready,
    updated: desired,
    available: ready,
    generation: 1,
    observedGeneration: 1,
    revisionPending: false,
    conditions: [
      {
        type: 'Progressing',
        value: 'True',
        since: iso(86_400_000),
        reason: 'NewReplicaSetAvailable',
        message: null,
      },
    ],
    selector: { matchLabels: { app: 'api' }, matchExpressions: [] },
    templateLabels: { app: 'api' },
    containers: [],
    podSecurity: {
      hostNetwork: false,
      hostPID: false,
      hostPath: false,
      serviceAccountName: null,
      automountToken: null,
      runAsNonRoot: null,
    },
    volumeClaimTemplates: [],
  };
}

function input(store: ClusterStore, metrics = new MetricsStore()): EvalInput {
  return {
    now: NOW,
    store,
    metrics,
    t: SETTING_DEFAULTS['cluster.thresholds'].value,
    systemNamespaces: new Set(['kube-system']),
    kube: { state: 'ok', lastSuccessAt: iso(0) },
    metricsSource: { state: 'ok', lastSuccessAt: iso(0) },
    tracker: new StatusChangeTracker(),
    db: null,
    pvcUsageProm: null,
    clusterName: 'test',
    metricsIntervalSec: 15,
  };
}

function storeWith(
  nodes: RawNode[],
  pods: RawPod[] = [],
  workloads: RawWorkload[] = [],
): ClusterStore {
  const s = new ClusterStore();
  Object.assign(s, { startedAt: NOW - 2 * 3_600_000 });
  for (const n of nodes) s.nodes.set(n.name, n);
  for (const p of pods) s.pods.set(`${p.namespace}/${p.name}`, p);
  for (const w of workloads)
    s.workloads.set(`${w.kind}/${w.namespace}/${w.name}`, w);
  s.initialSyncDone = true;
  return s;
}

describe('evaluateCluster', () => {
  it('노드 NotReady: 60초 미만 주의, 60초 이상 장애', () => {
    const v = evaluateCluster(
      input(
        storeWith([
          node('a', 'Unknown', 30_000),
          node('b', 'False', 120_000),
          node('c', 'True'),
        ]),
      ),
    );
    expect(v.nodeMap.get('a')!.status.status).toBe('warning');
    expect(v.nodeMap.get('b')!.status.status).toBe('critical');
    expect(v.nodeMap.get('b')!.status.reasons[0].code).toBe('NODE_NOT_READY');
    expect(v.nodeMap.get('c')!.status.status).toBe('ok');
    expect(v.areas.nodes.ready).toBe(1);
  });

  it('노드 0개면 클러스터 장애', () => {
    const v = evaluateCluster(input(storeWith([])));
    expect(v.areas.nodes.status.status).toBe('critical');
    expect(v.areas.nodes.status.reasons[0].code).toBe('CLUSTER_NO_NODES');
    expect(v.overall.status).toBe('critical');
  });

  it('CrashLoopBackOff 파드는 장애, 워크로드는 Deployment로 해석', () => {
    const v = evaluateCluster(
      input(
        storeWith(
          [node('n1', 'True')],
          [pod('api-abc12-x1', { waiting: 'CrashLoopBackOff' })],
          [deployment(1, 0)],
        ),
      ),
    );
    const p = v.podMap.get('prod/api-abc12-x1')!;
    expect(p.status.status).toBe('critical');
    expect(p.status.reasons[0].code).toBe('POD_WAITING_CRASHLOOP');
    expect(p.owner).toEqual({
      kind: 'Deployment',
      name: 'api',
      workloadKey: 'Deployment/prod/api',
    });
    expect(v.overall.status).toBe('critical');
  });

  it('최근 1시간 재시작 1~2회 주의, 3회 이상 장애', () => {
    const store = storeWith(
      [node('n1', 'True')],
      [pod('a-abc12-1', { restarts: 5 }), pod('b-abc12-1', { restarts: 5 })],
    );
    store.history.seed('prod/a-abc12-1', {
      baselineAt: NOW - 7_200_000,
      currentTotal: 5,
      restartAt: [NOW - 600_000, NOW - 300_000],
      oomAt: [],
    });
    store.history.seed('prod/b-abc12-1', {
      baselineAt: NOW - 7_200_000,
      currentTotal: 5,
      restartAt: [NOW - 900_000, NOW - 600_000, NOW - 300_000],
      oomAt: [],
    });
    const v = evaluateCluster(input(store));
    expect(v.podMap.get('prod/a-abc12-1')!.status.status).toBe('warning');
    expect(v.podMap.get('prod/a-abc12-1')!.restarts.last1h).toBe(2);
    expect(v.podMap.get('prod/b-abc12-1')!.status.status).toBe('critical');
  });

  it('Deployment desired 3: ready 0 장애, ready 2 주의, desired 0 중지됨(정상)', () => {
    const crit = evaluateCluster(
      input(storeWith([node('n1', 'True')], [], [deployment(3, 0)])),
    );
    expect(crit.workloadMap.get('Deployment/prod/api')!.status.status).toBe(
      'critical',
    );
    const warn = evaluateCluster(
      input(storeWith([node('n1', 'True')], [], [deployment(3, 2)])),
    );
    expect(warn.workloadMap.get('Deployment/prod/api')!.status.status).toBe(
      'warning',
    );
    const stopped = evaluateCluster(
      input(storeWith([node('n1', 'True')], [], [deployment(0, 0)])),
    );
    const w = stopped.workloadMap.get('Deployment/prod/api')!;
    expect(w.status.status).toBe('ok');
    expect(w.stopped).toBe(true);
  });

  it('Pending 10분 이상 장애, Job Failed 파드는 주의 + 완료로 숨김', () => {
    const v = evaluateCluster(
      input(
        storeWith(
          [node('n1', 'True')],
          [
            pod('p-abc12-1', {
              phase: 'Pending',
              nodeName: null,
              createdAt: iso(12 * 60_000),
            }),
            pod('job-1', {
              phase: 'Failed',
              owner: { kind: 'Job', name: 'job' },
            }),
          ],
        ),
      ),
    );
    expect(v.podMap.get('prod/p-abc12-1')!.status.status).toBe('critical');
    const j = v.podMap.get('prod/job-1')!;
    expect(j.status.status).toBe('warning');
    expect(j.completed).toBe(true);
    expect(v.areas.pods.total).toBe(1);
  });

  it('노드 CPU 95%가 한 번이면 그대로, 연속 3회면 장애', () => {
    const store = storeWith([node('n1', 'True')]);
    const metrics = new MetricsStore();
    const settings = {
      peek: () => SETTING_DEFAULTS['cluster.thresholds'].value,
    };
    const ingest = new MetricsIngestor(store, metrics, settings as never);
    const sample = (pct: number) =>
      new Map([
        ['n1', { cpuMillicores: (2000 * pct) / 100, memoryBytes: 1e9 }],
      ]);
    ingest.ingest(sample(95), new Map(), NOW - 30_000, false);
    let v = evaluateCluster(input(store, metrics));
    expect(v.nodeMap.get('n1')!.status.status).toBe('ok');
    ingest.ingest(sample(95), new Map(), NOW - 15_000, false);
    ingest.ingest(sample(95), new Map(), NOW, false);
    v = evaluateCluster(input(store, metrics));
    const n = v.nodeMap.get('n1')!;
    expect(n.status.status).toBe('critical');
    expect(n.status.reasons[0].code).toBe('NODE_CPU_USAGE');
    expect(n.usage!.cpuPct).toBe(95);
  });

  it('kube 출처가 not_configured면 영역은 unknown(클러스터 연결 없음)', () => {
    const inp = input(new ClusterStore());
    inp.kube = { state: 'not_configured', lastSuccessAt: null };
    const v = evaluateCluster(inp);
    expect(v.areas.nodes.status.status).toBe('unknown');
    expect(v.areas.nodes.status.reasons[0].code).toBe('SOURCE_NOT_CONFIGURED');
  });

  it('kube stale이면 StatusInfo.stale=true, 값은 유지', () => {
    const inp = input(storeWith([node('n1', 'True')]));
    inp.kube = { state: 'stale', lastSuccessAt: iso(50_000) };
    const v = evaluateCluster(inp);
    expect(v.nodeMap.get('n1')!.status.stale).toBe(true);
    expect(v.nodeMap.get('n1')!.status.updatedAt).toBe(iso(50_000));
  });
});

describe('isSevereEvent', () => {
  const ev = (reason: string, count: number, durSec: number): RawEvent => ({
    uid: 'u',
    namespace: 'prod',
    involved: { kind: 'Pod', namespace: 'prod', name: 'p' },
    reason,
    message: '',
    count,
    firstSeenAt: iso(durSec * 1000),
    lastSeenAt: iso(0),
    sourceComponent: null,
  });
  it('즉시 심각 reason', () => {
    expect(isSevereEvent(ev('FailedMount', 1, 0))).toBe(true);
    expect(isSevereEvent(ev('Unhealthy', 10, 60))).toBe(false);
  });
  it('FailedScheduling은 5분 이상 반복', () => {
    expect(isSevereEvent(ev('FailedScheduling', 3, 120))).toBe(false);
    expect(isSevereEvent(ev('FailedScheduling', 3, 400))).toBe(true);
  });
  it('BackOff는 10분 안에 5회 이상', () => {
    expect(isSevereEvent(ev('BackOff', 4, 60))).toBe(false);
    expect(isSevereEvent(ev('BackOff', 6, 300))).toBe(true);
    expect(isSevereEvent(ev('BackOff', 6, 3600))).toBe(false);
  });
});
