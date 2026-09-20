"use client";

import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "../controls/Button";
import { cx } from "../cx";
import { EmptyState } from "../feedback/EmptyState";
import { Skeleton } from "../feedback/Skeleton";
import { splitForMiddleEllipsis } from "../format";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { scanLevelSpec } from "../snapshot/scan";
import { DriftKindIcon } from "./DriftStatus";
import styles from "./k8s.module.css";
import {
  TREE_ROW_HEIGHT,
  aggregateMarkers,
  filterTree,
  flattenVisible,
  treeRowSrText,
  treeVisibleRange,
  type FlatRow,
  type TreeNode,
} from "./resourceTreeModel";

export interface ResourceTreeProps {
  nodes: TreeNode[];
  /** files: 파일 트리 / drift: 잎 아이콘 자리에 DriftKindIcon + 오른쪽 caption(secondary) */
  variant?: "files" | "drift";
  selectedId?: string | null;
  /** 잎(file)만, disabled 제외. 클릭·Enter */
  onSelect?: (node: TreeNode) => void;
  /** 제어형 펼침 (없으면 defaultExpandedIds 로 내부 상태) */
  expandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  defaultExpandedIds?: string[];
  /** 부분 일치 검색 (호출 측이 미리 걸러도 된다). 일치 잎의 조상은 자동으로 펼친다 */
  query?: string;
  /** 가상 렌더링 컨테이너 높이 (px 또는 CSS 길이). 기본 480 */
  height?: number | string;
  /** loading: 스켈레톤 12행 / empty / filteredEmpty */
  state?: "ready" | "loading" | "empty" | "filteredEmpty";
  /** `role="tree"` 이름 */
  label: string;
  /** state=empty 문구, 기본 `리소스가 없습니다` */
  emptyText?: string;
  /** state=filteredEmpty 문구, 기본 `조건에 맞는 리소스가 없습니다` */
  filteredEmptyText?: string;
  /** 있으면 filteredEmpty 에 ghost sm `필터 초기화` */
  onResetFilters?: () => void;
  className?: string;
}

const DEFAULT_ICON: Record<TreeNode["kind"], IconName> = {
  group: "archive",
  namespace: "folder",
  resourceKind: "layers",
  file: "file-text",
};

const OVERSCAN = 10;
const LOADING_WIDTHS = ["60%", "45%", "70%", "80%", "40%", "65%", "55%", "75%", "50%", "70%", "45%", "60%"];

/** 잎 이름: 가운데 말줄임(keepTail 8), 툴팁 전체 경로 (ResourceName 과 같은 모양, 복사 버튼 없음) */
function LeafName({ label, tooltip }: { label: string; tooltip?: string }) {
  const { head, tail } = splitForMiddleEllipsis(label, 8);
  return (
    <Tooltip content={tooltip ?? label} mono className={styles.treeNameTip}>
      <span className={cx(styles.treeName, styles.mono)}>
        {head ? <span className={styles.treeNameHead}>{head}</span> : null}
        <span className={styles.treeNameTail}>{tail}</span>
      </span>
    </Tooltip>
  );
}

function MarkerIcon({ icon, tone, tip }: { icon: IconName; tone: string; tip?: string }) {
  const el = <Icon name={icon} size={12} className={tone} />;
  return tip ? (
    <Tooltip content={tip} className={styles.treeMarkerTip}>
      {el}
    </Tooltip>
  ) : (
    el
  );
}

/**
 * components.md 14.4 / k8s-snapshot.md 5.2·6.4.
 * - WAI-ARIA tree: role=tree/treeitem, aria-level·setsize·posinset·expanded·selected, 트리 전체가 탭 정지점 하나(roving tabindex).
 *   ↑↓ 이동, → 펼침/첫 자식, ← 접힘/부모, Home/End, Enter 열기(가지는 펼침 토글), `*` 형제 모두 펼침.
 * - 보이는 행만 그린다(행 28px 고정, 가상 렌더링). 포커스 행은 범위 밖이어도 그려 둔다(탭 정지점 유지).
 * - 표시 전용: 데이터는 props 로만. 포커스·스크롤 위치만 내부 상태.
 */
export function ResourceTree({
  nodes,
  variant = "files",
  selectedId = null,
  onSelect,
  expandedIds,
  onExpandedChange,
  defaultExpandedIds,
  query = "",
  height = 480,
  state = "ready",
  label,
  emptyText = "리소스가 없습니다",
  filteredEmptyText = "조건에 맞는 리소스가 없습니다",
  onResetFilters,
  className,
}: ResourceTreeProps) {
  const [innerExpanded, setInnerExpanded] = useState<string[]>(() => defaultExpandedIds ?? []);
  const explicit = expandedIds ?? innerExpanded;
  const setExpanded = (ids: string[]) => {
    if (expandedIds === undefined) setInnerExpanded(ids);
    onExpandedChange?.(ids);
  };

  // 검색 중 자동 펼침을 사용자가 접은 노드 (검색어가 바뀌면 초기화)
  const [queryCollapsed, setQueryCollapsed] = useState<{ q: string; ids: ReadonlySet<string> }>({ q: query, ids: new Set() });
  if (queryCollapsed.q !== query) setQueryCollapsed({ q: query, ids: new Set() });

  const { nodes: shownNodes, ancestorIds } = useMemo(() => filterTree(nodes, query), [nodes, query]);
  const effective = useMemo(() => {
    const s = new Set(explicit);
    for (const id of ancestorIds) if (!queryCollapsed.ids.has(id)) s.add(id);
    return s;
  }, [explicit, ancestorIds, queryCollapsed.ids]);
  const rows = useMemo(() => flattenVisible(shownNodes, effective), [shownNodes, effective]);
  const indexById = useMemo(() => new Map(rows.map((r, i) => [r.node.id, i])), [rows]);

  const [focusId, setFocusId] = useState<string | null>(null);
  const focusIndex = (() => {
    if (focusId !== null && indexById.has(focusId)) return indexById.get(focusId) as number;
    if (selectedId !== null && indexById.has(selectedId)) return indexById.get(selectedId) as number;
    return rows.length > 0 ? 0 : -1;
  })();
  const focusedRowId = focusIndex >= 0 ? rows[focusIndex].node.id : null;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(typeof height === "number" ? height : 480);
  const pendingFocus = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientHeight > 0) setViewport(el.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [state]);

  // 키보드 이동 후: 포커스 행을 보이게 스크롤하고 DOM 포커스를 옮긴다
  useLayoutEffect(() => {
    if (!pendingFocus.current || focusedRowId === null) return;
    pendingFocus.current = false;
    const el = scrollRef.current;
    if (!el) return;
    const top = focusIndex * TREE_ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + TREE_ROW_HEIGHT > el.scrollTop + el.clientHeight && el.clientHeight > 0)
      el.scrollTop = top + TREE_ROW_HEIGHT - el.clientHeight;
    const item = el.querySelector<HTMLElement>(`[data-tree-index="${focusIndex}"]`);
    item?.focus({ preventScroll: true });
  });

  const moveFocus = (index: number) => {
    if (rows.length === 0) return;
    const i = Math.min(Math.max(index, 0), rows.length - 1);
    pendingFocus.current = true;
    setFocusId(rows[i].node.id);
  };

  const toggle = (row: FlatRow, open?: boolean) => {
    if (!row.hasChildren) return;
    const next = open ?? !row.expanded;
    if (next === row.expanded) return;
    const id = row.node.id;
    if (ancestorIds.has(id)) {
      const ids = new Set(queryCollapsed.ids);
      if (next) ids.delete(id);
      else ids.add(id);
      setQueryCollapsed({ q: query, ids });
    }
    setExpanded(next ? [...explicit.filter((x) => x !== id), id] : explicit.filter((x) => x !== id));
  };

  const activate = (row: FlatRow) => {
    if (row.hasChildren) toggle(row);
    else if (!row.node.disabled) onSelect?.(row.node);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (focusIndex < 0) return;
    const row = rows[focusIndex];
    switch (e.key) {
      case "ArrowDown":
        moveFocus(focusIndex + 1);
        break;
      case "ArrowUp":
        moveFocus(focusIndex - 1);
        break;
      case "Home":
        moveFocus(0);
        break;
      case "End":
        moveFocus(rows.length - 1);
        break;
      case "ArrowRight":
        if (row.hasChildren && !row.expanded) toggle(row, true);
        else if (row.hasChildren && row.expanded) moveFocus(focusIndex + 1);
        break;
      case "ArrowLeft":
        if (row.hasChildren && row.expanded) toggle(row, false);
        else if (row.parentId !== null && indexById.has(row.parentId)) moveFocus(indexById.get(row.parentId) as number);
        break;
      case "Enter":
        activate(row);
        break;
      case "*": {
        const siblings = rows.filter((r) => r.parentId === row.parentId && r.hasChildren && !r.expanded);
        if (siblings.length > 0) {
          const ids = new Set(explicit);
          for (const s of siblings) ids.add(s.node.id);
          setExpanded([...ids]);
        }
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  const heightCss = typeof height === "number" ? `${height}px` : height;

  if (state === "loading") {
    return (
      <div className={cx(styles.tree, className)} style={{ height: heightCss }} aria-busy="true" aria-label={label}>
        {LOADING_WIDTHS.map((w, i) => (
          <div key={i} className={styles.treeSkeletonRow}>
            <Skeleton width={w} height={12} />
          </div>
        ))}
      </div>
    );
  }

  const filteredEmpty = state === "filteredEmpty" || (state === "ready" && rows.length === 0 && query.trim() !== "");
  if (state === "empty" || filteredEmpty || rows.length === 0) {
    return (
      <div className={cx(styles.tree, styles.treeEmpty, className)}>
        <EmptyState
          icon="search"
          title={filteredEmpty ? filteredEmptyText : emptyText}
          action={
            filteredEmpty && onResetFilters ? (
              <Button variant="ghost" size="sm" onClick={onResetFilters}>
                필터 초기화
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const [start, end] = treeVisibleRange(scrollTop, viewport, rows.length, OVERSCAN);
  const indices: number[] = [];
  for (let i = start; i < end; i++) indices.push(i);
  if (focusIndex >= 0 && (focusIndex < start || focusIndex >= end)) indices.push(focusIndex);

  const renderRow = (i: number): ReactNode => {
    const row = rows[i];
    const n = row.node;
    const selectable = !row.hasChildren && !n.disabled;
    const selected = selectable && n.id === selectedId;
    const m = n.markers;
    const agg = row.hasChildren && !row.expanded ? aggregateMarkers(n) : null;
    const scan = agg?.scan ?? (m?.scan && m.scan.count > 0 ? m.scan : undefined);
    const scanSpec = scan ? scanLevelSpec(scan.level) : null;
    const leafDrift = variant === "drift" && !row.hasChildren && m?.drift;
    const icon = n.icon ?? DEFAULT_ICON[n.kind];
    const label =
      n.kind === "file" ? (
        <LeafName label={n.label} tooltip={n.tooltip} />
      ) : (
        <span
          className={cx(
            styles.treeName,
            n.kind === "namespace" && styles.treeNameNs,
            (n.mono || n.kind === "namespace") && styles.mono,
          )}
        >
          <span className={styles.treeNameHead}>{n.label}</span>
        </span>
      );
    return (
      <div
        key={n.id}
        role="treeitem"
        aria-level={row.level}
        aria-setsize={row.setsize}
        aria-posinset={row.posinset}
        aria-expanded={row.hasChildren ? row.expanded : undefined}
        aria-selected={selectable ? selected : undefined}
        aria-disabled={n.disabled || undefined}
        aria-label={treeRowSrText(row, variant)}
        tabIndex={i === focusIndex ? 0 : -1}
        data-tree-index={i}
        data-id={n.id}
        className={cx(styles.treeRow, selected && styles.treeRowSelected, n.disabled && styles.treeRowDisabled)}
        style={{ top: i * TREE_ROW_HEIGHT, paddingLeft: `calc(var(--spacing-2) + ${row.level - 1} * var(--spacing-4))` }}
        onClick={() => {
          setFocusId(n.id);
          activate(row);
        }}
        onFocus={() => {
          if (focusId !== n.id) setFocusId(n.id);
        }}
      >
        <span className={styles.treeChevron} aria-hidden="true">
          {row.hasChildren ? (
            <Icon name="chevron-right" size={12} className={cx(styles.chevron, row.expanded && styles.chevronOpen)} />
          ) : null}
        </span>
        <span className={styles.treeIcon} aria-hidden="true">
          {leafDrift && m?.drift ? (
            <DriftKindIcon kind={m.drift.kind} size={14} title={null} />
          ) : (
            <Icon
              name={icon}
              size={14}
              className={n.iconTone === "warn" ? styles.fgWarn : n.kind === "file" ? styles.fgTertiary : styles.fgSecondary}
            />
          )}
        </span>
        <span className={styles.treeMain} aria-hidden="true">
          {n.disabled && n.disabledReason ? (
            <Tooltip content={n.disabledReason} className={styles.treeNameTip}>
              {label}
            </Tooltip>
          ) : (
            label
          )}
          {m?.notComparable ? <MarkerIcon icon="eye-off" tone={styles.fgTertiary} tip={m.notComparable} /> : null}
          {n.chips ? <span className={styles.treeChips}>{n.chips}</span> : null}
        </span>
        <span className={styles.treeMarkers} aria-hidden="true">
          {scan && scanSpec ? (
            <span className={cx(styles.treeScan, styles[`fg-${scanSpec.status}`])}>
              <Icon name={scanSpec.icon} size={12} />
              {scan.count.toLocaleString("en-US")}
            </span>
          ) : null}
          {m?.fileIssue || agg?.fileIssue ? (
            <MarkerIcon icon="file-warning" tone={styles.fgWarn} tip={m?.fileIssue} />
          ) : null}
          {agg && agg.driftCount > 0 ? (
            <span className={cx(styles.treeScan, styles.fgSecondary)}>
              <DriftKindIcon kind="changed" size={12} title={null} />
              {agg.driftCount.toLocaleString("en-US")}
            </span>
          ) : null}
          {variant === "files" && !row.hasChildren && m?.drift && m.drift.kind !== "same" ? (
            <Tooltip
              content={`드리프트: ${m.drift.kind === "changed" ? "변경" : m.drift.kind === "deleted" ? "삭제" : "추가"}${m.drift.detail ? ` (${m.drift.detail})` : ""}`}
              className={styles.treeMarkerTip}
            >
              <DriftKindIcon kind={m.drift.kind} size={12} title={null} />
            </Tooltip>
          ) : null}
          {m?.helm ? <MarkerIcon icon="ship-wheel" tone={styles.fgTertiary} tip="Helm 관리" /> : null}
          {m?.dirty ? <span className={styles.treeDirty} /> : null}
          {variant === "drift" && !row.hasChildren && m?.hiddenOnly ? (
            <span className={styles.treeSecondary}>
              <Icon name="eye-off" size={12} />
              숨김 {m.hiddenOnly.toLocaleString("en-US")}
            </span>
          ) : variant === "drift" && !row.hasChildren && n.secondary ? (
            <span className={styles.treeSecondary}>{n.secondary}</span>
          ) : null}
          {row.hasChildren && n.count !== undefined ? (
            <span className={styles.treeCount}>{n.count.toLocaleString("en-US")}</span>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div
      ref={scrollRef}
      className={cx(styles.tree, className)}
      style={{ height: heightCss }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div
        role="tree"
        aria-label={label}
        className={styles.treeInner}
        style={{ height: rows.length * TREE_ROW_HEIGHT }}
        onKeyDown={onKeyDown}
      >
        {indices.map(renderRow)}
      </div>
    </div>
  );
}
