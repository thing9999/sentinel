"use client";

import { useId, useState, type ReactNode } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { Popover } from "../overlay/Popover";
import styles from "./controls.module.css";

export interface SelectOption {
  value: string;
  label: string;
  count?: number;
  /** MultiSelect 목록에서만 표시 (네이티브 select 는 아이콘을 넣을 수 없다) */
  icon?: IconName;
  /**
   * MultiSelect 목록에서 라벨 앞에 두는 **작은 견본**(`icon` 을 대신한다).
   * 3D 구성도의 종류 필터가 `ShapeSwatch` 14px `tone="layer"` 를 여기로 넘긴다
   * (snapshot-3d.md 6.1 — "색(층) + 모양(종류)을 한 번에"). 언제나 장식이어야 한다:
   * 뜻은 옆 라벨 글자가 진다(`aria-hidden`).
   */
  adornment?: ReactNode;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** 버튼 앞 문구 (예: `노드그룹`) */
  label: string;
  /** px, 기본 180 */
  width?: number;
  disabled?: boolean;
  className?: string;
}

const optionText = (o: SelectOption) => (o.count !== undefined ? `${o.label} (${o.count.toLocaleString("en-US")})` : o.label);

/**
 * components.md 4.5 Select. 네이티브 <select> 를 써서 키보드·모바일·스크린리더를 브라우저에 맡긴다.
 * (searchable 은 네이티브 타이프어헤드로 대체)
 */
export function Select({ options, value, onChange, label, width = 180, disabled, className }: SelectProps) {
  const id = useId();
  return (
    <div className={cx(styles.select, className)} style={{ width: `min(${width}px, 100%)` }}>
      <label htmlFor={id} className={styles.selectLabel}>
        {label}
      </label>
      <select
        id={id}
        className={styles.selectNative}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {optionText(o)}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className={styles.selectChevron} />
    </div>
  );
}

export interface MultiSelectProps {
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  /** 버튼 문구 앞부분 (예: `네임스페이스`) */
  label: string;
  /** px, 기본 180 */
  width?: number;
  /** 기본: 옵션 10개 초과면 true */
  searchable?: boolean;
  className?: string;
}

/**
 * components.md 4.5 MultiSelect. 버튼 문구: 0개 `네임스페이스: 전체`, 1개 `네임스페이스: batch`, 2개 이상 `네임스페이스: 3개`.
 * 목록 Popover 최대 높이 320px, 체크박스 목록.
 */
export function MultiSelect({ options, value, onChange, label, width = 180, searchable, className }: MultiSelectProps) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const canSearch = searchable ?? options.length > 10;
  const selected = new Set(value);
  const summary =
    value.length === 0
      ? "전체"
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? value[0])
        : `${value.length}개`;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  const toggle = (v: string) => {
    const next = selected.has(v) ? value.filter((x) => x !== v) : [...value, v];
    onChange(next);
  };

  return (
    <Popover
      label={`${label} 선택`}
      width={Math.max(width, 240)}
      className={className}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          className={styles.multiTrigger}
          style={{ width: `min(${width}px, 100%)` }}
        >
          <span className={styles.multiText}>
            {label}: {summary}
          </span>
          <Icon name="chevron-down" size={16} />
        </button>
      )}
    >
      {canSearch ? (
        <div className={styles.multiSearch}>
          <label htmlFor={searchId} className="sr-only">
            {label} 찾기
          </label>
          <input
            id={searchId}
            type="search"
            className={styles.multiSearchInput}
            placeholder={`${label} 찾기`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      ) : null}
      <fieldset className={styles.multiList}>
        <legend className="sr-only">{label}</legend>
        {shown.map((o) => (
          <label key={o.value} className={styles.multiItem}>
            <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
            {o.adornment ?? (o.icon ? <Icon name={o.icon} size={14} /> : null)}
            <span className={styles.multiItemLabel}>{o.label}</span>
            {o.count !== undefined ? <span className={styles.count}>{o.count.toLocaleString("en-US")}</span> : null}
          </label>
        ))}
        {shown.length === 0 ? <p className={styles.multiEmpty}>일치하는 항목이 없습니다</p> : null}
      </fieldset>
      {value.length > 0 ? (
        <div className={styles.multiFooter}>
          <button type="button" className={styles.linkButton} onClick={() => onChange([])}>
            선택 해제 (전체)
          </button>
        </div>
      ) : null}
    </Popover>
  );
}
