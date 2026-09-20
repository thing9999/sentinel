/**
 * 공시 단가(Pricing API, 24시간 캐시)와 스팟 시세(DescribeSpotPriceHistory, 1시간 캐시).
 * 캐시: 프로세스 메모리 → 대시보드 DB `price_cache` → AWS 호출 순.
 * 조회 실패 시 만료된 캐시가 있으면 그 값을 쓰고 `cacheUsed`로 표시한다. 같은 키 동시 조회는 한 번만.
 */
import { Logger } from '@nestjs/common';
import type { CostAwsGateway, PriceListProduct } from '../aws/aws-gateway';
import { classifyAwsError } from '../aws/aws-gateway';
import {
  spotKey,
  type EbsPrice,
  type LbType,
  type PriceBook,
  type PriceQuote,
  type SpotQuote,
} from '../cost.types';
import type {
  CostStore,
  PriceEntry,
  PriceSourceKind,
} from '../store/cost-store';

export interface PriceNeeds {
  instanceTypes: Set<string>;
  /** `${type}|${zone}` */
  spot: Set<string>;
  /** volumeType → 필요한 추가 요소 */
  ebs: Map<string, { iops: boolean; throughput: boolean }>;
  lb: Set<LbType>;
  ipv4: boolean;
  eks: boolean;
}

export function emptyNeeds(): PriceNeeds {
  return {
    instanceTypes: new Set(),
    spot: new Set(),
    ebs: new Map(),
    lb: new Set(),
    ipv4: false,
    eks: false,
  };
}

interface QuoteResult {
  usd: number | null;
  fetchedAt: Date | null;
  cacheUsed: boolean;
  /** 조회 실패(캐시도 없음) */
  failed: boolean;
}

export interface PriceRoundStats {
  pricing: {
    ok: number;
    failed: number;
    lastError: { code: string; message: string } | null;
  };
  spot: {
    ok: number;
    failed: number;
    lastError: { code: string; message: string } | null;
  };
}

const FAILURE_BACKOFF_MS = 5 * 60_000;

export class PriceService {
  private readonly logger = new Logger(PriceService.name);
  private readonly local = new Map<string, PriceEntry>();
  private readonly inflight = new Map<string, Promise<QuoteResult>>();
  private readonly failedUntil = new Map<string, number>();
  private stats: PriceRoundStats = PriceService.emptyStats();

  constructor(
    private readonly store: CostStore,
    private readonly gateway: CostAwsGateway,
    private readonly ttl: () => { pricingSec: number; spotSec: number },
    private readonly now: () => Date = () => new Date(),
  ) {}

  static emptyStats(): PriceRoundStats {
    return {
      pricing: { ok: 0, failed: 0, lastError: null },
      spot: { ok: 0, failed: 0, lastError: null },
    };
  }

  get region(): string {
    return this.gateway.region;
  }

  /** 필요한 단가를 모두 모아 동기 조회용 단가표로 만든다 */
  async resolve(
    needs: PriceNeeds,
  ): Promise<{ book: PriceBook; stats: PriceRoundStats }> {
    this.stats = PriceService.emptyStats();
    const onDemand: PriceBook['onDemand'] = {};
    const spot: PriceBook['spot'] = {};
    const ebs: PriceBook['ebs'] = {};
    const lb: PriceBook['lb'] = {};
    const fetched: Date[] = [];
    let cacheUsed = false;
    let cacheFetchedAt: Date | null = null;
    let pricingOk = 0;
    let pricingTried = 0;

    const toQuote = (q: QuoteResult): PriceQuote | null => {
      pricingTried += 1;
      if (!q.failed) pricingOk += 1;
      if (q.usd === null || q.fetchedAt === null) return null;
      fetched.push(q.fetchedAt);
      if (q.cacheUsed) {
        cacheUsed = true;
        if (!cacheFetchedAt || q.fetchedAt < cacheFetchedAt)
          cacheFetchedAt = q.fetchedAt;
      }
      return {
        usd: q.usd,
        fetchedAt: q.fetchedAt.toISOString(),
        cacheUsed: q.cacheUsed,
      };
    };

    await Promise.all(
      [...needs.instanceTypes].map(async (t) => {
        onDemand[t] = toQuote(await this.onDemandQuote(t));
      }),
    );
    let spotFetchedAt: Date | null = null;
    await Promise.all(
      [...needs.spot].map(async (k) => {
        const [type, zone] = k.split('|');
        const q = await this.spotQuote(type, zone);
        if (q.usd !== null && q.fetchedAt) {
          spot[spotKey(type, zone)] = {
            usd: q.usd,
            fetchedAt: q.fetchedAt.toISOString(),
            zone,
          } satisfies SpotQuote;
          if (!spotFetchedAt || q.fetchedAt > spotFetchedAt)
            spotFetchedAt = q.fetchedAt;
        } else {
          spot[spotKey(type, zone)] = null;
        }
      }),
    );
    await Promise.all(
      [...needs.ebs.entries()].map(async ([vt, extra]) => {
        const price: EbsPrice = {
          storage: toQuote(await this.ebsQuote(vt, 'storage')),
          iops: extra.iops ? toQuote(await this.ebsQuote(vt, 'iops')) : null,
          throughput: extra.throughput
            ? toQuote(await this.ebsQuote(vt, 'throughput'))
            : null,
        };
        ebs[vt] = price;
      }),
    );
    await Promise.all(
      [...needs.lb].map(async (t) => {
        lb[t] = toQuote(await this.lbQuote(t));
      }),
    );
    const ipv4 = needs.ipv4 ? toQuote(await this.ipv4Quote()) : null;
    const eks = needs.eks
      ? {
          standard: toQuote(await this.eksQuote('standard')),
          extended: toQuote(await this.eksQuote('extended')),
        }
      : { standard: null, extended: null };

    const oldest = fetched.length
      ? new Date(Math.min(...fetched.map((d) => d.getTime())))
      : null;
    const book: PriceBook = {
      onDemand,
      spot,
      ebs,
      lb,
      ipv4,
      eks,
      meta: {
        fetchedAt: oldest ? oldest.toISOString() : null,
        cacheUsed,
        cacheFetchedAt: cacheFetchedAt
          ? (cacheFetchedAt as Date).toISOString()
          : null,
        allFailed: pricingTried > 0 && pricingOk === 0,
        spotFetchedAt: spotFetchedAt
          ? (spotFetchedAt as Date).toISOString()
          : null,
      },
    };
    return { book, stats: this.stats };
  }

  // ------------------------------------------------------------------ 개별 단가

  onDemandQuote(instanceType: string): Promise<QuoteResult> {
    return this.quote(
      'pricing_api',
      `ec2:${instanceType}:linux:shared`,
      'Hrs',
      async () =>
        pickHourly(
          await this.gateway.getProducts('AmazonEC2', {
            instanceType,
            regionCode: this.region,
            operatingSystem: 'Linux',
            tenancy: 'Shared',
            preInstalledSw: 'NA',
            capacitystatus: 'Used',
            licenseModel: 'No License required',
          }),
        ),
    );
  }

  spotQuote(instanceType: string, zone: string): Promise<QuoteResult> {
    return this.quote(
      'spot_price_history',
      `spot:${instanceType}:${zone}`,
      'Hrs',
      async () => {
        const r = await this.gateway.getLatestSpotPrice(instanceType, zone);
        return r ? r.usdPerHour : null;
      },
    );
  }

  ebsQuote(
    volumeType: string,
    part: 'storage' | 'iops' | 'throughput',
  ): Promise<QuoteResult> {
    const family =
      part === 'storage'
        ? 'Storage'
        : part === 'iops'
          ? 'System Operation'
          : 'Provisioned Throughput';
    const unit =
      part === 'storage' ? 'GB-Mo' : part === 'iops' ? 'IOPS-Mo' : 'MiBps-Mo';
    return this.quote(
      'pricing_api',
      `ebs:${volumeType}:${part}`,
      unit,
      async () => {
        const products = await this.gateway.getProducts('AmazonEC2', {
          productFamily: family,
          volumeApiName: volumeType,
          regionCode: this.region,
        });
        const dims = products
          .flatMap((p) => p.onDemand)
          .filter((d) => d.usd > 0);
        if (dims.length === 0) return null;
        // io2 등 구간 요금은 첫 구간(가장 비싼 기본 단가)을 쓴다
        const d = dims.sort((a, b) => b.usd - a.usd)[0];
        if (part === 'throughput' && /gib/i.test(d.unit)) return d.usd / 1024;
        return d.usd;
      },
    );
  }

  lbQuote(type: LbType): Promise<QuoteResult> {
    const family =
      type === 'alb'
        ? 'Load Balancer-Application'
        : type === 'nlb'
          ? 'Load Balancer-Network'
          : 'Load Balancer';
    return this.quote('pricing_api', `elb:${type}`, 'Hrs', async () => {
      const products = await this.gateway.getProducts('AWSELB', {
        productFamily: family,
        regionCode: this.region,
      });
      const hourly = products.filter((p) =>
        /LoadBalancerUsage$/.test(p.attributes.usagetype ?? ''),
      );
      return pickHourly(hourly.length > 0 ? hourly : products);
    });
  }

  ipv4Quote(): Promise<QuoteResult> {
    return this.quote(
      'pricing_api',
      'vpc:public-ipv4:in-use',
      'Hrs',
      async () => {
        const products = await this.gateway.getProducts(
          'AmazonVPC',
          { regionCode: this.region },
          5,
        );
        return pickHourly(
          products.filter((p) =>
            /PublicIPv4:InUseAddress/i.test(p.attributes.usagetype ?? ''),
          ),
        );
      },
    );
  }

  eksQuote(tier: 'standard' | 'extended'): Promise<QuoteResult> {
    const re =
      tier === 'standard'
        ? /AmazonEKS-Hours:perCluster$/i
        : /AmazonEKS-Hours:extendedSupport$/i;
    return this.quote('pricing_api', `eks:${tier}`, 'Hrs', async () => {
      const products = await this.gateway.getProducts(
        'AmazonEKS',
        { regionCode: this.region },
        5,
      );
      return pickHourly(
        products.filter((p) => re.test(p.attributes.usagetype ?? '')),
      );
    });
  }

  // ------------------------------------------------------------------ 캐시

  private async quote(
    source: PriceSourceKind,
    productKey: string,
    unit: string,
    fetcher: () => Promise<number | null>,
  ): Promise<QuoteResult> {
    const k = `${source}|${productKey}`;
    const running = this.inflight.get(k);
    if (running) return running;
    const p = this.quoteInner(source, productKey, unit, fetcher).finally(() =>
      this.inflight.delete(k),
    );
    this.inflight.set(k, p);
    return p;
  }

  private async quoteInner(
    source: PriceSourceKind,
    productKey: string,
    unit: string,
    fetcher: () => Promise<number | null>,
  ): Promise<QuoteResult> {
    const k = `${source}|${productKey}`;
    const now = this.now();
    const stat =
      source === 'pricing_api' ? this.stats.pricing : this.stats.spot;
    let entry = this.local.get(k) ?? null;
    if (!entry || entry.expiresAt <= now) {
      const fromDb = await this.store.getPrice(source, this.region, productKey);
      if (fromDb && (!entry || fromDb.fetchedAt > entry.fetchedAt)) {
        entry = fromDb;
        this.local.set(k, fromDb);
      }
    }
    if (entry && entry.expiresAt > now) {
      stat.ok += 1;
      return {
        usd: entry.found ? entry.usdPerUnit : null,
        fetchedAt: entry.fetchedAt,
        cacheUsed: false,
        failed: false,
      };
    }
    const backoff = this.failedUntil.get(k);
    if (backoff === undefined || backoff <= now.getTime()) {
      try {
        const usd = await fetcher();
        const ttlSec =
          source === 'pricing_api' ? this.ttl().pricingSec : this.ttl().spotSec;
        const fresh: PriceEntry = {
          source,
          region: this.region,
          productKey,
          unit,
          usdPerUnit: usd,
          found: usd !== null,
          attributes: null,
          fetchedAt: now,
          expiresAt: new Date(now.getTime() + ttlSec * 1000),
        };
        this.local.set(k, fresh);
        await this.store.putPrice(fresh);
        this.failedUntil.delete(k);
        stat.ok += 1;
        return { usd, fetchedAt: now, cacheUsed: false, failed: false };
      } catch (err) {
        const info = classifyAwsError(err);
        stat.lastError = { code: info.awsCode, message: info.message };
        this.failedUntil.set(k, now.getTime() + FAILURE_BACKOFF_MS);
        this.logger.warn(`단가 조회 실패 ${productKey}: ${info.awsCode}`);
      }
    }
    stat.failed += 1;
    if (entry && entry.found && entry.usdPerUnit !== null) {
      return {
        usd: entry.usdPerUnit,
        fetchedAt: entry.fetchedAt,
        cacheUsed: true,
        failed: false,
      };
    }
    return { usd: null, fetchedAt: null, cacheUsed: false, failed: true };
  }
}

/** 시간 단위 온디맨드 가격 하나 (0보다 큰 첫 값) */
export function pickHourly(products: PriceListProduct[]): number | null {
  for (const p of products)
    for (const d of p.onDemand)
      if (/^hrs?$/i.test(d.unit) && d.usd > 0) return d.usd;
  return null;
}
