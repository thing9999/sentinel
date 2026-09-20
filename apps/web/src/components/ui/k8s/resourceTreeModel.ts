import type { ReactNode } from "react";

import type { IconName } from "../icons";
import { scanLevelSpec } from "../snapshot/scan";
import type { DriftKind, ScanLevel } from "../types";

/** 행 오른쪽 표시 (순서 고정: scan → fileIssue → drift → helm → dirty, k8s-snapshot.md 5.2) */
export interface TreeMarkers {
  /** 최악 등급 + 발견 수 */
  scan?: { level: ScanLevel | (string & {}); count: number };
  /** 파일 문제 서버 사유 (툴팁·스크린리더) 예 `YAML 해석 실패` */
  fileIssue?: string;
  /** 드리프트 구분 + 상세 (예 `필드 2건`) */
  drift?: { kind: DriftKind; detail?: string };
  helm?: boolean;
  /** 저장 안 됨 (8px accent 원) */
  dirty?: boolean;
  /** 드리프트 비교 불가 사유 (종류 행 이름 뒤 `eye-off`) 예 `드리프트 비교 불가 (대시보드 권한 밖)` */
  notComparable?: string;
  /** drift variant: 숨긴 차이만 있는 리소스 `숨김 N` */
  hiddenOnly?: number;
}

export type TreeNodeKind = "group" | "namespace" | "resourceKind" | "file";

export interface TreeNode {
  /** 트리 전체에서 유일 (보통 서버 경로·리소스 키) */
  id: string;
  kind: TreeNodeKind;
  label: string;
  /** 14px 아이콘. 기본: namespace `folder`, resourceKind `layers`, file `file-text`, group `archive` */
  icon?: IconName;
  /** 아이콘 색 (예 예상 밖 파일 `file-question` warn) */
  iconTone?: "warn" | "tertiary";
  /** 라벨 mono (사용자 지정 리소스 `plural.group`) */
  mono?: boolean;
  /** 네임스페이스·종류 행 오른쪽 개수 */
  count?: number;
  children?: TreeNode[];
  /** 열 수 없는 행 (예상 밖 파일): aria-disabled + 툴팁 사유 */
  disabled?: boolean;
  disabledReason?: string;
  /** 라벨 뒤 6px (예 `시스템` 칩). 장식으로 취급(스크린리더 문구는 srText) */
  chips?: ReactNode;
  markers?: TreeMarkers;
  /** 라벨 툴팁 (파일 전체 경로 `app/deployments/api.yaml`). 검색 대상에도 포함 */
  tooltip?: string;
  /** drift variant 오른쪽 caption (`필드 2` / `삭제됨` / `추가됨`) */
  secondary?: string;
  /** 스크린리더 이름을 직접 줄 때 (없으면 라벨 + 조상 + 표시로 만든다) */
  srText?: string;
  /** 기본 펼침 계산에서 접어 둘 노드 (`스냅샷 파일`, `예상 밖 파일`) */
  defaultCollapsed?: boolean;
}

export interface FlatRow {
  node: TreeNode;
  /** aria-level (1부터) */
  level: number;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
  posinset: number;
  setsize: number;
  /** 조상 라벨 (가까운 것부터) — 스크린리더 문구용 */
  ancestors: TreeNode[];
}

const isLeaf = (n: TreeNode) => !n.children || n.children.length === 0;

/** 잎 노드 수 */
export function countLeaves(nodes: TreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += isLeaf(node) ? 1 : countLeaves(node.children ?? []);
  return n;
}

/** 자식이 있는 모든 노드 id (모두 펼치기) */
export function allBranchIds(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (!isLeaf(n)) {
        out.push(n.id);
        walk(n.children ?? []);
      }
    }
  };
  walk(nodes);
  return out;
}

/**
 * 기본 펼침 (k8s-snapshot.md 5.2): 리소스(잎) limit 개 이하면 모두 펼침, 초과면 최상위(네임스페이스·그룹)만.
 * defaultCollapsed 노드는 항상 접는다.
 */
export function defaultExpandedIds(nodes: TreeNode[], limit = 150): string[] {
  if (countLeaves(nodes) <= limit) {
    const out: string[] = [];
    const walk = (list: TreeNode[]) => {
      for (const n of list) {
        if (isLeaf(n)) continue;
        if (!n.defaultCollapsed) out.push(n.id);
        walk(n.children ?? []);
      }
    };
    walk(nodes);
    return out;
  }
  return nodes.filter((n) => !isLeaf(n) && !n.defaultCollapsed).map((n) => n.id);
}

const matches = (n: TreeNode, q: string) =>
  n.label.toLowerCase().includes(q) || (n.tooltip ? n.tooltip.toLowerCase().includes(q) : false);

/**
 * 검색 (부분 일치·대소문자 무시): 일치하는 잎과 그 조상만 남긴다. 일치 잎의 조상 id 도 돌려준다(자동 펼침).
 * 빈 검색어면 그대로.
 */
export function filterTree(nodes: TreeNode[], query: string): { nodes: TreeNode[]; ancestorIds: Set<string> } {
  const q = query.trim().toLowerCase();
  const ancestorIds = new Set<string>();
  if (!q) return { nodes, ancestorIds };
  const walk = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const n of list) {
      if (isLeaf(n)) {
        if (matches(n, q)) out.push(n);
        continue;
      }
      const kids = walk(n.children ?? []);
      if (kids.length > 0) {
        ancestorIds.add(n.id);
        out.push({ ...n, children: kids });
      }
    }
    return out;
  };
  return { nodes: walk(nodes), ancestorIds };
}

/** 펼친 노드를 따라 보이는 행만 평탄화 */
export function flattenVisible(nodes: TreeNode[], expanded: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (list: TreeNode[], level: number, parent: TreeNode | null, ancestors: TreeNode[]) => {
    list.forEach((n, i) => {
      const hasChildren = !isLeaf(n);
      const open = hasChildren && expanded.has(n.id);
      rows.push({
        node: n,
        level,
        parentId: parent?.id ?? null,
        hasChildren,
        expanded: open,
        posinset: i + 1,
        setsize: list.length,
        ancestors,
      });
      if (open) walk(n.children ?? [], level + 1, n, [n, ...ancestors]);
    });
  };
  walk(nodes, 1, null, []);
  return rows;
}

export interface AggregateMarkers {
  scan?: { level: string; count: number };
  fileIssue: boolean;
  /** 드리프트 차이가 있는(same 제외) 하위 리소스 수 */
  driftCount: number;
}

/** 접힌 노드에 보일 하위 집계: scan 최악 등급 + 합계, fileIssue 아이콘 여부, drift 차이 리소스 수 */
export function aggregateMarkers(node: TreeNode): AggregateMarkers {
  let worstRank = -1;
  let worst: string | undefined;
  let scanCount = 0;
  let fileIssue = false;
  let driftCount = 0;
  const walk = (n: TreeNode) => {
    const m = n.markers;
    if (m?.scan && m.scan.count > 0) {
      const spec = scanLevelSpec(m.scan.level);
      scanCount += m.scan.count;
      if (spec.rank > worstRank) {
        worstRank = spec.rank;
        worst = m.scan.level;
      }
    }
    if (m?.fileIssue) fileIssue = true;
    if (isLeaf(n) && m?.drift && m.drift.kind !== "same") driftCount += 1;
    for (const c of n.children ?? []) walk(c);
  };
  for (const c of node.children ?? []) walk(c);
  return { scan: worst !== undefined ? { level: worst, count: scanCount } : undefined, fileIssue, driftCount };
}

const DRIFT_SR: Record<DriftKind, string> = { changed: "변경", deleted: "삭제", added: "추가", same: "같음" };

/**
 * 스크린리더 이름 (k8s-snapshot.md 5.2·6.4):
 * `api, Deployment, app 네임스페이스, 스캔 오류 1건, 드리프트 변경, Helm 관리`
 */
export function treeRowSrText(row: Pick<FlatRow, "node" | "ancestors" | "hasChildren" | "expanded">, variant: "files" | "drift" = "files"): string {
  const n = row.node;
  if (n.srText) return n.srText;
  const parts: string[] = [n.label];
  for (const a of row.ancestors) {
    if (a.kind === "namespace") parts.push(`${a.label} 네임스페이스`);
    else if (a.kind === "resourceKind") parts.push(a.label);
    else parts.push(a.label);
  }
  if (n.kind === "namespace" && row.ancestors.length === 0) parts[0] = `${n.label} 네임스페이스`;
  if (row.hasChildren && n.count !== undefined) parts.push(`${n.count.toLocaleString("en-US")}개`);
  const m = n.markers;
  const scanText = (level: string, count: number) =>
    `스캔 ${scanLevelSpec(level).label} ${count.toLocaleString("en-US")}건`;
  if (row.hasChildren && !row.expanded) {
    const agg = aggregateMarkers(n);
    if (agg.scan) parts.push(`하위 ${scanText(agg.scan.level, agg.scan.count)}`);
    if (agg.fileIssue) parts.push("하위 파일 문제 있음");
    if (agg.driftCount > 0) parts.push(`드리프트 차이 ${agg.driftCount.toLocaleString("en-US")}개`);
  }
  if (m?.scan && m.scan.count > 0) parts.push(scanText(m.scan.level, m.scan.count));
  if (m?.fileIssue) parts.push(`파일 문제: ${m.fileIssue}`);
  if (m?.drift && m.drift.kind !== "same") {
    parts.push(variant === "drift" ? DRIFT_SR[m.drift.kind] : `드리프트 ${DRIFT_SR[m.drift.kind]}`);
    if (m.drift.detail) parts.push(m.drift.detail);
  }
  if (variant === "drift" && n.secondary && !m?.drift?.detail) parts.push(n.secondary);
  if (m?.hiddenOnly) parts.push(`숨긴 차이 ${m.hiddenOnly.toLocaleString("en-US")}건`);
  if (m?.helm) parts.push("Helm 관리");
  if (m?.notComparable) parts.push(m.notComparable);
  if (m?.dirty) parts.push("저장 안 됨");
  if (n.disabled && n.disabledReason) parts.push(n.disabledReason);
  return parts.join(", ");
}

export const TREE_ROW_HEIGHT = 28;

/** 보이는 행 범위 [start, end) — overscan 포함 */
export function treeVisibleRange(scrollTop: number, viewport: number, total: number, overscan = 10): [number, number] {
  const start = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - overscan);
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / TREE_ROW_HEIGHT) + overscan);
  return [start, Math.max(start, end)];
}
