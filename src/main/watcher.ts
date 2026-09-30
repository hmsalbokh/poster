import chokidar from "chokidar";
import type { VideoStore } from "./db";
import { ingestFolderOnce } from "./ingest";

export function startWatcher(dir: string, store: VideoStore): { close(): Promise<void> } {
  const watcher = chokidar.watch(dir, { ignored: /(^|[/\\])\../, depth: 0, awaitWriteFinish: true });
  const rescan = (): void => {
    ingestFolderOnce(dir, store);
  };
  watcher.on("add", rescan).on("unlink", rescan).on("change", rescan);
  return { close: () => watcher.close() };
}
