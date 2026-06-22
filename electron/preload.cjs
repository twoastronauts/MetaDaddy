const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("metaDaddy", {
  selectFile: () => ipcRenderer.invoke("metadata:select-file"),
  analyzePath: (filePath) => ipcRenderer.invoke("metadata:analyze-path", filePath),
  getDroppedFilePath: (file) => webUtils.getPathForFile(file),
  exportJson: (payload) => ipcRenderer.invoke("metadata:export-json", payload),
  createSidecar: (payload) => ipcRenderer.invoke("metadata:create-sidecar", payload),
  writeEmbeddedCopy: (payload) => ipcRenderer.invoke("metadata:write-embedded-copy", payload),
  revealPath: (filePath) => ipcRenderer.invoke("shell:reveal-path", filePath),
  getAppInfo: () => ipcRenderer.invoke("app:info")
});
