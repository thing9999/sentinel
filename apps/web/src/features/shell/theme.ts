/**
 * 테마 (shell.md 2절): localStorage `sentinel.theme` = light | dark | system.
 * system 이면 <html data-theme> 를 지워 prefers-color-scheme 를 따른다.
 */
import type { ThemeChoice } from "@/components/ui";

export const THEME_KEY = "sentinel.theme";
export const NAV_COLLAPSED_KEY = "sentinel.nav.collapsed";

/**
 * 첫 페인트 전에 실행하는 인라인 스크립트(layout <head>). 고정 문자열이며 서버 데이터를 넣지 않는다.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}else{document.documentElement.removeAttribute("data-theme");}}catch(e){}})();`;

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const el = document.documentElement;
  if (choice === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", choice);
}

export const themeStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: (): ThemeChoice => (typeof window === "undefined" ? "system" : read()),
  getServer: (): ThemeChoice => "system",
  set(choice: ThemeChoice) {
    try {
      if (choice === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, choice);
    } catch {
      /* 저장 불가(프라이빗 모드 등) — 화면에는 반영 */
    }
    applyTheme(choice);
    for (const l of listeners) l();
  },
};

/** 내비 접힘 (shell.md 1.1): 1280~1439px 기본 접힘, 1440px 이상은 저장값 */
const navListeners = new Set<Listener>();

function readNavStored(): boolean | null {
  try {
    const v = localStorage.getItem(NAV_COLLAPSED_KEY);
    return v === "true" ? true : v === "false" ? false : null;
  } catch {
    return null;
  }
}

export function defaultCollapsed(width: number, stored: boolean | null): boolean {
  if (width >= 1440) return stored ?? false;
  if (width >= 1280) return stored ?? true;
  return false; // 1280 미만은 드로어(항상 펼친 모습)
}

export const navStore = {
  subscribe(l: Listener) {
    navListeners.add(l);
    const onResize = () => l();
    window.addEventListener("resize", onResize);
    return () => {
      navListeners.delete(l);
      window.removeEventListener("resize", onResize);
    };
  },
  get: (): boolean => defaultCollapsed(window.innerWidth, readNavStored()),
  getServer: (): boolean => false,
  set(collapsed: boolean) {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, String(collapsed));
    } catch {
      /* 무시 */
    }
    for (const l of navListeners) l();
  },
};
