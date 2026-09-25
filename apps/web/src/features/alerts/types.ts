/**
 * docs/api/alerts.md 1절 공통 타입. 계약에 없는 필드는 두지 않는다.
 *
 * **이 파일에 로그 줄·로그 요약 필드를 추가하지 않는다**(계약 0.3). 알림과 로그를 잇는 것은
 * `logHref` 링크 하나뿐이다.
 */
import type { ApiStatusValue, DataSource, IsoTime, Reason, ResourceRef } from "../common/types";

export type AlertAreaKey =
  | "area:controlPlane"
  | "area:nodes"
  | "area:workloads"
  | "area:pods"
  | "area:events"
  | "area:db"
  | "area:cost"
  | "source:kube";

export type AlertSystemKey = "system:restart" | "system:test";
export type AlertKey = AlertAreaKey | AlertSystemKey;

export type AlertArea =
  | "controlPlane"
  | "nodes"
  | "workloads"
  | "pods"
  | "events"
  | "db"
  | "cost"
  | "source"
  | "system";

export type AlertSeverity = "critical" | "warning" | "unknown" | "resolved";

export type AlertKind = "transition" | "escalation" | "resolve" | "flapping" | "restart_summary" | "test";

/**
 * 계약 1.4. **컴포넌트 표(`DISPATCH_SPEC`)에 없는 값은 칩으로 그리지 않는다**(`isDispatchState`로 거른다) —
 * 비슷한 칩으로 바꿔 그리면 틀린 문구가 된다. 그 기록은 확장 영역에서 서버 `label` 그대로 보인다(`model.ts` `toChipDispatch`).
 * (이전 주석의 "모르는 값은 `제외` 계열 중립 칩으로 그린다"는 계약 11절 문장이었고, 컴포넌트에 중립 칩이 없어 그렇게 구현되지 않았다)
 */
export type DispatchState =
  | "pending"
  | "sent"
  | "failed"
  | "skipped_disabled"
  | "skipped_not_configured"
  | "skipped_severity"
  | "skipped_unknown_off"
  | "skipped_flapping"
  | "skipped_mock"
  | "skipped_restart"
  | "skipped_no_pair"
  | "skipped_circuit_open";

export interface AlertDispatchRecord {
  channel: "discord";
  state: DispatchState;
  /** 화면 칩 문구 — **서버가 준 그대로** 쓴다 */
  label: string;
  at: IsoTime | null;
  attempts: number;
  responseCode: number | null;
  detail: string | null;
  nextRetryAt: IsoTime | null;
}

export interface AlertTargetRef {
  ref: ResourceRef;
  status: ApiStatusValue;
  reason: string;
  href: string | null;
}

/** 계약 2.2.1. `gone`·`deletedAt`·`stackSearch`는 **서버 값**이다(화면이 추측하지 않는다) */
export interface AlertLogTarget {
  ref: ResourceRef;
  gone: boolean;
  deletedAt: IsoTime | null;
  stackSearch: boolean;
  unavailableReason: "not_a_pod" | "logs_disabled" | "namespace_denied" | null;
}

export interface AlertGap {
  id: string;
  from: IsoTime;
  to: IsoTime | null;
  minutes: number;
  unknownPrevious: boolean;
}

export interface AlertRow {
  id: string;
  key: AlertKey;
  area: AlertArea;
  areaLabel: string;
  severity: AlertSeverity;
  severityLabel: string;
  kind: AlertKind;
  transition: { from: ApiStatusValue | null; to: ApiStatusValue } | null;
  reason: Reason | null;
  targets: AlertTargetRef[];
  targetTotal: number;
  occurredAt: IsoTime;
  lastSeenAt: IsoTime;
  resolvedAt: IsoTime | null;
  /** **서버 계산값**. 화면이 시계로 재지 않는다(계약 1.3.1) */
  durationMs: number;
  repeatCount: number;
  dedupe: { windowMin: number; lastEventAt: IsoTime };
  flapping: { active: boolean; transitions: number; windowMin: number } | null;
  suppressedAreas: number;
  unknownGap: { from: IsoTime; to: IsoTime | null; minutes: number } | null;
  mitigations: { at: IsoTime; from: ApiStatusValue; to: ApiStatusValue }[];
  relatedAlertId: string | null;
  relation: "escalated_from" | "resolves" | null;
  restart: {
    warmupSec: number;
    counts: { critical: number; warning: number; unknown: number };
    gap: AlertGap | null;
  } | null;
  href: string | null;
  logHref: string | null;
  logTarget: AlertLogTarget | null;
  read: boolean;
  readAt: IsoTime | null;
  dispatch: AlertDispatchRecord[];
  dataSource: DataSource;
  createdAt: IsoTime;
}

/** 계약 1.3 `AlertDetail` (상세에만 있는 필드) */
export interface AlertDetail extends AlertRow {
  dataSource: DataSource;
  generatedAt: IsoTime;
  messagePreview: string;
  transitions: { at: IsoTime; from: ApiStatusValue; to: ApiStatusValue }[];
  suppressedKeys: { key: AlertKey; label: string }[];
  dispatchAttempts: {
    at: IsoTime;
    channel: "discord";
    state: DispatchState;
    responseCode: number | null;
    detail: string | null;
  }[];
}

export interface AlertBadge {
  unreadCount: number;
  worstSeverity: Exclude<AlertSeverity, "resolved"> | null;
  updatedAt: IsoTime | null;
}

/** 계약 2.3 — 목록·최근 N건이 **없다** */
export interface AlertBadgeResponse extends AlertBadge {
  dataSource: DataSource;
  generatedAt: IsoTime;
}

export interface AlertWatch {
  lastObservedAt: IsoTime | null;
  keyCount: number;
  keys: { key: AlertKey; label: string }[];
}

export interface AlertNotice {
  code: string;
  level: "info" | "warn" | "error";
  text: string;
  details?: Record<string, unknown>;
}

export type AlertRangeId = "1h" | "24h" | "7d" | "30d" | "all";

export interface AlertsListResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  persistence: "database" | "memory";
  total: number;
  filteredTotal: number;
  offset: number;
  limit: number;
  range: { id: AlertRangeId | null; from: IsoTime | null; to: IsoTime | null };
  badge: AlertBadge;
  watch: AlertWatch;
  /** 기간만 적용한 개수(심각도·영역·읽음 필터 **전**). 화면이 세지 않는다 */
  facets: {
    severity: Partial<Record<AlertSeverity, number>>;
    area: Partial<Record<AlertArea, number>>;
  };
  /** **어떤 필터로도 사라지지 않는다.** `items`와 별도 배열인 이유가 이것이다(계약 2.1) */
  gaps: AlertGap[];
  items: AlertRow[];
  notices: AlertNotice[];
}

export interface AlertsReadResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  persistence: "database" | "memory";
  updated: number;
  badge: AlertBadge;
}

/** SSE `alerts.snapshot` (계약 6절). **목록이 없다**(6.1) */
export interface AlertsSnapshotPayload {
  badge: AlertBadge;
  watch: AlertWatch;
  dispatch: { mode: "mock" | "live"; modeSource: "env" | "data_source"; outbound: boolean };
  persistence: "database" | "memory";
  warmup: { active: boolean; endsAt: IsoTime | null };
  notices: AlertNotice[];
}
