/**
 * docs/api/common.md 7절 공통 타입. 계약에 없는 필드는 두지 않는다.
 */

export type ApiStatusValue = "ok" | "warning" | "critical" | "unknown";
export type DataSource = "mock" | "live";
export type IsoTime = string;

export interface Reason {
  code: string;
  text: string;
  status: ApiStatusValue;
}

export interface StatusInfo {
  status: ApiStatusValue;
  reasons: Reason[];
  updatedAt: IsoTime | null;
  statusChangedAt: IsoTime | null;
  stale: boolean;
}

export type SourceId =
  | "kube"
  | "metrics"
  | "prometheus"
  | "monitoredDb"
  | "awsResources"
  | "pricing"
  | "spotPrice"
  | "costExplorer"
  | "agentBridge"
  | "dashboardDb"
  | "snapshotStore"
  /** 로컬 k8s 스냅샷 폴더 (k8s-snapshot.md 0절). 드리프트 값은 kube 출처를 따른다 */
  | "k8sSnapshotStore";

export type SourceState = "ok" | "syncing" | "stale" | "unavailable" | "not_configured" | "mock";

export interface SourceStatus {
  id: SourceId;
  state: SourceState;
  intervalSec: number | null;
  staleAfterSec: number | null;
  lastSuccessAt: IsoTime | null;
  lastAttemptAt: IsoTime | null;
  error: { code: string; message: string } | null;
}

export interface ResourceRef {
  kind: string;
  namespace: string | null;
  name: string;
}

export interface ListMeta {
  total: number;
  filteredTotal: number;
  offset: number;
  limit: number | null;
}

export interface Thresholds {
  warnPct: number;
  critPct: number | null;
}

export type MoneyKind = "estimated" | "actual" | "forecast";

export interface Money {
  amountUsd: number;
  kind: MoneyKind;
  asOf: IsoTime;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  path: string;
  timestamp: IsoTime;
}

/** GET /api/health (common.md 4절) */
export interface HealthCheck {
  state: SourceState;
  configured: boolean;
  message: string | null;
  checkedAt: IsoTime | null;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  dataSource: DataSource;
  version: string;
  serverTime: IsoTime;
  startedAt: IsoTime;
  uptimeSec: number;
  checks: Record<string, HealthCheck>;
}

/** mock 시나리오 (common.md 6절) */
export type MockGroupId =
  | "cluster"
  | "db"
  | "cost"
  | "advisor"
  | "snapshots"
  | "k8s-snapshots"
  /** alerts P1 (alerts.md 5절) · logs L1 (logs.md 9절). 상단바 MOCK 배지에는 없고 `/dev/mock` 에서 바꾼다 */
  | "alerts"
  | "logs";

export interface MockScenarioOption {
  id: string;
  label: string;
  description: string;
}

export interface MockScenarioGroup {
  id: MockGroupId;
  label: string;
  active: string;
  options: MockScenarioOption[];
  fastTimers?: boolean;
}

export interface MockScenariosResponse {
  dataSource: DataSource;
  enabled: boolean;
  generatedAt: IsoTime;
  groups: MockScenarioGroup[];
}

/** SSE 봉투 (common.md 5.3) */
export type StreamTopic =
  | "overview"
  | "cluster"
  | "metrics"
  | "db"
  | "cost"
  | "advisor"
  | "aws-snapshots"
  | "k8s-snapshots"
  | "snapshot-menu"
  /**
   * alerts (alerts.md 6절). **모든 페이지가 구독한다**(사이드바 배지·탭 제목).
   * 이 토픽에는 **이력 목록이 실리지 않는다**(6.1·AC-ALERT37) — 목록은 `/alerts` 화면이 REST 로만 읽는다.
   * `logs` 토픽은 **없다**: 로그는 전용 연결이고 `?topics=logs` 는 400 이다(logs.md 0.3·7절).
   */
  | "alerts";
export const ALL_TOPICS: readonly StreamTopic[] = [
  "overview",
  "cluster",
  "metrics",
  "db",
  "cost",
  "advisor",
  "aws-snapshots",
  "k8s-snapshots",
  "snapshot-menu",
  "alerts",
];

export interface StreamEnvelope<T = unknown> {
  seq: number;
  topic: "stream" | StreamTopic;
  emittedAt: IsoTime;
  payload: T;
}

export interface StreamHello {
  streamId: string;
  dataSource: DataSource;
  serverTime: IsoTime;
  heartbeatSec: number;
  topics: StreamTopic[];
  sources: SourceStatus[];
}
