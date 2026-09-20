/**
 * 섹션 기여 → AdvisorSnapshotV1 (순수 함수)
 * 순서: 병합 → 시스템 네임스페이스 제외 → 정제(1차) → 규모 제한 → 사전 점검 → 정제(2차, 보내기 직전) → 512KB 제한
 * docs/api/architecture-advisor.md B.2, A.5
 */
import { createHash } from 'node:crypto';
import type { SnapshotSummary } from '../advisor.types';
import {
  computePrechecks,
  DEFAULT_PRECHECK_THRESHOLDS,
  DEFAULT_SYSTEM_NAMESPACES,
  HOURS_PER_MONTH,
  toSnapshotPrechecks,
  type PrecheckComputation,
  type PrecheckThresholds,
} from '../precheck/precheck-rules';
import {
  emptyPseudonyms,
  sanitizeSnapshot,
  type PseudonymMap,
} from './sanitize-snapshot';
import type {
  AdvisorSnapshotV1,
  SnapshotNode,
  SnapshotSections,
  SnapshotWorkload,
} from './snapshot.types';

export const SNAPSHOT_MAX_BYTES = 512 * 1024;
export const TRANSMISSION_NOTICE =
  '이 데이터는 호스트의 Claude Code를 거쳐 Anthropic으로 전송됩니다. 네임스페이스·워크로드·노드그룹 이름은 원문 그대로 전송됩니다. 비밀값·환경 변수·command/args·어노테이션 원문·IP·계정 ID는 포함되지 않습니다.';

export interface BuildOptions {
  now: Date;
  dataSource: 'mock' | 'live';
  includeSystem: boolean;
  systemNamespaces?: readonly string[];
  maxWorkloads?: number;
  maxNodes?: number;
  maxBytes?: number;
  thresholds?: PrecheckThresholds;
}

export interface SnapshotMeta {
  bytes: number;
  redactedCount: number;
  redactedFields: string[];
  omitted: { workloads: number; nodes: number };
  observationSec: number;
  dataSource: 'mock' | 'live';
  transmissionNotice: string;
}

export interface BuiltSnapshot {
  snapshot: AdvisorSnapshotV1;
  meta: SnapshotMeta;
  summary: SnapshotSummary;
  prechecks: PrecheckComputation;
  pseudonyms: PseudonymMap;
  hash: string;
  sources: { cluster: boolean; cost: boolean; db: boolean };
}

const severityScore = (s: string) =>
  s === 'critical' ? 0 : s === 'warning' ? 1 : s === 'unknown' ? 2 : 3;

function workloadPriority(w: SnapshotWorkload): number {
  const problem = w.restarts24h > 0 || w.oom24h > 0 ? 0 : 1;
  return severityScore(w.status) * 2 + problem;
}
const requestedCpu = (w: SnapshotWorkload) =>
  w.containers.reduce((s, c) => s + (c.requests.cpuMillicores ?? 0), 0) *
  Math.max(1, w.desired ?? 1);

/** 문제 있는 항목 우선 → 규모(비용 대용) 순으로 자른다 */
export function limitWorkloads(
  list: SnapshotWorkload[],
  max: number,
): { kept: SnapshotWorkload[]; omitted: number } {
  if (list.length <= max) return { kept: list, omitted: 0 };
  const sorted = [...list].sort(
    (a, b) =>
      workloadPriority(a) - workloadPriority(b) ||
      requestedCpu(b) - requestedCpu(a),
  );
  return { kept: sorted.slice(0, max), omitted: list.length - max };
}

export function limitNodes(
  list: SnapshotNode[],
  max: number,
): { kept: SnapshotNode[]; omitted: number } {
  if (list.length <= max) return { kept: list, omitted: 0 };
  const sorted = [...list].sort(
    (a, b) =>
      severityScore(a.status) - severityScore(b.status) ||
      b.allocatable.cpuMillicores - a.allocatable.cpuMillicores,
  );
  return { kept: sorted.slice(0, max), omitted: list.length - max };
}

export const byteLength = (v: unknown): number =>
  Buffer.byteLength(JSON.stringify(v), 'utf8');

/** 클러스터·비용이 모두 없으면 null (→ 503 SNAPSHOT_UNAVAILABLE) */
export function buildAdvisorSnapshot(
  sections: SnapshotSections,
  opts: BuildOptions,
): BuiltSnapshot | null {
  const cluster = sections.cluster;
  const costContrib = sections.cost;
  if (!cluster && !costContrib) return null;

  const systemNs = new Set(opts.systemNamespaces ?? DEFAULT_SYSTEM_NAMESPACES);
  const inScope = (ns: unknown) =>
    opts.includeSystem || typeof ns !== 'string' || !systemNs.has(ns);
  const pick = <T>(a: T[] | undefined, b: T[] | undefined): T[] =>
    b && b.length > 0 ? b : (a ?? []);

  // 1. 병합 (값은 아직 신뢰하지 않음 — sanitizeSnapshot이 허용 목록으로 다시 만든다)
  const draft = {
    schemaVersion: 1,
    meta: {
      generatedAt: opts.now.toISOString(),
      dataSource: opts.dataSource,
      observationSec: {
        metrics: cluster?.observationSec?.metrics ?? 0,
        restarts: cluster?.observationSec?.restarts ?? 0,
      },
      omitted: { workloads: 0, nodes: 0 },
      redactedCount: 0,
      systemNamespacesIncluded: opts.includeSystem,
    },
    cluster: cluster?.cluster ?? {},
    nodeGroups: cluster?.nodeGroups ?? [],
    nodes: cluster?.nodes ?? [],
    workloads: (cluster?.workloads ?? []).filter((w) => inScope(w?.namespace)),
    storage: (cluster?.storage ?? []).filter((s) => inScope(s?.namespace)),
    unattachedVolumes: pick(
      cluster?.unattachedVolumes,
      costContrib?.unattachedVolumes,
    ),
    loadBalancers: pick(cluster?.loadBalancers, costContrib?.loadBalancers),
    events: { windowSec: 3600, byReason: cluster?.events?.byReason ?? [] },
    db: sections.db ?? null,
    cost: costContrib?.cost ?? null,
    prechecks: [],
  };

  // 2. 정제 1차
  const first = sanitizeSnapshot(draft, emptyPseudonyms());
  const snap = first.snapshot;

  // 3. 규모 제한
  const wl = limitWorkloads(snap.workloads, opts.maxWorkloads ?? 300);
  const nd = limitNodes(snap.nodes, opts.maxNodes ?? 100);
  snap.workloads = wl.kept;
  snap.nodes = nd.kept;
  snap.meta.omitted = { workloads: wl.omitted, nodes: nd.omitted };

  // 4. 사전 점검 (LLM에게 참조용으로 함께 보낸다)
  const sources = {
    cluster: cluster !== null,
    cost: costContrib?.cost !== null && costContrib?.cost !== undefined,
    db: sections.db !== null,
  };
  const prechecks = computePrechecks(snap, {
    thresholds: opts.thresholds ?? DEFAULT_PRECHECK_THRESHOLDS,
    includeSystem: opts.includeSystem,
    systemNamespaces: opts.systemNamespaces,
    pseudonyms: first.pseudonyms,
    sources,
  });
  snap.prechecks = toSnapshotPrechecks(prechecks.items);

  // 5. 보내기 직전 정제 2차 (방어적: 허용 목록 재복사 + 비밀값 검사)
  const second = sanitizeSnapshot(snap, first.pseudonyms);
  let final = second.snapshot;
  const redactedFields = [...first.redactedFields, ...second.redactedFields];

  // 6. 크기 제한: 사용량 → 이벤트 순으로 줄인다
  const maxBytes = opts.maxBytes ?? SNAPSHOT_MAX_BYTES;
  if (byteLength(final) > maxBytes) {
    final = {
      ...final,
      workloads: final.workloads.map((w) => ({
        ...w,
        containers: w.containers.map((c) => ({ ...c, usage: null })),
      })),
    };
  }
  if (byteLength(final) > maxBytes) {
    final = { ...final, events: { windowSec: 3600, byReason: [] } };
  }
  if (byteLength(final) > maxBytes) {
    // 그래도 크면 워크로드를 절반씩 줄인다
    while (byteLength(final) > maxBytes && final.workloads.length > 1) {
      const keep = Math.floor(final.workloads.length / 2);
      final.meta.omitted.workloads += final.workloads.length - keep;
      final = { ...final, workloads: final.workloads.slice(0, keep) };
    }
  }

  const bytes = byteLength(final);
  const hash = createHash('sha256').update(JSON.stringify(final)).digest('hex');
  const meta: SnapshotMeta = {
    bytes,
    redactedCount: final.meta.redactedCount,
    redactedFields,
    omitted: final.meta.omitted,
    observationSec: final.meta.observationSec.metrics,
    dataSource: opts.dataSource,
    transmissionNotice: TRANSMISSION_NOTICE,
  };
  return {
    snapshot: final,
    meta,
    summary: summarizeSnapshot(final, prechecks, bytes),
    prechecks,
    pseudonyms: first.pseudonyms,
    hash,
    sources,
  };
}

export function summarizeSnapshot(
  s: AdvisorSnapshotV1,
  prechecks: PrecheckComputation,
  bytes: number,
): SnapshotSummary {
  const types = new Map<string, number>();
  for (const n of s.nodes) {
    if (n.instanceType)
      types.set(n.instanceType, (types.get(n.instanceType) ?? 0) + 1);
  }
  if (types.size === 0) {
    for (const g of s.nodeGroups) {
      for (const t of g.instanceTypes)
        types.set(t.type, (types.get(t.type) ?? 0) + t.count);
    }
  }
  const rate = s.cost?.rate.totalUsdPerHour ?? null;
  return {
    nodeCount: s.cluster.nodeCount || s.nodes.length,
    workloadCount: s.workloads.length + s.meta.omitted.workloads,
    pvcCount: s.storage.length,
    loadBalancerCount: s.loadBalancers.length,
    instanceTypes: [...types.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    estimatedMonthly:
      rate !== null
        ? {
            amountUsd: Math.round(rate * HOURS_PER_MONTH * 100) / 100,
            kind: 'estimated',
            asOf: s.cost?.asOf ?? s.meta.generatedAt,
          }
        : null,
    budgetStatus: s.cost?.budget?.status ?? null,
    precheck: prechecks.counts,
    observationSec: s.meta.observationSec.metrics,
    omitted: s.meta.omitted,
    redactedCount: s.meta.redactedCount,
    bytes,
  };
}
