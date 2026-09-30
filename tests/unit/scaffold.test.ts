import { describe, expect, it } from "vitest";
import { appName } from "../../src/shared/types";

describe("scaffold", () => {
  it("exposes the app name", () => {
    expect(appName()).toBe("poster");
  });
});
