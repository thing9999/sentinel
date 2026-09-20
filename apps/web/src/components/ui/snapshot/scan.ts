import type { IconName } from "../icons";
import type { ScanLevel, Status } from "../types";

/** status.md 9.2: API `level` → 아이콘·문구·상태 색 키. 표에 없는 값은 `알 수 없음` */
export interface ScanLevelSpec {
  key: ScanLevel | "unknown";
  status: Extract<Status, "crit" | "warn" | "unknown">;
  icon: IconName;
  label: string;
  /** 정렬·최악 판단용 (클수록 나쁨) */
  rank: number;
}

export const SCAN_LEVEL: Record<ScanLevel | "unknown", ScanLevelSpec> = {
  error: { key: "error", status: "crit", icon: "octagon-x", label: "오류", rank: 2 },
  warn: { key: "warn", status: "warn", icon: "triangle-alert", label: "경고", rank: 1 },
  unknown: { key: "unknown", status: "unknown", icon: "circle-help", label: "알 수 없음", rank: 0 },
};

const warned = new Set<string>();

/** API 값을 표시 규격으로. 모르는 값은 unknown + 콘솔 경고(값마다 1회) */
export function scanLevelSpec(level: string | null | undefined): ScanLevelSpec {
  if (level === "error" || level === "warn") return SCAN_LEVEL[level];
  const k = String(level);
  if (!warned.has(k) && typeof console !== "undefined") {
    warned.add(k);
    console.warn(`[ui] 알 수 없는 스캔 등급: ${k}`);
  }
  return SCAN_LEVEL.unknown;
}

/** 여러 등급 중 가장 나쁜 것 */
export function worstScanLevel(levels: Array<string | null | undefined>): ScanLevelSpec | null {
  let worst: ScanLevelSpec | null = null;
  for (const l of levels) {
    const s = scanLevelSpec(l);
    if (!worst || s.rank > worst.rank) worst = s;
  }
  return worst;
}
