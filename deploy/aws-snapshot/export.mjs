#!/usr/bin/env node
// AWS 설정을 Former2 로 IaC 템플릿(CloudFormation YAML + Terraform)으로 내보낸다.
//
//   npm run export --prefix deploy/aws-snapshot              # 실제 내보내기
//   npm run export --prefix deploy/aws-snapshot -- --dry-run # 실행할 former2 명령만 출력
//
// 이 스크립트는 AWS API 를 직접 부르지 않는다. AWS 조회는 former2 가 하며, former2 는 조회(List/Describe/Get)
// 호출만 한다. 자격증명은 "내보내기 전용" 읽기 권한 프로필을 쓴다 (README 참고).
// 결과를 적용(배포)하는 기능은 없다. 적용은 사람이 README 절차에 따라 수동으로 한다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ConfigError, parseCli, parseEnvText, resolveConfig } from './lib/config.mjs';
import {
  OUTPUT_FILES,
  buildFormer2Args,
  buildFormer2EnvOverrides,
  formatCommand,
  snapshotStamp,
} from './lib/former2-args.mjs';
import {
  NO_RESOURCES_MARKER,
  countCloudFormationResources,
  countTerraformResources,
  extractAccountIds,
  maskAccountId,
} from './lib/meta.mjs';
import { formatFindings, scanText, summarize } from './lib/scan.mjs';

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const EXIT = Object.freeze({ OK: 0, SECRETS_FOUND: 1, CONFIG: 2, FORMER2_FAILED: 3 });

const USAGE = `사용법: node export.mjs [옵션]

설정은 deploy/aws-snapshot/.env (예시: .env.example). 플래그가 .env 보다, .env 가 셸 환경변수보다 우선합니다.

  --dry-run                      실행할 former2 명령만 출력 (AWS 호출·파일 생성 없음)
  --config <path>                .env 경로 (기본: deploy/aws-snapshot/.env)
  --profile <name>               AWS_PROFILE
  --region <region>              AWS_REGION (필수)
  --search-filter <str>          SNAPSHOT_SEARCH_FILTER (쉼표=OR, &=AND)
  --regex-filter <regex>         SNAPSHOT_REGEX_FILTER
  --services <csv>               SNAPSHOT_SERVICES (포함할 서비스)
  --exclude-services <csv>       SNAPSHOT_EXCLUDE_SERVICES (추가로 뺄 서비스)
  --allow-sensitive-services     SecretsManager·SystemsManager 등 기본 제외 서비스도 포함 (권장 안 함)
  --include-default-resources    기본 VPC 등 기본 리소스 포함
  --raw                          raw 데이터 저장 (.raw/ 아래, git 제외)
  --strict                       스캔 경고(warn)도 실패로 처리
  --out-dir <path>               스냅샷 폴더 (기본: deploy/aws-snapshot/snapshots)
  --raw-dir <path>               raw 폴더 (기본: deploy/aws-snapshot/.raw)
  -h, --help                     도움말

종료코드: 0 성공, 1 비밀값 의심 발견, 2 설정 오류, 3 former2 실행 실패/결과 없음`;

/** former2 CLI 위치와 버전. SNAPSHOT_FORMER2_BIN 은 테스트용 대체 실행 파일 */
export function resolveFormer2(env = process.env) {
  if (env.SNAPSHOT_FORMER2_BIN) {
    return { bin: path.resolve(env.SNAPSHOT_FORMER2_BIN), version: env.SNAPSHOT_FORMER2_VERSION ?? 'test-double' };
  }
  try {
    const require = createRequire(pathToFileURL(path.join(SCRIPT_DIR, 'package.json')));
    const pkgPath = require.resolve('former2/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.former2;
    return { bin: path.join(path.dirname(pkgPath), binRel), version: pkg.version };
  } catch {
    return null;
  }
}

/**
 * former2 에 넘길 환경변수.
 * AWS_SDK_LOAD_CONFIG=1 이면 ~/.aws/config 의 role_arn/source_profile·credential_process 프로필도 읽는다.
 * 단 aws-sdk v2 는 이 값이 켜진 상태에서 config 파일이 없으면 ENOENT 로 죽으므로 파일이 있을 때만 켠다.
 */
export function former2Env(env, overrides = { set: {}, unset: [] }, homeDir = os.homedir()) {
  const configFile = env.AWS_CONFIG_FILE || path.join(homeDir, '.aws', 'config');
  const child = { ...env, ...overrides.set };
  for (const k of overrides.unset) delete child[k];
  if (fs.existsSync(configFile)) child.AWS_SDK_LOAD_CONFIG = '1';
  else delete child.AWS_SDK_LOAD_CONFIG;
  return child;
}

function runFormer2(bin, args, { stdout, env, overrides }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: SCRIPT_DIR,
      env: former2Env(env, overrides),
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      stdout.write(chunk);
    });
    child.on('error', (err) => resolve({ code: -1, out: `${out}\nERROR: ${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

/**
 * 사용자가 준 상대 경로는 명령을 친 폴더 기준으로 푼다.
 * npm run --prefix 는 작업 폴더를 deploy/aws-snapshot 으로 바꾸므로 원래 위치(INIT_CWD)를 쓴다.
 */
export function userPath(p, env = process.env) {
  return path.resolve(env.INIT_CWD ?? process.cwd(), p);
}

/** 메타데이터에 로컬 절대경로(사용자 이름 등)가 들어가지 않게 바꾼다 */
function redactPaths(args, { snapshotDir, rawDir }) {
  return args.map((a) =>
    a.startsWith(snapshotDir) ? `<snapshot>${a.slice(snapshotDir.length).replace(/\\/g, '/')}`
    : rawDir && a.startsWith(rawDir) ? `<raw>${a.slice(rawDir.length).replace(/\\/g, '/')}`
    : a,
  );
}

/**
 * @returns {Promise<number>} 종료코드
 */
export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  now = new Date(),
} = {}) {
  const log = (s = '') => stdout.write(`${s}\n`);
  const err = (s = '') => stderr.write(`${s}\n`);

  let flags;
  let config;
  try {
    flags = parseCli(argv);
    if (flags.help) {
      log(USAGE);
      return EXIT.OK;
    }
    const envFile = flags.config ? userPath(flags.config, env) : path.join(SCRIPT_DIR, '.env');
    let fileEnv = {};
    if (fs.existsSync(envFile)) {
      fileEnv = parseEnvText(fs.readFileSync(envFile, 'utf8'));
    } else if (flags.config) {
      throw new ConfigError(`env 파일이 없습니다: ${envFile}`);
    } else {
      log(`(참고) ${envFile} 없음. 플래그와 셸 환경변수만 사용합니다.`);
    }
    config = resolveConfig({ flags, fileEnv, processEnv: env });
  } catch (e) {
    if (e instanceof ConfigError) {
      err(`설정 오류: ${e.message}`);
      err('도움말: node export.mjs --help');
      return EXIT.CONFIG;
    }
    throw e;
  }

  const stamp = snapshotStamp(now);
  const outRoot = flags['out-dir'] ? userPath(flags['out-dir'], env) : path.join(SCRIPT_DIR, 'snapshots');
  const rawRoot = flags['raw-dir'] ? userPath(flags['raw-dir'], env) : path.join(SCRIPT_DIR, '.raw');
  const snapshotDir = path.join(outRoot, stamp);
  const rawDir = config.rawData ? path.join(rawRoot, stamp) : undefined;
  const args = buildFormer2Args(config, { snapshotDir, rawDir });
  const overrides = buildFormer2EnvOverrides(config);

  log('== aws-snapshot (Former2 내보내기, 조회 전용) ==');
  log(`리전: ${config.region}`);
  log(`프로필: ${config.profile ?? '(지정 안 함: 기본 자격증명 체인)'}`);
  log(`검색 필터: ${config.searchFilter ?? '-'}${config.regexFilter ? ` / 정규식: ${config.regexFilter}` : ''}`);
  const sel = config.serviceSelection;
  log(`서비스: ${sel.mode === 'include' ? '포함' : '제외'} ${sel.services.join(', ') || '(없음)'}`);
  log(`출력: ${snapshotDir}`);
  log(`raw 데이터: ${rawDir ? `${rawDir} (git 제외 경로)` : '저장 안 함'}`);
  for (const w of config.warnings) log(`경고: ${w}`);
  if (rawDir && !rawRoot.split(path.sep).includes('.raw')) {
    log('경고: raw 폴더가 기본 .raw/ 가 아닙니다. git 에 올라가지 않는 경로인지 확인하세요.');
  }

  if (flags['dry-run']) {
    log('');
    log('[dry-run] 아래 명령을 실행합니다 (지금은 실행하지 않음, AWS 호출·파일 생성 없음):');
    log(`환경변수 설정: ${Object.entries(overrides.set).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (overrides.unset.length) log(`환경변수 제거: ${overrides.unset.join(' ')} (프로필 외 자격증명 차단)`);
    log(formatCommand(args));
    return EXIT.OK;
  }

  const former2 = resolveFormer2(env);
  if (!former2) {
    err('former2 가 설치되어 있지 않습니다: npm install --prefix deploy/aws-snapshot');
    return EXIT.CONFIG;
  }
  if (fs.existsSync(snapshotDir)) {
    err(`이미 있는 스냅샷 폴더입니다: ${snapshotDir} (1초 뒤 다시 실행하세요)`);
    return EXIT.CONFIG;
  }
  fs.mkdirSync(snapshotDir, { recursive: true });
  if (rawDir) fs.mkdirSync(rawDir, { recursive: true });

  const cleanup = () => {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    if (rawDir) fs.rmSync(rawDir, { recursive: true, force: true });
  };

  log(`former2 ${former2.version} 실행 중... (서비스 수에 따라 수 분 걸릴 수 있음)`);
  const result = await runFormer2(former2.bin, args, { stdout, env, overrides });
  // former2 는 오류가 나도 "ERROR: ..." 를 찍고 종료코드 0 으로 끝나는 경우가 있다
  if (result.code !== 0 || /(^|\n)\s*ERROR:/.test(result.out)) {
    cleanup();
    err(`former2 실행 실패 (종료코드 ${result.code}). 위 출력을 확인하세요.`);
    return EXIT.FORMER2_FAILED;
  }

  const cfnPath = path.join(snapshotDir, OUTPUT_FILES.cloudformation);
  const tfPath = path.join(snapshotDir, OUTPUT_FILES.terraform);
  const mapPath = path.join(snapshotDir, OUTPUT_FILES.logicalIdMapping);
  if (!fs.existsSync(cfnPath) || !fs.existsSync(tfPath)) {
    cleanup();
    err('former2 가 템플릿 파일을 만들지 않았습니다.');
    return EXIT.FORMER2_FAILED;
  }
  const cfn = fs.readFileSync(cfnPath, 'utf8');
  const tf = fs.readFileSync(tfPath, 'utf8');
  const mapping = fs.existsSync(mapPath) ? fs.readFileSync(mapPath, 'utf8') : '';
  const resources = { cloudformation: countCloudFormationResources(cfn), terraform: countTerraformResources(tf) };

  if (resources.cloudformation === 0 && resources.terraform === 0) {
    cleanup();
    err(`리소스가 하나도 나오지 않았습니다 ("${NO_RESOURCES_MARKER}"). 빈 스냅샷은 지웠습니다.`);
    err('former2 는 서비스별 권한·자격증명 오류를 조용히 넘기므로 다음을 확인하세요:');
    err('  - 자격증명/프로필이 맞는지, 세션이 만료되지 않았는지 (SSO 프로필은 README "자격증명" 참고)');
    err('  - AWS_REGION 이 리소스가 있는 리전인지');
    err('  - SNAPSHOT_SEARCH_FILTER 가 너무 좁지 않은지');
    return EXIT.FORMER2_FAILED;
  }

  const findings = [
    ...scanText(cfn, cfnPath),
    ...scanText(tf, tfPath),
    ...(mapping ? scanText(mapping, mapPath) : []),
  ];
  const scan = summarize(findings, { strict: config.strictScan });

  const accountIds = extractAccountIds(cfn, tf, mapping);
  const metadata = {
    schemaVersion: 1,
    tool: 'sentinel deploy/aws-snapshot',
    createdAt: now.toISOString(),
    snapshotId: stamp,
    snapshotIdTimezone: 'UTC',
    region: config.region,
    profile: config.profile,
    searchFilter: config.searchFilter,
    regexFilter: config.regexFilter,
    services: { mode: sel.mode, list: sel.services },
    allowSensitiveServices: config.allowSensitive,
    includeDefaultResources: config.includeDefaultResources,
    cfnDeletionPolicy: config.cfnDeletionPolicy,
    former2: { version: former2.version, args: redactPaths(args, { snapshotDir, rawDir }) },
    node: process.version,
    account: {
      masked: config.maskAccountId,
      ids: config.maskAccountId ? accountIds.map(maskAccountId) : accountIds,
      note: '템플릿 안의 ARN 에는 계정 ID 가 원문으로 남아 있습니다',
    },
    resources,
    rawData: { saved: Boolean(rawDir), location: rawDir ? `.raw/${stamp}/${OUTPUT_FILES.raw} (git 제외)` : null },
    secretScan: { ...scan, rules: [...new Set(findings.map((f) => f.rule))].sort() },
  };
  fs.writeFileSync(path.join(snapshotDir, OUTPUT_FILES.metadata), `${JSON.stringify(metadata, null, 2)}\n`);

  log('');
  log(`완료: CloudFormation 리소스 ${resources.cloudformation}개, Terraform 리소스 ${resources.terraform}개`);
  log(`스냅샷: ${snapshotDir}`);
  if (findings.length) {
    log('');
    log(`비밀값 스캔: 오류 ${scan.errors}건, 경고 ${scan.warnings}건${scan.strict ? ' (strict)' : ''}`);
    log(formatFindings(findings));
  } else {
    log('비밀값 스캔: 발견 없음');
  }
  if (!scan.passed) {
    log('');
    log('커밋하지 마세요. 해당 줄을 지우거나 파라미터/동적 참조({{resolve:secretsmanager:...}})로 바꾼 뒤');
    log('다시 스캔하세요: npm run scan --prefix deploy/aws-snapshot -- snapshots/' + stamp);
    log('검토 후 문제없는 줄은 줄 끝에 "# snapshot-scan: allow" 주석을 달면 건너뜁니다.');
    return EXIT.SECRETS_FOUND;
  }
  log('다음 단계: README "커밋 전 체크리스트"를 확인한 뒤 git 에 추가하세요.');
  return EXIT.OK;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e);
      process.exitCode = 99;
    },
  );
}
