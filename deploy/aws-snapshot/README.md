# aws-snapshot: AWS 설정을 IaC 템플릿으로 내보내기 (대시보드 밖 도구)

현재 AWS 설정을 [Former2](https://github.com/iann0036/former2) CLI로 **CloudFormation(YAML)과 Terraform** 템플릿으로 내보내 git에 보관한다.
나중에 사람이 검토해서 **수동으로** 다시 적용할 수 있게 하는 것이 목적이다.

- 대시보드(`apps/api`, `apps/web`)와 관계없는 독립 스크립트다. 대시보드 역할·권한을 쓰지 않는다.
- **조회 전용.** 이 스크립트는 AWS API를 직접 부르지 않는다. AWS 조회는 former2가 하며, former2는 List/Describe/Get 계열 호출만 한다(아래 "former2가 하는 호출").
- **적용 기능은 없다.** 되살리는 절차는 이 문서의 "복원(다시 적용) 절차"를 따라 사람이 직접 한다.
- Former2는 **실험적 도구**다. 생성된 템플릿은 그대로 배포하면 안 되고 반드시 손질해야 한다.

## 목차
1. [폴더 구성](#1-폴더-구성)
2. [준비: 설치](#2-준비-설치)
3. [준비: 내보내기 전용 IAM 역할·프로필](#3-준비-내보내기-전용-iam-역할프로필)
4. [사용법](#4-사용법)
5. [비밀값 스캔](#5-비밀값-스캔)
6. [커밋 전 체크리스트](#6-커밋-전-체크리스트)
7. [복원(다시 적용) 절차](#7-복원다시-적용-절차)
8. [Former2가 담지 못하는 것](#8-former2가-담지-못하는-것)
9. [문제 해결](#9-문제-해결)
10. [former2 버전 올리기](#10-former2-버전-올리기)

---

## 1. 폴더 구성

```
deploy/aws-snapshot/
├─ export.mjs              내보내기 (npm run export)
├─ scan.mjs                비밀값 재스캔 (npm run scan)
├─ lib/                    설정·인자 조립·스캐너·메타데이터
├─ iam/
│  ├─ deny-sensitive-reads.json   ReadOnlyAccess에 덧붙일 거부 정책
│  └─ trust-policy.example.json   역할 신뢰 정책 예시 (MFA 필수)
├─ test/                   node:test 단위 테스트 (가짜 former2 사용, AWS 호출 없음)
├─ snapshots/<YYYYMMDD-HHmmss>/   ← git에 커밋하는 결과 (시각은 UTC)
│  ├─ cloudformation.yml
│  ├─ terraform.tf
│  ├─ logical-id-mapping.json    논리 ID ↔ 실제 리소스 ID (import 할 때 사용)
│  ├─ metadata.json              시각·리전·필터·서비스·former2 버전·계정 ID(마스킹)·스캔 결과
│  └─ notes.json                 (있을 때만) 대시보드 "AWS 스냅샷" 메뉴에서 붙인 라벨·메모·편집 기록
├─ snapshots/.trash/        (git 제외) 대시보드에서 삭제한 스냅샷 휴지통. `npm run scan` 대상 아님, 자동으로 비우지 않음
├─ .raw/                   (git 제외) raw 데이터를 켰을 때만 생김
├─ .env.example            설정 예시 → .env 로 복사 (.env 는 git 제외)
└─ .gitignore              .env, .raw/, snapshots/.trash/, node_modules 제외
```

## 2. 준비: 설치

Node 22 이상. former2는 이 폴더의 `package.json`에 **고정 버전(0.2.83)**으로 들어 있다(전역 설치 안 함).

```bash
npm install --prefix deploy/aws-snapshot
cp deploy/aws-snapshot/.env.example deploy/aws-snapshot/.env   # 값 채우기
```

> `npm audit`에 aws-sdk v2(지원 종료) 관련 moderate 경고가 나온다. 수정 버전이 없다.
> 권고 내용(리전 값 검증)은 이 스크립트가 리전 형식을 검사하는 것으로 대응한다. 이 도구는 사람이 로컬에서 가끔 돌리는 용도로만 쓴다.

## 3. 준비: 내보내기 전용 IAM 역할·프로필

대시보드용 권한(`CLAUDE.md`의 AWS 읽기 권한 목록, IRSA 역할 `sentinel-api-readonly`)과 **분리된 별도 역할**을 쓴다.
Former2는 서비스 전반을 훑기 때문에 대시보드 최소 권한으로는 부족하고, 반대로 대시보드에 넓은 권한을 줄 이유도 없기 때문이다.
**IAM 생성은 사람이 한다.** (이 도구는 IAM을 만들거나 바꾸지 않는다)

1. 역할 만들기 (예: `sentinel-snapshot-readonly`)
   - 신뢰 정책: `iam/trust-policy.example.json` (`<ACCOUNT_ID>` 바꾸기, MFA 필수). SSO(IAM Identity Center)를 쓰면 권한 세트로 대신한다.
   - 권한 정책:
     - AWS 관리형 **`ReadOnlyAccess`** (Former2 권장)
     - 인라인 정책 **`iam/deny-sensitive-reads.json`**: `ReadOnlyAccess`에 들어 있는 "데이터·비밀값 읽기"를 명시적으로 거부
       (Secrets Manager 값, SSM 파라미터 값, KMS 복호화, S3 객체, DynamoDB 항목, 로그 이벤트, ECR 이미지, GameLift 임시 자격증명 등)
   - 쓰기 권한은 주지 않는다. `ReadOnlyAccess`에는 생성·수정·삭제 권한이 없다.
2. 로컬 프로필 설정 (`~/.aws/config`). 아래 중 하나:
   ```ini
   # (권장) IAM Identity Center(SSO)
   [profile sentinel-snapshot]
   sso_session = my-sso
   sso_account_id = 123456789012
   sso_role_name = SentinelSnapshotReadOnly
   region = ap-northeast-2

   # 또는 역할 전환 (source_profile 의 키로 AssumeRole)
   [profile sentinel-snapshot]
   role_arn = arn:aws:iam::123456789012:role/sentinel-snapshot-readonly
   source_profile = my-user
   region = ap-northeast-2
   ```
   - SSO면 실행 전에 `aws sso login --profile sentinel-snapshot`(AWS CLI 필요).
   - 역할 전환에 **`mfa_serial`을 넣으면 동작하지 않는다.** former2(aws-sdk v2)에 MFA 코드 입력 수단이 없다.
     MFA가 필요한 역할은 SSO를 쓰거나, 미리 받은 임시 자격증명을 환경변수(`AWS_ACCESS_KEY_ID` 등)로 넣고 `.env`의 `AWS_PROFILE`을 비운다.
3. `.env`의 `AWS_PROFILE`에 프로필 이름을 적는다. 키는 `.env`에 적지 않는다.

### 자격증명 전달 방식 (알아둘 점)
- 스크립트는 프로필을 former2의 `--profile`이 아니라 **하위 프로세스의 `AWS_PROFILE` 환경변수**로 넘긴다.
  former2의 `--profile`은 SSO·`credential_process` 프로필을 못 읽기 때문이다.
- 프로필을 지정하면 셸에 있던 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`은 former2에 **넘기지 않는다**
  (다른 자격증명이 끼어들어 엉뚱한 계정·권한으로 조회하는 것을 막는다).
- 설정 우선순위: 명령줄 플래그 > `deploy/aws-snapshot/.env` > 셸 환경변수.
  셸에 대시보드용 `AWS_PROFILE`이 잡혀 있어도 `.env` 값을 쓴다.

### former2가 하는 호출
former2@0.2.83 소스(`js/services/*.js`)의 SDK 호출은 모두 `list*/describe*/get*/batchGet*` 계열과 조회용 몇 개(`adminGetUser`, `domainMetadata`, `querySchemaVersionMetadata`, `readPipeline`)다.
예외로 **값을 읽거나 자격증명을 발급하는 호출**이 있어서 해당 서비스는 기본 제외한다.

| 서비스(Former2 이름) | 호출 | 기본 처리 |
|---|---|---|
| SecretsManager | `secretsmanager:GetSecretValue` (비밀 원문) | 제외 + IAM 거부 |
| SystemsManager | `ssm:GetParameter` (파라미터 값) | 제외 + IAM 거부 |
| GameLift | `gamelift:RequestUploadCredentials` (임시 자격증명 발급) | 제외 + IAM 거부 |
| Cognito | `cognito-idp:ListUsers`, `AdminGetUser` (사용자 개인정보) | 제외 + IAM 거부 |

`SNAPSHOT_ALLOW_SENSITIVE_SERVICES=true`로 이 제외를 끌 수 있지만 권장하지 않는다(IAM 거부 정책 때문에 어차피 값은 못 읽는다).

## 4. 사용법

```bash
# 1) 무엇을 실행할지 먼저 확인 (AWS 호출·파일 생성 없음)
npm run export --prefix deploy/aws-snapshot -- --dry-run
#   = npm run export:dry --prefix deploy/aws-snapshot

# 2) 실제 내보내기
npm run export --prefix deploy/aws-snapshot

# 플래그로 .env 값 덮어쓰기
npm run export --prefix deploy/aws-snapshot -- --region ap-northeast-2 --search-filter sentinel-prod --services EC2,VPC,IAM,ELBv2,AutoScaling
# 다른 설정 파일 사용 (상대 경로는 명령을 친 폴더 기준)
npm run export --prefix deploy/aws-snapshot -- --config deploy/aws-snapshot/.env.prod --dry-run
# 도움말
npm run export --prefix deploy/aws-snapshot -- --help
```

> `--env-file`이 아니라 `--config`다. `--env-file`은 Node 자체 옵션과 이름이 겹쳐 Node가 가로챈다.

### 설정 (`.env`)
| 키 | 기본 | 설명 |
|---|---|---|
| `AWS_PROFILE` | (없음) | 내보내기 전용 프로필. 비우면 기본 자격증명 체인 |
| `AWS_REGION` | **필수** | 조회할 리전. 비우면 오류(former2는 리전을 안 주면 `~/.aws/config` default 리전을 쓰기 때문) |
| `SNAPSHOT_SEARCH_FILTER` | (없음) | 리소스 JSON에 이 문자열이 들어간 것만. `,`=OR, `&`=AND. 비우면 경고 후 전체 |
| `SNAPSHOT_REGEX_FILTER` | (없음) | 정규식 필터 |
| `SNAPSHOT_SERVICES` | (없음=전체) | 포함할 서비스. 예시 값은 kOps 클러스터 구성 권장 목록(EC2·VPC·IAM·ELBv2·AutoScaling·Route53) |
| `SNAPSHOT_EXCLUDE_SERVICES` | (없음) | 추가로 뺄 서비스 |
| `SNAPSHOT_ALLOW_SENSITIVE_SERVICES` | `false` | 위 "기본 제외" 끄기 (비권장) |
| `SNAPSHOT_INCLUDE_DEFAULT_RESOURCES` | `false` | 기본 VPC·기본 서브넷 등 포함 |
| `SNAPSHOT_RAW_DATA` | `false` | raw 데이터 저장 (`.raw/<시각>/raw-data.json`, git 제외) |
| `SNAPSHOT_CFN_DELETION_POLICY` | `Retain` | CloudFormation `DeletionPolicy`. 스택을 지워도 리소스가 남게 `Retain` 유지 권장 |
| `SNAPSHOT_MASK_ACCOUNT_ID` | `true` | `metadata.json`의 계정 ID 마스킹 (`********9012`) |
| `SNAPSHOT_STRICT_SCAN` | `false` | 스캔 경고(warn)도 실패 처리 |

- 서비스 이름은 Former2 콘솔 이름에서 공백·하이픈을 뺀 형태다(`Route53`, `CertificateManager`, `SecretsManager`). 대소문자 무시.
  모르는 이름이면 바로 오류를 낸다(former2는 모르는 이름을 조용히 무시해서 오타가 "전체 내보내기"가 되기 때문). 목록: `lib/services.mjs`.
- former2는 `--services`와 `--exclude-services`를 같이 못 쓴다. 스크립트가 알아서 하나로 합친다.
- **검색 필터 주의**: 클러스터 이름으로 거르면 이름·태그에 클러스터명이 없는 리소스(VPC, 서브넷, 라우트 테이블, IAM 역할 등)가 빠질 수 있다.
  `sentinel-prod,vpc-0abc...,sentinel-` 처럼 쉼표로 더하거나, 서비스를 좁히고 필터는 비우는 편이 낫다.

### 결과와 종료코드
| 종료코드 | 뜻 | 스냅샷 폴더 |
|---|---|---|
| 0 | 성공, 비밀값 스캔 통과 | 남음 |
| 1 | 비밀값 의심 발견 → **커밋 금지**, 정리 후 재스캔 | 남음 (검토용) |
| 2 | 설정 오류 (리전 없음, 모르는 서비스, 잘못된 플래그 등) | 안 만듦 |
| 3 | former2 실패 또는 리소스 0개 | 지움 |

`metadata.json` 예:
```json
{
  "snapshotId": "20260919-031500",
  "snapshotIdTimezone": "UTC",
  "region": "ap-northeast-2",
  "profile": "sentinel-snapshot",
  "searchFilter": "sentinel-prod",
  "services": { "mode": "include", "list": ["EC2", "VPC", "AutoScaling"] },
  "cfnDeletionPolicy": "Retain",
  "former2": { "version": "0.2.83", "args": ["generate", "--output-cloudformation", "<snapshot>/cloudformation.yml", "..."] },
  "account": { "masked": true, "ids": ["********9012"], "note": "템플릿 안의 ARN 에는 계정 ID 가 원문으로 남아 있습니다" },
  "resources": { "cloudformation": 42, "terraform": 40 },
  "rawData": { "saved": false, "location": null },
  "secretScan": { "errors": 0, "warnings": 1, "strict": false, "passed": true, "rules": ["user-data"] }
}
```
- 계정 ID는 AWS 기준 비밀값은 아니지만 공개할 이유도 없어 메타데이터에서는 가린다. **템플릿 안의 ARN에는 그대로 남으므로 이 저장소는 비공개로 유지한다.**
- 메타데이터에는 로컬 절대경로(사용자 이름 등)를 남기지 않는다(`<snapshot>/...`로 바꿔 기록).

## 5. 비밀값 스캔

내보내기가 끝나면 `cloudformation.yml`, `terraform.tf`, `logical-id-mapping.json`을 자동 스캔한다. 템플릿을 손질한 뒤에는 다시 돌린다.
폴더를 줄 때는 그 안의 `.yml .yaml .tf .hcl .json .template` 파일을 모두 스캔한다(`metadata.json`, `notes.json` 포함). 대시보드 휴지통 `snapshots/.trash/`는 건너뛴다.
대시보드 "AWS 스냅샷" 메뉴도 **이 스캐너(`lib/scan.mjs`)를 그대로 불러** 같은 결과를 보여 준다(규칙을 따로 두지 않는다).

```bash
npm run scan --prefix deploy/aws-snapshot                              # snapshots/ 전체
npm run scan --prefix deploy/aws-snapshot -- snapshots/20260919-031500 --strict
```

| 규칙 | 등급 | 잡는 것 |
|---|---|---|
| `secret-key-value` | error | 키 이름이 password/secret/token/apikey/privatekey/credential(s)/connectionstring 등으로 **끝나고** 값이 들어 있음. `!Ref`, `{{resolve:secretsmanager:...}}`, `var.x`, 빈 값, `<placeholder>`는 통과 |
| `aws-access-key-id` | error | `AKIA…`/`ASIA…` 액세스 키 ID |
| `aws-secret-access-key` | error | `secret_access_key = <40자>` |
| `private-key` | error | `-----BEGIN … PRIVATE KEY-----` |
| `presigned-url` | error | `X-Amz-Signature=`, `X-Amz-Security-Token=` (서명 URL·임시 자격증명) |
| `jwt` | error | JWT |
| `url-credentials` | error | `postgres://user:pass@host` 같은 URL 속 비밀번호 |
| `vendor-token` | error | GitHub/Slack/OpenAI/GitLab 토큰 패턴 |
| `env-block` | error | 환경 변수 블록을 여는 줄 (Lambda `Environment:`/`Variables:`, ECS `Environment:`, TF `environment {` 등) |
| `user-data` | warn | EC2/LaunchTemplate `UserData` |
| `kubeconfig-ca` | warn | 클러스터 CA 데이터 |

- 보고에는 값 원문을 찍지 않는다(`S3****(15자)`처럼 앞 2글자만).
- 검토 후 문제없는 줄은 **같은 줄 끝에** `# snapshot-scan: allow` 주석을 단다(YAML·HCL). JSON 파일에는 주석을 못 달므로 값을 지운다.
- 비밀값을 발견하면: 해당 값을 지우고 CloudFormation은 `{{resolve:secretsmanager:<이름>:SecretString:<키>}}` 동적 참조나 `NoEcho` 파라미터로, Terraform은 `variable`(`sensitive = true`) 또는 `data "aws_secretsmanager_secret_version"`으로 바꾼다.
  **이미 커밋·푸시했다면 값을 교체(rotate)** 해야 한다. git 기록에서 지우는 것만으로는 부족하다.
- 스캐너는 패턴 기반이라 **모든 비밀값을 잡는다는 보장은 없다.** 커밋 전 사람이 diff를 직접 본다.

## 6. 커밋 전 체크리스트
- [ ] 종료코드 0 (또는 스캔 경고를 검토했고 `--strict` 아닌 이유가 분명함)
- [ ] `git diff --stat`에 `snapshots/<시각>/` 파일 4개(+ 대시보드에서 라벨·메모를 붙였거나 템플릿을 편집했으면 `notes.json`)만 있음. `.env`, `.raw/`, `snapshots/.trash/`가 없음
- [ ] 대시보드에서 편집했다면 "커밋 금지"(스캔 오류) 상태가 아닌지 확인 (대시보드는 커밋하지 않는다)
- [ ] 템플릿에 환경 변수 값·UserData 속 비밀·연결 문자열이 없음 (사람이 직접 훑어봄)
- [ ] `metadata.json`의 리전·필터·서비스가 의도한 것과 같음
- [ ] 리소스 개수가 지난 스냅샷과 크게 다르면 이유 확인 (필터 누락·권한 부족일 수 있음)

## 7. 복원(다시 적용) 절차

> 이 도구에는 적용 스크립트가 없다. **아래 절차를 사람이 직접, 단계마다 검토하며** 진행한다.
> 적용에는 쓰기 권한이 필요하므로 내보내기용 읽기 역할과는 다른 **배포 권한 역할**을 쓴다(이 저장소 범위 밖).

### 7.1 공통: 템플릿 손질 (적용 전에 반드시)
Former2 결과는 "계정 안에 있는 것을 전부 나열한 것"이지 "다시 만들 수 있는 설계도"가 아니다.

1. **새 브랜치·새 폴더에서 작업**한다. **복원용 손질**은 `snapshots/<시각>/`의 원본이 아니라 복사본에서 한다(예: `infra/restore/<날짜>/`로 복사한 뒤 손질).
   예외: 커밋 전 **비밀값 정리와 검토 주석(`# snapshot-scan: allow`)** 은 원본에서 한다(대시보드 "AWS 스냅샷" 메뉴의 템플릿 편집이나 편집기로). 원본은 "내보낸 그대로 + 비밀값만 뺀 기록"으로 남긴다.
2. **kOps·쿠버네티스가 자동으로 만든 리소스를 지운다.** 그대로 두면 중복 생성되거나, 적용 후 kOps·컨트롤러가 다시 만들면서 충돌한다.
   > kOps 클러스터의 **단일 진실은 S3 state store의 `Cluster`/`InstanceGroup` 객체**이고, 아래 리소스들은 그 **결과물**이다.
   > 클러스터 자체를 되살리는 것은 `kops create -f`(다음 범위, `deploy/kops-snapshot/`)의 몫이지 이 템플릿의 몫이 아니다.
   >
   > ⚠️ **이 목록은 kOps 공식 문서·소스에서 확인한 사실(`docs/specs/kops-support.md` 0.2 F1~F9)과 명세를 근거로 쓴 것이고, 실제 kOps 클러스터에서 대조하지 않았다.**
   > 아래 **`[확인 필요]` 표시가 붙은 이름·태그는 추정**이다. 지우기 전에 **실제 태그·이름을 먼저 확인**하라 — 이름이 틀리면
   > 지워야 할 것을 못 지우거나(중복 생성) **엉뚱한 것을 지운다.** 확인한 값은 이 목록을 고쳐 표시를 떼고 기록한다.

   | 지울 것 | 확인 상태 |
   |---|---|
   | kOps InstanceGroup이 만든 **Auto Scaling Group, Launch Template**(InstanceGroup 1개 = ASG 1개) | 확인됨 (F4) |
   | 마스터·워커 **EC2 인스턴스**, 루트 **EBS 볼륨**, 마스터의 **etcd 볼륨**(main/events, 마스터당 2개·기본 gp3 20GB) | 확인됨 (F6) |
   | kOps가 만든 **보안 그룹**, 노드 **ENI**, CNI가 붙인 보조 ENI | **[확인 필요]** 이름 규칙 미확인 (`masters.<클러스터>`·`nodes.<클러스터>` **추정**) |
   | **API 서버 앞단 로드밸런서**와 그 Target Group·Listener (기본 class는 NLB) | class만 확인됨 (F7). **[확인 필요]** 이름·`Name` 태그 규칙 미확인 (명세 U2 — 대시보드 비용 추정에서도 같은 항목이 미확인이다) |
   | Kubernetes `Service type=LoadBalancer`/Ingress(AWS Load Balancer Controller)가 만든 **ELB/ALB/NLB, Target Group, Listener, 보안 그룹** → 클러스터 안 매니페스트가 다시 만든다 | 확인됨 |
   | PVC(EBS CSI)가 만든 **EBS 볼륨** | 확인됨 |
   | kOps가 만든 **Route53 레코드** | **[확인 필요]** `api.<클러스터>` **추정**(명세 3.6.3 "보통"). `--dns=none` 구성이면 **레코드가 아예 없다**(F9) |
   | 기본 VPC·기본 서브넷(`SNAPSHOT_INCLUDE_DEFAULT_RESOURCES=false`면 원래 없음), `AWSServiceRoleFor…` 서비스 연결 역할 | 확인됨 |

   **지우면 안 되는 것**
   - **kOps state store S3 버킷** — 클러스터 정의(`Cluster`/`InstanceGroup`)가 들어 있고 **클러스터보다 오래 산다.** 버킷을 여러 클러스터가 함께 쓰기도 한다. "자동 생성 리소스" 흐름을 따라가다 이걸 지우면 **클러스터 설계도가 통째로 사라진다.**

   **판단 기준 태그**
   - `kubernetes.io/cluster/<이름>` — kOps가 자기가 만든 리소스에 붙인다 (확인됨, F3)
   - `kops.k8s.io/instancegroup` — InstanceGroup 이름 (확인됨, F2)
   - `elbv2.k8s.aws/cluster`, `kubernetes.io/created-for/pvc/name`, `aws:autoscaling:groupName`, `aws:cloudformation:stack-name`(다른 스택 소유) — 확인됨
   - `k8s.io/role/*` — **[확인 필요]** 역할 태그 접두어의 실제 문자열을 kOps 소스에서 확인하지 못했다 (명세 U3). **이 태그만으로 마스터/워커를 가르지 말 것**
3. **하드코딩된 ID를 참조로 바꾼다.** `vpc-…`, `subnet-…`, `sg-…`, 계정 ID, AMI ID를 `!Ref`/파라미터(CFN), 리소스 참조/`variable`(TF)로.
4. **비밀값 자리는 참조로.** 5장 참고. 비밀값 자체는 별도 보관소에서 옮긴다(8장).
5. **읽기 전용 속성·상태 값 제거.** 생성 시각, ARN, 상태 등 former2가 넣었지만 적용할 때 거부되는 속성.
6. **Terraform provider 버전 올리기.** former2는 `hashicorp/aws ~> 3.0`을 적는다. 현재 쓰는 provider 버전으로 바꾸고 `terraform validate`로 속성 이름 변경을 확인한다.
7. **클러스터 자체(kOps `Cluster`/`InstanceGroup`)는 이 템플릿에 없다.** Former2는 AWS 리소스만 담고 kOps의 의도(etcd 볼륨 설정, CNI 선택, kubelet·apiserver 플래그, nodeLabels/taints, rollingUpdate 등)는 표현하지 못한다. 그 층은 **다음 범위인 `deploy/kops-snapshot/`**에서 다룬다(`docs/specs/kops-support.md` 8장). 지금은 클러스터를 먼저 `kops`로 만든 뒤, 이 템플릿에서 **클러스터가 만들지 않는 주변 리소스만** 골라 적용한다.
8. 쿠버네티스 버전이 아직 커뮤니티 지원 구간인지 확인한다(스냅샷 이후 지원이 끝났을 수 있음).

### 7.2 이미 있는 리소스: 새로 만들지 말고 import
"설정이 틀어져서 되돌린다", "IaC 관리로 편입한다"처럼 **리소스가 아직 있으면 절대 새로 만들지 않는다.** import로 관리 대상에 넣은 뒤 차이만 적용한다.
`logical-id-mapping.json`이 논리 ID ↔ 실제 ID 대응표다.

**CloudFormation (리소스 import change set)**
```bash
# 1) import 할 리소스 목록 작성 (logical-id-mapping.json 참고). 템플릿의 모든 리소스에 DeletionPolicy: Retain 필요(기본값)
cat > import.json <<'EOF'
[{"ResourceType":"AWS::EC2::VPC","LogicalResourceId":"EC2VPC","ResourceIdentifier":{"VpcId":"vpc-0abc..."}}]
EOF
# 2) IMPORT change set 생성 (아직 아무것도 바뀌지 않음)
aws cloudformation create-change-set --stack-name sentinel-infra --change-set-name import-1 \
  --change-set-type IMPORT --resources-to-import file://import.json --template-body file://cloudformation.yml
# 3) 검토: 모든 변경이 Action=Import 인지, Add/Remove/Replacement 가 없는지 확인
aws cloudformation describe-change-set --stack-name sentinel-infra --change-set-name import-1
# 4) 사람이 승인한 뒤에만 실행
aws cloudformation execute-change-set --stack-name sentinel-infra --change-set-name import-1
# 5) 드리프트 확인
aws cloudformation detect-stack-drift --stack-name sentinel-infra
```

**Terraform (import 블록 → plan → apply)**
```hcl
# imports.tf (Terraform 1.5+)
import {
  to = aws_vpc.EC2VPC
  id = "vpc-0abc..."
}
```
```bash
terraform init
terraform plan -out=tfplan     # 기대 결과: "N to import, 0 to add, 0 to change, 0 to destroy"
terraform show tfplan          # 사람이 검토: destroy/replace 가 하나라도 있으면 멈춘다
terraform apply tfplan         # 승인 후에만
```
- 상태 파일(`terraform.tfstate`)은 **원격 백엔드(S3 + 잠금)**에 두고 git에 넣지 않는다. 상태 파일에는 비밀값이 평문으로 들어간다.

### 7.3 리소스가 없는 경우 (다른 계정·리전에 새로 만들기, 재해 복구)
**CloudFormation: change set 생성 → 검토 → 실행**
```bash
aws cloudformation validate-template --template-body file://cloudformation.yml
aws cloudformation create-change-set --stack-name sentinel-infra --change-set-name create-1 \
  --change-set-type CREATE --template-body file://cloudformation.yml \
  --parameters file://params.json --capabilities CAPABILITY_NAMED_IAM
aws cloudformation describe-change-set --stack-name sentinel-infra --change-set-name create-1   # 검토
aws cloudformation execute-change-set --stack-name sentinel-infra --change-set-name create-1    # 승인 후
```
- `aws cloudformation deploy`처럼 change set을 바로 실행하는 명령은 쓰지 않는다.
- 큰 템플릿은 네트워크(VPC) → IAM → 주변 리소스 순서로 **여러 스택으로 나눠** 단계별로 적용한다(템플릿 크기 제한·실패 범위 축소). **클러스터(kOps)는 이 순서에 들어가지 않는다** — `kops`로 먼저 만든다(7.1 7번).

**Terraform: plan → 검토 → apply**
```bash
terraform init && terraform validate
terraform plan -out=tfplan
terraform show tfplan    # 검토
terraform apply tfplan   # 승인 후
```
- `terraform apply -auto-approve`는 쓰지 않는다.

### 7.4 적용 후
1. 클러스터 접속 확인. 대시보드는 **admin kubeconfig를 쓰지 않는다** — `deploy/rbac.yaml`의 ServiceAccount 토큰만 담은 kubeconfig를 쓴다(루트 `README.md` "권한" 참고)
2. 쿠버네티스 리소스 적용: `kubectl apply -f deploy/rbac.yaml` 등 `deploy/` 매니페스트 (8장)
3. 클러스터 안 Postgres 데이터 복원 (8장)
4. 대시보드로 노드·파드·DB 상태가 정상인지 확인

## 8. Former2가 담지 못하는 것

| 대상 | Former2 | 보관·복원 방법 |
|---|---|---|
| 쿠버네티스 리소스 (Deployment, StatefulSet, Service, Ingress, ConfigMap, RBAC…) | 못 담음 (AWS API 밖) | **`deploy/k8s-snapshot`으로 내보낸다** (클러스터의 현재 매니페스트를 리소스별 YAML로, Secret은 이름만 `secret-refs.json`). 대시보드 자신의 매니페스트만 `deploy/`(`rbac.yaml` 등)에 있다. 복원은 `deploy/k8s-snapshot/README.md` 7장 |
| 클러스터 안 Postgres(StatefulSet) **데이터** | 못 담음 | 논리 백업: 데이터베이스별 `pg_dump -Fc` + 역할·권한 같은 전역 객체 `pg_dumpall --globals-only`. 컨테이너 안에서 `-f`로 파일을 만든 뒤 `kubectl cp`로 가져온다(**Windows PowerShell의 `>` 리다이렉트로 받지 않는다** — 바이너리 덤프가 깨질 수 있음). 비밀번호는 명령줄 인자로 넘기지 않는다. 덤프는 git·스냅샷 폴더 **밖**(S3 등)에 암호화해 보관. 또는 PVC의 **EBS 볼륨 스냅샷**(크래시 일관성만, VolumeSnapshot은 snapshot-controller 필요). 복원 순서 — 논리 백업: Secret 다시 만들기 → 매니페스트 적용 → 빈 StatefulSet 기동 → `psql`로 전역 객체 → `pg_restore`(같거나 더 새 메이저 버전) / 볼륨 스냅샷: Secret → StatefulSet보다 **먼저** 스냅샷에서 PVC(`<템플릿>-<sts>-<순번>`, 같은 AZ) → 나머지 매니페스트 → StatefulSet 기동. 자세한 절차는 `deploy/k8s-snapshot/README.md` 8장. PITR은 범위 밖 |
| 비밀값 (DB 비밀번호, 모니터링 계정, API 키, kubeconfig) | 일부러 제외 | Secrets Manager·비밀번호 관리자 등 별도 보관소. git에 넣지 않는다. 템플릿에는 참조만 |
| S3 객체, DynamoDB 항목 등 **데이터** | 설정만 담음 | 서비스별 백업(AWS Backup, S3 복제 등) |
| **kOps `Cluster`/`InstanceGroup` 정의** (etcd 볼륨 설정, CNI 선택, kubelet·apiserver 플래그, nodeLabels·taints, rollingUpdate) | **못 담음** — Former2는 결과물(ASG·EC2·LB)만 본다 | S3 state store가 단일 진실. 파일로 남기는 것은 **다음 범위**(`deploy/kops-snapshot/`, `docs/specs/kops-support.md` 8장) |
| 클러스터 애드온 설정, Helm 릴리스 | 이름·버전 정도 | Helm values·매니페스트를 git으로 관리 |
| 계정 수준 설정 (Organizations SCP, SSO 권한 세트 일부, 서비스 할당량) | 일부만/실험적 | 별도 문서화 |

## 9. 문제 해결
- **리소스 0개(종료코드 3)**: former2는 서비스별 권한·자격증명 오류를 출력 없이 넘긴다. 자격증명(`aws sts get-caller-identity --profile …`), SSO 세션 만료, 리전, 필터를 확인한다.
- **일부 서비스만 비어 있음**: 권한 부족일 수 있다. `ReadOnlyAccess`가 붙었는지, 거부 정책이 너무 넓지 않은지 확인.
- **`ENOENT … .aws\config`**: `~/.aws/config` 없이 SDK 설정 로딩을 켜면 aws-sdk v2가 죽는다. 스크립트는 파일이 있을 때만 켜므로, 직접 `npx former2`를 돌릴 때만 해당한다.
- **`mfa_serial` 프로필이 안 됨**: 3장 참고 (SSO 또는 임시 자격증명 환경변수 사용).
- **시간이 오래 걸림**: `SNAPSHOT_SERVICES`로 서비스를 좁힌다. 전체 서비스는 수 분 이상 걸린다.

## 10. former2 버전 올리기
1. `package.json`의 `former2` 버전을 바꾸고 `npm install --prefix deploy/aws-snapshot`
2. 서비스 이름 목록 다시 뽑기 → `lib/services.mjs`의 `KNOWN_SERVICES` 갱신
   ```bash
   cd deploy/aws-snapshot
   grep -rh "sections.push" -A3 node_modules/former2/js/services/*.js | grep -o "'service': '[^']*'" | sort -u
   ```
   (공백·쉼표·하이픈 제거, `&amp;` → `And`)
3. 조회 외 호출이 새로 생겼는지 확인하고, 있으면 기본 제외(`SENSITIVE_SERVICES`)와 `iam/deny-sensitive-reads.json`에 반영
   ```bash
   grep -rhoE 'sdkcall\("[A-Za-z0-9]+", "[a-zA-Z]+"' node_modules/former2/js/services | sed -E 's/.*, "//; s/"//' \
     | grep -viE '^(list|describe|get|search|batchget|batchdescribe|lookup)' | sort | uniq -c
   ```
4. `npm test --prefix deploy/aws-snapshot`, `--dry-run`으로 확인
