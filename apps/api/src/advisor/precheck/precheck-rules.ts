/**
 * 규칙 기반 사전 점검 (LLM 없음, 순수 함수)
 * 명세 docs/specs/architecture-advisor.md 3.2, 계약 docs/api/architecture-advisor.md A.4
 * 입력은 정제된 스냅샷(AdvisorSnapshotV1, prechecks 제외)이다.
 */
import type {
  Category,
  Evidence,
  PrecheckCounts,
  PrecheckItem,
  Savings,
  Severity,
  SourceAvailability,
  TargetKind,
  TargetRef,
} from '../advisor.types';
import type { PseudonymMap } from '../snapshot/sanitize-snapshot';
import type {
  AdvisorSnapshotV1,
  SnapshotPrecheck,
  SnapshotWorkload,
} from '../snapshot/snapshot.types';

export interface PrecheckThresholds {
  restarts24h: number;
  overRequestCpuPct: number;
  nodeIdleRequestsPct: number;
  unallocatedPct: number;
  minObservationMin: number;
  dbConnectionUsagePct: number;
  dbXidAge: number;
  dbPvcUsageWarnPct: number;
  dbPvcUsageCritPct: number;
}

export const DEFAULT_PRECHECK_THRESHOLDS: PrecheckThresholds = {
  restarts24h: 5,
  overRequestCpuPct: 20,
  nodeIdleRequestsPct: 30,
  unallocatedPct: 40,
  minObservationMin: 60,
  dbConnectionUsagePct: 70,
  dbXidAge: 500_000_000,
  dbPvcUsageWarnPct: 75,
  dbPvcUsageCritPct: 90,
};

export const DEFAULT_SYSTEM_NAMESPACES: readonly string[] = [
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'amazon-cloudwatch',
];

export const HOURS_PER_MONTH = 730;
const MAX_TARGETS = 50;
const MAX_EVIDENCE = 10;
const GIB = 1024 ** 3;

interface RuleDef {
  title: string;
  category: Category;
}

/** 규칙 설명(툴팁)과 대표 카테고리 (A.4 매핑표) */
export const RULES: Record<string, RuleDef> = {
  'R-REQ': {
    title: '컨테이너에 CPU 또는 메모리 requests 미설정',
    category: 'reliability',
  },
  'R-MEMLIM': { title: '메모리 limit 미설정', category: 'reliability' },
  'R-SINGLE': {
    title: 'Deployment/StatefulSet desired = 1 (의도적 단일 여부는 알 수 없음)',
    category: 'reliability',
  },
  'R-PDB': {
    title: 'desired ≥ 2인 워크로드에 PodDisruptionBudget 없음',
    category: 'reliability',
  },
  'R-RESTART': {
    title: '최근 24시간 재시작 5회 이상',
    category: 'reliability',
  },
  'R-OOM': { title: '최근 24시간 OOMKilled 발생', category: 'reliability' },
  'R-PROBE': {
    title: 'readiness 또는 liveness probe 미설정',
    category: 'reliability',
  },
  'R-LATEST': {
    title: '이미지 태그가 latest 또는 태그 없음',
    category: 'reliability',
  },
  'R-OVERREQ': {
    title: '파드 CPU 사용량이 requests의 20% 미만 (최소 1시간 관측)',
    category: 'cost',
  },
  'R-NODEIDLE': {
    title: '노드 CPU·메모리 requests 비율이 모두 30% 미만 (최소 1시간 관측)',
    category: 'cost',
  },
  'R-UNALLOC': {
    title: '네임스페이스 배분의 미할당(유휴) 비율 40% 이상',
    category: 'cost',
  },
  'R-GP2': {
    title: 'gp2 EBS 볼륨 (gp3 전환 시 GB 단가 차이로 절감액 계산)',
    category: 'cost',
  },
  'R-EBSIDLE': {
    title: '연결되지 않은 클러스터 태그 EBS 볼륨',
    category: 'cost',
  },
  'R-LBIDLE': { title: '정상 대상이 0개인 로드밸런서', category: 'cost' },
  'R-ONDEMAND': {
    title: '무상태 워크로드만 있는 노드그룹이 전부 온디맨드 (스팟 후보)',
    category: 'cost',
  },
  'R-GRAVITON': {
    title:
      'x86 인스턴스보다 같은 크기 Graviton이 더 저렴 (이미지 arm64 지원 확인 필요)',
    category: 'cost',
  },
  'R-EKSVER': {
    title: 'EKS 버전이 확장 지원 구간 (컨트롤 플레인 단가 상승)',
    category: 'cost',
  },
  'R-PRIV': {
    title: 'privileged 컨테이너 또는 allowPrivilegeEscalation 미차단',
    category: 'security',
  },
  'R-ROOT': { title: 'runAsNonRoot 미설정', category: 'security' },
  'R-HOST': {
    title: 'hostNetwork/hostPID/hostPath 사용 (시스템 네임스페이스 제외)',
    category: 'security',
  },
  'R-SA': {
    title: '기본 서비스 계정 + 토큰 자동 마운트',
    category: 'security',
  },
  'R-DB-SINGLE': {
    title: 'Postgres 레플리카 1개 (standby 없음)',
    category: 'database',
  },
  'R-DB-PVC': {
    title: 'DB PVC 사용률 75% 이상 (90% 이상 높음)',
    category: 'database',
  },
  'R-DB-CONN': {
    title: '최근 관측 최대 연결 사용률 70% 이상 (커넥션 풀러 검토)',
    category: 'database',
  },
  'R-DB-XID': { title: '트랜잭션 ID 나이 5억 이상', category: 'database' },
  'R-DB-RES': {
    title: 'DB 파드 requests/limits 미설정 또는 QoS가 Guaranteed가 아님',
    category: 'database',
  },
  'R-DB-SPOT': { title: 'DB 파드가 스팟 노드에 있음', category: 'database' },
};

export interface PrecheckContext {
  thresholds?: PrecheckThresholds;
  includeSystem?: boolean;
  systemNamespaces?: readonly string[];
  pseudonyms?: PseudonymMap;
  /** 섹션 출처가 있었는지 (없으면 해당 규칙을 돌리지 않는다) */
  sources?: { cluster: boolean; cost: boolean; db: boolean };
}

export interface PrecheckComputation {
  items: PrecheckItem[];
  counts: PrecheckCounts;
  matrix: Record<Category, { high: number; medium: number; low: number }>;
  sources: {
    cluster: SourceAvailability;
    cost: SourceAvailability;
    db: SourceAvailability;
  };
}

// ---------------------------------------------------------------------------
// 도우미
// ---------------------------------------------------------------------------

const SCREEN_KINDS = new Set([
  'Node',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'Pod',
  'PersistentVolumeClaim',
]);

export function makeTarget(
  kind: TargetKind,
  namespace: string | null,
  snapshotName: string,
  realName: string = snapshotName,
): TargetRef {
  return {
    kind,
    namespace,
    name: realName,
    snapshotName: namespace ? `${namespace}/${snapshotName}` : snapshotName,
    inSnapshot: true,
    ref: SCREEN_KINDS.has(kind) ? { kind, namespace, name: realName } : null,
  };
}

const usd = (n: number, digits = 4): string => `$${n.toFixed(digits)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function wlKey(w: SnapshotWorkload): string {
  return `${w.namespace}/${w.name}`;
}

interface Hit {
  target: TargetRef;
  evidence: Evidence[];
}

interface ItemInput {
  ruleId: string;
  severity: Severity;
  summary: string;
  evidenceText: string;
  hits: Hit[];
  savings?: Savings | null;
}

function item(i: ItemInput): PrecheckItem {
  const rule = RULES[i.ruleId];
  return {
    id: i.ruleId,
    ruleId: i.ruleId,
    ruleTitle: rule.title,
    category: rule.category,
    severity: i.severity,
    summary: i.summary,
    evidenceText: i.evidenceText,
    targets: i.hits.slice(0, MAX_TARGETS).map((h) => h.target),
    targetCount: i.hits.length,
    evidence: i.hits.flatMap((h) => h.evidence).slice(0, MAX_EVIDENCE),
    savings: i.savings ?? null,
    held: false,
    heldReason: null,
    observedSec: null,
    requiredSec: null,
    source: 'rule',
  };
}

function heldItem(
  ruleId: string,
  observedSec: number,
  requiredSec: number,
): PrecheckItem {
  const reason = `관측 ${Math.floor(observedSec / 60)}분 · 최소 ${Math.floor(requiredSec / 60)}분 필요`;
  return {
    id: ruleId,
    ruleId,
    ruleTitle: RULES[ruleId].title,
    category: RULES[ruleId].category,
    severity: null,
    summary: '판단 보류',
    evidenceText: reason,
    targets: [],
    targetCount: 0,
    evidence: [],
    savings: null,
    held: true,
    heldReason: reason,
    observedSec,
    requiredSec,
    source: 'rule',
  };
}

const ev = (
  field: string,
  value: string | number | null,
  text: string,
): Evidence => ({
  field,
  value,
  text,
  verified: true,
});

// ---------------------------------------------------------------------------
// 규칙
// ---------------------------------------------------------------------------

export function computePrechecks(
  snap: AdvisorSnapshotV1,
  ctx: PrecheckContext = {},
): PrecheckComputation {
  const t = ctx.thresholds ?? DEFAULT_PRECHECK_THRESHOLDS;
  const systemNs = new Set(ctx.systemNamespaces ?? DEFAULT_SYSTEM_NAMESPACES);
  const includeSystem = ctx.includeSystem ?? false;
  const sources = ctx.sources ?? {
    cluster: true,
    cost: snap.cost !== null,
    db: snap.db !== null,
  };
  const nodeReal = (alias: string) => ctx.pseudonyms?.nodes[alias] ?? alias;
  const asOf = snap.cost?.asOf ?? snap.meta.generatedAt;

  const inScope = (ns: string) => includeSystem || !systemNs.has(ns);
  const workloads = sources.cluster
    ? snap.workloads.filter((w) => inScope(w.namespace))
    : [];
  const storage = sources.cluster
    ? snap.storage.filter((s) => inScope(s.namespace))
    : [];
  const nodes = sources.cluster ? snap.nodes : [];
  const nodeGroups = sources.cluster ? snap.nodeGroups : [];
  const items: PrecheckItem[] = [];
  const wlTarget = (w: SnapshotWorkload) =>
    makeTarget(w.kind, w.namespace, w.name);

  // --- R-REQ / R-MEMLIM / R-PROBE / R-LATEST / R-PRIV / R-ROOT: 컨테이너 단위 → 워크로드 대상 ---
  const containerRule = (
    ruleId: string,
    severity: Severity,
    pred: (c: SnapshotWorkload['containers'][number]) => boolean,
    evidence: (
      w: SnapshotWorkload,
      c: SnapshotWorkload['containers'][number],
    ) => Evidence,
    summary: (containers: number, workloads: number) => string,
    evidenceText: string,
  ) => {
    const hits: Hit[] = [];
    let containerCount = 0;
    for (const w of workloads) {
      const bad = w.containers.filter(pred);
      if (bad.length === 0) continue;
      containerCount += bad.length;
      hits.push({
        target: wlTarget(w),
        evidence: bad.map((c) => evidence(w, c)),
      });
    }
    if (hits.length > 0) {
      items.push(
        item({
          ruleId,
          severity,
          summary: summary(containerCount, hits.length),
          evidenceText,
          hits,
        }),
      );
    }
  };
  const cPath = (w: SnapshotWorkload, c: { name: string }) =>
    `workloads[${wlKey(w)}].containers[${c.name}]`;

  containerRule(
    'R-REQ',
    'medium',
    (c) => c.requests.cpuMillicores === null || c.requests.memoryBytes === null,
    (w, c) =>
      ev(
        `${cPath(w, c)}.requests.${c.requests.cpuMillicores === null ? 'cpuMillicores' : 'memoryBytes'}`,
        null,
        `${wlKey(w)} · ${c.name}: ${c.requests.cpuMillicores === null ? 'CPU' : '메모리'} requests 미설정`,
      ),
    (n, m) => `requests 미설정 컨테이너 ${n}개 (워크로드 ${m}개)`,
    '스케줄링·비용 배분이 부정확해지고 노드 과밀 위험',
  );
  containerRule(
    'R-MEMLIM',
    'low',
    (c) => c.limits.memoryBytes === null,
    (w, c) =>
      ev(
        `${cPath(w, c)}.limits.memoryBytes`,
        null,
        `${wlKey(w)} · ${c.name}: 메모리 limit 미설정`,
      ),
    (n, m) => `메모리 limit 미설정 컨테이너 ${n}개 (워크로드 ${m}개)`,
    '메모리 누수 시 같은 노드의 다른 파드까지 영향',
  );
  containerRule(
    'R-PROBE',
    'low',
    (c) => !c.probes.readiness || !c.probes.liveness,
    (w, c) =>
      ev(
        `${cPath(w, c)}.probes.${!c.probes.readiness ? 'readiness' : 'liveness'}`,
        'false',
        `${wlKey(w)} · ${c.name}: ${!c.probes.readiness ? 'readiness' : 'liveness'} probe 없음`,
      ),
    (n, m) => `probe 미설정 컨테이너 ${n}개 (워크로드 ${m}개)`,
    '장애 파드가 트래픽을 받거나 멈춘 채 재시작되지 않을 수 있음',
  );
  containerRule(
    'R-LATEST',
    'low',
    (c) => isLatestTag(c.image),
    (w, c) =>
      ev(
        `${cPath(w, c)}.image`,
        c.image,
        `${wlKey(w)} · ${c.name}: 이미지 ${c.image}`,
      ),
    (n, m) => `latest/태그 없는 이미지 ${n}개 (워크로드 ${m}개)`,
    '재배포 시 다른 이미지가 올라올 수 있음',
  );
  containerRule(
    'R-PRIV',
    'medium',
    (c) =>
      c.security.privileged || c.security.allowPrivilegeEscalation !== false,
    (w, c) =>
      c.security.privileged
        ? ev(
            `${cPath(w, c)}.security.privileged`,
            'true',
            `${wlKey(w)} · ${c.name}: privileged`,
          )
        : ev(
            `${cPath(w, c)}.security.allowPrivilegeEscalation`,
            c.security.allowPrivilegeEscalation === null ? null : 'true',
            `${wlKey(w)} · ${c.name}: allowPrivilegeEscalation 미차단`,
          ),
    (n, m) => `권한 상승 가능 컨테이너 ${n}개 (워크로드 ${m}개)`,
    '컨테이너 탈출 시 노드 권한 획득 위험',
  );
  containerRule(
    'R-ROOT',
    'low',
    (c) => c.security.runAsNonRoot !== true,
    (w, c) =>
      ev(
        `${cPath(w, c)}.security.runAsNonRoot`,
        null,
        `${wlKey(w)} · ${c.name}: runAsNonRoot 미설정`,
      ),
    (n, m) => `runAsNonRoot 미설정 컨테이너 ${n}개 (워크로드 ${m}개)`,
    'root로 실행될 수 있음',
  );

  // --- 워크로드 단위 ---
  const workloadRule = (
    ruleId: string,
    severity: Severity,
    list: SnapshotWorkload[],
    evidence: (w: SnapshotWorkload) => Evidence,
    summary: (n: number) => string,
    evidenceText: string,
  ) => {
    if (list.length === 0) return;
    items.push(
      item({
        ruleId,
        severity,
        summary: summary(list.length),
        evidenceText,
        hits: list.map((w) => ({
          target: wlTarget(w),
          evidence: [evidence(w)],
        })),
      }),
    );
  };

  const dbWorkloads = new Set(
    workloads.filter((w) => isDbWorkload(w)).map((w) => wlKey(w)),
  );
  workloadRule(
    'R-SINGLE',
    'medium',
    workloads.filter(
      (w) =>
        w.kind !== 'DaemonSet' && w.desired === 1 && !dbWorkloads.has(wlKey(w)),
    ),
    (w) => ev(`workloads[${wlKey(w)}].desired`, 1, `${wlKey(w)} 레플리카 1개`),
    (n) => `단일 레플리카 워크로드 ${n}개`,
    '파드·노드 교체 중 서비스 중단',
  );
  workloadRule(
    'R-PDB',
    'low',
    workloads.filter(
      (w) => w.kind !== 'DaemonSet' && (w.desired ?? 0) >= 2 && !w.hasPdb,
    ),
    (w) =>
      ev(
        `workloads[${wlKey(w)}].hasPdb`,
        'false',
        `${wlKey(w)} 레플리카 ${w.desired}개, PDB 없음`,
      ),
    (n) => `PDB 없는 다중 레플리카 워크로드 ${n}개`,
    '노드 드레인 시 모든 파드가 동시에 내려갈 수 있음',
  );
  workloadRule(
    'R-RESTART',
    'high',
    workloads.filter((w) => w.restarts24h >= t.restarts24h),
    (w) =>
      ev(
        `workloads[${wlKey(w)}].restarts24h`,
        w.restarts24h,
        `${wlKey(w)} 최근 24시간 재시작 ${w.restarts24h}회`,
      ),
    (n) => `재시작 잦은 워크로드 ${n}개`,
    `최근 24시간 재시작 ${t.restarts24h}회 이상`,
  );
  workloadRule(
    'R-OOM',
    'high',
    workloads.filter((w) => w.oom24h > 0),
    (w) =>
      ev(
        `workloads[${wlKey(w)}].oom24h`,
        w.oom24h,
        `${wlKey(w)} 최근 24시간 OOMKilled ${w.oom24h}회`,
      ),
    (n) => `OOMKilled 발생 워크로드 ${n}개`,
    '메모리 limit 부족 또는 누수',
  );
  workloadRule(
    'R-HOST',
    'medium',
    workloads.filter(
      (w) =>
        !systemNs.has(w.namespace) &&
        (w.podSecurity.hostNetwork ||
          w.podSecurity.hostPID ||
          w.podSecurity.hostPath),
    ),
    (w) => {
      const which = w.podSecurity.hostNetwork
        ? 'hostNetwork'
        : w.podSecurity.hostPID
          ? 'hostPID'
          : 'hostPath';
      return ev(
        `workloads[${wlKey(w)}].podSecurity.${which}`,
        'true',
        `${wlKey(w)} ${which} 사용`,
      );
    },
    (n) => `호스트 자원 사용 워크로드 ${n}개`,
    '노드 네트워크·프로세스·파일시스템 노출',
  );
  workloadRule(
    'R-SA',
    'low',
    workloads.filter(
      (w) =>
        w.podSecurity.defaultServiceAccount &&
        w.podSecurity.automountToken !== false,
    ),
    (w) =>
      ev(
        `workloads[${wlKey(w)}].podSecurity.defaultServiceAccount`,
        'true',
        `${wlKey(w)} default 서비스 계정 + 토큰 자동 마운트`,
      ),
    (n) => `기본 서비스 계정 토큰 마운트 워크로드 ${n}개`,
    '불필요한 API 토큰 노출',
  );

  // --- R-OVERREQ (관측 필요) ---
  const minObsSec = t.minObservationMin * 60;
  const obsSec = snap.meta.observationSec.metrics;
  if (sources.cluster) {
    if (obsSec < minObsSec) {
      items.push(heldItem('R-OVERREQ', obsSec, minObsSec));
    } else {
      const hits: Hit[] = [];
      for (const w of workloads) {
        const bad = w.containers.filter(
          (c) =>
            c.requests.cpuMillicores !== null &&
            c.requests.cpuMillicores > 0 &&
            c.usage?.cpuAvgMillicores !== null &&
            c.usage?.cpuAvgMillicores !== undefined &&
            (c.usage.cpuAvgMillicores / c.requests.cpuMillicores) * 100 <
              t.overRequestCpuPct,
        );
        if (bad.length === 0) continue;
        hits.push({
          target: wlTarget(w),
          evidence: bad.map((c) =>
            ev(
              `${cPath(w, c)}.usage.cpuAvgMillicores`,
              c.usage?.cpuAvgMillicores ?? null,
              `${wlKey(w)} · ${c.name}: CPU 평균 ${c.usage?.cpuAvgMillicores}m / requests ${c.requests.cpuMillicores}m`,
            ),
          ),
        });
      }
      if (hits.length > 0) {
        items.push(
          item({
            ruleId: 'R-OVERREQ',
            severity: 'medium',
            summary: `CPU requests 과다 워크로드 ${hits.length}개`,
            evidenceText: `CPU 사용량이 requests의 ${t.overRequestCpuPct}% 미만 (관측 ${Math.floor(obsSec / 60)}분)`,
            hits,
          }),
        );
      }
    }
  }

  // --- R-NODEIDLE (관측 필요) ---
  if (sources.cluster && nodes.length > 0) {
    if (obsSec < minObsSec) {
      items.push(heldItem('R-NODEIDLE', obsSec, minObsSec));
    } else {
      const idle = nodes.filter(
        (n) =>
          n.cpu.requestsPct < t.nodeIdleRequestsPct &&
          n.memory.requestsPct < t.nodeIdleRequestsPct,
      );
      if (idle.length > 0) {
        items.push(
          item({
            ruleId: 'R-NODEIDLE',
            severity: 'medium',
            summary: `유휴 노드 ${idle.length}개`,
            evidenceText: `CPU·메모리 requests 비율 모두 ${t.nodeIdleRequestsPct}% 미만`,
            hits: idle.map((n) => ({
              target: makeTarget('Node', null, n.name, nodeReal(n.name)),
              evidence: [
                ev(
                  `nodes[${n.name}].cpu.requestsPct`,
                  n.cpu.requestsPct,
                  `${n.name} CPU requests ${n.cpu.requestsPct}%, 메모리 ${n.memory.requestsPct}%`,
                ),
              ],
            })),
          }),
        );
      }
    }
  }

  // --- 비용 ---
  const cost = sources.cost ? snap.cost : null;
  if (cost) {
    const unalloc = cost.allocation.find((a) => a.namespace === 'unallocated');
    if (unalloc && unalloc.sharePct >= t.unallocatedPct) {
      items.push(
        item({
          ruleId: 'R-UNALLOC',
          severity: 'medium',
          summary: `미할당(유휴) 비율 ${unalloc.sharePct}%`,
          evidenceText: `노드 비용 중 파드 requests로 배분되지 않은 비율 ≥ ${t.unallocatedPct}%`,
          hits: [
            {
              target: makeTarget('Cluster', null, 'cluster'),
              evidence: [
                ev(
                  'cost.allocation[unallocated].sharePct',
                  unalloc.sharePct,
                  `미할당 월 $${round2(unalloc.usdPerMonth)} (${unalloc.sharePct}%)`,
                ),
              ],
            },
          ],
        }),
      );
    }
  }

  // R-GP2: 스토리지는 클러스터 출처, 절감액은 비용 단가가 있을 때만
  const gp2 = storage.filter((s) => s.volumeType === 'gp2');
  if (gp2.length > 0) {
    const g2 = cost?.ebsGbMonth.gp2 ?? null;
    const g3 = cost?.ebsGbMonth.gp3 ?? null;
    let savings: Savings | null = null;
    const totalGb = gp2.reduce((s, v) => s + (v.capacityBytes ?? 0) / GIB, 0);
    if (g2 !== null && g3 !== null && g2 > g3 && totalGb > 0) {
      const monthly = round2((g2 - g3) * totalGb);
      savings = {
        monthlyUsd: monthly,
        kind: 'estimated',
        asOf,
        formula: `(${usd(g2)} − ${usd(g3)}) × ${round2(totalGb)} GB = ${usd(monthly, 2)}/월`,
        source: 'server',
      };
    }
    items.push(
      item({
        ruleId: 'R-GP2',
        severity: 'low',
        summary: `gp2 EBS 볼륨 ${gp2.length}개`,
        evidenceText:
          g2 !== null && g3 !== null && g2 > 0
            ? `gp3 전환 시 GB 단가 −${Math.round(((g2 - g3) / g2) * 100)}%`
            : 'gp3 전환 시 GB 단가가 더 낮음',
        hits: gp2.map((s) => ({
          target: makeTarget('PersistentVolumeClaim', s.namespace, s.name),
          evidence: [
            ev(
              `storage[${s.namespace}/${s.name}].volumeType`,
              'gp2',
              `볼륨 타입 gp2${s.capacityBytes ? ` · ${round2(s.capacityBytes / GIB)} GiB` : ''}`,
            ),
          ],
        })),
        savings,
      }),
    );
  }

  const idleVolumes =
    sources.cost || sources.cluster
      ? snap.unattachedVolumes.filter((v) => v.clusterTagged)
      : [];
  if (idleVolumes.length > 0 && (sources.cost || sources.cluster)) {
    const total = idleVolumes.reduce((s, v) => s + (v.usdPerMonth ?? 0), 0);
    const allPriced = idleVolumes.every((v) => v.usdPerMonth !== null);
    items.push(
      item({
        ruleId: 'R-EBSIDLE',
        severity: 'medium',
        summary: `연결되지 않은 EBS 볼륨 ${idleVolumes.length}개`,
        evidenceText: '어떤 인스턴스에도 연결되지 않은 클러스터 태그 볼륨',
        hits: idleVolumes.map((v) => ({
          target: makeTarget('Other', null, v.volumeRef, v.volumeRef),
          evidence: [
            ev(
              `unattachedVolumes[${v.volumeRef}].capacityBytes`,
              v.capacityBytes,
              `${v.volumeRef} ${v.volumeType} ${round2(v.capacityBytes / GIB)} GiB 미연결`,
            ),
          ],
        })),
        savings:
          allPriced && total > 0
            ? {
                monthlyUsd: round2(total),
                kind: 'estimated',
                asOf,
                formula: `미연결 볼륨 ${idleVolumes.length}개 월 비용 합계 = ${usd(round2(total), 2)}/월`,
                source: 'server',
              }
            : null,
      }),
    );
  }

  const idleLbs =
    sources.cost || sources.cluster
      ? snap.loadBalancers.filter((l) => l.healthyTargets === 0)
      : [];
  if (idleLbs.length > 0) {
    const total = idleLbs.reduce((s, l) => s + (l.usdPerMonth ?? 0), 0);
    const allPriced = idleLbs.every((l) => l.usdPerMonth !== null);
    items.push(
      item({
        ruleId: 'R-LBIDLE',
        severity: 'medium',
        summary: `정상 대상 없는 로드밸런서 ${idleLbs.length}개`,
        evidenceText: '등록된 정상 대상 0개',
        hits: idleLbs.map((l) => ({
          target: makeTarget('LoadBalancer', null, l.ref, l.ref),
          evidence: [
            ev(
              `loadBalancers[${l.ref}].healthyTargets`,
              0,
              `${l.ref} (${l.type}) 정상 대상 0개`,
            ),
          ],
        })),
        savings:
          allPriced && total > 0
            ? {
                monthlyUsd: round2(total),
                kind: 'estimated',
                asOf,
                formula: `로드밸런서 ${idleLbs.length}개 월 비용 합계 = ${usd(round2(total), 2)}/월`,
                source: 'server',
              }
            : null,
      }),
    );
  }

  // R-ONDEMAND / R-GRAVITON: 노드그룹 + 대체 단가
  const alt = (type: string) =>
    cost?.alternatives.find((a) => a.instanceType === type);
  const onDemandGroups = nodeGroups.filter(
    (g) => g.statelessOnly && g.capacityType === 'on_demand',
  );
  if (onDemandGroups.length > 0) {
    let monthly = 0;
    const parts: string[] = [];
    let priced = true;
    for (const g of onDemandGroups) {
      for (const it of g.instanceTypes) {
        const a = alt(it.type);
        const cur = a?.currentUsdPerHour ?? null;
        const spot = a?.spot?.usdPerHour ?? null;
        if (cur === null || spot === null) {
          priced = false;
          continue;
        }
        if (cur <= spot) continue;
        monthly += (cur - spot) * HOURS_PER_MONTH * it.count;
        parts.push(
          `(${usd(cur)} − ${usd(spot)})/h × ${HOURS_PER_MONTH}h × ${it.count}대`,
        );
      }
    }
    items.push(
      item({
        ruleId: 'R-ONDEMAND',
        severity: 'low',
        summary: `스팟 후보 노드그룹 ${onDemandGroups.length}개`,
        evidenceText:
          '무상태 워크로드만 있는 온디맨드 노드그룹 (스팟 회수 시 재시작 감수 필요)',
        hits: onDemandGroups.map((g) => ({
          target: makeTarget('NodeGroup', null, g.name),
          evidence: [
            ev(
              `nodeGroups[${g.name}].capacityType`,
              'on_demand',
              `${g.name} 온디맨드 ${g.nodeCount}대, 무상태 워크로드만`,
            ),
          ],
        })),
        savings:
          priced && monthly > 0
            ? {
                monthlyUsd: round2(monthly),
                kind: 'estimated',
                asOf,
                formula: `${parts.join(' + ')} = ${usd(round2(monthly), 2)}/월`,
                source: 'server',
              }
            : null,
      }),
    );
  }

  if (cost) {
    const hits: Hit[] = [];
    let monthly = 0;
    const parts: string[] = [];
    for (const g of nodeGroups) {
      if (g.architecture && !/^(amd64|x86_64)$/i.test(g.architecture)) continue;
      for (const it of g.instanceTypes) {
        const a = alt(it.type);
        const cur = a?.currentUsdPerHour ?? null;
        const grav = a?.graviton?.usdPerHour ?? null;
        if (!a?.graviton || cur === null || grav === null || grav >= cur)
          continue;
        const m = (cur - grav) * HOURS_PER_MONTH * it.count;
        monthly += m;
        parts.push(
          `(${usd(cur)} − ${usd(grav)})/h × ${HOURS_PER_MONTH}h × ${it.count}대`,
        );
        hits.push({
          target: makeTarget('NodeGroup', null, g.name),
          evidence: [
            ev(
              `cost.alternatives[${it.type}].graviton.usdPerHour`,
              grav,
              `${g.name}: ${it.type} ${usd(cur)}/h → ${a.graviton.type} ${usd(grav)}/h (${it.count}대)`,
            ),
          ],
        });
      }
    }
    if (hits.length > 0) {
      items.push(
        item({
          ruleId: 'R-GRAVITON',
          severity: 'low',
          summary: `Graviton 전환 후보 노드그룹 ${new Set(hits.map((h) => h.target.name)).size}개`,
          evidenceText:
            '같은 크기 Graviton 타입이 더 저렴 (이미지 arm64 지원 확인 필요)',
          hits,
          savings: {
            monthlyUsd: round2(monthly),
            kind: 'estimated',
            asOf,
            formula: `${parts.join(' + ')} = ${usd(round2(monthly), 2)}/월`,
            source: 'server',
          },
        }),
      );
    }
  }

  if (sources.cluster && snap.cluster.supportTier === 'extended') {
    items.push(
      item({
        ruleId: 'R-EKSVER',
        severity: 'high',
        summary: `EKS ${snap.cluster.version} 확장 지원 구간`,
        evidenceText: '확장 지원 구간은 컨트롤 플레인 시간당 단가가 올라감',
        hits: [
          {
            target: makeTarget('Cluster', null, 'cluster'),
            evidence: [
              ev(
                'cluster.supportTier',
                'extended',
                `EKS ${snap.cluster.version} 확장 지원`,
              ),
            ],
          },
        ],
      }),
    );
  }

  // --- DB ---
  const db = sources.db ? snap.db : null;
  if (db) {
    const dbTarget = makeTarget('Database', null, 'postgres');
    const dbRule = (
      ruleId: string,
      severity: Severity,
      summary: string,
      evidenceText: string,
      e: Evidence,
    ) =>
      items.push(
        item({
          ruleId,
          severity,
          summary,
          evidenceText,
          hits: [{ target: dbTarget, evidence: [e] }],
        }),
      );
    if (db.replicas === 1) {
      dbRule(
        'R-DB-SINGLE',
        'medium',
        'Postgres 레플리카 1개',
        'standby 없음: 파드·노드 장애 시 DB 중단',
        ev('db.replicas', 1, 'Postgres 레플리카 1개'),
      );
    }
    if (db.pvcUsagePct !== null && db.pvcUsagePct >= t.dbPvcUsageWarnPct) {
      dbRule(
        'R-DB-PVC',
        db.pvcUsagePct >= t.dbPvcUsageCritPct ? 'high' : 'medium',
        `DB PVC 사용률 ${db.pvcUsagePct}%`,
        `사용률 ${t.dbPvcUsageWarnPct}% 이상${db.pvcUsageSource === 'db_size_approx' ? ' (DB 크기 기준 근사)' : ''}`,
        ev(
          'db.pvcUsagePct',
          db.pvcUsagePct,
          `DB PVC 사용률 ${db.pvcUsagePct}%`,
        ),
      );
    }
    if (
      db.connections.maxObservedPct !== null &&
      db.connections.maxObservedPct >= t.dbConnectionUsagePct
    ) {
      dbRule(
        'R-DB-CONN',
        'medium',
        `최대 연결 사용률 ${db.connections.maxObservedPct}%`,
        '커넥션 풀러(PgBouncer 등) 검토',
        ev(
          'db.connections.maxObservedPct',
          db.connections.maxObservedPct,
          `관측 최대 연결 사용률 ${db.connections.maxObservedPct}% (max ${db.connections.max ?? '?'})`,
        ),
      );
    }
    if (db.xidAge !== null && db.xidAge >= t.dbXidAge) {
      dbRule(
        'R-DB-XID',
        'high',
        `트랜잭션 ID 나이 ${db.xidAge.toLocaleString('en-US')}`,
        'wraparound 방지 VACUUM 필요',
        ev(
          'db.xidAge',
          db.xidAge,
          `xid 나이 ${db.xidAge.toLocaleString('en-US')}`,
        ),
      );
    }
    if (
      !db.resources.requestsSet ||
      !db.resources.limitsSet ||
      (db.resources.qosClass !== null && db.resources.qosClass !== 'Guaranteed')
    ) {
      dbRule(
        'R-DB-RES',
        'medium',
        `DB 파드 QoS ${db.resources.qosClass ?? '알 수 없음'}`,
        'requests/limits를 같게 설정해 Guaranteed QoS 권장',
        ev(
          'db.resources.qosClass',
          db.resources.qosClass,
          `QoS ${db.resources.qosClass ?? '?'} · requests ${db.resources.requestsSet ? '있음' : '없음'} · limits ${db.resources.limitsSet ? '있음' : '없음'}`,
        ),
      );
    }
    if (db.onSpot === true) {
      dbRule(
        'R-DB-SPOT',
        'high',
        'DB 파드가 스팟 노드에 있음',
        '스팟 회수 시 DB 중단',
        ev('db.onSpot', 'true', 'DB 파드가 스팟 노드에 배치됨'),
      );
    }
  }

  const sorted = sortPrechecks(items);
  return {
    items: sorted,
    counts: countPrechecks(sorted),
    matrix: precheckMatrix(sorted),
    sources: {
      cluster: sources.cluster ? 'ok' : 'unknown',
      cost: sources.cost ? 'ok' : 'unknown',
      db: sources.db ? 'ok' : 'unknown',
    },
  };
}

export function isLatestTag(image: string): boolean {
  const last = image.split('/').pop() ?? image;
  const idx = last.lastIndexOf(':');
  if (idx === -1) return true;
  return last.slice(idx + 1) === 'latest';
}

function isDbWorkload(w: SnapshotWorkload): boolean {
  return (
    w.kind === 'StatefulSet' &&
    w.containers.some((c) => /(^|\/)postgres(ql)?(:|$)/i.test(c.image))
  );
}

const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** 심각도 → targetCount 내림차순 → ruleId, held는 맨 아래 (A.4) */
export function sortPrechecks(items: PrecheckItem[]): PrecheckItem[] {
  return [...items].sort((a, b) => {
    if (a.held !== b.held) return a.held ? 1 : -1;
    const sa = a.severity ? SEV_ORDER[a.severity] : 3;
    const sb = b.severity ? SEV_ORDER[b.severity] : 3;
    if (sa !== sb) return sa - sb;
    if (a.targetCount !== b.targetCount) return b.targetCount - a.targetCount;
    return a.ruleId.localeCompare(b.ruleId);
  });
}

export function countPrechecks(items: PrecheckItem[]): PrecheckCounts {
  const c: PrecheckCounts = { high: 0, medium: 0, low: 0, held: 0 };
  for (const i of items) {
    if (i.held) c.held += 1;
    else if (i.severity) c[i.severity] += 1;
  }
  return c;
}

export function precheckMatrix(
  items: PrecheckItem[],
): Record<Category, { high: number; medium: number; low: number }> {
  const m = {
    cost: { high: 0, medium: 0, low: 0 },
    reliability: { high: 0, medium: 0, low: 0 },
    performance: { high: 0, medium: 0, low: 0 },
    security: { high: 0, medium: 0, low: 0 },
    database: { high: 0, medium: 0, low: 0 },
  };
  for (const i of items) {
    if (!i.held && i.severity) m[i.category][i.severity] += 1;
  }
  return m;
}

/** 스냅샷에 넣을 사전 점검 요약 (B.2 prechecks[]). 대상 이름은 스냅샷 기준 */
export function toSnapshotPrechecks(items: PrecheckItem[]): SnapshotPrecheck[] {
  return items.map((i) => ({
    ruleId: i.ruleId,
    category: i.category,
    severity: i.severity,
    held: i.held,
    summary: i.summary,
    targets: i.targets.map((t) => ({
      kind: t.kind,
      namespace: t.namespace,
      name:
        t.namespace && t.snapshotName.startsWith(`${t.namespace}/`)
          ? t.snapshotName.slice(t.namespace.length + 1)
          : t.snapshotName,
    })),
    evidence: i.evidence.map((e) => ({
      field: e.field,
      value: e.value,
      text: e.text,
    })),
    savings: i.savings
      ? { monthlyUsd: i.savings.monthlyUsd, formula: i.savings.formula }
      : null,
  }));
}
