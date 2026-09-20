import { bytes, cpuMillicores, parseQuantity } from './quantity';

describe('quantity', () => {
  it('CPU → millicore', () => {
    expect(cpuMillicores('250m')).toBe(250);
    expect(cpuMillicores('1')).toBe(1000);
    expect(cpuMillicores('1.5')).toBe(1500);
    expect(cpuMillicores('123456789n')).toBe(123);
    expect(cpuMillicores(undefined)).toBeNull();
  });

  it('메모리 → bytes', () => {
    expect(bytes('128Mi')).toBe(128 * 1024 * 1024);
    expect(bytes('1Gi')).toBe(1024 ** 3);
    expect(bytes('1G')).toBe(1e9);
    expect(bytes('7934296Ki')).toBe(7934296 * 1024);
    expect(bytes('1e3')).toBe(1000);
  });

  it('알 수 없는 형식은 null', () => {
    expect(parseQuantity('abc')).toBeNull();
    expect(parseQuantity('12Qi')).toBeNull();
  });
});
