import { MockPgSimulator } from './db-mock';

describe('MockPgSimulator', () => {
  const t0 = Date.parse('2026-09-19T05:00:00.000Z');

  it('warning 시나리오: 두 번째 표본부터 카운터 차이가 계산된다', () => {
    const sim = new MockPgSimulator('warning');
    const first = sim.next(t0);
    const second = sim.next(t0 + 15_000);
    expect(first.snapshot.reachable).toBe(true);
    expect(second.snapshot.throughput).not.toBeNull();
    expect(second.snapshot.overall).toBe('warning');
    // 쿼리 원문·클라이언트 주소 필드가 없다
    const json = JSON.stringify(second.snapshot);
    expect(json).not.toMatch(/"query"\s*:/);
    expect(json).not.toMatch(/client_addr|clientAddr/);
  });

  it('unreachable: 접속 불가 + 비밀번호 가림', () => {
    const s = new MockPgSimulator('unreachable').next(t0).snapshot;
    expect(s.reachable).toBe(false);
    expect(s.overall).toBe('critical');
    expect(s.error).not.toContain('s3cret');
  });

  it('standby: 복제 지연 주의', () => {
    const sim = new MockPgSimulator('standby');
    sim.next(t0);
    const s = sim.next(t0 + 15_000).snapshot;
    const rep = s.checks.find((c) => c.id === 'replication_lag')!;
    expect(rep.applicable).toBe(true);
    expect(['warning', 'critical']).toContain(rep.level);
  });
});
