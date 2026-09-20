"use client";

/** 보낼 데이터 보기 / 당시 보낸 데이터 보기 (architecture-advisor.md 2.8). JSON 은 JsonTree 텍스트로만. */
import { useState } from "react";

import {
  Button,
  Chip,
  CopyButton,
  Drawer,
  ErrorState,
  formatBytes,
  formatCount,
  formatDurationTable,
  formatMoney,
  formatTime,
  InlineAlert,
  JsonTree,
  KeyValueList,
  Skeleton,
  STATUS_LABEL,
  statusFromApi,
  TabPanel,
  Tabs,
} from "@/components/ui";

import { errorBody, useApi } from "../common/hooks";
import type { RunSnapshotResponse, SnapshotPreview, SnapshotSummary } from "./types";

type Mode = { kind: "preview"; includeSystem: boolean } | { kind: "run"; runId: string };

export function summaryItems(s: SnapshotSummary | null | undefined) {
  if (!s) return [];
  return [
    { label: "노드 수", value: formatCount(s.nodeCount) },
    { label: "인스턴스 타입", value: s.instanceTypes.map((t) => `${t.type} ${formatCount(t.count)}`).join(", ") || "—" },
    { label: "워크로드 수", value: formatCount(s.workloadCount) },
    { label: "PVC 수", value: formatCount(s.pvcCount) },
    { label: "로드밸런서 수", value: formatCount(s.loadBalancerCount) },
    { label: "추정 월 비용", value: s.estimatedMonthly ? `≈ ${formatMoney(s.estimatedMonthly.amountUsd, "month")}` : "—" },
    { label: "예산 상태", value: s.budgetStatus ? STATUS_LABEL[statusFromApi(s.budgetStatus)] : "—" },
    { label: "사전 점검", value: `높음 ${s.precheck.high} · 중간 ${s.precheck.medium} · 낮음 ${s.precheck.low} · 보류 ${s.precheck.held}` },
    { label: "가림", value: `${formatCount(s.redactedCount)}건` },
  ];
}

export function SnapshotDrawer({ open, onClose, mode }: { open: boolean; onClose: () => void; mode: Mode }) {
  const [tab, setTab] = useState("summary");
  const preview = useApi<SnapshotPreview>(open && mode.kind === "preview" ? "/advisor/snapshot-preview" : null, {
    includeSystem: mode.kind === "preview" ? mode.includeSystem : undefined,
  });
  const runSnap = useApi<RunSnapshotResponse>(open && mode.kind === "run" ? `/advisor/runs/${encodeURIComponent(mode.runId)}/snapshot` : null);
  const q = mode.kind === "preview" ? preview : runSnap;
  const data = q.data;
  const meta = data?.meta;
  const summary = mode.kind === "preview" ? preview.data?.summary : null;
  const json = data ? JSON.stringify(data.snapshot, null, 2) : "";
  const err = errorBody(q.error);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={mode.kind === "preview" ? "보낼 데이터 미리보기" : "당시 보낸 데이터"}
      subtitle={data && meta ? `${formatTime(data.generatedAt, "autoShort")} 생성 · ${formatBytes(meta.bytes)}` : undefined}
      footer={
        <span className="row">
          {data ? <CopyButton text={json} label="JSON 복사" size="md" /> : null}
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </span>
      }
    >
      {q.error ? (
        <ErrorState
          size="sm"
          title={err?.code === "RESOURCE_NOT_FOUND" ? "저장된 스냅샷이 없습니다" : "스냅샷을 만들 수 없습니다"}
          description={err?.message}
          onRetry={q.reload}
        />
      ) : !data || !meta ? (
        <div className="stack-sm">
          <Skeleton lines={12} />
          <span className="text-caption">스냅샷을 만들고 있습니다</span>
        </div>
      ) : (
        <div className="stack">
          <InlineAlert tone="info" title={meta.transmissionNotice} />
          <span className="row">
            {meta.redactedCount > 0 ? <Chip tone="warn" label={`가림 ${formatCount(meta.redactedCount)}건`} /> : null}
            {meta.omitted.workloads > 0 ? <Chip label={`생략 워크로드 ${formatCount(meta.omitted.workloads)}개`} /> : null}
            {meta.omitted.nodes > 0 ? <Chip label={`생략 노드 ${formatCount(meta.omitted.nodes)}개`} /> : null}
            <Chip label={`관측 ${formatDurationTable(meta.observationSec * 1000)}`} icon="timer" />
            <Chip label={`데이터 소스 ${meta.dataSource}`} />
          </span>
          <Tabs
            idBase="snapshot"
            label="스냅샷 보기"
            value={tab}
            onChange={setTab}
            items={[
              { id: "summary", label: "요약" },
              { id: "json", label: "JSON" },
            ]}
          />
          <TabPanel idBase="snapshot" id="summary" value={tab}>
            {summary ? <KeyValueList items={summaryItems(summary)} /> : <p className="text-caption">요약이 없습니다. JSON 탭에서 전체를 확인하세요.</p>}
            {meta.redactedFields.length ? (
              <div className="stack-sm">
                <span className="text-caption">가린 필드</span>
                <ul className="list-plain">
                  {meta.redactedFields.map((f) => (
                    <li key={f} className="text-mono">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </TabPanel>
          <TabPanel idBase="snapshot" id="json" value={tab}>
            <JsonTree data={data.snapshot} defaultExpandDepth={1} maxHeight={560} />
          </TabPanel>
        </div>
      )}
    </Drawer>
  );
}
