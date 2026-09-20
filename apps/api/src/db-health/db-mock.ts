/**
 * mock DB 상태 (DATA_SOURCE=mock). DBA 픽스처(`PG_HEALTH_FIXTURES`)를 시간에 따라 조금씩 흔들어
 * 실제 정규화 함수(`normalizePgHealth`)에 통과시킨다.
 */
import {
  normalizePgHealth,
  PG_HEALTH_FIXTURES,
  pgUnreachableSnapshot,
  type NormalizePgResult,
  type PgFixtureName,
  type PgPreviousState,
  type PgRawSample,
} from '../database/health';

export const DB_SCENARIOS = [
  'warning',
  'ok',
  'critical',
  'unreachable',
  'no-pod',
  'standby',
  'stale',
  'not-configured',
] as const;
export type DbScenario = (typeof DB_SCENARIOS)[number];

function fixtureOf(s: DbScenario): PgFixtureName {
  if (s === 'ok' || s === 'standby') return 'ok';
  if (s === 'critical') return 'critical';
  return 'warning';
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function jitter(scale: number): number {
  return (Math.random() * 2 - 1) * scale;
}

/**
 * 시나리오 하나의 시뮬레이터. `next(now)`를 15초마다 부른다.
 */
export class MockPgSimulator {
  private prev: PgPreviousState | null = null;
  /** DB별 누적 카운터 (커밋·블록·데드락) */
  private counters = new Map<
    string,
    {
      commit: number;
      rollback: number;
      read: number;
      hit: number;
      deadlocks: number;
    }
  >();
  private deltas = new Map<
    string,
    {
      commit: number;
      rollback: number;
      read: number;
      hit: number;
      deadlocks: number;
    }
  >();
  private readonly base: PgRawSample;
  readonly expectedStandbys: number;
  private ticks = 0;

  constructor(readonly scenario: DbScenario) {
    const f = PG_HEALTH_FIXTURES[fixtureOf(scenario)];
    this.base = structuredClone(f.current);
    this.expectedStandbys = f.expectedStandbys;
    const prevStats = new Map(
      (f.previous.databaseStats ?? []).map((r) => [r.datname, r]),
    );
    for (const r of f.current.databaseStats ?? []) {
      const p = prevStats.get(r.datname);
      const cur = {
        commit: num(r.xact_commit),
        rollback: num(r.xact_rollback),
        read: num(r.blks_read),
        hit: num(r.blks_hit),
        deadlocks: num(r.deadlocks),
      };
      this.counters.set(r.datname, { ...cur });
      this.deltas.set(r.datname, {
        commit: Math.max(0, cur.commit - num(p?.xact_commit)),
        rollback: Math.max(0, cur.rollback - num(p?.xact_rollback)),
        read: Math.max(0, cur.read - num(p?.blks_read)),
        hit: Math.max(0, cur.hit - num(p?.blks_hit)),
        deadlocks: Math.max(0, cur.deadlocks - num(p?.deadlocks)),
      });
    }
    if (scenario === 'standby' && this.base.replicationPrimary?.[0]) {
      // 복제 지연 주의 (10~60초)
      this.base.replicationPrimary[0].replay_lag_sec = 14;
      this.base.replicationPrimary[0].replay_lag_bytes = String(28_000_000);
    }
  }

  /** 다음 표본 (정규화 결과) */
  next(now: number): NormalizePgResult {
    this.ticks += 1;
    if (this.scenario === 'unreachable' || this.scenario === 'no-pod') {
      const err =
        this.scenario === 'no-pod'
          ? Object.assign(new Error('connect ECONNREFUSED 10.100.12.7:5432'), {
              code: 'ECONNREFUSED',
            })
          : Object.assign(
              new Error(
                'password authentication failed for user "sentinel_monitor" (postgres://sentinel_monitor:s3cret@postgres.data.svc:5432/postgres)',
              ),
              { code: '28P01' },
            );
      const r = pgUnreachableSnapshot(err, {
        collectedAt: new Date(now),
        prev: this.prev,
      });
      this.prev = r.next;
      return r;
    }
    const raw: PgRawSample = structuredClone(this.base);
    const at = new Date(now).toISOString();
    raw.serverInfo = {
      ...raw.serverInfo,
      server_now: at,
      uptime_sec: raw.serverInfo.uptime_sec + this.ticks * 15,
    };
    raw.responseMs = Math.max(2, raw.responseMs * (1 + jitter(0.3)));
    // 경과 시간은 5분 주기로 오르내린다 (시나리오 등급이 바뀌지 않게)
    const drift = (this.ticks % 20) * 15;
    if (raw.activity) {
      const a = raw.activity;
      const d = Math.round(jitter(2));
      const max = raw.serverInfo.max_connections;
      a.idle = Math.max(0, a.idle + d);
      a.total = Math.min(
        max,
        Math.max(
          1,
          a.active +
            a.idle +
            a.idle_in_transaction +
            a.idle_in_transaction_aborted +
            a.other,
        ),
      );
      a.max_active_sec =
        a.max_active_sec + (a.active_over_warn > 0 ? drift : 0);
      a.max_idle_in_tx_sec =
        a.max_idle_in_tx_sec + (a.idle_in_tx_over_warn > 0 ? drift : 0);
    }
    for (const s of raw.sessions ?? []) {
      const add = (v: number | null) => (v === null ? null : v + drift);
      s.backend_age_sec = add(s.backend_age_sec);
      if (s.state !== 'active' || (s.query_age_sec ?? 0) > 60) {
        s.xact_age_sec = add(s.xact_age_sec);
        s.query_age_sec = add(s.query_age_sec);
        s.state_age_sec = add(s.state_age_sec);
      }
    }
    // 카운터 누적 (캐시 적중률·초당 커밋이 조금씩 흔들림)
    raw.databaseStats = (raw.databaseStats ?? []).map((r) => {
      const c = this.counters.get(r.datname);
      const d = this.deltas.get(r.datname);
      if (!c || !d) return r;
      const f = 1 + jitter(0.12);
      c.commit += Math.round(d.commit * f);
      c.rollback += Math.round(d.rollback * f);
      c.read += Math.round(d.read * (1 + jitter(0.2)));
      c.hit += Math.round(d.hit * f);
      // 데드락은 픽스처가 증가를 담고 있으면 가끔만
      if (d.deadlocks > 0 && this.ticks % 8 === 0) c.deadlocks += d.deadlocks;
      return {
        ...r,
        xact_commit: String(c.commit),
        xact_rollback: String(c.rollback),
        blks_read: String(c.read),
        blks_hit: String(c.hit),
        deadlocks: String(c.deadlocks),
        xid_age: String(num(r.xid_age) + this.ticks * 1200),
      };
    });
    if (raw.databaseSizes) {
      raw.databaseSizes = raw.databaseSizes.map((r, i) =>
        i === 0
          ? {
              ...r,
              size_bytes: String(num(r.size_bytes) + this.ticks * 65_536),
            }
          : r,
      );
      raw.databaseSizesAt = at;
    }
    for (const s of raw.replicationPrimary ?? []) {
      if (s.replay_lag_sec !== null)
        s.replay_lag_sec = Math.max(0, s.replay_lag_sec * (1 + jitter(0.25)));
    }
    const r = normalizePgHealth(raw, {
      prev: this.prev,
      expectedStandbys: this.expectedStandbys,
    });
    this.prev = r.next;
    return r;
  }
}
