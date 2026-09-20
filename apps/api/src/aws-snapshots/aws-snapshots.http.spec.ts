/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- 응답 JSON 모양을 검사하는 테스트 */
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { json } from 'express';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  ApiExceptionFilter,
  validationExceptionFactory,
} from '../common/api-error';
import { DATA_SOURCE_MODE } from '../common/data-source';
import { SourceRegistry } from '../common/source-registry.service';
import { validateEnv } from '../config/env.validation';
import { AwsSnapshotsController } from './aws-snapshots.controller';
import { AwsSnapshotsService } from './aws-snapshots.service';
import { MOCK_IDS } from './mock-fixtures';
import { SnapshotWriteGuard } from './write.guard';

/**
 * mock 모드 HTTP 흐름. PrismaService 없이 모듈이 뜨는지도 함께 확인한다.
 */
type Body = Record<string, any>;

describe('aws-snapshots HTTP (mock)', () => {
  let app: INestApplication<App>;
  let svc: AwsSnapshotsService;
  const ORIGIN = 'http://localhost:3000';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: (env) =>
            validateEnv({ ...env, DATA_SOURCE: 'mock', CORS_ORIGIN: ORIGIN }),
        }),
      ],
      controllers: [AwsSnapshotsController],
      providers: [
        { provide: DATA_SOURCE_MODE, useValue: 'mock' },
        SourceRegistry,
        AwsSnapshotsService,
        SnapshotWriteGuard,
      ],
    }).compile();
    const nest = mod.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    nest.setGlobalPrefix('api');
    nest.use(
      /^\/api\/aws-snapshots\/[^/]+\/files\/[^/]+(\/check)?\/?$/,
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
    svc = mod.get(AwsSnapshotsService);
    await svc.whenReady();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    svc.setScenario('default');
    svc.resetData();
    await svc.refresh();
  });

  const http = () => request(app.getHttpServer());
  const put = (url: string, body: object) =>
    http().put(url).set('Origin', ORIGIN).send(body);

  it('목록: 예시 9개가 상태별로 나오고 최신순, 휴지통 1개 (AC-01, AC-05)', async () => {
    const res = await http().get('/api/aws-snapshots').expect(200);
    const b = res.body as Body;
    expect(b.dataSource).toBe('mock');
    expect(b.items).toHaveLength(9);
    const st = Object.fromEntries(
      (b.items as Body[]).map((i) => [i.id, i.status.status]),
    );
    expect(st).toEqual({
      [MOCK_IDS.inProgress]: 'unknown',
      [MOCK_IDS.secrets]: 'critical',
      [MOCK_IDS.userData]: 'warning',
      [MOCK_IDS.ok]: 'ok',
      [MOCK_IDS.metaCorrupt]: 'critical',
      [MOCK_IDS.mappingMissing]: 'warning',
      [MOCK_IDS.tfMissing]: 'critical',
      [MOCK_IDS.labeled]: 'ok',
      [MOCK_IDS.big]: 'ok',
    });
    expect((b.items as Body[])[0].id).toBe(MOCK_IDS.inProgress);
    expect(b.summary.counts).toMatchObject({
      critical: 3,
      warning: 2,
      unknown: 1,
      ok: 3,
    });
    expect(b.summary.trashCount).toBe(1);
    expect(b.summary.unrecognized.count).toBe(1);
    const labeled = (b.items as Body[]).find((i) => i.id === MOCK_IDS.labeled)!;
    expect(labeled.modifiedByDashboard).toBe(true);
    expect(labeled.resources.changedSinceExport).toBe(true);
    // 목록에 템플릿 원문 없음
    expect(JSON.stringify(b)).not.toContain('example-password');

    const f = await http()
      .get('/api/aws-snapshots?status=critical&q=업그레이드')
      .expect(200);
    expect((f.body as Body).filteredTotal).toBe(0);
  });

  it('상세·파일: 큰 파일은 편집 불가, mapping은 보기 전용 (AC-12, AC-32)', async () => {
    const d = (
      await http().get(`/api/aws-snapshots/${MOCK_IDS.big}`).expect(200)
    ).body as Body;
    const cfn = (d.snapshot.files as Body[]).find(
      (x) => x.kind === 'cloudformation',
    )!;
    expect(cfn.editable.reasonCode).toBe('FILE_TOO_LARGE');
    const map = (d.snapshot.files as Body[]).find((x) => x.kind === 'mapping')!;
    expect(map.editable.reasonCode).toBe('FILE_KIND_READ_ONLY');
    const inprog = (
      await http().get(`/api/aws-snapshots/${MOCK_IDS.inProgress}`).expect(200)
    ).body as Body;
    expect(inprog.snapshot.actions.delete.reasonCode).toBe(
      'EXPORT_MAYBE_IN_PROGRESS',
    );
    // 진행 중 판단 근거 시각 + 스냅샷별 CLI 안내 (frontend 요청)
    const ep = inprog.snapshot.exportInProgress;
    expect(ep).toMatchObject({
      active: true,
      metadataMissing: true,
      thresholdMinutes: 30,
    });
    expect(Date.parse(ep.untilAt) - Date.parse(ep.lastChangeAt)).toBe(
      30 * 60_000,
    );
    expect(inprog.cli.scan).toBe(
      `npm run scan --prefix deploy/aws-snapshot -- snapshots/${MOCK_IDS.inProgress}`,
    );
    expect(d.snapshot.exportInProgress).toMatchObject({
      active: false,
      metadataMissing: false,
      untilAt: null,
    });
    const sum = (await http().get('/api/aws-snapshots/summary').expect(200))
      .body as Body;
    expect(sum.cli.scan).toContain('snapshots/<id>');
    const file = await http()
      .get(`/api/aws-snapshots/${MOCK_IDS.secrets}/files/terraform`)
      .expect(200);
    expect(file.headers.etag).toBe(`"${(file.body as Body).version}"`);
    expect((file.body as Body).findings.length).toBeGreaterThan(0);
  });

  it('경로 탐색·형식 오류는 400, 값은 되풀이하지 않는다 (AC-40, AC-42)', async () => {
    // 클라이언트(WHATWG URL)가 %2e%2e·..를 정규화하지 않도록 원시 경로로 보낸다
    const server = (app.getHttpServer() as unknown as Server).listen(0);
    const port = (server.address() as AddressInfo).port;
    const raw = (path: string) =>
      new Promise<{ status: number; body: Body }>((ok, fail) => {
        const req = httpRequest(
          { host: '127.0.0.1', port, path, method: 'GET' },
          (res) => {
            let data = '';
            res.on('data', (c: Buffer) => (data += c.toString()));
            res.on('end', () =>
              ok({
                status: res.statusCode ?? 0,
                body: JSON.parse(data || '{}') as Body,
              }),
            );
          },
        );
        req.on('error', fail);
        req.end();
      });
    for (const p of [
      '/api/aws-snapshots/../../etc/passwd',
      '/api/aws-snapshots/..',
      '/api/aws-snapshots/%2e%2e',
      '/api/aws-snapshots/%2e%2e%2f%2e%2e%2fetc',
      `/api/aws-snapshots/${MOCK_IDS.secrets}/files/../../x`,
    ]) {
      const r = await raw(p);
      expect([p, r.status, r.body.code]).toEqual([p, 400, 'VALIDATION_FAILED']);
    }
    server.close();
    for (const p of [
      '/api/aws-snapshots/..%2F..%2Fetc',
      '/api/aws-snapshots/20260919-031500%00',
      '/api/aws-snapshots/..%5c..%5cwindows',
      '/api/aws-snapshots/abc',
      '/api/aws-snapshots/a/b/c/d/e',
      `/api/aws-snapshots/${MOCK_IDS.secrets}/files/secrets`,
      `/api/aws-snapshots/${MOCK_IDS.secrets}/files/..%2F.env`,
    ]) {
      const r = await http().get(p);
      expect([p, r.status]).toEqual([p, 400]);
      expect((r.body as Body).code).toBe('VALIDATION_FAILED');
    }
    await http()
      .put(`/api/aws-snapshots/${MOCK_IDS.secrets}/files/metadata`)
      .set('Origin', ORIGIN)
      .send({ content: '{}', baseVersion: `sha256:${'0'.repeat(64)}` })
      .expect(403);
  });

  it('쓰기 보호: 다른 Origin 403, JSON 아님 415 (계약 1.3)', async () => {
    const r1 = await http()
      .put(`/api/aws-snapshots/${MOCK_IDS.labeled}/notes`)
      .set('Origin', 'http://evil.example')
      .send({ label: 'x', memo: '', baseVersion: `sha256:${'0'.repeat(64)}` });
    expect(r1.status).toBe(403);
    expect((r1.body as Body).code).toBe('ORIGIN_NOT_ALLOWED');
    const r2 = await http()
      .post('/api/aws-snapshots/refresh')
      .set('Content-Type', 'text/plain')
      .send('x');
    expect(r2.status).toBe(415);
  });

  it('템플릿 저장: 409 충돌, 422 확인 필요, 확인 후 저장, 재스캔 (AC-22, AC-23, AC-30)', async () => {
    const url = `/api/aws-snapshots/${MOCK_IDS.secrets}/files/terraform`;
    const cur = (await http().get(url).expect(200)).body as Body;
    const edited = `${cur.content as string}# 편집\n`;

    const c = await put(url, {
      content: edited,
      baseVersion: `sha256:${'1'.repeat(64)}`,
    });
    expect(c.status).toBe(409);
    expect((c.body as Body).code).toBe('SNAPSHOT_VERSION_CONFLICT');

    const n = await put(url, { content: edited, baseVersion: cur.version });
    expect(n.status).toBe(422);
    expect((n.body as Body).code).toBe('SNAPSHOT_CONFIRMATION_REQUIRED');
    expect((n.body as Body).details.missing).toEqual(['secret_errors']);
    // 취소하면 파일 그대로
    expect(((await http().get(url)).body as Body).version).toBe(cur.version);

    const ok = await put(url, {
      content: edited,
      baseVersion: cur.version,
      confirm: ['secret_errors'],
    });
    expect(ok.status).toBe(200);
    const saved = ok.body as Body;
    expect(saved.saved).toBe(true);
    expect(saved.snapshot.status.status).toBe('critical');
    expect(saved.snapshot.modifiedByDashboard).toBe(true);

    // env-block 줄에 allow 주석 → 오류 줄어듦 (AC-25)
    const fixed = edited
      .replace('  environment {', '  environment { # snapshot-scan: allow')
      .replace('    variables = {', '    variables = { # snapshot-scan: allow');
    const r = await put(url, { content: fixed, baseVersion: saved.version });
    expect(r.status).toBe(200);
    expect((r.body as Body).rescan.before.errors).toBeGreaterThan(
      (r.body as Body).rescan.after.errors,
    );

    // 리소스 감소 확인 (AC-27)
    const fewer = fixed.replace(
      /resource "aws_subnet" "subnet_1" \{[\s\S]*?\}\n/,
      '',
    );
    const d = await put(url, {
      content: fewer,
      baseVersion: (r.body as Body).version,
    });
    expect(d.status).toBe(422);
    expect((d.body as Body).details.missing).toEqual(['resource_decrease']);
  });

  it('YAML 구문 오류는 확인 필요 (AC-26), 검사 API는 파일을 쓰지 않는다', async () => {
    const url = `/api/aws-snapshots/${MOCK_IDS.ok}/files/cloudformation`;
    const cur = (await http().get(url)).body as Body;
    const bad = `${cur.content as string}Bad:\n  a: 1\n b: 2\n`;
    const chk = await http()
      .post(`${url}/check`)
      .set('Origin', ORIGIN)
      .send({ content: bad })
      .expect(200);
    expect((chk.body as Body).check.syntax.errors[0].line).toBeGreaterThan(0);
    expect((chk.body as Body).check.confirmationsRequired).toContain(
      'yaml_syntax',
    );
    expect(((await http().get(url)).body as Body).version).toBe(cur.version);
  });

  it('mock conflict-once: 다음 저장 한 번 409 후 기본으로', async () => {
    const url = `/api/aws-snapshots/${MOCK_IDS.ok}/files/terraform`;
    const cur = (await http().get(url)).body as Body;
    svc.setScenario('conflict-once');
    const body = {
      content: `${cur.content as string}\n`,
      baseVersion: cur.version,
    };
    expect((await put(url, body)).status).toBe(409);
    expect(svc.currentScenario()).toBe('default');
    expect((await put(url, body)).status).toBe(200);
  });

  it('라벨·메모: 비밀값 422(규칙 ID만), 길이·allow 문구 400, 저장 (AC-34~36)', async () => {
    const url = `/api/aws-snapshots/${MOCK_IDS.ok}/notes`;
    const d = (await http().get(`/api/aws-snapshots/${MOCK_IDS.ok}`))
      .body as Body;
    const v = d.snapshot.notes.version as string;
    const s = await put(url, {
      label: 'x',
      memo: 'postgres://user:example-pass@host/db',
      baseVersion: v,
    });
    expect(s.status).toBe(422);
    expect((s.body as Body).details).toEqual({
      fields: ['memo'],
      rules: ['url-credentials'],
    });
    expect(JSON.stringify(s.body)).not.toContain('example-pass');

    const long = await put(url, {
      label: 'a'.repeat(61),
      memo: '',
      baseVersion: v,
    });
    expect(long.status).toBe(400);
    expect(JSON.stringify(long.body)).not.toContain('a'.repeat(61));
    const marker = await put(url, {
      label: 'ok',
      memo: 'x # snapshot-scan: allow',
      baseVersion: v,
    });
    expect(marker.status).toBe(400);

    const ok = await put(url, {
      label: '복원 기준',
      memo: '줄1\r\n줄2',
      baseVersion: v,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as Body).notes).toMatchObject({
      label: '복원 기준',
      memo: '줄1\n줄2',
      fileExists: true,
    });
    // 옛 버전으로 다시 저장 → 409
    expect(
      (await put(url, { label: 'y', memo: '', baseVersion: v })).status,
    ).toBe(409);
  });

  it('휴지통: 확인 불일치 400, 진행 중 409, 이동·복원·영구 삭제 (AC-37~39)', async () => {
    const id = MOCK_IDS.mappingMissing;
    await http()
      .delete(`/api/aws-snapshots/${id}?confirm=20260101-000000`)
      .set('Origin', ORIGIN)
      .expect(400);
    await http()
      .delete(
        `/api/aws-snapshots/${MOCK_IDS.inProgress}?confirm=${MOCK_IDS.inProgress}`,
      )
      .expect(409);
    const del = await http()
      .delete(`/api/aws-snapshots/${id}?confirm=${id}`)
      .expect(200);
    const trashId = (del.body as Body).trashItem.trashId as string;
    expect(trashId.startsWith(`${id}__`)).toBe(true);
    await http().get(`/api/aws-snapshots/${id}`).expect(404);
    const list = (await http().get('/api/aws-snapshots/trash').expect(200))
      .body as Body;
    expect(list.total).toBe(2);

    await http()
      .post(`/api/aws-snapshots/trash/${trashId}/restore`)
      .set('Origin', ORIGIN)
      .send({})
      .expect(200);
    await http().get(`/api/aws-snapshots/${id}`).expect(200);

    const del2 = await http()
      .delete(`/api/aws-snapshots/${id}?confirm=${id}`)
      .expect(200);
    const t2 = (del2.body as Body).trashItem.trashId as string;
    await http()
      .delete(`/api/aws-snapshots/trash/${t2}?confirm=${MOCK_IDS.ok}`)
      .expect(400);
    await http()
      .delete(`/api/aws-snapshots/trash/${t2}?confirm=${id}`)
      .expect(200);
    await http()
      .post(`/api/aws-snapshots/trash/${t2}/restore`)
      .send({})
      .expect(404);
  });

  it('읽기 전용·쓰기 꺼짐·설정 없음 시나리오 (AC-04, AC-45, AC-47)', async () => {
    svc.setScenario('read-only');
    const r = await http().delete(
      `/api/aws-snapshots/${MOCK_IDS.ok}?confirm=${MOCK_IDS.ok}`,
    );
    expect([r.status, (r.body as Body).code]).toEqual([
      403,
      'SNAPSHOT_READ_ONLY',
    ]);
    svc.setScenario('write-disabled');
    const w = await http().delete(
      `/api/aws-snapshots/${MOCK_IDS.ok}?confirm=${MOCK_IDS.ok}`,
    );
    expect((w.body as Body).code).toBe('SNAPSHOT_WRITE_DISABLED');
    svc.setScenario('not-configured');
    await svc.refresh();
    const s = (await http().get('/api/aws-snapshots').expect(200)).body as Body;
    expect(s.items).toEqual([]);
    expect(s.summary.status.reasons[0].code).toBe('SOURCE_NOT_CONFIGURED');
    expect(s.summary.root).toMatchObject({
      state: 'not_configured',
      configured: false,
    });
    expect(s.summary.root.setup.envVar).toBe('AWS_SNAPSHOT_DIR');
    await http().get(`/api/aws-snapshots/${MOCK_IDS.ok}`).expect(503);
  });

  it('reset: 편집·삭제가 원래 예시로 돌아간다 (AC-03)', async () => {
    const id = MOCK_IDS.ok;
    await http().delete(`/api/aws-snapshots/${id}?confirm=${id}`).expect(200);
    svc.setScenario('read-only');
    // MockScenarioService.reset과 같은 순서: 시나리오 → 데이터 (앞 refresh가 진행 중이어도 새 데이터를 읽어야 한다)
    svc.setScenario('default');
    svc.resetData();
    await svc.refresh();
    const l = (await http().get('/api/aws-snapshots').expect(200)).body as Body;
    expect(l.total).toBe(9);
    await http().get(`/api/aws-snapshots/${id}`).expect(200);
  });

  it('스캔 규칙 목록은 CLI에서 온다', async () => {
    const r = (await http().get('/api/aws-snapshots/scan-rules').expect(200))
      .body as Body;
    expect(r.allowMarker).toBe('snapshot-scan: allow');
    expect((r.rules as Body[]).map((x) => x.id)).toContain('env-block');
  });
});
