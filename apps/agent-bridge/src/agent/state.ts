/**
 * 브리지 프로세스 상태: 마지막 인증·사용량 한도 확인 결과, 실행 중인 작업(동시 1건)
 * GET /health가 이 값을 그대로 보여준다 (LLM 호출 없음).
 */

export type AuthState = 'ok' | 'login_required' | 'unknown';
export type AuthSource = 'auth_check' | 'advise';

export interface ActiveJob {
  runId: string;
  kind: 'advise' | 'auth_check';
  abortController: AbortController;
  startedAt: number;
}

export class BridgeState {
  auth: {
    state: AuthState;
    checkedAt: string | null;
    source: AuthSource | null;
  } = { state: 'unknown', checkedAt: null, source: null };
  private usage: {
    limited: boolean;
    retryAt: string | null;
    checkedAt: string | null;
  } = { limited: false, retryAt: null, checkedAt: null };
  active: ActiveJob | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  setAuth(state: AuthState, source: AuthSource): void {
    this.auth = {
      state,
      checkedAt: new Date(this.now()).toISOString(),
      source,
    };
  }

  setUsageLimit(limited: boolean, retryAt: string | null): void {
    this.usage = {
      limited,
      retryAt: limited ? retryAt : null,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }

  /** retryAt이 지나면 한도 해제로 본다 */
  get usageLimit(): {
    limited: boolean;
    retryAt: string | null;
    checkedAt: string | null;
  } {
    if (
      this.usage.limited &&
      this.usage.retryAt &&
      Date.parse(this.usage.retryAt) <= this.now()
    ) {
      this.usage = { ...this.usage, limited: false, retryAt: null };
    }
    return { ...this.usage };
  }

  get busy(): boolean {
    return this.active !== null;
  }

  /** 동시 1건. 이미 실행 중이면 false */
  tryAcquire(job: ActiveJob): boolean {
    if (this.active) return false;
    this.active = job;
    return true;
  }

  release(runId: string): void {
    if (this.active?.runId === runId) this.active = null;
  }
}
