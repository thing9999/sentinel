import type { ReactNode } from "react";

import { Button } from "../controls/Button";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import styles from "./feedback.module.css";

export type StateSize = "chart" | "sm" | "lg";

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** sm 높이 200px·아이콘 24px / lg 높이 320px·아이콘 40px / chart: 부모 영역 가운데, 아이콘 20px */
  size?: StateSize;
  /** 아이콘 색 (기본 text.tertiary) */
  iconTone?: "tertiary" | "ok" | "unknown";
  /** 제목 태그 (문서 구조에 맞게) */
  headingLevel?: 2 | 3 | 4 | "p";
  className?: string;
}

const ICON_SIZE = { chart: 20, sm: 24, lg: 40 } as const;

/** components.md 6.3 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "sm",
  iconTone = "tertiary",
  headingLevel = "p",
  className,
}: EmptyStateProps) {
  const H = headingLevel === "p" ? "p" : (`h${headingLevel}` as const);
  return (
    <div className={cx(styles.empty, styles[`empty-${size}`], className)}>
      <Icon name={icon} size={ICON_SIZE[size]} className={cx(styles.emptyIcon, styles[`icon-${iconTone}`])} />
      <H className={styles.emptyTitle}>{title}</H>
      {description ? <div className={styles.emptyDesc}>{description}</div> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

export interface UnknownStateProps {
  /** 서버 사유 → `알 수 없음 (사유)` */
  reason?: string;
  /** 기본 `알 수 없음` */
  title?: string;
  /** 해결 방법 */
  hint?: ReactNode;
  /** 있으면 `다시 시도` 버튼 (예: Cost Explorer 사용 불가) */
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  size?: StateSize;
  /**
   * 기본 `circle-help`. 기다리면 풀리는 상태는 `hourglass`
   * (k8s-snapshot 6.8 `클러스터 동기화 중`·`스냅샷 파일 확인 전`). 색은 항상 status.unknown.fg
   */
  icon?: IconName;
  /** 제목 태그 (기본 p) */
  headingLevel?: EmptyStateProps["headingLevel"];
  className?: string;
}

/** components.md 6.4. 출처 없음·권한 없음. 아이콘 circle-help (status.unknown.fg). */
export function UnknownState({
  reason,
  title = "알 수 없음",
  hint,
  onRetry,
  retryLabel = "다시 시도",
  action,
  size = "sm",
  icon = "circle-help",
  headingLevel,
  className,
}: UnknownStateProps) {
  return (
    <EmptyState
      icon={icon}
      headingLevel={headingLevel}
      iconTone="unknown"
      title={reason ? `${title} (${reason})` : title}
      description={hint}
      action={
        action ??
        (onRetry ? (
          <Button variant="secondary" size={size === "lg" ? "md" : "sm"} icon="refresh-cw" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined)
      }
      size={size}
      className={className}
    />
  );
}

export type ErrorKind = "network" | "timeout" | "http";

export interface ErrorStateProps {
  title: string;
  /** 오류 종류: network/timeout → unplug, http → server-crash */
  detail?: ErrorKind;
  /** 보조 문구 (예: `http://localhost:3001 응답 없음 · 자동으로 다시 시도합니다`) */
  description?: ReactNode;
  onRetry?: () => void;
  /** 기본 `다시 시도` (셸 전체 오류는 `지금 다시 시도`) */
  retryLabel?: string;
  /** 재시도 버튼 대신 직접 넣을 액션 */
  action?: ReactNode;
  size?: StateSize;
  className?: string;
}

/** components.md 6.5. API 오류. 빨강을 쓰지 않는다(장애와 혼동 방지). */
export function ErrorState({
  title,
  detail = "network",
  description,
  onRetry,
  retryLabel = "다시 시도",
  action,
  size = "sm",
  className,
}: ErrorStateProps) {
  return (
    <EmptyState
      icon={detail === "http" ? "server-crash" : "unplug"}
      title={title}
      description={description}
      action={
        action ??
        (onRetry ? (
          <Button variant="secondary" size={size === "lg" ? "md" : "sm"} icon="refresh-cw" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined)
      }
      size={size}
      className={className}
    />
  );
}
