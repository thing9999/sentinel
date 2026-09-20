import { Injectable } from '@nestjs/common';

export const ADVISOR_SCENARIOS = [
  'normal',
  'example',
  'bridge-down',
  'login-required',
  'usage-limit',
  'delayed',
  'timeout',
  'invalid-response',
  'budget-exceeded',
] as const;
export type AdvisorScenario = (typeof ADVISOR_SCENARIOS)[number];

/** 브리지 상태가 연결됨으로 보이지만 예시 흐름이 실패/지연하는 시나리오 */
export const SIMULATED_RUN_SCENARIOS: readonly AdvisorScenario[] = [
  'delayed',
  'timeout',
  'invalid-response',
  'budget-exceeded',
];

/** mock 어드바이저 시나리오 상태 (프로세스 메모리, 재시작하면 기본값) — common.md 6절 */
@Injectable()
export class AdvisorScenarioState {
  scenario: AdvisorScenario = 'normal';
  /** mock에서 지연 10초 / 시간 초과 20초 (예시 흐름에만 적용) */
  fastTimers = true;
  /** usage-limit 시나리오의 다시 가능 시각 */
  usageRetryAt: string | null = null;
  /** 시나리오가 바뀐 횟수 (상태 변경 감지용) */
  version = 0;

  set(name: AdvisorScenario, now = new Date()): void {
    this.scenario = name;
    this.usageRetryAt =
      name === 'usage-limit'
        ? new Date(now.getTime() + 90 * 60_000).toISOString()
        : null;
    this.version += 1;
  }

  reset(): void {
    this.scenario = 'normal';
    this.fastTimers = true;
    this.usageRetryAt = null;
    this.version += 1;
  }
}
