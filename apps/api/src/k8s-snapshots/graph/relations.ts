/**
 * k8s 관계 추출 K1~K11 (docs/api/snapshot-3d.md 5절).
 * **순수 함수**: 파일·클러스터·네트워크에 접근하지 않고 이미 해석된 문서 객체만 읽는다.
 * 셀렉터·레이블·어노테이션 **값은 결과에 담지 않는다**. 결과는 선과 근거 코드·문구뿐이다(AC-3D14).
 */
import type { Certainty, GhostReason, Note, RuleId } from './graph-types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;

export interface RelationIdentity {
  apiGroup: string;
  apiVersion: string;
  kind: string;
  namespace: string | null;
  name: string;
}

export interface RelationDoc {
  blockId: string;
  key: string;
  identity: RelationIdentity;
  obj: Obj;
}

export interface GhostSpec {
  key: string;
  apiGroup: string;
  kind: string;
  namespace: string | null;
  name: string;
  reason: GhostReason;
  fromRules: RuleId[];
  /** Secret 유령의 참조 키 개수 (이름·값은 담지 않는다) */
  referencedKeys: number;
}

export interface RawEvidence {
  code: string;
  text: string;
  container: string | null;
  optional: boolean;
}

export interface RawEdge {
  rule: RuleId;
  from: string;
  to: string;
  certainty: Certainty;
  toGhost: boolean;
  evidence: RawEvidence[];
}

export interface RelationResult {
  edges: RawEdge[];
  ghosts: GhostSpec[];
  /** blockId → 표시 문구 (대상 없음·셀렉터 없음·PVC 템플릿) */
  notes: Map<string, Note[]>;
}

const EV: Record<string, string> = {
  INGRESS_BACKEND: 'Ingress 규칙의 backend.service.name',
  INGRESS_DEFAULT_BACKEND: 'Ingress defaultBackend',
  SELECTOR_MATCH: 'Service 셀렉터가 파드 템플릿 레이블과 맞음',
  PVC_CLAIM_NAME: 'volumes.persistentVolumeClaim.claimName',
  VCT_NAME_PATTERN: 'volumeClaimTemplates 이름 규칙 <템플릿>-<이름>-<순번>',
  ENV_FROM_CONFIGMAP: 'envFrom.configMapRef',
  ENV_CONFIGMAP_KEY: 'env.valueFrom.configMapKeyRef',
  VOLUME_CONFIGMAP: 'volumes.configMap',
  PROJECTED_CONFIGMAP: 'volumes.projected.configMap',
  ENV_FROM_SECRET: 'envFrom.secretRef',
  ENV_SECRET_KEY: 'env.valueFrom.secretKeyRef',
  VOLUME_SECRET: 'volumes.secret',
  PROJECTED_SECRET: 'volumes.projected.secret',
  CSI_NODE_PUBLISH_SECRET: 'volumes.csi.nodePublishSecretRef',
  IMAGE_PULL_SECRET: 'imagePullSecrets',
  INGRESS_TLS_SECRET: 'Ingress spec.tls.secretName',
  HPA_SCALE_TARGET: 'HPA spec.scaleTargetRef',
  PDB_SELECTOR_MATCH: 'PDB 셀렉터가 파드 템플릿 레이블과 맞음',
  SERVICE_ACCOUNT_NAME: 'spec.template.spec.serviceAccountName',
  SERVICE_ACCOUNT_DEFAULT: 'serviceAccountName 없음 → default',
  NETPOL_POD_SELECTOR: 'NetworkPolicy podSelector가 맞음',
  NETPOL_NAMESPACE_WIDE: 'podSelector 비어 있음 = 네임스페이스 전체',
  ROLE_REF: 'RoleBinding roleRef',
  SUBJECT_SERVICE_ACCOUNT: 'RoleBinding subjects (ServiceAccount)',
};

const WORKLOAD_KINDS = new Set([
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'CronJob',
  'Job',
]);

const CORE_GROUP_OF: Record<string, string> = {
  ConfigMap: '',
  Secret: '',
  Service: '',
  PersistentVolumeClaim: '',
  ServiceAccount: '',
  Role: 'rbac.authorization.k8s.io',
  ClusterRole: 'rbac.authorization.k8s.io',
};

function keyOf(
  apiGroup: string,
  kind: string,
  ns: string | null,
  name: string,
): string {
  return `${apiGroup || 'core'}/${kind}/${ns ?? '_cluster'}/${name}`;
}

/** 파드 템플릿 (CronJob 은 jobTemplate 아래) */
function podSpecOf(obj: Obj, kind: string): Obj | null {
  const spec = isObj(obj.spec) ? obj.spec : null;
  if (!spec) return null;
  const tpl =
    kind === 'CronJob'
      ? isObj(spec.jobTemplate) && isObj(spec.jobTemplate.spec)
        ? spec.jobTemplate.spec.template
        : null
      : spec.template;
  if (!isObj(tpl)) return null;
  return isObj(tpl.spec) ? tpl.spec : null;
}

function templateLabels(obj: Obj, kind: string): Record<string, string> {
  const spec = isObj(obj.spec) ? obj.spec : null;
  if (!spec) return {};
  const tpl =
    kind === 'CronJob'
      ? isObj(spec.jobTemplate) && isObj(spec.jobTemplate.spec)
        ? spec.jobTemplate.spec.template
        : null
      : spec.template;
  if (!isObj(tpl) || !isObj(tpl.metadata) || !isObj(tpl.metadata.labels))
    return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tpl.metadata.labels))
    if (typeof v === 'string') out[k] = v;
  return out;
}

function containersOf(podSpec: Obj): { name: string | null; c: Obj }[] {
  const out: { name: string | null; c: Obj }[] = [];
  for (const field of ['containers', 'initContainers', 'ephemeralContainers'])
    for (const c of arr(podSpec[field]))
      if (isObj(c)) out.push({ name: str(c.name), c });
  return out;
}

/** sel ⊆ labels (빈 sel 은 호출 쪽에서 판단) */
function subset(
  sel: Record<string, string>,
  labels: Record<string, string>,
): boolean {
  for (const [k, v] of Object.entries(sel)) if (labels[k] !== v) return false;
  return true;
}

function plainSelector(v: unknown): Record<string, string> | null {
  if (!isObj(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v))
    if (typeof val === 'string') out[k] = val;
  return out;
}

function matchLabelsOf(v: unknown): Record<string, string> | null {
  if (!isObj(v)) return null;
  return plainSelector(v.matchLabels) ?? {};
}

interface WorkloadEntry {
  doc: RelationDoc;
  labels: Record<string, string>;
}

export function extractRelations(
  docs: readonly RelationDoc[],
  enabled?: ReadonlySet<RuleId>,
): RelationResult {
  const on = (r: RuleId) => !enabled || enabled.has(r);
  const edges = new Map<string, RawEdge>();
  const ghosts = new Map<string, GhostSpec>();
  const notes = new Map<string, Note[]>();

  const byName = new Map<string, string>(); // ns|kind|name → blockId
  const workloadsByNs = new Map<string, WorkloadEntry[]>();
  const pvcsByNs = new Map<string, { name: string; id: string }[]>();

  for (const d of docs) {
    const ns = d.identity.namespace ?? '_cluster';
    const nk = `${ns}\u0000${d.identity.kind}\u0000${d.identity.name}`;
    if (!byName.has(nk)) byName.set(nk, d.blockId);
    if (WORKLOAD_KINDS.has(d.identity.kind)) {
      const list = workloadsByNs.get(ns) ?? [];
      list.push({ doc: d, labels: templateLabels(d.obj, d.identity.kind) });
      workloadsByNs.set(ns, list);
    }
    if (d.identity.kind === 'PersistentVolumeClaim') {
      const list = pvcsByNs.get(ns) ?? [];
      list.push({ name: d.identity.name, id: d.blockId });
      pvcsByNs.set(ns, list);
    }
  }

  const addNote = (blockId: string, note: Note) => {
    const list = notes.get(blockId) ?? [];
    if (!list.some((n) => n.code === note.code)) list.push(note);
    notes.set(blockId, list);
  };

  /** 대상 블록 id (없으면 유령을 만들고 그 id) */
  const target = (
    kind: string,
    ns: string | null,
    name: string,
    rule: RuleId,
    ghostReason: GhostReason,
    opts: { forceGhost?: boolean; keys?: number } = {},
  ): { id: string; ghost: boolean } => {
    const group = CORE_GROUP_OF[kind] ?? '';
    const key = keyOf(group, kind, ns, name);
    if (!opts.forceGhost) {
      const hit = byName.get(`${ns ?? '_cluster'}\u0000${kind}\u0000${name}`);
      if (hit) return { id: hit, ghost: false };
    }
    const id = `ghost:${key}`;
    const cur = ghosts.get(id);
    if (cur) {
      if (!cur.fromRules.includes(rule)) cur.fromRules.push(rule);
      if (opts.keys) cur.referencedKeys += opts.keys;
    } else {
      ghosts.set(id, {
        key,
        apiGroup: group,
        kind,
        namespace: ns,
        name,
        reason: ghostReason,
        fromRules: [rule],
        referencedKeys: opts.keys ?? 0,
      });
    }
    return { id, ghost: true };
  };

  const link = (
    rule: RuleId,
    from: string,
    to: { id: string; ghost: boolean },
    certainty: Certainty,
    code: string,
    container: string | null = null,
    optional = false,
  ) => {
    if (from === to.id) return;
    const id = `${rule}|${from}|${to.id}`;
    const cur = edges.get(id);
    const ev: RawEvidence = {
      code,
      text: EV[code] ?? code,
      container,
      optional,
    };
    if (cur) {
      if (
        !cur.evidence.some((e) => e.code === code && e.container === container)
      )
        cur.evidence.push(ev);
      return;
    }
    edges.set(id, {
      rule,
      from,
      to: to.id,
      certainty,
      toGhost: to.ghost,
      evidence: [ev],
    });
  };

  for (const d of docs) {
    const { kind, namespace } = d.identity;
    const ns = namespace;
    const nsKey = ns ?? '_cluster';
    const obj = d.obj;
    const spec = isObj(obj.spec) ? obj.spec : {};

    // ---------------- Ingress: K1 · K6(tls)
    if (kind === 'Ingress') {
      if (on('K1')) {
        const backends: { name: string; code: string }[] = [];
        for (const rule of arr(spec.rules)) {
          if (!isObj(rule) || !isObj(rule.http)) continue;
          for (const p of arr(rule.http.paths)) {
            if (!isObj(p) || !isObj(p.backend) || !isObj(p.backend.service))
              continue;
            const n = str(p.backend.service.name);
            if (n) backends.push({ name: n, code: 'INGRESS_BACKEND' });
          }
        }
        if (isObj(spec.defaultBackend) && isObj(spec.defaultBackend.service)) {
          const n = str(spec.defaultBackend.service.name);
          if (n) backends.push({ name: n, code: 'INGRESS_DEFAULT_BACKEND' });
        }
        for (const b of backends)
          link(
            'K1',
            d.blockId,
            target('Service', ns, b.name, 'K1', 'not_in_snapshot'),
            'confirmed',
            b.code,
          );
      }
      if (on('K6'))
        for (const t of arr(spec.tls)) {
          const n = isObj(t) ? str(t.secretName) : null;
          if (!n) continue;
          link(
            'K6',
            d.blockId,
            target('Secret', ns, n, 'K6', 'secret', { forceGhost: true }),
            'confirmed',
            'INGRESS_TLS_SECRET',
          );
        }
    }

    // ---------------- Service: K2
    if (kind === 'Service' && on('K2')) {
      const sel = plainSelector(spec.selector);
      if (!sel || Object.keys(sel).length === 0) {
        addNote(d.blockId, {
          code: 'selector_missing',
          text: '셀렉터 없음(수동 Endpoints·ExternalName)',
        });
      } else {
        const hits = (workloadsByNs.get(nsKey) ?? []).filter((w) =>
          subset(sel, w.labels),
        );
        if (!hits.length)
          addNote(d.blockId, { code: 'no_target', text: '대상 없음' });
        for (const w of hits)
          link(
            'K2',
            d.blockId,
            { id: w.doc.blockId, ghost: false },
            'estimated',
            'SELECTOR_MATCH',
          );
      }
    }

    // ---------------- 워크로드: K3 · K4 · K5 · K6 · K9
    if (WORKLOAD_KINDS.has(kind)) {
      const pod = podSpecOf(obj, kind);
      if (pod) {
        const volumes = arr(pod.volumes).filter(isObj);
        if (on('K3'))
          for (const v of volumes) {
            const claim = isObj(v.persistentVolumeClaim)
              ? str(v.persistentVolumeClaim.claimName)
              : null;
            if (!claim) continue;
            link(
              'K3',
              d.blockId,
              target(
                'PersistentVolumeClaim',
                ns,
                claim,
                'K3',
                'not_in_snapshot',
              ),
              'confirmed',
              'PVC_CLAIM_NAME',
            );
          }
        if (on('K5') || on('K6'))
          for (const { name: cname, c } of containersOf(pod)) {
            for (const ef of arr(c.envFrom)) {
              if (!isObj(ef)) continue;
              if (on('K5') && isObj(ef.configMapRef)) {
                const n = str(ef.configMapRef.name);
                if (n)
                  link(
                    'K5',
                    d.blockId,
                    target('ConfigMap', ns, n, 'K5', 'not_in_snapshot'),
                    'confirmed',
                    'ENV_FROM_CONFIGMAP',
                    cname,
                    ef.configMapRef.optional === true,
                  );
              }
              if (on('K6') && isObj(ef.secretRef)) {
                const n = str(ef.secretRef.name);
                if (n)
                  link(
                    'K6',
                    d.blockId,
                    target('Secret', ns, n, 'K6', 'secret', {
                      forceGhost: true,
                    }),
                    'confirmed',
                    'ENV_FROM_SECRET',
                    cname,
                    ef.secretRef.optional === true,
                  );
              }
            }
            for (const e of arr(c.env)) {
              if (!isObj(e) || !isObj(e.valueFrom)) continue;
              const vf = e.valueFrom;
              if (on('K5') && isObj(vf.configMapKeyRef)) {
                const n = str(vf.configMapKeyRef.name);
                if (n)
                  link(
                    'K5',
                    d.blockId,
                    target('ConfigMap', ns, n, 'K5', 'not_in_snapshot'),
                    'confirmed',
                    'ENV_CONFIGMAP_KEY',
                    cname,
                    vf.configMapKeyRef.optional === true,
                  );
              }
              if (on('K6') && isObj(vf.secretKeyRef)) {
                const n = str(vf.secretKeyRef.name);
                if (n)
                  link(
                    'K6',
                    d.blockId,
                    target('Secret', ns, n, 'K6', 'secret', {
                      forceGhost: true,
                      keys: 1,
                    }),
                    'confirmed',
                    'ENV_SECRET_KEY',
                    cname,
                    vf.secretKeyRef.optional === true,
                  );
              }
            }
          }
        for (const v of volumes) {
          if (on('K5') && isObj(v.configMap)) {
            const n = str(v.configMap.name);
            if (n)
              link(
                'K5',
                d.blockId,
                target('ConfigMap', ns, n, 'K5', 'not_in_snapshot'),
                'confirmed',
                'VOLUME_CONFIGMAP',
                null,
                v.configMap.optional === true,
              );
          }
          if (on('K6') && isObj(v.secret)) {
            const n = str(v.secret.secretName) ?? str(v.secret.name);
            if (n)
              link(
                'K6',
                d.blockId,
                target('Secret', ns, n, 'K6', 'secret', { forceGhost: true }),
                'confirmed',
                'VOLUME_SECRET',
                null,
                v.secret.optional === true,
              );
          }
          if (on('K6') && isObj(v.csi) && isObj(v.csi.nodePublishSecretRef)) {
            const n = str(v.csi.nodePublishSecretRef.name);
            if (n)
              link(
                'K6',
                d.blockId,
                target('Secret', ns, n, 'K6', 'secret', { forceGhost: true }),
                'confirmed',
                'CSI_NODE_PUBLISH_SECRET',
              );
          }
          if (isObj(v.projected))
            for (const s of arr(v.projected.sources)) {
              if (!isObj(s)) continue;
              if (on('K5') && isObj(s.configMap)) {
                const n = str(s.configMap.name);
                if (n)
                  link(
                    'K5',
                    d.blockId,
                    target('ConfigMap', ns, n, 'K5', 'not_in_snapshot'),
                    'confirmed',
                    'PROJECTED_CONFIGMAP',
                    null,
                    s.configMap.optional === true,
                  );
              }
              if (on('K6') && isObj(s.secret)) {
                const n = str(s.secret.name);
                if (n)
                  link(
                    'K6',
                    d.blockId,
                    target('Secret', ns, n, 'K6', 'secret', {
                      forceGhost: true,
                    }),
                    'confirmed',
                    'PROJECTED_SECRET',
                    null,
                    s.secret.optional === true,
                  );
              }
            }
        }
        if (on('K6'))
          for (const ips of arr(pod.imagePullSecrets)) {
            const n = isObj(ips) ? str(ips.name) : null;
            if (!n) continue;
            link(
              'K6',
              d.blockId,
              target('Secret', ns, n, 'K6', 'secret', { forceGhost: true }),
              'confirmed',
              'IMAGE_PULL_SECRET',
            );
          }
        if (on('K9')) {
          const sa = str(pod.serviceAccountName);
          link(
            'K9',
            d.blockId,
            target('ServiceAccount', ns, sa ?? 'default', 'K9', 'autocreated'),
            'confirmed',
            sa ? 'SERVICE_ACCOUNT_NAME' : 'SERVICE_ACCOUNT_DEFAULT',
          );
        }
      }
      if (kind === 'StatefulSet' && on('K4')) {
        const tpls = arr(spec.volumeClaimTemplates)
          .filter(isObj)
          .map((t) => (isObj(t.metadata) ? str(t.metadata.name) : null))
          .filter((n): n is string => n !== null);
        let matched = 0;
        for (const t of tpls) {
          const re = new RegExp(
            `^${escapeRe(t)}-${escapeRe(d.identity.name)}-\\d+$`,
          );
          for (const pvc of pvcsByNs.get(nsKey) ?? []) {
            if (!re.test(pvc.name)) continue;
            matched++;
            link(
              'K4',
              d.blockId,
              { id: pvc.id, ghost: false },
              'estimated',
              'VCT_NAME_PATTERN',
            );
          }
        }
        if (tpls.length && matched === 0)
          addNote(d.blockId, {
            code: 'pvc_template_unmatched',
            text: `PVC 템플릿 ${tpls.length}개(스냅샷에 PVC 없음)`,
            count: tpls.length,
          });
      }
    }

    // ---------------- HPA: K7
    if (kind === 'HorizontalPodAutoscaler' && on('K7')) {
      const ref = isObj(spec.scaleTargetRef) ? spec.scaleTargetRef : null;
      const k = ref ? str(ref.kind) : null;
      const n = ref ? str(ref.name) : null;
      if (k && n)
        link(
          'K7',
          d.blockId,
          target(k, ns, n, 'K7', 'not_in_snapshot'),
          'confirmed',
          'HPA_SCALE_TARGET',
        );
    }

    // ---------------- PDB: K8
    if (kind === 'PodDisruptionBudget' && on('K8')) {
      const sel = matchLabelsOf(spec.selector);
      if (!sel || Object.keys(sel).length === 0) {
        addNote(d.blockId, {
          code: 'selector_missing',
          text: '셀렉터 없음(수동 Endpoints·ExternalName)',
        });
      } else {
        const hits = (workloadsByNs.get(nsKey) ?? []).filter((w) =>
          subset(sel, w.labels),
        );
        if (!hits.length)
          addNote(d.blockId, { code: 'no_target', text: '대상 없음' });
        for (const w of hits)
          link(
            'K8',
            d.blockId,
            { id: w.doc.blockId, ghost: false },
            'estimated',
            'PDB_SELECTOR_MATCH',
          );
      }
    }

    // ---------------- NetworkPolicy: K10
    if (kind === 'NetworkPolicy' && on('K10')) {
      const sel = matchLabelsOf(spec.podSelector);
      const wide = !sel || Object.keys(sel).length === 0;
      const hits = (workloadsByNs.get(nsKey) ?? []).filter(
        (w) => wide || subset(sel, w.labels),
      );
      if (!hits.length)
        addNote(d.blockId, { code: 'no_target', text: '대상 없음' });
      for (const w of hits)
        link(
          'K10',
          d.blockId,
          { id: w.doc.blockId, ghost: false },
          'estimated',
          wide ? 'NETPOL_NAMESPACE_WIDE' : 'NETPOL_POD_SELECTOR',
        );
    }

    // ---------------- RoleBinding: K11
    if (
      (kind === 'RoleBinding' || kind === 'ClusterRoleBinding') &&
      on('K11')
    ) {
      const ref = isObj(obj.roleRef) ? obj.roleRef : null;
      const rk = ref ? str(ref.kind) : null;
      const rn = ref ? str(ref.name) : null;
      if (rk && rn)
        link(
          'K11',
          d.blockId,
          target(
            rk,
            rk === 'ClusterRole' ? null : ns,
            rn,
            'K11',
            rk === 'ClusterRole' ? 'cluster_scope' : 'not_in_snapshot',
          ),
          'confirmed',
          'ROLE_REF',
        );
      for (const s of arr(obj.subjects)) {
        if (!isObj(s) || str(s.kind) !== 'ServiceAccount') continue;
        const n = str(s.name);
        if (!n) continue;
        link(
          'K11',
          d.blockId,
          target(
            'ServiceAccount',
            str(s.namespace) ?? ns,
            n,
            'K11',
            'autocreated',
          ),
          'confirmed',
          'SUBJECT_SERVICE_ACCOUNT',
        );
      }
    }
  }

  return {
    edges: [...edges.values()],
    ghosts: [...ghosts.values()],
    notes,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
