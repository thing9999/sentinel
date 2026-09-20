/**
 * 드리프트 비교 가능 종류 (docs/api/k8s-snapshot.md 10.2).
 * = 대시보드 RBAC(deploy/rbac.yaml)에 get/list/watch 가 있고 KubeWatcherService 가 informer 로 보관하는 종류.
 * RBAC 를 늘리지 않는다 (Q3). 목록이 바뀌면 comparable-kinds.spec.ts 가 rbac.yaml·informer 와 맞는지 확인한다.
 * id = informer 이름 = 스냅샷 종류 폴더 이름.
 */
export interface ComparableKind {
  id: string;
  apiGroup: string;
  apiVersion: string;
  kind: string;
  namespaced: boolean;
  /** RBAC 리소스 이름 */
  rbacResource: string;
  /** informer 경로 */
  informerPath: string;
}

export const COMPARABLE_KINDS: readonly ComparableKind[] = Object.freeze([
  {
    id: 'namespaces',
    apiGroup: '',
    apiVersion: 'v1',
    kind: 'Namespace',
    namespaced: false,
    rbacResource: 'namespaces',
    informerPath: '/api/v1/namespaces',
  },
  {
    id: 'deployments',
    apiGroup: 'apps',
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    namespaced: true,
    rbacResource: 'deployments',
    informerPath: '/apis/apps/v1/deployments',
  },
  {
    id: 'statefulsets',
    apiGroup: 'apps',
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    namespaced: true,
    rbacResource: 'statefulsets',
    informerPath: '/apis/apps/v1/statefulsets',
  },
  {
    id: 'daemonsets',
    apiGroup: 'apps',
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    namespaced: true,
    rbacResource: 'daemonsets',
    informerPath: '/apis/apps/v1/daemonsets',
  },
  {
    id: 'services',
    apiGroup: '',
    apiVersion: 'v1',
    kind: 'Service',
    namespaced: true,
    rbacResource: 'services',
    informerPath: '/api/v1/services',
  },
  {
    id: 'ingresses',
    apiGroup: 'networking.k8s.io',
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    namespaced: true,
    rbacResource: 'ingresses',
    informerPath: '/apis/networking.k8s.io/v1/ingresses',
  },
  {
    id: 'persistentvolumeclaims',
    apiGroup: '',
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    namespaced: true,
    rbacResource: 'persistentvolumeclaims',
    informerPath: '/api/v1/persistentvolumeclaims',
  },
  {
    id: 'poddisruptionbudgets',
    apiGroup: 'policy',
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    namespaced: true,
    rbacResource: 'poddisruptionbudgets',
    informerPath: '/apis/policy/v1/poddisruptionbudgets',
  },
  {
    id: 'horizontalpodautoscalers',
    apiGroup: 'autoscaling',
    apiVersion: 'autoscaling/v2',
    kind: 'HorizontalPodAutoscaler',
    namespaced: true,
    rbacResource: 'horizontalpodautoscalers',
    informerPath: '/apis/autoscaling/v2/horizontalpodautoscalers',
  },
]);

export const COMPARABLE_IDS = new Set(COMPARABLE_KINDS.map((k) => k.id));
