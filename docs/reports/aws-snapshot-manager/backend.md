# aws-snapshot-manager · backend 작업 보고

> 파일 위치: `docs/reports/aws-snapshot-manager/backend.md`

## 2026-09-19 18:40 · API 계약

### 1. 요청 내용
- PM이 4단계 작업을 맡겼다. 작업 범위는 **API 계약 문서만**이고 구현은 다음 단계다. 산출물은 `docs/api/aws-snapshot-manager.md`이다.
- 계약에 넣을 것: REST(목록·상세·템플릿 조회·라벨·메모 수정·템플릿 저장(재스캔, 오류가 남으면 재확인, 버전 충돌 방지)·휴지통 이동·복원·영구 삭제·휴지통 목록), 스키마 예시, 오류 코드, 상태값(mock/live/unknown), 경로 탐색 방지, 변경 감지 SSE, AC 매핑.
- 반영할 요청
  - planner: `common.md` 충돌 해소(CORS `DELETE`, 1MB와 5MB 상한, 출처·health·mock 그룹). docker 마운트와 포트 공개 범위, README·.gitignore 변경은 "구현 메모"로 남긴다.
  - dba: 폴더 경로·쓰기 스위치·30분·5MB는 환경 변수로 둔다. `PrismaService`에 의존하지 않는다.
- 작업 중 PM이 추가로 전달한 요청
  - designer 요청 7개: 스캔 규칙 목록, 파일 정보(줄바꿈·인코딩·들여쓰기), 메뉴 상태, 저장 전 검사 결과, 휴지통 항목 ID, mock 그룹 키 `snapshots`와 시나리오 7종, 설정 안내 문구.
  - PM 결정: live에서 폴더 설정이 없으면 `unknown` + `SOURCE_NOT_CONFIGURED`로 구분한다. 사이드바는 아이콘을 그리지 않는다.
- 코드 수정은 금지다(문서만).

### 2. 참고한 문서
- `CLAUDE.md` (기능 4, 조회 전용, 공통 규칙)
- `docs/specs/aws-snapshot-manager.md` (확정본, 3절 표시·판단·편집·삭제·보안, 4절 갱신, 5절 AC-01~51, 7절 백엔드 전달, 8절 Q1~Q4)
- `docs/api/common.md`, `docs/api/aws-cost.md`·`cluster-status.md` (형식, overview `nav`)
- `deploy/aws-snapshot/lib/scan.mjs`·`meta.mjs`·`config.mjs`, `scan.mjs`, `export.mjs` (metadata 형식, 쓰는 순서, 스캔 대상 파일 규칙), `.gitignore`, `README.md`
- `docs/reports/aws-snapshot-manager/dba.md`, `planner.md`, `README.md`
- `docs/design/aws-snapshot-manager.md` (작업 도중 완성. 8절 mock, 9절 상태 표시), `docs/design/status.md` 5.2·9절, `shell.md` 사이드바, `docs/reports/aws-snapshot-manager/designer.md` 8절
- `docker-compose.yml`, `.env.example`, `apps/api/src/main.ts`, `apps/api/package.json`·`tsconfig.json` (CORS·본문 상한 현황, ESM 동적 import 가능 여부)

### 3. 작업 내용
1. CLI 코드를 읽어 다음을 확인했다.
   - 스캐너 export: `scanText`, `summarize`, `ALLOW_MARKER`, `SCANNABLE_EXTENSIONS`, `maskValue`. 규칙 표 `LINE_RULES`는 export되지 않는다.
   - `scanPaths`는 폴더를 재귀로 돌고 `.json`도 스캔한다. `statSync`를 써서 심볼릭 링크를 따라간다.
   - 내보내기는 `metadata.json`을 마지막에 쓴다. 폴더 이름 형식은 `YYYYMMDD-HHmmss`(UTC)다.
2. 스캐너 재사용 방식을 정했다. api가 CLI lib를 동적 `import()`로 불러온다(2절). 파일 선택 규칙은 CLI와 같게 서버가 직접 구현한다. 알려진 차이(폴더 안 링크)도 적었다.
3. 라벨·메모 파일 `notes.json`의 형식을 정했다(3절). `templateEdits`로 "대시보드에서 수정" 표시를 판단한다.
4. 버전 방식을 정했다. 파일 버전은 바이트 SHA-256이다. 라벨·메모 버전은 `{label,memo}`만으로 계산한다. 버전은 본문 `baseVersion`으로 받고, 강제 덮어쓰기는 없다(4절).
5. 엔드포인트 13개를 정의했다: summary, 목록, 상세, 파일 조회, 스캔 규칙, 새로고침, 검사, 저장, 라벨·메모, 휴지통 이동·목록·복원·영구 삭제. 각각 요청·응답 JSON 예시와 오류 표를 붙였다.
6. 저장 확인 흐름: `PUT`을 보냈는데 확인이 필요하면 422 `SNAPSHOT_CONFIRMATION_REQUIRED`와 검사 결과가 돌아온다. 사용자가 승인하면 `confirm: [...]`을 넣어 다시 보낸다. 확인 종류는 `secret_errors`, `yaml_syntax`, `resource_decrease`다.
7. 휴지통은 `<루트>/.trash/<id>__<삭제시각>`에 둔다. 같은 마운트 안이라 `rename` 한 번으로 이동한다. 폴더에 파일을 추가하지 않는다.
8. 상태 사유 코드(스냅샷 17개, 메뉴 6개, 정보 4개), SSE 토픽 `aws-snapshots`, mock 예시 9개·휴지통 1개·시나리오 7종, 환경 변수 9개를 정했다.
9. `common.md`를 수정했다: 0 요약 "쓰기" 행, 1.2 CORS `DELETE`와 파일 쓰기 보호, 2.3 `snapshotStore`와 stale 기준, 3.3 `ORIGIN_NOT_ALLOWED`·413 예외·415·422, 4절 health, 5절 토픽, 6.1 mock 그룹 `snapshots`, 6.3 reset 범위, 변경 이력.
10. 디자인 요청 7개와 PM 결정을 반영했다: 6.5 `scan-rules`, `files[].encoding`·`indent`, `root.setup`, 6.1 설정 없음 규칙, 발견 정렬을 디자인 `status.md` 5.2에 맞춤, 그룹 키 `snapshots`.
11. 16절에 AC-01~51과 계약 위치의 매핑 표를 넣었다. 화면만으로 충족되는 AC(31, 33)도 표시했다.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/api/aws-snapshot-manager.md` | 추가 | API 계약 (18절) |
| `docs/api/common.md` | 수정 | CORS DELETE, 쓰기 보호, SourceId `snapshotStore`, 413 예외·415·422·`ORIGIN_NOT_ALLOWED`, health, SSE 토픽 `aws-snapshots`, mock 그룹 `snapshots`, 변경 이력 |
| `docs/reports/aws-snapshot-manager/backend.md` | 추가 | 이 보고서 |

### 5. 주요 결정과 이유
- **스캐너는 CLI lib를 동적 import로 재사용한다**
  - 검토한 대안: (a) 규칙 사본을 두고 비교 테스트 — 사본이 어긋날 수 있다. (b) npm workspace 공유 패키지 — Docker 빌드 컨텍스트가 `apps/api`뿐이라 구성 변경이 크다. (c) CLI `scan.mjs`를 자식 프로세스로 실행 — AC-44 위반이고 저장 전 본문 검사도 못 한다.
  - 선택: lib 폴더를 docker에 읽기 전용으로 마운트하고 `AWS_SNAPSHOT_LIB_DIR`로 위치를 준다. lib를 못 불러오면 `unavailable`이 된다. 스캔 없이 "정상"을 보이는 일은 없다.
- **`scanPaths`를 직접 쓰지 않는다**: 링크를 따라가고(명세 3.9 위반), 요청 본문을 스캔할 수 없기 때문이다. 파일 선택 규칙은 CLI와 같게 서버가 구현한다.
- **SSE에는 요약과 바뀐 ID만 싣는다**: 명세 3.9가 스트림에 라벨·메모를 넣는 것을 금지한다. `common.md` 5.4의 예외로 적었다.
- **stale 90초, 주기 10초**: 명세 4절의 값이다. ×3 규칙의 예외로 적었다.
- **쓰기 보호(Origin 검사, JSON Content-Type 필수, 127.0.0.1 바인딩)**: 인증 없는 파일 쓰기 API가 처음 생긴다. CSRF(단순 요청 POST)와 DNS 리바인딩을 막고, 같은 네트워크의 다른 PC가 접근하지 못하게 한다.
- **본문 상한**: 템플릿 두 경로만 `editMaxBytes × 2 + 64KB`까지 받는다. 내용 자체의 5MB 상한은 따로 413 `SNAPSHOT_FILE_TOO_LARGE`로 준다.
- **줄바꿈이 섞였거나 UTF-8이 아닌 파일은 편집 불가**: AC-28(편집한 줄 외에는 diff 없음)을 보장할 수 없기 때문이다. LF·CRLF 한 가지만 쓰는 파일과 BOM은 그대로 유지한다. 내용은 LF로 통일해 주고, 저장할 때 원래 줄바꿈으로 되돌린다.
- **DELETE + `confirm` 쿼리**: DELETE는 본문이 버려질 수 있어 쓰지 않았다. 브라우저에서는 항상 preflight를 거친다.
- **리소스 수가 줄어도 확인을 요구한다**: AC-27 문구에 맞췄다.
- **mock 그룹 키는 `snapshots`, 토픽과 경로는 `aws-snapshots`**: 그룹 키는 디자인 요청대로 했다. 토픽을 `snapshots`로 하면 이벤트 이름이 `snapshots.snapshot`이 되어 헷갈린다.
- **메뉴 상태는 overview에 넣지 않는다**: 명세 3.4에 따라 클러스터 전체 상태와 분리했다.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 생략 | 문서만 수정, 코드 변경 없음 |
| `npm test --prefix apps/api` | 생략 | 같은 이유 |
| 문서 교차 참조 확인 (grep) | 통과 | 절 번호 참조, 그룹 키 표기를 수정 후 재확인 |

- 동적 import(CJS에서 `.mjs` 불러오기)가 jest(`--experimental-vm-modules`)와 `nest start`에서 되는지는 **실행해 보지 않았다**. tsconfig `module: nodenext` 기준으로 된다고 판단했다. 구현 단계에서 가장 먼저 확인한다.
- YAML 파서(`yaml` 패키지)가 CloudFormation 태그를 오류 없이 넘기는지도 확인하지 않았다.

### 7. 남은 이슈·한계
- CLI와 스캔 결과가 달라지는 경우가 하나 있다. 스냅샷 폴더 안에 심볼릭 링크가 있으면 CLI는 따라가서 스캔하고 서버는 따라가지 않는다(계약 14절 5).
- `fs.access(W_OK)`는 Docker Desktop(Windows) 바인드 마운트에서 틀린 값을 줄 수 있다. 그러면 실제 쓰기가 실패한 뒤에야 `READ_ONLY`로 바뀐다(계약 7.3).
- Windows 호스트에서 편집기가 파일을 잠그고 있으면 `rename`이 실패하고 500 `SNAPSHOT_WRITE_FAILED`가 난다. 원래 파일은 그대로 남는다.
- 복원할 때 대상 폴더를 확인한 뒤 `rename`하기까지 짧은 경쟁 구간이 있다. 사용자가 1명이라는 가정(명세 A1)으로 받아들였다.
- 20MB를 보기 응답 하나로 보낸다. 화면 성능은 frontend 확인이 필요하다.

### 8. 다른 담당 요청
- `PM 요청`
  - `CLAUDE.md` 쓰기 영역 표를 보면 `docker-compose.yml`(루트)을 누가 고치는지 명확하지 않다. 계약 15절 변경(api 포트 `127.0.0.1:3001:3001`, `snapshots/` 쓰기 마운트, `lib/` 읽기 전용 마운트, 환경 변수)을 구현 단계에서 backend가 해도 되는지 확인이 필요하다.
  - db 포트 5432도 `127.0.0.1`로 좁힐지 판단이 필요하다(이 기능 범위 밖).
  - 루트 `.env.example`도 같은 확인이 필요하다.
- `frontend 요청`
  - 사이드바: `aws-snapshots` 토픽을 구독하고 `GET /api/aws-snapshots/summary`를 사용. `root.state === "not_configured"`면 아이콘을 그리지 않는다.
  - 목록·상세: `aws-snapshots.changed`를 받으면 REST로 다시 조회한다. 스트림에는 행 데이터가 없다.
  - 저장: 422 응답의 `details.missing`을 `confirm`에 넣어 다시 보낸다. 버전은 본문 `baseVersion`으로 보낸다.
  - 쓰기 요청은 모두 `Content-Type: application/json`으로 보낸다. 복원·새로고침도 본문 `{}`.
  - 파일 내용은 LF로 받고 LF로 보내면 된다. CodeMirror 기본 동작과 맞는다.
- `publisher 요청`: 없음. mock 그룹 키 `snapshots`는 디자인 제안과 같다.

### 9. 다음 담당이 알아야 할 점
- 계약: `docs/api/aws-snapshot-manager.md`. 구현할 것은 15절 "구현 메모"에 모았다: compose, `.env.example`, `main.ts` CORS·본문 파서, 모듈, `yaml` 의존성, `lib/scan.mjs`의 `.trash` 건너뛰기와 `listRules()`, `.gitignore`, README 1·6·7.1장.
- 스냅샷 모듈은 `PrismaService`에 의존하지 않는다(DBA). mock에서는 실제 폴더에 fs 호출을 하지 않는다(AC-02). AWS·k8s·git·former2 호출은 0회다(AC-44).
- 로그에는 스냅샷 ID, 파일 종류, 결과 코드, 바이트 수만 남긴다. `VALIDATION_FAILED`의 `details.fields[].value`는 이 기능에서 넣지 않는다(1.4).
- 라우트는 고정 경로(summary·scan-rules·refresh·trash)를 `:id`보다 먼저 등록한다. catch-all(400)은 맨 끝이다.

## 2026-09-19 19:10 · 구현

### 1. 요청 내용
- PM이 계약을 승인하고 5단계 구현을 지시했다.
  - 구현 범위: 계약 전체(엔드포인트 13개, SSE, mock 시나리오 7종, 경로 탐색 방지, Origin·Content-Type 보호, baseVersion 409, 422 확인)와 계약 15절 할 일(`lib/scan.mjs`의 `.trash` 건너뛰기와 `listRules()`, `.gitignore`, README 1·6·7.1장, `yaml` 패키지).
  - PM 결정: 루트 `docker-compose.yml`과 `.env.example` 수정 허용(api `127.0.0.1:3001`, `snapshots/` 쓰기 마운트, `lib/` 읽기 전용 마운트, 환경 변수). db 5432는 건드리지 않는다. `apps/web`도 건드리지 않는다(publisher 작업 중).
  - 가장 먼저: CJS api에서 `.mjs` 동적 import가 jest와 nest build/start 모두에서 되는지 확인. 안 되면 대안을 정하고 계약을 갱신한다.
  - 검증: api lint·test, deploy/aws-snapshot 테스트, mock api를 :3011에 띄워 curl로 주요 흐름 확인. 종료는 자기 PID만.

### 2. 참고한 문서
- `docs/api/aws-snapshot-manager.md`(직전 계약), `docs/api/common.md`
- `docs/specs/aws-snapshot-manager.md` AC-01~51, `docs/design/aws-snapshot-manager.md` 8절(mock 문구)
- 기존 코드 패턴: `src/common/*`(ApiException, SourceRegistry, extension-points, list-query), `src/stream/*`, `src/health/*`, `src/cost/*.spec.ts`(eslint-disable 관례)

### 3. 작업 내용
1. **동적 import 확인 (가장 먼저)**
   - `src/aws-snapshots/scanner-loader.ts`를 만들고 세 가지로 확인했다.
   - jest: `npm test`(`--experimental-vm-modules`)에서 통과. `npx jest` 단독 실행은 "dynamic import callback" 오류로 실패한다.
   - `nest build`: 산출 JS에 `import()`가 그대로 남는다. `node dist/...`로 lib를 불러와 `scanText`가 동작했다.
   - 결론: 대안 없이 계약 2절대로 진행. 실행 조건을 계약 2절에 적었다.
2. **CLI lib** (`deploy/aws-snapshot/lib/scan.mjs`)
   - `scanPaths`가 폴더를 돌 때 `.trash`를 건너뛴다. 인자로 직접 준 경로는 그대로 스캔한다.
   - `listRules()`를 추가했다(id·severity·description, 정규식은 내보내지 않음).
   - 테스트 2개 추가.
3. **api 모듈 `src/aws-snapshots/`**
   - `snapshot.constants.ts`: ID·휴지통 ID 정규식, 파일 종류와 이름 고정 표, 시나리오, CLI 안내, 설정 안내 문구.
   - `text-utils.ts`: SHA-256 버전, 줄바꿈(lf/crlf/mixed/none)·BOM·UTF-8·줄 수·들여쓰기 판별, 원래 형식으로 되돌리기, 줄 단위 자르기.
   - `backend.ts`: 저장소 인터페이스.
     - `fs-backend.ts`(live): lstat로 링크를 거부하고 realpath로 루트 안인지 확인한다. 쓰기는 임시 파일 → fsync → 버전 재확인 → rename. 휴지통은 `<루트>/.trash`. EROFS만 READ_ONLY로 보고 나머지 errno는 WRITE_FAILED.
     - `memory-backend.ts`(mock): 같은 버전·충돌·휴지통 규칙을 메모리에서 적용한다.
   - `analyzer.ts`: 계약 10.1 판단, CLI와 같은 파일 선택으로 스캔, 리소스 수, 메타데이터·notes 해석, 정보 문구.
   - `mock-fixtures.ts`: 예시 9개와 휴지통 1개. 가짜 비밀값만 쓰고, 5.5MB 큰 템플릿이 포함된다.
   - `aws-snapshots.service.ts`
     - 주기 확인 10초. 지문(lstat)으로 바뀐 스냅샷만 다시 분석한다.
     - stale 90초, ROOT_MISSING이면 unavailable.
     - 쓰기 가능 여부 판단, 엔드포인트 로직, SSE(`aws-snapshots.snapshot`/`.changed`, 1초 debounce), mock 시나리오와 `resetData`.
   - `aws-snapshots.controller.ts`: ID·휴지통 ID·종류 파이프(오류 응답에 값 없음), 고정 경로를 `:id`보다 먼저, 맨 끝에 catch-all 400.
   - `write.guard.ts`: Origin 403, Content-Type 415.
   - `dto.ts`: 목록 쿼리, 파일 본문, 라벨·메모(길이·제어 문자), confirm 쿼리.
4. **공통 연결**
   - `main.ts`: CORS에 `DELETE` 추가. 템플릿 경로 전용 JSON 파서(편집 상한 × 2 + 64KB)를 전역 1MB 파서보다 먼저 등록.
   - `api-error.ts`: 413 문구, `content`/`label`/`memo` 값 제외.
   - `source-registry`: `snapshotStore`(10초, stale 90).
   - `extension-points`: 그룹 `snapshots`, 선택 훅 `resetData`. `mock-scenario.service`: 그룹 순서·라벨·기본값, reset 때 `resetData` 호출.
   - `stream.service`: 토픽 `aws-snapshots`. `health.service`: `checks.snapshotStore`.
   - `env.validation`: `AWS_SNAPSHOT_*` 7개. `app.module`에 모듈 등록.
5. **배포 파일**
   - `docker-compose.yml`: api 포트 `127.0.0.1:3001:3001`, `snapshots/` 쓰기 마운트, `lib/` 읽기 전용 마운트, env.
   - `.env.example`: 스냅샷 변수와 Docker 없이 실행할 때의 경로 안내.
   - `deploy/aws-snapshot/.gitignore`: `snapshots/.trash/`와 임시 파일 제외.
   - README 1장 폴더 구성, 5장 스캔 범위, 6장 체크리스트, 7.1(Q4) 문구.
6. **계약 갱신**(18절 변경 이력): 응답 모양은 그대로 두고 동작 5건을 정정했다(5절).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/aws-snapshots/snapshot.constants.ts` | 추가 | 상수·ID 변환 |
| `apps/api/src/aws-snapshots/text-utils.ts` | 추가 | 버전·줄바꿈·BOM·들여쓰기 |
| `apps/api/src/aws-snapshots/scanner-loader.ts` | 추가 | CLI lib 동적 import |
| `apps/api/src/aws-snapshots/backend.ts` | 추가 | 저장소 인터페이스 |
| `apps/api/src/aws-snapshots/fs-backend.ts` | 추가 | live 파일 시스템 |
| `apps/api/src/aws-snapshots/memory-backend.ts` | 추가 | mock 메모리 |
| `apps/api/src/aws-snapshots/mock-fixtures.ts` | 추가 | 예시 스냅샷 |
| `apps/api/src/aws-snapshots/analyzer.ts` | 추가 | 상태 판단·스캔 |
| `apps/api/src/aws-snapshots/aws-snapshots.service.ts` | 추가 | 서비스·SSE·mock |
| `apps/api/src/aws-snapshots/aws-snapshots.controller.ts` | 추가 | REST 13개 + catch-all |
| `apps/api/src/aws-snapshots/aws-snapshots.module.ts` | 추가 | 모듈(Prisma 비의존) |
| `apps/api/src/aws-snapshots/dto.ts`, `write.guard.ts` | 추가 | 검증·쓰기 보호 |
| `apps/api/src/aws-snapshots/*.spec.ts` (4개) | 추가 | scanner-loader, fs-backend(CLI 동등성), http(mock), live |
| `apps/api/src/main.ts`, `app.module.ts` | 수정 | CORS DELETE, 경로별 본문 파서, 모듈 등록 |
| `apps/api/src/common/api-error.ts` | 수정 | 민감 필드 값 제외, 413 문구 |
| `apps/api/src/common/source-registry.service.ts`, `extension-points.ts` | 수정 | `snapshotStore`, 그룹 `snapshots`, `resetData` |
| `apps/api/src/config/env.validation.ts` | 수정 | `AWS_SNAPSHOT_*` |
| `apps/api/src/stream/stream.service.ts`, `stream.service.spec.ts`, `mock-scenario.service.ts` | 수정 | 토픽·그룹 |
| `apps/api/src/health/health.service.ts` | 수정 | `checks.snapshotStore` |
| `apps/api/package.json`, `package-lock.json` | 수정 | `yaml@^2.9.1` |
| `deploy/aws-snapshot/lib/scan.mjs`, `test/scan.test.mjs` | 수정 | `.trash` 건너뛰기, `listRules()` + 테스트 |
| `deploy/aws-snapshot/.gitignore`, `README.md` | 수정 | 휴지통·임시 파일 제외, 1·5·6·7.1장 |
| `docker-compose.yml`, `.env.example` | 수정 | 127.0.0.1 바인딩, 마운트, env (db 5432는 그대로) |
| `docs/api/aws-snapshot-manager.md` | 수정 | 구현 반영 정정 (18절) |
| `apps/api/dist/**` | 재생성 | 검증용 `nest build` 산출물 |

### 5. 주요 결정과 이유 (계약과 달라진 점 포함)
- **EACCES/EPERM → 500 WRITE_FAILED**(계약은 READ_ONLY였음): Windows에서는 편집기 파일 잠금도 EPERM으로 난다. 이것을 "읽기 전용"으로 굳히면 재시작 전까지 쓰기가 막힌다. 그래서 EROFS만 READ_ONLY로 굳힌다.
- **새로고침 중 요청이 오면 끝난 뒤 한 번 더 확인**: curl 검증에서 mock reset 뒤 목록이 8개로 남는 버그가 나왔다. 원인은 `setScenario`가 시작한 refresh가 이전 저장소를 읽는 중에 `resetData`의 refresh가 그 결과를 재사용한 것이다. 한 번 더 확인하도록 고쳤고, 테스트로 재현해 막았다.
- **내보내기 진행 중이면 주의 사유를 뺀다**: 매핑 없음(warning)이 unknown보다 우선이라 예시 7번이 "주의"로 보였다. 내보내기 도중에는 파일이 덜 쓰인 게 당연하므로 장애 사유와 진행 중 사유만 남긴다.
- **FILE_UNREADABLE 추가**: 읽기 실패한 파일은 편집 불가 사유로 따로 보인다.
- **검증 오류 값 제외는 공통 팩토리에서**: 전역 ValidationPipe가 기능 파이프보다 먼저 돌아서, 필드 이름(`content`·`label`·`memo`) 기준으로 값을 뺐다. 다른 기능에 같은 이름 필드가 생겨도 값이 빠진다(안전한 쪽).
- **mock은 주기 확인 없이 쓰기·시나리오 변경 때만 새로고침**: 메모리 데이터라 외부 변경이 없다.
- **스캔 동등성 테스트**: 임시 폴더에서 CLI `scanPaths`와 서버 결과(파일·줄·규칙·등급, 스캔 파일 순서)를 직접 비교한다(AC-08). 리소스 수도 `meta.mjs` 결과와 비교한다(AC-09).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과 | 0 오류. http spec은 기존 관례대로 unsafe-* 규칙을 파일 단위로 끔 |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 통과 | |
| `npm test --prefix apps/api` | 통과 | 33 suites, 315 passed, 1 skipped(기존). 신규 26건 |
| `npm run test:e2e --prefix apps/api` | 통과 | AppModule에 모듈 포함 상태 |
| `npm test --prefix deploy/aws-snapshot` | 통과 | 90 passed (신규 2) |
| `nest build` + `node dist/main.js` (mock, :3011) curl | 통과 | 아래 |
| `docker compose config` | 생략 | 이 PC에 docker 없음. YAML 파싱으로 포트·볼륨만 확인 |

curl 확인 항목(mock, :3011):
- 목록: 9개가 상태별로 나오고 요약 critical, 휴지통 1.
- 상세 사유와 발견 목록.
- 경로 탐색 400: `..%2F..%2Fetc`, `%2e%2e`, `abc`, `files/..%2F.env`, `a/b/c/d`, 원시 `../../etc/passwd`(`--path-as-is`).
- 템플릿 저장: 409 → 422(`secret_errors`) → 200(critical 유지, modifiedByDashboard).
- 쓰기 보호: 415(text/plain), 403(다른 Origin).
- 라벨·메모: 422(규칙 ID만, 값 누출 없음), 400(61자), 200(UTF-8 한글·줄바꿈).
- 삭제: 400(확인 불일치), 409(진행 중), 200 → 상세 404 → 휴지통 2 → 복원 200(라벨 유지) → 영구 삭제 불일치 400 / 200 / 재시도 404. 잘못된 휴지통 ID 400.
- scan-rules, 시나리오 목록(7종 문구), not-configured(`SOURCE_NOT_CONFIGURED`, `root.setup`), reset 후 9개 복원.
- health `checks.snapshotStore`, CORS preflight에 DELETE.
- SSE: `aws-snapshots.snapshot` → 삭제 후 `aws-snapshots.changed`(removedIds). 라벨·메모·템플릿 원문 없음.
- 처음 curl에서 한글 라벨이 깨진 것은 Windows 셸이 인자를 UTF-8이 아니게 넘겨서다. UTF-8 파일 본문(`--data-binary`)으로 다시 보내 정상 확인.
- 띄운 서버는 자기 PID(28560, 재기동 후 25144)만 `taskkill /PID`로 종료했다.

### 7. 남은 이슈·한계
- **db 포트 5432가 모든 인터페이스에 열려 있다**(PM 지시로 이번에 건드리지 않음). 사용자 판단이 필요하다.
- docker compose로 실제 마운트·쓰기(AC-48, AC-49)는 확인하지 못했다(docker 없음). Windows 호스트 바인드 마운트에서 `fs.access(W_OK)`가 틀린 값을 줄 수 있다.
- 스냅샷 폴더 안 심볼릭 링크는 스캔하지 않는다. 이 경우만 CLI 결과와 다르다(계약 14절 5).
- 쓰기 후 EROFS로 굳힌 READ_ONLY는 프로세스 재시작 전까지 유지된다.
- 폴더 지문은 10초마다 모든 스냅샷의 파일을 lstat한다. 수백 개 × 파일 5개 규모에서는 문제없다고 판단했지만 측정하지는 않았다.
- mock 큰 템플릿(5.5MB)은 시작과 reset 때마다 만들고 스캔한다. 메모리 약 10MB, 시작 지연은 체감되지 않았다.
- `npm install yaml` 뒤 npm audit 경고가 표시됐다. 기존 의존성 쪽 경고로 보이며 조치하지 않았다.

### 8. 다른 담당 요청
- `PM 요청`: db 5432 공개 범위를 사용자에게 확인해 주세요. docker가 있는 환경에서 compose 기동과 AC-48·49 확인이 필요합니다.
- `frontend 요청`: 계약 그대로 쓰면 됩니다. 쓰기 요청은 `Content-Type: application/json`으로 보내야 하고, 복원·새로고침 본문도 `{}`입니다. mock 그룹 키는 `snapshots`, SSE 토픽은 `aws-snapshots`입니다. 편집기 내용은 LF로 보내면 서버가 원래 줄바꿈으로 되돌립니다.

### 9. 다음 담당이 알아야 할 점
- api 테스트는 반드시 `npm test --prefix apps/api`로 돌린다. `npx jest`는 동적 import 때문에 이 기능의 테스트가 실패한다.
- Docker 없이 live로 쓰려면 `apps/api/.env`(또는 루트 `.env`)에 `DATA_SOURCE=live`, `AWS_SNAPSHOT_DIR=../../deploy/aws-snapshot/snapshots`를 둔다. lib 위치는 기본값으로 찾는다.
- mock 시나리오 변경: `PUT /api/mock/scenarios/snapshots {"scenario":"read-only"}`. 원래 예시로 되돌리기: `POST /api/mock/reset`.

## 2026-09-19 19:30 · frontend 요청 필드 추가 (cli, 진행 중 판단 시각)

### 1. 요청 내용
- PM이 frontend 요청(선택) 2건을 전달했다. 응답에 필드만 추가하고 하위 호환을 지킨다.
  1. 상세 또는 요약 응답에 `cli` 블록(재스캔 명령 등 서버 값).
  2. 내보내기 진행 중 판단 기준 시각 필드.
- 조건: 계약 갱신, api lint·test. 서버는 띄우지 않는다.

### 2. 참고한 문서
- `docs/api/aws-snapshot-manager.md` 5·6.1·6.3절, 명세 3.3(30분 기준)

### 3. 작업 내용
- `GET /api/aws-snapshots/summary`: 최상위 `cli`(목록의 `cli`와 같음, `scan`은 `<id>` 그대로).
- `GET /api/aws-snapshots/:id`: 최상위 `cli`. `scan`에 스냅샷 ID가 채워져 있다(`npm run scan --prefix deploy/aws-snapshot -- snapshots/<ID>`).
- `SnapshotListItem.exportInProgress`: `{ active, metadataMissing, lastChangeAt, untilAt, thresholdMinutes }`.
  - 목록 `items[]`, 상세 `snapshot`, 저장·라벨·복원 응답의 `snapshot`에 모두 들어간다.
  - `untilAt` = `lastChangeAt` + 기준 분. metadata가 있으면 `null`.
- 테스트: 기존 http spec에 단언을 추가했다(진행 중 예시의 `untilAt - lastChangeAt = 30분`, 상세 `cli.scan`에 ID, 정상 스냅샷 `untilAt: null`, summary `cli`).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/aws-snapshots/aws-snapshots.service.ts` | 수정 | `cliFor()`, `exportProgress()`, 응답 필드 추가 |
| `apps/api/src/aws-snapshots/aws-snapshots.http.spec.ts` | 수정 | 단언 추가 |
| `docs/api/aws-snapshot-manager.md` | 수정 | 5절 `ExportProgress`, 6.1·6.3 `cli`, 18절 이력 |

### 5. 주요 결정과 이유
- `cli`는 요약과 상세 두 곳에 넣었다. 상세는 ID를 채운 값이라 화면이 치환하지 않아도 된다. 요약은 목록을 부르지 않는 빈 상태 화면용이다.
- 진행 중 필드는 상세 전용이 아니라 목록 행 타입에 넣었다. 목록의 편집·삭제 비활성 이유 옆에도 "HH:mm까지"를 보일 수 있게 하려는 것이다. 판단 자체는 여전히 서버가 하고(`active`), 화면은 시각만 표시한다.
- 기존 필드는 바꾸지 않았다(추가만).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과 | 오류 0 |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 통과 | |
| `npm test --prefix apps/api` | 통과 | 33 suites, 315 passed, 1 skipped (기존 테스트 안에 단언 추가, 건수 변화 없음) |
| 서버 기동·curl | 생략 | PM 지시(서버 띄우지 않음) |

### 7. 남은 이슈·한계
- `untilAt`은 판단 시점의 파일 시각 기준이다. 그 사이 CLI가 파일을 더 쓰면 다음 확인(10초 주기)에서 늦춰진다.

### 8. 다른 담당 요청
- `frontend 요청`: 필드 이름·위치는 3절 참고. `exportInProgress.active`가 편집·삭제 가능 여부의 근거는 아니다. 버튼 활성은 계속 `actions`를 따른다.

### 9. 다음 담당이 알아야 할 점
- 계약 5절 `ExportProgress`, 6.1·6.3의 `cli` 행.
