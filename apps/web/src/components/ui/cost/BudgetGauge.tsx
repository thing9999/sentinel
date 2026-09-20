import { cx } from "../cx";
import { formatMoney, formatPercent } from "../format";
import styles from "./cost.module.css";

export interface BudgetGaugeProps {
  budget: number;
  /** 확정 누적 */
  confirmed: number;
  /** 월말 예측 값 */
  projected: number | null;
  projectedKind: "forecast" | "estimate";
  /** 예측 구간 하한~상한 (막대 위 2px 가로선) */
  projectedRange?: { low: number; high: number };
  /** 주의 비율, 기본 0.9 (서버 값) */
  warnRatio?: number;
  /** 이번 달 경과율 0~1 */
  elapsedRatio: number;
  /** `19/30일` */
  elapsedLabel: string;
  className?: string;
}

const pos = (v: number, max: number) => `${Math.min(Math.max(v / max, 0), 1) * 100}%`;

/**
 * components.md 3.4 / status.md 3.3.
 * 눈금 최대값 = max(예산 × 1.2, 예측 상한). 채움1 확정 누적(실색), 채움2 누적→월말 예측(45° 빗금).
 * 90%·100% 표시선 + 라벨, 아래 한 줄 요약. 스크린리더에는 요약 문장 하나로 읽힌다.
 */
export function BudgetGauge({
  budget,
  confirmed,
  projected,
  projectedKind,
  projectedRange,
  warnRatio = 0.9,
  elapsedRatio,
  elapsedLabel,
  className,
}: BudgetGaugeProps) {
  const max = Math.max(budget * 1.2, projectedRange?.high ?? 0, projected ?? 0) || 1;
  const confirmedRatio = budget > 0 ? confirmed / budget : 0;
  const projectedRatio = projected !== null && budget > 0 ? projected / budget : null;
  const projectedName = projectedKind === "estimate" ? "추정 월말" : "예측";

  const summaryParts = [
    `누적 ${formatPercent(confirmedRatio)}`,
    projectedRatio !== null ? `${projectedName} ${formatPercent(projectedRatio)}` : null,
    `이번 달 경과 ${formatPercent(elapsedRatio)} (${elapsedLabel})`,
  ].filter(Boolean);

  const aria = `예산 ${formatMoney(budget, "total")} 대비 ${summaryParts.join(", ")}`;

  return (
    <div className={cx(styles.gauge, className)}>
      <div className={styles.gaugeArea} role="img" aria-label={aria}>
        {projectedRange ? (
          <span
            className={styles.gaugeRange}
            style={{
              left: pos(projectedRange.low, max),
              width: `calc(${pos(projectedRange.high, max)} - ${pos(projectedRange.low, max)})`,
            }}
          />
        ) : null}
        <span className={styles.gaugeTrack}>
          {projected !== null && projected > confirmed ? (
            <span
              className={cx(styles.gaugeProjected, projectedKind === "estimate" && styles.gaugeProjectedEstimate)}
              style={{ left: pos(confirmed, max), width: `calc(${pos(projected, max)} - ${pos(confirmed, max)})` }}
            />
          ) : null}
          <span className={styles.gaugeConfirmed} style={{ width: pos(confirmed, max) }} />
        </span>
        <span className={cx(styles.gaugeMark, styles.gaugeMarkWarn)} style={{ left: pos(budget * warnRatio, max) }}>
          <span className={cx(styles.gaugeMarkLabel, styles.gaugeMarkLabelEnd)}>{formatPercent(warnRatio)}</span>
        </span>
        <span className={cx(styles.gaugeMark, styles.gaugeMarkBudget)} style={{ left: pos(budget, max) }}>
          <span className={styles.gaugeMarkLabel}>예산 {formatMoney(budget, "total")}</span>
        </span>
      </div>
      <div className={styles.gaugeLegend} aria-hidden="true">
        <span className={styles.gaugeLegendItem}>
          <span className={cx(styles.gaugeSwatch, styles.gaugeSwatchConfirmed)} />
          확정 누적
        </span>
        {projected !== null ? (
          <span className={styles.gaugeLegendItem}>
            <span
              className={cx(
                styles.gaugeSwatch,
                styles.gaugeSwatchProjected,
                projectedKind === "estimate" && styles.gaugeProjectedEstimate,
              )}
            />
            {projectedKind === "estimate" ? "추정 월말" : "AWS 예측"}
          </span>
        ) : null}
      </div>
      <p className={styles.gaugeSummary} aria-hidden="true">
        {summaryParts.join(" · ")}
      </p>
    </div>
  );
}
