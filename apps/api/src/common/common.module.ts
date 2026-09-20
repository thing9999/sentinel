import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import { DATA_SOURCE_MODE } from './data-source';
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
  ],
  exports: [DATA_SOURCE_MODE, SourceRegistry, SettingsService],
})
export class CommonModule {}
