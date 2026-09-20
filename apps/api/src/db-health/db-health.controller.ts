import { Controller, Get } from '@nestjs/common';
import { DbHealthService, type DbDetail } from './db-health.service';

/** `GET /api/cluster/db` (docs/api/cluster-status.md 7.4). 항상 200 */
@Controller('cluster/db')
export class DbHealthController {
  constructor(private readonly db: DbHealthService) {}

  @Get()
  detail(): DbDetail {
    return this.db.detail();
  }
}
