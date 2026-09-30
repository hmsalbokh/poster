import { describe, expect, it, beforeEach } from "vitest";
import { VideoStore } from "../../src/main/db";

describe("VideoStore", () => {
  let store: VideoStore;
  beforeEach(() => {
    store = VideoStore.inMemory();
  });
  it("upserts pending then transitions to scheduled", () => {
    const v = store.upsertPending("c:/watch/clip1.mp4", {
      title: "t",
      publishAt: new Date(Date.now() + 60000).toISOString()
    } as never);
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
