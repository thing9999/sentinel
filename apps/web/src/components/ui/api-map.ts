/**
 * API 값 → 디자인 키 변환 (docs/design/status.md 8절). 순수 함수만 있다(fetch·상태 없음).
 *
 * 원칙: 공통 컴포넌트(StatusBadge, MoneyValue, CostKindBadge, CategoryChip…)는 **디자인 키**를 받는다.
 * 프론트는 API 응답이 화면에 들어오는 지점에서 이 함수로 한 번만 바꿔 넘긴다.
 * 예외: BridgeStatusBar(bridge), RunResultAlert(reason)는 API 값을 그대로 받는다(components.md 10.1, 10.3).
 * 표에 없는 값: 상태는 unknown, 금액 kind 는 null(= `—` 표시), 둘 다 콘솔 경고.
 */
import type { AdvisorCategory, CostKind, Severity, Status, StatusAltLabel } from "./types";

export type ApiStatus = "ok" | "warning" | "critical" | "unknown";
export type ApiMoneyKind = "estimated" | "actual" | "forecast";
export type ApiCategory = "cost" | "reliability" | "performance" | "security" | "database";
export type ApiRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

const warn = (what: string, v: unknown) => {
  if (typeof console !== "undefined") console.warn(`[ui/api-map] 알 수 없는 ${what}: ${String(v)}`);
};

const STATUS_MAP: Record<ApiStatus, Status> = {
  ok: "ok",
  warning: "warn",
  critical: "crit",
  unknown: "unknown",
};

/** API status → 디자인 Status (stale 플래그는 반영하지 않음) */
export function statusFromApi(status: string | null | undefined): Exclude<Status, "stale"> {
  if (status && Object.prototype.hasOwnProperty.call(STATUS_MAP, status)) {
    return STATUS_MAP[status as ApiStatus] as Exclude<Status, "stale">;
  }
  warn("status", status);
  return "unknown";
}

/**
 * status.md 8.1: API `StatusInfo` → 배지 props.
 * stale(서버 플래그 또는 화면 타이머 판정)이면 배지 키를 `stale` 로 교체하고 원래 상태를 previousStatus 로.
 */
export function badgeFromApi(info: {
  status: string;
  stale?: boolean;
  updatedAt?: string | null;
}, screenStale = false): { status: Status; previousStatus?: Status; staleAt?: string } {
  const base = statusFromApi(info.status);
  if (info.stale || screenStale) {
    return { status: "stale", previousStatus: base, staleAt: info.updatedAt ?? undefined };
  }
  return { status: base };
}

const KIND_MAP: Record<ApiMoneyKind, CostKind> = {
  estimated: "estimate",
  actual: "confirmed",
  forecast: "forecast",
};

/** status.md 8.2: API MoneyKind → CostKind. 모르는 값은 null(금액을 `—`로) */
export function costKindFromApi(kind: string | null | undefined): CostKind | null {
  if (kind && Object.prototype.hasOwnProperty.call(KIND_MAP, kind)) return KIND_MAP[kind as ApiMoneyKind];
  warn("money kind", kind);
  return null;
}

/** 어드바이저 절감액 출처 → CostKind (server: 추정·서버 계산, llm: LLM 추정) */
export const savingsKindFromSource = (source: "server" | "llm"): CostKind =>
  source === "llm" ? "llmEstimate" : "estimate";

/** 예산 projectedBasis → BudgetGauge projectedKind */
export const projectedKindFromBasis = (basis: "aws_forecast" | "estimated_month_end" | string): "forecast" | "estimate" =>
  basis === "estimated_month_end" ? "estimate" : "forecast";

const CATEGORY_MAP: Record<ApiCategory, AdvisorCategory> = {
  cost: "cost",
  reliability: "reliability",
  performance: "performance",
  security: "security",
  database: "db",
};

/** status.md 8.3: API Category → AdvisorCategory (`database` → `db`) */
export function categoryFromApi(cat: string | null | undefined): AdvisorCategory | null {
  if (cat && Object.prototype.hasOwnProperty.call(CATEGORY_MAP, cat)) return CATEGORY_MAP[cat as ApiCategory];
  warn("category", cat);
  return null;
}

/** 심각도는 같은 키. 사전 점검 `severity: null` 은 `판단 보류` 칩(호출 측) */
export const severityFromApi = (s: string | null | undefined): Severity | null =>
  s === "high" || s === "medium" || s === "low" ? s : null;

/** status.md 8.3: 실행 상태 → 이력 표 StatusBadge props */
export function runStatusBadge(status: string): { status: Status; label: StatusAltLabel; busy?: boolean } {
  switch (status) {
    case "queued":
    case "running":
      return { status: "unknown", label: "진행 중", busy: true };
    case "succeeded":
      return { status: "ok", label: "완료" };
    case "failed":
      return { status: "crit", label: "실패" };
    case "cancelled":
      return { status: "unknown", label: "취소됨" };
    default:
      warn("run status", status);
      return { status: "unknown", label: "확인 중" };
  }
}
