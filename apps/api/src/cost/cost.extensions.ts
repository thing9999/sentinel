/**
 * cost 모듈이 다른 모듈에 제공하는 확장점 (DiscoveryService로 자동 발견).
 * - StreamModule(A): TopicSource `cost`
 * - mock 시나리오 API(A): MockScenarioTarget group `cost`
 * - AdvisorModule(C): AdvisorSnapshotContributor section `cost`
 * - 개요(A): OverviewSummaryProvider section `cost`
 */
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import {
  AdvisorSnapshotContributorProvider,
  MockScenarioTargetProvider,
  TopicSourceProvider,
  type AdvisorSnapshotContributor,
  type MockScenarioTarget,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import {
  OverviewSummaryProviderDecorator,
  type OverviewSummaryProvider,
} from '../common/overview-summary';
import type { StatusInfo } from '../common/status';
import { CostService } from './cost.service';
import { COST_SCENARIO_OPTIONS, COST_SCENARIOS } from './mock/mock-world';
import { map, filter } from 'rxjs';

@Injectable()
@TopicSourceProvider()
export class CostTopicSource implements TopicSource {
  readonly topic = 'cost';
  readonly events$: Observable<TopicEvent>;

  constructor(private readonly cost: CostService) {
    this.events$ = cost.events$;
  }

  async snapshot(): Promise<TopicEvent[]> {
    return [
      { event: 'cost.snapshot', data: await this.cost.snapshotPayload() },
    ];
  }
}

@Injectable()
@MockScenarioTargetProvider()
export class CostMockScenarioTarget implements MockScenarioTarget {
  readonly group = 'cost' as const;
  readonly scenarios: readonly string[] = COST_SCENARIOS;
  /** 화면 메뉴용 이름·설명 (common.md 6.1 options) */
  readonly options = COST_SCENARIO_OPTIONS;
  readonly defaultScenario = 'normal';

  constructor(private readonly cost: CostService) {}

  currentScenario(): string {
    return this.cost.currentScenario();
  }

  setScenario(name: string): void {
    this.cost.setScenario(name);
  }
}

@Injectable()
@AdvisorSnapshotContributorProvider()
export class CostAdvisorSnapshot implements AdvisorSnapshotContributor {
  readonly section = 'cost' as const;

  constructor(private readonly cost: CostService) {}

  contribute(): Promise<unknown> {
    return this.cost.advisorCostBlock();
  }
}

@Injectable()
@OverviewSummaryProviderDecorator()
export class CostOverviewSummary implements OverviewSummaryProvider {
  readonly section = 'cost' as const;
  readonly changes$: Observable<void>;

  constructor(private readonly cost: CostService) {
    this.changes$ = cost.events$.pipe(
      filter(
        (e) =>
          e.event !== 'cost.refresh.updated' && e.event !== 'cost.rate.sampled',
      ),
      map(() => undefined),
    );
  }

  summary(): Promise<{ status: StatusInfo; available: boolean } & object> {
    return this.cost.overviewSummary();
  }
}
