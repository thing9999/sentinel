import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { CATEGORIES, SEVERITIES } from '../advisor.types';

/** 'true'/'false' 문자열만 boolean으로 (그 외 값은 그대로 두어 IsBoolean에서 400) */
const toBool = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

/** 쉼표 구분 여러 값 → 배열 */
const toList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  const parts = (Array.isArray(value) ? value : [value])
    .flatMap((v) => String(v).split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return parts;
};

export class IncludeSystemQueryDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeSystem?: boolean;
}

export class PrecheckQueryDto extends IncludeSystemQueryDto {
  @IsOptional()
  @Transform(toList)
  @ArrayNotEmpty()
  @IsIn(CATEGORIES, { each: true })
  category?: string[];

  @IsOptional()
  @Transform(toList)
  @ArrayNotEmpty()
  @IsIn(SEVERITIES, { each: true })
  severity?: string[];

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  held?: boolean;
}

export class StartRunDto {
  @IsOptional()
  @IsBoolean()
  includeSystem?: boolean;
}

export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export class RunListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Transform(toList)
  @ArrayNotEmpty()
  @IsIn(RUN_STATUSES, { each: true })
  status?: string[];
}
