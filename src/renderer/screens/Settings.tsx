import { useEffect, useState } from "react";
import type { JSX } from "react";
import { t, type Locale } from "../i18n";

export default function Settings({
  locale,
  onLocale
}: {
  locale: Locale;
  onLocale: (l: Locale) => void;
}): JSX.Element {
  const [dir, setDir] = useState("");
  useEffect(() => {
    void window.poster.getWatchDir().then(setDir);
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
      <label>
        {t(locale, "settings.watchFolder")}: <code>{dir}</code>{" "}
        <button onClick={() => void window.poster.openFolder()}>{t(locale, "queue.openFolder")}</button>
      </label>
      <label>
        {t(locale, "settings.language")}:{" "}
        <select value={locale} onChange={(e) => onLocale(e.target.value as Locale)}>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </label>
    </div>
  );
}
