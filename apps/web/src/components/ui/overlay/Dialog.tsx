"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "../controls/Button";
import { cx } from "../cx";
import { ModalBase } from "./ModalBase";
import styles from "./overlay.module.css";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** 없으면 확인 버튼 없이 닫기만 */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** 확인 버튼 loading (예: `취소 중`) */
  confirmLoading?: boolean;
  /** loading 중 확인 버튼 문구 */
  confirmLoadingLabel?: string;
  cancelLabel?: string;
  /**
   * (2026-09-25 추가) 취소(닫기) 버튼 비활성 — 예: 테스트 발송 **전송 중**(settings.md 4.3 "`보내기` loading, `취소` 비활성,
   * 대화상자는 닫히지 않는다"). 버튼은 `aria-disabled`(포커스 유지). 이 동안에는 **Esc·배경 클릭으로도 닫히지 않는다**
   * (`onClose` 를 부르지 않는다) — 버튼만 막고 Esc 로 닫히면 같은 규칙이 두 갈래가 된다.
   */
  cancelDisabled?: boolean;
  /** 취소 비활성 사유: 툴팁 + aria-describedby. 예 `보내는 중에는 닫을 수 없습니다.` */
  cancelDisabledReason?: string;
  tone?: "default" | "danger";
  size?: "sm" | "md";
  /** 확인 버튼 비활성(aria-disabled, 포커스 가능) (components.md 12.6) */
  confirmDisabled?: boolean;
  /** 비활성 사유: 툴팁 + aria-describedby */
  confirmDisabledReason?: string;
  /**
   * 열릴 때 포커스. 기본: danger 는 `cancel`, 그 밖은 `confirm`(확인 버튼이 없으면 cancel).
   * `content`: 본문 안 `[data-autofocus]` → 첫 입력(input·textarea·select) → 첫 포커스 가능 요소 순.
   */
  initialFocus?: "cancel" | "confirm" | "content";
  /** 설명 아래 추가 내용 */
  children?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** components.md 5.4. 확인 대화상자(모달). 포커스는 브라우저 <dialog> 가 가둔다. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  onConfirm,
  confirmLoading = false,
  confirmLoadingLabel,
  cancelLabel = "닫기",
  cancelDisabled = false,
  cancelDisabledReason,
  tone = "default",
  size = "sm",
  confirmDisabled = false,
  confirmDisabledReason,
  initialFocus,
  children,
  className,
}: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const focusTarget: "cancel" | "confirm" | "content" =
    initialFocus ?? (tone === "danger" || !confirmLabel ? "cancel" : "confirm");
  const effectiveFocus = focusTarget === "confirm" && !confirmLabel ? "cancel" : focusTarget;

  useEffect(() => {
    if (!open || effectiveFocus !== "content") return;
    // ModalBase 의 showModal() 뒤에 실행된다(자식 effect 가 먼저). 본문 안 원하는 요소로 옮긴다
    const body = bodyRef.current;
    if (!body) return;
    const target =
      body.querySelector<HTMLElement>("[data-autofocus]") ??
      body.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])') ??
      body.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
  }, [open, effectiveFocus]);
  // 취소가 막힌 동안에는 Esc·배경 클릭도 닫지 않는다
  const requestClose = () => {
    if (!cancelDisabled) onClose();
  };
  return (
    <ModalBase
      open={open}
      onClose={requestClose}
      labelledBy={titleId}
      describedBy={description ? descId : undefined}
      className={cx(styles.dialog, styles[`dialog-${size}`], className)}
    >
      <div className={styles.dialogInner}>
        <h2 id={titleId} className={styles.dialogTitle}>
          {title}
        </h2>
        {description ? (
          <div id={descId} className={styles.dialogDesc}>
            {description}
          </div>
        ) : null}
        {children ? (
          <div ref={bodyRef} className={styles.dialogBody}>
            {children}
          </div>
        ) : null}
        <div className={styles.dialogActions}>
          <Button
            variant="secondary"
            onClick={requestClose}
            disabled={cancelDisabled}
            disabledReason={cancelDisabled ? cancelDisabledReason : undefined}
            autoFocus={effectiveFocus === "cancel"}
          >
            {cancelLabel}
          </Button>
          {confirmLabel ? (
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              onClick={onConfirm}
              loading={confirmLoading}
              disabled={confirmDisabled}
              disabledReason={confirmDisabled ? confirmDisabledReason : undefined}
              autoFocus={effectiveFocus === "confirm"}
            >
              {confirmLoading && confirmLoadingLabel ? confirmLoadingLabel : confirmLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </ModalBase>
  );
}
