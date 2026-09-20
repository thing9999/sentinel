/**
 * 모니터링 대상 Postgres 조회 (읽기 전용, DBA 쿼리 그대로).
 * docs/reports/cluster-status/dba.md 9절의 수집 루프를 따른다:
 *  - 한 커넥션에서 순서대로, 쿼리마다 READ ONLY 트랜잭션 + SET LOCAL statement_timeout/lock_timeout
 *  - server_info 왕복 시간 = responseMs, 실패면 접속 불가
 *  - 개별 쿼리 실패는 raw.errors[id]에 가린 메시지로 넣고 계속
 */
import { Pool, type PoolClient } from 'pg';
import {
  PG_HEALTH_QUERIES,
  pgQueryParams,
  pgQueryTransaction,
  sanitizeErrorMessage,
  type PgActivitySummaryRow,
  type PgDatabaseSizeRow,
  type PgDatabaseStatRow,
  type PgHealthThresholds,
  type PgLockWaitRow,
  type PgQueryId,
  type PgRawSample,
  type PgReplicationPrimaryRow,
  type PgReplicationSlotRow,
  type PgReplicationStandbyRow,
  type PgServerInfoRow,
  type PgSessionRow,
} from '../database/health';

export class PgCollectError extends Error {
  constructor(
    readonly cause: unknown,
    readonly timedOut: boolean,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

async function runQuery<T>(
  client: PoolClient,
  id: PgQueryId,
  thresholds: Partial<PgHealthThresholds>,
): Promise<T[]> {
  const q = PG_HEALTH_QUERIES[id];
  const tx = pgQueryTransaction(q.timeoutMs);
  try {
    for (const s of tx.before) await client.query(s);
    const res = await client.query(q.sql, pgQueryParams(id, thresholds));
    await client.query(tx.after);
    return res.rows as T[];
  } catch (err) {
    await client.query(tx.onError).catch(() => undefined);
    throw err;
  }
}

function isTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|timed out/i.test(msg);
}

export interface CollectOptions {
  thresholds: Partial<PgHealthThresholds>;
  /** 이번 주기에 database_sizes를 돌릴지 (5분마다) */
  withSizes: boolean;
  /** 이번 주기에 replication_slots를 돌릴지 (60초마다) */
  withSlots: boolean;
}

export async function collectPg(
  pool: Pool,
  opts: CollectOptions,
): Promise<PgRawSample> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw new PgCollectError(err, isTimeout(err));
  }
  const errors: Partial<Record<PgQueryId, string>> = {};
  try {
    let serverInfo: PgServerInfoRow;
    let responseMs: number;
    try {
      const t0 = performance.now();
      const rows = await runQuery<PgServerInfoRow>(
        client,
        'server_info',
        opts.thresholds,
      );
      responseMs = performance.now() - t0;
      if (!rows[0]) throw new Error('server_info returned no rows');
      serverInfo = rows[0];
    } catch (err) {
      throw new PgCollectError(err, isTimeout(err));
    }
    const raw: PgRawSample = { responseMs, serverInfo };
    const attempt = async <T>(id: PgQueryId): Promise<T[] | undefined> => {
      try {
        return await runQuery<T>(client, id, opts.thresholds);
      } catch (err) {
        errors[id] = sanitizeErrorMessage(err);
        return undefined;
      }
    };
    raw.activity = (
      await attempt<PgActivitySummaryRow>('activity_summary')
    )?.[0];
    raw.sessions = await attempt<PgSessionRow>('sessions_top');
    raw.lockWaits = await attempt<PgLockWaitRow>('lock_waits');
    raw.databaseStats = await attempt<PgDatabaseStatRow>('database_stats');
    if (opts.withSizes) {
      raw.databaseSizes = await attempt<PgDatabaseSizeRow>('database_sizes');
      if (raw.databaseSizes) raw.databaseSizesAt = new Date();
    }
    if (!serverInfo.in_recovery) {
      raw.replicationPrimary = await attempt<PgReplicationPrimaryRow>(
        'replication_primary',
      );
      if (opts.withSlots)
        raw.replicationSlots =
          await attempt<PgReplicationSlotRow>('replication_slots');
    } else {
      raw.replicationStandby = (
        await attempt<PgReplicationStandbyRow>('replication_standby')
      )?.[0];
    }
    if (Object.keys(errors).length > 0) raw.errors = errors;
    return raw;
  } finally {
    client.release();
  }
}
