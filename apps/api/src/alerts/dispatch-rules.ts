/**
 * "이 알림을 디스코드로 보낼까" 판정 (순수 함수). docs/api/alerts.md 3.1.
 *
 * **여기서 네트워크를 건드리지 않는다.** 판정과 발송을 나눠 둔 이유:
 * - `mock`에서 아웃바운드 0건인 것을 **함수 반환값으로** 검사할 수 있다 (AC-ALERT26)
 * - `skipped_*`가 **오류가 아니라 판단 결과**라는 것이 타입으로 드러난다
 * - `skipped_no_pair`·`skipped_circuit_open`을 `failed`로 뭉뚱그리지 않는다 —
 *   나누려고 DBA가 enum 마이그레이션을 따로 냈고, 뭉뚱그리면 "왜 안 갔나"를 추적할 수 없다
 */
import type { AlertKind, AlertSeverity, DispatchState } from './alerts.types';

export interface DispatchContext {
  /** `ALERTS_DISPATCH` 또는 `DATA_SOURCE` */
  mode: 'mock' | 'live';
  /** 웹훅 주소가 저장돼 있거나 환경 변수로 들어와 있다 */
  configured: boolean;
  enabled: boolean;
  minSeverity: 'critical' | 'warning';
  sendUnknown: boolean;
  /** 이 키가 플래핑 상태다 — 진입 이후 그 키의 발송을 멈춘다 */
  flapping: boolean;
  /** 연속 실패로 발송이 멈춰 있다 */
  circuitOpen: boolean;
  /**
   * 해제 알림일 때: 짝이 되는 발생 알림을 **이 채널로 실제 보냈는가**.
   * 보내지 않았으면 해제도 보내지 않는다 — 앞뒤 없는 "복구됨"만 채널에 뜨는 것을 막는다.
   */
  parentDispatched: boolean;
}

export interface DispatchVerdict {
  /** `'send'`면 발송기가 실제로 요청을 만든다. 그 밖에는 **기록만 남긴다** */
  action: 'send' | 'skip' | 'none';
  state: DispatchState | null;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  unknown: 1,
  resolved: 0,
};

/**
 * 판정 순서가 곧 우선순위다. 위쪽이 이긴다.
 * `restart_summary`는 규칙상 채널로 보내지 않으므로 **기록 자체를 만들지 않는다**.
 */
export function decideDispatch(
  kind: AlertKind,
  severity: AlertSeverity,
  ctx: DispatchContext,
): DispatchVerdict {
  // 재시작은 사용자가 한 일이라 채널로 보내지 않는다 (명세 3.2.5)
  if (kind === 'restart_summary') return { action: 'none', state: null };

  // **mock이면 여기서 끝난다.** 아래로 내려가지 않으므로 아웃바운드가 0건이다
  if (ctx.mode === 'mock') return { action: 'skip', state: 'skipped_mock' };

  if (!ctx.configured)
    return { action: 'skip', state: 'skipped_not_configured' };
  if (!ctx.enabled) return { action: 'skip', state: 'skipped_disabled' };
  if (ctx.circuitOpen) return { action: 'skip', state: 'skipped_circuit_open' };
  if (ctx.flapping) return { action: 'skip', state: 'skipped_flapping' };

  // 테스트 발송은 심각도 규칙을 타지 않는다 (사용자가 방금 누른 버튼이다)
  if (kind === 'test') return { action: 'send', state: 'pending' };

  if (kind === 'resolve') {
    // 짝 없는 "복구됨"을 막는다 (AC-ALERT32)
    return ctx.parentDispatched
      ? { action: 'send', state: 'pending' }
      : { action: 'skip', state: 'skipped_no_pair' };
  }

  if (severity === 'unknown') {
    // `unknown`은 심각도 순서와 **별개 축**이다 (명세 3.2.4)
    return ctx.sendUnknown
      ? { action: 'send', state: 'pending' }
      : { action: 'skip', state: 'skipped_unknown_off' };
  }

  if (SEVERITY_RANK[severity] < SEVERITY_RANK[ctx.minSeverity])
    return { action: 'skip', state: 'skipped_severity' };

  return { action: 'send', state: 'pending' };
}

/** 지수 백오프. 목록을 다 쓰면 포기(`failed`) */
export function nextAttemptDelaySec(
  attempts: number,
  backoffSec: readonly number[],
): number | null {
  return attempts >= backoffSec.length ? null : backoffSec[attempts];
}

/** 429는 서버가 알려준 대기 시간을 지킨다. 값이 없거나 이상하면 백오프로 */
export function retryAfterSec(
  header: string | null,
  fallbackSec: number,
): number {
  if (!header) return fallbackSec;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 3600);
  const at = Date.parse(header);
  if (Number.isFinite(at)) {
    return Math.min(Math.max(0, Math.ceil((at - Date.now()) / 1000)), 3600);
  }
  return fallbackSec;
}
