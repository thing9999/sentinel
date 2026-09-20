import { resolve } from 'node:path';
import { identityOf, resourceKeyOf, type SnapDoc } from '../k8s-analyzer';
import {
  loadK8sLibs,
  type K8sRules,
  type K8sScanner,
  type Obj,
} from '../k8s-libs';
import { computeDrift, parseQuantity, type DriftResult } from './drift-engine';

/**
 * 드리프트 엔진 (docs/api/k8s-snapshot.md 10.3~10.6). 실제 CLI lib(rules.mjs·scan.mjs)를 불러 쓴다.
 */
const repo = resolve(__dirname, '../../../../..');
let libs: { rules: K8sRules; scanner: K8sScanner };

beforeAll(async () => {
  libs = await loadK8sLibs(
    resolve(repo, 'deploy/aws-snapshot/lib'),
    resolve(repo, 'deploy/k8s-snapshot/lib'),
  );
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function deployment(
  name: string,
  ns = 'prod',
  patch: (o: Obj) => void = () => {},
): Obj {
  const o: Obj = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name, namespace: ns, labels: { app: name } },
    spec: {
      replicas: 2,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: {
          initContainers: [
            { name: 'migrate', image: 'repo/migrate:1' },
            { name: 'warm', image: 'repo/warm:1' },
          ],
          containers: [
            {
              name: 'app',
              image: 'repo/app:1.0',
              ports: [{ containerPort: 8080 }],
              env: [
                { name: 'LOG_LEVEL', value: 'info' },
                { name: 'MODE', value: 'web' },
              ],
              resources: { limits: { memory: '1Gi', cpu: '1' } },
            },
            { name: 'sidecar', image: 'repo/sidecar:2' },
          ],
        },
      },
    },
  };
  patch(o);
  return o;
}

/** 클러스터 쪽: 서버가 채운 기본값·런타임 필드 + apiVersion/kind 없음 (목록 항목 모양) */
function serverSide(o: Obj): Obj {
  const c = clone(o);
  delete c.apiVersion;
  delete c.kind;
  const md = c.metadata as Obj;
  Object.assign(md, {
    uid: 'u-1',
    resourceVersion: '9',
    generation: 3,
    creationTimestamp: '2026-01-01T00:00:00Z',
  });
  const spec = c.spec as Obj;
  if (spec.template) {
    const ps = (spec.template as Obj).spec as Obj;
    ps.restartPolicy = 'Always';
    ps.dnsPolicy = 'ClusterFirst';
    for (const k of ['containers', 'initContainers'])
      for (const ct of (ps[k] as Obj[]) ?? []) {
        ct.terminationMessagePath = '/dev/termination-log';
        ct.terminationMessagePolicy = 'File';
        ct.imagePullPolicy = 'IfNotPresent';
        for (const p of (ct.ports as Obj[]) ?? []) p.protocol = 'TCP';
      }
    spec.revisionHistoryLimit = 10;
  }
  c.status = { replicas: 2 };
  return c;
}

function doc(path: string, obj: Obj): SnapDoc {
  const id = identityOf(libs.rules, obj)!;
  return { path, index: 0, identity: id, key: resourceKeyOf(id), obj };
}

const META: Obj = {
  scope: {
    namespaces: {
      mode: 'all_except_system',
      include: [],
      exclude: [],
      system: ['kube-system'],
      systemIncluded: [],
    },
    kinds: {
      default: [
        'namespaces',
        'deployments',
        'services',
        'horizontalpodautoscalers',
        'persistentvolumeclaims',
      ],
      optional: [],
    },
    includeHelmManaged: true,
  },
  kinds: {
    deployments: { result: 'ok' },
    services: { result: 'ok' },
    horizontalpodautoscalers: { result: 'ok' },
    persistentvolumeclaims: { result: 'ok' },
  },
};

function run(
  docs: SnapDoc[],
  cluster: Record<string, Obj[]>,
  opts: { meta?: Obj | null; forbidden?: string[] } = {},
): DriftResult {
  return computeDrift(
    {
      snapshotId: '20260919-061000',
      docs,
      unparsable: [],
      metaRaw: opts.meta === undefined ? META : opts.meta,
      rulesVersion: 1,
      fileDocCount: new Map(docs.map((d) => [d.path, 1])),
      cluster: new Map(Object.entries(cluster)),
      forbidden: new Set(opts.forbidden ?? []),
      displayRoot: 'deploy/k8s-snapshot/snapshots',
      maxFields: 500,
    },
    libs,
  );
}

describe('drift engine', () => {
  it('같은 객체 + 서버 기본값·런타임 필드 → 변경 없음, 기본값 차이는 숨김으로만 (AC-K30)', () => {
    const snap = deployment('api');
    const r = run([doc('prod/deployments/api.yaml', snap)], {
      deployments: [serverSide(snap)],
    });
    expect(r.counts).toMatchObject({
      changed: 0,
      added: 0,
      deleted: 0,
      same: 1,
    });
    expect(r.counts.hidden.default).toBeGreaterThan(0);
    const res = r.resources.find((x) => x.key === 'apps/Deployment/prod/api')!;
    expect(res.change).toBe('same');
    expect(res.fields.every((f) => f.category === 'default')).toBe(true);
    expect(
      res.fields.find((f) => f.path.endsWith('terminationMessagePolicy'))
        ?.reason,
    ).toBe('기본값 File');
    expect(
      res.fields.find((f) => f.path.endsWith('imagePullPolicy'))?.reason,
    ).toBe('기본값 IfNotPresent');
  });

  it('수량은 값으로 비교하고, 이름 있는 목록은 순서를 무시한다 (AC-K32)', () => {
    const snap = deployment('api');
    const cl = serverSide(
      deployment('api', 'prod', (o) => {
        const ps = ((o.spec as Obj).template as Obj).spec as Obj;
        const cs = ps.containers as Obj[];
        ((cs[0].resources as Obj).limits as Obj).memory = '1024Mi';
        ((cs[0].resources as Obj).limits as Obj).cpu = '1000m';
        (cs[0].env as Obj[]).reverse();
        cs.reverse();
      }),
    );
    const r = run([doc('p.yaml', snap)], { deployments: [cl] });
    expect(r.counts.changed).toBe(0);
    expect(parseQuantity('1Gi')).toBe(parseQuantity('1024Mi'));
    expect(parseQuantity('500m')).toBe(0.5);
  });

  it('initContainers 순서는 의미가 있다 → "순서" 차이 1건', () => {
    const snap = deployment('api');
    const cl = serverSide(
      deployment('api', 'prod', (o) => {
        const ps = ((o.spec as Obj).template as Obj).spec as Obj;
        (ps.initContainers as Obj[]).reverse();
      }),
    );
    const r = run([doc('p.yaml', snap)], { deployments: [cl] });
    const f = r.resources[0].fields.filter((x) => x.category === 'changed');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      path: 'spec.template.spec.initContainers',
      reason: '순서 다름',
      snapshot: { kind: 'list', items: ['migrate', 'warm'] },
      cluster: { kind: 'list', items: ['warm', 'migrate'] },
    });
  });

  it('숫자와 문자열은 다르다 (targetPort 8080 ≠ "8080")', () => {
    const svc = (tp: number | string): Obj => ({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: 'api', namespace: 'prod' },
      spec: {
        ports: [{ name: 'http', port: 80, targetPort: tp, protocol: 'TCP' }],
        type: 'ClusterIP',
      },
    });
    const r = run([doc('s.yaml', svc(8080))], {
      services: [serverSide(svc('8080'))],
    });
    const f = r.resources[0].fields.filter((x) => x.category === 'changed');
    expect(f.map((x) => x.path)).toEqual(['spec.ports[http].targetPort']);
    expect(f[0].snapshot).toEqual({ kind: 'scalar', value: 8080 });
    expect(f[0].cluster).toEqual({ kind: 'scalar', value: '8080' });
  });

  it('HPA 대상 워크로드의 replicas 는 관리 필드 (AC-K31)', () => {
    const snap = deployment('api');
    const cl = serverSide(
      deployment('api', 'prod', (o) => ((o.spec as Obj).replicas = 7)),
    );
    const hpa: Obj = {
      metadata: { name: 'api', namespace: 'prod' },
      spec: {
        scaleTargetRef: {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          name: 'api',
        },
        minReplicas: 2,
        maxReplicas: 10,
      },
    };
    const r = run([doc('p.yaml', snap)], {
      deployments: [cl],
      horizontalpodautoscalers: [hpa],
    });
    const res = r.resources.find((x) => x.key === 'apps/Deployment/prod/api')!;
    expect(res.change).toBe('same');
    const f = res.fields.find((x) => x.path === 'spec.replicas')!;
    expect(f).toMatchObject({
      category: 'managed',
      managedRule: 'HPA_REPLICAS',
      reason: 'HPA가 관리',
    });
    // HPA 가 없으면 변경
    const r2 = run([doc('p.yaml', snap)], { deployments: [cl] });
    expect(r2.counts.changed).toBe(1);
  });

  it('env 값·command 는 가리고, 결과 JSON 어디에도 원문이 없다 (AC-K38)', () => {
    const snap = deployment('api', 'prod', (o) => {
      const c = (
        (((o.spec as Obj).template as Obj).spec as Obj).containers as Obj[]
      )[0];
      c.command = ['run', '--token-file', '/secret-plain-cmd'];
      (o.metadata as Obj).annotations = {
        'example.com/db': 'postgres://admin:SuperSecretPw1@db:5432/app',
      };
    });
    const cl = serverSide(
      deployment('api', 'prod', (o) => {
        const c = (
          (((o.spec as Obj).template as Obj).spec as Obj).containers as Obj[]
        )[0];
        (c.env as Obj[])[0].value = 'very-secret-env-value';
        c.command = ['run', '--other-plain-cmd'];
        (o.metadata as Obj).annotations = {
          'example.com/db': 'postgres://admin:OtherSecretPw2@db:5432/app',
        };
      }),
    );
    const r = run([doc('p.yaml', snap)], { deployments: [cl] });
    const json = JSON.stringify(r);
    for (const raw of [
      'very-secret-env-value',
      'info',
      'secret-plain-cmd',
      'other-plain-cmd',
      'SuperSecretPw1',
      'OtherSecretPw2',
    ])
      expect(json).not.toContain(raw);
    const env = r.resources[0].fields.find((f) =>
      f.path.includes('env[LOG_LEVEL]'),
    )!;
    expect(env.snapshot).toEqual({
      kind: 'masked',
      text: '값 다름 (****)',
      preview: '****',
    });
    expect(env.cluster?.kind).toBe('masked');
    const ann = r.resources[0].fields.find((f) =>
      f.path.includes('example.com/db'),
    )!;
    expect(ann.cluster?.kind).toBe('masked');
  });

  it('스캐너에 걸리지 않는 어노테이션 값은 가리지 않는다 (ALB 설정 확인)', () => {
    const ing = (scheme: string): Obj => ({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: 'web',
        namespace: 'prod',
        annotations: { 'alb.ingress.kubernetes.io/scheme': scheme },
      },
      spec: { ingressClassName: 'alb' },
    });
    const r = run([doc('i.yaml', ing('internal'))], {
      ingresses: [serverSide(ing('internet-facing'))],
    });
    const f = r.resources[0].fields[0];
    expect(f.path).toBe(
      'metadata.annotations["alb.ingress.kubernetes.io/scheme"]',
    );
    expect(f.snapshot).toEqual({ kind: 'scalar', value: 'internal' });
  });

  it('추가·삭제: 범위 밖 네임스페이스·자동 생성·권한 밖 종류는 추가로 보지 않는다 (AC-K29)', () => {
    const r = run([doc('prod/deployments/old.yaml', deployment('old'))], {
      deployments: [
        serverSide(deployment('new')),
        serverSide(deployment('coredns', 'kube-system')),
        {
          ...serverSide(deployment('rs-owned')),
          metadata: {
            name: 'rs-owned',
            namespace: 'prod',
            ownerReferences: [{ kind: 'X' }],
          },
        },
      ],
      services: [
        {
          metadata: { name: 'kubernetes', namespace: 'default' },
          spec: { type: 'ClusterIP' },
        },
      ],
    });
    expect(r.resources.map((x) => `${x.change}:${x.key}`)).toEqual([
      'added:apps/Deployment/prod/new',
      'deleted:apps/Deployment/prod/old',
    ]);
    const added = r.resources[0];
    expect(added.summary).toEqual({
      images: [
        'repo/migrate:1',
        'repo/warm:1',
        'repo/app:1.0',
        'repo/sidecar:2',
      ],
      replicas: 2,
    });
    expect(added.commands).toBeNull();
    expect(r.resources[1].commands?.apply).toBe(
      'kubectl apply -f deploy/k8s-snapshot/snapshots/20260919-061000/prod/deployments/old.yaml',
    );
    expect(r.addedCheck).toBe('checked');
  });

  it('범위를 모르면 추가됨을 확인하지 않는다', () => {
    const r = run(
      [doc('p.yaml', deployment('old'))],
      { deployments: [serverSide(deployment('new'))] },
      { meta: { kinds: {} } },
    );
    expect(r.addedCheck).toBe('skipped_scope_unknown');
    expect(r.counts.added).toBe(0);
    expect(r.notices.map((n) => n.code)).toContain('ADDED_NOT_CHECKED');
  });

  it('비교 불가: RBAC 밖 종류, 권한 거부, API 버전 다름', () => {
    const cm: Obj = {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: { name: 'c', namespace: 'prod' },
      data: {},
    };
    const hpa1: Obj = {
      apiVersion: 'autoscaling/v1',
      kind: 'HorizontalPodAutoscaler',
      metadata: { name: 'h', namespace: 'prod' },
      spec: { maxReplicas: 3 },
    };
    const pvc: Obj = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: 'p', namespace: 'prod' },
      spec: {},
    };
    const r = run(
      [doc('a', cm), doc('b', hpa1), doc('c', pvc)],
      {},
      { forbidden: ['persistentvolumeclaims'] },
    );
    expect(r.uncomparable.map((u) => u.reason).sort()).toEqual([
      'API_VERSION_MISMATCH',
      'FORBIDDEN',
      'NOT_IN_RBAC',
    ]);
    expect(
      r.uncomparable.find((u) => u.reason === 'API_VERSION_MISMATCH')?.text,
    ).toBe('API 버전이 달라 비교하지 않음 (autoscaling/v1)');
    expect(r.counts.deleted).toBe(0);
    expect(r.counts.uncomparable).toBe(3);
  });

  it('캐시 객체를 바꾸지 않는다', () => {
    const cl = serverSide(deployment('api'));
    const before = JSON.stringify(cl);
    run(
      [
        doc(
          'p.yaml',
          deployment('api', 'prod', (o) => ((o.spec as Obj).replicas = 9)),
        ),
      ],
      { deployments: [cl] },
    );
    expect(JSON.stringify(cl)).toBe(before);
  });
});
