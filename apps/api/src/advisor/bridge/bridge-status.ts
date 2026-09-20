/**
 * 브리지 관측 → BridgeStatus (계약 A.1.1, A.3.1 판정표, 디자인 2.2 문구). 순수 함수.
 */
import type {
  BridgeState,
  BridgeStatus,
  DisabledReason,
  Reason,
  Status,
} from '../advisor.types';
import type { AdvisorScenario } from '../mock/advisor-scenario.state';
import type { BridgeHealth } from './bridge-client';

export type ObservationKind =
  'unknown' | 'ok' | 'unreachable' | 'token_mismatch' | 'claude_missing';

export interface BridgeObservation {
  kind: ObservationKind;
  health: BridgeHealth | null;
  /** 연결 실패 사유 한 줄 (예: "연결 거부") */
  detail: string | null;
  checkedAt: string | null;
}

export const UNKNOWN_OBSERVATION: BridgeObservation = {
  kind: 'unknown',
  health: null,
  detail: null,
  checkedAt: null,
};

export const BRIDGE_START_COMMAND = 'npm run dev --prefix apps/agent-bridge';

export const MESSAGES = {
  connected: '호스트의 Claude Code로 분석할 수 있습니다.',
  login:
    '호스트의 Claude Code 로그인이 만료됐습니다. 호스트 터미널에서 다시 로그인한 뒤 다시 확인하세요.',
  usage: 'Claude Code 사용량 한도에 도달했습니다.',
  unreachable:
    '어드바이저 브리지가 실행되고 있지 않습니다. 호스트에서 아래 명령으로 실행하세요.',
  token: '브리지 토큰이 맞지 않습니다 (AGENT_BRIDGE_TOKEN 확인)',
  claudeMissing: 'Claude Code 실행 파일을 찾을 수 없습니다',
  checking: '브리지 상태를 확인하고 있습니다.',
  mockExample: 'MOCK 모드: 브리지가 없어 예시 응답으로 전체 흐름을 보여줍니다.',
} as const;

export interface DeriveInput {
  dataSource: 'mock' | 'live';
  /** mock 모드에서 브리지를 실제로 부르는지 (ADVISOR_BRIDGE=live) */
  bridgeMode: 'mock' | 'live';
  scenario: AdvisorScenario | null;
  usageRetryAt: string | null;
  observation: BridgeObservation;
  runActive: boolean;
  now: Date;
  statusChangedAt: string | null;
}

const STATE_STATUS: Record<BridgeState, Status> = {
  connected: 'ok',
  login_required: 'warning',
  usage_limit: 'warning',
  unreachable: 'critical',
  unknown: 'unknown',
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

interface Core {
  state: BridgeState;
  message: string;
  command: string | null;
  retryAt: string | null;
  reason: Reason | null;
}

function coreFromObservation(o: BridgeObservation, now: Date): Core {
  switch (o.kind) {
    case 'unknown':
      return {
        state: 'unknown',
        message: MESSAGES.checking,
        command: null,
        retryAt: null,
        reason: null,
      };
    case 'unreachable':
      return {
        state: 'unreachable',
        message: MESSAGES.unreachable,
        command: BRIDGE_START_COMMAND,
        retryAt: null,
        reason: {
          code: 'BRIDGE_UNREACHABLE',
          text: `브리지 미실행 (${o.detail ?? '연결 실패'})`,
          status: 'critical',
        },
      };
    case 'token_mismatch':
      return {
        state: 'unreachable',
        message: MESSAGES.token,
        command: null,
        retryAt: null,
        reason: {
          code: 'BRIDGE_TOKEN_MISMATCH',
          text: '브리지 토큰이 맞지 않습니다',
          status: 'critical',
        },
      };
    case 'claude_missing':
      return {
        state: 'unreachable',
        message: MESSAGES.claudeMissing,
        command: null,
        retryAt: null,
        reason: {
          code: 'BRIDGE_CLAUDE_MISSING',
          text: 'Claude Code 실행 파일 없음',
          status: 'critical',
        },
      };
    case 'ok': {
      const h = o.health;
      if (h?.auth.state === 'login_required') {
        return {
          state: 'login_required',
          message: MESSAGES.login,
          command: 'claude',
          retryAt: null,
          reason: {
            code: 'BRIDGE_LOGIN_REQUIRED',
            text: 'Claude Code 로그인 필요',
            status: 'warning',
          },
        };
      }
      const retryAt = h?.usageLimit.retryAt ?? null;
      const stillLimited =
        h?.usageLimit.limited &&
        (!retryAt || Date.parse(retryAt) > now.getTime());
      if (stillLimited) {
        return {
          state: 'usage_limit',
          message: retryAt
            ? `${MESSAGES.usage} ${hhmm(retryAt)} 이후 다시 사용할 수 있습니다.`
            : MESSAGES.usage,
          command: null,
          retryAt,
          reason: {
            code: 'BRIDGE_USAGE_LIMIT',
            text: retryAt
              ? `사용량 한도 · ${hhmm(retryAt)} 이후 가능`
              : '사용량 한도',
            status: 'warning',
          },
        };
      }
      return {
        state: 'connected',
        message: MESSAGES.connected,
        command: null,
        retryAt: null,
        reason: null,
      };
    }
  }
}

function scenarioCore(
  scenario: AdvisorScenario,
  usageRetryAt: string | null,
): Core | null {
  switch (scenario) {
    case 'bridge-down':
      return coreFromObservation(
        { ...UNKNOWN_OBSERVATION, kind: 'unreachable', detail: '연결 거부' },
        new Date(0),
      );
    case 'login-required':
      return {
        state: 'login_required',
        message: MESSAGES.login,
        command: 'claude',
        retryAt: null,
        reason: {
          code: 'BRIDGE_LOGIN_REQUIRED',
          text: 'Claude Code 로그인 필요',
          status: 'warning',
        },
      };
    case 'usage-limit':
      return {
        state: 'usage_limit',
        message: usageRetryAt
          ? `${MESSAGES.usage} ${hhmm(usageRetryAt)} 이후 다시 사용할 수 있습니다.`
          : MESSAGES.usage,
        command: null,
        retryAt: usageRetryAt,
        reason: {
          code: 'BRIDGE_USAGE_LIMIT',
          text: usageRetryAt
            ? `사용량 한도 · ${hhmm(usageRetryAt)} 이후 가능`
            : '사용량 한도',
          status: 'warning',
        },
      };
    case 'delayed':
    case 'timeout':
    case 'invalid-response':
    case 'budget-exceeded':
      return {
        state: 'connected',
        message: MESSAGES.connected,
        command: null,
        retryAt: null,
        reason: null,
      };
    default:
      return null;
  }
}

/** 브리지 쪽 상태만으로 본 "이 흐름이 예시 응답인가" (mock 전용) */
export function isExampleMode(
  input: Omit<DeriveInput, 'runActive' | 'statusChangedAt'>,
): boolean {
  if (input.dataSource !== 'mock' || !input.scenario) return false;
  const s = input.scenario;
  if (
    s === 'example' ||
    s === 'delayed' ||
    s === 'timeout' ||
    s === 'invalid-response' ||
    s === 'budget-exceeded'
  ) {
    return true;
  }
  if (s !== 'normal') return false;
  if (input.bridgeMode === 'mock') return true;
  // ADVISOR_BRIDGE=live: 브리지가 없으면 예시 응답
  return input.observation.kind !== 'ok';
}

export function deriveBridgeStatus(input: DeriveInput): BridgeStatus {
  const mockScenario = input.dataSource === 'mock' ? input.scenario : null;
  const example = isExampleMode(input);
  let core: Core | null = mockScenario
    ? scenarioCore(mockScenario, input.usageRetryAt)
    : null;
  if (!core) {
    if (input.dataSource === 'mock' && input.bridgeMode === 'mock') {
      core = {
        state: 'unreachable',
        message: MESSAGES.mockExample,
        command: null,
        retryAt: null,
        reason: null,
      };
    } else {
      core = coreFromObservation(input.observation, input.now);
      if (example && core.state !== 'connected') {
        core = {
          ...core,
          message: MESSAGES.mockExample,
          command: BRIDGE_START_COMMAND,
        };
      }
    }
  }
  const h = input.observation.health;
  const busy = input.runActive || (h?.busy ?? false);

  let disabledReason: DisabledReason = null;
  if (input.runActive) disabledReason = 'run_in_progress';
  else if (!example) {
    if (core.state === 'unreachable') disabledReason = 'bridge_unreachable';
    else if (core.state === 'login_required') disabledReason = 'login_required';
    else if (core.state === 'usage_limit') disabledReason = 'usage_limit';
    else if (core.state === 'unknown') disabledReason = 'checking';
    else if (h?.busy) disabledReason = 'dashboard_busy';
  }
  const checkedAt = input.observation.checkedAt;
  const stale =
    checkedAt !== null &&
    input.now.getTime() - Date.parse(checkedAt) > 90_000 &&
    !(input.dataSource === 'mock' && input.bridgeMode === 'mock');
  return {
    state: core.state,
    status: {
      status: STATE_STATUS[core.state],
      reasons: core.reason ? [core.reason] : [],
      updatedAt: checkedAt ?? (mockScenario ? input.now.toISOString() : null),
      statusChangedAt: input.statusChangedAt,
      stale,
    },
    message: core.message,
    command: core.command,
    retryAt: core.retryAt,
    checkedAt,
    authCheckedAt: h?.auth.checkedAt ?? null,
    sdkVersion: h?.sdkVersion ?? null,
    claudeCodeVersion: h?.claudeCodeVersion ?? null,
    busy,
    canRun: disabledReason === null,
    disabledReason,
    exampleMode: example,
  };
}
