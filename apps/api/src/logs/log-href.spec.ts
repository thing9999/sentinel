import {
  buildLogHref,
  buildPodKeyLogHref,
  LOG_HREF_ENTRY_RULES,
  type LogHrefEntry,
  type LogHrefTarget,
  type LogLinkPolicyValue,
} from './log-href';

/**
 * 로그 링크 규칙은 **이 파일 한 곳**이다 (docs/api/logs.md 11.4, PM 결정 D3·Q12).
 * - "지금 상태"에서 들어오는 자리(파드·매트릭스·워크로드) → `follow=1`
 * - "지난 시점"을 가리키는 자리(알림·Warning 이벤트) → follow 없음 + `at`
 */
describe('buildLogHref — 자리별 규칙 (D3·Q12)', () => {
  const on: LogLinkPolicyValue = { enabled: true, denyNamespaces: [] };
  const AT = '2026-09-25T14:02:05.000Z';

  const targetOf = (entry: LogHrefEntry): LogHrefTarget => {
    switch (entry) {
      case 'workload':
        return {
          entry,
          namespace: 'prod',
          workloadKey: 'Deployment/prod/api',
        };
      case 'event':
      case 'alert':
        return { entry, namespace: 'prod', pod: 'api-1', at: AT };
      default:
        return { entry, namespace: 'prod', pod: 'api-1' };
    }
  };
  const entries = Object.keys(LOG_HREF_ENTRY_RULES) as LogHrefEntry[];

  it('follow와 at은 어느 자리에서도 동시에 붙지 않는다 (전수)', () => {
    for (const entry of entries) {
      const href = buildLogHref(on, targetOf(entry)).href!;
      const q = new URLSearchParams(href.split('?')[1]);
      expect(q.has('follow') && q.has('at')).toBe(false);
      expect(q.get('follow') === '1').toBe(LOG_HREF_ENTRY_RULES[entry].follow);
      expect(q.has('at')).toBe(LOG_HREF_ENTRY_RULES[entry].at);
    }
  });

  it('지금 상태(파드·매트릭스·워크로드)는 follow=1, 지난 시점(알림·이벤트)은 at', () => {
    expect(LOG_HREF_ENTRY_RULES).toEqual({
      pod: { follow: true, at: false },
      controlPlane: { follow: true, at: false },
      workload: { follow: true, at: false },
      event: { follow: false, at: true },
      alert: { follow: false, at: true },
    });
  });

  it('컨트롤 플레인 매트릭스 링크는 follow=1 (D3)', () => {
    expect(
      buildPodKeyLogHref(on, 'controlPlane', 'kube-system/kube-apiserver-i-0a'),
    ).toBe('/logs?namespace=kube-system&pod=kube-apiserver-i-0a&follow=1');
  });

  it('알림 링크는 follow 없이 at만 (D3)', () => {
    expect(buildLogHref(on, targetOf('alert')).href).toBe(
      `/logs?namespace=prod&pod=api-1&at=${encodeURIComponent(AT)}`,
    );
  });

  it('시각을 모르면 at을 붙이지 않는다 (follow도 붙지 않는다)', () => {
    expect(
      buildLogHref(on, {
        entry: 'alert',
        namespace: 'prod',
        pod: 'api-1',
        at: null,
      }).href,
    ).toBe('/logs?namespace=prod&pod=api-1');
  });

  it('워크로드 링크는 pod 대신 workload(워크로드 키)', () => {
    const href = buildLogHref(on, targetOf('workload')).href!;
    const q = new URLSearchParams(href.split('?')[1]);
    expect(q.get('workload')).toBe('Deployment/prod/api');
    expect(q.has('pod')).toBe(false);
    expect(q.get('follow')).toBe('1');
  });

  it('LOGS_ENABLED=false면 모든 자리에서 null + logs_disabled', () => {
    for (const entry of entries) {
      expect(
        buildLogHref({ enabled: false, denyNamespaces: [] }, targetOf(entry)),
      ).toEqual({ href: null, blocked: 'logs_disabled' });
    }
  });

  it('차단 네임스페이스면 모든 자리에서 null + namespace_denied', () => {
    for (const entry of entries) {
      expect(
        buildLogHref(
          { enabled: true, denyNamespaces: ['prod'] },
          targetOf(entry),
        ),
      ).toEqual({ href: null, blocked: 'namespace_denied' });
    }
  });

  it('podKey 형식이 아니면 null', () => {
    expect(buildPodKeyLogHref(on, 'pod', null)).toBeNull();
    expect(buildPodKeyLogHref(on, 'pod', 'no-slash')).toBeNull();
    expect(buildPodKeyLogHref(on, 'pod', '/x')).toBeNull();
    expect(buildPodKeyLogHref(on, 'pod', 'x/')).toBeNull();
  });
});
