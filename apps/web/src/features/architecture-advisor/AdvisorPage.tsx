"use client";

/**
 * 어드바이저 `/advisor` (architecture-advisor.md 2절).
 * 브리지 상태·실행 → 진행 → 사전 점검(규칙) → 최근 분석 결과(AI 제안) → 이력.
 * - 진행 표시는 단계·경과·수신 표시만. LLM 원문 스트림은 받지도 보이지도 않는다(계약 A.8).
 * - 재진입·다른 탭: advisor.snapshot 의 activeRun 으로 복원, 진행 중이면 새 실행 대신 기존 실행으로 연결(created: false).
 * - 화면 어디에도 제안을 적용·실행하는 버튼이 없다.
 */
import { useState } from "react";

import {
  Banner,
  BridgeStatusBar,
  Button,
  Chip,
  CostKindBadge,
  Dialog,
  EmptyState,
  ExampleBadge,
  formatCount,
  formatDurationTable,
  formatMoney,
  formatTime,
  InlineAlert,
  PageHeader,
  RunProgressPanel,
  RunResultAlert,
  Section,
  Skeleton,
  SourceLabel,
  Tooltip,
} from "@/components/ui";
import { useNow } from "@/components/ui/hooks";

import { useApi } from "../common/hooks";
import { useStreamStore, useTopics } from "../stream/StreamProvider";
import { periodicStale, STALE_AFTER_MS } from "../stream/stale";
import { useAdvisorActions } from "./actions";
import { HistorySection } from "./HistorySection";
import { isActive, resultReason, runDisabledText, runSteps } from "./mapping";
import { PrecheckSection } from "./PrecheckSection";
import { SnapshotDrawer } from "./SnapshotDrawer";
import { SuggestionList } from "./SuggestionList";
import type { RawResponse, Run, RunSummary } from "./types";

const TOPICS = ["advisor"] as const;
const JUST_DONE_MS = 5000;

export function toProgressRun(run: Run, serverOffsetMs: number) {
  return {
    id: run.id,
    startedAt: run.startedAt ?? run.requestedAt,
    serverNow: new Date(Date.now() + serverOffsetMs).toISOString(),
    stage: run.stage ?? "snapshot",
    stages: runSteps(run),
    lastReceivedAt: run.receiving?.lastReceivedAt ?? null,
    receivedChars: run.receiving?.receivedChars ?? null,
    delayed: run.delayed,
    example: run.isExample,
  };
}

export function AdvisorPage() {
  useTopics(TOPICS);
  const { stream, connection } = useStreamStore();
  const now = useNow(1000);
  const adv = stream.advisor;
  const actions = useAdvisorActions();
  const [includeSystem, setIncludeSystem] = useState(false);
  const [preview, setPreview] = useState(false);
  const [cancelDialog, setCancelDialog] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [focusRule, setFocusRule] = useState<{ id: string; nonce: number } | null>(null);

  const state = adv?.state ?? null;
  const streamBridge = state?.bridge ?? null;
  const bridge = actions.bridgeOverride && actions.bridgeOverride.base === streamBridge ? actions.bridgeOverride.value : streamBridge;
  const finishedId = adv?.lastFinished?.run.id;
  const startedRun = actions.started && isActive(actions.started.run) && actions.started.run.id !== finishedId ? actions.started.run : null;
  const activeRun: Run | null = state?.activeRun ?? (state && startedRun && state.lastRun?.id !== startedRun.id ? startedRun : null);
  const streamDown = connection.phase !== "open" && connection.phase !== "switching";

  // 실패·취소 결과 (닫지 않았으면 표시). 전체 정보(errorMessage 등)는 lastFinished 또는 REST 로
  const lastRun: RunSummary | null = state?.lastRun ?? null;
  const showResult = !activeRun && lastRun && (lastRun.status === "failed" || lastRun.status === "cancelled") && dismissed !== lastRun.id;
  const fullFromStream = adv?.lastFinished && lastRun && adv.lastFinished.run.id === lastRun.id ? adv.lastFinished.run : null;
  const lastDetail = useApi<{ run: Run }>(showResult && !fullFromStream ? `/advisor/runs/${encodeURIComponent(lastRun!.id)}` : null);
  const failedRun = fullFromStream ?? lastDetail.data?.run ?? null;
  const raw = useApi<RawResponse>(
    showResult && failedRun?.failureReason === "invalid_response" && failedRun.hasRawResponse ? `/advisor/runs/${encodeURIComponent(failedRun.id)}/raw-response` : null,
  );

  const bridgeMark = periodicStale(stream, bridge?.checkedAt, STALE_AFTER_MS.bridge, ["agentBridge"], now);
  const precheckMark = periodicStale(stream, state?.precheck.computedAt, STALE_AFTER_MS.precheck, [], now);
  const canRun = Boolean(bridge?.canRun) && !activeRun;
  const disabledText = runDisabledText(bridge, activeRun, (iso) => formatTime(iso, "shortTime"));
  const runLabel = activeRun ? "분석 진행 중" : bridge?.exampleMode ? "예시 분석 실행" : "분석 실행";
  const start = () => void actions.start(includeSystem);

  const runButton = (
    <Button variant="primary" size="lg" icon="play" disabled={!canRun} disabledReason={canRun ? undefined : disabledText} loading={actions.starting} onClick={start}>
      {runLabel}
    </Button>
  );
  const retryDisabledReason = canRun ? undefined : disabledText;

  const latest = state?.latestResult ?? null;
  const justDone = adv?.lastFinished && adv.lastFinished.run.status === "succeeded" && now - adv.lastFinished.receivedAt < JUST_DONE_MS;

  return (
    <>
      <PageHeader title="어드바이저" subtitle="어드바이저는 제안만 합니다. 클러스터와 AWS에 아무것도 실행하지 않습니다." />
      <div className="page-stack">
        {state && bridge ? (
          <BridgeStatusBar
            bridge={bridge.state}
            message={bridge.message}
            command={bridge.command}
            retryAt={bridge.state === "usage_limit" ? bridge.retryAt : null}
            checkedAt={bridge.checkedAt}
            onRecheck={() => void actions.recheck(streamBridge)}
            rechecking={actions.rechecking}
            exampleMode={bridge.exampleMode}
            runButton={runButton}
            previewButton={
              <Button variant="secondary" size="md" icon="eye" onClick={() => setPreview(true)}>
                보낼 데이터 보기
              </Button>
            }
            runDisabledReason={canRun ? undefined : disabledText}
          />
        ) : (
          <BridgeStatusBar bridge="unknown" runButton={runButton} />
        )}
        {bridgeMark.stale && bridge ? <span className="text-caption">브리지 상태가 오래됐습니다 · {bridge.checkedAt ? formatTime(bridge.checkedAt, "time") : "—"} 기준</span> : null}
        {actions.error ? <InlineAlert tone="warn" title={actions.error} action={<Button variant="ghost" size="sm" onClick={actions.clearError}>닫기</Button>} /> : null}

        {activeRun ? (
          <RunProgressPanel
            run={toProgressRun(activeRun, stream.serverOffsetMs)}
            receivingStepId="receiving"
            timeoutSec={activeRun.limits?.timeoutSec}
            slowAfterSec={activeRun.limits?.slowAfterSec}
            cancelling={activeRun.cancelling || actions.cancelling}
            streamDisconnected={streamDown}
            onCancel={() => setCancelDialog(true)}
          />
        ) : showResult && lastRun ? (
          <RunResultAlert
            reason={resultReason(failedRun ?? lastRun)}
            timeoutSec={failedRun?.limits?.timeoutSec}
            message={failedRun?.errorMessage ?? null}
            command={bridge?.command ?? null}
            rawResponse={raw.data?.text ?? null}
            retryAt={bridge?.state === "usage_limit" ? bridge.retryAt : null}
            cancelledAt={lastRun.status === "cancelled" ? lastRun.finishedAt : null}
            onDismiss={() => setDismissed(lastRun.id)}
            onRetry={start}
            retryDisabled={!canRun}
            retryDisabledReason={retryDisabledReason}
            onRecheck={() => void actions.recheck(streamBridge)}
            onOpenPreview={() => setPreview(true)}
          />
        ) : null}

        <PrecheckSection
          summary={state?.precheck ?? null}
          focusRule={focusRule}
          staleAt={precheckMark.stale ? precheckMark.at : undefined}
          includeSystem={includeSystem}
          onIncludeSystemChange={setIncludeSystem}
        />

        <Section
          title="최근 분석 결과"
          badges={
            <>
              <SourceLabel source="llm" />
              {latest?.isExample ? <ExampleBadge /> : null}
              {justDone ? <Chip tone="ok" icon="circle-check" label="방금 완료" /> : null}
            </>
          }
          actions={
            latest ? (
              <span className="text-caption-tertiary" suppressHydrationWarning>
                {latest.finishedAt ? formatTime(latest.finishedAt, "autoShort") : ""}
                {latest.durationMs !== null ? ` · 소요 ${formatDurationTable(latest.durationMs)}` : ""} · 제안 {formatCount(latest.counts.suggestions)}건
              </span>
            ) : undefined
          }
        >
          {!state ? (
            <Skeleton lines={6} />
          ) : !latest ? (
            <EmptyState
              size="lg"
              icon="lightbulb"
              title="아직 분석을 실행하지 않았습니다"
              description="클러스터·비용 스냅샷을 로컬 Claude Code에 보내 개선 제안을 받습니다. 1~3분 정도 걸립니다."
              action={runButton}
            />
          ) : (
            <div className="stack">
              {latest.freshness?.stale ? (
                <Banner
                  tone="stale"
                  icon="clock-alert"
                  title="결과가 현재 상태와 다를 수 있습니다"
                  description={latest.freshness.reasons.map((r) => r.text).join(" · ")}
                  actions={
                    <Button variant="secondary" size="sm" icon="play" disabled={!canRun} disabledReason={retryDisabledReason} onClick={start}>
                      다시 분석
                    </Button>
                  }
                />
              ) : null}
              <RunMetaLine run={latest} />
              <SuggestionList
                key={latest.id}
                suggestions={latest.suggestions ?? []}
                onRuleClick={(id) => setFocusRule((cur) => ({ id, nonce: (cur?.nonce ?? 0) + 1 }))}
              />
            </div>
          )}
        </Section>

        <HistorySection
          refreshKey={`${state?.history.total ?? 0}|${lastRun?.id ?? ""}|${lastRun?.status ?? ""}|${activeRun?.id ?? ""}`}
          retention={state?.history.retention}
        />
      </div>

      <SnapshotDrawer open={preview} onClose={() => setPreview(false)} mode={{ kind: "preview", includeSystem }} />
      <Dialog
        open={cancelDialog}
        onClose={() => setCancelDialog(false)}
        tone="danger"
        size="sm"
        title="분석을 취소할까요?"
        description="진행 중인 결과는 저장되지 않고 이력에 &quot;취소됨&quot;으로 남습니다."
        confirmLabel="분석 취소"
        confirmLoading={actions.cancelling}
        confirmLoadingLabel="취소 중"
        cancelLabel="계속 기다리기"
        onConfirm={async () => {
          if (!activeRun) return setCancelDialog(false);
          await actions.cancel(activeRun.id);
          setCancelDialog(false);
        }}
      />
    </>
  );
}

export function RunMetaLine({ run }: { run: Run }) {
  const s = run.snapshotSummary;
  return (
    <p className="row text-caption" style={{ margin: 0 }}>
      {s ? (
        <span>
          스냅샷 노드 {formatCount(s.nodeCount)} · 워크로드 {formatCount(s.workloadCount)}
        </span>
      ) : null}
      {s?.estimatedMonthly ? (
        <span className="row">
          추정 월 ≈ {formatMoney(s.estimatedMonthly.amountUsd, "month")}
          <CostKindBadge kind="estimate" />
        </span>
      ) : null}
      {s && s.redactedCount > 0 ? (
        <Tooltip content="비밀값 패턴 검사로 가린 필드 수">
          <Chip tone="warn" label={`가림 ${formatCount(s.redactedCount)}건`} />
        </Tooltip>
      ) : null}
      {run.counts.dropped > 0 ? <Chip label={`형식 오류로 제외 ${formatCount(run.counts.dropped)}건`} /> : null}
      {s && s.omitted.workloads > 0 ? <Chip label={`생략 ${formatCount(s.omitted.workloads)}개`} /> : null}
      <span>
        높음 {formatCount(run.counts.high)} · 중간 {formatCount(run.counts.medium)} · 낮음 {formatCount(run.counts.low)}
      </span>
    </p>
  );
}
