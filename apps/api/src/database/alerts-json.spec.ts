import { AlertDeliveryStatus, AlertSeverity } from './generated/prisma/enums';
import { ALERT_KEYS, ALERT_SYSTEM_KEYS, alertTargetRef } from './alerts-json';

/**
 * 배지 질의(`docs/db/schema.md` 4절)가 **enum 선언 순서에 기대고 있다.** 순서가 바뀌면
 * 질의가 조용히 틀린 답을 내므로 여기서 못을 박는다.
 *
 *   SELECT count(*) AS unread, min(severity) AS worst
 *     FROM alerts
 *    WHERE data_source = $1 AND acknowledged_at IS NULL AND severity < 'resolved';
 *
 *   - `critical`이 **맨 앞** → `min(severity)`가 곧 "최악 심각도"
 *   - `resolved`가 **맨 뒤** → `severity < 'resolved'`가 "해제를 뺀 나머지"이고,
 *     `<>`와 달리 **인덱스 경계**가 되어 안 읽은 행만 훑는다
 */
describe('alert_severity 선언 순서 (배지 질의의 전제)', () => {
  it('critical이 처음, resolved가 마지막이다', () => {
    expect(Object.keys(AlertSeverity)).toEqual([
      'critical',
      'warning',
      'unknown',
      'resolved',
    ]);
  });

  it('심각도 순서가 docs/api/common.md 2.1 집계 우선순위와 같다', () => {
    const order = Object.keys(AlertSeverity);
    expect(order.indexOf('critical')).toBeLessThan(order.indexOf('warning'));
    expect(order.indexOf('warning')).toBeLessThan(order.indexOf('unknown'));
    // 해제(좋은 소식)는 배지를 올리지 않으므로 반드시 맨 뒤여야 한다
    expect(order[order.length - 1]).toBe('resolved');
  });
});

describe('alert_delivery_status', () => {
  it('"보내지 않은 이유"를 실패와 구분해 기록할 수 있다', () => {
    // AC-ALERT32: 발생 알림을 안 보낸 채널로는 해제 알림도 안 보낸다
    expect(AlertDeliveryStatus.skipped_no_pair).toBe('skipped_no_pair');
    // 연속 실패 차단(alerts 3.3.2) 중 건너뜀 — failed와 구분돼야 추적할 수 있다
    expect(AlertDeliveryStatus.skipped_circuit_open).toBe(
      'skipped_circuit_open',
    );
    expect(Object.keys(AlertDeliveryStatus)).toHaveLength(12);
  });
});

describe('알림 키', () => {
  it('P1 알림 키는 8개이고 영역/출처 접두어를 쓴다', () => {
    expect(ALERT_KEYS).toHaveLength(8);
    expect(ALERT_KEYS.every((k) => /^(area|source):/.test(k))).toBe(true);
  });

  it('영역이 없는 시스템 키는 상태 머신을 두지 않는다', () => {
    expect(Object.values(ALERT_SYSTEM_KEYS)).toEqual([
      'system:restart',
      'system:test',
    ]);
    expect(ALERT_KEYS).not.toContain('system:restart');
  });

  it('영향 객체 참조 문자열 (namespace 없는 리소스 포함)', () => {
    expect(
      alertTargetRef({ kind: 'Pod', namespace: 'prod', name: 'api-1' }),
    ).toBe('Pod/prod/api-1');
    expect(
      alertTargetRef({ kind: 'Node', namespace: null, name: 'i-0abc' }),
    ).toBe('Node/-/i-0abc');
  });
});
