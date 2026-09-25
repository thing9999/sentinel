/**
 * 알림 이력 저장 (대시보드 자체 DB → 없으면 메모리 최근 N건).
 * 스키마·보관 정책은 DBA 설계에 따른다 (docs/db/schema.md 2.8~2.11, docs/reports/alerts/dba.md).
 *
 * 저장 계층이 지키는 것:
 * - **본문 문자열을 저장하지 않는다.** 구성요소(키·사유 코드·대상·시각·context)로만 저장한다.
 *   그래서 로그 줄이 들어올 자리가 구조적으로 없다 (계약 0.3).
 * - `closed_at` 규칙: 종결형(resolve·restart_summary·test)은 **만들 때** 채우고,
 *   격상은 **새 행 + 이전 행 닫기**, 완화는 **새 행을 만들지 않는다**.
 * - 상태 머신은 **값이 바뀐 키만** upsert한다 (15초마다 8행을 쓰지 않는다).
 * - jsonb 배열은 상한에서 자른다 (`flapTransitionsMax`·`lastNotifiedTargetsMax`).
 * - mock 초기화는 `data_source='mock'` 행만 지운다.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../database/generated/prisma/client';
import type { Status } from '../common/status';
import type { KeyState } from './alert-rules';
import {
  DB_DELIVERY_STATUSES,
  type AlertContext,
  type AlertKey,
  type AlertKind,
  type AlertRecord,
  type AlertSeverity,
  type DispatchRecord,
  type DispatchState,
} from './alerts.types';

export type Persistence = 'database' | 'memory';

export interface AlertFilter {
  from: number | null;
  to: number | null;
  severity: AlertSeverity[] | null;
  area: string[] | null;
  key: string[] | null;
  kind: AlertKind[] | null;
  includeResolved: boolean;
  unreadOnly: boolean;
  limit: number;
  offset: number;
}

export interface AlertPage {
  items: AlertRecord[];
  /** 필터 후 전체 수 */
  filteredTotal: number;
  /** 이 data_source의 전체 수 */
  total: number;
  /** 기간만 적용한 기준 개수 (필터 컨트롤 옆 숫자) */
  facets: {
    severity: Record<string, number>;
    area: Record<string, number>;
  };
}

export interface NewAlertInput {
  alertKey: AlertKey;
  kind: AlertKind;
  severity: AlertSeverity;
  fromStatus: Status | null;
  toStatus: Status | null;
  reasonCode: string | null;
  reasonText: string | null;
  targets: { kind: string; namespace: string | null; name: string }[];
  targetCount: number;
  occurredAt: number;
  parentAlertId: string | null;
  suppressedKeys: string[];
  context: AlertContext | null;
  flapping: boolean;
  deliveries: DispatchRecord[];
}

const AREA_PREFIX: Record<string, string> = {
  'area:controlPlane': 'controlPlane',
  'area:nodes': 'nodes',
  'area:workloads': 'workloads',
  'area:pods': 'pods',
  'area:events': 'events',
  'area:db': 'db',
  'area:cost': 'cost',
  'source:kube': 'source',
  'system:restart': 'system',
  'system:test': 'system',
};

function areaOf(key: string): string {
  return AREA_PREFIX[key] ?? 'system';
}

function terminal(kind: AlertKind): boolean {
  return kind === 'resolve' || kind === 'restart_summary' || kind === 'test';
}

@Injectable()
export class AlertStore {
  private readonly logger = new Logger(AlertStore.name);
  /** DB가 없을 때 쓰는 메모리 이력 (최신이 뒤). 상한은 `alerts.memoryFallbackMax` */
  private memory: AlertRecord[] = [];
  private memoryKeyStates = new Map<string, KeyState>();
  private memoryMax = 200;

  constructor(private readonly prisma: PrismaService) {}

  setMemoryMax(n: number): void {
    this.memoryMax = Math.max(1, n);
    this.trim();
  }

  get persistence(): Persistence {
    return this.prisma.isConnected ? 'database' : 'memory';
  }

  private get db(): boolean {
    return this.prisma.isConnected;
  }

  // --- 쓰기 -------------------------------------------------------------------

  async insert(
    dataSource: 'mock' | 'live',
    input: NewAlertInput,
  ): Promise<AlertRecord> {
    const now = Date.now();
    const rec: AlertRecord = {
      id: randomUUID(),
      dataSource,
      alertKey: input.alertKey,
      kind: input.kind,
      severity: input.severity,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      targets: input.targets,
      targetCount: input.targetCount,
      occurredAt: input.occurredAt,
      lastEventAt: input.occurredAt,
      resolvedAt: input.kind === 'resolve' ? input.occurredAt : null,
      // 종결형은 **만들 때** 닫는다 (DBA `closed_at` 규칙)
      closedAt: terminal(input.kind) ? input.occurredAt : null,
      parentAlertId: input.parentAlertId,
      repeatCount: 1,
      flapping: input.flapping,
      suppressedKeys: input.suppressedKeys,
      acknowledgedAt: null,
      context: input.context,
      createdAt: now,
      deliveries: input.deliveries,
    };
    this.memory.push(rec);
    this.trim();
    if (this.db) {
      try {
        await this.prisma.alert.create({
          data: {
            id: rec.id,
            dataSource,
            alertKey: rec.alertKey,
            kind: rec.kind,
            severity: rec.severity,
            fromStatus: rec.fromStatus === 'ok' ? 'ok' : rec.fromStatus,
            toStatus: rec.toStatus,
            reasonCode: rec.reasonCode,
            reasonText: rec.reasonText,
            targets: rec.targets,
            targetCount: rec.targetCount,
            occurredAt: new Date(rec.occurredAt),
            lastEventAt: new Date(rec.lastEventAt),
            resolvedAt: rec.resolvedAt ? new Date(rec.resolvedAt) : null,
            closedAt: rec.closedAt ? new Date(rec.closedAt) : null,
            parentAlertId: rec.parentAlertId,
            repeatCount: rec.repeatCount,
            flapping: rec.flapping,
            suppressedKeys: rec.suppressedKeys,
            context: (rec.context ?? undefined) as
              Prisma.InputJsonValue | undefined,
            deliveries: {
              create: rec.deliveries
                // DB enum에 없는 값은 저장하지 않는다 (DBA 마이그레이션 대기 중)
                .filter((d) => DB_DELIVERY_STATUSES.includes(d.state))
                .map((d) => ({
                  channel: 'discord' as const,
                  status: d.state as never,
                  attempts: d.attempts,
                  lastAttemptAt: d.at ? new Date(d.at) : null,
                  nextAttemptAt: d.nextRetryAt ? new Date(d.nextRetryAt) : null,
                  responseCode: d.responseCode,
                  errorMessage: d.detail,
                })),
            },
          },
        });
      } catch (err) {
        this.warn('알림 저장 실패', err);
      }
    }
    return rec;
  }

  /** 억제 창 합산 (`repeatCount` 증가). 새 행을 만들지 않는다 */
  async merge(
    id: string,
    repeatCount: number,
    at: number,
  ): Promise<AlertRecord | null> {
    const rec = this.memory.find((a) => a.id === id);
    if (rec) {
      rec.repeatCount = repeatCount;
      rec.lastEventAt = at;
    }
    if (this.db) {
      try {
        await this.prisma.alert.update({
          where: { id },
          data: { repeatCount, lastEventAt: new Date(at) },
        });
      } catch (err) {
        this.warn('알림 합산 실패', err);
      }
    }
    return rec ?? (this.db ? await this.byId(id) : null);
  }

  /** 완화 (critical → warning). **새 행을 만들지 않는다** */
  async mitigate(
    id: string,
    severity: AlertSeverity,
    toStatus: Status,
    entry: { at: string; from: Status; to: Status },
  ): Promise<AlertRecord | null> {
    const rec = this.memory.find((a) => a.id === id);
    const at = Date.parse(entry.at);
    if (rec) {
      rec.severity = severity;
      rec.toStatus = toStatus;
      rec.lastEventAt = at;
      const list = rec.context?.mitigations ?? [];
      rec.context = { ...(rec.context ?? {}), mitigations: [...list, entry] };
    }
    if (this.db) {
      try {
        const row = await this.prisma.alert.findUnique({ where: { id } });
        const ctx = (row?.context ?? {}) as AlertContext;
        const list = Array.isArray(ctx.mitigations) ? ctx.mitigations : [];
        await this.prisma.alert.update({
          where: { id },
          data: {
            severity,
            toStatus,
            lastEventAt: new Date(at),
            context: {
              ...ctx,
              mitigations: [...list, entry],
            } as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        this.warn('알림 완화 기록 실패', err);
      }
    }
    return rec ?? (this.db ? await this.byId(id) : null);
  }

  /** 진행 중 알림을 닫는다 (해제·격상 대체). `resolvedAt`은 해제일 때만 */
  async close(id: string, at: number, resolved: boolean): Promise<void> {
    const rec = this.memory.find((a) => a.id === id);
    if (rec) {
      rec.closedAt = at;
      if (resolved) rec.resolvedAt = at;
    }
    if (this.db) {
      try {
        await this.prisma.alert.update({
          where: { id },
          data: {
            closedAt: new Date(at),
            ...(resolved ? { resolvedAt: new Date(at) } : {}),
          },
        });
      } catch (err) {
        this.warn('알림 닫기 실패', err);
      }
    }
  }

  /** 확인(읽음). `ids`가 null이면 전체 */
  async markRead(
    dataSource: 'mock' | 'live',
    ids: string[] | null,
    at: number,
  ): Promise<number> {
    let updated = 0;
    for (const rec of this.memory) {
      if (rec.dataSource !== dataSource) continue;
      if (ids && !ids.includes(rec.id)) continue;
      if (rec.acknowledgedAt !== null) continue;
      rec.acknowledgedAt = at;
      updated += 1;
    }
    if (this.db) {
      try {
        const res = await this.prisma.alert.updateMany({
          where: {
            dataSource,
            acknowledgedAt: null,
            ...(ids ? { id: { in: ids } } : {}),
          },
          data: { acknowledgedAt: new Date(at) },
        });
        updated = res.count;
      } catch (err) {
        this.warn('확인 처리 실패', err);
      }
    }
    return updated;
  }

  // --- 발송 기록 ----------------------------------------------------------------

  /**
   * 채널별 발송 기록 갱신 (`alert_deliveries`는 `(alert_id, channel)` 유니크).
   * `skipped_*`는 **실패가 아니라 "보내지 않기로 한 이유"**다 — 그대로 남긴다.
   */
  async upsertDelivery(
    alertId: string,
    patch: Partial<DispatchRecord> & { state: DispatchState },
  ): Promise<DispatchRecord | null> {
    const rec = this.memory.find((a) => a.id === alertId);
    let next: DispatchRecord | null = null;
    if (rec) {
      const cur = rec.deliveries.find((d) => d.channel === 'discord');
      next = {
        channel: 'discord',
        state: patch.state,
        label: '',
        at: patch.at ?? cur?.at ?? null,
        attempts: patch.attempts ?? cur?.attempts ?? 0,
        responseCode: patch.responseCode ?? cur?.responseCode ?? null,
        detail: patch.detail ?? cur?.detail ?? null,
        nextRetryAt: patch.nextRetryAt ?? null,
      };
      rec.deliveries = [next];
    }
    if (this.db) {
      const data = {
        status: patch.state as never,
        attempts: patch.attempts ?? 0,
        lastAttemptAt: patch.at ? new Date(patch.at) : null,
        nextAttemptAt: patch.nextRetryAt ? new Date(patch.nextRetryAt) : null,
        responseCode: patch.responseCode ?? null,
        errorMessage: patch.detail ?? null,
      };
      try {
        await this.prisma.alertDelivery.upsert({
          where: { alertId_channel: { alertId, channel: 'discord' } },
          create: { alertId, channel: 'discord', ...data },
          update: data,
        });
      } catch (err) {
        this.warn('발송 기록 저장 실패', err);
      }
    }
    return next;
  }

  /** 짝이 되는 발생 알림을 **이 채널로 실제 보냈는가** (AC-ALERT32 판정용) */
  async wasDispatched(alertId: string): Promise<boolean> {
    const rec = this.memory.find((a) => a.id === alertId);
    if (rec) return rec.deliveries.some((d) => d.state === 'sent');
    if (!this.db) return false;
    try {
      const row = await this.prisma.alertDelivery.findUnique({
        where: { alertId_channel: { alertId, channel: 'discord' } },
      });
      return row?.status === 'sent';
    } catch {
      return false;
    }
  }

  /**
   * 재시작 시 큐에 남아 있던 대기분을 정리한다.
   * **자동으로 다시 보내지 않는다** — 오래된 알림이 뒤늦게 채널에 뜨는 것을 막는다 (AC-ALERT33).
   */
  async markPendingAsRestart(dataSource: 'mock' | 'live'): Promise<number> {
    let n = 0;
    for (const rec of this.memory) {
      if (rec.dataSource !== dataSource) continue;
      for (const d of rec.deliveries) {
        if (d.state === 'pending') {
          d.state = 'skipped_restart';
          d.nextRetryAt = null;
          n += 1;
        }
      }
    }
    if (this.db) {
      try {
        const res = await this.prisma.alertDelivery.updateMany({
          where: { status: 'pending', alert: { dataSource } },
          data: { status: 'skipped_restart', nextAttemptAt: null },
        });
        n = res.count;
      } catch (err) {
        this.warn('재시작 발송 정리 실패', err);
      }
    }
    return n;
  }

  /** 발송 큐: `pending` + 시도 시각이 지난 것 (오래된 순) */
  async dueDeliveries(
    dataSource: 'mock' | 'live',
    now: number,
    limit = 20,
  ): Promise<{ alertId: string; attempts: number }[]> {
    if (this.db) {
      try {
        const rows = await this.prisma.alertDelivery.findMany({
          where: {
            status: 'pending',
            alert: { dataSource },
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: new Date(now) } },
            ],
          },
          orderBy: { createdAt: 'asc' },
          take: limit,
        });
        return rows.map((r) => ({ alertId: r.alertId, attempts: r.attempts }));
      } catch (err) {
        this.warn('발송 큐 조회 실패', err);
      }
    }
    const out: { alertId: string; attempts: number }[] = [];
    for (const rec of this.memory) {
      if (rec.dataSource !== dataSource) continue;
      for (const d of rec.deliveries) {
        if (d.state !== 'pending') continue;
        if (d.nextRetryAt && Date.parse(d.nextRetryAt) > now) continue;
        out.push({ alertId: rec.id, attempts: d.attempts });
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * 발송 대기열 요약 (설정 화면 `discord.queue`, 계약 2.5). **읽기만 한다.**
   * - `pending`: `pending` 상태 전체(지금 보낼 것 + 재시도 예정)
   * - `earliestAt`: 가장 이른 예정 시각(ms). 예정 시각이 없는 건(바로 보낼 것)은 `now`로 센다. 대기 건이 없으면 null
   */
  async queueSummary(
    dataSource: 'mock' | 'live',
    now: number,
  ): Promise<{ pending: number; earliestAt: number | null }> {
    if (this.db) {
      try {
        const where = {
          status: 'pending' as const,
          alert: { dataSource },
        };
        const [pending, first] = await Promise.all([
          this.prisma.alertDelivery.count({ where }),
          this.prisma.alertDelivery.findFirst({
            where,
            orderBy: { nextAttemptAt: { sort: 'asc', nulls: 'first' } },
            select: { nextAttemptAt: true },
          }),
        ]);
        if (pending === 0) return { pending: 0, earliestAt: null };
        const at = first?.nextAttemptAt?.getTime() ?? now;
        return { pending, earliestAt: Math.max(now, at) };
      } catch (err) {
        this.warn('발송 대기열 요약 실패', err);
      }
    }
    let pending = 0;
    let earliest: number | null = null;
    for (const rec of this.memory) {
      if (rec.dataSource !== dataSource) continue;
      for (const d of rec.deliveries) {
        if (d.state !== 'pending') continue;
        pending += 1;
        const at = d.nextRetryAt
          ? Math.max(now, Date.parse(d.nextRetryAt))
          : now;
        if (earliest === null || at < earliest) earliest = at;
      }
    }
    return { pending, earliestAt: earliest };
  }

  // --- 읽기 -------------------------------------------------------------------

  async byId(id: string): Promise<AlertRecord | null> {
    const hit = this.memory.find((a) => a.id === id);
    if (hit) return hit;
    if (!this.db) return null;
    try {
      const row = await this.prisma.alert.findUnique({
        where: { id },
        include: { deliveries: true },
      });
      return row ? fromRow(row) : null;
    } catch (err) {
      this.warn('알림 조회 실패', err);
      return null;
    }
  }

  async query(dataSource: 'mock' | 'live', f: AlertFilter): Promise<AlertPage> {
    const all = this.db
      ? await this.loadForQuery(dataSource, f)
      : this.memory.filter((a) => a.dataSource === dataSource);
    const inRange = all.filter(
      (a) =>
        (f.from === null || a.occurredAt >= f.from) &&
        (f.to === null || a.occurredAt <= f.to),
    );
    const facets = buildFacets(inRange);
    const filtered = inRange.filter((a) => matches(a, f));
    filtered.sort((a, b) => b.occurredAt - a.occurredAt);
    return {
      items: filtered.slice(f.offset, f.offset + f.limit),
      filteredTotal: filtered.length,
      total: this.db ? await this.countAll(dataSource) : all.length,
      facets,
    };
  }

  /**
   * DB 경로: 기간으로 먼저 좁혀 읽는다. 알림은 최대 2,000건이라 기간 안 전량을
   * 읽어 메모리에서 거르는 편이 조건별 인덱스를 늘리는 것보다 단순하고 빠르다.
   */
  private async loadForQuery(
    dataSource: 'mock' | 'live',
    f: AlertFilter,
  ): Promise<AlertRecord[]> {
    try {
      const rows = await this.prisma.alert.findMany({
        where: {
          dataSource,
          ...(f.from !== null || f.to !== null
            ? {
                occurredAt: {
                  ...(f.from !== null ? { gte: new Date(f.from) } : {}),
                  ...(f.to !== null ? { lte: new Date(f.to) } : {}),
                },
              }
            : {}),
        },
        include: { deliveries: true },
        orderBy: { occurredAt: 'desc' },
        take: 2000,
      });
      return rows.map(fromRow);
    } catch (err) {
      this.warn('알림 목록 조회 실패', err);
      return this.memory.filter((a) => a.dataSource === dataSource);
    }
  }

  private async countAll(dataSource: 'mock' | 'live'): Promise<number> {
    try {
      return await this.prisma.alert.count({ where: { dataSource } });
    } catch {
      return this.memory.filter((a) => a.dataSource === dataSource).length;
    }
  }

  /**
   * 배지 집계 **질의 1회** (DBA 실측, PM 지시 2026-09-25).
   * 모든 탭·모든 재연결이 부르는 유일한 조회라 여기가 느리면 전체가 느려진다.
   *
   * **`severity <> 'resolved'`로 쓰지 말 것.** `<>`는 **필터**이고 `<`는 **인덱스 경계**다:
   *   - `<> 'resolved'` → 인덱스 항목 2,000개를 읽고 1,990개를 버린다 (0.53ms)
   *   - `< 'resolved'`  → 인덱스 항목 **10개**만 읽는다 (0.094ms)
   *   - 결정적 차이: **VACUUM 전(= 쓰기가 몰린 평상시)에 `<>` 형태는 Seq Scan으로 떨어진다.**
   *
   * `min(severity)`가 곧 최악 심각도다 — enum이 `critical,warning,unknown,resolved` 순으로
   * 선언돼 있고 그것이 `common.md` 2.1 우선순위와 같다. 정렬 코드가 필요 없고 0건이어도
   * 항상 1행이 온다. (enum 선언 순서에 기대는 불변식이라 DBA가 테스트로 고정해 뒀다.)
   *
   * Prisma `groupBy`/`aggregate`로는 이 형태가 나오지 않아 `$queryRaw`를 쓴다.
   * `kind <> 'test'`는 **인덱스 열이 아니라 힙 필터**라 위 경계에 영향이 없다
   * (테스트 발송은 내가 누른 버튼이라 배지에 세지 않는다 — 계약 2.3).
   * `kind='resolve'`는 항상 `severity='resolved'`라 경계에서 이미 빠진다.
   */
  async badgeCounts(
    dataSource: 'mock' | 'live',
  ): Promise<{ count: number; worst: AlertSeverity | null }> {
    if (this.db) {
      try {
        const rows = await this.prisma.$queryRaw<
          { unread: number; worst: AlertSeverity | null }[]
        >`
          SELECT count(*)::int AS unread, min(severity) AS worst
            FROM alerts
           WHERE data_source = ${dataSource}::data_source_mode
             AND acknowledged_at IS NULL
             AND severity < 'resolved'::alert_severity
             AND kind <> 'test'::alert_kind
        `;
        const row = rows[0];
        return {
          count: Number(row?.unread ?? 0),
          worst: row?.worst ?? null,
        };
      } catch (err) {
        this.warn('배지 집계 실패', err);
      }
    }
    // 메모리 폴백도 **같은 규칙**으로 센다 (DB가 있을 때와 숫자가 달라지면 안 된다)
    const unread = this.memory.filter(
      (a) =>
        a.dataSource === dataSource &&
        a.acknowledgedAt === null &&
        a.severity !== 'resolved' &&
        a.kind !== 'test',
    );
    return {
      count: unread.length,
      worst: worstSeverityOf(unread.map((a) => a.severity)),
    };
  }

  // --- 상태 머신 ---------------------------------------------------------------

  async loadKeyStates(
    dataSource: 'mock' | 'live',
  ): Promise<Map<string, KeyState>> {
    if (!this.db) return new Map(this.memoryKeyStates);
    try {
      const rows = await this.prisma.alertKeyState.findMany({
        where: { dataSource },
      });
      const map = new Map<string, KeyState>();
      for (const r of rows) {
        map.set(r.alertKey, {
          status: r.status,
          statusSince: r.statusSince.getTime(),
          openAlertId: r.openAlertId,
          openSeverity: null,
          dedupeStartedAt: r.dedupeStartedAt?.getTime() ?? null,
          dedupeCount: r.dedupeCount,
          recentTransitions: Array.isArray(r.recentTransitions)
            ? (r.recentTransitions as never)
            : [],
          flapping: r.flapping,
          flappingSince: r.flappingSince?.getTime() ?? null,
          unknownSince: r.unknownSince?.getTime() ?? null,
          unknownFrom: null,
          unknownAlerted: r.status === 'unknown' && r.openAlertId !== null,
          suppressedBy: r.suppressedBy,
          lastNotifiedTargets: r.lastNotifiedTargets,
        });
      }
      return map;
    } catch (err) {
      this.warn('상태 머신 읽기 실패', err);
      return new Map(this.memoryKeyStates);
    }
  }

  /** **바뀐 키만** 부른다 (15초 루프가 8행을 무조건 쓰지 않게) */
  async saveKeyState(
    dataSource: 'mock' | 'live',
    key: string,
    s: KeyState,
  ): Promise<void> {
    this.memoryKeyStates.set(key, s);
    if (!this.db) return;
    const data = {
      status: s.status as never,
      statusSince: new Date(s.statusSince),
      openAlertId: s.openAlertId,
      dedupeStartedAt: s.dedupeStartedAt ? new Date(s.dedupeStartedAt) : null,
      dedupeCount: s.dedupeCount,
      recentTransitions:
        s.recentTransitions as unknown as Prisma.InputJsonValue,
      flapping: s.flapping,
      flappingSince: s.flappingSince ? new Date(s.flappingSince) : null,
      unknownSince: s.unknownSince ? new Date(s.unknownSince) : null,
      suppressedBy: s.suppressedBy,
      lastNotifiedTargets: s.lastNotifiedTargets,
    };
    try {
      await this.prisma.alertKeyState.upsert({
        where: { dataSource_alertKey: { dataSource, alertKey: key } },
        create: { dataSource, alertKey: key, ...data },
        update: data,
      });
    } catch (err) {
      this.warn('상태 머신 저장 실패', err);
    }
  }

  // --- heartbeat (정지 구간 계산용) ---------------------------------------------

  /** 마지막 관측 시각. 행이 없으면 null = "이전 실행 기록 없음" */
  async readHeartbeat(
    dataSource: 'mock' | 'live',
  ): Promise<{ observedAt: number } | null> {
    if (!this.db) return null;
    try {
      const row = await this.prisma.dashboardHeartbeat.findUnique({
        where: { scope: 'alerts' },
      });
      if (!row || row.dataSource !== dataSource) return null;
      return { observedAt: row.observedAt.getTime() };
    } catch (err) {
      this.warn('heartbeat 읽기 실패', err);
      return null;
    }
  }

  async writeHeartbeat(
    dataSource: 'mock' | 'live',
    startedAt: number,
    at: number,
  ): Promise<void> {
    if (!this.db) return;
    try {
      await this.prisma.dashboardHeartbeat.upsert({
        where: { scope: 'alerts' },
        create: {
          scope: 'alerts',
          startedAt: new Date(startedAt),
          observedAt: new Date(at),
          dataSource,
        },
        update: { observedAt: new Date(at), dataSource },
      });
    } catch (err) {
      this.warn('heartbeat 저장 실패', err);
    }
  }

  // --- mock 초기화 --------------------------------------------------------------

  /** **`data_source='mock'` 행만** 지운다 (live 이력을 건드리지 않는다) */
  async resetMock(): Promise<void> {
    this.memory = this.memory.filter((a) => a.dataSource !== 'mock');
    this.memoryKeyStates.clear();
    if (!this.db) return;
    try {
      await this.prisma.alert.deleteMany({ where: { dataSource: 'mock' } });
      await this.prisma.alertKeyState.deleteMany({
        where: { dataSource: 'mock' },
      });
    } catch (err) {
      this.warn('mock 알림 초기화 실패', err);
    }
  }

  /** mock 예시 이력을 통째로 넣는다 (시나리오 전환) */
  async seedMock(records: AlertRecord[]): Promise<void> {
    await this.resetMock();
    for (const rec of records) await this.seedAppend(rec);
  }

  /** mock 이력 1건 추가 (`burst` 시나리오) */
  async seedAppend(rec: AlertRecord): Promise<void> {
    this.memory.push(rec);
    this.trim();
    if (!this.db) return;
    try {
      await this.prisma.alert.create({
        data: {
          id: rec.id,
          dataSource: 'mock',
          alertKey: rec.alertKey,
          kind: rec.kind,
          severity: rec.severity,
          fromStatus: rec.fromStatus,
          toStatus: rec.toStatus,
          reasonCode: rec.reasonCode,
          reasonText: rec.reasonText,
          targets: rec.targets,
          targetCount: rec.targetCount,
          occurredAt: new Date(rec.occurredAt),
          lastEventAt: new Date(rec.lastEventAt),
          resolvedAt: rec.resolvedAt ? new Date(rec.resolvedAt) : null,
          closedAt: rec.closedAt ? new Date(rec.closedAt) : null,
          repeatCount: rec.repeatCount,
          flapping: rec.flapping,
          suppressedKeys: rec.suppressedKeys,
          acknowledgedAt: rec.acknowledgedAt
            ? new Date(rec.acknowledgedAt)
            : null,
          context: (rec.context ?? undefined) as
            Prisma.InputJsonValue | undefined,
          deliveries: {
            create: rec.deliveries
              .filter((d) => DB_DELIVERY_STATUSES.includes(d.state))
              .map((d) => ({
                channel: 'discord' as const,
                status: d.state as never,
                attempts: d.attempts,
                lastAttemptAt: d.at ? new Date(d.at) : null,
                responseCode: d.responseCode,
                errorMessage: d.detail,
              })),
          },
        },
      });
    } catch (err) {
      this.warn('mock 알림 저장 실패', err);
    }
  }

  private trim(): void {
    if (this.memory.length > this.memoryMax) {
      this.memory = this.memory.slice(this.memory.length - this.memoryMax);
    }
  }

  private warn(what: string, err: unknown): void {
    this.logger.warn(
      `${what}: ${err instanceof Error ? err.name : 'error'} — 메모리로 계속합니다`,
    );
  }
}

/**
 * DB의 `min(severity)`와 **같은 순서**를 쓴다 (enum 선언 순서 = common.md 2.1 우선순위).
 * 한쪽만 바뀌면 DB 있을 때와 없을 때 배지 색이 달라진다.
 */
const SEVERITY_ORDER: AlertSeverity[] = [
  'critical',
  'warning',
  'unknown',
  'resolved',
];

function worstSeverityOf(list: AlertSeverity[]): AlertSeverity | null {
  let best: AlertSeverity | null = null;
  for (const s of list) {
    if (
      best === null ||
      SEVERITY_ORDER.indexOf(s) < SEVERITY_ORDER.indexOf(best)
    ) {
      best = s;
    }
  }
  return best;
}

function matches(a: AlertRecord, f: AlertFilter): boolean {
  if (f.severity && !f.severity.includes(a.severity)) return false;
  if (f.area && !f.area.includes(areaOf(a.alertKey))) return false;
  if (f.key && !f.key.includes(a.alertKey)) return false;
  if (f.kind && !f.kind.includes(a.kind)) return false;
  if (!f.includeResolved && (a.severity === 'resolved' || a.kind === 'resolve'))
    return false;
  if (f.unreadOnly && a.acknowledgedAt !== null) return false;
  return true;
}

function buildFacets(list: AlertRecord[]): AlertPage['facets'] {
  const severity: Record<string, number> = {};
  const area: Record<string, number> = {};
  for (const a of list) {
    severity[a.severity] = (severity[a.severity] ?? 0) + 1;
    const ar = areaOf(a.alertKey);
    area[ar] = (area[ar] ?? 0) + 1;
  }
  return { severity, area };
}

type AlertRowWithDeliveries = {
  id: string;
  dataSource: string;
  alertKey: string;
  kind: string;
  severity: string;
  fromStatus: string | null;
  toStatus: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  targets: unknown;
  targetCount: number;
  occurredAt: Date;
  lastEventAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  parentAlertId: string | null;
  repeatCount: number;
  flapping: boolean;
  suppressedKeys: string[];
  acknowledgedAt: Date | null;
  context: unknown;
  createdAt: Date;
  deliveries?: {
    status: string;
    attempts: number;
    lastAttemptAt: Date | null;
    nextAttemptAt: Date | null;
    responseCode: number | null;
    errorMessage: string | null;
  }[];
};

function fromRow(row: AlertRowWithDeliveries): AlertRecord {
  return {
    id: row.id,
    dataSource: row.dataSource as 'mock' | 'live',
    alertKey: row.alertKey as AlertKey,
    kind: row.kind as AlertKind,
    severity: row.severity as AlertSeverity,
    fromStatus: row.fromStatus as Status | null,
    toStatus: row.toStatus as Status | null,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    targets: Array.isArray(row.targets) ? (row.targets as never) : [],
    targetCount: row.targetCount,
    occurredAt: row.occurredAt.getTime(),
    lastEventAt: row.lastEventAt.getTime(),
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    closedAt: row.closedAt?.getTime() ?? null,
    parentAlertId: row.parentAlertId,
    repeatCount: row.repeatCount,
    flapping: row.flapping,
    suppressedKeys: row.suppressedKeys,
    acknowledgedAt: row.acknowledgedAt?.getTime() ?? null,
    context: (row.context as AlertContext | null) ?? null,
    createdAt: row.createdAt.getTime(),
    deliveries: (row.deliveries ?? []).map((d) => ({
      channel: 'discord' as const,
      state: d.status as DispatchRecord['state'],
      label: '',
      at: d.lastAttemptAt?.toISOString() ?? null,
      attempts: d.attempts,
      responseCode: d.responseCode,
      detail: d.errorMessage,
      nextRetryAt: d.nextAttemptAt?.toISOString() ?? null,
    })),
  };
}
