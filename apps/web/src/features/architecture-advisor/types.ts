/**
 * docs/api/architecture-advisor.md A절 공개 계약 타입.
 * 모든 문자열(제안·근거·단계·코드·메시지)은 신뢰할 수 없는 텍스트다 → 텍스트 노드로만 렌더.
 */
import type { ApiStatusValue, DataSource, IsoTime, Money, Reason, ResourceRef, StatusInfo } from "../common/types";

export type BridgeStateValue = "connected" | "login_required" | "usage_limit" | "unreachable" | "unknown";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type FailureReason =
  | "bridge_unavailable"
  | "login_required"
  | "usage_limit"
  | "timeout"
  | "invalid_response"
  | "budget_exceeded"
  | "interrupted"
  | "other";
export type StageId = "snapshot" | "precheck" | "request" | "receiving" | "finalizing";
export type CategoryValue = "cost" | "reliability" | "performance" | "security" | "database";
export type SeverityValue = "high" | "medium" | "low";

export interface BridgeStatus {
  state: BridgeStateValue;
  status: StatusInfo;
  message: string;
  command: string | null;
  retryAt: IsoTime | null;
  checkedAt: IsoTime | null;
  authCheckedAt: IsoTime | null;
  sdkVersion: string | null;
  claudeCodeVersion: string | null;
  busy: boolean;
  canRun: boolean;
  disabledReason: null | "bridge_unreachable" | "login_required" | "usage_limit" | "checking" | "run_in_progress" | "dashboard_busy";
  exampleMode: boolean;
}

export interface RunCounts {
  suggestions: number;
  high: number;
  medium: number;
  low: number;
  dropped: number;
}

export interface SnapshotSummary {
  nodeCount: number;
  workloadCount: number;
  pvcCount: number;
  loadBalancerCount: number;
  instanceTypes: { type: string; count: number }[];
  estimatedMonthly: Money | null;
  budgetStatus: ApiStatusValue | null;
  precheck: { high: number; medium: number; low: number; held: number };
  observationSec: number;
  omitted: { workloads: number; nodes: number };
  redactedCount: number;
  bytes: number;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  failureReason: FailureReason | null;
  isExample: boolean;
  dataSource: DataSource;
  requestedAt: IsoTime;
  startedAt: IsoTime | null;
  finishedAt: IsoTime | null;
  durationMs: number | null;
  counts: RunCounts;
  snapshotSummary: SnapshotSummary | null;
}

export interface StageState {
  id: StageId;
  state: "pending" | "active" | "done" | "error" | "skipped";
  startedAt: IsoTime | null;
  finishedAt: IsoTime | null;
  durationMs: number | null;
}

export interface TargetRef {
  kind: string;
  namespace: string | null;
  name: string;
  snapshotName: string;
  inSnapshot: boolean;
  ref: ResourceRef | null;
}

export interface Evidence {
  field: string | null;
  value: string | number | null;
  text: string;
  verified: boolean;
}

export interface Savings {
  monthlyUsd: number;
  kind: "estimated";
  asOf: IsoTime;
  formula: string;
  source: "server" | "llm";
}

export interface Suggestion {
  id: string;
  priority: number;
  title: string;
  category: CategoryValue;
  severity: SeverityValue;
  targets: TargetRef[];
  evidence: Evidence[];
  precheckIds: string[];
  savings: Savings | null;
  steps: { text: string; code: { language: string; content: string } | null }[];
  noExecuteNotice: string;
  risk: { level: SeverityValue; reason: string };
  verification: string | null;
  unverified: boolean;
  source: "llm";
}

export interface Run extends RunSummary {
  stage: StageId | null;
  stages: StageState[];
  elapsedSec: number;
  delayed: boolean;
  cancelling: boolean;
  receiving: { lastReceivedAt: IsoTime | null; receivedChars: number | null } | null;
  limits: { slowAfterSec: number; timeoutSec: number };
  errorMessage: string | null;
  hasRawResponse: boolean;
  llm: {
    model: string | null;
    costUsd: number | null;
    durationApiMs: number | null;
    numTurns: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
  } | null;
  precheckSummary: { high: number; medium: number; low: number } | null;
  suggestions: Suggestion[] | null;
  freshness: { stale: boolean; reasons: Reason[] } | null;
}

export interface PrecheckItem {
  id: string;
  ruleId: string;
  ruleTitle: string;
  category: CategoryValue;
  severity: SeverityValue | null;
  summary: string;
  evidenceText: string;
  targets: TargetRef[];
  targetCount: number;
  evidence: Evidence[];
  savings: Savings | null;
  held: boolean;
  heldReason: string | null;
  observedSec: number | null;
  requiredSec: number | null;
  source: "rule";
}

export interface PrecheckSummary {
  status: StatusInfo;
  computedAt: IsoTime | null;
  intervalSec: number;
  counts: { high: number; medium: number; low: number; held: number };
}

/** GET /api/advisor = advisor.snapshot payload */
export interface AdvisorState {
  dataSource?: DataSource;
  generatedAt?: IsoTime;
  persistence: "database" | "memory";
  bridge: BridgeStatus;
  activeRun: Run | null;
  lastRun: RunSummary | null;
  latestResult: Run | null;
  precheck: PrecheckSummary;
  history: { total: number; retention: { maxCount: number; maxDays: number } };
}

export interface PrechecksResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  computedAt: IsoTime | null;
  intervalSec: number;
  includeSystem: boolean;
  status: StatusInfo;
  counts: { high: number; medium: number; low: number; held: number };
  matrix: Record<CategoryValue, Record<SeverityValue, number>>;
  sources: { cluster: string; cost: string; db: string };
  items: PrecheckItem[];
}

export interface RunsResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  total: number;
  filteredTotal: number;
  offset: number;
  limit: number | null;
  retention: { maxCount: number; maxDays: number };
  items: RunSummary[];
}

export interface CreateRunResponse {
  created: boolean;
  run: Run;
}

export interface SnapshotPreview {
  dataSource: DataSource;
  generatedAt: IsoTime;
  meta: {
    bytes: number;
    redactedCount: number;
    redactedFields: string[];
    omitted: { workloads: number; nodes: number };
    observationSec: number;
    dataSource: DataSource;
    transmissionNotice: string;
  };
  summary: SnapshotSummary | null;
  snapshot: unknown;
}

export interface RunSnapshotResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  runId: string;
  meta: SnapshotPreview["meta"];
  snapshot: unknown;
}

export interface RawResponse {
  runId: string;
  truncated: boolean;
  bytes: number;
  text: string;
}
