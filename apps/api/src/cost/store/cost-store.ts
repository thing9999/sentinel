/**
 * cost 모듈 영속 계층. 대시보드 자체 DB(Prisma)가 연결돼 있으면 DB, 아니면 프로세스 메모리.
 * (docs/db/schema.md 2.1~2.5, DBA 보고서 9절 사용법)
 * DB 쓰기 실패는 경고만 남기고 메모리 값으로 계속한다.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '../../database/generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { toNumber, utcDayStart, utcMonthStart } from '../cost-util';
import type { DataSource, SampleResource } from '../cost.types';

export type PriceSourceKind = 'pricing_api' | 'spot_price_history';

export interface PriceEntry {
  source: PriceSourceKind;
  region: string;
  productKey: string;
  unit: string;
  usdPerUnit: number | null;
  found: boolean;
  attributes: Record<string, string> | null;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface StoredRateSample {
  sampledAt: Date;
  totalUsdPerHour: number;
  byCategory: {
    ec2: number;
    ebs: number;
    lb: number;
    /** DB 열 control_plane_usd_per_hour (구 eks_usd_per_hour) */
    controlPlane: number;
    ipv4: number;
  };
  nodeCount: number;
  unpricedCount: number;
  resources: SampleResource[];
}

export type CeQueryKind =
  'month_to_date' | 'service_breakdown' | 'daily' | 'last_month' | 'forecast';

export interface CeCacheEntry {
  dataSource: DataSource;
  kind: CeQueryKind;
  requestKey: string;
  request: Record<string, unknown>;
  periodStart: Date;
  periodEnd: Date;
  metric: string;
  status: 'ok' | 'error';
  result: unknown;
  dataThrough: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  fetchedAt: Date;
  expiresAt: Date;
}

export interface CeCallLog {
  calledAt: Date;
  operation: 'GetCostAndUsage' | 'GetCostForecast';
  trigger: 'scheduled' | 'manual' | 'startup';
  requestKey: string;
  success: boolean;
  errorCode: string | null;
  durationMs: number;
  /** 과금되지 않는 실패(권한 없음 등)는 0 */
  estimatedCostUsd: number;
}

export interface CeCallStats {
  todayCalls: number;
  monthCalls: number;
  monthCostUsd: number;
  lastCallAt: Date | null;
  lastBillableAt: Date | null;
  lastManualAt: Date | null;
}

export interface SettingRow {
  value: unknown;
  updatedAt: Date;
}

const MEMORY_SAMPLE_LIMIT = 90 * 288;

@Injectable()
export class CostStore {
  private readonly logger = new Logger(CostStore.name);
  private readonly mem = {
    settings: new Map<string, SettingRow>(),
    prices: new Map<string, PriceEntry>(),
    samples: new Map<DataSource, StoredRateSample[]>(),
    ce: new Map<string, CeCacheEntry>(),
    calls: [] as CeCallLog[],
  };

  constructor(
    @Optional()
    @Inject(PrismaService)
    private readonly prisma?: PrismaService | null,
  ) {}

  get persistence(): 'database' | 'memory' {
    return this.db ? 'database' : 'memory';
  }

  private get db(): PrismaService | null {
    return this.prisma && this.prisma.isConnected ? this.prisma : null;
  }

  private warn(op: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.warn(
      `대시보드 DB ${op} 실패 (메모리로 계속): ${msg.slice(0, 200)}`,
    );
  }

  // ------------------------------------------------------------------ settings

  async getSettings(keys: string[]): Promise<Record<string, SettingRow>> {
    const out: Record<string, SettingRow> = {};
    const db = this.db;
    if (db) {
      try {
        const rows = await db.setting.findMany({
          where: { key: { in: keys } },
        });
        for (const r of rows)
          out[r.key] = { value: r.value, updatedAt: r.updatedAt };
        return out;
      } catch (err) {
        this.warn('설정 조회', err);
      }
    }
    for (const k of keys) {
      const v = this.mem.settings.get(k);
      if (v) out[k] = v;
    }
    return out;
  }

  /** DB가 없으면 false (쓰기 거부 — 계약 6.2 503) */
  async putSetting(
    key: string,
    value: unknown,
    description: string,
  ): Promise<boolean> {
    const db = this.db;
    if (!db) return false;
    await db.setting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, description },
      update: { value: value as Prisma.InputJsonValue },
    });
    return true;
  }

  /** 테스트·mock 전용: 메모리 설정 값 */
  setMemorySetting(key: string, value: unknown, at = new Date()): void {
    this.mem.settings.set(key, { value, updatedAt: at });
  }

  // ------------------------------------------------------------------ price cache

  private priceKey(source: string, region: string, productKey: string): string {
    return `${source}|${region}|${productKey}`;
  }

  async getPrice(
    source: PriceSourceKind,
    region: string,
    productKey: string,
  ): Promise<PriceEntry | null> {
    const db = this.db;
    if (db) {
      try {
        const r = await db.priceCache.findUnique({
          where: { source_region_productKey: { source, region, productKey } },
        });
        if (!r) return null;
        return {
          source: r.source,
          region: r.region,
          productKey: r.productKey,
          unit: r.unit,
          usdPerUnit: toNumber(r.usdPerUnit),
          found: r.found,
          attributes: (r.attributes as Record<string, string> | null) ?? null,
          fetchedAt: r.fetchedAt,
          expiresAt: r.expiresAt,
        };
      } catch (err) {
        this.warn('단가 캐시 조회', err);
      }
    }
    return (
      this.mem.prices.get(this.priceKey(source, region, productKey)) ?? null
    );
  }

  async putPrice(e: PriceEntry): Promise<void> {
    this.mem.prices.set(this.priceKey(e.source, e.region, e.productKey), e);
    const db = this.db;
    if (!db) return;
    const data = {
      unit: e.unit,
      usdPerUnit: e.usdPerUnit,
      found: e.found,
      attributes: (e.attributes ?? undefined) as
        Prisma.InputJsonValue | undefined,
      fetchedAt: e.fetchedAt,
      expiresAt: e.expiresAt,
    };
    try {
      await db.priceCache.upsert({
        where: {
          source_region_productKey: {
            source: e.source,
            region: e.region,
            productKey: e.productKey,
          },
        },
        create: {
          source: e.source,
          region: e.region,
          productKey: e.productKey,
          ...data,
        },
        update: data,
      });
    } catch (err) {
      this.warn('단가 캐시 저장', err);
    }
  }

  // ------------------------------------------------------------------ rate samples

  async saveRateSample(ds: DataSource, s: StoredRateSample): Promise<void> {
    const list = this.mem.samples.get(ds) ?? [];
    const idx = list.findIndex(
      (x) => x.sampledAt.getTime() === s.sampledAt.getTime(),
    );
    if (idx >= 0) list[idx] = s;
    else list.push(s);
    if (list.length > MEMORY_SAMPLE_LIMIT)
      list.splice(0, list.length - MEMORY_SAMPLE_LIMIT);
    this.mem.samples.set(ds, list);
    const db = this.db;
    if (!db) return;
    const data = {
      totalUsdPerHour: s.totalUsdPerHour,
      ec2UsdPerHour: s.byCategory.ec2,
      ebsUsdPerHour: s.byCategory.ebs,
      lbUsdPerHour: s.byCategory.lb,
      controlPlaneUsdPerHour: s.byCategory.controlPlane,
      ipv4UsdPerHour: s.byCategory.ipv4,
      nodeCount: s.nodeCount,
      unpricedCount: s.unpricedCount,
      resources: s.resources as unknown as Prisma.InputJsonValue,
    };
    try {
      await db.costRateSample.upsert({
        where: {
          dataSource_sampledAt: { dataSource: ds, sampledAt: s.sampledAt },
        },
        create: { dataSource: ds, sampledAt: s.sampledAt, ...data },
        update: data,
      });
    } catch (err) {
      this.warn('소모율 기록 저장', err);
    }
  }

  /** 기간 안 표본 (resources 제외, 시간순) */
  async listRateSamples(
    ds: DataSource,
    since: Date,
  ): Promise<{ sampledAt: Date; totalUsdPerHour: number }[]> {
    const db = this.db;
    if (db) {
      try {
        const rows = await db.costRateSample.findMany({
          where: { dataSource: ds, sampledAt: { gte: since } },
          select: { sampledAt: true, totalUsdPerHour: true },
          orderBy: { sampledAt: 'asc' },
        });
        return rows.map((r) => ({
          sampledAt: r.sampledAt,
          totalUsdPerHour: toNumber(r.totalUsdPerHour) ?? 0,
        }));
      } catch (err) {
        this.warn('소모율 기록 조회', err);
      }
    }
    return (this.mem.samples.get(ds) ?? [])
      .filter((s) => s.sampledAt >= since)
      .sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime())
      .map((s) => ({
        sampledAt: s.sampledAt,
        totalUsdPerHour: s.totalUsdPerHour,
      }));
  }

  async getRateSampleResources(
    ds: DataSource,
    sampledAt: Date,
  ): Promise<SampleResource[] | null> {
    const db = this.db;
    if (db) {
      try {
        const r = await db.costRateSample.findUnique({
          where: { dataSource_sampledAt: { dataSource: ds, sampledAt } },
          select: { resources: true },
        });
        return r ? (r.resources as unknown as SampleResource[]) : null;
      } catch (err) {
        this.warn('소모율 기록 조회', err);
      }
    }
    const s = (this.mem.samples.get(ds) ?? []).find(
      (x) => x.sampledAt.getTime() === sampledAt.getTime(),
    );
    return s ? s.resources : null;
  }

  /** mock 시계열 초기화 (메모리만) */
  replaceMemorySamples(ds: DataSource, samples: StoredRateSample[]): void {
    this.mem.samples.set(ds, [...samples]);
  }

  // ------------------------------------------------------------------ CE cache

  async getCeCache(
    ds: DataSource,
    requestKey: string,
  ): Promise<CeCacheEntry | null> {
    const db = this.db;
    if (db) {
      try {
        const r = await db.costExplorerCache.findUnique({
          where: { dataSource_requestKey: { dataSource: ds, requestKey } },
        });
        if (!r) return null;
        return {
          dataSource: r.dataSource,
          kind: r.kind,
          requestKey: r.requestKey,
          request: (r.request ?? {}) as Record<string, unknown>,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          metric: r.metric,
          status: r.status,
          result: r.result,
          dataThrough: r.dataThrough,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          fetchedAt: r.fetchedAt,
          expiresAt: r.expiresAt,
        };
      } catch (err) {
        this.warn('CE 캐시 조회', err);
      }
    }
    return this.mem.ce.get(`${ds}|${requestKey}`) ?? null;
  }

  async putCeCache(e: CeCacheEntry): Promise<void> {
    this.mem.ce.set(`${e.dataSource}|${e.requestKey}`, e);
    const db = this.db;
    if (!db) return;
    const data = {
      kind: e.kind,
      request: e.request as Prisma.InputJsonValue,
      periodStart: e.periodStart,
      periodEnd: e.periodEnd,
      metric: e.metric,
      status: e.status,
      result:
        e.result === null || e.result === undefined
          ? Prisma.DbNull
          : (e.result as Prisma.InputJsonValue),
      dataThrough: e.dataThrough,
      errorCode: e.errorCode,
      errorMessage: e.errorMessage,
      fetchedAt: e.fetchedAt,
      expiresAt: e.expiresAt,
    };
    try {
      await db.costExplorerCache.upsert({
        where: {
          dataSource_requestKey: {
            dataSource: e.dataSource,
            requestKey: e.requestKey,
          },
        },
        create: { dataSource: e.dataSource, requestKey: e.requestKey, ...data },
        update: data,
      });
    } catch (err) {
      this.warn('CE 캐시 저장', err);
    }
  }

  // ------------------------------------------------------------------ CE call log

  async logCeCall(c: CeCallLog): Promise<void> {
    this.mem.calls.push(c);
    if (this.mem.calls.length > 20_000) this.mem.calls.splice(0, 10_000);
    const db = this.db;
    if (!db) return;
    try {
      await db.costExplorerCallLog.create({ data: { ...c } });
    } catch (err) {
      this.warn('CE 호출 기록 저장', err);
    }
  }

  async ceCallStats(now: Date): Promise<CeCallStats> {
    const dayStart = utcDayStart(now);
    const monthStart = utcMonthStart(now);
    const db = this.db;
    if (db) {
      try {
        const [todayCalls, month, last, lastBillable, lastManual] =
          await Promise.all([
            db.costExplorerCallLog.count({
              where: { calledAt: { gte: dayStart } },
            }),
            db.costExplorerCallLog.aggregate({
              where: { calledAt: { gte: monthStart } },
              _count: { _all: true },
              _sum: { estimatedCostUsd: true },
            }),
            db.costExplorerCallLog.findFirst({
              orderBy: { calledAt: 'desc' },
              select: { calledAt: true },
            }),
            db.costExplorerCallLog.findFirst({
              where: { estimatedCostUsd: { gt: 0 } },
              orderBy: { calledAt: 'desc' },
              select: { calledAt: true },
            }),
            db.costExplorerCallLog.findFirst({
              where: { trigger: 'manual' },
              orderBy: { calledAt: 'desc' },
              select: { calledAt: true },
            }),
          ]);
        return {
          todayCalls,
          monthCalls: month._count._all,
          monthCostUsd: toNumber(month._sum.estimatedCostUsd) ?? 0,
          lastCallAt: last?.calledAt ?? null,
          lastBillableAt: lastBillable?.calledAt ?? null,
          lastManualAt: lastManual?.calledAt ?? null,
        };
      } catch (err) {
        this.warn('CE 호출 기록 조회', err);
      }
    }
    const calls = this.mem.calls;
    const latest = (list: CeCallLog[]) =>
      list.reduce<Date | null>(
        (m, c) => (m === null || c.calledAt > m ? c.calledAt : m),
        null,
      );
    const month = calls.filter((c) => c.calledAt >= monthStart);
    return {
      todayCalls: calls.filter((c) => c.calledAt >= dayStart).length,
      monthCalls: month.length,
      monthCostUsd: month.reduce((s, c) => s + c.estimatedCostUsd, 0),
      lastCallAt: latest(calls),
      lastBillableAt: latest(calls.filter((c) => c.estimatedCostUsd > 0)),
      lastManualAt: latest(calls.filter((c) => c.trigger === 'manual')),
    };
  }
}
