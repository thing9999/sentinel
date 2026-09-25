/**
 * logs 요청 DTO. 전역 `ValidationPipe({ whitelist: true })`를 전제로 한다.
 *
 * **가림을 끄는 필드가 없다** (P2, AC-LOG09). 그런 이름을 보내도 whitelist가 지운다.
 * 검색어·셀렉터는 **본문으로만** 받는다 — URL에 넣으면 프록시 접근 로그·브라우저 이력에 남는다.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const NS_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const NAME_RE = /^[a-z0-9]([-.a-z0-9]*[a-z0-9])?$/;

export class LogWorkloadDto {
  @IsIn(['Deployment', 'StatefulSet', 'DaemonSet'])
  kind!: 'Deployment' | 'StatefulSet' | 'DaemonSet';

  @Matches(NAME_RE)
  name!: string;
}

export class LogSelectorDto {
  @Matches(NS_RE, { message: 'namespace는 쿠버네티스 이름 형식이어야 합니다' })
  namespace!: string;

  @IsOptional()
  @Matches(NAME_RE, { message: 'pod는 쿠버네티스 이름 형식이어야 합니다' })
  pod?: string;

  /** stack 합쳐보기. **최대 20** (계약 1.4) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(NAME_RE, { each: true })
  pods?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LogWorkloadDto)
  workload?: LogWorkloadDto;

  @IsOptional()
  @Matches(NAME_RE, {
    message: 'container는 쿠버네티스 이름 형식이어야 합니다',
  })
  container?: string;

  /** direct 전용. 직전 1세대 */
  @IsOptional()
  @IsBoolean()
  previous?: boolean;
}

export class LogRangeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  sinceSec?: number;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  /** direct의 `현재 파일 전체` */
  @IsOptional()
  @IsBoolean()
  whole?: boolean;
}

export class LogSearchDto {
  @IsString()
  @MaxLength(200)
  text!: string;

  @IsOptional()
  @IsBoolean()
  caseSensitive?: boolean;
}

export class LogQueryDto {
  @IsOptional()
  @IsIn(['direct', 'stack'])
  source?: 'direct' | 'stack';

  @ValidateNested()
  @Type(() => LogSelectorDto)
  selector!: LogSelectorDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LogRangeDto)
  range?: LogRangeDto;

  /** 상한을 넘으면 400이 아니라 상한으로 자른다 (AC-LOG14). 여기서는 하한만 본다 */
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => LogSearchDto)
  search?: LogSearchDto | null;

  /**
   * 그 시각으로 열기 (알림·이벤트 링크의 `at`, 계약 2.2.1). **정지 조회 전용** —
   * 스트림(`POST /api/logs/streams`)에 보내면 400이다(따라가기와 함께 쓰지 않는다, PM 결정 D3)
   */
  @IsOptional()
  @IsISO8601()
  anchorAt?: string;
}
