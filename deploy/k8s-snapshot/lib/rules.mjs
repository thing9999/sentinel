// 정리 규칙·제외 규칙·드리프트 표 (docs/api/k8s-snapshot.md 3.6, 3.7, 10.4~10.6).
// CLI(내보내기)와 api(드리프트·파일 상태)가 이 파일 하나를 같이 쓴다 → 규칙이 두 벌이 되지 않는다.
// api 가 이 파일을 동적 import 한다 → Node 내장 모듈 외 import 금지 (계약 2.2).

export const CLEANUP_RULES_VERSION = 1;

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const META_REMOVE = [
  'uid', 'resourceVersion', 'generation', 'creationTimestamp', 'managedFields', 'selfLink',
  'deletionTimestamp', 'deletionGracePeriodSeconds', 'ownerReferences', 'finalizers',
];
const ANNOTATION_REMOVE_EXACT = [
  'kubectl.kubernetes.io/last-applied-configuration',
  'deployment.kubernetes.io/revision',
  'volume.beta.kubernetes.io/storage-provisioner',
  'volume.kubernetes.io/storage-provisioner',
  'volume.kubernetes.io/selected-node',
  'control-plane.alpha.kubernetes.io/leader',
];
const ANNOTATION_REMOVE_PREFIX = ['pv.kubernetes.io/', 'autoscaling.alpha.kubernetes.io/'];

/** 버전별 규칙 요약 (metadata.cleanup.summary, 화면 도움말) */
export const RULESETS = Object.freeze({
  1: Object.freeze({
    version: 1,
    summary: Object.freeze([
      'status',
      ...META_REMOVE.map((f) => `metadata.${f}`),
      ...ANNOTATION_REMOVE_EXACT.map((a) => `metadata.annotations["${a}"]`),
      ...ANNOTATION_REMOVE_PREFIX.map((a) => `metadata.annotations["${a}*"]`),
      'Namespace metadata.labels["kubernetes.io/metadata.name"]',
      'spec.template.metadata.creationTimestamp',
      'Service spec.clusterIP / spec.clusterIPs (None 이면 유지), spec.healthCheckNodePort',
      'PersistentVolumeClaim spec.volumeName',
      'StatefulSet spec.volumeClaimTemplates[].status, [].metadata.creationTimestamp',
      'Namespace spec.finalizers',
      'ServiceAccount secrets',
    ]),
  }),
});

function removeAnnotations(meta) {
  if (!isObj(meta) || !isObj(meta.annotations)) return;
  for (const key of Object.keys(meta.annotations)) {
    if (ANNOTATION_REMOVE_EXACT.includes(key) || ANNOTATION_REMOVE_PREFIX.some((p) => key.startsWith(p)))
      delete meta.annotations[key];
  }
  if (Object.keys(meta.annotations).length === 0) delete meta.annotations;
}

function cleanTemplateMeta(t) {
  if (isObj(t) && isObj(t.metadata)) {
    delete t.metadata.creationTimestamp;
    if (Object.keys(t.metadata).length === 0) delete t.metadata;
  }
}

/**
 * 정리된 새 객체를 돌려준다 (입력은 바꾸지 않는다). 계약 3.6.
 * @param {object} obj 쿠버네티스 원본 JSON (apiVersion/kind 가 없으면 opts.kind 로 판단)
 * @param {{ rulesVersion?: number, kind?: string }} [opts]
 */
export function cleanObject(obj, opts = {}) {
  const o = clone(obj);
  if (!isObj(o)) return o;
  const kind = o.kind ?? opts.kind;
  delete o.status;
  if (isObj(o.metadata)) {
    for (const f of META_REMOVE) delete o.metadata[f];
    removeAnnotations(o.metadata);
    if (kind === 'Namespace' && isObj(o.metadata.labels)) {
      delete o.metadata.labels['kubernetes.io/metadata.name'];
    }
    if (isObj(o.metadata.labels) && Object.keys(o.metadata.labels).length === 0) delete o.metadata.labels;
  }
  const spec = o.spec;
  if (isObj(spec)) {
    cleanTemplateMeta(spec.template);
    if (kind === 'Service') {
      if (spec.clusterIP !== 'None') {
        delete spec.clusterIP;
        delete spec.clusterIPs;
      }
      delete spec.healthCheckNodePort;
    }
    if (kind === 'PersistentVolumeClaim') delete spec.volumeName;
    if (kind === 'StatefulSet' && Array.isArray(spec.volumeClaimTemplates)) {
      for (const t of spec.volumeClaimTemplates) {
        if (!isObj(t)) continue;
        delete t.status;
        cleanTemplateMeta(t);
      }
    }
    if (kind === 'Namespace') {
      delete spec.finalizers;
      if (Object.keys(spec).length === 0) delete o.spec;
    }
    if (kind === 'CronJob' && isObj(spec.jobTemplate)) {
      cleanTemplateMeta(spec.jobTemplate);
      if (isObj(spec.jobTemplate.spec)) cleanTemplateMeta(spec.jobTemplate.spec.template);
    }
  }
  if (kind === 'ServiceAccount') delete o.secrets;
  return o;
}

/**
 * 파일에 남아 있는 정리 대상 경로 (파일 상태 RUNTIME_FIELDS_LEFT). 최대 10개.
 */
export function findRuntimeFields(obj) {
  if (!isObj(obj)) return [];
  const out = [];
  const kind = obj.kind;
  if ('status' in obj) out.push('status');
  const meta = obj.metadata;
  if (isObj(meta)) {
    for (const f of META_REMOVE) if (f in meta) out.push(`metadata.${f}`);
    if (isObj(meta.annotations)) {
      for (const key of Object.keys(meta.annotations)) {
        if (ANNOTATION_REMOVE_EXACT.includes(key) || ANNOTATION_REMOVE_PREFIX.some((p) => key.startsWith(p)))
          out.push(`metadata.annotations["${key}"]`);
      }
    }
  }
  const spec = obj.spec;
  if (isObj(spec)) {
    if (isObj(spec.template) && isObj(spec.template.metadata) && 'creationTimestamp' in spec.template.metadata)
      out.push('spec.template.metadata.creationTimestamp');
    if (kind === 'Service') {
      if (spec.clusterIP !== undefined && spec.clusterIP !== 'None') out.push('spec.clusterIP');
      if ('healthCheckNodePort' in spec) out.push('spec.healthCheckNodePort');
    }
    if (kind === 'PersistentVolumeClaim' && 'volumeName' in spec) out.push('spec.volumeName');
  }
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// 제외 규칙 (계약 3.7)
// ---------------------------------------------------------------------------

/** 컨트롤러 소유 객체 */
export function isAlwaysExcluded(obj) {
  const refs = obj?.metadata?.ownerReferences;
  return Array.isArray(refs) && refs.length > 0;
}

/**
 * 쿠버네티스·EKS 가 자동으로 만든 객체면 규칙 이름, 아니면 null.
 * 규칙 이름은 metadata.resources.excludedByRule.*.autoCreatedNames 에 들어간다 (사용자 리소스 이름이 아님).
 */
export function isAutoCreated(obj, kind) {
  const k = obj?.kind ?? kind;
  const name = obj?.metadata?.name ?? '';
  const ns = obj?.metadata?.namespace ?? null;
  const labels = isObj(obj?.metadata?.labels) ? obj.metadata.labels : {};
  if (k === 'ConfigMap' && name === 'kube-root-ca.crt') return 'kube-root-ca.crt';
  if (k === 'Service' && name === 'kubernetes' && ns === 'default') return 'default/kubernetes';
  if (k === 'ServiceAccount' && name === 'default') {
    const c = cleanObject(obj, { kind: 'ServiceAccount' });
    const hasAnn = isObj(c?.metadata?.annotations) && Object.keys(c.metadata.annotations).length > 0;
    const hasPull = Array.isArray(c?.imagePullSecrets) && c.imagePullSecrets.length > 0;
    if (!hasAnn && !hasPull && c?.automountServiceAccountToken === undefined) return 'default';
  }
  if (['Role', 'RoleBinding', 'ClusterRole', 'ClusterRoleBinding'].includes(k)) {
    if (name.startsWith('system:')) return 'system:*';
    if (name.startsWith('eks:')) return 'eks:*';
    if (labels['kubernetes.io/bootstrapping'] === 'rbac-defaults') return 'rbac-defaults';
  }
  if (k === 'PriorityClass' && name.startsWith('system-')) return 'system-*';
  return null;
}

export function isHelmManaged(obj) {
  return obj?.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'Helm';
}

/** CLI 출력 키 순서: 최상위 apiVersion, kind, metadata / metadata 는 name, namespace, labels, annotations 먼저 */
export function orderKeys(obj) {
  if (!isObj(obj)) return obj;
  const first = ['apiVersion', 'kind', 'metadata'];
  const out = {};
  for (const key of first) if (key in obj) out[key] = obj[key];
  for (const [key, v] of Object.entries(obj)) if (!first.includes(key)) out[key] = v;
  if (isObj(out.metadata)) {
    const mf = ['name', 'namespace', 'labels', 'annotations'];
    const m = {};
    for (const key of mf) if (key in out.metadata) m[key] = out.metadata[key];
    for (const [key, v] of Object.entries(out.metadata)) if (!mf.includes(key)) m[key] = v;
    out.metadata = m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 드리프트 표 (계약 10.4~10.6). 경로 패턴 문법:
//   점 구분 토큰. `[]` = 목록 항목(아무 키), `[key]` = 그 키의 항목, `["a.b/c"]` = 점이 든 맵 키, `*` = 맵 키 하나, `**` = 0개 이상 토큰
// ---------------------------------------------------------------------------

const WORKLOADS = ['Deployment', 'StatefulSet', 'DaemonSet'];
const PT = 'spec.template.spec';
const CONTAINER_LISTS = ['containers', 'initContainers', 'ephemeralContainers'];

const containerDefaults = () => {
  const out = [];
  for (const list of ['containers', 'initContainers']) {
    const c = `${PT}.${list}[]`;
    out.push(
      { kinds: WORKLOADS, path: `${c}.terminationMessagePath`, value: '/dev/termination-log' },
      { kinds: WORKLOADS, path: `${c}.terminationMessagePolicy`, value: 'File' },
      { kinds: WORKLOADS, path: `${c}.imagePullPolicy`, when: 'imagePullPolicy' },
      { kinds: WORKLOADS, path: `${c}.ports[].protocol`, value: 'TCP' },
      { kinds: WORKLOADS, path: `${c}.env[].valueFrom.fieldRef.apiVersion`, value: 'v1' },
    );
    for (const probe of ['readinessProbe', 'livenessProbe', 'startupProbe']) {
      out.push(
        { kinds: WORKLOADS, path: `${c}.${probe}.timeoutSeconds`, value: 1 },
        { kinds: WORKLOADS, path: `${c}.${probe}.periodSeconds`, value: 10 },
        { kinds: WORKLOADS, path: `${c}.${probe}.successThreshold`, value: 1 },
        { kinds: WORKLOADS, path: `${c}.${probe}.failureThreshold`, value: 3 },
        { kinds: WORKLOADS, path: `${c}.${probe}.httpGet.scheme`, value: 'HTTP' },
      );
    }
  }
  return out;
};

/**
 * 기본값 표: 한쪽에 필드가 없고 다른 쪽 값이 이 값이면 "기본값 차이"(숨김).
 * `when` 은 api 드리프트 엔진이 해석하는 조건부 기본값 이름.
 */
export const DEFAULTS = Object.freeze([
  { kinds: WORKLOADS, path: `${PT}.restartPolicy`, value: 'Always' },
  { kinds: WORKLOADS, path: `${PT}.dnsPolicy`, value: 'ClusterFirst' },
  { kinds: WORKLOADS, path: `${PT}.schedulerName`, value: 'default-scheduler' },
  { kinds: WORKLOADS, path: `${PT}.terminationGracePeriodSeconds`, value: 30 },
  { kinds: WORKLOADS, path: `${PT}.serviceAccount`, when: 'sameAsServiceAccountName' },
  ...containerDefaults(),
  ...['secret', 'configMap', 'projected', 'downwardAPI'].map((v) => ({
    kinds: WORKLOADS,
    path: `${PT}.volumes[].${v}.defaultMode`,
    value: 420,
  })),
  { kinds: ['Deployment'], path: 'spec.replicas', value: 1 },
  { kinds: ['Deployment'], path: 'spec.revisionHistoryLimit', value: 10 },
  { kinds: ['Deployment'], path: 'spec.progressDeadlineSeconds', value: 600 },
  { kinds: ['Deployment'], path: 'spec.strategy.type', value: 'RollingUpdate' },
  { kinds: ['Deployment'], path: 'spec.strategy.rollingUpdate.maxSurge', value: '25%' },
  { kinds: ['Deployment'], path: 'spec.strategy.rollingUpdate.maxUnavailable', value: '25%' },
  { kinds: ['StatefulSet'], path: 'spec.replicas', value: 1 },
  { kinds: ['StatefulSet'], path: 'spec.podManagementPolicy', value: 'OrderedReady' },
  { kinds: ['StatefulSet'], path: 'spec.revisionHistoryLimit', value: 10 },
  { kinds: ['StatefulSet'], path: 'spec.updateStrategy.type', value: 'RollingUpdate' },
  { kinds: ['StatefulSet'], path: 'spec.updateStrategy.rollingUpdate.partition', value: 0 },
  { kinds: ['StatefulSet'], path: 'spec.persistentVolumeClaimRetentionPolicy.whenDeleted', value: 'Retain' },
  { kinds: ['StatefulSet'], path: 'spec.persistentVolumeClaimRetentionPolicy.whenScaled', value: 'Retain' },
  { kinds: ['StatefulSet'], path: 'spec.volumeClaimTemplates[].spec.volumeMode', value: 'Filesystem' },
  { kinds: ['StatefulSet'], path: 'spec.volumeClaimTemplates[].apiVersion', value: 'v1' },
  { kinds: ['StatefulSet'], path: 'spec.volumeClaimTemplates[].kind', value: 'PersistentVolumeClaim' },
  { kinds: ['DaemonSet'], path: 'spec.updateStrategy.type', value: 'RollingUpdate' },
  { kinds: ['DaemonSet'], path: 'spec.updateStrategy.rollingUpdate.maxUnavailable', value: 1 },
  { kinds: ['DaemonSet'], path: 'spec.updateStrategy.rollingUpdate.maxSurge', value: 0 },
  { kinds: ['DaemonSet'], path: 'spec.revisionHistoryLimit', value: 10 },
  { kinds: ['Service'], path: 'spec.type', value: 'ClusterIP' },
  { kinds: ['Service'], path: 'spec.sessionAffinity', value: 'None' },
  { kinds: ['Service'], path: 'spec.ipFamilyPolicy', value: 'SingleStack' },
  { kinds: ['Service'], path: 'spec.ipFamilies', when: 'singleIpFamily' },
  { kinds: ['Service'], path: 'spec.internalTrafficPolicy', value: 'Cluster' },
  { kinds: ['Service'], path: 'spec.externalTrafficPolicy', value: 'Cluster' },
  { kinds: ['Service'], path: 'spec.allocateLoadBalancerNodePorts', value: true },
  { kinds: ['Service'], path: 'spec.ports[].protocol', value: 'TCP' },
  { kinds: ['Service'], path: 'spec.ports[].targetPort', when: 'targetPortEqualsPort' },
  { kinds: ['PersistentVolumeClaim'], path: 'spec.volumeMode', value: 'Filesystem' },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.minReplicas', value: 1 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.stabilizationWindowSeconds', value: 0 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.selectPolicy', value: 'Max' },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.policies[Pods/15].type', value: 'Pods' },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.policies[Pods/15].periodSeconds', value: 15 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.policies[Pods/15].value', value: 4 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.policies[Percent/15].type', value: 'Percent' },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.policies[Percent/15].periodSeconds', value: 15 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleUp.policies[Percent/15].value', value: 100 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleDown.stabilizationWindowSeconds', value: 300 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleDown.selectPolicy', value: 'Max' },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleDown.policies[Percent/15].type', value: 'Percent' },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleDown.policies[Percent/15].periodSeconds', value: 15 },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.scaleDown.policies[Percent/15].value', value: 100 },
]);

/**
 * 관리 필드 (계약 10.5). condition 은 api 드리프트 엔진이 해석한다:
 *   hpaTarget: 현재 클러스터 HPA 의 scaleTargetRef 가 이 워크로드
 *   always: 항상
 *   clusterGreater: 클러스터 값(수량) > 스냅샷 값
 *   snapshotAbsent: 스냅샷에 없음 (clusterValue 가 있으면 클러스터 값이 그 값일 때만)
 */
export const MANAGED_FIELDS = Object.freeze([
  { id: 'HPA_REPLICAS', kinds: ['Deployment', 'StatefulSet'], path: 'spec.replicas', condition: 'hpaTarget', reason: 'HPA가 관리' },
  {
    id: 'ROLLOUT_RESTART',
    kinds: WORKLOADS,
    path: 'spec.template.metadata.annotations["kubectl.kubernetes.io/restartedAt"]',
    condition: 'always',
    reason: 'kubectl rollout restart 기록',
  },
  { id: 'PVC_EXPANDED', kinds: ['PersistentVolumeClaim'], path: 'spec.resources.requests.storage', condition: 'clusterGreater', reason: '볼륨 확장' },
  { id: 'NODEPORT_AUTO', kinds: ['Service'], path: 'spec.ports[].nodePort', condition: 'snapshotAbsent', reason: '자동 할당' },
  {
    id: 'LB_CLASS_WEBHOOK',
    kinds: ['Service'],
    path: 'spec.loadBalancerClass',
    condition: 'snapshotAbsent',
    clusterValue: 'service.k8s.aws/nlb',
    reason: 'AWS Load Balancer Controller 웹훅이 설정',
  },
  { id: 'DEFAULT_STORAGE_CLASS', kinds: ['PersistentVolumeClaim'], path: 'spec.storageClassName', condition: 'snapshotAbsent', reason: '기본 StorageClass가 설정' },
  { id: 'DEFAULT_INGRESS_CLASS', kinds: ['Ingress'], path: 'spec.ingressClassName', condition: 'snapshotAbsent', reason: '기본 IngressClass가 설정' },
]);

/**
 * 이름 있는 목록 (계약 10.4). path = 목록 자신의 경로 패턴.
 * keys = 후보 키 목록(앞에서부터 모든 필드가 있는 첫 후보), defaults = 키 필드 기본값(없으면 이 값으로 본다)
 */
export const LIST_KEYS = Object.freeze([
  ...CONTAINER_LISTS.map((l) => ({ path: `**.${l}`, keys: [['name']] })),
  ...CONTAINER_LISTS.map((l) => ({
    path: `**.${l}[].ports`,
    keys: [['name'], ['containerPort', 'protocol']],
    defaults: { protocol: 'TCP' },
  })),
  { path: '**.env', keys: [['name']] },
  { path: '**.envFrom', keys: [['prefix', 'configMapRef.name', 'secretRef.name']], defaults: { prefix: '', 'configMapRef.name': '', 'secretRef.name': '' } },
  { path: '**.volumes', keys: [['name']] },
  { path: '**.volumeMounts', keys: [['mountPath']] },
  { path: '**.volumeDevices', keys: [['devicePath']] },
  { kinds: ['Service'], path: 'spec.ports', keys: [['name'], ['port', 'protocol']], defaults: { protocol: 'TCP' } },
  { path: '**.tolerations', keys: [['key', 'operator', 'value', 'effect']], defaults: { key: '', operator: 'Equal', value: '', effect: '' } },
  { path: '**.imagePullSecrets', keys: [['name']] },
  { path: '**.hostAliases', keys: [['ip']] },
  { path: '**.topologySpreadConstraints', keys: [['topologyKey', 'whenUnsatisfiable']] },
  { kinds: ['StatefulSet'], path: 'spec.volumeClaimTemplates', keys: [['metadata.name']] },
  { kinds: ['HorizontalPodAutoscaler'], path: 'spec.behavior.*.policies', keys: [['type', 'periodSeconds']] },
  {
    kinds: ['HorizontalPodAutoscaler'],
    path: 'spec.metrics',
    keys: [['type', 'resource.name'], ['type', 'pods.metric.name'], ['type', 'object.metric.name'], ['type', 'external.metric.name'], ['type', 'containerResource.name']],
  },
  { kinds: ['Ingress'], path: 'spec.tls', keys: [['secretName']] },
  { kinds: ['Ingress'], path: 'spec.rules', keys: [['host']], defaults: { host: '*' } },
  { kinds: ['Ingress'], path: 'spec.rules[].http.paths', keys: [['path', 'pathType']], defaults: { path: '' } },
]);

/** 순서가 의미 있는 목록: 키 짝 비교와 별도로 이름 순서 차이를 1건으로 */
export const ORDER_SENSITIVE_LISTS = Object.freeze(['**.initContainers']);

/** 쿠버네티스 수량으로 비교할 잎 */
export const QUANTITY_PATHS = Object.freeze([
  '**.resources.requests.*',
  '**.resources.limits.*',
  '**.emptyDir.sizeLimit',
  '**.target.averageValue',
  '**.target.value',
  '**.overhead.*',
]);

/** 값을 가릴 잎 (계약 10.6). 스캐너에 걸리는 값은 엔진이 따로 가린다 */
export const MASKED_PATHS = Object.freeze([
  ...CONTAINER_LISTS.map((l) => `**.${l}[].env[].value`),
  ...CONTAINER_LISTS.map((l) => `**.${l}[].command`),
  ...CONTAINER_LISTS.map((l) => `**.${l}[].args`),
]);
