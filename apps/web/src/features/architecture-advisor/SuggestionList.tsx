"use client";

/**
 * 제안 목록 + 필터 (architecture-advisor.md 2.5·2.6). 최근 결과와 지난 결과 화면이 같이 쓴다.
 * 모든 LLM 문자열은 SuggestionCard 가 텍스트 노드로만 렌더한다(HTML·마크다운 해석 없음).
 */
import { useState } from "react";

import {
  Button,
  CATEGORY_LABEL,
  CategoryChip,
  FilterBar,
  formatCount,
  Icon,
  MultiSelect,
  SegmentedControl,
  SuggestionCard,
  type AdvisorCategory,
} from "@/components/ui";

import { filterSuggestions, suggestionCategory, suggestionToCard, type SourceFilter } from "./mapping";
import type { Suggestion } from "./types";

const CATEGORIES: AdvisorCategory[] = ["cost", "reliability", "performance", "security", "db"];

export function SuggestionList({ suggestions, onRuleClick }: { suggestions: Suggestion[]; onRuleClick?: (ruleId: string) => void }) {
  const [categories, setCategories] = useState<AdvisorCategory[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [source, setSource] = useState<SourceFilter>("all");
  // 기본: 1순위 카드만 펼침
  const [expanded, setExpanded] = useState<string[]>(() => (suggestions[0] ? [suggestions[0].id] : []));

  const list = filterSuggestions(suggestions, { categories, severities, source });
  const verified = list.filter((s) => !s.unverified);
  const unverified = list.filter((s) => s.unverified);
  const countBy = (c: AdvisorCategory) => suggestions.filter((s) => suggestionCategory(s) === c).length;
  const toggle = (id: string) => setExpanded((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const isDefault = !categories.length && !severities.length && source === "all";

  const card = (s: Suggestion) => (
    <SuggestionCard key={s.id} {...suggestionToCard(s)} expanded={expanded.includes(s.id)} onToggle={() => toggle(s.id)} onRuleClick={onRuleClick} />
  );

  return (
    <div className="stack">
      <FilterBar
        label="제안 필터"
        resultText={`제안 ${formatCount(suggestions.length)}건 중 ${formatCount(list.length)}건 표시`}
        onReset={
          isDefault
            ? undefined
            : () => {
                setCategories([]);
                setSeverities([]);
                setSource("all");
              }
        }
      >
        <span className="row" role="group" aria-label="카테고리">
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c}
              category={c}
              count={countBy(c)}
              pressed={categories.includes(c)}
              onClick={() => setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
            />
          ))}
        </span>
        <MultiSelect
          label="심각도"
          value={severities}
          onChange={setSeverities}
          options={[
            { value: "high", label: "높음" },
            { value: "medium", label: "중간" },
            { value: "low", label: "낮음" },
          ]}
        />
        <SegmentedControl
          size="sm"
          label="출처"
          value={source}
          onChange={(v) => setSource(v as SourceFilter)}
          options={[
            { value: "all", label: "전체" },
            { value: "linked", label: "사전 점검 연결" },
            { value: "llmOnly", label: "AI 단독" },
          ]}
        />
        <Button variant="ghost" size="sm" onClick={() => setExpanded(list.map((s) => s.id))}>
          모두 펼치기
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded([])}>
          모두 접기
        </Button>
      </FilterBar>
      {list.length === 0 ? <p className="text-caption">필터 조건에 맞는 제안이 없습니다{categories.length ? ` (${categories.map((c) => CATEGORY_LABEL[c]).join(", ")})` : ""}</p> : null}
      <div className="stack">{verified.map(card)}</div>
      {unverified.length ? (
        <div className="stack" style={{ marginTop: "var(--spacing-4)" }}>
          <p className="row" style={{ margin: 0, color: "var(--color-status-warn-fg)", font: "var(--font-caption-strong)" }}>
            <Icon name="triangle-alert" size={14} />
            근거를 확인할 수 없는 제안 ({formatCount(unverified.length)})
          </p>
          {unverified.map(card)}
        </div>
      ) : null}
    </div>
  );
}
