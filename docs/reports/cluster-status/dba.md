# cluster-status · dba 작업 보고

## 2026-09-19 11:30 · DB 상태 조회 쿼리·모니터링 계정 (2단계 설계)

### 1. 요청 내용
- PM이 `/feature` 2단계(DBA)를 요청.
- 범위: 모니터링 대상 DB(클러스터 안 Postgres StatefulSet)의 상태 조회 쿼리를 cluster-status 명세 3.7 기준에 맞춰 만든다.
  - `docs/db/health.md`: 쿼리별 목적·SQL·결과 필드·단위·정상/주의/장애 판단값·권장 조회 간격·statement_timeout
  - `apps/api/src/database/health/`: 벤더별(postgres 우선) 순수 모듈(SQL 상수, 결과 타입, 정규화 순수 함수), 쿼리 본문 잘라내기·민감값 가림 헬퍼, mock 픽스처(정상/주의/장애)
  - `docs/db/monitor-account.sql`: 모니터링 전용 계정(pg_monitor, 읽기 전용, 연결 수 제한, statement_timeout 기본값)과 StatefulSet 적용 방법(kubectl exec 예시는 문서로만)
- 실행·스케줄링은 backend 몫. `package.json`은 수정하지 않는다.
- 작업 중 PM 추가 지시: Prisma 7.10.0 기준, 스키마 datasource/generator는 backend 형식 유지, `src/database/prisma.service.ts`는 DBA가 인수.

### 2. 참고한 문서
- `CLAUDE.md`, `docs/HANDOFF.md`
- `docs/specs/cluster-status.md` (0절 A2·A7·A8, 3.0, 3.7, 4절, 5절 DB 수용 기준, 7절 DBA)
- `docs/specs/architecture-advisor.md` 3.3·3.4 (DB 스냅샷 항목, 제외 규칙: 쿼리 원문·DB 사용자·클라이언트 주소)
- `docs/reports/cluster-status/planner.md`, `docs/reports/bootstrap/backend.md`
- 기존 코드: `apps/api/src/config/env.validation.ts`(`MONITOR_DB_URL`), `apps/api/src/database/prisma.service.ts`

### 3. 작업 내용
1. 명세 3.7의 DB 내부 지표 9개를 판단 항목(check id)으로 정리: 접속·응답 시간, 연결 사용률, 오래 실행 쿼리, idle in transaction, 잠금 대기, 캐시 적중률(증가분), 데드락(증가분), 트랜잭션 ID 나이, 복제 지연.
2. 지표를 얻는 쿼리 10개 작성(`postgres/queries.ts`): `server_info`, `activity_summary`, `sessions_top`, `lock_waits`, `database_stats`, `database_sizes`, `replication_primary`, `replication_slots`, `replication_standby`, `table_sizes`(선택·무거움).
   - `pg_stat_activity`는 한 번 스캔(`activity_summary`)으로 상태별 분포 + 오래 실행 쿼리(`$1`,`$2`)·idle in transaction(`$3`,`$4`) 기준 초과 건수를 함께 센다.
   - 쿼리 원문·`client_addr`·`client_hostname`·`application_name`(세션)·`pg_stat_wal_receiver.conninfo`는 **선택하지 않는다**.
   - `pg_blocking_pids()`는 대기 행(최대 20)에만 호출.
   - standby에서 오류가 나는 `pg_current_wal_lsn()` 쿼리는 `runOn: 'primary'`로 표시.
3. 쿼리마다 메타데이터(`PG_HEALTH_QUERIES`: 주기, statement_timeout, heavy, runOn, perDatabase, 최소 버전)와 `pgQueryTransaction(timeoutMs)`(READ ONLY 트랜잭션 + `SET LOCAL statement_timeout/lock_timeout`), 권장 커넥션 옵션(`PG_MONITOR_CONNECTION_DEFAULTS`) 제공.
4. 정규화 순수 함수(`postgres/normalize.ts`):
   - `normalizePgHealth(raw, { prev, thresholds, expectedStandbys })` → `{ snapshot, next }`. 누적 카운터 차이(초당 커밋/롤백, 캐시 적중률, 데드락 증가)는 직전 상태(`next`)를 다음 호출에 넘겨 계산.
   - 첫 표본·통계 리셋·블록 1,000 미만이면 판단 보류(`held`)하고 직전 상태 유지(명세 3.7).
   - 쿼리 부분 실패 시 해당 판단만 `unknown`.
   - 판단 이유 문구를 명세 수용 기준과 맞춤(예: `연결 92% (max 100)`).
   - `pgUnreachableSnapshot()`(접속 실패=장애, 나머지 unknown, 오류 메시지 가림), `approxPvcUsagePct()`(PVC 근사치).
5. 공통 모듈(`types.ts`, `sanitize.ts`): `HealthLevel`, `HealthCheckResult`, `worstLevel()`(장애 > 주의 > 알 수 없음 > 정상), `sanitizeQueryText`(리터럴·주석 가림 + 120자), `redactSecrets`/`redactConnectionString`, `sanitizeErrorMessage`(SQLSTATE 접두, 200자).
6. mock 픽스처(`postgres/fixtures.ts`): 정상/주의/장애 각 1세트(15초 간격 원시 표본 2개씩) + 접속 불가(인증 실패). `buildPgFixtureSnapshot(name)`이 정규화까지 끝낸 스냅샷을 준다.
7. 단위 테스트 2개 파일(`normalize.spec.ts`, `sanitize.spec.ts`, 30건). 작업 중 `activity_summary`가 idle in transaction에도 오래 실행 쿼리 기준을 같이 쓰던 문제를 발견해 파라미터를 $3/$4로 분리하고, 기준값에서 파라미터를 만드는 `pgQueryParams()`와 "SQL 파라미터 수 = 헬퍼 결과 길이" 테스트를 추가.
8. 모니터링 계정 SQL(`docs/db/monitor-account.sql`): 멱등, 비밀번호는 psql 변수로 표준 입력 전달, `pg_monitor` + CONNECT, `CONNECTION LIMIT 3`, 역할 기본값(`default_transaction_read_only=on`, `statement_timeout=5s`, `lock_timeout=1s`, `idle_in_transaction_session_timeout=10s`), 세션 내 `log_statement='none'`으로 비밀번호 로그 방지, 확인 쿼리, 되돌리기.
9. `docs/db/health.md`: 실행 규칙, 쿼리별 SQL·필드·단위·판단, 판단 기준 표, 민감값 처리, 계정 적용 절차(kubectl exec·port-forward·pg_hba), PVC 근사치 방법, 픽스처, 한계.
10. 검증: PGlite(Postgres 17.5 WASM 엔진, `prisma` 의존성에 포함된 `@electric-sql/pglite`)로 10개 쿼리 전부를 실제 실행하고, node-postgres 드라이버로 수집 → `normalizePgHealth` 두 번 호출까지 end-to-end 확인. 계정 SQL의 핵심 문장도 실행해 권한 확인.

### 4. 변경 파일
| 경로 | 구분 | 내용 |
|---|---|---|
| `apps/api/src/database/health/types.ts` | 추가 | 벤더 공통 타입, `worstLevel()` |
| `apps/api/src/database/health/sanitize.ts` | 추가 | 쿼리 원문·접속 문자열·오류 메시지 가림/잘라내기 |
| `apps/api/src/database/health/sanitize.spec.ts` | 추가 | 테스트 |
| `apps/api/src/database/health/postgres/queries.ts` | 추가 | SQL 10개, 메타데이터, 트랜잭션 헬퍼, 커넥션 기본값 |
| `apps/api/src/database/health/postgres/types.ts` | 추가 | 행 타입, 원시 표본, 정규화 결과, 기준값 타입 |
| `apps/api/src/database/health/postgres/normalize.ts` | 추가 | 정규화·판단 순수 함수, 기본 기준값 |
| `apps/api/src/database/health/postgres/normalize.spec.ts` | 추가 | 테스트 |
| `apps/api/src/database/health/postgres/fixtures.ts` | 추가 | mock 픽스처 |
| `apps/api/src/database/health/index.ts` | 추가 | re-export |
| `docs/db/health.md` | 추가 | 상태 조회 쿼리 문서 |
| `docs/db/monitor-account.sql` | 추가 | 모니터링 계정 생성 SQL |

(스키마 관련 변경은 `docs/reports/aws-cost/dba.md`, `docs/reports/architecture-advisor/dba.md` 참조)

### 5. 주요 결정과 이유
- **쿼리 원문은 아예 가져오지 않음** / 대안: `left(query, N)` 후 마스킹 / 이유: 명세 가정 A7·수용 기준("세션 목록에 쿼리 원문이 나오지 않는다"), 가져오지 않으면 API 밖으로 샐 경로가 없다. 원문을 꼭 다뤄야 할 예외용으로 `sanitizeQueryText`만 제공.
- **쿼리마다 READ ONLY 트랜잭션 + `SET LOCAL statement_timeout`** / 대안: 커넥션 단위 timeout 하나 / 이유: 쿼리별로 1~10초 다르게 걸 수 있고, 쓰기 거부를 트랜잭션·역할·접속 옵션 3중으로 보장.
- **연결 수는 client backend만, 분모는 `max_connections`** / 이유: 명세 정의 그대로. `superuser_reserved_connections`는 참고값으로 함께 반환(한계에 기재).
- **캐시 적중률·데드락은 DB 합계의 증가분** / 이유: 명세 "직전 조회 대비 증가분", 작은 DB 하나의 튐 방지.
- **복제 끊김 감지: `expectedStandbys` 옵션 + 비활성 physical 슬롯** / 이유: primary의 `pg_stat_replication`만으로는 "원래 standby가 있었는지" 알 수 없다. StatefulSet replicas를 아는 backend가 넘기면 정확하고, 모르면 슬롯으로 추정.
- **연속 3회 조건은 backend** / 이유: 노드 CPU 등 다른 지표와 같은 로직을 한곳에서. 모듈은 `sustained: true`로 대상만 표시.
- **Postgres 14 이상** / 이유: `pg_locks.waitstart`(14+)로 정확한 잠금 대기 시간. 기준 버전은 16.
- **PVC 사용량 정확한 출처로 kubelet Summary API(`nodes/proxy`)는 권장하지 않음** / 이유: 권한이 강함(현재 최소 권한 결정과 충돌). Prometheus 있으면 `kubelet_volume_stats_*`, 없으면 DB 크기 + WAL 근사치.
- **계정 비밀번호는 표준 입력으로만** / 이유: `kubectl exec` 인자는 API 서버 감사 로그·프로세스 목록에 남을 수 있음.

### 6. 검증 결과
| 명령 | 결과 | 비고 |
|---|---|---|
| `npx jest src/database/health` | 통과 (30건) | 픽스처 3종 전체 상태, 수용 기준 문구, 보류/리셋/부분 실패/standby/크기 유지, 비밀번호 가림 |
| `NODE_OPTIONS=--experimental-vm-modules npx jest` (apps/api 전체) | 통과 (41건, 1건 skip) | skip은 DB 필요한 통합 테스트(`DB_IT_URL` 없을 때) |
| `npx eslint "src/database/**/*.ts"` | 통과 | |
| `npx tsc --noEmit -p tsconfig.json` | 통과 | |
| PGlite로 10개 쿼리 실행 (`pgQueryTransaction` 포함) | 통과 | Postgres 17.5 엔진. 오류 0건 |
| node-postgres로 수집 → `normalizePgHealth` 2회 | 통과 | bigint=string, timestamptz=Date 처리 확인. 전체 ok |
| READ ONLY 트랜잭션에서 INSERT | 거부됨 (기대대로) | `cannot execute INSERT in a read-only transaction` |
| 계정 SQL 핵심 문장 + 권한 확인 | 통과 | superuser=f, conn_limit=3, pg_monitor=t, 대시보드 테이블 SELECT 거부, CREATE TABLE 거부, pg_stat_activity·pg_database_size 조회 가능 |
| `monitor-account.sql`을 psql로 전체 실행 | **건너뜀** | 로컬에 psql·Postgres 없음. `\gexec`·`\if` 등 psql 메타 명령 부분은 미검증 |
| 실제 Postgres 16에서 실행 | **건너뜀** | Docker 없음. PGlite(17.5)로 대체 |
| 세션·잠금 대기·복제가 실제로 있는 상태 | **건너뜀** | PGlite는 단일 연결이라 재현 불가. 결과 행이 있는 경우는 픽스처로만 검증 |

### 7. 남은 이슈·한계
- `table_sizes`는 쿼리·행 타입만 있고 정규화 함수에 넣지 않았다(현재 화면 명세에 없음).
- 잠금 대기의 대상 테이블 이름은 제공하지 않음(DB별 카탈로그 차이).
- 연결 사용률이 `max_connections` 기준이라 예약 슬롯만큼 낙관적이다.
- 커넥션 풀러(PgBouncer)를 거치면 통계가 틀어진다 — 모니터링 계정은 Postgres에 직접 접속해야 한다.
- PVC 근사치는 실제보다 작게 나온다("근사치" 라벨 필수).

### 8. 다른 담당 요청
- `backend 요청`: 루트 `.env.example`의 `MONITOR_DB_URL` 예시를 계정 이름·port-forward 기준으로 바꿔 주세요:
  `MONITOR_DB_URL=postgres://sentinel_monitor:<password>@host.docker.internal:15432/postgres?application_name=sentinel-monitor` (+ 주석 "kubectl port-forward -n <ns> svc/<postgres> 15432:5432, 계정은 docs/db/monitor-account.sql").
- `backend 요청`: 선택 설정 `MONITOR_DB_EXPECTED_STANDBYS`(또는 StatefulSet replicas에서 자동 계산)와 대상 StatefulSet 네임스페이스/이름 설정(명세 A2)을 env 검증에 추가해 주세요.
- `PM 결정 필요(선택)`: PVC 정확한 사용량을 위해 `nodes/proxy` get 권한을 추가할지. DBA 권장은 추가하지 않음(근사치 + Prometheus).

### 9. 다음 담당이 알아야 할 점 (backend)
- import: `import { PG_HEALTH_QUERIES, PG_FAST_QUERY_ORDER, pgQueryTransaction, pgQueryParams, PG_MONITOR_CONNECTION_DEFAULTS, normalizePgHealth, pgUnreachableSnapshot, approxPvcUsagePct, buildPgFixtureSnapshot, sanitizeErrorMessage } from '../database/health';`
- 수집 루프(15초, 이전 주기 진행 중이면 건너뜀, 한 커넥션에서 순서대로):
  1. `server_info` 실행하며 왕복 시간 측정 → 실패면 `pgUnreachableSnapshot(err, { prev, collectedAt: new Date(), timedOut })`.
  2. `activity_summary`, `sessions_top`, `lock_waits`, `database_stats`. 파라미터는 항상 `pgQueryParams(id, thresholds)`로 만든다(`activity_summary`는 $1/$2 오래 실행 쿼리, $3/$4 idle in tx 기준).
  3. `in_recovery=false`면 `replication_primary`(15초)·`replication_slots`(60초), true면 `replication_standby`.
  4. `database_sizes`는 5분마다만, 안 돌린 주기엔 `databaseSizes`를 비워 두면 직전 값이 유지된다.
  5. 개별 실패는 `raw.errors[id] = sanitizeErrorMessage(err)`로 넣고 계속.
  6. `const { snapshot, next } = normalizePgHealth(raw, { prev, thresholds, expectedStandbys }); prev = next;`
- 각 쿼리는 `const tx = pgQueryTransaction(q.timeoutMs); for (s of tx.before) await c.query(s); await c.query(q.sql, pgQueryParams(q.id, thresholds)); await c.query(tx.after);` (오류 시 `tx.onError`). pg `Pool`에 `PG_MONITOR_CONNECTION_DEFAULTS`(max 2 등)를 펼쳐 넣는다.
- `checks[].sustained === true`(연결 사용률, 캐시 적중률)는 명세 3.0의 연속 3회 조건을 적용. `held === true`는 이미 직전 상태를 유지한 값.
- `checks[].applicable === false`(복제 해당 없음)는 화면에서 숨김.
- DB 카드 상태 = `snapshot.overall` + 쿠버네티스 쪽(StatefulSet·파드·PVC) 최악. 파드가 없어 접속 실패면 대표 사유를 파드 쪽으로.
- PVC: `approxPvcUsagePct(snapshot.sizes, pvcCapacityBytes)` + "근사치" 라벨. Prometheus가 있으면 `kubelet_volume_stats_used_bytes` 우선.
- mock: `buildPgFixtureSnapshot('ok'|'warning'|'critical')`, `buildPgUnreachableFixture()`. 값을 흔들려면 `PG_HEALTH_FIXTURES[name].current`를 복제·수정해 `normalizePgHealth`에 넣는다.
- 판단 기준값은 설정 `db.thresholds`(`settings` 테이블, 기본값 = `DEFAULT_PG_THRESHOLDS`)에서 읽어 `thresholds`로 넘긴다.
- 스냅샷에는 쿼리 원문·클라이언트 주소가 없다. 단 `sessions[].user`, `locks.items[].user`(DB 사용자 이름)가 있으므로 **어드바이저 스냅샷에는 넣지 말 것**(명세 3.4).
- `src/database/prisma.service.ts`는 DBA가 인수했다. 동작 변경 없음(연결 실패 시 경고만).
