"use client";

import type { ReactNode } from "react";

import { Button } from "../controls/Button";
import { cx } from "../cx";
import { formatTime } from "../format";
import { Card } from "../layout/Card";
import { CommandLine } from "../layout/CommandLine";
import { StatusBadge } from "../status/StatusBadge";
import type { IsoTime, Status, StatusAltLabel } from "../types";
import { ExampleBadge } from "./Labels";
import styles from "./advisor.module.css";

/** API `BridgeState` 값 그대로 (docs/api/architecture-advisor.md) */
export type BridgeState = "connected" | "login_required" | "usage_limit" | "unreachable" | "unknown";

/** status.md 8.3 / 1.2: API 브리지 값 → 배지 키·문구. 표에 없는 값은 unknown `확인 중` */
export const BRIDGE_BADGE: Record<BridgeState, { status: Status; label: StatusAltLabel }> = {
  connected: { status: "ok", label: "연결됨" },
  login_required: { status: "warn", label: "로그인 필요" },
  usage_limit: { status: "warn", label: "사용량 한도" },
  unreachable: { status: "crit", label: "미실행" },
  unknown: { status: "unknown", label: "확인 중" },
};

/** architecture-advisor.md 2.2 기본 메시지 (서버 message 가 있으면 그것을 쓴다) */
export const BRIDGE_DEFAULT_MESSAGE: Record<BridgeState, string> = {
  connected: "호스트의 Claude Code로 분석할 수 있습니다.",
  login_required: "호스트의 Claude Code 로그인이 만료됐습니다. 호스트 터미널에서 다시 로그인한 뒤 다시 확인하세요.",
  usage_limit: "Claude Code 사용량 한도에 도달했습니다.",
  unreachable: "어드바이저 브리지가 실행되고 있지 않습니다. 호스트에서 아래 명령으로 실행하세요.",
  unknown: "브리지 상태를 확인하고 있습니다.",
};

export interface BridgeStatusBarProps {
  /** API `BridgeState` 값 그대로 (`connected | login_required | usage_limit | unreachable | unknown`) */
  bridge: BridgeState | (string & {});
  /** 안내 문구: 서버 message 를 그대로 (없으면 상태별 기본 문구). 텍스트로만 렌더 */
  message?: string | null;
  /** 실행·로그인 명령 (인라인 코드 + 복사). 서버 command 가 있을 때만 */
  command?: string | null;
  /** 사용량 한도 해제 시각 → `15:30 이후 다시 사용할 수 있습니다.` */
  retryAt?: IsoTime | null;
  /** `14:02 확인` */
  checkedAt?: IsoTime | null;
  onRecheck?: () => void;
  /** 재확인 중(버튼 loading) */
  rechecking?: boolean;
  /** `분석 실행` 버튼 (primary lg) */
  runButton?: ReactNode;
  /** `보낼 데이터 보기` 버튼 (secondary md) */
  previewButton?: ReactNode;
  /** 분석 실행 비활성 사유 (버튼 아래 micro) */
  runDisabledReason?: string;
  /** mock + 브리지 없음 → `예시 응답` 배지 */
  exampleMode?: boolean;
  /** 상태가 바뀌었을 때 배지 강조 */
  highlight?: boolean;
  className?: string;
}

/** components.md 10.1 / architecture-advisor.md 2.2. 최소 높이 72px, 패딩 16px 20px. */
export function BridgeStatusBar({
  bridge,
  message,
  command,
  retryAt,
  checkedAt,
  onRecheck,
  rechecking = false,
  runButton,
  previewButton,
  runDisabledReason,
  exampleMode = false,
  highlight,
  className,
}: BridgeStatusBarProps) {
  const key: BridgeState = Object.prototype.hasOwnProperty.call(BRIDGE_BADGE, bridge) ? (bridge as BridgeState) : "unknown";
  const badge = BRIDGE_BADGE[key];
  const text = message || (exampleMode ? "MOCK 모드: 브리지가 없어 예시 응답으로 전체 흐름을 보여줍니다." : BRIDGE_DEFAULT_MESSAGE[key]);
  return (
    <Card as="section" padding="none" className={cx(styles.bridge, className)} aria-label="Claude Code 브리지 상태">
      <div className={styles.bridgeLeft}>
        <div className={styles.bridgeTitleRow}>
          <StatusBadge status={badge.status} label={badge.label} size="md" highlight={highlight} />
          {exampleMode ? <ExampleBadge /> : null}
          <h2 className={styles.bridgeTitle}>Claude Code 브리지</h2>
          {checkedAt ? (
            <span className={styles.bridgeChecked} suppressHydrationWarning>
              {formatTime(checkedAt, "shortTime")} 확인
            </span>
          ) : null}
          {onRecheck ? (
            <Button variant="ghost" size="sm" icon="refresh-cw" onClick={onRecheck} loading={rechecking}>
              다시 확인
            </Button>
          ) : null}
        </div>
        <p className={styles.bridgeMessage}>
          {text}
          {retryAt ? (
            <span suppressHydrationWarning> {formatTime(retryAt, "shortTime")} 이후 다시 사용할 수 있습니다.</span>
          ) : null}
        </p>
        {command ? <CommandLine command={command} /> : null}
      </div>
      {runButton || previewButton ? (
        <div className={styles.bridgeRight}>
          <div className={styles.bridgeButtons}>
            {previewButton}
            {runButton}
          </div>
          {runDisabledReason ? <p className={styles.bridgeReason}>{runDisabledReason}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * 하위 호환: CommandLine 은 layout/CommandLine 으로 옮겼다(aws-snapshot-manager 에서도 공용).
 * 기존 import 경로를 깨지 않도록 여기서 다시 내보낸다.
 */
export { CommandLine } from "../layout/CommandLine";
