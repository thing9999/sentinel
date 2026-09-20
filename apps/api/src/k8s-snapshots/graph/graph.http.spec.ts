/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- 응답 JSON 모양을 검사하는 테스트 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EMPTY } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { SnapshotWriteGuard } from '../../aws-snapshots/write.guard';
import {
  KubeClientService,
  KubeWatcherService,
} from '../../cluster/kube/kube-watcher.service';
import {
  buildMockWorld,
  type ClusterScenario,
} from '../../cluster/mock/mock-world';
import { podKey } from '../../cluster/model';
import { ClusterStore } from '../../cluster/state/cluster-store';
import {
  ApiExceptionFilter,
  validationExceptionFactory,
} from '../../common/api-error';
import { DATA_SOURCE_MODE } from '../../common/data-source';
import { SourceRegistry } from '../../common/source-registry.service';
import { validateEnv } from '../../config/env.validation';
import { ClusterObjectSource } from '../drift/cluster-object-source';
import { DriftService } from '../drift/drift.service';
import { K8S_MOCK_IDS, K8S_MOCK_LARGE_IDS } from '../k8s-mock-fixtures';
import { K8sSnapshotsController } from '../k8s-snapshots.controller';
import { K8sSnapshotsService } from '../k8s-snapshots.service';
import { K8sGraphService } from './graph.service';

/**
 * 3D 구성 그래프 HTTP (docs/api/snapshot-3d.md, AC-3D04·10~14·16·18·20·22·24~33).
 * 클러스터 쪽은 cluster mock 인벤토리를 ClusterStore 에 채워 쓴다(드리프트 겹쳐 보기용).
 */
type Body = Record<string, any>;
const ORIGIN = 'http://localhost:3000';
const MISSING_DIR = join(tmpdir(), 'sentinel-k8s-graph-should-not-exist');

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
  store.info = { ...w.info };
  store.initialSyncDone = true;
  registry.update('kube', { state: 'mock', error: null });
  store.notify('all');
}

describe('k8s 구성 그래프 HTTP (mock)', () => {
  let app: INestApplication<App>;
  let svc: K8sSnapshotsService;
  let store: ClusterStore;
  let registry: SourceRegistry;

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
              K8S_SNAPSHOT_DIR: MISSING_DIR,
            }),
        }),
      ],
      controllers: [K8sSnapshotsController],
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
        SnapshotWriteGuard,
      ],
    }).compile();
    store = mod.get(ClusterStore);
    registry = mod.get(SourceRegistry);
    fillStore(store, 'mixed', registry);
    const nest = mod.createNestApplication<NestExpressApplication>();
    nest.setGlobalPrefix('api');
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
    await svc.whenReady();
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
  });

  const http = () => request(app.getHttpServer());
  const ids = K8S_MOCK_IDS;
  const graph = async (id: string, q = ''): Promise<Body> =>
    (
      (await http().get(`/api/k8s-snapshots/${id}/graph${q}`).expect(200))
        .body as Body
    ).graph;
  const find = (g: Body, id: string) =>
    (g.blocks as Body[]).find((b) => b.id === id);
  const edge = (g: Body, rule: string, from: string, to: string) =>
    (g.edges as Body[]).find(
      (e) => e.rule === rule && e.from === from && e.to === to,
    );
  const plate = (g: Body, id: string) =>
    (g.plates as Body[]).find((p) => p.id === id)!;
  /**
   * 판 집계가 blocks[] 와 서로 모순되지 않는지 (계약 3절·10.1).
   * `byLayer` 는 유령("추가됨" 포함)까지 센 **블록 수**다.
   */
  const expectPlateCountsConsistent = (g: Body) => {
    const per = new Map<string, { res: number; ghost: number }>();
    const layers = new Map<string, Record<string, number>>();
    for (const p of g.plates as Body[]) {
      per.set(p.id as string, { res: 0, ghost: 0 });
      layers.set(p.id as string, {});
    }
    for (const b of g.blocks as Body[]) {
      const c = per.get(b.plateId as string)!;
      if (b.blockType === 'ghost') c.ghost++;
      else c.res++;
      const l = layers.get(b.plateId as string)!;
      l[b.layer as string] = (l[b.layer as string] ?? 0) + 1;
    }
    let total = 0;
    for (const p of g.plates as Body[]) {
      const c = per.get(p.id as string)!;
      expect({
        id: p.id,
        resourceCount: p.resourceCount,
        ghostCount: p.ghostCount,
      }).toEqual({ id: p.id, resourceCount: c.res, ghostCount: c.ghost });
      expect({ id: p.id, byLayer: p.byLayer }).toEqual({
        id: p.id,
        byLayer: layers.get(p.id as string),
      });
      const sum = Object.values(p.byLayer as Record<string, number>).reduce(
        (s, n) => s + n,
        0,
      );
      expect(sum).toBe((p.resourceCount as number) + (p.ghostCount as number));
      total += sum;
    }
    // 모든 판의 합 = 전체 블록 수 (판 없는 블록이 없다)
    expect(total).toBe(g.summary.blocks);
    expect(total).toBe((g.blocks as Body[]).length);
  };

  it('AC-3D24 K-1: 판 5장 · 블록 34 · 유령 9 · 층 분류', async () => {
    const g = await graph(ids.latest);
    expect(g.state).toBe('ok');
    expect((g.plates as Body[]).map((p) => p.name)).toEqual([
      'batch',
      'data',
      'default',
      'monitoring',
      'prod',
    ]);
    expect(g.summary).toMatchObject({
      plates: 5,
      documents: 30,
      namespaceDocuments: 5,
      resourceBlocks: 25,
      ghosts: 9,
      unparsedBlocks: 0,
      blocks: 34,
      edges: 28,
      edgesDefaultOn: 15,
      driftMarkers: 3,
      grouped: false,
    });
    // 블록 수 + 네임스페이스 문서 = 리소스 문서 + 유령 (계약 10.1)
    expect(g.summary.blocks + g.summary.namespaceDocuments).toBe(
      g.summary.documents + g.summary.ghosts,
    );
    // 판 집계(resourceCount·ghostCount·byLayer)가 blocks[] 와 어긋나지 않는다
    expectPlateCountsConsistent(g);
    expect(
      (g.plates as Body[]).map((p) => [p.id, p.resourceCount, p.ghostCount]),
    ).toEqual([
      ['ns:batch', 4, 1],
      ['ns:data', 7, 2],
      ['ns:default', 0, 0],
      ['ns:monitoring', 3, 1],
      ['ns:prod', 11, 5],
    ]);
    expect(plate(g, 'ns:batch').byLayer).toEqual({
      storage: 1,
      workload: 3,
      aux: 1,
    });
    // "추가됨" 유령(Deployment prod/payments)도 byLayer 에 들어간다
    expect(plate(g, 'ns:prod').byLayer).toEqual({
      storage: 2,
      workload: 4,
      service: 2,
      ingress: 2,
      aux: 6,
    });
    // 비교 불가 종류(ConfigMap·NetworkPolicy·CronJob·Job)도 블록으로 있다
    expect(find(g, 'core/ConfigMap/prod/api-config')).toBeTruthy();
    expect(
      find(g, 'networking.k8s.io/NetworkPolicy/prod/default-deny')?.layer,
    ).toBe('aux');
    expect(find(g, 'batch/CronJob/batch/nightly-report')?.layer).toBe(
      'workload',
    );
    // 소유자 없는 독립 Job (모양 `chamfer` 회귀 점검용, 디자인 4.11.2)
    expect(find(g, 'batch/Job/batch/report-backfill')).toMatchObject({
      kind: 'Job',
      layer: 'workload',
      plateId: 'ns:batch',
      blockType: 'resource',
    });
    expect(
      find(g, 'core/PersistentVolumeClaim/data/data-postgres-0')?.layer,
    ).toBe('storage');
    // namespace.yaml 은 판이다 (블록 아님)
    expect(find(g, 'core/Namespace/_cluster/prod')).toBeUndefined();
    expect((g.plates as Body[])[4].file).toBe('prod/namespace.yaml');
  });

  it('AC-3D25 K-1: 기본 켬 관계 K1~K7 과 근거·확실성', async () => {
    const g = await graph(ids.latest);
    const k1 = edge(
      g,
      'K1',
      'networking.k8s.io/Ingress/prod/api-public',
      'core/Service/prod/api',
    );
    expect(k1).toMatchObject({ certainty: 'confirmed', toGhost: false });
    expect(k1!.evidence).toContain('backend.service.name');
    const k2 = edge(
      g,
      'K2',
      'core/Service/prod/api',
      'apps/Deployment/prod/api',
    );
    expect(k2).toMatchObject({ certainty: 'estimated' });
    expect(k2!.evidenceItems[0].code).toBe('SELECTOR_MATCH');
    expect(
      edge(
        g,
        'K3',
        'apps/Deployment/monitoring/grafana',
        'core/PersistentVolumeClaim/monitoring/grafana',
      ),
    ).toBeTruthy();
    const k4 = edge(
      g,
      'K4',
      'apps/StatefulSet/data/postgres',
      'core/PersistentVolumeClaim/data/data-postgres-0',
    );
    expect(k4).toMatchObject({ certainty: 'estimated' });
    const k5 = edge(
      g,
      'K5',
      'apps/Deployment/prod/api',
      'core/ConfigMap/prod/api-config',
    );
    expect(k5!.evidenceItems[0]).toMatchObject({
      code: 'ENV_FROM_CONFIGMAP',
      container: 'api',
    });
    const k6 = edge(
      g,
      'K6',
      'apps/StatefulSet/data/postgres',
      'ghost:core/Secret/data/postgres-credentials',
    );
    expect(k6).toMatchObject({ toGhost: true, certainty: 'confirmed' });
    expect(
      edge(
        g,
        'K7',
        'autoscaling/HorizontalPodAutoscaler/prod/api',
        'apps/Deployment/prod/api',
      ),
    ).toBeTruthy();
    const byRule = (r: string) =>
      (g.edges as Body[]).filter((e) => e.rule === r).length;
    expect({
      K1: byRule('K1'),
      K2: byRule('K2'),
      K3: byRule('K3'),
      K4: byRule('K4'),
      K5: byRule('K5'),
      K6: byRule('K6'),
      K7: byRule('K7'),
      K8: byRule('K8'),
      K9: byRule('K9'),
      K10: byRule('K10'),
      K11: byRule('K11'),
    }).toEqual({
      K1: 2,
      K2: 4,
      K3: 1,
      K4: 3,
      K5: 2,
      K6: 2,
      K7: 1,
      K8: 1,
      K9: 9,
      K10: 3,
      K11: 0,
    });
    // 기본 켬/끔은 rules[] 가 알려 준다
    expect(
      (g.rules as Body[]).filter((r) => r.defaultOn).map((r) => r.id),
    ).toEqual(['K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7']);
    // Secret 유령은 이름만
    const secret = find(g, 'ghost:core/Secret/data/postgres-credentials')!;
    expect(secret.ghost).toEqual({
      reason: 'secret',
      text: 'Secret — 이름만, 값 없음',
    });
    expect(secret.navigate).toMatchObject({
      primary: 'secrets',
      secretName: 'postgres-credentials',
    });
  });

  it('AC-3D27 K-1: 드리프트 표식 3건(변경·삭제·추가) + 비교 불가 5', async () => {
    const g = await graph(ids.latest);
    expect(g.drift).toMatchObject({ requested: true, usable: true });
    expect(g.drift.badge.counts).toMatchObject({
      changed: 1,
      deleted: 1,
      added: 1,
    });
    expect(find(g, 'apps/Deployment/prod/api')!.markers.drift).toMatchObject({
      change: 'changed',
      fieldCount: 3,
    });
    expect(
      find(g, 'networking.k8s.io/Ingress/prod/api-public')!.markers.drift
        .change,
    ).toBe('deleted');
    const added = find(g, 'ghost:apps/Deployment/prod/payments')!;
    expect(added.ghost.reason).toBe('drift_added');
    expect(added.markers.drift.change).toBe('added');
    expect(added.navigate).toMatchObject({
      primary: 'drift',
      resourceKey: 'apps/Deployment/prod/payments',
    });
    expect(g.facets.drift.uncomparable).toBe(5);
    expect(
      find(g, 'core/ConfigMap/prod/api-config')!.markers.drift,
    ).toMatchObject({ change: 'uncomparable', reasonCode: 'NOT_IN_RBAC' });
    // 표식 수 = 드리프트 건수
    const c = g.drift.badge.counts;
    expect(g.summary.driftMarkers).toBe(c.changed + c.deleted + c.added);
    // 숨긴 차이만 있는 리소스는 표식이 없다
    const web = find(g, 'core/Service/prod/web')!;
    expect(web.markers.drift.change).toBe('same');
  });

  it('AC-3D26 K-9: 관계 예외 3종 (유령·대상 없음·셀렉터 없음)', async () => {
    const g = await graph(ids.staging);
    const ghost = find(g, 'ghost:core/ConfigMap/prod/worker-config')!;
    expect(ghost.ghost).toEqual({
      reason: 'not_in_snapshot',
      text: '스냅샷에 없음',
    });
    expect(ghost.ghostFromRules).toEqual(['K5']);
    expect(ghost.markers.drift).toBeNull();
    const legacy = find(g, 'core/Service/prod/api-legacy')!;
    expect(legacy.notes.map((n: Body) => n.code)).toContain('no_target');
    expect((g.edges as Body[]).some((e) => e.from === legacy.id)).toBe(false);
    const ext = find(g, 'core/Service/data/pg-external')!;
    expect(ext.notes.map((n: Body) => n.code)).toContain('selector_missing');
    expect(ext.summary.selector).toBe('absent');
    // 다른 클러스터 → 구성도는 그리고 드리프트만 알 수 없음
    expect(g.state).toBe('ok');
    expect(g.drift).toMatchObject({
      usable: false,
      reasonCode: 'CLUSTER_MISMATCH',
    });
    expect(find(g, 'apps/Deployment/prod/api')!.markers.drift).toBeNull();
    expect(
      (g.notices as Body[]).some((n) => n.code === 'DRIFT_NOT_OVERLAID'),
    ).toBe(true);
  });

  it('AC-3D30 K-3: 스캔 오류 표식 + 발견 줄로 이동', async () => {
    const g = await graph(ids.envLiteral);
    const pg = find(g, 'apps/StatefulSet/data/postgres')!;
    expect(pg.markers.scan.errors).toBe(1);
    expect(pg.navigate).toMatchObject({
      primary: 'files',
      file: 'data/statefulsets/postgres.yaml',
    });
    expect(pg.navigate.line).toBe(pg.markers.scan.firstLine);
    expect(pg.navigate.line).toBeGreaterThan(1);
    expect(g.summary.scanMarkers).toBe(1);
  });

  it('AC-3D31 K-7: 해석 실패 구역 · 경로 불일치 · 여러 문서 파일', async () => {
    const g = await graph(ids.yamlBroken);
    const unparsed = (g.plates as Body[]).find((p) => p.kind === 'unparsed')!;
    expect(unparsed.id).toBe('_unparsed');
    const broken = find(g, 'file:prod/deployments/web.yaml')!;
    expect(broken.plateId).toBe('_unparsed');
    expect(broken.blockType).toBe('unparsed');
    expect(broken.notes[0].code).toBe('parse_failed');
    expect(
      (g.edges as Body[]).some(
        (e) => e.from === broken.id || e.to === broken.id,
      ),
    ).toBe(false);
    const pg = find(g, 'core/Service/data/postgres')!;
    expect(pg.file.path).toBe('data/services/pg.yaml');
    expect(pg.notes.map((n: Body) => n.code)).toContain('path_mismatch');
    expect(pg.markers.fileIssue.code).toBe('path_mismatch');
    const a = find(g, 'core/ConfigMap/batch/report-settings#0')!;
    const b = find(g, 'core/ConfigMap/batch/report-schedule#1')!;
    expect(a.file.path).toBe(b.file.path);
    expect(a.file.documentCount).toBe(2);
    expect(Number(b.file.line)).toBeGreaterThan(Number(a.file.line));
    expect(a.notes.map((n: Body) => n.code)).toContain('multi_document');
  });

  it('AC-3D33 K-10: Helm 표시', async () => {
    const g = await graph(ids.labeled);
    expect(find(g, 'apps/Deployment/monitoring/grafana')!.markers.helm).toBe(
      true,
    );
    expect(find(g, 'core/Service/monitoring/grafana')!.markers.helm).toBe(true);
    expect(find(g, 'apps/Deployment/prod/api')!.markers.helm).toBe(false);
  });

  it('AC-3D29 K-2: 지난 결과(last_result)로 겹쳐 보기', async () => {
    const g = await graph(ids.lastResult);
    expect(g.drift.badge.mode).toBe('last_result');
    expect(g.drift.usable).toBe(true);
    expect(g.drift.computedAt).toBeTruthy();
    expect(g.summary.driftMarkers).toBe(0);
  });

  it('AC-3D14: 응답에 값(env·command·레이블·셀렉터·이미지·Secret)이 없다', async () => {
    for (const id of [ids.latest, ids.staging, ids.envLiteral]) {
      const body = JSON.stringify(await graph(id));
      expect(body).not.toContain('example-password');
      expect(body).not.toMatch(/"debug"|"info"/);
      expect(body).not.toContain('postgresql.conf');
      expect(body).not.toContain('dkr.ecr');
      expect(body).not.toContain('POSTGRES_PASSWORD');
      expect(body).not.toContain('matchLabels');
      expect(body).not.toContain('app.kubernetes.io/managed-by');
      expect(body).not.toContain('alb.ingress.kubernetes.io');
    }
  });

  it('AC-3D10·11: rules 필터 · 같은 입력 같은 순서 · 400', async () => {
    const g1 = await graph(ids.latest);
    const g2 = await graph(ids.latest);
    expect((g2.blocks as Body[]).map((b) => b.id)).toEqual(
      (g1.blocks as Body[]).map((b) => b.id),
    );
    expect(g2.version).toBe(g1.version);
    const only = await graph(ids.latest, '?rules=K1,K2');
    expect(new Set((only.edges as Body[]).map((e) => e.rule))).toEqual(
      new Set(['K1', 'K2']),
    );
    expect((only.rules as Body[]).find((r) => r.id === 'K5')).toMatchObject({
      excluded: true,
      count: null,
    });
    // 유령도 그 관계에서만 나온다
    expect(
      (only.blocks as Body[]).some((b) =>
        b.id.startsWith('ghost:core/Secret/'),
      ),
    ).toBe(false);
    await http()
      .get(`/api/k8s-snapshots/${ids.latest}/graph?rules=K99`)
      .expect(400);
    await http()
      .get(`/api/k8s-snapshots/${ids.latest}/graph?drift=maybe`)
      .expect(400);
    await http().get('/api/k8s-snapshots/2026-09/graph').expect(400);
    await http().get('/api/k8s-snapshots/20260101-000000/graph').expect(404);
  });

  it('drift=off 면 겹쳐 보기를 만들지 않는다 (계산도 하지 않는다)', async () => {
    const g = await graph(ids.latest, '?drift=off');
    expect(g.drift).toMatchObject({ requested: false, usable: false });
    expect(g.drift.badge.counts).toBeTruthy(); // 배지는 그대로
    expect(find(g, 'apps/Deployment/prod/api')!.markers.drift).toBeNull();
    expect(find(g, 'ghost:apps/Deployment/prod/payments')).toBeUndefined();
    expect(g.summary.driftMarkers).toBe(0);
    // "추가됨" 유령이 없으므로 블록·유령이 그만큼 적고 판 집계도 같이 줄어든다
    expect(g.summary).toMatchObject({ blocks: 33, ghosts: 8 });
    expectPlateCountsConsistent(g);
    expect(plate(g, 'ns:prod')).toMatchObject({
      resourceCount: 11,
      ghostCount: 4,
      byLayer: { storage: 2, workload: 3, service: 2, ingress: 2, aux: 6 },
    });
  });

  it('AC-3D18: 내보내기 진행 중 스냅샷은 그리지 않는다', async () => {
    const g = await graph(ids.inProgress);
    expect(g.state).toBe('pending_export');
    expect(g.blocks).toEqual([]);
    expect(g.plates).toEqual([]);
    expect((g.notices as Body[])[0].code).toBe('EXPORT_MAYBE_IN_PROGRESS');
    expect(g.drift.usable).toBe(false);
  });

  it('AC-3D04: 관계 표와 3D 가 같은 수치를 쓴다 (facets 합계)', async () => {
    const g = await graph(ids.latest);
    const blocks = g.blocks as Body[];
    expect(
      (g.facets.namespaces as Body[]).reduce((s, n) => s + n.count, 0),
    ).toBe(blocks.length);
    expect((g.facets.kinds as Body[]).reduce((s, k) => s + k.count, 0)).toBe(
      blocks.length,
    );
    expect((g.facets.rules as Body[]).reduce((s, r) => s + r.count, 0)).toBe(
      (g.edges as Body[]).length,
    );
    const d = g.facets.drift;
    expect(
      d.changed +
        d.deleted +
        d.added +
        d.same +
        d.uncomparable +
        d.skipped +
        d.none,
    ).toBe(blocks.length);
    expect(g.facets.ghosts).toBe(g.summary.ghosts);
    // 차수 합 = 선 수 × 2
    expect(blocks.reduce((s, b) => s + b.degree.in + b.degree.out, 0)).toBe(
      (g.edges as Body[]).length * 2,
    );
  });

  it('AC-3D13: 그래프 조회가 드리프트를 계산하지 않고 임대도 만들지 않는다', async () => {
    const before = (await graph(ids.latest)).drift.computedAt;
    await graph(ids.latest);
    await graph(ids.latest);
    const after = await graph(ids.latest);
    expect(after.drift.computedAt).toBe(before);
    // 임대 없음: 계산 안 하는 스냅샷을 그래프로 봐도 drift 는 "계산 안 함" 그대로
    const other = await graph(ids.partial);
    expect(other.drift).toMatchObject({
      usable: false,
      reasonCode: 'DRIFT_NOT_COMPUTED',
    });
    const d = (
      await http().get(`/api/k8s-snapshots/${ids.partial}/drift`).expect(200)
    ).body as Body;
    expect(d.lease).toBeNull();
    expect(d.drift.mode).toBe('none');
  });

  it('기존 계약 불변: 목록·상세·드리프트 응답과 mock 그룹이 그대로다', async () => {
    const list = (await http().get('/api/k8s-snapshots').expect(200))
      .body as Body;
    expect(list.items).toHaveLength(10);
    const latest = (list.items as Body[]).find((i) => i.id === ids.latest)!;
    expect(latest.drift.status.reasons[0].text).toBe(
      '차이 3건 (변경 1 · 삭제 1 · 추가 1)',
    );
    expect(latest.status.status).toBe('ok');
    const detail = (
      await http().get(`/api/k8s-snapshots/${ids.latest}`).expect(200)
    ).body as Body;
    expect(Object.keys(detail.snapshot as Body)).toContain('files');
    expect(detail.snapshot).not.toHaveProperty('graph');
    expect(detail.snapshot.files[0]).not.toHaveProperty('docLines');
    // mock 그룹: 기존 시나리오 ID·기본값 그대로 + large 1개만 추가
    expect(svc.group).toBe('k8s-snapshots');
    expect(svc.defaultScenario).toBe('default');
    expect([...svc.scenarios]).toEqual([
      'default',
      'empty',
      'not-configured',
      'unavailable',
      'read-only',
      'write-disabled',
      'conflict-once',
      'cluster-disconnected',
      'no-drift',
      'large',
    ]);
  });

  it('AC-3D22: 대규모 시나리오 — 1,000 리소스와 묶어 보기', async () => {
    svc.setScenario('large');
    await svc.refresh();
    const big = await graph(K8S_MOCK_LARGE_IDS.large);
    expect(big.summary.documents).toBe(1000);
    expect(big.summary.plates).toBe(20);
    expect(big.summary.edgesDefaultOn).toBe(1960);
    expect(big.summary.edges).toBe(2580);
    expect(big.summary.grouped).toBe(false);
    expect(big.drift).toMatchObject({
      usable: false,
      reasonCode: 'CLUSTER_MISMATCH',
    });

    const huge = await graph(K8S_MOCK_LARGE_IDS.overLimit);
    expect(huge.summary.documents).toBe(3200);
    expect(huge.summary.grouped).toBe(true);
    expect((huge.blocks as Body[]).length).toBeGreaterThan(3000);
    expect((huge.groups as Body[]).length).toBeGreaterThan(0);
    expect(
      (huge.notices as Body[]).some((n) => n.code === 'GROUPED_VIEW'),
    ).toBe(true);
  }, 60_000);
});
