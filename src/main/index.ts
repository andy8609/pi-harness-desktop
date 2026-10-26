import { existsSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, nativeTheme, shell } from "electron";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AgentHost } from "./agent-host";
import { setCatalogListener } from "./catalog";
import { DialogBroker } from "./dialog-broker";
import { createEventPump } from "./event-pump";
import { registerIpc } from "./ipc";
import { runMcpSelfTest } from "./mcp/selftest";
import { McpService } from "./mcp/service";
import { loadPrefs, savePrefs } from "./prefs";

const dialogs = new DialogBroker();
let pump: ReturnType<typeof createEventPump> | undefined;
let mcpService: McpService | undefined;
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
  nativeTheme.themeSource = prefs.theme ?? "system";
  const window = new BrowserWindow({
    width: prefs.windowBounds?.width ?? 1440,
    height: prefs.windowBounds?.height ?? 920,
    x: prefs.windowBounds?.x,
    y: prefs.windowBounds?.y,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#12140f" : "#f6f4ec",
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
  // 默认与 pi CLI 的其它配置放在一起：~/.pi/agent/mcp-servers.json
  const mcpConfigPath =
    process.env.PI_MCP_CONFIG_PATH?.trim() || join(getAgentDir(), "mcp-servers.json");
  mcpService = new McpService({
    filePath: mcpConfigPath,
    // 授权确认（降级方案）：stdio 服务器首次启用/命令变化时，必须让用户看到将要执行的完整命令。
    confirmStdio: (record, context) => {
      if (context.previouslyApproved) return Promise.resolve(true);
      const commandLine = [record.command, ...(record.args ?? [])].filter(Boolean).join(" ");
      return dialogs.confirm(
        "确认执行本机命令",
        `MCP 服务器「${record.label}」将在本机启动：\n${commandLine}`,
      );
    },
    broadcast: (snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send("mcp:changed", snapshot);
      }
    },
  });
  host.setMcp(mcpService.runtime, mcpService.bridge);
  registerIpc(host, dialogs, mcpService);

  // 端到端自检：仅由 scripts/e2e-mcp-electron.mjs 通过环境变量触发。
  const selfTestOutput = process.env.PI_MCP_SELFTEST?.trim();
  if (selfTestOutput) {
    await runMcpSelfTest(mcpService, selfTestOutput);
    app.quit();
    return;
  }

  await host.initialize();
  // 启动即连接全局激活的 MCP 服务器；项目级服务器在 openProject 时连接。
  mcpService.initialize(null);
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
  mcpService?.dispose();
  void host.dispose();
});
