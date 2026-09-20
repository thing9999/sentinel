/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- 응답 JSON 모양을 검사하는 테스트 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EMPTY } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AwsSnapshotsService } from '../aws-snapshots/aws-snapshots.service';
import { SnapshotWriteGuard } from '../aws-snapshots/write.guard';
import {
  KubeClientService,
  KubeWatcherService,
} from '../cluster/kube/kube-watcher.service';
import {
  buildMockWorld,
  type ClusterScenario,
} from '../cluster/mock/mock-world';
import { podKey } from '../cluster/model';
import { ClusterStore } from '../cluster/state/cluster-store';
import {
  ApiExceptionFilter,
  validationExceptionFactory,
} from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import type { TopicEvent } from '../common/extension-points';
import { SourceRegistry } from '../common/source-registry.service';
import { validateEnv } from '../config/env.validation';
import { SnapshotMenuController } from '../snapshot-menu/snapshot-menu.controller';
import { SnapshotMenuService } from '../snapshot-menu/snapshot-menu.service';
import { ClusterObjectSource } from './drift/cluster-object-source';
import { DriftService } from './drift/drift.service';
import { K8sGraphService } from './graph/graph.service';
import { K8S_MOCK_IDS, K8S_MOCK_TRASH_ID } from './k8s-mock-fixtures';
import { K8sSnapshotsController } from './k8s-snapshots.controller';
import { K8sSnapshotsService } from './k8s-snapshots.service';

/**
 * k8s-snapshot mock 모드 HTTP 흐름 (docs/api/k8s-snapshot.md). PrismaService 없이 뜬다.
 * 클러스터 쪽은 cluster mock 인벤토리(buildMockWorld)를 ClusterStore 에 채워 쓴다 (MockClusterService 와 같은 값).
 */
type Body = Record<string, any>;
const ORIGIN = 'http://localhost:3000';
const MISSING_DIR = join(tmpdir(), 'sentinel-k8s-mock-should-not-exist');

function fillStore(
  store: ClusterStore,
  s: ClusterScenario,
  registry: SourceRegistry,
): void {
  const w = buildMockWorld(s, Date.now());
  store.clearAll();
  for (const n of w.namespaces) store.namespaces.add(n);
  for (const x of w.workloads)
    store.workloads.set(`${x.kind}/${x.namespace}/${x.name}`, x);
  for (const p of w.pvcs) store.pvcs.set(podKey(p.namespace, p.name), p);
  for (const x of w.services)
    store.services.set(podKey(x.namespace, x.name), x);
  for (const x of w.ingresses)
    store.ingresses.set(podKey(x.namespace, x.name), x);
  for (const x of w.pdbs) store.pdbs.set(podKey(x.namespace, x.name), x);
  for (const x of w.hpas) store.hpas.set(podKey(x.namespace, x.name), x);
  store.info =
    s === 'no-cluster'
      ? { name: null, version: null, region: null }
      : { ...w.info };
  store.initialSyncDone = s !== 'no-cluster';
  registry.update('kube', {
    state:
      s === 'no-cluster'
        ? 'not_configured'
        : s === 'kube-stale'
          ? 'stale'
          : 'mock',
    error: null,
  });
  store.notify('all');
}

describe('k8s-snapshots HTTP (mock)', () => {
  let app: INestApplication<App>;
  let svc: K8sSnapshotsService;
  let menu: SnapshotMenuService;
  let store: ClusterStore;
  let registry: SourceRegistry;
  const events: TopicEvent[] = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: (env) =>
            validateEnv({
              ...env,
              DATA_SOURCE: 'mock',
              CORS_ORIGIN: ORIGIN,
              // mock 에서는 설정돼 있어도 읽지도 만들지도 않는다 (AC-K42)
              K8S_SNAPSHOT_DIR: MISSING_DIR,
            }),
        }),
      ],
      controllers: [K8sSnapshotsController, SnapshotMenuController],
      providers: [
        { provide: DATA_SOURCE_MODE, useValue: 'mock' },
        SourceRegistry,
        ClusterStore,
        {
          provide: KubeWatcherService,
          useValue: { objectChanges$: EMPTY, cacheOf: () => null },
        },
        {
          provide: KubeClientService,
          useValue: { kc: null, clusterName: () => null },
        },
        ClusterObjectSource,
        DriftService,
        K8sGraphService,
        K8sSnapshotsService,
        AwsSnapshotsService,
        SnapshotMenuService,
        SnapshotWriteGuard,
      ],
    }).compile();
    store = mod.get(ClusterStore);
    registry = mod.get(SourceRegistry);
    fillStore(store, 'mixed', registry);
    const nest = mod.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    nest.setGlobalPrefix('api');
    nest.use(
      /^\/api\/k8s-snapshots\/[^/]+\/file(\/check)?\/?$/,
      json({ limit: 11 * 1024 * 1024 }),
    );
    nest.useBodyParser('json', { limit: '1mb' });
    nest.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    nest.useGlobalFilters(new ApiExceptionFilter());
    await nest.init();
    app = nest;
    svc = mod.get(K8sSnapshotsService);
    menu = mod.get(SnapshotMenuService);
    await svc.whenReady();
    await mod.get(AwsSnapshotsService).whenReady();
    svc.events$.subscribe((e) => events.push(e));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    fillStore(store, 'mixed', registry);
    svc.setScenario('default');
    svc.resetData();
    await svc.refresh();
    await new Promise((r) => setTimeout(r, 20));
    svc.flushNow();
    events.length = 0;
  });

  const http = () => request(app.getHttpServer());
  const put = (url: string, body: object) =>
    http().put(url).set('Origin', ORIGIN).send(body);
  const post = (url: string, body: object = {}) =>
    http().post(url).set('Origin', ORIGIN).send(body);
  const ids = K8S_MOCK_IDS;

  it('목록: 예시 10개의 파일 상태·드리프트 배지, 휴지통 1개, MISSING_DIR 를 만들지 않음 (AC-K41, K42)', async () => {
    const b = (await http().get('/api/k8s-snapshots').expect(200)).body as Body;
    expect(b.dataSource).toBe('mock');
    expect(b.items).toHaveLength(10);
    const row = (id: string) => (b.items as Body[]).find((i) => i.id === id)!;
    const st = Object.fromEntries(
      (b.items as Body[]).map((i) => [i.id, i.status.status]),
    );
    expect(st).toEqual({
      [ids.inProgress]: 'unknown',
      [ids.latest]: 'ok',
      [ids.staging]: 'ok',
      [ids.envLiteral]: 'critical',
      [ids.secretObject]: 'critical',
      [ids.partial]: 'warning',
      [ids.metaCorrupt]: 'critical',
      [ids.yamlBroken]: 'warning',
      [ids.labeled]: 'ok',
      [ids.lastResult]: 'ok',
    });
    expect(row(ids.envLiteral).status.reasons[0].text).toContain(
      'k8s-env-literal',
    );
    expect(
      row(ids.secretObject).status.reasons.map((r: Body) => r.code),
    ).toEqual(
      expect.arrayContaining(['SCAN_SECRET_ERRORS', 'PATH_CONTENT_MISMATCH']),
    );
    expect(row(ids.partial).status.reasons[0].code).toBe('PARTIAL_EXPORT');
    expect(row(ids.labeled).modifiedByDashboard).toBe(true);
    expect(row(ids.labeled).label).toBe('EKS 1.34 업그레이드 전');
    // 드리프트는 파일 상태에 섞이지 않는다 (두 축)
    const latest = row(ids.latest);
    expect(latest.drift).toMatchObject({
      mode: 'auto',
      computed: true,
      resultAvailable: true,
    });
    expect(latest.drift.status.reasons[0].text).toBe(
      '차이 3건 (변경 1 · 삭제 1 · 추가 1)',
    );
    expect(row(ids.staging).drift.status.reasons[0]).toMatchObject({
      code: 'CLUSTER_MISMATCH',
      text: '다른 클러스터의 스냅샷 (staging-eks)',
    });
    expect(row(ids.metaCorrupt).drift.status.reasons[0].code).toBe(
      'CLUSTER_ID_MISSING',
    );
    expect(row(ids.inProgress).drift.status.reasons[0].code).toBe(
      'SNAPSHOT_FILES_PENDING',
    );
    expect(row(ids.lastResult).drift).toMatchObject({
      mode: 'last_result',
      lastResultStatus: 'ok',
      resultAvailable: true,
    });
    expect(row(ids.envLiteral).drift.status.reasons[0].code).toBe(
      'DRIFT_NOT_COMPUTED',
    );
    expect(row(ids.staging).cluster.relation).toBe('other');
    expect(row(ids.latest).cluster.relation).toBe('same');
    expect(b.facets.cluster).toEqual({ same: 7, other: 1, unknown: 2 });
    expect(b.summary.trashCount).toBe(1);
    expect(b.summary.latestDrift.snapshotId).toBe(ids.latest);
    expect(b.summary.dashboardCluster).toMatchObject({
      state: 'mock',
      name: 'prod-eks',
    });
    expect(b.cli.exitCodes.map((x: Body) => x.code)).toEqual([0, 1, 2, 3, 4]);
    expect(JSON.stringify(b)).not.toContain('example-password');
    expect(existsSync(MISSING_DIR)).toBe(false);
  });

  it('필터: cluster·drift·status', async () => {
    const other = (
      await http().get('/api/k8s-snapshots?cluster=other').expect(200)
    ).body as Body;
    expect(other.items.map((i: Body) => i.id)).toEqual([ids.staging]);
    const warn = (
      await http().get('/api/k8s-snapshots?drift=warning').expect(200)
    ).body as Body;
    expect(warn.items.map((i: Body) => i.id)).toEqual([ids.latest]);
    await http().get('/api/k8s-snapshots?drift=bogus').expect(400);
  });

  it('드리프트: 클러스터 쪽 값 = cluster mock 인벤토리 값, 가린 값, 명령 (AC-K44, K38, K39)', async () => {
    const b = (
      await http().get(`/api/k8s-snapshots/${ids.latest}/drift`).expect(200)
    ).body as Body;
    const byChange = Object.fromEntries(
      (b.resources as Body[])
        .filter((r) => r.change !== 'same')
        .map((r) => [r.key, r.change]),
    );
    expect(byChange).toEqual({
      'apps/Deployment/prod/api': 'changed',
      'apps/Deployment/prod/payments': 'added',
      'networking.k8s.io/Ingress/prod/api-public': 'deleted',
    });
    const api = (b.resources as Body[]).find(
      (r) => r.key === 'apps/Deployment/prod/api',
    )!;
    const f = (p: string) => api.fields.find((x: Body) => x.path === p);
    const wl = store.workloads.get('Deployment/prod/api')!;
    expect(f('spec.template.spec.containers[api].image').cluster.value).toBe(
      wl.containers[0].image,
    );
    expect(
      f('spec.template.spec.containers[api].resources.limits.memory').cluster
        .value,
    ).toBe('512Mi');
    expect(wl.containers[0].limits.memoryBytes).toBe(512 * 1024 * 1024);
    expect(f('spec.replicas')).toMatchObject({
      category: 'managed',
      managedRule: 'HPA_REPLICAS',
    });
    expect(f('spec.replicas').cluster.value).toBe(wl.desired);
    expect(
      f('spec.template.spec.containers[api].env[LOG_LEVEL].value').snapshot
        .kind,
    ).toBe('masked');
    expect(JSON.stringify(b)).not.toMatch(/"debug"|"info"/);
    expect(api.commands.diff).toBe(
      `kubectl diff -f deploy/k8s-snapshot/snapshots/${ids.latest}/prod/deployments/api.yaml`,
    );
    expect(b.uncomparable.map((u: Body) => u.kind).sort()).toEqual([
      'ConfigMap',
      'CronJob',
      'Job',
      'NetworkPolicy',
    ]);
    expect(b.target.clusterId).toBe('7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e');
    // cluster 시나리오를 바꾸면 드리프트도 따라 바뀐다 (healthy: batch/scratch PVC 없음 → 삭제됨 하나 더)
    fillStore(store, 'healthy', registry);
    const h = (
      await http().get(`/api/k8s-snapshots/${ids.latest}/drift`).expect(200)
    ).body as Body;
    expect(h.drift.counts.deleted).toBe(2);
    expect(
      h.resources.some(
        (r: Body) =>
          r.key === 'core/PersistentVolumeClaim/batch/scratch' &&
          r.change === 'deleted',
      ),
    ).toBe(true);
    svc.flushNow();
    const ev = events.filter((e) => e.event === 'k8s-snapshots.drift');
    expect(ev.length).toBeGreaterThan(0);
    const payload = ev[ev.length - 1].data as Body;
    expect(payload.trigger).toBe('cluster_changed');
    // SSE 에는 필드 값·리소스 이름이 없다
    expect(JSON.stringify(ev)).not.toMatch(/api:1\.4|512Mi|scratch/);
  });

  it('cluster 출처: no-cluster → 연결 없음, kube-stale → stale 표시', async () => {
    fillStore(store, 'no-cluster', registry);
    let b = (await http().get('/api/k8s-snapshots').expect(200)).body as Body;
    let latest = (b.items as Body[]).find((i) => i.id === ids.latest)!;
    expect(latest.drift.status.reasons[0].code).toBe('CLUSTER_NOT_CONNECTED');
    expect(latest.actions.computeDrift.allowed).toBe(false);
    fillStore(store, 'kube-stale', registry);
    b = (await http().get('/api/k8s-snapshots').expect(200)).body as Body;
    latest = (b.items as Body[]).find((i) => i.id === ids.latest)!;
    expect(latest.drift.status.stale).toBe(true);
    expect(latest.drift.status.status).toBe('warning');
  });

  it('mock 시나리오: cluster-disconnected, no-drift, not-configured (AC-K43)', async () => {
    svc.setScenario('cluster-disconnected');
    await svc.refresh();
    let b = (await http().get(`/api/k8s-snapshots/${ids.latest}`).expect(200))
      .body as Body;
    expect(b.snapshot.drift.status.reasons[0].code).toBe(
      'CLUSTER_NOT_CONNECTED',
    );
    await post(`/api/k8s-snapshots/${ids.latest}/drift`).expect(409);
    svc.setScenario('no-drift');
    await svc.refresh();
    b = (await http().get(`/api/k8s-snapshots/${ids.latest}`).expect(200))
      .body as Body;
    expect(b.snapshot.drift.status.reasons[0].code).toBe('DRIFT_NO_DIFF');
    svc.setScenario('not-configured');
    await svc.refresh();
    b = (await http().get('/api/k8s-snapshots').expect(200)).body as Body;
    expect(b.items).toEqual([]);
    expect(b.summary.root.state).toBe('not_configured');
    await http().get(`/api/k8s-snapshots/${ids.latest}`).expect(503);
    const m = (await http().get('/api/snapshot-menu').expect(200)).body as Body;
    expect(m.tabs.k8s.included).toBe(false);
    expect(m.menu.showIcon).toBe(true); // AWS 쪽은 mock 포함
  });

  it('상세: 파일 목록·트리·개수·Secret 참조·정보 문구', async () => {
    const b = (await http().get(`/api/k8s-snapshots/${ids.latest}`).expect(200))
      .body as Body;
    const s = b.snapshot;
    expect(s.files[0].path).toBe('metadata.json');
    expect(s.files[0].editable.reasonCode).toBe('FILE_KIND_READ_ONLY');
    expect(s.files[1].path).toBe('secret-refs.json');
    const api = s.files.find(
      (f: Body) => f.path === 'prod/deployments/api.yaml',
    );
    expect(api).toMatchObject({
      resourceKey: 'apps/Deployment/prod/api',
      comparable: true,
      drift: 'changed',
      parse: 'ok',
    });
    expect(
      s.files.find((f: Body) => f.path === 'prod/configmaps/api-config.yaml')
        .drift,
    ).toBe('uncomparable');
    const prod = s.tree.find((t: Body) => t.namespace === 'prod');
    expect(prod.namespaceFile).toBe('prod/namespace.yaml');
    expect(prod.kinds.map((k: Body) => k.kindDir)[0]).toBe('deployments');
    expect(prod.kinds.find((k: Body) => k.kindDir === 'configmaps').drift).toBe(
      'not_in_rbac',
    );
    expect(s.counts.excluded.map((e: Body) => e.reason)).toEqual([
      'auto_created',
      'auto_created',
      'auto_created',
    ]);
    expect(s.secretRefs).toMatchObject({ state: 'ok', count: 2 });
    expect(s.secretRefs.note).toContain('Secret 값은 담지 않습니다');
    expect(s.scope).toMatchObject({
      namespaceMode: 'all_except_system',
      excludeNamespaces: [],
    });
    expect(s.notices.map((n: Body) => n.code)).toEqual(
      expect.arrayContaining(['DATA_NOT_INCLUDED', 'HELM_MANAGED']),
    );
    expect(s.folder.fileCount).toBeGreaterThan(20);
    expect(b.cli.scan).toBe(
      `npm run scan --prefix deploy/k8s-snapshot -- snapshots/${ids.latest}`,
    );
    const broken = (
      await http().get(`/api/k8s-snapshots/${ids.yamlBroken}`).expect(200)
    ).body.snapshot as Body;
    const web = broken.files.find(
      (f: Body) => f.path === 'prod/deployments/web.yaml',
    );
    expect(web.parse).toBe('yaml_error');
    expect(web.parseError.message).toMatch(/^YAML 구문 오류 \(/);
    expect(broken.extraFiles.map((x: Body) => x.name)).toEqual([
      '.env',
      'prod/notes.txt',
    ]);
    const pg = broken.files.find(
      (f: Body) => f.path === 'data/services/pg.yaml',
    );
    expect(pg.pathMatches).toBe(false);
  });

  it('파일 보기·경로 규칙·catch-all (AC-K24)', async () => {
    const ok = (
      await http()
        .get(
          `/api/k8s-snapshots/${ids.latest}/file?path=prod/deployments/api.yaml`,
        )
        .expect(200)
    ).body as Body;
    expect(ok.content).toContain('kind: Deployment');
    expect(ok.resource).toMatchObject({ kind: 'Deployment', name: 'api' });
    expect(ok.commands.apply).toContain(
      'kubectl apply -f deploy/k8s-snapshot/snapshots/',
    );
    const meta = (
      await http()
        .get(`/api/k8s-snapshots/${ids.latest}/file?path=metadata.json`)
        .expect(200)
    ).body as Body;
    expect(meta.commands).toBeNull();
    for (const bad of [
      'notes.json',
      '../metadata.json',
      '..%2Fmetadata.json',
      '%2e%2e%2fmetadata.json',
      'prod%5C..%5Cmetadata.json',
      '/etc/passwd',
      'C:%5CWindows%5Cwin.ini',
      'prod/deployments/api.yaml%00',
      'prod//api.yaml',
      'prod/deployments/sub/api.yaml',
      'prod/deployments/~ZZ.yaml',
      '.trash/x/metadata.json',
    ]) {
      const r = await http().get(
        `/api/k8s-snapshots/${ids.latest}/file?path=${bad}`,
      );
      expect([bad, r.status]).toEqual([bad, 400]);
      expect(JSON.stringify(r.body)).not.toContain('passwd');
    }
    await http().get(`/api/k8s-snapshots/${ids.latest}/file`).expect(400);
    await http()
      .get(
        `/api/k8s-snapshots/${ids.latest}/file?path=prod/deployments/nope.yaml`,
      )
      .expect(404);
    await http().get('/api/k8s-snapshots/..%2f..%2fetc').expect(400);
    await http()
      .get(`/api/k8s-snapshots/${ids.latest}/files/cloudformation`)
      .expect(400);
    await http().get('/api/k8s-snapshots/29990101-000000').expect(404);
  });

  it('저장: 확인 필요 422, 버전 충돌 409, 성공 시 fileEdits 기록·드리프트 즉시 재계산 (AC-K22, K23, K37)', async () => {
    const url = `/api/k8s-snapshots/${ids.latest}/file?path=prod/deployments/web.yaml`;
    const cur = (await http().get(url).expect(200)).body as Body;
    const renamed = cur.content.replace('name: web\n', 'name: web2\n');
    const chk = (
      await post(
        `/api/k8s-snapshots/${ids.latest}/file/check?path=prod/deployments/web.yaml`,
        { content: renamed },
      ).expect(200)
    ).body as Body;
    expect(chk.check.identity.matches).toBe(false);
    expect(chk.check.confirmationsRequired).toEqual(['identity_changed']);
    const r422 = await put(url, {
      content: renamed,
      baseVersion: cur.version,
    }).expect(422);
    expect(r422.body.code).toBe('SNAPSHOT_CONFIRMATION_REQUIRED');
    expect(r422.body.message).toContain('metadata.name');
    const m = /^( *)- name: web$/m.exec(cur.content as string)!;
    const ind = ' '.repeat(m[1].length + 2);
    const secret = (cur.content as string).replace(
      m[0],
      `${m[0]}\n${ind}env:\n${ind}  - name: API_TOKEN\n${ind}    value: plain-token-value-123`,
    );
    const r2 = await put(url, {
      content: secret,
      baseVersion: cur.version,
    }).expect(422);
    expect(r2.body.details.missing).toEqual(['secret_errors']);
    expect(JSON.stringify(r2.body)).not.toContain('plain-token-value-123');
    await put(url, {
      content: cur.content.replace('replicas: 2', 'replicas: 4'),
      baseVersion: `sha256:${'0'.repeat(64)}`,
    }).expect(409);
    await put(`/api/k8s-snapshots/${ids.latest}/file?path=metadata.json`, {
      content: '{}',
      baseVersion: cur.version,
    }).expect(403);
    await http()
      .put(url)
      .set('Origin', 'http://evil.example')
      .send({ content: 'x', baseVersion: cur.version })
      .expect(403);
    await http()
      .put(url)
      .set('Origin', ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('x')
      .expect(415);
    const saved = (
      await put(url, {
        content: cur.content.replace('replicas: 2', 'replicas: 4'),
        baseVersion: cur.version,
      }).expect(200)
    ).body as Body;
    expect(saved).toMatchObject({ saved: true, driftRecompute: 'scheduled' });
    expect(saved.snapshot.modifiedByDashboard).toBe(true);
    expect(saved.snapshot.drift.status.reasons[0].text).toBe(
      '차이 4건 (변경 2 · 삭제 1 · 추가 1)',
    );
    const detail = (
      await http().get(`/api/k8s-snapshots/${ids.latest}`).expect(200)
    ).body as Body;
    expect(
      detail.snapshot.files.find(
        (f: Body) => f.path === 'prod/deployments/web.yaml',
      ).drift,
    ).toBe('changed');
    svc.flushNow();
    expect(
      events.some(
        (e) =>
          e.event === 'k8s-snapshots.changed' &&
          (e.data as Body).changedIds.includes(ids.latest),
      ),
    ).toBe(true);
    // 저장하지 않은 스냅샷은 자동 대상이 아니면 driftRecompute none
    const other = `/api/k8s-snapshots/${ids.partial}/file?path=prod/deployments/web.yaml`;
    const o = (await http().get(other).expect(200)).body as Body;
    const s2 = (
      await put(other, {
        content: o.content.replace('replicas: 2', 'replicas: 3'),
        baseVersion: o.version,
      }).expect(200)
    ).body as Body;
    expect(s2.driftRecompute).toBe('none');
  });

  it('conflict-once: 다음 저장 한 번 409 후 기본으로', async () => {
    svc.setScenario('conflict-once');
    const url = `/api/k8s-snapshots/${ids.latest}/file?path=prod/deployments/web.yaml`;
    const cur = (await http().get(url).expect(200)).body as Body;
    const body = {
      content: cur.content.replace('replicas: 2', 'replicas: 4'),
      baseVersion: cur.version,
    };
    await put(url, body).expect(409);
    expect(svc.currentScenario()).toBe('default');
  });

  it('라벨·메모: 저장·충돌·비밀값 422', async () => {
    const d = (await http().get(`/api/k8s-snapshots/${ids.latest}`).expect(200))
      .body as Body;
    const v = d.snapshot.notes.version;
    const r = (
      await put(`/api/k8s-snapshots/${ids.latest}/notes`, {
        label: '배포 전',
        memo: '메모',
        baseVersion: v,
      }).expect(200)
    ).body as Body;
    expect(r.notes.label).toBe('배포 전');
    await put(`/api/k8s-snapshots/${ids.latest}/notes`, {
      label: 'x',
      memo: '',
      baseVersion: v,
    }).expect(409);
    const bad = await put(`/api/k8s-snapshots/${ids.latest}/notes`, {
      label: 'x',
      memo: 'password: hunter2hunter2',
      baseVersion: r.notes.version,
    }).expect(422);
    expect(bad.body.code).toBe('SNAPSHOT_NOTES_SECRET_DETECTED');
    expect(JSON.stringify(bad.body)).not.toContain('hunter2');
  });

  it('휴지통: 삭제(ID 확인)·복원·영구 삭제, 자동 대상에서 빠짐 (AC-K25)', async () => {
    await http()
      .delete(`/api/k8s-snapshots/${ids.latest}?confirm=nope`)
      .set('Origin', ORIGIN)
      .expect(400);
    const del = (
      await http()
        .delete(`/api/k8s-snapshots/${ids.latest}?confirm=${ids.latest}`)
        .set('Origin', ORIGIN)
        .expect(200)
    ).body as Body;
    expect(del.trashItem.cluster).toEqual({
      context: 'sentinel-snapshot',
      name: 'prod-eks',
    });
    expect(del.summary.trashCount).toBe(2);
    // 자동 대상이 남은 prod-eks 스냅샷 중 가장 최신으로 바뀐다
    const sum = (await http().get('/api/k8s-snapshots/summary').expect(200))
      .body as Body;
    expect(sum.summary.latestDrift.snapshotId).toBe(ids.envLiteral);
    const trash = (await http().get('/api/k8s-snapshots/trash').expect(200))
      .body as Body;
    expect(trash.items).toHaveLength(2);
    const t = trash.items.find((i: Body) => i.snapshotId === ids.latest);
    await post(`/api/k8s-snapshots/trash/${t.trashId}/restore`).expect(200);
    await http()
      .delete(`/api/k8s-snapshots/trash/${K8S_MOCK_TRASH_ID}?confirm=x`)
      .set('Origin', ORIGIN)
      .expect(400);
    await http()
      .delete(
        `/api/k8s-snapshots/trash/${K8S_MOCK_TRASH_ID}?confirm=20260901-000000`,
      )
      .set('Origin', ORIGIN)
      .expect(200);
    await http()
      .delete('/api/k8s-snapshots/trash/bad..id?confirm=x')
      .set('Origin', ORIGIN)
      .expect(400);
    const after = (await http().get('/api/k8s-snapshots/summary').expect(200))
      .body as Body;
    expect(after.summary.trashCount).toBe(0);
    expect(after.summary.latestDrift.snapshotId).toBe(ids.latest);
  });

  it('드리프트 요청: 임대·자동 대상·409·지난 결과 (AC-K35, K36)', async () => {
    const r = (
      await post(`/api/k8s-snapshots/${ids.partial}/drift`, {
        force: true,
      }).expect(200)
    ).body as Body;
    expect(r.drift.mode).toBe('on_demand');
    expect(r.lease.renewAfterSec).toBe(60);
    expect(r.drift.status.reasons[0].code).toBe('DRIFT_NO_DIFF');
    const auto = (
      await post(`/api/k8s-snapshots/${ids.latest}/drift`, {}).expect(200)
    ).body as Body;
    expect(auto.lease).toBeNull();
    const mis = await post(
      `/api/k8s-snapshots/${ids.staging}/drift`,
      {},
    ).expect(409);
    expect(mis.body).toMatchObject({
      code: 'K8S_DRIFT_UNAVAILABLE',
      details: { reasonCode: 'CLUSTER_MISMATCH' },
    });
    await post(`/api/k8s-snapshots/${ids.partial}/drift`, {
      force: 'yes',
    }).expect(400);
    await http()
      .post(`/api/k8s-snapshots/${ids.partial}/drift`)
      .set('Origin', ORIGIN)
      .set('Content-Type', 'text/plain')
      .send('x')
      .expect(415);
    const last = (
      await http().get(`/api/k8s-snapshots/${ids.lastResult}/drift`).expect(200)
    ).body as Body;
    expect(last.drift).toMatchObject({
      mode: 'last_result',
      resultAvailable: true,
      lastResultStatus: 'ok',
    });
    expect(last.drift.status.reasons[0].code).toBe('DRIFT_NOT_COMPUTED');
    const none = (
      await http().get(`/api/k8s-snapshots/${ids.envLiteral}/drift`).expect(200)
    ).body as Body;
    expect(none.drift.mode).toBe('none');
    expect(none.resources).toEqual([]);
  });

  it('규칙 도움말: scan-rules(k8s 프로필)·drift-rules', async () => {
    const s = (await http().get('/api/k8s-snapshots/scan-rules').expect(200))
      .body as Body;
    expect(s.profile).toBe('k8s');
    expect(s.rules.map((r: Body) => r.id)).toEqual(
      expect.arrayContaining([
        'k8s-env-literal',
        'k8s-secret-object',
        'secret-key-value',
      ]),
    );
    const d = (await http().get('/api/k8s-snapshots/drift-rules').expect(200))
      .body as Body;
    expect(d.comparableKinds).toHaveLength(9);
    expect(d.comparableKinds[0].informer).toBe('mock');
    expect(d.managed.map((m: Body) => m.id)).toContain('HPA_REPLICAS');
  });

  it('메뉴 합산: AWS + Kubernetes, 드리프트는 메뉴 상태에 넣지 않음 (AC-K16, K19)', async () => {
    const m = (await http().get('/api/snapshot-menu').expect(200)).body as Body;
    expect(m.dataSource).toBe('mock');
    expect(m.menu.count).toBe(m.tabs.aws.critical + m.tabs.k8s.critical);
    expect(m.tabs.k8s.critical).toBe(3);
    expect(m.menu.status.reasons[0].text).toMatch(
      /^커밋 금지 스냅샷 \d+개 \(AWS \d+ · Kubernetes 3\)$/,
    );
    expect(m.tabs.k8s.latestDrift.snapshotId).toBe(ids.latest);
    expect(JSON.stringify(m.menu)).not.toContain('DRIFT');
    // 기존 AWS 요약 모양 불변 (메뉴 합산 필드를 AWS 응답에 더하지 않는다)
    expect(
      Object.keys(app.get(AwsSnapshotsService).buildSummary()).sort(),
    ).toEqual(
      [
        'counts',
        'lastCheckedAt',
        'limits',
        'root',
        'status',
        'trashCount',
        'unrecognized',
        'writable',
      ].sort(),
    );
    const s = (await menu.snapshot())[0];
    expect(s.event).toBe('snapshot-menu.snapshot');
  });
});
