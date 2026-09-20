import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvironmentVariables } from '../config/env.validation';
import { PrismaClient } from './generated/prisma/client';

/**
 * 대시보드 자체 DB 클라이언트 (Prisma 7 + pg 드라이버 어댑터).
 * DATABASE_URL이 없거나 연결에 실패해도 앱은 죽지 않고 경고만 남긴다.
 * (로컬에 Postgres가 없을 수 있음) 연결 여부는 `isConnected`로 확인한다.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseUrl?: string;
  private connected = false;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const databaseUrl = config.get('DATABASE_URL', { infer: true });
    super({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5000,
      }),
    });
    this.databaseUrl = databaseUrl;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async onModuleInit(): Promise<void> {
    if (!this.databaseUrl) {
      this.logger.warn('DATABASE_URL이 없어 대시보드 DB에 연결하지 않습니다.');
      return;
    }
    try {
      await this.$connect();
      await this.$queryRaw`SELECT 1`;
      this.connected = true;
      this.logger.log('대시보드 DB 연결됨');
    } catch (err) {
      this.connected = false;
      this.logger.warn(
        `대시보드 DB 연결 실패 (앱은 계속 실행됩니다): ${describeError(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect().catch(() => undefined);
  }
}

/** pg의 ECONNREFUSED는 message가 빈 AggregateError로 올 수 있어 code/name을 함께 본다. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  const inner =
    err instanceof AggregateError
      ? err.errors.map((e) => describeError(e)).join('; ')
      : '';
  return (
    [err.name, typeof code === 'string' ? code : '', err.message, inner]
      .filter(Boolean)
      .join(' ') || 'unknown error'
  );
}
