"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cx } from "../cx";
import { Icon } from "../icons";
import styles from "./controls.module.css";

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 기본 200ms */
  debounceMs?: number;
  /** px, 기본 240. 좁은 화면에서는 100%까지 줄어든다 */
  width?: number;
  /** 스크린리더 이름 (기본: placeholder 또는 `검색`) */
  label?: string;
  /** `/` 단축키로 포커스 (기본 true, 페이지에 하나만 켠다) */
  shortcut?: boolean;
  className?: string;
}

/** components.md 4.4. 입력은 즉시 보이고 onChange 는 디바운스해서 호출한다. */
export function SearchInput({
  value,
  onChange,
  placeholder = "검색",
  debounceMs = 200,
  width = 240,
  label,
  shortcut = true,
  className,
}: SearchInputProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timer = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // 외부에서 값이 바뀌면(필터 초기화 등) 입력도 맞춘다
  if (value !== prevValue) {
    setPrevValue(value);
    setText(value);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shortcut]);

  const emit = (next: string, immediate = false) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (immediate || debounceMs <= 0) {
      onChangeRef.current(next);
      return;
    }
    timer.current = window.setTimeout(() => onChangeRef.current(next), debounceMs);
  };

  return (
    <div className={cx(styles.search, className)} style={{ width: `min(${width}px, 100%)` }}>
      <label htmlFor={id} className="sr-only">
        {label ?? placeholder}
      </label>
      <Icon name="search" size={16} className={styles.searchIcon} />
      <input
        ref={inputRef}
        id={id}
        type="search"
        className={styles.searchInput}
        value={text}
        placeholder={placeholder}
        aria-keyshortcuts={shortcut ? "/" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          emit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && text) {
            e.preventDefault();
            setText("");
            emit("", true);
          }
        }}
      />
      {text ? (
        <button
          type="button"
          className={styles.searchClear}
          aria-label="검색어 지우기"
          onClick={() => {
            setText("");
            emit("", true);
            inputRef.current?.focus();
          }}
        >
          <Icon name="x" size={14} />
        </button>
      ) : null}
    </div>
  );
}
