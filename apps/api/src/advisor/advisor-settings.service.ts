import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { mergeSetting, SETTING_DEFAULTS } from '../database/settings-defaults';
import type { AdvisorLimits } from './advisor.types';
import {
  DEFAULT_PRECHECK_THRESHOLDS,
  DEFAULT_SYSTEM_NAMESPACES,
  type PrecheckThresholds,
} from './precheck/precheck-rules';

export type AdvisorBridgeMode = 'mock' | 'live';

export interface AdvisorSettings {
  limits: AdvisorLimits;
  prechecks: PrecheckThresholds;
  rawResponseMaxBytes: number;
  retention: { maxCount: number; maxDays: number };
}

const CACHE_MS = 60_000;

/** PM 결정(2026-09-19): 코드 기본값. 브리지 MAX_TURNS_LIMIT도 5 */
export const CODE_DEFAULTS = { maxTurns: 5, slowAfterSec: 300 } as const;

/** settings 값이 양수면 그대로(운영자가 넣은 3·180도 존중), 없거나 잘못되면 코드 기본값 */
export function positiveOr(
  stored: number | undefined,
  codeDefault: number,
): number {
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0
    ? stored
    : codeDefault;
}

/**
 * 어드바이저 설정: 환경 변수 > settings 테이블 > 코드 기본값 (docs/db/schema.md 2.1)
 * 환경 변수 검증 파일(config/env.validation.ts)은 A 영역이라 여기서는 ConfigService 기본값으로 읽는다.
 */
@Injectable()
export class AdvisorSettingsService {
  private readonly logger = new Logger(AdvisorSettingsService.name);
  private cached: { at: number; value: AdvisorSettings } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  get dataSource(): 'mock' | 'live' {
    return this.config.get<string>('DATA_SOURCE') === 'live' ? 'live' : 'mock';
  }

  /**
   * 브리지 호출 방식 `ADVISOR_BRIDGE=mock|live`.
   * - 기본: DATA_SOURCE를 따른다 (mock → 브리지를 부르지 않고 예시 응답, live → 실제 브리지)
   * - DATA_SOURCE=mock + ADVISOR_BRIDGE=live: mock 스냅샷으로 로컬 Claude Code에 실제 분석 요청
   * - DATA_SOURCE=live에서는 항상 live
   */
  get bridgeMode(): AdvisorBridgeMode {
    if (this.dataSource === 'live') return 'live';
    const v = (this.config.get<string>('ADVISOR_BRIDGE') ?? '')
      .trim()
      .toLowerCase();
    return v === 'live' ? 'live' : 'mock';
  }

  get bridgeUrl(): string {
    return (
      this.config.get<string>('AGENT_BRIDGE_URL') ?? 'http://localhost:3002'
    );
  }

  get bridgeToken(): string | undefined {
    const t = this.config.get<string>('AGENT_BRIDGE_TOKEN');
    return t && t.trim() !== '' ? t : undefined;
  }

  get systemNamespaces(): string[] {
    const raw = this.config.get<string>('SYSTEM_NAMESPACES');
    if (!raw || raw.trim() === '') return [...DEFAULT_SYSTEM_NAMESPACES];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private envNumber(key: string): number | undefined {
    const v = this.config.get<string | number>(key);
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  async get(): Promise<AdvisorSettings> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_MS)
      return this.cached.value;
    const stored = await this.readStored();
    const limitsBase = mergeSetting(
      'advisor.limits',
      stored['advisor.limits'],
    ) as Partial<AdvisorLimits>;
    const prechecks = {
      ...DEFAULT_PRECHECK_THRESHOLDS,
      ...(mergeSetting(
        'advisor.prechecks',
        stored['advisor.prechecks'],
      ) as Partial<PrecheckThresholds>),
    };
    const retention = mergeSetting('retention', stored.retention);
    const d = SETTING_DEFAULTS['advisor.limits']
      .value as Partial<AdvisorLimits>;
    const limits: AdvisorLimits = {
      slowAfterSec:
        this.envNumber('ADVISOR_SLOW_AFTER_SEC') ??
        positiveOr(limitsBase.slowAfterSec, CODE_DEFAULTS.slowAfterSec),
      timeoutSec:
        this.envNumber('ADVISOR_TIMEOUT_SEC') ??
        limitsBase.timeoutSec ??
        d.timeoutSec ??
        600,
      bridgeHealthIntervalSec: limitsBase.bridgeHealthIntervalSec ?? 30,
      bridgeHealthTimeoutSec: limitsBase.bridgeHealthTimeoutSec ?? 3,
      maxWorkloads: limitsBase.maxWorkloads ?? 300,
      maxNodes: limitsBase.maxNodes ?? 100,
      staleResultDays: limitsBase.staleResultDays ?? 7,
      maxBudgetUsd:
        this.envNumber('ADVISOR_MAX_BUDGET_USD') ??
        limitsBase.maxBudgetUsd ??
        2.0,
      maxTurns:
        this.envNumber('ADVISOR_MAX_TURNS') ??
        positiveOr(limitsBase.maxTurns, CODE_DEFAULTS.maxTurns),
    };
    const value: AdvisorSettings = {
      limits,
      prechecks,
      rawResponseMaxBytes: retention.advisorRawResponseMaxBytes,
      retention: {
        maxCount: retention.advisorRunMaxCount,
        maxDays: retention.advisorRunDays,
      },
    };
    this.cached = { at: now, value };
    return value;
  }

  private async readStored(): Promise<Record<string, unknown>> {
    if (!this.prisma.isConnected) return {};
    try {
      const rows = await this.prisma.setting.findMany({
        where: {
          key: { in: ['advisor.limits', 'advisor.prechecks', 'retention'] },
        },
        select: { key: true, value: true },
      });
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    } catch (err) {
      this.logger.warn(
        `설정 조회 실패 (기본값 사용): ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
  }
}
