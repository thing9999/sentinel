import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { COST_KIND_LABEL, type CostKind } from "../types";
import styles from "./cost.module.css";

const KIND_ICON: Record<CostKind, IconName> = {
  estimate: "calculator",
  confirmed: "receipt",
  forecast: "trending-up",
  llmEstimate: "sparkles",
};

export interface CostKindBadgeProps {
  kind: CostKind;
  /** 문구 뒤 보조 (예: `서버 계산` → `추정 · 서버 계산`) */
  detail?: string;
  /** 20px 고정 */
  size?: "sm";
  className?: string;
}

/**
 * components.md 3.2 / status.md 3.1. `추정`(calculator, dashed) / `확정`(receipt) / `AWS 예측`(trending-up) / `LLM 추정`(sparkles, dashed)
 */
export function CostKindBadge({ kind, detail, className }: CostKindBadgeProps) {
  return (
    <span className={cx(styles.kindBadge, styles[`kind-${kind}`], className)}>
      <Icon name={KIND_ICON[kind]} size={12} />
      <span className={styles.kindText}>
        {COST_KIND_LABEL[kind]}
        {detail ? ` · ${detail}` : ""}
      </span>
    </span>
  );
}
