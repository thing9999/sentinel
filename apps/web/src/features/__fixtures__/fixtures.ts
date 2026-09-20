/**
 * 계약(docs/api/*.md) 예시 모양의 가짜 데이터. 페이지 렌더 테스트와 scratch 가짜 API 서버가 같이 쓴다.
 * Node 24 가 타입을 지우고 바로 실행할 수 있도록 `import type` 만 쓴다(값 import 없음).
 */
import type { AdvisorState, PrecheckItem, PrechecksResponse, Run, RunsResponse, Suggestion } from "../architecture-advisor/types";
import type { CostSnapshot, RateSeries } from "../aws-cost/types";
import type {
  ClusterSnapshot,
  DbResponse,
  EventItem,
  MetricsSeriesResponse,
  MetricsSnapshot,
  NodeItem,
  OverviewResponse,
  PodItem,
  PvcItem,
  SeriesPoint,
  WorkloadItem,
} from "../cluster-status/types";
import type { MockScenariosResponse, SourceStatus, StatusInfo, StreamHello } from "../common/types";

type S = "ok" | "warning" | "critical" | "unknown";

export function buildFixtures(now: number) {
  const iso = (msAgo = 0) => new Date(now - msAgo).toISOString();
  const MIN = 60_000;
  const H = 3600_000;
  const DAY = 86400_000;

  const st = (status: S, reasons: [string, string, S?][] = [], changedAgo = 30 * MIN): StatusInfo => ({
    status,
    reasons: reasons.map(([code, text, s]) => ({ code, text, status: s ?? status })),
    updatedAt: iso(5_000),
    statusChangedAt: iso(changedAgo),
    stale: false,
  });

  // ───────── 노드 ─────────
  const nodeNames = [
    "ip-10-0-12-34.ap-northeast-2.compute.internal",
    "ip-10-0-12-35.ap-northeast-2.compute.internal",
    "ip-10-0-20-11.ap-northeast-2.compute.internal",
    "ip-10-0-20-12.ap-northeast-2.compute.internal",
    "ip-10-0-40-7.ap-northeast-2.compute.internal",
    "ip-10-0-41-9.ap-northeast-2.compute.internal",
  ];
  const node = (i: number, status: StatusInfo, extra: Partial<NodeItem> = {}): NodeItem => ({
    name: nodeNames[i],
    status,
    instanceType: i < 4 ? "m6i.large" : i === 4 ? "m6i.large" : "c7i.xlarge",
    zone: i % 2 === 0 ? "ap-northeast-2a" : "ap-northeast-2c",
    nodeGroup: i < 2 ? "batch" : i < 4 ? "system" : "spot-workers",
    capacityType: i >= 4 ? "spot" : "on_demand",
    architecture: "amd64",
    kubeletVersion: "v1.30.2-eks-1552ad0",
    createdAt: iso(12 * DAY),
    ready: { value: "True", since: iso(12 * DAY) },
    unschedulable: false,
    pressure: { memory: false, disk: false, pid: false, networkUnavailable: false },
    allocatable: { cpuMillicores: 1930, memoryBytes: 7934296064, pods: 29 },
    usage: { cpuMillicores: 850 + i * 60, memoryBytes: 4_500_000_000 + i * 100_000_000, cpuPct: 44 + i * 3, memoryPct: 57 + i * 2, updatedAt: iso(5_000) },
    requests: { cpuMillicores: 1200, memoryBytes: 4_000_000_000, cpuPct: 62.2, memoryPct: 50.4 },
    limits: { cpuMillicores: 2400, memoryBytes: 8_000_000_000, cpuPct: 124.4, memoryPct: 100.8 },
    pods: { count: 12 + i, max: 29, pct: ((12 + i) / 29) * 100 },
    ...extra,
  });
  const nodes: NodeItem[] = [
    node(0, st("critical", [["NODE_NOT_READY", "NotReady 3분"]], 3 * MIN), {
      ready: { value: "Unknown", since: iso(3 * MIN) },
      usage: null,
      requests: { cpuMillicores: 1700, memoryBytes: 5100273664, cpuPct: 88.1, memoryPct: 64.3 },
    }),
    node(1, st("warning", [["NODE_CORDONED", "스케줄 제외 (cordon)"]]), { unschedulable: true }),
    node(2, st("ok")),
    node(3, st("ok")),
    node(4, st("ok")),
    node(5, st("ok")),
  ];

  // ───────── 워크로드·파드 ─────────
  const wl = (kind: WorkloadItem["kind"], ns: string, name: string, status: StatusInfo, extra: Partial<WorkloadItem> = {}): WorkloadItem => ({
    kind,
    namespace: ns,
    name,
    key: `${kind}/${ns}/${name}`,
    status,
    isSystemNamespace: ns === "kube-system",
    replicas: { desired: 2, ready: 2, updated: 2, available: 2 },
    stopped: false,
    rollout: { state: "complete", reason: null },
    images: [`123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/${name}:1.4.2`],
    createdAt: iso(40 * DAY),
    lastRolloutAt: iso(2 * DAY),
    podCounts: { critical: 0, warning: 0, ok: 2, unknown: 0 },
    hasPdb: false,
    hpa: null,
    source: "watch",
    ...extra,
  });
  const workloads: WorkloadItem[] = [
    wl("Deployment", "prod", "api", st("critical", [["WORKLOAD_NO_READY", "ready 0/3"]], 2 * MIN), {
      replicas: { desired: 3, ready: 0, updated: 3, available: 0 },
      rollout: { state: "progressing", reason: "ReplicaSetUpdated" },
      podCounts: { critical: 3, warning: 0, ok: 0, unknown: 0 },
      images: ["123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2", "fluent-bit:3.1"],
    }),
    wl("Deployment", "prod", "web", st("warning", [["WORKLOAD_PARTIAL_READY", "ready 1/2"]]), {
      replicas: { desired: 2, ready: 1, updated: 2, available: 1 },
      podCounts: { critical: 0, warning: 1, ok: 1, unknown: 0 },
    }),
    wl("StatefulSet", "data", "postgres", st("ok"), { replicas: { desired: 1, ready: 1, updated: 1, available: 1 }, podCounts: { critical: 0, warning: 0, ok: 1, unknown: 0 } }),
    wl("DaemonSet", "kube-system", "aws-node", st("ok", [["DAEMONSET_DESIRED_UNKNOWN", "desired 알 수 없음 (daemonsets 조회 권한 없음)"]]), {
      replicas: { desired: null, ready: 6, updated: null, available: null },
      source: "derived_from_pods",
      podCounts: { critical: 0, warning: 0, ok: 6, unknown: 0 },
    }),
    wl("Deployment", "batch", "report", st("ok", [["WORKLOAD_STOPPED", "중지됨 (desired 0)"]]), {
      replicas: { desired: 0, ready: 0, updated: 0, available: 0 },
      stopped: true,
      podCounts: { critical: 0, warning: 0, ok: 0, unknown: 0 },
    }),
  ];

  const pod = (ns: string, name: string, status: StatusInfo, extra: Partial<PodItem> = {}): PodItem => ({
    namespace: ns,
    name,
    key: `${ns}/${name}`,
    status,
    isSystemNamespace: ns === "kube-system",
    phase: "Running",
    terminatingSince: null,
    completed: false,
    owner: null,
    nodeName: nodeNames[2],
    containers: { ready: 1, total: 1 },
    restarts: { total: 0, last1h: 0, observedSec: 1380 },
    waitingReason: null,
    lastTermination: null,
    startedAt: iso(3 * H),
    createdAt: iso(3 * H),
    qosClass: "Burstable",
    usage: { cpuMillicores: 120, memoryBytes: 300_000_000, updatedAt: iso(5_000) },
    requests: { cpuMillicores: 300, memoryBytes: 402653184 },
    limits: { cpuMillicores: 600, memoryBytes: 536870912 },
    memoryLimitPct: 55.9,
    cpuRequestPct: 40,
    ...extra,
  });
  const pods: PodItem[] = [
    pod("prod", "api-7f9c8d6b5-x2kq9", st("critical", [["POD_WAITING_CRASHLOOP", "CrashLoopBackOff · 최근 1시간 재시작 6회"], ["POD_MEMORY_LIMIT", "메모리 limit 대비 97%", "critical"]], 2 * MIN), {
      owner: { kind: "Deployment", name: "api", workloadKey: "Deployment/prod/api" },
      nodeName: nodeNames[0],
      containers: { ready: 1, total: 2 },
      restarts: { total: 41, last1h: 6, observedSec: 1380 },
      waitingReason: "CrashLoopBackOff",
      lastTermination: { reason: "OOMKilled", exitCode: 137, finishedAt: iso(20_000) },
      usage: { cpuMillicores: 120, memoryBytes: 522190848, updatedAt: iso(5_000) },
      memoryLimitPct: 97.3,
    }),
    pod("prod", "api-7f9c8d6b5-b8zlm", st("critical", [["POD_WAITING_CRASHLOOP", "CrashLoopBackOff · 최근 1시간 재시작 4회"]], 3 * MIN), {
      owner: { kind: "Deployment", name: "api", workloadKey: "Deployment/prod/api" },
      restarts: { total: 20, last1h: 4, observedSec: 1380 },
      waitingReason: "CrashLoopBackOff",
    }),
    pod("prod", "web-5d8f7c9b4-k2m4n", st("warning", [["POD_RESTARTS_1H", "최근 23분 재시작 2회"]]), {
      owner: { kind: "Deployment", name: "web", workloadKey: "Deployment/prod/web" },
      restarts: { total: 2, last1h: 2, observedSec: 1380 },
    }),
    pod("prod", "web-5d8f7c9b4-q9w8e", st("ok"), { owner: { kind: "Deployment", name: "web", workloadKey: "Deployment/prod/web" }, limits: { cpuMillicores: null, memoryBytes: null }, memoryLimitPct: null }),
    pod("data", "postgres-0", st("ok"), { owner: { kind: "StatefulSet", name: "postgres", workloadKey: "StatefulSet/data/postgres" }, nodeName: nodeNames[1] }),
    pod("batch", "nightly-job-28471-abcde", st("ok"), { phase: "Succeeded", completed: true, owner: { kind: "Job", name: "nightly-job-28471", workloadKey: null } }),
    ...nodeNames.map((n, i) =>
      pod("kube-system", `aws-node-${["a1b2c", "d3e4f", "g5h6i", "j7k8l", "m9n0o", "p1q2r"][i]}`, st("ok"), {
        owner: { kind: "DaemonSet", name: "aws-node", workloadKey: "DaemonSet/kube-system/aws-node" },
        nodeName: n,
      }),
    ),
  ];

  const events: EventItem[] = [
    {
      key: "6c4c1a9e-8d0e-4b0e-a6f1-3f0a7e9c2b11",
      namespace: "prod",
      involvedObject: { kind: "Pod", namespace: "prod", name: "api-7f9c8d6b5-x2kq9" },
      reason: "BackOff",
      message: "Back-off restarting failed container api in pod api-7f9c8d6b5-x2kq9_prod(3c1a…)",
      count: 12,
      firstSeenAt: iso(22 * MIN),
      lastSeenAt: iso(20_000),
      severe: true,
      sourceComponent: "kubelet",
    },
    {
      key: "7d5d2b0f-9e1f-4c1f-b7a2-4a1b8f0d3c22",
      namespace: null,
      involvedObject: { kind: "Node", namespace: null, name: nodeNames[0] },
      reason: "NodeNotReady",
      message: "Node ip-10-0-12-34.ap-northeast-2.compute.internal status is now: NodeNotReady",
      count: 1,
      firstSeenAt: iso(3 * MIN),
      lastSeenAt: iso(3 * MIN),
      severe: true,
      sourceComponent: "node-controller",
    },
  ];

  const pvcs: PvcItem[] = [
    {
      namespace: "data",
      name: "data-postgres-0",
      key: "data/data-postgres-0",
      status: st("ok"),
      phase: "Bound",
      phaseSince: iso(40 * DAY),
      capacityBytes: 53687091200,
      requestedBytes: 53687091200,
      storageClass: "gp2",
      volumeName: "pvc-3f1c2d7e",
      usage: { usedBytes: 19756849971, pct: 36.8, source: "db_size_approx", updatedAt: iso(MIN) },
      mountedBy: [{ kind: "Pod", namespace: "data", name: "postgres-0" }],
      isDbVolume: true,
    },
  ];

  const areas: OverviewResponse["areas"] = {
    nodes: {
      status: st("critical", [["NODE_NOT_READY", "ip-10-0-12-34 NotReady 3분"]], 3 * MIN),
      ready: 5,
      total: 6,
      problems: [
        { ref: { kind: "Node", namespace: null, name: nodeNames[0] }, status: "critical", reason: "NotReady 3분" },
        { ref: { kind: "Node", namespace: null, name: nodeNames[1] }, status: "warning", reason: "스케줄 제외 (cordon)" },
      ],
    },
    workloads: {
      status: st("critical", [["WORKLOAD_NO_READY", "prod / api ready 0/3"]]),
      total: workloads.length,
      counts: { critical: 1, warning: 1, ok: 3, unknown: 0 },
      problems: [{ ref: { kind: "Deployment", namespace: "prod", name: "api" }, status: "critical", reason: "ready 0/3" }],
    },
    pods: {
      status: st("critical", [["POD_WAITING_CRASHLOOP", "prod / api-7f9c8d6b5-x2kq9 CrashLoopBackOff"]]),
      total: pods.filter((p) => !p.completed).length,
      counts: { critical: 2, warning: 1, ok: pods.filter((p) => !p.completed).length - 3, unknown: 0 },
      problems: [{ ref: { kind: "Pod", namespace: "prod", name: "api-7f9c8d6b5-x2kq9" }, status: "critical", reason: "CrashLoopBackOff" }],
    },
    events: {
      status: st("warning", [["EVENTS_WARNING_RECENT", "최근 15분 Warning 7건"]]),
      warnings15m: 7,
      severe15m: 2,
      problems: [{ ref: { kind: "Pod", namespace: "prod", name: "api-7f9c8d6b5-x2kq9" }, status: "warning", reason: "BackOff ×12" }],
    },
    db: {
      status: st("warning", [["DB_CONNECTION_USAGE", "연결 82% (max 100)"]], MIN),
      configured: true,
      headline: { label: "연결", value: 82, unit: "percent" },
    },
    metrics: { status: st("ok"), available: true },
  };

  const clusterInfo = { name: "prod-eks", version: "v1.30.4", region: "ap-northeast-2", connected: true };
  const thresholds: ClusterSnapshot["thresholds"] = {
    node: { cpu: { warnPct: 70, critPct: 90 }, memory: { warnPct: 75, critPct: 90 }, requests: { warnPct: 85, critPct: null }, pods: { warnPct: 90, critPct: 100 } },
    pod: { memoryLimit: { warnPct: 80, critPct: 95 }, restarts1h: { warn: 1, crit: 3 } },
    pvc: { usage: { warnPct: 75, critPct: 90 } },
  };

  const clusterSnapshot: ClusterSnapshot = {
    sync: { initialSyncDone: true, lastSyncAt: iso(5_000) },
    cluster: clusterInfo,
    areas,
    restartObservation: { observedSec: 1380, fullWindow: false },
    thresholds,
    nodes,
    workloads,
    pods,
    events,
    pvcs,
  };

  // ───────── 개요 ─────────
  const overview: OverviewResponse = {
    dataSource: "mock",
    generatedAt: iso(),
    cluster: clusterInfo,
    overall: st("critical", [["POD_WAITING_CRASHLOOP", "파드 prod / api-7f9c8d6b5-x2kq9 CrashLoopBackOff"], ["NODE_NOT_READY", "노드 ip-10-0-12-34 NotReady 3분"]], 3 * MIN),
    areas,
    attention: {
      total: 3,
      items: [
        { area: "pod", ref: { kind: "Pod", namespace: "prod", name: "api-7f9c8d6b5-x2kq9" }, status: "critical", reason: { code: "POD_WAITING_CRASHLOOP", text: "CrashLoopBackOff · 최근 1시간 재시작 6회", status: "critical" }, statusChangedAt: iso(2 * MIN) },
        { area: "node", ref: { kind: "Node", namespace: null, name: nodeNames[0] }, status: "critical", reason: { code: "NODE_NOT_READY", text: "NotReady 3분", status: "critical" }, statusChangedAt: iso(3 * MIN) },
        { area: "db", ref: { kind: "Database", namespace: "data", name: "postgres" }, status: "warning", reason: { code: "DB_CONNECTION_USAGE", text: "연결 82% (max 100)", status: "warning" }, statusChangedAt: iso(MIN) },
      ],
    },
    nav: {
      overview: "critical",
      nodes: "critical",
      workloads: "critical",
      pods: "critical",
      events: "warning",
      db: "warning",
      cost: "warning",
      advisor: "critical",
      advisorBusy: false,
      stale: { nodes: false, workloads: false, pods: false, events: false, db: false, cost: false, advisor: false },
    },
    cost: {
      status: st("warning", [["BUDGET_FORECAST_OVER_WARN", "월말 예측 $845 (예산 $800의 106%)"]]),
      rate: { amountUsd: 1.104532, kind: "estimated", asOf: iso(MIN) },
      monthToDate: { amountUsd: 512.33, kind: "actual", asOf: iso(4 * H) },
      budgetStatus: "warning",
      available: true,
    },
    advisor: {
      precheck: { status: "critical", high: 2, medium: 7, low: 11, held: 2 },
      lastRun: { id: "0b7e7a1e-3f7c-4c55-9b0e-2f0a4a9c1d10", status: "succeeded", finishedAt: iso(DAY), suggestionCount: 2 },
      bridge: "connected",
      busy: false,
      available: true,
    },
  };

  // ───────── 메트릭 ─────────
  const seriesPoints = (n: number, stepMs: number, base: number, gapAt?: number): SeriesPoint[] =>
    Array.from({ length: n }, (_, i) => {
      const t = iso((n - 1 - i) * stepMs);
      const missing = gapAt !== undefined && i >= gapAt && i < gapAt + 4;
      const cpuPct = missing ? null : Math.round((base + 12 * Math.sin(i / 9)) * 10) / 10;
      const memoryPct = missing ? null : Math.round((base + 20 + 4 * Math.cos(i / 13)) * 10) / 10;
      return {
        t,
        cpuMillicores: cpuPct === null ? null : Math.round((cpuPct / 100) * 11580),
        memoryBytes: memoryPct === null ? null : Math.round((memoryPct / 100) * 47605776384),
        cpuPct,
        memoryPct,
        cpuStatus: cpuPct === null ? null : cpuPct >= 70 ? "warning" : "ok",
        memoryStatus: memoryPct === null ? null : memoryPct >= 75 ? "warning" : "ok",
      };
    });
  const clusterPoints = seriesPoints(240, 15_000, 45, 120);
  const metricsSnapshot: MetricsSnapshot = {
    cluster: {
      available: true,
      unavailableReason: null,
      updatedAt: iso(5_000),
      cpu: { status: st("ok"), allocatableMillicores: 11580, usageMillicores: 3120, usagePct: 26.9, requestsMillicores: 8400, requestsPct: 72.5, limitsMillicores: 14200, limitsPct: 122.6 },
      memory: {
        status: st("warning", [["CLUSTER_MEMORY_USAGE", "메모리 사용률 78% (연속 3회)"]]),
        allocatableBytes: 47605776384,
        usageBytes: 37132505088,
        usagePct: 78,
        requestsBytes: 30601641984,
        requestsPct: 64.3,
        limitsBytes: 51539607552,
        limitsPct: 108.3,
      },
      thresholds: { cpu: { warnPct: 70, critPct: 90 }, memory: { warnPct: 75, critPct: 90 } },
      history: { source: "in_memory", maxRangeSec: 3600, stepSec: 15, observedSec: 3600 },
    },
    clusterSeries: { stepSec: 15, source: "in_memory", observedSince: iso(H), points: clusterPoints },
    nodes: nodes.filter((n) => n.usage).map((n) => ({ name: n.name, cpuMillicores: n.usage!.cpuMillicores, memoryBytes: n.usage!.memoryBytes, cpuPct: n.usage!.cpuPct, memoryPct: n.usage!.memoryPct })),
    pods: pods.filter((p) => p.usage).map((p) => ({ key: p.key, cpuMillicores: p.usage!.cpuMillicores, memoryBytes: p.usage!.memoryBytes, memoryLimitPct: p.memoryLimitPct, cpuRequestPct: p.cpuRequestPct })),
  };
  const nodeSeries = (name: string): MetricsSeriesResponse => ({
    dataSource: "mock",
    generatedAt: iso(),
    target: { kind: "Node", namespace: null, name },
    range: "1h",
    source: "in_memory",
    stepSec: 15,
    observedSince: iso(40 * MIN),
    available: true,
    unavailableReason: null,
    thresholds: { cpu: { warnPct: 70, critPct: 90 }, memory: { warnPct: 75, critPct: 90 } },
    denominators: { cpuMillicores: 1930, memoryBytes: 7934296064, memoryBasis: "allocatable" },
    points: seriesPoints(160, 15_000, 50, 60),
  });

  // ───────── DB ─────────
  const check = (id: string, status: StatusInfo, value: number | null, unit: string, extra: Partial<DbResponse["health"] extends infer X ? X extends { checks: (infer C)[] } ? C : never : never> = {}) => ({
    id,
    status,
    value,
    unit,
    applicable: true,
    held: false,
    sustained: false,
    thresholds: { warn: 70, crit: 90 },
    ...extra,
  });
  const db: DbResponse = {
    dataSource: "mock",
    generatedAt: iso(),
    configured: true,
    target: { namespace: "data", statefulSet: "postgres", vendor: "postgres" },
    status: st("warning", [["DB_CONNECTION_USAGE", "연결 82% (max 100)"], ["DB_LONG_RUNNING_QUERIES", "5분 넘게 실행 중인 쿼리 3건 (최장 12분)"]], MIN),
    kubernetes: { status: st("ok"), statefulSet: workloads[2], pods: pods.filter((p) => p.namespace === "data"), pvcs },
    health: {
      vendor: "postgres",
      collectedAt: iso(5_000),
      intervalSec: 15,
      reachable: true,
      responseMs: 42,
      error: null,
      server: { version: "16.4", versionNum: 160004, role: "primary", uptimeSec: 1209600 },
      connections: { total: 82, max: 100, usagePct: 82, byState: { active: 12, idle: 60, idleInTransaction: 1, idleInTransactionAborted: 0, other: 9 }, waitingOnLock: 0 },
      longRunning: { activeOverWarn: 3, activeOverCrit: 0, idleInTxOverWarn: 1, idleInTxOverCrit: 0, maxActiveSec: 724, maxIdleInTxSec: 731 },
      sessions: [
        { pid: 48213, user: "app_rw", database: "app", state: "idle in transaction", waitEventType: "Client", waitEvent: "ClientRead", backendAgeSec: 3600, xactAgeSec: 731, queryAgeSec: 731, stateAgeSec: 731 },
        { pid: 48214, user: "app_rw", database: "app", state: "active", waitEventType: null, waitEvent: null, backendAgeSec: 1200, xactAgeSec: 724, queryAgeSec: 724, stateAgeSec: 724 },
      ],
      locks: { waitingTotal: 0, waitingOverThreshold: 0, maxWaitSec: 0, items: [] },
      throughput: { intervalSec: 15, commitsPerSec: 124.3, rollbacksPerSec: 0.4, cacheHitPct: 99.2, blocksInInterval: 182340, deadlocksDelta: 0 },
      xid: { maxAge: 120034556, database: "app", maxMultixactAge: 1200 },
      sizes: { measuredAt: iso(2 * MIN), databases: [{ name: "app", bytes: 17179869184 }, { name: "postgres", bytes: 8388608 }], totalBytes: 17188257792, walBytes: 1073741824, approxDataDirBytes: 18261999616 },
      replication: { role: "primary", standbys: [], slots: [], standbyReplayDelaySec: null, walReceiverStatus: null },
      checks: [
        check("reachability", st("ok"), 42, "ms"),
        check("connection_usage", st("warning", [["DB_CONNECTION_USAGE", "연결 82% (max 100)"]]), 82, "percent", { sustained: true }),
        check("long_running_queries", st("warning", [["DB_LONG_RUNNING_QUERIES", "5분 넘게 실행 중인 쿼리 3건 (최장 12분)"]]), 3, "count"),
        check("idle_in_transaction", st("warning", [["DB_IDLE_IN_TRANSACTION", "idle in transaction 12분 1건"]]), 1, "count"),
        check("lock_waits", st("ok"), 0, "count"),
        check("cache_hit_ratio", st("ok"), 99.2, "percent"),
        check("deadlocks", st("ok"), 0, "count"),
        check("xid_age", st("ok"), 120034556, "count"),
        check("replication_lag", st("ok", [["DB_REPLICATION_NOT_APPLICABLE", "standby 없음"]]), null, "sec", { applicable: false }),
      ],
    },
    pvcUsage: { pct: 34, usedBytes: 18261999616, capacityBytes: 53687091200, source: "db_size_approx" },
  };

  // ───────── 비용 ─────────
  const money = (amountUsd: number, kind: "estimated" | "actual" | "forecast", agoMs: number) => ({ amountUsd, kind, asOf: iso(agoMs) });
  const today = new Date(now);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = today.getUTCDate();
  const settled = Math.max(1, dayOfMonth - 2);
  const dateOf = (d: number) => ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), d)));
  const monthCumulative = Array.from({ length: settled }, (_, i) => ({ date: dateOf(i + 1), usd: Math.round((i + 1) * 28.4 * 100) / 100 }));
  const mtd = monthCumulative[monthCumulative.length - 1].usd;
  const forecastPts = Array.from({ length: daysInMonth - dayOfMonth + 1 }, (_, i) => {
    const d = dayOfMonth + i;
    const usd = Math.round((mtd + (d - settled) * 27.6) * 100) / 100;
    return { date: dateOf(d), usd, lowUsd: Math.round(usd * (1 - 0.004 * (i + 1)) * 100) / 100, highUsd: Math.round(usd * (1 + 0.005 * (i + 1)) * 100) / 100 };
  });
  const fEnd = forecastPts[forecastPts.length - 1];
  const topServices = [
    ["Amazon Elastic Compute Cloud - Compute", "EC2 - 컴퓨트", 0.61],
    ["EC2 - Other", "EC2 - 기타", 0.139],
    ["Amazon Elastic Container Service for Kubernetes", "EKS", 0.09],
    ["Amazon Elastic Load Balancing", "Elastic Load Balancing", 0.05],
    ["Amazon Virtual Private Cloud", "VPC", 0.04],
    ["Amazon Simple Storage Service", "S3", 0.02],
    ["AmazonCloudWatch", "CloudWatch", 0.008],
  ] as const;
  const dailyItems = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * DAY);
    const total = Math.round((24 + 6 * Math.sin(i / 3) + (i === 27 ? 9 : 0)) * 100) / 100;
    const unsettled = i >= 28;
    return {
      date: ymd(d),
      totalUsd: total,
      unsettled,
      spikeStatus: i === 27 ? ("warning" as const) : null,
      byService: [...topServices.map(([s, , share]) => ({ service: s, usd: Math.round(total * share * 100) / 100 })), { service: "_other", usd: Math.round(total * 0.043 * 100) / 100 }],
    };
  });

  const refresh: CostSnapshot["refresh"] = {
    state: "idle",
    canRefresh: false,
    disabledReason: "mock",
    lastFetchedAt: iso(4 * H),
    lastCallAt: null,
    lastManualAt: null,
    nextAvailableAt: null,
    nextScheduledAt: iso(-2 * H),
    cacheTtlSec: 21600,
    cooldownSec: 3600,
    todayCalls: 0,
    dailyLimit: 40,
    limitReached: false,
    dayBoundary: "UTC",
    dailyResetAt: iso(-10 * H),
    callsPerRefresh: 2,
    maxCallsPerRefresh: 4,
    refreshEstimatedCostUsd: 0.04,
    callCostUsd: 0.01,
    monthCalls: 0,
    monthCallCost: money(0, "estimated", 0),
    lastError: null,
  };
  const summaryStatus = st("warning", [
    ["BUDGET_FORECAST_OVER_WARN", `예산: 월말 예측 $${Math.round(fEnd.usd)} (예산 $800의 ${Math.round((fEnd.usd / 800) * 100)}%)`],
    ["SPIKE_RATE_WARNING", "급증(추정): +77% (+$0.48/h) vs 7일 중앙값 $0.62/h"],
  ]);
  const cost: CostSnapshot = {
    summary: {
      status: summaryStatus,
      rate: {
        available: true,
        unavailable: null,
        hourly: money(1.104532, "estimated", MIN),
        daily: money(26.508768, "estimated", MIN),
        monthly: money(806.30836, "estimated", MIN),
        warnings: { unpricedCount: 1, spotFallbackCount: 1, outOfClusterCount: 4, priceCacheUsed: false },
      },
      monthToDate: {
        available: true,
        unavailable: null,
        amount: money(mtd, "actual", 4 * H),
        settledThrough: dateOf(settled),
        lastMonthSamePeriod: money(Math.round(mtd * 0.92 * 100) / 100, "actual", 4 * H),
        changePct: 9,
        scope: "account",
        metric: "UnblendedCost",
      },
      monthEnd: {
        forecast: { available: true, unavailable: null, amount: money(fEnd.usd, "forecast", 4 * H), low: money(fEnd.lowUsd, "forecast", 4 * H), high: money(fEnd.highUsd, "forecast", 4 * H), confidencePct: 80 },
        estimated: { amount: money(Math.round((fEnd.usd - 15) * 100) / 100, "estimated", MIN), method: "actual_plus_rate", formula: "확정 누적 + 추정 소모율 × 남은 시간" },
      },
      budget: {
        configured: true,
        status: st("warning", [["BUDGET_FORECAST_OVER_WARN", `월말 예측 $${Math.round(fEnd.usd)} (예산 $800의 ${Math.round((fEnd.usd / 800) * 100)}%)`]]),
        budgetUsd: 800,
        monthToDatePct: Math.round((mtd / 800) * 1000) / 10,
        projectedPct: Math.round((fEnd.usd / 800) * 1000) / 10,
        projectedBasis: "aws_forecast",
        monthElapsedPct: Math.round((dayOfMonth / daysInMonth) * 1000) / 10,
        daysElapsed: dayOfMonth - 0.5,
        daysInMonth,
        warnPct: 90,
        overPct: 100,
      },
      spike: {
        status: st("warning", [["SPIKE_RATE_WARNING", "+77% (+$0.48/h) vs 7일 중앙값 $0.62/h"]]),
        rate: { status: "warning", baselineState: "ready", collectedHours: 168, requiredHours: 24, currentUsdPerHour: 1.104532, medianUsdPerHour: 0.62, deltaUsdPerHour: 0.484532, deltaPct: 78.1 },
        daily: { status: "ok", available: true, date: dateOf(settled), usd: 31.2, baselineAvgUsd: 22.1, deltaUsd: 9.1, deltaPct: 41.2 },
      },
    },
    estimate: {
      available: true,
      unavailable: null,
      kind: "estimated",
      stale: false,
      asOf: iso(MIN),
      resourcesFetchedAt: iso(MIN),
      intervalSec: 300,
      total: { usdPerHour: 1.104532, usdPerDay: 26.508768, usdPerMonth: 806.30836 },
      categories: [
        { category: "ec2", label: "EC2 노드", count: 6, usdPerHour: 0.7176, usdPerMonth: 523.848, sharePct: 65, unpricedCount: 1 },
        { category: "ebs", label: "EBS", count: 9, usdPerHour: 0.124932, usdPerMonth: 91.2, sharePct: 11.3, unpricedCount: 0 },
        { category: "lb", label: "로드밸런서", count: 2, usdPerHour: 0.0504, usdPerMonth: 36.792, sharePct: 4.6, unpricedCount: 0 },
        { category: "ipv4", label: "퍼블릭 IPv4", count: 2, usdPerHour: 0.01, usdPerMonth: 7.3, sharePct: 0.9, unpricedCount: 0 },
        { category: "eks", label: "EKS 컨트롤 플레인", count: 1, usdPerHour: 0.1, usdPerMonth: 73, sharePct: 9.1, unpricedCount: 0 },
      ],
      resources: {
        ec2: [
          { key: `node:${nodeNames[0]}`, nodeName: nodeNames[0], instanceId: "i-0a1b2c3d4e5f67890", nodeGroup: "batch", instanceType: "m6i.large", capacityType: "on_demand", zone: "ap-northeast-2a", architecture: "amd64", priced: true, unitPrice: { usdPerHour: 0.096, source: "pricing_api", asOf: iso(10 * H), zone: null }, spotFallback: false, usdPerHour: 0.096, usdPerMonth: 70.08, notes: [] },
          { key: `node:${nodeNames[4]}`, nodeName: nodeNames[4], instanceId: "i-0f9e8d7c6b5a43210", nodeGroup: "spot-workers", instanceType: "m6i.large", capacityType: "spot", zone: "ap-northeast-2c", architecture: "amd64", priced: true, unitPrice: { usdPerHour: 0.0342, source: "spot_price_history", asOf: iso(H), zone: "ap-northeast-2c" }, spotFallback: false, usdPerHour: 0.0342, usdPerMonth: 24.966, notes: [] },
          { key: `node:${nodeNames[5]}`, nodeName: nodeNames[5], instanceId: "i-01234abcd5678ef90", nodeGroup: "spot-workers", instanceType: "c7i.xlarge", capacityType: "spot", zone: "ap-northeast-2a", architecture: "amd64", priced: true, unitPrice: { usdPerHour: 0.2072, source: "on_demand_fallback", asOf: iso(10 * H), zone: null }, spotFallback: true, usdPerHour: 0.2072, usdPerMonth: 151.256, notes: [{ code: "SPOT_PRICE_FALLBACK", text: "스팟 시세 조회 실패 (온디맨드 기준 상한)" }] },
          { key: "node:ip-10-0-50-2.ap-northeast-2.compute.internal", nodeName: "ip-10-0-50-2.ap-northeast-2.compute.internal", instanceId: "i-0aa11bb22cc33dd44", nodeGroup: "gpu", instanceType: "g6e.xlarge", capacityType: "on_demand", zone: "ap-northeast-2a", architecture: "amd64", priced: false, unitPrice: null, spotFallback: false, usdPerHour: null, usdPerMonth: null, notes: [{ code: "UNPRICED", text: "단가 없음 · 합계 제외" }] },
        ],
        ebs: [
          { key: "vol:vol-0123456789abcdef0", volumeId: "vol-0123456789abcdef0", volumeType: "gp2", sizeBytes: 53687091200, iops: 150, throughputMibps: null, attachment: { type: "pvc", namespace: "data", name: "data-postgres-0", nodeName: nodeNames[1] }, priced: true, unitPrice: { usdPerGbMonth: 0.114, usdPerIopsMonth: null, usdPerMibpsMonth: null, source: "pricing_api", asOf: iso(10 * H) }, usdPerHour: 0.007808, usdPerMonth: 5.7, notes: [] },
        ],
        lb: [
          { key: "lb:k8s-prod-api-3f2a1b", name: "k8s-prod-api-3f2a1b", lbType: "alb", attachedTo: [{ kind: "Ingress", namespace: "prod", name: "api" }], healthyTargets: 3, priced: true, unitPrice: { usdPerHour: 0.0252, source: "pricing_api", asOf: iso(10 * H) }, usdPerHour: 0.0252, usdPerMonth: 18.396, notes: [] },
        ],
        ipv4: [
          { key: `ipv4:${nodeNames[0]}`, nodeName: nodeNames[0], count: 1, priced: true, unitPrice: { usdPerHour: 0.005, source: "pricing_api", asOf: iso(10 * H) }, usdPerHour: 0.005, usdPerMonth: 3.65, notes: [] },
        ],
        eks: [
          { key: "eks:prod-eks", clusterName: "prod-eks", version: "1.30", supportTier: "standard", priced: true, unitPrice: { usdPerHour: 0.1, source: "pricing_api", asOf: iso(10 * H) }, usdPerHour: 0.1, usdPerMonth: 73, notes: [] },
        ],
      },
      pricing: { source: "pricing_api", fetchedAt: iso(10 * H), nextRefreshAt: iso(-14 * H), cacheUsed: false, cacheFetchedAt: null },
      spotPrice: { fetchedAt: iso(H), cacheTtlSec: 3600, fallbackCount: 1 },
      unpricedCount: 1,
      outOfCluster: { count: 4, byCategory: { ec2: 1, ebs: 2, lb: 1 } },
      hoursPerMonth: 730,
      monthEnd: { amount: money(Math.round((fEnd.usd - 15) * 100) / 100, "estimated", MIN), method: "actual_plus_rate", formula: "확정 누적 + 추정 소모율 × 남은 시간" },
    },
    allocation: {
      available: true,
      unavailable: null,
      kind: "estimated",
      asOf: iso(MIN),
      rows: [
        { namespace: "batch", isSystem: false, usdPerHour: 0.4528, usdPerMonth: 330.544, sharePct: 41, breakdown: { nodeUsdPerHour: 0.4312, storageUsdPerHour: 0.0216, lbUsdPerHour: 0 }, warnings: [{ code: "REQUESTS_MISSING", text: "requests 미설정 파드 3개", count: 3 }] },
        { namespace: "prod", isSystem: false, usdPerHour: 0.1905, usdPerMonth: 139.065, sharePct: 17.2, breakdown: { nodeUsdPerHour: 0.1653, storageUsdPerHour: 0, lbUsdPerHour: 0.0252 }, warnings: [] },
      ],
      pinnedRows: [
        { key: "unallocated", label: "미할당(유휴)", usdPerHour: 0.3093, usdPerMonth: 225.789, sharePct: 28, breakdown: { nodeUsdPerHour: 0.3093, storageUsdPerHour: 0, lbUsdPerHour: 0 } },
        { key: "shared_cluster", label: "공용(클러스터)", usdPerHour: 0.1266, usdPerMonth: 92.418, sharePct: 11.5, breakdown: { nodeUsdPerHour: 0, storageUsdPerHour: 0.0166, lbUsdPerHour: 0, eksUsdPerHour: 0.1, ipv4UsdPerHour: 0.01 } },
        { key: "shared", label: "공용", usdPerHour: 0.0253, usdPerMonth: 18.469, sharePct: 2.3, breakdown: { nodeUsdPerHour: 0, storageUsdPerHour: 0, lbUsdPerHour: 0.0253 } },
      ],
      hiddenSystem: null,
      total: { usdPerHour: 1.104532, usdPerMonth: 806.30836 },
      unallocatedPct: 28,
      unallocatedWarnPct: 40,
      rulesVersion: 1,
    },
    actual: {
      available: true,
      unavailable: null,
      kind: "actual",
      stale: false,
      staleReason: null,
      asOf: iso(4 * H),
      metric: "UnblendedCost",
      scope: "account",
      tagFilter: null,
      settledThrough: dateOf(settled),
      delayNotice: "청구 데이터는 최대 24시간 지연",
      month: { start: ymd(monthStart), end: dateOf(daysInMonth), daysInMonth },
      monthToDate: { amountUsd: mtd, lastMonthSamePeriodUsd: Math.round(mtd * 0.92 * 100) / 100, changeUsd: Math.round(mtd * 0.08 * 100) / 100, changePct: 9 },
      lastMonthTotalUsd: 781.4,
      services: {
        top: topServices.map(([service, displayName, share], i) => ({
          service,
          displayName,
          mtdUsd: Math.round(mtd * share * 100) / 100,
          lastMonthSamePeriodUsd: Math.round(mtd * share * 0.9 * 100) / 100,
          deltaUsd: Math.round(mtd * share * 0.1 * 100) / 100,
          deltaPct: 11.1,
          sharePct: Math.round(share * 1000) / 10,
          spikeStatus: i === 1 ? ("warning" as const) : null,
        })),
        other: { serviceCount: 14, mtdUsd: Math.round(mtd * 0.043 * 100) / 100, lastMonthSamePeriodUsd: Math.round(mtd * 0.04 * 100) / 100, deltaUsd: 1.7, deltaPct: 8.4, sharePct: 4.3 },
        totalUsd: mtd,
      },
      daily: { days: 30, chartTopServices: topServices.map(([s]) => s), items: dailyItems, baselineAvgUsd: 22.1 },
      forecast: {
        available: true,
        unavailable: null,
        kind: "forecast",
        asOf: iso(4 * H),
        period: { start: dateOf(dayOfMonth), end: dateOf(daysInMonth) },
        remainingUsd: Math.round((fEnd.usd - mtd) * 100) / 100,
        monthEndUsd: fEnd.usd,
        lowUsd: fEnd.lowUsd,
        highUsd: fEnd.highUsd,
        confidencePct: 80,
        cumulative: forecastPts,
      },
      monthCumulative,
      refresh,
    },
    status: {
      status: summaryStatus,
      budget: null as unknown as CostSnapshot["status"]["budget"],
      spike: {
        status: st("warning", [["SPIKE_RATE_WARNING", "+77% (+$0.48/h) vs 7일 중앙값 $0.62/h"]]),
        rate: {
          status: "warning",
          reasons: [{ code: "SPIKE_RATE_WARNING", text: "+77% (+$0.48/h) vs 7일 중앙값 $0.62/h", status: "warning" }],
          baselineState: "ready",
          collectedHours: 168,
          requiredHours: 24,
          currentUsdPerHour: 1.104532,
          medianUsdPerHour: 0.62,
          deltaUsdPerHour: 0.484532,
          deltaPct: 78.1,
          warnAtUsdPerHour: 1.12,
          critAtUsdPerHour: 1.62,
          kind: "estimated",
          asOf: iso(MIN),
          causes: [
            { change: "added", category: "ec2", key: "node:ip-10-0-60-1", text: "EC2 노드 +3대 (m6i.large 온디맨드)", deltaUsdPerHour: 0.288 },
            { change: "removed", category: "lb", key: "lb:k8s-old-web-1a2b3c", text: "로드밸런서 삭제 (ALB)", deltaUsdPerHour: -0.0252 },
          ],
          causesBaselineAt: iso(3 * DAY),
        },
        daily: {
          status: "ok",
          available: true,
          unavailable: null,
          reasons: [],
          date: dateOf(settled),
          usd: 31.2,
          baselineAvgUsd: 22.1,
          deltaUsd: 9.1,
          deltaPct: 41.2,
          kind: "actual",
          asOf: iso(4 * H),
          spikedServices: [{ service: "EC2 - Other", displayName: "EC2 - 기타", status: "warning", usd: 12.4, baselineAvgUsd: 6.1, deltaUsd: 6.3, deltaPct: 103.3 }],
        },
      },
      thresholds: {},
    },
    refresh,
  };
  cost.status.budget = cost.summary.budget;

  const rateSeries = (range: "24h" | "7d" | "30d" | "90d"): RateSeries => {
    const stepSec = range === "30d" ? 1800 : range === "90d" ? 3600 : 300;
    const spanMs = range === "24h" ? DAY : range === "7d" ? 7 * DAY : range === "30d" ? 30 * DAY : 90 * DAY;
    const n = Math.floor(spanMs / (stepSec * 1000));
    const points = [];
    for (let i = 0; i < n; i++) {
      if (i > n * 0.4 && i < n * 0.42) continue; // 결측 구간
      const v = i > n - 30 ? 1.1 : 0.62 + 0.05 * Math.sin(i / 20);
      points.push({ t: iso((n - 1 - i) * stepSec * 1000), usdPerHour: Math.round(v * 10000) / 10000, status: (v > 1.12 ? "warning" : "ok") as S });
    }
    return {
      dataSource: "mock",
      generatedAt: iso(),
      kind: "estimated",
      asOf: iso(MIN),
      range,
      stepSec,
      points,
      baseline: { state: "ready", collectedHours: 168, requiredHours: 24, medianUsdPerHour: 0.62, warnAtUsdPerHour: 1.12, critAtUsdPerHour: 1.62 },
      retentionDays: 90,
    };
  };

  // ───────── 어드바이저 ─────────
  const stageDone = (id: Run["stages"][number]["id"], ms: number): Run["stages"][number] => ({ id, state: "done", startedAt: iso(DAY), finishedAt: iso(DAY), durationMs: ms });
  const suggestions: Suggestion[] = [
    {
      id: "a3c2e1f0-1111-4a2b-9c3d-000000000001",
      priority: 1,
      title: "batch 노드그룹을 Graviton(m7g.large)으로 전환",
      category: "cost",
      severity: "high",
      targets: [{ kind: "NodeGroup", namespace: null, name: "batch", snapshotName: "batch", inSnapshot: true, ref: null }],
      evidence: [
        { field: "nodeGroups[batch].cpu.avgPct", value: 18, text: "batch 노드그룹 CPU 사용률 평균 18%, 최대 41% (관측 60분)", verified: true },
        { field: "cost.rate.byNodeGroup[batch].usdPerMonth", value: 312, text: "해당 노드그룹 추정 월 $312", verified: true },
      ],
      precheckIds: ["R-GRAVITON", "R-NODEIDLE"],
      savings: { monthlyUsd: 84.1, kind: "estimated", asOf: iso(10 * H), formula: "($0.0960 − $0.0768)/h × 730h × 6대 = $84.10/월", source: "server" },
      steps: [
        { text: "워크로드 이미지가 arm64를 지원하는지 확인합니다.", code: { language: "bash", content: "docker manifest inspect <image> | grep architecture" } },
        { text: "arm64 노드그룹을 새로 만들고 워크로드를 옮긴 뒤 기존 노드그룹을 줄입니다.", code: { language: "yaml", content: "managedNodeGroups:\n  - name: batch-arm\n    instanceType: m7g.large" } },
      ],
      noExecuteNotice: "대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.",
      risk: { level: "medium", reason: "arm64 이미지 필요" },
      verification: "전환 후 비용 화면의 EC2 노드 시간당 소모율과 batch 파드 재시작 수를 확인합니다.",
      unverified: false,
      source: "llm",
    },
    {
      id: "a3c2e1f0-1111-4a2b-9c3d-000000000002",
      priority: 2,
      title: "**긴급** <img src=x onerror=alert(1)> [링크](https://example.com) prod/ghost 삭제",
      category: "database",
      severity: "low",
      targets: [{ kind: "Deployment", namespace: "prod", name: "ghost", snapshotName: "prod/ghost", inSnapshot: false, ref: null }],
      evidence: [{ field: null, value: null, text: "<script>alert('x')</script> 근거 없음 https://example.com", verified: false }],
      precheckIds: [],
      savings: { monthlyUsd: 3.2, kind: "estimated", asOf: iso(10 * H), formula: "LLM이 스냅샷 단가로 계산", source: "llm" },
      steps: [{ text: "`kubectl delete deploy ghost` 를 실행하세요 **지금**", code: null }],
      noExecuteNotice: "대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.",
      risk: { level: "high", reason: "스냅샷에 없는 리소스" },
      verification: null,
      unverified: true,
      source: "llm",
    },
  ];
  const snapshotSummary = {
    nodeCount: 6,
    workloadCount: 42,
    pvcCount: 5,
    loadBalancerCount: 2,
    instanceTypes: [
      { type: "m6i.large", count: 5 },
      { type: "c7i.xlarge", count: 1 },
    ],
    estimatedMonthly: money(803.2, "estimated", DAY),
    budgetStatus: "warning" as const,
    precheck: { high: 2, medium: 7, low: 11, held: 0 },
    observationSec: 3600,
    omitted: { workloads: 0, nodes: 0 },
    redactedCount: 1,
    bytes: 48210,
  };
  const latestResult: Run = {
    id: "0b7e7a1e-3f7c-4c55-9b0e-2f0a4a9c1d10",
    status: "succeeded",
    failureReason: null,
    isExample: true,
    dataSource: "mock",
    requestedAt: iso(DAY + 134_000),
    startedAt: iso(DAY + 134_000),
    finishedAt: iso(DAY),
    durationMs: 134000,
    counts: { suggestions: 2, high: 1, medium: 0, low: 1, dropped: 1 },
    snapshotSummary,
    stage: "finalizing",
    stages: [stageDone("snapshot", 3012), stageDone("precheck", 820), stageDone("request", 2950), stageDone("receiving", 120000), stageDone("finalizing", 900)],
    elapsedSec: 134,
    delayed: false,
    cancelling: false,
    receiving: null,
    limits: { slowAfterSec: 180, timeoutSec: 600 },
    errorMessage: null,
    hasRawResponse: false,
    llm: { model: "claude-opus-5[1m]", costUsd: 0.4182, durationApiMs: 121400, numTurns: 1, inputTokens: 18420, outputTokens: 6210 },
    precheckSummary: { high: 2, medium: 7, low: 11 },
    suggestions,
    freshness: { stale: false, reasons: [] },
  };
  const failedRun: Run = {
    ...latestResult,
    id: "7c1e2f40-9a3b-4d8e-b1c2-5f6a7b8c9d0e",
    status: "failed",
    failureReason: "budget_exceeded",
    isExample: false,
    requestedAt: iso(2 * H),
    startedAt: iso(2 * H),
    finishedAt: iso(2 * H - 30_000),
    durationMs: 30000,
    counts: { suggestions: 0, high: 0, medium: 0, low: 0, dropped: 0 },
    stage: "receiving",
    errorMessage: "분석 비용이 상한 $2.00을 넘어 중단했습니다.",
    suggestions: null,
    freshness: null,
  };
  const bridge: AdvisorState["bridge"] = {
    state: "unreachable",
    status: st("critical", [["BRIDGE_UNREACHABLE", "브리지 미실행 (연결 거부)"]]),
    message: "MOCK 모드: 브리지가 없어 예시 응답으로 전체 흐름을 보여줍니다.",
    command: null,
    retryAt: null,
    checkedAt: iso(10_000),
    authCheckedAt: null,
    sdkVersion: null,
    claudeCodeVersion: null,
    busy: false,
    canRun: true,
    disabledReason: null,
    exampleMode: true,
  };
  const precheckItems: PrecheckItem[] = [
    {
      id: "R-GP2",
      ruleId: "R-GP2",
      ruleTitle: "gp2 EBS 볼륨 (gp3 전환 시 GB 단가 차이로 절감액 계산)",
      category: "cost",
      severity: "low",
      summary: "gp2 EBS 볼륨 1개",
      evidenceText: "gp3 전환 시 GB 단가 −20%",
      targets: [{ kind: "PersistentVolumeClaim", namespace: "data", name: "data-postgres-0", snapshotName: "data/data-postgres-0", inSnapshot: true, ref: { kind: "PersistentVolumeClaim", namespace: "data", name: "data-postgres-0" } }],
      targetCount: 1,
      evidence: [{ field: "storage[data/data-postgres-0].volumeType", value: "gp2", text: "볼륨 타입 gp2 · 50 GiB", verified: true }],
      savings: { monthlyUsd: 1.14, kind: "estimated", asOf: iso(10 * H), formula: "($0.114 − $0.0912) × 50 GB = $1.14/월", source: "server" },
      held: false,
      heldReason: null,
      observedSec: null,
      requiredSec: null,
      source: "rule",
    },
    {
      id: "R-GRAVITON",
      ruleId: "R-GRAVITON",
      ruleTitle: "Graviton 전환 후보",
      category: "cost",
      severity: "high",
      summary: "batch 노드그룹 6대",
      evidenceText: "m7g.large 단가 −20%",
      targets: [{ kind: "NodeGroup", namespace: null, name: "batch", snapshotName: "batch", inSnapshot: true, ref: null }],
      targetCount: 1,
      evidence: [],
      savings: { monthlyUsd: 84.1, kind: "estimated", asOf: iso(10 * H), formula: "($0.0960 − $0.0768)/h × 730h × 6대 = $84.10/월", source: "server" },
      held: false,
      heldReason: null,
      observedSec: null,
      requiredSec: null,
      source: "rule",
    },
    {
      id: "R-PDB",
      ruleId: "R-PDB",
      ruleTitle: "PDB 없는 다중 레플리카 워크로드",
      category: "reliability",
      severity: "medium",
      summary: "PDB 없는 워크로드 2개",
      evidenceText: "노드 교체 시 동시 중단 가능",
      targets: [{ kind: "Deployment", namespace: "prod", name: "api", snapshotName: "prod/api", inSnapshot: true, ref: { kind: "Deployment", namespace: "prod", name: "api" } }],
      targetCount: 2,
      evidence: [],
      savings: null,
      held: false,
      heldReason: null,
      observedSec: null,
      requiredSec: null,
      source: "rule",
    },
    {
      id: "R-OVERREQ",
      ruleId: "R-OVERREQ",
      ruleTitle: "파드 CPU 사용량이 requests의 20% 미만 (최소 1시간 관측)",
      category: "cost",
      severity: null,
      summary: "판단 보류",
      evidenceText: "관측 23분 · 최소 60분 필요",
      targets: [],
      targetCount: 0,
      evidence: [],
      savings: null,
      held: true,
      heldReason: "관측 23분 · 최소 60분 필요",
      observedSec: 1380,
      requiredSec: 3600,
      source: "rule",
    },
  ];
  const precheckSummary: AdvisorState["precheck"] = {
    status: st("critical", [["PRECHECK_HIGH", "높음 1건"]]),
    computedAt: iso(2 * MIN),
    intervalSec: 300,
    counts: { high: 1, medium: 1, low: 1, held: 1 },
  };
  const advisor: AdvisorState = {
    dataSource: "mock",
    generatedAt: iso(),
    persistence: "memory",
    bridge,
    activeRun: null,
    lastRun: {
      id: failedRun.id,
      status: failedRun.status,
      failureReason: failedRun.failureReason,
      isExample: failedRun.isExample,
      dataSource: "mock",
      requestedAt: failedRun.requestedAt,
      startedAt: failedRun.startedAt,
      finishedAt: failedRun.finishedAt,
      durationMs: failedRun.durationMs,
      counts: failedRun.counts,
      snapshotSummary,
    },
    latestResult,
    precheck: precheckSummary,
    history: { total: 2, retention: { maxCount: 50, maxDays: 90 } },
  };
  const prechecks: PrechecksResponse = {
    dataSource: "mock",
    generatedAt: iso(),
    computedAt: precheckSummary.computedAt,
    intervalSec: 300,
    includeSystem: false,
    status: precheckSummary.status,
    counts: precheckSummary.counts,
    matrix: {
      cost: { high: 1, medium: 0, low: 1 },
      reliability: { high: 0, medium: 1, low: 0 },
      performance: { high: 0, medium: 0, low: 0 },
      security: { high: 0, medium: 0, low: 0 },
      database: { high: 0, medium: 0, low: 0 },
    },
    sources: { cluster: "ok", cost: "ok", db: "ok" },
    items: precheckItems,
  };
  const toSummary = (r: Run) => ({
    id: r.id,
    status: r.status,
    failureReason: r.failureReason,
    isExample: r.isExample,
    dataSource: r.dataSource,
    requestedAt: r.requestedAt,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    counts: r.counts,
    snapshotSummary: r.snapshotSummary,
  });
  const runs: RunsResponse = {
    dataSource: "mock",
    generatedAt: iso(),
    total: 2,
    filteredTotal: 2,
    offset: 0,
    limit: 10,
    retention: { maxCount: 50, maxDays: 90 },
    items: [toSummary(failedRun), toSummary(latestResult)],
  };

  // ───────── 스트림 ─────────
  const sources: SourceStatus[] = (["kube", "metrics", "monitoredDb", "awsResources", "pricing", "spotPrice", "costExplorer", "agentBridge", "dashboardDb"] as const).map((id) => ({
    id,
    state: "mock",
    intervalSec: 15,
    staleAfterSec: 45,
    lastSuccessAt: iso(5_000),
    lastAttemptAt: iso(5_000),
    error: null,
  }));
  const hello: StreamHello = {
    streamId: "b1f0c7e2-6f0e-4a55-9c3e-0d0b5f1a2c11",
    dataSource: "mock",
    serverTime: iso(),
    heartbeatSec: 15,
    topics: ["overview", "cluster", "metrics", "db", "cost", "advisor"],
    sources,
  };

  const mockScenarios: MockScenariosResponse = {
    dataSource: "mock",
    enabled: true,
    generatedAt: iso(),
    groups: [
      {
        id: "cluster",
        label: "클러스터",
        active: "mixed",
        options: [
          { id: "mixed", label: "혼합 (기본)", description: "정상·주의·장애·알 수 없음이 영역마다 섞여 있음" },
          { id: "healthy", label: "모두 정상", description: "" },
          { id: "no-metrics", label: "metrics-server 없음", description: "" },
          { id: "kube-stale", label: "watch 끊김", description: "" },
          { id: "no-cluster", label: "클러스터 연결 없음", description: "" },
        ],
      },
      { id: "db", label: "데이터베이스", active: "warning", options: [{ id: "ok", label: "정상", description: "" }, { id: "warning", label: "주의 (기본)", description: "" }, { id: "unreachable", label: "접속 실패", description: "" }] },
      { id: "cost", label: "비용", active: "normal", options: [{ id: "normal", label: "정상 (기본)", description: "" }, { id: "budget-over", label: "예산 초과", description: "" }, { id: "ce-unavailable", label: "Cost Explorer 사용 불가", description: "" }] },
      { id: "advisor", label: "어드바이저", active: "normal", fastTimers: true, options: [{ id: "normal", label: "정상 (기본)", description: "" }, { id: "bridge-down", label: "브리지 미실행", description: "" }, { id: "budget-exceeded", label: "비용 상한 초과", description: "" }] },
    ],
  };

  return {
    hello,
    overview,
    clusterSnapshot,
    metricsSnapshot,
    nodeSeries,
    db,
    cost,
    rateSeries,
    advisor,
    prechecks,
    runs,
    latestResult,
    failedRun,
    mockScenarios,
  };
}

export type Fixtures = ReturnType<typeof buildFixtures>;
