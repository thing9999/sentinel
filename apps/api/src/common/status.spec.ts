import {
  StatusChangeTracker,
  SustainTracker,
  statusFromReasons,
  worstStatus,
} from './status';

describe('status helpers', () => {
  it('worstStatus: critical > warning > unknown > ok', () => {
    expect(worstStatus([])).toBe('ok');
    expect(worstStatus(['ok', 'unknown'])).toBe('unknown');
    expect(worstStatus(['unknown', 'warning'])).toBe('warning');
    expect(worstStatus(['warning', 'critical', 'ok'])).toBe('critical');
  });

  it('statusFromReasons: 나쁜 순서로 정렬', () => {
    const r = statusFromReasons([
      { code: 'A', text: 'a', status: 'warning' },
      { code: 'B', text: 'b', status: 'critical' },
      { code: 'C', text: 'c', status: 'ok' },
    ]);
    expect(r.status).toBe('critical');
    expect(r.reasons.map((x) => x.code)).toEqual(['B', 'A', 'C']);
  });

  it('SustainTracker: 한 번 튀면 그대로, 연속 3회면 올림, 내릴 때는 즉시', () => {
    const s = new SustainTracker(3);
    expect(s.apply('k', 'critical')).toBe('ok');
    expect(s.apply('k', 'ok')).toBe('ok');
    expect(s.apply('k', 'critical')).toBe('ok');
    expect(s.apply('k', 'critical')).toBe('ok');
    expect(s.apply('k', 'critical')).toBe('critical');
    expect(s.apply('k', 'warning')).toBe('warning');
    expect(s.apply('k', 'ok')).toBe('ok');
  });

  it('SustainTracker: warning→critical 섞여도 주의는 3회로 올라감', () => {
    const s = new SustainTracker(3);
    s.apply('k', 'warning');
    s.apply('k', 'critical');
    expect(s.apply('k', 'critical')).toBe('warning');
    expect(s.apply('k', 'critical')).toBe('critical');
  });

  it('StatusChangeTracker: 상태가 바뀔 때만 시각 갱신', () => {
    const t = new StatusChangeTracker();
    expect(t.track('x', 'ok', 't1')).toBe('t1');
    expect(t.track('x', 'ok', 't2')).toBe('t1');
    expect(t.track('x', 'warning', 't3')).toBe('t3');
  });
});
