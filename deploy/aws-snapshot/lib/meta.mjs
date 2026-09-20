// 메타데이터 도우미: 계정 ID 추출·마스킹, 리소스 개수 세기.
// 이 도구는 AWS 를 직접 부르지 않으므로(sts:GetCallerIdentity 도 안 씀) 계정 ID 는 출력 템플릿의 ARN 에서 읽는다.

const ARN_ACCOUNT_RE = /arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:(\d{12}):/g;

export function extractAccountIds(...texts) {
  const ids = new Set();
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(ARN_ACCOUNT_RE)) ids.add(m[1]);
  }
  return [...ids].sort();
}

/** 123456789012 → ********9012 */
export function maskAccountId(id) {
  const s = String(id);
  return s.length <= 4 ? '****' : `${'*'.repeat(s.length - 4)}${s.slice(-4)}`;
}

export const NO_RESOURCES_MARKER = '# No resources generated';

export function countCloudFormationResources(text) {
  const t = String(text ?? '');
  if (t.trimStart().startsWith(NO_RESOURCES_MARKER)) return 0;
  return (t.match(/^\s+Type:\s*["']?AWS::[A-Za-z0-9]+::[A-Za-z0-9]+/gm) ?? []).length;
}

export function countTerraformResources(text) {
  const t = String(text ?? '');
  if (t.trimStart().startsWith(NO_RESOURCES_MARKER)) return 0;
  return (t.match(/^resource\s+"[^"]+"\s+"[^"]+"/gm) ?? []).length;
}
