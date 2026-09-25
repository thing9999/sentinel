import { cx } from "../cx";
import { Icon } from "../icons";
import type { IsoTime } from "../types";
import styles from "./alerts.module.css";
import { GAP_EXPLAIN, GAP_UNKNOWN_PREVIOUS, gapAriaLabel, gapRangeText } from "./alertModel";

export interface AlertGapRowProps {
  from: IsoTime;
  /** 없으면 `지금`까지 */
  to?: IsoTime | null;
  /** 서버 값(`19`) */
  minutes: number;
  /** 대시보드 DB 없음 — `이전 실행 기록 없음` (AC-ALERT10) */
  unknownPrevious?: boolean;
  className?: string;
}

/**
 * components.md 20.2 / status.md 12.4. 대시보드가 꺼져 있던 구간 = **"아무 일도 없었다"가 아니라 "보지 못했다"**.
 *
 * - **필터·정렬과 무관하게 그려진다.** 이 줄을 필터 결과 배열에서 빼는 코드를 만들면 안 된다(호출 측 규칙).
 *   필터 결과가 0건이어도 빈 상태 문구 **위에** 남는다.
 * - 45° 빗금은 장식이 아니다 — 회색조·흑백에서도 보통 목록 항목과 갈리는 유일한 단서다(status.md 2.5).
 * - 알림이 아니므로 `AlertItem` 의 한 종류로 넣지 않는다(심각도·읽음·발송·링크가 하나도 없다).
 */
export function AlertGapRow({ from, to, minutes, unknownPrevious = false, className }: AlertGapRowProps) {
  const label = gapAriaLabel(from, to, minutes, unknownPrevious);
  return (
    <li className={cx(styles.gap, className)} aria-label={label} data-testid="alert-gap-row">
      <span className={styles.gapInner} aria-hidden="true">
        <Icon name="circle-help" size={14} className={styles.gapIcon} />
        {unknownPrevious ? (
          <span className={styles.gapExplain}>{GAP_UNKNOWN_PREVIOUS}</span>
        ) : (
          <>
            <span className={styles.gapRange}>{gapRangeText(from, to, minutes)}</span>
            <span className={styles.gapExplain}>{GAP_EXPLAIN}</span>
          </>
        )}
      </span>
    </li>
  );
}
