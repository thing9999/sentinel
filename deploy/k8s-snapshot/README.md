# k8s-snapshot: 쿠버네티스 매니페스트를 YAML 스냅샷으로 내보내기 (대시보드 밖 도구)

현재 클러스터의 쿠버네티스 리소스를 **다시 적용할 수 있는 YAML**(리소스 1개 = 파일 1개)로 내보내 git에 보관한다.
나중에 사람이 검토해서 **수동으로** 다시 적용할 수 있게 하는 것이 목적이다.

- 대시보드(`apps/api`, `apps/web`)와 관계없는 독립 스크립트다. 대시보드의 ServiceAccount·역할(`deploy/rbac.yaml`의 `sentinel-readonly`)·kubeconfig 설정을 **쓰지 않는다**.
- **조회 전용.** 쿠버네티스 API에 `GET`(get/list)만 보낸다. watch·exec·logs·port-forward·proxy·서버 측 dry-run·`kubectl`을 쓰지 않는다.
- **Secret은 읽지 않는다.** 워크로드가 참조하는 Secret **이름**만 `secret-refs.json`에 남긴다.
- **적용 기능은 없다.** 되살리는 절차는 7장을 따라 사람이 직접 한다.
- 대시보드 "스냅샷" 메뉴의 Kubernetes 탭에서 이 폴더의 결과를 보고·고치고·지울 수 있다(대시보드는 내보내기·적용을 하지 않는다).

## 목차
1. [폴더 구성](#1-폴더-구성)
2. [설치](#2-설치)
3. [내보내기 전용 읽기 역할·컨텍스트](#3-내보내기-전용-읽기-역할컨텍스트)
4. [사용법·설정·종료코드](#4-사용법설정종료코드)
5. [비밀값 스캔](#5-비밀값-스캔)
6. [커밋 전 체크리스트](#6-커밋-전-체크리스트)
7. [복원(다시 적용) 절차](#7-복원다시-적용-절차)
8. [Postgres·PV 데이터 (이 스냅샷에 없음)](#8-postgrespv-데이터-이-스냅샷에-없음)
9. [git으로 관리 시작하기](#9-git으로-관리-시작하기)
10. [제외 규칙·자동 생성 목록](#10-제외-규칙자동-생성-목록)
11. [문제 해결](#11-문제-해결)

---

## 1. 폴더 구성

```
deploy/k8s-snapshot/
├─ export.mjs              내보내기 (종료코드 4장)
├─ scan.mjs                다시 스캔 (../aws-snapshot/lib/scan.mjs 를 k8s 프로필로)
├─ lib/                    config · kinds · layout · rules · kube · secret-refs · meta · yaml-out
│                          (kinds·layout·rules 는 대시보드 api 도 같은 파일을 불러 쓴다 — 규칙 한 벌)
├─ rbac/export-readonly.yaml   내보내기 전용 읽기 역할 예시 (사람이 적용)
├─ test/                   node:test (가짜 클러스터 응답, 실제 클러스터 호출 없음)
├─ snapshots/<YYYYMMDD-HHmmss>/        ← git에 커밋하는 결과 (UTC)
│  ├─ metadata.json        CLI 가 마지막에 쓴다 (클러스터 ID·범위·종류별 결과·스캔 결과)
│  ├─ secret-refs.json     참조되는 Secret 이름·키 이름 목록 (값 없음)
│  ├─ notes.json           (있을 때만) 대시보드 라벨·메모·편집 기록
│  ├─ _cluster/<종류>/<이름>.yaml       클러스터 범위 선택 종류를 켰을 때만
│  └─ <네임스페이스>/
│     ├─ namespace.yaml
│     └─ <종류>/<이름>.yaml             리소스 1개 = 파일 1개
├─ snapshots/.trash/       (git 제외) 대시보드 휴지통
├─ .env.example / .gitignore
└─ README.md
```

- `<종류>`는 소문자 복수형(`deployments`, `configmaps`, `horizontalpodautoscalers`), 사용자 지정 리소스는 `<plural>.<group>`.
- `<이름>`은 쿠버네티스 이름 그대로다. 단 `[a-z0-9.-]` 밖의 문자(RBAC 이름의 `:`·대문자 등)는 `~XX`(UTF-8 바이트, 대문자 16진)로 바꾸고, Windows 예약 이름(`con`, `nul`, `com1` …)은 첫 글자를 `~XX`로 바꾼다. 예: `system:foo` → `system~3Afoo.yaml`, `Reader:All` → `~52eader~3A~41ll.yaml`.
- 쓰는 도중에는 `snapshots/.<ID>.partial/`에 쓰고, `metadata.json`을 마지막에 쓴 뒤 이름을 바꾼다. 실패(종료코드 3·99)하면 임시 폴더를 지운다.
- 로컬 절대경로·사용자 이름·kubeconfig 경로·서버 URL·토큰·인증서는 어떤 파일에도 남기지 않는다.

## 2. 설치

```bash
npm install --prefix deploy/k8s-snapshot
cp deploy/k8s-snapshot/.env.example deploy/k8s-snapshot/.env   # KUBE_CONTEXT 를 채운다
```

- Node 22 이상. `@kubernetes/client-node`와 `yaml`만 쓴다. `kubectl`은 필요 없다(kubeconfig에 exec 플러그인이 있으면 그대로 따른다).
- 스캐너는 `deploy/aws-snapshot/lib/scan.mjs`를 상대 경로로 불러온다(내장 모듈만 쓰므로 aws-snapshot 쪽 `npm install`은 필요 없다).

## 3. 내보내기 전용 읽기 역할·컨텍스트

대시보드 권한과 **분리된** 사람용 역할·컨텍스트를 쓴다. 대시보드 ServiceAccount 토큰이나 `sentinel-readonly` 역할을 쓰지 않는다(권한 목록이 다르고, 대시보드 권한을 넓힐 이유를 만들지 않기 위해).

> ⚠️ **아래 절차(2·3번)는 kOps 문서와 `docs/specs/kops-support.md` 3.6을 근거로 쓴 것이고, 실제 kOps 클러스터에서 실행해 확인하지 않았다.**
> 특히 API 서버 주소(`https://api.<클러스터 이름>`)는 **추정**이다 — `--dns=none`·내부 LB 구성에서는 다르다.
> 4번 확인(`kubectl auth can-i`)까지 마쳐야 권한이 실제로 읽기 전용인지 알 수 있다.

1. 역할 적용 (클러스터 관리자가, 한 번):
   ```bash
   kubectl apply -f deploy/k8s-snapshot/rbac/export-readonly.yaml
   ```
   - ClusterRole `sentinel-snapshot-export`: 기본·선택 종류의 `get`, `list`만. `watch`·쓰기 동사·`secrets`·`pods/exec`·`pods/log` 없음.
   - ClusterRoleBinding 대상은 그룹 `sentinel-snapshot-exporters`(예시).
2. 사람(또는 전용 ServiceAccount)을 그룹 `sentinel-snapshot-exporters`에 연결한다.
   kOps 클러스터에는 EKS access entry·`aws-auth` ConfigMap 같은 AWS 연동 인증이 **없다.** 방법은 둘 중 하나다.
   - **전용 ServiceAccount**(간단하고 권장): 내보내기 전용 SA를 만들고 위 ClusterRoleBinding의 `subjects`를 그 SA로 바꾼다. 토큰은 사람이 `kubectl -n <ns> create token <sa>`로 꺼낸다.
   - **사용자 인증서**: 클러스터 CA로 `O=sentinel-snapshot-exporters` 클라이언트 인증서를 발급한다(조직 = 그룹).
3. 내보내기 전용 컨텍스트를 만든다.
   서버 주소(kOps는 보통 `https://api.<클러스터 이름>` — **확인 필요**)·클러스터 CA·위에서 받은 토큰(또는 인증서)으로 kubeconfig 항목을 만들고 컨텍스트 이름을 `sentinel-snapshot`으로 둔다.
   현재 접속 중인 kubeconfig에서 값을 꺼내면 확실하다: `kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.server}'`
   `.env`의 `KUBE_CONTEXT=sentinel-snapshot`. **current-context를 몰래 쓰지 않는다**: 비우면 종료코드 2.
   > **`kops export kubeconfig --admin`으로 만든 컨텍스트를 쓰지 말 것.** cluster-admin 인증서가 들어 있어 "읽기 전용"이 권한으로 막히지 않는다(4번 확인이 통과해 버린다).
4. 확인: `kubectl auth can-i list secrets --context sentinel-snapshot -A` → `no` 여야 한다.

## 4. 사용법·설정·종료코드

```bash
npm run export:dry --prefix deploy/k8s-snapshot     # 설정·범위·종류·부를 API 목록만 출력 (클러스터 호출·파일 생성 없음)
npm run export     --prefix deploy/k8s-snapshot     # 내보내기 → snapshots/<UTC ID>/
npm run scan       --prefix deploy/k8s-snapshot -- snapshots/<id> [--strict]   # 다시 스캔 (경로를 안 주면 snapshots/ 전체, .trash 제외)
npm test           --prefix deploy/k8s-snapshot
```

### 설정 (`.env`)
우선순위: 명령줄 플래그 > `.env` > 셸 환경변수. `.env`가 셸보다 우선하는 이유는 셸의 `KUBECONFIG`·컨텍스트가 다른 클러스터를 가리켜도 `.env`의 내보내기 전용 컨텍스트를 쓰게 하기 위해서다.

| 환경 변수 | 플래그 | 기본 | 설명 |
|---|---|---|---|
| `KUBE_CONTEXT` | `--context` | **필수** | 비우거나 kubeconfig에 없는 이름이면 종료코드 2 |
| `KUBECONFIG` | `--kubeconfig` | 사용자 기본 | kubectl과 같은 규칙 |
| `SNAPSHOT_NAMESPACES` | `--namespaces` | (없음) | 포함 목록. 제외 목록과 함께 쓰면 2 |
| `SNAPSHOT_EXCLUDE_NAMESPACES` | `--exclude-namespaces` | (없음) | 제외 목록 |
| `SNAPSHOT_SYSTEM_NAMESPACES` | `--system-namespaces` | `kube-system,kube-public,kube-node-lease,amazon-cloudwatch` | 기본 범위에서 빠지는 네임스페이스. 포함 목록에 직접 적으면 내보낸다(경고) |
| `SNAPSHOT_OPTIONAL_KINDS` | `--optional-kinds` | (없음) | `jobs`, `clusterroles`, `clusterrolebindings`, `storageclasses`, `ingressclasses`, `priorityclasses`, `persistentvolumes` |
| `SNAPSHOT_CUSTOM_RESOURCES` | `--custom-resources` | (없음) | `plural.group` 목록(역할에도 get/list 추가) |
| `SNAPSHOT_EXCLUDE_KINDS` | `--exclude-kinds` | (없음) | 기본 포함 종류 중 뺄 것 |
| `SNAPSHOT_INCLUDE_HELM` | `--no-include-helm` | `true` | `false`면 Helm 관리 리소스를 빼고 수만 기록 |
| `SNAPSHOT_STRICT` | `--strict` | `false` | 스캔 경고도 실패 |
| `SNAPSHOT_OUT_DIR` | `--out-dir` | `snapshots/` | |

종류 이름은 대소문자를 무시하고 복수형·단수형·kind(`deployments`, `deployment`, `Deployment`)를 받는다. 모르는 이름은 바로 종료코드 2(오타가 조용히 무시되지 않게).

**기본 포함 종류**: Namespace, Deployment, StatefulSet, DaemonSet, Service, PersistentVolumeClaim, Ingress, PodDisruptionBudget, HorizontalPodAutoscaler, ConfigMap, ServiceAccount, Role, RoleBinding, NetworkPolicy, CronJob, ResourceQuota, LimitRange.
대시보드 드리프트는 이 중 대시보드 권한 안의 9종(Namespace ~ HPA)만 비교한다. 나머지는 "비교 불가(권한 밖)"로 표시된다.

### 종료코드

| 코드 | 뜻 | 스냅샷 폴더 |
|---|---|---|
| 0 | 성공, 스캔 통과 | 남음 |
| 1 | 비밀값 의심(스캔 실패) → **커밋 금지**. 정리 후 `npm run scan` | 남음 |
| 2 | 설정 오류 (컨텍스트 없음·kubeconfig에 없는 컨텍스트, 모르는 종류, 포함·제외 동시 지정, 잘못된 불리언 …) | 만들지 않음 (클러스터 호출도 없음) |
| 3 | 접속 실패(인증·네트워크), `kube-system`·대상 네임스페이스 읽기 권한 없음, 리소스 0개 | 지움 |
| 4 | **부분 성공**: 일부 종류가 권한 없음·API 없음·오류로 빠짐. 스캔은 통과 | 남음 (`metadata.json`의 `kinds`에 기록) |
| 99 | 예기치 않은 내부 오류 | 지움 |

1과 4가 겹치면 1. 출력·로그에 값 원문·kubeconfig 경로·서버 URL·토큰을 쓰지 않는다.

### 정리 규칙 (런타임 필드 제거, `lib/rules.mjs`, `cleanup.rulesVersion: 1`)
`status`, `metadata.uid/resourceVersion/generation/creationTimestamp/managedFields/selfLink/deletionTimestamp/deletionGracePeriodSeconds/ownerReferences/finalizers`, 어노테이션 `kubectl.kubernetes.io/last-applied-configuration`·`deployment.kubernetes.io/revision`·`pv.kubernetes.io/*`·`volume.(beta.)kubernetes.io/storage-provisioner`·`volume.kubernetes.io/selected-node`·`autoscaling.alpha.kubernetes.io/*`·`control-plane.alpha.kubernetes.io/leader`, Namespace 레이블 `kubernetes.io/metadata.name`, 파드 템플릿 `creationTimestamp`, Service `clusterIP(s)`(헤드리스 `None`은 유지)·`healthCheckNodePort`, PVC `volumeName`, StatefulSet `volumeClaimTemplates[].status`, Namespace `spec.finalizers`, ServiceAccount `secrets`.
기본값 필드는 지우지 않는다(버전마다 바뀔 수 있고 되살릴 방법이 없다). 같은 클러스터를 두 번 내보내면 바뀐 리소스만 git diff에 나온다.

## 5. 비밀값 스캔

스캐너 규칙은 **한 벌**이다: `deploy/aws-snapshot/lib/scan.mjs`의 공통 규칙 + 쿠버네티스 규칙(k8s 프로필). 대시보드도 같은 파일로 같은 결과를 낸다.

| 규칙 | 등급 | 잡는 것 |
|---|---|---|
| `k8s-env-literal` | error | `env`에서 이름이 비밀값처럼 보이는데(`*_PASSWORD`, `*_TOKEN`, `*_SECRET` …) `value`에 리터럴 값이 있음 |
| `k8s-secret-object` | error | `kind: Secret` 문서에 `data`/`stringData` 값 |
| `k8s-dockerconfig` | error | `.dockerconfigjson`/`.dockercfg` 값, `auths.*.auth` 값 |
| `k8s-configmap-secretish` | warn | ConfigMap `data` 키 이름이 비밀값처럼 보임 (Secret 으로 옮길지 검토) |
| `k8s-last-applied` | warn | `last-applied-configuration` 어노테이션이 남아 있음 |
| 공통 규칙 | error/warn | 개인 키, AWS 키, 사전 서명 URL, JWT, URL 안 자격증명, 벤더 토큰, `password: 값` 형태 등 |

**고치는 법**: 리터럴 값은 `valueFrom.secretKeyRef`로 바꾼다.
```yaml
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: postgres-credentials
        key: POSTGRES_PASSWORD
```
검토 후 문제없는 줄은 줄 끝에 `# snapshot-scan: allow`를 단다(`k8s-env-literal`은 `value` 줄에).
**스캐너가 모든 비밀값을 잡는다는 보장은 없다.** 여러 줄 흐름 매핑·앵커로 만든 env 등은 못 잡을 수 있다. 커밋 전에 사람이 diff를 본다.

## 6. 커밋 전 체크리스트
- [ ] 종료코드가 0 또는 4 (1이면 커밋 금지)
- [ ] `npm run scan --prefix deploy/k8s-snapshot -- snapshots/<id>` 가 통과
- [ ] 종료코드 4면 `metadata.json`의 `kinds`에서 빠진 종류(`forbidden`·`not_found`)를 확인
- [ ] `git diff`로 바뀐 리소스만 나왔는지, 예상 밖 값(이메일·내부 주소·토큰 모양)이 없는지 확인
- [ ] 스냅샷 폴더 안에 덤프·`.env`·메모 파일 같은 예상 밖 파일이 없음 (대시보드가 "예상 밖 파일"로 표시)
- [ ] `snapshots/.trash/`가 커밋에 들어가지 않음 (`.gitignore`)

## 7. 복원(다시 적용) 절차

사람이, 적용할 클러스터에 **쓰기 권한이 있는 운영 컨텍스트**로 한다(내보내기 전용 역할로는 적용할 수 없다).

1. **Secret 먼저 다시 만들기**: `secret-refs.json`에 적힌 Secret(네임스페이스·이름·키 이름)을 별도 보관소(Secrets Manager·비밀번호 관리자)의 값으로 만든다. 스냅샷에는 값이 없다.
2. **대상 확인**: `kubectl config current-context`가 복원할 클러스터인지 확인한다(스냅샷 `metadata.json`의 `cluster.name`·`cluster.context`와 비교).
3. **차이 확인**: `kubectl diff -f snapshots/<id>/<네임스페이스>/` (서버 측 dry-run 이라 쓰기 권한이 있는 컨텍스트가 필요하다).
4. **적용**: 네임스페이스 → 설정(ConfigMap·ServiceAccount·Role/RoleBinding) → 워크로드 순으로.
   ```bash
   kubectl apply -f snapshots/<id>/<ns>/namespace.yaml
   kubectl apply -R -f snapshots/<id>/<ns>/
   ```
   - **Helm 관리 리소스**(레이블 `app.kubernetes.io/managed-by: Helm`, 대시보드 "Helm 관리")는 `kubectl apply` 대신 Helm으로 복원한다.
   - **PVC**: 스냅샷의 PVC를 적용하면 **빈 볼륨**이 새로 만들어진다. 데이터가 필요하면 8장 순서를 먼저 따른다.
   - 시스템 네임스페이스(`kube-system` 등)는 kOps 애드온·컨트롤 플레인 static pod 미러가 관리하는 리소스가 많아 복원 대상이 아니다.
5. 대시보드 드리프트 화면에서 "차이 없음"이 되는지 확인한다.

## 8. Postgres·PV 데이터 (이 스냅샷에 없음)

**이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다.** PVC·StatefulSet의 **정의**만 있다. 스냅샷의 PVC를 적용하면 빈 볼륨이 새로 만들어진다. 데이터는 아래 방법으로 따로 **암호화해서** 보관한다.

### 8.1 백업
- **논리 백업** (권장): 데이터베이스별 `pg_dump` + 역할·권한 같은 **전역 객체** `pg_dumpall --globals-only`.
  ```bash
  # 컨테이너 안에서 파일로 만들고 kubectl cp 로 가져온다 (비밀번호는 컨테이너의 환경 변수·.pgpass 사용)
  kubectl exec -n data postgres-0 -- sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d app -f /tmp/app.dump'
  kubectl exec -n data postgres-0 -- sh -c 'pg_dumpall --globals-only -U "$POSTGRES_USER" -f /tmp/globals.sql'
  kubectl cp data/postgres-0:/tmp/app.dump ./app.dump
  kubectl cp data/postgres-0:/tmp/globals.sql ./globals.sql
  kubectl exec -n data postgres-0 -- rm -f /tmp/app.dump /tmp/globals.sql
  ```
- **볼륨 스냅샷**: PVC의 EBS 볼륨 스냅샷(콘솔·`aws ec2 create-snapshot`) 또는 쿠버네티스 VolumeSnapshot.

### 8.2 주의
- `kubectl exec`(`pods/exec`)는 **사람의 운영 권한**으로 실행한다. 대시보드 RBAC와 내보내기 전용 역할에는 이 권한을 넣지 않는다.
- DB 비밀번호를 명령줄 인자로 넘기지 않는다(컨테이너 안의 환경 변수나 `.pgpass`).
- 덤프 파일(특히 비밀번호 해시가 든 `pg_dumpall --globals-only` 결과)은 운영 데이터 원본이다. **git과 `deploy/k8s-snapshot/snapshots/` 밖**에 암호화해서 보관한다(스냅샷 폴더 안에 두면 대시보드가 "예상 밖 파일"로 표시한다).
- **Windows PowerShell에서는 `>` 리다이렉트로 덤프를 받지 않는다**(인코딩 변환으로 바이너리 덤프가 깨질 수 있다). 위처럼 컨테이너 안에서 `-f`로 파일을 만든 뒤 `kubectl cp`로 가져온다.
- EBS 스냅샷은 **크래시 일관성**만 보장한다(복원 뒤 WAL 재생으로 복구). 쿠버네티스 VolumeSnapshot은 snapshot-controller와 EBS CSI 드라이버가 설치돼 있어야 쓸 수 있다.
- 특정 시점 복구(PITR)는 이 문서의 범위 밖이다.

### 8.3 복원 순서
**논리 백업으로 복원**
1. Secret 다시 만들기 (`secret-refs.json` 참고)
2. 매니페스트 적용 (7장) → 빈 StatefulSet 기동·준비 확인
3. 전역 객체 복원: `psql -f globals.sql` (컨테이너 안으로 `kubectl cp` 후)
4. `pg_restore -d app app.dump` — 백업한 서버와 **같은 메이저 버전이거나 더 새 버전**

**볼륨 스냅샷으로 복원**
1. Secret 다시 만들기
2. StatefulSet보다 **먼저** 스냅샷에서 PVC를 만든다: 이름 `<템플릿>-<sts>-<순번>`(예 `data-postgres-0`), `dataSource`(VolumeSnapshot) 또는 정적 PV, **원래 볼륨과 같은 AZ**. 스냅샷 폴더에 있는 같은 이름의 PVC YAML은 적용하지 않는다.
3. 나머지 매니페스트 적용
4. StatefulSet 기동 (WAL 재생으로 복구)

복원 뒤 대시보드 모니터링 계정은 전역 객체 복원이나 `docs/db/monitor-account.sql` 재실행으로 되살린다.

## 9. git으로 관리 시작하기
1. 첫 내보내기 결과(`snapshots/<id>/`)를 체크리스트(6장) 확인 후 커밋한다.
2. 이후에는 바뀔 때마다(배포 전후, 클러스터 업그레이드 전) 다시 내보내 커밋한다. 폴더는 스냅샷마다 새로 생기므로 이전 스냅샷과의 차이는 `git diff --no-index snapshots/<이전> snapshots/<새것>`이나 대시보드 상세의 "직전 스냅샷 대비"로 본다.
3. 오래된 스냅샷은 대시보드 휴지통(`snapshots/.trash/`, git 제외)으로 옮긴 뒤 `git rm -r`로 정리한다.
4. 대시보드에서 고친 파일은 `notes.json`의 `fileEdits`에 기록된다. 커밋 전에 diff를 사람이 본다.

## 10. 제외 규칙·자동 생성 목록
**항상 제외** (목록을 부르지 않거나 결과에서 뺀다)
- Secret (권한도 없다), Pod, ReplicaSet, ControllerRevision, Endpoints, EndpointSlice, Event, Lease, Node, 메트릭
- `metadata.ownerReferences`가 있는 객체 (컨트롤러가 다시 만든다. 예: CronJob이 만든 Job)

**자동 생성 객체** (`lib/rules.mjs isAutoCreated`, 수는 `metadata.json`의 `resources.excludedByRule`)
- ConfigMap `kube-root-ca.crt`
- `default` 네임스페이스의 Service `kubernetes`
- ServiceAccount `default` (어노테이션·`imagePullSecrets`·`automountServiceAccountToken`이 없을 때. 있으면 사용자가 고친 것으로 보고 내보낸다)
- 이름이 `system:`으로 시작하는 Role/RoleBinding/ClusterRole/ClusterRoleBinding, 레이블 `kubernetes.io/bootstrapping=rbac-defaults`
  - (`eks:` 접두어 규칙도 `lib/rules.mjs`에 남아 있다. **kOps에서는 매칭되지 않는 EKS 잔재**이고 다음 정리 때 지운다 — `docs/specs/k8s-snapshot.md` 3.4)
- 이름이 `system-`으로 시작하는 PriorityClass

**Helm**: 레이블 `app.kubernetes.io/managed-by: Helm`인 리소스는 기본으로 내보내고 수를 기록한다(`SNAPSHOT_INCLUDE_HELM=false`면 뺀다). Helm 릴리스 Secret(`sh.helm.release.v1.*`)은 Secret이라 읽지 않는다.

위 목록은 초기안이다. 쿠버네티스·kOps 버전을 올리면서 새 자동 생성 객체가 보이면 `lib/rules.mjs`와 이 표를 함께 고친다.

## 11. 문제 해결
- **종료코드 2 "컨텍스트가 없습니다"**: `.env`의 `KUBE_CONTEXT`를 채운다. `kubectl config get-contexts`에 있는 이름이어야 한다.
- **종료코드 3 (401·연결 실패)**: 토큰이 만료됐을 수 있다. 3장 2번으로 토큰을 다시 발급해 kubeconfig를 갱신한다(exec 플러그인을 쓰는 구성이면 그쪽 자격증명을 갱신한다). 요청당 30초 제한이 있다.
- **종료코드 3 "kube-system 을 읽을 수 없음"**: 역할에 `namespaces` get/list가 있는지, access entry 그룹이 맞는지 확인한다(`kubectl auth can-i get namespaces --context …`).
- **종료코드 4**: `metadata.json`의 `kinds.<종류>.result`가 `forbidden`이면 역할에 그 종류를 더하거나 `SNAPSHOT_EXCLUDE_KINDS`로 뺀다. `not_found`면 클러스터에 그 API가 없다.
- **스캔 경고 `k8s-last-applied`**: 정리 규칙을 거치지 않은 파일(손으로 붙여 넣은 YAML)이다. 어노테이션을 지운다.
- **대시보드에 스냅샷이 안 보임**: 대시보드의 `K8S_SNAPSHOT_DIR`(docker compose는 `deploy/k8s-snapshot/snapshots`를 마운트)를 확인한다. 쓰는 중인 `.<ID>.partial` 폴더는 목록에 나오지 않는다.
