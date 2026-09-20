"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { CostKindBadge } from "../cost/CostKindBadge";
import { MoneyValue } from "../cost/MoneyValue";
import { cx } from "../cx";
import { InlineAlert } from "../feedback/Banner";
import { Icon } from "../icons";
import { CodeBlock } from "../layout/CodeBlock";
import { Tooltip } from "../overlay/Tooltip";
import { Chip } from "../status/Chip";
import type { AdvisorCategory, Severity } from "../types";
import { CategoryChip, NoExecuteNotice, RiskBadge, SeverityBadge, SourceLabel } from "./Labels";
import styles from "./advisor.module.css";

export interface SuggestionTarget {
  name: string;
  kind: string;
  /** 서버가 스냅샷과 대조해 준 경우만 링크 */
  href?: string;
  /** 스냅샷에 없는 리소스: 링크 없이 점선 + triangle-alert */
  missing?: boolean;
}

export interface SuggestionEvidence {
  text: string;
  /** 스냅샷 필드 경로 `nodes[batch].cpu.avg` */
  field?: string;
  /** 서버가 준 수치 `18%`. text 안에 있으면 그 부분만 굵게, 없으면 표시하지 않는다 */
  value?: string | null;
}

export interface SuggestionStep {
  text: string;
  code?: { language?: string; code: string };
}

export interface SuggestionCardProps {
  /** 1..N (1~3 은 accent 상자) */
  priority: number;
  title: string;
  category: AdvisorCategory;
  severity: Severity;
  targets: SuggestionTarget[];
  evidence: SuggestionEvidence[];
  /** 연결된 사전 점검 R-ID */
  linkedRules: string[];
  savings: { monthly: number; formula: string; source: "server" | "llm" } | null;
  steps: SuggestionStep[];
  risk: { level: Severity; reason: string };
  /** 적용 후 확인 방법 */
  verify?: string;
  /** 근거 확인 불가 */
  unverified?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** R-ID 칩 클릭 → 사전 점검 표의 해당 행으로 (없으면 칩은 표시만) */
  onRuleClick?: (ruleId: string) => void;
  className?: string;
}

/**
 * evidence 안의 value 를 굵게 (문자열 분할만, HTML·마크다운 해석 없음).
 * value 가 없거나 비었거나 문장에 없으면 문장만 그대로 보여 준다(값을 덧붙이지 않는다).
 * 문장에 여러 번 나오면 첫 번째만 굵게.
 */
export function EvidenceText({ text, value }: { text: string; value?: string | null }): ReactNode {
  const v = value?.trim();
  if (!v) return text;
  const i = text.indexOf(v);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <strong className={styles.evValue}>{v}</strong>
      {text.slice(i + v.length)}
    </>
  );
}

/**
 * components.md 10.8 / architecture-advisor.md 2.6.
 * **안전 렌더링**: 제목·근거·단계·코드·이유는 모두 React 텍스트 노드로만 넣는다
 * (dangerouslySetInnerHTML·마크다운 해석·URL 자동 링크 없음). 실행·적용 버튼 없음.
 */
export function SuggestionCard({
  priority,
  title,
  category,
  severity,
  targets,
  evidence,
  linkedRules,
  savings,
  steps,
  risk,
  verify,
  unverified = false,
  expanded,
  onToggle,
  onRuleClick,
  className,
}: SuggestionCardProps) {
  const id = useId();
  const bodyId = `${id}-body`;
  const titleId = `${id}-title`;
  const top3 = priority >= 1 && priority <= 3;
  const savingsKind = savings?.source === "llm" ? "llmEstimate" : "estimate";

  return (
    <article
      aria-labelledby={titleId}
      className={cx(styles.sugg, unverified && styles.suggUnverified, className)}
    >
      {/* 머리 전체 클릭으로도 펼친다(마우스 편의). 키보드는 오른쪽 버튼(aria-expanded) */}
      <div
        className={styles.suggHead}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button")) return;
          onToggle();
        }}
      >
        <span className={cx(styles.priority, top3 && styles.priorityTop)}>
          <span className="sr-only">우선순위 </span>
          {priority}
        </span>
        <div className={styles.suggHeadMain}>
          <div className={styles.suggLine1}>
            <CategoryChip category={category} size="sm" />
            <SeverityBadge severity={severity} size="sm" />
            {unverified ? <Chip label="근거 확인 불가" tone="warn" icon="triangle-alert" /> : null}
            <Tooltip content={title} className={styles.suggTitleWrap}>
              <h3 id={titleId} className={styles.suggTitle}>
                {title}
              </h3>
            </Tooltip>
            {savings ? (
              <span className={styles.suggSavings}>
                <MoneyValue amount={savings.monthly} kind={savingsKind} unit="month" size="md" />
                <CostKindBadge kind={savingsKind} detail={savings.source === "server" ? "서버 계산" : undefined} />
              </span>
            ) : null}
          </div>
          <div className={styles.suggLine2}>
            {targets.length > 0 ? (
              <span className={styles.suggTargetsSummary}>
                대상 <span className={styles.mono}>{targets[0].name}</span>
                {targets.length > 1 ? ` 외 ${targets.length - 1}` : ""}
              </span>
            ) : null}
            {targets.length > 0 ? <span aria-hidden="true">·</span> : null}
            <RiskBadge level={risk.level} variant="text" />
            {linkedRules.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  사전 점검{" "}
                  {linkedRules.map((r) => (
                    <span key={r} className={styles.ruleInline}>
                      {r}
                    </span>
                  ))}
                </span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <SourceLabel source="llm" />
          </div>
        </div>
        <IconButton
          icon="chevron-down"
          size="sm"
          label={expanded ? "제안 접기" : "제안 펼치기"}
          rotate={expanded ? 180 : 0}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          className={styles.suggToggle}
        />
      </div>

      <div id={bodyId} className={styles.suggBody} hidden={!expanded}>
        {expanded ? (
          <>
            {unverified ? (
              <InlineAlert
                tone="warn"
                compact
                title="스냅샷에 없는 리소스를 언급합니다. 내용을 그대로 믿지 마세요."
              />
            ) : null}

            {targets.length > 0 ? (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>대상</h4>
                <ul className={styles.targetList}>
                  {targets.map((t, i) => (
                    <li key={`${t.kind}-${t.name}-${i}`}>
                      {t.href && !t.missing ? (
                        <Link href={t.href} className={styles.targetChip}>
                          <span className={styles.targetKind}>{t.kind}</span>
                          {t.name}
                        </Link>
                      ) : (
                        <span className={cx(styles.targetChip, t.missing && styles.targetMissing)}>
                          {t.missing ? <Icon name="triangle-alert" size={12} title="스냅샷에 없는 리소스" /> : null}
                          <span className={styles.targetKind}>{t.kind}</span>
                          {t.name}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {evidence.length > 0 ? (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>근거</h4>
                <ul className={styles.evidence}>
                  {evidence.map((ev, i) => (
                    <li key={i}>
                      <EvidenceText text={ev.text} value={ev.value} />
                      {ev.field ? <span className={styles.evField}> ({ev.field})</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {savings ? (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>예상 월 절감액</h4>
                <div className={styles.savingsRow}>
                  <MoneyValue amount={savings.monthly} kind={savingsKind} unit="month" size="lg" />
                  <CostKindBadge kind={savingsKind} detail={savings.source === "server" ? "서버 계산" : undefined} />
                </div>
                <p className={styles.formula}>{savings.formula}</p>
                <p className={styles.savingsSource}>
                  {savings.source === "server" ? (
                    "서버 계산: aws-cost 단가 기준"
                  ) : (
                    <>
                      <Icon name="triangle-alert" size={12} className={styles.warnIcon} />
                      LLM 추정: 스냅샷 단가로 LLM이 계산한 값입니다. 검증하세요.
                    </>
                  )}
                </p>
              </div>
            ) : null}

            {steps.length > 0 ? (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>실행 방법</h4>
                <NoExecuteNotice />
                <ol className={styles.steps}>
                  {steps.map((s, i) => (
                    <li key={i} className={styles.stepItem}>
                      <span className={styles.stepNum} aria-hidden="true">
                        {i + 1}
                      </span>
                      <div className={styles.stepContent}>
                        <p className={styles.stepText}>{s.text}</p>
                        {s.code ? <CodeBlock code={s.code.code} language={s.code.language} /> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className={styles.block}>
              <h4 className={styles.blockTitle}>적용 위험도</h4>
              <p className={styles.riskRow}>
                <RiskBadge level={risk.level} />
                <span>{risk.reason}</span>
              </p>
            </div>

            {verify ? (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>적용 후 확인</h4>
                <p className={styles.bodyText}>{verify}</p>
              </div>
            ) : null}

            {linkedRules.length > 0 ? (
              <div className={styles.block}>
                <h4 className={styles.blockTitle}>연결된 사전 점검</h4>
                <ul className={styles.ruleList}>
                  {linkedRules.map((r) => (
                    <li key={r}>
                      {onRuleClick ? (
                        <button type="button" className={styles.ruleChip} onClick={() => onRuleClick(r)}>
                          <Icon name="ruler" size={12} />
                          {r}
                        </button>
                      ) : (
                        <span className={styles.ruleChip}>
                          <Icon name="ruler" size={12} />
                          {r}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </article>
  );
}
