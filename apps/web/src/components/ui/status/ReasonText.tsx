import { cx } from "../cx";
import { Tooltip } from "../overlay/Tooltip";
import type { Status } from "../types";
import styles from "./status.module.css";

export interface ReasonTextProps {
  /** 서버가 준 이유(첫 번째가 가장 나쁜 것). 비어 있으면 아무것도 그리지 않는다 */
  reasons: string[] | undefined | null;
  status?: Status;
  /** 기본 1, 카드에서만 2 */
  lines?: 1 | 2;
  className?: string;
}

/**
 * components.md 2.3 / status.md 1.4.
 * 첫 이유 + `외 N건`(text.tertiary), 넘치면 말줄임, 툴팁(400ms)에 전체 목록.
 * crit 이면 status.crit.fg 600. 서버 문자열을 텍스트로만 렌더한다.
 */
export function ReasonText({ reasons, status, lines = 1, className }: ReasonTextProps) {
  const list = (reasons ?? []).filter((r) => r && r.trim() !== "");
  if (list.length === 0) return null;
  const [first, ...rest] = list;
  const content = (
    <span className={cx(styles.reason, lines === 2 && styles.reason2, status === "crit" && styles.reasonCrit, className)}>
      <span className={styles.reasonMain}>{first}</span>
      {rest.length > 0 ? (
        <span className={styles.reasonMore}>
          {" "}
          외 {rest.length}건<span className="sr-only">: {rest.join(", ")}</span>
        </span>
      ) : null}
    </span>
  );
  return (
    <Tooltip
      className={styles.reasonAnchor}
      content={
        list.length > 1 ? (
          <span className={styles.tooltipList}>
            {list.map((r, i) => (
              <span key={i}>{r}</span>
            ))}
          </span>
        ) : (
          first
        )
      }
    >
      {content}
    </Tooltip>
  );
}
