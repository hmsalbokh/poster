import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { parseSidecar } from "../../src/shared/schema";
import { VideoStore } from "../../src/main/db";

const future = () => new Date(Date.now() + 3600_000).toISOString();

describe("sidecar targets", () => {
  it("defaults to youtube-only with SELF_ONLY privacy", () => {
    const s = parseSidecar({ title: "t", publishAt: future() });
    expect(s.targets).toEqual(["youtube"]);
    expect(s.tiktokPrivacy).toBe("SELF_ONLY");
  });
  it("accepts youtube+tiktok with explicit privacy", () => {
    const s = parseSidecar({ title: "t", publishAt: future(), targets: ["youtube", "tiktok"], tiktokPrivacy: "SELF_ONLY" });
    expect(s.targets).toEqual(["youtube", "tiktok"]);
  });
  it("rejects unknown targets and privacy levels", () => {
    expect(() => parseSidecar({ title: "t", publishAt: future(), targets: ["vimeo"] })).toThrow();
    expect(() => parseSidecar({ title: "t", publishAt: future(), tiktokPrivacy: "EVERYWHERE" })).toThrow();
  });
});

describe("VideoStore tiktok migration", () => {
  it("adds tiktok columns to a pre-tiktok database without losing rows", () => {
    const path = join(tmpdir(), `poster-mig-${randomUUID()}.db`);
    const raw = new Database(path);
    raw.exec(`CREATE TABLE videos(
      id TEXT PRIMARY KEY, file_path TEXT UNIQUE NOT NULL, json_path TEXT,
      title TEXT, description TEXT, tags TEXT, publishAt TEXT, lang TEXT,
      status TEXT NOT NULL, youtube_video_id TEXT, error TEXT,
      attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(
      id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT, level TEXT NOT NULL,
      message TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    raw.prepare("INSERT INTO videos(id,file_path,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(
      "old1", "c:/watch/old.mp4", "pending", 0, new Date().toISOString(), new Date().toISOString()
    );
    raw.close();
    const store = VideoStore.file(path);
    const rows = store.listAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].targets).toBe(JSON.stringify(["youtube"]));
    expect(rows[0].tiktok_privacy).toBe("SELF_ONLY");
    expect(rows[0].tiktok_publish_id).toBeNull();
  });
  it("persists targets and tiktok publish id", () => {
    const store = VideoStore.inMemory();
    const v = store.upsertPending("c:/watch/tt.mp4", {
      title: "t",
      publishAt: future(),
      targets: ["tiktok"],
      tiktokPrivacy: "SELF_ONLY"
    } as never);
    expect(JSON.parse(v.targets)).toEqual(["tiktok"]);
    const s = store.setStatus(v.id, "scheduled", { tiktok_publish_id: "pub9" });
    expect(s.tiktok_publish_id).toBe("pub9");
  });
});
