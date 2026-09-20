/**
 * 공통 상태 표현 (docs/api/common.md 2절).
 * 모든 상태·판단 이유는 서버가 계산한다. 화면은 계산하지 않는다.
 */

export type Status = 'ok' | 'warning' | 'critical' | 'unknown';
export const STATUS_VALUES: readonly Status[] = [
  'ok',
  'warning',
  'critical',
  'unknown',
];

export interface Reason {
  code: string;
  text: string;
  status: Status;
}

export interface StatusInfo {
  status: Status;
  reasons: Reason[];
  updatedAt: string | null;
  statusChangedAt: string | null;
  stale: boolean;
}

/** 집계 우선순위: critical > warning > unknown > ok */
const RANK: Record<Status, number> = {
  ok: 0,
  unknown: 1,
  warning: 2,
  critical: 3,
};

export function statusRank(s: Status): number {
  return RANK[s];
}

export function worstStatus(list: Iterable<Status>): Status {
  let worst: Status = 'ok';
  for (const s of list) if (RANK[s] > RANK[worst]) worst = s;
  return worst;
}

/** 정렬용: 나쁜 상태가 먼저 (critical → warning → unknown → ok) */
export function compareStatusDesc(a: Status, b: Status): number {
  return RANK[b] - RANK[a];
}

/** 이유 목록을 나쁜 순서로 정렬 (같은 등급은 원래 순서 유지) */
export function sortReasons(reasons: Reason[]): Reason[] {
  return reasons
    .map((r, i) => ({ r, i }))
    .sort((x, y) => RANK[y.r.status] - RANK[x.r.status] || x.i - y.i)
    .map((x) => x.r);
}

export function reason(code: string, text: string, status: Status): Reason {
  return { code, text, status };
}

/** 이유 목록에서 상태를 만든다. ok 등급 이유(정보성)는 남기되 status 계산에는 최악만 쓴다. */
export function statusFromReasons(
  reasons: Reason[],
  base: Status = 'ok',
): { status: Status; reasons: Reason[] } {
  const sorted = sortReasons(reasons);
  return {
    status: worstStatus([base, ...sorted.map((r) => r.status)]),
    reasons: sorted,
  };
}

export function isoNow(now: number = Date.now()): string {
  return new Date(now).toISOString();
}

export function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "3분", "1시간 5분" */
export function formatDurationKo(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

/**
 * 키별 상태 변경 시각을 기억한다 (StatusInfo.statusChangedAt).
 * 처음 본 키는 최초 판단 시각을 쓴다.
 */
export class StatusChangeTracker {
  private readonly map = new Map<string, { status: Status; at: string }>();

  track(key: string, status: Status, nowIso: string): string {
    const prev = this.map.get(key);
    if (!prev || prev.status !== status) {
      this.map.set(key, { status, at: nowIso });
      return nowIso;
    }
    return prev.at;
  }

  forget(key: string): void {
    this.map.delete(key);
  }

  /** 지금 존재하는 키 집합에 없는 기록을 지운다 */
  retain(keys: Set<string>, prefix = ''): void {
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix) && !keys.has(k)) this.map.delete(k);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * 연속 N회 조건 (명세 3.0 지속 조건): 올릴 때는 N회 연속 만족해야, 내릴 때는 즉시.
 * unknown은 지속 조건 없이 바로 반영하고 연속 횟수를 초기화한다.
 */
export class SustainTracker {
  private readonly map = new Map<
    string,
    { effective: Status; warnStreak: number; critStreak: number }
  >();

  constructor(private samples: number = 3) {}

  setSamples(n: number): void {
    this.samples = Math.max(1, Math.floor(n));
  }

  /** 이번 표본의 순간 상태를 넣고 지속 조건을 적용한 상태를 받는다 */
  apply(key: string, instant: Status): Status {
    const cur = this.map.get(key) ?? {
      effective: 'ok' as Status,
      warnStreak: 0,
      critStreak: 0,
    };
    if (instant === 'unknown') {
      this.map.set(key, { effective: 'unknown', warnStreak: 0, critStreak: 0 });
      return 'unknown';
    }
    const warnStreak =
      instant === 'warning' || instant === 'critical' ? cur.warnStreak + 1 : 0;
    const critStreak = instant === 'critical' ? cur.critStreak + 1 : 0;
    const supported: Status =
      critStreak >= this.samples
        ? 'critical'
        : warnStreak >= this.samples
          ? 'warning'
          : 'ok';
    const prev: Status = cur.effective === 'unknown' ? 'ok' : cur.effective;
    let effective: Status;
    if (statusRank(instant) <= statusRank(prev)) {
      effective = instant; // 내림·유지: 즉시
    } else {
      effective = statusRank(supported) > statusRank(prev) ? supported : prev;
    }
    this.map.set(key, { effective, warnStreak, critStreak });
    return effective;
  }

  forget(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
