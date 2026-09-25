"use client";

/**
 * 가림 규칙 팝오버 (docs/design/logs.md 7.3, logs 계약 3.3).
 *
 * `LogLineList`가 sticky gutter 요소를 `anchor`로 넘겨 주므로 **클릭 순간 그 요소의 위치**를 재서 띄운다 —
 * 가로로 스크롤해도 표식과 팝오버가 어긋나지 않는다(퍼블리셔 요청 7).
 *
 * 지키는 것:
 * - **`rules[].label`만 그린다.** `id`(`conn_string` 같은 값)는 화면에 내보내지 않고 `sr-only`에도 넣지 않는다
 *   (designer 2026-09-25: 매핑 표를 화면이 들면 규칙이 늘 때 코드가 사용자에게 보인다).
 * - **규칙 개수를 숫자로 박지 않는다.** 서버가 준 목록을 그대로 나열한다.
 * - **원문 보기·복사 버튼·`kubectl logs` 명령 상자가 없다**(PM 결정 Q2·Q10). 맨 아래 `LOG_REDACTION_NO_RAW` 한 줄뿐이다.
 */
import { useEffect } from "react";

import { Chip, LOG_CONFIDENCE_LABEL, LOG_REDACTION_NO_RAW, type LogLine, type LogRuleRef } from "@/components/ui";
import { placeFloating } from "@/components/ui/hooks";

import styles from "./logs.module.css";

export interface RedactionTarget {
  rules: { label: string; confidence: "high" | "suspect" }[];
  top: number;
  left: number;
  /** 포커스를 돌려줄 요소 (Esc) */
  anchor: HTMLElement;
}

const WIDTH = 320;
const ROW_HEIGHT = 24;
const CHROME_HEIGHT = 72;

/** 줄에서 가림 규칙을 순서대로 모은다(중복 제거). 확신 등급은 조각에 붙어 온다 */
export function redactionRulesOf(line: LogLine): { label: string; confidence: "high" | "suspect" }[] {
  const out: { label: string; confidence: "high" | "suspect" }[] = [];
  for (const seg of line.segments) {
    if (seg.t !== "masked") continue;
    for (const r of seg.rules) {
      const label = typeof r === "string" ? r : (r as LogRuleRef).label;
      const confidence = typeof r === "string" ? seg.confidence : ((r as LogRuleRef).confidence ?? seg.confidence);
      if (!label || out.some((x) => x.label === label)) continue;
      out.push({ label, confidence });
    }
  }
  return out;
}

/** 클릭 순간(이벤트 핸들러)에 자리를 계산한다 — 렌더·이펙트에서 상태를 다시 만들지 않는다 */
export function redactionTargetAt(line: LogLine, anchor: HTMLElement): RedactionTarget {
  const rules = redactionRulesOf(line);
  const rect = anchor.getBoundingClientRect();
  const height = Math.min(400, rules.length * ROW_HEIGHT + CHROME_HEIGHT);
  const { top, left } = placeFloating(rect, { width: WIDTH, height }, "bottom", "start", 6);
  return { rules, top, left, anchor };
}

export function RedactionRulesPopover({ target, onClose }: { target: RedactionTarget | null; onClose: () => void }) {
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
      target.anchor.focus?.();
    };
    const onDown = (e: MouseEvent) => {
      const el = e.target as Node;
      if (target.anchor.contains(el)) return;
      if ((el as Element).closest?.(`.${styles.redactPopover}`)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onClose);
    // 스크롤하면 앵커가 움직이므로 닫는다(자리가 어긋난 팝오버를 남기지 않는다)
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [target, onClose]);

  if (!target) return null;
  return (
    <div
      role="dialog"
      aria-label="가림 규칙"
      className={styles.redactPopover}
      style={{ width: WIDTH, top: target.top, left: target.left }}
    >
      <ul className={styles.redactList}>
        {target.rules.map((r) => (
          <li key={r.label} className={styles.redactRow}>
            <span>{r.label}</span>
            <Chip size="sm" tone="neutral" label={LOG_CONFIDENCE_LABEL[r.confidence]} />
          </li>
        ))}
      </ul>
      <p className={styles.redactNote}>{LOG_REDACTION_NO_RAW}</p>
    </div>
  );
}
