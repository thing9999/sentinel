"use client";

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import styles from "./controls.module.css";

interface FieldCommon {
  /** 필드 위 captionStrong text.secondary (ReactNode: 라벨 안에 mono ID 등) */
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /**
   * JS 문자열 길이 상한. 넘는 입력(붙여넣기 포함)은 잘라 넣지 않고 **받지 않는다**(onChange 호출 안 함).
   * 대신 onOverflow 를 부르니 호출 측이 `error` 문구를 띄운다.
   */
  maxLength?: number;
  /** 상한을 넘는 입력을 거부했을 때 (시도한 값의 길이) */
  onOverflow?: (attemptedLength: number) => void;
  /** 필드 아래 오른쪽 `12/60` (상한 도달 시 status.warn.fg). maxLength 필요 */
  showCount?: boolean;
  placeholder?: string;
  /** 필드 아래 왼쪽 caption text.secondary (error 가 있으면 error 가 대신) */
  hint?: ReactNode;
  /** 필드 아래 왼쪽 caption danger.default + octagon-x 12px, 테두리 danger.default, aria-invalid */
  error?: ReactNode;
  /** 오류 문구 없이 테두리만 status.crit.border + aria-invalid (비밀값 거부: 문구는 창 위 InlineAlert) */
  invalid?: boolean;
  /** 글자 code 13/20 mono (ID 입력) */
  mono?: boolean;
  disabled?: boolean;
  /** 라벨을 화면에서 숨기고 스크린리더에만 */
  hideLabel?: boolean;
  id?: string;
  className?: string;
}

type FieldKeys =
  | "value"
  | "onChange"
  | "maxLength"
  | "placeholder"
  | "disabled"
  | "id"
  | "className"
  | "size";

export interface TextFieldProps extends FieldCommon, Omit<InputHTMLAttributes<HTMLInputElement>, FieldKeys> {
  ref?: Ref<HTMLInputElement>;
}

export interface TextAreaProps
  extends FieldCommon,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, FieldKeys | "rows"> {
  /** 기본 7 */
  rows?: number;
  /** px, 기본 144 */
  minHeight?: number;
  /** px, 기본 320 (세로 크기 조절 범위) */
  maxHeight?: number;
  ref?: Ref<HTMLTextAreaElement>;
}

function useFieldParts(p: Omit<FieldCommon, "placeholder" | "disabled" | "className">) {
  const autoId = useId();
  const id = p.id ?? autoId;
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const len = p.value.length;
  const atLimit = p.maxLength !== undefined && len >= p.maxLength;
  const invalid = Boolean(p.error) || Boolean(p.invalid);
  const showCount = Boolean(p.showCount && p.maxLength !== undefined);
  const hasHint = Boolean(p.error || p.hint);
  const describedBy = [hasHint ? hintId : null, showCount ? countId : null].filter(Boolean).join(" ");

  const accept = (next: string) => {
    // 상한을 넘는 입력은 거부(줄이는 편집은 항상 허용)
    if (p.maxLength !== undefined && next.length > p.maxLength && next.length > p.value.length) {
      p.onOverflow?.(next.length);
      return;
    }
    p.onChange(next);
  };

  const labelEl = (
    <label htmlFor={id} className={cx(styles.fieldLabel, p.hideLabel && "sr-only")}>
      {p.label}
    </label>
  );

  const foot =
    hasHint || showCount ? (
      <div className={styles.fieldFoot}>
        {p.error ? (
          <span id={hintId} className={styles.fieldError}>
            <Icon name="octagon-x" size={12} />
            <span>{p.error}</span>
          </span>
        ) : p.hint ? (
          <span id={hintId} className={styles.fieldHint}>
            {p.hint}
          </span>
        ) : (
          <span />
        )}
        {showCount ? (
          <span id={countId} className={cx(styles.fieldCount, atLimit && styles.fieldCountLimit)}>
            <span aria-hidden="true">
              {len.toLocaleString("en-US")}/{p.maxLength!.toLocaleString("en-US")}
            </span>
            <span className="sr-only">
              {p.maxLength!.toLocaleString("en-US")}자 중 {len.toLocaleString("en-US")}자
            </span>
          </span>
        ) : null}
      </div>
    ) : null;

  const controlClass = cx(
    styles.fieldControl,
    p.mono && styles.fieldMono,
    p.error ? styles.fieldInvalid : p.invalid && styles.fieldInvalidCrit,
  );

  const mergeDescribedBy = (own: unknown) => [own, describedBy].filter(Boolean).join(" ") || undefined;

  return { id, accept, labelEl, foot, controlClass, invalid, mergeDescribedBy };
}

/**
 * components.md 11.4. 높이 32px, 패딩 0 12px, body 14/20. focus: accent 테두리 + shadow.focus.
 * 오류·카운터는 필드 아래 한 줄(16px, 위 4px)에 좌우로.
 */
export function TextField({
  label,
  value,
  onChange,
  maxLength,
  onOverflow,
  showCount,
  placeholder,
  hint,
  error,
  invalid,
  mono,
  disabled = false,
  hideLabel,
  id,
  className,
  ref,
  type = "text",
  ...rest
}: TextFieldProps) {
  const f = useFieldParts({
    label,
    value,
    onChange,
    maxLength,
    onOverflow,
    showCount,
    hint,
    error,
    invalid,
    mono,
    hideLabel,
    id,
  });
  return (
    <div className={cx(styles.field, disabled && styles.fieldDisabled, className)}>
      {f.labelEl}
      <input
        {...rest}
        ref={ref}
        id={f.id}
        type={type}
        className={cx(f.controlClass, styles.fieldInput)}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={f.invalid || undefined}
        aria-describedby={f.mergeDescribedBy(rest["aria-describedby"])}
        onChange={(e) => f.accept(e.target.value)}
      />
      {f.foot}
    </div>
  );
}

/** components.md 11.4 TextArea: 패딩 8px 12px, 기본 7줄(144px), 세로 크기 조절만(144~320px). */
export function TextArea({
  label,
  value,
  onChange,
  maxLength,
  onOverflow,
  showCount,
  placeholder,
  hint,
  error,
  invalid,
  mono,
  disabled = false,
  hideLabel,
  id,
  className,
  ref,
  rows = 7,
  minHeight = 144,
  maxHeight = 320,
  style,
  ...rest
}: TextAreaProps) {
  const f = useFieldParts({
    label,
    value,
    onChange,
    maxLength,
    onOverflow,
    showCount,
    hint,
    error,
    invalid,
    mono,
    hideLabel,
    id,
  });
  return (
    <div className={cx(styles.field, disabled && styles.fieldDisabled, className)}>
      {f.labelEl}
      <textarea
        {...rest}
        ref={ref}
        id={f.id}
        rows={rows}
        className={cx(f.controlClass, styles.fieldTextarea)}
        style={{ ...style, minHeight: `${minHeight}px`, maxHeight: `${maxHeight}px` }}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={f.invalid || undefined}
        aria-describedby={f.mergeDescribedBy(rest["aria-describedby"])}
        onChange={(e) => f.accept(e.target.value)}
      />
      {f.foot}
    </div>
  );
}
