import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Sidecar } from "../shared/schema";
import type { VideoRow, VideoStatus } from "../shared/types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videos(
  id TEXT PRIMARY KEY, file_path TEXT UNIQUE NOT NULL, json_path TEXT,
  title TEXT, description TEXT, tags TEXT, publishAt TEXT, lang TEXT,
  status TEXT NOT NULL, youtube_video_id TEXT, error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  targets TEXT, tiktok_privacy TEXT, tiktok_publish_id TEXT);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT, level TEXT NOT NULL,
  message TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`;

export class VideoStore {
  private db: Database.Database;
  private constructor(db: Database.Database) {
    this.db = db;
    db.exec(SCHEMA);
    this.migrate();
  }
  /** Bring pre-TikTok databases up to date without touching existing rows. */
  private migrate(): void {
    const cols = this.db.prepare("PRAGMA table_info(videos)").all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("targets")) this.db.exec("ALTER TABLE videos ADD COLUMN targets TEXT");
    if (!names.has("tiktok_privacy")) this.db.exec("ALTER TABLE videos ADD COLUMN tiktok_privacy TEXT");
    if (!names.has("tiktok_publish_id")) this.db.exec("ALTER TABLE videos ADD COLUMN tiktok_publish_id TEXT");
    this.db.prepare("UPDATE videos SET targets=? WHERE targets IS NULL").run(JSON.stringify(["youtube"]));
    this.db.prepare("UPDATE videos SET tiktok_privacy=? WHERE tiktok_privacy IS NULL").run("SELF_ONLY");
  }
  static file(path: string): VideoStore {
    return new VideoStore(new Database(path));
  }
  static inMemory(): VideoStore {
    return new VideoStore(new Database(":memory:"));
  }
  upsertPending(filePath: string, sidecar: Sidecar | null): VideoRow {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT * FROM videos WHERE file_path=?").get(filePath) as
      | VideoRow
      | undefined;
    const status: VideoStatus = sidecar ? "pending" : "needs-metadata";
    const targets = JSON.stringify(sidecar?.targets ?? ["youtube"]);
    const tiktokPrivacy = sidecar?.tiktokPrivacy ?? "SELF_ONLY";
    if (existing) {
      this.db
        .prepare(
          "UPDATE videos SET title=?,description=?,tags=?,publishAt=?,lang=?,status=?,targets=?,tiktok_privacy=?,updated_at=? WHERE id=?"
        )
        .run(
          sidecar?.title ?? existing.title,
          sidecar?.description ?? "",
          JSON.stringify(sidecar?.tags ?? []),
          sidecar?.publishAt ?? existing.publishAt,
          sidecar?.language ?? "ar",
          status,
          targets,
          tiktokPrivacy,
          now,
          existing.id
        );
      return this.byId(existing.id);
    }
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO videos(id,file_path,title,description,tags,publishAt,lang,status,attempts,created_at,updated_at,targets,tiktok_privacy) VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?)"
      )
      .run(
        id,
        filePath,
        sidecar?.title ?? filePath,
        sidecar?.description ?? "",
        JSON.stringify(sidecar?.tags ?? []),
        sidecar?.publishAt ?? null,
        sidecar?.language ?? "ar",
        status,
        now,
        now,
        targets,
        tiktokPrivacy
      );
    return this.byId(id);
  }
  setStatus(id: string, status: VideoStatus, patch: Partial<VideoRow> = {}): VideoRow {
    const v = this.byId(id);
    this.db
      .prepare(
        "UPDATE videos SET status=?,youtube_video_id=?,tiktok_publish_id=?,error=?,attempts=?,updated_at=? WHERE id=?"
      )
      .run(
        status,
        patch.youtube_video_id ?? v.youtube_video_id,
        patch.tiktok_publish_id ?? v.tiktok_publish_id,
        patch.error ?? null,
        patch.attempts ?? v.attempts,
        new Date().toISOString(),
        id
      );
    return this.byId(id);
  }
  listByStatus(s: VideoStatus): VideoRow[] {
    return this.db.prepare("SELECT * FROM videos WHERE status=? ORDER BY publishAt ASC").all(s) as VideoRow[];
  }
  listAll(): VideoRow[] {
    return this.db.prepare("SELECT * FROM videos ORDER BY created_at DESC").all() as VideoRow[];
  }
  listEvents(limit = 100): Array<{ id: number; video_id: string | null; level: string; message: string; at: string }> {
    return this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit) as Array<{
      id: number;
      video_id: string | null;
      level: string;
      message: string;
      at: string;
    }>;
  }
  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }
  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  countRecentUploads(sinceIso: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM videos WHERE status IN ('uploading','scheduled','published') AND updated_at>=?")
      .get(sinceIso) as { n: number };
    return row.n;
  }
  getDue(nowIso: string): VideoRow[] {
    return this.db
      .prepare(
        "SELECT * FROM videos WHERE status='pending' AND publishAt IS NOT NULL AND publishAt<=? ORDER BY publishAt ASC"
      )
      .all(nowIso) as VideoRow[];
  }
  log(videoId: string | null, level: string, message: string): void {
    this.db
      .prepare("INSERT INTO events(video_id,level,message,at) VALUES(?,?,?,?)")
      .run(videoId, level, message, new Date().toISOString());
  }
  private byId(id: string): VideoRow {
    return this.db.prepare("SELECT * FROM videos WHERE id=?").get(id) as VideoRow;
  }
}
