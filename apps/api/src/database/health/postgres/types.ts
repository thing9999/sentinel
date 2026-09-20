/**
 * PostgreSQL 상태 조회 결과 타입.
 * - Pg*Row: 쿼리가 돌려주는 행 그대로 (node-postgres 기준: bigint·numeric은 string, timestamptz는 Date)
 * - PgHealthSnapshot: 정규화 결과 (API 응답·SSE에 그대로 실을 수 있는 형태)
 */
import type { HealthCheckResult, HealthLevel } from '../types';
import type { PgQueryId } from './queries';

/** bigint 컬럼은 node-postgres에서 string으로 온다 */
export type PgBigint = string | number;
/** timestamptz는 Date(기본 파서) 또는 ISO 문자열(mock/JSON) */
export type PgTimestamp = Date | string;

export interface PgServerInfoRow {
  server_version: string;
  server_version_num: number;
  max_connections: number;
  superuser_reserved_connections: number;
  in_recovery: boolean;
  uptime_sec: number;
  server_now: PgTimestamp;
}

export interface PgActivitySummaryRow {
  total: number;
  active: number;
  idle: number;
  idle_in_transaction: number;
  idle_in_transaction_aborted: number;
  other: number;
  waiting_on_lock: number;
  active_over_warn: number;
  active_over_crit: number;
  idle_in_tx_over_warn: number;
  idle_in_tx_over_crit: number;
  max_active_sec: number;
  max_idle_in_tx_sec: number;
}

export interface PgSessionRow {
  pid: number;
  usename: string | null;
  datname: string | null;
  state: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  backend_age_sec: number | null;
  xact_age_sec: number | null;
  query_age_sec: number | null;
  state_age_sec: number | null;
}

export interface PgLockWaitRow {
  pid: number;
  usename: string | null;
  datname: string | null;
  locktype: string;
  mode: string;
  wait_sec: number;
  total_waiting: number;
  waiting_over_threshold: number;
  blocked_by_count: number;
  first_blocker_pid: number | null;
}

export interface PgDatabaseStatRow {
  datname: string;
  is_template: boolean;
  allow_conn: boolean;
  xid_age: PgBigint;
  mxid_age: PgBigint;
  numbackends: number | null;
  xact_commit: PgBigint | null;
  xact_rollback: PgBigint | null;
  blks_read: PgBigint | null;
  blks_hit: PgBigint | null;
  deadlocks: PgBigint | null;
  conflicts: PgBigint | null;
  temp_files: PgBigint | null;
  temp_bytes: PgBigint | null;
  stats_reset: PgTimestamp | null;
}

export interface PgDatabaseSizeRow {
  datname: string;
  size_bytes: PgBigint;
  wal_bytes: PgBigint;
}

export interface PgReplicationPrimaryRow {
  application_name: string | null;
  state: string | null;
  sync_state: string | null;
  write_lag_sec: number | null;
  flush_lag_sec: number | null;
  replay_lag_sec: number | null;
  replay_lag_bytes: PgBigint | null;
  reply_age_sec: number | null;
}

export interface PgReplicationSlotRow {
  slot_name: string;
  slot_type: string;
  active: boolean;
  wal_status: string | null;
  retained_wal_bytes: PgBigint | null;
}

export interface PgReplicationStandbyRow {
  in_recovery: boolean;
  replay_delay_sec: number | null;
  receive_replay_gap_bytes: PgBigint | null;
  caught_up: boolean;
  wal_receiver_status: string | null;
}

export interface PgTableSizeRow {
  schema_name: string;
  table_name: string;
  total_bytes: PgBigint;
  heap_bytes: PgBigint;
  index_bytes: PgBigint;
  estimated_rows: PgBigint;
}

/**
 * 한 번의 조회 주기에서 모은 원시 결과.
 * 이번 주기에 돌리지 않은 쿼리(예: 5분 주기인 database_sizes)는 undefined로 둔다.
 * 실패한 쿼리는 errors에 (sanitizeErrorMessage를 거친) 메시지를 넣는다 → 해당 판단은 unknown.
 */
export interface PgRawSample {
  /** 왕복 시간: server_info 쿼리 기준 (ms) */
  responseMs: number;
  serverInfo: PgServerInfoRow;
  activity?: PgActivitySummaryRow;
  sessions?: PgSessionRow[];
  lockWaits?: PgLockWaitRow[];
  databaseStats?: PgDatabaseStatRow[];
  databaseSizes?: PgDatabaseSizeRow[];
  /** 가장 최근 크기 조회 시각 (database_sizes를 이번 주기에 돌리지 않았으면 이전 조회 시각) */
  databaseSizesAt?: PgTimestamp;
  replicationPrimary?: PgReplicationPrimaryRow[];
  replicationSlots?: PgReplicationSlotRow[];
  replicationStandby?: PgReplicationStandbyRow;
  errors?: Partial<Record<PgQueryId, string>>;
}

/** 판단 기준값 (명세 cluster-status 3.7 기본값). 설정으로 덮어쓸 수 있다. */
export interface PgHealthThresholds {
  responseWarnMs: number;
  /** 접속 시간 초과 기준. 이 값을 넘으면 backend가 연결 실패로 처리한다 */
  connectTimeoutMs: number;
  connectionUsageWarnPct: number;
  connectionUsageCritPct: number;
  longQueryWarnSec: number;
  longQueryCritSec: number;
  idleInTxWarnSec: number;
  idleInTxCritSec: number;
  lockWaitMinSec: number;
  lockWaitWarnCount: number;
  lockWaitCritCount: number;
  cacheHitWarnPct: number;
  cacheHitCritPct: number;
  cacheHitMinBlocks: number;
  deadlockWarnDelta: number;
  xidAgeWarn: number;
  xidAgeCrit: number;
  replicationLagWarnSec: number;
  replicationLagCritSec: number;
}

/** 다음 주기로 넘길 누적 카운터 (DB 합계) */
export interface PgCounterSample {
  at: string;
  xactCommit: number;
  xactRollback: number;
  blksRead: number;
  blksHit: number;
  deadlocks: number;
  /** 하나라도 stats_reset이 바뀌면 차이를 계산하지 않는다 */
  statsResetKey: string;
}

export type PgCheckId =
  | 'reachability'
  | 'connection_usage'
  | 'long_running_queries'
  | 'idle_in_transaction'
  | 'lock_waits'
  | 'cache_hit_ratio'
  | 'deadlocks'
  | 'xid_age'
  | 'replication_lag';

/** 직전 주기 상태. normalizePgHealth가 돌려준 next를 그대로 다음 호출에 넘긴다. */
export interface PgPreviousState {
  counters: PgCounterSample | null;
  levels: Partial<Record<PgCheckId, HealthLevel>>;
  /** 크기는 5분마다만 조회하므로 이전 값을 들고 다닌다 */
  sizes: PgHealthSnapshot['sizes'];
}

export interface PgSessionItem {
  pid: number;
  user: string | null;
  database: string | null;
  state: string | null;
  waitEventType: string | null;
  waitEvent: string | null;
  backendAgeSec: number | null;
  xactAgeSec: number | null;
  queryAgeSec: number | null;
  stateAgeSec: number | null;
}

export interface PgLockWaitItem {
  pid: number;
  user: string | null;
  database: string | null;
  lockType: string;
  mode: string;
  waitSec: number;
  blockedByCount: number;
  firstBlockerPid: number | null;
}

export interface PgStandbyItem {
  name: string | null;
  state: string | null;
  syncState: string | null;
  replayLagSec: number;
  replayLagBytes: number | null;
  replyAgeSec: number | null;
}

export interface PgSlotItem {
  name: string;
  type: string;
  active: boolean;
  walStatus: string | null;
  retainedWalBytes: number | null;
}

/** 정규화 결과 */
export interface PgHealthSnapshot {
  vendor: 'postgres';
  collectedAt: string;
  reachable: boolean;
  responseMs: number | null;
  error: string | null;
  server: {
    version: string;
    versionNum: number;
    role: 'primary' | 'standby';
    uptimeSec: number;
  } | null;
  connections: {
    total: number;
    max: number;
    usagePct: number;
    byState: {
      active: number;
      idle: number;
      idleInTransaction: number;
      idleInTransactionAborted: number;
      other: number;
    };
    waitingOnLock: number;
  } | null;
  longRunning: {
    activeOverWarn: number;
    activeOverCrit: number;
    idleInTxOverWarn: number;
    idleInTxOverCrit: number;
    maxActiveSec: number;
    maxIdleInTxSec: number;
  } | null;
  /** 가장 오래된 세션 (쿼리 원문·클라이언트 주소 없음) */
  sessions: PgSessionItem[];
  locks: {
    waitingTotal: number;
    waitingOverThreshold: number;
    maxWaitSec: number;
    items: PgLockWaitItem[];
  } | null;
  /** 첫 표본이거나 통계 리셋 직후면 null (차이 계산 불가) */
  throughput: {
    intervalSec: number;
    commitsPerSec: number;
    rollbacksPerSec: number;
    /** 표본 블록이 기준 미만이면 null */
    cacheHitPct: number | null;
    blocksInInterval: number;
    deadlocksDelta: number;
  } | null;
  xid: {
    maxAge: number;
    database: string;
    maxMultixactAge: number;
  } | null;
  sizes: {
    measuredAt: string;
    databases: { name: string; bytes: number }[];
    totalBytes: number;
    walBytes: number;
    /** PVC 사용량 근사치 = DB 합계 + WAL (명세 3.7 "근사치") */
    approxDataDirBytes: number;
  } | null;
  replication: {
    role: 'primary' | 'standby';
    standbys: PgStandbyItem[];
    slots: PgSlotItem[];
    /** standby 접속 시 재생 지연 (따라잡았으면 0) */
    standbyReplayDelaySec: number | null;
    walReceiverStatus: string | null;
  } | null;
  checks: HealthCheckResult<PgCheckId>[];
  overall: HealthLevel;
}
