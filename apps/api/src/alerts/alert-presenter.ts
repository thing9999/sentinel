/**
 * 저장된 구성요소 → 화면·채널이 함께 쓰는 알림 1건 (docs/api/alerts.md 1.3·4절).
 *
 * 본문 문자열은 **저장하지 않고 여기서 조립**한다 (DBA 설계). 그래서 문구를 고쳐도
 * 과거 이력이 옛 문구로 남지 않고, **로그 줄이 들어올 자리가 구조적으로 없다**.
 */
import type { Reason } from '../common/status';
import { formatDurationKo } from '../common/status';
import type { ResourceRef } from '../cluster/types';
import {
  areaLabel,
  areaOfKey,
  keyHref,
  keyLabel,
  severityLabel,
  severityPrefix,
} from './alert-labels';
import type {
  AlertDetail,
  AlertGap,
  AlertItem,
  AlertLogTarget,
  AlertRecord,
  AlertTarget,
  AlertTransitionEntry,
  DispatchRecord,
  DispatchState,
} from './alerts.types';

const DISPATCH_LABEL: Record<DispatchState, string> = {
  pending: '대기 중',
  sent: '보냄',
  failed: '실패',
  skipped_disabled: '제외 (끔)',
  skipped_not_configured: '미설정',
  skipped_severity: '제외 (심각도)',
  skipped_unknown_off: '제외 (확인 불가)',
  skipped_flapping: '제외 (불안정)',
  skipped_mock: '보내지 않음 (mock)',
  skipped_restart: '제외 (재시작)',
  skipped_no_pair: '제외 (짝 없음)',
  skipped_circuit_open: '제외 (발송 정지)',
};

export function dispatchLabel(state: DispatchState): string {
  return DISPATCH_LABEL[state] ?? '제외';
}

/** 영향 객체 → 그 리소스 화면 (서버가 정한다. 화면은 다시 매핑하지 않는다) */
export function targetHref(ref: ResourceRef): string | null {
  const ns = ref.namespace;
  switch (ref.kind) {
    case 'Pod':
      return ns ? `/cluster/pods/${ns}/${ref.name}` : null;
    case 'Node':
      return `/cluster/nodes/${ref.name}`;
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
      return ns
        ? `/cluster/workloads?focus=${ref.kind}/${ns}/${ref.name}`
        : null;
    case 'PersistentVolumeClaim':
      return '/cluster/pods';
    case 'Event':
      return '/cluster/events';
    default:
      return null;
  }
}

export interface LogLink {
  href: string | null;
  target: AlertLogTarget | null;
}

export interface PresentOptions {
  /** 응답 시각 (진행 중 알림의 durationMs 기준) */
  nowMs: number;
  /** 목록 3개 / 상세 10개 */
  maxTargets: number;
  dedupeWindowMin: number;
  flapWindowMin: number;
  /** 로그 링크는 **저장하지 않고 응답을 만들 때** 계산한다 (파드가 사라졌을 수 있다) */
  /**
   * `atIso`는 그 알림의 시각(`occurredAt`). 링크에 `at`을 붙일지·`follow`를 붙이지 않을지는
   * `logs/log-href.ts`의 자리별 규칙(`alert`)이 정한다 (PM 결정 D3)
   */
  logLink: (ref: ResourceRef, atIso: string | null) => LogLink;
}

function toRef(t: {
  kind: string;
  namespace: string | null;
  name: string;
}): ResourceRef {
  return { kind: t.kind, namespace: t.namespace ?? null, name: t.name };
}

export function presentItem(rec: AlertRecord, opts: PresentOptions): AlertItem {
  const area = areaOfKey(rec.alertKey);
  const targets: AlertTarget[] = rec.targets
    .slice(0, opts.maxTargets)
    .map((t) => {
      const ref = toRef(t);
      return {
        ref,
        status: rec.toStatus ?? 'unknown',
        reason: rec.reasonText ?? '',
        href: targetHref(ref),
      };
    });
  const firstPod = rec.targets.find((t) => t.kind === 'Pod');
  const log: LogLink = firstPod
    ? opts.logLink(toRef(firstPod), new Date(rec.occurredAt).toISOString())
    : {
        href: null,
        target: rec.targets.length
          ? {
              ref: toRef(rec.targets[0]),
              gone: false,
              deletedAt: null,
              stackSearch: false,
              unavailableReason: 'not_a_pod',
            }
          : null,
      };

  const endAt = rec.resolvedAt ?? rec.closedAt ?? opts.nowMs;
  // 해제 알림의 `occurredAt`은 **해제된 시각**이다. "지속 N분"은 원래 발생 시각부터 센다
  const startAt =
    rec.kind === 'resolve' && rec.context?.incidentStartedAt
      ? Date.parse(rec.context.incidentStartedAt)
      : rec.occurredAt;
  const durationMs =
    rec.kind === 'restart_summary' || rec.kind === 'test'
      ? 0
      : Math.max(
          0,
          endAt - (Number.isFinite(startAt) ? startAt : rec.occurredAt),
        );

  const ctx = rec.context ?? {};
  const flapTransitions = ctx.transitions ?? [];
  const reason: Reason | null = rec.reasonCode
    ? {
        code: rec.reasonCode,
        text: rec.reasonText ?? '',
        status: rec.toStatus ?? 'unknown',
      }
    : null;

  return {
    id: rec.id,
    key: rec.alertKey,
    area,
    areaLabel: areaLabel(area),
    severity: rec.severity,
    severityLabel: severityLabel(rec.severity),
    kind: rec.kind,
    transition:
      rec.toStatus === null ? null : { from: rec.fromStatus, to: rec.toStatus },
    reason,
    targets,
    targetTotal: rec.targetCount,
    occurredAt: new Date(rec.occurredAt).toISOString(),
    lastSeenAt: new Date(rec.lastEventAt).toISOString(),
    resolvedAt: rec.resolvedAt ? new Date(rec.resolvedAt).toISOString() : null,
    durationMs,
    repeatCount: rec.repeatCount,
    dedupe: {
      windowMin: opts.dedupeWindowMin,
      lastEventAt: new Date(rec.lastEventAt).toISOString(),
    },
    flapping: rec.flapping
      ? {
          active: rec.closedAt === null,
          transitions: flapTransitions.length,
          windowMin: ctx.windowMin ?? opts.flapWindowMin,
        }
      : null,
    suppressedAreas: rec.suppressedKeys.length,
    unknownGap: ctx.unknownFrom
      ? {
          from: ctx.unknownFrom,
          to: ctx.unknownTo ?? null,
          minutes: gapMinutes(
            ctx.unknownFrom,
            ctx.unknownTo ?? null,
            opts.nowMs,
          ),
        }
      : null,
    mitigations: ctx.mitigations ?? [],
    relatedAlertId: rec.parentAlertId,
    relation:
      rec.parentAlertId === null
        ? null
        : rec.kind === 'resolve'
          ? 'resolves'
          : rec.kind === 'escalation'
            ? 'escalated_from'
            : null,
    restart:
      rec.kind === 'restart_summary'
        ? {
            warmupSec: ctx.warmupSec ?? 0,
            counts: ctx.counts ?? { critical: 0, warning: 0, unknown: 0 },
            gap: restartGap(rec),
          }
        : null,
    href: keyHref(rec.alertKey),
    logHref: log.href,
    logTarget: log.target,
    read: rec.acknowledgedAt !== null,
    readAt: rec.acknowledgedAt
      ? new Date(rec.acknowledgedAt).toISOString()
      : null,
    dispatch: rec.deliveries.map((d) => ({
      ...d,
      label: dispatchLabel(d.state),
    })),
    dataSource: rec.dataSource,
    createdAt: new Date(rec.createdAt).toISOString(),
  };
}

export function presentDetail(
  rec: AlertRecord,
  opts: PresentOptions,
  clusterName: string | null,
  publicBaseUrl: string | null,
): AlertDetail {
  const item = presentItem(rec, opts);
  const ctx = rec.context ?? {};
  return {
    ...item,
    messagePreview: buildMessage(rec, item, clusterName, publicBaseUrl),
    transitions: (ctx.transitions ?? [])
      .slice(-20)
      .map((t: AlertTransitionEntry) => ({
        at: t.at,
        from: t.from ?? 'unknown',
        to: t.to,
      })),
    suppressedKeys: rec.suppressedKeys.map((k) => ({
      key: k as AlertItem['key'],
      label: keyLabel(k as AlertItem['key']),
    })),
    dispatchAttempts: rec.deliveries
      .filter((d): d is DispatchRecord & { at: string } => d.at !== null)
      .map((d) => ({
        at: d.at,
        channel: 'discord' as const,
        state: d.state,
        responseCode: d.responseCode,
        detail: d.detail,
      })),
  };
}

function restartGap(rec: AlertRecord): AlertGap | null {
  const d = rec.context?.downtime;
  if (!d) {
    return {
      id: `gap-${rec.id}`,
      from: new Date(rec.occurredAt).toISOString(),
      to: new Date(rec.occurredAt).toISOString(),
      minutes: 0,
      unknownPrevious: true,
    };
  }
  return {
    id: `gap-${d.from}`,
    from: d.from,
    to: d.to,
    minutes: d.minutes,
    unknownPrevious: false,
  };
}

function gapMinutes(from: string, to: string | null, nowMs: number): number {
  const start = Date.parse(from);
  const end = to ? Date.parse(to) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * 알림 본문 (계약 4절). 화면 `messagePreview`와 실제 디스코드 메시지가 **같은 문자열**이다.
 *
 * **담지 않는 것**: 비밀값, 웹훅 URL, 환경 변수, command/args, 어노테이션·레이블 원문,
 * ConfigMap/Secret 내용, DB 쿼리 원문, 접속 문자열, 스택 트레이스,
 * **컨테이너 로그 줄(가림 처리한 것 포함)과 로그 요약·통계** (AC-ALERT13).
 * 들어가는 문자열은 서버가 만든 `reason.text`와 `ResourceRef`뿐이고 둘 다 이미
 * `redactSecrets` + 길이 제한을 거쳤다.
 */
export function buildMessage(
  rec: AlertRecord,
  item: AlertItem,
  clusterName: string | null,
  publicBaseUrl: string | null,
): string {
  const lines: string[] = [];
  const mock = rec.dataSource === 'mock' ? '[MOCK] ' : '';
  const prefix =
    rec.kind === 'test' ? '[테스트]' : severityPrefix(rec.severity);
  const head =
    rec.kind === 'test'
      ? `${mock}${prefix} Sentinel 알림 설정 확인 메시지입니다. 실제 장애가 아닙니다.`
      : `${mock}${prefix} ${item.areaLabel}${rec.reasonText ? ` · ${rec.reasonText}` : ''}`;
  lines.push(head);

  if (rec.targets.length > 0) {
    const shown = rec.targets
      .slice(0, 3)
      .map((t) => `${t.kind} ${t.namespace ? `${t.namespace}/` : ''}${t.name}`);
    const more = rec.targetCount - shown.length;
    lines.push(`대상: ${shown.join(', ')}${more > 0 ? ` 외 ${more}개` : ''}`);
  }
  if (clusterName) lines.push(`클러스터: ${clusterName}`);
  lines.push(`시각: ${new Date(rec.occurredAt).toISOString()}`);
  if (rec.kind === 'resolve' && item.durationMs > 0) {
    lines.push(`지속 ${formatDurationKo(Math.round(item.durationMs / 1000))}`);
  }
  if (rec.repeatCount >= 2) lines.push(`반복 ${rec.repeatCount}회`);
  if (item.unknownGap) {
    lines.push(
      `확인 불가 구간 ${hhmm(item.unknownGap.from)} ~ ${
        item.unknownGap.to ? hhmm(item.unknownGap.to) : '지금'
      } (${item.unknownGap.minutes}분)`,
    );
  }
  if (item.restart) {
    const g = item.restart.gap;
    lines.push(
      g && !g.unknownPrevious
        ? `정지 구간 ${hhmm(g.from)} ~ ${g.to ? hhmm(g.to) : '지금'} (${g.minutes}분) — 이 동안의 변화는 알림으로 잡히지 않았습니다.`
        : '정지 구간 — 이전 실행 기록 없음',
    );
  }
  if (item.suppressedAreas > 0) {
    lines.push(`영향 영역 ${item.suppressedAreas}개`);
  }
  if (publicBaseUrl && item.href) {
    lines.push(`${publicBaseUrl.replace(/\/+$/, '')}${item.href}`);
  }
  return lines.join('\n');
}
