/**
 * EKS 버전 → 지원 등급 (표준/확장). 확장 지원 기간이면 컨트롤 플레인 단가가 오른다.
 * 표준 지원 종료일은 AWS EKS 버전 일정표 기준 (갱신 필요 — 보고서 한계에 기록).
 */
const STANDARD_SUPPORT_END: Record<string, string> = {
  '1.23': '2023-10-11',
  '1.24': '2024-01-31',
  '1.25': '2024-05-01',
  '1.26': '2024-06-11',
  '1.27': '2024-07-24',
  '1.28': '2024-11-26',
  '1.29': '2025-03-23',
  '1.30': '2025-07-23',
  '1.31': '2025-11-26',
  '1.32': '2026-03-23',
  '1.33': '2026-07-29',
  '1.34': '2026-12-02',
  '1.35': '2027-03-27',
};

export function eksSupportTier(
  version: string | null,
  now: Date,
): 'standard' | 'extended' {
  if (!version) return 'standard';
  const m = /^(\d+)\.(\d+)/.exec(version);
  if (!m) return 'standard';
  const key = `${m[1]}.${m[2]}`;
  const end = STANDARD_SUPPORT_END[key];
  if (end)
    return now.getTime() >= Date.parse(`${end}T00:00:00Z`)
      ? 'extended'
      : 'standard';
  // 표에 없는 옛 버전은 확장, 새 버전은 표준
  const minor = Number(m[2]);
  return Number(m[1]) === 1 && minor < 23 ? 'extended' : 'standard';
}

// ---------------------------------------------------------------------------
// 대체 인스턴스 타입 후보 (어드바이저 스냅샷용, 계약 aws-cost 10절)
// ---------------------------------------------------------------------------

const SIZES = [
  'nano',
  'micro',
  'small',
  'medium',
  'large',
  'xlarge',
  '2xlarge',
  '3xlarge',
  '4xlarge',
  '8xlarge',
  '12xlarge',
  '16xlarge',
  '24xlarge',
  '32xlarge',
  '48xlarge',
];

const GRAVITON_FAMILY: Record<string, string> = {
  m5: 'm7g',
  m5a: 'm7g',
  m6i: 'm7g',
  m6a: 'm7g',
  m7i: 'm7g',
  m7a: 'm7g',
  c5: 'c7g',
  c5a: 'c7g',
  c6i: 'c7g',
  c6a: 'c7g',
  c7i: 'c7g',
  c7a: 'c7g',
  r5: 'r7g',
  r5a: 'r7g',
  r6i: 'r7g',
  r6a: 'r7g',
  r7i: 'r7g',
  r7a: 'r7g',
  t3: 't4g',
  t3a: 't4g',
};

export function splitInstanceType(
  type: string,
): { family: string; size: string } | null {
  const i = type.indexOf('.');
  if (i <= 0) return null;
  return { family: type.slice(0, i), size: type.slice(i + 1) };
}

/** 같은 크기 Graviton 타입 (이미 Graviton이거나 대응이 없으면 null) */
export function gravitonEquivalent(type: string): string | null {
  const t = splitInstanceType(type);
  if (!t) return null;
  const g = GRAVITON_FAMILY[t.family];
  if (!g) return null;
  // t4g는 nano~2xlarge만
  if (g === 't4g' && SIZES.indexOf(t.size) > SIZES.indexOf('2xlarge'))
    return null;
  return `${g}.${t.size}`;
}

/** 한 단계 작은 크기 (없으면 null) */
export function smallerSize(type: string): string | null {
  const t = splitInstanceType(type);
  if (!t) return null;
  const idx = SIZES.indexOf(t.size);
  if (idx <= 0) return null;
  // 3xlarge 같은 드문 크기는 건너뛴다
  const prev = SIZES[idx - 1] === '3xlarge' ? SIZES[idx - 2] : SIZES[idx - 1];
  const min = t.family.startsWith('t') ? 0 : SIZES.indexOf('large');
  if (SIZES.indexOf(prev) < min) return null;
  return `${t.family}.${prev}`;
}
