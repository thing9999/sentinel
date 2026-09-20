import {
  All,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Param,
  PipeTransform,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SnapshotWriteGuard } from '../aws-snapshots/write.guard';
import { validationFailed } from '../common/api-error';
import {
  DriftRequestDto,
  K8sConfirmQueryDto,
  K8sFileContentDto,
  K8sFileSaveDto,
  K8sGraphQueryDto,
  K8sNotesDto,
  K8sSnapshotListQueryDto,
} from './dto';
import { K8sSnapshotsService } from './k8s-snapshots.service';
import { SNAPSHOT_ID_RE, TRASH_ID_RE } from './k8s.constants';

/** 형식 검사는 파일 시스템 접근 전에. 요청 값은 오류 응답에 되풀이하지 않는다 (계약 1.1, 1.4) */
@Injectable()
export class K8sSnapshotIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !SNAPSHOT_ID_RE.test(value))
      throw validationFailed([
        {
          field: 'id',
          value: undefined,
          constraints: ['id must match YYYYMMDD-HHmmss'],
        },
      ]);
    return value;
  }
}

@Injectable()
export class K8sTrashIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !TRASH_ID_RE.test(value))
      throw validationFailed([
        {
          field: 'trashId',
          value: undefined,
          constraints: [
            'trashId must match YYYYMMDD-HHmmss__YYYYMMDDTHHmmssSSSZ',
          ],
        },
      ]);
    return value;
  }
}

/** 쿼리 path 는 문자열 하나만 (배열·객체 거부). 형식은 서비스가 lib 경로 규칙으로 검사 */
function pathParam(q: Record<string, unknown>): unknown {
  const v = q.path;
  if (typeof v !== 'string')
    throw validationFailed([
      { field: 'path', value: undefined, constraints: ['path is required'] },
    ]);
  return v;
}

/**
 * k8s-snapshot REST (docs/api/k8s-snapshot.md). 고정 경로를 :id 보다 먼저, catch-all(400)을 맨 끝에.
 * 적용·내보내기·kubectl 실행 엔드포인트는 없다.
 */
@Controller('k8s-snapshots')
export class K8sSnapshotsController {
  constructor(private readonly svc: K8sSnapshotsService) {}

  @Get('summary')
  summary() {
    return this.svc.getSummary();
  }

  @Get('scan-rules')
  scanRules() {
    return this.svc.scanRules();
  }

  @Get('drift-rules')
  driftRules() {
    return this.svc.driftRules();
  }

  @Post('refresh')
  @HttpCode(200)
  @UseGuards(SnapshotWriteGuard)
  refresh() {
    return this.svc.refreshNow();
  }

  @Get('trash')
  trash() {
    return this.svc.listTrash();
  }

  @Post('trash/:trashId/restore')
  @HttpCode(200)
  @UseGuards(SnapshotWriteGuard)
  restore(@Param('trashId', K8sTrashIdPipe) trashId: string) {
    return this.svc.restore(trashId);
  }

  @Delete('trash/:trashId')
  @UseGuards(SnapshotWriteGuard)
  purge(
    @Param('trashId', K8sTrashIdPipe) trashId: string,
    @Query() q: K8sConfirmQueryDto,
  ) {
    return this.svc.purge(trashId, q.confirm);
  }

  @Get()
  list(@Query() q: K8sSnapshotListQueryDto) {
    return this.svc.list(q);
  }

  @Get(':id')
  detail(@Param('id', K8sSnapshotIdPipe) id: string) {
    return this.svc.detail(id);
  }

  @Get(':id/file')
  file(
    @Param('id', K8sSnapshotIdPipe) id: string,
    @Query() q: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.svc.file(id, pathParam(q), res);
  }

  @Post(':id/file/check')
  @HttpCode(200)
  @UseGuards(SnapshotWriteGuard)
  check(
    @Param('id', K8sSnapshotIdPipe) id: string,
    @Query() q: Record<string, unknown>,
    @Body() body: K8sFileContentDto,
  ) {
    return this.svc.check(id, pathParam(q), body.content);
  }

  @Put(':id/file')
  @UseGuards(SnapshotWriteGuard)
  save(
    @Param('id', K8sSnapshotIdPipe) id: string,
    @Query() q: Record<string, unknown>,
    @Body() body: K8sFileSaveDto,
  ) {
    return this.svc.save(id, pathParam(q), body);
  }

  @Put(':id/notes')
  @UseGuards(SnapshotWriteGuard)
  notes(@Param('id', K8sSnapshotIdPipe) id: string, @Body() body: K8sNotesDto) {
    return this.svc.saveNotes(id, body);
  }

  /** 3D 구성 그래프 (docs/api/snapshot-3d.md). 조회 전용, 드리프트를 계산하지 않는다 */
  @Get(':id/graph')
  graph(
    @Param('id', K8sSnapshotIdPipe) id: string,
    @Query() q: K8sGraphQueryDto,
  ) {
    return this.svc.graph(id, q);
  }

  @Get(':id/drift')
  getDrift(@Param('id', K8sSnapshotIdPipe) id: string) {
    return this.svc.getDrift(id);
  }

  @Post(':id/drift')
  @HttpCode(200)
  @UseGuards(SnapshotWriteGuard)
  requestDrift(
    @Param('id', K8sSnapshotIdPipe) id: string,
    @Body() body: DriftRequestDto,
  ) {
    return this.svc.requestDrift(id, body.force === true);
  }

  @Delete(':id')
  @UseGuards(SnapshotWriteGuard)
  remove(
    @Param('id', K8sSnapshotIdPipe) id: string,
    @Query() q: K8sConfirmQueryDto,
  ) {
    return this.svc.moveToTrash(id, q.confirm);
  }

  /** 어느 라우트에도 맞지 않는 /api/k8s-snapshots/* → 400 (경로 탐색 시도 포함, AC-K24) */
  @All('*path')
  catchAll(): never {
    throw validationFailed([
      { field: 'id', value: undefined, constraints: ['invalid snapshot path'] },
    ]);
  }
}
