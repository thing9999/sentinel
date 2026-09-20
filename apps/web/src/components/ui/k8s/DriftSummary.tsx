"use client";

import { useState, type ReactNode } from "react";

import { Button } from "../controls/Button";
import { Switch } from "../controls/Switch";
import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { Spinner } from "../feedback/Spinner";
import { formatTime } from "../format";
import { Icon } from "../icons";
import { Chip } from "../status/Chip";
import { ReasonText } from "../status/ReasonText";
import type { DriftKind, IsoTime } from "../types";
import { formatDriftCount } from "./drift";
import { DriftKindIcon, DriftStatus, type DriftStatusProps } from "./DriftStatus";
import styles from "./k8s.module.css";

/** API `drift.counts` 필드 이름 그대로 */
export interface DriftCounts {
  changed: number;
  deleted: number;
  added: number;
  same: number;
  compared: number;
}

/** API `uncomparable[]` 그대로 */
export interface DriftNotComparable {
  /** 종류 이름 (예 `ConfigMap`, 사용자 지정은 `plural.group`) */
  kind: string;
  count: number;
  /** `NOT_IN_RBAC` 실선 / `FORBIDDEN` dashed `· 권한 거부` / `API_VERSION_MISMATCH` dashed `· API 버전 다름` / 그 밖 실선 */
  reason: "NOT_IN_RBAC" | "FORBIDDEN" | "API_VERSION_MISMATCH" | (string & {});
  /** 서버 문구 (툴팁) */
  text: string;
}

/** API `drift.mode` 중 요약 카드가 그리는 값 */
export type DriftMode = "auto" | "on_demand" | "last_result";

export type DriftFilter = DriftKind | "all";

export interface DriftSummaryProps {
  /** 줄 ① 배지 (size 는 lg 로 고정) */
  status: Omit<DriftStatusProps, "size">;
  /** 서버 사유 (예 `변경 2 · 삭제 1`, `비교 42개, 비교 불가 11개`) */
  reason?: string[];
  /** `15:12:04 계산` (오늘이 아니면 날짜 포함) */
  computedAt?: IsoTime;
  /** API `target`. `비교 대상 prod-eks (sentinel-prod)` */
  target?: { name: string; context?: string | null };
  /** API `drift.mode` 그대로. 줄 ① 둘째 줄 문구 (k8s-snapshot.md 6.3) */
  mode?: DriftMode;
  /** API `computing`: Spinner + `갱신 중 · ` (값은 그대로 둔다) */
  refreshing?: boolean;
  /** on_demand: `다시 계산` secondary sm / last_result: primary sm */
  onRecompute?: () => void;
  recomputeLoading?: boolean;
  /** 줄 ② 칸 (없으면 줄 없음) */
  counts?: DriftCounts;
  /** 현재 목록 필터 → 칸 aria-pressed */
  activeFilter?: DriftFilter;
  /** 칸 클릭. `same`을 누르면 호출 측이 `전체` + 숨긴 차이 켬으로 처리한다(k8s-snapshot.md 6.3) */
  onFilter?: (filter: DriftKind) => void;
  /** API `counts.hidden` 그대로. 줄 ③, 합 0 이면 줄 없음 */
  hidden?: { default: number; managed: number };
  showHidden?: boolean;
  onShowHiddenChange?: (v: boolean) => void;
  /** 줄 ④ 비교 불가 종류 (API `uncomparable[]`, 서버 순서) */
  notComparable?: DriftNotComparable[];
  /** API `counts.uncomparable` → `비교 불가 N개` (없으면 notComparable 개수 합) */
  totalUncomparable?: number;
  /** 줄 ④ 칩 최대 개수, 기본 8. 넘으면 `외 N종` */
  notComparableMax?: number;
  /** 줄 ⑤ InlineAlert neutral compact 들 */
  notices?: ReactNode[];
  /**
   * loading: 스켈레톤 / stale: 카드 dashed status.stale.border, 수치 valueText 색 /
   * lastResult: 카드 dashed border.strong + 배지 앞 caption `지난 결과`
   */
  state?: "ready" | "loading" | "stale" | "lastResult";
  /** 카드 제목(스크린리더 region 이름), 기본 `드리프트 요약` */
  label?: string;
  className?: string;
}

const CELLS: { key: keyof DriftCounts; label: string; kind?: DriftKind }[] = [
  { key: "changed", label: "변경", kind: "changed" },
  { key: "deleted", label: "삭제", kind: "deleted" },
  { key: "added", label: "추가", kind: "added" },
  { key: "same", label: "같음", kind: "same" },
  { key: "compared", label: "비교한 리소스" },
];

const FORBIDDEN_TIP =
  "대시보드 RBAC에는 있지만 클러스터가 읽기를 거부했습니다. deploy/rbac.yaml 적용 상태를 확인하세요.";
const VERSION_TIP =
  "스냅샷 파일의 apiVersion이 대시보드가 읽는 버전과 달라 비교하지 않습니다. 파일을 고쳐 버전을 맞추면 비교합니다.";

const MODE_TEXT: Record<DriftMode, string> = {
  auto: "자동 계산 · 클러스터 변경은 30초 안에 반영",
  on_demand: "요청 계산 · 이 화면을 떠나면 최대 2분 뒤 갱신을 멈춥니다",
  last_result: "지난 결과 · 지금은 갱신하지 않습니다",
};

/** 비교 불가 칩 모양 (k8s-snapshot.md 6.3 ④). 툴팁 = 서버 text + 사유별 안내 (줄마다 한 항목) */
export function notComparableChip(n: Pick<DriftNotComparable, "kind" | "count" | "reason" | "text">): {
  label: string;
  dashed: boolean;
  tooltip: string[];
} {
  const base = `${n.kind} ${n.count.toLocaleString("en-US")}`;
  const lines = (extra?: string) => [n.text, extra ?? ""].filter((x) => x && x.trim() !== "");
  if (n.reason === "FORBIDDEN") return { label: `${base} · 권한 거부`, dashed: true, tooltip: lines(FORBIDDEN_TIP) };
  if (n.reason === "API_VERSION_MISMATCH") return { label: `${base} · API 버전 다름`, dashed: true, tooltip: lines(VERSION_TIP) };
  return { label: base, dashed: false, tooltip: lines() };
}

/** `기본값 차이 12건 · 관리 필드 1건 숨김` */
export function hiddenSummaryText(h: { default: number; managed: number }): string {
  const parts = [
    h.default > 0 ? `기본값 차이 ${h.default.toLocaleString("en-US")}건` : "",
    h.managed > 0 ? `관리 필드 ${h.managed.toLocaleString("en-US")}건` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} 숨김` : "";
}

/** 스크린리더 변화 알림 문구 (요약 ①만, k8s-snapshot.md 14절) */
function driftSpoken(status: Pick<DriftStatusProps, "state" | "count">): string | null {
  if (status.state === "changed") return formatDriftCount(status.count ?? 0);
  if (status.state === "none") return "차이 없음";
  if (status.state === "unknown") return "알 수 없음";
  return null;
}

/** `드리프트 차이 3건에서 2건으로 바뀜` (둘 다 건수면 뒤쪽 `차이 ` 생략) */
export function driftChangeText(prev: string, next: string): string {
  const to = /^차이 \d/.test(prev) && /^차이 \d/.test(next) ? next.replace(/^차이 /, "") : next;
  return `드리프트 ${prev}에서 ${to}으로 바뀜`;
}

/**
 * components.md 14.5 / k8s-snapshot.md 6.3. 드리프트 탭 요약 카드.
 * 차이 있음이어도 왼쪽 warn 막대를 두지 않는다(드리프트는 정보). 줄 ①의 값이 바뀌면 polite 로 한 번 알린다.
 */
export function DriftSummary({
  status,
  reason,
  computedAt,
  target,
  mode,
  refreshing = false,
  onRecompute,
  recomputeLoading = false,
  counts,
  activeFilter,
  onFilter,
  hidden,
  showHidden = false,
  onShowHiddenChange,
  notComparable,
  notComparableMax = 8,
  totalUncomparable,
  notices,
  state = "ready",
  label = "드리프트 요약",
  className,
}: DriftSummaryProps) {
  const spoken = state === "loading" ? null : driftSpoken(status);
  // 이전 값과 비교해 바뀌었을 때만 알린다(렌더 중 상태 조정 패턴: effect 없이 한 번 더 렌더)
  const [track, setTrack] = useState<{ spoken: string | null; announce: string }>({ spoken, announce: "" });
  if (spoken !== null && spoken !== track.spoken) {
    setTrack({ spoken, announce: track.spoken === null ? track.announce : driftChangeText(track.spoken, spoken) });
  }
  const announce = track.announce;

  if (state === "loading") {
    return (
      <section className={cx(styles.summary, className)} aria-label={label} aria-busy="true">
        <Skeleton height={160} radius="md" />
      </section>
    );
  }

  const stale = state === "stale";
  const lastResult = state === "lastResult";
  const hiddenText = hidden ? hiddenSummaryText(hidden) : "";
  const nc = notComparable ?? [];
  const ncTotal = totalUncomparable ?? nc.reduce((a, b) => a + b.count, 0);
  const ncShown = nc.slice(0, notComparableMax);
  const ncRest = nc.slice(notComparableMax);

  return (
    <section
      className={cx(styles.summary, stale && styles.summaryStale, lastResult && styles.summaryLast, className)}
      aria-label={label}
      data-state={state}
    >
      {/* ① 상태 */}
      <div className={cx(styles.sumRow, styles.sumHead)}>
        <div className={styles.sumStatus}>
          {lastResult ? <span className={styles.captionTertiary}>지난 결과</span> : null}
          <DriftStatus {...status} size="lg" />
          <ReasonText reasons={reason} />
          <span className="sr-only" role="status" aria-live="polite">
            {announce}
          </span>
        </div>
        <div className={styles.sumMeta}>
          {computedAt || target ? (
            <span className={styles.sumMetaLine}>
              {refreshing ? (
                <>
                  <Spinner size={12} />
                  <span>갱신 중 · </span>
                </>
              ) : null}
              {computedAt ? <span suppressHydrationWarning>{formatTime(computedAt, "auto")} 계산</span> : null}
              {target ? (
                <span>
                  {computedAt ? " · " : ""}비교 대상 <span className={styles.mono}>{target.name}</span>
                  {target.context ? ` (${target.context})` : ""}
                </span>
              ) : null}
            </span>
          ) : null}
          {mode ? (
            <span className={styles.sumMetaLine}>
              <span>{MODE_TEXT[mode] ?? ""}</span>
              {mode !== "auto" && onRecompute ? (
                <Button
                  variant={mode === "last_result" ? "primary" : "secondary"}
                  size="sm"
                  icon="refresh-cw"
                  onClick={onRecompute}
                  loading={recomputeLoading}
                >
                  다시 계산
                </Button>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {/* ② 개수 */}
      {counts ? (
        <div className={cx(styles.sumRow, styles.sumCells)} role="group" aria-label="드리프트 구분별 개수">
          {CELLS.map((c) => {
            const v = counts[c.key] ?? 0;
            const content = (
              <>
                <span className={styles.cellLabel}>{c.label}</span>
                <span className={cx(styles.cellValue, v === 0 && styles.fgTertiary)}>
                  {c.kind && c.kind !== "same" && v > 0 ? <DriftKindIcon kind={c.kind} size={16} title={null} /> : null}
                  {v.toLocaleString("en-US")}
                </span>
              </>
            );
            if (c.kind && onFilter) {
              const kind = c.kind;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={cx(styles.cell, styles.cellButton)}
                  aria-pressed={activeFilter === kind}
                  onClick={() => onFilter(kind)}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={c.key} className={styles.cell}>
                {content}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ③ 숨긴 차이 */}
      {hiddenText ? (
        <div className={cx(styles.sumRow, styles.sumHidden)}>
          <span className={styles.sumHiddenText}>
            <Icon name="eye-off" size={14} className={styles.fgTertiary} />
            <span>{hiddenText}</span>
            <span className={styles.captionTertiary}> (상태·건수에 넣지 않음)</span>
          </span>
          {onShowHiddenChange ? (
            <Switch checked={showHidden} onChange={onShowHiddenChange} label="숨긴 차이 보기" />
          ) : null}
        </div>
      ) : null}

      {/* ④ 비교 불가 */}
      {nc.length > 0 ? (
        <div className={cx(styles.sumRow, styles.sumNc)}>
          <span className={styles.ncLabel}>비교 불가 {ncTotal.toLocaleString("en-US")}개</span>
          <ul className={styles.ncList} aria-label="비교 불가 종류">
            {ncShown.map((n) => {
              const chip = notComparableChip(n);
              return (
                <li key={`${n.kind}-${n.reason}`}>
                  <Chip
                    label={chip.label}
                    icon="eye-off"
                    dashed={chip.dashed}
                    tooltip={
                      chip.tooltip.length > 0 ? (
                        <>
                          {chip.tooltip.map((t, i) => (
                            <span key={i} className={styles.tipLine}>
                              {t}
                            </span>
                          ))}
                        </>
                      ) : undefined
                    }
                  />
                </li>
              );
            })}
            {ncRest.length > 0 ? (
              <li>
                <Chip
                  label={`외 ${ncRest.length.toLocaleString("en-US")}종`}
                  tooltip={ncRest.map((n) => notComparableChip(n).label).join(", ")}
                />
              </li>
            ) : null}
          </ul>
          <span className={styles.captionTertiary}>
            대시보드 권한·버전 밖이라 비교하지 않습니다. 드리프트 상태에 영향이 없습니다.
          </span>
        </div>
      ) : null}

      {/* ⑤ 부분 계산 안내 */}
      {notices && notices.length > 0 ? (
        <div className={cx(styles.sumRow, styles.sumNotices)}>
          {notices.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
