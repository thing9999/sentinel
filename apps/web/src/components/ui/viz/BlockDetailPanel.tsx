"use client";

import { useState } from "react";

import { Button } from "../controls/Button";
import { ButtonLink } from "../controls/ButtonLink";
import { CopyButton } from "../controls/CopyButton";
import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { InlineAlert } from "../feedback/Banner";
import { EmptyState } from "../feedback/EmptyState";
import { Icon, type IconName } from "../icons";
import { Card } from "../layout/Card";
import { Tooltip } from "../overlay/Tooltip";
import { Chip } from "../status/Chip";
import { splitFileLocation } from "../snapshot/ScanFindingList";
import { ResourceName } from "../table/ResourceName";
import { BlockMarkers } from "./BlockMarkers";
import { KindIcon } from "./KindIcon";
import { LayerSwatch } from "./LayerSwatch";
import { RelationList, type RelationItemProps } from "./RelationItem";
import { GHOST_LABEL, GHOST_REASON_TEXT, type BlockMarkerSource, type GhostReason, type VizLayer } from "./viz";
import styles from "./viz.module.css";

export interface BlockDetailBlock {
  /** 블록 id (= resourceKey) */
  id: string;
  layer: VizLayer;
  kind: string;
  /** `blocks[].custom` — 사용자 지정 리소스면 종류와 무관하게 `shapes` (snapshot-3d.md 4.10) */
  custom?: boolean;
  /** 종류 아이콘 14px 을 직접 고를 때. 기본은 `KindIcon` 이 `kind`·`custom` 으로 고른다 */
  kindIcon?: IconName;
  apiVersion?: string | null;
  name: string;
  /** null 이면 `클러스터 범위` */
  namespace?: string | null;
  /** 스냅샷 파일 경로. null 이면 `파일 없음` + 사유 */
  file?: string | null;
  /** 파일이 없는 사유 (`추가됨 — 클러스터에만 있습니다`) */
  fileNote?: string;
  /** 여러 문서(`---`) 파일이면 `(문서 1/2)` */
  documentIndex?: number;
  documentCount?: number;
  ghost?: { reason: GhostReason; text?: string } | null;
  /** 묶어 보기(9.7)의 묶음 블록 */
  grouped?: { count: number; relationCount?: number } | null;
}

export interface BlockDetailAction {
  href?: string;
  label?: string;
  /** href 가 없을 때 비활성 버튼 + 사유 툴팁 */
  disabledReason?: string;
}

export interface BlockDetailActions {
  file?: BlockDetailAction;
  drift?: BlockDetailAction;
  /** 유령 Secret 참조 → `Secret 참조에서 보기` */
  secrets?: BlockDetailAction;
  /** 이동할 곳이 아예 없을 때 버튼 자리 문구 */
  note?: string;
}

export interface BlockDetailPanelProps {
  /** null 이면 빈 상태(`블록을 고르세요`) */
  block?: BlockDetailBlock | null;
  markers?: BlockMarkerSource;
  /** 표시 문구(`셀렉터 없음` 등) — 서버 문구 그대로 */
  notes?: { code?: string; text: string }[];
  incoming?: RelationItemProps[];
  outgoing?: RelationItemProps[];
  actions?: BlockDetailActions;
  onSelectRelated?: (peerId: string | undefined) => void;
  onClear?: () => void;
  /** 머리 문구, 기본 `선택한 블록` */
  title?: string;
  /** 패널 높이(작업 영역 높이와 같게). 기본 100% */
  height?: number | string;
  className?: string;
}

const EMPTY_DESC = "장면에서 블록을 한 번 누르면 종류·파일·관계를 여기에서 봅니다. 두 번 누르면 해당 탭으로 갑니다.";

/**
 * components.md 16.6 / snapshot-3d.md 7.2. 폭 376px, Card padding 0, 내부 스크롤, 바닥 버튼 고정.
 * **값을 표시하는 자리를 두지 않는다**: env·command/args·어노테이션·레이블/셀렉터 원문·ConfigMap 내용·
 * Secret 값이 이 패널에 오지 않는다(AC-3D14). 원문은 [파일에서 보기]로 간다.
 */
export function BlockDetailPanel({
  block,
  markers,
  notes,
  incoming = [],
  outgoing = [],
  actions,
  onSelectRelated,
  onClear,
  title = "선택한 블록",
  height = "100%",
  className,
}: Readonly<BlockDetailPanelProps>) {
  const [expandIn, setExpandIn] = useState(false);
  const [expandOut, setExpandOut] = useState(false);

  return (
    <Card padding="none" className={cx(styles.panel, className)} style={{ height }} aria-label={title} as="section">
      <div className={styles.panelHead}>
        <span className={styles.panelHeadText}>{title}</span>
        {onClear && block ? (
          <IconButton icon="x" size="sm" label="선택 해제 (Esc)" onClick={onClear} />
        ) : null}
      </div>

      {!block ? (
        <div className={styles.panelEmpty}>
          <EmptyState icon="box" title="블록을 고르세요" description={EMPTY_DESC} size="sm" />
        </div>
      ) : (
        <>
          <div className={styles.panelBody}>
            {/* ① 식별 */}
            <div className={styles.panelIdent}>
              <div className={styles.identKind}>
                <LayerSwatch layer={block.layer} size={12} ghost={Boolean(block.ghost)} />
                {block.kindIcon ? (
                  <Icon name={block.kindIcon} size={14} className={styles.fgSecondary} />
                ) : (
                  <KindIcon kind={block.kind} custom={block.custom} size={14} className={styles.fgSecondary} />
                )}
                <span className={styles.identKindName}>{block.kind}</span>
                {block.apiVersion ? <span className={styles.identApi}>{block.apiVersion}</span> : null}
              </div>
              <div className={styles.identName}>
                <ResourceName name={block.name} keepTail={8} className={styles.identNameText} />
                <CopyButton text={block.name} label="이름 복사" size="sm" showLabel={false} />
              </div>
              <div className={styles.identMeta}>
                {block.namespace ? `네임스페이스 ${block.namespace}` : "클러스터 범위"}
                {block.documentCount && block.documentCount > 1 ? (
                  <span className={styles.identDoc}>
                    (문서 {block.documentIndex ?? 1}/{block.documentCount})
                  </span>
                ) : null}
              </div>
              {block.grouped ? (
                <div className={styles.identMeta}>
                  묶음 {block.grouped.count.toLocaleString("en-US")}개
                  {block.grouped.relationCount !== undefined
                    ? ` · 이 묶음의 관계 ${block.grouped.relationCount.toLocaleString("en-US")}개 — 펼치면 선을 그립니다`
                    : ""}
                </div>
              ) : null}
            </div>

            {/* ② 파일 */}
            <div className={styles.panelFile}>
              <span className={styles.panelLabel}>파일</span>
              {block.file ? (
                <span className={styles.fileRow}>
                  <Tooltip content={block.file} mono className={styles.filePathTip}>
                    <FilePath path={block.file} />
                  </Tooltip>
                  <CopyButton text={block.file} label="파일 경로 복사" size="sm" showLabel={false} />
                </span>
              ) : (
                <span className={styles.fileNone}>
                  파일 없음
                  {block.fileNote ? ` · ${block.fileNote}` : ""}
                </span>
              )}
            </div>

            {/* ③ 표식 줄 */}
            {markers && hasMarkers(markers) ? (
              <div className={styles.panelMarkers}>
                <BlockMarkers variant="inline" {...markers} />
                {block.ghost ? (
                  <Chip
                    label={`${GHOST_LABEL} · ${block.ghost.text ?? GHOST_REASON_TEXT[block.ghost.reason]}`}
                    icon="circle-dashed"
                    tone="neutral"
                    dashed
                  />
                ) : null}
              </div>
            ) : null}

            {/* ④ 표시 문구 */}
            {notes && notes.length > 0 ? (
              <div className={styles.panelNotes}>
                {notes.map((n) => (
                  <InlineAlert key={n.code ?? n.text} tone="neutral" icon="unlink" title={n.text} compact />
                ))}
              </div>
            ) : null}

            {/* ⑤ 관계 */}
            <div className={styles.panelRelations}>
              <RelationList
                title="들어오는 관계"
                items={incoming.map((r) => ({ ...r, direction: "in", onSelect: r.onSelect ?? onSelectRelated }))}
                expanded={expandIn}
                onExpand={() => setExpandIn(true)}
              />
              <RelationList
                title="나가는 관계"
                items={outgoing.map((r) => ({ ...r, direction: "out", onSelect: r.onSelect ?? onSelectRelated }))}
                expanded={expandOut}
                onExpand={() => setExpandOut(true)}
              />
            </div>
          </div>

          {actions ? (
            <div className={styles.panelFoot}>
              <ActionButton action={actions.file} icon="file-text" defaultLabel="파일에서 보기" />
              <ActionButton action={actions.drift} icon="git-compare" defaultLabel="드리프트에서 보기" />
              <ActionButton action={actions.secrets} icon="key-round" defaultLabel="Secret 참조에서 보기" />
              {actions.note ? <p className={styles.footNote}>{actions.note}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

/** 경로는 앞을 자르고 파일 이름을 남긴다 (status.md 5.3, ScanFindingList 와 같은 방법) */
function FilePath({ path }: Readonly<{ path: string }>) {
  const { head, tail } = splitFileLocation(path);
  return (
    <span className={styles.filePath}>
      <span className="sr-only">{path}</span>
      <span className={styles.filePathInner} aria-hidden="true">
        {head ? <span className={styles.filePathHead}>{head}</span> : null}
        <span className={styles.filePathTail}>{tail}</span>
      </span>
    </span>
  );
}

function hasMarkers(m: BlockMarkerSource): boolean {
  return Boolean(m.scan || m.drift || m.fileIssue || m.helm || m.notComparable || m.ghost);
}

function ActionButton({
  action,
  icon,
  defaultLabel,
}: Readonly<{ action?: BlockDetailAction; icon: IconName; defaultLabel: string }>) {
  if (!action) return null;
  const label = action.label ?? defaultLabel;
  if (action.href) {
    return (
      <ButtonLink href={action.href} variant="secondary" size="md" icon={icon} className={styles.footButton}>
        {label}
      </ButtonLink>
    );
  }
  return (
    <Button variant="secondary" size="md" icon={icon} fullWidth disabled disabledReason={action.disabledReason}>
      {label}
    </Button>
  );
}
