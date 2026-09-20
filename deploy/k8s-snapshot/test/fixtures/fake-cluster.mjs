// 가짜 쿠버네티스 API (테스트 전용). 실제 클러스터를 호출하지 않는다.
// 응답은 실제 API 서버처럼: 목록 항목에는 apiVersion/kind 가 없고, status·managedFields 등 런타임 필드가 있다.

const rt = (name, ns, extra = {}) => ({
  name,
  ...(ns ? { namespace: ns } : {}),
  uid: `uid-${ns ?? '_'}-${name}`,
  resourceVersion: '12345',
  generation: 3,
  creationTimestamp: '2026-09-01T00:00:00Z',
  managedFields: [{ manager: 'kubectl', operation: 'Update' }],
  ...extra,
});

export function baseObjects() {
  return {
    namespaces: [
      { metadata: rt('kube-system', null, { uid: '7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e', labels: { 'kubernetes.io/metadata.name': 'kube-system' } }), spec: { finalizers: ['kubernetes'] }, status: { phase: 'Active' } },
      { metadata: rt('default', null, { labels: { 'kubernetes.io/metadata.name': 'default' } }), spec: { finalizers: ['kubernetes'] }, status: { phase: 'Active' } },
      { metadata: rt('prod', null, { labels: { 'kubernetes.io/metadata.name': 'prod', team: 'app' } }), spec: { finalizers: ['kubernetes'] }, status: { phase: 'Active' } },
      { metadata: rt('data', null, { labels: { 'kubernetes.io/metadata.name': 'data' } }), spec: { finalizers: ['kubernetes'] }, status: { phase: 'Active' } },
    ],
    'apps/v1/deployments': [
      {
        metadata: rt('api', 'prod', {
          annotations: { 'deployment.kubernetes.io/revision': '7', 'kubectl.kubernetes.io/last-applied-configuration': '{"x":1}', 'team/owner': 'app' },
          labels: { app: 'api' },
        }),
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: 'api' } },
          template: {
            metadata: { creationTimestamp: null, labels: { app: 'api' } },
            spec: {
              imagePullSecrets: [{ name: 'ecr-pull' }],
              containers: [
                {
                  name: 'api',
                  image: 'repo/api:1.4.2',
                  env: [
                    { name: 'LOG_LEVEL', value: 'info' },
                    { name: 'DB_PASSWORD', valueFrom: { secretKeyRef: { name: 'pg-credentials', key: 'password' } } },
                  ],
                  resources: { limits: { memory: '512Mi' } },
                  terminationMessagePath: '/dev/termination-log',
                  terminationMessagePolicy: 'File',
                  imagePullPolicy: 'IfNotPresent',
                },
              ],
              restartPolicy: 'Always',
              dnsPolicy: 'ClusterFirst',
              securityContext: {},
            },
          },
          strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' } },
          revisionHistoryLimit: 10,
          progressDeadlineSeconds: 600,
        },
        status: { replicas: 3, readyReplicas: 3 },
      },
    ],
    'apps/v1/statefulsets': [
      {
        metadata: rt('postgres', 'data'),
        spec: {
          replicas: 1,
          serviceName: 'postgres',
          selector: { matchLabels: { app: 'postgres' } },
          template: {
            metadata: { labels: { app: 'postgres' } },
            spec: { containers: [{ name: 'postgres', image: 'postgres:16.4', env: [{ name: 'PGDATA', value: '/var/lib/postgresql/data/pgdata' }] }] },
          },
          volumeClaimTemplates: [
            { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'data', creationTimestamp: null }, spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '50Gi' } } }, status: { phase: 'Pending' } },
          ],
        },
        status: { replicas: 1 },
      },
    ],
    'apps/v1/daemonsets': [],
    'apps/v1/replicasets': [{ metadata: rt('api-abc', 'prod', { ownerReferences: [{ kind: 'Deployment', name: 'api' }] }), spec: {} }],
    'v1/services': [
      { metadata: rt('kubernetes', 'default'), spec: { clusterIP: '10.100.0.1', clusterIPs: ['10.100.0.1'], ports: [{ port: 443 }] } },
      { metadata: rt('api', 'prod'), spec: { type: 'ClusterIP', clusterIP: '10.100.1.2', clusterIPs: ['10.100.1.2'], ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }] } },
      { metadata: rt('postgres', 'data'), spec: { clusterIP: 'None', clusterIPs: ['None'], ports: [{ port: 5432 }] } },
    ],
    'v1/persistentvolumeclaims': [
      {
        metadata: rt('data-postgres-0', 'data', { annotations: { 'pv.kubernetes.io/bind-completed': 'yes', 'volume.kubernetes.io/selected-node': 'ip-1' }, finalizers: ['kubernetes.io/pvc-protection'] }),
        spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '50Gi' } }, volumeName: 'pvc-123', storageClassName: 'gp3', volumeMode: 'Filesystem' },
        status: { phase: 'Bound' },
      },
    ],
    'v1/configmaps': [
      { metadata: rt('kube-root-ca.crt', 'prod'), data: { 'ca.crt': 'x' } },
      { metadata: rt('kube-root-ca.crt', 'data'), data: { 'ca.crt': 'x' } },
      { metadata: rt('api-config', 'prod'), data: { LOG_LEVEL: 'info' } },
    ],
    'v1/serviceaccounts': [
      { metadata: rt('default', 'prod'), secrets: [{ name: 'default-token' }] },
      { metadata: rt('default', 'data') },
      { metadata: rt('api', 'prod', { annotations: { 'eks.amazonaws.com/role-arn': 'arn:aws:iam::123456789012:role/api' } }), imagePullSecrets: [{ name: 'ecr-pull' }] },
    ],
    'rbac.authorization.k8s.io/v1/roles': [
      { metadata: rt('system:controller:x', 'prod'), rules: [] },
      { metadata: rt('Reader:All', 'prod'), rules: [] },
    ],
    'rbac.authorization.k8s.io/v1/rolebindings': [],
    'networking.k8s.io/v1/ingresses': [
      { metadata: rt('web', 'prod', { finalizers: ['ingress.k8s.aws/resources'] }), spec: { ingressClassName: 'alb', tls: [{ secretName: 'web-tls' }] }, status: { loadBalancer: {} } },
    ],
    'networking.k8s.io/v1/networkpolicies': [{ metadata: rt('default-deny', 'prod'), spec: { podSelector: {} } }],
    'policy/v1/poddisruptionbudgets': [],
    'autoscaling/v2/horizontalpodautoscalers': [],
    'batch/v1/cronjobs': [],
    'batch/v1/jobs': [{ metadata: rt('nightly-123', 'prod', { ownerReferences: [{ kind: 'CronJob', name: 'nightly' }] }), spec: {} }],
    'rbac.authorization.k8s.io/v1/clusterroles': [
      { metadata: rt('system:node', null), rules: [] },
      { metadata: rt('view', null, { labels: { 'kubernetes.io/bootstrapping': 'rbac-defaults' } }), rules: [] },
      { metadata: rt('app-reader', null), rules: [] },
    ],
    'storage.k8s.io/v1/storageclasses': [{ metadata: rt('gp3', null), provisioner: 'ebs.csi.aws.com' }],
    'v1/resourcequotas': [],
    'v1/limitranges': [],
    'v1/secrets': [{ metadata: rt('pg-credentials', 'data'), data: { password: 'ZXhhbXBsZQ==' } }],
  };
}

const LIST_RE = /^\/(?:api\/(v1)|apis\/([^/]+)\/([^/]+))\/namespaces\/([^/]+)\/([^/]+)$/;
const CLUSTER_LIST_RE = /^\/(?:api\/(v1)|apis\/([^/]+)\/([^/]+))\/([^/]+)$/;

/**
 * @param {{ objects?: object, forbidden?: string[], notFound?: string[], fail?: boolean, version?: string }} opts
 *   forbidden: 'networking.k8s.io/v1/networkpolicies' 같은 키 (모든 네임스페이스에서 403) 또는 'namespaces' / 'kube-system'
 */
export function makeCluster(opts = {}) {
  const objects = opts.objects ?? baseObjects();
  const calls = [];
  const forbidden = new Set(opts.forbidden ?? []);
  const notFound = new Set(opts.notFound ?? []);
  const transport = async (req) => {
    calls.push(req);
    if (opts.fail) throw new Error('connect ECONNREFUSED https://10.0.0.1:443 token=abc');
    const { path } = req;
    if (path === '/version') return { status: 200, body: { gitVersion: opts.version ?? 'v1.34.1-eks-8a2c1f0' } };
    if (path === '/api/v1/namespaces') {
      if (forbidden.has('namespaces')) return { status: 403, body: null };
      return { status: 200, body: { items: objects.namespaces, metadata: {} } };
    }
    const nsGet = /^\/api\/v1\/namespaces\/([^/]+)$/.exec(path);
    if (nsGet) {
      if (forbidden.has(nsGet[1])) return { status: 403, body: null };
      const o = objects.namespaces.find((n) => n.metadata.name === nsGet[1]);
      return o ? { status: 200, body: o } : { status: 404, body: null };
    }
    let m = LIST_RE.exec(path);
    if (m) {
      const key = m[1] ? `v1/${m[5]}` : `${m[2]}/${m[3]}/${m[5]}`;
      if (forbidden.has(key)) return { status: 403, body: null };
      if (notFound.has(key) || !(key in objects)) return { status: 404, body: null };
      return { status: 200, body: { items: objects[key].filter((o) => o.metadata.namespace === m[4]), metadata: {} } };
    }
    m = CLUSTER_LIST_RE.exec(path);
    if (m) {
      const key = m[1] ? `v1/${m[4]}` : `${m[2]}/${m[3]}/${m[4]}`;
      if (forbidden.has(key)) return { status: 403, body: null };
      if (!(key in objects)) return { status: 404, body: null };
      return { status: 200, body: { items: objects[key], metadata: {} } };
    }
    return { status: 404, body: null };
  };
  return { transport, calls, objects };
}

export const fakeInspect = (contexts = ['sentinel-snapshot']) => async () => ({
  contexts,
  clusterNameOf: () => 'prod-eks',
});
