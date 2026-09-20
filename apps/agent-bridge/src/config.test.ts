import { describe, expect, it } from 'vitest';
import { isLoopbackAddress, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('기본값: 127.0.0.1:3002, 로컬 전용', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 3002,
      host: '127.0.0.1',
      hostOverridden: false,
    });
    expect(c.token).toBeUndefined();
  });

  it('토큰이 없으면 BRIDGE_HOST=0.0.0.0을 무시한다', () => {
    const c = loadConfig({ BRIDGE_HOST: '0.0.0.0', BRIDGE_TOKEN: '' });
    expect(c.host).toBe('127.0.0.1');
    expect(c.hostOverridden).toBe(true);
  });

  it('토큰이 있으면 BRIDGE_HOST를 따른다', () => {
    const c = loadConfig({ BRIDGE_HOST: '0.0.0.0', BRIDGE_TOKEN: 's' });
    expect(c.host).toBe('0.0.0.0');
    expect(c.token).toBe('s');
  });

  it('잘못된 포트는 실패', () => {
    expect(() => loadConfig({ BRIDGE_PORT: 'abc' })).toThrow();
  });
});

describe('isLoopbackAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['172.17.0.2', false],
    [undefined, false],
  ])('%s -> %s', (addr, expected) => {
    expect(isLoopbackAddress(addr)).toBe(expected);
  });
});
