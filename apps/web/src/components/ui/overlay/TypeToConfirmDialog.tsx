"use client";

import { useState, type ReactNode } from "react";

import { TextField } from "../controls/TextField";
import { InlineAlert } from "../feedback/Banner";
import { Dialog } from "./Dialog";
import styles from "./overlay.module.css";

export interface TypeToConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** 입력해야 하는 값(스냅샷 ID). 앞뒤 공백을 뺀 입력이 **정확히** 같을 때만 확인 활성 */
  expected: string;
  /** 예 `확인을 위해 스냅샷 ID 20260915-101010을 입력하세요` (ID 는 호출 측이 <code> 등 mono 로) */
  inputLabel: ReactNode;
  /** `휴지통으로 이동` / `영구 삭제` */
  confirmLabel: string;
  /** `옮기는 중` / `삭제 중` */
  confirmLoadingLabel?: string;
  cancelLabel?: string;
  /** 일치 전 확인 버튼 비활성 사유, 기본 `스냅샷 ID를 입력하세요` */
  mismatchReason?: string;
  loading?: boolean;
  /** 본문 맨 위 InlineAlert crit (서버 거부 사유 등) */
  error?: ReactNode;
  onConfirm: () => void;
  /** 요약·파일 목록·안내 (입력 위) */
  children?: ReactNode;
  className?: string;
}

/** 앞뒤 공백을 뺀 값이 정확히 같은지 (대소문자·중간 공백 구분) */
export const matchesExpected = (input: string, expected: string) => input.trim() === expected;

/**
 * components.md 11.5 / aws-snapshot-manager.md 6.6·6.8.
 * Dialog md tone danger 기반. 열릴 때 입력에 포커스, 불일치 중에는 오류 문구 없이 확인 버튼만 aria-disabled + 사유.
 * Enter 는 일치할 때만 확인. 입력값은 열릴 때마다 비운다.
 */
export function TypeToConfirmDialog({
  open,
  onClose,
  title,
  description,
  expected,
  inputLabel,
  confirmLabel,
  confirmLoadingLabel,
  cancelLabel = "취소",
  mismatchReason = "스냅샷 ID를 입력하세요",
  loading = false,
  error,
  onConfirm,
  children,
  className,
}: TypeToConfirmDialogProps) {
  const [value, setValue] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue("");
  }
  const matched = matchesExpected(value, expected);
  const confirm = () => {
    if (!matched || loading) return;
    onConfirm();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      tone="danger"
      size="md"
      confirmLabel={confirmLabel}
      confirmLoadingLabel={confirmLoadingLabel}
      confirmLoading={loading}
      confirmDisabled={!matched}
      confirmDisabledReason={!matched ? mismatchReason : undefined}
      onConfirm={confirm}
      cancelLabel={cancelLabel}
      initialFocus="content"
      className={className}
    >
      <div className={styles.typeConfirm}>
        {error ? <InlineAlert tone="crit" title={error} live /> : null}
        {children}
        <TextField
          label={inputLabel}
          value={value}
          onChange={setValue}
          mono
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-autofocus=""
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              confirm();
            }
          }}
        />
      </div>
    </Dialog>
  );
}
