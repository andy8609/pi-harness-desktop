import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { ThemeMode } from "../shared/types";

export interface DesktopPrefs {
  lastCwd?: string;
  windowBounds?: { x?: number; y?: number; width: number; height: number };
  /** 桌面界面皮肤，用于首帧窗口背景与原生控件主题。 */
  theme?: ThemeMode;
}

function prefsPath(): string {
  return join(app.getPath("userData"), "desktop-prefs.json");
}

export function loadPrefs(): DesktopPrefs {
  try {
    const raw = readFileSync(prefsPath(), "utf8");
    return JSON.parse(raw) as DesktopPrefs;
  } catch {
    return {};
  }
}

export function savePrefs(patch: Partial<DesktopPrefs>): DesktopPrefs {
  const next = { ...loadPrefs(), ...patch };
  const file = prefsPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function prefsExist(): boolean {
  return existsSync(prefsPath());
}
