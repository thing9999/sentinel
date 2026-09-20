/**
 * aws-cost REST (docs/api/aws-cost.md). 모든 조회는 메모리 캐시에서 답하며 AWS를 부르지 않는다.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CostService } from './cost.service';
import {
  AllocationQueryDto,
  CostSettingsPatchDto,
  RateSeriesQueryDto,
} from './dto/cost.dto';

@Controller('cost')
export class CostController {
  constructor(private readonly cost: CostService) {}

  @Get('summary')
  summary() {
    return this.cost.getSummary();
  }

  @Get('estimate')
  estimate() {
    return this.cost.getEstimate();
  }

  @Get('allocation')
  allocation(@Query() q: AllocationQueryDto) {
    return this.cost.getAllocation(q);
  }

  @Get('rate-series')
  rateSeries(@Query() q: RateSeriesQueryDto) {
    return this.cost.getRateSeries(q.range ?? '7d');
  }

  @Get('status')
  status() {
    return this.cost.getStatus();
  }

  @Get('actual')
  actual() {
    return this.cost.getActual();
  }

  @Get('explorer/refresh')
  refreshStatus() {
    return this.cost.getRefresh();
  }

  @Post('explorer/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  refresh() {
    return this.cost.requestRefresh();
  }

  @Get('settings')
  settings() {
    return this.cost.getSettings();
  }

  @Patch('settings')
  patchSettings(@Body() body: CostSettingsPatchDto) {
    return this.cost.patchSettings(body);
  }
}
