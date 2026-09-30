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
      categoryId: "22"
    });
    expect(s.title).toContain("#Shorts");
  });
  it("rejects title over 100 chars", () => {
    expect(() =>
      parseSidecar({ title: "x".repeat(101), publishAt: new Date(Date.now() + 3600_000).toISOString() })
    ).toThrow();
  });
  it("rejects publishAt that is not an ISO date", () => {
    expect(() => parseSidecar({ title: "ok", publishAt: "tomorrow" })).toThrow();
  });
});
