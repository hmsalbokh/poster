import type { VideoStore } from "./db";
import { YouTubeUploader, quotaErrorOf } from "./uploader/youtube";

const DELAYS = [60_000, 300_000, 1_800_000];

export function nextDelay(attempts: number): number {
  return DELAYS[Math.min(attempts, DELAYS.length - 1)];
}

export const MAX_ATTEMPTS = 5;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private store: VideoStore,
    private uploader: YouTubeUploader
  ) {}
  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => void this.tick(new Date().toISOString()), intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async tick(nowIso: string): Promise<void> {
    for (const row of this.store.getDue(nowIso)) {
      this.store.setStatus(row.id, "uploading");
      try {
        const meta = {
          title: row.title,
          description: row.description,
          tags: JSON.parse(row.tags) as string[],
          publishAt: row.publishAt as string,
          madeForKids: false,
          language: row.lang,
          categoryId: "22"
        };
        const { videoId } = await this.uploader.upload(row.file_path, meta);
        this.store.setStatus(row.id, "scheduled", { youtube_video_id: videoId, attempts: 0 });
        this.store.log(row.id, "info", `scheduled as ${videoId}`);
      } catch (err) {
        if (quotaErrorOf(err)) {
          this.store.setStatus(row.id, "pending", { error: "quota-exceeded-retry-tomorrow" });
          this.store.log(row.id, "warn", "youtube quota exceeded — deferred");
          return;
        }
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          this.store.setStatus(row.id, "failed", { error: (err as Error).message, attempts });
        } else {
          this.store.setStatus(row.id, "pending", { error: (err as Error).message, attempts });
        }
        this.store.log(row.id, "error", (err as Error).message);
      }
    }
  }
}
