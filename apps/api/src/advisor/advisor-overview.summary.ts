import { Injectable } from '@nestjs/common';
import { filter, map, type Observable } from 'rxjs';
import {
  OverviewSummaryProviderDecorator,
  type OverviewSummaryProvider,
} from '../common/overview-summary';
import type { StatusInfo } from '../common/status';
import { AdvisorEvents } from './advisor-events';
import type { BridgeState, RunStatus } from './advisor.types';
import { AdvisorBridgeService } from './bridge/advisor-bridge.service';
import { AdvisorPrecheckService } from './precheck/advisor-precheck.service';
import { AdvisorRunService } from './run/advisor-run.service';

/** 개요 advisor 블록 (docs/api/cluster-status.md 2.1 예시) */
export interface AdvisorOverviewSummary {
  status: StatusInfo;
  precheck: {
    status: StatusInfo['status'];
    high: number;
    medium: number;
    low: number;
    held: number;
  };
  lastRun: {
    id: string;
    status: RunStatus;
    finishedAt: string | null;
    suggestionCount: number;
  } | null;
  bridge: BridgeState;
  busy: boolean;
  available: boolean;
}

/** 개요가 다시 계산해야 하는 이벤트 (진행 이벤트는 잦아서 제외 — 시작·종료는 bridge.updated/run.finished로 온다) */
const RELEVANT = new Set([
  'advisor.precheck.updated',
  'advisor.run.finished',
  'advisor.bridge.updated',
  'advisor.snapshot',
]);

/**
 * 개요 화면의 어드바이저 요약 카드 + 사이드바 상태 점(`nav.advisor`, `nav.advisorBusy`).
 * 상태 값은 사전 점검 요약 상태(architecture-advisor A.2 `precheck.status`)를 쓴다.
 */
@Injectable()
@OverviewSummaryProviderDecorator()
export class AdvisorOverviewSummaryProvider implements OverviewSummaryProvider {
  readonly section = 'advisor' as const;
  readonly changes$: Observable<void>;

  constructor(
    private readonly prechecks: AdvisorPrecheckService,
    private readonly runs: AdvisorRunService,
    private readonly bridge: AdvisorBridgeService,
    events: AdvisorEvents,
  ) {
    this.changes$ = events.events$.pipe(
      filter((e) => RELEVANT.has(e.event)),
      map(() => undefined),
    );
  }

  busy(): boolean {
    return this.runs.hasActiveRun;
  }

  async summary(): Promise<AdvisorOverviewSummary> {
    const p = await this.prechecks.current(false);
    const overview = this.prechecks.overview(p);
    const last = await this.runs.lastRun();
    return {
      status: overview.status,
      precheck: { status: overview.status.status, ...overview.counts },
      lastRun: last
        ? {
            id: last.id,
            status: last.status,
            finishedAt: last.finishedAt,
            suggestionCount: last.counts.suggestions,
          }
        : null,
      bridge: this.bridge.status().state,
      busy: this.runs.hasActiveRun,
      available: true,
    };
  }
}
