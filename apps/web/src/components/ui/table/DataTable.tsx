"use client";

import { Fragment, useId, useState, type CSSProperties, type ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { EmptyState, ErrorState, UnknownState, type EmptyStateProps } from "../feedback/EmptyState";
import { Skeleton } from "../feedback/Skeleton";
import { Icon } from "../icons";
import type { Status } from "../types";
import styles from "./table.module.css";

export interface Column<T> {
  id: string;
  header: ReactNode;
  /** 열 머리글 배지 (예: `<CostKindBadge kind="estimate" />`) */
  headerBadge?: ReactNode;
  /** px */
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  render: (row: T) => ReactNode;
  /** tabular + 오른쪽 정렬 (stale 행이면 valueText 색) */
  numeric?: boolean;
  sticky?: "left";
  /** 이 폭 미만에서 열 숨김 (cluster-status.md 6.2: 1280px 미만 `누적 재시작`·`경과`) */
  hideBelow?: 1024 | 1280;
}

export type SortState = { columnId: string; dir: "asc" | "desc" } | null;

/** 정렬 순환: 오름차순 → 내림차순 → 기본(null) (status.md 5.2) */
export function nextSort(current: SortState, columnId: string): SortState {
  if (!current || current.columnId !== columnId) return { columnId, dir: "asc" };
  if (current.dir === "asc") return { columnId, dir: "desc" };
  return null;
}

export type DataTableState = "ready" | "loading" | "empty" | "filteredEmpty" | "unknown" | "error";

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** null = 기본 정렬(서버 또는 호출 측). 정렬 자체는 호출 측이 한다 */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** default 40 / compact 32 / comfortable 56px (2줄 셀, components.md 12.3. 2줄은 `TwoLineCell`) */
  density?: "default" | "compact" | "comfortable";
  /** 200행 초과 시 true: 고정 행 높이로 보이는 행만 그린다 (expandable·groupRow 와 함께 쓰지 않음) */
  virtualized?: boolean;
  /** 가상 스크롤이면 px (최소 400 권장) */
  height?: number | "auto";
  /** crit 이면 행 왼쪽 3px status.crit.solid */
  rowStatus?: (row: T) => Status | undefined;
  /** 명시적 행 강조 막대 (예: 단가 없음 행 warn) */
  rowAccent?: (row: T) => "warn" | "crit" | undefined;
  /** stale 행: 숫자 셀 valueText 색 */
  rowStale?: (row: T) => boolean;
  /**
   * 트리 들여쓰기 (components.md 17.1): 행 첫 열 왼쪽에 `16px × 깊이`.
   * 숫자면 모든 행에 같은 깊이, 함수면 행마다(관계 표처럼 깊이가 다른 트리). `groupRow` 와 함께 쓸 수 있다.
   */
  rowIndent?: number | ((row: T) => number);
  /**
   * 트리 모양 표의 행 aria (components.md 17.1): `aria-level` / `aria-expanded`.
   * 깊이·펼침을 아는 것은 호출 측이라 행마다 계산해 넘긴다.
   */
  rowAria?: (row: T) => { level?: number; expanded?: boolean } | undefined;
  selectedKey?: string | null;
  /** 행 전체 클릭(키보드 Enter) */
  onRowClick?: (row: T) => void;
  /** 행 펼침 */
  expandable?: {
    render: (row: T) => ReactNode;
    expandedKeys: string[];
    onToggle: (key: string) => void;
    /** 펼칠 수 없는 행 */
    canExpand?: (row: T) => boolean;
  };
  /** 그룹 머리 행(카테고리 등): 전체 열을 차지 */
  groupRow?: {
    is: (row: T) => boolean;
    render: (row: T) => ReactNode;
    expanded?: (row: T) => boolean;
    onToggle?: (row: T) => void;
  };
  /** 미할당·공용·기타 행(bg.surfaceSunken, 정렬과 무관하게 맨 아래) */
  pinnedBottomRows?: T[];
  /** 합계 행: 열 id → 셀 내용 (bodyStrong, 위 2px border.default) */
  totalRow?: Record<string, ReactNode>;
  state?: DataTableState;
  /** state=empty 일 때 */
  emptyProps?: Partial<EmptyStateProps>;
  /** state=filteredEmpty 문구, 기본 `필터 조건에 맞는 항목이 없습니다` */
  filteredEmptyText?: string;
  onResetFilters?: () => void;
  unknownReason?: string;
  unknownHint?: ReactNode;
  errorTitle?: string;
  onRetry?: () => void;
  /** `새 순서로 정렬 (N건 변경)` */
  pendingReorder?: number;
  onApplyReorder?: () => void;
  /** 표 위 왼쪽 `파드 412개 중 37개 표시` */
  countText?: ReactNode;
  /** 마우스가 표 본문 위에 있는지 (실시간 재정렬 보류 판단용) */
  onHoverChange?: (hovering: boolean) => void;
  /** 스크린리더용 표 제목 */
  caption: string;
  /** 로딩 스켈레톤 행 수, 기본 10 */
  loadingRows?: number;
  className?: string;
}

const ROW_H = { default: 40, compact: 32, comfortable: 56 } as const;
const OVERSCAN = 8;

/**
 * components.md 7.1 / status.md 5절.
 * 넓은 표는 표 컨테이너 안에서만 가로 스크롤한다(페이지 가로 스크롤 없음). 머리글은 컨테이너 기준 sticky.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort = null,
  onSortChange,
  density = "default",
  virtualized = false,
  height = "auto",
  rowStatus,
  rowAccent,
  rowStale,
  rowIndent,
  rowAria,
  selectedKey,
  onRowClick,
  expandable,
  groupRow,
  pinnedBottomRows,
  totalRow,
  state = "ready",
  emptyProps,
  filteredEmptyText = "필터 조건에 맞는 항목이 없습니다",
  onResetFilters,
  unknownReason,
  unknownHint,
  errorTitle = "데이터를 불러오지 못했습니다",
  onRetry,
  pendingReorder,
  onApplyReorder,
  countText,
  onHoverChange,
  caption,
  loadingRows = 10,
  className,
}: DataTableProps<T>) {
  const idBase = useId();
  const [scrollTop, setScrollTop] = useState(0);
  const expandedSet = new Set(expandable?.expandedKeys ?? []);
  const hasExpander = Boolean(expandable);
  const colCount = columns.length + (hasExpander ? 1 : 0);
  const rowH = ROW_H[density];

  if (state === "unknown") {
    return (
      <div className={cx(styles.tableBlock, className)}>
        <UnknownState reason={unknownReason} hint={unknownHint} size="sm" />
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className={cx(styles.tableBlock, className)}>
        <ErrorState title={errorTitle} onRetry={onRetry} size="sm" />
      </div>
    );
  }

  const cellClass = (c: Column<T>, extra?: string | false) =>
    cx(
      styles.td,
      (c.numeric || c.align === "right") && styles.alignRight,
      c.align === "center" && styles.alignCenter,
      c.numeric && styles.numeric,
      c.sticky === "left" && styles.stickyLeft,
      c.hideBelow === 1280 && styles.hideBelow1280,
      c.hideBelow === 1024 && styles.hideBelow1024,
      extra,
    );

  const cellStyle = (c: Column<T>) =>
    c.width || c.minWidth || c.maxWidth
      ? { width: c.width, minWidth: c.minWidth ?? c.width, maxWidth: c.maxWidth }
      : undefined;

  const header = (
    <thead>
      <tr>
        {hasExpander ? (
          <th className={cx(styles.th, styles.expanderCell)} scope="col">
            <span className="sr-only">펼침</span>
          </th>
        ) : null}
        {columns.map((c) => {
          const sorted = sort && sort.columnId === c.id ? sort.dir : null;
          const ariaSort = sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined;
          const content = (
            <>
              <span className={styles.thText}>{c.header}</span>
              {c.headerBadge ? <span className={styles.thBadge}>{c.headerBadge}</span> : null}
              {sorted ? (
                <Icon name={sorted === "asc" ? "arrow-up" : "arrow-down"} size={12} className={styles.sortIcon} />
              ) : null}
            </>
          );
          return (
            <th
              key={c.id}
              scope="col"
              aria-sort={ariaSort}
              className={cx(
                styles.th,
                (c.numeric || c.align === "right") && styles.alignRight,
                c.align === "center" && styles.alignCenter,
                c.sticky === "left" && styles.stickyLeft,
                c.hideBelow === 1280 && styles.hideBelow1280,
                c.hideBelow === 1024 && styles.hideBelow1024,
              )}
              style={cellStyle(c)}
            >
              {c.sortable && onSortChange ? (
                <button type="button" className={styles.sortButton} onClick={() => onSortChange(nextSort(sort, c.id))}>
                  {content}
                </button>
              ) : (
                <span className={styles.thInner}>{content}</span>
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );

  // 들여쓰기는 CSS 변수로 넘겨 첫 열 패딩에만 더한다(sticky·정렬 규칙을 건드리지 않는다)
  const indentStyle = (row: T) => {
    const depth = typeof rowIndent === "function" ? rowIndent(row) : rowIndent;
    return depth ? ({ "--row-indent": `${depth * 16}px` } as CSSProperties) : undefined;
  };
  const ariaOf = (row: T) => rowAria?.(row);

  const renderRow = (row: T, opts: { pinned?: boolean } = {}) => {
    if (groupRow?.is(row)) {
      const key = rowKey(row);
      const expanded = groupRow.expanded?.(row);
      const aria = ariaOf(row);
      return (
        <tr
          key={key}
          className={cx(styles.tr, styles.groupRow)}
          style={{ height: rowH, ...indentStyle(row) }}
          aria-level={aria?.level}
          aria-expanded={aria?.expanded ?? expanded}
        >
          <td className={cx(styles.td, styles.groupCell)} colSpan={colCount}>
            <span className={styles.groupInner}>
              {groupRow.onToggle ? (
                <IconButton
                  icon="chevron-right"
                  size="sm"
                  label={expanded ? "접기" : "펼치기"}
                  showTooltip={false}
                  rotate={expanded ? 90 : 0}
                  aria-expanded={expanded}
                  onClick={() => groupRow.onToggle?.(row)}
                />
              ) : null}
              {groupRow.render(row)}
            </span>
          </td>
        </tr>
      );
    }
    const key = rowKey(row);
    const status = rowStatus?.(row);
    const accent = rowAccent?.(row) ?? (status === "crit" ? "crit" : undefined);
    const stale = rowStale?.(row) ?? false;
    const canExpand = expandable ? (expandable.canExpand?.(row) ?? true) : false;
    const expanded = canExpand && expandedSet.has(key);
    const expandId = `${idBase}-exp-${key}`;
    const clickable = Boolean(onRowClick) || canExpand;
    const onActivate = () => {
      if (onRowClick) onRowClick(row);
      else if (canExpand) expandable?.onToggle(key);
    };

    return (
      <Fragment key={key}>
        <tr
          className={cx(
            styles.tr,
            clickable && styles.clickable,
            selectedKey === key && styles.selected,
            accent === "crit" && styles.accentCrit,
            accent === "warn" && styles.accentWarn,
            opts.pinned && styles.pinned,
            stale && styles.staleRow,
          )}
          style={{ height: rowH, ...indentStyle(row) }}
          aria-level={ariaOf(row)?.level}
          aria-expanded={ariaOf(row)?.expanded ?? (canExpand ? expanded : undefined)}
          aria-current={selectedKey === key ? "true" : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={
            clickable
              ? (e) => {
                  // 셀 안 버튼·링크·입력은 행 클릭으로 처리하지 않는다
                  const t = e.target as HTMLElement;
                  if (t.closest("a,button,input,select,textarea,label")) return;
                  onActivate();
                }
              : undefined
          }
          onKeyDown={
            onRowClick
              ? (e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }
              : undefined
          }
        >
          {hasExpander ? (
            <td className={cx(styles.td, styles.expanderCell)}>
              {canExpand ? (
                <IconButton
                  icon="chevron-right"
                  size="sm"
                  label={expanded ? "접기" : "펼치기"}
                  showTooltip={false}
                  rotate={expanded ? 90 : 0}
                  aria-expanded={expanded}
                  aria-controls={expanded ? expandId : undefined}
                  onClick={() => expandable?.onToggle(key)}
                />
              ) : null}
            </td>
          ) : null}
          {columns.map((c) => (
            <td key={c.id} className={cellClass(c)} style={cellStyle(c)}>
              {c.render(row)}
            </td>
          ))}
        </tr>
        {expanded && expandable ? (
          <tr id={expandId} className={styles.expandedRow}>
            <td colSpan={colCount} className={styles.expandedCell}>
              {expandable.render(row)}
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  let body: ReactNode;
  if (state === "loading") {
    body = Array.from({ length: loadingRows }, (_, i) => (
      <tr key={`sk-${i}`} className={styles.tr} style={{ height: rowH }}>
        {hasExpander ? <td className={cx(styles.td, styles.expanderCell)} /> : null}
        {columns.map((c) => (
          <td key={c.id} className={cellClass(c)} style={cellStyle(c)}>
            <Skeleton width="60%" height={12} />
          </td>
        ))}
      </tr>
    ));
  } else if (state === "empty" || state === "filteredEmpty") {
    body = (
      <tr>
        <td colSpan={colCount} className={styles.stateCell}>
          {state === "empty" ? (
            <EmptyState icon="circle-help" title="데이터가 없습니다" size="sm" {...emptyProps} />
          ) : (
            <EmptyState
              icon="search"
              title={filteredEmptyText}
              size="sm"
              action={
                onResetFilters ? (
                  <button type="button" className={styles.linkButton} onClick={onResetFilters}>
                    필터 초기화
                  </button>
                ) : undefined
              }
            />
          )}
        </td>
      </tr>
    );
  } else if (virtualized && typeof height === "number") {
    const total = rows.length;
    const start = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
    const visibleCount = Math.ceil(height / rowH) + OVERSCAN * 2;
    const end = Math.min(total, start + visibleCount);
    body = (
      <>
        {start > 0 ? (
          <tr aria-hidden="true" style={{ height: start * rowH }}>
            <td colSpan={colCount} className={styles.spacer} />
          </tr>
        ) : null}
        {rows.slice(start, end).map((r) => renderRow(r))}
        {end < total ? (
          <tr aria-hidden="true" style={{ height: (total - end) * rowH }}>
            <td colSpan={colCount} className={styles.spacer} />
          </tr>
        ) : null}
      </>
    );
  } else {
    body = rows.map((r) => renderRow(r));
  }

  const showPinned = state === "ready" && pinnedBottomRows && pinnedBottomRows.length > 0;
  const showTotal = state === "ready" && totalRow;

  return (
    <div className={cx(styles.tableBlock, className)}>
      {countText || pendingReorder ? (
        <div className={styles.tableTop}>
          {countText ? <span className={styles.countText}>{countText}</span> : <span />}
          {pendingReorder && onApplyReorder ? (
            <button type="button" className={styles.linkButton} onClick={onApplyReorder}>
              새 순서로 정렬 ({pendingReorder.toLocaleString("en-US")}건 변경)
            </button>
          ) : null}
        </div>
      ) : null}
      <div
        className={styles.scroll}
        style={typeof height === "number" ? { height, maxHeight: height } : undefined}
        onScroll={virtualized ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
        tabIndex={0}
        role="region"
        aria-label={caption}
      >
        <table
          className={cx(styles.table, density === "compact" && styles.compact, density === "comfortable" && styles.comfortable)} aria-busy={state === "loading" || undefined}>
          <caption className="sr-only">{caption}</caption>
          {header}
          <tbody
            onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
            onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
          >
            {body}
          </tbody>
          {showPinned || showTotal ? (
            <tfoot>
              {showPinned ? pinnedBottomRows!.map((r) => renderRow(r, { pinned: true })) : null}
              {showTotal ? (
                <tr className={cx(styles.tr, styles.totalRow)} style={{ height: rowH }}>
                  {hasExpander ? <td className={cx(styles.td, styles.expanderCell)} /> : null}
                  {columns.map((c) => (
                    <td key={c.id} className={cellClass(c)} style={cellStyle(c)}>
                      {totalRow![c.id] ?? null}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

export interface TwoLineCellProps {
  /** 1줄: table 13/20 */
  primary: ReactNode;
  /** 2줄: caption 12/16 text.secondary. 없으면 1줄만 */
  secondary?: ReactNode;
  /** 1줄을 tableStrong(600) 으로 */
  strong?: boolean;
  /** 각 줄을 1줄 말줄임 (툴팁은 호출 측) */
  truncate?: boolean;
  className?: string;
}

/** density `comfortable` 표의 2줄 셀 (aws-snapshot-manager.md 3.4): 1줄 20px + 간격 4px + 2줄 16px */
export function TwoLineCell({ primary, secondary, strong = false, truncate = true, className }: TwoLineCellProps) {
  return (
    <span className={cx(styles.cell2, truncate && styles.cell2Truncate, className)}>
      <span className={cx(styles.cell2Primary, strong && styles.cell2Strong)}>{primary}</span>
      {secondary !== undefined && secondary !== null && secondary !== "" ? (
        <span className={styles.cell2Secondary}>{secondary}</span>
      ) : null}
    </span>
  );
}
