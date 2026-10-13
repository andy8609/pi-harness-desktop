import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
function prefsPath() {
    return join(app.getPath("userData"), "desktop-prefs.json");
}
export function loadPrefs() {
    try {
        const raw = readFileSync(prefsPath(), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
export function savePrefs(patch) {
    const next = { ...loadPrefs(), ...patch };
    const file = prefsPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
}
export function prefsExist() {
    return existsSync(prefsPath());
}
