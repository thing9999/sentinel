import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { validationFailed } from './api-error';

/** 쉼표 구분 쿼리 값 → 문자열 배열 (빈 값 제거) */
export const CsvList = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value)
      ? value.map((v) => String(v)).join(',')
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
    const items = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return items.length > 0 ? items : undefined;
  });

/** 쿼리 boolean은 'true'/'false' 문자열만 허용 (그 밖의 값은 그대로 두어 IsBoolean이 거부) */
export const QueryBoolean = (): PropertyDecorator =>
  Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const v = obj[key];
    if (v === undefined || v === null || v === '') return undefined;
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    return v;
  });

/** `field:asc|desc` 형식이고 field가 허용 목록에 있어야 한다 */
@ValidatorConstraint({ name: 'sortSpec', async: false })
export class SortSpecConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    const allowed = args.constraints[0] as readonly string[];
    const m = /^([A-Za-z0-9]+):(asc|desc)$/.exec(value);
    return m !== null && allowed.includes(m[1]);
  }
  defaultMessage(args: ValidationArguments): string {
    const allowed = args.constraints[0] as readonly string[];
    return `sort must be <field>:<asc|desc>, field one of: ${allowed.join(', ')}`;
  }
}

export class PageQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  offset?: number;
}

export interface ListMeta {
  total: number;
  filteredTotal: number;
  offset: number;
  limit: number | null;
}

export interface SortSpec {
  field: string;
  dir: 'asc' | 'desc';
}

export function parseSort(sort: string | undefined): SortSpec | null {
  if (!sort) return null;
  const [field, dir] = sort.split(':');
  return { field, dir: dir === 'desc' ? 'desc' : 'asc' };
}

/** 필터 후 목록에 offset/limit 적용 */
export function paginate<T>(
  all: number,
  filtered: T[],
  q: { limit?: number; offset?: number },
): { meta: ListMeta; items: T[] } {
  const offset = q.offset ?? 0;
  const limit = q.limit ?? null;
  const items =
    limit === null
      ? filtered.slice(offset)
      : filtered.slice(offset, offset + limit);
  return {
    meta: { total: all, filteredTotal: filtered.length, offset, limit },
    items,
  };
}

export type Comparator<T> = (a: T, b: T) => number;

export function cmpStr(a: string | null, b: string | null): number {
  return (a ?? '').localeCompare(b ?? '');
}

/** null은 방향과 무관하게 마지막 */
export function cmpNum(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 'asc' | 'desc',
): number {
  const an = a ?? null;
  const bn = b ?? null;
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  return dir === 'asc' ? an - bn : bn - an;
}

export function chain<T>(...cmps: Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const c of cmps) {
      const r = c(a, b);
      if (r !== 0) return r;
    }
    return 0;
  };
}

/** `kind/namespace/name` (클러스터 범위는 `Node//name`) */
export function parseRefParam(
  field: string,
  value: string | undefined,
): { kind: string; namespace: string | null; name: string } | undefined {
  if (value === undefined) return undefined;
  const parts = value.split('/');
  if (parts.length !== 3 || !parts[0] || !parts[2]) {
    throw validationFailed([
      {
        field,
        value,
        constraints: [`${field} must be kind/namespace/name`],
      },
    ]);
  }
  return { kind: parts[0], namespace: parts[1] || null, name: parts[2] };
}
