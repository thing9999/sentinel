"use client";

import { useId, useState, type ReactNode } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import styles from "./layout.module.css";

export interface JsonTreeProps {
  data: unknown;
  /** 기본 1 */
  defaultExpandDepth?: number;
  /** 기본 true */
  searchable?: boolean;
  /** px */
  maxHeight?: number;
  /** 가려진 값 표시 문자열, 기본 `[가림]` */
  redactedText?: string;
  className?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function matches(v: unknown, q: string): boolean {
  if (!q) return false;
  if (Array.isArray(v)) return v.some((x) => matches(x, q));
  if (isObj(v)) return Object.entries(v).some(([k, x]) => k.toLowerCase().includes(q) || matches(x, q));
  return String(v).toLowerCase().includes(q);
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className={styles.jsonMark}>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

interface NodeProps {
  name: string | number | null;
  value: unknown;
  depth: number;
  defaultDepth: number;
  q: string;
  redacted: string;
}

function Primitive({ value, q, redacted }: { value: unknown; q: string; redacted: string }) {
  if (value === redacted) return <span className={styles.jsonRedacted}>{redacted}</span>;
  if (typeof value === "string")
    return (
      <span className={styles.jsonString}>
        &quot;
        <Highlight text={value} q={q} />
        &quot;
      </span>
    );
  if (typeof value === "number")
    return (
      <span className={styles.jsonNumber}>
        <Highlight text={String(value)} q={q} />
      </span>
    );
  if (typeof value === "boolean" || value === null)
    return <span className={styles.jsonBool}>{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function JsonNode({ name, value, depth, defaultDepth, q, redacted }: NodeProps) {
  const [open, setOpen] = useState(depth < defaultDepth);
  const branch = Array.isArray(value) || isObj(value);
  const keyEl: ReactNode =
    name === null ? null : (
      <span className={styles.jsonKey}>
        {typeof name === "number" ? name : <Highlight text={name} q={q} />}
        <span aria-hidden="true">: </span>
      </span>
    );

  if (!branch) {
    return (
      <li className={styles.jsonRow} style={{ paddingLeft: `calc(${depth} * var(--spacing-4) + var(--size-icon-xs) + var(--spacing-1))` }}>
        {keyEl}
        <Primitive value={value} q={q} redacted={redacted} />
      </li>
    );
  }

  const entries: Array<[string | number, unknown]> = Array.isArray(value)
    ? value.map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const expanded = open || (q !== "" && matches(value, q));
  const summary = Array.isArray(value) ? `[${entries.length}개]` : `{${entries.length}개}`;

  return (
    <li className={styles.jsonBranch}>
      <button
        type="button"
        className={styles.jsonToggle}
        style={{ paddingLeft: `calc(${depth} * var(--spacing-4))` }}
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        <Icon name="chevron-right" size={12} className={cx(styles.chevron, expanded && styles.chevronOpen)} />
        {keyEl}
        <span className={styles.jsonSummary}>{summary}</span>
      </button>
      {expanded ? (
        <ul className={styles.jsonList}>
          {entries.map(([k, v]) => (
            <JsonNode key={String(k)} name={k} value={v} depth={depth + 1} defaultDepth={defaultDepth} q={q} redacted={redacted} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * components.md 8.8. 스냅샷 미리보기. 모든 키·값을 텍스트 노드로만 렌더한다.
 * 검색어가 있으면 일치 항목이 있는 가지를 펼치고 일치 부분을 <mark>로 강조한다.
 */
export function JsonTree({
  data,
  defaultExpandDepth = 1,
  searchable = true,
  maxHeight,
  redactedText = "[가림]",
  className,
}: JsonTreeProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  return (
    <div className={cx(styles.json, className)}>
      {searchable ? (
        <div className={styles.jsonSearch}>
          <label htmlFor={id} className="sr-only">
            JSON 검색
          </label>
          <Icon name="search" size={16} className={styles.jsonSearchIcon} />
          <input
            id={id}
            type="search"
            className={styles.jsonSearchInput}
            placeholder="키 또는 값 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}
      <div className={styles.jsonScroll} style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined} tabIndex={0}>
        <ul className={styles.jsonList} aria-label="JSON">
          <JsonNode name={null} value={data} depth={0} defaultDepth={defaultExpandDepth} q={q} redacted={redactedText} />
        </ul>
      </div>
    </div>
  );
}
