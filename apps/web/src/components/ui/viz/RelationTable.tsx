"use client";

import { useState, type ReactNode } from "react";

import { Button } from "../controls/Button";
import { ButtonLink } from "../controls/ButtonLink";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { splitFileLocation } from "../snapshot/ScanFindingList";
import { DataTable, type Column, type DataTableState } from "../table/DataTable";
import { ResourceName } from "../table/ResourceName";
import { BlockMarkers } from "./BlockMarkers";
import type { BlockDetailAction, BlockDetailActions } from "./BlockDetailPanel";
import { KindIcon, type KindIconPlate } from "./KindIcon";
import { LayerSwatch } from "./LayerSwatch";
import { RelationList, type RelationItemProps } from "./RelationItem";
import { GHOST_LABEL, type BlockMarkerSource, type VizLayer } from "./viz";
import styles from "./viz.module.css";

export interface RelationGroupRow {
  id: string;
  type: "group";
  /** 들여쓰기 깊이 (16px × depth) */
  depth: number;
  /**
   * plate: 네임스페이스 판(= `namespace.yaml` 문서) — 표식·위치·동작 열을 채운다
   * layer: 층 묶음 — 세 열을 비운다 (snapshot-3d.md 8.3)
   */
  groupKind?: "plate" | "layer";
  label: string;
  /**
   * **지금 보이는 자식 수**(필터·검색을 적용한 뒤). 정보 줄·표 요약과 같은 기준이다(AC-3D04).
   * 필터가 없으면 곧 전체 수이므로 `(11)` 로 보인다.
   */
  count?: number;
  /**
   * 필터 전 **전체 자식 수**. `count` 와 다를 때만 `(3 / 11)` 로 두 값을 함께 보인다
   * (도구 막대·표 요약의 `블록 128개 중 12개` 와 같은 규칙, snapshot-3d.md 6.1·8.2).
   * 주지 않으면 예전처럼 `count` 하나만 보인다.
   */
  totalCount?: number;
  /**
   * 판 종류 → 아이콘 14px (`namespace` `folder` / `cluster` `globe` / `unparsed` `file-warning` /
   * `ghost` `circle-dashed`). 매핑은 `KindIcon`(components.md 16.12) 한 곳에만 있다.
   * 주지 않으면 `icon` → 그래도 없으면 예전처럼 `box`.
   */
  plateKind?: KindIconPlate;
  /** 판·층 행 아이콘을 직접 고를 때. `plateKind` 보다 우선한다 */
  icon?: IconName;
  /** 층 그룹이면 층 색 사각 */
  layer?: VizLayer;
  /** `시스템`·`클러스터 범위`·`해석 실패` 칩 등 */
  trailing?: ReactNode;
  /** 판 행: `prod/namespace.yaml`. null 이면 `파일 없음` */
  location?: string | null;
  /** 판 행 표식(판 알약과 같은 순서·문구, 모양만 inline) */
  markers?: BlockMarkerSource;
  /** 판 행 이동 버튼 */
  actions?: { file?: BlockDetailAction; drift?: BlockDetailAction };
  /** 자식이 0이어도 남기는 판 행 문구 (`표시할 리소스 없음`). 펼침 화살표를 비활성으로 */
  emptyHint?: string;
}

export interface RelationResourceRow {
  id: string;
  type: "resource";
  depth: number;
  layer: VizLayer;
  kind: string;
  /** 사용자 지정 리소스(`blocks[].custom`) → 아이콘 `shapes` */
  custom?: boolean;
  /** 종류 아이콘을 직접 고를 때. 기본은 `KindIcon` 이 `kind`·`custom` 으로 고른다(4.10) */
  kindIcon?: IconName;
  name: string;
  /** 네임스페이스 · `클러스터 범위` · `해석 실패` */
  location: string;
  markers?: BlockMarkerSource;
  ghost?: boolean;
  incoming: number;
  outgoing: number;
  actions?: BlockDetailActions;
  /** 행을 펼치면 보이는 관계 목록 */
  relations?: { incoming: RelationItemProps[]; outgoing: RelationItemProps[] };
}

export type RelationTableRow = RelationGroupRow | RelationResourceRow;

export interface RelationTableProps {
  /** 트리를 평탄화한 행. 순서 = 3D 배치 순서 (status.md 11.4) */
  rows: RelationTableRow[];
  /** 그룹 펼침 (접힌 그룹의 자식은 호출 측이 rows 에서 뺀다) */
  expandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  /** 선택한 블록(3D 선택과 같은 `res=`). **판 행은 선택 대상이 아니다** */
  selectedId?: string | null;
  onSelectRow?: (row: RelationResourceRow) => void;
  /** 리소스 행 펼침(관계 목록) */
  openRowIds?: string[];
  onToggleRow?: (id: string) => void;
  onSelectRelated?: (peerId: string | undefined) => void;
  /** 표 위 caption — 3D 정보 줄과 같은 수치여야 한다(AC-3D04) */
  summary?: ReactNode;
  /** `표식` 열만 정렬할 수 있다 (다른 열로 정렬하면 3D와 순서가 달라진다) */
  sort?: "default" | "markers";
  onSortChange?: (sort: "default" | "markers") => void;
  state?: Extract<DataTableState, "ready" | "loading" | "empty" | "filteredEmpty">;
  onResetFilters?: () => void;
  /** 가상 스크롤 높이(px). 200행을 넘으면 필요하다 */
  height?: number;
  caption?: string;
  className?: string;
}

const isGroup = (r: RelationTableRow): r is RelationGroupRow => r.type === "group";
/** 판 그룹 행(= `namespace.yaml` 문서). 층 그룹 행은 묶음일 뿐이라 표식·위치·동작이 없다 */
const isPlateRow = (r: RelationGroupRow) => r.groupKind !== "layer";

/**
 * components.md 16.8 / snapshot-3d.md 8절. 3D와 **같은 데이터**를 보여 주는 대체 보기.
 * 3D를 못 쓸 때의 차선이 아니라 같은 급의 보기다. 기본 정렬은 3D 배치 순서와 같다.
 * 판(네임스페이스) 그룹 행만 표식·위치·동작을 가진다 — 판이 곧 `namespace.yaml` 문서이기 때문이다(8.3).
 */
export function RelationTable({
  rows,
  expandedIds,
  onExpandedChange,
  selectedId,
  onSelectRow,
  openRowIds,
  onToggleRow,
  onSelectRelated,
  summary,
  sort = "default",
  onSortChange,
  state = "ready",
  onResetFilters,
  height,
  caption = "블록과 관계 표",
  className,
}: Readonly<RelationTableProps>) {
  const [openInner, setOpenInner] = useState<string[]>([]);
  const open = openRowIds ?? openInner;
  const expanded = expandedIds ?? [];

  const toggleRow = (id: string) => {
    if (openRowIds === undefined) setOpenInner((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    onToggleRow?.(id);
  };
  const toggleGroup = (id: string) =>
    onExpandedChange?.(expanded.includes(id) ? expanded.filter((x) => x !== id) : [...expanded, id]);

  const columns: Column<RelationTableRow>[] = [
    {
      id: "name",
      header: "종류 · 이름",
      minWidth: 320,
      render: (row) => {
        if (isGroup(row)) {
          if (isPlateRow(row)) {
            return <PlateNameCell row={row} expanded={expanded.includes(row.id)} onToggle={() => toggleGroup(row.id)} />;
          }
          return (
            <span className={styles.rtGroup}>
              {row.layer ? <LayerSwatch layer={row.layer} size={10} /> : null}
              <Icon name={row.icon ?? "layers"} size={12} className={styles.fgSecondary} />
              <span className={styles.rtLayerLabel}>{row.label}</span>
              <GroupCount count={row.count} total={row.totalCount} />
              {row.trailing}
            </span>
          );
        }
        return (
          <span className={styles.rtName}>
            <LayerSwatch layer={row.layer} size={10} ghost={row.ghost} />
            {/* 종류 아이콘 14px — 표는 4.10, 코드는 KindIcon 한 곳 */}
            {row.kindIcon ? (
              <Icon name={row.kindIcon} size={14} className={styles.fgSecondary} />
            ) : (
              <KindIcon kind={row.kind} custom={row.custom} size={14} className={styles.fgSecondary} />
            )}
            <span className={styles.rtKind}>{row.kind}</span>
            <ResourceName name={row.name} keepTail={8} copyable={false} maxWidth={320} />
            {row.ghost ? <span className={styles.relGhost}>{GHOST_LABEL}</span> : null}
          </span>
        );
      },
    },
    {
      id: "location",
      header: "위치",
      width: 136,
      hideBelow: 1024,
      render: (row) => {
        if (isGroup(row)) return isPlateRow(row) ? <PlateLocation path={row.location} /> : null;
        return <span className={styles.rtLocation}>{row.location}</span>;
      },
    },
    {
      id: "markers",
      header: "표식",
      width: 200,
      sortable: true,
      render: (row) => {
        const markers = isGroup(row) ? (isPlateRow(row) ? row.markers : undefined) : row.markers;
        return markers ? <BlockMarkers variant="inline" {...markers} /> : null;
      },
    },
    {
      id: "incoming",
      header: "들어옴",
      width: 72,
      numeric: true,
      render: (row) => {
        if (isGroup(row)) return isPlateRow(row) ? <NotApplicable /> : null;
        return <CountCell n={row.incoming} />;
      },
    },
    {
      id: "outgoing",
      header: "나감",
      width: 72,
      numeric: true,
      render: (row) => {
        if (isGroup(row)) return isPlateRow(row) ? <NotApplicable /> : null;
        return <CountCell n={row.outgoing} />;
      },
    },
    {
      id: "actions",
      header: "동작",
      width: 176,
      align: "center",
      render: (row) => {
        if (isGroup(row)) return isPlateRow(row) && row.actions ? <RowActions actions={row.actions} /> : null;
        return row.actions ? <RowActions actions={row.actions} /> : null;
      },
    },
  ];

  // 펼친 행이 있으면 가상 스크롤을 쓰지 않는다(행 높이가 달라져 자리 계산이 어긋난다)
  const virtualized = rows.length > 200 && open.length === 0 && typeof height === "number";

  return (
    <DataTable<RelationTableRow>
      className={cx(styles.rtTable, className)}
      caption={caption}
      countText={summary}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      state={state}
      onResetFilters={onResetFilters}
      filteredEmptyText="조건에 맞는 리소스가 없습니다"
      emptyProps={{ icon: "box", title: "그릴 리소스가 없습니다" }}
      selectedKey={selectedId ?? undefined}
      onRowClick={(row) => {
        // 판 행은 선택되지 않는다(판은 선택 대상이 아니다). 펼침은 chevron+이름 버튼이 맡는다
        if (isGroup(row)) return;
        onSelectRow?.(row);
        toggleRow(row.id);
      }}
      rowIndent={(row) => row.depth}
      rowAria={(row) => ({
        level: row.depth + 1,
        expanded: isGroup(row) ? expanded.includes(row.id) : open.includes(row.id),
      })}
      groupRow={{
        // 층 행만 전체 열을 차지한다(위치·표식·동작을 비우는 규칙, 8.3)
        is: (row) => isGroup(row) && row.groupKind === "layer",
        render: (row) => (isGroup(row) ? columns[0].render(row) : null),
        expanded: (row) => expanded.includes(row.id),
        onToggle: (row) => toggleGroup(row.id),
      }}
      expandable={{
        expandedKeys: open,
        canExpand: (row) => !isGroup(row) && Boolean(row.relations),
        onToggle: toggleRow,
        render: (row) =>
          isGroup(row) || !row.relations ? null : (
            <div className={styles.rtExpand}>
              <RelationList
                title="들어오는 관계"
                items={row.relations.incoming.map((r) => ({ ...r, onSelect: r.onSelect ?? onSelectRelated }))}
                columns={2}
              />
              <RelationList
                title="나가는 관계"
                items={row.relations.outgoing.map((r) => ({ ...r, onSelect: r.onSelect ?? onSelectRelated }))}
                columns={2}
              />
            </div>
          ),
      }}
      sort={sort === "markers" ? { columnId: "markers", dir: "desc" } : null}
      onSortChange={onSortChange ? (s) => onSortChange(s?.columnId === "markers" ? "markers" : "default") : undefined}
      virtualized={virtualized}
      height={virtualized ? height : "auto"}
    />
  );
}

/** 판 행 이름 칸: chevron + 이름만 펼침/접힘 토글이다(표식·동작은 각자 동작) */
function PlateNameCell({
  row,
  expanded,
  onToggle,
}: Readonly<{ row: RelationGroupRow; expanded: boolean; onToggle: () => void }>) {
  const blocked = Boolean(row.emptyHint);
  return (
    <span className={cx(styles.rtGroup, styles.rtPlateCell)}>
      <button
        type="button"
        className={styles.rtPlateToggle}
        aria-expanded={blocked ? undefined : expanded}
        aria-disabled={blocked || undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!blocked) onToggle();
        }}
      >
        <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} className={styles.fgSecondary} />
        {row.icon ? (
          <Icon name={row.icon} size={14} className={styles.fgSecondary} />
        ) : row.plateKind ? (
          <KindIcon plate={row.plateKind} size={14} className={styles.fgSecondary} />
        ) : (
          <Icon name="box" size={14} className={styles.fgSecondary} />
        )}
        <span className={styles.rtPlateName}>{row.label}</span>
        <GroupCount count={row.count} total={row.totalCount} />
      </button>
      {row.trailing}
      {row.emptyHint ? <span className={styles.rtCount}>{row.emptyHint}</span> : null}
    </span>
  );
}

/**
 * 그룹 행 개수 `(11)`. 필터로 가려진 자식이 있으면 `(3 / 11)` = **보이는 수 / 전체 수** (8.3).
 * 눈으로는 두 값, 스크린리더는 `11개 중 3개 표시` 한 문장으로 읽는다(`/` 를 읽지 않게).
 */
function GroupCount({ count, total }: Readonly<{ count?: number; total?: number }>) {
  if (count === undefined) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (total === undefined || total === count) return <span className={styles.rtCount}>({fmt(count)})</span>;
  return (
    <span className={styles.rtCount}>
      <span aria-hidden="true">{`(${fmt(count)} / ${fmt(total)})`}</span>
      <span className="sr-only">{`${fmt(total)}개 중 ${fmt(count)}개 표시`}</span>
    </span>
  );
}

function PlateLocation({ path }: Readonly<{ path?: string | null }>) {
  if (!path) return <span className={styles.rtLocationNone}>파일 없음</span>;
  const { head, tail } = splitFileLocation(path);
  return (
    <Tooltip content={path} mono className={styles.filePathTip}>
      <span className={styles.filePath}>
        <span className="sr-only">{path}</span>
        <span className={styles.filePathInner} aria-hidden="true">
          {head ? <span className={styles.filePathHead}>{head}</span> : null}
          <span className={styles.filePathTail}>{tail}</span>
        </span>
      </span>
    </Tooltip>
  );
}

/** 판은 관계를 갖지 않는다 (8.3) */
function NotApplicable() {
  return (
    <span className={styles.fgTertiary} aria-label="해당 없음">
      —
    </span>
  );
}

function CountCell({ n }: Readonly<{ n: number }>) {
  return <span className={n === 0 ? styles.fgTertiary : undefined}>{n.toLocaleString("en-US")}</span>;
}

function RowActions({ actions }: Readonly<{ actions: BlockDetailActions }>) {
  return (
    // 행 클릭과 섞이지 않는다: DataTable 이 셀 안 a·button 클릭을 행 클릭으로 처리하지 않는다
    <span className={styles.rtActions}>
      <ActionButton action={actions.file} icon="file-text" label="파일" />
      <ActionButton action={actions.drift} icon="git-compare" label="드리프트" />
      <ActionButton action={actions.secrets} icon="key-round" label="Secret 참조" />
    </span>
  );
}

function ActionButton({
  action,
  icon,
  label,
}: Readonly<{ action?: BlockDetailAction; icon: IconName; label: string }>) {
  if (!action) return null;
  if (action.href) {
    return (
      <ButtonLink href={action.href} variant="ghost" size="sm" icon={icon}>
        {action.label ?? label}
      </ButtonLink>
    );
  }
  return (
    <Button variant="ghost" size="sm" icon={icon} disabled disabledReason={action.disabledReason}>
      {action.label ?? label}
    </Button>
  );
}
