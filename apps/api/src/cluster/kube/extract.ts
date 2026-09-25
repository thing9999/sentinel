/**
 * 쿠버네티스 객체 → 내부 모델 (허용 목록 방식으로 필요한 필드만 복사).
 * 환경 변수·command/args·어노테이션·managedFields는 읽지 않는다.
 */
import type {
  CoreV1Event,
  V1Container,
  V1ContainerStatus,
  V1DaemonSet,
  V1Deployment,
  V1Ingress,
  V1LabelSelector,
  V1Node,
  V1PersistentVolumeClaim,
  V1Pod,
  V1PodDisruptionBudget,
  V1PodSpec,
  V1PodTemplateSpec,
  V1Service,
  V1StatefulSet,
  V2HorizontalPodAutoscaler,
} from '@kubernetes/client-node';
import type {
  ConditionValue,
  LabelSelectorRaw,
  PodSecurityRaw,
  RawCondition,
  RawContainer,
  RawContainerSpec,
  RawContainerStatus,
  RawEvent,
  RawHpa,
  RawIngress,
  RawNode,
  RawPdb,
  RawPod,
  RawPvc,
  RawService,
  RawWorkload,
} from '../model';
import { bytes, cpuMillicores } from './quantity';

function iso(v: Date | string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function condValue(v: string | undefined): ConditionValue | null {
  return v === 'True' || v === 'False' || v === 'Unknown' ? v : null;
}

function conditions(
  list:
    | {
        type: string;
        status: string;
        lastTransitionTime?: Date;
        lastUpdateTime?: Date;
        reason?: string;
        message?: string;
      }[]
    | undefined,
): RawCondition[] {
  return (list ?? []).map((c) => ({
    type: c.type,
    value: condValue(c.status),
    since: iso(c.lastTransitionTime),
    reason: c.reason ?? null,
    message: c.message ?? null,
    lastUpdateAt: iso(c.lastUpdateTime),
  }));
}

function selector(sel: V1LabelSelector | undefined): LabelSelectorRaw | null {
  if (!sel) return null;
  return {
    matchLabels: { ...(sel.matchLabels ?? {}) },
    matchExpressions: (sel.matchExpressions ?? []).map((e) => ({
      key: e.key,
      operator: e.operator,
      values: [...(e.values ?? [])],
    })),
  };
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

/** 마스터 판별 라벨. 구 `…/master`도 인정한다 (kops-support 3.1 / F8) */
const CONTROL_PLANE_LABELS = [
  'node-role.kubernetes.io/control-plane',
  'node-role.kubernetes.io/master',
] as const;

export function nodeRoleOf(
  labels: Record<string, string>,
): 'worker' | 'control_plane' {
  return CONTROL_PLANE_LABELS.some((k) => k in labels)
    ? 'control_plane'
    : 'worker';
}

export function extractNode(n: V1Node): RawNode {
  const labels = n.metadata?.labels ?? {};
  // kOps는 구매 옵션 라벨을 붙이지 않는다. 쿠버네티스 표준 라벨만 본다
  // (비용 쪽은 EC2 InstanceLifecycle을 1순위로 쓴다 — kops-support 3.3)
  const capType = labels['node.kubernetes.io/instance-lifecycle'] ?? null;
  const capacityType =
    capType === null
      ? null
      : /spot/i.test(capType)
        ? 'spot'
        : /on[-_]?demand/i.test(capType)
          ? 'on_demand'
          : null;
  const alloc = n.status?.allocatable ?? {};
  const cap = n.status?.capacity ?? {};
  return {
    name: n.metadata?.name ?? '',
    createdAt: iso(n.metadata?.creationTimestamp) ?? new Date(0).toISOString(),
    instanceType:
      labels['node.kubernetes.io/instance-type'] ??
      labels['beta.kubernetes.io/instance-type'] ??
      null,
    zone:
      labels['topology.kubernetes.io/zone'] ??
      labels['failure-domain.beta.kubernetes.io/zone'] ??
      null,
    region:
      labels['topology.kubernetes.io/region'] ??
      labels['failure-domain.beta.kubernetes.io/region'] ??
      null,
    // kOps InstanceGroup 이름 (F1). 하위 호환 키는 두지 않는다 (D1·AC-KOPS03)
    nodeGroup: labels['kops.k8s.io/instancegroup'] ?? null,
    role: nodeRoleOf(labels),
    capacityType,
    architecture: labels['kubernetes.io/arch'] ?? null,
    kubeletVersion: n.status?.nodeInfo?.kubeletVersion ?? '',
    providerId: n.spec?.providerID ?? null,
    unschedulable: n.spec?.unschedulable === true,
    conditions: conditions(
      n.status?.conditions?.map((c) => ({
        type: c.type,
        status: c.status,
        lastTransitionTime: c.lastTransitionTime,
        reason: c.reason,
        message: c.message,
      })),
    ),
    allocatable: {
      cpuMillicores: cpuMillicores(alloc.cpu) ?? 0,
      memoryBytes: bytes(alloc.memory) ?? 0,
      pods: Math.round(Number(alloc.pods ?? 0)) || 0,
    },
    capacity: {
      cpuMillicores: cpuMillicores(cap.cpu) ?? 0,
      memoryBytes: bytes(cap.memory) ?? 0,
      pods: Math.round(Number(cap.pods ?? 0)) || 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Pod
// ---------------------------------------------------------------------------

function containerSpec(c: V1Container): RawContainerSpec {
  const req = c.resources?.requests ?? {};
  const lim = c.resources?.limits ?? {};
  return {
    name: c.name,
    image: c.image ?? '',
    requests: {
      cpuMillicores: cpuMillicores(req.cpu),
      memoryBytes: bytes(req.memory),
    },
    limits: {
      cpuMillicores: cpuMillicores(lim.cpu),
      memoryBytes: bytes(lim.memory),
    },
    probes: {
      readiness: Boolean(c.readinessProbe),
      liveness: Boolean(c.livenessProbe),
      startup: Boolean(c.startupProbe),
    },
    security: {
      privileged: c.securityContext?.privileged === true,
      allowPrivilegeEscalation:
        c.securityContext?.allowPrivilegeEscalation ?? null,
      runAsNonRoot: c.securityContext?.runAsNonRoot ?? null,
    },
  };
}

function containerStatus(
  s: V1ContainerStatus | undefined,
): RawContainerStatus | null {
  if (!s) return null;
  let state: RawContainerStatus['state'] = null;
  if (s.state?.running) {
    state = {
      type: 'running',
      reason: null,
      message: null,
      since: iso(s.state.running.startedAt),
    };
  } else if (s.state?.waiting) {
    state = {
      type: 'waiting',
      reason: s.state.waiting.reason ?? null,
      message: s.state.waiting.message ?? null,
      since: null,
    };
  } else if (s.state?.terminated) {
    state = {
      type: 'terminated',
      reason: s.state.terminated.reason ?? null,
      message: s.state.terminated.message ?? null,
      since: iso(s.state.terminated.finishedAt),
      exitCode: s.state.terminated.exitCode ?? null,
    };
  }
  const lt = s.lastState?.terminated;
  return {
    ready: s.ready === true,
    restartCount: s.restartCount ?? 0,
    state,
    lastTermination: lt
      ? {
          reason: lt.reason ?? null,
          exitCode: lt.exitCode ?? null,
          startedAt: iso(lt.startedAt),
          finishedAt: iso(lt.finishedAt),
        }
      : null,
  };
}

function podSecurity(spec: V1PodSpec | undefined): PodSecurityRaw {
  return {
    hostNetwork: spec?.hostNetwork === true,
    hostPID: spec?.hostPID === true,
    hostPath: (spec?.volumes ?? []).some((v) => Boolean(v.hostPath)),
    serviceAccountName: spec?.serviceAccountName ?? null,
    automountToken: spec?.automountServiceAccountToken ?? null,
    runAsNonRoot: spec?.securityContext?.runAsNonRoot ?? null,
  };
}

const PHASES = new Set([
  'Pending',
  'Running',
  'Succeeded',
  'Failed',
  'Unknown',
]);
const QOS = new Set(['Guaranteed', 'Burstable', 'BestEffort']);

export function extractPod(p: V1Pod): RawPod {
  const spec = p.spec;
  const st = p.status;
  const statusByName = new Map<string, V1ContainerStatus>();
  for (const s of st?.containerStatuses ?? []) statusByName.set(s.name, s);
  const initStatusByName = new Map<string, V1ContainerStatus>();
  for (const s of st?.initContainerStatuses ?? [])
    initStatusByName.set(s.name, s);

  const containers: RawContainer[] = (spec?.containers ?? []).map((c) => ({
    ...containerSpec(c),
    init: false,
    status: containerStatus(statusByName.get(c.name)),
  }));
  const initContainers: RawContainer[] = (spec?.initContainers ?? []).map(
    (c) => ({
      ...containerSpec(c),
      init: true,
      status: containerStatus(initStatusByName.get(c.name)),
    }),
  );
  const ownerRef =
    p.metadata?.ownerReferences?.find((o) => o.controller) ??
    p.metadata?.ownerReferences?.[0];
  const phase = st?.phase && PHASES.has(st.phase) ? st.phase : 'Unknown';
  const qos = st?.qosClass && QOS.has(st.qosClass) ? st.qosClass : 'BestEffort';
  const labels = p.metadata?.labels ?? {};
  return {
    namespace: p.metadata?.namespace ?? '',
    name: p.metadata?.name ?? '',
    uid: p.metadata?.uid ?? '',
    createdAt: iso(p.metadata?.creationTimestamp) ?? new Date(0).toISOString(),
    labels: { ...labels },
    phase: phase as RawPod['phase'],
    statusReason: st?.reason ?? null,
    deletionAt: iso(p.metadata?.deletionTimestamp),
    nodeName: spec?.nodeName ?? null,
    podIP: st?.podIP ?? null,
    qosClass: qos as RawPod['qosClass'],
    startTime: iso(st?.startTime),
    owner: ownerRef ? { kind: ownerRef.kind, name: ownerRef.name } : null,
    conditions: conditions(
      st?.conditions?.map((c) => ({
        type: c.type,
        status: c.status,
        lastTransitionTime: c.lastTransitionTime,
        reason: c.reason,
        message: c.message,
      })),
    ),
    containers,
    initContainers,
    pvcClaims: (spec?.volumes ?? [])
      .map((v) => v.persistentVolumeClaim?.claimName)
      .filter((c): c is string => Boolean(c)),
    security: podSecurity(spec),
  };
}

// ---------------------------------------------------------------------------
// Workloads
// ---------------------------------------------------------------------------

function workloadBase(
  kind: RawWorkload['kind'],
  meta: V1Deployment['metadata'],
  spec:
    { selector?: V1LabelSelector; template?: V1PodTemplateSpec } | undefined,
): Pick<
  RawWorkload,
  | 'kind'
  | 'namespace'
  | 'name'
  | 'createdAt'
  | 'selector'
  | 'templateLabels'
  | 'containers'
  | 'podSecurity'
  | 'generation'
> {
  const tpl = spec?.template;
  return {
    kind,
    namespace: meta?.namespace ?? '',
    name: meta?.name ?? '',
    createdAt: iso(meta?.creationTimestamp) ?? new Date(0).toISOString(),
    selector: selector(spec?.selector),
    templateLabels: { ...(tpl?.metadata?.labels ?? {}) },
    containers: (tpl?.spec?.containers ?? []).map(containerSpec),
    podSecurity: podSecurity(tpl?.spec),
    generation: meta?.generation ?? null,
  };
}

export function extractDeployment(d: V1Deployment): RawWorkload {
  return {
    ...workloadBase('Deployment', d.metadata, d.spec),
    desired: d.spec?.replicas ?? 1,
    ready: d.status?.readyReplicas ?? 0,
    updated: d.status?.updatedReplicas ?? 0,
    available: d.status?.availableReplicas ?? 0,
    observedGeneration: d.status?.observedGeneration ?? null,
    revisionPending: false,
    conditions: conditions(
      d.status?.conditions?.map((c) => ({
        type: c.type,
        status: c.status,
        lastTransitionTime: c.lastTransitionTime,
        lastUpdateTime: c.lastUpdateTime,
        reason: c.reason,
        message: c.message,
      })),
    ),
    volumeClaimTemplates: [],
  };
}

export function extractStatefulSet(s: V1StatefulSet): RawWorkload {
  return {
    ...workloadBase('StatefulSet', s.metadata, s.spec),
    desired: s.spec?.replicas ?? 1,
    ready: s.status?.readyReplicas ?? 0,
    updated: s.status?.updatedReplicas ?? 0,
    available: s.status?.availableReplicas ?? 0,
    observedGeneration: s.status?.observedGeneration ?? null,
    revisionPending: Boolean(
      s.status?.updateRevision &&
      s.status?.currentRevision &&
      s.status.updateRevision !== s.status.currentRevision,
    ),
    conditions: conditions(
      s.status?.conditions?.map((c) => ({
        type: c.type,
        status: c.status,
        lastTransitionTime: c.lastTransitionTime,
        reason: c.reason,
        message: c.message,
      })),
    ),
    volumeClaimTemplates: (s.spec?.volumeClaimTemplates ?? [])
      .map((t) => t.metadata?.name)
      .filter((n): n is string => Boolean(n)),
  };
}

export function extractDaemonSet(ds: V1DaemonSet): RawWorkload {
  return {
    ...workloadBase('DaemonSet', ds.metadata, ds.spec),
    desired: ds.status?.desiredNumberScheduled ?? 0,
    ready: ds.status?.numberReady ?? 0,
    updated: ds.status?.updatedNumberScheduled ?? 0,
    available: ds.status?.numberAvailable ?? 0,
    observedGeneration: ds.status?.observedGeneration ?? null,
    revisionPending: false,
    conditions: conditions(
      ds.status?.conditions?.map((c) => ({
        type: c.type,
        status: c.status,
        lastTransitionTime: c.lastTransitionTime,
        reason: c.reason,
        message: c.message,
      })),
    ),
    volumeClaimTemplates: [],
  };
}

// ---------------------------------------------------------------------------
// Event / PVC / Service / Ingress / PDB / HPA
// ---------------------------------------------------------------------------

/** Warning 이벤트만 모델로 만든다. Normal이면 null */
export function extractEvent(e: CoreV1Event): RawEvent | null {
  if (e.type !== 'Warning') return null;
  const first =
    iso(e.firstTimestamp) ??
    iso(e.eventTime) ??
    iso(e.metadata?.creationTimestamp);
  const last =
    iso(e.series?.lastObservedTime) ??
    iso(e.lastTimestamp) ??
    iso(e.eventTime) ??
    first;
  const count = Math.max(e.count ?? 0, e.series?.count ?? 0, 1);
  return {
    uid: e.metadata?.uid ?? `${e.metadata?.namespace}/${e.metadata?.name}`,
    namespace: e.metadata?.namespace ?? null,
    involved: {
      kind: e.involvedObject?.kind ?? 'Unknown',
      namespace: e.involvedObject?.namespace ?? null,
      name: e.involvedObject?.name ?? '',
    },
    reason: e.reason ?? '',
    message: e.message ?? '',
    count,
    firstSeenAt: first ?? new Date().toISOString(),
    lastSeenAt: last ?? new Date().toISOString(),
    sourceComponent: e.source?.component ?? e.reportingComponent ?? null,
  };
}

export function extractPvc(p: V1PersistentVolumeClaim): RawPvc {
  const phase = p.status?.phase;
  return {
    namespace: p.metadata?.namespace ?? '',
    name: p.metadata?.name ?? '',
    createdAt: iso(p.metadata?.creationTimestamp) ?? new Date(0).toISOString(),
    phase: phase === 'Bound' || phase === 'Lost' ? phase : 'Pending',
    capacityBytes: bytes(p.status?.capacity?.storage),
    requestedBytes: bytes(p.spec?.resources?.requests?.storage),
    storageClass: p.spec?.storageClassName ?? null,
    volumeName: p.spec?.volumeName ?? null,
  };
}

/** 어노테이션 원문은 보관하지 않고 LB 종류만 해석한다 */
function serviceLbType(s: V1Service): RawService['lbType'] {
  if (s.spec?.type !== 'LoadBalancer') return null;
  const cls = s.spec?.loadBalancerClass ?? '';
  const t =
    s.metadata?.annotations?.[
      'service.beta.kubernetes.io/aws-load-balancer-type'
    ] ?? '';
  if (/nlb/i.test(cls) || /^(nlb|nlb-ip|external)$/i.test(t)) return 'nlb';
  return 'clb';
}

export function extractService(s: V1Service): RawService {
  return {
    namespace: s.metadata?.namespace ?? '',
    name: s.metadata?.name ?? '',
    type: s.spec?.type ?? 'ClusterIP',
    createdAt: iso(s.metadata?.creationTimestamp) ?? new Date(0).toISOString(),
    hasLoadBalancer: (s.status?.loadBalancer?.ingress ?? []).length > 0,
    lbHostnames: (s.status?.loadBalancer?.ingress ?? [])
      .map((x) => x.hostname)
      .filter((h): h is string => Boolean(h)),
    loadBalancerClass: s.spec?.loadBalancerClass ?? null,
    lbType: serviceLbType(s),
  };
}

export function extractIngress(i: V1Ingress): RawIngress {
  const ann = i.metadata?.annotations ?? {};
  const cls =
    i.spec?.ingressClassName ?? ann['kubernetes.io/ingress.class'] ?? '';
  return {
    namespace: i.metadata?.namespace ?? '',
    name: i.metadata?.name ?? '',
    createdAt: iso(i.metadata?.creationTimestamp) ?? new Date(0).toISOString(),
    ingressClass: i.spec?.ingressClassName ?? null,
    hasLoadBalancer: (i.status?.loadBalancer?.ingress ?? []).length > 0,
    lbHostnames: (i.status?.loadBalancer?.ingress ?? [])
      .map((x) => x.hostname)
      .filter((h): h is string => Boolean(h)),
    isAlb: /alb/i.test(cls),
    albGroup: ann['alb.ingress.kubernetes.io/group.name'] ?? null,
  };
}

export function extractPdb(p: V1PodDisruptionBudget): RawPdb {
  return {
    namespace: p.metadata?.namespace ?? '',
    name: p.metadata?.name ?? '',
    selector: selector(p.spec?.selector),
  };
}

export function extractHpa(h: V2HorizontalPodAutoscaler): RawHpa {
  return {
    namespace: h.metadata?.namespace ?? '',
    name: h.metadata?.name ?? '',
    target: {
      kind: h.spec?.scaleTargetRef?.kind ?? '',
      name: h.spec?.scaleTargetRef?.name ?? '',
    },
    minReplicas: h.spec?.minReplicas ?? null,
    maxReplicas: h.spec?.maxReplicas ?? 0,
    currentReplicas: h.status?.currentReplicas ?? null,
  };
}
