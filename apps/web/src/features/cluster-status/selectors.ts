/**
 * cluster-status 화면용 순수 함수: 정렬(표시 순서), 필터, 링크, 메트릭 덮어쓰기.
 * 상태·합계는 서버 값을 그대로 쓴다. 여기서는 "보여 줄 순서·범위"만 정한다.
 */
import { statusFromApi, type Status } from "@/components/ui";

import type { ApiStatusValue, ResourceRef, StatusInfo } from "../common/types";
import type { MetricsState } from "../stream/reducer";
import type { EventItem, NodeItem, PodItem, WorkloadItem } from "./types";

/** status.md 1.5 화면 정렬 순서 (나쁜 것 먼저): crit → warn → unknown → stale → ok */
const RANK: Record<Status, number> = { crit: 0, warn: 1, unknown: 2, stale: 3, ok: 4 };

export function statusRank(info: StatusInfo | null | undefined, stale = false): number {
  if (!info) return RANK.unknown;
  if (info.stale || stale) return RANK.stale;
  return RANK[statusFromApi(info.status)];
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 파드 기본 정렬 (status.md 5.2): 상태 → 최근 1시간 재시작 내림차순 → 네임스페이스 → 이름 */
export function comparePodsDefault(a: PodItem, b: PodItem): number {
  return (
    statusRank(a.status) - statusRank(b.status) ||
    b.restarts.last1h - a.restarts.last1h ||
    cmpStr(a.namespace, b.namespace) ||
    cmpStr(a.name, b.name)
  );
}

export function compareNodesDefault(a: NodeItem, b: NodeItem): number {
  return statusRank(a.status) - statusRank(b.status) || cmpStr(a.name, b.name);
}

export function compareWorkloadsDefault(a: WorkloadItem, b: WorkloadItem): number {
  return statusRank(a.status) - statusRank(b.status) || cmpStr(a.namespace, b.namespace) || cmpStr(a.name, b.name);
}

export function compareEventsDefault(a: EventItem, b: EventItem): number {
  return cmpStr(b.lastSeenAt, a.lastSeenAt);
}

export type SortDir = "asc" | "desc";

export function parseSort(v: string | null): { columnId: string; dir: SortDir } | null {
  if (!v) return null;
  const [columnId, dir] = v.split(":");
  if (!columnId || (dir !== "asc" && dir !== "desc")) return null;
  return { columnId, dir };
}

export function sortRows<T>(
  rows: readonly T[],
  sort: { columnId: string; dir: SortDir } | null,
  accessors: Record<string, (row: T) => string | number | null>,
  fallback: (a: T, b: T) => number,
): T[] {
  const out = [...rows];
  const acc = sort ? accessors[sort.columnId] : undefined;
  if (!sort || !acc) return out.sort(fallback);
  const dir = sort.dir === "asc" ? 1 : -1;
  return out.sort((a, b) => {
    const va = acc(a);
    const vb = acc(b);
    if (va === null && vb === null) return fallback(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : cmpStr(String(va), String(vb));
    return c !== 0 ? c * dir : fallback(a, b);
  });
}

/** 상태 필터 (URL `status=crit,warn`) — 디자인 키 */
export function parseStatusFilter(v: string | null): Status[] {
  if (!v) return [];
  return v.split(",").filter((s): s is Status => ["ok", "warn", "crit", "unknown", "stale"].includes(s));
}

export function matchesStatus(info: StatusInfo, filter: readonly Status[]): boolean {
  if (filter.length === 0) return true;
  return filter.includes(statusFromApi(info.status));
}

export function parseList(v: string | null): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

export function includesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f && f.toLowerCase().includes(needle));
}

/** 필터 결과 중 상태별 개수 (SegmentedControl 표시용. 서버 판단 값을 세기만 한다) */
export function countByStatus<T>(rows: readonly T[], get: (row: T) => StatusInfo): Record<"all" | "crit" | "warn" | "ok" | "unknown", number> {
  const out = { all: rows.length, crit: 0, warn: 0, ok: 0, unknown: 0 };
  for (const r of rows) out[statusFromApi(get(r).status) as "crit" | "warn" | "ok" | "unknown"] += 1;
  return out;
}

/** 서버 이유 목록에서 특정 코드의 등급 (막대 색 등). 없으면 ok */
export function reasonStatus(info: StatusInfo | null | undefined, codes: readonly string[]): Status {
  const r = info?.reasons.find((x) => codes.includes(x.code));
  return r ? statusFromApi(r.status) : "ok";
}

export function apiStatus(v: ApiStatusValue | null | undefined): Status {
  return statusFromApi(v ?? "unknown");
}

/** 리소스 → 화면 링크 */
export function hrefForRef(ref: ResourceRef): string {
  const enc = encodeURIComponent;
  switch (ref.kind) {
    case "Pod":
      return `/cluster/pods/${enc(ref.namespace ?? "")}/${enc(ref.name)}`;
    case "Node":
      return `/cluster/nodes/${enc(ref.name)}`;
    case "Deployment":
    case "StatefulSet":
    case "DaemonSet":
      return `/cluster/workloads?focus=${enc(`${ref.kind}/${ref.namespace ?? ""}/${ref.name}`)}`;
    case "Database":
      return "/cluster/db";
    default:
      return "/cluster/events";
  }
}

export function podHref(ns: string, name: string): string {
  return `/cluster/pods/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
}

export function nodeHref(name: string): string {
  return `/cluster/nodes/${encodeURIComponent(name)}`;
}

export function workloadFocusHref(key: string): string {
  return `/cluster/workloads?focus=${encodeURIComponent(key)}`;
}

/** 메트릭 갱신(metrics.updated)은 행 upsert 없이 오므로 표의 사용량 셀은 메트릭 값으로 덮어쓴다(계약 8.3) */
export function nodeUsage(node: NodeItem, metrics: MetricsState | null): NodeItem["usage"] {
  const m = metrics?.nodes[node.name];
  if (m && metrics?.collectedAt) {
    return { cpuMillicores: m.cpuMillicores, memoryBytes: m.memoryBytes, cpuPct: m.cpuPct, memoryPct: m.memoryPct, updatedAt: metrics.collectedAt };
  }
  if (metrics && !metrics.cluster.available) return null;
  return node.usage;
}

export function podUsage(
  pod: PodItem,
  metrics: MetricsState | null,
): { usage: PodItem["usage"]; memoryLimitPct: number | null; cpuRequestPct: number | null } {
  const m = metrics?.pods[pod.key];
  if (m && metrics?.collectedAt) {
    return {
      usage: { cpuMillicores: m.cpuMillicores, memoryBytes: m.memoryBytes, updatedAt: metrics.collectedAt },
      memoryLimitPct: m.memoryLimitPct,
      cpuRequestPct: m.cpuRequestPct,
    };
  }
  if (metrics && !metrics.cluster.available) return { usage: null, memoryLimitPct: null, cpuRequestPct: null };
  return { usage: pod.usage, memoryLimitPct: pod.memoryLimitPct, cpuRequestPct: pod.cpuRequestPct };
}

export const AREA_LABEL: Record<string, string> = {
  node: "노드",
  workload: "워크로드",
  pod: "파드",
  event: "이벤트",
  db: "DB",
  pvc: "PVC",
  metrics: "메트릭",
};
