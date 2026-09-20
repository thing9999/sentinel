import {
  isAwsConfigured,
  isKubeConfigured,
  shouldUseMock,
} from './data-source';

describe('data-source helpers', () => {
  it('mock 모드면 항상 mock', () => {
    expect(shouldUseMock('mock', true)).toBe(true);
    expect(shouldUseMock('mock', false)).toBe(true);
  });

  it('live 모드여도 연결 정보가 없으면 mock', () => {
    expect(shouldUseMock('live', false)).toBe(true);
    expect(shouldUseMock('live', true)).toBe(false);
  });

  it('kube: KUBECONFIG 또는 클러스터 내부면 configured', () => {
    expect(isKubeConfigured({})).toBe(false);
    expect(isKubeConfigured({ KUBECONFIG: '/kube/config' })).toBe(true);
    expect(isKubeConfigured({ KUBERNETES_SERVICE_HOST: '10.0.0.1' })).toBe(
      true,
    );
  });

  it('aws: 리전이 있어야 configured', () => {
    expect(isAwsConfigured({})).toBe(false);
    expect(isAwsConfigured({ AWS_REGION: 'ap-northeast-2' })).toBe(true);
  });
});
