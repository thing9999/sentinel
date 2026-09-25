import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AdvisorEvents } from '../advisor-events';
import type {
  PrecheckItem,
  PrecheckOverview,
  SnapshotSummary,
  StatusInfo,
} from '../advisor.types';
import { AdvisorSnapshotService } from '../snapshot/advisor-snapshot.service';
import type { BuiltSnapshot } from '../snapshot/snapshot-builder';
import type { PrecheckComputation } from './precheck-rules';

export const PRECHECK_INTERVAL_SEC = 300;
/** includeSystem=true 요청 결과 캐시 */
const ON_DEMAND_CACHE_MS = 60_000;
const STALE_AFTER_MS = 15 * 60_000;

export interface PrecheckSnapshot {
  computedAt: string;
  includeSystem: boolean;
  computation: PrecheckComputation;
  summary: SnapshotSummary;
  status: StatusInfo;
}

export function precheckStatus(
  c: PrecheckComputation,
  computedAt: string,
  statusChangedAt: string | null,
  now: Date,
): StatusInfo {
  const allUnknown =
    c.sources.cluster === 'unknown' &&
    c.sources.cost === 'unknown' &&
    c.sources.db === 'unknown';
  const stale = now.getTime() - Date.parse(computedAt) > STALE_AFTER_MS;
  if (allUnknown) {
    return {
      status: 'unknown',
      reasons: [
        {
          code: 'PRECHECK_NO_DATA',
          text: '알 수 없음 (클러스터 연결 없음)',
          status: 'unknown',
        },
      ],
      updatedAt: computedAt,
      statusChangedAt,
      stale,
    };
  }
  const reasons: StatusInfo['reasons'] = [];
  if (c.counts.high > 0)
    reasons.push({
      code: 'PRECHECK_HIGH',
      text: `높음 ${c.counts.high}건`,
      status: 'critical',
    });
  if (c.counts.medium > 0)
    reasons.push({
      code: 'PRECHECK_MEDIUM',
      text: `중간 ${c.counts.medium}건`,
      status: 'warning',
    });
  return {
    status:
      c.counts.high > 0 ? 'critical' : c.counts.medium > 0 ? 'warning' : 'ok',
    reasons,
    updatedAt: computedAt,
    statusChangedAt,
    stale,
  };
}

const emptyComputation = (): PrecheckComputation => ({
  items: [],
  counts: { high: 0, medium: 0, low: 0, held: 0 },
  matrix: {
    cost: { high: 0, medium: 0, low: 0 },
    reliability: { high: 0, medium: 0, low: 0 },
    performance: { high: 0, medium: 0, low: 0 },
    security: { high: 0, medium: 0, low: 0 },
    database: { high: 0, medium: 0, low: 0 },
  },
  sources: { cluster: 'unknown', cost: 'unknown', db: 'unknown' },
});

/**
 * 규칙 기반 사전 점검 (LLM 없음): 최대 5분 간격 재계산, 결과가 바뀌면 advisor.precheck.updated
 */
@Injectable()
export class AdvisorPrecheckService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AdvisorPrecheckService.name);
  private latest: PrecheckSnapshot | null = null;
  private withSystem: PrecheckSnapshot | null = null;
  private lastKey: string | null = null;
  private lastStatus: string | null = null;
  private statusChangedAt: string | null = null;
  private timer: NodeJS.Timeout | undefined;
  private computing: Promise<PrecheckSnapshot> | null = null;

  constructor(
    private readonly snapshots: AdvisorSnapshotService,
    private readonly events: AdvisorEvents,
  ) {}

  onApplicationBootstrap(): void {
    // 다른 모듈의 캐시가 채워질 시간을 조금 준 뒤 첫 계산
    const first = setTimeout(() => void this.recompute(), 5_000);
    first.unref?.();
    this.timer = setInterval(
      () => void this.recompute(),
      PRECHECK_INTERVAL_SEC * 1000,
    );
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 기본(시스템 네임스페이스 제외) 결과. 없으면 계산 */
  async current(includeSystem = false): Promise<PrecheckSnapshot> {
    if (!includeSystem) {
      if (
        this.latest &&
        Date.now() - Date.parse(this.latest.computedAt) <
          PRECHECK_INTERVAL_SEC * 1000
      ) {
        return this.latest;
      }
      return this.recompute();
    }
    if (
      this.withSystem &&
      Date.now() - Date.parse(this.withSystem.computedAt) < ON_DEMAND_CACHE_MS
    ) {
      return this.withSystem;
    }
    const built = await this.snapshots.build(true);
    this.withSystem = this.fromBuilt(built.built, true, new Date());
    return this.withSystem;
  }

  /** 현재 스냅샷 요약 (결과 신선도 비교용). 캐시가 없으면 null */
  get latestSummary(): SnapshotSummary | null {
    return this.latest?.summary ?? null;
  }

  overview(p: PrecheckSnapshot | null = this.latest): PrecheckOverview {
    if (!p) {
      return {
        status: {
          status: 'unknown',
          reasons: [],
          updatedAt: null,
          statusChangedAt: null,
          stale: false,
        },
        computedAt: null,
        intervalSec: PRECHECK_INTERVAL_SEC,
        counts: { high: 0, medium: 0, low: 0, held: 0 },
      };
    }
    return {
      status: {
        ...p.status,
        stale: Date.now() - Date.parse(p.computedAt) > STALE_AFTER_MS,
      },
      computedAt: p.computedAt,
      intervalSec: PRECHECK_INTERVAL_SEC,
      counts: p.computation.counts,
    };
  }

  /** 실행 시점에 만든 스냅샷의 점검 결과를 최신값으로 반영 */
  acceptBuilt(built: BuiltSnapshot, includeSystem: boolean): void {
    const p = this.fromBuilt(built, includeSystem, new Date());
    if (includeSystem) this.withSystem = p;
    else this.publish(p);
  }

  async recompute(): Promise<PrecheckSnapshot> {
    if (!this.computing) {
      this.computing = (async () => {
        try {
          const { built } = await this.snapshots.build(false);
          const p = this.fromBuilt(built, false, new Date());
          this.publish(p);
          return p;
        } catch (err) {
          this.logger.warn(
            `사전 점검 계산 실패: ${err instanceof Error ? err.message : String(err)}`,
          );
          const p = this.fromBuilt(null, false, new Date());
          this.publish(p);
          return p;
        } finally {
          this.computing = null;
        }
      })();
    }
    return this.computing;
  }

  private fromBuilt(
    built: BuiltSnapshot | null,
    includeSystem: boolean,
    now: Date,
  ): PrecheckSnapshot {
    const computation = built?.prechecks ?? emptyComputation();
    const computedAt = now.toISOString();
    const status = precheckStatus(
      computation,
      computedAt,
      this.statusChangedAt,
      now,
    );
    if (!includeSystem && status.status !== this.lastStatus) {
      this.lastStatus = status.status;
      this.statusChangedAt = computedAt;
      status.statusChangedAt = computedAt;
    }
    return {
      computedAt,
      includeSystem,
      computation,
      status,
      summary: built?.summary ?? {
        workerCount: 0,
        controlPlaneCount: 0,
        workloadCount: 0,
        pvcCount: 0,
        loadBalancerCount: 0,
        instanceTypes: [],
        estimatedMonthly: null,
        budgetStatus: null,
        precheck: computation.counts,
        observationSec: 0,
        omitted: { workloads: 0, nodes: 0 },
        redactedCount: 0,
        bytes: 0,
      },
    };
  }

  private publish(p: PrecheckSnapshot): void {
    this.latest = p;
    const key = JSON.stringify([
      p.status.status,
      p.computation.items.map(itemKey),
      p.computation.sources,
    ]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.events.emit('advisor.precheck.updated', {
      precheck: this.overview(p),
      items: p.computation.items,
    });
  }
}

function itemKey(i: PrecheckItem): string {
  return `${i.ruleId}:${i.severity}:${i.targetCount}:${i.held}:${i.savings?.monthlyUsd ?? ''}`;
}
