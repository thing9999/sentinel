import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { resolveConfig } from '../lib/config.mjs';
import {
  STATIC_CREDENTIAL_ENV_KEYS,
  buildFormer2Args,
  buildFormer2EnvOverrides,
  formatCommand,
  snapshotStamp,
} from '../lib/former2-args.mjs';

const SNAP = path.join('out', '20260919-031500');
const RAW = path.join('.raw', '20260919-031500');

function cfg(fileEnv) {
  return resolveConfig({ fileEnv: { AWS_REGION: 'ap-northeast-2', ...fileEnv } });
}

describe('buildFormer2Args', () => {
  it('포함 목록 + 프로필 + 필터', () => {
    const args = buildFormer2Args(
      cfg({ AWS_PROFILE: 'sentinel-snapshot', SNAPSHOT_SEARCH_FILTER: 'sentinel-prod', SNAPSHOT_SERVICES: 'eks,ec2,vpc' }),
      { snapshotDir: SNAP },
    );
    assert.deepEqual(args, [
      'generate',
      '--output-cloudformation', path.join(SNAP, 'cloudformation.yml'),
      '--output-terraform', path.join(SNAP, 'terraform.tf'),
      '--output-logical-id-mapping', path.join(SNAP, 'logical-id-mapping.json'),
      '--cfn-deletion-policy', 'Retain',
      '--region', 'ap-northeast-2',
      '--search-filter', 'sentinel-prod',
      '--services', 'EKS,EC2,VPC',
      '--sort-output',
    ]);
  });

  it('포함 목록이 없으면 기본 제외 서비스를 --exclude-services 로 넘기고 --services 는 쓰지 않는다', () => {
    const args = buildFormer2Args(cfg({ SNAPSHOT_EXCLUDE_SERVICES: 'S3' }), { snapshotDir: SNAP });
    const i = args.indexOf('--exclude-services');
    assert.equal(args[i + 1], 'SecretsManager,SystemsManager,GameLift,Cognito,S3');
    assert.ok(!args.includes('--services'));
    assert.ok(!args.includes('--profile'));
    assert.ok(!args.includes('--search-filter'));
  });

  it('raw 데이터는 기본으로 끄고, 켜면 raw 폴더로만 쓴다', () => {
    assert.ok(!buildFormer2Args(cfg({}), { snapshotDir: SNAP }).includes('--output-raw-data'));
    const args = buildFormer2Args(cfg({ SNAPSHOT_RAW_DATA: 'true' }), { snapshotDir: SNAP, rawDir: RAW });
    assert.equal(args[args.indexOf('--output-raw-data') + 1], path.join(RAW, 'raw-data.json'));
    assert.throws(() => buildFormer2Args(cfg({ SNAPSHOT_RAW_DATA: 'true' }), { snapshotDir: SNAP }));
  });

  it('정규식 필터·기본 리소스·DeletionPolicy', () => {
    const args = buildFormer2Args(
      cfg({ SNAPSHOT_REGEX_FILTER: 'sentinel-(prod|stg)', SNAPSHOT_INCLUDE_DEFAULT_RESOURCES: 'true', SNAPSHOT_CFN_DELETION_POLICY: 'Delete' }),
      { snapshotDir: SNAP },
    );
    assert.equal(args[args.indexOf('--regex-filter') + 1], 'sentinel-(prod|stg)');
    assert.ok(args.includes('--include-default-resources'));
    assert.equal(args[args.indexOf('--cfn-deletion-policy') + 1], 'Delete');
  });

  it('쓰기 계열 서브커맨드·옵션을 만들지 않는다', () => {
    const args = buildFormer2Args(cfg({ SNAPSHOT_RAW_DATA: 'true' }), { snapshotDir: SNAP, rawDir: RAW });
    assert.equal(args[0], 'generate');
    assert.ok(args.every((a) => !/deploy|apply|create-stack|execute/i.test(a)));
  });
});

describe('buildFormer2EnvOverrides', () => {
  it('프로필은 --profile 대신 AWS_PROFILE 로 넘기고 정적 키 환경변수를 지운다 (SSO·credential_process 지원)', () => {
    const c = cfg({ AWS_PROFILE: 'sentinel-snapshot' });
    assert.ok(!buildFormer2Args(c, { snapshotDir: SNAP }).includes('--profile'));
    assert.deepEqual(buildFormer2EnvOverrides(c), {
      set: { AWS_REGION: 'ap-northeast-2', AWS_PROFILE: 'sentinel-snapshot' },
      unset: [...STATIC_CREDENTIAL_ENV_KEYS],
    });
  });
  it('프로필이 없으면 기본 자격증명 체인을 그대로 둔다', () => {
    assert.deepEqual(buildFormer2EnvOverrides(cfg({})), { set: { AWS_REGION: 'ap-northeast-2' }, unset: [] });
  });
});

describe('formatCommand', () => {
  it('특수문자가 있는 인자만 따옴표로 감싼다', () => {
    assert.equal(
      formatCommand(['generate', '--search-filter', 'a&b', '--regex-filter', "it's (x)", '--region', 'ap-northeast-2']),
      "npx former2 generate --search-filter 'a&b' --regex-filter 'it''s (x)' --region ap-northeast-2",
    );
  });
});

describe('snapshotStamp', () => {
  it('UTC 기준 YYYYMMDD-HHmmss', () => {
    assert.equal(snapshotStamp(new Date('2026-09-19T03:15:00.000Z')), '20260919-031500');
    assert.equal(snapshotStamp(new Date('2026-01-02T23:04:05.000Z')), '20260102-230405');
  });
});
