import type { DiscoveryService, Reflector } from '@nestjs/core';

/**
 * 클래스 데코레이터(SetMetadata)로 표시된 provider 인스턴스를 모두 찾는다.
 * 같은 인스턴스가 여러 모듈에 등록돼 있어도 한 번만 돌려준다.
 */
export function discoverProviders<T>(
  discovery: DiscoveryService,
  reflector: Reflector,
  metadataKey: string,
): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const wrapper of discovery.getProviders()) {
    const instance: unknown = wrapper.instance;
    const metatype: unknown = wrapper.metatype;
    if (!instance || typeof metatype !== 'function') continue;
    if (!reflector.get<boolean>(metadataKey, metatype)) continue;
    if (seen.has(instance)) continue;
    seen.add(instance);
    out.push(instance as T);
  }
  return out;
}
