import { useEffect, useState } from "react";
import type { JSX } from "react";
import { t, type Locale } from "../i18n";

export default function Account({ locale }: { locale: Locale }): JSX.Element {
  const [signedIn, setSignedIn] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [quota, setQuota] = useState<{ left: number; usedUnits: number } | null>(null);
  const refresh = async (): Promise<void> => {
    setSignedIn((await window.poster.authStatus()).signedIn);
    setQuota(await window.poster.quotaStatus());
  };
  useEffect(() => {
    void refresh();
  }, []);
  const signIn = async (): Promise<void> => {
    const url = await window.poster.beginLogin();
    window.open(url, "_blank");
    setWaiting(true);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await window.poster.authStatus();
      if (s.signedIn) {
        setSignedIn(true);
        setWaiting(false);
        return;
      }
    }
    setWaiting(false);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
      <p>{signedIn ? t(locale, "account.signedIn") : t(locale, "account.signedOut")}</p>
      <label>
        {t(locale, "account.clientId")}:{" "}
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%" }} />
      </label>
      <label>
        {t(locale, "account.clientSecret")}:{" "}
        <input
          type="password"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => void window.poster.saveClient(clientId, clientSecret).then(() => void refresh())}
        >
          {t(locale, "account.saveClient")}
        </button>
        <button onClick={() => void signIn()}>{t(locale, "account.signIn")}</button>
      </div>
      {waiting && <p>{t(locale, "account.waiting")}</p>}
      {quota && (
        <p>
          {t(locale, "account.quotaLeft")}: {quota.left} (used ~{quota.usedUnits} units)
        </p>
      )}
    </div>
  );
}
