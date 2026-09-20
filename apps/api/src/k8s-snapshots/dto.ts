import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Validate,
} from 'class-validator';
import {
  CsvList,
  PageQueryDto,
  SortSpecConstraint,
} from '../common/list-query';
import { STATUS_VALUES } from '../common/status';
import { CONFIRM_VALUES, LABEL_MAX, MEMO_MAX } from './k8s.constants';

export class K8sSnapshotListQueryDto extends PageQueryDto {
  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(STATUS_VALUES, { each: true })
  status?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(['ok', 'warning', 'unknown', 'not_computed'], { each: true })
  drift?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(['same', 'other', 'unknown'], { each: true })
  cluster?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @Validate(SortSpecConstraint, [['snapshotAt', 'status']])
  sort?: string;
}

/**
 * 파일 지정 (계약 1.1). 형식 검사는 서비스가 lib 경로 규칙으로 한다(값은 오류에 넣지 않음).
 * 여기서는 문자열·길이만.
 */
export class K8sFileQueryDto {
  @IsString()
  @Length(1, 600)
  path!: string;
}

const VERSION_RE = /^sha256:[0-9a-f]{64}$/;

export class K8sFileContentDto {
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

export class K8sFileSaveDto extends K8sFileContentDto {
  @IsString()
  @Matches(VERSION_RE, { message: 'baseVersion must be sha256:<64 hex>' })
  declare baseVersion: string;
}

// eslint-disable-next-line no-control-regex
const LABEL_RE = /^[^\u0000-\u001f\u007f]*$/;
// eslint-disable-next-line no-control-regex
const MEMO_RE = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

export class K8sNotesDto {
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

export class K8sConfirmQueryDto {
  @IsString()
  @Length(1, 64)
  confirm!: string;
}

export class DriftRequestDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/** 3D 구성 그래프 (docs/api/snapshot-3d.md 2.1). 화면 필터(g*)는 서버로 오지 않는다 */
export class K8sGraphQueryDto {
  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8', 'K9', 'K10', 'K11'], {
    each: true,
  })
  rules?: string[];

  @IsOptional()
  @IsIn(['on', 'off'])
  drift?: string;
}
