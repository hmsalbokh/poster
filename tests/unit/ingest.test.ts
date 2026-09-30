import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VideoStore } from "../../src/main/db";
import { ingestFolderOnce } from "../../src/main/ingest";

describe("ingestFolderOnce", () => {
  let dir: string;
  let store: VideoStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "poster-"));
    store = VideoStore.inMemory();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it("pairs mp4 with valid json into pending", () => {
    writeFileSync(join(dir, "clip1.mp4"), "fake");
    writeFileSync(
      join(dir, "clip1.json"),
      JSON.stringify({ title: "t #Shorts", publishAt: new Date(Date.now() + 60000).toISOString() })
    );
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
