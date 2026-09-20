import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import {
  ApiExceptionFilter,
  validationExceptionFactory,
} from './common/api-error';
import type { EnvironmentVariables } from './config/env.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService<EnvironmentVariables, true>);

  app.setGlobalPrefix('api');
  // 템플릿 저장·검사만 큰 본문 허용 (aws-snapshot-manager.md 7.1: 편집 상한 × 2 + 64KB).
  // 전역 1MB 파서보다 먼저 등록해야 한다 (먼저 파싱한 본문은 다음 파서가 건너뜀)
  const snapshotBodyLimit =
    config.get('AWS_SNAPSHOT_EDIT_MAX_BYTES', { infer: true }) * 2 + 64 * 1024;
  app.use(
    /^\/api\/aws-snapshots\/[^/]+\/files\/[^/]+(\/check)?\/?$/,
    json({ limit: snapshotBodyLimit }),
  );
  // k8s 스냅샷 파일 저장·검사도 같은 방식 (k8s-snapshot.md 7.1: K8S_SNAPSHOT_EDIT_MAX_BYTES × 2 + 64KB)
  const k8sBodyLimit =
    config.get('K8S_SNAPSHOT_EDIT_MAX_BYTES', { infer: true }) * 2 + 64 * 1024;
  app.use(
    /^\/api\/k8s-snapshots\/[^/]+\/file(\/check)?\/?$/,
    json({ limit: k8sBodyLimit }),
  );
  // 본문 1MB 초과 → 413 PAYLOAD_TOO_LARGE (docs/api/common.md 3.3)
  app.useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: config
      .get('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((o) => o.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Retry-After'],
    credentials: false,
  });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(
    `api listening on :${port} (DATA_SOURCE=${config.get('DATA_SOURCE', { infer: true })})`,
    'Bootstrap',
  );
}

void bootstrap();
