import type { ReactNode } from "react";

import { cx } from "../cx";
import { Button } from "./Button";
import styles from "./controls.module.css";

export interface FilterBarProps {
  /** 필터 컨트롤들 */
  children: ReactNode;
  /** `파드 412개 중 37개 표시` */
  resultText?: ReactNode;
  /** 필터가 기본값이 아닐 때만 넘긴다 → `필터 초기화` ghost sm 표시 */
  onReset?: () => void;
  /** 필터 영역 이름(스크린리더). 기본 `필터` */
  label?: string;
  className?: string;
}

/** components.md 4.8. 높이 48px, 컨트롤 간격 8px, 좁으면 줄바꿈. */
export function FilterBar({ children, resultText, onReset, label = "필터", className }: FilterBarProps) {
  return (
    <div role="group" aria-label={label} className={cx(styles.filterBar, className)}>
      <div className={styles.filterControls}>{children}</div>
      <div className={styles.filterMeta}>
        {onReset ? (
          <Button variant="ghost" size="sm" onClick={onReset}>
            필터 초기화
          </Button>
        ) : null}
        {resultText ? <span className={styles.filterResult}>{resultText}</span> : null}
      </div>
    </div>
  );
}
