import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parse } from 'yaml';
import { scanPaths } from '../../aws-snapshot/lib/scan.mjs';
import { EXIT, runExport } from '../export.mjs';
import { baseObjects, fakeInspect, makeCluster } from './fixtures/fake-cluster.mjs';

const sink = () => {
  let buf = '';
  return { write: (s) => (buf += s), text: () => buf };
};

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k8s-export-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function run({ argv = [], env = {}, cluster = makeCluster(), now = new Date('2026-09-19T06:10:00Z'), inspect = fakeInspect() } = {}) {
  const out = sink();
  const err = sink();
  let factoryCalls = 0;
  const code = await runExport({
    argv: ['--config', path.join(tmp, 'none.env'), '--out-dir', path.join(tmp, 'snapshots'), ...argv],
    processEnv: { KUBE_CONTEXT: 'sentinel-snapshot', ...env },
    transportFactory: async () => {
      factoryCalls++;
      return cluster.transport;
    },
    inspect,
    now: () => now,
    stdout: out,
    stderr: err,
    baseDir: tmp,
  });
  return { code, out: out.text(), err: err.text(), cluster, factoryCalls };
}

const emptyOut = () => !fs.existsSync(path.join(tmp, 'snapshots')) || fs.readdirSync(path.join(tmp, 'snapshots')).length === 0;
const snapDir = (id = '20260919-061000') => path.join(tmp, 'snapshots', id);
const readYaml = (rel, id) => parse(fs.readFileSync(path.join(snapDir(id), ...rel.split('/')), 'utf8'));
const allFiles = (dir) => {
  const out = [];
  const walk = (d, rel) => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      const r = rel ? `${rel}/${n}` : n;
      if (fs.statSync(p).isDirectory()) walk(p, r);
      else out.push(r);
    }
  };
  walk(dir, '');
  return out;
};

beforeEach(() => fs.writeFileSync(path.join(tmp, 'none.env'), ''));

describe('설정 (종료코드 2)', () => {
  it('AC-K01 컨텍스트 없음 → 2, 클러스터 호출 없음, 폴더 없음 (current-context 를 쓰지 않음)', async () => {
    const r = await run({ env: { KUBE_CONTEXT: '' } });
    assert.equal(r.code, EXIT.CONFIG);
    assert.equal(r.factoryCalls, 0);
    assert.equal(r.cluster.calls.length, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'snapshots')), false);
  });
  it('kubeconfig 에 없는 컨텍스트 → 2', async () => {
    const r = await run({ inspect: fakeInspect(['other']) });
    assert.equal(r.code, EXIT.CONFIG);
    assert.equal(r.cluster.calls.length, 0);
  });
  it('AC-K03 모르는 종류 / 포함·제외 동시 / 잘못된 사용자 지정 이름 → 2', async () => {
    assert.equal((await run({ env: { SNAPSHOT_OPTIONAL_KINDS: 'widgets' } })).code, EXIT.CONFIG);
    assert.equal((await run({ env: { SNAPSHOT_NAMESPACES: 'a', SNAPSHOT_EXCLUDE_NAMESPACES: 'b' } })).code, EXIT.CONFIG);
    assert.equal((await run({ env: { SNAPSHOT_CUSTOM_RESOURCES: 'Widgets' } })).code, EXIT.CONFIG);
    assert.equal((await run({ argv: ['--exclude-kinds', 'jobs'] })).code, EXIT.CONFIG);
  });
  it('종류 이름은 대소문자·단수형·kind 를 받는다', async () => {
    const r = await run({ argv: ['--dry-run'], env: { SNAPSHOT_OPTIONAL_KINDS: 'Job,clusterrole,StorageClasses' } });
    assert.equal(r.code, EXIT.OK);
    assert.match(r.out, /"jobs"/);
    assert.match(r.out, /"clusterroles"/);
    assert.match(r.out, /"storageclasses"/);
  });
  it('플래그가 .env 보다, .env 가 셸 환경변수보다 우선', async () => {
    fs.writeFileSync(path.join(tmp, 'none.env'), 'KUBE_CONTEXT=from-file\n');
    const r = await run({ argv: ['--dry-run'], env: { KUBE_CONTEXT: 'from-shell' }, inspect: fakeInspect(['from-file', 'from-flag']) });
    assert.match(r.out, /"context": "from-file"/);
    const r2 = await run({ argv: ['--dry-run', '--context', 'from-flag'], inspect: fakeInspect(['from-file', 'from-flag']) });
    assert.match(r2.out, /"context": "from-flag"/);
  });
});

describe('dry-run', () => {
  it('AC-K02 설정·범위·종류·API 목록을 출력하고 클러스터 호출·파일 생성이 없다', async () => {
    const r = await run({ argv: ['--dry-run'] });
    assert.equal(r.code, EXIT.OK);
    assert.equal(r.factoryCalls, 0);
    assert.equal(r.cluster.calls.length, 0);
    assert.equal(fs.existsSync(path.join(tmp, 'snapshots')), false);
    assert.match(r.out, /sentinel-snapshot/);
    assert.match(r.out, /all_except_system/);
    assert.match(r.out, /GET \/apis\/apps\/v1\/namespaces\/<ns>\/deployments/);
  });
});

describe('내보내기', () => {
  it('AC-K04 정상 → 0, 구조(리소스 1개 = 파일 1개), metadata.json', async () => {
    const r = await run();
    assert.equal(r.code, EXIT.OK, r.err + r.out);
    const files = allFiles(snapDir());
    assert.ok(files.includes('metadata.json'));
    assert.ok(files.includes('secret-refs.json'));
    assert.ok(files.includes('prod/namespace.yaml'));
    assert.ok(files.includes('prod/deployments/api.yaml'));
    assert.ok(files.includes('data/statefulsets/postgres.yaml'));
    assert.ok(files.includes('data/services/postgres.yaml'));
    assert.ok(files.includes('prod/ingresses/web.yaml'));
    assert.ok(files.includes('prod/configmaps/api-config.yaml'));
    assert.ok(files.includes('prod/roles/~52eader~3A~41ll.yaml'), files.join('\n'));
    const meta = JSON.parse(fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8'));
    assert.equal(meta.schemaVersion, 1);
    assert.equal(meta.snapshotId, '20260919-061000');
    assert.equal(meta.cluster.id, '7d0c2b1e-3f4a-4c5b-8d6e-9f0a1b2c3d4e');
    assert.equal(meta.cluster.context, 'sentinel-snapshot');
    assert.equal(meta.cluster.name, 'prod-eks');
    assert.equal(meta.cluster.serverVersion, 'v1.34.1-eks-8a2c1f0');
    assert.equal(meta.cleanup.rulesVersion, 1);
    assert.equal(meta.secretScan.passed, true);
    // 회귀: 완성된 폴더를 다시 스캔해도(npm run scan·대시보드) 발견이 없어야 한다.
    // metadata.json 의 정리 규칙 요약에 든 last-applied 어노테이션 이름이 k8s-last-applied 경고를 내던 문제
    const rescan = scanPaths([snapDir()], { profile: 'k8s' });
    assert.deepEqual(rescan.findings.map((f) => `${path.basename(f.file)}:${f.rule}`), []);
    assert.equal(meta.kinds.deployments.result, 'ok');
    assert.equal(meta.resources.total, files.filter((f) => f.endsWith('.yaml')).length);
    assert.equal(fs.readdirSync(path.join(tmp, 'snapshots')).some((n) => n.endsWith('.partial')), false);
  });

  it('AC-K05 정리 규칙: 런타임 필드 제거, 헤드리스 clusterIP None 유지', async () => {
    await run();
    const d = readYaml('prod/deployments/api.yaml');
    assert.equal(d.apiVersion, 'apps/v1');
    assert.equal(d.kind, 'Deployment');
    assert.equal(d.status, undefined);
    for (const f of ['uid', 'resourceVersion', 'generation', 'creationTimestamp', 'managedFields']) assert.equal(d.metadata[f], undefined, f);
    assert.deepEqual(d.metadata.annotations, { 'team/owner': 'app' });
    assert.equal(d.spec.template.metadata.creationTimestamp, undefined);
    assert.equal(d.spec.template.spec.terminationGracePeriodSeconds, undefined); // 기본값 필드는 있는 그대로 (없던 것은 만들지 않음)
    assert.equal(d.spec.template.spec.restartPolicy, 'Always'); // 기본값 필드는 지우지 않는다
    const api = readYaml('prod/services/api.yaml');
    assert.equal(api.spec.clusterIP, undefined);
    assert.equal(api.spec.clusterIPs, undefined);
    const pg = readYaml('data/services/postgres.yaml');
    assert.equal(pg.spec.clusterIP, 'None');
    const pvc = readYaml('data/persistentvolumeclaims/data-postgres-0.yaml');
    assert.equal(pvc.spec.volumeName, undefined);
    assert.equal(pvc.metadata.annotations, undefined);
    assert.equal(pvc.metadata.finalizers, undefined);
    const sts = readYaml('data/statefulsets/postgres.yaml');
    assert.equal(sts.spec.volumeClaimTemplates[0].status, undefined);
    const ns = readYaml('prod/namespace.yaml');
    assert.deepEqual(ns.metadata.labels, { team: 'app' });
    assert.equal(ns.spec, undefined);
    const ing = readYaml('prod/ingresses/web.yaml');
    assert.equal(ing.metadata.finalizers, undefined);
    const sa = readYaml('prod/serviceaccounts/api.yaml');
    assert.equal(sa.secrets, undefined);
    // 키 순서
    const text = fs.readFileSync(path.join(snapDir(), 'prod', 'deployments', 'api.yaml'), 'utf8');
    assert.match(text, /^apiVersion: apps\/v1\nkind: Deployment\nmetadata:\n {2}name: api\n {2}namespace: prod\n/);
  });

  it('AC-K06 Secret·ReplicaSet·소유자 있는 Job·자동 생성 객체·시스템 네임스페이스가 없다', async () => {
    await run({ env: { SNAPSHOT_OPTIONAL_KINDS: 'jobs' } });
    const files = allFiles(snapDir());
    assert.ok(!files.some((f) => f.includes('/secrets/') || f.includes('replicasets') || f.includes('/jobs/')), files.join('\n'));
    assert.ok(!files.some((f) => f.includes('kube-root-ca')));
    assert.ok(!files.includes('default/services/kubernetes.yaml'));
    assert.ok(!files.includes('prod/serviceaccounts/default.yaml'));
    assert.ok(!files.some((f) => f.startsWith('kube-system/')));
    assert.ok(!files.some((f) => f.includes('system~3A')));
    const meta = JSON.parse(fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8'));
    assert.equal(meta.resources.excludedByRule.configmaps.autoCreated, 2);
    assert.deepEqual(meta.resources.excludedByRule.configmaps.autoCreatedNames, ['kube-root-ca.crt']);
    assert.equal(meta.resources.excludedByRule.jobs.owned, 1);
    assert.equal(meta.secrets.read, false);
  });

  it('Secret 목록·watch·쓰기 요청을 하지 않는다 (AC-K13: 모든 요청이 GET, 쿼리는 limit·continue 뿐)', async () => {
    const r = await run({ env: { SNAPSHOT_OPTIONAL_KINDS: 'jobs,clusterroles,storageclasses' } });
    assert.equal(r.code, EXIT.OK);
    assert.ok(r.cluster.calls.length > 10);
    const files = allFiles(snapDir());
    assert.ok(files.includes('_cluster/clusterroles/app-reader.yaml'));
    assert.ok(files.includes('_cluster/storageclasses/gp3.yaml'));
    assert.ok(!files.some((f) => f.includes('system~3Anode') || f.endsWith('/view.yaml')));
    for (const c of r.cluster.calls) {
      assert.equal(c.method, 'GET');
      for (const k of Object.keys(c.query)) assert.ok(['limit', 'continue'].includes(k), k);
      assert.ok(!/secrets|watch|dryRun|exec|log|proxy/i.test(c.path), c.path);
    }
  });

  it('secret-refs.json: 참조 이름만 (값 없음)', async () => {
    await run();
    const refs = JSON.parse(fs.readFileSync(path.join(snapDir(), 'secret-refs.json'), 'utf8'));
    const names = refs.secrets.map((s) => `${s.namespace}/${s.secretName}`);
    assert.deepEqual(names, ['prod/ecr-pull', 'prod/pg-credentials', 'prod/web-tls']);
    const pg = refs.secrets.find((s) => s.secretName === 'pg-credentials');
    assert.deepEqual(pg.keys, ['password']);
    assert.equal(pg.referencedBy[0].via, 'env.valueFrom.secretKeyRef');
    assert.ok(!JSON.stringify(refs).includes('ZXhhbXBsZQ=='));
  });

  it('AC-K07 변경 없이 두 번 내보내면 리소스 파일이 같다', async () => {
    await run({ now: new Date('2026-09-19T06:10:00Z') });
    await run({ now: new Date('2026-09-19T06:20:00Z') });
    const a = snapDir('20260919-061000');
    const b = snapDir('20260919-062000');
    const fa = allFiles(a).filter((f) => f !== 'metadata.json' && f !== 'secret-refs.json');
    assert.deepEqual(fa, allFiles(b).filter((f) => f !== 'metadata.json' && f !== 'secret-refs.json'));
    for (const f of fa) assert.equal(fs.readFileSync(path.join(a, f), 'utf8'), fs.readFileSync(path.join(b, f), 'utf8'), f);
  });

  it('AC-K08 네임스페이스 설정 비움 → 시스템 제외, 범위 규칙과 실제 목록 기록', async () => {
    await run();
    const meta = JSON.parse(fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8'));
    assert.equal(meta.scope.namespaces.mode, 'all_except_system');
    assert.ok(meta.scope.namespaces.system.includes('kube-system'));
    assert.deepEqual(meta.scope.exported, ['data', 'default', 'prod']);
  });

  it('포함 목록: 없는 네임스페이스는 경고 + missing, 시스템 네임스페이스는 경고 후 포함', async () => {
    const r = await run({ env: { SNAPSHOT_NAMESPACES: 'prod,ghost,kube-system' } });
    assert.equal(r.code, EXIT.OK, r.err);
    assert.match(r.err, /ghost/);
    const meta = JSON.parse(fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8'));
    assert.deepEqual(meta.scope.missing, ['ghost']);
    assert.deepEqual(meta.scope.namespaces.systemIncluded, ['kube-system']);
    assert.deepEqual(meta.scope.exported, ['kube-system', 'prod']);
  });

  it('AC-K09 env POSTGRES_PASSWORD 리터럴 → 1, 폴더 남음, 출력에 값 원문 없음', async () => {
    const objects = baseObjects();
    objects['apps/v1/statefulsets'][0].spec.template.spec.containers[0].env.push({ name: 'POSTGRES_PASSWORD', value: 'example-password' });
    const r = await run({ cluster: makeCluster({ objects }) });
    assert.equal(r.code, EXIT.SECRETS_FOUND);
    assert.ok(fs.existsSync(path.join(snapDir(), 'metadata.json')));
    assert.match(r.out, /k8s-env-literal/);
    assert.ok(!r.out.includes('example-password'));
    assert.ok(!r.err.includes('example-password'));
    const meta = JSON.parse(fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8'));
    assert.equal(meta.secretScan.passed, false);
    assert.deepEqual(meta.secretScan.rules, ['k8s-env-literal']);
  });

  it('AC-K10 일부 종류 권한 없음 → 4, 폴더 남음, metadata.kinds forbidden', async () => {
    const r = await run({ cluster: makeCluster({ forbidden: ['networking.k8s.io/v1/networkpolicies'] }) });
    assert.equal(r.code, EXIT.PARTIAL);
    const meta = JSON.parse(fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8'));
    assert.equal(meta.kinds.networkpolicies.result, 'forbidden');
    assert.deepEqual(meta.kinds.networkpolicies.forbiddenNamespaces, ['data', 'default', 'prod']);
  });

  it('비밀값(1)과 부분 성공(4)이 겹치면 1', async () => {
    const objects = baseObjects();
    objects['v1/configmaps'][2].data.API_TOKEN = 'plain-token-value';
    const r = await run({ cluster: makeCluster({ objects, forbidden: ['networking.k8s.io/v1/networkpolicies'] }) });
    assert.equal(r.code, EXIT.SECRETS_FOUND);
  });

  it('사용자 지정 리소스가 클러스터에 없으면 not_found → 4', async () => {
    const r = await run({ env: { SNAPSHOT_CUSTOM_RESOURCES: 'targetgroupbindings.elbv2.k8s.aws' } });
    assert.equal(r.code, EXIT.PARTIAL);
    const meta = JSON.parse(fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8'));
    assert.equal(meta.kinds['targetgroupbindings.elbv2.k8s.aws'].result, 'not_found');
  });

  it('AC-K11 접속 실패 → 3, 폴더 없음, 출력에 서버 URL·토큰 없음', async () => {
    const r = await run({ cluster: makeCluster({ fail: true }) });
    assert.equal(r.code, EXIT.CLUSTER);
    assert.ok(emptyOut());
    assert.ok(!r.err.includes('10.0.0.1'));
    assert.ok(!r.err.includes('abc'));
  });

  it('AC-K11 리소스 0개 → 3, 폴더 없음', async () => {
    const r = await run({ env: { SNAPSHOT_NAMESPACES: 'ghost' } });
    assert.equal(r.code, EXIT.CLUSTER);
    assert.ok(emptyOut());
  });

  it('kube-system 을 읽을 권한 없음 → 3', async () => {
    const r = await run({ cluster: makeCluster({ forbidden: ['kube-system'] }) });
    assert.equal(r.code, EXIT.CLUSTER);
    assert.ok(emptyOut());
  });

  it('AC-K12 metadata·출력에 kubeconfig 경로·로컬 절대경로·계정 ID 가 없다', async () => {
    const r = await run({ argv: ['--kubeconfig', path.join(tmp, 'secret-kubeconfig')] });
    const meta = fs.readFileSync(path.join(snapDir(), 'metadata.json'), 'utf8');
    for (const s of [tmp, 'secret-kubeconfig', os.homedir(), '123456789012', 'https://']) {
      assert.ok(!meta.includes(s), s);
      assert.ok(!r.out.includes(s), s);
    }
  });
});
