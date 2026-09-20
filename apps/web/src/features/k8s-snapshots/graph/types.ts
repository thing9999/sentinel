/**
 * docs/api/snapshot-3d.md (1단계) 계약 타입. 계약에 없는 필드는 두지 않는다.
 * 좌표는 오지 않는다 — `blocks[]` 배열 순서가 곧 배치 순서다(계약 4.3).
 */
import type { DataSource, IsoTime, StatusInfo } from "../../common/types";
import type { DriftAbility, DriftBadge, K8sSnapshotCluster, ScanSummary } from "../types";

export type GraphState = "ok" | "pending_export" | "empty";
export type VizLayerId = "storage" | "workload" | "service" | "ingress" | "aux";
export type BlockType = "resource" | "ghost" | "unparsed";
export type PlateKindId = "namespace" | "cluster" | "unparsed" | "ghost";
export type GraphCertainty = "confirmed" | "estimated";
export type GhostReasonId = "not_in_snapshot" | "secret" | "autocreated" | "cluster_scope" | "drift_added";
export type DriftChange = "same" | "changed" | "deleted" | "added" | "uncomparable" | "skipped";
export type RuleId = "K1" | "K2" | "K3" | "K4" | "K5" | "K6" | "K7" | "K8" | "K9" | "K10" | "K11";
export type NavigateTab = "files" | "drift" | "secrets";

export interface GraphNote {
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

export interface GraphMarkers {
  scan: {
    errors: number;
    warnings: number;
    level: "error" | "warn" | null;
    count: number;
    firstLine: number | null;
  };
  drift: BlockDrift | null;
  fileIssue: { code: string; text: string } | null;
  helm: boolean;
}

export interface GraphNavigate {
  primary: NavigateTab | null;
  file: string | null;
  line: number | null;
  resourceKey: string | null;
  secretName: string | null;
}

export interface GraphPlate {
  id: string;
  kind: PlateKindId;
  name: string | null;
  system: boolean;
  file: string | null;
  fileLine: number | null;
  resourceCount: number;
  ghostCount: number;
  byLayer: Partial<Record<VizLayerId, number>>;
  markers: GraphMarkers;
  notes: GraphNote[];
  navigate: GraphNavigate;
}

export interface GraphBlock {
  id: string;
  blockType: BlockType;
  plateId: string;
  layer: VizLayerId;
  kind: string | null;
  apiGroup: string | null;
  apiVersion: string | null;
  namespace: string | null;
  name: string | null;
  resourceKey: string | null;
  kindDir: string | null;
  custom: boolean;
  file: { path: string; line: number; documentIndex: number; documentCount: number } | null;
  summary: Record<string, unknown>;
  ghost: { reason: GhostReasonId; text: string } | null;
  markers: GraphMarkers;
  notes: GraphNote[];
  system: boolean;
  degree: { in: number; out: number };
  ghostFromRules?: string[];
  navigate: GraphNavigate;
}

export interface GraphEdge {
  id: string;
  rule: RuleId;
  from: string;
  to: string;
  certainty: GraphCertainty;
  toGhost: boolean;
  optional: boolean;
  evidence: string;
  evidenceItems: { code: string; text: string; container: string | null }[];
  evidenceTruncated: boolean;
}

export interface GraphLayerDef {
  id: VizLayerId;
  label: string;
  kinds: string[];
}

export interface GraphRuleDef {
  id: RuleId;
  label: string;
  evidenceDefault: string;
  certainty: GraphCertainty;
  defaultOn: boolean;
  count: number | null;
  excluded: boolean;
}

export interface GraphGroup {
  plateId: string;
  layer: VizLayerId;
  kind: string;
  apiGroup: string | null;
  count: number;
  ghostCount: number;
  drift: { changed: number; deleted: number; added: number; uncomparable: number; skipped: number };
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
  truncated: { blocks: boolean; edges: boolean; droppedBlocks: number; droppedEdges: number; reason: string | null };
}

export interface GraphFacets {
  namespaces: { plateId: string; name: string | null; count: number }[];
  kinds: { kind: string; apiGroup: string | null; count: number }[];
  rules: { id: RuleId; count: number }[];
  drift: { changed: number; deleted: number; added: number; same: number; uncomparable: number; skipped: number; none: number };
  scan: { errorBlocks: number; warningBlocks: number };
  ghosts: number;
  notes: { code: string; count: number }[];
}

export interface GraphDrift {
  requested: boolean;
  usable: boolean;
  reasonCode: string | null;
  reasonText: string | null;
  badge: DriftBadge;
  computedAt: IsoTime | null;
  addedCheck: "checked" | "skipped_scope_unknown" | null;
  stale: boolean;
  actions: { computeDrift: DriftAbility };
}

export interface GraphData {
  state: GraphState;
  version: string;
  builtAt: IsoTime;
  rulesVersion: number | null;
  snapshotStatus: StatusInfo;
  cluster: K8sSnapshotCluster | null;
  summary: GraphSummary;
  layers: GraphLayerDef[];
  rules: GraphRuleDef[];
  plates: GraphPlate[];
  blocks: GraphBlock[];
  edges: GraphEdge[];
  groups: GraphGroup[];
  facets: GraphFacets;
  drift: GraphDrift;
  scan: { summary: ScanSummary; outsideResources: { errors: number; warnings: number; files: string[] } };
  notices: { code: string; text: string }[];
}

export interface GraphResponse {
  dataSource: DataSource;
  generatedAt: IsoTime;
  revision: number;
  snapshotId: string;
  graph: GraphData;
}
