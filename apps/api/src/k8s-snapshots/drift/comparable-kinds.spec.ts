import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAllDocuments } from 'yaml';
import { COMPARABLE_KINDS } from './comparable-kinds';

/**
 * 비교 가능 종류 = 대시보드 RBAC(get/list/watch) ∩ informer (docs/api/k8s-snapshot.md 10.2, AC-K33).
 * deploy/rbac.yaml 에서 빠지거나 informer 경로가 바뀌면 이 테스트가 실패한다. RBAC 는 늘리지 않는다.
 */
const repo = resolve(__dirname, '../../../../..');

interface Rule {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
}

function clusterRoleRules(): Rule[] {
  const text = readFileSync(resolve(repo, 'deploy/rbac.yaml'), 'utf8');
  const docs = parseAllDocuments(text).map(
    (d) => d.toJS() as Record<string, unknown> | null,
  );
  const role = docs.find(
    (d) =>
      d?.kind === 'ClusterRole' &&
      (d.metadata as { name?: string })?.name === 'sentinel-readonly',
  );
  expect(role).toBeTruthy();
  return (role!.rules as Rule[]) ?? [];
}

describe('COMPARABLE_KINDS', () => {
  const rules = clusterRoleRules();

  it.each(COMPARABLE_KINDS.map((k) => [k.id, k] as const))(
    '%s: rbac.yaml 에 get/list/watch 가 있다',
    (_id, k) => {
      const hit = rules.find(
        (r) =>
          r.apiGroups.includes(k.apiGroup) &&
          r.resources.includes(k.rbacResource),
      );
      expect(hit).toBeTruthy();
      for (const v of ['get', 'list', 'watch']) expect(hit!.verbs).toContain(v);
    },
  );

  it('rbac.yaml 은 읽기 동사만, secrets·configmaps 없음 (RBAC 를 늘리지 않음)', () => {
    for (const r of rules) {
      expect(r.verbs.every((v) => ['get', 'list', 'watch'].includes(v))).toBe(
        true,
      );
      expect(r.resources).not.toContain('secrets');
      expect(r.resources).not.toContain('configmaps');
    }
  });

  it('informer 경로가 KubeWatcherService 와 같다 (id = informer 이름)', () => {
    const src = readFileSync(
      resolve(repo, 'apps/api/src/cluster/kube/kube-watcher.service.ts'),
      'utf8',
    );
    for (const k of COMPARABLE_KINDS) {
      expect(src).toContain(`'${k.id}'`);
      expect(src).toContain(`'${k.informerPath}'`);
    }
  });

  it('apiVersion 은 CLI 종류 목록과 같다 (버전이 다르면 가짜 차이)', async () => {
    const kinds = (await import(
      pathToFileURL(resolve(repo, 'deploy/k8s-snapshot/lib/kinds.mjs')).href
    )) as {
      kindById(id: string): {
        apiVersion: string;
        kind: string;
        dashboardComparable: boolean;
      } | null;
    };
    for (const k of COMPARABLE_KINDS) {
      const e = kinds.kindById(k.id);
      expect(e?.apiVersion).toBe(k.apiVersion);
      expect(e?.kind).toBe(k.kind);
      expect(e?.dashboardComparable).toBe(true);
    }
  });
});
