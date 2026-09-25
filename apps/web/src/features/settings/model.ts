/**
 * 설정 화면 순수 함수 (docs/design/settings.md, docs/api/alerts.md 2.5~2.7).
 *
 * **여기에 발송 판정이 없다.** "보낼 수 있나"·"왜 안 갔나"는 서버가 정하고(계약 3절), 이 파일은 서버 값을
 * 화면 문구·버튼 상태로 옮기기만 한다. 테스트 발송의 최종 판단도 서버(`preview.canSend`·`POST` 응답)다.
 */
import { DISPATCH_SPEC, formatMonthDay, formatTime } from "@/components/ui";
import { isApiError } from "@/lib/api";

import { errorBody } from "../common/hooks";
import type { AlertSettingsResponse, LastDispatch, LockedField } from "./types";

/** 디자인 4.2·6.3 문구 (서버 문구가 없는 자리만 화면이 가진다) */
export const TEXT = {
  dbDown: "대시보드 DB에 연결할 수 없어 설정을 저장할 수 없습니다.",
  /** 주소가 없고 DB 도 없을 때 — 저장할 수 없으니 "먼저 저장하세요"가 아니라 되는 길을 말한다(디자인 4.2, PM 결정) */
  dbDownNoWebhook:
    "대시보드 DB에 연결할 수 없어 웹훅 주소를 저장할 수 없습니다. ALERTS_DISCORD_WEBHOOK_URL 환경 변수로 넣으면 보낼 수 있습니다.",
  dbDownBanner: "대시보드 DB에 연결할 수 없어 설정을 바꿀 수 없습니다. 지금 보이는 값은 기본값입니다.",
  notConfigured: "먼저 웹훅 주소를 저장하세요. 저장하지 않은 입력값으로는 보내지 않습니다.",
  disabled: "디스코드 발송이 꺼져 있습니다.",
} as const;

/** `lockedByEnvDetail`에서 그 필드의 잠금 정보. **필드 이름**(`webhookUrl`)으로 찾고 쓰는 곳에는 `envVar`를 넘긴다 */
export function lockOf(settings: AlertSettingsResponse, field: string): LockedField | undefined {
  return settings.lockedByEnvDetail.find((l) => l.field === field);
}

/** 대시보드 DB 없음 — 저장이 503 이 되는 상태. 조회는 된다(디자인 6.3) */
export function isDbDown(settings: AlertSettingsResponse): boolean {
  return settings.persistence === "memory";
}

/**
 * 테스트 발송 버튼의 비활성 사유 (디자인 4.2). `null`이면 누를 수 있다.
 * 주소가 **저장돼 있고** 발송이 켜져 있을 때만 활성이다 — 입력칸에 값이 있어도 저장 전이면 비활성(명세 3.5-1).
 *
 * 대시보드 DB가 없어도 **환경 변수로 들어온 주소**는 보낼 수 있다(서버가 허용한다). 그래서 DB 없음은
 * "저장된 주소가 없을 때"의 사유로만 쓴다 — 저장할 수 없는 상황에서 "먼저 저장하세요"라고 하면 거짓 안내가 된다.
 */
export function testBlockReason(
  settings: AlertSettingsResponse,
  cooldownSec: number | null,
): string | null {
  if (!settings.discord.configured) return isDbDown(settings) ? TEXT.dbDownNoWebhook : TEXT.notConfigured;
  if (!settings.discord.enabled) return TEXT.disabled;
  if (cooldownSec !== null && cooldownSec > 0) return cooldownText(cooldownSec);
  return null;
}

export function cooldownText(sec: number): string {
  return `${Math.max(1, Math.ceil(sec))}초 후 다시 보낼 수 있습니다.`;
}

/** `9월 25일 14:02` */
export function monthDayTime(at: string): string {
  return `${formatMonthDay(at)} ${formatTime(at, "shortTime")}`;
}

/**
 * `마지막 발송 9월 25일 14:02 · 성공` (디자인 3.6). 사유는 **가림 처리된 서버 문구**를 그대로 붙인다.
 * `lastDispatch`는 **실제로 밖으로 나간 시도**(`sent`·`failed`, 테스트 발송 포함)만 기록한다(PM 결정 3) —
 * mock 에서는 `null`로 남는 것이 정상이다. 계약 밖의 값이 오면 발송 칩과 같은 낱말(`DISPATCH_SPEC`)로 적는다.
 */
export function lastDispatchText(last: LastDispatch | null): { text: string; failed: boolean; none: boolean } {
  if (!last) return { text: "마지막 발송 없음", failed: false, none: true };
  const when = monthDayTime(last.at);
  const why = last.detail ?? (last.responseCode !== null ? String(last.responseCode) : null);
  const tail = why ? " (" + why + ")" : "";
  switch (last.state) {
    case "sent":
      return { text: `마지막 발송 ${when} · 성공`, failed: false, none: false };
    case "failed":
      return { text: `마지막 발송 ${when} · 실패${tail}`, failed: true, none: false };
    default: {
      const spec = (DISPATCH_SPEC as Record<string, { label: string } | undefined>)[last.state];
      return { text: `마지막 발송 ${when} · ${spec?.label ?? "보내지 않음"}`, failed: false, none: false };
    }
  }
}

/** `보낼 심각도` 아래 설명 (디자인 3.3) */
export function minSeverityCaption(v: "critical" | "warning"): string {
  return v === "warning" ? "주의·장애를 보냅니다." : "주의는 화면에만 쌓입니다.";
}

/**
 * `발송 모드` 표시 전용 줄 (디자인 5절). 화면에서 바꿀 수 있는 값이 아니므로 스위치를 만들지 않는다.
 * `ALERTS_DISPATCH`가 없으면 `DATA_SOURCE`를 따른다(계약 2.5 `modeSource`).
 */
export function dispatchModeText(settings: AlertSettingsResponse): string {
  const { mode, modeSource } = settings.dispatch;
  const what = settings.dispatch.outbound ? "실제로 보냄" : "실제로 보내지 않음";
  const why = modeSource === "env" ? `ALERTS_DISPATCH=${mode}` : `DATA_SOURCE=${mode}을 따름`;
  return `${what} (${why})`;
}

/** mock 대화상자 한 줄 (디자인 4.3). 어느 설정 때문에 안 나가는지를 정확히 쓴다 */
export function mockDispatchLine(settings: AlertSettingsResponse | null): string {
  if (settings?.dispatch.modeSource === "data_source") {
    return "ALERTS_DISPATCH가 없어 DATA_SOURCE=mock을 따르므로 실제로 전송하지 않고 본문만 확인합니다.";
  }
  return "ALERTS_DISPATCH=mock이라 실제로 전송하지 않고 본문만 확인합니다.";
}

/** 계약 에러 본문에서 화면이 쓰는 것만 꺼낸다. **입력값은 응답에 없다**(AC-ALERT21) */
export interface SettingsApiError {
  status: number | null;
  code: string | null;
  message: string | null;
  /** 429 쿨다운: 서버 `details.retryAfterSec`(= `Retry-After`) */
  retryAfterSec: number | null;
}

export function readApiError(e: unknown): SettingsApiError {
  const body = errorBody(e);
  const status = isApiError(e) ? (e.status ?? null) : null;
  const raw = body?.details?.retryAfterSec;
  return {
    status: body?.statusCode ?? status,
    code: body?.code ?? null,
    message: body?.message ?? null,
    retryAfterSec: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
  };
}
