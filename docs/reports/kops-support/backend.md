# kops-support · 백엔드 작업 보고

> 파일 위치: `docs/reports/kops-support/backend.md`
> 같은 기능에서 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다.

## 2026-09-24 07:20 · API 계약 갱신 (EKS → kOps, 3단계 계약만)

### 1. 요청 내용

PM 지시: 대상 환경이 EKS → **kOps 클러스터**로 바뀌는 전환에서 **API 계약 문서만** 갱신한다(`CLAUDE.md` 기본 흐름 3단계). **구현 코드는 건드리지 않는다** — 계약 확정 후 별도 지시로 P1부터 시작한다.

- 대상: `docs/api/` 7개 문서 전체
- 확정 전제(재논의 없음): EKS 경로 완전 제거·`PLATFORM` 분기 없음·하위 호환 없음, `autoscaling:*` 추가 금지, 컨트롤 플레인은 기존 RBAC 안 static pod 상태까지, 개요 카드 6개, 사이드바 메뉴 신설 없음, 노드 목록 기본 `role=worker`, `deploy/kops-snapshot/`은 다음 범위
- 계약에 반드시 담을 것 9개 항목(`NodeItem.role`~`KUBE_AUTH_FAILED`)
- 특별 지시: **인스턴스 ID 형태 노드 이름 가명 처리(AC-KOPS44)를 가명 규칙·예시까지 정확히** 적을 것
- 실클러스터 미확인 항목(U2·U4·U5·U8)은 "확인 필요"로 표시하고 **추측을 확정처럼 쓰지 말 것**

작업 중 PM 추가 전달 3건:
1. mock 클러스터 이름 3개 확정값(`prod/staging/bench.k8s.example.com`), 클러스터 ID 짝 확인, 명세와 계약이 어긋나면 계약을 명세에 맞추지 말고 **보고할 것**
2. DBA 마이그레이션 완료분 반영 — `controlPlaneUsdPerHour`, 신설 설정 `cost.spike.rate.baselineFrom`(기본 `null`)
3. **디자인 완료분 요청 5건** — 매트릭스 셀 상태를 서버가 확정(`missing`/`notReporting` 구분, 빈 칸 금지), `facets.roles`와 역할 적용 후 `counts`, 마스터 합계 별도 블록 + 대표 사유 한 줄, 마스터 위 워커 파드 수(0과 미측정 구분), `api_lb` 후보 0/1/2+ 구분. **"상태 계산을 화면에서 하지 않는다" 원칙 준수 확인**

### 2. 참고한 문서

| 문서 | 어디를 봤나 |
|---|---|
| `docs/specs/kops-support.md` | 0.1 확정(D1~D9), 0.2 사실(F1~F11), 0.3 미확인(U1~U8), 3.1~3.7 지표·판단·비용·인증·어드바이저, 4 갱신 주기, 5 AC-KOPS01~46, 7 역할별 전달 사항(백엔드), 9 기존 명세 충돌, 10 영향 범위(줄 번호) |
| `docs/reports/kops-support/README.md` | PM 결정 기록, 사용자 결정 Q1~Q9, 넘겨받은 요청 |
| `docs/specs/architecture-advisor.md` | 3.2(R-EKSVER 삭제·R-CP-*), 3.3(스냅샷 클러스터·노드 영역), 3.4(가명 규칙), **3.5(Q5 kOps 명령 실행 예시 규칙 — 문구를 그대로 맞춤)** |
| `docs/design/cluster-status.md`, `aws-cost.md`, `status.md` | designer가 같은 날 갱신한 화면 구조(카드 6개·순서, 역할 전환 탭, 컨트롤 플레인 섹션, 비용 카테고리 순서·툴팁)와 계약 필드가 맞는지 대조 |
| `docs/api/*` (기존 7개) | 갱신 대상 원본 |

### 3. 작업 내용

#### 3.1 mock 클러스터 이름 일괄 치환 (docs/api 전체)

`prod-eks`→`prod.k8s.example.com`, `staging-eks`→`staging.k8s.example.com`, `bench-eks`→`bench.k8s.example.com`, 서버·kubelet 버전 `v1.34.1-eks-8a2c1f0`→`v1.34.1`, `v1.30.2-eks-1552ad0`→`v1.30.2`. 총 31곳.

**클러스터 ID 짝 확인 결과(요청받은 확인)** — `docs/api` 안에서, 그리고 `docs/specs`와도 일치한다.

| 클러스터 | ID | 나오는 곳 |
|---|---|---|
| `prod.k8s.example.com` | `7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e` | `k8s-snapshot.md` 202·584·644·1144·1145·1411·1416·1424·1426, `snapshot-3d.md` 84 |
| `staging.k8s.example.com` | `c3a9e0f2-5b6d-4e7f-8a9b-0c1d2e3f4a5b` | `k8s-snapshot.md` 1298·1411·1417 ↔ `snapshot-3d.md` 797 (**K-9 = `20260919-020000` = staging**, specs와 같음) |
| `bench.k8s.example.com` | (대시보드와 다른 ID) | `common.md` 6.1 `large` 시나리오 ↔ `snapshot-3d.md` 830 |

#### 3.2 `docs/api/common.md`

- `SourceId.awsResources` 설명에서 `EKS Describe` 삭제.
- **`SourceStatus.error.code` 공통 표 신설** — `KUBE_AUTH_FAILED`, `KUBE_CONNECT_FAILED`, `METRICS_API_UNAVAILABLE`, `AWS_ACCESS_DENIED`. `KUBE_AUTH_FAILED`의 동작 4가지(출처 `unavailable` / **mock 대체 없음** / 프로세스 생존 / 토큰 자체 발급·갱신 안 함)와 `not_configured`와의 구분을 명시.
- 2.4 `dataSource` 규칙을 "설정 없음"뿐 아니라 **"거부·실패한 출처"까지** 확장해서 적었다(인증 실패·`CLUSTER_NAME_NOT_CONFIGURED`가 이 규칙을 따른다는 것을 기능 문서와 교차 참조).
- 4절 `checks.kube` 행 추가, `checks.snapshotStore`의 "EKS 배포" → "클러스터 안에 배포한 대시보드".
- 5.8 스트림 이벤트 목록에 **`cluster.controlplane.updated`** 추가(기존 `cluster` 토픽).
- 6.1 cluster mock 시나리오 **7개 추가**: `cp-healthy`·`cp-single`·`cp-node-down`·`cp-quorum-lost`·`cp-component-crash`·`cp-not-found`(AC-KOPS25) + `kube-auth-failed`(AC-KOPS38 확인용, 명세에 없던 추가 — 5.2 참고). `empty`의 뜻을 "노드 0개" → **"워커 0대"**로 정정. cluster→cost mock 관계에 `controlPlane` 인벤토리 규칙 추가.

#### 3.3 `docs/api/cluster-status.md` (가장 큰 변경)

- 머리말에 "대상 환경은 kOps"와 `kops-support` 명세 우선 관계, EKS 개념·`PLATFORM` 분기 없음 명시.
- **1.1 `NodeItem`**: `role: 'worker' | 'control_plane'` 추가. `name` 주석에 **두 가지 형태**(도메인형 / 인스턴스 ID형, F10) 명시. `nodeGroup`은 `kops.k8s.io/instancegroup` **하나만**, `capacityType`은 EC2 `InstanceLifecycle` 우선. 워커 기준 집계에서 마스터가 빠지는 자리 목록과 "목표 대수 미제공"(D2) 주석.
- **1.6 `ControlPlaneComponent` 신설**: 필수 5종 `kind`, 2중 식별 조건, 어노테이션 원문 비노출, `others`로 빼는 규칙(U5), `lastReportedAt`이 필요한 이유(kubelet 정지 시 미러 파드가 `Running`으로 남는 문제).
- **2.1 `/api/overview`**: `areas.controlPlane`(`found`·`masters`·`components`·`quorum`·`haExpected`·`problems`) 추가, `attention`에 `area: 'control_plane'` 예시, `areas.nodes`가 워커 기준임을 표에 명시, `cluster.name`이 `K8S_CLUSTER_NAME`·버전은 쿠버네티스 API 서버에서만, `nav.nodes` = 워커·컨트롤 플레인 **최악**(메뉴 신설 없음).
- **2.3 `attention`**: `area` enum에 `control_plane`, ref kind 규칙, 시스템 필터와 무관하게 항상 노출.
- **3.1 `/api/cluster/nodes`**: `role` 쿼리(기본 `worker`) + 응답 `role`·`roleCounts{worker,control_plane,all}`·`facets.roles`. **`role`과 `total`·`filteredTotal`·`counts`·`roleCounts`·`facets`·`areaStatus`의 일관성 규칙을 8행 표로** 못박았다(AC-KOPS11).
- **3.3 `GET /api/cluster/control-plane` 신설**: 마스터 표(`reporting`·`lastReportedAt`·`components`·`workerPodCount`), 구성요소 매트릭스(`byKind` + 빈 칸 포함 `items`), `others[]`, `quorum`/`haStatus`/`zoneSpread`, `limits.notes` 3줄(AC-KOPS26), `found:false` 동작. **새 RBAC·새 informer·새 토픽 없음**을 본문에 명시.
- **7.2 `/api/cluster/metrics`**: `scope.basis: "worker"` + **`controlPlane` 블록 분리**. metrics-server 없음 문구를 kOps 기준으로 교체하고 **클러스터 변경 명령을 넣지 않는다**는 제약과 파급 영향 4가지를 적었다.
- **7.3 `metrics/series`**: `target=cluster`는 워커 기준(`scope`), `target=control_plane`은 이번 범위 밖(400), 마스터를 `target=node`로 보는 것은 허용.
- **8.2 SSE**: `cluster.controlplane.updated`(전체 교체) + `cluster.snapshot.controlPlane`. **새 토픽을 만들지 않았다**는 점과 노드·파드 upsert와 함께 나갈 수 있다는 점 명시.
- **9 이유 코드**: `CONTROL_PLANE_*` 14개, `KUBE_AUTH_FAILED`, `CLUSTER_NO_WORKER_NODES`·`CLUSTER_ALL_WORKERS_NOT_READY` 추가 / `CLUSTER_NO_NODES`·`CLUSTER_ALL_NODES_NOT_READY` 폐기 표시. 대표 사유 우선순위와 지속 조건.
- **9.1 컨트롤 플레인 판단 요약 표 신설**(명세 3.2.1·3.2.2를 계약 표로).
- **10 에러 코드**: 503 `SOURCE_UNAVAILABLE`에 인증 실패 포함 + `details.source`로 구분 가능함을 적음.
- **11 환경 변수**: `EKS_CLUSTER_NAME` → **`K8S_CLUSTER_NAME`**(구 이름 안 읽음), **`CONTROL_PLANE_HA_EXPECTED`** 신설, `SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch` 삭제, `KUBECONFIG`에 **admin kubeconfig 금지** 경고.
- **6.1**에 "컨트롤 플레인에 새 RBAC 불필요·AWS 호출 추가 없음" 추가. **12절에 결정 4건 추가**(7~10번), 13절 변경 이력.

#### 3.4 `docs/api/aws-cost.md`

- AWS 호출 목록에서 `eks:DescribeCluster` 삭제 + **`eks:*`·`autoscaling:*`·`route53:*`·`s3:*`가 없다**는 것과 **이번 전환으로 호출이 늘지 않는다(오히려 1회 줄어든다)**를 머리말에 명시(AC-KOPS32).
- `CostCategory`에서 `eks` → **`controlPlane`**, 화면 순서 고정, `ControlPlaneCostKind` 5종 타입 추가.
- `categories[]`에 `controlPlane` 행 + **`byKind` 분해**(예시 숫자를 카테고리 합계 = `total` 1.104532가 되도록 다시 맞췄다).
- `resources.eks[]` → **`resources.controlPlane[]`**(행마다 `kind`, `etcdCluster`, `identification`). `supportTier` 삭제.
- **API 서버 LB 식별(U2)**: "확인 필요" 경고 블록 + 후보 규칙 2조건 + **후보 0/1/N개 동작 표**(AC-KOPS30) + `identification.confidence`에 **`confirmed`를 아직 두지 않음**.
- `unavailable.code`에 **`CLUSTER_NAME_NOT_CONFIGURED`** 추가(live 전용, mock 대체 없음, 표시 이름은 kubeconfig에서).
- **3.1.1 화면 도움말 고정 문구** 신설: 상단 안내(AC-KOPS35), 제외 항목 2줄(Route53·kOps state store S3, AC-KOPS31), 목표 대수 미표시 툴팁, `api_lb` 추정 툴팁.
- 배분: `breakdown.eksUsdPerHour` → **`controlPlaneUsdPerHour`**, 규칙 6번 교체, 마스터 비용 미배분(AC-KOPS15).
- **DBA 신설 설정 `cost.spike.rate.baselineFrom`** 반영: 3.3 `baseline.baselineFrom`, 4.1 `spike.rate.baselineFrom`, 6.1·6.2 설정·검증 규칙, 8절 `SPIKE_BASELINE_COLLECTING`. 동작(널이면 현행 / 값이 있으면 기준선만 자르고 **차트 점은 자르지 않음** / 전환 직후 최대 24시간 "기준 수집 중"이 정상)을 적었다.
- 11절 결정: 8번(EKS 지원 등급) **폐기 표시**, 9~12번 추가. 12절 변경 이력.

#### 3.5 `docs/api/architecture-advisor.md`

- A.4 규칙 매핑: `cost`에서 **R-EKSVER 삭제**, `reliability`에 **R-CP-HA·R-CP-SPOT·R-CP-RESTART** 추가 + "kOps 전환으로 바뀐 규칙" 표(워커 한정 규칙, R-GP2의 etcd 주석, metrics-server 없음일 때 판단 보류, 다음 범위 규칙).
- B.2 스냅샷: `platform: 'kops'`(고정), `nodeCount` → **`workerCount`+`controlPlaneCount`**, **`cluster.controlPlane`**(마스터 수·타입·AZ 분포·구매 옵션·구성요소별 Ready/24시간 재시작·쿼럼·`notReporting`), `nodes[].role`, 비용 `byCategory`에 `controlPlane`, `supportTier` 삭제.
- **"노드 이름 가명 처리" 절 신설(AC-KOPS44, PM 특별 지시)**: 문제 설명(`sanitize-snapshot.ts:158`) → 판정 형태 **P1~P4**(P3 `^i-[0-9a-f]{8}([0-9a-f]{9})?$`, P4 부분 일치가 신규) → 가명 형식 `<nodeGroup>-node-<n>`과 안정성 요구 → 적용 자리(**`evidence[].text`·`summary` 문자열 전체 스캔 포함**) → **예시 표 7행** → 매핑표 비전송·비저장 → **검증 방법(스냅샷에 `i-[0-9a-f]{8,17}` 0건)**.
- B.8 프롬프트: 역할을 **kOps·비용 어드바이저**로, EKS·확장 지원 문구 금지, 컨트롤 플레인이 사용자 소유 EC2라는 배경 추가, `promptVersion` 올림 필요.
- **Q5 실행 예시 규칙**을 계약에 명문화: `kops` 명령 허용, **`--yes` 없는 형태만**, `noExecuteNotice` 항상, **api가 결과 정리 단계에서 `--yes`를 검사해 지우거나 단계를 버린다**, 실행 버튼 없음. 문구는 `docs/specs/architecture-advisor.md` 3.5와 맞췄다.
- C절 결정 7번 보강 + 9·10번 추가, D절 변경 이력 신설.

#### 3.6 디자이너 요청 5건 반영 (작업 중 PM 전달, `docs/design/cluster-status.md` 3.2 / `designer.md` 8절)

| # | 요청 | 계약에 넣은 것 |
|---|---|---|
| 1 | 매트릭스 칸 상태를 서버가 확정, **빈 칸 금지**, `missing`과 `notReporting` 구분, 마스터별 마지막 보고 시각 | `ControlPlaneCellState` **7종 enum**(`ok`·`warning`·`critical`·`not_reporting`·`unknown`·`missing`·`stale` — 디자인 "셀 상태별 모습" 7가지와 1:1) + `cellText`(1행 문구)·`cellDetail`(2행 보조)·`clickable`. `components.items`는 **마스터 수 × 5칸이 반드시 모두 들어간다**. `cellState` ↔ `status.status` 대응표. **`not_reporting`이 `missing`보다 우선**(보고가 끊기면 파드가 안 보이는 이유를 알 수 없으므로). 마스터별 `lastReportedAt` + 칸별 `lastReportedAt`. `components.cellCounts`·`summaryText`(한 줄 요약 문장도 서버가 만든다) |
| 2 | `facets.roles` + **역할 적용 후** `counts` | 3.1의 일관성 표에서 `counts`·`total`·`filteredTotal`·`facets`는 **`role` 적용**, `roleCounts`·`facets.roles`는 **미적용(클러스터 전체)**으로 갈랐다. `roleCounts.all` 추가(역할 전환 탭 `전체 9`를 화면이 더하지 않게) |
| 3 | 마스터 합계 **별도 블록** + 대표 사유 한 줄을 서버가 생성 | `masters.totals`(CPU·메모리 합계, `available` 포함. `GET /api/cluster/metrics`의 `controlPlane` 블록과 **같은 값**임을 양쪽에 명시) + 응답 최상위 **`headline`**(= `status.reasons[0].text`). 마스터 행별 `reasonText`, 열 최악 `components.worst`도 서버 값 |
| 4 | 마스터 위 워커 파드 수, **0과 미측정 구분** | `workerPodCount: number \| null` — `0`(없음)과 `null`(파드 캐시 syncing/unavailable로 세지 못함)을 구분. 둘 다 경고를 띄우지 않는다 |
| 5 | `api_lb` 후보 **0 / 1 / 2개 이상** 구분 | 카테고리에 **`apiLb: { state, candidateCount, text }`** 신설. `state`는 `assumed`/`ambiguous`/`not_found`. **후보 0개라 `api_lb` 행이 없을 때도 이 객체는 항상 있다** — 화면이 "행이 없다"로 세 경우를 구분하지 않아도 된다 |

**원칙 확인(요청받은 사항)**: 컨트롤 플레인 응답에 **화면이 조건을 조합해야 하는 필드는 없다.** 쿼럼·HA·AZ 편중·칸 상태·칸 문구·대표 사유·요약 문장이 전부 서버 값이고, 그 사실을 3.3 본문에 한 줄로 못박았다.

#### 3.7 `k8s-snapshot.md` / `snapshot-3d.md` / `aws-snapshot-manager.md`

응답·엔드포인트·에러 코드 변경 **없음**. 문구만:
- `k8s-snapshot`: `cluster.name`·`dashboardCluster.context` 설명을 kOps(FQDN) 기준으로, 내보내기 전용 역할 안내를 **ClusterRole + 사람 사용자·그룹 바인딩**으로(EKS access entry 삭제), 인증 설명에서 `aws eks get-token` 삭제, `SNAPSHOT_SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch` 삭제, `isAutoCreated`의 `eks:` 접두어는 **"EKS 잔재" 주석만 달고 남김**(명세 9절 지시), "EKS 배포" → "클러스터 안 배포", `deploy/kops-snapshot/`은 다음 범위임을 이력에 기록.
- `snapshot-3d`: mock 이름만. 2~4단계 AWS 층은 **이번에 고치지 않고**, 시작할 때 ASG/Launch Template 중심으로 재설계해야 한다는 점을 이력에 남김.
- `aws-snapshot-manager`: "EKS 배포" → "클러스터 안 배포", 예시 라벨·`searchFilter` 일반화.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/api/cluster-status.md` | 수정 | `NodeItem.role`, `ControlPlaneComponent` + **`ControlPlaneCellState` 7종**(1.6), `areas.controlPlane`, `attention` `control_plane`, 노드 `role` 쿼리·`roleCounts`·일관성 표, **`GET /api/cluster/control-plane` 신설**(`headline`·`masters.totals`·`cellCounts`·`summaryText` 포함), metrics 워커 기준 + `controlPlane` 블록, SSE `cluster.controlplane.updated`, 이유 코드 17개 추가·2개 폐기, 9.1 판단 표, env `K8S_CLUSTER_NAME`·`CONTROL_PLANE_HA_EXPECTED`, 결정 4건, 변경 이력 |
| `docs/api/aws-cost.md` | 수정 | 카테고리 `eks`→`controlPlane`+`byKind`+**`apiLb`**, `resources.controlPlane[]`, API LB 후보 규칙(추정·0/1/N), `CLUSTER_NAME_NOT_CONFIGURED`, 3.1.1 도움말 문구, 배분 `controlPlaneUsdPerHour`·규칙 6, `baselineFrom`, AWS 호출 목록, 결정 4건, 변경 이력 |
| `docs/api/architecture-advisor.md` | 수정 | R-EKSVER 삭제·R-CP-* 추가, `platform: 'kops'`·`workerCount`/`controlPlaneCount`/`cluster.controlPlane`, `nodes[].role`, **노드 이름 가명 규칙 P1~P4 + 예시 + 검증**, 프롬프트 kOps화, Q5 실행 예시 규칙, 결정 3건, D절 변경 이력 |
| `docs/api/common.md` | 수정 | `SourceStatus.error.code` 표 + `KUBE_AUTH_FAILED` 동작, 2.4 확장, `checks.kube`, 5.8 이벤트 추가, mock 시나리오 7개, `empty` 뜻 정정, 변경 이력 |
| `docs/api/k8s-snapshot.md` | 수정 | mock 이름·서버 버전, kOps 기준 문구, RBAC 안내 교체, 시스템 네임스페이스 기본값, `eks:` 잔재 주석, 변경 이력 |
| `docs/api/snapshot-3d.md` | 수정 | mock 이름 3종, 2~4단계 AWS 층 메모, 변경 이력 |
| `docs/api/aws-snapshot-manager.md` | 수정 | "EKS 배포" 일반화, 예시 라벨·`searchFilter`, 변경 이력 |
| `docs/reports/kops-support/backend.md` | 추가 | 이 보고서 |

**`apps/api/src/**`, `deploy/`, `README.md`, `apps/api/prisma/**`는 손대지 않았다.**

### 5. 주요 결정과 이유

1. **컨트롤 플레인을 전용 엔드포인트 1개(`GET /api/cluster/control-plane`)로 둔다.**
   대안 ① `/api/cluster/nodes?role=control_plane` 응답에 구성요소를 끼워 넣기 — 노드 목록 응답이 역할에 따라 모양이 달라져 화면·DTO가 지저분해진다. 대안 ② 개요 `areas.controlPlane`만 두고 상세는 파드 목록으로 — "시스템 숨기기" 필터에 가려지고(AC-KOPS19 위반) 마스터×종류 매트릭스를 화면이 조립해야 한다(서버 계산 원칙 위반). → 단일 객체 전용 엔드포인트 + 단일 SSE 이벤트(전체 교체)가 가장 단순하다. **새 토픽·새 informer·새 RBAC는 만들지 않는다.**

2. **`kube-auth-failed` mock 시나리오를 추가했다(명세에 없던 항목).**
   AC-KOPS38("토큰 만료 → `unavailable` + mock 대체 없음")은 명세에 mock 재현 수단이 없어 **live 클러스터 없이는 검증할 수 없다.** 이 전환에서 인증 경로가 admin kubeconfig → ServiceAccount 토큰으로 바뀌어 실제로 만날 확률이 높은 상태다. 기존 `no-cluster`(설정 없음)와 구분해야 화면이 두 문구를 다르게 낸다. → cluster 그룹에 1개 추가(기존 시나리오·기본값 불변).

3. **`api_lb` 식별에 `confirmed` 신뢰도를 두지 않았다.**
   U2가 미확인인데 `confirmed`를 미리 정의하면 구현이 "이 정도면 확정"이라고 임의 판단할 여지가 생긴다. 지금은 `assumed`/`ambiguous` 둘뿐이고, **모든 경로가 화면에 "추정"을 남긴다.** 실클러스터 확인 후 값을 늘린다.

4. **마스터 판별을 EC2 태그가 아니라 쿠버네티스 노드 라벨 → `providerID` → 인스턴스 경로로 고정했다.**
   역할 태그 접두어 상수의 실제 문자열이 미확인(U3)이다. 라벨 경로를 쓰면 `cluster-status`의 `NodeItem.role`과 비용의 마스터 집합이 **정의상 항상 같아** 화면 숫자가 어긋나지 않는다.

5. **필수 구성요소를 5종으로 고정하고 나머지는 `others[]`로 표시만 한다(U5 흡수).**
   kOps 1.36+의 추가 static pod 목록이 미확인이다. 목록을 넓게 잡으면 "있어야 할 것이 없다"는 **오탐**이 나고, 좁게 잡고 나머지를 표시만 하면 최악이 "정보가 조금 적다"로 끝난다. 이름 규칙이 달라도(U4) 접두어 목록만 고치면 된다.

6. **비용 카테고리 예시 숫자를 다시 맞췄다.**
   AC-KOPS29("카테고리 합계 = 전체 추정 소모율")를 예시가 스스로 만족하도록 `controlPlane` 0.232479를 넣고 `ec2`를 0.686721로 조정해 **합계 `total` 1.104532를 유지**했다. 총액을 유지한 이유는 `summary`·`allocation`·`rate-series`·`actual` 예시가 같은 값을 쓰기 때문이다(다른 절을 건드리지 않기 위함).

7. **노드 이름 예시를 전면 교체하지 않았다.**
   kOps에서 노드 이름은 **두 형태가 모두 정상**이다(F10은 "1.23+ **외부 CCM일 때**"). 계약이 형식을 강제하면 안 되므로 `NodeItem.name` 주석에 두 형태를 적고, **새로 쓰는 컨트롤 플레인 예시에는 `i-0…` 형태**를 써서 가명 규칙과 짝이 맞게 했다. 기존 워커 예시(`ip-10-…`)는 그대로 둔다. **mock 픽스처(코드)의 노드 이름을 kOps 형태로 바꾸는 것은 AC-KOPS46이고 구현 단계 몫이다.**

8. **`AdvisorSnapshotV1`의 `schemaVersion`을 1로 유지했다.**
   `cluster` 블록이 바뀌었지만 이 스키마는 api ↔ 브리지 내부 형식이고 외부 소비자가 없다. 대신 **`promptVersion`을 올려** 짝을 맞추도록 계약에 적었다(모르는 값이면 브리지가 400).

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과** (출력 없음) | 코드 변경이 없으므로 기준선 확인용 |
| `npm test --prefix apps/api` | **통과** — 41 suites, 398 passed / 1 skipped | 같음. 계약 문서는 테스트 대상이 아니다 |
| `grep -rn -i "eks" docs/api/` | 남은 항목 전부 **의도된 것**(삭제 기록·변경 이력·"EKS 잔재" 주석) | 동작하는 계약 경로에 EKS 없음 |
| `prod-eks`·`staging-eks`·`bench-eks` 잔존 검색 (`docs/api/`) | **0건**(변경 이력의 "무엇을 바꿨다" 서술 제외) | |
| 클러스터 ID 짝 대조 (`docs/api` ↔ `docs/specs`) | **일치** (3.1 표) | prod/staging/bench 모두 |
| `git status` | 내가 바꾼 것은 `docs/api/*` 7개 + 이 보고서뿐 | 구현 코드·`deploy/`·prisma 미변경 확인 |

**건너뛴 검증**
- **실클러스터 확인(U2·U4·U5·U8)은 하지 않았다.** kOps 클러스터에 접근할 수단이 이 작업 범위에 없다. 계약에는 "확인 필요 + 추정"으로만 적었고 확정 규칙은 비워 뒀다.
- 계약 문서를 실제 응답과 대조하는 검증은 **구현 단계(P1~P5)에서** 한다. 지금은 구현이 없다.

### 7. 남은 이슈·한계

1. **U2(API 서버 NLB 이름·태그 규칙) 미확인 — 최우선.** 후보 규칙이 틀리면 `api_lb`가 0개(금액 누락)나 N개(과다 계상)로 잡히는데 **오류가 아니라 정보/경고로만 보여서 조용히 틀린다.** 계약은 "추정" 표시를 강제하는 것까지만 할 수 있다.
2. **U4(미러 파드 이름 규칙)·U5(추가 static pod 목록) 미확인.** 5종 접두어 + `others[]` 구조로 흡수했지만, 이름 규칙이 크게 다르면 구성요소가 통째로 `others`로 빠져 `components.ready`가 0이 될 수 있다. 구현 때 실제 파드 이름을 먼저 확인할 것.
3. **쿼럼은 마스터 노드 대수 기준 근사다.** etcd 멤버 목록은 RBAC 밖(D3)이라 늘리지 않았다. 멤버를 뺐는데 노드가 남아 있는 구성에서는 판단이 틀린다 — 계약에 `quorum.basis`와 툴팁으로 한계를 드러냈다.
4. **`etcdCluster`(main/events) 구분은 미확정.** `null` 허용으로 두었고 금액에는 영향이 없다.
5. **어드바이저 가명 규칙의 문자열 전체 스캔(P4)은 비용이 있다.** `prechecks[].evidence[].text`까지 훑어야 한다. 구현에서 노드 이름 → 가명 치환을 **한 번 만든 매핑으로 일괄 치환**하도록 할 것(정규식만으로 치환하면 노드그룹을 모르는 가명이 생긴다).
6. **비용 예시 숫자는 자체 정합성만 맞췄다.** 실제 단가(t3.medium, gp3, NLB)는 리전·시점에 따라 다르다. 예시일 뿐 단가표가 아니다.
7. **`docs/specs`와의 불일치는 발견하지 못했다** — 아래 8번의 "PM 판단 요청" 2건은 불일치가 아니라 **명세가 정하지 않은 빈칸**이다.

### 8. 다른 담당 요청

- **DBA 요청**: 없음. 요청했던 `cost_rate_samples.eks_usd_per_hour` → `control_plane_usd_per_hour`는 **이미 완료**되었고 계약은 새 이름만 참조한다. 신설 설정 `cost.spike.rate.baselineFrom`도 반영했다. 다만 확인 부탁:
  - `baselineFrom`의 **검증 규칙을 계약에서 "null 또는 ISO 8601 UTC, 미래 시각은 400"으로 정했다.** `settings-defaults.ts`의 실제 타입·기본값과 다르면 알려 달라.
  - 마이그레이션이 **PGlite에서만 검증**됐고 실제 Postgres 16 미검증이라고 들었다. 배포 전 실제 Postgres에서 RENAME + jsonb 갱신을 한 번 돌려야 한다(대시보드 DB라 데이터 손실이 곧 급증 판단 기준선 손실이다).
- **디자이너 요청**: 전달받은 5건을 모두 반영했다(3.6 표). 확인만 부탁하는 3가지 —
  - 매트릭스 칸 상태를 **7종 enum(`ControlPlaneCellState`)**으로 내려보낸다. 디자인 "셀 상태별 모습" 7행과 1:1이라고 보고 이름을 붙였는데(`ok`/`warning`/`critical`/`not_reporting`/`unknown`/`missing`/`stale`) 맞는지.
  - **`not_reporting`이 `missing`보다 우선**한다고 정했다. 마스터가 보고를 멈춘 동안 파드가 안 보여도 "없음(점선)"이 아니라 "노드 미보고(빗금)"다. 삭제인지 보고 중단인지 구분할 수 없기 때문인데, 화면 의도와 같은지.
  - `GET /api/cluster/metrics`의 `controlPlane`과 `control-plane` 응답의 `masters.totals`에 **`status` 배지를 두지 않았다.** 디자인 "마스터 합계 2행"은 UsageBar만 있고 배지가 없어 보이는데 맞는지.
- **프론트 요청(구현 단계 전 알림)**: `cluster.controlplane.updated`는 **새 토픽이 아니라 기존 `cluster` 토픽**의 이벤트다. 구독 추가가 필요 없고 핸들러만 하나 늘리면 된다.
- **PM 판단 요청 (명세가 정하지 않은 빈칸 2건)**
  1. **`kube-auth-failed` mock 시나리오를 추가해도 되는가.** 명세 AC-KOPS25는 `cp-*` 6개만 정했다. AC-KOPS38을 live 없이 검증하려면 필요하다고 판단해 넣었다. 빼라면 계약에서 1줄 삭제하면 된다.
  2. **어드바이저 `AdvisorSnapshotV1`의 `cluster.nodeCount`를 없애고 `workerCount`/`controlPlaneCount`로 나눴다.** 명세 3.1 표가 "`cluster.nodeCount` → `workerCount` / `controlPlaneCount`로 분리"라고 적어 그대로 따랐지만, **구 필드를 남기지 않는 것**까지는 명세에 없다. 하위 호환을 두지 않는다는 D1 원칙에 맞춘 해석이다.

### 9. 다음 담당이 알아야 할 점

**구현(P1~P5)을 시작할 때**

1. **가장 조용히 깨지는 것 — `apps/api/src/cost/store/cost-store.ts`의 `eksUsdPerHour`.** PM이 코드로 확인한 내용: 이 필드는 별도 `data` 객체에 담겨 `...data`로 전개되므로 **TypeScript 초과 속성 검사가 걸리지 않고**, `saveRateSample`의 `try/catch`가 Prisma 예외를 `warn`으로 삼킨다. 안 고치면 **lint·tsc·테스트가 전부 통과하는데 소모율 표본만 저장되지 않는다.** 급증 판단이 서서히 말라 죽고 한동안 정상으로 보인다. 같은 파일 `byCategory.eks`, `cost.types.ts`, `estimate/allocation.ts`, `allocation.spec.ts`도 함께. **`prisma generate` 재실행 필요**(`dist/`에 옛 이름이 남아 있다).
2. **두 번째로 위험한 것 — `advisor/snapshot/sanitize-snapshot.ts:158`.** IP 형태가 아닌 노드 이름을 원문 통과시킨다. kOps 노드 이름이 `i-0…`이면 **인스턴스 ID가 로컬 Claude Code로 나간다.** 계약 `architecture-advisor.md` B.2 "노드 이름 가명 처리"의 P1~P4 표·예시·검증 방법을 그대로 구현하고, **스냅샷 전문에 `i-[0-9a-f]{8,17}`가 0건인지 테스트로 고정**할 것.
3. **워커/마스터 분리는 한 군데에서 판정한다.** `extract.ts`가 `role`을 붙이고, 집계·비용·어드바이저는 그 값만 본다. 라벨을 두 번 해석하면 화면 숫자가 어긋난다.
4. **RBAC는 바꾸지 않는다.** 컨트롤 플레인은 이미 watch 중인 `nodes`·`pods`만 쓴다. `deploy/rbac.yaml`에서 할 일은 EKS IRSA 주석 삭제뿐이고, kOps에서 AWS 권한을 주는 방법은 **U8(확인 필요)**로 남긴다.
5. **AWS 호출을 늘리지 않는다.** `controlPlane`은 이미 받은 EC2·EBS·ELB 목록의 **재분류**다. `eks:DescribeCluster`는 삭제(호출이 1회 줄어든다).
6. **`K8S_CLUSTER_NAME`은 구 이름을 읽지 않는다.** live에서 비면 `CLUSTER_NAME_NOT_CONFIGURED`이고 **mock으로 대체하지 않는다.**
7. **실클러스터에 붙게 되면 U2 → U4 → U5 → U8 순서로 확인하고 결과를 계약에 적을 것.** U2는 `docs/api/aws-cost.md` 3.1의 "확인 필요" 블록을 확정 규칙으로 바꾸고 `identification.confidence`에 `confirmed`를 추가하는 작업이다.
8. **`deploy/kops-snapshot/`은 이번 계약에 없다**(다음 범위). 스냅샷 메뉴에 탭이 하나 더 붙을 수 있다는 점만 `k8s-snapshot.md` 이력에 적어 뒀다.

---

## 2026-09-24 08:10 · 구현 P1·P2 (EKS 제거·식별자 교체 + 컨트롤 플레인 분리 집계)

### 1. 요청 내용

PM 지시: 구현 4단계 중 **P1(AC-KOPS01~09)·P2(AC-KOPS10~17)까지만**. P3~P5는 별도 지시.

- **P1**: `extract.ts` 노드그룹 라벨을 `kops.k8s.io/instancegroup`으로 교체(하위 호환 없음) + `role` 추출, `aws-sdk.gateway.ts` 노드그룹 태그 교체(EC2 필터 태그 `kubernetes.io/cluster/<name>`은 **그대로**), `describeEksCluster`·`eksSupportTier` 삭제·`@aws-sdk/client-eks` 제거·`eks-support.ts` 이름 변경, `EKS_CLUSTER_NAME` → `K8S_CLUSTER_NAME`, 클러스터 버전은 쿠버네티스 API에서만, `SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch` 제거, `PLATFORM` 같은 분기 설정 금지.
- **P2**: 워커/마스터 분리 집계, `GET /api/cluster/nodes` 기본 `role=worker`와 `counts`·`facets`·`total` 일관성, `/metrics`·`/metrics/series target=cluster` 워커 기준 + 마스터 별도 블록, "노드 0개 → 전체 장애"를 **"워커 0대"**로 재정의, 비용 배분에서 마스터 비용을 `공용(클러스터)`로(합계 불변식 유지), 어드바이저 R-NODEIDLE·R-ONDEMAND·R-GRAVITON을 워커만 대상.
- **PM이 확인해서 넘긴 위험(반드시 처리)**:
  1. `cost-store.ts`의 `eksUsdPerHour` → `controlPlaneUsdPerHour`. 타입·빌드·테스트가 모두 통과하는데 소모율 표본만 조용히 저장되지 않는 자리. **테스트로 고정할 것.** `prisma generate` 재실행 필요.
  2. `run-model.ts`의 `prev.nodeCount !== current.nodeCount` 경고를 **워커 수 변화와 마스터 수 변화로 각각** 나눌 것. 무관한 동명 필드(`precheck-rules.ts`의 노드그룹 `nodeCount`, 비용 쪽 `nodeCount`)는 건드리지 말 것.
  3. 명세 10절의 줄 번호를 믿지 말고 검색으로 확인할 것.
- 하지 않을 것: P3~P5, `apps/api/src/database/**`·`apps/api/prisma/**`(DBA), `apps/web/**`, `deploy/rbac.yaml`의 권한 확대.
- 검증: lint·test·build, mock 실제 기동(포트 **3121**), 자기가 띄운 PID만 종료.

### 2. 참고한 문서

- `docs/specs/kops-support.md` — 0.1 확정(D1~D9), 0.2 사실(F1~F11), 3.1(워커/마스터 분리 표), 3.3(노드그룹), 3.5.6(배분), **5절 P1·P2 수용 기준**, 7절 "백엔드", 10절 영향 범위(줄 번호는 참고만)
- `docs/api/cluster-status.md`(1.1 `NodeItem.role`, 3.1 `role` 일관성 표, 7.2 `scope`·`controlPlane`, 7.3 `scope`, 9절 이유 코드, 11절 환경 변수), `docs/api/aws-cost.md`(3.2 배분, 12절), `docs/api/architecture-advisor.md`(A.1.2·A.10·B.2), `docs/api/common.md`
- `docs/reports/kops-support/README.md` — PM 결정 기록, 특히 "계약 단계에서 올라온 빈칸 2건"과 "PM 검증 기록"
- `docs/reports/kops-support/dba.md` — 마이그레이션 내용과 backend 요청 1~7

### 3. 작업 내용

#### (1) PM 위험 1 — 소모율 기록의 조용한 저장 실패 (최우선)

1. `npx prisma generate` 재실행 → 생성 클라이언트에 `controlPlaneUsdPerHour` 반영(`dist/`의 옛 이름은 재빌드로 제거).
2. `cost-store.ts`: `StoredRateSample.byCategory.eks` → `controlPlane`, `saveRateSample`의 `eksUsdPerHour:` → `controlPlaneUsdPerHour:`.
3. `cost.service.ts`: 표본을 만들 때 `controlPlane: byCat.eks ?? 0` (카테고리 이름 교체는 P4이므로 **DB 열 이름만 먼저** 맞춘다 — 5절 결정 B).
4. 배분 breakdown `eksUsdPerHour` → `controlPlaneUsdPerHour` (`cost.types.ts`, `allocation.ts`, `allocation.spec.ts`).
5. **회귀 테스트 신설** `src/cost/store/cost-store.spec.ts`(4건): 가짜 Prisma가 **`prisma/schema.prisma`의 `model CostRateSample` 필드 이름 목록**을 파싱해 모르는 인자를 거부하고, `saveRateSample`이 경고를 남기지 않았는지(= 예외가 삼켜지지 않았는지) 확인한다. `controlPlaneUsdPerHour` 값 전달·구 이름 부재·스키마에 `eks_usd_per_hour` 없음·DB 없을 때 메모리 동작도 함께 고정.
   - **역회귀 확인**: 일부러 `eksUsdPerHour:`로 되돌리니 4건 중 2건이 실패했다(원복함). 그때도 lint·tsc는 그대로 통과 = 테스트가 유일한 방어선임을 확인했다.

#### (2) PM 위험 2 — 어드바이저 결과 신선도 경고

- `SnapshotSummary.nodeCount` → **`workerCount` + `controlPlaneCount`** (`advisor.types.ts`, `snapshot-builder.ts`, `advisor-precheck.service.ts`의 빈 요약).
- `computeFreshness`가 두 값을 **각각** 비교해 `WORKER_COUNT_CHANGED` / `CONTROL_PLANE_COUNT_CHANGED`를 따로 만든다. `NODE_COUNT_CHANGED`는 폐기.
- **옛 실행 기록 대비**: `snapshotSummary`는 DB에 JSON으로 저장되므로 과거 행에는 새 필드가 없다. `typeof a === 'number' && typeof b === 'number'`일 때만 비교해 `undefined !== 3` 같은 가짜 경고를 막았다.
- 무관한 동명 필드(`precheck-rules.ts`의 노드그룹 `nodeCount`, `cost.types.ts`·`estimator.ts`·`cost-store.ts`의 비용 `nodeCount`)는 **건드리지 않았다**(grep으로 확인).
- 계약(`docs/api/architecture-advisor.md`)은 `SnapshotSummary.nodeCount`를 그대로 두고 있었다 — 계약 단계의 누락이라 **A.1.2·A.10·C.11·변경 이력을 갱신**했다(5절 결정 A).

#### (3) P1 — 식별자·EKS 제거

- `extract.ts`: 노드그룹 라벨 3종 → `kops.k8s.io/instancegroup` **하나만**. `nodeRoleOf()` 신설(`node-role.kubernetes.io/control-plane` 또는 구 `.../master` → `control_plane`). `capacityType`은 EKS·Karpenter 라벨을 버리고 쿠버네티스 표준 `node.kubernetes.io/instance-lifecycle`만 본다(kOps는 구매 옵션 라벨을 붙이지 않는다 — 비용 쪽은 이미 EC2 `InstanceLifecycle`이 1순위).
- `model.ts`: `NodeRole` 타입 + `RawNode.role`. `types.ts`: `NodeItem.role`. `evaluate.ts`가 그대로 전달 → 목록·상세·SSE upsert·스냅샷 모두 `role`을 갖는다.
- `aws-sdk.gateway.ts`: 인스턴스 노드그룹 태그 → `kops.k8s.io/instancegroup` 하나만. **EC2 필터 태그 `kubernetes.io/cluster/<name>`은 손대지 않았다**(F3·D9). `EKSClient`·`DescribeClusterCommand`·`describeEksCluster` 삭제, `aws-gateway.ts` 포트에서도 제거.
- `package.json`에서 `@aws-sdk/client-eks` 삭제 + `npm install --package-lock-only`로 lock 정리(lock에서 `client-eks` 0건).
- `eks-support.ts` → **`instance-types.ts`**로 파일 이름 변경. `eksSupportTier`와 EKS 표준 지원 종료일 표를 삭제하고 `splitInstanceType`·`gravitonEquivalent`·`smallerSize`는 유지.
- 클러스터 버전: `cost.service.ts`가 `eks:DescribeCluster`를 부르지 않고 **쿠버네티스 API 서버 버전만** 쓴다. `EksRow.supportTier` 삭제, `PriceBook.eks`를 `{standard, extended}` → 단일 `PriceQuote | null`로(확장 지원 단가 조회 삭제), `price.service.ts`의 `eksQuote()`에서 `extendedSupport` 분기 제거.
- `EKS_CLUSTER_NAME` → **`K8S_CLUSTER_NAME`**: `env.validation.ts`(주석에 "구 이름은 읽지 않는다" 명시), `cluster-state.service.ts`, `cost.options.ts`, `.env.example`, `docker-compose.yml`, `deploy/app.example.yaml`(`prod.k8s.example.com`). **구 이름을 읽는 코드는 한 줄도 남기지 않았다.**
- `SYSTEM_NAMESPACES` 기본값: `kube-system,kube-public,kube-node-lease` (`env.validation.ts`, `.env.example`, `docker-compose.yml` 3곳 일치).
- `kube-watcher.service.ts`: kubeconfig 이름에서 **EKS ARN을 파싱하던 `clusterRegion()`과 `clusterName()`의 ARN 절단 regex 삭제**. 리전은 노드 라벨(`topology.kubernetes.io/region`)에서 채우는 기존 폴백이 그대로 동작한다(`clusterInfo()`).
- 문구 정리: `health.service.ts`의 "EKS Pod Identity" 주석, `cost.service.ts`의 권한 오류 메시지 정규식에서 `eks:\w+` 제거, `aws-gateway.ts` 머리 주석의 권한 목록.
- `deploy/rbac.yaml`: EKS IRSA 주석 삭제 → "kOps에서 AWS 읽기 권한을 주는 방법은 **확인 필요**(U8)"로 교체. **리소스·동사는 한 글자도 바꾸지 않았다.**
- `PLATFORM` 같은 분기 설정·환경 변수·조건문은 **만들지 않았다**(AC-KOPS02).

#### (4) P2 — 워커/마스터 분리

- `evaluate.ts`
  - `areas.nodes`(status·ready·total·problems)를 **워커만**으로 계산. 이유 코드 `CLUSTER_NO_NODES`·`CLUSTER_ALL_NODES_NOT_READY` → **`CLUSTER_NO_WORKER_NODES`·`CLUSTER_ALL_WORKERS_NOT_READY`**(AC-KOPS14. 마스터가 전부 Ready여도 워커 0대면 장애).
  - `evaluateClusterMetrics`를 워커/마스터 두 누산기로 나눠 `cpu`·`memory`는 워커 합계, `scope: { basis: 'worker', workerNodeCount, controlPlaneNodeCount }`와 **`controlPlane` 블록**(마스터 0대면 `{available:false, nodeCount:0, cpu:null, memory:null}`)을 추가. 타입 `ControlPlaneMetricsBlock` 신설.
- `metrics-ingest.service.ts`: `cluster` 시계열의 분자·분모에서 **마스터 제외**(AC-KOPS13). 노드 단위 시계열은 마스터도 그대로 쌓는다(마스터를 `target=node`로 조회할 수 있어야 한다 — 계약 7.3).
- `cluster-query.service.ts`
  - `nodes()`: `role` 기본 `worker`. `items`·`total`·`counts`·`facets`는 `role`을 적용하고, `roleCounts`·`facets.roles`는 클러스터 전체 기준(계약 3.1 표 그대로). `facets.roles`는 `worker` 먼저.
  - `metricsSeries()`: `target=cluster`일 때만 `scope: { basis: 'worker' }`.
  - `dto.ts`: `NodesQueryDto.role`에 `@IsIn(['worker','control_plane','all'])` → 그 밖의 값은 400 `VALIDATION_FAILED`.
- 비용 배분(`allocation.ts`): `estimate.resources.ec2` 순회에서 **노드 role이 `control_plane`이면 파드 배분을 건너뛰고 `sharedCluster.node`에 전액**을 넣는다(AC-KOPS15). 마스터 위 컨트롤 플레인 파드에도 배분되지 않는다. 금액을 옮기기만 하므로 **배분 합계 = 추정 합계**가 그대로 성립한다. `Acc.eks` → `controlPlane`(내부 이름).
- 인벤토리 포트: `InventoryNode.role` 추가(`cluster-state.service.ts`가 채우고, `inventoryFingerprint`에도 포함해 role이 바뀌면 비용이 재계산된다).
- 어드바이저
  - 스냅샷 노드에 `role` 추가, **노드그룹 집계에서 컨트롤 플레인 InstanceGroup 제외**(명세 3.3) → `R-ONDEMAND`·`R-GRAVITON`이 자동으로 워커만 대상.
  - `R-NODEIDLE`은 `nodes.filter(role !== 'control_plane')`로 명시적으로 워커만 본다(AC-KOPS16).
  - `cluster.nodeCount` → `workerCount`/`controlPlaneCount`(`cluster-advisor.snapshot.ts`, `snapshot.types.ts`, `sanitize-snapshot.ts`). `supportTier`는 `eksSupportTier` 삭제에 따라 **항상 `null`** → `R-EKSVER`가 **발화하지 않는다**(규칙 자체 삭제는 P5).
- mock: **마스터 3대 추가**(`CONTROL_PLANE_SPECS`, `t3.medium`, AZ a/b/c, InstanceGroup `control-plane-ap-northeast-2<az>`). 워커 6대와 섞이지 않는다. DaemonSet은 실제 kOps처럼 마스터에도 파드를 올린다. 비용 mock 단가표에 `t3.medium`(0.052) 추가 — 없으면 마스터 3대가 "단가 없음"이 되어 AC-KOPS15를 mock에서 확인할 수 없다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/cluster/kube/extract.ts` | 수정 | 노드그룹 라벨 `kops.k8s.io/instancegroup` 하나만, `nodeRoleOf()`·`role` 추출, capacityType은 표준 라벨만 |
| `apps/api/src/cluster/model.ts` | 수정 | `NodeRole` 타입, `RawNode.role` |
| `apps/api/src/cluster/types.ts` | 수정 | `NodeItem.role`, `ControlPlaneMetricsBlock`, `ClusterMetricsBody.scope`·`controlPlane` |
| `apps/api/src/cluster/dto.ts` | 수정 | `NodesQueryDto.role`(worker/control_plane/all) |
| `apps/api/src/cluster/cluster-query.service.ts` | 수정 | 노드 목록 role 필터·`roleCounts`·`facets.roles`, series `scope` |
| `apps/api/src/cluster/state/evaluate.ts` | 수정 | 워커 기준 `areas.nodes`, `CLUSTER_NO_WORKER_NODES`·`CLUSTER_ALL_WORKERS_NOT_READY`, 메트릭 워커/마스터 분리 |
| `apps/api/src/cluster/state/metrics-ingest.service.ts` | 수정 | 클러스터 시계열 워커 기준 |
| `apps/api/src/cluster/state/cluster-state.service.ts` | 수정 | `K8S_CLUSTER_NAME`, 인벤토리 노드에 `role` |
| `apps/api/src/cluster/kube/kube-watcher.service.ts` | 수정 | EKS ARN 파싱(`clusterRegion`) 삭제 |
| `apps/api/src/cluster/cluster-advisor.snapshot.ts` | 수정 | 노드 `role`, 노드그룹에서 마스터 제외, `workerCount`/`controlPlaneCount`, `supportTier: null` |
| `apps/api/src/cluster/mock/mock-world.ts` | 수정 | 마스터 3대(`CONTROL_PLANE_SPECS`), `mkNode`의 role |
| `apps/api/src/config/env.validation.ts` | 수정 | `K8S_CLUSTER_NAME`, `SYSTEM_NAMESPACES` 기본값 |
| `apps/api/src/cost/store/cost-store.ts` | 수정 | **`controlPlaneUsdPerHour`**(조용한 저장 실패 수정), `byCategory.controlPlane` |
| `apps/api/src/cost/store/cost-store.spec.ts` | **추가** | Prisma 인자 이름 회귀 테스트(스키마 대조) 4건 |
| `apps/api/src/cost/cost.service.ts` | 수정 | `describeEksCluster` 호출 삭제·버전은 k8s API만, 표본 `controlPlane`, `eksSupportTier` 제거 |
| `apps/api/src/cost/cost.types.ts` | 수정 | `EksRow.supportTier` 삭제, `PriceBook.eks` 단일 quote, 배분 `controlPlaneUsdPerHour` |
| `apps/api/src/cost/estimate/allocation.ts` | 수정 | 마스터 EC2 → `shared_cluster`, `Acc.controlPlane` |
| `apps/api/src/cost/estimate/estimator.ts` | 수정 | `eksSupportTier` 입력·`supportTier` 출력 삭제 |
| `apps/api/src/cost/estimate/instance-types.ts` | **추가** | 구 `eks-support.ts`에서 인스턴스 타입 유틸만 남김 |
| `apps/api/src/cost/estimate/eks-support.ts` | **삭제** | `eksSupportTier`와 EKS 지원 일정표 제거 |
| `apps/api/src/cost/aws/aws-sdk.gateway.ts` | 수정 | 노드그룹 태그 교체, EKS 클라이언트·`describeEksCluster` 삭제 |
| `apps/api/src/cost/aws/aws-gateway.ts` | 수정 | 포트에서 `describeEksCluster` 삭제, 권한 목록 주석 |
| `apps/api/src/cost/pricing/price.service.ts` | 수정 | 확장 지원 단가 조회 삭제 |
| `apps/api/src/cost/cluster-inventory.port.ts` | 수정 | `InventoryNode.role`, 주석 정리 |
| `apps/api/src/cost/cluster-state.inventory.ts` | 수정 | 지문에 role 포함 |
| `apps/api/src/cost/cost.options.ts`, `cost/mock/mock-world.ts`, `cost/test-helpers.ts` | 수정 | `K8S_CLUSTER_NAME`, mock role·`t3.medium` 단가, FakeGateway 정리 |
| `apps/api/src/advisor/advisor.types.ts` | 수정 | `SnapshotSummary.workerCount`/`controlPlaneCount` |
| `apps/api/src/advisor/run/run-model.ts` | 수정 | 신선도 경고 2종 분리 + 옛 기록 방어 |
| `apps/api/src/advisor/snapshot/{snapshot.types.ts,sanitize-snapshot.ts,snapshot-builder.ts}` | 수정 | `nodes[].role`, `workerCount`/`controlPlaneCount` |
| `apps/api/src/advisor/precheck/{precheck-rules.ts,advisor-precheck.service.ts}` | 수정 | R-NODEIDLE 워커 한정, 빈 요약 필드 |
| `apps/api/src/advisor/mock/mock-fixtures.ts` | 수정 | 스냅샷 픽스처 role·카운트 |
| `apps/api/src/health/health.service.ts` | 수정 | 주석 문구 |
| `apps/api/package.json`, `apps/api/package-lock.json` | 수정 | `@aws-sdk/client-eks` 삭제 |
| `apps/api/src/cluster/cluster.http.spec.ts` | **추가** | 노드 목록 role 일관성·메트릭 분리 HTTP 테스트 5건 |
| `apps/api/src/cluster/state/evaluate.spec.ts` | 수정 | 워커 0대 장애·분리 집계 테스트 3건 추가 |
| `apps/api/src/cluster/kube/extract-raw.spec.ts` | 수정 | kOps 라벨·role 추출 테스트 5건 추가 |
| `apps/api/src/cost/estimate/allocation.spec.ts` | 수정 | 마스터 배분 제외 테스트 추가 |
| `apps/api/src/cost/{cost.service.spec.ts,cost.module.spec.ts,cluster-state.inventory.spec.ts,estimate/estimator.spec.ts}` | 수정 | 기대값·픽스처 갱신 |
| `apps/api/src/advisor/snapshot/snapshot-builder.spec.ts` | 수정 | `workerCount`/`controlPlaneCount` |
| `.env.example`, `docker-compose.yml`, `deploy/app.example.yaml` | 수정 | `K8S_CLUSTER_NAME`, `SYSTEM_NAMESPACES` 기본값, 문구 |
| `deploy/rbac.yaml` | 수정 | IRSA 주석 삭제 → U8 "확인 필요" (**권한 변경 없음**) |
| `docs/api/cluster-status.md`, `docs/api/aws-cost.md`, `docs/api/architecture-advisor.md` | 수정 | 구현 상태(무엇이 되고 무엇이 P3~P5인지) 변경 이력 추가, `SnapshotSummary`·신선도 코드 계약 정정 |

### 5. 주요 결정과 이유

**결정 A. 계약(`architecture-advisor.md`)을 고쳤다 — `SnapshotSummary.nodeCount` 누락.**
계약 3단계에서 스냅샷 `cluster.nodeCount`만 나누고 실행 기록 요약 `SnapshotSummary.nodeCount`는 그대로 뒀다. 그런데 **결과 신선도 경고(A.10)의 근거가 후자**다. 그대로 두면 "노드 수가 6 → 9로 바뀌었습니다"가 마스터와 워커를 섞어 센다. PM 지시(워커·마스터 각각 알릴 것)를 만족하려면 필드를 나눠야 하므로 계약의 A.1.2·A.10·C.11·변경 이력을 함께 고쳤다. 코드만 바꾸고 계약을 두면 문서와 구현이 어긋난다.

**결정 B. 비용 카테고리 이름(`'eks'`)은 P4에 남기고, DB 열과 배분 breakdown만 먼저 새 이름으로.**
카테고리 교체(AC-KOPS27)와 마스터 리소스 재분류는 P4다. 하지만 DB 열은 DBA가 이미 `control_plane_usd_per_hour`로 바꿨고, 안 맞추면 **표본 저장이 조용히 멈춘다**(PM 위험 1). 그래서 경계면(DB 열, 배분 응답 필드)만 새 이름으로 바꾸고 내부 카테고리 키는 `'eks'`로 남겼다. 이음매는 `cost.service.ts`의 `controlPlane: byCat.eks ?? 0` 한 줄이고 주석으로 P4를 가리킨다. 대안(카테고리까지 지금 교체)은 P4 재분류와 뒤섞여 리뷰가 어려워지고 지시 범위를 벗어난다.

**결정 C. 회귀 테스트는 생성 클라이언트가 아니라 `schema.prisma`와 대조한다.**
`Prisma.*ScalarFieldEnum`을 쓰면 `prisma generate`를 안 돌린 상태에서 옛 이름으로도 통과할 수 있다. 진실은 DBA가 관리하는 `schema.prisma`이므로 그 파일의 `model CostRateSample` 필드 이름을 파싱해 대조했다. 덤으로 "스키마에 `eks_usd_per_hour`가 없다"도 함께 고정된다.

**결정 D. `PriceBook.eks`를 단일 quote로 줄였다(확장 지원 단가 삭제).**
명세 3.5.4는 `eksSupportTier`(표준/확장 지원 단가)를 함께 삭제하라고 했다. 표준 단가 조회는 카테고리가 살아 있는 동안 필요하므로 남기고, **확장 지원 단가 조회(Pricing API 1회)만** 없앴다. P4에서 카테고리와 함께 통째로 사라진다.

**결정 E. mock에 마스터 3대를 지금 넣었다(P3의 `cp-*` 시나리오는 넣지 않음).**
AC-KOPS10·12가 "mock에서 확인할 수 있다"를 요구하고, PM도 mock 기동 확인을 지시했다. 마스터가 없으면 분리 집계가 동작하는지 볼 방법이 없다. 반대로 컨트롤 플레인 static pod·시나리오 6종은 P3의 상태 판단과 한 몸이라 넣지 않았다. AZ를 a/b/c로 흩은 것은 P3의 AZ 편중 판단에서 "정상" 기준선이 되게 하려는 것이다.

**결정 F. `capacityType` 라벨 해석을 쿠버네티스 표준 키 하나로.**
kOps는 구매 옵션 라벨을 붙이지 않는다(명세 3.3). EKS·Karpenter 키를 남기면 동작하지 않는 EKS 코드 경로가 남는다(AC-KOPS01). 비용 쪽은 이미 EC2 `InstanceLifecycle`을 1순위로 쓰므로 스팟 판별은 그대로 정확하다.

**결정 G. `supportTier`를 지우지 않고 `null` 고정.**
`eksSupportTier` 삭제는 P1, `R-EKSVER` 규칙 삭제와 스냅샷 필드 제거는 **P5**(AC-KOPS41)다. 필드를 지우면 P5 범위를 침범하므로 값을 `null`로 고정했다 — 규칙 조건이 `=== 'extended'`라 **더 이상 발화하지 않는다**(mock에서 확인). 죽은 코드가 P5까지 남는 것은 7절에 적었다.

**결정 H. `role=control_plane`의 `areaStatus`는 당분간 워커 영역 값.**
계약 3.1 표는 `areas.controlPlane`을 주라고 하지만 그 영역은 P3에서 생긴다. 400을 내거나 `unknown`을 지어내는 대신 **기존 값을 주고 계약 변경 이력에 "P3까지의 임시 동작"으로 명시**했다. 프런트가 P3 전에 컨트롤 플레인 섹션을 붙이지 않도록 경고도 같이 적었다.

**결정 I. `platform: 'eks'`를 그대로 뒀다(바꾸지 않음).**
스냅샷 `platform`을 `'kops'`로 바꾸는 것은 AC-KOPS43(P5)이다. 한 단어짜리 변경이고 분기하는 코드도 없지만, PM이 "P3~P5는 건드리지 마라"라고 명시했으므로 범위를 지켰다. 다만 **LLM에 "eks"가 그대로 전달된다**는 점에서 P5에서 가장 먼저 처리해야 할 항목이라 7절 맨 앞에 적었다.

### 6. 검증 결과

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과**(오류 0) | 새 HTTP 스펙에 `no-unsafe-*` disable 주석(기존 `cost.module.spec.ts`와 같은 방식) |
| `npm test --prefix apps/api` | **통과 — 43 suites / 416 passed, 1 skipped** | 기준선 398 passed / 1 skipped → **+18건**(신규 테스트) |
| `npm run build --prefix apps/api` (`nest build`) | **통과** | `dist/`의 옛 필드 이름 제거 |
| `npx tsc -p tsconfig.json --noEmit` | 오류 0 | |
| `npx prisma generate` | 성공 | `controlPlaneUsdPerHour` 반영 확인 |
| **역회귀**: `cost-store.ts`를 일부러 `eksUsdPerHour:`로 되돌림 | **테스트 2건 실패**(의도대로) | 원복 후 재통과. lint·tsc는 그대로 통과 |
| mock 기동 `PORT=3121 DATA_SOURCE=mock node dist/main` | 성공 | 자기 PID만 종료(아래) |
| `GET /api/cluster/nodes` | `role=worker`, `total=6`, `roleCounts={worker:6,control_plane:3,all:9}` | `facets.nodeGroups`에 `control-plane-*` 없음, `facets.roles=["worker","control_plane"]` |
| `GET /api/cluster/nodes?role=control_plane` | `total=3`, 마스터 3대(t3.medium, AZ a/b/c) | `facets.nodeGroups`가 전부 `control-plane-*` |
| `GET /api/cluster/nodes?role=all` / `?role=master` | 9대 / **400** | |
| `GET /api/cluster/metrics` | `scope={basis:worker, workerNodeCount:6, controlPlaneNodeCount:3}`, 워커 alloc 15560m, `controlPlane.cpu.allocatable=5790m` | 워커 CPU 사용률 40.8% vs 마스터 36.1% — 섞으면 값이 달라지는 것 확인(AC-KOPS12) |
| `GET /api/cluster/summary` | `areas.nodes` 5/6(워커 기준) | 9대로 합산되지 않음 |
| `GET /api/cost/estimate` / `/api/cost/allocation` | 추정 합계 $1.030115 = 배분 합계 $1.030115 (**오차 0**) | `shared_cluster.nodeUsdPerHour = 0.156` = 마스터 3 × $0.052, unpriced 0 (AC-KOPS15) |
| `GET /api/advisor/prechecks` | R-NODEIDLE 대상이 **워커 4대만**, R-GRAVITON 대상이 워커 노드그룹(system·batch), **R-EKSVER 없음** | AC-KOPS16 |
| `GET /api/advisor/snapshot-preview` | `cluster.workerCount=6, controlPlaneCount=3`, `nodes[].role` 9건, `nodeGroups`에 마스터 없음 | |
| 그 밖 GET(health·pods·workloads·events·pvcs·cost/summary·cost/status) | 200 | |
| 검증 프로세스 종료 | `Stop-Process -Id <내 PID>` 2회(2472, 25296)만 | **이미지 이름 일괄 종료 없음.** 종료 후 3121 LISTENING 0건 확인 |

**하지 않은 검증(그대로 적는다)**
- **실제 Postgres에서 마이그레이션·저장 확인 못 함**(DBA 요청 6). 이 환경에 Docker·psql이 없어 `DATABASE_URL` 없이(메모리 모드) 기동했다. 즉 `controlPlaneUsdPerHour`가 **실제 DB에 기록되는 것**은 확인하지 못했고, 스키마 필드 이름 대조 테스트로만 막았다. `docker compose`가 가능한 환경에서 `npm run db:migrate --prefix apps/api` 후 소모율 표본이 쌓이는지 한 번 봐야 한다.
- **live 클러스터 확인 못 함**: U2(API LB 태그·이름), U4(미러 파드 이름), U5(추가 static pod), U8(kOps에서 파드에 AWS 권한). kOps 클러스터가 없다. 실제 노드에 `kops.k8s.io/instancegroup` 라벨이 들어오는지도 mock으로만 확인했다.
- `apps/web`은 손대지 않았다(frontend·publisher 영역). 프런트 픽스처는 아직 `eksUsdPerHour`·`nodeCount`를 쓰므로 화면은 지금 상태로는 배분 breakdown의 컨트롤 플레인 금액을 못 읽는다(8절 요청).

### 7. 남은 이슈·한계

1. **P5 미구현이라 남은 EKS 흔적 중 가장 눈에 띄는 것**: 어드바이저 스냅샷의 **`platform: 'eks'`**(`snapshot.types.ts`, `sanitize-snapshot.ts`, `mock-fixtures.ts`). 값만 바꾸면 되는데 P5 범위라 두었다. 그 상태로 로컬 Claude Code에 "eks"가 전달된다 — **P5에서 가장 먼저 바꿀 것**(AC-KOPS43).
2. **P3 미구현**: `GET /api/cluster/control-plane`, `areas.controlPlane`, `attention`의 `area: 'control_plane'`, SSE `cluster.controlplane.updated`, `CONTROL_PLANE_*` 이유 코드, `CONTROL_PLANE_HA_EXPECTED`, mock `cp-*` 시나리오 6종. 개요 요약 띠의 "· 컨트롤 플레인 3/3" 부제도 이 영역이 생겨야 나온다 → **AC-KOPS10의 부제 부분은 아직 미충족**(노드 수가 워커 기준이 된 것까지만 됨).
3. **`role=control_plane`의 `areaStatus`가 워커 영역 값**(결정 H). P3에서 교체.
4. **P4 미구현**: 카테고리 `controlPlane`·`ControlPlaneCostKind`·`byKind`·`api_lb` 식별·`CLUSTER_NAME_NOT_CONFIGURED`·도움말 문구. 지금은 마스터 EC2·etcd EBS·마스터 IPv4가 여전히 `ec2`·`ebs`·`ipv4` 카테고리에 있고, `eks` 카테고리는 **kOps에 존재하지 않는 관리 요금**을 계속 계산한다(mock $0.1/h). **배분만 먼저 마스터를 공용으로 옮겼다.**
5. **그 밖의 P5 잔여**: `R-EKSVER` 규칙 코드(발화하지 않음)와 `SnapshotCluster.supportTier` 필드, `sanitize-snapshot.ts`의 인스턴스 ID 가명(AC-KOPS44), mock 세계의 `amazon-cloudwatch` 네임스페이스·`-eks-` kubelet 버전·ECR 이미지·클러스터 이름 `prod-eks`·워커 노드그룹 이름(`system`/`batch`/`app`)·노드 이름 `ip-10-…`(AC-KOPS46).
   - **부작용 주의**: `SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch`를 뺐으므로 **mock에서 그 네임스페이스가 이제 "시스템 아님"으로 보인다**(파드·워크로드 목록의 "시스템 숨기기"에 걸리지 않는다). P5 mock 정리에서 함께 없애야 자연스러워진다.
   - `allocation.ts`의 `DEFAULT_SYSTEM_NAMESPACES`와 `precheck-rules.ts`의 시스템 네임스페이스 목록에도 `amazon-cloudwatch`·`karpenter` 등이 남아 있다(`SYSTEM_NAMESPACES` env와 별개 상수). 셋을 한꺼번에 맞추는 것이 안전해 P5로 미뤘다.
   - `cost/explorer/service-names.ts`의 `'Amazon Elastic Container Service for Kubernetes': 'EKS'`는 **AWS가 돌려주는 실제 청구 서비스 이름 매핑**이라 kOps 계정에 안 나타날 뿐 틀린 값이 아니다. 지우면 과거 청구 내역 라벨이 깨지므로 두었다.
6. **DBA 요청 5(`cost.spike.rate.baselineFrom`) 미반영.** 값이 `null`이면 지금과 동작이 같아 깨지는 것은 없지만, **전환 시점 급증 오탐 방지 효과도 아직 없다.** P4에서 `cost-status.ts`·`cost.service.ts`와 함께 처리 예정.
7. **mock 마스터의 노드 이름이 `ip-10-0-…` 형태**다. kOps 실환경에서는 `i-0…`가 될 수 있지만(F10) 이름 규칙 전면 교체는 AC-KOPS46(P5)이라 지금은 워커와 같은 형태로 맞췄다.
8. `SnapshotSummary.instanceTypes`에는 **마스터 타입도 들어간다**(`t3.medium × 3`). 노드그룹이 아니라 노드에서 집계하기 때문이다. 마스터 타입 변경도 `INSTANCE_TYPES_CHANGED`로 알리는 편이 맞다고 보고 그대로 뒀다.
9. live 모드에서 **클러스터 인벤토리를 쓸 수 없으면 `resources.eks[]` 행 자체가 사라진다**(전에는 `eks:DescribeCluster`로 채웠다). 클러스터 버전을 모르면 컨트롤 플레인 행을 만들 근거가 없기 때문이다. P4에서 마스터 노드 기반으로 재구성되면 같은 성질(클러스터 연결 필요)이 유지된다.

### 8. 다른 담당 요청

- **frontend 요청 1 (지금 어긋나 있음)**: 배분 breakdown 필드가 `eksUsdPerHour` → **`controlPlaneUsdPerHour`**로 바뀌었다. `apps/web/src/features/aws-cost/types.ts`와 `apps/web/src/features/__fixtures__/fixtures.ts`를 함께 바꿔야 "공용(클러스터)" 행의 컨트롤 플레인 금액이 화면에 뜬다. **카테고리 이름(`eks`)은 아직 그대로이므로 카테고리 라벨·순서는 지금 바꾸지 말 것**(P4에서 다시 요청한다).
- **frontend 요청 2**: `GET /api/cluster/nodes`가 기본 **워커만** 준다. 화면이 "총 N대"를 그대로 쓰면 이제 워커 수다. `roleCounts`(worker/control_plane/all)와 `facets.roles`를 서버가 주므로 화면에서 더하지 말 것. `NodeItem.role`이 모든 노드 응답에 있다.
- **frontend 요청 3**: `GET /api/cluster/metrics`에 `scope`와 `controlPlane` 블록이 생겼다. **`cpu`/`memory`와 `controlPlane`을 더하면 안 된다**(전체가 아니다). `metrics/series?target=cluster`에는 `scope: {basis:'worker'}`가 붙는다.
- **frontend 요청 4 (주의)**: `GET /api/cluster/control-plane`은 **아직 라우트가 없다**(P3). 지금 붙이면 404다.
- **PM 요청 1**: `docker compose`가 되는 환경에서 `npm run db:migrate --prefix apps/api` 한 번 + 소모율 표본이 실제 DB에 쌓이는지 확인(DBA 요청 6과 같은 건). 이 PC에 Docker·psql이 없어 못 했다.
- **PM 요청 2**: kOps 실클러스터 접근이 가능해지면 U2(API LB 태그·이름 — 1순위)·U4·U5·U8을 확인할 수 있게 해 달라. P4의 `api_lb` 식별이 여기에 걸려 있다.
- **planner/PM 참고**: 명세 10.5의 줄 번호는 이번에도 여러 곳이 어긋났다(파일 경로는 맞다). 전부 검색으로 찾아 처리했다.

### 9. 다음 담당이 알아야 할 점

- **`npm ci`/`npm install` 후 `prisma generate`가 필요하다**(postinstall에 있음). 안 돌리면 `controlPlaneUsdPerHour` 타입이 없어 빌드가 깨진다.
- **환경 변수 이름이 바뀌었다**: `EKS_CLUSTER_NAME` → `K8S_CLUSTER_NAME`. 구 이름은 **읽지 않는다.** 로컬 `.env`가 있으면 직접 고쳐야 한다(안 고치면 클러스터 표시 이름이 kubeconfig 컨텍스트 값이 되고, live 비용의 EC2 태그 필터가 빈 값이 된다).
- **`SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch`가 빠졌다.** 계속 시스템으로 보고 싶으면 env로 추가한다.
- **노드 목록 기본이 워커다.** 마스터는 `?role=control_plane`, 전부는 `?role=all`. 비용 EC2 행은 마스터를 포함하므로 숫자를 맞출 때 `role=all`을 쓸 것(테스트에도 그렇게 적어 뒀다).
- **P4를 할 사람에게**: 카테고리 교체는 `cost.types.ts`의 `CostCategory`에서 시작해 `cost-status.ts`(switch 3곳), `estimator.ts`, `cost.service.ts`의 `Record<'ec2'|…>` 캐스팅과 `controlPlane: byCat.eks ?? 0` 이음매, `snapshot.types.ts`를 훑으면 된다. **DB 열과 배분 필드는 이미 새 이름이라 건드릴 필요가 없다.**
- **P3을 할 사람에게**: 마스터 판별은 `RawNode.role`/`NodeItem.role` 하나로 통일돼 있다(`extract.ts`의 `nodeRoleOf`). mock에는 마스터 3대가 이미 있고 static pod는 없으므로, `cp-*` 시나리오를 만들 때 미러 파드부터 추가해야 한다.

---

## 2026-09-24 09:40 · 구현 P3·P4 (컨트롤 플레인 상태 + 비용 모델)

### 1. 요청 내용

PM 지시: **P3(AC-KOPS18~26)·P4(AC-KOPS27~35)**. P5는 이후 별도.

- **0번(P5 항목이지만 앞당김)**: 어드바이저 스냅샷 `platform: 'eks'` → `'kops'`. P1·P2에서 범위를 지켜 남겨 둔 것은 옳았으나, 그 결과 **잘못된 환경 정보가 로컬 Claude Code로 전달되고 있다.**
- **P3**: `GET /api/cluster/control-plane` 신설(프런트가 404를 알고 대기 중), 마스터 대수·HA·쿼럼·static pod 상태, 지속 조건·쿼럼 규칙을 **한곳에** 모아 설정으로(`CONTROL_PLANE_HA_EXPECTED` 포함), **AC-KOPS21이 핵심**(마스터 NotReady면 파드가 `Running`이어도 `notReporting`으로 강제), mock 시나리오 6개 + `kube-auth-failed`, SSE `cluster.controlplane.updated`(**새 토픽 금지**).
- **디자인·퍼블리싱 요청 4건**: ① `columns[].reason`(열 머리 툴팁, 마스터 표 사유와 같은 값) ② 셀 `detail`은 짧은 쪽부터 + `tooltip` 동봉(**툴팁 없이 자르는 것 금지**) ③ 요약의 "알 수 없음"에 `notReporting` + `missing` 합산 ④ **매트릭스에 빈 칸 금지**(파드가 없으면 서버가 `missing`으로 채움).
- **P4**: 카테고리 `'eks'` → `'controlPlane'`과 P1·P2에서 남긴 이음매 정리, 하위 종류 5종, **중복 계상 금지(AC-KOPS29)**, **AWS 호출 증가 금지**, `api_lb`는 U2 미확인이므로 후보 규칙 + "추정" 라벨 + 0/1/N 동작, `baselineFrom` 반영.
- 하지 않을 것: P5(인증 문서·metrics-server 문구·어드바이저 규칙 정리·브리지 프롬프트·mock kOps 형태 정리·가명 규칙), `apps/web/**`, `apps/api/src/database|prisma/**`, `deploy/rbac.yaml` 권한 확대.
- 검증: lint·test·build(기준선 416/1 skipped), mock 시나리오 6개 전부 전환, 카테고리 합계 = 추정 합계, 배분 합계 = 추정 합계, 포트 3121, 자기 PID만 종료.

### 2. 참고한 문서

- `docs/api/cluster-status.md` — 1.6(`ControlPlaneComponent`·`cellState` 7종·대응표), 2.1(`areas.controlPlane`), **3.3(`GET /api/cluster/control-plane` 전체)**, 8.2(SSE), 9절 이유 코드 14개, **9.1 판단 요약표**, 11절 환경 변수
- `docs/api/aws-cost.md` — 1절(`CostCategory`·`ControlPlaneCostKind`), **3.1**(`categories[].byKind`·`apiLb`·`resources.controlPlane[]`·컨트롤 플레인 분류 규칙·**API 서버 LB 후보 규칙과 0/1/N 표**), 3.1.1 화면 문구, 3.2 배분, 3.6/8절 `baselineFrom`
- `docs/api/common.md` 2.3·2.4(`KUBE_AUTH_FAILED`, mock 대체 금지), 6.1 mock 시나리오 목록
- `docs/specs/kops-support.md` 3.2(컨트롤 플레인 판단)·3.5(비용 모델)·5절 P3·P4 수용 기준
- `docs/reports/kops-support/dba.md` 8절 요청 5(`baselineFrom` 반영 방법)

### 3. 작업 내용

#### (0) 어드바이저 스냅샷 `platform`

`snapshot.types.ts`·`sanitize-snapshot.ts`·`mock-fixtures.ts`·`cluster-advisor.snapshot.ts` 4곳에서 `'eks'` → **`'kops'`**. 분기하는 코드가 없어 값 교체만으로 끝난다. mock 스냅샷 미리보기로 확인했다.

#### (1) P3 — 컨트롤 플레인 상태

**새 파일 `apps/api/src/cluster/state/control-plane.ts`** (순수 함수). 입력은 이미 watch 중인 nodes·pods 캐시뿐이라 **새 RBAC·새 조회가 없다**.

- **기준값을 한곳에**: `CONTROL_PLANE_RULES`(보고 판정 Ready 값, 구성요소 Ready 아님 120초, 마스터 NotReady 60초, 재시작 1/3회, **`vitalKinds`**=`kube-apiserver`·`etcd-manager-main`, `notComponentPrefixes`, 대표 사유 우선순위). 9.1의 "기준값은 한곳에 모으고" 요구.
- **구성요소 식별은 2중 조건**: ① `role: 'control_plane'` 노드 + `kube-system` ② 이름이 5종 접두어로 시작. `componentKindOf()`는 **긴 접두어 우선**으로 맞추고 `kube-apiserver-healthcheck`를 제외 목록으로 뺀다 — 안 그러면 healthcheck가 `kube-apiserver`로 오인돼 "구성요소 2개"가 된다.
- **AC-KOPS21(핵심)**: 마스터의 `ready.value !== 'True'`면 `reporting: false`이고, 그 마스터의 **5칸 전부**가 `not_reporting`(파드가 `Running`이어도). `status: unknown`, `ready: null`, `clickable: false`, `lastReportedAt` = 노드 Ready 조건의 `since`. `not_reporting`이 `missing`보다 **우선**한다(파드가 안 보이는 게 삭제인지 보고 중단인지 알 수 없으므로).
- **빈 칸 없음**: 마스터 × 5종을 **항상** 만든다. 파드가 없으면 `missing`(필수 5종 중 `kube-apiserver`·`etcd-manager-main`이 없으면 critical, 4/5면 warning), kube 출처 stale이면 `stale`(마지막 판단 유지).
- **셀 문구**: `cellText`(Ready/주의/장애/노드 미보고/없음/데이터 오래됨) + `cellDetail`(**짧은 쪽**: `CrashLoopBackOff · 재시작 4회`, `마지막 보고 04:58`) + **`cellTooltip`**(잘리면 안 되는 전체 문장). 디자이너 요청 2.
- **집계**: `byKind`(ready/expected/status, vital이 보고 중인 모든 마스터에서 Ready 아니면 critical, 과반 중단도 critical), `cellCounts`(7종 + **`unknownTotal` = notReporting + unknown + missing**), `summaryText`, **`columns[]`**(열 머리 — `nodeName`·`reporting`·`lastReportedAt`·`worst`·**`reason`**=마스터 표 사유와 같은 값).
- **마스터 판단**: 쿼럼(`requiredReady = floor(N/2)+1`, `lost` / `at_risk`(N≥2 & Ready==required) / `ok`), `haStatus`(3대 이상 홀수 ok / 1대 single / 짝수 even), `zoneSpread`, cordon, **워커 파드 경고**.
- **대표 사유 정렬**: 계약 9절 우선순위 + **등급 우선**. 등급을 무시하면 `status`는 장애인데 `headline`은 주의 문장이 되어 화면이 거짓말을 한다(mock에서 실제로 재현돼 고쳤다).
- **파드 이유 코드 → 컨트롤 플레인 코드 변환**: `POD_WAITING_*` → `CONTROL_PLANE_COMPONENT_WAITING`, `POD_RESTARTS_1H` → `…_RESTARTS`, `POD_OOM_RECENT` → `…_OOM`, 그 밖 → `…_NOT_READY`. 문장 앞에 구성요소 이름을 붙인다.
- **연결**: `evaluate.ts`가 `ClusterView.controlPlane`·`areas.controlPlane`·`attention(area: 'control_plane')`을 만들고, `overall`에 포함된다. `overview.service.ts`의 **`nav.nodes` = 워커 영역·컨트롤 플레인 영역의 최악**(PM 결정 Q2, 메뉴 신설 없음), `nav.stale.nodes`도 합산.
- **라우트**: `GET /api/cluster/control-plane`(쿼리 없음, 항상 200). `GET /api/cluster/nodes?role=control_plane`의 `areaStatus`가 이제 `areas.controlPlane`이다(P1·P2 임시 동작 해소).
- **SSE**: 기존 `cluster` 토픽에 `cluster.controlplane.updated`(단일 객체 전체 교체) + `cluster.snapshot`에 `controlPlane`. **새 토픽 없음.** 변경 감지에서 `lastReportedAt`은 제외했다(매 평가마다 바뀌는 파생 시각이라 그대로 두면 이벤트가 끊임없이 나간다).
- **설정**: `CONTROL_PLANE_HA_EXPECTED`(기본 true, `1/true/yes/on`·`0/false/no/off` 허용). `.env.example`·`docker-compose.yml`에도 추가.
- **mock**: 마스터마다 static pod 5종 + 기타 2종(`kops-controller`, `kube-apiserver-healthcheck`) 미러 파드 추가(owner.kind=Node, hostNetwork). 시나리오 7개 신설:
  - `cp-healthy`(3대 정상), `cp-single`(1대), `cp-node-down`(1대 Unknown 4분), `cp-quorum-lost`(2대 다운), `cp-component-crash`(한 마스터 `kube-scheduler` CrashLoop 4회 + 다른 마스터 `etcd-manager-events` 파드 없음), `cp-not-found`(마스터 0대), `kube-auth-failed`(출처 `unavailable` + `KUBE_AUTH_FAILED`).
  - `kube-auth-failed`는 **빈 세계**를 만든다(인증이 막히면 아무것도 조회할 수 없다). 노드 목록이 0개가 되고 mock 데이터로 채워지지 않는다.
- **`KUBE_AUTH_FAILED` 이유 코드**: `SourceView.errorCode`를 평가 입력에 추가해 `kubeSourceReason`이 인증 실패를 따로 알린다(전에는 전부 `SOURCE_UNAVAILABLE`).
- **워커 파드 수 계산**에서 **DaemonSet 파드는 뺐다**. CNI·로그 수집 DaemonSet은 설계상 모든 노드에 올라가므로 세면 경고가 상시 켜져 Q6 경고의 의미가 사라진다(mock에서 실제로 그렇게 나왔다).

#### (2) P4 — 비용 모델

- **타입**: `CostCategory`의 `'eks'` → `'controlPlane'`(순서 고정), `ControlPlaneCostKind` 5종 + 라벨, `ControlPlaneRow`(한 배열에 여러 종류, `kind`로 구분), `CategoryRow.byKind`·`apiLb`·`notes`. `EksRow`·`AwsEksCluster`·`AwsResourceSnapshot.eks`·`PriceBook.eks`·`PriceNeedList.eks`·`eksQuote()`를 **전부 삭제**했다.
- **분류(estimator.ts)**: 노드 `role`에서 출발한다(EC2 역할 태그에 의존하지 않는다 — U3 미확인).
  - `master_ec2`: 마스터 노드의 EC2 행을 `ec2` 대신 `controlPlane`으로.
  - `master_ipv4`: 마스터 인스턴스의 퍼블릭 IPv4.
  - `master_root_ebs` / `etcd_ebs`: 마스터에 붙어 있고 **PVC가 아닌** 볼륨 — 루트면 root, 아니면 etcd. `etcdCluster`는 **항상 null**(main/events 태그 규칙 미확인).
  - `api_lb`: 클러스터 태그가 있고 Service·Ingress에 귀속되지 않는 LB. 1개면 `assumed`, 2개 이상이면 **전부 넣고** `ambiguous`(빼면 총액이 더 틀린다), 0개면 행 없음 + `not_found` **정보**. `lb` 카테고리에서는 빠진다.
- **`priceNeedsOf`에 컨트롤 플레인 행을 포함**시켰다. 빠뜨리면 마스터·etcd·API LB가 통째로 "단가 없음"이 된다(처음에 실제로 그랬다).
- **`categories[].apiLb`는 후보 0개여도 항상 있다**(AC-KOPS30, 화면이 "행 없음"으로 세 경우를 구분하지 않도록).
- **배분(allocation.ts)**: `resources.controlPlane` 전체가 `shared_cluster`의 **`controlPlaneUsdPerHour`**로 간다(P1·P2에서는 마스터 EC2가 `nodeUsdPerHour`였다). 금액을 옮기기만 하므로 합계 불변식은 유지된다.
- **이음매 정리**: `cost.service.ts`의 `controlPlane: byCat.eks ?? 0` → `byCat.controlPlane`, `Record<... 'eks' ...>` 캐스팅, 빈 추정의 `resources`.
- **`CLUSTER_NAME_NOT_CONFIGURED`**(AC-KOPS33): live + `K8S_CLUSTER_NAME` 빈 값이면 추정 전체를 `available: false`로 두고 `awsResources` 출처를 `not_configured`로 표시한다. mock 값을 섞지 않는다.
- **`baselineFrom`**(DBA 요청 5): `RateSpikeSettings.baselineFrom?: string | null` + **`baselineSince(now, s)`**(=`baselineDays`와 `baselineFrom` 중 늦은 쪽). `computeRateBaseline`과 `cost.service.ts`의 표본 조회 하한에 함께 적용. `null`·형식 오류면 지금까지와 완전히 같은 동작이다. 설정 PATCH DTO에는 열지 않았다(5절 결정 D).
- **급증 원인 문장**: `SampleResource.kind`가 `controlPlane`일 때 하위 종류 라벨(마스터 EC2/etcd 볼륨/…)을 쓰도록 `cost-status.ts`의 추가·삭제·변경 문장을 바꿨다. `option`에 하위 종류를 담는다.
- **mock**: 마스터마다 etcd 볼륨 2개(gp3 20GB) + 마스터 퍼블릭 IPv4 1개를 추가해 `byKind` 5종이 모두 보인다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/cluster/state/control-plane.ts` | **추가** | 컨트롤 플레인 판단 전체(규칙 상수·셀·집계·사유) |
| `apps/api/src/cluster/state/control-plane.spec.ts` | **추가** | 판단 테스트 13건(AC-KOPS17·20~24·26) |
| `apps/api/src/cluster/state/evaluate.ts` | 수정 | `controlPlane` 평가 연결, `areas.controlPlane`, `attention`, `overall`, `KUBE_AUTH_FAILED` 이유 |
| `apps/api/src/cluster/state/cluster-state.service.ts` | 수정 | `CONTROL_PLANE_HA_EXPECTED`, 출처 `errorCode` 전달 |
| `apps/api/src/cluster/types.ts` | 수정 | `ControlPlaneComponent`(+`cellTooltip`)·`ControlPlaneBody`(+`columns`·`unknownTotal`)·`areas.controlPlane`·`AttentionArea` |
| `apps/api/src/cluster/cluster-query.service.ts` | 수정 | `controlPlane()` 조회, `role=control_plane`의 `areaStatus` |
| `apps/api/src/cluster/cluster.controller.ts` | 수정 | `GET /api/cluster/control-plane` |
| `apps/api/src/cluster/cluster-topics.ts` | 수정 | `cluster.controlplane.updated`, 스냅샷 `controlPlane`, 변경 감지에서 `lastReportedAt` 제외 |
| `apps/api/src/cluster/overview.service.ts` | 수정 | `nav.nodes`·`nav.stale.nodes`에 컨트롤 플레인 합산 |
| `apps/api/src/cluster/mock/mock-world.ts` | 수정 | static pod 미러 파드, 시나리오 7개, 마스터 대수 분기 |
| `apps/api/src/cluster/mock/mock-cluster.service.ts` | 수정 | `kube-auth-failed` 출처 상태·빈 세계 |
| `apps/api/src/config/env.validation.ts` | 수정 | `CONTROL_PLANE_HA_EXPECTED` |
| `apps/api/src/cluster/cluster.http.spec.ts` | 수정 | `/control-plane` 라우트·빈 칸 없음·`areaStatus` 테스트 2건 추가 |
| `apps/api/src/cost/cost.types.ts` | 수정 | `controlPlane` 카테고리·`ControlPlaneCostKind`·`ControlPlaneRow`·`CategoryRow.byKind/apiLb/notes`, EKS 타입 삭제 |
| `apps/api/src/cost/estimate/estimator.ts` | 수정 | 컨트롤 플레인 분류·`api_lb` 후보 규칙·`byKind`·`priceNeedsOf` 확장 |
| `apps/api/src/cost/estimate/allocation.ts` | 수정 | `resources.controlPlane` → `shared_cluster` |
| `apps/api/src/cost/cost.service.ts` | 수정 | 이음매 정리, `CLUSTER_NAME_NOT_CONFIGURED`, `baselineSince` 적용, EKS 조회 잔재 삭제 |
| `apps/api/src/cost/status/cost-status.ts` | 수정 | `baselineFrom`·`baselineSince`, 급증 원인 문장 |
| `apps/api/src/cost/pricing/price.service.ts` | 수정 | `eksQuote` 삭제 |
| `apps/api/src/cost/mock/mock-world.ts` | 수정 | etcd 볼륨 6개·마스터 퍼블릭 IPv4, eks 리소스·단가 삭제 |
| `apps/api/src/cost/test-helpers.ts` | 수정 | EKS 필드 삭제 |
| `apps/api/src/advisor/snapshot/{snapshot.types.ts,sanitize-snapshot.ts}` | 수정 | `platform: 'kops'`, 비용 카테고리 `controlPlane` |
| `apps/api/src/advisor/mock/mock-fixtures.ts` | 수정 | `platform`·카테고리 |
| `apps/api/src/cluster/cluster-advisor.snapshot.ts` | 수정 | `platform: 'kops'` |
| `apps/api/src/cost/{cost.service.spec.ts,cost.module.spec.ts,estimate/*.spec.ts,status/cost-status.spec.ts}` | 수정 | 기대값 갱신 + P4 테스트 6건·`baselineFrom` 테스트 4건 추가 |
| `.env.example`, `docker-compose.yml` | 수정 | `CONTROL_PLANE_HA_EXPECTED` |
| `docs/api/cluster-status.md` | 수정 | `cellTooltip`·`columns[]`·`unknownTotal` 계약 추가, P3·P4 변경 이력 |
| `docs/api/aws-cost.md` | 수정 | P4 변경 이력(카테고리 전환·중복 금지·`api_lb` 한계·`baselineFrom`) |
| `docs/api/architecture-advisor.md` | 수정 | `platform: 'kops'` 반영 |

### 5. 주요 결정과 이유

**결정 A. `kube-apiserver-healthcheck`를 제외 목록으로 뺐다.**
계약의 식별 규칙은 "이름이 5종 접두어로 시작"인데, `kube-apiserver-healthcheck-<노드>`는 `kube-apiserver`로 시작한다. 그대로 두면 한 마스터에 `kube-apiserver` 파드가 2개로 보이고, healthcheck가 죽으면 apiserver 장애로 오인된다. 긴 접두어 우선 매칭 + 제외 목록 한 줄로 막았다. U5(추가 static pod 목록)가 확정되면 이 목록만 고치면 된다.

**결정 B. 대표 사유 정렬에 "등급 우선"을 넣었다.**
계약 9절의 우선순위만 쓰면 `cp-component-crash`에서 `status: critical`인데 `headline`이 주의 문장(`구성요소 4/5`)으로 나왔다. 화면은 `headline`을 그대로 찍으므로 **배지와 문장이 어긋난다.** 등급 → 계약 우선순위 순으로 정렬해 항상 최악 사유가 대표가 되게 했다.

**결정 C. 워커 파드 수에서 DaemonSet을 뺐다.**
Q6 경고("마스터에 워커 파드 N개")의 목적은 "마스터에 워커 워크로드를 올린 구성"을 알리는 것이다. CNI·kube-proxy·로그 수집 DaemonSet은 kOps에서도 마스터에 올라가는 것이 정상이라, 세면 mock에서 경고가 상시 켜졌다. 상시 켜진 경고는 아무도 읽지 않는다.

**결정 D. `baselineFrom`을 설정 PATCH DTO에 열지 않았다.**
DBA가 backend 판단에 맡긴 항목이다. ① 운영자가 손으로 바꿀 값이 아니다(마이그레이션이 넣는다) ② 설정 병합이 스프레드라 다른 항목을 PATCH해도 값이 보존된다 ③ DTO에 열면 `whitelist: true` 환경에서 실수로 `null`을 보내 기준선 보호가 풀릴 수 있다. 되돌리기는 DBA의 down SQL이 담당한다.

**결정 E. `api_lb` 후보 규칙의 부작용을 그대로 두고 경고로 처리.**
후보 규칙은 "클러스터 태그가 있고 쿠버네티스에 귀속되지 않는 LB"다. 그래서 bastion LB나 사람이 만든 LB도 후보가 된다. 기존 mock의 `nlb-shared`(공용 행이던 LB)가 실제로 `api_lb`로 넘어갔다. **U2가 확정되기 전에 규칙을 좁히면 진짜 API LB를 놓칠 수 있고, 넓히면 오분류가 난다.** 계약대로 넓게 잡고 2개 이상이면 `ambiguous` 경고를 띄우는 쪽을 유지했다(금액은 합산 — 빼면 총액이 더 틀린다). 테스트와 계약 변경 이력에 이 한계를 적었다.

**결정 F. SSE 변경 감지에서 `lastReportedAt`을 뺐다.**
보고 중인 마스터의 `lastReportedAt`은 평가 시각이라 매 틱 바뀐다. 그대로 두면 `cluster.controlplane.updated`가 15초마다(그리고 파드가 바뀔 때마다) 끝없이 나간다. 값은 응답에 그대로 두고 **변경 감지 키에서만** 제외했다.

**결정 G. `kube-auth-failed`는 빈 세계로 만든다.**
인증이 막히면 대시보드는 노드·파드를 하나도 못 읽는다. 데이터를 남겨 두면 "출처는 실패인데 목록은 가득" 이라는 실제로 불가능한 상태가 되어 프런트가 검증할 수 없다. `no-cluster`와 같은 방식으로 빈 세계 + 출처 `unavailable`(`KUBE_AUTH_FAILED`)로 했다.

**결정 H. `etcdCluster`는 항상 `null`.**
마스터에 붙은 비-PVC 볼륨을 etcd 볼륨으로 보는 것까지는 근거가 있지만(F6), main/events를 가르는 태그 규칙은 확인하지 못했다. 추측해서 `main`/`events`를 붙이면 **틀려도 아무도 모른다.** 계약대로 `null`로 두고 화면은 "etcd 볼륨"으로만 적는다.

### 6. 검증 결과

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과**(오류 0) | |
| `npm test --prefix apps/api` | **통과 — 44 suites / 440 passed, 1 skipped** | 기준선 416 → **+24건** |
| `npm run build --prefix apps/api` | **통과** | |
| `npx tsc --noEmit` | 오류 0 | |
| mock 시나리오 **7개 전환**(`cp-healthy`·`cp-single`·`cp-node-down`·`cp-quorum-lost`·`cp-component-crash`·`cp-not-found`·`kube-auth-failed`) | **전부 재현** | 아래 표 |
| `cp-healthy` | `ok` · `마스터 3/3 Ready · 구성요소 15/15` | 15칸 모두 ok |
| `cp-single` | `warning` · `마스터 1대 (HA 아님)` | `haStatus: single` |
| `cp-node-down` | `warning` · `마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실` | 그 마스터 5칸 `not_reporting`, `마지막 보고 23:14`, `quorum.state: at_risk` (**AC-KOPS21**) |
| `cp-quorum-lost` | `critical` · `쿼럼 상실 — 마스터 1/3 Ready` | 10칸 not_reporting |
| `cp-component-crash` | `critical` · `kube-scheduler CrashLoopBackOff · 최근 1시간 재시작 4회` | 장애 1칸 + `missing` 1칸, `byKind.kube-scheduler = 2/3 critical` |
| `cp-not-found` | `unknown` · `컨트롤 플레인 노드를 찾을 수 없습니다` | `found: false`, 워커 집계·나머지 화면 정상 (**AC-KOPS17**) |
| `kube-auth-failed` | `unknown` · `인증 실패 — 토큰이 만료됐을 수 있습니다` | 노드 목록 `total: 0` — **mock 데이터로 대체되지 않음**(AC-KOPS38) |
| `CONTROL_PLANE_HA_EXPECTED=false` + `cp-single` | `ok` · `마스터 1/1 Ready · 구성요소 5/5`, `haExpected: false` | AC-KOPS23 |
| `GET /api/cluster/control-plane` | 200, `components.items` 15개(빈 칸 0), `columns` 3개, `masters.totals` == `/metrics`의 `controlPlane` | |
| `GET /api/cost/estimate` (mock) | 총 $0.959809, **카테고리 합계 $0.959809 (오차 0)**, unpriced 0 | AC-KOPS29 |
| `controlPlane` 카테고리 | 16개 = `master_ec2×3 $0.156` + `etcd_ebs×6 $0.014994` + `master_root_ebs×3 $0.007497` + `api_lb×1 $0.0225` + `master_ipv4×3 $0.015` | **etcd 볼륨 6개**(AC-KOPS28), `apiLb: assumed(1)` |
| `GET /api/cost/allocation` | 총 $0.959809 = **배분 합계 $0.959809 (오차 0)**, `shared_cluster.controlPlaneUsdPerHour = 0.215991` | AC-KOPS15·AC-KOPS29 |
| `GET /api/advisor/snapshot-preview` | `cluster.platform: "kops"` | 0번 |
| 그 밖 GET 12개(health·overview·summary·nodes·metrics·cost/*·advisor/*) | 전부 200 | |
| 검증 프로세스 종료 | `Stop-Process -Id <내 PID>`만 (12660, 22456, 13308, 23772, 22684) | **이미지 이름 일괄 종료 없음.** 마지막에 3121 LISTENING 0건 확인 |

**하지 않은 검증(그대로 적는다)**
- **실제 Postgres 미검증**(P1·P2와 같음). Docker·psql이 없어 메모리 모드로만 기동했다. `baselineFrom`은 **설정값이 `null`인 상태로만** 확인했다 — 마이그레이션이 값을 넣은 실제 DB에서 "기준 수집 중"으로 바뀌는 것은 단위 테스트로만 고정했고 실기 확인은 못 했다.
- **live kOps 클러스터 없음**: U2(API LB 이름·태그), U4(미러 파드 이름 규칙), U5(추가 static pod 목록) 전부 미확인. 지금 구현은 mock과 계약 기준이다. **U4가 틀리면 구성요소가 통째로 `missing`으로 보인다** — 접두어 목록 한 줄만 고치면 되도록 상수로 모아 뒀다.
- **SSE 이벤트를 실제로 구독해 확인하지 못했다.** `cluster.controlplane.updated`는 코드 경로와 변경 키 제외만 확인했고, 스트림에 붙어 눈으로 본 것은 아니다(프런트 통합 단계에서 확인 필요).
- `apps/web`은 손대지 않았다.

### 7. 남은 이슈·한계

1. **P5 미구현**: `R-EKSVER` 코드(발화하지 않음)·`SnapshotCluster.supportTier`, `R-CP-HA`·`R-CP-SPOT`·`R-CP-RESTART` 신설, `R-GP2`의 etcd 볼륨 표시, 어드바이저 스냅샷 `cluster.controlPlane` 블록(AC-KOPS43 나머지), `sanitize-snapshot.ts` 인스턴스 ID 가명(AC-KOPS44), 브리지 프롬프트(AC-KOPS45), metrics-server 안내 문구(AC-KOPS39), 인증 경로 문서·README(AC-KOPS36~37), mock kOps 형태 정리(AC-KOPS46).
2. **`api_lb` 오분류 가능성(U2)**: 클러스터 태그가 있고 쿠버네티스에 귀속되지 않는 LB는 무엇이든 후보가 된다. 기존 mock의 공용 LB가 실제로 `api_lb`로 넘어갔다. 실클러스터에서 규칙을 좁히기 전까지 금액이 조용히 틀릴 수 있는 자리다(계약에 "추정" 표시 강제).
3. **`etcd_ebs` 판별도 추정**이다. "마스터에 붙은 비-PVC·비-루트 볼륨"이라 kOps가 아닌 이유로 마스터에 붙인 볼륨이 있으면 etcd로 잡힌다.
4. **쿼럼은 마스터 노드 수 근사**다(etcd 멤버 목록은 RBAC 밖). `quorum.basis: "master_node_count"`로 명시하고 한계 안내에도 넣었다.
5. **단일 마스터의 `quorum.state`는 `ok`**로 둔다(Ready 1/1). `requiredReady = 1`이라 `at_risk` 공식에 걸리지만, 정상인 단일 마스터에 "쿼럼 위험"을 띄우면 HA 경고(`CONTROL_PLANE_NOT_HA`)와 중복된다.
6. **P1·P2에서 남았던 잔재 중 아직 있는 것**: `allocation.ts`의 `DEFAULT_SYSTEM_NAMESPACES`와 `precheck-rules.ts`의 시스템 네임스페이스 목록에 `amazon-cloudwatch`·`karpenter`가 남아 있다(P5 mock 정리와 함께).
7. **`others[]`가 DaemonSet 파드로 길어진다**(mock 12개). 필수 판정에는 넣지 않지만 화면에서 길어질 수 있다 — 디자인 확인 필요.
8. `master_ec2` 행이 `capacityType: 'spot'`일 수 있다(kOps에서 마스터를 스팟으로 만든 경우). 금액은 맞게 계산되지만 **"마스터가 스팟이다"라는 경고는 P5의 `R-CP-SPOT`**이다.

### 8. 다른 담당 요청

- **frontend 요청 1**: `GET /api/cluster/control-plane`이 **이제 200이다.** 컨트롤 플레인 섹션을 붙여도 된다. 매트릭스는 `components.items`(마스터 × 5종, **빈 칸 없음**)와 `components.columns`(열 머리, `reason` 포함)로 그대로 그릴 수 있다. **셀은 `cellState`·`cellText`·`cellDetail`·`cellTooltip`을 그대로 쓰고 화면에서 조건을 조합하지 말 것.** `cellDetail`이 잘릴 수 있으므로 **`cellTooltip`을 반드시 붙여야 한다**(디자이너 못박음).
- **frontend 요청 2**: 요약의 "알 수 없음" 숫자는 **`components.cellCounts.unknownTotal`** 하나를 쓴다(`notReporting`+`unknown`+`missing`). 매트릭스 칸에서는 셋을 구분해 그린다. `components.summaryText`는 서버 문장이라 그대로 찍으면 된다.
- **frontend 요청 3**: 개요 `areas.controlPlane`(카드 6번째), `attention`의 `area: 'control_plane'`, `nav.nodes`(워커·컨트롤 플레인 최악)가 모두 내려간다. SSE는 **기존 `cluster` 토픽**에 `cluster.controlplane.updated` 핸들러 하나만 추가하면 된다(새 구독 없음).
- **frontend 요청 4(비용)**: 카테고리가 `eks` → **`controlPlane`**으로 바뀌었다. `resources.eks[]`가 사라지고 `resources.controlPlane[]`(행마다 `kind`)이 생겼다. `categories[].byKind`·`apiLb`를 화면 그대로 쓸 수 있고, `apiLb`는 **후보 0개여도 항상 있다**. 배분 breakdown은 P1·P2에서 이미 `controlPlaneUsdPerHour`다.
- **frontend/designer 요청 5**: 비용 화면 도움말 고정 문구는 `docs/api/aws-cost.md` 3.1.1에 있다(상단 안내·Route53·S3 state store·목표 대수 미표시·`api_lb` 툴팁). **서버가 내려보내지 않는 값**이라 화면 상수로 넣어야 한다.
- **PM 요청 1(재요청)**: `docker compose` 가능한 환경에서 `npm run db:migrate --prefix apps/api` + 소모율 표본 적재 확인. 이번엔 `baselineFrom`이 실제 값으로 들어간 DB에서 급증 기준선이 "수집 중"으로 시작하는지도 함께 봐 주기 바란다.
- **PM 요청 2(재요청)**: 실클러스터 확인 U2(API LB — 1순위)·U4(미러 파드 이름)·U5(추가 static pod). U4·U5는 P3 구현이 그대로 걸려 있는 항목이다.

### 9. 다음 담당이 알아야 할 점

- **판단 기준값은 `apps/api/src/cluster/state/control-plane.ts`의 `CONTROL_PLANE_RULES` 한곳**에 있다. 구성요소 이름 규칙(U4)·추가 static pod(U5)가 확정되면 `CONTROL_PLANE_COMPONENT_KINDS`(types.ts)와 `notComponentPrefixes`만 고치면 된다.
- **P5를 할 사람에게**: `R-CP-HA`·`R-CP-SPOT`·`R-CP-RESTART`에 필요한 재료는 이미 `ClusterView.controlPlane`에 다 있다(마스터 수·`quorum`·`zoneSpread`·셀별 `restarts.last24h`·마스터 노드의 `capacityType`). 어드바이저 스냅샷에 `cluster.controlPlane` 블록을 붙일 때 `cluster-advisor.snapshot.ts`에서 `this.state.getView().controlPlane`을 그대로 쓰면 된다.
- **비용 카테고리 전환은 끝났다.** 코드에 `eks`라는 비용 카테고리는 더 이상 없다(`cost/explorer/service-names.ts`의 AWS 청구 서비스 이름 매핑만 남아 있고, 그것은 AWS가 돌려주는 실제 문자열이라 지우면 과거 내역 라벨이 깨진다).
- **mock 시나리오가 15개로 늘었다**(`GET /api/mock/scenarios`). 프런트 검증용 컨트롤 플레인 6종 + `kube-auth-failed`는 `PUT /api/mock/scenarios/cluster`로 전환한다.
- `CONTROL_PLANE_HA_EXPECTED=false`로 띄우면 단일 마스터 개발 클러스터에서 상시 노란색이 되지 않는다.

---

## 2026-09-24 11:20 · 구현 P5 (가명·어드바이저 규칙·인증 문서·metrics-server·mock kOps화) + AC 자체 점검

### 1. 요청 내용

PM 지시: 마지막 **P5(AC-KOPS36~46)**.

1. **최우선(보안) AC-KOPS44**: `sanitize-snapshot.ts`에 계약 B.2 판정 **P1~P4** 구현. **`evidence[].text`·`summary` 같은 자유 문자열까지 스캔**할 것. `nodeGroup: null`일 때도 예외 금지. **합격 기준 = 스냅샷 전문과 `advisor_runs.snapshot`에 `i-[0-9a-f]{8,17}` 0건, 테스트로 고정.**
2. **어드바이저 규칙(AC-KOPS41~42)**: `R-EKSVER` 삭제, `R-CP-HA`·`R-CP-SPOT`·`R-CP-RESTART` 추가(2단계 규칙은 범위 밖), `R-GP2`에 etcd 표시 + "IOPS 민감" 주석(**etcd 전용 규칙 금지**), 브리지 프롬프트(AC-KOPS45).
3. **인증(AC-KOPS36~38)**: README에 ServiceAccount 토큰 kubeconfig 절차 + **admin kubeconfig 금지 경고**. **AC-KOPS37은 실클러스터가 없어 돌릴 수 없으니 방법만 적고 "미검증"으로 보고**.
4. **metrics-server(AC-KOPS39~40)**: kOps 기준 문구, **클러스터 변경 명령 금지**.
5. **mock kOps화(AC-KOPS46)**: 노드 이름·kubelet 버전·클러스터 이름(`prod/staging/bench.k8s.example.com`)·노드그룹 이름, `allocation.ts`·`precheck-rules.ts`의 `amazon-cloudwatch`·`karpenter` 정리. `snapshot-3d` mock 노드그룹 짝 조율.
- 하지 않을 것: `apps/web/**`(frontend 작업 중), DBA 영역, RBAC 권한 확대, 2단계 규칙·`deploy/kops-snapshot/`·`R-K8SVER`.
- 검증: lint·test·build(기준선 440/1 skipped), **저장소 전체 `eks`·`EKS` 재검색**, `PLATFORM` 없음, 포트 3121, 자기 PID만 종료, **미검증을 통과한 것처럼 쓰지 말 것**.
- 산출물에 **AC-KOPS01~46 중 backend 소관 자체 점검 표** 포함.

### 2. 참고한 문서

- `docs/api/architecture-advisor.md` — **B.2 "노드 이름 가명 처리" P1~P4 표·예시·검증 방법**, A.2 스냅샷 스키마(`cluster.controlPlane`), A.4 규칙 매핑표(`R-CP-*`·`R-EKSVER` 삭제 행)
- `docs/specs/kops-support.md` 3.6(인증 경로)·3.7(어드바이저 규칙)·5절 P5 수용 기준·10.5~10.7(영향 범위)
- `docs/api/cluster-status.md` 7.2(metrics-server 문구)·11절, `docs/design/cluster-status.md`(화면 힌트 문구 — 디자이너가 이미 kOps 기준으로 갱신)
- `docs/reports/kops-support/README.md`(확정 이름 규약 3개)

### 3. 작업 내용

#### (1) AC-KOPS44 — 노드 이름 가명 (최우선)

`sanitize-snapshot.ts`:
- **판정 P1~P4**를 상수로 분리하고 `needsNodePseudonym()`으로 묶었다. P3는 8자리 구형식·17자리 현행식 모두, 대소문자 무시. `hasInstanceId()`는 검증(0건 확인)에도 그대로 쓴다.
- `Pseudonymizer.node()`: `nodeGroup`을 모르면 **`node-<n>`**(전에는 `node-node-<n>`). **"가명을 만들 수 없으니 원문" 예외를 두지 않는다.**
- **`nodeRef(name)`** 신설: 이미 가명이 있으면 그대로, 없으면 노드그룹 없이 새 가명. `prechecks[].targets[]`의 `kind: "Node"`가 이것을 쓴다.
- **`maskText(text)`** 신설 + **`scan()` 전 문자열에 적용**. 2단계다: ① 이미 아는 실제 이름(긴 것부터) → 가명 ② 남은 인스턴스 ID·`ip-x-x-x-x` 토큰 → 새 가명. 이래야 `"i-0a1b… CPU 평균 8%"` 같은 **자유 문장**과 `evidence[].field` 경로까지 막힌다.
- 문자열 스캔에서 가명이 더 생길 수 있어 `meta.pseudonyms`를 스캔 뒤에 다시 센다.
- **IPv4 숫자 토큰은 문장 스캔 대상에서 뺐다**(5절 결정 A).

#### (2) 어드바이저 규칙 (AC-KOPS41~42)

- **`R-EKSVER` 삭제**: 규칙 본문과 `RULES` 메타에서 모두 제거. `SnapshotCluster.supportTier` 필드도 함께 삭제했다(계약 변경 이력이 "삭제"로 적혀 있었고, 규칙이 사라지면 LLM에 `null`만 나가는 죽은 필드가 된다).
- **`R-CP-HA`**(높음): 마스터 1대. **`haExpected`와 무관하게** 지적한다(화면 상태 판단만 꺼진다).
- **`R-CP-SPOT`**(높음): 마스터가 스팟. 노드별 대상.
- **`R-CP-RESTART`**(높음): 구성요소 24시간 5회 이상(`thresholds.controlPlaneRestarts24h`). 기존 `R-RESTART`는 시스템 네임스페이스를 빼므로 이 규칙이 따로 필요하다.
- **`R-GP2` 확장**: 요약에 `(etcd 볼륨 포함)`, 근거 문구에 `etcd는 IOPS 민감 — 전환 시 성능 확인 필요`, 각 행에 "etcd 볼륨"/"마스터 루트 볼륨" 표시. **전용 규칙을 만들지 않았다.**
- **스냅샷 스키마 2개 추가**(5절 결정 B): `cluster.controlPlane`(계약 A.2에 있던 블록을 실제로 채움 — 마스터 수·타입·AZ·구매 옵션·구성요소별 Ready/24h 재시작·쿼럼·notReporting)과 **`controlPlaneVolumes[]`**(etcd·마스터 루트 볼륨. PVC가 아니라 `storage[]`에 없어 R-GP2가 볼 수 없었다). 볼륨 ID는 기존과 같이 `vol-<n>` 가명이다.
- **브리지 프롬프트(AC-KOPS45)**: "Amazon EKS" → "kOps on AWS", **"The cluster you are looking at"** 절 신설(관리 요금 없음, 마스터는 사용자 소유 EC2, `cluster.controlPlane` 설명, 워커 기준 집계, etcd IOPS 민감 → 볼륨 타입 변경 제안 시 성능 확인 단계 필수). 확장 지원 문구 없음.
- **`promptVersion` `advisor-v1` → `advisor-v2`**(5절 결정 C). api·브리지 양쪽 상수와 테스트를 함께 올렸다.

#### (3) 인증 경로 (AC-KOPS36~38)

- **README "권한"에 `### 대시보드용 kubeconfig` 절 신설**: admin kubeconfig 금지 경고(굵게, 이유 포함) → RBAC 적용 → `kubectl create token` → server·CA로 kubeconfig 구성(클라이언트 인증서 금지) → **`kubectl auth can-i --list` 확인 방법**(create/update/patch/delete·secrets가 없어야 한다) → 토큰 만료 시 동작(`KUBE_AUTH_FAILED`, mock 대체 없음).
- `.env.example`: `KUBECONFIG_HOST_PATH` 기본값을 `~/.kube/sentinel.config`로 바꾸고 금지 경고·확인 명령을 주석으로. `docker-compose.yml`: 같은 경고 2곳.
- `KUBE_AUTH_FAILED` 동작 자체는 P3에서 구현·확인했다.

#### (4) metrics-server (AC-KOPS39~40)

- 서버 메시지(`metrics.k8s.io API 없음 (metrics-server 미설치)`)는 **플랫폼 중립이라 그대로 두는 것이 계약**이다(`cluster-status.md` 3.4 표).
- kOps 기준 화면 힌트(`spec.metricsServer.enabled`)는 **화면 상수**이고 `docs/design/cluster-status.md`·`docs/api/cluster-status.md` 7.2에 이미 있다. **클러스터 변경 명령은 어디에도 넣지 않았다.**
- R-OVERREQ·R-NODEIDLE "판단 보류"는 기존 관측 시간 기반 `heldItem` 그대로다(metrics가 없으면 관측 0 → 보류).

#### (5) mock kOps화 (AC-KOPS46)

- **노드 이름 9개 전부 EC2 인스턴스 ID 형태**(`i-0a1b2c3d4e5f67890` 등, 명세 F10). `mkNode`의 providerId는 이름이 인스턴스 ID면 그대로 쓴다.
- kubelet `v1.34.1-eks-3a4b5c6` → **`v1.34.1`**, 클러스터 이름 **`prod.k8s.example.com`**(cluster mock + `MOCK_CLUSTER_NAME`).
- **노드그룹 이름**: `system`/`batch`/`app` → **`nodes-system`/`nodes-batch`/`nodes-app-arm64`**(kOps InstanceGroup 형태). 마스터는 P3에서 이미 `control-plane-ap-northeast-2<az>`.
- EKS 전용 애드온·이미지: `amazon-cloudwatch` 네임스페이스와 fluent-bit DaemonSet **삭제**, `aws-node`(VPC CNI) → `cilium`, ECR `eks/coredns`·`eks/kube-proxy` → `registry.k8s.io/…`.
- 시스템 네임스페이스 목록 2곳(`allocation.ts`·`precheck-rules.ts`)에서 `amazon-cloudwatch`·`amazon-guardduty`·`aws-observability`·`karpenter` 제거 → env 기본값과 같은 3개.
- k8s-snapshot·aws-snapshot mock 픽스처의 `prod-eks`/`staging-eks`/`bench-eks` → 확정 이름 3개, 서버 버전 `-eks-` 접미어 제거, 라벨 "EKS 1.34 업그레이드 전" → "kOps …", Former2 예시 UserData `/etc/eks/bootstrap.sh` → `nodeup --cluster=…`.
- `docs/HANDOFF.md`·README 머리말의 "EKS" 환경 문구를 kOps로.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/advisor/snapshot/sanitize-snapshot.ts` | 수정 | **P1~P4 판정**, `nodeRef`·`maskText`, 문자열 전체 스캔, `copyControlPlane`·`copyControlPlaneVolume`, `supportTier` 삭제 |
| `apps/api/src/advisor/snapshot/snapshot.types.ts` | 수정 | `SnapshotControlPlane`·`SnapshotControlPlaneVolume`·`ControlPlaneComponentKind`, `supportTier` 삭제 |
| `apps/api/src/advisor/snapshot/snapshot-builder.ts` | 수정 | `controlPlaneVolumes` 병합 |
| `apps/api/src/advisor/snapshot/advisor-snapshot.service.ts` | 수정 | 비용 기여자의 평평한 반환에서 `controlPlaneVolumes`·`unattachedVolumes`를 최상위로 올림 |
| `apps/api/src/advisor/precheck/precheck-rules.ts` | 수정 | `R-EKSVER` 삭제, `R-CP-HA`·`R-CP-SPOT`·`R-CP-RESTART`, `R-GP2` etcd 포함, 임계값·시스템 네임스페이스 |
| `apps/api/src/cluster/cluster-advisor.snapshot.ts` | 수정 | `controlPlaneBlock()`(마스터·구성요소 요약), `supportTier` 삭제 |
| `apps/api/src/cost/cost.service.ts` | 수정 | `controlPlaneVolumes` 기여 |
| `apps/api/src/advisor/run/advisor-run.service.ts`, `apps/agent-bridge/src/agent/output-schema.ts` | 수정 | `promptVersion` → `advisor-v2` |
| `apps/agent-bridge/prompts/architecture-advisor.md` | 수정 | kOps 배경 절 신설, EKS 문구 삭제 |
| `apps/api/src/cluster/mock/mock-world.ts` | 수정 | 노드 이름·노드그룹·kubelet·클러스터 이름·CNI·이미지, `amazon-cloudwatch` 제거 |
| `apps/api/src/cost/mock/mock-world.ts` | 수정 | `MOCK_CLUSTER_NAME` |
| `apps/api/src/cost/estimate/allocation.ts` | 수정 | 시스템 네임스페이스 기본값 |
| `apps/api/src/advisor/mock/mock-fixtures.ts` | 수정 | `cluster.controlPlane` 블록, 이미지, `supportTier` 삭제 |
| `apps/api/src/k8s-snapshots/k8s-mock-fixtures.ts`, `apps/api/src/aws-snapshots/mock-fixtures.ts` | 수정 | 클러스터 이름·서버 버전·라벨·UserData |
| `README.md` | 수정 | kOps 환경 문구, **대시보드용 kubeconfig 절 신설**, AWS 권한에서 `eks:DescribeCluster` 삭제, 테스트 수 |
| `.env.example`, `docker-compose.yml` | 수정 | admin kubeconfig 금지 경고, 기본 경로 |
| `docs/HANDOFF.md` | 수정 | 환경 문구 |
| `docs/api/architecture-advisor.md` | 수정 | P5 변경 이력, `controlPlaneVolumes` 스키마 |
| 테스트: `sanitize-snapshot.spec.ts`(+3 describe), `precheck-rules.spec.ts`(+5), `advisor-run.service.spec.ts`, `k8s-snapshots.*.spec.ts`, `cost/*.spec.ts` | 수정 | 가명 0건 검증·R-CP-*·R-GP2 etcd·이름 규약 |

### 5. 주요 결정과 이유

**결정 A. 문장 스캔 대상을 "인스턴스 ID + `ip-x-x-x-x` 이름 + 이미 아는 실제 이름"으로 한정했다.**
`10.0.12.34` 같은 **맨 IPv4 숫자**까지 문장에서 치환하면 파드 IP·CIDR·버전 문자열을 노드 가명으로 바꿔 **문장을 거짓으로 만든다**. 노드 이름으로 쓰인 IPv4는 `nodes[].name`에서 이미 실제 이름으로 등록되므로 ①단계(실제 이름 치환)가 잡는다. 합격 기준(`i-[0-9a-f]{8,17}` 0건)은 그대로 만족한다.

**결정 B. `controlPlaneVolumes[]`를 스냅샷에 추가했다.**
AC-KOPS42는 "R-GP2 대상에 etcd 볼륨이 포함될 때"를 전제하는데, **실제 R-GP2는 PVC(`storage[]`)만 본다.** etcd·마스터 루트 볼륨은 PVC가 아니라 스냅샷 어디에도 없었다. 검토한 대안: ① `unattachedVolumes`에 넣기 → **R-EBSIDLE이 "미연결 볼륨"으로 오탐**한다(붙어 있는 볼륨이다) ② `storage[]`에 넣기 → `namespace` 필수라 타입이 안 맞고 네임스페이스 배분과 섞인다 ③ etcd 전용 규칙 → **PM이 금지**. → 작은 배열 하나를 추가하고 R-GP2가 함께 보게 했다.

**결정 C. `promptVersion`을 v2로 올렸다.**
계약이 "스냅샷 `cluster` 블록이 바뀌면 `promptVersion`을 올려 짝을 맞춘다"고 못 박았고, P1~P5에서 `platform`·`workerCount`/`controlPlaneCount`·`controlPlane`·비용 카테고리가 모두 바뀌었다. 브리지는 v2만 받는다(구 api가 붙으면 400) — 하위 호환을 두지 않는 D1과 같은 방향이다. **api와 브리지를 함께 배포해야 한다.**

**결정 D. `SnapshotCluster.supportTier`를 삭제했다.**
P3·P4에서는 "`R-EKSVER` 삭제가 P5"라 `null` 고정으로 남겼다. 규칙이 사라진 지금 이 필드는 LLM에 `null`만 보내는 죽은 필드이고, 계약 변경 이력도 "삭제"로 적혀 있었다.

**결정 E. mock 노드그룹 이름을 `nodes-system`/`nodes-batch`/`nodes-app-arm64`로 했다.**
kOps InstanceGroup 이름은 자유 형식이다. 기존 mock의 그룹 의미(시스템/배치/앱)를 유지하면서 kOps 형태로 보이게 하는 최소 변경을 골랐다. 명세 S3의 `nodes-ap-northeast-2a` 같은 AZ별 이름은 지금 mock의 그룹이 AZ가 아니라 역할 기준이라 맞지 않는다(한 그룹이 2a·2c에 걸쳐 있다).

**결정 F. `deploy/aws-snapshot/**`·`deploy/k8s-snapshot/**`의 EKS 문구는 건드리지 않았다.**
둘 다 **대시보드 밖 사람용 CLI**이고 명세 10.7 영향 범위에도 없다. 다만 `deploy/k8s-snapshot/lib`의 "이름이 `eks:`로 시작하는 RBAC 객체를 제외" 규칙은 **동작하는 코드 경로**다(kOps에서는 매칭되지 않아 무해). AC-KOPS01의 판단이 필요해 7절·8절에 올린다.

### 6. 검증 결과

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | **통과**(오류 0) | |
| `npm test --prefix apps/api` | **통과 — 44 suites / 457 passed, 1 skipped** | 기준선 440 → **+17건** |
| `npm run build --prefix apps/api` | **통과** | |
| `npx tsc --noEmit` (api) | 오류 0 | |
| `npm run lint --prefix apps/agent-bridge` | 통과 | |
| `npm test --prefix apps/agent-bridge` | **57 passed** (6 files) | `promptVersion` v2 반영 |
| **AC-KOPS44 합격 기준**: mock `GET /api/advisor/snapshot-preview` 전문 `i-[0-9a-f]{8,17}` | **0건** | mock 노드 이름이 전부 인스턴스 ID인데도 0건 |
| 같은 검증을 테스트로 고정 | `sanitize-snapshot.spec.ts`(스냅샷 전문 0건 + `hasInstanceId` false), `advisor-run.service.spec.ts`(**브리지 전송 본문 + `advisor_runs.snapshot` 저장본** 0건) | |
| 가명 P1~P4 판정 | 9케이스 테이블 테스트 통과 | `worker-seoul-01`은 원문 유지 |
| `nodeGroup: null` 노드 | `node-1` (예외 없음) | |
| 자유 문장·`evidence[].field` 치환 | `"i-0a1b… CPU 평균 8%"` → `"nodes-ap-northeast-2a-node-1 CPU 평균 8%"` | |
| 같은 노드가 `nodes[]`와 `prechecks[].targets[]`에서 같은 가명 | 통과 | |
| mock 스냅샷 `cluster.platform` / `controlPlane` | `kops` / 마스터 3대·AZ 3곳·구성요소 5종(각 3/3, 재시작 0) | |
| mock `controlPlaneVolumes` | **9개**(etcd 6 + 마스터 루트 3) | R-GP2 대상 경로 확인 |
| `R-CP-HA` | mock `cp-single` 스냅샷에서 **발화**(높음) | `/api/advisor/prechecks`는 주기 캐시라 몇 초 뒤 반영 |
| `R-CP-SPOT`·`R-CP-RESTART`·`R-GP2`(etcd) | **단위 테스트로 확인**(mock 기본 세계는 온디맨드·재시작 0·gp3라 화면에서는 안 뜬다) | 5회 미만이면 안 뜨는 것도 테스트 |
| `R-EKSVER` | `prechecks[]`·`RULES` 어디에도 없음(테스트 2건) | |
| mock 노드 목록 `role=all` | 9대 전부 `i-0…`·kubelet `v1.34.1`·노드그룹 `nodes-*`/`control-plane-*` | AC-KOPS46 |
| mock 클러스터 이름 | `prod.k8s.example.com` | 확정 이름 규약 |
| 비용 카테고리 합계 = 전체 추정 | $0.959409 = $0.959409 (**오차 0**) | P4 회귀 없음 |
| GET 12개(health·overview·cluster/*·cost/*·advisor/*·snapshots) | 전부 200 | |
| **저장소 `eks`·`EKS` 재검색** | `apps/api/src`에 **동작하는 EKS 코드 경로 없음** | 남은 것은 ① 주석·테스트의 "걸리지 않아야 한다" 단언 ② AWS 청구 서비스 이름 매핑(`service-names.ts`) ③ `deploy/*-snapshot`(사람용 CLI, 7절) |
| **`PLATFORM` 분기** | **없음** | `process.platform`·`@nestjs/platform-express`만 |
| 검증 프로세스 종료 | `Stop-Process -Id` (24764, 16536, 17996) | **이미지 이름 일괄 종료 없음.** 종료 후 3121 LISTENING 0건 |

**하지 않은 검증 (그대로 적는다)**
- **AC-KOPS37 미검증**: `kubectl auth can-i --list`는 **실제 클러스터가 있어야** 돌릴 수 있다. 이 환경에 클러스터가 없어 **실행하지 못했다.** README에 명령과 기대 결과(create/update/patch/delete·secrets 없음)를 적어 두었을 뿐이다. 통과로 세지 않는다.
- **AC-KOPS36의 "절차대로 하면 실제로 붙는가"도 미검증**이다. 문서만 썼다.
- **실제 Postgres 미검증**(P1~P4와 같음). Docker·psql이 없어 메모리 모드로만 기동했다.
- **브리지를 실제로 띄워 v2 프롬프트로 왕복하지 않았다.** 프롬프트 파일·상수·테스트만 맞췄다(`ADVISOR_BRIDGE=live`가 필요하고 Claude Code 사용량을 쓴다).
- **SSE 스트림 구독 확인은 여전히 못 했다**(P3에서 적은 것과 같음).
- U2(API LB 태그·이름)·U4(미러 파드 이름)·U5(추가 static pod)·U8(kOps에서 파드에 AWS 권한)은 **전부 미확인**이다.

### 7. 남은 이슈·한계

1. **AC-KOPS37·36은 실클러스터 확인이 남아 있다**(위 검증 표).
2. **`deploy/k8s-snapshot/lib`의 `eks:` 접두어 RBAC 제외 규칙이 남아 있다.** 대시보드 밖 사람용 CLI이고 kOps에서는 매칭되지 않아 무해하지만, AC-KOPS01의 "동작하는 코드 경로" 해석에 따라 지울지 PM 판단이 필요하다(지우면 그 CLI 테스트 65건을 함께 손봐야 한다). `deploy/aws-snapshot/README.md`의 EKS 복원 절차 문구도 같은 성격이다.
3. **`promptVersion: advisor-v2` — api와 브리지를 함께 배포해야 한다.** 한쪽만 올리면 400 `unsupported_prompt_version`이다.
4. **`R-CP-SPOT`·`R-CP-RESTART`는 mock 기본 세계에서 발화하지 않는다**(마스터가 온디맨드·재시작 0). 화면에서 보려면 mock을 더 손대야 하는데, 그건 P3 시나리오(`cp-*`)의 성격이 아니라 어드바이저 시나리오라 만들지 않았다. 단위 테스트로만 고정돼 있다.
5. **`cluster.controlPlane.masters.cpu/memory`는 마스터 노드들의 평균**이다. metrics-server가 없으면 `null`이 되고 LLM은 "판단 보류"로 다뤄야 한다(프롬프트에 unknown은 추측하지 말라고 적혀 있다).
6. **mock 노드그룹 이름과 `snapshot-3d` 명세의 `ng-general`·`ng-spot`이 아직 다르다.** `ng-*`는 **`docs/specs/snapshot-3d.md`의 보류 구간(2~4단계 AWS 층) 설명 문장에만** 있고 api mock·픽스처에는 존재하지 않아 지금 깨지는 짝은 없다. 8절에서 planner에게 이름을 넘긴다.
7. **`SnapshotSummary.instanceTypes`에 마스터 타입이 포함**된다(P1·P2 때와 같음).
8. `others[]`(마스터의 기타 kube-system 파드)가 DaemonSet 때문에 길어진다(mock 12개) — 디자인 확인 필요(P3에서 올린 것과 같은 항목).

### 8. AC-KOPS01~46 자체 점검 (backend 소관)

> 판정 기준: **통과** = 구현 + 자동 테스트나 mock 실행으로 확인함 / **통과(문서)** = 문서 산출물이라 코드 검증 대상이 아님 / **미검증** = 실클러스터·실DB가 없어 확인하지 못함 / **해당 없음** = 다른 담당 소관.

| AC | 내용(요약) | 판정 | 근거 |
|---|---|---|---|
| 01 | EKS 코드 경로·의존성·`describeEksCluster`·`eksSupportTier` 없음 | **통과**(단서) | `apps/api/src`에 동작 경로 0. `@aws-sdk/client-eks` 삭제(lock 포함). 단 `deploy/*-snapshot`(사람용 CLI) 문구·`eks:` RBAC 제외 규칙은 남음 → 7절 2번 |
| 02 | `PLATFORM` 분기 없음 | **통과** | 전체 검색 0건 |
| 03 | `kops.k8s.io/instancegroup`만, EKS·Karpenter 라벨은 `null` | **통과** | `extract-raw.spec.ts` 5건 |
| 04 | EC2 태그 노드그룹 귀속 | **통과** | `aws-sdk.gateway.ts` 단일 태그, 비용 행 `nodeGroup` |
| 05 | EC2 필터 `kubernetes.io/cluster/<name>` 유지 | **통과** | 코드 변경 없음(의도적) |
| 06 | `K8S_CLUSTER_NAME`, 구 이름 안 읽음 | **통과** | env·compose·app.example·코드 일치, 구 이름 검색 0 |
| 07 | `NodeItem.role` | **통과** | 목록·상세·SSE·스냅샷 |
| 08 | 버전은 k8s API에서만, `eks:DescribeCluster` 0회, `supportTier` 없음 | **통과** | `cost.service.spec.ts`(AmazonEKS 미조회), 게이트웨이 메서드 삭제 |
| 09 | `SYSTEM_NAMESPACES` 기본값 | **통과** | env·compose·allocation·precheck 4곳 일치 |
| 10 | 요약 띠 노드 수 = 워커, 부제 컨트롤 플레인 | **통과** | `areas.nodes` 워커 기준 + `areas.controlPlane` 제공(**부제 렌더링은 frontend**) |
| 11 | 노드 목록 `role`·`counts`·`facets`·`total` 일관성 | **통과** | `cluster.http.spec.ts` |
| 12 | `/metrics` 워커 합계 + 마스터 별도 블록 | **통과** | mock에서 사용률 차이 확인 |
| 13 | `metrics/series target=cluster` 워커 기준 | **통과** | `scope` + 분모 일치 테스트 |
| 14 | 워커 0대 → 전체 장애 | **통과** | `evaluate.spec.ts`(마스터만 있는 경우 포함) |
| 15 | 마스터 비용 → `공용(클러스터)`, 합계 오차 $0.01 이내 | **통과** | mock 오차 0, `allocation.spec.ts` |
| 16 | R-NODEIDLE·R-ONDEMAND·R-GRAVITON 워커만 | **통과** | mock prechecks 대상 확인 |
| 17 | 마스터 0대 → `CONTROL_PLANE_NOT_FOUND` | **통과** | `control-plane.spec.ts`, mock `cp-not-found` |
| 18 | 개요 컨트롤 플레인 카드 값·`overall` 포함 | **통과**(서버분) | `areas.controlPlane` 제공. **카드 렌더링은 frontend** |
| 19 | 상세에 마스터·구성요소 5종, 시스템 필터 무관 | **통과**(서버분) | `/control-plane`은 필터 없음 |
| 20 | 1대 NotReady 주의 / 2대 장애 | **통과** | 테스트 + mock 2종 |
| 21 | NotReady 마스터의 구성요소 `알 수 없음` + 마지막 보고 | **통과** | 전용 테스트, mock `cp-node-down` |
| 22 | 재시작 4회 장애 / 1회 주의 | **통과** | 테스트 + mock `cp-component-crash` |
| 23 | 단일 마스터 주의, `HA_EXPECTED=false`면 정상 | **통과** | 테스트 + env를 바꿔 실제 기동 확인 |
| 24 | 짝수·단일 AZ 주의 | **통과** | 테스트 |
| 25 | mock 시나리오 6종 전환 | **통과** | 7종(+`kube-auth-failed`) 전부 전환 확인 |
| 26 | 한계 안내 2줄 + RBAC 추가 없음 | **통과** | `limits.notes` 3건, `deploy/rbac.yaml` 무변경 |
| 27 | 카테고리 `controlPlane`·순서 | **통과** | `estimator.spec.ts` |
| 28 | 하위 5종·etcd 볼륨 6개 | **통과** | mock byKind 실측 |
| 29 | 중복 계상 없음·카테고리 합계 = 총액 | **통과** | mock 오차 0 + 테스트 |
| 30 | `api_lb` 1/N/0개 동작 | **통과** | 테스트 3케이스, mock `assumed(1)` |
| 31 | "포함되지 않는 것"에 Route53·S3 | **통과(문서)** | `aws-cost.md` 3.1.1 (**화면 문구는 frontend**) |
| 32 | AWS 호출 목록에 `eks:*`·`autoscaling:*` 없음 | **통과** | 게이트웨이 메서드 목록 + AmazonEKS 미조회 테스트 |
| 33 | live + 이름 없음 → `CLUSTER_NAME_NOT_CONFIGURED` | **통과**(코드) | 구현·타입 확인. **live 실행 검증은 못 함** |
| 34 | `control_plane_usd_per_hour` 마이그레이션·행 보존 | **통과**(DBA) + backend 연결 **통과** | 저장 경로 회귀 테스트. **실 DB 적재는 미검증** |
| 35 | 비용 상단 도움말 문구 | **통과(문서)** | `aws-cost.md` 3.1.1 (**화면은 frontend**) |
| 36 | admin kubeconfig 금지 + 구성 절차 | **통과(문서)** | README·`.env.example`·compose |
| 37 | `kubectl auth can-i --list`에 쓰기·secrets 없음 | **미검증** | **실클러스터 없음.** 방법만 README에 적음 |
| 38 | 401 → `KUBE_AUTH_FAILED`, mock 대체 없음, 안 죽음 | **통과** | mock `kube-auth-failed`에서 목록 0건·출처 unavailable 확인 |
| 39 | metrics-server 없음 문구·나머지 정상·명령 없음 | **통과** | mock `no-metrics` 시나리오 기존 동작 + 문구는 계약·디자인에 고정 |
| 40 | metrics 없으면 R-OVERREQ·R-NODEIDLE 보류 | **통과** | 기존 `heldItem` 경로 |
| 41 | R-EKSVER 없음, R-CP-* 있음 | **통과** | 테스트 2 + 규칙 4건 |
| 42 | R-GP2에 etcd 표시·IOPS 주석 | **통과** | 전용 테스트 |
| 43 | 스냅샷 `platform: kops`·`role`·마스터 요약 | **통과** | mock 스냅샷 실측 |
| 44 | 인스턴스 ID 노드 이름 가명 | **통과** | **0건**(mock 실측 + 테스트 3건, 저장본 포함) |
| 45 | 브리지 프롬프트 kOps | **통과(문서)** | 프롬프트 파일 + `promptVersion` v2 |
| 46 | 10절 문서·픽스처 처리, mock이 kOps처럼 | **통과**(단서) | api mock 전부 kOps 형태. **`apps/web` 픽스처는 frontend 소관**, `deploy/*-snapshot` 문구는 7절 2번 |

**요약**: backend 소관 46개 중 **미검증 1건(AC-KOPS37)**, 단서 있는 통과 2건(01·46 — 대시보드 밖 CLI 문구), 나머지는 통과. 화면 렌더링이 필요한 항목(10·18·19·31·35)은 서버 값까지만 확인했다.

### 9. 다른 담당 요청

- **frontend 요청 1**: 스냅샷 `promptVersion`이 **`advisor-v2`**다. 화면에 버전을 표시하는 자리가 있으면 갱신한다. 브리지도 함께 배포해야 한다.
- **frontend 요청 2**: `apps/web`의 mock 픽스처 클러스터 이름·노드 이름·노드그룹 이름을 api mock과 맞춰야 한다 — **`prod.k8s.example.com`**, 노드 이름은 `i-0…` 형태, 노드그룹은 **`nodes-system`·`nodes-batch`·`nodes-app-arm64`·`control-plane-ap-northeast-2{a,b,c}`**. api mock에는 `amazon-cloudwatch` 네임스페이스와 fluent-bit가 더 이상 없다.
- **planner 요청**: `docs/specs/snapshot-3d.md`의 보류 구간에 있는 `ng-general`·`ng-spot`은 지금 api mock과 다르다. 2단계를 착수할 때 위 이름으로 맞춰 주기 바란다(지금은 api 코드에 `ng-*`가 없어 깨지는 짝은 없다).
- **PM 판단 요청**: `deploy/k8s-snapshot/lib`의 `eks:` 접두어 RBAC 제외 규칙과 `deploy/aws-snapshot/README.md`의 EKS 복원 절차 문구를 AC-KOPS01 범위로 볼지. 대시보드 밖 사람용 CLI이고 kOps에서는 매칭되지 않는다. 지우려면 그 CLI 테스트도 함께 손봐야 한다.
- **PM 요청(재)**: 실클러스터가 생기면 **AC-KOPS37**(`kubectl auth can-i --list`)과 U2·U4·U5·U8을 확인해 주기 바란다. U4가 틀리면 컨트롤 플레인 구성요소가 통째로 `missing`으로 보인다.
- **PM/DBA 요청(재)**: 실 Postgres에서 `npm run db:migrate --prefix apps/api` + 소모율 표본 적재 + `baselineFrom` 동작 확인.

### 10. 다음 담당이 알아야 할 점

- **가명 처리는 `sanitize-snapshot.ts` 한곳**이다. 새 자유 문자열 필드를 스냅샷에 추가해도 `scan()`이 자동으로 `maskText`를 적용한다. 다만 **새 노드 이름 필드를 추가하면 `copyNode`/`copyPrecheck`처럼 필드 단위 판정도 함께 넣어야** 가명 번호가 노드그룹 기준으로 붙는다.
- 인스턴스 ID 0건 검증은 `src/advisor/snapshot/sanitize-snapshot.spec.ts`와 `src/advisor/run/advisor-run.service.spec.ts`에 있다. **스냅샷 스키마를 바꾸면 이 두 테스트를 먼저 돌려 보라.**
- `R-CP-*` 규칙은 `cluster.controlPlane`(스냅샷)에 의존한다. 그 블록은 `cluster-advisor.snapshot.ts`의 `controlPlaneBlock()`이 `ClusterView.controlPlane`에서 만든다 — 컨트롤 플레인 판단을 고치면 자동으로 따라온다.
- **mock 노드 이름이 전부 인스턴스 ID**다. 화면·테스트에서 노드 이름을 하드코딩하지 말 것(가명 처리 대상이기도 하다).
- `promptVersion`을 다시 올릴 일이 생기면 **`apps/api/src/advisor/run/advisor-run.service.ts`와 `apps/agent-bridge/src/agent/output-schema.ts` 두 곳**을 같이 고쳐야 한다.

---

## 2026-09-24 12:10 · P5 마무리 (PM 판단 반영: CLI 잔재 주석 / 복원 절차 문구 / 배포 주의)

### 1. 요청 내용

PM이 P5의 판단 요청 1건에 답하며 **둘을 다르게 처리**하라고 지시:

1. **`deploy/k8s-snapshot/lib`의 `eks:` RBAC 제외 규칙 → 남긴다.** AC-KOPS01의 "동작하는 코드 경로"는 **`apps/api/src` 기준**으로 판정한다. 단 **왜 남았는지·언제 지울지 주석 한 줄**을 남길 것(없으면 다음 사람이 버그로 오해하거나 의미 있는 규칙으로 착각한다).
2. **`deploy/aws-snapshot/README.md`의 EKS 복원 절차 → 고친다.** 사람이 그대로 따라 하는 문서라 지금은 **틀린 안내**다("무해한 잔재"가 아니라 "해로운 오안내"). 실제 kOps 복원 절차를 새로 쓰라는 뜻은 아니고, **EKS 전제를 걷어내고 kOps `Cluster`/`InstanceGroup`은 Former2로 표현되지 않으며 다음 범위(`deploy/kops-snapshot/`)라는 점**을 적으면 된다.
3. **배포 주의**: `promptVersion: advisor-v2`이므로 **api와 브리지를 반드시 함께 배포**해야 한다. README나 배포 문서에 눈에 띄게 적혀 있는지 확인하고 없으면 한 줄 추가.

PM이 내 판단 2건(맨 IPv4를 문장 스캔에서 제외 / `controlPlaneVolumes[]` 신설)을 그대로 채택했다.

### 2. 참고한 문서

- `docs/specs/k8s-snapshot.md` 3.4 (planner의 "EKS 잔재 — 다음 정리 때 삭제" 존치 방침)
- `docs/specs/kops-support.md` 8장 (`deploy/kops-snapshot/` 필요성·다음 범위), 0.2 F1~F7(kOps가 만드는 AWS 리소스·태그)
- `deploy/aws-snapshot/README.md` 7장(복원 절차), `deploy/k8s-snapshot/README.md` 3장(권한·컨텍스트)

### 3. 작업 내용

#### (1) `eks:` 규칙 존치 + 주석 (PM 답 1)

`deploy/k8s-snapshot/lib/rules.mjs`의 `isAutoCreated()`에 주석 4줄:
- kOps에는 `eks:` 이름의 RBAC 객체가 없어 **매칭되지 않는다(무해)**
- 지우면 이 CLI 테스트를 함께 손봐야 해서 남긴다 — `docs/specs/k8s-snapshot.md` 3.4의 "다음 정리 때 삭제" 방침
- **버그가 아니고, kOps에서 의미 있는 규칙도 아니다**

함수 머리 주석의 "쿠버네티스·EKS가 자동으로 만든 객체"도 "쿠버네티스가 자동으로 만든 객체"로 고쳤다(규칙 설명이 EKS를 전제하면 주석과 모순된다). `deploy/k8s-snapshot/README.md` 6장 목록에도 같은 취지의 한 줄을 달았다.

#### (2) `deploy/aws-snapshot/README.md` 복원 절차 (PM 답 2)

7.1 "템플릿 손질" 2번을 **kOps 기준으로 다시 썼다**:
- 머리에 인용 블록: **kOps의 단일 진실은 S3 state store의 `Cluster`/`InstanceGroup`이고 아래 리소스는 그 결과물이다. 클러스터를 되살리는 것은 `kops create -f`(다음 범위)의 몫이지 이 템플릿의 몫이 아니다.**
- 지울 대상을 kOps 실제 리소스로 교체: InstanceGroup이 만든 ASG·Launch Template·마스터/워커 EC2·**etcd main/events 볼륨**, kOps 보안 그룹(`masters.<클러스터>`·`nodes.<클러스터>`), **API 서버 앞단 NLB**와 Target Group·Listener, Route53 레코드(`api.<클러스터>`), **state store S3 버킷은 지우지 말 것**(클러스터보다 오래 산다).
- 판단 기준 태그에서 `eks:cluster-name`·`eks:nodegroup-name`을 빼고 `kops.k8s.io/instancegroup`·`k8s.io/role/*`를 넣었다. `kubernetes.io/cluster/<이름>`은 kOps도 같아서 유지(F3).
- 7번(구 "EKS 클러스터 버전·애드온 버전 확인")을 **"클러스터 자체는 이 템플릿에 없다"**로 교체하고, Former2가 표현 못 하는 것(etcd 볼륨 설정·CNI 선택·kubelet/apiserver 플래그·nodeLabels/taints·rollingUpdate)을 명시 + `deploy/kops-snapshot/`(다음 범위)로 연결. 버전 확인은 8번으로 내리고 "쿠버네티스 커뮤니티 지원 구간"으로 바꿨다.
- 7.3 스택 분할 순서에서 "EKS 클러스터 → 노드그룹"을 빼고 **"클러스터는 이 순서에 들어가지 않는다 — `kops`로 먼저 만든다"**를 적었다.
- 7.4 적용 후 1번 `aws eks update-kubeconfig …` → **ServiceAccount 토큰 kubeconfig 안내**(루트 README "권한" 참고).
- 8장 표에 **kOps `Cluster`/`InstanceGroup` 정의 행을 새로 추가**("못 담음 — Former2는 결과물만 본다", 보관은 다음 범위). "EKS 애드온 설정" 행은 "클러스터 애드온 설정"으로 일반화.
- 예시 명령·설정의 `--services EKS,EC2,VPC,IAM` → `EC2,VPC,IAM,ELBv2,AutoScaling`, `"list": ["EKS","EC2","VPC"]` → `["EC2","VPC","AutoScaling"]`.

#### (3) `deploy/k8s-snapshot/README.md`·RBAC 예시 — **PM 지시 범위를 넘어 함께 고쳤다**

PM이 명시한 것은 `aws-snapshot/README.md`뿐이지만, **같은 판정 기준("사람이 그대로 따라 하는 절차 문서에 틀린 안내를 남기지 않는다")이 더 강하게 걸리는 곳**이 `k8s-snapshot/README.md` 3장이라 함께 고쳤다. 그 절차는 **권한 설정 방법**이고, kOps에는 `aws eks create-access-entry`·`aws eks update-kubeconfig`가 **존재하지 않아** 따라 하면 그 자리에서 막힌다.
- 2번: EKS access entry → **전용 ServiceAccount 토큰**(권장) 또는 **`O=sentinel-snapshot-exporters` 클라이언트 인증서** 두 가지 방법.
- 3번: `aws eks update-kubeconfig` → 서버 주소(`https://api.<클러스터 이름>`)·CA·토큰으로 컨텍스트 구성. **`kops export kubeconfig --admin` 금지 경고**를 넣었다(그것을 쓰면 4번의 `auth can-i` 확인이 통과해 버려 검증이 무의미해진다).
- 2장 의존성 설명의 "EKS `aws eks get-token` exec 플러그인", 6장 "EKS 애드온", 7장 종료코드 3 문제 해결(`aws eks update-kubeconfig`)도 kOps 기준으로.
- `deploy/k8s-snapshot/rbac/export-readonly.yaml`의 연결 방법 주석 2곳도 같은 내용으로.

**범위를 넘은 판단이므로 PM이 되돌리라면 되돌리겠다**(8절).

#### (4) 배포 주의 (PM 지시 3)

README에 **없었다.** 어드바이저 브리지 실행 문단 바로 아래에 인용 블록으로 추가:
- api와 agent-bridge는 **반드시 함께 배포·재시작**
- 현재 `promptVersion`은 **`advisor-v2`**이고 브리지는 그 버전만 받는다
- 한쪽만 올리면 400 `unsupported_prompt_version` → **어드바이저만 조용히 죽는다**(다른 화면은 멀쩡해 보인다)
- 버전 상수가 있는 파일 2곳을 적어 뒀다

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `deploy/k8s-snapshot/lib/rules.mjs` | 수정 | `eks:` 규칙 **존치 + 사유·삭제 시점 주석**, 함수 머리 주석에서 EKS 전제 제거 |
| `deploy/aws-snapshot/README.md` | 수정 | 7.1-2(지울 리소스 kOps 기준)·7.1-7(클러스터는 템플릿에 없다)·7.3·7.4·8장 표·예시 서비스 목록 |
| `deploy/k8s-snapshot/README.md` | 수정 | 3장 권한·컨텍스트 절차(SA 토큰/인증서, admin kubeconfig 금지), 2·6·7장 문구 |
| `deploy/k8s-snapshot/rbac/export-readonly.yaml` | 수정 | 연결 방법 주석 2곳 |
| `README.md` | 수정 | **api·브리지 동시 배포 주의**(promptVersion advisor-v2) |

### 5. 주요 결정과 이유

**결정 A. `k8s-snapshot/README.md`까지 고쳤다(지시 범위 밖).**
PM이 세운 기준은 "사람이 따라 하는 절차 문서의 틀린 안내는 해롭다"이다. `aws-snapshot`의 복원 절차보다 `k8s-snapshot` 3장이 그 기준에 **더 강하게** 걸린다 — 복원은 "나중에 할 수도 있는 일"이지만 3장은 **이 CLI를 처음 쓰려면 반드시 거치는 첫 단계**이고, kOps에는 그 명령 자체가 없다. 같은 기준을 한쪽에만 적용하면 다음 사람이 "여기는 왜 안 고쳤지"로 헷갈린다. 되돌리기는 쉽다(문서·주석만).

**결정 B. state store S3 버킷은 "지우지 말 것"으로 적었다.**
7.1-2는 "자동 생성 리소스를 지운다" 목록인데, state store 버킷을 그 흐름으로 지우면 **클러스터 정의가 통째로 사라진다.** 목록 안에 경고를 같이 넣어야 실수를 막는다(명세 3.5.4가 비용 계산에서 제외한 것과는 다른 이야기다 — 비용에서 빼는 것과 지우는 것은 전혀 다르다).

**결정 C. `kops` 복원 명령을 자세히 쓰지 않았다.**
PM 지시대로 "EKS 전제를 걷어내고 다음 범위임을 적는" 선까지만 했다. 실제 `kops create -f` 절차는 `deploy/kops-snapshot/`(다음 범위) 명세가 확정된 뒤에 쓰는 것이 맞다. 지금 추측으로 쓰면 **검증되지 않은 복원 절차**가 또 하나 생긴다.

### 6. 검증 결과

| 명령 / 확인 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과(오류 0) | |
| `npm test --prefix apps/api` | **44 suites / 457 passed, 1 skipped** | 기준선과 같음(문서·주석 변경이라 증감 없음) |
| `npm run build --prefix apps/api` | 통과 | |
| `npm test --prefix apps/agent-bridge` | 57 passed | |
| `npm test --prefix deploy/k8s-snapshot` | **65 pass / 0 fail** | `rules.mjs` 주석 변경 후 회귀 없음 |
| `npm test --prefix deploy/aws-snapshot` | **105 pass / 0 fail** | |
| `deploy/**`·`README.md`·`.env.example`·`docker-compose.yml`의 `eks`·`EKS` 재검색 | 남은 것은 **의도적으로 남긴 2줄뿐** | ① `rules.mjs`/README의 "EKS 잔재 — 다음 정리 때 삭제" 설명 ② k8s-snapshot README의 "kOps에는 EKS access entry가 없다"는 대비 설명 |
| README 배포 주의 문구 | 추가됨(`advisor-v2`) | 전에는 **없었다** |

**하지 않은 검증**
- **문서 절차를 실제로 따라가 보지 못했다.** 실클러스터·실 AWS 계정이 없다. `k8s-snapshot` 3장의 새 절차(SA 토큰·클라이언트 인증서)와 `aws-snapshot` 7장의 kOps 리소스 목록은 **명세 0.2의 확인된 사실(F1~F7)과 kOps 문서를 근거로 쓴 것**이고, 실행으로 확인한 것이 아니다.
- AC-KOPS37(`kubectl auth can-i --list`)은 P5와 같은 이유로 **여전히 미검증**이다.
- 새로 적은 kOps 보안 그룹 이름(`masters.<클러스터>`·`nodes.<클러스터>`)과 Route53 레코드 이름(`api.<클러스터>`)은 kOps 기본 규칙 기준이고 **실클러스터에서 확인하지 않았다**(U2와 같은 성격). 문서에 단정형으로 적혀 있으므로, 실클러스터 확인 때 함께 봐 주기 바란다.

### 7. 남은 이슈·한계

1. **`eks:` RBAC 규칙은 의도적으로 남아 있다**(PM 결정). 다음 정리 때 `lib/rules.mjs`·README·`docs/specs/k8s-snapshot.md` 3.4를 함께 지우면 된다. CLI 테스트 65건 중 이 규칙을 직접 검증하는 것이 있으면 같이 손봐야 한다.
2. **`deploy/aws-snapshot`·`deploy/k8s-snapshot` 문서의 kOps 절차는 미검증**이다(6절).
3. `deploy/kops-snapshot/`(클러스터 정의 스냅샷)은 **다음 범위**다. 그때까지 "클러스터 자체를 파일로 남기는 방법"이 저장소에 없다 — 두 README 모두 그 사실을 명시해 뒀다.
4. AC-KOPS37 미검증(P5와 동일).

### 8. 다른 담당 요청

- **PM 확인 요청**: 결정 A(`k8s-snapshot/README.md`·RBAC 주석까지 고친 것)가 지시 범위를 넘었다. 같은 판정 기준을 적용한 것이지만 되돌리라면 되돌리겠다(문서·주석뿐이라 비용이 없다).
- **PM/운영 요청**: 실클러스터가 생기면 ① AC-KOPS37(`auth can-i --list`) ② `aws-snapshot` 7.1-2의 kOps 리소스·태그 목록(보안 그룹 이름·Route53 레코드) ③ U2·U4·U5·U8을 함께 확인해 주기 바란다.
- **planner 참고**: `docs/specs/k8s-snapshot.md` 3.4의 "EKS 잔재 존치" 방침을 코드 주석에도 적었다. 다음 정리 때 두 곳을 같이 지우면 된다.

### 9. 다음 담당이 알아야 할 점

- **배포**: `apps/api`와 `apps/agent-bridge`를 **함께** 올린다. `promptVersion` 상수는 `apps/api/src/advisor/run/advisor-run.service.ts`와 `apps/agent-bridge/src/agent/output-schema.ts` 두 곳이고, 지금 값은 **`advisor-v2`**다. README 실행 안내 바로 아래에 같은 경고가 있다.
- **두 스냅샷 CLI는 대시보드 밖 사람용 도구**다. 대시보드 RBAC(`deploy/rbac.yaml`)와 권한이 분리돼 있고, 두 README 모두 **admin kubeconfig 금지**를 적어 뒀다.
- `deploy/k8s-snapshot/lib/rules.mjs`의 `eks:` 규칙은 **일부러 남긴 것**이다(주석 참고). 지우기 전에 `docs/specs/k8s-snapshot.md` 3.4를 먼저 확인할 것.

---

## 2026-09-24 12:45 · P5 마지막 수정 (미확인 값에 "확인 필요" 표시)

### 1. 요청 내용

PM 지시:
1. 범위 초과 건(`deploy/k8s-snapshot/README.md` 3장)은 **되돌리지 말고 유지**한다.
2. **실클러스터에서 확인하지 않은 이름·태그·레코드에 "확인 필요(미검증)" 표시**를 단다. 위치가 나쁘다 — **사람이 리소스를 지울 때 보는 목록**이라 이름이 틀리면 ① 지워야 할 것을 못 지우거나 ② **엉뚱한 것을 지운다**. 형식은 계약의 `api_lb` "추정" 라벨과 같은 취지면 된다.
3. 새 절차 전체가 **명세 F1~F7·kOps 문서만을 근거로 한다는 점을 문서 안에 한 줄** 남긴다(보고서가 아니라 문서에 — 그 문서를 읽는 사람은 보고서를 보지 않는다).
4. **`state store S3 버킷은 지우지 말 것`은 그대로 둔다.** 가장 중요한 줄이다.

### 2. 참고한 문서

- `docs/specs/kops-support.md` **0.2(확인된 사실 F1~F11)**와 **0.3(확인 필요 U1~U8)** — 무엇이 확인됐고 무엇이 추정인지 가르는 기준으로 그대로 썼다
- `docs/api/aws-cost.md` 3.1의 `api_lb` "추정" 라벨 — 표시 형식의 본보기

### 3. 작업 내용

#### (1) `deploy/aws-snapshot/README.md` 7.1-2 — 목록을 **확인 상태 표**로 바꿨다

줄글 목록은 확인된 것과 추정을 섞어 놓으면 구분이 안 된다. **"지울 것 / 확인 상태" 2열 표**로 바꿔 행마다 근거를 붙였다.

| 항목 | 표시 |
|---|---|
| ASG·Launch Template(IG 1개 = ASG 1개) | 확인됨 (F4) |
| 마스터·워커 EC2, 루트 EBS, **etcd main/events 볼륨**(마스터당 2개·gp3 20GB) | 확인됨 (F6) |
| kOps **보안 그룹**·ENI | **[확인 필요]** — `masters.<클러스터>`·`nodes.<클러스터>`는 **추정**(내가 쓴 이름이고 명세에 없다) |
| **API 서버 LB**·Target Group·Listener | class(NLB)만 확인됨(F7), **[확인 필요]** 이름·`Name` 태그 규칙 미확인(**명세 U2** — 대시보드 비용 추정에서도 같은 항목이 미확인이라고 연결해 뒀다) |
| Service/Ingress가 만든 ELB·TG·SG, PVC 볼륨, 기본 VPC·서비스 연결 역할 | 확인됨 |
| **Route53 레코드** | **[확인 필요]** `api.<클러스터>`는 **추정**(명세 3.6.3의 "보통"). **`--dns=none`이면 레코드가 아예 없다**(F9)는 점도 같이 적었다 |

- 표 머리에 **⚠️ 경고 블록**: 이 목록은 kOps 공식 문서·소스에서 확인한 사실(0.2 F1~F9)과 명세를 근거로 썼고 **실제 클러스터에서 대조하지 않았다**, `[확인 필요]`는 추정이다, **지우기 전에 실제 태그·이름을 먼저 확인하라 — 틀리면 못 지우거나 엉뚱한 것을 지운다**, 확인한 값은 표시를 떼고 기록하라.
- **판단 기준 태그도 확인 상태를 나눠 적었다**: `kubernetes.io/cluster/<이름>`(F3)·`kops.k8s.io/instancegroup`(F2)·`elbv2.k8s.aws/cluster` 등은 확인됨, **`k8s.io/role/*`는 [확인 필요]**(명세 U3 — 접두어 상수의 실제 문자열을 소스에서 확인하지 못했다) + **"이 태그만으로 마스터/워커를 가르지 말 것"**.
- **"지우면 안 되는 것"을 별도 소제목으로 분리**했다(PM 지시 4). 전에는 "지울 것" 목록의 한 줄에 괄호로 붙어 있어 흐름대로 읽으면 지울 것처럼 보였다. 이유도 늘렸다(여러 클러스터가 버킷을 공유할 수 있다, 지우면 **설계도가 통째로 사라진다**).

#### (2) `deploy/k8s-snapshot/README.md` 3장 — 근거·추정 표시

- 3장 머리에 **⚠️ 경고 블록**: 2·3번 절차는 kOps 문서와 명세 3.6을 근거로 썼고 **실행해 확인하지 않았다**, API 서버 주소는 **추정**(`--dns=none`·내부 LB면 다르다), **4번 확인까지 마쳐야 읽기 전용인지 알 수 있다**.
- 3번의 서버 주소에 `— **확인 필요**`를 달고, **실제 값을 꺼내는 명령**(`kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}'`)을 함께 적었다. 추정을 적었으면 **추정하지 않고 확인하는 방법**도 같이 줘야 한다.

#### (3) 루트 `README.md` "대시보드용 kubeconfig"

같은 성격의 절차이고 같은 추정(`https://api.<클러스터 이름>`)이 들어 있어 같은 표시를 달았다. 머리에 ⚠️ 한 줄 + 3번에 `(**확인 필요**)` + "아래처럼 실제 값을 꺼내는 쪽이 확실하다".

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `deploy/aws-snapshot/README.md` | 수정 | 7.1-2를 **확인 상태 표**로, ⚠️ 근거·추정 경고, 판단 기준 태그별 확인 상태, **"지우면 안 되는 것"(state store S3) 별도 소제목** |
| `deploy/k8s-snapshot/README.md` | 수정 | 3장 ⚠️ 근거·추정 경고, 서버 주소 `확인 필요` + 실제 값 꺼내는 명령 |
| `README.md` | 수정 | kubeconfig 절차 ⚠️ 근거·추정 경고, 서버 주소 `확인 필요` |

코드 변경 **없음**(문서만).

### 5. 주요 결정과 이유

**결정 A. 줄글 목록 → 확인 상태 표.**
"확인 필요"를 문장 끝에 덧붙이면 긴 줄에서 눈에 안 띈다. 이 목록은 **사람이 한 줄씩 보며 리소스를 지우는 체크리스트**라 행마다 확인 상태가 **같은 열에** 보여야 한다. 계약의 `api_lb`가 행마다 `identification.confidence`를 두는 것과 같은 방식이다.

**결정 B. 확인됨/추정의 기준을 명세 0.2·0.3으로 통일했다.**
내가 "확인했다"고 판단하는 대신 planner가 근거까지 적어 둔 F1~F11·U1~U8을 그대로 인용했다. 표에 `(F4)`·`(F6)`·`(U2)`·`(U3)`를 적어 **독자가 근거를 직접 확인할 수 있게** 했다. 내가 새로 지어낸 이름(보안 그룹)은 명세에 없으므로 자동으로 "추정"이 된다.

**결정 C. 추정 표시와 함께 "확인하는 방법"을 줬다.**
"확인 필요"만 적으면 독자는 막힌다. 서버 주소는 `kubectl config view`로, 태그·이름은 "지우기 전에 실제 값을 확인하라"로 다음 행동을 적었다.

**결정 D. `k8s.io/role/*`에는 금지 문장을 덧붙였다.**
이 태그는 **마스터/워커를 가르는 데 쓰는** 태그다. 틀리면 "엉뚱한 것을 지운다"가 곧바로 마스터 삭제가 된다. 그래서 `[확인 필요]`에 더해 **"이 태그만으로 마스터/워커를 가르지 말 것"**을 적었다(대시보드 코드도 같은 이유로 태그가 아니라 노드 라벨에서 출발한다 — P4 결정과 같은 원칙).

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과(오류 0) | |
| `npm test --prefix apps/api` | **44 suites / 457 passed, 1 skipped** | 기준선과 동일(문서만 변경) |
| `npm test --prefix apps/agent-bridge` | **57 passed** | |
| `npm test --prefix deploy/k8s-snapshot` | **65 pass / 0 fail** | |
| `npm test --prefix deploy/aws-snapshot` | **105 pass / 0 fail** | |
| `state store S3 버킷은 지우지 말 것` 존치 | **유지**(별도 소제목으로 더 눈에 띄게) | PM 지시 4 |
| 기동 검증 | **하지 않음** | 문서 변경이라 불필요(PM 지시) |

**하지 않은 검증**: 문서에 적은 kOps 이름·태그·주소를 **실클러스터에서 확인하지 못한 상태 그대로**다 — 그것을 감추지 않고 문서에 표시하는 것이 이번 작업이었다. AC-KOPS37도 여전히 미검증이다.

### 7. 남은 이슈·한계

1. **`[확인 필요]` 5곳이 문서에 남아 있다**(보안 그룹 이름, API LB 이름·태그(U2), Route53 레코드, `k8s.io/role/*`(U3), API 서버 주소). 실클러스터에서 확인하면 표시를 떼고 값을 기록하면 된다 — 그 방법도 문서에 적혀 있다.
2. AC-KOPS37(`kubectl auth can-i --list`) 미검증.
3. `deploy/kops-snapshot/`(클러스터 정의 스냅샷)은 다음 범위.

### 8. 다른 담당 요청

- **PM/운영**: 실클러스터가 생기면 `[확인 필요]` 5곳을 한 번에 확인할 수 있다. 우선순위는 **① `k8s.io/role/*`(틀리면 마스터를 지울 수 있다) → ② API LB 이름·태그(U2, 비용도 같이 틀린다) → ③ 보안 그룹 이름 → ④ Route53 레코드 → ⑤ API 서버 주소**.
- **planner 참고**: 명세 0.2·0.3의 F·U 번호를 문서에서 직접 인용했다. 번호가 바뀌면 `deploy/aws-snapshot/README.md` 7.1-2의 표도 같이 고쳐야 한다.

### 9. 다음 담당이 알아야 할 점

- **`[확인 필요]` 표시는 "아직 모른다"는 뜻이지 "틀렸다"는 뜻이 아니다.** 지우기 전에 실제 값을 확인하고, 확인한 값으로 문서를 고치면서 표시를 뗀다.
- 확인됨/추정의 근거는 **`docs/specs/kops-support.md` 0.2(F1~F11)·0.3(U1~U8)** 하나로 통일돼 있다. 새 사실을 확인하면 명세와 이 문서를 함께 고친다.
- **`kOps state store S3 버킷`은 어떤 경우에도 "자동 생성 리소스 정리" 대상이 아니다.**

---

## 2026-09-24 12:05 · SSE `cluster.controlplane.updated` 변경 감지 마무리 (세션 중단분)

> 시각 표기가 앞 섹션(12:10·12:45)보다 이르게 보이지만 **이 섹션이 가장 최근 작업**이다(실제 실행 시각 기준으로 적었다).

### 1. 요청 내용

- PM: 어제 세션 한도로 끊긴 **SSE 변경 감지** 작업 마무리. 회귀 테스트(`control-plane.spec.ts`의 `describe('cluster.controlplane.updated 변경 감지')`)는 있고 구현이 덜 끝난 상태(2 failed / 460 passed).
- PM 진단: Expected와 Received의 유일한 차이가 `statusChangedAt`. `CONTROL_PLANE_VOLATILE_KEYS`에 이 키가 빠져 있다.
- PM이 판단을 요구한 지점: **(1) volatile 키에 넣으면 되는 경우** vs **(2) `statusChangedAt`이 상태가 안 바뀌었는데도 갱신되는 생산자 버그**. 코드로 확인하고 근거를 남길 것. (2)라면 기존 `cluster-status` 동작을 건드리므로 테스트가 깨지면 멈추고 보고.
- 마무리 조건: lint/test/build 통과 + **실제 mock SSE 구독으로 60~75초 관찰해 숫자로 보고**(이전에 두 번 "고쳤다"고 하고 실제로는 안 멎었음). 포트 3121, 자기 PID만 종료.
- 범위: 이 건만. `apps/web/**`, `apps/api/src/database/**`, `apps/api/prisma/**` 금지. `deploy/rbac.yaml` 권한 증가 금지.

### 2. 참고한 문서

- `docs/api/cluster-status.md` 8.2(토픽 `cluster`)·8.3(토픽 `metrics`)·3.3(`GET /api/cluster/control-plane`)
- `docs/specs/kops-support.md` 3.2·4절(컨트롤 플레인 전용 토픽을 만들지 않는다)
- 코드: `apps/api/src/common/status.ts`(`StatusChangeTracker`), `apps/api/src/common/hash.ts`(`changeKey`), `apps/api/src/cluster/state/cluster-state.service.ts`, `apps/api/src/cluster/cluster-topics.ts`

### 3. 작업 내용

#### 3.1 판단: **(1)번이다. 생산자 버그가 아니다**

근거를 셋으로 확인했다.

**근거 A — 코드.** `statusChangedAt`은 `StatusChangeTracker.track(key, status, nowIso)`가 만든다(`common/status.ts`).

```ts
track(key, status, nowIso) {
  const prev = this.map.get(key);
  if (!prev || prev.status !== status) { this.map.set(key, { status, at: nowIso }); return nowIso; }
  return prev.at;   // status가 같으면 예전 시각을 그대로 돌려준다
}
```

즉 **`status` 값이 바뀔 때만** 갱신된다. 그리고 런타임에서 이 tracker는 **한 개가 계속 살아 있다** — `ClusterStateService`의 `private readonly tracker = new StatusChangeTracker()`를 매 `recompute()`가 그대로 넘긴다. `clear()`는 `resetTracking()`(mock 시나리오 교체) 한 곳에서만 부르고, 그 직후 `requestResync()`로 **전체 스냅샷을 다시 보낸다**. 따라서 이름 그대로 동작한다.

**근거 B — 실제 API 관찰.** mock api를 띄우고 `GET /api/cluster/control-plane`을 15초 간격으로 두 번 받아 필드 단위로 diff했다(`cp-component-crash` 시나리오, 컨트롤 플레인이 살아 있는 상태). **차이 73건 중 `statusChangedAt`은 0건**이다:

```
차이 73건
필드별 건수: generatedAt=1 updatedAt=22 usageMillicores=1 usagePct=2 usageBytes=1
             cpuMillicores=3 memoryBytes=3 cpuPct=3 memoryPct=3 lastReportedAt=21 observedSec=13
```

런타임에서 15초마다 흔들리는 것은 `generatedAt`·`updatedAt`(이미 `changeKey`가 뺀다), `usage`/`totals`, `lastReportedAt`, `observedSec`뿐이다. `statusChangedAt`은 움직이지 않는다 → **화면의 "언제부터 이 상태였나"는 거짓이 아니다.**

**근거 C — 그럼 테스트는 왜 깨졌나.** 스펙 헬퍼 `input()`이 호출될 때마다 `tracker: new StatusChangeTracker()`를 새로 만든다. 그래서 두 번째 평가가 "처음 보는 키"가 되어 모든 `statusChangedAt`에 그 평가의 `atIso`(NOW+45s)가 찍힌다. **테스트 하네스가 런타임보다 엄격한 조건(트래커 수명과 무관하게 같은 키)을 요구한 것**이지, 생산자가 틀린 게 아니다.

→ 그래서 (2)번 처리(생산자 수정)는 하지 않았다. 고칠 것이 없고, 고쳤다면 이미 검증을 마친 `cluster-status` 동작을 근거 없이 건드리는 일이 된다.

#### 3.2 수정

`CONTROL_PLANE_VOLATILE_KEYS`에 `statusChangedAt`을 추가하고, **왜 빼도 안전한지**를 기존 기준 주석과 같은 형식으로 적었다.

- 이 값이 바뀌면 같은 객체의 `status`도 반드시 함께 바뀐다(= 변경은 `status`로 감지된다). 그래서 변경 감지 신호로서 독립적인 정보가 없다.
- 판단 주체가 바뀌어 시각이 다시 찍히는 경우(평가기 재시작, mock 시나리오 교체 `resetTracking`)는 곧바로 `requestResync()` → `cluster.snapshot` 전체 재전송이라 화면 값도 그때 맞춰진다.
- 이 필드는 `status`, `masters.items[].node.status`, `components.items[].status` **세 곳**에 들어 있어서, 트래커가 새로 시작하는 순간 한 번에 수십 곳이 달라진다.

계약(`docs/api/cluster-status.md` 8.2)에 **어떤 값만 달라지면 이벤트를 보내지 않는지** 한 줄로 명시했다(프론트가 "값이 갱신 안 되는 것처럼 보이는" 상황을 오해하지 않도록).

#### 3.3 실제 SSE 관찰 (PM 요구)

**먼저 발견한 것: 포트 3121은 내 프로세스가 아니었다.** 내가 3121로 띄운 프로세스는 `EADDRINUSE`로 죽었는데 curl은 200을 돌려줬다. 확인해 보니 **오늘 09:40:55에 시작된 다른 세션의 `node dist/main`(PID 24548)이 3121을 잡고 있었다**(지금도 살아 있다).

```
TCP 0.0.0.0:3121 LISTENING 24548
ProcessId=24548 CreationDate=2026-09-24 09:40:55 CommandLine="node.exe" dist/main
```

**이전에 두 번 "고쳤다"고 보고했다가 실제로는 안 멎어 있던 원인이 이것일 가능성이 높다** — 3121에 붙어도 내가 빌드한 코드가 아니라 **09:40에 뜬 옛날 빌드**가 응답한다. 규칙(자기가 띄운 PID만 종료)에 따라 이 프로세스는 **죽이지 않았고**, 내 관찰은 **포트 3123**에 내가 띄운 프로세스(PID 25488 → 수정 후 11036)로 했다. 관찰이 끝나고 내 PID 2개만 `Stop-Process -Id`로 종료했다.

| # | 대상 | 시나리오 | 관찰 시간 | `cluster.controlplane.updated` | 같은 시간 다른 이벤트(스트림이 살아 있다는 증거) |
|---|---|---|---|---|---|
| 1 | 수정 **전** 빌드 (내 PID 25488, :3123) | mixed(기본) | **75초** | **0건** | node.upsert 6 · pod.upsert 15 · event.upsert 16 · pvc.upsert 11 · summary.updated 11 · heartbeat 4 |
| 2 | 수정 **후** 빌드 (내 PID 11036, :3123) | mixed(기본) | **75초** | **0건** | node.upsert 6 · pod.upsert 12 · event.upsert 16 · pvc.upsert 11 · summary.updated 11 · heartbeat 4 |
| 3 | 수정 **후** 빌드 (내 PID 11036, :3123) | `cp-healthy` | **75초** | **0건** | pvc.upsert 10 · summary.updated 6 · heartbeat 4 |
| 4 | 수정 **후** 빌드 (내 PID 11036, :3123) | `cp-component-crash` (컨트롤 플레인 critical) | **75초** | **0건** | 아래 폴링 결과 참고 |
| 5 | 남의 프로세스 (PID 24548, :3121, 09:40 빌드) — 읽기만 | mixed | 45초 | 0건 | node/pod/event/pvc/summary 정상 |

**숫자를 그대로 적으면: 수정 전에도 런타임 재전송은 0건이었다.** 어제 작업분으로 이미 들어가 있던 `lastReportedAt`·`observedSec`·`usage`·`totals` 제외만으로 런타임 스팸은 멎어 있었고, 이번에 남아 있던 실패는 **트래커 수명에 의존하던 회귀 테스트 2건**이었다. 이 사실을 감추지 않고 그대로 보고한다.

관찰 4가 "그냥 이벤트가 안 나가는 것 아니냐"는 의심을 받지 않도록, 같은 시나리오에서 `GET /api/cluster/control-plane`을 15초 간격 6회 폴링해 **원본은 계속 바뀌는데 변경 감지 키는 안 바뀐다**는 것을 확인했다(`rawChanged=true`, `keyChanged=false`가 5회 연속). 즉 스트림이 죽은 게 아니라 **의미 없는 차이를 정확히 걸러낸 것**이다.

```
t=0s  status=critical cells=13/0/1 keyChanged=-     rawChanged=-
t=15s status=critical cells=13/0/1 keyChanged=false rawChanged=true
t=30s status=critical cells=13/0/1 keyChanged=false rawChanged=true
t=45s status=critical cells=13/0/1 keyChanged=false rawChanged=true
t=60s status=critical cells=13/0/1 keyChanged=false rawChanged=true
t=75s status=critical cells=13/0/1 keyChanged=false rawChanged=true
```

진짜 변화가 나가는 쪽은 회귀 테스트 3건(`진짜 변화(구성요소 장애)`, `진짜 변화(마스터 NotReady)`, `마스터 allocatable이 바뀌면(totals를 빼도)`)이 계속 지킨다 — 모두 통과.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/cluster/state/control-plane.ts` | 수정 | `CONTROL_PLANE_VOLATILE_KEYS`에 `statusChangedAt` 추가 + 왜 빼도 안전한지(status가 함께 바뀐다 / 트래커 초기화 뒤에는 resync 스냅샷) 주석 |
| `docs/api/cluster-status.md` | 수정 | 8.2에 `cluster.controlplane.updated`가 **보내지 않는 차이**(파생 시각·관측 창·사용량) 명시 |
| `docs/reports/kops-support/backend.md` | 수정 | 이 섹션 추가 |

- 코드 수정은 **1줄 + 주석**이다. 다른 리팩터링은 넣지 않았다(PM 범위 지시).
- `apps/web/**`, `apps/api/src/database/**`, `apps/api/prisma/**`, `deploy/rbac.yaml`은 건드리지 않았다.

### 5. 주요 결정과 이유

| 결정 | 검토한 대안 | 선택 이유 |
|---|---|---|
| `statusChangedAt`을 volatile 키에 넣는다 | (a) 생산자(`StatusChangeTracker`) 수정 (b) 스펙 헬퍼가 트래커를 공유하도록 테스트를 고친다 | (a)는 고칠 버그가 없다(근거 A·B). (b)는 테스트를 런타임에 맞춰 **약화**시키는 쪽이고, 그러면 트래커가 초기화되는 경로에서 18KB 객체가 통째로 재전송되는 것을 막지 못한다. 키에 넣으면 변경 감지가 **시각이 아니라 의미(status 값·이유·구성)** 로만 판단하게 되어 트래커 수명과 무관해진다 |
| 계약에 "안 보내는 차이"를 명시 | 코드에만 남기기 | 프론트가 `statusChangedAt`이 즉시 안 오는 것을 버그로 오해할 수 있다. 8.2 한 줄이면 끝난다 |
| 관찰을 3121이 아니라 3123에서 | 3121을 비우고(= PID 24548 종료) 지시대로 사용 | 공통 규칙 "자기가 띄운 PID만 종료". 남의 세션 프로세스를 죽이지 않는다. 대신 무엇이 3121을 잡고 있는지 근거와 함께 보고 |
| mock 시나리오를 바꿔 `cp-healthy`·`cp-component-crash`에서도 관찰 | 기본 시나리오 1회만 | 기본(mixed) 하나로는 "컨트롤 플레인이 원래 안 바뀌어서 0건"인지 구분이 안 된다. critical 시나리오에서 **원본은 바뀌는데(rawChanged) 키는 안 바뀌는 것(keyChanged)** 까지 봐야 진짜 확인이다 |

### 6. 검증 결과

| 명령 | 결과 | 비고 |
|---|---|---|
| `npx jest src/cluster/state/control-plane.spec.ts` (수정 전) | **2 failed / 16 passed** | 실패 2건: `아무 변화가 없으면 키가 같다`, `파생 시각·관측 창·사용량만 바뀌면 키가 같다` — 둘 다 차이는 `statusChangedAt`뿐 |
| `npx jest src/cluster/state/control-plane.spec.ts` (수정 후) | **18 passed / 18** | |
| `npm test --prefix apps/api` | **44 suites 전부 통과 · 462 passed, 1 skipped, 0 failed** | PM 기준(462 passed / 1 skipped) 충족 |
| `npm run lint --prefix apps/api` | **통과** (exit 0) | `--fix`가 내 파일 외에 바꾼 것 없음(최근 변경 파일 목록으로 확인) |
| `npm run build --prefix apps/api` | **통과** (exit 0) | |
| mock SSE 실관찰 | **75초 × 3회 + 45초 × 1회, `cluster.controlplane.updated` 총 0건** | 위 3.3 표. 포트 3123(내 프로세스), 내 PID 25488·11036만 종료 |
| 프로세스 정리 | 내 PID 2개 종료, **3121(PID 24548)은 남겨 둠** | 남의 세션 프로세스 |
| `apps/web` 테스트 | **돌리지 않음** | PM 지시(웹 510건 전부 통과, 건드리지 않음) |

### 7. 남은 이슈·한계

1. **수정 전에도 런타임 재전송은 0건이었다.** 이번 변경의 실효는 (a) 회귀 테스트가 요구한 "트래커 수명과 무관한 안정성" 확보, (b) 평가기 재시작·`resetTracking` 직후의 불필요한 18KB 재전송 차단이다. "15초마다 2건"을 눈으로 재현해 없앤 것은 아니다 — 그 증상은 어제 들어간 `lastReportedAt`·`observedSec`·`usage`·`totals` 제외로 이미 멎어 있었다.
2. **3121에 남의 프로세스(PID 24548, 09:40 빌드)가 아직 떠 있다.** 이걸 모르고 3121에 붙어 검증하면 옛날 빌드를 측정하게 된다. 이전 "고쳤는데 안 멎더라"의 원인일 수 있다.
3. 관찰은 전부 **mock**이다. 실클러스터(kOps)에서는 kubelet 보고 주기·informer 재동기화 때문에 다른 필드가 흔들릴 수 있다. 그때는 이 파일의 volatile 키 목록에 같은 기준("매 평가마다 갱신되지만 의미가 안 바뀌는 값")으로 추가하면 된다.
4. `CONTROL_PLANE_VOLATILE_KEYS`는 **키 이름 기준(JSON.stringify replacer)** 이라 컨트롤 플레인 객체 안 어디에 있든 같은 이름이면 전부 빠진다. 지금은 그게 의도지만, 앞으로 같은 이름의 다른 의미 필드를 추가하면 조용히 함께 빠진다.

### 8. 다른 담당 요청

- **PM 요청**: 포트 3121의 PID 24548(오늘 09:40:55 시작, `node dist/main`)이 누구 것인지 확인하고 정리해 달라. 내가 죽이지 않았다. 이후 검증에서 3121을 쓰려면 먼저 비워야 하고, 그 전까지 3121 관찰값은 **옛날 빌드**를 측정한 값이다.
- **frontend 요청(참고)**: `docs/api/cluster-status.md` 8.2에 "안 보내는 차이"를 적었다. `statusChangedAt`·`lastReportedAt`은 다음 `cluster.controlplane.updated`나 스냅샷에서 따라온다. 화면이 이 값으로 "N분 전부터"를 그린다면 최대 한 이벤트만큼 옛 값을 보여줄 수 있다(상태가 바뀌는 순간에는 함께 갱신된다).
- DBA 요청 없음. 대시보드 DB 테이블 변경 없음. RBAC 변경 없음.

### 9. 다음 담당이 알아야 할 점

- 컨트롤 플레인 SSE 재전송이 또 의심되면 **`GET /api/cluster/control-plane`을 15초 간격으로 두 번 받아 필드 단위 diff**를 먼저 해라. 어떤 필드가 흔들리는지 바로 나온다(위 3.3 근거 B). 그 다음 `CONTROL_PLANE_VOLATILE_KEYS` 기준에 맞는지 판단한다.
- **검증 서버는 포트가 정말 내 것인지 먼저 확인해라**: `netstat -ano | grep ":<port> "` → PID → `Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>'`. `EADDRINUSE`로 내 프로세스가 죽어도 curl은 200을 돌려준다(남의 서버가 답한다).
- `statusChangedAt`은 **값 자체는 REST·SSE payload에 그대로 나간다.** 변경 **감지**에서만 뺀 것이다(`changeKey`의 replacer는 비교용 문자열에만 쓰인다).
