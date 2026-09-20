import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXIT, former2Env, run, userPath } from '../export.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FAKE = path.join(HERE, 'fixtures', 'fake-former2.mjs');
const NOW = new Date('2026-09-19T03:15:00.000Z');
const STAMP = '20260919-031500';

function sink() {
  let text = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += chunk;
      cb();
    },
  });
  return { stream, get text() { return text; } };
}

let tmp;
let envFile;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-snapshot-export-'));
  envFile = path.join(tmp, 'test.env');
  fs.writeFileSync(
    envFile,
    [
      'AWS_PROFILE=sentinel-snapshot',
      'AWS_REGION=ap-northeast-2',
      'SNAPSHOT_SEARCH_FILTER=sentinel-prod',
      'SNAPSHOT_SERVICES=EKS,EC2,VPC',
      '',
    ].join('\n'),
  );
});
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function exec(extraArgs, { mode = 'clean', outDir, rawDir } = {}) {
  const out = sink();
  const err = sink();
  const argsFile = path.join(tmp, `args-${Math.random().toString(36).slice(2)}.json`);
  const code = await run({
    argv: ['--config', envFile, '--out-dir', outDir, ...(rawDir ? ['--raw-dir', rawDir] : []), ...extraArgs],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      SNAPSHOT_FORMER2_BIN: FAKE,
      SNAPSHOT_FORMER2_VERSION: '0.2.83-fake',
      FAKE_FORMER2_MODE: mode,
      FAKE_FORMER2_ARGS_FILE: argsFile,
      // 셸에 다른 자격증명이 있어도 프로필을 지정하면 former2 에 넘어가지 않아야 한다
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'shell-secret',
      AWS_PROFILE: 'dashboard-profile',
    },
    stdout: out.stream,
    stderr: err.stream,
    now: NOW,
  });
  const seen = fs.existsSync(argsFile) ? JSON.parse(fs.readFileSync(argsFile, 'utf8')) : null;
  return { code, out: out.text, err: err.text, former2Args: seen?.args, former2Env: seen?.env };
}

describe('export.mjs --dry-run (CLI 프로세스)', () => {
  it('former2 명령만 출력하고 파일을 만들지 않는다', () => {
    const outDir = path.join(tmp, 'dry');
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, 'export.mjs'), '--dry-run', '--config', envFile, '--out-dir', outDir],
      { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\[dry-run\]/);
    assert.match(r.stdout, /npx former2 generate --output-cloudformation \S+cloudformation\.yml/);
    assert.match(r.stdout, /--region ap-northeast-2 --search-filter sentinel-prod --services EKS,EC2,VPC --sort-output/);
    assert.match(r.stdout, /환경변수 설정: AWS_REGION=ap-northeast-2 AWS_PROFILE=sentinel-snapshot/);
    assert.match(r.stdout, /환경변수 제거: AWS_ACCESS_KEY_ID/);
    assert.ok(!r.stdout.includes('--output-raw-data'));
    assert.equal(fs.existsSync(outDir), false);
  });

  it('설정 오류는 종료코드 2', () => {
    const bad = path.join(tmp, 'bad.env');
    fs.writeFileSync(bad, 'AWS_PROFILE=x\n');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'export.mjs'), '--dry-run', '--config', bad], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /AWS_REGION/);
  });

  it('모르는 플래그(예: --apply)는 거부한다', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'export.mjs'), '--apply'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
});

describe('former2Env', () => {
  it('~/.aws/config 가 있을 때만 AWS_SDK_LOAD_CONFIG 를 켠다 (없으면 aws-sdk v2 가 ENOENT 로 죽음)', () => {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(path.join(home, '.aws'), { recursive: true });
    assert.equal(former2Env({ AWS_SDK_LOAD_CONFIG: '1' }, undefined, home).AWS_SDK_LOAD_CONFIG, undefined);
    fs.writeFileSync(path.join(home, '.aws', 'config'), '[default]\n');
    assert.equal(former2Env({}, undefined, home).AWS_SDK_LOAD_CONFIG, '1');
    assert.equal(former2Env({ AWS_CONFIG_FILE: path.join(tmp, 'nope') }, undefined, home).AWS_SDK_LOAD_CONFIG, undefined);
  });

  it('프로필 지정 시 AWS_PROFILE 을 설정하고 셸의 정적 키 환경변수를 지운다', () => {
    const child = former2Env(
      { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SESSION_TOKEN: 't', AWS_PROFILE: 'dashboard', PATH: 'p' },
      { set: { AWS_PROFILE: 'sentinel-snapshot', AWS_REGION: 'ap-northeast-2' }, unset: ['AWS_ACCESS_KEY_ID', 'AWS_SESSION_TOKEN'] },
      path.join(tmp, 'no-home'),
    );
    assert.deepEqual(child, { AWS_PROFILE: 'sentinel-snapshot', AWS_REGION: 'ap-northeast-2', PATH: 'p' });
  });
});

describe('userPath', () => {
  it('npm --prefix 로 실행해도 상대 경로는 명령을 친 폴더(INIT_CWD) 기준', () => {
    const base = path.join(tmp, 'repo-root');
    assert.equal(userPath('deploy/aws-snapshot/.env.example', { INIT_CWD: base }), path.join(base, 'deploy', 'aws-snapshot', '.env.example'));
    assert.equal(userPath('x.env', {}), path.resolve('x.env'));
  });
});

describe('export.mjs 실행 (가짜 former2)', () => {
  it('정상: 템플릿·매핑·메타데이터를 만들고 종료코드 0', async () => {
    const outDir = path.join(tmp, 'clean');
    const r = await exec([], { outDir });
    assert.equal(r.code, EXIT.OK, r.err + r.out);
    const dir = path.join(outDir, STAMP);
    assert.deepEqual(fs.readdirSync(dir).sort(), [
      'cloudformation.yml', 'logical-id-mapping.json', 'metadata.json', 'terraform.tf',
    ]);
    assert.equal(r.former2Args[0], 'generate');
    assert.ok(!r.former2Args.includes('--output-raw-data'));
    assert.deepEqual(r.former2Env, { AWS_PROFILE: 'sentinel-snapshot', AWS_REGION: 'ap-northeast-2' });

    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
    assert.equal(meta.snapshotId, STAMP);
    assert.equal(meta.region, 'ap-northeast-2');
    assert.equal(meta.searchFilter, 'sentinel-prod');
    assert.equal(meta.former2.version, '0.2.83-fake');
    assert.deepEqual(meta.account.ids, ['********9012']);
    assert.deepEqual(meta.resources, { cloudformation: 2, terraform: 1 });
    assert.equal(meta.secretScan.passed, true);
    assert.equal(meta.rawData.saved, false);
    // 로컬 절대경로(사용자 이름 등)가 메타데이터에 남지 않는다
    assert.ok(!JSON.stringify(meta).includes(tmp.replace(/\\/g, '\\\\')));
    assert.ok(meta.former2.args.includes('<snapshot>/cloudformation.yml'));
  });

  it('비밀값 발견: 파일은 남기고 종료코드 1, 출력에 원문이 없다', async () => {
    const outDir = path.join(tmp, 'secret');
    const r = await exec([], { outDir, mode: 'secret' });
    assert.equal(r.code, EXIT.SECRETS_FOUND);
    assert.match(r.out, /env-block/);
    assert.match(r.out, /secret-key-value/);
    assert.ok(!r.out.includes('hunter2hunter2'));
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, STAMP, 'metadata.json'), 'utf8'));
    assert.equal(meta.secretScan.passed, false);
    assert.deepEqual(meta.secretScan.rules, ['env-block', 'secret-key-value']);
  });

  it('결과 없음: 빈 스냅샷을 지우고 종료코드 3', async () => {
    const outDir = path.join(tmp, 'empty');
    const r = await exec([], { outDir, mode: 'empty' });
    assert.equal(r.code, EXIT.FORMER2_FAILED);
    assert.equal(fs.existsSync(path.join(outDir, STAMP)), false);
    assert.match(r.err, /자격증명/);
  });

  it('former2 가 ERROR 를 찍고 0 으로 끝나도 실패로 본다', async () => {
    const outDir = path.join(tmp, 'error');
    const r = await exec([], { outDir, mode: 'error' });
    assert.equal(r.code, EXIT.FORMER2_FAILED);
    assert.equal(fs.existsSync(path.join(outDir, STAMP)), false);
  });

  it('former2 비정상 종료는 종료코드 3', async () => {
    const r = await exec([], { outDir: path.join(tmp, 'crash'), mode: 'crash' });
    assert.equal(r.code, EXIT.FORMER2_FAILED);
  });

  it('--raw 는 raw 폴더에만 쓰고 스냅샷 폴더에는 raw 가 없다', async () => {
    const outDir = path.join(tmp, 'raw-out');
    const rawDir = path.join(tmp, '.raw');
    const r = await exec(['--raw'], { outDir, rawDir });
    assert.equal(r.code, EXIT.OK, r.err + r.out);
    assert.ok(fs.existsSync(path.join(rawDir, STAMP, 'raw-data.json')));
    assert.ok(!fs.readdirSync(path.join(outDir, STAMP)).includes('raw-data.json'));
    const meta = JSON.parse(fs.readFileSync(path.join(outDir, STAMP, 'metadata.json'), 'utf8'));
    assert.equal(meta.rawData.saved, true);
  });

  it('같은 초에 다시 실행하면 덮어쓰지 않는다', async () => {
    const outDir = path.join(tmp, 'clean');
    const r = await exec([], { outDir });
    assert.equal(r.code, EXIT.CONFIG);
    assert.match(r.err, /이미 있는/);
  });
});
