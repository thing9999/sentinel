import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdvisorEvents } from '../advisor-events';
import { AdvisorSettingsService } from '../advisor-settings.service';
import type {
  FailureReason,
  Run,
  RunStatus,
  RunSummary,
} from '../advisor.types';
import { ApiError, notFound } from '../api-error';
import { AdvisorBridgeService } from '../bridge/advisor-bridge.service';
import {
  BridgeHttpError,
  BridgeUnreachableError,
  type BridgeLine,
  type BridgeResultLine,
} from '../bridge/bridge-client';
import {
  AdvisorScenarioState,
  type AdvisorScenario,
} from '../mock/advisor-scenario.state';
import {
  EXAMPLE_INVALID_RAW,
  exampleLlmOutput,
  mockClusterContribution,
  mockCostContribution,
  mockDbSection,
} from '../mock/mock-fixtures';
import { AdvisorPrecheckService } from '../precheck/advisor-precheck.service';
import { finalizeResult } from '../result/finalize-result';
import { AdvisorSnapshotService } from '../snapshot/advisor-snapshot.service';
import type { SnapshotSections } from '../snapshot/snapshot.types';
import {
  buildAdvisorSnapshot,
  type BuiltSnapshot,
} from '../snapshot/snapshot-builder';
import { AdvisorRunRepository } from './advisor-run.repository';
import {
  failureMessage,
  mapBridgeErrorCode,
  mapBridgeHttpStatus,
  mapResultSubtype,
  type MappedFailure,
} from './failure';
import {
  closeStages,
  computeFreshness,
  enterStage,
  isActiveStatus,
  newRunRecord,
  toRun,
  toRunSummary,
  type RunRecord,
} from './run-model';

export const PROMPT_VERSION = 'advisor-v1';
const PROGRESS_EVERY_MS = 5_000;
const RECEIVING_THROTTLE_MS = 1_000;
const FAST_TIMERS = { slowAfterSec: 10, timeoutSec: 20 };

interface ActiveRun {
  record: RunRecord;
  mode: 'live' | 'example';
  scenario: AdvisorScenario | null;
  abort: AbortController;
  timers: NodeJS.Timeout[];
  cancelRequested: boolean;
  timedOut: boolean;
  lastProgressAt: number;
  delayedEmitted: boolean;
  resultLine: BridgeResultLine | null;
  errorLine: Extract<BridgeLine, { type: 'error' }> | null;
  simStartedAt: number;
  simReceivingEndAt: number | null;
  finishing: boolean;
}

/**
 * 분석 실행: 동시 1건, 진행 SSE, 취소, 시간 제한, 결과 정리·저장 (계약 A.6·A.7, B.3.3·B.6)
 */
@Injectable()
export class AdvisorRunService
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AdvisorRunService.name);
  private active: ActiveRun | null = null;
  private ticker: NodeJS.Timeout | undefined;

  constructor(
    private readonly repo: AdvisorRunRepository,
    private readonly bridge: AdvisorBridgeService,
    private readonly snapshots: AdvisorSnapshotService,
    private readonly prechecks: AdvisorPrecheckService,
    private readonly settings: AdvisorSettingsService,
    private readonly events: AdvisorEvents,
    private readonly scenario: AdvisorScenarioState,
  ) {}

  onModuleInit(): void {
    this.bridge.runActive = () => this.active !== null;
    this.ticker = setInterval(() => this.tick(), 1_000);
    this.ticker.unref?.();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.settings.dataSource !== 'mock') return;
    // 예시 이력은 현재 mock 섹션(A·B 제공자 또는 내장 mock)으로 만든다 → 결과 신선도 비교가 맞게
    let sections: SnapshotSections | undefined;
    try {
      sections = (await this.snapshots.collect()).sections;
    } catch {
      sections = undefined;
    }
    this.seedMockHistory(sections);
  }

  onModuleDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.active) {
      this.active.abort.abort();
      for (const t of this.active.timers) clearTimeout(t);
    }
  }

  /** await 뒤에 다시 읽기 위한 도우미 (TS 흐름 분석이 this.active를 좁히지 않게) */
  private currentActive(): ActiveRun | null {
    return this.active;
  }

  get hasActiveRun(): boolean {
    return this.active !== null;
  }

  activeRun(now = new Date()): Run | null {
    return this.active
      ? toRun(this.active.record, now, { includeSuggestions: false })
      : null;
  }

  // -------------------------------------------------------------------------
  // 시작
  // -------------------------------------------------------------------------

  async start(includeSystem: boolean): Promise<{ created: boolean; run: Run }> {
    if (this.active)
      return {
        created: false,
        run: toRun(this.active.record, new Date(), {
          includeSuggestions: false,
        }),
      };

    const bridge = this.bridge.callsBridge
      ? await this.bridge.checkBeforeRun()
      : this.bridge.status();
    const raced = this.currentActive();
    if (raced)
      return {
        created: false,
        run: toRun(raced.record, new Date(), { includeSuggestions: false }),
      };
    if (!bridge.canRun) {
      throw new ApiError(
        409,
        'BRIDGE_NOT_READY',
        '브리지가 분석을 실행할 수 있는 상태가 아닙니다.',
        { bridge },
      );
    }
    const mode: 'live' | 'example' = bridge.exampleMode ? 'example' : 'live';
    const s = await this.settings.get();
    const requestedAt = new Date();
    const { built, collected } = await this.snapshots.build(
      includeSystem,
      requestedAt,
    );
    if (!built) {
      throw new ApiError(
        503,
        'SNAPSHOT_UNAVAILABLE',
        '클러스터·비용 데이터가 없어 스냅샷을 만들 수 없습니다.',
        {
          sources: collected.origin,
        },
      );
    }
    const builtAt = new Date();
    const limits =
      mode === 'example' && this.scenario.fastTimers
        ? { ...FAST_TIMERS }
        : {
            slowAfterSec: s.limits.slowAfterSec,
            timeoutSec: s.limits.timeoutSec,
          };
    const record = newRunRecord({
      id: randomUUID(),
      now: requestedAt,
      dataSource: this.settings.dataSource,
      isExample: mode === 'example',
      limits,
    });
    attachSnapshot(record, built);

    if (mode === 'live') {
      // 스냅샷·사전 점검은 요청 처리 중에 이미 끝났다 (실제 소요 기록)
      record.status = 'running';
      record.startedAt = requestedAt;
      enterStage(record, 'snapshot', requestedAt);
      enterStage(record, 'precheck', builtAt);
      enterStage(record, 'request', new Date());
    } else {
      record.status = 'running';
      record.startedAt = requestedAt;
      enterStage(record, 'snapshot', requestedAt);
    }

    const created = await this.repo.createActive(record);
    if (!created.created) {
      const existing = created.existingId
        ? await this.repo.get(created.existingId)
        : null;
      if (existing)
        return {
          created: false,
          run: toRun(existing, new Date(), { includeSuggestions: false }),
        };
      throw new ApiError(409, 'RUN_ACTIVE', '다른 분석이 진행 중입니다.');
    }
    const other = this.currentActive();
    if (other) {
      // 동시에 들어온 다른 요청이 먼저 잡았다 (메모리 잠금에서 걸러지므로 정상적으로는 없음)
      return {
        created: false,
        run: toRun(other.record, new Date(), { includeSuggestions: false }),
      };
    }
    const ctx: ActiveRun = {
      record,
      mode,
      scenario:
        this.settings.dataSource === 'mock' ? this.scenario.scenario : null,
      abort: new AbortController(),
      timers: [],
      cancelRequested: false,
      timedOut: false,
      lastProgressAt: 0,
      delayedEmitted: false,
      resultLine: null,
      errorLine: null,
      simStartedAt: Date.now(),
      simReceivingEndAt: null,
      finishing: false,
    };
    this.active = ctx;
    this.prechecks.acceptBuilt(built, includeSystem);
    this.emitProgress(ctx, true);
    this.bridge.emitIfChanged();

    if (mode === 'live') void this.executeLive(ctx);
    else this.startExample(ctx);
    return {
      created: true,
      run: toRun(record, new Date(), { includeSuggestions: false }),
    };
  }

  // -------------------------------------------------------------------------
  // 실제 브리지
  // -------------------------------------------------------------------------

  private async executeLive(ctx: ActiveRun): Promise<void> {
    const r = ctx.record;
    const s = await this.settings.get();
    const timeoutMs = r.limits.timeoutSec * 1000;
    const elapsed = Date.now() - r.requestedAt.getTime();
    const apiTimer = setTimeout(
      () => {
        ctx.timedOut = true;
        void this.bridge.client.cancel(r.id);
        ctx.abort.abort();
      },
      Math.max(1_000, timeoutMs - elapsed + 10_000),
    );
    ctx.timers.push(apiTimer);

    let thrown: unknown = null;
    try {
      await this.bridge.client.advise(
        {
          runId: r.id,
          promptVersion: PROMPT_VERSION,
          snapshot: r.snapshot,
          limits: {
            timeoutMs: Math.max(1_000, timeoutMs - elapsed),
            maxTurns: s.limits.maxTurns,
            maxBudgetUsd: s.limits.maxBudgetUsd,
          },
        },
        {
          signal: ctx.abort.signal,
          onLine: (line) => this.onBridgeLine(ctx, line),
          connectTimeoutMs: s.limits.bridgeHealthTimeoutSec * 1000,
          idleTimeoutMs: 60_000,
        },
      );
    } catch (err) {
      thrown = err;
    } finally {
      clearTimeout(apiTimer);
    }
    await this.concludeLive(ctx, thrown, s.limits.maxBudgetUsd);
  }

  private onBridgeLine(ctx: ActiveRun, line: BridgeLine): void {
    const r = ctx.record;
    switch (line.type) {
      case 'init': {
        r.llm = { ...(r.llm ?? emptyLlm()), model: line.model };
        const extra = (line.tools ?? []).filter(
          (t) => t !== 'StructuredOutput',
        );
        if (extra.length > 0)
          this.logger.error(
            `브리지 세션에 도구가 활성화됨 (안전 설정 이상): ${extra.join(', ')}`,
          );
        break;
      }
      case 'progress': {
        const now = new Date();
        if (r.stage !== 'receiving' && r.stage !== 'finalizing')
          enterStage(r, 'receiving', now);
        r.receiving = {
          lastReceivedAt: line.lastReceivedAt,
          receivedChars: line.receivedChars,
        };
        if (Date.now() - ctx.lastProgressAt >= RECEIVING_THROTTLE_MS)
          this.emitProgress(ctx);
        break;
      }
      case 'result':
        ctx.resultLine = line;
        if (line.permissionDenials > 0) {
          this.logger.warn(
            `브리지 결과에 권한 거부 ${line.permissionDenials}건 (도구 호출 시도: 보안 신호)`,
          );
        }
        break;
      case 'error':
        ctx.errorLine = line;
        break;
      default:
        break;
    }
  }

  private async concludeLive(
    ctx: ActiveRun,
    thrown: unknown,
    maxBudgetUsd: number,
  ): Promise<void> {
    const r = ctx.record;
    if (ctx.cancelRequested) return this.finishCancelled(ctx);
    if (ctx.timedOut) return this.fail(ctx, { reason: 'timeout' });

    if (ctx.errorLine) {
      const e = ctx.errorLine;
      this.logger.warn(`브리지 오류: ${e.code} ${e.message}`);
      return this.fail(
        ctx,
        mapBridgeErrorCode(e.code, e.message, e.retryAt ?? null),
      );
    }
    const res = ctx.resultLine;
    if (res) {
      r.llm = {
        model: r.llm?.model ?? null,
        costUsd: res.totalCostUsd,
        durationApiMs: res.durationApiMs,
        numTurns: res.numTurns,
        inputTokens:
          res.usage.inputTokens +
          res.usage.cacheReadInputTokens +
          res.usage.cacheCreationInputTokens,
        outputTokens: res.usage.outputTokens,
      };
      r.usage = {
        durationApiMs: res.durationApiMs,
        numTurns: res.numTurns,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        cacheReadInputTokens: res.usage.cacheReadInputTokens,
        cacheCreationInputTokens: res.usage.cacheCreationInputTokens,
        stopReason: res.stopReason,
        permissionDenials: res.permissionDenials,
        subtype: res.subtype,
        bridgeDurationMs: res.durationMs,
      };
      const reason = mapResultSubtype(res.subtype, res.isError);
      if (reason === 'invalid_response') {
        return this.fail(ctx, { reason }, res.resultText);
      }
      if (reason) {
        if (res.errors.length > 0)
          this.logger.warn(`브리지 결과 오류: ${res.subtype} ${res.errors[0]}`);
        return this.fail(
          ctx,
          { reason, detail: reason === 'other' ? res.errors[0] : undefined },
          null,
          maxBudgetUsd,
        );
      }
      enterStage(r, 'finalizing', new Date());
      this.emitProgress(ctx, true);
      const out = finalizeResult({
        structuredOutput: res.structuredOutput,
        resultText: res.resultText,
        snapshot: r.snapshot!,
        pseudonyms: r.pseudonyms ?? {
          nodes: {},
          volumes: {},
          loadBalancers: {},
        },
        prechecks: r.precheckResults,
      });
      if (!out.ok) {
        r.counts.dropped = out.dropped;
        const raw =
          res.resultText ??
          (res.structuredOutput !== null
            ? JSON.stringify(res.structuredOutput)
            : null);
        return this.fail(ctx, { reason: 'invalid_response' }, raw);
      }
      r.suggestions = out.suggestions;
      r.counts = out.counts;
      return this.succeed(ctx);
    }

    if (thrown instanceof BridgeHttpError) {
      return this.fail(ctx, mapBridgeHttpStatus(thrown.status, thrown.code));
    }
    if (thrown instanceof BridgeUnreachableError) {
      return this.fail(ctx, {
        reason: 'bridge_unavailable',
        detail: thrown.message,
      });
    }
    if (thrown) {
      this.logger.warn(
        `브리지 호출 실패: ${thrown instanceof Error ? thrown.message : typeof thrown === 'string' ? thrown : '알 수 없는 오류'}`,
      );
      return this.fail(ctx, {
        reason: 'bridge_unavailable',
        detail: '연결 실패',
      });
    }
    return this.fail(ctx, {
      reason: 'bridge_unavailable',
      detail: '결과 없이 스트림이 끝남',
    });
  }

  // -------------------------------------------------------------------------
  // 예시 응답 (mock)
  // -------------------------------------------------------------------------

  private startExample(ctx: ActiveRun): void {
    const t = setInterval(() => void this.simTick(ctx), 400);
    ctx.timers.push(t);
  }

  private async simTick(ctx: ActiveRun): Promise<void> {
    if (this.active !== ctx || ctx.finishing) return;
    const r = ctx.record;
    const e = Date.now() - ctx.simStartedAt;
    const now = new Date();
    const scenario = ctx.scenario ?? 'normal';
    if (r.stage === 'snapshot' && e >= 800) {
      enterStage(r, 'precheck', now);
      this.emitProgress(ctx, true);
    } else if (r.stage === 'precheck' && e >= 1_600) {
      enterStage(r, 'request', now);
      this.emitProgress(ctx, true);
    } else if (r.stage === 'request' && e >= 3_200) {
      enterStage(r, 'receiving', now);
      r.receiving = { lastReceivedAt: now.toISOString(), receivedChars: 0 };
      ctx.simReceivingEndAt =
        scenario === 'delayed'
          ? (r.limits.slowAfterSec + 4) * 1000
          : scenario === 'timeout'
            ? Number.POSITIVE_INFINITY
            : scenario === 'invalid-response' || scenario === 'budget-exceeded'
              ? 7_200
              : 8_200;
      this.emitProgress(ctx, true);
    } else if (r.stage === 'receiving') {
      const chars =
        (r.receiving?.receivedChars ?? 0) +
        180 +
        Math.floor(Math.random() * 120);
      r.receiving = { lastReceivedAt: now.toISOString(), receivedChars: chars };
      if (Date.now() - ctx.lastProgressAt >= RECEIVING_THROTTLE_MS)
        this.emitProgress(ctx);
      if (scenario === 'timeout' && e >= r.limits.timeoutSec * 1000) {
        return this.fail(ctx, { reason: 'timeout' });
      }
      if (ctx.simReceivingEndAt !== null && e >= ctx.simReceivingEndAt) {
        if (scenario === 'budget-exceeded') {
          const s = await this.settings.get();
          r.llm = {
            ...emptyLlm(),
            model: 'example',
            costUsd: Math.round((s.limits.maxBudgetUsd + 0.01) * 100) / 100,
            numTurns: 2,
          };
          return this.fail(
            ctx,
            { reason: 'budget_exceeded' },
            null,
            s.limits.maxBudgetUsd,
          );
        }
        enterStage(r, 'finalizing', now);
        this.emitProgress(ctx, true);
      }
    } else if (r.stage === 'finalizing') {
      if (scenario === 'invalid-response') {
        return this.fail(
          ctx,
          { reason: 'invalid_response' },
          EXAMPLE_INVALID_RAW,
        );
      }
      const out = finalizeResult({
        structuredOutput: exampleLlmOutput(),
        resultText: null,
        snapshot: r.snapshot!,
        pseudonyms: r.pseudonyms ?? {
          nodes: {},
          volumes: {},
          loadBalancers: {},
        },
        prechecks: r.precheckResults,
      });
      if (!out.ok)
        return this.fail(
          ctx,
          { reason: 'invalid_response' },
          EXAMPLE_INVALID_RAW,
        );
      r.suggestions = out.suggestions;
      r.counts = out.counts;
      return this.succeed(ctx);
    }
  }

  // -------------------------------------------------------------------------
  // 종료
  // -------------------------------------------------------------------------

  private async succeed(ctx: ActiveRun): Promise<void> {
    ctx.record.status = 'succeeded';
    ctx.record.failureReason = null;
    ctx.record.errorMessage = null;
    await this.finish(ctx, 'succeeded');
  }

  private async fail(
    ctx: ActiveRun,
    m: MappedFailure,
    raw: string | null = null,
    maxBudgetUsd?: number,
  ): Promise<void> {
    const r = ctx.record;
    if (m.logLevel === 'error')
      this.logger.error(`분석 실패: ${m.reason} ${m.detail ?? ''}`);
    r.status = 'failed';
    r.failureReason = m.reason;
    r.errorMessage = failureMessage(m.reason, {
      timeoutSec: r.limits.timeoutSec,
      maxBudgetUsd,
      retryAt: m.retryAt ?? null,
      detail: m.detail,
    });
    r.suggestions = null;
    if (m.reason === 'invalid_response' && raw) {
      const s = await this.settings.get();
      r.rawResponse = truncate(raw, s.rawResponseMaxBytes);
      r.hasRawResponse = true;
    }
    if (
      m.reason === 'login_required' ||
      m.reason === 'usage_limit' ||
      m.reason === 'bridge_unavailable'
    ) {
      if (ctx.mode === 'live')
        this.bridge.noteRunFailure(m.reason, m.retryAt ?? null);
    }
    await this.finish(ctx, 'failed');
  }

  private async finishCancelled(ctx: ActiveRun): Promise<void> {
    ctx.record.status = 'cancelled';
    ctx.record.failureReason = null;
    ctx.record.errorMessage = null;
    ctx.record.suggestions = null;
    await this.finish(ctx, 'cancelled');
  }

  private async finish(
    ctx: ActiveRun,
    outcome: 'succeeded' | 'failed' | 'cancelled',
  ): Promise<void> {
    if (ctx.finishing) return;
    ctx.finishing = true;
    for (const t of ctx.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    const r = ctx.record;
    const now = new Date();
    closeStages(r, outcome, now);
    r.finishedAt = now;
    r.durationMs = now.getTime() - r.requestedAt.getTime();
    r.cancelling = false;
    r.receiving = null;
    try {
      await this.repo.finish(r);
    } finally {
      if (this.active === ctx) this.active = null;
    }
    const total = await this.repo.count();
    this.events.emit('advisor.run.finished', {
      run: toRun(r, now, {
        freshness:
          outcome === 'succeeded' ? { stale: false, reasons: [] } : null,
      }),
      history: { total },
    });
    this.bridge.emitIfChanged();
    this.logger.log(
      `분석 ${r.id} 종료: ${r.status}${r.failureReason ? `/${r.failureReason}` : ''} (${r.durationMs}ms${
        r.llm?.costUsd !== null && r.llm?.costUsd !== undefined
          ? `, 추정 $${r.llm.costUsd.toFixed(4)}`
          : ''
      })`,
    );
  }

  // -------------------------------------------------------------------------
  // 취소·주기 진행
  // -------------------------------------------------------------------------

  async cancel(id: string): Promise<Run> {
    const ctx = this.active;
    if (ctx && ctx.record.id === id) {
      if (!ctx.cancelRequested) {
        ctx.cancelRequested = true;
        ctx.record.cancelling = true;
        this.emitProgress(ctx, true);
        if (ctx.mode === 'live') {
          void this.bridge.client.cancel(id);
          ctx.abort.abort();
        } else {
          void this.finishCancelled(ctx);
        }
      }
      return toRun(ctx.record, new Date(), { includeSuggestions: false });
    }
    const rec = await this.repo.get(id);
    if (!rec) throw notFound({ kind: 'AdvisorRun', id });
    throw new ApiError(409, 'RUN_NOT_ACTIVE', '이미 끝난 분석입니다.', {
      status: rec.status,
    });
  }

  private tick(): void {
    const ctx = this.active;
    if (!ctx || ctx.finishing) return;
    const r = ctx.record;
    const now = new Date();
    const elapsedSec =
      (now.getTime() - (r.startedAt ?? r.requestedAt).getTime()) / 1000;
    if (!ctx.delayedEmitted && elapsedSec >= r.limits.slowAfterSec) {
      ctx.delayedEmitted = true;
      this.emitProgress(ctx, true);
      return;
    }
    if (Date.now() - ctx.lastProgressAt >= PROGRESS_EVERY_MS)
      this.emitProgress(ctx, true);
  }

  private emitProgress(ctx: ActiveRun, persist = false): void {
    ctx.lastProgressAt = Date.now();
    this.events.emit('advisor.run.progress', {
      run: toRun(ctx.record, new Date(), { includeSuggestions: false }),
    });
    if (persist) void this.repo.saveProgress(ctx.record);
  }

  // -------------------------------------------------------------------------
  // 조회
  // -------------------------------------------------------------------------

  async get(id: string): Promise<Run> {
    if (this.active?.record.id === id)
      return toRun(this.active.record, new Date(), {
        includeSuggestions: false,
      });
    const r = await this.repo.get(id);
    if (!r) throw notFound({ kind: 'AdvisorRun', id });
    return toRun(r, new Date());
  }

  async list(q: {
    limit: number;
    offset: number;
    statuses: RunStatus[] | null;
  }): Promise<{
    items: RunSummary[];
    total: number;
    filteredTotal: number;
  }> {
    const res = await this.repo.list(q);
    return {
      items: res.items.map((r) =>
        toRunSummary(this.active?.record.id === r.id ? this.active.record : r),
      ),
      total: res.total,
      filteredTotal: res.filteredTotal,
    };
  }

  async lastRun(): Promise<RunSummary | null> {
    if (this.active) return toRunSummary(this.active.record);
    const r = await this.repo.latest();
    return r ? toRunSummary(r) : null;
  }

  async latestResult(): Promise<Run | null> {
    const r = await this.repo.latest('succeeded');
    if (!r) return null;
    const s = await this.settings.get();
    const now = new Date();
    return toRun(r, now, {
      freshness: computeFreshness(
        r,
        this.prechecks.latestSummary,
        now,
        s.limits.staleResultDays,
      ),
    });
  }

  async snapshotOf(id: string): Promise<{
    record: RunRecord;
    snapshot: NonNullable<RunRecord['snapshot']>;
  }> {
    const record =
      this.active?.record.id === id
        ? this.active.record
        : await this.repo.get(id);
    if (!record) throw notFound({ kind: 'AdvisorRun', id });
    const snapshot = record.snapshot ?? (await this.repo.getSnapshot(id));
    if (!snapshot)
      throw notFound({ kind: 'AdvisorRun', id }, { reason: 'no_snapshot' });
    return { record, snapshot };
  }

  async rawResponse(id: string): Promise<string> {
    const raw = await this.repo.getRaw(id);
    if (!raw) throw notFound({ kind: 'AdvisorRunRawResponse', id });
    return raw;
  }

  historyTotal(): Promise<number> {
    return this.repo.count();
  }

  // -------------------------------------------------------------------------
  // mock 예시 이력
  // -------------------------------------------------------------------------

  seedMockHistory(current?: SnapshotSections): void {
    const now = new Date();
    const seeds: { hoursAgo: number; kind: 'success' | 'failed_login' }[] = [
      { hoursAgo: 26, kind: 'success' },
      { hoursAgo: 50, kind: 'failed_login' },
    ];
    for (const seed of seeds) {
      const at = new Date(now.getTime() - seed.hoursAgo * 3_600_000);
      const built = buildAdvisorSnapshot(
        current ?? {
          cluster: mockClusterContribution(),
          db: mockDbSection(),
          cost: mockCostContribution(at),
        },
        { now: at, dataSource: 'mock', includeSystem: false },
      );
      if (!built) continue;
      const r = newRunRecord({
        id: randomUUID(),
        now: at,
        dataSource: 'mock',
        isExample: true,
        limits: { slowAfterSec: 300, timeoutSec: 600 },
      });
      attachSnapshot(r, built);
      r.startedAt = at;
      enterStage(r, 'snapshot', at);
      if (seed.kind === 'success') {
        const out = finalizeResult({
          structuredOutput: exampleLlmOutput(),
          resultText: null,
          snapshot: built.snapshot,
          pseudonyms: built.pseudonyms,
          prechecks: built.prechecks.items,
        });
        if (!out.ok) continue;
        const end = new Date(at.getTime() + 94_000);
        for (const [i, id] of (
          ['precheck', 'request', 'receiving', 'finalizing'] as const
        ).entries()) {
          enterStage(
            r,
            id,
            new Date(at.getTime() + [1_200, 2_000, 5_000, 92_000][i]),
          );
        }
        r.status = 'succeeded';
        r.suggestions = out.suggestions;
        r.counts = out.counts;
        closeStages(r, 'succeeded', end);
        r.finishedAt = end;
        r.durationMs = end.getTime() - at.getTime();
      } else {
        const end = new Date(at.getTime() + 6_500);
        enterStage(r, 'precheck', new Date(at.getTime() + 1_100));
        enterStage(r, 'request', new Date(at.getTime() + 1_900));
        r.status = 'failed';
        r.failureReason = 'login_required';
        r.errorMessage = failureMessage('login_required');
        closeStages(r, 'failed', end);
        r.finishedAt = end;
        r.durationMs = end.getTime() - at.getTime();
      }
      r.pseudonyms = null;
      this.repo.putMemoryOnly(r);
    }
  }
}

function attachSnapshot(r: RunRecord, built: BuiltSnapshot): void {
  r.snapshot = built.snapshot;
  r.snapshotMeta = built.meta;
  r.snapshotHash = built.hash;
  r.snapshotSummary = built.summary;
  r.precheckResults = built.prechecks.items;
  r.precheckSummary = {
    high: built.prechecks.counts.high,
    medium: built.prechecks.counts.medium,
    low: built.prechecks.counts.low,
  };
  r.pseudonyms = built.pseudonyms;
}

function emptyLlm() {
  return {
    model: null,
    costUsd: null,
    durationApiMs: null,
    numTurns: null,
    inputTokens: null,
    outputTokens: null,
  };
}

function truncate(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf8').replace(/�$/, '');
}

export type { FailureReason };
export { isActiveStatus };
