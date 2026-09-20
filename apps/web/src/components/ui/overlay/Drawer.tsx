"use client";

import { useId, type ReactNode } from "react";

import { IconButton } from "../controls/IconButton";
import { cx } from "../cx";
import { ModalBase } from "./ModalBase";
import styles from "./overlay.module.css";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  /** md 480 / lg 640px (화면이 좁으면 화면 폭) */
  size?: "md" | "lg";
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** components.md 5.3. 오른쪽에서 열리는 모달 패널. Esc·배경 클릭·닫기 버튼으로 닫힌다. */
export function Drawer({ open, onClose, title, subtitle, size = "md", footer, children, className }: DrawerProps) {
  const titleId = useId();
  return (
    <ModalBase
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      className={cx(styles.drawer, styles[`drawer-${size}`], className)}
    >
      <div className={styles.drawerInner}>
        <header className={styles.drawerHeader}>
          <div className={styles.drawerHeading}>
            <h2 id={titleId} className={styles.drawerTitle}>
              {title}
            </h2>
            {subtitle ? <p className={styles.drawerSubtitle}>{subtitle}</p> : null}
          </div>
          <IconButton icon="x" label="닫기" size="md" onClick={onClose} showTooltip={false} />
        </header>
        <div className={styles.drawerBody}>{children}</div>
        {footer ? <footer className={styles.drawerFooter}>{footer}</footer> : null}
      </div>
    </ModalBase>
  );
}
