import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  type ValidationError,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { redactSecrets, truncateText } from '../database/health';

/** 에러 응답 본문 (docs/api/common.md 3.1) */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  path: string;
  timestamp: string;
}

/**
 * 계약 형식의 에러를 던질 때 쓴다.
 * `retryAfterSec`를 주면 `Retry-After` 헤더와 `details.retryAfterSec`를 붙인다.
 */
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly retryAfterSec?: number,
  ) {
    super({ code, message, details }, status);
  }
}

export function resourceNotFound(
  resource: Record<string, unknown>,
  message: string,
): ApiException {
  return new ApiException(HttpStatus.NOT_FOUND, 'RESOURCE_NOT_FOUND', message, {
    resource,
  });
}

export function validationFailed(
  fields: { field: string; value: unknown; constraints: string[] }[],
  message = '요청 값이 올바르지 않습니다.',
): ApiException {
  return new ApiException(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED',
    message,
    {
      fields,
    },
  );
}

const SENSITIVE_FIELDS = new Set(['content', 'label', 'memo', 'path']);

function flattenValidationErrors(
  errors: ValidationError[],
  parent = '',
): { field: string; value: unknown; constraints: string[] }[] {
  const out: { field: string; value: unknown; constraints: string[] }[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) {
      out.push({
        field,
        // 템플릿 원문·라벨·메모·파일 경로는 오류 응답에 되풀이하지 않는다 (aws-snapshot-manager.md 1.4, k8s-snapshot.md 1.4)
        value: SENSITIVE_FIELDS.has(e.property)
          ? undefined
          : (e.value as unknown),
        constraints: Object.values(e.constraints),
      });
    }
    if (e.children?.length)
      out.push(...flattenValidationErrors(e.children, field));
  }
  return out;
}

/** ValidationPipe의 exceptionFactory: 400 VALIDATION_FAILED + details.fields */
export function validationExceptionFactory(
  errors: ValidationError[],
): ApiException {
  return validationFailed(flattenValidationErrors(errors));
}

const DEFAULT_CODE: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  403: 'FORBIDDEN',
  404: 'ROUTE_NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

/**
 * 모든 예외를 계약 형식(`{ statusCode, code, message, details?, path, timestamp }`)으로 바꾼다.
 * 5xx의 message에는 내부 정보를 넣지 않는다.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (res.headersSent) {
      // SSE 등 이미 응답을 시작했으면 닫기만 한다
      res.end();
      return;
    }
    const body: ApiErrorBody = {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다.',
      path: req.originalUrl?.split('?')[0] ?? req.url,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof ApiException) {
      body.statusCode = exception.getStatus();
      body.code = exception.code;
      body.message = safeMessage(exception.message);
      if (exception.details) body.details = exception.details;
      if (exception.retryAfterSec !== undefined) {
        res.setHeader('Retry-After', String(exception.retryAfterSec));
        body.details = {
          ...(body.details ?? {}),
          retryAfterSec: exception.retryAfterSec,
        };
      }
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      body.statusCode = status;
      const resp = exception.getResponse();
      const obj =
        typeof resp === 'object' && resp !== null
          ? (resp as Record<string, unknown>)
          : {};
      if (typeof obj.code === 'string') body.code = obj.code;
      else if (exception instanceof NotFoundException)
        body.code = 'ROUTE_NOT_FOUND';
      else if (exception instanceof PayloadTooLargeException)
        body.code = 'PAYLOAD_TOO_LARGE';
      else if (exception instanceof BadRequestException)
        body.code = 'VALIDATION_FAILED';
      else
        body.code =
          DEFAULT_CODE[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');

      if (status >= 500) {
        body.message = '서버 오류가 발생했습니다.';
      } else if (body.code === 'ROUTE_NOT_FOUND') {
        body.message = '없는 경로입니다.';
      } else if (body.code === 'PAYLOAD_TOO_LARGE') {
        body.message = req.originalUrl?.startsWith('/api/aws-snapshots/')
          ? '요청 본문이 너무 큽니다.'
          : '요청 본문이 너무 큽니다 (최대 1MB).';
      } else {
        const msg = obj.message;
        body.message = safeMessage(
          Array.isArray(msg)
            ? msg.map(String).join('; ')
            : typeof msg === 'string'
              ? msg
              : exception.message,
        );
      }
      if (
        obj.details &&
        typeof obj.details === 'object' &&
        !Array.isArray(obj.details)
      ) {
        body.details = obj.details as Record<string, unknown>;
      }
      const ra = (exception as { retryAfterSec?: unknown }).retryAfterSec;
      if (typeof ra === 'number' && Number.isFinite(ra)) {
        res.setHeader('Retry-After', String(Math.ceil(ra)));
      }
      const retryAfter = res.getHeader('Retry-After');
      if (
        retryAfter !== undefined &&
        body.details?.retryAfterSec === undefined
      ) {
        const n = Number(retryAfter);
        if (Number.isFinite(n))
          body.details = { ...(body.details ?? {}), retryAfterSec: n };
      }
    } else {
      this.logger.error(
        exception instanceof Error
          ? `${exception.name}: ${redactSecrets(exception.message)}`
          : 'unknown error',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(body.statusCode).json(body);
  }
}

function safeMessage(msg: string): string {
  return truncateText(redactSecrets(msg).replace(/\s+/g, ' ').trim(), 300);
}
