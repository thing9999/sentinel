"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { formatDurationTable, formatTime } from "../format";
import { useNow } from "../hooks";
import { Icon } from "../icons";
import { Timestamp } from "../layout/Time";
import { Tooltip } from "../overlay/Tooltip";
import { Chip } from "../status/Chip";
import { ReasonText } from "../status/ReasonText";
import { StatusBadge } from "../status/StatusBadge";
import { ResourceName } from "../table/ResourceName";
import type { IsoTime } from "../types";
import styles from "./alerts.module.css";
import {
  ALERT_SEVERITY,
  DISPATCH_SPEC,
  alertChips,
  alertItemName,
  isDispatchState,
  trimChips,
  type AlertKind,
  type AlertSeverity,
  type DispatchState,
} from "./alertModel";

export interface AlertTarget {
  /** `Pod` / `Node` / `Deployment` … (서버 문구) */
  kind: string;
  namespace?: string;
  name: string;
  href?: string;
}

export interface AlertDispatch {
  state: DispatchState;
  at?: IsoTime;
  /** 실패 사유 등 (가림 처리된 서버 문구) */
  detail?: string;
}

export interface AlertItemProps {
  severity: AlertSeverity;
  /** 확장 영역의 내용을 고르는 것은 호출 측이다. 여기서는 `test` 만 칩으로 쓴다 */
  kind?: AlertKind;
  /** `컨트롤 플레인` / `파드` / `비용` / `쿠버네티스 연결` (서버 문구) */
  areaLabel: string;
  /** 서버 `reasons[0].text` 그대로. 1줄 말줄임 + 툴팁 */
  reason: string;
  /** 최대 3개(좁은 폭 1개)는 호출 측이 잘라서 넘긴다 */
  targets?: AlertTarget[];
  targetsMore?: number;
  occurredAt: IsoTime;
  resolvedAt?: IsoTime;
  /** 해제·진행 중 지속 시간 (**서버 값**. 화면이 시계로 계산하지 않는다) */
  durationMs?: number;
  repeatCount?: number;
  /** 반복 칩 툴팁 `처음 14:02:05 · 마지막 14:14:31` (서버 값) */
  repeatTooltip?: string;
  flapping?: boolean;
  suppressedAreas?: number;
  dataSource?: "mock" | "live";
  /**
   * 채널별 발송 칩(status.md 12.5, 12종). **`ui` 채널은 넘기지 않는다**(항상 성공이라 아무 정보가 아니다).
   * 칩 문구는 **말줄임하지 않는다**. `DISPATCH_SPEC`에 없는 값이 섞여 와도 터지지 않고 그 칩만 그리지 않는다
   * (서버 `label`은 확장 영역에서 호출 측이 보여 준다).
   */
  dispatch?: AlertDispatch[];
  /** false 면 왼쪽 gutter 에 안 읽음 점 + 접근 이름 앞 `안 읽음,` */
  read: boolean;
  /** 안 읽음 점 클릭 = 이동하지 않고 그 항목만 확인 처리 */
  onMarkRead?: () => void;
  /** **항목 전체가 링크**. 없으면 링크 없이 그린다 */
  href?: string;
  /**
   * 3행 오른쪽 `로그` 링크 (대상이 파드일 때만 서버가 준다).
   * **로그 본문은 넣지 않는다** — 알림이 로그에 대해 할 수 있는 것은 그 화면으로 보내는 것뿐이다(alerts.md 4.4).
   */
  logHref?: string;
  /** `로그` 링크 툴팁(대상 파드 이름) */
  logLabel?: string;
  /** 서버가 삭제 시각을 아는 경우. 링크는 **그대로 둔다**(로그 스택이 있으면 볼 수 있다) */
  targetGone?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** 확장 영역 내용(타임라인·영향 영역 목록·발송 기록·보낼 본문) — 호출 측이 만든다 */
  children?: ReactNode;
  className?: string;
}

/**
 * components.md 20.1 / alerts.md 4절 / status.md 12절.
 *
 * - 한 건이 `배지 + 영역 + 사유 + 영향 객체 + 칩 3~5개 + 시각`이라 **표로 만들 수 없다**(12.3). 목록 항목이다.
 * - `critical` 만 왼쪽 3px 막대. 주의 이하는 막대 없음 — "정상·주의는 조용하게"의 연장.
 * - 읽음이면 **영역 이름의 무게만** 낮춘다. 배지·사유·칩은 그대로다(읽었다고 정보가 흐려지면 안 된다).
 * - **화면을 여는 것만으로 읽음 처리하지 않는다**(항목 클릭·확장·점 클릭만, 4.6). 그 판단은 호출 측이다.
 * - 항목 안에 링크 1개 + 버튼 2개가 있으므로 **항목 전체를 버튼으로 감싸지 않는다**(중첩 금지).
 *   전체 클릭 영역은 제목 링크의 `::after` 가 덮는다.
 */
export function AlertItem({
  severity,
  kind = "transition",
  areaLabel,
  reason,
  targets = [],
  targetsMore = 0,
  occurredAt,
  resolvedAt,
  durationMs,
  repeatCount = 1,
  repeatTooltip,
  flapping = false,
  suppressedAreas = 0,
  dataSource = "live",
  dispatch = [],
  read,
  onMarkRead,
  href,
  logHref,
  logLabel,
  targetGone = false,
  expandable = false,
  expanded = false,
  onToggleExpand,
  children,
  className,
}: AlertItemProps) {
  const sev = ALERT_SEVERITY[severity];
  const { shown, hidden } = trimChips(
    alertChips({ kind, repeatCount, flapping, suppressedAreas, dataSource, repeatTooltip }),
  );
  // 시각은 서버 값이고 지속 시간도 서버 값이다(화면 시계로 계산하지 않는다)
  const durationText =
    durationMs !== undefined ? `${resolvedAt ? "지속" : "진행 중"} ${formatDurationTable(durationMs)}` : null;
  // 접근 이름의 시각은 눈에 보이는 `Timestamp` 와 **같은 기준 시각**으로 만든다
  // (오늘이면 `14:02:05`, 아니면 `9월 18일 14:02`). 서버·브라우저 시간대가 다르면 문구가 갈리므로
  // 링크에 suppressHydrationWarning 을 둔다(`Timestamp` 와 같은 처리).
  const now = useNow(0);
  const timeText = formatTime(occurredAt, "auto", now);
  const name = alertItemName({ read, severityLabel: sev.label, areaLabel, reason, timeText });
  // 링크가 이름을 통째로 들고 있으면 같은 문구가 두 번 읽힌다 → 눈으로만 보는 조각은 숨긴다
  const hideFromSr = href ? true : undefined;
  const rowTooltip = hidden.length > 0 ? hidden.map((c) => c.label).join(" · ") : undefined;

  const head = (
    <>
      <StatusBadge status={sev.status} label={sev.altLabel} size="sm" />
      <span className={cx(styles.area, read && styles.areaRead)}>{areaLabel}</span>
    </>
  );

  return (
    <li
      className={cx(styles.item, severity === "critical" && styles.itemCrit, expanded && styles.itemExpanded, className)}
      data-severity={severity}
      data-read={read ? "true" : "false"}
    >
      <div className={styles.itemMain}>
        <span className={styles.gutter}>
          {!read ? (
            onMarkRead ? (
              <button
                type="button"
                className={styles.unreadDot}
                onClick={onMarkRead}
                aria-label="이 알림을 확인으로 표시"
              />
            ) : (
              <span className={styles.unreadDotStatic} aria-hidden="true" />
            )
          ) : null}
        </span>

        <div className={styles.body}>
          <div className={styles.row1}>
            {href ? (
              <Link href={href} className={styles.titleLink} aria-label={name} suppressHydrationWarning>
                <span aria-hidden="true" className={styles.titleInner}>
                  {head}
                </span>
              </Link>
            ) : (
              <span className={styles.titleInner}>{head}</span>
            )}
            {shown.length > 0 || rowTooltip ? (
              <span className={styles.chips}>
                {shown.map((c) => (
                  <Chip key={c.id} label={c.label} icon={c.icon} tone={c.tone} size="sm" title={c.tooltip} />
                ))}
                {rowTooltip ? (
                  // 버린 칩은 사라지지 않는다 — 문구로 남긴다
                  <Tooltip content={rowTooltip} focusable>
                    <span className={styles.moreChips}>+{hidden.length}</span>
                  </Tooltip>
                ) : null}
              </span>
            ) : null}
            <span className={styles.time} aria-hidden={hideFromSr}>
              <Timestamp value={occurredAt} format="auto" />
              {durationText ? <span className={styles.duration}> · {durationText}</span> : null}
            </span>
          </div>

          <div className={styles.row2} aria-hidden={hideFromSr}>
            {/* 넓은 폭 1줄, 좁은 폭(640px 미만) 2줄 말줄임(alerts.md 8절 ③) — 줄 수는 CSS 가 폭으로 고른다 */}
            <ReasonText reasons={[reason]} status={sev.status} lines={1} className={styles.reason} />
          </div>

          {targets.length > 0 || dispatch.length > 0 || logHref || expandable ? (
            <div className={styles.row3}>
              {targets.length > 0 ? (
                <span className={styles.targets}>
                  {targets.map((t) => (
                    <span key={`${t.kind}/${t.namespace ?? ""}/${t.name}`} className={styles.target}>
                      <span className={styles.targetKind}>{t.kind}</span>{" "}
                      <ResourceName
                        name={t.namespace ? `${t.namespace}/${t.name}` : t.name}
                        kind={t.kind.toLowerCase() === "node" ? "node" : "pod"}
                        href={t.href}
                        copyable={false}
                        maxWidth={260}
                      />
                    </span>
                  ))}
                  {targetsMore > 0 ? <span className={styles.targetsMore}>외 {targetsMore}개</span> : null}
                </span>
              ) : null}

              {/*
                * 좁은 폭에서 대상 이름 칸이 128px 아래로 줄면 이 묶음이 **통째로** 다음 줄로 내려간다
                * (오른쪽 정렬, 위 4px — alerts.md 8절 ④). 칩은 줄어들지 않는다(말줄임 금지).
                */}
              <span className={styles.row3Right}>
                {dispatch.map((d, i) => {
                  // 모르는 값은 그리지 않는다 — 비슷한 칩으로 바꿔 그리면 틀린 문구가 된다(components.md 20절)
                  if (!isDispatchState(d.state)) return null;
                  const spec = DISPATCH_SPEC[d.state];
                  const label = d.at && d.state === "sent" ? `${spec.label} ${formatTime(d.at, "time")}` : spec.label;
                  return (
                    <Chip
                      key={`${i}-${d.state}`}
                      label={label}
                      icon={spec.icon}
                      tone={spec.tone}
                      size="sm"
                      title={d.detail}
                    />
                  );
                })}
                {targetGone ? <Chip label="삭제됨" icon="ban" size="sm" /> : null}
                {logHref ? (
                  // 링크는 **항상 그린다**. 파드가 아직 있는지 화면이 추측하지 않는다(alerts.md 4.4 D11)
                  <Tooltip content={logLabel ?? "이 파드의 로그 보기"}>
                    <Link href={logHref} className={styles.logLink}>
                      <Icon name="scroll-text" size={12} />
                      로그
                    </Link>
                  </Tooltip>
                ) : null}
                {expandable ? (
                  <IconButton
                    icon="chevron-down"
                    rotate={expanded ? 180 : 0}
                    label={expanded ? "자세히 접기" : "자세히 보기"}
                    size="sm"
                    onClick={onToggleExpand}
                    aria-expanded={expanded}
                    className={styles.expandButton}
                  />
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {expandable && expanded ? <div className={styles.expansion}>{children}</div> : null}
    </li>
  );
}
