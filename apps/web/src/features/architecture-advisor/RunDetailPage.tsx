"use client";

/** 지난 분석 결과 `/advisor/runs/[id]` (architecture-advisor.md 3절). 읽기 전용. */
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Banner,
  Button,
  Card,
  EmptyState,
  ExampleBadge,
  formatCount,
  formatDurationTable,
  formatTime,
  KeyValueList,
  PageHeader,
  RunProgressPanel,
  RunResultAlert,
  runStatusBadge,
  Section,
  Skeleton,
} from "@/components/ui";

import { errorBody, useApi } from "../common/hooks";
import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { RunMetaLine, toProgressRun } from "./AdvisorPage";
import { isActive, resultReason } from "./mapping";
import { SnapshotDrawer, summaryItems } from "./SnapshotDrawer";
import { SuggestionList } from "./SuggestionList";
import type { RawResponse, Run } from "./types";

const TOPICS = ["advisor"] as const;

export function RunDetailPage({ id }: { id: string }) {
  useTopics(TOPICS);
  const router = useRouter();
  const { stream, connection } = useStreamStore();
  const liveActive = stream.advisor?.state.activeRun?.id === id ? stream.advisor.state.activeRun : null;
  const finished = stream.advisor?.lastFinished?.run.id === id ? stream.advisor.lastFinished.run : null;
  const q = useApi<{ run: Run }>(`/advisor/runs/${encodeURIComponent(id)}`, undefined, finished ? finished.status : null);
  const [snapOpen, setSnapOpen] = useState(false);
  const err = errorBody(q.error);
  const run = liveActive ?? finished ?? q.data?.run ?? null;
  const raw = useApi<RawResponse>(run?.failureReason === "invalid_response" && run.hasRawResponse ? `/advisor/runs/${encodeURIComponent(id)}/raw-response` : null);
  const crumbs = [{ label: "어드바이저", href: "/advisor" }, { label: "분석 이력" }];

  if (err?.code === "RESOURCE_NOT_FOUND" || err?.code === "VALIDATION_FAILED") {
    return (
      <>
        <PageHeader title="분석 결과" breadcrumbs={crumbs} />
        <EmptyState
          size="lg"
          icon="history"
          title="분석 결과를 찾을 수 없습니다"
          description="최근 50건 또는 90일까지만 보관합니다"
          action={
            <Button variant="secondary" onClick={() => router.push("/advisor")}>
              어드바이저로
            </Button>
          }
        />
      </>
    );
  }
  if (!run) {
    return (
      <>
        <PageHeader title="분석 결과" breadcrumbs={crumbs} />
        <Card>
          <Skeleton lines={8} />
        </Card>
      </>
    );
  }

  const badge = runStatusBadge(run.status);
  return (
    <>
      <PageHeader
        title={`${formatTime(run.requestedAt, "autoShort")} 분석`}
        breadcrumbs={crumbs}
        status={{ status: badge.status, label: badge.label }}
        subtitle={[
          run.durationMs !== null ? `소요 ${formatDurationTable(run.durationMs)}` : null,
          run.status === "succeeded" ? `제안 ${formatCount(run.counts.suggestions)}건` : null,
        ]
          .filter(Boolean)
          .join(" · ") || undefined}
        chips={run.isExample ? <ExampleBadge /> : undefined}
      />
      <div className="page-stack">
        <Banner
          tone="stale"
          icon="clock-alert"
          title="지난 분석 결과입니다. 현재 상태와 다를 수 있습니다."
          actions={
            <Button variant="secondary" size="sm" onClick={() => router.push("/advisor")}>
              최신 결과 보기
            </Button>
          }
        />
        {isActive(run) ? (
          <RunProgressPanel
            run={toProgressRun(run, stream.serverOffsetMs)}
            receivingStepId="receiving"
            timeoutSec={run.limits?.timeoutSec}
            slowAfterSec={run.limits?.slowAfterSec}
            cancelling={run.cancelling}
            streamDisconnected={connection.phase !== "open" && connection.phase !== "switching"}
            onCancel={() => router.push("/advisor")}
          />
        ) : null}
        <Section
          title="당시 스냅샷 요약"
          actions={
            run.snapshotSummary ? (
              <Button variant="secondary" size="sm" icon="eye" onClick={() => setSnapOpen(true)}>
                당시 보낸 데이터 보기
              </Button>
            ) : undefined
          }
        >
          {run.snapshotSummary ? (
            <Card>
              <KeyValueList columns={2} items={summaryItems(run.snapshotSummary)} />
            </Card>
          ) : (
            <p className="text-caption">스냅샷 수집 전에 끝난 실행입니다.</p>
          )}
        </Section>
        {run.status === "succeeded" ? (
          <Section title="제안">
            <div className="stack">
              <RunMetaLine run={run} />
              <SuggestionList
                suggestions={run.suggestions ?? []}
                onRuleClick={() => router.push("/advisor#prechecks")}
              />
            </div>
          </Section>
        ) : run.status === "failed" || run.status === "cancelled" ? (
          <RunResultAlert
            reason={resultReason(run)}
            timeoutSec={run.limits?.timeoutSec}
            message={run.errorMessage}
            rawResponse={raw.data?.text ?? null}
            cancelledAt={run.status === "cancelled" ? run.finishedAt : null}
          />
        ) : null}
      </div>
      {run.snapshotSummary ? <SnapshotDrawer open={snapOpen} onClose={() => setSnapOpen(false)} mode={{ kind: "run", runId: run.id }} /> : null}
    </>
  );
}
