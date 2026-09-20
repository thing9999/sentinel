/**
 * 판·블록·선·순서·요약 만들기 (docs/api/snapshot-3d.md 3·4·9·10절).
 * 입력은 이미 해석된 분석 결과(K8sAnalysis)뿐이다 — 파일을 다시 읽지 않는다.
 * 드리프트 겹쳐 보기는 여기서 하지 않는다(graph.service.ts 가 응답 때 얹는다).
 */
import { createHash } from 'node:crypto';
import type { K8sAnalysis, K8sFileFact } from '../k8s-analyzer';
import type { K8sRules } from '../k8s-libs';
import {
  extractRelations,
  type GhostSpec,
  type RelationDoc,
} from './relations';
import {
  DEFAULT_ON_RULES,
  FILE_ISSUE_CODES,
  GHOST_TEXT,
  layerOfKind,
  LAYER_ORDER,
  NOTE_TEXT,
  type Block,
  type Edge,
  type GraphFacets,
  type GraphGroup,
  type Markers,
  type Note,
  type Plate,
  type RuleId,
} from './graph-types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v !== '' ? v : null;
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' ? v : null;

export interface BuildOptions {
  rules: K8sRules;
  enabledRules?: ReadonlySet<RuleId>;
  maxBlocks: number;
  maxEdges: number;
}

export interface BaseGraph {
  version: string;
  builtAt: string;
  state: 'ok' | 'pending_export' | 'empty';
  plates: Plate[];
  blocks: Block[];
  edges: Edge[];
  counts: {
    documents: number;
    namespaceDocuments: number;
    resourceBlocks: number;
    unparsedBlocks: number;
    ghosts: number;
    outsideFindings: number;
  };
  truncated: {
    blocks: boolean;
    edges: boolean;
    droppedBlocks: number;
    droppedEdges: number;
    reason: string | null;
  };
  notices: Note[];
  /** 판 id → 네임스페이스 이름 (드리프트 "추가됨" 유령을 붙일 때) */
  plateOfNamespace: Record<string, string>;
  kindRank: Record<string, number>;
}

const emptyMarkers = (): Markers => ({
  scan: { errors: 0, warnings: 0, level: null, count: 0, firstLine: null },
  drift: null,
  fileIssue: null,
  helm: false,
});

/** 구성 지문: 경로 + 파일 version (드리프트·스캔이 바뀌어도 그대로) */
export function graphVersion(
  a: K8sAnalysis,
  enabled?: ReadonlySet<RuleId>,
): string {
  const h = createHash('sha256');
  for (const f of [...a.files].sort((x, y) => (x.path < y.path ? -1 : 1)))
    h.update(`${f.path}\u0000${f.version ?? '-'}\n`);
  if (enabled) h.update(`rules:${[...enabled].sort().join(',')}`);
  return `sha256:${h.digest('hex')}`;
}

function noteOf(code: string, count?: number): Note {
  const text = NOTE_TEXT[code] ?? code;
  return count === undefined ? { code, text } : { code, text, count };
}

function fileIssueOf(notes: Note[]): { code: string; text: string } | null {
  for (const c of FILE_ISSUE_CODES) {
    const n = notes.find((x) => x.code === c);
    if (n) return { code: n.code, text: n.text };
  }
  return null;
}

const PARSE_TEXT: Record<string, string> = {
  yaml_error: '해석 실패 (YAML 구문 오류)',
  not_object: '해석 실패 (최상위가 매핑이 아님)',
  empty: '해석 실패 (빈 파일)',
  too_large: '해석 실패 (크기 초과)',
};

/** 종류별 표시 필드 화이트리스트 (계약 4.4). 여기에 없는 값은 내보내지 않는다 */
export function summarizeResource(kind: string, obj: Obj): Obj {
  const spec = isObj(obj.spec) ? obj.spec : {};
  const pod = (() => {
    const tpl =
      kind === 'CronJob'
        ? isObj(spec.jobTemplate) && isObj(spec.jobTemplate.spec)
          ? spec.jobTemplate.spec.template
          : null
        : spec.template;
    return isObj(tpl) && isObj(tpl.spec) ? tpl.spec : null;
  })();
  const containers = pod ? arr(pod.containers).length : 0;
  const initContainers = pod ? arr(pod.initContainers).length : 0;
  const sa = pod ? str(pod.serviceAccountName) : null;
  switch (kind) {
    case 'Deployment':
      return {
        replicas: numOrNull(spec.replicas),
        containers,
        initContainers,
        serviceAccountName: sa,
      };
    case 'DaemonSet':
      return {
        replicas: null,
        containers,
        initContainers,
        serviceAccountName: sa,
      };
    case 'StatefulSet':
      return {
        replicas: numOrNull(spec.replicas),
        containers,
        initContainers,
        serviceAccountName: sa,
        volumeClaimTemplates: arr(spec.volumeClaimTemplates).length,
        serviceName: str(spec.serviceName),
      };
    case 'CronJob':
    case 'Job':
      return {
        containers,
        initContainers,
        suspend: typeof spec.suspend === 'boolean' ? spec.suspend : null,
        serviceAccountName: sa,
      };
    case 'Service': {
      const sel = isObj(spec.selector) ? Object.keys(spec.selector).length : 0;
      return {
        type: str(spec.type) ?? 'ClusterIP',
        ports: arr(spec.ports).length,
        selector: sel ? 'present' : 'absent',
        headless: spec.clusterIP === 'None',
        loadBalancerClass: str(spec.loadBalancerClass),
      };
    }
    case 'Ingress': {
      let paths = 0;
      for (const r of arr(spec.rules))
        if (isObj(r) && isObj(r.http)) paths += arr(r.http.paths).length;
      return {
        ingressClassName: str(spec.ingressClassName),
        rules: arr(spec.rules).length,
        paths,
        tlsSecrets: arr(spec.tls).length,
        defaultBackend: isObj(spec.defaultBackend),
      };
    }
    case 'PersistentVolumeClaim': {
      const req =
        isObj(spec.resources) && isObj(spec.resources.requests)
          ? spec.resources.requests.storage
          : null;
      return {
        storageClassName: str(spec.storageClassName),
        storage:
          typeof req === 'string' || typeof req === 'number'
            ? String(req)
            : null,
        accessModes: arr(spec.accessModes).filter(
          (v): v is string => typeof v === 'string',
        ),
        volumeMode: str(spec.volumeMode),
      };
    }
    case 'ConfigMap':
      return {
        keys: isObj(obj.data) ? Object.keys(obj.data).length : 0,
        binaryKeys: isObj(obj.binaryData)
          ? Object.keys(obj.binaryData).length
          : 0,
      };
    case 'Secret':
      return {
        referencedKeys:
          (isObj(obj.data) ? Object.keys(obj.data).length : 0) +
          (isObj(obj.stringData) ? Object.keys(obj.stringData).length : 0),
      };
    case 'HorizontalPodAutoscaler': {
      const ref = isObj(spec.scaleTargetRef) ? spec.scaleTargetRef : null;
      return {
        minReplicas: numOrNull(spec.minReplicas),
        maxReplicas: numOrNull(spec.maxReplicas),
        targetKind: ref ? str(ref.kind) : null,
        targetName: ref ? str(ref.name) : null,
      };
    }
    case 'PodDisruptionBudget': {
      const v = (x: unknown) =>
        typeof x === 'string' || typeof x === 'number' ? x : null;
      const sel = isObj(spec.selector)
        ? Object.keys(
            isObj(spec.selector.matchLabels) ? spec.selector.matchLabels : {},
          ).length
        : 0;
      return {
        minAvailable: v(spec.minAvailable),
        maxUnavailable: v(spec.maxUnavailable),
        selector: sel ? 'present' : 'absent',
      };
    }
    case 'NetworkPolicy': {
      const sel = isObj(spec.podSelector)
        ? Object.keys(spec.podSelector).length
        : 0;
      return {
        policyTypes: arr(spec.policyTypes).filter(
          (v): v is string => typeof v === 'string',
        ),
        scope: sel ? 'selected' : 'namespace',
      };
    }
    case 'ServiceAccount':
      return {
        imagePullSecrets: arr(obj.imagePullSecrets).length,
        automountServiceAccountToken:
          typeof obj.automountServiceAccountToken === 'boolean'
            ? obj.automountServiceAccountToken
            : null,
      };
    case 'Role':
    case 'ClusterRole':
      return { rules: arr(obj.rules).length };
    case 'RoleBinding':
    case 'ClusterRoleBinding': {
      const ref = isObj(obj.roleRef) ? obj.roleRef : null;
      return {
        roleRefKind: ref ? str(ref.kind) : null,
        roleRefName: ref ? str(ref.name) : null,
        subjects: arr(obj.subjects).length,
      };
    }
    case 'ResourceQuota':
      return { entries: isObj(spec.hard) ? Object.keys(spec.hard).length : 0 };
    case 'LimitRange':
      return { entries: arr(spec.limits).length };
    default:
      return {};
  }
}

interface Ctx {
  plateIndex: Map<string, number>;
  kindRank: (kindDir: string | null, kind: string | null) => number;
}

export function makeBlockComparator(
  plates: Plate[],
  kindRank: (kindDir: string | null, kind: string | null) => number,
): (a: Block, b: Block) => number {
  const plateIndex = new Map(plates.map((p, i) => [p.id, i]));
  const layerIndex = new Map(LAYER_ORDER.map((l, i) => [l, i]));
  const ctx: Ctx = { plateIndex, kindRank };
  return (a, b) => {
    const pa = ctx.plateIndex.get(a.plateId) ?? 9999;
    const pb = ctx.plateIndex.get(b.plateId) ?? 9999;
    if (pa !== pb) return pa - pb;
    const la = layerIndex.get(a.layer) ?? 9;
    const lb = layerIndex.get(b.layer) ?? 9;
    if (la !== lb) return la - lb;
    const ga = a.blockType === 'ghost' ? 1 : 0;
    const gb = b.blockType === 'ghost' ? 1 : 0;
    if (ga !== gb) return ga - gb;
    const ka = ctx.kindRank(a.kindDir, a.kind);
    const kb = ctx.kindRank(b.kindDir, b.kind);
    if (ka !== kb) return ka - kb;
    const na = a.name ?? '';
    const nb = b.name ?? '';
    if (na !== nb) return na < nb ? -1 : 1;
    const da = a.file?.documentIndex ?? 0;
    const db = b.file?.documentIndex ?? 0;
    if (da !== db) return da - db;
    const fa = a.file?.path ?? a.id;
    const fb = b.file?.path ?? b.id;
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  };
}

export function buildBaseGraph(a: K8sAnalysis, opts: BuildOptions): BaseGraph {
  const { rules } = opts;
  const builtAt = new Date().toISOString();
  const version = graphVersion(a, opts.enabledRules);

  const kindRankOf = (kindDir: string | null, kind: string | null): number => {
    if (kindDir) {
      const i = rules.KIND_CATALOG.findIndex((k) => k.id === kindDir);
      if (i >= 0) return i;
    }
    if (kind) {
      const i = rules.KIND_CATALOG.findIndex((k) => k.kind === kind);
      if (i >= 0) return i;
    }
    return 1000;
  };
  const kindDirOf = (apiGroup: string, kind: string): string | null =>
    rules.kindByGroupKind(apiGroup, kind)?.id ?? null;

  const meta = a.metaRaw;
  const scopeNs =
    meta && isObj(meta.scope) && isObj(meta.scope.namespaces)
      ? meta.scope.namespaces
      : null;
  const systemNs = new Set(
    Array.isArray(scopeNs?.system) ? scopeNs.system.map(String) : [],
  );

  const objOfDoc = new Map<string, Obj>();
  for (const d of a.docs) objOfDoc.set(`${d.path}\u0000${d.index}`, d.obj);

  // 중복 식별값 (파일마다 블록을 따로 두되 id 가 겹치지 않게)
  const keyCount = new Map<string, number>();
  for (const f of a.files)
    if (f.fileType === 'resource' || f.fileType === 'namespace')
      for (const d of f.documents) {
        const k = `${d.apiGroup || 'core'}/${d.kind}/${d.namespace ?? '_cluster'}/${d.name}`;
        keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
      }

  const markersOfFile = (f: K8sFileFact, notes: Note[]): Markers => {
    const finds = a.fileFindings.get(f.path) ?? [];
    const errors = finds.filter((x) => x.severity === 'error').length;
    const warnings = finds.length - errors;
    return {
      scan: {
        errors,
        warnings,
        level: errors ? 'error' : warnings ? 'warn' : null,
        count: errors || warnings,
        firstLine: finds.length
          ? Math.min(...finds.map((x) => x.line || 1))
          : null,
      },
      drift: null,
      fileIssue: fileIssueOf(notes),
      helm: f.helmManaged,
    };
  };

  // ---------------- 판
  const nsNames = new Set<string>();
  for (const f of a.files)
    if (
      (f.fileType === 'resource' || f.fileType === 'namespace') &&
      f.namespaceDir
    )
      nsNames.add(f.namespaceDir);

  const plates: Plate[] = [];
  const plateOfNamespace: Record<string, string> = {};
  const nsFileOf = new Map<string, K8sFileFact>();
  for (const f of a.files)
    if (f.fileType === 'namespace' && f.namespaceDir)
      nsFileOf.set(f.namespaceDir, f);

  let namespaceDocuments = 0;
  for (const ns of [...nsNames].sort()) {
    const f = nsFileOf.get(ns);
    const hasDoc = !!f && f.documents.length > 0;
    const notes: Note[] = [];
    if (!hasDoc) notes.push(noteOf('namespace_file_missing'));
    else {
      if (!f.pathMatches) notes.push(noteOf('path_mismatch'));
      if (f.runtimeFields.length)
        notes.push(noteOf('runtime_fields', f.runtimeFields.length));
    }
    if (hasDoc) namespaceDocuments += f.documents.length;
    const id = `ns:${ns}`;
    plateOfNamespace[ns] = id;
    plates.push({
      id,
      kind: 'namespace',
      name: ns,
      system: systemNs.has(ns),
      file: hasDoc ? f.path : null,
      fileLine: hasDoc ? (f.docLines[0] ?? 1) : null,
      resourceCount: 0,
      ghostCount: 0,
      byLayer: {},
      markers: hasDoc ? markersOfFile(f, notes) : emptyMarkers(),
      notes,
      navigate: hasDoc
        ? {
            primary: 'files',
            file: f.path,
            line: f.docLines[0] ?? 1,
            resourceKey: f.resourceKey,
            secretName: null,
          }
        : {
            primary: null,
            file: null,
            line: null,
            resourceKey: null,
            secretName: null,
          },
    });
  }

  const hasClusterScoped = a.files.some(
    (f) => f.fileType === 'resource' && f.namespaceDir === null,
  );
  if (hasClusterScoped)
    plates.push({
      id: '_cluster',
      kind: 'cluster',
      name: null,
      system: false,
      file: null,
      fileLine: null,
      resourceCount: 0,
      ghostCount: 0,
      byLayer: {},
      markers: emptyMarkers(),
      notes: [],
      navigate: {
        primary: null,
        file: null,
        line: null,
        resourceKey: null,
        secretName: null,
      },
    });

  // ---------------- 블록
  const blocks: Block[] = [];
  const relationDocs: RelationDoc[] = [];
  let documents = 0;
  let unparsedNeeded = false;

  for (const f of a.files) {
    if (f.fileType !== 'resource' && f.fileType !== 'namespace') continue;
    documents += Math.max(1, f.documents.length);
    if (f.fileType === 'namespace' && f.documents.length > 0) continue; // 판으로 그린다
    if (f.documents.length === 0) {
      // 해석 실패 (판이 아니라 "해석 실패" 구역)
      unparsedNeeded = true;
      const notes: Note[] = [
        {
          code: 'parse_failed',
          text: PARSE_TEXT[f.parse] ?? '해석 실패',
        },
      ];
      blocks.push({
        id: `file:${f.path}`,
        blockType: 'unparsed',
        plateId: '_unparsed',
        layer: 'aux',
        kind: f.expected?.kind ?? null,
        apiGroup: f.expected?.apiGroup ?? null,
        apiVersion: null,
        namespace: f.namespaceDir,
        name: f.expected?.name ?? null,
        resourceKey: null,
        kindDir: f.kindDir,
        custom: false,
        file: {
          path: f.path,
          line: 1,
          documentIndex: 0,
          documentCount: 0,
        },
        summary: {},
        ghost: null,
        markers: markersOfFile(f, notes),
        notes,
        system: !!f.namespaceDir && systemNs.has(f.namespaceDir),
        degree: { in: 0, out: 0 },
        navigate: {
          primary: 'files',
          file: f.path,
          line: 1,
          resourceKey: null,
          secretName: null,
        },
      });
      continue;
    }
    f.documents.forEach((id, i) => {
      const key = `${id.apiGroup || 'core'}/${id.kind}/${id.namespace ?? '_cluster'}/${id.name}`;
      const dup = (keyCount.get(key) ?? 0) > 1;
      let blockId = key;
      if (dup) blockId = `${key}#dup:${f.path}`;
      if (f.documents.length > 1) blockId = `${blockId}#${i}`;
      const notes: Note[] = [];
      if (!f.pathMatches && i === 0) notes.push(noteOf('path_mismatch'));
      if (dup) notes.push(noteOf('duplicate', (f.duplicateOf.length || 0) + 1));
      if (f.documents.length > 1)
        notes.push({
          code: 'multi_document',
          text: `한 파일에 여러 리소스 (${f.documents.length}개)`,
          count: f.documents.length,
        });
      if (f.runtimeFields.length)
        notes.push(noteOf('runtime_fields', f.runtimeFields.length));
      const kindDir = f.kindDir ?? kindDirOf(id.apiGroup, id.kind);
      const custom = !rules.kindByGroupKind(id.apiGroup, id.kind);
      if (custom) notes.push(noteOf('custom_resource'));
      const obj = objOfDoc.get(`${f.path}\u0000${i}`);
      const line = f.docLines[i] ?? 1;
      const markers = markersOfFile(f, notes);
      blocks.push({
        id: blockId,
        blockType: 'resource',
        plateId: id.namespace ? `ns:${id.namespace}` : '_cluster',
        layer: layerOfKind(id.kind),
        kind: id.kind,
        apiGroup: id.apiGroup,
        apiVersion: id.apiVersion,
        namespace: id.namespace,
        name: id.name,
        resourceKey: key,
        kindDir,
        custom,
        file: {
          path: f.path,
          line,
          documentIndex: i,
          documentCount: f.documents.length,
        },
        summary: obj ? summarizeResource(id.kind, obj) : {},
        ghost: null,
        markers,
        notes,
        system: !!id.namespace && systemNs.has(id.namespace),
        degree: { in: 0, out: 0 },
        navigate: {
          // 드리프트가 있으면 graph.service 가 'drift' 로 올린다(계약 4.1)
          primary: 'files',
          file: f.path,
          line: markers.scan.firstLine !== null ? markers.scan.firstLine : line,
          resourceKey: key,
          secretName: null,
        },
      });
      if (obj && !dup) relationDocs.push({ blockId, key, identity: id, obj });
    });
  }

  if (unparsedNeeded)
    plates.push({
      id: '_unparsed',
      kind: 'unparsed',
      name: null,
      system: false,
      file: null,
      fileLine: null,
      resourceCount: 0,
      ghostCount: 0,
      byLayer: {},
      markers: emptyMarkers(),
      notes: [],
      navigate: {
        primary: null,
        file: null,
        line: null,
        resourceKey: null,
        secretName: null,
      },
    });

  // ---------------- 관계
  const rel = extractRelations(relationDocs, opts.enabledRules);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const [blockId, notes] of rel.notes) {
    const b = byId.get(blockId);
    if (!b) continue;
    for (const n of notes) b.notes.push(n);
  }

  // 유령 블록
  const ghostBlocks: Block[] = [];
  for (const g of rel.ghosts) {
    const id = `ghost:${g.key}`;
    const plateId = g.namespace ? `ns:${g.namespace}` : '_cluster';
    ghostBlocks.push(ghostBlock(g, id, plateId, kindDirOf, systemNs));
  }
  // 유령이 가리키는 판이 없으면(클러스터 범위) 판을 만든다
  ensurePlates(plates, ghostBlocks, plateOfNamespace, systemNs);
  blocks.push(...ghostBlocks);

  // ---------------- 선
  const present = new Set(blocks.map((b) => b.id));
  let edges: Edge[] = rel.edges
    .filter((e) => present.has(e.from) && present.has(e.to))
    .map((e) => {
      const items = e.evidence.slice(0, 5).map((x) => ({
        code: x.code,
        text: x.container ? `${x.text} (컨테이너 ${x.container})` : x.text,
        container: x.container,
      }));
      const truncated = e.evidence.length > 5;
      const evidence =
        items.map((x) => x.text).join(' · ') +
        (truncated ? ` 외 ${e.evidence.length - 5}건` : '');
      return {
        id: `${e.rule}|${e.from}|${e.to}`,
        rule: e.rule,
        from: e.from,
        to: e.to,
        certainty: e.certainty,
        toGhost: e.toGhost,
        optional: e.evidence.every((x) => x.optional),
        evidence,
        evidenceItems: items,
        evidenceTruncated: truncated,
      };
    });
  edges.sort(
    (x, y) =>
      (x.rule < y.rule ? -1 : x.rule > y.rule ? 1 : 0) ||
      (x.from < y.from ? -1 : x.from > y.from ? 1 : 0) ||
      (x.to < y.to ? -1 : x.to > y.to ? 1 : 0),
  );

  // ---------------- 정렬·잘림
  const cmp = makeBlockComparator(plates, kindRankOf);
  blocks.sort(cmp);
  const truncated = {
    blocks: false,
    edges: false,
    droppedBlocks: 0,
    droppedEdges: 0,
    reason: null as string | null,
  };
  let finalBlocks = blocks;
  if (blocks.length > opts.maxBlocks) {
    truncated.blocks = true;
    truncated.droppedBlocks = blocks.length - opts.maxBlocks;
    truncated.reason = 'BLOCK_LIMIT';
    finalBlocks = blocks.slice(0, opts.maxBlocks);
    const keep = new Set(finalBlocks.map((b) => b.id));
    const before = edges.length;
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
    truncated.droppedEdges += before - edges.length;
  }
  if (edges.length > opts.maxEdges) {
    truncated.edges = true;
    truncated.droppedEdges += edges.length - opts.maxEdges;
    truncated.reason ??= 'EDGE_LIMIT';
    edges = edges.slice(0, opts.maxEdges);
  }

  // 차수
  const degree = new Map<string, { in: number; out: number }>();
  for (const e of edges) {
    const f = degree.get(e.from) ?? { in: 0, out: 0 };
    f.out++;
    degree.set(e.from, f);
    const t = degree.get(e.to) ?? { in: 0, out: 0 };
    t.in++;
    degree.set(e.to, t);
  }
  for (const b of finalBlocks) b.degree = degree.get(b.id) ?? { in: 0, out: 0 };

  // 판 집계·이동 기본값
  const plateById = new Map(plates.map((p) => [p.id, p]));
  for (const b of finalBlocks) {
    const p = plateById.get(b.plateId);
    if (!p) continue;
    if (b.blockType === 'ghost') p.ghostCount++;
    else p.resourceCount++;
    p.byLayer[b.layer] = (p.byLayer[b.layer] ?? 0) + 1;
    b.markers.fileIssue = fileIssueOf(b.notes);
  }

  const ghosts = finalBlocks.filter((b) => b.blockType === 'ghost').length;
  const resourceBlocks = finalBlocks.filter(
    (b) => b.blockType === 'resource',
  ).length;
  const unparsed = finalBlocks.filter((b) => b.blockType === 'unparsed').length;

  // ---------------- 리소스 밖 발견
  let outsideFindings = 0;
  for (const [path, list] of a.fileFindings) {
    const f = a.files.find((x) => x.path === path);
    if (f && (f.fileType === 'resource' || f.fileType === 'namespace'))
      continue;
    outsideFindings += list.length;
  }

  const state: BaseGraph['state'] = a.inProgress
    ? 'pending_export'
    : documents === 0
      ? 'empty'
      : 'ok';

  const notices: Note[] = [];
  if (state === 'ok') {
    notices.push({
      code: 'RELATIONS_PARTIAL',
      text: '선이 없다고 관계가 없는 것은 아닙니다. 이 보기는 규칙 11가지(K1~K11)로 찾은 관계만 그립니다',
    });
    if (finalBlocks.some((b) => b.ghost?.reason === 'secret'))
      notices.push({
        code: 'SECRET_VALUES_NOT_INCLUDED',
        text: 'Secret 은 이름만 표시합니다 (값은 스냅샷에 없습니다)',
      });
    const missingNs = plates.filter(
      (p) => p.kind === 'namespace' && p.file === null,
    );
    if (missingNs.length)
      notices.push({
        code: 'NAMESPACE_FILE_MISSING',
        text: `namespace.yaml 이 없는 네임스페이스 ${missingNs.length}개 (${missingNs
          .slice(0, 3)
          .map((p) => p.name)
          .join(', ')})`,
      });
    if (unparsed)
      notices.push({
        code: 'UNPARSED_FILES',
        text: `해석 실패 ${unparsed}개 — 관계를 뽑지 않았습니다`,
      });
    const customCount = finalBlocks.filter((b) => b.custom).length;
    if (customCount)
      notices.push({
        code: 'CUSTOM_RESOURCES_PRESENT',
        text: `사용자 지정 리소스 ${customCount}개 — 참조를 뽑지 않습니다`,
      });
    if (truncated.blocks || truncated.edges)
      notices.push({
        code: 'GRAPH_TRUNCATED',
        text: `리소스가 너무 많아 일부만 그립니다 (블록 ${truncated.droppedBlocks}개·선 ${truncated.droppedEdges}개 제외)`,
      });
  } else if (state === 'pending_export') {
    notices.push({
      code: 'EXPORT_MAYBE_IN_PROGRESS',
      text: '스냅샷 파일 확인 전 — 내보내기가 진행 중일 수 있습니다',
    });
  } else {
    notices.push({ code: 'NO_RESOURCES', text: '리소스 파일이 없습니다' });
  }

  const kindRank: Record<string, number> = {};
  for (const b of finalBlocks) {
    const k = b.kindDir ?? b.kind ?? '';
    if (!(k in kindRank)) kindRank[k] = kindRankOf(b.kindDir, b.kind);
  }

  const hidden = state !== 'ok';
  return {
    version,
    builtAt,
    state,
    plates: hidden ? [] : plates,
    blocks: hidden ? [] : finalBlocks,
    edges: hidden ? [] : edges,
    counts: {
      documents,
      namespaceDocuments: hidden ? 0 : namespaceDocuments,
      resourceBlocks: hidden ? 0 : resourceBlocks,
      unparsedBlocks: hidden ? 0 : unparsed,
      ghosts: hidden ? 0 : ghosts,
      outsideFindings,
    },
    truncated,
    notices,
    plateOfNamespace,
    kindRank,
  };
}

function ghostBlock(
  g: GhostSpec,
  id: string,
  plateId: string,
  kindDirOf: (apiGroup: string, kind: string) => string | null,
  systemNs: Set<string>,
): Block {
  const summary =
    g.kind === 'Secret' ? { referencedKeys: g.referencedKeys } : {};
  return {
    id,
    blockType: 'ghost',
    plateId,
    layer: layerOfKind(g.kind),
    kind: g.kind,
    apiGroup: g.apiGroup,
    apiVersion: null,
    namespace: g.namespace,
    name: g.name,
    resourceKey: g.kind === 'Secret' ? null : g.key,
    kindDir: kindDirOf(g.apiGroup, g.kind),
    custom: false,
    file: null,
    summary,
    ghost: { reason: g.reason, text: GHOST_TEXT[g.reason] },
    markers: emptyMarkers(),
    notes: [],
    system: !!g.namespace && systemNs.has(g.namespace),
    degree: { in: 0, out: 0 },
    ghostFromRules: g.fromRules,
    navigate:
      g.kind === 'Secret'
        ? {
            primary: 'secrets',
            file: null,
            line: null,
            resourceKey: null,
            secretName: g.name,
          }
        : {
            primary: null,
            file: null,
            line: null,
            resourceKey: null,
            secretName: null,
          },
  };
}

/** 유령이 가리키는 판이 없으면(스냅샷에 없던 네임스페이스) 유령 판을 만든다 */
export function ensurePlates(
  plates: Plate[],
  blocks: Block[],
  plateOfNamespace: Record<string, string>,
  systemNs: Set<string>,
): void {
  const ids = new Set(plates.map((p) => p.id));
  const added: Plate[] = [];
  for (const b of blocks) {
    if (ids.has(b.plateId)) continue;
    ids.add(b.plateId);
    if (b.plateId === '_cluster') {
      added.push(basePlate('_cluster', 'cluster', null, false));
      continue;
    }
    const ns = b.namespace ?? b.plateId.replace(/^ns:/, '');
    const id = `ghost-ns:${ns}`;
    b.plateId = id;
    if (!ids.has(id)) {
      ids.add(id);
      added.push(basePlate(id, 'ghost', ns, systemNs.has(ns)));
    }
    plateOfNamespace[ns] ??= id;
  }
  // 순서: 네임스페이스 → _cluster → _unparsed → 유령 판
  plates.push(...added);
  plates.sort((a, b) => {
    const r = plateRank(a) - plateRank(b);
    if (r) return r;
    return (a.name ?? '') < (b.name ?? '')
      ? -1
      : (a.name ?? '') > (b.name ?? '')
        ? 1
        : 0;
  });
}

function plateRank(p: Plate): number {
  return p.kind === 'namespace'
    ? 0
    : p.kind === 'cluster'
      ? 1
      : p.kind === 'unparsed'
        ? 2
        : 3;
}

export function basePlate(
  id: string,
  kind: Plate['kind'],
  name: string | null,
  system: boolean,
): Plate {
  return {
    id,
    kind,
    name,
    system,
    file: null,
    fileLine: null,
    resourceCount: 0,
    ghostCount: 0,
    byLayer: {},
    markers: emptyMarkers(),
    notes: [],
    navigate: {
      primary: null,
      file: null,
      line: null,
      resourceKey: null,
      secretName: null,
    },
  };
}

export function buildGroups(blocks: Block[]): GraphGroup[] {
  const map = new Map<string, GraphGroup>();
  for (const b of blocks) {
    const key = `${b.plateId}\u0000${b.layer}\u0000${b.kind ?? ''}`;
    let g = map.get(key);
    if (!g) {
      g = {
        plateId: b.plateId,
        layer: b.layer,
        kind: b.kind,
        apiGroup: b.apiGroup,
        count: 0,
        ghostCount: 0,
        drift: {
          changed: 0,
          deleted: 0,
          added: 0,
          uncomparable: 0,
          skipped: 0,
        },
        scan: { errors: 0, warnings: 0 },
      };
      map.set(key, g);
    }
    g.count++;
    if (b.blockType === 'ghost') g.ghostCount++;
    const c = b.markers.drift?.change;
    if (c && c in g.drift)
      (g.drift as Record<string, number>)[c] =
        (g.drift as Record<string, number>)[c] + 1;
    g.scan.errors += b.markers.scan.errors;
    g.scan.warnings += b.markers.scan.warnings;
  }
  return [...map.values()];
}

export function buildFacets(
  plates: Plate[],
  blocks: Block[],
  edges: Edge[],
): GraphFacets {
  const nsCount = new Map<string, number>();
  const kindCount = new Map<
    string,
    { kind: string | null; apiGroup: string | null; count: number }
  >();
  const noteCount = new Map<string, number>();
  const drift = {
    changed: 0,
    deleted: 0,
    added: 0,
    same: 0,
    uncomparable: 0,
    skipped: 0,
    none: 0,
  };
  let errorBlocks = 0;
  let warningBlocks = 0;
  let ghosts = 0;
  for (const b of blocks) {
    nsCount.set(b.plateId, (nsCount.get(b.plateId) ?? 0) + 1);
    const kk = `${b.apiGroup ?? ''}/${b.kind ?? ''}`;
    const e = kindCount.get(kk) ?? {
      kind: b.kind,
      apiGroup: b.apiGroup,
      count: 0,
    };
    e.count++;
    kindCount.set(kk, e);
    const c = b.markers.drift?.change;
    if (c) drift[c]++;
    else drift.none++;
    if (b.markers.scan.errors) errorBlocks++;
    else if (b.markers.scan.warnings) warningBlocks++;
    if (b.blockType === 'ghost') ghosts++;
    for (const n of b.notes)
      noteCount.set(n.code, (noteCount.get(n.code) ?? 0) + 1);
  }
  const ruleCount = new Map<RuleId, number>();
  for (const e of edges)
    ruleCount.set(e.rule, (ruleCount.get(e.rule) ?? 0) + 1);
  return {
    namespaces: plates.map((p) => ({
      plateId: p.id,
      name: p.name,
      count: nsCount.get(p.id) ?? 0,
    })),
    kinds: [...kindCount.values()],
    rules: [...ruleCount.entries()].map(([id, count]) => ({ id, count })),
    drift,
    scan: { errorBlocks, warningBlocks },
    ghosts,
    notes: [...noteCount.entries()].map(([code, count]) => ({ code, count })),
  };
}

export const DEFAULT_ON = DEFAULT_ON_RULES;
