import { app, BrowserWindow, safeStorage, shell } from "electron";
import { join } from "node:path";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { VideoStore } from "../src/main/db";
import { AuthStore, buildAuthUrl } from "../src/main/auth";
import { TikTokAuthStore, TikTokUploader } from "../src/main/tiktok";
import { YouTubeUploader } from "../src/main/uploader/youtube";
import { Scheduler } from "../src/main/scheduler";
import { startWatcher } from "../src/main/watcher";
import { ingestFolderOnce } from "../src/main/ingest";
import { registerIpc } from "../src/main/ipc";

const LOOPBACK_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;
const TIKTOK_LOOPBACK_PORT = 53683;
const TIKTOK_REDIRECT_URI = `http://127.0.0.1:${TIKTOK_LOOPBACK_PORT}/callback`;

interface PersistedCreds {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  tiktok?: {
    clientKey: string;
    clientSecret: string;
    refreshToken?: string;
    openId?: string;
  };
}

let store: VideoStore;
let auth: AuthStore;
let tiktokAuth: TikTokAuthStore;
let watchDir = "";
let creds: PersistedCreds | null = null;

function tokensPath(): string {
  return join(app.getPath("userData"), "tokens.bin");
}

function loadCreds(): void {
  try {
    if (!existsSync(tokensPath())) return;
    const raw = readFileSync(tokensPath());
    creds = JSON.parse(safeStorage.decryptString(raw)) as PersistedCreds;
    auth.configure(creds.clientId, creds.clientSecret, REDIRECT_URI);
    if (creds.refreshToken) auth.restore({ refresh_token: creds.refreshToken });
    if (creds.tiktok) {
      tiktokAuth.configure(creds.tiktok.clientKey, creds.tiktok.clientSecret, TIKTOK_REDIRECT_URI);
      if (creds.tiktok.refreshToken) {
        tiktokAuth.restore({ refresh_token: creds.tiktok.refreshToken, open_id: creds.tiktok.openId });
      }
    }
  } catch {
    creds = null;
  }
}

function persistCreds(): void {
  if (!creds) return;
  writeFileSync(tokensPath(), safeStorage.encryptString(JSON.stringify(creds)));
}

async function beginLoginFlow(): Promise<string> {
  if (!creds) throw new Error("save-client-first");
  const url = buildAuthUrl(creds.clientId, REDIRECT_URI);
  const server = createServer((req, res) => {
    try {
      const u = new URL(req.url ?? "/", REDIRECT_URI);
      // Ignore stray requests (e.g. /favicon.ico) without closing the server.
      if (u.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const code = u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>OK — you can close this tab and return to Poster.</h1>");
      if (!code) return;
      server.close();
      // Exchange in background; the Account screen polls auth-status.
      void auth
        .finishLogin(code)
        .then(() => {
          const snap = auth.snapshot();
          if (snap.refresh_token && creds) {
            creds.refreshToken = snap.refresh_token;
            persistCreds();
          }
        })
        .catch((err: unknown) => {
          store.log(null, "error", `login failed: ${(err as Error).message}`);
        });
    } catch (err) {
      server.close();
      store.log(null, "error", `login callback failed: ${(err as Error).message}`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(LOOPBACK_PORT, "127.0.0.1", () => resolve());
  });
  // Safety: never leave the loopback server open if the user abandons login.
  setTimeout(() => {
    try {
      server.close();
    } catch {
      /* already closed */
    }
  }, 5 * 60_000).unref();
  await shell.openExternal(url);
  return url;
}

async function saveClientCreds(clientId: string, clientSecret: string): Promise<void> {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!id || !secret) throw new Error("client-incomplete");
  // A refresh token belongs to a specific client — drop it when the ID changes.
  const refreshToken = creds?.clientId === id ? creds?.refreshToken : undefined;
  creds = { clientId: id, clientSecret: secret, refreshToken, tiktok: creds?.tiktok };
  auth.configure(id, secret, REDIRECT_URI);
  if (refreshToken) auth.restore({ refresh_token: refreshToken });
  persistCreds();
}

function getClientInfo(): { clientId: string; hasSecret: boolean; linked: boolean } {
  return {
    clientId: creds?.clientId ?? "",
    hasSecret: Boolean(creds?.clientSecret),
    linked: auth.isSignedIn()
  };
}

async function saveTikTokClientCreds(clientKey: string, clientSecret: string): Promise<void> {
  const key = clientKey.trim();
  const secret = clientSecret.trim();
  if (!key || !secret) throw new Error("client-incomplete");
  if (!creds) throw new Error("save-client-first");
  // A refresh token belongs to a specific client — drop it when the key changes.
  const sameClient = creds.tiktok?.clientKey === key;
  const refreshToken = sameClient ? creds.tiktok?.refreshToken : undefined;
  const openId = sameClient ? creds.tiktok?.openId : undefined;
  creds = { ...creds, tiktok: { clientKey: key, clientSecret: secret, refreshToken, openId } };
  tiktokAuth.configure(key, secret, TIKTOK_REDIRECT_URI);
  if (refreshToken) tiktokAuth.restore({ refresh_token: refreshToken, open_id: openId });
  persistCreds();
}

function getTikTokClientInfo(): { clientKey: string; hasSecret: boolean; linked: boolean } {
  return {
    clientKey: creds?.tiktok?.clientKey ?? "",
    hasSecret: Boolean(creds?.tiktok?.clientSecret),
    linked: tiktokAuth.isLinked()
  };
}

function persistTikTokTokens(): void {
  if (!creds?.tiktok) return;
  const snap = tiktokAuth.snapshot();
  if (snap.refresh_token && snap.refresh_token !== creds.tiktok.refreshToken) {
    creds.tiktok.refreshToken = snap.refresh_token;
    creds.tiktok.openId = snap.open_id;
    persistCreds();
  }
}

async function beginTikTokLoginFlow(): Promise<string> {
  if (!creds?.tiktok) throw new Error("save-tiktok-client-first");
  const { url } = tiktokAuth.beginLogin();
  const server = createServer((req, res) => {
    try {
      const u = new URL(req.url ?? "/", TIKTOK_REDIRECT_URI);
      if (u.pathname !== "/callback") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const code = u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>OK — you can close this tab and return to Poster.</h1>");
      if (!code) return;
      server.close();
      // Exchange in background; the Account screen polls tiktok-auth-status.
      void tiktokAuth
        .finishLogin(code, u.searchParams.get("state") ?? "")
        .then(() => persistTikTokTokens())
        .catch((err: unknown) => {
          store.log(null, "error", `tiktok login failed: ${(err as Error).message}`);
        });
    } catch (err) {
      server.close();
      store.log(null, "error", `tiktok login callback failed: ${(err as Error).message}`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(TIKTOK_LOOPBACK_PORT, "127.0.0.1", () => resolve());
  });
  setTimeout(() => {
    try {
      server.close();
    } catch {
      /* already closed */
    }
  }, 5 * 60_000).unref();
  await shell.openExternal(url);
  return url;
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    await win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function bootServices(): void {
  const dataDir = app.getPath("userData");
  store = VideoStore.file(join(dataDir, "poster.db"));
  auth = new AuthStore();
  tiktokAuth = new TikTokAuthStore();
  loadCreds();
  watchDir = store.getSetting("watch_folder") ?? join(app.getPath("documents"), "PosterWatch");
  if (!existsSync(watchDir)) mkdirSync(watchDir, { recursive: true });
  store.setSetting("watch_folder", watchDir);
  ingestFolderOnce(watchDir, store);
  startWatcher(watchDir, store);
  const uploader = new YouTubeUploader(() => auth.getAccessToken());
  const tiktokUploader = new TikTokUploader(async () => {
    const token = await tiktokAuth.getAccessToken();
    persistTikTokTokens();
    return token;
  });
  const scheduler = new Scheduler(store, { youtube: uploader, tiktok: tiktokUploader });
  scheduler.start();
  registerIpc({
    store,
    auth,
    watchDir: () => watchDir,
    beginLoginFlow,
    saveClientCreds,
    getClientInfo,
    beginTikTokLoginFlow,
    saveTikTokClientCreds,
    getTikTokClientInfo
  });
}

function logStartup(msg: string): void {
  try {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "startup.log"), `${new Date().toISOString()} ${msg}\n`, { flag: "a" });
  } catch {
    /* logging must never crash startup */
  }
}

process.on("uncaughtException", (err) => {
  logStartup(`uncaught: ${(err as Error).stack ?? (err as Error).message}`);
  app.quit();
});

process.on("unhandledRejection", (reason) => {
  logStartup(`rejection: ${String(reason)}`);
});

void app.whenReady().then(() => {
  try {
    bootServices();
  } catch (err) {
    logStartup(`boot failed: ${(err as Error).stack ?? (err as Error).message}`);
    app.quit();
    return;
  }
  logStartup("boot ok");
  void createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
