/**
 * cost 요청 DTO (class-validator). 전역 ValidationPipe({ whitelist: true, transform: true }) 전제.
 * 계약 aws-cost 3.2·3.3·6.2.
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmpty,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** 초과(>) 검사 — class-validator Min은 이상(≥)이라 따로 둔다 */
function GreaterThan(bound: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'greaterThan',
      target: object.constructor,
      propertyName,
      constraints: [bound],
      options: {
        message: `${propertyName} must be greater than ${bound}`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'number' && value > bound,
      },
    });
  };
}

const toBool = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

// ---------------------------------------------------------------------------
// 조회 쿼리
// ---------------------------------------------------------------------------

export class AllocationQueryDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean({ message: 'hideSystem must be true or false' })
  hideSystem?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^(usdPerHour|namespace|sharePct):(asc|desc)$/, {
    message:
      'sort must be one of: usdPerHour|namespace|sharePct with :asc|:desc',
  })
  sort?: string;
}

export const RATE_RANGES = ['24h', '7d', '30d', '90d'] as const;
export type RateRange = (typeof RATE_RANGES)[number];

export class RateSeriesQueryDto {
  @IsOptional()
  @IsIn(RATE_RANGES, { message: 'range must be one of: 24h, 7d, 30d, 90d' })
  range?: RateRange;
}

// ---------------------------------------------------------------------------
// PATCH /api/cost/settings
// ---------------------------------------------------------------------------

export class BudgetPatchDto {
  /** null = 예산 숨김 */
  @ValidateIf(
    (o: BudgetPatchDto) =>
      o.monthlyBudgetUsd !== null && o.monthlyBudgetUsd !== undefined,
  )
  @IsNumber()
  @GreaterThan(0)
  @Max(10_000_000)
  monthlyBudgetUsd?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  warnPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1000)
  overPct?: number;
}

export class RateSpikePatchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  baselineDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  minBaselineHours?: number;

  @IsOptional()
  @IsNumber()
  @GreaterThan(1)
  @Max(100)
  warnRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  warnAbsUsdPerHour?: number;

  @IsOptional()
  @IsNumber()
  @GreaterThan(1)
  @Max(100)
  critRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  critAbsUsdPerHour?: number;
}

export class DailySpikePatchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  baselineDays?: number;

  @IsOptional()
  @IsNumber()
  @GreaterThan(1)
  @Max(100)
  warnRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  warnAbsUsd?: number;

  @IsOptional()
  @IsNumber()
  @GreaterThan(1)
  @Max(100)
  critRatio?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  critAbsUsd?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000)
  serviceWarnAbsUsd?: number;
}

export class SpikePatchDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => RateSpikePatchDto)
  rate?: RateSpikePatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DailySpikePatchDto)
  daily?: DailySpikePatchDto;
}

export class TagFilterDto {
  @IsString()
  @Length(1, 128)
  key!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 256, { each: true })
  values!: string[];
}

export class ExplorerPatchDto {
  @IsOptional()
  @IsIn(['UnblendedCost', 'AmortizedCost'])
  metric?: 'UnblendedCost' | 'AmortizedCost';

  /** 1시간 미만 불가 (호출 비용 보호) */
  @IsOptional()
  @IsInt()
  @Min(3600)
  @Max(86400)
  cacheTtlSec?: number;

  @IsOptional()
  @IsInt()
  @Min(3600)
  @Max(86400)
  manualRefreshCooldownSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  dailyCallLimit?: number;

  /** null = 필터 해제 (계정 전체) */
  @ValidateIf(
    (o: ExplorerPatchDto) =>
      o.costAllocationTagFilter !== null &&
      o.costAllocationTagFilter !== undefined,
  )
  @ValidateNested()
  @Type(() => TagFilterDto)
  costAllocationTagFilter?: TagFilterDto | null;

  /** 변경 불가 — 요청에 있으면 400 */
  @IsEmpty({ message: 'callCostUsd는 변경할 수 없습니다' })
  callCostUsd?: unknown;
}

export class CostSettingsPatchDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetPatchDto)
  budget?: BudgetPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SpikePatchDto)
  spike?: SpikePatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExplorerPatchDto)
  explorer?: ExplorerPatchDto;
}
