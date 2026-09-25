# API 계약: cluster-status

- 작성: backend, 2026-09-19 (3단계 계약. 구현 전)
- 공통 규약: `docs/api/common.md` (prefix `/api`, 에러 형식, `StatusInfo`, 단위, SSE 봉투·heartbeat·재연결, mock 시나리오)
- 명세: `docs/specs/cluster-status.md` / 디자인: `docs/design/cluster-status.md`, `status.md`, `shell.md` / DBA: `docs/db/health.md`, `apps/api/src/database/health/**/types.ts`
- 모든 상태·판단 이유·지속 조건은 **서버가 계산**한다. 화면은 계산하지 않는다(명세 7절 백엔드).
- **대상 환경은 kOps 클러스터**(마스터가 사용자 소유 EC2)다. `docs/specs/kops-support.md` 3.1~3.2·3.4·3.6이 이 문서의 노드·컨트롤 플레인·metrics-server·인증 부분을 덮어쓴다. EKS 전용 개념(관리형 컨트롤 플레인, `eks.amazonaws.com/*` 라벨, `eks:DescribeCluster`)은 이 계약에 **없다**. 플랫폼 분기 설정(`PLATFORM`)도 두지 않는다.

## 0. 화면 ↔ 엔드포인트

| 화면 (디자인 경로) | REST | SSE 토픽 |
|---|---|---|
| 셸 사이드바·상단바 | `GET /api/overview` | `overview` |
| 개요 `/` | `GET /api/overview`, `GET /api/cluster/metrics`, `GET /api/cluster/metrics/series?target=cluster` | `overview`, `metrics` |
| 노드 목록 `/cluster/nodes` (워커 목록 + 상단 컨트롤 플레인 섹션) | `GET /api/cluster/nodes`(기본 `role=worker`), `GET /api/cluster/control-plane` | `cluster`, `metrics` |
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
| `metrics` | 노드·파드 CPU/메모리 사용량 | `metrics.k8s.io` 15초 조회. **kOps는 metrics-server가 기본 설치가 아니다** → 없으면 `unavailable` + 사용량 `null`(오류 아님, mock으로 대체하지 않음) |
| `prometheus` (선택) | 추이(24시간까지), PVC 사용량 `kubelet_volume_stats_used_bytes` | 설정 시에만 |
| `monitoredDb` | DB 내부 지표 | 15초 조회 (DBA 쿼리), `normalizePgHealth` |

---

## 1. 공통 항목 타입

### 1.1 `NodeItem` (목록 행 = 스트림 upsert 단위)

```ts
interface NodeItem {
  name: string;                         // 노드 이름 원문. kOps에서는 두 형태가 모두 나온다:
                                        //   ① 도메인 형태 `ip-10-0-12-34.ap-northeast-2.compute.internal`
                                        //   ② EC2 인스턴스 ID `i-0a1b2c3d4e5f67890` (쿠버네티스 1.23+ / 외부 AWS CCM. kops-support 명세 F10)
                                        // 짧게 보이기는 화면 책임. 어드바이저 스냅샷에서는 두 형태 모두 가명 처리된다(architecture-advisor.md B.2)
  status: StatusInfo;
  role: 'worker' | 'control_plane';     // 라벨 node-role.kubernetes.io/control-plane 또는 (구) node-role.kubernetes.io/master 가 있으면 control_plane, 없으면 worker
  instanceType: string | null;          // node.kubernetes.io/instance-type
  zone: string | null;                  // topology.kubernetes.io/zone
  nodeGroup: string | null;             // kops.k8s.io/instancegroup (kOps InstanceGroup 이름). 이 키 하나만 본다. 없으면 null
  capacityType: 'on_demand' | 'spot' | null;  // 1순위 EC2 InstanceLifecycle(비용 모듈), 보조로 라벨 node.kubernetes.io/instance-lifecycle. 모르면 null
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
- `role`은 **모든 노드 응답에 항상 있다**(목록·상세·SSE upsert·컨트롤 플레인 섹션). 화면은 라벨을 다시 해석하지 않는다.
- `role: 'control_plane'`인 노드는 **워커 기준 집계에서 빠진다**: 개요 `areas.nodes`, 요약 띠 노드 수, `GET /api/cluster/nodes` 기본 목록, `GET /api/cluster/metrics` 클러스터 합계, `metrics/series?target=cluster`, 비용 네임스페이스 배분(`aws-cost.md` 3.2). 마스터는 컨트롤 플레인 영역(3.3)에서 따로 센다.
- `nodeGroup`은 kOps InstanceGroup 이름을 **원문 그대로** 준다(예: `nodes-ap-northeast-2a`, `control-plane-ap-northeast-2a`, `spot-batch`). **목표 대수(desired/min/max)·스케일 여력은 주지 않는다** — `autoscaling:DescribeAutoScalingGroups` 권한을 추가하지 않기 때문이다(kops-support 명세 D2). 화면 툴팁에 "실제로 붙어 있는 노드만 셉니다"를 적는다.

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
  logHref: string | null;               // (2026-09-25, logs) 소속 파드 선택기가 붙은 로그 화면 링크 `/logs?namespace=…&workload=<key>&follow=1`.
                                        //   LOGS_ENABLED=false·차단 네임스페이스면 null. 규칙은 logs.md 11.4
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
  logHref: string | null;               // (2026-09-25, logs) 이 파드의 로그 화면 링크 `/logs?namespace=…&pod=…&follow=1`.
                                        //   파드 목록 행·파드 상세·워크로드 상세 소속 파드·DB 상세 DB 파드가 같은 값을 쓴다.
                                        //   LOGS_ENABLED=false·차단 네임스페이스면 null → 화면은 링크·로그 섹션을 그리지 않는다 (logs.md 11.4)
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
  logHref: string | null;               // (2026-09-25, logs) 대상이 파드일 때만 `/logs?namespace=…&pod=…&at=<lastSeenAt>` (follow 없음 — "지난 시점").
                                        //   대상이 파드가 아니거나 LOGS_ENABLED=false·차단 네임스페이스면 null. 파드가 이미 사라져도 준다 (logs.md 11.4·2.2.1)
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

### 1.6 `ControlPlaneComponent` (마스터의 static pod 미러 파드)

```ts
// 필수 구성요소 5종. 이 순서로 화면 매트릭스의 열을 만든다.
type ControlPlaneComponentKind =
  | 'kube-apiserver'
  | 'kube-controller-manager'
  | 'kube-scheduler'
  | 'etcd-manager-main'
  | 'etcd-manager-events';

// 매트릭스 한 칸의 상태. **서버가 확정해서 내려보낸다.** 화면은 조건을 조합하지 않고 이 값으로 모양을 고른다.
// (디자인 `cluster-status.md` 3.2.3 "셀 상태별 모습" 7가지와 1:1로 대응한다)
type ControlPlaneCellState =
  | 'ok'             // Ready
  | 'warning'        // 주의 (재시작 1~2회, 생성 중 2분 이상 등)
  | 'critical'       // 장애 (CrashLoopBackOff, 재시작 3회 이상 등)
  | 'not_reporting'  // 마스터가 NotReady/Unknown → 이 칸의 상태를 믿을 수 없음 (빗금)
  | 'unknown'        // 그 밖의 알 수 없음 (kube 출처 문제 등)
  | 'missing'        // 필수 구성요소인데 파드가 보이지 않음 (점선)
  | 'stale';         // kube 출처 stale — 마지막 값 유지

interface ControlPlaneComponent {
  kind: ControlPlaneComponentKind;
  nodeName: string;                     // 어느 마스터의 것인지 (NodeItem.name)
  podKey: string | null;                // "kube-system/kube-apiserver-i-0a1b…". 파드가 아예 없으면 null
  cellState: ControlPlaneCellState;     // 위 7가지 중 하나. **절대 null이 아니고 칸이 비지 않는다**
  cellText: string;                     // 셀 1행 문구 (서버 문장). 예: "Ready" / "주의" / "장애" / "노드 미보고" / "없음" / "데이터 오래됨"
  cellDetail: string | null;            // 셀 2행 보조 문구 (서버 문장, **짧은 쪽**). 예: "CrashLoopBackOff · 재시작 4회", "마지막 보고 04:58". 정상이면 null
  cellTooltip: string | null;           // 잘리면 안 되는 전체 문장(서버 문장). 화면은 셀에 title/툴팁으로 붙인다. 정상이면 null
                                        // (셀 최소 폭 140px에서 cellDetail이 말줄임될 수 있다. **툴팁 없이 자르지 않는다** — 잘리는 문자열이 곧 장애 사유다)
  status: StatusInfo;                   // 3.2.2 기준. cellState와 등급이 어긋나지 않는다(아래 대응표)
  ready: boolean | null;                // 컨테이너 Ready. 파드가 없거나 믿을 수 없는 상태면 null
  containers: { ready: number; total: number } | null;
  waitingReason: string | null;         // CrashLoopBackOff 등
  restarts: { last1h: number; last24h: number; total: number; observedSec: number };
  lastTermination: { reason: string | null; exitCode: number | null; finishedAt: string | null } | null;
  startedAt: string | null;
  lastReportedAt: string | null;        // 이 파드 상태를 마지막으로 받은 시각. not_reporting·stale일 때 화면에 함께 보인다
  clickable: boolean;                   // 셀 클릭으로 파드 상세로 갈 수 있는가. not_reporting·missing이면 false
  logHref: string | null;               // (2026-09-25, logs) 이 미러 파드의 로그 화면 링크. 디자인 ComponentMatrix.cells[].logHref
                                        //   podKey가 없거나(missing) LOGS_ENABLED=false·차단 네임스페이스면 null. `follow=1`이 붙는다(PM 결정 D3)
                                        //   **REST와 SSE(cluster.snapshot·cluster.controlplane.updated)가 같은 값이다** (5b 결함 수정)
}
```

**`cellState` ↔ `status.status` 대응** (서버가 맞춰서 내려보낸다. 화면이 변환하지 않는다)

| `cellState` | `status.status` | 언제 | `cellText` | `cellDetail` 예 |
|---|---|---|---|---|
| `ok` | `ok` | 파드 Ready | `Ready` | `null` |
| `warning` | `warning` | 재시작 1~2회, 생성 중 2분 이상, Ready 아님 2분 이상(1대뿐) | `주의` | `재시작 2회 (1시간)` |
| `critical` | `critical` | `CrashLoopBackOff` 등, 재시작 3회 이상, 과반 마스터에서 Ready 아님 | `장애` | `CrashLoopBackOff · 재시작 4회` |
| `not_reporting` | `unknown` | **그 마스터가 NotReady/Unknown** (`masters.items[].reporting: false`) | `노드 미보고` | `마지막 보고 04:58` |
| `unknown` | `unknown` | kube 출처가 `syncing`/`unavailable` 등 그 밖의 이유 | `알 수 없음` | 서버 사유 |
| `missing` | `warning` 또는 `critical` | 필수 구성요소인데 파드가 없음(개수 기준은 9.1) | `없음` | `필수 구성요소가 보이지 않습니다` |
| `stale` | (마지막 판단 유지) + `status.stale: true` | kube 출처 stale | `데이터 오래됨` | `14:02:10 기준` |

- **칸은 절대 비지 않는다**(디자이너 요청 1). 파드가 없으면 `missing`, 마스터가 보고를 멈췄으면 `not_reporting`이다. **"값이 없음 = 빈 칸"으로 처리하면 장애가 정상으로 보이므로** 서버가 두 경우를 구분해 채운다.
- `not_reporting`이 `missing`보다 **우선**한다. 마스터가 보고를 멈추면 파드가 보이든 안 보이든 그 마스터의 5칸은 전부 `not_reporting`이다(파드가 안 보이는 것이 진짜 삭제인지 보고 중단인지 알 수 없기 때문).
- **식별은 2중 조건**(이름만으로 하지 않는다. kops-support 명세 3.2.2): ① 파드가 `role: 'control_plane'` 노드에 있고 네임스페이스가 `kube-system`, ② 파드 이름이 위 5종 접두어 중 하나로 시작.
- 백엔드는 미러 파드 판별에 `kubernetes.io/config.mirror` 어노테이션을 **내부 판단용으로만** 쓸 수 있다. **어노테이션 원문은 응답에 넣지 않는다**(`common.md` 1.4).
- `logHref`는 **`logs` 기능이 만드는 링크**이고 RBAC를 늘리지 않는다(미러 파드도 같은 `pods/log` `get`으로 읽는다). 로그 화면의 상시 안내(자기참조·민감도)는 `logs.md` 11.3이 준다. 이 필드 외에 컨트롤 플레인 응답의 모양은 바뀌지 않는다.
- **필수 5종 외**의 마스터 `kube-system` 파드(`kops-controller`, `kops-channels`, `kube-apiserver-healthcheck`, CNI·kube-proxy DaemonSet 등)는 `others[]`(3.3)에 이름·상태만 담고 **필수 판정에 넣지 않는다**. 있어도 없어도 정상이다(명세 U5 — kOps 1.36+의 추가 static pod 목록이 확정되지 않았으므로 목록을 고정하지 않는다).
- **`lastReportedAt`이 중요한 이유**: 마스터 노드가 NotReady면 kubelet이 미러 파드 상태를 더 이상 갱신하지 않아 파드가 `Running`인 채로 남는다. 서버는 그 마스터의 구성요소 5종을 전부 `status.status: "unknown"` + `CONTROL_PLANE_NODE_NOT_REPORTING`으로 바꾸고 이 시각을 함께 준다. 화면이 "정상"으로 오해하지 않게 하기 위한 것이다.

---

## 2. 개요·요약

### 2.1 `GET /api/overview`

셸(사이드바 상태, 상단바 클러스터 정보)과 개요 화면 상단(요약 띠, **카드 6개**, 지금 확인할 항목, 비용·어드바이저 요약 카드)에 필요한 것을 한 번에 준다. `overview.snapshot` payload와 같다.

카드 6개 = 노드(**워커**) · 워크로드 · 파드 · 이벤트 · DB · **컨트롤 플레인**(신설, PM 결정 Q1).

**응답 200**
```json
{
  "dataSource": "mock",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "cluster": {
    "name": "prod.k8s.example.com",
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
    "controlPlane": { "status": { "status": "warning", "reasons": [ { "code": "CONTROL_PLANE_MASTER_NOT_READY", "text": "마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실", "status": "warning" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:59:40.000Z", "stale": false },
                   "found": true,
                   "masters": { "ready": 2, "total": 3 },
                   "components": { "ready": 10, "total": 15 },
                   "quorum": { "state": "at_risk", "requiredReady": 2, "readyMasters": 2, "basis": "master_node_count" },
                   "haExpected": true,
                   "problems": [ { "ref": { "kind": "Node", "namespace": null, "name": "i-0c3d4e5f6a7b8c9d0" }, "status": "warning", "reason": "NotReady 4분 · 구성요소 5종 알 수 없음" } ] },
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
        "area": "control_plane",
        "ref": { "kind": "Node", "namespace": null, "name": "i-0c3d4e5f6a7b8c9d0" },
        "status": "warning",
        "reason": { "code": "CONTROL_PLANE_MASTER_NOT_READY", "text": "마스터 NotReady 4분 · 1대 더 잃으면 쿼럼 상실", "status": "warning" },
        "statusChangedAt": "2026-09-19T04:59:40.000Z"
      },
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
| `cluster` | 상단바·요약 띠 부제. `connected: false`면 `name`·`version`은 null, 상단바 `클러스터 연결 없음`. `name`은 env **`K8S_CLUSTER_NAME`**(없으면 kubeconfig 현재 context의 cluster 이름), `version`은 **쿠버네티스 API 서버 `/version`**(AWS를 호출하지 않는다), `region`은 `AWS_REGION` 또는 노드 zone에서 추론. kOps 클러스터 이름은 보통 FQDN(`prod.k8s.example.com`)이라 길다 → 화면은 가운데 말줄임 + 툴팁 전체(디자인 `shell.md`) |
| `overall` | 요약 띠 전체 상태 = `areas.*.status` 최악 (명세 3.1). **`areas.controlPlane`도 포함**한다. **워커** 0대 또는 워커 전원 NotReady면 critical(마스터는 이 판단에 넣지 않는다 — 9절 `CLUSTER_NO_WORKER_NODES`) |
| `areas.nodes` | **워커 노드만**. `ready`/`total`이 워커 기준이다(마스터 3대 + 워커 6대면 `5/6`이 아니라 워커 기준 값). 요약 띠 부제에 `· 컨트롤 플레인 3/3`을 따로 적는다 |
| `areas.controlPlane` | 컨트롤 플레인 영역(신설). `masters.ready/total`·`components.ready/total`이 카드의 `마스터 3/3 · 구성요소 15/15` 숫자다. `components`는 **필수 5종만** 센다(기타 구성요소 제외). `found: false`면 마스터 라벨 노드가 0대(`CONTROL_PLANE_NOT_FOUND`) → `status.status: "unknown"`, `masters`·`components`는 0, `quorum.state: "unknown"`. 상세는 3.3 |
| `areas.controlPlane.quorum` | `state`: `ok`(Ready > 전체의 절반) \| `at_risk`(1대 잃으면 상실) \| `lost`(Ready ≤ 절반) \| `unknown`. `basis`는 항상 `"master_node_count"` — **etcd 멤버 목록이 아니라 마스터 노드 대수 기준 근사**다(etcd 멤버 조회는 RBAC 밖). 화면 툴팁에 이 한계를 적는다 |
| `areas.controlPlane.haExpected` | env `CONTROL_PLANE_HA_EXPECTED`(기본 `true`). `false`면 "마스터 대수" 항목을 **판단하지 않고 표시만** 한다(단일 마스터가 상시 노란색이 되지 않게). 어드바이저 사전 점검 `R-CP-HA`는 이 값과 무관하게 계속 지적한다 |
| `areas.*.problems` | 카드 안 문제 항목, **최대 3개**(critical → warning → 최근 변경 순) |
| `areas.pods.counts` | 기본 목록 기준(완료 파드 제외) |
| `areas.events` | `warnings15m`: 최근 15분 Warning 이벤트 수(`count` 합이 아니라 이벤트 객체 수), `severe15m`: 심각 reason 수 |
| `areas.db.headline` | DB 카드 primary 값: 가장 나쁜 지표(없으면 연결 사용률) |
| `attention` | "지금 확인할 항목": critical·warning 항목, critical → warning, 같은 등급은 `statusChangedAt` 최근 순. **최대 8개**, `total`은 전체 수. 전체는 2.3 |
| `nav` | 사이드바 상태 점 (`shell.md` 3.1). `advisorBusy`: 분석 진행 중 스피너. `nav.stale.*`: 영역 출처가 stale. **컨트롤 플레인 메뉴는 신설하지 않는다**(PM 결정 Q2) — `nav.nodes` = `areas.nodes.status`와 `areas.controlPlane.status` 중 **최악**이고, `nav.stale.nodes`는 둘 중 하나라도 stale이면 true. **사이드바에 늘어나는 `알림`·`로그`·`설정` 3개는 `nav`에 키를 추가하지 않는다**(아래) |
| `cost`, `advisor` | 개요의 요약 카드용 요약. 상세 형식은 `aws-cost.md` 2.1, `architecture-advisor.md` A.2. 해당 기능이 실패해도 이 응답은 200이고 그 블록만 `available: false` + `status.status: "unknown"` |
| `advisor.status` | 어드바이저 영역 상태 `StatusInfo`(사전 점검 결과 기준, `architecture-advisor.md` A.2 `precheck.status`와 같은 값). `nav.advisor`·`nav.stale.advisor`의 근거. 요약을 못 만들면 `unknown` |

- 오류: 없음(항상 200). 출처가 없으면 해당 영역 unknown.

**`nav`에 `알림`·`로그`·`설정` 키를 추가하지 않는다** (2026-09-25, `alerts`·`logs` 기능)

사이드바에 메뉴 3개가 늘어나지만(PM 결정 Q6) **`nav` 객체는 그대로다.** 근거는 `docs/specs/kops-support.md` 3.1 "사이드바 합산 규칙과 새 기능들의 관계":

- **셋 다 상태 점이 없다.** 알림은 상태의 **파생**이라 점을 달면 같은 정보가 두 번 보이고(`alerts` 3.3.1 — 숫자 배지만 쓴다), 로그는 **내용으로 상태를 판단하지 않으며**(`logs` 3.0, `k8s-snapshot` 드리프트를 메뉴 상태에 넣지 않은 것과 같은 판단), `설정`은 상태가 없다.
- 따라서 `nav` 키·합산 규칙(`nav.nodes` = 워커와 컨트롤 플레인의 최악)에 **아무 영향이 없다.**
- `알림` 메뉴의 숫자 배지는 **SSE 토픽 `alerts`의 `badge`**(`alerts.md` 2.3)에서 온다. 이 응답이 아니다.
- **알림에서는 컨트롤 플레인을 분리한다**(`area:controlPlane` 키). 사이드바는 합산하지만 알림은 "무슨 일이 일어났나"라 단위가 다르다 — 마스터 장애가 워커 소음에 묻히면 안 된다(`alerts` 3.1 근거 7). 두 규칙은 충돌하지 않는다.

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
`area`: `node` | `control_plane` | `workload` | `pod` | `event` | `db` | `pvc` | `metrics`.
- `area: 'control_plane'`의 `ref.kind`는 마스터 노드 문제면 `Node`, 구성요소 파드 문제면 `Pod`(`namespace: "kube-system"`)다. 화면은 이 항목을 눌렀을 때 **노드 화면의 컨트롤 플레인 섹션**으로 보낸다(전용 화면은 없다).
- 컨트롤 플레인 항목은 **"시스템 네임스페이스 숨기기" 필터와 무관하게 항상 나온다**(구성요소 파드가 `kube-system`이라는 이유로 가려지면 안 되기 때문).

---

## 3. 노드

### 3.1 `GET /api/cluster/nodes`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `role` | `worker` \| `control_plane` \| `all` (**기본 `worker`**) | PM 결정 Q4. 기본값이 `worker`라 "총 N대"가 항상 워커 기준이고 개요·비용 집계와 숫자가 일치한다. 그 밖의 값은 400 |
| `status` | `ok,warning,critical,unknown` 중 여러 개 | |
| `nodeGroup` | 문자열 여러 개(쉼표) | kOps InstanceGroup 이름 |
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
  "role": "worker",
  "total": 6, "filteredTotal": 6, "offset": 0, "limit": null,
  "counts": { "all": 6, "critical": 1, "warning": 1, "ok": 4, "unknown": 0 },
  "roleCounts": { "worker": 6, "control_plane": 3, "all": 9 },
  "facets": { "nodeGroups": ["nodes-ap-northeast-2a", "spot-batch"], "zones": ["ap-northeast-2a", "ap-northeast-2c"], "capacityTypes": ["on_demand", "spot"], "roles": ["worker", "control_plane"] },
  "areaStatus": { "status": "critical", "reasons": [ { "code": "NODE_NOT_READY", "text": "ip-10-0-12-34 NotReady 3분", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:59:40.000Z", "stale": false },
  "thresholds": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 }, "requests": { "warnPct": 85, "critPct": null }, "pods": { "warnPct": 90, "critPct": 100 } },
  "metricsAvailable": true,
  "items": [
    {
      "name": "ip-10-0-12-34.ap-northeast-2.compute.internal",
      "status": { "status": "critical", "reasons": [ { "code": "NODE_NOT_READY", "text": "NotReady 3분", "status": "critical" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:59:40.000Z", "stale": false },
      "role": "worker",
      "instanceType": "m6i.large",
      "zone": "ap-northeast-2a",
      "nodeGroup": "nodes-ap-northeast-2a",
      "capacityType": "on_demand",
      "architecture": "amd64",
      "kubeletVersion": "v1.30.2",
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
**`role`과 `counts`·`facets`·`total`의 일관성 규칙** (AC-KOPS11. 화면이 숫자를 다시 계산하지 않아도 되게 서버가 맞춘다)

| 필드 | `role` 적용 여부 | 규칙 |
|---|---|---|
| `role` | — | 실제로 적용한 값을 그대로 돌려준다(기본값 `worker`도 명시). 화면 제목·빈 상태 문구의 근거 |
| `items` | 적용 | `role` 필터를 통과한 노드만 |
| `total` | **적용** | `role` 필터를 적용하고 나머지 필터는 적용하지 않은 수. `role=worker`면 워커 대수, `role=all`이면 전체 대수 |
| `filteredTotal` | 적용 | `role` + 나머지 필터를 모두 적용한 수 (페이지네이션 대상 수) |
| `counts` | **적용** | `role` + `status`를 **제외한** 나머지 필터 기준. `counts.all` = 그 조건의 전체, `critical`+`warning`+`ok`+`unknown` = `counts.all` |
| `roleCounts` | **적용하지 않음** | `{ worker, control_plane, all }`(`all` = 두 값의 합). 다른 필터도 적용하지 않은 **클러스터 전체** 대수다. 디자인의 역할 전환 탭 `[역할: 워커 6 | 컨트롤 플레인 3 | 전체 9]`와 "컨트롤 플레인 N대 보기" 링크가 이 값을 그대로 쓴다(화면이 더하지 않는다) |
| `facets` | 적용 | 현재 `role` 안에 실제로 존재하는 값만. `role=worker`면 `facets.nodeGroups`에 `control-plane-*` InstanceGroup이 **나오지 않는다** |
| `facets.roles` | 적용하지 않음 | 클러스터에 실제로 존재하는 역할 값. 마스터가 0대면 `["worker"]` |
| `areaStatus` | 적용 | `role=worker`·`all`이면 `areas.nodes`(워커 영역), `role=control_plane`이면 `areas.controlPlane`의 `status`. `role=all`에서도 워커 영역 상태를 준다(합성하지 않는다 — 합성 값은 `nav.nodes`뿐) |

- `counts`: `status` 필터를 **제외한** 나머지 필터를 적용한 개수(SegmentedControl 숫자). `facets`: 필터 드롭다운 후보(현재 `role` 기준).
- `metricsAvailable: false`면 모든 `usage`가 null, 화면은 CPU·메모리 열 `—`. kOps는 metrics-server가 기본 설치가 아니므로 **이 값이 `false`인 것이 정상 상태**다(오류가 아니다).
- 마스터가 0대여도 이 엔드포인트는 200이다(`role=control_plane`이면 `items: []`, `total: 0`). 컨트롤 플레인 "못 찾음" 판단은 3.3과 `areas.controlPlane`에서 한다.
- 오류: 400 `VALIDATION_FAILED`(`role` 값 오류 포함).

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
- 마스터 노드도 이 엔드포인트로 조회한다(`role: "control_plane"`). 별도 상세 경로를 만들지 않는다.

### 3.3 `GET /api/cluster/control-plane` (컨트롤 플레인 상세)

노드 화면 **상단 섹션**(마스터 표 + 구성요소 매트릭스)과 개요 컨트롤 플레인 카드의 상세. `cluster.controlplane.updated` payload와 같다.

쿼리 없음. **조회 전용이고 새 RBAC를 쓰지 않는다** — 이미 watch 중인 `nodes`·`pods` 캐시에서만 만든다(kops-support 명세 D3).

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "found": true,
  "notFoundReason": null,
  "status": { "status": "warning", "reasons": [ { "code": "CONTROL_PLANE_MASTER_NOT_READY", "text": "마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실", "status": "warning" } ], "updatedAt": "2026-09-19T05:02:10.000Z", "statusChangedAt": "2026-09-19T04:59:40.000Z", "stale": false },
  "headline": "마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실",
  "masters": {
    "ready": 2,
    "total": 3,
    "haExpected": true,
    "haStatus": "ok",
    "quorum": { "state": "at_risk", "requiredReady": 2, "readyMasters": 2, "basis": "master_node_count" },
    "zones": [ { "zone": "ap-northeast-2a", "count": 1 }, { "zone": "ap-northeast-2b", "count": 1 }, { "zone": "ap-northeast-2c", "count": 1 } ],
    "zoneSpread": "spread",
    "totals": {
      "cpu": { "allocatableMillicores": 5790, "usageMillicores": 1160, "usagePct": 20.0, "requestsMillicores": 1350, "requestsPct": 23.3 },
      "memory": { "allocatableBytes": 11902944256, "usageBytes": 4284460032, "usagePct": 36.0, "requestsBytes": 3221225472, "requestsPct": 27.1 },
      "available": true
    },
    "items": [
      {
        "node": { "...": "NodeItem 전체 (role: \"control_plane\")" },
        "reporting": true,
        "lastReportedAt": "2026-09-19T05:02:05.000Z",
        "components": { "ready": 5, "total": 5, "worst": "ok" },
        "workerPodCount": 0,
        "reasonText": null
      },
      {
        "node": { "...": "NodeItem (name: \"i-0c3d4e5f6a7b8c9d0\", ready.value: \"Unknown\")" },
        "reporting": false,
        "lastReportedAt": "2026-09-19T04:58:00.000Z",
        "components": { "ready": 0, "total": 5, "worst": "unknown" },
        "workerPodCount": 0,
        "reasonText": "NotReady 4분"
      }
    ]
  },
  "components": {
    "requiredKinds": ["kube-apiserver", "kube-controller-manager", "kube-scheduler", "etcd-manager-main", "etcd-manager-events"],
    "ready": 10,
    "total": 15,
    "cellCounts": { "total": 15, "ok": 10, "warning": 0, "critical": 0, "notReporting": 5, "unknown": 0, "missing": 0, "stale": 0, "unknownTotal": 5 },
    "summaryText": "필수 15칸 · 정상 10 · 주의 0 · 장애 0 · 알 수 없음 5",
    "columns": [
      { "nodeName": "i-0a1b2c3d4e5f67890", "reporting": true,  "lastReportedAt": "2026-09-19T05:02:05.000Z", "worst": "ok",      "reason": null },
      { "nodeName": "i-0b2c3d4e5f6789012", "reporting": true,  "lastReportedAt": "2026-09-19T05:02:05.000Z", "worst": "ok",      "reason": null },
      { "nodeName": "i-0c3d4e5f6a7b8c9d0", "reporting": false, "lastReportedAt": "2026-09-19T04:58:00.000Z", "worst": "unknown", "reason": "NotReady 4분" }
    ],
    "byKind": [
      { "kind": "kube-apiserver",          "ready": 2, "expected": 3, "status": "warning" },
      { "kind": "kube-controller-manager", "ready": 2, "expected": 3, "status": "warning" },
      { "kind": "kube-scheduler",          "ready": 2, "expected": 3, "status": "warning" },
      { "kind": "etcd-manager-main",       "ready": 2, "expected": 3, "status": "warning" },
      { "kind": "etcd-manager-events",     "ready": 2, "expected": 3, "status": "warning" }
    ],
    "items": [ { "...": "ControlPlaneComponent (마스터 × 5종. 3대면 15개. 없는 칸도 present: false로 포함)" } ]
  },
  "others": [
    { "name": "kops-controller-4x9qd", "nodeName": "i-0a1b2c3d4e5f67890", "status": "ok", "ready": true, "restarts1h": 0 },
    { "name": "kube-proxy-i-0a1b2c3d4e5f67890", "nodeName": "i-0a1b2c3d4e5f67890", "status": "ok", "ready": true, "restarts1h": 0 }
  ],
  "thresholds": { "restarts1h": { "warn": 1, "crit": 3 }, "componentNotReadySec": 120, "masterNotReadySec": 60 },
  "limits": {
    "etcdInternalMetrics": false,
    "notes": [
      { "code": "CP_APISERVER_SELF_DEPENDENCY", "text": "apiserver가 모두 중단되면 이 대시보드도 클러스터를 조회할 수 없어 '연결 끊김'으로 보입니다." },
      { "code": "CP_NO_ETCD_INTERNALS", "text": "etcd 내부 지표(fsync·리더 변경·DB 크기·멤버 목록)는 표시하지 않습니다." },
      { "code": "CP_QUORUM_APPROX", "text": "쿼럼은 마스터 노드 수 기준 근사입니다(etcd 멤버 목록은 조회하지 않습니다)." }
    ]
  }
}
```

| 필드 | 설명 |
|---|---|
| `found` / `notFoundReason` | 마스터 라벨(`node-role.kubernetes.io/control-plane`, 구 `…/master`) 노드가 **0대**면 `found: false`, `notFoundReason: { "code": "CONTROL_PLANE_NOT_FOUND", "text": "컨트롤 플레인 노드를 찾지 못했습니다" }`, `status.status: "unknown"`, `masters.items`·`components.items`는 빈 배열. **오류가 아니다**(AC-KOPS17). 워커 집계와 나머지 화면은 정상 동작한다 |
| `masters.haStatus` | `ok`(3대 이상 홀수) \| `single`(1대) \| `even`(짝수 2·4대) \| `unknown`. `haExpected: false`면 이 값이 `single`·`even`이어도 **`status`에 반영하지 않는다**(표시만) |
| `masters.quorum.state` | `ok` \| `at_risk`(1대 더 잃으면 상실) \| `lost`(Ready ≤ 전체의 절반) \| `unknown`. `basis`는 항상 `"master_node_count"`(근사) |
| `masters.zoneSpread` | `spread`(2개 이상 AZ) \| `single_zone`(마스터 2대 이상이 모두 같은 AZ → 주의) \| `unknown`(zone 라벨 없음) |
| `masters.items[].reporting` | 그 마스터의 kubelet이 상태를 보고 중인가. `false`면 그 마스터의 구성요소 5종이 전부 `unknown` + `CONTROL_PLANE_NODE_NOT_REPORTING`이고 `lastReportedAt`이 화면에 함께 보인다(AC-KOPS21) |
| `headline` | **섹션·카드에 그대로 쓰는 대표 사유 한 줄.** 서버가 만든 문장이다(= `status.reasons[0].text`와 같은 값). **화면은 문장을 조립하지 않는다.** `found: false`면 `"컨트롤 플레인 노드를 찾을 수 없습니다"` |
| `masters.totals` | **마스터 합계 블록**(디자인 3.2.1 "마스터 합계 2행"). `GET /api/cluster/metrics`의 `controlPlane` 블록과 **같은 값**이다(두 곳에서 같은 숫자를 보게 하려고 여기에도 넣는다). metrics-server가 없으면 `available: false` + 사용량 필드 `null`. **상태 배지는 없다** — 마스터 사용률 판단은 마스터 표의 노드 단위 상태에서 한다 |
| `masters.items[].reasonText` | 그 마스터 행의 "사유" 열에 그대로 찍는 서버 문장(`NotReady 4분`, `모두 같은 AZ`). 없으면 `null` |
| `masters.items[].components.worst` | 그 마스터(= 매트릭스의 한 **열**)의 최악 칸 상태. 열 머리 아이콘 판단에 쓴다 |
| `masters.items[].workerPodCount` | 그 마스터에 올라간 **컨트롤 플레인 구성요소가 아닌** 파드 수. **`0`(없음)과 `null`(세지 못함 — 파드 캐시가 syncing·unavailable)을 구분한다**(디자이너 요청 4). `0`이거나 `null`이면 경고를 띄우지 않는다. 1 이상이면 화면에 경고 한 줄("컨트롤 플레인 노드에 워커 파드가 N개 있습니다 — 용량·비용 배분에 반영되지 않습니다"). PM 결정 Q6에 따라 그 구성의 정밀한 배분·용량 계산은 범위 밖 |
| `components.byKind[].expected` | 보고 중인 마스터 수 기준 기대 개수. `reporting: false`인 마스터도 `expected`에는 센다(그래야 "2/3"가 보인다) |
| `components.cellCounts` | 매트릭스 칸을 `ControlPlaneCellState`별로 센 값. `total` = 마스터 수 × 5이고 7개 상태 값의 합과 같다. **`unknownTotal` = `notReporting` + `unknown` + `missing`**(PM 결정) — 요약 문장의 "알 수 없음" 숫자이고, 매트릭스 칸에서는 셋을 그대로 구분해 보여 준다. 사용자에게 "없음"과 "모름"은 둘 다 "확인 안 됨"이다 |
| `components.columns` | 매트릭스 **열(마스터) 머리**에 필요한 것만 모은 배열(`masters.items`와 같은 순서·길이). `reason`은 **마스터 표의 `사유` 열과 같은 값**(`masters.items[].reasonText`)이고 열 머리 툴팁에 그대로 쓴다. 화면이 두 배열을 이어 붙이지 않아도 되게 한다 |
| `components.summaryText` | 매트릭스 위 한 줄 요약(디자인 3.2.3). **서버 문장**이다. 화면은 숫자를 다시 세거나 문장을 만들지 않는다 |
| `components.items` | 마스터 × 5종 **전체 칸**(마스터 3대면 정확히 15개). 파드가 없는 칸도 `cellState: "missing"`으로, 마스터가 보고를 멈춘 칸도 `"not_reporting"`으로 **반드시 들어간다**. 화면이 3×5 매트릭스를 빈 칸 없이 그대로 그릴 수 있다 |
| `others` | 필수 5종이 아닌 마스터의 `kube-system` 파드. **필수 판정에 넣지 않는다**(명세 U5). 목록에만 표시 |
| `limits` | 화면에 상시 보여야 하는 한계 안내(AC-KOPS26). `etcdInternalMetrics`는 항상 `false`(Prometheus 심층 지표는 범위 밖) |

- **화면은 상태를 계산하지 않는다**(기존 원칙 유지, 디자이너 확인 사항). 쿼럼(`quorum.state`)·HA(`haStatus`)·AZ 편중(`zoneSpread`)·매트릭스 칸(`cellState`·`cellText`·`cellDetail`)·대표 사유(`headline`)·요약 문장(`summaryText`)이 **전부 서버 값**이다. 화면이 조건을 조합해야 하는 필드는 이 응답에 없다.
- **"시스템 네임스페이스 숨기기" 필터와 무관하게** 이 섹션은 항상 보인다(AC-KOPS19). 구성요소 파드는 파드 목록에서는 `kube-system`이라 기본 숨김 대상이지만, 여기서는 가려지지 않는다.
- 갱신: **기존 nodes·pods informer를 그대로 쓴다.** 새 informer·새 주기 조회·새 SSE 토픽을 만들지 않는다(명세 4절). 변화는 3초 이내, 지속 조건 재평가는 기존 15초 루프.
- 오류: 없음(항상 200). kube 출처가 `not_configured`/`unavailable`(`KUBE_AUTH_FAILED` 포함)이면 `found: false` + `notFoundReason.code`가 `SOURCE_NOT_CONFIGURED`/`SOURCE_UNAVAILABLE`이고 `status.status: "unknown"`. **mock 값으로 대체하지 않는다**(`common.md` 2.4).

---

## 4. 워크로드

### 4.1 `GET /api/cluster/workloads`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `status` | 여러 개 | |
| `kind` | `Deployment,StatefulSet,DaemonSet` | |
| `namespace` | 여러 개 | |
| `hideSystem` | boolean (기본 false) | 시스템 네임스페이스 숨기기 (가정 A6 목록: env `SYSTEM_NAMESPACES`, 기본 `kube-system,kube-public,kube-node-lease`) |
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
- **컨트롤 플레인(3.3)에 새 RBAC가 필요하지 않다.** static pod 미러 파드는 `kube-system`의 보통 파드로 보이므로 이미 watch 중인 `pods`로 받고, 마스터 판별은 `nodes`의 레이블로 한다. `deploy/rbac.yaml`의 리소스·동사 목록은 **이번 전환으로 바뀌지 않는다**(AC-KOPS26). `secrets`는 계속 제외다.
- 컨트롤 플레인·노드그룹 판단에 쓰는 **AWS 호출은 추가되지 않는다.** 노드그룹은 노드 레이블(`kops.k8s.io/instancegroup`)로만 파악하고 `autoscaling:*`를 쓰지 않는다(D2).

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

**클러스터 합계(`cpu`·`memory`)는 워커 노드만 합산한다**(AC-KOPS12). 마스터는 `controlPlane` 블록으로 분리한다. 마스터를 섞으면 컨트롤 플레인의 낮은 사용률이 워커의 사용률을 희석해 판단이 왜곡되기 때문이다.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "available": true,
  "unavailableReason": null,
  "updatedAt": "2026-09-19T05:02:00.000Z",
  "scope": { "basis": "worker", "workerNodeCount": 6, "controlPlaneNodeCount": 3 },
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
  "controlPlane": {
    "available": true,
    "nodeCount": 3,
    "cpu": {
      "allocatableMillicores": 5790,
      "usageMillicores": 1160, "usagePct": 20.0,
      "requestsMillicores": 1350, "requestsPct": 23.3,
      "limitsMillicores": 0, "limitsPct": 0
    },
    "memory": {
      "allocatableBytes": 11902944256,
      "usageBytes": 4284460032, "usagePct": 36.0,
      "requestsBytes": 3221225472, "requestsPct": 27.1,
      "limitsBytes": 0, "limitsPct": 0
    }
  },
  "thresholds": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 } },
  "history": { "source": "in_memory", "maxRangeSec": 3600, "stepSec": 15, "observedSec": 3600 }
}
```
- `scope.basis`는 항상 `"worker"`다. 이 값은 화면이 "무엇의 합계인지"를 문구로 적기 위한 것이며, 다른 값으로 바뀌지 않는다(플랫폼 분기 없음).
- `controlPlane`: **마스터 노드만** 합산한 같은 모양의 블록. `GET /api/cluster/control-plane`의 `masters.totals`와 **같은 값**이다(두 화면에서 같은 숫자를 보게 한다). 상태 배지(`status`)를 두지 않는다 — 컨트롤 플레인 사용률 판단은 3.3의 마스터 표(노드 단위)에서 하고, 여기서는 숫자만 준다. 마스터가 0대면 `{ "available": false, "nodeCount": 0, "cpu": null, "memory": null }`.
- **`cpu`·`memory`와 `controlPlane`을 더해도 클러스터 전체가 아니다**(화면은 두 값을 합치지 않는다). 전체 용량이 필요하면 노드 목록 `role=all`을 쓴다.
- metrics-server 없음: `available: false`, `unavailableReason: { "code": "METRICS_API_UNAVAILABLE", "message": "metrics.k8s.io API 없음 (metrics-server 미설치)" }`, `cpu.status`·`memory.status`는 unknown, **사용량 필드(`usage*`)만 `null`**이고 `controlPlane`의 사용량도 `null`. requests·limits·allocatable은 kube 출처라 계속 준다. **HTTP 오류 아님.**
  - kOps는 metrics-server가 **기본 설치가 아니다**. 이 상태는 정상이며 노드·파드·워크로드·이벤트·DB·비용·배분은 모두 그대로 동작한다.
  - 화면 힌트 문구(디자인 `cluster-status.md`): `클러스터에 metrics-server가 설치돼 있지 않습니다. kOps 클러스터 설정의 spec.metricsServer.enabled를 켜면 표시됩니다.` — **클러스터를 바꾸는 명령(`kops edit cluster`·`kops update cluster`)은 문구에 넣지 않는다**(조회 전용 원칙, AC-KOPS39). 설정 항목 이름까지만 알려 준다.
  - 파급: 노드·클러스터·마스터의 CPU·메모리 판단이 `unknown`, 추이 그래프 없음, 어드바이저 `R-OVERREQ`·`R-NODEIDLE` "판단 보류". **비용과 PVC 사용률은 영향이 없다**(배분은 requests 기반, PVC는 Prometheus 또는 DB 크기 근사).
- `history.source`: `in_memory`(최근 1시간, API 재시작 시 초기화) | `prometheus`(24시간까지, 30초 해상도).

### 7.3 `GET /api/cluster/metrics/series`

| 쿼리 | 형식 | 설명 |
|---|---|---|
| `target` | `cluster` \| `node` \| `pod` (필수) | `cluster`는 **워커 기준**이다(7.2 `scope.basis`와 같은 범위, AC-KOPS13). `target=control_plane`은 **이번 범위에 없다**(컨트롤 플레인 추이 그래프는 다음 범위) — 요청하면 400 |
| `name` | 문자열 | node·pod일 때 필수 |
| `namespace` | 문자열 | pod일 때 필수 |
| `range` | `1h` \| `6h` \| `24h` (기본 `1h`) | `in_memory`면 `1h`만 허용 |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "target": { "kind": "Node", "namespace": null, "name": "ip-10-0-12-35.ap-northeast-2.compute.internal" },
  "scope": { "basis": "worker" },
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
- `scope`는 `target=cluster`일 때만 있고 값은 항상 `{ "basis": "worker" }`다. `target=node`·`pod`에는 없다.
- `target=cluster`의 `denominators`도 **워커 노드 allocatable 합계**다(마스터 제외). 마스터를 포함했을 때보다 사용률(%)이 달라지는 것을 mock에서 확인할 수 있다(AC-KOPS12).
- 마스터 노드를 `target=node`로 조회하는 것은 **가능하다**(노드 단위 추이). 막지 않는다.
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
| `cluster.controlplane.updated` | 컨트롤 플레인 상태·마스터 구성·구성요소 중 하나라도 바뀜 (1초 debounce) | `GET /api/cluster/control-plane` 응답에서 `dataSource`·`generatedAt`을 뺀 것 — **단일 객체 전체 교체** |
| `cluster.workload.upsert` / `.delete` | | `{ item: WorkloadItem }` / `{ key, kind, namespace, name }` |
| `cluster.pod.upsert` / `.delete` | | `{ item: PodItem }` / `{ key, namespace, name }` |
| `cluster.event.upsert` / `.delete` | Warning 이벤트 추가·반복 / 1시간 경과·삭제 | `{ item: EventItem }` / `{ key }` |
| `cluster.pvc.upsert` / `.delete` | | `{ item: PvcItem }` / `{ key, namespace, name }` |

`cluster.snapshot` payload:
```json
{
  "sync": { "initialSyncDone": true, "lastSyncAt": "2026-09-19T05:02:10.000Z" },
  "cluster": { "name": "prod.k8s.example.com", "version": "v1.30.4", "region": "ap-northeast-2", "connected": true },
  "areas": { "...": "overview.areas와 같음" },
  "restartObservation": { "observedSec": 1380, "fullWindow": false },
  "thresholds": { "node": { "cpu": { "warnPct": 70, "critPct": 90 }, "memory": { "warnPct": 75, "critPct": 90 }, "requests": { "warnPct": 85, "critPct": null }, "pods": { "warnPct": 90, "critPct": 100 } }, "pod": { "memoryLimit": { "warnPct": 80, "critPct": 95 }, "restarts1h": { "warn": 1, "crit": 3 } }, "pvc": { "usage": { "warnPct": 75, "critPct": 90 } } },
  "nodes": [ "NodeItem... (워커·마스터 전부. 화면이 role로 나눈다)" ],
  "controlPlane": { "...": "GET /api/cluster/control-plane 응답 (dataSource·generatedAt 제외)" },
  "workloads": [ "WorkloadItem..." ],
  "pods": [ "PodItem... (완료 파드 포함 전체. 화면이 showCompleted로 거름)" ],
  "events": [ "EventItem..." ],
  "pvcs": [ "PvcItem..." ]
}
```
- upsert는 **행 전체 교체**. 시간 경과 판단(Pending 10분, NotReady 60초 등)은 서버가 15초마다 재평가해 **상태가 바뀐 행만** upsert한다(경과 시간 숫자 자체는 화면이 `startedAt`·`since`로 계산하므로 매번 보내지 않는다).
- 메트릭 갱신으로 행의 `usage`만 바뀐 경우에는 `cluster.*.upsert`를 보내지 않고 `metrics.updated`에 담는다. 사용량 때문에 **상태가 바뀌면** 그 행을 upsert한다.
- **컨트롤 플레인 전용 토픽을 만들지 않는다**(명세 4절). `cluster.controlplane.updated`는 기존 `cluster` 토픽에 들어가고, 개요 카드용 `areas.controlPlane`은 기존 `overview.updated`로 나간다. 프론트는 새 구독을 추가하지 않고 `cluster` 토픽 핸들러에 이벤트 하나만 더 붙이면 된다.
- `cluster.snapshot`의 `nodes`에는 **마스터도 들어 있다**(`role`로 구분). 화면 노드 목록은 기본적으로 `role: 'worker'`만 그린다.
- 마스터 노드의 변경은 `cluster.node.upsert`와 `cluster.controlplane.updated`가 **둘 다** 나갈 수 있다. 화면은 노드 캐시와 컨트롤 플레인 객체를 각각 교체한다(서버가 값을 맞춰 보낸다).
- 구성요소 미러 파드의 변경은 `cluster.pod.upsert`(`kube-system` 파드로서)와 `cluster.controlplane.updated`가 둘 다 나간다.
- `cluster.controlplane.updated`는 **의미가 바뀐 경우에만** 나간다. 아래 값만 달라진 재평가는 보내지 않는다(15초마다 18KB 객체를 다시 보내지 않기 위해서다). 화면은 다음 이벤트·스냅샷에서 최신 값을 받는다.
  - 파생 시각: `updatedAt`·`generatedAt`·`lastReportedAt`·`statusChangedAt` (`statusChangedAt`은 같은 객체의 `status`가 바뀔 때만 움직이므로 변경은 `status`로 감지된다)
  - 관측 창: `observedSec` / 사용량: `usage`·`masters.totals` (사용량은 `metrics.updated`로 간다. 사용량 때문에 **상태가 바뀌면** 이 이벤트가 나간다)
- 출처 매핑(stale): `kube` → 이 토픽 전체.
- **`logHref`(2026-09-25, logs)**: `PodItem`·`WorkloadItem`·`EventItem`·`ControlPlaneComponent`의 `logHref`는 **평가 단계에서** 채워지므로 이 토픽의 값과 REST 값이 같다. 링크 가능 여부가 바뀌면(mock `logs=disabled` 전환) 서버가 `cluster.snapshot`을 다시 보낸다(`logs.md` 11.4).

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
| | `KUBE_AUTH_FAILED` | unknown | `인증 실패 — 토큰이 만료됐을 수 있습니다` (`common.md` 2.3. mock으로 대체하지 않는다) |
| | `SOURCE_SYNCING` | unknown | `최초 동기화 중` |
| 클러스터 | `CLUSTER_NO_WORKER_NODES` | critical | `워커 노드 없음` (마스터가 정상이어도 이 판단은 유지된다, AC-KOPS14) |
| | `CLUSTER_ALL_WORKERS_NOT_READY` | critical | `모든 워커 NotReady` |
| | ~~`CLUSTER_NO_NODES`~~ / ~~`CLUSTER_ALL_NODES_NOT_READY`~~ | — | 폐기. 마스터가 노드 목록에 함께 나오는 kOps에서는 "전체 노드" 기준이 맞지 않는다 → 위 두 코드로 대체 |
| | `CLUSTER_CPU_USAGE` / `CLUSTER_MEMORY_USAGE` | warning/critical | `메모리 사용률 78% (연속 3회)` (워커 기준) |
| 컨트롤 플레인 | `CONTROL_PLANE_NOT_FOUND` | unknown | `컨트롤 플레인 노드를 찾지 못했습니다` |
| | `CONTROL_PLANE_QUORUM_LOST` | critical | `쿼럼 상실 — 마스터 1/3 Ready` |
| | `CONTROL_PLANE_MASTER_NOT_READY` | warning/critical | `마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실` |
| | `CONTROL_PLANE_COMPONENT_DOWN` | critical | `kube-apiserver가 모든 마스터에서 Ready 아님` / `etcd-manager-main 과반 중단` |
| | `CONTROL_PLANE_COMPONENT_NOT_READY` | warning | `kube-scheduler Ready 아님 4분 (마스터 1대)` |
| | `CONTROL_PLANE_COMPONENT_WAITING` | warning/critical | `CrashLoopBackOff (kube-scheduler)` |
| | `CONTROL_PLANE_COMPONENT_RESTARTS` | warning/critical | `kube-scheduler 최근 1시간 재시작 4회` |
| | `CONTROL_PLANE_COMPONENT_OOM` | warning | `최근 1시간 OOMKilled 1회 (kube-apiserver)` |
| | `CONTROL_PLANE_COMPONENT_MISSING` | warning/critical | `마스터 1대에 필수 구성요소 4/5` |
| | `CONTROL_PLANE_NODE_NOT_REPORTING` | unknown | `노드 미보고 — 마지막 보고 04:58` (그 마스터의 구성요소 5종에 붙는다) |
| | `CONTROL_PLANE_NOT_HA` | warning | `마스터 1대 (HA 아님)` (`CONTROL_PLANE_HA_EXPECTED=false`면 등급 없이 표시만) |
| | `CONTROL_PLANE_EVEN_MASTERS` | warning | `마스터 2대 (짝수 — etcd 쿼럼상 이득 없음)` |
| | `CONTROL_PLANE_SINGLE_ZONE` | warning | `마스터 3대가 모두 ap-northeast-2a` |
| | `CONTROL_PLANE_CORDONED` | warning | `마스터 스케줄 제외 (cordon)` |
| | `CONTROL_PLANE_WORKER_PODS` | warning | `컨트롤 플레인 노드에 워커 파드 2개` (PM 결정 Q6 — 경고 한 줄만) |
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
- **컨트롤 플레인 영역 상태** = 마스터 노드 판단 + 구성요소 판단 중 **최악**. `reasons[0]`(대표 사유) 우선순위: `CONTROL_PLANE_QUORUM_LOST` → `CONTROL_PLANE_COMPONENT_DOWN` → `CONTROL_PLANE_MASTER_NOT_READY` → `CONTROL_PLANE_COMPONENT_RESTARTS` → `CONTROL_PLANE_NOT_HA`/`CONTROL_PLANE_EVEN_MASTERS` → `CONTROL_PLANE_SINGLE_ZONE` (명세 3.2.3).
- 지속 조건: 마스터 NotReady 60초, 구성요소 Ready 아님 2분, 대기 사유(`ContainerCreating`·`PodInitializing`) 2분. 재시작은 최근 1시간 1~2회 warning / 3회 이상 critical(파드 기준과 같음).

## 9.1 컨트롤 플레인 판단 요약 (서버 계산. 화면은 이 표를 다시 계산하지 않는다)

| 항목 | 정상 | 주의 | 장애 |
|---|---|---|---|
| 마스터 대수 | 3대 이상 홀수 | 1대(단일) 또는 짝수(2·4대) — `haExpected: true`일 때만 | — |
| 마스터 Ready 수 | 전부 Ready | 1대 NotReady이고 쿼럼 유지 | Ready ≤ 전체의 절반(쿼럼 상실) |
| 마스터 AZ 분산 | 2개 이상 AZ | 마스터 2대 이상이 모두 같은 AZ | — |
| 마스터 cordon | 아님 | cordon | — |
| 구성요소 Ready | 모든 마스터에서 Ready | 한 마스터에서만 2분 이상 Ready 아님 | 같은 종류가 과반 마스터에서 Ready 아님, 또는 `kube-apiserver`·`etcd-manager-main`이 모든 마스터에서 Ready 아님 |
| 대기 사유 | 없음 / 생성 중 2분 미만 | 생성 중 2분 이상 | `CrashLoopBackOff`, `ImagePullBackOff`, `ErrImagePull`, `CreateContainerConfigError`, `CreateContainerError`, `InvalidImageName` |
| 최근 1시간 재시작 | 0회 | 1~2회 | 3회 이상 |
| 최근 1시간 `OOMKilled` | 없음 | 1회 이상 | (재시작 3회 이상이면 위 규칙으로 장애) |
| 마스터당 필수 구성요소 수 | 5/5 | 4/5 | 3/5 이하, 또는 `kube-apiserver`·`etcd-manager-main`이 없음 |

- 마스터가 NotReady거나 Ready가 `Unknown`이면 **그 마스터의 구성요소는 위 표를 적용하지 않고** 전부 `unknown`(`CONTROL_PLANE_NODE_NOT_REPORTING`)이다. 미러 파드가 `Running`으로 남아 장애를 가리는 것을 막는다.
- 기준값은 한곳(서버 설정)에 모으고 `CONTROL_PLANE_HA_EXPECTED`로 대수 판단만 끌 수 있다.

## 10. 에러 코드 요약

| HTTP | code | 엔드포인트 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 목록 쿼리(`role` 값 포함), `:kind` 값, series 쿼리(`target=control_plane`은 이번 범위 밖) |
| 404 | `RESOURCE_NOT_FOUND` | `nodes/:name`, `pods/:ns/:name`, `workloads/:kind/:ns/:name`, `metrics/series` |
| 503 | `SOURCE_UNAVAILABLE` | 상세 조회인데 kube 출처가 `not_configured`/`syncing`/`unavailable`(인증 실패 `KUBE_AUTH_FAILED` 포함). `details.source`에 `SourceStatus`가 들어가므로 화면이 "인증 실패"와 "설정 없음"을 구분할 수 있다 |
| 503 | `STREAM_LIMIT_REACHED` | `/api/stream` |

목록·요약·메트릭·컨트롤 플레인(3.3)·DB는 출처가 실패해도 200 + unknown이다. **인증 실패여도 mock 데이터로 대체하지 않는다**(`common.md` 2.4, AC-KOPS38).

## 11. 설정·환경 변수 (이 기능)

| 이름 | 기본 | 설명 |
|---|---|---|
| `KUBECONFIG` | - | 로컬. 클러스터 안에서는 `loadFromCluster()`. **`kops export kubeconfig --admin`으로 만든 admin kubeconfig를 쓰지 않는다** — cluster-admin 인증서가 들어 있어 "조회 전용"이 권한으로 막히지 않는다. 대시보드는 `deploy/rbac.yaml`의 ServiceAccount `sentinel-api` 토큰만 담은 kubeconfig를 **읽기 전용**으로 마운트한다(명세 3.6.3). 토큰을 스스로 발급·갱신하지 않는다 |
| `K8S_CLUSTER_NAME` | - | kOps 클러스터 이름(보통 FQDN, 예: `prod.k8s.example.com`). 상단바 표시 이름이자 **EC2 태그 필터 값**(`kubernetes.io/cluster/<이름>`). live에서 비어 있으면 표시 이름은 kubeconfig 컨텍스트로 채우고 **비용 추정은 `CLUSTER_NAME_NOT_CONFIGURED`**(`aws-cost.md` 3.1). 구 이름 `EKS_CLUSTER_NAME`은 **읽지 않는다**(하위 호환 없음, AC-KOPS06) |
| `CONTROL_PLANE_HA_EXPECTED` | `true` | 마스터 대수(단일·짝수) 판단을 켜고 끈다. `false`면 표시만 하고 상태에 넣지 않는다(2.1 `areas.controlPlane.haExpected`). 어드바이저 `R-CP-HA`는 이 값과 무관하게 계속 지적한다 |
| `SYSTEM_NAMESPACES` | `kube-system,kube-public,kube-node-lease` | 가정 A6. 기본값에서 **`amazon-cloudwatch` 삭제**(EKS 관측 애드온, AC-KOPS09). 필요하면 설정으로 다시 넣을 수 있다 |
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
6. **최근 24시간 재시작·OOM** — 명세 이 기능은 1시간만 필요하지만 어드바이저 R-RESTART·R-OOM이 24시간을 요구. → 서버는 파드별 재시작·OOM 이력을 **24시간** 메모리에 유지한다(API 응답에는 1시간 값만, 24시간 값은 어드바이저 스냅샷용). 재시작 후에는 관측 구간이 짧다. 컨트롤 플레인 구성요소는 같은 이력에서 `restarts.last24h`를 그대로 준다(어드바이저 `R-CP-RESTART` 근거).
7. **(kops-support) 컨트롤 플레인 전용 화면·메뉴** — 명세는 노드 화면 안의 섹션으로 정했고(PM 결정 Q2) 사이드바 메뉴를 만들지 않는다. → API도 화면 경로를 새로 가정하지 않는다. `GET /api/cluster/control-plane` 하나만 두고 `attention`의 `area: 'control_plane'`은 **노드 화면으로** 링크한다.
8. **(kops-support) 쿼럼 판단 근거** — 정확한 근거는 etcd 멤버 목록이지만 RBAC 밖이다(D3, RBAC를 늘리지 않는다). → **마스터 노드 대수로 근사**하고 `quorum.basis: "master_node_count"`로 근사임을 응답에 명시한다. 화면 툴팁에도 적는다. etcd 멤버 수와 마스터 노드 수가 다른 구성(멤버 제거 후 노드가 남아 있는 등)에서는 판단이 틀릴 수 있다 — 한계로 남긴다.
9. **(kops-support) 필수 구성요소 목록 고정 vs U5** — kOps 1.36+의 추가 static pod 목록(`kops-channels`, `kube-apiserver-healthcheck` 등)을 확인하지 못했다. → **필수 5종만 고정**하고 나머지는 `others[]`로 표시만 한다. 목록이 틀려도 "있어야 할 것이 없다"는 오탐이 나지 않는 방향이다. 실클러스터 확인 후 접두어 목록만 고치면 된다(구현 대상 U4·U5).
10. **(kops-support) 노드 이름 형태** — kOps는 쿠버네티스 1.23+ / 외부 AWS CCM이면 노드 이름이 EC2 인스턴스 ID(`i-0…`)다(명세 F10). 두 형태가 모두 정상이므로 계약은 `NodeItem.name`에 **둘 다 나올 수 있다**고 적고 형식을 강제하지 않는다. 다만 **어드바이저 스냅샷에서는 두 형태 모두 가명 처리**한다(`architecture-advisor.md` B.2, AC-KOPS44).

## 13. 변경 이력
- 2026-09-25 (logs 5b 후속, backend): **추가 전용 nullable 필드 3개 + 결함 수정.** ① `WorkloadItem`·`PodItem`·`EventItem`에 **`logHref`**(로그 화면 링크, `logs.md` 11.4 — 파드·워크로드는 `follow=1`, 이벤트는 대상이 파드일 때만 `at=<lastSeenAt>`). DB 상세 `kubernetes.pods[]`·워크로드 상세 `pods[]`·노드 상세 `pods[]`는 `PodItem`이라 저절로 따라온다. ② **결함 수정**: SSE(`cluster.snapshot`·`cluster.controlplane.updated`)의 `ControlPlaneComponent.logHref`가 항상 `null`이던 것 — 링크를 평가 단계에서 채워 REST와 같은 값(8.2). ③ mock `logs=disabled` 전환 시 `cluster.snapshot` 재전송. **기존 필드·이벤트·토픽 변경 없음, RBAC 변경 없음.**
- 2026-09-25 (alerts·logs 계약, backend 3단계): **문구 보강 + 필드 1개 추가.** ① 1.6 `ControlPlaneComponent`에 **`logHref`**(미러 파드 로그 화면 링크, `logs.md` 11.3). RBAC·판단·다른 필드는 그대로다. ② 2.1 `nav`에 **`알림`·`로그`·`설정` 키를 추가하지 않는다**는 근거를 적었다(셋 다 상태 점 없음 — `kops-support` 3.1, `alerts` 3.3.1, `logs` 3.0). 알림 배지는 SSE 토픽 `alerts`의 `badge`에서 온다. **그 밖의 응답·토픽·이벤트 변경 없음.**
- 2026-09-24 (kops-support 구현 P3·P4, backend 4단계): **P3(컨트롤 플레인 상태)·P4(비용 모델) 구현 완료.**
  - 구현됨: **`GET /api/cluster/control-plane`**(3.3 전체), `areas.controlPlane`(2.1), `attention`의 `area: 'control_plane'`, SSE **`cluster.controlplane.updated`**와 `cluster.snapshot.controlPlane`(기존 `cluster` 토픽), `CONTROL_PLANE_*` 이유 코드와 **`KUBE_AUTH_FAILED`**, `nav.nodes` = 워커 영역·컨트롤 플레인 영역의 최악, 환경 변수 **`CONTROL_PLANE_HA_EXPECTED`**, mock 시나리오 7개(`cp-healthy`·`cp-single`·`cp-node-down`·`cp-quorum-lost`·`cp-component-crash`·`cp-not-found`·`kube-auth-failed`).
  - `GET /api/cluster/nodes?role=control_plane`의 `areaStatus`가 이제 **`areas.controlPlane`**이다(P1·P2의 임시 동작 해소).
  - **계약에 추가한 필드 3개**(디자인·퍼블리싱 요청, PM 전달): `ControlPlaneComponent.cellTooltip`, `components.columns[]`(열 머리 + `reason`), `components.cellCounts.unknownTotal`.
  - 판단 기준값은 `apps/api/src/cluster/state/control-plane.ts`의 `CONTROL_PLANE_RULES` 한곳에 모았다(9.1 "기준값은 한곳에").
  - 비용은 `aws-cost.md` 변경 이력 참고(카테고리 `controlPlane` 전환 완료).
- 2026-09-24 (kops-support 구현 P1·P2, backend 4단계): 계약 중 **P1·P2 해당분만** 구현했다. 응답 형식 변경 없음(계약 그대로).
  - 구현됨: `NodeItem.role`(목록·상세·SSE 공통), `GET /api/cluster/nodes`의 `role` 쿼리(기본 `worker`)·`role`·`roleCounts`·`facets.roles`와 3.1 일관성 표(`total`·`counts`·`facets`가 `role`을 따른다), `GET /api/cluster/metrics`의 `scope`·`controlPlane` 블록, `metrics/series` `target=cluster`의 `scope`와 워커 기준 분모, `areas.nodes`의 워커 기준 집계, 이유 코드 `CLUSTER_NO_WORKER_NODES`·`CLUSTER_ALL_WORKERS_NOT_READY`, 노드그룹 라벨 `kops.k8s.io/instancegroup`, `K8S_CLUSTER_NAME`, `SYSTEM_NAMESPACES` 기본값.
  - ~~아직 없음(P3·P4)~~ → **2026-09-24 P3·P4에서 전부 구현됐다**(위 항목 참고).
- 2026-09-24 (kops-support 계약, backend 3단계): 대상 환경 **EKS → kOps**. 구현 전 계약만 갱신했다.
  - **디자이너 요청 반영(2026-09-24, `docs/reports/kops-support/designer.md` 8절)**: 매트릭스 칸 상태를 서버가 확정(`ControlPlaneCellState` 7종 + `cellText`·`cellDetail`·`clickable`, **빈 칸 없음**, `missing`과 `not_reporting` 구분), `components.cellCounts`·`summaryText`, `masters.totals`(마스터 합계 블록), `masters.items[].reasonText`·`components.worst`, `workerPodCount`를 **`number | null`**(0과 미측정 구분), 응답 최상위 `headline`(대표 사유 한 줄), `roleCounts.all`. **화면이 조건을 조합해야 하는 필드는 두지 않았다.**
  - **추가**: `NodeItem.role`(1.1), `ControlPlaneComponent`(1.6), `areas.controlPlane`(2.1), `attention`의 `area: 'control_plane'`(2.3), `GET /api/cluster/nodes`의 `role` 쿼리·`roleCounts`·`facets.roles`·응답 `role`과 일관성 표(3.1), **`GET /api/cluster/control-plane`**(3.3), `GET /api/cluster/metrics`의 `scope`·`controlPlane` 블록(7.2), `metrics/series`의 `scope`(7.3), SSE **`cluster.controlplane.updated`**와 `cluster.snapshot.controlPlane`(8.2 — **새 토픽 없음**), 판단 이유 코드 `CONTROL_PLANE_*` 14개·`KUBE_AUTH_FAILED`·`CLUSTER_NO_WORKER_NODES`·`CLUSTER_ALL_WORKERS_NOT_READY`(9), 컨트롤 플레인 판단 요약 표(9.1), 환경 변수 `CONTROL_PLANE_HA_EXPECTED`(11).
  - **변경**: 클러스터 합계·`target=cluster` 시계열·`areas.nodes`·노드 목록 기본값이 **워커 기준**, `NodeItem.nodeGroup`은 `kops.k8s.io/instancegroup` 하나만, `capacityType`은 EC2 `InstanceLifecycle` 우선, `cluster.version`은 쿠버네티스 API 서버에서만(AWS 호출 없음), metrics-server 없음 안내 문구를 kOps 기준으로, 개요 카드 5개 → **6개**.
  - **삭제**: `EKS_CLUSTER_NAME` → **`K8S_CLUSTER_NAME`**(구 이름 하위 호환 없음), `SYSTEM_NAMESPACES` 기본값의 `amazon-cloudwatch`, 이유 코드 `CLUSTER_NO_NODES`·`CLUSTER_ALL_NODES_NOT_READY`, `eks.amazonaws.com/*`·Karpenter 라벨 해석, `eks:DescribeCluster` 언급.
  - **RBAC 변경 없음**(컨트롤 플레인은 이미 있는 `pods`·`nodes` get/list/watch로만 본다). mock 클러스터 이름 `prod-eks` → `prod.k8s.example.com`, kubelet 버전 예시에서 `-eks-` 접미어 제거.
  - **확인 필요(실클러스터)**: U4(미러 파드 이름 규칙)·U5(kOps 1.36+ 추가 static pod 목록). 지금 계약은 접두어 5종 + `others[]`로 그 불확실성을 흡수하도록 썼다(12절 9번).
- 2026-09-19 (4단계 모듈 연결): DaemonSet을 watch 기준으로 정정(1.2 `replicas.desired`·`source`, 6.1, 9절 `DAEMONSET_DESIRED_UNKNOWN` 폐기, 12절 1번 해결). 응답 필드 추가·삭제 없음.
- 2026-09-19 (4단계 마무리): 2.1 `advisor.status`(StatusInfo) 명시 — 구현이 이미 내려 주던 필드. mock 클러스터 버전 `v1.34.1`(EKS 지원 등급 기준, `aws-cost.md` 11절 8번).
