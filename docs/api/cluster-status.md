# API 계약: cluster-status

- 작성: backend, 2026-09-19 (3단계 계약. 구현 전)
- 공통 규약: `docs/api/common.md` (prefix `/api`, 에러 형식, `StatusInfo`, 단위, SSE 봉투·heartbeat·재연결, mock 시나리오)
- 명세: `docs/specs/cluster-status.md` / 디자인: `docs/design/cluster-status.md`, `status.md`, `shell.md` / DBA: `docs/db/health.md`, `apps/api/src/database/health/**/types.ts`
- 모든 상태·판단 이유·지속 조건은 **서버가 계산**한다. 화면은 계산하지 않는다(명세 7절 백엔드).

## 0. 화면 ↔ 엔드포인트

| 화면 (디자인 경로) | REST | SSE 토픽 |
|---|---|---|
| 셸 사이드바·상단바 | `GET /api/overview` | `overview` |
| 개요 `/` | `GET /api/overview`, `GET /api/cluster/metrics`, `GET /api/cluster/metrics/series?target=cluster` | `overview`, `metrics` |
| 노드 목록 `/cluster/nodes` | `GET /api/cluster/nodes` | `cluster`, `metrics` |
| 노드 상세 `/cluster/nodes/[name]` | `GET /api/cluster/nodes/:name`, `.../metrics/series?target=node` | `cluster`, `metrics` |
| 워크로드 `/cluster/workloads` (`?focus=kind/ns/name`) | `GET /api/cluster/workloads`, `GET /api/cluster/workloads/:kind/:namespace/:name` | `cluster` |
| 파드 목록 `/cluster/pods` | `GET /api/cluster/pods` | `cluster`, `metrics` |
| 파드 상세 `/cluster/pods/[namespace]/[name]` | `GET /api/cluster/pods/:namespace/:name`, `.../metrics/series?target=pod` | `cluster`, `metrics` |
| 이벤트 `/cluster/events` | `GET /api/cluster/events` | `cluster` |
| DB 상세 `/cluster/db` | `GET /api/cluster/db` | `db`, `cluster` |
| (DB·비용 공용) PVC | `GET /api/cluster/pvcs` | `cluster` |
| "지금 확인할 항목" Drawer | `GET /api/cluster/attention` | `overview` |

**출처 ↔ 데이터** (stale 전파 기준, `common.md` 2.3)

| 출처 | 데이터 | 방식 |
|---|---|---|
| `kube` | 노드, 파드, Deployment, StatefulSet, 이벤트, PVC, 네임스페이스 (+ 비용·어드바이저용 services, ingresses, PDB, HPA) | Watch(informer) → 메모리 캐시. 요청마다 쿠버네티스 API를 부르지 않는다 |
| `metrics` | 노드·파드 CPU/메모리 사용량 | `metrics.k8s.io` 15초 조회 |
| `prometheus` (선택) | 추이(24시간까지), PVC 사용량 `kubelet_volume_stats_used_bytes` | 설정 시에만 |
| `monitoredDb` | DB 내부 지표 | 15초 조회 (DBA 쿼리), `normalizePgHealth` |

---

## 1. 공통 항목 타입

### 1.1 `NodeItem` (목록 행 = 스트림 upsert 단위)

```ts
interface NodeItem {
  name: string;                         // 전체 이름 (ip-10-0-12-34.ap-northeast-2.compute.internal). 짧게 보이기는 화면 책임
  status: StatusInfo;
  instanceType: string | null;          // node.kubernetes.io/instance-type
  zone: string | null;                  // topology.kubernetes.io/zone
  nodeGroup: string | null;             // eks.amazonaws.com/nodegroup → karpenter.sh/nodepool → alpha.eksctl.io/nodegroup-name
  capacityType: 'on_demand' | 'spot' | null;  // eks.amazonaws.com/capacityType 또는 karpenter.sh/capacity-type. 모르면 null
  architecture: string | null;          // kubernetes.io/arch (amd64, arm64)
  kubeletVersion: string;
  createdAt: string;
  ready: { value: 'True' | 'False' | 'Unknown'; since: string | null };
  unschedulable: boolean;               // cordon → "스케줄 제외" 칩
  pressure: { memory: boolean; disk: boolean; pid: boolean; networkUnavailable: boolean };
  allocatable: { cpuMillicores: number; memoryBytes: number; pods: number };
  usage: {                              // metrics 출처. 없으면 null (metrics-server 없음 등)
    cpuMillicores: number; memoryBytes: number;
    cpuPct: number; memoryPct: number;  // 사용량 / 할당 가능
    updatedAt: string;
  } | null;
  requests: { cpuMillicores: number; memoryBytes: number; cpuPct: number; memoryPct: number };
  limits: { cpuMillicores: number; memoryBytes: number; cpuPct: number; memoryPct: number };
  pods: { count: number; max: number; pct: number };  // 완료(Succeeded/Failed) 파드 제외
}
```

### 1.2 `WorkloadItem`

```ts
type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet';

interface WorkloadItem {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  key: string;                          // "Deployment/prod/api" (?focus= 값과 같음)
  status: StatusInfo;
  isSystemNamespace: boolean;
  replicas: {
    desired: number | null;             // Deployment/StatefulSet: spec.replicas, DaemonSet: status.desiredNumberScheduled (6.1)
    ready: number;
    updated: number | null;
    available: number | null;
  };
  stopped: boolean;                     // desired = 0 → "중지됨" 칩, 상태 ok
  rollout: {
    state: 'complete' | 'progressing' | 'failed' | 'unknown';
    reason: string | null;              // 'ProgressDeadlineExceeded' 등 (Deployment Progressing 조건 reason)
  };
  images: string[];                     // 컨테이너 이미지 (태그 포함, init 제외). 첫 번째가 대표
  createdAt: string;
  lastRolloutAt: string | null;         // Deployment: Progressing 조건 lastUpdateTime, StatefulSet: 현재 revision 파드 최초 생성 시각 근사
  podCounts: { critical: number; warning: number; ok: number; unknown: number };
  hasPdb: boolean;
  hpa: { minReplicas: number | null; maxReplicas: number; currentReplicas: number | null } | null;
  source: 'watch' | 'derived_from_pods';  // 현재 구현은 모두 'watch' (DaemonSet 포함, 6.1). 'derived_from_pods'는 예약값
}
```

### 1.3 `PodItem`

```ts
interface ResourceAmounts { cpuMillicores: number | null; memoryBytes: number | null }  // 컨테이너 하나라도 값이 없으면 해당 합계 null

interface PodItem {
  namespace: string;
  name: string;
  key: string;                          // "prod/api-7f9c8d6b5-x2kq9"
  status: StatusInfo;
  isSystemNamespace: boolean;
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';
  terminatingSince: string | null;      // deletionTimestamp
  completed: boolean;                   // Succeeded, 또는 Job 소유 파드의 Failed/Succeeded → 기본 목록 숨김 대상
  owner: {                              // 소속 워크로드 (ReplicaSet은 Deployment로 해석)
    kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'Job' | 'ReplicaSet' | 'Node' | 'Other';
    name: string;
    workloadKey: string | null;         // 워크로드 목록에 있는 경우만 ("Deployment/prod/api")
  } | null;                             // 소유자 없음(단독 파드)
  nodeName: string | null;
  containers: { ready: number; total: number };  // "1/2" (init 제외)
  restarts: {
    total: number;                      // 누적
    last1h: number;                     // 최근 1시간 증가분
    observedSec: number;                // 관측 구간 (3600 미만이면 화면 "관측 N분")
  };
  waitingReason: string | null;         // 가장 나쁜 컨테이너의 대기 사유 (CrashLoopBackOff 등)
  lastTermination: { reason: string | null; exitCode: number | null; finishedAt: string | null } | null;
  startedAt: string | null;             // status.startTime (경과 계산)
  createdAt: string;
  qosClass: 'Guaranteed' | 'Burstable' | 'BestEffort';
  usage: { cpuMillicores: number; memoryBytes: number; updatedAt: string } | null;  // metrics 없으면 null
  requests: ResourceAmounts;
  limits: ResourceAmounts;
  memoryLimitPct: number | null;        // 사용량 / limit. limit 없으면 null → "limit 없음"
  cpuRequestPct: number | null;
}
```

### 1.4 `EventItem` (Warning만)

```ts
interface EventItem {
  key: string;                          // 이벤트 uid
  namespace: string | null;
  involvedObject: ResourceRef;          // { kind: 'Pod', namespace: 'prod', name: '...' }
  reason: string;
  message: string;                      // 비밀값 가림 + 최대 1,000자
  count: number;                        // 반복 횟수 (series.count 포함)
  firstSeenAt: string;
  lastSeenAt: string;
  severe: boolean;                      // 명세 3.5 심각 reason 규칙 충족 (반복 조건 포함)
  sourceComponent: string | null;       // kubelet, default-scheduler 등
}
```
- 쿠버네티스 보관(1시간) 안의 **Warning만** 둔다. `lastSeenAt`이 1시간을 넘으면 서버가 `cluster.event.delete`를 보낸다.

### 1.5 `PvcItem`

```ts
interface PvcItem {
  namespace: string;
  name: string;
  key: string;
  status: StatusInfo;                   // phase + 사용률 (명세 3.7)
  phase: 'Pending' | 'Bound' | 'Lost';
  phaseSince: string | null;
  capacityBytes: number | null;         // status.capacity.storage
  requestedBytes: number | null;
  storageClass: string | null;
  volumeName: string | null;            // PV 이름 (조회하지는 않음)
  usage: {
    usedBytes: number;
    pct: number;
    source: 'prometheus' | 'db_size_approx';  // db_size_approx면 화면 "근사치" 칩
    updatedAt: string;
  } | null;                             // 출처 없음 → null (사용률 판단 안 함)
  mountedBy: ResourceRef[];             // 이 PVC를 쓰는 파드
  isDbVolume: boolean;                  // 모니터링 대상 DB StatefulSet의 PVC
}
```
- PVC 사용량 출처(PM 결정: `nodes/proxy` 권한은 추가하지 않음): Prometheus가 설정돼 있으면 `kubelet_volume_stats_used_bytes`, 없으면 **DB PVC만** DB 크기 합계 + WAL(`sizes.approxDataDirBytes`) 근사치. 그 밖의 PVC는 `usage: null`.

---

## 2. 개요·요약

### 2.1 `GET /api/overview`

셸(사이드바 상태, 상단바 클러스터 정보)과 개요 화면 상단(요약 띠, 카드 5개, 지금 확인할 항목, 비용·어드바이저 요약 카드)에 필요한 것을 한 번에 준다. `overview.snapshot` payload와 같다.

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "cluster": {
    "name": "prod-eks",
    "version": "v1.30.4",
    "region": "ap-northeast-2",
    "connected": true
  },
  "overall": {
    "status": "critical",
    "reasons": [
      { "code": "POD_WAITING_CRASHLOOP", "text": "파드 prod / api-7f9c8d6b5-x2kq9 CrashLoopBackOff", "status": "critical" },
      { "code": "NODE_NOT_READY", "text": "노드 ip-10-0-12-34 NotReady 3분", "status": "critical" }
    ],
    "updatedAt": "2026-09-19T05:02:10.000Z",
    "statusChangedAt": "2026-09-19T04:59:40.000Z",
    "stale": false
  },
  "areas": {
    "nodes":     { "status": { "status": "critical", "reasons": [ { "code": "NODE_NOT_READY", "text": "ip-10-0-12-34 NotReady 3분", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:59:40.000Z", "stale": false },
                   "ready": 5, "total": 6,
                   "problems": [ { "ref": { "kind": "Node", "namespace": null, "name": "ip-10-0-12-34.ap-northeast-2.compute.internal" }, "status": "critical", "reason": "NotReady 3분" } ] },
    "workloads": { "status": { "status": "critical", "reasons": [], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T05:00:02.000Z", "stale": false },
                   "total": 24, "counts": { "critical": 1, "warning": 0, "ok": 23, "unknown": 0 },
                   "problems": [ { "ref": { "kind": "Deployment", "namespace": "prod", "name": "api" }, "status": "critical", "reason": "ready 0/3" } ] },
    "pods":      { "status": { "status": "critical", "reasons": [], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T05:00:02.000Z", "stale": false },
                   "total": 56, "counts": { "critical": 2, "warning": 3, "ok": 51, "unknown": 0 },
                   "problems": [ { "ref": { "kind": "Pod", "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9" }, "status": "critical", "reason": "CrashLoopBackOff" } ] },
    "events":    { "status": { "status": "warning", "reasons": [ { "code": "EVENTS_WARNING_RECENT", "text": "최근 15분 Warning 7건", "status": "warning" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:50:00.000Z", "stale": false },
                   "warnings15m": 7, "severe15m": 0,
                   "problems": [ { "ref": { "kind": "Pod", "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9" }, "status": "warning", "reason": "BackOff ×12" } ] },
    "db":        { "status": { "status": "warning", "reasons": [ { "code": "DB_CONNECTION_USAGE", "text": "연결 82% (max 100)", "status": "warning" } ], "updatedAt": "2026-09-19T05:02:00.000Z", "statusChangedAt": "2026-09-19T05:01:00.000Z", "stale": false },
                   "configured": true, "headline": { "label": "연결", "value": 82, "unit": "percent" } },
    "metrics":   { "status": { "status": "ok", "reasons": [], "updatedAt": "2026-09-19T05:02:00.000Z", "statusChangedAt": "2026-09-19T03:40:30.000Z", "stale": false },
                   "available": true }
  },
  "attention": {
    "total": 13,
    "items": [
      {
        "area": "pod",
        "ref": { "kind": "Pod", "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9" },
        "status": "critical",
        "reason": { "code": "POD_WAITING_CRASHLOOP", "text": "CrashLoopBackOff · 최근 1시간 재시작 6회", "status": "critical" },
        "statusChangedAt": "2026-09-19T05:00:02.000Z"
      }
    ]
  },
  "nav": {
    "overview": "critical",
    "nodes": "critical",
    "workloads": "critical",
    "pods": "critical",
    "events": "warning",
    "db": "warning",
    "cost": "warning",
    "advisor": "critical",
    "advisorBusy": false,
    "stale": { "nodes": false, "workloads": false, "pods": false, "events": false, "db": false, "cost": false, "advisor": false }
  },
  "cost": {
    "status": { "status": "warning", "reasons": [ { "code": "BUDGET_FORECAST_OVER_WARN", "text": "월말 예측 $845 (예산 $800의 106%)", "status": "warning" } ], "updatedAt": "2026-09-19T05:00:00.000Z", "statusChangedAt": "2026-09-19T01:00:00.000Z", "stale": false },
    "rate": { "amountUsd": 1.104532, "kind": "estimated", "asOf": "2026-09-19T05:00:00.000Z" },
    "monthToDate": { "amountUsd": 512.33, "kind": "actual", "asOf": "2026-09-19T01:00:00.000Z" },
    "budgetStatus": "warning",
    "available": true
  },
  "advisor": {
    "status": { "status": "critical", "reasons": [ { "code": "PRECHECK_HIGH", "text": "높음 2건", "status": "critical" } ], "updatedAt": "2026-09-19T05:05:00.000Z", "statusChangedAt": "2026-09-19T03:45:00.000Z", "stale": false },
    "precheck": { "status": "critical", "high": 2, "medium": 7, "low": 11, "held": 2 },
    "lastRun": { "id": "0b7e7a1e-3f7c-4c55-9b0e-2f0a4a9c1d10", "status": "succeeded", "finishedAt": "2026-09-18T05:03:00.000Z", "suggestionCount": 9 },
    "bridge": "connected",
    "busy": false,
    "available": true
  }
}
```

| 필드 | 설명 |
|---|---|
| `cluster` | 상단바·요약 띠 부제. `connected: false`면 `name`·`version`은 null, 상단바 `클러스터 연결 없음`. `name`은 env `EKS_CLUSTER_NAME`(없으면 kubeconfig 현재 context의 cluster 이름), `version`은 API 서버 `/version`, `region`은 `AWS_REGION` 또는 노드 zone에서 추론 |
| `overall` | 요약 띠 전체 상태 = `areas.*.status` 최악 (명세 3.1). 노드 0개 또는 모든 노드 NotReady면 critical |
| `areas.*.problems` | 카드 안 문제 항목, **최대 3개**(critical → warning → 최근 변경 순) |
| `areas.pods.counts` | 기본 목록 기준(완료 파드 제외) |
| `areas.events` | `warnings15m`: 최근 15분 Warning 이벤트 수(`count` 합이 아니라 이벤트 객체 수), `severe15m`: 심각 reason 수 |
| `areas.db.headline` | DB 카드 primary 값: 가장 나쁜 지표(없으면 연결 사용률) |
| `attention` | "지금 확인할 항목": critical·warning 항목, critical → warning, 같은 등급은 `statusChangedAt` 최근 순. **최대 8개**, `total`은 전체 수. 전체는 2.3 |
| `nav` | 사이드바 상태 점 (`shell.md` 3.1). `advisorBusy`: 분석 진행 중 스피너. `nav.stale.*`: 영역 출처가 stale |
| `cost`, `advisor` | 개요의 요약 카드용 요약. 상세 형식은 `aws-cost.md` 2.1, `architecture-advisor.md` A.2. 해당 기능이 실패해도 이 응답은 200이고 그 블록만 `available: false` + `status.status: "unknown"` |
| `advisor.status` | 어드바이저 영역 상태 `StatusInfo`(사전 점검 결과 기준, `architecture-advisor.md` A.2 `precheck.status`와 같은 값). `nav.advisor`·`nav.stale.advisor`의 근거. 요약을 못 만들면 `unknown` |

- 오류: 없음(항상 200). 출처가 없으면 해당 영역 unknown.

### 2.2 `GET /api/cluster/summary`
`/api/overview`의 `cluster`, `overall`, `areas`, `attention`만. 응답 형식 동일(해당 필드만). 오류 없음.

### 2.3 `GET /api/cluster/attention`
"모두 보기" Drawer용 전체 목록. 쿼리 `limit`, `offset`(공통).

```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "total": 13, "filteredTotal": 13, "offset": 0, "limit": null,
  "items": [ { "area": "node", "ref": { "kind": "Node", "namespace": null, "name": "ip-10-0-12-34.ap-northeast-2.compute.internal" }, "status": "critical", "reason": { "code": "NODE_NOT_READY", "text": "NotReady 3분", "status": "critical" }, "statusChangedAt": "2026-09-19T04:59:40.000Z" } ]
}
```
`area`: `node` | `workload` | `pod` | `event` | `db` | `pvc` | `metrics`.

---

## 3. 노드

### 3.1 `GET /api/cluster/nodes`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `status` | `ok,warning,critical,unknown` 중 여러 개 | |
| `nodeGroup` | 문자열 여러 개(쉼표) | |
| `zone` | 여러 개 | |
| `capacityType` | `on_demand,spot` | |
| `q` | 문자열(1~253) | 이름 부분 일치(대소문자 무시) |
| `sort` | `status`·`name`·`cpuPct`·`memoryPct`·`podsPct`·`createdAt` : `asc`/`desc` | 기본: 상태(critical→warning→unknown→ok) → 이름 |
| `limit`, `offset` | 공통 | |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "total": 6, "filteredTotal": 6, "offset": 0, "limit": null,
  "counts": { "all": 6, "critical": 1, "warning": 1, "ok": 4, "unknown": 0 },
  "facets": { "nodeGroups": ["batch", "system"], "zones": ["ap-northeast-2a", "ap-northeast-2c"], "capacityTypes": ["on_demand", "spot"] },
  "areaStatus": { "status": "critical", "reasons": [ { "code": "NODE_NOT_READY", "text": "ip-10-0-12-34 NotReady 3분", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:59:40.000Z", "stale": false },
  "thresholds": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 }, "requests": { "warnPct": 85, "critPct": null }, "pods": { "warnPct": 90, "critPct": 100 } },
  "metricsAvailable": true,
  "items": [
    {
      "name": "ip-10-0-12-34.ap-northeast-2.compute.internal",
      "status": { "status": "critical", "reasons": [ { "code": "NODE_NOT_READY", "text": "NotReady 3분", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:59:40.000Z", "stale": false },
      "instanceType": "m6i.large",
      "zone": "ap-northeast-2a",
      "nodeGroup": "batch",
      "capacityType": "on_demand",
      "architecture": "amd64",
      "kubeletVersion": "v1.30.2-eks-1552ad0",
      "createdAt": "2026-09-07T02:11:00.000Z",
      "ready": { "value": "Unknown", "since": "2026-09-19T04:59:10.000Z" },
      "unschedulable": false,
      "pressure": { "memory": false, "disk": false, "pid": false, "networkUnavailable": false },
      "allocatable": { "cpuMillicores": 1930, "memoryBytes": 7934296064, "pods": 29 },
      "usage": null,
      "requests": { "cpuMillicores": 1700, "memoryBytes": 5100273664, "cpuPct": 88.1, "memoryPct": 64.3 },
      "limits": { "cpuMillicores": 3200, "memoryBytes": 8589934592, "cpuPct": 165.8, "memoryPct": 108.3 },
      "pods": { "count": 23, "max": 29, "pct": 79.3 }
    }
  ]
}
```
- `counts`: `status` 필터를 **제외한** 나머지 필터를 적용한 개수(SegmentedControl 숫자). `facets`: 필터 드롭다운 후보(전체 기준).
- `metricsAvailable: false`면 모든 `usage`가 null, 화면은 CPU·메모리 열 `—`.
- 오류: 400 `VALIDATION_FAILED`.

### 3.2 `GET /api/cluster/nodes/:name`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "node": { "...": "NodeItem 전체" },
  "conditions": [
    { "type": "Ready", "value": "Unknown", "since": "2026-09-19T04:59:10.000Z", "reason": "NodeStatusUnknown", "message": "Kubelet stopped posting node status.", "status": "critical" },
    { "type": "MemoryPressure", "value": "Unknown", "since": "2026-09-19T04:59:10.000Z", "reason": "NodeStatusUnknown", "message": "Kubelet stopped posting node status.", "status": "unknown" },
    { "type": "DiskPressure", "value": "False", "since": "2026-09-07T02:12:00.000Z", "reason": "KubeletHasNoDiskPressure", "message": null, "status": "ok" },
    { "type": "PIDPressure", "value": "False", "since": "2026-09-07T02:12:00.000Z", "reason": "KubeletHasSufficientPID", "message": null, "status": "ok" },
    { "type": "NetworkUnavailable", "value": null, "since": null, "reason": null, "message": null, "status": "ok" }
  ],
  "capacity": { "cpuMillicores": 2000, "memoryBytes": 8201367552, "pods": 29 },
  "pods": [ { "...": "PodItem (이 노드의 파드, 완료 파드 제외)" } ],
  "events": [ { "...": "EventItem (대상이 이 노드 또는 이 노드의 파드)" } ],
  "thresholds": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 }, "requests": { "warnPct": 85, "critPct": null }, "pods": { "warnPct": 90, "critPct": 100 } }
}
```
- `conditions[].message`: 비밀값 가림 + 최대 300자.
- 오류: 404 `RESOURCE_NOT_FOUND`(`details.resource: { kind: "Node", name }`) → 화면 "노드를 찾을 수 없습니다". 503 `SOURCE_UNAVAILABLE`(kube 출처가 `not_configured`/`syncing`/`unavailable`). kube가 `stale`이면 캐시 값으로 200.

---

## 4. 워크로드

### 4.1 `GET /api/cluster/workloads`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `status` | 여러 개 | |
| `kind` | `Deployment,StatefulSet,DaemonSet` | |
| `namespace` | 여러 개 | |
| `hideSystem` | boolean (기본 false) | 시스템 네임스페이스 숨기기 (가정 A6 목록: env `SYSTEM_NAMESPACES`, 기본 `kube-system,kube-public,kube-node-lease,amazon-cloudwatch`) |
| `q` | 문자열 | 이름·이미지 부분 일치 |
| `sort` | `status`·`namespace`·`name`·`kind`·`lastRolloutAt` | 기본: 상태 → 네임스페이스 → 이름 |
| `limit`, `offset` | 공통 | |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "total": 24, "filteredTotal": 24, "offset": 0, "limit": null,
  "counts": { "all": 24, "critical": 1, "warning": 0, "ok": 23, "unknown": 0 },
  "facets": { "namespaces": ["data", "kube-system", "prod"], "kinds": ["Deployment", "StatefulSet", "DaemonSet"] },
  "areaStatus": { "status": "critical", "reasons": [ { "code": "WORKLOAD_NO_READY", "text": "prod / api ready 0/3", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T05:00:02.000Z", "stale": false },
  "items": [
    {
      "kind": "Deployment", "namespace": "prod", "name": "api", "key": "Deployment/prod/api",
      "status": { "status": "critical", "reasons": [ { "code": "WORKLOAD_NO_READY", "text": "ready 0/3", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T05:00:02.000Z", "stale": false },
      "isSystemNamespace": false,
      "replicas": { "desired": 3, "ready": 0, "updated": 3, "available": 0 },
      "stopped": false,
      "rollout": { "state": "progressing", "reason": "ReplicaSetUpdated" },
      "images": ["123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2", "fluent-bit:3.1"],
      "createdAt": "2026-08-01T00:00:00.000Z",
      "lastRolloutAt": "2026-09-19T04:58:00.000Z",
      "podCounts": { "critical": 3, "warning": 0, "ok": 0, "unknown": 0 },
      "hasPdb": false,
      "hpa": null,
      "source": "watch"
    }
  ]
}
```
- 화면(대시보드 UI)에는 이미지 원문(레지스트리 계정 ID 포함)을 보인다. 어드바이저 스냅샷에서만 가린다(`architecture-advisor.md` B.2).
- 오류: 400.

### 4.2 `GET /api/cluster/workloads/:kind/:namespace/:name`
`?focus=` 진입과 행 펼침 영역(소속 파드 표, 조건 메시지).

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "workload": { "...": "WorkloadItem" },
  "conditions": [ { "type": "Progressing", "value": "True", "reason": "ReplicaSetUpdated", "message": "ReplicaSet \"api-7f9c8d6b5\" is progressing.", "since": "2026-09-19T04:58:00.000Z" } ],
  "pods": [ { "...": "PodItem (소속 파드, 기본 정렬)" } ],
  "events": [ { "...": "EventItem (대상이 이 워크로드 또는 소속 파드)" } ]
}
```
- `:kind`는 `Deployment` | `StatefulSet` | `DaemonSet`(대소문자 정확히). 그 밖은 400.
- 오류: 400 `VALIDATION_FAILED`, 404 `RESOURCE_NOT_FOUND`, 503 `SOURCE_UNAVAILABLE`.

---

## 5. 파드

### 5.1 `GET /api/cluster/pods`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `status` | 여러 개 | |
| `namespace` | 여러 개 | |
| `hideSystem` | boolean (기본 false) | |
| `showCompleted` | boolean (기본 false) | false면 `completed: true` 파드 제외 (명세 3.4) |
| `node` | 노드 이름 | |
| `workload` | `kind/namespace/name` | |
| `q` | 문자열 | 이름·노드·워크로드 이름 부분 일치 |
| `sort` | `status`·`restarts1h`·`restartsTotal`·`namespace`·`name`·`cpu`·`memory`·`memoryLimitPct`·`startedAt` | 기본: 상태 → 최근 1시간 재시작 내림차순 → 네임스페이스 → 이름 |
| `limit`, `offset` | 공통 | |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "total": 412, "filteredTotal": 412, "offset": 0, "limit": null,
  "counts": { "all": 412, "critical": 2, "warning": 3, "ok": 405, "unknown": 2 },
  "facets": { "namespaces": ["batch", "data", "kube-system", "prod"] },
  "areaStatus": { "status": "critical", "reasons": [ { "code": "POD_WAITING_CRASHLOOP", "text": "prod / api-7f9c8d6b5-x2kq9 CrashLoopBackOff", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T05:00:02.000Z", "stale": false },
  "restartObservation": { "observedSec": 1380, "fullWindow": false },
  "thresholds": { "memoryLimit": { "warnPct": 80, "critPct": 95 }, "restarts1h": { "warn": 1, "crit": 3 } },
  "metricsAvailable": true,
  "items": [
    {
      "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9", "key": "prod/api-7f9c8d6b5-x2kq9",
      "status": {
        "status": "critical",
        "reasons": [
          { "code": "POD_WAITING_CRASHLOOP", "text": "CrashLoopBackOff · 최근 1시간 재시작 6회", "status": "critical" },
          { "code": "POD_MEMORY_LIMIT", "text": "메모리 limit 대비 97%", "status": "critical" }
        ],
        "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T05:00:02.000Z", "stale": false
      },
      "isSystemNamespace": false,
      "phase": "Running",
      "terminatingSince": null,
      "completed": false,
      "owner": { "kind": "Deployment", "name": "api", "workloadKey": "Deployment/prod/api" },
      "nodeName": "ip-10-0-12-34.ap-northeast-2.compute.internal",
      "containers": { "ready": 1, "total": 2 },
      "restarts": { "total": 41, "last1h": 6, "observedSec": 1380 },
      "waitingReason": "CrashLoopBackOff",
      "lastTermination": { "reason": "OOMKilled", "exitCode": 137, "finishedAt": "2026-09-19T05:01:52.000Z" },
      "startedAt": "2026-09-19T01:58:00.000Z",
      "createdAt": "2026-09-19T01:57:58.000Z",
      "qosClass": "Burstable",
      "usage": { "cpuMillicores": 120, "memoryBytes": 522190848, "updatedAt": "2026-09-19T05:02:00.000Z" },
      "requests": { "cpuMillicores": 300, "memoryBytes": 402653184 },
      "limits": { "cpuMillicores": 600, "memoryBytes": 536870912 },
      "memoryLimitPct": 97.3,
      "cpuRequestPct": 40.0
    }
  ]
}
```
- `restartObservation`: API가 뜬 뒤 1시간이 안 됐으면 `fullWindow: false` → 머리글 `관측 23분` 칩.
- 오류: 400.

### 5.2 `GET /api/cluster/pods/:namespace/:name`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "pod": { "...": "PodItem" },
  "podIP": "10.0.12.87",
  "serviceAccountName": "api",
  "containers": [
    {
      "name": "api",
      "init": false,
      "image": "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2",
      "status": { "status": "critical", "reasons": [ { "code": "CONTAINER_WAITING_CRASHLOOP", "text": "대기: CrashLoopBackOff", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T05:00:02.000Z", "stale": false },
      "ready": false,
      "state": { "type": "waiting", "reason": "CrashLoopBackOff", "message": "back-off 5m0s restarting failed container=api", "since": null },
      "restarts": { "total": 41, "last1h": 6 },
      "lastTermination": { "reason": "OOMKilled", "exitCode": 137, "startedAt": "2026-09-19T05:01:40.000Z", "finishedAt": "2026-09-19T05:01:52.000Z" },
      "requests": { "cpuMillicores": 250, "memoryBytes": 268435456 },
      "limits": { "cpuMillicores": 500, "memoryBytes": 536870912 },
      "usage": { "cpuMillicores": 118, "memoryBytes": 522190848 },
      "memoryLimitPct": 97.3,
      "probes": { "readiness": true, "liveness": true, "startup": false }
    }
  ],
  "events": [ { "...": "EventItem (대상이 이 파드)" } ]
}
```
- 컨테이너 순서: 문제 컨테이너 먼저(상태 나쁜 순) → 이름. init 컨테이너는 실패·대기 중일 때만 포함.
- `state.type`: `running` | `waiting` | `terminated`. `state.message`는 비밀값 가림 + 최대 300자. **환경 변수·command/args·볼륨 마운트·securityContext 원문은 주지 않는다.**
- `podIP`: 디자인 파드 상세 정보 영역에 표시(로컬 운영자 화면). 어드바이저 스냅샷에는 넣지 않는다.
- 오류: 404 `RESOURCE_NOT_FOUND` → 화면 "파드를 찾을 수 없습니다" (`details.resource.owner`에 마지막으로 알던 소속 워크로드 `workloadKey`가 있으면 넣는다 → `워크로드 보기` 버튼), 503 `SOURCE_UNAVAILABLE`.

---

## 6. 이벤트

### 6.0 `GET /api/cluster/events`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `severeOnly` | boolean | 심각 reason만 |
| `namespace` | 여러 개 | |
| `kind` | 여러 개 (`Pod,Node,Deployment,...`) | 대상 종류 |
| `reason` | 여러 개 | |
| `target` | `kind/namespace/name` (클러스터 범위는 `Node//name`) | 특정 대상 |
| `sinceSec` | 60~3600 (기본 3600) | |
| `q` | 문자열 | 대상 이름·reason·message 부분 일치 |
| `sort` | `lastSeenAt`·`count`·`namespace` | 기본: `lastSeenAt:desc` |
| `limit`, `offset` | 공통 | |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "total": 31, "filteredTotal": 31, "offset": 0, "limit": null,
  "retentionSec": 3600,
  "areaStatus": { "status": "warning", "reasons": [ { "code": "EVENTS_WARNING_RECENT", "text": "최근 15분 Warning 7건", "status": "warning" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:50:00.000Z", "stale": false },
  "facets": { "namespaces": ["prod", "batch"], "kinds": ["Pod", "Node"], "reasons": ["BackOff", "FailedScheduling"] },
  "items": [
    {
      "key": "6c4c1a9e-8d0e-4b0e-a6f1-3f0a7e9c2b11",
      "namespace": "prod",
      "involvedObject": { "kind": "Pod", "namespace": "prod", "name": "api-7f9c8d6b5-x2kq9" },
      "reason": "BackOff",
      "message": "Back-off restarting failed container api in pod api-7f9c8d6b5-x2kq9_prod(...)",
      "count": 12,
      "firstSeenAt": "2026-09-19T04:40:02.000Z",
      "lastSeenAt": "2026-09-19T05:01:52.000Z",
      "severe": true,
      "sourceComponent": "kubelet"
    }
  ]
}
```
- `severe` 판정(명세 3.5): `FailedMount`, `FailedAttachVolume`, `Evicted`, `OOMKilling`, `NodeNotReady`, `FailedCreatePodSandBox`는 발생 즉시, `FailedScheduling`은 같은 대상에 5분 이상 반복, `BackOff`는 같은 대상 10분 안에 5회 이상.
- 오류: 400.

### 6.1 참고: RBAC와 데이터 도출
- 이벤트는 core `events`(v1)를 watch한다(`events.k8s.io`는 쓰지 않음, RBAC 목록과 일치).
- 파드의 소속 워크로드: ownerReference가 `ReplicaSet`이면 파드 레이블 `pod-template-hash` 값을 이름 끝에서 떼어 Deployment 이름을 얻는다(**replicasets 조회 권한 없이**). 해당 Deployment가 캐시에 없으면 `owner.kind: 'ReplicaSet'`, `workloadKey: null`.
- Job 파드: ownerReference `kind: Job`으로 판단(jobs 조회 권한 불필요). `Failed` Job 파드는 장애가 아니라 **주의**.
- **DaemonSet: watch.** `CLAUDE.md` RBAC 목록에 `daemonsets`가 포함돼 있고(`deploy/rbac.yaml` `apps` 그룹 get/list/watch), Deployment·StatefulSet과 같이 informer로 받는다(`source: 'watch'`).
  - `replicas.desired` = `status.desiredNumberScheduled`, `ready` = `numberReady`, `updated` = `updatedNumberScheduled`, `available` = `numberAvailable`.
  - 판단은 다른 워크로드와 같다: ready 0 → `WORKLOAD_NO_READY`(critical), `ready < desired` → `WORKLOAD_PARTIAL_READY`(warning, 명세의 `numberReady = desiredNumberScheduled` 비교), `updated < desired` → 롤아웃 진행 중. `desired = 0`(조건에 맞는 노드 없음)이면 `stopped: true` + `WORKLOAD_STOPPED`(ok).
  - 이전 초안의 "파드에서 도출(`derived_from_pods`)"과 `DAEMONSET_DESIRED_UNKNOWN`은 쓰지 않는다. 필드 값은 호환을 위해 남겨 둔다(예약).

---

## 7. PVC · 메트릭 · DB

### 7.1 `GET /api/cluster/pvcs`

쿼리: `namespace`(여러 개), `status`(여러 개), `dbOnly`(boolean), `q`, `sort`(`status`·`namespace`·`name`·`usagePct`·`capacity`, 기본 상태 → 네임스페이스 → 이름), `limit`, `offset`.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "total": 5, "filteredTotal": 5, "offset": 0, "limit": null,
  "usageSource": "db_size_approx",
  "thresholds": { "usage": { "warnPct": 75, "critPct": 90 } },
  "items": [
    {
      "namespace": "data", "name": "data-postgres-0", "key": "data/data-postgres-0",
      "status": { "status": "ok", "reasons": [], "updatedAt": "2026-09-19T05:00:00.000Z", "statusChangedAt": "2026-09-19T03:40:30.000Z", "stale": false },
      "phase": "Bound", "phaseSince": "2026-08-01T00:00:10.000Z",
      "capacityBytes": 53687091200, "requestedBytes": 53687091200,
      "storageClass": "gp3", "volumeName": "pvc-3f1c2d7e-0b3a-4c2e-9d0a-7f5b1e2c3d4f",
      "usage": { "usedBytes": 19756849971, "pct": 36.8, "source": "db_size_approx", "updatedAt": "2026-09-19T05:00:00.000Z" },
      "mountedBy": [ { "kind": "Pod", "namespace": "data", "name": "postgres-0" } ],
      "isDbVolume": true
    }
  ]
}
```
- `usageSource`: 이 응답 전체의 기본 출처 `prometheus` | `db_size_approx` | `none`.
- 오류: 400.

### 7.2 `GET /api/cluster/metrics` (클러스터 CPU·메모리 합계)

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "available": true,
  "unavailableReason": null,
  "updatedAt": "2026-09-19T05:02:00.000Z",
  "cpu": {
    "status": { "status": "ok", "reasons": [], "updatedAt": "2026-09-19T05:02:00.000Z", "statusChangedAt": "2026-09-19T03:40:30.000Z", "stale": false },
    "allocatableMillicores": 11580,
    "usageMillicores": 3120, "usagePct": 26.9,
    "requestsMillicores": 8400, "requestsPct": 72.5,
    "limitsMillicores": 14200, "limitsPct": 122.6
  },
  "memory": {
    "status": { "status": "warning", "reasons": [ { "code": "CLUSTER_MEMORY_USAGE", "text": "메모리 사용률 78% (연속 3회)", "status": "warning" } ], "updatedAt": "2026-09-19T05:02:00.000Z", "statusChangedAt": "2026-09-19T04:30:00.000Z", "stale": false },
    "allocatableBytes": 47605776384,
    "usageBytes": 37132505088, "usagePct": 78.0,
    "requestsBytes": 30601641984, "requestsPct": 64.3,
    "limitsBytes": 51539607552, "limitsPct": 108.3
  },
  "thresholds": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 } },
  "history": { "source": "in_memory", "maxRangeSec": 3600, "stepSec": 15, "observedSec": 3600 }
}
```
- metrics-server 없음: `available: false`, `unavailableReason: { "code": "METRICS_API_UNAVAILABLE", "message": "metrics.k8s.io API 없음 (metrics-server 미설치)" }`, `cpu.status`·`memory.status`는 unknown, 사용량 필드는 `null`. requests·limits·allocatable은 kube 출처라 계속 준다. **HTTP 오류 아님.**
- `history.source`: `in_memory`(최근 1시간, API 재시작 시 초기화) | `prometheus`(24시간까지, 30초 해상도).

### 7.3 `GET /api/cluster/metrics/series`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `target` | `cluster` \| `node` \| `pod` (필수) | |
| `name` | 문자열 | node·pod일 때 필수 |
| `namespace` | 문자열 | pod일 때 필수 |
| `range` | `1h` \| `6h` \| `24h` (기본 `1h`) | `in_memory`면 `1h`만 허용 |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "target": { "kind": "Node", "namespace": null, "name": "ip-10-0-12-35.ap-northeast-2.compute.internal" },
  "range": "1h",
  "source": "in_memory",
  "stepSec": 15,
  "observedSince": "2026-09-19T04:39:10.000Z",
  "available": true,
  "unavailableReason": null,
  "thresholds": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 } },
  "denominators": { "cpuMillicores": 1930, "memoryBytes": 7934296064, "memoryBasis": "allocatable" },
  "points": [
    { "t": "2026-09-19T04:39:15.000Z", "cpuMillicores": 850, "memoryBytes": 5153960755, "cpuPct": 44.0, "memoryPct": 65.0, "cpuStatus": "ok", "memoryStatus": "ok" },
    { "t": "2026-09-19T04:39:30.000Z", "cpuMillicores": null, "memoryBytes": null, "cpuPct": null, "memoryPct": null, "cpuStatus": null, "memoryStatus": null }
  ]
}
```
- 결측 표본은 값 `null`로 둔다(화면이 선을 끊는다, `status.md` 4.2).
- pod 대상의 `memoryPct`는 **limit 대비**(`memoryBasis: "limit"`, 임계 80/95), limit이 없으면 `memoryPct: null`. cpuPct는 requests 대비.
- 파드 표본은 API가 관측한 동안만 있다(파드가 새로 생겼으면 짧음).
- 오류: 400(`name` 누락, in_memory에 `range=24h` 등), 404 `RESOURCE_NOT_FOUND`(노드·파드가 캐시에 없고 표본도 없음).

### 7.4 `GET /api/cluster/db`

DB 상세 화면 전체. 쿠버네티스 쪽(StatefulSet·파드·PVC) + DB 내부(DBA `PgHealthSnapshot` 기반). `db.snapshot`·`db.updated` payload와 같다.

**응답 200 (정상 수집)**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "configured": true,
  "target": { "namespace": "data", "statefulSet": "postgres", "vendor": "postgres" },
  "status": {
    "status": "warning",
    "reasons": [
      { "code": "DB_CONNECTION_USAGE", "text": "연결 82% (max 100)", "status": "warning" },
      { "code": "DB_LONG_RUNNING_QUERIES", "text": "5분 넘게 실행 중인 쿼리 3건 (최장 12분)", "status": "warning" }
    ],
    "updatedAt": "2026-09-19T05:02:00.000Z", "statusChangedAt": "2026-09-19T05:01:00.000Z", "stale": false
  },
  "kubernetes": {
    "status": { "status": "ok", "reasons": [], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T03:40:30.000Z", "stale": false },
    "statefulSet": { "...": "WorkloadItem (kind StatefulSet)" },
    "pods": [ { "...": "PodItem" } ],
    "pvcs": [ { "...": "PvcItem (isDbVolume: true)" } ]
  },
  "health": {
    "vendor": "postgres",
    "collectedAt": "2026-09-19T05:02:00.000Z",
    "intervalSec": 15,
    "reachable": true,
    "responseMs": 42,
    "error": null,
    "server": { "version": "16.4", "versionNum": 160004, "role": "primary", "uptimeSec": 1209600 },
    "connections": {
      "total": 82, "max": 100, "usagePct": 82.0,
      "byState": { "active": 12, "idle": 60, "idleInTransaction": 1, "idleInTransactionAborted": 0, "other": 9 },
      "waitingOnLock": 0
    },
    "longRunning": { "activeOverWarn": 3, "activeOverCrit": 0, "idleInTxOverWarn": 1, "idleInTxOverCrit": 0, "maxActiveSec": 724, "maxIdleInTxSec": 731 },
    "sessions": [
      { "pid": 48213, "user": "app_rw", "database": "app", "state": "idle in transaction", "waitEventType": "Client", "waitEvent": "ClientRead", "backendAgeSec": 3600, "xactAgeSec": 731, "queryAgeSec": 731, "stateAgeSec": 731 }
    ],
    "locks": { "waitingTotal": 0, "waitingOverThreshold": 0, "maxWaitSec": 0, "items": [] },
    "throughput": { "intervalSec": 15, "commitsPerSec": 124.3, "rollbacksPerSec": 0.4, "cacheHitPct": 99.2, "blocksInInterval": 182340, "deadlocksDelta": 0 },
    "xid": { "maxAge": 120034556, "database": "app", "maxMultixactAge": 1200 },
    "sizes": {
      "measuredAt": "2026-09-19T05:00:00.000Z",
      "databases": [ { "name": "app", "bytes": 17179869184 }, { "name": "postgres", "bytes": 8388608 } ],
      "totalBytes": 17188257792, "walBytes": 1073741824, "approxDataDirBytes": 18261999616
    },
    "replication": { "role": "primary", "standbys": [], "slots": [], "standbyReplayDelaySec": null, "walReceiverStatus": null },
    "checks": [
      {
        "id": "connection_usage",
        "status": { "status": "warning", "reasons": [ { "code": "DB_CONNECTION_USAGE", "text": "연결 82% (max 100)", "status": "warning" } ], "updatedAt": "2026-09-19T05:02:00.000Z", "statusChangedAt": "2026-09-19T05:01:00.000Z", "stale": false },
        "value": 82.0, "unit": "percent",
        "applicable": true, "held": false, "sustained": true,
        "thresholds": { "warn": 70, "crit": 90 }
      },
      {
        "id": "replication_lag",
        "status": { "status": "ok", "reasons": [ { "code": "DB_REPLICATION_NOT_APPLICABLE", "text": "standby 없음", "status": "ok" } ], "updatedAt": "2026-09-19T05:02:00.000Z", "statusChangedAt": "2026-09-19T03:40:30.000Z", "stale": false },
        "value": null, "unit": "sec",
        "applicable": false, "held": false, "sustained": false,
        "thresholds": { "warn": 10, "crit": 60 }
      }
    ]
  },
  "pvcUsage": { "pct": 34.0, "usedBytes": 18261999616, "capacityBytes": 53687091200, "source": "db_size_approx" }
}
```

**`health` 필드 정의**: DBA `PgHealthSnapshot`(`apps/api/src/database/health/postgres/types.ts`)을 **그대로** 옮기되 두 가지만 바꾼다.
1. `checks[]`: `HealthCheckResult { id, level, reason, value, unit, applicable, held, sustained }` → `{ id, status: StatusInfo, value, unit, applicable, held, sustained, thresholds }`. `level`은 서버가 **지속 조건(연속 3회, `sustained: true`인 지표)을 적용한 뒤** `status.status`가 된다. `reason`은 `status.reasons[0].text`. `thresholds`는 `db.thresholds` 설정에서 그 지표의 주의·장애 기준(화면 UsageBar·타일용, 장애 기준 없으면 `crit: null`).
2. `overall`은 빼고 최상위 `status`(쿠버네티스 쪽 + DB 내부 최악, 명세 3.7)로 대신한다.
- `checks[].id` 순서는 DBA `PG_CHECK_ORDER`(`reachability`, `connection_usage`, `long_running_queries`, `idle_in_transaction`, `lock_waits`, `cache_hit_ratio`, `deadlocks`, `xid_age`, `replication_lag`)와 같다.
- `applicable: false`(standby 없음 → 복제) → 화면 "해당 없음" 칩, 배지 없음.
- `held: true`(캐시 적중률 표본 블록 < 1,000) → 화면 "판단 보류" 칩, `status`는 직전 값.
- `pvcUsage`: Prometheus가 있으면 `source: "prometheus"`, 없으면 `approxPvcUsagePct`(DB 합계 + WAL) → `source: "db_size_approx"`(화면 "근사치").

**민감 필드 노출 정책**
| 필드 | 대시보드 API(REST·SSE) | 어드바이저 스냅샷 | 이유 |
|---|---|---|---|
| 쿼리 원문 (`pg_stat_activity.query`) | **없음** (수집 안 함) | 없음 | 명세 가정 A7, 수용 기준 |
| 클라이언트 주소·호스트 | **없음** (수집 안 함) | 없음 | DBA 쿼리가 가져오지 않음 |
| DB 사용자 이름 (`sessions[].user`, `locks.items[].user`) | **포함** | **제외** | 명세 S3·디자인 세션 표가 사용자 열을 요구. 로컬 운영자 화면(가정 A5). 스냅샷은 명세 3.4에 따라 제외 |
| `pid` | 포함 | 제외 | 운영자가 `pg_terminate_backend` 등을 직접 판단할 때 필요. 대시보드는 실행하지 않음 |
| standby `name`(application_name), 슬롯 이름 | 포함 | 제외 | 운영 식별용 |
| DB 이름 (`sizes.databases[].name`, `xid.database`) | 포함 | 포함 | 명세 3.3 "DB별 크기" |
| `error` (접속 오류) | 포함 (`sanitizeErrorMessage` 거친 한 줄, 접속 문자열·비밀번호 가림) | 제외 | |
| 모니터링 계정 이름·비밀번호, 접속 문자열 | **없음** | 없음 | `.env`에만 |

**변형**
- DB 대상 설정 없음(`DB_TARGET_NAMESPACE`/`DB_TARGET_STATEFULSET` 또는 `MONITOR_DB_URL` 없음): `configured: false`, `target: null`, `kubernetes: null`, `health: null`, `status.status: "unknown"` + reason `DB_NOT_CONFIGURED` `"모니터링할 DB가 설정되지 않았습니다"`. HTTP 200.
- 접속 실패(파드는 Ready): `health.reachable: false`, `health.error` 한 줄, `reachability` check critical, 나머지 checks unknown(`DB 접속 불가`). 최상위 대표 사유 = 접속 실패.
- DB 파드 없음/ready 0: 최상위 대표 사유를 파드 쪽(`DB_POD_NOT_READY` `"DB 파드 없음 (ready 0/1)"`)으로 두고, 접속 실패 사유는 두 번째 이하로 내린다.
- 45초 넘게 수집 안 됨: `health.*` 값 유지, 모든 `checks[].status.stale: true`, 최상위 `status.stale: true`, `stream.source`(`monitoredDb`, `stale`).
- 오류: 없음(항상 200).

---

## 8. SSE 이벤트 (`GET /api/stream`)

봉투·순서·heartbeat·재연결은 `common.md` 5절. 아래는 `payload` 모양.

### 8.1 토픽 `overview`
| 이벤트 | 언제 | payload |
|---|---|---|
| `overview.snapshot` | 연결 직후, mock 시나리오 변경 후 | `GET /api/overview` 응답과 같음 |
| `overview.updated` | 요약·영역 상태·지금 확인할 항목·nav·비용/어드바이저 요약 중 하나라도 바뀜 (1초 debounce) | `GET /api/overview`와 같음 (전체 교체) |

### 8.2 토픽 `cluster`
| 이벤트 | 언제 | payload |
|---|---|---|
| `cluster.snapshot` | 연결 직후, informer 재동기화(stale → ok) 후, 시나리오 변경 후 | 아래 |
| `cluster.summary.updated` | 영역 상태·개수·"관측 N분" 변경 | `{ areas, restartObservation, thresholds }` (`areas`는 overview와 같음) |
| `cluster.node.upsert` | 노드 추가·변경(상태, 조건, requests, 사용량으로 인한 상태 변화) | `{ item: NodeItem }` |
| `cluster.node.delete` | 노드 삭제 | `{ name }` |
| `cluster.workload.upsert` / `.delete` | | `{ item: WorkloadItem }` / `{ key, kind, namespace, name }` |
| `cluster.pod.upsert` / `.delete` | | `{ item: PodItem }` / `{ key, namespace, name }` |
| `cluster.event.upsert` / `.delete` | Warning 이벤트 추가·반복 / 1시간 경과·삭제 | `{ item: EventItem }` / `{ key }` |
| `cluster.pvc.upsert` / `.delete` | | `{ item: PvcItem }` / `{ key, namespace, name }` |

`cluster.snapshot` payload:
```json
{
  "sync": { "initialSyncDone": true, "lastSyncAt": "2026-09-19T05:02:10.000Z" },
  "cluster": { "name": "prod-eks", "version": "v1.30.4", "region": "ap-northeast-2", "connected": true },
  "areas": { "...": "overview.areas와 같음" },
  "restartObservation": { "observedSec": 1380, "fullWindow": false },
  "thresholds": { "node": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 }, "requests": { "warnPct": 85, "critPct": null }, "pods": { "warnPct": 90, "critPct": 100 } }, "pod": { "memoryLimit": { "warnPct": 80, "critPct": 95 }, "restarts1h": { "warn": 1, "crit": 3 } }, "pvc": { "usage": { "warnPct": 75, "critPct": 90 } } },
  "nodes": [ "NodeItem..." ],
  "workloads": [ "WorkloadItem..." ],
  "pods": [ "PodItem... (완료 파드 포함 전체. 화면이 showCompleted로 거름)" ],
  "events": [ "EventItem..." ],
  "pvcs": [ "PvcItem..." ]
}
```
- upsert는 **행 전체 교체**. 시간 경과 판단(Pending 10분, NotReady 60초 등)은 서버가 15초마다 재평가해 **상태가 바뀐 행만** upsert한다(경과 시간 숫자 자체는 화면이 `startedAt`·`since`로 계산하므로 매번 보내지 않는다).
- 메트릭 갱신으로 행의 `usage`만 바뀐 경우에는 `cluster.*.upsert`를 보내지 않고 `metrics.updated`에 담는다. 사용량 때문에 **상태가 바뀌면** 그 행을 upsert한다.
- 출처 매핑(stale): `kube` → 이 토픽 전체.

### 8.3 토픽 `metrics`
| 이벤트 | 언제 | payload |
|---|---|---|
| `metrics.snapshot` | 연결 직후 | `{ cluster: <GET /api/cluster/metrics 응답에서 dataSource·generatedAt 제외>, clusterSeries: { stepSec, source, observedSince, points }, nodes: [...], pods: [...] }` |
| `metrics.updated` | 15초마다 (수집 성공·실패 모두) | 아래 |

`metrics.updated` payload:
```json
{
  "collectedAt": "2026-09-19T05:02:15.000Z",
  "available": true,
  "unavailableReason": null,
  "cluster": { "...": "GET /api/cluster/metrics의 cpu·memory·updatedAt" },
  "clusterPoint": { "t": "2026-09-19T05:02:15.000Z", "cpuMillicores": 3120, "memoryBytes": 37132505088, "cpuPct": 26.9, "memoryPct": 78.0, "cpuStatus": "ok", "memoryStatus": "warning" },
  "nodes": [ { "name": "ip-10-0-12-35.ap-northeast-2.compute.internal", "cpuMillicores": 1250, "memoryBytes": 6442450944, "cpuPct": 64.8, "memoryPct": 81.2 } ],
  "pods": [ { "key": "prod/api-7f9c8d6b5-x2kq9", "cpuMillicores": 120, "memoryBytes": 522190848, "memoryLimitPct": 97.3, "cpuRequestPct": 40.0 } ]
}
```
- 화면은 `nodes`·`pods` 값으로 표의 사용량 셀과 상세 차트 끝점을 갱신한다(노드·파드 차트는 REST 시계열 + 이 값 추가). metrics-server 없음이면 `available: false`, 배열은 `[]`.
- 출처 매핑: `metrics`(없으면 `prometheus`) → 이 토픽.

### 8.4 토픽 `db`
| 이벤트 | 언제 | payload |
|---|---|---|
| `db.snapshot` | 연결 직후 | `GET /api/cluster/db` 응답과 같음 |
| `db.updated` | 15초 수집마다(실패 포함), DB StatefulSet·파드·PVC 변경 시 | 같음 (전체 교체. 수 KB) |
- 출처 매핑: `monitoredDb` → `health`, `kube` → `kubernetes`.

---

## 9. 판단 이유 코드 (`Reason.code`)

`text`는 서버가 만든 표시 문장이다. 아래는 코드 목록과 문장 예.

| 영역 | code | 등급 | text 예 |
|---|---|---|---|
| 공통 | `SOURCE_NOT_CONFIGURED` | unknown | `클러스터 연결 없음` |
| | `SOURCE_UNAVAILABLE` | unknown | `알 수 없음 (metrics-server 없음)` |
| | `SOURCE_SYNCING` | unknown | `최초 동기화 중` |
| 클러스터 | `CLUSTER_NO_NODES` | critical | `노드 0개` |
| | `CLUSTER_ALL_NODES_NOT_READY` | critical | `모든 노드 NotReady` |
| | `CLUSTER_CPU_USAGE` / `CLUSTER_MEMORY_USAGE` | warning/critical | `메모리 사용률 78% (연속 3회)` |
| 노드 | `NODE_NOT_READY` | warning(<60초)/critical | `NotReady 3분` |
| | `NODE_MEMORY_PRESSURE` / `NODE_DISK_PRESSURE` / `NODE_PID_PRESSURE` | warning | `MemoryPressure` |
| | `NODE_NETWORK_UNAVAILABLE` | critical | `NetworkUnavailable` |
| | `NODE_CORDONED` | warning | `스케줄 제외 (cordon)` |
| | `NODE_CPU_USAGE` / `NODE_MEMORY_USAGE` | warning/critical | `CPU 95% (연속 3회)` |
| | `NODE_REQUESTS_HIGH` | warning | `CPU requests 88% (스케줄 여유 부족)` |
| | `NODE_PODS_HIGH` | warning/critical | `파드 27/29` |
| | `NODE_SEVERE_EVENT` | warning | `최근 15분 NodeNotReady 이벤트` |
| 워크로드 | `WORKLOAD_NO_READY` | critical | `ready 0/3` |
| | `WORKLOAD_PARTIAL_READY` | warning | `ready 2/3` |
| | `WORKLOAD_ROLLOUT_PROGRESSING` | warning | `롤아웃 진행 중` |
| | `WORKLOAD_ROLLOUT_FAILED` | critical | `ProgressDeadlineExceeded` |
| | `WORKLOAD_STOPPED` | ok | `중지됨 (desired 0)` |
| | ~~`DAEMONSET_DESIRED_UNKNOWN`~~ | — | 쓰지 않음 (DaemonSet을 watch하므로. 6.1) |
| 파드 | `POD_WAITING_CRASHLOOP` 등 `POD_WAITING_<REASON>` | critical | `CrashLoopBackOff · 최근 1시간 재시작 6회` |
| | `POD_WAITING_CREATING` | warning | `ContainerCreating 3분` |
| | `POD_PENDING` | warning(2분+)/critical(10분+) | `Pending 12분` |
| | `POD_NOT_READY` | warning | `준비 안 된 컨테이너 1개 (4분)` |
| | `POD_FAILED` / `POD_UNKNOWN` | critical | `Failed` |
| | `POD_JOB_FAILED` | warning | `Job 파드 Failed (재시도 설계일 수 있음)` |
| | `POD_RESTARTS_1H` | warning/critical | `최근 1시간 재시작 6회` (관측 1시간 미만이면 `최근 23분 재시작 2회`) |
| | `POD_OOM_RECENT` | warning | `최근 1시간 OOMKilled 1회` |
| | `POD_MEMORY_LIMIT` | warning/critical | `메모리 limit 대비 97%` |
| | `POD_TERMINATING_LONG` | warning | `종료 중 7분` |
| | `POD_SEVERE_EVENT` | warning | `FailedMount (최근 15분)` |
| 이벤트 | `EVENTS_WARNING_RECENT` | warning | `최근 15분 Warning 7건` |
| | `EVENTS_SEVERE_RECENT` | critical | `심각 이벤트 FailedScheduling 2건 (최근 15분)` |
| PVC | `PVC_PENDING` | warning | `Pending 3분` |
| | `PVC_LOST` | critical | `Lost` |
| | `PVC_USAGE` | warning/critical | `사용률 82% (근사치)` |
| DB | `DB_NOT_CONFIGURED` | unknown | `모니터링할 DB가 설정되지 않았습니다` |
| | `DB_POD_NOT_READY` | critical | `DB 파드 없음 (ready 0/1)` |
| | `DB_UNREACHABLE` | critical | `연결 실패: 인증 실패` / `시간 초과 (5초)` |
| | `DB_SLOW_RESPONSE` | warning | `응답 812 ms` |
| | `DB_CONNECTION_USAGE` | warning/critical | `연결 92% (max 100)` |
| | `DB_LONG_RUNNING_QUERIES` | warning/critical | `5분 넘게 실행 중인 쿼리 3건 (최장 12분)` |
| | `DB_IDLE_IN_TRANSACTION` | warning/critical | `idle in transaction 12분 1건` |
| | `DB_LOCK_WAITS` | warning/critical | `잠금 대기 2건 (1분 이상)` |
| | `DB_CACHE_HIT` | warning/critical | `캐시 적중률 92.1%` |
| | `DB_DEADLOCKS` | warning | `데드락 +1` |
| | `DB_XID_AGE` | warning/critical | `트랜잭션 ID 나이 5.2억` |
| | `DB_REPLICATION_LAG` | warning/critical | `복제 지연 14초` / `standby 연결 끊김` |
| | `DB_REPLICATION_NOT_APPLICABLE` | ok | `standby 없음` |

- DB 코드의 `text`는 DBA `normalizePgHealth`가 만든 `reason`을 그대로 쓴다(코드는 `checks[].id` → 위 표로 매핑).

## 10. 에러 코드 요약

| HTTP | code | 엔드포인트 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 목록 쿼리, `:kind` 값, series 쿼리 |
| 404 | `RESOURCE_NOT_FOUND` | `nodes/:name`, `pods/:ns/:name`, `workloads/:kind/:ns/:name`, `metrics/series` |
| 503 | `SOURCE_UNAVAILABLE` | 상세 조회인데 kube 출처가 `not_configured`/`syncing`/`unavailable` |
| 503 | `STREAM_LIMIT_REACHED` | `/api/stream` |

목록·요약·메트릭·DB는 출처가 실패해도 200 + unknown이다.

## 11. 설정·환경 변수 (이 기능)

| 이름 | 기본 | 설명 |
|---|---|---|
| `KUBECONFIG` | - | 로컬. 클러스터 안에서는 `loadFromCluster()` |
| `EKS_CLUSTER_NAME` | - | 표시 이름, `eks:DescribeCluster` 대상 |
| `SYSTEM_NAMESPACES` | `kube-system,kube-public,kube-node-lease,amazon-cloudwatch` | 가정 A6 |
| `DB_TARGET_NAMESPACE`, `DB_TARGET_STATEFULSET` | - | 가정 A2 |
| `MONITOR_DB_URL` | - | 모니터링 계정 접속 (DBA `.env.example`) |
| `PROMETHEUS_URL` | - | 선택 |
| `SSE_MAX_CLIENTS` | 20 | |
| settings `cluster.thresholds`, `db.thresholds` | DBA `settings-defaults.ts` | 판단 기준값. env > settings > 코드 기본값 |

## 12. 명세·디자인·DBA 충돌과 선택 (이 문서)

1. **DaemonSet** — (해결) CLAUDE.md RBAC에 `daemonsets`가 있어 watch로 받는다. 6.1 참고. 초안의 파드 도출 방식과 `DAEMONSET_DESIRED_UNKNOWN`은 폐기.
2. **PVC 사용량의 "정확한 값"** — 명세 3.7은 정확한 볼륨 사용량이 있으면 쓰라고 하지만 PM이 `nodes/proxy`(kubelet stats)를 추가하지 않기로 결정. → Prometheus가 있을 때만 정확한 값, 없으면 DB PVC만 근사치, 나머지 PVC는 사용률 판단 없음(null).
3. **상태 키 `warn/crit` vs `warning/critical`** — `common.md` 2.1. API는 `warning/critical`.
4. **디자인 "페이지네이션 없음" vs PM "페이지네이션"** — `common.md` 1.3. 선택적 `limit/offset`, 기본 전체.
5. **명세 3.7 DB 사용자 이름** — 명세 S3·디자인은 세션 표에 사용자 표시, 명세 `architecture-advisor` 3.4는 스냅샷에서 제외. 충돌 아님: 대시보드 API는 포함, 어드바이저 스냅샷은 제외(7.4 표).
6. **최근 24시간 재시작·OOM** — 명세 이 기능은 1시간만 필요하지만 어드바이저 R-RESTART·R-OOM이 24시간을 요구. → 서버는 파드별 재시작·OOM 이력을 **24시간** 메모리에 유지한다(API 응답에는 1시간 값만, 24시간 값은 어드바이저 스냅샷용). 재시작 후에는 관측 구간이 짧다.

## 13. 변경 이력
- 2026-09-19 (4단계 모듈 연결): DaemonSet을 watch 기준으로 정정(1.2 `replicas.desired`·`source`, 6.1, 9절 `DAEMONSET_DESIRED_UNKNOWN` 폐기, 12절 1번 해결). 응답 필드 추가·삭제 없음.
- 2026-09-19 (4단계 마무리): 2.1 `advisor.status`(StatusInfo) 명시 — 구현이 이미 내려 주던 필드. mock 클러스터 버전 `v1.34.1`(EKS 지원 등급 기준, `aws-cost.md` 11절 8번).
