import { Module } from '@nestjs/common';
import { ClusterModule } from '../cluster/cluster.module';
import { DbHealthController } from './db-health.controller';
import { DbHealthService } from './db-health.service';
import { DbAdvisorSnapshot, DbTopicSource } from './db-topics';

/**
 * 모니터링 대상 DB 상태: DBA 조회 쿼리(src/database/health)를 주기 실행 + DB StatefulSet·파드·PVC 결합.
 * ClusterStateService에 DbAreaProvider로 등록해 개요·지금 확인할 항목에 DB 영역을 채운다.
 */
@Module({
  imports: [ClusterModule],
  controllers: [DbHealthController],
  providers: [DbHealthService, DbTopicSource, DbAdvisorSnapshot],
  exports: [DbHealthService],
})
export class DbHealthModule {}
