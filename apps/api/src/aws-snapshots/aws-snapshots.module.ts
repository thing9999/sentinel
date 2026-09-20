import { Module } from '@nestjs/common';
import { AwsSnapshotsController } from './aws-snapshots.controller';
import { AwsSnapshotsService } from './aws-snapshots.service';
import { SnapshotWriteGuard } from './write.guard';

/**
 * aws-snapshot-manager: 로컬 AWS 스냅샷 폴더 보기·편집·휴지통.
 * PrismaService에 의존하지 않는다 (DB 없이 실행해도 동작).
 */
@Module({
  controllers: [AwsSnapshotsController],
  providers: [AwsSnapshotsService, SnapshotWriteGuard],
  exports: [AwsSnapshotsService],
})
export class AwsSnapshotsModule {}
