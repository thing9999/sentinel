/**
 * aws-cost 오케스트레이터. 상태를 메모리에 들고 REST·SSE·어드바이저·개요에 같은 값을 준다.
 *
 * - 요청(GET)은 AWS를 부르지 않는다. 주기 작업만 부른다.
 *   · 리소스 목록 5분(+ 인벤토리 변경 10초 debounce, 최소 간격 30초), 단가 캐시 24시간, 스팟 1시간
 *   · 소모율 기록 5분, CE 캐시 확인 5분(만료됐을 때만 호출)
 * - mock: AWS 호출 0회. 시나리오별 가짜 세계(mock/mock-world.ts)로 같은 계산 코드를 돌린다.
 * - live + AWS 설정 없음: 계약대로 unknown (`AWS_NOT_CONFIGURED`). mock으로 바꾸지 않는다.
 */
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { Subject, Subscription, debounceTime, type Observable } from 'rxjs';
import { ApiException } from '../common/api-error';
import type { TopicEvent } from '../common/extension-points';
import {
  SourceRegistry,
  type SourceId,
} from '../common/source-registry.service';
import {
  StatusChangeTracker,
  sortReasons,
  worstStatus,
  reason as mkReason,
  type Reason,
  type Status,
  type StatusInfo,
} from '../common/status';
import {
  COST_AWS_GATEWAY,
  classifyAwsError,
  type CostAwsGateway,
} from './aws/aws-gateway';
import {
  CLUSTER_INVENTORY_PORT,
  k8sMinorVersion,
  type ClusterInventoryPort,
  type ClusterInventorySnapshot,
} from './cluster-inventory.port';
import { COST_CLOCK, COST_OPTIONS, type CostOptions } from './cost.options';
import {
  type AllocationComputation,
  type AwsResourceSnapshot,
  type CeDailyResult,
  type CeEntry,
  type CeForecastResult,
  type EstimateComputation,
  type EstimateView,
  type Money,
  type PriceBook,
  type RateBaseline,
  type RateSample,
  type RefreshView,
  type SampleResource,
  type SpikeCause,
  type Unavailable,
} from './cost.types';
import { floorTo, r6 } from './cost-util';
import {
  RATE_RANGES,
  type AllocationQueryDto,
  type CostSettingsPatchDto,
  type RateRange,
} from './dto/cost.dto';
import {
  computeAllocation,
  presentAllocation,
  type AllocationSort,
} from './estimate/allocation';
import {
  eksSupportTier,
  gravitonEquivalent,
  smallerSize,
} from './estimate/eks-support';
import {
  computeEstimate,
  emptyPriceBook,
  priceNeedsOf,
} from './estimate/estimator';
import {
  summarizeActual,
  summarizeForecast,
  type ActualSummary,
  type ForecastSummary,
} from './explorer/ce-normalize';
import {
  CALLS_PER_REFRESH,
  CostExplorerService,
  MAX_CALLS_PER_REFRESH,
  refreshEstimatedCostUsd,
  type CeState,
} from './explorer/cost-explorer.service';
import {
  COST_SCENARIOS,
  DEFAULT_COST_SCENARIO,
  MOCK_CLUSTER_NAME,
  MOCK_ON_DEMAND,
  buildMockWorld,
  mockBudgetUsd,
  mockCeDaily,
  mockCeErrors,
  mockCeFetchedAt,
  mockCeForecast,
  mockPriceBook,
  mockRateHistory,
  mockSpotPrice,
  type CostScenario,
  type MockWorld,
} from './mock/mock-world';
import { PriceService, emptyNeeds } from './pricing/price.service';
import {
  CostSettingsService,
  type CostSettings,
} from './settings/cost-settings.service';
import {
  computeRateBaseline,
  computeSpikeCauses,
  estimateMonthEnd,
  evaluateBudget,
  evaluateDailySpike,
  evaluateRateSpike,
  pickCausesBaseline,
  type BudgetEvaluation,
  type DailySpikeEvaluation,
  type RateSpikeEvaluation,
} from './status/cost-status';
import { CostStore } from './store/cost-store';

const CE_CHECK_MS = 5 * 60_000;
const MIN_REFRESH_GAP_MS = 30_000;
const ESTIMATE_HEARTBEAT_MS = 15 * 60_000;
const MOCK_ESTIMATE_MS = 60_000;

interface EstimateState {
  available: boolean;
  unavailable: Unavailable | null;
  comp: EstimateComputation | null;
  allocation: AllocationComputation | null;
  allocationUnavailable: Unavailable | null;
  computedAt: Date | null;
  resourcesFetchedAt: Date | null;
  prices: PriceBook['meta'] | null;
  intervalSec: number;
}

interface Derived {
  at: Date;
  estimate: EstimateView;
  summary: Record<string, unknown>;
  status: Record<string, unknown>;
  actual: Record<string, unknown>;
  allocation: Record<string, unknown>;
  baseline: RateBaseline;
  budget: BudgetEvaluation;
  statusKey: string;
  actualSummary: ActualSummary | null;
  forecastSummary: ForecastSummary | null;
}

const emptyEstimate = (
  intervalSec: number,
  u: Unavailable | null,
): EstimateState => ({
  available: false,
  unavailable: u,
  comp: null,
  allocation: null,
  allocationUnavailable: u,
  computedAt: null,
  resourcesFetchedAt: null,
  prices: null,
  intervalSec,
});

const AWS_NOT_CONFIGURED: Unavailable = {
  code: 'AWS_NOT_CONFIGURED',
  message: 'AWS 자격 증명 없음',
};
const SYNCING: Unavailable = {
  code: 'SOURCE_SYNCING',
  message: '최초 조회 중',
};

@Injectable()
export class CostService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CostService.name);
  readonly mode: 'mock' | 'live';
  private scenario: CostScenario = DEFAULT_COST_SCENARIO;
  /** mock: 마지막으로 쓸 수 있었던 클러스터 인벤토리 (AWS 쪽 가짜 리소스의 기준) */
  private lastMockBase: ClusterInventorySnapshot | null = null;
  private mockSamples: RateSample[] = [];
  private mockBaselineResources: SampleResource[] = [];

  private readonly ce: CostExplorerService | null;
  private readonly prices: PriceService | null;
  private estimate: EstimateState;
  private lastAws: AwsResourceSnapshot | null = null;
  private derived: Derived | null = null;
  private readonly tracker = new StatusChangeTracker();
  private readonly eventsSubject = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.eventsSubject.asObservable();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly subs: Subscription[] = [];
  private refreshing: Promise<void> | null = null;
  private lastRefreshAt = 0;
  private lastEstimateEmit = { at: 0, total: -1, keys: '' };
  private lastDay = '';
  private readonly now: () => Date;

  constructor(
    @Inject(COST_OPTIONS) private readonly options: CostOptions,
    private readonly store: CostStore,
    private readonly settings: CostSettingsService,
    @Inject(CLUSTER_INVENTORY_PORT)
    private readonly inventory: ClusterInventoryPort,
    @Optional()
    @Inject(COST_AWS_GATEWAY)
    private readonly gateway: CostAwsGateway | null = null,
    @Optional()
    @Inject(SourceRegistry)
    private readonly sources: SourceRegistry | null = null,
    @Optional() @Inject(COST_CLOCK) clock: (() => Date) | null = null,
  ) {
    this.now = clock ?? (() => new Date());
    this.mode = options.dataSource;
    const s = settings.current();
    this.estimate = emptyEstimate(s.estimation.resourceRefreshSec, SYNCING);
    if (this.mode === 'mock') {
      this.ce = null;
      this.prices = null;
      this.rebuildMock();
    } else {
      const gw = this.gateway ?? null;
      this.ce = new CostExplorerService(
        store,
        gw,
        async () => (await settings.get()).explorer,
        () => this.now(),
      );
      this.prices = gw
        ? new PriceService(
            store,
            gw,
            () => ({
              pricingSec: settings.current().estimation.pricingCacheTtlSec,
              spotSec: settings.current().estimation.spotPriceCacheTtlSec,
            }),
            () => this.now(),
          )
        : null;
      if (!gw)
        this.estimate = emptyEstimate(
          s.estimation.resourceRefreshSec,
          AWS_NOT_CONFIGURED,
        );
    }
  }

  // =================================================================== 생명주기

  onApplicationBootstrap(): void {
    void this.start();
  }

  /** 초기 계산 + (옵션) 주기 작업 */
  async start(): Promise<void> {
    await this.settings.get().catch(() => undefined);
    if (this.mode === 'mock') {
      // 생성자 시점에는 cluster mock이 아직 채워지지 않았을 수 있어 여기서 다시 만든다
      if (this.inventory.backedByCluster) this.rebuildMock();
      await this.recompute();
      if (this.options.timers) {
        if (this.inventory.changes$) {
          // cluster mock 시나리오가 바뀌면 (노드·PVC·LB 변경) 비용 mock 세계도 다시 만든다
          this.subs.push(
            this.inventory.changes$.pipe(debounceTime(1_000)).subscribe(() => {
              this.onMockInventoryChange().catch((e) =>
                this.logger.warn(`mock 인벤토리 반영 실패: ${String(e)}`),
              );
            }),
          );
        }
        this.every(MOCK_ESTIMATE_MS, () => this.mockTick());
        this.every(
          this.settings.current().estimation.rateSampleIntervalSec * 1000,
          () => this.recordSample(),
        );
      }
      return;
    }
    this.markNotConfiguredSources();
    if (this.ce) {
      this.subs.push(
        this.ce.changes$.subscribe((what) => {
          void this.onCeChange(what);
        }),
      );
      await this.ce
        .load()
        .catch((e) => this.logger.warn(`CE 캐시 읽기 실패: ${String(e)}`));
    }
    await this.refreshEstimate();
    if (!this.options.timers) return;
    const est = this.settings.current().estimation;
    this.every(est.resourceRefreshSec * 1000, () => this.refreshEstimate());
    this.every(est.rateSampleIntervalSec * 1000, () => this.recordSample());
    this.every(CE_CHECK_MS, () => this.ceTick());
    void this.ceTick();
    if (this.inventory.changes$) {
      this.subs.push(
        this.inventory.changes$.pipe(debounceTime(10_000)).subscribe(() => {
          if (Date.now() - this.lastRefreshAt >= MIN_REFRESH_GAP_MS)
            void this.refreshEstimate();
        }),
      );
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
    for (const s of this.subs) s.unsubscribe();
    this.eventsSubject.complete();
  }

  private every(ms: number, fn: () => Promise<unknown> | void): void {
    const t = setInterval(() => {
      Promise.resolve(fn()).catch((e) =>
        this.logger.warn(`주기 작업 실패: ${String(e)}`),
      );
    }, ms);
    t.unref?.();
    this.timers.push(t);
  }

  private emit(event: string, data: unknown): void {
    this.eventsSubject.next({ event, data });
  }

  // =================================================================== mock

  get scenarios(): readonly string[] {
    return COST_SCENARIOS;
  }

  currentScenario(): string {
    return this.scenario;
  }

  setScenario(name: string): void {
    if (!(COST_SCENARIOS as readonly string[]).includes(name)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `알 수 없는 비용 시나리오: ${name}`,
        {
          fields: [
            {
              field: 'scenario',
              value: name,
              constraints: [
                `scenario must be one of: ${COST_SCENARIOS.join(', ')}`,
              ],
            },
          ],
        },
      );
    }
    if (this.mode !== 'mock') return;
    this.scenario = name as CostScenario;
    this.rebuildMock();
    this.tracker.clear();
    this.lastEstimateEmit = { at: 0, total: -1, keys: '' };
    void this.recompute().then(async () => {
      this.emit('cost.snapshot', await this.snapshotPayload());
    });
  }

  /**
   * mock 세계를 만든다.
   * - 포트가 클러스터에 연결돼 있으면(backedByCluster) cluster mock 인벤토리를 기준으로 → 클러스터 화면과 노드·파드 일치.
   *   인벤토리를 쓸 수 없을 때(cluster 시나리오 no-cluster 등)는 AWS 쪽을 마지막 인벤토리(없으면 자체 세계)로 만들고
   *   인벤토리는 그 상태를 그대로 넘긴다 → live와 같이 EC2는 AWS 목록으로 추정, 배분은 unknown.
   * - 연결이 없으면(단위 테스트) 자체 인벤토리.
   */
  private buildWorld(scenario: CostScenario, now: Date): MockWorld {
    if (!this.inventory.backedByCluster) {
      const own = buildMockWorld(scenario, now);
      own.inventory.updatedAt = now;
      return own;
    }
    const inv = this.inventory.snapshot();
    const usable = inv.state === 'ok' || inv.state === 'stale';
    if (usable) this.lastMockBase = inv;
    const world = buildMockWorld(scenario, now, this.lastMockBase);
    if (!usable) world.inventory = inv;
    return world;
  }

  /** mock: cluster 시나리오 전환 등으로 인벤토리가 바뀌면 다시 계산하고 전체 스냅샷을 보낸다 (common.md 6) */
  private async onMockInventoryChange(): Promise<void> {
    this.computeMockEstimate(this.now());
    await this.recompute();
    this.lastEstimateEmit = { at: 0, total: -1, keys: '' };
    this.emit('cost.snapshot', await this.snapshotPayload());
  }

  private rebuildMock(): void {
    const now = this.now();
    this.computeMockEstimate(now);
    // 기준 소모율: 정상 세계의 현재 값 (급증 시나리오는 지금만 올라간 상태)
    const normal = this.buildWorld('normal', now);
    const normalComp = computeEstimate({
      inventory: normal.inventory,
      aws: normal.aws,
      prices: mockPriceBook('normal', normal, now),
      hoursPerMonth: this.settings.current().estimation.hoursPerMonth,
      eksSupportTier: eksSupportTier(normal.aws.eks?.version ?? null, now),
      clusterName: MOCK_CLUSTER_NAME,
    });
    this.mockBaselineResources = normalComp.sampleResources;
    this.mockSamples = mockRateHistory(
      this.scenario,
      normalComp.total.usdPerHour,
      now,
    );
  }

  private computeMockEstimate(now: Date): void {
    const world = this.buildWorld(this.scenario, now);
    const invUsable =
      world.inventory.state === 'ok' || world.inventory.state === 'stale';
    const hpm = this.settings.current().estimation.hoursPerMonth;
    const book = mockPriceBook(this.scenario, world, now);
    const comp = computeEstimate({
      inventory: world.inventory,
      aws: { ...world.aws, fetchedAt: floorTo(now, 300) },
      prices: book,
      hoursPerMonth: hpm,
      eksSupportTier: eksSupportTier(world.aws.eks?.version ?? null, now),
      clusterName: MOCK_CLUSTER_NAME,
    });
    this.estimate = {
      available: true,
      unavailable: null,
      comp,
      allocation: invUsable
        ? computeAllocation(comp, world.inventory, hpm)
        : null,
      allocationUnavailable: invUsable
        ? null
        : world.inventory.state === 'syncing'
          ? { code: 'SOURCE_SYNCING', message: '클러스터 최초 동기화 중' }
          : {
              code: 'SOURCE_NOT_CONFIGURED',
              message: '클러스터 연결 없음 (네임스페이스 배분 불가)',
            },
      computedAt: now,
      resourcesFetchedAt: floorTo(now, 300),
      prices: book.meta,
      intervalSec: MOCK_ESTIMATE_MS / 1000,
    };
  }

  private async mockTick(): Promise<void> {
    this.computeMockEstimate(this.now());
    await this.recompute();
    this.maybeEmitEstimate();
  }

  /** mock 시계열·시나리오 초기화 (POST /api/mock/reset) */
  resetMock(): void {
    this.setScenario(DEFAULT_COST_SCENARIO);
  }

  // =================================================================== live: 추정

  private markNotConfiguredSources(): void {
    if (!this.sources || this.mode !== 'live') return;
    const est = this.settings.current().estimation;
    const set = (id: SourceId, interval: number) =>
      this.sources!.update(id, {
        state: this.gateway ? 'syncing' : 'not_configured',
        intervalSec: interval,
      });
    set('awsResources', est.resourceRefreshSec);
    set('pricing', est.pricingCacheTtlSec);
    set('spotPrice', est.spotPriceCacheTtlSec);
    set('costExplorer', this.settings.current().explorer.cacheTtlSec);
  }

  /** 리소스 목록·단가를 모아 추정·배분을 다시 계산한다 (동시 1건) */
  async refreshEstimate(): Promise<void> {
    if (this.mode === 'mock') {
      await this.mockTick();
      return;
    }
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshEstimateInner().finally(() => {
      this.refreshing = null;
      this.lastRefreshAt = Date.now();
    });
    return this.refreshing;
  }

  private async refreshEstimateInner(): Promise<void> {
    const s = await this.settings.get();
    const now = this.now();
    const intervalSec = s.estimation.resourceRefreshSec;
    if (!this.gateway || !this.prices) {
      this.estimate = emptyEstimate(intervalSec, AWS_NOT_CONFIGURED);
      await this.recompute();
      return;
    }
    const inv = this.inventory.snapshot();
    let aws: AwsResourceSnapshot;
    try {
      aws = await this.fetchAwsResources(inv, now);
      this.lastAws = aws;
      this.sources?.markSuccess('awsResources', now.toISOString());
    } catch (err) {
      const u = awsUnavailable(err);
      this.sources?.markFailure(
        'awsResources',
        { code: u.code, message: u.message },
        {
          state: u.code === 'AWS_NOT_CONFIGURED' ? 'not_configured' : undefined,
          at: now.toISOString(),
        },
      );
      if (!this.estimate.comp) {
        this.estimate = emptyEstimate(intervalSec, u);
      }
      await this.recompute();
      this.emitEstimate();
      return;
    }

    const clusterName = this.options.clusterName;
    const tier = eksSupportTier(aws.eks?.version ?? null, now);
    const base = {
      inventory: inv,
      aws,
      hoursPerMonth: s.estimation.hoursPerMonth,
      eksSupportTier: tier,
      clusterName,
    };
    const dry = computeEstimate({ ...base, prices: emptyPriceBook() });
    const list = priceNeedsOf(dry);
    const needs = emptyNeeds();
    list.instanceTypes.forEach((t) => needs.instanceTypes.add(t));
    list.spot.forEach((x) => needs.spot.add(`${x.type}|${x.zone}`));
    list.ebs.forEach((e) =>
      needs.ebs.set(e.volumeType, { iops: e.iops, throughput: e.throughput }),
    );
    list.lb.forEach((l) => needs.lb.add(l));
    needs.ipv4 = list.ipv4;
    needs.eks = list.eks;
    const { book, stats } = await this.prices.resolve(needs);
    this.updatePriceSources(stats, now);
    if (book.meta.allFailed) {
      if (!this.estimate.comp)
        this.estimate = emptyEstimate(intervalSec, {
          code: 'PRICING_UNAVAILABLE',
          message: '단가 조회 실패',
        });
      await this.recompute();
      this.emitEstimate();
      return;
    }
    // 단가 조회 중 tier에 맞는 EKS 단가를 쓰도록 다시 계산
    const comp = computeEstimate({ ...base, prices: book });
    const invUsable = inv.state === 'ok' || inv.state === 'stale';
    this.estimate = {
      available: true,
      unavailable: null,
      comp,
      allocation: invUsable
        ? computeAllocation(comp, inv, s.estimation.hoursPerMonth)
        : null,
      allocationUnavailable: invUsable
        ? null
        : inv.state === 'syncing'
          ? { code: 'SOURCE_SYNCING', message: '클러스터 최초 동기화 중' }
          : {
              code: 'SOURCE_NOT_CONFIGURED',
              message: '클러스터 연결 없음 (네임스페이스 배분 불가)',
            },
      computedAt: now,
      resourcesFetchedAt: aws.fetchedAt,
      prices: book.meta,
      intervalSec,
    };
    await this.recompute();
    this.maybeEmitEstimate();
  }

  private async fetchAwsResources(
    inv: ClusterInventorySnapshot,
    now: Date,
  ): Promise<AwsResourceSnapshot> {
    const gw = this.gateway!;
    const usable = inv.state === 'ok' || inv.state === 'stale';
    const ids = usable
      ? inv.nodes
          .map((n) => /\/(i-[0-9a-f]+)$/i.exec(n.providerId ?? '')?.[1])
          .filter((x): x is string => Boolean(x))
      : [];
    const instances = usable
      ? ids.length > 0
        ? await gw.describeInstances({ instanceIds: ids })
        : []
      : await gw.describeInstances({ clusterName: this.options.clusterName });
    const volumes = await gw.describeVolumes({
      attachedInstanceIds: instances.map((i) => i.instanceId),
    });
    // LB·EKS 실패는 치명적이지 않다: 이전 값 유지
    let loadBalancers = this.lastAws?.loadBalancers ?? [];
    try {
      loadBalancers = await gw.describeLoadBalancers();
    } catch (err) {
      this.logger.warn(
        `로드밸런서 조회 실패: ${classifyAwsError(err).awsCode}`,
      );
    }
    let eks = this.lastAws?.eks ?? null;
    if (this.options.clusterName) {
      try {
        eks = await gw.describeEksCluster(this.options.clusterName);
      } catch (err) {
        this.logger.warn(
          `EKS 클러스터 조회 실패: ${classifyAwsError(err).awsCode}`,
        );
      }
    }
    // 지원 등급 기준: DescribeCluster 버전 우선, 없으면 클러스터(API 서버) 버전 (PM 결정)
    const clusterVersion = usable
      ? k8sMinorVersion(inv.kubernetesVersion ?? null)
      : null;
    if (!eks && clusterVersion) {
      eks = {
        name: this.options.clusterName ?? 'eks-cluster',
        version: clusterVersion,
      };
    }
    return { fetchedAt: now, instances, volumes, loadBalancers, eks };
  }

  private updatePriceSources(
    stats: {
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
    },
    now: Date,
  ): void {
    if (!this.sources) return;
    const at = now.toISOString();
    const apply = (id: SourceId, st: typeof stats.pricing) => {
      if (st.ok + st.failed === 0) return;
      if (st.failed === 0) this.sources!.markSuccess(id, at);
      else
        this.sources!.markFailure(
          id,
          st.lastError ?? {
            code: 'PRICE_LOOKUP_FAILED',
            message: '단가 조회 실패',
          },
          { at, state: st.ok > 0 ? 'stale' : undefined },
        );
    };
    apply('pricing', stats.pricing);
    apply('spotPrice', stats.spot);
  }

  private maybeEmitEstimate(): void {
    const comp = this.estimate.comp;
    const total = comp?.total.usdPerHour ?? -1;
    const keys = comp
      ? comp.sampleResources
          .map((r) => r.key)
          .sort()
          .join(',')
      : '';
    const at = Date.now();
    const changed =
      Math.abs(total - this.lastEstimateEmit.total) > 0.0001 ||
      keys !== this.lastEstimateEmit.keys;
    if (changed || at - this.lastEstimateEmit.at >= ESTIMATE_HEARTBEAT_MS) {
      this.emitEstimate();
    }
  }

  private emitEstimate(): void {
    const d = this.derived;
    if (!d) return;
    const comp = this.estimate.comp;
    this.lastEstimateEmit = {
      at: Date.now(),
      total: comp?.total.usdPerHour ?? -1,
      keys: comp
        ? comp.sampleResources
            .map((r) => r.key)
            .sort()
            .join(',')
        : '',
    };
    this.emit('cost.estimate.updated', {
      estimate: d.estimate,
      allocation: d.allocation,
      summary: d.summary,
    });
  }

  // =================================================================== 소모율 기록

  async recordSample(): Promise<void> {
    const comp = this.estimate.comp;
    if (!comp || !this.estimate.available) return;
    const s = this.settings.current();
    const sampledAt = floorTo(this.now(), s.estimation.rateSampleIntervalSec);
    const byCat = Object.fromEntries(
      comp.categories.map((c) => [c.category, c.usdPerHour]),
    ) as Record<'ec2' | 'ebs' | 'lb' | 'eks' | 'ipv4', number>;
    if (this.mode === 'mock') {
      if (
        !this.mockSamples.some(
          (x) => x.sampledAt.getTime() === sampledAt.getTime(),
        )
      )
        this.mockSamples.push({
          sampledAt,
          totalUsdPerHour: comp.total.usdPerHour,
        });
      const cutoff = sampledAt.getTime() - 90 * 86_400_000;
      while (
        this.mockSamples.length &&
        this.mockSamples[0].sampledAt.getTime() < cutoff
      )
        this.mockSamples.shift();
    } else {
      if (this.sources?.isStale('awsResources')) return; // 끊긴 동안의 값은 기록하지 않음
      await this.store.saveRateSample('live', {
        sampledAt,
        totalUsdPerHour: comp.total.usdPerHour,
        byCategory: {
          ec2: byCat.ec2 ?? 0,
          ebs: byCat.ebs ?? 0,
          lb: byCat.lb ?? 0,
          eks: byCat.eks ?? 0,
          ipv4: byCat.ipv4 ?? 0,
        },
        nodeCount: comp.nodeCount,
        unpricedCount: comp.unpricedCount,
        resources: comp.sampleResources,
      });
    }
    const prevKey = this.derived?.statusKey;
    const d = await this.recompute();
    this.emit('cost.rate.sampled', {
      point: {
        t: sampledAt.toISOString(),
        usdPerHour: comp.total.usdPerHour,
        status: pointStatus(comp.total.usdPerHour, d.baseline),
      },
      baseline: d.baseline,
    });
    if (prevKey !== d.statusKey) this.emitStatus();
  }

  private async rateSamples(since: Date): Promise<RateSample[]> {
    if (this.mode === 'mock')
      return this.mockSamples.filter((x) => x.sampledAt >= since);
    return this.store.listRateSamples('live', since);
  }

  // =================================================================== CE

  private async ceTick(): Promise<void> {
    if (!this.ce) return;
    const day = this.now().toISOString().slice(0, 10);
    if (this.lastDay && this.lastDay !== day) this.emitRefresh();
    this.lastDay = day;
    await this.ce.ensureFresh();
  }

  private async onCeChange(what: 'data' | 'refresh'): Promise<void> {
    if (what === 'refresh') {
      this.emitRefresh();
      return;
    }
    const prevKey = this.derived?.statusKey;
    const d = await this.recompute();
    this.syncCeSource();
    this.emit('cost.actual.updated', { actual: d.actual, summary: d.summary });
    if (prevKey !== d.statusKey) this.emitStatus();
  }

  private syncCeSource(): void {
    if (!this.sources || !this.ce) return;
    const st = this.ce.current();
    if (!this.ce.configured) return;
    if (st.daily && st.daily.status === 'ok' && !st.dailyStale) {
      this.sources.update('costExplorer', {
        state: 'ok',
        lastSuccessAt: st.daily.fetchedAt.toISOString(),
        lastAttemptAt: st.daily.fetchedAt.toISOString(),
        error: null,
      });
    } else if (st.dailyError) {
      this.sources.markFailure('costExplorer', st.dailyError, {
        state: st.dailyStale
          ? 'stale'
          : st.dailyError.code === 'AWS_NOT_CONFIGURED'
            ? 'not_configured'
            : 'unavailable',
      });
    }
  }

  private emitRefresh(): void {
    void this.refreshView()
      .then((refresh) => this.emit('cost.refresh.updated', { refresh }))
      .catch(() => undefined);
  }

  private emitStatus(): void {
    const d = this.derived;
    if (d)
      this.emit('cost.status.updated', {
        status: d.status,
        summary: d.summary,
      });
  }

  private ceState(now: Date): CeState & { configured: boolean } {
    if (this.mode === 'mock') {
      const errors = mockCeErrors(this.scenario);
      const fetchedAt = mockCeFetchedAt(now);
      const expiresAt = new Date(fetchedAt.getTime() + 6 * 3600_000);
      const daily: CeEntry<CeDailyResult> | null = errors.daily
        ? {
            status: 'error',
            result: null,
            fetchedAt,
            expiresAt,
            errorCode: errors.daily.code,
            errorMessage: errors.daily.message,
          }
        : {
            status: 'ok',
            result: mockCeDaily(this.scenario, now),
            fetchedAt,
            expiresAt,
            errorCode: null,
            errorMessage: null,
          };
      const forecast: CeEntry<CeForecastResult> | null = errors.forecast
        ? {
            status: 'error',
            result: null,
            fetchedAt,
            expiresAt,
            errorCode: errors.forecast.code,
            errorMessage: errors.forecast.message,
          }
        : {
            status: 'ok',
            result: mockCeForecast(now),
            fetchedAt,
            expiresAt,
            errorCode: null,
            errorMessage: null,
          };
      return {
        daily,
        forecast,
        dailyError: errors.daily,
        forecastError: errors.forecast,
        dailyStale: false,
        configured: true,
      };
    }
    const st = this.ce!.current();
    return { ...st, configured: this.ce!.configured };
  }

  // =================================================================== 계산 (모든 뷰)

  /** 현재 상태로 모든 응답 모양을 다시 만든다. AWS 호출 없음 */
  async recompute(): Promise<Derived> {
    const now = this.now();
    const nowIso = now.toISOString();
    const s = await this.settings.get();
    const hpm = s.estimation.hoursPerMonth;
    const est = this.estimate;
    const comp = est.available ? est.comp : null;
    const estAsOf = est.computedAt ? est.computedAt.toISOString() : null;
    const awsStale =
      this.mode === 'live' && Boolean(this.sources?.isStale('awsResources'));

    // ---------------------------------------------------------- CE
    const ce = this.ceState(now);
    const ceAsOf = ce.daily ? ce.daily.fetchedAt.toISOString() : null;
    let actualSummary: ActualSummary | null = null;
    let dailySpike: DailySpikeEvaluation | null = null;
    let actualUnavailable: Unavailable | null = null;
    if (!ce.configured) actualUnavailable = AWS_NOT_CONFIGURED;
    else if (!ce.daily) actualUnavailable = SYNCING;
    else if (ce.daily.status !== 'ok' || !ce.daily.result)
      actualUnavailable = ce.dailyError ?? {
        code: ce.daily.errorCode ?? 'CE_ERROR',
        message: ce.daily.errorMessage ?? 'Cost Explorer 오류',
      };
    if (!actualUnavailable && ce.daily?.result) {
      dailySpike = evaluateDailySpike(ce.daily.result, now, s.spike.daily);
      actualSummary = summarizeActual(ce.daily.result, now, dailySpike);
    }
    let forecastSummary: ForecastSummary | null = null;
    let forecastUnavailable: Unavailable | null = null;
    const forecastAsOf = ce.forecast
      ? ce.forecast.fetchedAt.toISOString()
      : null;
    if (actualUnavailable) forecastUnavailable = actualUnavailable;
    else if (!ce.forecast) forecastUnavailable = ce.forecastError ?? SYNCING;
    else if (ce.forecast.status !== 'ok' || !ce.forecast.result)
      forecastUnavailable = ce.forecastError ?? {
        code: ce.forecast.errorCode ?? 'CE_FORECAST_UNAVAILABLE',
        message: ce.forecast.errorMessage ?? 'AWS 예측 불가',
      };
    if (!forecastUnavailable && ce.forecast?.result && actualSummary) {
      forecastSummary = summarizeForecast(
        ce.forecast.result,
        actualSummary.monthToDate.amountUsd,
      );
    }
    const mtd = actualSummary ? actualSummary.monthToDate.amountUsd : null;

    // ---------------------------------------------------------- 추정 월말
    const monthEndEst =
      comp !== null ? estimateMonthEnd(comp.total.usdPerHour, mtd, now) : null;
    const monthEndEstimated = monthEndEst
      ? {
          amount: {
            amountUsd: monthEndEst.amountUsd,
            kind: 'estimated' as const,
            asOf: estAsOf ?? nowIso,
          },
          method: monthEndEst.method,
          formula: monthEndEst.formula,
        }
      : null;

    // ---------------------------------------------------------- 예산
    const budgetSettings = { ...s.budget };
    if (this.mode === 'mock') {
      budgetSettings.monthlyBudgetUsd = mockBudgetUsd(this.scenario, {
        monthToDateUsd: mtd,
        forecastMonthEndUsd: forecastSummary?.monthEndUsd ?? null,
        estimatedMonthEndUsd: monthEndEst?.amountUsd ?? null,
      });
    }
    const budget = evaluateBudget({
      settings: budgetSettings,
      monthToDateUsd: mtd,
      forecastMonthEndUsd: forecastSummary?.monthEndUsd ?? null,
      estimatedMonthEndUsd: monthEndEst?.amountUsd ?? null,
      now,
    });
    const budgetUpdatedAt =
      budget.projectedBasis === 'aws_forecast'
        ? forecastAsOf
        : budget.projectedBasis
          ? estAsOf
          : ceAsOf;
    const budgetInfo: StatusInfo | null = budget.configured
      ? this.info(
          'budget',
          budget.status,
          budget.reasons,
          budgetUpdatedAt,
          nowIso,
          ce.dailyStale ||
            (budget.projectedBasis === 'estimated_month_end' && awsStale),
        )
      : null;

    // ---------------------------------------------------------- 급증 A
    const since7 = new Date(
      now.getTime() - s.spike.rate.baselineDays * 86_400_000,
    );
    const samples = await this.rateSamples(since7);
    const baseline = computeRateBaseline(samples, now, s.spike.rate);
    let rateEval: RateSpikeEvaluation;
    if (!comp) {
      const u = est.unavailable ?? SYNCING;
      rateEval = {
        status: 'unknown',
        reasons: [mkReason(u.code, u.message, 'unknown')],
        deltaUsdPerHour: null,
        deltaPct: null,
      };
    } else {
      rateEval = evaluateRateSpike(
        comp.total.usdPerHour,
        baseline,
        s.spike.rate.baselineDays,
      );
    }
    let causes: SpikeCause[] = [];
    let causesBaselineAt: string | null = null;
    if (
      comp &&
      (rateEval.status === 'warning' || rateEval.status === 'critical') &&
      baseline.medianUsdPerHour !== null
    ) {
      const pick = pickCausesBaseline(samples, baseline.medianUsdPerHour);
      if (pick) {
        causesBaselineAt = pick.sampledAt.toISOString();
        const baseRes =
          this.mode === 'mock'
            ? this.mockBaselineResources
            : ((await this.store.getRateSampleResources(
                'live',
                pick.sampledAt,
              )) ?? []);
        causes = computeSpikeCauses(comp.sampleResources, baseRes);
      }
    }

    // ---------------------------------------------------------- 급증 B
    const dailyEval: DailySpikeEvaluation = dailySpike ?? {
      available: false,
      status: 'unknown',
      reasons: actualUnavailable
        ? [
            mkReason(
              actualUnavailable.code,
              actualUnavailable.message,
              'unknown',
            ),
          ]
        : [],
      date: null,
      usd: null,
      baselineAvgUsd: null,
      deltaUsd: null,
      deltaPct: null,
      spikedServices: [],
    };

    const rateInfoStale = awsStale;
    const rateStatusInfo = this.info(
      'spike.rate',
      rateEval.status,
      rateEval.reasons,
      estAsOf,
      nowIso,
      rateInfoStale,
    );
    const dailyStatusInfo = this.info(
      'spike.daily',
      dailyEval.status,
      dailyEval.reasons,
      ceAsOf,
      nowIso,
      ce.dailyStale,
    );
    const spikeStatus = worstStatus([rateEval.status, dailyEval.status]);
    const spikeInfo = this.info(
      'spike',
      spikeStatus,
      [
        ...prefix('급증(추정): ', rateEval.reasons),
        ...prefix('급증(확정): ', dailyEval.reasons),
      ].filter((r) => r.status !== 'ok' || spikeStatus === 'ok'),
      latest(estAsOf, ceAsOf),
      nowIso,
      rateInfoStale || ce.dailyStale,
    );

    // ---------------------------------------------------------- 전체
    const parts: { status: Status; reasons: Reason[] }[] = [
      {
        status: rateEval.status,
        reasons: prefix('급증(추정): ', rateEval.reasons),
      },
      {
        status: dailyEval.status,
        reasons: prefix('급증(확정): ', dailyEval.reasons),
      },
    ];
    if (budget.configured)
      parts.unshift({
        status: budget.status,
        reasons: prefix('예산: ', budget.reasons),
      });
    const overall = worstStatus(parts.map((p) => p.status));
    const overallReasons = sortReasons(
      parts.flatMap((p) => p.reasons).filter((r) => r.status !== 'ok'),
    );
    const overallInfo = this.info(
      'overall',
      overall,
      overallReasons,
      latest(estAsOf, ceAsOf),
      nowIso,
      awsStale || ce.dailyStale,
    );

    // ---------------------------------------------------------- 뷰
    const money = (
      amountUsd: number,
      kind: Money['kind'],
      asOf: string | null,
    ): Money => ({
      amountUsd,
      kind,
      asOf: asOf ?? nowIso,
    });
    const estimateView: EstimateView = {
      available: comp !== null,
      unavailable: comp ? null : (est.unavailable ?? SYNCING),
      kind: 'estimated',
      asOf: estAsOf,
      resourcesFetchedAt: est.resourcesFetchedAt
        ? est.resourcesFetchedAt.toISOString()
        : null,
      intervalSec: est.intervalSec,
      total: comp ? comp.total : null,
      categories: comp ? comp.categories : [],
      resources: comp
        ? comp.resources
        : { ec2: [], ebs: [], lb: [], ipv4: [], eks: [] },
      pricing: {
        source: this.mode === 'mock' ? 'mock' : 'pricing_api',
        fetchedAt: est.prices?.fetchedAt ?? null,
        nextRefreshAt: est.prices?.fetchedAt
          ? new Date(
              Date.parse(est.prices.fetchedAt) +
                s.estimation.pricingCacheTtlSec * 1000,
            ).toISOString()
          : null,
        cacheUsed: est.prices?.cacheUsed ?? false,
        cacheFetchedAt: est.prices?.cacheFetchedAt ?? null,
      },
      spotPrice: {
        fetchedAt: est.prices?.spotFetchedAt ?? null,
        cacheTtlSec: s.estimation.spotPriceCacheTtlSec,
        fallbackCount: comp?.spotFallbackCount ?? 0,
      },
      unpricedCount: comp?.unpricedCount ?? 0,
      outOfCluster: comp?.outOfCluster ?? { count: 0, byCategory: {} },
      hoursPerMonth: hpm,
      monthEnd: monthEndEstimated,
      stale: awsStale,
    };

    const forecastBlock = {
      available: forecastSummary !== null,
      unavailable: forecastSummary ? null : forecastUnavailable,
      amount:
        forecastSummary?.monthEndUsd != null
          ? money(forecastSummary.monthEndUsd, 'forecast', forecastAsOf)
          : null,
      low:
        forecastSummary?.lowUsd != null
          ? money(forecastSummary.lowUsd, 'forecast', forecastAsOf)
          : null,
      high:
        forecastSummary?.highUsd != null
          ? money(forecastSummary.highUsd, 'forecast', forecastAsOf)
          : null,
      confidencePct: 80,
    };
    const scope = s.explorer.costAllocationTagFilter ? 'tag_filter' : 'account';
    const budgetView = {
      configured: budget.configured,
      status: budgetInfo,
      budgetUsd: budget.budgetUsd,
      monthToDatePct: budget.monthToDatePct,
      projectedPct: budget.projectedPct,
      projectedBasis: budget.projectedBasis,
      monthElapsedPct: budget.monthElapsedPct,
      daysElapsed: budget.daysElapsed,
      daysInMonth: budget.daysInMonth,
      warnPct: budget.warnPct,
      overPct: budget.overPct,
    };
    const rateDetail = {
      status: rateEval.status,
      baselineState: baseline.state,
      collectedHours: baseline.collectedHours,
      requiredHours: baseline.requiredHours,
      currentUsdPerHour: comp?.total.usdPerHour ?? null,
      medianUsdPerHour: baseline.medianUsdPerHour,
      deltaUsdPerHour: rateEval.deltaUsdPerHour,
      deltaPct: rateEval.deltaPct,
    };
    const dailyDetail = {
      status: dailyEval.status,
      available: dailyEval.available,
      date: dailyEval.date,
      usd: dailyEval.usd,
      baselineAvgUsd: dailyEval.baselineAvgUsd,
      deltaUsd: dailyEval.deltaUsd,
      deltaPct: dailyEval.deltaPct,
    };

    const summary = {
      status: overallInfo,
      rate: {
        available: comp !== null,
        unavailable: estimateView.unavailable,
        hourly: comp
          ? money(comp.total.usdPerHour, 'estimated', estAsOf)
          : null,
        daily: comp ? money(comp.total.usdPerDay, 'estimated', estAsOf) : null,
        monthly: comp
          ? money(comp.total.usdPerMonth, 'estimated', estAsOf)
          : null,
        warnings: {
          unpricedCount: comp?.unpricedCount ?? 0,
          spotFallbackCount: comp?.spotFallbackCount ?? 0,
          outOfClusterCount: comp?.outOfCluster.count ?? 0,
          priceCacheUsed: est.prices?.cacheUsed ?? false,
        },
      },
      monthToDate: {
        available: actualSummary !== null,
        unavailable: actualSummary ? null : actualUnavailable,
        amount: actualSummary
          ? money(actualSummary.monthToDate.amountUsd, 'actual', ceAsOf)
          : null,
        settledThrough: actualSummary?.settledThrough ?? null,
        lastMonthSamePeriod: actualSummary
          ? money(
              actualSummary.monthToDate.lastMonthSamePeriodUsd,
              'actual',
              ceAsOf,
            )
          : null,
        changePct: actualSummary?.monthToDate.changePct ?? null,
        scope,
        metric: s.explorer.metric,
      },
      monthEnd: { forecast: forecastBlock, estimated: monthEndEstimated },
      budget: budgetView,
      spike: { status: spikeInfo, rate: rateDetail, daily: dailyDetail },
    };

    const status = {
      status: overallInfo,
      budget: budgetView,
      spike: {
        status: spikeInfo,
        rate: {
          ...rateDetail,
          reasons: rateStatusInfo.reasons,
          warnAtUsdPerHour: baseline.warnAtUsdPerHour,
          critAtUsdPerHour: baseline.critAtUsdPerHour,
          kind: 'estimated',
          asOf: estAsOf,
          causes,
          causesBaselineAt,
        },
        daily: {
          ...dailyDetail,
          unavailable: dailyEval.available ? null : actualUnavailable,
          reasons: dailyStatusInfo.reasons,
          kind: 'actual',
          asOf: ceAsOf,
          spikedServices: dailyEval.spikedServices,
        },
      },
      thresholds: {
        budget: {
          warnPct: budgetSettings.warnPct,
          overPct: budgetSettings.overPct,
        },
        rate: s.spike.rate,
        daily: s.spike.daily,
      },
    };

    const refresh = await this.refreshView();
    const actual = {
      available: actualSummary !== null,
      unavailable: actualSummary ? null : actualUnavailable,
      kind: 'actual',
      asOf: ceAsOf,
      metric: s.explorer.metric,
      scope,
      tagFilter: s.explorer.costAllocationTagFilter,
      settledThrough: actualSummary?.settledThrough ?? null,
      delayNotice: '청구 데이터는 최대 24시간 지연',
      month: actualSummary?.month ?? null,
      monthToDate: actualSummary?.monthToDate ?? null,
      lastMonthTotalUsd: actualSummary?.lastMonthTotalUsd ?? null,
      services: actualSummary?.services ?? null,
      daily: actualSummary?.daily ?? null,
      forecast: {
        available: forecastSummary !== null,
        unavailable: forecastSummary ? null : forecastUnavailable,
        kind: 'forecast',
        asOf: forecastAsOf,
        period: forecastSummary?.period ?? null,
        remainingUsd: forecastSummary?.remainingUsd ?? null,
        monthEndUsd: forecastSummary?.monthEndUsd ?? null,
        lowUsd: forecastSummary?.lowUsd ?? null,
        highUsd: forecastSummary?.highUsd ?? null,
        confidencePct: 80,
        cumulative: forecastSummary?.cumulative ?? [],
      },
      monthCumulative: actualSummary?.monthCumulative ?? [],
      refresh,
      stale: ce.dailyStale,
      staleReason: ce.dailyStale ? (ce.dailyError?.message ?? null) : null,
    };

    const allocation = this.allocationView(est, estAsOf, s, {
      hideSystem: false,
      sortField: 'usdPerHour',
      sortDir: 'desc',
    });

    this.derived = {
      at: now,
      estimate: estimateView,
      summary,
      status,
      actual,
      allocation,
      baseline,
      budget,
      statusKey: JSON.stringify([
        overallInfo.status,
        overallInfo.reasons.map((r) => r.code),
        budget.status,
        rateEval.status,
        dailyEval.status,
        budget.configured,
      ]),
      actualSummary,
      forecastSummary,
    };
    return this.derived;
  }

  private info(
    key: string,
    status: Status,
    reasons: Reason[],
    updatedAt: string | null,
    nowIso: string,
    stale: boolean,
  ): StatusInfo {
    return {
      status,
      reasons: sortReasons(reasons),
      updatedAt,
      statusChangedAt: this.tracker.track(key, status, nowIso),
      stale,
    };
  }

  private allocationView(
    est: EstimateState,
    asOf: string | null,
    s: CostSettings,
    opts: {
      hideSystem: boolean;
      sortField: AllocationSort;
      sortDir: 'asc' | 'desc';
    },
  ): Record<string, unknown> {
    const a = est.available ? est.allocation : null;
    const hpm = s.estimation.hoursPerMonth;
    if (!a) {
      return {
        available: false,
        unavailable: est.available
          ? est.allocationUnavailable
          : (est.unavailable ?? SYNCING),
        kind: 'estimated',
        asOf,
        rows: [],
        pinnedRows: [],
        hiddenSystem: null,
        total: null,
        unallocatedPct: null,
        unallocatedWarnPct: s.unallocatedWarnPct,
        rulesVersion: 1,
      };
    }
    const { rows, hiddenSystem } = presentAllocation(a, opts, hpm);
    return {
      available: true,
      unavailable: null,
      kind: 'estimated',
      asOf,
      rows,
      pinnedRows: a.pinnedRows,
      hiddenSystem,
      total: a.total,
      unallocatedPct: a.unallocatedPct,
      unallocatedWarnPct: s.unallocatedWarnPct,
      rulesVersion: 1,
    };
  }

  private async ensureDerived(): Promise<Derived> {
    return this.derived ?? this.recompute();
  }

  private envelope<T extends object>(
    body: T,
  ): { dataSource: 'mock' | 'live'; generatedAt: string } & T {
    return {
      dataSource: this.mode,
      generatedAt: this.now().toISOString(),
      ...body,
    };
  }

  // =================================================================== REST

  async getSummary() {
    return this.envelope((await this.ensureDerived()).summary);
  }

  async getEstimate() {
    return this.envelope((await this.ensureDerived()).estimate);
  }

  async getAllocation(q: AllocationQueryDto) {
    await this.ensureDerived();
    const s = await this.settings.get();
    const [field, dir] = (q.sort ?? 'usdPerHour:desc').split(':') as [
      AllocationSort,
      'asc' | 'desc',
    ];
    const est = this.estimate;
    return this.envelope(
      this.allocationView(
        est,
        est.computedAt ? est.computedAt.toISOString() : null,
        s,
        {
          hideSystem: q.hideSystem === true,
          sortField: field,
          sortDir: dir,
        },
      ),
    );
  }

  async getStatus() {
    return this.envelope((await this.ensureDerived()).status);
  }

  async getActual() {
    const d = await this.ensureDerived();
    return this.envelope({ ...d.actual, refresh: await this.refreshView() });
  }

  async getRefresh() {
    return this.envelope(await this.refreshView());
  }

  async refreshView(): Promise<RefreshView> {
    if (this.mode === 'mock') return this.mockRefreshView();
    return this.ce!.refreshView();
  }

  private mockRefreshView(): RefreshView {
    const s = this.settings.current();
    const now = this.now();
    const limit = this.scenario === 'ce-limit-reached';
    const reset = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const fetchedAt = mockCeFetchedAt(now);
    return {
      state: 'idle',
      canRefresh: false,
      disabledReason: limit ? 'daily_limit' : 'mock',
      lastFetchedAt: fetchedAt.toISOString(),
      lastCallAt: null,
      lastManualAt: null,
      nextAvailableAt: limit ? reset.toISOString() : null,
      nextScheduledAt: new Date(
        fetchedAt.getTime() + s.explorer.cacheTtlSec * 1000,
      ).toISOString(),
      cacheTtlSec: s.explorer.cacheTtlSec,
      cooldownSec: s.explorer.manualRefreshCooldownSec,
      todayCalls: limit ? s.explorer.dailyCallLimit : 0,
      dailyLimit: s.explorer.dailyCallLimit,
      limitReached: limit,
      dayBoundary: 'UTC',
      dailyResetAt: reset.toISOString(),
      callsPerRefresh: CALLS_PER_REFRESH,
      maxCallsPerRefresh: MAX_CALLS_PER_REFRESH,
      refreshEstimatedCostUsd: refreshEstimatedCostUsd(s.explorer.callCostUsd),
      callCostUsd: s.explorer.callCostUsd,
      monthCalls: 0,
      monthCallCost: {
        amountUsd: 0,
        kind: 'estimated',
        asOf: now.toISOString(),
      },
      lastError: null,
    };
  }

  /** POST /api/cost/explorer/refresh → 202 */
  async requestRefresh() {
    if (this.mode === 'mock') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'LIVE_MODE_ONLY',
        'mock 모드에서는 Cost Explorer를 호출하지 않습니다.',
      );
    }
    const refresh = await this.ce!.requestManualRefresh();
    this.emit('cost.refresh.updated', { refresh });
    return { accepted: true, refresh };
  }

  async getRateSeries(range: RateRange = '7d') {
    const d = await this.ensureDerived();
    const r = RATE_RANGES.includes(range) ? range : '7d';
    const now = this.now();
    const hours = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 }[r];
    const stepSec = { '24h': 300, '7d': 300, '30d': 1800, '90d': 3600 }[r];
    const raw = await this.rateSamples(
      new Date(now.getTime() - hours * 3600_000),
    );
    const buckets = new Map<number, { sum: number; n: number }>();
    for (const p of raw) {
      const k =
        Math.floor(p.sampledAt.getTime() / (stepSec * 1000)) * stepSec * 1000;
      const b = buckets.get(k) ?? { sum: 0, n: 0 };
      b.sum += p.totalUsdPerHour;
      b.n += 1;
      buckets.set(k, b);
    }
    const points = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, b]) => {
        const v = r6(b.sum / b.n);
        return {
          t: new Date(t).toISOString(),
          usdPerHour: v,
          status: pointStatus(v, d.baseline),
        };
      });
    const body: Record<string, unknown> = {
      kind: 'estimated',
      asOf: d.estimate.asOf,
      range: r,
      stepSec,
      points,
      baseline: d.baseline,
      retentionDays: 90,
    };
    if (this.mode === 'live' && this.store.persistence === 'memory')
      body.persistence = 'memory';
    return this.envelope(body);
  }

  async getSettings(extra: { pendingRefresh?: boolean } = {}) {
    const s = await this.settings.get();
    return this.envelope({
      persistence: this.store.persistence,
      budget: { ...s.budget, lockedByEnv: s.locked.budget },
      spike: {
        rate: s.spike.rate,
        daily: s.spike.daily,
        lockedByEnv: s.locked.spike,
      },
      explorer: {
        metric: s.explorer.metric,
        cacheTtlSec: s.explorer.cacheTtlSec,
        manualRefreshCooldownSec: s.explorer.manualRefreshCooldownSec,
        dailyCallLimit: s.explorer.dailyCallLimit,
        callCostUsd: s.explorer.callCostUsd,
        costAllocationTagFilter: s.explorer.costAllocationTagFilter,
        lockedByEnv: s.locked.explorer,
        ...(extra.pendingRefresh ? { pendingRefresh: true } : {}),
      },
      estimation: { ...s.estimation, readOnly: true },
      updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
    });
  }

  async patchSettings(dto: CostSettingsPatchDto) {
    const { pendingRefresh } = await this.settings.patch(dto);
    await this.recompute();
    this.emitStatus();
    if (this.ce) await this.ce.load(true).catch(() => undefined);
    return this.getSettings({ pendingRefresh });
  }

  // =================================================================== SSE·어드바이저·개요

  async snapshotPayload() {
    const d = await this.ensureDerived();
    return {
      summary: d.summary,
      estimate: d.estimate,
      allocation: d.allocation,
      actual: { ...d.actual, refresh: await this.refreshView() },
      status: d.status,
      refresh: await this.refreshView(),
    };
  }

  /** 개요 카드 (docs/api/cluster-status.md 2.1 `cost`) */
  async overviewSummary() {
    const d = await this.ensureDerived();
    const sum = d.summary as {
      status: StatusInfo;
      rate: { hourly: Money | null };
      monthToDate: { amount: Money | null };
    };
    return {
      status: sum.status,
      rate: sum.rate.hourly,
      monthToDate: sum.monthToDate.amount,
      budgetStatus: d.budget.configured ? d.budget.status : null,
      available: d.estimate.available || d.actualSummary !== null,
    };
  }

  /** 어드바이저 스냅샷 `cost` 블록 (docs/api/architecture-advisor.md B.2) */
  async advisorCostBlock() {
    const d = await this.ensureDerived();
    const comp = this.estimate.available ? this.estimate.comp : null;
    const alloc = this.estimate.available ? this.estimate.allocation : null;
    const hpm = this.settings.current().estimation.hoursPerMonth;

    const byNodeGroup = new Map<string, number>();
    for (const r of comp?.resources.ec2 ?? []) {
      if (r.usdPerHour === null) continue;
      const g = r.nodeGroup ?? '(none)';
      byNodeGroup.set(g, (byNodeGroup.get(g) ?? 0) + r.usdPerHour);
    }
    const allocation = alloc
      ? [
          ...alloc.rows.map((r) => ({
            namespace: r.namespace,
            usdPerMonth: r.usdPerMonth,
            sharePct: r.sharePct,
            requestsMissingPods:
              r.warnings.find((w) => w.code === 'REQUESTS_MISSING')?.count ?? 0,
          })),
          ...alloc.pinnedRows.map((p) => ({
            namespace: p.key,
            usdPerMonth: p.usdPerMonth,
            sharePct: p.sharePct,
            requestsMissingPods: 0,
          })),
        ]
      : [];
    const a = d.actualSummary;
    const f = d.forecastSummary;
    return {
      currency: 'USD' as const,
      asOf: d.estimate.asOf,
      rate: {
        totalUsdPerHour: comp?.total.usdPerHour ?? null,
        byCategory: (comp?.categories ?? []).map((c) => ({
          category: c.category,
          usdPerHour: c.usdPerHour,
        })),
        byNodeGroup: [...byNodeGroup.entries()]
          .sort((x, y) => y[1] - x[1])
          .map(([nodeGroup, h]) => ({
            nodeGroup,
            usdPerHour: r6(h),
            usdPerMonth: r6(h * hpm),
          })),
        unpricedCount: comp?.unpricedCount ?? 0,
      },
      allocation,
      actual: a
        ? {
            monthToDateUsd: a.monthToDate.amountUsd,
            settledThrough: a.settledThrough,
            topServices: a.services.top.map((x) => ({
              service: x.service,
              mtdUsd: x.mtdUsd,
            })),
            scope: this.settings.current().explorer.costAllocationTagFilter
              ? 'tag_filter'
              : 'account',
          }
        : null,
      forecast:
        f && f.monthEndUsd !== null
          ? {
              monthEndUsd: f.monthEndUsd,
              lowUsd: f.lowUsd ?? f.monthEndUsd,
              highUsd: f.highUsd ?? f.monthEndUsd,
            }
          : null,
      budget:
        d.budget.configured && d.budget.budgetUsd !== null
          ? {
              budgetUsd: d.budget.budgetUsd,
              status: d.budget.status,
              projectedPct: d.budget.projectedPct,
            }
          : null,
      alternatives: await this.alternatives(comp),
      ebsGbMonth: await this.ebsGbMonth(),
    };
  }

  private async alternatives(comp: EstimateComputation | null) {
    if (!comp) return [];
    const types = new Map<string, string | null>();
    for (const r of comp.resources.ec2)
      if (r.instanceType && !types.has(r.instanceType))
        types.set(r.instanceType, r.zone);
    const out = [];
    for (const [type, zone] of types) {
      const g = gravitonEquivalent(type);
      const sm = smallerSize(type);
      out.push({
        instanceType: type,
        currentUsdPerHour: await this.onDemandPrice(type),
        graviton: g
          ? { type: g, usdPerHour: await this.onDemandPrice(g) }
          : null,
        smaller: sm
          ? { type: sm, usdPerHour: await this.onDemandPrice(sm) }
          : null,
        spot: zone
          ? { usdPerHour: await this.spotPrice(type, zone), zone }
          : null,
      });
    }
    return out;
  }

  private async onDemandPrice(type: string): Promise<number | null> {
    if (this.mode === 'mock') return MOCK_ON_DEMAND[type] ?? null;
    if (!this.prices) return null;
    return (await this.prices.onDemandQuote(type)).usd;
  }

  private async spotPrice(type: string, zone: string): Promise<number | null> {
    if (this.mode === 'mock') return mockSpotPrice(type, zone, this.now());
    if (!this.prices) return null;
    return (await this.prices.spotQuote(type, zone)).usd;
  }

  private async ebsGbMonth(): Promise<{
    gp2: number | null;
    gp3: number | null;
  }> {
    if (this.mode === 'mock') return { gp2: 0.114, gp3: 0.0912 };
    if (!this.prices) return { gp2: null, gp3: null };
    const [gp2, gp3] = await Promise.all([
      this.prices.ebsQuote('gp2', 'storage'),
      this.prices.ebsQuote('gp3', 'storage'),
    ]);
    return { gp2: gp2.usd, gp3: gp3.usd };
  }
}

// =================================================================== helpers

function prefix(p: string, reasons: Reason[]): Reason[] {
  return reasons.map((r) => ({ ...r, text: `${p}${r.text}` }));
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function pointStatus(v: number, b: RateBaseline): Status {
  if (b.state !== 'ready') return 'ok';
  if (b.critAtUsdPerHour !== null && v >= b.critAtUsdPerHour) return 'critical';
  if (b.warnAtUsdPerHour !== null && v >= b.warnAtUsdPerHour) return 'warning';
  return 'ok';
}

function awsUnavailable(err: unknown): Unavailable {
  const info = classifyAwsError(err);
  if (info.kind === 'not_configured') return AWS_NOT_CONFIGURED;
  if (info.kind === 'access_denied') {
    const op =
      /(ec2:\w+|elasticloadbalancing:\w+|eks:\w+)/.exec(info.message)?.[1] ??
      'ec2:DescribeInstances';
    return { code: 'AWS_ACCESS_DENIED', message: `권한 없음: ${op}` };
  }
  return { code: 'AWS_ERROR', message: `AWS 조회 실패: ${info.awsCode}` };
}
