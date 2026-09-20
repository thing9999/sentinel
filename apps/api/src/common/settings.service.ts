import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  mergeSetting,
  SETTING_DEFAULTS,
  type SettingKey,
  type SettingValue,
} from '../database/settings-defaults';

/**
 * 설정값 읽기 (settings 테이블 → 없으면 코드 기본값). 60초 캐시.
 * 대시보드 DB가 없거나 실패해도 기본값으로 동작한다. (쓰기는 각 기능 모듈 몫)
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /** 캐시된 값 (없으면 기본값). 동기 호출용 */
  peek<K extends SettingKey>(key: K): SettingValue<K> {
    const hit = this.cache.get(key);
    return (hit?.value as SettingValue<K>) ?? SETTING_DEFAULTS[key].value;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < SettingsService.TTL_MS) {
      return hit.value as SettingValue<K>;
    }
    let value: SettingValue<K> = SETTING_DEFAULTS[key].value;
    if (this.prisma.isConnected) {
      try {
        const row = await this.prisma.setting.findUnique({ where: { key } });
        value = mergeSetting(key, row?.value ?? null);
      } catch (err) {
        this.logger.warn(
          `설정 ${key} 읽기 실패, 기본값 사용: ${err instanceof Error ? err.name : 'error'}`,
        );
      }
    }
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  invalidate(key?: SettingKey): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
