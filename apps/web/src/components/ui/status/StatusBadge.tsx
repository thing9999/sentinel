import { cx } from "../cx";
import { Spinner } from "../feedback/Spinner";
import { formatTime, type TimeFormat } from "../format";
import { Icon, STATUS_ICON } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { STATUS_LABEL, type IsoTime, type Size, type Status, type StatusAltLabel } from "../types";
import styles from "./status.module.css";

export interface StatusBadgeProps {
  status: Status;
  /** sm 20 / md 24 / lg 32px */
  size?: Size;
  /** subtle(기본) | solid(요약 띠 전체 상태·장애 카드만) | dot(사이드바·표 밀집 영역) */
  variant?: "subtle" | "solid" | "dot";
  /** status.md 1.2 허용 문구만 (타입으로 제한) */
  label?: StatusAltLabel;
  /** status=stale 일 때 `· 14:02:10 기준` */
  staleAt?: IsoTime;
  /** 기준 시각 형식. 기본 time(HH:mm:ss), 비용·어드바이저는 shortTime */
  staleFormat?: TimeFormat;
  /** stale 툴팁 `마지막 상태: 장애 (이유)` */
  previousStatus?: Status;
  previousReason?: string;
  /** 스크린리더용 판단 이유: `상태: 장애, 최근 1시간 재시작 6회` */
  reason?: string;
  /** 상태 악화 강조 외곽선 2000ms 1회. 다시 켜려면 key 를 바꾼다 */
  highlight?: boolean;
  /** 아이콘 대신 12px 스피너 (분석 이력 `진행 중`) */
  busy?: boolean;
  /**
   * 스크린리더 앞말. 기본 `상태: `. 한 화면에 두 축이 있으면 축 이름을 준다
   * (k8s-snapshot.md 14절: `파일 상태: `, `드리프트: `).
   */
  srPrefix?: string;
  className?: string;
}

const ICON_PX = { sm: 12, md: 14, lg: 20 } as const;

/**
 * components.md 2.1 / status.md 1.1. 색 + 아이콘 모양 + 문구를 함께 표시한다.
 * stale 은 1px dashed 테두리 + `데이터 오래됨 · HH:mm:ss 기준`.
 */
export function StatusBadge({
  status,
  size = "md",
  variant = "subtle",
  label,
  staleAt,
  staleFormat = "time",
  previousStatus,
  previousReason,
  reason,
  highlight = false,
  busy = false,
  srPrefix = "상태: ",
  className,
}: StatusBadgeProps) {
  const text = label ?? STATUS_LABEL[status];
  const staleSuffix = status === "stale" && staleAt ? ` · ${formatTime(staleAt, staleFormat)} 기준` : "";
  const tooltip =
    status === "stale" && previousStatus
      ? `마지막 상태: ${STATUS_LABEL[previousStatus]}${previousReason ? ` (${previousReason})` : ""}`
      : null;

  const badge = (
    <span
      className={cx(
        styles.badge,
        styles[`badge-${size}`],
        styles[`badge-${variant}`],
        styles[`s-${status}`],
        highlight && styles.highlight,
        className,
      )}
      data-status={status}
    >
      {srPrefix ? <span className="sr-only">{srPrefix}</span> : null}
      {variant === "dot" ? (
        <span className={styles.dot} aria-hidden="true" />
      ) : busy ? (
        <Spinner size={12} tone="current" />
      ) : (
        <Icon name={STATUS_ICON[status]} size={ICON_PX[size]} className={styles.badgeIcon} />
      )}
      <span className={styles.badgeText} suppressHydrationWarning>
        {text}
        {staleSuffix}
      </span>
      {reason ? <span className="sr-only">, {reason}</span> : null}
      {tooltip ? <span className="sr-only">, {tooltip}</span> : null}
    </span>
  );

  if (tooltip) return <Tooltip content={tooltip}>{badge}</Tooltip>;
  return badge;
}
