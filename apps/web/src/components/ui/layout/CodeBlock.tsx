import { CopyButton } from "../controls/CopyButton";
import { cx } from "../cx";
import styles from "./layout.module.css";

export interface CodeBlockProps {
  /** 텍스트로만 렌더한다(HTML 해석·문법 강조 없음) */
  code: string;
  /** 머리글 왼쪽 라벨 (`bash`, `yaml`), 없으면 `코드` */
  language?: string;
  /** px, 기본 320. 넘치면 세로 스크롤 */
  maxHeight?: number;
  /** 기본 false(가로 스크롤) */
  wrap?: boolean;
  className?: string;
}

/**
 * components.md 8.7. LLM·서버가 준 코드를 React 텍스트 노드로만 넣는다
 * (dangerouslySetInnerHTML·마크다운 파싱·자동 링크 없음).
 */
export function CodeBlock({ code, language, maxHeight = 320, wrap = false, className }: CodeBlockProps) {
  const lang = language?.trim() || "코드";
  return (
    <figure className={cx(styles.code, className)}>
      <figcaption className={styles.codeHead}>
        <span className={styles.codeLang}>{lang}</span>
        <CopyButton text={code} size="sm" label="복사" />
      </figcaption>
      <pre
        className={cx(styles.codeBody, wrap && styles.codeWrap)}
        style={{ maxHeight: `${maxHeight}px` }}
        tabIndex={0}
        aria-label={`${lang} 코드`}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}
