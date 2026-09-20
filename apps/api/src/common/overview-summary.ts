import { SetMetadata } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { StatusInfo } from './status';

/**
 * (선택) 개요 화면의 비용·어드바이저 요약 카드 제공자.
 * `GET /api/overview`의 `cost`·`advisor` 블록과 `nav.cost`·`nav.advisor`를 채운다
 * (docs/api/cluster-status.md 2.1). 제공자가 없으면 해당 블록은 `available: false` + unknown.
 *
 * - section 'cost'   → summary()가 aws-cost 2.1 요약 모양(`{ status, rate, monthToDate, budgetStatus, available }`)
 * - section 'advisor'→ summary()가 architecture-advisor A.2 요약 모양(`{ status, precheck, lastRun, bridge, busy, available }`)
 * 이 파일은 extension-points.ts(공유 인터페이스)에 없는 **추가** 확장점이다 (PM 요청 참고).
 */
export type OverviewSummarySection = 'cost' | 'advisor';

export interface OverviewSummaryProvider {
  readonly section: OverviewSummarySection;
  /** 이미 정리된 요약 객체. 최소한 `status: StatusInfo`, `available: boolean`을 포함 */
  summary(): Promise<{ status: StatusInfo; available: boolean } & object>;
  /** 요약이 바뀌면 알림 (선택) */
  readonly changes$?: Observable<void>;
  /** 어드바이저 분석 진행 중 (nav.advisorBusy) */
  busy?(): boolean;
}

export const OVERVIEW_SUMMARY_METADATA = 'sentinel:overview-summary-provider';
export const OverviewSummaryProviderDecorator = (): ClassDecorator =>
  SetMetadata(OVERVIEW_SUMMARY_METADATA, true);
