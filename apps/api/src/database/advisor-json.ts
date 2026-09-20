/**
 * 어드바이저 테이블 jsonb 컬럼에 저장하는 값의 모양 (docs/db/schema.md 2.6·2.7).
 *
 * - 공개 API 타입(docs/api/architecture-advisor.md A.1.3)과 같은 구조다. api 쪽 타입이 이 타입에
 *   그대로 대입되도록 필드만 맞춘다(검증·길이 제한은 api가 저장 전에 한다).
 * - Prisma `Json` 컬럼에 쓸 때: `targets: refs as unknown as Prisma.InputJsonValue` 처럼 캐스트.
 *   읽을 때도 `row.steps as unknown as AdvisorStepJson[]` (DB가 모양을 강제하지 않는다).
 */

/** advisor_suggestions.targets 원소 (TargetRef) */
export interface AdvisorTargetRefJson {
  kind: string;
  namespace: string | null;
  /** 화면 표시 이름 (가명이었던 노드·볼륨·LB는 실제 이름으로 되돌림) */
  name: string;
  /** 스냅샷·LLM이 쓴 이름 (가명일 수 있음) */
  snapshotName: string;
  /** false → 링크 없음 + "근거 확인 불가" */
  inSnapshot: boolean;
  /** 클러스터 화면 링크용 ResourceRef. 없으면 null */
  ref: { kind: string; namespace: string | null; name: string } | null;
}

/** advisor_suggestions.evidence 원소 */
export interface AdvisorEvidenceJson {
  field: string | null;
  value: string | number | null;
  text: string;
  verified: boolean;
}

/** advisor_suggestions.steps 원소 (Step) */
export interface AdvisorStepJson {
  text: string;
  code: { language: string; content: string } | null;
}

/** advisor_runs.stage 값 (= API StageId) */
export type AdvisorStageId =
  'snapshot' | 'precheck' | 'request' | 'receiving' | 'finalizing';

/** advisor_runs.stage_timings 원소 (API StageState와 같은 모양, 5개 고정 순서) */
export interface AdvisorStageTimingJson {
  id: AdvisorStageId;
  state: 'pending' | 'active' | 'done' | 'error' | 'skipped';
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}
