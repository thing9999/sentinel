/**
 * logs 모듈이 다른 모듈에 제공하는 확장점.
 * - mock 시나리오 API: group `logs`
 *
 * **공용 스트림(TopicSource)은 제공하지 않는다.** 로그는 전용 연결이고
 * `GET /api/stream?topics=logs`는 400이다 (AC-LOG22).
 */
import { Injectable } from '@nestjs/common';
import {
  MockScenarioTargetProvider,
  type MockScenarioTarget,
} from '../common/extension-points';
import { LogsService } from './logs.service';

@Injectable()
@MockScenarioTargetProvider()
export class LogsMockScenarioTarget implements MockScenarioTarget {
  readonly group = 'logs' as const;
  readonly scenarios: readonly string[];
  readonly options;
  readonly defaultScenario = 'direct';

  constructor(private readonly logs: LogsService) {
    this.scenarios = logs.scenarios;
    this.options = logs.scenarioOptions;
  }

  currentScenario(): string {
    return this.logs.currentScenario();
  }

  setScenario(name: string): void {
    this.logs.setScenario(name);
  }
}
