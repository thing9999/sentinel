import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import { DATA_SOURCE_MODE } from './data-source';
import { LogLinkPolicy } from './log-link-policy.service';
import { SettingsService } from './settings.service';
import { SourceRegistry } from './source-registry.service';

@Global()
@Module({
  providers: [
    {
      provide: DATA_SOURCE_MODE,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): DataSourceMode => config.get<DataSourceMode>('DATA_SOURCE'),
    },
    SourceRegistry,
    SettingsService,
    // 로그 링크 가능 여부의 실효 값. cluster·logs·alerts가 같은 값을 본다 (logs.md 11.4)
    LogLinkPolicy,
  ],
  exports: [DATA_SOURCE_MODE, SourceRegistry, SettingsService, LogLinkPolicy],
})
export class CommonModule {}
