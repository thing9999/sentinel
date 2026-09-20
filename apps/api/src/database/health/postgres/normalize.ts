/**
 * PostgreSQL 상태 조회 결과 → 정규화 스냅샷 + 판단 (순수 함수).
 *
 * 사용 흐름 (backend):
 *   let prev: PgPreviousState | null = null;
 *   // 15초마다
 *   try {
 *     const raw = await collect();                // queries.ts의 SQL 실행
 *     const { snapshot, next } = normalizePgHealth(raw, { prev });
 *     prev = next;  publish(snapshot);
 *   } catch (err) {                               // 접속 실패·server_info 실패
 *     const { snapshot, next } = pgUnreachableSnapshot(err, { prev, collectedAt: new Date() });
 *     prev = next;  publish(snapshot);
 *   }
 *
 * 여기서 계산하는 level은 "이번 표본 기준"이다.
 * 사용률 지표(checks[].sustained = true)의 연속 3회 조건은 backend가 적용한다 (명세 3.0).
 */
import { sanitizeErrorMessage } from '../sanitize';
import {
  worstLevel,
  type HealthCheckResult,
  type HealthLevel,
  type HealthUnit,
} from '../types';
import type {
  PgBigint,
  PgCheckId,
  PgCounterSample,
  PgHealthSnapshot,
  PgHealthThresholds,
  PgPreviousState,
  PgRawSample,
  PgTimestamp,
} from './types';
import type { PgQueryId } from './queries';

/** 명세 cluster-status 3.7 기본값 */
export const DEFAULT_PG_THRESHOLDS: Readonly<PgHealthThresholds> = {
  responseWarnMs: 500,
  connectTimeoutMs: 5000,
  connectionUsageWarnPct: 70,
  connectionUsageCritPct: 90,
  longQueryWarnSec: 300,
  longQueryCritSec: 1800,
  idleInTxWarnSec: 300,
  idleInTxCritSec: 1800,
  lockWaitMinSec: 60,
  lockWaitWarnCount: 1,
  lockWaitCritCount: 5,
  cacheHitWarnPct: 95,
  cacheHitCritPct: 90,
  cacheHitMinBlocks: 1000,
  deadlockWarnDelta: 1,
  xidAgeWarn: 500_000_000,
  xidAgeCrit: 1_000_000_000,
  replicationLagWarnSec: 10,
  replicationLagCritSec: 60,
};

/** 판단 순서 (화면 표시 순서와 같다) */
export const PG_CHECK_ORDER: readonly PgCheckId[] = [
  'reachability',
  'connection_usage',
  'long_running_queries',
  'idle_in_transaction',
  'lock_waits',
  'cache_hit_ratio',
  'deadlocks',
  'xid_age',
  'replication_lag',
];

export interface NormalizePgOptions {
  prev?: PgPreviousState | null;
  thresholds?: Partial<PgHealthThresholds>;
  /**
   * 기대하는 standby 수 (예: DB StatefulSet replicas - 1). 모르면 생략.
   * 지정하면 연결된(streaming) standby가 이보다 적을 때 "standby 연결 끊김"(장애).
   */
  expectedStandbys?: number;
}

export interface NormalizePgResult {
  snapshot: PgHealthSnapshot;
  next: PgPreviousState;
}

// ---------------------------------------------------------------------------
// 작은 헬퍼
// ---------------------------------------------------------------------------

function toNum(v: PgBigint | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: PgBigint | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIso(v: PgTimestamp): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 경과 시간을 "42초", "12분", "1시간 5분"으로 */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

/** 5.2억 같은 표기 */
function formatEok(n: number): string {
  if (n >= 100_000_000) return `${round(n / 100_000_000, 1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000)}만`;
  return String(n);
}

function check(
  id: PgCheckId,
  level: HealthLevel,
  reason: string,
  value: number | null,
  unit: HealthUnit | null,
  extra: Partial<
    Pick<HealthCheckResult, 'applicable' | 'held' | 'sustained'>
  > = {},
): HealthCheckResult<PgCheckId> {
  return {
    id,
    level,
    reason,
    value,
    unit,
    applicable: extra.applicable ?? true,
    held: extra.held ?? false,
    sustained: extra.sustained ?? false,
  };
}

function unknownCheck(
  id: PgCheckId,
  reason: string,
): HealthCheckResult<PgCheckId> {
  return check(id, 'unknown', reason, null, null);
}

function failReason(
  raw: PgRawSample,
  key: keyof NonNullable<PgRawSample['errors']>,
): string {
  const err = raw.errors?.[key];
  return err ? `조회 실패: ${err}` : '이번 주기에 조회하지 않음';
}

function levelByUpper(value: number, warn: number, crit: number): HealthLevel {
  if (value >= crit) return 'critical';
  if (value >= warn) return 'warning';
  return 'ok';
}

// ---------------------------------------------------------------------------
// 카운터 (직전 표본과의 차이)
// ---------------------------------------------------------------------------

function buildCounters(raw: PgRawSample, at: string): PgCounterSample | null {
  if (!raw.databaseStats) return null;
  const c: PgCounterSample = {
    at,
    xactCommit: 0,
    xactRollback: 0,
    blksRead: 0,
    blksHit: 0,
    deadlocks: 0,
    statsResetKey: '',
  };
  const resetParts: string[] = [];
  for (const r of raw.databaseStats) {
    c.xactCommit += toNum(r.xact_commit);
    c.xactRollback += toNum(r.xact_rollback);
    c.blksRead += toNum(r.blks_read);
    c.blksHit += toNum(r.blks_hit);
    c.deadlocks += toNum(r.deadlocks);
    resetParts.push(
      `${r.datname}:${r.stats_reset ? toIso(r.stats_reset) : '-'}`,
    );
  }
  c.statsResetKey = resetParts.join('|');
  return c;
}

function computeThroughput(
  cur: PgCounterSample | null,
  prev: PgCounterSample | null,
  minBlocks: number,
): PgHealthSnapshot['throughput'] {
  if (!cur || !prev) return null;
  if (cur.statsResetKey !== prev.statsResetKey) return null;
  const intervalSec = (Date.parse(cur.at) - Date.parse(prev.at)) / 1000;
  if (!(intervalSec > 0)) return null;
  const d = {
    commit: cur.xactCommit - prev.xactCommit,
    rollback: cur.xactRollback - prev.xactRollback,
    read: cur.blksRead - prev.blksRead,
    hit: cur.blksHit - prev.blksHit,
    deadlocks: cur.deadlocks - prev.deadlocks,
  };
  // 카운터가 줄었으면 리셋(또는 DB 삭제)으로 본다
  if (Object.values(d).some((v) => v < 0)) return null;
  const blocks = d.read + d.hit;
  return {
    intervalSec: round(intervalSec, 1),
    commitsPerSec: round(d.commit / intervalSec, 2),
    rollbacksPerSec: round(d.rollback / intervalSec, 2),
    cacheHitPct: blocks >= minBlocks ? round((d.hit / blocks) * 100, 2) : null,
    blocksInInterval: blocks,
    deadlocksDelta: d.deadlocks,
  };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

export function normalizePgHealth(
  raw: PgRawSample,
  opts: NormalizePgOptions = {},
): NormalizePgResult {
  const t: PgHealthThresholds = {
    ...DEFAULT_PG_THRESHOLDS,
    ...opts.thresholds,
  };
  const prev = opts.prev ?? null;
  const si = raw.serverInfo;
  const collectedAt = toIso(si.server_now);
  const role: 'primary' | 'standby' = si.in_recovery ? 'standby' : 'primary';

  // --- 정규화 --------------------------------------------------------------
  const a = raw.activity;
  const connections: PgHealthSnapshot['connections'] = a
    ? {
        total: a.total,
        max: si.max_connections,
        usagePct:
          si.max_connections > 0
            ? round((a.total / si.max_connections) * 100, 1)
            : 0,
        byState: {
          active: a.active,
          idle: a.idle,
          idleInTransaction: a.idle_in_transaction,
          idleInTransactionAborted: a.idle_in_transaction_aborted,
          other: a.other,
        },
        waitingOnLock: a.waiting_on_lock,
      }
    : null;

  const longRunning: PgHealthSnapshot['longRunning'] = a
    ? {
        activeOverWarn: a.active_over_warn,
        activeOverCrit: a.active_over_crit,
        idleInTxOverWarn: a.idle_in_tx_over_warn,
        idleInTxOverCrit: a.idle_in_tx_over_crit,
        maxActiveSec: round(a.max_active_sec, 1),
        maxIdleInTxSec: round(a.max_idle_in_tx_sec, 1),
      }
    : null;

  const sessions = (raw.sessions ?? []).map((s) => ({
    pid: s.pid,
    user: s.usename,
    database: s.datname,
    state: s.state,
    waitEventType: s.wait_event_type,
    waitEvent: s.wait_event,
    backendAgeSec:
      s.backend_age_sec === null ? null : round(s.backend_age_sec, 1),
    xactAgeSec: s.xact_age_sec === null ? null : round(s.xact_age_sec, 1),
    queryAgeSec: s.query_age_sec === null ? null : round(s.query_age_sec, 1),
    stateAgeSec: s.state_age_sec === null ? null : round(s.state_age_sec, 1),
  }));

  const lw = raw.lockWaits;
  const locks: PgHealthSnapshot['locks'] = lw
    ? {
        waitingTotal: lw[0]?.total_waiting ?? 0,
        waitingOverThreshold: lw[0]?.waiting_over_threshold ?? 0,
        maxWaitSec: round(lw[0]?.wait_sec ?? 0, 1),
        items: lw.map((l) => ({
          pid: l.pid,
          user: l.usename,
          database: l.datname,
          lockType: l.locktype,
          mode: l.mode,
          waitSec: round(l.wait_sec, 1),
          blockedByCount: l.blocked_by_count,
          firstBlockerPid: l.first_blocker_pid,
        })),
      }
    : null;

  const counters = buildCounters(raw, collectedAt);
  const throughput = computeThroughput(
    counters,
    prev?.counters ?? null,
    t.cacheHitMinBlocks,
  );

  let xid: PgHealthSnapshot['xid'] = null;
  if (raw.databaseStats && raw.databaseStats.length > 0) {
    let maxAge = -1;
    let maxDb = '';
    let maxMxid = 0;
    for (const r of raw.databaseStats) {
      const age = toNum(r.xid_age);
      if (age > maxAge) {
        maxAge = age;
        maxDb = r.datname;
      }
      maxMxid = Math.max(maxMxid, toNum(r.mxid_age));
    }
    xid = { maxAge, database: maxDb, maxMultixactAge: maxMxid };
  }

  let sizes: PgHealthSnapshot['sizes'] = prev?.sizes ?? null;
  if (raw.databaseSizes) {
    const databases = raw.databaseSizes.map((r) => ({
      name: r.datname,
      bytes: toNum(r.size_bytes),
    }));
    const totalBytes = databases.reduce((s, d) => s + d.bytes, 0);
    const walBytes = toNum(raw.databaseSizes[0]?.wal_bytes);
    sizes = {
      measuredAt: raw.databaseSizesAt
        ? toIso(raw.databaseSizesAt)
        : collectedAt,
      databases,
      totalBytes,
      walBytes,
      approxDataDirBytes: totalBytes + walBytes,
    };
  }

  let replication: PgHealthSnapshot['replication'] = null;
  if (role === 'primary' && raw.replicationPrimary) {
    replication = {
      role,
      standbys: raw.replicationPrimary.map((r) => {
        const bytes = toNumOrNull(r.replay_lag_bytes);
        return {
          name: r.application_name,
          state: r.state,
          syncState: r.sync_state,
          // lag 컬럼은 따라잡은 뒤 새 WAL이 없으면 NULL → 0
          replayLagSec: round(r.replay_lag_sec ?? 0, 1),
          replayLagBytes: bytes,
          replyAgeSec:
            r.reply_age_sec === null ? null : round(r.reply_age_sec, 1),
        };
      }),
      slots: (raw.replicationSlots ?? []).map((s) => ({
        name: s.slot_name,
        type: s.slot_type,
        active: s.active,
        walStatus: s.wal_status,
        retainedWalBytes: toNumOrNull(s.retained_wal_bytes),
      })),
      standbyReplayDelaySec: null,
      walReceiverStatus: null,
    };
  } else if (role === 'standby' && raw.replicationStandby) {
    const st = raw.replicationStandby;
    replication = {
      role,
      standbys: [],
      slots: [],
      standbyReplayDelaySec: st.caught_up
        ? 0
        : round(st.replay_delay_sec ?? 0, 1),
      walReceiverStatus: st.wal_receiver_status,
    };
  }

  // --- 판단 ----------------------------------------------------------------
  const prevLevels = prev?.levels ?? {};
  const checks: HealthCheckResult<PgCheckId>[] = [];

  // 접속·응답 시간
  checks.push(
    raw.responseMs >= t.responseWarnMs
      ? check(
          'reachability',
          'warning',
          `응답 ${Math.round(raw.responseMs)}ms (기준 ${t.responseWarnMs}ms)`,
          raw.responseMs,
          'ms',
        )
      : check(
          'reachability',
          'ok',
          `응답 ${Math.round(raw.responseMs)}ms`,
          raw.responseMs,
          'ms',
        ),
  );

  // 연결 사용률
  if (connections) {
    const pct =
      connections.max > 0 ? (connections.total / connections.max) * 100 : 0;
    checks.push(
      check(
        'connection_usage',
        levelByUpper(pct, t.connectionUsageWarnPct, t.connectionUsageCritPct),
        `연결 ${Math.round(pct)}% (max ${connections.max})`,
        connections.usagePct,
        'percent',
        { sustained: true },
      ),
    );
  } else {
    checks.push(
      unknownCheck('connection_usage', failReason(raw, 'activity_summary')),
    );
  }

  // 오래 실행 중인 쿼리 / idle in transaction
  if (longRunning) {
    const lr = longRunning;
    const warnLabel = formatDuration(t.longQueryWarnSec);
    const critLabel = formatDuration(t.longQueryCritSec);
    if (lr.activeOverCrit > 0) {
      checks.push(
        check(
          'long_running_queries',
          'critical',
          `${critLabel} 이상 실행 중인 쿼리 ${lr.activeOverCrit}건 (최장 ${formatDuration(lr.maxActiveSec)})`,
          lr.maxActiveSec,
          'sec',
        ),
      );
    } else if (lr.activeOverWarn > 0) {
      checks.push(
        check(
          'long_running_queries',
          'warning',
          `${warnLabel} 이상 실행 중인 쿼리 ${lr.activeOverWarn}건 (최장 ${formatDuration(lr.maxActiveSec)})`,
          lr.maxActiveSec,
          'sec',
        ),
      );
    } else {
      checks.push(
        check(
          'long_running_queries',
          'ok',
          `${warnLabel} 이상 실행 중인 쿼리 없음`,
          lr.maxActiveSec,
          'sec',
        ),
      );
    }

    const iwLabel = formatDuration(t.idleInTxWarnSec);
    const icLabel = formatDuration(t.idleInTxCritSec);
    if (lr.idleInTxOverCrit > 0) {
      checks.push(
        check(
          'idle_in_transaction',
          'critical',
          `idle in transaction ${icLabel} 이상 ${lr.idleInTxOverCrit}건 (최장 ${formatDuration(lr.maxIdleInTxSec)})`,
          lr.maxIdleInTxSec,
          'sec',
        ),
      );
    } else if (lr.idleInTxOverWarn > 0) {
      checks.push(
        check(
          'idle_in_transaction',
          'warning',
          `idle in transaction ${iwLabel} 이상 ${lr.idleInTxOverWarn}건 (최장 ${formatDuration(lr.maxIdleInTxSec)})`,
          lr.maxIdleInTxSec,
          'sec',
        ),
      );
    } else {
      checks.push(
        check(
          'idle_in_transaction',
          'ok',
          `idle in transaction ${iwLabel} 이상 없음`,
          lr.maxIdleInTxSec,
          'sec',
        ),
      );
    }
  } else {
    const reason = failReason(raw, 'activity_summary');
    checks.push(unknownCheck('long_running_queries', reason));
    checks.push(unknownCheck('idle_in_transaction', reason));
  }

  // 잠금 대기
  if (locks) {
    const n = locks.waitingOverThreshold;
    const label = formatDuration(t.lockWaitMinSec);
    const level: HealthLevel =
      n >= t.lockWaitCritCount
        ? 'critical'
        : n >= t.lockWaitWarnCount
          ? 'warning'
          : 'ok';
    checks.push(
      check(
        'lock_waits',
        level,
        n > 0
          ? `${label} 이상 잠금 대기 ${n}건 (최장 ${formatDuration(locks.maxWaitSec)})`
          : `${label} 이상 잠금 대기 없음`,
        n,
        'count',
      ),
    );
  } else {
    checks.push(unknownCheck('lock_waits', failReason(raw, 'lock_waits')));
  }

  // 캐시 적중률·데드락 (직전 표본 대비)
  if (!raw.databaseStats) {
    const reason = failReason(raw, 'database_stats');
    checks.push(unknownCheck('cache_hit_ratio', reason));
    checks.push(unknownCheck('deadlocks', reason));
  } else if (!throughput) {
    const reason = prev?.counters
      ? '통계 리셋 감지 - 다음 조회부터 판단'
      : '첫 표본 - 다음 조회부터 판단';
    checks.push(
      check(
        'cache_hit_ratio',
        prevLevels.cache_hit_ratio ?? 'ok',
        reason,
        null,
        'percent',
        { held: true, sustained: true },
      ),
    );
    checks.push(
      check('deadlocks', prevLevels.deadlocks ?? 'ok', reason, null, 'count', {
        held: true,
      }),
    );
  } else {
    if (throughput.cacheHitPct === null) {
      checks.push(
        check(
          'cache_hit_ratio',
          prevLevels.cache_hit_ratio ?? 'ok',
          `표본 부족 (블록 ${throughput.blocksInInterval} < ${t.cacheHitMinBlocks}), 이전 상태 유지`,
          null,
          'percent',
          { held: true, sustained: true },
        ),
      );
    } else {
      const pct = throughput.cacheHitPct;
      const level: HealthLevel =
        pct < t.cacheHitCritPct
          ? 'critical'
          : pct < t.cacheHitWarnPct
            ? 'warning'
            : 'ok';
      checks.push(
        check('cache_hit_ratio', level, `캐시 적중률 ${pct}%`, pct, 'percent', {
          sustained: true,
        }),
      );
    }
    const dd = throughput.deadlocksDelta;
    checks.push(
      dd >= t.deadlockWarnDelta
        ? check(
            'deadlocks',
            'warning',
            `데드락 +${dd} (직전 조회 대비)`,
            dd,
            'count',
          )
        : check('deadlocks', 'ok', '데드락 증가 없음', dd, 'count'),
    );
  }

  // 트랜잭션 ID 나이
  if (xid) {
    checks.push(
      check(
        'xid_age',
        levelByUpper(xid.maxAge, t.xidAgeWarn, t.xidAgeCrit),
        `트랜잭션 ID 나이 ${formatEok(xid.maxAge)} (${xid.database})`,
        xid.maxAge,
        'xid',
      ),
    );
  } else {
    checks.push(unknownCheck('xid_age', failReason(raw, 'database_stats')));
  }

  // 복제 지연
  checks.push(
    replicationCheck(raw, replication, role, t, opts.expectedStandbys),
  );

  const overall = worstLevel(checks.map((c) => c.level));

  const snapshot: PgHealthSnapshot = {
    vendor: 'postgres',
    collectedAt,
    reachable: true,
    responseMs: round(raw.responseMs, 1),
    error: null,
    server: {
      version: si.server_version,
      versionNum: si.server_version_num,
      role,
      uptimeSec: Math.floor(si.uptime_sec),
    },
    connections,
    longRunning,
    sessions,
    locks,
    throughput,
    xid,
    sizes,
    replication,
    checks,
    overall,
  };

  const levels: Partial<Record<PgCheckId, HealthLevel>> = {};
  for (const c of checks) levels[c.id] = c.level;

  return {
    snapshot,
    next: {
      // databaseStats를 못 받았으면 이전 카운터를 유지해서 다음 주기에 차이를 계산한다
      counters: counters ?? prev?.counters ?? null,
      levels,
      sizes,
    },
  };
}

function replicationCheck(
  raw: PgRawSample,
  replication: PgHealthSnapshot['replication'],
  role: 'primary' | 'standby',
  t: PgHealthThresholds,
  expectedStandbys: number | undefined,
): HealthCheckResult<PgCheckId> {
  const warn = t.replicationLagWarnSec;
  const crit = t.replicationLagCritSec;

  if (role === 'standby') {
    if (!replication) {
      return unknownCheck(
        'replication_lag',
        failReason(raw, 'replication_standby'),
      );
    }
    const status = replication.walReceiverStatus;
    const delay = replication.standbyReplayDelaySec ?? 0;
    if (status !== 'streaming') {
      return check(
        'replication_lag',
        'critical',
        `WAL 수신 끊김 (상태: ${status ?? '없음'})`,
        delay,
        'sec',
      );
    }
    return check(
      'replication_lag',
      levelByUpper(delay, warn, crit),
      `재생 지연 ${formatDuration(delay)}`,
      delay,
      'sec',
    );
  }

  if (!replication) {
    return unknownCheck(
      'replication_lag',
      failReason(raw, 'replication_primary'),
    );
  }

  const streaming = replication.standbys.filter((s) => s.state === 'streaming');
  const inactivePhysical = replication.slots.filter(
    (s) => !s.active && s.type === 'physical',
  );
  const inactiveLogical = replication.slots.filter(
    (s) => !s.active && s.type !== 'physical',
  );
  const expected = expectedStandbys ?? 0;

  if (
    replication.standbys.length === 0 &&
    expected === 0 &&
    replication.slots.length === 0
  ) {
    return check(
      'replication_lag',
      'ok',
      'standby 없음 - 해당 없음',
      null,
      'sec',
      { applicable: false },
    );
  }

  const maxLag = replication.standbys.reduce(
    (m, s) => Math.max(m, s.replayLagSec),
    0,
  );

  if (expected > 0 && streaming.length < expected) {
    return check(
      'replication_lag',
      'critical',
      `standby 연결 끊김 (연결 ${streaming.length}/${expected})`,
      maxLag,
      'sec',
    );
  }
  if (inactivePhysical.length > 0) {
    return check(
      'replication_lag',
      'critical',
      `비활성 복제 슬롯 ${inactivePhysical.length}개 (standby 연결 끊김 의심: ${inactivePhysical.map((s) => s.name).join(', ')})`,
      maxLag,
      'sec',
    );
  }

  const lagLevel = levelByUpper(maxLag, warn, crit);
  const notStreaming = replication.standbys.length - streaming.length;
  const parts = [
    `최대 재생 지연 ${formatDuration(maxLag)} (standby ${replication.standbys.length})`,
  ];
  let level = lagLevel;
  if (notStreaming > 0) {
    parts.push(`streaming 아님 ${notStreaming}`);
    level = worstLevel([level, 'warning']);
  }
  if (inactiveLogical.length > 0) {
    parts.push(`비활성 논리 슬롯 ${inactiveLogical.length}`);
    level = worstLevel([level, 'warning']);
  }
  return check('replication_lag', level, parts.join(', '), maxLag, 'sec');
}

/**
 * 접속 실패·인증 실패·시간 초과·server_info 실패 시의 스냅샷.
 * 접속 판단은 장애, 나머지 판단은 알 수 없음 (명세 3.7: "DB 파드가 떠 있는데 접속이 안 되면 장애").
 * DB 파드 자체가 없을 때 대표 사유를 파드 쪽으로 돌리는 것은 backend가 한다.
 */
export function pgUnreachableSnapshot(
  error: unknown,
  opts: {
    collectedAt: Date | string;
    prev?: PgPreviousState | null;
    timedOut?: boolean;
    thresholds?: Partial<PgHealthThresholds>;
  },
): NormalizePgResult {
  const t: PgHealthThresholds = {
    ...DEFAULT_PG_THRESHOLDS,
    ...opts.thresholds,
  };
  const message = sanitizeErrorMessage(error);
  const reason = opts.timedOut
    ? `시간 초과 (${t.connectTimeoutMs / 1000}초)`
    : `접속 실패: ${message}`;
  const checks: HealthCheckResult<PgCheckId>[] = PG_CHECK_ORDER.map((id) =>
    id === 'reachability'
      ? check(id, 'critical', reason, null, 'ms')
      : unknownCheck(id, 'DB 접속 불가'),
  );
  const prev = opts.prev ?? null;
  return {
    snapshot: {
      vendor: 'postgres',
      collectedAt: toIso(opts.collectedAt),
      reachable: false,
      responseMs: null,
      error: opts.timedOut ? reason : message,
      server: null,
      connections: null,
      longRunning: null,
      sessions: [],
      locks: null,
      throughput: null,
      xid: null,
      sizes: prev?.sizes ?? null,
      replication: null,
      checks,
      overall: 'critical',
    },
    next: {
      counters: prev?.counters ?? null,
      levels: { ...(prev?.levels ?? {}), reachability: 'critical' },
      sizes: prev?.sizes ?? null,
    },
  };
}

/**
 * PVC 사용률 근사치 (정확한 볼륨 사용량이 없을 때, 명세 3.7).
 * DB 합계 + WAL을 PVC 용량으로 나눈다. 실제보다 **작게** 나온다
 * (로그·임시 파일·파일시스템 메타데이터 제외). 화면에 "근사치" 라벨 필수.
 */
export function approxPvcUsagePct(
  sizes: PgHealthSnapshot['sizes'],
  pvcCapacityBytes: number | null | undefined,
): number | null {
  if (!sizes || !pvcCapacityBytes || pvcCapacityBytes <= 0) return null;
  return round((sizes.approxDataDirBytes / pvcCapacityBytes) * 100, 1);
}

/**
 * 쿼리 위치 파라미터를 판단 기준값에서 만든다 (파라미터 순서 실수 방지).
 * 파라미터가 없는 쿼리는 빈 배열.
 */
export function pgQueryParams(
  id: PgQueryId,
  thresholds?: Partial<PgHealthThresholds>,
): number[] {
  const t: PgHealthThresholds = {
    ...DEFAULT_PG_THRESHOLDS,
    ...thresholds,
  };
  switch (id) {
    case 'activity_summary':
      return [
        t.longQueryWarnSec,
        t.longQueryCritSec,
        t.idleInTxWarnSec,
        t.idleInTxCritSec,
      ];
    case 'lock_waits':
      return [t.lockWaitMinSec];
    default:
      return [];
  }
}
