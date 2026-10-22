import { BrowserWindow, app, dialog, ipcMain } from "electron";
import type { CreateResourceFileInput, DesktopSettings, DialogResponse, InstalledResource, ModelsFile, PromptPayload, QueueMutation, ResourceFile, ThinkingLevel } from "@shared/types";
import type { AgentHost } from "./agent-host";
import type { DialogBroker } from "./dialog-broker";
import { listDirectory, readFileText } from "./fs-panel";
import { savePrefs } from "./prefs";
import { listRemoteModels } from "./remote-models";

function wrap<T>(fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((error: unknown) => {
      throw new Error(error instanceof Error ? error.message : String(error));
    });
}

export function registerIpc(host: AgentHost, dialogs: DialogBroker): void {
  ipcMain.handle("app:getState", () => wrap(() => host.snapshot() ?? null));
  ipcMain.handle("app:openDirectory", () =>
    wrap(async () => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(window ?? BrowserWindow.getAllWindows()[0], {
        properties: ["openDirectory"],
        defaultPath: host.getCwd(),
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const snapshot = await host.openProject(result.filePaths[0]);
      savePrefs({ lastCwd: result.filePaths[0] });
      return snapshot;
    }),
  );
  ipcMain.handle("app:openProject", (_event, cwd: string) =>
    wrap(async () => {
      const snapshot = await host.openProject(cwd);
      savePrefs({ lastCwd: cwd });
      return snapshot;
    }),
  );
  ipcMain.handle("app:prompt", (_event, payload: PromptPayload) => wrap(() => host.prompt(payload)));
  ipcMain.handle("app:editUserMessage", (_event, entryId: string, payload: PromptPayload) =>
    wrap(() => host.editAndResend(entryId, payload)),
  );
  ipcMain.handle("app:abort", () => wrap(() => host.abort()));
  ipcMain.handle("app:steer", (_event, text: string) => wrap(() => host.steer(text)));
  ipcMain.handle("app:followUp", (_event, text: string) => wrap(() => host.followUp(text)));
  ipcMain.handle("app:mutateQueue", (_event, action: QueueMutation) => wrap(() => host.mutateQueue(action)));
  ipcMain.handle("app:newSession", () => wrap(() => host.newSession()));
  ipcMain.handle("app:switchSession", (_event, path: string) => wrap(() => host.switchSession(path)));
  ipcMain.handle("app:listSessions", () => wrap(() => host.listSessions()));
  ipcMain.handle("app:nameSession", (_event, name: string) => wrap(() => host.nameSession(name)));
  ipcMain.handle("app:fork", (_event, entryId: string) => wrap(() => host.fork(entryId)));
  ipcMain.handle("app:clone", () => wrap(() => host.clone()));
  ipcMain.handle("app:navigateTree", (_event, targetId: string, summarize?: boolean) =>
    wrap(() => host.navigateTree(targetId, summarize)),
  );
  ipcMain.handle("app:getTree", (_event, path?: string) => wrap(() => host.getTree(path)));
  ipcMain.handle("app:compact", (_event, instructions?: string) => wrap(() => host.compact(instructions)));
  ipcMain.handle("app:reload", () => wrap(() => host.reload()));
  ipcMain.handle("app:listModels", () => wrap(() => host.listModels()));
  ipcMain.handle("app:setModel", (_event, provider: string, id: string) => wrap(() => host.setModel(provider, id)));
  ipcMain.handle("app:setThinkingLevel", (_event, level: ThinkingLevel) => wrap(() => host.setThinkingLevel(level)));
  ipcMain.handle("app:getGpaState", () => wrap(() => host.getGpaState()));
  ipcMain.handle("app:setGpaEnabled", (_event, enabled: boolean) => wrap(() => host.setGpaEnabled(enabled)));
  ipcMain.handle("app:confirmGpa", () => wrap(() => host.confirmGpa()));
  ipcMain.handle("app:resumeGpaPlan", () => wrap(() => host.resumeGpaPlan()));
  ipcMain.handle("app:abandonGpaPlan", () => wrap(() => host.abandonGpaPlan()));
  ipcMain.handle("app:peekGpaPlan", () => wrap(() => host.peekGpaPlan()));
  ipcMain.handle("app:resetGpa", () => wrap(() => host.resetGpa()));
  ipcMain.handle("app:listPermissionRules", () => wrap(() => host.listPermissionRules()));
  ipcMain.handle("app:forgetPermissionRule", (_event, key: string) => wrap(() => host.forgetPermissionRule(key)));
  ipcMain.handle("app:clearPermissionRules", () => wrap(() => host.clearPermissionRules()));
  ipcMain.handle("app:getModelsFile", () => wrap(() => host.getModelsFile()));
  ipcMain.handle("app:saveModelsFile", (_event, file: ModelsFile) => wrap(() => host.saveModelsFile(file)));
  ipcMain.handle("app:refreshModels", () => wrap(() => host.refreshModels()));
  ipcMain.handle("app:login", (_event, providerId: string, type: "api_key" | "oauth") =>
    wrap(() => host.login(providerId, type)),
  );
  ipcMain.handle("app:logout", (_event, providerId: string) => wrap(() => host.logout(providerId)));
  ipcMain.handle("app:setApiKey", (_event, providerId: string, apiKey: string) =>
    wrap(() => host.setApiKey(providerId, apiKey)),
  );
  ipcMain.handle("app:getSettings", () => wrap(() => host.getSettings()));
  ipcMain.handle("app:updateSettings", (_event, patch: DesktopSettings) => wrap(() => host.updateSettings(patch)));
  ipcMain.handle("app:setFullTrust", (_event, enabled: boolean) => wrap(() => host.setFullTrust(enabled)));
  ipcMain.handle("app:trustProject", (_event, trusted: boolean, includeParent?: boolean) =>
    wrap(() => host.trustProject(trusted, includeParent)),
  );
  ipcMain.handle("app:exportHtml", () =>
    wrap(async () => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(window ?? undefined, {
        defaultPath: "session.html",
        filters: [{ name: "HTML", extensions: ["html"] }],
      });
      if (result.canceled || !result.filePath) return null;
      return host.exportHtml(result.filePath);
    }),
  );
  ipcMain.handle("app:exportJsonl", () =>
    wrap(async () => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(window ?? undefined, {
        defaultPath: "session.jsonl",
        filters: [{ name: "JSONL", extensions: ["jsonl"] }],
      });
      if (result.canceled || !result.filePath) return null;
      return host.exportJsonl(result.filePath);
    }),
  );
  ipcMain.handle("app:importJsonl", () =>
    wrap(async () => {
      const window = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(window ?? undefined, {
        properties: ["openFile"],
        filters: [{ name: "JSONL", extensions: ["jsonl"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return host.importJsonl(result.filePaths[0]);
    }),
  );
  ipcMain.handle("app:searchFiles", (_event, query: string) => wrap(() => host.searchFiles(query)));
  ipcMain.handle("fs:listDir", (_event, relPath?: string) => wrap(() => listDirectory(host.getCwd(), relPath ?? "")));
  ipcMain.handle("fs:readFile", (_event, relPath: string) => wrap(() => readFileText(host.getCwd(), relPath)));
  ipcMain.handle("app:getCommands", () => wrap(() => host.getCommands()));
  ipcMain.handle("app:getResourceFiles", () => wrap(() => host.getResourceFiles()));
  ipcMain.handle(
    "app:saveResourceFile",
    (_event, kind: ResourceFile["kind"], path: string, content: string, description?: string) =>
      wrap(() => host.saveResourceFile(kind, path, content, description)),
  );
  ipcMain.handle("app:createResourceFile", (_event, input: CreateResourceFileInput) =>
    wrap(() => host.createResourceFile(input)),
  );
  ipcMain.handle("app:getSessionInfo", () => wrap(() => host.getSessionInfo()));
  ipcMain.handle("app:listCatalog", () => wrap(() => host.listCatalog()));
  ipcMain.handle("app:refreshCatalog", () => wrap(() => host.refreshCatalog()));
  ipcMain.handle("app:listRemoteModels", (_event, baseUrl: string, apiKey?: string) =>
    wrap(() => listRemoteModels(baseUrl, apiKey)),
  );
  ipcMain.handle("app:listPackages", () => wrap(() => host.listPackages()));
  ipcMain.handle("app:installPackage", (_event, name: string) => wrap(() => host.installPackage(name)));
  ipcMain.handle("app:removePackage", (_event, source: string) => wrap(() => host.removePackage(source)));
  ipcMain.handle("app:toggleResource", (_event, item: InstalledResource, enabled: boolean) =>
    wrap(() => host.toggleInstalledResource(item, enabled)),
  );
  ipcMain.handle("app:importSkillFile", () =>
    wrap(async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        filters: [{ name: "Skill Markdown", extensions: ["md"] }],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return host.importSkill(result.filePaths[0]);
    }),
  );
  ipcMain.handle("app:importSkillDir", () =>
    wrap(async () => {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return host.importSkill(result.filePaths[0]);
    }),
  );
  ipcMain.handle("app:quit", () => {
    app.quit();
  });
  ipcMain.on("dialog:respond", (_event, response: DialogResponse) => {
    dialogs.respond(response);
  });
}
