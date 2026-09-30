import { describe, expect, it } from "vitest";
import { t, type Locale } from "../../src/renderer/i18n";

describe("i18n", () => {
  it("covers queue status in both locales", () => {
    const locales: Locale[] = ["ar", "en"];
    for (const locale of locales) {
      expect(t(locale, "status.pending").length).toBeGreaterThan(0);
      expect(t(locale, "status.failed").length).toBeGreaterThan(0);
    }
  });
  it("arabic differs from english", () => {
    expect(t("ar", "app.title")).not.toBe(t("en", "app.title"));
  });
});
