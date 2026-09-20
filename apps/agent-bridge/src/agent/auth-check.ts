import {
  classifyAssistantError,
  looksLikeLoginProblem,
  resetsAtToIso,
} from './classify.js';
import type { PingAgentResult } from './ping.js';
import type { AuthState, BridgeState } from './state.js';

/** 계약 B.3.2 응답 */
export interface AuthCheckResponse {
  auth: { state: AuthState; checkedAt: string | null };
  usageLimit: { limited: boolean; retryAt: string | null };
  model: string | null;
  durationMs: number;
  costUsd: number | null;
}

/**
 * ping 결과로 인증·한도 상태를 판정하고 BridgeState를 갱신한다.
 * - 로그인 만료여도 오류가 아니라 auth.state = login_required
 * - 시간 초과·알 수 없는 오류는 unknown (상태를 추측하지 않는다)
 */
export function applyAuthCheck(
  ping: PingAgentResult,
  state: BridgeState,
): AuthCheckResponse {
  const code = classifyAssistantError(ping.assistantError ?? undefined);
  const texts = [ping.text, ping.error, ...(ping.result?.errors ?? [])];
  let auth: AuthState;
  if (
    code === 'login_required' ||
    texts.some((t) => looksLikeLoginProblem(t))
  ) {
    auth = 'login_required';
  } else if (ping.ok || code === 'usage_limit' || ping.rateLimit.rejected) {
    auth = 'ok';
  } else {
    auth = 'unknown';
  }
  if (auth !== 'unknown') state.setAuth(auth, 'auth_check');

  if (code === 'usage_limit' || ping.rateLimit.rejected) {
    state.setUsageLimit(
      true,
      resetsAtToIso(ping.rateLimit.resetsAt ?? undefined),
    );
  } else if (ping.ok) {
    state.setUsageLimit(false, null);
  }
  const usage = state.usageLimit;
  return {
    auth: {
      state: auth === 'unknown' ? state.auth.state : auth,
      checkedAt: state.auth.checkedAt,
    },
    usageLimit: { limited: usage.limited, retryAt: usage.retryAt },
    model: ping.session.model,
    durationMs: ping.elapsedMs,
    costUsd: ping.result?.totalCostUsd ?? null,
  };
}
