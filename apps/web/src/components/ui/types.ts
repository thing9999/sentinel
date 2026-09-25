/** components.md 공통 타입 */
export type Status = "ok" | "warn" | "crit" | "unknown" | "stale";
export type Size = "sm" | "md" | "lg";
export type CostKind = "estimate" | "confirmed" | "forecast" | "llmEstimate";
export type Severity = "high" | "medium" | "low";
export type AdvisorCategory = "cost" | "reliability" | "performance" | "security" | "db";
/** 서버가 준 ISO 8601 */
export type IsoTime = string;

export type Tone = "neutral" | "info" | "warn" | "crit";

/** 상태 기본 문구 (status.md 1절) */
export const STATUS_LABEL: Record<Status, string> = {
  ok: "정상",
  warn: "주의",
  crit: "장애",
  unknown: "알 수 없음",
  stale: "데이터 오래됨",
};

/** 화면 정렬 순서(나쁜 것 먼저, status.md 1.5) */
export const STATUS_ORDER: Status[] = ["crit", "warn", "unknown", "stale", "ok"];

/**
 * status.md 1.2 에서 허용한 대체 문구. 이 목록 밖의 문구는 타입 오류가 난다.
 * `진행 중`은 architecture-advisor.md 2.7(분석 이력)에서 쓴다.
 * `커밋 금지`는 aws-snapshot-manager(status.md 1.2·9.1)의 crit 문구다.
 * `차이 없음`·`차이 N건`은 k8s-snapshot 드리프트(status.md 1.2·10.2)의 ok·warn 문구다.
 */
export type StatusAltLabel =
  | "초과"
  | "급증"
  | "연결됨"
  | "로그인 필요"
  | "사용량 한도"
  | "미실행"
  | "확인 중"
  | "완료"
  | "실패"
  | "취소됨"
  | "진행 중"
  | "문제 없음"
  | "커밋 금지"
  | "차이 없음"
  /** 알림 심각도 (status.md 1.2·12.1, 2026-09-25). `확인 불가`≠`알 수 없음`, `해제`≠`정상` — 둘 다 의도해 고른 낱말이다 */
  | "확인 불가"
  | "해제"
  /** 로그 출처 상태 (`logBackend`, status.md 1.2·13.2). `설정 없음`은 오류가 아니다 */
  | "설정 없음"
  | "연결 실패"
  | `차이 ${number}건`
  | `중간 ${number}건`
  | `높음 ${number}건`;

export const SEVERITY_LABEL: Record<Severity, string> = {
  high: "높음",
  medium: "중간",
  low: "낮음",
};

export const CATEGORY_LABEL: Record<AdvisorCategory, string> = {
  cost: "비용 절감",
  reliability: "안정성",
  performance: "성능",
  security: "보안",
  db: "DB",
};

export const COST_KIND_LABEL: Record<CostKind, string> = {
  estimate: "추정",
  confirmed: "확정",
  forecast: "AWS 예측",
  llmEstimate: "LLM 추정",
};

/** 스냅샷 스캔 등급: API 값 그대로 (status.md 9.2). 그 밖의 값은 `알 수 없음`으로 그린다 */
export type ScanLevel = "error" | "warn";

/** k8s-snapshot 드리프트 리소스 구분 = API `resources[].change` 그대로 (components.md 14절, status.md 10.3) */
export type DriftKind = "added" | "deleted" | "changed" | "same";
/** 드리프트 필드 차이 분류 = API `fields[].category` 그대로 (status.md 10.4): 변경 / 기본값 차이 / 관리 필드 */
export type DriftFieldClass = "changed" | "default" | "managed";
/** 드리프트 표시 상태 (components.md 14.3). 호출 측이 API 값을 매핑한다 */
export type DriftState = "changed" | "none" | "unknown" | "notComputed" | "computing" | "stale";
