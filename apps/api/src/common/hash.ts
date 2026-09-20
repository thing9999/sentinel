const VOLATILE_KEYS = new Set([
  'generatedAt',
  'updatedAt',
  'serverTime',
  'emittedAt',
]);

/**
 * 변경 감지용 직렬화. 매번 바뀌는 시각 필드(generatedAt, updatedAt 등)와 지정한 키를 뺀다.
 */
export function changeKey(
  value: unknown,
  omit: ReadonlySet<string> = new Set(),
): string {
  return JSON.stringify(value, (k, v: unknown) =>
    VOLATILE_KEYS.has(k) || omit.has(k) ? undefined : v,
  );
}
