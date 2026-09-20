"use client";

/** 사전 점검 섹션 (architecture-advisor.md 2.3). 규칙 기반 · LLM 미사용. 절감액은 모두 서버 계산 추정. */
import { useEffect, useState } from "react";

import {
  Button,
  CategoryChip,
  Chip,
  CostKindBadge,
  DataTable,
  EmptyState,
  formatCount,
  formatDurationTable,
  formatTime,
  Grid,
  GridItem,
  KeyValueList,
  MoneyValue,
  ResourceName,
  Section,
  SeverityBadge,
  SeverityMatrix,
  Skeleton,
  SourceLabel,
  StatusBadge,
  Switch,
  Tooltip,
  UnknownState,
  type AdvisorCategory,
  type Column,
  type Severity,
  type StatusAltLabel,
} from "@/components/ui";

import { useApi } from "../common/hooks";
import { badgeProps } from "../stream/stale";
import { suggestionCategory } from "./mapping";
import type { PrecheckItem, PrecheckSummary, PrechecksResponse } from "./types";

const DEFAULT_ROWS = 8;

export function precheckLabel(p: { status: { status: string }; counts: { high: number; medium: number } }): StatusAltLabel | undefined {
  if (p.status.status === "critical") return `높음 ${p.counts.high}건`;
  if (p.status.status === "warning") return `중간 ${p.counts.medium}건`;
  if (p.status.status === "ok") return "문제 없음";
  return undefined;
}

export interface PrecheckSectionProps {
  summary: PrecheckSummary | null;
  /** 제안 카드의 R-ID 클릭 → 해당 행으로 */
  focusRule: { id: string; nonce: number } | null;
  staleAt?: string;
  /** 시스템 네임스페이스 포함 (분석 실행 요청에도 같은 값을 쓴다) */
  includeSystem: boolean;
  onIncludeSystemChange: (v: boolean) => void;
}

export function PrecheckSection({ summary, focusRule, staleAt, includeSystem, onIncludeSystemChange }: PrecheckSectionProps) {
  const q = useApi<PrechecksResponse>("/advisor/prechecks", { includeSystem }, summary?.computedAt ?? null);
  const [cell, setCell] = useState<{ category: AdvisorCategory; severity: Severity } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [handledFocus, setHandledFocus] = useState<number | null>(null);

  const data = q.data;
  const items = data?.items ?? [];

  // R-ID 링크: 해당 행 펼침 + 1500ms 강조 (렌더 중 상태 조정 → 스크롤은 effect)
  if (focusRule && focusRule.nonce !== handledFocus && data) {
    const row = items.find((i) => i.ruleId === focusRule.id || i.id === focusRule.id);
    setHandledFocus(focusRule.nonce);
    if (row) {
      setCell(null);
      setShowAll(true);
      setExpanded((cur) => (cur.includes(row.id) ? cur : [...cur, row.id]));
      setSelected(row.id);
    }
  }
  useEffect(() => {
    if (!selected) return;
    const el = document.querySelector('tr[aria-current="true"]');
    if (el) (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setSelected(null), 1500);
    return () => clearTimeout(t);
  }, [selected]);

  const filtered = cell ? items.filter((i) => suggestionCategory(i) === cell.category && i.severity === cell.severity) : items;
  const shown = showAll || cell ? filtered : filtered.slice(0, DEFAULT_ROWS);
  const status = data?.status ?? summary?.status ?? null;
  const counts = data?.counts ?? summary?.counts ?? null;
  const noData = status?.reasons.some((r) => r.code === "PRECHECK_NO_DATA");
  const heldItems = items.filter((i) => i.held);
  const heldObs = heldItems.find((i) => i.observedSec !== null)?.observedSec ?? null;

  const cells = data
    ? (Object.fromEntries(
        (Object.entries(data.matrix) as [string, Record<Severity, number>][]).map(([k, v]) => [k === "database" ? "db" : k, v]),
      ) as Record<AdvisorCategory, Record<Severity, number>>)
    : null;

  const columns: Column<PrecheckItem>[] = [
    {
      id: "severity",
      header: "심각도",
      width: 88,
      render: (i) => (i.held || !i.severity ? <Chip label="판단 보류" icon="hourglass" /> : <SeverityBadge severity={i.severity} size="sm" />),
    },
    {
      id: "rule",
      header: "규칙",
      width: 104,
      render: (i) => (
        <Tooltip content={i.ruleTitle}>
          <span className="text-mono">{i.ruleId}</span>
        </Tooltip>
      ),
    },
    { id: "category", header: "카테고리", width: 104, render: (i) => <CategoryChip category={suggestionCategory(i)} size="sm" /> },
    {
      id: "content",
      header: "내용",
      minWidth: 240,
      render: (i) => (
        <span className="stack-sm" style={{ gap: 0 }}>
          <span>{i.summary}</span>
          <span className="text-caption">{i.held ? (i.heldReason ?? i.evidenceText) : i.evidenceText}</span>
        </span>
      ),
    },
    { id: "targets", header: "대상 수", width: 72, numeric: true, render: (i) => (i.held ? "" : formatCount(i.targetCount)) },
    {
      id: "savings",
      header: "예상 월 절감",
      headerBadge: <CostKindBadge kind="estimate" />,
      width: 170,
      numeric: true,
      render: (i) => (i.savings ? <MoneyValue amount={i.savings.monthlyUsd} kind="estimate" unit="month" size="sm" asOf={i.savings.asOf} /> : null),
    },
  ];

  return (
    <Section
      title="사전 점검"
      id="prechecks"
      badges={
        <>
          <SourceLabel source="rule" detail="LLM 미사용" />
          {status && counts ? <StatusBadge size="md" {...badgeProps(status, staleAt ? { stale: true, at: staleAt } : undefined)} label={precheckLabel({ status, counts })} /> : null}
        </>
      }
      actions={
        <span className="row">
          {data?.computedAt || summary?.computedAt ? (
            <span className="text-caption-tertiary" suppressHydrationWarning>
              {formatTime((data?.computedAt ?? summary?.computedAt) as string, "autoShort")} 계산 · {Math.round((data?.intervalSec ?? summary?.intervalSec ?? 300) / 60)}분마다 갱신
            </span>
          ) : null}
          <Switch label="시스템 네임스페이스 포함" checked={includeSystem} onChange={onIncludeSystemChange} />
        </span>
      }
    >
      {noData ? (
        <UnknownState size="sm" reason={status?.reasons[0]?.text ?? "알 수 없음 (클러스터 연결 없음)"} />
      ) : !data ? (
        q.error ? (
          <UnknownState size="sm" reason="사전 점검 결과를 불러오지 못했습니다" onRetry={q.reload} />
        ) : (
          <Skeleton lines={6} />
        )
      ) : (
        <Grid>
          <GridItem span={4} spanMd={12}>
            {cells ? (
              <SeverityMatrix
                cells={cells}
                selected={cell}
                onCellClick={(category, severity) =>
                  setCell((cur) => (cur && cur.category === category && cur.severity === severity ? null : { category, severity }))
                }
                footnote={
                  counts && counts.held > 0 ? `판단 보류 ${formatCount(counts.held)}건${heldObs !== null ? ` (관측 ${formatDurationTable(heldObs * 1000)})` : ""}` : undefined
                }
                caption="사전 점검 요약"
              />
            ) : null}
          </GridItem>
          <GridItem span={8} spanMd={12}>
            {items.length === 0 ? (
              <EmptyState size="sm" icon="circle-check" iconTone="ok" title="사전 점검에서 발견된 항목이 없습니다" />
            ) : (
              <div className="stack-sm">
                <DataTable
                  caption="사전 점검 결과"
                  columns={columns}
                  rows={shown}
                  rowKey={(i) => i.id}
                  selectedKey={selected}
                  expandable={{
                    expandedKeys: expanded,
                    onToggle: (k) => setExpanded((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k])),
                    canExpand: (i) => !i.held,
                    render: (i) => <PrecheckDetail item={i} />,
                  }}
                  state={filtered.length ? "ready" : "filteredEmpty"}
                  filteredEmptyText="선택한 칸에 해당하는 항목이 없습니다"
                  onResetFilters={() => setCell(null)}
                />
                {!cell && filtered.length > DEFAULT_ROWS ? (
                  <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "접기" : `전체 ${formatCount(filtered.length)}건 보기`}
                  </Button>
                ) : null}
              </div>
            )}
          </GridItem>
        </Grid>
      )}
    </Section>
  );
}

function PrecheckDetail({ item }: { item: PrecheckItem }) {
  const shown = item.targets.slice(0, 20);
  const more = item.targetCount - shown.length;
  return (
    <div className="stack">
      {shown.length ? (
        <div className="stack-sm">
          <span className="text-caption">대상</span>
          <span className="row">
            {shown.map((t, i) => (
              <ResourceName key={`${t.kind}-${t.name}-${i}`} name={t.name} namespace={t.namespace ?? undefined} kind="other" copyable={false} maxWidth={260} />
            ))}
            {more > 0 ? <span className="text-caption">외 {formatCount(more)}개</span> : null}
          </span>
        </div>
      ) : null}
      {item.evidence.length ? (
        <KeyValueList items={item.evidence.map((e) => ({ label: e.field ?? "근거", value: e.value === null ? e.text : String(e.value), hint: e.value === null ? undefined : e.text }))} labelWidth={200} />
      ) : null}
      {item.savings ? (
        <div className="stack-sm">
          <span className="text-mono" style={{ background: "var(--color-code-bg)", padding: "8px 12px", borderRadius: 4, overflowWrap: "anywhere" }}>
            {item.savings.formula}
          </span>
          <span className="text-caption">서버 계산</span>
        </div>
      ) : null}
    </div>
  );
}
