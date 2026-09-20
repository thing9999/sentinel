import { HttpException } from '@nestjs/common';

/**
 * 공통 에러 형식 `{ statusCode, code, message, details? }` (docs/api/common.md 3.1).
 * path·timestamp는 전역 예외 필터(A)가 붙인다.
 */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(
      { statusCode: status, code, message, ...(details ? { details } : {}) },
      status,
    );
  }

  get retryAfterSec(): number | undefined {
    const v = this.details?.retryAfterSec;
    return typeof v === 'number' ? v : undefined;
  }
}

export const notFound = (
  resource: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  new ApiError(404, 'RESOURCE_NOT_FOUND', '분석 결과를 찾을 수 없습니다.', {
    resource,
    ...extra,
  });
