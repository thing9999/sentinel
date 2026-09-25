/**
 * logs 응답 타입 (docs/api/logs.md 1절).
 *
 * 본문은 **`segments[]`로만** 나간다. `masked` 조각에는 값이 아니라 **표기**가 들어 있다
 * (`ap****(12자)`, `sql_statement`는 `?`). 원문을 돌려주는 필드는 이 파일에 없다 (P1·P3).
 */
export type LogSourceId = 'direct' | 'stack';

export interface LogCapabilities {
  follow: boolean;
  serverSearch: boolean;
  searchScope: 'fetched' | 'server';
  range: 'current_file' | 'retention';
  rangeOptions: { id: string; label: string; sec: number | null }[];
  previousGeneration: boolean;
  gonePods: boolean;
  multiPod: boolean;
  streamSplit: boolean;
  retentionHours: number | null;
  labels: { search: string; searchHint: string };
}

export type LogLineKind = 'line' | 'dropped' | 'binary' | 'redactFailed';

export interface LogRuleRef {
  id: string;
  /** 사람이 읽는 한국어 이름. 화면은 코드 → 문구 매핑 표를 갖지 않는다 */
  label: string;
}

export type LogSegment =
  | { t: 'text'; v: string }
  | {
      t: 'masked';
      v: string;
      rules: LogRuleRef[];
      confidence: 'high' | 'suspect';
    };

export interface LogLine {
  id: string;
  kind: LogLineKind;
  at: string | null;
  prefix: { pod: string; container: string } | null;
  segments: LogSegment[];
  truncatedBytes: number | null;
  droppedLines: number | null;
  bytes: number | null;
  stream: 'stdout' | 'stderr' | null;
}

export interface LogNotice {
  code: string;
  level: 'info' | 'warn' | 'error';
  text: string;
  details?: Record<string, unknown>;
}

export interface LogSelector {
  namespace: string;
  pod?: string;
  pods?: string[];
  workload?: { kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'; name: string };
  container?: string;
  previous?: boolean;
}

export interface LogStats {
  returned: number;
  requested: number;
  bytes: number;
  redactedLines: number;
  redactedCount: number;
  truncatedLines: number;
  droppedLines: number;
  binaryLines: number;
  redactFailedLines: number;
}

export interface LogSourceInfo {
  id: LogSourceId;
  label: string;
  state: 'ok' | 'not_configured' | 'unavailable' | 'mock' | 'stale' | 'syncing';
}
