import {
  maskSqlLiterals,
  redactConnectionString,
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
