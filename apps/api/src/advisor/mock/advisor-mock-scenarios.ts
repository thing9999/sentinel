import { Injectable } from '@nestjs/common';
import {
  MockScenarioTargetProvider,
  type MockScenarioTarget,
} from '../../common/extension-points';
import { ApiError } from '../api-error';
import { AdvisorTopicSource } from '../advisor-topic.source';
import { AdvisorBridgeService } from '../bridge/advisor-bridge.service';
import { AdvisorRunService } from '../run/advisor-run.service';
import {
  ADVISOR_SCENARIOS,
  AdvisorScenarioState,
  type AdvisorScenario,
} from './advisor-scenario.state';

/** 시나리오 설명 (GET /api/mock/scenarios options용, A가 쓸 수 있게 공개) */
export const ADVISOR_SCENARIO_OPTIONS: {
  id: AdvisorScenario;
  label: string;
  description: string;
}[] = [
  {
    id: 'normal',
    label: '기본',
    description:
      '브리지가 켜져 있으면(ADVISOR_BRIDGE=live) mock 스냅샷으로 실제 분석, 아니면 예시 응답',
  },
  {
    id: 'example',
    label: '예시 응답',
    description: '브리지 상태와 무관하게 예시 응답',
  },
  {
    id: 'bridge-down',
    label: '브리지 미실행',
    description: '분석 실행 버튼 비활성',
  },
  {
    id: 'login-required',
    label: '로그인 필요',
    description: 'Claude Code 로그인 만료',
  },
  { id: 'usage-limit', label: '사용량 한도', description: '90분 뒤 다시 가능' },
  { id: 'delayed', label: '지연', description: '예시 흐름이 지연 기준을 넘김' },
  {
    id: 'timeout',
    label: '시간 초과',
    description: '예시 흐름이 시간 초과로 실패',
  },
  {
    id: 'invalid-response',
    label: '응답 형식 오류',
    description: '원문 디버그 영역 포함',
  },
  {
    id: 'budget-exceeded',
    label: '비용 상한 초과',
    description: 'maxBudgetUsd 초과로 실패',
  },
];

/**
 * mock 시나리오 전환 대상 (group 'advisor'). 분석 진행 중에는 바꿀 수 없다 (409 RUN_ACTIVE).
 * fastTimers(지연 10초/시간 초과 20초)는 setFastTimers로 바꾼다.
 */
@Injectable()
@MockScenarioTargetProvider()
export class AdvisorMockScenarios implements MockScenarioTarget {
  readonly group = 'advisor' as const;
  readonly scenarios: readonly string[] = ADVISOR_SCENARIOS;
  readonly options = ADVISOR_SCENARIO_OPTIONS;

  constructor(
    private readonly state: AdvisorScenarioState,
    private readonly runs: AdvisorRunService,
    private readonly bridge: AdvisorBridgeService,
    private readonly topic: AdvisorTopicSource,
  ) {}

  currentScenario(): string {
    return this.state.scenario;
  }

  get fastTimers(): boolean {
    return this.state.fastTimers;
  }

  setFastTimers(value: boolean): void {
    this.state.fastTimers = value;
  }

  setScenario(name: string): void {
    if (!(ADVISOR_SCENARIOS as readonly string[]).includes(name)) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        `알 수 없는 어드바이저 시나리오: ${name}`,
        {
          fields: [
            {
              field: 'scenario',
              value: name,
              constraints: [
                `scenario must be one of: ${ADVISOR_SCENARIOS.join(', ')}`,
              ],
            },
          ],
        },
      );
    }
    if (this.runs.hasActiveRun) {
      throw new ApiError(
        409,
        'RUN_ACTIVE',
        '분석이 진행 중이라 시나리오를 바꿀 수 없습니다. 진행 중 실행을 먼저 취소하세요.',
      );
    }
    this.state.set(name as AdvisorScenario);
    this.bridge.emitIfChanged();
    void this.topic.republish();
  }
}
