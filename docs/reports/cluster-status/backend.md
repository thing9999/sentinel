# cluster-status · backend 작업 보고

> 파일 위치: `docs/reports/cluster-status/backend.md`

## 2026-09-19 · API 계약 (3단계: 공통 규약 + cluster-status)

### 1. 요청 내용
- PM 요청: 3단계 API 계약 문서만 작성(구현 없음).
  - `docs/api/common.md`: 전역 prefix·CORS·에러 형식·시각·단위·`dataSource`·stale 규칙·공통 상태 객체·`GET /api/health` 정식 계약·SSE 공통 규약·mock 시나리오 전환 API 포함 여부.
  - `docs/api/cluster-status.md`: 노드·파드·워크로드·이벤트·PVC·메트릭·DB 상태 REST + SSE. 디자인 라우트 전체 커버, 필터·정렬·페이지네이션, DB는 DBA 스냅샷 타입 기준, 민감 필드 노출 여부 명시.
- RBAC는 `CLAUDE.md` 목록 그대로, `nodes/proxy` 추가 안 함(PM 결정).
- aws-cost·architecture-advisor 계약은 각 기능 보고서에 따로 기록.

### 2. 참고한 문서
- `CLAUDE.md`, `docs/specs/cluster-status.md`(+ aws-cost, architecture-advisor 교차 확인)
- `docs/design/status.md`, `shell.md`, `components.md`, `cluster-status.md`
- `docs/db/health.md`, `docs/db/schema.md`, `apps/api/src/database/health/types.ts`, `postgres/types.ts`, `postgres/normalize.ts`(`DEFAULT_PG_THRESHOLDS`, `PG_CHECK_ORDER`, `pgUnreachableSnapshot`, `approxPvcUsagePct`), `sanitize.ts`, `settings-defaults.ts`
- `docs/reports/bootstrap/backend.md`, `bootstrap/frontend.md`(SSE 훅 동작: 오류 시 직접 재연결), `cluster-status/designer.md` 8절, `cluster-status/dba.md` 9절, `docs/reports/README.md`(PM 결정)

### 3. API 계약

#### 3.1 공통 규약 (`docs/api/common.md`)
| 항목 | 결정 |
|---|---|
| 경로 | `/api` prefix, URL 버전 없음, 경로 kebab-case, JSON camelCase, enum snake_case(쿠버네티스 고유 값은 원문) |
| CORS | `CORS_ORIGIN`(기본 `http://localhost:3000`), `GET/POST/PUT/PATCH/OPTIONS`, 쿠키 없음, `Retry-After` 노출 |
| 응답 | 봉투 없음. 조회 응답 최상위에 `dataSource`, `generatedAt`. 값 없음은 `null` |
| 시각·단위 | UTC ISO(ms, `Z`), 날짜 `YYYY-MM-DD`(UTC). CPU millicore 정수, 메모리 bytes 정수, 비율 0~100(100 초과 가능), 금액 USD 숫자(표시 규칙은 프론트) |
| 금액 | 모든 금액에 `kind`(`estimated`/`actual`/`forecast`) + `asOf`. 단독 값은 `Money`, 표는 섹션에 한 번(행 상속) |
| 상태 | `ok`/`warning`/`critical`/`unknown`, 공통 `StatusInfo { status, reasons[{code,text,status}], updatedAt, statusChangedAt, stale }` |
| stale | 상태 값이 아니라 플래그. 출처별 `SourceStatus { id, state(ok/syncing/stale/unavailable/not_configured/mock), intervalSec, staleAfterSec(=×3), lastSuccessAt, lastAttemptAt, error }` |
| 에러 | `{ statusCode, code, message, details?, path, timestamp }`. **출처 실패는 HTTP 오류가 아니라 200 + unknown**. 공통 코드: `VALIDATION_FAILED`, `MOCK_MODE_ONLY`, `ROUTE_NOT_FOUND`, `RESOURCE_NOT_FOUND`, `PAYLOAD_TOO_LARGE`, 429 계열(`Retry-After`), `SOURCE_UNAVAILABLE`, `DASHBOARD_DB_UNAVAILABLE`, `STREAM_LIMIT_REACHED`, `INTERNAL_ERROR` |
| `GET /api/health` | 항상 200. `{ status: ok|degraded, dataSource, version, serverTime, startedAt, uptimeSec, checks: { kube, metrics, prometheus, monitoredDb, aws, costExplorer, agentBridge, dashboardDb } }`, 각 check `{ state, configured, message, checkedAt }`. 캐시 값만(외부 호출 없음) |
| SSE 구조 | **단일 스트림** `GET /api/stream?topics=overview,cluster,metrics,db,cost,advisor`(생략 시 전체) |
| SSE 형식 | 이벤트 이름 `<topic>.<entity>.<action>`(`*.snapshot`, `*.upsert/delete`, `*.updated`, `stream.*`), data는 한 줄 JSON 봉투 `{ seq, topic, emittedAt, payload }`. 같은 객체 변경은 500ms 창으로 합침 |
| 초기 스냅샷 | 연결 직후 `retry: 3000` → `stream.hello`(dataSource·serverTime·heartbeatSec·topics·sources) → 토픽별 `*.snapshot` → 이후 변경분 |
| heartbeat | **15초**, 이름 있는 이벤트 `stream.heartbeat`(주석 줄 아님) |
| Last-Event-ID | **미지원**. `id:` 안 보냄. 재연결마다 전체 스냅샷 |
| 연결 상태 | `stream.source`(출처 상태 변화), 회복 시 해당 토픽 스냅샷 재전송, 종료 시 `stream.closing` |
| mock 시나리오 | **포함**. `GET /api/mock/scenarios`(live에서도 200, `enabled:false`), `PUT /api/mock/scenarios/:group`(`{scenario}`), `POST /api/mock/reset`. 그룹 cluster/db/cost/advisor, 메모리 상태, 변경 시 해당 토픽 스냅샷 재전송. live 403 `MOCK_MODE_ONLY` |

#### 3.2 cluster-status (`docs/api/cluster-status.md`)
| 메서드·경로 | 용도 | 주요 쿼리 |
|---|---|---|
| `GET /api/overview` | 셸(사이드바 `nav`, 상단바 `cluster`) + 개요(요약 띠, 카드 5개 `areas`, "지금 확인할 항목" 최대 8, 비용·어드바이저 요약) | - |
| `GET /api/cluster/summary` | overview의 클러스터 부분 | - |
| `GET /api/cluster/attention` | "모두 보기" Drawer | limit, offset |
| `GET /api/cluster/nodes` | 노드 목록 + `counts`·`facets`·`thresholds`·`areaStatus` | status, nodeGroup, zone, capacityType, q, sort, limit, offset |
| `GET /api/cluster/nodes/:name` | 조건·용량·이 노드 파드·관련 이벤트 | - |
| `GET /api/cluster/workloads` | 워크로드 목록 | status, kind, namespace, hideSystem, q, sort |
| `GET /api/cluster/workloads/:kind/:namespace/:name` | `?focus=` 펼침(조건·소속 파드·이벤트) | - |
| `GET /api/cluster/pods` | 파드 목록 + `restartObservation`(관측 N분) | status, namespace, hideSystem, showCompleted, node, workload, q, sort |
| `GET /api/cluster/pods/:namespace/:name` | 컨테이너별 상태·사유·종료·requests/limits·probe 유무·이벤트 | - |
| `GET /api/cluster/events` | 최근 1시간 Warning (`severe` 플래그) | severeOnly, namespace, kind, reason, target, sinceSec, q, sort |
| `GET /api/cluster/pvcs` | PVC(사용량 출처 `prometheus`/`db_size_approx`/null) | namespace, status, dbOnly, q, sort |
| `GET /api/cluster/metrics` | 클러스터 CPU·메모리 사용·requests·limits·할당 가능 | - |
| `GET /api/cluster/metrics/series` | 추이(클러스터·노드·파드), 결측 null | target, name, namespace, range(1h/6h/24h) |
| `GET /api/cluster/db` | DB 상세: 쿠버네티스(StatefulSet·파드·PVC) + `health`(DBA `PgHealthSnapshot`) + `pvcUsage` | - |

- 항목 타입: `NodeItem`, `WorkloadItem`, `PodItem`, `EventItem`, `PvcItem`(모두 해석된 필드만, 원본 객체·env·어노테이션 없음).
- SSE: `overview.snapshot/updated`, `cluster.snapshot`, `cluster.summary.updated`, `cluster.{node,workload,pod,event,pvc}.{upsert,delete}`(행 전체 교체), `metrics.snapshot/updated`(15초, 노드·파드 사용량 배열 + 클러스터 추이 점), `db.snapshot/updated`(15초 전체 교체).
- DB `health`: `PgHealthSnapshot`을 그대로 쓰되 `checks[]`를 `{ id, status: StatusInfo, value, unit, applicable, held, sustained, thresholds }`로 바꾸고(`level`에 지속 조건 적용 → `status`), `overall` 대신 최상위 `status`(쿠버네티스 + DB 내부 최악).
- 민감 필드: 쿼리 원문·클라이언트 주소는 없음(수집 안 함). **DB 사용자 이름·pid·standby 이름은 대시보드 API에 포함, 어드바이저 스냅샷에서 제외**. 접속 오류는 `sanitizeErrorMessage` 한 줄. 모니터링 계정·접속 문자열 없음.
- 판단 이유 코드 표(9절), 에러 코드(10절), 환경 변수(11절).

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `docs/api/common.md` | 추가 | 공통 규약, health, SSE, mock 시나리오 |
| `docs/api/cluster-status.md` | 추가 | cluster-status REST·SSE 계약 |
| `docs/reports/cluster-status/backend.md` | 추가 | 이 보고서 |

(코드 변경 없음)

### 5. 주요 결정과 이유
- **단일 SSE 스트림 + 토픽** (대안: 기능별 스트림 3개). 사이드바가 모든 페이지에서 세 기능 상태를 보여 주므로 기능별이면 탭당 연결 3개 → HTTP/1.1 origin당 6개 제한에 탭 2개로 걸림. 전역 연결 표시도 하나가 단순. 서버는 토픽 구독자 수로 작업을 켜고 끔(브리지 확인 등).
- **heartbeat 15초, 이름 있는 이벤트**. 주석 줄은 EventSource가 화면 코드에 전달하지 않아 끊김 감지에 못 씀. 15초면 watch 데이터 stale 기준(×3 = 45초)이 메트릭·DB와 같아짐.
- **Last-Event-ID 미지원**. 명세가 "재연결 시 전체 스냅샷"을 요구하고, 프론트 훅이 EventSource를 새로 만들어 재연결하므로 브라우저가 헤더를 보내지 않음. 재생 버퍼보다 스냅샷이 단순·일관.
- **상태 값 `warning/critical`**(디자인 키 `warn/crit`과 충돌) — DBA `HealthLevel`과 PM 지시에 맞춤. 프론트 매핑.
- **stale는 상태가 아니라 플래그 + 출처 상태**. 서버가 아는 끊김(`stream.source`)과 서버가 멈춘 경우(화면 타이머, `updatedAt + staleAfterSec`) 둘 다 처리.
- **live에서 설정 없는 출처는 mock으로 바꾸지 않고 unknown** (`CLAUDE.md` "자격 증명 없으면 mock" vs 명세 5절 "live + kubeconfig 없음 → 알 수 없음" 충돌). 기본값 `DATA_SOURCE=mock`이 CLAUDE.md를 충족하고, 명시적 live는 명세를 따름. 뼈대 `shouldUseMock`은 구현 때 수정.
- **페이지네이션은 선택적 `limit/offset`, 기본 전체** (디자인 "페이지네이션 없음" vs PM "페이지네이션"). 실시간 표는 스냅샷 + 가상 스크롤이 정확.
- **mock 시나리오 전환 API 포함**. 세 명세의 수용 기준(모든 상태 재현)을 재시작 없이 확인할 수 있고 디자인이 MOCK 배지 Popover를 이미 설계함.
- **DaemonSet은 파드에서 도출** — RBAC에 daemonsets 없음(명세·디자인과 충돌). CLAUDE.md RBAC를 유지하고 `desired: null`, `source: derived_from_pods`, reason `DAEMONSET_DESIRED_UNKNOWN`. PM 결정 필요.
- **ReplicaSet → Deployment 해석은 `pod-template-hash` 레이블로** (replicasets 권한 없이). Job 파드는 ownerReference kind로.
- **PVC 사용량**: Prometheus 있으면 kubelet 지표, 없으면 DB PVC만 DB 크기 + WAL 근사치, 그 외 null(`nodes/proxy` 추가 안 함, PM 결정).
- **파드 재시작·OOM 이력 24시간 메모리 보관**: API 응답엔 1시간 값만, 24시간은 어드바이저 R-RESTART·R-OOM용.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint:check --prefix apps/api` | 통과 | 코드 변경 없음. `npm run lint`는 `--fix` 포함이라 DBA 파일을 건드릴 수 있어 검사 전용 스크립트 사용 |
| `npm test --prefix apps/api` | 통과 | 6 suites, 41 passed, 1 skipped |
| 계약 JSON 예시 문법 | 수동 검토 | `"...": "..."` 자리표시는 설명용(문서 규칙). 스키마 자동 검증은 하지 않음 |

### 7. 남은 이슈·한계
- DaemonSet 스케줄 부족(`numberReady < desiredNumberScheduled`)은 RBAC 없이 감지 불가.
- PVC 사용률: Prometheus 없으면 DB PVC 외에는 판단 불가. DB PVC도 근사치(실제보다 작게 나옴).
- 메트릭 추이는 `in_memory` 1시간(API 재시작 시 초기화). 6h/24h는 Prometheus가 있을 때만.
- `StatusInfo.stale`은 행마다 upsert로 다시 보내지 않고 `stream.source`로 알린다 → 프론트가 출처 ↔ 토픽 매핑을 알아야 함(문서 8절에 표기).
- `/api/health` `checks` 모양이 뼈대(문자열)에서 객체로 바뀜. 프론트는 `dataSource`만 읽어 영향 없음.
- 스냅샷 크기: 파드 수천 개 규모면 `cluster.snapshot`이 수 MB가 될 수 있다(가정 A1 소규모 기준). 필요 시 토픽 분리(`pods`) 검토.

### 8. 다른 담당 요청
- `PM 요청`: DaemonSet 정확 판단이 필요하면 RBAC에 `apps/daemonsets` get/list/watch 추가 여부 결정(현재는 CLAUDE.md 그대로).
- `frontend 요청`: (1) SSE는 `/api/stream` 단일 스트림(뼈대 예시 `/cluster/stream` 대신), 이벤트 이름·봉투는 `common.md` 5절. (2) `stream.heartbeat`로 끊김 감지(35초 무수신이면 재연결 권장), 재연결 시 `*.snapshot`으로 교체. (3) 상태 `warning→warn`, `critical→crit` 매핑, stale은 `StatusInfo.stale` + `updatedAt + staleAfterSec` 타이머. (4) 합계·상태를 계산하지 말고 서버 값 사용. (5) `useEventSource`에 `reconnecting`·API 불가 구분(디자이너 요청과 같음).
- `designer 요청`: 없음(요청 항목 모두 반영: `status`·`reasons[]`·`updatedAt`·`statusChangedAt`, heartbeat 15초, 영역 집계·사이드바 `nav`, `serverTime`, mock 시나리오 API).
- `DBA 요청`: 없음(cluster-status 범위). `db.thresholds`·`cluster.thresholds` 설정 키를 그대로 사용.

### 9. 다음 담당이 알아야 할 점
- 4단계 구현 시 계약 우선: 응답에 없는 필드를 추가하려면 문서를 먼저 고친다.
- DB 수집: DBA 보고서 9절 루프 그대로, `normalizePgHealth` 결과를 7.4 모양으로 변환(`checks` 매핑, 지속 조건 적용, `overall` 제거, 최상위 `status` 계산, 파드 없음이면 대표 사유를 파드 쪽으로).
- informer: 목록 완료 전 `sync.initialSyncDone: false` 스냅샷 → 완료 후 재전송. watch 끊김이면 `kube` 출처 `stale` + `stream.source`, 재시작 후 `cluster.snapshot` 재전송.
- 시간 경과 재평가(15초)는 **상태가 바뀐 행만** upsert.
- mock 시나리오 ID 목록: `common.md` 6.1 표.

## 2026-09-19 · 구현 (4단계 A 파트: 공통·스트림·클러스터·DB 상태)

### 1. 요청 내용
- PM 요청: 4단계 백엔드 구현 중 **A 파트**(공통/스트림/클러스터/DB 상태). B(`src/cost/**`), C(`src/advisor/**`, `apps/agent-bridge/**`)와 병렬.
- 범위: 공유 확장점 `src/common/extension-points.ts`, 단일 SSE `/api/stream`, mock 시나리오 API, `src/cluster`(informer·metrics·Prometheus·mock·REST·토픽·어드바이저 기여자·`ClusterStateService` export), `src/db-health`, `src/health`, `purgeExpiredData` 일일 스케줄, `deploy/rbac.yaml`, DBA 요청(시드 등록·`.env.example`·env 검증·npm 스크립트).
- 작업 중 추가 요청(PM 경유 B): env 선언(`COST_MONTHLY_BUDGET_USD`, `COST_EXPLORER_METRIC`, `COST_EXPLORER_DAILY_CALL_LIMIT`, `COST_EXPLORER_CACHE_TTL_SEC @Min(3600)`, C의 `ADVISOR_BRIDGE`), mock 메뉴에 대상의 `options`/`defaultScenario` 사용, lint 0건, `ClusterStateService` 시그니처 기록.
- 제약: 새 npm 패키지 설치 금지, `nest build` 금지(dist 충돌), `npm run lint`(--fix) 금지.

### 2. 참고한 문서
- `CLAUDE.md`, `docs/api/common.md`, `docs/api/cluster-status.md`, `docs/specs/cluster-status.md`, `docs/db/health.md`, `docs/reports/cluster-status/dba.md` 8·9절, 이 보고서의 3단계 계약 결정, `docs/reports/bootstrap/backend.md`
- `docs/api/architecture-advisor.md` B.2(`AdvisorSnapshotV1` — PM이 말한 "4b 스키마"는 문서에 해당 절 번호가 없어 B.2로 해석), `docs/specs/architecture-advisor.md` 3.2(사전 점검 규칙이 요구하는 필드)
- 코드: `src/database/health/**`(DBA), `src/database/retention.ts`, `settings-defaults.ts`, `prisma/seed.ts`, `@kubernetes/client-node@2.0.0` 타입(`makeInformer`/`ListWatch` 재연결 동작, `Metrics`, ObjectParam API), `src/cost/cluster-inventory.port.ts`(B의 포트 모양)

### 3. 작업 내용

#### 3.1 공통 (`src/common`)
| 파일 | 내용 |
|---|---|
| `extension-points.ts` | PM이 준 공유 인터페이스 **그대로**. 단 prettier가 80자 넘는 한 줄(`ADVISOR_SNAPSHOT_METADATA = '...'`)을 두 줄로 줄바꿈함(내용 동일, lint 통과용) |
| `status.ts` | `Status`/`Reason`/`StatusInfo`, `worstStatus`(critical>warning>unknown>ok), `StatusChangeTracker`(statusChangedAt), `SustainTracker`(연속 N회 올림·즉시 내림) |
| `source-registry.service.ts` | 출처 상태 저장소 `SourceRegistry`(전역). `update/markSuccess/markFailure`, 상태·오류가 바뀌면 `changes$` → `stream.source`. mock이면 초기 상태 전부 `mock` |
| `api-error.ts` | `ApiException(status, code, message, details?, retryAfterSec?)`, 전역 `ApiExceptionFilter`(계약 3.1 형식, 404 `ROUTE_NOT_FOUND`, 413, 5xx 메시지 숨김, `retryAfterSec` 속성이 있는 HttpException이면 `Retry-After` 헤더), `validationExceptionFactory`(400 `VALIDATION_FAILED` + `details.fields[]`) |
| `list-query.ts` | 쉼표 목록·boolean(`true`/`false`만) 변환, `sort=field:dir` 검증, `limit/offset`(생략 시 전체), 정렬 헬퍼 |
| `settings.service.ts` | settings 테이블 읽기(60초 캐시, DB 없으면 코드 기본값) |
| `discovery.ts` | `SetMetadata` 클래스 데코레이터가 붙은 provider 인스턴스 찾기 |
| `overview-summary.ts` | **추가 확장점**(선택): 개요의 비용·어드바이저 요약 카드 제공자 `@OverviewSummaryProviderDecorator()` — B가 이미 사용 중(개요 `cost` 블록 채워짐) |
| `hash.ts` | 변경 감지용 직렬화(시각 필드 제외) |
| `data-source.ts` | `resolveSourceMode(mode, configured)` 추가(live+설정 없음 = `not_configured`). 기존 `shouldUseMock`은 다른 모듈 호환을 위해 그대로 둠 |

#### 3.2 스트림 (`src/stream`)
- `GET /api/stream?topics=…`: `DiscoveryService`로 `@TopicSourceProvider()` 전부 수집(현재 cluster·metrics·overview·db·cost·advisor 6개 모두 발견). 알 수 없는 토픽이면 스트림을 열기 전에 400, 동시 연결 `SSE_MAX_CLIENTS`(20) 초과면 503 `STREAM_LIMIT_REACHED`.
- 헤더 계약 그대로(`text/event-stream; charset=utf-8`, `no-cache, no-transform`, `X-Accel-Buffering: no`). `retry: 3000` → `stream.hello`(streamId·dataSource·serverTime·heartbeatSec 15·topics·sources) → 토픽별 `*.snapshot`(계약 순서) → 변경분. `id:` 없음.
- 스냅샷 전에 구독을 먼저 걸고, 스냅샷 동안 온 변경은 모았다가 해당 토픽 스냅샷 뒤에 보냄(변경분이 스냅샷보다 먼저 오지 않음). 봉투 `{seq(연결마다 1부터), topic, emittedAt, payload}`.
- 15초 `stream.heartbeat`, `SourceRegistry.changes$` → `stream.source`, 연결 종료 시 구독·타이머 해제, 앱 종료 전 `stream.closing {reason:'shutdown'}`.
- mock 시나리오 API(`GET /api/mock/scenarios`, `PUT /api/mock/scenarios/:group`, `POST /api/mock/reset`): `@MockScenarioTargetProvider()` 대상에 group별 위임. live면 GET은 `enabled:false`, 변경은 403 `MOCK_MODE_ONLY`. 없는 group 404, 없는 시나리오 400. 대상의 선택 필드 `options`(메뉴 이름·설명), `defaultScenario`(reset 기본값), `fastTimers`(getter/함수)·`setFastTimers`를 쓰고, 없으면 계약 6.1 표 문구·기본값. 대상이 던진 HttpException(예: 409 `RUN_ACTIVE`)은 그대로 응답.

#### 3.3 클러스터 (`src/cluster`)
- 구조: `model.ts`(정리된 내부 모델) ← `kube/extract.ts`(live, 허용 목록 복사) / `mock/mock-world.ts`(mock) → `state/cluster-store.ts`(메모리 캐시 + 파드 재시작·OOM 24시간 이력) → `state/evaluate.ts`(명세 3절 판단, 순수 함수) → REST·토픽·어드바이저 기여자. live와 mock이 **같은 판단 코드**를 탄다.
- live informer(`kube/kube-watcher.service.ts`): nodes, pods, events(core v1, Warning만 보관), persistentvolumeclaims, namespaces, services, deployments, statefulsets, daemonsets, ingresses, poddisruptionbudgets, horizontalpodautoscalers(v2). list/watch만. 클러스터 안이면 `loadFromCluster()`, 아니면 `loadFromDefault()`.
  - 끊김(ERROR) → 해당 informer 백오프 재시작(3초→최대 30초). 필수 리소스(노드·파드·이벤트·PVC·Deployment·StatefulSet)가 끊기면 `kube` 출처 `stale`(동기화 전이면 `unavailable`) + `stream.source`, 값은 유지. 전부 재연결되면 `ok` + `cluster/metrics/overview.snapshot` 재전송.
  - 403인 선택 리소스(인그레스·PDB·HPA·DaemonSet·네임스페이스·서비스)는 kube 출처를 막지 않고 5분마다 재시도.
  - `/version`으로 버전, kubeconfig 현재 cluster(EKS ARN이면 이름·리전 추출), `EKS_CLUSTER_NAME` 우선.
- metrics.k8s.io(`kube/metrics-collector.service.ts`): `METRICS_INTERVAL_SEC`(15초). 404/503 → `METRICS_API_UNAVAILABLE`(에러 아님, 사용량 null, `metrics` unavailable), 403 → `METRICS_FORBIDDEN`, 일시 실패(연속 3회 미만) → 값 유지 + stale.
- Prometheus(선택, `PROMETHEUS_URL`): 60초마다 `max by (namespace, persistentvolumeclaim) (kubelet_volume_stats_used_bytes)` → PVC 사용량(`source: prometheus`). Node 내장 `fetch`(새 패키지 없음).
- 판단(`state/evaluate.ts`, 기준값 = settings `cluster.thresholds`): 노드(Ready 60초, 압박, NetworkUnavailable, cordon, CPU·메모리 연속 3회, requests 85%, 파드 수 90/100%, 심각 이벤트), 파드(Pending 2/10분, Failed/Job Failed, Unknown, 치명 대기 사유, ContainerCreating 2분, not-ready 2분, 1시간 재시작 1/3회, OOM, 메모리 limit 80/95% 연속 3회, Terminating 5분, 심각 이벤트), 워크로드(ready/desired, 롤아웃 progressing/ProgressDeadlineExceeded, desired 0 중지됨), 이벤트(심각 reason 규칙, 15분 창), PVC(Pending 2분, Lost, 사용률 75/90%), 클러스터 CPU·메모리 연속 3회, 영역·전체·지금 확인할 항목·nav.
  - 사용률 지속 조건은 **수집 시점**(`state/metrics-ingest.service.ts`)에 적용 → 평가는 결과만 읽음.
  - 재시작 1시간 증가분: 파드별 누적값 변화 이력(24시간 보관). API 시작 후 생성된 파드는 생성 시각부터 관측으로 봄. `restartObservation.fullWindow` = API 가동 1시간 이상.
- REST(`cluster.controller.ts`): `GET /api/overview`, `/cluster/summary`, `/cluster/attention`, `/cluster/nodes`(+`/:name`), `/cluster/workloads`(+`/:kind/:namespace/:name`), `/cluster/pods`(+`/:namespace/:name`), `/cluster/events`, `/cluster/pvcs`, `/cluster/metrics`, `/cluster/metrics/series`. 필터·정렬·`counts`·`facets`·`areaStatus`·`thresholds` 계약대로. 상세 조회는 kube가 `not_configured`/`unavailable`/최초 동기화 전이면 503 `SOURCE_UNAVAILABLE`(syncing은 `Retry-After: 2`), stale이면 캐시로 200.
- SSE 토픽(`cluster-topics.ts`):
  - `cluster`: 평가(500ms 창으로 합침 + 15초 재평가)마다 이전에 보낸 행과 비교해 **바뀐 행만** `cluster.{node,workload,pod,event,pvc}.upsert/delete`. 사용량만 바뀐 경우(노드 `usage`, 파드 `usage`/`memoryLimitPct`/`cpuRequestPct`)와 파드 `restarts.observedSec`는 비교에서 제외. 영역 변화 → `cluster.summary.updated`.
  - `metrics`: 수집마다 `metrics.updated`(클러스터 합계·추이 점·노드·파드 사용량), 스냅샷에 최근 1시간 클러스터 추이.
  - `overview`: 1초 debounce 후 바뀌었을 때만 `overview.updated`(전체 교체).
- mock(`mock/mock-cluster.service.ts`, group `cluster`): 시나리오 `mixed`(기본)·`healthy`·`warning`·`critical`·`no-metrics`·`kube-stale`·`no-cluster`·`empty`. 노드 6·워크로드 13·파드 약 35(Job 파드 포함)·PVC·서비스·인그레스·PDB·HPA·Warning 이벤트. 15초마다 사용량 흔들림, CrashLoop 파드 약 5분마다 재시작(재시작 수·OOM 증가), BackOff 이벤트 횟수 증가. 시작·시나리오 변경 시 최근 1시간 추이를 미리 채우고 재시작 이력을 심어 "최근 1시간 재시작 6회"가 바로 보임. 시나리오 변경 시 `cluster/metrics/overview.snapshot` 재전송.
- 어드바이저 기여자 `ClusterAdvisorSnapshot`(section `cluster`): B.2의 `cluster`·`nodeGroups`·`nodes`·`workloads`(이미지는 레지스트리 호스트·digest 제거, requests/limits, 추이 기반 avg/max, probe, security, podSecurity, PDB·HPA, 24시간 재시작·OOM, 표준 레이블 5개만)·`storage`·`events.byReason`(개수만) + `observationSec`·`loadBalancerAttachments`(Service/Ingress 이름만). env·command/args·어노테이션·secrets·IP·LB 호스트 이름 없음. 이름은 원문(가명·비밀값 검사·규모 제한은 C 몫). 비용 필드는 null(B가 채움).

#### 3.4 DB 상태 (`src/db-health`)
- live: `MONITOR_DB_URL` **와** `DB_TARGET_NAMESPACE`/`DB_TARGET_STATEFULSET`가 모두 있어야 configured(계약 7.4 변형). pg `Pool` + `PG_MONITOR_CONNECTION_DEFAULTS`. DBA 루프 그대로(`pg-collector.ts`): 한 커넥션, 쿼리마다 `pgQueryTransaction`(READ ONLY + SET LOCAL), `pgQueryParams`, `server_info` 왕복 = responseMs, 개별 실패는 `raw.errors`, `database_sizes` 5분·`replication_slots` 60초(안 돈 주기엔 직전 슬롯 재사용), primary/standby 분기, 이전 주기 진행 중이면 건너뜀. 접속 실패·시간 초과 → `pgUnreachableSnapshot(err, {prev, timedOut})`.
- `normalizePgHealth(raw, {prev, thresholds, expectedStandbys})`: 기대 standby = `MONITOR_DB_EXPECTED_STANDBYS` → 없으면 StatefulSet `replicas - 1`. 기준값 = settings `db.thresholds`.
- `sustained: true` 지표는 연속 3회 적용, `held`는 직전 상태 유지. 45초(간격×3) 넘게 수집이 없으면 `monitoredDb` stale + 모든 check `stale: true`.
- `GET /api/cluster/db`(항상 200): 계약 7.4 모양 — `health`는 `PgHealthSnapshot`에서 `overall` 제거, `checks[]`를 `{id, status: StatusInfo, value, unit, applicable, held, sustained, thresholds}`로. 최상위 `status` = 쿠버네티스(StatefulSet·파드·PVC) + DB 내부 최악, 파드가 없거나 ready 0이면 `DB_POD_NOT_READY`를 대표 사유로 두고 접속 실패는 뒤로. kube 출처가 없으면 쿠버네티스 쪽은 unknown(파드 없음으로 오판하지 않음). `pvcUsage`는 DB PVC 사용량(Prometheus 또는 DB 크기+WAL 근사치).
- 클러스터 모듈과의 순환을 피하려고 `ClusterStateService.registerDbAreaProvider(this)`로 등록 → 개요 `areas.db`·nav·지금 확인할 항목·DB PVC 근사 사용량에 반영.
- 토픽 `db`: 수집마다 또는 DB 쪽 쿠버네티스·상태가 바뀔 때 `db.updated`(전체 교체).
- mock(group `db`): `warning`(기본)·`ok`·`critical`·`unreachable`·`no-pod`·`standby`·`stale`·`not-configured`. DBA 픽스처를 15초마다 흔들어(카운터 누적, 경과 시간 5분 주기로 오르내림) **실제 `normalizePgHealth`에 통과**. 시작 시 표본 4개로 지속 조건·카운터 차이가 바로 보이게 함.
- 어드바이저 기여자 `DbAdvisorSnapshot`(section `db`): B.2 `db` 블록(버전·replicas·PVC 사용률·연결 현재/1시간 최대·긴 쿼리 수·캐시 적중률·xid·DB별 크기·QoS/requests/limits·스팟 여부). **DB 사용자 이름·pid·standby/슬롯 이름·오류 문자열 없음.**

#### 3.5 health·보존 (`src/health`)
- `GET /api/health`: 계약 4절 모양(`status ok|degraded`, `version`, `serverTime`, `startedAt`, `checks.{kube,metrics,prometheus,monitoredDb,aws,costExplorer,agentBridge,dashboardDb}` 각 `{state, configured, message, checkedAt}`). 요청 시 외부 호출 없음(캐시).
  - kube·metrics·prometheus·monitoredDb·costExplorer: `SourceRegistry`. aws: B가 `awsResources/pricing/spotPrice`를 갱신하면 최악값, 아니면 리전 + 자격 증명 **존재 여부**(환경 변수·IRSA·컨테이너 자격 증명·`~/.aws`). agentBridge: C가 registry를 갱신하면 그 값, 아니면 live에서 30초마다 `GET {AGENT_BRIDGE_URL}/health`(3초 타임아웃, `x-bridge-token`) 결과 캐시. dashboardDb: Prisma 연결 여부.
  - mock이면 모든 check `{state:'mock', configured:false}`.
- `RetentionService`: `@Cron('0 4 * * *')` 매일 04:00 `purgeExpiredData(prisma, now, settings.retention)`(대시보드 DB 연결 시만). `closeInterruptedAdvisorRuns`는 C 몫이라 부르지 않음.

#### 3.6 main·설정·배포
- `main.ts`: 전역 `ApiExceptionFilter`, `ValidationPipe({whitelist, transform, exceptionFactory})`, JSON 본문 1MB 제한(413), CORS 계약값(메서드 `GET/POST/PUT/PATCH/OPTIONS`, 헤더 `Content-Type`, 노출 `Retry-After`, credentials false).
- `config/env.validation.ts` 추가: `EKS_CLUSTER_NAME`, `SYSTEM_NAMESPACES`, `DB_TARGET_NAMESPACE`/`DB_TARGET_STATEFULSET`(형식 + **둘 다 있거나 둘 다 없음**), `MONITOR_DB_URL`(postgres:// 형식), `MONITOR_DB_EXPECTED_STANDBYS`(0~32), `DB_HEALTH_INTERVAL_SEC`·`METRICS_INTERVAL_SEC`(5~300, 기본 15), `PROMETHEUS_URL`(http(s)), `SSE_MAX_CLIENTS`(기본 20), `COST_MONTHLY_BUDGET_USD`(>0), `COST_EXPLORER_METRIC`(Unblended/Amortized), `COST_EXPLORER_DAILY_CALL_LIMIT`(1~1000), `COST_EXPLORER_CACHE_TTL_SEC` `@Min(3600)`, `ADVISOR_BRIDGE`(mock|live). 비용·어드바이저 값은 선택이고 기본값을 두지 않음(B·C의 settings 우선순위와 충돌 방지).
- `deploy/rbac.yaml`: 네임스페이스 `sentinel`, SA `sentinel-api`, ClusterRole `sentinel-readonly`(core pods/nodes/namespaces/events/persistentvolumeclaims/services, apps deployments/statefulsets/daemonsets, networking ingresses, policy PDB, autoscaling HPA, metrics.k8s.io pods/nodes — 전부 get/list/watch), ClusterRoleBinding. secrets·configmaps·nodes/proxy·쓰기 동사 없음.
- `deploy/app.example.yaml`(선택): api·web Deployment + ClusterIP Service 예시(비밀값은 Secret, 외부 노출 금지, runAsNonRoot·readOnlyRootFilesystem).
- DBA 요청: `prisma.config.ts`에 `migrations.seed = 'ts-node --transpile-only prisma/seed.ts'`, `package.json` 스크립트 `db:migrate`(deploy), `db:migrate:dev`, `db:migrate:status`, `db:seed`(`prisma db seed`), `db:setup`(deploy + seed). 루트 `.env.example`에 `MONITOR_DB_URL=postgres://sentinel_monitor:<password>@host.docker.internal:15432/postgres?application_name=sentinel-monitor` + port-forward 주석, DB 대상·기대 standby·간격·SSE·비용·어드바이저 변수. `docker-compose.yml` api 환경 변수 동기화.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/common/{extension-points,status,source-registry.service,api-error,list-query,settings.service,discovery,overview-summary,hash}.ts` | 추가 | 공유 확장점·상태·출처·에러·목록·설정 |
| `apps/api/src/common/{data-source,common.module}.ts` | 수정 | `resolveSourceMode`, `SourceRegistry`·`SettingsService` 전역 제공 |
| `apps/api/src/stream/{stream.service,stream.controller,mock-scenario.service,mock-scenario.controller,stream.module}.ts` | 추가/수정 | SSE·mock 시나리오 |
| `apps/api/src/cluster/{model,types,dto,cluster-query.service,cluster.controller,overview.service,cluster-topics,cluster-advisor.snapshot,cluster.module}.ts` | 추가/수정 | 클러스터 API·토픽·기여자 |
| `apps/api/src/cluster/kube/{extract,quantity,kube-watcher.service,metrics-collector.service}.ts` | 추가 | informer·metrics·Prometheus |
| `apps/api/src/cluster/state/{cluster-store,metrics-store,metrics-ingest.service,evaluate,cluster-state.service}.ts` | 추가 | 캐시·판단 |
| `apps/api/src/cluster/mock/{mock-world,mock-cluster.service}.ts` | 추가 | mock 클러스터 |
| `apps/api/src/db-health/{pg-collector,db-mock,db-health.service,db-topics,db-health.controller,db-health.module}.ts` | 추가/수정 | DB 상태 |
| `apps/api/src/health/{health.service,health.module,retention.service}.ts` | 수정/추가 | health 정식 계약, 보존 정리 |
| `apps/api/src/config/env.validation.ts` | 수정 | 새 변수·검증 |
| `apps/api/src/main.ts` | 수정 | 필터·검증·CORS·본문 제한 |
| 테스트 `*.spec.ts` | 추가/수정 | `common/status`, `cluster/kube/quantity`, `cluster/state/evaluate`, `cluster/cluster-advisor.snapshot`, `stream/stream.service`, `stream/mock-scenario.service`, `db-health/db-mock`, `config/env.validation`, `health/health.service` |
| `apps/api/prisma.config.ts` | 수정 | seed 등록 |
| `apps/api/package.json` | 수정 | `db:*` 스크립트 5개 (의존성 변경 없음) |
| `deploy/rbac.yaml`, `deploy/app.example.yaml` | 추가 | RBAC·배포 예시 |
| `.env.example`, `docker-compose.yml` | 수정 | 변수 추가 |

### 5. 주요 결정과 이유
- **DaemonSet은 watch**: 3단계 계약은 RBAC에 daemonsets가 없어 "파드에서 도출"로 적었지만, 현재 `CLAUDE.md` RBAC 목록에 daemonsets가 있으므로 informer로 받고 명세 3.3 규칙을 그대로 적용(`source: 'watch'`, `DAEMONSET_DESIRED_UNKNOWN` 안 씀). 계약 문서 갱신 필요(8절).
- **live·mock 공용 판단**: mock도 같은 내부 모델을 만들어 같은 `evaluateCluster`/`normalizePgHealth`를 통과 → mock에서 본 규칙이 live와 같다.
- **지속 조건은 수집 시점에 적용**: 재평가·REST 호출 횟수와 무관하게 "연속 3회"가 표본 수 기준으로 정확.
- **변경분 비교 기준은 전역 1개**: 스냅샷을 만들 때 기준을 스냅샷 값으로 맞춤. 스냅샷 중 온 변경은 버퍼 후 전달(행 전체 교체라 중복 수신해도 결과 동일).
- **DB 영역은 등록 방식**: ClusterModule ↔ DbHealthModule 순환 import를 피하려고 `DbAreaProvider`를 `ClusterStateService`에 등록. 평가 중 호출되므로 인자로 받은 쿠버네티스 항목만 사용(재귀 방지).
- **overview 비용·어드바이저 블록**: 공유 인터페이스에 없어 `common/overview-summary.ts` 선택 확장점 추가(extension-points.ts는 그대로). 제공자가 없으면 `available:false` + unknown.
- **LB 호스트 이름**: 비용 모듈의 ELB 매칭용으로 내부 모델에만 보관, API 응답·어드바이저 스냅샷에는 내보내지 않음.
- **PVC ↔ EBS 볼륨 ID**: persistentvolumes 권한이 없어 `volumeHandle`은 항상 null(비용 모듈이 볼륨 태그로 대조).
- **BackOff "10분 안 5회"**: 집계 이벤트에 개별 시각이 없어 `count × 600 / (lastSeen−firstSeen) ≥ 5`(또는 10분 이내 5회)로 근사.
- **추이 range**: in-memory 1시간만(6h/24h는 400). Prometheus 추이 쿼리는 이번 범위에서 구현하지 않음(PVC 사용량만).

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npm run lint:check --prefix apps/api` | 통과 (0건) | 내 폴더만 경로 지정해 `npx eslint --fix`. B·C 폴더는 건드리지 않음 |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | 통과 | 중간에 B 폴더 타입 오류가 잠시 보였으나 최종 0건 |
| `npm test --prefix apps/api` | 통과 | 27 suites, 262 passed, 1 skipped |
| `npm run test:e2e --prefix apps/api` | 통과 | `/api/health` (mock) |
| mock 기동 (`tsc --outDir apps/api/.tmp-a-dist` → `node`, `PORT=3011`) | 통과 | `nest build` 대신 임시 폴더로 컴파일, 확인 후 삭제. REST 13개 전부 200 |
| `/api/cluster/summary` (mixed) | 확인 | overall critical: NotReady 노드 3분, `prod/api` ready 0/3, CrashLoopBackOff·최근 1시간 재시작 6~7회, 심각 이벤트, DB warning(연결 83%), metrics ok |
| 시나리오 전환 | 확인 | healthy/warning/no-metrics(metrics unknown)/kube-stale(stale 플래그)/no-cluster(unknown "클러스터 연결 없음")/empty(노드 0개 critical), db 8종(no-pod 대표 사유 파드 쪽, stale 플래그, not-configured unknown) |
| 오류 형식 | 확인 | 400 `VALIDATION_FAILED`(fields), 404 `RESOURCE_NOT_FOUND`/`ROUTE_NOT_FOUND`, 시나리오 400/404 |
| `curl -N /api/stream?topics=cluster,db` 34초 | 확인 | 헤더 계약 일치, retry → hello → cluster.snapshot → db.snapshot → 변경분, heartbeat 15초, seq 1..181 연속, `podIP`·env·어노테이션 없음 |
| 스트림 중 시나리오 변경 | 확인 | 변경분 뒤 `cluster/metrics/overview.snapshot` 재전송 |
| `npx prisma db seed` (DATABASE_URL 없음) | 확인 | 시드 명령 연결 동작("DATABASE_URL이 없어 시드를 건너뜁니다"로 종료) |
| live 모드 실제 클러스터·Postgres | **생략** | 이 PC에 kubeconfig·클러스터·대상 DB 없음. informer/metrics/pg 경로는 타입·단위 테스트까지만 |
| `docker compose` | **생략** | Docker 없음 |

- 첫 스트림 확인에서 파드 upsert가 틱마다 전부 나가는 문제 발견(`restarts.observedSec`가 계속 늘어남) → 비교에서 제외 후 재확인(틱당 실제 바뀐 행만).

### 7. 남은 이슈·한계
- live 경로(informer 재연결·403 처리, metrics-server 404 판별, pg 수집)는 실제 클러스터에서 확인하지 못함. `@kubernetes/client-node` 2.0 오류 객체에서 HTTP 상태 코드를 뽑는 부분(`code`/`statusCode`/메시지 정규식)은 실제 응답으로 검증 필요.
- 추이는 in-memory 1시간(재시작 시 초기화). Prometheus 추이(6h/24h) 미구현 → `range≠1h`는 400.
- 컨테이너별 1시간 재시작·어드바이저 컨테이너별 사용량은 파드 합계를 비율로 나눈 근사.
- mock 시나리오 전환 시 diff 이벤트가 스냅샷 직전에 한 번 더 나감(최종 상태는 스냅샷이 덮어씀, 트래픽만 조금 더).
- `POST /api/mock/reset`은 공유 인터페이스상 각 대상의 `setScenario(기본값)`만 호출("mock 시계열·이력 재생성"은 대상이 setScenario 안에서 처리 — cluster·db는 그렇게 동작).
- 개요 `nav.advisor`는 어드바이저 요약 제공자가 없으면 unknown(현재 C는 `OverviewSummaryProvider`를 등록하지 않은 것으로 보임 → `advisor.available:false`).

### 8. 다른 담당 요청
- `PM 요청`: (1) B의 `CLUSTER_INVENTORY_PORT`에 `ClusterStateService.inventorySnapshot()` + `changes$`를 연결하는 어댑터 provider 결정(9절, 모양이 포트와 같음). (2) C가 개요 카드용 `@OverviewSummaryProviderDecorator()`(`src/common/overview-summary.ts`, section `advisor`)를 등록하도록 전달. (3) 공유 인터페이스 보강 검토: `MockScenarioTarget`의 선택 필드 `options?`, `defaultScenario?`, (advisor) `fastTimers?`/`setFastTimers?` — 지금은 구조적으로 읽음. (4) `extension-points.ts`는 prettier 줄바꿈 1곳만 바뀜(내용 동일).
- `PM 요청(계약)`: `docs/api/cluster-status.md` 1.2·6.1·12절의 DaemonSet 설명을 "watch(`source: 'watch'`), 명세 3.3 규칙 적용"으로 갱신. 이번 A 쓰기 영역에 `docs/api`가 없어 남김.
- `frontend 요청`: SSE는 `/api/stream` 하나(토픽 6개 모두 제공). 사용량은 `metrics.updated`로 갱신(사용량 변화만으로는 `cluster.*.upsert`가 오지 않음). 파드 "관측 N분"은 `restartObservation`(summary 이벤트)으로 표시.
- `DBA 요청`: 없음(요청 4건 반영).

### 9. 다음 담당이 알아야 할 점
- **`ClusterStateService`**(`apps/api/src/cluster/state/cluster-state.service.ts`, `ClusterModule`에서 export). 모두 메모리 캐시만 읽는다(쿠버네티스 API 호출 없음).
  ```ts
  listNodes(): ClusterNodeInfo[]
  // { name, instanceType, zone, region, nodeGroup, capacityType: 'on_demand'|'spot'|null, architecture,
  //   providerId: string|null, instanceId: string|null, createdAt, ready: boolean, unschedulable,
  //   allocatable: {cpuMillicores, memoryBytes, pods}, capacity: {...}, usage: {cpuMillicores, memoryBytes}|null }
  listPods(opts?: { includeCompleted?: boolean }): ClusterPodInfo[]
  // { namespace, name, nodeName, phase, completed, isSystemNamespace, owner: {kind, name, workloadKey}|null, qosClass,
  //   requests/limits: {cpuMillicores|null, memoryBytes|null} (컨테이너 합, 하나라도 없으면 null),
  //   containers: [{name, requests, limits}], usage|null, pvcClaims: string[], createdAt }
  listPvcs(): ClusterPvcInfo[]
  // { namespace, name, phase, capacityBytes, requestedBytes, storageClass, volumeName, mountedByPods, isDbVolume, usagePct, usageSource }
  listServices(): ClusterServiceInfo[]   // { namespace, name, type, hasLoadBalancer, lbHostnames: string[], loadBalancerClass }
  listIngresses(): ClusterIngressInfo[]  // { namespace, name, ingressClass, hasLoadBalancer, lbHostnames: string[] }
  inventorySnapshot(): ClusterInventoryView
  // src/cost/cluster-inventory.port.ts `ClusterInventorySnapshot`과 같은 모양
  // (state: kube 출처 상태, mock→'ok' / pods는 requests 합 / volumeHandle은 항상 null)
  clusterInfo(): { name, version, region, connected }
  kubeState(): SourceState
  thresholds(): settings `cluster.thresholds` 값
  getView(): ClusterView   // 평가된 NodeItem/PodItem/WorkloadItem/EventItem/PvcItem·areas·attention (API 항목 모양)
  readonly changes$: Observable<void>   // 평가할 때마다 (최대 500ms에 1회 + 15초마다) — 비용 쪽은 debounce 권장
  readonly view$, resync$               // 토픽용
  registerDbAreaProvider(p), setPvcUsageFromPrometheus(v), schedule(), requestResync()   // 내부 협력용
  ```
  어댑터 예: `{ provide: CLUSTER_INVENTORY_PORT, inject: [ClusterStateService], useFactory: (s) => ({ snapshot: () => s.inventorySnapshot(), changes$: s.changes$ }) }` (CostModule이 ClusterModule을 import해야 함. mock에서는 B 자체 mock 인벤토리를 계속 써도 됨).
- **출처 상태**: `SourceRegistry.update/markSuccess/markFailure`로 올리면 `stream.source`·`/api/health`에 자동 반영(B: awsResources·pricing·spotPrice·costExplorer, C: agentBridge).
- **에러**: `ApiException`(common) 또는 `status/code/message/details`를 가진 HttpException이면 전역 필터가 계약 형식으로 바꾼다. `retryAfterSec` 속성이 있으면 `Retry-After` 헤더도 붙인다.
- **mock 시나리오**: 대상에 `options`(메뉴 이름·설명), `defaultScenario`를 두면 그대로 쓴다. `setScenario`에서 HttpException을 던지면 그대로 응답된다.
- live 실행 전 준비: `kubectl apply -f deploy/rbac.yaml`(클러스터 안 배포 시), 로컬은 kubeconfig 사용자에게 같은 읽기 권한. DB는 `docs/db/monitor-account.sql`로 계정 생성 → port-forward 15432 → `.env`에 `MONITOR_DB_URL`·`DB_TARGET_*`.

### 10. 추가 반영 (같은 날, C 완료 후 PM 요청)
- env 선언(`env.validation.ts`·`.env.example`·`docker-compose.yml`): `ADVISOR_OUTPUT_MODE`(structured|text), `ADVISOR_SLOW_AFTER_SEC`(10~3600), `ADVISOR_TIMEOUT_SEC`(20~7200), `ADVISOR_MAX_BUDGET_USD`(0.01~100). `ADVISOR_BRIDGE`·`SYSTEM_NAMESPACES`는 이미 선언됨. advisor가 "env > settings > 기본값"을 스스로 판단하므로 검증에는 **기본값을 넣지 않고** 주석에 기본값(300/600/2.0/structured/mock)만 적었다.
- mock `fastTimers`: advisor 대상의 `fastTimers` getter와 `setFastTimers()`를 공통 mock API가 이미 사용(`GET`의 advisor 그룹 `fastTimers`, `PUT /api/mock/scenarios/advisor` 본문 `fastTimers`). 테스트 추가.
- 어드바이저 기여자 형태를 `src/advisor/snapshot/snapshot.types.ts`(`ClusterContribution`, `SnapshotDb`)와 대조:
  - cluster: `cluster`(version을 모르면 생략), `nodeGroups`, `nodes`, `workloads`, `storage`, `events.byReason`, `observationSec` 일치. **`loadBalancers`(SnapshotLoadBalancer) 추가**: LoadBalancer 타입 Service마다 1개(`type`: `loadBalancerClass`/`aws-load-balancer-type` 어노테이션을 해석해 nlb, 아니면 clb), ALB 인그레스(`ingressClassName`/`kubernetes.io/ingress.class`에 alb)는 1개씩, `alb.ingress.kubernetes.io/group.name`이 같으면 하나로 묶음. `ref`는 `lb-<n>` 가명, `healthyTargets`·`usdPerMonth`는 null(비용 쪽이 채움). `unattachedVolumes: []`. 어노테이션 원문은 보관하지 않고 해석한 값(`lbType`, `isAlb`, `albGroup`)만 내부 모델에 둔다. 이전 `loadBalancerAttachments` 필드는 제거.
  - db: `SnapshotDb` 모양과 일치(변경 없음).
  - 확인: mock 기동 후 `GET /api/advisor/snapshot-preview` → `loadBalancers` 3개(clb grafana, nlb api, alb web), `db` 블록 정상, `cluster.version` "1.30".
- 검증: `lint:check` 0건, `tsc --noEmit` 0건, `npm test` 28 suites / 266 passed / 1 skipped.

---

## 2026-09-19 · 모듈 연결 (4단계 마무리, 요약)

상세: [aws-cost/backend.md "모듈 연결"](../aws-cost/backend.md) (파일 끝 "2026-09-19 · 모듈 연결" 섹션)

- **공유 인터페이스**: `MockScenarioTarget`(`src/common/extension-points.ts`)에 선택 필드 `options?`, `defaultScenario?`, `readonly fastTimers?: boolean`, `setFastTimers?(value)`를 정식으로 선언했다. `mock-scenario.service.ts`는 구조적 캐스트 대신 인터페이스 필드를 읽는다(`fastTimers` 함수 형태만 호환 타입으로 남김). cluster·db·cost·advisor 구현체 모두 수정 없이 컴파일된다(advisor 파일은 수정하지 않음).
- **ClusterStateService**: `inventorySnapshot().pvcs[].phase` 추가(비용 포트의 선택 필드 `InventoryPvc.phase`). `CostModule`이 `ClusterModule`을 import하고 `ClusterStateInventoryAdapter`로 연결한다(순환 없음). 어댑터는 `changes$`를 노드·PVC·LB·상태 지문이 바뀔 때만 넘긴다(15초 재평가를 그대로 넘기면 live에서 AWS 호출이 30초마다 생김).
- **cluster mock**: 노드 providerID를 EC2 ID 형식(`i-0` + 16진수)으로 수정. 이전 값으로는 `listNodes().instanceId`가 null이었다.
- **계약**: `docs/api/cluster-status.md` 1.2·6.1·9·12절의 DaemonSet을 watch 기준으로 정정(`desired` = `desiredNumberScheduled`, `source: 'watch'`, `DAEMONSET_DESIRED_UNKNOWN` 폐기), 13절 변경 이력 신설. `docs/api/common.md` 6.1에 cluster → cost mock 관계, 8절 변경 이력(응답 모양 변경 없음).
- **env**: `ADVISOR_MAX_TURNS`(선택, 정수 1~5, 기본값 없음). `env.validation.ts`, `.env.example`, `docker-compose.yml`에 반영.
- 검증: lint:check 0건, tsc 0건, test 29 suites/285 passed/1 skipped, build 성공, mock :3031에서 클러스터·비용 노드 6개 일치.
