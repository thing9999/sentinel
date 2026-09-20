import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  type PipeTransform,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdvisorSettingsService } from './advisor-settings.service';
import { AdvisorService } from './advisor.service';
import type { Category, RunStatus, Severity } from './advisor.types';
import { ApiError } from './api-error';
import { AdvisorBridgeService } from './bridge/advisor-bridge.service';
import {
  IncludeSystemQueryDto,
  PrecheckQueryDto,
  RunListQueryDto,
  StartRunDto,
} from './dto/advisor.dto';
import { AdvisorRunService } from './run/advisor-run.service';
import { byteLength, TRANSMISSION_NOTICE } from './snapshot/snapshot-builder';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `:id`가 uuid가 아니면 400 VALIDATION_FAILED */
class RunIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID_RE.test(value)) {
      throw new ApiError(
        400,
        'VALIDATION_FAILED',
        '요청 값이 올바르지 않습니다.',
        {
          fields: [{ field: 'id', value, constraints: ['id must be a UUID'] }],
        },
      );
    }
    return value;
  }
}

/** docs/api/architecture-advisor.md A (공개 계약) */
@Controller('advisor')
export class AdvisorController {
  constructor(
    private readonly advisor: AdvisorService,
    private readonly runs: AdvisorRunService,
    private readonly bridge: AdvisorBridgeService,
    private readonly settings: AdvisorSettingsService,
  ) {}

  private base() {
    return {
      dataSource: this.settings.dataSource,
      generatedAt: new Date().toISOString(),
    };
  }

  @Get()
  overview() {
    this.advisor.touch();
    return this.advisor.overview();
  }

  @Get('bridge')
  bridgeStatus() {
    this.advisor.touch();
    return { ...this.base(), bridge: this.bridge.status() };
  }

  @Post('bridge/check')
  @HttpCode(200)
  async bridgeCheck(@Res({ passthrough: true }) res: Response) {
    this.advisor.touch();
    try {
      const bridge = await this.bridge.manualCheck();
      return { ...this.base(), bridge };
    } catch (err) {
      if (err instanceof ApiError && err.retryAfterSec !== undefined) {
        res.setHeader('Retry-After', String(err.retryAfterSec));
      }
      throw err;
    }
  }

  @Get('prechecks')
  prechecks(@Query() q: PrecheckQueryDto) {
    this.advisor.touch();
    return this.advisor.prechecksView({
      includeSystem: q.includeSystem ?? false,
      category: (q.category as Category[] | undefined) ?? null,
      severity: (q.severity as Severity[] | undefined) ?? null,
      held: q.held ?? null,
    });
  }

  @Get('snapshot-preview')
  snapshotPreview(@Query() q: IncludeSystemQueryDto) {
    return this.advisor.snapshotPreview(q.includeSystem ?? false);
  }

  @Post('runs')
  async startRun(
    @Body() body: StartRunDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.advisor.touch();
    const result = await this.runs.start(body?.includeSystem ?? false);
    res.status(result.created ? 202 : 200);
    return result;
  }

  @Get('runs')
  async listRuns(@Query() q: RunListQueryDto) {
    const s = await this.settings.get();
    const limit = q.limit ?? 10;
    const offset = q.offset ?? 0;
    const res = await this.runs.list({
      limit,
      offset,
      statuses: (q.status as RunStatus[] | undefined) ?? null,
    });
    return {
      ...this.base(),
      total: res.total,
      filteredTotal: res.filteredTotal,
      offset,
      limit,
      retention: s.retention,
      items: res.items,
    };
  }

  @Get('runs/:id')
  async getRun(@Param('id', new RunIdPipe()) id: string) {
    return { ...this.base(), run: await this.runs.get(id) };
  }

  @Post('runs/:id/cancel')
  @HttpCode(202)
  async cancel(@Param('id', new RunIdPipe()) id: string) {
    return { run: await this.runs.cancel(id) };
  }

  @Get('runs/:id/snapshot')
  async runSnapshot(@Param('id', new RunIdPipe()) id: string) {
    const { record, snapshot } = await this.runs.snapshotOf(id);
    const meta = record.snapshotMeta ?? {
      bytes: byteLength(snapshot),
      redactedCount: snapshot.meta.redactedCount,
      redactedFields: [],
      omitted: snapshot.meta.omitted,
      observationSec: snapshot.meta.observationSec.metrics,
      dataSource: snapshot.meta.dataSource,
      transmissionNotice: TRANSMISSION_NOTICE,
    };
    return { ...this.base(), runId: id, meta, snapshot };
  }

  @Get('runs/:id/raw-response')
  async rawResponse(@Param('id', new RunIdPipe()) id: string) {
    const text = await this.runs.rawResponse(id);
    const s = await this.settings.get();
    const bytes = Buffer.byteLength(text, 'utf8');
    return {
      runId: id,
      truncated: bytes >= s.rawResponseMaxBytes,
      bytes,
      text,
    };
  }
}
