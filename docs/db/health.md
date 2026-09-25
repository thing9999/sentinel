# 모니터링 대상 DB 상태 조회 (PostgreSQL)

- 작성: dba, 2026-09-19
- 근거 명세: `docs/specs/cluster-status.md` 3.7(DB 상태), 3.0(공통 규칙), 4절(갱신 주기)
- 코드: `apps/api/src/database/health/` (SQL 상수, 결과 타입, 정규화 순수 함수, mock 픽스처). **SQL 원문은 코드가 기준**이고 이 문서의 SQL은 설명용 사본이다. 한쪽을 고치면 다른 쪽도 고친다.
- 실행·스케줄링·연속 3회 조건·SSE: backend(`apps/api/src/db-health`)
- 대상: Postgres **14 이상**(기준 16). 14 미만은 `pg_locks.waitstart`가 없어 `lock_waits`가 실패한다.

## 1. 구조

```
apps/api/src/database/health/
  types.ts               벤더 공통: HealthLevel, HealthCheckResult, HealthQuery, worstLevel()
  sanitize.ts            민감값 가림·잘라내기 (쿼리 원문, 접속 문자열, 오류 메시지, 디스코드 웹훅 URL)
  postgres/queries.ts    SQL 상수 + PG_HEALTH_QUERIES(주기·타임아웃 메타) + pgQueryTransaction()
  postgres/types.ts      행 타입(Pg*Row), 원시 표본(PgRawSample), 정규화 결과(PgHealthSnapshot)
  postgres/normalize.ts  normalizePgHealth(), pgUnreachableSnapshot(), approxPvcUsagePct(), 기본 기준값
  postgres/fixtures.ts   mock 픽스처 (정상/주의/장애 + 접속 불가)
  index.ts               모두 re-export
```

다른 DB를 추가할 때는 `health/mysql/` 같은 폴더에 같은 구성(queries/types/normalize/fixtures)을 만들고 `DbVendor`에 값을 추가한다. 공통 타입(`HealthLevel`, `HealthCheckResult`)과 `sanitize.ts`는 그대로 재사용한다.

## 2. 실행 규칙 (모든 쿼리 공통)

| 항목 | 값 | 이유 |
|---|---|---|
| 트랜잭션 | 쿼리마다 `BEGIN TRANSACTION READ ONLY` → `SET LOCAL statement_timeout = <쿼리별>` → `SET LOCAL lock_timeout = 1000` → 쿼리 → `COMMIT` (오류 시 `ROLLBACK`). `pgQueryTransaction(timeoutMs)`가 문장 목록을 준다 | 쓰기 불가를 트랜잭션 수준에서 한 번 더 보장, 쿼리별 타임아웃 |
| 커넥션 풀 | `max: 2`, `application_name: 'sentinel-monitor'`, `connectionTimeoutMillis: 5000`, `query_timeout: 6000`, `options: '-c default_transaction_read_only=on -c statement_timeout=5000'` (`PG_MONITOR_CONNECTION_DEFAULTS`) | 계정 연결 제한 3보다 작게, 접속 5초 = 장애 기준 |
| 역할 기본값 | `default_transaction_read_only=on`, `statement_timeout=5s`, `lock_timeout=1s`, `idle_in_transaction_session_timeout=10s` (`monitor-account.sql`) | 앱 설정이 빠져도 서버가 막는다 |
| 실행 순서 | 15초 주기마다 `server_info`를 **먼저** 실행해 응답 시간 측정. 실패하면 나머지를 건너뛰고 `pgUnreachableSnapshot()` | 접속 불가 판단, 불필요한 조회 방지 |
| 동시 실행 | 한 주기 안의 쿼리는 **같은 커넥션에서 순서대로** 실행 (병렬 금지). 이전 주기가 안 끝났으면 이번 주기는 건너뛴다 | 대상 DB 부하 일정 |
| 쿼리 실패 | 해당 쿼리만 `errors[id]`에 `sanitizeErrorMessage(err)`로 넣고 계속 진행 → 해당 판단만 "알 수 없음" | 부분 실패 격리 |
| 역할 분기 | `server_info.in_recovery = false`이면 `replication_primary`·`replication_slots`, `true`이면 `replication_standby` | standby에서 `pg_current_wal_lsn()`은 오류 |

### 2.1 쿼리 목록과 주기

| id | 목적 | 주기 | statement_timeout | 무거움 | 실행 조건 |
|---|---|---|---|---|---|
| `server_info` | 접속·응답 시간, 버전, max_connections, primary/standby | 15초 | 1000ms | 아니오 | 항상, 맨 먼저 |
| `activity_summary` | 연결 수·상태별 분포, 오래 실행 쿼리·idle in tx 집계 | 15초 | 2000ms | 아니오 | 항상 |
| `sessions_top` | 가장 오래된 세션 20개 (쿼리 원문 없음) | 15초 | 2000ms | 아니오 | 항상 |
| `lock_waits` | 잠금 대기 세션 (최대 20행 + 전체 건수) | 15초 | 2000ms | 아니오 | 항상 |
| `database_stats` | 커밋/롤백·캐시·데드락 누적 카운터, xid 나이 | 15초 | 2000ms | 아니오 | 항상 |
| `database_sizes` | DB별 크기 + WAL 크기 | **5분** | 5000ms | 예 | 항상 |
| `replication_primary` | standby별 복제 지연 | 15초 | 2000ms | 아니오 | primary |
| `replication_slots` | 복제 슬롯 활성·보존 WAL | 60초 | 2000ms | 아니오 | primary |
| `replication_standby` | 재생 지연 | 15초 | 2000ms | 아니오 | standby |
| `table_sizes` | 현재 DB 테이블 크기 상위 20 (선택 기능) | **30분 이상** | 10000ms | 예 | DB마다 접속, 화면 진입 시 즉시 조회 금지 |

부하 추정: 15초 주기에 가벼운 쿼리 6개(카탈로그·통계 뷰만, 사용자 테이블 스캔 없음). `pg_stat_activity`·`pg_locks`는 공유 메모리 스냅샷이라 연결 수백 개 수준에서 수 ms. `pg_blocking_pids()`는 잠금 관리자를 잠깐 잡으므로 **대기 중인 행(최대 20)에만** 호출한다. `pg_database_size()`는 DB 디렉터리 파일을 훑으므로 5분, `pg_total_relation_size()`는 모든 테이블을 열어 보므로 30분 이상.

## 3. 쿼리 상세

단위 표기: 초(sec, float8), 바이트(bytes, bigint), 개수(count). **bigint는 node-postgres에서 문자열**로 온다(`PgBigint = string | number`). 정규화 함수가 `Number`로 바꾼다(2^53 넘는 카운터는 현실적으로 없음). `timestamptz`는 `Date`로 온다.

### 3.1 `server_info`

```sql
SELECT
  current_setting('server_version')                          AS server_version,
  current_setting('server_version_num')::int                 AS server_version_num,
  current_setting('max_connections')::int                    AS max_connections,
  current_setting('superuser_reserved_connections')::int     AS superuser_reserved_connections,
  pg_is_in_recovery()                                        AS in_recovery,
  EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::float8 AS uptime_sec,
  now()                                                      AS server_now
```

| 필드 | 단위 | 설명 |
|---|---|---|
| `server_version`, `server_version_num` | - | 예: `16.4`, `160004` |
| `max_connections` | 개 | 연결 사용률의 분모 (명세 기준: 현재 연결 수 / max_connections) |
| `superuser_reserved_connections` | 개 | 참고 표시용. 일반 계정이 실제로 쓸 수 있는 연결은 이만큼 적다 |
| `in_recovery` | bool | true면 standby |
| `uptime_sec` | 초 | 재시작 감지용 |
| `server_now` | timestamptz | 표본 시각. 카운터 차이 계산은 **서버 시계** 기준 |

판단: 왕복 시간(backend가 측정해 `responseMs`로 전달) `< 500ms` 정상, `≥ 500ms` 주의. 접속 실패·인증 실패·시간 초과(5초)는 장애(`pgUnreachableSnapshot`).

### 3.2 `activity_summary` (파라미터 `$1/$2`=오래 실행 쿼리 주의/장애 초 300/1800, `$3/$4`=idle in transaction 주의/장애 초 300/1800)

파라미터는 `pgQueryParams('activity_summary', thresholds)`로 만든다(순서 실수 방지).

```sql
WITH a AS (
  SELECT state, wait_event_type, pid = pg_backend_pid() AS is_self,
         EXTRACT(EPOCH FROM (now() - query_start))::float8  AS query_age_sec,
         EXTRACT(EPOCH FROM (now() - state_change))::float8 AS state_age_sec
  FROM pg_stat_activity
  WHERE backend_type = 'client backend'
)
SELECT
  count(*)::int AS total,
  count(*) FILTER (WHERE state = 'active')::int AS active,
  count(*) FILTER (WHERE state = 'idle')::int AS idle,
  count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction,
  count(*) FILTER (WHERE state = 'idle in transaction (aborted)')::int AS idle_in_transaction_aborted,
  count(*) FILTER (WHERE state IS NULL OR state NOT IN (...4개...))::int AS other,
  count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting_on_lock,
  count(*) FILTER (WHERE NOT is_self AND state = 'active' AND query_age_sec >= $1)::int AS active_over_warn,
  count(*) FILTER (WHERE NOT is_self AND state = 'active' AND query_age_sec >= $2)::int AS active_over_crit,
  count(*) FILTER (WHERE state LIKE 'idle in transaction%' AND state_age_sec >= $3)::int AS idle_in_tx_over_warn,
  count(*) FILTER (WHERE state LIKE 'idle in transaction%' AND state_age_sec >= $4)::int AS idle_in_tx_over_crit,
  COALESCE(max(query_age_sec) FILTER (WHERE NOT is_self AND state = 'active'), 0)::float8 AS max_active_sec,
  COALESCE(max(state_age_sec) FILTER (WHERE state LIKE 'idle in transaction%'), 0)::float8 AS max_idle_in_tx_sec
FROM a
```

| 필드 | 단위 | 설명 |
|---|---|---|
| `total` | 개 | `max_connections`를 소모하는 client backend 수 (자기 자신 포함). walsender·autovacuum·백그라운드 워커는 별도 슬롯이라 제외 |
| `active` / `idle` / `idle_in_transaction` / `idle_in_transaction_aborted` / `other` | 개 | 상태별 분포 (명세 "상태별 세션 수") |
| `waiting_on_lock` | 개 | 지금 잠금을 기다리는 세션 (시간 무관) |
| `active_over_warn` / `active_over_crit` | 개 | `active` 상태로 `$1`/`$2`초 이상 실행 중 (경과 = now − query_start) |
| `idle_in_tx_over_warn` / `idle_in_tx_over_crit` | 개 | idle in transaction(aborted 포함)으로 `$3`/`$4`초 이상 (경과 = now − state_change) |
| `max_active_sec`, `max_idle_in_tx_sec` | 초 | 최장 경과 (판단 이유 표시용) |

권한: `pg_monitor`(→ `pg_read_all_stats`)가 없으면 다른 사용자 세션의 `state`가 NULL로 보여 분포가 틀어진다. 계정 스크립트로 해결.

### 3.3 `sessions_top`

```sql
SELECT pid, usename, datname, state, wait_event_type, wait_event,
  EXTRACT(EPOCH FROM (now() - backend_start))::float8 AS backend_age_sec,
  EXTRACT(EPOCH FROM (now() - xact_start))::float8    AS xact_age_sec,
  EXTRACT(EPOCH FROM (now() - query_start))::float8   AS query_age_sec,
  EXTRACT(EPOCH FROM (now() - state_change))::float8  AS state_age_sec
FROM pg_stat_activity
WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
  AND state IS NOT NULL AND state <> 'idle'
ORDER BY COALESCE(xact_start, query_start, backend_start) ASC NULLS LAST
LIMIT 20
```

명세의 "가장 오래된 세션 목록(사용자, DB, 상태, 경과 시간, 대기 이벤트 유형. 쿼리 원문 제외)". **`query`, `client_addr`, `client_hostname`, `client_port`, `application_name`은 선택하지 않는다.** 판단 없음(표시용).

### 3.4 `lock_waits` (파라미터 `$1`=대기 기준 초 60, `pgQueryParams('lock_waits', thresholds)`)

```sql
WITH w AS (
  SELECT l.pid, a.usename, a.datname, l.locktype, l.mode,
         EXTRACT(EPOCH FROM (now() - COALESCE(l.waitstart, a.state_change)))::float8 AS wait_sec
  FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE NOT l.granted
), counted AS (
  SELECT w.*, count(*) OVER ()::int AS total_waiting,
         (count(*) FILTER (WHERE w.wait_sec >= $1) OVER ())::int AS waiting_over_threshold
  FROM w ORDER BY w.wait_sec DESC LIMIT 20
)
SELECT c.pid, c.usename, c.datname, c.locktype, c.mode, c.wait_sec,
       c.total_waiting, c.waiting_over_threshold,
       cardinality(b.blockers)::int AS blocked_by_count, b.blockers[1] AS first_blocker_pid
FROM counted c CROSS JOIN LATERAL (SELECT pg_blocking_pids(c.pid) AS blockers) b
ORDER BY c.wait_sec DESC
```

| 필드 | 단위 | 설명 |
|---|---|---|
| `wait_sec` | 초 | 잠금 대기 시간 (`pg_locks.waitstart`, 없으면 state_change) |
| `total_waiting`, `waiting_over_threshold` | 개 | LIMIT 전 전체 건수. 행이 0개면 0으로 본다 |
| `blocked_by_count`, `first_blocker_pid` | 개 / pid | 막고 있는 세션. 관계(테이블) 이름은 DB마다 카탈로그가 달라 넣지 않았다 |

### 3.5 `database_stats`

```sql
SELECT d.datname, d.datistemplate AS is_template, d.datallowconn AS allow_conn,
  age(d.datfrozenxid)::bigint AS xid_age, mxid_age(d.datminmxid)::bigint AS mxid_age,
  s.numbackends, s.xact_commit, s.xact_rollback, s.blks_read, s.blks_hit,
  s.deadlocks, s.conflicts, s.temp_files, s.temp_bytes, s.stats_reset
FROM pg_database d LEFT JOIN pg_stat_database s ON s.datid = d.oid
ORDER BY d.datname
```

| 필드 | 단위 | 설명 |
|---|---|---|
| `xid_age` | 트랜잭션 수 | wraparound까지 남은 여유의 반대 지표. 모든 DB(template0 포함) 중 최댓값으로 판단 |
| `mxid_age` | multixact 수 | 참고 표시 |
| `xact_commit`, `xact_rollback` | 누적 개수 | 직전 표본과의 차이 ÷ 경과 초 = 초당 커밋/롤백 |
| `blks_read`, `blks_hit` | 누적 블록 수(8KB) | 캐시 적중률 = Δhit / (Δhit + Δread) × 100 |
| `deadlocks` | 누적 개수 | 직전 표본 대비 증가분 |
| `stats_reset` | timestamptz | 바뀌면 통계 리셋 → 이번 차이 계산 생략 |

차이 계산 규칙(`normalizePgHealth`):
- 첫 표본, 통계 리셋, 카운터 감소, 경과 0초 → `throughput = null`, 캐시·데드락 판단은 **보류(held)** 하고 직전 상태 유지.
- 구간 블록 수(Δhit+Δread) < 1,000 → 캐시 적중률 null, 판단 보류(명세 3.7 "1,000블록 미만").
- DB별이 아니라 **전체 합계**로 판단한다(작은 DB 하나의 튐 방지).

### 3.6 `database_sizes` (5분)

```sql
SELECT d.datname, pg_database_size(d.oid)::bigint AS size_bytes,
  (SELECT COALESCE(sum(size), 0) FROM pg_ls_waldir())::bigint AS wal_bytes
FROM pg_database d WHERE d.datallowconn ORDER BY size_bytes DESC
```

| 필드 | 단위 | 설명 |
|---|---|---|
| `size_bytes` | 바이트 | DB별 크기 (명세 "DB별 크기") |
| `wal_bytes` | 바이트 | `pg_wal` 크기 (모든 행이 같은 값) |

정규화 결과 `sizes.approxDataDirBytes = Σsize_bytes + wal_bytes` → PVC 사용량 근사치(8절). 이번 주기에 조회하지 않았으면 직전 값을 그대로 싣는다(`sizes.measuredAt`으로 시각 표시).

### 3.7 `replication_primary` (primary에서만)

```sql
SELECT application_name, state, sync_state,
  EXTRACT(EPOCH FROM write_lag)::float8 AS write_lag_sec,
  EXTRACT(EPOCH FROM flush_lag)::float8 AS flush_lag_sec,
  EXTRACT(EPOCH FROM replay_lag)::float8 AS replay_lag_sec,
  pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::bigint AS replay_lag_bytes,
  EXTRACT(EPOCH FROM (now() - reply_time))::float8 AS reply_age_sec
FROM pg_stat_replication ORDER BY application_name
```

- `replay_lag_sec`(초): 명세의 "replay 기준" 지연. standby가 따라잡고 새 WAL이 없으면 NULL → 0으로 본다.
- `replay_lag_bytes`(바이트), `reply_age_sec`(초): 참고 표시. `client_addr`는 선택하지 않는다.
- `application_name`은 보통 standby 파드 이름(예: `postgres-1`).

### 3.8 `replication_slots` (primary에서만, 60초)

```sql
SELECT slot_name, slot_type, active, wal_status,
  pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint AS retained_wal_bytes
FROM pg_replication_slots ORDER BY slot_name
```

비활성 **physical** 슬롯 = standby 연결 끊김 신호(장애). 비활성 logical 슬롯은 주의. `retained_wal_bytes`는 슬롯 때문에 지우지 못하는 WAL(디스크 위험).

### 3.9 `replication_standby` (standby에 접속했을 때)

```sql
SELECT pg_is_in_recovery() AS in_recovery,
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::float8 AS replay_delay_sec,
  pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())::bigint AS receive_replay_gap_bytes,
  (pg_last_wal_receive_lsn() IS NOT DISTINCT FROM pg_last_wal_replay_lsn()) AS caught_up,
  (SELECT status FROM pg_stat_wal_receiver LIMIT 1) AS wal_receiver_status
```

- `now() - pg_last_xact_replay_timestamp()`는 primary에 쓰기가 없으면 계속 커진다. `caught_up = true`면 지연 0으로 본다.
- `wal_receiver_status ≠ 'streaming'`(NULL 포함)이면 WAL 수신 끊김 → 장애.
- `pg_stat_wal_receiver.conninfo`는 **선택하지 않는다**(복제 비밀번호가 들어 있을 수 있음).
- 기본 구성은 primary 서비스에 접속하므로 이 쿼리는 standby 전용 서비스를 따로 모니터링할 때만 쓴다.

### 3.10 `table_sizes` (선택, 30분 이상, DB마다)

```sql
SELECT n.nspname AS schema_name, c.relname AS table_name,
  pg_total_relation_size(c.oid)::bigint AS total_bytes,
  pg_relation_size(c.oid)::bigint AS heap_bytes,
  pg_indexes_size(c.oid)::bigint AS index_bytes,
  GREATEST(c.reltuples, 0)::bigint AS estimated_rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','m')
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY total_bytes DESC LIMIT 20
```

- 현재 접속한 DB만 본다 → DB마다 접속 필요(계정 스크립트가 모든 DB에 CONNECT 부여).
- 모든 테이블에 `AccessShareLock`을 잡으므로 `lock_timeout`(1초) 필수. `ALTER TABLE` 등으로 막히면 이번 조회는 실패로 두고 다음 주기에 재시도.
- 현재 명세의 화면에는 없음. 어드바이저 스냅샷·DB 상세 확장용. 정규화 함수는 아직 이 결과를 다루지 않는다(행 타입 `PgTableSizeRow`만 제공).

## 4. 판단 기준 (`checks[]`, 명세 3.7 기본값)

기준값은 `DEFAULT_PG_THRESHOLDS`(= 설정 `db.thresholds` 기본값). `normalizePgHealth(raw, { thresholds })`로 덮어쓴다.

| check id | 값(단위) | 정상 | 주의 | 장애 | 연속 3회 조건 |
|---|---|---|---|---|---|
| `reachability` | 응답 시간(ms) | < 500 | ≥ 500 | 접속 실패/인증 실패/5초 초과 | 아니오 |
| `connection_usage` | total / max_connections(%) | < 70 | 70 ~ < 90 | ≥ 90 | **예** |
| `long_running_queries` | 최장 active 경과(초) | 5분 이상 0건 | 5분 이상 ≥ 1건 | 30분 이상 ≥ 1건 | 아니오 |
| `idle_in_transaction` | 최장 idle in tx 경과(초) | 5분 이상 0건 | 5분 이상 ≥ 1건 | 30분 이상 ≥ 1건 | 아니오 |
| `lock_waits` | 1분 이상 대기 건수(개) | 0 | 1 ~ 4 | ≥ 5 | 아니오 |
| `cache_hit_ratio` | 구간 적중률(%) | ≥ 95 | 90 ~ < 95 | < 90 | **예** |
| `deadlocks` | 직전 대비 증가(개) | 0 | ≥ 1 | - | 아니오 |
| `xid_age` | DB별 최댓값(xid) | < 5억 | 5억 ~ < 10억 | ≥ 10억 | 아니오 |
| `replication_lag` | 최대 재생 지연(초) | < 10 | 10 ~ < 60, standby가 streaming 아님, 비활성 logical 슬롯 | ≥ 60, standby 연결 끊김(기대 수보다 적음), 비활성 physical 슬롯, standby 측 WAL 수신 끊김 | 아니오 |

- `replication_lag`: standby 0개 + 슬롯 0개 + `expectedStandbys` 미지정이면 `applicable: false`(해당 없음, 명세 가정 A8). backend는 DB StatefulSet `replicas - 1`을 `expectedStandbys`로 넘기면 "끊김"을 정확히 잡는다.
- `held: true`: 이번 표본으로 판단하지 않고 직전 상태(`prev.levels`)를 유지한 경우.
- `sustained: true`: 명세 3.0의 "연속 3회 만족 시 올리고, 1회 만족 시 즉시 내림"을 **backend가** 적용할 대상.
- 판단 이유(reason) 예: `연결 92% (max 100)`, `5분 이상 실행 중인 쿼리 3건 (최장 12분)`, `1분 이상 잠금 대기 6건 (최장 6분)`, `캐시 적중률 93%`, `데드락 +1 (직전 조회 대비)`, `트랜잭션 ID 나이 10.5억 (app)`, `standby 연결 끊김 (연결 0/1)`, `표본 부족 (블록 708 < 1000), 이전 상태 유지`.
- `overall` = `checks`의 최악(장애 > 주의 > 알 수 없음 > 정상). 쿠버네티스 쪽(StatefulSet·파드·PVC) 판단과 합치는 것은 backend.

## 5. 정규화 결과 (`PgHealthSnapshot`) 요약

`vendor`, `collectedAt`(서버 시계 ISO), `reachable`, `responseMs`, `error`(가림 처리된 한 줄), `server{version, versionNum, role, uptimeSec}`, `connections{total, max, usagePct, byState, waitingOnLock}`, `longRunning{...}`, `sessions[]`(pid, user, database, state, waitEventType, waitEvent, 경과 초 4종), `locks{waitingTotal, waitingOverThreshold, maxWaitSec, items[]}`, `throughput{intervalSec, commitsPerSec, rollbacksPerSec, cacheHitPct, blocksInInterval, deadlocksDelta} | null`, `xid{maxAge, database, maxMultixactAge}`, `sizes{measuredAt, databases[], totalBytes, walBytes, approxDataDirBytes}`, `replication{role, standbys[], slots[], standbyReplayDelaySec, walReceiverStatus}`, `checks[]`, `overall`. 그대로 API 응답/SSE에 실어도 되도록 쿼리 원문·클라이언트 주소·비밀값이 없다.

호출 방법:

```ts
let prev: PgPreviousState | null = null;
// 매 15초
const { snapshot, next } = normalizePgHealth(raw, { prev, thresholds, expectedStandbys });
prev = next;
// 접속 실패 시
const { snapshot, next } = pgUnreachableSnapshot(err, { prev, collectedAt: new Date(), timedOut });
```

## 6. 민감값 처리

| 대상 | 처리 |
|---|---|
| 쿼리 원문 (`pg_stat_activity.query`) | **조회하지 않는다.** 명세 가정 A7·수용 기준 "세션 목록에 쿼리 원문이 나오지 않는다". 테스트로 확인(`normalize.spec.ts`) |
| 클라이언트 주소·호스트·포트, `application_name` | 조회하지 않는다 (어드바이저 스냅샷 제외 규칙 3.4와 동일) |
| `pg_stat_wal_receiver.conninfo` | 조회하지 않는다 (복제 비밀번호) |
| 접속·쿼리 오류 메시지 | `sanitizeErrorMessage()`: URL 비밀번호·`password=`·`token`·AWS 키·PEM·**디스코드 웹훅 URL**·**Postgres 오류 설명의 값**(`Key (col)=(…)`) 가림, 줄바꿈 제거, 200자, SQLSTATE 접두사 |
| Postgres **서버 로그 줄**의 값 (logs 기능 `sql_statement` 규칙, AC-LOG49) | `maskPgLogValues(line)`, 여러 줄에 걸친 문장은 `createPgLogValueMasker()`. `DETAIL: Key (col)=(값)`·`Failing row contains (…)`·`parameters: $1 = '…'`·`STATEMENT:`/`LOG: statement:`/`execute <name>:` 뒤 SQL 리터럴·`CONTEXT: SQL statement "…"`를 `?`로 바꾼다. **테이블·컬럼·제약 이름·타임스탬프·PID는 남긴다**(통째로 지우지 않는다). 리터럴 스캐너는 `maskSqlLiterals`를 재사용한다 — 규칙이 두 벌이 되지 않게 |
| 디스코드 웹훅 URL | `redactSecrets()`가 **통째로** 가린다(`[웹훅 주소 가림]`). 경로에 토큰이 들어 있어 **주소 자체가 비밀값**이다(`docs/specs/alerts.md` 3.4.3). 패턴은 `DISCORD_WEBHOOK_URL_PATTERN`(`sanitize.ts`), 저장·조회는 `src/database/secret-settings.ts` 전용 함수로만 한다(`docs/db/schema.md` 2.12) |
| 쿼리 원문을 꼭 다뤄야 할 때(디버그 로그 등, 기본 사용 안 함) | `sanitizeQueryText(sql, 120)`: 문자열·숫자·달러 인용 리터럴 → `?`, 주석 제거, 공백 정리, 비밀 패턴 가림, 120자. `track_activity_query_size`로 잘린 닫히지 않은 리터럴도 끝까지 가림 |
| DB 사용자 이름 | 세션·잠금 목록에 표시(명세 S3). 어드바이저 스냅샷으로는 보내지 않는다(backend 책임, 명세 3.4) |

## 7. 모니터링 계정 (`docs/db/monitor-account.sql`)

### 7.1 권한 요약

| 항목 | 값 |
|---|---|
| 계정 | `sentinel_monitor` (LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, INHERIT) |
| 역할 | `pg_monitor` (통계·설정 읽기, `pg_ls_waldir`, `pg_database_size`). 사용자 테이블 데이터 SELECT 권한 **없음** |
| 접속 | 접속 가능한 모든 DB에 CONNECT |
| 연결 수 제한 | `CONNECTION LIMIT 3` (api 풀 2 + 수동 점검 1) |
| 세션 기본값 | `default_transaction_read_only=on`, `statement_timeout=5s`, `lock_timeout=1s`, `idle_in_transaction_session_timeout=10s`, `log_min_duration_statement=-1` |
| 비밀번호 | SCRAM-SHA-256. 파일에 쓰지 않고 psql 변수로 표준 입력에 전달 |

PGlite(Postgres 17.5 엔진)로 확인한 결과: 이 계정으로 대시보드 테이블 SELECT → `permission denied`, `CREATE TABLE` → `permission denied for schema public`, `pg_stat_activity`·`pg_database_size()` → 조회됨.

### 7.2 클러스터 안 StatefulSet에 적용 (문서로만 제공, 실행은 운영자)

1. DB 파드와 superuser 확인

   ```bash
   kubectl get sts -A | grep -i postgres          # 예: namespace=db, name=postgres
   kubectl get pod -n db -l app=postgres -o wide  # primary 파드 (보통 postgres-0)
   ```

2. 비밀번호를 만들어 로컬 `.env`에만 둔다(커밋 금지).

   ```bash
   read -rs MONITOR_PASSWORD      # 또는: MONITOR_PASSWORD=$(openssl rand -base64 24)
   ```

3. 스크립트 적용 — 비밀번호는 **표준 입력**으로만 넘긴다(명령줄 인자는 프로세스 목록·API 서버 감사 로그에 남을 수 있음). `-i`만 쓰고 `-t`는 쓰지 않는다.

   ```bash
   { printf "\\set monitor_password '%s'\n" "$MONITOR_PASSWORD"; cat docs/db/monitor-account.sql; } \
     | kubectl exec -i -n db postgres-0 -c postgres -- \
       psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   ```

   - 스크립트는 세션 안에서 `log_statement='none'`·`log_min_duration_statement=-1`·`log_min_error_statement='panic'`으로 바꿔, 비밀번호가 든 문장이 **성공하든 실패하든** 서버 로그에 남지 않게 한다(superuser 필요, 세션 한정이라 서버 설정은 그대로).
     - 셋이 막는 것이 다르다: `log_statement`는 **성공한** 문장, `log_min_duration_statement`는 **느린** 문장, `log_min_error_statement`는 **실패한** 문장이다. 세 번째는 **기본값이 `error`**라 앞 두 개로는 못 막는다 — 오타·권한 부족으로 `ALTER ROLE … PASSWORD '…'`가 깨지면 비밀번호가 평문으로 파드 로그에 남고, 로그 화면(`docs/specs/logs.md`)에서 그대로 보인다.
     - **진단은 잃지 않는다.** `ON_ERROR_STOP=1`이라 오류는 실행한 사람의 화면에 그대로 뜬다. 가려지는 것은 서버 로그에 남는 사본뿐이다.
     - 전부 `SET`이라 **이 psql 세션에만** 적용된다. `ALTER SYSTEM`/`ALTER DATABASE`/`ALTER ROLE` 같은 영구 설정은 건드리지 않는다 — 모니터링 대상 DB에 쓰기를 하지 않는다는 원칙(`CLAUDE.md`) 때문이다.
   - 이미 계정이 있으면 속성·비밀번호만 다시 맞춘다(멱등). 비밀번호 교체도 같은 명령.
   - 파드 이미지에 따라 superuser 이름이 `postgres`가 아닐 수 있다(예: 오퍼레이터 사용 시). `-U`를 맞춘다.
   - 마지막 확인 쿼리 결과가 `superuser=f, conn_limit=3, has_pg_monitor=t`인지 본다.

4. `pg_hba.conf`: 대부분의 이미지 기본값(`host all all all scram-sha-256`)이면 추가 작업 없음. 제한돼 있다면 api가 접속하는 경로(파드 CIDR 또는 port-forward 시 파드 로컬)에 `sentinel_monitor` 허용 줄을 추가하고 `SELECT pg_reload_conf();`. hba는 ConfigMap/오퍼레이터 설정으로 관리되는 경우가 많으니 그쪽을 고친다.

5. 접속 확인

   ```bash
   kubectl exec -i -n db postgres-0 -c postgres -- \
     psql "host=127.0.0.1 user=sentinel_monitor dbname=postgres" -c "SHOW default_transaction_read_only"   # on
   ```

6. api(로컬 docker compose)에서 접속: 클러스터 밖이므로 port-forward를 쓴다.

   ```bash
   kubectl port-forward -n db svc/postgres 15432:5432
   # .env
   MONITOR_DB_URL=postgres://sentinel_monitor:<비밀번호>@host.docker.internal:15432/postgres?application_name=sentinel-monitor
   # docker 없이 로컬 실행이면 host.docker.internal 대신 127.0.0.1
   ```

   primary를 봐야 하므로 서비스가 primary만 가리키는지 확인한다(읽기 전용 서비스가 따로 있으면 그쪽이 아닌 primary 서비스).

7. 되돌리기: 스크립트 맨 아래 주석(`REVOKE pg_monitor ...; DROP ROLE sentinel_monitor;`).

## 8. PVC 사용량 근사치 (명세 3.7)

정확한 출처 우선순위:
1. **Prometheus가 설정된 경우**: `kubelet_volume_stats_used_bytes{namespace, persistentvolumeclaim}` / `kubelet_volume_stats_capacity_bytes`. 정확함.
2. kubelet Summary API(`/api/v1/nodes/<node>/proxy/stats/summary`의 `pods[].volume[].usedBytes`): 정확하지만 RBAC에 `nodes/proxy` get이 필요하다. `nodes/proxy`는 kubelet API 전반에 접근하는 강한 권한이라 **현재 결정(읽기 전용 최소 권한)에서는 권장하지 않는다.** 쓰려면 PM 결정 필요.
3. **근사치(기본)**: `approxPvcUsagePct(snapshot.sizes, pvc.status.capacity.storage)` = (Σ`pg_database_size` + `pg_wal` 크기) ÷ PVC 용량. **실제보다 작게** 나온다(서버 로그, 임시 파일, `pg_replslot`/`pg_xact` 등 기타 디렉터리, 파일시스템 예약 공간 제외). 화면에 "근사치" 라벨 필수. 주의 기준(75%)에 가까우면 실제로는 더 찼을 수 있다.

## 9. mock 픽스처

`postgres/fixtures.ts`:

| 이름 | 전체 | 내용 |
|---|---|---|
| `ok` | 정상 | 연결 23%, 응답 18ms, 캐시 99.6%, xid 1.2억, standby 지연 0.4초 |
| `warning` | 주의 | 응답 620ms, 연결 82%, 5분 넘은 쿼리 3건(최장 12분), idle in tx 12분 1건, 1분 넘은 잠금 대기 2건, 캐시 93%, 데드락 +1, xid 5.6억, standby 지연 25초 |
| `critical` | 장애 | 연결 **92% (max 100)**(명세 수용 기준 문구 그대로), 30분 넘은 쿼리 1건(42분), idle in tx 41분, 잠금 대기 6건, 캐시 85%, xid 10.5억, 비활성 physical 슬롯(standby 끊김) |
| 접속 불가 | 장애 | `buildPgUnreachableFixture()`: 인증 실패(28P01). 오류 메시지 속 비밀번호가 가려지는 것까지 확인 |

- `PG_HEALTH_FIXTURES[name].previous/current`: 15초 간격 원시 표본 두 개(카운터 차이 계산용).
- `buildPgFixtureSnapshot(name)`: 정규화까지 마친 `{ snapshot, next }`. mock은 이 스냅샷을 그대로 쓰거나 `current`를 조금씩 흔들어 `normalizePgHealth`에 넣으면 값이 시간에 따라 바뀐다.
- 알 수 없음 재현: `normalizePgHealth({...current, lockWaits: undefined, errors: { lock_waits: '[57014] canceling statement due to statement timeout' }})`.
- 데이터 오래됨: 시간 기반이라 backend mock이 갱신을 멈춰서 재현한다.

## 10. 한계

- 연결 수는 명세대로 `max_connections` 기준. 실제로 일반 계정이 쓸 수 있는 슬롯은 `superuser_reserved_connections`(기본 3)만큼 적어서 사용률 97%에서 이미 접속 거부가 날 수 있다.
- 캐시 적중률은 Postgres 공유 버퍼 기준이다. OS 페이지 캐시에서 읽은 것도 `blks_read`로 잡혀 실제 디스크 I/O보다 비관적으로 나온다.
- `pg_stat_database`의 `blks_*`는 통계 수집기 갱신 주기 때문에 짧은 구간(15초)에선 튈 수 있어 1,000블록 기준과 연속 3회 조건을 함께 쓴다.
- 커넥션 풀러(PgBouncer)를 거쳐 접속하면 `pg_stat_activity`에 보이는 연결이 풀러 기준이다. 모니터링 계정은 **풀러를 거치지 않고** Postgres에 직접 접속해야 한다.
- 잠금 대기의 대상 테이블 이름은 제공하지 않는다(DB마다 카탈로그가 달라 `regclass` 변환이 틀릴 수 있음).
- 실제 Postgres 16 서버에서의 실행은 로컬에 Docker가 없어 확인하지 못했다. 대신 PGlite(Postgres 17.5 엔진)로 모든 쿼리 실행을 확인했다. 세션·잠금 대기·복제가 실제로 있는 상태는 PGlite로 만들 수 없어 결과 행이 있는 경우는 픽스처로만 검증했다.
