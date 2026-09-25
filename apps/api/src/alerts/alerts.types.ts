/**
 * alerts 응답 타입 (docs/api/alerts.md 1절).
 *
 * **여기에 로그 줄을 담을 필드를 만들지 않는다** — 가림 처리한 줄도, `logLineCount`·
 * `errorLines`·`lastLogLine` 같은 요약·통계도 없다 (계약 0.3, AC-ALERT13).
 * 알림에서 로그로 이어지는 것은 `logHref` 링크 하나뿐이다.
 */
import type { Reason, Status } from '../common/status';
import type { ResourceRef } from '../cluster/types';

/** 상태 전이를 감시하는 알림 키 8개 (DBA `ALERT_KEYS`와 같은 값) */
export const ALERT_AREA_KEYS = [
  'area:controlPlane',
  'area:nodes',
  'area:workloads',
  'area:pods',
  'area:events',
  'area:db',
  'area:cost',
  'source:kube',
] as const;
export type AlertAreaKey = (typeof ALERT_AREA_KEYS)[number];

/** 영역이 없는 시스템 키 2개. 상태 머신이 없다(전이가 없다) */
export const ALERT_SYSTEM_KEYS = ['system:restart', 'system:test'] as const;
export type AlertSystemKey = (typeof ALERT_SYSTEM_KEYS)[number];

export type AlertKey = AlertAreaKey | AlertSystemKey;

export const ALERT_AREAS = [
  'controlPlane',
  'nodes',
  'workloads',
  'pods',
  'events',
  'db',
  'cost',
  'source',
  'system',
] as const;
export type AlertArea = (typeof ALERT_AREAS)[number];

export const ALERT_SEVERITIES = [
  'critical',
  'warning',
  'unknown',
  'resolved',
] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_KINDS = [
  'transition',
  'escalation',
  'resolve',
  'flapping',
  'restart_summary',
  'test',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/**
 * 발송 상태 (계약 1.4). **DB enum `alert_delivery_status` 12개와 같은 값이다**
 * (DBA 마이그레이션 `20260924200000_alert_delivery_skip_reasons`로 2개가 추가됐다).
 *
 * `skipped_no_pair`(짝 없는 해제, AC-ALERT32)와 `skipped_circuit_open`(연속 실패 차단)을
 * **`failed`로 뭉뚱그리지 않는다** — 나누려고 마이그레이션을 따로 낸 값이고,
 * 뭉뚱그리면 나중에 "왜 안 갔나"를 추적할 수 없다.
 */
export const DISPATCH_STATES = [
  'pending',
  'sent',
  'failed',
  'skipped_disabled',
  'skipped_not_configured',
  'skipped_severity',
  'skipped_unknown_off',
  'skipped_flapping',
  'skipped_mock',
  'skipped_restart',
  'skipped_no_pair',
  'skipped_circuit_open',
] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];

/**
 * DB enum `alert_delivery_status`와 **같은 집합**이어야 한다.
 * 한쪽만 늘면 저장이 조용히 실패하므로 테스트로 고정한다 (alert-rules.spec.ts).
 */
export const DB_DELIVERY_STATUSES: readonly string[] = DISPATCH_STATES;

export interface DispatchRecord {
  channel: 'discord';
  state: DispatchState;
  label: string;
  at: string | null;
  attempts: number;
  responseCode: number | null;
  /** 가림 처리된 한 줄. 웹훅 URL·토큰 없음 */
  detail: string | null;
  nextRetryAt: string | null;
}

export interface AlertTarget {
  ref: ResourceRef;
  status: Status;
  reason: string;
  href: string | null;
}

/** `logHref`가 null인 이유 (계약 2.2.1) */
export type LogUnavailableReason =
  'not_a_pod' | 'logs_disabled' | 'namespace_denied';

export interface AlertLogTarget {
  ref: ResourceRef;
  /** 서버가 아는 한 이 파드는 지금 존재하지 않는다 */
  gone: boolean;
  deletedAt: string | null;
  /** 외부 로그 스택이 있어 사라진 파드도 찾을 수 있다 (L3) */
  stackSearch: boolean;
  unavailableReason: LogUnavailableReason | null;
}

export interface AlertGap {
  id: string;
  from: string;
  to: string | null;
  minutes: number;
  /** true면 '이전 실행 기록 없음' (대시보드 DB 없음) */
  unknownPrevious: boolean;
}

export interface AlertTransitionEntry {
  at: string;
  from: Status | null;
  to: Status;
}

export interface AlertItem {
  id: string;
  key: AlertKey;
  area: AlertArea;
  areaLabel: string;
  severity: AlertSeverity;
  severityLabel: string;
  kind: AlertKind;
  transition: { from: Status | null; to: Status } | null;
  reason: Reason | null;
  targets: AlertTarget[];
  targetTotal: number;
  occurredAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  durationMs: number;
  repeatCount: number;
  dedupe: { windowMin: number; lastEventAt: string };
  flapping: { active: boolean; transitions: number; windowMin: number } | null;
  suppressedAreas: number;
  unknownGap: { from: string; to: string | null; minutes: number } | null;
  mitigations: { at: string; from: Status; to: Status }[];
  relatedAlertId: string | null;
  relation: 'escalated_from' | 'resolves' | null;
  restart: {
    warmupSec: number;
    counts: { critical: number; warning: number; unknown: number };
    gap: AlertGap | null;
  } | null;
  href: string | null;
  /** 로그 화면 링크. **로그 줄은 없다** */
  logHref: string | null;
  logTarget: AlertLogTarget | null;
  read: boolean;
  readAt: string | null;
  dispatch: DispatchRecord[];
  dataSource: 'mock' | 'live';
  createdAt: string;
}

export interface AlertDetail extends AlertItem {
  /** 디스코드로 보낼(보낸) 본문 전문. 4절 규칙을 통과한 문자열. 웹훅 URL은 없다 */
  messagePreview: string;
  transitions: { at: string; from: Status; to: Status }[];
  suppressedKeys: { key: AlertKey; label: string }[];
  dispatchAttempts: {
    at: string;
    channel: 'discord';
    state: DispatchState;
    responseCode: number | null;
    detail: string | null;
  }[];
}

export interface AlertBadge {
  unreadCount: number;
  worstSeverity: 'critical' | 'warning' | 'unknown' | null;
  updatedAt: string;
}

export interface AlertNotice {
  code: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  details?: Record<string, unknown>;
}

export interface AlertWatch {
  lastObservedAt: string | null;
  keyCount: number;
  keys: { key: AlertKey; label: string }[];
}

/**
 * 저장 계층이 다루는 알림 1건 (DB 행 또는 메모리 행).
 * **본문 문자열을 담지 않는다** — 구성요소로만 저장하고 표시할 때 조립한다 (DBA 설계).
 */
export interface AlertRecord {
  id: string;
  dataSource: 'mock' | 'live';
  alertKey: AlertKey;
  kind: AlertKind;
  severity: AlertSeverity;
  fromStatus: Status | null;
  toStatus: Status | null;
  reasonCode: string | null;
  reasonText: string | null;
  targets: { kind: string; namespace: string | null; name: string }[];
  targetCount: number;
  occurredAt: number;
  lastEventAt: number;
  resolvedAt: number | null;
  closedAt: number | null;
  parentAlertId: string | null;
  repeatCount: number;
  flapping: boolean;
  suppressedKeys: string[];
  acknowledgedAt: number | null;
  context: AlertContext | null;
  createdAt: number;
  deliveries: DispatchRecord[];
}

export interface AlertRestartContext {
  counts: { critical: number; warning: number; unknown: number };
  downtime: { from: string; to: string; minutes: number } | null;
  warmupSec: number;
}

export interface AlertFlappingContext {
  windowMin: number;
  transitions: AlertTransitionEntry[];
}

export interface AlertUnknownContext {
  unknownFrom: string;
  unknownTo: string | null;
}

export interface AlertMitigationContext {
  mitigations: { at: string; from: Status; to: Status }[];
}

/**
 * 해제 알림이 "얼마나 지속됐나"를 말하려면 **원래 발생 시각**이 필요하다.
 * 해제 행의 `occurredAt`은 해제된 시각(목록 정렬 기준)이라 그 값으로는 계산할 수 없고,
 * 원본 알림은 보관 정리로 사라질 수 있어 참조로만 두면 나중에 값을 잃는다.
 */
export interface AlertIncidentContext {
  incidentStartedAt: string;
}

export type AlertContext = Partial<
  AlertRestartContext &
    AlertFlappingContext &
    AlertUnknownContext &
    AlertMitigationContext &
    AlertIncidentContext
>;
