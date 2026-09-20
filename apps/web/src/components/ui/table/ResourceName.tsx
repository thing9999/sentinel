"use client";

import Link from "next/link";

import { CopyButton } from "../controls/CopyButton";
import { cx } from "../cx";
import { shortNodeName, splitForMiddleEllipsis } from "../format";
import { Tooltip } from "../overlay/Tooltip";
import styles from "./table.module.css";

export type ResourceKind = "pod" | "node" | "workload" | "pvc" | "volume" | "service" | "other";

export interface ResourceNameProps {
  name: string;
  /** 끝에서 보존할 글자 수, 기본 16 (ReplicaSet 해시 + 접미사) */
  keepTail?: number;
  href?: string;
  /** 행 hover·포커스 시 복사 버튼, 기본 true */
  copyable?: boolean;
  /** px (이름 열 최대 360px) */
  maxWidth?: number;
  /** node 면 첫 `.` 앞만 표시(전체는 툴팁·복사) */
  kind?: ResourceKind;
  /** `namespace / name` 형식 (상세 제목, 지금 확인할 항목) */
  namespace?: string;
  className?: string;
}

/**
 * components.md 7.2 / status.md 5.3. mono 12/20, 가운데 말줄임(앞부분을 CSS 로 자르고 끝 16자 보존),
 * 폭에 맞으면 자르지 않는다. 전체 이름은 툴팁(mono, break-all), 스크린리더는 전체 이름을 한 번 읽는다.
 */
export function ResourceName({
  name,
  keepTail = 16,
  href,
  copyable = true,
  maxWidth,
  kind,
  namespace,
  className,
}: ResourceNameProps) {
  const display = kind === "node" ? shortNodeName(name) : name;
  const { head, tail } = splitForMiddleEllipsis(display, keepTail);
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
        {head ? <span className={styles.rnHead}>{head}</span> : null}
        <span className={styles.rnTail}>{tail}</span>
      </span>
    </>
  );

  return (
    <span
      className={cx(styles.rn, className)}
      style={maxWidth ? { maxWidth: `min(${maxWidth}px, 100%)` } : undefined}
    >
      <Tooltip content={full} mono className={styles.rnTooltip}>
        {href ? (
          <Link href={href} className={cx(styles.rnText, styles.rnLink)} onClick={(e) => e.stopPropagation()}>
            {visual}
          </Link>
        ) : (
          <span className={styles.rnText}>{visual}</span>
        )}
      </Tooltip>
      {copyable ? (
        <span className={styles.rnCopy} onClick={(e) => e.stopPropagation()}>
          <CopyButton text={name} label={`${display} 이름 복사`} size="sm" showLabel={false} />
        </span>
      ) : null}
    </span>
  );
}
