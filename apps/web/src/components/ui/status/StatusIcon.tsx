import { cx } from "../cx";
import { Icon, STATUS_ICON, type IconSize } from "../icons";
import type { Status } from "../types";
import styles from "./status.module.css";

export interface StatusIconProps {
  status: Status;
  size?: IconSize;
  /** 스크린리더 문구. 없으면 장식(옆에 문구가 있을 때) */
  title?: string;
  className?: string;
}

/** components.md 2.2. 상태마다 모양이 다른 아이콘(원/삼각형/팔각형/물음표 원/시계) + status.<key>.fg */
export function StatusIcon({ status, size = 16, title, className }: StatusIconProps) {
  return (
    <Icon
      name={STATUS_ICON[status]}
      size={size}
      title={title}
      className={cx(styles.statusIcon, styles[`fg-${status}`], className)}
    />
  );
}
