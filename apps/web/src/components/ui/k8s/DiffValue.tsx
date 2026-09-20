"use client";

import { cx } from "../cx";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import styles from "./k8s.module.css";

/** 스칼라 값 (API JSON 그대로) */
export type DiffScalar = string | number | boolean | null;

/**
 * 필드 차이 값 = 계약 `DiffValue`(docs/api/k8s-snapshot.md) 그대로 (components.md 14절).
 * `null` = 값 없음 `(없음)`. 객체 조각은 오지 않는다(차이는 잎 단위).
 */
export type DiffValueData =
  | { kind: "scalar"; value: DiffScalar }
  | { kind: "list"; items: DiffScalar[] }
  /** 서버가 가린 문자열. 화면은 `text`만 쓴다(`preview`는 text 안에 이미 들어 있음) */
  | { kind: "masked"; text: string; preview: string }
  | null;

export const MASKED_DEFAULT_TOOLTIP = "운영 값이라 가립니다. 스냅샷 파일 쪽 원문은 파일 보기에서 확인하세요.";

export interface MaskedValueProps {
  /** 서버가 가린 문자열. 화면은 원문을 찾거나 다시 만들지 않는다 */
  text: string;
  tooltip?: string;
  className?: string;
}

/**
 * components.md 14.8 / status.md 10.5. neutral 상자 + 1px dashed border.default + `eye-off`.
 * warn 색을 쓰지 않는다(이 화면에서 warn 은 "차이 있음"). 복사 버튼 없음.
 */
export function MaskedValue({ text, tooltip = MASKED_DEFAULT_TOOLTIP, className }: MaskedValueProps) {
  return (
    <Tooltip content={tooltip} className={styles.maskedAnchor}>
      <span className={cx(styles.masked, className)} data-masked="true">
        <Icon name="eye-off" size={12} className={styles.fgTertiary} />
        <span className="sr-only">가린 값, </span>
        <span className={styles.maskedText}>{text}</span>
      </span>
    </Tooltip>
  );
}

/** 텍스트 줄 수 (CRLF·CR·LF) */
export function countLines(text: string): number {
  return text === "" ? 1 : text.split(/\r\n|\r|\n/).length;
}

/** 스칼라 표시 글자: 문자열은 따옴표 없이 그대로, 숫자·불리언·null 은 JSON 표기 */
export function scalarText(v: DiffScalar): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** 타입 표시 (`showType`) */
export function scalarTypeLabel(v: DiffScalar): string | null {
  if (typeof v === "string") return "문자열";
  if (typeof v === "number") return "숫자";
  if (typeof v === "boolean") return "불리언";
  return null;
}

/**
 * 두 값의 표시 글자가 같고 JSON 타입만 다른지 (`8080` ↔ `"8080"`). true 면 두 셀 모두 `showType`.
 */
export function differsOnlyByType(a: DiffValueData, b: DiffValueData): boolean {
  if (!a || !b || a.kind !== "scalar" || b.kind !== "scalar") return false;
  return scalarText(a.value) === scalarText(b.value) && typeof a.value !== typeof b.value;
}

/** 값이 차지하는 줄 수 (scalar 문자열 줄 / list 항목 수). `더 보기` 판단용 */
export function diffValueLines(v: DiffValueData): number {
  if (!v) return 1;
  if (v.kind === "list") return v.items.length;
  if (v.kind === "scalar" && typeof v.value === "string") return countLines(v.value);
  return 1;
}

export interface DiffValueProps {
  value: DiffValueData;
  /** 보이는 최대 줄(목록은 항목) 수, 기본 3. 넘으면 앞부분만 보이고 `더 보기 (N줄)` / `더 보기 (N개)` */
  maxLines?: number;
  /** 값 뒤 6px 에 `문자열`/`숫자`/`불리언` (두 값이 타입만 다를 때, `differsOnlyByType`) */
  showType?: boolean;
  /** `더 보기` 버튼 (없으면 버튼 없이 자른 채로 둔다 → 호출 측이 전체를 보일 곳을 마련할 것) */
  onExpand?: () => void;
  /** 확장 영역이 열려 있는지 (버튼 aria-expanded, 문구 `접기`) */
  expanded?: boolean;
  /** 버튼이 여는 확장 영역 id (aria-controls) */
  controlsId?: string;
  className?: string;
}

function TypeTag({ v }: { v: DiffScalar }) {
  const t = scalarTypeLabel(v);
  return t ? (
    <span className={styles.diffType}>
      <span className="sr-only">, </span>
      {t}
    </span>
  ) : null;
}

/**
 * components.md 14.7 / k8s-snapshot.md 6.7.
 * scalar: 문자열은 따옴표 없이 pre-wrap, 숫자·불리언은 JSON, `null` 값은 tertiary `null`. list: 항목마다 한 줄 `- `.
 * masked: MaskedValue(`text`만). `null`(값 없음): `(없음)`. 텍스트 노드로만 렌더(빨강·초록 강조 없음, 단위 변환 없음).
 */
export function DiffValue({
  value,
  maxLines = 3,
  showType = false,
  onExpand,
  expanded = false,
  controlsId,
  className,
}: DiffValueProps) {
  if (value === null) {
    return <span className={cx(styles.diffAbsent, className)}>(없음)</span>;
  }
  if (value.kind === "masked") {
    return <MaskedValue text={value.text} className={className} />;
  }
  const limit = Number.isFinite(maxLines) ? maxLines : Infinity;
  const moreButton = (total: number, unit: "줄" | "개") =>
    onExpand ? (
      <button
        type="button"
        className={styles.linkButton}
        onClick={onExpand}
        aria-expanded={expanded}
        aria-controls={controlsId}
      >
        {expanded ? "접기" : `더 보기 (${total.toLocaleString("en-US")}${unit})`}
      </button>
    ) : null;

  if (value.kind === "list") {
    const over = value.items.length > limit;
    const shown = over ? value.items.slice(0, limit) : value.items;
    return (
      <span className={cx(styles.diffValue, className)}>
        <span className={styles.diffList}>
          {shown.map((it, i) => (
            <span key={i} className={styles.diffListItem}>
              <span className={styles.diffBullet} aria-hidden="true">
                -{" "}
              </span>
              <span className={cx(styles.diffText, it === null && styles.diffNull)}>{scalarText(it)}</span>
            </span>
          ))}
          {over ? <span className="sr-only">(앞 {limit}개만 표시)</span> : null}
        </span>
        {over ? moreButton(value.items.length, "개") : null}
      </span>
    );
  }

  const v = value.value;
  const text = scalarText(v);
  const lines = typeof v === "string" ? text.split(/\r\n|\r|\n/) : [text];
  const over = lines.length > limit;
  const shown = over ? lines.slice(0, limit).join("\n") : text;
  return (
    <span className={cx(styles.diffValue, className)}>
      <span className={styles.diffScalar}>
        <span className={cx(styles.diffText, v === null && styles.diffNull)}>
          {shown}
          {over ? <span className="sr-only"> (앞 {limit}줄만 표시)</span> : null}
        </span>
        {showType ? <TypeTag v={v} /> : null}
      </span>
      {over ? moreButton(lines.length, "줄") : null}
    </span>
  );
}
