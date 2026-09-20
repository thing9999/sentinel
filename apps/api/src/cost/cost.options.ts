/**
 * cost 모듈 실행 옵션 (환경 변수에서 만든다).
 * 새 환경 변수는 env.validation.ts(A 영역)에 아직 없으므로 ConfigService.get + 기본값으로 읽는다.
 */
import type { DataSource } from './cost.types';

export const COST_OPTIONS = Symbol('COST_OPTIONS');
/** 테스트용 시계 주입 (없으면 현재 시각) */
export const COST_CLOCK = Symbol('COST_CLOCK');

export interface CostOptions {
  dataSource: DataSource;
  /** 클러스터 리전. 없으면 live에서 AWS_NOT_CONFIGURED */
  awsRegion: string | null;
  awsProfile: string | null;
  /** EKS 클러스터 이름 (eks:DescribeCluster, 태그 대조) */
  clusterName: string | null;
  /** 설정을 잠그는 환경 변수 (명시된 경우만) */
  env: {
    monthlyBudgetUsd?: number;
    ceCacheTtlSec?: number;
    ceMetric?: 'UnblendedCost' | 'AmortizedCost';
    ceDailyCallLimit?: number;
  };
  /** 주기 작업 사용 여부 (테스트에서 끔) */
  timers: boolean;
}

type Getter = (key: string) => unknown;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== ''
    ? v.trim()
    : typeof v === 'number'
      ? String(v)
      : null;

const posNum = (v: unknown): number | undefined => {
  const s = str(v);
  if (s === null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * @param get ConfigService.get 래퍼
 * @param rawEnv 명시 여부 판단용 원본 env (COST_EXPLORER_CACHE_TTL_SEC는 검증 기본값이 있어 ConfigService로는 구분 불가)
 */
export function buildCostOptions(
  get: Getter,
  rawEnv: Record<string, string | undefined> = process.env,
): CostOptions {
  const ds = str(get('DATA_SOURCE'));
  const metric = str(get('COST_EXPLORER_METRIC'));
  const env: CostOptions['env'] = {};
  const budget = posNum(get('COST_MONTHLY_BUDGET_USD'));
  if (budget !== undefined) env.monthlyBudgetUsd = budget;
  if (str(rawEnv.COST_EXPLORER_CACHE_TTL_SEC) !== null) {
    const ttl = posNum(get('COST_EXPLORER_CACHE_TTL_SEC'));
    if (ttl !== undefined) env.ceCacheTtlSec = Math.floor(ttl);
  }
  if (metric === 'UnblendedCost' || metric === 'AmortizedCost')
    env.ceMetric = metric;
  const limit = posNum(get('COST_EXPLORER_DAILY_CALL_LIMIT'));
  if (limit !== undefined) env.ceDailyCallLimit = Math.floor(limit);
  return {
    dataSource: ds === 'live' ? 'live' : 'mock',
    awsRegion: str(get('AWS_REGION')),
    awsProfile: str(get('AWS_PROFILE')),
    clusterName: str(get('EKS_CLUSTER_NAME')),
    env,
    timers: true,
  };
}
