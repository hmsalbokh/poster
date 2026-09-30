import { app, BrowserWindow, safeStorage, shell } from "electron";
import { join } from "node:path";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { VideoStore } from "../src/main/db";
import { AuthStore, buildAuthUrl } from "../src/main/auth";
import { YouTubeUploader } from "../src/main/uploader/youtube";
import { Scheduler } from "../src/main/scheduler";
import { startWatcher } from "../src/main/watcher";
import { ingestFolderOnce } from "../src/main/ingest";
import { registerIpc } from "../src/main/ipc";

const LOOPBACK_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/callback`;

interface PersistedCreds {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

let store: VideoStore;
let auth: AuthStore;
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
      const code = u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>OK — you can close this tab and return to Poster.</h1>");
      server.close();
      if (!code) return;
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
  await shell.openExternal(url);
  return url;
}

async function saveClientCreds(clientId: string, clientSecret: string): Promise<void> {
  creds = { clientId, clientSecret, refreshToken: creds?.refreshToken };
  auth.configure(clientId, clientSecret, REDIRECT_URI);
  if (creds.refreshToken) auth.restore({ refresh_token: creds.refreshToken });
  persistCreds();
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
  loadCreds();
  watchDir = store.getSetting("watch_folder") ?? join(app.getPath("documents"), "PosterWatch");
  if (!existsSync(watchDir)) mkdirSync(watchDir, { recursive: true });
  store.setSetting("watch_folder", watchDir);
  ingestFolderOnce(watchDir, store);
  startWatcher(watchDir, store);
  const uploader = new YouTubeUploader(() => auth.getAccessToken());
  const scheduler = new Scheduler(store, uploader);
  scheduler.start();
  registerIpc({
    store,
    auth,
    watchDir: () => watchDir,
    beginLoginFlow,
    saveClientCreds
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
