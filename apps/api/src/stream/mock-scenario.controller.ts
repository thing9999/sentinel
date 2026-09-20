import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { MockScenarioService } from './mock-scenario.service';

export class SetScenarioDto {
  @IsString()
  @Length(1, 64)
  scenario!: string;

  /** 어드바이저만 */
  @IsOptional()
  @IsBoolean()
  fastTimers?: boolean;
}

/** mock 시나리오 전환 (docs/api/common.md 6절) */
@Controller('mock')
export class MockScenarioController {
  constructor(private readonly mock: MockScenarioService) {}

  @Get('scenarios')
  list() {
    return this.mock.list();
  }

  @Put('scenarios/:group')
  set(@Param('group') group: string, @Body() body: SetScenarioDto) {
    return this.mock.set(group, body.scenario, body.fastTimers);
  }

  @Post('reset')
  @HttpCode(200)
  reset() {
    return this.mock.reset();
  }
}
