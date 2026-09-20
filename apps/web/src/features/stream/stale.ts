/**
 * 데이터 오래됨(stale) 판정 (docs/api/common.md 2.3, docs/design/status.md 2.1).
 * stale 은 상태 값이 아니라 표시다. 서버 플래그(StatusInfo.stale, stream.source)와
 * 화면 타이머(`updatedAt + 기준`)를 둘 다 본다(서버가 멈춘 경우 대비).
 */
import { badgeFromApi, type Status } from "@/components/ui";

import type { SourceId, SourceStatus, StatusInfo } from "../common/types";
import type { StreamState } from "./reducer";

export const STALE_AFTER_MS = {
  /** watch 기반(노드·파드·워크로드·PVC·이벤트): 마지막 heartbeat + 45초 */
  watch: 45_000,
  metrics: 45_000,
  db: 45_000,
  costEstimate: 15 * 60_000,
  costExplorer: 18 * 3600_000,
  precheck: 15 * 60_000,
  bridge: 90_000,
} as const;

export function parseMs(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** updatedAt 이 기준 시간을 넘겼는지 (서버 시각 보정 포함) */
export function isTimeStale(updatedAt: string | null | undefined, afterMs: number, now: number, serverOffsetMs = 0): boolean {
  const t = parseMs(updatedAt);
  if (t === null) return false;
  return now + serverOffsetMs - t > afterMs;
}

/** 출처 중 하나라도 서버가 stale 로 알렸는지 */
export function sourcesStale(sources: Partial<Record<SourceId, SourceStatus>>, ids: readonly SourceId[]): boolean {
  return ids.some((id) => sources[id]?.state === "stale");
}

export interface StaleMark {
  stale: boolean;
  /** 배지 `데이터 오래됨 · HH:mm:ss 기준` 의 기준 시각 */
  at: string | undefined;
}

/** watch 기반 토픽(cluster): kube 출처 stale 또는 heartbeat 45초 무수신 */
export function watchStale(stream: StreamState, now: number): StaleMark {
  const hb = stream.lastHeartbeatAt;
  const byTimer = hb !== null && now - hb > STALE_AFTER_MS.watch;
  const bySource = sourcesStale(stream.sources, ["kube"]);
  const stale = byTimer || bySource;
  const at = hb !== null ? new Date(hb).toISOString() : (stream.sources.kube?.lastSuccessAt ?? undefined);
  return { stale, at: stale ? at : undefined };
}

/** 주기 조회 데이터(메트릭·DB·비용·사전 점검·브리지): 출처 stale 또는 updatedAt + 기준 경과 */
export function periodicStale(
  stream: StreamState,
  updatedAt: string | null | undefined,
  afterMs: number,
  sourceIds: readonly SourceId[],
  now: number,
): StaleMark {
  const stale = sourcesStale(stream.sources, sourceIds) || isTimeStale(updatedAt, afterMs, now, stream.serverOffsetMs);
  return { stale, at: stale ? (updatedAt ?? undefined) : undefined };
}

/** 블록 자체의 서버 stale 플래그(예: cost `actual.stale`, `estimate.stale`)를 화면 stale 에 합친다 */
export function orServerStale(mark: StaleMark, serverStale: boolean | null | undefined, updatedAt: string | null | undefined): StaleMark {
  if (mark.stale || !serverStale) return mark;
  return { stale: true, at: updatedAt ?? undefined };
}

/**
 * API StatusInfo → StatusBadge props (status.md 8.1). 화면 stale 이면 배지를 stale 로 교체.
 * previousReason 은 툴팁 `마지막 상태: 장애 (이유)` 용.
 */
export function badgeProps(
  info: StatusInfo | null | undefined,
  mark?: StaleMark,
): { status: Status; previousStatus?: Status; staleAt?: string; previousReason?: string } {
  if (!info) return { status: "unknown" };
  const screenStale = Boolean(mark?.stale);
  const b = badgeFromApi(info, screenStale);
  if (b.status === "stale") {
    return {
      ...b,
      staleAt: mark?.at ?? b.staleAt ?? info.updatedAt ?? undefined,
      previousReason: info.reasons[0]?.text,
    };
  }
  return b;
}

/** 판단 이유 문자열 목록 (서버 문자열 그대로) */
export function reasonTexts(info: StatusInfo | null | undefined): string[] {
  return (info?.reasons ?? []).map((r) => r.text);
}
