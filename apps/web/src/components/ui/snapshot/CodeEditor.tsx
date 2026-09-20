"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

import { cx } from "../cx";
import { Skeleton } from "../feedback/Skeleton";
import { Icon } from "../icons";
import { Tooltip } from "../overlay/Tooltip";
import {
  CODE_PAD_LEFT,
  CODE_PAD_RIGHT,
  CODE_PAD_Y,
  buildDecorations,
  gutterNumberWidth,
  gutterWidth,
  lineOffsets,
  maxVisualWidth,
  scrollTopForLine,
  splitLines,
  targetAnnouncement,
  visibleRange,
  type CodeEditorMarker,
  type LineDecoration,
} from "./codeEditorModel";
import styles from "./snapshot.module.css";

export type { CodeEditorMarker, CodeEditorMarkerItem, LineDecoration } from "./codeEditorModel";

/* ────────────────────────────────────────────────────────────────────────────
 * 엔진 인터페이스
 * CodeEditor(틀)는 테두리·포커스 표시·잠금·로딩·키 규칙(Tab/Esc/Ctrl+S)·이동 안내(live)·줄 장식 계산을 맡고,
 * 실제 텍스트 렌더링·입력은 "엔진"이 맡는다. 기본 엔진(PlainCodeEngine)은 라이브러리 없이
 * 가상 렌더링(보이는 줄만 DOM) + textarea 편집을 한다. CodeMirror 등으로 바꾸려면 `engine` 에 렌더 함수를 넘긴다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 틀이 엔진에게 요구하는 동작 (engineRef 로 연결) */
export interface CodeEditorEngineHandle {
  /** 줄(1부터)을 영역 위에서 1/3 위치로 스크롤. edit 이면 커서를 그 줄 처음으로 */
  scrollToLine: (line: number) => void;
  /** 입력(또는 보기 영역)에 포커스 (스크롤 이동 없이) */
  focus: () => void;
}

/** 키 판단 결과: 엔진은 indent/outdent 일 때만 텍스트를 바꾼다(기본 동작은 틀이 이미 막았다) */
export type CodeEditorKeyAction = "indent" | "outdent" | null;

export interface CodeEditorEngineProps {
  value: string;
  /** splitLines(value) 결과 (줄 번호 = index + 1) */
  lines: string[];
  mode: "view" | "edit";
  /** mode=edit && !locked */
  editable: boolean;
  /** 잠금(aria-readonly, 입력 불가) */
  locked: boolean;
  wrap: boolean;
  /** Tab 이 넣는 문자열 */
  indentUnit: string;
  /** 줄 번호 → 장식 (발견 등급·툴팁·이동 대상·강조) */
  decorations: Map<number, LineDecoration>;
  /** 입력 요소의 aria-label (`terraform.tf 편집기, 1,284줄` / `terraform.tf 내용`) */
  ariaLabel: string;
  onChange?: (value: string) => void;
  /** 입력 요소의 keydown 에서 호출. 반환값이 indent/outdent 면 엔진이 들여쓰기 처리 */
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => CodeEditorKeyAction;
  engineRef: Ref<CodeEditorEngineHandle>;
}

export type CodeEditorEngine = (props: CodeEditorEngineProps) => ReactNode;

export interface CodeEditorProps {
  /** 파일 내용. **텍스트로만** 렌더(문법 강조·HTML 해석 없음) */
  value: string;
  /** 접근성 라벨·이동 안내에 쓰는 파일 이름 */
  fileName: string;
  mode?: "view" | "edit";
  /** 저장 전 검사·저장 중 입력 잠금 (aria-readonly) */
  locked?: boolean;
  /** edit 일 때. 기본 엔진은 브라우저 textarea 규칙대로 CRLF/CR 을 LF 로 바꾼 값을 준다(줄 수는 1:1) */
  onChange?: (value: string) => void;
  /** gutter 아이콘 + 줄 배경. 한 줄에 여러 항목이면 가장 나쁜 등급 */
  markers?: CodeEditorMarker[];
  /** 이동 대상 줄. 값(또는 targetKey)이 바뀔 때마다 그 줄로 스크롤 + 포커스 + 안내 */
  targetLine?: number | null;
  /** 같은 줄로 다시 이동하고 싶을 때 바꾸는 값(예: 발견 항목 클릭 횟수) */
  targetKey?: string | number;
  /** 이동 후 안내 문구를 호출 측 live 영역으로. 없으면 내부 live 영역(polite)에 넣는다 */
  onTargetAnnounce?: (text: string) => void;
  wrap?: boolean;
  /** Tab 이 넣는 문자열, 기본 공백 2칸 */
  indentUnit?: string;
  /** edit 일 때 Ctrl/Cmd+S (브라우저 저장 대화상자는 막는다) */
  onSaveShortcut?: () => void;
  /** px 또는 CSS 값(`clamp(480px, calc(100vh - 176px), 960px)`) */
  height?: number | string;
  /** 읽기 전용 강조(메타데이터 손상 위치) — 배경 status.crit.bg */
  highlightLine?: number | null;
  /** loading: 스켈레톤 12줄 */
  state?: "ready" | "loading";
  /** 편집 엔진 교체 (기본 PlainCodeEngine) */
  engine?: CodeEditorEngine;
  className?: string;
}

const EMPTY_MARKERS: CodeEditorMarker[] = [];

/** height 를 주지 않았을 때: 작업 영역 높이(aws-snapshot-manager.md 5.2). 가상 렌더링에는 정해진 높이가 필요하다 */
export const CODE_EDITOR_DEFAULT_HEIGHT = "clamp(480px, calc(100vh - 176px), 960px)";

/** 기본 엔진은 편집 중 줄 바꿈을 지원하지 않는다(textarea 줄 위치와 gutter 를 1:1 로 맞추기 위해). 보기 모드는 지원 */
export const PLAIN_ENGINE_WRAP_IN_EDIT = false;

/**
 * components.md 11.1 / aws-snapshot-manager.md 5절. 템플릿 보기·편집 겸용 코드 영역.
 * 탭·툴바·알림 슬롯은 밖에서 조립한다(Tabs·Button·InlineAlert). 포커스 표시는 코드 영역 안쪽 2px border.focus.
 * 키보드: Tab = indentUnit, `Esc` 다음 `Tab`/`Shift+Tab` 은 포커스 이동. Esc 만으로 모드를 바꾸지 않는다.
 */
export function CodeEditor({
  value,
  fileName,
  mode = "view",
  locked = false,
  onChange,
  markers = EMPTY_MARKERS,
  targetLine = null,
  targetKey,
  onTargetAnnounce,
  wrap = false,
  indentUnit = "  ",
  onSaveShortcut,
  height,
  highlightLine = null,
  state = "ready",
  engine,
  className,
}: CodeEditorProps) {
  const lines = useMemo(() => splitLines(value), [value]);
  const decorations = useMemo(
    () => buildDecorations(markers, targetLine, highlightLine),
    [markers, targetLine, highlightLine],
  );
  const editable = mode === "edit" && !locked;
  const engineRef = useRef<CodeEditorEngineHandle | null>(null);
  const escArmed = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  const lineCountText = lines.length.toLocaleString("en-US");
  const ariaLabel = mode === "edit" ? `${fileName} 편집기, ${lineCountText}줄` : `${fileName} 내용`;

  const saveRef = useRef(onSaveShortcut);
  const announceRef = useRef(onTargetAnnounce);
  const markersRef = useRef(markers);
  useLayoutEffect(() => {
    saveRef.current = onSaveShortcut;
    announceRef.current = onTargetAnnounce;
    markersRef.current = markers;
  });

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLElement>): CodeEditorKeyAction => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        if (mode === "edit") {
          e.preventDefault();
          saveRef.current?.();
        }
        escArmed.current = false;
        return null;
      }
      if (e.key === "Escape") {
        // Esc 는 모드를 바꾸지 않는다. 다음 Tab 을 포커스 이동으로 쓰게 표시만
        escArmed.current = true;
        return null;
      }
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (escArmed.current || !editable) {
          escArmed.current = false;
          return null; // 브라우저 기본: 포커스 이동
        }
        e.preventDefault();
        return e.shiftKey ? "outdent" : "indent";
      }
      if (e.key !== "Shift") escArmed.current = false;
      return null;
    },
    [mode, editable],
  );

  // 이동 대상 줄: 값(또는 targetKey)이 바뀔 때마다 이동 + 포커스 + 안내
  useEffect(() => {
    if (state !== "ready" || !targetLine || targetLine < 1) return;
    const h = engineRef.current;
    if (!h) return;
    h.scrollToLine(targetLine);
    h.focus();
    const text = targetAnnouncement(fileName, targetLine, markersRef.current);
    if (announceRef.current) announceRef.current(text);
    else setAnnouncement(text);
  }, [targetLine, targetKey, fileName, state]);

  const Engine = engine ?? PlainCodeEngine;
  const effectiveWrap = engine ? wrap : wrap && (mode !== "edit" || PLAIN_ENGINE_WRAP_IN_EDIT);

  return (
    <div
      className={cx(
        styles.editor,
        mode === "edit" && styles.editorEdit,
        locked && styles.editorLocked,
        className,
      )}
      style={{ height: height === undefined ? CODE_EDITOR_DEFAULT_HEIGHT : typeof height === "number" ? `${height}px` : height }}
      data-mode={mode}
      data-locked={locked ? "true" : undefined}
      data-wrap={effectiveWrap ? "true" : "false"}
      aria-busy={state === "loading" || undefined}
    >
      {state === "loading" ? (
        <div className={styles.editorLoading} role="status" aria-label={`${fileName} 불러오는 중`}>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className={styles.editorSkeletonRow}>
              <Skeleton width={`${[30, 80, 55, 70, 40, 65][i % 6]}%`} height={12} />
            </div>
          ))}
        </div>
      ) : (
        <Engine
          value={value}
          lines={lines}
          mode={mode}
          editable={editable}
          locked={locked}
          wrap={effectiveWrap}
          indentUnit={indentUnit}
          decorations={decorations}
          ariaLabel={ariaLabel}
          onChange={onChange}
          onKeyDown={onKeyDown}
          engineRef={engineRef}
        />
      )}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}


/* ──────────────────────────── 기본 엔진 ──────────────────────────── */

/** 폰트 폭 측정 전(또는 jsdom) 기본값 */
const FALLBACK_CHAR_W = 7.8;
const FALLBACK_VIEWPORT = { width: 800, height: 480 };

/**
 * 라이브러리 없는 기본 엔진.
 * - 보기: 보이는 줄만 DOM 에 둔다(위아래 spacer). 줄 바꿈이면 폭으로 줄 높이를 추정(흐름 배치라 겹치지 않음).
 * - 편집: 전체 높이 textarea(투명 배경, wrap=off)를 본문 칸 위에 겹치고, 아래 층에 gutter·줄 배경만 가상 렌더링.
 *   20px 고정 줄 높이라 textarea 줄과 gutter 가 1:1 로 맞는다. 편집 상한(5MB) 파일까지를 가정한다.
 */
export function PlainCodeEngine({
  lines,
  value,
  mode,
  editable,
  locked,
  wrap,
  indentUnit,
  decorations,
  ariaLabel,
  onChange,
  onKeyDown,
  engineRef,
}: CodeEditorEngineProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);
  const [charW, setCharW] = useState(FALLBACK_CHAR_W);
  const isEdit = mode === "edit";

  const numW = gutterNumberWidth(lines.length);
  const gutterW = gutterWidth(lines.length);
  const maxCols = useMemo(() => maxVisualWidth(lines), [lines]);
  const wrapColumns = wrap
    ? Math.max(1, Math.floor((viewport.width - gutterW - CODE_PAD_LEFT - CODE_PAD_RIGHT) / charW))
    : null;
  const offsets = useMemo(() => lineOffsets(lines, wrapColumns), [lines, wrapColumns]);
  const total = offsets[offsets.length - 1];
  const { start, end } = visibleRange(offsets, scrollTop, viewport.height);

  // 크기·글자 폭 측정
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || FALLBACK_VIEWPORT.width;
      const h = el.clientHeight || FALLBACK_VIEWPORT.height;
      setViewport((v) => (v.width === w && v.height === h ? v : { width: w, height: h }));
      const m = measureRef.current;
      if (m && m.offsetWidth > 0) setCharW(m.offsetWidth / 10);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const offsetsRef = useRef(offsets);
  const linesRef = useRef(lines);
  useLayoutEffect(() => {
    offsetsRef.current = offsets;
    linesRef.current = lines;
  });

  useImperativeHandle(
    engineRef,
    () => ({
      scrollToLine(line: number) {
        const el = scrollRef.current;
        if (!el) return;
        const h = el.clientHeight || FALLBACK_VIEWPORT.height;
        const top = scrollTopForLine(offsetsRef.current, line, h);
        el.scrollTop = top;
        setScrollTop(top);
        // 편집이면 커서를 그 줄 처음으로
        const ta = textareaRef.current;
        if (ta && isEdit) {
          const ls = linesRef.current;
          let pos = 0;
          const upto = Math.min(Math.max(1, line), ls.length) - 1;
          for (let i = 0; i < upto; i++) pos += ls[i].length + 1;
          try {
            ta.setSelectionRange(pos, pos);
          } catch {
            /* 일부 환경에서 선택 불가 */
          }
        }
        // 줄 바꿈 추정 오차 보정: 실제 줄 요소 위치로 한 번 더 맞춘다
        if (wrap && typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            const row = el.querySelector<HTMLElement>(`[data-line="${line}"]`);
            if (row) el.scrollTop = Math.max(0, row.offsetTop - h / 3);
          });
        }
      },
      focus() {
        const target = (isEdit ? textareaRef.current : null) ?? scrollRef.current;
        target?.focus({ preventScroll: true });
      },
    }),
    [isEdit, wrap],
  );

  const handleKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const action = onKeyDown(e);
    if (!action || !editable) return;
    const ta = e.currentTarget;
    if (action === "indent") insertText(ta, indentUnit, onChange);
    else outdentLine(ta, indentUnit, onChange);
  };

  const minTextWidth = `calc(${maxCols + 2} * var(--ce-char-w) + ${CODE_PAD_LEFT + CODE_PAD_RIGHT}px)`;
  const rows = [];
  for (let i = start; i < end; i++) {
    const n = i + 1;
    const d = decorations.get(n);
    rows.push(
      <div
        key={n}
        data-line={n}
        className={cx(
          styles.ceRow,
          d?.level && styles[`ceRow-${d.level.status}`],
          d?.highlight && styles.ceRowHighlight,
          d?.target && styles.ceRowTarget,
        )}
      >
        <span className={styles.ceGutter} aria-hidden="true">
          <span className={styles.ceMark}>
            {d?.level ? (
              <Tooltip
                content={
                  <span className={styles.ceTip}>
                    {d.tooltip.map((t, k) => (
                      <span key={k}>{t}</span>
                    ))}
                  </span>
                }
                side="right"
              >
                <Icon name={d.level.icon} size={12} className={styles[`ceIcon-${d.level.status}`]} />
              </Tooltip>
            ) : null}
          </span>
          <span className={styles.ceNum}>{n}</span>
        </span>
        <span className={styles.ceText}>{isEdit ? null : lines[i]}</span>
      </div>,
    );
  }

  const cssVars = {
    ["--ce-char-w" as string]: `${charW}px`,
    ["--ce-num-w" as string]: `${numW}px`,
    ["--ce-gutter-w" as string]: `${gutterW}px`,
  };

  return (
    <div
      ref={scrollRef}
      className={cx(styles.ceScroll, wrap && styles.ceWrap)}
      style={cssVars}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      // 보기 모드: 스크롤 영역 자체가 읽기 전용 textbox (키보드 스크롤 가능)
      {...(isEdit
        ? {}
        : {
            role: "textbox",
            "aria-multiline": true,
            "aria-readonly": true,
            "aria-label": ariaLabel,
            tabIndex: 0,
            onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
              onKeyDown(e);
            },
          })}
    >
      <span ref={measureRef} className={styles.ceMeasure} aria-hidden="true">
        0000000000
      </span>
      <div
        className={styles.ceInner}
        style={{ minWidth: wrap ? "100%" : `max(100%, calc(var(--ce-gutter-w) + ${minTextWidth}))` }}
      >
        <div style={{ height: offsets[start] + CODE_PAD_Y }} aria-hidden="true" />
        {rows}
        <div style={{ height: total - offsets[end] + CODE_PAD_Y }} aria-hidden="true" />
        {isEdit ? (
          <textarea
            ref={textareaRef}
            className={styles.ceTextarea}
            style={{ height: total + CODE_PAD_Y * 2 }}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={handleKey}
            readOnly={!editable}
            aria-readonly={!editable || undefined}
            aria-label={ariaLabel}
            aria-multiline="true"
            wrap="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            data-locked={locked ? "true" : undefined}
          />
        ) : null}
      </div>
    </div>
  );
}

/** 커서 위치에 문자열 넣기. execCommand 가 되면 되돌리기 기록이 유지된다 */
function insertText(ta: HTMLTextAreaElement, text: string, onChange?: (v: string) => void) {
  const ok = typeof document !== "undefined" && typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    onChange?.(ta.value);
  }
}

/** 현재 줄 앞의 들여쓰기 한 단위(또는 그보다 적은 공백) 지우기 */
function outdentLine(ta: HTMLTextAreaElement, unit: string, onChange?: (v: string) => void) {
  const v = ta.value;
  const caret = ta.selectionStart;
  const lineStart = v.lastIndexOf("\n", caret - 1) + 1;
  let k = 0;
  if (unit.length > 0 && v.startsWith(unit, lineStart)) k = unit.length;
  else while (k < unit.length && (v[lineStart + k] === " " || v[lineStart + k] === "\t")) k++;
  if (k === 0) return;
  ta.setRangeText("", lineStart, lineStart + k, "preserve");
  const nextCaret = Math.max(lineStart, caret - k);
  ta.setSelectionRange(nextCaret, nextCaret);
  onChange?.(ta.value);
}
