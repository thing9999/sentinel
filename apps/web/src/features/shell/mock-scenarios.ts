"use client";

/**
 * mock 시나리오 전환 (docs/api/common.md 6절). mock 모드에서만 부른다.
 * - GET  /api/mock/scenarios
 * - PUT  /api/mock/scenarios/:group  { scenario, fastTimers? }
 * - POST /api/mock/reset
 * 시나리오를 바꾸면 서버가 해당 토픽 스냅샷을 다시 보내므로 화면은 스트림으로 갱신된다.
 */
import { useCallback, useState } from "react";

import { SCENARIO_GROUPS, type MockScenario, type ScenarioGroupId } from "@/components/ui";
import { apiFetch } from "@/lib/api";

import { errorBody, useApi } from "../common/hooks";
import type { MockGroupId, MockScenarioGroup, MockScenariosResponse } from "../common/types";

const isBadgeGroup = (id: string): id is ScenarioGroupId => (SCENARIO_GROUPS as readonly string[]).includes(id);

/**
 * 상단바 MOCK 배지 Popover 용. 그룹은 DataSourceBadge `SCENARIO_GROUPS`
 * (cluster·db·cost·advisor·snapshots·k8s-snapshots)만, 순서는 서버 응답 순서
 */
export function toBadgeScenarios(groups: MockScenarioGroup[] | undefined): MockScenario[] {
  const out: MockScenario[] = [];
  for (const g of groups ?? []) {
    const id = g.id;
    if (!isBadgeGroup(id)) continue;
    for (const o of g.options) {
      out.push({ id: o.id, label: o.label, group: id, active: g.active === o.id });
    }
  }
  return out;
}

export function scenarioErrorText(e: unknown): string {
  const body = errorBody(e);
  if (body?.code === "RUN_ACTIVE") return "분석이 진행 중이라 어드바이저 시나리오를 바꿀 수 없습니다. 진행 중인 분석을 먼저 취소하세요.";
  if (body?.code === "MOCK_MODE_ONLY") return "live 모드에서는 시나리오를 바꿀 수 없습니다.";
  if (body?.message) return body.message;
  return "시나리오를 바꾸지 못했습니다.";
}

export function useMockScenarios(enabled: boolean) {
  const q = useApi<MockScenariosResponse>(enabled ? "/mock/scenarios" : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = useCallback(
    async (group: MockGroupId, scenario: string, fastTimers?: boolean) => {
      setPending(true);
      setError(null);
      try {
        await apiFetch(`/mock/scenarios/${encodeURIComponent(group)}`, {
          method: "PUT",
          body: fastTimers === undefined ? { scenario } : { scenario, fastTimers },
        });
        q.reload();
      } catch (e) {
        setError(scenarioErrorText(e));
      } finally {
        setPending(false);
      }
    },
    [q],
  );

  const reset = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch("/mock/reset", { method: "POST" });
      q.reload();
    } catch (e) {
      setError(scenarioErrorText(e));
    } finally {
      setPending(false);
    }
  }, [q]);

  return { data: q.data, loading: q.loading, loadError: q.error, pending, error, clearError: () => setError(null), change, reset };
}
