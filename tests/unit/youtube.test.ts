import { describe, expect, it } from "vitest";
import { buildInsertBody, quotaErrorOf } from "../../src/main/uploader/youtube";

describe("youtube uploader", () => {
  it("builds private+publishAt scheduled body", () => {
    const body = buildInsertBody({
      title: "t #Shorts",
      description: "d",
      tags: ["a"],
      publishAt: "2026-10-01T18:00:00.000+03:00"
    });
    expect(body.status.privacyStatus).toBe("private");
    expect(body.status.publishAt).toContain("2026-10-01");
  });
  it("detects quota errors", () => {
    expect(quotaErrorOf({ code: 403, errors: [{ reason: "quotaExceeded" }] })).toBe(true);
    expect(quotaErrorOf(new Error("nope"))).toBe(false);
  });
});
