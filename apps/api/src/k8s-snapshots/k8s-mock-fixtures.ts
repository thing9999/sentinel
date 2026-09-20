/**
 * mock 예시 k8s 스냅샷 (docs/api/k8s-snapshot.md 14.2~14.3).
 * - 예시 파일은 cluster mock 인벤토리(기본 시나리오 mixed)를 드리프트와 같은 객체 생성기로 만든 뒤
 *   **CLI 와 같은 정리 규칙**(rules.mjs cleanObject·orderKeys·layout.resourcePath)으로 정리해 YAML 로 쓴다.
 *   그래서 예시 2(변경 없음)는 클러스터와 "차이 없음", 예시 1은 계약 14.3 표의 변경만 드리프트로 나온다.
 * - 비밀값은 누가 봐도 가짜인 값만 (example-password).
 * - 메모리에만 있다. 실제 폴더를 읽거나 쓰지 않는다 (AC-K42).
 */
import { stringify } from 'yaml';
import { buildMockWorld } from '../cluster/mock/mock-world';
import { sha256Version } from '../aws-snapshots/text-utils';
import { buildMockClusterObjects } from './drift/mock-cluster-objects';
import { COMPARABLE_KINDS } from './drift/comparable-kinds';
import type { MemSnapshot, MemTree } from './k8s-backend';
import type { K8sRules } from './k8s-libs';
import {
  MOCK_CLUSTER_ID,
  MOCK_OTHER_CLUSTER_ID,
  NOTES_FILE,
} from './k8s.constants';

type Obj = Record<string, unknown>;

export const K8S_MOCK_IDS = {
  inProgress: '20260919-064500',
  latest: '20260919-061000',
  staging: '20260919-020000',
  envLiteral: '20260918-230000',
  secretObject: '20260918-120000',
  partial: '20260917-090000',
  metaCorrupt: '20260916-150000',
  yamlBroken: '20260915-101010',
  labeled: '20260912-020000',
  lastResult: '20260910-000000',
  trashed: '20260901-000000',
} as const;
export const K8S_MOCK_TRASH_ID = '20260901-000000__20260910T010203000Z';

const SYSTEM_NS = [
  'kube-system',
  'kube-public',
  'kube-node-lease',
  'amazon-cloudwatch',
];
const MIN = 60_000;
/** 예시 스냅샷이 기본 종류에 더해 내보낸 선택 종류 (KIND_CATALOG tier 'optional') */
const OPTIONAL_MOCK_KINDS = new Set(['jobs']);
/** 인벤토리 기준 시각 (값에는 영향 없음. 시각 필드는 정리 규칙으로 지워진다) */
const WORLD_NOW = Date.parse('2026-09-19T06:00:00Z');

export function toYaml(obj: unknown): string {
  return stringify(obj, {
    lineWidth: 0,
    minContentWidth: 0,
    aliasDuplicateObjects: false,
    indent: 2,
    indentSeq: true,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 클러스터에 없는(대시보드 RBAC 밖) 종류의 예시 파일 — 드리프트 "비교 불가 NOT_IN_RBAC" */
function extraObjects(): { path: string; obj: Obj }[] {
  return [
    {
      path: 'prod/configmaps/api-config.yaml',
      obj: {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name: 'api-config',
          namespace: 'prod',
          labels: { app: 'api' },
        },
        data: {
          LOG_FORMAT: 'json',
          FEATURE_FLAGS: 'search,export',
          REQUEST_TIMEOUT_MS: '3000',
        },
      },
    },
    {
      path: 'data/configmaps/postgres-config.yaml',
      obj: {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name: 'postgres-config',
          namespace: 'data',
          labels: { app: 'postgres' },
        },
        data: {
          'postgresql.conf': 'max_connections = 200\nshared_buffers = 1GB\n',
        },
      },
    },
    {
      path: 'prod/networkpolicies/default-deny.yaml',
      obj: {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: { name: 'default-deny', namespace: 'prod' },
        spec: { podSelector: {}, policyTypes: ['Ingress'] },
      },
    },
    {
      // 소유자 없는 독립 Job (CronJob 이 만든 Job 은 ownerReferences 로 제외된다 — rules.isAlwaysExcluded).
      // 워크로드 층의 `chamfer` 모양 회귀 점검용: batch 판에 Deployment(stack)·CronJob(roof)·Job(chamfer) 이 함께 있다
      // (docs/design/snapshot-3d.md 4.11.2·4.11.6)
      path: 'batch/jobs/report-backfill.yaml',
      obj: {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
          name: 'report-backfill',
          namespace: 'batch',
          labels: { app: 'report-backfill' },
        },
        spec: {
          completions: 1,
          parallelism: 1,
          backoffLimit: 3,
          ttlSecondsAfterFinished: 86400,
          template: {
            metadata: { labels: { app: 'report-backfill' } },
            spec: {
              restartPolicy: 'OnFailure',
              containers: [
                {
                  name: 'backfill',
                  image:
                    '123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/report:1.2.0',
                  args: ['--mode', 'backfill', '--from', '2026-08-01'],
                  resources: {
                    requests: { cpu: '100m', memory: '128Mi' },
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      path: 'batch/cronjobs/nightly-report.yaml',
      obj: {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: { name: 'nightly-report', namespace: 'batch' },
        spec: {
          schedule: '0 18 * * *',
          concurrencyPolicy: 'Forbid',
          jobTemplate: {
            spec: {
              template: {
                spec: {
                  restartPolicy: 'OnFailure',
                  containers: [
                    {
                      name: 'report',
                      image:
                        '123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/report:latest',
                      args: ['--mode', 'nightly'],
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
  ];
}

/** 기본 예시 리소스 (경로 → 정리된 객체) */
export function baseResources(rules: K8sRules): Map<string, Obj> {
  const w = buildMockWorld('mixed', WORLD_NOW);
  const objects = buildMockClusterObjects(
    {
      namespaces: w.namespaces,
      workloads: w.workloads,
      services: w.services,
      ingresses: w.ingresses,
      pvcs: w.pvcs,
      pdbs: w.pdbs,
      hpas: w.hpas,
    },
    MOCK_CLUSTER_ID,
  );
  const out = new Map<string, Obj>();
  for (const k of COMPARABLE_KINDS) {
    for (const raw of objects.get(k.id) ?? []) {
      const full: Obj = { apiVersion: k.apiVersion, kind: k.kind, ...raw };
      const md = full.metadata as Obj;
      const ns =
        k.kind === 'Namespace' ? String(md.name) : String(md.namespace);
      if (SYSTEM_NS.includes(ns)) continue;
      if (rules.isAlwaysExcluded(full) || rules.isAutoCreated(full, k.kind))
        continue;
      const clean = rules.orderKeys(
        rules.cleanObject(full, { rulesVersion: 1, kind: k.kind }),
      );
      const path = rules.resourcePath({
        namespace: k.kind === 'Namespace' ? null : ns,
        kindDir: k.id,
        name: String(md.name),
        isNamespace: k.kind === 'Namespace',
      });
      out.set(path, clean);
    }
  }
  for (const e of extraObjects()) out.set(e.path, e.obj);
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function secretRefs(id: string): Obj {
  return {
    schemaVersion: 1,
    snapshotId: id,
    note: 'Secret 값은 담지 않습니다. 복원 전에 아래 Secret 을 별도 보관소에서 다시 만드세요.',
    secrets: [
      {
        namespace: 'data',
        secretName: 'postgres-credentials',
        keys: ['POSTGRES_PASSWORD'],
        optional: false,
        referencedBy: [
          {
            kind: 'StatefulSet',
            name: 'postgres',
            via: 'env.valueFrom.secretKeyRef',
            container: 'postgres',
          },
        ],
      },
      {
        namespace: 'prod',
        secretName: 'api-db-credentials',
        keys: ['password'],
        optional: false,
        referencedBy: [
          {
            kind: 'Deployment',
            name: 'api',
            via: 'env.valueFrom.secretKeyRef',
            container: 'api',
          },
        ],
      },
    ],
  };
}

interface MetaOpts {
  clusterId: string;
  name: string;
  context: string;
  serverVersion?: string;
  forbiddenKinds?: string[];
  scan?: { errors: number; warnings: number; rules: string[] };
}

function metadata(
  id: string,
  rules: K8sRules,
  res: Map<string, Obj>,
  o: MetaOpts,
): Obj {
  const byKind: Record<string, number> = {};
  const byNamespace: Record<string, number> = {};
  let helm = 0;
  for (const [p, obj] of res) {
    const c = rules.classifyPath(p);
    if (!c) continue;
    const kd = c.kindDir ?? 'namespaces';
    byKind[kd] = (byKind[kd] ?? 0) + 1;
    const ns = c.type === 'namespace' ? c.name! : (c.namespace ?? '_cluster');
    byNamespace[ns] = (byNamespace[ns] ?? 0) + 1;
    if (rules.isHelmManaged(obj)) helm++;
  }
  const defaults = rules.KIND_CATALOG.filter((k) => k.tier === 'default');
  // 예시는 기본 종류 + 선택 종류 `jobs` 를 내보낸 것으로 본다 (batch/jobs/report-backfill.yaml)
  const optional = rules.KIND_CATALOG.filter((k) =>
    OPTIONAL_MOCK_KINDS.has(k.id),
  );
  const scanned = [...defaults, ...optional];
  const exportedNs = [...res.keys()]
    .filter((p) => p.endsWith('/namespace.yaml'))
    .map((p) => p.split('/')[0])
    .sort();
  const kinds: Obj = {};
  for (const k of scanned) {
    const forbidden = o.forbiddenKinds?.includes(k.id) ?? false;
    kinds[k.id] = {
      kind: k.kind,
      apiVersion: k.apiVersion,
      namespaced: k.namespaced,
      result: forbidden ? 'forbidden' : 'ok',
      exported: forbidden ? 0 : (byKind[k.id] ?? 0),
      excludedByRule:
        k.id === 'configmaps' || k.id === 'serviceaccounts'
          ? 5
          : k.id === 'services'
            ? 1
            : 0,
      forbiddenNamespaces: forbidden ? exportedNs : [],
    };
  }
  const scan = o.scan ?? { errors: 0, warnings: 0, rules: [] };
  return {
    schemaVersion: 1,
    snapshotId: id,
    snapshotIdTimezone: 'UTC',
    createdAt: new Date(snapTime(id) + 42_311).toISOString(),
    tool: {
      name: 'sentinel-k8s-snapshot',
      version: '0.1.0',
      node: 'v22.12.0',
      client: '@kubernetes/client-node 2.0.0',
    },
    cluster: {
      id: o.clusterId,
      idSource: 'kube-system-namespace-uid',
      context: o.context,
      name: o.name,
      serverVersion: o.serverVersion ?? 'v1.34.1-eks-8a2c1f0',
    },
    scope: {
      namespaces: {
        mode: 'all_except_system',
        include: [],
        exclude: [],
        system: SYSTEM_NS,
        systemIncluded: [],
      },
      exported: exportedNs,
      missing: [],
      kinds: {
        default: defaults.map((k) => k.id),
        optional: optional.map((k) => k.id),
        custom: [],
        excluded: [],
      },
      includeHelmManaged: true,
    },
    kinds,
    resources: {
      total: res.size,
      byKind,
      byNamespace,
      helmManaged: helm,
      excludedByRule: {
        configmaps: {
          total: 5,
          owned: 0,
          autoCreated: 5,
          helmExcluded: 0,
          autoCreatedNames: ['kube-root-ca.crt'],
        },
        serviceaccounts: {
          total: 5,
          owned: 0,
          autoCreated: 5,
          helmExcluded: 0,
          autoCreatedNames: ['default'],
        },
        services: {
          total: 1,
          owned: 0,
          autoCreated: 1,
          helmExcluded: 0,
          autoCreatedNames: ['default/kubernetes'],
        },
      },
    },
    cleanup: {
      rulesVersion: 1,
      summary: [...(rules.RULESETS[1]?.summary ?? [])],
    },
    secrets: {
      mode: 'refs_only',
      read: false,
      referenced: 2,
      file: 'secret-refs.json',
    },
    secretScan: {
      errors: scan.errors,
      warnings: scan.warnings,
      strict: false,
      passed: scan.errors === 0,
      rules: scan.rules,
      profile: 'k8s',
    },
  };
}

function snapTime(id: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(id)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

function snapshot(
  id: string,
  files: Map<string, string | Buffer>,
  opts: { ageMs?: number } = {},
): MemSnapshot {
  const t =
    opts.ageMs !== undefined ? { ageMs: opts.ageMs } : snapTime(id) + 42_000;
  return {
    files: new Map(
      [...files].map(([p, c]) => [
        p,
        { bytes: Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8'), mtimeMs: t },
      ]),
    ),
    dirMtimeMs: t,
    rev: 1,
  };
}

function render(res: Map<string, Obj>): Map<string, string> {
  return new Map([...res].map(([p, o]) => [p, toYaml(o)]));
}

function withMeta(
  id: string,
  rules: K8sRules,
  res: Map<string, Obj>,
  o: MetaOpts,
  extra: Record<string, string> = {},
): Map<string, string> {
  const files = render(res);
  files.set('metadata.json', json(metadata(id, rules, res, o)));
  files.set('secret-refs.json', json(secretRefs(id)));
  for (const [k, v] of Object.entries(extra)) files.set(k, v);
  return files;
}

const PROD = {
  clusterId: MOCK_CLUSTER_ID,
  name: 'prod-eks',
  context: 'sentinel-snapshot',
};

/** 예시 1의 변경 (14.3 표) */
function applyLatestChanges(res: Map<string, Obj>): Map<string, Obj> {
  const out = new Map([...res].map(([p, o]) => [p, clone(o)]));
  const api = out.get('prod/deployments/api.yaml')!;
  const spec = api.spec as Obj;
  spec.replicas = 5;
  const pod = ((spec.template as Obj).spec as Obj).containers as Obj[];
  const c = pod.find((x) => x.name === 'api')!;
  c.image = String(c.image).replace(':1.4.2', ':1.4.1');
  ((c.resources as Obj).limits as Obj).memory = '1Gi';
  for (const e of c.env as Obj[]) if (e.name === 'LOG_LEVEL') e.value = 'debug';
  delete c.terminationMessagePath;
  delete c.terminationMessagePolicy;
  delete c.imagePullPolicy;
  const web = out.get('prod/services/web.yaml');
  if (web && isObj(web.spec)) delete web.spec.sessionAffinity;
  out.set('prod/ingresses/api-public.yaml', {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name: 'api-public',
      namespace: 'prod',
      annotations: { 'alb.ingress.kubernetes.io/scheme': 'internet-facing' },
    },
    spec: {
      ingressClassName: 'alb',
      rules: [
        {
          host: 'api.example.com',
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: { service: { name: 'api', port: { number: 80 } } },
              },
            ],
          },
        },
      ],
    },
  });
  out.delete('prod/deployments/payments.yaml');
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * 예시 9(staging)의 관계 예외 3종 (docs/api/snapshot-3d.md 12.3).
 * 다른 클러스터라 드리프트를 계산하지 않으므로 다른 예시의 건수에 영향이 없다.
 */
function applyStagingChanges(res: Map<string, Obj>): Map<string, Obj> {
  const out = new Map([...res].map(([p, o]) => [p, clone(o)]));
  // ① 스냅샷에 없는 ConfigMap 참조 → 유령 블록
  const worker = out.get('prod/deployments/worker.yaml');
  if (worker && isObj(worker.spec)) {
    const pod = (worker.spec.template as Obj).spec as Obj;
    const c = (pod.containers as Obj[])[0];
    c.envFrom = [{ configMapRef: { name: 'worker-config' } }];
  }
  // ② 맞는 워크로드가 없는 Service 셀렉터 → "대상 없음"
  out.set('prod/services/api-legacy.yaml', {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: 'api-legacy',
      namespace: 'prod',
      labels: { app: 'api-legacy' },
    },
    spec: {
      ports: [{ name: 'http', protocol: 'TCP', port: 80, targetPort: 8080 }],
      selector: { app: 'api-legacy' },
      type: 'ClusterIP',
    },
  });
  // ③ 셀렉터 없는 Service → "셀렉터 없음"
  out.set('data/services/pg-external.yaml', {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'pg-external', namespace: 'data' },
    spec: {
      ports: [
        { name: 'postgres', protocol: 'TCP', port: 5432, targetPort: 5432 },
      ],
      type: 'ClusterIP',
    },
  });
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** 예시 7의 여러 문서 파일 (snapshot-3d 12.3, AC-3D31) */
const MULTI_DOC_FILE = 'batch/configmaps/report-settings.yaml';
function multiDocYaml(): string {
  const a: Obj = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'report-settings', namespace: 'batch' },
    data: { FORMAT: 'csv', TIMEZONE: 'UTC' },
  };
  const b: Obj = {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'report-schedule', namespace: 'batch' },
    data: { WINDOW: '18:00-19:00' },
  };
  return `${toYaml(a)}---\n${toYaml(b)}`;
}

export interface K8sMockTrees {
  default: MemTree;
  noDrift: MemTree;
  empty: MemTree;
}

/** mock 트리 3벌: 기본, 드리프트 없음(예시 1 변경 없음), 빈 폴더 */
export function buildK8sMockTrees(rules: K8sRules): K8sMockTrees {
  const base = baseResources(rules);
  const ids = K8S_MOCK_IDS;
  const snaps = new Map<string, MemSnapshot>();

  // 8. 내보내기 진행 중 (metadata.json 없음, 마지막 변경 = 서버 시각 - 5분)
  snaps.set(
    ids.inProgress,
    snapshot(
      ids.inProgress,
      new Map([...render(base)].filter(([p]) => p.startsWith('prod/'))),
      { ageMs: 5 * MIN },
    ),
  );
  // 1. prod-eks 최신 (드리프트 자동 대상, 차이 3건)
  const latest = applyLatestChanges(base);
  snaps.set(
    ids.latest,
    snapshot(ids.latest, withMeta(ids.latest, rules, latest, PROD)),
  );
  // 9. staging-eks (+ 관계 예외 3종, snapshot-3d 12.3)
  snaps.set(
    ids.staging,
    snapshot(
      ids.staging,
      withMeta(ids.staging, rules, applyStagingChanges(base), {
        clusterId: MOCK_OTHER_CLUSTER_ID,
        name: 'staging-eks',
        context: 'sentinel-snapshot-staging',
      }),
    ),
  );
  // 3. 환경 변수 리터럴 비밀값
  {
    const r = new Map([...base].map(([p, o]) => [p, clone(o)]));
    const pg = r.get('data/statefulsets/postgres.yaml')!;
    const cs = (
      (((pg.spec as Obj).template as Obj).spec as Obj).containers as Obj[]
    )[0];
    cs.env = (cs.env as Obj[]).map((e) =>
      e.name === 'POSTGRES_PASSWORD'
        ? { name: 'POSTGRES_PASSWORD', value: 'example-password' }
        : e,
    );
    snaps.set(
      ids.envLiteral,
      snapshot(
        ids.envLiteral,
        withMeta(ids.envLiteral, rules, r, {
          ...PROD,
          scan: { errors: 1, warnings: 0, rules: ['k8s-env-literal'] },
        }),
      ),
    );
  }
  // 4. ConfigMap 경로에 Secret 객체
  {
    const r = new Map([...base].map(([p, o]) => [p, clone(o)]));
    r.set('prod/configmaps/legacy-creds.yaml', {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'legacy-creds', namespace: 'prod' },
      type: 'Opaque',
      stringData: { password: 'example-password' },
    });
    snaps.set(
      ids.secretObject,
      snapshot(
        ids.secretObject,
        withMeta(ids.secretObject, rules, r, {
          ...PROD,
          scan: { errors: 1, warnings: 0, rules: ['k8s-secret-object'] },
        }),
      ),
    );
  }
  // 6. networkpolicies 권한 없음 (부분 성공)
  {
    const r = new Map(
      [...base].filter(([p]) => !p.includes('/networkpolicies/')),
    );
    snaps.set(
      ids.partial,
      snapshot(
        ids.partial,
        withMeta(ids.partial, rules, r, {
          ...PROD,
          forbiddenKinds: ['networkpolicies'],
        }),
      ),
    );
  }
  // 5. metadata.json 손상
  {
    const files = withMeta(ids.metaCorrupt, rules, base, PROD);
    files.set(
      'metadata.json',
      `{\n  "schemaVersion": 1,\n  "snapshotId": "${ids.metaCorrupt}",\n  "cluster": {\n`,
    );
    snaps.set(ids.metaCorrupt, snapshot(ids.metaCorrupt, files));
  }
  // 7. YAML 구문 오류 + 경로 불일치 + 예상 밖 파일
  {
    const r = new Map(
      [...base].filter(([p]) => p !== 'data/services/postgres.yaml'),
    );
    const files = withMeta(ids.yamlBroken, rules, r, PROD, {
      'data/services/pg.yaml': toYaml(base.get('data/services/postgres.yaml')),
      [MULTI_DOC_FILE]: multiDocYaml(),
      'prod/notes.txt': '작업 메모: 복원 전에 확인할 것\n',
      '.env': 'EXAMPLE_ONLY=1\n',
    });
    files.set(
      'prod/deployments/web.yaml',
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: prod\nspec:\n  replicas: 2\n   template: [\n',
    );
    snaps.set(ids.yamlBroken, snapshot(ids.yamlBroken, files));
  }
  // 10. 라벨·메모 + 대시보드 편집 파일 + Helm 관리 리소스
  {
    const r = new Map([...base].map(([p, o]) => [p, clone(o)]));
    const web = r.get('prod/deployments/web.yaml')!;
    ((web.metadata as Obj).labels as Obj).tier = 'frontend';
    const files = withMeta(ids.labeled, rules, r, PROD);
    const webBytes = Buffer.from(
      files.get('prod/deployments/web.yaml')!,
      'utf8',
    );
    files.set(
      NOTES_FILE,
      json({
        schemaVersion: 1,
        tool: 'sentinel dashboard',
        snapshotId: ids.labeled,
        label: 'EKS 1.34 업그레이드 전',
        memo: '업그레이드 전 기준점.\n웹 Deployment 레이블을 대시보드에서 정리함.',
        updatedAt: '2026-09-12T03:10:00.000Z',
        fileEdits: {
          'prod/deployments/web.yaml': {
            savedAt: '2026-09-12T03:05:00.000Z',
            version: sha256Version(webBytes),
          },
        },
      }),
    );
    snaps.set(ids.labeled, snapshot(ids.labeled, files));
  }
  // 2. prod-eks, 클러스터와 같은 내용 (지난 결과 "차이 없음")
  snaps.set(
    ids.lastResult,
    snapshot(ids.lastResult, withMeta(ids.lastResult, rules, base, PROD)),
  );

  const trash = new Map<string, MemSnapshot>([
    [
      K8S_MOCK_TRASH_ID,
      snapshot(ids.trashed, withMeta(ids.trashed, rules, base, PROD)),
    ],
  ]);

  const tree = (
    s: Map<string, MemSnapshot>,
    t: Map<string, MemSnapshot>,
  ): MemTree => ({
    snapshots: s,
    trash: t,
    unrecognized: [],
  });
  const noDrift = new Map(snaps);
  noDrift.set(
    ids.latest,
    snapshot(ids.latest, withMeta(ids.latest, rules, base, PROD)),
  );
  return {
    default: tree(snaps, trash),
    noDrift: tree(noDrift, new Map(trash)),
    empty: tree(new Map(), new Map()),
  };
}

// ---------------------------------------------------------------- 대규모 예시

/** 대규모 시나리오 (docs/api/snapshot-3d.md 12.4). 필요할 때만 만든다(기본 목록에 영향 없음) */
export const K8S_MOCK_LARGE_IDS = {
  large: '20260920-030000',
  overLimit: '20260920-040000',
} as const;
export const MOCK_BENCH_CLUSTER_ID = 'b9e4d1a7-2c3f-4b5e-9a8d-6f7e0c1b2a3d';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 판 하나(네임스페이스)의 리소스 50개: 계약 12.4 구성표 */
function benchNamespace(ns: string): Map<string, Obj> {
  const out = new Map<string, Obj>();
  const container = (name: string, cfgs: string[], secrets: string[]): Obj => ({
    name,
    image: `registry.example.com/${name}:1.0.0`,
    ports: [{ name: 'http', containerPort: 8080, protocol: 'TCP' }],
    envFrom: cfgs.map((c) => ({ configMapRef: { name: c } })),
    env: secrets.map((s, i) => ({
      name: `SECRET_REF_${i + 1}`,
      valueFrom: { secretKeyRef: { name: s, key: 'value' } },
    })),
    resources: { requests: { cpu: '100m', memory: '128Mi' } },
    terminationMessagePath: '/dev/termination-log',
    terminationMessagePolicy: 'File',
    imagePullPolicy: 'IfNotPresent',
  });
  const podSpec = (name: string, cfgs: string[], secrets: string[]): Obj => ({
    containers: [container(name, cfgs, secrets)],
    restartPolicy: 'Always',
    terminationGracePeriodSeconds: 30,
    dnsPolicy: 'ClusterFirst',
    serviceAccountName: 'app-sa',
    serviceAccount: 'app-sa',
    securityContext: {},
    schedulerName: 'default-scheduler',
  });
  out.set(`${ns}/namespace.yaml`, {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: { name: ns, labels: { tier: 'bench' } },
  });
  const workloads: string[] = [];
  for (let i = 1; i <= 13; i++) {
    const name = `app-${pad2(i)}`;
    workloads.push(name);
    const cfgs = [1, 2, 3].map((k) => `cfg-${pad2(((i + k) % 7) + 1)}`);
    const secrets = [`sec-01`, `sec-02`];
    out.set(`${ns}/deployments/${name}.yaml`, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name, namespace: ns, labels: { app: name } },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: { app: name } },
          spec: podSpec(name, cfgs, secrets),
        },
        strategy: {
          type: 'RollingUpdate',
          rollingUpdate: { maxUnavailable: '25%', maxSurge: '25%' },
        },
        revisionHistoryLimit: 10,
        progressDeadlineSeconds: 600,
      },
    });
  }
  for (let i = 1; i <= 2; i++) {
    const name = `db-${pad2(i)}`;
    workloads.push(name);
    out.set(`${ns}/statefulsets/${name}.yaml`, {
      apiVersion: 'apps/v1',
      kind: 'StatefulSet',
      metadata: { name, namespace: ns, labels: { app: name } },
      spec: {
        replicas: 2,
        serviceName: name,
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: { app: name } },
          spec: podSpec(name, [`cfg-0${i}`], ['sec-01']),
        },
        volumeClaimTemplates: [
          {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: { name: 'data' },
            spec: {
              accessModes: ['ReadWriteOnce'],
              resources: { requests: { storage: '10Gi' } },
              storageClassName: 'gp3',
              volumeMode: 'Filesystem',
            },
          },
        ],
        podManagementPolicy: 'OrderedReady',
        updateStrategy: {
          type: 'RollingUpdate',
          rollingUpdate: { partition: 0 },
        },
        revisionHistoryLimit: 10,
      },
    });
    for (let n = 0; n < 2; n++)
      out.set(`${ns}/persistentvolumeclaims/data-${name}-${n}.yaml`, {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: {
          name: `data-${name}-${n}`,
          namespace: ns,
          labels: { app: name },
        },
        spec: {
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '10Gi' } },
          storageClassName: 'gp3',
          volumeMode: 'Filesystem',
        },
      });
  }
  for (const name of workloads)
    out.set(`${ns}/services/${name}.yaml`, {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, namespace: ns, labels: { app: name } },
      spec: {
        ports: [{ name: 'http', protocol: 'TCP', port: 80, targetPort: 8080 }],
        selector: { app: name },
        type: 'ClusterIP',
        sessionAffinity: 'None',
      },
    });
  for (let i = 1; i <= 4; i++) {
    const name = `ing-${pad2(i)}`;
    const a = workloads[(i * 2 - 2) % workloads.length];
    const b = workloads[(i * 2 - 1) % workloads.length];
    out.set(`${ns}/ingresses/${name}.yaml`, {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name, namespace: ns },
      spec: {
        ingressClassName: 'alb',
        rules: [a, b].map((svc) => ({
          host: `${svc}.${ns}.example.com`,
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: { service: { name: svc, port: { number: 80 } } },
              },
            ],
          },
        })),
      },
    });
  }
  for (let i = 1; i <= 7; i++)
    out.set(`${ns}/configmaps/cfg-${pad2(i)}.yaml`, {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: `cfg-${pad2(i)}`, namespace: ns },
      data: { LOG_FORMAT: 'json', INDEX: String(i) },
    });
  for (let i = 1; i <= 2; i++) {
    const target = `app-${pad2(i)}`;
    out.set(`${ns}/horizontalpodautoscalers/${target}.yaml`, {
      apiVersion: 'autoscaling/v2',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: target, namespace: ns },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: target,
        },
        minReplicas: 2,
        maxReplicas: 10,
        metrics: [
          {
            type: 'Resource',
            resource: {
              name: 'cpu',
              target: { type: 'Utilization', averageUtilization: 70 },
            },
          },
        ],
      },
    });
  }
  out.set(`${ns}/poddisruptionbudgets/pdb-01.yaml`, {
    apiVersion: 'policy/v1',
    kind: 'PodDisruptionBudget',
    metadata: { name: 'pdb-01', namespace: ns },
    spec: { minAvailable: 1, selector: { matchLabels: { app: 'app-01' } } },
  });
  out.set(`${ns}/networkpolicies/default-deny.yaml`, {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: { name: 'default-deny', namespace: ns },
    spec: { podSelector: {}, policyTypes: ['Ingress'] },
  });
  return out;
}

function benchResources(namespaces: number): Map<string, Obj> {
  const out = new Map<string, Obj>();
  for (let i = 1; i <= namespaces; i++)
    for (const [p, o] of benchNamespace(`bench-${pad2(i)}`)) out.set(p, o);
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** 시나리오 `large` 의 트리 (스냅샷 2개만) */
export function buildK8sLargeTree(rules: K8sRules): MemTree {
  const bench = {
    clusterId: MOCK_BENCH_CLUSTER_ID,
    name: 'bench-eks',
    context: 'sentinel-snapshot-bench',
  };
  const snaps = new Map<string, MemSnapshot>();
  const big = benchResources(20);
  snaps.set(
    K8S_MOCK_LARGE_IDS.large,
    snapshot(
      K8S_MOCK_LARGE_IDS.large,
      withMeta(K8S_MOCK_LARGE_IDS.large, rules, big, bench),
    ),
  );
  const huge = benchResources(64);
  snaps.set(
    K8S_MOCK_LARGE_IDS.overLimit,
    snapshot(
      K8S_MOCK_LARGE_IDS.overLimit,
      withMeta(K8S_MOCK_LARGE_IDS.overLimit, rules, huge, bench),
    ),
  );
  return { snapshots: snaps, trash: new Map(), unrecognized: [] };
}
