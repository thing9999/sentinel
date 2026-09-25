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
  /**
   * 툴팁(단축키 안내 등). 예 `위에서 (1)`.
   * **칸을 막지 않는다.** 누를 수 있어야 하는 칸에 사유·상태만 보여 주려면 이것을 쓴다
   * — 예: 로그 컨테이너 칩의 `CrashLoopBackOff`(바로 그 컨테이너를 조사해야 하므로 골라져야 한다, logs.md 5절).
   */
  tooltip?: string;
  /**
   * 고를 수 없는 칸. 네이티브 `disabled` 를 쓰지 않는다 — **포커스는 받아야** 사유를 키보드로 읽을 수 있다
   * (components.md 21.3, logs.md 13절).
   */
  disabled?: boolean;
  /**
   * 고를 수 없는 칸의 사유. 네이티브 disabled 대신 aria-disabled(포커스 유지) + 툴팁 사유.
   * 예: WebGL 없음일 때 `3D` 칸 (snapshot-3d.md 9.3), 로그 스택 미설정일 때 `로그 스택` 칸 (logs.md 3절).
   * 사유는 툴팁뿐 아니라 **접근 이름에도** 들어간다(툴팁을 못 읽는 스크린리더가 있다).
   *
   * **주의: 이 값만 줘도 칸이 비활성이 된다** — `disabled` 를 함께 주지 않아도 막힌다
   * (`disabled || disabledReason`, components.md 17.4·21.3). "이 칸은 고를 수 없다, 이유는 이것"일 때만 쓴다.
   * **누를 수 있어야 하는 칸에 사유만 보여 주려면 `tooltip` 을 쓴다.**
   * 실제 결함: 로그 컨테이너 칩에 `CrashLoopBackOff` 를 이 값으로 넘겼다가 정작 조사해야 할 컨테이너를 고를 수 없었다.
   * `tooltip` 과 함께 주면 툴팁에는 이 사유가 나온다.
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
        // 비활성 칸을 **목록에서 빼지 않는다**(components.md 21.3): 빼면 그런 선택지가 원래 없는 것으로 읽힌다.
        // `disabledReason` 단독으로도 막는 것은 **정의된 동작**이다(17.4). 누를 수 있는 칸의 사유는 `tooltip` 몫이다
        const blocked = Boolean(o.disabled) || Boolean(o.disabledReason);
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
            {blocked ? (
              <span className="sr-only">, 고를 수 없음{o.disabledReason ? `, ${o.disabledReason}` : ""}</span>
            ) : null}
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
