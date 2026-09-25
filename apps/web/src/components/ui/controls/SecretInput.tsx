"use client";

import { useId, type ReactNode } from "react";

import { cx } from "../cx";
import { formatMonthDay, formatTime } from "../format";
import { MaskedValue } from "../k8s/DiffValue";
import { Chip } from "../status/Chip";
import type { IsoTime } from "../types";
import { Button } from "./Button";
import styles from "./controls.module.css";
import { TextField } from "./TextField";

export type SecretInputMode = "idle" | "editing" | "saving";

export interface SecretInputProps {
  label: string;
  /** 저장돼 있는가 (서버 값) */
  configured: boolean;
  /** 서버가 준 가림 힌트 `…****7f3a`. **화면이 만들지 않는다** */
  hint?: string;
  /** `(119자)` */
  length?: number;
  updatedAt?: IsoTime;
  /** 잠금 사유에 쓸 환경 변수 이름. 있으면 입력·버튼 전부 비활성 + `lock` 칩 */
  lockedByEnv?: string;
  /**
   * (2026-09-25 추가) **저장할 수 없는** 상태 — 예: 대시보드 DB 없음(503, settings.md 6.3 "저장하는 컨트롤 전부 비활성").
   * 값·가림 힌트·저장 시각은 **그대로 보인다**(숨기지 않는다). 막는 것은 저장·바꾸기·지우기와 입력이다.
   * - 버튼은 네이티브 `disabled` 가 아니라 `aria-disabled` + **포커스 유지** + `disabledReason` 툴팁·`aria-describedby`
   *   (settings.md 9절 "비활성 버튼은 포커스 가능으로 두어 사유를 읽게 한다"). 입력칸은 `disabled`(잠김과 같은 모양).
   * - `lockedByEnv` 와 다르다: 잠김은 **.env 가 정한 값**이라 버튼 자리를 없애고 사유 문장을 남긴다.
   *   이것은 **지금 잠시** 저장할 수 없는 것이라 버튼을 그대로 두고 막는다(돌아오면 바로 누를 수 있게).
   * - 편집 중 `취소`(편집을 접기만 한다, 저장 아님)는 막지 않는다.
   */
  disabled?: boolean;
  /** `disabled` 사유(툴팁 + `aria-describedby`). 예: `대시보드 DB에 연결할 수 없어 저장할 수 없습니다.` */
  disabledReason?: string;
  mode?: SecretInputMode;
  /** **editing 일 때만.** 저장 성공 즉시 호출 측이 비운다 */
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  /** 서버 사유 한 줄. **입력값 원문을 되비추지 않는다**(AC-ALERT21) */
  error?: string;
  onSave?: () => void;
  /** 확인 Dialog 는 호출 측이 연다 */
  onClear?: () => void;
  onEdit?: () => void;
  /** 필드 아래 설명 */
  description?: ReactNode;
  /** 입력 도움말(미설정 상태의 `저장 후에는 다시 볼 수 없습니다.`) */
  inputHint?: ReactNode;
  className?: string;
}

const MASK_TOOLTIP = "저장된 값은 다시 볼 수 없습니다. 서버가 끝 4자만 알려 줍니다.";

/**
 * components.md 20.3 / settings.md 3.2. 웹훅 주소처럼 **저장 후 원문을 다시 보여주지 않는** 값 전용.
 *
 * - **"다시 보기" 버튼·눈 아이콘을 두지 않는다.** 서버가 원문을 주지 않으므로 보여 줄 값이 애초에 없고,
 *   눈 아이콘을 두면 "누르면 보일 것"이라는 거짓 약속이 된다(alerts 명세 3.4.3, AC-ALERT20).
 * - 입력은 `type="password"` 가 아니라 **`type="text"` + `autocomplete="off"` + `spellcheck=false`** 다:
 *   붙여넣기 확인이 목적이고 비밀번호 관리자에 잡히면 안 된다.
 * - 저장돼 있는지 아닌지는 **보인다**(가림 힌트 + 글자 수 + 저장 시각). 잠김도 숨기지 않는다 —
 *   숨기면 "기능이 사라졌다"로 읽힌다(settings.md 5절).
 */
export function SecretInput({
  label,
  configured,
  hint,
  length,
  updatedAt,
  lockedByEnv,
  disabled = false,
  disabledReason,
  mode = "idle",
  value = "",
  onChange,
  placeholder,
  error,
  onSave,
  onClear,
  onEdit,
  description,
  inputHint,
  className,
}: SecretInputProps) {
  const id = useId();
  const locked = Boolean(lockedByEnv);
  const saving = mode === "saving";
  const editing = !locked && (mode === "editing" || mode === "saving" || !configured);
  // 저장할 수 없는 동안의 버튼: aria-disabled(포커스 유지) + 사유
  const blockedReason = disabled ? disabledReason : undefined;

  const meta: string[] = [];
  if (length !== undefined) meta.push(`${length.toLocaleString("en-US")}자`);
  if (updatedAt) meta.push(`${formatMonthDay(updatedAt)} ${formatTime(updatedAt, "shortTime")} 저장`);

  return (
    <div
      className={cx(styles.secret, className)}
      data-mode={locked ? "locked" : editing ? mode : "configured"}
      data-disabled={disabled ? "true" : undefined}
    >
      {editing ? (
        <div className={styles.secretRow}>
          <TextField
            id={id}
            label={label}
            value={value}
            onChange={(v) => onChange?.(v)}
            placeholder={placeholder}
            error={error}
            hint={inputHint}
            mono
            disabled={saving || disabled}
            className={styles.secretField}
            // 비밀번호 관리자에 잡히지 않게. 붙여넣기 확인이 목적이라 type=password 가 아니다
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            data-testid="secret-input"
          />
          <div className={styles.secretActions}>
            <Button
              variant="primary"
              size="md"
              onClick={onSave}
              loading={saving}
              disabled={disabled}
              disabledReason={blockedReason}
            >
              저장
            </Button>
            {configured && onEdit ? (
              <Button variant="ghost" size="md" onClick={onEdit} disabled={saving}>
                취소
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={styles.secretRow}>
          <div className={styles.secretValue}>
            <span className={styles.secretLabel} id={`${id}-label`}>
              {label}
            </span>
            <span className={styles.secretValueRow}>
              {configured || locked ? (
                <MaskedValue text={hint ?? "저장됨"} tooltip={MASK_TOOLTIP} />
              ) : (
                <span className={styles.secretEmpty}>설정되지 않음</span>
              )}
              {locked ? <Chip label=".env로 고정됨" icon="lock" size="sm" /> : null}
            </span>
            {meta.length > 0 ? <span className={styles.secretMeta}>{meta.join(" · ")}</span> : null}
          </div>
          {!locked ? (
            <div className={styles.secretActions}>
              {onEdit ? (
                <Button variant="secondary" size="sm" onClick={onEdit} disabled={disabled} disabledReason={blockedReason}>
                  바꾸기
                </Button>
              ) : null}
              {onClear ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClear}
                  className={styles.secretClear}
                  disabled={disabled}
                  disabledReason={blockedReason}
                >
                  지우기
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      {locked ? (
        <p className={styles.secretNote}>
          {lockedByEnv} 환경 변수가 설정돼 있어 화면에서 바꿀 수 없습니다. 바꾸려면 .env를 고치고 api를 다시 띄우세요.
        </p>
      ) : null}
      {description ? <div className={styles.secretNote}>{description}</div> : null}
    </div>
  );
}
