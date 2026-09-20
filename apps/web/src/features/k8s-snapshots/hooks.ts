"use client";

/**
 * k8s-snapshots 토픽 구독과 화면 공용 훅.
 * 스트림에는 요약·바뀐 ID·드리프트 배지만 오고(계약 13절), 목록·상세·휴지통·드리프트 결과는 REST 로 다시 조회한다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isApiError } from "@/lib/api";

import { createBoolStore } from "../aws-snapshots/hooks";
import { errorBody, useApi, usePageVisible, useUrlQuery } from "../common/hooks";
import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { sourcesStale, type StaleMark } from "../stream/stale";
import { driftPath, requestDrift } from "./api";
import { isMarkFilter, isRuleId, joinCsv, parseCsv, type GraphQuery } from "./graph/query";
import { parseDriftKind, parseView, type DetailView, type DriftListKind } from "./model";
import type { DriftBadge, DriftResponse, K8sSnapshotSummary } from "./types";

const K8S_TOPICS = ["k8s-snapshots"] as const;

export interface K8sSnapshotsView {
  summary: K8sSnapshotSummary | null;
  dataSource: "mock" | "live" | null;
  /** `.snapshot`·`.changed` 수 (목록 재조회 키) */
  seq: number;
  resetSeq: number;
  changedSeq: (id: string) => number;
  removedSeq: (id: string) => number;
  trashSeq: number;
  /** `k8s-snapshots.drift` 로 받은 배지 (없으면 undefined) */
  driftFor: (id: string) => DriftBadge | undefined;
  driftSeq: (id: string) => number;
  /** 파일 상태 stale (폴더 확인 90초 실패 또는 출처 stale) */
  mark: StaleMark;
  /** 드리프트 값의 stale 은 kube 출처를 따른다(13절) */
  kubeStale: boolean;
}

/** k8s 스냅샷 화면이 떠 있는 동안 `k8s-snapshots` 토픽을 구독한다 */
export function useK8sSnapshotsView(fallbackSummary?: K8sSnapshotSummary | null): K8sSnapshotsView {
  useTopics(K8S_TOPICS);
  const { stream } = useStreamStore();
  const s = stream.k8sSnapshots;
  const summary = s?.summary ?? fallbackSummary ?? null;
  const stale = Boolean(summary?.status.stale) || sourcesStale(stream.sources, ["k8sSnapshotStore"]);
  const changed = s?.changed;
  const removed = s?.removed;
  const drift = s?.drift;
  const driftSeqMap = s?.driftSeq;
  const changedSeq = useCallback((id: string) => changed?.[id] ?? 0, [changed]);
  const removedSeq = useCallback((id: string) => removed?.[id] ?? 0, [removed]);
  const driftFor = useCallback((id: string) => drift?.[id], [drift]);
  const driftSeq = useCallback((id: string) => driftSeqMap?.[id] ?? 0, [driftSeqMap]);
  return {
    summary,
    dataSource: stream.dataSource,
    seq: s?.seq ?? 0,
    resetSeq: s?.resetSeq ?? 0,
    changedSeq,
    removedSeq,
    trashSeq: s?.trashSeq ?? 0,
    driftFor,
    driftSeq,
    mark: { stale, at: stale ? (summary?.lastCheckedAt ?? summary?.status.updatedAt ?? undefined) : undefined },
    kubeStale: sourcesStale(stream.sources, ["kube"]),
  };
}

/** 새 스냅샷 만들기 안내 펼침 (디자인 3.6 `sentinel.snapshots.k8s.cliGuide`, AWS 와 따로) */
export const k8sCliGuideStore = createBoolStore("sentinel.snapshots.k8s.cliGuide", false);

// ---------------------------------------------------------------- 상세 URL 쿼리 (디자인 2.2)

export interface DetailQuery extends GraphQuery {
  view: DetailView;
  file: string | null;
  line: number | null;
  res: string | null;
  kind: DriftListKind;
  hidden: boolean;
}

const parseEnum = <T extends string>(v: string | null, allowed: readonly T[]): T | null =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : null;

function parseDetailQuery(params: URLSearchParams): DetailQuery {
  const line = Number(params.get("line"));
  const grel = parseCsv(params.get("grel")).filter(isRuleId);
  return {
    view: parseView(params.get("view")),
    file: params.get("file") || null,
    line: Number.isInteger(line) && line > 0 ? line : null,
    res: params.get("res") || null,
    kind: parseDriftKind(params.get("kind")),
    hidden: params.get("hidden") === "1",
    // 3D 보기 전용(`g` 접두사, 디자인 2.2). 기존 5개 이름과 겹치지 않는다
    gview: parseEnum(params.get("gview"), ["3d", "table"] as const),
    gns: parseCsv(params.get("gns")),
    gkind: parseCsv(params.get("gkind")),
    grel: params.get("grel") === null ? null : grel,
    gmark: parseCsv(params.get("gmark")).filter(isMarkFilter),
    gq: params.get("gq") ?? "",
    glabels: parseEnum(params.get("glabels"), ["all", "selected", "off"] as const),
    gfocus: params.get("gfocus") === "1",
    gdrift: params.get("gdrift") !== "0",
  };
}

function serializePatch(p: Partial<DetailQuery>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if ("view" in p) out.view = p.view === "files" ? null : (p.view ?? null);
  if ("file" in p) out.file = p.file ?? null;
  if ("line" in p) out.line = p.line ? String(p.line) : null;
  if ("res" in p) out.res = p.res ?? null;
  if ("kind" in p) out.kind = p.kind && p.kind !== "all" ? p.kind : null;
  if ("hidden" in p) out.hidden = p.hidden ? "1" : null;
  if ("gview" in p) out.gview = p.gview ?? null;
  if ("gns" in p) out.gns = joinCsv(p.gns ?? []);
  if ("gkind" in p) out.gkind = joinCsv(p.gkind ?? []);
  if ("grel" in p) out.grel = p.grel === null || p.grel === undefined ? null : p.grel.join(",") || "none";
  if ("gmark" in p) out.gmark = joinCsv(p.gmark ?? []);
  if ("gq" in p) out.gq = p.gq?.trim() ? p.gq : null;
  if ("glabels" in p) out.glabels = p.glabels ?? null;
  if ("gfocus" in p) out.gfocus = p.gfocus ? "1" : null;
  if ("gdrift" in p) out.gdrift = p.gdrift === false ? "0" : null;
  return out;
}

/**
 * 상세 화면 상태를 URL 쿼리(`?view=&file=&line=&res=&kind=&hidden=`)에 둔다.
 * 화면 안 조작은 바로 반영하고 URL 을 replace 로 맞춘다. 링크·뒤로 가기로 URL 이 바뀌면 그 값을 따른다.
 */
export function useDetailQuery(): [DetailQuery, (patch: Partial<DetailQuery>) => void] {
  const q = useUrlQuery();
  const search = q.params.toString();
  const fromUrl = useMemo(() => parseDetailQuery(new URLSearchParams(search)), [search]);
  const [st, setSt] = useState<{ search: string; value: DetailQuery }>({ search, value: fromUrl });
  let value = st.value;
  if (st.search !== search) {
    setSt({ search, value: fromUrl });
    value = fromUrl;
  }
  const { set } = q;
  const patch = useCallback(
    (p: Partial<DetailQuery>) => {
      setSt((s) => ({ ...s, value: { ...s.value, ...p } }));
      set(serializePatch(p));
    },
    [set],
  );
  return [value, patch];
}

// ---------------------------------------------------------------- 드리프트 결과·계산·임대 (계약 10.8·10.9)

export type DriftRequestError = { kind: "failed"; text: string } | null;

const newer = (a: DriftResponse | undefined, b: DriftResponse | null): DriftResponse | undefined => {
  if (!b) return a;
  if (!a) return b;
  return b.generatedAt > a.generatedAt ? b : a;
};

/**
 * 드리프트 탭 데이터.
 * - 조회: 탭이 열려 있을 때만 `GET …/drift`. `k8s-snapshots.drift`(이 스냅샷)·재연결이 오면 다시 조회(13절).
 * - 계산: `POST …/drift {force:true}`(버튼). 응답 대기 동안 pending.
 * - 임대: 탭이 열려 있고 응답에 `lease`가 있으면 `renewAfterSec`(60초)마다 `{force:false}`로 갱신(10.8).
 *   탭을 떠나거나 페이지를 떠나면(언마운트) 갱신을 멈춘다 → 서버는 최대 120초 뒤 자동 계산을 멈춘다.
 *   브라우저 탭이 숨겨지면 갱신을 멈추고, 다시 보이면 결과를 다시 조회한다(폴링 규칙).
 * - 409 K8S_DRIFT_UNAVAILABLE: 버튼이 이미 비활성이어야 정상. 경쟁이면 배지를 다시 조회한다(onUnavailable).
 */
export function useDriftData(id: string, active: boolean, view: K8sSnapshotsView, onUnavailable: () => void) {
  const key = `${view.resetSeq}:${view.driftSeq(id)}:${view.changedSeq(id)}`;
  const q = useApi<DriftResponse>(active ? driftPath(id) : null, undefined, key);
  const [posted, setPosted] = useState<DriftResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DriftRequestError>(null);
  const visible = usePageVisible();
  /** 마지막 임대 요청 시각 (계산 버튼·갱신 POST) */
  const leaseSentAt = useRef<number | null>(null);
  const data = newer(q.data, posted && posted.snapshotId === id ? posted : null);
  const { reload } = q;

  const compute = useCallback(
    async (force = true) => {
      setPending(true);
      setError(null);
      try {
        leaseSentAt.current = Date.now();
        const res = await requestDrift(id, force);
        setPosted(res);
      } catch (e) {
        const body = errorBody(e);
        if (body?.code === "K8S_DRIFT_UNAVAILABLE") {
          // 버튼 활성과 서버 판단이 어긋났다: 배지를 다시 조회해 알 수 없음 모습으로 바꾼다(6.8)
          reload();
          onUnavailable();
        } else {
          const net = isApiError(e) && (e.kind === "network" || e.kind === "timeout");
          setError({ kind: "failed", text: net ? "API에 연결하지 못했습니다" : (body?.message ?? (isApiError(e) ? e.message : "알 수 없는 오류")) });
        }
      } finally {
        setPending(false);
      }
    },
    [id, reload, onUnavailable],
  );

  // 임대 갱신: 마지막 임대 요청(계산·갱신 POST) 시각 기준으로 renewAfterSec 마다.
  // 결과 재조회(SSE `.drift`로 자주 온다)마다 타이머를 다시 걸면 60초에 닿지 못하므로 응답 시각을 기준으로 삼지 않는다.
  const hasLease = active && visible && Boolean(data?.lease);
  const renewSec = Math.max(5, data?.lease?.renewAfterSec || 60);
  useEffect(() => {
    if (!hasLease) return;
    if (leaseSentAt.current === null) leaseSentAt.current = Date.now();
    const t = setInterval(() => {
      if (Date.now() - (leaseSentAt.current ?? 0) < renewSec * 1000) return;
      leaseSentAt.current = Date.now();
      requestDrift(id, false)
        .then((res) => setPosted(res))
        .catch(() => {
          // 갱신 실패는 조용히 넘긴다(다음 조회·SSE 로 배지가 바뀐다)
        });
    }, 1000);
    return () => clearInterval(t);
  }, [hasLease, renewSec, id]);

  // 다시 보이면 결과를 다시 조회한다(숨김 동안 임대가 끝났을 수 있음)
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible && active) reload();
  }

  return {
    data,
    loading: q.loading && !data,
    loadError: q.error,
    pending,
    error,
    compute: (force = true) => void compute(force),
    clearError: () => setError(null),
    reload,
  };
}

export type DriftData = ReturnType<typeof useDriftData>;
