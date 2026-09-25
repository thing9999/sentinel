/**
 * alerts 모듈이 다른 모듈에 제공하는 확장점.
 * - StreamModule: TopicSource `alerts` (**기존 토픽 체계에 1개 추가**, 새 스트림 없음)
 * - mock 시나리오 API: group `alerts`
 *
 * **어드바이저 스냅샷 기여자를 만들지 않는다** (계약 0.4): 알림 본문에는 리소스 이름이
 * 원문 그대로 들어가는데 어드바이저 스냅샷은 노드 이름을 가명 처리하게 돼 있다.
 * 알림 이력이 스냅샷에 섞이면 **그 가명 규칙이 통째로 우회된다.**
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { DATA_SOURCE_MODE } from '../common/data-source';
import type { DataSourceMode } from '../config/env.validation';
import {
  MockScenarioTargetProvider,
  TopicSourceProvider,
  type MockScenarioTarget,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import { AlertDispatcher } from './alert-dispatcher.service';
import { AlertEngine } from './alert-engine.service';
import { AlertStore } from './alert-store.service';
import { AlertsService } from './alerts.service';
import {
  ALERT_SCENARIOS,
  ALERT_SCENARIO_OPTIONS,
  mockAlertRecords,
  mockBurstRecord,
  mockRestartGap,
  type AlertScenario,
} from './mock/mock-alerts';

@Injectable()
@TopicSourceProvider()
export class AlertsTopicSource implements TopicSource, OnApplicationBootstrap {
  readonly topic = 'alerts';
  private readonly subject = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.subject.asObservable();

  constructor(
    private readonly alerts: AlertsService,
    private readonly engine: AlertEngine,
    private readonly dispatcher: AlertDispatcher,
    private readonly store: AlertStore,
  ) {}

  onApplicationBootstrap(): void {
    this.alerts.readEvents$.subscribe((e) => {
      this.subject.next({ event: 'alerts.read', data: e });
    });
    // 발송 상태가 바뀌면 같은 알림을 `alerts.updated`로 다시 보낸다
    // (화면의 발송 칩이 `보냄`·`실패`·`대기 중`으로 바뀐다)
    this.dispatcher.changes$.subscribe((alertId) => {
      void this.store.byId(alertId).then(async (rec) => {
        if (!rec) return;
        this.subject.next({
          event: 'alerts.updated',
          data: await this.alerts.eventPayload(rec),
        });
      });
    });
    this.engine.events$.subscribe((e) => {
      void this.alerts.eventPayload(e.record).then((payload) => {
        this.subject.next({
          event: e.kind === 'created' ? 'alerts.created' : 'alerts.updated',
          data: payload,
        });
      });
    });
  }

  /** 확인 처리·시나리오 전환처럼 알림 1건이 아닌 변화 */
  emit(event: string, data: unknown): void {
    this.subject.next({ event, data });
  }

  async snapshot(): Promise<TopicEvent[]> {
    return [
      { event: 'alerts.snapshot', data: await this.alerts.snapshotPayload() },
    ];
  }
}

@Injectable()
@MockScenarioTargetProvider()
export class AlertsMockScenarioTarget
  implements MockScenarioTarget, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AlertsMockScenarioTarget.name);
  readonly group = 'alerts' as const;
  readonly scenarios: readonly string[] = ALERT_SCENARIOS;
  readonly options = ALERT_SCENARIO_OPTIONS;
  readonly defaultScenario = 'default';
  private scenario: AlertScenario = 'default';
  private burstTimer: NodeJS.Timeout | null = null;
  private burstN = 0;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly store: AlertStore,
    private readonly engine: AlertEngine,
    private readonly topic: AlertsTopicSource,
    private readonly alerts: AlertsService,
  ) {}

  /**
   * mock 모드에서 기본 시나리오의 **미리 쌓인 이력**을 넣는다.
   * live에서는 아무것도 하지 않는다 — mock 알림이 live 이력에 섞이면 안 된다(명세 3.7 A).
   */
  onApplicationBootstrap(): void {
    if (this.dataSource !== 'mock') return;
    this.setScenario(this.defaultScenario);
  }

  onModuleDestroy(): void {
    this.stopBurst();
  }

  currentScenario(): string {
    return this.scenario;
  }

  setScenario(name: string): void {
    this.scenario = name as AlertScenario;
    this.stopBurst();
    // 디자인 3.6 둘째 줄을 mock에서 보이게 하는 **표시 전용** 서킷 (설정 응답에만. 발송 경로와 무관)
    this.alerts.setMockCircuitDisplay(this.scenario === 'webhook-failed');
    // **`data_source='mock'` 행만** 지운다 (live 이력을 건드리지 않는다)
    void this.store
      .seedMock(mockAlertRecords(this.scenario))
      .then(async () => {
        this.engine.resetStates();
        this.engine.setGaps(
          this.scenario === 'restart'
            ? [...this.engine.bootstrapGaps, mockRestartGap()]
            : this.engine.bootstrapGaps,
        );
        this.topic.emit('alerts.snapshot', await this.alerts.snapshotPayload());
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `mock 알림 시나리오 적용 실패: ${err instanceof Error ? err.name : 'error'}`,
        ),
      );
    if (this.scenario === 'burst') this.startBurst();
  }

  /** `POST /api/mock/reset` — 예시 이력·읽음 상태를 처음 상태로 */
  resetData(): void {
    this.burstN = 0;
    this.setScenario('default');
  }

  /** 3초마다 1건 추가 → 배지 숫자가 올라가는 것을 눈으로 확인 */
  private startBurst(): void {
    this.burstTimer = setInterval(() => {
      this.burstN += 1;
      const rec = mockBurstRecord(this.burstN);
      void this.store.seedAppend(rec).then(async () => {
        this.topic.emit('alerts.created', await this.alerts.eventPayload(rec));
      });
    }, 3000);
    this.burstTimer.unref();
  }

  private stopBurst(): void {
    if (this.burstTimer) clearInterval(this.burstTimer);
    this.burstTimer = null;
  }
}
