/**
 * 비용 설정 (대시보드 자체 DB `settings`만). 우선순위: 환경 변수 > settings 테이블 > 코드 기본값.
 * 계약 aws-cost 6절. 클러스터·AWS에 쓰는 일이 없다.
 */
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiException, validationFailed } from '../../common/api-error';
import {
  SETTING_DEFAULTS,
  mergeSetting,
} from '../../database/settings-defaults';
import type { CostSettingsPatchDto } from '../dto/cost.dto';
import { COST_OPTIONS, type CostOptions } from '../cost.options';
import type {
  BudgetSettings,
  DailySpikeSettings,
  RateSpikeSettings,
} from '../status/cost-status';
import { CostStore } from '../store/cost-store';

export interface ExplorerSettings {
  metric: 'UnblendedCost' | 'AmortizedCost';
  cacheTtlSec: number;
  manualRefreshCooldownSec: number;
  dailyCallLimit: number;
  callCostUsd: number;
  costAllocationTagFilter: { key: string; values: string[] } | null;
}

export interface EstimationSettings {
  resourceRefreshSec: number;
  rateSampleIntervalSec: number;
  pricingCacheTtlSec: number;
  spotPriceCacheTtlSec: number;
  hoursPerMonth: number;
}

export interface CostSettings {
  budget: BudgetSettings;
  spike: { rate: RateSpikeSettings; daily: DailySpikeSettings };
  explorer: ExplorerSettings;
  estimation: EstimationSettings;
  unallocatedWarnPct: number;
  locked: { budget: string[]; spike: string[]; explorer: string[] };
  updatedAt: Date | null;
}

/** 호출 비용 보호: 어떤 경로로도 CE 캐시는 1시간 미만이 되지 않는다 */
export const MIN_CE_TTL_SEC = 3600;
export const MIN_CE_COOLDOWN_SEC = 3600;

const KEYS = [
  'cost.budget',
  'cost.spike',
  'cost.explorer',
  'cost.estimation',
  'advisor.prechecks',
] as const;
const RELOAD_MS = 60_000;

function mergeSpike(stored: unknown): {
  rate: RateSpikeSettings;
  daily: DailySpikeSettings;
} {
  const d = SETTING_DEFAULTS['cost.spike'].value;
  const s =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Partial<Record<'rate' | 'daily', unknown>>)
      : {};
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  return {
    rate: { ...d.rate, ...obj(s.rate) },
    daily: { ...d.daily, ...obj(s.daily) },
  };
}

@Injectable()
export class CostSettingsService {
  private cached: CostSettings | null = null;
  private loadedAt = 0;

  constructor(
    private readonly store: CostStore,
    @Inject(COST_OPTIONS) private readonly options: CostOptions,
  ) {}

  invalidate(): void {
    this.cached = null;
  }

  /** 마지막으로 읽은 값 (없으면 기본값 + env). 동기 경로용 */
  current(): CostSettings {
    return this.cached ?? this.compose({});
  }

  async get(): Promise<CostSettings> {
    if (this.cached && Date.now() - this.loadedAt < RELOAD_MS)
      return this.cached;
    const rows = await this.store.getSettings([...KEYS]);
    this.cached = this.compose(rows);
    this.loadedAt = Date.now();
    return this.cached;
  }

  private compose(
    rows: Record<string, { value: unknown; updatedAt: Date }>,
  ): CostSettings {
    const env = this.options.env;
    const budget = {
      ...mergeSetting('cost.budget', rows['cost.budget']?.value),
    };
    const spike = mergeSpike(rows['cost.spike']?.value);
    const explorer = {
      ...mergeSetting('cost.explorer', rows['cost.explorer']?.value),
    } as ExplorerSettings;
    const estimation = {
      ...mergeSetting('cost.estimation', rows['cost.estimation']?.value),
    } as EstimationSettings;
    const prechecks = mergeSetting(
      'advisor.prechecks',
      rows['advisor.prechecks']?.value,
    );

    const locked = {
      budget: [] as string[],
      spike: [] as string[],
      explorer: [] as string[],
    };
    if (env.monthlyBudgetUsd !== undefined) {
      budget.monthlyBudgetUsd = env.monthlyBudgetUsd;
      locked.budget.push('monthlyBudgetUsd');
    }
    if (env.ceCacheTtlSec !== undefined) {
      explorer.cacheTtlSec = env.ceCacheTtlSec;
      locked.explorer.push('cacheTtlSec');
    }
    if (env.ceMetric !== undefined) {
      explorer.metric = env.ceMetric;
      locked.explorer.push('metric');
    }
    if (env.ceDailyCallLimit !== undefined) {
      explorer.dailyCallLimit = env.ceDailyCallLimit;
      locked.explorer.push('dailyCallLimit');
    }
    // 호출 비용 보호 (env·DB 값이 더 작아도)
    explorer.cacheTtlSec = Math.max(
      MIN_CE_TTL_SEC,
      Number(explorer.cacheTtlSec) || 0,
    );
    explorer.manualRefreshCooldownSec = Math.max(
      MIN_CE_COOLDOWN_SEC,
      Number(explorer.manualRefreshCooldownSec) || 0,
    );
    explorer.dailyCallLimit = Math.max(
      1,
      Math.floor(Number(explorer.dailyCallLimit) || 1),
    );
    explorer.callCostUsd = SETTING_DEFAULTS['cost.explorer'].value.callCostUsd;

    const updated = Object.values(rows)
      .map((r) => r.updatedAt)
      .filter((d): d is Date => d instanceof Date);
    return {
      budget: budget,
      spike,
      explorer,
      estimation,
      unallocatedWarnPct: prechecks.unallocatedPct,
      locked,
      updatedAt:
        updated.length > 0
          ? new Date(Math.max(...updated.map((d) => d.getTime())))
          : null,
    };
  }

  /**
   * 부분 갱신. 보낸 블록만 바뀐다.
   * @returns pendingRefresh — metric·태그 필터가 바뀌어 다음 CE 조회부터 반영됨
   */
  async patch(dto: CostSettingsPatchDto): Promise<{ pendingRefresh: boolean }> {
    const cur = await this.get();

    // 1. env 잠금
    const lockedHits: string[] = [];
    const check = (block: keyof CostSettings['locked'], fields: string[]) => {
      for (const f of fields)
        if (cur.locked[block].includes(f)) lockedHits.push(f);
    };
    const sent = (o: object | undefined): string[] =>
      o
        ? Object.entries(o)
            .filter(([, v]) => v !== undefined)
            .map(([k]) => k)
        : [];
    check('budget', sent(dto.budget));
    check('spike', [...sent(dto.spike?.rate), ...sent(dto.spike?.daily)]);
    check('explorer', sent(dto.explorer));
    if (lockedHits.length > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SETTING_LOCKED_BY_ENV',
        `환경 변수로 고정된 설정은 바꿀 수 없습니다: ${lockedHits.join(', ')}`,
        { fields: lockedHits },
      );
    }

    // 2. 저장값(DB) 기준으로 합친 새 값
    const rows = await this.store.getSettings([
      'cost.budget',
      'cost.spike',
      'cost.explorer',
    ]);
    const storedBudget = mergeSetting(
      'cost.budget',
      rows['cost.budget']?.value,
    );
    const storedSpike = mergeSpike(rows['cost.spike']?.value);
    const storedExplorer = mergeSetting(
      'cost.explorer',
      rows['cost.explorer']?.value,
    );
    const defined = <T extends object>(o: T | undefined): Partial<T> =>
      o
        ? (Object.fromEntries(
            Object.entries(o).filter(
              ([k, v]) => v !== undefined && k !== 'callCostUsd',
            ),
          ) as Partial<T>)
        : {};

    const nextBudget = { ...storedBudget, ...defined(dto.budget) };
    const nextSpike = {
      rate: { ...storedSpike.rate, ...defined(dto.spike?.rate) },
      daily: { ...storedSpike.daily, ...defined(dto.spike?.daily) },
    };
    const nextExplorer = {
      ...storedExplorer,
      ...defined(dto.explorer),
    } as ExplorerSettings;

    // 3. 필드 간 규칙 (합친 값 기준)
    const fields: { field: string; value: unknown; constraints: string[] }[] =
      [];
    if (dto.budget && !(nextBudget.warnPct < nextBudget.overPct))
      fields.push({
        field: 'budget.warnPct',
        value: nextBudget.warnPct,
        constraints: ['warnPct must be less than overPct'],
      });
    if (dto.spike?.rate) {
      const r = nextSpike.rate;
      if (!(r.warnRatio < r.critRatio))
        fields.push({
          field: 'spike.rate.warnRatio',
          value: r.warnRatio,
          constraints: ['warnRatio must be less than critRatio'],
        });
      if (!(r.warnAbsUsdPerHour <= r.critAbsUsdPerHour))
        fields.push({
          field: 'spike.rate.warnAbsUsdPerHour',
          value: r.warnAbsUsdPerHour,
          constraints: ['warnAbsUsdPerHour must be <= critAbsUsdPerHour'],
        });
    }
    if (dto.spike?.daily) {
      const d = nextSpike.daily;
      if (!(d.warnRatio < d.critRatio))
        fields.push({
          field: 'spike.daily.warnRatio',
          value: d.warnRatio,
          constraints: ['warnRatio must be less than critRatio'],
        });
      if (!(d.warnAbsUsd <= d.critAbsUsd))
        fields.push({
          field: 'spike.daily.warnAbsUsd',
          value: d.warnAbsUsd,
          constraints: ['warnAbsUsd must be <= critAbsUsd'],
        });
    }
    if (fields.length > 0) throw validationFailed(fields);

    // 4. 저장 (DB 없으면 503, 메모리 값도 바꾸지 않음)
    const writes: [string, unknown][] = [];
    if (dto.budget) writes.push(['cost.budget', nextBudget]);
    if (dto.spike) writes.push(['cost.spike', nextSpike]);
    if (dto.explorer)
      writes.push([
        'cost.explorer',
        { ...nextExplorer, callCostUsd: storedExplorer.callCostUsd },
      ]);
    for (const [key, value] of writes) {
      let ok = false;
      try {
        ok = await this.store.putSetting(
          key,
          value,
          SETTING_DEFAULTS[key as keyof typeof SETTING_DEFAULTS].description,
        );
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'DASHBOARD_DB_UNAVAILABLE',
          '대시보드 DB에 연결되어 있지 않아 설정을 바꿀 수 없습니다.',
        );
      }
    }
    this.invalidate();
    const pendingRefresh =
      dto.explorer !== undefined &&
      ((dto.explorer.metric !== undefined &&
        dto.explorer.metric !== storedExplorer.metric) ||
        (dto.explorer.costAllocationTagFilter !== undefined &&
          JSON.stringify(dto.explorer.costAllocationTagFilter) !==
            JSON.stringify(storedExplorer.costAllocationTagFilter)));
    return { pendingRefresh };
  }
}
