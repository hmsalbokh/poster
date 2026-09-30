import { useState } from "react";
import type { JSX } from "react";
import { t, type Locale } from "./i18n";
import Queue from "./screens/Queue";
import Settings from "./screens/Settings";
import Logs from "./screens/Logs";
import Account from "./screens/Account";

type Tab = "queue" | "settings" | "logs" | "account";

export default function App(): JSX.Element {
  const [locale, setLocale] = useState<Locale>("ar");
  const [tab, setTab] = useState<Tab>("queue");
  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} style={{ fontFamily: "sans-serif", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>{t(locale, "app.title")}</h1>
        <button onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
          {locale === "ar" ? "EN" : "عربي"}
        </button>
      </header>
      <nav style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        {(["queue", "settings", "logs", "account"] as Tab[]).map((k) => (
          <button key={k} disabled={tab === k} onClick={() => setTab(k)}>
            {t(locale, `tabs.${k}`)}
          </button>
        ))}
      </nav>
      {tab === "queue" && <Queue locale={locale} />}
      {tab === "settings" && <Settings locale={locale} onLocale={setLocale} />}
      {tab === "logs" && <Logs locale={locale} />}
      {tab === "account" && <Account locale={locale} />}
    </div>
  );
}
