import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { t, type I18nKey, type Locale } from "../i18n";
import type { QueueVideo } from "../poster.d";

function fileName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

export default function Queue({ locale }: { locale: Locale }): JSX.Element {
  const [videos, setVideos] = useState<QueueVideo[]>([]);
  const refresh = useCallback(async () => {
    setVideos(await window.poster.listVideos());
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);
  if (videos.length === 0) return <p>{t(locale, "queue.empty")}</p>;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={() => void window.poster.openFolder()}>{t(locale, "queue.openFolder")}</button>
        <button onClick={() => void refresh()}>{t(locale, "queue.refresh")}</button>
      </div>
      <table border={1} cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>{t(locale, "queue.file")}</th>
            <th>{t(locale, "queue.title")}</th>
            <th>{t(locale, "queue.publishAt")}</th>
            <th>{t(locale, "queue.status")}</th>
            <th>{t(locale, "queue.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id}>
              <td>{fileName(v.file_path)}</td>
              <td>{v.title}</td>
              <td>{v.publishAt ?? "—"}</td>
              <td>{t(locale, `status.${v.status}` as I18nKey)}</td>
              <td>
                {v.status === "failed" && (
                  <button
                    onClick={() => void window.poster.retryVideo(v.id).then(() => void refresh())}
                  >
                    {t(locale, "queue.retry")}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
