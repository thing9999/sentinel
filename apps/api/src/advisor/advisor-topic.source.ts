import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import {
  TopicSourceProvider,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import { AdvisorEvents } from './advisor-events';
import { AdvisorService } from './advisor.service';

/**
 * SSE 토픽 `advisor` (계약 A.8): 연결 직후 advisor.snapshot, 이후
 * advisor.bridge.updated / advisor.precheck.updated / advisor.run.progress / advisor.run.finished
 */
@Injectable()
@TopicSourceProvider()
export class AdvisorTopicSource implements TopicSource {
  readonly topic = 'advisor';

  constructor(
    private readonly events: AdvisorEvents,
    private readonly advisor: AdvisorService,
  ) {}

  get events$(): Observable<TopicEvent> {
    return this.events.events$;
  }

  async snapshot(): Promise<TopicEvent[]> {
    this.advisor.touch();
    return [{ event: 'advisor.snapshot', data: await this.advisor.overview() }];
  }

  /** 시나리오 변경 등으로 전체 상태를 다시 보낼 때 */
  async republish(): Promise<void> {
    this.events.emit('advisor.snapshot', await this.advisor.overview());
  }
}
