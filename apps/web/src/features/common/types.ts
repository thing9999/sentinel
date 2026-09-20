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
export type MockGroupId = "cluster" | "db" | "cost" | "advisor" | "snapshots" | "k8s-snapshots";

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
  | "snapshot-menu";
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
