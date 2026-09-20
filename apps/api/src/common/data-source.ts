import type { DataSourceMode } from '../config/env.validation';

/** 설정된 데이터 소스 모드(`DATA_SOURCE`)를 주입받는 토큰 */
export const DATA_SOURCE_MODE = Symbol('DATA_SOURCE_MODE');

/**
 * 도메인별로 mock 데이터를 써야 하는지 판단한다.
 * - DATA_SOURCE=mock 이면 항상 mock
 * - DATA_SOURCE=live 여도 해당 연결 정보(kubeconfig, AWS 등)가 없으면 mock으로 떨어진다
 */
export function shouldUseMock(
  mode: DataSourceMode,
  sourceConfigured: boolean,
): boolean {
  return mode === 'mock' || !sourceConfigured;
}

/** 클러스터 안(ServiceAccount) 또는 KUBECONFIG가 있으면 쿠버네티스 접속 가능 */
export function isKubeConfigured(env: {
  KUBECONFIG?: string;
  KUBERNETES_SERVICE_HOST?: string;
}): boolean {
  return Boolean(env.KUBECONFIG || env.KUBERNETES_SERVICE_HOST);
}

/** 리전이 있어야 AWS SDK 클라이언트를 만들 수 있다 (자격 증명 유효성은 호출 시 확인) */
export function isAwsConfigured(env: { AWS_REGION?: string }): boolean {
  return Boolean(env.AWS_REGION);
}

/**
 * 출처별 동작 모드 (docs/api/common.md 2.4).
 * - mock 모드: 'mock'
 * - live 모드 + 설정 있음: 'live'
 * - live 모드 + 설정 없음: 'not_configured' (mock으로 몰래 바꾸지 않는다)
 */
export type SourceMode = 'mock' | 'live' | 'not_configured';

export function resolveSourceMode(
  mode: DataSourceMode,
  sourceConfigured: boolean,
): SourceMode {
  if (mode === 'mock') return 'mock';
  return sourceConfigured ? 'live' : 'not_configured';
}
