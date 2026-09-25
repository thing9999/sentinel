/**
 * `/settings → 알림` 계약 타입 (docs/api/alerts.md 2.5~2.7). 계약에 없는 필드는 두지 않는다.
 *
 * **웹훅 원문을 담는 필드가 없다.** 서버는 `hint`(끝 4자)·`length`만 준다(AC-ALERT20).
 * 화면에서 원문이 사는 곳은 입력 중인 `useState` 하나뿐이고, 저장에 성공하면 바로 비운다.
 */
import type { AlertKey, AlertNotice, DispatchState } from "../alerts/types";
import type { ApiStatusValue, DataSource, IsoTime } from "../common/types";

export type DispatchMode = "mock" | "live";
export type MinSeverity = "critical" | "warning";

/** 계약 2.5 `lockedByEnvDetail[]` — "왜 못 고치는지"가 응답에 있다 */
export interface LockedField {
  /** 필드 이름(`webhookUrl`·`dispatchMode`). `lockedByEnv[]`와 같은 값 */
  field: string;
  /** 환경 변수 이름. **`SecretInput.lockedByEnv` prop 에는 이 값을 넣는다**(필드 이름이 아니다) */
  envVar: string;
  text: string;
}

export interface LastDispatch {
  at: IsoTime;
  state: DispatchState;
  responseCode: number | null;
  /** 가림 처리된 서버 문구 그대로 */
  detail: string | null;
}

export interface CircuitBreaker {
  open: boolean;
  consecutiveFailures: number;
  openedAt: IsoTime | null;
  resumeAt: IsoTime | null;
}

export interface AlertSettingsResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  persistence: "database" | "memory";
  dispatch: { mode: DispatchMode; modeSource: "env" | "data_source"; outbound: boolean };
  discord: {
    enabled: boolean;
    configured: boolean;
    /** `…****7f3a`. **화면이 만들지 않는다** */
    hint: string | null;
    length: number | null;
    source?: "env" | "db" | null;
    updatedAt: IsoTime | null;
    minSeverity: MinSeverity;
    sendUnknown: boolean;
    publicBaseUrlConfigured: boolean;
    lastDispatch: LastDispatch | null;
    circuitBreaker: CircuitBreaker;
    queue: { pending: number; nextRetryAt: IsoTime | null };
  };
  /** 화면에 노출하지 않는다(명세 3.4.2, `uiEditable: false`). 타입만 둔다 */
  rules: Record<string, unknown> & { uiEditable: false };
  retention: { days: number; maxRows: number; uiEditable: false };
  /**
   * 알림 대상 8개. `status`·`statusSince`(2026-09-25 추가)는 **알림 엔진이 판정에 쓰는 바로 그 값**이다.
   * 화면이 다른 스트림에서 짜 맞추지 않는다(디자인 6.1). 엔진이 아직 평가하지 않았으면(기동 직후 15초) `null`
   */
  keys: {
    key: AlertKey;
    label: string;
    enabled: boolean;
    editable: boolean;
    status?: ApiStatusValue | null;
    statusSince?: IsoTime | null;
  }[];
  warmup: { active: boolean; endsAt: IsoTime | null };
  /** 환경 변수로 고정된 **필드 이름** */
  lockedByEnv: string[];
  lockedByEnvDetail: LockedField[];
  notices: AlertNotice[];
  updatedAt: IsoTime | null;
}

/** `PATCH /api/alerts/settings` 요청(부분 갱신). 화면이 보내는 것은 `discord`의 네 필드뿐이다 */
export interface AlertSettingsPatch {
  discord: Partial<{
    enabled: boolean;
    /** `null`이면 지우기 */
    webhookUrl: string | null;
    minSeverity: MinSeverity;
    sendUnknown: boolean;
  }>;
}

/** 계약 2.7.1 `GET /api/alerts/test/preview` — **부작용 없음** */
export interface TestPreviewResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  canSend: boolean;
  blocked: { code: string; text: string } | null;
  target: { hint: string | null; length: number | null };
  dispatch: { mode: DispatchMode; outbound: boolean };
  /** 대화상자가 **그대로** 보여 주는 본문. 화면이 조립하지 않는다 */
  message: string;
  cooldown: { active: boolean; retryAfterSec: number; nextAvailableAt: IsoTime | null };
  warning: string;
}

/** 계약 2.7.2 `POST /api/alerts/test` 200 */
export interface TestSendResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  alertId: string;
  result: {
    state: DispatchState;
    label: string;
    at: IsoTime;
    responseCode: number | null;
    detail: string | null;
  };
  message: string;
  cooldown: { retryAfterSec: number; nextAvailableAt: IsoTime | null };
}
