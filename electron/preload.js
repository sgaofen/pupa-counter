// Preload — exposes a narrow, typed-looking API to the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pupa", {
  session: {
    load: () => ipcRenderer.invoke("session:load"),
    save: (data) => ipcRenderer.invoke("session:save", data),
  },
  dialog: {
    openImage: () => ipcRenderer.invoke("dialog:openImage"),
    openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
  },
  file: {
    readImageDataUrl: (path) => ipcRenderer.invoke("file:readImageDataUrl", path),
    listDemoScans: () => ipcRenderer.invoke("file:listDemoScans"),
  },
  cnn: {
    detect: (imagePath) => ipcRenderer.invoke("cnn:detect", imagePath),
  },
});
