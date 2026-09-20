/**
 * PostgreSQL 상태 조회 쿼리 (읽기 전용, Postgres 14 이상, 기준 버전 16).
 *
 * 규칙
 * - SELECT만 사용한다. 쓰기·DDL·세션 종료 함수(pg_terminate_backend 등)는 쓰지 않는다.
 * - 쿼리 원문(`pg_stat_activity.query`), 클라이언트 주소(`client_addr`, `client_hostname`),
 *   `pg_stat_wal_receiver.conninfo`는 **선택하지 않는다**.
 * - 각 쿼리는 `pgQueryTransaction()`이 만드는 READ ONLY 트랜잭션 안에서
 *   `SET LOCAL statement_timeout` / `lock_timeout`을 걸고 실행한다.
 * - 숫자 컬럼 중 bigint는 node-postgres에서 문자열로 온다. 정규화 함수가 Number로 바꾼다.
 *
 * 상세(필드·단위·판단값·주기): docs/db/health.md
 */
import type { HealthQuery } from '../types';

export type PgQueryId =
  | 'server_info'
  | 'activity_summary'
  | 'sessions_top'
  | 'lock_waits'
  | 'database_stats'
  | 'database_sizes'
  | 'replication_primary'
  | 'replication_slots'
  | 'replication_standby'
  | 'table_sizes';

/** Postgres 14 (pg_locks.waitstart 도입) */
export const PG_MIN_SERVER_VERSION_NUM = 140000;

/** 모든 조회에 공통으로 거는 lock_timeout (ms). 카탈로그 잠금 대기로 쌓이지 않게 한다. */
export const PG_LOCK_TIMEOUT_MS = 1000;

/** 세션 목록(가장 오래된 세션) 최대 행 수 */
export const PG_SESSIONS_LIMIT = 20;
/** 잠금 대기 목록 최대 행 수 */
export const PG_LOCK_WAITS_LIMIT = 20;
/** 테이블 크기 상위 N */
export const PG_TABLE_SIZES_LIMIT = 20;

/**
 * 서버 기본 정보. 접속 가능 여부·응답 시간 측정용으로 **매 주기 가장 먼저** 실행한다.
 * backend는 이 쿼리의 왕복 시간을 responseMs로 넘긴다.
 */
export const PG_SERVER_INFO_SQL = `
SELECT
  current_setting('server_version')                          AS server_version,
  current_setting('server_version_num')::int                 AS server_version_num,
  current_setting('max_connections')::int                    AS max_connections,
  current_setting('superuser_reserved_connections')::int     AS superuser_reserved_connections,
  pg_is_in_recovery()                                        AS in_recovery,
  EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::float8 AS uptime_sec,
  now()                                                      AS server_now
`.trim();

/**
 * 연결 수·상태별 분포와 오래 실행 중인 세션 집계 (pg_stat_activity 1회 스캔).
 * $1/$2 = 오래 실행 쿼리 주의/장애 기준 초(기본 300/1800), $3/$4 = idle in transaction 주의/장애 기준 초(기본 300/1800).
 * - 연결 수는 client backend만 센다 (max_connections를 소모하는 것만).
 * - 자기 자신(pg_backend_pid())은 오래 실행 집계에서 뺀다.
 */
export const PG_ACTIVITY_SUMMARY_SQL = `
WITH a AS (
  SELECT
    state,
    wait_event_type,
    pid = pg_backend_pid() AS is_self,
    EXTRACT(EPOCH FROM (now() - query_start))::float8  AS query_age_sec,
    EXTRACT(EPOCH FROM (now() - state_change))::float8 AS state_age_sec
  FROM pg_stat_activity
  WHERE backend_type = 'client backend'
)
SELECT
  count(*)::int                                                              AS total,
  count(*) FILTER (WHERE state = 'active')::int                              AS active,
  count(*) FILTER (WHERE state = 'idle')::int                                AS idle,
  count(*) FILTER (WHERE state = 'idle in transaction')::int                 AS idle_in_transaction,
  count(*) FILTER (WHERE state = 'idle in transaction (aborted)')::int       AS idle_in_transaction_aborted,
  count(*) FILTER (WHERE state IS NULL
                      OR state NOT IN ('active', 'idle', 'idle in transaction',
                                       'idle in transaction (aborted)'))::int AS other,
  count(*) FILTER (WHERE wait_event_type = 'Lock')::int                      AS waiting_on_lock,
  count(*) FILTER (WHERE NOT is_self AND state = 'active' AND query_age_sec >= $1)::int AS active_over_warn,
  count(*) FILTER (WHERE NOT is_self AND state = 'active' AND query_age_sec >= $2)::int AS active_over_crit,
  count(*) FILTER (WHERE state LIKE 'idle in transaction%' AND state_age_sec >= $3)::int AS idle_in_tx_over_warn,
  count(*) FILTER (WHERE state LIKE 'idle in transaction%' AND state_age_sec >= $4)::int AS idle_in_tx_over_crit,
  COALESCE(max(query_age_sec) FILTER (WHERE NOT is_self AND state = 'active'), 0)::float8 AS max_active_sec,
  COALESCE(max(state_age_sec) FILTER (WHERE state LIKE 'idle in transaction%'), 0)::float8 AS max_idle_in_tx_sec
FROM a
`.trim();

/**
 * 가장 오래된 세션 목록 (idle 제외). **쿼리 원문·클라이언트 주소 없음.**
 * 정렬: 트랜잭션/쿼리 시작이 오래된 순.
 */
export const PG_SESSIONS_TOP_SQL = `
SELECT
  pid,
  usename,
  datname,
  state,
  wait_event_type,
  wait_event,
  EXTRACT(EPOCH FROM (now() - backend_start))::float8 AS backend_age_sec,
  EXTRACT(EPOCH FROM (now() - xact_start))::float8    AS xact_age_sec,
  EXTRACT(EPOCH FROM (now() - query_start))::float8   AS query_age_sec,
  EXTRACT(EPOCH FROM (now() - state_change))::float8  AS state_age_sec
FROM pg_stat_activity
WHERE backend_type = 'client backend'
  AND pid <> pg_backend_pid()
  AND state IS NOT NULL
  AND state <> 'idle'
ORDER BY COALESCE(xact_start, query_start, backend_start) ASC NULLS LAST
LIMIT ${PG_SESSIONS_LIMIT}
`.trim();

/**
 * 잠금 대기 세션 (pg_locks의 granted = false). $1 = 대기 기준 초(기본 60).
 * - 한 백엔드는 동시에 잠금 하나만 기다리므로 pid당 1행.
 * - waitstart(PG14+)가 없으면(fast-path 직후 등) state_change로 대신한다.
 * - total_waiting / waiting_over_threshold는 LIMIT 전 전체 건수 (행이 없으면 0으로 본다).
 * - pg_blocking_pids()는 잠금 관리자 공유 상태를 잠깐 잡으므로 대기 행에만 호출한다.
 */
export const PG_LOCK_WAITS_SQL = `
WITH w AS (
  SELECT
    l.pid,
    a.usename,
    a.datname,
    l.locktype,
    l.mode,
    EXTRACT(EPOCH FROM (now() - COALESCE(l.waitstart, a.state_change)))::float8 AS wait_sec
  FROM pg_locks l
  JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE NOT l.granted
), counted AS (
  SELECT
    w.*,
    count(*) OVER ()::int                                    AS total_waiting,
    (count(*) FILTER (WHERE w.wait_sec >= $1) OVER ())::int  AS waiting_over_threshold
  FROM w
  ORDER BY w.wait_sec DESC
  LIMIT ${PG_LOCK_WAITS_LIMIT}
)
SELECT
  c.pid,
  c.usename,
  c.datname,
  c.locktype,
  c.mode,
  c.wait_sec,
  c.total_waiting,
  c.waiting_over_threshold,
  cardinality(b.blockers)::int AS blocked_by_count,
  b.blockers[1]                AS first_blocker_pid
FROM counted c
CROSS JOIN LATERAL (SELECT pg_blocking_pids(c.pid) AS blockers) b
ORDER BY c.wait_sec DESC
`.trim();

/**
 * DB별 누적 카운터와 트랜잭션 ID 나이. 카운터는 누적값이므로 직전 표본과의 차이로 판단한다.
 * template0처럼 접속 불가 DB도 xid 나이 판단을 위해 포함한다.
 */
export const PG_DATABASE_STATS_SQL = `
SELECT
  d.datname,
  d.datistemplate                  AS is_template,
  d.datallowconn                   AS allow_conn,
  age(d.datfrozenxid)::bigint      AS xid_age,
  mxid_age(d.datminmxid)::bigint   AS mxid_age,
  s.numbackends,
  s.xact_commit,
  s.xact_rollback,
  s.blks_read,
  s.blks_hit,
  s.deadlocks,
  s.conflicts,
  s.temp_files,
  s.temp_bytes,
  s.stats_reset
FROM pg_database d
LEFT JOIN pg_stat_database s ON s.datid = d.oid
ORDER BY d.datname
`.trim();

/**
 * DB별 크기 + WAL 디렉터리 크기 (PVC 사용량 근사치용).
 * pg_database_size()는 DB 디렉터리를 훑으므로 15초 주기로 돌리지 않는다(5분 권장).
 * pg_ls_waldir()는 pg_monitor 권한으로 실행 가능하다.
 */
export const PG_DATABASE_SIZES_SQL = `
SELECT
  d.datname,
  pg_database_size(d.oid)::bigint AS size_bytes,
  (SELECT COALESCE(sum(size), 0) FROM pg_ls_waldir())::bigint AS wal_bytes
FROM pg_database d
WHERE d.datallowconn
ORDER BY size_bytes DESC
`.trim();

/**
 * 복제 상태 (primary에서만). standby마다 1행. 클라이언트 주소는 선택하지 않는다.
 * *_lag 컬럼은 standby가 따라잡고 새 WAL이 없으면 NULL이 된다 → 0으로 본다.
 * standby에서 실행하면 pg_current_wal_lsn()이 오류를 내므로 runOn = primary.
 */
export const PG_REPLICATION_PRIMARY_SQL = `
SELECT
  application_name,
  state,
  sync_state,
  EXTRACT(EPOCH FROM write_lag)::float8  AS write_lag_sec,
  EXTRACT(EPOCH FROM flush_lag)::float8  AS flush_lag_sec,
  EXTRACT(EPOCH FROM replay_lag)::float8 AS replay_lag_sec,
  pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::bigint AS replay_lag_bytes,
  EXTRACT(EPOCH FROM (now() - reply_time))::float8 AS reply_age_sec
FROM pg_stat_replication
ORDER BY application_name
`.trim();

/**
 * 복제 슬롯 (primary에서만). 비활성 슬롯은 standby 연결 끊김 신호이자 WAL 누적(디스크) 위험.
 */
export const PG_REPLICATION_SLOTS_SQL = `
SELECT
  slot_name,
  slot_type,
  active,
  wal_status,
  pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint AS retained_wal_bytes
FROM pg_replication_slots
ORDER BY slot_name
`.trim();

/**
 * 복제본(standby)에 접속했을 때의 재생 지연.
 * now() - pg_last_xact_replay_timestamp()는 primary에 쓰기가 없으면 계속 커지므로
 * receive LSN = replay LSN(따라잡음)이면 지연 0으로 본다 (정규화 함수가 처리).
 * pg_stat_wal_receiver는 status만 선택한다 (conninfo에 비밀번호가 있을 수 있음).
 */
export const PG_REPLICATION_STANDBY_SQL = `
SELECT
  pg_is_in_recovery() AS in_recovery,
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::float8 AS replay_delay_sec,
  pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())::bigint AS receive_replay_gap_bytes,
  (pg_last_wal_receive_lsn() IS NOT DISTINCT FROM pg_last_wal_replay_lsn()) AS caught_up,
  (SELECT status FROM pg_stat_wal_receiver LIMIT 1) AS wal_receiver_status
`.trim();

/**
 * 현재 접속한 DB의 테이블 크기 상위 N (무거움). DB마다 따로 접속해서 실행한다.
 * 모든 테이블의 크기를 계산하므로 30분 이상 간격을 권장하고, 화면 진입 시 즉시 조회하지 않는다.
 * pg_total_relation_size()는 AccessShareLock을 잡으므로 lock_timeout이 꼭 필요하다.
 */
export const PG_TABLE_SIZES_SQL = `
SELECT
  n.nspname                               AS schema_name,
  c.relname                               AS table_name,
  pg_total_relation_size(c.oid)::bigint   AS total_bytes,
  pg_relation_size(c.oid)::bigint         AS heap_bytes,
  pg_indexes_size(c.oid)::bigint          AS index_bytes,
  GREATEST(c.reltuples, 0)::bigint        AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY total_bytes DESC
LIMIT ${PG_TABLE_SIZES_LIMIT}
`.trim();

/** 쿼리 목록 (실행 주기·타임아웃 메타데이터 포함) */
export const PG_HEALTH_QUERIES: Readonly<
  Record<PgQueryId, HealthQuery<PgQueryId>>
> = {
  server_info: {
    id: 'server_info',
    purpose:
      '접속 가능 여부·응답 시간, 버전, max_connections, primary/standby 구분',
    sql: PG_SERVER_INFO_SQL,
    params: [],
    timeoutMs: 1000,
    intervalSec: 15,
    heavy: false,
    runOn: 'any',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  activity_summary: {
    id: 'activity_summary',
    purpose:
      '연결 수·상태별 분포, 오래 실행 중인 쿼리·idle in transaction 집계',
    sql: PG_ACTIVITY_SUMMARY_SQL,
    params: [
      '$1 오래 실행 쿼리 주의 기준 초 (longQueryWarnSec, 기본 300)',
      '$2 오래 실행 쿼리 장애 기준 초 (longQueryCritSec, 기본 1800)',
      '$3 idle in transaction 주의 기준 초 (idleInTxWarnSec, 기본 300)',
      '$4 idle in transaction 장애 기준 초 (idleInTxCritSec, 기본 1800)',
    ],
    timeoutMs: 2000,
    intervalSec: 15,
    heavy: false,
    runOn: 'any',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  sessions_top: {
    id: 'sessions_top',
    purpose: '가장 오래된 세션 목록 (쿼리 원문 제외)',
    sql: PG_SESSIONS_TOP_SQL,
    params: [],
    timeoutMs: 2000,
    intervalSec: 15,
    heavy: false,
    runOn: 'any',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  lock_waits: {
    id: 'lock_waits',
    purpose: '잠금 대기 세션과 대기 시간, 막고 있는 세션 pid',
    sql: PG_LOCK_WAITS_SQL,
    params: ['$1 대기 기준 초 (기본 60)'],
    timeoutMs: 2000,
    intervalSec: 15,
    heavy: false,
    runOn: 'any',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  database_stats: {
    id: 'database_stats',
    purpose: '커밋/롤백·캐시 적중·데드락 누적 카운터, 트랜잭션 ID 나이',
    sql: PG_DATABASE_STATS_SQL,
    params: [],
    timeoutMs: 2000,
    intervalSec: 15,
    heavy: false,
    runOn: 'any',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  database_sizes: {
    id: 'database_sizes',
    purpose: 'DB별 크기와 WAL 크기 (PVC 사용량 근사치)',
    sql: PG_DATABASE_SIZES_SQL,
    params: [],
    timeoutMs: 5000,
    intervalSec: 300,
    heavy: true,
    runOn: 'any',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  replication_primary: {
    id: 'replication_primary',
    purpose: 'primary에서 본 standby별 복제 지연',
    sql: PG_REPLICATION_PRIMARY_SQL,
    params: [],
    timeoutMs: 2000,
    intervalSec: 15,
    heavy: false,
    runOn: 'primary',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  replication_slots: {
    id: 'replication_slots',
    purpose: '복제 슬롯 활성 여부와 보존 중인 WAL 크기',
    sql: PG_REPLICATION_SLOTS_SQL,
    params: [],
    timeoutMs: 2000,
    intervalSec: 60,
    heavy: false,
    runOn: 'primary',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  replication_standby: {
    id: 'replication_standby',
    purpose: 'standby에 접속했을 때 재생 지연',
    sql: PG_REPLICATION_STANDBY_SQL,
    params: [],
    timeoutMs: 2000,
    intervalSec: 15,
    heavy: false,
    runOn: 'standby',
    perDatabase: false,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
  table_sizes: {
    id: 'table_sizes',
    purpose: '현재 DB의 테이블 크기 상위 20 (무거움, 선택)',
    sql: PG_TABLE_SIZES_SQL,
    params: [],
    timeoutMs: 10000,
    intervalSec: 1800,
    heavy: true,
    runOn: 'any',
    perDatabase: true,
    minServerVersionNum: PG_MIN_SERVER_VERSION_NUM,
  },
};

/** 15초 주기로 도는 기본 쿼리 순서 (server_info를 가장 먼저) */
export const PG_FAST_QUERY_ORDER: readonly PgQueryId[] = [
  'server_info',
  'activity_summary',
  'sessions_top',
  'lock_waits',
  'database_stats',
];

function assertPositiveInt(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name}은 양의 정수(ms)여야 합니다: ${value}`);
  }
  return value;
}

/**
 * 쿼리 하나를 감싸는 트랜잭션 문장 목록.
 * 같은 커넥션에서 순서대로 실행한다: BEGIN READ ONLY → SET LOCAL ×2 → (쿼리) → COMMIT.
 * 오류가 나면 ROLLBACK 한다. SET LOCAL은 트랜잭션이 끝나면 원래대로 돌아간다.
 *
 * 예 (node-postgres):
 *   const tx = pgQueryTransaction(q.timeoutMs);
 *   for (const s of tx.before) await client.query(s);
 *   const res = await client.query(q.sql, params);
 *   await client.query(tx.after);
 */
export function pgQueryTransaction(
  timeoutMs: number,
  lockTimeoutMs: number = PG_LOCK_TIMEOUT_MS,
): { before: string[]; after: string; onError: string } {
  const t = assertPositiveInt('statement_timeout', timeoutMs);
  const l = assertPositiveInt('lock_timeout', Math.min(lockTimeoutMs, t));
  return {
    before: [
      'BEGIN TRANSACTION READ ONLY',
      `SET LOCAL statement_timeout = ${t}`,
      `SET LOCAL lock_timeout = ${l}`,
    ],
    after: 'COMMIT',
    onError: 'ROLLBACK',
  };
}

/** 모니터링 커넥션에 권장하는 접속 설정 (node-postgres Pool 옵션에 대응) */
export const PG_MONITOR_CONNECTION_DEFAULTS = {
  application_name: 'sentinel-monitor',
  /** 접속 타임아웃 = 명세의 장애 기준(시간 초과 5초) */
  connectionTimeoutMillis: 5000,
  /** 계정의 CONNECTION LIMIT(3)보다 작게 */
  max: 2,
  idleTimeoutMillis: 60000,
  /** 클라이언트 측 안전장치 (서버 statement_timeout보다 조금 길게) */
  query_timeout: 6000,
  /** 역할 기본값과 별개로 세션 기본값도 읽기 전용으로 */
  options: '-c default_transaction_read_only=on -c statement_timeout=5000',
} as const;
