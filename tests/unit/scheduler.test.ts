import { describe, expect, it } from "vitest";
import { nextDelay, parseTargets, Scheduler } from "../../src/main/scheduler";
import { VideoStore } from "../../src/main/db";

describe("nextDelay", () => {
  it("backs off 1m then 5m then 30m then caps", () => {
    expect(nextDelay(0)).toBe(60_000);
    expect(nextDelay(1)).toBe(300_000);
    expect(nextDelay(2)).toBe(1_800_000);
    expect(nextDelay(9)).toBe(1_800_000);
  });
});

describe("parseTargets", () => {
  it("defaults to youtube and drops unknown targets", () => {
    expect(parseTargets(null)).toEqual(["youtube"]);
    expect(parseTargets("not-json")).toEqual(["youtube"]);
    expect(parseTargets(JSON.stringify(["tiktok", "vimeo"]))).toEqual(["tiktok"]);
  });
});

function pastIso(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

describe("Scheduler.tick destinations", () => {
  it("publishes youtube-only rows through the youtube uploader", async () => {
    const store = VideoStore.inMemory();
    const row = store.upsertPending("c:/w/a.mp4", {
      title: "t",
      publishAt: pastIso(),
      targets: ["youtube"]
    } as never);
    const scheduler = new Scheduler(store, {
      youtube: { name: "youtube", upload: async () => ({ videoId: "yt1" }) }
    });
    await scheduler.tick(new Date().toISOString());
    const after = store.listByStatus("scheduled");
    expect(after).toHaveLength(1);
    expect(after[0].youtube_video_id).toBe("yt1");
    expect(row.id).toBe(after[0].id);
  });
  it("records tiktok publish id and retries a failed target", async () => {
    const store = VideoStore.inMemory();
    store.upsertPending("c:/w/b.mp4", {
      title: "t",
      publishAt: pastIso(),
      targets: ["tiktok"]
    } as never);
    const scheduler = new Scheduler(store, {
      tiktok: { name: "tiktok", upload: async () => ({ publishId: "pub1" }) } as never
    });
    await scheduler.tick(new Date().toISOString());
    expect(store.listByStatus("scheduled")[0].tiktok_publish_id).toBe("pub1");

    store.upsertPending("c:/w/c.mp4", {
      title: "t",
      publishAt: pastIso(),
      targets: ["youtube", "tiktok"]
    } as never);
    const failing = new Scheduler(store, {
      youtube: { name: "youtube", upload: async () => ({ videoId: "yt2" }) },
      tiktok: { name: "tiktok", upload: async () => { throw new Error("boom"); } } as never
    });
    await failing.tick(new Date().toISOString());
    const pending = store.listByStatus("pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].error).toContain("tiktok: boom");
    expect(pending[0].youtube_video_id).toBe("yt2");
    expect(pending[0].attempts).toBe(1);
  });
});
