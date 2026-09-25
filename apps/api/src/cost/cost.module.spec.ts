/* eslint-disable @typescript-eslint/no-unsafe-member-access -- 응답 JSON 검사 */
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
import { COST_AWS_GATEWAY } from './aws/aws-gateway';
import { CostModule } from './cost.module';
import { COST_OPTIONS, type CostOptions } from './cost.options';
import { FakeGateway } from './test-helpers';

describe('CostModule HTTP (mock)', () => {
  let app: INestApplication<App>;
  const gw = new FakeGateway();

  beforeAll(async () => {
    // CostModule → ClusterModule(mock 클러스터)이 전역 CommonModule·PrismaModule·검증된 env를 쓴다
    process.env.DATA_SOURCE = 'mock';
    process.env.DATABASE_URL = '';
    const options: CostOptions = {
      dataSource: 'mock',
      awsRegion: null,
      awsProfile: null,
      clusterName: 'prod.k8s.example.com',
      env: {},
      timers: false,
    };
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: validateEnv,
        }),
        CommonModule,
        PrismaModule,
        CostModule,
      ],
    })
      .overrideProvider(COST_OPTIONS)
      .useValue(options)
      .overrideProvider(COST_AWS_GATEWAY)
      .useValue(gw)
      .compile();
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

  it('GET 엔드포인트 모두 200, dataSource·generatedAt 포함, AWS 호출 0회', async () => {
    for (const path of [
      '/api/cost/summary',
      '/api/cost/estimate',
      '/api/cost/allocation?hideSystem=true&sort=namespace:asc',
      '/api/cost/rate-series?range=24h',
      '/api/cost/status',
      '/api/cost/actual',
      '/api/cost/explorer/refresh',
      '/api/cost/settings',
    ]) {
      const res = await request(app.getHttpServer()).get(path).expect(200);
      expect(res.body.dataSource).toBe('mock');
      expect(typeof res.body.generatedAt).toBe('string');
    }
    expect(gw.total()).toBe(0);
  });

  it('mock: 비용 추정의 노드·배분 파드가 클러스터 화면(/api/cluster)과 같다', async () => {
    const http = app.getHttpServer();
    // 노드 목록 기본값은 워커만이다 (AC-KOPS11). 비용 EC2 행은 마스터도 포함하므로 role=all로 맞춘다
    const nodes = (
      await request(http).get('/api/cluster/nodes?role=all').expect(200)
    ).body.items as { name: string }[];
    const est = (await request(http).get('/api/cost/estimate').expect(200))
      .body as {
      resources: {
        ec2: { nodeName: string | null }[];
        controlPlane: { kind: string; nodeName?: string | null }[];
      };
    };
    const clusterNames = nodes.map((n) => n.name).sort();
    // 워커는 ec2, 마스터는 controlPlane(master_ec2)에 있다 (AC-KOPS29)
    const costNames = [
      ...est.resources.ec2.map((r) => r.nodeName),
      ...est.resources.controlPlane
        .filter((r) => r.kind === 'master_ec2')
        .map((r) => r.nodeName ?? null),
    ]
      .filter((n): n is string => n !== null)
      .sort();
    expect(clusterNames.length).toBeGreaterThan(0);
    expect(costNames).toEqual(clusterNames);
    const pods = (
      await request(http).get('/api/cluster/pods?pageSize=500').expect(200)
    ).body.items as { namespace: string }[];
    const alloc = (
      await request(http)
        .get('/api/cost/allocation?hideSystem=false&sort=namespace:asc')
        .expect(200)
    ).body as { rows: { namespace: string }[] };
    const podNs = new Set(pods.map((p) => p.namespace));
    expect(alloc.rows.length).toBeGreaterThan(0);
    for (const row of alloc.rows) expect(podNs.has(row.namespace)).toBe(true);
  });

  it('잘못된 쿼리는 400 VALIDATION_FAILED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/cost/rate-series?range=1y')
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('mock에서 수동 새로고침은 409 LIVE_MODE_ONLY', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/cost/explorer/refresh')
      .expect(409);
    expect(res.body.code).toBe('LIVE_MODE_ONLY');
    expect(res.body.path).toBe('/api/cost/explorer/refresh');
  });

  it('PATCH settings: callCostUsd는 400, DB 없으면 503', async () => {
    await request(app.getHttpServer())
      .patch('/api/cost/settings')
      .send({ explorer: { callCostUsd: 0.02 } })
      .expect(400);
    const res = await request(app.getHttpServer())
      .patch('/api/cost/settings')
      .send({ budget: { monthlyBudgetUsd: 900 } })
      .expect(503);
    expect(res.body.code).toBe('DASHBOARD_DB_UNAVAILABLE');
  });
});
