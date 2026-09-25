/**
 * alerts 모듈 (docs/api/alerts.md).
 *
 * 의존 방향: AlertsModule → ClusterModule(상태 읽기) · LogsModule(링크만).
 * **관측 대상에 대한 쓰기가 하나도 늘지 않는다** — 새 조회도, 새 `SourceId`도,
 * 새 RBAC·IAM도 만들지 않는다. 알림은 이미 계산된 `StatusInfo`의 파생이다.
 *
 * 밖으로 나가는 문은 **`DiscordSenderPort` 하나뿐**이다(P2). 주입 가능한 토큰이라
 * 테스트가 "mock 모드에서 한 번도 불리지 않았다"를 직접 검사한다 (AC-ALERT26).
 */
import { Module } from '@nestjs/common';
import { ClusterModule } from '../cluster/cluster.module';
import { LogsModule } from '../logs/logs.module';
import { AlertDispatcher } from './alert-dispatcher.service';
import { AlertEngine } from './alert-engine.service';
import { AlertSettingsService } from './alert-settings.service';
import { AlertStore } from './alert-store.service';
import { DISCORD_SENDER, HttpDiscordSender } from './discord-sender';
import { AlertsController } from './alerts.controller';
import {
  AlertsMockScenarioTarget,
  AlertsTopicSource,
} from './alerts.extensions';
import { AlertsService } from './alerts.service';

@Module({
  imports: [ClusterModule, LogsModule],
  controllers: [AlertsController],
  providers: [
    AlertStore,
    AlertSettingsService,
    { provide: DISCORD_SENDER, useClass: HttpDiscordSender },
    AlertDispatcher,
    AlertEngine,
    AlertsService,
    AlertsTopicSource,
    AlertsMockScenarioTarget,
  ],
  exports: [AlertsService],
})
export class AlertsModule {}
