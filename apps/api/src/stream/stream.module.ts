import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MockScenarioController } from './mock-scenario.controller';
import { MockScenarioService } from './mock-scenario.service';
import { StreamController } from './stream.controller';
import { StreamService } from './stream.service';

/**
 * 단일 SSE 스트림(`/api/stream`)과 mock 시나리오 전환(`/api/mock/...`).
 * 토픽 제공자·시나리오 대상은 DiscoveryService로 찾으므로 다른 모듈을 import하지 않는다.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [StreamController, MockScenarioController],
  providers: [StreamService, MockScenarioService],
  exports: [StreamService],
})
export class StreamModule {}
