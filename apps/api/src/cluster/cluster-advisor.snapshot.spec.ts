import { stripImage } from './cluster-advisor.snapshot';

describe('stripImage', () => {
  it('레지스트리 호스트(계정 ID)와 digest를 뺀다', () => {
    expect(
      stripImage('123456789012.dkr.ecr.ap-northeast-2.amazonaws.com/api:1.4.2'),
    ).toBe('api:1.4.2');
    expect(stripImage('nginx:1.27')).toBe('library/nginx:1.27');
    expect(stripImage('grafana/grafana:11.2.0')).toBe('grafana/grafana:11.2.0');
    expect(
      stripImage('registry.k8s.io/metrics-server/metrics-server:v0.7.1'),
    ).toBe('metrics-server/metrics-server:v0.7.1');
    expect(stripImage('localhost:5000/app@sha256:abcd')).toBe('app');
  });
});
