"use client";

/**
 * 로그 화면 `/logs` (docs/design/logs.md 2·5절, 계약 docs/api/logs.md 11.4).
 *
 * 대상 선택: **네임스페이스 → 워크로드 → 파드 → 컨테이너**(AC-LOG29). 새 엔드포인트 없이 기존 값을 쓴다 —
 * 네임스페이스·워크로드는 이미 구독 중인 `cluster` 토픽, 워크로드 소속 파드는 **서버 정렬**을 위해
 * `GET /api/cluster/pods?namespace=&workload=`, 컨테이너는 `GET /api/logs/targets/*`.
 *
 * - `direct`(`multiPod: false`): 파드 하나. 워크로드를 고르면 파드 선택기를 그 소속으로 좁히고 **서버 목록의 첫 파드**
 *   (= 가장 나쁜 파드)를 고른다. 화면이 다시 고르지 않는다(계약 11.4).
 * - `stack`(`multiPod: true`): 워크로드를 고르면 `selector.workload`로 보내 **서버가** 소속 파드를 푼다
 *   (`selector.resolvedPods` → 파드 선택기). 사용자가 일부만 고르면 `pods[]`(최대 20).
 *
 * 상태는 URL 쿼리에 둔다(뒤로 가기·링크 공유). 들어오는 링크는 서버 `logHref` 그대로다(`follow=1` 또는 `at`).
 * **찾기 입력값만은 URL에 남기지 않는다**(명세 3.3.4).
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { MultiSelect, PageHeader, Select, Skeleton, UnknownState } from "@/components/ui";

import type { PodItem } from "../cluster-status/types";
import { useApi, useUrlQuery } from "../common/hooks";
import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { readLogsQuery } from "./href";
import { LogViewer, type LogTarget } from "./LogViewer";
import styles from "./logs.module.css";
import type { LogCapabilitiesResponse, LogSourceId, LogTargetsResponse } from "./types";

const TOPICS = ["cluster"] as const;
/** 계약 1.4: `pods` 최대 20 */
const MAX_PODS = 20;

export function LogsPage() {
  useTopics(TOPICS);
  const { stream } = useStreamStore();
  const q = useUrlQuery();
  const url = readLogsQuery(q.get);

  const caps = useApi<LogCapabilitiesResponse>("/logs/capabilities");
  const capabilities = caps.data;
  const source = (url.source as LogSourceId | null) ?? capabilities?.activeSource ?? "direct";
  const multiPod = Boolean(capabilities?.sources.find((s) => s.id === source)?.capabilities?.multiPod);

  const allPods = useMemo(() => Object.values(stream.cluster?.pods ?? {}), [stream.cluster]);
  const namespaces = useMemo(() => {
    const set = new Set(allPods.map((p) => p.namespace));
    if (url.namespace) set.add(url.namespace);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allPods, url.namespace]);
  const namespace = url.namespace ?? namespaces[0] ?? null;

  const workloads = useMemo(
    () =>
      Object.values(stream.cluster?.workloads ?? {})
        .filter((w) => w.namespace === namespace)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [stream.cluster, namespace],
  );
  // 다른 네임스페이스의 워크로드 키는 무시한다(URL 을 손으로 고친 경우)
  const workload = url.workload && url.workload.namespace === namespace ? url.workload : null;

  // 워크로드 소속 파드 — **서버 기본 정렬**(상태 나쁜 순 → 최근 1시간 재시작 많은 순)을 쓰려고 REST 로 읽는다
  const wlPods = useApi<{ items: PodItem[] }>(
    workload && namespace ? "/cluster/pods" : null,
    workload && namespace ? { namespace, workload: workload.key } : undefined,
  );
  const nsPods = useMemo(
    () => allPods.filter((p) => p.namespace === namespace).sort((a, b) => a.name.localeCompare(b.name)),
    [allPods, namespace],
  );
  const podChoices = workload ? (wlPods.data?.items ?? []) : nsPods;

  // stack: 서버가 실제로 합쳐 본 파드(워크로드를 풀었을 때). 조회 키가 바뀌면 새로 온다
  const [resolved, setResolved] = useState<{ key: string; pods: string[] | null } | null>(null);
  // stack: 사용자가 고른 파드들(네임스페이스·워크로드가 바뀌면 버린다)
  const selKey = `${namespace ?? ""}|${workload?.key ?? ""}`;
  const [picked, setPicked] = useState<{ key: string; pods: string[] } | null>(null);
  const pickedPods = picked && picked.key === selKey ? picked.pods : null;
  const resolvedPods = resolved && resolved.key === selKey ? resolved.pods : null;

  // 파드 하나 — `direct`는 언제나, `stack`은 워크로드를 고르지 않았거나 하나만 골랐을 때
  const urlPodValid = url.pod && (!workload || podChoices.some((p) => p.name === url.pod)) ? url.pod : null;
  const singlePod = multiPod
    ? pickedPods && pickedPods.length === 1
      ? pickedPods[0]
      : pickedPods && pickedPods.length > 1
        ? null
        : workload
          ? null
          : (urlPodValid ?? nsPods[0]?.name ?? null)
    : (urlPodValid ?? podChoices[0]?.name ?? null);

  const target: LogTarget = {
    namespace,
    pod: singlePod,
    pods: multiPod && pickedPods && pickedPods.length > 1 ? pickedPods : null,
    workload: multiPod && workload && !pickedPods ? workload : null,
  };

  const targets = useApi<LogTargetsResponse>(
    capabilities?.enabled && namespace && singlePod
      ? `/logs/targets/${encodeURIComponent(namespace)}/${encodeURIComponent(singlePod)}`
      : null,
  );

  // 컨테이너 기본값은 **서버가 고른다**(계약 2.1.2). 화면이 다시 고르지 않는다
  const serverDefault = targets.data?.defaultContainer ?? null;
  const container = url.container ?? serverDefault;
  useEffect(() => {
    if (!url.container && serverDefault) q.set({ container: serverDefault });
  }, [url.container, serverDefault, q]);

  const denied = capabilities?.denyNamespaces.includes(namespace ?? "") ?? false;
  const podPickerRef = useRef<HTMLDivElement | null>(null);

  if (caps.loading && !capabilities) {
    return (
      <>
        <PageHeader title="로그" subtitle="조회 전용 · 로그를 저장하지 않습니다" />
        <div className="page-stack">
          <Skeleton lines={8} />
        </div>
      </>
    );
  }
  if (!capabilities) {
    return (
      <>
        <PageHeader title="로그" subtitle="조회 전용 · 로그를 저장하지 않습니다" />
        <UnknownState size="lg" title="로그 기능 상태를 읽지 못했습니다" hint="API 응답을 확인하세요." />
      </>
    );
  }

  // stack 파드 선택기의 값: 워크로드를 서버가 풀었으면 그 목록 전부가 "선택된" 상태다(버튼 문구 `파드: 3개`)
  const multiValue = pickedPods ?? (workload ? (resolvedPods ?? []) : singlePod ? [singlePod] : []);
  const multiOptions = [
    ...new Set([...podChoices.map((p) => p.name), ...(resolvedPods ?? []), ...(pickedPods ?? [])]),
  ].map((name) => ({ value: name, label: name }));

  const pickPods = () => {
    const btn = podPickerRef.current?.querySelector<HTMLButtonElement>("button");
    btn?.focus();
    btn?.click();
  };

  return (
    <>
      <PageHeader title="로그" subtitle="조회 전용 · 로그를 저장하지 않습니다" />
      {/* 줄 사이 8px (디자인 2절 표) — 본문에 남는 높이를 늘린다(`page-stack` 32px 가 아니다) */}
      <div className={styles.page}>
        {capabilities.enabled ? (
          <div className={styles.pickerRow}>
            <Select
              label="네임스페이스"
              width={180}
              value={namespace ?? ""}
              onChange={(v) => q.set({ namespace: v, workload: null, pod: null, container: null, at: null })}
              options={namespaces.map((n) => ({
                value: n,
                // 차단된 네임스페이스도 **목록에 남긴다**(있는데 못 보는 것과 없는 것은 다르다)
                label: capabilities.denyNamespaces.includes(n) ? `${n} (차단됨)` : n,
              }))}
            />
            <Select
              label="워크로드"
              width={200}
              value={workload?.key ?? ""}
              onChange={(v) => q.set({ workload: v || null, pod: null, container: null, at: null })}
              options={[
                { value: "", label: "전체" },
                ...workloads.map((w) => ({ value: w.key, label: `${w.name} (${w.kind})` })),
              ]}
            />
            {multiPod ? (
              <div ref={podPickerRef} className={styles.podPicker}>
                <MultiSelect
                  label="파드"
                  width={280}
                  value={multiValue}
                  onChange={(v) => {
                    setPicked({ key: selKey, pods: v.slice(0, MAX_PODS) });
                    q.set({ pod: v.length === 1 ? v[0] : null, container: null, at: null });
                  }}
                  options={multiOptions}
                />
              </div>
            ) : (
              <Select
                label="파드"
                width={280}
                value={singlePod ?? ""}
                onChange={(v) => q.set({ pod: v, container: null, at: null })}
                options={podChoices.map((p) => ({ value: p.name, label: p.name }))}
              />
            )}
          </div>
        ) : null}

        {denied ? (
          <UnknownState
            size="sm"
            title="이 네임스페이스는 로그 조회가 차단돼 있습니다"
            hint="LOG_DENY_NAMESPACES 설정입니다."
          />
        ) : (
          <LogViewer
            // 대상이 바뀌면 뷰어 상태(기간·줄 수·멈춤)를 새로 시작한다
            key={`${namespace}|${workload?.key ?? ""}|${source}`}
            capabilities={capabilities}
            target={target}
            targets={singlePod ? targets.data : undefined}
            targetsLoading={Boolean(singlePod) && targets.loading}
            container={container}
            onContainerChange={(c) => q.set({ container: c })}
            previous={url.previous}
            onPreviousChange={(v) => q.set({ prev: v ? "1" : null })}
            source={source}
            onSourceChange={(s) => q.set({ source: s })}
            followDefault={url.follow}
            onFollowChange={(v) => q.set({ follow: v ? "1" : null })}
            at={url.at}
            onAtClear={() => q.set({ at: null })}
            onResolvedPods={(pods) => setResolved({ key: selKey, pods })}
            onPickPods={multiPod ? pickPods : undefined}
            height="fill"
          />
        )}
      </div>
    </>
  );
}
