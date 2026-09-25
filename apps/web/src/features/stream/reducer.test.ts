import { describe, expect, it } from "vitest";

import { buildFixtures } from "../__fixtures__/fixtures";
import type { StreamEnvelope } from "../common/types";
import { applyBatch, applyEvent, initialStreamState, type StreamEventInput, type StreamState } from "./reducer";

const NOW = Date.parse("2026-09-19T05:02:10.000Z");
const fx = buildFixtures(NOW);

let seq = 0;
function ev(type: string, payload: unknown, receivedAt = NOW): StreamEventInput {
  const topic = type.split(".")[0] as StreamEnvelope["topic"];
  return { type, envelope: { seq: ++seq, topic, emittedAt: new Date(receivedAt).toISOString(), payload }, receivedAt };
}

function connected(): StreamState {
  return applyBatch(initialStreamState, [
    ev("stream.hello", fx.hello),
    ev("overview.snapshot", fx.overview),
    ev("cluster.snapshot", fx.clusterSnapshot),
    ev("metrics.snapshot", fx.metricsSnapshot),
    ev("db.snapshot", fx.db),
    ev("cost.snapshot", fx.cost),
    ev("advisor.snapshot", fx.advisor),
  ]);
}

describe("stream reducer — 연결·스냅샷", () => {
  it("hello: dataSource·출처·서버 시각 보정·heartbeat 시각을 기록하고 seq 를 새로 시작한다", () => {
    const serverTime = new Date(NOW + 2000).toISOString();
    const s = applyEvent({ ...initialStreamState, lastSeq: 99 }, ev("stream.hello", { ...fx.hello, serverTime }, NOW));
    expect(s.dataSource).toBe("mock");
    expect(s.sources.kube?.state).toBe("mock");
    expect(s.serverOffsetMs).toBe(2000);
    expect(s.lastHeartbeatAt).toBe(NOW);
    expect(s.lastSeq).toBeGreaterThan(0);
  });

  it("cluster.snapshot 은 행을 키로 정규화하고, 다시 오면 통째로 교체한다", () => {
    const s = connected();
    expect(Object.keys(s.cluster!.pods)).toContain("prod/api-7f9c8d6b5-x2kq9");
    // 스냅샷 nodes 에는 마스터 3대가 함께 온다 (계약 8.2). 화면이 role 로 나눈다
    expect(Object.keys(s.cluster!.nodes)).toHaveLength(9);

    const next = applyEvent(s, ev("cluster.snapshot", { ...fx.clusterSnapshot, pods: fx.clusterSnapshot.pods.slice(0, 2), nodes: [] }));
    expect(Object.keys(next.cluster!.pods)).toHaveLength(2);
    expect(Object.keys(next.cluster!.nodes)).toHaveLength(0);
    expect(next.snapshotAt.cluster).toBe(NOW);
  });

  it("cluster.controlplane.updated 는 기존 cluster 토픽 이벤트이고 단일 객체를 통째로 교체한다 (계약 8.2)", () => {
    const s = connected();
    expect(s.cluster!.controlPlane.components.items).toHaveLength(15);
    expect(s.cluster!.controlPlane.masters.ready).toBe(2);

    const next = applyEvent(
      s,
      ev("cluster.controlplane.updated", {
        ...fx.controlPlane,
        headline: "쿼럼 상실 — 마스터 1/3 Ready",
        masters: { ...fx.controlPlane.masters, ready: 1, quorum: { ...fx.controlPlane.masters.quorum, state: "lost" as const } },
      }),
    );
    expect(next.cluster!.controlPlane.headline).toBe("쿼럼 상실 — 마스터 1/3 Ready");
    expect(next.cluster!.controlPlane.masters.quorum.state).toBe("lost");
    // 새 토픽을 만들지 않았다 — 같은 `cluster` 토픽이고 나머지 캐시는 그대로다
    expect(next.cluster!.nodes).toBe(s.cluster!.nodes);
    expect(next.cluster!.pods).toBe(s.cluster!.pods);
  });

  it("재연결(hello)만으로는 값을 지우지 않는다 (새 스냅샷이 올 때 교체)", () => {
    const s = connected();
    const re = applyEvent(s, ev("stream.hello", fx.hello, NOW + 60_000));
    expect(re.cluster).toBe(s.cluster);
    expect(re.cost).toBe(s.cost);
    expect(re.lastHeartbeatAt).toBe(NOW + 60_000);
  });
});

describe("stream reducer — 변경분 병합", () => {
  it("pod.upsert 는 행 전체 교체, 새 키면 추가 / pod.delete 는 삭제", () => {
    const s = connected();
    const pod = fx.clusterSnapshot.pods[0];
    const up = applyEvent(s, ev("cluster.pod.upsert", { item: { ...pod, restarts: { ...pod.restarts, last1h: 9 } } }));
    expect(up.cluster!.pods[pod.key].restarts.last1h).toBe(9);
    // 다른 행 객체는 그대로(참조 유지)
    const other = fx.clusterSnapshot.pods[1].key;
    expect(up.cluster!.pods[other]).toBe(s.cluster!.pods[other]);

    const added = applyEvent(up, ev("cluster.pod.upsert", { item: { ...pod, key: "prod/new-pod", name: "new-pod" } }));
    expect(added.cluster!.pods["prod/new-pod"]).toBeDefined();

    const del = applyEvent(added, ev("cluster.pod.delete", { key: pod.key, namespace: pod.namespace, name: pod.name }));
    expect(del.cluster!.pods[pod.key]).toBeUndefined();
  });

  it("node·workload·event·pvc 변경분도 같은 규칙 (node 는 name, 나머지는 key)", () => {
    let s = connected();
    const n = fx.clusterSnapshot.nodes[2];
    s = applyEvent(s, ev("cluster.node.upsert", { item: { ...n, unschedulable: true } }));
    expect(s.cluster!.nodes[n.name].unschedulable).toBe(true);
    s = applyEvent(s, ev("cluster.node.delete", { name: n.name }));
    expect(s.cluster!.nodes[n.name]).toBeUndefined();

    const w = fx.clusterSnapshot.workloads[0];
    s = applyEvent(s, ev("cluster.workload.delete", { key: w.key, kind: w.kind, namespace: w.namespace, name: w.name }));
    expect(s.cluster!.workloads[w.key]).toBeUndefined();

    const e = fx.clusterSnapshot.events[0];
    s = applyEvent(s, ev("cluster.event.upsert", { item: { ...e, count: 13 } }));
    expect(s.cluster!.events[e.key].count).toBe(13);
    s = applyEvent(s, ev("cluster.event.delete", { key: e.key }));
    expect(s.cluster!.events[e.key]).toBeUndefined();

    const p = fx.clusterSnapshot.pvcs[0];
    s = applyEvent(s, ev("cluster.pvc.delete", { key: p.key, namespace: p.namespace, name: p.name }));
    expect(s.cluster!.pvcs[p.key]).toBeUndefined();
  });

  it("스냅샷 전에 온 변경분은 무시한다 (계약상 오지 않지만 방어)", () => {
    const s = applyEvent(initialStreamState, ev("cluster.pod.upsert", { item: fx.clusterSnapshot.pods[0] }));
    expect(s.cluster).toBeNull();
  });

  it("cluster.summary.updated 는 areas·관측 구간만 바꾸고 행은 유지한다", () => {
    const s = connected();
    const areas = { ...fx.clusterSnapshot.areas, nodes: { ...fx.clusterSnapshot.areas.nodes, ready: 6 } };
    const next = applyEvent(s, ev("cluster.summary.updated", { areas, restartObservation: { observedSec: 3600, fullWindow: true }, thresholds: fx.clusterSnapshot.thresholds }));
    expect(next.cluster!.areas.nodes.ready).toBe(6);
    expect(next.cluster!.restartObservation.fullWindow).toBe(true);
    expect(next.cluster!.pods).toBe(s.cluster!.pods);
  });

  it("overview.updated·db.updated 는 전체 교체", () => {
    const s = connected();
    const ov = applyEvent(s, ev("overview.updated", { ...fx.overview, attention: { total: 0, items: [] } }));
    expect(ov.overview!.attention.total).toBe(0);
    const db = applyEvent(s, ev("db.updated", { ...fx.db, configured: false }));
    expect(db.db!.configured).toBe(false);
  });

  it("metrics.updated: 합계 교체 + 추이 끝점 추가(같은 t 는 교체) + 사용량 목록 교체, 1시간 넘은 표본은 버린다", () => {
    const s = connected();
    const before = s.metrics!.clusterSeries.points.length;
    const lastT = Date.parse(s.metrics!.clusterSeries.points[before - 1].t);
    const pt = { ...s.metrics!.clusterSeries.points[before - 1], t: new Date(lastT + 15_000).toISOString(), cpuPct: 99 };
    const next = applyEvent(
      s,
      ev("metrics.updated", {
        collectedAt: pt.t,
        available: true,
        unavailableReason: null,
        cluster: { cpu: s.metrics!.cluster.cpu, memory: s.metrics!.cluster.memory, updatedAt: pt.t },
        clusterPoint: pt,
        nodes: [{ name: "n1", cpuMillicores: 1, memoryBytes: 2, cpuPct: 3, memoryPct: 4 }],
        pods: [],
      }),
    );
    const pts = next.metrics!.clusterSeries.points;
    expect(pts[pts.length - 1].cpuPct).toBe(99);
    // 1시간 창: 마지막 표본 기준 3600초보다 오래된 표본은 없다
    const first = Date.parse(pts[0].t);
    expect(Date.parse(pts[pts.length - 1].t) - first).toBeLessThanOrEqual(3600_000);
    expect(pts.length).toBeLessThanOrEqual(before + 1);
    expect(Object.keys(next.metrics!.nodes)).toEqual(["n1"]);
    expect(next.metrics!.pods).toEqual({});
    expect(next.metrics!.collectedAt).toBe(pt.t);
  });

  it("cost: 스냅샷 교체, *.updated 는 해당 블록만, rate.sampled 는 점 추가", () => {
    const s = connected();
    const est = { ...fx.cost.estimate, unpricedCount: 5 };
    const a = applyEvent(s, ev("cost.estimate.updated", { estimate: est, allocation: fx.cost.allocation, summary: fx.cost.summary }));
    expect(a.cost!.estimate.unpricedCount).toBe(5);
    expect(a.cost!.actual).toBe(s.cost!.actual);

    const r = applyEvent(a, ev("cost.refresh.updated", { refresh: { ...fx.cost.refresh, state: "refreshing" } }));
    expect(r.cost!.refresh.state).toBe("refreshing");

    const p1 = { t: "2026-09-19T05:05:00.000Z", usdPerHour: 1.2, status: "warning" };
    const p2 = { t: "2026-09-19T05:10:00.000Z", usdPerHour: 1.3, status: "warning" };
    const sampled = applyBatch(r, [
      ev("cost.rate.sampled", { point: p1, baseline: fx.rateSeries("7d").baseline }),
      ev("cost.rate.sampled", { point: p2, baseline: fx.rateSeries("7d").baseline }),
      ev("cost.rate.sampled", { point: { ...p2, usdPerHour: 1.31 }, baseline: fx.rateSeries("7d").baseline }),
    ]);
    expect(sampled.costRate.points.map((p) => p.usdPerHour)).toEqual([1.2, 1.31]);

    // 새 스냅샷이면 추가 점을 비운다 (REST rate-series 를 다시 받는다)
    const snap = applyEvent(sampled, ev("cost.snapshot", fx.cost));
    expect(snap.costRate.points).toEqual([]);
  });

  it("advisor: progress 는 activeRun, finished 는 activeRun 해제·lastRun·latestResult·이력 수 갱신", () => {
    const s = connected();
    const running = { ...fx.latestResult, id: "run-1", status: "running" as const, suggestions: null };
    const p = applyEvent(s, ev("advisor.run.progress", { run: running }));
    expect(p.advisor!.state.activeRun?.id).toBe("run-1");

    const done = { ...fx.latestResult, id: "run-1", status: "succeeded" as const };
    const f = applyEvent(p, ev("advisor.run.finished", { run: done, history: { total: 3 } }, NOW + 1000));
    expect(f.advisor!.state.activeRun).toBeNull();
    expect(f.advisor!.state.lastRun?.id).toBe("run-1");
    expect(f.advisor!.state.latestResult?.id).toBe("run-1");
    expect(f.advisor!.state.history.total).toBe(3);
    expect(f.advisor!.lastFinished?.receivedAt).toBe(NOW + 1000);

    // 실패는 latestResult(마지막 성공)를 유지한다
    const failed = applyEvent(f, ev("advisor.run.finished", { run: { ...fx.failedRun, id: "run-2" }, history: { total: 4 } }));
    expect(failed.advisor!.state.latestResult?.id).toBe("run-1");
    expect(failed.advisor!.state.lastRun?.status).toBe("failed");
  });

  it("stream.source 는 출처 하나만 바꾼다", () => {
    const s = connected();
    const next = applyEvent(s, ev("stream.source", { source: { ...fx.hello.sources[0], state: "stale" } }));
    expect(next.sources.kube?.state).toBe("stale");
    expect(next.sources.metrics).toBe(s.sources.metrics);
  });

  it("applyBatch 는 순서대로 모두 반영하고 lastEventAt·lastSeq 를 마지막 이벤트로 둔다", () => {
    const s = applyBatch(initialStreamState, [ev("stream.hello", fx.hello, NOW), ev("stream.heartbeat", { serverTime: new Date(NOW + 15_000).toISOString() }, NOW + 15_000)]);
    expect(s.lastEventAt).toBe(NOW + 15_000);
    expect(s.lastHeartbeatAt).toBe(NOW + 15_000);
    expect(s.lastSeq).toBe(seq);
  });
});
