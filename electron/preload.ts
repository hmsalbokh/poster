import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("poster", {
  version: "0.1.0",
  listVideos: () => ipcRenderer.invoke("list-videos"),
  retryVideo: (id: string) => ipcRenderer.invoke("retry-video", id),
  listEvents: () => ipcRenderer.invoke("list-events"),
  getWatchDir: () => ipcRenderer.invoke("get-watch-dir"),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  getSetting: (key: string) => ipcRenderer.invoke("get-setting", key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke("set-setting", key, value),
  authStatus: () => ipcRenderer.invoke("auth-status"),
  saveClient: (clientId: string, clientSecret: string) => ipcRenderer.invoke("save-client", clientId, clientSecret),
  beginLogin: () => ipcRenderer.invoke("begin-login"),
  quotaStatus: () => ipcRenderer.invoke("quota-status")
});
