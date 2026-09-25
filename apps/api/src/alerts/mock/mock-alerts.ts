/**
 * mock 알림 이력 픽스처 (docs/api/alerts.md 5절).
 *
 * `alerts` 그룹은 **미리 쌓인 이력**이고, **실시간 생성 확인은 `cluster`/`cost` 시나리오
 * 전환으로 한다** (AC-ALERT02·07·12) — 그때는 실제 상태 전이가 일어나 엔진이 알림을 만든다.
 *
 * **여기에 로그 줄을 넣지 않는다** (계약 0.3). 본문은 저장하지 않고 조립하므로
 * 픽스처도 구성요소(키·사유·대상·시각)만 담는다.
 */
import { randomUUID } from 'node:crypto';
import type {
  AlertRecord,
  AlertSeverity,
  DispatchRecord,
  DispatchState,
} from '../alerts.types';

export const ALERT_SCENARIOS = [
  'default',
  'empty',
  'burst',
  'flapping',
  'restart',
  'webhook-unset',
  'webhook-failed',
  'webhook-ratelimited',
  'suppressed-by-source',
] as const;
export type AlertScenario = (typeof ALERT_SCENARIOS)[number];

export const ALERT_SCENARIO_OPTIONS: readonly {
  id: string;
  label: string;
  description?: string;
}[] = [
  {
    id: 'default',
    label: '기본 (24시간 12건)',
    description:
      '장애 3 · 주의 4 · 확인 불가 1 · 해제 3 · 불안정 묶음 1, 미확인 3건',
  },
  { id: 'empty', label: '0건', description: '빈 상태 + 감시 중 footer' },
  {
    id: 'burst',
    label: '연속 발생',
    description: '3초마다 1건 — 배지가 올라간다',
  },
  {
    id: 'flapping',
    label: '불안정 묶음',
    description: '30분에 6회 전이 → 묶음 1건',
  },
  {
    id: 'restart',
    label: '재시작 요약',
    description: '워밍업 요약 1건 + 19분 정지 구간',
  },
  { id: 'webhook-unset', label: '웹훅 미설정', description: '화면에만 쌓임' },
  {
    id: 'webhook-failed',
    label: '발송 실패',
    description:
      '5xx 3회 후 failed → 최근 2건은 발송 정지(skipped_circuit_open), 가장 최근 해제는 짝 없음(skipped_no_pair)',
  },
  {
    id: 'webhook-ratelimited',
    label: '발송 대기(429)',
    description: 'Retry-After 준수, 유실 없음',
  },
  {
    id: 'suppressed-by-source',
    label: '출처 억제',
    description: 'kube 끊김으로 영역 5개가 1건으로 묶임',
  },
];

const MIN = 60_000;

function dispatch(
  state: DispatchState,
  extra: Partial<DispatchRecord> = {},
): DispatchRecord[] {
  return [
    {
      channel: 'discord',
      state,
      label: '',
      at: null,
      attempts: 0,
      responseCode: null,
      detail: null,
      nextRetryAt: null,
      ...extra,
    },
  ];
}

interface Seed {
  key: AlertRecord['alertKey'];
  kind: AlertRecord['kind'];
  severity: AlertSeverity;
  from: AlertRecord['fromStatus'];
  to: AlertRecord['toStatus'];
  code: string;
  text: string;
  targets?: { kind: string; namespace: string | null; name: string }[];
  targetCount?: number;
  agoMin: number;
  resolvedAfterMin?: number;
  repeatCount?: number;
  read?: boolean;
  flapping?: boolean;
  suppressedKeys?: string[];
  context?: AlertRecord['context'];
  deliveries?: DispatchRecord[];
}

function build(
  seed: Seed,
  now: number,
  dataSource: 'mock' = 'mock',
): AlertRecord {
  const occurredAt = now - seed.agoMin * MIN;
  const resolvedAt =
    seed.resolvedAfterMin !== undefined
      ? occurredAt + seed.resolvedAfterMin * MIN
      : null;
  const terminal =
    seed.kind === 'resolve' ||
    seed.kind === 'restart_summary' ||
    seed.kind === 'test';
  return {
    id: randomUUID(),
    dataSource,
    alertKey: seed.key,
    kind: seed.kind,
    severity: seed.severity,
    fromStatus: seed.from,
    toStatus: seed.to,
    reasonCode: seed.code,
    reasonText: seed.text,
    targets: seed.targets ?? [],
    targetCount: seed.targetCount ?? seed.targets?.length ?? 0,
    occurredAt,
    lastEventAt: occurredAt + (seed.repeatCount ? 10 * MIN : 0),
    resolvedAt,
    closedAt: terminal ? occurredAt : resolvedAt,
    parentAlertId: null,
    repeatCount: seed.repeatCount ?? 1,
    flapping: seed.flapping ?? false,
    suppressedKeys: seed.suppressedKeys ?? [],
    acknowledgedAt: seed.read ? occurredAt + MIN : null,
    context: seed.context ?? null,
    createdAt: occurredAt,
    deliveries: seed.deliveries ?? dispatch('skipped_mock'),
  };
}

const POD = (name: string) => ({
  kind: 'Pod',
  namespace: 'prod',
  name,
});
const NODE = (name: string) => ({ kind: 'Node', namespace: null, name });

/** 최근 24시간 12건. **미확인 3건** → 배지 3 + 탭 제목 `(3) Sentinel` (AC-ALERT35) */
function defaultSeeds(): Seed[] {
  return [
    {
      key: 'area:pods',
      kind: 'transition',
      severity: 'critical',
      from: 'ok',
      to: 'critical',
      code: 'POD_WAITING_CRASHLOOP',
      text: 'CrashLoopBackOff · 최근 1시간 재시작 6회',
      // cluster mock 기본 시나리오(`mixed`)에 **실제로 있는** api 파드 이름이다. 알림 → 로그 링크(`at`)를
      // mock에서 끝까지 따라가 보려면 파드가 살아 있어야 한다 (logs.md 2.2.1). cluster 시나리오를 바꾸면
      // 이름이 달라져 로그 화면이 "사라진 파드"(S3)로 열린다 — 그것도 정상 동작이다
      targets: [POD('api-qfvhtjhs2-wbf44'), POD('api-qfvhtjhs2-xbf44')],
      targetCount: 2,
      agoMin: 18,
      repeatCount: 2,
    },
    {
      key: 'area:nodes',
      kind: 'transition',
      severity: 'critical',
      from: 'warning',
      to: 'critical',
      code: 'NODE_NOT_READY',
      text: 'NotReady 4분',
      targets: [NODE('i-0a1b2c3d4e5f60718')],
      agoMin: 42,
    },
    {
      key: 'area:cost',
      kind: 'transition',
      severity: 'critical',
      from: 'warning',
      to: 'critical',
      code: 'COST_BUDGET_OVER',
      text: '월 예산 100% 초과 (누적 $412.30 / $400.00)',
      agoMin: 95,
      read: true,
    },
    {
      key: 'area:workloads',
      kind: 'transition',
      severity: 'warning',
      from: 'ok',
      to: 'warning',
      code: 'WORKLOAD_REPLICAS_SHORT',
      text: '준비된 복제본 2/3',
      targets: [{ kind: 'Deployment', namespace: 'prod', name: 'api' }],
      agoMin: 120,
      // **미확인 3건**이 되도록 일부러 읽지 않은 상태로 둔다 → 배지 3 + 탭 제목 `(3) Sentinel`
    },
    {
      key: 'area:events',
      kind: 'transition',
      severity: 'warning',
      from: 'ok',
      to: 'warning',
      code: 'EVENT_WARNINGS',
      text: '최근 15분 경고 이벤트 12건',
      agoMin: 200,
      read: true,
    },
    {
      key: 'area:db',
      kind: 'transition',
      severity: 'warning',
      from: 'ok',
      to: 'warning',
      code: 'DB_CONNECTIONS_HIGH',
      text: '연결 82% (164/200)',
      agoMin: 260,
      read: true,
    },
    {
      key: 'area:controlPlane',
      kind: 'transition',
      severity: 'warning',
      from: 'ok',
      to: 'warning',
      code: 'CP_MASTER_NOT_READY',
      text: '마스터 1대 NotReady · 쿼럼 2/3 유지',
      targets: [NODE('i-0b2c3d4e5f6071829')],
      agoMin: 320,
      read: true,
    },
    {
      key: 'source:kube',
      kind: 'transition',
      severity: 'unknown',
      from: 'ok',
      to: 'unknown',
      code: 'ALERT_SOURCE_SUPPRESSED',
      text: 'watch 연결이 끊겼습니다 (5분 지속) · 영향 영역 5개',
      suppressedKeys: [
        'area:controlPlane',
        'area:nodes',
        'area:workloads',
        'area:pods',
        'area:events',
      ],
      agoMin: 380,
      read: true,
      context: {
        unknownFrom: new Date(Date.now() - 380 * MIN).toISOString(),
        unknownTo: new Date(Date.now() - 344 * MIN).toISOString(),
      },
    },
    {
      key: 'area:pods',
      kind: 'resolve',
      severity: 'resolved',
      from: 'critical',
      to: 'ok',
      code: 'POD_RECOVERED',
      text: '파드가 정상으로 돌아왔습니다',
      targets: [POD('worker-5d1f6c8b9-kk2xz')],
      agoMin: 430,
      resolvedAfterMin: 0,
      read: true,
    },
    {
      key: 'area:nodes',
      kind: 'resolve',
      severity: 'resolved',
      from: 'warning',
      to: 'ok',
      code: 'NODE_RECOVERED',
      text: '노드가 Ready로 돌아왔습니다',
      targets: [NODE('i-0c3d4e5f60718293a')],
      agoMin: 600,
      resolvedAfterMin: 0,
      read: true,
    },
    {
      key: 'area:db',
      kind: 'resolve',
      severity: 'resolved',
      from: 'warning',
      to: 'ok',
      code: 'DB_RECOVERED',
      text: 'DB 상태가 정상으로 돌아왔습니다',
      agoMin: 800,
      resolvedAfterMin: 0,
      read: true,
    },
    {
      key: 'area:events',
      kind: 'flapping',
      severity: 'warning',
      from: 'ok',
      to: 'warning',
      code: 'ALERT_FLAPPING',
      text: '불안정(최근 30분 6회 변화) · 반복 알림을 멈춥니다',
      agoMin: 1000,
      flapping: true,
      read: true,
      context: {
        windowMin: 30,
        transitions: Array.from({ length: 6 }, (_, i) => ({
          at: new Date(Date.now() - (1000 + i * 5) * MIN).toISOString(),
          from: i % 2 === 0 ? 'ok' : 'warning',
          to: i % 2 === 0 ? 'warning' : 'ok',
        })),
      },
    },
  ];
}

function scenarioSeeds(scenario: AlertScenario): Seed[] {
  const now = Date.now();
  switch (scenario) {
    case 'empty':
      return [];
    case 'flapping':
      return [
        {
          key: 'area:pods',
          kind: 'flapping',
          severity: 'warning',
          from: 'ok',
          to: 'warning',
          code: 'ALERT_FLAPPING',
          text: '불안정(최근 30분 6회 변화) · 반복 알림을 멈춥니다',
          agoMin: 5,
          flapping: true,
          context: {
            windowMin: 30,
            transitions: Array.from({ length: 6 }, (_, i) => ({
              at: new Date(now - (30 - i * 5) * MIN).toISOString(),
              from: i % 2 === 0 ? 'ok' : 'warning',
              to: i % 2 === 0 ? 'warning' : 'ok',
            })),
          },
        },
      ];
    case 'restart':
      return [
        {
          key: 'system:restart',
          kind: 'restart_summary',
          severity: 'critical',
          from: null,
          to: null,
          code: 'ALERT_RESTART_SUMMARY',
          text: '대시보드가 시작됐습니다 · 현재 장애 2, 주의 1, 확인 불가 0',
          agoMin: 2,
          context: {
            counts: { critical: 2, warning: 1, unknown: 0 },
            warmupSec: 120,
            downtime: {
              from: new Date(now - 21 * MIN).toISOString(),
              to: new Date(now - 2 * MIN).toISOString(),
              minutes: 19,
            },
          },
          // 재시작은 사용자가 한 일이라 채널로 보내지 않는다 → **기록을 만들지 않는다**
          deliveries: [],
        },
      ];
    case 'webhook-unset':
      return defaultSeeds().map((s) => ({
        ...s,
        deliveries: dispatch('skipped_not_configured'),
      }));
    case 'webhook-failed': {
      // 이야기: 웹훅이 5xx로 계속 실패(failed) → 연속 실패로 서킷이 열려 **최근 2건은 발송 정지**
      // (skipped_circuit_open) → 발생을 보내지 못한 **해제는 짝이 없어** 보내지 않음(skipped_no_pair).
      // 두 칩(designer status.md 12.5)을 mock에서 눈으로 보기 위한 **이력 픽스처**다.
      // 발송 판정·발송기는 건드리지 않는다 — mock에서 나가는 요청은 여전히 0건이다
      const seeds = defaultSeeds();
      const newest = [...seeds]
        .filter((x) => x.kind !== 'resolve')
        .sort((a, b) => a.agoMin - b.agoMin)
        .slice(0, 2);
      const newestResolve = [...seeds]
        .filter((x) => x.kind === 'resolve')
        .sort((a, b) => a.agoMin - b.agoMin)[0];
      return seeds.map((s) => {
        if (newest.includes(s))
          return { ...s, deliveries: dispatch('skipped_circuit_open') };
        if (s === newestResolve)
          return { ...s, deliveries: dispatch('skipped_no_pair') };
        return {
          ...s,
          deliveries: dispatch('failed', {
            attempts: 3,
            at: new Date(now - s.agoMin * MIN + MIN).toISOString(),
            responseCode: 503,
            detail: '디스코드 응답 503 (3회 시도 후 포기)',
          }),
        };
      });
    }
    case 'webhook-ratelimited':
      return defaultSeeds().map((s) => ({
        ...s,
        deliveries: dispatch('pending', {
          attempts: 1,
          at: new Date(now - MIN).toISOString(),
          responseCode: 429,
          detail: '디스코드 429 · Retry-After 대기 중',
          nextRetryAt: new Date(now + 2 * MIN).toISOString(),
        }),
      }));
    case 'suppressed-by-source':
      return [
        {
          key: 'source:kube',
          kind: 'transition',
          severity: 'unknown',
          from: 'ok',
          to: 'unknown',
          code: 'ALERT_SOURCE_SUPPRESSED',
          text: '인증 실패, 토큰이 만료됐을 수 있습니다 (5분 지속) · 영향 영역 5개',
          suppressedKeys: [
            'area:controlPlane',
            'area:nodes',
            'area:workloads',
            'area:pods',
            'area:events',
          ],
          agoMin: 5,
          context: {
            unknownFrom: new Date(now - 5 * MIN).toISOString(),
            unknownTo: null,
          },
        },
      ];
    case 'burst':
    case 'default':
    default:
      return defaultSeeds();
  }
}

export function mockAlertRecords(scenario: AlertScenario): AlertRecord[] {
  const now = Date.now();
  return scenarioSeeds(scenario)
    .map((s) => build(s, now))
    .sort((a, b) => a.occurredAt - b.occurredAt);
}

/**
 * `restart` 시나리오의 정지 구간. **요약 알림 안(`restart.gap`)과 목록의 `gaps[]` 두 곳에**
 * 들어가는 것이 맞다 (디자인 5.4) — 요약은 "무슨 일이 있었나", `gaps[]`는 "이 구간은 못 봤다"다.
 */
export function mockRestartGap(): {
  id: string;
  from: string;
  to: string;
  minutes: number;
  unknownPrevious: boolean;
} {
  const now = Date.now();
  const from = new Date(now - 21 * MIN).toISOString();
  return {
    id: `gap-${from}`,
    from,
    to: new Date(now - 2 * MIN).toISOString(),
    minutes: 19,
    unknownPrevious: false,
  };
}

/** `burst` 시나리오가 3초마다 추가하는 1건 */
export function mockBurstRecord(n: number): AlertRecord {
  const now = Date.now();
  return build(
    {
      key: 'area:pods',
      kind: 'transition',
      severity: n % 3 === 0 ? 'critical' : 'warning',
      from: 'ok',
      to: n % 3 === 0 ? 'critical' : 'warning',
      code: 'POD_WAITING_CRASHLOOP',
      text: `CrashLoopBackOff · 연속 발생 확인용 ${n}번째`,
      targets: [POD(`burst-${String(n).padStart(3, '0')}`)],
      agoMin: 0,
    },
    now,
  );
}
