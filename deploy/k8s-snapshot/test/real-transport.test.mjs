// 실제 전송 계층(realTransport: KubeConfig 인증 + client-node HTTP)을 로컬 가짜 API 서버에 대고 돌린다.
// 실제 클러스터는 호출하지 않는다. kubeconfig 는 임시 파일.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { EXIT, runExport } from '../export.mjs';
import { makeCluster } from './fixtures/fake-cluster.mjs';

describe('realTransport + 가짜 API 서버', () => {
  let server;
  let tmp;
  const seen = [];
  const cluster = makeCluster();

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k8s-real-'));
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization ?? null });
      const r = await cluster.transport({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) });
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body ?? {}));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    fs.writeFileSync(
      path.join(tmp, 'kubeconfig'),
      [
        'apiVersion: v1',
        'kind: Config',
        'clusters:',
        `- name: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod-eks`,
        '  cluster:',
        `    server: http://127.0.0.1:${port}`,
        '    insecure-skip-tls-verify: true',
        'users:',
        '- name: exporter',
        '  user:',
        '    token: test-token-value',
        'contexts:',
        '- name: sentinel-snapshot',
        '  context:',
        '    cluster: arn:aws:eks:ap-northeast-2:123456789012:cluster/prod-eks',
        '    user: exporter',
        'current-context: some-other-context',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(path.join(tmp, 'x.env'), '');
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('내보내기 성공, 요청은 모두 GET, 토큰은 헤더로만, metadata 에 계정 ID·서버 주소 없음', async () => {
    let out = '';
    let err = '';
    const code = await runExport({
      argv: ['--config', path.join(tmp, 'x.env'), '--kubeconfig', path.join(tmp, 'kubeconfig'), '--context', 'sentinel-snapshot', '--out-dir', path.join(tmp, 'snapshots')],
      processEnv: {},
      now: () => new Date('2026-09-19T07:00:00Z'),
      stdout: { write: (s) => (out += s) },
      stderr: { write: (s) => (err += s) },
      baseDir: tmp,
    });
    assert.equal(code, EXIT.OK, err + out);
    assert.ok(seen.length > 5);
    for (const r of seen) {
      assert.equal(r.method, 'GET');
      assert.equal(r.auth, 'Bearer test-token-value');
      for (const k of Object.keys(r.query)) assert.ok(['limit', 'continue'].includes(k));
    }
    const meta = fs.readFileSync(path.join(tmp, 'snapshots', '20260919-070000', 'metadata.json'), 'utf8');
    const m = JSON.parse(meta);
    assert.equal(m.cluster.name, 'prod-eks');
    assert.equal(m.cluster.context, 'sentinel-snapshot');
    for (const s of ['123456789012', '127.0.0.1', 'test-token-value', 'kubeconfig']) assert.ok(!meta.includes(s), s);
    assert.ok(!out.includes('test-token-value'));
  });
});
