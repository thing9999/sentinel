import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SettingsService } from '../common/settings.service';
import { PrismaService } from '../database/prisma.service';
import { purgeExpiredData } from '../database/retention';

/**
 * 대시보드 자체 DB 보존 정리 (DBA `purgeExpiredData`, docs/db/schema.md 3절). 매일 04:00 1회.
 * (시작 시 중단된 어드바이저 실행 정리 `closeInterruptedAdvisorRuns`는 advisor 모듈 몫)
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Cron('0 4 * * *', { name: 'purge-expired-data' })
  async purgeDaily(): Promise<void> {
    await this.run();
  }

  async run(now: Date = new Date()): Promise<boolean> {
    if (this.running || !this.prisma.isConnected) return false;
    this.running = true;
    try {
      const policy = await this.settings.get('retention');
      const res = await purgeExpiredData(this.prisma, now, policy);
      this.logger.log(`보존 기간 정리 완료: ${JSON.stringify(res)}`);
      return true;
    } catch (err) {
      this.logger.warn(
        `보존 기간 정리 실패: ${err instanceof Error ? err.name : 'error'}`,
      );
      return false;
    } finally {
      this.running = false;
    }
  }
}
