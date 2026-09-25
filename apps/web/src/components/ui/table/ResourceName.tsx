"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { CopyButton } from "../controls/CopyButton";
import { cx } from "../cx";
import { shortNodeName, splitForMiddleEllipsis } from "../format";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import styles from "./table.module.css";

export type ResourceKind = "pod" | "node" | "workload" | "pvc" | "volume" | "service" | "cluster" | "other";

/**
 * kind 별 기본값 (status.md 5.3 / components.md 19.3).
 * `cluster` 는 **뒤를 8자만** 남긴다: kOps 클러스터 이름(FQDN)은 맨 앞 라벨이 클러스터를 구분하고
 * 뒤(`k8s.example.com`)는 여러 클러스터가 공유해서, 끝 16자를 남기면 어느 클러스터인지 알 수 없다.
 * 앞부분은 폭이 허락하는 만큼 그대로 남고(말줄임은 앞 토막의 **끝**에서 일어난다),
 * 문서가 말하는 "앞 12자"는 상자가 12자 + 8자만큼만 돼도 자동으로 지켜진다(2026-09-24 Edge 실측).
 */
const KIND_DEFAULTS: Record<"cluster" | "other", { keepTail: number; copyable: boolean }> = {
  cluster: { keepTail: 8, copyable: false },
  other: { keepTail: 16, copyable: true },
};

export interface ResourceNameProps {
  name: string;
  /** 끝에서 보존할 글자 수, 기본 16 (ReplicaSet 해시 + 접미사). kind="cluster" 는 8 */
  keepTail?: number;
  href?: string;
  /** 행 hover·포커스 시 복사 버튼, 기본 true (kind="cluster" 는 false) */
  copyable?: boolean;
  /**
   * (2026-09-25 추가, components.md 21.10) 파드 표의 `로그` — 복사 버튼 **다음**에 로그 아이콘 링크(`scroll-text`).
   * - **주소는 받은 그대로 쓴다**(서버 `logHref`). 컴포넌트는 파라미터를 붙이거나 고치지 않는다.
   * - `null`·없음이면 아무것도 그리지 않고 **자리도 비우지 않는다**.
   * - 보이는 조건은 복사 버튼과 **같은 규칙 하나**다: 이름·행 hover, 이름·행 포커스(`focus-within`·`tr:focus-visible`),
   *   터치(`hover: none`)는 항상. 평소에는 `opacity: 0` 으로만 숨긴다 — 자리는 늘 차지하고(말줄임이 흔들리지 않게)
   *   스크린리더에는 항상 있다. 접근 이름 `<표시 이름> 로그 보기`, 툴팁 `로그 보기`.
   * - 클릭은 행 클릭(파드 상세로 이동)으로 번지지 않는다.
   */
  logHref?: string | null;
  /** px (이름 열 최대 360px) */
  maxWidth?: number;
  /** node 면 첫 `.` 앞만 표시(전체는 툴팁·복사), cluster 면 sans + 앞 12자 보존 */
  kind?: ResourceKind;
  /** `namespace / name` 형식 (상세 제목, 지금 확인할 항목) */
  namespace?: string;
  /** 툴팁 아래에 붙는 보조 줄 (상단바의 `Kubernetes v1.31.2 · ap-northeast-2`) */
  tooltipExtra?: ReactNode;
  className?: string;
}

/**
 * components.md 7.2 / status.md 5.3. mono 12/20, 가운데 말줄임(앞부분을 CSS 로 자르고 끝 16자 보존),
 * 폭에 맞으면 자르지 않는다. 전체 이름은 툴팁(mono, break-all), 스크린리더는 전체 이름을 한 번 읽는다.
 * `kind="cluster"` 는 body 14/20(sans) + 앞 12자·뒤 8자 보존 + 복사 버튼 없음(components.md 19.3).
 */
export function ResourceName({
  name,
  keepTail,
  href,
  copyable,
  logHref,
  maxWidth,
  kind,
  namespace,
  tooltipExtra,
  className,
}: ResourceNameProps) {
  const isCluster = kind === "cluster";
  const defaults = KIND_DEFAULTS[isCluster ? "cluster" : "other"];
  const tail = keepTail ?? defaults.keepTail;
  const showCopy = copyable ?? defaults.copyable;

  const display = kind === "node" ? shortNodeName(name) : name;
  const { head: fitHead, tail: fitTail } = splitForMiddleEllipsis(display, tail);
  const full = namespace ? `${namespace} / ${name}` : name;

  const visual = (
    <>
      <span className="sr-only">{full}</span>
      <span className={styles.rnVisual} aria-hidden="true">
        {namespace ? (
          <span className={styles.rnNamespace}>
            {namespace}
            {" / "}
          </span>
        ) : null}
        {fitHead ? <span className={styles.rnHead}>{fitHead}</span> : null}
        <span className={styles.rnTail}>{fitTail}</span>
      </span>
    </>
  );

  const tooltip = tooltipExtra ? (
    <>
      <span className={styles.rnTooltipName}>{full}</span>
      <span className={styles.rnTooltipExtra}>{tooltipExtra}</span>
    </>
  ) : (
    full
  );

  return (
    <span
      className={cx(styles.rn, className)}
      style={maxWidth ? { maxWidth: `min(${maxWidth}px, 100%)` } : undefined}
    >
      <Tooltip content={tooltip} mono={!isCluster} className={styles.rnTooltip}>
        {href ? (
          <Link
            href={href}
            className={cx(styles.rnText, isCluster && styles.rnSans, styles.rnLink)}
            onClick={(e) => e.stopPropagation()}
          >
            {visual}
          </Link>
        ) : (
          <span className={cx(styles.rnText, isCluster && styles.rnSans)}>{visual}</span>
        )}
      </Tooltip>
      {showCopy ? (
        <span className={cx(styles.rnAction, styles.rnCopy)} onClick={(e) => e.stopPropagation()}>
          <CopyButton text={name} label={`${display} 이름 복사`} size="sm" showLabel={false} />
        </span>
      ) : null}
      {logHref ? (
        // 행 클릭(파드 상세)으로 번지지 않는다 — 복사 버튼과 같다
        <span className={cx(styles.rnAction, styles.rnLog)} onClick={(e) => e.stopPropagation()}>
          <Tooltip content="로그 보기">
            <Link href={logHref} className={styles.rnLogLink} aria-label={`${display} 로그 보기`} data-testid="rn-log-link">
              <Icon name="scroll-text" size={14} />
            </Link>
          </Tooltip>
        </span>
      ) : null}
    </span>
  );
}
