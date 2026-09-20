import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { APPROX, formatMoney, formatMoneyRange, formatMonthDay, formatTime, type MoneyUnit } from "../format";
import { Tooltip } from "../overlay/Tooltip";
import type { CostKind, IsoTime } from "../types";
import { CostKindBadge } from "./CostKindBadge";
import styles from "./cost.module.css";

export interface MoneyValueProps {
  /** null 이면 `—` + unknownReason 툴팁 */
  amount: number | null;
  kind: CostKind;
  unit: MoneyUnit;
  /** 부호 표시(+ / −) */
  delta?: boolean;
  /** sm table 13/20, md metricSm 16/24, lg metricMd 20/28, xl metricLg 28/36 */
  size?: "sm" | "md" | "lg" | "xl";
  /** 오른쪽 CostKindBadge */
  showBadge?: boolean;
  /** 배지 보조 문구 (`서버 계산`) */
  badgeDetail?: string;
  /** 조회 시각 → 툴팁 `HH:mm 조회` */
  asOf?: IsoTime;
  /** 확정 반영 기준일(ISO 날짜 또는 `9월 17일`) → 옆에 `9월 17일까지 반영 · 최대 24시간 지연` */
  settledThrough?: string;
  /** 예측 구간 → 아래 줄 `80% 구간 $790 – $900` */
  range?: { low: number; high: number; confidence: number };
  unknownReason?: string;
  /** 단위 접미사 표시(열 머리글에 단위가 있으면 false) */
  showUnit?: boolean;
  /** stale: 숫자를 status.stale.valueText 색으로 */
  stale?: boolean;
  loading?: boolean;
  /** 툴팁 문구를 직접 지정 */
  tooltip?: string;
  className?: string;
}

const SKELETON_W = { sm: 80, md: 96, lg: 120, xl: 160 } as const;
const SKELETON_H = { sm: 13, md: 16, lg: 20, xl: 28 } as const;

function settledText(v: string): string {
  const label = /^\d{4}-\d{2}-\d{2}/.test(v) ? formatMonthDay(v) : v;
  return `${label}까지 반영 · 최대 24시간 지연`;
}

/**
 * components.md 3.1 / status.md 3.1~3.2.
 * 추정(estimate, llmEstimate)은 `≈ ` 접두(cost.estimate.fg), 숫자 본체는 text.primary. 기울임 없음.
 * 추정 금액 툴팁은 필수: `공시 단가 기준, 할인·데이터 전송비 미포함 · 13:05 조회`.
 */
export function MoneyValue({
  amount,
  kind,
  unit,
  delta = false,
  size = "md",
  showBadge = false,
  badgeDetail,
  asOf,
  settledThrough,
  range,
  unknownReason,
  showUnit = true,
  stale = false,
  loading = false,
  tooltip,
  className,
}: MoneyValueProps) {
  if (loading) {
    return (
      <span className={cx(styles.money, className)} aria-busy="true">
        <Skeleton width={SKELETON_W[size]} height={SKELETON_H[size]} />
      </span>
    );
  }

  const isEstimate = kind === "estimate" || kind === "llmEstimate";
  const asOfText = asOf ? `${formatTime(asOf, "shortTime")} 조회` : null;
  const tip =
    tooltip ??
    (amount === null
      ? unknownReason
      : isEstimate
        ? kind === "llmEstimate"
          ? `LLM이 계산한 추정값입니다. 검증하세요.${asOfText ? ` · ${asOfText}` : ""}`
          : `공시 단가 기준, 할인·데이터 전송비 미포함${asOfText ? ` · ${asOfText}` : ""}`
        : (asOfText ?? undefined));

  const number =
    amount === null ? (
      <span className={styles.moneyNumber}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">알 수 없음{unknownReason ? ` (${unknownReason})` : ""}</span>
      </span>
    ) : (
      <span className={styles.moneyNumber}>
        {isEstimate ? (
          <>
            <span className={styles.approx} aria-hidden="true">
              {APPROX}{" "}
            </span>
            <span className="sr-only">추정 약 </span>
          </>
        ) : null}
        {formatMoney(amount, unit, { delta, showUnit })}
      </span>
    );

  return (
    <span className={cx(styles.money, styles[`money-${size}`], stale && styles.moneyStale, className)}>
      <span className={styles.moneyMain}>
        {tip ? (
          <Tooltip content={tip} className={styles.moneyTip}>
            {number}
          </Tooltip>
        ) : (
          number
        )}
        {showBadge ? <CostKindBadge kind={kind} detail={badgeDetail} /> : null}
        {settledThrough ? (
          <span className={styles.moneyAside} suppressHydrationWarning>
            {settledText(settledThrough)}
          </span>
        ) : null}
      </span>
      {range ? (
        <span className={styles.moneyRange}>
          <RangeText low={range.low} high={range.high} confidence={range.confidence} unit={unit} />
        </span>
      ) : null}
    </span>
  );
}

function RangeText({
  low,
  high,
  confidence,
  unit,
}: {
  low: number;
  high: number;
  confidence: number;
  unit: MoneyUnit;
}) {
  return (
    <>
      {Math.round(confidence * 100)}% 구간 {formatMoneyRange(low, high, unit === "month" ? "month" : "total")}
    </>
  );
}

export interface RangeValueProps {
  low: number;
  high: number;
  /** 0.8 → `80% 구간` */
  confidence: number;
  kind?: CostKind;
  unit?: "month" | "total";
  className?: string;
}

/** components.md 3.5. 월말 예측 `80% 구간 $790 – $900` (caption) */
export function RangeValue({ low, high, confidence, kind = "forecast", unit = "total", className }: RangeValueProps) {
  return (
    <span className={cx(styles.rangeValue, styles[`rangeKind-${kind}`], className)}>
      <RangeText low={low} high={high} confidence={confidence} unit={unit} />
    </span>
  );
}
