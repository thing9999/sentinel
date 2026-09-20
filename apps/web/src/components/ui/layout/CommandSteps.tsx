import type { ReactNode } from "react";

import { cx } from "../cx";
import { CommandLine } from "./CommandLine";
import styles from "./layout.module.css";

export interface CommandStep {
  id: string;
  title: string;
  /** 있으면 CommandLine(복사 버튼), 텍스트로만 렌더(실행 수단 없음) */
  command?: string;
  /** command 가 없을 때 본문 (경로는 호출 측이 <code> 인라인 코드로) */
  text?: ReactNode;
}

export interface CommandStepsProps {
  steps: CommandStep[];
  /** 제목 칸 폭 px, 기본 120 */
  titleWidth?: number;
  /** 목록 이름(스크린리더), 없으면 생략 */
  label?: string;
  className?: string;
}

/**
 * components.md 11.6 / aws-snapshot-manager.md 3.6. 번호 원 20px + 12px + 제목(bodyStrong, titleWidth) + 내용.
 * 단계 간 12px. 1280px 미만에서는 제목 위, 내용 아래로 쌓는다. <ol> 이라 번호는 스크린리더가 읽는다.
 */
export function CommandSteps({ steps, titleWidth = 120, label, className }: CommandStepsProps) {
  return (
    <ol
      className={cx(styles.cmdSteps, className)}
      aria-label={label}
      style={{ ["--cmd-step-title-w" as string]: `${titleWidth}px` }}
    >
      {steps.map((s, i) => (
        <li key={s.id} className={styles.cmdStep}>
          <span className={styles.cmdStepNum} aria-hidden="true">
            {i + 1}
          </span>
          <div className={styles.cmdStepMain}>
            <span className={styles.cmdStepTitle}>{s.title}</span>
            <div className={styles.cmdStepContent}>
              {s.command ? <CommandLine command={s.command} copyLabel={`${s.title} 명령 복사`} /> : null}
              {!s.command && s.text !== undefined ? <div className={styles.cmdStepText}>{s.text}</div> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
