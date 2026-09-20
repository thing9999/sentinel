import type { ThresholdLine } from "@/charts";

/** 서버 임계값 → 차트 임계선 (status.md 4.4 라벨 `주의 70%` / `장애 90%`) */
export function thresholdLines(th: { warnPct: number; critPct: number | null } | undefined): ThresholdLine[] {
  if (!th) return [];
  const lines: ThresholdLine[] = [{ level: "warn", value: th.warnPct, label: `주의 ${th.warnPct}%` }];
  if (th.critPct !== null) lines.push({ level: "crit", value: th.critPct, label: `장애 ${th.critPct}%` });
  return lines;
}
