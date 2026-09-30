// Preload — exposes a narrow API to the renderer (typed in src/types.ts).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("pupa", {
  session: {
    load: (sessionId) => ipcRenderer.invoke("session:load", sessionId),
    save: (data) => ipcRenderer.invoke("session:save", data),
    list: () => ipcRenderer.invoke("session:list"),
    create: (partial) => ipcRenderer.invoke("session:create", partial),
    delete: (sessionId) => ipcRenderer.invoke("session:delete", sessionId),
  },
  dialog: {
    openImage: () => ipcRenderer.invoke("dialog:openImage"),
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  },
  file: {
    readImageDataUrl: (path) => ipcRenderer.invoke("file:readImageDataUrl", path),
    exists: (path) => ipcRenderer.invoke("file:exists", path),
    listDemoScans: () => ipcRenderer.invoke("file:listDemoScans"),
    // Absolute path of a dropped File (File.path is gone in newer Electron).
    pathForFile: (file) => {
      try { return webUtils ? webUtils.getPathForFile(file) : file.path || ""; }
      catch { return file.path || ""; }
    },
  },
  cnn: {
    detect: (imagePath, opts) => ipcRenderer.invoke("cnn:detect", imagePath, opts),
    info: () => ipcRenderer.invoke("cnn:info"),
  },
  scanner: {
    listDevices: () => ipcRenderer.invoke("scanner:listDevices"),
    scan: (params) => ipcRenderer.invoke("scanner:scan", params),
  },
  exporter: {
    text: (args) => ipcRenderer.invoke("export:text", args),
    xlsx: (args) => ipcRenderer.invoke("export:xlsx", args),
  },
  shell: {
    showItemInFolder: (p) => ipcRenderer.invoke("shell:showItemInFolder", p),
    openPath: (p) => ipcRenderer.invoke("shell:openPath", p),
  },
  app: {
    paths: () => ipcRenderer.invoke("app:paths"),
  },
});
