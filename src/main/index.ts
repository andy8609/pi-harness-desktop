import { existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, shell } from "electron";
import { AgentHost } from "./agent-host";
import { setCatalogListener } from "./catalog";
import { DialogBroker } from "./dialog-broker";
import { createEventPump } from "./event-pump";
import { registerIpc } from "./ipc";
import { loadPrefs, savePrefs } from "./prefs";

const dialogs = new DialogBroker();
let pump: ReturnType<typeof createEventPump> | undefined;
const host = new AgentHost(dialogs, (event) => {
  pump?.emit(event);
});
pump = createEventPump(host);

function bindWindowPause(window: BrowserWindow): void {
  const update = () => {
    const paused = BrowserWindow.getAllWindows().every((item) => item.isDestroyed() || item.isMinimized());
    pump?.setPaused(paused);
  };
  window.on("minimize", update);
  window.on("restore", update);
  window.on("show", update);
}

function createWindow(): BrowserWindow {
  const prefs = loadPrefs();
  const window = new BrowserWindow({
    width: prefs.windowBounds?.width ?? 1440,
    height: prefs.windowBounds?.height ?? 920,
    x: prefs.windowBounds?.x,
    y: prefs.windowBounds?.y,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#12140f",
    title: "Pi Desktop",
    webPreferences: {
      preload: existsSync(join(__dirname, "../preload/index.mjs"))
        ? join(__dirname, "../preload/index.mjs")
        : join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.on("ready-to-show", () => {
    window.show();
  });
  window.on("close", () => {
    const bounds = window.getBounds();
    savePrefs({ windowBounds: bounds });
  });
  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  window.webContents.once("did-finish-load", () => {
    const lastCwd = loadPrefs().lastCwd;
    if (!lastCwd) return;
    void host
      .openProject(lastCwd)
      .then((snapshot) => {
        window.webContents.send("session:event", { type: "snapshot", snapshot });
      })
      .catch((error) => {
        console.warn("Failed to restore last project", error);
      });
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}

app.whenReady().then(async () => {
  registerIpc(host, dialogs);
  await host.initialize();
  setCatalogListener((packages) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("catalog:updated", packages);
    }
  });
  const window = createWindow();
  bindWindowPause(window);
  dialogs.setWindow(window);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const next = createWindow();
      bindWindowPause(next);
      dialogs.setWindow(next);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  savePrefs({ lastCwd: host.getCwd() });
  void host.dispose();
});
