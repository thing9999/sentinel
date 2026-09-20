# k8s-snapshot · backend 작업 보고

> 파일 위치: `docs/reports/k8s-snapshot/backend.md`

## 2026-09-19 · API 계약

### 1. 요청 내용
- PM: `k8s-snapshot` 4단계. **API 계약 문서만** 작성(코드 수정 금지, 구현은 5단계). 산출물 `docs/api/k8s-snapshot.md` + `docs/api/common.md` 필요한 추가.
- planner의 backend 요청을 계약에 결정·반영: CLI `deploy/k8s-snapshot/` 폴더 구조·metadata·종료코드(부분 성공 4)·정리 규칙, 스캐너 한 벌 유지 + k8s 규칙, 정리 규칙·기본값 표를 CLI와 대시보드가 같은 원본으로, 기존 `/api/aws-snapshots`·토픽·mock 그룹 불변 + k8s 별도 경로·토픽·그룹, 메뉴 합산 요약 엔드포인트, informer가 `spec` 전체를 들고 있는지 코드로 확인, compose·README 8장·common.md는 구현 메모, 엔드포인트 ↔ AC 매핑, SSE, 오류 코드, mock 시나리오.
- 작업 중 PM 전달(designer 완료): 드리프트 배지 모드·계산 중·지난 결과 보관 여부, 비교 불가 두 사유, 요약·명령용 경로, 행별 클러스터 관계, 메뉴·탭 값, mock 그룹 결정, CLI 설정 이름, 여러 `---` 문서 파일의 드리프트 규칙 명시.

### 2. 참고한 문서
- `CLAUDE.md`(기능 5 확정 결정, RBAC 목록)
- `docs/specs/k8s-snapshot.md`(확정본, AC-K01~K44, 4.3 여러 문서 규칙 추가분 포함), `docs/specs/aws-snapshot-manager.md`(U1·3.4·AC-21 변경)
- `docs/api/aws-snapshot-manager.md`(재사용 규칙 원본), `docs/api/common.md`
- `docs/design/k8s-snapshot.md`(작업 중 완료, 3·5~11절)
- `docs/reports/k8s-snapshot/{README,planner,dba}.md`
- 코드: `apps/api/src/cluster/kube/kube-watcher.service.ts`, `extract.ts`, `apps/api/src/cluster/mock/mock-world.ts`, `apps/api/src/aws-snapshots/{scanner-loader,snapshot.constants}.ts`, `apps/api/node_modules/@kubernetes/client-node/dist/{cache.js,watch.js,gen/models/ObjectSerializer.js}`(2.0.0), `deploy/aws-snapshot/lib/{scan,meta,config}.mjs`, `deploy/aws-snapshot/README.md`(8장), `deploy/rbac.yaml`, `docker-compose.yml`

### 3. 작업 내용
1. **informer 확인**: `ClusterStore`에는 추린 값만 있지만, `makeInformer`의 `ListWatch`가 내부 `objects` 맵에 객체 전체를 이미 보관한다(`list()`/`get()`). 비교 가능 9종 모두 informer가 있다. 단 최초 목록은 타입 API(`ObjectSerializer`: `Date` 변환, 모델에 없는 필드 버림, 항목에 apiVersion/kind 없음), watch 이벤트는 `JSON.parse` 원본이라 모양이 섞인다 → 계약 10.1에 "캐시 재사용 + 목록 함수를 원본 JSON으로 교체"로 결정.
2. **계약 `docs/api/k8s-snapshot.md` 작성** (20절)
   - 0 화면 ↔ 엔드포인트·출처(`k8sSnapshotStore` 신규, 드리프트는 `kube`)
   - 1 경로 규칙(`path` 쿼리 정규식, 중간 폴더까지 `lstat`), WriteAbility, 쓰기 보호, 로그 금지 항목
   - 2 공유 원본: 스캐너는 `deploy/aws-snapshot/lib/scan.mjs`에 `profile` 옵션으로 k8s 규칙 5개 추가(AWS 결과 불변), k8s lib(`kinds`/`layout`/`rules.mjs`)는 내장 모듈만 import
   - 3 폴더 구조·파일 이름 인코딩(`~XX`, Windows 예약 이름)·`metadata.json`·`secret-refs.json`·`notes.json(fileEdits)`·종류 목록·정리 규칙·제외 규칙
   - 4 CLI: 폴더 구성, 설정 이름, 내보내기 전용 역할, client-node + 원본 JSON GET 전용 `getJson`, 종료코드 0/1/2/3/4/99, 임시 폴더 후 rename, README 목차, 테스트 목록
   - 5~9 타입·조회·편집·라벨·휴지통(ASM 재사용 + 차이)
   - 10 드리프트: 데이터 출처, 비교 가능 종류(RBAC 일치 테스트), 짝 맞추기(여러 문서는 문서별), 비교 절차, 기본값·관리 필드 표, 값 가림, 계산 주기(조절 10초, 5분), 임대 방식 요청 계산, 결과 조회·지난 결과 보관 표
   - 11 이유 코드(파일·요약·드리프트·정보), 12 메뉴 합산 `GET /api/snapshot-menu` + 토픽 `snapshot-menu`, 13 SSE `k8s-snapshots`, 14 mock(예시 10개 + 휴지통, 인벤토리 기반 실제 엔진 계산, 그룹 `k8s-snapshots`), 15 환경 변수, 16 다르게 정한 점 20개, 17 구현 메모, 18 AC 매핑, 19 오류 코드
3. designer 요청 반영: `DriftBadge.mode`(`auto`/`on_demand`/`last_result`/`none`)·`computing`·`lastResultStatus`·`resultAvailable`, 지난 결과 보관 표(10.9), 목록 `cluster` 필터를 관계값으로·`facets`, `cli.settings`, 파일 행 `resourceKey`·`documents`·`parseError`·`duplicateOf`, 트리 순서·`system`·종류별 비교 가능 여부, `counts.excluded` 이유, 삭제 확인용 `folder`, 가린 값 `text`("값 다름 (…)")·`preview`, 기본값 차이 이유 "기본값 File", 드리프트 리소스 `apiVersion`·`fileDocuments`.
4. `docs/api/common.md` 갱신: 적용 문서, 0 요약, 1.2 CORS·쓰기 보호, 1.4 예외, 2.3 `k8sSnapshotStore`·stale, 3.3 코드, 4절 health, 5절 토픽 2개·봉투·순서·이벤트 목록, 6.1 mock 그룹·cluster 관계, 6.3 reset, 8 변경 이력.

### 4. 변경 파일
| 경로 | 구분(추가/수정/삭제) | 내용 |
|---|---|---|
| `docs/api/k8s-snapshot.md` | 추가 | k8s-snapshot API 계약 (CLI 형식 포함) |
| `docs/api/common.md` | 수정 | k8s 출처·토픽·mock 그룹·health·오류 코드·1.4 예외·변경 이력 |
| `docs/reports/k8s-snapshot/backend.md` | 추가 | 이 보고서 |

### 5. 주요 결정과 이유
- **드리프트 데이터 = 기존 informer의 `ListWatch` 캐시** / 대안: 드리프트용 get·list 호출, 새 informer / 이유: 이미 전체 객체가 메모리에 있어 API 호출·메모리·RBAC 추가가 없다. 최초 목록의 타입 변환 문제는 목록 함수를 원본 JSON으로 바꿔 해결(응답 모양 불변).
- **스캐너 원본은 `deploy/aws-snapshot/lib/scan.mjs` 그대로, `profile` 옵션** / 대안: 공용 폴더로 이동, k8s 규칙을 항상 적용 / 이유: 이동하면 기존 마운트·환경 변수·테스트가 바뀌고, 항상 적용하면 AWS 스캔 결과가 바뀔 수 있다(AC-K19).
- **k8s lib는 내장 모듈만** / 이유: compose가 lib 폴더만 읽기 전용 마운트하므로 외부 패키지·형제 폴더 import가 컨테이너에서 깨진다.
- **CLI는 kubectl 대신 client-node + 단일 GET 함수** / 이유: 설치·버전 의존 제거, 원본 JSON(가짜 차이 방지), AC-K13 테스트 가능.
- **요청 계산은 임대(120초, 60초 갱신)** / 이유: 서버가 "화면을 떠남"을 직접 알 수 없다.
- **메뉴 합산은 새 엔드포인트·토픽** / 이유: 기존 `aws-snapshots` 응답을 바꾸지 않기 위해(AC-K19).
- **드리프트 결과는 메모리만** (DBA 결정과 같음), 지난 결과는 10분 뒤 요약만.
- **mock 드리프트는 cluster mock 인벤토리 + 실제 엔진** / 이유: 클러스터 화면 값과 구조적으로 일치(AC-K44).
- **mock 그룹 하나 `k8s-snapshots`** (디자인 제안 `k8sSnapshots` 대신 kebab-case, 드리프트 시나리오 포함).
- 명세와 다른 점 전체는 계약 16절.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과 (출력 없음) | 코드 변경 없음. 기준선 확인용 |
| `npm test --prefix apps/api` | 33 suites 통과, 315 통과 / 1 건너뜀 | 코드 변경 없음. 건너뛴 1건은 기존 것 |
| CLI 테스트(`deploy/aws-snapshot`) | 생략 | 코드 변경 없음 |
| 계약의 기본값 표 실측 | 생략 | 실제 클러스터(kind 1.30~1.34)로 저장값 확인은 5단계에서 한다(계약 10.5에 명시) |

### 7. 남은 이슈·한계
- 기본값 표·관리 필드·자동 생성 목록은 초기안이다. 구현 단계에서 실제 API 서버 저장값(특히 HPA `behavior` 기본값, Service `ipFamilies`)을 확인해야 한다.
- `k8s-env-literal` 등은 줄 단위라 여러 줄 흐름 매핑·앵커 형태를 못 잡을 수 있다(안내 문구로 대신).
- informer 목록 함수 교체는 `cluster-status` 내부 변경이다. 5단계에서 기존 테스트로 회귀를 확인해야 한다.
- 드리프트 리소스가 수천 개인 대형 클러스터 성능은 가정(수백 개 기준 수십 ms)이다.

### 8. 다른 담당 요청
- `designer 요청`: `docs/design/k8s-snapshot.md` 10.1 ⑤ 문구 마지막 절을 "드리프트는 문서마다 따로 비교합니다"로(계약 10.3·명세 4.3). mock 그룹 키는 `k8s-snapshots`, 드리프트 시나리오는 같은 그룹(별도 "Kubernetes 드리프트" 그룹 없음, 계약 14.4). 목록 클러스터 필터 값은 `same`/`other`/`unknown`, 드리프트 필터 값은 `ok`/`warning`/`unknown`/`not_computed`.
- `frontend 요청`(6단계): 사이드바 "스냅샷" 메뉴는 `aws-snapshots.summary` 대신 `GET /api/snapshot-menu` + 토픽 `snapshot-menu`로 그린다(계약 12절). 드리프트 탭은 열려 있는 동안 60초마다 `POST …/drift {force:false}`로 임대 갱신.
- `planner 요청`(선택): 명세에 없는 사유 몇 가지(`API_VERSION_MISMATCH`, `DASHBOARD_CLUSTER_UNKNOWN`, `CLUSTER_SYNCING`)를 계약에서 정했다(16절 8·9). 이견 있으면 알려 달라.
- DBA 요청 없음(스키마 변경 없음).

### 9. 다음 담당이 알아야 할 점
- 5단계 구현 순서 권장: ① `scan.mjs` 프로필 + k8s 규칙(AWS 테스트 통과 확인) → ② `deploy/k8s-snapshot/lib`(kinds/layout/rules) + CLI + 테스트 → ③ informer 원본 JSON 목록 + `ClusterObjectSource` → ④ api 파일 관리(ASM 공용 코드 추출) → ⑤ 드리프트 엔진·서비스 → ⑥ 메뉴 합산·SSE·mock → ⑦ compose·`.env.example`·README 8장.
- 구현 메모 전체는 계약 17절, AC 매핑은 18절.
- `deploy/rbac.yaml`은 바꾸지 않는다(AC-K33). 비교 가능 종류는 `COMPARABLE_KINDS` 한 곳 + RBAC 일치 테스트.
- 로그·SSE·오류에 파일 내용·라벨·메모·드리프트 값 금지. 가림은 차이를 만드는 단계에서 적용(메모리에도 원문 없음).

## 2026-09-19 23:50 · 구현 (5단계, 이어서 마무리)

### 1. 요청 내용
- PM: `k8s-snapshot` 5단계 구현 **마무리**. 이전 backend 에이전트가 세션 재시작으로 **중간에 종료**됐다(서비스·컨트롤러·모듈 없음, CLI README·rbac 예시·.env.example 없음). 이미 있는 코드를 읽고 이어서 작업.
- 요구: 계약 전체 구현, informer 원본 JSON 전환의 회귀 없음 증명, CLI README(명세 3.9 백업·복원), `deploy/aws-snapshot/README.md` 8장 갱신, 스캐너 `profile:'k8s'`의 AWS 결과 불변 테스트, `deploy/rbac.yaml` 불변 + CLI 역할 예시 별도 파일(secrets 없음), compose·`.env.example`(db 5432 불변), PrismaService 비의존, apps/web 미변경. mock api :3021 curl 확인, 자기 PID만 종료.
- 작업 중 PM 전달(frontend 통합 완료): ① web 기본 스트림이 `overview,snapshot-menu` 구독 → 스트림이 두 토픽을 받는지 curl 확인 ② (선택) 상세 `secretRefs.note`, 목록 `scope` 제외 목록 추가 ③ `apps/web/src/features/k8s-snapshots/{api,types}.ts`와 모양 비교.

### 2. 참고한 문서
- `docs/api/k8s-snapshot.md`(전체, 17·18절), `docs/api/common.md`, `docs/specs/k8s-snapshot.md`(3장·3.9), `docs/reports/k8s-snapshot/{backend,dba}.md`
- 코드: `apps/api/src/aws-snapshots/**`(패턴), `apps/api/src/cluster/{kube,mock,state}/**`, `deploy/aws-snapshot/**`, `deploy/k8s-snapshot/**`, `apps/web/src/features/k8s-snapshots/{api,types}.ts`(읽기만)

### 3. 작업 내용
**이전 에이전트가 이미 해 둔 것 (코드로 확인)**
- `deploy/aws-snapshot/lib/scan.mjs` 프로필(`aws`/`k8s`) + k8s 규칙 5개 + AWS 결과 불변 테스트(`scan.test.mjs` "profile: AWS 스캔 결과 불변")
- `deploy/k8s-snapshot/` CLI(export·scan·lib 8개·test 3개, 62건 통과)
- informer 목록 함수 원본 JSON 전환(`cluster/kube/raw-list.ts`, `kube-watcher.service.ts`의 `makeRawLister`·`cacheOf`·`objectChanges$`) + 회귀 테스트 `extract-raw.spec.ts`(같은 객체를 ObjectSerializer 타입 객체와 원본 JSON 으로 `extract*()`에 넣어 화면 값이 완전히 같음, 가짜 API 서버로 raw lister 확인). 기존 cluster-status 테스트 전부 통과
- api: `k8s-analyzer.ts`, `k8s-backend.ts`(fs/memory), `k8s-libs.ts`, `k8s.constants.ts`, `drift/{comparable-kinds,drift-engine}.ts`, 출처 `k8sSnapshotStore`·health·토픽·mock 그룹 등록, env 검증
- 빠진 것: 서비스·컨트롤러·모듈·드리프트 스케줄러·클러스터 객체 출처·mock 예시·메뉴 합산·테스트, CLI README·rbac·.env.example·.gitignore·.gitkeep, compose·.env.example, README 8장

**이번에 한 것**
1. `drift/mock-cluster-objects.ts`: cluster mock 인벤토리(Raw*) → 쿠버네티스 원본 모양 객체(서버 기본값·런타임 필드 포함, apiVersion/kind 없음). 결정적(같은 인벤토리 = 같은 객체).
2. `drift/cluster-object-source.ts`: 계약 10.1 `ClusterObjectSource`. live = `KubeWatcherService.cacheOf()`(informer ListWatch 캐시 읽기만, API 호출 없음), mock = ClusterStore 인벤토리. 클러스터 ID = `kube-system` uid, ARN 컨텍스트는 클러스터 이름만.
3. `drift/drift.service.ts`: 자동 대상(같은 cluster.id 최신), 임대(120초·최대 5개), 조절 10초·5분 주기, 파일 변경 즉시 재계산, stale 시 재계산 안 함 + 배지 stale, 지난 결과 10분 보관·요약 유지, 파일이 바뀌면 지움, 계산 불가 사유 순서(11.3), 1초 debounce `k8s-snapshots.drift`(값 없음), 409 `K8S_DRIFT_UNAVAILABLE`.
4. `k8s-snapshots.{service,controller,module}.ts`, `dto.ts`: 계약 6~9절 전부(요약·목록 필터·facets·상세 트리·개수·파일 보기·검사·저장·라벨·휴지통·scan-rules·drift-rules·refresh), 경로 규칙은 lib `isRequestablePath`, catch-all 400, 쓰기 보호는 ASM `SnapshotWriteGuard` 재사용, mock 시나리오 9개, 토픽 `k8s-snapshots`. 저장소 교체 세대(`gen`)로 교체 전에 시작한 확인 결과를 버린다(테스트에서 발견한 경쟁 조건).
5. `k8s-mock-fixtures.ts`: 예시 10개 + 휴지통 1개를 **cluster mock 인벤토리 + CLI 정리 규칙**으로 만든다(예시 2 = 클러스터와 차이 없음, 예시 1 = 14.3 변경만). 드리프트는 실제 엔진 계산(예: cluster `healthy`면 `batch/scratch` 삭제됨이 추가).
6. `snapshot-menu/**`: `GET /api/snapshot-menu` + 토픽 `snapshot-menu`. ASM은 한 줄도 바꾸지 않고 `events$`만 구독.
7. 연결: `app.module.ts`, `main.ts`(k8s 파일 저장·검사 큰 본문 파서), `cluster.module.ts` export(`ClusterStore`, `KubeClientService`), `common/api-error.ts`(검증 오류 값 가림에 `path` 추가), `stream.service.spec.ts`(새 토픽 2개 기대값 — 시작 기준선에서 유일하게 실패하던 테스트).
8. **CLI 버그 수정**: `k8s-last-applied` 규칙이 CLI가 모든 `metadata.json`에 쓰는 정리 규칙 요약 문자열에 걸려 **모든 CLI 스냅샷이 경고**(대시보드 "주의", `npm run scan --strict` 실패). 키 자리만 잡도록 정규식 수정 + 테스트(스캐너 단위 + CLI "내보낸 폴더 재스캔 발견 0"; 옛 정규식으로 되돌리면 실패하는 것 확인).
9. 드리프트 엔진 보정: 순서 차이 표기(목록 경로 + `reason: "순서 다름"`), 조건부 기본값 사유에 값 표시, lint(`no-base-to-string`) 대응.
10. CLI 부속: `README.md`(11장, 3.9 백업·복원 전부), `rbac/export-readonly.yaml`(get/list만, secrets·pods 없음, 그룹 바인딩), `.env.example`, `.gitignore`, `snapshots/.gitkeep`, rbac 예시 테스트 3건.
11. `deploy/aws-snapshot/README.md` 8장: 쿠버네티스 행 → `deploy/k8s-snapshot`, Postgres 행에 `pg_dumpall --globals-only`·PowerShell `>` 금지·`kubectl cp`·볼륨 스냅샷 복원 순서·PITR 범위 밖.
12. 루트 `docker-compose.yml`(api: `/data/k8s-snapshots` 쓰기 마운트, `/opt/k8s-snapshot/lib:ro`, env), `.env.example`(15절 변수). db·5432 불변.
13. frontend 요청: 상세 `secretRefs.note`, `scope.excludeNamespaces` 추가. 스트림 `?topics=overview,snapshot-menu` 20초 연결 유지(heartbeat) 확인. web `types.ts`와 응답 모양 비교.
14. 계약 문서 갱신(20절 "5단계 구현" 13항목), `common.md` 변경 이력 1줄.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/k8s-snapshots/k8s-snapshots.service.ts` | 추가 | 파일 관리·요약·목록·상세·편집·휴지통·드리프트 조회/요청·mock 시나리오·토픽 |
| `apps/api/src/k8s-snapshots/k8s-snapshots.controller.ts` | 추가 | REST + catch-all 400 |
| `apps/api/src/k8s-snapshots/k8s-snapshots.module.ts` | 추가 | ClusterModule import, PrismaService 비의존 |
| `apps/api/src/k8s-snapshots/dto.ts` | 추가 | 목록 쿼리·파일 본문·라벨·확인·드리프트 요청 |
| `apps/api/src/k8s-snapshots/k8s-mock-fixtures.ts` | 추가 | mock 예시 트리 3벌(default·no-drift·empty) |
| `apps/api/src/k8s-snapshots/drift/{cluster-object-source,mock-cluster-objects,drift.service}.ts` | 추가 | 10.1·10.7~10.9 |
| `apps/api/src/k8s-snapshots/drift/drift-engine.ts` | 수정 | 순서 차이 표기, 기본값 사유, lint |
| `apps/api/src/k8s-snapshots/k8s-analyzer.ts` | 수정 | `secretRefs.note`, `scope.excludeNamespaces`, BOM 정규식 이스케이프, 타입 |
| `apps/api/src/k8s-snapshots/{k8s-snapshots.http,k8s-snapshots.live}.spec.ts`, `drift/{drift-engine,comparable-kinds}.spec.ts` | 추가 | http(mock) 14, live(fs) 7, drift-engine 11, comparable-kinds 12 |
| `apps/api/src/snapshot-menu/snapshot-menu.{service,controller,module,service.spec}.ts` | 추가 | 메뉴 합산 + 테스트 4 |
| `apps/api/src/app.module.ts`, `apps/api/src/main.ts` | 수정 | 모듈 2개, k8s 파일 본문 파서 |
| `apps/api/src/cluster/cluster.module.ts` | 수정 | `ClusterStore`·`KubeClientService` export (동작 변경 없음) |
| `apps/api/src/common/api-error.ts` | 수정 | 검증 오류 값 가림에 `path` |
| `apps/api/src/stream/stream.service.spec.ts` | 수정 | 토픽 목록 기대값 |
| `deploy/aws-snapshot/lib/scan.mjs` | 수정 | `k8s-last-applied` 키 자리만 |
| `deploy/aws-snapshot/test/scan.test.mjs` | 수정 | JSON 키·metadata 요약 테스트 |
| `deploy/aws-snapshot/README.md` | 수정 | 8장 |
| `deploy/k8s-snapshot/{README.md,rbac/export-readonly.yaml,.env.example,.gitignore,snapshots/.gitkeep}` | 추가 | CLI 부속 |
| `deploy/k8s-snapshot/test/{export,lib}.test.mjs` | 수정 | 재스캔 0건 회귀, rbac 예시 테스트 |
| `docker-compose.yml`, `.env.example` | 수정 | k8s 마운트·환경 변수 |
| `docs/api/k8s-snapshot.md` | 수정 | 구현 반영·20절 변경 이력 |
| `docs/api/common.md` | 수정 | 8절 1줄 |
| `docs/reports/k8s-snapshot/backend.md` | 수정 | 이 섹션 |
| (이전 에이전트, 중단 전) `apps/api/src/k8s-snapshots/{k8s-analyzer,k8s-backend,k8s-libs,k8s.constants}.ts`, `drift/comparable-kinds.ts`, `cluster/kube/{raw-list.ts,kube-watcher.service.ts,extract-raw.spec.ts}`, `common/{extension-points,source-registry.service}.ts`, `stream/{stream,mock-scenario}.service.ts`, `health/health.service.ts`, `config/env.validation.ts`, `deploy/k8s-snapshot/{export.mjs,scan.mjs,package.json,lib/**,test/**}`, `deploy/aws-snapshot/lib/scan.mjs`(프로필) | 추가/수정 | 이번에 코드로 확인·테스트 |

### 5. 주요 결정과 이유
- **공유 코드를 `common/snapshot-files/`로 옮기지 않음**(계약 17절과 다름) / 대안: 이동 후 두 모듈이 사용 / 이유: ASM 코드를 한 줄도 안 바꿔 회귀 위험이 없다. k8s가 ASM 파일을 import.
- **드리프트는 동기 계산, `computing`은 항상 false** / 이유: 메모리 계산 수십 ms, 계약 500ms 규칙상 이벤트가 나갈 일이 없다.
- **진행 중 스냅샷은 `SNAPSHOT_FILES_PENDING`이 `CLUSTER_ID_MISSING`보다 먼저** / 이유: 메타가 아직 없어 ID 판단이 무의미, 계약 14.2 예시 8과 맞춤.
- **mock 예시 파일 = mock 인벤토리를 CLI 정리 규칙으로 정리한 것** / 대안: 손으로 쓴 YAML / 이유: "차이 없음"이 구조적으로 보장되고 cluster 시나리오와 모순이 없다(AC-K44).
- **저장소 교체 세대 카운터** / 이유: reset 직전에 시작한 주기 확인이 옛 저장소 결과로 캐시·드리프트를 되살리는 경쟁 조건(테스트에서 재현).
- **`k8s-last-applied` 키 자리 한정** / 이유: CLI가 자기 metadata에 규칙 이름을 쓰므로 모든 스냅샷이 경고. 스캐너 한 벌이라 대시보드·CLI가 같이 고쳐진다.
- `rbac/export-readonly.yaml`은 그룹 바인딩(ServiceAccount 없음). 대시보드 `deploy/rbac.yaml`은 그대로(`comparable-kinds.spec.ts`가 대조).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint --prefix apps/api` | 통과 | `--fix`가 prettier 포맷 적용 |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 통과 | |
| `npm test --prefix apps/api` | 39 suites, 376 통과 / 1 건너뜀 | 건너뛴 1건은 기존 것. 시작 기준선: 34 suites 중 1 실패(stream 토픽 기대값) |
| `npm run test:e2e --prefix apps/api` | 1 suite, 1 통과 | |
| `npm test --prefix deploy/aws-snapshot` | 105 통과 | AWS 결과 불변 테스트 포함 |
| `npm test --prefix deploy/k8s-snapshot` | 65 통과 | 재스캔 0건 회귀·rbac 예시 포함 |
| mock api :3021 curl | 통과 | 목록·필터·상세·파일(인코딩 경로 200)·경로 탐색 14종 400·`--path-as-is` 400·catch-all 400·검사·저장 409/422/403/415/200·라벨(UTF-8)·409·422·휴지통 이동/복원/영구 삭제·드리프트 요청 임대/자동 대상/409/지난 결과·snapshot-menu·scan/drift-rules·health·mock 시나리오 전환(k8s 9개, cluster kube-stale/healthy/no-cluster)·SSE(`k8s-snapshots.drift`, `snapshot-menu.*`, `?topics=overview,snapshot-menu` 20초 유지) |
| 프로세스 정리 | 자기 PID만 종료 | 21524, 11932, 17896, 11596 (`taskkill /PID`). PID 8756 등 남의 프로세스는 건드리지 않음 |
| `docker compose config` | **생략** | 이 PC에 docker 없음. YAML 파싱으로 마운트·env 키만 확인 |
| 실제 EKS/kind 클러스터 기본값 실측(계약 10.5) | **생략** | 클러스터 없음. 기본값·관리 필드 표는 초기안 그대로 |

### 7. 남은 이슈·한계
- 기본값·관리 필드·자동 생성 목록은 실제 API 서버(EKS 1.30~1.34)로 확인하지 못했다. 실클러스터에서 가짜 차이가 보이면 `deploy/k8s-snapshot/lib/rules.mjs` 표를 보강해야 한다.
- live 드리프트는 informer 캐시 대역으로만 테스트했다(실제 watch 재연결·403 종류는 기존 KubeWatcher 범위).
- `computing: true` 이벤트는 나가지 않는다(동기 계산). 대형 클러스터에서 계산이 500ms를 넘어도 표시가 없다.
- `k8s-secret-object` 줄에서 공통 `secret-key-value`도 같이 걸린다(오류 2건). 중복 제거는 하지 않았다.
- mock의 모든 prod 예시에 Helm 정보 문구가 붙는다(인벤토리의 grafana가 Helm 레이블).

### 8. 다른 담당 요청
- `frontend 요청`: 계약 20절 "5단계 구현" 확인 — ① 순서 차이 `FieldDiff`(목록 경로, `reason: "순서 다름"`, list 값) ② `addedCheck: null` 가능(web 타입에 이미 있음) ③ `computing` 항상 false ④ **`counts.byNamespace[].namespace`가 클러스터 범위(`_cluster/`)면 `null`**(web 타입은 `string`, 선택 종류를 켠 스냅샷에서만) ⑤ 새 필드 `snapshot.secretRefs.note`, `scope.excludeNamespaces`(web 타입에 없음). 그 밖 `types.ts`·`api.ts`와 응답 모양·경로·메서드 일치 확인.
- `planner 요청`(참고): 드리프트 사유 순서에서 진행 중 스냅샷을 `SNAPSHOT_FILES_PENDING` 우선으로 정했다.
- DBA 요청 없음(스키마 변경 없음, 드리프트 결과 메모리).

### 9. 다음 담당이 알아야 할 점
- 로컬 실행: Docker 없이 `K8S_SNAPSHOT_DIR=../../deploy/k8s-snapshot/snapshots npm run start:dev --prefix apps/api`. compose는 자동 마운트.
- mock에서 드리프트 확인: 예시 `20260919-061000`(자동, 차이 3건), `20260910-000000`(지난 결과 "차이 없음"), cluster 시나리오 `healthy`/`no-cluster`/`kube-stale`, k8s 시나리오 `cluster-disconnected`/`no-drift`.
- 규칙 표를 바꾸면 `CLEANUP_RULES_VERSION`을 올리고 `RULESETS`에 이전 버전을 남긴다. 비교 가능 종류를 바꾸면 `comparable-kinds.spec.ts`가 `deploy/rbac.yaml`과 대조한다(RBAC는 늘리지 않는다).
- 스캐너 규칙은 `deploy/aws-snapshot/lib/scan.mjs` 한 벌. k8s 규칙은 `profile: 'k8s'`에서만 돈다.
