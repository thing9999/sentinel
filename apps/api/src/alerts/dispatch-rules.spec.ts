/**
 * 발송 판정 테스트 (docs/api/alerts.md 3.1, AC-ALERT26·28·29·32).
 *
 * **이 파일이 지키는 가장 중요한 것**: `mock`에서 판정이 `send`가 되는 경우가
 * **하나도 없다**. 1단계에서는 "HTTP 클라이언트가 없다"로 아웃바운드 0건을 보였고,
 * P2에서 발송기가 생긴 뒤에는 **판정이 그 문 앞에서 멈춘다**는 것으로 보인다.
 */
import { ALERT_KINDS, ALERT_SEVERITIES } from './alerts.types';
import {
  decideDispatch,
  nextAttemptDelaySec,
  retryAfterSec,
  type DispatchContext,
} from './dispatch-rules';
import { HttpDiscordSender, safeDetail } from './discord-sender';

const LIVE: DispatchContext = {
  mode: 'live',
  configured: true,
  enabled: true,
  minSeverity: 'critical',
  sendUnknown: true,
  flapping: false,
  circuitOpen: false,
  parentDispatched: true,
};

describe('mock에서는 아웃바운드가 0건이다 (AC-ALERT26)', () => {
  it('종류·심각도·설정을 모두 조합해도 `send`가 하나도 나오지 않는다', () => {
    const flags = [true, false];
    let sends = 0;
    let total = 0;
    for (const kind of ALERT_KINDS) {
      for (const severity of ALERT_SEVERITIES) {
        for (const configured of flags) {
          for (const enabled of flags) {
            for (const sendUnknown of flags) {
              for (const parentDispatched of flags) {
                total += 1;
                const v = decideDispatch(kind, severity, {
                  ...LIVE,
                  mode: 'mock',
                  configured,
                  enabled,
                  sendUnknown,
                  parentDispatched,
                });
                if (v.action === 'send') sends += 1;
              }
            }
          }
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(sends).toBe(0);
  });

  it('mock 판정 결과는 `skipped_mock`이다 (오류가 아니라 기록)', () => {
    const v = decideDispatch('transition', 'critical', {
      ...LIVE,
      mode: 'mock',
    });
    expect(v).toEqual({ action: 'skip', state: 'skipped_mock' });
  });

  it('재시작 요약은 mock·live 어느 쪽에서도 **기록을 만들지 않는다**', () => {
    for (const mode of ['mock', 'live'] as const) {
      expect(
        decideDispatch('restart_summary', 'critical', { ...LIVE, mode }),
      ).toEqual({ action: 'none', state: null });
    }
  });
});

describe('발송 제외 사유를 나눠서 기록한다', () => {
  it('주소 없음 → 시도조차 하지 않는다 (오류가 아니다)', () => {
    expect(
      decideDispatch('transition', 'critical', { ...LIVE, configured: false }),
    ).toEqual({ action: 'skip', state: 'skipped_not_configured' });
  });

  it('끄기 → 발송만 멈춘다 (AC-ALERT29)', () => {
    expect(
      decideDispatch('transition', 'critical', { ...LIVE, enabled: false }),
    ).toEqual({ action: 'skip', state: 'skipped_disabled' });
  });

  it('심각도 하한 (AC-ALERT28)', () => {
    expect(
      decideDispatch('transition', 'warning', {
        ...LIVE,
        minSeverity: 'critical',
      }),
    ).toEqual({ action: 'skip', state: 'skipped_severity' });
    expect(
      decideDispatch('transition', 'warning', {
        ...LIVE,
        minSeverity: 'warning',
      }).action,
    ).toBe('send');
  });

  it('`unknown`은 심각도 순서와 **별개 축**이다', () => {
    expect(
      decideDispatch('transition', 'unknown', {
        ...LIVE,
        minSeverity: 'critical',
        sendUnknown: true,
      }).action,
    ).toBe('send');
    expect(
      decideDispatch('transition', 'unknown', { ...LIVE, sendUnknown: false }),
    ).toEqual({ action: 'skip', state: 'skipped_unknown_off' });
  });

  it('짝 없는 해제는 보내지 않는다 (AC-ALERT32)', () => {
    expect(
      decideDispatch('resolve', 'resolved', {
        ...LIVE,
        parentDispatched: false,
      }),
    ).toEqual({ action: 'skip', state: 'skipped_no_pair' });
    expect(
      decideDispatch('resolve', 'resolved', { ...LIVE, parentDispatched: true })
        .action,
    ).toBe('send');
  });

  it('플래핑·서킷은 `failed`가 아니라 각자의 사유로 남는다', () => {
    expect(
      decideDispatch('transition', 'critical', { ...LIVE, flapping: true })
        .state,
    ).toBe('skipped_flapping');
    expect(
      decideDispatch('transition', 'critical', { ...LIVE, circuitOpen: true })
        .state,
    ).toBe('skipped_circuit_open');
  });

  it('서킷이 플래핑보다 먼저 이긴다 (둘 다면 발송 정지가 원인이다)', () => {
    expect(
      decideDispatch('transition', 'critical', {
        ...LIVE,
        circuitOpen: true,
        flapping: true,
      }).state,
    ).toBe('skipped_circuit_open');
  });

  it('테스트 발송은 심각도 하한을 타지 않는다 (사용자가 방금 누른 버튼)', () => {
    expect(
      decideDispatch('test', 'unknown', {
        ...LIVE,
        minSeverity: 'critical',
        sendUnknown: false,
      }).action,
    ).toBe('send');
  });
});

describe('재시도', () => {
  it('백오프 목록을 다 쓰면 포기한다', () => {
    const backoff = [5, 30, 120];
    expect(nextAttemptDelaySec(0, backoff)).toBe(5);
    expect(nextAttemptDelaySec(1, backoff)).toBe(30);
    expect(nextAttemptDelaySec(2, backoff)).toBe(120);
    expect(nextAttemptDelaySec(3, backoff)).toBeNull();
  });

  it('429의 Retry-After를 지킨다 (초·날짜 형식 모두)', () => {
    expect(retryAfterSec('12', 5)).toBe(12);
    expect(retryAfterSec(null, 5)).toBe(5);
    expect(retryAfterSec('nonsense', 7)).toBe(7);
    const at = new Date(Date.now() + 20_000).toUTCString();
    expect(retryAfterSec(at, 5)).toBeGreaterThan(15);
  });

  it('비정상적으로 긴 대기는 1시간으로 자른다', () => {
    expect(retryAfterSec('999999', 5)).toBe(3600);
  });
});

describe('밖으로 나가는 문', () => {
  it('허용되지 않은 호스트로는 **요청을 만들지 않는다** (SSRF 차단)', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const sender = new HttpDiscordSender();
    const res = await sender.send(
      'https://evil.example.com/api/webhooks/1/x',
      'hi',
      ['discord.com'],
    );
    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    // 실패 사유에 주소를 담지 않는다
    expect(res.detail).not.toContain('evil.example.com');
    spy.mockRestore();
  });

  it('http(평문)도 막는다', async () => {
    const spy = jest.spyOn(globalThis, 'fetch');
    const sender = new HttpDiscordSender();
    const res = await sender.send('http://discord.com/api/webhooks/1/x', 'hi', [
      'discord.com',
    ]);
    expect(res.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('오류 문구는 항상 가림 처리를 거친다 (웹훅 URL이 메시지에 섞여 나온다)', () => {
    const leaked =
      '디스코드 응답 401 {"message":"Invalid Webhook Token","url":"https://discord.com/api/webhooks/123456789012345678/abcdefTOKEN"}';
    const out = safeDetail(leaked);
    expect(out).not.toContain('abcdefTOKEN');
    expect(out).not.toContain('/api/webhooks/123456789012345678/');
    expect(out).toContain('401');
  });
});
