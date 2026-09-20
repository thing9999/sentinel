/**
 * 관계 추출 K1~K11 순수 함수 (docs/api/snapshot-3d.md 5절)와 잘림 상한(10.1) 단위 테스트.
 * 파일·클러스터 접근 없이 문서 객체만으로 동작하는지, 값(레이블·셀렉터·env)이 결과에 새지 않는지 확인한다.
 */
import type { K8sAnalysis, K8sFileFact } from '../k8s-analyzer';
import type { K8sRules } from '../k8s-libs';
import { buildBaseGraph } from './graph-builder';
import { extractRelations, type RelationDoc } from './relations';

type Obj = Record<string, unknown>;

function doc(
  kind: string,
  name: string,
  obj: Obj,
  ns: string | null = 'prod',
  apiGroup = '',
  apiVersion = 'v1',
): RelationDoc {
  const key = `${apiGroup || 'core'}/${kind}/${ns ?? '_cluster'}/${name}`;
  return {
    blockId: key,
    key,
    identity: { apiGroup, apiVersion, kind, namespace: ns, name },
    obj: { apiVersion, kind, metadata: { name, namespace: ns }, ...obj },
  };
}

const deployment = (
  name: string,
  spec: Obj = {},
  labels: Obj = { app: name },
) =>
  doc(
    'Deployment',
    name,
    {
      spec: {
        replicas: 1,
        selector: { matchLabels: labels },
        template: { metadata: { labels }, spec: { containers: [], ...spec } },
      },
    },
    'prod',
    'apps',
    'apps/v1',
  );

describe('extractRelations (순수 함수)', () => {
  it('K1·K2: Ingress → Service → 워크로드, 대상 없으면 유령·표시 문구', () => {
    const r = extractRelations([
      deployment('api'),
      doc('Service', 'api', {
        spec: { selector: { app: 'api' }, ports: [{ port: 80 }] },
      }),
      doc('Service', 'orphan', { spec: { selector: { app: 'nope' } } }),
      doc('Service', 'noselector', { spec: { ports: [{ port: 80 }] } }),
      doc(
        'Ingress',
        'edge',
        {
          spec: {
            rules: [
              {
                http: {
                  paths: [
                    {
                      backend: {
                        service: { name: 'api', port: { number: 80 } },
                      },
                    },
                    {
                      backend: {
                        service: { name: 'gone', port: { number: 80 } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        'prod',
        'networking.k8s.io',
        'networking.k8s.io/v1',
      ),
    ]);
    const ids = r.edges.map((e) => `${e.rule}:${e.from}->${e.to}`);
    expect(ids).toContain(
      'K1:networking.k8s.io/Ingress/prod/edge->core/Service/prod/api',
    );
    expect(ids).toContain(
      'K1:networking.k8s.io/Ingress/prod/edge->ghost:core/Service/prod/gone',
    );
    expect(ids).toContain('K2:core/Service/prod/api->apps/Deployment/prod/api');
    const gone = r.ghosts.find((g) => g.name === 'gone')!;
    expect(gone.reason).toBe('not_in_snapshot');
    expect(gone.fromRules).toEqual(['K1']);
    expect(r.notes.get('core/Service/prod/orphan')!.map((n) => n.code)).toEqual(
      ['no_target'],
    );
    expect(
      r.notes.get('core/Service/prod/noselector')!.map((n) => n.code),
    ).toEqual(['selector_missing']);
    // 셀렉터 없는 Service·대상 없는 Service 는 선을 만들지 않는다
    expect(
      r.edges.filter(
        (e) => e.from.includes('orphan') || e.from.includes('noselector'),
      ),
    ).toEqual([]);
  });

  it('K5·K6: 참조 근거를 합치고 optional 을 표시, Secret 은 항상 유령', () => {
    const r = extractRelations([
      doc('ConfigMap', 'cfg', { data: { A: '1' } }),
      deployment('api', {
        containers: [
          {
            name: 'api',
            envFrom: [
              { configMapRef: { name: 'cfg' } },
              { secretRef: { name: 'sec', optional: true } },
            ],
            env: [
              {
                name: 'X',
                valueFrom: { configMapKeyRef: { name: 'cfg', key: 'A' } },
              },
            ],
          },
        ],
        volumes: [{ name: 'c', configMap: { name: 'cfg' } }],
      }),
    ]);
    const k5 = r.edges.find(
      (e) => e.rule === 'K5' && e.to === 'core/ConfigMap/prod/cfg',
    )!;
    expect(k5.evidence.map((x) => x.code).sort()).toEqual([
      'ENV_CONFIGMAP_KEY',
      'ENV_FROM_CONFIGMAP',
      'VOLUME_CONFIGMAP',
    ]);
    const k6 = r.edges.find((e) => e.rule === 'K6')!;
    expect(k6.to).toBe('ghost:core/Secret/prod/sec');
    expect(k6.toGhost).toBe(true);
    expect(k6.evidence[0].optional).toBe(true);
    expect(r.ghosts.find((g) => g.kind === 'Secret')!.reason).toBe('secret');
  });

  it('K4: StatefulSet 이름 규칙, 맞는 PVC 가 없으면 표시 문구', () => {
    const sts = (name: string, tpl: string) =>
      doc(
        'StatefulSet',
        name,
        {
          spec: {
            selector: { matchLabels: { app: name } },
            template: {
              metadata: { labels: { app: name } },
              spec: { containers: [] },
            },
            volumeClaimTemplates: [{ metadata: { name: tpl } }],
          },
        },
        'data',
        'apps',
        'apps/v1',
      );
    const pvc = (name: string) =>
      doc('PersistentVolumeClaim', name, { spec: {} }, 'data');
    const r = extractRelations([
      sts('pg', 'data'),
      sts('lonely', 'data'),
      pvc('data-pg-0'),
      pvc('data-pg-1'),
    ]);
    expect(r.edges.filter((e) => e.rule === 'K4')).toHaveLength(2);
    expect(
      r.notes.get('apps/StatefulSet/data/lonely')!.map((n) => n.code),
    ).toEqual(['pvc_template_unmatched']);
    expect(r.notes.get('apps/StatefulSet/data/pg')).toBeUndefined();
  });

  it('K7~K11 과 값 비노출: 결과에 레이블·셀렉터·env 원문이 없다', () => {
    const labels = { app: 'api', 'secret-looking-label': 'super-secret-value' };
    const r = extractRelations([
      deployment(
        'api',
        {
          serviceAccountName: 'api-sa',
          containers: [
            {
              name: 'api',
              env: [{ name: 'PASSWORD', value: 'example-password' }],
            },
          ],
        },
        labels,
      ),
      doc(
        'HorizontalPodAutoscaler',
        'api',
        { spec: { scaleTargetRef: { kind: 'Deployment', name: 'api' } } },
        'prod',
        'autoscaling',
        'autoscaling/v2',
      ),
      doc(
        'PodDisruptionBudget',
        'api',
        { spec: { selector: { matchLabels: { app: 'api' } } } },
        'prod',
        'policy',
        'policy/v1',
      ),
      doc(
        'NetworkPolicy',
        'deny',
        { spec: { podSelector: {} } },
        'prod',
        'networking.k8s.io',
        'networking.k8s.io/v1',
      ),
      doc(
        'RoleBinding',
        'rb',
        {
          roleRef: { kind: 'Role', name: 'reader' },
          subjects: [{ kind: 'ServiceAccount', name: 'api-sa' }],
        },
        'prod',
        'rbac.authorization.k8s.io',
        'rbac.authorization.k8s.io/v1',
      ),
    ]);
    const rules = r.edges.map((e) => e.rule);
    expect(rules).toContain('K7');
    expect(rules).toContain('K8');
    expect(rules).toContain('K9');
    expect(rules).toContain('K10');
    expect(rules).toContain('K11');
    expect(r.edges.find((e) => e.rule === 'K9')!.to).toBe(
      'ghost:core/ServiceAccount/prod/api-sa',
    );
    expect(r.ghosts.find((g) => g.kind === 'ServiceAccount')!.reason).toBe(
      'autocreated',
    );
    const json = JSON.stringify(r.edges) + JSON.stringify(r.ghosts);
    expect(json).not.toContain('super-secret-value');
    expect(json).not.toContain('example-password');
    expect(json).not.toContain('matchLabels');
  });

  it('켠 규칙만 뽑는다 (rules 쿼리)', () => {
    const docs = [
      deployment('api'),
      doc('Service', 'api', { spec: { selector: { app: 'api' } } }),
    ];
    const r = extractRelations(docs, new Set(['K1']));
    expect(r.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------- 잘림 상한

function fakeRules(): K8sRules {
  const catalog = [
    { id: 'deployments', kind: 'Deployment', group: 'apps' },
    { id: 'services', kind: 'Service', group: '' },
  ];
  return {
    KIND_CATALOG: catalog,
    kindById: (id: string) => catalog.find((k) => k.id === id) ?? null,
    kindByGroupKind: (g: string, k: string) =>
      catalog.find((x) => x.group === g && x.kind === k) ?? null,
  } as unknown as K8sRules;
}

function fakeFile(name: string): K8sFileFact {
  return {
    path: `prod/deployments/${name}.yaml`,
    fileType: 'resource',
    resource: null,
    resourceKey: `apps/Deployment/prod/${name}`,
    documents: [
      {
        apiGroup: 'apps',
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        namespace: 'prod',
        name,
      },
    ],
    docLines: [1],
    expected: null,
    parse: 'ok',
    parseError: null,
    pathMatches: true,
    duplicate: false,
    duplicateOf: [],
    runtimeFields: [],
    helmManaged: false,
    findings: { errors: 0, warnings: 0 },
    sizeBytes: 10,
    lineCount: 3,
    modifiedAt: null,
    version: `sha256:${name}`,
    eol: 'lf',
    bom: false,
    encoding: 'utf-8',
    indent: { style: 'spaces', size: 2 },
    readError: null,
    kindDir: 'deployments',
    namespaceDir: 'prod',
  };
}

describe('buildBaseGraph 잘림 상한 (계약 10.1)', () => {
  it('블록 상한을 넘으면 앞에서 자르고 표시한다', () => {
    const files = Array.from({ length: 12 }, (_, i) => fakeFile(`app-${i}`));
    const a = {
      id: '20260920-000000',
      files,
      docs: files.map((f) => ({
        path: f.path,
        index: 0,
        identity: f.documents[0],
        key: f.resourceKey!,
        obj: { apiVersion: 'apps/v1', kind: 'Deployment' },
      })),
      unparsable: [],
      metaRaw: null,
      fileFindings: new Map(),
      inProgress: false,
      cleanupVersion: 1,
      scan: {
        summary: {
          errors: 0,
          warnings: 0,
          strict: false,
          passed: true,
          rules: [],
        },
      },
    } as unknown as K8sAnalysis;
    const g = buildBaseGraph(a, {
      rules: fakeRules(),
      maxBlocks: 5,
      maxEdges: 100,
    });
    expect(g.blocks).toHaveLength(5);
    expect(g.truncated).toMatchObject({
      blocks: true,
      droppedBlocks: 7,
      reason: 'BLOCK_LIMIT',
    });
    expect(g.notices.some((n) => n.code === 'GRAPH_TRUNCATED')).toBe(true);
    expect(g.version).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
