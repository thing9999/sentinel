/**
 * 로그 링크를 줄 수 있는지 정하는 **실효 설정** (docs/api/logs.md 11.4).
 *
 * 규칙(함수)은 `logs/log-href.ts` 한 곳에 있고, 여기는 그 규칙에 넣을 **값**만 든다.
 * 값을 한 곳에 두는 이유: `cluster`(평가 단계에서 `PodItem.logHref` 등)와 `logs`(알림 링크·로그 API)가
 * 같은 값을 봐야 한다. 두 모듈이 env를 각자 읽으면 mock `logs=disabled`처럼 **실행 중 바뀌는 값**을
 * 한쪽만 알게 된다 — 그러면 로그 화면은 403인데 매트릭스에는 링크가 남는다.
 *
 * 전역 모듈(`CommonModule`)이 제공한다. `LogsModule → ClusterModule` 의존 방향을 건드리지 않는다.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import type { LogLinkPolicyValue } from '../logs/log-href';
import { DATA_SOURCE_MODE } from './data-source';

@Injectable()
export class LogLinkPolicy {
  /** env `LOGS_ENABLED` */
  readonly envEnabled: boolean;
  /** env `LOG_DENY_NAMESPACES` */
  readonly denyNamespaces: readonly string[];
  private mockDisabled = false;
  private readonly changesSubject = new Subject<void>();
  /** 실효 값이 바뀌었을 때 (mock `logs=disabled` 전환). 클러스터 평가가 링크를 다시 만든다 */
  readonly changes$: Observable<void> = this.changesSubject.asObservable();

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.envEnabled = config.get('LOGS_ENABLED', { infer: true });
    this.denyNamespaces = (
      config.get('LOG_DENY_NAMESPACES', { infer: true }) ?? ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** `LOGS_ENABLED`이고 mock `logs=disabled`가 아닌가 */
  get enabled(): boolean {
    return this.envEnabled && !this.mockDisabled;
  }

  value(): LogLinkPolicyValue {
    return { enabled: this.enabled, denyNamespaces: this.denyNamespaces };
  }

  /** mock 전용: `logs=disabled` 시나리오. live에서는 아무 일도 하지 않는다 */
  setMockDisabled(disabled: boolean): void {
    if (this.dataSource !== 'mock') return;
    if (this.mockDisabled === disabled) return;
    this.mockDisabled = disabled;
    this.changesSubject.next();
  }
}
