import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Observable, Subject } from 'rxjs';
import { DATA_SOURCE_MODE } from '../common/data-source';
import {
  MockScenarioTargetProvider,
  type MockScenarioTarget,
} from '../common/extension-points';
import { SettingsService } from '../common/settings.service';
import { SourceRegistry } from '../common/source-registry.service';
import {
  reason,
  StatusChangeTracker,
  statusFromReasons,
  SustainTracker,
  worstStatus,
  type Reason,
  type Status,
  type StatusInfo,
} from '../common/status';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import { ClusterStateService } from '../cluster/state/cluster-state.service';
import type {
  AttentionItem,
  DbAreaProvider,
  DbAreaSummary,
  DbK8sView,
  PodItem,
  PvcItem,
  WorkloadItem,
} from '../cluster/types';
import {
  DEFAULT_PG_THRESHOLDS,
  PG_CHECK_ORDER,
  PG_MONITOR_CONNECTION_DEFAULTS,
  normalizePgHealth,
  pgUnreachableSnapshot,
  sanitizeErrorMessage,
  type HealthCheckResult,
  type PgCheckId,
  type PgHealthSnapshot,
  type PgHealthThresholds,
  type PgPreviousState,
  type PgReplicationSlotRow,
} from '../database/health';
import { DB_SCENARIOS, MockPgSimulator, type DbScenario } from './db-mock';
import { collectPg, PgCollectError } from './pg-collector';

const CHECK_CODE: Record<PgCheckId, string> = {
  reachability: 'DB_UNREACHABLE',
  connection_usage: 'DB_CONNECTION_USAGE',
  long_running_queries: 'DB_LONG_RUNNING_QUERIES',
  idle_in_transaction: 'DB_IDLE_IN_TRANSACTION',
  lock_waits: 'DB_LOCK_WAITS',
  cache_hit_ratio: 'DB_CACHE_HIT',
  deadlocks: 'DB_DEADLOCKS',
  xid_age: 'DB_XID_AGE',
  replication_lag: 'DB_REPLICATION_LAG',
};

const CHECK_LABEL: Record<PgCheckId, string> = {
  reachability: '응답',
  connection_usage: '연결',
  long_running_queries: '오래 실행 쿼리',
  idle_in_transaction: 'idle in transaction',
  lock_waits: '잠금 대기',
  cache_hit_ratio: '캐시 적중률',
  deadlocks: '데드락',
  xid_age: '트랜잭션 ID 나이',
  replication_lag: '복제 지연',
};

function checkCode(c: HealthCheckResult<PgCheckId>): string {
  if (c.id === 'reachability' && c.level === 'warning')
    return 'DB_SLOW_RESPONSE';
  if (c.id === 'replication_lag' && !c.applicable)
    return 'DB_REPLICATION_NOT_APPLICABLE';
  return CHECK_CODE[c.id];
}

function checkThresholds(
  id: PgCheckId,
  t: PgHealthThresholds,
): { warn: number; crit: number | null } {
  switch (id) {
    case 'reachability':
      return { warn: t.responseWarnMs, crit: null };
    case 'connection_usage':
      return { warn: t.connectionUsageWarnPct, crit: t.connectionUsageCritPct };
    case 'long_running_queries':
      return { warn: t.longQueryWarnSec, crit: t.longQueryCritSec };
    case 'idle_in_transaction':
      return { warn: t.idleInTxWarnSec, crit: t.idleInTxCritSec };
    case 'lock_waits':
      return { warn: t.lockWaitWarnCount, crit: t.lockWaitCritCount };
    case 'cache_hit_ratio':
      return { warn: t.cacheHitWarnPct, crit: t.cacheHitCritPct };
    case 'deadlocks':
      return { warn: t.deadlockWarnDelta, crit: null };
    case 'xid_age':
      return { warn: t.xidAgeWarn, crit: t.xidAgeCrit };
    case 'replication_lag':
      return { warn: t.replicationLagWarnSec, crit: t.replicationLagCritSec };
  }
}

export interface DbCheckView {
  id: PgCheckId;
  status: StatusInfo;
  value: number | null;
  unit: string | null;
  applicable: boolean;
  held: boolean;
  sustained: boolean;
  thresholds: { warn: number; crit: number | null };
}

export type DbHealthView = Omit<PgHealthSnapshot, 'checks' | 'overall'> & {
  intervalSec: number;
  checks: DbCheckView[];
};

export interface DbDetail {
  dataSource: DataSourceMode;
  generatedAt: string;
  configured: boolean;
  target: { namespace: string; statefulSet: string; vendor: 'postgres' } | null;
  status: StatusInfo;
  kubernetes: {
    status: StatusInfo;
    statefulSet: WorkloadItem | null;
    pods: PodItem[];
    pvcs: PvcItem[];
  } | null;
  health: DbHealthView | null;
  pvcUsage: {
    pct: number;
    usedBytes: number;
    capacityBytes: number | null;
    source: 'prometheus' | 'db_size_approx';
  } | null;
}

/**
 * 모니터링 대상 DB 상태 (docs/api/cluster-status.md 7.4).
 * - live: DBA 쿼리를 `DB_HEALTH_INTERVAL_SEC`(기본 15초)마다 실행 (이전 주기 진행 중이면 건너뜀)
 * - mock: DBA 픽스처를 흔들어 같은 정규화 함수에 통과
 * - 사용률 지표(sustained)는 연속 3회 조건 적용, 45초 넘게 수집이 없으면 stale
 * - 쿠버네티스 쪽(StatefulSet·파드·PVC)은 ClusterStateService 캐시에서 결합
 */
@Injectable()
@MockScenarioTargetProvider()
export class DbHealthService
  implements
    DbAreaProvider,
    MockScenarioTarget,
    OnApplicationBootstrap,
    OnModuleDestroy
{
  readonly group = 'db' as const;
  readonly scenarios: readonly string[] = DB_SCENARIOS;
  private readonly logger = new Logger(DbHealthService.name);
  private scenario: DbScenario = 'warning';
  private sim: MockPgSimulator | null = null;

  private snapshot: PgHealthSnapshot | null = null;
  private prev: PgPreviousState | null = null;
  private lastSuccessAt: number | null = null;
  private lastCollectAt: number | null = null;
  private lastSizesAt = 0;
  private lastSlotsAt = 0;
  private lastSlots: PgReplicationSlotRow[] | undefined;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private pool: Pool | null = null;
  private readonly sustain = new SustainTracker(3);
  private readonly tracker = new StatusChangeTracker();
  private effective = new Map<PgCheckId, Status>();
  /** 최근 1시간 연결 사용률 (어드바이저 maxObservedPct) */
  private connSamples: { at: number; pct: number }[] = [];

  private readonly changesSubject = new Subject<void>();
  readonly changes$: Observable<void> = this.changesSubject.asObservable();

  readonly intervalSec: number;
  private readonly monitorUrl: string | null;
  private readonly targetCfg: { namespace: string; statefulSet: string } | null;
  private readonly expectedStandbysEnv: number | null;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly cluster: ClusterStateService,
    private readonly registry: SourceRegistry,
    private readonly settings: SettingsService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.intervalSec = config.get('DB_HEALTH_INTERVAL_SEC', { infer: true });
    this.monitorUrl = config.get('MONITOR_DB_URL', { infer: true }) ?? null;
    const ns = config.get('DB_TARGET_NAMESPACE', { infer: true });
    const sts = config.get('DB_TARGET_STATEFULSET', { infer: true });
    this.targetCfg = ns && sts ? { namespace: ns, statefulSet: sts } : null;
    this.expectedStandbysEnv =
      config.get('MONITOR_DB_EXPECTED_STANDBYS', { infer: true }) ?? null;
  }

  // --- 수명 ---------------------------------------------------------------------

  onApplicationBootstrap(): void {
    this.cluster.registerDbAreaProvider(this);
    this.registry.update('monitoredDb', { intervalSec: this.intervalSec });
    if (this.mode === 'mock') {
      this.startMock(this.scenario);
    } else if (this.isConfigured()) {
      this.pool = new Pool({
        connectionString: this.monitorUrl!,
        ...PG_MONITOR_CONNECTION_DEFAULTS,
      });
      this.pool.on('error', (err) =>
        this.logger.warn(`모니터링 DB 풀 오류: ${sanitizeErrorMessage(err)}`),
      );
      this.registry.update('monitoredDb', { state: 'syncing' });
      void this.collectLive();
    } else {
      this.registry.update('monitoredDb', { state: 'not_configured' });
    }
    this.timer = setInterval(() => void this.tick(), this.intervalSec * 1000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool?.end().catch(() => undefined);
  }

  private isConfigured(): boolean {
    if (this.mode === 'mock') return this.scenario !== 'not-configured';
    return Boolean(this.monitorUrl && this.targetCfg);
  }

  private async tick(): Promise<void> {
    if (this.mode === 'mock') this.collectMock(Date.now());
    else if (this.pool) await this.collectLive();
    this.checkStale();
  }

  // --- mock ---------------------------------------------------------------------

  currentScenario(): string {
    return this.scenario;
  }

  setScenario(name: string): void {
    if (!(DB_SCENARIOS as readonly string[]).includes(name))
      throw new Error(`unknown db scenario: ${name}`);
    this.scenario = name as DbScenario;
    if (this.mode === 'mock') {
      this.startMock(this.scenario);
      this.changesSubject.next();
      this.cluster.schedule();
    }
  }

  private startMock(s: DbScenario): void {
    this.snapshot = null;
    this.prev = null;
    this.lastSuccessAt = null;
    this.effective.clear();
    this.sustain.clear();
    this.tracker.clear();
    this.connSamples = [];
    if (s === 'not-configured') {
      this.sim = null;
      this.registry.update('monitoredDb', {
        state: 'not_configured',
        error: null,
        lastSuccessAt: null,
      });
      return;
    }
    this.sim = new MockPgSimulator(s);
    this.registry.update('monitoredDb', { state: 'mock', error: null });
    // 지속 조건(연속 3회)·카운터 차이가 바로 보이도록 과거 표본 3개
    const now = Date.now();
    const step = this.intervalSec * 1000;
    for (let i = 3; i >= 0; i--) this.collectMock(now - i * step, true);
    if (s === 'stale') {
      // 마지막 수집을 오래전으로 → 곧바로 오래됨
      this.lastSuccessAt = now - 50_000;
      this.checkStale();
    }
  }

  private collectMock(at: number, force = false): void {
    if (!this.sim) return;
    if (this.scenario === 'stale' && !force) return; // 수집 중단 재현
    const r = this.sim.next(at);
    this.accept(r.snapshot, r.next, at);
    if (this.scenario !== 'stale')
      this.registry.update('monitoredDb', {
        state: 'mock',
        error: null,
        lastSuccessAt: new Date(at).toISOString(),
        lastAttemptAt: new Date(at).toISOString(),
      });
  }

  // --- live ---------------------------------------------------------------------

  private async thresholds(): Promise<PgHealthThresholds> {
    const v = await this.settings.get('db.thresholds');
    return { ...DEFAULT_PG_THRESHOLDS, ...v };
  }

  private expectedStandbys(): number | undefined {
    if (this.mode === 'mock') return this.sim?.expectedStandbys;
    if (this.expectedStandbysEnv !== null) return this.expectedStandbysEnv;
    const t = this.targetCfg;
    if (!t) return undefined;
    const sts = this.cluster
      .getView()
      .workloadMap.get(`StatefulSet/${t.namespace}/${t.statefulSet}`);
    const desired = sts?.replicas.desired;
    return desired !== null && desired !== undefined
      ? Math.max(0, desired - 1)
      : undefined;
  }

  private async collectLive(): Promise<void> {
    if (!this.pool || this.running) return;
    this.running = true;
    const now = Date.now();
    this.lastCollectAt = now;
    const t = await this.thresholds();
    const withSizes = now - this.lastSizesAt >= 300_000;
    const withSlots = now - this.lastSlotsAt >= 60_000;
    try {
      const raw = await collectPg(this.pool, {
        thresholds: t,
        withSizes,
        withSlots,
      });
      if (withSizes && raw.databaseSizes) this.lastSizesAt = now;
      if (withSlots && raw.replicationSlots) {
        this.lastSlotsAt = now;
        this.lastSlots = raw.replicationSlots;
      } else if (!raw.serverInfo.in_recovery && this.lastSlots) {
        raw.replicationSlots = this.lastSlots;
      }
      const r = normalizePgHealth(raw, {
        prev: this.prev,
        thresholds: t,
        expectedStandbys: this.expectedStandbys(),
      });
      this.accept(r.snapshot, r.next, now);
      this.registry.markSuccess('monitoredDb', new Date(now).toISOString());
    } catch (err) {
      const timedOut = err instanceof PgCollectError ? err.timedOut : false;
      const cause = err instanceof PgCollectError ? err.cause : err;
      const r = pgUnreachableSnapshot(cause, {
        collectedAt: new Date(now),
        prev: this.prev,
        timedOut,
        thresholds: t,
      });
      this.accept(r.snapshot, r.next, now);
      this.registry.markFailure(
        'monitoredDb',
        {
          code: timedOut ? 'DB_TIMEOUT' : 'DB_UNREACHABLE',
          message: r.snapshot.error ?? '접속 실패',
        },
        { state: 'unavailable', at: new Date(now).toISOString() },
      );
    } finally {
      this.running = false;
    }
  }

  // --- 공통 ---------------------------------------------------------------------

  /** 새 스냅샷 반영: 지속 조건 적용 */
  private accept(s: PgHealthSnapshot, next: PgPreviousState, at: number): void {
    this.prev = next;
    this.snapshot = s;
    this.lastSuccessAt = at;
    const samples = this.cluster.thresholds().sustainSamples;
    this.sustain.setSamples(samples);
    for (const c of s.checks) {
      let level: Status = c.level;
      if (c.sustained && !c.held)
        level = this.sustain.apply(`db:${c.id}`, c.level);
      else if (c.held) level = this.effective.get(c.id) ?? c.level;
      this.effective.set(c.id, level);
    }
    if (s.connections) {
      this.connSamples.push({ at, pct: s.connections.usagePct });
      this.connSamples = this.connSamples.filter((x) => x.at >= at - 3_600_000);
    }
    this.changesSubject.next();
    this.cluster.schedule();
  }

  private checkStale(): void {
    if (this.lastSuccessAt === null) return;
    const src = this.registry.get('monitoredDb');
    if (src.state === 'not_configured') return;
    if (Date.now() - this.lastSuccessAt > this.intervalSec * 3000) {
      if (src.state !== 'stale') {
        this.registry.update('monitoredDb', {
          state: 'stale',
          error: {
            code: 'DB_COLLECTION_STALE',
            message: `DB 상태 수집이 ${this.intervalSec * 3}초 넘게 없습니다`,
          },
        });
        this.changesSubject.next();
        this.cluster.schedule();
      }
    }
  }

  private isStale(): boolean {
    return this.registry.get('monitoredDb').state === 'stale';
  }

  // --- DbAreaProvider ---------------------------------------------------------------

  target(): { namespace: string; statefulSet: string } | null {
    if (this.mode === 'mock')
      return this.scenario === 'not-configured'
        ? null
        : { namespace: 'data', statefulSet: 'postgres' };
    return this.isConfigured() ? this.targetCfg : null;
  }

  approxDataDir(): { bytes: number; measuredAt: string } | null {
    const s = this.snapshot?.sizes;
    return s ? { bytes: s.approxDataDirBytes, measuredAt: s.measuredAt } : null;
  }

  areaSummary(k8s: DbK8sView): DbAreaSummary {
    const d = this.detailCore(k8s);
    let headline: DbAreaSummary['headline'] = null;
    const checks = d.health?.checks ?? [];
    const bad = checks
      .filter(
        (c) =>
          c.applicable &&
          (c.status.status === 'critical' || c.status.status === 'warning'),
      )
      .sort(
        (a, b) =>
          (a.status.status === 'critical' ? -1 : 0) -
          (b.status.status === 'critical' ? -1 : 0),
      )[0];
    const pick = bad ?? checks.find((c) => c.id === 'connection_usage');
    if (pick)
      headline = {
        label: CHECK_LABEL[pick.id],
        value: pick.value,
        unit: pick.unit ?? 'count',
      };
    const attention: AttentionItem[] = [];
    const t = d.target;
    if (t) {
      const ref = {
        kind: 'StatefulSet',
        namespace: t.namespace,
        name: t.statefulSet,
      };
      for (const r of d.status.reasons) {
        if (r.status !== 'critical' && r.status !== 'warning') continue;
        attention.push({
          area: 'db',
          ref,
          status: r.status,
          reason: r,
          statusChangedAt: d.status.statusChangedAt,
        });
      }
    }
    return { status: d.status, configured: d.configured, headline, attention };
  }

  // --- 상세 ---------------------------------------------------------------------

  detail(): DbDetail {
    return this.detailCore(this.cluster.getView());
  }

  private detailCore(view: DbK8sView): DbDetail {
    const generatedAt = view.atIso;
    const target = this.target();
    if (!target || !this.isConfigured()) {
      return {
        dataSource: this.mode,
        generatedAt,
        configured: false,
        target: null,
        status: {
          status: 'unknown',
          reasons: [
            reason(
              'DB_NOT_CONFIGURED',
              '모니터링할 DB가 설정되지 않았습니다',
              'unknown',
            ),
          ],
          updatedAt: null,
          statusChangedAt: this.tracker.track('db', 'unknown', generatedAt),
          stale: false,
        },
        kubernetes: null,
        health: null,
        pvcUsage: null,
      };
    }

    // 쿠버네티스 쪽
    const stsKey = `StatefulSet/${target.namespace}/${target.statefulSet}`;
    let sts = view.workloadMap.get(stsKey) ?? null;
    let pods = view.pods.filter(
      (p) => p.owner?.workloadKey === stsKey && !p.completed,
    );
    const pvcs = view.pvcs.filter((p) => p.isDbVolume);
    if (this.mode === 'mock' && this.scenario === 'no-pod') {
      pods = [];
      if (sts)
        sts = { ...sts, replicas: { ...sts.replicas, ready: 0, available: 0 } };
    }
    const kReasons: Reason[] = [];
    const desired = sts?.replicas.desired ?? 1;
    const readyPods = pods.filter(
      (p) => p.containers.ready === p.containers.total && p.phase === 'Running',
    ).length;
    const kubeSrc = this.registry.get('kube');
    const kubeUnknown =
      kubeSrc.state === 'not_configured' ||
      kubeSrc.state === 'unavailable' ||
      (kubeSrc.state === 'syncing' && sts === null);
    const noPod =
      !kubeUnknown &&
      (!sts ||
        pods.length === 0 ||
        (sts.replicas.ready === 0 && desired > 0) ||
        readyPods === 0);
    if (kubeUnknown) {
      kReasons.push(
        reason(
          kubeSrc.state === 'not_configured'
            ? 'SOURCE_NOT_CONFIGURED'
            : 'SOURCE_UNAVAILABLE',
          kubeSrc.state === 'not_configured'
            ? '클러스터 연결 없음'
            : '알 수 없음 (클러스터 조회 실패)',
          'unknown',
        ),
      );
    } else if (noPod) {
      kReasons.push(
        reason(
          'DB_POD_NOT_READY',
          pods.length === 0
            ? `DB 파드 없음 (ready 0/${desired})`
            : `DB 파드 준비 안 됨 (ready ${sts?.replicas.ready ?? 0}/${desired})`,
          'critical',
        ),
      );
    }
    if (sts && !noPod) {
      for (const r of sts.status.reasons)
        if (r.status !== 'ok') kReasons.push(r);
    }
    for (const p of pods)
      for (const r of p.status.reasons.slice(0, 1))
        if (r.status !== 'ok')
          kReasons.push({ ...r, text: `${p.name} ${r.text}` });
    for (const p of pvcs)
      for (const r of p.status.reasons.slice(0, 1))
        if (r.status !== 'ok')
          kReasons.push({ ...r, text: `PVC ${p.name} ${r.text}` });
    const kube = kubeSrc;
    const kubeStale = kube.state === 'stale';
    const kStatus = statusFromReasons(kReasons);
    const kubernetes = {
      status: {
        status: kStatus.status,
        reasons: kStatus.reasons,
        updatedAt: kubeStale ? kube.lastSuccessAt : generatedAt,
        statusChangedAt: this.tracker.track(
          'db:kubernetes',
          kStatus.status,
          generatedAt,
        ),
        stale: kubeStale,
      },
      statefulSet: sts,
      pods,
      pvcs,
    };

    // DB 내부
    const snap = this.snapshot;
    const stale = this.isStale();
    const t = {
      ...DEFAULT_PG_THRESHOLDS,
      ...this.settings.peek('db.thresholds'),
    };
    let health: DbHealthView | null = null;
    const hReasons: Reason[] = [];
    if (snap) {
      const updatedAt = snap.collectedAt;
      const checks: DbCheckView[] = PG_CHECK_ORDER.map((id) => {
        const c = snap.checks.find((x) => x.id === id)!;
        const st = this.effective.get(id) ?? c.level;
        const code = checkCode(c);
        const r = reason(code, c.reason, c.applicable ? st : 'ok');
        if (c.applicable && st !== 'ok') hReasons.push(r);
        return {
          id,
          status: {
            status: c.applicable ? st : 'ok',
            reasons: [r],
            updatedAt,
            statusChangedAt: this.tracker.track(
              `db:check:${id}`,
              st,
              generatedAt,
            ),
            stale,
          },
          value: c.value === null ? null : Math.round(c.value * 10) / 10,
          unit: c.unit,
          applicable: c.applicable,
          held: c.held,
          sustained: c.sustained,
          thresholds: checkThresholds(id, t),
        };
      });
      const { checks: _c, overall: _o, ...rest } = snap;
      void _c;
      void _o;
      health = { ...rest, intervalSec: this.intervalSec, checks };
    } else {
      hReasons.push(reason('SOURCE_SYNCING', '최초 수집 중', 'unknown'));
    }

    // 최상위: 파드가 없으면 파드 쪽이 대표 사유, 접속 실패는 뒤로
    let reasons: Reason[];
    if (noPod) {
      reasons = [...kReasons, ...hReasons];
    } else {
      reasons = statusFromReasons([...hReasons, ...kReasons]).reasons;
    }
    const top = worstStatus([kStatus.status, ...hReasons.map((r) => r.status)]);
    const status: StatusInfo = {
      status: top,
      reasons,
      updatedAt: snap?.collectedAt ?? null,
      statusChangedAt: this.tracker.track('db', top, generatedAt),
      stale,
    };

    // PVC 사용률 (대표: 첫 번째 DB PVC)
    const primaryPvc = pvcs.find((p) => p.usage) ?? null;
    const pvcUsage = primaryPvc?.usage
      ? {
          pct: primaryPvc.usage.pct,
          usedBytes: primaryPvc.usage.usedBytes,
          capacityBytes: primaryPvc.capacityBytes,
          source: primaryPvc.usage.source,
        }
      : null;

    return {
      dataSource: this.mode,
      generatedAt,
      configured: true,
      target: { ...target, vendor: 'postgres' },
      status,
      kubernetes,
      health,
      pvcUsage,
    };
  }

  // --- 어드바이저용 ---------------------------------------------------------------

  maxObservedConnectionPct(): number | null {
    if (this.connSamples.length === 0) return null;
    return Math.max(...this.connSamples.map((s) => s.pct));
  }

  currentSnapshot(): PgHealthSnapshot | null {
    return this.snapshot;
  }
}
