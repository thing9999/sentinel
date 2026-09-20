"use client";

/**
 * 실시간 재정렬 보류 (status.md 5.2): 사용자가 표 위에 마우스를 올려 두었거나 펼친 행이 있으면
 * 이전 순서를 유지하고 `새 순서로 정렬 (N건 변경)` 을 띄운다.
 */
import { useState } from "react";

export function holdOrder(fresh: readonly string[], held: readonly string[]): { order: string[]; changed: number } {
  const freshSet = new Set(fresh);
  const kept = held.filter((k) => freshSet.has(k));
  const keptSet = new Set(kept);
  const added = fresh.filter((k) => !keptSet.has(k));
  const order = [...kept, ...added];
  let changed = 0;
  for (let i = 0; i < order.length; i++) if (order[i] !== fresh[i]) changed++;
  return { order, changed };
}

export function useStableOrder<T>(rows: readonly T[], key: (row: T) => string, holding: boolean) {
  const [held, setHeld] = useState<string[] | null>(null);
  const fresh = rows.map(key);

  // 보류 시작: 현재 순서를 기억 / 보류 해제: 잊는다 (렌더 중 상태 조정)
  if (holding && held === null) setHeld(fresh);
  if (!holding && held !== null) setHeld(null);

  if (!holding || held === null) return { rows: [...rows], pending: 0, apply: () => setHeld(null) };
  const byKey = new Map(rows.map((r) => [key(r), r] as const));
  const { order, changed } = holdOrder(fresh, held);
  return {
    rows: order.map((k) => byKey.get(k)!).filter(Boolean),
    pending: changed,
    apply: () => setHeld(fresh),
  };
}
