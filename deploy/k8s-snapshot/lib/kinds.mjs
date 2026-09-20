// 내보낼 리소스 종류 목록 (docs/api/k8s-snapshot.md 3.5).
// api 가 이 파일을 동적 import 한다 → Node 내장 모듈 외 import 금지 (계약 2.2).

/**
 * @typedef {object} KindEntry
 * @property {string} id           종류 ID = 스냅샷 폴더 이름 (plural, 사용자 지정은 plural.group)
 * @property {string} kind
 * @property {string} singular
 * @property {string} group        코어는 ''
 * @property {string} version
 * @property {string} apiVersion   group/version (코어는 version)
 * @property {boolean} namespaced
 * @property {'default'|'optional'|'custom'} tier
 * @property {boolean} dashboardComparable  대시보드 드리프트 비교 가능 여부 (참고값. 실제 판단은 api COMPARABLE_KINDS)
 */

const k = (id, kind, group, version, namespaced, tier, dashboardComparable = false) => ({
  id,
  kind,
  singular: kind.toLowerCase(),
  group,
  version,
  apiVersion: group ? `${group}/${version}` : version,
  namespaced,
  tier,
  dashboardComparable,
});

/** @type {readonly KindEntry[]} 순서 = 화면 트리의 종류 순서 */
export const KIND_CATALOG = Object.freeze([
  k('namespaces', 'Namespace', '', 'v1', false, 'default', true),
  k('deployments', 'Deployment', 'apps', 'v1', true, 'default', true),
  k('statefulsets', 'StatefulSet', 'apps', 'v1', true, 'default', true),
  k('daemonsets', 'DaemonSet', 'apps', 'v1', true, 'default', true),
  k('services', 'Service', '', 'v1', true, 'default', true),
  k('ingresses', 'Ingress', 'networking.k8s.io', 'v1', true, 'default', true),
  k('persistentvolumeclaims', 'PersistentVolumeClaim', '', 'v1', true, 'default', true),
  k('poddisruptionbudgets', 'PodDisruptionBudget', 'policy', 'v1', true, 'default', true),
  k('horizontalpodautoscalers', 'HorizontalPodAutoscaler', 'autoscaling', 'v2', true, 'default', true),
  k('configmaps', 'ConfigMap', '', 'v1', true, 'default'),
  k('serviceaccounts', 'ServiceAccount', '', 'v1', true, 'default'),
  k('roles', 'Role', 'rbac.authorization.k8s.io', 'v1', true, 'default'),
  k('rolebindings', 'RoleBinding', 'rbac.authorization.k8s.io', 'v1', true, 'default'),
  k('networkpolicies', 'NetworkPolicy', 'networking.k8s.io', 'v1', true, 'default'),
  k('cronjobs', 'CronJob', 'batch', 'v1', true, 'default'),
  k('jobs', 'Job', 'batch', 'v1', true, 'optional'),
  k('resourcequotas', 'ResourceQuota', '', 'v1', true, 'default'),
  k('limitranges', 'LimitRange', '', 'v1', true, 'default'),
  k('clusterroles', 'ClusterRole', 'rbac.authorization.k8s.io', 'v1', false, 'optional'),
  k('clusterrolebindings', 'ClusterRoleBinding', 'rbac.authorization.k8s.io', 'v1', false, 'optional'),
  k('storageclasses', 'StorageClass', 'storage.k8s.io', 'v1', false, 'optional'),
  k('ingressclasses', 'IngressClass', 'networking.k8s.io', 'v1', false, 'optional'),
  k('priorityclasses', 'PriorityClass', 'scheduling.k8s.io', 'v1', false, 'optional'),
  k('persistentvolumes', 'PersistentVolume', '', 'v1', false, 'optional'),
]);

/** 항상 제외하는 종류 (읽지도 않는다). Secret 은 Q1 결정으로 권한도 주지 않는다 */
export const ALWAYS_EXCLUDED_KINDS = Object.freeze([
  'Secret', 'Pod', 'ReplicaSet', 'ControllerRevision', 'Endpoints', 'EndpointSlice', 'Event', 'Lease', 'Node',
  'PodMetrics', 'NodeMetrics',
]);

export const DEFAULT_KIND_IDS = Object.freeze(KIND_CATALOG.filter((e) => e.tier === 'default').map((e) => e.id));
export const OPTIONAL_KIND_IDS = Object.freeze(KIND_CATALOG.filter((e) => e.tier === 'optional').map((e) => e.id));

/** 사용자 지정 리소스 이름: plural.group (그룹에 점이 하나 이상) */
export const CUSTOM_RESOURCE_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)+$/;

/**
 * 설정의 종류 이름 → 목록 항목. 대소문자 무시, plural·단수형·kind 를 받는다. 모르면 null.
 * @param {string} name
 * @returns {KindEntry|null}
 */
export function resolveKind(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  return KIND_CATALOG.find((e) => e.id === n || e.singular === n) ?? null;
}

export function kindById(id) {
  return KIND_CATALOG.find((e) => e.id === id) ?? null;
}

/** apiVersion 의 그룹 + kind 로 찾는다 (버전 무시) */
export function kindByGroupKind(group, kind) {
  return KIND_CATALOG.find((e) => e.group === group && e.kind === kind) ?? null;
}

/** 'apps/v1' → { group: 'apps', version: 'v1' }, 'v1' → { group: '', version: 'v1' } */
export function splitApiVersion(apiVersion) {
  const s = String(apiVersion ?? '');
  const i = s.lastIndexOf('/');
  return i < 0 ? { group: '', version: s } : { group: s.slice(0, i), version: s.slice(i + 1) };
}

/** 사용자 지정 리소스 항목 (discovery 로 kind·version·범위를 알게 된 뒤) */
export function customKind(id, { kind, version, namespaced }) {
  const dot = id.indexOf('.');
  const plural = id.slice(0, dot);
  const group = id.slice(dot + 1);
  return {
    id,
    kind,
    singular: plural,
    group,
    version,
    apiVersion: `${group}/${version}`,
    namespaced,
    tier: 'custom',
    dashboardComparable: false,
  };
}

/** 폴더 이름 */
export function kindDirOf(entry) {
  return entry.id;
}

/** 목록 API 경로 (네임스페이스 범위면 ns 필요) */
export function listPath(entry, namespace) {
  const base = entry.group ? `/apis/${entry.group}/${entry.version}` : `/api/${entry.version}`;
  if (entry.namespaced) return `${base}/namespaces/${encodeURIComponent(namespace)}/${entry.id.split('.')[0]}`;
  return `${base}/${entry.id.split('.')[0]}`;
}
