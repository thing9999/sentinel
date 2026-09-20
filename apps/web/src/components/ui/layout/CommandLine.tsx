import { CopyButton } from "../controls/CopyButton";
import { cx } from "../cx";
import styles from "./layout.module.css";

export interface CommandLineProps {
  /** 명령 문자열. 텍스트로만 렌더한다(실행 수단 없음) */
  command: string;
  /** 복사 버튼 스크린리더 이름, 기본 `명령 복사` */
  copyLabel?: string;
  /** true 면 부모 폭을 채운다(기본: 내용 폭, 넘치면 명령만 가로 스크롤) */
  fullWidth?: boolean;
  className?: string;
}

/**
 * 명령 안내 줄: 높이 32px, code.bg, mono 13 + 복사 버튼.
 * 원래 advisor/BridgeStatusBar 에 있던 것을 공용으로 옮겼다(aws-snapshot-manager CommandSteps·재스캔 안내에서도 쓴다).
 * 기존 import 경로(`advisor/BridgeStatusBar`)는 re-export 로 유지한다.
 */
export function CommandLine({ command, copyLabel = "명령 복사", fullWidth = false, className }: CommandLineProps) {
  return (
    <div className={cx(styles.cmd, fullWidth && styles.cmdFull, className)}>
      <code className={styles.cmdCode} tabIndex={0}>
        {command}
      </code>
      <CopyButton text={command} size="sm" showLabel={false} label={copyLabel} />
    </div>
  );
}
