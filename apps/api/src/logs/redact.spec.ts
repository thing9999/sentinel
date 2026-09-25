/**
 * 가림 규칙 테스트 (docs/api/logs.md 3절).
 *
 * 여기서 확인하는 것은 "가려졌다"뿐이 아니라 **"남아야 할 것이 남았다"**이다 —
 * 값만 가리고 구조를 지우지 않는 것이 이 기능의 목적이기 때문이다 (AC-LOG49).
 */
import {
  collapsePrivateKeyBlocks,
  createLineRedactor,
  maskNotation,
  REDACTION_RULES,
} from './redact';
import type { LogSegment } from './logs.types';

function render(segments: LogSegment[]): string {
  return segments.map((s) => s.v).join('');
}

function rulesOf(segments: LogSegment[]): string[] {
  return segments
    .filter((s): s is Extract<LogSegment, { t: 'masked' }> => s.t === 'masked')
    .flatMap((s) => s.rules.map((r) => r.id));
}

function once(line: string) {
  return createLineRedactor()(line);
}

describe('maskNotation', () => {
  it('앞 2글자 + 길이. 6자 미만은 앞글자도 없다', () => {
    expect(maskNotation('hunter2hunter2')).toBe('hu****(14자)');
    expect(maskNotation('abc')).toBe('****(3자)');
  });
});

describe('가림 규칙 (AC-LOG04·06)', () => {
  it('AWS 액세스 키를 가린다', () => {
    const r = once('using access key AKIAIOSFODNN7EXAMPLE for s3');
    expect(render(r.segments)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(rulesOf(r.segments)).toContain('aws_access_key');
  });

  it('Bearer 토큰·JWT를 가린다', () => {
    const r = once(
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    );
    expect(render(r.segments)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(rulesOf(r.segments).length).toBeGreaterThan(0);
  });

  it('password=값을 가린다', () => {
    const r = once('cfg password=s3cr3t-p4ssw0rd loaded');
    expect(render(r.segments)).not.toContain('s3cr3t-p4ssw0rd');
    expect(render(r.segments)).toContain('cfg password=');
    expect(rulesOf(r.segments)).toContain('kv_secret');
  });

  it('커넥션 스트링은 **자격 증명만** 가리고 호스트·포트·DB 이름은 남긴다 (AC-LOG06)', () => {
    const r = once(
      'connect failed: postgres://appuser:hunter2hunter2@postgres.db.svc:5432/app',
    );
    const out = render(r.segments);
    expect(out).not.toContain('hunter2hunter2');
    expect(out).toContain('postgres://');
    expect(out).toContain('@postgres.db.svc:5432/app');
    expect(rulesOf(r.segments)).toContain('conn_string');
  });

  it('벤더 토큰을 가린다', () => {
    const r = once('api_key=sk-ant-api03-EXAMPLEEXAMPLEEXAMPLEEXAMPLE0123 ok');
    expect(render(r.segments)).not.toContain(
      'sk-ant-api03-EXAMPLEEXAMPLEEXAMPLEEXAMPLE0123',
    );
  });

  it('환경 변수 덤프에서 민감한 값만 가리고 나머지는 남긴다', () => {
    const r = once(
      'env AWS_REGION=ap-northeast-2 NODE_ENV=production DB_PASSWORD=s3cr3t-p4ssw0rd APP_NAME=api',
    );
    const out = render(r.segments);
    expect(out).not.toContain('s3cr3t-p4ssw0rd');
    expect(out).toContain('AWS_REGION=ap-northeast-2');
    expect(out).toContain('APP_NAME=api');
  });

  it('커밋 해시는 가리되 **의심** 등급으로 알린다 (오탐을 사용자가 판단할 수 있게)', () => {
    const r = once(
      'starting api (commit 9f2c1d8a7b3e4f5061728394a5b6c7d8e9f01234)',
    );
    const masked = r.segments.filter((s) => s.t === 'masked');
    expect(masked).toHaveLength(1);
    expect(masked[0].t === 'masked' && masked[0].confidence).toBe('suspect');
    expect(rulesOf(r.segments)).toContain('long_opaque');
  });

  it('식별자(IP·인스턴스 ID)는 가리지 않는다', () => {
    const r = once('node i-0a1b2c3d4e5f60718 at 10.0.3.14 is NotReady');
    expect(render(r.segments)).toBe(
      'node i-0a1b2c3d4e5f60718 at 10.0.3.14 is NotReady',
    );
    expect(r.maskedCount).toBe(0);
  });

  it('평범한 줄은 건드리지 않는다', () => {
    const r = once('INFO  [http] GET /healthz 200 1ms');
    expect(render(r.segments)).toBe('INFO  [http] GET /healthz 200 1ms');
    expect(r.maskedCount).toBe(0);
  });
});

describe('sql_statement (AC-LOG49)', () => {
  it('Key (col)=(값)의 값만 가리고 **컬럼 이름·제약 이름·타임스탬프·PID는 남는다**', () => {
    const line =
      '2026-09-25 14:02:10.412 UTC [1834] DETAIL:  Key (email)=(a@b.com) already exists.';
    const r = once(line);
    const out = render(r.segments);
    expect(out).not.toContain('a@b.com');
    expect(out).toContain('Key (email)=(?)');
    // 구조가 남아야 한다 — 이것이 "줄 전체에 maskSqlLiterals를 돌리지 않는" 이유다
    expect(out).toContain('2026-09-25 14:02:10.412 UTC');
    expect(out).toContain('[1834]');
    expect(out).toContain('DETAIL:');
    expect(rulesOf(r.segments)).toContain('sql_statement');
  });

  it('Failing row contains (…)를 통째로 가린다 (행 전체가 사용자 데이터다)', () => {
    const r = once(
      '2026-09-25 14:02:10.413 UTC [1834] DETAIL:  Failing row contains (1, alice, a@b.com, 2026-09-25).',
    );
    const out = render(r.segments);
    expect(out).not.toContain('alice');
    expect(out).not.toContain('a@b.com');
    expect(out).toContain('Failing row contains (?)');
    expect(out).toContain('[1834]');
  });

  it('STATEMENT: 리터럴만 `?`로 바꾸고 테이블·컬럼 이름은 남긴다', () => {
    const r = once(
      `2026-09-25 14:02:10.413 UTC [1834] STATEMENT:  INSERT INTO users (email, name) VALUES ('a@b.com', 'alice')`,
    );
    const out = render(r.segments);
    expect(out).not.toContain('a@b.com');
    expect(out).not.toContain('alice');
    expect(out).toContain('INSERT INTO users (email, name) VALUES');
    expect(out).toContain('2026-09-25 14:02:10.413 UTC');
    expect(rulesOf(r.segments)).toContain('sql_statement');
  });

  it('제약 위반 헤더 줄(값 없음)은 그대로 남는다', () => {
    const line =
      '2026-09-25 14:02:10.412 UTC [1834] ERROR:  duplicate key value violates unique constraint "users_email_key"';
    expect(render(once(line).segments)).toBe(line);
  });

  it('앱 스택 트레이스의 줄 번호를 `?`로 만들지 않는다', () => {
    const mask = createLineRedactor();
    const lines = [
      'ERROR [http] POST /orders 500',
      '\tat com.example.order.OrderService.place(OrderService.java:142)',
    ];
    const out = lines.map((l) => render(mask(l).segments));
    expect(out[1]).toContain('OrderService.java:142');
  });

  it('여러 줄 문장은 상태를 이어서 가린다 (조회 1건당 가림기 하나)', () => {
    const mask = createLineRedactor();
    const lines = [
      `2026-09-25 14:02:10 UTC [1] STATEMENT:  INSERT INTO t (a) VALUES`,
      `\t('secret-value')`,
    ];
    const out = lines.map((l) => render(mask(l).segments));
    expect(out[1]).not.toContain('secret-value');
  });
});

describe('개인 키 블록', () => {
  it('블록 전체를 한 줄로 접는다', () => {
    const { lines, collapsed } = collapsePrivateKeyBlocks([
      'before',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA',
      'Xc5Yd6Ze7Af8Bg9',
      '-----END RSA PRIVATE KEY-----',
      'after',
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('before');
    expect(lines[2]).toBe('after');
    expect(collapsed).toEqual([{ index: 1, count: 4 }]);
  });

  it('닫히지 않은 블록도 남은 줄을 전부 접는다 (fail-closed 방향)', () => {
    const { lines, collapsed } = collapsePrivateKeyBlocks([
      '-----BEGIN PRIVATE KEY-----',
      'AAAA',
      'BBBB',
    ]);
    expect(lines).toHaveLength(1);
    expect(collapsed[0].count).toBe(3);
  });
});

describe('fail-closed (AC-LOG10)', () => {
  it('가림 처리 중 예외가 나면 **원문을 통과시키지 않는다**', () => {
    const redact = createLineRedactor();
    const boom = {
      toString(): string {
        throw new Error('boom');
      },
    };
    // 문자열이 아닌 값이 들어와 내부에서 터지는 상황을 흉내 낸다
    const r = redact(boom as unknown as string);
    expect(r.failed).toBe(true);
    expect(r.segments).toEqual([]);
  });
});

describe('규칙 목록', () => {
  it('규칙 id가 중복되지 않는다', () => {
    const ids = REDACTION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('개수를 숫자로 고정하지 않는다 — 목록이 정본이고 앞으로 늘어난다', () => {
    expect(REDACTION_RULES.length).toBeGreaterThan(0);
    expect(REDACTION_RULES.map((r) => r.id)).toContain('sql_statement');
  });

  it('잘못된 추가 정규식은 무시하고 기능을 멈추지 않는다', () => {
    const redact = createLineRedactor(['(unclosed', 'zzz-secret']);
    const r = redact('token zzz-secret here');
    expect(render(r.segments)).not.toContain('zzz-secret');
  });
});
