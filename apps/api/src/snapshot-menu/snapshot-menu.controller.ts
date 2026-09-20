import { Controller, Get } from '@nestjs/common';
import { SnapshotMenuService } from './snapshot-menu.service';

/** 사이드바 "스냅샷" 메뉴·탭 배지 (docs/api/k8s-snapshot.md 12.1). 항상 200 */
@Controller('snapshot-menu')
export class SnapshotMenuController {
  constructor(private readonly svc: SnapshotMenuService) {}

  @Get()
  get() {
    return this.svc.get();
  }
}
