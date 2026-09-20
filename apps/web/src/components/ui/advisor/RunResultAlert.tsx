"use client";

import { Button } from "../controls/Button";
import { Banner, type AlertTone } from "../feedback/Banner";
import { formatDurationTable, formatTime } from "../format";
import type { IconName } from "../icons";
import { CodeBlock } from "../layout/CodeBlock";
import { CommandLine } from "../layout/CommandLine";
import type { IsoTime } from "../types";
import styles from "./advisor.module.css";

/** CLAUDE.md 확정 한도: 타임아웃 600초, 지연 표시 300초 (서버 `run.limits` 가 없을 때 기본값) */
export const DEFAULT_ADVISOR_TIMEOUT_SEC = 600;
export const DEFAULT_ADVISOR_SLOW_AFTER_SEC = 300;

/** 한도(초) → `10분`, `5분`, `1분 30초`. 0 이하·숫자가 아니면 기본값으로 */
export function formatLimitSec(sec: number | null | undefined, fallbackSec: number): string {
  const v = typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? sec : fallbackSec;
  return formatDurationTable(v * 1000);
}

/** 받침 유무로 주격 조사 `이`/`가` (`10분이`, `1분 30초가`) */
export function withSubjectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}이(가)`;
  return `${word}${code % 28 === 0 ? "가" : "이"}`;
}

/**
 * API `failureReason` 값 그대로 + 취소(`status: cancelled` → `"cancelled"`).
 * docs/api/architecture-advisor.md A.9 / components.md 10.3
 */
export type RunFailReason =
  | "bridge_unavailable"
  | "login_required"
  | "usage_limit"
  | "timeout"
  | "invalid_response"
  | "budget_exceeded"
  | "interrupted"
  | "other"
  | "cancelled";

type Action = "recheck" | "retry" | "previewAndRetry" | null;

interface ReasonSpec {
  tone: AlertTone;
  icon: IconName;
  title: string;
  /** errorMessage 가 없을 때 쓰는 설명 */
  fallback?: string;
  /** 화면이 덧붙이는 고정 안내(caption) */
  guide?: string[];
  /** 기본 명령 줄 */
  command?: string;
  action: Action;
}

/** architecture-advisor.md 2.4 실패·취소 표 */
export const RUN_RESULT_SPEC: Record<RunFailReason, ReasonSpec> = {
  login_required: {
    tone: "warn",
    icon: "key-round",
    title: "분석 실패 · 로그인 필요",
    fallback: "호스트의 Claude Code 로그인이 만료됐습니다. 호스트 터미널에서 아래 명령으로 다시 로그인한 뒤 재시도하세요.",
    command: "claude",
    action: "recheck",
  },
  bridge_unavailable: {
    tone: "crit",
    icon: "unplug",
    title: "분석 실패 · 브리지 미실행",
    fallback: "어드바이저 브리지가 실행되고 있지 않습니다. 호스트에서 아래 명령으로 실행하세요.",
    command: "npm run dev --prefix apps/agent-bridge",
    action: "recheck",
  },
  usage_limit: {
    tone: "warn",
    icon: "hourglass",
    title: "분석 실패 · 사용량 한도",
    fallback: "Claude Code 사용량 한도에 도달했습니다.",
    action: null,
  },
  timeout: {
    tone: "crit",
    icon: "timer-off",
    /** `{limit}` 은 timeoutSec 으로 바뀐다 */
    title: "분석 실패 · 시간 초과 ({limit})",
    fallback: "브리지가 {limit} 안에 응답을 마치지 못했습니다.",
    action: "retry",
  },
  invalid_response: {
    tone: "crit",
    icon: "file-warning",
    title: "분석 실패 · 응답 형식 오류",
    fallback: "응답을 제안 형식으로 해석할 수 없었습니다.",
    action: "retry",
  },
  budget_exceeded: {
    tone: "warn",
    icon: "wallet",
    title: "분석 실패 · 비용 상한 초과",
    fallback: "분석 비용이 상한을 넘어 중단했습니다.",
    guide: [
      "스냅샷이 크거나 응답이 길어져 한 번의 분석 비용 상한에 닿았습니다. 보낼 데이터 크기를 확인하세요.",
      "상한은 설정 advisor.limits.maxBudgetUsd(기본 $2.00)에서 바꿀 수 있습니다. 구독 로그인이면 실제 청구가 아니라 사용량 보호용 상한입니다.",
    ],
    action: "previewAndRetry",
  },
  interrupted: {
    tone: "crit",
    icon: "rotate-ccw",
    title: "분석 실패 · 서버 재시작으로 중단",
    fallback: "API 서버가 재시작되어 분석이 중단됐습니다.",
    action: "retry",
  },
  cancelled: { tone: "neutral", icon: "square", title: "분석을 취소했습니다", action: "retry" },
  other: { tone: "crit", icon: "octagon-x", title: "분석 실패", action: "retry" },
};

/** 이력 표 `사유` 열 문구 (architecture-advisor.md 2.4 "사유" 칸). 목록 밖 값은 `기타` */
export const RUN_REASON_LABEL: Record<RunFailReason, string> = {
  login_required: "로그인 필요",
  bridge_unavailable: "브리지 미실행",
  usage_limit: "사용량 한도",
  timeout: "시간 초과",
  invalid_response: "응답 형식 오류",
  budget_exceeded: "비용 상한 초과",
  interrupted: "서버 재시작으로 중단",
  cancelled: "취소됨",
  other: "기타",
};

/** 목록 밖 값은 `other` */
export const toRunFailReason = (v: string | null | undefined): RunFailReason =>
  v && Object.prototype.hasOwnProperty.call(RUN_RESULT_SPEC, v) ? (v as RunFailReason) : "other";

export interface RunResultAlertProps {
  /** API `failureReason` 값 그대로. 취소는 `"cancelled"`. 목록 밖 값은 `기타`로 표시 */
  reason: RunFailReason | (string & {});
  /** 서버 `errorMessage` (가림 처리된 한 줄). 없으면 사유별 기본 문구 */
  message?: string | null;
  /** 명령 줄 (기본: login_required `claude`, bridge_unavailable 실행 명령) */
  command?: string | null;
  /** 형식 오류 원문 (hasRawResponse 일 때 프론트가 받아서 넘긴다). 접힌 디버그 영역, 텍스트로만 */
  rawResponse?: string | null;
  /** 사용량 한도 해제 시각 (서버 메시지에 없을 때) */
  retryAt?: IsoTime | null;
  /** 취소 시각 */
  cancelledAt?: IsoTime | null;
  /** 닫기 (지난 결과 화면에서는 생략) */
  onDismiss?: () => void;
  /** `다시 분석` — 자동 재시도 없음. 사용자가 누를 때만 */
  onRetry?: () => void;
  /** 브리지 연결됨이 아니면 true (+ 사유) */
  retryDisabled?: boolean;
  retryDisabledReason?: string;
  /** `다시 확인`(브리지) */
  onRecheck?: () => void;
  /** budget_exceeded 의 `보낼 데이터 보기` */
  onOpenPreview?: () => void;
  /** 서버 `run.limits.timeoutSec` (초). timeout 제목·기본 설명에 표시. 기본 600 → `10분` */
  timeoutSec?: number | null;
  className?: string;
}

/**
 * components.md 10.3 / architecture-advisor.md 2.4.
 * 서버 문구·원문 응답은 텍스트로만 렌더한다(원문은 <details> 안 CodeBlock).
 */
export function RunResultAlert({
  reason,
  message,
  command,
  rawResponse,
  retryAt,
  cancelledAt,
  onDismiss,
  onRetry,
  retryDisabled = false,
  retryDisabledReason,
  onRecheck,
  onOpenPreview,
  timeoutSec,
  className,
}: RunResultAlertProps) {
  const key = toRunFailReason(reason);
  const spec = RUN_RESULT_SPEC[key];
  const cmd = command ?? spec.command;
  const limit = formatLimitSec(timeoutSec, DEFAULT_ADVISOR_TIMEOUT_SEC);
  const fill = (t: string) => t.split("{limit}").join(limit);
  const title = fill(spec.title);

  let desc: string | undefined = message || (spec.fallback ? fill(spec.fallback) : undefined);
  if (key === "usage_limit" && retryAt) {
    desc = `${desc ?? ""} ${formatTime(retryAt, "shortTime")} 이후 다시 사용할 수 있습니다.`.trim();
  }
  if (key === "cancelled" && !message && cancelledAt) {
    desc = `${formatTime(cancelledAt, "autoShort")} 취소`;
  }

  const retryButton = onRetry ? (
    <Button
      variant="secondary"
      size="sm"
      icon="play"
      onClick={onRetry}
      disabled={retryDisabled}
      disabledReason={retryDisabledReason}
    >
      다시 분석
    </Button>
  ) : null;

  let actions = null;
  if (spec.action === "recheck" && onRecheck) {
    actions = (
      <Button variant="secondary" size="sm" icon="refresh-cw" onClick={onRecheck}>
        다시 확인
      </Button>
    );
  } else if (spec.action === "retry") {
    actions = retryButton;
  } else if (spec.action === "previewAndRetry" && (onOpenPreview || retryButton)) {
    actions = (
      <>
        {onOpenPreview ? (
          <Button variant="secondary" size="sm" icon="eye" onClick={onOpenPreview}>
            보낼 데이터 보기
          </Button>
        ) : null}
        {retryButton}
      </>
    );
  }

  return (
    <Banner
      tone={spec.tone}
      icon={spec.icon}
      title={title}
      className={className}
      live
      description={
        <div className={styles.resultDesc}>
          {desc ? <span suppressHydrationWarning>{desc}</span> : null}
          {spec.guide ? (
            <span className={styles.resultGuide}>
              {spec.guide.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </span>
          ) : null}
          {cmd && (key === "login_required" || key === "bridge_unavailable") ? <CommandLine command={cmd} /> : null}
          {key === "invalid_response" && rawResponse ? (
            <details className={styles.debug}>
              <summary>원문 응답 보기 (디버그)</summary>
              <CodeBlock code={rawResponse} language="원문 응답" wrap maxHeight={400} />
            </details>
          ) : null}
        </div>
      }
      actions={actions}
      dismissible={Boolean(onDismiss)}
      onDismiss={onDismiss}
    />
  );
}
