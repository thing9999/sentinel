/**
 * 알림 센터 순수 함수 (docs/design/alerts.md 3~6절, docs/api/alerts.md 11절).
 *
 * **여기에 상태 판단이 없다.** 심각도·억제·플래핑·지속 시간·개수(facets)·정지 구간은 전부 서버 값이고
 * 이 파일은 그 값을 컴포넌트 prop 모양으로 옮기기만 한다.
 */
import { isDispatchState, type AlertDispatch, type AlertTarget } from "@/components/ui";

import type { AlertArea, AlertGap, AlertNotice, AlertRangeId, AlertRow, AlertSeverity } from "./types";

export const ALERT_RANGES: { id: AlertRangeId; label: string; emptyTitle: string }[] = [
  { id: "1h", label: "최근 1시간", emptyTitle: "최근 1시간 동안 알림이 없습니다" },
  { id: "24h", label: "최근 24시간", emptyTitle: "최근 24시간 동안 알림이 없습니다" },
  { id: "7d", label: "최근 7일", emptyTitle: "최근 7일 동안 알림이 없습니다" },
  { id: "30d", label: "최근 30일", emptyTitle: "최근 30일 동안 알림이 없습니다" },
  { id: "all", label: "전체", emptyTitle: "아직 알림이 없습니다" },
];

export const DEFAULT_RANGE: AlertRangeId = "24h";

export function parseRange(v: string | null): AlertRangeId {
  return ALERT_RANGES.some((r) => r.id === v) ? (v as AlertRangeId) : DEFAULT_RANGE;
}

/** 심각도 필터 옵션. 문구는 서버 `severityLabel`과 같은 낱말을 쓴다(`확인 불가` ≠ `알 수 없음`) */
export const SEVERITY_OPTIONS: { value: AlertSeverity; label: string }[] = [
  { value: "critical", label: "장애" },
  { value: "warning", label: "주의" },
  { value: "unknown", label: "확인 불가" },
  { value: "resolved", label: "해제" },
];

/**
 * 영역 필터 후보는 **감시 대상 8개**뿐이다(계약 1.1). `system:*`(재시작 요약·테스트 발송)은
 * 감시 대상이 아니라 `area=system` 필터를 만들지 않는다.
 */
export const AREA_BY_KEY: Record<string, AlertArea> = {
  "area:controlPlane": "controlPlane",
  "area:nodes": "nodes",
  "area:workloads": "workloads",
  "area:pods": "pods",
  "area:events": "events",
  "area:db": "db",
  "area:cost": "cost",
  "source:kube": "source",
};

export function parseList(v: string | null): string[] {
  return (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface AlertsQuery {
  range: AlertRangeId;
  severity: AlertSeverity[];
  area: AlertArea[];
  unreadOnly: boolean;
  includeResolved: boolean;
}

/** 화면 필터 → `GET /api/alerts` 쿼리 (계약 2.1). 화면이 거르지 않고 서버에 보낸다 */
export function toListQuery(q: AlertsQuery, limit: number): Record<string, string | number | undefined> {
  return {
    range: q.range,
    severity: q.severity.length > 0 ? q.severity.join(",") : undefined,
    area: q.area.length > 0 ? q.area.join(",") : undefined,
    unreadOnly: q.unreadOnly ? "true" : undefined,
    includeResolved: q.includeResolved ? undefined : "false",
    limit,
  };
}

export function isDefaultQuery(q: AlertsQuery): boolean {
  return (
    q.range === DEFAULT_RANGE &&
    q.severity.length === 0 &&
    q.area.length === 0 &&
    !q.unreadOnly &&
    q.includeResolved
  );
}

/** 목록에 그릴 줄: 알림 항목과 정지 구간을 **시각 순으로 섞는다** */
export type AlertsRow = { type: "item"; at: number; item: AlertRow } | { type: "gap"; at: number; gap: AlertGap };

const ms = (v: string | null | undefined): number => {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};

/**
 * **`gaps`를 필터 결과 배열에서 빼지 않는다**(계약 2.1, 디자인 5.4). 서버가 필터와 무관하게 내려보내고
 * 화면도 거르지 않는다 — 숨기면 사용자가 "그동안 아무 일 없었다"로 읽는다.
 * 자리는 그 구간이 **끝난 시각**(`to` 없으면 `from`)이다. 정렬은 `occurredAt` 내림차순 고정(정렬 바꾸기 없음).
 */
export function mergeRows(items: AlertRow[], gaps: AlertGap[]): AlertsRow[] {
  const rows: AlertsRow[] = [
    ...items.map((item) => ({ type: "item" as const, at: ms(item.occurredAt), item })),
    ...gaps.map((gap) => ({ type: "gap" as const, at: ms(gap.to ?? gap.from), gap })),
  ];
  // 같은 시각이면 정지 구간을 위(더 최근 쪽)에 둔다 — 그 구간 다음에 일어난 일과 겹쳐 읽히지 않게
  rows.sort((a, b) => b.at - a.at || (a.type === b.type ? 0 : a.type === "gap" ? -1 : 1));
  return rows;
}

/** 계약 `AlertTargetRef` → 컴포넌트 `AlertTarget` (좁은 폭에서 개수를 줄이는 것은 호출 측 몫) */
export function toItemTargets(item: AlertRow, max: number): { targets: AlertTarget[]; more: number } {
  const targets = item.targets.slice(0, max).map((t) => ({
    kind: t.ref.kind,
    namespace: t.ref.namespace ?? undefined,
    name: t.ref.name,
    href: t.href ?? undefined,
  }));
  return { targets, more: Math.max(0, item.targetTotal - targets.length) };
}

/**
 * 발송 칩. **컴포넌트가 문구를 모르는 상태는 칩으로 그리지 않는다.**
 *
 * 서버가 새 발송 상태를 더하면(1차 때 `skipped_no_pair`·`skipped_circuit_open`이 그랬다) 컴포넌트 표에 한동안 없다.
 * 없는 키를 넘기면 `undefined.label`로 터지고, 있는 키로 바꿔치면 **틀린 문구**("제외(심각도)")가 나온다 —
 * 둘 다 안 된다. 그래서 컴포넌트 표에 있는 상태만(`isDispatchState`) 칩으로 넘기고, 나머지는 **확장 영역에서
 * 서버 `label`을 그대로** 보여 준다(정보를 잃지 않는다). 퍼블리셔가 표에 넣으면 이 필터가 저절로 통과시킨다
 * (위 2종은 2026-09-25 통합 2차 시점에 들어왔고 프론트 변경은 없었다).
 * 검사는 퍼블리셔의 `isDispatchState()`를 쓴다 — `in` 연산자는 `toString` 같은 상속 키에 속는다(통합 3차).
 */
export function toChipDispatch(item: AlertRow): AlertDispatch[] {
  return item.dispatch
    .filter((d) => isDispatchState(d.state))
    .map((d) => ({
      state: d.state as AlertDispatch["state"],
      at: d.at ?? undefined,
      detail: d.detail ?? undefined,
    }));
}

/** 칩으로 그리지 못한 발송 기록이 있는지 (확장 영역에서 서버 문구로 보여 준다) */
export function hasUnknownDispatch(item: AlertRow): boolean {
  return item.dispatch.some((d) => !isDispatchState(d.state));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function hhmmss(at: string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 반복 칩 툴팁 `처음 14:02:05 · 마지막 14:14:31` (서버 값 두 개를 잇기만 한다) */
export function repeatTooltip(item: AlertRow): string | undefined {
  if (item.repeatCount < 2) return undefined;
  const first = hhmmss(item.occurredAt);
  const last = hhmmss(item.dedupe?.lastEventAt ?? item.lastSeenAt);
  return first && last ? `처음 ${first} · 마지막 ${last}` : undefined;
}

/**
 * 안내 줄 우선순위 (디자인 3.3). 위에서부터 **최대 2개**만 그린다.
 * `skipped_*`·미설정은 오류가 아니므로 neutral 이다(AC-ALERT19).
 */
const NOTICE_PRIORITY: { code: string; tone: "warn" | "neutral" }[] = [
  { code: "ALERTS_HISTORY_MEMORY_ONLY", tone: "warn" },
  { code: "ALERTS_DISCORD_CIRCUIT_OPEN", tone: "warn" },
  { code: "ALERTS_DISCORD_NOT_CONFIGURED", tone: "neutral" },
  { code: "ALERTS_DISCORD_DISABLED", tone: "neutral" },
  { code: "ALERTS_WARMUP_ACTIVE", tone: "neutral" },
  { code: "ALERTS_DISPATCH_MOCK", tone: "neutral" },
];

export interface ShownNotice {
  notice: AlertNotice;
  tone: "warn" | "neutral";
}

export function pickNotices(notices: AlertNotice[], max = 2): ShownNotice[] {
  const out: ShownNotice[] = [];
  for (const spec of NOTICE_PRIORITY) {
    const n = notices.find((x) => x.code === spec.code);
    if (n) out.push({ notice: n, tone: spec.tone });
    if (out.length >= max) return out;
  }
  // 목록에 없는 코드는 서버 level 로 톤을 정한다(화면이 코드 → 문구 매핑 표를 갖지 않는다)
  for (const n of notices) {
    if (out.some((x) => x.notice.code === n.code)) continue;
    out.push({ notice: n, tone: n.level === "warn" || n.level === "error" ? "warn" : "neutral" });
    if (out.length >= max) break;
  }
  return out;
}

/** 상태 전이 한 줄에 쓰는 문구. 서버 `severityLabel`이 없는 `Status` 값이라 최소 매핑만 둔다 */
export const STATUS_TEXT: Record<string, string> = {
  ok: "정상",
  warning: "주의",
  critical: "장애",
  unknown: "확인 불가",
};
