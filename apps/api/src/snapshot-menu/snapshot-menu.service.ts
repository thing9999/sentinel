import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { merge, Observable, Subject, type Subscription } from 'rxjs';
import { AwsSnapshotsService } from '../aws-snapshots/aws-snapshots.service';
import { DATA_SOURCE_MODE } from '../common/data-source';
import {
  TopicSourceProvider,
  type TopicEvent,
  type TopicSource,
} from '../common/extension-points';
import {
  reason,
  statusRank,
  type Reason,
  type Status,
  type StatusInfo,
} from '../common/status';
import type { DataSourceMode } from '../config/env.validation';
import { K8sSnapshotsService } from '../k8s-snapshots/k8s-snapshots.service';

export const MENU_TOPIC = 'snapshot-menu';

interface TabInput {
  label: string;
  state: string;
  status: StatusInfo;
  counts: { critical: number; warning: number; unknown: number };
}

/**
 * 사이드바 "스냅샷" 메뉴 합산 (docs/api/k8s-snapshot.md 12절).
 * AWS·k8s 요약을 서버가 합친다. 기존 `/api/aws-snapshots` 응답·토픽은 바꾸지 않고 이벤트만 구독한다 (AC-K19).
 * 드리프트는 메뉴 상태에 넣지 않는다 (Q2). tabs.k8s.latestDrift 는 탭 표시용.
 */
@Injectable()
@TopicSourceProvider()
export class SnapshotMenuService implements TopicSource, OnModuleDestroy {
  readonly topic = MENU_TOPIC;
  private readonly subject = new Subject<TopicEvent>();
  readonly events$: Observable<TopicEvent> = this.subject.asObservable();
  private readonly sub: Subscription;
  private debounce: NodeJS.Timeout | null = null;
  private pendingSnapshot = false;
  private lastSig = '';
  private changed: { status: Status; at: string } | null = null;

  constructor(
    @Inject(DATA_SOURCE_MODE) private readonly mode: DataSourceMode,
    private readonly aws: AwsSnapshotsService,
    private readonly k8s: K8sSnapshotsService,
  ) {
    this.sub = merge(aws.events$, k8s.events$).subscribe((e) => {
      if (e.event.endsWith('.snapshot')) this.pendingSnapshot = true;
      this.schedule();
    });
  }

  onModuleDestroy(): void {
    this.sub.unsubscribe();
    if (this.debounce) clearTimeout(this.debounce);
  }

  private schedule(): void {
    if (this.debounce) return;
    this.debounce = setTimeout(() => this.flush(), 1000);
    this.debounce.unref();
  }

  /** 테스트용 */
  flushNow(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.flush();
  }

  private flush(): void {
    this.debounce = null;
    const data = this.build();
    const sig = this.signature(data);
    const snap = this.pendingSnapshot;
    this.pendingSnapshot = false;
    if (!snap && sig === this.lastSig) return;
    this.lastSig = sig;
    this.subject.next({
      event: `${MENU_TOPIC}.${snap ? 'snapshot' : 'updated'}`,
      data,
    });
  }

  /** 시각 필드를 뺀 비교용 서명 */
  private signature(data: ReturnType<SnapshotMenuService['build']>): string {
    return JSON.stringify(data, (k, v: unknown) =>
      k === 'updatedAt' || k === 'generatedAt' ? undefined : v,
    );
  }

  snapshot(): Promise<TopicEvent[]> {
    const data = this.build();
    this.lastSig = this.signature(data);
    return Promise.resolve([{ event: `${MENU_TOPIC}.snapshot`, data }]);
  }

  async get() {
    await Promise.all([this.aws.whenReady(), this.k8s.whenReady()]);
    return {
      dataSource: this.mode,
      generatedAt: new Date().toISOString(),
      ...this.build(),
    };
  }

  private track(status: Status, now: string): string {
    if (!this.changed || this.changed.status !== status)
      this.changed = { status, at: now };
    return this.changed.at;
  }

  build() {
    const a = this.aws.buildSummary();
    const k = this.k8s.menuTab();
    const tabs = {
      aws: {
        included: a.root.state !== 'not_configured',
        sourceState: a.root.state,
        status: a.status,
        critical: a.counts.critical,
      },
      k8s: {
        included: k.included,
        sourceState: k.sourceState,
        status: k.status,
        critical: k.critical,
        latestDrift: k.latestDrift,
      },
    };
    const inputs: TabInput[] = [];
    if (tabs.aws.included)
      inputs.push({
        label: 'AWS',
        state: a.root.state,
        status: a.status,
        counts: a.counts,
      });
    if (tabs.k8s.included)
      inputs.push({
        label: 'Kubernetes',
        state: k.sourceState,
        status: k.status,
        counts: {
          critical: k.critical,
          warning: k.warning,
          unknown: k.unknown,
        },
      });
    const now = new Date().toISOString();
    if (!inputs.length) {
      const status: StatusInfo = {
        status: 'unknown',
        reasons: [
          reason(
            'SOURCE_NOT_CONFIGURED',
            '스냅샷 폴더가 설정되지 않았습니다 (AWS_SNAPSHOT_DIR, K8S_SNAPSHOT_DIR)',
            'unknown',
          ),
        ],
        updatedAt: now,
        statusChangedAt: this.track('unknown', now),
        stale: false,
      };
      return { menu: { status, count: 0, showIcon: false }, tabs };
    }
    const reasons: Reason[] = [];
    const sum = (f: (t: TabInput) => number) =>
      inputs.reduce((n, t) => n + f(t), 0);
    const split = (f: (t: TabInput) => number) =>
      inputs.length > 1
        ? ` (${inputs.map((t) => `${t.label} ${f(t)}`).join(' · ')})`
        : '';
    const crit = sum((t) => t.counts.critical);
    const warn = sum((t) => t.counts.warning);
    const unk = sum((t) => t.counts.unknown);
    if (crit)
      reasons.push(
        reason(
          'SNAPSHOTS_COMMIT_BLOCKED',
          `커밋 금지 스냅샷 ${crit}개${split((t) => t.counts.critical)}`,
          'critical',
        ),
      );
    if (warn)
      reasons.push(
        reason(
          'SNAPSHOTS_NEED_REVIEW',
          `주의 스냅샷 ${warn}개${split((t) => t.counts.warning)}`,
          'warning',
        ),
      );
    if (unk)
      reasons.push(
        reason(
          'SNAPSHOTS_UNKNOWN',
          `상태를 알 수 없는 스냅샷 ${unk}개${split((t) => t.counts.unknown)}`,
          'unknown',
        ),
      );
    for (const t of inputs) {
      if (t.state === 'unavailable' || t.state === 'syncing')
        reasons.push(
          reason(
            'SOURCE_UNAVAILABLE',
            `${t.label} 스냅샷 폴더를 찾을 수 없습니다`,
            'unknown',
          ),
        );
      if (t.state === 'stale')
        reasons.push(
          reason(
            'SOURCE_STALE',
            `${t.label} 스냅샷 폴더 확인 실패, 마지막 결과 유지 중`,
            t.status.status,
          ),
        );
    }
    let worst: Status = 'ok';
    for (const t of inputs)
      if (statusRank(t.status.status) > statusRank(worst))
        worst = t.status.status;
    reasons.sort((x, y) => statusRank(y.status) - statusRank(x.status));
    const status: StatusInfo = {
      status: worst,
      reasons,
      updatedAt: now,
      statusChangedAt: this.track(worst, now),
      stale: inputs.some((t) => t.status.stale),
    };
    return { menu: { status, count: crit, showIcon: true }, tabs };
  }
}
