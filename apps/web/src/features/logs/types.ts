/**
 * docs/api/logs.md 1절 공통 타입. 계약에 없는 필드는 두지 않는다.
 *
 * **원문을 담는 필드가 없다**(P1·P3). 본문은 서버가 가린 `segments[]`로만 오고,
 * 가림을 끄는 요청 필드도 없다(P2).
 */
import type { DataSource, IsoTime, ResourceRef, SourceState } from "../common/types";
import type { LogLine } from "@/components/ui";

export type { LogLine } from "@/components/ui";

export type LogSourceId = "direct" | "stack";

export interface LogCapabilities {
  follow: boolean;
  serverSearch: boolean;
  searchScope: "fetched" | "server";
  range: "current_file" | "retention";
  rangeOptions: { id: string; label: string; sec: number | null }[];
  previousGeneration: boolean;
  gonePods: boolean;
  multiPod: boolean;
  streamSplit: boolean;
  retentionHours: number | null;
  /** 찾기 라벨·부제 — **서버 문구 그대로**. `direct`에서 "검색"이라는 낱말을 쓰지 않는다(6.3) */
  labels: { search: string; searchHint: string };
}

export interface LogLimitationLine {
  code: string;
  text: string;
  hint?: string;
}

export interface LogSourceInfo {
  id: LogSourceId;
  label: string;
  productLabel: string | null;
  selectable: boolean;
  state: SourceState;
  /** 비활성 사유 — 목록에서 지우지 않고 이 문구를 툴팁으로 보여 준다 */
  disabledReason: string | null;
  tooltip: string | null;
  chips: { id: string; label: string }[];
  capabilities: LogCapabilities | null;
  limitations: { summary: string; lines: LogLimitationLine[] } | null;
}

export interface LogNotice {
  code: string;
  level: "info" | "warn" | "error";
  /** 화면은 코드 → 문구 매핑 표를 갖지 않는다. 이 값을 그대로 쓴다(계약 1.3) */
  text: string;
  details?: Record<string, unknown>;
}

export interface LogLimits {
  defaultLines: number;
  maxLines: number;
  lineOptions: number[];
  maxBytes: number;
  maxLineBytes: number;
  maxStreams: number;
  maxLinesPerSec: number;
  idlePauseSec: number;
  maxStreamMin: number;
}

export interface LogRedactionRule {
  id: string;
  label: string;
  confidence: "high" | "suspect";
}

export interface LogCapabilitiesResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  enabled: boolean;
  activeSource: LogSourceId;
  autoSelect: { source: LogSourceId; code: string; text: string } | null;
  sources: LogSourceInfo[];
  limits: LogLimits;
  streams: { open: number; max: number };
  redaction: {
    alwaysOn: boolean;
    notice: string;
    /** **개수를 화면에 숫자로 박지 않는다.** 이 목록이 정본이고 앞으로 늘어난다(7.3) */
    rules: LogRedactionRule[];
    sourceNote: string;
  };
  denyNamespaces: string[];
  notices: LogNotice[];
}

export interface LogContainerInfo {
  name: string;
  init: boolean;
  ready: boolean;
  state: "running" | "waiting" | "terminated" | string;
  waitingReason: string | null;
  restarts: { total: number; last1h: number };
  hasPrevious: boolean;
  recommended: boolean;
}

export interface LogTargetsResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  pod: {
    ref: ResourceRef;
    /** **서버 값**. 화면이 "아직 있을 것"이라고 추측하지 않는다 */
    exists: boolean;
    deletedAt: IsoTime | null;
    phase: string | null;
    nodeName: string | null;
    nodeReporting: boolean | null;
    isControlPlaneComponent: boolean;
  };
  containers: LogContainerInfo[];
  /** 서버가 고른다(2.1.2). 화면이 다시 고르지 않는다 */
  defaultContainer: string | null;
  links: { workload: string | null; events: string | null; node: string | null };
  stackSearch?: { available: boolean; hint: string };
  notices: LogNotice[];
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

/** 계약 1.4. `direct`는 `pod` 필수·`pods`/`workload` 금지(400). `pods`는 최대 20 */
export interface LogSelector {
  namespace: string;
  pod?: string;
  /** stack 합쳐보기 (최대 20) */
  pods?: string[];
  /** stack: 서버가 소속 파드(지금 + 최근 1시간 사라진 것, 최대 20)로 푼다 */
  workload?: { kind: "Deployment" | "StatefulSet" | "DaemonSet"; name: string };
  container?: string;
  previous?: boolean;
}

/** 응답의 `selector` — stack 이 `workload`를 풀어 실제로 조회한 파드가 `resolvedPods`로 온다(그 밖에는 `null`) */
export interface LogResolvedSelector extends LogSelector {
  resolvedPods?: string[] | null;
}

/** 계약 2.2.1 `anchor` — **화면은 시각을 비교하지 않고 이 값만 쓴다** */
export interface LogAnchor {
  at: IsoTime;
  state: "found" | "before_result" | "after_result" | "none";
  lineId: string | null;
}

export interface LogQueryRequest {
  source?: LogSourceId;
  selector: LogSelector;
  range?: { sinceSec: number } | { from: string; to: string } | { whole: true };
  limit?: number;
  /** `capabilities.serverSearch`가 false 인 출처에 보내면 400 — 화면이 보내지 않는다 */
  search?: { text: string; caseSensitive?: boolean };
  /**
   * 그 시각으로 열기(계약 2.2.1). 링크의 `at` 그대로. **정지 조회 전용**(스트림에 보내면 400).
   * 사용자가 기간을 고르기 전에는 `range`를 보내지 않는다 — 서버가 출처에 맞게 고른다.
   */
  anchorAt?: string;
}

export interface LogQueryResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  queryId: string;
  source: { id: LogSourceId; label: string; state: SourceState };
  capabilities: LogCapabilities;
  selector: LogResolvedSelector;
  range: { from: IsoTime | null; to: IsoTime | null; whole: boolean };
  /** `anchorAt`을 보냈을 때만 객체(2.2.1) */
  anchor?: LogAnchor | null;
  lines: LogLine[];
  stats: LogStats;
  streams: { open: number; max: number };
  notices: LogNotice[];
}

export interface LogStreamCreated {
  streamId: string;
  url: string;
  expiresAt: IsoTime;
  source: { id: LogSourceId; label: string; state: SourceState };
  capabilities: LogCapabilities;
  limits: Pick<LogLimits, "maxLinesPerSec" | "idlePauseSec" | "maxStreamMin">;
  streams: { open: number; max: number };
  notices: LogNotice[];
}

/** 전용 스트림 봉투 (계약 2.3.2). 공용 SSE와 **다르다** — `topic`이 없다 */
export interface LogStreamEnvelope<T = unknown> {
  seq: number;
  event: string;
  emittedAt: IsoTime;
  payload: T;
}

export interface LogHelloPayload {
  streamId: string;
  source: { id: LogSourceId; label: string; state: SourceState };
  capabilities: LogCapabilities;
  /** 조회 응답과 같은 모양 — stack 워크로드면 `resolvedPods`(2026-09-25 backend 5e) */
  selector: LogResolvedSelector;
  limits: Pick<LogLimits, "maxLinesPerSec" | "idlePauseSec" | "maxStreamMin">;
  streams: { open: number; max: number };
  serverTime: IsoTime;
  heartbeatSec: number;
}

export interface LogLinesPayload {
  lines: LogLine[];
  initial?: true;
  stats?: Partial<LogStats>;
}

export interface LogClosingPayload {
  reason: "max_duration" | "idle" | "client" | "source_error" | "shutdown";
  code: string;
  text: string;
  resumable: boolean;
}

export interface LogPausedPayload {
  code: string;
  text: string;
  resumable: boolean;
}
