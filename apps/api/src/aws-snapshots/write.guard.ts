import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ApiException } from '../common/api-error';
import type { EnvironmentVariables } from '../config/env.validation';

/**
 * 인증 없는 파일 쓰기 API 보호 (계약 1.3).
 * 1. Origin 헤더가 있으면 CORS_ORIGIN 목록 중 하나여야 한다 → 아니면 403 ORIGIN_NOT_ALLOWED
 * 2. 본문이 있는 쓰기(DELETE 제외)는 Content-Type: application/json → 아니면 415
 */
@Injectable()
export class SnapshotWriteGuard implements CanActivate {
  private readonly origins: Set<string>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.origins = new Set(
      config
        .get('CORS_ORIGIN', { infer: true })
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    if (origin !== undefined && !this.origins.has(origin)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ORIGIN_NOT_ALLOWED',
        '허용되지 않은 출처(Origin)의 쓰기 요청입니다.',
      );
    }
    if (req.method !== 'DELETE') {
      const ct = String(req.headers['content-type'] ?? '').toLowerCase();
      if (!ct.startsWith('application/json')) {
        throw new ApiException(
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
          'UNSUPPORTED_MEDIA_TYPE',
          '쓰기 요청은 Content-Type: application/json 이어야 합니다.',
        );
      }
    }
    return true;
  }
}
