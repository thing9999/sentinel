import { mockAlertRecords } from './mock-alerts';

/**
 * 발송 칩 2종(`skipped_no_pair`·`skipped_circuit_open`)을 mock에서 **눈으로** 보기 위한 이력 픽스처.
 * 판정 순서상 `ALERTS_DISPATCH=mock`이 먼저 이겨 실시간으로는 이 두 상태가 생기지 않는다(designer R9).
 * 픽스처일 뿐이고 발송 판정·발송기는 그대로다(384조합 테스트는 `dispatch-rules.spec.ts`).
 */
describe('mock alerts — webhook-failed 발송 칩', () => {
  const recs = mockAlertRecords('webhook-failed');
  const states = recs.map((r) => r.deliveries[0]?.state);

  it('발송 정지 2건 + 짝 없는 해제 1건 + 나머지는 failed', () => {
    expect(states.filter((s) => s === 'skipped_circuit_open')).toHaveLength(2);
    expect(states.filter((s) => s === 'skipped_no_pair')).toHaveLength(1);
    expect(states.filter((s) => s === 'failed')).toHaveLength(recs.length - 3);
  });

  it('짝 없음은 해제 알림에만, 발송 정지는 가장 최근 알림에', () => {
    const noPair = recs.find(
      (r) => r.deliveries[0]?.state === 'skipped_no_pair',
    )!;
    expect(noPair.kind).toBe('resolve');
    const newestTwo = [...recs]
      .filter((r) => r.kind !== 'resolve')
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, 2);
    for (const r of newestTwo)
      expect(r.deliveries[0]?.state).toBe('skipped_circuit_open');
  });

  it('기본 시나리오는 그대로 skipped_mock', () => {
    expect(
      mockAlertRecords('default').every(
        (r) =>
          r.deliveries.length === 0 || r.deliveries[0].state === 'skipped_mock',
      ),
    ).toBe(true);
  });
});
