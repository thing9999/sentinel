import Link from "next/link";

import { cx } from "../cx";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { blockMarkerItems, type BlockMarkerItem, type BlockMarkerSource } from "./viz";
import styles from "./viz.module.css";

export interface BlockMarkersProps extends BlockMarkerSource {
  /**
   * overlay: 3D 블록 위 18px **원**(아이콘만) / inline: 선택 패널·관계 표(아이콘 + 문구) /
   * plate: 판 라벨 20px **알약**(아이콘 + 문구).
   * **원 = 블록, 알약 = 판**(status.md 11.5). 색·아이콘이 같으므로 모양이 유일한 구분이다.
   */
  variant?: "overlay" | "inline" | "plate";
  /** overlay·plate 최대 개수(기본 3, 넘치면 `+N`). inline 은 기본 제한 없음 */
  max?: number;
  /**
   * `plate` 축소 단계 (snapshot-3d.md 4.1.1 P0~P3).
   * 0 전체(아이콘+문구) / 1 아이콘만 / 2 1순위 아이콘 + 총계 / 3 1순위 아이콘만.
   * 어느 단계에서도 표식은 **하나는 남는다**.
   */
  density?: 0 | 1 | 2 | 3;
  /** 스크린리더 앞말, 기본 `표식` */
  srPrefix?: string;
  className?: string;
}

/**
 * components.md 16.9 / snapshot-3d.md 4.8·4.1.1. 3D 오버레이·판 라벨·선택 패널·관계 표가 같은 표식을 쓴다.
 * 순서 고정: 스캔 → 드리프트 → 비교 불가 → 파일 문제 → Helm → 유령·정보(notes).
 * 아이콘만 두지 않는다: 모든 표식에 툴팁 + 스크린리더 문구가 붙는다(status.md 11.3).
 */
export function BlockMarkers({
  variant = "inline",
  max,
  density = 0,
  srPrefix = "표식",
  className,
  ...source
}: BlockMarkersProps) {
  const items = blockMarkerItems(source);
  if (items.length === 0) return null;

  const srAll = `${srPrefix}: ${items.map((i) => i.text).join(", ")}`;

  if (variant === "plate") {
    return <PlateMarkers items={items} max={max ?? 3} density={density} srAll={srAll} className={className} />;
  }

  const limit = max ?? (variant === "overlay" ? 3 : items.length);
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);

  if (variant === "overlay") {
    // 4.8(2026-09-20): 블록 오버레이는 아래에서 위로 [보조 줄][이름][표식 줄] 한 덩어리이고
    // 표식 줄이 맨 위·블록 중심에 가운데 정렬이다. 좌표는 프론트, 줄 모양은 여기.
    return (
      <span className={cx(styles.markers, styles.markersOverlay, className)}>
        <span className="sr-only">{srAll}</span>
        {shown.map((m) => (
          <Tooltip key={m.key} content={m.text}>
            <span className={cx(styles.markerDot, styles[`tone-${m.tone}`])} aria-hidden="true">
              <Icon name={m.icon} size={12} />
            </span>
          </Tooltip>
        ))}
        <More rest={rest} />
      </span>
    );
  }

  return (
    <span className={cx(styles.markers, styles.markersInline, className)}>
      {shown.map((m) => (
        <MarkerText key={m.key} item={m} />
      ))}
      <More rest={rest} />
    </span>
  );
}

function More({ rest }: Readonly<{ rest: BlockMarkerItem[] }>) {
  if (rest.length === 0) return null;
  return (
    <Tooltip content={rest.map((m) => m.text).join(" · ")}>
      <span className={styles.markerMore}>+{rest.length}</span>
    </Tooltip>
  );
}

function MarkerText({ item }: Readonly<{ item: BlockMarkerItem }>) {
  const sameText = item.short === item.text;
  const inner = (
    <>
      <Icon name={item.icon} size={12} />
      <span aria-hidden={sameText ? undefined : "true"}>{item.short}</span>
      {sameText ? null : <span className="sr-only">{item.text}</span>}
    </>
  );
  if (item.href) {
    return (
      <Tooltip content={item.text}>
        <Link href={item.href} className={cx(styles.markerItem, styles.markerLink, styles[`tone-${item.tone}`])}>
          {inner}
        </Link>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={item.text}>
      <span className={cx(styles.markerItem, styles[`tone-${item.tone}`])}>{inner}</span>
    </Tooltip>
  );
}

/** 판 알약 (snapshot-3d.md 4.1.1). 축소해도 표식이 사라지지 않는 것이 규칙이다 */
function PlateMarkers({
  items,
  max,
  density,
  srAll,
  className,
}: Readonly<{ items: BlockMarkerItem[]; max: number; density: 0 | 1 | 2 | 3; srAll: string; className?: string }>) {
  // P2·P3: 1순위(= 순서 첫째) 아이콘 하나로 합치고 총계를 숫자로
  if (density >= 2) {
    const first = items[0];
    return (
      <span className={cx(styles.markers, styles.markersPlate, className)}>
        <span className="sr-only">{srAll}</span>
        <Tooltip content={items.map((m) => m.text).join(" · ")}>
          <span
            className={cx(styles.markerPill, styles.markerPillTight, styles[`tone-${first.tone}`])}
            aria-hidden="true"
          >
            <Icon name={first.icon} size={12} />
            {density === 2 && items.length > 1 ? (
              <span className={styles.markerPillCount}>{items.length.toLocaleString("en-US")}</span>
            ) : null}
          </span>
        </Tooltip>
      </span>
    );
  }

  const limit = density === 1 ? Math.min(max, 3) : max;
  const shown = items.slice(0, limit);
  const rest = items.slice(limit);
  return (
    <span className={cx(styles.markers, styles.markersPlate, className)}>
      <span className="sr-only">{srAll}</span>
      {shown.map((m) => (
        <Tooltip key={m.key} content={m.text}>
          <span
            className={cx(styles.markerPill, density === 1 && styles.markerPillTight, styles[`tone-${m.tone}`])}
            aria-hidden="true"
          >
            <Icon name={m.icon} size={12} />
            {density === 0 ? <span className={styles.markerPillText}>{m.plate}</span> : null}
          </span>
        </Tooltip>
      ))}
      {rest.length > 0 ? (
        <Tooltip content={rest.map((m) => m.text).join(" · ")}>
          <span className={styles.markerMore} aria-hidden="true">
            +{rest.length}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
