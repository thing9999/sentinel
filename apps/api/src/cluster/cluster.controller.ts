import { Controller, Get, Param, Query } from '@nestjs/common';
import { ClusterQueryService } from './cluster-query.service';
import {
  AttentionQueryDto,
  EventsQueryDto,
  NodesQueryDto,
  PodsQueryDto,
  PvcsQueryDto,
  SeriesQueryDto,
  WorkloadParamsDto,
  WorkloadsQueryDto,
} from './dto';
import { OverviewService } from './overview.service';

/** docs/api/cluster-status.md 2~7절 (DB 상세 `GET /api/cluster/db`는 db-health 모듈) */
@Controller()
export class ClusterController {
  constructor(
    private readonly query: ClusterQueryService,
    private readonly overviewService: OverviewService,
  ) {}

  @Get('overview')
  overview() {
    return this.overviewService.overview();
  }

  @Get('cluster/summary')
  summary() {
    return this.query.summary();
  }

  @Get('cluster/attention')
  attention(@Query() q: AttentionQueryDto) {
    return this.query.attention(q);
  }

  @Get('cluster/nodes')
  nodes(@Query() q: NodesQueryDto) {
    return this.query.nodes(q);
  }

  /** 컨트롤 플레인 상세 (계약 3.3). 쿼리 없음, 항상 200 */
  @Get('cluster/control-plane')
  controlPlane() {
    return this.query.controlPlane();
  }

  @Get('cluster/nodes/:name')
  node(@Param('name') name: string) {
    return this.query.node(name);
  }

  @Get('cluster/workloads')
  workloads(@Query() q: WorkloadsQueryDto) {
    return this.query.workloads(q);
  }

  @Get('cluster/workloads/:kind/:namespace/:name')
  workload(@Param() p: WorkloadParamsDto) {
    return this.query.workload(p.kind, p.namespace, p.name);
  }

  @Get('cluster/pods')
  pods(@Query() q: PodsQueryDto) {
    return this.query.pods(q);
  }

  @Get('cluster/pods/:namespace/:name')
  pod(@Param('namespace') namespace: string, @Param('name') name: string) {
    return this.query.pod(namespace, name);
  }

  @Get('cluster/events')
  events(@Query() q: EventsQueryDto) {
    return this.query.events(q);
  }

  @Get('cluster/pvcs')
  pvcs(@Query() q: PvcsQueryDto) {
    return this.query.pvcs(q);
  }

  @Get('cluster/metrics')
  metrics() {
    return this.query.metrics();
  }

  @Get('cluster/metrics/series')
  series(@Query() q: SeriesQueryDto) {
    return this.query.series(q);
  }
}
