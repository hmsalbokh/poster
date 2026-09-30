import { useEffect, useState } from "react";
import type { JSX } from "react";
import { t, type Locale } from "../i18n";
import type { LogEvent } from "../poster.d";

export default function Logs({ locale }: { locale: Locale }): JSX.Element {
  const [events, setEvents] = useState<LogEvent[]>([]);
  useEffect(() => {
    void window.poster.listEvents().then(setEvents);
  }, []);
  if (events.length === 0) return <p>{t(locale, "logs.empty")}</p>;
  return (
    <ul>
      {events.map((e) => (
        <li key={e.id}>
          [{e.at}] [{e.level}] {e.message}
        </li>
      ))}
    </ul>
  );
}
