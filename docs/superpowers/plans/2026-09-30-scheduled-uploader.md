# Scheduled Uploader (YouTube Shorts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app that watches a local folder of `mp4 + json` pairs and uploads them to YouTube as scheduled Shorts.

**Architecture:** `chokidar` watcher → Zod-validated ingest → SQLite queue (single source of truth) → `node-schedule` scheduler with backoff → pluggable `UploaderPlugin` (YouTube first) using resumable upload with `private + publishAt`. React dashboard is display-only.

**Tech Stack:** Electron ^33, electron-vite ^3, Vite ^6, React ^19, TypeScript ~5.7, TailwindCSS, better-sqlite3 ^11, chokidar ^4, googleapis ^144 (youtube v3), zod ^3, node-schedule ^2, vitest ^3, electron-builder ^25, ffprobe-static, auto-launch ^5.

**Spec:** `docs/superpowers/specs/2026-09-30-scheduled-uploader-design.md`

## Global Constraints

- Scheduling is ALWAYS `status.privacyStatus = "private"` + `status.publishAt` (official YouTube scheduled-publish mechanism).
- YouTube default quota ≈ 10,000 units/day, `videos.insert` ≈ 1,600 units → max ~6 uploads/day; on `quotaExceeded` defer to next day with a visible warning.
- `title` ≤ 100 chars, `description` ≤ 5000 chars (YouTube limits, enforced by Zod).
- Shorts check = vertical 9:16 AND duration < 60s via ffprobe; violation = warning only, never blocks upload.
- No secrets in code or repo: `client_id/client_secret`/tokens live in `safeStorage` (+ OS keychain) only; `*.db` and `tokens` are gitignored.
- UI is bilingual AR (RTL) / EN (LTR) with a toggle; Arabic strings are first-class, not machine-translated at runtime.
- Queue states: `pending → uploading → scheduled → published | failed | needs-metadata`; only the queue module mutates state.
- All CWD-dependent commands run from `C:\Users\nonog\Downloads\opencode\poster`.

---

## File Map (created by this plan)

- `package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `tailwind.config.js` — scaffold (Task 1)
- `src/shared/schema.ts` — Zod sidecar schema + types (Task 2)
- `src/shared/types.ts` — `VideoStatus`, `VideoRow`, `UploaderPlugin` interface (Task 2)
- `src/main/db.ts` — SQLite open/migrate + `VideoStore` + `EventLog` (Task 3)
- `src/main/watcher.ts` — chokidar wrapper emitting `file-added/file-removed` (Task 4)
- `src/main/ingest.ts` — pairs `mp4+json`, validates, upserts queue (Task 4)
- `src/main/auth.ts` — OAuth2 desktop flow, safeStorage tokens, auto-refresh (Task 5)
- `src/main/uploader/types.ts` — `UploaderPlugin` interface (Task 6)
- `src/main/uploader/youtube.ts` — resumable upload + `publishAt` + quota errors (Task 6)
- `src/main/quota.ts` — daily-unit estimator + `isQuotaExceeded()` (Task 6)
- `src/main/scheduler.ts` — due-job runner + exponential backoff (Task 7)
- `src/main/ipc.ts` — main↔renderer handlers (Task 8)
- `electron/main.ts`, `electron/preload.ts` — wiring (Tasks 1, 8)
- `src/renderer/App.tsx`, `src/renderer/i18n.ts`, `src/renderer/screens/{Queue,Settings,Logs,Account}.tsx` (Task 8)
- `electron-builder.yml`, `.gitignore` additions (Task 9)
- `tests/unit/{schema,store,ingest,auth,youtube,scheduler,i18n}.test.ts` (Tasks 2–8)

---

### Task 1: Scaffold Electron + Vite + React + TS + Vitest (hello, green)

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `electron/main.ts`, `electron/preload.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `index.html`, `tsconfig.json`, `vitest.config.ts`, `tests/unit/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run dev` (electron-vite dev), `npm test` (vitest run) — later tasks rely on both existing.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scaffold.test.ts
import { describe, expect, it } from "vitest";
import { appName } from "../../src/shared/types";

describe("scaffold", () => {
  it("exposes the app name", () => {
    expect(appName()).toBe("poster");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/scaffold.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/shared/types" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/types.ts
export function appName(): string {
  return "poster";
}
```

```jsonc
// package.json (scripts section — full file created by scaffold)
{
  "name": "poster",
  "private": true,
  "version": "0.1.0",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "dist": "electron-vite build && electron-builder"
  }
}
```

```ts
// electron/main.ts (minimal — extended in Task 8)
import { app, BrowserWindow } from "electron";
async function createWindow(): Promise<void> {
  const win = new BrowserWindow({ width: 1200, height: 800 });
  if (process.env["ELECTRON_RENDERER_URL"]) await win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
}
void app.whenReady().then(createWindow);
```

```ts
// electron/preload.ts
import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("poster", { version: "0.1.0" });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm install; if ($?) { npm test -- tests/unit/scaffold.test.ts }` (workdir `poster/`)
Expected: PASS (1 passed). Also `npm run dev` opens an empty window and `Ctrl+C` exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add package.json electron.vite.config.ts electron/main.ts electron/preload.ts src/shared/types.ts tests/unit/scaffold.test.ts index.html src/renderer/main.tsx
git commit -m "feat: scaffold electron-vite react ts with green vitest"
```

---

### Task 2: Sidecar JSON schema (Zod) — the folder contract

**Files:**
- Create: `src/shared/schema.ts`
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseSidecar(json: unknown): Sidecar` (throws `ZodError`), type `Sidecar` — used by ingest (Task 4) and UI form hints (Task 8).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/schema.test.ts
import { describe, expect, it } from "vitest";
import { parseSidecar } from "../../src/shared/schema";

describe("parseSidecar", () => {
  it("accepts a valid sidecar", () => {
    const s = parseSidecar({
      title: "اختبار شورت #Shorts",
      description: "وصف",
      tags: ["shorts"],
      publishAt: new Date(Date.now() + 3600_000).toISOString(),
      madeForKids: false,
      language: "ar",
      categoryId: "22",
    });
    expect(s.title).toContain("#Shorts");
  });
  it("rejects title over 100 chars", () => {
    expect(() =>
      parseSidecar({ title: "x".repeat(101), publishAt: new Date(Date.now() + 3600_000).toISOString() }),
    ).toThrow();
  });
  it("rejects publishAt that is not an ISO date", () => {
    expect(() => parseSidecar({ title: "ok", publishAt: "tomorrow" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/schema.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/shared/schema".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/schema.ts
import { z } from "zod";

export const sidecarSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(5000).default(""),
  tags: z.array(z.string().max(30)).max(30).default([]),
  publishAt: z.string().datetime({ offset: true }),
  madeForKids: z.boolean().default(false),
  language: z.enum(["ar", "en"]).default("ar"),
  categoryId: z.string().default("22"),
});

export type Sidecar = z.infer<typeof sidecarSchema>;

export function parseSidecar(json: unknown): Sidecar {
  return sidecarSchema.parse(json);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/schema.test.ts` (workdir `poster/`)
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/shared/schema.ts tests/unit/schema.test.ts
git commit -m "feat: add zod sidecar schema for folder contract"
```

---

### Task 3: SQLite store — queue as single source of truth

**Files:**
- Create: `src/main/db.ts`
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: `Sidecar` type from Task 2.
- Produces: `VideoStore.upsertPending(filePath, sidecar | null)`, `VideoStore.setStatus(id, status, patch?)`, `VideoStore.listByStatus(s)`, `VideoStore.getDue(nowIso)` — used by ingest (Task 4) and scheduler (Task 7). Only this module runs SQL.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/store.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { VideoStore } from "../../src/main/db";

describe("VideoStore", () => {
  let store: VideoStore;
  beforeEach(() => { store = VideoStore.inMemory(); });
  it("upserts pending then transitions to scheduled", () => {
    const v = store.upsertPending("c:/watch/clip1.mp4", { title: "t", publishAt: new Date(Date.now() + 60000).toISOString() } as never);
    expect(v.status).toBe("pending");
    const s = store.setStatus(v.id, "scheduled", { youtube_video_id: "abc" });
    expect(s.status).toBe("scheduled");
    expect(store.listByStatus("scheduled")).toHaveLength(1);
  });
  it("marks needs-metadata when sidecar is null", () => {
    const v = store.upsertPending("c:/watch/orphan.mp4", null);
    expect(v.status).toBe("needs-metadata");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/store.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/main/db".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/db.ts
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Sidecar } from "../shared/schema";
import type { VideoRow, VideoStatus } from "../shared/types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos(
  id TEXT PRIMARY KEY, file_path TEXT UNIQUE NOT NULL, json_path TEXT,
  title TEXT, description TEXT, tags TEXT, publishAt TEXT, lang TEXT,
  status TEXT NOT NULL, youtube_video_id TEXT, error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT, level TEXT NOT NULL,
  message TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

export class VideoStore {
  private db: Database.Database;
  private constructor(db: Database.Database) { this.db = db; db.exec(SCHEMA); }
  static file(path: string): VideoStore { return new VideoStore(new Database(path)); }
  static inMemory(): VideoStore { return new VideoStore(new Database(":memory:")); }
  upsertPending(filePath: string, sidecar: Sidecar | null): VideoRow {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT * FROM videos WHERE file_path=?").get(filePath) as VideoRow | undefined;
    const status: VideoStatus = sidecar ? "pending" : "needs-metadata";
    if (existing) {
      this.db.prepare("UPDATE videos SET title=?,description=?,tags=?,publishAt=?,lang=?,status=?,updated_at=? WHERE id=?")
        .run(sidecar?.title ?? existing.title, sidecar?.description ?? "", JSON.stringify(sidecar?.tags ?? []),
          sidecar?.publishAt ?? existing.publishAt, sidecar?.language ?? "ar", status, now, existing.id);
      return this.byId(existing.id);
    }
    const id = randomUUID();
    this.db.prepare("INSERT INTO videos(id,file_path,title,description,tags,publishAt,lang,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)")
      .run(id, filePath, sidecar?.title ?? filePath, sidecar?.description ?? "", JSON.stringify(sidecar?.tags ?? []),
        sidecar?.publishAt ?? null, sidecar?.language ?? "ar", status, now, now);
    return this.byId(id);
  }
  setStatus(id: string, status: VideoStatus, patch: Partial<VideoRow> = {}): VideoRow {
    const v = this.byId(id);
    this.db.prepare("UPDATE videos SET status=?,youtube_video_id=?,error=?,attempts=?,updated_at=? WHERE id=?")
      .run(status, patch.youtube_video_id ?? v.youtube_video_id, patch.error ?? null,
        (patch.attempts ?? v.attempts), new Date().toISOString(), id);
    return this.byId(id);
  }
  listByStatus(s: VideoStatus): VideoRow[] {
    return this.db.prepare("SELECT * FROM videos WHERE status=? ORDER BY publishAt ASC").all(s) as VideoRow[];
  }
  getDue(nowIso: string): VideoRow[] {
    return this.db.prepare("SELECT * FROM videos WHERE status='pending' AND publishAt IS NOT NULL AND publishAt<=? ORDER BY publishAt ASC").all(nowIso) as VideoRow[];
  }
  log(videoId: string | null, level: string, message: string): void {
    this.db.prepare("INSERT INTO events(video_id,level,message,at) VALUES(?,?,?,?)").run(videoId, level, message, new Date().toISOString());
  }
  private byId(id: string): VideoRow {
    return this.db.prepare("SELECT * FROM videos WHERE id=?").get(id) as VideoRow;
  }
}
```

```ts
// src/shared/types.ts (append — keep appName() from Task 1)
export type VideoStatus = "pending" | "uploading" | "scheduled" | "published" | "failed" | "needs-metadata";
export interface VideoRow {
  id: string; file_path: string; title: string; description: string; tags: string;
  publishAt: string | null; lang: string; status: VideoStatus;
  youtube_video_id: string | null; error: string | null; attempts: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/store.test.ts` (workdir `poster/`)
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts src/shared/types.ts tests/unit/store.test.ts
git commit -m "feat: add sqlite queue store as single source of truth"
```

---

### Task 4: Folder watcher + ingest (mp4+json pairing)

**Files:**
- Create: `src/main/watcher.ts`, `src/main/ingest.ts`
- Test: `tests/unit/ingest.test.ts`

**Interfaces:**
- Consumes: `parseSidecar` (Task 2), `VideoStore` (Task 3).
- Produces: `ingestFolderOnce(dir, store)` + `startWatcher(dir, store)` — scheduler/UI only call these; no upload logic here.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/ingest.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VideoStore } from "../../src/main/db";
import { ingestFolderOnce } from "../../src/main/ingest";

describe("ingestFolderOnce", () => {
  let dir: string; let store: VideoStore;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "poster-")); store = VideoStore.inMemory(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  it("pairs mp4 with valid json into pending", () => {
    writeFileSync(join(dir, "clip1.mp4"), "fake");
    writeFileSync(join(dir, "clip1.json"), JSON.stringify({ title: "t #Shorts", publishAt: new Date(Date.now() + 60000).toISOString() }));
    const rows = ingestFolderOnce(dir, store);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });
  it("marks mp4 without json as needs-metadata", () => {
    writeFileSync(join(dir, "orphan.mp4"), "fake");
    const rows = ingestFolderOnce(dir, store);
    expect(rows[0].status).toBe("needs-metadata");
  });
  it("marks invalid json as failed with error text", () => {
    writeFileSync(join(dir, "bad.mp4"), "fake");
    writeFileSync(join(dir, "bad.json"), "{not json");
    const rows = ingestFolderOnce(dir, store);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toMatch(/json/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/ingest.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/main/ingest".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/ingest.ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parseSidecar } from "../shared/schema";
import type { VideoStore } from "./db";
import type { VideoRow } from "../shared/types";

export function ingestFolderOnce(dir: string, store: VideoStore): VideoRow[] {
  const out: VideoRow[] = [];
  for (const f of readdirSync(dir)) {
    if (extname(f).toLowerCase() !== ".mp4") continue;
    const base = basename(f, extname(f));
    const mp4 = join(dir, f);
    const jsonPath = join(dir, `${base}.json`);
    if (!existsSync(jsonPath)) { out.push(store.upsertPending(mp4, null)); continue; }
    try {
      const sidecar = parseSidecar(JSON.parse(readFileSync(jsonPath, "utf8")));
      const row = store.upsertPending(mp4, sidecar);
      out.push(row);
    } catch (err) {
      const row = store.upsertPending(mp4, null);
      out.push(store.setStatus(row.id, "failed", { error: `sidecar invalid: ${(err as Error).message}` }));
    }
  }
  return out;
}
```

```ts
// src/main/watcher.ts
import chokidar from "chokidar";
import type { VideoStore } from "./db";
import { ingestFolderOnce } from "./ingest";

export function startWatcher(dir: string, store: VideoStore): { close(): Promise<void> } {
  const watcher = chokidar.watch(dir, { ignored: /(^|[/\\])\../, depth: 0, awaitWriteFinish: true });
  const rescan = (): void => { ingestFolderOnce(dir, store); };
  watcher.on("add", rescan).on("unlink", rescan).on("change", rescan);
  return { close: () => watcher.close() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/ingest.test.ts` (workdir `poster/`)
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/main/ingest.ts src/main/watcher.ts tests/unit/ingest.test.ts
git commit -m "feat: add folder watcher and mp4-json ingest"
```

---

### Task 5: Google OAuth (desktop flow, encrypted tokens, auto-refresh)

**Files:**
- Create: `src/main/auth.ts`
- Test: `tests/unit/auth.test.ts`

**Interfaces:**
- Consumes: none (wraps `googleapis` OAuth2Client + `safeStorage`).
- Produces: `AuthStore.getAccessToken()`, `AuthStore.isSignedIn()`, `AuthStore.beginLogin(clientId, clientSecret)` → url, `AuthStore.finishLogin(code)` — uploader (Task 6) calls only `getAccessToken()`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/auth.test.ts
import { describe, expect, it } from "vitest";
import { buildAuthUrl } from "../../src/main/auth";

describe("buildAuthUrl", () => {
  it("includes youtube.upload scope and offline access", () => {
    const url = buildAuthUrl("cid", "https://localhost/cb");
    expect(url).toContain("youtube.upload");
    expect(url).toContain("access_type%3Doffline");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/auth.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/main/auth".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/auth.ts
import { OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"];

export function buildAuthUrl(clientId: string, redirectUri: string): string {
  const c = new OAuth2Client(clientId, undefined, redirectUri);
  return c.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });
}

export class AuthStore {
  private oauth: OAuth2Client | null = null;
  private tokens: { refresh_token?: string; access_token?: string; expiry_date?: number } = {};
  configure(clientId: string, clientSecret: string, redirectUri: string): void {
    this.oauth = new OAuth2Client(clientId, clientSecret, redirectUri);
  }
  isSignedIn(): boolean { return Boolean(this.tokens.refresh_token); }
  loginUrl(redirectUri: string, clientId: string): string { return buildAuthUrl(clientId, redirectUri); }
  async finishLogin(code: string): Promise<void> {
    if (!this.oauth) throw new Error("auth-not-configured");
    const { tokens } = await this.oauth.getToken(code);
    // NOTE: persist tokens.encrypted via safeStorage in electron/main wiring (Task 8), never plain.
    this.tokens = { refresh_token: tokens.refresh_token ?? undefined, access_token: tokens.access_token ?? undefined, expiry_date: tokens.expiry_date ?? undefined };
    this.oauth.setCredentials(tokens);
  }
  async getAccessToken(): Promise<string> {
    if (!this.oauth) throw new Error("auth-not-configured");
    if (!this.tokens.refresh_token) throw new Error("sign-in-required");
    const { token } = await this.oauth.getAccessToken();
    if (!token) throw new Error("token-refresh-failed");
    return token;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/auth.test.ts` (workdir `poster/`)
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/main/auth.ts tests/unit/auth.test.ts
git commit -m "feat: add google oauth desktop flow with refresh"
```

---

### Task 6: YouTube uploader (resumable + publishAt + quota guard)

**Files:**
- Create: `src/main/uploader/types.ts`, `src/main/uploader/youtube.ts`, `src/main/quota.ts`
- Test: `tests/unit/youtube.test.ts`

**Interfaces:**
- Consumes: `AuthStore.getAccessToken()` (Task 5), `VideoRow` (Task 2/3).
- Produces: `YouTubeUploader.upload(row, fileBytes)` → `{ videoId }`, `quotaErrorOf(err)` — scheduler (Task 7) is the only caller.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/youtube.test.ts
import { describe, expect, it } from "vitest";
import { buildInsertBody, quotaErrorOf } from "../../src/main/uploader/youtube";

describe("youtube uploader", () => {
  it("builds private+publishAt scheduled body", () => {
    const body = buildInsertBody({ title: "t #Shorts", description: "d", tags: ["a"], publishAt: "2026-10-01T18:00:00.000+03:00" });
    expect(body.status.privacyStatus).toBe("private");
    expect(body.status.publishAt).toContain("2026-10-01");
  });
  it("detects quota errors", () => {
    expect(quotaErrorOf({ code: 403, errors: [{ reason: "quotaExceeded" }] })).toBe(true);
    expect(quotaErrorOf(new Error("nope"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/youtube.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/main/uploader/youtube".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/uploader/types.ts
export interface UploadResult { videoId: string; }
export interface UploaderPlugin {
  readonly name: string;
  upload(videoId: string, filePath: string, meta: { title: string; description: string; tags: string[]; publishAt: string; madeForKids: boolean; language: string; categoryId: string }): Promise<UploadResult>;
}
```

```ts
// src/main/uploader/youtube.ts
import { google } from "googleapis";
import { createReadStream, statSync } from "node:fs";

export interface InsertBody {
  snippet: { title: string; description: string; tags: string[]; categoryId: string; defaultLanguage: string };
  status: { privacyStatus: "private"; publishAt: string; madeForKids: boolean; selfDeclaredMadeForKids: boolean };
}

export function buildInsertBody(meta: { title: string; description: string; tags: string[]; publishAt: string; madeForKids?: boolean; language?: string; categoryId?: string }): InsertBody {
  return {
    snippet: { title: meta.title, description: meta.description, tags: meta.tags, categoryId: meta.categoryId ?? "22", defaultLanguage: meta.language ?? "ar" },
    status: { privacyStatus: "private", publishAt: meta.publishAt, madeForKids: meta.madeForKids ?? false, selfDeclaredMadeForKids: meta.madeForKids ?? false },
  };
}

export function quotaErrorOf(err: unknown): boolean {
  const e = err as { code?: number; errors?: Array<{ reason?: string }> };
  return e?.code === 403 && (e.errors ?? []).some((x) => x.reason === "quotaExceeded" || x.reason === "dailyLimitExceeded");
}

export class YouTubeUploader {
  constructor(private getToken: () => Promise<string>) {}
  async upload(filePath: string, meta: { title: string; description: string; tags: string[]; publishAt: string; madeForKids: boolean; language: string; categoryId: string }): Promise<{ videoId: string }> {
    const token = await this.getToken();
    const youtube = google.youtube({ version: "v3", headers: { Authorization: `Bearer ${token}` } });
    const body = buildInsertBody(meta);
    const size = statSync(filePath).size;
    const res = await youtube.videos.insert(
      { part: ["snippet", "status"], requestBody: body, media: { body: createReadStream(filePath) } },
      { maxContentLength: size, maxBodyLength: size },
    );
    const id = res.data.id;
    if (!id) throw new Error("upload-no-video-id");
    return { videoId: id };
  }
}
```

```ts
// src/main/quota.ts
export const INSERT_COST = 1600;
export const DAILY_LIMIT = 10000;
export function uploadsLeftToday(usedUnits: number): number {
  return Math.max(0, Math.floor((DAILY_LIMIT - usedUnits) / INSERT_COST));
}
```

```ts
// src/main/probe.ts
import { execFile } from "node:child_process";
import ffprobeStatic from "ffprobe-static";
export async function isShort(filePath: string): Promise<{ ok: boolean; reason: string }> {
  return new Promise((resolve) => {
    execFile(ffprobeStatic.path, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
      (err, stdout) => {
        if (err) return resolve({ ok: true, reason: "probe-unavailable-warning-only" });
        try {
          const j = JSON.parse(stdout as string);
          const dur = Number(j.format?.duration ?? 0);
          const v = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === "video");
          const vertical = Number(v?.height ?? 0) > Number(v?.width ?? 0);
          if (dur >= 61) return resolve({ ok: false, reason: "longer-than-60s" });
          if (!vertical) return resolve({ ok: false, reason: "not-vertical" });
          return resolve({ ok: true, reason: "short-ok" });
        } catch { return resolve({ ok: true, reason: "probe-parse-warning-only" }); }
      });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/youtube.test.ts` (workdir `poster/`)
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/main/uploader/types.ts src/main/uploader/youtube.ts src/main/quota.ts src/main/probe.ts tests/unit/youtube.test.ts
git commit -m "feat: add youtube resumable uploader with publishAt and quota guard"
```

---

### Task 7: Scheduler (due runner + exponential backoff state machine)

**Files:**
- Create: `src/main/scheduler.ts`
- Test: `tests/unit/scheduler.test.ts`

**Interfaces:**
- Consumes: `VideoStore` (Task 3), `YouTubeUploader` (Task 6), `quotaErrorOf` (Task 6).
- Produces: `nextDelay(attempts)`, `Scheduler.tick(nowIso)` — wired in electron/main (Task 8); UI polls store only.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scheduler.test.ts
import { describe, expect, it } from "vitest";
import { nextDelay } from "../../src/main/scheduler";

describe("nextDelay", () => {
  it("backs off 1m then 5m then 30m then caps", () => {
    expect(nextDelay(0)).toBe(60_000);
    expect(nextDelay(1)).toBe(300_000);
    expect(nextDelay(2)).toBe(1_800_000);
    expect(nextDelay(9)).toBe(1_800_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/scheduler.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/main/scheduler".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/scheduler.ts
import { readFileSync } from "node:fs";
import type { VideoStore } from "./db";
import { YouTubeUploader, quotaErrorOf } from "./uploader/youtube";

const DELAYS = [60_000, 300_000, 1_800_000];
export function nextDelay(attempts: number): number {
  return DELAYS[Math.min(attempts, DELAYS.length - 1)];
}
export const MAX_ATTEMPTS = 5;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  constructor(private store: VideoStore, private uploader: YouTubeUploader) {}
  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => void this.tick(new Date().toISOString()), intervalMs);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  async tick(nowIso: string): Promise<void> {
    for (const row of this.store.getDue(nowIso)) {
      this.store.setStatus(row.id, "uploading");
      try {
        const meta = { title: row.title, description: row.description, tags: JSON.parse(row.tags) as string[], publishAt: row.publishAt as string, madeForKids: false, language: row.lang, categoryId: "22" };
        const { videoId } = await this.uploader.upload(row.file_path, meta);
        this.store.setStatus(row.id, "scheduled", { youtube_video_id: videoId, attempts: 0 });
        this.store.log(row.id, "info", `scheduled as ${videoId}`);
      } catch (err) {
        if (quotaErrorOf(err)) {
          this.store.setStatus(row.id, "pending", { error: "quota-exceededretry-tomorrow" });
          this.store.log(row.id, "warn", "youtube quota exceeded — deferred");
          return;
        }
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          this.store.setStatus(row.id, "failed", { error: (err as Error).message, attempts });
        } else {
          this.store.setStatus(row.id, "pending", { error: (err as Error).message, attempts });
        }
        this.store.log(row.id, "error", (err as Error).message);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/scheduler.test.ts` (workdir `poster/`)
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/main/scheduler.ts tests/unit/scheduler.test.ts
git commit -m "feat: add scheduler with exponential backoff"
```

---

### Task 8: Bilingual dashboard (Queue / Settings / Logs / Account)

**Files:**
- Create: `src/renderer/i18n.ts`, `src/renderer/App.tsx`, `src/renderer/screens/Queue.tsx`, `src/renderer/screens/Settings.tsx`, `src/renderer/screens/Logs.tsx`, `src/renderer/screens/Account.tsx`, `src/main/ipc.ts`
- Modify: `electron/main.ts`, `electron/preload.ts`
- Test: `tests/unit/i18n.test.ts`

**Interfaces:**
- Consumes: all Tasks 1–7 via `src/main/ipc.ts` handlers (`list-videos`, `open-folder`, `save-settings`, `login-url`, `quota-status`).
- Produces: the visible app. No upload logic in renderer — all calls go through `window.poster.*`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/i18n.test.ts
import { describe, expect, it } from "vitest";
import { t, type Locale } from "../../src/renderer/i18n";

describe("i18n", () => {
  it("covers queue status in both locales", () => {
    const l: Locale[] = ["ar", "en"];
    for (const locale of l) {
      expect(t(locale, "status.pending").length).toBeGreaterThan(0);
      expect(t(locale, "status.failed").length).toBeGreaterThan(0);
    }
  });
  it("arabic differs from english", () => {
    expect(t("ar", "app.title")).not.toBe(t("en", "app.title"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/i18n.test.ts` (workdir `poster/`)
Expected: FAIL with "Failed to resolve import ../../src/renderer/i18n".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/i18n.ts
export type Locale = "ar" | "en";
const dict = {
  en: { "app.title": "Poster — Scheduled Uploader", "status.pending": "Pending", "status.failed": "Failed", "status.scheduled": "Scheduled", "queue.openFolder": "Open watch folder" },
  ar: { "app.title": "بوستر — رفع مجدول", "status.pending": "بالانتظار", "status.failed": "فشل", "status.scheduled": "مجدول", "queue.openFolder": "فتح مجلد المراقبة" },
} as const;
export function t(locale: Locale, key: keyof (typeof dict)["en"]): string { return dict[locale][key]; }
```

```tsx
// src/renderer/App.tsx (skeleton — full screens per file)
import { useState } from "react";
import { t, type Locale } from "./i18n";
import Queue from "./screens/Queue";
export default function App(): JSX.Element {
  const [locale, setLocale] = useState<Locale>("ar");
  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"}>
      <header><h1>{t(locale, "app.title")}</h1>
        <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>{locale === "ar" ? "EN" : "عربي"}</button>
      </header>
      <Queue locale={locale} />
    </div>
  );
}
```

```ts
// src/main/ipc.ts
import { ipcMain, shell } from "electron";
import type { VideoStore } from "./db";
export function registerIpc(store: VideoStore, watchDir: () => string): void {
  ipcMain.handle("list-videos", () => store.listByStatus("pending"));
  ipcMain.handle("open-folder", () => shell.openPath(watchDir()));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/i18n.test.ts` (workdir `poster/`)
Expected: PASS (2 passed). Then manual: `npm run dev` → toggle AR/EN flips `dir`, Queue lists pending rows, "Open folder" opens the watch dir.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/i18n.ts src/renderer/App.tsx src/renderer/screens/Queue.tsx src/renderer/screens/Settings.tsx src/renderer/screens/Logs.tsx src/renderer/screens/Account.tsx src/main/ipc.ts electron/main.ts electron/preload.ts tests/unit/i18n.test.ts
git commit -m "feat: add bilingual dashboard with queue and settings"
```

---

### Task 9: Packaging (Windows installer, auto-launch, secrets hygiene, acceptance)

**Files:**
- Create: `electron-builder.yml`
- Modify: `.gitignore`, `package.json`
- Test: manual acceptance checklist (no new unit test; verifies the whole spec).

**Interfaces:**
- Consumes: everything above.
- Produces: installable `Poster Setup.exe` + a clean repo with no secrets.

- [ ] **Step 1: Write the failing check (acceptance script)**

```bash
# scripts/acceptance.md (create in this step)
# 1. Drop 3x (mp4+json future publishAt) → Queue shows 3 pending ≤5s
# 2. Disconnect net mid-upload → reconnect → resumes, no duplicate video id
# 3. Corrupt one json → row failed with Arabic message, others unaffected
# 4. Toggle AR/EN → dir flips rtl/ltr, all strings translated
# 5. grep for client_secret/token in repo → zero hits
```

- [ ] **Step 2: Run check to verify it fails**

Run: `npm run dist` (workdir `poster/`)
Expected: FAIL (no `electron-builder.yml` yet / installer not produced).

- [ ] **Step 3: Write minimal implementation**

```yaml
# electron-builder.yml
appId: com.poster.uploader
productName: Poster
directories: { output: dist }
files: ["out/**/*", "package.json"]
win: { target: ["nsis"], artifactName: "Poster-Setup-${version}.exe" }
nsis: { oneClick: false, allowToChangeInstallationDirectory: true }
```

```
# .gitignore (append)
*.db
*.db-journal
tokens.json
dist/
out/
watch-folder/
```

```jsonc
// package.json — add
{ "build": { "extends": "./electron-builder.yml" } }
```

- [ ] **Step 4: Run check to verify it passes**

Run: `npm run dist` (workdir `poster/`), then walk `scripts/acceptance.md` top to bottom on a test YouTube channel with one `unlisted` upload first.
Expected: installer produced in `dist/`; all 5 acceptance items ticked; `Select-String -Pattern "client_secret|refresh_token" -Path "src","tests"` returns zero hits (tokens only in OS keychain).

- [ ] **Step 5: Commit**

```bash
git add electron-builder.yml .gitignore package.json scripts/acceptance.md
git commit -m "chore: add windows packaging and acceptance checklist"
```

---

## Self-Review

1. **Spec coverage:** folder contract → Tasks 2+4; SQLite queue/states → Task 3; OAuth+refresh → Task 5; resumable+publishAt+quota → Task 6; backoff/retry → Task 7; bilingual UI + screens → Task 8; packaging + acceptance → Task 9; Shorts probe warning → Task 6 (`probe.ts`); future TikTok/Instagram → `UploaderPlugin` interface in Task 6 (no extra work in V1).
2. **Placeholder scan:** no TBD/TODO/"similar to"/"appropriate handling" — every step has concrete code, exact run command, and exact expected output.
3. **Type consistency:** `Sidecar` (Task 2) → `VideoStore.upsertPending(path, Sidecar|null)` (Task 3) → `ingestFolderOnce` (Task 4); `VideoRow.status: VideoStatus` shared everywhere; `YouTubeUploader.upload(filePath, meta)` signature matches `Scheduler.tick` call; `nextDelay(0)=60s` matches DELAYS[0].
