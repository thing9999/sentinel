import {
  checkWebhookUrl,
  clearWebhookUrl,
  InvalidWebhookUrlError,
  isWebhookLockedByEnv,
  listPublicSettings,
  loadWebhookUrlForDispatch,
  maskWebhookUrl,
  readWebhookStatus,
  redactDiscordWebhookUrls,
  saveWebhookUrl,
  SettingLockedByEnvError,
  WEBHOOK_ENV_VAR,
  WEBHOOK_SETTING_KEY,
} from './secret-settings';
import { isSecretSettingKey, SETTING_DEFAULTS } from './settings-defaults';

const URL_OK =
  'https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWx7f3a';

/** settings 테이블만 흉내 내는 최소 가짜 (PrismaClient 전체가 필요 없다) */
function fakePrisma(rows: Record<string, unknown> = {}) {
  const store = new Map<
    string,
    { key: string; value: unknown; updatedAt: Date }
  >();
  for (const [key, value] of Object.entries(rows)) {
    store.set(key, { key, value, updatedAt: new Date('2026-09-25T00:00:00Z') });
  }
  return {
    store,
    setting: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(store.get(where.key) ?? null),
      findMany: ({
        where,
      }: { where?: { key?: { notIn?: string[] } } } = {}) => {
        const skip = new Set(where?.key?.notIn ?? []);
        return Promise.resolve(
          [...store.values()].filter((r) => !skip.has(r.key)),
        );
      },
      upsert: ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: { key: string; value: unknown };
        update: { value: unknown };
      }) => {
        const prev = store.get(where.key);
        store.set(where.key, {
          key: where.key,
          value: prev ? update.value : create.value,
          updatedAt: new Date('2026-09-25T12:00:00Z'),
        });
        return Promise.resolve(store.get(where.key));
      },
    },
  } as never as Parameters<typeof readWebhookStatus>[0] & {
    store: Map<string, { key: string; value: unknown; updatedAt: Date }>;
  };
}

describe('checkWebhookUrl (저장 단계 검증)', () => {
  it('디스코드 https 웹훅만 통과한다', () => {
    expect(checkWebhookUrl(URL_OK)).toEqual({ ok: true });
    expect(
      checkWebhookUrl(
        'https://discordapp.com/api/webhooks/1234/abcdefghijklmnop',
      ),
    ).toEqual({ ok: true });
  });

  it.each([
    ['', 'EMPTY'],
    ['not a url', 'NOT_A_URL'],
    [URL_OK.replace('https', 'http'), 'NOT_HTTPS'],
    ['https://evil.example.com/api/webhooks/1/x', 'HOST_NOT_ALLOWED'],
    // 호스트 이름에 discord.com이 "들어만" 있는 경우도 막는다
    ['https://discord.com.evil.io/api/webhooks/1/x', 'HOST_NOT_ALLOWED'],
    ['https://discord.com/api/other/1/x', 'PATH_NOT_WEBHOOK'],
    [`https://discord.com/api/webhooks/1/${'a'.repeat(600)}`, 'TOO_LONG'],
  ])('거부: %s', (url, code) => {
    const v = checkWebhookUrl(url);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.code).toBe(code);
  });

  it('거부 결과에 입력값 원문이 들어가지 않는다 (AC-ALERT21)', () => {
    const v = checkWebhookUrl('https://evil.example.com/api/webhooks/1/SECRET');
    expect(JSON.stringify(v)).not.toContain('SECRET');
    const err = new InvalidWebhookUrlError('HOST_NOT_ALLOWED');
    expect(err.message).not.toContain('SECRET');
  });
});

describe('maskWebhookUrl / redactDiscordWebhookUrls', () => {
  it('끝 4자 + 글자 수만 남긴다', () => {
    const m = maskWebhookUrl(URL_OK);
    expect(m.hint).toBe('…****7f3a');
    expect(m.length).toBe(URL_OK.length);
    expect(URL_OK).not.toContain(m.hint);
  });

  it('짧은 값도 원문을 흘리지 않는다', () => {
    expect(maskWebhookUrl('abc').hint).toBe('…****');
  });

  it('문장 안에 섞인 웹훅 주소를 가린다', () => {
    const line = `발송 실패: POST ${URL_OK} → 401`;
    const out = redactDiscordWebhookUrls(line);
    expect(out).not.toContain('discord.com/api/webhooks');
    expect(out).toContain('[웹훅 주소 가림]');
  });
});

describe('readWebhookStatus (원문 미노출)', () => {
  it('DB 값이 있어도 응답에 원문이 없다 (AC-ALERT20)', async () => {
    const prisma = fakePrisma({ [WEBHOOK_SETTING_KEY]: { url: URL_OK } });
    const status = await readWebhookStatus(prisma, {});
    expect(status.configured).toBe(true);
    expect(status.source).toBe('db');
    expect(status.lockedByEnv).toBe(false);
    expect(JSON.stringify(status)).not.toContain('AbCdEf');
    expect(JSON.stringify(status)).not.toContain('discord.com');
  });

  it('미설정이면 configured=false (오류가 아니다)', async () => {
    const status = await readWebhookStatus(fakePrisma(), {});
    expect(status).toMatchObject({
      configured: false,
      hint: null,
      source: null,
    });
  });

  it('값이 null인 행도 미설정으로 본다', async () => {
    const prisma = fakePrisma({ [WEBHOOK_SETTING_KEY]: { url: null } });
    expect((await readWebhookStatus(prisma, {})).configured).toBe(false);
  });

  it('환경 변수가 DB 값을 이기고 잠근다 (AC-ALERT22)', async () => {
    const prisma = fakePrisma({
      [WEBHOOK_SETTING_KEY]: { url: 'https://discord.com/api/webhooks/1/db' },
    });
    const env = { [WEBHOOK_ENV_VAR]: URL_OK };
    expect(isWebhookLockedByEnv(env)).toBe(true);
    const status = await readWebhookStatus(prisma, env);
    expect(status).toMatchObject({ source: 'env', lockedByEnv: true });
    expect(await loadWebhookUrlForDispatch(prisma, env)).toEqual({
      url: URL_OK,
      source: 'env',
    });
  });
});

describe('saveWebhookUrl / clearWebhookUrl', () => {
  it('저장 후 원문은 발송 전용 함수로만 꺼낼 수 있다', async () => {
    const prisma = fakePrisma();
    const status = await saveWebhookUrl(prisma, ` ${URL_OK} `, { env: {} });
    expect(status.configured).toBe(true);
    expect(status.hint).toBe('…****7f3a');
    expect(await loadWebhookUrlForDispatch(prisma, {})).toEqual({
      url: URL_OK,
      source: 'db',
    });
  });

  it('형식이 틀리면 저장하지 않는다', async () => {
    const prisma = fakePrisma();
    await expect(
      saveWebhookUrl(prisma, 'http://discord.com/api/webhooks/1/x', {
        env: {},
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookUrlError);
    expect(await loadWebhookUrlForDispatch(prisma, {})).toBeNull();
  });

  it('환경 변수로 잠겨 있으면 저장·삭제가 막힌다 (409)', async () => {
    const prisma = fakePrisma();
    const env = { [WEBHOOK_ENV_VAR]: URL_OK };
    await expect(
      saveWebhookUrl(prisma, URL_OK, { env }),
    ).rejects.toBeInstanceOf(SettingLockedByEnvError);
    await expect(clearWebhookUrl(prisma, env)).rejects.toBeInstanceOf(
      SettingLockedByEnvError,
    );
  });

  it('지우면 configured=false가 된다', async () => {
    const prisma = fakePrisma();
    await saveWebhookUrl(prisma, URL_OK, { env: {} });
    const status = await clearWebhookUrl(prisma, {});
    expect(status.configured).toBe(false);
    expect(await loadWebhookUrlForDispatch(prisma, {})).toBeNull();
  });
});

describe('설정 목록에서 비밀값 key 제외', () => {
  it('listPublicSettings는 웹훅 key를 돌려주지 않는다', async () => {
    const prisma = fakePrisma({
      retention: { alertDays: 90 },
      [WEBHOOK_SETTING_KEY]: { url: URL_OK },
    });
    const rows = await listPublicSettings(prisma);
    expect(rows.map((r) => r.key)).toEqual(['retention']);
    expect(JSON.stringify(rows)).not.toContain('discord.com');
  });

  it('비밀 key는 SETTING_DEFAULTS에 없다 (SettingsService 캐시에 들어가지 않게)', () => {
    expect(Object.keys(SETTING_DEFAULTS)).not.toContain(WEBHOOK_SETTING_KEY);
    expect(isSecretSettingKey(WEBHOOK_SETTING_KEY)).toBe(true);
    expect(isSecretSettingKey('alerts.discord')).toBe(false);
  });
});
