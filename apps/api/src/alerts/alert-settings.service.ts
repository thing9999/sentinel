/**
 * alerts 설정 (docs/api/alerts.md 2.5·2.6). 대시보드 자체 DB `settings`만 쓴다.
 * 우선순위: 환경 변수 > `settings` 테이블 > 코드 기본값 (기존 `mergeSetting` 규칙).
 *
 * 웹훅 주소는 **여기서 다루지 않는다** — 읽기·쓰기·검증이 전부
 * `src/database/secret-settings.ts`의 전용 함수로만 간다(DBA 설계):
 * - 화면용은 `readWebhookStatus()` → `{configured, hint, length, source, lockedByEnv, updatedAt}`
 * - 원문을 주는 함수는 발송기 전용 `loadWebhookUrlForDispatch()` 하나뿐
 * - `SETTING_DEFAULTS`에 그 key가 **일부러 없어서** `SettingsService.get(...)`은 컴파일되지 않는다
 *   (60초 공용 캐시에 비밀값이 들어갈 길 자체를 없앴다)
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/api-error';
import { SettingsService } from '../common/settings.service';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../database/generated/prisma/client';
import {
  checkWebhookUrl,
  clearWebhookUrl,
  InvalidWebhookUrlError,
  isWebhookLockedByEnv,
  readWebhookStatus,
  saveWebhookUrl,
  SettingLockedByEnvError,
  WEBHOOK_ENV_VAR,
  type WebhookSecretStatus,
} from '../database/secret-settings';
import { SETTING_DEFAULTS } from '../database/settings-defaults';
import type { EnvironmentVariables } from '../config/env.validation';
import type { AlertSettingsPatchDto } from './dto';

export type DispatchMode = 'mock' | 'live';

export interface AlertRulesSettings {
  dedupeWindowMin: number;
  flapWindowMin: number;
  flapTransitions: number;
  warmupSec: number;
  unknownAfterMin: number;
  sourceSuppressAfterMin: number;
  notifyOnNewTarget: boolean;
  repeatEveryMin: number | null;
  minIntervalSec: number;
}

export interface DiscordSettings {
  enabled: boolean;
  minSeverity: 'critical' | 'warning';
  sendUnknown: boolean;
  minIntervalSec: number;
  backoffSec: readonly number[];
  failureCircuitCount: number;
  failureCooldownMin: number;
  testCooldownSec: number;
  allowedHosts: readonly string[];
}

export interface LockedField {
  field: string;
  envVar: string;
  text: string;
}

const WEBHOOK_LOCK_TEXT =
  `환경 변수 ${WEBHOOK_ENV_VAR}로 고정돼 있어 화면에서 바꿀 수 없습니다. ` +
  '값을 바꾸려면 .env(또는 배포 매니페스트)를 고치고 API를 다시 시작하세요.';
const DISPATCH_LOCK_TEXT =
  ' 환경 변수 ALERTS_DISPATCH로 고정돼 있어 화면에서 바꿀 수 없습니다. ' +
  '값을 바꾸려면 .env(또는 배포 매니페스트)를 고치고 API를 다시 시작하세요.';

@Injectable()
export class AlertSettingsService {
  private readonly logger = new Logger(AlertSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // --- 읽기 -------------------------------------------------------------------

  /** `ALERTS_DISPATCH`가 있으면 그 값, 없으면 `DATA_SOURCE`를 따른다 */
  dispatchMode(dataSource: DispatchMode): {
    mode: DispatchMode;
    modeSource: 'env' | 'data_source';
  } {
    const env = this.config.get('ALERTS_DISPATCH', { infer: true });
    return env
      ? { mode: env, modeSource: 'env' }
      : { mode: dataSource, modeSource: 'data_source' };
  }

  async discord(): Promise<DiscordSettings> {
    return { ...(await this.settings.get('alerts.discord')) };
  }

  discordNow(): DiscordSettings {
    return { ...this.settings.peek('alerts.discord') };
  }

  async webhookStatus(): Promise<WebhookSecretStatus> {
    if (!this.prisma.isConnected) {
      // DB가 없어도 env 값은 읽을 수 있다 (readWebhookStatus가 env를 먼저 본다)
      return readWebhookStatus(emptySettingClient(), process.env);
    }
    return readWebhookStatus(this.prisma, process.env);
  }

  lockedByEnv(): LockedField[] {
    const out: LockedField[] = [];
    if (isWebhookLockedByEnv(process.env)) {
      out.push({
        field: 'webhookUrl',
        envVar: WEBHOOK_ENV_VAR,
        text: WEBHOOK_LOCK_TEXT,
      });
    }
    if (this.config.get('ALERTS_DISPATCH', { infer: true })) {
      out.push({
        field: 'dispatchMode',
        envVar: 'ALERTS_DISPATCH',
        text: DISPATCH_LOCK_TEXT.trim(),
      });
    }
    return out;
  }

  // --- 쓰기 -------------------------------------------------------------------

  /**
   * 부분 갱신. **보낸 필드만 바뀐다.**
   * 저장 후 반드시 `SettingsService.invalidate(key)`를 부른다 —
   * 안 부르면 최대 60초 동안 옛 값으로 발송한다(DBA가 지적한 기존 구조의 한계).
   */
  async patch(body: AlertSettingsPatchDto): Promise<void> {
    const locked = this.lockedByEnv();
    const lockedFields = new Set(locked.map((l) => l.field));

    if (
      body.discord?.webhookUrl !== undefined &&
      lockedFields.has('webhookUrl')
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'SETTING_LOCKED_BY_ENV',
        WEBHOOK_LOCK_TEXT,
        {
          fields: ['webhookUrl'],
          envVars: [WEBHOOK_ENV_VAR],
        },
      );
    }

    // **형식 검증을 DB 확인보다 먼저** 한다. 저장할 수 없는 상황이어도
    // "주소가 틀렸다"는 사실은 알려줄 수 있고, 그것이 사용자가 고칠 수 있는 유일한 것이다.
    // 검증은 DBA `checkWebhookUrl()` 하나로만 한다 (API가 별도 정규식을 갖지 않는다).
    if (
      body.discord?.webhookUrl !== undefined &&
      body.discord.webhookUrl !== null
    ) {
      const hosts = (await this.discord()).allowedHosts;
      const verdict = checkWebhookUrl(body.discord.webhookUrl, hosts);
      // 오류에 **입력값을 담지 않는다** — 코드만 옮긴다 (AC-ALERT21)
      if (!verdict.ok)
        throw toWebhookApiError(new InvalidWebhookUrlError(verdict.code));
    }

    const needsDb =
      body.discord?.webhookUrl !== undefined ||
      hasAny(body.discord, ['enabled', 'minSeverity', 'sendUnknown']) ||
      body.rules !== undefined;
    if (needsDb && !this.prisma.isConnected) {
      // **메모리 값은 바꾸지 않는다** — 재시작 시 사라지는 변경을 만들지 않는다(기존 cost 규칙)
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'DASHBOARD_DB_UNAVAILABLE',
        '대시보드 DB에 연결할 수 없어 설정을 저장하지 못했습니다.',
      );
    }

    // 1) 웹훅 주소 (별도 key, 전용 함수로만)
    if (body.discord?.webhookUrl !== undefined) {
      const hosts = (await this.discord()).allowedHosts;
      try {
        if (body.discord.webhookUrl === null) {
          await clearWebhookUrl(this.prisma, process.env);
        } else {
          await saveWebhookUrl(this.prisma, body.discord.webhookUrl, {
            env: process.env,
            allowedHosts: hosts,
          });
        }
      } catch (err) {
        throw toWebhookApiError(err);
      }
    }

    // 2) 발송 설정
    const discordPatch = pick(body.discord, [
      'enabled',
      'minSeverity',
      'sendUnknown',
    ]);
    if (Object.keys(discordPatch).length > 0) {
      const current = await this.settings.get('alerts.discord');
      await this.write(
        'alerts.discord',
        { ...current, ...discordPatch },
        SETTING_DEFAULTS['alerts.discord'].description,
      );
      // ★ 반드시 부른다
      this.settings.invalidate('alerts.discord');
    }

    // 3) 억제·플래핑·워밍업 기준값
    if (body.rules) {
      const { minIntervalSec, ...ruleFields } = body.rules;
      if (Object.keys(ruleFields).length > 0) {
        const current = await this.settings.get('alerts');
        await this.write(
          'alerts',
          { ...current, ...ruleFields },
          SETTING_DEFAULTS.alerts.description,
        );
        this.settings.invalidate('alerts');
      }
      // 발송 속도 상한은 디스코드 설정 쪽에 산다
      if (minIntervalSec !== undefined) {
        const current = await this.settings.get('alerts.discord');
        await this.write(
          'alerts.discord',
          { ...current, minIntervalSec },
          SETTING_DEFAULTS['alerts.discord'].description,
        );
        this.settings.invalidate('alerts.discord');
      }
    }
  }

  private async write(
    key: string,
    value: unknown,
    description: string,
  ): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: value as Prisma.InputJsonValue, description },
      update: { value: value as Prisma.InputJsonValue },
    });
  }

  /** 응답용 `rules` 블록 (화면에 노출하지 않지만 API로는 보인다) */
  async rulesBlock(): Promise<AlertRulesSettings & { uiEditable: false }> {
    const a = await this.settings.get('alerts');
    const d = await this.settings.get('alerts.discord');
    return {
      dedupeWindowMin: a.dedupeWindowMin,
      flapWindowMin: a.flapWindowMin,
      flapTransitions: a.flapTransitions,
      warmupSec: a.warmupSec,
      unknownAfterMin: a.unknownAfterMin,
      sourceSuppressAfterMin: a.sourceSuppressAfterMin,
      notifyOnNewTarget: a.notifyOnNewTarget,
      repeatEveryMin: a.repeatEveryMin,
      minIntervalSec: d.minIntervalSec,
      // 화면에 노출하지 않는다(명세 3.4.2). API로는 바꿀 수 있다
      uiEditable: false,
    };
  }

  async retentionBlock(): Promise<{
    days: number;
    maxRows: number;
    uiEditable: false;
  }> {
    const r = await this.settings.get('retention');
    return { days: r.alertDays, maxRows: r.alertMaxRows, uiEditable: false };
  }
}

function hasAny<T extends object>(
  obj: T | undefined,
  keys: (keyof T)[],
): boolean {
  if (!obj) return false;
  return keys.some((k) => obj[k] !== undefined);
}

function pick<T extends object, K extends keyof T>(
  obj: T | undefined,
  keys: K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  if (!obj) return out;
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** DB가 없을 때도 env 값을 읽을 수 있게 하는 빈 클라이언트 */
function emptySettingClient(): Parameters<typeof readWebhookStatus>[0] {
  return {
    setting: {
      findUnique: () => Promise.resolve(null),
    },
  } as unknown as Parameters<typeof readWebhookStatus>[0];
}

/**
 * 저장 계층 오류 → 계약 오류.
 * **입력값을 응답에 담지 않는다** (AC-ALERT21). 코드만 옮긴다.
 */
export function toWebhookApiError(err: unknown): ApiException {
  if (err instanceof SettingLockedByEnvError) {
    return new ApiException(
      HttpStatus.CONFLICT,
      'SETTING_LOCKED_BY_ENV',
      WEBHOOK_LOCK_TEXT,
      { fields: ['webhookUrl'], envVars: [err.envVar] },
    );
  }
  if (err instanceof InvalidWebhookUrlError) {
    return new ApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      webhookRejectMessage(err.reason),
      {
        fields: [
          {
            field: 'discord.webhookUrl',
            // 값은 싣지 않는다
            constraints: [
              '디스코드 웹훅 주소여야 합니다 (https://discord.com/api/webhooks/…)',
            ],
          },
        ],
        reason: err.reason,
      },
    );
  }
  return new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'DASHBOARD_DB_UNAVAILABLE',
    '대시보드 DB에 연결할 수 없어 설정을 저장하지 못했습니다.',
  );
}

function webhookRejectMessage(reason: string): string {
  switch (reason) {
    case 'EMPTY':
      return '웹훅 주소가 비어 있습니다.';
    case 'NOT_A_URL':
      return '웹훅 주소 형식이 올바르지 않습니다 (주소로 읽을 수 없습니다).';
    case 'NOT_HTTPS':
      return '웹훅 주소 형식이 올바르지 않습니다 (https여야 합니다).';
    case 'HOST_NOT_ALLOWED':
      return '웹훅 주소 형식이 올바르지 않습니다 (호스트가 허용 목록에 없습니다).';
    case 'PATH_NOT_WEBHOOK':
      return '웹훅 주소 형식이 올바르지 않습니다 (/api/webhooks/… 경로가 아닙니다).';
    case 'TOO_LONG':
      return '웹훅 주소가 너무 깁니다 (500자 이하).';
    default:
      return '웹훅 주소 형식이 올바르지 않습니다.';
  }
}
