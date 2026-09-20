"use client";

import { cx } from "../cx";
import { Spinner } from "../feedback/Spinner";
import { formatTime } from "../format";
import { Icon } from "../icons";
import type { IsoTime } from "../types";
import styles from "./shell.module.css";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "disconnected" | "apiDown";

export interface ConnectionIndicatorProps {
  status: ConnectionStatus;
  /** 마지막 수신 시각 → `HH:mm:ss` */
  lastEventAt?: IsoTime | null;
  /** 재연결 중 `(3회째)` */
  retryCount?: number;
  /** true 인 동안 `다시 연결됨` 칩 (3000ms 뒤 CSS 로 사라짐. 다시 띄우려면 key 변경) */
  justReconnected?: boolean;
  className?: string;
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "연결 중",
  open: "실시간",
  reconnecting: "재연결 중",
  disconnected: "연결 끊김",
  apiDown: "API 연결 없음",
};

/**
 * components.md 1.4 / status.md 2.3. 최소 폭 140px, 높이 24px.
 * 스크린리더: 상태 문구만 aria-live(polite)로 알린다. 시각·재시도 횟수는 바뀔 때마다 읽지 않는다.
 */
export function ConnectionIndicator({
  status,
  lastEventAt,
  retryCount = 0,
  justReconnected = false,
  className,
}: ConnectionIndicatorProps) {
  const spinning = status === "connecting" || status === "reconnecting";
  const down = status === "disconnected" || status === "apiDown";
  return (
    <span className={cx(styles.conn, className)}>
      {spinning ? (
        <Spinner size={12} />
      ) : down ? (
        <span className={cx(styles.connDot, styles.connDotHollow)} aria-hidden="true" />
      ) : (
        <span className={cx(styles.connDot, styles.connDotLive)} aria-hidden="true" />
      )}
      <span className={styles.connText}>
        <span role="status" className={styles.connStatus}>
          {STATUS_TEXT[status]}
        </span>
        {status === "reconnecting" && retryCount > 0 ? <span> ({retryCount}회째)</span> : null}
      </span>
      {status === "open" && lastEventAt ? (
        <time dateTime={lastEventAt} className={styles.connTime} suppressHydrationWarning>
          <span className="sr-only">마지막 수신 </span>
          {formatTime(lastEventAt, "time")}
        </time>
      ) : null}
      {justReconnected && status === "open" ? (
        <span className={styles.reconnectedChip} role="status">
          <Icon name="circle-check" size={12} />
          다시 연결됨
        </span>
      ) : null}
    </span>
  );
}

export interface ConnectionBannerProps {
  lastEventAt?: IsoTime | null;
  retryCount?: number;
  /** `다음 시도 8초 후` (호출 측이 1초마다 갱신해서 넘긴다) */
  nextRetryInMs?: number | null;
  /** 기본 `연결 끊김`. API 불가면 `API에 연결할 수 없습니다` */
  message?: string;
  onRetryNow?: () => void;
  className?: string;
}

/**
 * components.md 1.5 / status.md 2.3. 높이 40px, 배경 connection.bannerBg(빨강·노랑 금지).
 * 표시 지연 5000ms 는 호출 측이 제어한다. 값은 지우지 않는다(개별 stale 규칙).
 */
export function ConnectionBanner({
  lastEventAt,
  retryCount = 0,
  nextRetryInMs,
  message = "연결 끊김",
  onRetryNow,
  className,
}: ConnectionBannerProps) {
  const secs = nextRetryInMs !== null && nextRetryInMs !== undefined ? Math.max(0, Math.ceil(nextRetryInMs / 1000)) : null;
  const retryParts = [retryCount > 0 ? `${retryCount}회째` : null, secs !== null ? `다음 시도 ${secs}초 후` : null].filter(
    Boolean,
  );
  return (
    <div className={cx(styles.banner, className)} role="region" aria-label="연결 상태">
      <Icon name="unplug" size={16} className={styles.bannerIcon} />
      <p className={styles.bannerTitle} role="status" suppressHydrationWarning>
        {message}
        {lastEventAt ? ` - 마지막 갱신 ${formatTime(lastEventAt, "time")}` : ""}
      </p>
      <p className={styles.bannerRetry} aria-hidden="true">
        재연결 시도 중{retryParts.length ? ` (${retryParts.join(", ")})` : ""}
      </p>
      {onRetryNow ? (
        <button type="button" className={styles.bannerButton} onClick={onRetryNow}>
          지금 다시 연결
        </button>
      ) : null}
    </div>
  );
}
