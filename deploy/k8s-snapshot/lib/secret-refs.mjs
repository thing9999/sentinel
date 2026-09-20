// 워크로드가 참조하는 Secret 이름 모으기 (Q1 결정: Secret 객체를 읽지 않는다). docs/api/k8s-snapshot.md 3.3
// 키 이름은 스캐너에 걸리지 않게 정한다 (secretName, keys …).

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function podSpecOf(obj) {
  const k = obj?.kind;
  if (['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'ReplicationController'].includes(k)) return obj?.spec?.template?.spec;
  if (k === 'CronJob') return obj?.spec?.jobTemplate?.spec?.template?.spec;
  if (k === 'Pod') return obj?.spec;
  return null;
}

/**
 * @param {object[]} objects 정리된 리소스 (apiVersion/kind/metadata 있음)
 */
export function collectSecretRefs(objects) {
  const map = new Map();
  const add = (namespace, secretName, via, obj, { key = null, optional = false, container = null } = {}) => {
    if (!secretName || !namespace) return;
    const id = `${namespace}/${secretName}`;
    let e = map.get(id);
    if (!e) {
      e = { namespace, secretName, keys: [], optional: true, referencedBy: [] };
      map.set(id, e);
    }
    if (key && !e.keys.includes(key)) e.keys.push(key);
    if (!optional) e.optional = false;
    const ref = { kind: obj.kind, name: obj.metadata?.name ?? '', via, container };
    if (!e.referencedBy.some((r) => r.kind === ref.kind && r.name === ref.name && r.via === ref.via && r.container === ref.container))
      e.referencedBy.push(ref);
  };

  for (const obj of objects) {
    const ns = obj?.metadata?.namespace;
    const pod = podSpecOf(obj);
    if (isObj(pod)) {
      for (const list of ['containers', 'initContainers', 'ephemeralContainers']) {
        for (const c of Array.isArray(pod[list]) ? pod[list] : []) {
          for (const env of Array.isArray(c?.env) ? c.env : []) {
            const r = env?.valueFrom?.secretKeyRef;
            if (isObj(r)) add(ns, r.name, 'env.valueFrom.secretKeyRef', obj, { key: r.key ?? null, optional: r.optional === true, container: c.name ?? null });
          }
          for (const ef of Array.isArray(c?.envFrom) ? c.envFrom : []) {
            const r = ef?.secretRef;
            if (isObj(r)) add(ns, r.name, 'envFrom.secretRef', obj, { optional: r.optional === true, container: c.name ?? null });
          }
        }
      }
      for (const v of Array.isArray(pod.volumes) ? pod.volumes : []) {
        if (isObj(v?.secret)) add(ns, v.secret.secretName, 'volumes.secret', obj, { optional: v.secret.optional === true });
        for (const src of Array.isArray(v?.projected?.sources) ? v.projected.sources : []) {
          if (isObj(src?.secret)) add(ns, src.secret.name, 'volumes.projected.secret', obj, { optional: src.secret.optional === true });
        }
        if (isObj(v?.csi?.nodePublishSecretRef)) add(ns, v.csi.nodePublishSecretRef.name, 'volumes.csi.nodePublishSecretRef', obj);
      }
      for (const s of Array.isArray(pod.imagePullSecrets) ? pod.imagePullSecrets : []) add(ns, s?.name, 'imagePullSecrets', obj);
    }
    if (obj?.kind === 'ServiceAccount') {
      for (const s of Array.isArray(obj.imagePullSecrets) ? obj.imagePullSecrets : []) add(ns, s?.name, 'serviceAccount.imagePullSecrets', obj);
    }
    if (obj?.kind === 'Ingress') {
      for (const t of Array.isArray(obj?.spec?.tls) ? obj.spec.tls : []) add(ns, t?.secretName, 'ingress.tls', obj);
    }
  }
  return [...map.values()]
    .map((e) => ({ ...e, keys: [...e.keys].sort() }))
    .sort((a, b) => (a.namespace + '/' + a.secretName < b.namespace + '/' + b.secretName ? -1 : 1));
}

export function buildSecretRefsFile(snapshotId, secrets) {
  return {
    schemaVersion: 1,
    snapshotId,
    note: 'Secret 값은 담지 않습니다. 복원 전에 아래 Secret 을 별도 보관소에서 다시 만드세요.',
    secrets,
  };
}
