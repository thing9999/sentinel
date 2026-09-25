/**
 * 디스코드 발송기 (docs/api/alerts.md 3절). **밖으로 나가는 유일한 층(③)이다.**
 *
 * 안전장치가 여기 모여 있다:
 * - `ALERTS_DISPATCH=mock`(기본)이면 **판정 단계에서 끝난다** — `DiscordSenderPort`가
 *   한 번도 불리지 않는다(AC-ALERT26). 테스트가 그 호출 수를 직접 센다.
 * - 도메인 제한은 저장(`checkWebhookUrl`)과 발송(`HttpDiscordSender`) **두 곳**에서 건다.
 * - 4xx/5xx/타임아웃은 백오프 3회 후 `failed`, 429는 `Retry-After`를 지켜 큐에 남긴다.
 * - 연속 실패가 기준을 넘으면 1시간 발송 정지 → `skipped_circuit_open`.
 * - 실패 사유는 **가림 처리된 한 줄**이다. 웹훅 URL·토큰·요청 본문을 담지 않는다.
 *
 * **알림 자체는 발송 결과와 무관하게 화면에 남는다** (AC-ALERT30).
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { ClusterStateService } from '../cluster/state/cluster-state.service';
import { loadWebhookUrlForDispatch } from '../database/secret-settings';
import { PrismaService } from '../database/prisma.service';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import { AlertSettingsService } from './alert-settings.service';
import { AlertStore } from './alert-store.service';
import { buildMessage, presentItem } from './alert-presenter';
import {
  DISCORD_SENDER,
  HttpDiscordSender,
  safeDetail,
  type DiscordSenderPort,
} from './discord-sender';
import {
  decideDispatch,
  nextAttemptDelaySec,
  retryAfterSec,
  type DispatchContext,
} from './dispatch-rules';
import type { AlertRecord, DispatchState } from './alerts.types';

const QUEUE_TICK_MS = 2000;

export interface CircuitState {
  open: boolean;
  consecutiveFailures: number;
  openedAt: string | null;
  resumeAt: string | null;
}

@Injectable()
export class AlertDispatcher
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AlertDispatcher.name);
  private readonly sender: DiscordSenderPort;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastSentAt = 0;
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;
  private circuitResumeAt: number | null = null;
  /**
   * 마지막으로 **실제로 밖으로 나간** 시도의 결과 (계약 2.5 `discord.lastDispatch`, PM 결정 2026-09-25).
   * - `sent`·`failed` 두 값뿐이다. 재시도가 남은 실패·429도 **그 시도는 실패**라 `failed`로 적는다
   *   (배달 기록의 `pending`과는 다른 축이다 — 배달은 아직 끝나지 않았지만 이 시도는 실패했다)
   * - 테스트 발송도 포함한다
   * - `skipped_*`(mock·미설정·꺼짐·서킷·플래핑…)는 나간 적이 없으므로 **기록하지 않는다** → mock에서는 null
   * - 메모리 값이다. 재시작하면 null로 돌아간다
   */
  private lastDispatch: {
    at: string;
    state: 'sent' | 'failed';
    responseCode: number | null;
    detail: string | null;
  } | null = null;
  private testCooldownUntil = 0;
  private readonly changes = new Subject<string>();
  /** 발송 상태가 바뀐 알림 id (토픽 제공자가 `alerts.updated`로 내보낸다) */
  readonly changes$: Observable<string> = this.changes.asObservable();

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly store: AlertStore,
    private readonly settings: AlertSettingsService,
    private readonly cluster: ClusterStateService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Optional() @Inject(DISCORD_SENDER) injected?: DiscordSenderPort,
  ) {
    this.sender = injected ?? new HttpDiscordSender();
  }

  onApplicationBootstrap(): void {
    void this.store
      .markPendingAsRestart(this.dataSource)
      .then((n) => {
        if (n > 0) {
          // 자동 재발송하지 않는다 — 오래된 알림이 뒤늦게 채널에 뜨는 것을 막는다
          this.logger.log(`발송 대기 ${n}건을 skipped_restart로 정리했습니다.`);
        }
      })
      .catch(() => undefined);
    this.timer = setInterval(() => void this.drain(), QUEUE_TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // --- 상태 조회 ----------------------------------------------------------------

  get circuit(): CircuitState {
    const open =
      this.circuitResumeAt !== null && Date.now() < this.circuitResumeAt;
    return {
      open,
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.circuitOpenedAt
        ? new Date(this.circuitOpenedAt).toISOString()
        : null,
      resumeAt:
        open && this.circuitResumeAt
          ? new Date(this.circuitResumeAt).toISOString()
          : null,
    };
  }

  get last(): AlertDispatcher['lastDispatch'] {
    return this.lastDispatch;
  }

  testCooldown(): {
    active: boolean;
    retryAfterSec: number;
    nextAvailableAt: string | null;
  } {
    const remain = Math.ceil((this.testCooldownUntil - Date.now()) / 1000);
    return remain > 0
      ? {
          active: true,
          retryAfterSec: remain,
          nextAvailableAt: new Date(this.testCooldownUntil).toISOString(),
        }
      : { active: false, retryAfterSec: 0, nextAvailableAt: null };
  }

  startTestCooldown(sec: number): void {
    this.testCooldownUntil = Date.now() + sec * 1000;
  }

  // --- 판정·기록 ----------------------------------------------------------------

  /**
   * 알림 1건에 대한 발송 판정 + 기록. **여기서 네트워크를 건드리지 않는다** —
   * `pending`으로 남기면 큐가 가져간다.
   */
  async record(rec: AlertRecord, flapping: boolean): Promise<void> {
    const ctx = await this.context(rec, flapping);
    const verdict = decideDispatch(rec.kind, rec.severity, ctx);
    if (verdict.action === 'none' || verdict.state === null) return;
    await this.store.upsertDelivery(rec.id, {
      state: verdict.state,
      attempts: 0,
      at: verdict.action === 'skip' ? new Date().toISOString() : null,
    });
    if (verdict.action === 'send') this.changes.next(rec.id);
  }

  private async context(
    rec: AlertRecord,
    flapping: boolean,
  ): Promise<DispatchContext> {
    const { mode } = this.settings.dispatchMode(this.dataSource);
    const d = await this.settings.discord();
    const status = await this.settings.webhookStatus();
    return {
      mode,
      configured: status.configured,
      enabled: d.enabled,
      minSeverity: d.minSeverity,
      sendUnknown: d.sendUnknown,
      flapping,
      circuitOpen: this.circuit.open,
      parentDispatched:
        rec.kind === 'resolve' && rec.parentAlertId
          ? await this.store.wasDispatched(rec.parentAlertId)
          : false,
    };
  }

  // --- 큐 ----------------------------------------------------------------------

  async drain(): Promise<void> {
    if (this.running) return;
    const { mode } = this.settings.dispatchMode(this.dataSource);
    // mock이면 큐를 아예 돌리지 않는다 (아웃바운드 0건)
    if (mode === 'mock') return;
    if (this.circuit.open) return;
    this.running = true;
    try {
      const due = await this.store.dueDeliveries(this.dataSource, Date.now());
      const d = await this.settings.discord();
      for (const item of due) {
        // 발송 속도 상한
        const wait = d.minIntervalSec * 1000 - (Date.now() - this.lastSentAt);
        if (wait > 0) return;
        if (this.circuit.open) return;
        await this.sendOne(item.alertId, item.attempts);
      }
    } catch (err) {
      this.logger.warn(
        `발송 큐 처리 실패: ${err instanceof Error ? err.name : 'error'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async sendOne(alertId: string, attempts: number): Promise<void> {
    const rec = await this.store.byId(alertId);
    if (!rec) return;
    const d = await this.settings.discord();
    const webhook = await this.loadWebhook();
    if (!webhook) {
      await this.store.upsertDelivery(alertId, {
        state: 'skipped_not_configured',
        attempts,
        at: new Date().toISOString(),
      });
      this.changes.next(alertId);
      return;
    }

    this.lastSentAt = Date.now();
    const content = this.messageFor(rec);
    const res = await this.sender.send(webhook, content, d.allowedHosts);
    const nowIso = new Date().toISOString();
    const nextAttempts = attempts + 1;

    if (res.ok) {
      this.consecutiveFailures = 0;
      this.circuitOpenedAt = null;
      this.circuitResumeAt = null;
      this.lastDispatch = {
        at: nowIso,
        state: 'sent',
        responseCode: res.status,
        detail: null,
      };
      await this.store.upsertDelivery(alertId, {
        state: 'sent',
        attempts: nextAttempts,
        at: nowIso,
        responseCode: res.status,
        detail: null,
      });
      this.changes.next(alertId);
      return;
    }

    // 429는 실패로 세지 않는다 — 유실하지 않고 큐에 남긴다 (AC-ALERT31)
    if (res.status === 429) {
      const waitSec = retryAfterSec(res.retryAfter, d.backoffSec[0] ?? 5);
      // 이 시도는 배달되지 않았다 → `failed` (디자인 3.6 `· 실패 (429 Too Many Requests)`).
      // 배달 기록은 `pending`으로 남아 유실되지 않는다
      this.lastDispatch = {
        at: nowIso,
        state: 'failed',
        responseCode: 429,
        detail: res.detail,
      };
      await this.store.upsertDelivery(alertId, {
        state: 'pending',
        attempts,
        at: nowIso,
        responseCode: 429,
        detail: res.detail,
        nextRetryAt: new Date(Date.now() + waitSec * 1000).toISOString(),
      });
      this.changes.next(alertId);
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= d.failureCircuitCount) {
      this.circuitOpenedAt = Date.now();
      this.circuitResumeAt = Date.now() + d.failureCooldownMin * 60_000;
      this.logger.warn(
        `디스코드 연속 실패 ${this.consecutiveFailures}건 — ${d.failureCooldownMin}분 동안 발송을 멈춥니다.`,
      );
    }
    const delay = nextAttemptDelaySec(nextAttempts, d.backoffSec);
    const state: DispatchState = delay === null ? 'failed' : 'pending';
    // 재시도가 남아 배달 기록은 `pending`이어도 **이 시도는 실패**다
    this.lastDispatch = {
      at: nowIso,
      state: 'failed',
      responseCode: res.status,
      detail: res.detail,
    };
    await this.store.upsertDelivery(alertId, {
      state,
      attempts: nextAttempts,
      at: nowIso,
      responseCode: res.status,
      detail: res.detail,
      nextRetryAt:
        delay === null
          ? null
          : new Date(Date.now() + delay * 1000).toISOString(),
    });
    this.changes.next(alertId);
  }

  /** 원문을 다루는 **유일한 경로**. 반환값을 로그·응답·예외에 넣지 않는다 */
  private async loadWebhook(): Promise<string | null> {
    try {
      const found = await loadWebhookUrlForDispatch(
        this.prisma.isConnected
          ? this.prisma
          : ({
              setting: { findUnique: () => Promise.resolve(null) },
            } as never),
        process.env,
      );
      return found?.url ?? null;
    } catch (err) {
      this.logger.warn(
        `웹훅 주소 읽기 실패: ${err instanceof Error ? err.name : 'error'}`,
      );
      return null;
    }
  }

  /**
   * 화면 `messagePreview`와 **같은 문자열**을 보낸다.
   * **로그 줄·요약·통계가 들어갈 자리가 없다** — 본문은 저장된 구성요소로만 조립된다.
   */
  messageFor(rec: AlertRecord): string {
    const item = presentItem(rec, {
      nowMs: Date.now(),
      maxTargets: 3,
      dedupeWindowMin: 0,
      flapWindowMin: 0,
      logLink: () => ({ href: null, target: null }),
    });
    return buildMessage(
      rec,
      item,
      this.cluster.clusterInfo().name,
      this.config.get('ALERTS_PUBLIC_BASE_URL', { infer: true }) ?? null,
    );
  }

  /** 테스트 발송 본문 (계약 2.7). `[테스트]`와 "실제 장애가 아닙니다"가 반드시 들어간다 */
  testMessage(atIso: string | null): string {
    const mock = this.dataSource === 'mock' ? '[MOCK] ' : '';
    const cluster = this.cluster.clusterInfo().name;
    return [
      `${mock}[테스트] Sentinel 알림 설정 확인 메시지입니다. 실제 장애가 아닙니다.`,
      ...(cluster ? [`클러스터: ${cluster}`] : []),
      `시각: ${atIso ?? '(보낼 때의 시각으로 채워집니다)'}`,
    ].join('\n');
  }

  /**
   * 테스트 발송 **실행**. mock이면 `skipped_mock`으로 끝나고
   * `DiscordSenderPort`를 부르지 않는다.
   */
  async sendTestNow(content: string): Promise<{
    state: DispatchState;
    responseCode: number | null;
    detail: string | null;
  }> {
    const { mode } = this.settings.dispatchMode(this.dataSource);
    if (mode === 'mock') {
      return { state: 'skipped_mock', responseCode: null, detail: null };
    }
    const d = await this.settings.discord();
    const webhook = await this.loadWebhook();
    if (!webhook) {
      return {
        state: 'skipped_not_configured',
        responseCode: null,
        detail: null,
      };
    }
    const res = await this.sender.send(webhook, content, d.allowedHosts);
    const nowIso = new Date().toISOString();
    if (res.ok) {
      // 채널이 살아 있다는 증거다 — 보통 발송 성공과 같이 서킷도 닫는다.
      // (전에는 실패 수만 0으로 돌려 "연속 실패 0건으로 발송을 멈췄습니다"가 될 수 있었다)
      this.consecutiveFailures = 0;
      this.circuitOpenedAt = null;
      this.circuitResumeAt = null;
      this.lastDispatch = {
        at: nowIso,
        state: 'sent',
        responseCode: res.status,
        detail: null,
      };
      return { state: 'sent', responseCode: res.status, detail: null };
    }
    // 발송 실패는 **HTTP 오류가 아니다** — 200 + result.state로 돌려준다
    this.lastDispatch = {
      at: nowIso,
      state: 'failed',
      responseCode: res.status,
      detail: res.detail ? safeDetail(res.detail) : null,
    };
    return {
      state: 'failed',
      responseCode: res.status,
      detail: res.detail ? safeDetail(res.detail) : null,
    };
  }
}
