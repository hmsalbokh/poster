import type { VideoStore } from "./db";
import { quotaErrorOf, type YouTubeUploader } from "./uploader/youtube";
import type { UploaderPlugin } from "./uploader/types";
import type { TikTokUploader } from "./tiktok";

const DELAYS = [60_000, 300_000, 1_800_000];

export function nextDelay(attempts: number): number {
  return DELAYS[Math.min(attempts, DELAYS.length - 1)];
}

export const MAX_ATTEMPTS = 5;

export type PublishTarget = "youtube" | "tiktok";

export interface DestinationMap {
  youtube?: UploaderPlugin | YouTubeUploader;
  tiktok?: TikTokUploader;
}

export function parseTargets(raw: string | null): PublishTarget[] {
  try {
    const parsed = JSON.parse(raw ?? '["youtube"]') as unknown;
    if (!Array.isArray(parsed)) return ["youtube"];
    const ok = parsed.filter((t): t is PublishTarget => t === "youtube" || t === "tiktok");
    return ok.length > 0 ? ok : ["youtube"];
  } catch {
    return ["youtube"];
  }
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private store: VideoStore,
    private uploaders: DestinationMap
  ) {}
  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => void this.tick(new Date().toISOString()), intervalMs);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
  async tick(nowIso: string): Promise<void> {
    for (const row of this.store.getDue(nowIso)) {
      const targets = parseTargets(row.targets);
      this.store.setStatus(row.id, "uploading");
      const ids: { youtube_video_id?: string; tiktok_publish_id?: string } = {};
      if (row.youtube_video_id) ids.youtube_video_id = row.youtube_video_id;
      if (row.tiktok_publish_id) ids.tiktok_publish_id = row.tiktok_publish_id;
      const failures: string[] = [];
      let skipped = 0;
      for (const target of targets) {
        // Never upload twice: a stored platform id proves this target is done.
        if (target === "youtube" && row.youtube_video_id) {
          skipped++;
          this.store.log(row.id, "info", `youtube already uploaded as ${row.youtube_video_id} — skipped`);
          continue;
        }
        if (target === "tiktok" && row.tiktok_publish_id) {
          skipped++;
          this.store.log(row.id, "info", `tiktok already uploaded as ${row.tiktok_publish_id} — skipped`);
          continue;
        }
        try {
          if (target === "youtube") {
            const uploader = this.uploaders.youtube;
            if (!uploader) throw new Error("youtube-not-linked");
            const meta = {
              title: row.title,
              description: row.description,
              tags: JSON.parse(row.tags) as string[],
              publishAt: row.publishAt as string,
              madeForKids: false,
              language: row.lang,
              categoryId: "22"
            };
            const { videoId } = await uploader.upload(row.file_path, meta);
            ids.youtube_video_id = videoId;
            this.store.log(row.id, "info", `youtube uploaded as ${videoId}`);
          } else {
            const uploader = this.uploaders.tiktok;
            if (!uploader) throw new Error("tiktok-not-linked");
            const { publishId } = await uploader.upload(row.file_path, {
              title: row.title,
              tags: JSON.parse(row.tags) as string[],
              privacyLevel: row.tiktok_privacy ?? "SELF_ONLY"
            });
            ids.tiktok_publish_id = publishId;
            this.store.log(row.id, "info", `tiktok published as ${publishId}`);
          }
        } catch (err) {
          if (target === "youtube" && quotaErrorOf(err)) {
            this.store.setStatus(row.id, "pending", { ...ids, error: "quota-exceeded-retry-tomorrow" });
            this.store.log(row.id, "warn", "youtube quota exceeded — deferred");
            return;
          }
          const msg = `${target}: ${(err as Error).message}`;
          failures.push(msg);
          this.store.log(row.id, "error", msg);
        }
      }
      if (failures.length === 0) {
        this.store.setStatus(row.id, "uploaded", { ...ids, attempts: 0 });
        if (skipped > 0) this.store.log(row.id, "info", "all targets already uploaded — marked as uploaded");
      } else {
        const attempts = row.attempts + 1;
        const error = failures.join("; ");
        if (attempts >= MAX_ATTEMPTS) {
          this.store.setStatus(row.id, "failed", { ...ids, error, attempts });
        } else {
          this.store.setStatus(row.id, "pending", { ...ids, error, attempts });
        }
      }
    }
  }
}
