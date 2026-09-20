/**
 * 실행 이력 저장소.
 * - PrismaRunStore: advisor_runs / advisor_suggestions (DBA 스키마 docs/db/schema.md 2.6·2.7)
 * - MemoryRunStore: 대시보드 DB가 없거나 저장이 실패했을 때 (재시작하면 사라짐)
 * 동시 1건: DB는 active_lock UNIQUE(P2002), 메모리는 active 확인.
 */
import type {
  AdvisorEvidenceJson,
  AdvisorStageTimingJson,
  AdvisorStepJson,
  AdvisorTargetRefJson,
} from '../../database/advisor-json';
import {
  Prisma,
  type PrismaClient,
} from '../../database/generated/prisma/client';
import {
  NO_EXECUTE_NOTICE,
  type Evidence,
  type PrecheckItem,
  type RunStatus,
  type SnapshotSummary,
  type StageId,
  type StageState,
  type Step,
  type Suggestion,
  type TargetRef,
} from '../advisor.types';
import type { AdvisorSnapshotV1 } from '../snapshot/snapshot.types';
import {
  EMPTY_COUNTS,
  initialStages,
  isActiveStatus,
  type RunRecord,
} from './run-model';

export interface RunListQuery {
  limit: number;
  offset: number;
  statuses: RunStatus[] | null;
}

export interface RunListResult {
  items: RunRecord[];
  total: number;
  filteredTotal: number;
}

export type CreateResult =
  { created: true } | { created: false; existingId: string | null };

export interface RunStore {
  createActive(r: RunRecord): Promise<CreateResult>;
  saveProgress(r: RunRecord): Promise<void>;
  finish(r: RunRecord): Promise<void>;
  get(id: string): Promise<RunRecord | null>;
  getSnapshot(id: string): Promise<AdvisorSnapshotV1 | null>;
  getRaw(id: string): Promise<string | null>;
  list(q: RunListQuery): Promise<RunListResult>;
  latest(status?: RunStatus): Promise<RunRecord | null>;
  count(): Promise<number>;
  has(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// 메모리
// ---------------------------------------------------------------------------

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly maxCount = 50) {}

  private active(): RunRecord | null {
    for (const r of this.runs.values()) if (isActiveStatus(r.status)) return r;
    return null;
  }

  private sorted(): RunRecord[] {
    return [...this.runs.values()].sort(
      (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime(),
    );
  }

  put(r: RunRecord): void {
    this.runs.set(r.id, r);
    const all = this.sorted();
    for (const old of all.slice(this.maxCount)) {
      if (!isActiveStatus(old.status)) this.runs.delete(old.id);
    }
  }

  delete(id: string): void {
    this.runs.delete(id);
  }

  clear(): void {
    this.runs.clear();
  }

  createActive(r: RunRecord): Promise<CreateResult> {
    const active = this.active();
    if (active && active.id !== r.id)
      return Promise.resolve({ created: false, existingId: active.id });
    this.put(r);
    return Promise.resolve({ created: true });
  }

  saveProgress(r: RunRecord): Promise<void> {
    this.put(r);
    return Promise.resolve();
  }

  finish(r: RunRecord): Promise<void> {
    this.put(r);
    return Promise.resolve();
  }

  get(id: string): Promise<RunRecord | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  getSnapshot(id: string): Promise<AdvisorSnapshotV1 | null> {
    return Promise.resolve(this.runs.get(id)?.snapshot ?? null);
  }

  getRaw(id: string): Promise<string | null> {
    return Promise.resolve(this.runs.get(id)?.rawResponse ?? null);
  }

  list(q: RunListQuery): Promise<RunListResult> {
    const all = this.sorted();
    const filtered = q.statuses
      ? all.filter((r) => q.statuses!.includes(r.status))
      : all;
    return Promise.resolve({
      items: filtered.slice(q.offset, q.offset + q.limit),
      total: all.length,
      filteredTotal: filtered.length,
    });
  }

  latest(status?: RunStatus): Promise<RunRecord | null> {
    return Promise.resolve(
      this.sorted().find((r) => !status || r.status === status) ?? null,
    );
  }

  count(): Promise<number> {
    return Promise.resolve(this.runs.size);
  }

  has(id: string): Promise<boolean> {
    return Promise.resolve(this.runs.has(id));
  }
}

// ---------------------------------------------------------------------------
// Prisma
// ---------------------------------------------------------------------------

const json = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
const jsonOrNull = (v: unknown) =>
  v === null || v === undefined ? Prisma.DbNull : json(v);

type RunRow = Prisma.AdvisorRunGetPayload<{ include: { suggestions: true } }>;
type SuggestionRow = RunRow['suggestions'][number];

const SUMMARY_SELECT = {
  id: true,
  status: true,
  failureReason: true,
  errorMessage: true,
  dataSource: true,
  isExample: true,
  stage: true,
  stageTimings: true,
  requestedAt: true,
  startedAt: true,
  finishedAt: true,
  durationMs: true,
  snapshotHash: true,
  snapshotSummary: true,
  snapshotBytes: true,
  redactedCount: true,
  precheckSummary: true,
  suggestionCount: true,
  highCount: true,
  mediumCount: true,
  lowCount: true,
  droppedCount: true,
  model: true,
  usage: true,
} satisfies Prisma.AdvisorRunSelect;

type SummaryRow = Prisma.AdvisorRunGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function rowToRecord(
  row: SummaryRow,
  extra: {
    suggestions?: SuggestionRow[];
    precheckResults?: unknown;
    rawPresent?: boolean;
  } = {},
): RunRecord {
  const usage = (row.usage ?? null) as Record<string, unknown> | null;
  const summary = (row.snapshotSummary ?? null) as SnapshotSummary | null;
  const stages = Array.isArray(row.stageTimings)
    ? (row.stageTimings as unknown as AdvisorStageTimingJson[]).map(
        (s): StageState => ({ ...s }),
      )
    : closedStagesFromStage(row.stage as StageId | null, row.status);
  const savingsAsOf =
    summary?.estimatedMonthly?.asOf ?? row.requestedAt.toISOString();
  const suggestions = extra.suggestions
    ? [...extra.suggestions]
        .sort(
          (a, b) =>
            Number(a.unverified) - Number(b.unverified) ||
            a.priority - b.priority,
        )
        .map((s) => suggestionFromRow(s, savingsAsOf))
    : null;
  return {
    id: row.id,
    status: row.status,
    failureReason: row.failureReason ?? null,
    isExample: row.isExample,
    dataSource: row.dataSource,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    stage: (row.stage ?? null) as StageId | null,
    stages,
    cancelling: false,
    receiving: null,
    limits: {
      slowAfterSec: numOrNull(usage?.slowAfterSec) ?? 300,
      timeoutSec: numOrNull(usage?.timeoutSec) ?? 600,
    },
    errorMessage: row.errorMessage,
    rawResponse: null,
    hasRawResponse: extra.rawPresent ?? false,
    llm:
      usage || row.model
        ? {
            model: row.model,
            costUsd: numOrNull(usage?.costUsd),
            durationApiMs: numOrNull(usage?.durationApiMs),
            numTurns: numOrNull(usage?.numTurns),
            inputTokens: numOrNull(usage?.inputTokens),
            outputTokens: numOrNull(usage?.outputTokens),
          }
        : null,
    usage,
    counts: {
      suggestions: row.suggestionCount,
      high: row.highCount,
      medium: row.mediumCount,
      low: row.lowCount,
      dropped: row.droppedCount,
    },
    snapshotSummary: summary,
    precheckSummary: (row.precheckSummary ??
      null) as RunRecord['precheckSummary'],
    precheckResults: Array.isArray(extra.precheckResults)
      ? (extra.precheckResults as PrecheckItem[])
      : [],
    suggestions,
    snapshot: null,
    snapshotMeta: null,
    snapshotHash: row.snapshotHash,
    pseudonyms: null,
  };
}

/** stage_timings가 없던 이력: 마지막 단계와 상태로 대략 복원 (시각은 null) */
function closedStagesFromStage(
  stage: StageId | null,
  status: string,
): StageState[] {
  const stages = initialStages();
  const idx = stage ? stages.findIndex((s) => s.id === stage) : -1;
  stages.forEach((s, i) => {
    if (i < idx) s.state = 'done';
    else if (i === idx) {
      s.state =
        status === 'succeeded'
          ? 'done'
          : status === 'failed'
            ? 'error'
            : isActiveStatus(status as RunStatus)
              ? 'active'
              : 'skipped';
    } else
      s.state = isActiveStatus(status as RunStatus)
        ? 'pending'
        : status === 'succeeded'
          ? 'done'
          : 'skipped';
  });
  return stages;
}

function suggestionFromRow(s: SuggestionRow, asOf: string): Suggestion {
  const savingsUsd =
    s.estimatedMonthlySavingsUsd === null
      ? null
      : Number(s.estimatedMonthlySavingsUsd);
  return {
    id: s.id,
    priority: s.priority,
    title: s.title,
    category: s.category,
    severity: s.severity,
    targets: (s.targets as unknown as AdvisorTargetRefJson[]).map(
      (t) => ({ ...t }) as TargetRef,
    ),
    evidence: (s.evidence as unknown as AdvisorEvidenceJson[]).map(
      (e): Evidence => ({ ...e }),
    ),
    precheckIds: s.precheckIds,
    savings:
      savingsUsd !== null && s.savingsFormula && s.savingsSource
        ? {
            monthlyUsd: savingsUsd,
            kind: 'estimated',
            asOf,
            formula: s.savingsFormula,
            source: s.savingsSource,
          }
        : null,
    steps: Array.isArray(s.steps)
      ? (s.steps as unknown as AdvisorStepJson[]).map((x): Step => ({ ...x }))
      : [],
    noExecuteNotice: NO_EXECUTE_NOTICE,
    risk: { level: s.riskLevel, reason: s.riskReason },
    verification: s.verification,
    unverified: s.unverified,
    source: 'llm',
  };
}

function usageJson(r: RunRecord): Record<string, unknown> {
  return {
    ...(r.usage ?? {}),
    costUsd: r.llm?.costUsd ?? null,
    durationApiMs: r.llm?.durationApiMs ?? null,
    numTurns: r.llm?.numTurns ?? null,
    inputTokens: r.llm?.inputTokens ?? null,
    outputTokens: r.llm?.outputTokens ?? null,
    slowAfterSec: r.limits.slowAfterSec,
    timeoutSec: r.limits.timeoutSec,
  };
}

export class PrismaRunStore implements RunStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly rawMaxBytes = 262_144,
  ) {}

  async createActive(r: RunRecord): Promise<CreateResult> {
    try {
      await this.prisma.advisorRun.create({
        data: {
          id: r.id,
          activeLock: 'active',
          status: r.status,
          dataSource: r.dataSource,
          isExample: r.isExample,
          stage: r.stage,
          requestedAt: r.requestedAt,
          startedAt: r.startedAt,
          snapshotHash: r.snapshotHash ?? ''.padEnd(64, '0'),
          snapshotSummary: json(r.snapshotSummary ?? {}),
          snapshot: json(r.snapshot ?? {}),
          snapshotBytes: r.snapshotMeta?.bytes ?? 0,
          redactedCount: r.snapshotMeta?.redactedCount ?? 0,
          precheckResults: json(r.precheckResults),
          precheckSummary: json(
            r.precheckSummary ?? { high: 0, medium: 0, low: 0 },
          ),
          usage: json(usageJson(r)),
        },
      });
      return { created: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const running = await this.prisma.advisorRun.findUnique({
          where: { activeLock: 'active' },
          select: { id: true },
        });
        return { created: false, existingId: running?.id ?? null };
      }
      throw err;
    }
  }

  async saveProgress(r: RunRecord): Promise<void> {
    await this.prisma.advisorRun.update({
      where: { id: r.id },
      data: { status: r.status, stage: r.stage, startedAt: r.startedAt },
    });
  }

  async finish(r: RunRecord): Promise<void> {
    const raw = r.rawResponse
      ? truncateUtf8(r.rawResponse, this.rawMaxBytes)
      : null;
    const suggestions = r.status === 'succeeded' ? (r.suggestions ?? []) : [];
    await this.prisma.$transaction([
      this.prisma.advisorSuggestion.deleteMany({ where: { runId: r.id } }),
      this.prisma.advisorSuggestion.createMany({
        data: suggestions.map((s) => ({
          id: s.id,
          runId: r.id,
          priority: s.priority,
          title: s.title,
          category: s.category,
          severity: s.severity,
          targets: json(s.targets satisfies AdvisorTargetRefJson[]),
          evidence: json(s.evidence satisfies AdvisorEvidenceJson[]),
          precheckIds: s.precheckIds,
          estimatedMonthlySavingsUsd: s.savings
            ? new Prisma.Decimal(s.savings.monthlyUsd.toFixed(2))
            : null,
          savingsFormula: s.savings?.formula.slice(0, 500) ?? null,
          savingsSource: s.savings?.source ?? null,
          steps: json(s.steps satisfies AdvisorStepJson[]),
          riskLevel: s.risk.level,
          riskReason: s.risk.reason.slice(0, 300),
          verification: s.verification,
          unverified: s.unverified,
        })),
      }),
      this.prisma.advisorRun.update({
        where: { id: r.id },
        data: {
          status: r.status,
          failureReason: r.failureReason,
          errorMessage: r.errorMessage?.slice(0, 500) ?? null,
          activeLock: null,
          stage: r.stage,
          stageTimings: jsonOrNull(r.stages satisfies AdvisorStageTimingJson[]),
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          durationMs: r.durationMs,
          suggestionCount: r.counts.suggestions,
          highCount: r.counts.high,
          mediumCount: r.counts.medium,
          lowCount: r.counts.low,
          droppedCount: r.counts.dropped,
          rawResponse: raw,
          model: r.llm?.model?.slice(0, 100) ?? null,
          usage: json(usageJson(r)),
        },
      }),
    ]);
  }

  async get(id: string): Promise<RunRecord | null> {
    const row = await this.prisma.advisorRun.findUnique({
      where: { id },
      select: { ...SUMMARY_SELECT, precheckResults: true, suggestions: true },
    });
    if (!row) return null;
    let rawPresent = false;
    if (row.failureReason === 'invalid_response') {
      const n = await this.prisma.advisorRun.count({
        where: { id, rawResponse: { not: null } },
      });
      rawPresent = n > 0;
    }
    return rowToRecord(row, {
      suggestions: row.suggestions,
      precheckResults: row.precheckResults,
      rawPresent,
    });
  }

  async getSnapshot(id: string): Promise<AdvisorSnapshotV1 | null> {
    const row = await this.prisma.advisorRun.findUnique({
      where: { id },
      select: { snapshot: true },
    });
    if (!row || row.snapshot === null || typeof row.snapshot !== 'object')
      return null;
    const snap = row.snapshot as unknown as AdvisorSnapshotV1;
    return snap.schemaVersion === 1 ? snap : null;
  }

  async getRaw(id: string): Promise<string | null> {
    const row = await this.prisma.advisorRun.findUnique({
      where: { id },
      select: { rawResponse: true },
    });
    return row?.rawResponse ?? null;
  }

  async list(q: RunListQuery): Promise<RunListResult> {
    const where: Prisma.AdvisorRunWhereInput = q.statuses
      ? { status: { in: q.statuses } }
      : {};
    const [rows, total, filteredTotal] = await Promise.all([
      this.prisma.advisorRun.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: q.offset,
        take: q.limit,
        select: SUMMARY_SELECT,
      }),
      this.prisma.advisorRun.count(),
      this.prisma.advisorRun.count({ where }),
    ]);
    return { items: rows.map((r) => rowToRecord(r)), total, filteredTotal };
  }

  async latest(status?: RunStatus): Promise<RunRecord | null> {
    const row = await this.prisma.advisorRun.findFirst({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'desc' },
      select: { id: true },
    });
    return row ? this.get(row.id) : null;
  }

  count(): Promise<number> {
    return this.prisma.advisorRun.count();
  }

  async has(id: string): Promise<boolean> {
    return (await this.prisma.advisorRun.count({ where: { id } })) > 0;
  }
}

export function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf8').replace(/�$/, '');
}

export { EMPTY_COUNTS };
