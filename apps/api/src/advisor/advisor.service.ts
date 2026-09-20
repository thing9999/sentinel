import { Injectable } from '@nestjs/common';
import { AdvisorEvents } from './advisor-events';
import { AdvisorSettingsService } from './advisor-settings.service';
import type {
  BridgeStatus,
  Category,
  PrecheckItem,
  PrecheckOverview,
  Run,
  RunSummary,
  Severity,
  SnapshotSummary,
} from './advisor.types';
import { ApiError } from './api-error';
import { AdvisorBridgeService } from './bridge/advisor-bridge.service';
import { AdvisorPrecheckService } from './precheck/advisor-precheck.service';
import { countPrechecks, precheckMatrix } from './precheck/precheck-rules';
import { AdvisorRunRepository } from './run/advisor-run.repository';
import { AdvisorRunService } from './run/advisor-run.service';
import { AdvisorSnapshotService } from './snapshot/advisor-snapshot.service';
import type { SnapshotMeta } from './snapshot/snapshot-builder';
import type { AdvisorSnapshotV1 } from './snapshot/snapshot.types';

export interface AdvisorOverview {
  dataSource: 'mock' | 'live';
  generatedAt: string;
  persistence: 'database' | 'memory';
  bridge: BridgeStatus;
  activeRun: Run | null;
  lastRun: RunSummary | null;
  latestResult: Run | null;
  precheck: PrecheckOverview;
  history: { total: number; retention: { maxCount: number; maxDays: number } };
}

export interface PrecheckQuery {
  includeSystem: boolean;
  category: Category[] | null;
  severity: Severity[] | null;
  held: boolean | null;
}

/** 화면 상태 조회 (GET /api/advisor 등) */
@Injectable()
export class AdvisorService {
  constructor(
    private readonly settings: AdvisorSettingsService,
    private readonly bridge: AdvisorBridgeService,
    private readonly runs: AdvisorRunService,
    private readonly prechecks: AdvisorPrecheckService,
    private readonly snapshots: AdvisorSnapshotService,
    private readonly events: AdvisorEvents,
    private readonly repo: AdvisorRunRepository,
  ) {}

  touch(): void {
    this.events.touch();
    this.bridge.ensureFresh();
  }

  async overview(): Promise<AdvisorOverview> {
    const s = await this.settings.get();
    if (!this.prechecks.latestSummary) await this.prechecks.current(false);
    const [lastRun, latestResult, total] = await Promise.all([
      this.runs.lastRun(),
      this.runs.latestResult(),
      this.runs.historyTotal(),
    ]);
    return {
      dataSource: this.settings.dataSource,
      generatedAt: new Date().toISOString(),
      persistence: this.repo.persistence,
      bridge: this.bridge.status(),
      activeRun: this.runs.activeRun(),
      lastRun,
      latestResult,
      precheck: this.prechecks.overview(),
      history: { total, retention: s.retention },
    };
  }

  async prechecksView(q: PrecheckQuery) {
    const p = await this.prechecks.current(q.includeSystem);
    const items = p.computation.items.filter(
      (i: PrecheckItem) =>
        (!q.category || q.category.includes(i.category)) &&
        (!q.severity ||
          (i.severity !== null && q.severity.includes(i.severity))) &&
        (q.held === null || i.held === q.held),
    );
    const overview = this.prechecks.overview(p);
    return {
      dataSource: this.settings.dataSource,
      generatedAt: new Date().toISOString(),
      computedAt: p.computedAt,
      intervalSec: overview.intervalSec,
      includeSystem: q.includeSystem,
      status: overview.status,
      counts: countPrechecks(p.computation.items),
      matrix: precheckMatrix(p.computation.items),
      sources: p.computation.sources,
      items,
    };
  }

  async snapshotPreview(includeSystem: boolean): Promise<{
    dataSource: 'mock' | 'live';
    generatedAt: string;
    meta: SnapshotMeta;
    summary: SnapshotSummary;
    snapshot: AdvisorSnapshotV1;
  }> {
    const { built, collected } = await this.snapshots.build(includeSystem);
    if (!built) {
      throw new ApiError(
        503,
        'SNAPSHOT_UNAVAILABLE',
        '클러스터·비용 데이터가 없어 스냅샷을 만들 수 없습니다.',
        {
          sources: collected.origin,
        },
      );
    }
    return {
      dataSource: this.settings.dataSource,
      generatedAt: new Date().toISOString(),
      meta: built.meta,
      summary: built.summary,
      snapshot: built.snapshot,
    };
  }
}
