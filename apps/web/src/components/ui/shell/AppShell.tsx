"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cx } from "../cx";

export interface AppShellProps {
  /** `<TopBar />` */
  topBar: ReactNode;
  /** `<SideNav />` */
  nav: ReactNode;
  /** `<ConnectionBanner />` — 없으면 영역 없음 (5초 지연은 호출 측) */
  banner?: ReactNode;
  children: ReactNode;
  /** 1280px 미만에서 내비 드로어가 열렸는지 (TopBar 메뉴 버튼으로 토글) */
  navOpen?: boolean;
  /** 드로어 닫기 (scrim 클릭, Esc) */
  onNavClose?: () => void;
  /** 본문 id (건너뛰기 링크 대상), 기본 `main` */
  mainId?: string;
  className?: string;
}

/**
 * components.md 1.1 / shell.md 1절. 전역 클래스(app-shell, app-header, app-banner, app-body, app-nav, app-main)는
 * styles/globals.css 에 있다. 가로 스크롤이 생기지 않도록 본문은 min-width: 0.
 */
export function AppShell({
  topBar,
  nav,
  banner,
  children,
  navOpen = false,
  onNavClose,
  mainId = "main",
  className,
}: AppShellProps) {
  const onCloseRef = useRef(onNavClose);
  useEffect(() => {
    onCloseRef.current = onNavClose;
  });

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className={cx("app-shell", className)} data-nav-open={navOpen ? "true" : undefined}>
      <a className="app-skip-link" href={`#${mainId}`}>
        본문으로 건너뛰기
      </a>
      {topBar}
      {banner ? <div className="app-banner">{banner}</div> : null}
      <div className="app-body">
        {nav}
        {navOpen ? (
          <button type="button" className="app-nav-scrim" aria-label="메뉴 닫기" tabIndex={-1} onClick={onNavClose} />
        ) : null}
        <main id={mainId} className="app-main" tabIndex={-1}>
          <div className="app-main-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
