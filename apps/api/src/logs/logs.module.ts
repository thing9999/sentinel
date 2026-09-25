/**
 * logs 모듈 (docs/api/logs.md).
 *
 * 의존 방향: LogsModule → ClusterModule (informer 캐시·kubeconfig를 읽기만 한다).
 * **로그 때문에 쿠버네티스에 추가 조회를 하지 않는다** — 파드·컨테이너 목록은
 * 기존 informer 캐시에서 만들고, 새로 부르는 것은 `pods/log`의 `get` 하나뿐이다.
 *
 * `LogLinkService`를 export한다 — `alerts`가 **링크만** 만들 때 쓴다(로그 줄은 나가지 않는다).
 */
import { Module } from '@nestjs/common';
import { ClusterModule } from '../cluster/cluster.module';
import { LogBackendService } from './backend/log-backend.service';
import { DirectLogSource } from './direct-source';
import { LogLinkService } from './log-link.service';
import { LogStreamService } from './log-stream.service';
import { LogsController } from './logs.controller';
import { LogsMockScenarioTarget } from './logs.extensions';
import { LogsOptions } from './logs.options';
import { LogsService } from './logs.service';

@Module({
  imports: [ClusterModule],
  controllers: [LogsController],
  providers: [
    LogsOptions,
    DirectLogSource,
    LogBackendService,
    LogsService,
    LogStreamService,
    LogLinkService,
    LogsMockScenarioTarget,
  ],
  exports: [LogLinkService, LogsOptions],
})
export class LogsModule {}
