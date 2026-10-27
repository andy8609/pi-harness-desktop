import { contextBridge, ipcRenderer } from "electron";
import type {
  CatalogPackage,
  DesktopSettings,
  DialogRequest,
  DialogResponse,
  InstalledResource,
  ModelDevQuery,
  ModelsFile,
  PromptPayload,
  QueueMutation,
  CreateResourceFileInput,
  ResourceFile,
  StreamEvent,
  ThemeMode,
  ThinkingLevel,
} from "@shared/types";
import type {
  McpScope,
  McpServerInput,
  McpSnapshot,
} from "@shared/mcp";
import type { McpCatalogEntry, McpMarketSearchResult } from "@shared/mcp-catalog";

const api = {
  getState: () => ipcRenderer.invoke("app:getState"),
  openDirectory: () => ipcRenderer.invoke("app:openDirectory"),
  openProject: (cwd: string) => ipcRenderer.invoke("app:openProject", cwd),
  prompt: (payload: PromptPayload) => ipcRenderer.invoke("app:prompt", payload),
  editUserMessage: (entryId: string, payload: PromptPayload) =>
    ipcRenderer.invoke("app:editUserMessage", entryId, payload),
  abort: () => ipcRenderer.invoke("app:abort"),
  steer: (text: string) => ipcRenderer.invoke("app:steer", text),
  followUp: (text: string) => ipcRenderer.invoke("app:followUp", text),
  mutateQueue: (action: QueueMutation) => ipcRenderer.invoke("app:mutateQueue", action),
  newSession: () => ipcRenderer.invoke("app:newSession"),
  switchSession: (path: string) => ipcRenderer.invoke("app:switchSession", path),
  listSessions: () => ipcRenderer.invoke("app:listSessions"),
  deleteSession: (path: string) => ipcRenderer.invoke("app:deleteSession", path),
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  setTheme: (theme: ThemeMode) => ipcRenderer.invoke("app:setTheme", theme),
  nameSession: (name: string) => ipcRenderer.invoke("app:nameSession", name),
  fork: (entryId: string) => ipcRenderer.invoke("app:fork", entryId),
  clone: () => ipcRenderer.invoke("app:clone"),
  navigateTree: (targetId: string, summarize?: boolean) =>
    ipcRenderer.invoke("app:navigateTree", targetId, summarize),
  getTree: (path?: string) => ipcRenderer.invoke("app:getTree", path),
  compact: (instructions?: string) => ipcRenderer.invoke("app:compact", instructions),
  reload: () => ipcRenderer.invoke("app:reload"),
  listModels: () => ipcRenderer.invoke("app:listModels"),
  setModel: (provider: string, id: string) => ipcRenderer.invoke("app:setModel", provider, id),
  setThinkingLevel: (level: ThinkingLevel) => ipcRenderer.invoke("app:setThinkingLevel", level),
  getGpaState: () => ipcRenderer.invoke("app:getGpaState"),
  setGpaEnabled: (enabled: boolean) => ipcRenderer.invoke("app:setGpaEnabled", enabled),
  confirmGpa: () => ipcRenderer.invoke("app:confirmGpa"),
  resumeGpaPlan: () => ipcRenderer.invoke("app:resumeGpaPlan"),
  abandonGpaPlan: () => ipcRenderer.invoke("app:abandonGpaPlan"),
  peekGpaPlan: () => ipcRenderer.invoke("app:peekGpaPlan"),
  resetGpa: () => ipcRenderer.invoke("app:resetGpa"),
  listPermissionRules: () => ipcRenderer.invoke("app:listPermissionRules"),
  forgetPermissionRule: (key: string) => ipcRenderer.invoke("app:forgetPermissionRule", key),
  clearPermissionRules: () => ipcRenderer.invoke("app:clearPermissionRules"),
  getModelsFile: () => ipcRenderer.invoke("app:getModelsFile"),
  saveModelsFile: (file: ModelsFile) => ipcRenderer.invoke("app:saveModelsFile", file),
  refreshModels: () => ipcRenderer.invoke("app:refreshModels"),
  login: (providerId: string, type: "api_key" | "oauth") => ipcRenderer.invoke("app:login", providerId, type),
  logout: (providerId: string) => ipcRenderer.invoke("app:logout", providerId),
  setApiKey: (providerId: string, apiKey: string) => ipcRenderer.invoke("app:setApiKey", providerId, apiKey),
  getSettings: () => ipcRenderer.invoke("app:getSettings"),
  updateSettings: (patch: DesktopSettings) => ipcRenderer.invoke("app:updateSettings", patch),
  setFullTrust: (enabled: boolean) => ipcRenderer.invoke("app:setFullTrust", enabled),
  trustProject: (trusted: boolean, includeParent?: boolean) =>
    ipcRenderer.invoke("app:trustProject", trusted, includeParent),
  exportHtml: () => ipcRenderer.invoke("app:exportHtml"),
  exportJsonl: () => ipcRenderer.invoke("app:exportJsonl"),
  importJsonl: () => ipcRenderer.invoke("app:importJsonl"),
  searchFiles: (query: string) => ipcRenderer.invoke("app:searchFiles", query),
  listDirectory: (relPath?: string) => ipcRenderer.invoke("fs:listDir", relPath),
  readFile: (relPath: string) => ipcRenderer.invoke("fs:readFile", relPath),
  getCommands: () => ipcRenderer.invoke("app:getCommands"),
  getResourceFiles: () => ipcRenderer.invoke("app:getResourceFiles"),
  saveResourceFile: (kind: ResourceFile["kind"], path: string, content: string, description?: string) =>
    ipcRenderer.invoke("app:saveResourceFile", kind, path, content, description),
  createResourceFile: (input: CreateResourceFileInput) => ipcRenderer.invoke("app:createResourceFile", input),
  getSessionInfo: () => ipcRenderer.invoke("app:getSessionInfo"),
  listCatalog: () => ipcRenderer.invoke("app:listCatalog"),
  refreshCatalog: () => ipcRenderer.invoke("app:refreshCatalog"),
  listRemoteModels: (baseUrl: string, apiKey?: string) =>
    ipcRenderer.invoke("app:listRemoteModels", baseUrl, apiKey),
  modelsDevDefaults: (query: ModelDevQuery) => ipcRenderer.invoke("app:modelsDevDefaults", query),
  listPackages: () => ipcRenderer.invoke("app:listPackages"),
  installPackage: (name: string) => ipcRenderer.invoke("app:installPackage", name),
  removePackage: (source: string) => ipcRenderer.invoke("app:removePackage", source),
  toggleResource: (item: InstalledResource, enabled: boolean) =>
    ipcRenderer.invoke("app:toggleResource", item, enabled),
  importSkillFile: () => ipcRenderer.invoke("app:importSkillFile"),
  importSkillDir: () => ipcRenderer.invoke("app:importSkillDir"),
  quit: () => ipcRenderer.invoke("app:quit"),
  // ---- MCP ----
  mcpList: () => ipcRenderer.invoke("mcp:list"),
  mcpUpsert: (input: McpServerInput) => ipcRenderer.invoke("mcp:upsert", input),
  mcpRemove: (id: string) => ipcRenderer.invoke("mcp:remove", { id }),
  mcpSetEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("mcp:setEnabled", { id, enabled }),
  mcpSetScope: (id: string, scope: McpScope) => ipcRenderer.invoke("mcp:setScope", { id, scope }),
  mcpTest: (id: string) => ipcRenderer.invoke("mcp:test", { id }),
  mcpReconnect: (id: string) => ipcRenderer.invoke("mcp:reconnect", { id }),
  mcpDisconnect: (id: string) => ipcRenderer.invoke("mcp:disconnect", { id }),
  mcpListTools: (id: string) => ipcRenderer.invoke("mcp:listTools", { id }),
  mcpSetToolEnabled: (id: string, toolName: string, enabled: boolean) =>
    ipcRenderer.invoke("mcp:setToolEnabled", { id, toolName, enabled }),
  mcpRefresh: () => ipcRenderer.invoke("mcp:refresh"),
  mcpMarketSearch: (query?: string, cursor?: string, more?: boolean) =>
    ipcRenderer.invoke("mcp:marketSearch", { query, cursor, more }),
  mcpMarketInstall: (entry: McpCatalogEntry, values: Record<string, string> = {}) =>
    ipcRenderer.invoke("mcp:marketInstall", { entry, values }),
  respondDialog: (response: DialogResponse) => {
    ipcRenderer.send("dialog:respond", response);
  },
  onEvent: (listener: (event: StreamEvent) => void) => {
    const handler = (_event: unknown, payload: StreamEvent) => listener(payload);
    ipcRenderer.on("session:event", handler);
    return () => ipcRenderer.removeListener("session:event", handler);
  },
  onDialog: (listener: (request: DialogRequest) => void) => {
    const handler = (_event: unknown, payload: DialogRequest) => listener(payload);
    ipcRenderer.on("dialog:request", handler);
    return () => ipcRenderer.removeListener("dialog:request", handler);
  },
  onCatalog: (listener: (packages: CatalogPackage[]) => void) => {
    const handler = (_event: unknown, payload: CatalogPackage[]) => listener(payload);
    ipcRenderer.on("catalog:updated", handler);
    return () => ipcRenderer.removeListener("catalog:updated", handler);
  },
  onMcpChanged: (listener: (snapshot: McpSnapshot) => void) => {
    const handler = (_event: unknown, payload: McpSnapshot) => listener(payload);
    ipcRenderer.on("mcp:changed", handler);
    return () => ipcRenderer.removeListener("mcp:changed", handler);
  },
};

contextBridge.exposeInMainWorld("pi", api);

export type PiApi = typeof api;
