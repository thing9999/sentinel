import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  Validate,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  CsvList,
  PageQueryDto,
  QueryBoolean,
  SortSpecConstraint,
} from '../common/list-query';
import { STATUS_VALUES, type Status } from '../common/status';
import { WORKLOAD_KINDS, type WorkloadKind } from './model';

const REF_RE = /^[A-Za-z]+\/[a-z0-9.-]*\/[A-Za-z0-9._:-]+$/;

export const NODE_SORT = [
  'status',
  'name',
  'cpuPct',
  'memoryPct',
  'podsPct',
  'createdAt',
] as const;
export const WORKLOAD_SORT = [
  'status',
  'namespace',
  'name',
  'kind',
  'lastRolloutAt',
] as const;
export const POD_SORT = [
  'status',
  'restarts1h',
  'restartsTotal',
  'namespace',
  'name',
  'cpu',
  'memory',
  'memoryLimitPct',
  'startedAt',
] as const;
export const EVENT_SORT = ['lastSeenAt', 'count', 'namespace'] as const;
export const PVC_SORT = [
  'status',
  'namespace',
  'name',
  'usagePct',
  'capacity',
] as const;

export class NodesQueryDto extends PageQueryDto {
  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(STATUS_VALUES, { each: true })
  status?: Status[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  nodeGroup?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  zone?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(['on_demand', 'spot'], { each: true })
  capacityType?: ('on_demand' | 'spot')[];

  @IsOptional()
  @IsString()
  @Length(1, 253)
  q?: string;

  @IsOptional()
  @Validate(SortSpecConstraint, [NODE_SORT])
  sort?: string;
}

export class WorkloadsQueryDto extends PageQueryDto {
  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(STATUS_VALUES, { each: true })
  status?: Status[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(WORKLOAD_KINDS, { each: true })
  kind?: WorkloadKind[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  namespace?: string[];

  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  hideSystem?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 253)
  q?: string;

  @IsOptional()
  @Validate(SortSpecConstraint, [WORKLOAD_SORT])
  sort?: string;
}

export class PodsQueryDto extends PageQueryDto {
  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(STATUS_VALUES, { each: true })
  status?: Status[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  namespace?: string[];

  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  hideSystem?: boolean;

  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  showCompleted?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 253)
  node?: string;

  @IsOptional()
  @Matches(/^(Deployment|StatefulSet|DaemonSet)\/[a-z0-9.-]+\/[a-z0-9.-]+$/, {
    message: 'workload must be kind/namespace/name',
  })
  workload?: string;

  @IsOptional()
  @IsString()
  @Length(1, 253)
  q?: string;

  @IsOptional()
  @Validate(SortSpecConstraint, [POD_SORT])
  sort?: string;
}

export class EventsQueryDto extends PageQueryDto {
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  severeOnly?: boolean;

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  namespace?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  kind?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  reason?: string[];

  @IsOptional()
  @Matches(REF_RE, { message: 'target must be kind/namespace/name' })
  target?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(60)
  @Max(3600)
  sinceSec?: number;

  @IsOptional()
  @IsString()
  @Length(1, 253)
  q?: string;

  @IsOptional()
  @Validate(SortSpecConstraint, [EVENT_SORT])
  sort?: string;
}

export class PvcsQueryDto extends PageQueryDto {
  @IsOptional()
  @CsvList()
  @IsArray()
  @IsString({ each: true })
  namespace?: string[];

  @IsOptional()
  @CsvList()
  @IsArray()
  @IsIn(STATUS_VALUES, { each: true })
  status?: Status[];

  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  dbOnly?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 253)
  q?: string;

  @IsOptional()
  @Validate(SortSpecConstraint, [PVC_SORT])
  sort?: string;
}

export class AttentionQueryDto extends PageQueryDto {}

export class SeriesQueryDto {
  @IsIn(['cluster', 'node', 'pod'])
  target!: 'cluster' | 'node' | 'pod';

  @IsOptional()
  @IsString()
  @Length(1, 253)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 63)
  namespace?: string;

  @IsOptional()
  @IsIn(['1h', '6h', '24h'])
  range?: '1h' | '6h' | '24h';
}

export class WorkloadParamsDto {
  @IsIn(WORKLOAD_KINDS)
  kind!: WorkloadKind;

  @IsString()
  @Length(1, 63)
  namespace!: string;

  @IsString()
  @Length(1, 253)
  name!: string;
}
