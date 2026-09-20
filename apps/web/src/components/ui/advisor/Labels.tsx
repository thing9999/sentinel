import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { CATEGORY_LABEL, SEVERITY_LABEL, type AdvisorCategory, type Severity } from "../types";
import styles from "./advisor.module.css";

const SEVERITY_ICON: Record<Severity, IconName> = {
  high: "octagon-alert",
  medium: "triangle-alert",
  low: "info",
};

export interface SeverityBadgeProps {
  severity: Severity;
  /** StatusBadge 와 같은 치수: sm 20 / md 24px */
  size?: "sm" | "md";
  className?: string;
}

/** components.md 10.4. `높음`/`중간`/`낮음` + 아이콘(octagon-alert/triangle-alert/info), subtle 모양 */
export function SeverityBadge({ severity, size = "sm", className }: SeverityBadgeProps) {
  return (
    <span className={cx(styles.sevBadge, styles[`sevBadge-${size}`], styles[`sev-${severity}`], className)}>
      <span className="sr-only">심각도: </span>
      <Icon name={SEVERITY_ICON[severity]} size={size === "sm" ? 12 : 14} />
      <span>{SEVERITY_LABEL[severity]}</span>
    </span>
  );
}

/** 심각도 아이콘만 (분석 이력 `높음 2 · 중간 4` 앞 10px 등) */
export function SeverityIcon({ severity, size = 12 }: { severity: Severity; size?: 10 | 12 | 14 }) {
  return (
    <span className={cx(styles.sevIcon, styles[`sev-${severity}`])}>
      <Icon name={SEVERITY_ICON[severity]} size={size} title={SEVERITY_LABEL[severity]} />
    </span>
  );
}

export interface RiskBadgeProps {
  level: Severity;
  /** 텍스트형 옆에 붙는 이유 (outline 에서는 호출 측이 옆에 쓴다) */
  reason?: string;
  /** outline(md, 펼친 카드) | text(접힌 카드 2줄) */
  variant?: "outline" | "text";
  className?: string;
}

/**
 * components.md 10.5 적용 위험도. `위험도 낮음/중간/높음`, 아이콘 shield-alert 12px.
 * outline 모양(배경 투명)으로 심각도 배지와 모양이 다르다.
 */
export function RiskBadge({ level, reason, variant = "outline", className }: RiskBadgeProps) {
  return (
    <span
      className={cx(
        variant === "outline" ? styles.riskBadge : styles.riskText,
        styles[`sev-${level}`],
        className,
      )}
    >
      <Icon name="shield-alert" size={12} />
      <span>위험도 {SEVERITY_LABEL[level]}</span>
      {reason && variant === "text" ? <span className={styles.riskReason}> · {reason}</span> : null}
    </span>
  );
}

const CATEGORY_ICON: Record<AdvisorCategory, IconName> = {
  cost: "piggy-bank",
  reliability: "life-buoy",
  performance: "gauge",
  security: "shield",
  db: "database",
};

export interface CategoryChipProps {
  category: AdvisorCategory;
  size?: "sm" | "md";
  /** 토글 칩(FilterBar): 선택 시 accent 2px 테두리 */
  pressed?: boolean;
  onClick?: () => void;
  /** 토글 칩 개수 */
  count?: number;
  className?: string;
}

/** components.md 10.6. 비용 절감(piggy-bank)·안정성(life-buoy)·성능(gauge)·보안(shield)·DB(database) */
export function CategoryChip({ category, size = "sm", pressed, onClick, count, className }: CategoryChipProps) {
  const cls = cx(
    styles.catChip,
    styles[`catChip-${size}`],
    styles[`cat-${category}`],
    onClick && styles.catToggle,
    pressed && styles.catPressed,
    className,
  );
  const inner = (
    <>
      <Icon name={CATEGORY_ICON[category]} size={12} />
      <span>{CATEGORY_LABEL[category]}</span>
      {count !== undefined ? <span className={styles.catCount}>{count.toLocaleString("en-US")}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cls} aria-pressed={pressed ?? false} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <span className={cls}>{inner}</span>;
}

export interface SourceLabelProps {
  source: "rule" | "llm";
  /** `규칙 기반 · R-GP2` */
  ruleId?: string;
  /** ruleId 대신 보조 문구 (섹션 머리 `LLM 미사용`) */
  detail?: string;
  className?: string;
}

/** components.md 10.7. rule 은 채운 배경(ruler), llm 은 outline(sparkles `AI 제안`). 높이 20px */
export function SourceLabel({ source, ruleId, detail, className }: SourceLabelProps) {
  const extra = ruleId ?? detail;
  return (
    <span className={cx(styles.source, styles[`source-${source}`], className)}>
      <Icon name={source === "rule" ? "ruler" : "sparkles"} size={12} />
      <span>
        {source === "rule" ? "규칙 기반" : "AI 제안"}
        {extra ? (
          <>
            {" · "}
            <span className={ruleId ? styles.mono : undefined}>{extra}</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

export interface ExampleBadgeProps {
  /** 기본 `예시 응답` (분석 이력은 `예시`) */
  label?: string;
  className?: string;
}

/** status.md 2.4 어드바이저 예시 응답 배지(outline, mode.example*), 높이 20px, flask-conical 12px */
export function ExampleBadge({ label = "예시 응답", className }: ExampleBadgeProps) {
  return (
    <span className={cx(styles.example, className)}>
      <Icon name="flask-conical" size={12} />
      <span>{label}</span>
    </span>
  );
}

/** components.md 10.9 기본 문구 */
export const NO_EXECUTE_DEFAULT_TEXT = "대시보드는 실행하지 않습니다. 검토 후 직접 적용하세요.";

/**
 * components.md 10.9 / 15.4. `text`로 문구만 바꾼다(모양 그대로).
 * 예: 드리프트 탭 `대시보드는 kubectl 명령을 실행하지 않습니다. 적용 전 kubectl diff로 확인하세요.`
 */
export function NoExecuteNotice({ className, text }: { className?: string; text?: string }) {
  return (
    <p className={cx(styles.noExec, className)}>
      <Icon name="hand" size={16} />
      <span>{text && text.trim() !== "" ? text : NO_EXECUTE_DEFAULT_TEXT}</span>
    </p>
  );
}
