import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, parseCli, parseEnvText, resolveConfig } from '../lib/config.mjs';
import { SENSITIVE_SERVICES, parseServiceList, resolveServiceSelection } from '../lib/services.mjs';

describe('parseServiceList', () => {
  it('대소문자·공백·하이픈을 무시하고 정식 이름으로 바꾼다', () => {
    assert.deepEqual(parseServiceList(' ec2, eks ,Route 53,secrets-manager,EC2'), {
      known: ['EC2', 'EKS', 'Route53', 'SecretsManager'],
      unknown: [],
    });
  });
  it('모르는 이름은 unknown 으로 모은다', () => {
    assert.deepEqual(parseServiceList('EKS,Elb,Foo').unknown, ['Elb', 'Foo']);
  });
  it('빈 값은 빈 목록', () => {
    assert.deepEqual(parseServiceList(undefined), { known: [], unknown: [] });
  });
});

describe('resolveServiceSelection', () => {
  it('포함 목록이 없으면 기본 제외(비밀 보관 서비스) + 사용자 제외를 exclude 로 넘긴다', () => {
    const r = resolveServiceSelection({ exclude: ['S3'] });
    assert.equal(r.mode, 'exclude');
    assert.deepEqual(r.services, [...SENSITIVE_SERVICES, 'S3']);
  });
  it('포함 목록에서 비밀 보관 서비스와 사용자 제외를 뺀다 (former2 는 두 옵션 동시 사용 불가)', () => {
    const r = resolveServiceSelection({ include: ['EKS', 'SecretsManager', 'S3'], exclude: ['S3'] });
    assert.deepEqual(r, { mode: 'include', services: ['EKS'], removedSensitive: ['SecretsManager'] });
  });
  it('allowSensitive 면 기본 제외를 적용하지 않는다', () => {
    const r = resolveServiceSelection({ include: ['SecretsManager'], allowSensitive: true });
    assert.deepEqual(r.services, ['SecretsManager']);
    assert.deepEqual(resolveServiceSelection({ allowSensitive: true }).services, []);
  });
});

describe('resolveConfig', () => {
  const base = { AWS_REGION: 'ap-northeast-2' };

  it('우선순위: 플래그 > .env > 셸 환경변수', () => {
    const c = resolveConfig({
      flags: { region: 'us-east-1' },
      fileEnv: { AWS_REGION: 'ap-northeast-2', AWS_PROFILE: 'file-profile' },
      processEnv: { AWS_REGION: 'eu-west-1', AWS_PROFILE: 'dashboard', SNAPSHOT_SEARCH_FILTER: 'from-shell' },
    });
    assert.equal(c.region, 'us-east-1');
    assert.equal(c.profile, 'file-profile');
    assert.equal(c.searchFilter, 'from-shell');
  });

  it('기본값: Retain, raw 끔, 계정 마스킹 켬, strict 끔, 기본 리소스 제외', () => {
    const c = resolveConfig({ fileEnv: { ...base, SNAPSHOT_SEARCH_FILTER: 'sentinel' } });
    assert.equal(c.cfnDeletionPolicy, 'Retain');
    assert.equal(c.rawData, false);
    assert.equal(c.maskAccountId, true);
    assert.equal(c.strictScan, false);
    assert.equal(c.includeDefaultResources, false);
    assert.equal(c.profile, null);
    assert.deepEqual(c.warnings, []);
  });

  it('리전이 없으면 오류 (former2 가 ~/.aws/config default 리전을 몰래 쓰는 것 방지)', () => {
    assert.throws(() => resolveConfig({}), ConfigError);
    assert.throws(() => resolveConfig({ fileEnv: { AWS_REGION: 'seoul' } }), /형식/);
  });

  it('모르는 서비스 이름은 오류', () => {
    assert.throws(() => resolveConfig({ fileEnv: { ...base, SNAPSHOT_SERVICES: 'EKS,Ekss' } }), /Ekss/);
  });

  it('포함 목록에서 비밀 보관 서비스를 빼고 경고한다', () => {
    const c = resolveConfig({ fileEnv: { ...base, SNAPSHOT_SERVICES: 'EKS,SystemsManager' } });
    assert.deepEqual(c.serviceSelection.services, ['EKS']);
    assert.ok(c.warnings.some((w) => w.includes('SystemsManager')));
  });

  it('포함 목록이 전부 빠지면 오류', () => {
    assert.throws(() => resolveConfig({ fileEnv: { ...base, SNAPSHOT_SERVICES: 'SecretsManager' } }), /하나도/);
  });

  it('필터가 없으면 전체 내보내기 경고', () => {
    const c = resolveConfig({ fileEnv: base });
    assert.ok(c.warnings.some((w) => w.includes('필터')));
  });

  it('잘못된 정규식·불리언·DeletionPolicy 는 오류', () => {
    assert.throws(() => resolveConfig({ fileEnv: { ...base, SNAPSHOT_REGEX_FILTER: '(' } }), /정규식/);
    assert.throws(() => resolveConfig({ fileEnv: { ...base, SNAPSHOT_RAW_DATA: 'maybe' } }), /불리언/);
    assert.throws(() => resolveConfig({ fileEnv: { ...base, SNAPSHOT_CFN_DELETION_POLICY: 'Snapshot' } }), /Retain/);
  });

  it('프로필 이름에 셸 특수문자가 있으면 오류', () => {
    assert.throws(() => resolveConfig({ fileEnv: { ...base, AWS_PROFILE: 'a;rm -rf' } }), /AWS_PROFILE/);
  });
});

describe('parseEnvText / parseCli', () => {
  it('빈 값은 설정 안 함으로 본다', () => {
    assert.deepEqual(parseEnvText('AWS_REGION=ap-northeast-2\nAWS_PROFILE=\n# c\n'), { AWS_REGION: 'ap-northeast-2' });
  });
  it('모르는 플래그는 ConfigError', () => {
    assert.throws(() => parseCli(['--apply']), ConfigError);
    assert.equal(parseCli(['--dry-run'])['dry-run'], true);
  });
});
