/**
 * 실행 1건의 서버 내부 표현(RunRecord)과 공개 응답(Run/RunSummary) 변환. 순수 함수.
 */
import type { DataSourceMode } from '../../config/env.validation';
import {
  STAGE_IDS,
  type FailureReason,
  type PrecheckItem,
  type Reason,
  type Run,
  type RunCounts,
  type RunLlm,
  type RunStatus,
  type RunSummary,
  type SnapshotSummary,
  type StageId,
  type StageState,
  type Suggestion,
} from '../advisor.types';
import type { SnapshotMeta } from '../snapshot/snapshot-builder';
import type { PseudonymMap } from '../snapshot/sanitize-snapshot';
import type { AdvisorSnapshotV1 } from '../snapshot/snapshot.types';

export interface RunRecord {
  id: string;
  status: RunStatus;
  failureReason: FailureReason | null;
  isExample: boolean;
  dataSource: DataSourceMode;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  stage: StageId | null;
  stages: StageState[];
  cancelling: boolean;
  receiving: {
    lastReceivedAt: string | null;
    receivedChars: number | null;
  } | null;
  limits: { slowAfterSec: number; timeoutSec: number };
  errorMessage: string | null;
  rawResponse: string | null;
  /** 상세 조회에서 원문을 싣지 않았을 때도 존재 여부를 알 수 있게 */
  hasRawResponse: boolean;
  llm: RunLlm | null;
  usage: Record<string, unknown> | null;
  counts: RunCounts;
  snapshotSummary: SnapshotSummary | null;
  precheckSummary: { high: number; medium: number; low: number } | null;
  precheckResults: PrecheckItem[];
  suggestions: Suggestion[] | null;
  snapshot: AdvisorSnapshotV1 | null;
  snapshotMeta: SnapshotMeta | null;
  snapshotHash: string | null;
  /** 메모리 전용 (DB·브리지로 보내지 않음) */
  pseudonyms: PseudonymMap | null;
}

export const EMPTY_COUNTS: RunCounts = {
  suggestions: 0,
  high: 0,
  medium: 0,
  low: 0,
  dropped: 0,
};

export function initialStages(): StageState[] {
  return STAGE_IDS.map((id) => ({
    id,
    state: 'pending',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  }));
}

export function newRunRecord(p: {
  id: string;
  now: Date;
  dataSource: DataSourceMode;
  isExample: boolean;
  limits: { slowAfterSec: number; timeoutSec: number };
}): RunRecord {
  return {
    id: p.id,
    status: 'queued',
    failureReason: null,
    isExample: p.isExample,
    dataSource: p.dataSource,
    requestedAt: p.now,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    stage: null,
    stages: initialStages(),
    cancelling: false,
    receiving: null,
    limits: p.limits,
    errorMessage: null,
    rawResponse: null,
    hasRawResponse: false,
    llm: null,
    usage: null,
    counts: { ...EMPTY_COUNTS },
    snapshotSummary: null,
    precheckSummary: null,
    precheckResults: [],
    suggestions: null,
    snapshot: null,
    snapshotMeta: null,
    snapshotHash: null,
    pseudonyms: null,
  };
}

/** 단계 시작: 이전 active 단계는 done으로 */
export function enterStage(r: RunRecord, stage: StageId, now: Date): void {
  const iso = now.toISOString();
  for (const s of r.stages) {
    if (s.state === 'active' && s.id !== stage) {
      s.state = 'done';
      s.finishedAt = iso;
      s.durationMs = s.startedAt
        ? now.getTime() - Date.parse(s.startedAt)
        : null;
    }
  }
  const target = r.stages.find((s) => s.id === stage);
  if (target && target.state !== 'active') {
    target.state = 'active';
    target.startedAt = iso;
    target.finishedAt = null;
    target.durationMs = null;
  }
  r.stage = stage;
  if (stage !== 'receiving') r.receiving = null;
}

/** 종료: active 단계는 done(성공) 또는 error(실패)·skipped(취소), 남은 pending은 skipped */
export function closeStages(
  r: RunRecord,
  outcome: 'succeeded' | 'failed' | 'cancelled',
  now: Date,
): void {
  const iso = now.toISOString();
  for (const s of r.stages) {
    if (s.state === 'active') {
      s.state =
        outcome === 'succeeded'
          ? 'done'
          : outcome === 'failed'
            ? 'error'
            : 'skipped';
      s.finishedAt = iso;
      s.durationMs = s.startedAt
        ? now.getTime() - Date.parse(s.startedAt)
        : null;
    } else if (s.state === 'pending') {
      s.state = 'skipped';
    }
  }
}

export const isActiveStatus = (s: RunStatus) =>
  s === 'queued' || s === 'running';

export function elapsedSec(r: RunRecord, now: Date): number {
  const start = (r.startedAt ?? r.requestedAt).getTime();
  const end = r.finishedAt ? r.finishedAt.getTime() : now.getTime();
  return Math.max(0, Math.round((end - start) / 100) / 10);
}

export function toRunSummary(r: RunRecord): RunSummary {
  return {
    id: r.id,
    status: r.status,
    failureReason: r.failureReason,
    isExample: r.isExample,
    dataSource: r.dataSource,
    requestedAt: r.requestedAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs,
    counts: { ...r.counts },
    snapshotSummary: r.snapshotSummary,
  };
}

export function toRun(
  r: RunRecord,
  now: Date,
  opts: {
    includeSuggestions?: boolean;
    freshness?: { stale: boolean; reasons: Reason[] } | null;
  } = {},
): Run {
  const elapsed = elapsedSec(r, now);
  return {
    ...toRunSummary(r),
    stage: r.stage,
    stages: r.stages.map((s) => ({ ...s })),
    elapsedSec: elapsed,
    delayed: isActiveStatus(r.status) && elapsed >= r.limits.slowAfterSec,
    cancelling: r.cancelling,
    receiving:
      r.stage === 'receiving' && isActiveStatus(r.status) ? r.receiving : null,
    limits: { ...r.limits },
    errorMessage: r.errorMessage,
    hasRawResponse: r.hasRawResponse,
    llm: r.llm,
    precheckSummary: r.precheckSummary,
    suggestions:
      opts.includeSuggestions === false || r.status !== 'succeeded'
        ? null
        : r.suggestions,
    freshness: opts.freshness ?? null,
  };
}

/** 결과 신선도 (A.10) */
export function computeFreshness(
  r: RunRecord,
  current: SnapshotSummary | null,
  now: Date,
  staleResultDays: number,
): { stale: boolean; reasons: Reason[] } {
  const reasons: Reason[] = [];
  const at = r.finishedAt ?? r.requestedAt;
  const days = (now.getTime() - at.getTime()) / 86_400_000;
  if (days >= staleResultDays) {
    reasons.push({
      code: 'RESULT_OLDER_THAN_LIMIT',
      text: `마지막 분석 후 ${Math.floor(days)}일이 지났습니다`,
      status: 'warning',
    });
  }
  const prev = r.snapshotSummary;
  if (prev && current) {
    // 워커 수와 마스터 수를 **각각** 알린다. 마스터 수 변화는 워커보다 중요한 신호(쿼럼)라
    // 한 문장에 뭉뚱그리면 안 된다 (kops-support PM 결정 2026-09-24).
    // 옛 실행 기록(JSON)에는 이 필드가 없을 수 있으므로 둘 다 숫자일 때만 비교한다.
    const changed = (a: unknown, b: unknown): boolean =>
      typeof a === 'number' && typeof b === 'number' && a !== b;
    if (changed(prev.workerCount, current.workerCount)) {
      reasons.push({
        code: 'WORKER_COUNT_CHANGED',
        text: `분석 후 워커 노드 수가 ${prev.workerCount} → ${current.workerCount}로 바뀌었습니다`,
        status: 'warning',
      });
    }
    if (changed(prev.controlPlaneCount, current.controlPlaneCount)) {
      reasons.push({
        code: 'CONTROL_PLANE_COUNT_CHANGED',
        text: `분석 후 마스터 노드 수가 ${prev.controlPlaneCount} → ${current.controlPlaneCount}로 바뀌었습니다`,
        status: 'warning',
      });
    }
    const a = new Map(prev.instanceTypes.map((t) => [t.type, t.count]));
    const b = new Map(current.instanceTypes.map((t) => [t.type, t.count]));
    const diffs: string[] = [];
    for (const type of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const x = a.get(type) ?? 0;
      const y = b.get(type) ?? 0;
      if (x !== y) diffs.push(`${type} ${x} → ${y}`);
    }
    if (diffs.length > 0) {
      reasons.push({
        code: 'INSTANCE_TYPES_CHANGED',
        text: `분석 후 인스턴스 타입 구성이 바뀌었습니다 (${diffs.join(', ')})`,
        status: 'warning',
      });
    }
  }
  return { stale: reasons.length > 0, reasons };
}
