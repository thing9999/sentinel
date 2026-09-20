import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AdvisorEvents } from '../advisor-events';
import { AdvisorSettingsService } from '../advisor-settings.service';
import type { BridgeStatus, FailureReason } from '../advisor.types';
import { ApiError } from '../api-error';
import { AdvisorScenarioState } from '../mock/advisor-scenario.state';
import {
  BridgeClient,
  BridgeHttpError,
  BridgeUnreachableError,
  type FetchFn,
} from './bridge-client';
import {
  deriveBridgeStatus,
  UNKNOWN_OBSERVATION,
  type BridgeObservation,
} from './bridge-status';

const MANUAL_COOLDOWN_MS = 10_000;
const AUTH_COOLDOWN_MS = 60_000;
const AUTH_STALE_MS = 10 * 60_000;
const TICK_MS = 5_000;

/** 브리지 fetch 주입 토큰 (테스트) */
export const BRIDGE_FETCH = Symbol('BRIDGE_FETCH');

/**
 * 브리지 상태 캐시·주기 확인 (계약 A.3).
 * - advisor 토픽 구독자가 있거나 최근 REST 조회가 있을 때만 30초마다 GET /health (3초)
 * - 분석 실행 직전 1회 확인, "다시 확인"은 쿨다운 + 필요 시 인증 쿼리
 */
@Injectable()
export class AdvisorBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdvisorBridgeService.name);
  private observation: BridgeObservation = UNKNOWN_OBSERVATION;
  private statusChangedAt: string | null = null;
  private lastStatusValue: string | null = null;
  private lastEmittedKey: string | null = null;
  private lastManualAt = 0;
  private lastAuthQueryAt = 0;
  private timer: NodeJS.Timeout | undefined;
  private refreshing: Promise<void> | null = null;
  private clientCache: BridgeClient | null = null;
  /** 실행 서비스가 등록 (순환 의존 방지) */
  runActive: () => boolean = () => false;
  fetchFn: FetchFn | undefined;

  constructor(
    private readonly settings: AdvisorSettingsService,
    private readonly scenario: AdvisorScenarioState,
    private readonly events: AdvisorEvents,
  ) {}

  get client(): BridgeClient {
    this.clientCache ??= new BridgeClient({
      baseUrl: this.settings.bridgeUrl,
      token: this.settings.bridgeToken,
      fetchFn: this.fetchFn,
    });
    return this.clientCache;
  }

  /** 실제 브리지를 부르는지 */
  get callsBridge(): boolean {
    return this.settings.bridgeMode === 'live';
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    if (this.callsBridge) void this.refresh();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (!this.callsBridge || !this.events.hasInterest()) return;
    const { limits } = await this.settings.get();
    const last = this.observation.checkedAt
      ? Date.parse(this.observation.checkedAt)
      : 0;
    if (Date.now() - last >= limits.bridgeHealthIntervalSec * 1000)
      await this.refresh();
  }

  status(now = new Date()): BridgeStatus {
    const s = deriveBridgeStatus({
      dataSource: this.settings.dataSource,
      bridgeMode: this.settings.bridgeMode,
      scenario:
        this.settings.dataSource === 'mock' ? this.scenario.scenario : null,
      usageRetryAt: this.scenario.usageRetryAt,
      observation: this.observation,
      runActive: this.runActive(),
      now,
      statusChangedAt: this.statusChangedAt,
    });
    if (this.lastStatusValue !== s.status.status) {
      this.lastStatusValue = s.status.status;
      this.statusChangedAt = now.toISOString();
      s.status.statusChangedAt = this.statusChangedAt;
    }
    return s;
  }

  /** 화면 표시 값이 바뀌었으면 advisor.bridge.updated */
  emitIfChanged(): void {
    const s = this.status();
    const key = JSON.stringify([
      s.state,
      s.message,
      s.command,
      s.retryAt,
      s.canRun,
      s.disabledReason,
      s.exampleMode,
      s.busy,
      s.claudeCodeVersion,
      s.authCheckedAt,
      s.status.stale,
    ]);
    if (key === this.lastEmittedKey) return;
    this.lastEmittedKey = key;
    this.events.emit('advisor.bridge.updated', { bridge: s });
  }

  /** 오래된 값이면 백그라운드로 확인 (화면 진입 시) */
  ensureFresh(): void {
    if (!this.callsBridge) return;
    const last = this.observation.checkedAt
      ? Date.parse(this.observation.checkedAt)
      : 0;
    if (Date.now() - last > 30_000) void this.refresh();
  }

  async refresh(): Promise<BridgeStatus> {
    if (!this.callsBridge) {
      this.emitIfChanged();
      return this.status();
    }
    if (!this.refreshing) {
      this.refreshing = this.doRefresh().finally(() => {
        this.refreshing = null;
      });
    }
    await this.refreshing;
    this.emitIfChanged();
    return this.status();
  }

  private async doRefresh(): Promise<void> {
    const { limits } = await this.settings.get();
    const checkedAt = new Date().toISOString();
    try {
      const health = await this.client.health(
        limits.bridgeHealthTimeoutSec * 1000,
      );
      this.observation = {
        kind: health.claudeCodeAvailable ? 'ok' : 'claude_missing',
        health,
        detail: null,
        checkedAt,
      };
    } catch (err) {
      this.observation = { ...observationFromError(err), checkedAt };
    }
  }

  /** 분석 실행 직전 1회 확인 */
  async checkBeforeRun(): Promise<BridgeStatus> {
    return this.refresh();
  }

  /** POST /api/advisor/bridge/check */
  async manualCheck(): Promise<BridgeStatus> {
    if (this.runActive()) {
      throw new ApiError(
        409,
        'RUN_ACTIVE',
        '분석이 진행 중이라 브리지를 다시 확인할 수 없습니다.',
        {
          bridge: this.status(),
        },
      );
    }
    const now = Date.now();
    const sinceManual = now - this.lastManualAt;
    if (sinceManual < MANUAL_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil(
        (MANUAL_COOLDOWN_MS - sinceManual) / 1000,
      );
      throw new ApiError(
        429,
        'BRIDGE_CHECK_COOLDOWN',
        '잠시 후 다시 확인하세요.',
        { retryAfterSec },
      );
    }
    if (!this.callsBridge) {
      this.lastManualAt = now;
      return this.refresh();
    }
    this.lastManualAt = now;
    await this.refresh();
    const h = this.observation.health;
    const authAge = h?.auth.checkedAt
      ? now - Date.parse(h.auth.checkedAt)
      : Infinity;
    const needsAuth =
      this.observation.kind === 'ok' &&
      (h?.auth.state !== 'ok' || authAge > AUTH_STALE_MS);
    if (!needsAuth) return this.status();
    const sinceAuth = now - this.lastAuthQueryAt;
    if (sinceAuth < AUTH_COOLDOWN_MS) {
      const retryAfterSec = Math.ceil((AUTH_COOLDOWN_MS - sinceAuth) / 1000);
      throw new ApiError(
        429,
        'BRIDGE_CHECK_COOLDOWN',
        '인증 확인은 1분에 한 번만 할 수 있습니다.',
        {
          retryAfterSec,
        },
      );
    }
    this.lastAuthQueryAt = now;
    try {
      await this.client.authCheck();
    } catch (err) {
      if (err instanceof BridgeHttpError && err.status === 409) {
        throw new ApiError(
          409,
          'RUN_ACTIVE',
          '브리지가 다른 작업을 실행 중입니다.',
          { bridge: this.status() },
        );
      }
      this.logger.warn(
        `브리지 인증 확인 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // 인증 결과는 브리지 /health에 반영된다
    return this.refresh();
  }

  /** 실행 결과로 알게 된 인증·한도 상태를 즉시 반영 (다음 /health 전까지) */
  noteRunFailure(reason: FailureReason, retryAt: string | null): void {
    const h = this.observation.health;
    if (!h) return;
    if (reason === 'login_required') {
      this.observation = {
        ...this.observation,
        health: {
          ...h,
          auth: {
            ...h.auth,
            state: 'login_required',
            checkedAt: new Date().toISOString(),
          },
        },
      };
    } else if (reason === 'usage_limit') {
      this.observation = {
        ...this.observation,
        health: { ...h, usageLimit: { limited: true, retryAt } },
      };
    } else if (reason === 'bridge_unavailable') {
      void this.refresh();
      return;
    }
    this.emitIfChanged();
  }
}

export function observationFromError(
  err: unknown,
): Omit<BridgeObservation, 'checkedAt'> {
  if (err instanceof BridgeHttpError) {
    if (err.status === 401 || err.status === 403) {
      return {
        kind: 'token_mismatch',
        health: null,
        detail: `HTTP ${err.status}`,
      };
    }
    return { kind: 'unreachable', health: null, detail: `HTTP ${err.status}` };
  }
  if (err instanceof BridgeUnreachableError) {
    return { kind: 'unreachable', health: null, detail: err.message };
  }
  return { kind: 'unreachable', health: null, detail: '연결 실패' };
}
