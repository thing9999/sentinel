/**
 * 실패 사유 ↔ 사용자 문구, 브리지 결과 → 실패 사유 매핑 (계약 A.9, B.6)
 */
import { sanitizeErrorMessage } from '../../database/health/sanitize';
import type { FailureReason } from '../advisor.types';

export function failureMessage(
  reason: FailureReason,
  opts: {
    timeoutSec?: number;
    maxBudgetUsd?: number;
    retryAt?: string | null;
    detail?: string;
  } = {},
): string {
  switch (reason) {
    case 'login_required':
      return '호스트의 Claude Code 로그인이 만료됐습니다. 호스트 터미널에서 `claude`로 다시 로그인한 뒤 재시도하세요.';
    case 'bridge_unavailable':
      return opts.detail
        ? `어드바이저 브리지에 연결할 수 없습니다 (${opts.detail}).`
        : '어드바이저 브리지에 연결할 수 없습니다.';
    case 'usage_limit':
      return opts.retryAt
        ? `Claude Code 사용량 한도에 도달했습니다. ${formatHm(opts.retryAt)} 이후 다시 사용할 수 있습니다.`
        : 'Claude Code 사용량 한도에 도달했습니다.';
    case 'timeout': {
      const sec = opts.timeoutSec ?? 600;
      const label = sec % 60 === 0 ? `${sec / 60}분` : `${sec}초`;
      return `브리지가 ${label} 안에 응답을 마치지 못했습니다.`;
    }
    case 'invalid_response':
      return '응답을 제안 형식으로 해석할 수 없었습니다.';
    case 'budget_exceeded':
      return `분석 비용이 상한 $${(opts.maxBudgetUsd ?? 2).toFixed(2)}을 넘어 중단했습니다.`;
    case 'interrupted':
      return 'API 서버가 재시작되어 분석이 중단됐습니다.';
    case 'other':
    default:
      return opts.detail
        ? sanitizeErrorMessage(opts.detail, 500)
        : '분석 중 오류가 발생했습니다.';
  }
}

/** UTC ISO → HH:mm (UTC). 화면은 retryAt을 로컬 시각으로 다시 쓸 수 있다 */
function formatHm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} (UTC)`;
}

export interface MappedFailure {
  reason: FailureReason;
  detail?: string;
  retryAt?: string | null;
  /** api 로그에 남길 오류 수준 (보안 신호 등) */
  logLevel?: 'warn' | 'error';
}

/** NDJSON error 줄 code → 실패 사유 */
export function mapBridgeErrorCode(
  code: string,
  message?: string,
  retryAt?: string | null,
): MappedFailure {
  switch (code) {
    case 'login_required':
      return { reason: 'login_required' };
    case 'usage_limit':
      return { reason: 'usage_limit', retryAt: retryAt ?? null };
    case 'timeout':
      return { reason: 'timeout' };
    case 'claude_code_missing':
      return {
        reason: 'bridge_unavailable',
        detail: 'Claude Code 실행 파일 없음',
      };
    case 'unsafe_configuration':
      return {
        reason: 'other',
        detail: '브리지 안전 설정 이상으로 분석을 중단했습니다.',
        logLevel: 'error',
      };
    case 'aborted':
      return { reason: 'bridge_unavailable', detail: '브리지가 분석을 중단함' };
    default:
      return { reason: 'other', detail: message ?? '브리지 내부 오류' };
  }
}

/** NDJSON result subtype → 실패 사유 (success는 null) */
export function mapResultSubtype(
  subtype: string,
  isError: boolean,
): FailureReason | null {
  switch (subtype) {
    case 'success':
      return isError ? 'other' : null;
    case 'error_max_budget_usd':
      return 'budget_exceeded';
    case 'error_max_turns':
    case 'error_max_structured_output_retries':
      return 'invalid_response';
    default:
      return 'other';
  }
}

/** 요청 단계 HTTP 오류 → 실패 사유 (B.6) */
export function mapBridgeHttpStatus(
  status: number,
  code?: string,
): MappedFailure {
  if (status === 401 || status === 403) {
    return {
      reason: 'bridge_unavailable',
      detail: '브리지 토큰이 맞지 않습니다 (AGENT_BRIDGE_TOKEN 확인)',
    };
  }
  if (status === 409) {
    return { reason: 'other', detail: '브리지가 다른 분석을 실행 중입니다.' };
  }
  if (status === 503 || code === 'claude_code_missing') {
    return {
      reason: 'bridge_unavailable',
      detail: 'Claude Code 실행 파일 없음',
    };
  }
  if (status >= 500)
    return { reason: 'bridge_unavailable', detail: `HTTP ${status}` };
  return {
    reason: 'other',
    detail: `브리지가 요청을 거부했습니다 (HTTP ${status}${code ? ` ${code}` : ''})`,
  };
}
