import type { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Subject } from 'rxjs';
import type {
  KubeClientService,
  KubeWatcherService,
} from '../cluster/kube/kube-watcher.service';
import { buildMockWorld } from '../cluster/mock/mock-world';
import { ClusterStore } from '../cluster/state/cluster-store';
import { ApiException } from '../common/api-error';
import { SourceRegistry } from '../common/source-registry.service';
import type { EnvironmentVariables } from '../config/env.validation';
import { ClusterObjectSource } from './drift/cluster-object-source';
import { DriftService } from './drift/drift.service';
import { K8sGraphService } from './graph/graph.service';
import { buildMockClusterObjects } from './drift/mock-cluster-objects';
import { loadK8sLibs } from './k8s-libs';
import { buildK8sMockTrees, K8S_MOCK_IDS } from './k8s-mock-fixtures';
import { K8sSnapshotsService } from './k8s-snapshots.service';
import { MOCK_CLUSTER_ID } from './k8s.constants';

/**
 * live 모드 (파일 시스템). 예시 트리를 임시 폴더에 실제 파일로 써서 확인한다.
 * 드리프트의 클러스터 쪽은 informer 캐시 대역(cacheOf)만 읽는다 — API 클라이언트 호출 없음 (AC-K34).
 */
const repo = resolve(__dirname, '../../../..');
const scanLib = resolve(repo, 'deploy/aws-snapshot/lib');
const k8sLib = resolve(repo, 'deploy/k8s-snapshot/lib');

function config(values: Partial<Record<keyof EnvironmentVariables, unknown>>) {
  const all: Partial<Record<keyof EnvironmentVariables, unknown>> = {
    AWS_SNAPSHOT_LIB_DIR: scanLib,
    K8S_SNAPSHOT_LIB_DIR: k8sLib,
    K8S_SNAPSHOT_WRITE_ENABLED: true,
    K8S_SNAPSHOT_IN_PROGRESS_MIN: 30,
    K8S_SNAPSHOT_EDIT_MAX_BYTES: 5 * 1024 * 1024,
    K8S_SNAPSHOT_VIEW_MAX_BYTES: 20 * 1024 * 1024,
    K8S_SNAPSHOT_POLL_INTERVAL_SEC: 10,
    K8S_SNAPSHOT_DISPLAY_PATH: 'deploy/k8s-snapshot/snapshots',
    K8S_DRIFT_THROTTLE_SEC: 10,
    K8S_DRIFT_RECOMPUTE_SEC: 300,
    ...values,
  };
  return {
    get: (k: keyof EnvironmentVariables) => all[k],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

/** informer 캐시 대역 (원본 JSON, apiVersion/kind 없는 목록 항목) */
function fakeWatcher() {
  const w = buildMockWorld('mixed', Date.now());
  const objects = buildMockClusterObjects(w, MOCK_CLUSTER_ID);
  const calls: string[] = [];
  const watcher = {
    objectChanges$: new Subject<string>(),
    cacheOf: (name: string) => {
      calls.push(name);
      const list = objects.get(name);
      return list
        ? { list: () => list, synced: true, forbidden: false, connected: true }
        : null;
    },
  };
  const client = {
    kc: {
      getCurrentContext: () =>
        'arn:aws:eks:ap-northeast-2:123456789012:cluster/prod-eks',
    },
    clusterName: () => 'prod-eks',
  };
  return { watcher, client, calls };
}

async function writeTree(root: string): Promise<void> {
  const libs = await loadK8sLibs(scanLib, k8sLib);
  const trees = buildK8sMockTrees(libs.rules);
  for (const [id, snap] of trees.default.snapshots) {
    for (const [p, f] of snap.files) {
      const abs = join(root, id, ...p.split('/'));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.bytes);
      const t =
        typeof f.mtimeMs === 'number'
          ? f.mtimeMs
          : Date.now() - f.mtimeMs.ageMs;
      utimesSync(abs, t / 1000, t / 1000);
    }
  }
}

describe('K8sSnapshotsService (live, 파일 시스템)', () => {
  let root: string;
  let outside: string;
  let svc: K8sSnapshotsService | null = null;
  let drift: DriftService | null = null;
  let calls: string[] = [];

  async function make(
    values: Partial<Record<keyof EnvironmentVariables, unknown>> = {},
  ) {
    const registry = new SourceRegistry('live');
    registry.update('kube', { state: 'ok', error: null });
    const fw = fakeWatcher();
    calls = fw.calls;
    const src = new ClusterObjectSource(
      'live',
      registry,
      new ClusterStore(),
      fw.watcher as unknown as KubeWatcherService,
      fw.client as unknown as KubeClientService,
    );
    const cfg = config({ K8S_SNAPSHOT_DIR: root, ...values });
    drift = new DriftService('live', src, cfg);
    svc = new K8sSnapshotsService(
      'live',
      registry,
      drift,
      new K8sGraphService(drift, cfg),
      src,
      cfg,
    );
    svc.onApplicationBootstrap();
    await svc.whenReady();
    return svc;
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'sentinel-k8s-live-'));
    outside = mkdtempSync(join(tmpdir(), 'sentinel-k8s-outside-'));
    await writeTree(root);
    writeFileSync(join(root, '.gitkeep'), '');
    mkdirSync(join(root, '.20260919-070000.partial'));
  });

  afterEach(() => {
    svc?.onModuleDestroy();
    drift?.onModuleDestroy();
    svc = null;
    drift = null;
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('CLI 재스캔(scanPaths profile k8s)과 대시보드 스캔 결과가 같다 (AC-K14)', async () => {
    const s = await make();
    const scan = (await import(
      pathToFileURL(join(scanLib, 'scan.mjs')).href
    )) as {
      scanPaths(
        p: string[],
        o: { profile: 'k8s' },
      ): {
        findings: {
          file: string;
          line: number;
          rule: string;
          severity: string;
        }[];
      };
    };
    const list = await s.list({});
    expect(list.items).toHaveLength(10);
    for (const id of Object.values(K8S_MOCK_IDS).filter(
      (x) => x !== K8S_MOCK_IDS.trashed,
    )) {
      const dir = join(root, id);
      const cli = scan
        .scanPaths([dir], { profile: 'k8s' })
        .findings.map(
          (f) =>
            `${relative(dir, f.file).split(sep).join('/')}:${f.line}:${f.rule}:${f.severity}`,
        )
        .sort();
      const d = await s.detail(id);
      const mine = d.snapshot.scan.current.findings
        .map((f) => `${f.file}:${f.line}:${f.rule}:${f.severity}`)
        .sort();
      expect([id, mine]).toEqual([id, cli]);
    }
  });

  it('.gitkeep·.<id>.partial 은 목록·예상 밖 항목에 넣지 않는다, 루트 링크는 unrecognized', async () => {
    symlinkSync(outside, join(root, '20260101-000000'), 'junction');
    const s = await make();
    const sum = await s.getSummary();
    expect(sum.summary.unrecognized.names).toEqual(['20260101-000000']);
    expect((await s.list({})).items.map((i) => i.id)).not.toContain(
      '20260101-000000',
    );
  });

  it('스냅샷 안 중간 폴더가 링크면 따라가지 않고 403 (AC-K24)', async () => {
    const id = K8S_MOCK_IDS.latest;
    writeFileSync(join(outside, 'api.yaml'), 'apiVersion: v1\nkind: Secret\n');
    rmSync(join(root, id, 'prod', 'deployments'), { recursive: true });
    symlinkSync(outside, join(root, id, 'prod', 'deployments'), 'junction');
    const s = await make();
    await expect(s.file(id, 'prod/deployments/api.yaml')).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          code: 'SNAPSHOT_PATH_REJECTED',
        }) as unknown,
      },
    );
    const d = await s.detail(id);
    expect(d.snapshot.status.reasons.map((r) => r.code)).toContain(
      'UNEXPECTED_FILES',
    );
    expect(
      d.snapshot.files.some((f) => f.path.startsWith('prod/deployments/')),
    ).toBe(false);
  });

  it('저장: 원자적 쓰기(임시 파일 없음), CRLF 유지, notes.json fileEdits, 드리프트 재계산', async () => {
    const id = K8S_MOCK_IDS.latest;
    const abs = join(root, id, 'prod', 'services', 'web.yaml');
    writeFileSync(abs, readFileSync(abs, 'utf8').replace(/\n/g, '\r\n'));
    const s = await make();
    const cur = await s.file(id, 'prod/services/web.yaml');
    expect(cur.eol).toBe('crlf');
    const r = await s.save(id, 'prod/services/web.yaml', {
      content: cur.content.replace('port: 80', 'port: 8080'),
      baseVersion: cur.version,
    });
    expect(r.saved).toBe(true);
    expect(r.driftRecompute).toBe('scheduled');
    const text = readFileSync(abs, 'utf8');
    expect(text).toContain('port: 8080\r\n');
    expect(
      readdirSync(dirname(abs)).filter((n) => n.includes('sentinel-tmp')),
    ).toEqual([]);
    const notes = JSON.parse(
      readFileSync(join(root, id, 'notes.json'), 'utf8'),
    ) as { fileEdits: Record<string, { version: string }> };
    expect(notes.fileEdits['prod/services/web.yaml'].version).toBe(r.version);
    const dr = await s.getDrift(id);
    expect(
      dr.resources.find((x) => x.key === 'core/Service/prod/web')?.change,
    ).toBe('changed');
    // 409: 다른 곳에서 바뀜
    writeFileSync(abs, 'changed elsewhere\n');
    await expect(
      s.save(id, 'prod/services/web.yaml', {
        content: 'x: 1\n',
        baseVersion: r.version,
      }),
    ).rejects.toBeInstanceOf(ApiException);
  });

  it('휴지통: 폴더 이동·복원·영구 삭제가 실제 폴더에서 일어난다', async () => {
    const s = await make();
    const id = K8S_MOCK_IDS.staging;
    const del = await s.moveToTrash(id, id);
    const trashId = del.trashItem!.trashId;
    expect(existsSync(join(root, '.trash', trashId, 'metadata.json'))).toBe(
      true,
    );
    expect(existsSync(join(root, id))).toBe(false);
    await s.restore(trashId);
    expect(existsSync(join(root, id, 'metadata.json'))).toBe(true);
    const again = await s.moveToTrash(id, id);
    await s.purge(again.trashItem!.trashId, id);
    expect(existsSync(join(root, '.trash', again.trashItem!.trashId))).toBe(
      false,
    );
  });

  it('드리프트: informer 캐시만 읽는다, 컨텍스트 이름은 ARN 이면 클러스터 이름만 (AC-K34)', async () => {
    const s = await make();
    const sum = await s.getSummary();
    expect(sum.summary.dashboardCluster).toMatchObject({
      state: 'ok',
      id: MOCK_CLUSTER_ID,
      context: 'prod-eks',
    });
    expect(sum.summary.latestDrift?.snapshotId).toBe(K8S_MOCK_IDS.latest);
    expect(sum.summary.latestDrift?.drift.status.reasons[0].text).toBe(
      '차이 3건 (변경 1 · 삭제 1 · 추가 1)',
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        'namespaces',
        'deployments',
        'horizontalpodautoscalers',
      ]),
    );
  });

  it('설정 없음 → not_configured, 규칙 lib 없음 → unavailable (K8S_RULES_UNAVAILABLE)', async () => {
    const a = await make({ K8S_SNAPSHOT_DIR: undefined });
    expect((await a.getSummary()).summary.root.state).toBe('not_configured');
    a.onModuleDestroy();
    const b = await make({ K8S_SNAPSHOT_LIB_DIR: join(outside, 'nope') });
    const sum = await b.getSummary();
    expect(sum.summary.root.state).toBe('unavailable');
    expect(sum.summary.status.reasons[0].text).toContain(
      'K8S_SNAPSHOT_LIB_DIR',
    );
    const items = (await b.list({})).items;
    expect(items).toEqual([]);
  });
});
