/**
 * `/api/alerts/*` (docs/api/alerts.md 2절).
 *
 * **라우트 순서가 곧 계약이다.** `@Get(':id')`가 위에 있으면 `badge`·`settings`·
 * `test/preview`가 전부 "없는 알림 id"로 잡혀 404가 된다(P1에서 실제로 그랬다).
 * 구체 경로를 먼저, 와일드카드를 **맨 마지막에** 선언한다.
 *
 * 이 컨트롤러는 **웹훅 원문을 돌려주는 경로를 가지지 않는다.** 저장은 `PATCH`
 * 하나이고, 조회는 끝 4자 힌트뿐이다 (AC-ALERT20).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SnapshotWriteGuard } from '../aws-snapshots/write.guard';
import { AlertsService } from './alerts.service';
import {
  AlertSettingsPatchDto,
  AlertsQueryDto,
  AlertsReadDto,
  AlertTestDto,
} from './dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  // --- 구체 경로 (반드시 `:id`보다 먼저) ------------------------------------------

  /**
   * 사이드바 배지. **`unreadCount`·`worstSeverity`·`updatedAt` 3개뿐이다** —
   * 목록·최근 N건·개요 요약을 넣지 않는다 (상단바 벨과 패널이 없다, 사용자 결정 Q1).
   */
  @Get('badge')
  badge(): Promise<Record<string, unknown>> {
    return this.alerts.badgeEnvelope();
  }

  /** 조회는 대시보드 DB가 없어도 200이다 (`persistence: "memory"` + 기본값) */
  @Get('settings')
  settings(): Promise<Record<string, unknown>> {
    return this.alerts.settings();
  }

  /** 확인 대화상자가 쓴다. **이 호출은 아무것도 보내지 않는다** */
  @Get('test/preview')
  testPreview(): Promise<Record<string, unknown>> {
    return this.alerts.testPreview();
  }

  /** 부분 갱신. 환경 변수로 고정된 필드를 바꾸려 하면 409 */
  @Patch('settings')
  @UseGuards(SnapshotWriteGuard)
  patchSettings(
    @Body() body: AlertSettingsPatchDto,
  ): Promise<Record<string, unknown>> {
    return this.alerts.patchSettings(body);
  }

  /** 되돌릴 수 없는 외부 동작. `confirm: true`가 없으면 422 */
  @Post('test')
  @HttpCode(200)
  @UseGuards(SnapshotWriteGuard)
  sendTest(@Body() body: AlertTestDto): Promise<Record<string, unknown>> {
    return this.alerts.sendTest(body);
  }

  /** 확인 상태는 **서버에 하나**다 (로그인이 없다). 모든 탭·브라우저가 같은 값을 본다 */
  @Patch('read')
  @UseGuards(SnapshotWriteGuard)
  markRead(@Body() body: AlertsReadDto): Promise<Record<string, unknown>> {
    return this.alerts.markRead(body);
  }

  // --- 목록·상세 ----------------------------------------------------------------

  /** 이력 목록 — `/alerts` 화면 전용. 정렬은 `occurredAt` 내림차순 **고정**이다 */
  @Get()
  list(@Query() q: AlertsQueryDto): Promise<Record<string, unknown>> {
    return this.alerts.list(q);
  }

  /** ⚠️ 와일드카드는 **맨 마지막**. 위에 올리면 구체 경로가 전부 404가 된다 */
  @Get(':id')
  detail(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.alerts.detail(id);
  }
}
