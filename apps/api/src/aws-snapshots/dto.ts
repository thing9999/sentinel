import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Validate,
} from 'class-validator';
import { STATUS_VALUES } from '../common/status';
import {
  CsvList,
  PageQueryDto,
  SortSpecConstraint,
} from '../common/list-query';
import { CONFIRM_VALUES, LABEL_MAX, MEMO_MAX } from './snapshot.constants';

export class SnapshotListQueryDto extends PageQueryDto {
  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(STATUS_VALUES, { each: true })
  status?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  region?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @Validate(SortSpecConstraint, [['snapshotAt', 'status']])
  sort?: string;
}

const VERSION_RE = /^sha256:[0-9a-f]{64}$/;

export class FileContentDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  @Matches(VERSION_RE, { message: 'baseVersion must be sha256:<64 hex>' })
  baseVersion?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CONFIRM_VALUES, { each: true })
  confirm?: string[];
}

export class FileSaveDto extends FileContentDto {
  @IsString()
  @Matches(VERSION_RE, { message: 'baseVersion must be sha256:<64 hex>' })
  declare baseVersion: string;
}

/** 라벨: 줄바꿈·제어 문자 금지. 메모: 줄바꿈·탭만 허용 */
// eslint-disable-next-line no-control-regex
const LABEL_RE = /^[^\u0000-\u001f\u007f]*$/;
// eslint-disable-next-line no-control-regex
const MEMO_RE = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

export class NotesDto {
  @IsString()
  @MaxLength(LABEL_MAX)
  @Matches(LABEL_RE, { message: 'label must not contain control characters' })
  label!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\r\n/g, '\n') : value,
  )
  @IsString()
  @MaxLength(MEMO_MAX)
  @Matches(MEMO_RE, {
    message: 'memo must not contain control characters other than newline/tab',
  })
  memo!: string;

  @IsString()
  @Matches(VERSION_RE, { message: 'baseVersion must be sha256:<64 hex>' })
  baseVersion!: string;
}

export class ConfirmQueryDto {
  @IsString()
  @Length(1, 64)
  confirm!: string;
}
