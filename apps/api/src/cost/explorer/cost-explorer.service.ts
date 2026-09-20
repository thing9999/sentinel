/**
 * Cost Explorer 조회·캐시·호출 제한. 호출당 $0.01이므로 이 클래스가 **유일한** CE 호출 경로다.
 *
 * - 캐시: `cost_explorer_cache`(요청 키마다 최신 1건). TTL은 설정(기본 6시간, 최소 1시간).
 *   API 재시작·여러 탭·여러 번 GET에도 캐시가 유효하면 부르지 않는다.
 * - 한 번 새로고침 = GetCostAndUsage(일별 + 서비스 그룹, 지난달 1일~어제) + GetCostForecast = 보통 2회
 *   (페이지네이션 포함 최대 CAU 3 + 예측 1).
 * - 호출 기록: 실제 AWS 호출마다 `cost_explorer_call_logs` 1행 (실패 포함).
 * - 일일 상한: 오늘(UTC) 호출 수 + 이번 새로고침 호출 수 > 상한이면 부르지 않는다.
 * - 수동 새로고침: 마지막 과금 호출 + 쿨다운(기본 1시간) 전이면 429.
 * - 동시 실행 1건: 자동·수동 모두 같은 잠금.
 * - 실패 후 재시도 간격 1시간 (실패가 호출 폭주로 이어지지 않게).
 */
import { createHash } from 'node:crypto';
import { HttpStatus, Logger } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';
import { ApiException } from '../../common/api-error';
import {
  classifyAwsError,
  type AwsErrorInfo,
  type CostAwsGateway,
} from '../aws/aws-gateway';
import {
  addDays,
  addUtcMonths,
  parseYmd,
  stableStringify,
  utcDayStart,
  utcMonthStart,
  ymd,
} from '../cost-util';
import type {
  CeDailyResult,
  CeEntry,
  CeForecastResult,
  Money,
  RefreshView,
  Unavailable,
} from '../cost.types';
import type { ExplorerSettings } from '../settings/cost-settings.service';
import type { CeCacheEntry, CostStore } from '../store/cost-store';
import { mergeCauPages, type CauPage } from './ce-normalize';

export const CALLS_PER_REFRESH = 2;
export const MAX_CAU_PAGES = 3;
/** 새로고침 1회 최대 호출 수: GetCostAndUsage 최대 페이지 + GetCostForecast 1 */
export const MAX_CALLS_PER_REFRESH = MAX_CAU_PAGES + 1;

/** 새로고침 1회 최대 예상 비용 (USD, 소수 6자리) */
export function refreshEstimatedCostUsd(callCostUsd: number): number {
  return Math.round(MAX_CALLS_PER_REFRESH * callCostUsd * 1e6) / 1e6;
}
export const ERROR_RETRY_SEC = 3600;

type Trigger = 'scheduled' | 'manual' | 'startup';

export interface CeState {
  daily: CeEntry<CeDailyResult> | null;
  forecast: CeEntry<CeForecastResult> | null;
  /** 마지막 조회 실패 (마지막 성공 캐시를 보여주는 중이면 stale) */
  dailyError: Unavailable | null;
  forecastError: Unavailable | null;
  dailyStale: boolean;
}

interface Keys {
  daily: {
    key: string;
    start: string;
    end: string;
    request: Record<string, unknown>;
  };
  forecast: {
    key: string;
    start: string;
    end: string;
    request: Record<string, unknown>;
  };
}

export function ceUnavailableFor(info: AwsErrorInfo): Unavailable {
  switch (info.kind) {
    case 'access_denied':
      return {
        code: 'CE_ACCESS_DENIED',
        message: `Cost Explorer 사용 불가: ${info.awsCode.replace(/Exception$/, '')}`,
      };
    case 'not_enabled':
      return {
        code: 'CE_NOT_ENABLED',
        message: 'Cost Explorer 사용 불가: 계정에서 활성화되지 않음',
      };
    case 'throttled':
      return {
        code: 'CE_THROTTLED',
        message: 'Cost Explorer 호출 제한 (잠시 후 다시 시도)',
      };
    case 'not_configured':
      return { code: 'AWS_NOT_CONFIGURED', message: 'AWS 자격 증명 없음' };
    case 'data_unavailable':
      return {
        code: 'CE_FORECAST_UNAVAILABLE',
        message: 'AWS 예측 불가 (데이터 부족)',
      };
    default:
      return {
        code: 'CE_ERROR',
        message: `Cost Explorer 오류: ${info.awsCode}`,
      };
  }
}

/** 과금되는 실패인가 (권한 없음·미활성화·자격 증명 없음·쓰로틀은 과금 안 됨) */
export function isBillable(info: AwsErrorInfo | null): boolean {
  if (!info) return true;
  return ![
    'access_denied',
    'not_enabled',
    'not_configured',
    'throttled',
  ].includes(info.kind);
}

export class CostExplorerService {
  private readonly logger = new Logger(CostExplorerService.name);
  private state: CeState = {
    daily: null,
    forecast: null,
    dailyError: null,
    forecastError: null,
    dailyStale: false,
  };
  private loadedFor: string | null = null;
  /** 동기 잠금: 자동·수동 조회가 겹치지 않게 (await 전에 잡는다) */
  private busy = false;
  private running: { startedAt: Date; trigger: Trigger } | null = null;
  private lastError: { code: string; message: string; at: string } | null =
    null;
  private limitReached = false;
  private startedOnce = false;
  private readonly changes = new Subject<'data' | 'refresh'>();
  readonly changes$: Observable<'data' | 'refresh'> =
    this.changes.asObservable();
  /** 가장 최근 실행 (테스트·종료 대기용) */
  lastRun: Promise<void> | null = null;

  constructor(
    private readonly store: CostStore,
    /** null = AWS 설정 없음 (live인데 리전·자격 증명 없음) */
    private readonly gateway: CostAwsGateway | null,
    private readonly settings: () => Promise<ExplorerSettings>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get configured(): boolean {
    return this.gateway !== null;
  }

  current(): CeState {
    return this.state;
  }

  get inProgress(): boolean {
    return this.running !== null;
  }

  // ------------------------------------------------------------------ 요청 키

  keysFor(now: Date, s: ExplorerSettings): Keys {
    const monthStart = utcMonthStart(now);
    const lastMonthStart = addUtcMonths(now, -1);
    const today = utcDayStart(now);
    const nextMonth = addUtcMonths(now, 1);
    const filter = s.costAllocationTagFilter;
    // 키에는 "어느 달·어떤 지표·필터"만 넣는다 (날짜가 바뀌어도 TTL 안에서는 다시 부르지 않음)
    const dailyReq = {
      op: 'GetCostAndUsage',
      granularity: 'DAILY',
      groupBy: 'SERVICE',
      from: ymd(lastMonthStart),
      month: ymd(monthStart),
      metric: s.metric,
      filter,
    };
    const forecastReq = {
      op: 'GetCostForecast',
      granularity: 'DAILY',
      month: ymd(monthStart),
      metric: s.metric,
      interval: 80,
      filter,
    };
    return {
      daily: {
        key: sha256(stableStringify(dailyReq)),
        start: ymd(lastMonthStart),
        end: ymd(today), // 미포함 → 어제까지
        request: dailyReq,
      },
      forecast: {
        key: sha256(stableStringify(forecastReq)),
        start: ymd(today),
        end: ymd(nextMonth),
        request: forecastReq,
      },
    };
  }

  /** 현재 키의 캐시를 메모리로 읽는다 (만료돼도 보여 주기 위해 읽음). AWS 호출 없음 */
  async load(force = false): Promise<void> {
    const s = await this.settings();
    const keys = this.keysFor(this.now(), s);
    const id = `${keys.daily.key}|${keys.forecast.key}`;
    if (!force && this.loadedFor === id) return;
    const [d, f] = await Promise.all([
      this.store.getCeCache('live', keys.daily.key),
      this.store.getCeCache('live', keys.forecast.key),
    ]);
    this.state = {
      daily: d ? toEntry<CeDailyResult>(d) : null,
      forecast: f ? toEntry<CeForecastResult>(f) : null,
      dailyError: d && d.status === 'error' ? errorOf(d) : null,
      forecastError: f && f.status === 'error' ? errorOf(f) : null,
      dailyStale: false,
    };
    this.loadedFor = id;
    this.changes.next('data');
  }

  // ------------------------------------------------------------------ 자동 조회

  /**
   * 캐시가 만료된 부분만 조회한다. 유효하면 아무것도 부르지 않는다.
   * @returns 수행 결과 (테스트용)
   */
  async ensureFresh(
    trigger?: Trigger,
  ): Promise<'not_configured' | 'busy' | 'fresh' | 'limit' | 'fetched'> {
    if (!this.gateway) return 'not_configured';
    if (this.busy) return 'busy';
    this.busy = true;
    let launched = false;
    try {
      await this.load();
      const now = this.now();
      const needDaily = !this.state.daily || this.state.daily.expiresAt <= now;
      const needForecast =
        !this.state.forecast || this.state.forecast.expiresAt <= now;
      if (!needDaily && !needForecast) {
        this.setLimit(false);
        return 'fresh';
      }
      const s = await this.settings();
      const stats = await this.store.ceCallStats(now);
      const calls = (needDaily ? 1 : 0) + (needForecast ? 1 : 0);
      if (stats.todayCalls + calls > s.dailyCallLimit) {
        this.setLimit(true);
        return 'limit';
      }
      this.setLimit(false);
      const t: Trigger =
        trigger ?? (this.startedOnce ? 'scheduled' : 'startup');
      launched = true;
      this.lastRun = this.runFetch(
        t,
        { daily: needDaily, forecast: needForecast },
        s,
      );
      await this.lastRun;
      return 'fetched';
    } finally {
      this.startedOnce = true;
      if (!launched) this.busy = false;
    }
  }

  // ------------------------------------------------------------------ 수동 새로고침

  /** 계약 5.3. 검증을 통과하면 조회를 시작하고 즉시 돌려준다 (결과는 changes$로) */
  async requestManualRefresh(): Promise<RefreshView> {
    if (!this.gateway) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SOURCE_UNAVAILABLE',
        'AWS 자격 증명·리전 설정이 없어 Cost Explorer를 조회할 수 없습니다.',
        { source: { id: 'costExplorer', state: 'not_configured' } },
      );
    }
    if (this.busy) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CE_REFRESH_IN_PROGRESS',
        '이미 Cost Explorer 조회가 진행 중입니다.',
        { startedAt: (this.running?.startedAt ?? this.now()).toISOString() },
      );
    }
    this.busy = true;
    let launched = false;
    try {
      const now = this.now();
      const s = await this.settings();
      const stats = await this.store.ceCallStats(now);
      if (stats.lastBillableAt) {
        const next = new Date(
          stats.lastBillableAt.getTime() + s.manualRefreshCooldownSec * 1000,
        );
        if (next > now) {
          const retryAfterSec = Math.ceil(
            (next.getTime() - now.getTime()) / 1000,
          );
          throw new ApiException(
            HttpStatus.TOO_MANY_REQUESTS,
            'CE_REFRESH_COOLDOWN',
            `마지막 Cost Explorer 호출 후 ${Math.round(s.manualRefreshCooldownSec / 3600)}시간이 지나지 않았습니다.`,
            {
              nextAvailableAt: next.toISOString(),
              lastCallAt: stats.lastBillableAt.toISOString(),
            },
            retryAfterSec,
          );
        }
      }
      if (stats.todayCalls + CALLS_PER_REFRESH > s.dailyCallLimit) {
        const reset = addDays(utcDayStart(now), 1);
        this.setLimit(true);
        throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          'CE_DAILY_LIMIT_REACHED',
          `오늘 Cost Explorer 호출 한도에 도달했습니다 (${stats.todayCalls}/${s.dailyCallLimit}회). 캐시를 사용합니다.`,
          {
            todayCalls: stats.todayCalls,
            dailyLimit: s.dailyCallLimit,
            resetsAt: reset.toISOString(),
          },
          Math.ceil((reset.getTime() - now.getTime()) / 1000),
        );
      }
      launched = true;
      this.lastRun = this.runFetch(
        'manual',
        { daily: true, forecast: true },
        s,
      ).catch((err) => {
        this.logger.error(`CE 수동 새로고침 실패: ${String(err)}`);
      });
      return await this.refreshView();
    } finally {
      if (!launched) this.busy = false;
    }
  }

  // ------------------------------------------------------------------ 실제 호출

  private async runFetch(
    trigger: Trigger,
    parts: { daily: boolean; forecast: boolean },
    s: ExplorerSettings,
  ): Promise<void> {
    const gw = this.gateway!;
    const startedAt = this.now();
    this.running = { startedAt, trigger };
    this.changes.next('refresh');
    const keys = this.keysFor(startedAt, s);
    let fatal: AwsErrorInfo | null = null;
    try {
      if (parts.daily) {
        const pages: CauPage[] = [];
        let token: string | null = null;
        let err: AwsErrorInfo | null = null;
        for (let i = 0; i < MAX_CAU_PAGES; i += 1) {
          const t0 = Date.now();
          try {
            const page = await gw.getCostAndUsagePage({
              start: keys.daily.start,
              end: keys.daily.end,
              metric: s.metric,
              tagFilter: s.costAllocationTagFilter,
              nextPageToken: token,
            });
            await this.log(
              'GetCostAndUsage',
              trigger,
              keys.daily.key,
              null,
              t0,
              s,
            );
            pages.push(page);
            token = page.nextPageToken;
            if (!token) break;
          } catch (e) {
            err = classifyAwsError(e);
            await this.log(
              'GetCostAndUsage',
              trigger,
              keys.daily.key,
              err,
              t0,
              s,
            );
            break;
          }
        }
        if (err && !(err.kind === 'data_unavailable' && pages.length > 0)) {
          await this.saveError('daily', keys, err, s);
          if (err.kind !== 'throttled' && err.kind !== 'other') fatal = err;
        } else if (start(keys.daily.start) < start(keys.daily.end)) {
          await this.saveOk(
            'daily',
            keys,
            mergeCauPages(pages, {
              start: keys.daily.start,
              end: keys.daily.end,
              metric: s.metric,
            }),
            s,
          );
        } else {
          await this.saveOk(
            'daily',
            keys,
            {
              start: keys.daily.start,
              end: keys.daily.end,
              metric: s.metric,
              days: [],
            },
            s,
          );
        }
      }
      if (parts.forecast && !fatal) {
        const t0 = Date.now();
        try {
          const r = await gw.getCostForecast({
            start: keys.forecast.start,
            end: keys.forecast.end,
            metric: s.metric,
            tagFilter: s.costAllocationTagFilter,
          });
          await this.log(
            'GetCostForecast',
            trigger,
            keys.forecast.key,
            null,
            t0,
            s,
          );
          await this.saveOk(
            'forecast',
            keys,
            {
              start: keys.forecast.start,
              end: keys.forecast.end,
              totalUsd: r.totalUsd,
              days: r.days,
            },
            s,
          );
        } catch (e) {
          const err = classifyAwsError(e);
          await this.log(
            'GetCostForecast',
            trigger,
            keys.forecast.key,
            err,
            t0,
            s,
          );
          await this.saveError('forecast', keys, err, s);
        }
      } else if (parts.forecast && fatal) {
        // 같은 원인으로 실패할 호출은 하지 않는다 (예측 영역도 같은 사유)
        this.state = { ...this.state, forecastError: ceUnavailableFor(fatal) };
      }
    } finally {
      this.running = null;
      this.busy = false;
      this.changes.next('data');
      this.changes.next('refresh');
    }
  }

  private async log(
    operation: 'GetCostAndUsage' | 'GetCostForecast',
    trigger: Trigger,
    requestKey: string,
    err: AwsErrorInfo | null,
    t0: number,
    s: ExplorerSettings,
  ): Promise<void> {
    await this.store.logCeCall({
      calledAt: this.now(),
      operation,
      trigger,
      requestKey,
      success: err === null,
      errorCode: err ? err.awsCode.slice(0, 100) : null,
      durationMs: Math.max(0, Date.now() - t0),
      estimatedCostUsd: isBillable(err) ? s.callCostUsd : 0,
    });
    if (err) {
      const u = ceUnavailableFor(err);
      this.lastError = {
        code: u.code,
        message: u.message,
        at: this.now().toISOString(),
      };
    }
  }

  private async saveOk(
    part: 'daily' | 'forecast',
    keys: Keys,
    result: CeDailyResult | CeForecastResult,
    s: ExplorerSettings,
  ): Promise<void> {
    const now = this.now();
    const k = keys[part];
    const entry: CeCacheEntry = {
      dataSource: 'live',
      kind: part === 'daily' ? 'daily' : 'forecast',
      requestKey: k.key,
      request: { ...k.request, start: k.start, end: k.end },
      periodStart: start(k.start),
      periodEnd: start(k.end),
      metric: s.metric,
      status: 'ok',
      result,
      dataThrough: part === 'daily' ? addDays(start(k.end), -1) : null,
      errorCode: null,
      errorMessage: null,
      fetchedAt: now,
      expiresAt: new Date(now.getTime() + s.cacheTtlSec * 1000),
    };
    await this.store.putCeCache(entry);
    if (part === 'daily') {
      this.state = {
        ...this.state,
        daily: toEntry<CeDailyResult>(entry),
        dailyError: null,
        dailyStale: false,
      };
      this.lastError = null;
    } else {
      this.state = {
        ...this.state,
        forecast: toEntry<CeForecastResult>(entry),
        forecastError: null,
      };
    }
    this.loadedFor = `${keys.daily.key}|${keys.forecast.key}`;
  }

  private async saveError(
    part: 'daily' | 'forecast',
    keys: Keys,
    err: AwsErrorInfo,
    s: ExplorerSettings,
  ): Promise<void> {
    const now = this.now();
    const k = keys[part];
    const u = ceUnavailableFor(err);
    // 예측 데이터 부족은 곧 바뀌지 않으므로 일반 TTL, 그 밖의 실패는 1시간 뒤 재시도
    const retrySec =
      err.kind === 'data_unavailable' ? s.cacheTtlSec : ERROR_RETRY_SEC;
    const expiresAt = new Date(now.getTime() + retrySec * 1000);
    const prev = this.state.daily;
    if (part === 'daily' && prev && prev.status === 'ok') {
      // 마지막 성공 캐시를 유지하고 재시도 시각만 늦춘다 (계약 5.1: stale + staleReason)
      const kept: CeCacheEntry = {
        dataSource: 'live',
        kind: 'daily',
        requestKey: k.key,
        request: { ...k.request, start: k.start, end: k.end },
        periodStart: start(k.start),
        periodEnd: start(k.end),
        metric: s.metric,
        status: 'ok',
        result: prev.result,
        dataThrough: null,
        errorCode: null,
        errorMessage: null,
        fetchedAt: prev.fetchedAt,
        expiresAt,
      };
      await this.store.putCeCache(kept);
      this.state = {
        ...this.state,
        daily: { ...prev, expiresAt },
        dailyError: u,
        dailyStale: true,
      };
      return;
    }
    const entry: CeCacheEntry = {
      dataSource: 'live',
      kind: part === 'daily' ? 'daily' : 'forecast',
      requestKey: k.key,
      request: { ...k.request, start: k.start, end: k.end },
      periodStart: start(k.start),
      periodEnd: start(k.end),
      metric: s.metric,
      status: 'error',
      result: null,
      dataThrough: null,
      errorCode: u.code,
      errorMessage: u.message,
      fetchedAt: now,
      expiresAt,
    };
    await this.store.putCeCache(entry);
    if (part === 'daily') {
      this.state = {
        ...this.state,
        daily: toEntry<CeDailyResult>(entry),
        dailyError: u,
        dailyStale: false,
      };
    } else {
      this.state = {
        ...this.state,
        forecast: toEntry<CeForecastResult>(entry),
        forecastError: u,
      };
    }
  }

  private setLimit(v: boolean): void {
    if (this.limitReached !== v) {
      this.limitReached = v;
      this.changes.next('refresh');
    }
  }

  // ------------------------------------------------------------------ 상태 (계약 5.2)

  async refreshView(): Promise<RefreshView> {
    const now = this.now();
    const s = await this.settings();
    const stats = await this.store.ceCallStats(now);
    const reset = addDays(utcDayStart(now), 1);
    const limitReached =
      stats.todayCalls + CALLS_PER_REFRESH > s.dailyCallLimit;
    const cooldownUntil = stats.lastBillableAt
      ? new Date(
          stats.lastBillableAt.getTime() + s.manualRefreshCooldownSec * 1000,
        )
      : null;
    const inCooldown = cooldownUntil !== null && cooldownUntil > now;
    let disabledReason: RefreshView['disabledReason'] = null;
    if (!this.gateway) disabledReason = 'not_configured';
    else if (this.running || this.busy)
      disabledReason = this.running ? 'in_progress' : null;
    if (disabledReason === null && this.gateway) {
      if (limitReached) disabledReason = 'daily_limit';
      else if (inCooldown) disabledReason = 'cooldown';
    }
    const daily = this.state.daily;
    const forecast = this.state.forecast;
    const expiries = [daily?.expiresAt, forecast?.expiresAt].filter(
      (d): d is Date => d instanceof Date,
    );
    const nextScheduled = this.gateway
      ? expiries.length > 0
        ? new Date(Math.min(...expiries.map((d) => d.getTime())))
        : now
      : null;
    const monthCallCost: Money = {
      amountUsd: Math.round(stats.monthCostUsd * 1e6) / 1e6,
      kind: 'estimated',
      asOf: now.toISOString(),
    };
    return {
      state: this.running ? 'refreshing' : 'idle',
      canRefresh: disabledReason === null,
      disabledReason,
      lastFetchedAt:
        daily && daily.status === 'ok' ? daily.fetchedAt.toISOString() : null,
      lastCallAt: stats.lastCallAt ? stats.lastCallAt.toISOString() : null,
      lastManualAt: stats.lastManualAt
        ? stats.lastManualAt.toISOString()
        : null,
      nextAvailableAt: limitReached
        ? reset.toISOString()
        : inCooldown
          ? cooldownUntil.toISOString()
          : null,
      nextScheduledAt: nextScheduled ? nextScheduled.toISOString() : null,
      cacheTtlSec: s.cacheTtlSec,
      cooldownSec: s.manualRefreshCooldownSec,
      todayCalls: stats.todayCalls,
      dailyLimit: s.dailyCallLimit,
      limitReached: limitReached || this.limitReached,
      dayBoundary: 'UTC',
      dailyResetAt: reset.toISOString(),
      callsPerRefresh: CALLS_PER_REFRESH,
      maxCallsPerRefresh: MAX_CALLS_PER_REFRESH,
      refreshEstimatedCostUsd: refreshEstimatedCostUsd(s.callCostUsd),
      callCostUsd: s.callCostUsd,
      monthCalls: stats.monthCalls,
      monthCallCost,
      lastError: this.lastError,
    };
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function start(ymdStr: string): Date {
  return parseYmd(ymdStr);
}

function toEntry<T>(e: CeCacheEntry): CeEntry<T> {
  return {
    status: e.status,
    result: e.status === 'ok' ? (e.result as T) : null,
    fetchedAt: e.fetchedAt,
    expiresAt: e.expiresAt,
    errorCode: e.errorCode,
    errorMessage: e.errorMessage,
  };
}

function errorOf(e: CeCacheEntry): Unavailable {
  return {
    code: e.errorCode ?? 'CE_ERROR',
    message: e.errorMessage ?? 'Cost Explorer 오류',
  };
}
