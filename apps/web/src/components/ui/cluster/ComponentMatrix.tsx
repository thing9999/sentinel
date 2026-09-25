"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { cx } from "../cx";
import { UnknownState } from "../feedback/EmptyState";
import { Skeleton } from "../feedback/Skeleton";
import { formatCount, formatTime } from "../format";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { StatusIcon } from "../status/StatusIcon";
import { ResourceName } from "../table/ResourceName";
import { STATUS_LABEL, STATUS_ORDER, type IsoTime, type Status } from "../types";
import styles from "./cluster.module.css";

/**
 * 셀 상태 (components.md 18절). 전부 **서버가 확정한 값**이다.
 * - `notReporting`: 마스터가 NotReady라 미러 파드 상태를 믿을 수 없음 (status.md 2.5 "알 수 없음(보고 없음)")
 * - `missing`: 그 마스터에 이 필수 구성요소가 없음
 * - `stale`: 화면이 새 값을 못 받는 중 (status.md 2.5 "데이터 오래됨")
 */
export type CellState = "ok" | "warn" | "crit" | "unknown" | "notReporting" | "missing" | "stale";

export interface ComponentMatrixColumn {
  id: string;
  /** 마스터 노드 이름 (kOps 면 보통 인스턴스 ID) */
  name: string;
  /** `ap-northeast-2a · t3.medium` */
  meta?: string;
  /** 마스터 노드 상태 (서버 값) */
  status: Status;
  /** 마스터가 보고를 멈춤 → 열 전체 빗금 표시 유지 */
  notReporting?: boolean;
  /** 마스터 노드 상태의 서버 사유 한 줄(`NotReady 4분`, 마스터 표의 `사유` 열과 같은 값). 열 머리 툴팁에 쓴다 */
  reason?: string;
  href?: string;
}

export interface ComponentMatrixRow {
  id: string;
  label: string;
}

export interface ComponentMatrixCell {
  columnId: string;
  rowId: string;
  state: CellState;
  /** 1행 문구 (`Ready` / `장애` / `노드 미보고` …) — 서버 값 */
  label: string;
  /** 2행 보조 문구 (`마지막 보고 04:58` / `CrashLoopBackOff · 재시작 4회`) */
  detail?: string;
  /** 있으면 셀 전체가 링크. `notReporting`·`missing` 은 링크를 만들지 않는다 */
  href?: string;
  /**
   * 로그 화면 링크 (components.md 21.5, logs 2026-09-25). 있으면 hover·focus 때
   * **셀 오른쪽 아래 모서리에 겹쳐** 24 × 24px 버튼을 그린다. 셀 치수·문구 폭은 바뀌지 않는다.
   * `missing`(볼 파드가 없다)에는 그리지 않고, `notReporting`에는 **그린다**
   * — 마스터가 NotReady여도 로그 조회는 성공할 수 있다(logs 명세 3.7).
   */
  logHref?: string;
  /** hover 툴팁 전문 */
  tooltip?: string;
}

export interface ComponentMatrixProps {
  /** 마스터. **호출 측이 마스터 표와 같은 순서로** 넘긴다(화면이 다시 정렬하지 않는다) */
  columns: ComponentMatrixColumn[];
  /** 필수 구성요소 5종. 순서는 서버 값(고정) */
  rows: ComponentMatrixRow[];
  /** 칸마다 1개. 없는 칸을 화면이 만들지 않는다(구성요소가 없으면 서버가 `missing`) */
  cells: ComponentMatrixCell[];
  /** 매트릭스 위 한 줄 요약. 0인 항목도 넘긴다(화면이 text.disabled 로 죽인다) */
  summary?: { state: Status; count: number }[];
  /**
   * **선택**. 0이 아닌 요약 숫자는 이 prop 이 없어도 항상 버튼이고,
   * 누르면 그 상태 셀만 2000ms 외곽선으로 강조한다(강조는 컴포넌트 안에서 끝난다).
   * 바깥에서 **추가로** 할 일이 있을 때만 넘긴다(예: 필터·URL 반영, 사용 기록).
   */
  onSummaryClick?: (state: Status) => void;
  /** 있으면 전 셀을 stale 모습으로(원래 상태는 툴팁 `마지막 상태: …`) */
  staleAt?: IsoTime;
  state?: "ready" | "loading" | "unknown";
  /** `컨트롤 플레인 노드를 찾을 수 없습니다` 등 서버 사유 */
  unknownReason?: string;
  /** 스크린리더용 표 제목 */
  caption: string;
  className?: string;
}

/** 요약 숫자(Status)가 가리키는 셀 상태. `알 수 없음`은 보고 없음·없음 칸을 함께 센다 */
const SUMMARY_MATCH: Record<Status, CellState[]> = {
  ok: ["ok"],
  warn: ["warn"],
  crit: ["crit"],
  unknown: ["unknown", "notReporting", "missing"],
  stale: ["stale"],
};

/** 셀 상태 → 상태 키(머리 아이콘·정렬용). 보고 없음·없음은 `알 수 없음` 축에 둔다 */
const CELL_STATUS: Record<CellState, Status> = {
  ok: "ok",
  warn: "warn",
  crit: "crit",
  unknown: "unknown",
  notReporting: "unknown",
  missing: "unknown",
  stale: "stale",
};

/** 셀 아이콘. `missing` 만 상태 아이콘이 아니라 `minus`(text.tertiary) */
const CELL_ICON: Record<CellState, Status | "missing"> = {
  ok: "ok",
  warn: "warn",
  crit: "crit",
  unknown: "unknown",
  notReporting: "unknown",
  missing: "missing",
  stale: "stale",
};

/** 나쁜 것 먼저(status.md 1.5). 서버가 준 상태들 중 하나를 고르는 것이고 상태를 새로 만들지 않는다 */
function worst(list: Status[]): Status {
  for (const s of STATUS_ORDER) if (list.includes(s)) return s;
  return "ok";
}

function cellKey(columnId: string, rowId: string) {
  return `${columnId}\u0000${rowId}`;
}

/**
 * 열 머리 툴팁 (components.md 18.1, 2026-09-24 보탬):
 * `노드 <상태 문구>[ (<reason>)] · 구성요소 <그 열 최악 상태 문구>[ <같은 상태 칸 수>]`
 * - `reason`이 없으면 괄호를 통째로 뺀다.
 * - 칸 수는 그 열의 셀을 세어 만든다(서버가 준 상태를 세는 것이라 새 판단이 아니다).
 *   최악이 `ok`면 셀 수를 붙이지 않는다 — 정상은 조용하게(status.md 1절).
 */
export function columnTooltip(
  column: Pick<ComponentMatrixColumn, "status" | "reason">,
  cellSummary: { cellWorst: Status; worstCount: number },
): string {
  const node = `노드 ${STATUS_LABEL[column.status]}${column.reason ? ` (${column.reason})` : ""}`;
  const { cellWorst, worstCount } = cellSummary;
  const count = cellWorst !== "ok" && worstCount > 0 ? ` ${formatCount(worstCount)}` : "";
  return `${node} · 구성요소 ${STATUS_LABEL[cellWorst]}${count}`;
}

export function ComponentMatrix({
  columns,
  rows,
  cells,
  summary,
  onSummaryClick,
  staleAt,
  state = "ready",
  unknownReason,
  caption,
  className,
}: ComponentMatrixProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const [flash, setFlash] = useState<Status | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setOverflow(el.scrollWidth - el.clientWidth > 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns.length, state]);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  if (state === "unknown") {
    return (
      <div className={cx(styles.matrixWrap, className)}>
        <UnknownState reason={unknownReason ?? ""} size="sm" />
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className={cx(styles.matrixWrap, className)} aria-busy="true">
        <span className="sr-only">{caption} 불러오는 중</span>
        <div className={styles.matrixSkeleton} aria-hidden="true">
          <Skeleton height={40} radius="sm" />
          {Array.from({ length: Math.max(rows.length, 5) }, (_, i) => (
            <Skeleton key={i} height={48} radius="sm" />
          ))}
        </div>
      </div>
    );
  }

  const stale = Boolean(staleAt);
  const staleText = staleAt ? `${formatTime(staleAt, "time")} 기준` : "";

  const byKey = new Map<string, ComponentMatrixCell>();
  for (const c of cells) byKey.set(cellKey(c.columnId, c.rowId), c);

  // 머리 아이콘: 축마다 하나뿐(cluster-status.md 3.2.3). 열 = 노드 상태와 그 열 셀 최악 중 더 나쁜 쪽
  const colWorst = new Map<string, { cellWorst: Status; worstCount: number; head: Status }>();
  for (const col of columns) {
    const list = rows.map((r) => CELL_STATUS[byKey.get(cellKey(col.id, r.id))?.state ?? "unknown"]);
    const cellWorst = worst(list);
    colWorst.set(col.id, {
      cellWorst,
      // 같은 상태 칸 수 — 서버가 준 상태를 세는 것이라 새 판단이 아니다(components.md 18.1)
      worstCount: list.filter((s) => s === cellWorst).length,
      head: worst([col.status, cellWorst]),
    });
  }
  const rowWorst = new Map<string, Status>();
  for (const r of rows) {
    rowWorst.set(
      r.id,
      worst(columns.map((c) => CELL_STATUS[byKey.get(cellKey(c.id, r.id))?.state ?? "unknown"])),
    );
  }

  const summaryTotal = summary?.reduce((sum, s) => sum + s.count, 0) ?? 0;

  // 강조는 이 컴포넌트 안에서 끝난다. 호출 측 핸들러는 있을 때만 덧붙여 부른다
  const handleSummary = (s: Status) => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    setFlash(s);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2000);
    onSummaryClick?.(s);
  };

  return (
    <div className={cx(styles.matrixWrap, className)}>
      {summary && summary.length > 0 ? (
        <div className={styles.matrixSummary}>
          <span className={styles.matrixSummaryTotal}>필수 {formatCount(summaryTotal)}칸</span>
          {summary.map((s) => {
            const text = `${STATUS_LABEL[s.state]} ${formatCount(s.count)}`;
            const body = (
              <>
                <StatusIcon status={s.state} size={12} />
                <span>{text}</span>
              </>
            );
            return (
              <span key={s.state} className={styles.matrixSummarySep}>
                {/* 0인 항목은 강조할 칸이 없으므로 버튼으로 만들지 않는다(text.disabled 로 죽인다) */}
                {s.count > 0 ? (
                  <button
                    type="button"
                    className={cx(styles.matrixSummaryItem, styles.matrixSummaryButton)}
                    onClick={() => handleSummary(s.state)}
                    aria-label={`${text}, 해당 칸 강조`}
                  >
                    {body}
                  </button>
                ) : (
                  <span className={cx(styles.matrixSummaryItem, s.count === 0 && styles.matrixSummaryZero)}>
                    {body}
                  </span>
                )}
              </span>
            );
          })}
          {overflow ? <span className={styles.matrixScrollHint}>가로로 스크롤할 수 있습니다</span> : null}
        </div>
      ) : overflow ? (
        <div className={styles.matrixSummary}>
          <span className={styles.matrixScrollHint}>가로로 스크롤할 수 있습니다</span>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className={cx(styles.matrixScroll, scrolled && styles.matrixScrolled)}
        onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}
        tabIndex={overflow ? 0 : undefined}
        role={overflow ? "group" : undefined}
        aria-label={overflow ? `${caption} (가로 스크롤)` : undefined}
      >
        <table className={styles.matrix} style={{ ["--matrix-cols" as string]: String(columns.length || 1) }}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={cx(styles.matrixCorner, styles.matrixSticky)}>
                <span className="sr-only">구성요소</span>
              </th>
              {columns.map((col) => {
                const w = colWorst.get(col.id)!;
                const dim = col.status !== "ok" || col.notReporting;
                const tip = columnTooltip(col, w);
                return (
                  <th
                    key={col.id}
                    scope="col"
                    className={cx(styles.matrixColHead, dim && styles.matrixColDim)}
                  >
                    <div className={styles.matrixColHeadInner}>
                      <span className={styles.matrixColName}>
                        {w.head !== "ok" ? (
                          // 머리 아이콘은 축마다 하나뿐(cluster-status.md 3.2.3). 툴팁에 노드·구성요소 둘 다
                          <Tooltip content={tip}>
                            {/* 문구 자체가 두 상태를 모두 말하므로 상태 이름을 앞에 또 붙이지 않는다 */}
                            <StatusIcon status={w.head} size={12} title={tip} />
                          </Tooltip>
                        ) : null}
                        <ResourceName name={col.name} kind="node" href={col.href} copyable={false} />
                      </span>
                      {col.meta ? (
                        // 셀 폭 140px(최소)에서는 meta 가 말줄임된다 — 전체는 툴팁으로
                        <Tooltip content={col.meta} className={styles.matrixColMeta}>
                          <span className={styles.matrixColMetaText}>{col.meta}</span>
                        </Tooltip>
                      ) : null}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rw = rowWorst.get(row.id) ?? "ok";
              return (
                <tr key={row.id}>
                  <th scope="row" className={cx(styles.matrixRowHead, styles.matrixSticky)}>
                    <span className={styles.matrixRowHeadInner}>
                      {rw !== "ok" ? <StatusIcon status={rw} size={12} title={STATUS_LABEL[rw]} /> : null}
                      <span className={styles.matrixRowLabel}>{row.label}</span>
                    </span>
                  </th>
                  {columns.map((col) => {
                    const cell = byKey.get(cellKey(col.id, row.id));
                    const dim = col.status !== "ok" || col.notReporting;
                    return (
                      <td key={col.id} className={cx(styles.matrixCellTd, dim && styles.matrixColDim)}>
                        {cell ? (
                          <MatrixCell
                            cell={cell}
                            rowLabel={row.label}
                            colName={col.name}
                            stale={stale}
                            staleText={staleText}
                            flash={flash !== null && SUMMARY_MATCH[flash].includes(cell.state)}
                          />
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface MatrixCellProps {
  cell: ComponentMatrixCell;
  rowLabel: string;
  colName: string;
  stale: boolean;
  staleText: string;
  flash: boolean;
}

/**
 * 셀 하나. 색 + 아이콘 모양 + 문구 세 가지를 **항상 함께** 그린다(status.md 1절).
 * `notReporting` 만 배경 45° 빗금 + solid 테두리이고, `stale` 은 빗금 없음 + dashed 테두리다(status.md 2.5).
 */
function MatrixCell({ cell, rowLabel, colName, stale, staleText, flash }: MatrixCellProps) {
  // stale 이면 배지를 교체하되(8.1) "보고 없음" 표식(빗금)은 지우지 않는다(status.md 2.5)
  const shown: CellState = stale ? "stale" : cell.state;
  const label = stale ? STATUS_LABEL.stale : cell.label;
  const detail = stale ? staleText : cell.detail;
  const icon = CELL_ICON[shown];

  const lastState = cell.detail ? `${cell.label} (${cell.detail})` : cell.label;
  // 셀 폭 140px(최소)에서 detail 이 말줄임되므로 서버 툴팁이 없으면 문구 전체를 툴팁으로 대신 준다
  const fallbackTooltip = cell.detail ? `${cell.label} · ${cell.detail}` : undefined;
  const tooltip = stale ? `마지막 상태: ${lastState}` : (cell.tooltip ?? fallbackTooltip);

  const srText = [rowLabel, colName, label, detail].filter(Boolean).join(", ");
  const clickable = Boolean(cell.href) && cell.state !== "notReporting" && cell.state !== "missing";

  const body = (
    <>
      <span className="sr-only">{srText}</span>
      <span className={styles.cellLine1} aria-hidden="true">
        {icon === "missing" ? (
          <Icon name="minus" size={14} className={styles.cellMissingIcon} />
        ) : (
          <StatusIcon status={icon} size={14} />
        )}
        <span className={styles.cellLabel}>{label}</span>
      </span>
      {detail ? (
        <span className={styles.cellDetail} aria-hidden="true">
          {detail}
        </span>
      ) : null}
    </>
  );

  const cls = cx(
    styles.cell,
    styles[`cell-${shown}`],
    // 빗금은 "보고 없음"에만. stale 로 바뀌어도 유지한다
    cell.state === "notReporting" && styles.cellHatched,
    flash && styles.cellFlash,
  );

  const inner = clickable ? (
    <Link href={cell.href!} className={cls} data-cell-state={shown}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-cell-state={shown} aria-disabled={cell.href ? true : undefined}>
      {body}
    </div>
  );

  const withTip = tooltip ? (
    <Tooltip content={tooltip} as="div" className={styles.cellAnchor}>
      {inner}
    </Tooltip>
  ) : (
    inner
  );

  // 로그 버튼은 셀 링크 **밖**에 둔다(링크 안에 링크를 넣지 않는다). Tab 순서는 셀 링크 다음이다
  if (!cell.logHref || cell.state === "missing") return withTip;
  return (
    <div className={styles.cellBox}>
      {withTip}
      <Link
        href={cell.logHref}
        className={styles.cellLogButton}
        aria-label={`${rowLabel} ${colName} 로그 보기`}
        data-testid="matrix-log-link"
      >
        <Icon name="scroll-text" size={14} />
      </Link>
    </div>
  );
}
