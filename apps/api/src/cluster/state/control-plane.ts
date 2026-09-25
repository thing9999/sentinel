/**
 * 컨트롤 플레인(마스터 노드 + static pod 미러 파드) 상태 판단.
 * 명세 `docs/specs/kops-support.md` 3.2, 계약 `docs/api/cluster-status.md` 1.6·3.3·9.1.
 *
 * - 입력은 이미 watch 중인 nodes·pods 캐시뿐이다. **새 RBAC·새 조회가 없다**(명세 D3).
 * - 기준값은 이 파일 맨 위 `CONTROL_PLANE_RULES` 한곳에 모았다.
 * - 화면은 상태를 계산하지 않는다: 쿼럼·HA·AZ·셀 상태·대표 문장이 전부 여기서 확정된다.
 */
import {
  formatDurationKo,
  reason,
  worstStatus,
  type Reason,
  type Status,
  type StatusInfo,
} from '../../common/status';
import { podKey, type RawNode, type RawPod } from '../model';
import {
  CONTROL_PLANE_COMPONENT_KINDS,
  type Areas,
  type ControlPlaneBody,
  type ControlPlaneCellState,
  type ControlPlaneComponent,
  type ControlPlaneComponentKind,
  type ControlPlaneMasterItem,
  type ControlPlaneMetricsBlock,
  type NodeItem,
  type PodItem,
  type ProblemItem,
} from '../types';
import {
  buildPodKeyLogHref,
  type LogLinkPolicyValue,
} from '../../logs/log-href';
import type { ClusterStore } from './cluster-store';

/** 기준값 한곳 모음 (계약 9.1 "기준값은 한곳에 모으고"). 일부는 settings에서 덮어쓴다 */
export const CONTROL_PLANE_RULES = {
  /** 이 마스터가 상태를 보고하지 않는다고 볼 Ready 값 */
  reportingReadyValue: 'True' as const,
  /** 구성요소가 Ready 아님으로 판단되는 지속 시간(초) */
  componentNotReadySec: 120,
  /** 마스터 NotReady 지속 시간(초) — 노드 판단과 같은 값을 쓴다 */
  masterNotReadySec: 60,
  restarts1h: { warn: 1, crit: 3 },
  /** 없으면 그 마스터 전체를 장애로 보는 구성요소 */
  vitalKinds: ['kube-apiserver', 'etcd-manager-main'] as const,
  /** 이름이 필수 구성요소 접두어로 시작하지만 구성요소가 아닌 것 (명세 U5) */
  notComponentPrefixes: ['kube-apiserver-healthcheck'] as const,
  /** 대표 사유 우선순위 (계약 9절) */
  reasonPriority: [
    'CONTROL_PLANE_NOT_FOUND',
    'CONTROL_PLANE_QUORUM_LOST',
    'CONTROL_PLANE_COMPONENT_DOWN',
    'CONTROL_PLANE_MASTER_NOT_READY',
    'CONTROL_PLANE_COMPONENT_MISSING',
    'CONTROL_PLANE_COMPONENT_WAITING',
    'CONTROL_PLANE_COMPONENT_RESTARTS',
    'CONTROL_PLANE_COMPONENT_OOM',
    'CONTROL_PLANE_COMPONENT_NOT_READY',
    'CONTROL_PLANE_NODE_NOT_REPORTING',
    'CONTROL_PLANE_NOT_HA',
    'CONTROL_PLANE_EVEN_MASTERS',
    'CONTROL_PLANE_SINGLE_ZONE',
    'CONTROL_PLANE_CORDONED',
    'CONTROL_PLANE_WORKER_PODS',
  ] as string[],
} as const;

/**
 * SSE 변경 감지에서 뺄 키 (값 자체는 응답·GET에 그대로 나간다).
 *
 * **기준**: "매 평가·매 수집마다 갱신되지만 **의미가 바뀌지 않는 값**"은 전부 여기 넣는다.
 * 하나씩 빼면 같은 종류가 또 남아 `cluster.controlplane.updated`가 15초마다 계속 울린다
 * (프레임 18KB × 시간당 240건 ≈ 8.6MB/시간/클라이언트).
 * - 파생 시각: `lastReportedAt`(보고 중이면 평가 시각). `updatedAt`·`generatedAt`은 `changeKey`가 이미 뺀다
 * - 관측 창: `observedSec` (1초마다 늘어난다. 파드 upsert도 같은 이유로 뺀다)
 * - 사용량: `usage`·`totals` — 계약 8.3대로 **사용량만 바뀌면 `metrics.updated`로 보낸다.**
 *   사용량 때문에 **상태가 바뀌면** `status`가 함께 바뀌므로 그때는 이 이벤트가 정상적으로 나간다.
 *   `totals`를 통째로 빼도 안전하다: 그 안의 allocatable·requests가 진짜로 바뀌면
 *   `masters.items[].node`(allocatable·requests)가 함께 바뀌어 변경이 감지된다.
 * - 파생 시각: `statusChangedAt` — `StatusChangeTracker`가 **status 값이 바뀔 때만** 갱신하는
 *   값이라 이 필드가 바뀌면 같은 객체의 `status`도 반드시 함께 바뀐다(= 변경은 그쪽에서 감지된다).
 *   판단 주체가 바뀌어 다시 찍히는 경우(평가기 재시작·mock 시나리오 교체 `resetTracking`)는
 *   곧바로 전체 스냅샷을 다시 보내므로(`requestResync`) 화면의 "언제부터" 값도 그때 맞춰진다.
 *   `status`·`masters.items[].node.status`·`components.items[].status` 세 곳에 들어 있어
 *   빼지 않으면 상태가 그대로인데도 이 이벤트가 계속 나갈 수 있다.
 */
export const CONTROL_PLANE_VOLATILE_KEYS: ReadonlySet<string> = new Set([
  'lastReportedAt',
  'observedSec',
  'usage',
  'totals',
  'statusChangedAt',
]);

const CP_LIMIT_NOTES = [
  {
    code: 'CP_APISERVER_SELF_DEPENDENCY',
    text: "apiserver가 모두 중단되면 이 대시보드도 클러스터를 조회할 수 없어 '연결 끊김'으로 보입니다.",
  },
  {
    code: 'CP_NO_ETCD_INTERNALS',
    text: 'etcd 내부 지표(fsync·리더 변경·DB 크기·멤버 목록)는 표시하지 않습니다.',
  },
  {
    code: 'CP_QUORUM_APPROX',
    text: '쿼럼은 마스터 노드 수 기준 근사입니다(etcd 멤버 목록은 조회하지 않습니다).',
  },
];

/** 파드 이름 → 필수 구성요소 종류 (2중 조건 중 ②. 아니면 null) */
export function componentKindOf(
  podName: string,
): ControlPlaneComponentKind | null {
  if (
    CONTROL_PLANE_RULES.notComponentPrefixes.some((p) => podName.startsWith(p))
  )
    return null;
  for (const kind of [...CONTROL_PLANE_COMPONENT_KINDS].sort(
    (a, b) => b.length - a.length,
  )) {
    if (podName === kind || podName.startsWith(`${kind}-`)) return kind;
  }
  return null;
}

export interface ControlPlaneInput {
  now: number;
  atIso: string;
  store: ClusterStore;
  rawNodes: Map<string, RawNode>;
  nodes: NodeItem[];
  podItems: PodItem[];
  rawPods: Map<string, RawPod>;
  kubeStale: boolean;
  /** kube 출처를 쓸 수 없을 때의 사유(있으면 found:false) */
  sourceReason: Reason | null;
  haExpected: boolean;
  /** 파드 캐시를 믿을 수 있는가 (false면 workerPodCount = null) */
  podsUsable: boolean;
  metrics: ControlPlaneMetricsBlock;
  /** 로그 링크 가능 여부. 칸마다 `logHref`를 **평가 단계에서** 채운다 (REST·SSE가 같은 값) */
  logLinks: LogLinkPolicyValue;
  mk: (
    key: string,
    reasons: Reason[],
    stale?: boolean,
    updatedAt?: string | null,
    forced?: Status,
  ) => StatusInfo;
}

const hhmm = (iso: string | null): string =>
  iso === null ? '알 수 없음' : new Date(iso).toISOString().slice(11, 16);

/**
 * 대표 사유 정렬: **등급이 먼저**, 같은 등급 안에서 계약 9절의 우선순위.
 * (등급을 무시하면 status는 장애인데 headline은 주의 문장이 되어 화면이 거짓말을 한다)
 */
function sortReasons(rs: Reason[]): Reason[] {
  const idx = (c: string) => {
    const i = CONTROL_PLANE_RULES.reasonPriority.indexOf(c);
    return i < 0 ? 999 : i;
  };
  const sev = (s: Status) =>
    s === 'critical' ? 0 : s === 'warning' ? 1 : s === 'unknown' ? 2 : 3;
  return [...rs].sort(
    (a, b) => sev(a.status) - sev(b.status) || idx(a.code) - idx(b.code),
  );
}

export function evaluateControlPlane(input: ControlPlaneInput): {
  body: ControlPlaneBody;
  area: Areas['controlPlane'];
  attention: { ref: ProblemItem['ref']; status: Status; reason: Reason }[];
} {
  const { now, atIso, mk, haExpected } = input;
  const masters = input.nodes.filter((n) => n.role === 'control_plane');
  const kinds = CONTROL_PLANE_COMPONENT_KINDS;

  // --- 못 찾음 / 출처 없음 ---------------------------------------------------
  if (input.sourceReason || masters.length === 0) {
    const r =
      input.sourceReason ??
      reason(
        'CONTROL_PLANE_NOT_FOUND',
        '컨트롤 플레인 노드를 찾지 못했습니다',
        'unknown',
      );
    const status = mk('area:controlPlane', [r], input.kubeStale, atIso);
    const empty: ControlPlaneBody = {
      found: false,
      notFoundReason: { code: r.code, text: r.text },
      status,
      headline: input.sourceReason
        ? r.text
        : '컨트롤 플레인 노드를 찾을 수 없습니다',
      masters: {
        ready: 0,
        total: 0,
        haExpected,
        haStatus: 'unknown',
        quorum: {
          state: 'unknown',
          requiredReady: 0,
          readyMasters: 0,
          basis: 'master_node_count',
        },
        zones: [],
        zoneSpread: 'unknown',
        totals: input.metrics,
        items: [],
      },
      components: {
        requiredKinds: kinds,
        ready: 0,
        total: 0,
        cellCounts: {
          total: 0,
          ok: 0,
          warning: 0,
          critical: 0,
          notReporting: 0,
          unknown: 0,
          missing: 0,
          stale: 0,
          unknownTotal: 0,
        },
        summaryText: '필수 구성요소를 확인할 수 없습니다',
        columns: [],
        byKind: kinds.map((kind) => ({
          kind,
          ready: 0,
          expected: 0,
          status: 'unknown',
        })),
        items: [],
      },
      others: [],
      thresholds: {
        restarts1h: { ...CONTROL_PLANE_RULES.restarts1h },
        componentNotReadySec: CONTROL_PLANE_RULES.componentNotReadySec,
        masterNotReadySec: CONTROL_PLANE_RULES.masterNotReadySec,
      },
      limits: { etcdInternalMetrics: false, notes: CP_LIMIT_NOTES },
    };
    return {
      body: empty,
      area: {
        status,
        found: false,
        masters: { ready: 0, total: 0 },
        components: { ready: 0, total: 0 },
        quorum: empty.masters.quorum,
        haExpected,
        problems: [],
      },
      attention: [],
    };
  }

  // --- 마스터 노드 -----------------------------------------------------------
  const total = masters.length;
  const readyMasters = masters.filter((n) => n.ready.value === 'True').length;
  const requiredReady = Math.floor(total / 2) + 1;
  const quorumState: ControlPlaneBody['masters']['quorum']['state'] =
    readyMasters < requiredReady
      ? 'lost'
      : total >= 2 && readyMasters === requiredReady
        ? 'at_risk'
        : 'ok';
  const haStatus: ControlPlaneBody['masters']['haStatus'] =
    total === 1 ? 'single' : total % 2 === 0 ? 'even' : 'ok';
  const zoneCounts = new Map<string, number>();
  for (const m of masters)
    if (m.zone) zoneCounts.set(m.zone, (zoneCounts.get(m.zone) ?? 0) + 1);
  const zones = [...zoneCounts]
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) => a.zone.localeCompare(b.zone));
  const zoneSpread: ControlPlaneBody['masters']['zoneSpread'] =
    zones.length === 0
      ? 'unknown'
      : zones.length >= 2
        ? 'spread'
        : total >= 2
          ? 'single_zone'
          : 'spread';

  // --- 마스터별 파드 분류 ------------------------------------------------------
  const masterNames = new Set(masters.map((n) => n.name));
  /** nodeName → kind → PodItem */
  const byNodeKind = new Map<string, Map<ControlPlaneComponentKind, PodItem>>();
  const others: ControlPlaneBody['others'] = [];
  const workerPods = new Map<string, number>();
  for (const p of input.podItems) {
    if (!p.nodeName || !masterNames.has(p.nodeName) || p.completed) continue;
    if (p.namespace !== 'kube-system') {
      // DaemonSet 파드는 설계상 모든 노드에 올라간다(CNI·로그 수집 등) → 경고 대상이 아니다.
      // "마스터에 워커 워크로드를 올린 구성"(PM 결정 Q6)만 센다.
      if (p.owner?.kind !== 'DaemonSet')
        workerPods.set(p.nodeName, (workerPods.get(p.nodeName) ?? 0) + 1);
      continue;
    }
    const kind = componentKindOf(p.name);
    if (kind === null) {
      others.push({
        name: p.name,
        nodeName: p.nodeName,
        status: p.status.status,
        ready:
          p.containers.total > 0 && p.containers.ready === p.containers.total,
        restarts1h: p.restarts.last1h,
      });
      continue;
    }
    const m =
      byNodeKind.get(p.nodeName) ??
      new Map<ControlPlaneComponentKind, PodItem>();
    const prev = m.get(kind);
    // 같은 종류가 여럿이면 더 나쁜 쪽을 대표로 (교체 중 등)
    if (!prev || rank(p.status.status) > rank(prev.status.status))
      m.set(kind, p);
    byNodeKind.set(p.nodeName, m);
  }
  others.sort(
    (a, b) =>
      a.nodeName.localeCompare(b.nodeName) || a.name.localeCompare(b.name),
  );

  // --- 셀 ---------------------------------------------------------------------
  const cells: ControlPlaneComponent[] = [];
  const reasons: Reason[] = [];
  const masterItems: ControlPlaneMasterItem[] = [];
  const attention: {
    ref: ProblemItem['ref'];
    status: Status;
    reason: Reason;
  }[] = [];

  for (const m of masters) {
    const reporting = m.ready.value === CONTROL_PLANE_RULES.reportingReadyValue;
    const lastReportedAt = reporting ? atIso : (m.ready.since ?? null);
    const kindMap =
      byNodeKind.get(m.name) ?? new Map<ControlPlaneComponentKind, PodItem>();
    const myCells: ControlPlaneComponent[] = [];
    for (const kind of kinds) {
      const pod: PodItem | null = kindMap.get(kind) ?? null;
      myCells.push(
        buildCell({
          kind,
          node: m,
          pod,
          reporting,
          lastReportedAt,
          input,
        }),
      );
    }
    cells.push(...myCells);

    const missing = myCells.filter((c) => c.cellState === 'missing');
    const vitalMissing = missing.some((c) =>
      (CONTROL_PLANE_RULES.vitalKinds as readonly string[]).includes(c.kind),
    );
    const presentCount = kinds.length - missing.length;
    if (reporting && missing.length > 0) {
      reasons.push(
        reason(
          'CONTROL_PLANE_COMPONENT_MISSING',
          `마스터 ${shortName(m.name)}에 필수 구성요소 ${presentCount}/${kinds.length}`,
          vitalMissing || presentCount <= 3 ? 'critical' : 'warning',
        ),
      );
    }

    // 마스터 노드 자체
    let reasonText: string | null = null;
    if (!reporting) {
      const dur = m.ready.since
        ? (now - Date.parse(m.ready.since)) / 1000
        : null;
      reasonText =
        dur !== null ? `NotReady ${formatDurationKo(dur)}` : 'NotReady';
      reasons.push(
        reason(
          'CONTROL_PLANE_NODE_NOT_REPORTING',
          `노드 미보고 — 마지막 보고 ${hhmm(lastReportedAt)}`,
          'unknown',
        ),
      );
      attention.push({
        ref: { kind: 'Node', namespace: null, name: m.name },
        status: quorumState === 'lost' ? 'critical' : 'warning',
        reason: reason(
          'CONTROL_PLANE_MASTER_NOT_READY',
          `마스터 ${reasonText}${quorumState === 'at_risk' ? ' · 1대 더 잃으면 쿼럼 상실' : ''}`,
          quorumState === 'lost' ? 'critical' : 'warning',
        ),
      });
    } else if (m.unschedulable) {
      reasonText = '스케줄 제외 (cordon)';
      reasons.push(
        reason(
          'CONTROL_PLANE_CORDONED',
          `마스터 ${shortName(m.name)} 스케줄 제외 (cordon)`,
          'warning',
        ),
      );
    }
    const wp = input.podsUsable ? (workerPods.get(m.name) ?? 0) : null;
    if (wp !== null && wp > 0) {
      reasons.push(
        reason(
          'CONTROL_PLANE_WORKER_PODS',
          `컨트롤 플레인 노드에 워커 파드 ${wp}개`,
          'warning',
        ),
      );
    }
    masterItems.push({
      node: m,
      reporting,
      lastReportedAt,
      components: {
        ready: myCells.filter((c) => c.ready === true).length,
        total: kinds.length,
        worst: worstStatus(myCells.map((c) => c.status.status)),
      },
      workerPodCount: wp,
      reasonText,
    });
  }

  // --- 종류별 집계 --------------------------------------------------------------
  const reportingMasters = masterItems.filter((m) => m.reporting);
  const byKind = kinds.map((kind) => {
    const mine = cells.filter((c) => c.kind === kind);
    const onReporting = mine.filter((c) =>
      reportingMasters.some((m) => m.node.name === c.nodeName),
    );
    const ready = mine.filter((c) => c.ready === true).length;
    const notReady = onReporting.filter((c) => c.ready !== true).length;
    let status: Status = worstStatus(mine.map((c) => c.status.status));
    const vital = (
      CONTROL_PLANE_RULES.vitalKinds as readonly string[]
    ).includes(kind);
    if (onReporting.length > 0 && notReady === onReporting.length && vital) {
      status = 'critical';
      reasons.push(
        reason(
          'CONTROL_PLANE_COMPONENT_DOWN',
          `${kind}가 모든 마스터에서 Ready 아님`,
          'critical',
        ),
      );
    } else if (onReporting.length > 0 && notReady > onReporting.length / 2) {
      status = 'critical';
      reasons.push(
        reason(
          'CONTROL_PLANE_COMPONENT_DOWN',
          `${kind} 과반 중단 (${notReady}/${onReporting.length})`,
          'critical',
        ),
      );
    }
    return { kind, ready, expected: total, status };
  });

  // 셀 단위 사유를 영역 사유로 올린다 (파드 코드 → 컨트롤 플레인 코드로 바꾼다)
  for (const c of cells) {
    if (c.cellState === 'critical' || c.cellState === 'warning') {
      for (const r of c.status.reasons) reasons.push(componentReason(c, r));
      attention.push({
        ref: {
          kind: 'Pod',
          namespace: 'kube-system',
          name: c.podKey?.split('/')[1] ?? c.kind,
        },
        status: c.status.status,
        reason: c.status.reasons[0]
          ? componentReason(c, c.status.reasons[0])
          : reason(
              'CONTROL_PLANE_COMPONENT_NOT_READY',
              c.kind,
              c.status.status,
            ),
      });
    }
  }

  // --- 마스터 대수·쿼럼·AZ ------------------------------------------------------
  if (quorumState === 'lost') {
    reasons.push(
      reason(
        'CONTROL_PLANE_QUORUM_LOST',
        `쿼럼 상실 — 마스터 ${readyMasters}/${total} Ready`,
        'critical',
      ),
    );
  } else if (readyMasters < total) {
    reasons.push(
      reason(
        'CONTROL_PLANE_MASTER_NOT_READY',
        `마스터 ${readyMasters}/${total} Ready${
          quorumState === 'at_risk' ? ' · 1대 더 잃으면 쿼럼 상실' : ''
        }`,
        'warning',
      ),
    );
  }
  if (haExpected && haStatus === 'single')
    reasons.push(
      reason('CONTROL_PLANE_NOT_HA', '마스터 1대 (HA 아님)', 'warning'),
    );
  if (haExpected && haStatus === 'even')
    reasons.push(
      reason(
        'CONTROL_PLANE_EVEN_MASTERS',
        `마스터 ${total}대 (짝수 — etcd 쿼럼상 이득 없음)`,
        'warning',
      ),
    );
  if (zoneSpread === 'single_zone')
    reasons.push(
      reason(
        'CONTROL_PLANE_SINGLE_ZONE',
        `마스터 ${total}대가 모두 ${zones[0]?.zone ?? '같은 AZ'}`,
        'warning',
      ),
    );

  // --- 상태·문장 ---------------------------------------------------------------
  const deduped = dedupe(sortReasons(reasons));
  const status = mk('area:controlPlane', deduped, input.kubeStale, atIso);
  const cellCounts = countCells(cells);
  const readyCells = cells.filter((c) => c.ready === true).length;
  const summaryText = `필수 ${cellCounts.total}칸 · 정상 ${cellCounts.ok} · 주의 ${cellCounts.warning} · 장애 ${cellCounts.critical} · 알 수 없음 ${cellCounts.unknownTotal}${
    cellCounts.stale > 0 ? ` · 데이터 오래됨 ${cellCounts.stale}` : ''
  }`;
  const headline =
    deduped[0]?.text ??
    `마스터 ${readyMasters}/${total} Ready · 구성요소 ${readyCells}/${cells.length}`;

  const body: ControlPlaneBody = {
    found: true,
    notFoundReason: null,
    status,
    headline,
    masters: {
      ready: readyMasters,
      total,
      haExpected,
      haStatus,
      quorum: {
        state: quorumState,
        requiredReady,
        readyMasters,
        basis: 'master_node_count',
      },
      zones,
      zoneSpread,
      totals: input.metrics,
      items: masterItems,
    },
    components: {
      requiredKinds: kinds,
      ready: readyCells,
      total: cells.length,
      cellCounts,
      summaryText,
      columns: masterItems.map((m) => ({
        nodeName: m.node.name,
        reporting: m.reporting,
        lastReportedAt: m.lastReportedAt,
        worst: m.components.worst,
        reason: m.reasonText,
      })),
      byKind,
      items: cells,
    },
    others,
    thresholds: {
      restarts1h: { ...CONTROL_PLANE_RULES.restarts1h },
      componentNotReadySec: CONTROL_PLANE_RULES.componentNotReadySec,
      masterNotReadySec: CONTROL_PLANE_RULES.masterNotReadySec,
    },
    limits: { etcdInternalMetrics: false, notes: CP_LIMIT_NOTES },
  };

  const problems: ProblemItem[] = masterItems
    .filter((m) => m.node.status.status !== 'ok' || !m.reporting)
    .slice(0, 3)
    .map((m) => ({
      ref: { kind: 'Node', namespace: null, name: m.node.name },
      status: m.reporting ? m.node.status.status : 'warning',
      reason: m.reasonText
        ? `${m.reasonText}${!m.reporting ? ` · 구성요소 ${kinds.length}종 알 수 없음` : ''}`
        : (m.node.status.reasons[0]?.text ?? '주의'),
    }));

  return {
    body,
    area: {
      status,
      found: true,
      masters: { ready: readyMasters, total },
      components: { ready: readyCells, total: cells.length },
      quorum: body.masters.quorum,
      haExpected,
      problems,
    },
    attention,
  };
}

// ---------------------------------------------------------------------------

/** 파드 판단 이유를 컨트롤 플레인 이유 코드로 옮긴다 (계약 9절) */
function componentReason(c: ControlPlaneComponent, r: Reason): Reason {
  const code = r.code.startsWith('POD_WAITING')
    ? 'CONTROL_PLANE_COMPONENT_WAITING'
    : r.code === 'POD_RESTARTS_1H'
      ? 'CONTROL_PLANE_COMPONENT_RESTARTS'
      : r.code === 'POD_OOM_RECENT'
        ? 'CONTROL_PLANE_COMPONENT_OOM'
        : r.code.startsWith('CONTROL_PLANE_')
          ? r.code
          : 'CONTROL_PLANE_COMPONENT_NOT_READY';
  if (code === r.code) return r;
  return reason(code, `${c.kind} ${r.text}`, r.status);
}

function rank(s: Status): number {
  return s === 'critical' ? 3 : s === 'warning' ? 2 : s === 'unknown' ? 1 : 0;
}

function shortName(name: string): string {
  return name.split('.')[0];
}

function dedupe(rs: Reason[]): Reason[] {
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const r of rs) {
    const k = `${r.code}|${r.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function countCells(
  cells: ControlPlaneComponent[],
): ControlPlaneBody['components']['cellCounts'] {
  const c = {
    total: cells.length,
    ok: 0,
    warning: 0,
    critical: 0,
    notReporting: 0,
    unknown: 0,
    missing: 0,
    stale: 0,
    unknownTotal: 0,
  };
  const key: Record<ControlPlaneCellState, keyof typeof c> = {
    ok: 'ok',
    warning: 'warning',
    critical: 'critical',
    not_reporting: 'notReporting',
    unknown: 'unknown',
    missing: 'missing',
    stale: 'stale',
  };
  for (const x of cells) c[key[x.cellState]] += 1;
  // PM 결정: 요약의 "알 수 없음"은 미보고·없음·알 수 없음을 하나로 센다
  c.unknownTotal = c.notReporting + c.unknown + c.missing;
  return c;
}

function buildCell(a: {
  kind: ControlPlaneComponentKind;
  node: NodeItem;
  pod: PodItem | null;
  reporting: boolean;
  lastReportedAt: string | null;
  input: ControlPlaneInput;
}): ControlPlaneComponent {
  const { kind, node, pod, reporting, lastReportedAt, input } = a;
  const base = {
    kind,
    nodeName: node.name,
    // 진입점 3. `missing`(파드 없음)이면 null, `not_reporting`이어도 파드를 알면 준다 —
    // 조회가 성공할 수도 있어 막지 않는다 (디자인 11.1, AC-LOG32)
    logHref: buildPodKeyLogHref(
      input.logLinks,
      'controlPlane',
      pod ? pod.key : null,
    ),
    podKey: pod ? pod.key : null,
    startedAt: pod?.startedAt ?? null,
  };
  const restarts24h = pod
    ? input.store.history.restartsWithin(
        pod.key,
        86_400_000,
        input.now,
        pod.restarts.total,
      ).count
    : 0;
  const restarts = {
    last1h: pod?.restarts.last1h ?? 0,
    last24h: restarts24h,
    total: pod?.restarts.total ?? 0,
    observedSec: pod?.restarts.observedSec ?? 0,
  };

  // 1) 마스터가 보고를 멈췄다 — 파드가 Running으로 남아 있어도 믿지 않는다 (AC-KOPS21)
  if (!reporting) {
    const r = reason(
      'CONTROL_PLANE_NODE_NOT_REPORTING',
      `노드 미보고 — 마지막 보고 ${hhmm(lastReportedAt)}`,
      'unknown',
    );
    return {
      ...base,
      cellState: 'not_reporting',
      cellText: '노드 미보고',
      cellDetail: `마지막 보고 ${hhmm(lastReportedAt)}`,
      cellTooltip: `${node.name}의 kubelet이 상태 보고를 멈췄습니다. 이 구성요소의 상태를 믿을 수 없습니다 (마지막 보고 ${hhmm(lastReportedAt)}).`,
      status: input.mk(`cp:${node.name}:${kind}`, [r], false, lastReportedAt),
      ready: null,
      containers: null,
      waitingReason: null,
      restarts,
      lastTermination: pod?.lastTermination ?? null,
      lastReportedAt,
      clickable: false,
    };
  }

  // 2) 필수 구성요소인데 파드가 없다 — 빈 칸을 만들지 않는다
  if (!pod) {
    const vital = (
      CONTROL_PLANE_RULES.vitalKinds as readonly string[]
    ).includes(kind);
    const r = reason(
      'CONTROL_PLANE_COMPONENT_MISSING',
      `${kind} 파드가 보이지 않습니다 (${shortName(node.name)})`,
      vital ? 'critical' : 'warning',
    );
    return {
      ...base,
      cellState: 'missing',
      cellText: '없음',
      cellDetail: '필수 구성요소가 보이지 않습니다',
      cellTooltip: `${node.name}에서 ${kind} 미러 파드를 찾지 못했습니다. 필수 구성요소입니다.`,
      status: input.mk(
        `cp:${node.name}:${kind}`,
        [r],
        input.kubeStale,
        input.atIso,
      ),
      ready: null,
      containers: null,
      waitingReason: null,
      restarts,
      lastTermination: null,
      lastReportedAt: input.atIso,
      clickable: false,
    };
  }

  const ready =
    pod.containers.total > 0 && pod.containers.ready === pod.containers.total;
  const st = pod.status.status;
  const detailParts: string[] = [];
  if (pod.waitingReason) detailParts.push(pod.waitingReason);
  if (restarts.last1h > 0) detailParts.push(`재시작 ${restarts.last1h}회`);
  if (!ready && detailParts.length === 0)
    detailParts.push(
      `컨테이너 ${pod.containers.ready}/${pod.containers.total}`,
    );
  const longText =
    pod.status.reasons.map((r) => r.text).join(' · ') ||
    (detailParts.length > 0 ? detailParts.join(' · ') : null);

  // 3) kube 출처가 stale이면 마지막 판단을 유지하되 칸을 stale로 표시
  if (input.kubeStale) {
    return {
      ...base,
      cellState: 'stale',
      cellText: '데이터 오래됨',
      cellDetail: `${hhmm(pod.status.updatedAt)} 기준`,
      cellTooltip: `클러스터 연결이 끊겨 ${hhmm(pod.status.updatedAt)} 기준의 마지막 값을 보여 줍니다.${longText ? ` (${longText})` : ''}`,
      status: pod.status,
      ready,
      containers: { ...pod.containers },
      waitingReason: pod.waitingReason,
      restarts,
      lastTermination: pod.lastTermination,
      lastReportedAt: pod.status.updatedAt,
      clickable: true,
    };
  }

  const cellState: ControlPlaneCellState =
    st === 'critical'
      ? 'critical'
      : st === 'warning'
        ? 'warning'
        : st === 'unknown'
          ? 'unknown'
          : 'ok';
  const cellText =
    cellState === 'ok'
      ? 'Ready'
      : cellState === 'warning'
        ? '주의'
        : cellState === 'critical'
          ? '장애'
          : '알 수 없음';
  // 짧은 쪽을 cellDetail에, 전체 문장은 cellTooltip에 (잘려도 닿을 수 있게)
  const shortDetail =
    cellState === 'ok' ? null : detailParts.join(' · ') || longText;
  return {
    ...base,
    cellState,
    cellText,
    cellDetail: shortDetail,
    cellTooltip: cellState === 'ok' ? null : (longText ?? shortDetail),
    status: pod.status,
    ready,
    containers: { ...pod.containers },
    waitingReason: pod.waitingReason,
    restarts,
    lastTermination: pod.lastTermination,
    lastReportedAt: pod.status.updatedAt ?? input.atIso,
    clickable: true,
  };
}

/** 컨트롤 플레인 파드 키(kube-system 미러 파드) 목록 — 워커 파드 수 계산에 쓴다 */
export function controlPlanePodKeys(
  rawPods: Map<string, RawPod>,
  masterNames: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const p of rawPods.values()) {
    if (!p.nodeName || !masterNames.has(p.nodeName)) continue;
    if (p.namespace !== 'kube-system') continue;
    if (componentKindOf(p.name) === null) continue;
    out.add(podKey(p.namespace, p.name));
  }
  return out;
}
