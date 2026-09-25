# 기능 명세: kops-support (대상 환경을 EKS → kOps 클러스터로 전환)

- 작성: planner, 2026-09-24
- 상태: 초안 (열린 질문 Q1~Q9는 PM 확인 필요. Q를 빼고도 1단계 착수는 가능)
- 관련 문서: `CLAUDE.md` "확정된 결정" (특히 **kOps 전환 (2026-09-24)**), `docs/specs/cluster-status.md`, `docs/specs/aws-cost.md`, `docs/specs/architecture-advisor.md`, `docs/api/common.md`, `docs/api/cluster-status.md`, `docs/api/aws-cost.md`, `docs/api/architecture-advisor.md`
- 이 명세는 **기존 세 기능(`cluster-status`, `aws-cost`, `architecture-advisor`)을 고치는 명세**다. 새 화면을 크게 만드는 기능이 아니라, 대상 환경이 바뀌면서 깨지는 전제를 바로잡고 컨트롤 플레인이라는 관측 대상을 새로 추가한다.
- **조회 전용 원칙은 그대로다.** `kops update cluster`, `kops rolling-update`, `kops edit` 같은 클러스터 변경 명령은 대시보드가 실행하지 않고, 이 명세 어디에도 실행 기능으로 넣지 않는다.
- **갱신: 2026-09-25 (alerts·logs).** 3.1(사이드바 합산 규칙과 새 메뉴 3개의 관계), 3.2.2("지표는 없지만 로그는 볼 수 있다"), 10.8(`pods/log` 추가는 `logs` 기능의 변경이라는 점)에 **보충 설명만** 넣었다. **판단 기준·집계 규칙·AC는 하나도 바뀌지 않았다.**

---

## 0. 확정 전제와 사실 확인

### 0.1 PM이 이미 확정한 것 (재논의하지 않는다)

| # | 확정 내용 |
|---|---|
| D1 | **EKS 경로를 코드에서 완전히 걷어낸다.** `PLATFORM=eks\|kops` 같은 플랫폼 분기 설정을 두지 않는다. kOps 전용이다. |
| D2 | **`autoscaling:DescribeAutoScalingGroups`를 추가하지 않는다.** 노드그룹은 클러스터에 실제로 붙어 있는 노드의 라벨로만 파악하고, 목표 대수(desired/min/max)·스케일 여력은 표시하지 않는다. |
| D3 | **컨트롤 플레인 모니터링은 기존 RBAC 범위 안에서 static pod 상태까지만.** etcd fsync, 리더 변경, apiserver 응답 지연 같은 Prometheus 스크레이프가 필요한 심층 지표는 범위 밖이다. **RBAC는 늘리지 않는다.** |
| D4 | 비용 카테고리 `eks`(EKS 컨트롤 플레인) → `controlPlane`으로 교체한다. |
| D5 | `EKS_CLUSTER_NAME` → `K8S_CLUSTER_NAME`으로 이름을 바꾼다. 클러스터 버전은 쿠버네티스 API에서 읽는다. |
| D6 | 마스터 노드는 `node-role.kubernetes.io/control-plane` 라벨로 워커와 **분리해 집계**한다. |
| D7 | 대시보드는 kOps admin kubeconfig(`kops export kubeconfig --admin`)를 쓰지 않는다. `deploy/rbac.yaml`의 ServiceAccount 토큰으로만 접속한다. |
| D8 | metrics-server는 kOps 기본 설치가 아니다. 없으면 사용량은 mock으로 바꾸지 않고 `unknown`으로 표시한다. |
| D9 | EC2 필터 태그 `kubernetes.io/cluster/<name>`은 kOps도 같으므로 그대로 쓴다. |

### 0.2 kOps 동작 — **확인함** (공식 문서·kOps 소스)

이 절의 내용은 명세의 사실 근거다. 추측이 아니라 확인한 것만 적는다.

| # | 사실 | 근거 |
|---|---|---|
| F1 | InstanceGroup 소속은 **노드 라벨 `kops.k8s.io/instancegroup`** = InstanceGroup 이름 | kOps `docs/labels.md`, `pkg/nodelabels` |
| F2 | 같은 키의 **EC2/ASG 태그 `kops.k8s.io/instancegroup`**가 인스턴스에 붙는다 (`nodeidentityaws.CloudTagInstanceGroupName = "kops.k8s.io/instancegroup"`) | kOps `pkg/nodeidentity/aws/identify.go`, `pkg/model/context.go`(`CloudTagsForInstanceGroup`) |
| F3 | kOps는 자기가 만든 AWS 리소스에 **`kubernetes.io/cluster/<클러스터이름> = owned`**(그리고 과거 방식인 `KubernetesCluster`)를 붙인다 | kOps issue #6775·#4035, PR #8660 |
| F4 | InstanceGroup은 AWS에서 **Auto Scaling Group 1개에 대응**한다 | kOps InstanceGroup 문서 |
| F5 | 컨트롤 플레인 구성요소는 마스터 노드의 `/etc/kubernetes/manifests`에 있는 **static pod**이고, `kube-system`에 **미러 파드**로 보인다: `kube-apiserver`, `kube-controller-manager`, `kube-scheduler`, `etcd-manager-main`, `etcd-manager-events` | kOps `docs/operations/etcd_administration.md`, 쿠버네티스 static pod 문서 |
| F6 | etcd는 **main / events 두 클러스터**이고, 마스터마다 **EBS 볼륨 2개**를 쓴다. 기본 **20GB, gp3** | kOps `cluster_spec.md` ("the Volumes created for the etcd clusters are `gp3` and 20GB each") |
| F7 | API 서버 앞단 로드밸런서의 기본 class는 **`Network`(NLB)**. CLB는 kOps 1.26에서 deprecated, 1.37에서 제거 | kOps `cluster_spec.md` |
| F8 | 마스터 노드 라벨은 **`node-role.kubernetes.io/control-plane`**. `kubernetes.io/role`은 쿠버네티스 1.24에서 제거됐다 | kOps `pkg/nodelabels`(`BuildMandatoryControlPlaneLabels`), kOps 1.24 릴리스 노트 |
| F9 | gossip DNS는 kOps 1.29 deprecated, **1.37에서 제거**. 클러스터는 Route53 호스팅 존을 쓰거나 `--dns=none`이다. 즉 **Route53 존이 없는 kOps 클러스터가 정상적으로 존재한다** | kOps 1.37 릴리스 노트, `gossip` 문서 |
| F10 | 쿠버네티스 1.23 이상 + 외부 AWS CCM이면 **Node 이름이 도메인 이름이 아니라 EC2 인스턴스 ID(`i-0…`)**가 된다 | kOps PR #12862 |
| F11 | metrics-server는 kOps의 **관리 애드온**이고 `spec.metricsServer.enabled`로 켠다 | kOps `addons` 문서 |

### 0.3 kOps 동작 — **확인 필요** (명세에서 단정하지 않는다)

| # | 확인이 필요한 것 | 이 명세에서의 처리 |
|---|---|---|
| U1 | metrics-server 애드온의 **기본값이 꺼짐인지** (kOps 문서에 기본값이 명시돼 있지 않다. 켜는 방법만 나온다) | `CLAUDE.md` 확정(D8)을 따라 "기본 설치가 아니다"로 전제하고, 실제로는 **있으면 쓰고 없으면 unknown**이라 어느 쪽이든 동작이 같다 |
| U2 | API 서버 NLB의 **정확한 이름·태그 규칙** (CLB 시절 이름은 `api-<하이픈 클러스터 이름>-<suffix>`로 확인됨. NLB의 `Name` 태그·이름 규칙은 미확인) | 3.5.3의 식별 규칙을 **후보 규칙 + 추정 라벨**로 정의하고, 최종 규칙은 백엔드가 실클러스터에서 확인해 `docs/api/aws-cost.md`에 적는다 |
| U3 | 역할 태그 접두어 상수 `CloudTagInstanceGroupRolePrefix`의 **실제 문자열**(`k8s.io/role/`로 보이지만 소스에서 값을 직접 확인하지 못했다) | 노드그룹 판단에 **쓰지 않는다**(D2에 따라 노드 라벨만 쓴다). 비용 쪽 마스터 판별도 태그가 아니라 **쿠버네티스 노드 라벨 → providerID → 인스턴스** 경로를 쓴다 |
| U4 | 미러 파드 이름 규칙(`<구성요소>-<노드 이름>`)이 kOps에서도 그대로인지 | 식별은 이름만으로 하지 않는다. 3.2.2의 2중 조건(마스터 노드 + 이름 접두어 목록)을 쓰고, 이름 규칙이 다르면 백엔드가 접두어 목록만 고친다 |
| U5 | kOps 1.36+의 `kops-channels`, `kube-apiserver-healthcheck` 등 **추가 static pod 목록** | 필수 5종 외의 마스터 static pod는 "기타 컨트롤 플레인 구성요소"로 묶어 표시하고 **필수 판정에 넣지 않는다**(있어도 없어도 정상) |
| U6 | `kops get cluster -o yaml` / `kops get ig -o yaml` 출력에 비밀값이 섞이는지, `--full`이 인증서·토큰 경로를 포함하는지 | 8절(`deploy/kops-snapshot/`)을 **다음 범위로 미루고**, 그 명세에서 확인한 뒤 결정한다 |
| U7 | kOps가 **admin이 아닌 kubeconfig**를 만들 수 있는지(`kops export kubeconfig`를 `--admin` 없이 쓸 때 실제로 어떤 자격 증명이 들어가는지) | 3.6에서 **kOps 명령에 의존하지 않는 경로**(ServiceAccount 토큰 kubeconfig를 사람이 직접 구성)를 기본으로 정한다 |
| U8 | kOps에서 대시보드 파드에 **AWS 읽기 권한을 주는 방법**(EKS IRSA 대체. kOps Pod Identity Webhook 또는 노드 인스턴스 프로파일) | `deploy/rbac.yaml`의 IRSA 주석을 지우고 "확인 필요"로 남긴다. 로컬 실행은 지금처럼 `~/.aws` 마운트라 영향 없다 |

---

## 1. 배경 / 목표

### 1.1 누가, 왜

- **누가**: 지금까지 EKS를 보던 것과 같은 사람(1인~소규모 팀 운영자). 달라진 것은 클러스터를 **자기가 kOps로 만들었고, 컨트롤 플레인 EC2도 자기 것**이라는 점이다.
- **왜**: EKS에서는 컨트롤 플레인이 AWS 책임이라 "apiserver가 살아 있는가"를 볼 필요가 없었다. kOps에서는 마스터가 내 EC2이므로, 마스터 1대가 죽었는데 모르고 지나가면 다음 1대가 죽는 순간 클러스터 전체가 멈춘다. 지금 대시보드는 **그 사실을 볼 수 없을 뿐 아니라, 마스터를 워커와 섞어 세어 숫자를 왜곡한다.**

### 1.2 kOps와 EKS의 차이가 대시보드에 미치는 영향 (배경을 모른다고 가정)

> EKS는 AWS가 컨트롤 플레인(apiserver·etcd·scheduler·controller-manager)을 관리형으로 운영하고 시간당 요금을 받는 서비스다. kOps(Kubernetes Operations)는 **같은 구성요소를 내 AWS 계정의 EC2 위에 직접 띄우는 도구**다. 클러스터의 "설계도"는 S3 버킷(state store)에 `Cluster` / `InstanceGroup` 객체로 저장되고, `kops` CLI가 그것을 보고 ASG·EC2·볼륨·로드밸런서를 만든다.

| 항목 | EKS | kOps | 대시보드에 생기는 문제 |
|---|---|---|---|
| 컨트롤 플레인 | AWS 관리형. 노드 목록에 안 보임 | **내 EC2 3대(HA) 또는 1대**. `GET /api/v1/nodes`에 함께 나온다 | 노드 수·총 용량·평균 사용률이 마스터를 포함해 왜곡됨. 마스터 장애를 볼 수 없음 |
| apiserver·etcd | 보이지 않음 | `kube-system`에 **static pod 미러 파드**로 보인다 | 새 관측 대상. **기존 RBAC(pods get/list/watch)로 권한 추가 없이 볼 수 있다** |
| 노드그룹 | `eks.amazonaws.com/nodegroup` 라벨 / `eks:nodegroup-name` 태그 | **InstanceGroup**. 라벨·태그 모두 `kops.k8s.io/instancegroup` (F1·F2) | 현재 코드는 전부 미스 → 모든 노드의 `nodeGroup`이 `null`. 노드 필터·비용 노드그룹 집계·어드바이저 R-ONDEMAND가 무력화됨 |
| 컨트롤 플레인 요금 | 클러스터당 시간당 요금($0.10~, 확장 지원이면 인상) | **요금 자체가 없다.** 대신 마스터 EC2·EBS·LB 실비 | `eks` 카테고리와 `eksSupportTier` 계산이 통째로 의미를 잃음. 대신 마스터 실비가 어디에도 안 잡힘 |
| 클러스터 버전 | `eks:DescribeCluster` | AWS API에 클러스터 객체가 없다 | 버전은 **쿠버네티스 API 서버에서** 읽어야 한다 (이미 `cluster.version`으로 있음) |
| 클러스터 이름 | 짧은 이름(`prod-eks`) | 보통 **FQDN**(`prod.k8s.example.com`). `--dns=none`이면 `*.k8s.local`도 가능 | 표시 이름이 길다. 그리고 EC2 필터 태그 값으로도 쓰이므로 **정확해야 한다** |
| metrics-server | 애드온으로 흔히 설치 | **기본 설치가 아니다** (F11) | 사용량 지표가 통째로 없는 클러스터가 정상 상태로 존재한다 |
| 노드 이름 | `ip-10-0-12-34.…compute.internal` | 쿠버네티스 1.23+ / 외부 CCM이면 **`i-0abc…`(인스턴스 ID)** (F10) | 어드바이저의 "IP 형태 노드 이름 가명" 규칙이 인스턴스 ID를 그대로 흘려보낸다 |
| 인증 | `aws eks get-token` exec 플러그인 | `kops export kubeconfig --admin`이 **cluster-admin 인증서**를 심는다 | 조회 전용 원칙 위반. 대시보드는 이 kubeconfig를 쓰면 안 된다 |
| DNS | 없음 | Route53 호스팅 존 또는 `--dns=none` (F9) | Route53 비용이 있는 클러스터와 없는 클러스터가 둘 다 정상 |
| 설정의 단일 진실 | AWS 콘솔/API | **S3 state store의 Cluster·InstanceGroup YAML** | Former2(CloudFormation/Terraform)만으로는 kOps의 의도를 남길 수 없다 (8절) |

### 1.3 목표

1. 대시보드가 kOps 클러스터에서 **EKS와 같은 품질로** 동작한다(노드그룹·비용·어드바이저가 다시 맞는 값을 낸다).
2. **컨트롤 플레인을 관측 대상으로 추가**한다. "마스터가 몇 대이고 HA인가, 구성요소가 다 살아 있는가"를 5초 안에 판단할 수 있다.
3. 마스터와 워커를 **섞지 않는다**. 용량·사용률·비용 배분이 워커 기준으로 정확해진다.
4. 비용이 kOps 현실(관리 요금 없음 + 마스터 실비)을 반영한다.
5. EKS 전용 코드·설정·문구가 저장소에 남지 않는다.
6. 권한(쿠버네티스 RBAC, AWS IAM)을 **늘리지 않고** 위 1~5를 달성한다.

---

## 2. 사용자 시나리오

### S1. 마스터 1대가 죽었다
1. 개요 화면 상단 요약 띠가 "주의"로 바뀌고, **컨트롤 플레인 카드**에 "마스터 2/3 Ready · etcd 쿼럼 유지"가 보인다.
2. 카드를 누르면 컨트롤 플레인 상세: 마스터 3대 표, 그중 `i-0c3d…`가 NotReady 4분. 그 마스터의 구성요소 5종은 "알 수 없음(노드 NotReady — 마지막 보고 04:58)"으로 회색이다(kubelet이 멈추면 미러 파드 상태도 멈추기 때문).
3. 나머지 2대의 `etcd-manager-main`·`kube-apiserver`는 Ready. 판단 이유에 "3대 중 2대 정상 — 1대 더 잃으면 쿼럼 상실"이 적혀 있다.
4. 사용자는 대시보드에서 조치하지 않는다. 대시보드는 **무슨 일이 일어났는지만** 알려 준다.

### S2. 단일 컨트롤 플레인 클러스터
1. 개발용으로 마스터 1대짜리 kOps 클러스터를 만들었다.
2. 컨트롤 플레인 카드가 상시 "주의 · 마스터 1대 (HA 아님)"로 보인다.
3. 의도한 구성이므로 설정(`CONTROL_PLANE_HA_EXPECTED=false`)을 끄면 "정상 · 마스터 1대(단일 구성, 확인됨)"로 바뀌고 상태 판단에서 빠진다. 어드바이저 사전 점검에는 계속 남는다(조언은 계속 한다).

### S3. 노드그룹이 다시 보인다
1. 전환 전: 노드 목록의 "노드그룹" 열이 전부 `—`이고 필터가 비어 있다.
2. 전환 후: `control-plane-ap-northeast-2a`, `nodes-system`, `nodes-batch` 같은 **kOps InstanceGroup 이름**이 보이고, 노드 목록은 기본적으로 **워커만** 보여 준다. "컨트롤 플레인 3대 보기" 링크로 마스터 섹션에 간다.

### S4. 비용 화면이 kOps에 맞게 바뀐다
1. 카테고리에서 "EKS 컨트롤 플레인 $0.10/h"가 사라지고 **"컨트롤 플레인 ≈$0.29/h"**가 보인다.
2. 내역을 펼치면 마스터 EC2 3대(t3.medium 온디맨드), etcd 볼륨 6개(main/events × 3, gp3 20GB), API 서버 NLB 1개(추정)가 나온다.
3. "이 추정에 포함되지 않는 것" 도움말에 "Route53 호스팅 존·쿼리, kOps state store S3"가 명시돼 있다.

### S5. metrics-server가 없는 클러스터
1. 클러스터를 막 만들어 metrics-server를 켜지 않았다.
2. CPU·메모리 카드가 "알 수 없음 (metrics-server 없음)"이고, 힌트에 "클러스터에 metrics-server가 설치돼 있지 않습니다. kOps 클러스터 설정의 `spec.metricsServer.enabled`를 켜면 표시됩니다."가 보인다.
3. 노드·파드·워크로드·이벤트·DB·비용은 모두 정상 동작한다. 어드바이저의 R-OVERREQ·R-NODEIDLE만 "판단 보류"다.

---

## 3. 표시할 지표와 상태 판단 기준

`cluster-status` 3.0의 공통 규칙(4단계 상태, 집계 우선순위 `장애 > 주의 > 알 수 없음 > 정상`, 데이터 오래됨, 지속 조건, 판단 이유 한 줄)을 **그대로 따른다.** 아래는 달라지거나 새로 생기는 것만 적는다.

### 3.1 노드: 워커와 컨트롤 플레인 분리

**판별**: 노드 라벨 `node-role.kubernetes.io/control-plane`이 있으면 컨트롤 플레인, 없으면 워커 (F8).
- 과거 라벨 `node-role.kubernetes.io/master`도 **함께 인정**한다(둘 중 하나라도 있으면 컨트롤 플레인). 오래된 클러스터 대비.
- 라벨이 있는 노드가 **한 대도 없으면** 컨트롤 플레인 영역은 `알 수 없음`(`CONTROL_PLANE_NOT_FOUND`)이다. 워커 집계는 전체 노드로 계속 동작한다. (kOps에서는 있을 수 없는 상태이므로 장애가 아니라 "못 찾음"으로 본다.)

**"워커만"으로 바꿀 곳** (여기서 마스터를 뺀다)

| 위치 | 지금 | 바꿀 것 |
|---|---|---|
| 개요 `areas.nodes.ready / total` | 전체 노드 | **워커만** |
| 개요 요약 띠 "노드 수 (Ready / 전체)" | 전체 | **워커만**. 부제에 `· 컨트롤 플레인 3/3` 별도 표기 |
| `GET /api/cluster/nodes` 목록 | 전체 | 기본 **워커만**. 새 쿼리 `role=worker\|control_plane\|all`(기본 `worker`), `facets.roles` 추가 |
| `GET /api/cluster/metrics` 클러스터 합계(allocatable·usage·requests·limits) | 전체 | **워커만**. 컨트롤 플레인 합계는 별도 블록으로 분리 |
| `GET /api/cluster/metrics/series` `target=cluster` | 전체 | **워커만** |
| "노드 0개 또는 전원 NotReady → 클러스터 전체 장애" (`cluster-status` 3.2) | 전체 노드 | **워커 0대 또는 워커 전원 NotReady**. 마스터 쪽은 3.2의 기준으로 따로 판단 |
| 비용 네임스페이스 배분의 노드 비용 (`aws-cost` 3.2-1) | 전체 노드 | **워커 노드만** 배분 대상. 마스터 비용은 `공용(클러스터)` 행 |
| 어드바이저 R-NODEIDLE, R-ONDEMAND, R-GRAVITON | 전체 노드 | **워커 노드만** |
| 어드바이저 스냅샷 `cluster.nodeCount` | 전체 | `workerCount` / `controlPlaneCount`로 분리 |

**"전부"로 남길 곳**: 파드 목록, 워크로드 목록, 이벤트, PVC. 파드는 원래 네임스페이스 기준이고, 컨트롤 플레인 파드는 `kube-system`이라 기본 "시스템 숨기기" 필터로 가려진다(`cluster-status` 가정 A6). **단, 컨트롤 플레인 섹션은 시스템 필터와 무관하게 항상 보인다.**

**컨트롤 플레인을 새로 보여줄 곳**

| 위치 | 내용 |
|---|---|
| 개요 화면 영역 카드 | 카드 5개(노드·워크로드·파드·이벤트·DB) → **6개**. "컨트롤 플레인" 카드 추가. 상태 배지 + `마스터 3/3 · 구성요소 15/15` + 대표 사유 |
| 개요 `areas.controlPlane` | 새 영역. `overall`(전체 상태) 집계에 포함된다 |
| 노드 화면 | 상단에 컨트롤 플레인 섹션(마스터 표 + 구성요소 표), 아래에 기존 워커 목록 |
| 사이드바 | **컨트롤 플레인 전용 메뉴를 만들지 않는다.** `nav.nodes` 상태 = 워커 영역과 컨트롤 플레인 영역의 **최악**. (근거: 대상이 마스터 3대 + 파드 15개 수준으로 작고, 메뉴를 늘리면 `docs/design/shell.md` 개편 범위가 이번 전환에 비해 과하다) |
| "지금 확인할 항목"(`attention`) | `area`에 `control_plane` 추가 |

**사이드바 합산 규칙과 새 기능들의 관계 (2026-09-25, `alerts`·`logs`)**

- 사이드바에는 `알림`·`로그`·`설정` **3개가 늘어난다**(PM 결정, `docs/reports/alerts/README.md` Q6). 그래도 **위 결정은 그대로다**: 컨트롤 플레인 전용 메뉴는 만들지 않고, `nav.nodes`는 계속 워커 + 컨트롤 플레인의 최악이다.
- 늘어나는 세 메뉴는 **상태 점이 없다.** 알림은 상태의 **파생**이라 점을 달면 같은 정보가 두 번 보이고(`alerts` 3.3.1 — 배지 숫자만 쓴다), 로그는 **내용으로 상태를 판단하지 않는다**(`logs` 3.0). 따라서 `nav` 키와 합산 규칙에 **아무 영향이 없다.**
- **알림에서는 컨트롤 플레인을 분리한다.** 사이드바는 위처럼 `nav.nodes`에 합산하지만, 알림 키는 `area:controlPlane`과 `area:nodes`로 **나뉜다**(`alerts` 3.1 근거 7). 사이드바는 "어느 화면으로 가면 되나"이고 알림은 "무슨 일이 일어났나"라 단위가 다르다 — 마스터 장애가 워커 소음에 묻히면 안 된다. 두 규칙은 **충돌하지 않는다.**
- 알림에서 컨트롤 플레인 항목을 누르면 전용 화면이 없으므로 `/cluster/nodes#control-plane`으로 간다(`alerts` 3.3.1). 이것도 위 "전용 메뉴 없음" 결정과 같은 방향이다.

### 3.2 컨트롤 플레인 상태 판단 기준 (새 영역)

#### 3.2.1 마스터 노드

노드 자체의 지표(Ready, 압박 조건, cordon, CPU·메모리 사용률, 파드 수)는 **`cluster-status` 3.2의 기준을 그대로** 적용한다. 그 위에 컨트롤 플레인 고유 판단을 얹는다.

| 항목 | 정상 | 주의 | 장애 |
|---|---|---|---|
| 마스터 대수(HA) | 3대 이상의 **홀수** | 1대(단일 컨트롤 플레인), 또는 **짝수**(2·4대 — etcd 쿼럼상 이득이 없다) | — |
| 마스터 Ready 수 | 전부 Ready | 1대 NotReady이고 **쿼럼 유지**(예: 3대 중 2대 Ready) | **쿼럼 상실**: Ready 수 ≤ 전체의 절반 (3대 중 2대 NotReady, 1대 구성에서 1대 NotReady) |
| 마스터 가용 영역 분산 | 마스터가 2개 이상 AZ에 분산 | 마스터 2대 이상이 **모두 같은 AZ** | — |
| 마스터 cordon | 아님 | cordon 상태 (컨트롤 플레인은 원래 워크로드를 안 받지만 kubelet 문제 신호일 수 있음) | — |

- "마스터 대수 주의"는 설정 `CONTROL_PLANE_HA_EXPECTED`(기본 `true`)로 끌 수 있다. `false`면 대수 항목은 **판단하지 않고 표시만** 한다(S2). 어드바이저 사전 점검(R-CP-HA)은 설정과 무관하게 계속 지적한다.
- **쿼럼 계산은 마스터 노드 대수가 아니라 etcd 멤버 수 기준이 정확하지만**, etcd 멤버 목록은 RBAC 범위 밖이다(D3). 그래서 "마스터 노드 대수 = etcd 멤버 수"로 **근사**하고, 화면 툴팁에 "마스터 노드 수 기준 근사"라고 적는다.

#### 3.2.2 컨트롤 플레인 구성요소 (static pod 미러 파드)

**식별**(U4 대응, 2중 조건 모두 만족):
1. 파드가 **마스터 노드**(3.1 판별)에 스케줄돼 있고 네임스페이스가 `kube-system`이다.
2. 파드 이름이 다음 접두어 중 하나로 시작한다: `kube-apiserver`, `kube-controller-manager`, `kube-scheduler`, `etcd-manager-main`, `etcd-manager-events`.

- 위 5종을 **필수 구성요소**로 본다(마스터 1대당 5개 → 3대면 15개).
- 그 밖에 마스터 노드에 있는 `kube-system` 파드(예: `kops-controller`, `kops-channels`, `kube-apiserver-healthcheck`, CNI·kube-proxy DaemonSet)는 **"기타 컨트롤 플레인 구성요소"**로 목록에만 표시하고 **필수 판정에 넣지 않는다**(U5). 있어도 없어도 정상.
- 백엔드는 미러 파드 판별에 `kubernetes.io/config.mirror` 어노테이션을 **내부 판단용으로만** 쓸 수 있다. 어노테이션 원문은 API 응답·어드바이저 스냅샷에 넣지 않는다(`docs/api/common.md` 1.4, 어드바이저 3.4).

**상태 기준** (파드 단위 기준은 `cluster-status` 3.4를 재사용한다)

| 항목 | 정상 | 주의 | 장애 |
|---|---|---|---|
| 구성요소 파드 Ready | 모든 마스터에서 Ready | 한 마스터에서만 Ready 아님이 **2분 이상**이고 쿼럼·가용성이 유지됨 | 같은 종류가 **마스터 과반에서** Ready 아님. 또는 `kube-apiserver`·`etcd-manager-main`이 **모든 마스터에서** Ready 아님 |
| 대기 사유(waiting reason) | 없음 / `ContainerCreating`·`PodInitializing` 2분 미만 | 위가 2분 이상 | `CrashLoopBackOff`, `ImagePullBackOff`, `ErrImagePull`, `CreateContainerConfigError`, `CreateContainerError`, `InvalidImageName` |
| 최근 1시간 재시작 | 0회 | 1~2회 | 3회 이상 |
| 마지막 종료 사유 `OOMKilled` | 없음 | 최근 1시간 1회 이상 | (재시작 3회 이상이면 위 규칙으로 장애) |
| 마스터당 필수 구성요소 개수 | 5/5 | 4/5 (한 종류가 아예 없음) | 3/5 이하, 또는 `kube-apiserver`·`etcd-manager-main`이 없음 |

- **중요한 한계**: 마스터 노드가 NotReady면 kubelet이 미러 파드 상태를 더 이상 갱신하지 않아 **파드가 `Running`인 채로 남는다.** 따라서 마스터가 NotReady거나 Ready가 `Unknown`이면, **그 마스터의 구성요소는 상태를 `알 수 없음`으로 바꾸고**(`CONTROL_PLANE_NODE_NOT_REPORTING`) 마지막 보고 시각을 함께 보여 준다. 구성요소가 "정상"으로 보여 장애를 놓치는 일을 막는다.
- **또 하나의 한계(화면에 상시 안내)**: `kube-apiserver`가 전부 죽으면 **대시보드 자신이 클러스터를 조회할 수 없다.** 그때 화면은 컨트롤 플레인 "장애"가 아니라 `kube` 출처 stale/unavailable → "연결 끊김 · 마지막 갱신 …" 배너가 된다(`cluster-status` S4와 같은 동작). 이 사실을 컨트롤 플레인 섹션의 도움말에 적는다.
- etcd 심층 지표(fsync 지연, 리더 변경, DB 크기, 멤버 목록)는 **범위 밖**(D3). 화면에 "etcd 내부 지표는 표시하지 않습니다(Prometheus 필요)"를 한 줄 적어 사용자가 기대하지 않게 한다.
- **다만 "지표"가 없을 뿐 "로그"는 볼 수 있다 (2026-09-25, `logs`).** 위 문구가 "컨트롤 플레인을 전혀 들여다볼 수 없다"로 읽히지 않게, 구성요소 매트릭스 칸에 `로그` 링크를 둔다(`docs/specs/logs.md` 3.7, AC-LOG30~33). 구성요소는 `kube-system`의 미러 파드라 **`pods/log`의 `get` 하나**로 읽으며, D3가 막은 etcd 심층 지표(Prometheus 스크레이프 필요)와는 **다른 것이다 — 충돌하지 않는다.** `kube-apiserver` 로그는 apiserver를 통해 읽으므로 apiserver가 멈추면 그 로그도 볼 수 없다(위 "또 하나의 한계"와 같은 성격, `logs` 3.7). **AC-KOPS26의 안내 두 줄 문구는 그대로 두고**, 로그 링크는 `logs` 기능의 AC로 확인한다.

#### 3.2.3 컨트롤 플레인 영역 상태

영역 상태 = 3.2.1(마스터 노드) + 3.2.2(구성요소) 중 **최악**. 대표 사유 우선순위: 쿼럼 상실 → 구성요소 장애 → 마스터 NotReady → 재시작 → HA 아님 → AZ 편중.

### 3.3 노드그룹 = kOps InstanceGroup

| 대상 | 지금 | 바꿀 것 |
|---|---|---|
| 노드 라벨 | `eks.amazonaws.com/nodegroup` → `karpenter.sh/nodepool` → `alpha.eksctl.io/nodegroup-name` (`apps/api/src/cluster/kube/extract.ts:122-126`) | **`kops.k8s.io/instancegroup` 하나만** (F1). EKS·Karpenter 키는 전부 삭제(D1) |
| EC2 태그 | `eks:nodegroup-name` → `karpenter.sh/nodepool` → `karpenter.sh/provisioner-name` (`apps/api/src/cost/aws/aws-sdk.gateway.ts:374-378`) | **`kops.k8s.io/instancegroup` 하나만** (F2) |
| EC2 필터 태그 | `kubernetes.io/cluster/<name>` (`aws-sdk.gateway.ts:109-111`) | **그대로 둔다** (F3·D9) |
| 구매 옵션(`capacityType`) | `eks.amazonaws.com/capacityType`, `karpenter.sh/capacity-type` 라벨 | kOps는 이 라벨을 붙이지 않는다. **EC2 `InstanceLifecycle`(스팟 여부)을 1순위 근거로** 쓰고, 라벨은 `node.kubernetes.io/instance-lifecycle`(쿠버네티스 표준) 정도만 본다. 알 수 없으면 `null`(현재 estimator는 이미 인스턴스 lifecycle을 우선한다) |

- 노드그룹의 **목표 대수·최소·최대·스케일 여력은 표시하지 않는다**(D2). 화면에 "목표 대수는 표시하지 않습니다(실제로 붙어 있는 노드만 셉니다)"를 노드그룹 집계 툴팁에 적어, 값이 없는 이유를 사용자가 알게 한다.
- 노드그룹 집계는 **워커 InstanceGroup만** 대상으로 한다. 컨트롤 플레인 InstanceGroup(보통 `control-plane-<az>`)은 컨트롤 플레인 섹션에서 별도로 보여 준다.

### 3.4 metrics-server 없음

- 동작은 **이미 정의된 규칙 그대로**다(`docs/api/common.md` 2.3·2.4): `metrics` 출처 `state: 'unavailable'`, `unavailableReason.code = METRICS_API_UNAVAILABLE`, 사용량 필드 `null`, 관련 `StatusInfo.status = 'unknown'`. **mock으로 대체하지 않는다.** HTTP 오류가 아니다.
- 바뀌는 것은 **안내 문구**다.

| 위치 | 지금 | 바꿀 것 |
|---|---|---|
| 메트릭 카드 힌트 (`docs/design/cluster-status.md:107`) | `EKS 애드온 metrics-server를 설치하면 표시됩니다` | `클러스터에 metrics-server가 설치돼 있지 않습니다. kOps 클러스터 설정의 spec.metricsServer.enabled를 켜면 표시됩니다.` |
| health `checks.metrics.message` | `metrics.k8s.io API 없음 (metrics-server 미설치)` | 그대로 (플랫폼 중립) |

- **안내 문구에 실행 명령(`kops edit cluster`, `kops update cluster --yes`)을 넣지 않는다.** 조회 전용 대시보드가 클러스터 변경 명령을 제시하지 않는다는 원칙을 유지한다. 설정 항목 이름까지만 알려 준다.
- **파급 영향**(화면 도움말에 명시): metrics-server가 없으면 ① 노드·클러스터 CPU·메모리 사용률 판단이 `unknown`, ② 추이 그래프 없음, ③ 어드바이저 R-OVERREQ·R-NODEIDLE "판단 보류", ④ 컨트롤 플레인 마스터의 사용률 판단도 `unknown`. **비용은 영향 없다**(네임스페이스 배분은 requests 기반). PVC 사용률도 영향 없다(Prometheus 또는 `pg_database_size()` 근사치).

### 3.5 비용 모델 재정의

#### 3.5.1 카테고리 교체

```
지금:  'ec2' | 'ebs' | 'lb' | 'ipv4' | 'eks'        // eks = 'EKS 컨트롤 플레인'
바꿈:  'ec2' | 'ebs' | 'lb' | 'ipv4' | 'controlPlane'  // controlPlane = '컨트롤 플레인'
```

- `ec2`·`ebs`·`lb`·`ipv4`는 이제 **워커·워크로드용으로 순수해진다**(마스터 관련 리소스가 빠지므로). 그래서 "EC2 노드 $X"가 네임스페이스 배분표와 어긋나지 않는다.
- `controlPlane`은 **리소스 종류가 아니라 역할 축**이다. 내역 표에서 하위 종류를 구분해 보여 준다: `master_ec2`, `etcd_ebs`, `master_root_ebs`, `api_lb`, `master_ipv4`.
- 화면 카테고리 순서: EC2 노드 → EBS → 로드밸런서 → 퍼블릭 IPv4 → **컨트롤 플레인** (기존 순서 유지, 마지막 자리만 교체).

#### 3.5.2 계산에 **포함**하는 것

| 하위 종류 | 산정 방식 | 데이터 출처 (지금도 있는가) |
|---|---|---|
| `master_ec2` | 마스터 노드의 providerID → EC2 인스턴스 → 인스턴스 타입 × 온디맨드/스팟 단가 | **있다.** 지금은 `ec2` 카테고리에 들어감. 분류만 바꾸면 됨 |
| `etcd_ebs` | 마스터 인스턴스에 붙어 있고 PVC도 루트 볼륨도 아닌 EBS (F6: 마스터당 main/events 2개, 기본 gp3 20GB) | **있다.** 지금 `estimator.ts:233-240`에서 `attachment.type = 'other'`로 분류돼 `ebs` 카테고리에 들어감 |
| `master_root_ebs` | 마스터 인스턴스의 루트 볼륨 | **있다.** 지금 `attachment.type = 'node_root'` |
| `api_lb` | API 서버 앞단 로드밸런서 1개 × 시간당 기본 단가 (F7: 기본 NLB) | **있다**(LB 목록). 단, **식별 규칙이 새로 필요**(3.5.3) |
| `master_ipv4` | 마스터에 붙은 퍼블릭 IPv4 주소 수 × 단가 (퍼블릭 토폴로지일 때) | **있다.** 지금 `ipv4` 카테고리 |

→ 즉 **새 AWS API 호출이 하나도 늘지 않는다.** 이미 받아오는 데이터의 **분류만 바꾸는 것**이다. AWS 권한도 그대로다.

#### 3.5.3 API 서버 LB 식별 (U2)

다음을 **모두** 만족하는 로드밸런서를 `api_lb`로 본다.

1. `kubernetes.io/cluster/<K8S_CLUSTER_NAME>` 태그가 있다 (F3), **그리고**
2. 어떤 쿠버네티스 Service·Ingress에도 귀속되지 않는다(`service.k8s.aws/stack`·`kubernetes.io/service-name`·`ingress.k8s.aws/stack` 태그 없음, LoadBalancer Service의 hostname과도 안 맞음).

- 이 조건을 만족하는 LB가 **정확히 1개**면 `api_lb`로 넣고 내역에 **"API 서버 LB로 추정"** 라벨을 붙인다.
- **2개 이상**이면 전부 `controlPlane`에 넣되 "API 서버 LB 후보 N개 — 확인 필요" 경고를 붙인다(예: bastion LB가 있는 구성).
- **0개**면 `api_lb` 행이 없고, 컨트롤 플레인 내역에 "API 서버 LB를 찾지 못했습니다(내부 LB이거나 LB 없는 구성일 수 있습니다)"를 정보로 표시한다. 오류가 아니다.
- 실제 kOps NLB의 이름·태그 규칙을 백엔드가 실클러스터에서 확인하면 이 규칙을 좁히고 `docs/api/aws-cost.md`에 기록한다.

#### 3.5.4 계산에서 **제외**하는 것 (판단과 근거)

| 항목 | 결정 | 근거 |
|---|---|---|
| **Route53 호스팅 존 + 쿼리** | **제외** | ① `route53:*` 읽기 권한이 없고, 권한을 늘리지 않는 것이 이번 전환의 원칙이다. ② `--dns=none` 구성이면 존이 **아예 없다**(F9) — 있다고 가정하면 거짓 금액이 된다. ③ 금액이 존당 월 $0.50 + 쿼리 요금 수준으로, 마스터 EC2 3대(월 $70~200)의 **1% 미만**이다. 소액 항목 하나를 위해 IAM 권한을 늘리는 것은 비용 대비 손해다 |
| **kOps state store S3(설정 + etcd 백업)** | **제외** | ① `s3:*` 읽기 권한이 없다. ② state store 버킷은 **여러 클러스터가 공유**할 수 있어 이 클러스터 몫을 가르는 규칙이 자의적이다. ③ 설정 YAML은 수 MB, etcd 백업을 포함해도 용량 요금이 월 $0.1 수준이다 |
| **NAT 게이트웨이** | **제외**(기존과 같음) | `aws-cost` 3.8에서 이미 범위 밖. kOps 전환으로 달라지지 않는다 |
| **EBS 스냅샷(etcd 백업이 스냅샷으로 남는 경우)** | **제외**(기존과 같음) | `aws-cost` 3.8 그대로 |
| **컨트롤 플레인 관리 요금** | **없앤다** | kOps에는 해당 요금이 **존재하지 않는다**. `eksSupportTier`(표준/확장 지원 단가)도 함께 삭제 |

- 위 제외 항목은 **화면 "이 추정에 포함되지 않는 것" 도움말에 문구로 노출**한다(`aws-cost` 3.8 목록에 2줄 추가). 조용히 빼지 않는다.
- 전환 안내 문구(비용 화면 상단 도움말): "kOps 클러스터에는 EKS 같은 컨트롤 플레인 관리 요금이 없습니다. 대신 마스터 EC2·etcd 볼륨·API 서버 LB 실비가 '컨트롤 플레인' 항목으로 잡힙니다."

#### 3.5.5 클러스터 버전·이름

- `eks:DescribeCluster` 호출을 **삭제**한다. 클러스터 버전은 **쿠버네티스 API 서버 버전**(`cluster.version`, 이미 있음)만 쓴다. `resources.eks[].supportTier`는 응답에서 삭제.
- `K8S_CLUSTER_NAME`(구 `EKS_CLUSTER_NAME`)의 성격이 **"표시용 이름"에서 "EC2 태그 필터 값"으로 무거워진다.**
  - live 모드에서 값이 비어 있으면: 클러스터 표시 이름은 kubeconfig 컨텍스트에서 채우고, **비용 추정은 `available: false` + 사유 `CLUSTER_NAME_NOT_CONFIGURED`**로 둔다(AWS 리소스를 어느 클러스터 것인지 고를 수 없으므로). mock으로 바꾸지 않는다.
  - 값은 보통 FQDN(`prod.k8s.example.com`)이다. 화면 표시 폭 제한(디자인 `shell.md` 상단바)에 걸리므로 **가운데 말줄임 + 툴팁 전체**로 처리한다.

#### 3.5.6 배분 규칙 변경 (`aws-cost` 3.2)

- 규칙 6 "EKS 컨트롤 플레인, 노드 루트 볼륨, 노드 퍼블릭 IPv4 → 공용(클러스터)" → **"컨트롤 플레인 전체(마스터 EC2·etcd/루트 EBS·API LB·마스터 퍼블릭 IPv4), 워커 루트 볼륨, 워커 퍼블릭 IPv4 → 공용(클러스터)"**.
- 규칙 1의 노드 비용 배분 대상은 **워커 노드만**. 마스터 위의 파드(컨트롤 플레인 static pod)에는 비용을 배분하지 않는다.
- 배분 합계 = 추정 소모율 합계라는 수용 기준(`aws-cost` 5절)은 그대로 유지돼야 한다.

### 3.6 인증 경로

#### 3.6.1 원칙

- 대시보드가 쿠버네티스 API에 쓰는 자격 증명은 **`deploy/rbac.yaml`의 ServiceAccount `sentinel-api` 토큰뿐**이다(D7).
- `kops export kubeconfig --admin`으로 만든 kubeconfig는 **cluster-admin 인증서**를 담는다. 그것을 대시보드에 마운트하면 "조회 전용"이 코드 규율로만 지켜지고 **권한으로는 전혀 막히지 않는다.** 그래서 쓰지 않는다. `.env.example`·README·docker-compose 주석에 **"admin kubeconfig를 마운트하지 말 것"**을 명시한다.

#### 3.6.2 클러스터 안에 배포할 때 (`deploy/app.example.yaml`)

- `serviceAccountName: sentinel-api` + `automountServiceAccountToken: true` → in-cluster 설정으로 접속. kubeconfig가 필요 없다. **지금 그대로 동작한다.**
- 바꿀 것: `EKS_CLUSTER_NAME: prod-eks` → `K8S_CLUSTER_NAME: <kOps 클러스터 이름(FQDN)>`, `deploy/rbac.yaml`의 EKS IRSA 주석 삭제(kOps에서 AWS 권한을 주는 방법은 U8로 남긴다).

#### 3.6.3 클러스터 밖(로컬 docker compose / Docker 없이 실행)에서 돌릴 때 — 기본 경로

운영 기본은 로컬 실행이므로(`cluster-status` 가정 A5) 이쪽이 중요하다.

1. 사람이 **한 번** 대시보드 전용 kubeconfig를 만든다. 내용은 ① API 서버 주소(kOps는 보통 `https://api.<클러스터 이름>`), ② 클러스터 CA 인증서, ③ **`sentinel-api` ServiceAccount 토큰**뿐이다. 클라이언트 인증서를 넣지 않는다.
2. 그 파일을 `~/.kube/sentinel.config` 같은 별도 경로에 두고 `KUBECONFIG_HOST_PATH`로 **읽기 전용 마운트**한다(현재 구조 그대로).
3. 대시보드는 그 kubeconfig를 **읽기만** 한다. 토큰을 스스로 발급하지 않고(그러려면 TokenRequest `create` 권한이 필요하다), 갱신하지 않는다.

- **토큰 만료 시 동작**: 쿠버네티스 조회가 401/403으로 실패하면 `kube` 출처를 `unavailable`로 두고 사유를 `KUBE_AUTH_FAILED`("인증 실패 — 토큰이 만료됐을 수 있습니다")로 표시한다. **mock으로 바꾸지 않는다**(`docs/api/common.md` 2.4). API 프로세스는 죽지 않는다.
- 토큰 발급·갱신 절차(수명이 짧은 `kubectl create token`을 쓸지, 장기 토큰 Secret을 쓸지)는 **사람의 운영 절차**이므로 백엔드가 README에 적는다. 대시보드는 secrets를 읽지 않으므로(RBAC 제외 항목) 사람이 `kubectl`로 꺼낸다.
- **검증 가능한 형태로**: 대시보드가 쓰는 kubeconfig로 `kubectl auth can-i --list`를 돌렸을 때 쓰기 동사(create/update/patch/delete)와 `secrets`가 **없어야 한다**(AC-KOPS33).
- API 서버 주소가 로컬에서 해석·접속되지 않는 경우(`--dns=none`, 내부 LB, VPN 필요)는 **운영 환경 문제**로 보고 문서로만 안내한다. 대시보드는 연결 실패를 `not_configured`가 아니라 `unavailable`로 정확히 구분해 표시한다.

### 3.7 어드바이저 규칙 정리

#### 3.7.1 삭제

| 규칙 | 처리 | 이유 |
|---|---|---|
| **R-EKSVER** ("EKS 버전이 확장 지원 구간") | **삭제** | kOps에는 확장 지원 단가가 없다. 남기면 **항상 오탐**이다. `apps/api/src/advisor/precheck/precheck-rules.ts:123-126`, `:897`, `docs/api/architecture-advisor.md:355`의 `cost` 카테고리 목록에서 제거 |
| `eksSupportTier()` (`apps/api/src/cost/estimate/eks-support.ts`) | **삭제** | 같은 이유. 같은 파일의 `gravitonEquivalent`·`smallerSize`·`splitInstanceType`은 **유지**(R-GRAVITON이 쓴다) → 파일 이름을 `instance-types.ts` 같은 중립적인 이름으로 바꾼다 |

#### 3.7.2 kOps에서 새로 의미가 생기는 규칙 후보

| ID | 카테고리 | 규칙 | 심각도 | 권고 단계 | 판단 근거 (RBAC 추가 없음) |
|---|---|---|---|---|---|
| **R-CP-HA** | 안정성 | 마스터가 1대뿐(단일 컨트롤 플레인) — 마스터 장애 = 클러스터 정지 | 높음 | **1단계** | 마스터 노드 수 |
| **R-CP-SPOT** | 안정성·비용 | 마스터가 **스팟 인스턴스**다 — 회수되면 etcd 멤버가 사라진다 | 높음 | **1단계** | 마스터 노드 ↔ EC2 `InstanceLifecycle` |
| **R-CP-RESTART** | 안정성 | 컨트롤 플레인 구성요소가 최근 24시간 **5회 이상 재시작** | 높음 | **1단계** | 미러 파드 재시작 수. 기존 R-RESTART는 시스템 네임스페이스를 제외하므로 이 규칙이 따로 필요하다 |
| **R-CP-EVEN** | 안정성 | 마스터 대수가 **짝수**(2·4대) — etcd 쿼럼상 이득 없이 비용만 는다 | 중간 | 2단계 | 마스터 노드 수 |
| **R-CP-AZ** | 안정성 | 마스터가 **모두 같은 AZ** — AZ 장애 시 클러스터 정지 | 중간 | 2단계 | 마스터 노드 `topology.kubernetes.io/zone` |
| **R-CP-UNDERSIZE** | 안정성·성능 | 마스터 CPU 또는 메모리 **관측 평균 사용률 80% 이상**(최소 1시간 관측) | 중간 | 2단계 | metrics-server 필요 → 없으면 "판단 보류" |
| **R-ETCD-VOL** | 비용·성능 | etcd 볼륨이 gp2다 (kOps 기본은 gp3 — F6) | 낮음 | **1단계에 흡수** | **새 규칙을 만들지 않는다.** 기존 **R-GP2**의 대상에 etcd 볼륨이 자동으로 포함되므로, 대상 표시에 "etcd 볼륨"임을 드러내고 "etcd는 IOPS 민감 — 전환 시 성능 확인 필요" 주석만 붙인다 |
| 마스터 **과대** 스펙 | — | 규칙으로 만들지 않는다 | — | — | 적정 마스터 크기는 노드·객체 수에 따라 달라 결정적 기준을 세울 수 없다. **LLM 분석에 맡긴다**(스냅샷에 마스터 타입·사용률을 담아 준다) |

#### 3.7.3 스냅샷·프롬프트 변경

| 대상 | 지금 | 바꿀 것 |
|---|---|---|
| `snapshot.types.ts:198` | `platform: 'eks'` | `platform: 'kops'` |
| `snapshot.types.ts:144` 비용 카테고리 | `'ec2' \| 'ebs' \| 'lb' \| 'ipv4' \| 'eks'` | `… \| 'controlPlane'` |
| 어드바이저 명세 3.3 "클러스터" 영역 | `EKS 버전, 리전, 노드 수, 지원 구간(표준/확장)` | `쿠버네티스 버전, 리전, 워커 수, 마스터 수·인스턴스 타입·AZ 분포·구매 옵션, 컨트롤 플레인 구성요소 상태 요약(종류별 Ready 수·최근 24시간 재시작 수)` |
| 어드바이저 명세 3.3 "노드" 영역 | 노드 목록 | 각 노드에 **`role: 'worker' \| 'control_plane'`** 추가. 노드그룹 이름은 kOps InstanceGroup 이름을 **원문 그대로** (`CLAUDE.md` 규칙) |
| 브리지 시스템 프롬프트 (`apps/agent-bridge/prompts/architecture-advisor.md`, `docs/api/architecture-advisor.md:1066`) | "EKS·비용 어드바이저" | "kOps·비용 어드바이저". "확장 지원 단가" 관련 문구 삭제. **"컨트롤 플레인은 사용자 소유 EC2다"**를 배경으로 추가 |
| 노드 이름 가명 규칙 (`docs/api/architecture-advisor.md:1084`, 어드바이저 명세 3.4) | "노드 이름이 IP 형태면 가명 처리" | **"노드 이름이 IP 형태(`ip-10-…`) 또는 EC2 인스턴스 ID 형태(`i-0…`)면 가명 처리"** (F10). 명세 3.4는 인스턴스 ID를 이미 "항상 제외"로 정하고 있으므로, 노드 이름이 인스턴스 ID가 되는 kOps에서는 **반드시** 가명이어야 한다 |

---

## 4. 갱신 주기

기존 주기를 바꾸지 않는다. 새 대상만 추가한다.

| 대상 | 방식 | 화면 반영 |
|---|---|---|
| 마스터 노드, 컨트롤 플레인 구성요소(미러 파드) | **기존 nodes·pods Watch(informer)를 그대로 쓴다.** 새 informer·새 주기 조회를 만들지 않는다 | 변화 후 **3초 이내** |
| 컨트롤 플레인 영역 상태 재평가(지속 조건: NotReady 60초, 대기 2분 등) | 기존 15초 재평가 루프에 얹는다 | 15초 |
| 마스터 사용량(CPU·메모리) | 기존 metrics 15초 조회 (metrics-server 없으면 `unknown`) | 15초 |
| 비용 `controlPlane` 카테고리 | 기존 5분 AWS 리소스 조회 + 쿠버네티스 변경 시 즉시 재계산. **새 AWS 호출 없음** | 최대 5분 |
| 컨트롤 플레인 구성요소 추이 그래프 | **만들지 않는다**(2단계) | — |

- SSE: `cluster` 토픽에 `cluster.controlplane.updated` 이벤트를 추가한다(단일 객체 전체 교체). 새 토픽을 만들지 않는다. `overview` 토픽의 `areas.controlPlane`은 기존 `overview.updated`로 나간다.
- AWS 호출 수·Cost Explorer 호출 수는 **전혀 늘지 않는다**(`eks:DescribeCluster`가 빠지므로 오히려 5분마다 1회 줄어든다).

---

## 5. 단계 구분과 수용 기준

한 번에 하지 않는다. **P1~P5가 이번 범위**, P6는 다음 범위다. P1은 다른 단계의 전제이므로 먼저 끝내고, P2~P5는 P1 이후 병렬로 갈 수 있다.

| 단계 | 이름 | 내용 | AC |
|---|---|---|---|
| **P1** | EKS 제거 + 식별자 교체 | EKS 코드·의존성·설정 이름 제거, 노드그룹 라벨·태그 교체, 노드 `role` 필드 추가 | AC-KOPS01~09 |
| **P2** | 컨트롤 플레인 분리 집계 | 워커/마스터 분리, 개요 카드·노드 화면·메트릭 합계 | AC-KOPS10~17 |
| **P3** | 컨트롤 플레인 상태 | static pod 상태·HA·쿼럼 판단, mock 시나리오 | AC-KOPS18~26 |
| **P4** | 비용 모델 | `controlPlane` 카테고리, 배분, 도움말 문구 | AC-KOPS27~35 |
| **P5** | 인증·metrics-server·어드바이저 | kubeconfig 경로, 안내 문구, 규칙 정리, 문서 정리 | AC-KOPS36~46 |
| **P6** | (다음 범위) | `deploy/kops-snapshot/`, 컨트롤 플레인 추이 그래프, R-CP-EVEN·R-CP-AZ·R-CP-UNDERSIZE, etcd 심층 지표 | — |

### P1. EKS 제거 + 식별자 교체

- [ ] **AC-KOPS01.** 저장소 전체에서 `eks`·`EKS` 검색 결과에 **동작하는 코드 경로가 남아 있지 않다**. 남는 것은 변경 이력·보고서의 과거 기록뿐이다. `@aws-sdk/client-eks` 의존성과 `describeEksCluster`, `eksSupportTier`가 삭제돼 있다.
- [ ] **AC-KOPS02.** `PLATFORM` 같은 플랫폼 분기 설정·환경 변수·조건문이 **어디에도 없다**(D1).
- [ ] **AC-KOPS03.** 노드그룹 판정의 근거는 **라벨 키 `kops.k8s.io/instancegroup` 하나뿐**이고, 라벨 **값(이름)은 그대로 통과**시킨다. Given 노드에 라벨 `kops.k8s.io/instancegroup=<이름>` / Then 노드 목록·상세·필터 facet에 그 값이 노드그룹으로 보인다(mock 기준 확인 값: 워커 `nodes-system`·`nodes-batch`·`nodes-app-arm64`, 마스터 `control-plane-ap-northeast-2a|2b|2c`. **이름은 mock 예시일 뿐이고 판정 대상은 라벨 키다** — mock 이름이 바뀌면 이 괄호만 바꾼다). Given EKS·Karpenter 라벨만 있는 노드 / Then 노드그룹은 `null`이다(하위 호환을 두지 않는다).
- [ ] **AC-KOPS04.** Given EC2 인스턴스 태그 `kops.k8s.io/instancegroup` / Then 비용 내역의 노드그룹 귀속이 그 값으로 이뤄진다.
- [ ] **AC-KOPS05.** EC2 조회 필터가 `kubernetes.io/cluster/<K8S_CLUSTER_NAME>` 태그 그대로이고, kOps 클러스터에서 마스터·워커 인스턴스가 모두 조회된다.
- [ ] **AC-KOPS06.** `EKS_CLUSTER_NAME`이 **`K8S_CLUSTER_NAME`으로 바뀌어** `.env.example`, `docker-compose.yml`, `deploy/app.example.yaml`, `env.validation.ts`, 문서에 일관되게 쓰인다. 구 이름을 읽는 하위 호환 코드를 두지 않는다(D1).
- [ ] **AC-KOPS07.** `NodeItem`에 `role: 'worker' | 'control_plane'`이 있고, 라벨 `node-role.kubernetes.io/control-plane` 또는 `node-role.kubernetes.io/master`가 있으면 `control_plane`이다.
- [ ] **AC-KOPS08.** 클러스터 버전이 **쿠버네티스 API 서버 버전**에서만 온다. AWS `eks:DescribeCluster` 호출이 0회이고, `resources.eks[].supportTier`가 응답에서 사라졌다.
- [ ] **AC-KOPS09.** `SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch`(EKS 관측 애드온)가 빠지고 `kube-system,kube-public,kube-node-lease`가 된다. 설정으로 다시 추가할 수 있다.

### P2. 컨트롤 플레인 분리 집계

- [ ] **AC-KOPS10.** Given 마스터 3대 + 워커 6대 / Then 개요 요약 띠의 노드 수는 **`6/6`(워커)**이고, 부제에 `컨트롤 플레인 3/3`이 따로 보인다. 9대로 합산되지 않는다.
- [ ] **AC-KOPS11.** `GET /api/cluster/nodes`가 기본으로 **워커만** 준다. `role=control_plane`이면 마스터만, `role=all`이면 전부. `counts`·`facets`·`total`이 필터와 일관된다.
- [ ] **AC-KOPS12.** `GET /api/cluster/metrics`의 클러스터 합계(allocatable·usage·requests·limits)가 **워커만** 합산한 값이고, 마스터 합계는 별도 블록으로 나온다. 마스터를 포함했을 때보다 사용률(%)이 달라지는 것을 mock에서 확인할 수 있다.
- [ ] **AC-KOPS13.** `GET /api/cluster/metrics/series` `target=cluster`가 **워커 기준**이다.
- [ ] **AC-KOPS14.** Given 워커 0대(마스터만 있는 클러스터) / Then 클러스터 전체 장애 + 사유 "워커 노드 없음". 마스터가 정상이어도 이 판단은 유지된다.
- [ ] **AC-KOPS15.** 네임스페이스별 비용 배분에서 **마스터 노드 비용이 파드에 배분되지 않고** `공용(클러스터)` 행에 들어간다. 배분 합계 = 추정 소모율 합계(오차 $0.01 이내)가 그대로 성립한다.
- [ ] **AC-KOPS16.** 어드바이저 R-NODEIDLE·R-ONDEMAND·R-GRAVITON이 **워커 노드만** 대상으로 한다(마스터가 유휴하다고 지적하지 않는다).
- [ ] **AC-KOPS17.** Given `node-role.kubernetes.io/control-plane` 라벨 노드가 0대 / Then 컨트롤 플레인 영역이 `알 수 없음`(`CONTROL_PLANE_NOT_FOUND`)이고, 워커 집계와 나머지 화면은 정상 동작한다.

### P3. 컨트롤 플레인 상태

- [ ] **AC-KOPS18.** 개요 화면에 **컨트롤 플레인 카드**가 있고 `마스터 3/3 · 구성요소 15/15` 형태의 숫자와 상태 배지, 판단 이유 한 줄이 보인다. `overall`(전체 상태) 집계에 포함된다.
- [ ] **AC-KOPS19.** 컨트롤 플레인 상세에 마스터 3대와 구성요소 5종(`kube-apiserver`, `kube-controller-manager`, `kube-scheduler`, `etcd-manager-main`, `etcd-manager-events`)이 마스터별로 보인다. "시스템 숨기기" 필터를 켜도 이 섹션은 보인다.
- [ ] **AC-KOPS20.** Given 마스터 3대 중 1대 NotReady / Then 컨트롤 플레인 **주의**, 사유 "마스터 2/3 Ready · 1대 더 잃으면 쿼럼 상실". Given 2대 NotReady / Then **장애**(쿼럼 상실).
- [ ] **AC-KOPS21.** Given 마스터가 NotReady / Then **그 마스터의 구성요소 5종은 `알 수 없음`**이고 마지막 보고 시각이 함께 보인다(파드가 `Running`으로 남아 있어도 정상으로 표시되지 않는다).
- [ ] **AC-KOPS22.** Given `kube-scheduler`가 한 마스터에서 최근 1시간 4회 재시작 / Then 그 구성요소 **장애**, 컨트롤 플레인 영역 장애. 1회면 주의.
- [ ] **AC-KOPS23.** Given 마스터 1대 구성 + `CONTROL_PLANE_HA_EXPECTED=true`(기본) / Then **주의** "마스터 1대 (HA 아님)". `false`면 정상이고 표시만 남는다. 어드바이저 R-CP-HA는 두 경우 모두 지적한다.
- [ ] **AC-KOPS24.** Given 마스터 2대(짝수) / Then 주의. Given 마스터 3대가 모두 같은 AZ / Then 주의.
- [ ] **AC-KOPS25.** mock 모드에서 컨트롤 플레인의 **정상 / 주의 / 장애 / 알 수 없음**을 시나리오 전환으로 모두 재현할 수 있다(`cp-healthy`, `cp-single`, `cp-node-down`, `cp-quorum-lost`, `cp-component-crash`, `cp-not-found`).
- [ ] **AC-KOPS26.** 컨트롤 플레인 섹션에 한계 안내 두 줄이 보인다: ① "apiserver가 모두 중단되면 이 대시보드도 클러스터를 조회할 수 없어 '연결 끊김'으로 보입니다.", ② "etcd 내부 지표(fsync·리더 변경)는 표시하지 않습니다." RBAC에 새 리소스·동사가 추가되지 않았다.

### P4. 비용 모델

- [ ] **AC-KOPS27.** 비용 카테고리에 `eks`가 없고 **`controlPlane`("컨트롤 플레인")**이 있다. 카테고리 순서는 EC2 노드 → EBS → 로드밸런서 → 퍼블릭 IPv4 → 컨트롤 플레인이다.
- [ ] **AC-KOPS28.** `controlPlane` 내역에 하위 종류(`master_ec2`, `etcd_ebs`, `master_root_ebs`, `api_lb`, `master_ipv4`)가 구분돼 보이고, 마스터 3대 구성에서 etcd 볼륨이 **6개**(main/events × 3) 잡힌다.
- [ ] **AC-KOPS29.** 마스터 EC2·마스터 EBS·마스터 퍼블릭 IPv4가 `ec2`·`ebs`·`ipv4` 카테고리에 **중복으로 잡히지 않는다**. 카테고리 합계 = 전체 추정 소모율.
- [ ] **AC-KOPS30.** Given 클러스터 태그가 있고 Service·Ingress에 귀속되지 않는 LB가 1개 / Then `api_lb`로 "API 서버 LB로 추정" 라벨과 함께 표시된다. 2개 이상이면 경고, 0개면 정보 문구가 보이고 **오류가 아니다**.
- [ ] **AC-KOPS31.** "이 추정에 포함되지 않는 것" 도움말에 **Route53 호스팅 존·쿼리**와 **kOps state store S3**가 명시돼 있다.
- [ ] **AC-KOPS32.** AWS 호출 목록에 `eks:*`가 없다. 호출은 `pricing:GetProducts`, `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `ec2:DescribeSpotPriceHistory`, `elasticloadbalancing:Describe*`뿐이고 `autoscaling:*`도 없다(D2).
- [ ] **AC-KOPS33.** Given live 모드 + `K8S_CLUSTER_NAME` 비어 있음 / Then 비용 추정이 `available: false` + `CLUSTER_NAME_NOT_CONFIGURED`이고, 클러스터 이름은 kubeconfig 컨텍스트로 채워지며, **mock 값이 섞이지 않는다**.
- [ ] **AC-KOPS34.** 대시보드 자체 DB의 소모율 기록에서 `eks_usd_per_hour` 열이 **`control_plane_usd_per_hour`로 마이그레이션**됐고, 기존 행이 사라지지 않는다(급증 판단의 7일 기준선이 끊기지 않는다). 마이그레이션 방식은 DBA가 정한다.
- [ ] **AC-KOPS35.** 비용 화면 상단 도움말에 "kOps에는 컨트롤 플레인 관리 요금이 없고 마스터 EC2·etcd 볼륨·API LB 실비가 대신 잡힌다"는 설명이 있다.

### P5. 인증 · metrics-server · 어드바이저 · 문서

- [ ] **AC-KOPS36.** `.env.example`·`docker-compose.yml`·README·`deploy/` 문서에 **"admin kubeconfig(`kops export kubeconfig --admin`)를 마운트하지 말 것"**이 명시돼 있고, 대시보드용 kubeconfig 구성 절차(ServiceAccount 토큰 기반)가 적혀 있다.
- [ ] **AC-KOPS37.** 대시보드가 쓰는 kubeconfig로 `kubectl auth can-i --list`를 실행하면 create/update/patch/delete와 `secrets`가 **없다**.
- [ ] **AC-KOPS38.** Given 토큰 만료로 쿠버네티스 조회가 401 / Then `kube` 출처가 `unavailable` + `KUBE_AUTH_FAILED`이고, API가 죽지 않으며, **mock 데이터로 대체되지 않는다**.
- [ ] **AC-KOPS39.** Given metrics-server 없음 / Then CPU·메모리 영역만 `unknown`이고 힌트 문구가 **kOps 기준 문구**(`spec.metricsServer.enabled`)다. 나머지 화면(노드·파드·워크로드·이벤트·DB·비용·배분)은 정상 동작한다. 안내 문구에 **클러스터 변경 명령이 없다**.
- [ ] **AC-KOPS40.** Given metrics-server 없음 / Then 어드바이저 R-OVERREQ·R-NODEIDLE·(2단계 R-CP-UNDERSIZE)이 "판단 보류"이고 나머지 규칙은 정상 동작한다.
- [ ] **AC-KOPS41.** 사전 점검 목록에 **R-EKSVER가 없다.** R-CP-HA, R-CP-SPOT, R-CP-RESTART가 있고 각각 대상·근거 수치가 붙는다.
- [ ] **AC-KOPS42.** R-GP2 결과에서 etcd 볼륨이 대상에 포함될 때 "etcd 볼륨" 표시와 "IOPS 민감 — 전환 시 성능 확인 필요" 주석이 붙는다.
- [ ] **AC-KOPS43.** 어드바이저 스냅샷의 `platform`이 `kops`이고, 노드마다 `role`이 있으며, 클러스터 영역에 마스터 수·타입·AZ 분포와 컨트롤 플레인 구성요소 요약이 들어간다. 노드그룹 이름은 원문 그대로다.
- [ ] **AC-KOPS44.** 어드바이저 스냅샷에 **EC2 인스턴스 ID 형태의 노드 이름(`i-0…`)이 원문으로 나가지 않는다**(가명 처리). 기존 IP 형태 규칙도 유지된다.
- [ ] **AC-KOPS45.** 브리지 시스템 프롬프트에 EKS·확장 지원 문구가 없고, 컨트롤 플레인이 사용자 소유 EC2라는 배경이 들어 있다.
- [ ] **AC-KOPS46.** 10절 "마이그레이션 영향 범위"의 문서·픽스처 항목이 모두 처리됐고, mock 클러스터가 kOps처럼 보인다(마스터 3대 존재, 노드 이름·kubelet 버전·클러스터 이름이 kOps 형태, 노드그룹 이름이 InstanceGroup 형태).

---

## 6. 범위 밖

- **모든 조작**: `kops update cluster`, `kops rolling-update`, `kops edit`, 마스터 재시작·교체, etcd 백업/복원 실행, metrics-server 설치 — 전부 하지 않는다. 명령을 대신 실행해 주는 기능도 만들지 않는다(조회 전용).
- **etcd 심층 지표**: fsync 지연, 리더 변경 횟수, DB 크기, 멤버 목록, apiserver 응답 지연·요청률 (Prometheus 스크레이프 필요, D3).
- **노드그룹 목표 대수·스케일 여력**: `autoscaling:DescribeAutoScalingGroups`를 추가하지 않으므로 desired/min/max와 "스케일 여력"을 표시하지 않는다(D2).
- **kOps state store(S3) 읽기**: 대시보드는 S3를 조회하지 않는다. Cluster·InstanceGroup 스펙을 대시보드가 직접 읽는 기능은 이번에도 다음에도 만들지 않는다(사람용 CLI가 파일로 떨어뜨린 것만 읽는다 — 8절).
- **`deploy/kops-snapshot/` CLI와 스냅샷 메뉴 kOps 탭**: 필요하다고 판단하지만 **다음 범위**(8절).
- **Route53·S3 비용 계산**(3.5.4), NAT·데이터 전송비(기존과 같음).
- **컨트롤 플레인 구성요소의 추이 그래프**, `metrics/series` `target=control_plane` (2단계).
- **마스터에 워크로드를 올리는 구성**(taint를 뺀 단일 노드 클러스터 등)의 정밀한 배분·용량 계산 → Q6.
- **다중 클러스터**, EKS와의 동시 지원, 다른 프로비저너(kubeadm·k3s·Karpenter) 지원.
- **kOps 버전 업그레이드 조언**(쿠버네티스 EOL 판단): EKS 지원 등급 대신 쿠버네티스 커뮤니티 EOL로 규칙을 만들 수 있지만 이번 범위에 넣지 않는다 → Q7.

---

## 7. 역할별 전달 사항

### 디자인

1. **컨트롤 플레인 카드(개요 6번째 카드)**: 기존 5카드 배치를 6개로 늘리는 방식(2×3 또는 폭 조정)을 정한다. 카드 내용은 상태 배지 + `마스터 3/3 · 구성요소 15/15` + 대표 사유 1줄.
2. **컨트롤 플레인 상세 섹션**(노드 화면 상단): 마스터 표(이름·인스턴스 타입·AZ·구매 옵션·Ready·사용률)와 구성요소 표(마스터 × 5종 매트릭스 형태 권장 — 3×5 그리드에서 어느 칸이 빨간지가 한눈에 보이게).
3. **"알 수 없음(노드 미보고)"**의 시각 표현: 구성요소가 회색이 되는 경우가 "데이터 오래됨"과 다르다는 것을 구분해 보여 준다.
4. **노드 화면의 워커/컨트롤 플레인 분리**: 목록이 기본 워커만이라는 사실과 "컨트롤 플레인 N대 보기" 동선.
5. **긴 클러스터 이름(FQDN)** 처리: 상단바(`shell.md:44` `prod-eks · v1.30 · ap-northeast-2`)에서 `prod.k8s.example.com`처럼 긴 이름의 가운데 말줄임 + 툴팁.
6. **문구 교체**: metrics-server 힌트(`cluster-status.md:107`), 비용 카테고리 라벨·도움말(`aws-cost.md:103,122,144,151,234`), 비용 표 정렬 순서(`status.md:337`), 컨트롤 플레인 한계 안내 2줄.
7. 새 상태 색·배지 체계를 만들지 않는다. 기존 4단계 + stale을 그대로 쓴다.

### 퍼블리싱

- 새 컴포넌트는 **최소한**으로: 구성요소 매트릭스(마스터 × 구성요소) 한 개면 충분하다. 상태 배지·상태 카드·사용률 막대·표는 기존 것을 재사용한다.
- 비용 카테고리 라벨 상수(`CATEGORY_LABEL`)에서 `eks` → `controlPlane` 교체.

### 프론트

- `NodeItem.role` 반영, 노드 목록 `role` 쿼리(기본 `worker`)와 컨트롤 플레인 섹션.
- 개요 `areas.controlPlane` 카드, `attention`의 `area: 'control_plane'` 처리.
- `cluster.controlplane.updated` SSE 이벤트 구독(새 토픽 없음).
- `CostCategory` 타입·순서·라벨·툴팁 교체(`apps/web/src/features/aws-cost/{types.ts,CostTables.tsx,help.tsx}`), `shared_cluster` 설명 문구 교체.
- 픽스처(`apps/web/src/features/__fixtures__/fixtures.ts`)를 kOps 형태로 교체(마스터 3대 포함).
- **상태 계산을 화면에서 하지 않는다**는 기존 원칙 유지. 쿼럼·HA 판단은 전부 서버 값이다.

### 백엔드

- P1~P5 전부. 특히:
  - `extract.ts`의 노드그룹 라벨 교체 + `role` 추출, `aws-sdk.gateway.ts`의 노드그룹 태그 교체.
  - `estimator.ts`의 분류 로직: 마스터 노드 ↔ 인스턴스 ↔ 볼륨 ↔ LB를 `controlPlane`으로 옮긴다. **AWS 호출을 늘리지 않는다.**
  - `describeEksCluster`·`eksSupportTier` 삭제, `@aws-sdk/client-eks` 제거, `eks-support.ts` 파일 이름 변경(남는 함수 유지).
  - `K8S_CLUSTER_NAME` 이름 변경과 live 모드 미설정 시 동작(3.5.5).
  - 컨트롤 플레인 상태 판단(3.2 전부)을 **서버에서** 계산하고 판단 이유를 붙인다. 지속 조건·쿼럼 근사 규칙을 한곳에 모아 설정으로 바꿀 수 있게 한다(`CONTROL_PLANE_HA_EXPECTED` 포함).
  - mock: 마스터 3대 + 구성요소 15개를 기본 세계에 넣고, AC-KOPS25의 시나리오 6개를 만든다. mock 노드 이름·kubelet 버전·클러스터 이름·노드그룹 이름을 kOps 형태로 바꾼다.
  - `docs/api/cluster-status.md`·`docs/api/aws-cost.md`·`docs/api/architecture-advisor.md`·`docs/api/common.md` 갱신(10절 표).
  - RBAC(`deploy/rbac.yaml`)는 **바꾸지 않는다.** 단 EKS IRSA 주석은 지우고 kOps에서의 AWS 권한 부여 방법은 "확인 필요"로 남긴다.
  - 대시보드용 kubeconfig 구성 절차를 README에 적는다(3.6.3). **admin kubeconfig 금지 경고 포함.**
- 백엔드가 실클러스터에서 **확인해 문서에 기록할 것**: U2(API LB 태그·이름), U4(미러 파드 이름 규칙), U5(추가 static pod 목록), U8(AWS 권한 부여 방법).

### DBA

- `cost_rate_samples.eks_usd_per_hour` → **`control_plane_usd_per_hour`** 마이그레이션(`apps/api/prisma/schema.prisma:58`, `docs/db/schema.md:57`). 기존 행을 지우지 않는다(급증 판단의 7일/90일 기준선이 끊기면 안 된다).
- 모니터링 대상 Postgres 쪽은 **변화 없다**(클러스터 안 StatefulSet 그대로). 모니터링 계정·쿼리·`docs/db/health.md`는 손대지 않는다.
- `docs/db/schema.md:35` "환경: EKS + 클러스터 안의 Postgres" 문구 교체.

---

## 8. `deploy/kops-snapshot/` 필요성 판단

### 8.1 지금 도구로는 왜 안 되는가

- `deploy/aws-snapshot/`(Former2)는 **AWS에 실제로 존재하는 리소스**를 CloudFormation/Terraform으로 뽑는다. 결과에는 ASG, Launch Template, EC2, EBS, NLB, Route53 레코드가 나온다.
- 그런데 kOps에서 그 리소스들은 **결과물**이고, 단일 진실은 S3 state store의 **`Cluster` / `InstanceGroup` 객체**다. 거기에는 Former2가 표현할 수 없는 것이 들어 있다: `etcdClusters`(main/events 볼륨 타입·크기·암호화), `networking`(CNI 선택), `kubelet`/`kubeAPIServer` 플래그, `nodeLabels`/`taints`, `additionalPolicies`, `rollingUpdate` 설정, InstanceGroup의 `machineType`/`minSize`/`maxSize`/`rootVolume`/`mixedInstancesPolicy`.
- 즉 **Former2 템플릿만 가지고는 같은 kOps 클러스터를 되살릴 수 없다.** `deploy/k8s-snapshot/`(클러스터 안 매니페스트)도 이 층을 덮지 못한다. 세 번째 층이 비어 있다.

### 8.2 판단: **필요하다.** 다만 **다음 범위로 미룬다.**

**필요한 이유**
1. 복원 가능성: kOps 클러스터의 "설계도"를 기록하는 유일한 방법이다.
2. 이번 기능의 판단 근거(마스터 대수, 인스턴스 타입, etcd 볼륨 설정)가 거기 있고, 스냅샷으로 남기면 "언제 바뀌었나"를 볼 수 있다.
3. `deploy/k8s-snapshot/`의 규칙(사람용 독립 CLI, 읽기 전용, `metadata.json`/`schemaVersion`, 비밀값 스캐너, `--dry-run`, 종료코드, 대시보드는 로컬 파일만 읽고 관리)을 **거의 그대로 재사용**할 수 있다. 설계 비용이 낮다.

**이번 범위에 넣지 않는 이유**
1. 이번 전환의 필수 목표는 "대시보드가 kOps에서 올바르게 동작하는 것"이고, 스냅샷 CLI 없이도 P1~P5로 달성된다.
2. 새 CLI + 스냅샷 메뉴 3번째 탭 + mock 예시 + 3D 구성도 파급까지 가면 `k8s-snapshot` 한 기능 규모다. 이번 전환의 검증(수용 기준 46개)과 섞으면 어느 쪽도 제대로 끝나지 않는다.
3. `kops get cluster -o yaml` 출력의 비밀값 포함 여부(U6)를 아직 확인하지 못했다. **확인 전에 설계를 확정하면 안 된다.**

**이번 범위에서 해 둘 것 (자리만 잡는다)**
- 폴더 이름 `deploy/kops-snapshot/`을 예약하고, 스냅샷 메뉴가 나중에 탭을 하나 더 받을 수 있다는 점만 기록한다. **코드·화면은 만들지 않는다.**
- 다음 범위 명세가 반드시 지켜야 할 제약을 여기 남긴다:
  - **읽기 전용 명령만**: `kops get cluster -o yaml`, `kops get instancegroup -o yaml`(또는 그 API 동등물). `kops update`, `kops rolling-update`, `kops toolbox dump`는 쓰지 않는다.
  - **state store의 `secrets/`·`pki/`·`issuedcerts/`를 읽지 않는다.** `kops get secrets`를 쓰지 않는다. `--full`은 완성된 spec에 인증서·토큰 경로가 섞일 수 있으므로 기본으로 쓰지 않는다(U6 확인 후 결정).
  - 비밀값 스캐너(`deploy/aws-snapshot/lib`)를 통과시키고, 걸리면 `k8s-snapshot`과 같은 "커밋 금지" 표시 규칙을 따른다.
  - **드리프트는 계산할 수 없다**(대시보드가 S3 state store를 조회하지 않으므로). 클러스터에서 볼 수 있는 값(마스터 대수·인스턴스 타입·노드 라벨·노드그룹 이름)과의 **부분 비교**만 가능하며, 그마저 다음 범위의 결정 사항이다.

---

## 9. 기존 명세와의 충돌

| 문서 | 충돌 내용 | 이 명세의 결정 |
|---|---|---|
| `cluster-status` 가정 A1 "대상은 EKS 클러스터 1개" | 대상이 kOps다 | **A1을 고친다**: "대상은 kOps 클러스터 1개". 다중 클러스터는 계속 범위 밖 |
| `cluster-status` 가정 A3 "metrics-server는 설치돼 있다(EKS 애드온)" | kOps 기본 설치가 아니다 | **A3을 뒤집는다**: "metrics-server는 **없을 수 있다**. 없으면 CPU·메모리 영역만 `unknown`이고 나머지는 정상 동작한다." 뒷문장은 원래 있던 동작이므로 코드 변경 범위는 문구와 힌트뿐 |
| `cluster-status` 3.2 "노드 수가 0이거나 모든 노드가 NotReady면 클러스터 전체 장애" | 마스터가 섞여 있다 | **"워커 0대 또는 워커 전원 NotReady"**로 바꾼다(3.1). 마스터 쪽은 3.2의 쿼럼 기준으로 따로 판단 |
| `cluster-status` 가정 A6 시스템 네임스페이스 기본값에 `amazon-cloudwatch` | EKS 관측 애드온이다 | 기본값에서 뺀다(AC-KOPS09). 설정으로 다시 넣을 수 있다 |
| `aws-cost` 가정 C3 "노드는 EC2 기반 노드그룹(관리형/자체 관리/Karpenter)" | kOps InstanceGroup이다 | **"노드는 kOps InstanceGroup(ASG 기반 EC2)"**로 고친다. Fargate 문구는 삭제(kOps에 없다) |
| `aws-cost` 3.1 "EKS 컨트롤 플레인" 행, 3.2-6 배분 규칙, 4절 리소스 목록 | kOps에 해당 요금이 없다 | 3.5로 대체 |
| `architecture-advisor` 3.2 R-EKSVER, 3.3 "클러스터: EKS 버전 … 지원 구간" | 오탐 / 없는 개념 | 3.7로 대체 |
| `architecture-advisor` 3.4 "노드 이름이 IP 형태면 가명" vs `docs/api/architecture-advisor.md:1084` | kOps 노드 이름이 인스턴스 ID가 된다(F10) | **인스턴스 ID 형태도 가명**으로 명시(AC-KOPS44). 3.4의 "인스턴스 ID는 항상 제외"와 일관해진다 |
| `k8s-snapshot` U6 "대상 환경: EKS", 3.2 EKS access entry 안내, 자동 생성 객체의 `eks:` 접두어 | kOps에는 access entry가 없다 | **문구를 kOps 기준으로 고친다**: 내보내기 전용 역할은 ClusterRole + 사람 사용자/그룹 바인딩으로 안내. `eks:` 접두어 제외 규칙은 **남겨도 무해**하지만(매칭되는 객체가 없다) 혼란을 줄이려 주석으로 "EKS 잔재" 표시 후 다음 정리 때 삭제 |
| `aws-snapshot-manager` A5·6절 "EKS 배포에는 스냅샷 폴더가 없다" | 배포 대상이 kOps다 | 문구만 "클러스터에 배포한 대시보드"로 일반화. 동작은 그대로 |
| `snapshot-3d` 2~4단계(AWS 구성도)의 `AWS::EKS::Cluster`·`AWS::EKS::Nodegroup` 처리 | kOps에는 이 타입이 없다 | **이번에 고치지 않는다**(2~4단계는 보류 상태). 그 단계를 시작할 때 ASG/Launch Template 중심으로 다시 설계해야 한다는 점만 기록 |
| `docs/api/common.md` 2.4 "live인데 설정 없는 출처는 mock으로 바꾸지 않는다" | 충돌 없음 | 3.4·3.6.3의 `unknown` 처리가 이 규칙을 그대로 따른다 |

---

## 10. 마이그레이션 영향 범위 (실제 파일 확인 결과)

아래는 저장소를 직접 읽어 확인한 목록이다. 줄 번호는 2026-09-24 기준.

### 10.1 명세 (`docs/specs/`)

| 파일:줄 | 내용 | 조치 |
|---|---|---|
| `cluster-status.md:10` | 가정 A1 "대상은 EKS 클러스터 1개" | kOps로 수정 |
| `cluster-status.md:12` | 가정 A3 "metrics-server는 설치돼 있다(EKS 애드온)" | 뒤집기 |
| `cluster-status.md:21` | "이 EKS 클러스터와 그 안의 Postgres를 운영하는" | 문구 |
| `aws-cost.md:16`(C3 인접), `:72`, `:91`, `:175` | 가정 C3, 3.1 EKS 행, 3.2-6 배분, 4절 리소스 목록 | 3.5로 교체 |
| `architecture-advisor.md:90`, `:112` | R-EKSVER, 스냅샷 클러스터 영역 | 3.7로 교체 |
| `k8s-snapshot.md:19,29,78,86,87,115,126,133,134,300,323,519` | 대상 환경·access entry·`eks:` 접두어·`amazon-cloudwatch`·mock 이름 | 문구 정리(9절) |
| `aws-snapshot-manager.md:25,52,263,375,406` | "EKS 배포" 문구, 예시 라벨 | 문구 일반화 |
| `snapshot-3d.md:8,16,32,36,64,68,72,73,164,184,194,223,229,231,240,241,334,336,342,455,459,475,476,477` | 1단계(K8s)는 mock 이름만, 2~4단계는 AWS EKS 타입 전제 | mock 이름만 정리, AWS 층은 **다음 범위**로 기록 |

### 10.2 API 계약 (`docs/api/`)

| 파일:줄 | 내용 |
|---|---|
| `cluster-status.md:45,46` | `NodeItem.nodeGroup`·`capacityType` 라벨 주석 → kOps 라벨 |
| `cluster-status.md:195,824` | mock `"name": "prod-eks"` |
| `cluster-status.md:272` | `cluster.name`이 `EKS_CLUSTER_NAME`에서 온다는 설명 |
| `cluster-status.md:337` | `kubeletVersion: "v1.30.2-eks-1552ad0"` |
| `cluster-status.md:943` | 환경 변수 표 `EKS_CLUSTER_NAME`("`eks:DescribeCluster` 대상") |
| `cluster-status.md:962` | 변경 이력의 EKS 지원 등급 언급 |
| `aws-cost.md:7` | AWS 권한 목록에 `eks:DescribeCluster` |
| `aws-cost.md:26` | 출처 설명 "EKS 클러스터" |
| `aws-cost.md:40,47,168` | `CostCategory` 타입·단가 설명·요약 예시 |
| `aws-cost.md:279-282,318,328,330` | `resources.eks[]`, `supportTier`, `eks:DescribeCluster` 조회 |
| `aws-cost.md:361,370` | 배분 `eksUsdPerHour`, 배분 규칙 |
| `aws-cost.md:712` | 태그 필터 예시 |
| `aws-cost.md:812,815` | 11절 8번(EKS 지원 등급), 변경 이력 |
| `architecture-advisor.md:355` | `cost` 카테고리 규칙 목록의 R-EKSVER |
| `architecture-advisor.md:705` | `platform: 'eks'` |
| `architecture-advisor.md:801` | 비용 카테고리 `'eks'` |
| `architecture-advisor.md:1066` | 시스템 프롬프트 "EKS·비용 어드바이저" |
| `architecture-advisor.md:1084` | 노드 이름 가명 규칙(EKS 기본 노드 이름 전제) |
| `common.md:168` | `SourceId` 주석 "EC2·EBS·ELB·EKS Describe" |
| `common.md:325` | `checks.snapshotStore` "EKS 배포는 보통 not_configured" |
| `common.md:550` | mock `large` 시나리오의 `bench-eks` |
| `k8s-snapshot.md:205,206,250,359,414,419,444,584,595,644,1080,1144,1145,1236,1298,1411,1416,1417,1423,1424,1426,1474,1529` | mock 클러스터 이름·서버 버전 접미사·EKS access entry·`eks:` 접두어·"EKS 배포" |
| `snapshot-3d.md:84,797,830` | mock 클러스터 이름 |

### 10.3 디자인 (`docs/design/`)

| 파일:줄 | 내용 |
|---|---|
| `shell.md:44` | 상단바 예시 `prod-eks · v1.30 · ap-northeast-2` (+ 긴 FQDN 대응 필요) |
| `cluster-status.md:44,66` | 요약 띠 예시 문자열 |
| `cluster-status.md:107` | metrics-server 힌트 "EKS 애드온 metrics-server를 설치하면" |
| `aws-cost.md:103,122,144,151,234` | 카테고리 순서·EKS 행 설명·`공용(클러스터)` 툴팁·태그 필터 예시·노드 0 상태 |
| `status.md:337` | 비용 내역 정렬 순서의 EKS |
| `components.md:751` | 예시 문자열 `prod-eks` |
| `k8s-snapshot.md:99,113,124,135,202,216,383,518,585,586` | mock 클러스터 이름·서버 버전·"EKS에 배포한 대시보드" |
| `aws-snapshot-manager.md:51,111,176,198,422` | "EKS 배포 기본", 예시 라벨·범위 요약 |

### 10.4 DB (`docs/db/`, Prisma)

| 파일:줄 | 내용 |
|---|---|
| `docs/db/schema.md:35` | "환경: EKS + 클러스터 안의 Postgres" |
| `docs/db/schema.md:57` | 소모율 기록 열 `eks_…` |
| `apps/api/prisma/schema.prisma:58` | `eksUsdPerHour @map("eks_usd_per_hour")` |
| `apps/api/prisma/migrations/20260919120000_init/migration.sql` | 위 열의 최초 생성 (새 마이그레이션으로 이름 변경) |

### 10.5 코드 — API (백엔드 요청)

| 파일:줄 | 내용 |
|---|---|
| `src/cluster/kube/extract.ts:122-126` | 노드그룹 라벨 3종 → `kops.k8s.io/instancegroup`. 같은 함수에 `role` 추출 추가 |
| `src/cluster/kube/extract.ts:95-104` | `capacityType` 라벨 해석(EKS/Karpenter 키) |
| `src/cluster/types.ts`, `src/cluster/model.ts`, `src/cluster/dto.ts` | `NodeItem.role` 추가, 노드그룹 주석 |
| `src/cluster/state/cluster-state.service.ts:197-198` | `EKS_CLUSTER_NAME` → `K8S_CLUSTER_NAME`, 워커/마스터 분리 집계 |
| `src/cluster/state/evaluate.ts`, `evaluate.spec.ts` | 노드 0개·전원 NotReady 판정, 컨트롤 플레인 판단 추가 |
| `src/cluster/cluster-query.service.ts` | 노드 목록 `role` 필터 |
| `src/cluster/cluster-advisor.snapshot.ts` | 스냅샷의 노드·클러스터 영역 |
| `src/config/env.validation.ts:97-100` | `EKS_CLUSTER_NAME` → `K8S_CLUSTER_NAME`, `CONTROL_PLANE_HA_EXPECTED` 추가 |
| `src/config/env.validation.ts:104-105` | `SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch` 제거 |
| `src/cost/aws/aws-sdk.gateway.ts:374-378` | 노드그룹 태그 → `kops.k8s.io/instancegroup` |
| `src/cost/aws/aws-sdk.gateway.ts:105-114` | 클러스터 태그 필터 — **그대로 둔다** |
| `src/cost/aws/aws-gateway.ts`, `aws-sdk.gateway.ts` | `describeEksCluster` 삭제 |
| `src/cost/cost.service.ts:631-651` | EKS 조회·지원 등급 대체 |
| `src/cost/cost.types.ts:23-37` | `CostCategory`·라벨 |
| `src/cost/estimate/estimator.ts:79-163, 202-246, 260-288` | EC2·EBS·LB의 `controlPlane` 분류 |
| `src/cost/estimate/allocation.ts` | `shared_cluster` 구성 |
| `src/cost/estimate/eks-support.ts` | `eksSupportTier` 삭제, 파일 이름 변경(나머지 함수 유지) |
| `src/cost/status/cost-status.ts`, `src/cost/store/cost-store.ts`, `src/cost/dto/cost.dto.ts` | 카테고리 교체 |
| `src/cost/cluster-inventory.port.ts`, `cluster-state.inventory.ts` | 노드 `role` 전달 |
| `src/advisor/precheck/precheck-rules.ts:123-126, 897` | R-EKSVER 삭제, R-CP-* 추가 |
| `src/advisor/snapshot/snapshot.types.ts:144, 198` | 카테고리·`platform` |
| `src/advisor/snapshot/sanitize-snapshot.ts` | 인스턴스 ID 형태 노드 이름 가명(AC-KOPS44) |
| `src/advisor/result/finalize-result.ts` | 카테고리 참조 |
| `src/health/health.service.ts` | 출처 설명 문구 |
| `package.json` | `@aws-sdk/client-eks` 제거 |
| **mock**: `src/cluster/mock/mock-world.ts:86-150, 193, 251, 481, 585` | 노드 이름(`ip-10-…` → `i-0…`), kubelet 버전(`-eks-…` 제거), 클러스터 이름, ECR 이미지 문자열, 노드그룹 이름, **마스터 3대 추가** |
| **mock**: `src/cost/mock/mock-world.ts:112, 545, 781-782, 862` | `MOCK_CLUSTER_NAME`, `eks` 리소스·단가 |
| **테스트**: `cost.service.spec.ts`, `estimator.spec.ts`, `allocation.spec.ts`, `precheck-rules.spec.ts`, `cluster-inventory.spec.ts`, `cost.dto.spec.ts`, `cost.module.spec.ts`, `sanitize-snapshot.spec.ts`, `finalize-result.spec.ts`, `extract-raw.spec.ts`, `k8s-snapshots.*.spec.ts` | 픽스처·기대값 갱신 |

### 10.6 코드 — 웹 (프론트 요청)

| 파일:줄 | 내용 |
|---|---|
| `features/aws-cost/types.ts:7,182,204` | `CostCategory`, `resources.eks`, `eksUsdPerHour` |
| `features/aws-cost/CostTables.tsx:45,46,144,222,344` | 순서·라벨·행 타입·렌더링·`shared_cluster` 설명 |
| `features/aws-cost/help.tsx:12,21` | 산정 방식·배분 규칙 문구 |
| `features/__fixtures__/fixtures.ts:55,261,453,558,576,577,598` | kubelet 버전, 클러스터 정보, CE 서비스 이름 "EKS", 카테고리·리소스·배분 |
| `features/__fixtures__/k8s-snapshots.ts`, `snapshots.ts` | mock 클러스터 이름 |
| `features/cluster-status/{types.ts,NodesPage.tsx,NodeDetailPage.tsx,OverviewPage.tsx}` | `role` 필드·컨트롤 플레인 섹션·카드 |
| `components/ui/__preview__/*`, `features/*/pages.test.tsx` | 예시·테스트 문자열 |

### 10.7 배포·설정

| 파일:줄 | 내용 |
|---|---|
| `.env.example:11-12` | `EKS_CLUSTER_NAME` → `K8S_CLUSTER_NAME`(설명: kOps 클러스터 이름, 보통 FQDN. **EC2 태그 필터에도 쓰인다**) |
| `.env.example:8-9` | kubeconfig 경로 설명에 **admin kubeconfig 금지** 주석 추가 |
| `.env.example:14` | `SYSTEM_NAMESPACES` 기본값 |
| `.env.example:102` | k8s 스냅샷의 "EKS 배포" 주석 |
| `docker-compose.yml:31` | `EKS_CLUSTER_NAME` 환경 변수 |
| `docker-compose.yml:28-30` | kubeconfig 주석에 admin 금지 추가 |
| `deploy/app.example.yaml:51-52` | `EKS_CLUSTER_NAME: prod-eks` |
| `deploy/rbac.yaml:23-25` | EKS IRSA 주석 삭제(kOps 방법은 U8) |
| `docs/HANDOFF.md:35` | "환경: EKS + 클러스터 안의 Postgres" |
| `README.md` | (EKS 언급 있으면) 환경 설명 |

### 10.8 RBAC·권한 (변경 없음을 확인)

- `deploy/rbac.yaml`의 리소스·동사 목록은 **그대로다.** 컨트롤 플레인 모니터링에 필요한 것은 이미 있는 `pods`·`nodes`의 get/list/watch뿐이다(D3).
- AWS 권한은 `eks:DescribeCluster`가 **빠지기만** 한다. 추가는 없다(D2·3.5.4).
- (2026-09-25 보충) 이후 `logs` 기능이 **서브리소스 `pods/log`의 `get` 하나**를 추가한다(`docs/specs/logs.md` AC-LOG01). 그것은 **`logs` 기능의 변경이지 이 전환의 변경이 아니다** — kOps 전환 자체는 여전히 RBAC를 늘리지 않으며, 위 D3("컨트롤 플레인 모니터링은 기존 RBAC 범위 안에서 static pod 상태까지만")의 **상태 판단 범위도 그대로다.** 늘어난 권한으로 하는 일은 로그 조회뿐이고 etcd 심층 지표는 계속 범위 밖이다(3.2.2).
- `alerts` 기능도 RBAC·AWS 권한을 **늘리지 않는다.** 이미 계산된 `StatusInfo`에서 파생되고, 새로 생기는 바깥 접속은 디스코드 아웃바운드 HTTPS 하나뿐이다(`docs/specs/alerts.md` 0.3).

---

## 11. 열린 질문 (PM 결정 필요)

> 아래는 planner가 판단하지 않고 남긴 것이다. Q1~Q4는 1단계 착수 전에, Q5~Q9는 해당 단계 전에 답이 필요하다.

- **Q1. 개요 화면 카드를 5개 → 6개로 늘리는 것이 맞는가?**
  planner 권고는 6개(컨트롤 플레인 카드 추가)다. 대안은 노드 카드 안에 "워커 6/6 · 컨트롤 플레인 3/3" 두 줄로 넣고 카드 수를 유지하는 것. 후자는 디자인 변경이 작지만 컨트롤 플레인 장애가 노드 카드에 묻힌다. **디자인 작업량과 눈에 띄는 정도 중 무엇을 우선할지**가 결정 사항이다.

- **Q2. 사이드바에 "컨트롤 플레인" 메뉴를 새로 만들 것인가?**
  planner 권고는 **만들지 않고** 노드 화면 안의 섹션 + `nav.nodes` 상태에 합산. 메뉴를 만들면 `shell.md`·`overview.nav`·`snapshot-menu` 규칙까지 손대야 한다.

- **Q3. 단일 마스터(1대) 구성을 기본으로 "주의"로 볼 것인가?**
  planner 권고는 기본 주의 + 설정 `CONTROL_PLANE_HA_EXPECTED=false`로 끄기. 개발 클러스터에서 상시 노란색이 되는 것이 거슬린다면 기본을 "정보 표시만"으로 뒤집을 수 있다.

- **Q4. 노드 목록의 기본 필터를 "워커만"으로 할 것인가?**
  planner 권고는 기본 `role=worker`. 대안은 기본 `all` + `역할` 열. 기본 all이면 "노드 9대"라는 숫자가 다시 섞인다.

- **Q5. 어드바이저 제안의 "실행 예시"에 kOps 클러스터 변경 명령을 넣어도 되는가?**
  대시보드는 실행하지 않지만 화면에 `kops edit cluster` / `kops update cluster` 같은 명령이 복사 가능한 형태로 보이게 된다. planner 잠정 권고: **허용하되** ① `--yes` 없는 형태로만, ② "이 대시보드는 명령을 실행하지 않습니다. 직접 확인 후 실행하세요" 경고를 항상 붙인다. 금지 쪽으로 정하면 제안이 추상적이 된다.

- **Q6. 마스터에 워크로드를 올리는 구성(단일 노드 클러스터 등)을 지원할 것인가?**
  이번 명세는 "마스터에는 컨트롤 플레인 파드만 있다"를 전제로 워커 기준 집계·배분을 정했다. 마스터 taint를 뺀 구성에서는 용량·배분이 다시 왜곡된다. planner 권고: **범위 밖**으로 두고 화면에 경고 한 줄("컨트롤 플레인 노드에 워커 파드가 N개 있습니다 — 용량·비용 배분에 반영되지 않습니다")만 띄운다.

- **Q7. 쿠버네티스 버전 EOL 규칙(R-EKSVER의 대체)을 만들 것인가?**
  EKS 지원 등급은 사라졌지만 "쿠버네티스 커뮤니티 지원이 끝난 버전"은 kOps에서도 의미가 있다. 다만 EOL 표를 코드에 넣으면 주기적으로 갱신해야 한다(기존 `eks-support.ts`의 표와 같은 유지보수 부담). planner 권고: **이번 범위 밖**, 필요하면 다음 범위에 `R-K8SVER`로.

- **Q8. `deploy/kops-snapshot/`를 다음 범위로 미루는 것에 동의하는가?** (8절)
  planner 권고는 "필요하지만 다음 범위". 지금 같이 하자고 결정하면 이번 단계 수용 기준이 46개에서 크게 늘어난다.

- **Q9. 마이그레이션 중 mock 클러스터의 정체성을 어디까지 바꿀 것인가?**
  mock 클러스터 이름 `prod-eks`는 `k8s-snapshot`·`snapshot-3d`·`aws-snapshot-manager`의 예시와 드리프트 짝 맞추기까지 **십여 개 문서에 걸쳐 있다**(10.2·10.3). 전부 `prod.k8s.example.com`류로 바꾸면 변경 범위가 크고 리뷰가 어려워진다. planner 권고: **이름은 `prod.k8s.example.com`으로 바꾸되 한 번에 일괄 치환**하고, `staging-eks`·`bench-eks`도 함께 바꾼다. "이번엔 코드 픽스처만 바꾸고 문서 예시는 그대로 둔다"를 택하면 문서와 mock이 어긋난다.
