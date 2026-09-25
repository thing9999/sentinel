/**
 * architecture-advisor 공개 계약 타입 (docs/api/architecture-advisor.md A.1)
 * 스냅샷 입력 스키마(B.2)는 snapshot/snapshot.types.ts
 */
import type { DataSourceMode } from '../config/env.validation';

export type Status = 'ok' | 'warning' | 'critical' | 'unknown';

export interface Reason {
  code: string;
  text: string;
  status: Status;
}

export interface StatusInfo {
  status: Status;
  reasons: Reason[];
  updatedAt: string | null;
  statusChangedAt: string | null;
  stale: boolean;
}

export interface Money {
  amountUsd: number;
  kind: 'estimated' | 'actual' | 'forecast';
  asOf: string;
}

export interface ResourceRef {
  kind: string;
  namespace: string | null;
  name: string;
}

export type BridgeState =
  'connected' | 'login_required' | 'usage_limit' | 'unreachable' | 'unknown';

export type RunStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const FAILURE_REASONS = [
  'bridge_unavailable',
  'login_required',
  'usage_limit',
  'timeout',
  'invalid_response',
  'budget_exceeded',
  'interrupted',
  'other',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const STAGE_IDS = [
  'snapshot',
  'precheck',
  'request',
  'receiving',
  'finalizing',
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const CATEGORIES = [
  'cost',
  'reliability',
  'performance',
  'security',
  'database',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ['high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export type DisabledReason =
  | null
  | 'bridge_unreachable'
  | 'login_required'
  | 'usage_limit'
  | 'checking'
  | 'run_in_progress'
  | 'dashboard_busy';

export interface BridgeStatus {
  state: BridgeState;
  status: StatusInfo;
  message: string;
  command: string | null;
  retryAt: string | null;
  checkedAt: string | null;
  authCheckedAt: string | null;
  sdkVersion: string | null;
  claudeCodeVersion: string | null;
  busy: boolean;
  canRun: boolean;
  disabledReason: DisabledReason;
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
  /** 워커 노드 수 (구 nodeCount). 마스터를 포함하지 않는다 */
  workerCount: number;
  /** 마스터 노드 수 */
  controlPlaneCount: number;
  workloadCount: number;
  pvcCount: number;
  loadBalancerCount: number;
  instanceTypes: { type: string; count: number }[];
  estimatedMonthly: Money | null;
  budgetStatus: Status | null;
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
  dataSource: DataSourceMode;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  counts: RunCounts;
  snapshotSummary: SnapshotSummary | null;
}

export type StageStateValue =
  'pending' | 'active' | 'done' | 'error' | 'skipped';

export interface StageState {
  id: StageId;
  state: StageStateValue;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface RunLlm {
  model: string | null;
  costUsd: number | null;
  durationApiMs: number | null;
  numTurns: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface Run extends RunSummary {
  stage: StageId | null;
  stages: StageState[];
  elapsedSec: number;
  delayed: boolean;
  cancelling: boolean;
  receiving: {
    lastReceivedAt: string | null;
    receivedChars: number | null;
  } | null;
  limits: { slowAfterSec: number; timeoutSec: number };
  errorMessage: string | null;
  hasRawResponse: boolean;
  llm: RunLlm | null;
  precheckSummary: { high: number; medium: number; low: number } | null;
  suggestions: Suggestion[] | null;
  freshness: { stale: boolean; reasons: Reason[] } | null;
}

export type TargetKind =
  | 'Node'
  | 'NodeGroup'
  | 'Deployment'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'Pod'
  | 'PersistentVolumeClaim'
  | 'LoadBalancer'
  | 'Namespace'
  | 'Database'
  | 'Cluster'
  | 'Other';

export const TARGET_KINDS: readonly TargetKind[] = [
  'Node',
  'NodeGroup',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Pod',
  'PersistentVolumeClaim',
  'LoadBalancer',
  'Namespace',
  'Database',
  'Cluster',
  'Other',
];

export interface TargetRef {
  kind: TargetKind;
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
  kind: 'estimated';
  asOf: string;
  formula: string;
  source: 'server' | 'llm';
}

export interface Step {
  text: string;
  code: { language: string; content: string } | null;
}

export const NO_EXECUTE_NOTICE =
  '대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.';

export interface Suggestion {
  id: string;
  priority: number;
  title: string;
  category: Category;
  severity: Severity;
  targets: TargetRef[];
  evidence: Evidence[];
  precheckIds: string[];
  savings: Savings | null;
  steps: Step[];
  noExecuteNotice: string;
  risk: { level: Severity; reason: string };
  verification: string | null;
  unverified: boolean;
  source: 'llm';
}

export interface PrecheckItem {
  id: string;
  ruleId: string;
  ruleTitle: string;
  category: Category;
  severity: Severity | null;
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
  source: 'rule';
}

export type SourceAvailability = 'ok' | 'unknown';

export interface PrecheckCounts {
  high: number;
  medium: number;
  low: number;
  held: number;
}

export interface PrecheckOverview {
  status: StatusInfo;
  computedAt: string | null;
  intervalSec: number;
  counts: PrecheckCounts;
}

export interface AdvisorLimits {
  slowAfterSec: number;
  timeoutSec: number;
  bridgeHealthIntervalSec: number;
  bridgeHealthTimeoutSec: number;
  maxWorkloads: number;
  maxNodes: number;
  staleResultDays: number;
  maxBudgetUsd: number;
  maxTurns: number;
}
