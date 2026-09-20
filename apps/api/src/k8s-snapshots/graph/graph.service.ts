/**
 * 3D 구성 그래프 캐시와 겹쳐 보기 (docs/api/snapshot-3d.md 7·10절).
 * - 그래프는 파일 구성 지문(graph.version)으로 LRU 캐시한다. 파일이 안 바뀌면 다시 만들지 않는다
 * - 드리프트·스캔 표식은 **응답을 만들 때** 얹는다 (캐시를 깨지 않고, 드리프트를 계산하지 않는다)
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import { DriftService } from '../drift/drift.service';
import type { K8sAnalysis } from '../k8s-analyzer';
import type { K8sRules } from '../k8s-libs';
import {
  basePlate,
  buildBaseGraph,
  buildFacets,
  buildGroups,
  makeBlockComparator,
  type BaseGraph,
} from './graph-builder';
import {
  LAYERS,
  RULES,
  type Block,
  type BlockDrift,
  type GraphSummary,
  type Note,
  type Plate,
  type RuleId,
} from './graph-types';

const SKIP_TEXT: Record<string, string> = {
  yaml_error: '비교 못 함 (해석 실패)',
  duplicate: '비교 못 함 (중복 정의)',
  namespace_missing: '비교 못 함 (네임스페이스 없음)',
  too_large: '비교 못 함 (크기 초과)',
};
const SKIP_CODE: Record<string, string> = {
  yaml_error: 'YAML_ERROR',
  duplicate: 'DUPLICATE',
  namespace_missing: 'NAMESPACE_MISSING',
  too_large: 'TOO_LARGE',
};

interface CacheEntry {
  key: string;
  base: BaseGraph;
}

@Injectable()
export class K8sGraphService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheSize: number;
  readonly groupThreshold: number;
  private readonly maxBlocks: number;
  private readonly maxEdges: number;

  constructor(
    private readonly drift: DriftService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.cacheSize = config.get('K8S_GRAPH_CACHE_SIZE', { infer: true });
    this.groupThreshold = config.get('K8S_GRAPH_GROUP_THRESHOLD', {
      infer: true,
    });
    this.maxBlocks = config.get('K8S_GRAPH_MAX_BLOCKS', { infer: true });
    this.maxEdges = config.get('K8S_GRAPH_MAX_EDGES', { infer: true });
  }

  clear(): void {
    this.cache.clear();
  }

  private base(
    a: K8sAnalysis,
    rules: K8sRules,
    enabled: ReadonlySet<RuleId> | undefined,
  ): BaseGraph {
    const rulesKey = enabled ? [...enabled].sort().join(',') : 'all';
    const key = `${a.id}\u0000${rulesKey}`;
    const version = a.files
      .map((f) => `${f.path}:${f.version ?? '-'}`)
      .join('|');
    const hit = this.cache.get(key);
    if (hit && hit.key === version) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.base;
    }
    const base = buildBaseGraph(a, {
      rules,
      enabledRules: enabled,
      maxBlocks: this.maxBlocks,
      maxEdges: this.maxEdges,
    });
    this.cache.set(key, { key: version, base });
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return base;
  }

  /** 응답 본문의 graph (2.2) */
  build(
    a: K8sAnalysis,
    rules: K8sRules,
    opts: { rules?: ReadonlySet<RuleId>; drift: boolean },
  ) {
    const base = this.base(a, rules, opts.rules);
    const dv = this.drift.graphDrift(a);
    const usable = opts.drift && dv.usable;
    const driftBlock = {
      requested: opts.drift,
      usable,
      reasonCode: opts.drift ? dv.reasonCode : null,
      reasonText: opts.drift ? dv.reasonText : null,
      badge: dv.badge,
      computedAt: dv.computedAt,
      addedCheck: usable ? dv.addedCheck : null,
      stale: dv.stale,
      actions: dv.actions,
    };
    const notices: Note[] = [...base.notices];
    const scan = {
      summary: a.scan.summary,
      outsideResources: {
        errors: 0,
        warnings: 0,
        files: [] as string[],
      },
    };
    for (const [path, list] of a.fileFindings) {
      const f = a.files.find((x) => x.path === path);
      if (f && (f.fileType === 'resource' || f.fileType === 'namespace'))
        continue;
      scan.outsideResources.errors += list.filter(
        (x) => x.severity === 'error',
      ).length;
      scan.outsideResources.warnings += list.filter(
        (x) => x.severity === 'warn',
      ).length;
      if (!scan.outsideResources.files.includes(path))
        scan.outsideResources.files.push(path);
    }

    const rulesInfo = RULES.map((r) => ({
      id: r.id,
      label: r.label,
      evidenceDefault: r.evidenceDefault,
      certainty: r.certainty,
      defaultOn: r.defaultOn,
      count:
        opts.rules && !opts.rules.has(r.id)
          ? null
          : base.edges.filter((e) => e.rule === r.id).length,
      excluded: !!opts.rules && !opts.rules.has(r.id),
    }));

    if (base.state !== 'ok') {
      const summary: GraphSummary = {
        plates: 0,
        documents: base.counts.documents,
        namespaceDocuments: 0,
        resourceBlocks: 0,
        ghosts: 0,
        unparsedBlocks: 0,
        blocks: 0,
        edges: 0,
        edgesDefaultOn: 0,
        driftMarkers: 0,
        scanMarkers: 0,
        outsideFindings: base.counts.outsideFindings,
        grouped: false,
        groupThreshold: this.groupThreshold,
        truncated: base.truncated,
      };
      return {
        state: base.state,
        version: base.version,
        builtAt: base.builtAt,
        rulesVersion: a.cleanupVersion,
        snapshotStatus: null,
        cluster: null,
        summary,
        layers: LAYERS,
        rules: rulesInfo,
        plates: [],
        blocks: [],
        edges: [],
        groups: [],
        facets: buildFacets([], [], []),
        drift: driftBlock,
        scan,
        notices,
      };
    }

    // ---------------- 겹쳐 보기
    const skipByPath = new Map<string, string>();
    for (const u of a.unparsable)
      if (!skipByPath.has(u.path)) skipByPath.set(u.path, u.reason);

    const driftOf = (b: Block): BlockDrift | null => {
      if (!usable) return null;
      if (b.blockType === 'ghost') return null;
      const reason = b.file ? skipByPath.get(b.file.path) : undefined;
      const hit = b.resourceKey ? dv.byKey.get(b.resourceKey) : undefined;
      if (hit && !(reason && b.blockType === 'unparsed'))
        return {
          change: hit.change,
          fieldCount: hit.fieldCount,
          hidden: hit.hidden,
          reasonCode: hit.reasonCode,
          reasonText: hit.reasonText,
        };
      return {
        change: 'skipped',
        fieldCount: 0,
        hidden: { default: 0, managed: 0 },
        reasonCode: SKIP_CODE[reason ?? 'yaml_error'] ?? 'YAML_ERROR',
        reasonText: SKIP_TEXT[reason ?? 'yaml_error'] ?? '비교 못 함',
      };
    };

    const blocks: Block[] = base.blocks.map((b) => {
      const d = driftOf(b);
      const markers = { ...b.markers, drift: d };
      const navigate = { ...b.navigate };
      if (
        markers.scan.errors + markers.scan.warnings === 0 &&
        d &&
        (d.change === 'changed' || d.change === 'deleted') &&
        b.resourceKey
      )
        navigate.primary = 'drift';
      return { ...b, markers, navigate };
    });

    const plates: Plate[] = base.plates.map((p) => ({
      ...p,
      // 드리프트 "추가됨" 유령이 아래에서 더 붙으므로 판 집계는 여기서 비우고 다시 센다
      byLayer: {},
      markers: {
        ...p.markers,
        drift:
          usable && p.navigate.resourceKey
            ? (() => {
                const hit = dv.byKey.get(p.navigate.resourceKey);
                return hit
                  ? {
                      change: hit.change,
                      fieldCount: hit.fieldCount,
                      hidden: hit.hidden,
                      reasonCode: hit.reasonCode,
                      reasonText: hit.reasonText,
                    }
                  : null;
              })()
            : null,
      },
      resourceCount: 0,
      ghostCount: 0,
    }));
    const plateIds = new Set(plates.map((p) => p.id));

    // 드리프트 "추가됨" → 유령 블록 (+ 필요하면 유령 판)
    if (usable)
      for (const r of dv.added) {
        const nsPlate = r.namespace ? `ns:${r.namespace}` : '_cluster';
        let plateId = nsPlate;
        if (!plateIds.has(plateId)) {
          plateId = r.namespace ? `ghost-ns:${r.namespace}` : '_cluster';
          if (!plateIds.has(plateId)) {
            plates.push(
              basePlate(
                plateId,
                r.namespace ? 'ghost' : 'cluster',
                r.namespace,
                false,
              ),
            );
            plateIds.add(plateId);
          }
        }
        blocks.push({
          id: `ghost:${r.key}`,
          blockType: 'ghost',
          plateId,
          layer: layerOf(r.kind),
          kind: r.kind,
          apiGroup: r.apiGroup,
          apiVersion: r.apiVersion || null,
          namespace: r.namespace,
          name: r.name,
          resourceKey: r.key,
          kindDir: rules.kindByGroupKind(r.apiGroup, r.kind)?.id ?? null,
          custom: false,
          file: null,
          summary: { replicas: r.replicas, containers: r.containers },
          ghost: { reason: 'drift_added', text: '추가됨 (클러스터에만 있음)' },
          markers: {
            scan: {
              errors: 0,
              warnings: 0,
              level: null,
              count: 0,
              firstLine: null,
            },
            drift: {
              change: 'added',
              fieldCount: 0,
              hidden: { default: 0, managed: 0 },
              reasonCode: null,
              reasonText: null,
            },
            fileIssue: null,
            helm: false,
          },
          notes: [],
          system: false,
          degree: { in: 0, out: 0 },
          ghostFromRules: [],
          navigate: {
            primary: 'drift',
            file: null,
            line: null,
            resourceKey: r.key,
            secretName: null,
          },
        });
      }

    const kindRankOf = (kindDir: string | null, kind: string | null) => {
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
    plates.sort(
      (x, y) =>
        plateRank(x) - plateRank(y) ||
        ((x.name ?? '') < (y.name ?? '')
          ? -1
          : (x.name ?? '') > (y.name ?? '')
            ? 1
            : 0),
    );
    blocks.sort(makeBlockComparator(plates, kindRankOf));

    const plateById = new Map(plates.map((p) => [p.id, p]));
    for (const b of blocks) {
      const p = plateById.get(b.plateId);
      if (!p) continue;
      if (b.blockType === 'ghost') p.ghostCount++;
      else p.resourceCount++;
      p.byLayer[b.layer] = (p.byLayer[b.layer] ?? 0) + 1;
    }

    let driftMarkers = 0;
    let scanMarkers = 0;
    for (const b of blocks) {
      const c = b.markers.drift?.change;
      if (c === 'changed' || c === 'deleted' || c === 'added') driftMarkers++;
      if (b.markers.scan.errors + b.markers.scan.warnings > 0) scanMarkers++;
    }
    for (const p of plates) {
      const c = p.markers.drift?.change;
      if (c === 'changed' || c === 'deleted' || c === 'added') driftMarkers++;
      if (p.markers.scan.errors + p.markers.scan.warnings > 0) scanMarkers++;
    }

    const ghosts = blocks.filter((b) => b.blockType === 'ghost').length;
    const summary: GraphSummary = {
      plates: plates.length,
      documents: base.counts.documents,
      namespaceDocuments: base.counts.namespaceDocuments,
      resourceBlocks: base.counts.resourceBlocks,
      ghosts,
      unparsedBlocks: base.counts.unparsedBlocks,
      blocks: blocks.length,
      edges: base.edges.length,
      edgesDefaultOn: base.edges.filter((e) =>
        RULES.some((r) => r.id === e.rule && r.defaultOn),
      ).length,
      driftMarkers,
      scanMarkers,
      outsideFindings:
        scan.outsideResources.errors + scan.outsideResources.warnings,
      grouped: blocks.length > this.groupThreshold,
      groupThreshold: this.groupThreshold,
      truncated: base.truncated,
    };
    if (summary.grouped)
      notices.push({
        code: 'GROUPED_VIEW',
        text: `리소스가 ${this.groupThreshold.toLocaleString('en-US')}개를 넘어 종류별로 묶어 보입니다 (블록 ${blocks.length.toLocaleString('en-US')}개)`,
      });
    if (opts.drift && !usable)
      notices.push({
        code: 'DRIFT_NOT_OVERLAID',
        text: `드리프트 겹쳐 보기를 쓸 수 없습니다: ${dv.reasonText ?? '계산 안 함'}`,
      });

    return {
      state: base.state,
      version: base.version,
      builtAt: base.builtAt,
      rulesVersion: a.cleanupVersion,
      snapshotStatus: null,
      cluster: null,
      summary,
      layers: LAYERS,
      rules: rulesInfo,
      plates,
      blocks,
      edges: base.edges,
      groups: buildGroups(blocks),
      facets: buildFacets(plates, blocks, base.edges),
      drift: driftBlock,
      scan,
      notices,
    };
  }
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

function layerOf(kind: string) {
  const l = LAYERS.find((x) => x.kinds.includes(kind));
  return l?.id ?? 'aux';
}
