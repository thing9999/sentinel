"use client";

import { Button } from "../controls/Button";
import { cx } from "../cx";
import { InlineAlert } from "../feedback/Banner";
import { formatCount, formatDurationTimer } from "../format";
import { useNow } from "../hooks";
import { Icon } from "../icons";
import { Card } from "../layout/Card";
import { Stepper, type Step } from "../layout/Stepper";
import { ElapsedTimer } from "../layout/Time";
import type { IsoTime } from "../types";
import { ExampleBadge } from "./Labels";
import {
  DEFAULT_ADVISOR_SLOW_AFTER_SEC,
  DEFAULT_ADVISOR_TIMEOUT_SEC,
  formatLimitSec,
  withSubjectParticle,
} from "./RunResultAlert";
import styles from "./advisor.module.css";

export interface AdvisorRun {
  id: string;
  startedAt: IsoTime;
  /** 서버 기준 현재 시각 (경과 타이머 보정) */
  serverNow?: IsoTime;
  /** 현재 단계 id */
  stage: string;
  /** Stepper 단계 (`스냅샷 수집` → `사전 점검` → `분석 요청` → `응답 수신 중` → `결과 정리`) */
  stages: Step[];
  lastReceivedAt?: IsoTime | null;
  receivedChars?: number | null;
  /** 서버 `run.delayed` (경과가 slowAfterSec 를 넘음). 판정은 서버가 한다 */
  delayed: boolean;
  example: boolean;
}

export interface RunProgressPanelProps {
  run: AdvisorRun;
  /** 취소 확인 Dialog 를 연다 (Dialog 는 호출 측) */
  onCancel: () => void;
  cancelling?: boolean;
  /** 수신 표시를 붙일 단계 id, 기본 `receive` */
  receivingStepId?: string;
  /** API 스트림 끊김: 수신 표시를 `연결 끊김 · 재연결 후 진행 상황을 다시 받습니다` 로 */
  streamDisconnected?: boolean;
  /** 서버 `run.limits.timeoutSec` (초). 지연 안내의 자동 실패 시간. 기본 600 → `10분` */
  timeoutSec?: number | null;
  /** 서버 `run.limits.slowAfterSec` (초). 지연 안내에 기준 시간으로 표시. 기본 300 → `5분` */
  slowAfterSec?: number | null;
  className?: string;
}

/**
 * components.md 10.2 / architecture-advisor.md 2.4.
 * LLM 원문 스트림은 보여 주지 않는다. 진행감은 단계·경과·수신 표시로만 준다.
 * 경과 타이머·수신 초는 aria-live 로 읽지 않는다(과도한 알림 방지).
 */
export function RunProgressPanel({
  run,
  onCancel,
  cancelling = false,
  receivingStepId = "receive",
  streamDisconnected = false,
  timeoutSec,
  slowAfterSec,
  className,
}: RunProgressPanelProps) {
  const now = useNow(1000);
  const sinceLast = run.lastReceivedAt ? Math.max(0, Math.floor((now - Date.parse(run.lastReceivedAt)) / 1000)) : null;
  const waiting = sinceLast !== null && sinceLast >= 30;
  const elapsedMs = now - Date.parse(run.startedAt);

  const receivingDetail = streamDisconnected ? (
    <span>연결 끊김 · 재연결 후 진행 상황을 다시 받습니다</span>
  ) : (
    <>
      <span className={cx(styles.pulse, waiting && styles.pulseStopped)} aria-hidden="true" />
      <span suppressHydrationWarning>
        {waiting ? "응답 대기 중" : "수신 중"}
        {sinceLast !== null ? ` · 마지막 수신 ${sinceLast}초 전` : ""}
        {run.receivedChars ? ` · ${formatCount(run.receivedChars)}자` : ""}
      </span>
    </>
  );

  const steps: Step[] = run.stages.map((s) =>
    s.id === receivingStepId && s.state === "active" ? { ...s, detail: receivingDetail } : s,
  );

  return (
    <Card
      as="section"
      padding="lg"
      status={run.delayed ? "warn" : undefined}
      className={cx(styles.progress, className)}
      aria-label="분석 진행"
    >
      <div className={styles.progressHead}>
        <div className={styles.progressTitleRow}>
          <h3 className={styles.progressTitle}>분석 진행 중</h3>
          {run.example ? <ExampleBadge /> : null}
        </div>
        <div className={styles.progressRight}>
          <ElapsedTimer startedAt={run.startedAt} serverNow={run.serverNow} label="경과" />
          <Button variant="secondary" size="md" icon="square" onClick={onCancel} loading={cancelling}>
            {cancelling ? "취소 중" : "취소"}
          </Button>
        </div>
      </div>
      <Stepper steps={steps} label="분석 단계" />
      {run.delayed ? (
        <InlineAlert
          tone="warn"
          title={
            <span suppressHydrationWarning>
              평소보다 오래 걸리고 있습니다 (경과 {formatDurationTimer(Number.isNaN(elapsedMs) ? 0 : elapsedMs)}).
            </span>
          }
          description={`${withSubjectParticle(formatLimitSec(slowAfterSec, DEFAULT_ADVISOR_SLOW_AFTER_SEC))} 넘었습니다. 계속 기다리거나 취소할 수 있습니다. ${withSubjectParticle(formatLimitSec(timeoutSec, DEFAULT_ADVISOR_TIMEOUT_SEC))} 지나면 자동으로 실패 처리됩니다.`}
          action={
            <Button variant="danger" size="sm" onClick={onCancel} loading={cancelling}>
              분석 취소
            </Button>
          }
        />
      ) : null}
      <p className={styles.progressNote}>
        <Icon name="info" size={14} />
        분석은 서버에서 계속 진행됩니다. 이 페이지를 떠나도 됩니다.
      </p>
    </Card>
  );
}
