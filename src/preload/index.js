import { contextBridge, ipcRenderer } from "electron";
const api = {
    getState: () => ipcRenderer.invoke("app:getState"),
    openDirectory: () => ipcRenderer.invoke("app:openDirectory"),
    openProject: (cwd) => ipcRenderer.invoke("app:openProject", cwd),
    prompt: (payload) => ipcRenderer.invoke("app:prompt", payload),
    editUserMessage: (entryId, payload) => ipcRenderer.invoke("app:editUserMessage", entryId, payload),
    abort: () => ipcRenderer.invoke("app:abort"),
    steer: (text) => ipcRenderer.invoke("app:steer", text),
    followUp: (text) => ipcRenderer.invoke("app:followUp", text),
    mutateQueue: (action) => ipcRenderer.invoke("app:mutateQueue", action),
    newSession: () => ipcRenderer.invoke("app:newSession"),
    switchSession: (path) => ipcRenderer.invoke("app:switchSession", path),
    listSessions: () => ipcRenderer.invoke("app:listSessions"),
    nameSession: (name) => ipcRenderer.invoke("app:nameSession", name),
    fork: (entryId) => ipcRenderer.invoke("app:fork", entryId),
    clone: () => ipcRenderer.invoke("app:clone"),
    navigateTree: (targetId, summarize) => ipcRenderer.invoke("app:navigateTree", targetId, summarize),
    getTree: (path) => ipcRenderer.invoke("app:getTree", path),
    compact: (instructions) => ipcRenderer.invoke("app:compact", instructions),
    reload: () => ipcRenderer.invoke("app:reload"),
    listModels: () => ipcRenderer.invoke("app:listModels"),
    setModel: (provider, id) => ipcRenderer.invoke("app:setModel", provider, id),
    setThinkingLevel: (level) => ipcRenderer.invoke("app:setThinkingLevel", level),
    getGpaState: () => ipcRenderer.invoke("app:getGpaState"),
    setGpaEnabled: (enabled) => ipcRenderer.invoke("app:setGpaEnabled", enabled),
    confirmGpa: () => ipcRenderer.invoke("app:confirmGpa"),
    resumeGpaPlan: () => ipcRenderer.invoke("app:resumeGpaPlan"),
    abandonGpaPlan: () => ipcRenderer.invoke("app:abandonGpaPlan"),
    peekGpaPlan: () => ipcRenderer.invoke("app:peekGpaPlan"),
    resetGpa: () => ipcRenderer.invoke("app:resetGpa"),
    listPermissionRules: () => ipcRenderer.invoke("app:listPermissionRules"),
    forgetPermissionRule: (key) => ipcRenderer.invoke("app:forgetPermissionRule", key),
    clearPermissionRules: () => ipcRenderer.invoke("app:clearPermissionRules"),
    getModelsFile: () => ipcRenderer.invoke("app:getModelsFile"),
    saveModelsFile: (file) => ipcRenderer.invoke("app:saveModelsFile", file),
    refreshModels: () => ipcRenderer.invoke("app:refreshModels"),
    login: (providerId, type) => ipcRenderer.invoke("app:login", providerId, type),
    logout: (providerId) => ipcRenderer.invoke("app:logout", providerId),
    setApiKey: (providerId, apiKey) => ipcRenderer.invoke("app:setApiKey", providerId, apiKey),
    getSettings: () => ipcRenderer.invoke("app:getSettings"),
    updateSettings: (patch) => ipcRenderer.invoke("app:updateSettings", patch),
    trustProject: (trusted, includeParent) => ipcRenderer.invoke("app:trustProject", trusted, includeParent),
    exportHtml: () => ipcRenderer.invoke("app:exportHtml"),
    exportJsonl: () => ipcRenderer.invoke("app:exportJsonl"),
    importJsonl: () => ipcRenderer.invoke("app:importJsonl"),
    searchFiles: (query) => ipcRenderer.invoke("app:searchFiles", query),
    listDirectory: (relPath) => ipcRenderer.invoke("fs:listDir", relPath),
    readFile: (relPath) => ipcRenderer.invoke("fs:readFile", relPath),
    getCommands: () => ipcRenderer.invoke("app:getCommands"),
    getSessionInfo: () => ipcRenderer.invoke("app:getSessionInfo"),
    listCatalog: () => ipcRenderer.invoke("app:listCatalog"),
    refreshCatalog: () => ipcRenderer.invoke("app:refreshCatalog"),
    listRemoteModels: (baseUrl, apiKey) => ipcRenderer.invoke("app:listRemoteModels", baseUrl, apiKey),
    listPackages: () => ipcRenderer.invoke("app:listPackages"),
    installPackage: (name) => ipcRenderer.invoke("app:installPackage", name),
    removePackage: (source) => ipcRenderer.invoke("app:removePackage", source),
    toggleResource: (item, enabled) => ipcRenderer.invoke("app:toggleResource", item, enabled),
    importSkillFile: () => ipcRenderer.invoke("app:importSkillFile"),
    importSkillDir: () => ipcRenderer.invoke("app:importSkillDir"),
    quit: () => ipcRenderer.invoke("app:quit"),
    respondDialog: (response) => {
        ipcRenderer.send("dialog:respond", response);
    },
    onEvent: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on("session:event", handler);
        return () => ipcRenderer.removeListener("session:event", handler);
    },
    onDialog: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on("dialog:request", handler);
        return () => ipcRenderer.removeListener("dialog:request", handler);
    },
    onCatalog: (listener) => {
        const handler = (_event, payload) => listener(payload);
        ipcRenderer.on("catalog:updated", handler);
        return () => ipcRenderer.removeListener("catalog:updated", handler);
    },
};
contextBridge.exposeInMainWorld("pi", api);
