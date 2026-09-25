"use client";

import { useId, useState, type ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import styles from "./feedback.module.css";

export type NoticeTone = "neutral" | "info" | "warn";

export interface CollapsibleNoticeProps {
  /** `Banner`(6.1)와 같은 색 규칙. neutral 은 왼쪽 3px `border.strong` */
  tone?: NoticeTone;
  /** 16px, **한 번만** 그린다(접힘·펼침 모두 같은 자리) */
  icon?: IconName;
  /** 접었을 때 남는 한 줄 (`직접 조회 · 지난 로그·검색 없음`) */
  summary: string;
  /** 펼쳤을 때 줄 목록. 줄 사이 4px */
  lines: ReactNode[];
  /** 기본 펼침 */
  defaultOpen?: boolean;
  /** 제어형으로 쓸 때 (둘 다 넘긴다) */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  /** 접기 버튼 접근 이름 앞에 붙는 이름 (기본 `안내`) */
  label?: string;
  className?: string;
}

/**
 * components.md 20.4. 여러 줄 안내 중 **접어도 한 줄 요약이 남아야 하는 것** 전용.
 * 첫 사용처는 로그의 한계 4줄(`logs.md` 4절).
 *
 * - **닫기(`x`)가 없다. 접기만 있다.** 접힘 상태에서도 `summary`와 아이콘은 남는다.
 * - **접힘 상태를 저장하지 않는다**(`persistKey` 없음, status.md 13.6). 다음에 열면 다시 펼쳐진다 —
 *   이 한계를 모른 채 "없다"를 "문제 없다"로 읽는 것이 가장 비싼 오해라서 잊어버릴 권리를 기본값으로 두지 않는다.
 * - **닫을 수 없어야 하는 한 줄 경고**(로그의 가림 경고 `logs.md` 6.1, 설정의 리소스 이름 안내 `settings.md` 3.5)는
 *   이 컴포넌트를 쓰지 않는다. 그것은 접는 장치가 없는 `InlineAlert`(`RedactionNotice`)가 맡는다 —
 *   여기에 넣으면 상시 표시가 접기 가능해진다.
 */
export function CollapsibleNotice({
  tone = "neutral",
  icon,
  summary,
  lines,
  defaultOpen = true,
  open,
  onToggle,
  label = "안내",
  className,
}: CollapsibleNoticeProps) {
  const id = useId();
  const [selfOpen, setSelfOpen] = useState(defaultOpen);
  const isOpen = open ?? selfOpen;
  const toggle = () => {
    if (open === undefined) setSelfOpen((v) => !v);
    onToggle?.(!isOpen);
  };
  return (
    <div className={cx(styles.notice, styles[`noticeTone-${tone}`], className)}>
      <div className={styles.noticeHead}>
        {icon ? <Icon name={icon} size={16} className={styles.noticeIcon} /> : null}
        <span className={styles.noticeSummary}>{summary}</span>
        <IconButton
          icon={isOpen ? "chevron-up" : "chevron-down"}
          label={isOpen ? `${label} 접기` : `${label} 펼치기`}
          size="sm"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={id}
          className={styles.noticeToggle}
        />
      </div>
      {isOpen ? (
        <ul id={id} className={styles.noticeLines}>
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
