import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ClusterAdvisorSnapshot } from './cluster-advisor.snapshot';
import { ClusterQueryService } from './cluster-query.service';
import {
  ClusterTopicSource,
  MetricsTopicSource,
  OverviewTopicSource,
} from './cluster-topics';
import { ClusterController } from './cluster.controller';
import {
  KubeClientService,
  KubeWatcherService,
} from './kube/kube-watcher.service';
import { MetricsCollectorService } from './kube/metrics-collector.service';
import { MockClusterService } from './mock/mock-cluster.service';
import { OverviewService } from './overview.service';
import { ClusterStateService } from './state/cluster-state.service';
import { ClusterStore } from './state/cluster-store';
import { MetricsIngestor } from './state/metrics-ingest.service';
import { MetricsStore } from './state/metrics-store';

/**
 * cluster-status: 노드·파드·워크로드·이벤트·PVC·메트릭 (읽기 전용 informer + metrics.k8s.io).
 * - export `ClusterStateService`: 비용·어드바이저·DB 모듈이 현재 노드/파드 캐시를 읽는다.
 * - export `KubeWatcherService`: health가 informer 상태를 본다.
 * - export `ClusterStore`·`KubeClientService`: k8s-snapshot 드리프트가 informer 캐시·mock 인벤토리·컨텍스트 이름을 읽는다 (읽기 전용).
 * - export `OverviewService`: alerts 엔진이 `areas.*`·`cost.status`를 **읽기만** 한다
 *   (알림은 상태를 다시 판단하지 않고 이미 계산된 StatusInfo의 전이만 본다).
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [ClusterController],
  providers: [
    ClusterStore,
    MetricsStore,
    MetricsIngestor,
    ClusterStateService,
    KubeClientService,
    KubeWatcherService,
    MetricsCollectorService,
    MockClusterService,
    ClusterQueryService,
    OverviewService,
    ClusterTopicSource,
    MetricsTopicSource,
    OverviewTopicSource,
    ClusterAdvisorSnapshot,
  ],
  exports: [
    ClusterStateService,
    ClusterQueryService,
    KubeWatcherService,
    ClusterStore,
    KubeClientService,
    OverviewService,
  ],
})
export class ClusterModule {}
