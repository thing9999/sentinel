/* eslint-disable @typescript-eslint/no-unsafe-member-access -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- 응답 JSON 검사 */
/* eslint-disable @typescript-eslint/no-unsafe-return -- 응답 JSON 검사 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ApiExceptionFilter,
  validationExceptionFactory,
} from '../common/api-error';
import { CommonModule } from '../common/common.module';
import { validateEnv } from '../config/env.validation';
import { PrismaModule } from '../database/prisma.module';
import { ClusterModule } from './cluster.module';

/**
 * 노드 목록의 role 필터 일관성 (kops-support AC-KOPS10~13, 계약 cluster-status 3.1).
 * mock 세계는 마스터 3대 + 워커 6대다.
 */
describe('ClusterModule HTTP (mock) — 워커/컨트롤 플레인 분리', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.DATA_SOURCE = 'mock';
    process.env.DATABASE_URL = '';
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnv,
        }),
        CommonModule,
        PrismaModule,
        ClusterModule,
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const nodes = async (q = '') =>
    (
      await request(app.getHttpServer())
        .get(`/api/cluster/nodes${q}`)
        .expect(200)
    ).body;

  it('기본값은 role=worker: 마스터가 목록·total·counts에 없다', async () => {
    const b = await nodes();
    expect(b.role).toBe('worker');
    expect(b.items.length).toBeGreaterThan(0);
    expect(
      (b.items as { role: string }[]).every((n) => n.role === 'worker'),
    ).toBe(true);
    expect(b.total).toBe(b.roleCounts.worker);
    expect(b.counts.all).toBe(b.roleCounts.worker);
    expect(b.roleCounts.control_plane).toBe(3);
    expect(b.roleCounts.all).toBe(
      b.roleCounts.worker + b.roleCounts.control_plane,
    );
    // facets에 컨트롤 플레인 InstanceGroup이 나오지 않는다
    expect(
      (b.facets.nodeGroups as string[]).some((g) =>
        g.startsWith('control-plane-'),
      ),
    ).toBe(false);
    expect(b.facets.roles).toEqual(['worker', 'control_plane']);
  });

  it('role=control_plane은 마스터만, role=all은 전부', async () => {
    const cp = await nodes('?role=control_plane');
    expect(cp.role).toBe('control_plane');
    expect(cp.total).toBe(3);
    expect(
      (cp.items as { role: string }[]).every((n) => n.role === 'control_plane'),
    ).toBe(true);
    expect(
      (cp.facets.nodeGroups as string[]).every((g) =>
        g.startsWith('control-plane-'),
      ),
    ).toBe(true);

    const all = await nodes('?role=all');
    expect(all.total).toBe(cp.total + (await nodes()).total);
    expect(all.items.length).toBe(all.total);
  });

  it('role 값이 틀리면 400', async () => {
    await request(app.getHttpServer())
      .get('/api/cluster/nodes?role=master')
      .expect(400);
  });

  it('개요 노드 영역·클러스터 메트릭이 워커 기준이고 마스터는 별도 블록', async () => {
    const sum = (
      await request(app.getHttpServer()).get('/api/cluster/summary').expect(200)
    ).body;
    const worker = (await nodes()).total;
    expect(sum.areas.nodes.total).toBe(worker);

    const m = (
      await request(app.getHttpServer()).get('/api/cluster/metrics').expect(200)
    ).body;
    expect(m.scope).toEqual({
      basis: 'worker',
      workerNodeCount: worker,
      controlPlaneNodeCount: 3,
    });
    expect(m.controlPlane.nodeCount).toBe(3);
    // 워커 합계에 마스터 용량이 섞이지 않는다
    expect(m.cpu.allocatableMillicores).toBeGreaterThan(0);
    expect(m.controlPlane.cpu.allocatableMillicores).toBeGreaterThan(0);
    const all = (await nodes('?role=all')).items as {
      allocatable: { cpuMillicores: number };
    }[];
    const totalAlloc = all.reduce((s, n) => s + n.allocatable.cpuMillicores, 0);
    expect(
      m.cpu.allocatableMillicores + m.controlPlane.cpu.allocatableMillicores,
    ).toBe(totalAlloc);
    expect(m.cpu.allocatableMillicores).toBeLessThan(totalAlloc);
  });

  it('GET /api/cluster/control-plane이 200이고 매트릭스에 빈 칸이 없다', async () => {
    const b = (
      await request(app.getHttpServer())
        .get('/api/cluster/control-plane')
        .expect(200)
    ).body;
    expect(b.found).toBe(true);
    expect(b.masters.total).toBe(3);
    expect(b.components.items).toHaveLength(15);
    expect(
      (b.components.items as { cellState: string }[]).every(
        (c) => typeof c.cellState === 'string' && c.cellState.length > 0,
      ),
    ).toBe(true);
    expect(b.components.columns).toHaveLength(3);
    expect(b.components.cellCounts.total).toBe(15);
    expect(typeof b.headline).toBe('string');
    expect(b.limits.etcdInternalMetrics).toBe(false);
    // 마스터 합계 블록은 /metrics의 controlPlane과 같은 값
    const m = (
      await request(app.getHttpServer()).get('/api/cluster/metrics').expect(200)
    ).body;
    expect(b.masters.totals).toEqual(m.controlPlane);
  });

  it('role=control_plane의 areaStatus는 컨트롤 플레인 영역 상태다', async () => {
    const cp = await nodes('?role=control_plane');
    const ov = (
      await request(app.getHttpServer()).get('/api/overview').expect(200)
    ).body;
    expect(cp.areaStatus.status).toBe(ov.areas.controlPlane.status.status);
    expect(ov.areas.controlPlane.masters.total).toBe(3);
    expect(ov.areas.controlPlane.components.total).toBe(15);
  });

  it('metrics/series target=cluster는 워커 기준(scope)이다', async () => {
    const s = (
      await request(app.getHttpServer())
        .get('/api/cluster/metrics/series?target=cluster')
        .expect(200)
    ).body;
    expect(s.scope).toEqual({ basis: 'worker' });
    expect(s.denominators.cpuMillicores).toBeGreaterThan(0);
    const m = (
      await request(app.getHttpServer()).get('/api/cluster/metrics').expect(200)
    ).body;
    expect(s.denominators.cpuMillicores).toBe(m.cpu.allocatableMillicores);
    const nodeSeries = (
      await request(app.getHttpServer())
        .get(
          `/api/cluster/metrics/series?target=node&name=${encodeURIComponent(
            ((await nodes()).items as { name: string }[])[0].name,
          )}`,
        )
        .expect(200)
    ).body;
    expect(nodeSeries.scope).toBeUndefined();
  });
});
