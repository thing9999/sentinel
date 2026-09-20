import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { parseAllDocuments } from 'yaml';
import { KIND_CATALOG, kindByGroupKind, resolveKind, splitApiVersion } from '../lib/kinds.mjs';
import { classifyPath, decodeFileName, encodeFileName, isRequestablePath, resourcePath } from '../lib/layout.mjs';
import { cleanObject, findRuntimeFields, isAutoCreated, orderKeys } from '../lib/rules.mjs';
import { collectSecretRefs } from '../lib/secret-refs.mjs';

describe('layout: 파일 이름 인코딩', () => {
  const cases = [
    ['api', 'api'],
    ['my.app-1', 'my.app-1'],
    ['system:foo', 'system~3Afoo'],
    ['Admin', '~41dmin'],
    ['nul', '~6Eul'],
    ['con.yaml-x', '~63on.yaml-x'],
    ['.hidden', '~2Ehidden'],
    ['a~b', 'a~7Eb'],
    ['한글', '~ED~95~9C~EA~B8~80'],
  ];
  for (const [name, enc] of cases) {
    it(`${name} → ${enc} → ${name}`, () => {
      assert.equal(encodeFileName(name), enc);
      assert.equal(decodeFileName(enc), name);
    });
  }
  it('인코딩 결과는 경로 규칙에 맞는다', () => {
    for (const [name] of cases) {
      const p = resourcePath({ namespace: 'prod', kindDir: 'roles', name });
      assert.deepEqual(classifyPath(p), { type: 'resource', namespace: 'prod', kindDir: 'roles', name });
    }
  });
});

describe('layout: 경로 규칙 (AC-K24)', () => {
  const ok = ['metadata.json', 'secret-refs.json', 'prod/namespace.yaml', 'prod/deployments/api.yaml', '_cluster/clusterroles/app-reader.yaml', 'prod/targetgroupbindings.elbv2.k8s.aws/tg.yaml'];
  const bad = [
    'notes.json',
    '../x.yaml',
    'prod/../etc/passwd',
    'prod/deployments/../../x.yaml',
    '/etc/passwd',
    'C:\\x.yaml',
    'prod\\deployments\\api.yaml',
    'prod/deployments/api.yml',
    'prod/deployments/.api.yaml',
    'Prod/deployments/api.yaml',
    'prod/deployments/a..b.yaml',
    'prod/deployments/api.yaml\u0000',
    'prod//api.yaml',
    'prod/deployments/sub/api.yaml',
    'prod/deployments/~ZZ.yaml',
    '.trash/x/metadata.json',
    '',
  ];
  for (const p of ok) it(`허용: ${p}`, () => assert.ok(isRequestablePath(p)));
  for (const p of bad) it(`거부: ${JSON.stringify(p)}`, () => assert.equal(isRequestablePath(p), false));
});

describe('kinds', () => {
  it('resolveKind: plural·단수·kind, 대소문자 무시', () => {
    assert.equal(resolveKind('Deployment').id, 'deployments');
    assert.equal(resolveKind('HPA'), null);
    assert.equal(resolveKind('horizontalpodautoscaler').id, 'horizontalpodautoscalers');
  });
  it('버전 무시하고 그룹+kind 로 찾는다', () => {
    assert.deepEqual(splitApiVersion('autoscaling/v1'), { group: 'autoscaling', version: 'v1' });
    assert.equal(kindByGroupKind('autoscaling', 'HorizontalPodAutoscaler').version, 'v2');
    assert.equal(kindByGroupKind('', 'Service').id, 'services');
  });
});

describe('rules', () => {
  it('cleanObject 는 입력을 바꾸지 않고, 두 번 적용해도 같다', () => {
    const o = { kind: 'Service', metadata: { name: 's', uid: 'u' }, spec: { clusterIP: '10.0.0.1', ports: [] }, status: {} };
    const snap = JSON.stringify(o);
    const c = cleanObject(o);
    assert.equal(JSON.stringify(o), snap);
    assert.deepEqual(cleanObject(c), c);
    assert.deepEqual(findRuntimeFields(o), ['status', 'metadata.uid', 'spec.clusterIP']);
    assert.deepEqual(findRuntimeFields(c), []);
  });
  it('isAutoCreated: 어노테이션 있는 default SA 는 사용자 것', () => {
    assert.equal(isAutoCreated({ kind: 'ServiceAccount', metadata: { name: 'default' } }), 'default');
    assert.equal(isAutoCreated({ kind: 'ServiceAccount', metadata: { name: 'default', annotations: { 'eks.amazonaws.com/role-arn': 'x' } } }), null);
  });
  it('orderKeys', () => {
    assert.deepEqual(Object.keys(orderKeys({ spec: 1, metadata: { labels: {}, name: 'a' }, kind: 'K', apiVersion: 'v1' })), ['apiVersion', 'kind', 'metadata', 'spec']);
  });
});

describe('secret-refs', () => {
  it('CronJob·projected·envFrom·Ingress TLS 참조', () => {
    const refs = collectSecretRefs([
      {
        kind: 'CronJob',
        metadata: { name: 'c', namespace: 'b' },
        spec: { jobTemplate: { spec: { template: { spec: { containers: [{ name: 'x', envFrom: [{ secretRef: { name: 's1' } }] }], volumes: [{ name: 'v', projected: { sources: [{ secret: { name: 's2' } }] } }] } } } } },
      },
      { kind: 'Ingress', metadata: { name: 'i', namespace: 'a' }, spec: { tls: [{ secretName: 'tls' }] } },
    ]);
    assert.deepEqual(refs.map((r) => `${r.namespace}/${r.secretName}:${r.referencedBy[0].via}`), [
      'a/tls:ingress.tls',
      'b/s1:envFrom.secretRef',
      'b/s2:volumes.projected.secret',
    ]);
  });
});

describe('rbac/export-readonly.yaml (내보내기 전용 역할 예시)', () => {
  const text = fs.readFileSync(new URL('../rbac/export-readonly.yaml', import.meta.url), 'utf8');
  const docs = parseAllDocuments(text).map((d) => d.toJS());
  const role = docs.find((d) => d?.kind === 'ClusterRole');
  it('동사는 get/list 만, secrets·pods·exec·watch 없음', () => {
    assert.ok(role);
    for (const r of role.rules) {
      assert.deepEqual([...r.verbs].sort(), ['get', 'list'], JSON.stringify(r));
      for (const bad of ['secrets', 'pods', 'pods/exec', 'pods/log', 'nodes/proxy', '*']) assert.ok(!r.resources.includes(bad), bad);
    }
  });
  it('종류 목록(기본·선택) 전부를 읽을 수 있다', () => {
    for (const k of KIND_CATALOG) {
      const hit = role.rules.find((r) => r.apiGroups.includes(k.group) && r.resources.includes(k.id));
      assert.ok(hit, k.id);
    }
  });
  it('대시보드 역할과 이름이 다르다 (sentinel-readonly 를 쓰지 않음)', () => {
    assert.equal(role.metadata.name, 'sentinel-snapshot-export');
    const binding = docs.find((d) => d?.kind === 'ClusterRoleBinding');
    assert.equal(binding.roleRef.name, 'sentinel-snapshot-export');
    assert.ok(binding.subjects.every((x) => x.kind !== 'ServiceAccount'));
  });
});
