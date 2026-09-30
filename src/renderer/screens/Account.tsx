import { useEffect, useState } from "react";
import type { JSX } from "react";
import { t, type Locale } from "../i18n";

export default function Account({ locale }: { locale: Locale }): JSX.Element {
  const [signedIn, setSignedIn] = useState(false);
  const [savedId, setSavedId] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");
  const [ttLinked, setTtLinked] = useState(false);
  const [ttSavedKey, setTtSavedKey] = useState("");
  const [ttHasSecret, setTtHasSecret] = useState(false);
  const [ttKey, setTtKey] = useState("");
  const [ttSecret, setTtSecret] = useState("");
  const [ttWaiting, setTtWaiting] = useState(false);
  const [ttFlash, setTtFlash] = useState(false);
  const [ttError, setTtError] = useState("");
  const [quota, setQuota] = useState<{ left: number; usedUnits: number } | null>(null);
  const refresh = async (): Promise<void> => {
    const [status, client, ttClient] = await Promise.all([
      window.poster.authStatus(),
      window.poster.getClient(),
      window.poster.getTikTokClient()
    ]);
    setSignedIn(status.signedIn);
    setSavedId(client.clientId);
    setHasSecret(client.hasSecret);
    if (!clientId) setClientId(client.clientId);
    setTtLinked(ttClient.linked);
    setTtSavedKey(ttClient.clientKey);
    setTtHasSecret(ttClient.hasSecret);
    if (!ttKey) setTtKey(ttClient.clientKey);
    setQuota(await window.poster.quotaStatus());
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const save = async (): Promise<void> => {
    setError("");
    try {
      await window.poster.saveClient(clientId, clientSecret);
      setClientSecret("");
      setSavedFlash(true);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const signIn = async (): Promise<void> => {
    setError("");
    if (!savedId) {
      setError(t(locale, "account.saveFirst"));
      return;
    }
    try {
      // Main process opens the browser itself; the returned URL is for reference.
      await window.poster.beginLogin();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setWaiting(true);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await window.poster.authStatus();
      if (s.signedIn) {
        setSignedIn(true);
        setWaiting(false);
        await refresh();
        return;
      }
    }
    setWaiting(false);
  };
  const saveTiktok = async (): Promise<void> => {
    setTtError("");
    try {
      await window.poster.saveTikTokClient(ttKey, ttSecret);
      setTtSecret("");
      setTtFlash(true);
      await refresh();
    } catch (e) {
      setTtError((e as Error).message);
    }
  };
  const signInTiktok = async (): Promise<void> => {
    setTtError("");
    if (!ttSavedKey) {
      setTtError(t(locale, "account.saveTiktokFirst"));
      return;
    }
    try {
      await window.poster.beginTikTokLogin();
    } catch (e) {
      setTtError((e as Error).message);
      return;
    }
    setTtWaiting(true);
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await window.poster.tiktokAuthStatus();
      if (s.linked) {
        setTtLinked(true);
        setTtWaiting(false);
        await refresh();
        return;
      }
    }
    setTtWaiting(false);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 640 }}>
      <h2>{t(locale, "account.youtubeSection")}</h2>
      <p style={{ fontWeight: "bold", color: signedIn ? "green" : undefined }}>
        {signedIn ? t(locale, "account.linked") : t(locale, "account.notLinked")}
      </p>
      <label>
        {t(locale, "account.clientId")}:{" "}
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%" }} />
      </label>
      <label>
        {t(locale, "account.clientSecret")}:{" "}
        <input
          type="password"
          value={clientSecret}
          placeholder={hasSecret && !clientSecret ? t(locale, "account.secretSaved") : undefined}
          onChange={(e) => setClientSecret(e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => void save()}>{t(locale, "account.saveClient")}</button>
        <button onClick={() => void signIn()}>{t(locale, "account.signIn")}</button>
      </div>
      {savedFlash && <p>{t(locale, "account.clientSaved")}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
      {waiting && <p>{t(locale, "account.waiting")}</p>}
      <hr style={{ width: "100%" }} />
      <h2>{t(locale, "account.tiktokSection")}</h2>
      <p style={{ fontWeight: "bold", color: ttLinked ? "green" : undefined }}>
        {ttLinked ? t(locale, "account.tiktokLinked") : t(locale, "account.tiktokNotLinked")}
      </p>
      <label>
        {t(locale, "account.tiktokClientKey")}:{" "}
        <input value={ttKey} onChange={(e) => setTtKey(e.target.value)} style={{ width: "100%" }} />
      </label>
      <label>
        {t(locale, "account.tiktokClientSecret")}:{" "}
        <input
          type="password"
          value={ttSecret}
          placeholder={ttHasSecret && !ttSecret ? t(locale, "account.secretSaved") : undefined}
          onChange={(e) => setTtSecret(e.target.value)}
          style={{ width: "100%" }}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => void saveTiktok()}>{t(locale, "account.saveClient")}</button>
        <button onClick={() => void signInTiktok()}>{t(locale, "account.tiktokSignIn")}</button>
      </div>
      {ttFlash && <p>{t(locale, "account.clientSaved")}</p>}
      {ttError && <p style={{ color: "red" }}>{ttError}</p>}
      {ttWaiting && <p>{t(locale, "account.waiting")}</p>}
      {quota && (
        <p>
          {t(locale, "account.quotaLeft")}: {quota.left} (used ~{quota.usedUnits} units)
        </p>
      )}
    </div>
  );
}
