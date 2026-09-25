/**
 * 알림 표시 모델 (components.md 20.1·20.2, status.md 12절).
 * **심각도·억제·플래핑·정지 구간·지속 시간·배지 숫자는 전부 서버 값**이다. 여기서는 매핑과 문구만 다룬다.
 */
import type { IconName } from "../icons";
import type { ChipTone } from "../status/Chip";
import type { Status, StatusAltLabel } from "../types";

/** API 값 그대로 (status.md 8.4) */
export type AlertSeverity = "critical" | "warning" | "unknown" | "resolved";

export type AlertKind =
  | "transition"
  | "escalation"
  | "resolve"
  | "flapping"
  | "restart_summary"
  | "test";

/**
 * 계약 `docs/api/alerts.md` 1.4 = DB enum `alert_delivery_status` = 디자인 `status.md` 12.5 — **12종**.
 * 셋이 같은지는 테스트가 문서를 직접 읽어 확인한다(`__tests__/alerts-logs.test.tsx` "발송 칩 12종").
 * 계약에 값이 늘면 그 테스트가 먼저 깨진다 → `status.md` 12.5에 문구가 정해진 뒤 여기에 넣는다.
 */
export type DispatchState =
  | "sent"
  | "pending"
  | "failed"
  | "skipped_not_configured"
  | "skipped_disabled"
  | "skipped_circuit_open"
  | "skipped_severity"
  | "skipped_unknown_off"
  | "skipped_flapping"
  | "skipped_no_pair"
  | "skipped_mock"
  | "skipped_restart";

/**
 * 심각도 → 상태 키 + 문구 (status.md 12.1).
 * `resolved` 는 **`ok` 색 그대로 + 문구 `해제`** 다. `정상`이라고 쓰지 않는다 —
 * 목록의 항목은 "지금 상태"가 아니라 "그때 일어난 일"이다.
 */
export const ALERT_SEVERITY: Record<
  AlertSeverity,
  { status: Status; label: string; altLabel?: StatusAltLabel }
> = {
  critical: { status: "crit", label: "장애" },
  warning: { status: "warn", label: "주의" },
  // 기본 문구(`알 수 없음`·`정상`)와 다르므로 배지에 대체 문구를 준다(status.md 1.2)
  unknown: { status: "unknown", label: "확인 불가", altLabel: "확인 불가" },
  resolved: { status: "ok", label: "해제", altLabel: "해제" },
};

/**
 * 발송 상태 칩. **정본은 `status.md` 12.5 표**이고 이 객체는 그 표를 그대로 옮긴 것이다(순서도 같다).
 * 서버 `label`은 확장 영역 발송 기록용이지 칩 문구가 아니다.
 *
 * - **발송 상태는 상태가 아니다** — 클러스터 상태가 아니라 작업 결과다.
 * - `failed` 만 상태색(crit)을 쓴다: 사용자가 조치해야 하는 사실이라 중립색으로 두면 묻힌다.
 * - `skipped_mock` 만 `mock` tone(상단바 MOCK 배지와 같은 색).
 * - 나머지 `skipped_*`는 전부 neutral이다. **오류가 아니다**(AC-ALERT19). 2026-09-25에 더한 두 줄도 같다:
 *   - `skipped_circuit_open` `발송 멈춤(연속 실패)` + `pause` — 채널이 **자동으로 잠시** 멈춘 것.
 *     사람이 끈 `발송 꺼짐`(`minus`)과 모양을 나눈다. 재개 시각은 칩에 넣지 않는다(목록 위 안내 줄이 한 번 말한다).
 *   - `skipped_no_pair` `제외(발생 안 보냄)` + `ban` — 발생 알림을 보내지 않았으니 해제도 보내지 않은 것(`해제` 항목에만 붙는다).
 * - 칩 문구는 **말줄임하지 않는다**. 가장 긴 칩은 `발송 멈춤(연속 실패)`(약 130px). 좁은 폭 배치는 `alerts.module.css` ④행.
 */
export const DISPATCH_SPEC: Record<DispatchState, { label: string; icon: IconName; tone: ChipTone }> = {
  sent: { label: "보냄", icon: "send", tone: "neutral" },
  pending: { label: "보내는 중", icon: "hourglass", tone: "neutral" },
  skipped_not_configured: { label: "미설정", icon: "minus", tone: "neutral" },
  skipped_disabled: { label: "발송 꺼짐", icon: "minus", tone: "neutral" },
  skipped_circuit_open: { label: "발송 멈춤(연속 실패)", icon: "pause", tone: "neutral" },
  skipped_severity: { label: "제외(심각도)", icon: "ban", tone: "neutral" },
  skipped_unknown_off: { label: "제외(확인 불가)", icon: "ban", tone: "neutral" },
  skipped_flapping: { label: "제외(불안정)", icon: "ban", tone: "neutral" },
  skipped_no_pair: { label: "제외(발생 안 보냄)", icon: "ban", tone: "neutral" },
  skipped_restart: { label: "재시작으로 생략", icon: "rotate-ccw", tone: "neutral" },
  skipped_mock: { label: "실제로 보내지 않음", icon: "flask-conical", tone: "mock" },
  failed: { label: "발송 실패", icon: "octagon-x", tone: "crit" },
};

/**
 * 칩 문구가 정해진 발송 상태인가. **모르는 값은 칩을 그리지 않는다**(components.md 20절) —
 * 비슷한 키로 바꿔 그리면 틀린 문구가 되어 "왜 안 갔나"를 찾을 수 없다. 그 값은 확장 영역에서 서버 `label`로 보인다.
 * `in` 연산자와 달리 `toString` 같은 상속 키에 속지 않는다.
 */
export function isDispatchState(state: string): state is DispatchState {
  return Object.hasOwn(DISPATCH_SPEC, state);
}

export interface AlertChip {
  id: string;
  label: string;
  icon: IconName;
  tone: ChipTone;
  /** 레이아웃 사정으로 **버릴 수 없는** 칩 (MOCK 표시) */
  pinned?: boolean;
  tooltip?: string;
}

export interface AlertChipInput {
  kind?: AlertKind;
  repeatCount?: number;
  flapping?: boolean;
  suppressedAreas?: number;
  dataSource?: "mock" | "live";
  repeatTooltip?: string;
}

/**
 * 보조 칩 (alerts.md 4.2). **순서 고정** — 항목마다 순서가 달라지면 눈이 매번 다시 찾는다.
 * `반복` → `불안정` → `영향 영역` → `테스트 발송` → `실제로 보내지 않음`(MOCK, 고정).
 */
export function alertChips(a: AlertChipInput): AlertChip[] {
  const out: AlertChip[] = [];
  if ((a.repeatCount ?? 1) >= 2) {
    out.push({
      id: "repeat",
      label: `반복 ${(a.repeatCount as number).toLocaleString("en-US")}회`,
      icon: "repeat",
      tone: "neutral",
      tooltip: a.repeatTooltip,
    });
  }
  if (a.flapping) out.push({ id: "flapping", label: "불안정", icon: "activity", tone: "neutral" });
  if ((a.suppressedAreas ?? 0) >= 1) {
    out.push({
      id: "areas",
      label: `영향 영역 ${(a.suppressedAreas as number).toLocaleString("en-US")}개`,
      icon: "layers",
      tone: "neutral",
    });
  }
  if (a.kind === "test") out.push({ id: "test", label: "테스트 발송", icon: "send", tone: "neutral" });
  if (a.dataSource === "mock") {
    out.push({
      id: "mock",
      label: "실제로 보내지 않음",
      icon: "flask-conical",
      tone: "mock",
      pinned: true,
    });
  }
  return out;
}

/**
 * 1행에 그릴 칩을 고른다 (최대 4개). **버리는 순서는 오른쪽부터**이고, 버린 칩은 툴팁에 문구로 남는다.
 * `MOCK` 표시는 **마지막까지 남긴다** — 실제 장애로 오인하면 안 되는 표시라 레이아웃 사정으로 사라질 수 없다
 * (status.md 3.1 "레이아웃 사정으로 사라지지 않는 표시").
 */
export function trimChips(chips: AlertChip[], max = 4): { shown: AlertChip[]; hidden: AlertChip[] } {
  if (chips.length <= max) return { shown: chips, hidden: [] };
  const dropped = new Set<number>();
  let need = chips.length - max;
  for (let i = chips.length - 1; i >= 0 && need > 0; i -= 1) {
    if (chips[i].pinned) continue;
    dropped.add(i);
    need -= 1;
  }
  return {
    shown: chips.filter((_, i) => !dropped.has(i)),
    hidden: chips.filter((_, i) => dropped.has(i)),
  };
}

/** 항목 접근 이름 (alerts.md 9절): `안 읽음, 장애, 파드, <사유>, 14:02:05` */
export function alertItemName(parts: {
  read: boolean;
  severityLabel: string;
  areaLabel: string;
  reason: string;
  timeText: string;
}): string {
  return [
    parts.read ? null : "안 읽음",
    parts.severityLabel,
    parts.areaLabel,
    parts.reason,
    parts.timeText,
  ]
    .filter(Boolean)
    .join(", ");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `09:12` (정지 구간 표시용. tabular) */
export function gapTime(at: string | number | Date): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `09시 12분` (스크린리더용 — 콜론을 읽어 주지 않는 리더가 있다) */
export function gapTimeSpoken(at: string | number | Date): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "알 수 없는 시각";
  return `${d.getHours()}시 ${d.getMinutes()}분`;
}

export const GAP_EXPLAIN = "이 동안의 변화는 알림으로 잡히지 않았습니다";
export const GAP_UNKNOWN_PREVIOUS = "이전 실행 기록 없음 — 이전에 무엇이 있었는지 알 수 없습니다";

/** 정지 구간 줄 문구 (status.md 12.4). `to` 가 없으면 `지금`까지 */
export function gapRangeText(from: string, to: string | null | undefined, minutes: number): string {
  const end = to ? gapTime(to) : "지금";
  return `정지 구간 ${gapTime(from)} ~ ${end} (${minutes.toLocaleString("en-US")}분)`;
}

/** 정지 구간 줄 접근 이름 */
export function gapAriaLabel(
  from: string,
  to: string | null | undefined,
  minutes: number,
  unknownPrevious = false,
): string {
  if (unknownPrevious) return GAP_UNKNOWN_PREVIOUS;
  const end = to ? `${gapTimeSpoken(to)}까지` : "지금까지";
  return `정지 구간 ${gapTimeSpoken(from)}부터 ${end} ${minutes.toLocaleString("en-US")}분, ${GAP_EXPLAIN}`;
}
