import { Module } from '@nestjs/common';
import { AwsSnapshotsModule } from '../aws-snapshots/aws-snapshots.module';
import { K8sSnapshotsModule } from '../k8s-snapshots/k8s-snapshots.module';
import { SnapshotMenuController } from './snapshot-menu.controller';
import { SnapshotMenuService } from './snapshot-menu.service';

/** AWS·k8s 스냅샷 요약 합산 (메뉴·탭). PrismaService 비의존 */
@Module({
  imports: [AwsSnapshotsModule, K8sSnapshotsModule],
  controllers: [SnapshotMenuController],
  providers: [SnapshotMenuService],
})
export class SnapshotMenuModule {}
