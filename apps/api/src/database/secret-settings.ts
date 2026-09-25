/**
 * 비밀값 설정 전용 접근 계층 — 지금은 디스코드 웹훅 주소 하나다.
 * (alerts 3.4.3, PM 결정 Q4 "DB 평문 저장 + 원문 미노출", 설계 근거 docs/db/schema.md 2.12)
 *
 * 저장 계층이 지키는 것 (여기서 못을 박는다. API 계층의 조심성에 기대지 않는다):
 *
 *  1. **타입으로 막는다.** `alerts.discord.webhookUrl`은 `SETTING_DEFAULTS`에 없다.
 *     그래서 `SettingsService.get('alerts.discord.webhookUrl')`은 **컴파일되지 않는다**.
 *     (SettingsService는 값을 60초 메모리 캐시에 담고 `peek()`으로 아무나 꺼낼 수 있으므로,
 *      비밀값이 그 캐시에 들어가지 않게 하는 것이 중요하다.)
 *  2. **원문을 돌려주는 함수가 하나뿐이고 이름이 그렇게 생겼다.**
 *     화면·API용은 `readWebhookStatus()`이고 `{configured, hint, length}`만 준다.
 *     발송기만 `loadWebhookUrlForDispatch()`를 쓴다.
 *  3. **목록 조회는 `listPublicSettings()`로만.** `prisma.setting.findMany()`를 그대로 응답에
 *     실으면 비밀값이 나간다. 이 함수가 `SECRET_SETTING_KEYS`를 걸러 낸다.
 *  4. **저장 전 형식 검증**(https + 디스코드 도메인 + /api/webhooks/ 경로). 오류 객체·메시지에
 *     **입력값을 절대 담지 않는다**(AC-ALERT21).
 *  5. **환경 변수가 이긴다.** `ALERTS_DISCORD_WEBHOOK_URL`이 있으면 DB 값을 읽지 않고,
 *     저장 시도는 `SettingLockedByEnvError`(→ 409 SETTING_LOCKED_BY_ENV)로 막는다.
 *
 * 저장 모양: settings 행 1개, `value = { "url": "https://discord.com/api/webhooks/..." | null }`.
 * 객체로 감싸는 이유 ① `mergeSetting`류 얕은 병합과 모양이 같다 ② 나중에 `{url, enc}` 처럼
 * 필드를 늘려도(암호화 전환) 스키마 변경이 필요 없다.
 */
import type { PrismaClient } from './generated/prisma/client';
import {
  DISCORD_WEBHOOK_URL_PATTERN,
  redactDiscordWebhookUrls,
} from './health/sanitize';
import { SECRET_SETTING_KEYS, isSecretSettingKey } from './settings-defaults';

export { SECRET_SETTING_KEYS, isSecretSettingKey };

/**
 * 가림 패턴·함수는 공용 `redactSecrets`(`./health/sanitize`)에 들어 있고 여기서 다시 내보낸다.
 * 구현이 그쪽에 있는 이유: `sanitize.ts`는 의존성이 없는 잎 모듈이라
 * 여기(→ settings-defaults → health/postgres/normalize → sanitize)와 반대 방향으로 두면 순환 import가 된다.
 */
export { DISCORD_WEBHOOK_URL_PATTERN, redactDiscordWebhookUrls };

/** 비밀값 설정 key (settings.key). `SETTING_DEFAULTS`에는 일부러 없다. */
export const WEBHOOK_SETTING_KEY = 'alerts.discord.webhookUrl';

/** 이 값이 설정되면 DB 값보다 우선하고 화면 입력이 잠긴다 (alerts 3.4.3). */
export const WEBHOOK_ENV_VAR = 'ALERTS_DISCORD_WEBHOOK_URL';

/** settings 행을 새로 만들 때 붙는 설명 (운영자가 DB에서 직접 볼 때 경고가 되도록). */
export const WEBHOOK_SETTING_DESCRIPTION =
  '디스코드 웹훅 주소(비밀값, 평문). API로 원문을 돌려주지 않는다. DB 덤프·백업에 그대로 들어가므로 취급 주의';

/** 기본 허용 호스트 (PM 결정 Q9: 디스코드 도메인만). settings `alerts.discord.allowedHosts`로 바꾼다. */
export const DEFAULT_WEBHOOK_HOSTS: readonly string[] = [
  'discord.com',
  'discordapp.com',
];

export interface WebhookMask {
  /** 끝 4자만 노출: `…****7f3a`. 앞쪽(채널 ID)이 없어 재구성할 수 없다 */
  hint: string;
  length: number;
}

/** 저장된 주소를 화면에 보여줄 수 있는 형태로 줄인다. 원문을 절대 포함하지 않는다. */
export function maskWebhookUrl(url: string): WebhookMask {
  const tail = url.length > 4 ? url.slice(-4) : '';
  return { hint: `…****${tail}`, length: url.length };
}

export interface WebhookSecretStatus {
  configured: boolean;
  /** 미설정이면 null */
  hint: string | null;
  length: number | null;
  /** 값이 어디서 왔는지. 미설정이면 null */
  source: 'env' | 'db' | null;
  /** true면 화면 입력이 잠긴다 (PATCH는 409) */
  lockedByEnv: boolean;
  /** DB 값의 마지막 저장 시각. env 값이거나 미설정이면 null */
  updatedAt: Date | null;
}

export type WebhookUrlRejectCode =
  | 'EMPTY'
  | 'NOT_A_URL'
  | 'NOT_HTTPS'
  | 'HOST_NOT_ALLOWED'
  | 'PATH_NOT_WEBHOOK'
  | 'TOO_LONG';

/** 저장 가능한 값인지. **입력값을 반환·로그에 담지 않는다** (코드만 준다). */
export function checkWebhookUrl(
  url: string,
  allowedHosts: readonly string[] = DEFAULT_WEBHOOK_HOSTS,
): { ok: true } | { ok: false; code: WebhookUrlRejectCode } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, code: 'EMPTY' };
  if (trimmed.length > 500) return { ok: false, code: 'TOO_LONG' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, code: 'NOT_A_URL' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, code: 'NOT_HTTPS' };
  const host = parsed.hostname.toLowerCase();
  const allowed = allowedHosts.some(
    (h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`),
  );
  if (!allowed) return { ok: false, code: 'HOST_NOT_ALLOWED' };
  if (!/^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(parsed.pathname)) {
    return { ok: false, code: 'PATH_NOT_WEBHOOK' };
  }
  return { ok: true };
}

/** 환경 변수로 잠긴 설정을 바꾸려 할 때 (기존 규칙: 409 SETTING_LOCKED_BY_ENV). */
export class SettingLockedByEnvError extends Error {
  readonly code = 'SETTING_LOCKED_BY_ENV';
  constructor(readonly envVar: string = WEBHOOK_ENV_VAR) {
    super(`${envVar} 환경 변수로 고정된 값이라 바꿀 수 없습니다.`);
    this.name = 'SettingLockedByEnvError';
  }
}

/** 형식이 틀린 웹훅 주소 (→ 400). **입력값을 담지 않는다.** */
export class InvalidWebhookUrlError extends Error {
  readonly code = 'INVALID_WEBHOOK_URL';
  constructor(readonly reason: WebhookUrlRejectCode) {
    super(`웹훅 주소 형식이 올바르지 않습니다 (${reason}).`);
    this.name = 'InvalidWebhookUrlError';
  }
}

type SettingRow = { key: string; value: unknown; updatedAt: Date } | null;

function urlFromRow(row: SettingRow): string | null {
  const value = row?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === 'string' && url.length > 0 ? url : null;
}

function envUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env[WEBHOOK_ENV_VAR];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/** 환경 변수로 잠겨 있는가. DB를 읽지 않는다. */
export function isWebhookLockedByEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envUrl(env) !== null;
}

/**
 * 화면·API용 상태. **원문을 돌려주지 않는다** (AC-ALERT20).
 * 이 함수의 반환값은 그대로 응답에 실어도 된다.
 */
export async function readWebhookStatus(
  prisma: Pick<PrismaClient, 'setting'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebhookSecretStatus> {
  const fromEnv = envUrl(env);
  if (fromEnv) {
    const { hint, length } = maskWebhookUrl(fromEnv);
    return {
      configured: true,
      hint,
      length,
      source: 'env',
      lockedByEnv: true,
      updatedAt: null,
    };
  }
  const row = (await prisma.setting.findUnique({
    where: { key: WEBHOOK_SETTING_KEY },
  })) as SettingRow;
  const url = urlFromRow(row);
  if (!url) {
    return {
      configured: false,
      hint: null,
      length: null,
      source: null,
      lockedByEnv: false,
      updatedAt: null,
    };
  }
  const { hint, length } = maskWebhookUrl(url);
  return {
    configured: true,
    hint,
    length,
    source: 'db',
    lockedByEnv: false,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * ⚠️ **원문을 돌려주는 유일한 함수. 발송기 전용이다.**
 * 반환값을 API 응답·SSE·로그·예외 메시지·알림 본문·스냅샷에 넣지 말 것.
 * 오류 메시지는 공용 `redactSecrets()`(2026-09-24부터 웹훅 패턴 포함)나
 * `redactDiscordWebhookUrls()`를 반드시 통과시킨다.
 */
export async function loadWebhookUrlForDispatch(
  prisma: Pick<PrismaClient, 'setting'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ url: string; source: 'env' | 'db' } | null> {
  const fromEnv = envUrl(env);
  if (fromEnv) return { url: fromEnv, source: 'env' };
  const row = (await prisma.setting.findUnique({
    where: { key: WEBHOOK_SETTING_KEY },
  })) as SettingRow;
  const url = urlFromRow(row);
  return url ? { url, source: 'db' } : null;
}

/**
 * 웹훅 주소 저장. 검증 실패 → `InvalidWebhookUrlError`, env로 잠김 → `SettingLockedByEnvError`.
 * 저장 후에는 `readWebhookStatus()`만 쓴다(원문을 되돌려주지 않는다).
 */
export async function saveWebhookUrl(
  prisma: Pick<PrismaClient, 'setting'>,
  url: string,
  options: {
    env?: NodeJS.ProcessEnv;
    allowedHosts?: readonly string[];
  } = {},
): Promise<WebhookSecretStatus> {
  const env = options.env ?? process.env;
  if (isWebhookLockedByEnv(env)) throw new SettingLockedByEnvError();
  const verdict = checkWebhookUrl(url, options.allowedHosts);
  if (!verdict.ok) throw new InvalidWebhookUrlError(verdict.code);
  const trimmed = url.trim();
  await prisma.setting.upsert({
    where: { key: WEBHOOK_SETTING_KEY },
    create: {
      key: WEBHOOK_SETTING_KEY,
      value: { url: trimmed },
      description: WEBHOOK_SETTING_DESCRIPTION,
    },
    update: { value: { url: trimmed } },
  });
  return readWebhookStatus(prisma, env);
}

/** 주소 지우기 (행은 `{url: null}`로 남긴다 — "설정한 적 있음"과 "지금 없음"을 구분하지 않는다). */
export async function clearWebhookUrl(
  prisma: Pick<PrismaClient, 'setting'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebhookSecretStatus> {
  if (isWebhookLockedByEnv(env)) throw new SettingLockedByEnvError();
  await prisma.setting.upsert({
    where: { key: WEBHOOK_SETTING_KEY },
    create: {
      key: WEBHOOK_SETTING_KEY,
      value: { url: null },
      description: WEBHOOK_SETTING_DESCRIPTION,
    },
    update: { value: { url: null } },
  });
  return readWebhookStatus(prisma, env);
}

/**
 * 설정을 목록으로 읽어야 할 때 쓴다. **비밀값 key를 제외한다.**
 * `prisma.setting.findMany()`를 직접 부르지 말 것.
 */
export async function listPublicSettings(
  prisma: Pick<PrismaClient, 'setting'>,
): Promise<{ key: string; value: unknown; updatedAt: Date }[]> {
  const rows = (await prisma.setting.findMany({
    where: { key: { notIn: [...SECRET_SETTING_KEYS] } },
  })) as { key: string; value: unknown; updatedAt: Date }[];
  // 이중 안전장치: where가 바뀌거나 새 비밀 key가 늘어도 응답에 섞이지 않게 한 번 더 거른다.
  return rows.filter((r) => !isSecretSettingKey(r.key));
}
