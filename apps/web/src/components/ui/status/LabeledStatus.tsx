import type { ReactNode } from "react";

import { cx } from "../cx";
import { ReasonText } from "./ReasonText";
import styles from "./status.module.css";

export interface LabeledStatusProps {
  /** 앞 라벨 captionStrong text.tertiary (예 `드리프트`) */
  label: string;
  /** 배지 (보통 `DriftStatus`) */
  children: ReactNode;
  /** 사유 1줄 (ReasonText) */
  reason?: string | string[];
  /** 사유 뒤 caption text.tertiary (예 `· 15:12 계산`) */
  meta?: ReactNode;
  /** 맨 뒤 8px (ghost sm 링크 `드리프트 보기`) */
  action?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}

/**
 * components.md 14.2. 한 화면에 상태 축이 둘일 때(파일 상태 / 드리프트) 보조 축에 라벨을 붙인다.
 * 보이는 라벨은 aria-hidden 이다: 배지의 스크린리더 문구가 같은 말로 시작해야 한다
 * (`DriftStatus`는 기본으로 `드리프트: `를 붙인다, k8s-snapshot.md 14절). 좁으면 줄바꿈한다.
 */
export function LabeledStatus({ label, children, reason, meta, action, size = "md", className }: LabeledStatusProps) {
  const reasons = reason === undefined ? [] : Array.isArray(reason) ? reason : [reason];
  return (
    <span className={cx(styles.labeled, styles[`labeled-${size}`], className)}>
      <span className={styles.labeledHead}>
        <span className={styles.labeledLabel} aria-hidden="true">
          {label}
        </span>
        <span className={styles.labeledBadge}>{children}</span>
      </span>
      {reasons.length > 0 || meta ? (
        <span className={styles.labeledTail}>
          <ReasonText reasons={reasons} />
          {meta ? <span className={styles.labeledMeta}>{meta}</span> : null}
        </span>
      ) : null}
      {action ? <span className={styles.labeledAction}>{action}</span> : null}
    </span>
  );
}
