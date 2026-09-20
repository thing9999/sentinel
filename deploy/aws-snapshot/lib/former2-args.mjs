// former2 generate 인자 조립. 순수 함수라 테스트에서 그대로 검증한다.
import path from 'node:path';

export const OUTPUT_FILES = Object.freeze({
  cloudformation: 'cloudformation.yml',
  terraform: 'terraform.tf',
  logicalIdMapping: 'logical-id-mapping.json',
  metadata: 'metadata.json',
  raw: 'raw-data.json',
});

/** 스냅샷 폴더 이름: UTC 기준 YYYYMMDD-HHmmss */
export function snapshotStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`
  );
}

/**
 * @param {ReturnType<import('./config.mjs').resolveConfig>} config
 * @param {{ snapshotDir: string, rawDir?: string }} paths
 * @returns {string[]} former2 CLI 인자 (첫 번째는 서브커맨드 generate)
 */
export function buildFormer2Args(config, { snapshotDir, rawDir }) {
  const args = [
    'generate',
    '--output-cloudformation', path.join(snapshotDir, OUTPUT_FILES.cloudformation),
    '--output-terraform', path.join(snapshotDir, OUTPUT_FILES.terraform),
    '--output-logical-id-mapping', path.join(snapshotDir, OUTPUT_FILES.logicalIdMapping),
    '--cfn-deletion-policy', config.cfnDeletionPolicy,
    '--region', config.region,
  ];
  // 프로필은 --profile 이 아니라 AWS_PROFILE 환경변수로 넘긴다 (buildFormer2EnvOverrides 참고)
  if (config.searchFilter) args.push('--search-filter', config.searchFilter);
  if (config.regexFilter) args.push('--regex-filter', config.regexFilter);

  const { mode, services } = config.serviceSelection;
  if (mode === 'include') {
    args.push('--services', services.join(','));
  } else if (services.length > 0) {
    args.push('--exclude-services', services.join(','));
  }

  args.push('--sort-output');
  if (config.includeDefaultResources) args.push('--include-default-resources');

  if (config.rawData) {
    if (!rawDir) throw new Error('rawData 가 켜졌는데 rawDir 이 없습니다');
    // raw 데이터는 비밀값이 섞일 수 있어 git 에서 제외되는 .raw/ 아래에만 쓴다
    args.push('--output-raw-data', path.join(rawDir, OUTPUT_FILES.raw));
  }
  return args;
}

// 프로필을 지정했을 때 하위 프로세스에서 지우는 정적 자격증명 환경변수.
// aws-sdk v2 기본 체인은 환경변수 키를 프로필보다 먼저 쓰므로, 남겨 두면 셸에 있던 다른 자격증명(대시보드용 등)이 쓰인다.
export const STATIC_CREDENTIAL_ENV_KEYS = Object.freeze([
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN',
  'AMAZON_ACCESS_KEY_ID', 'AMAZON_SECRET_ACCESS_KEY', 'AMAZON_SESSION_TOKEN',
]);

/**
 * former2 하위 프로세스 환경변수 변경분.
 * former2 의 --profile 은 aws-sdk v2 SharedIniFileCredentials 만 써서 SSO·credential_process 프로필을 못 쓴다.
 * AWS_PROFILE 환경변수로 넘기면 SDK 기본 체인(SSO → 공유 파일(role_arn/source_profile) → credential_process ...)을
 * 모두 쓸 수 있다. (mfa_serial 이 있는 role_arn 프로필은 어느 쪽이든 MFA 코드 입력 수단이 없어 안 된다)
 * @returns {{ set: Record<string,string>, unset: string[] }}
 */
export function buildFormer2EnvOverrides(config) {
  const set = { AWS_REGION: config.region };
  if (!config.profile) return { set, unset: [] };
  return { set: { ...set, AWS_PROFILE: config.profile }, unset: [...STATIC_CREDENTIAL_ENV_KEYS] };
}

/**
 * 사람이 복사해 실행할 수 있는 명령 문자열 (dry-run 출력용).
 * 특수문자가 있는 인자만 작은따옴표로 감싼다(POSIX 셸·PowerShell 공통).
 * 값 안의 작은따옴표는 PowerShell 방식('')으로 이스케이프하므로 bash 에서는 손봐야 한다.
 */
export function formatCommand(args, program = 'npx former2') {
  const quote = (a) => (/^[A-Za-z0-9_.,:/\\=@+-]+$/.test(a) ? a : `'${a.replace(/'/g, "''")}'`);
  return [program, ...args.map(quote)].join(' ');
}
