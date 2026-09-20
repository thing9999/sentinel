import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('선택 값이 모두 비어 있어도 기본값으로 통과한다', () => {
    const env = validateEnv({
      DATABASE_URL: '',
      KUBECONFIG: '',
      MONITOR_DB_URL: '',
      PROMETHEUS_URL: '',
      AWS_REGION: '',
      AWS_PROFILE: '',
      AGENT_BRIDGE_TOKEN: '',
    });
    expect(env.PORT).toBe(3001);
    expect(env.DATA_SOURCE).toBe('mock');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.AGENT_BRIDGE_URL).toBe('http://localhost:3002');
    expect(env.COST_EXPLORER_CACHE_TTL_SEC).toBe(21600);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.KUBECONFIG).toBeUndefined();
  });

  it('문자열 숫자를 숫자로 변환한다', () => {
    const env = validateEnv({
      PORT: '4000',
      COST_EXPLORER_CACHE_TTL_SEC: '7200',
    });
    expect(env.PORT).toBe(4000);
    expect(env.COST_EXPLORER_CACHE_TTL_SEC).toBe(7200);
  });

  it('DATA_SOURCE가 mock|live가 아니면 실패한다', () => {
    expect(() => validateEnv({ DATA_SOURCE: 'prod' })).toThrow(/DATA_SOURCE/);
  });

  it('PORT가 숫자가 아니면 실패한다', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });

  it('DB 대상 StatefulSet은 네임스페이스·이름을 함께 설정해야 한다', () => {
    expect(() => validateEnv({ DB_TARGET_NAMESPACE: 'data' })).toThrow(
      /DB_TARGET_NAMESPACE, DB_TARGET_STATEFULSET/,
    );
    const env = validateEnv({
      DB_TARGET_NAMESPACE: 'data',
      DB_TARGET_STATEFULSET: 'postgres',
      MONITOR_DB_EXPECTED_STANDBYS: '1',
    });
    expect(env.DB_TARGET_STATEFULSET).toBe('postgres');
    expect(env.MONITOR_DB_EXPECTED_STANDBYS).toBe(1);
  });

  it('MONITOR_DB_URL은 postgres:// 형식', () => {
    expect(() => validateEnv({ MONITOR_DB_URL: 'mysql://x' })).toThrow(
      /MONITOR_DB_URL/,
    );
    expect(
      validateEnv({
        MONITOR_DB_URL:
          'postgres://sentinel_monitor:pw@host.docker.internal:15432/postgres',
      }).MONITOR_DB_URL,
    ).toContain('15432');
  });

  it('비용·어드바이저 선택 값 검증', () => {
    const env = validateEnv({
      COST_MONTHLY_BUDGET_USD: '800',
      COST_EXPLORER_METRIC: 'AmortizedCost',
      COST_EXPLORER_DAILY_CALL_LIMIT: '20',
      ADVISOR_BRIDGE: 'live',
    });
    expect(env.COST_MONTHLY_BUDGET_USD).toBe(800);
    expect(env.COST_EXPLORER_DAILY_CALL_LIMIT).toBe(20);
    expect(() => validateEnv({ COST_EXPLORER_CACHE_TTL_SEC: '60' })).toThrow(
      /COST_EXPLORER_CACHE_TTL_SEC/,
    );
    expect(() => validateEnv({ COST_EXPLORER_METRIC: 'Blended' })).toThrow(
      /COST_EXPLORER_METRIC/,
    );
  });

  it('새 기본값', () => {
    const env = validateEnv({});
    expect(env.SSE_MAX_CLIENTS).toBe(20);
    expect(env.DB_HEALTH_INTERVAL_SEC).toBe(15);
    expect(env.METRICS_INTERVAL_SEC).toBe(15);
    expect(env.SYSTEM_NAMESPACES).toContain('kube-system');
  });
});
