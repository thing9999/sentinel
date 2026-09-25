/**
 * cost 테스트 도우미 (spec 전용). 가짜 AWS 게이트웨이는 호출 수를 센다.
 */
import type {
  CostAndUsageRequest,
  CostAwsGateway,
  CostForecastRequest,
  CostForecastResponse,
  PriceListProduct,
} from './aws/aws-gateway';
import type { ClusterInventorySnapshot } from './cluster-inventory.port';
import type {
  AwsInstance,
  AwsLoadBalancer,
  AwsResourceSnapshot,
  AwsVolume,
  PriceBook,
  PriceQuote,
} from './cost.types';
import type { CauPage } from './explorer/ce-normalize';

export type GatewayCounts = Record<
  keyof Omit<CostAwsGateway, 'region'>,
  number
>;

export class FakeGateway implements CostAwsGateway {
  readonly region = 'ap-northeast-2';
  readonly calls: GatewayCounts = {
    describeInstances: 0,
    describeVolumes: 0,
    describeLoadBalancers: 0,
    getProducts: 0,
    getLatestSpotPrice: 0,
    getCostAndUsagePage: 0,
    getCostForecast: 0,
  };
  instances: AwsInstance[] = [];
  volumes: AwsVolume[] = [];
  lbs: AwsLoadBalancer[] = [];
  products: (
    serviceCode: string,
    filters: Record<string, string>,
  ) => PriceListProduct[] = () => [];
  spot: (type: string, zone: string) => number | null = () => null;
  cau: (req: CostAndUsageRequest) => CauPage = () => ({
    days: [],
    nextPageToken: null,
  });
  forecast: (req: CostForecastRequest) => CostForecastResponse = () => ({
    totalUsd: 0,
    days: [],
  });
  /** 설정하면 해당 메서드가 이 오류를 던진다 */
  fail: Partial<Record<keyof GatewayCounts, Error>> = {};
  /** CE 호출을 지연시키는 약속 (동시성 테스트) */
  ceGate: Promise<void> | null = null;

  total(): number {
    return Object.values(this.calls).reduce((s, n) => s + n, 0);
  }

  ceCalls(): number {
    return this.calls.getCostAndUsagePage + this.calls.getCostForecast;
  }

  private hit(k: keyof GatewayCounts): void {
    this.calls[k] += 1;
    if (this.fail[k] !== undefined) throw this.fail[k];
  }

  describeInstances(): Promise<AwsInstance[]> {
    this.hit('describeInstances');
    return Promise.resolve(this.instances);
  }
  describeVolumes(): Promise<AwsVolume[]> {
    this.hit('describeVolumes');
    return Promise.resolve(this.volumes);
  }
  describeLoadBalancers(): Promise<AwsLoadBalancer[]> {
    this.hit('describeLoadBalancers');
    return Promise.resolve(this.lbs);
  }
  getProducts(
    serviceCode: string,
    filters: Record<string, string>,
  ): Promise<PriceListProduct[]> {
    this.hit('getProducts');
    return Promise.resolve(this.products(serviceCode, filters));
  }
  getLatestSpotPrice(
    type: string,
    zone: string,
  ): Promise<{ usdPerHour: number; timestamp: Date } | null> {
    this.hit('getLatestSpotPrice');
    const v = this.spot(type, zone);
    return Promise.resolve(
      v === null ? null : { usdPerHour: v, timestamp: new Date() },
    );
  }
  async getCostAndUsagePage(req: CostAndUsageRequest): Promise<CauPage> {
    this.calls.getCostAndUsagePage += 1;
    if (this.ceGate) await this.ceGate;
    if (this.fail.getCostAndUsagePage !== undefined)
      throw this.fail.getCostAndUsagePage;
    return this.cau(req);
  }
  async getCostForecast(
    req: CostForecastRequest,
  ): Promise<CostForecastResponse> {
    this.calls.getCostForecast += 1;
    if (this.ceGate) await this.ceGate;
    if (this.fail.getCostForecast !== undefined)
      throw this.fail.getCostForecast;
    return this.forecast(req);
  }
}

export function awsError(name: string, message = name): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

export function quote(
  usd: number,
  at = '2026-09-18T18:00:00.000Z',
): PriceQuote {
  return { usd, fetchedAt: at, cacheUsed: false };
}

export function priceBook(p: Partial<PriceBook> = {}): PriceBook {
  return {
    onDemand: {},
    spot: {},
    ebs: {},
    lb: {},
    ipv4: null,
    meta: {
      fetchedAt: null,
      cacheUsed: false,
      cacheFetchedAt: null,
      allFailed: false,
      spotFetchedAt: null,
    },
    ...p,
  };
}

export function inventory(
  p: Partial<ClusterInventorySnapshot> = {},
): ClusterInventorySnapshot {
  return {
    state: 'ok',
    updatedAt: new Date(),
    nodes: [],
    pods: [],
    pvcs: [],
    loadBalancers: [],
    ...p,
  };
}

export function awsSnapshot(
  p: Partial<AwsResourceSnapshot> = {},
): AwsResourceSnapshot {
  return {
    fetchedAt: new Date(),
    instances: [],
    volumes: [],
    loadBalancers: [],
    ...p,
  };
}

export function instance(
  p: Partial<AwsInstance> & { instanceId: string; instanceType: string },
): AwsInstance {
  return {
    zone: 'ap-northeast-2a',
    lifecycle: 'on_demand',
    architecture: 'amd64',
    publicIpv4Count: 0,
    rootVolumeIds: [],
    nodeGroupTag: null,
    ...p,
  };
}
