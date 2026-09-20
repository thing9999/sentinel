/**
 * 쿠버네티스 Quantity 문자열 파싱 ("250m", "1.5", "128Mi", "1Gi", "123456789n").
 * 알 수 없는 형식이면 null.
 */
const BINARY: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};
const DECIMAL: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  '': 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

export function parseQuantity(
  q: string | number | null | undefined,
): number | null {
  if (q === null || q === undefined) return null;
  if (typeof q === 'number') return Number.isFinite(q) ? q : null;
  const s = q.trim();
  const m = /^([+-]?[0-9.]+(?:[eE][+-]?[0-9]+)?)([A-Za-z]{0,2})$/.exec(s);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;
  const suffix = m[2];
  if (suffix in BINARY) return num * BINARY[suffix];
  if (suffix in DECIMAL) return num * DECIMAL[suffix];
  return null;
}

/** CPU → millicore 정수 */
export function cpuMillicores(
  q: string | number | null | undefined,
): number | null {
  const v = parseQuantity(q);
  return v === null ? null : Math.round(v * 1000);
}

/** 메모리·디스크 → bytes 정수 */
export function bytes(q: string | number | null | undefined): number | null {
  const v = parseQuantity(q);
  return v === null ? null : Math.round(v);
}
