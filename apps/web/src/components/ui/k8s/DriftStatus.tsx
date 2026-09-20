import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "../cx";
import { Spinner } from "../feedback/Spinner";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import { StatusBadge } from "../status/StatusBadge";
import type { DriftKind, DriftState, IsoTime, Size } from "../types";
import { DRIFT_KIND, formatDriftCount } from "./drift";
import styles from "./k8s.module.css";

export interface DriftStatusProps {
  /** 호출 측이 API 값을 매핑한다(status.md 10.2: warning→changed, ok→none, unknown→unknown, critical→unknown) */
  state: DriftState;
  /** changed 일 때 `차이 N건` (N = 추가+삭제+변경, 숨긴 차이 제외. 서버 값) */
  count?: number;
  /** StatusBadge 크기 그대로 (sm 20 / md 24 / lg 32) */
  size?: Size;
  /** stale 배지 `데이터 오래됨 · HH:mm:ss 기준` */
  staleAt?: IsoTime;
  /** stale 툴팁 `마지막 결과: 차이 3건` (count 없으면 `차이 없음`) */
  previous?: { count?: number };
  /** 스크린리더에만 붙는 사유 (`드리프트: 차이 3건, 변경 2 · 삭제 1`) */
  reason?: string;
  /** 스크린리더 앞말. 기본 `드리프트: ` (LabeledStatus 의 보이는 라벨과 같은 말) */
  srPrefix?: string;
  /** API `computing: true`: 배지(또는 계산 안 함 문구) 뒤 4px 에 12px 스피너 `갱신 중`. 값은 그대로 */
  refreshing?: boolean;
  className?: string;
}

/**
 * components.md 14.3 / status.md 10.2. 드리프트 축 표시.
 * - changed → warn `차이 N건`, none → ok `차이 없음`, unknown → unknown `알 수 없음`, stale → stale 배지
 * - notComputed → 배지 없이 `minus` + `계산 안 함` (상태가 아니다), computing → Spinner + `계산 중`
 * crit 는 없다. 지난 결과 2줄 문구는 `formatDriftLastResult`로 호출 측이 배치한다.
 */
export function DriftStatus({ refreshing = false, ...props }: DriftStatusProps) {
  const el = <DriftStatusBody {...props} />;
  if (!refreshing || props.state === "computing") return el;
  return (
    <span className={styles.driftWrap} data-refreshing="true">
      {el}
      <Spinner size={12} label="갱신 중" />
    </span>
  );
}

function DriftStatusBody({
  state,
  count,
  size = "md",
  staleAt,
  previous,
  reason,
  srPrefix = "드리프트: ",
  className,
}: Omit<DriftStatusProps, "refreshing">) {
  if (state === "notComputed") {
    return (
      <span className={cx(styles.driftPlain, styles.fgTertiary, className)} data-drift="notComputed">
        <Icon name="minus" size={12} />
        {srPrefix ? <span className="sr-only">{srPrefix}</span> : null}
        <span>계산 안 함</span>
      </span>
    );
  }
  if (state === "computing") {
    return (
      <span className={cx(styles.driftPlain, styles.fgSecondary, className)} data-drift="computing">
        <Spinner size={12} />
        {srPrefix ? <span className="sr-only">{srPrefix}</span> : null}
        <span>계산 중</span>
      </span>
    );
  }
  if (state === "stale") {
    const tip = previous ? `마지막 결과: ${formatDriftCount(previous.count ?? 0)}` : null;
    const badge = (
      <StatusBadge
        status="stale"
        size={size}
        staleAt={staleAt}
        srPrefix={srPrefix}
        reason={[reason, tip].filter(Boolean).join(", ") || undefined}
        className={className}
      />
    );
    return tip ? <Tooltip content={tip}>{badge}</Tooltip> : badge;
  }
  if (state === "changed") {
    const n = count ?? 0;
    return (
      <StatusBadge
        status="warn"
        size={size}
        label={n > 0 ? `차이 ${n}건` : undefined}
        srPrefix={srPrefix}
        reason={reason}
        className={className}
      />
    );
  }
  if (state === "none") {
    return (
      <StatusBadge status="ok" size={size} label="차이 없음" srPrefix={srPrefix} reason={reason} className={className} />
    );
  }
  return <StatusBadge status="unknown" size={size} srPrefix={srPrefix} reason={reason} className={className} />;
}

export interface DriftKindIconProps {
  kind: DriftKind;
  size?: 12 | 14 | 16;
  /** 스크린리더 문구. 기본 `변경`/`삭제`/`추가`. null 이면 장식(옆에 같은 문구가 있을 때) */
  title?: string | null;
  className?: string;
}

/** components.md 14.3. `square-dot`/`square-minus`/`square-plus`, 색 text.secondary. `same`은 그리지 않는다 */
export function DriftKindIcon({ kind, size = 14, title, className }: DriftKindIconProps) {
  const spec = DRIFT_KIND[kind];
  if (!spec.icon) return null;
  return (
    <Icon
      name={spec.icon}
      size={size}
      title={title === null ? undefined : (title ?? spec.short)}
      className={cx(styles.driftKindIcon, className)}
    />
  );
}

export interface DriftKindChipProps {
  kind: DriftKind;
  /** sm 20px | md 24px */
  size?: "sm" | "md";
  /** 있으면 링크 칩 (예 `?view=drift&res=…`) */
  href?: string;
  /** hover 툴팁 (예 `드리프트에서 보기`) */
  tooltip?: string;
  className?: string;
}

/** components.md 14.3. neutral 칩 + 사각 아이콘 + `변경됨`/`삭제됨`/`추가됨`/`같음`. 상태 색을 쓰지 않는다 */
export function DriftKindChip({ kind, size = "sm", href, tooltip, className }: DriftKindChipProps) {
  const spec = DRIFT_KIND[kind];
  const cls = cx(styles.kindChip, styles[`kindChip-${size}`], href && styles.kindChipLink, className);
  const inner = (
    <>
      {spec.icon ? <Icon name={spec.icon} size={size === "md" ? 14 : 12} className={styles.kindChipIcon} /> : null}
      <span>{spec.label}</span>
      {href && tooltip ? <span className="sr-only">, {tooltip}</span> : null}
    </>
  );
  const el = href ? (
    <Link href={href} className={cls} data-drift-kind={kind}>
      {inner}
    </Link>
  ) : (
    <span className={cls} data-drift-kind={kind}>
      {inner}
    </span>
  );
  return tooltip ? <Tooltip content={tooltip}>{el}</Tooltip> : el;
}

export interface DriftCountChipProps {
  /** 최신 스냅샷 차이 건수. 0 이하이면 그리지 않는다 */
  count: number;
  /** 예 `최신 스냅샷 드리프트: 차이 3건 (변경 2 · 삭제 1) · 15:12 계산` */
  tooltip?: ReactNode;
  className?: string;
}

/**
 * k8s-snapshot.md 2.3 / status.md 1.3: 탭의 드리프트 칩 `차이 3` (neutral, `git-compare`).
 * 상태 색·삼각형을 쓰지 않는다. 링크 안에 들어가므로 포커스를 받지 않는다(스크린리더 문구는 LinkTabs srText).
 */
export function DriftCountChip({ count, tooltip, className }: DriftCountChipProps) {
  if (!(count > 0)) return null;
  const chip = (
    <span className={cx(styles.kindChip, styles["kindChip-sm"], className)}>
      <Icon name="git-compare" size={12} className={styles.kindChipIcon} />
      <span>차이 {count.toLocaleString("en-US")}</span>
    </span>
  );
  return tooltip ? <Tooltip content={tooltip}>{chip}</Tooltip> : chip;
}
