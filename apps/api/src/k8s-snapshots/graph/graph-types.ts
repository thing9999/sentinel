/**
 * 3D 구성 그래프 타입 (docs/api/snapshot-3d.md 3~10절).
 * 화면 개념 이름을 쓴다: 판 plates / 블록 blocks / 선 edges.
 * 좌표는 주지 않는다. 서버가 주는 것은 소속과 순서다(4.3).
 */

export type Layer = 'storage' | 'workload' | 'service' | 'ingress' | 'aux';
export type BlockType = 'resource' | 'ghost' | 'unparsed';
export type PlateKind = 'namespace' | 'cluster' | 'unparsed' | 'ghost';
export type RuleId =
  'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | 'K7' | 'K8' | 'K9' | 'K10' | 'K11';
export type Certainty = 'confirmed' | 'estimated';
export type GhostReason =
  | 'not_in_snapshot'
  | 'secret'
  | 'autocreated'
  | 'cluster_scope'
  | 'drift_added';
export type DriftChange =
  'same' | 'changed' | 'deleted' | 'added' | 'uncomparable' | 'skipped';

export interface Note {
  code: string;
  text: string;
  count?: number;
}

export interface BlockDrift {
  change: DriftChange;
  fieldCount: number;
  hidden: { default: number; managed: number };
  reasonCode: string | null;
  reasonText: string | null;
}

export interface Markers {
  scan: {
    errors: number;
    warnings: number;
    /** 표식 등급 (errors>0 이면 error, 경고만이면 warn, 없으면 null) */
    level: 'error' | 'warn' | null;
    /** 그 등급의 건수 (표식 문구 "오류 1") */
    count: number;
    /** 첫 발견 줄 (navigate.line) */
    firstLine: number | null;
  };
  drift: BlockDrift | null;
  fileIssue: { code: string; text: string } | null;
  helm: boolean;
}

export interface Navigate {
  primary: 'files' | 'drift' | 'secrets' | null;
  file: string | null;
  line: number | null;
  resourceKey: string | null;
  secretName: string | null;
}

export interface Plate {
  id: string;
  kind: PlateKind;
  name: string | null;
  system: boolean;
  file: string | null;
  fileLine: number | null;
  resourceCount: number;
  ghostCount: number;
  byLayer: Record<string, number>;
  markers: Markers;
  notes: Note[];
  navigate: Navigate;
}

export interface Block {
  id: string;
  blockType: BlockType;
  plateId: string;
  layer: Layer;
  kind: string | null;
  apiGroup: string | null;
  apiVersion: string | null;
  namespace: string | null;
  name: string | null;
  resourceKey: string | null;
  kindDir: string | null;
  custom: boolean;
  file: {
    path: string;
    line: number;
    documentIndex: number;
    documentCount: number;
  } | null;
  summary: Record<string, unknown>;
  ghost: { reason: GhostReason; text: string } | null;
  markers: Markers;
  notes: Note[];
  system: boolean;
  degree: { in: number; out: number };
  ghostFromRules?: RuleId[];
  navigate: Navigate;
}

export interface Edge {
  id: string;
  rule: RuleId;
  from: string;
  to: string;
  certainty: Certainty;
  toGhost: boolean;
  optional: boolean;
  evidence: string;
  evidenceItems: { code: string; text: string; container: string | null }[];
  evidenceTruncated: boolean;
}

export interface GraphGroup {
  plateId: string;
  layer: Layer;
  kind: string | null;
  apiGroup: string | null;
  count: number;
  ghostCount: number;
  drift: {
    changed: number;
    deleted: number;
    added: number;
    uncomparable: number;
    skipped: number;
  };
  scan: { errors: number; warnings: number };
}

export interface GraphSummary {
  plates: number;
  documents: number;
  namespaceDocuments: number;
  resourceBlocks: number;
  ghosts: number;
  unparsedBlocks: number;
  blocks: number;
  edges: number;
  edgesDefaultOn: number;
  driftMarkers: number;
  scanMarkers: number;
  outsideFindings: number;
  grouped: boolean;
  groupThreshold: number;
  truncated: {
    blocks: boolean;
    edges: boolean;
    droppedBlocks: number;
    droppedEdges: number;
    reason: string | null;
  };
}

export interface GraphFacets {
  namespaces: { plateId: string; name: string | null; count: number }[];
  kinds: { kind: string | null; apiGroup: string | null; count: number }[];
  rules: { id: RuleId; count: number }[];
  drift: {
    changed: number;
    deleted: number;
    added: number;
    same: number;
    uncomparable: number;
    skipped: number;
    none: number;
  };
  scan: { errorBlocks: number; warningBlocks: number };
  ghosts: number;
  notes: { code: string; count: number }[];
}

/** 캐시에 담는 부분 (드리프트·스캔 표식을 얹기 전) */
export interface BaseGraph {
  version: string;
  builtAt: string;
  state: 'ok' | 'pending_export' | 'empty';
  plates: Plate[];
  blocks: Block[];
  edges: Edge[];
  summary: GraphSummary;
  notices: Note[];
  /** 드리프트 "추가됨" 유령 블록을 붙일 때 쓰는 판 정보 */
  namespaceOfPlate: Record<string, string>;
}

export const LAYERS: { id: Layer; label: string; kinds: string[] }[] = [
  {
    id: 'storage',
    label: '저장·설정',
    kinds: ['PersistentVolumeClaim', 'ConfigMap', 'Secret'],
  },
  {
    id: 'workload',
    label: '워크로드',
    kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job'],
  },
  { id: 'service', label: '서비스', kinds: ['Service'] },
  { id: 'ingress', label: '진입', kinds: ['Ingress'] },
  {
    id: 'aux',
    label: '곁',
    kinds: [
      'HorizontalPodAutoscaler',
      'PodDisruptionBudget',
      'NetworkPolicy',
      'ServiceAccount',
      'Role',
      'RoleBinding',
      'ResourceQuota',
      'LimitRange',
      '*',
    ],
  },
];

const LAYER_OF = new Map<string, Layer>();
for (const l of LAYERS)
  for (const k of l.kinds) if (k !== '*') LAYER_OF.set(k, l.id);

export function layerOfKind(kind: string | null): Layer {
  return (kind && LAYER_OF.get(kind)) || 'aux';
}

export const LAYER_ORDER: Layer[] = [
  'storage',
  'workload',
  'service',
  'ingress',
  'aux',
];

export interface RuleDef {
  id: RuleId;
  label: string;
  evidenceDefault: string;
  certainty: Certainty;
  defaultOn: boolean;
}

export const RULES: readonly RuleDef[] = Object.freeze([
  {
    id: 'K1',
    label: 'Ingress → Service',
    evidenceDefault: 'backend.service.name',
    certainty: 'confirmed',
    defaultOn: true,
  },
  {
    id: 'K2',
    label: 'Service → 워크로드',
    evidenceDefault: '셀렉터',
    certainty: 'estimated',
    defaultOn: true,
  },
  {
    id: 'K3',
    label: '워크로드 → PVC',
    evidenceDefault: 'volumes.persistentVolumeClaim',
    certainty: 'confirmed',
    defaultOn: true,
  },
  {
    id: 'K4',
    label: 'StatefulSet → PVC',
    evidenceDefault: 'volumeClaimTemplates 이름 규칙',
    certainty: 'estimated',
    defaultOn: true,
  },
  {
    id: 'K5',
    label: '워크로드 → ConfigMap',
    evidenceDefault: 'envFrom / env / volumes',
    certainty: 'confirmed',
    defaultOn: true,
  },
  {
    id: 'K6',
    label: '워크로드·Ingress → Secret',
    evidenceDefault: 'secretKeyRef / volumes / imagePullSecrets / tls',
    certainty: 'confirmed',
    defaultOn: true,
  },
  {
    id: 'K7',
    label: 'HPA → 워크로드',
    evidenceDefault: 'scaleTargetRef',
    certainty: 'confirmed',
    defaultOn: true,
  },
  {
    id: 'K8',
    label: 'PDB → 워크로드',
    evidenceDefault: '셀렉터',
    certainty: 'estimated',
    defaultOn: false,
  },
  {
    id: 'K9',
    label: '워크로드 → ServiceAccount',
    evidenceDefault: 'serviceAccountName',
    certainty: 'confirmed',
    defaultOn: false,
  },
  {
    id: 'K10',
    label: 'NetworkPolicy → 워크로드',
    evidenceDefault: 'podSelector',
    certainty: 'estimated',
    defaultOn: false,
  },
  {
    id: 'K11',
    label: 'RoleBinding → Role·ServiceAccount',
    evidenceDefault: 'roleRef / subjects',
    certainty: 'confirmed',
    defaultOn: false,
  },
]);

export const RULE_IDS: RuleId[] = RULES.map((r) => r.id);
export const DEFAULT_ON_RULES = new Set<RuleId>(
  RULES.filter((r) => r.defaultOn).map((r) => r.id),
);

export const GHOST_TEXT: Record<GhostReason, string> = {
  not_in_snapshot: '스냅샷에 없음',
  secret: 'Secret — 이름만, 값 없음',
  autocreated: '자동 생성 또는 스냅샷에 없음',
  cluster_scope: '클러스터 범위, 스냅샷에 없을 수 있음',
  drift_added: '추가됨 (클러스터에만 있음)',
};

export const NOTE_TEXT: Record<string, string> = {
  selector_missing: '셀렉터 없음(수동 Endpoints·ExternalName)',
  no_target: '대상 없음',
  path_mismatch: '경로 불일치',
  duplicate: '중복 정의',
  runtime_fields: '런타임 필드 남음',
  custom_resource: '사용자 지정 리소스 — 참조를 뽑지 않음',
  namespace_file_missing: 'namespace.yaml 없음',
};

/** markers.fileIssue 로 올라가는 note 코드 (앞이 우선) */
export const FILE_ISSUE_CODES = [
  'parse_failed',
  'path_mismatch',
  'duplicate',
  'multi_document',
  'runtime_fields',
];
