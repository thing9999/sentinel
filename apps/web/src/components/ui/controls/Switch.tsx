"use client";

import { useId } from "react";

import { cx } from "../cx";
import { Tooltip } from "../overlay/Tooltip";
import styles from "./controls.module.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** 오른쪽 문구 */
  label: string;
  disabled?: boolean;
  /**
   * 끌 수 없는 사유 (snapshot-3d.md 6.2 `드리프트 겹쳐 보기`). `disabled` 와 함께 주면
   * 네이티브 disabled 대신 aria-disabled(포커스 유지) + 툴팁 사유 + aria-describedby.
   */
  disabledReason?: string;
  /**
   * (2026-09-25 추가) 스위치 **설명 문장**의 id(공백으로 여러 개). 호출 측이 그린 설명을 스위치에 잇는다 —
   * settings.md 9절 "설명이 동작의 절반이다"(`끄면 화면에는 계속 쌓입니다`). 비활성 사유가 있으면 그 뒤에 이어 붙는다.
   */
  "aria-describedby"?: string;
  className?: string;
}

/** components.md 4.7. role=switch 버튼. 트랙 32×18, 손잡이 14px. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  disabledReason,
  "aria-describedby": describedBy,
  className,
}: Readonly<SwitchProps>) {
  const id = useId();
  const reasonId = useId();
  const soft = Boolean(disabled && disabledReason);
  const describedByAll = [describedBy, soft ? reasonId : null].filter(Boolean).join(" ") || undefined;
  const root = (
    <div className={cx(styles.switchRoot, className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={soft ? undefined : disabled}
        aria-disabled={soft ? true : undefined}
        aria-describedby={describedByAll}
        className={cx(styles.switchTrack, checked && styles.switchOn, soft && styles.switchOff)}
        onClick={() => {
          if (!soft) onChange(!checked);
        }}
      >
        <span className={styles.switchThumb} aria-hidden="true" />
      </button>
      <label htmlFor={id} className={cx(styles.switchLabel, soft && styles.switchLabelOff)}>
        {label}
      </label>
      {soft ? (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
    </div>
  );
  return soft ? <Tooltip content={disabledReason}>{root}</Tooltip> : root;
}
