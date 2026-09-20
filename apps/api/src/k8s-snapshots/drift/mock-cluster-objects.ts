/**
 * mock 드리프트의 클러스터 쪽 객체 (docs/api/k8s-snapshot.md 14.3).
 * cluster mock 인벤토리(ClusterStore 의 Raw* 값)를 쿠버네티스 API 서버가 주는 모양(원본 JSON)으로 만든다.
 * - 인벤토리 값: 이미지, requests/limits, replicas, 서비스 타입, 인그레스 클래스, PVC 크기·StorageClass, HPA 대상
 * - 인벤토리에 없는 값(env, 포트, 프로브 설정 등)은 고정 템플릿
 * - API 서버 기본값 필드(rules.mjs DEFAULTS)와 런타임 필드(uid, status …)를 채워 실제 API 서버 응답처럼 만든다
 * 목록 항목처럼 apiVersion/kind 는 넣지 않는다 (드리프트가 종류 표로 채운다).
 * 같은 인벤토리면 같은 결과 (예시 스냅샷 파일이 이 결과를 CLI 정리 규칙으로 정리해 만든다).
 */
import type {
  RawHpa,
  RawIngress,
  RawPdb,
  RawPvc,
  RawService,
  RawWorkload,
  ResourceAmountsRaw,
} from '../../cluster/model';

export interface MockInventory {
  namespaces: readonly string[];
  workloads: readonly RawWorkload[];
  services: readonly RawService[];
  ingresses: readonly RawIngress[];
  pvcs: readonly RawPvc[];
  pdbs: readonly RawPdb[];
  hpas: readonly RawHpa[];
}

type Obj = Record<string, unknown>;

const MI = 1024 ** 2;
const GI = 1024 ** 3;
const CREATED = '2026-07-01T00:00:00Z';

/** Helm 으로 설치한 것으로 보는 리소스 (예시 10: monitoring/grafana Deployment·Service) */
const HELM_RELEASES = new Set(['monitoring/grafana']);
/** StatefulSet volumeClaimTemplates 크기 */
const VCT_SIZE: Record<string, string> = {
  'data/postgres': '50Gi',
  'data/redis': '10Gi',
};
/** 컨테이너 포트 (없으면 포트 없음) */
const PORTS: Record<string, { name: string; containerPort: number }[]> = {
  api: [{ name: 'http', containerPort: 8080 }],
  web: [{ name: 'http', containerPort: 3000 }],
  payments: [{ name: 'http', containerPort: 8080 }],
  postgres: [{ name: 'postgres', containerPort: 5432 }],
  redis: [{ name: 'redis', containerPort: 6379 }],
  grafana: [{ name: 'http', containerPort: 3000 }],
  coredns: [{ name: 'dns', containerPort: 53 }],
};
/** 컨테이너 env (값은 예시. 비밀값은 secretKeyRef 로만) */
const ENV: Record<string, Obj[]> = {
  'prod/api/api': [
    { name: 'LOG_LEVEL', value: 'info' },
    { name: 'DB_HOST', value: 'postgres.data.svc.cluster.local' },
    {
      name: 'DB_PASSWORD',
      valueFrom: {
        secretKeyRef: { name: 'api-db-credentials', key: 'password' },
      },
    },
  ],
  'data/postgres/postgres': [
    { name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' },
    {
      name: 'POSTGRES_PASSWORD',
      valueFrom: {
        secretKeyRef: {
          name: 'postgres-credentials',
          key: 'POSTGRES_PASSWORD',
        },
      },
    },
  ],
};
/**
 * 워크로드가 참조하는 ConfigMap·PVC (docs/api/snapshot-3d.md 12.2 K-1 보강).
 * 클러스터 객체와 예시 스냅샷 **양쪽**에 같이 들어가므로 드리프트 건수가 바뀌지 않는다.
 */
const ENV_FROM_CONFIGMAP: Record<string, string> = {
  'prod/api/api': 'api-config',
};
/** `<ns>/<workload>` → 파드 볼륨 (configMap·PVC 참조. K3·K5 예시) */
const VOLUMES: Record<
  string,
  { name: string; configMap?: string; claim?: string; mountPath: string }[]
> = {
  'data/postgres': [
    {
      name: 'postgres-config',
      configMap: 'postgres-config',
      mountPath: '/etc/postgresql/conf.d',
    },
  ],
  'monitoring/grafana': [
    { name: 'grafana-data', claim: 'grafana', mountPath: '/var/lib/grafana' },
  ],
};

/** 서비스 포트 (이름 → [포트, 대상 포트, 프로토콜]) */
const SERVICE_PORTS: Record<string, [string, number, number, string][]> = {
  'prod/api': [['http', 80, 8080, 'TCP']],
  'prod/web': [['http', 80, 3000, 'TCP']],
  'data/postgres': [['postgres', 5432, 5432, 'TCP']],
  'monitoring/grafana': [['http', 80, 3000, 'TCP']],
  'kube-system/kube-dns': [
    ['dns', 53, 53, 'UDP'],
    ['dns-tcp', 53, 53, 'TCP'],
  ],
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 결정적 UID (namespace kube-system 은 호출자가 클러스터 ID 로 지정) */
export function mockUid(s: string): string {
  const h = (n: number) => hash(`${s}#${n}`).toString(16).padStart(8, '0');
  const a = h(1) + h(2) + h(3) + h(4);
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-8${a.slice(17, 20)}-${a.slice(20, 32)}`;
}

export function cpuQuantity(m: number): string {
  return m % 1000 === 0 ? String(m / 1000) : `${m}m`;
}

export function memQuantity(b: number): string {
  if (b % GI === 0) return `${b / GI}Gi`;
  if (b % MI === 0) return `${b / MI}Mi`;
  return String(Math.round(b));
}

function amounts(a: ResourceAmountsRaw): Obj | undefined {
  const o: Obj = {};
  if (a.cpuMillicores !== null) o.cpu = cpuQuantity(a.cpuMillicores);
  if (a.memoryBytes !== null) o.memory = memQuantity(a.memoryBytes);
  return Object.keys(o).length ? o : undefined;
}

function defaultPullPolicy(image: string): string {
  if (image.includes('@')) return 'IfNotPresent';
  const last = image.split('/').pop() ?? '';
  const i = last.lastIndexOf(':');
  const tag = i >= 0 ? last.slice(i + 1) : '';
  return tag === '' || tag === 'latest' ? 'Always' : 'IfNotPresent';
}

function meta(
  name: string,
  namespace: string | null,
  extra: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  } = {},
): Obj {
  const key = `${namespace ?? ''}/${name}`;
  const m: Obj = { name };
  if (namespace) m.namespace = namespace;
  m.uid = mockUid(key);
  m.resourceVersion = String(100000 + (hash(key) % 900000));
  m.creationTimestamp = CREATED;
  if (extra.labels && Object.keys(extra.labels).length) m.labels = extra.labels;
  if (extra.annotations && Object.keys(extra.annotations).length)
    m.annotations = extra.annotations;
  m.managedFields = [
    {
      manager: 'kubectl-client-side-apply',
      operation: 'Update',
      apiVersion: 'v1',
      time: CREATED,
    },
  ];
  return m;
}

function helmLabels(ns: string, name: string): Record<string, string> {
  return HELM_RELEASES.has(`${ns}/${name}`)
    ? {
        'app.kubernetes.io/managed-by': 'Helm',
        'app.kubernetes.io/name': name,
        'app.kubernetes.io/instance': name,
      }
    : {};
}

function probe(port: number | null): Obj {
  return {
    ...(port
      ? { httpGet: { path: '/healthz', port, scheme: 'HTTP' } }
      : { tcpSocket: { port: 1 } }),
    timeoutSeconds: 1,
    periodSeconds: 10,
    successThreshold: 1,
    failureThreshold: 3,
  };
}

function workloadObject(w: RawWorkload): Obj {
  const labels = { app: w.name, ...helmLabels(w.namespace, w.name) };
  const vols = VOLUMES[`${w.namespace}/${w.name}`] ?? [];
  const containers = w.containers.map((c, ci) => {
    const ports = PORTS[c.name] ?? [];
    const out: Obj = { name: c.name, image: c.image };
    const env = ENV[`${w.namespace}/${w.name}/${c.name}`];
    const envFrom = ENV_FROM_CONFIGMAP[`${w.namespace}/${w.name}/${c.name}`];
    if (ports.length) out.ports = ports.map((p) => ({ ...p, protocol: 'TCP' }));
    if (envFrom) out.envFrom = [{ configMapRef: { name: envFrom } }];
    if (env) out.env = env.map((e) => ({ ...e }));
    if (ci === 0 && vols.length)
      out.volumeMounts = vols.map((v) => ({
        name: v.name,
        mountPath: v.mountPath,
      }));
    const res: Obj = {};
    const req = amounts(c.requests);
    const lim = amounts(c.limits);
    if (lim) res.limits = lim;
    if (req) res.requests = req;
    out.resources = res;
    if (c.probes.liveness)
      out.livenessProbe = probe(ports[0]?.containerPort ?? null);
    if (c.probes.readiness)
      out.readinessProbe = probe(ports[0]?.containerPort ?? null);
    out.terminationMessagePath = '/dev/termination-log';
    out.terminationMessagePolicy = 'File';
    out.imagePullPolicy = defaultPullPolicy(c.image);
    const sc: Obj = {};
    if (c.security.privileged) sc.privileged = true;
    if (c.security.allowPrivilegeEscalation !== null)
      sc.allowPrivilegeEscalation = c.security.allowPrivilegeEscalation;
    if (c.security.runAsNonRoot !== null)
      sc.runAsNonRoot = c.security.runAsNonRoot;
    if (Object.keys(sc).length) out.securityContext = sc;
    return out;
  });
  const podSpec: Obj = { containers };
  if (vols.length)
    podSpec.volumes = vols.map((v) =>
      v.configMap
        ? { name: v.name, configMap: { name: v.configMap, defaultMode: 420 } }
        : { name: v.name, persistentVolumeClaim: { claimName: v.claim! } },
    );
  if (w.podSecurity.hostNetwork) podSpec.hostNetwork = true;
  podSpec.restartPolicy = 'Always';
  podSpec.terminationGracePeriodSeconds = 30;
  podSpec.dnsPolicy = w.podSecurity.hostNetwork
    ? 'ClusterFirstWithHostNet'
    : 'ClusterFirst';
  const sa = w.podSecurity.serviceAccountName;
  if (sa && sa !== 'default') {
    podSpec.serviceAccountName = sa;
    podSpec.serviceAccount = sa;
  }
  podSpec.securityContext = {};
  podSpec.schedulerName = 'default-scheduler';
  const template: Obj = {
    metadata: {
      creationTimestamp: null,
      labels: Object.keys(w.templateLabels).length
        ? { ...w.templateLabels }
        : { app: w.name },
    },
    spec: podSpec,
  };
  const selector = {
    matchLabels:
      w.selector?.matchLabels && Object.keys(w.selector.matchLabels).length
        ? { ...w.selector.matchLabels }
        : { app: w.name },
  };
  const spec: Obj = {};
  const status: Obj = { observedGeneration: w.observedGeneration ?? 1 };
  if (w.kind === 'Deployment') {
    spec.replicas = w.desired ?? 1;
    spec.selector = selector;
    spec.template = template;
    spec.strategy = {
      type: 'RollingUpdate',
      rollingUpdate: { maxUnavailable: '25%', maxSurge: '25%' },
    };
    spec.revisionHistoryLimit = 10;
    spec.progressDeadlineSeconds = 600;
    Object.assign(status, {
      replicas: w.desired ?? 0,
      readyReplicas: w.ready,
      availableReplicas: w.available ?? 0,
    });
  } else if (w.kind === 'StatefulSet') {
    spec.replicas = w.desired ?? 1;
    spec.selector = selector;
    spec.template = template;
    spec.volumeClaimTemplates = w.volumeClaimTemplates.map((n) => ({
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: n, creationTimestamp: null },
      spec: {
        accessModes: ['ReadWriteOnce'],
        resources: {
          requests: { storage: VCT_SIZE[`${w.namespace}/${w.name}`] ?? '10Gi' },
        },
        storageClassName: 'gp3',
        volumeMode: 'Filesystem',
      },
      status: { phase: 'Pending' },
    }));
    spec.serviceName = w.name;
    spec.podManagementPolicy = 'OrderedReady';
    spec.updateStrategy = {
      type: 'RollingUpdate',
      rollingUpdate: { partition: 0 },
    };
    spec.revisionHistoryLimit = 10;
    spec.persistentVolumeClaimRetentionPolicy = {
      whenDeleted: 'Retain',
      whenScaled: 'Retain',
    };
    Object.assign(status, { replicas: w.desired ?? 0, readyReplicas: w.ready });
  } else {
    spec.selector = selector;
    spec.template = template;
    spec.updateStrategy = {
      type: 'RollingUpdate',
      rollingUpdate: { maxUnavailable: 1, maxSurge: 0 },
    };
    spec.revisionHistoryLimit = 10;
    Object.assign(status, {
      desiredNumberScheduled: w.desired ?? 0,
      numberReady: w.ready,
    });
  }
  const annotations: Record<string, string> =
    w.kind === 'Deployment' ? { 'deployment.kubernetes.io/revision': '4' } : {};
  return {
    metadata: {
      ...meta(w.name, w.namespace, { labels, annotations }),
      generation: w.generation ?? 1,
    },
    spec,
    status,
  };
}

function serviceObject(s: RawService): Obj {
  const key = `${s.namespace}/${s.name}`;
  const ports = (SERVICE_PORTS[key] ?? [['http', 80, 8080, 'TCP']]).map(
    ([name, port, targetPort, protocol], i) => {
      const p: Obj = { name, protocol, port, targetPort };
      if (s.type === 'LoadBalancer' || s.type === 'NodePort')
        p.nodePort = 30000 + (hash(`${key}#${i}`) % 2767);
      return p;
    },
  );
  const h = hash(key);
  const ip = `10.100.${(h >> 8) & 0xff}.${h & 0xff}`;
  const spec: Obj = {
    ports,
    selector: { app: s.name === 'kube-dns' ? 'coredns' : s.name },
    clusterIP: ip,
    clusterIPs: [ip],
    type: s.type,
    sessionAffinity: 'None',
  };
  if (s.type === 'LoadBalancer') {
    if (s.loadBalancerClass) spec.loadBalancerClass = s.loadBalancerClass;
    spec.externalTrafficPolicy = 'Cluster';
    spec.allocateLoadBalancerNodePorts = true;
  }
  spec.ipFamilies = ['IPv4'];
  spec.ipFamilyPolicy = 'SingleStack';
  spec.internalTrafficPolicy = 'Cluster';
  const annotations: Record<string, string> = {};
  if (s.type === 'LoadBalancer' && s.lbType === 'nlb')
    annotations['service.beta.kubernetes.io/aws-load-balancer-scheme'] =
      'internet-facing';
  return {
    metadata: meta(s.name, s.namespace, {
      labels: { app: s.name, ...helmLabels(s.namespace, s.name) },
      annotations,
    }),
    spec,
    status: {
      loadBalancer: s.lbHostnames.length
        ? { ingress: s.lbHostnames.map((hostname) => ({ hostname })) }
        : {},
    },
  };
}

function ingressObject(i: RawIngress): Obj {
  const annotations: Record<string, string> = {};
  if (i.isAlb) {
    annotations['alb.ingress.kubernetes.io/scheme'] = 'internet-facing';
    annotations['alb.ingress.kubernetes.io/target-type'] = 'ip';
  }
  if (i.albGroup)
    annotations['alb.ingress.kubernetes.io/group.name'] = i.albGroup;
  const spec: Obj = {};
  if (i.ingressClass) spec.ingressClassName = i.ingressClass;
  spec.rules = [
    {
      host: `${i.name}.example.com`,
      http: {
        paths: [
          {
            path: '/',
            pathType: 'Prefix',
            backend: { service: { name: i.name, port: { number: 80 } } },
          },
        ],
      },
    },
  ];
  return {
    metadata: {
      ...meta(i.name, i.namespace, { labels: { app: i.name }, annotations }),
      generation: 1,
    },
    spec,
    status: {
      loadBalancer: i.lbHostnames.length
        ? { ingress: i.lbHostnames.map((hostname) => ({ hostname })) }
        : {},
    },
  };
}

function pvcObject(p: RawPvc): Obj {
  const bytes = p.requestedBytes ?? p.capacityBytes ?? 10 * GI;
  const spec: Obj = {
    accessModes: ['ReadWriteOnce'],
    resources: { requests: { storage: memQuantity(bytes) } },
  };
  if (p.storageClass) spec.storageClassName = p.storageClass;
  spec.volumeMode = 'Filesystem';
  if (p.volumeName) spec.volumeName = p.volumeName;
  const annotations: Record<string, string> = {
    'volume.kubernetes.io/storage-provisioner': 'ebs.csi.aws.com',
  };
  if (p.phase === 'Bound')
    annotations['pv.kubernetes.io/bind-completed'] = 'yes';
  const labels: Record<string, string> = {};
  const m = /^([a-z0-9-]+)-([a-z0-9-]+)-\d+$/.exec(p.name);
  if (m) labels.app = m[2];
  return {
    metadata: {
      ...meta(p.name, p.namespace, { labels, annotations }),
      finalizers: ['kubernetes.io/pvc-protection'],
    },
    spec,
    status: {
      phase: p.phase,
      ...(p.capacityBytes
        ? { capacity: { storage: memQuantity(p.capacityBytes) } }
        : {}),
    },
  };
}

function pdbObject(p: RawPdb): Obj {
  return {
    metadata: { ...meta(p.name, p.namespace), generation: 1 },
    spec: {
      minAvailable: 1,
      selector: {
        matchLabels: { ...(p.selector?.matchLabels ?? { app: p.name }) },
      },
    },
    status: {
      currentHealthy: 1,
      desiredHealthy: 1,
      disruptionsAllowed: 0,
      expectedPods: 1,
    },
  };
}

function hpaObject(h: RawHpa): Obj {
  return {
    metadata: meta(h.name, h.namespace),
    spec: {
      scaleTargetRef: {
        kind: h.target.kind,
        name: h.target.name,
        apiVersion: 'apps/v1',
      },
      minReplicas: h.minReplicas ?? 1,
      maxReplicas: h.maxReplicas,
      metrics: [
        {
          type: 'Resource',
          resource: {
            name: 'cpu',
            target: { type: 'Utilization', averageUtilization: 70 },
          },
        },
      ],
      behavior: {
        scaleUp: {
          stabilizationWindowSeconds: 0,
          selectPolicy: 'Max',
          policies: [
            { type: 'Pods', value: 4, periodSeconds: 15 },
            { type: 'Percent', value: 100, periodSeconds: 15 },
          ],
        },
        scaleDown: {
          stabilizationWindowSeconds: 300,
          selectPolicy: 'Max',
          policies: [{ type: 'Percent', value: 100, periodSeconds: 15 }],
        },
      },
    },
    status: {
      currentReplicas: h.currentReplicas ?? 0,
      desiredReplicas: h.currentReplicas ?? 0,
    },
  };
}

function namespaceObject(name: string, clusterId: string): Obj {
  const m = meta(name, null, {
    labels: { 'kubernetes.io/metadata.name': name },
  });
  if (name === 'kube-system') m.uid = clusterId;
  return {
    metadata: m,
    spec: { finalizers: ['kubernetes'] },
    status: { phase: 'Active' },
  };
}

/** 인벤토리 → 비교 가능 종류별 원본 모양 객체 (종류 ID = COMPARABLE_KINDS.id) */
export function buildMockClusterObjects(
  inv: MockInventory,
  clusterId: string,
): Map<string, Obj[]> {
  const byKind = (k: RawWorkload['kind']) =>
    inv.workloads.filter((w) => w.kind === k).map(workloadObject);
  return new Map<string, Obj[]>([
    [
      'namespaces',
      [...inv.namespaces].sort().map((n) => namespaceObject(n, clusterId)),
    ],
    ['deployments', byKind('Deployment')],
    ['statefulsets', byKind('StatefulSet')],
    ['daemonsets', byKind('DaemonSet')],
    ['services', inv.services.map(serviceObject)],
    ['ingresses', inv.ingresses.map(ingressObject)],
    ['persistentvolumeclaims', inv.pvcs.map(pvcObject)],
    ['poddisruptionbudgets', inv.pdbs.map(pdbObject)],
    ['horizontalpodautoscalers', inv.hpas.map(hpaObject)],
  ]);
}
