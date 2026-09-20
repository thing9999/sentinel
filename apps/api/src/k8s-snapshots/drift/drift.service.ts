import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject, type Subscription } from 'rxjs';
import { ApiException } from '../../common/api-error';
import { DATA_SOURCE_MODE } from '../../common/data-source';
import type { TopicEvent } from '../../common/extension-points';
import {
  reason,
  StatusChangeTracker,
  type Reason,
  type Status,
  type StatusInfo,
} from '../../common/status';
import type {
  DataSourceMode,
  EnvironmentVariables,
} from '../../config/env.validation';
import type { K8sAnalysis } from '../k8s-analyzer';
import type { K8sRules, K8sScanner } from '../k8s-libs';
import {
  COMMANDS_NOTE,
  FIELDS_MAX,
  LEASE_MAX,
  LEASE_RENEW_SEC,
  LEASE_TTL_MS,
  RESULT_KEEP_MS,
  TOPIC,
} from '../k8s.constants';
import { ClusterObjectSource } from './cluster-object-source';
import { COMPARABLE_KINDS } from './comparable-kinds';
import {
  computeDrift,
  type DriftCounts,
  type DriftResult,
} from './drift-engine';

export type DriftMode = 'auto' | 'on_demand' | 'last_result' | 'none';
export type DriftTrigger =
  | 'cluster_changed'
  | 'file_changed'
  | 'periodic'
  | 'requested'
  | 'source_changed'
  | 'target_changed'
  | 'lease_expired';

export interface DriftBadge {
  status: StatusInfo;
  mode: DriftMode;
  computing: boolean;
  computed: boolean;
  computedAt: string | null;
  lastResultStatus: 'ok' | 'warning' | null;
  counts: DriftCounts | null;
  resultAvailable: boolean;
}

export interface DriftAbility {
  allowed: boolean;
  reasonCode: string | null;
  reasonText: string | null;
}

interface Entry {
  inputKey: string;
  clusterRev: number;
  /** 전체 결과 (필드 diff). 버리면 null */
  result: DriftResult | null;
  summary: {
    status: 'ok' | 'warning';
    counts: DriftCounts;
    computedAt: string;
  } | null;
  /** last_result 에서 전체 결과를 버릴 시각 (Infinity = 버리지 않음, mock 예시 2) */
  fullKeepUntil: number | null;
  failed: boolean;
}

/** 계산할 수 없는 사유 (11.3 "계산 버튼 불가") */
interface Block {
  code: string;
  text: string;
}

/** 파일 내용 기준 입력 키 (파일이 바뀌면 결과가 무효). notes.json 은 빠진다 */
export function driftInputKey(a: K8sAnalysis): string {
  return a.files.map((f) => `${f.path}:${f.version ?? '-'}`).join('|');
}

/**
 * 드리프트 계산 대상·주기·임대·결과 보관 (docs/api/k8s-snapshot.md 10.7~10.9, 13절).
 * - 결과는 메모리에만 (DBA 결정). 로그에는 스냅샷 ID + 코드만 (1.4)
 * - 계산은 동기(메모리) 함수라 한 번에 하나씩 끝난다. computing 은 계산 중에만 true 라 이벤트로 나가지 않는다 (500ms 규칙)
 */
@Injectable()
export class DriftService implements OnModuleDestroy {
  private readonly logger = new Logger(DriftService.name);
  private libs: { rules: K8sRules; scanner: K8sScanner } | null = null;
  private analyses = new Map<string, K8sAnalysis>();
  private readonly entries = new Map<string, Entry>();
  private readonly leases = new Map<string, number>();
  private autoTarget: string | null = null;
  private clusterRev = 0;
  private lastComputeMs = 0;
  private disconnected = false;
  private lastKubeState: string | null = null;
  private displayRoot = 'deploy/k8s-snapshot/snapshots';

  private readonly tracker = new StatusChangeTracker();
  private readonly lastSig = new Map<string, string>();
  private readonly pendingEvents = new Map<string, DriftTrigger>();
  private readonly events = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.events.asObservable();
  private debounce: NodeJS.Timeout | null = null;
  private throttle: NodeJS.Timeout | null = null;
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly sub: Subscription;
  private readonly throttleMs: number;
  private readonly recomputeMs: number;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly source: ClusterObjectSource,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.throttleMs =
      config.get('K8S_DRIFT_THROTTLE_SEC', { infer: true }) * 1000;
    this.recomputeMs =
      config.get('K8S_DRIFT_RECOMPUTE_SEC', { infer: true }) * 1000;
    this.sub = source.changes$.subscribe((kind) => this.onClusterChange(kind));
  }

  onModuleDestroy(): void {
    this.sub.unsubscribe();
    for (const t of this.timers) clearInterval(t);
    if (this.debounce) clearTimeout(this.debounce);
    if (this.throttle) clearTimeout(this.throttle);
  }

  /** 스냅샷 서비스가 lib 를 불러온 뒤 한 번 부른다 (실패면 null → DRIFT_RULES_UNAVAILABLE) */
  start(
    libs: { rules: K8sRules; scanner: K8sScanner } | null,
    displayRoot: string | null,
  ): void {
    this.libs = libs;
    if (displayRoot) this.displayRoot = displayRoot.replace(/\/+$/, '');
    if (this.timers.length) return;
    const periodic = setInterval(
      () => this.recomputeActive('periodic'),
      this.recomputeMs,
    );
    periodic.unref();
    const sweep = setInterval(() => this.sweep(), 5_000);
    sweep.unref();
    this.timers.push(periodic, sweep);
  }

  // ------------------------------------------------------------------ 입력

  /**
   * 스냅샷 목록 갱신 (주기 확인·쓰기 직후). 파일이 바뀐 스냅샷은 결과를 무효로 하고,
   * 자동 대상·임대 중이면 바로 다시 계산한다 (AC-K37).
   */
  sync(list: K8sAnalysis[]): void {
    const next = new Map(list.map((a) => [a.id, a]));
    for (const id of [...this.entries.keys()])
      if (!next.has(id)) {
        this.entries.delete(id);
        this.leases.delete(id);
        this.lastSig.delete(id);
        this.tracker.forget(id);
      }
    for (const id of [...this.leases.keys()])
      if (!next.has(id)) this.leases.delete(id);
    this.analyses = next;
    const recompute: string[] = [];
    for (const [id, a] of next) {
      const e = this.entries.get(id);
      if (!e || e.inputKey === driftInputKey(a)) continue;
      if (this.isActive(id)) recompute.push(id);
      else {
        // 원본이 달라져 지난 결과는 의미 없음 (10.9 표)
        this.entries.delete(id);
        this.queue(id, 'file_changed');
      }
    }
    const targetChanged = this.updateTarget();
    for (const id of recompute)
      if (id !== this.autoTarget || !targetChanged)
        this.computeSafe(id, 'file_changed');
    this.checkBadges('file_changed');
  }

  /** mock k8s-snapshots 시나리오 cluster-disconnected */
  setDisconnected(v: boolean): void {
    if (this.disconnected === v) return;
    this.disconnected = v;
    if (!v) this.recomputeActive('source_changed');
    this.checkBadges('source_changed');
  }

  /** mock reset: 결과·임대를 모두 비운다 */
  clear(): void {
    this.entries.clear();
    this.leases.clear();
    this.autoTarget = null;
    this.lastSig.clear();
    this.tracker.clear();
  }

  /** mock 예시 2: 한 번 계산해 "지난 결과"로 둔다 (reset 까지 전체 결과 유지, 14.2) */
  seedLastResult(id: string): void {
    if (!this.analyses.has(id) || id === this.autoTarget) return;
    if (this.computeSafe(id, 'requested', true)) {
      const e = this.entries.get(id)!;
      e.fullKeepUntil = Number.POSITIVE_INFINITY;
    }
    this.checkBadges('requested');
  }

  // ------------------------------------------------------------------ 조회

  autoTargetId(): string | null {
    return this.autoTarget;
  }

  dashboardCluster() {
    const s = this.source.state();
    const state = this.disconnected ? 'unavailable' : s.source;
    return {
      state,
      id: this.disconnected ? null : s.clusterId,
      name: s.name,
      context: s.context,
      serverVersion: s.serverVersion,
    };
  }

  relation(a: K8sAnalysis): 'same' | 'other' | 'unknown' {
    const s = this.source.state();
    const mine = a.cluster?.id ?? null;
    if (!mine || !s.clusterId || this.disconnected) return 'unknown';
    return mine === s.clusterId ? 'same' : 'other';
  }

  ability(a: K8sAnalysis): DriftAbility {
    const b = this.block(a);
    return b
      ? { allowed: false, reasonCode: b.code, reasonText: b.text }
      : { allowed: true, reasonCode: null, reasonText: null };
  }

  badge(a: K8sAnalysis): DriftBadge {
    const now = new Date().toISOString();
    const stale = this.source.state().source === 'stale' && !this.disconnected;
    const e = this.entries.get(a.id);
    const b = this.block(a);
    const mode = this.modeOf(a.id, e);
    const summary = e?.summary ?? null;
    const resultAvailable = this.resultAvailable(a.id, e);
    let reasons: Reason[];
    let status: Status;
    if (b) {
      status = 'unknown';
      reasons = [reason(b.code, b.text, 'unknown')];
    } else if ((mode === 'auto' || mode === 'on_demand') && e?.failed) {
      status = 'unknown';
      reasons = [
        reason(
          'DRIFT_FAILED',
          '드리프트 계산 실패 (다시 시도하세요)',
          'unknown',
        ),
      ];
    } else if ((mode === 'auto' || mode === 'on_demand') && summary) {
      status = summary.status;
      reasons = [this.resultReason(summary.counts)];
    } else {
      status = 'unknown';
      reasons = [reason('DRIFT_NOT_COMPUTED', '계산 안 함', 'unknown')];
    }
    const showSummary = !b && summary !== null;
    return {
      status: {
        status,
        reasons,
        updatedAt: summary?.computedAt ?? now,
        statusChangedAt: this.tracker.track(
          a.id,
          status,
          summary?.computedAt ?? now,
        ),
        stale,
      },
      mode: b ? 'none' : mode,
      computing: false,
      computed: showSummary,
      computedAt: showSummary ? summary.computedAt : null,
      lastResultStatus: showSummary ? summary.status : null,
      counts: showSummary ? summary.counts : null,
      resultAvailable: !b && resultAvailable,
    };
  }

  /**
   * 3D 구성 그래프 겹쳐 보기 (docs/api/snapshot-3d.md 7절).
   * **읽기만 한다** — 계산·임대·이벤트 부작용 없음. 결과가 없으면 byKey·added 가 비어 있고 usable=false.
   * 필드 값은 담지 않는다(건수·구분만).
   */
  graphDrift(a: K8sAnalysis): {
    usable: boolean;
    reasonCode: string | null;
    reasonText: string | null;
    badge: DriftBadge;
    computedAt: string | null;
    addedCheck: 'checked' | 'skipped_scope_unknown' | null;
    stale: boolean;
    actions: { computeDrift: DriftAbility };
    byKey: Map<
      string,
      {
        change: 'same' | 'changed' | 'deleted' | 'uncomparable';
        fieldCount: number;
        hidden: { default: number; managed: number };
        reasonCode: string | null;
        reasonText: string | null;
      }
    >;
    added: {
      key: string;
      apiGroup: string;
      apiVersion: string;
      kind: string;
      namespace: string | null;
      name: string;
      replicas: number | null;
      containers: number;
    }[];
  } {
    const badge = this.badge(a);
    const ability = this.ability(a);
    const e = this.entries.get(a.id);
    const usable =
      !this.block(a) &&
      badge.resultAvailable &&
      !!e?.result &&
      (badge.mode === 'auto' ||
        badge.mode === 'on_demand' ||
        badge.mode === 'last_result');
    const base = {
      badge,
      computedAt: badge.computedAt,
      stale: badge.status.stale,
      actions: { computeDrift: ability },
    };
    if (!usable || !e?.result) {
      const r = badge.status.reasons[0];
      return {
        ...base,
        usable: false,
        reasonCode: r?.code ?? 'DRIFT_NOT_COMPUTED',
        reasonText: r?.text ?? '계산 안 함',
        addedCheck: null,
        byKey: new Map(),
        added: [],
      };
    }
    const result = e.result;
    const byKey = new Map<
      string,
      {
        change: 'same' | 'changed' | 'deleted' | 'uncomparable';
        fieldCount: number;
        hidden: { default: number; managed: number };
        reasonCode: string | null;
        reasonText: string | null;
      }
    >();
    const byGK = new Map(
      COMPARABLE_KINDS.map((k) => [`${k.apiGroup}/${k.kind}`, k]),
    );
    const resByKey = new Map(result.resources.map((r) => [r.key, r]));
    for (const d of a.docs) {
      const r = resByKey.get(d.key);
      if (r && r.change !== 'added') {
        byKey.set(d.key, {
          change: r.change,
          fieldCount: r.counts.changed,
          hidden: { default: r.counts.default, managed: r.counts.managed },
          reasonCode: null,
          reasonText: null,
        });
        continue;
      }
      const ck = byGK.get(`${d.identity.apiGroup}/${d.identity.kind}`);
      const none = { default: 0, managed: 0 };
      if (!ck)
        byKey.set(d.key, {
          change: 'uncomparable',
          fieldCount: 0,
          hidden: none,
          reasonCode: 'NOT_IN_RBAC',
          reasonText: '대시보드 권한 밖이라 비교하지 않음',
        });
      else if (this.source.kindState(ck.id) === 'forbidden')
        byKey.set(d.key, {
          change: 'uncomparable',
          fieldCount: 0,
          hidden: none,
          reasonCode: 'FORBIDDEN',
          reasonText: '비교 불가 (권한 거부)',
        });
      else if (d.identity.apiVersion !== ck.apiVersion)
        byKey.set(d.key, {
          change: 'uncomparable',
          fieldCount: 0,
          hidden: none,
          reasonCode: 'API_VERSION_MISMATCH',
          reasonText: `API 버전이 달라 비교하지 않음 (${d.identity.apiVersion})`,
        });
      else
        byKey.set(d.key, {
          change: 'same',
          fieldCount: 0,
          hidden: none,
          reasonCode: null,
          reasonText: null,
        });
    }
    return {
      ...base,
      usable: true,
      reasonCode: null,
      reasonText: null,
      addedCheck: result.addedCheck,
      byKey,
      added: result.resources
        .filter((r) => r.change === 'added')
        .map((r) => ({
          key: r.key,
          apiGroup: r.apiGroup,
          apiVersion: r.apiVersion,
          kind: r.kind,
          namespace: r.namespace,
          name: r.name,
          replicas: r.summary?.replicas ?? null,
          containers: r.summary?.images.length ?? 0,
        })),
    };
  }

  /** 상세 파일 목록의 files[].drift */
  fileDrift(
    a: K8sAnalysis,
  ): Map<
    string,
    'same' | 'changed' | 'deleted' | 'uncomparable' | 'skipped'
  > | null {
    const e = this.entries.get(a.id);
    if (this.block(a) || !e?.result || !this.resultAvailable(a.id, e))
      return null;
    const out = new Map<
      string,
      'same' | 'changed' | 'deleted' | 'uncomparable' | 'skipped'
    >();
    const rank = {
      skipped: 0,
      uncomparable: 1,
      same: 2,
      deleted: 3,
      changed: 4,
    } as const;
    const put = (p: string, v: keyof typeof rank) => {
      const cur = out.get(p);
      if (!cur || rank[v] > rank[cur]) out.set(p, v);
    };
    const byKey = new Map(e.result.resources.map((r) => [r.key, r]));
    const comparable = new Set(
      COMPARABLE_KINDS.map((k) => `${k.apiGroup}/${k.kind}/${k.apiVersion}`),
    );
    const forbidden = new Set(
      COMPARABLE_KINDS.filter(
        (k) => this.source.kindState(k.id) === 'forbidden',
      ).map((k) => k.kind),
    );
    for (const d of a.docs) {
      const r = byKey.get(d.key);
      if (r && (r.change === 'changed' || r.change === 'deleted'))
        put(d.path, r.change);
      else if (
        comparable.has(
          `${d.identity.apiGroup}/${d.identity.kind}/${d.identity.apiVersion}`,
        ) &&
        !forbidden.has(d.identity.kind)
      )
        put(d.path, 'same');
      else put(d.path, 'uncomparable');
    }
    for (const u of a.unparsable) put(u.path, 'skipped');
    return out;
  }

  /** GET /:id/drift (계산하지 않음) */
  view(a: K8sAnalysis) {
    const e = this.entries.get(a.id);
    const badge = this.badge(a);
    const full = badge.resultAvailable && e?.result ? e.result : null;
    const s = this.dashboardCluster();
    const leaseExp = this.leases.get(a.id);
    return {
      snapshotId: a.id,
      drift: badge,
      lease:
        leaseExp && a.id !== this.autoTarget
          ? {
              expiresAt: new Date(leaseExp).toISOString(),
              renewAfterSec: LEASE_RENEW_SEC,
            }
          : null,
      target: {
        clusterId: s.id,
        context: s.context,
        name: s.name,
        serverVersion: s.serverVersion,
        sourceState: s.state,
      },
      snapshotCluster: a.cluster,
      rulesVersion:
        a.cleanupVersion ?? this.libs?.rules.CLEANUP_RULES_VERSION ?? null,
      addedCheck: full ? full.addedCheck : null,
      uncomparable: full ? full.uncomparable : [],
      unparsable: full ? full.unparsable : [],
      resources: full ? full.resources : [],
      commandsNote: COMMANDS_NOTE,
      notices: full ? full.notices : [],
    };
  }

  /** POST /:id/drift — 계산 요청 + 임대 (10.8) */
  request(a: K8sAnalysis, force: boolean) {
    const b = this.block(a);
    if (b)
      throw new ApiException(
        HttpStatus.CONFLICT,
        'K8S_DRIFT_UNAVAILABLE',
        `드리프트를 계산할 수 없습니다: ${b.text}`,
        { reasonCode: b.code, reasonText: b.text },
      );
    if (a.id !== this.autoTarget) this.lease(a.id);
    const e = this.entries.get(a.id);
    const needs =
      force ||
      !e?.result ||
      e.failed ||
      e.inputKey !== driftInputKey(a) ||
      e.clusterRev !== this.clusterRev;
    if (needs) this.computeSafe(a.id, 'requested');
    else if (e && e.fullKeepUntil !== Number.POSITIVE_INFINITY)
      e.fullKeepUntil = null;
    this.checkBadges('requested');
    return this.view(a);
  }

  /** 저장 직후: 재계산 예약 여부 (7.3 driftRecompute) */
  willRecompute(id: string): boolean {
    return this.isActive(id);
  }

  // ------------------------------------------------------------------ 내부

  private resultReason(c: DriftCounts): Reason {
    const total = c.changed + c.deleted + c.added;
    if (total === 0)
      return reason(
        'DRIFT_NO_DIFF',
        `차이 없음 (비교 ${c.compared}개${c.uncomparable ? `, 비교 불가 ${c.uncomparable}개` : ''})`,
        'ok',
      );
    const parts = [
      c.changed ? `변경 ${c.changed}` : null,
      c.deleted ? `삭제 ${c.deleted}` : null,
      c.added ? `추가 ${c.added}` : null,
    ].filter(Boolean);
    return reason(
      'DRIFT_DIFF',
      `차이 ${total}건 (${parts.join(' · ')})`,
      'warning',
    );
  }

  private isActive(id: string): boolean {
    if (id === this.autoTarget) return true;
    const exp = this.leases.get(id);
    return exp !== undefined && exp > Date.now();
  }

  private modeOf(id: string, e: Entry | undefined): DriftMode {
    if (id === this.autoTarget) return 'auto';
    if (this.isActive(id)) return 'on_demand';
    if (e?.summary) return 'last_result';
    return 'none';
  }

  private resultAvailable(id: string, e: Entry | undefined): boolean {
    if (!e?.result) return false;
    if (this.isActive(id)) return true;
    return e.fullKeepUntil !== null && e.fullKeepUntil > Date.now();
  }

  private block(a: K8sAnalysis): Block | null {
    if (!this.libs)
      return {
        code: 'DRIFT_RULES_UNAVAILABLE',
        text: '드리프트 규칙을 불러올 수 없음',
      };
    const s = this.source.state();
    if (
      this.disconnected ||
      s.source === 'not_configured' ||
      s.source === 'unavailable'
    )
      return { code: 'CLUSTER_NOT_CONNECTED', text: '클러스터 연결 없음' };
    if (s.source === 'syncing' || !s.synced)
      return { code: 'CLUSTER_SYNCING', text: '클러스터 동기화 중' };
    if (!s.clusterId)
      return {
        code: 'DASHBOARD_CLUSTER_UNKNOWN',
        text: s.namespacesForbidden
          ? '대시보드 클러스터를 확인할 수 없음 (namespaces 조회 불가)'
          : '대시보드 클러스터를 확인할 수 없음',
      };
    // 메타데이터가 아직 없는 진행 중 스냅샷은 "확인 전" (클러스터 ID 를 아직 알 수 없음)
    if (a.inProgress)
      return { code: 'SNAPSHOT_FILES_PENDING', text: '스냅샷 파일 확인 전' };
    const mine = a.cluster?.id ?? null;
    if (
      !mine ||
      a.metadata.state === 'corrupt' ||
      a.metadata.state === 'missing'
    )
      return { code: 'CLUSTER_ID_MISSING', text: '클러스터를 확인할 수 없음' };
    if (mine !== s.clusterId) {
      const n = a.cluster?.name ?? a.cluster?.context ?? null;
      return {
        code: 'CLUSTER_MISMATCH',
        text: `다른 클러스터의 스냅샷${n ? ` (${n})` : ''}`,
      };
    }
    if (a.status === 'unknown')
      return { code: 'SNAPSHOT_FILES_PENDING', text: '스냅샷 파일 확인 전' };
    const comparable = new Set(
      COMPARABLE_KINDS.map((k) => `${k.apiGroup}/${k.kind}/${k.apiVersion}`),
    );
    const forbidden = new Set(
      COMPARABLE_KINDS.filter(
        (k) => this.source.kindState(k.id) === 'forbidden',
      ).map((k) => k.kind),
    );
    const n = a.docs.filter(
      (d) =>
        comparable.has(
          `${d.identity.apiGroup}/${d.identity.kind}/${d.identity.apiVersion}`,
        ) && !forbidden.has(d.identity.kind),
    ).length;
    if (n === 0)
      return {
        code: 'NO_COMPARABLE_RESOURCES',
        text: '비교할 수 있는 리소스 없음',
      };
    return null;
  }

  private lease(id: string): void {
    this.leases.set(id, Date.now() + LEASE_TTL_MS);
    const live = [...this.leases.entries()].filter(
      ([x]) => x !== this.autoTarget,
    );
    if (live.length > LEASE_MAX) {
      live.sort((x, y) => x[1] - y[1]);
      for (const [x] of live.slice(0, live.length - LEASE_MAX))
        this.endLease(x);
    }
  }

  private endLease(id: string): void {
    this.leases.delete(id);
    const e = this.entries.get(id);
    if (e && e.fullKeepUntil !== Number.POSITIVE_INFINITY)
      e.fullKeepUntil = Date.now() + RESULT_KEEP_MS;
    this.queue(id, 'lease_expired');
  }

  /** 자동 대상 다시 정하기. 바뀌었으면 새 대상을 바로 계산 */
  private updateTarget(): boolean {
    const s = this.source.state();
    let next: string | null = null;
    if (s.clusterId && !this.disconnected)
      for (const a of this.analyses.values())
        if (
          a.cluster?.id === s.clusterId &&
          a.metadata.state !== 'missing' &&
          a.metadata.state !== 'corrupt'
        )
          if (next === null || a.id > next) next = a.id;
    if (next === this.autoTarget) return false;
    const prev = this.autoTarget;
    this.autoTarget = next;
    if (prev) {
      const e = this.entries.get(prev);
      if (e && !this.leases.has(prev))
        e.fullKeepUntil = Date.now() + RESULT_KEEP_MS;
      this.queue(prev, 'target_changed');
    }
    if (next) {
      this.leases.delete(next);
      this.computeSafe(next, 'target_changed');
    }
    return true;
  }

  /** 계산 (막혔으면 계산하지 않음). 성공하면 true */
  private computeSafe(
    id: string,
    trigger: DriftTrigger,
    seed = false,
  ): boolean {
    const a = this.analyses.get(id);
    if (!a || !this.libs || this.block(a)) return false;
    if (!seed && !this.isActive(id) && trigger !== 'requested') return false;
    const prev = this.entries.get(id);
    try {
      const cluster = new Map(
        COMPARABLE_KINDS.map((k) => [k.id, this.source.list(k.id)]),
      );
      const forbidden = new Set(
        COMPARABLE_KINDS.filter(
          (k) => this.source.kindState(k.id) === 'forbidden',
        ).map((k) => k.id),
      );
      const fileDocCount = new Map(
        a.files.map((f) => [f.path, f.documents.length || 1]),
      );
      const res = computeDrift(
        {
          snapshotId: a.id,
          docs: a.docs,
          unparsable: a.unparsable,
          metaRaw: a.metaRaw,
          rulesVersion: a.cleanupVersion,
          fileDocCount,
          cluster,
          forbidden,
          displayRoot: this.displayRoot,
          maxFields: FIELDS_MAX,
        },
        this.libs,
      );
      const diff = res.counts.changed + res.counts.deleted + res.counts.added;
      this.entries.set(id, {
        inputKey: driftInputKey(a),
        clusterRev: this.clusterRev,
        result: res,
        summary: {
          status: diff > 0 ? 'warning' : 'ok',
          counts: res.counts,
          computedAt:
            prev?.result &&
            prev.result.signature === res.signature &&
            prev.summary &&
            prev.inputKey === driftInputKey(a)
              ? prev.summary.computedAt
              : new Date().toISOString(),
        },
        fullKeepUntil:
          prev?.fullKeepUntil === Number.POSITIVE_INFINITY
            ? Number.POSITIVE_INFINITY
            : null,
        failed: false,
      });
      if (
        prev?.summary &&
        prev.result?.signature === res.signature &&
        trigger === 'periodic'
      ) {
        // 5분 주기 재계산 완료도 알린다 (계산 시각 갱신)
        this.entries.get(id)!.summary!.computedAt = new Date().toISOString();
      }
      this.lastComputeMs = Date.now();
      this.queue(id, trigger);
      return true;
    } catch (err) {
      this.logger.warn(
        `드리프트 계산 실패 id=${id} code=${err instanceof Error ? err.name : 'ERROR'}`,
      );
      this.entries.set(id, {
        inputKey: driftInputKey(a),
        clusterRev: this.clusterRev,
        result: prev?.result ?? null,
        summary: prev?.summary ?? null,
        fullKeepUntil: prev?.fullKeepUntil ?? null,
        failed: true,
      });
      this.queue(id, trigger);
      return false;
    }
  }

  private recomputeActive(trigger: DriftTrigger): void {
    const st = this.source.state().source;
    if (st === 'stale') {
      this.checkBadges(trigger);
      return;
    }
    const ids = new Set<string>();
    if (this.autoTarget) ids.add(this.autoTarget);
    for (const id of this.leases.keys()) if (this.isActive(id)) ids.add(id);
    for (const id of ids) this.computeSafe(id, trigger);
    this.checkBadges(trigger);
  }

  private onClusterChange(kind: string): void {
    if (kind === 'source') {
      const st = this.source.state().source;
      const prev = this.lastKubeState;
      this.lastKubeState = st;
      this.clusterRev++;
      this.updateTarget();
      if (prev !== st && (st === 'ok' || st === 'mock'))
        this.recomputeActive('source_changed');
      else this.checkBadges('source_changed');
      return;
    }
    this.clusterRev++;
    if (kind === 'all') {
      // mock 시나리오 전환·전체 재구성: 조절 없이 바로
      this.updateTarget();
      this.recomputeActive('cluster_changed');
      return;
    }
    if (kind === 'namespaces') this.updateTarget();
    if (this.throttle) return;
    const wait = Math.max(0, this.lastComputeMs + this.throttleMs - Date.now());
    this.throttle = setTimeout(() => {
      this.throttle = null;
      this.recomputeActive('cluster_changed');
    }, wait);
    this.throttle.unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, exp] of [...this.leases])
      if (exp <= now && id !== this.autoTarget) this.endLease(id);
    for (const [id, e] of this.entries)
      if (
        !this.isActive(id) &&
        e.result &&
        e.fullKeepUntil !== null &&
        e.fullKeepUntil <= now
      ) {
        e.result = null;
        e.fullKeepUntil = null;
        this.queue(id, 'lease_expired');
      }
    this.checkBadges('lease_expired');
  }

  private queue(id: string, trigger: DriftTrigger): void {
    if (!this.pendingEvents.has(id)) this.pendingEvents.set(id, trigger);
  }

  /** 배지가 바뀐 스냅샷만 이벤트로 (1초 debounce) */
  private checkBadges(trigger: DriftTrigger): void {
    for (const a of this.analyses.values()) {
      const b = this.badge(a);
      const sig = JSON.stringify([
        b.status.status,
        b.status.reasons.map((r) => r.text),
        b.status.stale,
        b.mode,
        b.counts,
        b.computedAt,
        b.resultAvailable,
      ]);
      if (this.lastSig.get(a.id) === sig) {
        this.pendingEvents.delete(a.id);
        continue;
      }
      this.lastSig.set(a.id, sig);
      if (!this.pendingEvents.has(a.id)) this.pendingEvents.set(a.id, trigger);
    }
    if (!this.pendingEvents.size || this.debounce) return;
    this.debounce = setTimeout(() => this.flush(), 1000);
    this.debounce.unref();
  }

  private flush(): void {
    this.debounce = null;
    const list = [...this.pendingEvents];
    this.pendingEvents.clear();
    for (const [id, trigger] of list) {
      const a = this.analyses.get(id);
      if (!a) continue;
      this.events.next({
        event: `${TOPIC}.drift`,
        data: {
          snapshotId: id,
          trigger,
          drift: this.badge(a),
          autoTargetId: this.autoTarget,
        },
      });
    }
  }

  /** 요약·메뉴의 latestDrift */
  latest(): { snapshotId: string; drift: DriftBadge } | null {
    if (!this.autoTarget) return null;
    const a = this.analyses.get(this.autoTarget);
    return a ? { snapshotId: a.id, drift: this.badge(a) } : null;
  }

  /** 테스트용: 대기 중인 이벤트를 바로 보낸다 */
  flushNow(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.flush();
  }

  get dataSource(): DataSourceMode {
    return this.mode;
  }
}
