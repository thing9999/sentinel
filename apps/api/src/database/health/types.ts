/**
 * 모니터링 대상 DB 상태 조회: 벤더 공통 타입.
 *
 * - 이 디렉터리는 "순수" 모듈이다: SQL 상수, 결과 타입, 결과 정규화 함수만 둔다.
 *   DB 연결·실행·스케줄링은 backend(`src/db-health`)가 한다.
 * - 벤더별 구현은 하위 폴더(`postgres/`, 이후 `mysql/` 등)에 둔다.
 * - 상세 설명: `docs/db/health.md`
 */

/** 모니터링 대상 DB 벤더. 현재는 postgres만 구현. */
export type DbVendor = 'postgres';

/**
 * 상태 단계 (명세 `cluster-status` 3.0).
 * ok=정상, warning=주의, critical=장애, unknown=알 수 없음(조회 실패·권한 없음).
 * "데이터 오래됨"은 시간 기반 판단이라 backend가 붙인다.
 */
export type HealthLevel = 'ok' | 'warning' | 'critical' | 'unknown';

/** 집계 우선순위: 장애 > 주의 > 알 수 없음 > 정상 (명세 3.0) */
const LEVEL_RANK: Record<HealthLevel, number> = {
  ok: 0,
  unknown: 1,
  warning: 2,
  critical: 3,
};

/** 여러 상태 중 가장 나쁜 상태. 빈 배열이면 ok. */
export function worstLevel(levels: readonly HealthLevel[]): HealthLevel {
  let worst: HealthLevel = 'ok';
  for (const level of levels) {
    if (LEVEL_RANK[level] > LEVEL_RANK[worst]) worst = level;
  }
  return worst;
}

/** 판단 하나의 결과. 화면의 "상태 배지 + 판단 이유 한 줄"에 그대로 쓴다. */
export interface HealthCheckResult<Id extends string = string> {
  id: Id;
  level: HealthLevel;
  /** 판단 이유 한 줄 (예: "연결 92% (max 100)") */
  reason: string;
  /** 판단에 쓴 대표 값 (단위는 unit). 값이 없으면 null */
  value: number | null;
  unit: HealthUnit | null;
  /** false면 해당 없음(예: standby 없음 → 복제). 화면에서 숨긴다. level은 ok. */
  applicable: boolean;
  /**
   * true면 이번 표본으로는 판단하지 않고 직전 상태를 유지했다
   * (예: 캐시 적중률 표본 블록 부족). level은 직전 상태(없으면 ok).
   */
  held: boolean;
  /**
   * 순간 튐 방지(연속 3회 조건) 대상인 사용률 지표인지 (명세 3.0 "지속 조건").
   * 여기서 계산한 level은 "이번 표본 기준 순간값"이며, 연속 조건은 backend가 적용한다.
   */
  sustained: boolean;
}

export type HealthUnit =
  'ms' | 'sec' | 'percent' | 'count' | 'bytes' | 'xid' | 'per_sec';

/**
 * 조회 쿼리 한 개의 메타데이터. backend는 이 값대로 실행 주기·타임아웃을 건다.
 */
export interface HealthQuery<Id extends string = string> {
  id: Id;
  /** 한 줄 목적 */
  purpose: string;
  sql: string;
  /** 위치 파라미터 설명 ($1, $2 ...). 없으면 빈 배열 */
  params: readonly string[];
  /** 이 쿼리에 거는 statement_timeout (ms) */
  timeoutMs: number;
  /** 권장 조회 간격 (초) */
  intervalSec: number;
  /** 무거운 쿼리 여부 (true면 짧은 주기로 돌리지 말 것) */
  heavy: boolean;
  /** 실행 대상 서버 역할. primary: pg_is_in_recovery()=false 일 때만 */
  runOn: 'any' | 'primary' | 'standby';
  /** true면 DB마다 접속해서 따로 실행해야 한다 (현재 DB 기준 함수 사용) */
  perDatabase: boolean;
  /** 지원하는 최소 서버 버전 (server_version_num) */
  minServerVersionNum: number;
}
