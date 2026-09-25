import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { EMPTY, merge, Observable } from 'rxjs';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { discoverProviders } from '../common/discovery';
import {
  OVERVIEW_SUMMARY_METADATA,
  type OverviewSummaryProvider,
} from '../common/overview-summary';
import { SourceRegistry } from '../common/source-registry.service';
import { worstStatus, type Status, type StatusInfo } from '../common/status';
import type { DataSourceMode } from '../config/env.validation';
import { ClusterStateService } from './state/cluster-state.service';

const UNKNOWN_STATUS = (text: string): StatusInfo => ({
  status: 'unknown',
  reasons: [{ code: 'SOURCE_UNAVAILABLE', text, status: 'unknown' }],
  updatedAt: null,
  statusChangedAt: null,
  stale: false,
});

/**
 * `GET /api/overview` (docs/api/cluster-status.md 2.1).
 * 비용·어드바이저 요약은 `@OverviewSummaryProviderDecorator()` 제공자가 있으면 채우고, 없으면 available: false.
 */
@Injectable()
export class OverviewService implements OnApplicationBootstrap {
  private providers: OverviewSummaryProvider[] = [];
  /** 제공자 요약이 바뀌었을 때 */
  providerChanges$: Observable<unknown> = EMPTY;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly state: ClusterStateService,
    private readonly registry: SourceRegistry,
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    this.providers = discoverProviders<OverviewSummaryProvider>(
      this.discovery,
      this.reflector,
      OVERVIEW_SUMMARY_METADATA,
    );
    const streams = this.providers
      .map((p) => p.changes$)
      .filter((s): s is Observable<void> => Boolean(s));
    this.providerChanges$ = streams.length ? merge(...streams) : EMPTY;
  }

  private provider(section: 'cost' | 'advisor') {
    return this.providers.find((p) => p.section === section) ?? null;
  }

  private async safeSummary(section: 'cost' | 'advisor') {
    const p = this.provider(section);
    if (!p) return null;
    try {
      return await p.summary();
    } catch {
      return null;
    }
  }

  async overview() {
    const v = this.state.getView();
    const [cost, advisor] = await Promise.all([
      this.safeSummary('cost'),
      this.safeSummary('advisor'),
    ]);
    const kubeStale = this.registry.get('kube').state === 'stale';
    const dbStale = v.areas.db.status.stale;
    const costBlock = cost ?? {
      status: UNKNOWN_STATUS('비용 정보 없음'),
      rate: null,
      monthToDate: null,
      budgetStatus: null,
      available: false,
    };
    const advisorBlock = advisor ?? {
      status: UNKNOWN_STATUS('어드바이저 정보 없음'),
      precheck: null,
      lastRun: null,
      bridge: null,
      busy: false,
      available: false,
    };
    const advisorStatus: Status =
      (advisor as { status?: StatusInfo } | null)?.status?.status ??
      (advisor as { precheck?: { status?: Status } } | null)?.precheck
        ?.status ??
      'unknown';
    const advisorP = this.provider('advisor');
    return {
      dataSource: this.dataSource,
      generatedAt: v.atIso,
      cluster: this.state.clusterInfo(),
      overall: v.overall,
      areas: v.areas,
      attention: { total: v.attention.length, items: v.attention.slice(0, 8) },
      nav: {
        overview: v.overall.status,
        // 컨트롤 플레인 메뉴를 신설하지 않는다(PM 결정 Q2) — 워커 영역과 컨트롤 플레인 영역의 최악
        nodes: worstStatus([
          v.areas.nodes.status.status,
          v.areas.controlPlane.status.status,
        ]),
        workloads: v.areas.workloads.status.status,
        pods: v.areas.pods.status.status,
        events: v.areas.events.status.status,
        db: v.areas.db.status.status,
        cost: costBlock.status.status,
        advisor: advisorStatus,
        advisorBusy: advisorP?.busy?.() ?? false,
        stale: {
          nodes: kubeStale || v.areas.controlPlane.status.stale,
          workloads: kubeStale,
          pods: kubeStale,
          events: kubeStale,
          db: dbStale,
          cost: costBlock.status.stale,
          advisor:
            (advisor as { status?: StatusInfo } | null)?.status?.stale ?? false,
        },
      },
      cost: costBlock,
      advisor: advisorBlock,
    };
  }
}
