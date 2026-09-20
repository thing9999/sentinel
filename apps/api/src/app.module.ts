import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AdvisorModule } from './advisor/advisor.module';
import { AwsSnapshotsModule } from './aws-snapshots/aws-snapshots.module';
import { ClusterModule } from './cluster/cluster.module';
import { CommonModule } from './common/common.module';
import { validateEnv } from './config/env.validation';
import { CostModule } from './cost/cost.module';
import { PrismaModule } from './database/prisma.module';
import { DbHealthModule } from './db-health/db-health.module';
import { HealthModule } from './health/health.module';
import { K8sSnapshotsModule } from './k8s-snapshots/k8s-snapshots.module';
import { SnapshotMenuModule } from './snapshot-menu/snapshot-menu.module';
import { StreamModule } from './stream/stream.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // apps/api/.env 우선, 없으면 루트 .env (docker compose와 같은 파일)
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    PrismaModule,
    HealthModule,
    ClusterModule,
    DbHealthModule,
    StreamModule,
    CostModule,
    AdvisorModule,
    AwsSnapshotsModule,
    K8sSnapshotsModule,
    SnapshotMenuModule,
  ],
})
export class AppModule {}
