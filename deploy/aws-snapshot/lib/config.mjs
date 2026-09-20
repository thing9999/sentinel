// 설정 읽기: CLI 플래그 > deploy/aws-snapshot/.env > 프로세스 환경변수 순서로 적용한다.
// .env 가 셸 환경변수보다 우선하는 이유: 셸에 대시보드용 AWS_PROFILE 이 잡혀 있어도
// 이 도구는 .env 에 적은 "내보내기 전용" 프로필을 쓰게 하려는 것.
import { parseArgs, parseEnv } from 'node:util';
import { parseServiceList, resolveServiceSelection } from './services.mjs';

export class ConfigError extends Error {}

export const CLI_OPTIONS = {
  'dry-run': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  // --env-file 은 Node 자체 옵션과 이름이 겹쳐(스크립트 뒤에 써도 Node 가 가로챔) --config 로 받는다
  config: { type: 'string' },
  'out-dir': { type: 'string' },
  'raw-dir': { type: 'string' },
  profile: { type: 'string' },
  region: { type: 'string' },
  'search-filter': { type: 'string' },
  'regex-filter': { type: 'string' },
  services: { type: 'string' },
  'exclude-services': { type: 'string' },
  'allow-sensitive-services': { type: 'boolean' },
  'include-default-resources': { type: 'boolean' },
  raw: { type: 'boolean' },
  strict: { type: 'boolean' },
};

export function parseCli(argv) {
  try {
    return parseArgs({ args: argv, options: CLI_OPTIONS, allowPositionals: false, strict: true }).values;
  } catch (err) {
    throw new ConfigError(err.message);
  }
}

/** .env 텍스트 파싱. 값이 빈 문자열인 키는 "설정 안 함"으로 본다. */
export function parseEnvText(text) {
  if (!text) return {};
  const parsed = parseEnv(text);
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== ''));
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  throw new ConfigError(`불리언 값이 아닙니다: "${value}" (true/false)`);
}

const REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const PROFILE_RE = /^[A-Za-z0-9_.+=,@/-]+$/;

/**
 * @param {object} p
 * @param {Record<string, any>} p.flags   parseCli 결과
 * @param {Record<string, string>} p.fileEnv  .env 파싱 결과
 * @param {Record<string, string|undefined>} p.processEnv
 */
export function resolveConfig({ flags = {}, fileEnv = {}, processEnv = {} }) {
  const pick = (flagName, envName) => {
    if (flags[flagName] !== undefined) return flags[flagName];
    if (fileEnv[envName] !== undefined) return fileEnv[envName];
    const pv = processEnv[envName];
    return pv === '' ? undefined : pv;
  };

  const warnings = [];

  const region = (pick('region', 'AWS_REGION') ?? '').trim();
  if (!region) {
    // former2 는 --region 이 없으면 ~/.aws/config 의 default 리전을 환경변수보다 우선해 쓴다.
    // 엉뚱한 리전을 긁지 않도록 리전은 반드시 명시하게 한다.
    throw new ConfigError('AWS_REGION 이 필요합니다 (.env 또는 --region). 예: ap-northeast-2');
  }
  if (!REGION_RE.test(region)) throw new ConfigError(`AWS_REGION 형식이 올바르지 않습니다: "${region}"`);

  const profile = (pick('profile', 'AWS_PROFILE') ?? '').trim() || null;
  if (profile && !PROFILE_RE.test(profile)) throw new ConfigError(`AWS_PROFILE 형식이 올바르지 않습니다: "${profile}"`);

  const searchFilter = (pick('search-filter', 'SNAPSHOT_SEARCH_FILTER') ?? '').trim() || null;
  const regexFilter = (pick('regex-filter', 'SNAPSHOT_REGEX_FILTER') ?? '').trim() || null;
  if (regexFilter) {
    try {
      new RegExp(regexFilter);
    } catch (err) {
      throw new ConfigError(`SNAPSHOT_REGEX_FILTER 가 올바른 정규식이 아닙니다: ${err.message}`);
    }
  }
  if (!searchFilter && !regexFilter) {
    warnings.push('검색 필터가 비어 있습니다. 선택한 서비스의 리전 내 리소스를 모두 내보냅니다.');
  }

  const includeParsed = parseServiceList(pick('services', 'SNAPSHOT_SERVICES'));
  const excludeParsed = parseServiceList(pick('exclude-services', 'SNAPSHOT_EXCLUDE_SERVICES'));
  const unknown = [...includeParsed.unknown, ...excludeParsed.unknown];
  if (unknown.length) {
    throw new ConfigError(
      `Former2 가 모르는 서비스 이름: ${unknown.join(', ')} (lib/services.mjs KNOWN_SERVICES 참고)`,
    );
  }
  const allowSensitive = toBool(pick('allow-sensitive-services', 'SNAPSHOT_ALLOW_SENSITIVE_SERVICES'), false);
  const selection = resolveServiceSelection({
    include: includeParsed.known,
    exclude: excludeParsed.known,
    allowSensitive,
  });
  if (selection.removedSensitive.length) {
    warnings.push(
      `비밀값을 읽는 서비스는 제외했습니다: ${selection.removedSensitive.join(', ')} ` +
        '(꼭 필요하면 SNAPSHOT_ALLOW_SENSITIVE_SERVICES=true)',
    );
  }
  if (selection.mode === 'include' && selection.services.length === 0) {
    throw new ConfigError('포함할 서비스가 하나도 남지 않았습니다 (SNAPSHOT_SERVICES 확인).');
  }
  if (allowSensitive) {
    warnings.push('SNAPSHOT_ALLOW_SENSITIVE_SERVICES=true: 비밀값이 템플릿에 들어갈 수 있습니다. 스캔 결과를 반드시 확인하세요.');
  }

  const cfnDeletionPolicy = (pick('cfn-deletion-policy', 'SNAPSHOT_CFN_DELETION_POLICY') ?? 'Retain').trim();
  if (!['Retain', 'Delete'].includes(cfnDeletionPolicy)) {
    throw new ConfigError('SNAPSHOT_CFN_DELETION_POLICY 는 Retain 또는 Delete 여야 합니다.');
  }

  return {
    region,
    profile,
    searchFilter,
    regexFilter,
    serviceSelection: selection,
    allowSensitive,
    includeDefaultResources: toBool(pick('include-default-resources', 'SNAPSHOT_INCLUDE_DEFAULT_RESOURCES'), false),
    rawData: toBool(pick('raw', 'SNAPSHOT_RAW_DATA'), false),
    strictScan: toBool(pick('strict', 'SNAPSHOT_STRICT_SCAN'), false),
    maskAccountId: toBool(pick('mask-account-id', 'SNAPSHOT_MASK_ACCOUNT_ID'), true),
    cfnDeletionPolicy,
    warnings,
  };
}
