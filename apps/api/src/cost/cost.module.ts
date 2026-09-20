import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AwsSdkCostGateway } from './aws/aws-sdk.gateway';
import { COST_AWS_GATEWAY, type CostAwsGateway } from './aws/aws-gateway';
import { ClusterModule } from '../cluster/cluster.module';
import { ClusterStateService } from '../cluster/state/cluster-state.service';
import {
  CLUSTER_INVENTORY_PORT,
  type ClusterInventoryPort,
} from './cluster-inventory.port';
import { ClusterStateInventoryAdapter } from './cluster-state.inventory';
import { CostController } from './cost.controller';
import {
  CostAdvisorSnapshot,
  CostMockScenarioTarget,
  CostOverviewSummary,
  CostTopicSource,
} from './cost.extensions';
import {
  COST_OPTIONS,
  buildCostOptions,
  type CostOptions,
} from './cost.options';
import { CostService } from './cost.service';
import { CostSettingsService } from './settings/cost-settings.service';
import { CostStore } from './store/cost-store';

/**
 * aws-cost 모듈 (docs/api/aws-cost.md).
 *
 * 클러스터 인벤토리는 `CLUSTER_INVENTORY_PORT`로 받는다. ClusterModule이 export한
 * `ClusterStateService`를 `ClusterStateInventoryAdapter`로 이 포트에 잇는다 (live·mock 공통).
 * mock에서는 cluster mock 인벤토리를 기준으로 비용 mock 세계를 만들어 두 화면의 노드·파드가 같다.
 * 의존 방향: CostModule → ClusterModule (ClusterModule은 cost를 import하지 않는다.
 * 개요 카드는 DiscoveryService로 `CostOverviewSummary`를 찾는다).
 */
@Module({
  imports: [ClusterModule],
  controllers: [CostController],
  providers: [
    {
      provide: COST_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): CostOptions =>
        buildCostOptions((k) => config.get<unknown>(k)),
    },
    {
      provide: CLUSTER_INVENTORY_PORT,
      inject: [ClusterStateService],
      useFactory: (state: ClusterStateService): ClusterInventoryPort =>
        new ClusterStateInventoryAdapter(state),
    },
    {
      // mock이거나 리전이 없으면 SDK 클라이언트를 만들지 않는다 (AWS 호출 0회)
      provide: COST_AWS_GATEWAY,
      inject: [COST_OPTIONS],
      useFactory: (o: CostOptions): CostAwsGateway | null =>
        o.dataSource === 'live' && o.awsRegion
          ? new AwsSdkCostGateway(o.awsRegion, o.awsProfile ?? undefined)
          : null,
    },
    CostStore,
    CostSettingsService,
    CostService,
    CostTopicSource,
    CostMockScenarioTarget,
    CostAdvisorSnapshot,
    CostOverviewSummary,
  ],
  exports: [CostService],
})
export class CostModule {}
