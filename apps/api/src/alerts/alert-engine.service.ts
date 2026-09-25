/**
 * 알림 생성 루프 (docs/specs/alerts.md 3.2, docs/api/alerts.md 4.3).
 *
 * **새 판단 기준을 만들지 않는다.** 15초마다 `GET /api/overview`가 쓰는 것과 같은
 * `StatusInfo`를 읽어 **전이만** 본다. 상태를 다시 계산하는 코드가 여기에 없다 (AC-ALERT14).
 *
 * 억제(15분)·플래핑(30분·4회)·워밍업(120초)·출처 억제(3분)·`unknown` 지속은
 * 전부 `settings.alerts` 값이고 판정은 `alert-rules.ts`(순수 함수)에 있다.
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { SettingsService } from '../common/settings.service';
import { SourceRegistry } from '../common/source-registry.service';
import type { Reason, Status, StatusInfo } from '../common/status';
import type { EnvironmentVariables } from '../config/env.validation';
import { OverviewService } from '../cluster/overview.service';
import type { ProblemItem } from '../cluster/types';
import { AlertDispatcher } from './alert-dispatcher.service';
import { AlertStore, type NewAlertInput } from './alert-store.service';
import {
  applyCreated,
  applyMitigated,
  decideKey,
  initialKeyState,
  type AlertAction,
  type AlertRules,
  type KeyState,
} from './alert-rules';
import {
  type AlertGap,
  type AlertKey,
  type AlertRecord,
  type AlertSeverity,
} from './alerts.types';

const TICK_MS = 15_000;

/** 출처가 끊기면 함께 묶이는 영역 (계약 4.3 "출처 억제") */
const KUBE_DEPENDENT_KEYS: AlertKey[] = [
  'area:controlPlane',
  'area:nodes',
  'area:workloads',
  'area:pods',
  'area:events',
];

export interface AlertEvent {
  kind: 'created' | 'updated';
  record: AlertRecord;
}

interface Observed {
  key: AlertKey;
  status: Status;
  reason: Reason | null;
  targets: { kind: string; namespace: string | null; name: string }[];
  targetCount: number;
}

@Injectable()
export class AlertEngine implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AlertEngine.name);
  readonly startedAt = Date.now();
  private states = new Map<string, KeyState>();
  /**
   * **이번 실행에서** 한 번 이상 평가한 키. 기동 때 DB에서 읽은 상태는 지난 실행의 값이라
   * "현재 상태"로 내보내지 않는다 (설정 화면 `keys[].status`, 계약 2.5)
   */
  private readonly observedThisRun = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private warmupTimer: NodeJS.Timeout | null = null;
  private warmupDone = false;
  private gapList: AlertGap[] = [];
  private bootGaps: AlertGap[] = [];
  private lastObservedAt: string | null = null;
  private running = false;
  private readonly subject = new Subject<AlertEvent>();
  readonly events$: Observable<AlertEvent> = this.subject.asObservable();
  private rulesCache: AlertRules | null = null;

  constructor(
    @Inject(DATA_SOURCE_MODE) readonly dataSource: 'mock' | 'live',
    private readonly overview: OverviewService,
    private readonly registry: SourceRegistry,
    private readonly settings: SettingsService,
    private readonly store: AlertStore,
    private readonly dispatcher: AlertDispatcher,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  // --- 수명 주기 ---------------------------------------------------------------

  onApplicationBootstrap(): void {
    void this.bootstrap();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.warmupTimer) clearTimeout(this.warmupTimer);
  }

  private async bootstrap(): Promise<void> {
    const rules = await this.rules();
    this.store.setMemoryMax(rules.memoryFallbackMax);
    this.states = await this.store.loadKeyStates(this.dataSource);

    // 정지 구간: 마지막 heartbeat ~ 지금. 행이 없으면 "이전 실행 기록 없음"
    const hb = await this.store.readHeartbeat(this.dataSource);
    const gapMinMs = Math.max(2 * rules.heartbeatIntervalSec, 60) * 1000;
    if (hb && this.startedAt - hb.observedAt >= gapMinMs) {
      this.gapList.push({
        id: `gap-${new Date(hb.observedAt).toISOString()}`,
        from: new Date(hb.observedAt).toISOString(),
        to: new Date(this.startedAt).toISOString(),
        minutes: Math.round((this.startedAt - hb.observedAt) / 60_000),
        unknownPrevious: false,
      });
    }
    this.hasPreviousRun = hb !== null;
    if (hb === null) {
      // 대시보드 DB가 없거나 첫 실행이면 **이전 구간을 계산할 수 없다**.
      // 비워 두면 화면이 "그동안 아무 일도 없었다"로 읽으므로 정직하게 한 줄을 남긴다 (AC-ALERT10).
      this.gapList.push({
        id: `gap-unknown-${new Date(this.startedAt).toISOString()}`,
        from: new Date(this.startedAt).toISOString(),
        to: new Date(this.startedAt).toISOString(),
        minutes: 0,
        unknownPrevious: true,
      });
    }

    await this.store.writeHeartbeat(
      this.dataSource,
      this.startedAt,
      this.startedAt,
    );
    this.lastObservedAt = new Date(this.startedAt).toISOString();

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      this.lastObservedAt = new Date(now).toISOString();
      void this.store.writeHeartbeat(this.dataSource, this.startedAt, now);
    }, rules.heartbeatIntervalSec * 1000);
    this.heartbeatTimer.unref();

    // 워밍업: 이 동안 알림을 만들지 않고 상태만 따라간다 (AC-ALERT09)
    const warmupMs = rules.warmupSec * 1000;
    if (warmupMs <= 0) {
      this.warmupDone = true;
    } else {
      this.warmupTimer = setTimeout(() => {
        void this.finishWarmup();
      }, warmupMs);
      this.warmupTimer.unref();
    }

    this.bootGaps = [...this.gapList];
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    void this.tick();
  }

  private hasPreviousRun = false;

  // --- 설정 -------------------------------------------------------------------

  async rules(): Promise<AlertRules> {
    const v = await this.settings.get('alerts');
    this.rulesCache = { ...v };
    return this.rulesCache;
  }

  rulesNow(): AlertRules {
    return this.rulesCache ?? { ...this.settings.peek('alerts') };
  }

  /** 설정을 쓴 뒤 반드시 부른다 — 안 부르면 최대 60초 옛 값이 쓰인다 (DBA 지적) */
  invalidateRules(): void {
    this.settings.invalidate('alerts');
    this.rulesCache = null;
  }

  get warmupActive(): boolean {
    return !this.warmupDone;
  }

  get warmupEndsAt(): string | null {
    if (this.warmupDone) return null;
    return new Date(
      this.startedAt + this.rulesNow().warmupSec * 1000,
    ).toISOString();
  }

  get gaps(): AlertGap[] {
    return this.gapList;
  }

  get observedAt(): string | null {
    return this.lastObservedAt;
  }

  /**
   * mock 시나리오 전환·초기화가 상태 머신을 되돌릴 때.
   * **정지 구간은 지우지 않는다** — 기동 때 계산한 사실이고 시나리오와 무관하다.
   */
  resetStates(): void {
    this.states.clear();
    this.observedThisRun.clear();
  }

  /**
   * 알림 대상 키의 **현재 상태** — 엔진이 마지막 평가(15초 주기)에서 본 값 그대로다.
   * 판단 기준을 새로 만들지 않는다: 영역 상태(`areas.*.status`)·비용 상태·kube 출처 상태를
   * 알림 판정에 쓰는 바로 그 값이다. 이번 실행에서 아직 평가하지 않았으면 null.
   */
  keyStatus(key: string): { status: Status; since: string } | null {
    if (!this.observedThisRun.has(key)) return null;
    const st = this.states.get(key);
    if (!st) return null;
    return { status: st.status, since: new Date(st.statusSince).toISOString() };
  }

  /** 기동 때 계산한 정지 구간 (시나리오가 바뀌어도 사실은 그대로다) */
  get bootstrapGaps(): AlertGap[] {
    return [...this.bootGaps];
  }

  /** mock 전용: 시나리오가 재현하는 정지 구간을 얹는다 */
  setGaps(list: AlertGap[]): void {
    this.gapList = [...list];
  }

  // --- 평가 루프 ---------------------------------------------------------------

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rules = await this.rules();
      const now = Date.now();
      const observations = await this.observe();
      const suppressor = this.sourceSuppressor(observations, rules, now);

      for (const obs of observations) {
        const suppressedBy =
          suppressor && KUBE_DEPENDENT_KEYS.includes(obs.key)
            ? suppressor
            : null;
        const prev =
          this.states.get(obs.key) ?? initialKeyState(obs.status, now);
        const result = decideKey({
          key: obs.key,
          state: prev,
          observation: {
            status: obs.status,
            targetRefs: obs.targets.map(
              (t) => `${t.kind}/${t.namespace ?? '-'}/${t.name}`,
            ),
            suppressedBy,
          },
          rules,
          now,
          warmup: !this.warmupDone,
        });
        let state = result.state;
        for (const action of result.actions) {
          state = await this.applyAction(
            obs,
            state,
            action,
            rules,
            now,
            suppressor ? this.suppressedKeysFor(obs.key) : [],
          );
        }
        this.states.set(obs.key, state);
        this.observedThisRun.add(obs.key);
        // **바뀐 키만** 저장한다 (15초마다 8행을 쓰지 않는다)
        if (result.changed || result.actions.length > 0) {
          await this.store.saveKeyState(this.dataSource, obs.key, state);
        }
      }
    } catch (err) {
      this.logger.warn(
        `알림 평가 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private suppressedKeysFor(key: AlertKey): string[] {
    return key === 'source:kube' ? [...KUBE_DEPENDENT_KEYS] : [];
  }

  /**
   * 출처 억제: kube가 `sourceSuppressAfterMin` 넘게 끊겨 있으면 영역 키를 묶는다.
   * 영역 5개가 따로 울리는 대신 `source:kube` 1건만 남는다 (AC-ALERT07).
   */
  private sourceSuppressor(
    observations: Observed[],
    rules: AlertRules,
    now: number,
  ): string | null {
    const kube = observations.find((o) => o.key === 'source:kube');
    if (!kube || kube.status === 'ok') return null;
    const state = this.states.get('source:kube');
    const since = state?.unknownSince ?? state?.statusSince ?? now;
    if (kube.status !== 'unknown') return 'source:kube';
    return now - since >= rules.sourceSuppressAfterMin * 60_000
      ? 'source:kube'
      : null;
  }

  private async applyAction(
    obs: Observed,
    state: KeyState,
    action: AlertAction,
    rules: AlertRules,
    now: number,
    suppressedKeys: string[],
  ): Promise<KeyState> {
    if (action.type === 'merge') {
      const rec = await this.store.merge(
        action.alertId,
        action.repeatCount,
        now,
      );
      if (rec) this.subject.next({ kind: 'updated', record: rec });
      return state;
    }
    if (action.type === 'mitigate') {
      const rec = await this.store.mitigate(
        action.alertId,
        action.severity,
        action.to,
        {
          at: new Date(now).toISOString(),
          from: action.from,
          to: action.to,
        },
      );
      if (rec) this.subject.next({ kind: 'updated', record: rec });
      return applyMitigated(state, action.severity);
    }

    // create
    let incidentStartedAt: string | null = null;
    if (action.closesParent && action.parentAlertId) {
      if (action.kind === 'resolve') {
        const parent = await this.store.byId(action.parentAlertId);
        if (parent)
          incidentStartedAt = new Date(parent.occurredAt).toISOString();
      }
      await this.store.close(
        action.parentAlertId,
        now,
        action.kind === 'resolve',
      );
    }
    const reason = this.reasonFor(obs, action, rules);
    const input: NewAlertInput = {
      alertKey: obs.key,
      kind: action.kind,
      severity: action.severity,
      fromStatus: action.from,
      toStatus: action.to,
      reasonCode: reason?.code ?? null,
      reasonText: reason?.text ?? null,
      targets: obs.targets.slice(0, 10),
      targetCount: obs.targetCount,
      occurredAt: now,
      parentAlertId:
        action.kind === 'resolve' || action.kind === 'escalation'
          ? action.parentAlertId
          : null,
      suppressedKeys,
      context: {
        ...(this.contextFor(action, state, now) ?? {}),
        ...(incidentStartedAt ? { incidentStartedAt } : {}),
      },
      flapping: action.kind === 'flapping',
      // 발송 기록은 **발송기가** 판정해서 붙인다 (여기서는 만들지 않는다)
      deliveries: [],
    };
    const rec = await this.store.insert(this.dataSource, input);
    // 판정만 한다 — 실제 요청은 큐가 보내고, mock이면 판정 단계에서 끝난다
    await this.dispatcher.record(rec, state.flapping);
    this.subject.next({ kind: 'created', record: rec });
    return applyCreated(state, action, rec.id, now);
  }

  private contextFor(
    action: Extract<AlertAction, { type: 'create' }>,
    state: KeyState,
    now: number,
  ): NewAlertInput['context'] {
    if (action.kind === 'flapping') {
      return {
        windowMin: this.rulesNow().flapWindowMin,
        transitions: action.flappingTransitions ?? [],
      };
    }
    if (action.to === 'unknown') {
      return {
        unknownFrom: new Date(state.unknownSince ?? now).toISOString(),
        unknownTo: null,
      };
    }
    return null;
  }

  /** 알림은 문장을 새로 쓰지 않는다 — 서버가 만든 대표 사유(`reasons[0]`)를 그대로 쓴다 */
  private reasonFor(
    obs: Observed,
    action: Extract<AlertAction, { type: 'create' }>,
    rules: AlertRules,
  ): Reason | null {
    if (action.kind === 'flapping') {
      return {
        code: 'ALERT_FLAPPING',
        text: `불안정(최근 ${rules.flapWindowMin}분 ${
          (action.flappingTransitions ?? []).length
        }회 변화) · 반복 알림을 멈춥니다`,
        status: action.to === 'ok' ? 'warning' : action.to,
      };
    }
    if (obs.key === 'source:kube' && action.to === 'unknown') {
      const suppressed = KUBE_DEPENDENT_KEYS.length;
      return {
        code: 'ALERT_SOURCE_SUPPRESSED',
        text: `${obs.reason?.text ?? '쿠버네티스 연결을 확인할 수 없습니다'} · 영향 영역 ${suppressed}개`,
        status: 'unknown',
      };
    }
    return obs.reason;
  }

  // --- 관측 -------------------------------------------------------------------

  /** 알림 키 8개의 지금 상태. **여기서 상태를 판단하지 않고 읽기만 한다** */
  private async observe(): Promise<Observed[]> {
    const ov = await this.overview.overview();
    const areas = ov.areas;
    const cost = ov.cost;
    const kube = this.registry.get('kube');

    const fromArea = (
      key: AlertKey,
      info: StatusInfo,
      problems: ProblemItem[] = [],
    ): Observed => ({
      key,
      status: info.status,
      reason: info.reasons[0] ?? null,
      targets: problems.slice(0, 10).map((p) => ({
        kind: p.ref.kind,
        namespace: p.ref.namespace ?? null,
        name: p.ref.name,
      })),
      targetCount: problems.length,
    });

    return [
      fromArea(
        'area:controlPlane',
        areas.controlPlane.status,
        areas.controlPlane.problems,
      ),
      fromArea('area:nodes', areas.nodes.status, areas.nodes.problems),
      fromArea(
        'area:workloads',
        areas.workloads.status,
        areas.workloads.problems,
      ),
      fromArea('area:pods', areas.pods.status, areas.pods.problems),
      fromArea('area:events', areas.events.status, areas.events.problems),
      fromArea('area:db', areas.db.status),
      fromArea('area:cost', cost.status),
      {
        key: 'source:kube',
        status: sourceStatus(kube.state),
        reason: kube.error
          ? {
              code: kube.error.code,
              text: kube.error.message,
              status: 'unknown',
            }
          : null,
        targets: [],
        targetCount: 0,
      },
    ];
  }

  // --- 워밍업 종료 요약 ----------------------------------------------------------

  /**
   * 워밍업이 끝나면 **요약 1건**만 만든다 (기존 문제가 개별 알림으로 쏟아지지 않는다).
   * 같은 정지 구간이 목록의 `gaps[]`에도 들어간다 — **두 곳에 있는 것이 맞다**(디자인 5.4).
   */
  private async finishWarmup(): Promise<void> {
    this.warmupDone = true;
    try {
      const rules = await this.rules();
      const observations = await this.observe();
      const counts = { critical: 0, warning: 0, unknown: 0 };
      for (const o of observations) {
        if (o.status === 'critical') counts.critical += 1;
        else if (o.status === 'warning') counts.warning += 1;
        else if (o.status === 'unknown') counts.unknown += 1;
      }
      const gap = this.gapList[0] ?? null;
      const rec = await this.store.insert(this.dataSource, {
        alertKey: 'system:restart',
        kind: 'restart_summary',
        severity: worstOf(counts),
        fromStatus: null,
        toStatus: null,
        reasonCode: 'ALERT_RESTART_SUMMARY',
        reasonText: `대시보드가 시작됐습니다 · 현재 장애 ${counts.critical}, 주의 ${counts.warning}, 확인 불가 ${counts.unknown}`,
        targets: [],
        targetCount: 0,
        occurredAt: Date.now(),
        parentAlertId: null,
        suppressedKeys: [],
        context: {
          counts,
          warmupSec: rules.warmupSec,
          downtime:
            gap && !gap.unknownPrevious
              ? { from: gap.from, to: gap.to ?? gap.from, minutes: gap.minutes }
              : null,
        },
        flapping: false,
        deliveries: [],
      });
      this.subject.next({ kind: 'created', record: rec });
    } catch (err) {
      this.logger.warn(
        `워밍업 요약 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    void this.tick();
  }

  /** 대시보드 DB가 없으면 "이전 실행 기록 없음"이다 (AC-ALERT10) */
  get unknownPreviousRun(): boolean {
    return !this.hasPreviousRun;
  }
}

function sourceStatus(state: string): Status {
  if (state === 'ok' || state === 'mock') return 'ok';
  if (state === 'not_configured') return 'unknown';
  if (state === 'syncing') return 'ok';
  return 'unknown';
}

function worstOf(counts: {
  critical: number;
  warning: number;
  unknown: number;
}): AlertSeverity {
  if (counts.critical > 0) return 'critical';
  if (counts.warning > 0) return 'warning';
  if (counts.unknown > 0) return 'unknown';
  return 'resolved';
}
