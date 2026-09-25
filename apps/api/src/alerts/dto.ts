/**
 * alerts 요청 DTO. 전역 `ValidationPipe({ whitelist: true })`를 전제로 한다.
 *
 * **테스트 발송 DTO에는 웹훅 URL 필드가 없다** — 저장된 주소로만 보낸다.
 * whitelist가 켜져 있어 그런 이름을 보내도 제거된다(계약 2.7.2).
 * 저장은 `PATCH /api/alerts/settings`의 `discord.webhookUrl` 하나뿐이고,
 * **형식 검증은 DBA `checkWebhookUrl()`이 한다** — 여기서 정규식을 두지 않는다
 * (API가 별도 규칙을 가지면 저장 계층과 어긋난다).
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ALERT_AREAS, ALERT_KINDS, ALERT_SEVERITIES } from './alerts.types';

const RANGES = ['1h', '24h', '7d', '30d', 'all'] as const;

/** `a,b` → `['a','b']` (공통 목록 쿼리 규약) */
function csv(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && !Array.isArray(value)) return undefined;
  const raw = Array.isArray(value) ? value.map(String).join(',') : value;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function bool(value: unknown): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
}

export class AlertsQueryDto {
  @IsOptional()
  @IsIn(RANGES)
  range?: (typeof RANGES)[number];

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Transform(({ value }) => csv(value))
  @IsArray()
  @IsIn(ALERT_SEVERITIES, { each: true })
  severity?: string[];

  @IsOptional()
  @Transform(({ value }) => csv(value))
  @IsArray()
  @IsIn(ALERT_AREAS, { each: true })
  area?: string[];

  @IsOptional()
  @Transform(({ value }) => csv(value))
  @IsArray()
  key?: string[];

  @IsOptional()
  @Transform(({ value }) => csv(value))
  @IsArray()
  @IsIn(ALERT_KINDS, { each: true })
  kind?: string[];

  @IsOptional()
  @Transform(({ value }) => bool(value))
  @IsBoolean()
  includeResolved?: boolean;

  @IsOptional()
  @Transform(({ value }) => bool(value))
  @IsBoolean()
  unreadOnly?: boolean;

  /** 이력은 최대 2,000건까지 쌓이므로 **기본 100**이다 (공통 규약의 예외) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class AlertsReadDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids?: string[];

  @IsOptional()
  @IsBoolean()
  all?: boolean;
}

/**
 * `PATCH /api/alerts/settings` (계약 2.6). 부분 갱신 — **보낸 필드만 바뀐다.**
 *
 * `retention.*`과 `keys[].enabled`는 **받지 않는다.** whitelist가 지우므로
 * 보내도 조용히 무시되고 400이 되지 않는다 — 보관은 DBA 정리 작업 설정이고
 * 키별 켜기는 P3라 API 표면에 만들지 않는 편이 낫다(계약 2.6 표의 "변경 불가").
 */
export class AlertDiscordPatchDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * `null`이면 지우기. 문자열이면 저장.
   * **길이만 여기서 막고**(본문 폭주 방지) 형식은 `checkWebhookUrl()`이 판정한다.
   * 오류 응답에 **이 값을 싣지 않는다** (AC-ALERT21).
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookUrl?: string | null;

  @IsOptional()
  @IsIn(['critical', 'warning'])
  minSeverity?: 'critical' | 'warning';

  @IsOptional()
  @IsBoolean()
  sendUnknown?: boolean;
}

export class AlertRulesPatchDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  dedupeWindowMin?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  flapWindowMin?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  flapTransitions?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3600)
  warmupSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  unknownAfterMin?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  sourceSuppressAfterMin?: number;

  @IsOptional()
  @IsBoolean()
  notifyOnNewTarget?: boolean;

  /** P3의 자리만 둔다. 값을 넣어도 이번 범위에서는 동작하지 않는다 */
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  repeatEveryMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  minIntervalSec?: number;
}

export class AlertSettingsPatchDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AlertDiscordPatchDto)
  discord?: AlertDiscordPatchDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AlertRulesPatchDto)
  rules?: AlertRulesPatchDto;
}

/**
 * `POST /api/alerts/test` (계약 2.7.2).
 * **웹훅 URL을 받는 필드가 없다.** 저장 → 테스트 → (틀리면) 지우고 다시 저장.
 */
export class AlertTestDto {
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
