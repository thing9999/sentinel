/** 라우트 파라미터: 이미 디코딩된 값이면 그대로, `%` 인코딩이 남아 있으면 디코딩한다 */
export function safeDecode(v: string): string {
  if (!v.includes("%")) return v;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
