import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { RetentionService } from './retention.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, RetentionService],
  exports: [HealthService],
})
export class HealthModule {}
