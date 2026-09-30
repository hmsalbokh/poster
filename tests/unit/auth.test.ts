import { describe, expect, it } from "vitest";
import { buildAuthUrl } from "../../src/main/auth";

describe("buildAuthUrl", () => {
  it("includes youtube.upload scope and offline access", () => {
    const url = buildAuthUrl("cid", "https://localhost/cb");
    expect(url).toContain("youtube.upload");
    expect(url).toContain("access_type=offline");
  });
});
