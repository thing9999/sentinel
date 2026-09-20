"use client";

import { cx } from "../cx";
import { Icon } from "../icons";
import { ResourceName } from "../table/ResourceName";
import { CertaintyChip } from "./CertaintyChip";
import { LayerSwatch } from "./LayerSwatch";
import { GHOST_LABEL, type Certainty, type VizLayer } from "./viz";
import styles from "./viz.module.css";

export interface RelationPeer {
  /** 상대 블록 id (= resourceKey). onSelect 로 넘어간다 */
  id?: string;
  layer: VizLayer;
  kind: string;
  name: string;
  /** 유령 상대(스냅샷에 없음·Secret 등) */
  ghost?: boolean;
  /** 유령 사유 문구 (툴팁) */
  ghostText?: string;
}

export interface RelationItemProps {
  /** in: 들어오는 관계 / out: 나가는 관계 */
  direction: "in" | "out";
  peer: RelationPeer;
  /** 서버 `evidence` 문구 (`셀렉터`, `volumes.persistentVolumeClaim`). 값 원문은 오지 않는다 */
  evidence: string;
  /** 관계 규칙 라벨 (`Service → 워크로드(K2)`) */
  ruleLabel: string;
  certainty: Certainty;
  optional?: boolean;
  /** 누르면 상대 블록을 선택한다(장면 이동, 탭은 바꾸지 않는다) */
  onSelect?: (peerId: string | undefined) => void;
  className?: string;
}

const DIRECTION_TEXT = { in: "들어오는 관계", out: "나가는 관계" } as const;

/**
 * components.md 16.7 / snapshot-3d.md 7.3. 관계 한 줄(44px). **항목 전체가 하나의 `<button>`** 이다.
 * 오른쪽 아래 `chevrons-right` 는 장식이다(버튼 안에 버튼을 두지 않는다 — 탭 정지점이 둘로 갈라지고
 * 스크린리더가 같은 동작을 두 번 읽는다). 관계 목록이 키보드로 관계를 따라 이동하는 길이다(11.1).
 */
export function RelationItem({
  direction,
  peer,
  evidence,
  ruleLabel,
  certainty,
  optional = false,
  onSelect,
  className,
}: Readonly<RelationItemProps>) {
  return (
    <button
      type="button"
      className={cx(styles.relItem, className)}
      data-direction={direction}
      title="이 블록 선택"
      onClick={() => onSelect?.(peer.id)}
    >
      <span className="sr-only">
        {DIRECTION_TEXT[direction]}: {peer.kind} {peer.name}
        {peer.ghost ? `, ${GHOST_LABEL}${peer.ghostText ? ` ${peer.ghostText}` : ""}` : ""}, {evidence} · {ruleLabel}
      </span>
      <span className={styles.relTop} aria-hidden="true">
        <Icon name="chevrons-right" size={12} className={cx(styles.relDir, direction === "in" && styles.relDirIn)} />
        <LayerSwatch layer={peer.layer} size={10} ghost={peer.ghost} />
        <span className={styles.relKind}>{peer.kind}</span>
        <ResourceName name={peer.name} keepTail={8} copyable={false} maxWidth={140} className={styles.relName} />
        {peer.ghost ? (
          <span className={styles.relGhost} title={peer.ghostText ?? GHOST_LABEL}>
            {GHOST_LABEL}
          </span>
        ) : null}
        <CertaintyChip certainty={certainty} optional={optional} evidence={evidence} plain className={styles.relChip} />
      </span>
      <span className={styles.relBottom} aria-hidden="true">
        <span className={styles.relEvidence}>
          {evidence} · {ruleLabel}
        </span>
        <Icon name="chevrons-right" size={14} className={styles.relGo} />
      </span>
    </button>
  );
}

export interface RelationListProps {
  title: string;
  items: RelationItemProps[];
  /** 기본 8개까지 보이고 `더 보기 (N개)` */
  limit?: number;
  expanded?: boolean;
  onExpand?: () => void;
  /** 2열 배치 (관계 표 펼침 영역) */
  columns?: 1 | 2;
  emptyText?: string;
  className?: string;
}

/** 관계 목록(선택 패널 ⑤·관계 표 펼침). 정렬은 호출 측(규칙 ID → 상대 이름). */
export function RelationList({
  title,
  items,
  limit = 8,
  expanded = false,
  onExpand,
  columns = 1,
  emptyText = "없음",
  className,
}: Readonly<RelationListProps>) {
  const shown = expanded ? items : items.slice(0, limit);
  const rest = items.length - shown.length;
  return (
    <section className={cx(styles.relList, className)} aria-label={`${title} ${items.length}`}>
      <h4 className={styles.relTitle}>
        {title} <span className={styles.relCount}>{items.length.toLocaleString("en-US")}</span>
      </h4>
      {items.length === 0 ? (
        <p className={styles.relEmpty}>{emptyText}</p>
      ) : (
        <ul className={cx(styles.relUl, columns === 2 && styles.relUl2)}>
          {shown.map((item) => (
            <li key={`${item.direction}-${item.peer.id ?? item.peer.name}-${item.ruleLabel}`}>
              <RelationItem {...item} />
            </li>
          ))}
        </ul>
      )}
      {rest > 0 ? (
        <button type="button" className={styles.linkButton} onClick={onExpand}>
          더 보기 ({rest.toLocaleString("en-US")}개)
        </button>
      ) : null}
    </section>
  );
}
