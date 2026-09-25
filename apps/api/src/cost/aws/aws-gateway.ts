/**
 * AWS 호출 경계 (포트). 서비스는 이 인터페이스에만 의존하고 테스트는 가짜 구현을 넣는다.
 * 모든 메서드는 **읽기 전용** API 하나(또는 그 페이지네이션)만 부른다 — CLAUDE.md AWS 권한 목록:
 * pricing:GetProducts, ce:GetCostAndUsage, ce:GetCostForecast, ec2:DescribeInstances,
 * ec2:DescribeVolumes, ec2:DescribeSpotPriceHistory, elasticloadbalancing:Describe*
 * (kOps 전환: eks:DescribeCluster 없음 — 클러스터 버전은 쿠버네티스 API에서만 읽는다, AC-KOPS08)
 * 반환값은 정리된 최소 필드뿐이다 (원본 응답을 밖으로 내보내지 않음).
 */
import type { AwsInstance, AwsLoadBalancer, AwsVolume } from '../cost.types';
import type { CauPage } from '../explorer/ce-normalize';

export const COST_AWS_GATEWAY = Symbol('COST_AWS_GATEWAY');

/** Pricing API 상품 한 건 (온디맨드 가격 차원만) */
export interface PriceListProduct {
  attributes: Record<string, string>;
  onDemand: { unit: string; usd: number; description: string }[];
}

export interface CostAndUsageRequest {
  start: string; // YYYY-MM-DD (포함)
  end: string; // YYYY-MM-DD (미포함)
  metric: 'UnblendedCost' | 'AmortizedCost';
  tagFilter: { key: string; values: string[] } | null;
  nextPageToken: string | null;
}

export interface CostForecastRequest {
  start: string;
  end: string;
  metric: 'UnblendedCost' | 'AmortizedCost';
  tagFilter: { key: string; values: string[] } | null;
}

export interface CostForecastResponse {
  totalUsd: number;
  days: {
    date: string;
    mean: number;
    low: number | null;
    high: number | null;
  }[];
}

export interface CostAwsGateway {
  /** 리전(클러스터 리전). 단가 필터 regionCode에도 쓴다 */
  readonly region: string;
  /** ec2:DescribeInstances — ID 목록(노드 providerID) 또는 클러스터 태그로 */
  describeInstances(q: {
    instanceIds?: string[];
    clusterName?: string | null;
  }): Promise<AwsInstance[]>;
  /** ec2:DescribeVolumes — 클러스터 인스턴스에 붙은 볼륨 + EBS CSI 태그 볼륨 */
  describeVolumes(q: { attachedInstanceIds: string[] }): Promise<AwsVolume[]>;
  /** elasticloadbalancing:DescribeLoadBalancers/DescribeTags/DescribeTargetGroups/DescribeTargetHealth */
  describeLoadBalancers(): Promise<AwsLoadBalancer[]>;
  /** pricing:GetProducts (us-east-1 엔드포인트) */
  getProducts(
    serviceCode: string,
    filters: Record<string, string>,
    maxPages?: number,
  ): Promise<PriceListProduct[]>;
  /** ec2:DescribeSpotPriceHistory — 타입·AZ·Linux 최신 1건 */
  getLatestSpotPrice(
    instanceType: string,
    zone: string,
  ): Promise<{ usdPerHour: number; timestamp: Date } | null>;
  /** ce:GetCostAndUsage 한 페이지 (호출 1회 = $0.01) */
  getCostAndUsagePage(req: CostAndUsageRequest): Promise<CauPage>;
  /** ce:GetCostForecast (호출 1회 = $0.01) */
  getCostForecast(req: CostForecastRequest): Promise<CostForecastResponse>;
}

// ---------------------------------------------------------------------------
// 오류 분류
// ---------------------------------------------------------------------------

export type AwsErrorKind =
  | 'not_configured'
  | 'access_denied'
  | 'not_enabled'
  | 'throttled'
  | 'data_unavailable'
  | 'other';

export interface AwsErrorInfo {
  kind: AwsErrorKind;
  /** AWS 오류 이름 (예: AccessDeniedException) */
  awsCode: string;
  message: string;
}

const CREDENTIAL_ERRORS = new Set([
  'CredentialsProviderError',
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'ExpiredToken',
  'ExpiredTokenException',
  'InvalidSignatureException',
  'SignatureDoesNotMatch',
  'AuthFailure',
  'TokenRefreshRequired',
]);

export function classifyAwsError(err: unknown): AwsErrorInfo {
  const e = (err ?? {}) as {
    name?: unknown;
    message?: unknown;
    Code?: unknown;
  };
  const name =
    typeof e.name === 'string'
      ? e.name
      : typeof e.Code === 'string'
        ? e.Code
        : 'Error';
  const rawMsg = typeof e.message === 'string' ? e.message : String(err);
  const message = sanitizeAwsMessage(rawMsg);
  let kind: AwsErrorKind = 'other';
  if (CREDENTIAL_ERRORS.has(name) || /could not load credentials/i.test(rawMsg))
    kind = 'not_configured';
  else if (/AccessDenied|UnauthorizedOperation|Forbidden/i.test(name))
    kind = 'access_denied';
  else if (
    /OptInRequired|not enabled|isn't enabled|opted in/i.test(
      `${name} ${rawMsg}`,
    )
  )
    kind = 'not_enabled';
  else if (
    /Throttl|TooManyRequests|LimitExceeded|RequestLimitExceeded/i.test(name)
  )
    kind = 'throttled';
  else if (/DataUnavailable/i.test(name)) kind = 'data_unavailable';
  return { kind, awsCode: name, message };
}

/** 계정 ID·ARN·액세스 키를 가리고 한 줄 300자로 */
export function sanitizeAwsMessage(msg: string): string {
  return msg
    .replace(/arn:aws[a-z-]*:[^\s"']+/gi, '[arn]')
    .replace(/\b\d{12}\b/g, '[account]')
    .replace(/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, '[key]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}
