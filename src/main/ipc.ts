import { ipcMain, shell } from "electron";
import type { VideoStore } from "./db";
import type { AuthStore } from "./auth";
import { uploadsLeftToday, INSERT_COST } from "./quota";

export interface IpcDeps {
  store: VideoStore;
  auth: AuthStore;
  watchDir: () => string;
  beginLoginFlow: () => Promise<string>;
  saveClientCreds: (clientId: string, clientSecret: string) => Promise<void>;
  getClientInfo: () => { clientId: string; hasSecret: boolean; linked: boolean };
  beginTikTokLoginFlow: () => Promise<string>;
  saveTikTokClientCreds: (clientKey: string, clientSecret: string) => Promise<void>;
  getTikTokClientInfo: () => { clientKey: string; hasSecret: boolean; linked: boolean };
}

function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function registerIpc(deps: IpcDeps): void {
  const {
    store,
    auth,
    watchDir,
    beginLoginFlow,
    saveClientCreds,
    getClientInfo,
    beginTikTokLoginFlow,
    saveTikTokClientCreds,
    getTikTokClientInfo
  } = deps;
  ipcMain.handle("list-videos", () => store.listAll());
  ipcMain.handle("retry-video", (_e, id: string) => {
    store.setStatus(id, "pending", { attempts: 0, error: null });
  });
  ipcMain.handle("list-events", () => store.listEvents(100));
  ipcMain.handle("get-watch-dir", () => watchDir());
  ipcMain.handle("open-folder", () => shell.openPath(watchDir()));
  ipcMain.handle("get-setting", (_e, key: string) => store.getSetting(key));
  ipcMain.handle("set-setting", (_e, key: string, value: string) => {
    store.setSetting(key, value);
  });
  ipcMain.handle("auth-status", () => ({ signedIn: auth.isSignedIn() }));
  ipcMain.handle("get-client", () => getClientInfo());
  ipcMain.handle("tiktok-auth-status", () => ({ linked: getTikTokClientInfo().linked }));
  ipcMain.handle("get-tiktok-client", () => getTikTokClientInfo());
  ipcMain.handle("save-tiktok-client", (_e, clientKey: string, clientSecret: string) =>
    saveTikTokClientCreds(clientKey, clientSecret)
  );
  ipcMain.handle("begin-tiktok-login", () => beginTikTokLoginFlow());
  ipcMain.handle("save-client", (_e, clientId: string, clientSecret: string) =>
    saveClientCreds(clientId, clientSecret)
  );
  ipcMain.handle("begin-login", () => beginLoginFlow());
  ipcMain.handle("quota-status", () => {
    const usedUnits = store.countRecentUploads(todayStartIso()) * INSERT_COST;
    return { left: uploadsLeftToday(usedUnits), usedUnits };
  });
}
