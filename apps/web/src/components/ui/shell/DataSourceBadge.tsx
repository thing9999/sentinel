"use client";

import { useId } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import { Popover } from "../overlay/Popover";
import { Tooltip } from "../overlay/Tooltip";
import styles from "./shell.module.css";

/**
 * 계약 docs/api/common.md 6.1 의 mock 시나리오 그룹 (표시 순서).
 * `snapshots`: aws-snapshot-manager (components.md 12.7)
 * `k8s-snapshots`: k8s-snapshot (components.md 15.2, 맨 뒤). 드리프트 시나리오도 이 그룹 안에 있다.
 * 그룹 키는 API mock 그룹 id 그대로 쓴다(common.md 6.1, 호출 측이 id 로 걸러 넘긴다).
 */
export const SCENARIO_GROUPS = ["cluster", "db", "cost", "advisor", "snapshots", "k8s-snapshots"] as const;
/** 배지가 그리는 모든 그룹 키 (`k8s-snapshots` 포함) */
export type ScenarioGroupId = (typeof SCENARIO_GROUPS)[number];
/**
 * 하위 호환: aws-snapshot-manager 때의 5개 그룹. 호출 측(`MockGroupId`)이 이 타입으로 핸들러를 만들어 두어 넓히지 않았다.
 * k8s 그룹까지 받으려면 ScenarioGroupId 를 쓴다.
 */
export type ScenarioGroupKey = Exclude<ScenarioGroupId, "k8s-snapshots">;
/**
 * 하위 호환: 기존 4개 그룹(cluster·db·cost·advisor).
 */
export type ScenarioGroup = Exclude<ScenarioGroupKey, "snapshots">;

export interface MockScenario {
  id: string;
  label: string;
  group: ScenarioGroupId;
  active: boolean;
}

export interface DataSourceBadgeProps {
  mode: "mock" | "live";
  /** 있으면 클릭 시 Popover(폭 320px, 그룹별 라디오 목록) */
  scenarios?: MockScenario[];
  /**
   * 메서드 표기(매개변수 bivariant): 기존 `(group: ScenarioGroup | ScenarioGroupKey, id) => …` 핸들러도 그대로 넘길 수 있다.
   * 실제로 넘어오는 값은 ScenarioGroupId(`snapshots`·`k8s-snapshots` 포함)다.
   */
  onScenarioChange?(group: ScenarioGroupId, id: string): void;
  className?: string;
}

const GROUP_LABEL: Record<ScenarioGroupId, string> = {
  cluster: "클러스터",
  db: "DB",
  cost: "비용",
  advisor: "어드바이저",
  snapshots: "AWS 스냅샷",
  "k8s-snapshots": "Kubernetes 스냅샷",
};
const MOCK_TIP = "DATA_SOURCE=mock: 실제 클러스터·AWS에 연결하지 않습니다";

/**
 * components.md 1.6 / status.md 2.4. mock 은 상시 표시(숨길 수 없음), live 는 `LIVE` 텍스트만.
 * state: static(툴팁만) / interactive(Popover 시나리오 선택) / open
 */
export function DataSourceBadge({ mode, scenarios, onScenarioChange, className }: DataSourceBadgeProps) {
  const nameBase = useId();
  if (mode === "live") {
    return <span className={cx(styles.liveText, className)}>LIVE</span>;
  }

  const inner = (
    <>
      <Icon name="flask-conical" size={14} />
      <span>
        MOCK<span className={styles.mockExtra}> 데이터</span>
      </span>
    </>
  );

  if (!scenarios || scenarios.length === 0 || !onScenarioChange) {
    return (
      <Tooltip content={MOCK_TIP} focusable className={className}>
        <span className={styles.mockBadge}>{inner}</span>
      </Tooltip>
    );
  }

  const groups = SCENARIO_GROUPS.filter((g) => scenarios.some((s) => s.group === g));
  return (
    <Popover
      label="mock 시나리오 선택"
      width={320}
      align="end"
      className={className}
      trigger={(p) => (
        <button type="button" {...p} className={cx(styles.mockBadge, styles.mockButton)}>
          {inner}
          <Icon name="chevron-down" size={12} />
        </button>
      )}
    >
      <p className={styles.popoverNote}>{MOCK_TIP}</p>
      {groups.map((g) => (
        <fieldset key={g} className={styles.scenarioGroup}>
          <legend className={styles.scenarioLegend}>{GROUP_LABEL[g]}</legend>
          {scenarios
            .filter((s) => s.group === g)
            .map((s) => (
              <label key={s.id} className={styles.scenarioItem}>
                <input
                  type="radio"
                  name={`${nameBase}-${g}`}
                  checked={s.active}
                  onChange={() => onScenarioChange(g, s.id)}
                />
                <span>{s.label}</span>
              </label>
            ))}
        </fieldset>
      ))}
    </Popover>
  );
}
