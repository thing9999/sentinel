/**
 * 외부 로그 스택 어댑터의 **출처 중립 경계** (docs/api/logs.md 1.1·13절, AC-LOG47).
 *
 * 이 파일 위쪽(서비스·컨트롤러·응답)에는 **제품 고유의 것이 하나도 없다**:
 * LogQL·인덱스 이름·라벨 이름·쿼리 DSL은 전부 어댑터 **안에만** 있다.
 * Elasticsearch 어댑터를 붙여도 바뀌는 것은 `LOG_BACKEND` 값과 이 인터페이스의
 * 구현 1개뿐이고 **응답 모양과 화면은 그대로**여야 한다.
 *
 * 화면이 다루는 것은 셀렉터·기간·텍스트·줄 수뿐이다.
 */

export interface LogBackendSelector {
  namespace: string;
  /** 1개 이상. 여러 개면 시각 순으로 섞어 준다 */
  pods: string[];
  /** 비우면 파드의 모든 컨테이너 */
  containers: string[];
  workload: { kind: string; name: string } | null;
}

export interface LogBackendQuery {
  selector: LogBackendSelector;
  from: Date;
  to: Date;
  limit: number;
  /** 서버 검색. `null`이면 전체 */
  search: { text: string; caseSensitive: boolean } | null;
}

export interface LogBackendEntry {
  /** ISO UTC */
  at: string;
  /** **아직 원문이다.** 호출부가 반드시 가림을 거친다 */
  line: string;
  pod: string;
  container: string;
  stream: 'stdout' | 'stderr' | null;
}

export type LogBackendErrorCode =
  | 'LOG_BACKEND_UNAVAILABLE'
  | 'LOG_BACKEND_AUTH_FAILED'
  | 'LOG_BACKEND_QUERY_REJECTED';

export class LogBackendError extends Error {
  constructor(
    readonly code: LogBackendErrorCode,
    message: string,
    /** 스택이 준 사유 (가림 처리됨). 서버가 조용히 범위를 줄이지 않는다 — AC-LOG43 */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'LogBackendError';
  }
}

export interface LogBackendTailHandle {
  close(): void;
}

export interface LogBackendPort {
  /** 화면에 보일 제품 이름 (`Loki` 등). 능력 추론에 쓰지 않는다 — 표시용이다 */
  readonly productLabel: string | null;
  /** 보관 기간(시간). 모르면 null */
  readonly retentionHours: number | null;
  /** 기간 상한(시간). 넘는 요청은 서비스가 400으로 막는다 */
  readonly maxRangeHours: number;

  /** 연결 확인 (출처 상태용). 실패하면 `LogBackendError` */
  ping(): Promise<void>;

  /** 정지 조회. 결과는 **시각 오름차순** */
  query(q: LogBackendQuery): Promise<LogBackendEntry[]>;

  /** 따라가기. 반환한 `close()`가 위쪽 연결을 끊는다 */
  tail(
    q: Omit<LogBackendQuery, 'from' | 'to'>,
    handlers: {
      onEntries: (entries: LogBackendEntry[]) => void;
      onError: (err: LogBackendError) => void;
    },
  ): LogBackendTailHandle;
}

export const LOG_BACKEND_PORT = Symbol('LOG_BACKEND_PORT');
