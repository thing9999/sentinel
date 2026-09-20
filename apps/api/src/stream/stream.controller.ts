import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StreamService } from './stream.service';

/** `GET /api/stream?topics=overview,cluster,...` (docs/api/common.md 5절) */
@Controller('stream')
export class StreamController {
  constructor(private readonly stream: StreamService) {}

  @Get()
  async open(
    @Query('topics') topics: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const list = this.stream.parseTopics(topics);
    await this.stream.open(res, list);
  }
}
