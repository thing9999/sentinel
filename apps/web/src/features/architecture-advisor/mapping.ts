/**
 * 어드바이저 API 값 → 화면 props (docs/design/status.md 8.3, publisher 보고서 9절). 순수 함수.
 * 모든 문자열은 서버(LLM) 텍스트 그대로 넘긴다(가공·HTML 변환 없음). 링크는 서버가 스냅샷과 대조한 대상(`ref`)만.
 */
import {
  categoryFromApi,
  formatDurationTimer,
  severityFromApi,
  type AdvisorCategory,
  type Severity,
  type Step,
  type SuggestionCardProps,
} from "@/components/ui";

import { hrefForRef } from "../cluster-status/selectors";
import type { BridgeStatus, Run, StageId, Suggestion, TargetRef } from "./types";

export const STAGE_LABEL: Record<StageId, string> = {
  snapshot: "스냅샷 수집",
  precheck: "사전 점검",
  request: "분석 요청",
  receiving: "응답 수신 중",
  finalizing: "결과 정리",
};
export const STAGE_ORDER: StageId[] = ["snapshot", "precheck", "request", "receiving", "finalizing"];

/** Run.stages → Stepper steps (완료 단계 detail 에 소요 `0:03`) */
export function runSteps(run: Pick<Run, "stages">): Step[] {
  const byId = new Map(run.stages.map((s) => [s.id, s] as const));
  return STAGE_ORDER.map((id) => {
    const s = byId.get(id);
    const state = s?.state ?? "pending";
    return {
      id,
      label: STAGE_LABEL[id],
      state,
      detail: state === "done" && s?.durationMs !== null && s?.durationMs !== undefined ? formatDurationTimer(s.durationMs) : undefined,
    };
  });
}

export function targetToCard(t: TargetRef): SuggestionCardProps["targets"][number] {
  const href = t.inSnapshot && t.ref ? linkForRef(t.ref) : undefined;
  return {
    name: t.namespace ? `${t.namespace}/${t.name}` : t.name,
    kind: t.kind,
    href,
    missing: !t.inSnapshot,
  };
}

/** 클러스터 화면이 있는 종류만 링크 */
function linkForRef(ref: NonNullable<TargetRef["ref"]>): string | undefined {
  switch (ref.kind) {
    case "Pod":
    case "Node":
    case "Deployment":
    case "StatefulSet":
    case "DaemonSet":
      return hrefForRef(ref);
    case "Database":
      return "/cluster/db";
    default:
      return undefined;
  }
}

export function suggestionCategory(s: Pick<Suggestion, "category">): AdvisorCategory {
  // 계약 enum 밖의 값이 오면 api-map 이 콘솔 경고를 남긴다. 카드는 성능(규칙 없는 카테고리)으로 둔다.
  return categoryFromApi(s.category) ?? "performance";
}

export function suggestionSeverity(v: string): Severity {
  return severityFromApi(v) ?? "low";
}

export function suggestionToCard(s: Suggestion): Omit<SuggestionCardProps, "expanded" | "onToggle" | "onRuleClick"> {
  return {
    priority: s.priority,
    title: s.title,
    category: suggestionCategory(s),
    severity: suggestionSeverity(s.severity),
    targets: s.targets.map(targetToCard),
    evidence: s.evidence.map((e) => ({ text: e.text, field: e.field ?? undefined, value: e.value === null ? undefined : String(e.value) })),
    linkedRules: s.precheckIds,
    savings: s.savings ? { monthly: s.savings.monthlyUsd, formula: s.savings.formula, source: s.savings.source } : null,
    steps: s.steps.map((st) => ({ text: st.text, code: st.code ? { language: st.code.language, code: st.code.content } : undefined })),
    risk: { level: suggestionSeverity(s.risk.level), reason: s.risk.reason },
    verify: s.verification ?? undefined,
    unverified: s.unverified,
  };
}

export type SourceFilter = "all" | "linked" | "llmOnly";

export function filterSuggestions(
  list: readonly Suggestion[],
  f: { categories: AdvisorCategory[]; severities: string[]; source: SourceFilter },
): Suggestion[] {
  return list.filter(
    (s) =>
      (f.categories.length === 0 || f.categories.includes(suggestionCategory(s))) &&
      (f.severities.length === 0 || f.severities.includes(s.severity)) &&
      (f.source === "all" || (f.source === "linked" ? s.precheckIds.length > 0 : s.precheckIds.length === 0)),
  );
}

/** 분석 실행 버튼 비활성 사유 (architecture-advisor.md 2.2 표) */
export function runDisabledText(bridge: BridgeStatus | null, activeRun: Run | null, formatRetry: (iso: string) => string): string | undefined {
  if (activeRun) return "분석은 한 번에 1건만 실행됩니다";
  if (!bridge) return "브리지 확인 중";
  if (bridge.canRun) return undefined;
  switch (bridge.disabledReason) {
    case "bridge_unreachable":
      return "브리지 미실행";
    case "login_required":
      return "Claude Code 로그인 필요";
    case "usage_limit":
      return bridge.retryAt ? `사용량 한도 · ${formatRetry(bridge.retryAt)} 이후 가능` : "사용량 한도";
    case "checking":
      return "브리지 확인 중";
    case "run_in_progress":
    case "dashboard_busy":
      return "분석은 한 번에 1건만 실행됩니다";
    default:
      return "지금은 분석을 실행할 수 없습니다";
  }
}

/** RunResultAlert reason: 취소는 status 로 구분한다 (계약 A.9) */
export function resultReason(run: Pick<Run, "status" | "failureReason">): string {
  return run.status === "cancelled" ? "cancelled" : (run.failureReason ?? "other");
}

export function isActive(run: Pick<Run, "status"> | null | undefined): boolean {
  return run?.status === "queued" || run?.status === "running";
}
