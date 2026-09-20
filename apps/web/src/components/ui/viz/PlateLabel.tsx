"use client";

import { cx } from "../cx";
import { splitForMiddleEllipsis } from "../format";
import { Chip } from "../status/Chip";
import { BlockMarkers, type BlockMarkersProps } from "./BlockMarkers";
import { KindIcon, type KindIconPlate } from "./KindIcon";
import styles from "./viz.module.css";

/** 판 종류. 아이콘 매핑은 `KindIcon`(components.md 16.12) 한 곳에 있다 */
export type PlateKind = KindIconPlate;

export interface PlateLabelProps {
  /** 판 이름. 가운데 말줄임(뒤 8자 보존) */
  name: string;
  kind?: PlateKind;
  /** 시스템 네임스페이스 → 이름 뒤 Chip `시스템` */
  system?: boolean;
  resourceCount?: number;
  ghostCount?: number;
  /** 판 표식(알약). `variant`·`density` 는 이 컴포넌트가 채운다 */
  markers?: Omit<BlockMarkersProps, "variant" | "density">;
  /** P0~P3 축소 단계 — **계산은 프론트가 한다**(가용 폭 A, snapshot-3d.md 4.1.1) */
  density?: 0 | 1 | 2 | 3;
  /** 그 판만 필터 */
  onNameClick?: () => void;
  /** `<ns>/namespace.yaml` 로 이동 */
  onNameDoubleClick?: () => void;
  className?: string;
}

interface PlateKindSpec {
  /** 이름 대신 쓰는 고정 문구 */
  label?: string;
  /** 이름 앞 아이콘 크기(px). 없으면 아이콘을 두지 않는다 */
  icon?: 12 | 14;
  /** 4.1: 해석 실패 `status.warn.fg` · 유령 `text.tertiary` (나머지는 이름과 같은 색) */
  iconTone?: "warn" | "tertiary";
  /** P0 에서만 보이는 아래 줄 caption */
  note?: string;
}

/**
 * 판 라벨 문구. **아이콘은 `KindIcon` 이 `kind` 로 고른다**(4.10).
 * 이름 앞 아이콘 (snapshot-3d.md 4.1 「판 라벨 이름 앞 아이콘」, 2026-09-20 (4) 확정):
 *   - `namespace` **없음** — 판 대부분이 네임스페이스라 같은 글리프가 모든 라벨에 붙으면 잡음이고,
 *     P2·P3(84·64px)에서 이름을 밀어낸다. 3D에서는 판이라는 것이 모양(슬래브)으로 이미 보인다.
 *   - `cluster` `globe` 14px / `unparsed` `file-warning` 14px `status.warn.fg`
 *   - `ghost` `circle-dashed` **12px** `text.tertiary` — P2·P3에서 caption `스냅샷에 없음` 이 사라지므로
 *     **단계와 무관하게** 남겨 "스냅샷에 없는 판"이라는 단서를 잃지 않는다.
 */
const KIND_TEXT: Record<PlateKind, PlateKindSpec> = {
  namespace: {},
  cluster: { label: "클러스터 범위", icon: 14 },
  unparsed: { label: "해석 실패", icon: 14, iconTone: "warn" },
  ghost: { icon: 12, iconTone: "tertiary", note: "스냅샷에 없음" },
};

/** 상자 폭: P0 200 / P1 가변(프론트가 style 로 준다) / P2 84 / P3 64px */
const WIDTH: Record<0 | 1 | 2 | 3, number | undefined> = { 0: 200, 1: undefined, 2: 84, 3: 64 };

/**
 * components.md 16.11 / snapshot-3d.md 4.1.1. 3D 캔버스 위 판(네임스페이스) 라벨 상자.
 * **위치(투영 좌표)와 축소 단계 계산은 프론트**가 하고, 여기서는 주어진 단계대로 그리기만 한다.
 * 캔버스 안이라 **탭 정지점이 아니다**. 같은 정보·동작은 관계 표 판 그룹 행에 버튼으로 있다.
 */
export function PlateLabel({
  name,
  kind = "namespace",
  system = false,
  resourceCount,
  ghostCount,
  markers,
  density = 0,
  onNameClick,
  onNameDoubleClick,
  className,
}: Readonly<PlateLabelProps>) {
  const spec = KIND_TEXT[kind];
  const label = spec.label ?? name;
  const { head, tail } = splitForMiddleEllipsis(label, 8);
  const counts =
    density === 0 && resourceCount !== undefined
      ? `리소스 ${resourceCount.toLocaleString("en-US")}${
          ghostCount ? ` · 유령 ${ghostCount.toLocaleString("en-US")}` : ""
        }`
      : null;
  const tip = [label, counts ?? undefined, spec.note].filter(Boolean).join(" · ");
  const nameContent = <PlateName spec={spec} plate={kind} label={label} head={head} tail={tail} />;

  return (
    <div
      className={cx(styles.plateLabel, className)}
      style={{ width: WIDTH[density] }}
      data-density={density}
      data-kind={kind}
    >
      {/* DOM 순서는 읽는 순서(이름 → 수 → 표식), 보이는 순서는 아래에서 위로 쌓는다(column-reverse) */}
      <span className={styles.plateNameRow}>
        {onNameClick || onNameDoubleClick ? (
          // 캔버스는 탭 정지점이 1개다(11.1). 판 라벨은 마우스 전용이고 키보드 경로는 관계 표 판 그룹 행이다
          <button
            type="button"
            tabIndex={-1}
            className={cx(styles.plateName, styles.plateNameButton, kind === "ghost" && styles.plateNameGhost)}
            title={tip}
            onClick={onNameClick}
            onDoubleClick={onNameDoubleClick}
          >
            {nameContent}
          </button>
        ) : (
          <span className={cx(styles.plateName, kind === "ghost" && styles.plateNameGhost)} title={tip}>
            {nameContent}
          </span>
        )}
        {system && density <= 1 ? <Chip label="시스템" icon="settings" size="sm" /> : null}
      </span>
      {counts ? <span className={styles.plateCounts}>{counts}</span> : null}
      {density === 0 && spec.note ? <span className={styles.plateCounts}>{spec.note}</span> : null}
      {markers ? (
        <BlockMarkers {...markers} variant="plate" density={density} srPrefix={`${label} 판 표식`} />
      ) : null}
    </div>
  );
}

const ICON_TONE_CLASS = { warn: styles["tone-warn"], tertiary: styles.fgTertiary } as const;

function PlateName({
  spec,
  plate,
  label,
  head,
  tail,
}: Readonly<{ spec: PlateKindSpec; plate: PlateKind; label: string; head: string; tail: string }>) {
  return (
    <>
      {spec.icon ? (
        <KindIcon plate={plate} size={spec.icon} className={spec.iconTone ? ICON_TONE_CLASS[spec.iconTone] : undefined} />
      ) : null}
      <span className="sr-only">{label}</span>
      <span className={styles.plateNameText} aria-hidden="true">
        {head ? <span className={styles.plateNameHead}>{head}</span> : null}
        <span className={styles.plateNameTail}>{tail}</span>
      </span>
    </>
  );
}
