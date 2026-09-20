import {
  buildPgFixtureSnapshot,
  buildPgUnreachableFixture,
  PG_HEALTH_FIXTURES,
} from './fixtures';
import {
  normalizePgHealth,
  approxPvcUsagePct,
  pgQueryParams,
} from './normalize';
import { PG_HEALTH_QUERIES, type PgQueryId } from './queries';
import type { PgRawSample } from './types';

function checkOf(
  snapshot: ReturnType<typeof buildPgFixtureSnapshot>['snapshot'],
  id: string,
) {
  const c = snapshot.checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} 없음`);
  return c;
}

describe('normalizePgHealth - 픽스처', () => {
  it.each(['ok', 'warning', 'critical'] as const)(
    '%s 픽스처의 전체 상태가 기대값과 같다',
    (name) => {
      const { snapshot } = buildPgFixtureSnapshot(name);
      expect(snapshot.overall).toBe(PG_HEALTH_FIXTURES[name].expectedOverall);
      expect(snapshot.reachable).toBe(true);
    },
  );

  it('정상: 모든 판단이 ok이고 처리량이 계산된다', () => {
    const { snapshot } = buildPgFixtureSnapshot('ok');
    for (const c of snapshot.checks) expect(c.level).toBe('ok');
    expect(snapshot.throughput).not.toBeNull();
    expect(snapshot.throughput?.commitsPerSec).toBeGreaterThan(0);
    expect(snapshot.throughput?.cacheHitPct).toBeGreaterThanOrEqual(95);
    expect(snapshot.sizes?.approxDataDirBytes).toBeGreaterThan(0);
  });

  it('주의: 연결 82%, 캐시 93%, 데드락 +1', () => {
    const { snapshot } = buildPgFixtureSnapshot('warning');
    expect(checkOf(snapshot, 'reachability').level).toBe('warning');
    expect(checkOf(snapshot, 'connection_usage').level).toBe('warning');
    expect(checkOf(snapshot, 'connection_usage').sustained).toBe(true);
    expect(checkOf(snapshot, 'long_running_queries').level).toBe('warning');
    expect(checkOf(snapshot, 'idle_in_transaction').level).toBe('warning');
    expect(checkOf(snapshot, 'lock_waits').level).toBe('warning');
    expect(checkOf(snapshot, 'cache_hit_ratio').level).toBe('warning');
    expect(checkOf(snapshot, 'deadlocks').reason).toBe(
      '데드락 +1 (직전 조회 대비)',
    );
    expect(checkOf(snapshot, 'xid_age').level).toBe('warning');
    expect(checkOf(snapshot, 'replication_lag').level).toBe('warning');
  });

  it('장애: 판단 이유가 명세 수용 기준 문구와 같다', () => {
    const { snapshot } = buildPgFixtureSnapshot('critical');
    const conn = checkOf(snapshot, 'connection_usage');
    expect(conn.level).toBe('critical');
    expect(conn.reason).toBe('연결 92% (max 100)');
    expect(checkOf(snapshot, 'long_running_queries').level).toBe('critical');
    expect(checkOf(snapshot, 'lock_waits').level).toBe('critical');
    expect(checkOf(snapshot, 'cache_hit_ratio').level).toBe('critical');
    expect(checkOf(snapshot, 'xid_age').level).toBe('critical');
    expect(checkOf(snapshot, 'replication_lag').level).toBe('critical');
  });

  it('세션 목록에 쿼리 원문·클라이언트 주소 필드가 없다', () => {
    const { snapshot } = buildPgFixtureSnapshot('warning');
    const json = JSON.stringify(snapshot);
    expect(json).not.toMatch(/"query"/);
    expect(json).not.toMatch(/client_addr|clientAddr/);
  });
});

describe('normalizePgHealth - 경계 동작', () => {
  const base = PG_HEALTH_FIXTURES.ok.current;

  it('첫 표본이면 캐시 적중률·데드락은 판단 보류(held)', () => {
    const { snapshot } = normalizePgHealth(base);
    expect(snapshot.throughput).toBeNull();
    expect(checkOf(snapshot, 'cache_hit_ratio').held).toBe(true);
    expect(checkOf(snapshot, 'deadlocks').held).toBe(true);
  });

  it('블록 표본이 1000 미만이면 이전 상태를 유지한다', () => {
    const prev = normalizePgHealth(PG_HEALTH_FIXTURES.critical.previous);
    const crit = normalizePgHealth(PG_HEALTH_FIXTURES.critical.current, {
      prev: prev.next,
    });
    expect(checkOf(crit.snapshot, 'cache_hit_ratio').level).toBe('critical');
    // 같은 카운터를 15초 뒤에 다시 받음 → 블록 증가 0
    const same: PgRawSample = {
      ...PG_HEALTH_FIXTURES.critical.current,
      serverInfo: {
        ...PG_HEALTH_FIXTURES.critical.current.serverInfo,
        server_now: '2026-09-19T01:00:30.000Z',
      },
    };
    const held = normalizePgHealth(same, { prev: crit.next });
    const c = checkOf(held.snapshot, 'cache_hit_ratio');
    expect(c.held).toBe(true);
    expect(c.level).toBe('critical');
  });

  it('통계 리셋이 감지되면 차이를 계산하지 않는다', () => {
    const first = normalizePgHealth(PG_HEALTH_FIXTURES.ok.previous);
    const reset: PgRawSample = {
      ...base,
      databaseStats: base.databaseStats?.map((r) => ({
        ...r,
        stats_reset: '2026-09-19T01:00:10.000Z',
      })),
    };
    const { snapshot } = normalizePgHealth(reset, { prev: first.next });
    expect(snapshot.throughput).toBeNull();
    expect(checkOf(snapshot, 'cache_hit_ratio').reason).toContain('리셋');
  });

  it('standby가 없고 기대값도 없으면 복제는 해당 없음', () => {
    const { snapshot } = normalizePgHealth({
      ...base,
      replicationPrimary: [],
      replicationSlots: [],
    });
    const c = checkOf(snapshot, 'replication_lag');
    expect(c.applicable).toBe(false);
    expect(c.level).toBe('ok');
  });

  it('쿼리 하나가 실패하면 해당 판단만 unknown', () => {
    const { snapshot } = normalizePgHealth({
      ...base,
      lockWaits: undefined,
      errors: {
        lock_waits: '[57014] canceling statement due to statement timeout',
      },
    });
    const c = checkOf(snapshot, 'lock_waits');
    expect(c.level).toBe('unknown');
    expect(c.reason).toContain('57014');
    expect(checkOf(snapshot, 'connection_usage').level).toBe('ok');
    expect(snapshot.overall).toBe('unknown');
  });

  it('standby 접속 시 따라잡았으면 지연 0', () => {
    const { snapshot } = normalizePgHealth({
      ...base,
      serverInfo: { ...base.serverInfo, in_recovery: true },
      replicationPrimary: undefined,
      replicationSlots: undefined,
      replicationStandby: {
        in_recovery: true,
        replay_delay_sec: 3600,
        receive_replay_gap_bytes: '0',
        caught_up: true,
        wal_receiver_status: 'streaming',
      },
    });
    const c = checkOf(snapshot, 'replication_lag');
    expect(c.level).toBe('ok');
    expect(c.value).toBe(0);
  });

  it('크기를 이번 주기에 조회하지 않았으면 이전 값을 유지한다', () => {
    const first = normalizePgHealth(base);
    const { snapshot } = normalizePgHealth(
      { ...base, databaseSizes: undefined },
      { prev: first.next },
    );
    expect(snapshot.sizes).toEqual(first.snapshot.sizes);
  });
});

describe('pgUnreachableSnapshot', () => {
  it('접속 실패는 장애, 나머지는 unknown, 비밀번호는 가려진다', () => {
    const { snapshot } = buildPgUnreachableFixture();
    expect(snapshot.overall).toBe('critical');
    expect(snapshot.reachable).toBe(false);
    expect(snapshot.checks[0].level).toBe('critical');
    expect(snapshot.checks.slice(1).every((c) => c.level === 'unknown')).toBe(
      true,
    );
    expect(snapshot.error).toContain('[28P01]');
    expect(JSON.stringify(snapshot)).not.toContain('s3cret');
  });
});

describe('approxPvcUsagePct', () => {
  it('DB 합계 + WAL / PVC 용량', () => {
    const { snapshot } = buildPgFixtureSnapshot('ok');
    const pct = approxPvcUsagePct(snapshot.sizes, 50 * 1024 ** 3);
    expect(pct).toBeGreaterThan(30);
    expect(pct).toBeLessThan(40);
    expect(approxPvcUsagePct(snapshot.sizes, null)).toBeNull();
  });
});

describe('pgQueryParams', () => {
  it('activity_summary는 오래 실행/idle in tx 기준을 각각 넘긴다', () => {
    expect(pgQueryParams('activity_summary', { idleInTxWarnSec: 120 })).toEqual(
      [300, 1800, 120, 1800],
    );
    expect(pgQueryParams('lock_waits')).toEqual([60]);
    expect(pgQueryParams('server_info')).toEqual([]);
  });

  it('SQL의 위치 파라미터 수와 헬퍼 결과 길이가 같다', () => {
    for (const id of Object.keys(PG_HEALTH_QUERIES) as PgQueryId[]) {
      const matches = PG_HEALTH_QUERIES[id].sql.match(/\$(\d+)/g) ?? [];
      const maxIndex = Math.max(0, ...matches.map((m) => Number(m.slice(1))));
      expect(pgQueryParams(id)).toHaveLength(maxIndex);
      expect(PG_HEALTH_QUERIES[id].params).toHaveLength(maxIndex);
    }
  });
});
