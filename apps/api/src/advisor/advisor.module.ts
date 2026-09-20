import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AdvisorEvents } from './advisor-events';
import { AdvisorOverviewSummaryProvider } from './advisor-overview.summary';
import { AdvisorSettingsService } from './advisor-settings.service';
import { AdvisorTopicSource } from './advisor-topic.source';
import { AdvisorController } from './advisor.controller';
import { AdvisorService } from './advisor.service';
import { AdvisorBridgeService } from './bridge/advisor-bridge.service';
import { AdvisorMockScenarios } from './mock/advisor-mock-scenarios';
import { AdvisorScenarioState } from './mock/advisor-scenario.state';
import { AdvisorPrecheckService } from './precheck/advisor-precheck.service';
import { AdvisorRunRepository } from './run/advisor-run.repository';
import { AdvisorRunService } from './run/advisor-run.service';
import { AdvisorSnapshotService } from './snapshot/advisor-snapshot.service';

/**
 * architecture-advisor: 규칙 기반 사전 점검 + 로컬 Claude Code(agent-bridge) 분석
 * 계약: docs/api/architecture-advisor.md
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [AdvisorController],
  providers: [
    AdvisorEvents,
    AdvisorSettingsService,
    AdvisorScenarioState,
    AdvisorSnapshotService,
    AdvisorPrecheckService,
    AdvisorBridgeService,
    AdvisorRunRepository,
    AdvisorRunService,
    AdvisorService,
    AdvisorTopicSource,
    AdvisorMockScenarios,
    AdvisorOverviewSummaryProvider,
  ],
  exports: [AdvisorTopicSource, AdvisorMockScenarios, AdvisorService],
})
export class AdvisorModule {}
