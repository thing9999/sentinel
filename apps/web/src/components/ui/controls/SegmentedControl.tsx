"use client";

import { useId } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { StatusIcon } from "../status/StatusIcon";
import type { Status } from "../types";
import styles from "./controls.module.css";

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: string;
  count?: number;
  status?: Status;
  /** 라벨 앞 14px 아이콘 (snapshot-3d.md 6.1 `3D`/`표` 전환) */
  icon?: IconName;
  /** 툴팁(단축키 안내 등). 예 `위에서 (1)` */
  tooltip?: string;
  /**
   * 고를 수 없는 칸의 사유. 네이티브 disabled 대신 aria-disabled(포커스 유지) + 툴팁 사유.
   * 예: WebGL 없음일 때 `3D` 칸 (snapshot-3d.md 9.3)
   */
  disabledReason?: string;
}

export interface SegmentedControlProps<V extends string = string> {
  options: SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** 그룹 이름(스크린리더) */
  label: string;
  /** sm 28 / md 32px */
  size?: "sm" | "md";
  /** 세로 묶음 (3D 카메라 시점 전환, snapshot-3d.md 6.3) */
  orientation?: "horizontal" | "vertical";
  className?: string;
}

/**
 * components.md 4.6. 라디오 그룹으로 구현(화살표 키 이동은 브라우저 기본).
 * 좁은 화면에서는 트랙 안에서 가로 스크롤한다(페이지 가로 스크롤 없음).
 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  orientation = "horizontal",
  className,
}: SegmentedControlProps<V>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-orientation={orientation}
      className={cx(
        styles.segmented,
        styles[`seg-${size}`],
        orientation === "vertical" && styles.segVertical,
        className,
      )}
    >
      {options.map((o) => {
        const checked = o.value === value;
        const blocked = Boolean(o.disabledReason);
        const item = (
          <label key={o.value} className={cx(styles.segItem, checked && styles.segChecked, blocked && styles.segOff)}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              aria-disabled={blocked || undefined}
              onChange={() => {
                if (!blocked) onChange(o.value);
              }}
              className={styles.segInput}
            />
            {o.status ? <StatusIcon status={o.status} size={12} /> : null}
            {o.icon ? <Icon name={o.icon} size={14} /> : null}
            <span>{o.label}</span>
            {o.count !== undefined ? <span className={styles.count}>{o.count.toLocaleString("en-US")}</span> : null}
          </label>
        );
        const tip = o.disabledReason ?? o.tooltip;
        return tip ? (
          <Tooltip key={o.value} content={tip}>
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </div>
  );
}
