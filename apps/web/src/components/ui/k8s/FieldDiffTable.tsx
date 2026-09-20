"use client";

import { Fragment, useId, useState, type ReactNode } from "react";

import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { Icon } from "../icons";
import { Chip } from "../status/Chip";
import type { DriftFieldClass } from "../types";
import { DiffValue, diffValueLines, differsOnlyByType, type DiffValueData } from "./DiffValue";
import styles from "./k8s.module.css";

/** 계약 `resources[].fields[]` 그대로. 행 키는 `path` */
export interface FieldDiffRow {
  /** 필드 경로 (서버 표기 그대로, 예 `spec.template.spec.containers[api].image`) */
  path: string;
  /** changed 는 보이는 차이, default·managed 는 숨긴 차이 (status.md 10.4. 서버 분류만 쓴다) */
  category: DriftFieldClass;
  /** 분류 아래 caption (예 `기본값 File`, `HPA가 관리`). changed 는 보통 null */
  reason: string | null;
  /** 관리 필드 규칙 id (표시하지 않음, 호출 측 참고용) */
  managedRule?: string | null;
  snapshot: DiffValueData;
  cluster: DiffValueData;
}

export interface FieldDiffTableProps {
  /** 서버 순서 그대로 (정렬 없음). 숨긴 행은 보이는 행 뒤 그룹으로 모은다 */
  rows: FieldDiffRow[];
  /** 요약의 `숨긴 차이 보기` 스위치. true 면 숨긴 행을 펼친 상태로 */
  showHidden?: boolean;
  /** 이 리소스만 숨긴 그룹을 펼쳤는지 (스위치와 별개) */
  hiddenExpanded?: boolean;
  onHiddenToggle?: () => void;
  /** API `fieldsTruncated`. true 면 표 끝 안내 행 (500건까지만) */
  truncated?: boolean;
  /** loading: 스켈레톤 6행 */
  state?: "ready" | "loading";
  /** 스크린리더 표 제목 (예 `api 필드 차이`) */
  caption: string;
  /** 보이는 차이가 없고 숨긴 차이만 있을 때 표 위 문구 */
  hiddenOnlyText?: string;
  className?: string;
}

const CLS_SPEC: Record<DriftFieldClass, { label: string; icon?: "settings-2" | "bot" }> = {
  changed: { label: "변경" },
  default: { label: "기본값 차이", icon: "settings-2" },
  managed: { label: "관리 필드", icon: "bot" },
};

const isHidden = (r: Pick<FieldDiffRow, "category">) => r.category === "default" || r.category === "managed";

/** 필드 경로 줄바꿈 위치: `.` 뒤, `[` 앞에 <wbr>. 말줄임하지 않는다(그래도 넘치면 overflow-wrap:anywhere) */
export function pathWithBreaks(path: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let k = 0;
  for (const ch of path) {
    if (ch === "[" && buf !== "") {
      out.push(buf, <wbr key={`w${k++}`} />);
      buf = "";
    }
    buf += ch;
    if (ch === ".") {
      out.push(buf, <wbr key={`w${k++}`} />);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** `기본값 차이 2 · 관리 필드 1` (0인 분류 생략) */
export function hiddenBreakdown(rows: Pick<FieldDiffRow, "category">[]): string {
  const d = rows.filter((r) => r.category === "default").length;
  const m = rows.filter((r) => r.category === "managed").length;
  return [d > 0 ? `기본값 차이 ${d}` : "", m > 0 ? `관리 필드 ${m}` : ""].filter(Boolean).join(" · ");
}

const MAX_LINES = 3;
export const FIELDS_TRUNCATED_TEXT = "필드 차이가 많아 500건까지만 보여 줍니다. 전체는 kubectl diff로 확인하세요.";

/**
 * components.md 14.6 / k8s-snapshot.md 6.5. 필드 | 스냅샷 값 | → | 클러스터 값 | 분류.
 * 좁으면 표 컨테이너 안에서만 가로 스크롤한다. 여러 줄 값 `더 보기`는 행 아래 전체 폭 확장 영역(좌우 2단).
 * 행 확장 여부만 내부 상태로 가진다(표시 전용). 두 값이 타입만 다르면 양쪽에 타입 표시(showType).
 */
export function FieldDiffTable({
  rows,
  showHidden = false,
  hiddenExpanded = false,
  onHiddenToggle,
  truncated = false,
  state = "ready",
  caption,
  hiddenOnlyText = "이 리소스는 숨긴 차이만 있어 같음으로 셉니다.",
  className,
}: FieldDiffTableProps) {
  const idBase = useId();
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(() => new Set());
  const visible = rows.filter((r) => !isHidden(r));
  const hidden = rows.filter(isHidden);
  const hiddenOpen = showHidden || hiddenExpanded;
  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderRow = (r: FieldDiffRow) => {
    const spec = CLS_SPEC[r.category] ?? CLS_SPEC.changed;
    const expandId = `${idBase}-x-${r.path}`;
    const expanded = expandedRows.has(r.path);
    const canExpand = diffValueLines(r.snapshot) > MAX_LINES || diffValueLines(r.cluster) > MAX_LINES;
    const onExpand = canExpand ? () => toggleRow(r.path) : undefined;
    const showType = differsOnlyByType(r.snapshot, r.cluster);
    return (
      <Fragment key={r.path}>
        <tr className={cx(styles.fdRow, isHidden(r) && styles.fdRowHidden)} data-category={r.category}>
          <th scope="row" className={styles.fdPath}>
            {pathWithBreaks(r.path)}
          </th>
          <td className={styles.fdValue}>
            <DiffValue
              value={r.snapshot}
              maxLines={MAX_LINES}
              showType={showType}
              onExpand={onExpand}
              expanded={expanded}
              controlsId={expandId}
            />
          </td>
          <td className={styles.fdArrow}>
            <span aria-hidden="true">→</span>
          </td>
          <td className={styles.fdValue}>
            <DiffValue
              value={r.cluster}
              maxLines={MAX_LINES}
              showType={showType}
              onExpand={onExpand}
              expanded={expanded}
              controlsId={expandId}
            />
          </td>
          <td className={styles.fdCls}>
            {spec.icon ? (
              <Chip label={spec.label} icon={spec.icon} size="sm" />
            ) : (
              <span className={styles.fdClsText}>{spec.label}</span>
            )}
            {r.reason ? <span className={styles.fdClsDetail}>{r.reason}</span> : null}
          </td>
        </tr>
        {canExpand && expanded ? (
          <tr className={styles.fdExpandRow} id={expandId}>
            <td colSpan={5}>
              <div className={styles.fdExpand}>
                <div className={styles.fdExpandCol}>
                  <span className={styles.fdExpandLabel}>스냅샷 값</span>
                  <DiffValue value={r.snapshot} maxLines={Infinity} showType={showType} />
                </div>
                <div className={styles.fdExpandCol}>
                  <span className={styles.fdExpandLabel}>클러스터 값</span>
                  <DiffValue value={r.cluster} maxLines={Infinity} showType={showType} />
                </div>
              </div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  const groupInner = (
    <>
      <Icon name="chevron-right" size={12} className={cx(styles.chevron, hiddenOpen && styles.chevronOpen)} />
      <span>숨긴 차이 {hidden.length.toLocaleString("en-US")}건</span>
      <span className={styles.fdGroupDetail}>({hiddenBreakdown(hidden)})</span>
    </>
  );

  return (
    <div className={cx(styles.fdWrap, className)} aria-busy={state === "loading" || undefined}>
      {state === "ready" && visible.length === 0 && hidden.length > 0 ? (
        <p className={styles.fdNote}>{hiddenOnlyText}</p>
      ) : null}
      <div className={styles.fdScroll}>
        <table className={styles.fdTable}>
          <caption className="sr-only">{caption}</caption>
          <colgroup>
            <col className={styles.fdColPath} />
            <col className={styles.fdColValue} />
            <col className={styles.fdColArrow} />
            <col className={styles.fdColValue} />
            <col className={styles.fdColCls} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">필드</th>
              <th scope="col">스냅샷 값</th>
              <td aria-hidden="true" />
              <th scope="col">클러스터 값</th>
              <th scope="col">분류</th>
            </tr>
          </thead>
          <tbody>
            {state === "loading" ? (
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i} className={styles.fdRow}>
                  <td colSpan={5}>
                    <Skeleton width="60%" height={12} />
                  </td>
                </tr>
              ))
            ) : (
              <>
                {visible.map(renderRow)}
                {hidden.length > 0 ? (
                  <tr className={styles.fdGroupRow}>
                    <td colSpan={5}>
                      {showHidden || !onHiddenToggle ? (
                        <span className={styles.fdGroup}>{groupInner}</span>
                      ) : (
                        <button
                          type="button"
                          className={cx(styles.fdGroup, styles.fdGroupButton)}
                          aria-expanded={hiddenOpen}
                          onClick={onHiddenToggle}
                        >
                          {groupInner}
                        </button>
                      )}
                    </td>
                  </tr>
                ) : null}
                {hiddenOpen ? hidden.map(renderRow) : null}
                {truncated ? (
                  <tr className={styles.fdTruncRow}>
                    <td colSpan={5}>
                      <span className={styles.fdTrunc}>
                        <Icon name="info" size={12} />
                        {FIELDS_TRUNCATED_TEXT}
                      </span>
                    </td>
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
