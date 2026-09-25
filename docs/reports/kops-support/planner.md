# kops-support · 기획(planner) 작업 보고

> 파일 위치: `docs/reports/kops-support/planner.md`
> 같은 기능에서 같은 역할이 다시 작업하면 새 파일을 만들지 말고 아래에 `## YYYY-MM-DD HH:mm · <작업 이름>` 섹션을 **추가**한다 (이전 섹션은 지우지 않는다).

## 2026-09-24 · kOps 전환 기능 명세 작성

### 1. 요청 내용

PM 요청: 대상 환경이 EKS → **kOps(Kubernetes Operations)로 프로비저닝한 클러스터**로 바뀌었으므로 `docs/specs/kops-support.md` 기능 명세를 작성하라.

범위(PM이 명세에 반드시 담으라고 지정한 10가지):
1. kOps와 EKS의 차이가 대시보드에 미치는 영향(배경 설명 포함)
2. 컨트롤 플레인이 새 모니터링 대상 — static pod 상태 판단 기준
3. 마스터 노드가 `GET /api/v1/nodes`에 섞이는 문제 — 어디를 "워커만"으로 바꿀지, 컨트롤 플레인을 어디에 보여줄지
4. 비용 모델 재정의(`eks` → `controlPlane`), 계산 항목/범위 밖 판단과 근거
5. metrics-server 미설치 시 동작과 안내 문구
6. 인증 경로(admin kubeconfig 금지, 클러스터 밖 실행 포함)
7. 어드바이저 규칙 정리(삭제/신규 후보)
8. `deploy/kops-snapshot/` 필요성 판단과 범위 권고
9. 단계 구분 + 단계별 수용 기준(AC-KOPS01~ 형식)
10. 마이그레이션 영향 범위(실제 파일 확인 필수, 추측 금지)

재논의 금지 제약 3가지: ① EKS 경로 완전 제거·플랫폼 분기 없음, ② `autoscaling:DescribeAutoScalingGroups` 추가 금지, ③ 컨트롤 플레인은 기존 RBAC 안 static pod 상태까지만.

산출물: `docs/specs/kops-support.md`, `docs/reports/kops-support/planner.md`.

### 2. 참고한 문서

**저장소 문서**
- `CLAUDE.md` (kOps 전환 2026-09-24 항목 전체, AWS 권한 목록, RBAC 목록)
- `docs/specs/cluster-status.md` (전문), `docs/specs/aws-cost.md` (전문)
- `docs/specs/architecture-advisor.md` 3.1~3.4
- `docs/specs/k8s-snapshot.md` 3.1~3.4, `docs/specs/aws-snapshot-manager.md`, `docs/specs/snapshot-3d.md` (EKS 전제 부분)
- `docs/api/common.md` (전문 — `unknown`·stale·`SourceState`·mock 시나리오 규칙)
- `docs/api/cluster-status.md` 0·1.1·2.1~2.3·3.1·3.2·7.2·7.3·11·13절
- `docs/api/aws-cost.md`, `docs/api/architecture-advisor.md`, `docs/api/k8s-snapshot.md`, `docs/api/snapshot-3d.md` (EKS 언급 전수 grep)
- `docs/design/{shell,cluster-status,aws-cost,status,components,k8s-snapshot,aws-snapshot-manager}.md` (EKS 언급 전수 grep)
- `docs/db/schema.md`, `docs/HANDOFF.md`
- `docs/reports/TEMPLATE.md`

**코드(직접 읽음)**
- `apps/api/src/cluster/kube/extract.ts` 100-152 (노드그룹 라벨·capacityType)
- `apps/api/src/cluster/state/cluster-state.service.ts` 185-214
- `apps/api/src/cluster/mock/mock-world.ts` 80-150, grep(노드 이름·kubelet 버전·클러스터 정보)
- `apps/api/src/cost/aws/aws-sdk.gateway.ts` 95-135, 360-390, 417-444
- `apps/api/src/cost/estimate/estimator.ts` 60-288 (EC2·IPv4·EBS·LB 분류 전 구간)
- `apps/api/src/cost/estimate/eks-support.ts` (전문)
- `apps/api/src/cost/cost.service.ts` 620-652, `apps/api/src/cost/cost.types.ts` 20-79
- `apps/api/src/advisor/precheck/precheck-rules.ts` 67-160 + 규칙 ID 전수 grep
- `apps/api/src/advisor/snapshot/snapshot.types.ts` (eks grep)
- `apps/api/src/config/env.validation.ts` 85-114
- `apps/api/prisma/schema.prisma` (cost_rate_samples 열)
- `apps/web/src/features/aws-cost/{types.ts,CostTables.tsx,help.tsx}`, `apps/web/src/features/__fixtures__/fixtures.ts` (eks grep)
- `.env.example`, `docker-compose.yml`, `deploy/rbac.yaml`, `deploy/app.example.yaml`

**외부(kOps 공식 문서·소스, WebSearch/WebFetch로 확인)**
- `kops.sigs.k8s.io/cluster_spec/` — etcd 볼륨 기본 gp3 20GB, API LB 기본 class `Network`(NLB), CLB 1.26 deprecated·1.37 제거
- `kops.sigs.k8s.io/addons/` — metrics-server는 관리 애드온(`spec.metricsServer.enabled`)
- `kops.sigs.k8s.io/operations/etcd_administration/` — `etcd-manager-main`/`etcd-manager-events`, `kube-system`
- `kops.sigs.k8s.io/releases/1.37-notes/` — gossip DNS 제거, `--dns=none`
- kOps 소스 `pkg/nodeidentity/aws/identify.go` — `CloudTagInstanceGroupName = "kops.k8s.io/instancegroup"`
- kOps 소스 `pkg/model/context.go` — `CloudTagsForInstanceGroup`
- kOps `pkg/nodelabels` — `BuildMandatoryControlPlaneLabels`, `node-role.kubernetes.io/control-plane`
- kOps PR #12862 — 쿠버네티스 1.23+ / 외부 AWS CCM에서 **Node 이름이 EC2 인스턴스 ID**
- kOps issue #6775·#4035, PR #8660 — `kubernetes.io/cluster/<name>=owned` 태그

### 3. 작업 내용

1. **제약 정리**: `CLAUDE.md`의 kOps 전환 확정 항목과 PM 지시 3가지를 명세 0.1에 표(D1~D9)로 고정했다. 이후 모든 결정이 이 표를 참조하도록 썼다.
2. **사실/추측 분리**: kOps 동작을 확인한 것(0.2 F1~F11, 근거 문서·소스 파일명 포함)과 확인하지 못한 것(0.3 U1~U8)을 분리했다. U 항목은 명세에서 단정하지 않고, 그 대신 "확인 없이도 동작하는 설계"(예: 미러 파드 2중 식별 조건, API LB 후보 규칙 + 추정 라벨)를 정의했다.
3. **차이 표 작성**(1.2): 배경을 모르는 독자를 위해 EKS vs kOps를 12행 비교표로 쓰고, 각 행에 "대시보드에 생기는 문제"를 붙였다.
4. **노드 분리 설계**(3.1): 코드와 API 계약을 읽고 "워커만으로 바꿀 곳" 9개, "전부로 남길 곳", "컨트롤 플레인을 새로 보여줄 곳" 5개를 각각 표로 확정했다.
5. **컨트롤 플레인 상태 기준**(3.2): 마스터 노드(HA·쿼럼·AZ·cordon)와 구성요소(Ready·대기 사유·재시작·개수)를 `cluster-status` 3.2/3.4 기준을 재사용해 정의했다. 두 가지 함정을 명시적으로 처리했다 — ① 마스터 NotReady 시 미러 파드가 `Running`으로 굳는 문제 → 해당 마스터 구성요소는 `unknown`, ② apiserver가 다 죽으면 대시보드 자신이 못 보는 문제 → 화면 안내.
6. **비용 모델**(3.5): estimator 코드를 읽어 "새 AWS 호출 없이 분류만 바꾸면 된다"는 것을 확인하고, 마스터 EC2/etcd EBS(현재 `attachment: 'other'`로 이미 잡힘)/마스터 루트 볼륨/API LB/마스터 퍼블릭 IPv4를 `controlPlane`으로 옮기는 설계를 썼다. Route53·S3는 권한·구성 가변성·금액 비중 세 가지 근거로 제외하고 도움말 노출을 의무화했다.
7. **인증 경로**(3.6): admin kubeconfig 금지 이유를 권한 관점으로 적고, 클러스터 밖 실행용으로 "사람이 만든 ServiceAccount 토큰 kubeconfig를 읽기 전용 마운트"를 기본 경로로 정했다. 토큰 만료 시 동작(`KUBE_AUTH_FAILED`, mock 대체 금지)과 검증 가능한 수용 기준(`kubectl auth can-i --list`)을 붙였다.
8. **어드바이저 규칙**(3.7): R-EKSVER 삭제, R-CP-HA/R-CP-SPOT/R-CP-RESTART를 1단계, R-CP-EVEN/R-CP-AZ/R-CP-UNDERSIZE를 2단계로 배치. etcd 볼륨 타입은 새 규칙 대신 기존 R-GP2에 흡수하도록 했다(중복 방지). 마스터 과대 스펙은 결정적 기준을 세울 수 없어 LLM에 맡긴다고 명시.
9. **`deploy/kops-snapshot/` 판단**(8절): "필요하다, 다만 다음 범위"로 결론. 근거 3+3개와, 다음 범위 명세가 지켜야 할 제약(읽기 전용 명령만, secrets/pki 미접근, `--full` 기본 금지, 드리프트 계산 불가)을 남겼다.
10. **단계·수용 기준**(5절): P1~P5(이번 범위) + P6(다음 범위)로 쪼개고 AC-KOPS01~46을 단계별로 배정했다.
11. **마이그레이션 영향 범위**(10절): grep + 파일 읽기로 확인한 실제 줄 번호 기반 목록을 문서/디자인/DB/API 코드/웹 코드/배포 설정/RBAC 7개 절로 정리했다.
12. **충돌 정리**(9절): 기존 명세 11곳과의 충돌을 표로 적고 각각의 결정을 명시했다.
13. **열린 질문**(11절): PM 결정이 필요한 Q1~Q9를 권고안과 함께 남겼다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/specs/kops-support.md` | 추가 | kOps 전환 기능 명세 (0~11절, AC-KOPS01~46, 열린 질문 Q1~Q9) |
| `docs/reports/kops-support/planner.md` | 추가 | 이 보고서 |

- `docs/specs/` 밖의 파일은 수정하지 않았다(보고서 예외 제외). 코드는 전혀 건드리지 않았다.

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 선택 이유 |
|---|---|---|---|
| 1 | 컨트롤 플레인을 **개요 6번째 카드 + 노드 화면 섹션**으로 배치, 사이드바 메뉴는 만들지 않음 | 별도 메뉴, 노드 카드 안에 병기 | 대상이 마스터 3대 + 파드 15개로 작다. 메뉴를 늘리면 `shell.md`·`nav`·`snapshot-menu` 규칙까지 파급. 다만 "카드 6개 vs 노드 카드 병기"는 디자인 작업량 판단이라 Q1로 남김 |
| 2 | 노드 목록 기본 필터를 **워커만**(`role=worker`) | 기본 `all` + 역할 열 | 왜곡된 숫자(노드 9대)가 다시 섞이는 것을 막는 것이 이번 전환의 핵심 목적. 단 사용자가 마스터를 못 찾는 위험이 있어 Q4로 확인 요청 |
| 3 | 쿼럼 판단을 **마스터 노드 대수 근사**로 | etcd 멤버 목록 조회 | etcd 멤버 목록은 RBAC/Prometheus 범위 밖(D3). 근사임을 툴팁에 명시하는 조건으로 채택 |
| 4 | 마스터 NotReady면 **구성요소를 `unknown`으로** | 파드 상태 그대로 표시 | kubelet이 멈추면 미러 파드가 `Running`으로 굳는다. 그대로 두면 "정상"으로 보여 장애를 놓친다. 오탐보다 미탐이 위험 |
| 5 | 비용 `controlPlane`을 **역할 축 카테고리**로(마스터 EC2·EBS·LB·IPv4를 전부 이동) | 카테고리는 리소스 종류대로 두고 배분에서만 공용 처리 | PM 지시(D4)가 전자. 부수 효과로 `ec2`/`ebs` 카테고리가 워커 전용이 되어 네임스페이스 배분표와 어긋나지 않는다 |
| 6 | **Route53·state store S3 제외** | 소액이라도 포함 | ① 권한 추가 필요(원칙 위반), ② `--dns=none` 구성이면 존이 없어 거짓 금액이 됨(F9), ③ 마스터 EC2 대비 1% 미만. 대신 "포함되지 않는 것" 도움말 노출을 의무화 |
| 7 | API LB 식별을 **후보 규칙 + "추정" 라벨 + 0/1/N개별 동작** | 이름 규칙으로 단정 | NLB 이름·태그 규칙을 확인하지 못했다(U2). 단정하면 틀렸을 때 금액이 조용히 틀린다 |
| 8 | 클러스터 밖 인증을 **사람이 만든 SA 토큰 kubeconfig**로 | `kops export kubeconfig`(비-admin) 사용 | 비-admin kubeconfig의 실제 자격 증명을 확인하지 못했다(U7). kOps 명령에 의존하지 않는 경로가 더 안전하고 검증 가능(`auth can-i --list`) |
| 9 | etcd 볼륨 타입 규칙을 **R-GP2에 흡수** | 새 규칙 R-ETCD-VOL 추가 | 기존 R-GP2가 이미 gp2 볼륨을 전부 잡는다. 규칙을 늘리면 같은 볼륨이 두 번 보고된다 |
| 10 | `deploy/kops-snapshot/`를 **다음 범위로** | 이번 범위 포함 | 이번 필수 목표(대시보드가 kOps에서 동작)는 CLI 없이 달성된다. CLI + 탭 + mock + 3D 파급은 `k8s-snapshot` 한 기능 규모. 게다가 `kops get cluster -o yaml`의 비밀값 포함 여부를 확인하지 못했다(U6) |
| 11 | `SYSTEM_NAMESPACES` 기본값에서 `amazon-cloudwatch` 제거 | 유지 | EKS 관측 애드온 전용 네임스페이스. kOps에는 존재하지 않아 남기면 혼란만 준다 |
| 12 | 어드바이저에서 **인스턴스 ID 형태 노드 이름도 가명 처리** | 기존 IP 형태 규칙 유지 | F10 확인: kOps + 외부 CCM이면 노드 이름이 `i-0…`. 어드바이저 명세 3.4는 인스턴스 ID를 "항상 제외"로 이미 정하고 있어 그대로 두면 **기존 규칙 위반** |
| 13 | `K8S_CLUSTER_NAME` 미설정 시 비용만 `unavailable` | API 기동 실패 / 전체 unknown | 이 값은 EC2 태그 필터 값이 되어 없으면 비용 귀속이 불가능하다. 하지만 클러스터 상태 화면은 멀쩡히 동작해야 한다(한 출처 실패가 다른 영역에 영향 없음 원칙) |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `Grep EKS\|eks` — `docs/` 전체 | 39개 파일 210건 확인 | 10절 표의 근거. specs·api·design·db·HANDOFF는 줄 단위로 전수 확인 |
| `Grep EKS\|eks\|nodegroup\|nodeGroup` — `apps/` | 79개 파일 357건 확인 | 주요 파일은 직접 읽어 교차 확인 |
| 코드 직접 읽기 (10건, 2절 목록) | 완료 | PM이 지목한 6개 지점 전부 확인 + estimator EBS/LB 분류 로직 추가 확인 |
| kOps 공식 문서·소스 확인 (WebSearch·WebFetch 8회) | 완료 | 0.2 F1~F11의 근거. 확인 못 한 8건은 0.3 U1~U8로 분리 |
| lint / test | **실행하지 않음** | 문서만 작성. 코드 변경 없음 |
| 실제 kOps 클러스터에서의 동작 확인 | **하지 않음(불가)** | 접근 가능한 kOps 클러스터가 없다. U2·U4·U5·U8은 백엔드가 실클러스터에서 확인해 문서화하도록 명세 7절(백엔드 전달 사항)에 명시 |

### 7. 남은 이슈·한계

- **확인하지 못한 kOps 동작 8건**(명세 0.3 U1~U8). 명세에서 단정하지 않고 "확인 필요"로 표시했고, 확인 없이도 동작하는 설계로 우회했다. 다만 U2(API LB 식별)는 실제로 틀리면 **비용 금액이 조용히 틀리는** 항목이라 백엔드 확인 우선순위가 높다.
- **etcd 볼륨 개수 가정**: "마스터당 main/events 2개"는 kOps 기본값(F6) 기준이다. `etcdClusters`를 커스터마이즈해 볼륨을 나눈 구성은 개수가 다를 수 있다. 명세는 개수를 하드코딩하지 않고 "마스터에 붙은 PVC·루트가 아닌 볼륨"으로 정의했으므로 동작에는 문제가 없지만, mock 예시와 AC-KOPS28은 기본값(6개)을 전제한다.
- **쿼럼 판단의 근사**: 마스터 노드 수 = etcd 멤버 수라는 근사. etcd 멤버가 마스터와 어긋난 상태(교체 중 등)에서는 판단이 틀릴 수 있다. RBAC를 늘리지 않는 한 해소 불가(D3).
- **mock 클러스터 이름 일괄 변경의 파급**(Q9). `prod-eks`가 `k8s-snapshot`·`snapshot-3d`·`aws-snapshot-manager`의 드리프트 짝 맞추기 예시까지 얽혀 있어, 바꾸면 변경 파일이 십여 개 문서로 늘고 안 바꾸면 문서와 mock이 어긋난다. PM 결정 필요.
- **`snapshot-3d` 2~4단계**(AWS 구성도)는 `AWS::EKS::Cluster`/`AWS::EKS::Nodegroup` 전제로 설계돼 있다. 현재 보류 단계라 이번에 고치지 않았지만, 그 단계를 시작하면 **ASG/Launch Template 중심으로 재설계가 필요하다**는 점만 명세 9절에 기록했다.
- **수용 기준 46개는 5개 단계에 걸쳐 있다.** 한 번에 검증하려 하면 어느 단계가 깨졌는지 판별이 어렵다. 단계별로 나눠 검증하기를 권한다.

### 8. 다른 담당 요청

- **PM 요청**: 명세 11절 **Q1~Q9 결정**. 특히 Q1(개요 카드 6개), Q2(사이드바 메뉴), Q4(노드 목록 기본 필터), Q8(`deploy/kops-snapshot/` 범위), Q9(mock 이름 일괄 변경)는 디자인·백엔드 착수 전에 필요하다.
- **PM 요청**: 명세 9절의 기존 명세 수정(특히 `cluster-status` 가정 A1·A3, `aws-cost` 가정 C3)을 planner가 해당 명세 파일에 직접 반영할지, 아니면 `kops-support.md`의 "덮어쓰기 선언"으로만 둘지 결정. **이번에는 `kops-support.md` 안에 충돌표로만 적었다**(다른 명세 파일을 건드리지 않았다).
- **백엔드 요청**: 실클러스터에서 U2(API 서버 LB 태그·이름 규칙), U4(미러 파드 이름 규칙), U5(추가 static pod 목록), U8(kOps에서 대시보드 파드에 AWS 읽기 권한 주는 방법)을 확인해 `docs/api/`에 기록. `deploy/rbac.yaml`의 EKS IRSA 주석 삭제, 대시보드용 kubeconfig 구성 절차 README 작성(admin kubeconfig 금지 경고 포함).
- **DBA 요청**: `cost_rate_samples.eks_usd_per_hour` → `control_plane_usd_per_hour` 마이그레이션. **기존 행을 지우지 않아야 한다**(급증 판단의 7일 중앙값·90일 보관 기준선이 끊기면 AC-KOPS34 실패). `docs/db/schema.md:35,57` 문구도 함께.
- **디자이너 요청**: 명세 7절 디자인 항목 7가지. 특히 긴 클러스터 이름(FQDN) 상단바 처리와 구성요소 매트릭스(마스터 × 5종).
- **프론트 요청**: `CostCategory` 교체는 타입·라벨·순서·툴팁·픽스처가 한 묶음이다(10.6 표). 상태 계산을 화면에서 하지 않는 원칙 유지(쿼럼·HA 판단은 서버 값).

### 9. 다음 담당이 알아야 할 점

- **명세는 "새 기능"이 아니라 "기존 세 기능의 수정 명세"다.** `cluster-status`·`aws-cost`·`architecture-advisor` 명세를 폐기하지 않는다. 충돌하는 부분만 9절에서 덮어쓴다.
- **권한은 절대 늘리지 않는다.** 쿠버네티스 RBAC는 `deploy/rbac.yaml` 그대로(컨트롤 플레인 모니터링은 기존 `pods`·`nodes` get/list/watch로 충분), AWS는 `eks:DescribeCluster`가 빠지기만 하고 추가는 없다. 구현 중 "이것만 있으면 되는데" 싶으면 PM에게 올린다.
- **AWS 호출 수는 늘지 않는다.** 비용 `controlPlane`은 이미 받아오는 인스턴스·볼륨·LB 목록의 **분류만** 바꾸는 것이다. 새 Describe를 추가하면 설계 의도에서 벗어난 것이다.
- **`estimator.ts`에서 etcd 볼륨은 이미 잡히고 있다.** 마스터에 붙은 PVC·루트가 아닌 볼륨은 현재 `attachment.type = 'other'`로 `ebs` 카테고리에 들어간다(`estimator.ts:233-240`). 새로 찾는 것이 아니라 옮기는 것이다.
- **마스터 NotReady 시 구성요소 `unknown` 규칙**(3.2.2)은 구현에서 빠뜨리기 쉽다. 빠뜨리면 장애를 정상으로 표시하는 가장 위험한 버그가 된다. AC-KOPS21로 반드시 확인할 것.
- **mock에 마스터 3대가 없다.** 현재 `mock-world.ts`의 `NODE_SPECS`는 워커 6대뿐이다(라인 86-150). P2·P3 검증을 하려면 mock에 컨트롤 플레인을 먼저 넣어야 한다.
- **`K8S_CLUSTER_NAME`의 성격이 바뀐다.** 전에는 "표시용 이름(없어도 됨)"이었지만 이제는 EC2 태그 필터 값이다. 값이 틀리면 비용이 조용히 0이 된다. AC-KOPS33의 동작(비용만 `CLUSTER_NAME_NOT_CONFIGURED`, 나머지 정상)을 지킬 것.
- **조회 전용 원칙**: 안내 문구·어드바이저 제안에 클러스터 변경 명령을 넣는 문제는 Q5로 열려 있다. 결정 전에는 **명령을 넣지 않는 쪽**으로 구현한다(명세 3.4 metrics-server 안내 문구가 그 예시다). → **Q5는 2026-09-24에 결정됐다**(아래 섹션 참고).

---

## 2026-09-24 · 기존 명세 충돌 반영 (kops-support 9절 → 대상 명세 직접 수정)

### 1. 요청 내용

PM 요청: `docs/specs/kops-support.md`가 채택됐으니, 9절 "기존 명세와의 충돌" 표에 적어 둔 처리 방침을 **대상 명세 파일들에 직접 반영**하라. 충돌표만 남겨 두면 두 문서가 어긋난 채로 구현이 시작된다.

범위:
1. 9절 충돌표의 각 행을 대상 명세 파일(`cluster-status`, `aws-cost`, `architecture-advisor`, `k8s-snapshot`, `aws-snapshot-manager`, `snapshot-3d`)에 실제로 반영.
2. Q9의 mock 클러스터 이름 일괄 변경을 `docs/specs/**` 안에서 수행하고, 문서 간 클러스터 ID 일치를 다시 확인.
3. `snapshot-3d` 2~4단계는 보류 상태이므로 고치지 않고 "다시 설계해야 한다"는 메모만 남긴다.
4. 반영 후 `docs/specs/` 전체에서 `EKS`/`eks`를 재검색해 남은 것이 의도적인지 확인.

제약: `docs/specs/**` 밖 수정 금지(보고서 예외), 기존 AC 번호 재배치 금지, 이미 확정·구현된 동작 변경 금지, `kops-support.md` 자체는 충돌표가 틀린 경우에만 수정.

PM 결정(재논의 없음): Q1 개요 카드 6개 / Q2 사이드바 컨트롤 플레인 메뉴 없음 / Q3 단일 마스터 기본 "주의" + `CONTROL_PLANE_HA_EXPECTED=false` / Q4 노드 목록 기본 `role=worker` / Q5 어드바이저 실행 예시에 `kops` 명령 허용(`--yes` 없는 형태 + 미실행 경고 필수) / Q6 마스터 워크로드 구성은 범위 밖(경고 한 줄) / Q7 쿠버네티스 EOL 규칙 범위 밖 / Q8 `deploy/kops-snapshot/`은 다음 범위 / Q9 mock 클러스터 이름 문서까지 일괄 변경.

### 2. 참고한 문서

- `docs/specs/kops-support.md` — 0.1 확정 전제(D1~D9), 3.1~3.7(지표·판단 기준), 5절 AC-KOPS01~46, **9절 충돌표**, 10.1 명세 영향 목록
- `docs/reports/kops-support/README.md` — PM 결정 기록, 사용자 결정 표(Q1~Q9), 추가 PM 지시
- 수정 대상 6개 명세 전문(또는 해당 절): `docs/specs/{cluster-status,aws-cost,architecture-advisor,k8s-snapshot,aws-snapshot-manager,snapshot-3d}.md`
- `docs/reports/TEMPLATE.md`

### 3. 작업 내용

**(1) `cluster-status.md`** — 충돌표 4행(A1·A3·3.2 노드 판정·A6) 반영 + Q1·Q4·Q6 결정 반영
- 문서 머리에 "2026-09-24 갱신" 안내를 넣고, 컨트롤 플레인 지표·기준은 `kops-support` 3.1~3.2가 우선함을 명시.
- 가정 A1: "EKS 클러스터 1개" → "kOps 클러스터 1개(EC2 컨트롤 플레인)". 다중 클러스터는 계속 범위 밖.
- 가정 A3: **뒤집음.** "metrics-server는 설치돼 있다(EKS 애드온)" → "없을 수 있다(kOps 기본 설치가 아니다)". 뒷문장(없으면 CPU·메모리만 unknown)은 원래 동작이므로 유지하고, mock 대체 금지(`common.md` 2.3·2.4)를 덧붙였다.
- 가정 A6: 시스템 네임스페이스 기본값에서 `amazon-cloudwatch` 제거(AC-KOPS09) + "컨트롤 플레인 섹션은 시스템 필터와 무관하게 항상 보인다".
- 1절 "누가": "이 EKS 클러스터" → "이 kOps 클러스터".
- 3.1 요약 띠: 노드 수를 **워커 기준**으로, 부제에 `· 컨트롤 플레인 3/3` 별도 표기.
- 3.2 노드: 표시 항목에 "역할" 추가, 역할 판별 규칙(`node-role.kubernetes.io/control-plane` 또는 구 `master`)과 "기본 워커만" 원칙, 노드그룹 = kOps InstanceGroup, **Q6 경고 한 줄**을 불릿으로 추가. 상태 기준 표 자체는 손대지 않고 "워커·컨트롤 플레인 양쪽에 똑같이 적용"임을 명시.
- 3.2 마지막 불릿: "노드 수 0 또는 전원 NotReady → 클러스터 전체 장애" → **"워커 0대 또는 워커 전원 NotReady"**(AC-KOPS14), 마스터는 `kops-support` 3.2 쿼럼 기준으로 별도 판단.
- 3.6: "클러스터 전체"가 워커 합계임을 명시, 컨트롤 플레인 합계는 별도 블록, metrics-server **미설치**도 unknown 경로임을 추가.
- S1 시나리오와 7절 디자인의 "영역 카드 5개" → **6개**(Q1 결정).

**(2) `aws-cost.md`** — 충돌표 2행(C3, 3.1 EKS 행·3.2-6 배분·4절 리소스 목록) 반영
- 문서 머리에 갱신 안내(상세는 `kops-support` 3.5 우선).
- 가정 C3: "EC2 기반 노드그룹(관리형/자체 관리/Karpenter), Fargate 범위 밖" → **"kOps InstanceGroup(ASG 기반 EC2)"**. Fargate 문구 삭제(3.8 한계 목록의 Fargate 항목도 삭제).
- 3.1 표: `EKS 컨트롤 플레인` 행 → **`컨트롤 플레인`** 행(하위 종류 5종 명시). EC2 노드·IPv4·EBS·LB 행을 "워커·워크로드용"으로 한정하고, 중복 계상 금지(AC-KOPS29)와 "AWS 호출이 늘지 않는다"를 불릿으로 추가.
- 3.1 표시: 전환 안내 문구(AC-KOPS35) 추가.
- 3.2 배분 규칙 1: 워커 노드만 배분 대상(마스터 위 파드에 배분하지 않음, AC-KOPS15). 규칙 6: 컨트롤 플레인 전체 + 워커 루트 볼륨 + 워커 퍼블릭 IPv4 → 공용(클러스터).
- 3.8 한계: Route 53을 "클러스터 밖 서비스" 나열에서 빼고 **Route 53 호스팅 존·쿼리**와 **kOps state store S3**를 근거와 함께 별도 항목으로 올렸다(AC-KOPS31).
- 4절: 리소스 목록에서 "EKS 클러스터" 삭제 + 호출이 1회 줄었다는 비고.

**(3) `architecture-advisor.md`** — 충돌표 2행(R-EKSVER·스냅샷 클러스터 영역, 가명 규칙) 반영 + Q5·Q7 결정 반영
- 문서 머리에 갱신 안내(상세는 `kops-support` 3.7 우선).
- 3.2 규칙 표: `R-EKSVER` 행 **삭제**, `R-CP-HA`·`R-CP-SPOT`·`R-CP-RESTART` 3행 추가(표 끝, 기존 R-ID는 그대로 둠).
- 3.2 아래 불릿: 삭제 이유와 Q7(대체 규칙 `R-K8SVER`는 범위 밖), R-CP-* 의 시스템 네임스페이스 예외, 워커 한정 규칙(R-NODEIDLE·R-ONDEMAND·R-GRAVITON), R-GP2의 etcd 볼륨 표시(AC-KOPS42), P6로 미룬 R-CP-EVEN·R-CP-AZ·R-CP-UNDERSIZE를 추가.
- 3.3 스냅샷: 클러스터 행을 "쿠버네티스 버전·리전·워커 수·마스터 수/타입/AZ 분포/구매 옵션·컨트롤 플레인 구성요소 요약·플랫폼(kops)"으로 교체. 노드 행에 **`role`** 추가 + 노드그룹이 kOps InstanceGroup 이름(원문)임을 명시.
- 3.4 제외 목록: 노드 이름 가명 규칙에 **인스턴스 ID 형태(`i-0…`)** 추가(AC-KOPS44). 왜 필요한지(F10, 3.4의 "인스턴스 ID 항상 제외"와의 정합)를 같은 줄에 적었다.
- 3.5 제안 구조: 실행 방법에 `kops` 명령 허용을 명시하고, **Q5 규칙 블록**(`--yes` 없는 형태만 + 미실행 경고 항상 + 실행 버튼 없음)과 결과 정리 단계 검증 한 줄(`--yes`가 붙은 명령 처리)을 추가.

**(4) `k8s-snapshot.md`** — 충돌표 1행(U6 대상 환경·access entry·`eks:` 접두어) 반영
- 문서 머리에 갱신 안내.
- U6: 대상 환경을 kOps로 바꾸고, kOps 설계도(S3 state store)는 이 CLI가 담지 않으며 `deploy/kops-snapshot/`은 **다음 범위**(Q8)임을 하위 불릿으로 기록.
- 1절 "누가": EKS 운영자 → kOps 클러스터 운영자.
- 3.2 권한: "EKS access entry(또는 aws-auth)로 IAM 주체 연결" → **ClusterRole + 사람 사용자/그룹(또는 전용 SA)에 대한 ClusterRoleBinding**. 그리고 **admin kubeconfig(`kops export kubeconfig --admin`) 사용 금지** 한 줄 추가.
- 3.3: `cluster.name` 설명에서 EKS 제거 + FQDN 안내, `cluster.serverVersion` 예시에서 `-eks-…` 접미어 제거.
- 3.4: `eks:` 접두어 제외 규칙은 **남기고** "EKS 잔재 — kOps에는 매칭되는 객체 없음. 다음 정리 때 삭제"를 괄호로 표시(충돌표 방침 그대로). "쿠버네티스·EKS가 자동으로 만든 객체" → "쿠버네티스·애드온이…"로 일반화하고 kOps 애드온을 예로 들었다.
- 3.5: 시스템 네임스페이스 기본값에서 `amazon-cloudwatch` 제거, "EKS 애드온" 문구를 kOps 애드온·미러 파드로 교체.
- 4.6 예시 문자열 `staging-eks` → `staging.k8s.example.com`.
- 7절 범위 밖: "EKS에 배포된 대시보드" → "클러스터에 배포된 대시보드", kOps 설계도 스냅샷이 다음 범위임을 한 줄 추가.

**(5) `aws-snapshot-manager.md`** — 충돌표 1행(문구 일반화만, 동작 불변)
- 문서 머리에 "동작은 달라지지 않는다"는 갱신 안내.
- A5 / 3.11 / 6절 / 7절 백엔드 항목의 "EKS 배포"를 "클러스터에 배포"로 일반화.
- S2 예시 라벨 "EKS 1.30 업그레이드 전" → "쿠버네티스 1.30 업그레이드 전".

**(6) `snapshot-3d.md`** — 충돌표 1행(2~4단계는 고치지 않고 메모만) + Q9 이름 변경
- 문서 머리 "2~4단계 보류" 불릿 아래에 **메모**를 추가: `AWS::EKS::*` 전제가 무효라는 사실, kOps에서는 ASG + Launch Template + EC2 + NLB로만 나타난다는 점, 다시 설계할 때 손봐야 할 절(3.2 컴퓨트 층·A3·A4·A9, 3.4 짝 규칙·X4·X5, 5.3~5.5), 1단계는 무관하다는 점.
- 3.2·3.4 절 머리의 "보류" 인용 블록에 같은 취지의 한 줄을 각각 덧붙여, 그 절을 읽는 사람이 머리 메모를 못 보고 지나치지 않게 했다. 규칙 본문·AC 본문은 **고치지 않았다.**
- 1절 "누가": EKS 운영자 → kOps 클러스터 운영자. 가정 A5의 "EKS 클러스터가 여러 개" → "클러스터가 여러 개"(+ 메모 참조).
- Q9 이름 변경: `prod-eks` → `prod.k8s.example.com`(7곳), `staging-eks` → `staging.k8s.example.com`(2곳).

**(7) 최종 확인**
- `docs/specs/` 전체에서 `EKS|eks`, `prod-eks|staging-eks|bench-eks`, `amazon-cloudwatch|Fargate|Karpenter|IRSA|access entry|aws-auth`를 재검색해 남은 건을 한 줄씩 판정했다(6절 표).
- 클러스터 ID 일치 확인: `k8s-snapshot` 4.6의 "다른 클러스터" 예시와 `snapshot-3d` mock K-9이 **둘 다 `staging.k8s.example.com`**, `snapshot-3d` 시간축·A-1·AC-3D51은 **모두 `prod.k8s.example.com`**으로 맞았다.

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/specs/cluster-status.md` | 수정 | 머리 갱신 안내, 가정 A1·A3·A6, 1절 "누가", S1 카드 목록, 3.1 노드 수(워커 기준), 3.2 역할 분리·노드그룹·Q6 경고·전체 장애 판정, 3.6 워커 합계·미설치 경로, 7절 디자인 카드 6개 |
| `docs/specs/aws-cost.md` | 수정 | 머리 갱신 안내, 가정 C3, 3.1 표(컨트롤 플레인 행 교체 + 워커 한정 + 중복 금지) 및 전환 안내 문구, 3.2 배분 규칙 1·6, 3.8 한계(Fargate 삭제, Route53·state store S3 추가), 4절 리소스 목록 |
| `docs/specs/architecture-advisor.md` | 수정 | 머리 갱신 안내, 3.2 R-EKSVER 삭제·R-CP-* 3건 추가·부가 규칙 불릿 6줄, 3.3 클러스터·노드 영역, 3.4 노드 이름 가명 규칙, 3.5 실행 방법·Q5 규칙 블록·검증 한 줄 |
| `docs/specs/k8s-snapshot.md` | 수정 | 머리 갱신 안내, U6, 1절 "누가", 3.2 권한·admin kubeconfig 금지, 3.3 클러스터 이름·서버 버전, 3.4 `eks:` 잔재 표시·자동 생성 객체, 3.5 시스템 네임스페이스, 4.6 예시 이름, 7절 범위 밖 2줄 |
| `docs/specs/aws-snapshot-manager.md` | 수정 | 머리 갱신 안내, A5·3.11·6절·7절 "EKS 배포" 문구 일반화, S2 예시 라벨 |
| `docs/specs/snapshot-3d.md` | 수정 | 머리 메모(2~4단계 재설계 필요), 3.2·3.4 보류 블록에 같은 취지 한 줄, 1절 "누가", 가정 A5, mock 클러스터 이름 9곳 |
| `docs/reports/kops-support/planner.md` | 수정 | 이 섹션 추가(이전 기록 유지) |

- `docs/specs/kops-support.md`는 **고치지 않았다**(충돌표에서 틀린 곳을 찾지 못했다).
- `docs/specs/` 밖(`docs/api/`, `docs/design/`, `docs/db/`, 코드, `CLAUDE.md`)은 전혀 건드리지 않았다.

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 선택 이유 |
|---|---|---|---|
| 1 | 고친 문장 옆에 **"2026-09-24 변경 — 이전은 …"**을 괄호로 남김 | 조용히 덮어쓰기 | 이미 구현·검증이 끝난 명세다. 무엇이 왜 바뀌었는지 문장 옆에 있어야 구현자가 "예전 동작이 맞는데 문서가 틀렸나" 하고 되묻지 않는다 |
| 2 | 각 문서 머리에 **갱신 안내 + "다르면 kops-support가 우선"** 한 줄 | 본문만 수정 | 여섯 문서에 흩어진 변경을 한곳에서 가리키는 지점이 필요하다. 이후 kOps 관련 상세가 늘어도 `kops-support`만 고치면 된다 |
| 3 | 컨트롤 플레인의 **상세 기준을 기존 명세로 옮기지 않고** 포인터만 남김 | `cluster-status`에 3.2를 통째로 옮겨 적기 | 같은 기준을 두 문서에 적으면 다음 수정 때 반드시 어긋난다. `cluster-status`에는 "무엇이 워커 기준으로 바뀌는가"만 적고 판단 기준은 `kops-support` 3.2 한 곳에 둔다 |
| 4 | 기존 AC/규칙 ID를 **재배치하지 않고 뒤에 덧붙임** | 카테고리별로 정렬 | PM 제약. R-CP-*는 R-GRAVITON 뒤에, cluster-status의 체크리스트는 순서 유지 |
| 5 | `k8s-snapshot`의 `eks:` 접두어 제외 규칙을 **삭제하지 않고 "EKS 잔재" 표시** | 즉시 삭제 | 충돌표 방침 그대로. 매칭되는 객체가 없어 무해하고, 지우면 EKS 클러스터 스냅샷을 가진 사람이 갑자기 시스템 객체를 잔뜩 받게 된다. 다음 정리 때 삭제 |
| 6 | `snapshot-3d` 2~4단계는 **이름만 바꾸고 규칙·AC는 손대지 않음** | 지금 ASG 기준으로 재설계 | PM 제약(보류 단계). 다만 클러스터 이름은 드리프트·짝 맞추기에서 **문서 간 일치해야 하는 식별자**라 Q9 범위로 보고 함께 바꿨다. 결과적으로 `EKS 클러스터 prod.k8s.example.com`처럼 어색한 문장이 남지만, 그 절은 "보류 + 재설계 필요" 표시가 붙어 있다 |
| 7 | Q5(어드바이저 `kops` 명령 허용)를 **`architecture-advisor` 3.5**에 기록 | `kops-support`에 추가 | `kops-support.md`는 이번에 고치지 않기로 했고, "제안 구조(실행 방법)"를 정의하는 곳이 `architecture-advisor` 3.5다. 규칙이 쓰이는 자리에 둔다 |
| 8 | Q6(마스터 워크로드 경고)를 **`cluster-status` 3.2**에 한 줄로 기록 | 기록하지 않음 | 결정이 났는데 어느 명세에도 없으면 구현자가 다시 묻는다. 동작을 바꾸지 않는 "경고 한 줄" 수준이라 노드 절이 적절하다 |
| 9 | metrics-server 안내 문구에 **클러스터 변경 명령을 넣지 않는** 기존 규칙 유지 | Q5 결정을 안내 문구에도 확대 적용 | Q5는 "어드바이저 제안의 실행 예시"에 한정된 결정이다. `kops-support` 3.4는 안내 문구에 `kops edit`/`kops update`를 넣지 않기로 이미 정했고, 이번에 뒤집을 근거가 없다 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `Grep "EKS\|eks"` — `docs/specs/**` (kops-support 제외) | 남은 건 전부 **의도한 것**으로 판정 | 아래 표 참고 |
| `Grep "prod-eks\|staging-eks\|bench-eks"` — `docs/specs/**` | `kops-support.md`의 변경 이력·Q9 설명에만 남음(과거 기록) | 그 밖의 예시는 0건 |
| `Grep "amazon-cloudwatch\|Fargate\|Karpenter\|IRSA\|access entry\|aws-auth"` — `docs/specs/**` | 남은 4건 모두 "이전은 …였다" 형태의 변경 이력 | 동작 기술로 남은 것 없음 |
| 클러스터 ID 문서 간 일치 확인(`k8s-snapshot` 4.6 ↔ `snapshot-3d` K-9 / 시간축 ↔ A-1 ↔ AC-3D51) | 일치 | `staging.k8s.example.com`, `prod.k8s.example.com` |
| 9절 충돌표 11행 대조 | 11행 중 **10행 반영, 1행은 "고치지 않는다"가 방침**(snapshot-3d 2~4단계 — 메모만) | `common.md` 행은 "충돌 없음"이라 조치 없음 → 실질 10행 중 10행 처리 |
| lint / test | **실행하지 않음** | 문서만 수정. 코드·설정 변경 없음 |

**남은 `EKS`/`eks` 판정** (의도적으로 남긴 것)

| 위치 | 남은 이유 |
|---|---|
| 각 문서 머리의 "갱신: 2026-09-24" 안내, 본문 괄호의 "이전은 …였다" | **변경 이력**. 무엇이 바뀌었는지 알리기 위해 일부러 남김 |
| `k8s-snapshot.md` 3.4 `eks:` 접두어 | "**EKS 잔재 — 다음 정리 때 삭제**" 표시를 붙여 남김(충돌표 방침) |
| `k8s-snapshot.md` 3.3 "`-eks-…` 접미어가 붙지 않는다" | kOps 서버 버전 설명을 위한 대조 |
| `snapshot-3d.md` 9(관련 문서)·17(U1 사용자 원문)·167·185·195·226·230·232·241·242·347·456·460·478 | **2~4단계 보류 구간**. 머리 메모 + 3.2·3.4 절 머리 표시로 "재설계 필요"를 명시하고 본문은 고치지 않음(PM 지시 3) |
| `aws-cost.md` 3.1 전환 안내 문구 "EKS 같은 컨트롤 플레인 관리 요금이 없습니다" | 화면에 그대로 나갈 **사용자 안내 문구**(AC-KOPS35). EKS와의 대조가 문구의 목적 |

### 7. 남은 이슈·한계

- **`snapshot-3d` 2~4단계는 여전히 EKS 전제로 남아 있다.** 이번에 고치지 않은 것은 PM 지시대로다. 그 단계를 시작하는 시점에 3.2 컴퓨트 층·관계 A3·A4·A9, 3.4 짝 규칙 1·X4·X5, 5.3~5.5의 AC(AC-3D34~56)를 ASG/Launch Template 기준으로 **다시 써야 한다.** 이 작업을 하지 않고 착수하면 mock 예시 A-1(`AWS::EKS::Cluster` 포함)부터 만들 수 없다.
- **`snapshot-3d` 2~4단계 본문에 `prod.k8s.example.com`과 `EKS 클러스터`가 한 문장에 남았다.** 이름만 바꾸고 타입은 그대로 뒀기 때문이다(결정 6). 재설계 때 함께 정리된다.
- **`docs/specs/` 밖은 아직 EKS 그대로다.** `docs/api/`(약 40곳), `docs/design/`(약 25곳), `docs/db/`, 코드 픽스처, `.env.example`·`docker-compose.yml`·`deploy/`가 남아 있다(명세 10.2~10.7). 명세와 계약이 어긋난 상태이므로 **다음 단계에서 각 담당이 반드시 처리해야 한다.**
- **`snapshot-3d` mock 노드그룹 이름(`ng-general`·`ng-spot`)은 손대지 않았다.** kOps InstanceGroup 이름은 보통 `nodes-ap-northeast-2a` 형태지만(명세 3.3), 이 이름은 cluster mock 인벤토리와 맞춰야 하는 값이고(백엔드가 정한다고 snapshot-3d 5절에 이미 적혀 있다) 2~4단계 구간이라 이번에 바꾸지 않았다.
- **`cluster-status` 5절 수용 기준 체크리스트는 번호가 없다.** AC 재배치 금지 제약에 따라 문구도 바꾸지 않았다(예: "Given metrics-server 없음 / Then CPU·메모리만 알 수 없음"은 A3을 뒤집어도 그대로 성립한다). 컨트롤 플레인 관련 검증은 `kops-support` AC-KOPS로만 한다.

### 8. 다른 담당 요청

- **백엔드 요청**: `docs/api/{cluster-status,aws-cost,architecture-advisor,common,k8s-snapshot,snapshot-3d}.md`의 EKS 잔재와 mock 클러스터 이름을 명세 10.2 표대로 갱신. **이름 규약은 이번에 명세에서 확정한 것과 같게** 맞출 것: `prod-eks` → **`prod.k8s.example.com`**, `staging-eks` → **`staging.k8s.example.com`**, `bench-eks`(`common.md:550` mock `large` 시나리오) → **`bench.k8s.example.com`**. 코드 픽스처(`mock-world.ts`, `fixtures.ts`)도 같은 값이어야 드리프트 짝 맞추기 예시가 성립한다.
- **백엔드 요청**: `architecture-advisor` 3.5에 **Q5 규칙**(어드바이저 실행 예시의 `kops` 명령은 `--yes` 없는 형태만 + 미실행 경고 필수 + 결과 정리 단계에서 `--yes` 검출)을 새로 적었다. 브리지 시스템 프롬프트와 `docs/api/architecture-advisor.md`에 반영 필요.
- **백엔드 요청**: `architecture-advisor` 3.2에 R-CP-HA·R-CP-SPOT·R-CP-RESTART가 정식으로 들어갔고 R-EKSVER 행이 사라졌다. `docs/api/architecture-advisor.md:355`의 `cost` 카테고리 규칙 목록도 함께 고쳐야 한다(R-CP-*는 `안정성`·`안정성·비용` 카테고리).
- **디자이너 요청**: `cluster-status` 7절의 개요 영역 카드가 **6개**로 확정됐다(Q1). `docs/design/cluster-status.md`의 카드 배치와 `docs/design/shell.md:44`의 상단바 예시(긴 FQDN 말줄임)를 갱신해 달라. metrics-server 힌트 문구(`docs/design/cluster-status.md:107`)도 `kops-support` 3.4 문구로.
- **디자이너 요청**: `docs/design/aws-cost.md`의 카테고리 순서·`공용(클러스터)` 툴팁이 `aws-cost` 3.1·3.2-6 개정본과 어긋난다(마지막 자리가 `EKS 컨트롤 플레인` → `컨트롤 플레인`, 공용 행에 마스터 비용 전체 포함).
- **DBA 요청**: 변경 없음(이전 섹션의 `cost_rate_samples` 마이그레이션 요청 그대로 유효).
- **PM 요청**: `docs/specs/` 밖 문서의 EKS 정리를 각 담당에게 배분해 주기 바란다. 지금은 **명세와 API 계약이 어긋난 상태**라 계약을 먼저 보는 구현자가 헷갈릴 수 있다.

### 9. 다음 담당이 알아야 할 점

- **판단 기준의 단일 출처는 `kops-support.md`다.** 고친 여섯 명세에는 "무엇이 워커 기준으로 바뀌는가"와 포인터만 적었고, 컨트롤 플레인 상태 기준·비용 하위 종류·API LB 식별 규칙은 `kops-support` 3.2·3.5에만 있다. 두 문서가 달라 보이면 `kops-support`가 우선한다(각 문서 머리에 명시).
- **mock 클러스터 이름은 이제 `prod.k8s.example.com`이다.** 드리프트 짝 맞추기(`k8s-snapshot` 4.6, `snapshot-3d` 3.4·5.5)는 이 이름이 문서·API·코드에서 **모두 같아야** 성립한다. 한 곳만 바꾸면 AC-3D51·AC-3D52·AC-K35가 깨진다.
- **이번 수정은 동작을 새로 정하지 않았다.** 전부 `kops-support` 9절 충돌표와 PM이 결정한 Q1~Q9의 반영이다. 구현 중 "명세가 이렇게 바뀌었는데 기존 동작과 충돌한다" 싶으면 고치지 말고 PM에게 올려 달라.
- **`cluster-status` 3.2의 상태 기준 표(Ready·압박·사용률 등)는 손대지 않았다.** 마스터에도 같은 기준을 그대로 적용하고, 그 위에 `kops-support` 3.2.1의 컨트롤 플레인 고유 판단(HA·쿼럼·AZ)을 얹는 구조다.
- **`aws-cost` 3.1의 네 카테고리는 이제 워커 전용이다.** 마스터 리소스를 `ec2`·`ebs`·`ipv4`에 남겨 두면 카테고리 합계와 배분 합계가 동시에 틀어진다(AC-KOPS29 + `aws-cost` 5절 "배분 합계 = 소모율 합계").

---

## 2026-09-24 · snapshot-3d mock 노드그룹 이름 맞추기 (후속)

### 1. 요청 내용

PM 요청: 1차 작업 때 "cluster mock 인벤토리와 맞춰야 하는 값이라 손대지 않았다"고 남긴 `docs/specs/snapshot-3d.md`의 mock 노드그룹 이름 `ng-general`·`ng-spot`을, 백엔드가 api mock을 정리하며 확정한 kOps InstanceGroup 이름으로 맞춘다.

확정된 이름 — 워커: `nodes-system`, `nodes-batch`, `nodes-app-arm64` / 마스터: `control-plane-ap-northeast-2a|2b|2c`.
제약: 2~4단계는 여전히 보류이므로 **이름만** 바꾸고 본문 설계(`AWS::EKS::*` 전제)와 재설계 메모는 그대로 둔다. `docs/specs/**` 밖 금지. 바꾼 뒤 클러스터 ID·노드그룹 짝 재확인.

### 2. 참고한 문서

- `docs/specs/snapshot-3d.md` (S3 시나리오, 3.2·3.4 보류 구간, 5.3~5.5 AC, 6절 mock 예시 표)
- `docs/specs/kops-support.md` 3.3(노드그룹 = kOps InstanceGroup), 시나리오 S3
- 이 보고서의 2026-09-24 1차·2차 섹션

### 3. 작업 내용

1. `docs/specs/` 전체에서 `ng-general|ng-spot`을 검색했다. **`snapshot-3d.md:65` 한 줄에만** 있었다(S3 "AWS 배치 확인(2단계)" 시나리오).
2. 문맥 판단: 같은 시나리오의 다음 줄이 "노드그룹이 **한 AZ에만** 있다"를 알아채는 장면이다. 즉 `ng-general`은 2a·2b에 퍼진 일반 그룹, `ng-spot`은 2c 한 곳에만 있는 스팟 그룹이다.
   - `ng-general`(2a·2b) → **`nodes-system`**
   - `ng-spot`(2c only) → **`nodes-batch`** (PM 힌트대로 스팟 예시 자리)
   - `nodes-app-arm64`는 이 시나리오에 등장할 자리가 없어 쓰지 않았다(그룹 2개짜리 예시).
3. 바뀐 줄에 "(2026-09-24: 이름을 api mock의 kOps InstanceGroup 이름에 맞췄다. 이전 예시는 `ng-general`·`ng-spot`이었다.)" 이력 괄호를 덧붙였다.
4. 6절 mock 예시 A-1은 "노드그룹 2개(이름·AZ는 cluster mock 노드그룹과 같게)"로 **이름을 직접 쓰지 않는다.** 이미 cluster mock을 가리키고 있어 고칠 것이 없다(A-2도 "노드그룹 1개"로만 적혀 있다).
5. 본문 설계(3.2 컴퓨트 층의 `AWS::EKS::*`, 3.4 짝 규칙·X4·X5), 보류 표시, 재설계 메모, AC-3D34~56은 **손대지 않았다.**
6. 재검색으로 짝 확인(6절).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/specs/snapshot-3d.md` | 수정 | S3 시나리오(65행) 노드그룹 이름 `ng-general`·`ng-spot` → `nodes-system`·`nodes-batch`(스팟) + 변경 이력 괄호 |
| `docs/reports/kops-support/planner.md` | 수정 | 이 섹션 추가(이전 기록 유지) |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 선택 이유 |
|---|---|---|---|
| 1 | `ng-spot` 자리에 `nodes-batch` | `nodes-app-arm64` | PM 힌트이자 문맥에 맞다. 배치 작업은 중단 허용이라 스팟 예시로 자연스럽고, `nodes-app-arm64`는 아키텍처를 가리키는 이름이라 "스팟이라서 한 AZ"라는 시나리오 의도를 흐린다 |
| 2 | `ng-general` 자리에 `nodes-system` | `nodes-app-arm64` | "여러 AZ에 퍼져 있는 기본 그룹" 역할에 가장 가깝다 |
| 3 | 이름만 바꾸고 `EKS 클러스터`·`AWS::EKS::*`는 그대로 | 함께 정리 | PM 제약(2~4단계 보류). 재설계 메모가 이미 이 구간을 덮고 있다 |
| 4 | 변경 이력 괄호를 남김 | 조용히 교체 | 1차 작업과 같은 규칙. 예시 이름이 왜 바뀌었는지(api mock 확정) 한 줄로 남긴다 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| `Grep "ng-general\|ng-spot"` — `docs/specs/**` | **0건** | 교체 완료 |
| `Grep "nodes-system\|nodes-batch\|nodes-app-arm64\|spot-batch\|nodes-ap-northeast\|control-plane-ap-northeast"` — `docs/specs/**` | 3건 | `snapshot-3d:65`(새 이름), `kops-support:111`·`:387`(아래 7절 참고) |
| `Grep "prod\.k8s\.example\.com\|staging\.k8s\.example\.com"` — `docs/specs/**` | kops-support 4 · k8s-snapshot 2 · snapshot-3d 10 | 1차 작업 직후와 **동일**. 클러스터 ID 짝(k8s-snapshot 4.6 ↔ snapshot-3d K-9 = `staging…`, 시간축·A-1·AC-3D51 = `prod…`)이 그대로 유지됐다 |
| lint / test | **실행하지 않음** | 문서 한 줄 수정. 코드 변경 없음 |

### 7. 남은 이슈·한계

- **`kops-support.md`의 예시 노드그룹 이름은 확정 이름과 다르다.** `:111`(S3 시나리오)은 `control-plane-ap-northeast-2a`·`nodes-ap-northeast-2a`·`spot-batch`, `:387`(AC-KOPS03)은 `nodes-ap-northeast-2a`를 쓴다. 둘 다 "kOps InstanceGroup은 이런 모양이다"를 보여주는 **설명용 예시**이고 mock 픽스처와 짝을 맞추는 값이 아니라 동작에는 문제가 없다. 다만 AC-KOPS03은 수용 기준이라 백엔드가 mock으로 검증할 때 `nodes-system` 같은 실제 이름으로 읽어야 한다. `kops-support.md`는 이번 지시 범위 밖이라 고치지 않았다 — **PM이 정리를 원하면 알려 주기 바란다.**
- `nodes-app-arm64`와 마스터 InstanceGroup 3개는 `docs/specs/` 안 어디에도 예시로 등장하지 않는다(필요한 자리가 없었다).
- `snapshot-3d` 2~4단계의 `AWS::EKS::*` 전제와 재설계 메모는 1차 작업 상태 그대로다.

### 8. 다른 담당 요청

- **백엔드 요청**: AC-KOPS03의 예시 라벨(`kops.k8s.io/instancegroup=nodes-ap-northeast-2a`)과 확정 mock 이름(`nodes-system` 등)이 다르다. 계약(`docs/api/cluster-status.md`)과 mock에는 **확정 이름**을 쓰고, 수용 기준은 그 값으로 읽어 달라.
- **디자이너 요청**: `docs/design/` 쪽에 `ng-general`·`ng-spot` 예시가 남아 있으면 같은 이름으로 맞춰 달라(내 쓰기 영역이 아니라 확인하지 않았다).

### 9. 다음 담당이 알아야 할 점

- `docs/specs/` 안의 mock 노드그룹 예시는 이제 `nodes-system`·`nodes-batch` 두 개뿐이다(`snapshot-3d` S3). 3D 2~4단계를 시작할 때 A-1 예시를 만들면 이 이름과 cluster mock을 함께 맞춰야 한다.
- 클러스터 이름 규약은 1차 작업과 동일하다: `prod.k8s.example.com` / `staging.k8s.example.com` / `bench.k8s.example.com`.

---

## 2026-09-24 · AC-KOPS03 예시 값을 확정 mock 이름으로 (검증 가능하게)

### 1. 요청 내용

PM 요청: 검증 단계에서 AC-KOPS01~46을 mock으로 하나씩 확인할 예정인데, **수용 기준의 예시 값이 실제 mock과 다르면 검증이 막힌다.** `docs/specs/kops-support.md`의 `:387`(AC-KOPS03)과 `:111`(S3 시나리오)의 노드그룹 이름을 확정 mock 이름으로 맞추고, AC-KOPS03 문장에서 **"이름은 예시이고 판정 대상은 라벨 키"**가 읽히게 한다. 뒷부분(EKS·Karpenter 라벨 → `null`, 하위 호환 없음)은 유지. AC 번호 재배치 금지. 다른 AC에도 같은 문제가 있는지 확인. 짝 재확인. 보고서 새 섹션 추가.

이번 요청으로 `docs/specs/kops-support.md` 자체를 고치는 것이 처음 허용됐다(이전 두 섹션에서는 "고치지 않는다"가 제약이었다).

### 2. 참고한 문서

- `docs/specs/kops-support.md` 2절 S3, 3.3, 5절 AC-KOPS01~46 전수
- 이 보고서의 앞 세 섹션(확정 이름 규약)

### 3. 작업 내용

1. **AC-KOPS03(`:387`) 재작성.** 판정 규칙을 문장 앞으로 올렸다: "노드그룹 판정의 근거는 **라벨 키 `kops.k8s.io/instancegroup` 하나뿐**이고, 라벨 **값(이름)은 그대로 통과**시킨다." Given 절의 하드코딩 이름을 `kops.k8s.io/instancegroup=<이름>`으로 일반화하고, 확정 mock 이름은 **괄호 안 "mock 기준 확인 값"**으로 옮겼다(워커 `nodes-system`·`nodes-batch`·`nodes-app-arm64`, 마스터 `control-plane-ap-northeast-2a|2b|2c`). 괄호 안에 "**이름은 mock 예시일 뿐이고 판정 대상은 라벨 키다 — mock 이름이 바뀌면 이 괄호만 바꾼다**"를 명시해 다음에 mock 이름이 또 바뀌어도 어디를 고칠지 문장이 스스로 알려 주게 했다.
2. **뒷부분 유지.** "Given EKS·Karpenter 라벨만 있는 노드 / Then 노드그룹은 `null`이다(하위 호환을 두지 않는다)"는 손대지 않았다.
3. **S3 시나리오(`:111`)**: `control-plane-ap-northeast-2a`, `nodes-ap-northeast-2a`, `spot-batch` → `control-plane-ap-northeast-2a`, **`nodes-system`**, **`nodes-batch`**. 마스터 IG 이름은 이미 확정 규약과 같아 그대로 뒀다.
4. **AC-KOPS01~46 전수 훑기**(6절 표 참고). 같은 문제(수용 기준이 mock 값을 하드코딩)는 **AC-KOPS03 하나뿐**이었다.
5. AC 번호·순서·개수는 바꾸지 않았다(AC-KOPS03 한 줄 안에서 문장만 수정).

### 4. 변경 파일

| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/specs/kops-support.md` | 수정 | AC-KOPS03(`:387`) 문장 재작성(판정 대상 = 라벨 키 명시 + mock 이름은 괄호로), S3 시나리오(`:111`) 노드그룹 이름 |
| `docs/reports/kops-support/planner.md` | 수정 | 이 섹션 추가(이전 기록 유지) |

### 5. 주요 결정과 이유

| # | 결정 | 검토한 대안 | 선택 이유 |
|---|---|---|---|
| 1 | Given 절은 `=<이름>`으로 일반화하고 mock 이름은 **괄호("mock 기준 확인 값")**로 분리 | Given 절 이름만 `nodes-system`으로 교체 | 이름을 Given 절에 그대로 박으면 mock이 바뀔 때마다 **수용 기준의 의미**가 흔들린다. 판정 규칙(라벨 키)과 검증 데이터(mock 이름)를 문장에서 분리하면, 다음에 이름이 바뀌어도 괄호만 고치면 된다 |
| 2 | 그래도 mock 이름을 **명시**(생략하지 않음) | "mock에 있는 이름으로 확인한다"로만 서술 | PM 목적이 "그대로 실행해 확인 가능한 수용 기준"이다. 이름이 없으면 검증자가 다시 코드를 뒤져야 한다 |
| 3 | 마스터 IG 이름도 괄호에 포함 | 워커만 적기 | AC-KOPS11(`role=control_plane`)·AC-KOPS19 검증 때 마스터 노드그룹 이름을 같이 보게 된다. 한 곳에 모아 두는 편이 낫다 |
| 4 | S3의 마스터 이름 `control-plane-ap-northeast-2a`는 그대로 | 3개 모두 나열 | 이미 확정 규약과 같고, 시나리오는 "이런 이름이 보인다"는 예시라 하나면 충분하다 |
| 5 | 3.3의 "컨트롤 플레인 InstanceGroup(보통 `control-plane-<az>`)"은 그대로 | 확정 이름으로 교체 | 수용 기준이 아니라 **일반 규칙 설명**이고, `<az>` 자리 표시가 확정 이름(`control-plane-ap-northeast-2a`)과 정확히 들어맞는다 |

### 6. 검증 결과

| 명령/방법 | 결과 | 비고 |
|---|---|---|
| AC-KOPS01~46 전수 확인(mock 값 하드코딩 여부) | **AC-KOPS03 1건만 해당 → 수정 완료** | 아래 판정 표 |
| `Grep "ng-general\|ng-spot\|spot-batch\|nodes-ap-northeast"` — `docs/specs/**` | **0건** | 구 이름 완전 제거 |
| `Grep "nodes-system\|nodes-batch\|nodes-app-arm64\|control-plane-ap-northeast"` — `docs/specs/**` | 3곳(`snapshot-3d:65`, `kops-support:111`, `kops-support:387`) 모두 확정 이름 | 서로 일관 |
| `Grep "prod-eks\|staging-eks\|bench-eks"` — `docs/specs/**` | `kops-support.md` 9건(이력·10절 영향 범위 표)만 | 1차 작업과 동일 |
| `Grep "prod\.k8s\.example\.com\|staging\.k8s\.example\.com"` — `docs/specs/**` | snapshot-3d 10 · k8s-snapshot 2 · kops-support 해당 줄 | 1차 작업 직후와 **동일**. 클러스터 ID 짝(k8s-snapshot 4.6 ↔ snapshot-3d K-9, 시간축 ↔ A-1 ↔ AC-3D51) 유지 |
| lint / test | **실행하지 않음** | 문서 2줄 수정 |

**AC 전수 판정 — mock 값이 박혀 있어 검증이 막힐 수 있는 것**

| AC | 들어 있는 구체 값 | 판정 |
|---|---|---|
| AC-KOPS03 | 노드그룹 이름 | **문제 → 수정함** |
| AC-KOPS10 | 마스터 3대 + 워커 6대, `6/6`, `컨트롤 플레인 3/3` | 문제 없음. 현재 mock이 워커 6대이고 마스터 3대를 추가하는 것이 명세 7절 지시다. 숫자가 아니라 **합산되지 않는다**는 것이 판정 대상이고 문장에 그렇게 적혀 있다 |
| AC-KOPS18·19·21·28 | 마스터 3대, 구성요소 15/15, etcd 볼륨 6개 | 문제 없음. 전부 "마스터 3대"에서 파생되는 값이고 서로 일관(3×5=15, 3×2=6) |
| AC-KOPS19 | 구성요소 5종 이름(`kube-apiserver` 등) | 문제 없음. mock 값이 아니라 **kOps가 실제로 만드는 static pod 이름**(F5). 판정 대상 자체 |
| AC-KOPS25 | mock 시나리오 ID 6개(`cp-healthy` 등) | **명세가 정하는 이름**이고 백엔드가 그대로 구현한다. 지금 어긋난다는 정보는 없다. 백엔드가 다른 ID를 썼다면 그때 명세를 맞춰야 한다(아래 8절) |
| AC-KOPS09·27·28·32·34 | 설정 기본값·카테고리·열 이름·AWS 호출 목록 | 문제 없음. mock 데이터가 아니라 **계약·설정 값** 자체 |
| AC-KOPS05·06·33·36·37 | 환경 변수·파일 경로·명령 | 문제 없음 |
| 나머지 | 구체 리소스 이름 없음 | 문제 없음 |

### 7. 남은 이슈·한계

- **AC-KOPS25의 mock 시나리오 ID 6개**(`cp-healthy`, `cp-single`, `cp-node-down`, `cp-quorum-lost`, `cp-component-crash`, `cp-not-found`)는 아직 구현 전이라 실제 mock과 대조하지 못했다. 백엔드가 다른 ID로 만들면 같은 문제가 재발한다 — 구현 시 이 ID를 그대로 쓰거나, 바꾼다면 PM을 통해 명세도 함께 고쳐야 한다.
- **AC-KOPS10의 "워커 6대"**는 현재 mock 기준이다. 백엔드가 mock 워커 수를 바꾸면 `6/6` 숫자가 어긋난다(판정 의미는 "합산되지 않는다"라 바뀌지 않지만, 검증자가 한 번 멈춘다).
- `docs/api/`·`docs/design/`·코드 픽스처에 `ng-general`·`ng-spot`·`nodes-ap-northeast-2a`가 남아 있을 수 있으나 **내 쓰기 영역이 아니라 확인하지 않았다.**

### 8. 다른 담당 요청

- **백엔드 요청**: AC-KOPS25의 mock 시나리오 ID 6개를 명세에 적힌 그대로 구현해 달라. 다른 이름을 써야 하면 PM을 통해 알려 주면 명세를 맞추겠다. mock 워커 수(현재 6대)를 바꿀 때도 마찬가지다(AC-KOPS10).
- **백엔드 요청**: `docs/api/cluster-status.md`의 노드그룹 예시 값도 확정 이름(`nodes-system` 등)으로 맞춰 달라.
- **디자이너 요청**: `docs/design/`에 `ng-general`·`ng-spot`·`nodes-ap-northeast-2a` 예시가 남아 있으면 같은 이름으로.

### 9. 다음 담당이 알아야 할 점

- **AC-KOPS03의 판정 대상은 라벨 키 `kops.k8s.io/instancegroup`이다.** 이름은 mock 예시일 뿐이고, 괄호 안 값이 mock과 다르면 **괄호만** 고치면 된다(수용 기준의 의미는 바뀌지 않는다).
- `docs/specs/` 안의 kOps InstanceGroup 예시 이름은 이제 세 곳뿐이고 모두 같은 규약이다: `kops-support:111`(S3), `kops-support:387`(AC-KOPS03), `snapshot-3d:65`(3D 2단계 시나리오).
- 클러스터 이름 규약은 그대로: `prod.k8s.example.com` / `staging.k8s.example.com` / `bench.k8s.example.com`.
