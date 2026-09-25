import {
  createPgLogValueMasker,
  maskPgDetailValues,
  maskPgLogValues,
  maskSqlLiterals,
  redactConnectionString,
  redactDiscordWebhookUrls,
  redactSecrets,
  sanitizeErrorMessage,
  sanitizeQueryText,
  truncateText,
} from './sanitize';

describe('truncateText', () => {
  it('최대 길이를 넘으면 …로 자른다', () => {
    expect(truncateText('abcdef', 4)).toBe('abc…');
    expect(truncateText('abc', 4)).toBe('abc');
    expect(truncateText('abc', 0)).toBe('');
  });
});

describe('maskSqlLiterals', () => {
  it('문자열·숫자 리터럴을 가리고 파라미터·식별자는 유지한다', () => {
    expect(
      maskSqlLiterals(
        `SELECT * FROM "Users" WHERE email = 'a@b.com' AND id = 42 AND x = $1`,
      ),
    ).toBe(`SELECT * FROM "Users" WHERE email = ? AND id = ? AND x = $1`);
  });

  it('E 문자열의 백슬래시 이스케이프와 두 따옴표 이스케이프', () => {
    expect(maskSqlLiterals(`SELECT E'it\\'s', 'o''k'`)).toBe('SELECT ?, ?');
  });

  it('달러 인용과 주석을 가린다', () => {
    const out = maskSqlLiterals(
      `SELECT $fn$secret$fn$ /* user=kim */ -- 1234\n, t1.c2`,
    );
    expect(out.replace(/\s+/g, ' ')).toBe('SELECT ? , t1.c2');
  });

  it('잘린(닫히지 않은) 리터럴은 끝까지 가린다', () => {
    expect(maskSqlLiterals(`UPDATE t SET card = '4111-1111`)).toBe(
      'UPDATE t SET card = ?',
    );
  });

  it('ALTER ROLE PASSWORD 리터럴도 가린다', () => {
    expect(
      sanitizeQueryText(`ALTER ROLE app PASSWORD 'hunter2'`),
    ).not.toContain('hunter2');
  });
});

describe('sanitizeQueryText', () => {
  it('공백 정리 후 최대 길이로 자른다', () => {
    const q = sanitizeQueryText(
      `SELECT   a,\n  b FROM t WHERE c = 'x'`.repeat(20),
      40,
    );
    expect(q?.length).toBe(40);
    expect(q?.endsWith('…')).toBe(true);
    expect(q).not.toContain("'x'");
  });

  it('null은 null', () => {
    expect(sanitizeQueryText(null)).toBeNull();
  });
});

describe('redact', () => {
  it('URL 접속 문자열의 비밀번호', () => {
    expect(
      redactConnectionString('postgres://mon:p%40ss@db:5432/postgres'),
    ).toBe('postgres://mon:***@db:5432/postgres');
  });

  it('key=value 비밀값과 AWS 키', () => {
    const out = redactSecrets(
      'host=db password=abc123 sslmode=require token: xyz AKIAABCDEFGHIJKLMNOP',
    );
    expect(out).toBe('host=db password=*** sslmode=require token: *** ***');
  });

  // alerts 3.4.3 / AC-ALERT13·20: 웹훅 주소는 그 자체가 비밀값이라 통째로 가린다
  describe('디스코드 웹훅 URL', () => {
    const URL_OK =
      'https://discord.com/api/webhooks/123456789012345678/AbCdEf-0123_XyZ7f3a';

    it('redactSecrets가 문장 안의 웹훅 주소를 통째로 가린다', () => {
      const out = redactSecrets(`발송 실패: POST ${URL_OK} → 401 Unauthorized`);
      expect(out).toBe('발송 실패: POST [웹훅 주소 가림] → 401 Unauthorized');
      expect(out).not.toContain('discord.com');
      expect(out).not.toContain('7f3a');
    });

    it('sanitizeErrorMessage(화면의 "판단 이유")에도 남지 않는다', () => {
      const err = new Error(`request to ${URL_OK} failed`);
      expect(sanitizeErrorMessage(err)).not.toContain('webhooks');
    });

    it('discordapp.com·서브도메인·http도 가린다', () => {
      for (const u of [
        'https://discordapp.com/api/webhooks/1/tok',
        'https://ptb.discord.com/api/webhooks/1/tok',
        'http://discord.com/api/webhooks/1/tok',
      ]) {
        expect(redactDiscordWebhookUrls(`보냄 ${u} 끝`)).toBe(
          '보냄 [웹훅 주소 가림] 끝',
        );
      }
    });

    it('전역 정규식을 재사용해도 결과가 흔들리지 않는다 (lastIndex)', () => {
      const line = `a ${URL_OK} b ${URL_OK} c`;
      const first = redactSecrets(line);
      expect(redactSecrets(line)).toBe(first);
      expect(first).toBe('a [웹훅 주소 가림] b [웹훅 주소 가림] c');
    });

    it('디스코드가 아닌 주소는 건드리지 않는다', () => {
      expect(redactSecrets('GET https://example.com/api/webhooks/1/x')).toBe(
        'GET https://example.com/api/webhooks/1/x',
      );
    });
  });
});

describe('sanitizeErrorMessage', () => {
  it('SQLSTATE를 붙이고 비밀번호를 가린다', () => {
    const err = Object.assign(
      new Error('connect failed postgres://u:pw@h/db\n  detail'),
      { code: '08006' },
    );
    expect(sanitizeErrorMessage(err)).toBe(
      '[08006] connect failed postgres://u:***@h/db detail',
    );
  });

  it('Error가 아니어도 문자열로 만든다', () => {
    expect(sanitizeErrorMessage(undefined)).toBe('알 수 없는 오류');
  });
});

/**
 * Postgres 서버 로그 줄의 값 가림 (logs `sql_statement` 규칙, AC-LOG49).
 * 검사 기준: 리터럴만 `?`, **테이블·컬럼·구조는 남음**, `DETAIL:` 값도 가려짐, 통째로 지우지 않음.
 */
describe('maskPgLogValues (AC-LOG49)', () => {
  const PII = ['a@b.com', 'alice', '010-1234-5678', 'acme'];
  const noPii = (s: string) => PII.filter((p) => s.includes(p));

  describe('DETAIL: 값 (이 건을 시작한 이유)', () => {
    it('Key (컬럼)=(값) — 값만 가리고 컬럼 이름은 남긴다', () => {
      const out = maskPgLogValues(
        'DETAIL:  Key (email)=(a@b.com) already exists.',
      );
      expect(out).toBe('DETAIL:  Key (email)=(?) already exists.');
      expect(noPii(out)).toEqual([]);
    });

    it('숫자 값도, 복합 키도 가린다 (테이블 이름은 남는다)', () => {
      expect(
        maskPgLogValues(
          'DETAIL:  Key (user_id)=(42) is not present in table "users".',
        ),
      ).toBe('DETAIL:  Key (user_id)=(?) is not present in table "users".');
      expect(
        maskPgLogValues(
          'DETAIL:  Key (tenant, email)=(acme, a@b.com) already exists.',
        ),
      ).toBe('DETAIL:  Key (tenant, email)=(?) already exists.');
    });

    it('Failing row contains (…) — 행 전체가 사용자 데이터라 통째로 가린다', () => {
      const out = maskPgLogValues(
        'DETAIL:  Failing row contains (1, alice, a@b.com, 2026-01-01).',
      );
      expect(out).toBe('DETAIL:  Failing row contains (?).');
      expect(noPii(out)).toEqual([]);
    });

    it('parameters: 바인드 값', () => {
      expect(
        maskPgLogValues(
          "DETAIL:  parameters: $1 = 'a@b.com', $2 = '010-1234-5678'",
        ),
      ).toBe('DETAIL:  parameters: $1 = ?, $2 = ?');
    });
  });

  describe('SQL 문장 줄 — 구조는 남고 값만 사라진다', () => {
    it('STATEMENT: 뒤의 리터럴만 ? (타임스탬프·PID는 그대로)', () => {
      const out = maskPgLogValues(
        "2026-09-24 12:00:00.123 UTC [123] STATEMENT:  INSERT INTO users (email) VALUES ('a@b.com')",
      );
      expect(out).toBe(
        '2026-09-24 12:00:00.123 UTC [123] STATEMENT:  INSERT INTO users (email) VALUES (?)',
      );
      // 무엇이 실패했는지가 남아야 한다
      expect(out).toContain('INSERT INTO users (email)');
      expect(out).toContain('2026-09-24 12:00:00.123 UTC [123]');
    });

    it('LOG: statement: / execute <name>: 도 같은 규칙', () => {
      expect(
        maskPgLogValues(
          "2026-09-24 12:00:00.123 UTC [1] LOG:  statement: SELECT * FROM users WHERE email = 'a@b.com'",
        ),
      ).toBe(
        '2026-09-24 12:00:00.123 UTC [1] LOG:  statement: SELECT * FROM users WHERE email = ?',
      );
      expect(
        maskPgLogValues(
          '2026-09-24 12:00:00.123 UTC [1] LOG:  execute <unnamed>: SELECT * FROM users WHERE email = $1',
        ),
      ).toContain('WHERE email = $1'); // 위치 파라미터는 값이 아니다
    });

    it('CONTEXT: SQL statement "…" 안쪽도 가린다', () => {
      expect(
        maskPgLogValues(`CONTEXT:  SQL statement "UPDATE t SET e='a@b.com'"`),
      ).toBe('CONTEXT:  SQL statement "UPDATE t SET e=?"');
    });
  });

  describe('남겨야 하는 것 (통째로 지우지 않는다)', () => {
    it('제약·테이블·컬럼 이름은 그대로', () => {
      const line =
        '2026-09-24 12:00:00.123 UTC [1] ERROR:  duplicate key value violates unique constraint "users_email_key"';
      expect(maskPgLogValues(line)).toBe(line);
    });

    it('SQL이 아닌 앱 로그 줄은 건드리지 않는다', () => {
      const line = '2026-09-24 12:00:00.123 INFO  started worker-1 in 350 ms';
      expect(maskPgLogValues(line)).toBe(line);
    });
  });

  it('값이 큰따옴표로 오는 오류 문구', () => {
    expect(
      maskPgLogValues('ERROR:  invalid input syntax for type integer: "abc"'),
    ).toBe('ERROR:  invalid input syntax for type integer: "?"');
  });
});

describe('createPgLogValueMasker (여러 줄에 걸친 문장)', () => {
  it('들여쓴 이어지는 줄까지 덮고, 문장이 끝나면 멈춘다', () => {
    const mask = createPgLogValueMasker();
    const lines = [
      '2026-09-24 12:00:00.123 UTC [1] STATEMENT:  INSERT INTO users (email)',
      "\tVALUES ('a@b.com')",
      '\tRETURNING id',
      '2026-09-24 12:00:01.000 UTC [1] LOG:  duration: 3.2 ms',
      '\tat com.foo.Bar(Bar.java:42)', // 문장이 열려 있지 않으므로 건드리지 않는다
    ];
    const out = lines.map(mask);
    expect(out[1]).toBe('\tVALUES (?)');
    expect(out[2]).toBe('\tRETURNING id');
    expect(out[3]).toBe(
      '2026-09-24 12:00:01.000 UTC [1] LOG:  duration: 3.2 ms',
    );
    expect(out[4]).toBe('\tat com.foo.Bar(Bar.java:42)');
    expect(out.join('\n')).not.toContain('a@b.com');
  });
});

describe('redactSecrets에 편입된 Postgres 값 가림 (회귀 확인)', () => {
  it('Key (…)=(…) 값이 오류 메시지 경로에서도 가려진다', () => {
    expect(
      redactSecrets('DETAIL:  Key (email)=(a@b.com) already exists.'),
    ).toBe('DETAIL:  Key (email)=(?) already exists.');
    expect(maskPgDetailValues('Key (a)=(1)')).toBe('Key (a)=(?)');
  });

  it('기존 동작은 그대로 (제약 이름·key=value·AWS 키)', () => {
    expect(
      redactSecrets(
        'duplicate key value violates unique constraint "users_email_key"',
      ),
    ).toBe('duplicate key value violates unique constraint "users_email_key"');
    expect(
      redactSecrets(
        'host=db password=abc123 sslmode=require token: xyz AKIAABCDEFGHIJKLMNOP',
      ),
    ).toBe('host=db password=*** sslmode=require token: *** ***');
    expect(
      sanitizeErrorMessage(new Error('connect failed postgres://u:pw@h/db')),
    ).toBe('connect failed postgres://u:***@h/db');
  });
});
