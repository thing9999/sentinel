"use client";

/**
 * 3D 보기 탭 데이터 (docs/api/snapshot-3d.md).
 *
 * - **조회는 `GET …/graph` 한 번**이다. 드리프트 배지·표식·계산 시각이 응답 안에 있어
 *   3D 탭에서 `GET …/drift` 를 따로 부르지 않는다(백엔드 요청 ①, AC-3D13).
 * - 새 데이터는 `k8s-snapshots.changed`·`.drift` SSE 를 받아 다시 조회한다(새 토픽 없음, 30초 이내 AC-3D16).
 * - "구성이 바뀌었습니다"는 `graph.version` 비교로 판단한다. 표식만 바뀌면 값이 같으므로 말없이 갱신한다(9.8).
 * - 탭을 떠나거나 브라우저 탭이 숨겨지면 임대 갱신을 멈춘다(AC-3D17·3D28).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { errorBody, useApi, usePageVisible } from "../../common/hooks";
import { graphPath, requestDrift } from "../api";
import type { K8sSnapshotsView } from "../hooks";
import type { GraphResponse } from "./types";

export interface GraphChangeNotice {
  blocks: number;
  edges: number;
}

export interface GraphDataState {
  /** 화면에 그리고 있는 응답 (다시 배치 전까지 유지) */
  data: GraphResponse | null;
  /** 구성이 바뀌어 기다리는 새 응답 (다시 배치를 누르면 이것을 그린다) */
  pending: GraphResponse | null;
  loading: boolean;
  error: ReturnType<typeof useApi<GraphResponse>>["error"];
  errorCode: string | null;
  /** 구성이 바뀌어 기다리는 새 응답 */
  change: GraphChangeNotice | null;
  relayout: () => void;
  reload: () => void;
  /** [드리프트 계산] (기존 POST …/drift, 새 엔드포인트 없음) */
  compute: () => void;
  computing: boolean;
  computeError: string | null;
}

export function useGraphData(id: string, active: boolean, view: K8sSnapshotsView): GraphDataState {
  const key = `${view.resetSeq}:${view.changedSeq(id)}:${view.driftSeq(id)}`;
  const q = useApi<GraphResponse>(active ? graphPath(id) : null, undefined, key);
  const [applied, setApplied] = useState<GraphResponse | null>(null);
  const [pending, setPending] = useState<GraphResponse | null>(null);
  const [change, setChange] = useState<GraphChangeNotice | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [seen, setSeen] = useState<GraphResponse | null>(null);
  const visible = usePageVisible();
  const leaseRef = useRef<{ at: number; renewSec: number } | null>(null);

  const incoming = q.data;
  if (incoming && incoming !== seen) {
    setSeen(incoming);
    if (!applied || applied.snapshotId !== incoming.snapshotId || applied.graph.version === incoming.graph.version) {
      // 표식만 바뀌었다 → 말없이 갱신 (카메라·선택 그대로)
      setApplied(incoming);
      setPending(null);
      setChange(null);
    } else {
      setPending(incoming);
      setChange({
        blocks: incoming.graph.summary.blocks - applied.graph.summary.blocks,
        edges: incoming.graph.summary.edges - applied.graph.summary.edges,
      });
    }
  }

  const relayout = useCallback(() => {
    setPending((p) => {
      if (p) setApplied(p);
      return null;
    });
    setChange(null);
  }, []);

  const compute = useCallback(() => {
    setComputing(true);
    setComputeError(null);
    requestDrift(id, true)
      .then((res) => {
        leaseRef.current = res.lease ? { at: Date.now(), renewSec: Math.max(5, res.lease.renewAfterSec || 60) } : null;
        q.reload();
      })
      .catch((e: unknown) => {
        const body = errorBody(e);
        setComputeError(body?.message ?? "드리프트를 계산하지 못했습니다");
        q.reload();
      })
      .finally(() => setComputing(false));
    // q.reload 는 안정적이다(useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, q.reload]);

  // 임대 갱신: 3D 보기를 열어 둔 동안 60초마다 `{force:false}` (기존 규칙 그대로, AC-3D28)
  useEffect(() => {
    if (!active || !visible) return;
    const t = setInterval(() => {
      const lease = leaseRef.current;
      if (!lease) return;
      if (Date.now() - lease.at < lease.renewSec * 1000) return;
      lease.at = Date.now();
      requestDrift(id, false)
        .then((res) => {
          leaseRef.current = res.lease ? { at: Date.now(), renewSec: Math.max(5, res.lease.renewAfterSec || 60) } : null;
        })
        .catch(() => {
          leaseRef.current = null;
        });
    }, 1000);
    return () => clearInterval(t);
  }, [active, visible, id]);

  // 탭을 떠나면 갱신을 멈춘다(임대는 서버에서 최대 120초 뒤 끝난다)
  useEffect(() => {
    if (!active) leaseRef.current = null;
  }, [active]);

  const body = errorBody(q.error);
  return {
    data: applied,
    pending,
    loading: q.loading && !applied,
    error: q.error,
    errorCode: body?.code ?? null,
    change,
    relayout,
    reload: q.reload,
    compute,
    computing,
    computeError,
  };
}
