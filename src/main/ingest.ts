import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parseSidecar } from "../shared/schema";
import type { VideoStore } from "./db";
import type { VideoRow } from "../shared/types";

export function ingestFolderOnce(dir: string, store: VideoStore): VideoRow[] {
  const out: VideoRow[] = [];
  for (const f of readdirSync(dir)) {
    if (extname(f).toLowerCase() !== ".mp4") continue;
    const base = basename(f, extname(f));
    const mp4 = join(dir, f);
    const jsonPath = join(dir, `${base}.json`);
    if (!existsSync(jsonPath)) {
      out.push(store.upsertPending(mp4, null));
      continue;
    }
    try {
      const sidecar = parseSidecar(JSON.parse(readFileSync(jsonPath, "utf8")));
      out.push(store.upsertPending(mp4, sidecar));
    } catch (err) {
      const row = store.upsertPending(mp4, null);
      out.push(store.setStatus(row.id, "failed", { error: `sidecar invalid: ${(err as Error).message}` }));
    }
  }
  return out;
}
