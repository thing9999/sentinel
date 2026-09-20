import type { ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import styles from "./viz.module.css";

export interface SceneToolbarProps {
  /** a: 48px(보기 전환·필터·검색) / b: 40px(겹쳐 보기·라벨 밀도·범례) */
  row: "a" | "b";
  /** 왼쪽 항목들 */
  children?: ReactNode;
  /** 오른쪽 끝 항목들(초기화·도움말·범례) */
  trailing?: ReactNode;
  /** 오른쪽 결과 수 caption (`블록 128 · 관계 164`) */
  countText?: ReactNode;
  /** 스크린리더 이름 */
  label?: string;
  /** 데이터 조회 중: 항목 흐리게 (실제 비활성은 각 컨트롤이 받는다) */
  busy?: boolean;
  className?: string;
}

const DEFAULT_LABEL = { a: "보기·필터 도구", b: "표시 옵션" } as const;

/**
 * components.md 16.2 / snapshot-3d.md 6.1·6.2. 3D 카드 위 두 줄.
 * role=group 을 쓴다(role=toolbar 는 화살표 키 이동을 약속하는데, 여기 항목은 각자 키 규칙이 다르다).
 * 좁은 화면(<1280px)에서는 `SceneToolbarItem collapseBelow={1280}` 항목이 숨고,
 * 호출 측이 `필터 ▾` 팝오버 하나로 접는다(12절).
 *
 * **종류 필터 옵션(2026-09-20 (8), 16.2 · 6.1)**: 각 종류 앞에 층 색 사각 10px 대신
 * `ShapeSwatch` 14px `tone="layer"`(그 종류의 모양을 층 색으로 채운 실루엣)를 둔다.
 * 항목은 `MultiSelect` 의 `options[].adornment` 로 넘긴다 — 예:
 * `{ value: kind, label: kind, count, adornment: <ShapeSwatch shape={kindShape(kind, { layer })} size={14} tone="layer" layer={layer} /> }`.
 * 다른 필터(네임스페이스·관계·표식)는 바뀌지 않고, 선택 패널·관계 표의 층 색 사각도 그대로다(4.11.7).
 */
export function SceneToolbar({
  row,
  children,
  trailing,
  countText,
  label,
  busy = false,
  className,
}: Readonly<SceneToolbarProps>) {
  return (
    <div
      className={cx(styles.toolbar, styles[`toolbar-${row}`], className)}
      role="group"
      aria-label={label ?? DEFAULT_LABEL[row]}
      aria-busy={busy || undefined}
      data-busy={busy ? "true" : undefined}
    >
      <div className={styles.toolbarMain}>{children}</div>
      {countText ? <span className={styles.toolbarCount}>{countText}</span> : null}
      {trailing ? <div className={styles.toolbarTrailing}>{trailing}</div> : null}
    </div>
  );
}

export interface SceneToolbarItemProps {
  children: ReactNode;
  /** 이 폭 미만에서 숨긴다(호출 측이 `필터 ▾` 팝오버로 접는다) */
  collapseBelow?: 1280;
  /** 이 폭 미만에서만 보인다(접은 팝오버 트리거) */
  showBelow?: 1280;
  className?: string;
}

/** 도구 막대 항목 래퍼. 반응형 숨김을 CSS로만 처리한다(자바스크립트 폭 측정 없음) */
export function SceneToolbarItem({ children, collapseBelow, showBelow, className }: Readonly<SceneToolbarItemProps>) {
  return (
    <span
      className={cx(
        styles.toolbarItem,
        collapseBelow === 1280 && styles.hideBelow1280,
        showBelow === 1280 && styles.showBelow1280,
        className,
      )}
    >
      {children}
    </span>
  );
}

export interface SceneSearchNavProps {
  /** 1부터. 결과가 없으면 0 */
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}

/** 검색 결과 이동 `3/12` + 이전·다음 (snapshot-3d.md 6.1). 누르면 카메라가 그 블록을 비춘다(프론트) */
export function SceneSearchNav({ index, total, onPrev, onNext, className }: Readonly<SceneSearchNavProps>) {
  const none = total <= 0;
  return (
    <span className={cx(styles.searchNav, className)}>
      <span className={styles.searchCount}>
        <span className="sr-only">검색 결과 </span>
        {none ? "0/0" : `${index}/${total}`}
      </span>
      <IconButton
        icon="chevron-up"
        size="sm"
        label="이전 결과"
        disabled={none}
        disabledReason={none ? "검색 결과가 없습니다" : undefined}
        onClick={onPrev}
      />
      <IconButton
        icon="chevron-down"
        size="sm"
        label="다음 결과"
        disabled={none}
        disabledReason={none ? "검색 결과가 없습니다" : undefined}
        onClick={onNext}
      />
    </span>
  );
}
