/**
 * 알림 전이 판정 (순수 함수). docs/api/alerts.md 4.3 / docs/specs/alerts.md 3.2.
 *
 * **여기서 상태를 다시 판단하지 않는다.** 들어오는 `status`는 이미 서버가 계산한
 * `StatusInfo.status`(`GET /api/overview`의 `areas.*`)를 그대로 옮긴 값이고,
 * 이 파일은 "그 값이 바뀌었을 때 알림을 만들까/합칠까/멈출까"만 정한다.
 * 새 임계값 상수를 만들지 않는다 (AC-ALERT14) — 억제·플래핑·워밍업 기준값은
 * `settings.alerts` 한곳에 모이고 전부 설정으로 바뀐다.
 */
import type { Status } from '../common/status';
import { statusRank } from '../common/status';
import type {
  AlertKey,
  AlertKind,
  AlertSeverity,
  AlertTransitionEntry,
} from './alerts.types';
import { severityFromStatus } from './alert-labels';

/** settings `alerts` 값 (src/database/settings-defaults.ts). 전부 설정값이다 */
export interface AlertRules {
  dedupeWindowMin: number;
  notifyOnNewTarget: boolean;
  flapWindowMin: number;
  flapTransitions: number;
  flapTransitionsMax: number;
  warmupSec: number;
  unknownAfterMin: number;
  sourceSuppressAfterMin: number;
  heartbeatIntervalSec: number;
  memoryFallbackMax: number;
  repeatEveryMin: number | null;
  lastNotifiedTargetsMax: number;
}

/** 알림 키 1개의 상태 머신 (DB `alert_key_states` 1행과 같은 모양 + 메모리 보조 필드) */
export interface KeyState {
  status: Status;
  statusSince: number;
  openAlertId: string | null;
  /** 진행 중 알림의 현재 심각도 (억제·격상·완화 판정용) */
  openSeverity: AlertSeverity | null;
  dedupeStartedAt: number | null;
  dedupeCount: number;
  recentTransitions: AlertTransitionEntry[];
  flapping: boolean;
  flappingSince: number | null;
  unknownSince: number | null;
  /** unknown 직전 상태 (지연 뒤 알림의 from) */
  unknownFrom: Status | null;
  /** 이번 unknown 구간에 대해 이미 알림을 만들었는가 */
  unknownAlerted: boolean;
  suppressedBy: string | null;
  lastNotifiedTargets: string[];
}

export interface KeyObservation {
  status: Status;
  /** 영향 객체 참조 문자열 `<Kind>/<ns>/<name>` (정렬된 집합) */
  targetRefs: string[];
  /** 다른 키(출처)가 이 키를 묶고 있는가. 묶여 있으면 알림을 만들지 않는다 */
  suppressedBy: string | null;
}

export type AlertAction =
  | {
      type: 'create';
      kind: AlertKind;
      severity: AlertSeverity;
      from: Status | null;
      to: Status;
      /** 격상·해제가 가리키는 원래 발생 알림 */
      parentAlertId: string | null;
      /** 종결형이라 만드는 순간 닫는다 (resolve) */
      closesParent: boolean;
      /** 진행 중 알림으로 이어지는가 (transition·escalation·flapping) */
      opens: boolean;
      flappingTransitions?: AlertTransitionEntry[];
    }
  | { type: 'merge'; alertId: string; repeatCount: number }
  | {
      type: 'mitigate';
      alertId: string;
      from: Status;
      to: Status;
      severity: AlertSeverity;
    };

export function initialKeyState(status: Status, now: number): KeyState {
  return {
    status,
    statusSince: now,
    openAlertId: null,
    openSeverity: null,
    dedupeStartedAt: null,
    dedupeCount: 0,
    recentTransitions: [],
    flapping: false,
    flappingSince: null,
    unknownSince: status === 'unknown' ? now : null,
    unknownFrom: null,
    unknownAlerted: false,
    suppressedBy: null,
    lastNotifiedTargets: [],
  };
}

/** 종결형(만들어지는 순간 닫히는) 종류 — DBA `closed_at` 규칙 */
export function isTerminalKind(kind: AlertKind): boolean {
  return kind === 'resolve' || kind === 'restart_summary' || kind === 'test';
}

/** jsonb 배열 상한 자르기. 안 자르면 행이 계속 커진다 (DBA 규칙) */
export function capArray<T>(list: T[], max: number): T[] {
  return list.length <= max ? list : list.slice(list.length - max);
}

function transitionsWithin(
  list: AlertTransitionEntry[],
  windowMin: number,
  now: number,
): number {
  const from = now - windowMin * 60_000;
  let n = 0;
  for (const t of list) if (Date.parse(t.at) >= from) n += 1;
  return n;
}

/** unknown 알림을 만들기 전에 기다리는 시간(분). 출처 키만 다른 값을 쓴다 (계약 4.3) */
export function unknownDelayMin(key: AlertKey, rules: AlertRules): number {
  return key === 'source:kube'
    ? rules.sourceSuppressAfterMin
    : rules.unknownAfterMin;
}

function newTargets(prev: string[], next: string[]): boolean {
  if (next.length === 0) return false;
  const seen = new Set(prev);
  return next.some((t) => !seen.has(t));
}

export interface DecideInput {
  key: AlertKey;
  state: KeyState;
  observation: KeyObservation;
  rules: AlertRules;
  now: number;
  /** 워밍업 중이면 알림을 만들지 않고 상태만 따라간다 (AC-ALERT09) */
  warmup: boolean;
}

export interface DecideResult {
  state: KeyState;
  actions: AlertAction[];
  /** 값이 실제로 바뀌었는가 — **바뀐 키만** upsert한다 (DBA 규칙) */
  changed: boolean;
}

/**
 * 키 1개의 이번 표본을 처리한다.
 *
 * 만들어지는 것:
 * - `transition`  ok/unknown → warning/critical, 진행 중 알림이 없을 때
 * - `escalation`  warning → critical (**새 행** + 이전 행 닫기)
 * - `resolve`     warning/critical/unknown → ok (진행 중 알림이 있을 때만)
 * - `flapping`    플래핑 진입 묶음 1건
 * 만들어지지 않는 것:
 * - critical → warning **완화는 새 행을 만들지 않는다** (기존 행의 심각도를 낮추고 기록만 남긴다)
 * - 같은 상태가 이어지는 동안의 재알림 (AC-ALERT03)
 */
export function decideKey(input: DecideInput): DecideResult {
  const { key, rules, now, warmup, observation: obs } = input;
  const before = input.state;
  const state: KeyState = {
    ...before,
    recentTransitions: [...before.recentTransitions],
    lastNotifiedTargets: [...before.lastNotifiedTargets],
  };
  const actions: AlertAction[] = [];
  const prev = state.status;
  const next = obs.status;
  const transitioned = prev !== next;

  state.suppressedBy = obs.suppressedBy;

  if (transitioned) {
    state.status = next;
    state.statusSince = now;
    state.recentTransitions = capArray(
      [
        ...state.recentTransitions,
        { at: new Date(now).toISOString(), from: prev, to: next },
      ],
      rules.flapTransitionsMax,
    );
    if (next === 'unknown') {
      state.unknownSince = now;
      state.unknownFrom = prev;
      state.unknownAlerted = false;
    } else {
      state.unknownSince = null;
      state.unknownFrom = null;
      state.unknownAlerted = false;
    }
  }

  // --- 플래핑 판정 (전이 횟수 기준). 진입하면 그 키의 개별 알림을 멈춘다 ---------
  const recentCount = transitionsWithin(
    state.recentTransitions,
    rules.flapWindowMin,
    now,
  );
  const shouldFlap = recentCount >= rules.flapTransitions;
  const enteringFlap = shouldFlap && !state.flapping;
  const leavingFlap = !shouldFlap && state.flapping;
  if (enteringFlap) {
    state.flapping = true;
    state.flappingSince = now;
  } else if (leavingFlap) {
    state.flapping = false;
    state.flappingSince = null;
  }

  // 워밍업·출처 억제 중에는 상태만 따라가고 알림을 만들지 않는다.
  const muted = warmup || obs.suppressedBy !== null;

  if (!muted && enteringFlap) {
    actions.push({
      type: 'create',
      kind: 'flapping',
      severity: severityFromStatus(next === 'ok' ? 'warning' : next),
      from: prev,
      to: next,
      parentAlertId: state.openAlertId,
      closesParent: true,
      opens: true,
      flappingTransitions: state.recentTransitions.filter(
        (t) => Date.parse(t.at) >= now - rules.flapWindowMin * 60_000,
      ),
    });
  }

  // 플래핑 중에는 개별 항목을 만들지 않는다. **진입한 그 표본도 포함**이다 —
  // 진입 알림과 그 전이의 개별 알림이 함께 나가면 묶음의 뜻이 없어진다.
  const flappingActive = state.flapping;

  if (!muted && !flappingActive) {
    if (leavingFlap) {
      // 플래핑 해제 — 그 시점 상태로 새 항목 1건
      if (next === 'ok') {
        if (state.openAlertId) {
          actions.push({
            type: 'create',
            kind: 'resolve',
            severity: 'resolved',
            from: prev,
            to: next,
            parentAlertId: state.openAlertId,
            closesParent: true,
            opens: false,
          });
        }
      } else {
        actions.push({
          type: 'create',
          kind: 'transition',
          severity: severityFromStatus(next),
          from: prev,
          to: next,
          parentAlertId: state.openAlertId,
          closesParent: true,
          opens: true,
        });
      }
    } else if (next === 'unknown') {
      // **지속 조건**: 기준 시간이 지나기 전에는 항목이 생기지 않는다 (AC-ALERT08)
      const since = state.unknownSince ?? now;
      const delayMs = unknownDelayMin(key, rules) * 60_000;
      if (!state.unknownAlerted && now - since >= delayMs) {
        state.unknownAlerted = true;
        actions.push({
          type: 'create',
          kind: 'transition',
          severity: 'unknown',
          from: state.unknownFrom,
          to: 'unknown',
          parentAlertId: state.openAlertId,
          closesParent: true,
          opens: true,
        });
      }
    } else if (transitioned && next === 'ok') {
      if (state.openAlertId) {
        actions.push({
          type: 'create',
          kind: 'resolve',
          severity: 'resolved',
          from: prev,
          to: next,
          parentAlertId: state.openAlertId,
          closesParent: true,
          opens: false,
        });
      }
    } else if (transitioned && prev === 'warning' && next === 'critical') {
      // 격상: **새 행** + 이전 행 닫기
      actions.push({
        type: 'create',
        kind: 'escalation',
        severity: 'critical',
        from: prev,
        to: next,
        parentAlertId: state.openAlertId,
        closesParent: true,
        opens: true,
      });
    } else if (
      transitioned &&
      prev === 'critical' &&
      next === 'warning' &&
      state.openAlertId
    ) {
      // 완화: **새 행을 만들지 않는다.** 기존 행의 심각도를 낮추고 기록만 남긴다
      actions.push({
        type: 'mitigate',
        alertId: state.openAlertId,
        from: prev,
        to: next,
        severity: 'warning',
      });
    } else if (transitioned && statusRank(next) > statusRank(prev)) {
      const severity = severityFromStatus(next);
      const merged = tryMerge(state, severity, rules, now);
      if (merged) actions.push(merged);
      else
        actions.push({
          type: 'create',
          kind: 'transition',
          severity,
          from: prev,
          to: next,
          parentAlertId: state.openAlertId,
          closesParent: true,
          opens: true,
        });
    } else if (
      !transitioned &&
      next !== 'ok' &&
      rules.notifyOnNewTarget &&
      newTargets(state.lastNotifiedTargets, obs.targetRefs) &&
      state.openAlertId
    ) {
      // 영향 객체가 새로 늘었다 — 같은 등급이므로 기존 항목에 합친다 (AC-ALERT03·05)
      const merged = tryMerge(
        state,
        severityFromStatus(next),
        rules,
        now,
        true,
      );
      if (merged) actions.push(merged);
    }
  }

  if (actions.some((a) => a.type === 'create' || a.type === 'merge')) {
    state.lastNotifiedTargets = capArray(
      [...obs.targetRefs],
      rules.lastNotifiedTargetsMax,
    );
  }

  return { state, actions, changed: !sameState(before, state) };
}

/**
 * 억제 창 안이면 기존 항목에 합친다 (`repeatCount` 증가). 창 밖이면 창을 다시 연다.
 * `force`는 "새 영향 객체" 처럼 등급이 같은 사건 — 창이 끝나도 새 항목을 만들지 않는다.
 */
function tryMerge(
  state: KeyState,
  severity: AlertSeverity,
  rules: AlertRules,
  now: number,
  force = false,
): AlertAction | null {
  if (!state.openAlertId) return null;
  if (state.openSeverity !== severity && !force) return null;
  const started = state.dedupeStartedAt;
  const withinWindow =
    started !== null && now - started < rules.dedupeWindowMin * 60_000;
  if (!withinWindow && !force) return null;
  if (!withinWindow) state.dedupeStartedAt = now;
  state.dedupeCount += 1;
  return {
    type: 'merge',
    alertId: state.openAlertId,
    repeatCount: state.dedupeCount + 1,
  };
}

/** 알림을 만든 뒤 상태 머신을 맞춘다 (진행 중 알림 연결·억제 창 시작) */
export function applyCreated(
  state: KeyState,
  action: Extract<AlertAction, { type: 'create' }>,
  alertId: string,
  now: number,
): KeyState {
  return {
    ...state,
    openAlertId: action.opens ? alertId : null,
    openSeverity: action.opens ? action.severity : null,
    dedupeStartedAt: action.opens ? now : null,
    dedupeCount: action.opens ? 0 : 0,
  };
}

export function applyMitigated(
  state: KeyState,
  severity: AlertSeverity,
): KeyState {
  return { ...state, openSeverity: severity };
}

function sameState(a: KeyState, b: KeyState): boolean {
  return (
    a.status === b.status &&
    a.statusSince === b.statusSince &&
    a.openAlertId === b.openAlertId &&
    a.openSeverity === b.openSeverity &&
    a.dedupeStartedAt === b.dedupeStartedAt &&
    a.dedupeCount === b.dedupeCount &&
    a.flapping === b.flapping &&
    a.flappingSince === b.flappingSince &&
    a.unknownSince === b.unknownSince &&
    a.unknownFrom === b.unknownFrom &&
    a.unknownAlerted === b.unknownAlerted &&
    a.suppressedBy === b.suppressedBy &&
    a.recentTransitions.length === b.recentTransitions.length &&
    a.lastNotifiedTargets.length === b.lastNotifiedTargets.length &&
    a.lastNotifiedTargets.every((t, i) => b.lastNotifiedTargets[i] === t)
  );
}
