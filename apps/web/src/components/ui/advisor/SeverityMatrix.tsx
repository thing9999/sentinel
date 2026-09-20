"use client";

import type { ReactNode } from "react";

import { cx } from "../cx";
import { CATEGORY_LABEL, SEVERITY_LABEL, type AdvisorCategory, type Severity } from "../types";
import { CategoryChip, SeverityBadge } from "./Labels";
import styles from "./advisor.module.css";

const CATEGORIES: AdvisorCategory[] = ["cost", "reliability", "performance", "security", "db"];
const SEVERITIES: Severity[] = ["high", "medium", "low"];

export interface SeverityMatrixProps {
  cells: Record<AdvisorCategory, Record<Severity, number>>;
  onCellClick?: (category: AdvisorCategory, severity: Severity) => void;
  selected?: { category: AdvisorCategory; severity: Severity } | null;
  /** 아래 caption (`판단 보류 2건 (관측 23분)`) */
  footnote?: ReactNode;
  /** 표 제목(스크린리더), 기본 `사전 점검 요약` */
  caption?: string;
  className?: string;
}

/**
 * components.md 10.10. 5행 × 3열 + 합계 열. 셀 48×32px, 0이면 `—`(text.disabled),
 * 1 이상이면 숫자 + advisor.severity.<key>.bg. 셀은 필터 토글 버튼(aria-pressed).
 */
export function SeverityMatrix({
  cells,
  onCellClick,
  selected,
  footnote,
  caption = "사전 점검 요약",
  className,
}: SeverityMatrixProps) {
  return (
    <div className={cx(styles.matrixWrap, className)}>
      <div className={styles.matrixScroll}>
        <table className={styles.matrix}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">카테고리</span>
              </th>
              {SEVERITIES.map((s) => (
                <th key={s} scope="col" className={styles.matrixHead}>
                  <SeverityBadge severity={s} size="sm" />
                </th>
              ))}
              <th scope="col" className={cx(styles.matrixHead, styles.matrixTotalHead)}>
                합계
              </th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => {
              const row = cells[c] ?? { high: 0, medium: 0, low: 0 };
              const total = row.high + row.medium + row.low;
              return (
                <tr key={c}>
                  <th scope="row" className={styles.matrixRowHead}>
                    <CategoryChip category={c} size="sm" />
                  </th>
                  {SEVERITIES.map((s) => {
                    const n = row[s] ?? 0;
                    const isSel = selected?.category === c && selected?.severity === s;
                    return (
                      <td key={s} className={styles.matrixCellTd}>
                        {n === 0 ? (
                          <span className={cx(styles.matrixCell, styles.matrixZero)}>
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">0건</span>
                          </span>
                        ) : onCellClick ? (
                          <button
                            type="button"
                            className={cx(styles.matrixCell, styles[`matrix-${s}`], isSel && styles.matrixSelected)}
                            aria-pressed={isSel}
                            aria-label={`${CATEGORY_LABEL[c]} ${SEVERITY_LABEL[s]} ${n}건${isSel ? ", 필터 적용됨" : ""}`}
                            onClick={() => onCellClick(c, s)}
                          >
                            {n.toLocaleString("en-US")}
                          </button>
                        ) : (
                          <span className={cx(styles.matrixCell, styles[`matrix-${s}`])}>{n.toLocaleString("en-US")}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={cx(styles.matrixCellTd, styles.matrixTotal)}>{total.toLocaleString("en-US")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footnote ? <p className={styles.matrixFootnote}>{footnote}</p> : null}
    </div>
  );
}
