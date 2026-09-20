// metadata.json 만들기 (docs/api/k8s-snapshot.md 3.2). 로컬 절대경로·kubeconfig 경로·서버 URL 을 넣지 않는다.
import { CLEANUP_RULES_VERSION, RULESETS } from './rules.mjs';

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** UTC 시각 → 스냅샷 ID YYYYMMDD-HHmmss */
export function snapshotIdOf(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function buildMetadata(p) {
  return {
    schemaVersion: 1,
    snapshotId: p.snapshotId,
    snapshotIdTimezone: 'UTC',
    createdAt: p.now.toISOString(),
    tool: p.tool,
    cluster: p.cluster,
    scope: {
      namespaces: {
        mode: p.cfg.namespaces.mode,
        include: p.cfg.namespaces.include,
        exclude: p.cfg.namespaces.exclude,
        system: p.cfg.namespaces.system,
        systemIncluded: p.cfg.namespaces.systemIncluded,
      },
      exported: p.namespaces,
      missing: p.missing,
      kinds: {
        default: p.cfg.kinds.default,
        optional: p.cfg.kinds.optional,
        custom: p.cfg.kinds.custom,
        excluded: p.cfg.kinds.excluded,
      },
      includeHelmManaged: p.cfg.includeHelm,
    },
    kinds: sortObj(p.kinds),
    resources: {
      total: p.resources.total,
      byKind: sortObj(p.resources.byKind),
      byNamespace: sortObj(p.resources.byNamespace),
      helmManaged: p.resources.helmManaged,
      excludedByRule: sortObj(p.resources.excludedByRule),
    },
    cleanup: { rulesVersion: CLEANUP_RULES_VERSION, summary: [...RULESETS[CLEANUP_RULES_VERSION].summary] },
    secrets: { mode: 'refs_only', read: false, referenced: p.secretsReferenced, file: 'secret-refs.json' },
    secretScan: p.scan,
  };
}
