import type { ThemeMode } from "@shared/types";

export const THEME_STORAGE_KEY = "pi-desktop:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function loadThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // ignore storage failures
  }
  return "system";
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  }
  return mode;
}

/** 把主题写到 <html data-theme>，并同步主进程（窗口背景、原生控件）。 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(mode);
  root.dataset.themeMode = mode;
  const api = window.pi;
  if (api?.setTheme) {
    void api.setTheme(mode).catch(() => undefined);
  }
}

/** 启动时尽早调用，避免浅色系统下先闪深色界面。 */
export function initTheme(): ThemeMode {
  const mode = loadThemeMode();
  applyTheme(mode);
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (loadThemeMode() === "system") applyTheme("system");
  });
  return mode;
}
