# 기능 명세: k8s-snapshot (쿠버네티스 매니페스트 스냅샷 + 드리프트 비교)

- 작성: planner, 2026-09-19
- 상태: 초안 (열린 질문 없음. Q1~Q4 결정됨 2026-09-19, 사용자: 모두 권장안)
- 관련 문서: `CLAUDE.md`(조회 전용·RBAC 목록·비밀값 규칙·기능 4 결정), `docs/specs/aws-snapshot-manager.md`(이하 **ASM**. 목록·상세·편집·휴지통 규칙의 원본), `docs/api/aws-snapshot-manager.md`(이하 **ASM-API**), `docs/design/aws-snapshot-manager.md`, `deploy/aws-snapshot/README.md`·`lib/*.mjs`(CLI 패턴 원본), `deploy/rbac.yaml`(대시보드 RBAC), `docs/specs/cluster-status.md`, `docs/api/common.md`
- **갱신: 2026-09-24 (kops-support).** 대상 환경이 EKS → kOps로 바뀌면서 U6(대상 환경), 3.2(권한 연결 방법), 3.3(클러스터 이름·서버 버전 예시), 3.4·3.5(자동 생성 객체·시스템 네임스페이스 기본값), 7절 문구가 수정됐다. 근거는 **`docs/specs/kops-support.md` 9절**.
- 이 기능은 세 부분이다.
  1. **CLI** `deploy/k8s-snapshot/`: 사람이 별도 kubeconfig 컨텍스트로 네임스페이스별 리소스를 YAML로 내보낸다(대시보드 밖 도구, `deploy/aws-snapshot`과 같은 성격).
  2. **스냅샷 관리 화면**: 기존 "AWS 스냅샷" 메뉴를 "스냅샷"으로 넓혀 AWS / Kubernetes 탭. Kubernetes 탭의 목록·상세·편집·휴지통은 ASM 규칙을 그대로 쓴다.
  3. **드리프트**: 저장된 k8s 스냅샷과 현재 클러스터를 대시보드의 **기존 읽기 전용 RBAC 범위 안에서** 비교한다.

## 0. 사용자 확정 사항과 가정

### 0.1 사용자 확정 (2026-09-19, PM 전달)
- U1. CLI `deploy/k8s-snapshot/`: 사람용 별도 kubeconfig/컨텍스트(대시보드 RBAC와 분리)로 네임스페이스별 리소스를 YAML로 내보낸다. 런타임 필드 제거, **Secret 값 제외**, 비밀값 스캔. `deploy/aws-snapshot` CLI 패턴(설정 파일·dry-run·종료코드·metadata.json·스캐너 lib) 재사용.
- U2. 대시보드: "AWS 스냅샷" 메뉴를 "스냅샷"으로 넓혀 AWS / Kubernetes 탭. k8s 스냅샷의 목록·상세·편집·휴지통은 ASM과 같은 규칙(라벨·메모 폴더 안 별도 파일, 휴지통 복원/영구 삭제, 스캔 오류 남으면 재확인 후 저장 + "커밋 금지", 원본 직접 편집).
- U3. 드리프트: 저장된 k8s 스냅샷 vs 현재 클러스터. 대시보드의 기존 읽기 전용 RBAC 범위 안에서만 비교, RBAC 밖 종류는 "비교 불가". 추가/삭제/변경 리소스와 필드 단위 diff. 기본값 필드로 인한 가짜 차이를 줄이는 방법 포함.
- U4. 대시보드는 클러스터·AWS에 쓰지 않는다. 적용 버튼 없음(사용자가 직접 `kubectl apply`), 내보내기 버튼 없음(CLI만). **대시보드 RBAC는 늘리지 않는 것이 기본 전제**.
- U5. mock 모드: 예시 k8s 스냅샷과 예시 드리프트.
- U6. 대상 환경: **kOps 클러스터**(EC2 컨트롤 플레인) + 클러스터 안 Postgres StatefulSet. Postgres 데이터·PV 데이터 백업은 범위 밖(안내만). (2026-09-24 변경 — 이전은 "EKS + 클러스터 안 Postgres StatefulSet", `kops-support` 9절.)
  - kOps 클러스터의 **설계도**(S3 state store의 `Cluster`·`InstanceGroup` 객체)는 이 CLI가 담지 않는다. 그 층은 `deploy/kops-snapshot/`로 예약돼 있고 **다음 범위**다(`kops-support` 8절). 스냅샷 메뉴가 나중에 탭을 하나 더 받을 수 있다.
- U7. 사용자가 운영 매니페스트를 git으로 관리하는지 모른다 → 스냅샷이 형상관리 출발점이 될 수 있다.

### 0.2 가정 (다르면 수정)
- A1~A5는 ASM 0.2와 같다(로컬 운영자 1명, CLI가 형식 기준, 스캐너 규칙 한 벌, 폴더 이름 UTC, 사실상 로컬 실행 전용). 단 A2의 "CLI"는 `deploy/k8s-snapshot`이다.
- A6. 스냅샷 하나는 **클러스터 하나**의 내용이다. 여러 클러스터의 스냅샷이 같은 스냅샷 루트에 섞일 수 있고, 어느 클러스터 것인지는 `metadata.json`으로 구분한다(3.3).
- A7. 대시보드가 보는 클러스터는 하나다(api의 kubeconfig/컨텍스트 하나, `cluster-status`와 같음). 다른 클러스터의 스냅샷은 드리프트를 계산하지 않는다(4.6).

## 1. 배경 / 목표

- **누가**: kOps 클러스터 운영자. 클러스터 안 워크로드(Postgres StatefulSet 포함)의 설정을 기록·복원하고 싶은 사람.
- **왜**
  - `deploy/aws-snapshot`(Former2)은 AWS 설정만 담고 쿠버네티스 리소스는 담지 못한다(README 8장). 클러스터를 다시 만들거나 설정이 틀어졌을 때 "그때 클러스터 안이 어땠는지" 기록이 없다.
  - 운영 매니페스트를 git으로 관리하는지 모른다(U7). `kubectl edit`·`kubectl scale`·Helm 업그레이드로 클러스터가 기록과 달라져도 알 방법이 없다.
  - `kubectl get -o yaml` 원문은 status·managedFields·resourceVersion 등 런타임 필드가 섞여 그대로 다시 적용할 수 없고, git에 넣으면 diff가 잡음으로 가득 찬다.
- **목표**
  1. 사람이 명령 한 번으로 클러스터 리소스를 **다시 적용할 수 있는 모양의 YAML**로 내보낸다. Secret 값은 담지 않고, 비밀값 의심은 커밋 전에 잡는다.
  2. 대시보드에서 AWS 스냅샷과 같은 방식으로 k8s 스냅샷을 보고·기록하고·정리한다.
  3. 저장된 스냅샷과 지금 클러스터가 **무엇이 다른지**(추가·삭제·변경, 필드 단위)를 기본값 잡음 없이 본다.
  4. 이 모든 과정에서 대시보드는 클러스터·AWS에 쓰지 않고, 대시보드 RBAC를 늘리지 않는다.

## 2. 사용자 시나리오

### S1. 첫 스냅샷 (형상관리 출발점)
1. 운영자가 README대로 내보내기 전용 읽기 역할을 클러스터에 만들고(사람이 직접 `kubectl apply`), 로컬 kubeconfig에 그 역할용 컨텍스트 `sentinel-snapshot`을 만든다.
2. `deploy/k8s-snapshot/.env`에 `KUBE_CONTEXT=sentinel-snapshot`, 대상 네임스페이스(비우면 시스템 제외 전체)를 적고 `npm run export:dry --prefix deploy/k8s-snapshot`으로 무엇을 읽을지 확인한다(클러스터 호출 없음).
3. `npm run export --prefix deploy/k8s-snapshot` → 종료코드 0, `snapshots/20260919-061000/` 생성.
4. 대시보드 "스냅샷" → Kubernetes 탭 최상단에 새 스냅샷이 **정상**으로, 드리프트 "차이 없음"으로 보인다.
5. 화면 안내에 따라 `git diff --stat`으로 파일을 확인하고 직접 커밋한다. README "git으로 관리 시작하기" 안내를 보고, 이 스냅샷을 복사해 운영 매니페스트 폴더를 따로 만들지 결정한다(대시보드는 복사하지 않는다).

### S2. 커밋 전 비밀값 정리
1. 내보내기가 종료코드 1로 끝났다. Kubernetes 탭에 새 스냅샷이 **장애(커밋 금지)** "비밀값 의심 1건 (k8s-env-literal)".
2. 상세 → 스캔 발견 `data/statefulsets/postgres.yaml:41` 클릭 → 해당 파일·줄로 이동. `POSTGRES_PASSWORD`가 `value:` 리터럴로 들어가 있다.
3. 편집으로 `value:`를 지우고 `valueFrom.secretKeyRef`로 바꾸려다 Secret 이름을 몰라 우선 값을 `<POSTGRES_PASSWORD>` 자리표시자로 바꿔 저장 → 재스캔 오류 0 → **정상**. (클러스터 쪽 평문 비밀번호 문제는 운영자가 따로 처리한다. 대시보드는 안내만)

### S3. 설정이 틀어졌는지 확인 (드리프트)
1. 장애 알림 후 "누가 뭘 바꿨나" 확인하려고 "스냅샷" → Kubernetes 탭을 연다. 최신 스냅샷 행에 드리프트 **주의** "차이 3건 (변경 2 · 삭제 1)".
2. 상세 → 드리프트 탭: `app/Deployment/api`의 `containers[api].image` 태그가 `1.8.2` → `1.9.0`, `resources.limits.memory` `1Gi` → `512Mi`, `app/Ingress/api-public` 이 클러스터에서 사라짐.
3. "기본값 차이 12건 숨김", "관리 필드 1건 숨김(HPA가 관리하는 replicas)"이 접혀 있고 펼쳐 볼 수 있다.
4. "비교 불가: ConfigMap 8개, NetworkPolicy 2개 (대시보드 권한 밖)"가 따로 보인다.
5. 되돌리려면 스냅샷 파일로 사람이 직접 `kubectl diff`/`kubectl apply`를 한다(화면에 명령 예시 복사만. 대시보드는 실행하지 않음).

### S4. 오래된 스냅샷과 비교
1. 1주일 전 스냅샷 상세에서 "드리프트 계산"을 누르면 그 스냅샷 기준 차이가 보인다(최신 스냅샷이 아니면 자동 계산하지 않는다, 4.5).

### S5. 다른 클러스터의 스냅샷
1. 스테이징 클러스터에서 뜬 스냅샷은 드리프트가 **알 수 없음**("대시보드가 연결된 클러스터와 다름")으로 보이고 계산 버튼이 비활성이다. 파일 관리(보기·편집·삭제)는 된다.

## 3. CLI `deploy/k8s-snapshot/` (내보내기)

### 3.1 성격과 경계
- 대시보드(`apps/api`, `apps/web`)와 관계없는 **사람용 독립 스크립트**다. 대시보드의 ServiceAccount·RBAC·kubeconfig 설정을 쓰지 않는다.
- **읽기 전용**: 쿠버네티스 API에 get/list만 한다. watch·exec·logs·port-forward·proxy·서버 측 dry-run(`dryRun=All` 포함, patch/create 동사가 필요하므로)·`kubectl diff`를 쓰지 않는다. 적용 스크립트는 만들지 않는다.
- 클러스터 호출 방식(kubectl 실행 / Node 클라이언트 라이브러리)은 백엔드가 정한다. 어느 쪽이든 이 절의 규칙을 지킨다.
- `deploy/aws-snapshot` 패턴 재사용(구현 방식은 백엔드): 설정 우선순위(플래그 > `.env` > 셸 환경변수), `--dry-run`, `--config`, `--help`, 종료코드, `metadata.json`(`schemaVersion: 1`), 비밀값 스캐너, `npm run scan`, `node:test` 단위 테스트(가짜 클러스터 응답, 실제 클러스터 호출 없음).

### 3.2 접속: 대시보드와 분리된 사람용 컨텍스트
- **컨텍스트는 필수 설정**이다(`KUBE_CONTEXT`, 또는 플래그). 비우면 종료코드 2. kubeconfig의 current-context를 암묵적으로 쓰지 않는다(엉뚱한 클러스터를 긁는 것을 막는다. aws-snapshot의 "AWS_REGION 필수"와 같은 이유).
- kubeconfig 경로는 설정으로 줄 수 있다(`KUBECONFIG` 규칙과 같게, 기본은 사용자 kubeconfig).
- 권한: README에 **내보내기 전용 읽기 역할 예시**(ClusterRole + 바인딩, 대상 종류의 get/list만, `secrets` 없음 — Q1 결정)를 둔다. 적용은 사람이 한다. 연결 방법은 **ClusterRole + 사람 사용자/그룹(또는 전용 ServiceAccount)에 대한 ClusterRoleBinding**으로 안내한다. (2026-09-24 변경 — 이전 문구는 "EKS에서는 IAM 주체를 access entry(또는 aws-auth)로 연결"이었다. **kOps에는 access entry·aws-auth가 없다.** `kops-support` 9절)
- `kops export kubeconfig --admin`으로 만든 **admin kubeconfig를 이 CLI에 쓰지 않는다.** cluster-admin 인증서가 들어 있어 "읽기 전용"이 권한으로 막히지 않는다(`kops-support` 3.6.1). README에 금지 문구를 둔다.
- 대시보드 ServiceAccount 토큰이나 `deploy/rbac.yaml`의 `sentinel-readonly` 역할을 쓰라고 안내하지 않는다(권한 목록이 다르고, 대시보드 권한을 넓힐 이유를 만들지 않기 위해).
- 컨텍스트 이름·클러스터 식별값만 기록하고, kubeconfig 경로·서버 URL·토큰·인증서는 `metadata.json`·로그에 남기지 않는다.

### 3.3 클러스터 식별 (드리프트 짝 맞추기용)
- `metadata.json`에 다음을 기록한다.
  - `cluster.id`: `kube-system` 네임스페이스의 UID (쿠버네티스에서 흔히 쓰는 클러스터 식별값. 비밀값 아님)
  - `cluster.context`: 컨텍스트 이름(원문)
  - `cluster.name`: 클러스터 이름을 알 수 있으면(컨텍스트·kubeconfig의 클러스터 항목에서) 원문, 모르면 `null`. kOps에서는 보통 FQDN(`prod.k8s.example.com`)이라 길다 — 화면에서는 가운데 말줄임 + 툴팁
  - `cluster.serverVersion`: 쿠버네티스 서버 버전(예 `v1.30.4`. kOps에는 `-eks-…` 같은 배포판 접미어가 붙지 않는다)
- 대시보드는 자기가 연결된 클러스터의 `kube-system` UID(대시보드 RBAC `namespaces` get으로 읽을 수 있음)와 `cluster.id`를 비교해 같은 클러스터인지 판단한다(4.6).

### 3.4 내보낼 리소스 종류

**기본 포함 (네임스페이스 범위)**

| 종류 (apiGroup) | 대시보드 드리프트 비교 | 비고 |
|---|---|---|
| Namespace (core) | 가능 | 대상 네임스페이스 자신 |
| Deployment, StatefulSet, DaemonSet (apps) | 가능 | Postgres StatefulSet 포함 |
| Service (core) | 가능 | |
| PersistentVolumeClaim (core) | 가능 | 정의만. **데이터 아님**(3.9) |
| Ingress (networking.k8s.io) | 가능 | |
| PodDisruptionBudget (policy) | 가능 | |
| HorizontalPodAutoscaler (autoscaling) | 가능 | |
| ConfigMap (core) | **비교 불가** (대시보드 RBAC에 configmaps 없음) | `kube-root-ca.crt` 제외. 내용 그대로 담고 스캔한다 |
| ServiceAccount (core) | 비교 불가 | 자동 생성 `default`는 어노테이션·imagePullSecrets가 없으면 제외 |
| Role, RoleBinding (rbac.authorization.k8s.io) | 비교 불가 | |
| NetworkPolicy (networking.k8s.io) | 비교 불가 | |
| CronJob (batch) | 비교 불가 | |
| ResourceQuota, LimitRange (core) | 비교 불가 | |

**선택 (설정으로 켬, 기본 꺼짐)**

| 종류 | 비고 |
|---|---|
| Job (batch) | CronJob이 만든 Job(ownerReferences 있음)은 켜도 제외. 한 번 실행용이라 기본 꺼짐 |
| 클러스터 범위: ClusterRole, ClusterRoleBinding, StorageClass, IngressClass, PriorityClass | 클러스터 전체라 시스템 항목이 많다. 켜면 `system:` 접두어·`eks:` 접두어(**EKS 잔재 — kOps 클러스터에는 매칭되는 객체가 없다. 다음 정리 때 삭제**)·쿠버네티스 기본 항목은 제외 규칙으로 뺀다(목록은 백엔드) |
| PersistentVolume | 기본 꺼짐. 동적 프로비저닝 PV는 PVC가 다시 만든다 |
| 사용자 지정 리소스(CRD 인스턴스) | 종류를 이름으로 지정할 때만(예 `targetgroupbindings.elbv2.k8s.aws`). 전체 CRD 자동 탐색은 하지 않는다 |

**항상 제외**

| 대상 | 이유 |
|---|---|
| **Secret** | 값을 담지 않는다(U1). Secret 객체를 읽지 않고, 워크로드가 참조하는 Secret 이름만 `secret-refs.json`에 기록한다(**Q1 결정**) |
| Pod, ReplicaSet, ControllerRevision, Endpoints, EndpointSlice, Event, Lease, Node, 메트릭 | 컨트롤러가 만들거나 런타임 상태 |
| `metadata.ownerReferences`가 있는 객체(컨트롤러 소유) | 소유자가 다시 만든다(예: Deployment가 만든 ReplicaSet, CronJob이 만든 Job) |
| 쿠버네티스·애드온이 자동으로 만든 객체 | `kube-root-ca.crt` ConfigMap, 토큰 없는 기본 `default` ServiceAccount, `kubernetes` Service(`default` 네임스페이스), kOps 애드온(`kops-controller` 등)이 만든 객체. 목록은 백엔드가 정하고 README에 적는다 |

- 종류 이름은 설정에서 대소문자 무시, 모르는 이름이면 종료코드 2(aws-snapshot의 "모르는 서비스 이름은 바로 오류"와 같은 이유: 오타가 조용히 무시되지 않게).
- Helm이 관리하는 리소스(레이블 `app.kubernetes.io/managed-by: Helm`)도 내보낸다. `metadata.json`에 Helm 관리 리소스 수를 기록하고, 화면·README에 "Helm 관리 리소스는 `kubectl apply`보다 Helm으로 복원" 안내를 둔다. Helm 릴리스 Secret(`sh.helm.release.v1.*`)은 Secret이므로 제외.

### 3.5 네임스페이스 범위
- 설정: 포함 목록 **또는** 제외 목록(둘 다 주면 종료코드 2).
- 기본(둘 다 비움): **시스템 네임스페이스를 뺀 전체**. 시스템 기본 목록: `kube-system`, `kube-public`, `kube-node-lease` (2026-09-24 변경: EKS 관측 애드온 `amazon-cloudwatch`를 기본값에서 뺐다, AC-KOPS09). `cluster-status` 가정 A6의 시스템 목록과 같게 맞춘다(설정 가능).
- 시스템 네임스페이스를 포함 목록에 직접 적으면 내보낸다(경고 출력). kOps 애드온과 컨트롤 플레인 static pod의 미러 파드가 관리하는 리소스가 많아 복원 대상이 아님을 README에 안내.
- 존재하지 않는 네임스페이스를 포함 목록에 적으면 종료코드 2가 아니라 경고 + `metadata.json`에 기록(클러스터 상태의 문제이지 설정 오류가 아닐 수 있음). 결과가 0개면 종료코드 3.
- `metadata.json`에 **범위 규칙**(포함/제외 목록, 시스템 제외 여부)과 **실제로 내보낸 네임스페이스 목록**을 모두 기록한다. 드리프트의 "추가됨" 판단(4.3)이 이 규칙을 쓴다.

### 3.6 정리 규칙 (런타임 필드 제거)
내보낸 YAML은 "다시 적용할 수 있는 모양"이어야 한다. 아래를 제거하고, 제거 규칙 목록과 버전을 `metadata.json`에 기록한다(`cleanup.rulesVersion`). 드리프트는 **같은 규칙**으로 현재 클러스터 객체를 정리한 뒤 비교한다(4.4 ①).

| 위치 | 제거 |
|---|---|
| 최상위 | `status` 전체 |
| `metadata` | `uid`, `resourceVersion`, `generation`, `creationTimestamp`, `managedFields`, `selfLink`, `deletionTimestamp`, `deletionGracePeriodSeconds`, `ownerReferences`(최상위 객체는 원래 없음), `finalizers`(컨트롤러가 붙이는 것. 예: ALB 컨트롤러의 `ingress.k8s.aws/resources`) |
| `metadata.annotations` | `kubectl.kubernetes.io/last-applied-configuration`(스펙 전체 사본, 비밀값이 섞일 수 있음), `deployment.kubernetes.io/revision`, `pv.kubernetes.io/*`, `volume.beta.kubernetes.io/storage-provisioner`, `volume.kubernetes.io/storage-provisioner`, `volume.kubernetes.io/selected-node`, `autoscaling.alpha.kubernetes.io/*`(HPA 상태 어노테이션), `control-plane.alpha.kubernetes.io/leader`. 비면 `annotations` 키 자체 제거 |
| `metadata.labels` | Namespace의 `kubernetes.io/metadata.name`(자동). 비면 키 제거 |
| 파드 템플릿 | `spec.template.metadata.creationTimestamp` |
| Service | `spec.clusterIP`, `spec.clusterIPs`(단 헤드리스 `None`은 **유지**), `spec.healthCheckNodePort` |
| PVC | `spec.volumeName`(특정 PV에 묶임, 새 클러스터에서 적용 불가) |
| StatefulSet | `spec.volumeClaimTemplates[].status`, `…metadata.creationTimestamp` |
| Namespace | `spec.finalizers` |
| ServiceAccount | `secrets`(자동 토큰 참조) |

- **남기는 것**: 사용자가 정한 레이블·어노테이션(ALB·EBS CSI 설정 어노테이션 등), `spec` 전체(기본값으로 채워진 필드 포함), `kubectl.kubernetes.io/restartedAt` 파드 템플릿 어노테이션(스펙의 일부. 지우면 다시 적용할 때 롤아웃이 일어난다. 드리프트에서는 "관리 필드"로 숨김, 4.4 ④), Service `nodePort`(사용자가 정했을 수 있음).
- 기본값 필드는 **지우지 않는다**(쿠버네티스 버전에 따라 기본값이 바뀔 수 있고, 지운 필드를 되살릴 방법이 없음). 기본값 잡음은 드리프트 쪽에서 처리한다(4.4).
- 키 순서: API 응답 순서를 유지하되 최상위는 `apiVersion`, `kind`, `metadata`, 그 다음 나머지. 같은 클러스터를 두 번 내보내면 **바뀐 리소스만 git diff에 나와야 한다**(AC-K07).

### 3.7 비밀값 제외와 스캔
- Secret은 3.4대로 제외(Q1 결정).
- 스캐너 규칙은 **한 벌**이다: aws-snapshot 스캐너(`deploy/aws-snapshot/lib/scan.mjs`)의 규칙을 그대로 쓰고, 쿠버네티스 전용 규칙을 **같은 규칙 원본에** 더한다(공유 방법·위치는 백엔드. 두 CLI와 대시보드가 같은 결과를 내야 한다. ASM A3과 같음).
- 추가할 쿠버네티스 규칙 (등급 제안. 최종 문구·정규식은 백엔드):

| 규칙(제안 ID) | 등급 | 잡는 것 |
|---|---|---|
| `k8s-env-literal` | error | 컨테이너 `env[]`에서 **이름**이 비밀값 접미어(`SECRET_KEY_SUFFIXES`: password, token, secret, apikey …)로 끝나고 `value:`에 리터럴 값이 있음. `valueFrom`(secretKeyRef 등)은 통과. 기존 `secret-key-value`는 `name:`과 `value:`가 다른 줄이라 못 잡는다 |
| `k8s-secret-object` | error | 파일 안에 `kind: Secret`이 있고 `data:`/`stringData:`에 값이 있음(손으로 넣었거나 다른 도구 결과를 복사한 경우) |
| `k8s-dockerconfig` | error | `.dockerconfigjson`/`.dockercfg` 키 또는 `auths:` 안의 `auth:` 값 |
| `k8s-configmap-secretish` | warn | ConfigMap `data`의 **키 이름**이 비밀값 접미어로 끝남(값 형식과 관계없이 검토 필요) |
| `k8s-last-applied` | warn | `kubectl.kubernetes.io/last-applied-configuration`이 남아 있음(정리 규칙이 빠진 파일 또는 손으로 붙여 넣은 파일) |

- 기존 규칙(`url-credentials`, `aws-access-key-id`, `private-key`, `jwt`, `vendor-token`, `secret-key-value`, `kubeconfig-ca` 등)은 그대로 적용된다. 기존 `env-block` 규칙은 쿠버네티스 `env:` 키와 이름이 달라 걸리지 않는다(`Environment`/`Variables`만 잡음). 쿠버네티스 `env:` 블록 전체를 오류로 잡지는 않는다(거의 모든 워크로드에 있어 잡음이 된다. 대신 `k8s-env-literal`).
- 검토 후 허용은 같은 줄 끝 `# snapshot-scan: allow`(YAML 주석) — aws-snapshot과 같다.
- 보고·로그·화면 설명에 값 원문을 넣지 않는다(앞 2글자 + 길이, `maskValue`).
- 스캐너는 모든 비밀값을 잡는다는 보장이 없다는 안내를 README·화면에 둔다.

### 3.8 스냅샷 폴더 구조와 `metadata.json`

```
deploy/k8s-snapshot/
├─ export.mjs / scan.mjs / lib/ / test/        (aws-snapshot과 같은 구성, 파일 이름은 백엔드)
├─ rbac/                    내보내기 전용 읽기 역할 예시 (사람이 적용)
├─ snapshots/<YYYYMMDD-HHmmss>/      ← git에 커밋하는 결과 (시각 UTC)
│  ├─ metadata.json
│  ├─ notes.json            (있을 때만) 대시보드 라벨·메모·편집 기록 — ASM Q1과 같은 파일·형식
│  ├─ secret-refs.json      (Q1 결정) 워크로드가 참조하는 Secret 이름 목록, 값 없음
│  ├─ _cluster/<kind>/<name>.yaml            클러스터 범위 리소스 (선택 종류를 켰을 때)
│  └─ <namespace>/
│     ├─ namespace.yaml
│     └─ <kind>/<name>.yaml                  리소스 1개 = 파일 1개
├─ snapshots/.trash/        (git 제외) 대시보드 휴지통 — ASM Q2와 같은 규칙
├─ .env.example / .gitignore (.env, snapshots/.trash/, node_modules)
└─ README.md
```

- **리소스 1개 = 파일 1개**: git diff·대시보드 편집·드리프트 짝 맞추기가 리소스 단위로 되게. `kubectl apply -R -f snapshots/<id>/<namespace>/`로 바로 적용할 수 있는 구조(적용은 사람이, README 절차대로).
- `<kind>` 폴더 이름은 소문자 복수형(예 `deployments`, `statefulsets`, `configmaps`), 사용자 지정 리소스는 `<plural>.<group>`. `<name>`은 쿠버네티스 이름 그대로(DNS-1123이라 파일 이름으로 안전). 정확한 규칙은 백엔드가 정하고 README에 적는다.
- 스냅샷 ID 형식은 aws-snapshot과 같다(`^\d{8}-\d{6}$`, UTC).
- `metadata.json` 필수 항목(이름·모양은 백엔드, `schemaVersion: 1`):

| 항목 | 내용 |
|---|---|
| `snapshotId`, `snapshotIdTimezone`, `createdAt` | aws-snapshot과 같음 |
| `tool` | CLI 이름·버전, Node 버전, (kubectl을 쓰면) kubectl 버전 |
| `cluster` | 3.3 (`id`, `context`, `name`, `serverVersion`) |
| `scope` | 네임스페이스 규칙(포함/제외 목록, 시스템 제외 여부), 실제 내보낸 네임스페이스 목록, 없던 네임스페이스 목록, 종류 목록(기본/선택/사용자 지정) |
| `kinds` | 종류별 결과: `exported`(개수), `forbidden`(권한 없음), `notFound`(클러스터에 API 없음), `error` |
| `resources` | 전체 수, 종류별 수, 네임스페이스별 수, Helm 관리 수, 제외 규칙으로 뺀 수(종류별) |
| `cleanup` | 정리 규칙 버전(`rulesVersion`)과 규칙 요약 |
| `secrets` | 처리 방식(Q1 결정: 읽지 않음, 참조 이름만)과 참조 Secret 수(이름은 `secret-refs.json`에만) |
| `secretScan` | aws-snapshot과 같은 모양(오류·경고·strict·통과·규칙) |

- 로컬 절대경로(사용자 이름 포함)를 남기지 않는다(aws-snapshot과 같음).

### 3.9 Postgres·PV 데이터 (범위 밖, 안내만)
- PVC·StatefulSet의 **정의**만 담는다. 데이터는 담지 않는다.
- README와 대시보드 상세 안내 문구(화면용 짧은 문구, 2026-09-19 DBA 검토 반영): "이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 스냅샷의 PVC를 적용하면 빈 볼륨이 새로 만들어집니다. 데이터는 `pg_dump`(데이터베이스별) + `pg_dumpall --globals-only`(역할) 논리 백업, 또는 EBS 볼륨 스냅샷으로 따로 **암호화해서** 보관하세요. 백업 파일은 git이나 스냅샷 폴더에 두지 마세요(README)."
- 복원 순서 안내 (README에 두고 화면은 README를 가리킨다):
  - **논리 백업으로 복원**: Secret 다시 만들기(`secret-refs.json` 참고) → 매니페스트 적용 → 빈 StatefulSet 기동·준비 확인 → 전역 객체 복원(`psql`로 `pg_dumpall --globals-only` 결과) → `pg_restore`(백업한 서버와 같은 메이저 버전이거나 더 새 버전).
  - **볼륨 스냅샷으로 복원**: Secret 다시 만들기 → StatefulSet보다 **먼저** 스냅샷에서 PVC 만들기(이름 `<템플릿>-<sts>-<순번>`, `dataSource` 또는 정적 PV, 원래 볼륨과 같은 AZ). 스냅샷 폴더에 있는 같은 이름의 PVC YAML은 적용하지 않는다 → 나머지 매니페스트 적용 → StatefulSet 기동(WAL 재생으로 복구).
- README 백업 안내에 넣을 주의 사항 (AC-K15 "Postgres·PV 데이터 백업 안내"의 내용):
  - `kubectl exec`(`pods/exec`)는 **사람의 운영 권한**으로 실행한다. 대시보드 RBAC와 내보내기 전용 역할에는 이 권한을 넣지 않는다.
  - DB 비밀번호를 명령줄 인자로 넘기지 않는다(컨테이너 안의 환경 변수나 `.pgpass` 사용).
  - 덤프 파일(특히 비밀번호 해시가 든 `pg_dumpall --globals-only` 결과)은 운영 데이터 원본이다. git과 `deploy/k8s-snapshot/snapshots/` **밖**에 암호화해서 보관한다(스냅샷 폴더 안에 두면 "예상 밖 파일"로 표시된다).
  - Windows PowerShell에서는 `>` 리다이렉트로 덤프를 받지 않는다(바이너리 덤프가 깨질 수 있음). 컨테이너 안에서 `-f`로 파일을 만든 뒤 `kubectl cp`로 가져온다.
  - EBS 스냅샷은 크래시 일관성만 보장한다. 쿠버네티스 VolumeSnapshot은 snapshot-controller(와 EBS CSI 드라이버)가 설치돼 있어야 쓸 수 있다.
  - 특정 시점 복구(PITR)는 범위 밖이다.
- 복원 뒤 모니터링 계정은 전역 객체 복원이나 `docs/db/monitor-account.sql` 재실행으로 되살린다(DBA 보고서 참고).

### 3.10 설정 (`.env`, 이름은 백엔드)
| 설정 | 기본 | 설명 |
|---|---|---|
| kubeconfig 경로 | 사용자 기본 kubeconfig | |
| 컨텍스트 | **필수** | 비우면 종료코드 2 |
| 네임스페이스 포함 / 제외 | (없음 = 시스템 제외 전체) | 3.5 |
| 시스템 네임스페이스 목록 | 3.5 기본값 | |
| 선택 종류 켜기 | 없음 | 3.4 선택 |
| 사용자 지정 리소스 종류 | 없음 | `plural.group` 목록 |
| 종류 제외 | 없음 | 기본 포함 중 뺄 것 |
| Helm 관리 리소스 포함 | `true` | `false`면 제외하고 개수만 기록 |
| strict 스캔 | `false` | 경고도 실패 |
| 출력 폴더 | `snapshots/` | aws-snapshot `--out-dir`와 같음 |

### 3.11 사용법과 종료코드
- `npm run export:dry --prefix deploy/k8s-snapshot`: 설정 해석 결과(컨텍스트 이름, 네임스페이스 규칙, 종류 목록, 부를 API 목록)를 출력하고 **클러스터를 호출하지 않는다**, 파일을 만들지 않는다.
- `npm run export --prefix deploy/k8s-snapshot`, `npm run scan --prefix deploy/k8s-snapshot [-- snapshots/<id>] [--strict]`.

| 종료코드 | 뜻 | 스냅샷 폴더 |
|---|---|---|
| 0 | 성공, 스캔 통과 | 남음 |
| 1 | 비밀값 의심 → 커밋 금지, 정리 후 재스캔 | 남음 |
| 2 | 설정 오류(컨텍스트 없음·kubeconfig에 없는 컨텍스트, 모르는 종류, 포함·제외 동시 지정 등) | 안 만듦 |
| 3 | 클러스터 접속 실패, 네임스페이스 읽기 권한 없음, 리소스 0개 | 지움 |
| 4 | **부분 성공**: 일부 종류가 권한 없음(`forbidden`)·API 없음이라 빠짐. 스캔은 통과 | 남음 (`metadata.kinds`에 기록) |

- 1과 4가 겹치면 1(비밀값이 우선). 종료코드 4는 aws-snapshot에 없는 값이다(former2는 권한 오류를 조용히 넘기지만, 이 CLI는 빠진 종류를 숨기지 않는다).

## 4. 드리프트 (스냅샷 vs 현재 클러스터)

### 4.1 경계
- 현재 클러스터 쪽 데이터는 **대시보드의 기존 읽기 전용 RBAC(`deploy/rbac.yaml`)로 읽을 수 있는 것만** 쓴다. RBAC를 늘리지 않는다(U4, **Q3 결정**).
- 쿠버네티스 쓰기 동사를 쓰지 않는다. **서버 측 dry-run 적용(`kubectl diff`가 쓰는 방식)도 쓰지 않는다**(patch 동사가 필요하다).
- 스냅샷 파일 쪽은 **현재 파일 내용**(대시보드·편집기에서 고친 뒤의 내용)을 쓴다. 사용자가 스냅샷을 "원하는 상태"로 고쳐 두고 차이를 보는 용도도 된다.
- 데이터를 얻는 방식(기존 informer 재사용, 필요 시 목록 조회)은 백엔드가 정한다. 참고: 기존 informer 저장소는 화면용으로 추린 값만 들고 있을 수 있어(`apps/api/src/cluster/kube/extract.ts`), 드리프트에는 `spec` 전체가 필요하다.

### 4.2 비교 가능한 종류
- **비교 가능** = 대시보드 RBAC에 get/list가 있는 종류: Namespace, Deployment, StatefulSet, DaemonSet, Service, PersistentVolumeClaim, Ingress, PodDisruptionBudget, HorizontalPodAutoscaler.
- **비교 불가** = 스냅샷에는 있지만 대시보드 RBAC에 없는 종류(ConfigMap, ServiceAccount, Role, RoleBinding, NetworkPolicy, CronJob, Job, ResourceQuota, LimitRange, 클러스터 범위 종류, 사용자 지정 리소스). 화면에 종류별 개수와 "대시보드 권한 밖이라 비교하지 않음"을 표시한다. 드리프트 상태에 영향이 없다.
- RBAC 목록이 바뀌면 이 표도 따라 바뀌어야 하므로, 서버는 "비교 가능 종류"를 한 곳에서 관리하고 화면은 서버가 준 목록을 표시한다(화면에 하드코딩하지 않음).
- 대시보드 RBAC에 있어도 실제로 권한이 거부되면(클러스터에 RBAC가 덜 적용됨) 그 종류는 "비교 불가(권한 거부)"로 표시한다.

### 4.3 리소스 짝 맞추기와 추가/삭제/변경
- 리소스 식별값: `apiGroup` + `kind` + `namespace` + `name` (파일 경로가 아니라 **파일 내용** 기준). 파일 경로와 내용이 다르면 파일 상태 주의(5.1).
- 한 파일에 `---`로 여러 문서가 있으면(편집으로 생긴 경우, 5.4) 드리프트는 **문서(리소스)별로** 짝을 맞춰 비교한다. 문서마다 위 식별값(apiVersion의 그룹 + kind + namespace + name, 버전은 식별에 쓰지 않음)을 쓴다. 빈 문서는 무시한다. (권장안으로 정함, 2026-09-19 디자인 요청)
- 같은 식별값의 파일이 둘 이상이면 그 리소스는 비교하지 않고 "중복 정의"로 표시(파일 상태 주의).
- **삭제됨**: 스냅샷에 있고 클러스터에 없음.
- **추가됨**: 클러스터에 있고 스냅샷에 없음. 단 **스냅샷의 범위 안에서만**: 스냅샷 `metadata.scope`의 네임스페이스 규칙·종류 목록·제외 규칙(3.4 항상 제외, 소유자 있는 객체, 자동 생성 객체, Helm 제외 설정)을 현재 클러스터에 똑같이 적용해 남는 것만. 예: 스냅샷이 "시스템 제외 전체"였으면 이후 새로 만든 네임스페이스와 그 안의 리소스가 추가됨이다. 스냅샷이 `app` 네임스페이스만이었으면 다른 네임스페이스는 보지 않는다.
- **변경됨**: 양쪽에 있고 4.4 정규화 뒤 필드 차이가 1건 이상.
- 같음: 차이 없음(개수만 표시).
- `metadata.json`이 없거나 손상돼 범위를 알 수 없으면 추가됨은 계산하지 않고 "범위를 알 수 없어 추가된 리소스는 확인하지 않음"을 표시(삭제·변경은 계산).

### 4.4 기본값 가짜 차이 줄이기
CLI는 서버가 기본값을 채운 `spec`을 그대로 담으므로 같은 클러스터·같은 버전이면 기본값 차이는 거의 없다. 가짜 차이는 주로 ① 쿠버네티스 버전 업그레이드로 새 기본값 필드가 생김 ② 사용자가 스냅샷 파일을 손으로 고치면서 기본값 필드를 지우거나 짧은 형식으로 씀 ③ 컨트롤러가 채우는 필드에서 나온다. 다음 순서로 처리한다.

1. **같은 정리 규칙**: 현재 클러스터 객체에 3.6 정리 규칙(스냅샷 `cleanup.rulesVersion`에 맞는 규칙)을 똑같이 적용한 뒤 비교한다.
2. **값 정규화**: 수량(`1000m` = `1`, `1Gi` = `1024Mi`), 정수/문자열 포트(`targetPort: 8080` = `"8080"`은 **다름**, 이름 포트와 숫자 포트는 다른 값), 빈 맵·빈 목록·`null`·키 없음을 같은 것으로 본다.
3. **이름 있는 목록은 키로 짝**: containers·initContainers(`name`), ports(`name`, 없으면 `port`+`protocol`), env(`name`), volumes(`name`), volumeMounts(`mountPath`), Service ports(`name`, 없으면 `port`+`protocol`), tolerations 등. 순서 차이는 차이로 보지 않는다(단 containers 순서처럼 의미가 있는 것은 백엔드가 표로 정함).
4. **기본값 표**: 종류별 "필드 경로 → 기본값" 표를 둔다. 한쪽에 필드가 없고 다른 쪽 값이 그 기본값이면 **"기본값 차이"로 분류해 기본으로 숨긴다**. 예(최종 표는 백엔드, 쿠버네티스 버전별):
   - 파드 템플릿: `restartPolicy: Always`, `dnsPolicy: ClusterFirst`, `schedulerName: default-scheduler`, `terminationGracePeriodSeconds: 30`, `securityContext: {}`, 컨테이너 `terminationMessagePath: /dev/termination-log`, `terminationMessagePolicy: File`, `imagePullPolicy`(태그가 `latest`/없음이면 `Always`, 아니면 `IfNotPresent`), 포트 `protocol: TCP`
   - Deployment: `revisionHistoryLimit: 10`, `progressDeadlineSeconds: 600`, `strategy` RollingUpdate 25%/25%
   - StatefulSet: `podManagementPolicy: OrderedReady`, `updateStrategy` RollingUpdate(partition 0), `revisionHistoryLimit: 10`, `persistentVolumeClaimRetentionPolicy` Retain/Retain, `volumeClaimTemplates[].spec.volumeMode: Filesystem`
   - DaemonSet: `updateStrategy` RollingUpdate(maxUnavailable 1, maxSurge 0), `revisionHistoryLimit: 10`
   - Service: `sessionAffinity: None`, `type: ClusterIP`, `ipFamilyPolicy: SingleStack`, `ipFamilies`, `internalTrafficPolicy: Cluster`, LoadBalancer의 `externalTrafficPolicy: Cluster`·`allocateLoadBalancerNodePorts: true`, `targetPort`(없으면 `port`와 같음)
   - PVC: `volumeMode: Filesystem`
   - HPA: `behavior` 기본값(scaleUp/scaleDown 정책)
5. **관리 필드**: 다른 주체가 관리해 차이가 나는 것이 정상인 필드는 "관리 필드"로 분류해 기본으로 숨기고 이유를 붙인다.
   - HPA가 대상으로 삼는 워크로드의 `spec.replicas` (이유: "HPA가 관리")
   - 파드 템플릿 어노테이션 `kubectl.kubernetes.io/restartedAt` (이유: "`kubectl rollout restart` 기록")
   - PVC `spec.resources.requests.storage`가 클러스터 쪽이 더 큼 (이유: "볼륨 확장") — 줄어든 경우는 변경으로 표시
   - Service `spec.ports[].nodePort`가 스냅샷에 없음 (이유: "자동 할당")
   - 그 밖에 백엔드가 확인한 컨트롤러 변경(예: AWS LB 컨트롤러·EBS CSI·kOps 애드온이 붙이는 레이블·어노테이션)은 표에 추가하고 문서에 남긴다.
6. **투명성**: 숨긴 차이는 개수("기본값 차이 12건 · 관리 필드 1건 숨김")와 함께 펼쳐 볼 수 있다. 숨긴 차이는 드리프트 상태·건수에 넣지 않는다.
7. 규칙으로 걸러 내지 못한 가짜 차이는 사용자가 스냅샷 파일을 편집해 맞출 수 있다(원본 직접 편집, U2). 사용자별 무시 규칙 설정은 범위 밖(7절).

### 4.5 계산 대상과 갱신 주기
| 대상 | 계산 | 주기 |
|---|---|---|
| **같은 클러스터의 최신 스냅샷**(스냅샷 ID 기준, 휴지통 제외) | 자동 | 클러스터 쪽 변경(비교 가능 종류의 추가·수정·삭제)이 **30초 이내**에 반영. 변경이 없어도 **5분**마다 한 번 다시 계산. 스냅샷 파일이 바뀌면(편집·외부 변경) 30초 이내 |
| 그 밖의 스냅샷 | 상세의 "드리프트 계산" 버튼으로 요청했을 때만 | 계산 결과 화면을 열어 두는 동안 30초 이내 갱신. 화면을 떠나면 자동 계산 중지. 결과 보관 여부·기간은 백엔드 |
| 목록의 드리프트 열 | 최신 스냅샷만 값, 나머지는 "계산 안 함"(또는 마지막 계산 결과 + 계산 시각) | |
| stale | 클러스터 출처(`kube`)가 stale이면 드리프트도 stale 표시(값 유지) | `docs/api/common.md` 2.3 |

- 실시간(초 단위) 갱신은 필요 없다. 계산 결과에 "계산 시각"을 함께 보인다.
- 스트림(SSE)에 드리프트 값 원문(필드 값)을 싣지 않는다. 바뀌었다는 알림과 건수만(ASM-API 11절 패턴). 필드 값은 REST로만.

### 4.6 드리프트 상태 판단
드리프트 상태는 **파일 상태(5.1)와 따로** 표시한다(두 축). 드리프트는 **장애가 되지 않는다**: 스냅샷은 "과거 기록"이지 반드시 따라야 할 원하는 상태가 아니기 때문이다.

| 상태 | 조건 | 사유 예 |
|---|---|---|
| **정상** | 비교 가능한 리소스에서 추가·삭제·변경 0건 (숨긴 차이는 무관) | "차이 없음 (비교 42개, 비교 불가 11개)" |
| **주의** | 추가·삭제·변경 1건 이상 | "차이 3건 (변경 2 · 삭제 1)" |
| **알 수 없음** | 대시보드 클러스터 연결 없음(`kube` 출처 `not_configured`/`unavailable`/`syncing`) | "클러스터 연결 없음" |
| | 스냅샷 `cluster.id`가 대시보드 클러스터와 다름 | "다른 클러스터의 스냅샷 (staging.k8s.example.com)" — 계산 버튼 비활성 |
| | `cluster.id` 없음(메타 없음·손상·형식 다름) | "클러스터를 확인할 수 없음" — 계산하지 않음(**Q4 결정**) |
| | 비교 가능 종류가 스냅샷에 하나도 없음 | "비교할 수 있는 리소스 없음" |
| | 파일 상태가 알 수 없음(내보내기 진행 중 등) | "스냅샷 파일 확인 전" |
| | 계산하지 않은 스냅샷(최신이 아님) | "계산 안 함" (상태 배지 대신 회색 문구, 디자인이 정함) |

- 서버가 판단하고 화면은 다시 계산하지 않는다(`docs/api/common.md` 2.2).
- YAML을 읽을 수 없는 파일의 리소스는 비교에서 빠지고 "파일 해석 실패로 비교 못 함 N개"로 표시(파일 상태 주의).

### 4.7 드리프트 표시 규칙
- **요약**: 비교한 리소스 수, 추가·삭제·변경·같음 수, 비교 불가 종류별 수, 숨긴 차이 수, 계산 시각, 비교 대상 클러스터(컨텍스트 이름).
- **리소스 목록**: 네임스페이스 → 종류 → 이름 순, 구분(추가/삭제/변경) 필터, 이름 검색.
- **필드 diff** (변경됨 리소스): 필드 경로(예 `spec.template.spec.containers[api].resources.limits.memory`), 스냅샷 값, 클러스터 값, 분류(변경 / 기본값 차이 / 관리 필드 + 이유). 필드 추가·삭제는 한쪽을 "(없음)"으로.
- 추가됨·삭제됨 리소스: 필드 diff 대신 리소스 요약(종류·이름·네임스페이스, 가능하면 이미지·replicas 같은 핵심 값).
- **값 가림**: 다음 값은 필드 diff에 원문 대신 "값 다름 (앞 2글자****(N자))"로 보인다 — 컨테이너 `env[].value`, `command`·`args`, 비밀값 스캐너 규칙에 걸리는 값. 이유: 클러스터 쪽 값은 로컬 파일이 아니라 운영 데이터이고, `CLAUDE.md`의 "환경 변수·command/args는 외부로 보내지 않는다" 원칙과 맞추기 위해. 스냅샷 파일 쪽 원문은 파일 보기(편집 화면)에서 볼 수 있다(ASM 3.2 E와 같음). 어노테이션 값은 가리지 않는다(ALB 설정 등 드리프트 확인에 필요). 단 스캐너 규칙에 걸리면 가린다.
- 각 변경 리소스에 스냅샷 파일로 가는 링크(해당 파일 보기)와 **사람이 직접 실행할 명령 예시**(복사만): `kubectl diff -f <파일>`(서버 측 dry-run이므로 사용자의 쓰기 권한 필요 — 문구로 안내), `kubectl apply -f <파일>`. 화면에 "대시보드는 이 명령을 실행하지 않습니다. 적용 전 `kubectl diff`로 확인하세요" 상시 표시.
- 드리프트 결과는 대시보드 자체 DB에 저장해야 하는지, 메모리만인지는 백엔드가 정한다(저장한다면 DBA와 협의). 드리프트 결과를 스냅샷 폴더에 쓰지 않는다.

## 5. 스냅샷 관리 화면 (대시보드)

### 5.0 ASM 재사용 원칙
Kubernetes 탭의 목록·상세·편집·라벨·메모·삭제·휴지통·경로 보안·mock 메모리 처리는 **ASM의 해당 절을 그대로 적용한다**. 아래는 ASM과 **다른 점만** 적는다.

| ASM 절 | k8s 스냅샷에서 |
|---|---|
| 3.0 용어 (알려진 파일) | 알려진 파일 = `metadata.json`, `notes.json`, `secret-refs.json`(Q1 결정), `namespace.yaml`·리소스 YAML(3.8 경로 규칙에 맞는 것) |
| 3.1 목록 | 5.2 |
| 3.2 상세 | 5.3 |
| 3.3 상태 판단 | 5.1 |
| 3.4 메뉴 상태 | 5.5 |
| 3.5 라벨·메모 | **그대로** (60자/2000자, 오류 규칙이면 저장 거부, `notes.json`) |
| 3.6 스냅샷이 아닌 항목 | **그대로** |
| 3.7 편집 규칙·안전장치 | **그대로** + 5.4의 차이 |
| 3.8 삭제·휴지통 | **그대로** (휴지통 `snapshots/.trash/`, ID 입력 확인, 복원 시 같은 ID 있으면 거부, 자동 비우기 없음) |
| 3.9 보안·경로 규칙 | **그대로** + 5.4의 파일 지정 규칙. "외부 시스템 호출 0회"는 파일 관리 기능에 적용. 드리프트는 4.1대로 쿠버네티스 API를 **읽기만** 한다 |
| 3.10 CLI 안내 | 명령을 `deploy/k8s-snapshot` 기준으로 바꿈 + 5.6 |
| 3.11 데이터 출처 | **그대로**, 출처는 k8s 스냅샷 폴더(별도 출처. 이름은 백엔드). docker compose는 `deploy/k8s-snapshot/snapshots`만 쓰기 가능하게 마운트 |
| 3.12 mock | 5.7 |
| 4 갱신 주기 | **그대로**(외부 변경 30초 이내, stale 90초) + 드리프트는 4.5 |

### 5.1 k8s 스냅샷 파일 상태 판단 (ASM 3.3 대응)
상태 값·사유 표현·"가장 나쁜 것이 상태"는 ASM 3.3과 같다. 장애 화면 문구는 "커밋 금지".

| 상태 | 조건 (하나라도) | 사유 예 |
|---|---|---|
| **장애** | 현재 스캔 오류 1건 이상 | "비밀값 의심 1건 (k8s-env-literal)" |
| | `metadata.json` 손상 | ASM과 같음 |
| | strict 스냅샷 + 경고 1건 이상 | ASM과 같음 |
| **주의** | 현재 스캔 경고 1건 이상 | "검토 필요 2건 (k8s-configmap-secretish)" |
| | `metadata.json` 없음 + 마지막 변경 30분 이상 전 | ASM과 같음 |
| | 메타 필수 항목 없음·`schemaVersion` ≠ 1 | ASM과 같음 |
| | `snapshotId` ≠ 폴더 이름 | ASM과 같음 |
| | **부분 내보내기**: `metadata.kinds`에 `forbidden`/`error`가 있음 | "일부 종류를 읽지 못함 (networkpolicies: 권한 없음)" |
| | YAML로 읽을 수 없는 리소스 파일 | "YAML 해석 실패 2개" |
| | 파일 경로와 내용(kind/namespace/name)이 다름, 또는 같은 리소스가 두 파일에 | "경로와 내용 불일치 1개" / "중복 정의 1개" |
| | 정리 규칙 대상 필드가 남아 있음(`status`, `managedFields` 등) | "런타임 필드 남음 3개 파일" |
| | 리소스 파일 0개 | "리소스 0개" |
| | 알려진 파일·경로 규칙 밖의 파일 | "예상 밖 파일 2개" (ASM과 같음) |
| | `notes.json` 손상 | ASM-API `NOTES_CORRUPT`와 같음 |
| **알 수 없음** | 읽기 실패, 내보내기 진행 중일 수 있음(30분) | ASM과 같음(편집·삭제 막음) |
| **정상** | 위 어디에도 없음 | |

- `kind: Secret`에 값이 있는 파일은 스캔 규칙 `k8s-secret-object`(error)로 장애가 된다.
- **드리프트 상태는 파일 상태에 섞지 않는다**(4.6). 목록·상세에 두 배지를 따로 둔다.
- 정보 문구(상태 영향 없음): "Helm 관리 리소스 N개 — Helm으로 복원 권장", "시스템 네임스페이스 포함", "데이터(Postgres·PV)는 담지 않음"(상세 상시).

### 5.2 목록 (ASM 3.1 대응)
행 항목: 파일 상태 배지, **드리프트 배지**(4.6·4.5, 최신이 아니면 "계산 안 함" 또는 마지막 결과 + 시각), 스냅샷 시각(로컬/UTC 툴팁), 라벨, **클러스터**(컨텍스트 이름. 대시보드 클러스터와 다르면 "다른 클러스터" 표시), **범위 요약**(네임스페이스 수·규칙, 종류 수), **리소스 수**(현재 파일 기준, 내보내기 당시와 다르면 함께), **직전 대비**(같은 클러스터의 바로 이전 스냅샷 대비 리소스 수 증감), 현재 스캔(오류·경고), 마지막 수정(대시보드 수정 표시), CLI 버전.
- 필터: 파일 상태, 드리프트 상태, 클러스터, 라벨·메모 검색. 정렬: 최신순(기본), 상태 나쁜 순.
- 요약 띠: ASM과 같음 + 대시보드가 연결된 클러스터 이름.

### 5.3 상세 (ASM 3.2 대응)
- **A. 요약**: ASM과 같음(내보내기·적용 버튼 **없음**). 상시 안내: "대시보드는 git에 커밋하지 않습니다", "적용은 사람이 `kubectl diff` 확인 후 `kubectl apply`로 직접 하세요(README)", "이 스냅샷은 Postgres·PV 데이터를 담지 않습니다"(3.9).
- **B. 메타데이터**: `metadata.json` 표(3.8 항목) + 원문 보기(편집 불가). 주의 표시: 부분 내보내기, 다른 클러스터, 시스템 네임스페이스 포함, strict.
- **C. 리소스 구성**: 네임스페이스 → 종류 → 리소스 트리(또는 표). 리소스마다 파일 경로, Helm 관리 여부, 스캔 발견 수, 드리프트 구분(계산된 경우). 종류별·네임스페이스별 개수, 내보내기 당시 수와 비교, 제외 규칙으로 뺀 수.
- **D. 비밀값 스캔**: ASM 3.2 D와 같음(발견 클릭 → 해당 파일·줄). 규칙 도움말에 쿠버네티스 규칙과 처리 방법(`valueFrom.secretKeyRef`로 바꾸기, `# snapshot-scan: allow`) 추가.
- **E. 파일 보기·편집**: 리소스 파일을 C에서 골라 연다. 줄 번호, 발견 줄 표시, 편집(5.4). `metadata.json`, `secret-refs.json`은 보기 전용.
- **F. 드리프트** (신규): 4.7. 최신 스냅샷이면 자동 결과, 아니면 "드리프트 계산" 버튼. 다른 클러스터·클러스터 연결 없음이면 버튼 비활성 + 이유.
- **G. Secret 참조** (Q1 결정): 워크로드가 참조하는 Secret 이름 목록(값 없음)과 "복원 전에 이 Secret들을 별도 보관소에서 만들어야 합니다" 안내.

### 5.4 편집 (ASM 3.7과 다른 점)
- **편집 가능 파일**: 리소스 YAML(`namespace.yaml` 포함). `metadata.json`, `notes.json`(라벨·메모 화면으로만), `secret-refs.json`은 편집 불가.
- **파일 지정**: ASM은 "정해진 파일 종류 4개"로만 지정했지만 k8s는 파일이 많다. 요청은 스냅샷 ID + **3.8 경로 규칙에 맞는 상대 경로**(또는 서버가 목록에서 준 식별값, 방식은 백엔드)로 지정한다. 경로 규칙에 안 맞거나 스냅샷 안에 없는 파일, `..`·절대경로·링크는 거부(ASM 3.9와 같은 수준). **새 파일 만들기·이름 바꾸기·파일 하나만 삭제는 없다.**
- **저장 전 검사** (ASM 3.7 흐름 그대로 + 추가):
  - YAML 구문 오류 → 경고 + 확인 후 저장(ASM과 같음).
  - 여러 문서(`---`)가 들어감 → 경고("리소스 1개 = 파일 1개 규칙과 다름") + 확인 후 저장.
  - `kind`/`metadata.namespace`/`metadata.name`이 파일 경로와 다르게 바뀜 → 경고 + 확인 후 저장(저장 후 파일 상태 주의, 5.1).
  - `kind: Secret`에 값 추가 → 스캔 오류(`k8s-secret-object`)라 ASM Q3대로 "커밋 금지" 추가 확인.
  - 리소스 수 감소 확인(ASM AC-27)은 파일 하나 단위라 해당 없음(파일당 1개).
- 편집 상한 5 MB·원자적 저장·인코딩/줄바꿈 유지·버전 충돌 거부·"원본을 직접 고칩니다" 안내: ASM과 같음.
- 저장 후 재스캔(ASM과 같음) + **드리프트 재계산**(그 스냅샷이 자동 계산 대상이거나 드리프트 화면이 열려 있으면, 4.5).

### 5.5 메뉴 확장과 기존 URL·동작 호환
- 사이드바 메뉴 이름 **"AWS 스냅샷" → "스냅샷"**. 아이콘·그룹(`로컬 파일`)은 그대로(디자인 확인).
- 메뉴 상태 = **AWS 스냅샷 파일 상태와 k8s 스냅샷 파일 상태 중 최악**. 메뉴 숫자 = 두 쪽 장애(커밋 금지) 수의 합. **드리프트는 메뉴 상태에 넣지 않는다**(Q2 결정). 한쪽 출처가 설정 없음(`not_configured`)이면 그쪽은 메뉴 계산에서 빼고, 둘 다 설정 없음이면 ASM-API 6.1 "설정 없음" 규칙대로 아이콘을 그리지 않는다.
- 클러스터 전체 상태·개요(`/`)에 넣지 않는다(ASM 3.4와 같음). 드리프트도 넣지 않는다.
- 페이지 안에 **AWS / Kubernetes 탭**. 탭마다 파일 상태 배지와 장애 수, Kubernetes 탭에는 최신 스냅샷 드리프트 건수.
- **호환 (필수)**
  - 기존 화면 주소 `/snapshots`, `/snapshots/[id]`, `/snapshots/trash`와 필터 쿼리(`?status=…&region=…&q=…`)는 **지금처럼 AWS 스냅샷을 연다**. 기존 즐겨찾기·링크가 깨지지 않는다.
  - `/snapshots`를 탭 없이 열면 AWS 탭이 기본이다.
  - Kubernetes 탭 주소는 별도 경로로 둔다(예 `/snapshots/k8s`, `/snapshots/k8s/[id]`, `/snapshots/k8s/trash`. 최종은 프론트). 두 종류의 스냅샷 ID 형식이 같아 같은 ID가 양쪽에 있을 수 있으므로, **ID만으로 종류를 추측하지 않는다**. `k8s`는 ID 형식에 맞지 않아 기존 `[id]`와 겹치지 않는다.
  - 기존 API(`/api/aws-snapshots/**`), SSE 토픽 `aws-snapshots`, mock 그룹 `snapshots`, 출처 `snapshotStore`, 환경 변수 `AWS_SNAPSHOT_*`, `notes.json` 형식, 휴지통 위치는 **바꾸지 않는다**. k8s는 별도 API 경로·토픽·출처·설정을 쓴다(이름은 백엔드).
  - AWS 탭의 동작·수용 기준(ASM AC-01~51)은 그대로 유지된다. 단 ASM AC-21의 "메뉴 상태 = 스냅샷 상태 중 최악"은 위 합산 규칙으로 넓어진다.

### 5.6 CLI 안내 (ASM 3.10 대응)
Kubernetes 탭 빈 상태와 "새 스냅샷 만들기 안내"에 복사 버튼과 함께(대시보드는 실행하지 않음):
- 설치 `npm install --prefix deploy/k8s-snapshot` → 설정 `.env.example` 복사 후 컨텍스트 지정 → 미리 보기 `npm run export:dry --prefix deploy/k8s-snapshot` → 내보내기 `npm run export --prefix deploy/k8s-snapshot` → 재스캔 `npm run scan --prefix deploy/k8s-snapshot -- snapshots/<id>`
- 종료코드 표(0/1/2/3/4), "내보내기 전용 읽기 역할·컨텍스트는 README" 문구, 적용 안내("대시보드에는 적용 기능이 없습니다. `kubectl diff` → `kubectl apply`를 직접"), 데이터 백업 안내(3.9).
- 형상관리 안내(U7): "이 스냅샷을 운영 매니페스트의 출발점으로 쓰려면 README 'git으로 관리 시작하기'를 보세요."

### 5.7 mock (ASM 3.12 대응)
- 예시 k8s 스냅샷과 예시 드리프트는 **메모리**에만. 편집·라벨·삭제·휴지통은 메모리에서만, `POST /api/mock/reset`·재시작으로 원상태. 실제 `deploy/k8s-snapshot/snapshots/`는 읽지도 쓰지도 않는다. 스캔은 실제 스캐너 규칙으로.
- mock의 "현재 클러스터"는 기존 mock 클러스터 데이터(`cluster-status` mock)와 **어긋나지 않게** 한다(예시 드리프트의 클러스터 쪽 값이 클러스터 화면의 mock 값과 같아야 함. 맞추는 방법은 백엔드).
- 예시(기본 시나리오에서 한꺼번에 보이게, 최소 1개씩):
  1. 최신 스냅샷: 파일 정상 + **드리프트 주의** — 변경(Deployment 이미지 태그, 메모리 limit), 삭제(Ingress 1개), 추가(새 Deployment 1개), 숨긴 기본값 차이(예: `terminationMessagePolicy` 없음) 여러 건, 관리 필드(HPA replicas) 1건, 비교 불가 종류(ConfigMap·NetworkPolicy·CronJob), 가림 대상 값(env value) 차이 1건
  2. 파일 정상 + 드리프트 "차이 없음"(시나리오 전환으로 최신에 적용하거나 별도 예시)
  3. 장애: `k8s-env-literal`(Postgres StatefulSet `POSTGRES_PASSWORD` 리터럴, 값은 누가 봐도 가짜 `example-password`)
  4. 장애: `kind: Secret` 값이 든 파일
  5. 장애: `metadata.json` 손상
  6. 주의: 부분 내보내기(networkpolicies 권한 없음)
  7. 주의: YAML 해석 실패 파일 + 경로·내용 불일치 + 예상 밖 파일
  8. 알 수 없음: 내보내기 진행 중일 수 있음
  9. 다른 클러스터의 스냅샷(드리프트 알 수 없음)
  10. 라벨·메모가 있고 대시보드에서 편집된 스냅샷, Helm 관리 리소스 포함
  - 휴지통 예시 1개
- 시나리오 전환(`docs/api/common.md` 6절, 그룹은 백엔드): 스냅샷 0개, 폴더 설정 없음, 폴더 없음, 읽기 전용, 쓰기 꺼짐, 저장 충돌 한 번, **클러스터 연결 없음(드리프트 알 수 없음)**, **드리프트 없음**.
- 예시 비밀값은 누가 봐도 가짜인 값만(ASM 3.12와 같음).

## 6. 수용 기준

번호는 `AC-K01`부터. ASM과 같은 규칙은 "ASM AC-nn을 k8s 탭에 적용"으로 적는다.

**CLI**
- [ ] AC-K01. Given 컨텍스트 설정 없음 / When `export` / Then 종료코드 2, 클러스터 호출 없음, 폴더 없음. kubeconfig의 current-context를 쓰지 않는다.
- [ ] AC-K02. Given 올바른 설정 / When `export:dry` / Then 컨텍스트·네임스페이스 규칙·종류 목록이 출력되고 클러스터 호출·파일 생성이 없다.
- [ ] AC-K03. Given 모르는 종류 이름, 또는 네임스페이스 포함·제외 동시 지정 / Then 종료코드 2.
- [ ] AC-K04. Given 정상 내보내기 / Then `snapshots/<UTC 시각>/`에 3.8 구조(리소스 1개 = 파일 1개, `metadata.json` 3.8 항목)가 생기고 종료코드 0.
- [ ] AC-K05. 내보낸 모든 파일에 3.6 제거 대상(`status`, `managedFields`, `resourceVersion`, `uid`, `creationTimestamp`, `generation`, last-applied 어노테이션, 헤드리스가 아닌 Service `clusterIP`, PVC `volumeName` 등)이 없다. 헤드리스 Service의 `clusterIP: None`은 남아 있다.
- [ ] AC-K06. 내보낸 결과에 Secret 객체와 Secret 값이 없다. Pod·ReplicaSet·Event·Endpoints 등 3.4 "항상 제외"와 소유자 있는 객체가 없다.
- [ ] AC-K07. Given 클러스터 변경 없이 두 번 내보냄 / Then 두 스냅샷 폴더의 리소스 파일 내용이 같다(`metadata.json`의 시각 등만 다름).
- [ ] AC-K08. Given 네임스페이스 설정 비움 / Then 시스템 네임스페이스(3.5 목록)가 빠지고, `metadata.json`에 범위 규칙과 실제 네임스페이스 목록이 있다.
- [ ] AC-K09. Given env 이름 `POSTGRES_PASSWORD`에 `value:` 리터럴 / Then 스캔 오류 `k8s-env-literal`, 종료코드 1, 폴더 남음, 출력에 값 원문 없음. `valueFrom.secretKeyRef`면 발견 없음.
- [ ] AC-K10. Given 일부 종류가 권한 없음 / Then 종료코드 4, 폴더 남음, `metadata.kinds`에 `forbidden`.
- [ ] AC-K11. Given 접속 실패 또는 리소스 0개 / Then 종료코드 3, 폴더 없음.
- [ ] AC-K12. `metadata.json`·출력에 kubeconfig 경로·서버 URL·토큰·인증서·로컬 절대경로가 없고, `cluster.id`(kube-system UID)·컨텍스트 이름·서버 버전이 있다.
- [ ] AC-K13. CLI가 쿠버네티스 API에 get/list 외의 동사(서버 측 dry-run 포함)를 쓰지 않는다(테스트로 확인).
- [ ] AC-K14. `npm run scan --prefix deploy/k8s-snapshot -- snapshots/<id>` 결과가 대시보드 현재 스캔과 같다(ASM AC-08의 k8s판). aws-snapshot 스캐너의 기존 테스트가 계속 통과한다(규칙 한 벌).
- [ ] AC-K15. README에 내보내기 전용 읽기 역할 예시(secrets 없음), 사용법, 종료코드, 적용 절차(`kubectl diff` → `kubectl apply`, 사람이), Postgres·PV 데이터 백업 안내, git으로 관리 시작하기 안내가 있다.

**메뉴·호환**
- [ ] AC-K16. 사이드바 메뉴 이름이 "스냅샷"이고, 상태 = AWS·k8s 파일 상태 중 최악, 숫자 = 양쪽 커밋 금지 수 합. 드리프트는 메뉴 상태·개요·클러스터 전체 상태에 영향이 없다.
- [ ] AC-K17. 기존 `/snapshots`, `/snapshots/<id>`, `/snapshots/trash`, 필터 쿼리 주소가 지금처럼 AWS 스냅샷을 연다. `/snapshots`의 기본 탭은 AWS.
- [ ] AC-K18. 같은 ID의 스냅샷이 AWS·k8s 양쪽에 있어도 각 탭 주소가 서로 다른 스냅샷을 연다.
- [ ] AC-K19. 기존 `/api/aws-snapshots/**` 응답·SSE `aws-snapshots`·mock 그룹 `snapshots`가 바뀌지 않고, ASM AC-01~51이 계속 통과한다(AC-21은 AC-K16으로 넓어짐).

**k8s 스냅샷 관리 (ASM 재사용)**
- [ ] AC-K20. ASM AC-05~07, 10~12의 목록·상세 규칙이 k8s 탭에 적용된다(5.2·5.3 항목, 내보내기·적용 버튼 없음).
- [ ] AC-K21. 5.1 표의 각 조건이 해당 상태·사유로 보인다(ASM AC-13~20의 k8s판 + 부분 내보내기·YAML 해석 실패·경로 불일치·중복 정의·런타임 필드 남음).
- [ ] AC-K22. 편집: ASM AC-22~31, 33이 k8s 리소스 파일에 적용된다. `metadata.json`·`secret-refs.json`은 편집할 수 없다(화면·API 모두).
- [ ] AC-K23. Given 편집에서 `metadata.name`을 파일 경로와 다르게 바꾸거나 `---`로 문서를 더함 / When 저장 / Then 경고 + 확인 후 저장되고, 파일 상태에 해당 주의 사유가 보인다.
- [ ] AC-K24. 요청으로 경로 규칙 밖 파일, `..`·절대경로·인코딩된 구분자, 링크를 지정하면 거부되고 스냅샷 루트 밖 파일은 읽히거나 바뀌지 않는다. 새 파일 만들기·이름 바꾸기·파일 하나 삭제 API가 없다.
- [ ] AC-K25. 라벨·메모·삭제·휴지통(복원·영구 삭제·같은 ID 복원 거부): ASM AC-34~39가 k8s 탭에 적용된다. 휴지통은 CLI `npm run scan`과 git에서 제외된다.
- [ ] AC-K26. live 설정: ASM AC-45~50의 k8s판(설정 없음·폴더 없음·읽기 전용, `snapshots/` 폴더만 쓰기 마운트, `.env` 비노출, health에 k8s 스냅샷 폴더 출처).
- [ ] AC-K27. 파일 관리 기능(목록·상세·편집·라벨·삭제)은 쿠버네티스 API·AWS API·모니터링 대상 DB를 호출하지 않고 `git`·CLI를 실행하지 않는다.

**드리프트**
- [ ] AC-K28. Given 같은 클러스터 최신 스냅샷 / When 클러스터에서 Deployment 이미지를 바꿈 / Then 30초 이내에 드리프트가 주의 "변경 1"이 되고 필드 경로·양쪽 값이 보인다.
- [ ] AC-K29. Given 스냅샷에 있는 Ingress가 클러스터에서 지워짐 / Then "삭제됨". Given 스냅샷 범위 안 네임스페이스에 새 Service가 생김 / Then "추가됨". 범위 밖 네임스페이스·항상 제외 종류·소유자 있는 객체는 추가됨에 나오지 않는다.
- [ ] AC-K30. Given 스냅샷 파일에서 기본값 필드(예 `terminationMessagePolicy: File`, Service `sessionAffinity: None`)를 지움 / Then 드리프트 건수·상태가 바뀌지 않고 "기본값 차이 N건 숨김"으로만 보이며 펼쳐 볼 수 있다.
- [ ] AC-K31. Given HPA가 대상으로 삼는 Deployment의 replicas가 스냅샷과 다름 / Then "관리 필드(HPA가 관리)"로 숨겨지고 건수에 들어가지 않는다. HPA가 없는 워크로드의 replicas 차이는 "변경"이다.
- [ ] AC-K32. 수량 표기 차이(`1Gi`/`1024Mi`, `1000m`/`1`)와 이름 있는 목록 순서 차이는 차이로 나오지 않는다.
- [ ] AC-K33. ConfigMap·NetworkPolicy 등 대시보드 RBAC 밖 종류는 "비교 불가 (대시보드 권한 밖)"와 개수로만 보이고 드리프트 상태에 영향이 없다. 대시보드 RBAC(`deploy/rbac.yaml`)는 이 기능 때문에 바뀌지 않는다.
- [ ] AC-K34. 드리프트 계산 중 쿠버네티스 API 호출은 get/list/watch뿐이다(서버 측 dry-run 없음).
- [ ] AC-K35. Given 스냅샷 `cluster.id`가 대시보드 클러스터와 다름 / Then 드리프트 알 수 없음("다른 클러스터"), 계산 버튼 비활성. Given 클러스터 연결 없음 / Then 알 수 없음("클러스터 연결 없음").
- [ ] AC-K36. 최신이 아닌 스냅샷은 자동 계산하지 않고, "드리프트 계산"을 누르면 결과가 나온다.
- [ ] AC-K37. Given 스냅샷 파일을 편집해 클러스터와 같게 맞춤 / When 저장 / Then 30초 이내에 드리프트가 다시 계산되어 해당 차이가 사라진다.
- [ ] AC-K38. `env[].value`·`command`·`args`·스캐너 규칙에 걸리는 값의 차이는 가려진 값으로만 보이고, 드리프트 응답·SSE·서버 로그 어디에도 원문이 없다. SSE에는 필드 값이 없다.
- [ ] AC-K39. 드리프트 화면에 명령 예시(`kubectl diff`/`kubectl apply`)는 복사만 되고, 대시보드에 적용·실행 수단이 없다.
- [ ] AC-K40. 클러스터 출처가 stale이면 드리프트 결과가 stale 표시와 함께 유지된다.

**mock**
- [ ] AC-K41. Given `DATA_SOURCE=mock` / Then 5.7 예시 1~10과 휴지통 예시가 보이고 각 파일 상태·드리프트 상태가 명세대로이며 "MOCK 데이터" 배지가 보인다.
- [ ] AC-K42. mock에서 `deploy/k8s-snapshot/snapshots/`의 실제 파일이 읽히거나 바뀌지 않고, reset·재시작으로 원래 예시로 돌아간다.
- [ ] AC-K43. mock 시나리오 전환으로 5.7의 추가 상황(0개, 설정 없음, 폴더 없음, 읽기 전용, 쓰기 꺼짐, 저장 충돌, 클러스터 연결 없음, 드리프트 없음)을 재현할 수 있다.
- [ ] AC-K44. mock 예시 드리프트의 클러스터 쪽 값이 같은 mock 모드의 클러스터 화면 값과 모순되지 않는다.

## 7. 범위 밖
- 대시보드에서 내보내기 실행, 적용(`kubectl apply`/`diff` 실행, Helm 실행), 클러스터·AWS에 대한 모든 쓰기. 서버 측 dry-run.
- 대시보드 RBAC 확장(Q3 결정: 확장 없음. 필요해지면 별도 결정). Secret 값 보관·표시.
- Postgres 데이터·PV 내용 백업·복원, VolumeSnapshot 생성(안내만, 3.9).
- 스냅샷끼리 비교(스냅샷 A vs B), 드리프트 알림(Slack 등), 드리프트 이력 그래프.
  - (2026-09-20 PM 결정) 스냅샷끼리 **식별값 수준**(생김·없어짐) 비교는 `docs/specs/snapshot-3d.md`에서 다룬다(1단계는 k8s만). 필드 비교와 드리프트 이력 그래프는 계속 범위 밖이다.
  - (2026-09-25) `alerts` 기능이 생긴 뒤에도 **드리프트 알림은 그대로 범위 밖이다.** `docs/specs/alerts.md` 3.1의 알림 키 8개에 스냅샷·드리프트가 없고, `snapshotStore`·`k8sSnapshotStore` 출처의 알림도 명시적으로 범위 밖이다(`alerts` 6절). 드리프트를 사이드바 메뉴 상태에 넣지 않는다는 기존 결정도 그대로다.
- 사용자별 드리프트 무시 규칙 설정 화면(규칙은 서버 표로만. 가짜 차이는 스냅샷 편집으로 맞춤).
- git 연동(커밋·상태 표시), 스냅샷을 "운영 매니페스트 폴더"로 복사·변환하는 기능(README 안내만).
- Helm 릴리스·values 내보내기, Kustomize 구조 생성, 여러 클러스터 동시 드리프트.
- 새 리소스 파일 추가, 파일 이름 바꾸기, 파일 단위 삭제, 여러 스냅샷 한꺼번에 삭제.
- 클러스터에 배포된 대시보드에서 이 기능 쓰기(스냅샷 폴더 없음 → 설정 없음).
- kOps 클러스터의 설계도(S3 state store의 `Cluster`·`InstanceGroup`) 스냅샷 — `deploy/kops-snapshot/`으로 폴더 이름만 예약하고 **다음 범위**(`kops-support` 8절).
- 어드바이저에 k8s 스냅샷·드리프트를 넘기는 것.
- CLI의 드리프트 명령(대시보드에서만).

## 8. 역할별 전달 사항

**디자인**
- 메뉴 이름 "스냅샷", AWS / Kubernetes 탭(탭마다 상태 배지·커밋 금지 수, k8s 탭은 드리프트 건수), 기존 AWS 화면 레이아웃 유지.
- k8s 목록: 파일 상태 배지와 **드리프트 배지 두 개**를 헷갈리지 않게(드리프트는 장애가 없음, "계산 안 함" 표현), 클러스터 열·"다른 클러스터" 표시.
- 상세: 리소스 트리(네임스페이스→종류→리소스, 파일 많음 수백 개), 파일 보기·편집(ASM 재사용), 드리프트 탭(요약 / 리소스 목록 / 필드 diff / 숨긴 차이 펼침 / 비교 불가 / 가린 값 / 명령 복사), Secret 참조 목록.
- 저장 전 검사 확인 창에 경로·내용 불일치, 여러 문서 경고 추가.
- mock 시나리오 Popover에 k8s 스냅샷 그룹.

**퍼블리싱**
- 필드 diff 표(경로, 양쪽 값, 분류·이유 칩, 가린 값 표시), 리소스 트리, 드리프트 요약 카드, 두 배지 행 레이아웃. 기존 코드 보기/편집·명령 복사·ID 입력 확인 창 재사용.

**프론트**
- 기존 `/snapshots`, `/snapshots/[id]`, `/snapshots/trash`와 쿼리 호환(AC-K17~19). k8s 탭 경로 추가(ID만으로 종류 추측 금지).
- 메뉴 상태·숫자 합산(AC-K16), 한쪽 설정 없음 처리.
- k8s 파일 편집은 ASM 편집 흐름 재사용(버전 충돌·이탈 방지), 파일 지정은 서버가 준 경로/식별값만.
- 드리프트: 서버 값 표시만(상태·분류·가림을 화면에서 계산하지 않음), "드리프트 계산" 요청, 화면을 떠나면 갱신 중지.

**백엔드**
- `deploy/k8s-snapshot/` CLI(3절), README, `.env.example`, `.gitignore`, 내보내기 전용 읽기 역할 예시(`rbac/`), `node:test`.
- 스캐너 규칙 한 벌 유지 + 쿠버네티스 규칙 추가(3.7). aws-snapshot CLI·대시보드 결과가 바뀌지 않게(기존 테스트 통과). `maskValue` 재사용.
- 정리 규칙(3.6)과 기본값·관리 필드 표(4.4)를 **CLI와 대시보드가 같은 원본**으로 쓰게(규칙 버전 `cleanup.rulesVersion`). 쿠버네티스 버전별 기본값 차이 확인.
- 계약 `docs/api/k8s-snapshot.md`: 목록·상세·파일 보기/검사/저장·라벨·삭제·휴지통(ASM-API 재사용), 드리프트 조회·계산 요청, SSE 토픽(값 없이 알림만), 출처(k8s 스냅샷 폴더), mock 그룹. 기존 ASM API·토픽·그룹 불변.
- 드리프트 데이터: 기존 RBAC 안에서(informer 재사용 또는 get/list), `spec` 전체 필요(현재 informer가 추린 값만 들고 있는지 확인). 쓰기 동사·서버 측 dry-run 금지. 대시보드 클러스터 식별(`kube-system` UID).
- 비교 가능 종류 목록을 한 곳에서 관리(RBAC와 일치 여부 테스트 권장).
- 드리프트 결과 보관(메모리/DB) 결정 — DB면 DBA와 협의.
- docker compose: `deploy/k8s-snapshot/snapshots`만 쓰기 가능 마운트 + 스캐너 lib 읽기 전용, `app.example.yaml`에는 넣지 않음.
- 로그·오류·SSE에 파일 내용·라벨·메모·가림 대상 값 금지.
- `deploy/aws-snapshot/README.md` 8장 "쿠버네티스 리소스" 행을 `deploy/k8s-snapshot` 안내로 갱신.

**DBA**
- 기본적으로 **할 일 없음**(라벨·메모는 폴더 안 파일). 백엔드가 드리프트 결과를 대시보드 자체 DB에 보관하기로 하면 테이블 설계 협의. Postgres 데이터 백업 안내 문구(3.9) 검토(`pg_dump` 옵션·암호화 보관 권고가 맞는지).

**기존 문서와의 충돌·추가**
- `CLAUDE.md` 확정된 결정: 기능 목록에 5번 `k8s-snapshot` 추가, 기능 4 메뉴 이름 "AWS 스냅샷" → "스냅샷". → PM 반영 완료(2026-09-19).
- ASM U1·3.4·AC-21(메뉴 "AWS 스냅샷", 메뉴 상태 = AWS 스냅샷 상태 최악) ↔ 이 명세 5.5(메뉴 "스냅샷", 두 쪽 합산). 이 명세가 우선하며 ASM의 나머지 규칙은 유지된다. PM 결정(2026-09-19)으로 ASM 명세 U1·3.4·AC-21을 이 규칙에 맞춰 수정했다(ASM 9절 변경 이력).
- ASM 3.9 / AC-44 "쿠버네티스 API 호출 0회": AWS 탭과 k8s 파일 관리 기능에는 그대로. **드리프트만** 기존 RBAC로 읽기 호출을 한다(4.1).
- `CLAUDE.md` 어드바이저 규칙 "환경 변수·command/args·어노테이션 원문 제외": 어드바이저 전송 규칙이다. 스냅샷 파일은 사람용 로컬 파일이라 env·어노테이션을 담는다(재적용에 필요). 드리프트 화면은 env value·command·args를 가린다(4.7).
- `deploy/rbac.yaml` 주석 "configmaps 없음": 유지. 그래서 ConfigMap은 드리프트 "비교 불가".
- `deploy/aws-snapshot/README.md` 8장 "쿠버네티스 리소스는 `deploy/` 매니페스트가 기준": `deploy/`에는 대시보드 자신의 매니페스트만 있다. 운영 워크로드는 이 기능으로 기록한다고 갱신(백엔드).
- `docs/api/common.md`: 출처·health `checks`·SSE 토픽·mock 그룹 추가(백엔드).
- `docs/design/shell.md` 메뉴 9번 라벨(디자인).

## 9. 열린 질문

- 없음.

### 결정됨 (2026-09-19, 사용자)

Q1~Q4 모두 **권장안으로 확정**했다. 아래는 검토한 선택지와 결정 기록이다.

- **Q1 → A (Secret을 읽지 않음, 참조 이름만 `secret-refs.json`)**, **Q2 → A (드리프트는 메뉴 상태에 반영하지 않음)**, **Q3 → A (대시보드 RBAC 확대 없음)**, **Q4 → A (`cluster.id` 없으면 드리프트 계산 안 함)**.

- **Q1. Secret을 어떻게 다루나?** (U1 "Secret 값 제외"의 구체화)
  - A. **Secret을 전혀 읽지 않는다.** 내보내기 역할에 `secrets` 권한 자체를 주지 않는다. 대신 워크로드가 참조하는 Secret 이름(`secretKeyRef`, `envFrom.secretRef`, `volumes.secret`, `imagePullSecrets`, Ingress TLS `secretName`)을 매니페스트에서 모아 `secret-refs.json`(이름·참조 위치만)에 적는다. 값이 메모리에도 들어오지 않는다. 단점: 참조되지 않는 Secret, Secret의 키 이름·타입은 모른다.
  - B. Secret의 이름·타입·**키 이름**만 담은 뼈대 YAML(값은 빈 문자열). 복원 준비가 쉽지만 내보내기 역할에 secrets get/list가 필요해 값이 CLI 메모리까지 온다(쿠버네티스에는 "값 없이 목록" 권한이 없다).
  - C. 완전히 제외하고 목록도 남기지 않는다.
  - **권장: A.** 값을 읽을 권한 자체를 없애는 것이 가장 안전하고, 복원에 필요한 "무엇을 만들어야 하나"는 참조 목록으로 대부분 알 수 있다.
- **Q2. 드리프트를 사이드바 메뉴 상태에 반영하나?**
  - A. **반영하지 않는다.** 메뉴는 파일 상태(커밋 금지)만. 드리프트 건수는 Kubernetes 탭과 목록에만.
  - B. 최신 스냅샷 드리프트가 있으면 메뉴를 주의로.
  - **권장: A.** 스냅샷은 과거 기록이라 시간이 지나면 거의 항상 차이가 나서, B면 메뉴가 늘 주의가 되고 "커밋 금지" 신호가 흐려진다.
- **Q3. 드리프트 비교 범위를 넓히려고 대시보드 RBAC를 늘리나?**
  - A. **늘리지 않는다**(U4 기본 전제). ConfigMap·ServiceAccount·Role·RoleBinding·NetworkPolicy·CronJob·ResourceQuota·LimitRange는 "비교 불가".
  - B. 값에 비밀이 들어가기 어려운 종류만 get/list/watch 추가: networkpolicies, serviceaccounts, roles, rolebindings, cronjobs, resourcequotas, limitranges. **configmaps·secrets는 추가하지 않음.** 비교 범위가 넓어지지만 `CLAUDE.md` RBAC 목록 변경·재적용이 필요하다.
  - **권장: A**로 시작하고, 써 보고 필요하면 B를 별도 결정으로.
- **Q4. `cluster.id`가 없는 스냅샷(메타 손상·손으로 만든 폴더)의 드리프트는?**
  - A. **계산하지 않는다**(알 수 없음 "클러스터를 확인할 수 없음").
  - B. 사용자가 "이 클러스터와 비교" 확인 후 계산.
  - **권장: A.** 다른 클러스터와 비교하면 "전부 삭제됨/추가됨" 같은 오해를 부른다. 메타가 손상된 스냅샷은 이미 장애 상태라 먼저 고치는 것이 맞다.

### 권장안으로 정하고 넘어간 사소한 결정 (다르면 알려 주세요)
- ConfigMap은 기본 포함(재적용에 필요), 스캔 대상, 드리프트는 비교 불가.
- 시스템 네임스페이스(`kube-system` 등) 기본 제외, 설정으로 포함 가능.
- Helm 관리 리소스 기본 포함 + "Helm으로 복원" 안내.
- Job·클러스터 범위 종류·PV·CRD 인스턴스는 선택(기본 꺼짐).
- 리소스 1개 = 파일 1개, `<namespace>/<kind>/<name>.yaml`.
- 기본값 필드는 내보낼 때 지우지 않고 드리프트에서 숨김 처리.
- 부분 성공 종료코드 4 신설.
- 드리프트는 장애 상태가 없음(정상/주의/알 수 없음).
- 자동 드리프트는 같은 클러스터의 최신 스냅샷만, 나머지는 요청 시.
- 드리프트 화면에서 env value·command·args·스캐너 규칙에 걸리는 값은 가림, 어노테이션은 보임.
- 기존 AWS 스냅샷 URL·API·토픽 불변, k8s는 별도 경로.
