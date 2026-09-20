import { Module } from '@nestjs/common';
import { SnapshotWriteGuard } from '../aws-snapshots/write.guard';
import { ClusterModule } from '../cluster/cluster.module';
import { ClusterObjectSource } from './drift/cluster-object-source';
import { DriftService } from './drift/drift.service';
import { K8sGraphService } from './graph/graph.service';
import { K8sSnapshotsController } from './k8s-snapshots.controller';
import { K8sSnapshotsService } from './k8s-snapshots.service';

/**
 * k8s-snapshot: 로컬 k8s 스냅샷 폴더 보기·편집·휴지통 + 드리프트 (docs/api/k8s-snapshot.md).
 * PrismaService에 의존하지 않는다. 드리프트는 cluster 모듈의 informer 캐시(ClusterStore·KubeWatcherService)를 읽기만 한다.
 */
@Module({
  imports: [ClusterModule],
  controllers: [K8sSnapshotsController],
  providers: [
    K8sSnapshotsService,
    DriftService,
    K8sGraphService,
    ClusterObjectSource,
    SnapshotWriteGuard,
  ],
  exports: [K8sSnapshotsService],
})
export class K8sSnapshotsModule {}
