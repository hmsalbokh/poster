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
