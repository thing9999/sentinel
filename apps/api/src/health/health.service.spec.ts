import { ConfigService } from '@nestjs/config';
import { SourceRegistry } from '../common/source-registry.service';
import { validateEnv } from '../config/env.validation';
import { HealthService, hasAwsCredentials } from './health.service';

function makeService(raw: Record<string, unknown>): {
  svc: HealthService;
  registry: SourceRegistry;
} {
  const env = validateEnv(raw);
  const config = new ConfigService(env);
  const registry = new SourceRegistry(env.DATA_SOURCE);
  const prisma = { isConnected: false } as never;
  return {
    svc: new HealthService(config as never, env.DATA_SOURCE, registry, prisma),
    registry,
  };
}

describe('HealthService', () => {
  it('mock 모드면 모든 check가 mock이고 status ok', () => {
    const { svc } = makeService({});
    const res = svc.getHealth();
    expect(res.status).toBe('ok');
    expect(res.dataSource).toBe('mock');
    expect(typeof res.uptimeSec).toBe('number');
    expect(typeof res.serverTime).toBe('string');
    for (const c of Object.values(res.checks)) {
      expect(c).toEqual({
        state: 'mock',
        configured: false,
        message: null,
        checkedAt: null,
      });
    }
  });

  it('live에서 설정 없는 출처는 not_configured (degraded 아님)', () => {
    const { svc } = makeService({ DATA_SOURCE: 'live' });
    const res = svc.getHealth();
    expect(res.dataSource).toBe('live');
    expect(res.checks.kube.state).toBe('not_configured');
    expect(res.checks.dashboardDb.state).toBe('not_configured');
    expect(res.status).toBe('ok');
  });

  it('설정된 출처가 unavailable/stale이면 degraded', () => {
    const { svc, registry } = makeService({
      DATA_SOURCE: 'live',
      DATABASE_URL: 'postgres://u:p@db:5432/d',
    });
    registry.update('kube', {
      state: 'ok',
      lastAttemptAt: '2026-09-19T00:00:00.000Z',
    });
    registry.markFailure('metrics', {
      code: 'METRICS_API_UNAVAILABLE',
      message: 'metrics.k8s.io API 없음',
    });
    const res = svc.getHealth();
    expect(res.checks.metrics.state).toBe('unavailable');
    expect(res.checks.metrics.message).toBe('metrics.k8s.io API 없음');
    expect(res.checks.dashboardDb.state).toBe('unavailable');
    expect(res.status).toBe('degraded');
  });

  it('AWS 자격 증명: 환경 변수·IRSA를 인식', () => {
    expect(
      hasAwsCredentials({ AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y' }),
    ).toBe(true);
    expect(
      hasAwsCredentials({ AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/t' }),
    ).toBe(true);
    expect(
      hasAwsCredentials({
        AWS_SHARED_CREDENTIALS_FILE: '/nonexistent/credentials',
        AWS_CONFIG_FILE: '/nonexistent/config',
      }),
    ).toBe(false);
  });
});
