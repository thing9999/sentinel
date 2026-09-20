"use client";

/**
 * Cost Explorer 수동 새로고침 (docs/api/aws-cost.md 5.2·5.3, docs/design/aws-cost.md 2.7).
 * - 버튼 활성·사유는 서버 `refresh.canRefresh`·`disabledReason`·`nextAvailableAt` 그대로.
 * - 확인창(디자인 2.7 확정 문구): 금액·호출 수·시각은 모두 서버 필드를 포맷만 한다(화면에서 계산하지 않음).
 * - POST 202: 조회 시작(결과는 cost.actual.updated·cost.refresh.updated 로 온다).
 * - 429 CE_REFRESH_COOLDOWN / CE_DAILY_LIMIT_REACHED: details 의 다음 가능·초기화 시각으로 안내.
 * - 브라우저는 AWS 를 직접 부르지 않는다(항상 API 경유).
 */
import { useState } from "react";

import { Button, CostKindBadge, Dialog, formatCount, formatDurationTable, formatMoney, formatTime, InlineAlert } from "@/components/ui";
import { useNow } from "@/components/ui/hooks";
import { apiFetch } from "@/lib/api";

import { errorBody } from "../common/hooks";
import type { CeRefresh } from "./types";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 초기화·가능 시각: 오늘이면 `HH:mm`, 내일이면 `내일 HH:mm`, 그 밖은 `9월 20일 09:00` (로컬 시각, 표기만) */
export function dayRelativeTime(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const n = new Date(now);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, n)) return hm;
  const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  if (sameDay(d, tomorrow)) return `내일 ${hm}`;
  return formatTime(d, "autoShort", now);
}

/** 금액 2자리, $0.01 미만은 `<$0.01` (status.md 3.2) */
const usd2 = (v: number) => formatMoney(v, "hour", { showUnit: false });

export function refreshDisabledText(r: CeRefresh): string | undefined {
  switch (r.disabledReason) {
    case "cooldown":
      return r.nextAvailableAt ? `${formatTime(r.nextAvailableAt, "autoShort")} 이후 가능 (마지막 호출 후 ${formatDurationTable(r.cooldownSec * 1000)})` : "잠시 뒤 가능";
    case "daily_limit":
      return `오늘 호출 한도 도달 (${formatCount(r.todayCalls)}/${formatCount(r.dailyLimit)}회) · 캐시 사용 중`;
    case "mock":
      return "MOCK 모드: AWS를 호출하지 않습니다";
    case "in_progress":
      return "조회 중";
    case "not_configured":
      return "AWS 자격 증명·리전 설정 없음";
    default:
      return undefined;
  }
}

/** 429·409·503 → 섹션 머리 아래 InlineAlert 문구 (디자인 2.7) */
export function refreshErrorText(e: unknown, now: number = Date.now()): string {
  const body = errorBody(e);
  if (!body) return "새로고침을 요청하지 못했습니다.";
  const d = (body.details ?? {}) as { nextAvailableAt?: string; resetsAt?: string; todayCalls?: number; dailyLimit?: number };
  switch (body.code) {
    case "CE_REFRESH_COOLDOWN":
      return d.nextAvailableAt ? `지금은 조회할 수 없습니다 · ${dayRelativeTime(d.nextAvailableAt, now)} 이후 가능` : body.message;
    case "CE_DAILY_LIMIT_REACHED": {
      const count =
        typeof d.todayCalls === "number" && typeof d.dailyLimit === "number" ? ` (${formatCount(d.todayCalls)}/${formatCount(d.dailyLimit)}회)` : "";
      const reset = d.resetsAt ? ` · ${dayRelativeTime(d.resetsAt, now)} 초기화` : "";
      return `오늘 호출 한도에 도달했습니다${count}${reset}`;
    }
    default:
      return body.message;
  }
}

/** 확인창 본문 (디자인 2.7 확정 문구). 서버 필드를 포맷만 한다 */
export function RefreshConfirmBody({ r, now }: { r: CeRefresh; now: number }) {
  const est = r.refreshEstimatedCostUsd;
  return (
    <div className="stack-sm">
      {est !== null && est !== undefined ? (
        <p className="row gap-1-5" style={{ margin: 0 }}>
          <span className="text-strong">예상 비용 최대 {usd2(est)}</span>
          <CostKindBadge kind="estimate" />
          {typeof r.maxCallsPerRefresh === "number" ? <span className="text-caption-tertiary">호출 최대 {formatCount(r.maxCallsPerRefresh)}회</span> : null}
        </p>
      ) : (
        <p className="text-strong" style={{ margin: 0 }}>
          호출당 {usd2(r.callCostUsd)}
        </p>
      )}
      <p className="text-caption" style={{ margin: 0, font: "var(--font-body)" }}>
        이번 달 Cost Explorer 호출 {formatCount(r.monthCalls)}회{r.monthCallCost ? ` · ≈ ${usd2(r.monthCallCost.amountUsd)}` : ""}
      </p>
      <p className="text-caption" style={{ margin: 0, font: "var(--font-body)" }} suppressHydrationWarning>
        오늘 {formatCount(r.todayCalls)} / {formatCount(r.dailyLimit)}회 사용{r.dailyResetAt ? ` · ${dayRelativeTime(r.dailyResetAt, now)} 초기화` : ""}
      </p>
      <p className="text-caption-tertiary" style={{ margin: 0 }} suppressHydrationWarning>
        조회하면 {formatDurationTable(r.cooldownSec * 1000)} 동안 다시 새로고침할 수 없습니다.
        {r.nextScheduledAt ? ` 자동 조회는 ${formatTime(r.nextScheduledAt, "autoShort", now)}에 예정되어 있습니다.` : ""}
      </p>
    </div>
  );
}

export function CeRefreshButton({
  refresh,
  onUpdated,
  onNotice,
}: {
  refresh: CeRefresh;
  onUpdated?: (r: CeRefresh) => void;
  /** 오류 안내를 섹션 머리 아래에 그리려면 넘긴다(없으면 버튼 아래에 그린다) */
  onNotice?: (text: string | null) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const now = useNow(30_000);
  const [pending, setPending] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  // POST 응답의 refresh 는 스트림 값이 바뀔 때까지만 쓴다(cost.refresh.updated 가 오면 그것이 우선)
  const [local, setLocal] = useState<{ value: CeRefresh; base: CeRefresh } | null>(null);
  const r = local && local.base === refresh ? local.value : refresh;
  const inProgress = r.state === "refreshing" || pending;
  const reason = refreshDisabledText(r);
  const setError = (t: string | null) => {
    if (onNotice) onNotice(t);
    else setErrorState(t);
  };

  const run = async () => {
    setConfirm(false);
    setPending(true);
    setError(null);
    try {
      const res = await apiFetch<{ accepted: boolean; refresh: CeRefresh }>("/cost/explorer/refresh", { method: "POST", body: {} });
      if (res?.refresh) {
        setLocal({ value: res.refresh, base: refresh });
        onUpdated?.(res.refresh);
      }
    } catch (e) {
      setError(refreshErrorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack-sm" style={{ alignItems: "flex-end" }}>
      <Button
        variant="secondary"
        size="sm"
        icon="refresh-cw"
        loading={inProgress}
        disabled={!r.canRefresh || inProgress}
        disabledReason={inProgress ? "조회 중" : reason}
        onClick={() => setConfirm(true)}
      >
        {inProgress ? "조회 중" : "새로고침"}
      </Button>
      <span className="text-micro">{reason && !r.canRefresh && !inProgress ? reason : `호출당 ${usd2(r.callCostUsd)}`}</span>
      {error && !onNotice ? <InlineAlert tone="warn" compact title={error} /> : null}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Cost Explorer를 새로 조회할까요?" confirmLabel="조회" onConfirm={() => void run()} cancelLabel="닫기" size="sm">
        {confirm ? <RefreshConfirmBody r={r} now={now} /> : null}
      </Dialog>
    </div>
  );
}
