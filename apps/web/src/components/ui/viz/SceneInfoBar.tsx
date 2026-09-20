import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import type { IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { Chip, StaleNotice } from "../status/Chip";
import chipStyles from "../status/status.module.css";
import type { IsoTime } from "../types";
import { NO_EDGE_HINT } from "./viz";
import styles from "./viz.module.css";

export interface SceneInfoItem {
  id: string;
  /** 12px 아이콘 (예: 드리프트 `square-dot`, 리소스 밖 발견 `octagon-x`) */
  icon?: IconName;
  text: string;
  /** 칩 자체는 항상 중립이다. tone 은 **아이콘 색만** 바꾼다(드리프트에 상태색을 쓰지 않는다) */
  tone?: "neutral" | "crit" | "warn";
  /** 링크 칩 → `<a>` (예: `리소스 밖 발견`, `라벨 N개 숨김`) */
  href?: string;
  /**
   * 동작 칩 → `<button>` (예: `일부가 화면 밖` 축소, `일부만 표시` 알림으로 이동, `사용자 지정 N` 종류 필터).
   * **`href` 와 배타**다(snapshot-3d.md 6.4). 둘 다 주면 `href` 를 무시하고 개발 모드에서 경고한다 —
   * 같은 칩이 링크이면서 동작이면 가운데 클릭·새 탭·키보드 동작이 서로 어긋난다.
   */
  onClick?: () => void;
  /** 동작·링크 칩의 접근 이름을 `"<text> — <actionLabel>"` 로 만든다 (`일부가 화면 밖 — 전체가 보이게 축소`) */
  actionLabel?: string;
  tooltip?: ReactNode;
}

export interface SceneInfoBarProps {
  items: SceneInfoItem[];
  /** `DataSourceBadge` mock 배지 등 맨 앞 요소 */
  mockBadge?: ReactNode;
  /** 있으면 `데이터 오래됨 · HH:mm:ss 기준` 칩 */
  staleAt?: IsoTime;
  /** 맨 뒤 안내 툴팁 문구. 기본 snapshot-3d.md 4.5 문구 */
  hint?: string;
  /** 스크린리더 영역 이름, 기본 `보기 정보` */
  label?: string;
  className?: string;
}

/**
 * components.md 16.4 / snapshot-3d.md 6.4. 캔버스 왼쪽 위 고정(카메라와 무관).
 * 순서: mock → 개수 → 드리프트 → stale → 리소스 밖 발견 → 묶어 보기·간소화 → 안내.
 * **live 영역이 아니다**: 값이 자주 바뀌어도 스크린리더가 다시 읽지 않는다(선택 결과만 읽는다).
 *
 * **한 줄 고정(높이 20px)**: 2줄이 되면 카메라 안전 영역이 달라져 장면이 아래로 몰린다(4.9-1).
 * 480px을 넘을 때 뒤 칩을 `+N` 하나로 합치는 **판단은 프론트**가 한다 — 칩 수·캔버스 폭을 이미 알고 있고,
 * 여기에 폭 측정(ResizeObserver) 상태를 넣으면 컴포넌트가 props 만으로 동작하지 않는다.
 * 합친 칩은 보통 칩과 같은 모양이다: `{ id: "more", text: "+2", tooltip: <전체 목록>, actionLabel?: "숨은 정보 보기" }`.
 */
export function SceneInfoBar({
  items,
  mockBadge,
  staleAt,
  hint = NO_EDGE_HINT,
  label = "보기 정보",
  className,
}: Readonly<SceneInfoBarProps>) {
  return (
    <div className={cx(styles.infoBar, className)} aria-label={label} role="group">
      {mockBadge}
      {items.map((it, i) => (
        // 넘칠 때 줄어드는 것은 마지막 칩 하나다(앞 칩은 우선순위 1·2라 폭을 지킨다)
        <InfoChip key={it.id} item={it} shrink={i === items.length - 1} />
      ))}
      {staleAt ? <StaleNotice staleAt={staleAt} /> : null}
      {hint ? (
        <Tooltip content={hint} focusable maxWidth={320} className={styles.infoHint}>
          <Icon name="circle-help" size={14} title="이 보기 안내" />
        </Tooltip>
      ) : null}
    </div>
  );
}

/**
 * 정보 줄 칩 하나. `href` → `<a>`(Chip 그대로) / `onClick` → `<button>` / 둘 다 없으면 글자 칩.
 * 접근 이름은 `actionLabel` 이 있을 때 `"<text> — <actionLabel>"`(6.4 마지막 줄).
 */
function InfoChip({ item, shrink = false }: Readonly<{ item: SceneInfoItem; shrink?: boolean }>) {
  const { icon, text, tone, href, onClick, actionLabel, tooltip } = item;
  const toneClass = cx(
    tone === "crit" && styles.chipIconCrit,
    tone === "warn" && styles.chipIconWarn,
    shrink && styles.infoChipShrink,
  );
  const accessibleName = actionLabel ? `${text} — ${actionLabel}` : undefined;

  if (onClick) {
    if (href && process.env.NODE_ENV !== "production") {
      // 같은 칩이 링크이면서 동작이면 가운데 클릭·새 탭·Enter 동작이 어긋난다 (6.4)
      console.warn(`SceneInfoBar: 칩 "${item.id}" 에 href 와 onClick 이 함께 있습니다. href 를 무시합니다.`);
    }
    const button = (
      <button type="button" className={chipClass(toneClass)} aria-label={accessibleName} onClick={onClick}>
        {icon ? <Icon name={icon} size={12} className={chipStyles.chipIcon} /> : null}
        <span className={chipStyles.chipText}>{text}</span>
      </button>
    );
    // 버튼은 스스로 포커스를 받으므로 Tooltip 에 focusable 을 주지 않는다
    return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
  }

  if (href && accessibleName) {
    const link = (
      <Link href={href} className={chipClass(toneClass)} aria-label={accessibleName}>
        {icon ? <Icon name={icon} size={12} className={chipStyles.chipIcon} /> : null}
        <span className={chipStyles.chipText}>{text}</span>
      </Link>
    );
    return tooltip ? <Tooltip content={tooltip}>{link}</Tooltip> : link;
  }

  return <Chip label={text} icon={icon} tone="neutral" size="sm" href={href} tooltip={tooltip} className={toneClass} />;
}

/** `Chip` neutral sm + 누를 수 있는 칩과 **같은 모양**을 쓴다(링크·버튼이 달라 보이지 않게) */
function chipClass(toneClass?: string): string {
  return cx(
    chipStyles.chip,
    chipStyles["chip-sm"],
    chipStyles["chip-neutral"],
    chipStyles.chipLink,
    styles.infoChipButton,
    toneClass,
  );
}
