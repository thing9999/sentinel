import type { ReactNode } from "react";

import { cx } from "../cx";
import { Spinner } from "../feedback/Spinner";
import { Icon } from "../icons";
import styles from "./layout.module.css";

export type StepState = "pending" | "active" | "done" | "error" | "skipped";

export interface Step {
  id: string;
  label: string;
  state: StepState;
  /** 소요 `0:03`, 수신 표시 등 (micro text.tertiary) */
  detail?: ReactNode;
}

export interface StepperProps {
  steps: Step[];
  /** 기본 horizontal (767px 이하에서는 세로로 바뀐다) */
  orientation?: "horizontal" | "vertical";
  /** 목록 이름(스크린리더), 기본 `진행 단계` */
  label?: string;
  className?: string;
}

const STATE_TEXT: Record<StepState, string> = {
  pending: "대기",
  active: "진행 중",
  done: "완료",
  error: "실패",
  skipped: "건너뜀",
};

/**
 * components.md 8.6. 단계 원 20px, 연결선 2px(done 구간 status.ok.solid).
 * 상태는 원 모양·아이콘 + 스크린리더 문구로 구분(색만으로 구분하지 않음).
 */
export function Stepper({ steps, orientation = "horizontal", label = "진행 단계", className }: StepperProps) {
  return (
    <ol className={cx(styles.stepper, orientation === "vertical" && styles.stepperVertical, className)} aria-label={label}>
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={cx(styles.step, styles[`step-${s.state}`], i > 0 && steps[i - 1].state === "done" && styles.stepAfterDone)}
          aria-current={s.state === "active" ? "step" : undefined}
        >
          <span className={styles.stepCircle} aria-hidden="true">
            {s.state === "done" ? <Icon name="check" size={12} /> : null}
            {s.state === "error" ? <Icon name="x" size={12} /> : null}
            {s.state === "skipped" ? <Icon name="minus" size={12} /> : null}
            {s.state === "active" ? <Spinner size={12} tone="current" /> : null}
          </span>
          <span className={styles.stepText}>
            <span className={styles.stepLabel}>
              {s.label}
              <span className="sr-only"> ({STATE_TEXT[s.state]})</span>
            </span>
            {s.detail ? <span className={styles.stepDetail}>{s.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
