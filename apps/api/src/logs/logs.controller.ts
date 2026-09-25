/**
 * `/api/logs/*` (docs/api/logs.md 2절).
 *
 * - `POST /api/logs/query`가 GET이 아닌 이유: 셀렉터와 **검색어**가 URL에 들어가면
 *   프록시 접근 로그·브라우저 이력·리퍼러에 남는다. 상태를 바꾸지 않는 조회다.
 * - **내려받기·내보내기·원문 보기 엔드포인트가 없다** (PM 결정 Q2·Q6).
 * - 로그 스트림은 **전용 연결**이다. 공용 `/api/stream`에 토픽을 만들지 않는다.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { validationFailed } from '../common/api-error';
import { SnapshotWriteGuard } from '../aws-snapshots/write.guard';
import { LogQueryDto } from './dto';
import type { LogCapabilities, LogSourceId } from './logs.types';
import { LogStreamService } from './log-stream.service';
import { LogsService } from './logs.service';

@Controller('logs')
export class LogsController {
  constructor(
    private readonly logs: LogsService,
    private readonly streams: LogStreamService,
  ) {}

  /** 로그 화면이 처음 여는 호출. `LOGS_ENABLED=false`여도 **이것만 200**이다 */
  @Get('capabilities')
  capabilities(): Record<string, unknown> {
    return this.logs.capabilities(this.streams.openCount);
  }

  /** 파드가 사라졌으면 **404가 아니라 200 + `exists:false`** (AC-LOG26) */
  @Get('targets/:namespace/:pod')
  targets(
    @Param('namespace') namespace: string,
    @Param('pod') pod: string,
  ): Record<string, unknown> {
    return this.logs.targets(namespace, pod);
  }

  @Post('query')
  @HttpCode(200)
  @UseGuards(SnapshotWriteGuard)
  query(@Body() body: LogQueryDto): Promise<Record<string, unknown>> {
    this.validate(body, false);
    return this.logs.query(
      {
        source: body.source,
        selector: body.selector,
        range: body.range,
        limit: body.limit,
        search: body.search ?? null,
        anchorAt: body.anchorAt ?? null,
      },
      this.streams.openCount,
    );
  }

  /**
   * 준비 → SSE → touch/close 3단계 중 ①.
   * 상한 초과·권한 없음·파드 없음을 **읽을 수 있는 JSON 오류**로 돌려준다.
   */
  @Post('streams')
  @HttpCode(201)
  @UseGuards(SnapshotWriteGuard)
  createStream(@Body() body: LogQueryDto): Record<string, unknown> {
    const source = this.validate(body, true);
    this.logs.assertStreamable(
      source,
      body.selector.namespace,
      body.selector.pod ?? '',
    );
    const entry = this.streams.prepare(
      source,
      {
        namespace: body.selector.namespace,
        pod: body.selector.pod,
        pods: body.selector.pods,
        workload: body.selector.workload,
        container: body.selector.container,
      },
      body.limit ?? 500,
    );
    return this.streams.describe(entry);
  }

  @Get('stream/:streamId')
  stream(
    @Param('streamId') streamId: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.streams.attach(streamId, res);
  }

  @Post('streams/:streamId/touch')
  @HttpCode(202)
  touch(@Param('streamId') streamId: string): void {
    this.streams.touch(streamId);
  }

  /** `navigator.sendBeacon`으로도 보낼 수 있게 **본문 없는 POST**로 정의했다 */
  @Post('streams/:streamId/close')
  @HttpCode(204)
  closeStream(@Param('streamId') streamId: string): void {
    this.streams.closeById(streamId);
  }

  /** 출처를 정하고 그 출처의 **능력대로** 요청을 검사한다 */
  private validate(body: LogQueryDto, forStream: boolean): LogSourceId {
    const source: LogSourceId = body.source ?? this.logs.activeSource();
    if (source === 'stack' && !this.logs.stackAvailable) {
      throw validationFailed(
        [
          {
            field: 'source',
            value: undefined,
            constraints: [
              '외부 로그 스택이 설정돼 있지 않습니다. source는 direct만 쓸 수 있습니다.',
            ],
          },
        ],
        '선택한 로그 출처를 쓸 수 없습니다.',
      );
    }
    validateBySource(
      body,
      source,
      this.logs.capabilitiesOf(source),
      forStream,
      this.logs.stackMaxRangeHours,
    );
    return source;
  }
}

/**
 * 출처 **능력**에 따라 막는다 (계약 2.2·2.3.1).
 * 화면이 "될 것 같다"고 보내는 일을 막고, **오류 응답에 입력값을 싣지 않는다.**
 * 능력 표를 컨트롤러가 따로 들지 않고 `capabilities`와 같은 값을 쓴다 — 두 벌이 되면 어긋난다.
 */
function validateBySource(
  body: LogQueryDto,
  source: LogSourceId,
  caps: LogCapabilities,
  forStream: boolean,
  maxRangeHours: number,
): void {
  const fields: { field: string; value: unknown; constraints: string[] }[] = [];
  const sel = body.selector;

  if (!caps.multiPod && (sel.pods?.length || sel.workload)) {
    fields.push({
      field: 'selector.pods',
      value: undefined,
      constraints: [
        `${source} 출처는 여러 파드 합쳐보기를 지원하지 않습니다 (capabilities.multiPod=false)`,
      ],
    });
  }
  if (!sel.pod && !sel.pods?.length && !sel.workload) {
    fields.push({
      field: 'selector.pod',
      value: undefined,
      constraints: ['조회할 파드를 지정해야 합니다'],
    });
  }
  if (body.search && !caps.serverSearch) {
    fields.push({
      field: 'search',
      value: undefined,
      constraints: [
        `${source} 출처는 서버 검색을 지원하지 않습니다 (capabilities.serverSearch=false). 가져온 줄 안에서 찾으세요`,
      ],
    });
  }
  if (sel.previous && !caps.previousGeneration) {
    fields.push({
      field: 'selector.previous',
      value: undefined,
      constraints: ['이 출처에는 "이전 세대"가 없습니다. 기간으로 지정하세요'],
    });
  }
  if (forStream && body.anchorAt) {
    fields.push({
      field: 'anchorAt',
      value: undefined,
      constraints: [
        '그 시각으로 열기는 정지 조회에서만 됩니다. 따라가기와 함께 쓸 수 없습니다',
      ],
    });
  }
  if (forStream && sel.previous) {
    fields.push({
      field: 'selector.previous',
      value: undefined,
      constraints: [
        '이전 세대는 따라갈 수 없습니다 (끝난 로그입니다). 정지 조회로 보세요',
      ],
    });
  }
  // 스택 보호: 너무 긴 기간을 그대로 넘기지 않는다
  if (body.range?.from && body.range?.to && source === 'stack') {
    const hours =
      (Date.parse(body.range.to) - Date.parse(body.range.from)) / 3_600_000;
    if (hours > maxRangeHours) {
      fields.push({
        field: 'range',
        value: undefined,
        constraints: [
          `한 번에 조회할 수 있는 기간은 ${maxRangeHours}시간까지입니다`,
        ],
      });
    }
  }
  if (fields.length > 0) throw validationFailed(fields);
}
