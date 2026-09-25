/**
 * 로그 스택 어댑터 소유 + 출처 상태 (docs/api/logs.md 8절, AC-LOG45).
 *
 * **자동 전환을 하지 않는다** (AC-LOG42): 스택이 죽어도 `activeSource`는 `stack`으로
 * 남고 `LOG_BACKEND_UNAVAILABLE` 안내만 붙는다. 전환은 **사용자 클릭**으로만 한다.
 * 조용히 직접 조회로 내려가면 "지난 로그가 안 보이는" 이유를 사용자가 알 수 없다.
 *
 * `not_configured`는 **오류가 아니다.** 로그 스택이 없는 것은 정상 상태다.
 */
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DATA_SOURCE_MODE } from '../../common/data-source';
import { SourceRegistry } from '../../common/source-registry.service';
import type { DataSourceMode } from '../../config/env.validation';
import { LogsOptions } from '../logs.options';
import type { LogScenario } from '../mock/mock-logs';
import { LokiAdapter } from './loki.adapter';
import { MockStackAdapter } from './mock-stack.adapter';
import { LogBackendError, type LogBackendPort } from './log-backend.port';

/** 확인 주기(초). 로그 화면을 보고 있을 때만 확인한다 */
const PING_INTERVAL_MS = 30_000;

export type BackendState = 'ok' | 'not_configured' | 'unavailable' | 'mock';

@Injectable()
export class LogBackendService implements OnModuleDestroy {
  private readonly logger = new Logger(LogBackendService.name);
  private readonly adapter: LogBackendPort | null;
  private state: BackendState;
  private lastError: LogBackendError | null = null;
  private lastPingAt = 0;
  private pinging = false;
  /** mock 시나리오를 읽기 위한 후크 (LogsService가 채운다) */
  private scenarioRef: () => LogScenario = () => 'direct';

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly options: LogsOptions,
    private readonly registry: SourceRegistry,
  ) {
    if (this.dataSource === 'mock') {
      // mock에서는 시나리오가 스택의 유무를 정한다 (AC-LOG48)
      this.adapter = new MockStackAdapter(
        () => this.scenarioRef(),
        () => this.scenarioRef() === 'stack-down',
      );
      this.state = 'mock';
    } else if (this.options.backend) {
      this.adapter = new LokiAdapter(this.options.backend);
      // 첫 확인 전에는 "확인 중"이 아니라 설정됨으로 두고, ping이 상태를 바꾼다
      this.state = 'ok';
    } else {
      this.adapter = null;
      this.state = 'not_configured';
    }
    this.publish();
  }

  onModuleDestroy(): void {
    // 타이머를 쓰지 않는다 (요청 때 필요하면 확인한다)
  }

  bindScenario(fn: () => LogScenario): void {
    this.scenarioRef = fn;
  }

  /** 지금 스택을 쓸 수 있는가. mock에서는 시나리오가 정한다 */
  get configured(): boolean {
    if (this.dataSource === 'mock') {
      const s = this.scenarioRef();
      return (
        s === 'stack' ||
        s === 'stack-down' ||
        s === 'stack-auth-failed' ||
        s === 'stack-rejected'
      );
    }
    return this.options.backend !== null;
  }

  get port(): LogBackendPort | null {
    return this.configured ? this.adapter : null;
  }

  get productLabel(): string | null {
    return this.configured ? (this.adapter?.productLabel ?? null) : null;
  }

  get retentionHours(): number | null {
    return this.configured ? (this.adapter?.retentionHours ?? null) : null;
  }

  get maxRangeHours(): number {
    return this.adapter?.maxRangeHours ?? 168;
  }

  currentState(): BackendState {
    if (!this.configured) return 'not_configured';
    if (this.dataSource === 'mock') {
      const s = this.scenarioRef();
      // 연결·인증 실패는 출처가 쓸 수 없는 상태다. 쿼리 거부는 연결이 살아 있다
      return s === 'stack-down' || s === 'stack-auth-failed'
        ? 'unavailable'
        : 'mock';
    }
    return this.state;
  }

  get error(): { code: string; message: string } | null {
    if (!this.configured) return null;
    if (this.adapter instanceof MockStackAdapter) {
      // mock은 시나리오가 연결 상태를 정한다 — live의 ping 결과와 같은 모양(연결 실패·인증 실패)을 준다.
      // 지난 시나리오의 실패가 남지 않게 lastError를 쓰지 않는다
      const f = this.adapter.connectionFailure();
      return f ? { code: f.code, message: f.message } : null;
    }
    if (!this.lastError) return null;
    // **토큰·URL이 들어가지 않는다** (어댑터가 이미 걸렀다)
    return { code: this.lastError.code, message: this.lastError.message };
  }

  /** 로그 화면이 열릴 때 호출된다. 30초 안에 이미 확인했으면 건너뛴다 */
  async ensureChecked(): Promise<void> {
    if (!this.configured || this.dataSource === 'mock') {
      this.publish();
      return;
    }
    if (this.pinging || Date.now() - this.lastPingAt < PING_INTERVAL_MS) return;
    this.pinging = true;
    try {
      await this.adapter!.ping();
      this.state = 'ok';
      this.lastError = null;
      this.registry.markSuccess('logBackend');
    } catch (err) {
      this.state = 'unavailable';
      this.lastError =
        err instanceof LogBackendError
          ? err
          : new LogBackendError(
              'LOG_BACKEND_UNAVAILABLE',
              '로그 스택에 연결하지 못했습니다.',
            );
      this.registry.markFailure(
        'logBackend',
        { code: this.lastError.code, message: this.lastError.message },
        { state: 'unavailable' },
      );
    } finally {
      this.lastPingAt = Date.now();
      this.pinging = false;
      this.publish();
    }
  }

  /** 조회·스트림이 실패하면 출처 상태에 즉시 반영한다 */
  reportFailure(err: LogBackendError): void {
    if (err.code === 'LOG_BACKEND_QUERY_REJECTED') return; // 연결은 살아 있다
    this.state = 'unavailable';
    this.lastError = err;
    this.registry.markFailure(
      'logBackend',
      { code: err.code, message: err.message },
      { state: 'unavailable' },
    );
  }

  reportSuccess(): void {
    if (this.dataSource === 'mock') return;
    if (this.state !== 'ok') {
      this.state = 'ok';
      this.lastError = null;
      this.registry.markSuccess('logBackend');
    }
  }

  private publish(): void {
    const state = this.currentState();
    this.registry.update('logBackend', {
      // `not_configured`를 `degraded`로 치지 않는다 — 스택이 없는 것은 정상이다
      state: state === 'unavailable' ? 'unavailable' : state,
      error: this.error,
    });
  }
}
