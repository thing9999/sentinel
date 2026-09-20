"use client";

import type { ReactNode } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import type { ScanLevel } from "../types";
import { scanLevelSpec } from "./scan";
import styles from "./snapshot.module.css";

export interface ScanFinding {
  id: string;
  /** API 값 그대로 (`error` | `warn`). 그 밖의 값은 `알 수 없음` */
  level: ScanLevel | (string & {});
  file: string;
  line: number;
  ruleId: string;
  /** 서버가 가린 설명(원문 없음). 텍스트로만 렌더 */
  description: string;
  /** false 면 편집기로 이동할 수 없는 항목(metadata.json, 라벨·메모 파일): 버튼이 아니라 div */
  navigable: boolean;
  /** 비이동 항목 3줄 안내 (예 `metadata.json은 대시보드에서 편집할 수 없습니다`) */
  hint?: string;
  /** 비이동 항목 3줄 동작 (예 ghost sm `라벨·메모 편집`) */
  action?: ReactNode;
}

export interface ScanFindingListProps {
  /** 서버 순서 그대로 그린다(다시 정렬하지 않음) */
  findings: ScanFinding[];
  variant?: "default" | "compact";
  /** 선택 항목 → aria-current, bg.selected + 왼쪽 3px accent */
  selectedId?: string | null;
  /** navigable 항목을 눌렀을 때만 */
  onSelect?: (finding: ScanFinding) => void;
  /** 넘으면 `외 N건` */
  maxItems?: number;
  /** px, 넘치면 목록만 세로 스크롤 */
  maxHeight?: number;
  /** 목록 이름(스크린리더), 기본 `스캔 발견 목록` */
  label?: string;
  /**
   * components.md 15.3: 파일 표기(`data/statefulsets/postgres.yaml:41`)가 폭을 넘으면 가운데 말줄임.
   * 뒤쪽 `<파일 이름>:<줄>`을 남기고 툴팁에 전체 경로. 기본 false(AWS 는 파일 이름이 짧다).
   */
  truncateFile?: boolean;
  className?: string;
}

/** `a/b/c.yaml:41` → { head: `a/b/`, tail: `c.yaml:41` } (마지막 `/` 뒤를 보존) */
export function splitFileLocation(loc: string): { head: string; tail: string } {
  const i = loc.lastIndexOf("/");
  if (i < 0) return { head: "", tail: loc };
  return { head: loc.slice(0, i + 1), tail: loc.slice(i + 1) };
}

/** 스크린리더 문구: `오류, terraform.tf 212번째 줄, env-block, 환경 변수 블록을 여는 줄` */
export function findingAriaLabel(f: Pick<ScanFinding, "level" | "file" | "line" | "ruleId" | "description">): string {
  const spec = scanLevelSpec(f.level);
  return `${spec.label}, ${f.file} ${f.line.toLocaleString("en-US")}번째 줄, ${f.ruleId}, ${f.description}`;
}

/**
 * components.md 11.2. 목록은 <ul>, 이동 가능한 항목은 <button>(각 항목 하나의 탭 정지점), 비이동은 <div>.
 * 등급은 아이콘 모양 + 문구(`오류`/`경고`)로 표시한다(compact 는 문구를 스크린리더로만).
 */
export function ScanFindingList({
  findings,
  variant = "default",
  selectedId = null,
  onSelect,
  maxItems,
  maxHeight,
  label = "스캔 발견 목록",
  truncateFile = false,
  className,
}: ScanFindingListProps) {
  const shown = maxItems !== undefined && maxItems >= 0 ? findings.slice(0, maxItems) : findings;
  const rest = findings.length - shown.length;
  const compact = variant === "compact";
  const anyNavigable = shown.some((f) => f.navigable && onSelect);

  return (
    <div className={cx(styles.findings, compact && styles.findingsCompact, className)}>
      <ul
        className={styles.findingList}
        aria-label={label}
        style={maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: "auto" } : undefined}
        // 스크롤되는데 안에 포커스 가능한 항목이 없으면 목록 자체로 키보드 스크롤
        tabIndex={maxHeight && !anyNavigable ? 0 : undefined}
      >
        {shown.map((f) => {
          const spec = scanLevelSpec(f.level);
          const tone = styles[`lv-${spec.status}`];
          const selected = selectedId === f.id;
          const loc = `${f.file}:${f.line.toLocaleString("en-US").replace(/,/g, "")}`;
          const iconSize = compact ? 12 : 14;
          const locParts = truncateFile ? splitFileLocation(loc) : null;
          const locEl = locParts ? (
            <Tooltip content={loc} mono className={styles.findingLocTip}>
              <span className={cx(styles.findingLoc, styles.findingLocMiddle)}>
                {locParts.head ? <span className={styles.findingLocHead}>{locParts.head}</span> : null}
                <span className={styles.findingLocTail}>{locParts.tail}</span>
              </span>
            </Tooltip>
          ) : (
            <span className={styles.findingLoc}>{loc}</span>
          );
          const rule = <span className={styles.ruleId}>{f.ruleId}</span>;
          const desc = (
            <Tooltip content={f.description} className={styles.findingDescWrap} maxWidth={360}>
              <span className={styles.findingDesc}>{f.description}</span>
            </Tooltip>
          );
          const body = compact ? (
            <span className={styles.findingRow} aria-hidden="true">
              <Icon name={spec.icon} size={iconSize} className={tone} />
              {locEl}
              {rule}
              {desc}
            </span>
          ) : (
            <span className={styles.findingBody} aria-hidden="true">
              <span className={styles.findingRow}>
                <Icon name={spec.icon} size={iconSize} className={tone} />
                <span className={cx(styles.findingLevel, tone)}>{spec.label}</span>
                {locEl}
              </span>
              <span className={cx(styles.findingRow, styles.findingIndent)}>
                {rule}
                {desc}
              </span>
            </span>
          );
          const aria = findingAriaLabel(f);
          const navigable = f.navigable && Boolean(onSelect);
          return (
            <li key={f.id} className={styles.findingLi}>
              {navigable ? (
                <button
                  type="button"
                  className={cx(styles.finding, styles.findingButton, selected && styles.findingSelected)}
                  aria-label={aria}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect?.(f)}
                >
                  {body}
                </button>
              ) : (
                <div className={cx(styles.finding, selected && styles.findingSelected)} data-navigable="false">
                  <span className="sr-only">{aria}</span>
                  {body}
                  {!compact && (f.hint || f.action) ? (
                    <span className={cx(styles.findingExtra, styles.findingIndent)}>
                      {f.hint ? <span className={styles.findingHint}>{f.hint}</span> : null}
                      {f.action ? <span className={styles.findingAction}>{f.action}</span> : null}
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rest > 0 ? <p className={styles.findingMore}>외 {rest.toLocaleString("en-US")}건</p> : null}
    </div>
  );
}
