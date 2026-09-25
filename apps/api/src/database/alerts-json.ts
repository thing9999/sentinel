/**
 * alerts 테이블 jsonb 컬럼에 저장하는 값의 모양 (docs/db/schema.md 2.8~2.11).
 *
 * - DB는 모양을 강제하지 않는다. api가 저장 전에 길이·개수를 맞춘다(advisor-json.ts와 같은 규칙).
 * - Prisma `Json` 컬럼에 쓸 때: `targets: list as unknown as Prisma.InputJsonValue`.
 * - **여기에 로그 줄·쿼리 원문·환경 변수·command/args·웹훅 URL을 넣지 않는다.**
 *   알림 본문은 저장하지 않고 표시할 때 조립한다(alerts 3.3.2 "절대 넣지 않는 것").
 */

/** P1의 알림 키 8개 + 영역이 없는 시스템 키 2개 (alerts 3.1). */
export const ALERT_KEYS = [
  'area:controlPlane',
  'area:nodes',
  'area:workloads',
  'area:pods',
  'area:events',
  'area:db',
  'area:cost',
  'source:kube',
] as const;

export type AlertAreaKey = (typeof ALERT_KEYS)[number];

/** 영역이 없는 알림의 키. 상태 머신을 두지 않는다(전이가 없다). */
export const ALERT_SYSTEM_KEYS = {
  /** 워밍업 요약 (restart_summary) */
  restart: 'system:restart',
  /** 테스트 발송 (test) */
  test: 'system:test',
} as const;

/** alerts.targets 원소 — 영향 객체. `areas.*.problems`의 ResourceRef와 같은 모양. */
export interface AlertTargetJson {
  kind: string;
  namespace: string | null;
  /**
   * 리소스 **원문 이름**. kOps에서 노드 이름은 EC2 인스턴스 ID(`i-0…`)다
   * (사용자·PM 결정 Q3). 어드바이저 스냅샷의 가명 규칙은 여기에 적용하지 않는다.
   */
  name: string;
}

/** alert_key_states.recent_transitions 원소 — 플래핑 판정용 전이 1건. */
export interface AlertTransitionJson {
  /** ISO8601 UTC */
  at: string;
  from: 'ok' | 'warning' | 'critical' | 'unknown' | null;
  to: 'ok' | 'warning' | 'critical' | 'unknown';
}

/** alerts.context — restart_summary 알림의 부가 정보 (alerts 3.2.5). */
export interface AlertRestartContextJson {
  counts: { critical: number; warning: number; unknown: number };
  /** 직전 heartbeat ~ 지금. heartbeat 행이 없으면 null ("이전 실행 기록 없음") */
  downtime: { from: string; to: string; minutes: number } | null;
}

/** alerts.context — flapping 묶음 알림의 부가 정보 (alerts 3.2.3). */
export interface AlertFlappingContextJson {
  windowMin: number;
  transitions: AlertTransitionJson[];
}

/** alerts.context — unknown 알림의 "확인 불가 구간" (alerts 3.2.4). */
export interface AlertUnknownContextJson {
  unknownFrom: string;
  unknownTo: string | null;
}

export type AlertContextJson =
  | AlertRestartContextJson
  | AlertFlappingContextJson
  | AlertUnknownContextJson
  | Record<string, never>;

/** alert_key_states.last_notified_targets 원소를 만드는 규칙 (문자열 1개 = 객체 1개). */
export function alertTargetRef(t: AlertTargetJson): string {
  return `${t.kind}/${t.namespace ?? '-'}/${t.name}`;
}
