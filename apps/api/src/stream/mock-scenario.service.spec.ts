import type { MockScenarioTarget } from '../common/extension-points';
import { MockScenarioService } from './mock-scenario.service';

function target(
  group: MockScenarioTarget['group'],
  scenarios: string[],
  extras: Record<string, unknown> = {},
): MockScenarioTarget & { set: string[] } {
  let cur = scenarios[0];
  const t = {
    group,
    scenarios,
    set: [] as string[],
    currentScenario: () => cur,
    setScenario(n: string) {
      cur = n;
      t.set.push(n);
    },
    ...extras,
  };
  return t;
}

function make(mode: 'mock' | 'live', targets: MockScenarioTarget[]) {
  const discovery = {
    getProviders: () =>
      targets.map((t) => ({ instance: t, metatype: function Target() {} })),
  };
  const svc = new MockScenarioService(
    mode,
    discovery as never,
    {
      get: () => true,
    } as never,
  );
  svc.onApplicationBootstrap();
  return svc;
}

describe('MockScenarioService', () => {
  it('live면 GET은 enabled:false, 변경은 403 MOCK_MODE_ONLY', () => {
    const svc = make('live', [target('cluster', ['mixed'])]);
    expect(svc.list()).toMatchObject({ enabled: false, groups: [] });
    expect(() => svc.set('cluster', 'mixed')).toThrow(
      expect.objectContaining({ code: 'MOCK_MODE_ONLY' }) as Error,
    );
  });

  it('그룹별 위임, 없는 그룹 404, 없는 시나리오 400', () => {
    const c = target('cluster', ['mixed', 'healthy']);
    const svc = make('mock', [c]);
    expect(svc.set('cluster', 'healthy').active).toBe('healthy');
    expect(() => svc.set('nope', 'x')).toThrow(
      expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }) as Error,
    );
    expect(() => svc.set('cluster', 'zzz')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });

  it('대상의 options/defaultScenario/fastTimers를 쓴다', () => {
    const cost = target('cost', ['normal', 'budget-over'], {
      options: [{ id: 'budget-over', label: '예산 초과!', description: 'd' }],
      defaultScenario: 'normal',
    });
    let fast = true;
    const adv = target('advisor', ['normal', 'timeout'], {
      setFastTimers(v: boolean) {
        fast = v;
      },
    });
    // 어드바이저는 fastTimers를 getter로 제공한다
    Object.defineProperty(adv, 'fastTimers', { get: () => fast });
    const svc = make('mock', [adv, cost]);
    const list = svc.list();
    expect(list.groups.map((g) => g.id)).toEqual(['cost', 'advisor']);
    expect(list.groups[0].options[1]).toEqual({
      id: 'budget-over',
      label: '예산 초과!',
      description: 'd',
    });
    expect(svc.set('advisor', 'timeout', false).fastTimers).toBe(false);
    cost.setScenario('budget-over');
    svc.reset();
    expect(cost.currentScenario()).toBe('normal');
    expect(adv.currentScenario()).toBe('normal');
  });
});
