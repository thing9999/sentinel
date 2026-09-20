# API 계약: aws-snapshot-manager

- 작성: backend, 2026-09-19 (4단계 계약) / 갱신: 2026-09-19 (5단계 구현 반영, 18절 변경 이력)
- 공통 규약: `docs/api/common.md` (2절 상태·출처, 3절 에러, 5절 SSE, 6절 mock 시나리오). 이 문서가 명시적으로 덮어쓰는 곳은 14절에 모았다.
- 명세: `docs/specs/aws-snapshot-manager.md` (확정본, AC-01~AC-51, Q1~Q4 결정) / DBA: `docs/reports/aws-snapshot-manager/dba.md` (스키마 변경 없음) / 디자인: `docs/design/aws-snapshot-manager.md` (이 계약 작성 시점에는 아직 없음. 나오면 화면 ↔ 엔드포인트 표만 맞춘다)
- CLI 기준: `deploy/aws-snapshot/` (`export.mjs`, `scan.mjs`, `lib/scan.mjs`, `lib/meta.mjs`, `metadata.json` `schemaVersion: 1`)

**이 기능의 경계 (AC-44)**
- 쓰기는 **로컬 스냅샷 폴더 안의 파일에만** 한다: `cloudformation.yml`, `terraform.tf`, `notes.json`(라벨·메모, 3절), 휴지통 이동·복원·영구 삭제(9절).
- AWS API·쿠버네티스 API·모니터링 대상 DB를 **한 번도 호출하지 않는다.** `git`, former2, CLI 스크립트(`export.mjs`, `scan.mjs`)를 **실행하지 않는다.** 스캐너 규칙은 CLI의 라이브러리 모듈을 import해서 함수로만 쓴다(2절).
- 대시보드 자체 DB(Prisma)를 쓰지 않는다. 스냅샷 서비스는 `PrismaService`에 의존하지 않는다(DBA 요청).
- 인증은 없다(`common.md` 1.2, 명세 A1). 쓰기 요청 보호는 1.3절.

---

## 0. 화면 ↔ 엔드포인트

| 화면 (명세 3절) | REST | SSE (`aws-snapshots` 토픽) |
|---|---|---|
| 사이드바 "AWS 스냅샷" 상태 배지·장애 수 | `GET /api/aws-snapshots/summary` | `aws-snapshots.snapshot`, `aws-snapshots.changed` |
| 목록 요약 띠·필터·표·빈 상태·CLI 안내 | `GET /api/aws-snapshots` | `aws-snapshots.changed` → 목록 다시 조회 |
| 새로고침 버튼 | `POST /api/aws-snapshots/refresh` | |
| 스캔 규칙 도움말 표 (규칙·등급·설명) | `GET /api/aws-snapshots/scan-rules` | |
| 상세 A~D (요약·메타데이터·리소스 수·스캔) | `GET /api/aws-snapshots/:id` | `aws-snapshots.changed` (`changedIds`에 이 ID) → 다시 조회 |
| 상세 E 템플릿 탭 (보기, 메타 원문 보기) | `GET /api/aws-snapshots/:id/files/:kind` | |
| 저장 전 검사 (선택: "검사만") | `POST /api/aws-snapshots/:id/files/:kind/check` | |
| 템플릿 저장 (확인 창 포함) | `PUT /api/aws-snapshots/:id/files/:kind` | 저장 후 `aws-snapshots.changed` |
| 라벨·메모 편집 | `PUT /api/aws-snapshots/:id/notes` | 저장 후 `aws-snapshots.changed` |
| 삭제 (휴지통으로) | `DELETE /api/aws-snapshots/:id?confirm=<id>` | `aws-snapshots.changed` |
| 휴지통 목록 | `GET /api/aws-snapshots/trash` | `aws-snapshots.changed` (`trashChanged: true`) |
| 휴지통 복원 | `POST /api/aws-snapshots/trash/:trashId/restore` | `aws-snapshots.changed` |
| 휴지통 영구 삭제 | `DELETE /api/aws-snapshots/trash/:trashId?confirm=<snapshotId>` | `aws-snapshots.changed` |
| MOCK 배지 Popover 시나리오 | `common.md` 6절 그룹 `snapshots` (12절) | `aws-snapshots.snapshot` 재전송 |

**출처 ↔ 데이터** (`common.md` 2.3)

| 출처 | 데이터 | 주기 | stale 기준 |
|---|---|---|---|
| `snapshotStore` | 스냅샷 루트 폴더(`AWS_SNAPSHOT_DIR`)의 목록·파일 상태, 현재 스캔 결과 | 주기 확인 **10초**(파일 시각·크기 비교, 바뀐 스냅샷만 재스캔) + 대시보드 쓰기 직후 즉시 | **90초** (명세 4절. `intervalSec × 3` 규칙의 예외, 14절) |

---

## 1. 공통 규칙 (이 기능)

### 1.1 경로와 식별자 (경로 탐색 방지, 명세 3.9, AC-40~42)

| 입력 | 허용 형식 | 그 밖 |
|---|---|---|
| `:id` (스냅샷 ID) | 정규식 `^\d{8}-\d{6}$` **만** (예 `20260919-031500`) | 400 `VALIDATION_FAILED` (`details.fields[0].field = "id"`). 파일 시스템에 접근하기 전에 거부 |
| `:trashId` (휴지통 항목) | `^\d{8}-\d{6}__\d{8}T\d{9}Z$` (예 `20260915-101010__20260919T050210123Z`, 9.0) | 400 `VALIDATION_FAILED` |
| `:kind` (파일 종류) | `cloudformation` \| `terraform` \| `mapping` \| `metadata` | 400 `VALIDATION_FAILED`. **파일 이름은 요청으로 받지 않는다** |
| `confirm` 쿼리 | 대상 스냅샷 ID와 정확히 같은 문자열 | 400 `SNAPSHOT_CONFIRM_MISMATCH` |

- 종류 → 파일 이름은 서버 고정 표: `cloudformation → cloudformation.yml`, `terraform → terraform.tf`, `mapping → logical-id-mapping.json`, `metadata → metadata.json`. `notes.json`은 `/notes` 엔드포인트로만 다룬다.
- Express가 경로 파라미터를 디코딩한 **뒤** 형식 검사를 한다. `%2e%2e`, `%2f`, `%5c`, `%00`은 디코딩 후 `..`, `/`, `\`, NUL이 되어 정규식에 걸린다.
- `/api/aws-snapshots/` 아래에서 어느 라우트에도 맞지 않는 경로(예: 인코딩하지 않은 `/`나 `..`가 들어가 세그먼트가 나뉜 요청)는 **컨트롤러 맨 끝의 catch-all이 400 `VALIDATION_FAILED`** 로 답한다(404가 아님, AC-40). 이 경로 아래에 새 엔드포인트를 추가할 때는 catch-all보다 먼저 등록한다.
- 경로 해석 (서버 내부 규칙, 모든 읽기·쓰기 공통)
  1. `root = realpath(AWS_SNAPSHOT_DIR)` (시작 시와 매 주기 확인 때 다시 계산).
  2. 대상 = `path.join(root, id[, 파일 이름])`. `lstat`으로 **심볼릭 링크·정션이면 거부**(403 `SNAPSHOT_PATH_REJECTED`). 따라가지 않는다.
  3. `realpath(대상)`이 `root + path.sep`로 시작하지 않으면 거부(403 `SNAPSHOT_PATH_REJECTED`).
  4. 파일 종류 대상은 `lstat().isFile()`이어야 한다(디렉터리·링크·장치 파일이면 403 `SNAPSHOT_PATH_REJECTED`).
- "인식하지 못한 항목"(이름 형식이 안 맞는 폴더·파일, 루트의 심볼릭 링크/정션)은 목록에 넣지 않고 요약의 `unrecognized`에만 이름으로 알린다. 이 항목에 대한 요청은 이름 형식에서 400, 형식은 맞지만 링크면 403이다(AC-20, AC-41). 제외 대상: `.gitkeep`, `.trash`(휴지통, 9절).

### 1.2 쓰기 가능 여부 (명세 3.9, AC-39, AC-47)

서버가 판단해 응답에 `WriteAbility` 객체로 준다. 화면은 이 값으로 버튼을 끄고 이유를 보인다(다시 판단하지 않는다).

```ts
interface WriteAbility {
  allowed: boolean;
  reasonCode: WriteBlockCode | null;   // allowed=true면 null
  reasonText: string | null;           // 한국어 한 줄 (예: "스냅샷 폴더가 읽기 전용입니다")
}

type WriteBlockCode =
  | 'WRITE_DISABLED'             // AWS_SNAPSHOT_WRITE_ENABLED=false ("쓰기 기능 꺼짐")
  | 'READ_ONLY'                  // 루트가 읽기 전용 (fs.access W_OK 실패) 또는 쓰기 시도가 EROFS로 실패한 뒤 (프로세스 재시작 전까지 유지)
  | 'SOURCE_UNAVAILABLE'         // 출처가 not_configured/unavailable/stale
  | 'EXPORT_MAYBE_IN_PROGRESS'   // metadata.json 없음 + 최근 변경 30분 이내 (스냅샷 단위)
  | 'NOTES_CORRUPT'              // notes.json이 있는데 JSON 해석 실패 (라벨·메모 편집만)
  | 'FILE_KIND_READ_ONLY'        // mapping / metadata (파일 단위, AC-32)
  | 'FILE_MISSING'               // 파일 없음 (새 파일 만들기는 범위 밖)
  | 'FILE_UNREADABLE'            // 파일을 읽을 수 없음 (권한 등)
  | 'FILE_TOO_LARGE'             // 편집 상한 초과 (AC-12)
  | 'NOT_UTF8'                   // UTF-8로 해석되지 않음 (인코딩 유지 불가)
  | 'MIXED_LINE_ENDINGS'         // LF와 CRLF가 섞임 (줄바꿈 유지 불가, 14절)
  | 'SNAPSHOT_ID_EXISTS';        // 휴지통 복원 대상 ID가 이미 있음 (9.2 restore만)
```

- 판단 순서(앞이 우선): `SOURCE_UNAVAILABLE` → `WRITE_DISABLED` → `READ_ONLY` → `EXPORT_MAYBE_IN_PROGRESS` → 파일/라벨 단위 사유.
- mock 모드: 실제 파일 시스템을 보지 않는다. 시나리오 `read-only`/`write-disabled`로 재현(12절).

### 1.3 쓰기 요청 보호 (인증 없는 쓰기 API, 명세 3.9)

이 기능의 쓰기 엔드포인트(`PUT`, `POST`, `DELETE`)에만 적용한다(다른 기능은 영향 없음).

1. **`Origin` 검사**: 요청에 `Origin` 헤더가 있으면 `CORS_ORIGIN` 목록 중 하나여야 한다. 아니면 403 `ORIGIN_NOT_ALLOWED`. (`Origin`이 없는 요청 = curl·서버 간 호출은 허용.) 다른 사이트의 폼 제출·DNS 리바인딩으로 로컬 API에 쓰는 것을 막는다.
2. **`Content-Type: application/json` 필수**(본문이 없는 `DELETE` 제외): 아니면 415 `UNSUPPORTED_MEDIA_TYPE`. 브라우저의 "단순 요청"(`text/plain` 폼 POST)으로 preflight 없이 쓰는 경로를 없앤다. 복원(`POST .../restore`)처럼 본문이 필요 없는 요청도 `{}`를 보낸다.
3. `DELETE`는 브라우저에서 항상 preflight를 거치므로 CORS가 막는다(1.2 `common.md` 허용 메서드에 `DELETE` 추가).
4. docker compose에서 api 포트를 `127.0.0.1`에만 연다(구현 메모 15절).

### 1.4 로그·오류 메시지 (명세 3.9, AC-10, AC-43)
- 서버 로그에는 **스냅샷 ID, 파일 종류, 결과 코드, 바이트 수**만 남긴다. 템플릿 내용·라벨·메모·스캔에 걸린 값·YAML 파서 원문 메시지(코드 조각 포함)는 남기지 않는다.
- 오류 응답의 `message`·`details`에도 위 내용이 없다. 검증 실패(`VALIDATION_FAILED`)의 `details.fields[].value`는 이 기능에서 **넣지 않는다**(`content`, `label`, `memo`가 그대로 나갈 수 있으므로). `field`와 `constraints`만.
  - 구현: 경로 파라미터(`id`, `trashId`, `kind`) 파이프와 catch-all은 값을 넣지 않는다. 본문 필드 `content`·`label`·`memo`는 공통 `validationExceptionFactory`가 값을 빼고 낸다(이 이름의 필드는 다른 기능에서도 값이 빠진다).
- 스캔 발견 설명(`message`)은 CLI 스캐너 문구 그대로다. CLI가 이미 값을 `앞 2글자****(N자)`로 가린다(`maskValue`).

### 1.5 시각
- `snapshotAt`: 폴더 이름(UTC, 명세 A4)을 ISO로 바꾼 값. `20260919-031500` → `2026-09-19T03:15:00.000Z`. 달력에 없는 날짜(예 `20261399-…`)면 `null`(정렬은 ID 문자열로).
- 파일 시각(`modifiedAt`)은 `lstat().mtime`. 화면은 로컬 시각 + UTC 툴팁(명세 A4).

---

## 2. 스캐너·리소스 수 재사용 (AC-08, AC-09)

**결정: api가 CLI의 라이브러리 모듈(`deploy/aws-snapshot/lib/scan.mjs`, `lib/meta.mjs`)을 실행 시점에 동적 `import()`로 불러 쓴다. 규칙 사본을 두지 않는다.**

| 항목 | 내용 |
|---|---|
| 위치 설정 | env `AWS_SNAPSHOT_LIB_DIR`. 기본값: `process.cwd()` 기준 `../../deploy/aws-snapshot/lib` (Docker 없이 `apps/api`에서 실행할 때 저장소의 lib). docker compose는 `./deploy/aws-snapshot/lib`를 `/opt/aws-snapshot/lib`에 **읽기 전용** 마운트하고 이 값을 준다(15절) |
| 불러오는 것 | `scan.mjs`: `scanText`, `summarize`, `ALLOW_MARKER`, `SCANNABLE_EXTENSIONS` / `meta.mjs`: `countCloudFormationResources`, `countTerraformResources` |
| 불러오는 시점 | live에서 `AWS_SNAPSHOT_DIR`가 설정됐을 때, 또는 mock 모드(명세 3.12 "mock에서도 실제 스캐너 규칙")일 때 최초 1회 |
| 실행 조건 | CJS로 컴파일된 api에서 `import()`가 그대로 남는다(`module: nodenext`). `nest build`/`nest start`는 그대로 동작. **jest는 `--experimental-vm-modules`가 필요**하므로 `npm test --prefix apps/api`로 돌린다(`npx jest` 단독 실행은 실패). 확인 2026-09-19 |
| 실패 시 | 파일이 없거나 위 export가 하나라도 없으면 출처 `snapshotStore`를 `unavailable`, `error.code = "SCANNER_UNAVAILABLE"`. 목록은 200 + 요약 unknown, 상세·쓰기는 503 `SOURCE_UNAVAILABLE`. 스캔 없이 상태를 "정상"으로 보이지 않기 위해서다 |
| AC-44와의 관계 | CLI **스크립트**(`export.mjs`, `scan.mjs`)는 실행하지 않는다. `lib/scan.mjs`·`lib/meta.mjs`는 `node:fs`/`node:path`만 import하고 부작용이 없는 함수 모듈이다 |

**CLI `npm run scan -- snapshots/<id>`와 같은 결과를 내는 규칙** (서버가 `scanPaths` 대신 직접 구현하는 부분)
- 스캔 대상 파일: 스냅샷 폴더 아래 **재귀**, 확장자가 `SCANNABLE_EXTENSIONS`(`.yml .yaml .tf .hcl .json .template`, 대소문자 무시)인 일반 파일 전부. 이름순 정렬(`readdir().sort()`), 하위 폴더도 같은 규칙. → `metadata.json`, `logical-id-mapping.json`, `notes.json`, 예상 밖 `.json`/`.yml` 파일도 스캔한다(CLI와 같음).
- 파일 내용은 UTF-8로 읽어 `scanText(text, <스냅샷 폴더 기준 상대 경로>)`에 넘긴다. 합계는 `summarize(findings, { strict })`, `strict`는 `metadata.secretScan.strict`(없으면 `false`).
- `scanPaths`를 쓰지 않는 이유: (1) `scanPaths`는 `statSync`로 심볼릭 링크를 따라간다(명세 3.9 위반), (2) 저장 전 검사는 디스크가 아니라 **요청 본문**을 스캔해야 한다.
- 알려진 차이: 스냅샷 폴더 **안**의 심볼릭 링크는 따라가지 않고 스캔하지 않는다(CLI는 따라감). 이 경우 주의 사유 `UNEXPECTED_FILES`에 "(링크, 따라가지 않음)"을 붙인다. 링크가 없는 폴더에서는 결과가 CLI와 같다.
- 리소스 수: `countCloudFormationResources(cloudformation.yml 내용)`, `countTerraformResources(terraform.tf 내용)`. 파일이 없으면 `null`.
- 구현 단계 테스트: `apps/api` 테스트가 저장소의 lib를 불러 CLI 테스트 픽스처 폴더에 대해 `scanPaths` 결과와 서버 결과(파일·줄·규칙·등급)가 같은지 비교한다.

---

## 3. 라벨·메모 파일 `notes.json` (Q1 결정)

- 위치: `snapshots/<id>/notes.json`. 대시보드가 **처음 라벨·메모를 저장하거나 템플릿을 저장할 때** 만든다. CLI는 이 파일을 만들지도 읽지도 않는다(`npm run scan`은 `.json`이라 스캔한다).
- 형식 (UTF-8, LF, 2칸 들여쓰기, 끝 줄바꿈):

```json
{
  "schemaVersion": 1,
  "tool": "sentinel dashboard",
  "snapshotId": "20260912-020000",
  "label": "EKS 1.30 업그레이드 전",
  "memo": "노드그룹 m6i.large 3대 시점, 복원 기준",
  "updatedAt": "2026-09-19T05:10:00.000Z",
  "templateEdits": {
    "terraform": { "savedAt": "2026-09-19T05:12:41.000Z", "version": "sha256:9c1e…" }
  }
}
```

| 필드 | 설명 |
|---|---|
| `label`, `memo` | 비어 있을 수 있음(`""`). 메모의 줄바꿈은 JSON `\n` |
| `updatedAt` | 라벨·메모를 마지막으로 바꾼 시각(명세 3.5). 템플릿 저장으로는 바뀌지 않는다 |
| `templateEdits.<kind>` | 대시보드가 그 파일을 마지막으로 저장한 시각과 저장 직후 버전. **현재 파일 버전이 이 값과 같으면** "대시보드에서 수정"으로 표시한다(`modifiedByDashboard`). 편집기·`git checkout`으로 바뀌면 버전이 달라져 표시가 꺼진다 |

- 알 수 없는 필드는 보존한다(읽은 객체에 덮어써서 저장).
- `notes.json`이 있는데 JSON이 아니면: 스냅샷 주의 사유 `NOTES_CORRUPT`, 라벨은 `null`, 라벨·메모 편집 불가(`NOTES_CORRUPT`), 템플릿 저장 시 `templateEdits` 기록을 건너뛴다(템플릿 저장 자체는 된다). 대시보드는 손상된 파일을 덮어쓰지 않는다.
- 알려진 파일 목록은 5개가 된다(`cloudformation.yml`, `terraform.tf`, `logical-id-mapping.json`, `metadata.json`, `notes.json`). `notes.json`은 "예상 밖 파일"이 아니다.

---

## 4. 버전과 충돌 감지 (명세 3.7, AC-30)

- **파일 버전** `version`: 디스크 파일 **바이트**의 SHA-256, 문자열 `"sha256:<64자 hex>"`. 화면에는 불투명 문자열로 다룬다(비교만).
- **라벨·메모 버전** `notes.version`: `{"label":…,"memo":…}` 정규 JSON(키 순서 고정)의 SHA-256. 파일이 없으면 빈 라벨·메모 기준 값. `templateEdits`·`updatedAt` 변화로는 바뀌지 않는다 → 템플릿 저장 뒤 같은 탭에서 라벨을 저장해도 충돌이 나지 않는다.
- 저장 요청은 편집을 시작할 때 받은 버전을 `baseVersion`으로 보낸다. 서버는 쓰기 직전에 현재 버전을 다시 계산해 다르면 **409 `SNAPSHOT_VERSION_CONFLICT`**. 강제 덮어쓰기 옵션은 **없다**.
- 파일 `GET`은 `ETag: "<version>"`, `Cache-Control: no-store` 헤더도 준다(참고용). 조건부 요청 헤더(`If-Match`)는 받지 않는다. 버전은 본문 `baseVersion` 하나로만 전달한다(CORS 허용 헤더를 늘리지 않기 위해).
- 편집 중 외부 변경 알림(명세 4절): `aws-snapshots.changed`의 `changedIds`에 편집 중인 ID가 있으면 화면이 상세를 다시 받아 `files[].version`을 비교하고, 다르면 "파일이 바뀌었습니다" 알림만 띄운다(편집 내용은 그대로).

---

## 5. 공통 타입

```ts
type Status = 'ok' | 'warning' | 'critical' | 'unknown';          // common.md 2.1
type FileKind = 'cloudformation' | 'terraform' | 'mapping' | 'metadata';

interface ScanFinding {
  file: string;              // 스냅샷 폴더 기준 상대 경로, '/' 구분 (예: "terraform.tf", "extra/a.yml")
  fileKind: FileKind | 'notes' | null;   // 알려진 파일이면 종류, 아니면 null (탭 이동 불가)
  line: number;              // 1부터
  rule: string;              // CLI 규칙 ID (private-key, aws-access-key-id, env-block, user-data, secret-key-value …)
  severity: 'error' | 'warn';            // CLI 값 그대로 (Status가 아님)
  message: string;           // CLI 문구 그대로. 값은 이미 가려짐
}

interface ScanSummary {
  errors: number;
  warnings: number;
  strict: boolean;           // 이 스냅샷이 strict로 내보내졌는지 (metadata.secretScan.strict)
  passed: boolean;           // errors === 0 && (!strict || warnings === 0)
  rules: string[];           // 발견된 규칙 ID, 정렬, 중복 없음
}

interface ResourceCounts { cloudformation: number | null; terraform: number | null }   // 파일 없으면 null

interface SnapshotResources {
  current: ResourceCounts;                  // 현재 파일 기준 (CLI meta.mjs 규칙)
  atExport: ResourceCounts | null;          // metadata.resources (메타 없거나 손상이면 null)
  changedSinceExport: boolean;              // current와 atExport가 다름
  previous: { snapshotId: string; counts: ResourceCounts } | null;   // 같은 region의 바로 이전 스냅샷 (현재 기준)
  delta: ResourceCounts | null;             // current - previous.counts, 한쪽이 null이면 그 항목 null
}

interface SnapshotActions {
  editTemplates: WriteAbility;   // 스냅샷 단위 사유만. 파일 단위 사유는 files[].editable
  editNotes: WriteAbility;
  delete: WriteAbility;
}

// 목록 한 행 (목록 응답·저장 응답의 snapshot 필드)
interface SnapshotListItem {
  id: string;                         // "20260919-031500"
  snapshotAt: string | null;          // UTC ISO (1.5)
  status: StatusInfo;                 // common.md 2.2, 사유 코드는 10절
  label: string | null;               // notes.json 없거나 빈 문자열이면 null
  memo: string | null;                // 목록 검색용 (REST에만. SSE에는 없음, 9절)
  notesUpdatedAt: string | null;
  region: string | null;              // metadata.region
  scope: {
    searchFilter: string | null;
    regexFilter: string | null;
    services: { mode: 'include' | 'exclude'; list: string[] } | null;   // 전체 목록. "외 N개" 줄임은 화면
  } | null;                           // metadata 없거나 손상이면 null
  resources: SnapshotResources;
  scan: ScanSummary;                  // 현재 스캔 (상태 판단 기준)
  lastModifiedAt: string | null;      // 알려진 파일 중 가장 늦은 mtime
  modifiedByDashboard: boolean;       // 3절 templateEdits 기준
  former2Version: string | null;      // metadata.former2.version
  actions: SnapshotActions;
  exportInProgress: ExportProgress;   // (추가 2026-09-19) "내보내기 진행 중일 수 있음" 판단 근거
}

// "내보내기 진행 중일 수 있음"(명세 3.3) 판단 근거. 화면이 "HH:mm까지 편집·삭제 잠김" 등을 보일 때 쓴다
interface ExportProgress {
  active: boolean;             // 지금 진행 중으로 판단함 (= status 사유 EXPORT_MAYBE_IN_PROGRESS, 편집·삭제 불가)
  metadataMissing: boolean;    // metadata.json 없음 (판단 대상 여부)
  lastChangeAt: string;        // 폴더와 그 안 모든 항목 mtime의 최댓값 (판단 기준 시각)
  untilAt: string | null;      // lastChangeAt + thresholdMinutes. 이 시각이 지나면 주의("metadata.json 없음")로 바뀜. metadata가 있으면 null
  thresholdMinutes: number;    // AWS_SNAPSHOT_IN_PROGRESS_MIN (기본 30)
}
```

---

## 6. 조회

### 6.1 `GET /api/aws-snapshots/summary`

사이드바 메뉴 상태·장애 수, 목록 요약 띠. SSE `aws-snapshots.snapshot`·`aws-snapshots.changed`의 `summary`와 같은 모양.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "revision": 42,
  "summary": {
    "status": {
      "status": "critical",
      "reasons": [
        { "code": "SNAPSHOTS_COMMIT_BLOCKED", "text": "커밋 금지 스냅샷 2개", "status": "critical" },
        { "code": "SNAPSHOTS_NEED_REVIEW", "text": "주의 스냅샷 3개", "status": "warning" }
      ],
      "updatedAt": "2026-09-19T05:02:05.000Z",
      "statusChangedAt": "2026-09-19T03:16:10.000Z",
      "stale": false
    },
    "counts": { "total": 9, "critical": 3, "warning": 3, "unknown": 1, "ok": 2 },
    "unrecognized": { "count": 1, "names": ["old-backup"] },
    "trashCount": 1,
    "root": {
      "configured": true,
      "displayPath": "deploy/aws-snapshot/snapshots",
      "state": "ok",
      "setup": null
    },
    "writable": { "allowed": true, "reasonCode": null, "reasonText": null },
    "lastCheckedAt": "2026-09-19T05:02:05.000Z",
    "limits": { "editMaxBytes": 5242880, "viewMaxBytes": 20971520, "inProgressMinutes": 30, "labelMaxLength": 60, "memoMaxLength": 2000 }
  },
  "cli": { "...": "6.2 cli와 같음 (추가 2026-09-19)" }
}
```

| 필드 | 설명 |
|---|---|
| `revision` | 저장소 상태가 바뀔 때마다 1씩 오르는 정수(프로세스 수명 동안). 화면은 받은 값과 같으면 다시 조회하지 않아도 된다 |
| `summary.status` | 메뉴 상태 = 스냅샷 상태 중 최악(명세 3.4). 스냅샷 0개면 `ok`. 출처가 `not_configured`/`unavailable`이면 `unknown` + `SOURCE_NOT_CONFIGURED`/`SOURCE_UNAVAILABLE`(10.2). stale이면 `stale: true`, 값 유지 |
| `summary.counts.critical` | 메뉴 옆 숫자(장애 = 커밋 금지 수). 0이면 화면이 숨긴다 |
| `unrecognized.names` | 최대 20개, 이름만 |
| `root.displayPath` | 화면 표시용 경로. env `AWS_SNAPSHOT_DISPLAY_PATH`가 있으면 그 값, 없으면 `AWS_SNAPSHOT_DIR` 원문. mock은 `"(예시 데이터)"`. 설정 없음이면 `null` |
| `root.state` | `SourceState` (`common.md` 2.3): `ok` \| `syncing` \| `stale` \| `unavailable` \| `not_configured` \| `mock` |
| `root.setup` | `not_configured`/`unavailable`일 때만 객체, 그 밖에는 `null`. 화면의 설정 안내(디자인 3.7 hint)에 쓰는 값: `{ "envVar": "AWS_SNAPSHOT_DIR", "dockerMount": "./deploy/aws-snapshot/snapshots:/data/aws-snapshots", "localExample": "AWS_SNAPSHOT_DIR=../../deploy/aws-snapshot/snapshots", "reasonText": "스냅샷 폴더를 찾을 수 없습니다: /data/aws-snapshots" }`. 서버는 폴더를 만들지 않는다 |
| `writable` | 루트 단위 쓰기 가능 여부(1.2). 스냅샷 단위는 목록 행의 `actions` |
| `limits` | 화면 안내·클라이언트 검증용 설정값 |
| `cli` | (추가 2026-09-19) 6.2 `cli`와 같은 CLI 안내. 목록을 부르지 않는 화면(빈 상태 안내 등)용. `scan`의 `<id>`는 그대로 |

- **설정 없음 구분 (PM 결정)**: live에서 `AWS_SNAPSHOT_DIR`가 비어 있으면 `summary.status.status = "unknown"`, `reasons[0].code = "SOURCE_NOT_CONFIGURED"`, `root.state = "not_configured"`, `root.configured = false`, `counts` 모두 0. 사이드바는 이 조합(`root.state === "not_configured"`)에서 **상태 아이콘을 그리지 않는다**(숫자 배지도 없음). 폴더 없음·읽기 실패(`SOURCE_UNAVAILABLE`, `root.state = "unavailable"`)는 설정 문제가 아니라 장애이므로 사이드바에 unknown 아이콘을 그린다. 두 경우 모두 페이지 안에서는 unknown + `root.setup` 안내.
- 이 요약은 **클러스터 전체 상태(`/api/overview`의 `overall`·`attention`)에 들어가지 않는다**(명세 3.4, AC-21).
- 오류: 없음(항상 200).

### 6.2 `GET /api/aws-snapshots`

**쿼리**

| 이름 | 형식 | 설명 |
|---|---|---|
| `status` | 쉼표 구분 `ok,warning,critical,unknown` | 여러 개 |
| `region` | 쉼표 구분 문자열 | `metadata.region` 일치 |
| `q` | 문자열 1~200자 | 라벨·메모 부분 일치, 대소문자 무시. ID 부분 일치도 포함 |
| `sort` | `snapshotAt:desc`(기본) \| `snapshotAt:asc` \| `status:desc` \| `status:asc` | `status:desc` = critical → warning → unknown → ok, 같으면 최신순 |
| `limit`, `offset` | `common.md` 1.3 | 생략 시 전체 |

화면은 목록 전체를 한 번 받아 브라우저에서 필터해도 된다(수백 개 이하, 명세 3.1). 서버 필터는 같은 결과를 준다.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "revision": 42,
  "summary": { "...": "6.1 summary와 같음" },
  "total": 9, "filteredTotal": 9, "offset": 0, "limit": null,
  "regions": ["ap-northeast-2", "us-east-1"],
  "items": [
    {
      "id": "20260919-031500",
      "snapshotAt": "2026-09-19T03:15:00.000Z",
      "status": {
        "status": "critical",
        "reasons": [
          { "code": "SCAN_SECRET_ERRORS", "text": "비밀값 의심 2건 (env-block, url-credentials)", "status": "critical" },
          { "code": "SCAN_WARNINGS", "text": "검토 필요 1건 (user-data)", "status": "warning" }
        ],
        "updatedAt": "2026-09-19T03:16:10.000Z",
        "statusChangedAt": "2026-09-19T03:16:10.000Z",
        "stale": false
      },
      "label": null,
      "memo": null,
      "notesUpdatedAt": null,
      "region": "ap-northeast-2",
      "scope": {
        "searchFilter": "prod-eks",
        "regexFilter": null,
        "services": { "mode": "exclude", "list": ["SecretsManager", "SSM", "Lambda"] }
      },
      "resources": {
        "current": { "cloudformation": 42, "terraform": 44 },
        "atExport": { "cloudformation": 42, "terraform": 44 },
        "changedSinceExport": false,
        "previous": { "snapshotId": "20260918-120000", "counts": { "cloudformation": 60, "terraform": 62 } },
        "delta": { "cloudformation": -18, "terraform": -18 }
      },
      "scan": { "errors": 2, "warnings": 1, "strict": false, "passed": false, "rules": ["env-block", "url-credentials", "user-data"] },
      "lastModifiedAt": "2026-09-19T03:16:09.000Z",
      "modifiedByDashboard": false,
      "former2Version": "0.2.83",
      "actions": {
        "editTemplates": { "allowed": true, "reasonCode": null, "reasonText": null },
        "editNotes": { "allowed": true, "reasonCode": null, "reasonText": null },
        "delete": { "allowed": true, "reasonCode": null, "reasonText": null }
      }
    }
  ],
  "cli": {
    "install": "npm install --prefix deploy/aws-snapshot",
    "configure": "deploy/aws-snapshot/.env.example 을 .env 로 복사한 뒤 값을 채우세요",
    "dryRun": "npm run export:dry --prefix deploy/aws-snapshot",
    "export": "npm run export --prefix deploy/aws-snapshot",
    "scan": "npm run scan --prefix deploy/aws-snapshot -- snapshots/<id>",
    "readme": "deploy/aws-snapshot/README.md"
  }
}
```

| 필드 | 설명 |
|---|---|
| `regions` | 필터 선택지 (필터 전 전체에서) |
| `cli` | CLI 안내 문구(명세 3.10, AC-51). 화면이 복사 버튼과 함께 보인다. `scan`의 `<id>`는 상세 화면에서 화면이 치환한다. **서버는 이 명령을 실행하지 않는다** |

- 출처가 `not_configured`/`unavailable`이면 200 + `items: []` + `summary.status.status = "unknown"`(명세 3.11, AC-45, AC-46). **예시 데이터로 바꾸지 않는다.** 폴더를 만들지 않는다.
- 오류: 400 `VALIDATION_FAILED`(쿼리).

### 6.3 `GET /api/aws-snapshots/:id`

상세 화면 A~D와 템플릿 탭의 파일 정보. 템플릿 **내용은 넣지 않는다**(6.4).

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "revision": 42,
  "cli": {
    "install": "npm install --prefix deploy/aws-snapshot",
    "configure": "deploy/aws-snapshot/.env.example 을 .env 로 복사한 뒤 값을 채우세요",
    "dryRun": "npm run export:dry --prefix deploy/aws-snapshot",
    "export": "npm run export --prefix deploy/aws-snapshot",
    "scan": "npm run scan --prefix deploy/aws-snapshot -- snapshots/20260919-031500",
    "readme": "deploy/aws-snapshot/README.md"
  },
  "snapshot": {
    "...": "SnapshotListItem 필드 전부 (6.2 items[] 한 행과 같음, exportInProgress 포함)",
    "files": [
      {
        "kind": "cloudformation",
        "name": "cloudformation.yml",
        "exists": true,
        "sizeBytes": 183422,
        "lineCount": 4211,
        "modifiedAt": "2026-09-19T03:16:05.000Z",
        "version": "sha256:4f0b…",
        "eol": "lf",
        "bom": false,
        "encoding": "utf-8",
        "indent": { "style": "spaces", "size": 2 },
        "editable": { "allowed": true, "reasonCode": null, "reasonText": null },
        "viewTruncated": false
      },
      {
        "kind": "terraform",
        "name": "terraform.tf",
        "exists": true,
        "sizeBytes": 201877,
        "lineCount": 5002,
        "modifiedAt": "2026-09-19T03:16:07.000Z",
        "version": "sha256:9c1e…",
        "eol": "lf",
        "bom": false,
        "editable": { "allowed": true, "reasonCode": null, "reasonText": null },
        "viewTruncated": false
      },
      {
        "kind": "mapping", "name": "logical-id-mapping.json", "exists": true, "sizeBytes": 9120, "lineCount": 310,
        "modifiedAt": "2026-09-19T03:16:07.000Z", "version": "sha256:77aa…", "eol": "lf", "bom": false,
        "editable": { "allowed": false, "reasonCode": "FILE_KIND_READ_ONLY", "reasonText": "이 파일은 보기 전용입니다" },
        "viewTruncated": false
      },
      {
        "kind": "metadata", "name": "metadata.json", "exists": true, "sizeBytes": 1532, "lineCount": 58,
        "modifiedAt": "2026-09-19T03:16:09.000Z", "version": "sha256:0d3c…", "eol": "lf", "bom": false,
        "editable": { "allowed": false, "reasonCode": "FILE_KIND_READ_ONLY", "reasonText": "이 파일은 보기 전용입니다" },
        "viewTruncated": false
      }
    ],
    "extraFiles": [
      { "name": "notes.txt", "type": "file", "sizeBytes": 120 },
      { "name": "scratch", "type": "directory", "sizeBytes": null }
    ],
    "metadata": {
      "state": "ok",
      "error": null,
      "fields": {
        "schemaVersion": 1,
        "createdAt": "2026-09-19T03:16:09.412Z",
        "snapshotId": "20260919-031500",
        "snapshotIdTimezone": "UTC",
        "region": "ap-northeast-2",
        "profile": "snapshot-export",
        "searchFilter": "prod-eks",
        "regexFilter": null,
        "services": { "mode": "exclude", "list": ["SecretsManager", "SSM", "Lambda"] },
        "allowSensitiveServices": false,
        "includeDefaultResources": false,
        "cfnDeletionPolicy": "Retain",
        "former2": { "version": "0.2.83", "args": ["generate", "--output-cloudformation", "<snapshot>/cloudformation.yml", "…"] },
        "node": "v22.12.0",
        "account": { "masked": true, "ids": ["********9012"], "note": "템플릿 안의 ARN 에는 계정 ID 가 원문으로 남아 있습니다" },
        "resources": { "cloudformation": 42, "terraform": 44 },
        "rawData": { "saved": false, "location": null },
        "secretScan": { "errors": 2, "warnings": 1, "strict": false, "passed": false, "rules": ["env-block", "url-credentials", "user-data"] }
      }
    },
    "scan": {
      "current": {
        "summary": { "errors": 2, "warnings": 1, "strict": false, "passed": false, "rules": ["env-block", "url-credentials", "user-data"] },
        "scannedFiles": ["cloudformation.yml", "logical-id-mapping.json", "metadata.json", "terraform.tf"],
        "findings": [
          { "file": "cloudformation.yml", "fileKind": "cloudformation", "line": 88, "rule": "url-credentials", "severity": "error", "message": "URL 안에 사용자:비밀번호가 들어 있습니다 (연결 문자열)" },
          { "file": "terraform.tf", "fileKind": "terraform", "line": 212, "rule": "env-block", "severity": "error", "message": "환경 변수 블록입니다. 값에 비밀이 없는지 확인하고, 없으면 줄 끝에 \"# snapshot-scan: allow\"" },
          { "file": "terraform.tf", "fileKind": "terraform", "line": 530, "rule": "user-data", "severity": "warn", "message": "UserData(부트스트랩 스크립트)입니다. 비밀값이 섞여 있지 않은지 확인하세요" }
        ],
        "scannedAt": "2026-09-19T03:16:10.000Z"
      },
      "atExport": { "errors": 2, "warnings": 1, "strict": false, "passed": false, "rules": ["env-block", "url-credentials", "user-data"] }
    },
    "notes": {
      "label": null,
      "memo": null,
      "updatedAt": null,
      "version": "sha256:44136fa3…",
      "fileExists": false
    },
    "notices": [
      { "code": "RAW_DATA_ELSEWHERE", "text": "raw 데이터는 .raw/ 에 있으며 이 화면에서 다루지 않습니다" }
    ]
  }
}
```

| 필드 | 설명 |
|---|---|
| `cli` | (추가 2026-09-19) 6.2 `cli`와 같고 `scan`만 이 스냅샷 ID가 채워진 명령. 화면이 치환하지 않아도 된다 |
| `snapshot.exportInProgress` | (추가 2026-09-19) 5절 `ExportProgress`. 예: `{ "active": true, "metadataMissing": true, "lastChangeAt": "2026-09-19T04:55:00.000Z", "untilAt": "2026-09-19T05:25:00.000Z", "thresholdMinutes": 30 }` |
| `files` | 항상 4개(종류 순서 고정). 없으면 `exists: false`, 나머지 숫자·버전은 `null`, `editable.reasonCode = "FILE_MISSING"`(AC-15 "파일 없음") |
| `files[].eol` | `lf` \| `crlf` \| `mixed` \| `none`(줄바꿈 없음). `mixed`면 편집 불가(`MIXED_LINE_ENDINGS`) |
| `files[].encoding` | `utf-8` \| `unknown`(UTF-8로 해석 불가 → `NOT_UTF8`). 예시에서 생략한 파일도 모두 이 필드가 있다 |
| `files[].indent` | 편집기 Tab 동작용 추정값. 들여쓴 줄 중 앞 1000줄에서 가장 많은 방식: `{ "style": "spaces" \| "tabs", "size": 2 \| 4 \| 8 \| null }`, 들여쓴 줄이 없으면 `null` |
| `files[].editable` | 스냅샷 단위 사유(1.2 순서) → 종류(`FILE_KIND_READ_ONLY`) → 크기(`FILE_TOO_LARGE`, `sizeBytes > editMaxBytes`) → 인코딩·줄바꿈 순. AC-12, AC-32 |
| `files[].viewTruncated` | `sizeBytes > viewMaxBytes`면 `true`(6.4에서 앞부분만) |
| `extraFiles` | 알려진 5개 외의 항목(하위 폴더·링크 포함, 이름만, 최대 50개). `type`: `file` \| `directory` \| `symlink` \| `other` |
| `metadata.state` | `ok` \| `missing` \| `corrupt`(JSON 해석 실패) \| `schema_mismatch`(필수 필드 없음 또는 `schemaVersion ≠ 1`, `fields`는 읽힌 만큼) |
| `metadata.error` | `corrupt`일 때 `"JSON 해석 실패 (줄 3, 열 5)"`처럼 위치만. 파일 내용 조각 없음 |
| `metadata.fields` | 명세 3.2 B 표의 필드만 골라 준다. 표에 없는 필드까지 보려면 원문 보기 = `GET …/files/metadata`(6.4) |
| `scan.current.findings` | 전체(개수 제한 없음). 정렬(디자인 `status.md` 5.2): 등급(`error` → `warn`) → 파일(`cloudformation.yml`, `terraform.tf`, `logical-id-mapping.json`, `metadata.json`, `notes.json`, 그 밖은 경로 이름순) → 줄 → 규칙. 화면은 서버 순서 그대로. `fileKind`가 있으면 그 탭·줄로 이동(AC-11) |
| `scan.atExport` | `metadata.secretScan` 그대로(내보내기 당시). 메타 없음·손상이면 `null`. "내보내기 후 오류 3 → 0" 비교는 화면이 두 값을 나란히 보인다 |
| `notes.version` | 4절. 라벨·메모 저장 시 `baseVersion` |
| `notices` | 상태에 영향 없는 **정보** 문구(명세 3.2 B "정보"): `FILTER_NONE`, `DELETION_POLICY_NOT_RETAIN`, `RESOURCES_CHANGED_SINCE_EXPORT`, `RAW_DATA_ELSEWHERE` |

- metadata가 손상돼도 나머지(파일·스캔)는 그대로 준다(AC-14).
- 오류: 400 `VALIDATION_FAILED`(id 형식), 403 `SNAPSHOT_PATH_REJECTED`(링크·루트 밖), 404 `RESOURCE_NOT_FOUND`(`details.resource = { kind: "AwsSnapshot", id }`), 503 `SOURCE_UNAVAILABLE`(출처 없음·스캐너 없음).

### 6.4 `GET /api/aws-snapshots/:id/files/:kind`

템플릿 탭 보기·편집 시작, 메타데이터 원문 보기. `kind`: `cloudformation` | `terraform` | `mapping` | `metadata`.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "snapshotId": "20260919-031500",
  "kind": "terraform",
  "name": "terraform.tf",
  "content": "resource \"aws_vpc\" \"vpc\" {\n  cidr_block = \"10.0.0.0/16\"\n}\n…",
  "version": "sha256:9c1e…",
  "sizeBytes": 201877,
  "lineCount": 5002,
  "eol": "lf",
  "bom": false,
  "encoding": "utf-8",
  "indent": { "style": "spaces", "size": 2 },
  "modifiedAt": "2026-09-19T03:16:07.000Z",
  "truncated": false,
  "returnedBytes": 201877,
  "editable": { "allowed": true, "reasonCode": null, "reasonText": null },
  "findings": [
    { "file": "terraform.tf", "fileKind": "terraform", "line": 212, "rule": "env-block", "severity": "error", "message": "환경 변수 블록입니다. …" }
  ],
  "resourceCount": 44
}
```

| 필드 | 설명 |
|---|---|
| `content` | 파일 원문(**가리지 않음**, 명세 3.2 E). BOM 제거, 줄바꿈은 **LF로 통일해서** 준다(줄 번호는 원문과 같다). 원래 줄바꿈은 `eol`, BOM은 `bom`. 저장 시 서버가 되돌린다(7.2) |
| `version` | 4절. 편집 시작 시 보관했다가 저장 요청의 `baseVersion`으로 보낸다. 응답 헤더 `ETag`에도 같은 값 |
| `truncated` | `sizeBytes > viewMaxBytes`(기본 20 MB)면 `true`, `content`는 앞부분(마지막 완전한 줄까지) + `returnedBytes`. 이때 `editable.allowed`는 항상 `false` |
| `findings` | 이 파일의 현재 스캔 발견(6.3과 같은 값). 여백 표시용 |
| `resourceCount` | `cloudformation`/`terraform`만, 나머지는 `null` |

- 이 응답(과 7.1 요청 본문)만 템플릿 원문을 담는다. 목록·요약·SSE·오류 응답·로그에는 없다(명세 3.9).
- 오류: 400 `VALIDATION_FAILED`(id·kind), 403 `SNAPSHOT_PATH_REJECTED`, 404 `RESOURCE_NOT_FOUND`(`details.resource = { kind: "AwsSnapshotFile", id, fileKind }` = 파일 없음, 또는 `AwsSnapshot`), 503 `SOURCE_UNAVAILABLE`.

### 6.5 `GET /api/aws-snapshots/scan-rules`

스캔 결과 도움말 표(디자인 요청 ①). **CLI 스캐너에서 읽어** 주므로 README 5장·CLI와 한 출처다.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:02:10.123Z",
  "allowMarker": "snapshot-scan: allow",
  "scannableExtensions": [".yml", ".yaml", ".tf", ".hcl", ".json", ".template"],
  "rules": [
    { "id": "private-key", "severity": "error", "description": "개인 키(PEM)가 들어 있습니다" },
    { "id": "env-block", "severity": "error", "description": "환경 변수 블록입니다. 값에 비밀이 없는지 확인하고, 없으면 줄 끝에 \"# snapshot-scan: allow\"" },
    { "id": "secret-key-value", "severity": "error", "description": "비밀값으로 보이는 키(password, token, secret …로 끝나는 키)에 참조가 아닌 값이 들어 있습니다" },
    { "id": "user-data", "severity": "warn", "description": "UserData(부트스트랩 스크립트)입니다. 비밀값이 섞여 있지 않은지 확인하세요" }
  ]
}
```
- `rules`는 CLI 규칙 전체(예시는 일부). 순서는 CLI 정의 순서, `secret-key-value`는 마지막.
- 구현: `lib/scan.mjs`에 규칙 목록을 내보내는 `listRules()`(id·severity·description, 정규식 제외)를 추가하고 api가 그대로 준다(15절). 처리 방법 문구(값 삭제 → 동적 참조/변수, allow 주석, JSON은 주석 불가)는 화면 고정 문구.
- 오류: 503 `SOURCE_UNAVAILABLE`(스캐너 lib 없음).

### 6.6 `POST /api/aws-snapshots/refresh` (지금 다시 읽기)

요약 띠의 새로고침 버튼. 주기를 기다리지 않고 루트를 다시 확인하고, 바뀐 스냅샷만 다시 스캔한다(명세 4절 "수동 새로고침"). 파일을 쓰지 않지만 1.3 보호(Origin·`Content-Type`, 본문 `{}`)는 같다.

- 이미 확인 중이면 그것이 끝난 뒤 **한 번 더** 확인하고 그 결과를 준다(진행 중인 확인은 요청 전 상태를 읽고 있을 수 있으므로). 여러 번 연타해도 추가 확인은 1회만 붙는다.
- 응답 200: 6.1과 같은 모양(`{ dataSource, generatedAt, revision, summary }`). 바뀐 것이 있으면 `aws-snapshots.changed`도 보낸다.
- mock: 메모리 예시로 즉시 200.
- 오류: 403 `ORIGIN_NOT_ALLOWED`, 415. 출처가 없으면 200 + unknown(목록과 같음).

**라우트 등록 순서 (구현)**: 고정 경로 `summary`, `scan-rules`, `refresh`, `trash`, `trash/:trashId…`를 `:id`보다 먼저, 1.1 catch-all을 맨 끝에 둔다. 고정 이름은 ID 정규식(`^\d{8}-\d{6}$`)과 겹치지 않는다.

---

## 7. 템플릿 편집

편집 가능한 `kind`는 `cloudformation`, `terraform` **두 개뿐**이다. `mapping`·`metadata`로 요청하면 403 `SNAPSHOT_FILE_NOT_EDITABLE`(AC-32).

### 7.1 요청 본문 (7.2 `check`, 7.3 `PUT` 공통)

```json
{
  "content": "resource \"aws_db_instance\" \"main\" {\n  password = var.db_password\n}\n…",
  "baseVersion": "sha256:9c1e…",
  "confirm": ["secret_errors"]
}
```

| 필드 | 규칙 |
|---|---|
| `content` | 문자열, 필수. UTF-8 바이트 길이(원래 줄바꿈·BOM으로 되돌린 뒤) ≤ `editMaxBytes`(기본 5 MB). 넘으면 413 `SNAPSHOT_FILE_TOO_LARGE`. NUL 문자(`\u0000`) 포함 시 400 |
| `baseVersion` | 문자열, 필수(`check`에서는 선택). 형식 `^sha256:[0-9a-f]{64}$` |
| `confirm` | 배열, 선택. 값: `secret_errors` \| `yaml_syntax` \| `resource_decrease`. 7.2의 `confirmationsRequired`를 사용자가 확인 창에서 승인했다는 표시 |

- **본문 크기 상한**: 이 두 경로만 전역 1 MB 대신 `editMaxBytes × 2 + 64 KB`(기본 약 10 MB)로 JSON을 받는다(JSON 이스케이프로 늘어나는 몫). 본문 자체가 이 값을 넘으면 413 `PAYLOAD_TOO_LARGE`(공통). `common.md` 3.3 참고.
- `content`는 LF든 CRLF든 받는다. 서버가 먼저 LF로 통일한 뒤 검사한다.

### 7.2 `POST /api/aws-snapshots/:id/files/:kind/check` (저장 전 검사, 파일을 쓰지 않음)

"검사만" 용도. 저장 버튼은 7.3을 바로 불러도 된다(7.3이 같은 검사를 먼저 한다). 쓰기 가능 여부와 무관하게 동작하지만 1.3 보호(Origin·Content-Type)는 같다.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:12:40.000Z",
  "snapshotId": "20260919-031500",
  "kind": "terraform",
  "check": {
    "findings": [
      { "file": "terraform.tf", "fileKind": "terraform", "line": 530, "rule": "user-data", "severity": "warn", "message": "UserData(부트스트랩 스크립트)입니다. 비밀값이 섞여 있지 않은지 확인하세요" }
    ],
    "errors": 0,
    "warnings": 1,
    "syntax": { "checked": false, "errors": [] },
    "resources": { "before": 44, "after": 44 },
    "unchanged": false,
    "snapshotScanAfter": { "errors": 1, "warnings": 1, "strict": false, "passed": false, "rules": ["url-credentials", "user-data"] },
    "confirmationsRequired": []
  }
}
```

| 필드 | 설명 |
|---|---|
| `findings`, `errors`, `warnings` | 요청 `content`를 CLI `scanText`로 스캔한 결과(이 파일만) |
| `syntax` | `cloudformation`만 YAML 구문 검사: `{ "checked": true, "errors": [{ "line": 12, "column": 3, "code": "BAD_INDENT", "message": "YAML 구문 오류 (BAD_INDENT)" }] }`. 메시지는 서버가 만든 문구, 파서 원문(코드 조각)은 넣지 않는다. CloudFormation 태그(`!Ref`, `!Sub`, `!GetAtt` 등 모든 `!` 태그)는 오류로 보지 않는다. `terraform`은 `{ "checked": false, "errors": [] }`(범위 밖) |
| `resources.before` | 현재 디스크 파일의 리소스 수(파일 없으면 `null`) |
| `resources.after` | 요청 내용의 리소스 수 |
| `unchanged` | 줄바꿈·BOM을 되돌린 결과가 현재 파일 바이트와 같음 |
| `snapshotScanAfter` | 이 파일을 저장했다고 가정한 **스냅샷 전체** 현재 스캔 합계. "재스캔: 오류 a → b" 표시용 |
| `confirmationsRequired` | 저장하려면 `confirm`에 있어야 하는 값. `secret_errors`: `errors ≥ 1`(Q3, AC-23) / `yaml_syntax`: `syntax.errors`가 있음(AC-26) / `resource_decrease`: `after < before`(AC-27). **경고(warn)만 있으면 비어 있다**(AC-24) |

- 오류: 7.3의 400·403(`SNAPSHOT_FILE_NOT_EDITABLE`, `SNAPSHOT_PATH_REJECTED`, `ORIGIN_NOT_ALLOWED`)·404·413·415·503과 같음. 쓰기 불가 사유(403 `SNAPSHOT_WRITE_DISABLED` 등)와 409는 내지 않는다.

### 7.3 `PUT /api/aws-snapshots/:id/files/:kind` (저장)

**처리 순서 (서버)**
1. 형식 검사(1.1, 7.1) → 쓰기 가능 여부(1.2) → 파일 존재·종류·크기.
2. `baseVersion` ≠ 현재 버전 → 409 `SNAPSHOT_VERSION_CONFLICT`.
3. 7.2 검사. `confirmationsRequired` 중 `confirm`에 없는 것이 있으면 → 422 `SNAPSHOT_CONFIRMATION_REQUIRED`(파일 안 바뀜, AC-23 "취소하면 파일이 바뀌지 않는다").
4. `unchanged`면 쓰지 않고 200(`saved: false`).
5. 원래 줄바꿈(`crlf`면 LF → CRLF)·BOM으로 되돌려 바이트를 만든다. 원래 파일이 `eol: "none"`이면 요청 그대로(LF).
6. **원자적 쓰기**: 같은 폴더에 임시 파일 `.<파일 이름>.sentinel-tmp-<랜덤>` 작성 → `fsync` → 쓰기 직전 버전 재확인(다르면 임시 파일 삭제 + 409) → `rename`으로 교체. 실패하면 임시 파일을 지우고 원래 파일은 그대로(AC-29). 원래 파일의 권한 모드를 유지한다.
7. `notes.json`의 `templateEdits.<kind>` 갱신(3절, 실패해도 저장은 성공으로 응답하고 로그만).
8. 그 스냅샷을 다시 스캔·판단 → `revision` 증가 → SSE `aws-snapshots.changed`.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:12:41.000Z",
  "saved": true,
  "snapshotId": "20260919-031500",
  "kind": "terraform",
  "version": "sha256:1b7d…",
  "modifiedAt": "2026-09-19T05:12:41.000Z",
  "sizeBytes": 201850,
  "check": { "...": "7.2 check와 같음 (저장한 내용 기준)" },
  "rescan": {
    "before": { "errors": 2, "warnings": 1 },
    "after": { "errors": 1, "warnings": 1 }
  },
  "snapshot": { "...": "저장 후 SnapshotListItem (상태·스캔·리소스·modifiedByDashboard 갱신됨)" },
  "revision": 43
}
```

- `rescan`: 스냅샷 전체 현재 스캔의 저장 전 → 후("재스캔: 오류 2 → 1, 경고 1 → 1", 명세 3.7-4, AC-22).
- 오류가 남은 채 확인 저장하면 `snapshot.status.status`는 `critical`(커밋 금지)로 남는다(AC-23).
- `check.findings`의 `fileKind`는 저장 대상 종류, `file`은 파일 이름이다.
- `saved: false`(변경 없음)면 `version`은 기존 값, `rescan.before = after`.

**422 예시 (확인 필요)**
```json
{
  "statusCode": 422,
  "code": "SNAPSHOT_CONFIRMATION_REQUIRED",
  "message": "저장하려면 확인이 필요합니다: 비밀값 의심 1건, 리소스 44개 → 43개",
  "details": {
    "missing": ["secret_errors", "resource_decrease"],
    "check": { "...": "7.2 check와 같음" }
  },
  "path": "/api/aws-snapshots/20260919-031500/files/terraform",
  "timestamp": "2026-09-19T05:12:40.000Z"
}
```
화면은 `details.check`로 확인 창(발견 목록, "이 파일은 커밋하면 안 됩니다", YAML 줄 번호, "리소스 N개 → M개")을 보이고, 승인하면 `confirm: details.missing`을 넣어 같은 요청을 다시 보낸다.

**409 예시 (충돌)**
```json
{
  "statusCode": 409,
  "code": "SNAPSHOT_VERSION_CONFLICT",
  "message": "다른 곳에서 파일이 바뀌었습니다. 편집 내용을 복사한 뒤 다시 불러오세요.",
  "details": { "fileKind": "terraform", "currentVersion": "sha256:5e2a…", "currentModifiedAt": "2026-09-19T05:11:02.000Z" },
  "path": "/api/aws-snapshots/20260919-031500/files/terraform",
  "timestamp": "2026-09-19T05:12:40.000Z"
}
```
화면 선택지는 [내 편집 복사] [다시 불러오기]뿐(AC-30). 편집 중 스냅샷이 지워졌으면 404 `RESOURCE_NOT_FOUND`(`kind: "AwsSnapshot"`) → [내 편집 복사]만.

**오류 전체**

| HTTP | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | id·kind·본문 형식 (값은 `details`에 넣지 않음, 1.4) |
| 403 | `ORIGIN_NOT_ALLOWED` | 1.3 |
| 403 | `SNAPSHOT_FILE_NOT_EDITABLE` | `mapping`/`metadata`, 또는 `FILE_TOO_LARGE`/`NOT_UTF8`/`MIXED_LINE_ENDINGS`(`details.reasonCode`) |
| 403 | `SNAPSHOT_WRITE_DISABLED` | 쓰기 스위치 꺼짐 |
| 403 | `SNAPSHOT_READ_ONLY` | 루트 읽기 전용, 또는 쓰기가 `EROFS`로 실패(이후 재시작 전까지 `writable`도 `READ_ONLY`) |
| 403 | `SNAPSHOT_PATH_REJECTED` | 링크·정션·루트 밖·일반 파일 아님 |
| 404 | `RESOURCE_NOT_FOUND` | 스냅샷 또는 파일 없음 |
| 409 | `SNAPSHOT_VERSION_CONFLICT` | 4절 |
| 409 | `SNAPSHOT_EXPORT_IN_PROGRESS` | metadata 없음 + 30분 이내 (AC-17) |
| 413 | `SNAPSHOT_FILE_TOO_LARGE` | 저장할 내용 > `editMaxBytes`. `details: { maxBytes, sizeBytes }` |
| 413 | `PAYLOAD_TOO_LARGE` | 요청 본문 자체가 경로 상한 초과 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 1.3 |
| 422 | `SNAPSHOT_CONFIRMATION_REQUIRED` | 위 |
| 500 | `SNAPSHOT_WRITE_FAILED` | 디스크 가득(`ENOSPC`)·권한(`EACCES`/`EPERM`)·Windows 파일 잠김(`EBUSY`) 등 쓰기 실패. 원래 파일 그대로(AC-29). `details.errno`(예 `"ENOSPC"`)만. `EACCES`/`EPERM`은 Windows에서 편집기 잠금으로도 나므로 읽기 전용으로 굳히지 않는다 |
| 503 | `SOURCE_UNAVAILABLE` | 출처 없음·stale·스캐너 없음 |

---

## 8. 라벨·메모

### 8.1 `PUT /api/aws-snapshots/:id/notes`

**요청**
```json
{ "label": "EKS 1.30 업그레이드 전", "memo": "노드그룹 m6i.large 3대 시점, 복원 기준", "baseVersion": "sha256:44136fa3…" }
```

| 필드 | 규칙 (명세 3.5) |
|---|---|
| `label` | 문자열 필수, `""` 허용, **최대 60자**(JS 문자열 길이), 줄바꿈·제어 문자 금지 |
| `memo` | 문자열 필수, `""` 허용, **최대 2000자**, 줄바꿈·탭 허용(그 밖의 제어 문자 금지). CRLF는 LF로 저장 |
| `baseVersion` | 필수, 6.3 `notes.version` |

- 둘 다 **`snapshot-scan: allow` 문구를 담을 수 없다**(400). 메모는 `notes.json` 안에서 한 줄이 되므로 이 문구가 들어가면 CLI 스캔이 메모 줄 전체를 건너뛰게 된다.
- 비밀값 검사: `label`, `memo` 각각을 `scanText`로 검사해 **`error` 발견이 1건이라도 있으면 422 `SNAPSHOT_NOTES_SECRET_DETECTED`**, 저장 안 함(AC-35). `warn`은 저장한다.
- 쓰기: `notes.json` 전체를 3절 형식으로 만들어 7.3과 같은 원자적 쓰기. `updatedAt`은 서버 시각.

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:10:00.000Z",
  "notes": { "label": "EKS 1.30 업그레이드 전", "memo": "노드그룹 m6i.large 3대 시점, 복원 기준", "updatedAt": "2026-09-19T05:10:00.000Z", "version": "sha256:b2c0…", "fileExists": true },
  "snapshot": { "...": "SnapshotListItem" },
  "revision": 44
}
```

**422 예시**
```json
{
  "statusCode": 422,
  "code": "SNAPSHOT_NOTES_SECRET_DETECTED",
  "message": "라벨·메모에 비밀값으로 보이는 내용이 있어 저장하지 않았습니다 (url-credentials)",
  "details": { "fields": ["memo"], "rules": ["url-credentials"] },
  "path": "/api/aws-snapshots/20260912-020000/notes",
  "timestamp": "2026-09-19T05:10:00.000Z"
}
```
값 원문·줄 번호·CLI 메시지(가린 값 포함)도 넣지 않는다. 규칙 ID만.

**오류**: 400 `VALIDATION_FAILED`(길이 초과 AC-36, 제어 문자, allow 문구), 403 `ORIGIN_NOT_ALLOWED`/`SNAPSHOT_WRITE_DISABLED`/`SNAPSHOT_READ_ONLY`/`SNAPSHOT_PATH_REJECTED`/`SNAPSHOT_NOTES_CORRUPT`, 404, 409 `SNAPSHOT_VERSION_CONFLICT`/`SNAPSHOT_EXPORT_IN_PROGRESS`, 415, 422 `SNAPSHOT_NOTES_SECRET_DETECTED`, 500 `SNAPSHOT_WRITE_FAILED`, 503.

---

## 9. 삭제·휴지통 (Q2 결정)

### 9.0 휴지통 위치와 규칙
- 위치: **`<스냅샷 루트>/.trash/`**. 루트와 같은 마운트 안이라 이동이 `rename` 한 번(원자적)이다. `.trash`는 처음 삭제할 때 서버가 만든다(명세 3.9 "새 폴더 만들기 없음"의 휴지통 예외). 루트 자체는 만들지 않는다.
- 항목 이름(= `trashId`): `<snapshotId>__<삭제 시각 UTC, YYYYMMDDTHHmmssSSSZ>` (예 `20260915-101010__20260919T050210123Z`). 같은 ID를 여러 번 지워도 겹치지 않는다. 폴더 **안의 파일은 그대로**(추가 파일 없음) → 복원하면 삭제 전과 같다(AC-38).
- git·CLI 제외: `deploy/aws-snapshot/.gitignore`에 `snapshots/.trash/` 추가, CLI `lib/scan.mjs`의 폴더 순회가 `.trash` 폴더를 건너뛰게 수정(구현 단계, 15절).
- **자동 비우기 없음.** 대시보드는 영구 삭제 요청을 받았을 때만 지운다.
- `rawData.saved: true`인 스냅샷의 `.raw/<id>/`는 건드리지 않는다(스냅샷 루트 밖).

### 9.1 `DELETE /api/aws-snapshots/:id?confirm=<id>` (휴지통으로 이동)

- `confirm`은 `:id`와 같아야 한다(화면의 "ID 직접 입력", AC-37). 다르면 400 `SNAPSHOT_CONFIRM_MISMATCH`.
- 본문 없음. 버전 검사 없음(폴더 전체 단위).

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:20:00.000Z",
  "trashItem": { "...": "9.2 items[] 한 행" },
  "summary": { "...": "6.1 summary" },
  "revision": 45
}
```

**오류**: 400 `VALIDATION_FAILED`/`SNAPSHOT_CONFIRM_MISMATCH`, 403 `ORIGIN_NOT_ALLOWED`/`SNAPSHOT_WRITE_DISABLED`/`SNAPSHOT_READ_ONLY`/`SNAPSHOT_PATH_REJECTED`(폴더가 링크, AC-41), 404, 409 `SNAPSHOT_EXPORT_IN_PROGRESS`(AC-39), 500 `SNAPSHOT_WRITE_FAILED`(Windows에서 폴더 안 파일이 편집기에 열려 잠김 등), 503.

### 9.2 `GET /api/aws-snapshots/trash`

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T05:20:01.000Z",
  "total": 1, "filteredTotal": 1, "offset": 0, "limit": null,
  "items": [
    {
      "trashId": "20260915-101010__20260919T052000000Z",
      "snapshotId": "20260915-101010",
      "snapshotAt": "2026-09-15T10:10:10.000Z",
      "deletedAt": "2026-09-19T05:20:00.000Z",
      "label": "필터 실수",
      "region": "ap-northeast-2",
      "files": ["cloudformation.yml", "logical-id-mapping.json", "metadata.json", "notes.json", "terraform.tf"],
      "sizeBytes": 391220,
      "restore": { "allowed": true, "reasonCode": null, "reasonText": null }
    }
  ]
}
```

| 필드 | 설명 |
|---|---|
| 정렬 | `deletedAt` 최신순 |
| `files` | 최상위 이름만(최대 50) |
| `restore` | `WriteAbility`. 추가 사유 `SNAPSHOT_ID_EXISTS`("같은 ID의 스냅샷이 이미 있습니다") |

- 이름 형식이 안 맞는 `.trash` 안의 항목은 무시한다(목록에 없음, 요청은 400).
- 오류: 없음(출처 없으면 200 + 빈 목록).

### 9.3 `POST /api/aws-snapshots/trash/:trashId/restore`

- 본문 `{}` (1.3 Content-Type 요구).
- `<루트>/<snapshotId>`가 이미 있으면 409 `SNAPSHOT_ID_EXISTS`(AC-38). 확인 후 `rename`(대상이 그 사이 생기면 역시 409).

**응답 200**: `{ dataSource, generatedAt, snapshot: SnapshotListItem, revision }`

**오류**: 400, 403(1.3·쓰기 불가·링크), 404(`kind: "AwsSnapshotTrashItem"`), 409 `SNAPSHOT_ID_EXISTS`, 415, 500 `SNAPSHOT_WRITE_FAILED`, 503.

### 9.4 `DELETE /api/aws-snapshots/trash/:trashId?confirm=<snapshotId>` (영구 삭제)

- `confirm`은 항목의 `snapshotId`와 같아야 한다(명세 3.8 "휴지통 영구 삭제도 ID 입력 확인").
- 폴더를 재귀 삭제한다. 안의 심볼릭 링크는 링크만 지우고 대상은 따라가지 않는다(`fs.rm`). 삭제 전 `realpath`가 `.trash` 안인지 확인.

**응답 200**: `{ dataSource, generatedAt, purged: true, trashId, revision }`

**오류**: 400 `VALIDATION_FAILED`/`SNAPSHOT_CONFIRM_MISMATCH`, 403, 404, 500 `SNAPSHOT_WRITE_FAILED`, 503.

---

## 10. 상태 판단 이유 코드 (`Reason.code`, 명세 3.3)

### 10.1 스냅샷 (`SnapshotListItem.status`)

| code | status | text 예 | 조건 |
|---|---|---|---|
| `SCAN_SECRET_ERRORS` | critical | "비밀값 의심 2건 (env-block, url-credentials)" | 현재 스캔 error ≥ 1 |
| `METADATA_CORRUPT` | critical | "metadata.json 손상 (JSON 해석 실패)" | 파일은 있는데 JSON 아님 |
| `TEMPLATE_MISSING` | critical | "terraform.tf 없음" | `cloudformation.yml`/`terraform.tf` 없음 (둘 다면 한 사유에 둘 다) |
| `RAW_DATA_PRESENT` | critical | "raw 데이터 파일이 스냅샷 폴더에 있음 (비밀값 포함 가능, git 제외 경로로 옮기세요)" | 폴더 안(재귀) `raw-data.json` 또는 `*.raw.json` |
| `STRICT_SCAN_WARNINGS` | critical | "strict 스냅샷: 경고 1건" | `secretScan.strict: true` + 현재 경고 ≥ 1 |
| `SCAN_WARNINGS` | warning | "검토 필요 1건 (user-data)" | 경고 ≥ 1 (strict 아님) |
| `METADATA_MISSING` | warning | "metadata.json 없음" | 없음 + 마지막 변경 30분 이상 전 |
| `METADATA_SCHEMA_MISMATCH` | warning | "메타데이터 형식이 다름 (schemaVersion 2)" | 필수 필드(`snapshotId`, `region`, `resources`, `secretScan`) 없음 또는 `schemaVersion ≠ 1` |
| `SNAPSHOT_ID_MISMATCH` | warning | "폴더 이름과 메타데이터 ID 불일치" | |
| `MAPPING_MISSING` | warning | "logical-id-mapping.json 없음 (import 대응표)" | |
| `RESOURCES_ZERO` | warning | "Terraform 리소스 0개" | 있는 템플릿의 현재 수가 0 |
| `SENSITIVE_SERVICES_ALLOWED` | warning | "민감 서비스 포함 설정으로 내보냄" | `allowSensitiveServices: true` |
| `ACCOUNT_ID_UNMASKED` | warning | "메타데이터에 계정 ID 원문" | `account.masked: false` |
| `UNEXPECTED_FILES` | warning | "예상 밖 파일 2개 (notes.txt, .env)" / "… (링크 1개, 따라가지 않음)" | 알려진 5개 외 항목. 이름은 최대 3개 + "외 N개" |
| `NOTES_CORRUPT` | warning | "notes.json 손상 (라벨·메모를 읽을 수 없음)" | 3절 |
| `FILE_UNREADABLE` | unknown | "파일을 읽을 수 없음 (terraform.tf: EACCES)" | 폴더·파일 읽기 실패 |
| `EXPORT_MAYBE_IN_PROGRESS` | unknown | "내보내기 진행 중일 수 있음" | metadata 없음 + 마지막 변경 30분 이내. 편집·삭제 불가. **이때는 주의(warning) 사유를 빼고** 장애 사유와 이 사유만 남긴다(내보내기 도중이라 매핑 없음 등은 당연하므로) → 상태 unknown, 비밀값 등 장애가 있으면 critical |

- "마지막 변경" = 스냅샷 폴더와 그 안 모든 항목(재귀) `mtime`의 최댓값. mock은 11절.
- `reasons` 정렬: critical → warning → unknown, 같은 등급은 위 표 순서.
- `updatedAt` = 이 스냅샷을 마지막으로 스캔·판단한 시각, `statusChangedAt` = `status`가 바뀐 시각(서버 시작 후 처음이면 최초 판단 시각).

### 10.2 메뉴 요약 (`summary.status`)

| code | status | text 예 |
|---|---|---|
| `SNAPSHOTS_COMMIT_BLOCKED` | critical | "커밋 금지 스냅샷 2개" |
| `SNAPSHOTS_NEED_REVIEW` | warning | "주의 스냅샷 3개" |
| `SNAPSHOTS_UNKNOWN` | unknown | "상태를 알 수 없는 스냅샷 1개" |
| `SOURCE_NOT_CONFIGURED` | unknown | "스냅샷 폴더가 설정되지 않았습니다 (AWS_SNAPSHOT_DIR)" |
| `SOURCE_UNAVAILABLE` | unknown | "스냅샷 폴더를 찾을 수 없습니다: deploy/aws-snapshot/snapshots" / "스냅샷 폴더를 읽을 수 없습니다 (EACCES)" / "스캐너를 불러올 수 없습니다 (AWS_SNAPSHOT_LIB_DIR)" |
| `SOURCE_STALE` | (마지막 값 유지) | "스냅샷 폴더 확인 실패, 마지막 결과 유지 중" (`stale: true`와 함께) |

### 10.3 정보 문구 (`notices[].code`, 상태 영향 없음)
`FILTER_NONE`("필터 없음: 선택한 서비스의 리전 내 전체"), `DELETION_POLICY_NOT_RETAIN`("README는 Retain 권장"), `RESOURCES_CHANGED_SINCE_EXPORT`("내보내기 후 변경됨: CloudFormation 42 → 40"), `RAW_DATA_ELSEWHERE`.

---

## 11. SSE 이벤트 (토픽 `aws-snapshots`)

봉투·heartbeat·재연결은 `common.md` 5절. `GET /api/stream?topics=…,aws-snapshots`.

**이 토픽의 이벤트는 "무엇이 바뀌었는지"만 알린다. 목록 행·라벨·메모·템플릿·스캔 발견을 싣지 않는다.** 명세 3.9 "스트림 이벤트에 템플릿 내용, 라벨·메모 내용을 넣지 않는다"를 따른 것으로, `common.md` 5.4 "스냅샷은 REST 목록과 같은 항목 모양"의 예외다(14절). 화면은 이벤트를 받으면 REST로 다시 조회한다.

| 이벤트 | 언제 | payload |
|---|---|---|
| `aws-snapshots.snapshot` | 연결 직후, mock 시나리오 변경·reset 후, 출처 회복 후 | `{ "revision": 42, "summary": <6.1 summary> }` |
| `aws-snapshots.changed` | 스냅샷 추가·삭제·파일 변경 감지(주기 확인), 대시보드 쓰기 직후, 휴지통 변경, 출처 상태 변화. **1초 debounce** | 아래 |

```json
{
  "revision": 43,
  "changedIds": ["20260919-031500"],
  "removedIds": [],
  "trashChanged": false,
  "summary": { "...": "6.1 summary" }
}
```

| 필드 | 화면 동작 |
|---|---|
| `summary` | 사이드바 배지·숫자, 요약 띠를 **바로 교체** (다시 조회 불필요) |
| `changedIds` / `removedIds` | 목록 화면이면 `GET /api/aws-snapshots` 다시 조회(또는 행 단위로 `GET /:id`). 상세 화면의 ID가 `changedIds`에 있으면 상세 다시 조회(편집 중이면 4절 "파일이 바뀌었습니다" 알림만), `removedIds`에 있으면 "스냅샷이 없습니다" 표시 |
| `trashChanged` | 휴지통 화면이면 다시 조회 |

- `summary.status.reasons[].text`에는 개수만 있고 라벨·메모·파일 내용이 없다. 스냅샷 행 사유(10.1)에 들어가는 것은 규칙 ID·파일 이름·숫자뿐이다.
- 출처 상태 변화는 `stream.source`(id `snapshotStore`)로도 온다. stale이 되면 값은 유지하고 `summary.status.stale = true`(`common.md` 2.3).
- 반영 시간: 외부 변경은 주기 확인(10초) + debounce(1초)로 **30초 이내**(명세 4절, AC-48). 대시보드 쓰기는 응답 직후 이벤트(다른 탭도 즉시).
- 이 토픽은 `overview` 토픽·`/api/overview`에 들어가지 않는다. 앱 레이아웃의 스트림 1개가 `aws-snapshots`도 구독하면 사이드바가 모든 페이지에서 갱신된다.

---

## 12. mock 모드 (`DATA_SOURCE=mock`, 명세 3.12, AC-01~04)

- 예시 스냅샷은 **메모리**에 있다. 편집·라벨·삭제·휴지통이 메모리에서만 일어나고, 실제 `deploy/aws-snapshot/snapshots/`는 **읽지도 쓰지도 않는다**(AC-02). `AWS_SNAPSHOT_DIR`가 설정돼 있어도 무시한다.
- 스캔·리소스 수는 실제 CLI 규칙(2절 lib)으로 계산한다. lib를 못 불러오면 mock에서도 `SOURCE_UNAVAILABLE`.
- 출처 `snapshotStore` state `mock`, 모든 응답 `dataSource: "mock"`.
- 버전·충돌·확인 필요(422)·원자성 규칙은 live와 같게 흉내 낸다. 쓰기 요청의 1.3 보호도 같다.
- API 재시작 또는 `POST /api/mock/reset`이면 처음 예시로 돌아간다(AC-03).
- 예시의 "비밀값"은 누가 봐도 가짜인 값만(`AKIAIOSFODNN7EXAMPLE`, `example`이 들어간 비밀번호, `postgres://app:example-password@db.example.internal/app`). 실제 형식의 토큰(`ghp_…`, `xoxb-…`)은 만들지 않는다.

**기본 예시 (시나리오 `default`, 최신순)**

| ID | 재현 (명세 3.12 번호) | 상태 |
|---|---|---|
| `20260919-045500` | 7. metadata 없음, 마지막 변경 = **항상 서버 시각 − 5분** | unknown (`EXPORT_MAYBE_IN_PROGRESS`), 편집·삭제 불가 |
| `20260919-031500` | 3. env-block(terraform), url-credentials(cloudformation), user-data 경고 | critical |
| `20260918-120000` | 2. UserData 경고 1건 | warning |
| `20260917-090000` | 1. 발견 없음 | ok |
| `20260916-150000` | 4. `metadata.json` 손상 | critical |
| `20260915-101010` | 6. `logical-id-mapping.json` 없음 + 예상 밖 파일(`notes.txt`, `.env`) | warning |
| `20260914-080000` | 5. `terraform.tf` 없음 | critical |
| `20260912-020000` | 8. 라벨 "EKS 1.30 업그레이드 전"·메모, 내보내기 후 편집(CloudFormation 42 → 40), `modifiedByDashboard: true` | ok (정보 `RESOURCES_CHANGED_SINCE_EXPORT`) |
| `20260910-000000` | 9. `cloudformation.yml` 약 5.5 MB (편집 상한 초과, 보기 전용) | ok |

- 휴지통 예시 1개: `20260901-000000__20260910T010203000Z`(복원 가능).

**mock 시나리오 그룹 `snapshots`** (`common.md` 6.1 표에 추가. 라벨 "AWS 스냅샷", Popover 순서 마지막. 라디오 문구는 디자인 8절)

| id | 재현 내용 |
|---|---|
| `default` (기본) | 위 9개 + 휴지통 1개 ("예시 스냅샷 (기본)") |
| `empty` | 스냅샷 0개, 휴지통 0개 → 빈 상태 + CLI 안내 (요약 `ok`) |
| `not-configured` | 출처 `not_configured` → `SOURCE_NOT_CONFIGURED` (AC-45 재현) |
| `unavailable` | 출처 `unavailable` → "스냅샷 폴더를 찾을 수 없습니다" (AC-46 재현) |
| `read-only` | 기본 예시 + `writable = READ_ONLY` (AC-47) |
| `write-disabled` | 기본 예시 + `writable = WRITE_DISABLED` |
| `conflict-once` | 기본 예시. **다음 저장 요청(템플릿 또는 라벨) 한 번**을 409 `SNAPSHOT_VERSION_CONFLICT`로 응답한 뒤 그룹이 자동으로 `default`로 돌아간다(`aws-snapshots.snapshot` 재전송). 예시 내용은 바뀌지 않는다 |

- 그룹 키는 디자인 제안대로 `snapshots`(SSE 토픽·경로 prefix `aws-snapshots`와 다르다. 그룹 키는 화면 메뉴 식별자일 뿐이다).
- 시나리오를 바꾸면(`not-configured`·`unavailable` 포함) 메모리의 편집 내용은 유지하고 표시만 바뀐다. 원래 예시로 되돌리는 것은 `POST /api/mock/reset`.

---

## 13. 설정·환경 변수 (이 기능, `.env.example`)

| 이름 | 기본 | 설명 |
|---|---|---|
| `AWS_SNAPSHOT_DIR` | (없음) | 스냅샷 루트. **비우면 live에서 `not_configured`**. 상대 경로는 api 프로세스 작업 폴더 기준. Docker 없이: `../../deploy/aws-snapshot/snapshots`. docker compose: `/data/aws-snapshots`(15절 마운트). EKS(`deploy/app.example.yaml`): 넣지 않음 |
| `AWS_SNAPSHOT_LIB_DIR` | `../../deploy/aws-snapshot/lib` (작업 폴더 기준) | CLI 스캐너 lib 위치(2절). docker compose: `/opt/aws-snapshot/lib` |
| `AWS_SNAPSHOT_WRITE_ENABLED` | `true` | 쓰기 기능 전체 스위치(명세 3.9). `false`면 모든 쓰기 403 `SNAPSHOT_WRITE_DISABLED`. 환경 변수로만 바꾼다(API로 바꾸는 경로 없음, DBA 권고) |
| `AWS_SNAPSHOT_IN_PROGRESS_MIN` | `30` | "내보내기 진행 중일 수 있음" 기준(분) |
| `AWS_SNAPSHOT_EDIT_MAX_BYTES` | `5242880` (5 MB) | 편집 상한 |
| `AWS_SNAPSHOT_VIEW_MAX_BYTES` | `20971520` (20 MB) | 보기 상한(최소 20 MB, 명세 3.2 E). 이보다 작게 설정하면 20 MB로 올린다 |
| `AWS_SNAPSHOT_POLL_INTERVAL_SEC` | `10` | 변경 감지 주기(5~25) |
| `AWS_SNAPSHOT_DISPLAY_PATH` | (없음) | 화면에 보일 경로(컨테이너 경로 대신 `deploy/aws-snapshot/snapshots`) |
| `AWS_SNAPSHOT_HOST_DIR` | `./deploy/aws-snapshot/snapshots` | docker compose 전용: 마운트할 호스트 폴더 |

- 대시보드 자체 DB `settings`에는 넣지 않는다(DBA 보고서 5절).

---

## 14. 명세·공통 규약과 다르게 정한 점 (이 문서)

1. **SSE에 행 데이터를 싣지 않음** — `common.md` 5.4는 "토픽 스냅샷 = REST 목록과 같은 모양"이지만 명세 3.9가 스트림에 라벨·메모를 금지한다. → 이 토픽만 요약 + 바뀐 ID 알림, 행은 REST로 다시 조회(11절).
2. **stale 90초, 주기 10초** — `common.md` 2.3의 `staleAfterSec = intervalSec × 3` 규칙 대신 명세 4절 90초를 그대로 쓴다(`intervalSec: 10`, `staleAfterSec: 90`). 30초 반영 목표를 지키려면 주기가 짧아야 하고, 일시적 파일 잠금(Windows)으로 확인이 몇 번 실패해도 바로 stale로 보이지 않게 하려는 것.
3. **리소스 수 감소도 확인 필요** — 명세 3.7은 "확인 창에 함께 보인다"로 확인 창이 따로 뜨는지 모호하다. AC-27이 "저장 시 확인 창에 N → M"을 요구하므로 감소만 있어도 `resource_decrease` 확인을 요구한다.
4. **CRLF/LF가 섞인 파일, UTF-8이 아닌 파일은 편집 불가** — AC-28(편집한 줄 외 diff 없음)을 지킬 수 없기 때문. 보기는 된다. 한 가지 줄바꿈만 쓰는 파일(LF 또는 CRLF)과 BOM은 유지한다.
5. **스냅샷 폴더 안의 심볼릭 링크는 스캔하지 않음** — CLI(`scanPaths`)는 따라가서 스캔하므로 이 경우만 AC-08 결과가 다를 수 있다. 명세 3.9(링크 불추종)를 우선했고 주의 사유로 알린다(2절).
6. **AC-40의 "인코딩 안 된 `/`·`..`"** — 라우팅에서 세그먼트가 나뉘므로 `/api/aws-snapshots/` 아래 catch-all로 400을 준다(1.1). 이 경로 아래의 오타 경로도 404 대신 400이 된다.
7. **mock `conflict-once`** — 명세 "다음 저장 한 번을 충돌로"를 한 번 쓰고 자동으로 `default`로 돌아가는 시나리오로 구현.
8. **스캔 등급 값 `error`/`warn`** — `Status`(`critical`/`warning`)로 바꾸지 않고 CLI 값을 그대로 쓴다(CLI 출력·README 5장과 같은 말). 스냅샷 상태는 `status`로 따로 준다.
9. **템플릿 저장 시 `notes.json`도 갱신** — "대시보드에서 수정" 표시를 재시작 후에도 유지하려고 `templateEdits`를 기록한다. 라벨이 없는 스냅샷도 템플릿을 저장하면 `notes.json`이 생긴다(명세의 쓰기 허용 대상 안).
10. **mock 그룹 키 `snapshots`** — 디자인 제안(PM 전달)을 따른다. SSE 토픽·경로는 `aws-snapshots`로 둔다(토픽 `snapshots`는 이벤트 이름 `snapshots.snapshot`이 `*.snapshot` 규칙과 헷갈림).
11. **메뉴 상태는 `/api/overview`에 넣지 않음** — 명세 3.4(클러스터 전체 상태와 분리). 사이드바는 `aws-snapshots` 토픽과 `GET /api/aws-snapshots/summary`로 받는다. `overview.nav`에는 필드를 추가하지 않는다.
12. **라벨·메모에 `snapshot-scan: allow` 금지** — 명세에 없는 규칙. 메모가 `notes.json` 한 줄이 되어 CLI 스캔을 통째로 건너뛰게 하는 것을 막는다.
13. **라벨·메모의 422는 `error` 발견만** — 명세 3.5와 같음. `warn`(예: 메모에 "UserData:")은 저장한다.
14. **설정 없음은 `unknown` + `SOURCE_NOT_CONFIGURED`로 구분 (PM 결정 2026-09-19)** — 사이드바는 이 경우 상태 아이콘을 그리지 않고(프론트 처리), 페이지 안에서는 unknown + 설정 안내(`root.setup`)를 보인다. 6.1 참고.

`common.md`에 반영한 것(같은 날 수정): 1.2 CORS 허용 메서드 `DELETE` 추가, 3.3 413 경로별 상한·415·422 추가, 2.3 `SourceId` `snapshotStore`, 4절 health `checks.snapshotStore`, 5절 토픽 `aws-snapshots`, 6.1 mock 그룹 `snapshots`.

---

## 15. 구현 메모 (5단계 backend가 할 일, 이 계약의 전제)

- **docker-compose.yml (api 서비스)**
  - 포트를 `"127.0.0.1:3001:3001"`로 좁힌다(인증 없는 쓰기 API. 같은 네트워크의 다른 PC에서 닿지 않게). web 컨테이너는 내부 주소 `http://api:3001`을 쓰므로 영향 없음. db `5432`도 같은 방식 검토(이 기능 범위 밖, 보고만).
  - 볼륨 추가: `${AWS_SNAPSHOT_HOST_DIR:-./deploy/aws-snapshot/snapshots}:/data/aws-snapshots` (**쓰기 가능, `snapshots/` 폴더만**), `./deploy/aws-snapshot/lib:/opt/aws-snapshot/lib:ro`. `deploy/aws-snapshot` 전체를 마운트하지 않는다(`.env`, `.raw/` 비노출, AC-49).
  - 환경 변수: `AWS_SNAPSHOT_DIR: /data/aws-snapshots`, `AWS_SNAPSHOT_LIB_DIR: /opt/aws-snapshot/lib`, `AWS_SNAPSHOT_DISPLAY_PATH: deploy/aws-snapshot/snapshots`, 나머지 13절 값은 `${…:-}`로 전달.
  - 호스트 폴더가 없으면 Docker가 빈 폴더를 만들 수 있다 → README에 "먼저 한 번 export하거나 폴더를 만들 것" 안내(서버는 만들지 않는다).
- **`.env.example`**: 13절 변수 추가(주석: Docker 없이 실행 시 상대 경로 기준).
- **`main.ts`**: CORS `methods`에 `DELETE` 추가. `/api/aws-snapshots/:id/files/:kind`(PUT)와 `…/check`(POST)에만 큰 JSON 본문 파서(7.1)를 전역 1 MB 파서보다 먼저 등록.
- **스냅샷 모듈** `apps/api/src/aws-snapshots/**`: `PrismaService` 비의존. 1.3 가드(Origin·Content-Type), 1.1 catch-all, 출처 `snapshotStore` 등록(`source-registry`), health `checks.snapshotStore`, mock 그룹 등록, 스트림 토픽 `aws-snapshots`.
- **의존성**: YAML 구문 검사용 `yaml` 패키지(`apps/api`). 사용자 태그(`!Ref` 등)를 허용하는 설정, 오류는 `code`·`linePos`만 사용.
- **`deploy/aws-snapshot/lib/scan.mjs`**: `scanPaths` 폴더 순회에서 `.trash` 폴더 건너뛰기(CLI `npm run scan`이 휴지통을 스캔하지 않게), 규칙 목록 `listRules()` export 추가(6.5) + 테스트. 2절의 필수 export에 `listRules`는 넣지 않는다(없으면 6.5만 503).
- **`deploy/aws-snapshot/.gitignore`**: `snapshots/.trash/`, `snapshots/**/.*.sentinel-tmp-*` 추가.
- **`deploy/aws-snapshot/README.md`**: 1장 폴더 구성(`notes.json`, `.trash/`), 6장 체크리스트("파일 4개" → "4개 + 대시보드가 만든 `notes.json`"), 7.1 문구 보완(Q4: "대시보드·편집기로 하는 비밀값 정리·검토 주석은 원본에서, 복원용 손질은 복사본에서").
- **`deploy/app.example.yaml`**: 스냅샷 변수를 넣지 않는다(EKS → `not_configured`).
- 주기 확인은 `fs.watch`를 쓰지 않아도 된다(Windows 호스트 → Linux 컨테이너 바인드 마운트에서 알림이 안 옴). 루트 `readdir` + 스냅샷별 항목 `lstat`(mtime·size) 지문 비교 → 바뀐 스냅샷만 다시 읽고 스캔. 임시 파일(`.*.sentinel-tmp-*`)은 예상 밖 파일로 세지 않는다.

---

## 16. 수용 기준 ↔ 계약 매핑

| AC | 충족 위치 | 비고 |
|---|---|---|
| AC-01 | 12절 기본 예시 9개, `dataSource: "mock"` | MOCK 배지는 화면(`common.md` 2.4) |
| AC-02 | 12절 (실제 폴더 미접근) | 구현 테스트: mock에서 fs 호출 0회 |
| AC-03 | 12절, `common.md` 6.3 reset | |
| AC-04 | 12절 그룹 `snapshots` 시나리오 `empty`·`unavailable`·`not-configured`·`read-only`·`write-disabled`·`conflict-once` | |
| AC-05 | 6.2 `SnapshotListItem`, 기본 정렬 `snapshotAt:desc`, 1.5 | 로컬 시각·툴팁은 화면 |
| AC-06 | 6.2 `status`·`region`·`q` 쿼리 (또는 화면 필터) | |
| AC-07 | 6.3 (A~D), 6.4 (E), 내보내기·적용 엔드포인트 없음 | 버튼 없음은 화면 |
| AC-08 | 2절 (CLI lib 재사용, 파일 선택 규칙) | 예외: 폴더 안 심볼릭 링크(14절 5) |
| AC-09 | 2절 (`countCloudFormationResources`/`countTerraformResources`) | |
| AC-10 | 1.4, `ScanFinding.message`(CLI 가림), 11절 SSE에 행 없음 | |
| AC-11 | 6.3 `findings[].fileKind`·`line`, 6.4 `findings` | 이동·강조는 화면 |
| AC-12 | 6.3 `files[].editable` `FILE_TOO_LARGE`, 7.3 413 | |
| AC-13 | 10.1 `SCAN_SECRET_ERRORS` | |
| AC-14 | 10.1 `METADATA_CORRUPT`, 6.3 (나머지 계속 제공) | |
| AC-15 | 10.1 `TEMPLATE_MISSING`, 6.3 `files[].exists: false` | |
| AC-16 | 10.1 `SCAN_WARNINGS` / `STRICT_SCAN_WARNINGS` | |
| AC-17 | 10.1 `EXPORT_MAYBE_IN_PROGRESS` ↔ `METADATA_MISSING`(30분), 1.2, 7.3·9.1 409 | |
| AC-18 | 10.1 `MAPPING_MISSING`·`UNEXPECTED_FILES`·`SNAPSHOT_ID_MISMATCH`·`SENSITIVE_SERVICES_ALLOWED`·`ACCOUNT_ID_UNMASKED` | |
| AC-19 | 10.1 `RAW_DATA_PRESENT` | |
| AC-20 | 1.1 인식하지 못한 항목, 6.1 `unrecognized`, 400/403 | |
| AC-21 | 6.1 `summary.status`·`counts.critical`, 11절(overview 미포함) | |
| AC-22 | 7.3 응답 `rescan`·`snapshot`, 11절 `changed` | |
| AC-23 | 7.2 `confirmationsRequired: secret_errors`, 7.3 422 → `confirm` 재요청 | 저장 후 critical 유지 |
| AC-24 | 7.2 (warn만 → 확인 없음), 7.3 응답 `check.findings` | |
| AC-25 | 2절 (CLI `ALLOW_MARKER` 규칙 그대로) | |
| AC-26 | 7.2 `syntax`, `yaml_syntax` 확인 | |
| AC-27 | 7.2 `resources.before/after`, `resource_decrease` 확인 | 14절 3 |
| AC-28 | 6.4 `eol`·`bom`, 7.3 처리 5단계, `unchanged` | 섞인 줄바꿈은 편집 불가(14절 4) |
| AC-29 | 7.3 처리 6단계(원자적), 500 `SNAPSHOT_WRITE_FAILED` | |
| AC-30 | 4절, 7.3 409 `SNAPSHOT_VERSION_CONFLICT`(강제 덮어쓰기 없음) | 복사·다시 불러오기는 화면 |
| AC-31 | (화면) | API 없음 |
| AC-32 | 6.3 `FILE_KIND_READ_ONLY`, 7절 403 `SNAPSHOT_FILE_NOT_EDITABLE` | |
| AC-33 | (화면) | API 없음 |
| AC-34 | 3절 `notes.json`, 8.1 | `metadata.json` 불변 |
| AC-35 | 8.1 422 `SNAPSHOT_NOTES_SECRET_DETECTED` (규칙 ID만) | |
| AC-36 | 8.1 400 `VALIDATION_FAILED` | |
| AC-37 | 9.1 `confirm` 쿼리, 6.3 `files`·`extraFiles`, `metadata.fields.rawData` | 안내 문구는 화면 |
| AC-38 | 9절 (휴지통 이동·복원·`SNAPSHOT_ID_EXISTS`), 11절 `changed` | |
| AC-39 | 1.2 `actions.delete`, 9.1 409·403 | |
| AC-40 | 1.1 (형식 검사, catch-all 400) | 14절 6 |
| AC-41 | 1.1 경로 해석 (lstat·realpath), 403 `SNAPSHOT_PATH_REJECTED` | |
| AC-42 | 1.1 `:kind` 고정 표 | |
| AC-43 | 1.4 | |
| AC-44 | 머리말 경계, 2절 | 구현 테스트로 확인 |
| AC-45 | 6.2, 10.2 `SOURCE_NOT_CONFIGURED`, 13절 | |
| AC-46 | 6.2, 10.2 `SOURCE_UNAVAILABLE` (폴더 생성 안 함) | |
| AC-47 | 1.2 `READ_ONLY`, 6.1 `writable` | |
| AC-48 | 11절 (10초 주기 + 1초 debounce), 15절 쓰기 마운트 | |
| AC-49 | 15절 (`snapshots/`·`lib/`만 마운트) | |
| AC-50 | `common.md` 4절 `checks.snapshotStore` | |
| AC-51 | 6.2 `cli` 블록, 실행 엔드포인트 없음 | |

---

## 17. 에러 코드 요약 (이 기능)

| HTTP | code | 엔드포인트 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 전부 (id·trashId·kind·쿼리·본문, catch-all) |
| 400 | `SNAPSHOT_CONFIRM_MISMATCH` | `DELETE /:id`, `DELETE /trash/:trashId` |
| 403 | `ORIGIN_NOT_ALLOWED` | 쓰기 전부(1.3) |
| 403 | `SNAPSHOT_PATH_REJECTED` | 전부 (링크·루트 밖) |
| 403 | `SNAPSHOT_WRITE_DISABLED`, `SNAPSHOT_READ_ONLY` | 쓰기 전부 (check 제외) |
| 403 | `SNAPSHOT_FILE_NOT_EDITABLE` | `PUT`/`check` files |
| 403 | `SNAPSHOT_NOTES_CORRUPT` | `PUT /notes` |
| 404 | `RESOURCE_NOT_FOUND` (`AwsSnapshot` \| `AwsSnapshotFile` \| `AwsSnapshotTrashItem`) | 상세·파일·쓰기·휴지통 |
| 409 | `SNAPSHOT_VERSION_CONFLICT` | `PUT` files, `PUT /notes` |
| 409 | `SNAPSHOT_EXPORT_IN_PROGRESS` | `PUT` files, `PUT /notes`, `DELETE /:id` |
| 409 | `SNAPSHOT_ID_EXISTS` | `POST /trash/:trashId/restore` |
| 413 | `SNAPSHOT_FILE_TOO_LARGE` | `PUT`/`check` files |
| 413 | `PAYLOAD_TOO_LARGE` | 공통 (본문 상한) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 본문이 있는 쓰기 |
| 422 | `SNAPSHOT_CONFIRMATION_REQUIRED` | `PUT` files |
| 422 | `SNAPSHOT_NOTES_SECRET_DETECTED` | `PUT /notes` |
| 500 | `SNAPSHOT_WRITE_FAILED` | 쓰기 전부 |
| 503 | `SOURCE_UNAVAILABLE` | 상세·파일·쓰기 (출처 없음·stale·스캐너 없음) |

목록·요약·휴지통 목록은 출처가 없어도 200 + unknown이다(`common.md` 3.2).

## 18. 변경 이력
- 2026-09-19: 최초 작성 (backend, 4단계 계약. 구현 전)
- 2026-09-19 (5단계 구현 반영): 응답 모양 변경 없음. 동작 정정만.
  - 1.2 `WriteBlockCode`에 `FILE_UNREADABLE` 추가. `READ_ONLY`는 `EROFS`에서만 굳힌다.
  - 7.3 `EACCES`/`EPERM`은 403 `SNAPSHOT_READ_ONLY`가 아니라 500 `SNAPSHOT_WRITE_FAILED`(Windows 파일 잠김과 구분할 수 없어서).
  - 6.6 새로고침: 진행 중이면 끝난 뒤 한 번 더 확인 (mock 재설정 직후 이전 데이터를 읽는 문제 수정).
  - 10.1 내보내기 진행 중이면 주의 사유를 빼고 unknown (mock 예시 7번이 명세대로 "알 수 없음"으로 보이도록).
  - 1.4 검증 오류 값 제외 방식, 2절 jest 실행 조건 명시.
- 2026-09-19 (frontend 요청, 필드 추가만·하위 호환):
  - `SnapshotListItem.exportInProgress`(5절 `ExportProgress`): 목록·상세·저장/복원 응답의 `snapshot`에 모두 들어간다.
  - `GET /api/aws-snapshots/summary`에 최상위 `cli`.
  - `GET /api/aws-snapshots/:id`에 최상위 `cli`(`scan`에 ID가 채워짐).
