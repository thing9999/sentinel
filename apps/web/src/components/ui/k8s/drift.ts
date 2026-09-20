import { formatTime } from "../format";
import type { IconName } from "../icons";
import type { DriftKind, IsoTime } from "../types";

/** status.md 10.3: 모양(사각형 + 기호)과 문구로 구분한다. 색은 모두 text.secondary(빨강·초록 없음) */
export const DRIFT_KIND: Record<DriftKind, { icon: IconName | null; short: string; label: string }> = {
  changed: { icon: "square-dot", short: "변경", label: "변경됨" },
  deleted: { icon: "square-minus", short: "삭제", label: "삭제됨" },
  added: { icon: "square-plus", short: "추가", label: "추가됨" },
  same: { icon: null, short: "같음", label: "같음" },
};

/** 표시 순서: 변경 → 삭제 → 추가 (status.md 10.2) */
export const DRIFT_KIND_ORDER: DriftKind[] = ["changed", "deleted", "added"];

/** API `counts` 필드 이름 그대로 */
export interface DriftBreakdown {
  changed?: number;
  deleted?: number;
  added?: number;
}

/** `변경 2 · 삭제 1` (0인 구분은 생략, 순서 변경 → 삭제 → 추가). 모두 0이면 빈 문자열 */
export function formatDriftBreakdown(b: DriftBreakdown): string {
  return DRIFT_KIND_ORDER.filter((k) => (b[k as keyof DriftBreakdown] ?? 0) > 0)
    .map((k) => `${DRIFT_KIND[k].short} ${(b[k as keyof DriftBreakdown] ?? 0).toLocaleString("en-US")}`)
    .join(" · ");
}

/** `차이 3건` / `차이 없음` */
export function formatDriftCount(count: number): string {
  return count > 0 ? `차이 ${count.toLocaleString("en-US")}건` : "차이 없음";
}

export interface DriftLastResult {
  state: "changed" | "none";
  count?: number;
  computedAt: IsoTime;
}

/**
 * 계산 안 함일 때 2줄 문구 (k8s-snapshot.md 3.5): `지난 결과 차이 3건 · 9월 18일 14:02` / `지난 결과 차이 없음 · …`.
 * 시각은 status.md 6절 auto(오늘이면 HH:mm:ss). now 는 테스트용.
 */
export function formatDriftLastResult(r: DriftLastResult, now?: number | Date): string {
  const what = r.state === "changed" ? formatDriftCount(r.count ?? 0) : "차이 없음";
  return `지난 결과 ${what} · ${formatTime(r.computedAt, "autoShort", now)}`;
}
