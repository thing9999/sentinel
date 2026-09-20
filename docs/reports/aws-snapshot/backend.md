# aws-snapshot · backend 작업 보고

> 파일 위치: `docs/reports/aws-snapshot/backend.md`

## 2026-09-19 18:10 · Former2 내보내기 도구 (대시보드 밖 스크립트)

### 1. 요청 내용
- PM 요청: 현재 AWS 설정을 Former2로 IaC 템플릿(CloudFormation·Terraform)으로 내보내 git에 보관하고, 나중에 사람이 수동으로 다시 적용할 수 있게 하는 **대시보드 밖 도구**. 사용자가 "대시보드에 넣지 말고 별도 스크립트로"를 선택함. 기획·디자인 단계는 없음.
- 범위: `deploy/aws-snapshot/` 아래 전부.
  1. 내보내기 스크립트: Node, 크로스플랫폼, `.env` 설정, `snapshots/<YYYYMMDD-HHmmss>/` 출력, raw 데이터는 기본으로 끄기, `--dry-run`, 비밀값 스캔(발견 시 0이 아닌 종료코드)
  2. 내보내기 전용 IAM 안내·정책 (IAM 생성은 사람이 함)
  3. 복원 가이드 README (change set, import/plan 수동 절차, 주의사항)
  4. 테스트 (인자 조립, dry-run, 스캐너 양성·음성 케이스)
- 루트 `.gitignore`/`.env.example`은 직접 고치지 않는다(필요하면 PM 요청).

### 2. 참고한 문서
- `CLAUDE.md`: 조회 전용 원칙, 비밀값 규칙, AWS 읽기 권한 목록, 프로세스·포트 규칙
- `docs/reports/TEMPLATE.md`
- `deploy/rbac.yaml`, `deploy/app.example.yaml`: 기존 deploy 규칙(IRSA 역할 `sentinel-api-readonly`)
- 루트 `.gitignore`, `.env.example`
- Former2 CLI: `cli/README`(PM이 준 요약) + **실제 패키지 소스** former2@0.2.83 (`cli/main.js`, `js/services/*.js`, `js/mappings.js`)과 aws-sdk v2 자격증명 로더(`lib/node_loader.js`, `lib/credentials/shared_ini_file_credentials.js`)

### 3. 작업 내용
1. **former2 동작을 소스로 확인** (scratchpad에 설치한 뒤 이 폴더에 고정 버전으로 설치)
   - `generate` 옵션을 확인해 README에 없던 `--output-logical-id-mapping`, `--cfn-deletion-policy`, `--regex-filter`를 찾아 활용함.
   - 오류가 나면 `ERROR: …`와 도움말만 출력하고 **종료코드 0**으로 끝남. 서비스별 API 실패는 로그 없이 넘어가고 결과가 `# No resources generated`가 됨. 그래서 두 경우 모두 스크립트가 따로 잡아냄.
   - `--services`와 `--exclude-services`를 같이 쓰면 오류. 서비스 이름은 콘솔 이름에서 공백·쉼표·하이픈을 빼고 대소문자를 무시해 비교하며, **모르는 이름은 조용히 무시**함.
   - `--region`을 주지 않으면 `~/.aws/config`의 default 리전이 환경변수보다 우선함.
   - 조회 외 호출 조사 결과: `secretsmanager:GetSecretValue`, `ssm:GetParameter`(값), `gamelift:RequestUploadCredentials`(임시 자격증명 발급), `cognito-idp:ListUsers/AdminGetUser`(개인정보). 그 밖은 list/describe/get 계열과 조회 전용 호출뿐이며 쓰기 호출은 없음.
   - `--profile`은 aws-sdk v2 `SharedIniFileCredentials`만 써서 **SSO·credential_process 프로필을 지원하지 않음**. 기본 체인(`AWS_PROFILE` 환경변수)은 SSO·공유 파일(role_arn)·process를 모두 지원함.
   - CloudFormation 결과는 YAML이고, Terraform 결과는 `hashicorp/aws ~> 3.0`으로 고정되어 있음.
2. **설정 (`lib/config.mjs`)**: 우선순위는 플래그 > `deploy/aws-snapshot/.env` > 셸 환경변수. 리전은 필수이며 형식을 검사함. 프로필 이름, 정규식, 불리언, DeletionPolicy 값도 검사함. 필터가 비어 있으면 경고함.
3. **서비스 선택 (`lib/services.mjs`)**: former2@0.2.83에서 뽑은 서비스 이름 147개로 먼저 검증하고, 모르는 이름이 있으면 종료코드 2로 끝냄. 기본 제외 서비스는 `SecretsManager, SystemsManager, GameLift, Cognito`. 포함 목록과 제외 목록을 former2가 받을 수 있는 한 가지 옵션으로 합침.
4. **인자 조립 (`lib/former2-args.mjs`)**: `generate --output-cloudformation/--output-terraform/--output-logical-id-mapping --cfn-deletion-policy Retain --region … [--search-filter] [--regex-filter] --services|--exclude-services … --sort-output [--include-default-resources] [--output-raw-data .raw/<시각>/raw-data.json]`. 프로필은 하위 프로세스 환경변수 `AWS_PROFILE`로 넘기고, 이때 셸의 정적 키(`AWS_ACCESS_KEY_ID` 등)는 제거함.
5. **실행 (`export.mjs`)**: `node_modules/former2/cli/main.js`를 `process.execPath`로 직접 spawn함(셸을 거치지 않아 크로스플랫폼이고 인용 문제가 없음). 이후 순서:
   - 실패 판정: 종료코드가 0이 아니거나 `ERROR:`가 출력되거나 파일이 없거나 리소스가 0개면 스냅샷 폴더를 지우고 종료코드 3
   - 성공하면 템플릿 3개를 스캔하고 `metadata.json`을 작성함. 스캔에서 오류가 나오면 종료코드 1이고, 파일은 검토용으로 남김
   - `~/.aws/config`가 있을 때만 `AWS_SDK_LOAD_CONFIG=1`을 켬(없는데 켜면 aws-sdk v2가 ENOENT로 죽는 것을 실제 실행에서 발견)
   - `npm --prefix`로 실행할 때 상대 경로는 `INIT_CWD`(명령을 친 폴더) 기준으로 해석함
   - 같은 초에 다시 실행하면 덮어쓰지 않음
6. **비밀값 스캐너 (`lib/scan.mjs`, `scan.mjs`)**
   - error 규칙: secret-key-value(키 이름 끝말 기준), AWS 키 ID·비밀 키, PEM 개인 키, 서명 URL, JWT, URL 속 비밀번호, 서비스 토큰, 환경 변수 블록
   - warn 규칙: UserData, CA 데이터. `--strict`일 때만 실패로 봄
   - 참조 값(`!Ref`, `{{resolve:…}}`, `var.x`, 자리표시자)은 통과시킴. 줄 끝 `# snapshot-scan: allow`로 예외 처리 가능
   - 보고에는 값 원문을 찍지 않음(앞 2글자와 길이만 표시)
7. **메타데이터**: 시각(UTC), 리전, 프로필 이름, 필터, 서비스, DeletionPolicy, former2 버전, 인자, 계정 ID, 리소스 수, raw 저장 여부, 스캔 결과를 기록함. 인자 속 로컬 절대경로는 `<snapshot>/…`로 바꿔 기록함. 계정 ID는 이 스크립트가 STS를 부르지 않으므로 템플릿 ARN에서 뽑아 기본으로 마스킹함.
8. **IAM**: `iam/deny-sensitive-reads.json`(ReadOnlyAccess에 덧붙일 명시적 Deny 28개 액션)과 `iam/trust-policy.example.json`(MFA 필수)을 둠.
9. **README**: 설치, IAM·프로필(SSO 권장, mfa_serial 불가 안내), 사용법·설정 표·종료코드, 스캔 규칙, 커밋 전 체크리스트, 복원 절차(손질 → import 또는 생성 → 적용 후 순서), Former2가 못 담는 것, 문제 해결, former2 버전 올리는 절차.
10. **테스트 (node:test, 88개)**: 가짜 former2(`test/fixtures/fake-former2.mjs`)로 전체 흐름을 검증함. 정상, 비밀값 발견, 결과 없음, ERROR+0, 비정상 종료, raw, 중복 실행, 하위 프로세스 환경변수(정적 키 제거) 경우를 다룸.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `deploy/aws-snapshot/package.json` | 추가 | `former2` 0.2.83 고정, 스크립트 export / export:dry / scan / test |
| `deploy/aws-snapshot/package-lock.json` | 추가 | 의존성 고정 |
| `deploy/aws-snapshot/export.mjs` | 추가 | 내보내기 진입점 (dry-run, 실행, 실패 판정, 스캔, 메타데이터) |
| `deploy/aws-snapshot/scan.mjs` | 추가 | 재스캔 CLI |
| `deploy/aws-snapshot/lib/config.mjs` | 추가 | 설정 읽기와 검증 |
| `deploy/aws-snapshot/lib/services.mjs` | 추가 | Former2 서비스 이름 목록, 기본 제외, 선택 로직 |
| `deploy/aws-snapshot/lib/former2-args.mjs` | 추가 | 인자 조립, 하위 프로세스 환경변수, 명령 표시, 타임스탬프 |
| `deploy/aws-snapshot/lib/scan.mjs` | 추가 | 비밀값 스캐너 |
| `deploy/aws-snapshot/lib/meta.mjs` | 추가 | 계정 ID 추출·마스킹, 리소스 수 세기 |
| `deploy/aws-snapshot/iam/deny-sensitive-reads.json` | 추가 | 데이터·비밀값 읽기 거부 정책 |
| `deploy/aws-snapshot/iam/trust-policy.example.json` | 추가 | 신뢰 정책 예시 (MFA) |
| `deploy/aws-snapshot/.env.example` | 추가 | 설정 예시 (EKS 권장 서비스 목록 포함) |
| `deploy/aws-snapshot/.gitignore` | 추가 | `.env`, `.env.*`(예시 제외), `.raw/`, `raw-data.json`, `node_modules/` |
| `deploy/aws-snapshot/snapshots/.gitkeep` | 추가 | 결과 폴더 |
| `deploy/aws-snapshot/README.md` | 추가 | 사용법, IAM, 스캔, 체크리스트, 복원 가이드 |
| `deploy/aws-snapshot/test/config.test.mjs` | 추가 | 설정·서비스 선택 테스트 |
| `deploy/aws-snapshot/test/former2-args.test.mjs` | 추가 | 인자 조립·환경변수·명령 표시·타임스탬프 테스트 |
| `deploy/aws-snapshot/test/scan.test.mjs` | 추가 | 스캐너 양성 20건, 음성 21건, 요약, 메타 테스트 |
| `deploy/aws-snapshot/test/export.test.mjs` | 추가 | dry-run(CLI 프로세스), 전체 흐름(가짜 former2) 테스트 |
| `deploy/aws-snapshot/test/fixtures/fake-former2.mjs` | 추가 | AWS를 부르지 않는 가짜 former2 |
| `docs/reports/aws-snapshot/backend.md` | 추가 | 이 보고서 |

`apps/api`는 변경하지 않았다. HTTP API가 없는 도구라 `docs/api/aws-snapshot.md` 계약 문서는 만들지 않았다.

### 5. 주요 결정과 이유
- **former2를 전역 설치나 npx 최신판이 아닌 로컬 devDependency 고정 버전(0.2.83)으로 둠**: 실험적 도구라 버전마다 출력이 달라질 수 있다. 서비스 이름 목록과 조회 외 호출 조사도 이 버전 기준이다. 다만 런타임에 필요하므로 `dependencies`에 넣었다.
- **프로필을 `--profile` 대신 `AWS_PROFILE` 환경변수로 넘김**: `--profile`은 SSO와 credential_process 프로필을 못 읽는다. 셸에 남은 정적 키가 끼어들지 않도록 프로필을 지정하면 정적 키 환경변수를 제거한다. 대안이던 `--profile` 그대로 사용은 SSO 사용자가 쓸 수 없어서 버렸다.
- **`.env`가 셸 환경변수보다 우선**: 일반적인 dotenv 관례(셸 우선)와 반대다. 셸에 대시보드용 `AWS_PROFILE`이 있어도 내보내기 전용 프로필을 확실히 쓰게 하려는 선택이다.
- **리전 필수**: former2가 `~/.aws/config` default 리전을 몰래 쓰는 동작을 막는다.
- **서비스 이름 사전 검증**: former2는 모르는 이름을 무시하므로 오타가 "전체 내보내기"나 "빈 결과"로 이어진다.
- **기본 제외 서비스 4개와 IAM Deny 정책 이중 적용**: 제외 목록은 설정 실수로 꺼질 수 있어 IAM에서도 막는다. KMS·Lambda·IAM은 EKS 복원에 필요해서 제외하지 않았다. Lambda 환경 변수는 스캐너의 env-block 규칙으로 잡는다.
- **DeletionPolicy 기본값 Retain**: 복원할 때 스택을 지워도 리소스가 남는다. CloudFormation import도 DeletionPolicy가 있어야 가능하다.
- **logical-id-mapping.json 함께 저장**: import할 때 논리 ID와 실제 ID 대응표로 쓴다.
- **스캐너 등급 분리(error/warn)**: 요구사항은 "발견하면 비0 종료"였다. 그런데 EKS 노드 LaunchTemplate의 UserData는 거의 항상 나오므로 이것까지 error로 두면 도구가 늘 실패한다. 그래서 warn으로 두고 `--strict`로 올릴 수 있게 했다. 환경 변수 블록은 요구사항대로 error로 둔다.
- **키 이름은 "끝말" 기준으로 판단**: `MinimumPasswordLength`, `SecretArn`, `AccessTokenValidity` 같은 설정 키 오탐을 피한다. 음성 테스트로 고정했다.
- **환경 변수 블록은 여는 줄만 잡음**: 태그 `Environment = "prod"`는 제외한다(오탐 방지).
- **계정 ID는 STS 호출 없이 ARN에서 추출**: 스크립트가 AWS를 직접 부르지 않는다는 원칙을 지킨다. 메타데이터에서는 마스킹하지만 템플릿 ARN에는 원문이 남으므로 README에 "저장소 비공개 유지"를 적었다.
- **실패하거나 결과가 0개인 스냅샷 폴더는 자동 삭제**: 빈 스냅샷이 커밋되는 것을 막는다. 비밀값이 발견된 경우는 검토해야 하므로 남긴다.
- **`--env-file` 대신 `--config`**: Node 24가 스크립트 뒤에 붙은 `--env-file`도 자기 옵션으로 가로채는 것을 실제로 확인했다(exit 9).
- **스냅샷 폴더 시각은 UTC**: 여러 사람과 기기에서 헷갈리지 않게 한다. `metadata.json`에 `snapshotIdTimezone: "UTC"`로 표시한다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm test --prefix deploy/aws-snapshot` | 통과 (88개, 16 suites) | node:test, AWS 호출 없음 |
| `npm run export:dry --prefix deploy/aws-snapshot -- --config deploy/aws-snapshot/.env.example` | 통과 (exit 0) | 아래 출력 참고. 파일 생성 없음 |
| `npm run export:dry … -- --region ap-northeast-2 --search-filter "sentinel-prod,sentinel-vpc" --exclude-services S3 --raw` | 통과 (exit 0) | `--exclude-services SecretsManager,SystemsManager,GameLift,Cognito,S3`, raw는 `.raw/<시각>/` |
| 실제 former2 0.2.83 실행 (자격증명 없음, `--services EKS`, `AWS_EC2_METADATA_DISABLED=true`, 출력은 scratchpad) | 기대대로 exit 3 | "리소스 0개 → 빈 스냅샷 삭제 → 확인 안내" 경로를 실제 former2로 확인. 첫 시도에서 `AWS_SDK_LOAD_CONFIG` ENOENT 크래시를 발견해 수정함 |
| `npx --no-install former2 --version` / `generate --help` (이 폴더) | 0.2.83, 도움말 정상 | 네트워크 설치 성공 |
| `npm run scan --prefix deploy/aws-snapshot` | 통과 (파일 0개) | 빈 snapshots/ |
| `node scan.mjs <양성 샘플 폴더>` | exit 1 | ERROR secret-key-value(값 가림), WARN user-data |
| 임시 git 저장소에서 `git check-ignore` | 기대대로 | `.env`, `.env.local`, `.raw/…` 제외. `.env.example`, `snapshots/<시각>/*` 추적 |
| `node --check` (전체 .mjs) | 통과 | |
| `npm run lint --prefix apps/api` | 통과 | api 변경 없음. 규칙에 따라 실행함 |
| `npm test --prefix apps/api` | 통과 (29 suites, 289 passed, 1 skipped) | api 변경 없음 |
| `npm install` 후 `npm audit` | moderate 2, low 1 | aws-sdk v2(지원 종료)와 uuid. 수정 버전 없음. 리전 검증 권고는 스크립트의 리전 형식 검사로 대응 |

dry-run 출력(`.env.example` 사용):
```
== aws-snapshot (Former2 내보내기, 조회 전용) ==
리전: ap-northeast-2
프로필: sentinel-snapshot
검색 필터: -
서비스: 포함 EKS, EC2, VPC, IAM, ECR, KMS, Route53, CertificateManager, CloudWatch, S3
출력: C:\myscript\sentinel\deploy\aws-snapshot\snapshots\<시각>
raw 데이터: 저장 안 함
경고: 검색 필터가 비어 있습니다. 선택한 서비스의 리전 내 리소스를 모두 내보냅니다.

[dry-run] 아래 명령을 실행합니다 (지금은 실행하지 않음, AWS 호출·파일 생성 없음):
환경변수 설정: AWS_REGION=ap-northeast-2 AWS_PROFILE=sentinel-snapshot
환경변수 제거: AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN AMAZON_ACCESS_KEY_ID AMAZON_SECRET_ACCESS_KEY AMAZON_SESSION_TOKEN (프로필 외 자격증명 차단)
npx former2 generate --output-cloudformation …\cloudformation.yml --output-terraform …\terraform.tf --output-logical-id-mapping …\logical-id-mapping.json --cfn-deletion-policy Retain --region ap-northeast-2 --services EKS,EC2,VPC,IAM,ECR,KMS,Route53,CertificateManager,CloudWatch,S3 --sort-output
```
(최종 코드로 다시 실행해 확인한 출력이다. 환경변수 두 줄의 형식은 테스트에서도 검증한다.)

**하지 못한 검증**
- 실제 AWS 계정 대상 내보내기: 이 PC에는 AWS 자격증명, AWS CLI, Docker가 없다. 그래서 실제 템플릿 품질, 리소스 수, 권한 부족 서비스, EKS 자동 생성 리소스가 어떻게 나오는지는 확인하지 못했다.
- IAM 정책 JSON: 문법(JSON 파싱)만 확인했다. IAM 정책 검사기(Access Analyzer `validate-policy`)는 돌리지 못했다.
- README의 CloudFormation·Terraform 복원 명령: 실행하지 않았다(적용은 범위 밖이며 환경도 없음).
- macOS와 Linux 실행: Windows에서만 확인했다. 코드는 셸을 거치지 않고 `path` 모듈만 쓴다.
- 이 폴더에는 eslint 설정이 없어 lint를 돌리지 않았다. 대신 `node --check`로 문법만 확인했다.

### 7. 남은 이슈·한계
- 스캐너는 패턴 기반이라 놓치는 비밀값이 있을 수 있다(예: 키 이름이 평범한 필드에 들어간 비밀값, base64로 인코딩된 UserData 속 비밀값). README에서 사람이 diff를 직접 보도록 안내한다.
- UserData는 base64라 내용을 해석하지 않고 warn만 준다.
- 템플릿 ARN에 계정 ID가 원문으로 남는다(파라미터로 바꾸는 손질은 복원할 때 사람이 한다).
- Terraform 출력은 provider `~> 3.0` 기준이라 현재 provider에서는 속성 이름이 다를 수 있다(README 7.1에 적음).
- `mfa_serial`이 있는 role_arn 프로필은 동작하지 않는다(aws-sdk v2 제약). SSO나 임시 자격증명 환경변수를 쓰도록 안내했다.
- former2 버전을 올리면 `KNOWN_SERVICES`와 조회 외 호출 조사를 다시 해야 한다(README 10장에 절차 있음).
- `formatCommand`는 작은따옴표를 PowerShell 방식(`''`)으로 이스케이프한다. 필터에 작은따옴표가 있으면 bash용 복사 명령은 손봐야 한다(실제 실행에는 영향 없음, spawn은 인용을 쓰지 않음).

### 8. 다른 담당 요청
- `PM 요청`: 루트 `.gitignore`에 `.raw/` 추가 검토. 현재도 `deploy/aws-snapshot/.gitignore`가 막고 있어서 필수는 아니며, 이중 방어 목적이다. 루트 `.env` 규칙은 이미 하위 폴더 `.env`를 막고 있다(임시 저장소로 확인).
- `PM 요청`: 루트 `.env.example`은 수정할 필요 없음. 이 도구는 자체 `deploy/aws-snapshot/.env.example`을 쓴다.
- `PM 확인`: 내보내기 전용 역할은 `ReadOnlyAccess`(넓은 읽기) + Deny 정책이다. `CLAUDE.md`의 "AWS 권한은 읽기 전용: pricing:… 등" 목록은 대시보드 역할 기준이고, 이 역할은 **대시보드와 분리된 사람용 역할**이다. CLAUDE.md에 이 구분을 한 줄 적을지 판단 부탁.
- `사용자 요청`(PM 경유): 실제 계정에서 첫 내보내기를 한 번 돌려 결과(리소스 수, 스캔 경고, 빠진 서비스)를 공유해 주면 기본 서비스 목록과 스캐너 규칙을 보정할 수 있다.

### 9. 다음 담당이 알아야 할 점
- 실행: `npm install --prefix deploy/aws-snapshot` → `.env.example`을 `.env`로 복사 → `npm run export:dry --prefix deploy/aws-snapshot` → `npm run export --prefix deploy/aws-snapshot`
- 종료코드: 0 성공, 1 비밀값 의심(커밋 금지), 2 설정 오류, 3 former2 실패 또는 결과 0개
- 설정 파일 플래그는 `--config`다(`--env-file`은 Node가 가로챔).
- 테스트는 `SNAPSHOT_FORMER2_BIN` 환경변수로 가짜 former2를 끼워 넣는다. 운영에서는 이 값을 설정하지 않는다.
- 이 도구는 대시보드 코드(`apps/**`)와 의존 관계가 없다. 대시보드 빌드와 Docker 이미지에도 들어가지 않는다.
- 적용(복원) 스크립트는 일부러 만들지 않았다. 적용은 README 7장 절차대로 사람이 한다.
