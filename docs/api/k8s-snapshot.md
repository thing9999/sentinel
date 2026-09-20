# API 계약: k8s-snapshot

- 작성: backend, 2026-09-19 (4단계 계약, 5단계 구현 반영 — 구현하며 바뀐 점은 20절 변경 이력 "5단계 구현")
- 명세: `docs/specs/k8s-snapshot.md` (확정본, AC-K01~K44, Q1~Q4 결정. 이하 **명세**)
- 재사용 원본: `docs/api/aws-snapshot-manager.md` (이하 **ASM-API**). "ASM-API n절과 같음"이라고 쓴 곳은 그 절의 규칙·응답 모양을 그대로 쓰고, 이 문서에는 **다른 점만** 적는다.
- 공통 규약: `docs/api/common.md` (이 기능으로 추가한 곳은 common.md 8절 변경 이력). 이 문서가 공통 규약을 덮어쓰는 곳은 16절에 모았다.
- 디자인: `docs/design/k8s-snapshot.md` (계약 작성 중 완료. 화면 주소 `/snapshots/k8s`, `/snapshots/k8s/[id]`, `/snapshots/k8s/trash`. 디자인 요청 — 드리프트 배지의 자동/요청/지난 결과·계산 중, 비교 불가 두 사유, 요약·명령용 경로, 행별 클러스터 관계, 메뉴·탭 값, mock 그룹, CLI 설정 이름 — 을 5절·6절·10.9·12절·14.4에 반영)
- DBA: `docs/reports/k8s-snapshot/dba.md` (스키마 변경 없음. 드리프트 결과는 메모리)

**이 기능의 경계**
- 기능은 세 부분이다: ① CLI `deploy/k8s-snapshot/`(사람용, 대시보드 밖) ② 대시보드 k8s 스냅샷 파일 관리(ASM과 같은 규칙) ③ 드리프트.
- 파일 관리(②)가 쓰는 곳은 **k8s 스냅샷 폴더 안의 파일뿐**이다: 리소스 YAML, `notes.json`, 휴지통 이동·복원·영구 삭제. 쿠버네티스 API·AWS API·모니터링 대상 DB를 호출하지 않고, `git`·`kubectl`·CLI 스크립트를 실행하지 않는다(AC-K27).
- 드리프트(③)는 **대시보드가 이미 들고 있는 informer 캐시**(기존 RBAC `deploy/rbac.yaml`, get/list/watch)만 읽는다. 드리프트 때문에 쿠버네티스 API를 새로 부르지 않고, 쓰기 동사·서버 측 dry-run을 쓰지 않는다(AC-K34). RBAC는 늘리지 않는다(Q3).
- Secret은 CLI도 대시보드도 읽지 않는다(Q1). ConfigMap은 CLI만 읽는다(대시보드 RBAC에 없음).
- 대시보드 자체 DB(Prisma)를 쓰지 않는다. 이 모듈은 `PrismaService`에 의존하지 않는다(DBA).
- 적용·내보내기·`kubectl` 실행 엔드포인트는 **없다**. 명령 예시 문자열만 준다(복사용).

---

## 0. 화면 ↔ 엔드포인트

경로 prefix는 `/api/k8s-snapshots`. 기존 `/api/aws-snapshots/**`, 토픽 `aws-snapshots`, mock 그룹 `snapshots`는 **바꾸지 않는다**(AC-K19).

| 화면 (명세 5절) | REST | SSE |
|---|---|---|
| 사이드바 "스냅샷" 메뉴 상태·숫자, 페이지 탭(AWS / Kubernetes) 배지 | `GET /api/snapshot-menu` (12절) | `snapshot-menu.snapshot`, `snapshot-menu.updated` |
| k8s 목록 요약 띠 | `GET /api/k8s-snapshots/summary` | `k8s-snapshots.snapshot`, `k8s-snapshots.changed` |
| k8s 목록 표·필터·빈 상태·CLI 안내 | `GET /api/k8s-snapshots` | `k8s-snapshots.changed` → 다시 조회, `k8s-snapshots.drift` → 드리프트 열 갱신 |
| 새로고침 | `POST /api/k8s-snapshots/refresh` | |
| 스캔 규칙 도움말 | `GET /api/k8s-snapshots/scan-rules` | |
| 드리프트 규칙 도움말(비교 가능 종류·기본값 표·관리 필드) | `GET /api/k8s-snapshots/drift-rules` | |
| 상세 A(요약)·B(메타)·C(리소스 구성)·D(스캔)·G(Secret 참조) | `GET /api/k8s-snapshots/:id` | `k8s-snapshots.changed`(`changedIds`) → 다시 조회 |
| 상세 E 파일 보기·편집 시작, 메타·secret-refs 원문 보기 | `GET /api/k8s-snapshots/:id/file?path=…` | |
| 저장 전 검사 | `POST /api/k8s-snapshots/:id/file/check?path=…` | |
| 파일 저장 | `PUT /api/k8s-snapshots/:id/file?path=…` | 저장 후 `k8s-snapshots.changed` (+ 필요 시 `k8s-snapshots.drift`) |
| 라벨·메모 | `PUT /api/k8s-snapshots/:id/notes` | `k8s-snapshots.changed` |
| 삭제(휴지통으로) | `DELETE /api/k8s-snapshots/:id?confirm=<id>` | `k8s-snapshots.changed` |
| 휴지통 목록·복원·영구 삭제 | `GET /api/k8s-snapshots/trash`, `POST …/trash/:trashId/restore`, `DELETE …/trash/:trashId?confirm=<snapshotId>` | `k8s-snapshots.changed`(`trashChanged`) |
| 상세 F 드리프트(결과 보기) | `GET /api/k8s-snapshots/:id/drift` | `k8s-snapshots.drift`(`snapshotId`) → 다시 조회 |
| 상세 F "드리프트 계산" 버튼 / 화면 열어 둔 동안 유지 | `POST /api/k8s-snapshots/:id/drift` (10.8) | `k8s-snapshots.drift` |
| MOCK 배지 Popover | `common.md` 6절 그룹 `k8s-snapshots` (14절) | `k8s-snapshots.snapshot`, `snapshot-menu.snapshot` 재전송 |

**출처 ↔ 데이터** (`common.md` 2.3)

| 출처 | 데이터 | 주기 | stale 기준 |
|---|---|---|---|
| `k8sSnapshotStore` (신규) | k8s 스냅샷 루트(`K8S_SNAPSHOT_DIR`)의 목록·파일 상태·현재 스캔 | 주기 확인 **10초** + 대시보드 쓰기 직후 즉시 | **90초** (ASM-API 14절 2와 같은 예외) |
| `kube` (기존) | 드리프트의 클러스터 쪽 값, 대시보드 클러스터 ID(`kube-system` UID) | watch(informer). 드리프트 재계산은 10.7 | 기존 규칙(heartbeat × 3 = 45초) |

- 드리프트 값의 stale은 `kube` 출처를 따르고, 파일 상태의 stale은 `k8sSnapshotStore`를 따른다(두 축, 명세 4.6).

---

## 1. 공통 규칙 (이 기능)

### 1.1 경로와 식별자 (경로 탐색 방지, 명세 5.4·ASM 3.9, AC-K24)

| 입력 | 허용 형식 | 그 밖 |
|---|---|---|
| `:id` | `^\d{8}-\d{6}$` 만 | 400 `VALIDATION_FAILED`(`field: "id"`). 파일 시스템 접근 전 거부 |
| `:trashId` | `^\d{8}-\d{6}__\d{8}T\d{9}Z$` | 400 |
| `path` 쿼리 (파일 지정) | 아래 **경로 규칙** 정규식에 전체 일치 | 400 `VALIDATION_FAILED`(`field: "path"`, 값은 넣지 않음) |
| `confirm` 쿼리 | 대상 ID와 정확히 같은 문자열 | 400 `SNAPSHOT_CONFIRM_MISMATCH` |

**경로 규칙** (스냅샷 폴더 기준 상대 경로, 구분자 `/`만. 3.1 폴더 구조와 같은 규칙이며 CLI `lib/layout.mjs`가 원본)

```
metadata.json
secret-refs.json
<ns>/namespace.yaml
<ns>/<kindDir>/<fileName>.yaml
_cluster/<kindDir>/<fileName>.yaml

<ns>       = ^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$                  (DNS-1123 label)
<kindDir>  = ^[a-z0-9]+(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$          (소문자 복수형, 사용자 지정 리소스는 plural.group)
<fileName> = 3.1 파일 이름 규칙의 결과 (문자 [a-z0-9.-] 와 ~XX 이스케이프만, 점으로 시작·끝나지 않음, ".." 없음, 1~250자)
```

- `notes.json`은 파일 엔드포인트로 다루지 않는다(`/notes` 전용, ASM과 같음). 경로 규칙에 없으므로 400.
- 쿼리 값은 Express가 디코딩한 **뒤** 검사한다. `%2e%2e`, `%2f`, `%5c`, `%00`, 절대경로(`/…`, `C:\…`), `\`, 빈 세그먼트, `.`/`..` 세그먼트는 모두 정규식에서 걸린다.
- **새 파일 만들기·이름 바꾸기·파일 하나 삭제 엔드포인트는 없다**(AC-K24). `PUT …/file`은 이미 있는 파일만 바꾼다(없으면 404).
- 경로 해석(모든 읽기·쓰기 공통)은 ASM-API 1.1과 같다: `root = realpath(K8S_SNAPSHOT_DIR)` → 대상의 **각 경로 구성 요소**를 `lstat`해 심볼릭 링크·정션이면 403 `SNAPSHOT_PATH_REJECTED`(따라가지 않음) → `realpath(대상)`이 `root + sep`로 시작하지 않으면 403 → 파일은 `isFile()`이어야 함.
  - ASM은 파일이 스냅샷 폴더 바로 아래라 폴더·파일 두 단계만 확인했지만, k8s는 `<ns>/<kindDir>/` 중간 폴더도 링크 검사 대상이다.
- `/api/k8s-snapshots/` 아래 어느 라우트에도 맞지 않는 경로는 컨트롤러 끝의 catch-all이 **400 `VALIDATION_FAILED`**(ASM-API 1.1과 같음). 고정 경로(`summary`, `scan-rules`, `drift-rules`, `refresh`, `trash`, `trash/:trashId…`)를 `:id`보다 먼저 등록한다.
- 인식하지 못한 루트 항목(이름 형식이 안 맞는 폴더·파일, 루트의 링크): ASM과 같이 목록에서 빼고 요약 `unrecognized`에 이름만. 루트 무시 항목: `.gitkeep`, `.trash`, CLI가 쓰는 중인 임시 폴더 `.<스냅샷 ID>.partial`(4.5. 목록·`unrecognized`에 넣지 않음).

### 1.2 쓰기 가능 여부 `WriteAbility`

ASM-API 1.2와 같은 모양·판단 순서. 사유 코드 차이만:

| code | k8s에서 |
|---|---|
| `WRITE_DISABLED` | `K8S_SNAPSHOT_WRITE_ENABLED=false` |
| `READ_ONLY`, `SOURCE_UNAVAILABLE`, `EXPORT_MAYBE_IN_PROGRESS`, `NOTES_CORRUPT`, `FILE_MISSING`, `FILE_UNREADABLE`, `FILE_TOO_LARGE`, `NOT_UTF8`, `MIXED_LINE_ENDINGS`, `SNAPSHOT_ID_EXISTS` | 같음 |
| `FILE_KIND_READ_ONLY` | `metadata.json`, `secret-refs.json` (AC-K22) |

드리프트 계산 가능 여부는 `WriteAbility`와 같은 모양의 `DriftAbility`로 따로 준다(5절 `actions.computeDrift`). 파일 쓰기와 관계없다.

### 1.3 쓰기 요청 보호
ASM-API 1.3과 **같다**. 이 기능의 `PUT`·`POST`·`DELETE` 전부(`POST …/refresh`, `POST …/drift` 포함): `Origin`이 `CORS_ORIGIN` 밖이면 403 `ORIGIN_NOT_ALLOWED`, 본문이 있는 요청은 `Content-Type: application/json` 필수(415). 본문 없는 POST도 `{}`를 보낸다.

### 1.4 로그·오류 메시지 (명세 5.0·4.7, AC-K38)
ASM-API 1.4와 같고 다음을 더한다.
- 서버 로그에는 **스냅샷 ID, 상대 경로, 결과 코드, 바이트 수, 개수**만. 파일 내용·라벨·메모·스캔에 걸린 값·YAML 파서 원문 메시지·**드리프트 필드 값(양쪽 모두)**·클러스터 객체 내용을 남기지 않는다.
- 드리프트 계산 실패 로그는 `스냅샷 ID + 오류 코드`만.
- 검증 실패 `details.fields[].value`를 이 기능에서는 넣지 않는다(`path`·`content`·`label`·`memo`).

### 1.5 시각
ASM-API 1.5와 같다. `snapshotAt`은 폴더 이름(UTC)에서, 파일 시각은 `lstat().mtime`.

---

## 2. 공유 원본: 스캐너 규칙과 CLI 라이브러리 (명세 3.6·3.7·8절 백엔드, AC-K14)

### 2.1 결정 요약
| 항목 | 결정 |
|---|---|
| 스캐너 규칙 | **`deploy/aws-snapshot/lib/scan.mjs` 한 파일**에 k8s 규칙을 더한다. 사본을 두지 않는다. k8s CLI는 상대 경로로 import하고, api는 기존처럼 `AWS_SNAPSHOT_LIB_DIR`에서 동적 import한다 |
| 규칙 적용 범위 | `scanText(text, file, { profile })`. `profile: 'aws'`(기본, **지금과 같은 결과**) / `'k8s'`(공통 규칙 + k8s 규칙). AWS 스냅샷의 스캔 결과가 바뀌지 않는다(기존 테스트 통과, AC-K14·K19) |
| 정리 규칙·기본값 표·관리 필드·목록 키·종류 목록·경로 규칙 | **`deploy/k8s-snapshot/lib/`의 순수 모듈**(3.5·3.6·10.4~10.6)에 둔다. CLI가 쓰고, api가 `K8S_SNAPSHOT_LIB_DIR`에서 동적 import한다. 드리프트가 CLI와 **같은 정리 규칙**으로 클러스터 객체를 정리하므로 정리 규칙 차이로 인한 가짜 차이가 없다 |
| 드리프트 비교 알고리즘 | api(TypeScript)에 둔다. CLI는 드리프트를 하지 않는다(명세 7절). 알고리즘이 쓰는 **표(데이터)**만 lib에서 온다 |
| 비교 가능 종류 목록 | api 한 곳(`COMPARABLE_KINDS`, 10.2). `deploy/rbac.yaml`과 일치하는지 단위 테스트로 확인 |

**왜 스캐너를 `deploy/aws-snapshot/lib`에 두나**: api·docker compose가 이미 그 폴더를 읽기 전용으로 불러 쓰고(`AWS_SNAPSHOT_LIB_DIR`, ASM-API 2절), 위치를 옮기면 기존 마운트·환경 변수·테스트가 바뀐다(AC-K19 위반 위험). 두 CLI와 대시보드가 **같은 파일**을 읽으면 "규칙 한 벌"이 지켜진다.

### 2.2 api가 import하는 lib 모듈의 제약
- api가 import하는 모듈(`deploy/aws-snapshot/lib/scan.mjs`·`meta.mjs`, `deploy/k8s-snapshot/lib/{kinds,layout,rules}.mjs`)은 **Node 내장 모듈 외에 아무것도 import하지 않는다**. 다른 lib 폴더도 import하지 않는다. docker compose가 lib 폴더만 따로 마운트하므로(`node_modules`·형제 폴더 없음) 외부 패키지나 상대 경로 import가 있으면 컨테이너에서 불러오지 못한다.
- 부작용 없음(파일·네트워크 접근 없음, 전역 상태 없음). `scanPaths`처럼 fs를 쓰는 함수는 CLI 전용이고 api는 부르지 않는다(ASM-API 2절과 같음).
- YAML 직렬화(`yaml` 패키지)·쿠버네티스 호출은 CLI 전용 모듈(`lib/yaml-out.mjs`, `lib/kube.mjs`)에만 둔다. api는 YAML 파싱에 자기 `yaml` 의존성을 쓴다.
- 불러오기 실패(파일 없음, 필수 export 없음): 출처 `k8sSnapshotStore`를 `unavailable`, `error.code = "SCANNER_UNAVAILABLE"`(scan.mjs) 또는 `"K8S_RULES_UNAVAILABLE"`(k8s lib). 목록 200 + unknown, 상세·쓰기 503 `SOURCE_UNAVAILABLE`. 드리프트는 알 수 없음(`DRIFT_RULES_UNAVAILABLE`).

| 모듈 | 필수 export (api 기준) |
|---|---|
| `deploy/aws-snapshot/lib/scan.mjs` | `scanText`(3번째 인자 `{ profile }` 지원), `summarize`, `ALLOW_MARKER`, `SCANNABLE_EXTENSIONS`, `maskValue`, `listRules`(`{ profile }` 지원) |
| `deploy/k8s-snapshot/lib/kinds.mjs` | `KIND_CATALOG`, `resolveKind(name)`, `kindDirOf(entry)` |
| `deploy/k8s-snapshot/lib/layout.mjs` | `PATH_RULES`(정규식 원문), `classifyPath(rel)`, `encodeFileName(name)`, `decodeFileName(file)`, `resourcePath(identity)` |
| `deploy/k8s-snapshot/lib/rules.mjs` | `CLEANUP_RULES_VERSION`, `RULESETS`(버전별), `cleanObject(obj, { rulesVersion })`, `findRuntimeFields(obj)`, `isAlwaysExcluded(obj, kindEntry)`, `isAutoCreated(obj, kindEntry)`, `isHelmManaged(obj)`, `DEFAULTS`, `MANAGED_FIELDS`, `LIST_KEYS`, `ORDER_SENSITIVE_LISTS`, `QUANTITY_PATHS`, `MASKED_PATHS` |

- api의 기존 `loadScanner`(ASM)는 바뀌지 않는다. k8s 모듈이 같은 scan.mjs를 별도로 한 번 더 불러온다(ESM 캐시로 같은 인스턴스).
- live에서 `K8S_SNAPSHOT_DIR`가 설정됐거나 mock일 때 처음 1회 불러온다. `AWS_SNAPSHOT_DIR`가 비어 있어도 `AWS_SNAPSHOT_LIB_DIR`(기본값 있음)로 스캐너를 불러온다.

### 2.3 k8s 스캔 규칙 (`profile: 'k8s'`에서만, 명세 3.7)

기존 규칙(`private-key`, `aws-access-key-id`, `aws-secret-access-key`, `presigned-url`, `jwt`, `url-credentials`, `vendor-token`, `env-block`, `user-data`, `kubeconfig-ca`, `secret-key-value`)은 k8s 프로필에서도 **그대로** 적용된다. 추가 규칙:

| 규칙 ID | 등급 | 잡는 것 | 보고 줄 / 문구(값은 `maskValue`) |
|---|---|---|---|
| `k8s-env-literal` | error | `env:` 아래 목록 항목에서 `name`이 비밀값 접미어(`SECRET_KEY_SUFFIXES`, 키 정규화 규칙 같음)로 끝나고 `value`에 리터럴이 있음. `valueFrom`만 있으면 통과. 값이 `SAFE_VALUE_RES`(자리표시자 `<…>`, 빈 값 등) 또는 쿠버네티스 변수 참조 `$(NAME)`만이면 통과. 블록 스칼라(`value: |`)는 리터럴로 본다 | `value` 줄. `환경 변수 "POSTGRES_PASSWORD" 에 리터럴 값이 들어 있습니다 (ex****(16자)). valueFrom.secretKeyRef 로 바꾸세요` |
| `k8s-secret-object` | error | 파일의 YAML 문서 최상위에 `kind: Secret`이 있고 최상위 `data:`/`stringData:` 아래 값이 있는 항목 | 각 값 줄. `Secret 값이 들어 있습니다 (키 "password", ab****(12자)). Secret 은 스냅샷에 넣지 않습니다` |
| `k8s-dockerconfig` | error | `.dockerconfigjson`/`.dockercfg` 키에 값, 또는 `auths` 안의 `auth` 값(YAML 블록, 한 줄 JSON 문자열 모두) | 해당 줄. `레지스트리 인증 정보(dockerconfig)가 들어 있습니다` |
| `k8s-configmap-secretish` | warn | 최상위 `kind: ConfigMap`의 최상위 `data:`/`binaryData:` **키 이름**이 비밀값 접미어로 끝남(값과 무관). **같은 줄에 `secret-key-value`가 이미 걸리면 이 규칙은 내지 않는다**(중복 방지) | 키 줄. `ConfigMap 키 "DB_PASSWORD" 가 비밀값 이름처럼 보입니다. Secret 으로 옮길지 검토하세요` |
| `k8s-last-applied` | warn | `kubectl.kubernetes.io/last-applied-configuration`이 **키 자리**(YAML 키 또는 JSON 키, 줄 앞)에 남아 있음. 값 안에 이름만 있는 경우(`metadata.json`의 `cleanup.summary` 문자열)는 걸리지 않는다 | 해당 줄. `last-applied-configuration 어노테이션이 남아 있습니다 (스펙 전체 사본, 비밀값이 섞일 수 있음)` |

- **줄 단위 + 들여쓰기 추적**으로 구현한다(YAML 파서를 쓰지 않음, 2.2 제약). 지원 형태: 블록 스타일 목록(`- name: X` 다음 줄 `value: y`, 순서 무관), 한 줄 흐름 매핑(`- {name: X, value: y}`), 한 줄 JSON 객체(`{"name": "X", "value": "y"}`). `env`의 부모 판단은 가장 가까운 덜 들여쓴 키 줄. 이 밖의 형태(여러 줄 흐름 매핑, 앵커·별칭으로 만든 env)는 못 잡을 수 있다 → README·화면의 "스캐너는 모든 비밀값을 잡는다는 보장이 없습니다" 안내로 대신한다.
- 검토 후 허용: 보고 줄 끝 `# snapshot-scan: allow`(기존과 같음). `k8s-env-literal`은 `value` 줄에 단다.
- CLI 출력 YAML은 블록 스타일만 쓰므로 CLI가 만든 파일은 위 형태에 모두 들어간다.
- `listRules({ profile: 'k8s' })`는 공통 규칙 + k8s 규칙(정의 순서, `secret-key-value`는 마지막)을 준다. `listRules()`(인자 없음)는 지금과 같다.
- 스캔 대상 파일 선택은 ASM-API 2절과 같다(스냅샷 폴더 재귀, `SCANNABLE_EXTENSIONS`, 이름순, `.trash` 건너뜀, 폴더 안 링크는 스캔하지 않음 + 주의 사유). `metadata.json`, `secret-refs.json`, `notes.json`도 스캔한다.
- `secret-refs.json`·`metadata.json`의 키 이름은 스캐너에 걸리지 않게 정한다(예: Secret 이름 필드는 `secretName`. `secret`, `token`으로 끝나는 키를 쓰지 않는다. 3.2·3.3).

### 2.4 CLI와 대시보드가 같은 결과를 내는 조건 (AC-K14)
- 같은 `scan.mjs`, 같은 `profile: 'k8s'`, 같은 파일 선택 규칙, `strict`는 `metadata.secretScan.strict`.
- 구현 테스트: api 테스트가 저장소 lib를 불러 k8s CLI 테스트 픽스처 스냅샷에 대해 `scanPaths(paths, { profile: 'k8s' })`와 서버 결과(파일·줄·규칙·등급)가 같은지 비교한다. aws-snapshot CLI 기존 테스트(`deploy/aws-snapshot/test/*.test.mjs`)가 그대로 통과해야 한다.

---

## 3. 스냅샷 폴더 구조와 파일 형식 (CLI ↔ 대시보드 계약, 명세 3.3~3.8)

### 3.1 폴더 구조와 파일 이름 규칙

```
deploy/k8s-snapshot/snapshots/<YYYYMMDD-HHmmss>/      (UTC, 스냅샷 ID ^\d{8}-\d{6}$)
├─ metadata.json          CLI가 마지막에 쓴다 (없으면 "내보내기 진행 중일 수 있음")
├─ secret-refs.json       Secret 참조 이름 목록 (값 없음, 3.3)
├─ notes.json             (있을 때만) 대시보드가 만든다 (3.4)
├─ _cluster/<kindDir>/<fileName>.yaml        클러스터 범위 선택 종류를 켰을 때만
└─ <namespace>/
   ├─ namespace.yaml
   └─ <kindDir>/<fileName>.yaml              리소스 1개 = 파일 1개
```

- **`<kindDir>`**: 종류 목록(3.5)의 `plural`(예 `deployments`, `configmaps`, `horizontalpodautoscalers`). 사용자 지정 리소스는 `<plural>.<group>`(예 `targetgroupbindings.elbv2.k8s.aws`). 코어·기본 종류도 그룹을 붙이지 않는다(짧고 `kubectl get` 이름과 같게).
- **`<fileName>`** (`layout.mjs encodeFileName`):
  1. 이름이 DNS-1123 subdomain(소문자·숫자·`-`·`.`, 253자 이하)이면 그대로.
  2. 아니면(RBAC 이름의 `:`·대문자 등) `[a-z0-9.-]` 밖의 바이트를 `~XX`(UTF-8 바이트, 대문자 16진)로 바꾼다. 예 `system:foo` → `system~3Afoo`, `Admin` → `~41dmin`. Windows 파일 시스템에서 금지 문자(`:`)와 대소문자 충돌을 피한다.
  3. 결과의 첫 점 앞 부분이 Windows 예약 이름(`con`, `prn`, `aux`, `nul`, `com0`~`com9`, `lpt0`~`lpt9`, 대소문자 무시)이면 첫 글자를 `~XX`로 바꾼다(예 `nul` → `~6Eul`).
  4. `.yaml`을 붙인다. `decodeFileName`은 역변환이며 `~` 뒤가 16진 2자리가 아니면 경로 규칙 위반.
- `namespace.yaml`: 그 네임스페이스의 Namespace 객체.
- 스냅샷 폴더 밖 관련 경로: `snapshots/.trash/`(대시보드 휴지통, git·CLI 스캔 제외), `snapshots/**/.*.sentinel-tmp-*`(원자적 저장 임시 파일, git 제외).
- 로컬 절대경로·사용자 이름을 어떤 파일에도 남기지 않는다(AC-K12).

### 3.2 `metadata.json` (`schemaVersion: 1`, 명세 3.8)

```json
{
  "schemaVersion": 1,
  "snapshotId": "20260919-061000",
  "snapshotIdTimezone": "UTC",
  "createdAt": "2026-09-19T06:10:42.311Z",
  "tool": { "name": "sentinel-k8s-snapshot", "version": "0.1.0", "node": "v22.12.0", "client": "@kubernetes/client-node 2.0.0" },
  "cluster": {
    "id": "7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e",
    "idSource": "kube-system-namespace-uid",
    "context": "sentinel-snapshot",
    "name": "prod-eks",
    "serverVersion": "v1.34.1-eks-8a2c1f0"
  },
  "scope": {
    "namespaces": {
      "mode": "all_except_system",
      "include": [],
      "exclude": [],
      "system": ["kube-system", "kube-public", "kube-node-lease", "amazon-cloudwatch"],
      "systemIncluded": []
    },
    "exported": ["batch", "data", "default", "monitoring", "prod"],
    "missing": [],
    "kinds": {
      "default": ["namespaces", "deployments", "statefulsets", "daemonsets", "services", "persistentvolumeclaims", "ingresses", "poddisruptionbudgets", "horizontalpodautoscalers", "configmaps", "serviceaccounts", "roles", "rolebindings", "networkpolicies", "cronjobs", "resourcequotas", "limitranges"],
      "optional": [],
      "custom": [],
      "excluded": []
    },
    "includeHelmManaged": true
  },
  "kinds": {
    "deployments": { "kind": "Deployment", "apiVersion": "apps/v1", "namespaced": true, "result": "ok", "exported": 6, "excludedByRule": 0, "forbiddenNamespaces": [] },
    "networkpolicies": { "kind": "NetworkPolicy", "apiVersion": "networking.k8s.io/v1", "namespaced": true, "result": "forbidden", "exported": 0, "excludedByRule": 0, "forbiddenNamespaces": ["batch", "data", "default", "monitoring", "prod"] }
  },
  "resources": {
    "total": 58,
    "byKind": { "deployments": 6, "configmaps": 8 },
    "byNamespace": { "prod": 31, "data": 12 },
    "helmManaged": 4,
    "excludedByRule": {
      "configmaps": { "total": 5, "owned": 0, "autoCreated": 5, "helmExcluded": 0, "autoCreatedNames": ["kube-root-ca.crt"] },
      "serviceaccounts": { "total": 5, "owned": 0, "autoCreated": 5, "helmExcluded": 0, "autoCreatedNames": ["default"] },
      "services": { "total": 1, "owned": 0, "autoCreated": 1, "helmExcluded": 0, "autoCreatedNames": ["default/kubernetes"] }
    }
  },
  "cleanup": { "rulesVersion": 1, "summary": ["status", "metadata.uid", "metadata.resourceVersion", "…"] },
  "secrets": { "mode": "refs_only", "read": false, "referenced": 3, "file": "secret-refs.json" },
  "secretScan": { "errors": 0, "warnings": 1, "strict": false, "passed": true, "rules": ["k8s-configmap-secretish"], "profile": "k8s" }
}
```

| 필드 | 규칙 |
|---|---|
| `cluster.id` | `kube-system` Namespace의 `metadata.uid`. 읽지 못하면 내보내기 실패(종료코드 3) — 드리프트 짝 맞추기에 필수(Q4) |
| `cluster.name` | kubeconfig의 클러스터 항목 이름. EKS ARN(`arn:aws:eks:<region>:<acct>:cluster/<name>`)이면 마지막 부분만(계정 ID를 남기지 않음). 모르면 `null` |
| `cluster.context` | 컨텍스트 이름 원문. kubeconfig 경로·서버 URL·토큰·인증서는 **없다**(AC-K12) |
| `scope.namespaces.mode` | `all_except_system` \| `include` \| `exclude`. `systemIncluded`는 포함 목록에 직접 적은 시스템 네임스페이스 |
| `scope.exported` | 실제로 내보낸 네임스페이스(정렬). `missing`은 포함 목록에 있었지만 클러스터에 없던 것 |
| `scope.kinds` | 종류 ID(= `<kindDir>`) 목록. `excluded`는 설정으로 뺀 기본 종류 |
| `kinds.<id>.result` | `ok` \| `forbidden` \| `not_found`(클러스터에 API 없음) \| `error`. 네임스페이스 일부만 거부되면 `forbidden` + `forbiddenNamespaces`에 그 목록(나머지는 내보냄) |
| `kinds.<id>.message` | `error`일 때만. 가림 처리된 한 줄(서버 URL·토큰 없음) |
| `resources.excludedByRule` | 3.7 제외 규칙으로 뺀 수, 종류별·이유별(`owned` 소유자 있음, `autoCreated` 자동 생성, `helmExcluded` Helm 제외 설정). `autoCreatedNames`는 자동 생성 규칙에 걸린 **이름 종류**(규칙 이름, 중복 없음, 최대 10개. 사용자 리소스 이름은 넣지 않는다) |
| `cleanup.rulesVersion` | `rules.mjs CLEANUP_RULES_VERSION` (3.6) |
| `secrets` | Q1 결정 기록. `referenced` = `secret-refs.json`의 Secret 수. 이름은 이 파일에 없다 |
| `secretScan` | aws-snapshot과 같은 모양 + `profile: "k8s"` |

- **대시보드가 보는 필수 필드**(없으면 `METADATA_SCHEMA_MISMATCH`, 11.1): `snapshotId`, `cluster`(객체), `scope`, `kinds`, `resources`, `cleanup.rulesVersion`, `secretScan`. `cluster.id`가 비었거나 문자열이 아니면 필수 필드 없음과 같다(→ 드리프트 `CLUSTER_ID_MISSING`).
- 키 순서는 위 예시 순서, 2칸 들여쓰기, LF, 끝 줄바꿈.

### 3.3 `secret-refs.json` (Q1 결정)

```json
{
  "schemaVersion": 1,
  "snapshotId": "20260919-061000",
  "note": "Secret 값은 담지 않습니다. 복원 전에 아래 Secret 을 별도 보관소에서 다시 만드세요.",
  "secrets": [
    {
      "namespace": "data",
      "secretName": "postgres-credentials",
      "keys": ["POSTGRES_PASSWORD"],
      "optional": false,
      "referencedBy": [
        { "kind": "StatefulSet", "name": "postgres", "via": "env.valueFrom.secretKeyRef", "container": "postgres" }
      ]
    },
    {
      "namespace": "prod",
      "secretName": "ecr-pull",
      "keys": [],
      "optional": false,
      "referencedBy": [ { "kind": "Deployment", "name": "api", "via": "imagePullSecrets", "container": null } ]
    }
  ]
}
```

- `via` 값: `env.valueFrom.secretKeyRef`, `envFrom.secretRef`, `volumes.secret`, `volumes.projected.secret`, `volumes.csi.nodePublishSecretRef`, `imagePullSecrets`, `serviceAccount.imagePullSecrets`, `ingress.tls`. `keys`는 참조에 적힌 키 이름만(값 없음). 정렬: 네임스페이스 → `secretName`.
- CLI가 **내보낸 매니페스트에서만** 모은다(Secret 객체를 읽지 않음). 참조되지 않는 Secret·키 목록·타입은 모른다(명세 Q1 단점).
- 대시보드는 보기 전용(상세 G, `GET …/file?path=secret-refs.json`). 없거나 손상이면 **정보 문구**(11.4 `SECRET_REFS_MISSING`/`SECRET_REFS_CORRUPT`)만, 상태 영향 없음.

### 3.4 `notes.json`
ASM-API 3절과 **같은 파일·형식**(`schemaVersion`, `tool`, `snapshotId`, `label`, `memo`, `updatedAt`, 알 수 없는 필드 보존, 손상 시 덮어쓰지 않음). 다른 점:
- 파일 저장 기록 키는 `templateEdits` 대신 **`fileEdits`**: `{ "<상대 경로>": { "savedAt": "…", "version": "sha256:…" } }`. k8s 파일은 수가 많고 경로로 식별하기 때문이다. 저장할 때 더는 없는 경로의 항목은 지운다.
- 현재 파일 버전 = `fileEdits[path].version`이면 그 파일은 "대시보드에서 수정"(`modifiedByDashboard`). 스냅샷 단위 `modifiedByDashboard`는 그런 파일이 하나라도 있으면 `true`.
- 알려진 파일: `metadata.json`, `notes.json`, `secret-refs.json`, 경로 규칙(1.1)에 맞는 YAML. 그 밖은 "예상 밖 파일".

### 3.5 종류 목록 (`lib/kinds.mjs KIND_CATALOG`, 명세 3.4)

| 종류 ID (`kindDir`) | kind | apiVersion (CLI가 읽는 버전) | 범위 | 기본 | 대시보드 드리프트 |
|---|---|---|---|---|---|
| `namespaces` | Namespace | v1 | 클러스터(파일은 `<ns>/namespace.yaml`) | 포함 | 비교 가능 |
| `deployments` | Deployment | apps/v1 | ns | 포함 | 비교 가능 |
| `statefulsets` | StatefulSet | apps/v1 | ns | 포함 | 비교 가능 |
| `daemonsets` | DaemonSet | apps/v1 | ns | 포함 | 비교 가능 |
| `services` | Service | v1 | ns | 포함 | 비교 가능 |
| `persistentvolumeclaims` | PersistentVolumeClaim | v1 | ns | 포함 | 비교 가능 |
| `ingresses` | Ingress | networking.k8s.io/v1 | ns | 포함 | 비교 가능 |
| `poddisruptionbudgets` | PodDisruptionBudget | policy/v1 | ns | 포함 | 비교 가능 |
| `horizontalpodautoscalers` | HorizontalPodAutoscaler | autoscaling/v2 | ns | 포함 | 비교 가능 |
| `configmaps` | ConfigMap | v1 | ns | 포함 | 비교 불가 |
| `serviceaccounts` | ServiceAccount | v1 | ns | 포함 | 비교 불가 |
| `roles`, `rolebindings` | Role, RoleBinding | rbac.authorization.k8s.io/v1 | ns | 포함 | 비교 불가 |
| `networkpolicies` | NetworkPolicy | networking.k8s.io/v1 | ns | 포함 | 비교 불가 |
| `cronjobs` | CronJob | batch/v1 | ns | 포함 | 비교 불가 |
| `resourcequotas`, `limitranges` | ResourceQuota, LimitRange | v1 | ns | 포함 | 비교 불가 |
| `jobs` | Job | batch/v1 | ns | 선택 | 비교 불가 |
| `clusterroles`, `clusterrolebindings` | ClusterRole, ClusterRoleBinding | rbac.authorization.k8s.io/v1 | 클러스터 | 선택 | 비교 불가 |
| `storageclasses` | StorageClass | storage.k8s.io/v1 | 클러스터 | 선택 | 비교 불가 |
| `ingressclasses` | IngressClass | networking.k8s.io/v1 | 클러스터 | 선택 | 비교 불가 |
| `priorityclasses` | PriorityClass | scheduling.k8s.io/v1 | 클러스터 | 선택 | 비교 불가 |
| `persistentvolumes` | PersistentVolume | v1 | 클러스터 | 선택 | 비교 불가 |
| `<plural>.<group>` | 사용자 지정(설정으로 이름 지정) | 클러스터의 선호 버전(discovery) | ns/클러스터 | 선택 | 비교 불가 |

- apiVersion은 **대시보드 informer가 읽는 버전과 같게** 고정했다(HPA `autoscaling/v2`, PDB `policy/v1`, Ingress `networking.k8s.io/v1`). 버전이 다르면 필드 모양이 달라 드리프트가 가짜 차이를 내기 때문이다(10.2 `API_VERSION_MISMATCH`).
- 설정의 종류 이름은 대소문자 무시, `plural`·단수형·`kind`를 받는다(`deployments`, `deployment`, `Deployment`). 모르는 이름은 종료코드 2. 사용자 지정 리소스는 `plural.group` 형식만(아니면 2), 클러스터에 없으면 `not_found`(종료코드 4).
- "대시보드 드리프트" 열은 **CLI 표시용 참고값**이다. 실제 판단은 api `COMPARABLE_KINDS`(10.2)가 한다.

### 3.6 정리 규칙 (`lib/rules.mjs`, `rulesVersion: 1`, 명세 3.6)

`cleanObject(obj, { rulesVersion })`는 입력을 바꾸지 않고 정리된 **새 객체**를 돌려준다. CLI(내보내기)와 api(드리프트, 파일 상태의 "런타임 필드 남음" 검사)가 같은 함수를 쓴다.

| 위치 | 제거 |
|---|---|
| 최상위 | `status` |
| `metadata` | `uid`, `resourceVersion`, `generation`, `creationTimestamp`, `managedFields`, `selfLink`, `deletionTimestamp`, `deletionGracePeriodSeconds`, `ownerReferences`, `finalizers` |
| `metadata.annotations` | `kubectl.kubernetes.io/last-applied-configuration`, `deployment.kubernetes.io/revision`, `pv.kubernetes.io/*`, `volume.beta.kubernetes.io/storage-provisioner`, `volume.kubernetes.io/storage-provisioner`, `volume.kubernetes.io/selected-node`, `autoscaling.alpha.kubernetes.io/*`, `control-plane.alpha.kubernetes.io/leader`. 비면 `annotations` 키 제거 |
| `metadata.labels` | Namespace의 `kubernetes.io/metadata.name`. 비면 키 제거 |
| 파드 템플릿 | `spec.template.metadata.creationTimestamp` |
| Service | `spec.clusterIP`, `spec.clusterIPs`(**값이 `None`이면 둘 다 유지**), `spec.healthCheckNodePort` |
| PVC | `spec.volumeName` |
| StatefulSet | `spec.volumeClaimTemplates[].status`, `spec.volumeClaimTemplates[].metadata.creationTimestamp` |
| Namespace | `spec.finalizers`(비면 `spec` 제거) |
| ServiceAccount | `secrets` |

- 남기는 것: 명세 3.6 "남기는 것" 그대로(사용자 레이블·어노테이션, `spec` 전체와 기본값 필드, `kubectl.kubernetes.io/restartedAt`, Service `nodePort`).
- **키 순서**: 최상위는 `apiVersion`, `kind`, `metadata`, 그다음 API 응답 순서. `metadata` 안은 `name`, `namespace`, `labels`, `annotations`, 그다음 응답 순서. 나머지는 응답 순서 그대로(같은 클러스터를 두 번 내보내면 같은 바이트, AC-K07).
- 목록 API 응답의 항목에는 `apiVersion`/`kind`가 없으므로 CLI가 3.5의 값으로 채운다.
- `findRuntimeFields(obj)`: 위 제거 대상 중 파일에 남아 있는 경로 목록(파일 상태 `RUNTIME_FIELDS_LEFT`, 11.1).
- 규칙을 바꾸면 `CLEANUP_RULES_VERSION`을 올리고 이전 버전 규칙을 `RULESETS`에 **남긴다**. 드리프트는 스냅샷의 `cleanup.rulesVersion` 규칙을 쓰고, 모르는 버전(lib보다 새것)이면 최신 규칙 + 정보 문구 `CLEANUP_RULES_NEWER`.

### 3.7 항상 제외·자동 생성·Helm (`rules.mjs`, 명세 3.4)
- `isAlwaysExcluded`: 종류가 Secret·Pod·ReplicaSet·ControllerRevision·Endpoints·EndpointSlice·Event·Lease·Node·메트릭이면(CLI는 애초에 목록을 부르지 않음), 또는 `metadata.ownerReferences`가 비어 있지 않으면 제외.
- `isAutoCreated`: ConfigMap `kube-root-ca.crt`, `default` 네임스페이스의 Service `kubernetes`, ServiceAccount `default` 중 (정리 후) 어노테이션·`imagePullSecrets`·`automountServiceAccountToken`이 없는 것, 이름이 `system:`·`eks:`로 시작하는 Role/RoleBinding/ClusterRole/ClusterRoleBinding, 레이블 `kubernetes.io/bootstrapping=rbac-defaults`, `system-` 접두어 PriorityClass. 최종 목록은 구현에서 EKS 1.30~1.34로 확인해 README에 적는다.
- `isHelmManaged`: 레이블 `app.kubernetes.io/managed-by: Helm`. `includeHelmManaged: false`면 제외하고 수만 기록. Helm 릴리스 Secret은 Secret이라 애초에 읽지 않는다.
- 드리프트의 "추가됨" 판정(10.3)이 같은 함수를 쓴다.

---

## 4. CLI `deploy/k8s-snapshot/` (구현은 5단계. 여기서는 구조·동작을 확정한다)

### 4.1 폴더 구성

```
deploy/k8s-snapshot/
├─ package.json          "type": "module", engines node >=22, scripts: export / export:dry / scan / test
│                        dependencies: @kubernetes/client-node (apps/api와 같은 메이저), yaml
├─ export.mjs            내보내기 (종료코드 4.5)
├─ scan.mjs              재스캔: import '../aws-snapshot/lib/scan.mjs' 의 scanPaths(…, { profile: 'k8s' })
├─ lib/
│  ├─ config.mjs         설정 해석 (플래그 > .env > 셸 환경변수, aws-snapshot과 같은 규칙)
│  ├─ kinds.mjs          종류 목록 (3.5)                              ← api import
│  ├─ layout.mjs         경로·파일 이름 규칙 (1.1, 3.1)                 ← api import
│  ├─ rules.mjs          정리·제외·기본값·관리 필드 표 (3.6, 3.7, 10.4~10.6) ← api import
│  ├─ kube.mjs           클러스터 읽기 (GET만, 4.4)
│  ├─ secret-refs.mjs    Secret 참조 수집 (3.3)
│  ├─ meta.mjs           metadata.json 만들기
│  └─ yaml-out.mjs       YAML 직렬화 (yaml 패키지)
├─ rbac/export-readonly.yaml   내보내기 전용 읽기 역할 예시 (사람이 적용, 4.3)
├─ test/*.test.mjs       node:test. 가짜 전송 계층, 실제 클러스터 호출 없음
├─ snapshots/.gitkeep
├─ .env.example, .gitignore (.env, node_modules, snapshots/.trash/, snapshots/**/.*.sentinel-tmp-*, snapshots/.*.partial/)
└─ README.md
```

- `scan.mjs`와 `export.mjs`의 스캔은 `../aws-snapshot/lib/scan.mjs`를 상대 경로로 import한다. 그래서 `npm install --prefix deploy/k8s-snapshot`만 해도 스캔이 된다(aws-snapshot `node_modules`는 필요 없음. scan.mjs는 내장 모듈만 씀).

### 4.2 설정 (`.env`, 명세 3.10)

| 환경 변수 | 플래그 | 기본 | 설명 |
|---|---|---|---|
| `KUBECONFIG` | `--kubeconfig` | 사용자 기본 kubeconfig | kubectl과 같은 규칙(여러 경로는 OS 구분자) |
| `KUBE_CONTEXT` | `--context` | **필수** | 비우면 종료코드 2. current-context를 쓰지 않는다(AC-K01). kubeconfig에 없는 이름이면 2 |
| `SNAPSHOT_NAMESPACES` | `--namespaces` | (없음) | 포함 목록(쉼표) |
| `SNAPSHOT_EXCLUDE_NAMESPACES` | `--exclude-namespaces` | (없음) | 제외 목록. 포함과 동시 지정이면 2 |
| `SNAPSHOT_SYSTEM_NAMESPACES` | `--system-namespaces` | `kube-system,kube-public,kube-node-lease,amazon-cloudwatch` | api `SYSTEM_NAMESPACES` 기본값과 같음 |
| `SNAPSHOT_OPTIONAL_KINDS` | `--optional-kinds` | (없음) | 3.5 선택 종류 |
| `SNAPSHOT_CUSTOM_RESOURCES` | `--custom-resources` | (없음) | `plural.group` 목록 |
| `SNAPSHOT_EXCLUDE_KINDS` | `--exclude-kinds` | (없음) | 기본 포함 중 뺄 것 |
| `SNAPSHOT_INCLUDE_HELM` | `--include-helm` / `--no-include-helm` | `true` | |
| `SNAPSHOT_STRICT` | `--strict` | `false` | 경고도 실패 |
| `SNAPSHOT_OUT_DIR` | `--out-dir` | `snapshots/` | |
| | `--config <파일>`, `--dry-run`, `--help` | | aws-snapshot과 같음 |

- `.env`가 셸 환경변수보다 우선하는 이유는 aws-snapshot과 같다(셸의 `KUBECONFIG`·컨텍스트가 다른 클러스터를 가리켜도 `.env`의 내보내기 전용 컨텍스트를 쓰게).

### 4.3 내보내기 전용 읽기 역할 (`rbac/export-readonly.yaml`, 사람이 적용)
- ClusterRole `sentinel-snapshot-export`: 3.5의 기본·선택 종류에 `get`, `list`만. `watch` 없음. **`secrets` 없음**(Q1), `pods/exec`·`pods/log`·쓰기 동사 없음. `namespaces`는 `get`, `list`(클러스터 ID·범위 판단). 사용자 지정 리소스는 주석 예시.
- ClusterRoleBinding 대상은 `Group: sentinel-snapshot-exporters`(예시). EKS는 access entry(`aws eks create-access-entry … --kubernetes-groups sentinel-snapshot-exporters`) 또는 `aws-auth`로 IAM 주체를 이 그룹에 연결하는 방법을 README에 적는다.
- 대시보드의 `sentinel-readonly` 역할·ServiceAccount 토큰을 쓰라고 안내하지 않는다(명세 3.2).

### 4.4 클러스터 읽기 방식 (`lib/kube.mjs`, AC-K13)
- **결정: `@kubernetes/client-node`의 `KubeConfig`로 인증만 받고, 요청은 모두 이 모듈의 `getJson(path, query)` 한 함수로 보낸다.** `kubectl`을 실행하지 않는다(설치 여부·버전에 따라 결과가 달라지지 않게, 테스트에서 호출을 가로챌 수 있게).
  - `kc.loadFromFile`/`loadFromDefault` → `kc.setCurrentContext(KUBE_CONTEXT)` → `kc.applyToFetchOptions`로 인증(EKS exec 플러그인 `aws eks get-token` 포함)을 붙여 `fetch`.
  - 응답은 **원본 JSON 그대로**(`ObjectSerializer`를 거치지 않음. 타입 변환·모르는 필드 제거를 피한다).
- `getJson`은 `method: 'GET'`만, 쿼리는 `limit`·`continue`만 허용한다. `dryRun`·`fieldManager`·`watch` 쿼리를 넣지 않는다. 테스트가 가짜 전송 계층으로 **모든 요청이 GET이고 허용된 경로(목록·단건 get·버전·discovery)인지** 확인한다.
- 호출 순서: `GET /version` → `GET /api/v1/namespaces/kube-system`(클러스터 ID) → 네임스페이스 목록(`all_except_system`/`exclude`: `GET /api/v1/namespaces`, `include`: 이름마다 `GET /api/v1/namespaces/<ns>`) → 종류 × 네임스페이스마다 `GET /apis/<group>/<version>/namespaces/<ns>/<plural>?limit=500`(continue 반복). 클러스터 범위 선택 종류는 `GET /apis/…/<plural>`. 사용자 지정 리소스는 discovery `GET /apis/<group>`으로 선호 버전을 찾는다.
- 네임스페이스마다 나눠 부르는 이유: 네임스페이스 단위 Role로만 권한을 받은 경우도 동작하고, 범위 밖 네임스페이스의 객체가 CLI 메모리에 들어오지 않는다.
- 상태 코드: 403 → 그 종류(와 네임스페이스) `forbidden`, 404(API 없음) → `not_found`, 그 밖 → `error`. 401·연결 실패·타임아웃(요청당 30초) → 접속 실패(종료코드 3).
- `--dry-run`: 설정 해석 결과(컨텍스트 이름, kubeconfig **파일 이름만**, 네임스페이스 규칙, 종류 목록, 부를 API 경로 템플릿 목록)를 출력하고 **kubeconfig 인증·클러스터 호출·파일 생성을 하지 않는다**(AC-K02). 컨텍스트가 kubeconfig에 있는지는 파일만 읽어 확인한다.

### 4.5 종료코드 (명세 3.11)

| 코드 | 뜻 | 스냅샷 폴더 |
|---|---|---|
| 0 | 성공, 스캔 통과 | 남음 |
| 1 | 비밀값 의심(스캔 실패) → 커밋 금지 | 남음 |
| 2 | 설정 오류: 컨텍스트 없음·kubeconfig에 없는 컨텍스트, 모르는 종류, 사용자 지정 리소스 형식 오류, 포함·제외 동시 지정, 잘못된 불리언 등 | 만들지 않음 (클러스터 호출도 없음) |
| 3 | 접속 실패(인증·네트워크·401), `kube-system` 또는 대상 네임스페이스를 읽을 권한 없음, 리소스 0개 | 지움 |
| 4 | **부분 성공**: 한 종류 이상 `forbidden`/`not_found`/`error`. 스캔 통과 | 남음 (`metadata.kinds`에 기록) |
| 99 | 예기치 않은 내부 오류 (aws-snapshot `export.mjs`와 같음) | 지움 |

- 1과 4가 겹치면 **1**. 스캔 경고만 있고 `--strict`면 1.
- 폴더는 임시 이름(`.<id>.partial`)에 쓰고 `metadata.json`을 마지막에 쓴 뒤 최종 이름으로 `rename`한다. 3·99는 임시 폴더를 지운다. (대시보드는 `.<id>.partial`을 무시한다(1.1). 진행 중 표시는 `metadata.json` 없음 규칙으로 판단하므로, 이름 변경 방식을 쓰면 진행 중인 스냅샷이 목록에 나타나지 않는다. 명세 5.1의 "내보내기 진행 중" 상태는 손으로 만든 폴더·중단된 옛 도구 결과에만 해당한다.)
- `scan.mjs`: 0 통과 / 1 발견 / 2 인자 오류(경로 없음). 경로 인자가 없으면 `snapshots/` 전체(`.trash` 제외).
- 출력·로그에 값 원문·kubeconfig 경로·서버 URL·토큰을 쓰지 않는다. 오류 메시지는 가림 처리(`https://…` URL은 호스트까지 지움).

### 4.6 README 목차 (AC-K15)
1. 폴더 구성 2. 설치 3. 내보내기 전용 읽기 역할·컨텍스트(`rbac/`, EKS access entry) 4. 사용법·설정·종료코드 5. 비밀값 스캔(k8s 규칙, `valueFrom.secretKeyRef`로 바꾸기, allow 주석, "모든 비밀값을 잡는다는 보장 없음") 6. 커밋 전 체크리스트 7. 복원 절차(`secret-refs.json`의 Secret 먼저 → `kubectl diff -f` → `kubectl apply -f`, 사람이. Helm 관리 리소스는 Helm으로) 8. Postgres·PV 데이터(명세 3.9 + DBA 보고서 8절 보강: `pg_dumpall --globals-only`, PowerShell `>` 금지, 볼륨 스냅샷 복원 순서, PITR 범위 밖) 9. git으로 관리 시작하기(U7) 10. 제외 규칙·자동 생성 목록 11. 문제 해결.

### 4.7 CLI 테스트 (`node:test`, 가짜 전송 계층)
설정 우선순위·필수 컨텍스트(AC-K01·K03), dry-run 무호출(AC-K02), 폴더 구조·파일 이름 인코딩(AC-K04), 정리 규칙(AC-K05, 헤드리스 유지), Secret·항상 제외·소유자 제외(AC-K06), 두 번 내보내기 바이트 동일(AC-K07), 시스템 제외 범위 기록(AC-K08), `k8s-env-literal`(AC-K09), 부분 성공 4(AC-K10), 접속 실패·0개 3(AC-K11), 메타데이터 비노출(AC-K12), **GET 외 요청 0회**(AC-K13), 스캔 결과 동일(AC-K14, api 테스트와 공유 픽스처).

---

## 5. 공통 타입

```ts
type Status = 'ok' | 'warning' | 'critical' | 'unknown';
type K8sFileType = 'resource' | 'namespace' | 'metadata' | 'secret_refs' | 'notes' | 'other';

interface ResourceIdentity {
  apiGroup: string;          // 코어는 "" (화면 표시는 "core")
  apiVersion: string;        // 파일에 적힌 값 (예 "apps/v1")
  kind: string;              // 원문 (Deployment)
  namespace: string | null;  // 클러스터 범위면 null
  name: string;
}

interface K8sScanFinding {
  file: string;              // 스냅샷 폴더 기준 상대 경로 ("data/statefulsets/postgres.yaml")
  fileType: K8sFileType;
  line: number;
  rule: string;              // CLI 규칙 ID (k8s-env-literal, secret-key-value …)
  severity: 'error' | 'warn';
  message: string;           // CLI 문구 그대로 (값은 이미 가려짐)
}

interface ScanSummary { errors: number; warnings: number; strict: boolean; passed: boolean; rules: string[] }  // ASM-API 5절과 같음

interface K8sResourceCounts {
  current: { total: number; files: number };      // 현재 파일 기준. files = 리소스 파일 수(namespace.yaml·해석 실패 포함), total = 리소스 수(여러 문서 파일은 문서 수만큼, 그 밖 파일당 1)
  atExport: { total: number } | null;             // metadata.resources.total
  changedSinceExport: boolean;
  previous: { snapshotId: string; total: number } | null;   // 같은 cluster.id의 바로 이전 스냅샷 (현재 기준)
  delta: number | null;
}

interface DriftAbility { allowed: boolean; reasonCode: string | null; reasonText: string | null }  // 사유 코드는 11.3

interface K8sSnapshotActions {
  editFiles: WriteAbility;     // 스냅샷 단위 사유만. 파일 단위는 files[].editable
  editNotes: WriteAbility;
  delete: WriteAbility;
  computeDrift: DriftAbility;  // "드리프트 계산" 버튼
}

// 목록·상세의 드리프트 배지 (값 없음. SSE에도 같은 모양)
interface DriftBadge {
  status: StatusInfo;          // status: ok | warning | unknown (critical 없음). reasons는 11.3
  mode: 'auto' | 'on_demand' | 'last_result' | 'none';
    // auto        = 자동 계산 대상(같은 클러스터 최신). status가 현재 결과
    // on_demand   = 요청 계산 결과, 임대 중(10.8)이라 계속 갱신됨. status가 현재 결과
    // last_result = 지금은 계산하지 않음. 마지막 결과의 요약만 남음 → status는 unknown DRIFT_NOT_COMPUTED,
    //               마지막 결과는 lastResultStatus·counts·computedAt ("지난 결과 차이 3건 · 9월 18일")
    // none        = 결과 없음 (계산 안 함 또는 계산 불가. 사유는 status.reasons)
  computing: boolean;          // 지금 다시 계산 중 ("갱신 중", 자동·요청 모두). 값은 이전 결과 그대로. 구현: 계산이 메모리 동기 계산(수십 ms)이라 응답·이벤트에서는 항상 false (500ms 규칙, 10.9)
  computed: boolean;           // 결과(건수)가 있음 (mode auto/on_demand/last_result에서 결과가 있으면 true)
  computedAt: string | null;   // 마지막 계산 시각
  lastResultStatus: 'ok' | 'warning' | null;   // 마지막 결과의 상태 (mode last_result에서 "지난 결과 차이 없음/차이 N건"용. 그 밖에는 status와 같거나 null)
  counts: DriftCounts | null;  // computed=false면 null
  resultAvailable: boolean;    // 필드 diff까지 담긴 전체 결과를 지금 GET /drift로 받을 수 있음 ("지난 결과 보기" 버튼 조건, 10.9)
}

interface DriftCounts {
  compared: number;            // 비교한 리소스 수 (스냅샷 쪽 비교 가능 리소스 + 추가됨)
  same: number;
  added: number;
  deleted: number;
  changed: number;
  hidden: { default: number; managed: number };   // 숨긴 필드 차이 수 (상태·건수에 넣지 않음)
  uncomparable: number;        // 비교 불가 리소스 수 합
  unparsable: number;          // 해석 실패·중복 정의로 빠진 스냅샷 쪽 리소스 수
}

// 목록 한 행
interface K8sSnapshotListItem {
  id: string;
  snapshotAt: string | null;
  status: StatusInfo;          // 파일 상태 (11.1). 드리프트는 섞지 않는다
  drift: DriftBadge;
  label: string | null;
  memo: string | null;         // REST에만 (SSE 없음)
  notesUpdatedAt: string | null;
  cluster: {
    id: string | null;
    context: string | null;
    name: string | null;
    serverVersion: string | null;
    relation: 'same' | 'other' | 'unknown';   // 대시보드 클러스터와 같은지 (unknown: 스냅샷 id 없음 또는 대시보드 클러스터 ID를 모름)
  } | null;                    // metadata 없음·손상이면 null
  scope: {
    namespaceMode: 'all_except_system' | 'include' | 'exclude';
    namespaces: string[];      // scope.exported
    missingNamespaces: string[];
    systemIncluded: string[];
    excludeNamespaces: string[]; // exclude 모드의 제외 목록 (metadata scope.namespaces.exclude). 그 밖 모드는 [] (2026-09-19 추가)
    kindCount: number;
    optionalKinds: string[];
    customResources: string[];
    includeHelmManaged: boolean;
  } | null;
  resources: K8sResourceCounts;
  helmManaged: number | null;  // 현재 파일 기준
  partialKinds: { id: string; result: 'forbidden' | 'not_found' | 'error' }[];   // metadata.kinds 중 ok 아닌 것
  scan: ScanSummary;
  lastModifiedAt: string | null;
  modifiedByDashboard: boolean;
  cliVersion: string | null;   // metadata.tool.version
  actions: K8sSnapshotActions;
  exportInProgress: ExportProgress;   // ASM-API 5절과 같음
}
```

- `WriteAbility`, `ExportProgress`, `StatusInfo`는 ASM-API 5절·`common.md` 2.2와 같다.

---

## 6. 조회

### 6.1 `GET /api/k8s-snapshots/summary`

ASM-API 6.1과 같은 모양에 k8s 필드를 더한다.

```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T06:12:00.000Z",
  "revision": 17,
  "summary": {
    "status": { "status": "critical", "reasons": [ { "code": "SNAPSHOTS_COMMIT_BLOCKED", "text": "커밋 금지 스냅샷 1개", "status": "critical" } ], "updatedAt": "…", "statusChangedAt": "…", "stale": false },
    "counts": { "total": 10, "critical": 3, "warning": 3, "unknown": 1, "ok": 3 },
    "unrecognized": { "count": 0, "names": [] },
    "trashCount": 1,
    "root": { "configured": true, "displayPath": "deploy/k8s-snapshot/snapshots", "state": "ok", "setup": null },
    "writable": { "allowed": true, "reasonCode": null, "reasonText": null },
    "lastCheckedAt": "2026-09-19T06:11:58.000Z",
    "limits": { "editMaxBytes": 5242880, "viewMaxBytes": 20971520, "inProgressMinutes": 30, "labelMaxLength": 60, "memoMaxLength": 2000 },
    "dashboardCluster": { "state": "ok", "id": "7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e", "name": "prod-eks", "context": "prod-eks", "serverVersion": "v1.34.1" },
    "latestDrift": { "snapshotId": "20260919-061000", "drift": { "...": "DriftBadge" } }
  },
  "cli": { "...": "6.2 cli" }
}
```

| 필드 | 설명 |
|---|---|
| `summary.status`·`counts` | **파일 상태만**(ASM 3.4 규칙을 k8s 스냅샷에 적용). 드리프트는 넣지 않는다(Q2) |
| `root.setup` | `not_configured`/`unavailable`일 때: `{ "envVar": "K8S_SNAPSHOT_DIR", "dockerMount": "./deploy/k8s-snapshot/snapshots:/data/k8s-snapshots", "localExample": "K8S_SNAPSHOT_DIR=../../deploy/k8s-snapshot/snapshots", "reasonText": "…" }` |
| `dashboardCluster` | 대시보드가 연결된 클러스터(요약 띠 "연결된 클러스터"). `state`는 `kube` 출처 상태. `id`는 informer 캐시의 `kube-system` UID(없으면 `null`). `context`는 kubeconfig 현재 컨텍스트 이름(EKS ARN이면 클러스터 이름만) |
| `latestDrift` | 자동 계산 대상 스냅샷의 드리프트 배지(탭 "드리프트 N건"). 대상이 없으면 `null` |

- 설정 없음 구분(ASM-API 6.1 PM 결정)과 같다: live에서 `K8S_SNAPSHOT_DIR`가 비면 `unknown` + `SOURCE_NOT_CONFIGURED`, `root.state = "not_configured"`.
- `/api/overview`에 들어가지 않는다(명세 5.5).
- 오류 없음(항상 200).

### 6.2 `GET /api/k8s-snapshots`

**쿼리**

| 이름 | 형식 | 설명 |
|---|---|---|
| `status` | 쉼표 `ok,warning,critical,unknown` | 파일 상태 |
| `drift` | 쉼표 `ok,warning,unknown,not_computed` | 드리프트 배지. `not_computed` = 사유 `DRIFT_NOT_COMPUTED`(mode `none`·`last_result`). `unknown`은 그 밖의 알 수 없음 |
| `cluster` | 쉼표 `same,other,unknown` | 행의 `cluster.relation` (디자인: 연결된 클러스터 / 다른 클러스터 / 확인할 수 없음). 클러스터 이름별 필터는 두지 않는다 |
| `q` | 1~200자 | 라벨·메모·ID·컨텍스트 이름 부분 일치 |
| `sort` | `snapshotAt:desc`(기본) \| `snapshotAt:asc` \| `status:desc` \| `status:asc` | ASM과 같음 |
| `limit`, `offset` | `common.md` 1.3 | |

**응답 200**
```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T06:12:00.000Z",
  "revision": 17,
  "summary": { "...": "6.1 summary" },
  "total": 10, "filteredTotal": 10, "offset": 0, "limit": null,
  "facets": {
    "cluster": { "same": 7, "other": 1, "unknown": 2 },
    "drift": { "ok": 0, "warning": 1, "unknown": 3, "not_computed": 6 },
    "status": { "ok": 3, "warning": 3, "critical": 3, "unknown": 1 }
  },
  "items": [
    {
      "id": "20260919-061000",
      "snapshotAt": "2026-09-19T06:10:00.000Z",
      "status": { "status": "ok", "reasons": [], "updatedAt": "…", "statusChangedAt": "…", "stale": false },
      "drift": {
        "status": {
          "status": "warning",
          "reasons": [ { "code": "DRIFT_DIFF", "text": "차이 3건 (변경 1 · 삭제 1 · 추가 1)", "status": "warning" } ],
          "updatedAt": "2026-09-19T06:11:40.000Z", "statusChangedAt": "2026-09-19T06:11:40.000Z", "stale": false
        },
        "mode": "auto", "computing": false, "computed": true, "computedAt": "2026-09-19T06:11:40.000Z", "lastResultStatus": "warning",
        "counts": { "compared": 24, "same": 21, "added": 1, "deleted": 1, "changed": 1, "hidden": { "default": 14, "managed": 1 }, "uncomparable": 11, "unparsable": 0 },
        "resultAvailable": true
      },
      "label": null, "memo": null, "notesUpdatedAt": null,
      "cluster": { "id": "7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e", "context": "sentinel-snapshot", "name": "prod-eks", "serverVersion": "v1.34.1-eks-8a2c1f0", "relation": "same" },
      "scope": { "namespaceMode": "all_except_system", "namespaces": ["batch", "data", "default", "monitoring", "prod"], "missingNamespaces": [], "systemIncluded": [], "kindCount": 17, "optionalKinds": [], "customResources": [], "includeHelmManaged": true },
      "resources": { "current": { "total": 35, "files": 35 }, "atExport": { "total": 35 }, "changedSinceExport": false, "previous": { "snapshotId": "20260918-230000", "total": 34 }, "delta": 1 },
      "helmManaged": 2,
      "partialKinds": [],
      "scan": { "errors": 0, "warnings": 0, "strict": false, "passed": true, "rules": [] },
      "lastModifiedAt": "2026-09-19T06:10:42.000Z",
      "modifiedByDashboard": false,
      "cliVersion": "0.1.0",
      "actions": {
        "editFiles": { "allowed": true, "reasonCode": null, "reasonText": null },
        "editNotes": { "allowed": true, "reasonCode": null, "reasonText": null },
        "delete": { "allowed": true, "reasonCode": null, "reasonText": null },
        "computeDrift": { "allowed": true, "reasonCode": null, "reasonText": null }
      },
      "exportInProgress": { "active": false, "metadataMissing": false, "lastChangeAt": "2026-09-19T06:10:42.000Z", "untilAt": null, "thresholdMinutes": 30 }
    }
  ],
  "cli": {
    "install": "npm install --prefix deploy/k8s-snapshot",
    "configure": "deploy/k8s-snapshot/.env.example 을 .env 로 복사한 뒤 KUBE_CONTEXT 를 채우세요",
    "dryRun": "npm run export:dry --prefix deploy/k8s-snapshot",
    "export": "npm run export --prefix deploy/k8s-snapshot",
    "scan": "npm run scan --prefix deploy/k8s-snapshot -- snapshots/<id>",
    "readme": "deploy/k8s-snapshot/README.md",
    "settings": [
      { "name": "KUBE_CONTEXT", "required": true, "text": "내보내기 전용 컨텍스트 이름 (필수, 비우면 종료코드 2)" },
      { "name": "KUBECONFIG", "required": false, "text": "kubeconfig 경로 (비우면 사용자 기본)" },
      { "name": "SNAPSHOT_NAMESPACES", "required": false, "text": "포함할 네임스페이스 (비우면 시스템 제외 전체)" },
      { "name": "SNAPSHOT_EXCLUDE_NAMESPACES", "required": false, "text": "제외할 네임스페이스 (포함 목록과 함께 쓰지 않음)" },
      { "name": "SNAPSHOT_OPTIONAL_KINDS", "required": false, "text": "선택 종류 켜기 (jobs, clusterroles …)" },
      { "name": "SNAPSHOT_STRICT", "required": false, "text": "경고도 실패로 (true/false)" }
    ],
    "exitCodes": [
      { "code": 0, "text": "성공, 스캔 통과" },
      { "code": 1, "text": "비밀값 의심 — 커밋 금지, 정리 후 재스캔" },
      { "code": 2, "text": "설정 오류 (폴더 없음)" },
      { "code": 3, "text": "클러스터 접속 실패·권한 없음·리소스 0개 (폴더 지움)" },
      { "code": 4, "text": "부분 성공 — 일부 종류를 읽지 못함 (metadata.kinds 확인)" }
    ]
  }
}
```

- `cli`는 명세 5.6. **서버는 이 명령을 실행하지 않는다.** `settings`·`exitCodes`는 k8s에만 있는 필드(AWS `cli`에는 추가하지 않음). `settings`는 안내 문구에 쓸 설정 이름(전체 목록은 4.2, README).
- `facets`: 필터 선택지 옆 개수(필터 전 전체 기준).
- 출처가 없으면 200 + `items: []` + unknown(ASM과 같음). 예시로 바꾸지 않고 폴더를 만들지 않는다.
- 오류: 400 `VALIDATION_FAILED`.

### 6.3 `GET /api/k8s-snapshots/:id`

상세 A~D, G와 파일 목록(C, E의 선택지). 파일 **내용은 없다**(6.4).

```json
{
  "dataSource": "live",
  "generatedAt": "…",
  "revision": 17,
  "cli": { "...": "6.2 cli, scan에 이 ID가 채워짐" },
  "snapshot": {
    "...": "K8sSnapshotListItem 필드 전부",
    "files": [
      {
        "path": "data/statefulsets/postgres.yaml",
        "fileType": "resource",
        "resource": { "apiGroup": "apps", "apiVersion": "apps/v1", "kind": "StatefulSet", "namespace": "data", "name": "postgres" },
        "resourceKey": "apps/StatefulSet/data/postgres",
        "documents": [ { "apiGroup": "apps", "apiVersion": "apps/v1", "kind": "StatefulSet", "namespace": "data", "name": "postgres" } ],
        "expected": { "apiGroup": "apps", "kind": "StatefulSet", "namespace": "data", "name": "postgres" },
        "parse": "ok",
        "parseError": null,
        "pathMatches": true,
        "duplicate": false,
        "duplicateOf": [],
        "runtimeFields": [],
        "helmManaged": false,
        "comparable": true,
        "findings": { "errors": 1, "warnings": 0 },
        "drift": null,
        "exists": true,
        "sizeBytes": 2211, "lineCount": 88, "modifiedAt": "…", "version": "sha256:…",
        "eol": "lf", "bom": false, "encoding": "utf-8", "indent": { "style": "spaces", "size": 2 },
        "editable": { "allowed": true, "reasonCode": null, "reasonText": null },
        "viewTruncated": false
      },
      { "path": "metadata.json", "fileType": "metadata", "resource": null, "expected": null, "parse": "ok", "pathMatches": true, "duplicate": false, "runtimeFields": [], "helmManaged": false, "comparable": false, "findings": { "errors": 0, "warnings": 0 }, "drift": null, "exists": true, "sizeBytes": 2890, "…": "…", "editable": { "allowed": false, "reasonCode": "FILE_KIND_READ_ONLY", "reasonText": "이 파일은 보기 전용입니다" } }
    ],
    "tree": [
      { "namespace": "data", "system": false, "namespaceFile": "data/namespace.yaml", "count": 12,
        "kinds": [ { "kindDir": "statefulsets", "kind": "StatefulSet", "count": 2, "drift": "comparable", "paths": ["data/statefulsets/postgres.yaml", "data/statefulsets/redis.yaml"] } ] },
      { "namespace": null, "system": false, "namespaceFile": null, "count": 0, "kinds": [] }
    ],
    "counts": {
      "total": { "current": 35, "atExport": 35, "previous": 34, "delta": 1, "helmManaged": 2, "excludedByRule": 11 },
      "byKind": [ { "kindDir": "deployments", "kind": "Deployment", "custom": false, "current": 6, "atExport": 6, "previous": 5, "delta": 1, "drift": "comparable" } ],
      "byNamespace": [ { "namespace": "prod", "system": false, "current": 18, "atExport": 18 } ],
      "excluded": [
        { "kindDir": "configmaps", "kind": "ConfigMap", "count": 5, "reason": "auto_created", "text": "자동 생성 (kube-root-ca.crt)" },
        { "kindDir": "services", "kind": "Service", "count": 1, "reason": "auto_created", "text": "자동 생성 (default/kubernetes)" }
      ]
    },
    "folder": {
      "fileCount": 38, "sizeBytes": 1468006,
      "topLevel": [ { "name": "prod", "type": "directory", "fileCount": 18 }, { "name": "metadata.json", "type": "file", "fileCount": 1 }, { "name": ".env", "type": "file", "fileCount": 1, "unexpected": true } ]
    },
    "extraFiles": [ { "name": "prod/notes.txt", "type": "file", "sizeBytes": 120 } ],
    "metadata": { "state": "ok", "error": null, "fields": { "...": "3.2의 필드 (cluster, scope, kinds, resources, cleanup, secrets, secretScan, tool, createdAt, snapshotId)" } },
    "scan": {
      "current": { "summary": { "...": "ScanSummary" }, "scannedFiles": ["data/statefulsets/postgres.yaml", "metadata.json", "…"], "findings": [ { "file": "data/statefulsets/postgres.yaml", "fileType": "resource", "line": 41, "rule": "k8s-env-literal", "severity": "error", "message": "환경 변수 \"POSTGRES_PASSWORD\" 에 리터럴 값이 들어 있습니다 (ex****(16자)). valueFrom.secretKeyRef 로 바꾸세요" } ], "scannedAt": "…" },
      "atExport": { "...": "metadata.secretScan 또는 null" }
    },
    "secretRefs": {
      "state": "ok",
      "count": 3,
      "note": "Secret 값은 담지 않습니다. 복원 전에 아래 Secret 을 별도 보관소에서 다시 만드세요.",
      "secrets": [ { "namespace": "data", "secretName": "postgres-credentials", "keys": ["POSTGRES_PASSWORD"], "optional": false, "referencedBy": [ { "kind": "StatefulSet", "name": "postgres", "via": "env.valueFrom.secretKeyRef", "container": "postgres" } ] } ]
    },
    "notes": { "label": null, "memo": null, "updatedAt": null, "version": "sha256:…", "fileExists": false },
    "notices": [
      { "code": "DATA_NOT_INCLUDED", "text": "이 스냅샷은 Postgres 데이터와 PV 내용을 담지 않습니다. 스냅샷의 PVC 를 적용하면 빈 볼륨이 새로 만들어집니다 (README 8장)" },
      { "code": "HELM_MANAGED", "text": "Helm 관리 리소스 2개 — Helm 으로 복원 권장" }
    ]
  }
}
```

| 필드 | 설명 |
|---|---|
| `files` | 스냅샷 안의 **알려진 파일 전부**(경로 규칙에 맞는 YAML + `metadata.json`·`secret-refs.json`. `notes.json`은 제외). 정렬: `metadata.json`, `secret-refs.json`, 그다음 경로 이름순. 수백 개일 수 있다(응답 수백 KB 이내) |
| `files[].resource` | 파일 내용 **첫 문서**의 식별값(편집기 머리 "StatefulSet · data/postgres"). 해석 실패면 `null` |
| `files[].resourceKey` | 10.3 `resourceKey`(드리프트 화면 `res=` 값). 첫 문서 기준, 해석 실패면 `null` |
| `files[].documents` | 파일 안 모든 문서의 식별값(빈 문서 제외). 보통 1개. `multi_document`면 2개 이상이고 드리프트는 문서마다 따로 짝을 맞춘다(10.3) |
| `files[].expected` | 경로에서 읽은 식별값(`namespace.yaml`은 Namespace). 사용자 지정 리소스는 `kind` 대신 그룹만 확인하므로 `kind: null` |
| `files[].parse` | `ok` \| `yaml_error` \| `multi_document`(문서 2개 이상) \| `not_object`(최상위가 매핑이 아님) \| `too_large`(보기 상한 초과, 해석 안 함) \| `empty` |
| `files[].parseError` | `yaml_error`일 때 `{ "line": 12, "column": 3, "code": "BAD_INDENT", "message": "YAML 구문 오류 (BAD_INDENT)" }`(서버 문구, 파서 원문 없음), 그 밖 `null` |
| `files[].pathMatches` | 첫 문서의 `resource`와 `expected`가 같음(`apiGroup`, `kind`, `namespace`, `name`). 파일에 `metadata.namespace`가 없으면 `false` |
| `files[].duplicate` / `duplicateOf` | 같은 식별값(어느 문서든)이 다른 파일에도 있음 / 그 파일 경로 목록 |
| `files[].runtimeFields` | `findRuntimeFields` 결과(최대 10개 경로) |
| `files[].comparable` | 드리프트 비교 가능 종류(10.2) + 파싱 성공 + 중복 아님 + apiVersion 일치 |
| `files[].drift` | 드리프트 결과가 있으면 `same` \| `changed` \| `deleted` \| `uncomparable` \| `skipped`(해석 실패·중복), 없으면 `null`. "추가됨"은 파일이 없으므로 드리프트 응답(10.9)에만 |
| `files[].editable` | ASM-API 6.3 순서 + 종류(`metadata`/`secret_refs` → `FILE_KIND_READ_ONLY`) |
| `tree` | 네임스페이스(이름순) → 종류(**종류 목록 순서**: Deployment → StatefulSet → DaemonSet → Service → Ingress → PersistentVolumeClaim → PodDisruptionBudget → HorizontalPodAutoscaler → ConfigMap → ServiceAccount → Role → RoleBinding → NetworkPolicy → CronJob → Job → ResourceQuota → LimitRange → 사용자 지정(이름순)) → 경로(이름순). `namespace.yaml`은 `namespaceFile`로 따로. 클러스터 범위(`_cluster/`)는 맨 뒤 `namespace: null` 항목(있을 때만). `system`: 스냅샷 `scope.namespaces.system`에 든 네임스페이스. `kinds[].drift`: `comparable` \| `not_in_rbac` \| `forbidden` \| `api_version_mismatch`(10.2, 드리프트 계산 가능 여부와 무관하게 표시) |
| `counts` | 합계·종류별·네임스페이스별 현재 수, 내보내기 당시 수(`metadata.resources`), 직전 스냅샷 대비(`previous`·`delta`, 같은 `cluster.id`의 이전 스냅샷), Helm 관리 수. **합계는 서버 값을 쓴다** |
| `counts.excluded` | 제외 규칙으로 뺀 수(메타 `resources.excludedByRule`, 3.2). `reason`: `owned`("컨트롤러 소유(ownerReferences)") \| `auto_created`("자동 생성 (…)") \| `helm_excluded`("Helm 제외 설정"). 메타 없음·손상이면 `[]`와 `counts.total.atExport = null` |
| `folder` | 삭제 확인 창용: 폴더 안 파일 수·크기(재귀, 링크는 세지 않음), 최상위 항목(이름·종류·그 아래 파일 수, 예상 밖이면 `unexpected: true`, 최대 50개) |
| `extraFiles` | 알려진 파일 밖 항목(하위 폴더 포함 상대 경로, 링크, 최대 50개) |
| `metadata.state` | ASM과 같음(`ok`/`missing`/`corrupt`/`schema_mismatch`) |
| `scan.current.findings` | 정렬: 등급 → 파일(`metadata.json`, `secret-refs.json`, `notes.json`, 그다음 경로 이름순) → 줄 → 규칙 |
| `secretRefs.state` | `ok` \| `missing` \| `corrupt` \| `schema_mismatch` |
| `secretRefs.note` | `secret-refs.json`의 `note` 문자열(CLI 안내 문구) 그대로. 없거나 `state`가 `ok`가 아니면 `null` (2026-09-19 추가) |
| `notices` | 11.4 |

- 드리프트 상세는 이 응답에 넣지 않는다(10.9 별도 조회). `snapshot.drift`(배지)만 있다.
- 오류: 400, 403 `SNAPSHOT_PATH_REJECTED`, 404 `RESOURCE_NOT_FOUND`(`details.resource = { kind: "K8sSnapshot", id }`), 503 `SOURCE_UNAVAILABLE`.

### 6.4 `GET /api/k8s-snapshots/:id/file?path=<상대 경로>`

ASM-API 6.4와 같은 모양. 다른 필드만:

```json
{
  "dataSource": "live",
  "generatedAt": "…",
  "snapshotId": "20260919-061000",
  "path": "data/statefulsets/postgres.yaml",
  "fileType": "resource",
  "resource": { "apiGroup": "apps", "apiVersion": "apps/v1", "kind": "StatefulSet", "namespace": "data", "name": "postgres" },
  "content": "apiVersion: apps/v1\nkind: StatefulSet\n…",
  "version": "sha256:…",
  "sizeBytes": 2211, "lineCount": 88, "eol": "lf", "bom": false, "encoding": "utf-8", "indent": { "style": "spaces", "size": 2 },
  "modifiedAt": "…", "truncated": false, "returnedBytes": 2211,
  "editable": { "allowed": true, "reasonCode": null, "reasonText": null },
  "findings": [ { "file": "data/statefulsets/postgres.yaml", "fileType": "resource", "line": 41, "rule": "k8s-env-literal", "severity": "error", "message": "…" } ],
  "commands": {
    "note": "대시보드는 이 명령을 실행하지 않습니다. 적용 전 kubectl diff 로 확인하세요",
    "diff": "kubectl diff -f deploy/k8s-snapshot/snapshots/20260919-061000/data/statefulsets/postgres.yaml",
    "apply": "kubectl apply -f deploy/k8s-snapshot/snapshots/20260919-061000/data/statefulsets/postgres.yaml"
  }
}
```

- `content`는 원문(가리지 않음, ASM 3.2 E와 같음). 스냅샷 파일은 로컬 사람용 파일이라 env·어노테이션을 담는다(명세 8절 "기존 문서와의 충돌"). 이 응답과 7.1 요청 본문만 파일 원문을 담는다.
- `commands`: `resource`/`namespace` 파일만(그 밖 `null`). 경로는 `root.displayPath` 기준. 명령 문자열만 주고 실행 수단은 없다(AC-K39).
- 오류: 400(`id`·`path`), 403 `SNAPSHOT_PATH_REJECTED`, 404(`K8sSnapshot` \| `K8sSnapshotFile` — `details.resource.path`), 503.

### 6.5 `GET /api/k8s-snapshots/scan-rules`
ASM-API 6.5와 같은 모양. `rules`는 `listRules({ profile: 'k8s' })`(공통 + k8s 규칙), `profile: "k8s"` 필드 추가. 처리 방법 문구(`valueFrom.secretKeyRef`로 바꾸기 등)는 화면 고정 문구.

### 6.6 `GET /api/k8s-snapshots/drift-rules`

드리프트 도움말·투명성(명세 4.2·4.4). 서버가 쓰는 표를 그대로 준다(화면 하드코딩 금지).

```json
{
  "dataSource": "live",
  "generatedAt": "…",
  "rulesVersion": 1,
  "comparableKinds": [
    { "id": "deployments", "apiGroup": "apps", "apiVersion": "apps/v1", "kind": "Deployment", "rbacResource": "deployments", "informer": "ok" },
    { "id": "horizontalpodautoscalers", "apiGroup": "autoscaling", "apiVersion": "autoscaling/v2", "kind": "HorizontalPodAutoscaler", "rbacResource": "horizontalpodautoscalers", "informer": "forbidden" }
  ],
  "uncomparableNote": "ConfigMap, ServiceAccount, Role, RoleBinding, NetworkPolicy, CronJob, Job, ResourceQuota, LimitRange, 클러스터 범위 종류, 사용자 지정 리소스는 대시보드 권한 밖이라 비교하지 않습니다",
  "cleanup": ["status", "metadata.uid", "…"],
  "defaults": [ { "kinds": ["Deployment"], "path": "spec.revisionHistoryLimit", "value": 10, "note": null } ],
  "managed": [ { "id": "HPA_REPLICAS", "kinds": ["Deployment", "StatefulSet"], "path": "spec.replicas", "reason": "HPA가 관리", "condition": "HPA의 scaleTargetRef가 이 워크로드" } ],
  "masked": ["**.containers[*].env[*].value", "**.initContainers[*].env[*].value", "**.containers[*].command", "**.containers[*].args", "…", "스캐너 규칙에 걸리는 값"]
}
```

- `comparableKinds[].informer`: `ok` \| `forbidden`(권한 거부) \| `syncing` \| `not_configured`(kube 없음) \| `mock`.
- 오류: 503 `SOURCE_UNAVAILABLE`(k8s lib 없음).

### 6.7 `POST /api/k8s-snapshots/refresh`
ASM-API 6.6과 같다(진행 중이면 끝난 뒤 한 번 더, 1.3 보호, 응답 6.1 모양). 드리프트는 이 요청으로 다시 계산하지 않는다(파일이 바뀌었으면 10.7 규칙대로 따라온다).

---

## 7. 파일 편집 (명세 5.4, AC-K22·K23)

편집 가능: `fileType`이 `resource` 또는 `namespace`인 파일. `metadata.json`, `secret-refs.json`은 403 `SNAPSHOT_FILE_NOT_EDITABLE`(`details.reasonCode = "FILE_KIND_READ_ONLY"`).

### 7.1 요청 본문 (7.2 check, 7.3 PUT 공통)
```json
{ "content": "apiVersion: apps/v1\n…", "baseVersion": "sha256:…", "confirm": ["secret_errors", "identity_changed"] }
```
- `content`·`baseVersion`: ASM-API 7.1과 같음(5 MB 상한 413 `SNAPSHOT_FILE_TOO_LARGE`, NUL 400, `check`에서 `baseVersion` 선택).
- `confirm` 값: `secret_errors` \| `yaml_syntax` \| `multi_document` \| `identity_changed`. (`resource_decrease`는 k8s에 없음 — 파일당 리소스 1개, 명세 5.4)
- 본문 상한: 이 두 경로만 `K8S_SNAPSHOT_EDIT_MAX_BYTES × 2 + 64 KB`(ASM과 같은 방식, `common.md` 3.3).

### 7.2 `POST /api/k8s-snapshots/:id/file/check?path=…` (파일을 쓰지 않음)

```json
{
  "dataSource": "live",
  "generatedAt": "…",
  "snapshotId": "20260919-061000",
  "path": "prod/deployments/api.yaml",
  "check": {
    "findings": [],
    "errors": 0,
    "warnings": 0,
    "syntax": { "checked": true, "errors": [] },
    "documents": 1,
    "identity": {
      "expected": { "apiGroup": "apps", "kind": "Deployment", "namespace": "prod", "name": "api" },
      "actual": { "apiGroup": "apps", "apiVersion": "apps/v1", "kind": "Deployment", "namespace": "prod", "name": "api-v2" },
      "matches": false
    },
    "runtimeFields": [],
    "unchanged": false,
    "snapshotScanAfter": { "errors": 0, "warnings": 0, "strict": false, "passed": true, "rules": [] },
    "confirmationsRequired": ["identity_changed"]
  }
}
```

| 필드 | 설명 |
|---|---|
| `findings`·`errors`·`warnings` | `scanText(content, path, { profile: 'k8s' })` |
| `syntax` | YAML 1.2 구문 검사(모든 파일). 오류는 `{ line, column, code, message }`(서버 문구, 파서 원문·코드 조각 없음). 별칭 확장 상한(`maxAliasCount: 100`), 사용자 태그(`!`)는 오류가 아니라 무시 |
| `documents` | 문서 수(`---` 구분, 빈 문서 제외) |
| `identity` | `expected` = 경로, `actual` = 첫 문서의 식별값(구문 오류·매핑 아님이면 `null`, `matches: false`로 보지 않고 `null`) |
| `runtimeFields` | 정보(확인 불필요). 저장하면 파일 상태 주의 사유 `RUNTIME_FIELDS_LEFT` |
| `confirmationsRequired` | `secret_errors`: `errors ≥ 1`(`k8s-secret-object` 포함, ASM Q3) / `yaml_syntax`: 구문 오류 / `multi_document`: `documents ≥ 2` / `identity_changed`: `identity.matches === false`. 경고만이면 비어 있다 |

- 오류: 7.3의 400·403(`SNAPSHOT_FILE_NOT_EDITABLE`, `SNAPSHOT_PATH_REJECTED`, `ORIGIN_NOT_ALLOWED`)·404·413·415·503. 쓰기 불가 사유 403과 409는 내지 않는다(ASM과 같음).

### 7.3 `PUT /api/k8s-snapshots/:id/file?path=…`
ASM-API 7.3 처리 순서와 **같다**(형식 → 쓰기 가능 → 파일 존재·종류·크기 → `baseVersion` 409 → 검사·422 → `unchanged` → 줄바꿈·BOM 복원 → 원자적 쓰기 → `notes.json fileEdits` 갱신 → 재스캔·판단 → `revision` 증가 → SSE). 추가:
- 9단계 뒤: 이 스냅샷이 드리프트 **자동 대상**이거나 **임대 중**(10.8)이면 드리프트를 다시 계산하도록 표시한다(10.7, 30초 이내 반영, AC-K37).

**응답 200**
```json
{
  "dataSource": "live", "generatedAt": "…", "saved": true,
  "snapshotId": "20260919-061000", "path": "prod/deployments/api.yaml",
  "version": "sha256:…", "modifiedAt": "…", "sizeBytes": 2410,
  "check": { "...": "7.2 check" },
  "rescan": { "before": { "errors": 1, "warnings": 0 }, "after": { "errors": 0, "warnings": 0 } },
  "snapshot": { "...": "K8sSnapshotListItem" },
  "driftRecompute": "scheduled",
  "revision": 18
}
```
- `driftRecompute`: `scheduled`(자동 대상·임대 중이라 재계산 예약) \| `none`.
- 422 `SNAPSHOT_CONFIRMATION_REQUIRED`: `details.missing` + `details.check`(ASM과 같음). 메시지 예: "저장하려면 확인이 필요합니다: 비밀값 의심 1건, 경로와 내용 불일치(metadata.name)".
- 409 `SNAPSHOT_VERSION_CONFLICT`: `details: { path, currentVersion, currentModifiedAt }`(ASM의 `fileKind` 대신 `path`).
- 오류 전체: ASM-API 7.3 표와 같다(`K8S_*` 접두어 없이 같은 `SNAPSHOT_*` 코드를 쓴다 — 화면의 ASM 편집 흐름 재사용). 404 `details.resource.kind`는 `K8sSnapshot` \| `K8sSnapshotFile`.

---

## 8. 라벨·메모
ASM-API 8절과 **같다**(`PUT /api/k8s-snapshots/:id/notes`, 60자/2000자, `snapshot-scan: allow` 금지, `error` 발견이면 422 `SNAPSHOT_NOTES_SECRET_DETECTED`, `notes.version` 충돌 409). 라벨·메모 검사는 `profile: 'k8s'`로 한다. 응답의 `snapshot`은 `K8sSnapshotListItem`.

---

## 9. 삭제·휴지통
ASM-API 9절과 **같다**(`<k8s 루트>/.trash/`, `trashId` 형식, ID 입력 확인, 복원 시 같은 ID면 409 `SNAPSHOT_ID_EXISTS`, 자동 비우기 없음, 영구 삭제는 링크를 따라가지 않음). 경로 prefix만 `/api/k8s-snapshots/`. 404 `kind: "K8sSnapshotTrashItem"`.
- 휴지통 목록 행: `region` 대신 `cluster: { context, name } | null`, `files`(최상위 이름, 최대 50) 옆에 `fileCount`(재귀 파일 수).
- 휴지통으로 옮긴 스냅샷은 드리프트 자동 대상·임대에서 빠진다(10.7).

---

## 10. 드리프트 (명세 4절)

### 10.1 클러스터 쪽 데이터: informer 캐시 확인 결과와 결정

**현재 코드 확인 (2026-09-19, `apps/api/src/cluster/kube/kube-watcher.service.ts`, `extract.ts`, `@kubernetes/client-node` 2.0.0 `dist/cache.js`)**
1. `KubeWatcherService`는 `makeInformer`로 12개 informer(nodes, pods, events, persistentvolumeclaims, namespaces, services, deployments, statefulsets, daemonsets, ingresses, poddisruptionbudgets, horizontalpodautoscalers)를 돌린다.
2. 콜백은 `extract*()`로 **화면용으로 추린 값만** `ClusterStore`에 넣는다(env·command·어노테이션 원문 없음). 명세 4.1의 우려대로 `ClusterStore`에는 `spec` 전체가 없다.
3. 그러나 `makeInformer`가 만드는 `ListWatch`는 내부 `objects` 맵에 **객체 전체를 이미 보관**한다(`list(namespace?)`, `get(name, namespace)`로 읽을 수 있음). 드리프트 비교 가능 9종(Namespace, Deployment, StatefulSet, DaemonSet, Service, PVC, Ingress, PDB, HPA)은 모두 이미 informer가 있다.
4. 단, 캐시 객체의 모양이 섞여 있다: **최초 목록**은 타입 API(`core.listPodForAllNamespaces()` 등)를 거쳐 `ObjectSerializer`로 변환된 클래스 인스턴스(시각은 `Date`, **클라이언트 모델에 없는 필드는 버려짐**, 목록 항목에 `apiVersion`/`kind` 없음)이고, **watch 이벤트**로 바뀐 객체는 `JSON.parse`한 원본이다. 이대로 비교하면 새 쿠버네티스 버전의 필드가 첫 목록에서만 빠져 가짜 차이가 나고, 같은 객체가 수정 전후로 모양이 달라진다.

**결정**
- 드리프트는 **기존 informer의 `ListWatch` 캐시를 읽는다.** informer·API 호출·RBAC를 추가하지 않는다. 메모리 추가 없음(이미 보관 중인 객체를 읽기만 함). 계산할 때 비교 대상 객체만 깊은 복사한 뒤 정리한다(캐시 객체를 절대 바꾸지 않음).
- **informer 목록 함수를 원본 JSON 목록으로 바꾼다**(5단계 구현): 같은 경로를 `GET`으로 불러 `JSON.parse` 결과를 그대로 준다(`ObjectSerializer` 미사용. `kc.applyToFetchOptions` + `fetch`, 또는 동등한 원본 요청). 그러면 캐시 전체가 watch 이벤트와 같은 원본 JSON이 되고, CLI(4.4 원본 JSON)와 같은 모양이 된다. 기존 `extract*()`는 시각을 `Date | string` 모두 받으므로(`iso()`) 그대로 동작한다. `cluster-status` 응답 모양은 바뀌지 않는다.
  - 목록 항목에는 `apiVersion`/`kind`가 없으므로 드리프트가 종류 표(3.5)로 채운다.
- 대시보드 클러스터 ID = namespaces informer 캐시의 `kube-system` 객체 `metadata.uid`. namespaces informer가 권한 거부·미동기화면 ID를 모른다 → 모든 드리프트 알 수 없음(`DASHBOARD_CLUSTER_UNKNOWN`/`CLUSTER_SYNCING`).
- 비교 가능 종류의 informer가 권한 거부(`informerSummary().forbidden`)면 그 종류는 "비교 불가(권한 거부)"(명세 4.2). 아직 한 번도 동기화되지 않았으면 드리프트 전체를 `CLUSTER_SYNCING`으로 둔다(일부 종류만 비교해 "삭제됨"을 잘못 내지 않게).
- 메모리 참고: 캐시는 지금도 모든 객체의 `managedFields`를 들고 있다(파드·이벤트가 대부분). 드리프트는 이를 늘리지 않는다. 필요해지면 informer 단계에서 `managedFields`를 떼는 최적화를 별도로 검토한다(이번 범위 밖).
- mock: 같은 인터페이스(`ClusterObjectSource`)의 mock 구현이 `cluster` mock 인벤토리에서 전체 객체를 만들어 준다(14.3).

```ts
// 서버 내부 인터페이스 (구현 기준)
interface ClusterObjectSource {
  state(): { source: SourceState; clusterId: string | null; context: string | null; name: string | null; serverVersion: string | null; synced: boolean };
  kindState(kindId: string): 'ok' | 'forbidden' | 'syncing';
  list(kindId: string): readonly object[];   // 원본 JSON, 읽기 전용
  onChange(listener: (kindId: string) => void): () => void;
}
```

### 10.2 비교 가능 종류 (`COMPARABLE_KINDS`, 명세 4.2)
- api 한 곳(`apps/api/src/k8s-snapshots/drift/comparable-kinds.ts`)에 둔다: `namespaces`, `deployments`, `statefulsets`, `daemonsets`, `services`, `persistentvolumeclaims`, `ingresses`, `poddisruptionbudgets`, `horizontalpodautoscalers` 각각의 `apiGroup`, `apiVersion`(informer가 읽는 버전), RBAC 리소스 이름, informer 이름.
- 단위 테스트: `deploy/rbac.yaml`을 읽어 각 항목의 (apiGroup, resource)에 `get`·`list`·`watch`가 있는지, 그리고 `KubeWatcherService`의 informer 경로와 같은지 확인한다. RBAC에서 빠지면 테스트가 실패한다.
- 스냅샷 쪽 리소스의 비교 불가 사유:

| 사유 코드 | 조건 | 화면 문구 예 |
|---|---|---|
| `NOT_IN_RBAC` | 종류가 목록에 없음 | "대시보드 권한 밖이라 비교하지 않음" |
| `FORBIDDEN` | 목록에 있지만 informer 권한 거부 | "비교 불가 (권한 거부)" |
| `API_VERSION_MISMATCH` | 파일 `apiVersion` ≠ 목록의 버전(예 `autoscaling/v1` HPA) | "API 버전이 달라 비교하지 않음 (autoscaling/v1)" |

### 10.3 짝 맞추기와 추가·삭제·변경 (명세 4.3)
- 식별값 = `apiGroup + kind + namespace + name`, **파일 내용 기준**. `apiGroup`은 `apiVersion`의 그룹 부분이며 **버전은 식별에 쓰지 않는다**(버전이 다르면 짝은 맞추되 10.2 `API_VERSION_MISMATCH`로 비교 불가). `resourceKey` 문자열 = `<apiGroup 또는 core>/<Kind>/<namespace 또는 _cluster>/<name>` (예 `apps/Deployment/prod/api`).
- **여러 문서(`---`)가 든 파일**(명세 4.3, 편집으로 생긴 경우): 문서마다 따로 식별값을 만들어 **각각 짝을 맞춰 비교**한다. 빈 문서(`---`만 있거나 `null`)는 무시한다. 문서 하나가 매핑이 아니면 그 문서만 `unparsable`. 드리프트 결과의 `file`은 같은 파일 경로를 가리키고, 명령 예시 `kubectl apply -f <파일>`은 파일 안 모든 문서를 적용한다는 점을 화면 문구로 알린다(`resources[].fileDocuments > 1`). 파일 상태는 `MULTI_DOCUMENT_FILE` 주의(11.1).
- 파일 해석 실패(`yaml_error`·`not_object`·`too_large`·`empty`)·`metadata.namespace` 없음·중복 정의(어느 두 문서든 같은 식별값) → 비교에서 빠지고 `unparsable`에 센다. 중복 정의면 관련 문서 모두 빠진다.
- **삭제됨**: 스냅샷에 있고 클러스터 캐시에 없음.
- **추가됨**: 클러스터에 있고 스냅샷에 없음. 단 스냅샷 범위 안에서만 — 스냅샷 `metadata.scope`의 네임스페이스 규칙(모드·포함·제외·시스템 목록, `systemIncluded`)을 현재 클러스터 네임스페이스에 적용하고, 종류는 `scope.kinds`에 있고 `kinds.<id>.result == ok`인 비교 가능 종류만, 그리고 `isAlwaysExcluded`·`isAutoCreated`·(`includeHelmManaged: false`면) `isHelmManaged`로 뺀 뒤 남는 것.
  - `metadata.json`이 없거나 손상·필수 필드 없음이면 애초에 `cluster.id`가 없어 계산하지 않는다(Q4). `scope`만 손상된 경우(형식이 다름)는 추가됨을 계산하지 않고 정보 문구 `ADDED_NOT_CHECKED`("범위를 알 수 없어 추가된 리소스는 확인하지 않음").
- **변경됨**: 양쪽에 있고 10.4 정규화 뒤 **보이는** 필드 차이 1건 이상.
- **같음**: 보이는 차이 0건(숨긴 차이만 있을 수 있음).

### 10.4 비교 절차 (명세 4.4)
두 객체 각각에 대해:
1. 스냅샷 쪽은 YAML 1.2(core 스키마)로 해석한 그 문서(10.3), 클러스터는 캐시 원본 JSON. 둘 다 순수 JSON 값으로.
2. **같은 정리 규칙**: `cleanObject(obj, { rulesVersion: 스냅샷 cleanup.rulesVersion })`을 **양쪽에** 적용(스냅샷 파일에 손으로 남긴 런타임 필드도 차이로 나오지 않게. 그 파일은 파일 상태에서 따로 주의).
3. 비교 대상: `apiVersion`, `kind`, `metadata.name`, `metadata.namespace`는 식별값이라 빼고 나머지 전부(`metadata.labels`, `metadata.annotations`, `spec` 등 최상위 키 모두).
4. 트리 비교 규칙:
   - `null`, 빈 맵, 빈 목록, 키 없음은 같다.
   - 수량 경로(`QUANTITY_PATHS`: `**.resources.requests.*`, `**.resources.limits.*`, PVC `spec.resources.requests.storage`, `**.emptyDir.sizeLimit`, HPA `**.target.averageValue`·`**.target.value` 등)는 쿠버네티스 수량으로 해석해 값으로 비교(`1Gi` = `1024Mi`, `1000m` = `1`). 해석 실패면 문자열 비교. 표시는 원문.
   - 숫자와 문자열은 다르다(`targetPort: 8080` ≠ `"8080"`). 불리언도 문자열과 다르다.
   - **이름 있는 목록**(`LIST_KEYS`)은 키로 짝지어 비교하고 순서 차이는 무시한다:

| 목록 | 키 |
|---|---|
| `containers`, `initContainers`, `ephemeralContainers` | `name` |
| 컨테이너 `ports` | `name`, 없으면 `containerPort/protocol` |
| `env` | `name` |
| `envFrom` | `prefix` + `configMapRef.name`/`secretRef.name` |
| `volumes` | `name` |
| `volumeMounts` | `mountPath` |
| `volumeDevices` | `devicePath` |
| Service `spec.ports` | `name`, 없으면 `port/protocol` |
| `tolerations` | `key/operator/value/effect` |
| `imagePullSecrets` | `name` |
| `hostAliases` | `ip` |
| `topologySpreadConstraints` | `topologyKey/whenUnsatisfiable` |
| StatefulSet `volumeClaimTemplates` | `metadata.name` |
| HPA `behavior.*.policies` | `type/periodSeconds` |
| HPA `metrics` | `type` + `resource.name`/`pods.metric.name`/`object.metric.name`/`external.metric.name` |
| Ingress `spec.tls` | `secretName` |
| Ingress `spec.rules` | `host` (없으면 `*`) |
| Ingress `rules[].http.paths` | `path/pathType` |

   - **순서가 의미 있는 목록**(`ORDER_SENSITIVE_LISTS`): `initContainers`(실행 순서). 키 짝 비교와 별도로 이름 순서가 다르면 그 목록 경로에 "순서 다름" 차이 1건. `FieldDiff`: `path` = 목록 경로 그대로(예 `spec.template.spec.initContainers`), `category: changed`, `reason: "순서 다름"`, 양쪽 값 = `{ kind: "list", items: [이름…] }`(양쪽에 다 있는 이름만). `containers` 순서는 무시한다.
   - 키 없는 객체 목록(예 `args` 외의 목록)은 인덱스로 짝짓는다(`[0]`). 스칼라 목록(`command`, `args`, `ipFamilies`, `accessModes`)은 목록 전체를 한 값으로 비교한다.
5. 차이는 **잎(스칼라·스칼라 목록) 단위**로 만든다. 한쪽에만 있는 하위 트리(예: 새 사이드카 컨테이너)는 그 안의 잎마다 한 건씩("(없음)" ↔ 값). 가림 규칙(10.6)은 잎 경로마다 적용된다.
6. 각 잎 차이의 분류(앞이 우선): `managed`(10.5 관리 필드) → `default`(10.5 기본값 표, 한쪽이 없고 다른 쪽이 기본값) → `changed`. `default`·`managed`는 숨김(건수·상태에 넣지 않음, 명세 4.4-6).

**경로 표기** (`FieldDiff.path`): 점 구분. 이름 있는 목록은 `[키]`(예 `spec.template.spec.containers[api].env[LOG_LEVEL].value`, 복합 키는 `/`로 이음 `ports[8080/TCP]`), 인덱스는 `[0]`, 식별자 모양이 아닌 맵 키는 `["alb.ingress.kubernetes.io/scheme"]`.

### 10.5 기본값 표와 관리 필드 (`rules.mjs DEFAULTS`·`MANAGED_FIELDS`, 명세 4.4-4·5)

아래는 `rulesVersion: 1`의 초기 표다. `PT` = 파드 템플릿 `spec.template.spec`(Deployment·StatefulSet·DaemonSet), `C` = `PT.{containers,initContainers}[*]`. 구현 단계에서 kind(쿠버네티스 in Docker) 1.30~1.34의 실제 저장값으로 확인하고, 다른 점은 표와 이 문서에 반영한다.

**기본값** (한쪽에 없고 다른 쪽 값이 이 값이면 `default`)

| 종류 | 경로 | 기본값 |
|---|---|---|
| 워크로드 | `PT.restartPolicy` / `PT.dnsPolicy` / `PT.schedulerName` / `PT.terminationGracePeriodSeconds` | `Always` / `ClusterFirst` / `default-scheduler` / `30` |
| 워크로드 | `PT.serviceAccount` | 같은 객체의 `PT.serviceAccountName`과 같은 값(더 이상 쓰지 않는 별칭) |
| 워크로드 | `C.terminationMessagePath` / `C.terminationMessagePolicy` | `/dev/termination-log` / `File` |
| 워크로드 | `C.imagePullPolicy` | 이미지 태그가 `latest`이거나 없으면 `Always`, 다이제스트(`@sha256:`)나 그 밖의 태그면 `IfNotPresent` |
| 워크로드 | `C.ports[*].protocol` | `TCP` |
| 워크로드 | `C.{readiness,liveness,startup}Probe.timeoutSeconds` / `periodSeconds` / `successThreshold` / `failureThreshold` / `httpGet.scheme` | `1` / `10` / `1` / `3` / `HTTP` |
| 워크로드 | `C.env[*].valueFrom.fieldRef.apiVersion` | `v1` |
| 워크로드 | `PT.volumes[*].{secret,configMap,projected,downwardAPI}.defaultMode` | `420` |
| Deployment | `spec.replicas` / `spec.revisionHistoryLimit` / `spec.progressDeadlineSeconds` | `1` / `10` / `600` |
| Deployment | `spec.strategy.type` / `spec.strategy.rollingUpdate.maxSurge` / `…maxUnavailable` | `RollingUpdate` / `"25%"` / `"25%"` |
| StatefulSet | `spec.replicas` / `spec.podManagementPolicy` / `spec.revisionHistoryLimit` | `1` / `OrderedReady` / `10` |
| StatefulSet | `spec.updateStrategy.type` / `spec.updateStrategy.rollingUpdate.partition` | `RollingUpdate` / `0` |
| StatefulSet | `spec.persistentVolumeClaimRetentionPolicy.whenDeleted` / `.whenScaled` | `Retain` / `Retain` |
| StatefulSet | `spec.volumeClaimTemplates[*].spec.volumeMode` / `.apiVersion` / `.kind` | `Filesystem` / `v1` / `PersistentVolumeClaim` |
| DaemonSet | `spec.updateStrategy.type` / `.rollingUpdate.maxUnavailable` / `.rollingUpdate.maxSurge` / `spec.revisionHistoryLimit` | `RollingUpdate` / `1` / `0` / `10` |
| Service | `spec.type` / `spec.sessionAffinity` / `spec.ipFamilyPolicy` / `spec.internalTrafficPolicy` | `ClusterIP` / `None` / `SingleStack` / `Cluster` |
| Service | `spec.ipFamilies` | 원소 하나짜리 목록(`["IPv4"]` 또는 `["IPv6"]`) |
| Service | `spec.externalTrafficPolicy` / `spec.allocateLoadBalancerNodePorts` | `Cluster`(NodePort·LoadBalancer) / `true`(LoadBalancer) |
| Service | `spec.ports[*].protocol` / `spec.ports[*].targetPort` | `TCP` / 같은 항목의 `port`와 같은 숫자 |
| PVC | `spec.volumeMode` | `Filesystem` |
| HPA | `spec.minReplicas` | `1` |
| HPA | `spec.behavior.scaleUp.stabilizationWindowSeconds` / `.selectPolicy` / `.policies[Pods/15].value` / `.policies[Percent/15].value` | `0` / `Max` / `4` / `100` |
| HPA | `spec.behavior.scaleDown.stabilizationWindowSeconds` / `.selectPolicy` / `.policies[Percent/15].value` | `300` / `Max` / `100` |

**관리 필드** (차이가 나는 것이 정상. `managed` + 이유)

| ID | 종류 | 경로 | 조건 | 이유(화면 문구) |
|---|---|---|---|---|
| `HPA_REPLICAS` | Deployment, StatefulSet | `spec.replicas` | 현재 클러스터의 HPA 중 `scaleTargetRef`(kind·name, 같은 네임스페이스)가 이 워크로드인 것이 있음 | "HPA가 관리" |
| `ROLLOUT_RESTART` | 워크로드 | `spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"]` | 항상 | "`kubectl rollout restart` 기록" |
| `PVC_EXPANDED` | PVC | `spec.resources.requests.storage` | 클러스터 값 > 스냅샷 값(수량 비교). 작아졌으면 `changed` | "볼륨 확장" |
| `NODEPORT_AUTO` | Service | `spec.ports[*].nodePort` | 스냅샷에 없음 | "자동 할당" |
| `LB_CLASS_WEBHOOK` | Service | `spec.loadBalancerClass` | 스냅샷에 없고 클러스터 값이 `service.k8s.aws/nlb` | "AWS Load Balancer Controller 웹훅이 설정" |
| `DEFAULT_STORAGE_CLASS` | PVC | `spec.storageClassName` | 스냅샷에 없고 클러스터에 있음 | "기본 StorageClass가 설정" |
| `DEFAULT_INGRESS_CLASS` | Ingress | `spec.ingressClassName` | 스냅샷에 없고 클러스터에 있음 | "기본 IngressClass가 설정" |

- EKS·컨트롤러가 붙이는 레이블·어노테이션을 구현 단계에서 더 확인하면 이 표에 추가하고 변경 이력에 적는다(명세 4.4-5).
- 사용자별 무시 규칙은 없다(명세 7절). 걸러지지 않는 가짜 차이는 스냅샷 파일 편집으로 맞춘다.

### 10.6 값 가림 (명세 4.7, AC-K38)
- 다음 잎의 값은 원문 대신 가린 값으로만 나간다(`MASKED_PATHS` + 스캐너):
  - `**.containers[*].env[*].value`, `**.initContainers[*].env[*].value`, `**.ephemeralContainers[*].env[*].value`
  - `**.containers[*].command`, `**.containers[*].args`(init·ephemeral 포함)
  - 그 밖의 잎이라도 `scanText("<마지막 키>: <값>", "drift", { profile: 'k8s' })`에 **어떤 규칙이든** 걸리면 가림(어노테이션 값 포함)
- 가린 값 = `{ "kind": "masked", "text": "값 다름 (de****(5자))", "preview": "de****(5자)" }`. `preview` = `maskValue(원문)`(앞 2글자 + `****(N자)`, 4자 이하면 `****`), `text` = 화면에 그대로 쓰는 문자열(`값 다름 (<preview>)`). 목록(`command`·`args`)은 공백으로 이은 문자열을 가린다. 양쪽 모두 같은 방식으로 가린다(스냅샷 쪽 원문은 파일 보기에서 볼 수 있다). 한쪽이 없으면 그쪽은 `null`("(없음)").
- 어노테이션·레이블 값은 스캐너에 걸리지 않으면 **가리지 않는다**(ALB 설정 확인에 필요, 명세 4.7). `common.md` 1.4의 "어노테이션·레이블 원문 금지" 예외(16절).
- 가림은 응답을 만들 때가 아니라 **차이를 만드는 단계**에서 적용한다. 서버 메모리의 드리프트 결과에도 원문이 남지 않는다(로그·SSE로 새지 않게).
- 추가됨·삭제됨 리소스는 필드 diff 대신 요약만: 종류·이름·네임스페이스, 컨테이너 이미지 목록, `replicas`(있으면). env·command·args·어노테이션은 없다.

### 10.7 계산 대상과 주기 (명세 4.5)

| 대상 | 계산 | 주기 |
|---|---|---|
| **자동 대상** = 휴지통 밖에서 `cluster.id`가 대시보드 클러스터 ID와 같은 스냅샷 중 ID가 가장 큰 것 1개 | 자동 | 비교 가능 종류의 informer 변경(add·update·delete) → **10초 조절**(마지막 계산 후 10초 안의 변경은 모아서 한 번) → 30초 이내 반영. 변경이 없어도 **5분**마다. 스냅샷 파일 변경(주기 확인·대시보드 저장) 감지 즉시 예약 |
| **임대 중** 스냅샷(10.8) | `POST …/drift`로 요청했을 때 | 임대가 살아 있는 동안 자동 대상과 같은 주기. 임대가 끝나면 멈춤 |
| 그 밖 | 계산 안 함 | 마지막 요약(건수·시각)은 남김(10.9) |

- 자동 대상이 바뀌면(새 스냅샷, 삭제, `cluster.id` 편집 불가이므로 메타 변경 없음) 새 대상을 바로 계산하고 이전 대상의 결과는 "마지막 결과"로 남긴다.
- `metadata.json`이 있어야 `cluster.id`를 알 수 있으므로 내보내는 중인 스냅샷은 자동 대상이 되지 않는다.
- 클러스터 출처가 `stale`이면 다시 계산하지 않고 마지막 결과에 `stale: true`(AC-K40). 회복되면 즉시 다시 계산.
- 클러스터 출처가 `not_configured`/`unavailable`/`syncing`이면 모든 드리프트 `unknown`(AC-K35).
- 계산 비용: 캐시 읽기 + 스냅샷 파일 해석(파일 `version`이 같으면 해석 결과 재사용). 수백 리소스 기준 수십 ms. 계산은 한 번에 하나씩(큐), 같은 스냅샷 요청은 합친다.
- 결과 보관: **메모리만**(DBA 결정). 재시작하면 자동 대상은 최초 동기화 뒤 다시 계산되고, 그 밖은 "계산 안 함"으로 돌아간다. 지난 결과 보관 규칙은 10.9 표.

### 10.8 `POST /api/k8s-snapshots/:id/drift` (계산 요청 + 임대)

"드리프트 계산" 버튼과, 드리프트 화면을 열어 두는 동안의 **임대 갱신**에 같은 엔드포인트를 쓴다. 파일·클러스터에 쓰지 않지만 1.3 보호(Origin·Content-Type)는 같다.

**요청**
```json
{ "force": true }
```
- `force`(선택, 기본 `false`): `true`면 결과가 최신이어도 지금 다시 계산한다(버튼). `false`면 결과가 없거나 오래됐을 때(입력이 바뀜)만 계산하고 임대만 늘린다(화면의 주기적 갱신).
- 임대: 요청 시점부터 **120초**. 화면은 드리프트 탭을 여는 동안 **60초마다** `{ "force": false }`로 다시 보낸다. 화면을 떠나면 갱신이 멈추고 최대 120초 뒤 자동 계산이 멈춘다. 동시에 임대할 수 있는 스냅샷은 5개(넘으면 가장 오래된 임대가 끝남).
- 자동 대상에 보내도 된다(계산이 이미 자동이라 `lease`는 `null`로 준다).
- 계산은 동기로 끝낸 뒤 응답한다(메모리 계산, 10.7).

**응답 200**: 10.9와 같은 모양.

**오류**
| HTTP | code | 언제 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | id·본문 |
| 403 | `ORIGIN_NOT_ALLOWED` | 1.3 |
| 404 | `RESOURCE_NOT_FOUND` | 스냅샷 없음 (`K8sSnapshot`) |
| 409 | `K8S_DRIFT_UNAVAILABLE` | 계산할 수 없음. `details: { reasonCode, reasonText }` — 11.3의 `CLUSTER_NOT_CONNECTED`, `CLUSTER_SYNCING`, `CLUSTER_MISMATCH`, `CLUSTER_ID_MISSING`, `DASHBOARD_CLUSTER_UNKNOWN`, `SNAPSHOT_FILES_PENDING`, `NO_COMPARABLE_RESOURCES`, `DRIFT_RULES_UNAVAILABLE`. 화면은 이 경우 버튼이 이미 비활성(`actions.computeDrift`)이어야 한다 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | |
| 503 | `SOURCE_UNAVAILABLE` | 스냅샷 출처 없음 |

### 10.9 `GET /api/k8s-snapshots/:id/drift` (결과 조회)

계산하지 않는다(부작용 없음). 결과가 없으면 배지만 준다.

```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T06:12:00.000Z",
  "snapshotId": "20260919-061000",
  "drift": { "...": "DriftBadge (mode auto, status warning, counts …)" },
  "lease": null,
  "target": { "clusterId": "7d0c2b1e-…", "context": "prod-eks", "name": "prod-eks", "serverVersion": "v1.34.1", "sourceState": "ok" },
  "snapshotCluster": { "id": "7d0c2b1e-…", "context": "sentinel-snapshot", "name": "prod-eks", "serverVersion": "v1.34.1-eks-8a2c1f0" },
  "rulesVersion": 1,
  "addedCheck": "checked",
  "uncomparable": [
    { "apiGroup": "", "kind": "ConfigMap", "count": 8, "reason": "NOT_IN_RBAC", "text": "대시보드 권한 밖이라 비교하지 않음" },
    { "apiGroup": "networking.k8s.io", "kind": "NetworkPolicy", "count": 1, "reason": "NOT_IN_RBAC", "text": "대시보드 권한 밖이라 비교하지 않음" },
    { "apiGroup": "batch", "kind": "CronJob", "count": 1, "reason": "NOT_IN_RBAC", "text": "대시보드 권한 밖이라 비교하지 않음" },
    { "apiGroup": "batch", "kind": "Job", "count": 1, "reason": "NOT_IN_RBAC", "text": "대시보드 권한 밖이라 비교하지 않음" }
  ],
  "unparsable": [],
  "resources": [
    {
      "key": "apps/Deployment/prod/api",
      "apiGroup": "apps", "apiVersion": "apps/v1", "kind": "Deployment", "namespace": "prod", "name": "api",
      "change": "changed",
      "file": "prod/deployments/api.yaml",
      "fileDocuments": 1,
      "helmManaged": false,
      "counts": { "changed": 3, "default": 9, "managed": 1 },
      "fields": [
        { "path": "spec.template.spec.containers[api].image", "category": "changed", "reason": null,
          "snapshot": { "kind": "scalar", "value": "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.1" },
          "cluster": { "kind": "scalar", "value": "123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2" } },
        { "path": "spec.template.spec.containers[api].resources.limits.memory", "category": "changed", "reason": null,
          "snapshot": { "kind": "scalar", "value": "1Gi" }, "cluster": { "kind": "scalar", "value": "512Mi" } },
        { "path": "spec.template.spec.containers[api].env[LOG_LEVEL].value", "category": "changed", "reason": null, "managedRule": null,
          "snapshot": { "kind": "masked", "text": "값 다름 (de****(5자))", "preview": "de****(5자)" }, "cluster": { "kind": "masked", "text": "값 다름 (****)", "preview": "****" } },
        { "path": "spec.replicas", "category": "managed", "reason": "HPA가 관리", "managedRule": "HPA_REPLICAS",
          "snapshot": { "kind": "scalar", "value": 5 }, "cluster": { "kind": "scalar", "value": 3 } },
        { "path": "spec.template.spec.containers[api].terminationMessagePolicy", "category": "default", "reason": "기본값 File", "managedRule": null,
          "snapshot": null, "cluster": { "kind": "scalar", "value": "File" } }
      ],
      "fieldsTruncated": false,
      "summary": null,
      "commands": {
        "diff": "kubectl diff -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/deployments/api.yaml",
        "apply": "kubectl apply -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/deployments/api.yaml"
      }
    },
    {
      "key": "networking.k8s.io/Ingress/prod/api-public",
      "apiGroup": "networking.k8s.io", "kind": "Ingress", "namespace": "prod", "name": "api-public",
      "change": "deleted", "file": "prod/ingresses/api-public.yaml", "helmManaged": false,
      "counts": { "changed": 0, "default": 0, "managed": 0 }, "fields": [], "fieldsTruncated": false,
      "summary": { "images": [], "replicas": null },
      "commands": { "diff": "kubectl diff -f …/prod/ingresses/api-public.yaml", "apply": "kubectl apply -f …/prod/ingresses/api-public.yaml" }
    },
    {
      "key": "apps/Deployment/prod/payments",
      "apiGroup": "apps", "kind": "Deployment", "namespace": "prod", "name": "payments",
      "change": "added", "file": null, "helmManaged": false,
      "counts": { "changed": 0, "default": 0, "managed": 0 }, "fields": [], "fieldsTruncated": false,
      "summary": { "images": ["123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/payments:0.9.1"], "replicas": 0 },
      "commands": null
    }
  ],
  "commandsNote": "대시보드는 이 명령을 실행하지 않습니다. kubectl diff 는 서버 측 dry-run 이라 적용할 클러스터에 쓰기 권한이 있는 컨텍스트가 필요합니다. 적용 전 kubectl diff 로 확인하세요",
  "notices": []
}
```

```ts
type DiffValue =
  | { kind: 'scalar'; value: string | number | boolean | null }   // 원래 JSON 타입 유지 (8080 과 "8080" 구분). 여러 줄 문자열 가능
  | { kind: 'list'; items: (string | number | boolean | null)[] }  // 스칼라 목록, "순서 다름"
  | { kind: 'masked'; text: string; preview: string };             // 10.6

interface FieldDiff {
  path: string;                                    // 10.4 표기 (서버 순서 = 경로 안 필드 순서, 아래 정렬)
  category: 'changed' | 'default' | 'managed';
  reason: string | null;                           // default: "기본값 <값>" (예 "기본값 File", 조건부 기본값도 값을 보인다 "기본값 IfNotPresent"), managed: 10.5 이유 문구, changed: null (단 순서 차이는 "순서 다름", 10.4)
  managedRule: string | null;                      // managed일 때 10.5 ID
  snapshot: DiffValue | null;                      // null = (없음)
  cluster: DiffValue | null;
}
```
- 차이는 잎 단위라 **객체 조각(YAML 블록)은 보내지 않는다**. 여러 줄로 보일 수 있는 값은 여러 줄 문자열 스칼라와 스칼라 목록뿐이다. 수량은 원문 표기 그대로(`1Gi`, `512Mi`).

| 필드 | 설명 |
|---|---|
| `drift` | 목록과 같은 배지. `computed: false`면 아래 목록은 모두 비어 있다 |
| `lease` | 임대 중이면 `{ "expiresAt": "…", "renewAfterSec": 60 }`, 아니면 `null` |
| `target` | 대시보드가 연결된 클러스터(요약 "비교 대상 클러스터") |
| `addedCheck` | `checked` \| `skipped_scope_unknown`(10.3) \| `null`(전체 결과가 없음: `mode` none, 또는 `last_result`에서 `resultAvailable: false`) |
| `uncomparable` | 종류별 비교 불가 수와 사유(10.2). 드리프트 상태에 영향 없음 |
| `unparsable` | `[{ path, reason: "yaml_error" | "duplicate" | "namespace_missing" | "too_large" }]` — "파일 해석 실패로 비교 못 함 N개" |
| `resources` | `added`·`deleted`·`changed` 전부 + **숨긴 차이만 있는 `same`**(펼쳐 보기용). 차이가 전혀 없는 `same`은 수만(`drift.counts.same`). 정렬: 네임스페이스 → 종류 → 이름(명세 4.7). 필터·검색은 화면 |
| `resources[].fields` | `changed` 리소스와 숨긴 차이가 있는 `same` 리소스만. 리소스당 최대 500건(`fieldsTruncated`). 정렬: `changed` → `managed` → `default`, 같은 분류는 경로순 |
| `resources[].summary` | `added`/`deleted`만. 이미지는 클러스터(추가됨) 또는 스냅샷(삭제됨) 쪽 |
| `resources[].commands` | 스냅샷 파일이 있는 리소스만(`added`는 `null`). 복사용 문자열. 화면이 `file`로 직접 조립해도 된다(경로 기준 `root.displayPath`) |
| `resources[].fileDocuments` | 그 파일 안 문서 수(보통 1). 2 이상이면 명령이 여러 리소스를 적용한다는 안내 |
| `snapshotCluster` | 명령 블록 문구 "대상 클러스터를 확인하세요 (스냅샷: prod-eks · 컨텍스트 sentinel-snapshot)"용 |

**지난 결과 보관 규칙 (디자인 "지난 결과 보기"가 여기에 달림)**

| 경우 | 배지 `mode` | 요약(건수·시각·`lastResultStatus`) | 전체 결과(필드 diff, `resultAvailable`) |
|---|---|---|---|
| 자동 대상 | `auto` | 있음 | 있음 |
| 임대 중(요청 계산, 화면 열림) | `on_demand` | 있음 | 있음 |
| 임대 끝남 0~10분 | `last_result` | 있음 | **있음** → "지난 결과 보기" 가능 |
| 임대 끝남 10분 뒤 | `last_result` | 있음 | 없음 → "지난 결과 보기" 숨김, 목록·요약에는 "지난 결과 차이 3건 · 날짜" |
| 자동 대상이었다가 새 스냅샷에 밀림 | `last_result` | 있음 | 10분 뒤 버림(위와 같음) |
| 스냅샷 파일이 바뀜(편집·외부 변경) | `none` | 지움(원본이 달라져 의미 없음) | 지움 |
| API 재시작 | `none` | 없음 | 없음 (메모리만, DBA 결정) |

- `last_result`의 `GET …/drift`는 `resultAvailable`이면 마지막 전체 결과를 그대로 주고(배지는 `DRIFT_NOT_COMPUTED` + `lastResultStatus`), 아니면 배지만 준다. 화면은 "다시 계산"으로 `POST`를 부른다.
- `computing`: 서버가 그 스냅샷을 다시 계산하는 동안 `true`. 계산이 500ms 안에 끝나면 `computing: true` 이벤트를 따로 보내지 않는다(깜박임 방지). `POST`는 계산을 끝낸 뒤 응답하므로 버튼의 "계산 중"은 요청 대기로 표시한다.
- 결과가 없는 스냅샷(`mode: none`)은 200 + 배지(`DRIFT_NOT_COMPUTED` 또는 계산 불가 사유) + 빈 목록.
- 오류: 400, 404(`K8sSnapshot`), 503 `SOURCE_UNAVAILABLE`(스냅샷 출처 없음). 클러스터 쪽 문제는 오류가 아니라 배지의 unknown.

---

## 11. 상태 이유 코드

### 11.1 파일 상태 (`K8sSnapshotListItem.status`, 명세 5.1)

| code | status | text 예 | 조건 |
|---|---|---|---|
| `SCAN_SECRET_ERRORS` | critical | "비밀값 의심 1건 (k8s-env-literal)" | 현재 스캔 error ≥ 1 (`k8s-secret-object` 포함) |
| `METADATA_CORRUPT` | critical | "metadata.json 손상 (JSON 해석 실패)" | |
| `STRICT_SCAN_WARNINGS` | critical | "strict 스냅샷: 경고 1건" | |
| `SCAN_WARNINGS` | warning | "검토 필요 2건 (k8s-configmap-secretish)" | |
| `METADATA_MISSING` | warning | "metadata.json 없음" | 없음 + 마지막 변경 30분 이상 전 |
| `METADATA_SCHEMA_MISMATCH` | warning | "메타데이터 형식이 다름 (cluster.id 없음)" | 3.2 필수 필드 없음 또는 `schemaVersion ≠ 1` |
| `SNAPSHOT_ID_MISMATCH` | warning | "폴더 이름과 메타데이터 ID 불일치" | |
| `PARTIAL_EXPORT` | warning | "일부 종류를 읽지 못함 (networkpolicies: 권한 없음)" | `metadata.kinds`에 `forbidden`/`not_found`/`error`. 이름은 최대 3개 + "외 N개" |
| `YAML_PARSE_FAILED` | warning | "YAML 해석 실패 2개" / "… (1개는 크기 초과)" | `parse`가 `yaml_error`/`not_object`/`empty`/`too_large`인 리소스 파일 |
| `MULTI_DOCUMENT_FILE` | warning | "한 파일에 여러 리소스 1개" | `parse = multi_document` (저장 전 확인 뒤 저장한 경우, 명세 5.4) |
| `PATH_CONTENT_MISMATCH` | warning | "경로와 내용 불일치 1개" | `pathMatches: false` |
| `DUPLICATE_RESOURCE` | warning | "중복 정의 1개" | |
| `RUNTIME_FIELDS_LEFT` | warning | "런타임 필드 남음 3개 파일" | `runtimeFields`가 있는 파일 |
| `RESOURCES_ZERO` | warning | "리소스 0개" | 리소스 파일(`namespace.yaml` 포함) 0개 |
| `UNEXPECTED_FILES` | warning | "예상 밖 파일 2개 (prod/notes.txt, .env)" / "… (링크 1개, 따라가지 않음)" | |
| `NOTES_CORRUPT` | warning | "notes.json 손상 (라벨·메모를 읽을 수 없음)" | |
| `FILE_UNREADABLE` | unknown | "파일을 읽을 수 없음 (prod/deployments/api.yaml: EACCES)" | |
| `EXPORT_MAYBE_IN_PROGRESS` | unknown | "내보내기 진행 중일 수 있음" | ASM-API 10.1과 같은 규칙(주의 사유는 빼고 장애 사유와 이것만) |

- `reasons` 정렬·`updatedAt`·`statusChangedAt`·"마지막 변경" 정의는 ASM-API 10.1과 같다.
- **드리프트는 이 표에 없다**(두 축, 명세 4.6·5.1).

### 11.2 목록 요약 (`summary.status`)
ASM-API 10.2와 같은 코드(`SNAPSHOTS_COMMIT_BLOCKED`, `SNAPSHOTS_NEED_REVIEW`, `SNAPSHOTS_UNKNOWN`, `SOURCE_NOT_CONFIGURED`, `SOURCE_UNAVAILABLE`, `SOURCE_STALE`). 문구의 환경 변수·경로만 `K8S_SNAPSHOT_DIR`, `deploy/k8s-snapshot/snapshots`, 스캐너 문구에 "(AWS_SNAPSHOT_LIB_DIR)" 또는 "k8s 규칙 lib를 불러올 수 없습니다 (K8S_SNAPSHOT_LIB_DIR)".

### 11.3 드리프트 (`DriftBadge.status.reasons`, `DriftAbility.reasonCode`, 명세 4.6)

| code | status | text 예 | 조건 | 계산 버튼 |
|---|---|---|---|---|
| `DRIFT_NO_DIFF` | ok | "차이 없음 (비교 42개, 비교 불가 11개)" | 보이는 추가·삭제·변경 0 | 가능 |
| `DRIFT_DIFF` | warning | "차이 3건 (변경 1 · 삭제 1 · 추가 1)" | 1건 이상. 0인 구분은 문구에서 뺀다 | 가능 |
| `DRIFT_NOT_COMPUTED` | unknown | "계산 안 함" | 자동 대상이 아니고 결과 없음. 화면은 배지 대신 회색 문구(디자인) | 가능 |
| `CLUSTER_NOT_CONNECTED` | unknown | "클러스터 연결 없음" | `kube`가 `not_configured`/`unavailable` | 불가 |
| `CLUSTER_SYNCING` | unknown | "클러스터 동기화 중" | `kube`가 `syncing` 또는 비교 가능 informer 미동기화 | 불가 |
| `DASHBOARD_CLUSTER_UNKNOWN` | unknown | "대시보드 클러스터를 확인할 수 없음 (namespaces 조회 불가)" | `kube-system` UID를 모름 | 불가 |
| `CLUSTER_MISMATCH` | unknown | "다른 클러스터의 스냅샷 (staging-eks)" | `cluster.id` 다름. 괄호 안은 `cluster.name` → 없으면 `cluster.context` | 불가 |
| `CLUSTER_ID_MISSING` | unknown | "클러스터를 확인할 수 없음" | 메타 없음·손상·`cluster.id` 없음 (Q4) | 불가 |
| `SNAPSHOT_FILES_PENDING` | unknown | "스냅샷 파일 확인 전" | 파일 상태 unknown(진행 중·읽기 실패) | 불가 |
| `NO_COMPARABLE_RESOURCES` | unknown | "비교할 수 있는 리소스 없음" | 비교 가능 리소스 0 (해석 실패로 0이 된 경우 포함) | 불가 |
| `DRIFT_RULES_UNAVAILABLE` | unknown | "드리프트 규칙을 불러올 수 없음" | k8s lib 로드 실패 | 불가 |
| `DRIFT_FAILED` | unknown | "드리프트 계산 실패 (다시 시도하세요)" | 예기치 않은 계산 오류(로그는 코드만) | 가능 |

- stale(`kube` stale)은 코드가 아니라 `status.stale = true`(값 유지, AC-K40).
- `CLUSTER_MISMATCH`/`CLUSTER_ID_MISSING`/`CLUSTER_NOT_CONNECTED`는 클러스터 판단이 파일 판단보다 먼저다. 순서: 규칙 lib → 클러스터 연결 → 대시보드 ID → (**내보내기 진행 중**이면 `SNAPSHOT_FILES_PENDING` — 메타데이터가 아직 없어 ID를 판단할 수 없으므로, 14.2 예시 8) → 스냅샷 ID(없음·메타 손상 → `CLUSTER_ID_MISSING`, 다름 → `CLUSTER_MISMATCH`) → 파일 확인 전(파일 상태 unknown) → 비교 가능 0 → 결과.
- **드리프트에는 critical이 없다**(명세 4.6).

### 11.4 정보 문구 (`notices[].code`, 상태 영향 없음)
`DATA_NOT_INCLUDED`(상세 항상, 명세 3.9 + DBA 보강 문구), `HELM_MANAGED`("Helm 관리 리소스 N개 — Helm 으로 복원 권장"), `SYSTEM_NAMESPACES_INCLUDED`("시스템 네임스페이스 포함: kube-system"), `MISSING_NAMESPACES`("내보낼 때 없던 네임스페이스: staging"), `RESOURCES_CHANGED_SINCE_EXPORT`("내보내기 후 변경됨: 35 → 34"), `SECRET_REFS_MISSING`/`SECRET_REFS_CORRUPT`("secret-refs.json 없음 — 복원에 필요한 Secret 목록을 알 수 없음"), `CLEANUP_RULES_NEWER`(드리프트: "스냅샷 정리 규칙 버전 2 를 모름, 최신 규칙 1 로 비교"), `ADDED_NOT_CHECKED`(드리프트, 10.3), `STRICT_EXPORT`("strict 로 내보냄").

---

## 12. 스냅샷 메뉴 합산 (명세 5.5, AC-K16, ASM AC-21 변경분)

기존 `/api/aws-snapshots/summary`·토픽 `aws-snapshots`는 그대로 두고, 메뉴·탭 배지 전용 엔드포인트와 토픽을 새로 둔다. 서버가 합산하고 화면은 다시 계산하지 않는다(`common.md` 2.2).

### 12.1 `GET /api/snapshot-menu`

```json
{
  "dataSource": "live",
  "generatedAt": "2026-09-19T06:12:00.000Z",
  "menu": {
    "status": {
      "status": "critical",
      "reasons": [ { "code": "SNAPSHOTS_COMMIT_BLOCKED", "text": "커밋 금지 스냅샷 3개 (AWS 2 · Kubernetes 1)", "status": "critical" } ],
      "updatedAt": "…", "statusChangedAt": "…", "stale": false
    },
    "count": 3,
    "showIcon": true
  },
  "tabs": {
    "aws": { "included": true, "sourceState": "ok", "status": { "...": "aws summary.status 그대로" }, "critical": 2 },
    "k8s": {
      "included": true, "sourceState": "ok", "status": { "...": "k8s summary.status 그대로" }, "critical": 1,
      "latestDrift": { "snapshotId": "20260919-061000", "drift": { "...": "DriftBadge" } }
    }
  }
}
```

| 규칙 | 내용 |
|---|---|
| `tabs.*.included` | 그 출처 상태가 `not_configured`가 **아니면** `true` |
| `menu.status` | 포함된 쪽 `summary.status` 중 최악(`critical > warning > unknown > ok`). 사유는 합쳐서 다시 만든다: 커밋 금지 합계, 주의 합계, 알 수 없음 합계, 출처 문제(`SOURCE_UNAVAILABLE`는 "Kubernetes 스냅샷 폴더를 찾을 수 없습니다"처럼 쪽 이름을 붙임). `stale` = 포함된 쪽 중 하나라도 stale |
| `menu.count` | 포함된 쪽 `counts.critical` 합(0이면 화면이 숨김) |
| `menu.showIcon` | 둘 다 `not_configured`면 `false`(아이콘·숫자 없음, ASM-API 6.1 설정 없음 규칙). 이때 `status`는 unknown + `SOURCE_NOT_CONFIGURED` |
| **드리프트** | `menu`에 넣지 않는다(Q2). `tabs.k8s.latestDrift`는 탭 옆 "드리프트 N건" 표시용 |
| 개요 | `/api/overview`·클러스터 전체 상태에 넣지 않는다 |

- 오류 없음(항상 200). mock: `dataSource: "mock"`, 두 mock 그룹의 현재 시나리오를 반영.

### 12.2 SSE 토픽 `snapshot-menu`
| 이벤트 | 언제 | payload |
|---|---|---|
| `snapshot-menu.snapshot` | 연결 직후, mock 시나리오 변경·reset 후 | `{ "menu": …, "tabs": … }` (12.1에서 `dataSource`·`generatedAt` 뺀 것) |
| `snapshot-menu.updated` | AWS 또는 k8s 요약이 바뀌었을 때, k8s 자동 대상 드리프트 배지가 바뀌었을 때. **1초 debounce** | 같음 |

- 앱 레이아웃의 스트림이 `snapshot-menu`를 구독하면 사이드바가 모든 페이지에서 갱신된다. 사이드바는 더 이상 `aws-snapshots.summary`로 메뉴를 그리지 않는다(프론트 변경). `aws-snapshots` 토픽 자체는 그대로 남는다(AWS 탭 화면이 계속 쓴다).
- 라벨·메모·파일 내용·필드 값 없음.

---

## 13. SSE 토픽 `k8s-snapshots`

봉투·heartbeat·재연결은 `common.md` 5절. ASM-API 11절과 같은 원칙: **행 데이터·라벨·메모·파일 내용·드리프트 필드 값을 싣지 않는다.**

| 이벤트 | 언제 | payload |
|---|---|---|
| `k8s-snapshots.snapshot` | 연결 직후, mock 시나리오 변경·reset 후, 출처 회복 후 | `{ "revision": 17, "summary": <6.1 summary> }` |
| `k8s-snapshots.changed` | 스냅샷 추가·삭제·파일 변경 감지, 대시보드 쓰기 직후, 휴지통 변경, 출처 상태 변화. **1초 debounce** | `{ "revision", "changedIds", "removedIds", "trashChanged", "summary" }` (ASM-API 11절과 같은 모양) |
| `k8s-snapshots.drift` | 드리프트 배지가 바뀜(상태·건수·stale·모드), 자동 대상이 바뀜, 5분 주기 재계산 완료. 같은 스냅샷은 **1초 debounce** | 아래 |

```json
{
  "snapshotId": "20260919-061000",
  "trigger": "cluster_changed",
  "drift": {
    "status": { "status": "warning", "reasons": [ { "code": "DRIFT_DIFF", "text": "차이 3건 (변경 1 · 삭제 1 · 추가 1)", "status": "warning" } ], "updatedAt": "…", "statusChangedAt": "…", "stale": false },
    "mode": "auto", "computing": false, "computed": true, "computedAt": "2026-09-19T06:11:40.000Z", "lastResultStatus": "warning",
    "counts": { "compared": 24, "same": 21, "added": 1, "deleted": 1, "changed": 1, "hidden": { "default": 14, "managed": 1 }, "uncomparable": 11, "unparsable": 0 },
    "resultAvailable": true
  },
  "autoTargetId": "20260919-061000"
}
```
- `computing: true`인 이벤트는 계산이 500ms를 넘길 때만 먼저 보내고, 끝나면 결과 이벤트(`computing: false`)를 보낸다(10.9).

| 필드 | 설명 |
|---|---|
| `trigger` | `cluster_changed` \| `file_changed` \| `periodic` \| `requested` \| `source_changed` \| `target_changed` \| `lease_expired` |
| `drift` | `DriftBadge`. **필드 값·리소스 이름 없음**(건수와 상태 문구만, AC-K38). `CLUSTER_MISMATCH` 문구의 클러스터 이름은 메타데이터 값이지 필드 값이 아니다 |
| `autoTargetId` | 현재 자동 대상(없으면 `null`) |

- 화면: 목록이면 해당 행의 드리프트 배지를 이 값으로 교체(목록 다시 조회 불필요). 드리프트 탭이 이 스냅샷을 보고 있으면 `GET …/drift`로 다시 조회.
- 출처 매핑: 파일 값 ↔ `k8sSnapshotStore`, 드리프트 값 ↔ `kube`. `stream.source`로 `kube`가 stale이 되면 화면은 드리프트 배지를 stale로 보인다(`common.md` 5.7). 서버도 배지의 `stale`을 `true`로 바꾸고 `k8s-snapshots.drift`(`trigger: source_changed`)를 보낸다.
- 반영 시간: 클러스터 변경 → 조절 10초 + 계산 + debounce 1초 → **30초 이내**(AC-K28). 파일 외부 변경 → 주기 10초 + 계산 → 30초 이내(AC-K37).

---

## 14. mock 모드 (`DATA_SOURCE=mock`, 명세 5.7, AC-K41~K44)

### 14.1 원칙
- 예시 스냅샷은 **메모리**에만. 편집·라벨·삭제·휴지통은 메모리에서만, `deploy/k8s-snapshot/snapshots/`는 읽지도 쓰지도 않는다(`K8S_SNAPSHOT_DIR`가 있어도 무시, AC-K42). 재시작·`POST /api/mock/reset`으로 처음 예시.
- 스캔은 실제 `scan.mjs`(`profile: 'k8s'`), 정리·기본값·관리 필드는 실제 `rules.mjs`, 드리프트는 **실제 드리프트 엔진**으로 계산한다(mock 전용 결과를 손으로 만들지 않음).
- 출처 `k8sSnapshotStore` state `mock`, 응답 `dataSource: "mock"`. 1.3 보호·버전·충돌·422는 live와 같게.
- 예시 비밀값은 누가 봐도 가짜인 값만(`example-password`, `AKIAIOSFODNN7EXAMPLE`).

### 14.2 기본 예시 (시나리오 `default`, 최신순)
mock 대시보드 클러스터: `id = "7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e"`, 이름 `prod-eks`, 버전 `v1.34.1`(cluster mock `info`와 같음). 다른 클러스터 예시: `id = "c3a9e0f2-5b6d-4e7f-8a9b-0c1d2e3f4a5b"`, `staging-eks`.

| ID | 명세 5.7 번호 | 파일 상태 | 드리프트 |
|---|---|---|---|
| `20260919-064500` | 8. `metadata.json` 없음, 마지막 변경 = **항상 서버 시각 − 5분** | unknown (`EXPORT_MAYBE_IN_PROGRESS`) | unknown `SNAPSHOT_FILES_PENDING` (자동 대상 아님: 메타 없음) |
| `20260919-061000` | 1. prod-eks 최신, 발견 없음 | ok | **자동 대상**, warning "차이 3건 (변경 1 · 삭제 1 · 추가 1)" (14.3) |
| `20260919-020000` | 9. staging-eks, 발견 없음 | ok | unknown `CLUSTER_MISMATCH` "다른 클러스터의 스냅샷 (staging-eks)" |
| `20260918-230000` | 3. `data/statefulsets/postgres.yaml`의 `POSTGRES_PASSWORD` `value: example-password` | critical (`k8s-env-literal`) | `DRIFT_NOT_COMPUTED` |
| `20260918-120000` | 4. `prod/secrets/…` 가 아니라 `prod/configmaps/legacy-creds.yaml`에 `kind: Secret` + `stringData` (경로 불일치도 함께) | critical (`k8s-secret-object`) + warning(경로 불일치) | `DRIFT_NOT_COMPUTED` |
| `20260917-090000` | 6. `metadata.kinds.networkpolicies.result = forbidden` | warning (`PARTIAL_EXPORT`) | `DRIFT_NOT_COMPUTED` |
| `20260916-150000` | 5. `metadata.json` 손상 | critical (`METADATA_CORRUPT`) | unknown `CLUSTER_ID_MISSING` |
| `20260915-101010` | 7. `prod/deployments/web.yaml` YAML 구문 오류 + `data/services/pg.yaml`(내용은 `postgres`) 경로 불일치 + 예상 밖 파일 `prod/notes.txt`, `.env` | warning | `DRIFT_NOT_COMPUTED` |
| `20260912-020000` | 10. 라벨 "EKS 1.34 업그레이드 전"·메모, `prod/deployments/web.yaml` 대시보드 편집(`modifiedByDashboard: true`), Helm 관리 리소스 2개(`monitoring/grafana` Deployment·Service) | ok (정보 `HELM_MANAGED`) | `DRIFT_NOT_COMPUTED` |
| `20260910-000000` | 2. prod-eks, 발견 없음, 클러스터와 같은 내용 | ok | mock 시작·reset 때 한 번 계산해 둔 **지난 결과** "차이 없음" (`mode: last_result`, `lastResultStatus: ok`, `resultAvailable: true`). "지난 결과 보기"·"다시 계산"을 mock에서 확인할 수 있게 **mock에서는 이 전체 결과를 10분 뒤에도 버리지 않는다**(reset까지 유지) |

- 휴지통 1개: `20260901-000000__20260910T010203000Z`(prod-eks, 복원 가능).
- 5.7의 "최소 1개씩" 항목을 모두 기본 시나리오에서 동시에 보인다(AC-K41).

### 14.3 mock 클러스터 쪽 값과 예시 드리프트 (AC-K44)
- **mock `ClusterObjectSource`**는 `cluster` mock 그룹의 **현재 인벤토리**(`MockClusterService`의 워크로드·서비스·인그레스·PVC·PDB·HPA·네임스페이스)를 쿠버네티스 원본 모양 객체로 만든다(고정 템플릿 + 인벤토리 값: 이미지, requests/limits, replicas, 서비스 타입, 인그레스 클래스, PVC 크기·StorageClass, HPA 대상). 서버 기본값 필드(10.5 기본값 표)를 채워 실제 API 서버처럼 만든다. 인벤토리에 없는 값(env 등)은 템플릿 고정값.
- **예시 스냅샷 파일**은 mock reset 때 같은 인벤토리(기본 시나리오 `mixed`)를 **CLI와 같은 정리 규칙**으로 정리해 YAML로 만든다. 그다음 예시 1(`20260919-061000`)에만 아래 변경을 가한다:

| 변경 | 결과 분류 |
|---|---|
| `prod/deployments/api.yaml` `containers[api].image` 태그 `1.4.2` → `1.4.1` | changed (클러스터 `1.4.2` = 클러스터 화면 값) |
| 같은 파일 `containers[api].resources.limits.memory` `512Mi` → `1Gi` | changed (클러스터 `512Mi` = 클러스터 화면 값) |
| 같은 파일 `containers[api].env[LOG_LEVEL].value` `info` → `debug` | changed, **가린 값** |
| 같은 파일 `spec.replicas` `3` → `5` | managed `HPA_REPLICAS` (mock HPA `prod/api`가 대상) |
| 같은 파일 `terminationMessagePath`·`terminationMessagePolicy`·`imagePullPolicy`, `prod/services/web.yaml` `sessionAffinity` 등 기본값 필드 삭제 | default (숨김) |
| `prod/ingresses/api-public.yaml` 추가(클러스터에 없음) | deleted |
| `prod/deployments/payments.yaml` 삭제(클러스터에 있음, replicas 0) | added |
| `prod/configmaps/api-config.yaml`, `data/configmaps/postgres-config.yaml`, `prod/networkpolicies/default-deny.yaml`, `batch/cronjobs/nightly-report.yaml`, `batch/jobs/report-backfill.yaml` | uncomparable `NOT_IN_RBAC` (**5건**) |

- **대시보드 RBAC 밖 종류의 예시 파일**(인벤토리에 없으므로 픽스처에 직접 쓴다, 모든 예시 공통): ConfigMap `prod/api-config`·`data/postgres-config`, NetworkPolicy `prod/default-deny`, CronJob `batch/nightly-report`, **Job `batch/report-backfill`**(2026-09-20 추가). 모두 `NOT_IN_RBAC`이라 드리프트 건수(변경 1·삭제 1·추가 1)에 영향이 없다.
  - Job은 **소유자(`ownerReferences`) 없는 독립 Job**이다. CronJob이 만든 Job은 CLI `isAlwaysExcluded`로 빠지므로 내보내기 대상이 아니다(3.7). 3D 블록 모양(`docs/design/snapshot-3d.md` 4.11.2 `chamfer`) 회귀 점검용으로 넣었다.
  - `jobs`는 3.5 표에서 tier **선택**이므로 예시 `metadata.json`의 `scope.kinds.optional`은 `["jobs"]`이고 `kinds.jobs`가 `result: "ok", exported: 1`로 들어간다.
- 그래서 드리프트의 클러스터 쪽 값(이미지·limits·replicas·존재 여부)은 **같은 mock 모드의 클러스터 화면 값과 같다**. `cluster` 시나리오를 바꾸면 인벤토리가 바뀌므로 드리프트도 그에 맞게 다시 계산된다(예: `healthy`에서는 `batch/scratch` PVC가 없어 "삭제됨"이 하나 늘어난다). 이것은 의도된 동작이다(두 화면이 모순되지 않음).
- mock `kube` 출처는 cluster 그룹 시나리오를 따른다: `no-cluster` → 드리프트 전체 `CLUSTER_NOT_CONNECTED`, `kube-stale` → 드리프트 stale 표시. k8s-snapshots 그룹의 `cluster-disconnected`는 cluster 그룹과 관계없이 드리프트만 연결 없음으로 만든다.

### 14.4 mock 시나리오 그룹 `k8s-snapshots`
`common.md` 6.1 표에 추가. 라벨 "Kubernetes 스냅샷", Popover에서 `snapshots`(AWS 스냅샷) 다음.
- **그룹 키는 `k8s-snapshots`**(디자인 제안 `k8sSnapshots` 대신 경로·토픽과 같은 kebab-case. 기존 그룹 키는 모두 소문자이고 camelCase가 없다).
- **드리프트 시나리오를 별도 그룹으로 나누지 않는다.** 한 그룹 안에서 `cluster-disconnected`·`no-drift`는 기본 예시 위에 드리프트 상황만 바꾼 것이라, 파일 쪽 시나리오(`read-only` 등)와 동시에 볼 필요가 없다. 디자인의 "Kubernetes 드리프트" 그룹 표시 이름은 쓰지 않는다.

| id | 재현 내용 |
|---|---|
| `default` (기본) | 14.2의 10개 + 휴지통 1개 |
| `empty` | 스냅샷 0개·휴지통 0개 → 빈 상태 + CLI 안내 |
| `not-configured` | `k8sSnapshotStore` `not_configured` (메뉴 계산에서 k8s 쪽 제외 재현) |
| `unavailable` | 폴더 없음 |
| `read-only` / `write-disabled` | 기본 예시 + 쓰기 불가 |
| `conflict-once` | 다음 저장(파일 또는 라벨) 한 번 409 후 `default`로 자동 복귀 |
| `cluster-disconnected` | 기본 예시 + 드리프트 쪽 클러스터 연결 없음(모든 드리프트 `CLUSTER_NOT_CONNECTED`, 계산 버튼 비활성) |
| `no-drift` | 기본 예시에서 예시 1의 변경을 빼 **최신 스냅샷 드리프트 "차이 없음"** |

- 시나리오를 바꾸면 `k8s-snapshots.snapshot`, `snapshot-menu.snapshot`을 다시 보내고, 드리프트를 다시 계산해 `k8s-snapshots.drift`를 보낸다. 메모리의 편집 내용은 유지(`reset`만 원상태).

---

## 15. 설정·환경 변수 (api, `.env.example`)

| 이름 | 기본 | 설명 |
|---|---|---|
| `K8S_SNAPSHOT_DIR` | (없음) | k8s 스냅샷 루트. **비우면 live에서 `not_configured`**. Docker 없이: `../../deploy/k8s-snapshot/snapshots`. compose: `/data/k8s-snapshots`. EKS(`deploy/app.example.yaml`): 넣지 않음 |
| `K8S_SNAPSHOT_LIB_DIR` | `../../deploy/k8s-snapshot/lib` (작업 폴더 기준) | k8s 규칙 lib(2.2). compose: `/opt/k8s-snapshot/lib` |
| `AWS_SNAPSHOT_LIB_DIR` | (기존) | 스캐너 `scan.mjs` 위치. k8s도 이 값으로 스캐너를 불러온다(규칙 한 벌) |
| `K8S_SNAPSHOT_WRITE_ENABLED` | `true` | 쓰기 스위치 |
| `K8S_SNAPSHOT_IN_PROGRESS_MIN` | `30` | |
| `K8S_SNAPSHOT_EDIT_MAX_BYTES` | `5242880` | |
| `K8S_SNAPSHOT_VIEW_MAX_BYTES` | `20971520` | 최소 20 MB |
| `K8S_SNAPSHOT_POLL_INTERVAL_SEC` | `10` | 5~25 |
| `K8S_SNAPSHOT_DISPLAY_PATH` | (없음) | 화면·명령 예시에 쓸 경로(`deploy/k8s-snapshot/snapshots`) |
| `K8S_SNAPSHOT_HOST_DIR` | `./deploy/k8s-snapshot/snapshots` | compose 전용 |
| `K8S_DRIFT_THROTTLE_SEC` | `10` | 클러스터 변경 후 재계산 조절(5~20) |
| `K8S_DRIFT_RECOMPUTE_SEC` | `300` | 변경 없을 때 재계산 주기(60~900) |

- 대시보드 자체 DB `settings`에는 넣지 않는다.

---

## 16. 명세·공통 규약과 다르게 정한 점 (이 문서)

1. **스캐너 규칙 적용 범위를 프로필로 나눔** — 명세 3.7 "같은 규칙 원본에 더한다"는 지키되(같은 `scan.mjs`), k8s 규칙은 `profile: 'k8s'`에서만 돈다. 이유: 기존 AWS 스냅샷 스캔 결과가 바뀌면 안 된다(명세 8절 "aws-snapshot CLI·대시보드 결과가 바뀌지 않게", AC-K19). 공통 규칙은 k8s에도 그대로 적용된다.
2. **`k8s-configmap-secretish`는 같은 줄에 `secret-key-value`가 있으면 내지 않음** — ConfigMap `DB_PASSWORD: real-value` 한 줄에 오류와 경고가 겹쳐 나오는 잡음을 없앤다. 값이 비었거나 자리표시자일 때만 경고가 난다.
3. **CLI는 임시 폴더에 쓰고 마지막에 이름 변경** — 명세 5.1의 "내보내기 진행 중일 수 있음"은 이 CLI 결과에서는 거의 나오지 않는다(손으로 만든 폴더·중단된 결과에만). 대시보드 판단 규칙은 명세 그대로 유지한다. 종료코드 99(예기치 않은 오류)를 aws-snapshot처럼 둔다.
4. **파일 지정은 `path` 쿼리 문자열** — 명세 5.4 "상대 경로 또는 식별값, 방식은 백엔드". 서버 목록(`files[].path`)의 값만 쓰고, 정규식·`lstat`·`realpath`로 거부한다.
5. **파일 이름 인코딩(`~XX`)과 Windows 예약 이름 처리** — 명세 3.8 "이름 그대로(DNS-1123이라 안전)"는 RBAC 이름(`:`·대문자 허용)에서 틀리다. 안전하지 않은 이름만 인코딩한다.
6. **`notes.json`의 파일 저장 기록 키 `fileEdits`** — ASM `templateEdits`(종류 4개 고정) 대신 경로 키. 같은 파일·나머지 형식은 ASM과 같다.
7. **`secret-refs.json` 없음·손상은 정보 문구만** — 명세 5.1 표에 없어 상태 사유로 넣지 않았다.
8. **apiVersion이 다른 리소스는 비교 불가(`API_VERSION_MISMATCH`)** — 명세 4.2에 없는 사유. HPA v1/v2처럼 필드 모양이 달라 가짜 차이가 나기 때문이다. CLI는 대시보드와 같은 버전으로 내보내므로 손으로 고친 파일에서만 나온다.
9. **대시보드가 자기 클러스터 ID를 모르면 알 수 없음(`DASHBOARD_CLUSTER_UNKNOWN`), informer 미동기화면 `CLUSTER_SYNCING`** — 명세 4.6 "클러스터 연결 없음"을 세분했다.
10. **요청 계산은 임대(120초, 60초마다 갱신)로 유지** — 명세 4.5 "화면을 떠나면 자동 계산 중지"를 "갱신이 멈추면 최대 120초 뒤 중지"로 구현한다(브라우저 종료·탭 닫힘을 서버가 알 방법이 없으므로).
11. **비자동 스냅샷 결과 보관** — 전체 결과는 임대 종료 10분 뒤 버리고 요약만 남김(`mode: last_result`). 파일이 바뀌면 요약도 지움. 재시작하면 모두 "계산 안 함"(DBA 결정: 메모리만). mock 예시 2는 "지난 결과 보기" 확인용으로 reset까지 전체 결과를 유지한다(14.2).
12. **드리프트 목록에 "숨긴 차이만 있는 같음" 리소스 포함** — 명세 4.4-6 "펼쳐 볼 수 있다"를 위해. 건수·상태에는 들어가지 않는다.
13. **메뉴 합산용 새 엔드포인트·토픽 `snapshot-menu`** — 명세 5.5 합산을 서버가 한다. 기존 `aws-snapshots` 응답에 필드를 더하지 않는다(AC-K19 "바뀌지 않고"). 사이드바는 새 토픽으로 옮긴다.
14. **informer 최초 목록을 원본 JSON으로 바꿈** — `cluster-status` 내부 구현 변경(응답 모양 불변). 10.1.
15. **드리프트 요청이 불가능하면 409 `K8S_DRIFT_UNAVAILABLE`** — 배지와 같은 사유 코드를 `details`로.
16. **`common.md` 1.4 예외** — ① 파일 보기 응답은 스냅샷 파일 원문(env·어노테이션 포함)을 준다(ASM과 같은 예외, 로컬 파일). ② 드리프트 응답은 클러스터 객체의 **레이블·어노테이션 값과 spec 잎 값**을 준다(명세 4.7). env value·command·args·스캐너에 걸리는 값은 가린다. 쿠버네티스 원본 객체를 통째로 주지는 않는다(잎 단위 차이만).
17. **`k8s-snapshots.drift` 이벤트** — `common.md` 5.3 "`<topic>.<entity>.<action>`" 규칙 대신 짧은 이름. 배지 한 개 교체용.
18. **mock 드리프트는 실제 엔진 계산** — 명세 5.7 "예시 드리프트"를 고정 응답이 아니라 mock 인벤토리 + 예시 파일로 계산한다. 그래서 cluster 시나리오에 따라 결과가 바뀐다(AC-K44를 구조적으로 지킴).
19. **목록 `cluster` 필터는 관계(`same`/`other`/`unknown`)** — 명세 5.2 "필터: 클러스터"를 디자인 결정(연결된 클러스터 / 다른 클러스터 / 확인할 수 없음)대로. 클러스터 이름별 필터는 없다.
20. **mock 그룹 하나(`k8s-snapshots`)에 드리프트 시나리오 포함** — 디자인이 열어 둔 "별도 그룹" 선택지는 쓰지 않는다(14.4).

---

## 17. 구현 메모 (5단계 backend가 할 일)

- **api 모듈** `apps/api/src/k8s-snapshots/**`: ASM 모듈 구조를 따른다(백엔드 인터페이스 fs/memory, 분석기, 컨트롤러, 가드). ~~ASM과 공유할 수 있는 코드는 `apps/api/src/common/snapshot-files/`로 옮긴다~~ → **구현: 옮기지 않고 k8s 모듈이 ASM 파일(`aws-snapshots/{backend,text-utils,analyzer(parseNotes),snapshot.constants,write.guard}.ts`)을 직접 import 한다.** ASM 코드를 한 줄도 바꾸지 않아 회귀 위험이 없다(20절). `PrismaService` 비의존.
  - 구현 파일: `k8s-snapshots.{module,controller,service}.ts`, `dto.ts`, `k8s-analyzer.ts`, `k8s-backend.ts`(fs/memory), `k8s-libs.ts`(lib 동적 import), `k8s-mock-fixtures.ts`, `drift/{comparable-kinds,cluster-object-source,mock-cluster-objects,drift-engine,drift.service}.ts`, 메뉴 합산 `apps/api/src/snapshot-menu/**`.
  - `drift/`: `comparable-kinds.ts`(+ RBAC 일치 테스트), `cluster-object-source.ts`(live: informer 캐시, mock: 인벤토리), `drift-engine.ts`(10.4~10.6, 순수 함수 + 테스트), `drift.service.ts`(10.7 스케줄·임대·보관).
  - 출처 `k8sSnapshotStore` 등록, health `checks.k8sSnapshotStore`, 토픽 `k8s-snapshots`·`snapshot-menu`, mock 그룹 `k8s-snapshots`.
  - `snapshot-menu`: AWS·k8s 요약 제공자를 받아 합산하는 작은 서비스(ASM 모듈에는 요약 변경 알림 훅만 추가, 응답 불변).
- **`KubeWatcherService`**: informer 목록 함수를 원본 JSON 목록으로 교체(10.1). `ClusterObjectSource`용으로 informer별 `list()`·`forbidden`·`synced` 읽기 전용 접근자와 변경 알림 추가. 기존 테스트·응답 불변.
- **`main.ts`**: `/api/k8s-snapshots/:id/file`(PUT)·`/file/check`(POST)에 큰 JSON 파서(7.1). CORS `DELETE`는 이미 있음.
- **`deploy/aws-snapshot/lib/scan.mjs`**: `scanText(text, file, { profile })`, `scanPaths(paths, { profile })`, `listRules({ profile })`, k8s 규칙 5개, `SAFE_VALUE_RES`에 `$(NAME)` 추가는 **k8s 프로필에서만** 적용(AWS 결과 불변). 폴더 순회에서 `.trash`와 함께 `.*.partial`(k8s CLI 임시 폴더)도 건너뛴다. 기존 테스트 + k8s 규칙 테스트.
- **`deploy/k8s-snapshot/`**: 4절 전부(CLI, lib, rbac, README, `.env.example`, `.gitignore`, 테스트, `snapshots/.gitkeep`).
- **docker-compose.yml (api)**: 볼륨 `${K8S_SNAPSHOT_HOST_DIR:-./deploy/k8s-snapshot/snapshots}:/data/k8s-snapshots`(**쓰기 가능, `snapshots/`만**), `./deploy/k8s-snapshot/lib:/opt/k8s-snapshot/lib:ro`. 환경 변수 `K8S_SNAPSHOT_DIR: /data/k8s-snapshots`, `K8S_SNAPSHOT_LIB_DIR: /opt/k8s-snapshot/lib`, `K8S_SNAPSHOT_DISPLAY_PATH: deploy/k8s-snapshot/snapshots`, 나머지는 `${…:-}`. `deploy/k8s-snapshot` 전체를 마운트하지 않는다(`.env` 비노출, AC-K26). 호스트 폴더가 없으면 Docker가 빈 폴더를 만들 수 있다 → `snapshots/.gitkeep`을 커밋해 폴더가 항상 있게 한다.
- **`.env.example` (루트/api)**: 15절 변수.
- **`deploy/app.example.yaml`**: 넣지 않는다(EKS → `not_configured`).
- **`deploy/aws-snapshot/README.md` 8장**: "쿠버네티스 리소스" 행을 "`deploy/k8s-snapshot`으로 내보냄(대시보드 자신의 매니페스트만 `deploy/`)"으로, Postgres 행에 DBA 보강(전역 객체 `pg_dumpall --globals-only`, PowerShell `>` 금지, 볼륨 스냅샷 복원 순서) 반영.
- **`deploy/rbac.yaml`**: **바꾸지 않는다**(AC-K33).
- 로그·오류·SSE에 파일 내용·라벨·메모·드리프트 값 금지(1.4). 드리프트 엔진 단위 테스트에 "결과 JSON에 가림 대상 원문이 없다" 검사를 넣는다(AC-K38).

---

## 18. 수용 기준 ↔ 계약 매핑

| AC | 충족 위치 | 비고 |
|---|---|---|
| K01 | 4.2 `KUBE_CONTEXT` 필수, 4.5 코드 2 | CLI 테스트 |
| K02 | 4.4 `--dry-run` | 인증·호출·파일 없음 |
| K03 | 3.5 종류 이름, 4.2, 4.5 코드 2 | |
| K04 | 3.1, 3.2, 4.5 코드 0 | |
| K05 | 3.6 | 헤드리스 `None` 유지 |
| K06 | 3.7, 4.3(secrets 없음) | |
| K07 | 3.6 키 순서, 4.4 원본 JSON | 테스트: 같은 가짜 응답 두 번 → 같은 바이트 |
| K08 | 4.2 시스템 목록, 3.2 `scope` | |
| K09 | 2.3 `k8s-env-literal`, 4.5 코드 1 | |
| K10 | 3.2 `kinds.result`, 4.5 코드 4 | |
| K11 | 4.5 코드 3 | |
| K12 | 3.2 `cluster`, 4.4·4.5 가림 | |
| K13 | 4.4 `getJson` GET 전용 | 테스트 |
| K14 | 2.1, 2.4 | 공유 픽스처 |
| K15 | 4.3, 4.6 | |
| K16 | 12절 | 드리프트 제외 |
| K17 | (프론트 라우팅) | API는 AWS 경로 불변 |
| K18 | 0절 경로 분리(`/api/k8s-snapshots` vs `/api/aws-snapshots`) | |
| K19 | 0절, 2.1 프로필, 12절(기존 응답 불변), 16절 1·13 | ASM 테스트 통과 |
| K20 | 6.2, 6.3, 6.4 (내보내기·적용 엔드포인트 없음) | |
| K21 | 11.1 | |
| K22 | 7절, 1.2 `FILE_KIND_READ_ONLY`, 4절 버전 규칙(ASM-API 4절) | |
| K23 | 7.2 `identity`·`documents`, `identity_changed`·`multi_document` 확인, 11.1 사유 | |
| K24 | 1.1 경로 규칙·catch-all·`lstat`/`realpath`, 생성·이름 변경·단일 삭제 API 없음 | |
| K25 | 8절, 9절, 4.1 `.gitignore`, 2.3 `.trash` 제외 | |
| K26 | 15절, 17절 compose, 6.1 `root.setup`, `common.md` 4절 `checks.k8sSnapshotStore` | |
| K27 | 머리말 경계, 10.1(드리프트만 캐시 읽기) | 구현 테스트: 파일 관리 경로에서 kube 클라이언트 호출 0회 |
| K28 | 10.7 조절 10초, 13절 | |
| K29 | 10.3 | |
| K30 | 10.5 기본값 표, 10.9 `category: default` | |
| K31 | 10.5 `HPA_REPLICAS` | |
| K32 | 10.4 수량·목록 키 | |
| K33 | 10.2, 6.6, 17절 rbac 불변 | |
| K34 | 10.1 (캐시 읽기, 새 호출 없음) | |
| K35 | 11.3 `CLUSTER_MISMATCH`·`CLUSTER_NOT_CONNECTED`, `actions.computeDrift` | |
| K36 | 10.7, 10.8 | |
| K37 | 7.3 `driftRecompute`, 10.7 파일 변경 | |
| K38 | 10.6, 13절, 1.4 | 엔진 테스트 |
| K39 | 6.4·10.9 `commands`(문자열만) | |
| K40 | 10.7 stale, 11.3 | |
| K41 | 14.2 | |
| K42 | 14.1 | |
| K43 | 14.4 | 클러스터 연결 없음 = `cluster-disconnected`, 드리프트 없음 = `no-drift` |
| K44 | 14.3 | |

---

## 19. 에러 코드 요약 (이 기능)

| HTTP | code | 엔드포인트 |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 전부 (id·trashId·path·쿼리·본문, catch-all) |
| 400 | `SNAPSHOT_CONFIRM_MISMATCH` | `DELETE /:id`, `DELETE /trash/:trashId` |
| 403 | `ORIGIN_NOT_ALLOWED` | 쓰기 전부 + `refresh`·`drift` POST |
| 403 | `SNAPSHOT_PATH_REJECTED` | 파일·스냅샷 접근 전부 |
| 403 | `SNAPSHOT_WRITE_DISABLED`, `SNAPSHOT_READ_ONLY` | 파일 저장·라벨·삭제·휴지통 (check 제외) |
| 403 | `SNAPSHOT_FILE_NOT_EDITABLE` | `PUT`/`check` file |
| 403 | `SNAPSHOT_NOTES_CORRUPT` | `PUT /notes` |
| 404 | `RESOURCE_NOT_FOUND` (`K8sSnapshot` \| `K8sSnapshotFile` \| `K8sSnapshotTrashItem`) | 상세·파일·쓰기·휴지통·드리프트 |
| 409 | `SNAPSHOT_VERSION_CONFLICT` | `PUT` file, `PUT /notes` |
| 409 | `SNAPSHOT_EXPORT_IN_PROGRESS` | `PUT` file, `PUT /notes`, `DELETE /:id` |
| 409 | `SNAPSHOT_ID_EXISTS` | 복원 |
| 409 | `K8S_DRIFT_UNAVAILABLE` | `POST /:id/drift` |
| 413 | `SNAPSHOT_FILE_TOO_LARGE`, `PAYLOAD_TOO_LARGE` | `PUT`/`check` file |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 본문이 있는 쓰기, `drift`·`refresh` POST |
| 422 | `SNAPSHOT_CONFIRMATION_REQUIRED` | `PUT` file |
| 422 | `SNAPSHOT_NOTES_SECRET_DETECTED` | `PUT /notes` |
| 500 | `SNAPSHOT_WRITE_FAILED` | 쓰기 전부 |
| 503 | `SOURCE_UNAVAILABLE` | 상세·파일·쓰기·드리프트 조회 (스냅샷 출처 없음·stale·스캐너/규칙 lib 없음) |

목록·요약·휴지통 목록·메뉴는 출처가 없어도 200 + unknown(`common.md` 3.2). 클러스터 연결 문제는 드리프트 배지의 unknown이지 HTTP 오류가 아니다(`POST /drift`만 409).

## 20. 변경 이력
- 2026-09-19: 최초 작성 (backend, 4단계 계약. 구현 전)
- 2026-09-19 (5단계 구현, backend): **응답 모양이 바뀐 곳 — frontend 확인 필요**
  1. 드리프트 "순서 다름"(10.4): `FieldDiff.path`가 목록 경로 그대로(`spec.template.spec.initContainers`, 이전 초안의 별도 표기 없음), `reason: "순서 다름"`, 양쪽 값 `kind: "list"`. `changed`인데 `reason`이 `null`이 아닌 유일한 경우다.
  2. 조건부 기본값의 `reason`도 값을 보인다: `"기본값 IfNotPresent"`(이전 초안 구현의 `"기본값"`만 쓰던 것 제거).
  3. `GET/POST …/drift`의 `addedCheck`가 전체 결과가 없을 때 `null`(10.9 표).
  4. `DriftBadge.computing`은 현재 항상 `false`(동기 계산). 화면의 "계산 중"은 `POST` 대기로 표시(10.9 문구 그대로).
  5. 드리프트 사유 순서(11.3): 내보내기 진행 중(메타 없음) 스냅샷은 `CLUSTER_ID_MISSING`보다 `SNAPSHOT_FILES_PENDING`이 먼저(14.2 예시 8과 일치).
  6. `resources.current.total` = 리소스(문서) 수, `files` = 리소스 파일 수(5절 주석).
  7. 스캐너 `k8s-last-applied`는 어노테이션 **키 자리**만 잡는다(2.3). 이전 규칙은 CLI가 쓰는 `metadata.json`의 정리 규칙 요약 문자열에 걸려 **모든 CLI 스냅샷이 경고**를 받고 `--strict` 재스캔이 실패했다(CLI 회귀 테스트 추가).
  8. 검증 오류 `details.fields[].value`: 필드 이름이 `path`면 값을 넣지 않는다(`common/api-error.ts`의 가림 목록에 `path` 추가, 1.4). `?path=a&path=b`(배열)는 400 `path is required`.
  9. 저장 422 문구의 식별값 차이: `경로와 내용 불일치(metadata.name|metadata.namespace|kind)`, 여러 문서 `한 파일에 여러 리소스 (N개)`.
  10. mock(14.2): `20260918-120000`은 `k8s-secret-object`와 공통 규칙 `secret-key-value`가 같은 줄에서 함께 걸린다(오류 2건). Helm 관리 리소스(`monitoring/grafana`)는 클러스터 인벤토리에 있어 모든 prod 예시에 `HELM_MANAGED` 정보 문구가 붙는다. 예시 1 드리프트 숨긴 차이는 기본값 4건(api 3 + web Service `sessionAffinity` 1)·관리 1건.
  11. 공유 코드 위치(17절): `common/snapshot-files/`로 옮기지 않고 ASM 파일을 직접 import(ASM 무변경).
  12. **필드 추가**(frontend 요청): 상세 `secretRefs.note`(6.3), 목록·상세 `scope.excludeNamespaces`(5절, exclude 모드 문구용).
  13. 상세 `counts.byNamespace[].namespace`는 클러스터 범위 파일(`_cluster/`)이면 `null`(트리 `tree[].namespace`와 같은 규칙). 선택 종류를 켠 스냅샷에서만 나온다.
  - 바뀌지 않은 것: 엔드포인트 경로·메서드, 오류 코드, SSE 이벤트 이름·payload 키, mock 그룹·시나리오 ID, `snapshot-menu` 모양, `/api/aws-snapshots/**` 응답.
- 2026-09-20 (mock 보강, backend): 모든 예시 스냅샷에 **소유자 없는 Job `batch/jobs/report-backfill.yaml` 1개 추가**(3D 블록 모양 `chamfer` 회귀 점검용, 14.3).
  - 바뀌는 mock 기대값: 비교 불가 4 → **5**(ConfigMap 2·NetworkPolicy 1·CronJob 1·**Job 1**), 각 예시의 리소스 수 +1, `scope.kinds.optional`이 `[]` → `["jobs"]`.
  - 바뀌지 않는 것: 드리프트 건수(변경 1·삭제 1·추가 1), 파일 상태 10건, 엔드포인트·오류 코드·SSE·mock 시나리오 ID.
