/**
 * 알림 전이 판정 테스트 (docs/api/alerts.md 4.3, AC-ALERT03~11).
 *
 * 시간이 걸리는 규칙(억제 15분·플래핑 30분·워밍업 120초·확인 불가 5분)은 **여기서** 고정한다.
 * mock 기동으로는 눈으로 보기 어려운 구간이기 때문이다.
 */
import { SETTING_DEFAULTS } from '../database/settings-defaults';
import {
  applyCreated,
  capArray,
  decideKey,
  initialKeyState,
  isTerminalKind,
  unknownDelayMin,
  type AlertAction,
  type AlertRules,
  type KeyState,
} from './alert-rules';
import { worstSeverity } from './alert-labels';
import { DB_DELIVERY_STATUSES, DISPATCH_STATES } from './alerts.types';
import { AlertDeliveryStatus } from '../database/generated/prisma/enums';

const RULES: AlertRules = { ...SETTING_DEFAULTS.alerts.value };
const MIN = 60_000;
const T0 = Date.parse('2026-09-25T14:00:00.000Z');

function step(
  state: KeyState,
  status: KeyState['status'],
  now: number,
  opts: {
    key?: Parameters<typeof decideKey>[0]['key'];
    targets?: string[];
    warmup?: boolean;
    suppressedBy?: string | null;
    rules?: AlertRules;
  } = {},
): { state: KeyState; actions: AlertAction[] } {
  const res = decideKey({
    key: opts.key ?? 'area:pods',
    state,
    observation: {
      status,
      targetRefs: opts.targets ?? [],
      suppressedBy: opts.suppressedBy ?? null,
    },
    rules: opts.rules ?? RULES,
    now,
    warmup: opts.warmup ?? false,
  });
  let next = res.state;
  let i = 0;
  for (const a of res.actions) {
    if (a.type === 'create') {
      i += 1;
      next = applyCreated(next, a, `alert-${i}`, now);
    }
  }
  return { state: next, actions: res.actions };
}

describe('전이 → 알림 (AC-ALERT02·04·11)', () => {
  it('ok → critical이면 발생 알림 1건', () => {
    const s0 = initialKeyState('ok', T0);
    const { actions } = step(s0, 'critical', T0 + MIN);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'create',
      kind: 'transition',
      severity: 'critical',
      opens: true,
    });
  });

  it('같은 상태가 이어지면 알림을 더 만들지 않는다 (AC-ALERT03)', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'critical', T0 + MIN).state;
    for (let i = 2; i < 20; i += 1) {
      const r = step(s, 'critical', T0 + i * MIN);
      s = r.state;
      expect(r.actions).toHaveLength(0);
    }
  });

  it('warning → critical은 **새 행 + 이전 행 닫기** (격상, AC-ALERT11)', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'warning', T0 + MIN).state;
    const { actions } = step(s, 'critical', T0 + 2 * MIN);
    expect(actions[0]).toMatchObject({
      type: 'create',
      kind: 'escalation',
      closesParent: true,
      parentAlertId: 'alert-1',
    });
  });

  it('critical → warning 완화는 **새 행을 만들지 않는다**', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'critical', T0 + MIN).state;
    const { actions } = step(s, 'warning', T0 + 2 * MIN);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'mitigate',
      severity: 'warning',
      alertId: 'alert-1',
    });
  });

  it('정상으로 돌아오면 해제 알림 1건 (진행 중 알림이 있을 때만)', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'critical', T0 + MIN).state;
    const { actions } = step(s, 'ok', T0 + 5 * MIN);
    expect(actions[0]).toMatchObject({
      type: 'create',
      kind: 'resolve',
      severity: 'resolved',
      closesParent: true,
      opens: false,
    });
  });

  it('진행 중 알림이 없으면 해제 알림을 만들지 않는다 (짝 없는 "복구됨" 금지)', () => {
    const s = initialKeyState('warning', T0);
    const { actions } = step(s, 'ok', T0 + MIN);
    expect(actions).toHaveLength(0);
  });
});

describe('억제 창 (AC-ALERT05)', () => {
  it('창 안의 같은 등급 사건은 기존 항목에 합쳐 repeatCount만 올린다', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'critical', T0 + MIN).state;
    const counts: number[] = [];
    for (let i = 1; i <= 3; i += 1) {
      // 상태는 그대로인데 영향 객체가 새로 늘어난 사건
      const r = step(s, 'critical', T0 + MIN + i * MIN, {
        targets: Array.from({ length: i + 1 }, (_, n) => `Pod/prod/p${n}`),
      });
      s = r.state;
      expect(r.actions).toHaveLength(1);
      expect(r.actions[0].type).toBe('merge');
      if (r.actions[0].type === 'merge') counts.push(r.actions[0].repeatCount);
    }
    expect(counts).toEqual([2, 3, 4]);
  });

  it('notifyOnNewTarget을 끄면 객체가 늘어도 합치지 않는다', () => {
    const rules = { ...RULES, notifyOnNewTarget: false };
    let s = initialKeyState('ok', T0);
    s = step(s, 'critical', T0 + MIN, { rules }).state;
    const r = step(s, 'critical', T0 + 2 * MIN, {
      targets: ['Pod/prod/a', 'Pod/prod/b'],
      rules,
    });
    expect(r.actions).toHaveLength(0);
  });
});

describe('플래핑 (AC-ALERT06)', () => {
  function flapTo(count: number): { state: KeyState; created: AlertAction[] } {
    let s = initialKeyState('ok', T0);
    const created: AlertAction[] = [];
    for (let i = 1; i <= count; i += 1) {
      const r = step(s, i % 2 === 1 ? 'warning' : 'ok', T0 + i * MIN);
      s = r.state;
      created.push(...r.actions);
    }
    return { state: s, created };
  }

  it('창 안 전이가 기준을 넘으면 묶음 1건을 만들고 개별 알림을 멈춘다', () => {
    const { state, created } = flapTo(6);
    expect(state.flapping).toBe(true);
    const flaps = created.filter(
      (a) => a.type === 'create' && a.kind === 'flapping',
    );
    expect(flaps).toHaveLength(1);
    // 진입 이후 전이에는 개별 항목이 생기지 않는다
    const afterFlap = created.slice(created.indexOf(flaps[0]) + 1);
    expect(afterFlap).toHaveLength(0);
  });

  it('창을 벗어나 조용해지면 플래핑이 풀리고 그 시점 상태로 1건이 나온다', () => {
    const { state } = flapTo(6);
    const later = T0 + 6 * MIN + (RULES.flapWindowMin + 5) * MIN;
    const r = step(state, 'ok', later);
    expect(r.state.flapping).toBe(false);
    expect(r.actions[0]).toMatchObject({ type: 'create', kind: 'resolve' });
  });

  it('전이 목록은 상한에서 잘린다 (안 자르면 행이 계속 커진다)', () => {
    const rules = { ...RULES, flapTransitionsMax: 5 };
    let s = initialKeyState('ok', T0);
    for (let i = 1; i <= 20; i += 1) {
      s = step(s, i % 2 === 1 ? 'warning' : 'ok', T0 + i * MIN, {
        rules,
      }).state;
    }
    expect(s.recentTransitions).toHaveLength(5);
  });
});

describe('확인 불가 지속 (AC-ALERT08)', () => {
  it('기준 시간이 지나기 전에는 항목이 생기지 않는다', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'unknown', T0 + MIN).state;
    for (let i = 2; i < RULES.unknownAfterMin + 1; i += 1) {
      const r = step(s, 'unknown', T0 + i * MIN);
      s = r.state;
      expect(r.actions).toHaveLength(0);
    }
    const r = step(s, 'unknown', T0 + MIN + RULES.unknownAfterMin * MIN);
    expect(r.actions[0]).toMatchObject({
      type: 'create',
      severity: 'unknown',
      to: 'unknown',
    });
  });

  it('한 번 만든 뒤에는 같은 구간에서 다시 만들지 않는다', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'unknown', T0).state;
    s = step(s, 'unknown', T0 + (RULES.unknownAfterMin + 1) * MIN).state;
    const r = step(s, 'unknown', T0 + (RULES.unknownAfterMin + 10) * MIN);
    expect(r.actions).toHaveLength(0);
  });

  it('출처 키는 더 짧은 기준(출처 억제)을 쓴다', () => {
    expect(unknownDelayMin('source:kube', RULES)).toBe(
      RULES.sourceSuppressAfterMin,
    );
    expect(unknownDelayMin('area:pods', RULES)).toBe(RULES.unknownAfterMin);
  });
});

describe('워밍업·출처 억제 (AC-ALERT07·09)', () => {
  it('워밍업 중에는 상태만 따라가고 알림을 만들지 않는다', () => {
    const s = initialKeyState('ok', T0);
    const r = step(s, 'critical', T0 + MIN, { warmup: true });
    expect(r.actions).toHaveLength(0);
    expect(r.state.status).toBe('critical');
  });

  it('출처에 묶인 영역은 알림을 만들지 않고 누가 묶었는지 남긴다', () => {
    const s = initialKeyState('ok', T0);
    const r = step(s, 'critical', T0 + MIN, { suppressedBy: 'source:kube' });
    expect(r.actions).toHaveLength(0);
    expect(r.state.suppressedBy).toBe('source:kube');
  });
});

describe('저장 규칙', () => {
  it('종결형은 만들 때 닫는다', () => {
    expect(isTerminalKind('resolve')).toBe(true);
    expect(isTerminalKind('restart_summary')).toBe(true);
    expect(isTerminalKind('test')).toBe(true);
    expect(isTerminalKind('transition')).toBe(false);
    expect(isTerminalKind('escalation')).toBe(false);
  });

  it('jsonb 배열은 최신 쪽을 남기고 상한에서 자른다', () => {
    expect(capArray([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
    expect(capArray([1, 2], 5)).toEqual([1, 2]);
  });

  it('영향 객체 목록도 상한에서 잘린다', () => {
    const rules = { ...RULES, lastNotifiedTargetsMax: 3 };
    const s = initialKeyState('ok', T0);
    const r = step(s, 'critical', T0 + MIN, {
      targets: ['a', 'b', 'c', 'd', 'e'],
      rules,
    });
    expect(r.state.lastNotifiedTargets).toHaveLength(3);
  });

  it('변화가 없으면 `changed=false`라 상태 머신을 쓰지 않는다', () => {
    let s = initialKeyState('ok', T0);
    s = step(s, 'critical', T0 + MIN).state;
    const res = decideKey({
      key: 'area:pods',
      state: s,
      observation: { status: 'critical', targetRefs: [], suppressedBy: null },
      rules: RULES,
      now: T0 + 2 * MIN,
      warmup: false,
    });
    expect(res.changed).toBe(false);
    expect(res.actions).toHaveLength(0);
  });
});

describe('배지 심각도 순서', () => {
  it('메모리 폴백이 DB `min(severity)`와 같은 순서를 쓴다', () => {
    expect(worstSeverity(['warning', 'critical', 'unknown'])).toBe('critical');
    expect(worstSeverity(['unknown', 'warning'])).toBe('warning');
    expect(worstSeverity(['resolved'])).toBeNull();
    expect(worstSeverity([])).toBeNull();
  });
});

describe('발송 상태 enum', () => {
  it('계약 union과 DB enum이 **같은 집합**이다 (한쪽만 늘면 저장이 조용히 실패한다)', () => {
    const db = Object.values(AlertDeliveryStatus).sort();
    expect([...DISPATCH_STATES].sort()).toEqual(db);
    expect([...DB_DELIVERY_STATUSES].sort()).toEqual(db);
  });

  it('짝 없는 해제와 발송 정지를 `failed`로 뭉뚱그리지 않는다', () => {
    expect(DISPATCH_STATES).toContain('skipped_no_pair');
    expect(DISPATCH_STATES).toContain('skipped_circuit_open');
  });
});
