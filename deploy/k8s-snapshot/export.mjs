#!/usr/bin/env node
// 쿠버네티스 리소스를 다시 적용할 수 있는 YAML 로 내보낸다 (대시보드 밖 사람용 도구, 읽기 전용).
// docs/api/k8s-snapshot.md 3~4절, docs/specs/k8s-snapshot.md 3절.
//
//   npm run export:dry --prefix deploy/k8s-snapshot   # 설정 해석 결과만 (클러스터 호출·파일 생성 없음)
//   npm run export --prefix deploy/k8s-snapshot
//
// 종료코드: 0 성공 / 1 비밀값 의심(커밋 금지) / 2 설정 오류 / 3 접속 실패·권한 없음·0개 / 4 부분 성공 / 99 내부 오류
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPaths, summarize, formatFindings } from '../aws-snapshot/lib/scan.mjs';
import { ConfigError, parseCli, parseEnvText, resolveConfig } from './lib/config.mjs';
import { customKind, KIND_CATALOG, kindById, listPath } from './lib/kinds.mjs';
import {
  clusterDisplayName,
  createClient,
  inspectKubeconfig,
  KubeConnectError,
  KubeHttpError,
  realTransport,
  sanitizeMessage,
} from './lib/kube.mjs';
import { METADATA_FILE, resourcePath, SECRET_REFS_FILE } from './lib/layout.mjs';
import { buildMetadata, snapshotIdOf } from './lib/meta.mjs';
import { cleanObject, CLEANUP_RULES_VERSION, isAlwaysExcluded, isAutoCreated, isHelmManaged, orderKeys } from './lib/rules.mjs';
import { buildSecretRefsFile, collectSecretRefs } from './lib/secret-refs.mjs';
import { toYaml } from './lib/yaml-out.mjs';

export const EXIT = Object.freeze({ OK: 0, SECRETS_FOUND: 1, CONFIG: 2, CLUSTER: 3, PARTIAL: 4, INTERNAL: 99 });
export const TOOL_NAME = 'sentinel-k8s-snapshot';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function readToolVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SCRIPT_DIR, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function readClientVersion() {
  try {
    const p = path.join(SCRIPT_DIR, 'node_modules', '@kubernetes', 'client-node', 'package.json');
    return `@kubernetes/client-node ${JSON.parse(fs.readFileSync(p, 'utf8')).version}`;
  } catch {
    return '@kubernetes/client-node';
  }
}

const HELP = `사용법: node export.mjs [--dry-run] [--config <.env 파일>] [옵션]
  --context <이름>             내보내기 전용 kubeconfig 컨텍스트 (필수, KUBE_CONTEXT)
  --kubeconfig <경로>          kubeconfig 경로 (KUBECONFIG, 비우면 사용자 기본)
  --namespaces a,b             포함 네임스페이스 (SNAPSHOT_NAMESPACES)
  --exclude-namespaces a,b     제외 네임스페이스 (SNAPSHOT_EXCLUDE_NAMESPACES)
  --system-namespaces a,b      시스템 네임스페이스 목록 (SNAPSHOT_SYSTEM_NAMESPACES)
  --optional-kinds a,b         선택 종류 켜기 (SNAPSHOT_OPTIONAL_KINDS: jobs, clusterroles, …)
  --custom-resources p.g,…     사용자 지정 리소스 plural.group (SNAPSHOT_CUSTOM_RESOURCES)
  --exclude-kinds a,b          기본 종류 빼기 (SNAPSHOT_EXCLUDE_KINDS)
  --no-include-helm            Helm 관리 리소스 제외 (SNAPSHOT_INCLUDE_HELM=false)
  --strict                     스캔 경고도 실패 (SNAPSHOT_STRICT)
  --out-dir <경로>             출력 폴더 (SNAPSHOT_OUT_DIR, 기본 snapshots/)
종료코드: 0 성공 · 1 비밀값 의심(커밋 금지) · 2 설정 오류 · 3 접속 실패/권한 없음/0개 · 4 부분 성공 · 99 내부 오류`;

/** 설정·실행 계획 (dry-run 출력, 클러스터 호출 없음) */
export function planOf(cfg) {
  const kinds = [
    ...cfg.kinds.default.map((id) => kindById(id)),
    ...cfg.kinds.optional.map((id) => kindById(id)),
  ];
  const apis = kinds.map((e) => `GET ${listPath(e, 'NS').replace('/namespaces/NS/', '/namespaces/<ns>/')}`);
  for (const c of cfg.kinds.custom) apis.push(`GET /apis/${c.slice(c.indexOf('.') + 1)} (discovery) → GET …/${c.split('.')[0]}`);
  return {
    context: cfg.context,
    kubeconfig: cfg.kubeconfig ? path.basename(cfg.kubeconfig) : '(사용자 기본 kubeconfig)',
    namespaces: cfg.namespaces,
    kinds: cfg.kinds,
    includeHelm: cfg.includeHelm,
    strict: cfg.strict,
    apis: ['GET /version', 'GET /api/v1/namespaces/kube-system', cfg.namespaces.mode === 'include' ? 'GET /api/v1/namespaces/<ns>' : 'GET /api/v1/namespaces', ...apis],
  };
}

/**
 * @param {object} deps
 * @param {string[]} [deps.argv]
 * @param {Record<string,string|undefined>} [deps.processEnv]
 * @param {(opts) => Promise<Function>} [deps.transportFactory]  테스트: 가짜 전송 계층
 * @param {(kubeconfig) => Promise<{contexts:string[], clusterNameOf(ctx):string|null}>} [deps.inspect]
 * @param {() => Date} [deps.now]
 */
export async function runExport(deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const log = (s = '') => stdout.write(`${s}\n`);
  const err = (s) => stderr.write(`${s}\n`);
  const baseDir = deps.baseDir ?? process.env.INIT_CWD ?? process.cwd();

  // ---------------- 설정 (종료코드 2)
  let cfg;
  let flags;
  try {
    flags = parseCli(deps.argv ?? process.argv.slice(2));
    if (flags.help) {
      log(HELP);
      return EXIT.OK;
    }
    const envFile = flags.config ? path.resolve(baseDir, flags.config) : path.join(SCRIPT_DIR, '.env');
    let fileText = '';
    if (fs.existsSync(envFile)) fileText = fs.readFileSync(envFile, 'utf8');
    else if (flags.config) throw new ConfigError(`설정 파일이 없습니다: ${path.basename(envFile)}`);
    cfg = resolveConfig({ flags, fileEnv: parseEnvText(fileText), processEnv: deps.processEnv ?? process.env });
  } catch (e) {
    if (e instanceof ConfigError) {
      err(`설정 오류: ${e.message}`);
      return EXIT.CONFIG;
    }
    throw e;
  }
  const kubeconfigPath = cfg.kubeconfig ? path.resolve(baseDir, cfg.kubeconfig) : null;

  // 컨텍스트가 kubeconfig 에 있는지 (파일만 읽음, 인증·호출 없음)
  let clusterName = null;
  try {
    const info = await (deps.inspect ?? inspectKubeconfig)(kubeconfigPath);
    if (!info.contexts.includes(cfg.context)) {
      err(`설정 오류: kubeconfig 에 컨텍스트 "${cfg.context}" 가 없습니다`);
      return EXIT.CONFIG;
    }
    clusterName = info.clusterNameOf(cfg.context);
  } catch (e) {
    err(`설정 오류: kubeconfig 를 읽을 수 없습니다 (${sanitizeMessage(e?.message)})`);
    return EXIT.CONFIG;
  }

  if (cfg.dryRun) {
    const plan = planOf(cfg);
    log('[dry-run] 클러스터를 호출하지 않고 파일을 만들지 않습니다.');
    log(JSON.stringify(plan, null, 2));
    return EXIT.OK;
  }

  // ---------------- 내보내기
  const now = (deps.now ?? (() => new Date()))();
  const snapshotId = snapshotIdOf(now);
  const outRoot = cfg.outDir ? path.resolve(baseDir, cfg.outDir) : path.join(SCRIPT_DIR, 'snapshots');
  const finalDir = path.join(outRoot, snapshotId);
  const tmpDir = path.join(outRoot, `.${snapshotId}.partial`);
  if (fs.existsSync(finalDir) || fs.existsSync(tmpDir)) {
    err(`설정 오류: 같은 시각의 스냅샷 폴더가 이미 있습니다 (${snapshotId})`);
    return EXIT.CONFIG;
  }
  const cleanupTmp = () => fs.rmSync(tmpDir, { recursive: true, force: true });

  let client;
  try {
    const transport = await (deps.transportFactory ?? realTransport)({ kubeconfigPath, context: cfg.context });
    client = createClient({ transport });
  } catch (e) {
    err(`클러스터 접속 준비 실패: ${sanitizeMessage(e?.message)}`);
    return EXIT.CLUSTER;
  }

  const fail3 = (msg) => {
    err(msg);
    cleanupTmp();
    return EXIT.CLUSTER;
  };

  try {
    let serverVersion;
    let clusterId;
    try {
      const v = await client.getJson('/version');
      serverVersion = typeof v?.gitVersion === 'string' ? v.gitVersion : null;
      const ks = await client.getJson('/api/v1/namespaces/kube-system');
      clusterId = ks?.metadata?.uid;
      if (!clusterId) return fail3('클러스터 ID(kube-system UID)를 읽을 수 없습니다');
    } catch (e) {
      if (e instanceof KubeHttpError && e.status === 403) return fail3('kube-system 네임스페이스를 읽을 권한이 없습니다 (내보내기 역할에 namespaces get 필요)');
      return fail3(`클러스터 접속 실패: ${sanitizeMessage(e?.message)}`);
    }

    // 네임스페이스 범위
    const nsCfg = cfg.namespaces;
    const nsObjects = new Map();
    const missing = [];
    try {
      if (nsCfg.mode === 'include') {
        for (const ns of nsCfg.include) {
          try {
            nsObjects.set(ns, await client.getJson(`/api/v1/namespaces/${ns}`));
          } catch (e) {
            if (e instanceof KubeHttpError && e.status === 404) missing.push(ns);
            else throw e;
          }
        }
        for (const ns of nsCfg.systemIncluded) err(`경고: 시스템 네임스페이스 ${ns} 를 포함합니다 (EKS 애드온 리소스는 복원 대상이 아닐 수 있음)`);
        for (const ns of missing) err(`경고: 네임스페이스 ${ns} 가 클러스터에 없습니다`);
      } else {
        for (const o of await client.listAll('/api/v1/namespaces')) {
          const n = o?.metadata?.name;
          if (!n || nsCfg.system.includes(n) || nsCfg.exclude.includes(n)) continue;
          nsObjects.set(n, o);
        }
      }
    } catch (e) {
      if (e instanceof KubeHttpError && e.status === 403) return fail3('네임스페이스를 읽을 권한이 없습니다');
      return fail3(`클러스터 접속 실패: ${sanitizeMessage(e?.message)}`);
    }
    const namespaces = [...nsObjects.keys()].sort();

    // 종류 목록 (사용자 지정은 discovery)
    const entries = [
      ...cfg.kinds.default.map((id) => kindById(id)),
      ...cfg.kinds.optional.map((id) => kindById(id)),
    ].filter((e) => e.id !== 'namespaces');
    const kindsResult = {};
    const result = (e, r) => {
      kindsResult[e.id] = { kind: e.kind, apiVersion: e.apiVersion, namespaced: e.namespaced, result: 'ok', exported: 0, excludedByRule: 0, forbiddenNamespaces: [], ...r };
      return kindsResult[e.id];
    };
    for (const id of cfg.kinds.custom) {
      const group = id.slice(id.indexOf('.') + 1);
      const plural = id.split('.')[0];
      try {
        const g = await client.getJson(`/apis/${group}`);
        const version = g?.preferredVersion?.version ?? g?.versions?.[0]?.version;
        const rl = await client.getJson(`/apis/${group}/${version}`);
        const r = (rl?.resources ?? []).find((x) => x?.name === plural);
        if (!version || !r) {
          result({ id, kind: plural, apiVersion: `${group}/?`, namespaced: true }, { result: 'not_found' });
          continue;
        }
        entries.push(customKind(id, { kind: r.kind, version, namespaced: r.namespaced !== false }));
      } catch (e) {
        if (e instanceof KubeHttpError && e.status === 404) result({ id, kind: plural, apiVersion: `${group}/?`, namespaced: true }, { result: 'not_found' });
        else if (e instanceof KubeHttpError && e.status === 403) result({ id, kind: plural, apiVersion: `${group}/?`, namespaced: true }, { result: 'forbidden' });
        else if (e instanceof KubeConnectError) throw e;
        else result({ id, kind: plural, apiVersion: `${group}/?`, namespaced: true }, { result: 'error', message: sanitizeMessage(e?.message) });
      }
    }

    // 리소스 읽기·정리·쓰기
    fs.mkdirSync(tmpDir, { recursive: true });
    const written = [];
    const stats = {
      byKind: {},
      byNamespace: {},
      helmManaged: 0,
      excludedByRule: {},
    };
    const exported = [];
    const writeObj = (rel, obj) => {
      const abs = path.join(tmpDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, toYaml(obj));
      written.push(rel);
    };

    if (cfg.kinds.default.includes('namespaces')) {
      const nsEntry = kindById('namespaces');
      const r = result(nsEntry, {});
      for (const ns of namespaces) {
        const obj = orderKeys(cleanObject({ apiVersion: 'v1', kind: 'Namespace', ...nsObjects.get(ns) }));
        writeObj(resourcePath({ isNamespace: true, name: ns }), obj);
        r.exported++;
        stats.byNamespace[ns] = (stats.byNamespace[ns] ?? 0) + 1;
        if (isHelmManaged(obj)) stats.helmManaged++;
      }
      stats.byKind.namespaces = r.exported;
    }

    for (const e of entries) {
      const r = kindsResult[e.id] ?? result(e, {});
      if (r.result !== 'ok') continue;
      const targets = e.namespaced ? namespaces : [null];
      const ex = { total: 0, owned: 0, autoCreated: 0, helmExcluded: 0, autoCreatedNames: [] };
      for (const ns of targets) {
        let items;
        try {
          items = await client.listAll(listPath(e, ns));
        } catch (err2) {
          if (err2 instanceof KubeHttpError && err2.status === 403) {
            r.result = 'forbidden';
            if (ns) r.forbiddenNamespaces.push(ns);
            continue;
          }
          if (err2 instanceof KubeHttpError && err2.status === 404) {
            r.result = 'not_found';
            break;
          }
          if (err2 instanceof KubeConnectError) throw err2;
          r.result = 'error';
          r.message = sanitizeMessage(err2?.message);
          break;
        }
        for (const raw of items) {
          const obj = { apiVersion: e.apiVersion, kind: e.kind, ...raw };
          if (isAlwaysExcluded(obj)) {
            ex.total++;
            ex.owned++;
            continue;
          }
          const auto = isAutoCreated(obj, e.kind);
          if (auto) {
            ex.total++;
            ex.autoCreated++;
            if (!ex.autoCreatedNames.includes(auto) && ex.autoCreatedNames.length < 10) ex.autoCreatedNames.push(auto);
            continue;
          }
          const helm = isHelmManaged(obj);
          if (helm && !cfg.includeHelm) {
            ex.total++;
            ex.helmExcluded++;
            continue;
          }
          const clean = orderKeys(cleanObject(obj, { rulesVersion: CLEANUP_RULES_VERSION }));
          writeObj(resourcePath({ namespace: e.namespaced ? ns : null, kindDir: e.id, name: obj.metadata?.name ?? '' }), clean);
          exported.push(clean);
          r.exported++;
          if (helm) stats.helmManaged++;
          if (ns) stats.byNamespace[ns] = (stats.byNamespace[ns] ?? 0) + 1;
        }
      }
      r.excludedByRule = ex.total;
      stats.byKind[e.id] = r.exported;
      if (ex.total) stats.excludedByRule[e.id] = ex;
    }

    const total = written.length;
    if (total === 0) return fail3('내보낼 리소스가 0개입니다 (범위·권한 확인)');

    // secret-refs.json
    const secrets = collectSecretRefs(exported);
    fs.writeFileSync(path.join(tmpDir, SECRET_REFS_FILE), `${JSON.stringify(buildSecretRefsFile(snapshotId, secrets), null, 2)}\n`);

    // 스캔 (k8s 프로필, metadata 전)
    const { findings } = scanPaths([tmpDir], { profile: 'k8s' });
    const rel = (f) => path.relative(tmpDir, f).split(path.sep).join('/');
    const scanSummary = summarize(findings, { strict: cfg.strict });
    const metadata = buildMetadata({
      snapshotId,
      now,
      tool: { name: TOOL_NAME, version: readToolVersion(), node: process.version, client: readClientVersion() },
      cluster: { id: clusterId, idSource: 'kube-system-namespace-uid', context: cfg.context, name: clusterDisplayName(clusterName), serverVersion },
      cfg,
      namespaces,
      missing,
      kinds: kindsResult,
      resources: { total, byKind: stats.byKind, byNamespace: stats.byNamespace, helmManaged: stats.helmManaged, excludedByRule: stats.excludedByRule },
      secretsReferenced: secrets.length,
      scan: { ...scanSummary, rules: [...new Set(findings.map((f) => f.rule))].sort(), profile: 'k8s' },
    });
    fs.writeFileSync(path.join(tmpDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`);
    fs.renameSync(tmpDir, finalDir);

    const partial = Object.entries(kindsResult).filter(([, r]) => r.result !== 'ok');
    log(`스냅샷 ${snapshotId}: 리소스 ${total}개 (네임스페이스 ${namespaces.length}개), Secret 참조 ${secrets.length}개`);
    for (const [id, r] of partial) log(`  일부 종류를 읽지 못함: ${id} (${r.result === 'forbidden' ? '권한 없음' : r.result === 'not_found' ? 'API 없음' : '오류'})`);
    log(`스캔: 오류 ${scanSummary.errors}건, 경고 ${scanSummary.warnings}건${cfg.strict ? ' (strict)' : ''}`);
    if (findings.length) log(formatFindings(findings.map((f) => ({ ...f, file: rel(f.file) }))));
    if (!scanSummary.passed) {
      log('실패: 비밀값 의심 → 커밋하지 마세요. 정리 후 npm run scan 으로 다시 확인하세요');
      return EXIT.SECRETS_FOUND;
    }
    if (partial.length) return EXIT.PARTIAL;
    log('완료');
    return EXIT.OK;
  } catch (e) {
    cleanupTmp();
    if (e instanceof KubeConnectError) {
      err(`클러스터 접속 실패: ${e.message}`);
      return EXIT.CLUSTER;
    }
    err(`내부 오류: ${sanitizeMessage(e?.message)}`);
    return EXIT.INTERNAL;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runExport().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`내부 오류: ${sanitizeMessage(e?.message)}\n`);
      process.exitCode = EXIT.INTERNAL;
    },
  );
}

export { KIND_CATALOG };
