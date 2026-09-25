/**
 * alerts 조회·확인 처리 + SSE 페이로드 (docs/api/alerts.md 2·6절).
 *
 * 화면이 하지 않는 것을 **여기서** 한다: 심각도·억제·플래핑·정지 구간·발송 제외 사유·
 * 지속 시간·개수(facets)·키 → 경로 매핑. 전부 서버 값이다.
 */
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import { ApiException, resourceNotFound } from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { PrismaService } from '../database/prisma.service';
import { readWebhookStatus } from '../database/secret-settings';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../config/env.validation';
import { ClusterStateService } from '../cluster/state/cluster-state.service';
import { LogLinkService } from '../logs/log-link.service';
import { AlertDispatcher } from './alert-dispatcher.service';
import { AlertEngine } from './alert-engine.service';
import { AlertSettingsService } from './alert-settings.service';
import { watchKeys } from './alert-labels';
import { dispatchLabel, presentDetail, presentItem } from './alert-presenter';
import { AlertStore, type AlertFilter } from './alert-store.service';
import type {
  AlertSettingsPatchDto,
  AlertsQueryDto,
  AlertsReadDto,
  AlertTestDto,
} from './dto';
import {
  ALERT_AREA_KEYS,
  type AlertBadge,
  type AlertItem,
  type AlertNotice,
  type AlertRecord,
} from './alerts.types';

const RANGE_MS: Record<string, number | null> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  all: null,
};

@Injectable()
export class AlertsService {
  /** 확인 처리처럼 알림 1건이 아닌 변화 (토픽 제공자가 구독한다) */
  private readonly readSubject = new Subject<{
    ids: string[] | null;
    all: boolean;
    badge: AlertBadge;
  }>();
  readonly readEvents$: Observable<{
    ids: string[] | null;
    all: boolean;
    badge: AlertBadge;
  }> = this.readSubject.asObservable();
  private badgeCache: AlertBadge = {
    unreadCount: 0,
    worstSeverity: null,
    updatedAt: new Date().toISOString(),
  };
  /**
   * mock `alerts=webhook-failed` 전용 **표시 값**(PM 결정 2026-09-25, 계약 5절).
   * 디자인 3.6 둘째 줄(`연속 실패 10건으로 발송을 멈췄습니다. 15:04에 다시 시도합니다.`)을 mock에서 보이게 한다.
   * **설정 응답을 만들 때만** 덮어쓴다 — dispatcher·큐·판정·전송은 이 값을 모른다(실제 서킷은 닫혀 있다).
   */
  private mockCircuitDisplay: { openedAt: number; resumeAt: number } | null =
    null;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly dataSource: DataSourceMode,
    private readonly store: AlertStore,
    private readonly engine: AlertEngine,
    private readonly logLinks: LogLinkService,
    private readonly alertSettings: AlertSettingsService,
    private readonly dispatcher: AlertDispatcher,
    private readonly cluster: ClusterStateService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // --- 배지 ------------------------------------------------------------------

  async badge(): Promise<AlertBadge> {
    const { count, worst } = await this.store.badgeCounts(this.dataSource);
    const next: AlertBadge = {
      unreadCount: count,
      worstSeverity: worst === null || worst === 'resolved' ? null : worst,
      updatedAt:
        count === this.badgeCache.unreadCount &&
        worst === this.badgeCache.worstSeverity
          ? this.badgeCache.updatedAt
          : new Date().toISOString(),
    };
    this.badgeCache = next;
    return next;
  }

  badgeNow(): AlertBadge {
    return this.badgeCache;
  }

  /**
   * `GET /api/alerts/badge` 응답. **목록·최근 N건·개요 요약을 넣지 않는다.**
   * 스트림 없이 렌더하는 첫 로드·폴백용이라 집계 질의 1회로 끝나야 한다.
   */
  async badgeEnvelope(): Promise<Record<string, unknown>> {
    const badge = await this.badge();
    return {
      dataSource: this.dataSource,
      generatedAt: new Date().toISOString(),
      unreadCount: badge.unreadCount,
      worstSeverity: badge.worstSeverity,
      updatedAt: badge.updatedAt,
    };
  }

  // --- 목록 ------------------------------------------------------------------

  async list(q: AlertsQueryDto): Promise<Record<string, unknown>> {
    if (q.range && (q.from || q.to)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'range와 from/to를 함께 보낼 수 없습니다.',
        {
          fields: [
            {
              field: 'range',
              constraints: ['range와 from/to는 함께 쓸 수 없습니다'],
            },
          ],
        },
      );
    }
    const now = Date.now();
    const rangeId = q.range ?? (q.from || q.to ? null : '24h');
    const span = rangeId ? RANGE_MS[rangeId] : null;
    const from = q.from
      ? Date.parse(q.from)
      : span !== null && span !== undefined
        ? now - span
        : null;
    const to = q.to ? Date.parse(q.to) : null;

    const filter: AlertFilter = {
      from,
      to,
      severity: (q.severity as AlertFilter['severity']) ?? null,
      area: q.area ?? null,
      key: q.key ?? null,
      kind: (q.kind as AlertFilter['kind']) ?? null,
      includeResolved: q.includeResolved !== false,
      unreadOnly: q.unreadOnly === true,
      limit: q.limit ?? 100,
      offset: q.offset ?? 0,
    };
    const page = await this.store.query(this.dataSource, filter);
    const generatedAt = new Date();

    return {
      dataSource: this.dataSource,
      generatedAt: generatedAt.toISOString(),
      persistence: this.store.persistence,
      total: page.total,
      filteredTotal: page.filteredTotal,
      offset: filter.offset,
      limit: filter.limit,
      range: {
        id: rangeId,
        from: from === null ? null : new Date(from).toISOString(),
        to: new Date(to ?? now).toISOString(),
      },
      badge: await this.badge(),
      watch: this.watch(),
      facets: page.facets,
      // **`items`와 별도 배열이다.** 어떤 필터로도 사라지지 않게 하려는 설계다
      gaps: this.gapsWithin(from, to ?? now),
      items: page.items.map((r) => this.toItem(r, generatedAt.getTime(), 3)),
      notices: this.notices(),
    };
  }

  async detail(id: string): Promise<Record<string, unknown>> {
    const rec = await this.store.byId(id);
    if (!rec || rec.dataSource !== this.dataSource) {
      throw resourceNotFound({ kind: 'Alert', id }, '없는 알림입니다.');
    }
    const now = Date.now();
    return {
      ...presentDetail(
        rec,
        this.presentOptions(now, 10),
        this.cluster.clusterInfo().name,
        this.config.get('ALERTS_PUBLIC_BASE_URL', { infer: true }) ?? null,
      ),
      dataSource: this.dataSource,
      generatedAt: new Date(now).toISOString(),
    };
  }

  // --- 확인(읽음) --------------------------------------------------------------

  async markRead(body: AlertsReadDto): Promise<Record<string, unknown>> {
    const hasIds = Array.isArray(body.ids) && body.ids.length > 0;
    if (hasIds === (body.all === true)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'ids 또는 all 중 하나만 보내야 합니다.',
        {
          fields: [
            {
              field: 'ids',
              constraints: ['ids 또는 all 중 하나만 보냅니다'],
            },
          ],
        },
      );
    }
    const at = Date.now();
    const updated = await this.store.markRead(
      this.dataSource,
      hasIds ? (body.ids as string[]) : null,
      at,
    );
    const badge = await this.badge();
    // 처리 후 모든 구독자에게 알린다 — 확인 상태는 서버에 하나다 (AC-ALERT16)
    this.readSubject.next({
      ids: hasIds ? (body.ids as string[]) : null,
      all: !hasIds,
      badge,
    });
    return {
      dataSource: this.dataSource,
      generatedAt: new Date(at).toISOString(),
      // 대시보드 DB가 없으면 200이고 메모리에만 반영된다 (재시작하면 사라진다)
      persistence: this.store.persistence,
      updated,
      badge,
    };
  }

  // --- 설정 (P2) ---------------------------------------------------------------

  /**
   * `GET /api/alerts/settings` (계약 2.5).
   * **웹훅 원문이 이 응답에 없다** — `hint`(끝 4자)와 길이뿐이다 (AC-ALERT20).
   */
  async settings(): Promise<Record<string, unknown>> {
    const dispatch = this.alertSettings.dispatchMode(this.dataSource);
    const d = await this.alertSettings.discord();
    const hook = await this.alertSettings.webhookStatus();
    const locked = this.alertSettings.lockedByEnv();
    const rules = await this.alertSettings.rulesBlock();
    const retention = await this.alertSettings.retentionBlock();
    const notices = this.notices();
    if (rules.repeatEveryMin !== null) {
      notices.push({
        code: 'ALERTS_REPEAT_NOT_IMPLEMENTED',
        level: 'info',
        text: '주기적 재알림은 아직 동작하지 않습니다 (다음 범위).',
      });
    }
    // 응답에 싣는 서킷 값. mock `webhook-failed`면 표시 전용 값으로 덮는다(실제 dispatcher 상태는 그대로)
    const circuit = this.circuitForDisplay();
    if (circuit.open) {
      notices.push({
        code: 'ALERTS_DISCORD_CIRCUIT_OPEN',
        level: 'warn',
        text: '연속 실패로 디스코드 발송을 잠시 멈췄습니다. 화면 알림은 계속 쌓입니다.',
        details: { resumeAt: circuit.resumeAt },
      });
    }
    if (!d.enabled) {
      notices.push({
        code: 'ALERTS_DISCORD_DISABLED',
        level: 'info',
        text: '디스코드 알림이 꺼져 있습니다 — 화면 알림 센터에는 계속 쌓입니다.',
      });
    }
    notices.push({
      code: 'ALERTS_TARGET_NAMES_PLAIN',
      level: 'info',
      text: '알림 본문에 클러스터 리소스 이름이 포함됩니다. 채널 공개 범위를 확인하세요.',
    });
    return {
      dataSource: this.dataSource,
      generatedAt: new Date().toISOString(),
      persistence: this.store.persistence,
      dispatch: {
        mode: dispatch.mode,
        modeSource: dispatch.modeSource,
        // `false`면 **아웃바운드 요청이 0건**이다
        outbound: dispatch.mode === 'live',
      },
      discord: {
        enabled: d.enabled,
        configured: hook.configured,
        hint: hook.hint,
        length: hook.length,
        source: hook.source,
        updatedAt: hook.updatedAt ? hook.updatedAt.toISOString() : null,
        minSeverity: d.minSeverity,
        sendUnknown: d.sendUnknown,
        publicBaseUrlConfigured: Boolean(
          this.config.get('ALERTS_PUBLIC_BASE_URL', { infer: true }),
        ),
        // 실제로 밖으로 나간 시도(`sent`·`failed`)만. 테스트 발송 포함, `skipped_*`는 기록하지 않는다
        // → mock에서는 나간 적이 없으니 null이 맞다 (PM 결정, 계약 2.5)
        lastDispatch: this.dispatcher.last,
        // 서킷이 열려 있으면 `resumeAt`이 재개 시각이다 (디자인 3.6 "15:04에 다시 시도합니다")
        circuitBreaker: circuit,
        queue: await this.queueBlock(circuit),
      },
      rules,
      retention,
      keys: watchKeys().map((k) => {
        // 현재 상태는 **알림 엔진이 이미 판단한 값**이다 (새 기준을 만들지 않는다, 계약 2.5).
        // 화면이 다른 스트림에서 짜 맞추면 판단 기준이 두 곳이 된다
        const st = this.engine.keyStatus(k.key);
        return {
          ...k,
          enabled: true,
          // 키별 켜고 끄기는 P3
          editable: false,
          status: st?.status ?? null,
          statusSince: st?.since ?? null,
        };
      }),
      warmup: {
        active: this.engine.warmupActive,
        endsAt: this.engine.warmupEndsAt,
      },
      lockedByEnv: locked.map((l) => l.field),
      lockedByEnvDetail: locked,
      notices,
      updatedAt: hook.updatedAt ? hook.updatedAt.toISOString() : null,
    };
  }

  async patchSettings(
    body: AlertSettingsPatchDto,
  ): Promise<Record<string, unknown>> {
    await this.alertSettings.patch(body);
    // 설정이 바뀌면 판정 기준도 바뀐다 — 엔진 캐시를 **즉시** 무효화한다
    // (안 부르면 최대 60초 옛 값으로 판정·발송한다)
    this.engine.invalidateRules();
    await this.refreshWebhookConfigured();
    return this.settings();
  }

  /**
   * mock 시나리오 쪽에서 부른다: `webhook-failed`일 때만 표시 전용 서킷을 켠다.
   * live에서는 아무 일도 하지 않는다.
   */
  setMockCircuitDisplay(on: boolean): void {
    if (this.dataSource !== 'mock' || !on) {
      this.mockCircuitDisplay = null;
      return;
    }
    const now = Date.now();
    this.mockCircuitDisplay = {
      openedAt: now - 2 * 60_000,
      resumeAt: now + 58 * 60_000,
    };
  }

  /**
   * 설정 응답의 `discord.circuitBreaker`. 보통은 dispatcher의 실제 값이고,
   * mock `webhook-failed`일 때만 **표시 전용** "열림 · 연속 실패 10건 · 약 1시간 뒤 재개"로 덮는다.
   * dispatcher의 상태를 바꾸지 않는다(판정은 `this.dispatcher.circuit`을 본다).
   */
  private circuitForDisplay(): {
    open: boolean;
    consecutiveFailures: number;
    openedAt: string | null;
    resumeAt: string | null;
  } {
    const shown = this.mockCircuitDisplay;
    // 발송이 실제로 나갈 수 있는 조합(DATA_SOURCE=mock + ALERTS_DISPATCH=live)에서는 덮지 않는다 —
    // 그때는 진짜 서킷이 있으므로 표시 값이 그것을 가리면 안 된다
    if (
      this.dataSource !== 'mock' ||
      !shown ||
      this.alertSettings.dispatchMode(this.dataSource).mode !== 'mock'
    )
      return this.dispatcher.circuit;
    const now = Date.now();
    if (now >= shown.resumeAt) {
      // 시나리오를 1시간 넘게 켜 두면 재개 시각이 지나 버린다 → 다시 잡는다(표시가 모순되지 않게)
      shown.openedAt = now - 2 * 60_000;
      shown.resumeAt = now + 58 * 60_000;
    }
    return {
      open: true,
      consecutiveFailures: 10,
      openedAt: new Date(shown.openedAt).toISOString(),
      resumeAt: new Date(shown.resumeAt).toISOString(),
    };
  }

  /**
   * 발송 대기열 (계약 2.5 `discord.queue`). `nextRetryAt` = 대기 건이 다음에 시도되는 가장 이른 시각.
   * 서킷이 열려 있으면 재개 시각보다 이르지 않다(큐가 그때까지 멈춰 있다). 대기 건이 없으면 null.
   */
  private async queueBlock(circuit: {
    open: boolean;
    resumeAt: string | null;
  }): Promise<{ pending: number; nextRetryAt: string | null }> {
    const now = Date.now();
    const q = await this.store.queueSummary(this.dataSource, now);
    if (q.earliestAt === null) return { pending: q.pending, nextRetryAt: null };
    const resume =
      circuit.open && circuit.resumeAt ? Date.parse(circuit.resumeAt) : 0;
    return {
      pending: q.pending,
      nextRetryAt: new Date(Math.max(q.earliestAt, resume)).toISOString(),
    };
  }

  // --- 테스트 발송 (P2) ----------------------------------------------------------

  /** `GET /api/alerts/test/preview` — **아무것도 보내지 않는다** */
  async testPreview(): Promise<Record<string, unknown>> {
    const dispatch = this.alertSettings.dispatchMode(this.dataSource);
    const d = await this.alertSettings.discord();
    const hook = await this.alertSettings.webhookStatus();
    const cooldown = this.dispatcher.testCooldown();
    const blocked = this.testBlocked(
      hook.configured,
      d.enabled,
      cooldown.active,
    );
    return {
      dataSource: this.dataSource,
      generatedAt: new Date().toISOString(),
      // mock에서도 버튼은 눌린다. 아무것도 나가지 않고 본문 전문이 결과에 온다
      canSend: blocked === null,
      blocked,
      target: { hint: hook.hint, length: hook.length },
      dispatch: { mode: dispatch.mode, outbound: dispatch.mode === 'live' },
      message: this.dispatcher.testMessage(null),
      cooldown,
      warning:
        '디스코드 채널에 실제 메시지가 즉시 전송됩니다. 되돌릴 수 없습니다.',
    };
  }

  /** `POST /api/alerts/test` — 되돌릴 수 없는 외부 동작이라 **명시 확인**이 필요하다 */
  async sendTest(body: AlertTestDto): Promise<Record<string, unknown>> {
    if (body.confirm !== true) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ALERT_TEST_CONFIRMATION_REQUIRED',
        '테스트 발송은 confirm: true가 있어야 합니다. 아무것도 보내지 않았습니다.',
      );
    }
    const cooldown = this.dispatcher.testCooldown();
    if (cooldown.active) {
      throw new ApiException(
        HttpStatus.TOO_MANY_REQUESTS,
        'ALERT_TEST_COOLDOWN',
        `테스트 발송은 ${cooldown.retryAfterSec}초 뒤에 다시 할 수 있습니다.`,
        { nextAvailableAt: cooldown.nextAvailableAt },
        cooldown.retryAfterSec,
      );
    }
    const d = await this.alertSettings.discord();
    const hook = await this.alertSettings.webhookStatus();
    if (!hook.configured) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'ALERT_WEBHOOK_NOT_CONFIGURED',
        '저장된 웹훅 주소가 없습니다. 먼저 주소를 저장하세요.',
      );
    }
    if (!d.enabled) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'ALERT_DISPATCH_DISABLED',
        '디스코드 알림이 꺼져 있습니다.',
      );
    }

    const at = new Date();
    const message = this.dispatcher.testMessage(
      `${at.toISOString().slice(0, 19)}Z`,
    );
    const result = await this.dispatcher.sendTestNow(message);
    // 성공·실패·mock 어느 결과든 쿨다운이 시작된다 (실패로 연타하는 것을 막는다)
    this.dispatcher.startTestCooldown(d.testCooldownSec);

    // 언제 눌렀고 결과가 무엇인지 **이력 1건**을 남긴다. **배지에는 세지 않는다**
    const rec = await this.store.insert(this.dataSource, {
      alertKey: 'system:test',
      kind: 'test',
      severity: 'unknown',
      fromStatus: null,
      toStatus: null,
      reasonCode: 'ALERT_TEST',
      reasonText: '테스트 발송',
      targets: [],
      targetCount: 0,
      occurredAt: at.getTime(),
      parentAlertId: null,
      suppressedKeys: [],
      context: null,
      flapping: false,
      deliveries: [
        {
          channel: 'discord',
          state: result.state,
          label: '',
          at: at.toISOString(),
          attempts: result.state === 'skipped_mock' ? 0 : 1,
          responseCode: result.responseCode,
          detail: result.detail,
          nextRetryAt: null,
        },
      ],
    });

    const after = this.dispatcher.testCooldown();
    return {
      dataSource: this.dataSource,
      generatedAt: new Date().toISOString(),
      alertId: rec.id,
      // **발송 실패는 HTTP 오류가 아니다** — 200 + result.state로 돌려준다
      result: {
        state: result.state,
        label: dispatchLabel(result.state),
        at: at.toISOString(),
        responseCode: result.responseCode,
        detail: result.detail,
      },
      message,
      cooldown: {
        retryAfterSec: after.retryAfterSec,
        nextAvailableAt: after.nextAvailableAt,
      },
    };
  }

  private testBlocked(
    configured: boolean,
    enabled: boolean,
    cooldownActive: boolean,
  ): { code: string; text: string } | null {
    if (!configured)
      return {
        code: 'ALERT_WEBHOOK_NOT_CONFIGURED',
        text: '웹훅 주소가 설정돼 있지 않습니다.',
      };
    if (!enabled)
      return {
        code: 'ALERT_DISPATCH_DISABLED',
        text: '디스코드 알림이 꺼져 있습니다.',
      };
    if (cooldownActive)
      return {
        code: 'ALERT_TEST_COOLDOWN',
        text: '방금 보냈습니다. 잠시 뒤에 다시 시도하세요.',
      };
    return null;
  }

  // --- SSE 페이로드 -------------------------------------------------------------

  /**
   * `alerts.snapshot` — **목록을 싣지 않는다** (AC-ALERT37).
   * 모든 페이지가 이 토픽을 구독하므로 이력을 실으면 알림 화면을 보지 않는 탭까지
   * 매 재연결마다 이력을 받는다. 목록은 `GET /api/alerts`로만 온다.
   */
  async snapshotPayload(): Promise<Record<string, unknown>> {
    return {
      badge: await this.badge(),
      watch: this.watch(),
      dispatch: this.dispatchSummary(),
      persistence: this.store.persistence,
      warmup: {
        active: this.engine.warmupActive,
        endsAt: this.engine.warmupEndsAt,
      },
      notices: this.notices(),
    };
  }

  async eventPayload(rec: AlertRecord): Promise<Record<string, unknown>> {
    return {
      alert: this.toItem(rec, Date.now(), 3),
      badge: await this.badge(),
    };
  }

  // --- 보조 ------------------------------------------------------------------

  private presentOptions(nowMs: number, maxTargets: number) {
    const rules = this.engine.rulesNow();
    return {
      nowMs,
      maxTargets,
      dedupeWindowMin: rules.dedupeWindowMin,
      flapWindowMin: rules.flapWindowMin,
      // 링크는 **저장하지 않고 응답을 만들 때** 계산한다 (파드가 사라졌을 수 있다)
      logLink: (
        ref: Parameters<LogLinkService['linkFor']>[0],
        atIso: string | null,
      ) => this.logLinks.linkFor(ref, atIso),
    };
  }

  private toItem(
    rec: AlertRecord,
    nowMs: number,
    maxTargets: number,
  ): AlertItem {
    return presentItem(rec, this.presentOptions(nowMs, maxTargets));
  }

  /** 빈 상태 footer의 근거. **목록이 비어도 항상 준다** */
  private watch() {
    return {
      lastObservedAt: this.engine.observedAt,
      keyCount: ALERT_AREA_KEYS.length,
      keys: watchKeys(),
    };
  }

  /** 기간과 겹치는 정지 구간 전부. 심각도·영역·읽음·해제 필터의 영향을 **받지 않는다** */
  private gapsWithin(from: number | null, to: number) {
    return this.engine.gaps.filter((g) => {
      const gFrom = Date.parse(g.from);
      const gTo = g.to ? Date.parse(g.to) : Date.now();
      return (from === null || gTo >= from) && gFrom <= to;
    });
  }

  private dispatchSummary() {
    const envMode = this.config.get('ALERTS_DISPATCH', { infer: true });
    const mode = envMode ?? this.dataSource;
    return {
      mode,
      modeSource: envMode ? 'env' : 'data_source',
      // `false`면 **아웃바운드 요청이 0건**이다
      outbound: mode === 'live',
    };
  }

  private notices(): AlertNotice[] {
    const out: AlertNotice[] = [];
    const d = this.dispatchSummary();
    if (!d.outbound) {
      out.push({
        code: 'ALERTS_DISPATCH_MOCK',
        level: 'info',
        text: 'mock 모드입니다 — 디스코드로 실제 발송하지 않습니다.',
      });
    }
    const configured = this.webhookConfigured;
    if (!configured) {
      out.push({
        code: 'ALERTS_DISCORD_NOT_CONFIGURED',
        level: 'info',
        // 오류·빨간 배너·토스트가 아니다 (AC-ALERT19)
        text: '디스코드 미설정 — 알림이 화면에만 쌓입니다.',
      });
    }
    if (this.store.persistence === 'memory') {
      out.push({
        code: 'ALERTS_HISTORY_MEMORY_ONLY',
        level: 'warn',
        text: '대시보드 DB가 없어 알림 이력이 저장되지 않습니다 (재시작하면 사라집니다).',
      });
    }
    if (this.engine.warmupActive) {
      out.push({
        code: 'ALERTS_WARMUP_ACTIVE',
        level: 'info',
        text: '시작 직후 워밍업 중입니다 — 이 동안 알림이 생기지 않는 것이 정상입니다.',
        details: { endsAt: this.engine.warmupEndsAt },
      });
    }
    return out;
  }

  /**
   * 화면 안내용 "설정돼 있는가"만 본다. **원문을 읽지 않는다** —
   * `readWebhookStatus()`는 `{configured, hint, length}`만 주고, 원문을 돌려주는 함수는
   * 발송기 전용 하나뿐이다 (DBA 설계, AC-ALERT20).
   */
  private webhookConfigured = false;

  async refreshWebhookConfigured(): Promise<void> {
    if (!this.prisma.isConnected) {
      this.webhookConfigured = Boolean(
        this.config.get('ALERTS_DISCORD_WEBHOOK_URL', { infer: true }),
      );
      return;
    }
    try {
      const status = await readWebhookStatus(this.prisma);
      this.webhookConfigured = status.configured;
    } catch {
      this.webhookConfigured = false;
    }
  }
}
