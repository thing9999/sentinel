import type { ReactNode } from "react";

import { Button } from "../controls/Button";
import { cx } from "../cx";
import { InlineAlert, type AlertTone } from "../feedback/Banner";
import { EmptyState, ErrorState, UnknownState } from "../feedback/EmptyState";
import { Skeleton } from "../feedback/Skeleton";
import { Spinner } from "../feedback/Spinner";
import { Card } from "../layout/Card";
import type { SceneState } from "./viz";
import styles from "./viz.module.css";

/** snapshot-3d.md 9절 문구 (프론트·테스트가 같은 문자열을 쓴다) */
export const SCENE_TEXT = {
  chunk: "3D 보기를 준비하고 있습니다",
  chunkNote: "처음 한 번만 내려받습니다 (약 0.3 MB)",
  building: "장면을 그리는 중입니다",
  showTable: "표로 보기",
  emptyTitle: "그릴 리소스가 없습니다",
  emptyDesc: "이 스냅샷에는 리소스 파일이 없습니다. 파일 탭에서 폴더 내용을 확인하세요.",
  filteredEmpty: "조건에 맞는 블록이 없습니다",
  resetFilters: "필터 초기화",
  errorTitle: "구성을 다시 읽지 못했습니다",
  retry: "다시 시도",
  reenable: "3D 다시 켜기",
} as const;

/** 동시에 보이는 알림 최대 개수 (snapshot-3d.md 9.9) */
export const MAX_NOTICES = 2;

const FALLBACK_ALERT: Record<
  "unsupported" | "chunkFailed" | "contextLost",
  { tone: AlertTone; title: string; description: string }
> = {
  unsupported: {
    tone: "neutral",
    title: "이 브라우저에서 3D를 쓸 수 없어 표로 보여 줍니다",
    description:
      "WebGL을 쓸 수 없는 환경입니다(원격 데스크톱·그래픽 가속 꺼짐 등). 표에는 3D와 같은 블록·관계가 모두 있습니다.",
  },
  chunkFailed: {
    tone: "warn",
    title: "3D 보기를 불러오지 못했습니다",
    description: "네트워크 문제일 수 있습니다. 표는 그대로 쓸 수 있습니다.",
  },
  contextLost: {
    tone: "neutral",
    title: "3D를 잠시 멈췄습니다",
    description: "그래픽 장치 연결이 끊겨(컨텍스트 손실) 3D를 껐습니다. 선택·필터는 그대로입니다.",
  },
};

export interface Scene3DFrameProps {
  state?: SceneState;
  /** 3D / 관계 표 보기 (사용자가 고른 보기. 자동 전환은 state 로 온다) */
  view?: "3d" | "table";
  /** 48px 도구 막대 A */
  toolbarA?: ReactNode;
  /** 40px 도구 막대 B */
  toolbarB?: ReactNode;
  /** three.js 캔버스(프론트 영역). 높이 = height − 88px */
  canvasSlot?: ReactNode;
  /** 관계 표(보기 전환·자동 전환) */
  tableSlot?: ReactNode;
  /** 캔버스 왼쪽 위 정보 줄 */
  infoBar?: ReactNode;
  /**
   * @deprecated 2026-09-20: 범례가 **도구 막대 B `범례` 버튼의 Popover**로 나갔다(snapshot-3d.md 6.5).
   * 캔버스 오버레이는 `infoBar`(왼쪽 위)·`cameraControls`(오른쪽 아래) 둘뿐이고, 이 값은 **그리지 않는다**.
   * 넘겨도 오류가 나지 않게 받기만 한다(기존 호출을 깨지 않으려고). 프론트는 넘기지 않는다.
   */
  legend?: ReactNode;
  /** 캔버스 오른쪽 아래 카메라 오버레이 */
  cameraControls?: ReactNode;
  /**
   * 캔버스 위쪽 가운데 알림(잘림·구성 변경·저사양), 최대 420px.
   * 배열이면 세로로 8px 간격으로 쌓고 **최대 2개**만 보인다(우선순위 ① 잘림 ② 구성 변경 ③ 저사양, 9.9).
   */
  notice?: ReactNode | ReactNode[];
  /** 기본 `clamp(480px, calc(100vh - 176px), 960px)` — 파일·드리프트 탭과 같은 값 */
  height?: number | string;
  /** stale: 카드 1px dashed status.stale.border (장면은 마지막 값을 유지한다) */
  stale?: boolean;
  /** 캔버스 앞 sr-only 건너뛰기 링크 (`표로 보기`) */
  skipLinkHref?: string;
  /** 로딩 중 [표로 보기] / 저사양 안내 */
  onShowTable?: () => void;
  onRetry?: () => void;
  onReenable?: () => void;
  onResetFilters?: () => void;
  /** `장면을 그리는 중입니다 (블록 1,240개)` */
  buildingCount?: number;
  /** 리소스 0개 빈 상태 액션 (`파일 탭으로`) */
  emptyAction?: ReactNode;
  /** state=unknown */
  unknownTitle?: string;
  unknownReason?: string;
  unknownHint?: ReactNode;
  unknownIcon?: "circle-help" | "hourglass";
  /** state=error */
  errorTitle?: string;
  errorDescription?: ReactNode;
  /** 이전에 그린 장면이 있으면 지우지 않고 위에 알림만 얹는다 (9.4) */
  keepScene?: boolean;
  /** 선택 결과 등 한 문장. 바뀔 때만 읽힌다(카메라 조작은 읽지 않는다) */
  liveMessage?: string;
  /** 스크린리더 영역 이름 */
  label?: string;
  className?: string;
}

/**
 * components.md 16.1 / snapshot-3d.md 3·9절. 3D 카드 틀: 도구 막대 2줄 + 캔버스(또는 표) + 2D 오버레이.
 * **3D 캔버스 자체는 프론트 영역**이다(`canvasSlot`). 여기서는 자리·상태·오버레이 배치만 맡는다.
 * 애니메이션으로 알림을 등장시키지 않는다(reduced-motion 과 무관, 9.8).
 */
export function Scene3DFrame({
  state = "ready",
  view = "3d",
  toolbarA,
  toolbarB,
  canvasSlot,
  tableSlot,
  infoBar,
  cameraControls,
  notice,
  height = "clamp(480px, calc(100vh - 176px), 960px)",
  stale = false,
  skipLinkHref,
  onShowTable,
  onRetry,
  onReenable,
  onResetFilters,
  buildingCount,
  emptyAction,
  unknownTitle,
  unknownReason,
  unknownHint,
  unknownIcon = "circle-help",
  errorTitle = SCENE_TEXT.errorTitle,
  errorDescription,
  keepScene = false,
  liveMessage,
  label = "Kubernetes 구성도 3D 보기",
  className,
}: Readonly<Scene3DFrameProps>) {
  const isStale = stale || state === "stale";
  const fallback = state === "unsupported" || state === "chunkFailed" || state === "contextLost";
  const showTable = fallback || view === "table";

  return (
    <Card
      as="section"
      padding="none"
      kind={isStale ? "stale" : "default"}
      aria-label={label}
      aria-busy={state === "loadingData" || state === "loadingChunk" || state === "building" || undefined}
      style={{ height }}
      className={cx(styles.frame, className)}
    >
      {toolbarA}
      {toolbarB}
      <div className={styles.sceneBody}>
        {showTable ? (
          <div className={styles.tableArea}>
            {fallback ? (
              <InlineAlert
                tone={FALLBACK_ALERT[state as keyof typeof FALLBACK_ALERT].tone}
                icon={state === "unsupported" ? "info" : undefined}
                /*
                 * 9.4(청크 실패·컨텍스트 손실)는 **사용자가 누르지 않았는데 나타나는** 알림이라 `live` 다.
                 * 9.3(WebGL 없음)은 탭을 여는 순간부터 있는 사실이라 주지 않는다 — 진입 시 낭독이 두 번 겹친다.
                 * 프론트가 넘기는 값이 아니라 컴포넌트가 상태로 정한다(components.md 16.1).
                 */
                live={state !== "unsupported"}
                title={FALLBACK_ALERT[state as keyof typeof FALLBACK_ALERT].title}
                description={FALLBACK_ALERT[state as keyof typeof FALLBACK_ALERT].description}
                action={
                  state === "chunkFailed" && onRetry ? (
                    <Button variant="secondary" size="sm" icon="refresh-cw" onClick={onRetry}>
                      {SCENE_TEXT.retry}
                    </Button>
                  ) : state === "contextLost" && onReenable ? (
                    <Button variant="secondary" size="sm" icon="box" onClick={onReenable}>
                      {SCENE_TEXT.reenable}
                    </Button>
                  ) : undefined
                }
                className={styles.tableAlert}
              />
            ) : null}
            {tableSlot}
          </div>
        ) : (
          <SceneMain
            state={state}
            canvasSlot={canvasSlot}
            infoBar={infoBar}
            cameraControls={cameraControls}
            notice={notice}
            skipLinkHref={skipLinkHref}
            onShowTable={onShowTable}
            onRetry={onRetry}
            onResetFilters={onResetFilters}
            buildingCount={buildingCount}
            emptyAction={emptyAction}
            unknownTitle={unknownTitle}
            unknownReason={unknownReason}
            unknownHint={unknownHint}
            unknownIcon={unknownIcon}
            errorTitle={errorTitle}
            errorDescription={errorDescription}
            keepScene={keepScene}
          />
        )}
      </div>
      {/* 선택 결과만 읽는다(7.1). 카메라 회전·확대·개수 변화는 읽지 않는다 */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
    </Card>
  );
}

type SceneMainProps = Pick<
  Scene3DFrameProps,
  | "canvasSlot"
  | "infoBar"
  | "cameraControls"
  | "notice"
  | "skipLinkHref"
  | "onShowTable"
  | "onRetry"
  | "onResetFilters"
  | "buildingCount"
  | "emptyAction"
  | "unknownTitle"
  | "unknownReason"
  | "unknownHint"
  | "unknownIcon"
  | "errorTitle"
  | "errorDescription"
  | "keepScene"
> & { state: SceneState };

function SceneMain({
  state,
  canvasSlot,
  infoBar,
  cameraControls,
  notice,
  skipLinkHref,
  onShowTable,
  onRetry,
  onResetFilters,
  buildingCount,
  emptyAction,
  unknownTitle,
  unknownReason,
  unknownHint,
  unknownIcon,
  errorTitle,
  errorDescription,
  keepScene,
}: Readonly<SceneMainProps>) {
  // 알림은 세로 스택 8px, 최대 2개 (9.9: 잘림 → 구성 변경 → 저사양 순으로 호출 측이 넘긴다)
  const notices = (Array.isArray(notice) ? notice : [notice]).filter(Boolean).slice(0, MAX_NOTICES);
  if (state === "loadingData") {
    return (
      <div className={styles.canvasArea} data-state={state}>
        <div className={styles.loadingPlates} aria-hidden="true">
          <Skeleton width={200} height={120} radius="lg" />
          <Skeleton width={200} height={120} radius="lg" />
          <Skeleton width={200} height={120} radius="lg" />
        </div>
      </div>
    );
  }

  if (state === "loadingChunk" || state === "building") {
    return (
      <div className={styles.canvasArea} data-state={state}>
        <div className={cx(styles.centerBox, styles.delayed)}>
          <Spinner size={20} />
          <p className={styles.centerTitle}>
            {state === "loadingChunk"
              ? SCENE_TEXT.chunk
              : `${SCENE_TEXT.building}${
                  buildingCount !== undefined ? ` (블록 ${buildingCount.toLocaleString("en-US")}개)` : ""
                }`}
          </p>
          {state === "loadingChunk" ? <p className={styles.centerNote}>{SCENE_TEXT.chunkNote}</p> : null}
          {state === "loadingChunk" && onShowTable ? (
            <Button variant="ghost" size="sm" icon="table-2" onClick={onShowTable}>
              {SCENE_TEXT.showTable}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className={styles.canvasArea} data-state={state}>
        <EmptyState
          icon="box"
          title={SCENE_TEXT.emptyTitle}
          description={SCENE_TEXT.emptyDesc}
          size="lg"
          action={emptyAction}
        />
      </div>
    );
  }

  if (state === "unknown") {
    return (
      <div className={styles.canvasArea} data-state={state}>
        <UnknownState
          title={unknownTitle}
          reason={unknownReason}
          hint={unknownHint}
          icon={unknownIcon}
          size="lg"
        />
      </div>
    );
  }

  if (state === "error" && !keepScene) {
    return (
      <div className={styles.canvasArea} data-state={state}>
        <ErrorState title={errorTitle ?? SCENE_TEXT.errorTitle} description={errorDescription} onRetry={onRetry} size="lg" />
      </div>
    );
  }

  // ready · filteredEmpty · stale · error(장면 유지)
  return (
    <div className={styles.canvasArea} data-state={state}>
      {skipLinkHref ? (
        <a href={skipLinkHref} className={styles.skipLink}>
          {SCENE_TEXT.showTable}
        </a>
      ) : null}
      <div className={styles.canvasSlot}>{canvasSlot}</div>
      {infoBar ? <div className={styles.overlayTopLeft}>{infoBar}</div> : null}
      {state === "error" || notices.length > 0 ? (
        <div className={styles.overlayTop}>
          {state === "error" ? (
            <InlineAlert
              tone="crit"
              compact
              /* 9.4 데이터 오류(장면을 유지한 채 얹는 알림)도 스스로 나타나므로 `live` 다 */
              live
              title={errorTitle ?? SCENE_TEXT.errorTitle}
              action={
                onRetry ? (
                  <Button variant="secondary" size="sm" icon="refresh-cw" onClick={onRetry}>
                    {SCENE_TEXT.retry}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {notices.map((n, i) => (
            <div key={i} className={styles.noticeItem}>
              {n}
            </div>
          ))}
        </div>
      ) : null}
      {state === "filteredEmpty" ? (
        <div className={styles.filteredCard}>
          <p className={styles.filteredText}>{SCENE_TEXT.filteredEmpty}</p>
          {onResetFilters ? (
            <Button variant="ghost" size="sm" onClick={onResetFilters}>
              {SCENE_TEXT.resetFilters}
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* 범례는 캔버스 밖(도구 막대 B Popover)이다 — 오버레이는 정보 줄·카메라 둘뿐(6.5·4.9) */}
      {cameraControls ? <div className={styles.overlayBottomRight}>{cameraControls}</div> : null}
    </div>
  );
}
