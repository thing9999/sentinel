/**
 * mock 모드용 대표 결과 픽스처 (정상 / 주의 / 장애 / 접속 불가).
 *
 * - 각 시나리오는 15초 간격의 원시 결과 두 개(previous, current)로 되어 있다.
 *   카운터 차이(캐시 적중률·데드락·초당 커밋)를 계산하려면 두 표본이 필요하기 때문이다.
 * - `buildPgFixtureSnapshot(name)`은 실제 정규화 함수를 통과한 스냅샷을 돌려준다.
 *   backend mock은 이것을 그대로 쓰거나, current를 조금씩 흔들어 시간에 따라 값이 바뀌게 한다.
 * - 사용자·DB 이름은 가상의 값이다. 쿼리 원문·클라이언트 주소는 포함하지 않는다.
 */
import {
  normalizePgHealth,
  pgUnreachableSnapshot,
  type NormalizePgResult,
} from './normalize';
import type {
  PgDatabaseStatRow,
  PgRawSample,
  PgReplicationPrimaryRow,
  PgReplicationSlotRow,
} from './types';

export type PgFixtureName = 'ok' | 'warning' | 'critical';

export interface PgFixture {
  name: PgFixtureName;
  description: string;
  /** 기대 전체 상태 */
  expectedOverall: 'ok' | 'warning' | 'critical';
  /** normalizePgHealth의 expectedStandbys로 넘길 값 */
  expectedStandbys: number;
  previous: PgRawSample;
  current: PgRawSample;
}

const T0 = '2026-09-19T01:00:00.000Z';
const T1 = '2026-09-19T01:00:15.000Z';

interface Counters {
  commit: number;
  rollback: number;
  read: number;
  hit: number;
  deadlocks: number;
}

function dbStats(
  app: Counters,
  xidAges: {
    postgres: number;
    app: number;
    template0: number;
    template1: number;
  },
): PgDatabaseStatRow[] {
  const base = (
    datname: string,
    xid: number,
    c: Counters | null,
    opts: { template?: boolean; allowConn?: boolean } = {},
  ): PgDatabaseStatRow => ({
    datname,
    is_template: opts.template ?? false,
    allow_conn: opts.allowConn ?? true,
    xid_age: String(xid),
    mxid_age: String(Math.floor(xid / 50)),
    numbackends: c ? 3 : 0,
    xact_commit: c ? String(c.commit) : '0',
    xact_rollback: c ? String(c.rollback) : '0',
    blks_read: c ? String(c.read) : '0',
    blks_hit: c ? String(c.hit) : '0',
    deadlocks: c ? String(c.deadlocks) : '0',
    conflicts: '0',
    temp_files: '0',
    temp_bytes: '0',
    stats_reset: c ? '2026-09-01T00:00:00.000Z' : null,
  });
  return [
    base('app', xidAges.app, app),
    base('postgres', xidAges.postgres, {
      commit: 50_000,
      rollback: 10,
      read: 2_000,
      hit: 400_000,
      deadlocks: 0,
    }),
    base('template0', xidAges.template0, null, {
      template: true,
      allowConn: false,
    }),
    base('template1', xidAges.template1, null, { template: true }),
  ];
}

const SIZES = [
  {
    datname: 'app',
    size_bytes: String(18_400_000_000),
    wal_bytes: String(1_073_741_824),
  },
  {
    datname: 'postgres',
    size_bytes: String(7_600_000),
    wal_bytes: String(1_073_741_824),
  },
  {
    datname: 'template1',
    size_bytes: String(7_500_000),
    wal_bytes: String(1_073_741_824),
  },
];

function serverInfo(at: string) {
  return {
    server_version: '16.4',
    server_version_num: 160004,
    max_connections: 100,
    superuser_reserved_connections: 3,
    in_recovery: false,
    uptime_sec: 1_209_600,
    server_now: at,
  };
}

function standby(lagSec: number, state = 'streaming'): PgReplicationPrimaryRow {
  return {
    application_name: 'postgres-1',
    state,
    sync_state: 'async',
    write_lag_sec: lagSec / 4,
    flush_lag_sec: lagSec / 2,
    replay_lag_sec: lagSec,
    replay_lag_bytes: String(Math.round(lagSec * 2_000_000)),
    reply_age_sec: 1.2,
  };
}

function slot(active: boolean): PgReplicationSlotRow {
  return {
    slot_name: 'postgres_1',
    slot_type: 'physical',
    active,
    wal_status: active ? 'reserved' : 'extended',
    retained_wal_bytes: String(active ? 16_777_216 : 9_663_676_416),
  };
}

// ---------------------------------------------------------------------------
// 정상: 연결 23%, 오래된 쿼리 없음, 캐시 99.6%, xid 1.2억, standby 지연 0.4초
// ---------------------------------------------------------------------------
const okPrevCounters: Counters = {
  commit: 9_800_000,
  rollback: 1_200,
  read: 800_000,
  hit: 190_000_000,
  deadlocks: 0,
};
const okCurCounters: Counters = {
  commit: 9_804_500,
  rollback: 1_201,
  read: 800_040,
  hit: 190_010_000,
  deadlocks: 0,
};
const okXid = {
  postgres: 110_000_000,
  app: 120_000_000,
  template0: 105_000_000,
  template1: 110_000_000,
};

const okCurrent: PgRawSample = {
  responseMs: 18,
  serverInfo: serverInfo(T1),
  activity: {
    total: 23,
    active: 3,
    idle: 19,
    idle_in_transaction: 1,
    idle_in_transaction_aborted: 0,
    other: 0,
    waiting_on_lock: 0,
    active_over_warn: 0,
    active_over_crit: 0,
    idle_in_tx_over_warn: 0,
    idle_in_tx_over_crit: 0,
    max_active_sec: 0.8,
    max_idle_in_tx_sec: 2.1,
  },
  sessions: [
    {
      pid: 4211,
      usename: 'app_rw',
      datname: 'app',
      state: 'active',
      wait_event_type: null,
      wait_event: null,
      backend_age_sec: 3600,
      xact_age_sec: 0.8,
      query_age_sec: 0.8,
      state_age_sec: 0.8,
    },
    {
      pid: 4388,
      usename: 'app_rw',
      datname: 'app',
      state: 'idle in transaction',
      wait_event_type: 'Client',
      wait_event: 'ClientRead',
      backend_age_sec: 1800,
      xact_age_sec: 2.5,
      query_age_sec: 2.1,
      state_age_sec: 2.1,
    },
  ],
  lockWaits: [],
  databaseStats: dbStats(okCurCounters, okXid),
  databaseSizes: SIZES,
  databaseSizesAt: T0,
  replicationPrimary: [standby(0.4)],
  replicationSlots: [slot(true)],
};

// ---------------------------------------------------------------------------
// 주의: 응답 620ms, 연결 82%, 5분 넘은 쿼리 3건, idle in tx 12분 1건, 잠금 대기 2건,
//       캐시 93%, 데드락 +1, xid 5.6억, standby 지연 25초
// ---------------------------------------------------------------------------
const warnPrevCounters: Counters = {
  commit: 9_800_000,
  rollback: 1_200,
  read: 800_000,
  hit: 190_000_000,
  deadlocks: 3,
};
const warnCurCounters: Counters = {
  commit: 9_802_100,
  rollback: 1_240,
  read: 800_700,
  hit: 190_009_300,
  deadlocks: 4,
};
const warnXid = {
  postgres: 300_000_000,
  app: 560_000_000,
  template0: 290_000_000,
  template1: 300_000_000,
};

const warnCurrent: PgRawSample = {
  responseMs: 620,
  serverInfo: serverInfo(T1),
  activity: {
    total: 82,
    active: 21,
    idle: 58,
    idle_in_transaction: 3,
    idle_in_transaction_aborted: 0,
    other: 0,
    waiting_on_lock: 2,
    active_over_warn: 3,
    active_over_crit: 0,
    idle_in_tx_over_warn: 1,
    idle_in_tx_over_crit: 0,
    max_active_sec: 734,
    max_idle_in_tx_sec: 725,
  },
  sessions: [
    {
      pid: 5120,
      usename: 'report',
      datname: 'app',
      state: 'active',
      wait_event_type: 'IO',
      wait_event: 'DataFileRead',
      backend_age_sec: 7200,
      xact_age_sec: 734,
      query_age_sec: 734,
      state_age_sec: 734,
    },
    {
      pid: 5302,
      usename: 'app_rw',
      datname: 'app',
      state: 'idle in transaction',
      wait_event_type: 'Client',
      wait_event: 'ClientRead',
      backend_age_sec: 3000,
      xact_age_sec: 760,
      query_age_sec: 725,
      state_age_sec: 725,
    },
    {
      pid: 5188,
      usename: 'report',
      datname: 'app',
      state: 'active',
      wait_event_type: null,
      wait_event: null,
      backend_age_sec: 7100,
      xact_age_sec: 512,
      query_age_sec: 512,
      state_age_sec: 512,
    },
    {
      pid: 5190,
      usename: 'batch',
      datname: 'app',
      state: 'active',
      wait_event_type: 'Lock',
      wait_event: 'transactionid',
      backend_age_sec: 900,
      xact_age_sec: 330,
      query_age_sec: 330,
      state_age_sec: 330,
    },
  ],
  lockWaits: [
    {
      pid: 5190,
      usename: 'batch',
      datname: 'app',
      locktype: 'transactionid',
      mode: 'ShareLock',
      wait_sec: 95,
      total_waiting: 2,
      waiting_over_threshold: 2,
      blocked_by_count: 1,
      first_blocker_pid: 5302,
    },
    {
      pid: 5201,
      usename: 'app_rw',
      datname: 'app',
      locktype: 'tuple',
      mode: 'ExclusiveLock',
      wait_sec: 64,
      total_waiting: 2,
      waiting_over_threshold: 2,
      blocked_by_count: 1,
      first_blocker_pid: 5190,
    },
  ],
  databaseStats: dbStats(warnCurCounters, warnXid),
  databaseSizes: SIZES,
  databaseSizesAt: T0,
  replicationPrimary: [standby(25)],
  replicationSlots: [slot(true)],
};

// ---------------------------------------------------------------------------
// 장애: 연결 92% (max 100), 30분 넘은 쿼리 1건, idle in tx 41분 1건, 잠금 대기 6건,
//       캐시 85%, xid 10.5억, standby 연결 끊김(비활성 슬롯)
// ---------------------------------------------------------------------------
const critPrevCounters: Counters = {
  commit: 9_800_000,
  rollback: 1_200,
  read: 800_000,
  hit: 190_000_000,
  deadlocks: 4,
};
const critCurCounters: Counters = {
  commit: 9_800_900,
  rollback: 1_380,
  read: 803_000,
  hit: 190_017_000,
  deadlocks: 4,
};
const critXid = {
  postgres: 400_000_000,
  app: 1_050_000_000,
  template0: 390_000_000,
  template1: 400_000_000,
};

const critCurrent: PgRawSample = {
  responseMs: 180,
  serverInfo: serverInfo(T1),
  activity: {
    total: 92,
    active: 38,
    idle: 47,
    idle_in_transaction: 6,
    idle_in_transaction_aborted: 1,
    other: 0,
    waiting_on_lock: 7,
    active_over_warn: 4,
    active_over_crit: 1,
    idle_in_tx_over_warn: 2,
    idle_in_tx_over_crit: 1,
    max_active_sec: 2530,
    max_idle_in_tx_sec: 2460,
  },
  sessions: [
    {
      pid: 6001,
      usename: 'batch',
      datname: 'app',
      state: 'active',
      wait_event_type: null,
      wait_event: null,
      backend_age_sec: 9000,
      xact_age_sec: 2530,
      query_age_sec: 2530,
      state_age_sec: 2530,
    },
    {
      pid: 6010,
      usename: 'app_rw',
      datname: 'app',
      state: 'idle in transaction',
      wait_event_type: 'Client',
      wait_event: 'ClientRead',
      backend_age_sec: 5000,
      xact_age_sec: 2500,
      query_age_sec: 2460,
      state_age_sec: 2460,
    },
    {
      pid: 6022,
      usename: 'app_rw',
      datname: 'app',
      state: 'idle in transaction (aborted)',
      wait_event_type: 'Client',
      wait_event: 'ClientRead',
      backend_age_sec: 4000,
      xact_age_sec: 700,
      query_age_sec: 650,
      state_age_sec: 650,
    },
  ],
  lockWaits: Array.from({ length: 6 }, (_, i) => ({
    pid: 6100 + i,
    usename: 'app_rw',
    datname: 'app',
    locktype: 'relation',
    mode: 'RowExclusiveLock',
    wait_sec: 400 - i * 50,
    total_waiting: 7,
    waiting_over_threshold: 6,
    blocked_by_count: 1,
    first_blocker_pid: 6001,
  })),
  databaseStats: dbStats(critCurCounters, critXid),
  databaseSizes: SIZES,
  databaseSizesAt: T0,
  replicationPrimary: [],
  replicationSlots: [slot(false)],
};

function previousOf(
  current: PgRawSample,
  counters: Counters,
  xid: typeof okXid,
): PgRawSample {
  return {
    ...current,
    serverInfo: serverInfo(T0),
    databaseStats: dbStats(counters, xid),
  };
}

export const PG_HEALTH_FIXTURES: Readonly<Record<PgFixtureName, PgFixture>> = {
  ok: {
    name: 'ok',
    description: '정상: 연결 23%, 캐시 99.6%, standby 지연 0.4초',
    expectedOverall: 'ok',
    expectedStandbys: 1,
    previous: previousOf(okCurrent, okPrevCounters, okXid),
    current: okCurrent,
  },
  warning: {
    name: 'warning',
    description:
      '주의: 연결 82%, 5분 넘은 쿼리 3건, idle in tx 12분, 캐시 93%, 데드락 +1',
    expectedOverall: 'warning',
    expectedStandbys: 1,
    previous: previousOf(warnCurrent, warnPrevCounters, warnXid),
    current: warnCurrent,
  },
  critical: {
    name: 'critical',
    description:
      '장애: 연결 92% (max 100), 30분 넘은 쿼리, 잠금 대기 6건, xid 10.5억, standby 끊김',
    expectedOverall: 'critical',
    expectedStandbys: 1,
    previous: previousOf(critCurrent, critPrevCounters, critXid),
    current: critCurrent,
  },
};

/** 픽스처를 정규화 함수에 두 번 통과시켜(직전 → 현재) 완성된 스냅샷을 만든다. */
export function buildPgFixtureSnapshot(name: PgFixtureName): NormalizePgResult {
  const f = PG_HEALTH_FIXTURES[name];
  const first = normalizePgHealth(f.previous, {
    expectedStandbys: f.expectedStandbys,
  });
  return normalizePgHealth(f.current, {
    prev: first.next,
    expectedStandbys: f.expectedStandbys,
  });
}

/** 접속 불가 시나리오 (인증 실패). 오류 메시지의 비밀번호가 가려지는 것도 확인할 수 있다. */
export function buildPgUnreachableFixture(): NormalizePgResult {
  const err = Object.assign(
    new Error(
      'password authentication failed for user "sentinel_monitor" (postgres://sentinel_monitor:s3cret@postgres.db.svc:5432/postgres)',
    ),
    { code: '28P01' },
  );
  return pgUnreachableSnapshot(err, { collectedAt: T1 });
}
