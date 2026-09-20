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
import { validationFailed } from '../common/api-error';
import { AwsSnapshotsService } from './aws-snapshots.service';
import {
  ConfirmQueryDto,
  FileContentDto,
  FileSaveDto,
  NotesDto,
  SnapshotListQueryDto,
} from './dto';
import {
  FILE_KINDS,
  SNAPSHOT_ID_RE,
  TRASH_ID_RE,
  type FileKind,
} from './snapshot.constants';
import { SnapshotWriteGuard } from './write.guard';

/** 형식 검사는 파일 시스템 접근 전에. 요청 값은 오류 응답에 되풀이하지 않는다 (계약 1.1, 1.4) */
@Injectable()
export class SnapshotIdPipe implements PipeTransform<string, string> {
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
export class TrashIdPipe implements PipeTransform<string, string> {
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

@Injectable()
export class FileKindPipe implements PipeTransform<string, FileKind> {
  transform(value: string): FileKind {
    if (!(FILE_KINDS as readonly string[]).includes(value))
      throw validationFailed([
        {
          field: 'kind',
          value: undefined,
          constraints: [`kind must be one of: ${FILE_KINDS.join(', ')}`],
        },
      ]);
    return value as FileKind;
  }
}

/**
 * aws-snapshot-manager REST (docs/api/aws-snapshot-manager.md).
 * 고정 경로를 :id보다 먼저, catch-all(400)을 맨 끝에 둔다.
 */
@Controller('aws-snapshots')
export class AwsSnapshotsController {
  constructor(private readonly svc: AwsSnapshotsService) {}

  @Get('summary')
  summary() {
    return this.svc.getSummary();
  }

  @Get('scan-rules')
  scanRules() {
    return this.svc.scanRules();
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
  restore(@Param('trashId', TrashIdPipe) trashId: string) {
    return this.svc.restore(trashId);
  }

  @Delete('trash/:trashId')
  @UseGuards(SnapshotWriteGuard)
  purge(
    @Param('trashId', TrashIdPipe) trashId: string,
    @Query() q: ConfirmQueryDto,
  ) {
    return this.svc.purge(trashId, q.confirm);
  }

  @Get()
  list(@Query() q: SnapshotListQueryDto) {
    return this.svc.list(q);
  }

  @Get(':id')
  detail(@Param('id', SnapshotIdPipe) id: string) {
    return this.svc.detail(id);
  }

  @Get(':id/files/:kind')
  file(
    @Param('id', SnapshotIdPipe) id: string,
    @Param('kind', FileKindPipe) kind: FileKind,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.svc.file(id, kind, res);
  }

  @Post(':id/files/:kind/check')
  @HttpCode(200)
  @UseGuards(SnapshotWriteGuard)
  check(
    @Param('id', SnapshotIdPipe) id: string,
    @Param('kind', FileKindPipe) kind: FileKind,
    @Body() body: FileContentDto,
  ) {
    return this.svc.check(id, kind, body.content);
  }

  @Put(':id/files/:kind')
  @UseGuards(SnapshotWriteGuard)
  save(
    @Param('id', SnapshotIdPipe) id: string,
    @Param('kind', FileKindPipe) kind: FileKind,
    @Body() body: FileSaveDto,
  ) {
    return this.svc.save(id, kind, body);
  }

  @Put(':id/notes')
  @UseGuards(SnapshotWriteGuard)
  notes(@Param('id', SnapshotIdPipe) id: string, @Body() body: NotesDto) {
    return this.svc.saveNotes(id, body);
  }

  @Delete(':id')
  @UseGuards(SnapshotWriteGuard)
  remove(@Param('id', SnapshotIdPipe) id: string, @Query() q: ConfirmQueryDto) {
    return this.svc.moveToTrash(id, q.confirm);
  }

  /** 어느 라우트에도 맞지 않는 /api/aws-snapshots/* → 400 (경로 탐색 시도 포함, AC-40) */
  @All('*path')
  catchAll(): never {
    throw validationFailed([
      { field: 'id', value: undefined, constraints: ['invalid snapshot path'] },
    ]);
  }
}
