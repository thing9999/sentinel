import { SetMetadata } from '@nestjs/common';
import type { Observable } from 'rxjs';

/** SSE 이벤트 하나 (docs/api/common.md 규약) */
export interface TopicEvent {
  event: string;
  data: unknown;
}

/** 단일 스트림(/api/stream)에 토픽을 제공하는 provider. StreamModule이 DiscoveryService로 찾는다. */
export interface TopicSource {
  readonly topic: string;
  /** 연결 직후 보낼 *.snapshot 이벤트들 */
  snapshot(): Promise<TopicEvent[]>;
  /** 이후 변경 이벤트 */
  readonly events$: Observable<TopicEvent>;
}
export const TOPIC_SOURCE_METADATA = 'sentinel:topic-source';
export const TopicSourceProvider = (): ClassDecorator =>
  SetMetadata(TOPIC_SOURCE_METADATA, true);

/** mock 시나리오 전환 대상 (POST /api/mock/... — common 계약) */
export type MockScenarioGroup =
  | 'cluster'
  | 'db'
  | 'cost'
  | 'advisor'
  | 'snapshots'
  | 'k8s-snapshots'
  | 'alerts'
  | 'logs';
export interface MockScenarioTarget {
  readonly group: MockScenarioGroup;
  readonly scenarios: readonly string[];
  currentScenario(): string;
  /** 알 수 없는 이름이면 예외. HttpException을 던지면 그대로 응답된다 (예: 409 RUN_ACTIVE) */
  setScenario(name: string): void;
  /** (선택) 메뉴 이름·설명. 없으면 공통 기본 문구 → 시나리오 id (common.md 6.1 `options`) */
  readonly options?: readonly {
    id: string;
    label: string;
    description?: string;
  }[];
  /** (선택) `POST /api/mock/reset`이 돌아갈 시나리오. 없으면 그룹 기본값 → scenarios[0] */
  readonly defaultScenario?: string;
  /** (선택, advisor) 지연·시간 초과를 짧게 줄이는 mock 옵션의 현재 값. getter로 구현해도 된다 */
  readonly fastTimers?: boolean;
  /** (선택, advisor) `PUT /api/mock/scenarios/:group` 본문 `fastTimers`를 적용 */
  setFastTimers?(value: boolean): void;
  /** (선택) `POST /api/mock/reset` 때 시나리오 외 mock 데이터(편집 내용 등)를 처음 상태로 */
  resetData?(): void;
}
export const MOCK_SCENARIO_METADATA = 'sentinel:mock-scenario-target';
export const MockScenarioTargetProvider = (): ClassDecorator =>
  SetMetadata(MOCK_SCENARIO_METADATA, true);

/** 어드바이저 스냅샷 한 부분을 제공 (이미 정제된 값만 — docs/api/architecture-advisor.md 스냅샷 스키마) */
export type AdvisorSnapshotSection = 'cluster' | 'db' | 'cost';
export interface AdvisorSnapshotContributor {
  readonly section: AdvisorSnapshotSection;
  contribute(): Promise<unknown>;
}
export const ADVISOR_SNAPSHOT_METADATA =
  'sentinel:advisor-snapshot-contributor';
export const AdvisorSnapshotContributorProvider = (): ClassDecorator =>
  SetMetadata(ADVISOR_SNAPSHOT_METADATA, true);
